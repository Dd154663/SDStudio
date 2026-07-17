/* eslint global-require: off, no-console: off, promise/always-return: off */

/**
 * This module executes inside of electron's main process. You can start
 * electron renderer process from here and communicate with the other processes
 * through IPC.
 *
 * When running `npm run build` or `npm run build:main`, this file is compiled to
 * `./src/main.js` using webpack. This gives us some performance wins.
 */
// 반드시 최상단 — sharp/첫 threadpool 사용 전에 UV_THREADPOOL_SIZE 를 확정한다.
import './uvThreadpool';
import path from 'path';
import {
  app,
  BrowserWindow,
  shell,
  ipcMain,
  screen,
  webContents,
  dialog,
  nativeImage,
  clipboard,
} from 'electron';
import log from 'electron-log';
import MenuBuilder from './menu';
import { resolveHtmlPath } from './util';
import { v4 as uuidv4 } from 'uuid';
const sharp = require('sharp');
// 대량 병렬 변환 최적화: 각 sharp 연산이 libvips 스레드를 코어 수만큼 점유하면,
// worker-pool 이 N장을 동시에 돌릴 때 N×코어 스레드가 경합해(오버서브스크립션)
// 오히려 느려진다. 연산당 1스레드로 두고 "여러 장을 동시에"(UV_THREADPOOL_SIZE)
// 병렬화하는 것이 다수 이미지 처리에 유리하다(sharp 공식 권장). 트랙2 WebP Phase 2.
sharp.concurrency(1);
const ExifReader = require('exifreader');
const native = require('sdsnative');
const { exiftool } = require('exiftool-vendored');
const chokidar = require('chokidar');
import webpackPaths from '../../.erb/configs/webpack.paths';
import { Config } from './config';
import { extractStealthBits, embedStealthBits, canEmbed } from './stealth';
import { spawn } from 'child_process';
import fsExtra from 'fs-extra';
import LocalAIService from './localai';
const StreamZip = require('node-stream-zip');

import contextMenu from 'electron-context-menu';
import * as electronDL from 'electron-dl';
import { createGzip } from 'zlib';
import { ImageOptimizeMethod } from '../renderer/backend';

interface DataBaseConns {
  tagDBId: number;
  pieceDBId: number;
}

let databases: DataBaseConns = {
  tagDBId: -1,
  pieceDBId: -1,
};

// 주 창(primary) 포인터 — 창 상태 저장/second-instance 포커스의 기준이 된다.
// 보조 창은 이 변수에 담기지 않고 BrowserWindow.getAllWindows() 로만 추적한다(W6 P0).
let mainWindow: BrowserWindow | null = null;
let tagMap: Map<string, any> = new Map();

// 종료 저장 게이트 — 창별로 분리(webContents.id 기준). 닫는 창만 렌더러에 저장을
// 위임받고, 렌더러가 invoke('close') 하면 그 창만 다시 닫는다. 창이 닫히면 정리한다.
// (전역 단일 플래그였다면 한 창을 닫을 때 다른 창의 저장 게이트까지 함께 열려 유실 위험)
const saveCompletedByWc = new Map<number, boolean>();

// 전 창 브로드캐스트 — 요청 컨텍스트가 없는(창 공유) 이벤트용. 파괴된 창은 건너뛴다.
function broadcast(channel: string, ...args: any[]) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, ...args);
  }
}

// ─── 프로젝트 배타 락 (W6 P1) ───
// 같은 프로젝트를 두 창에서 동시에 여는 것을 원천 차단한다. 렌더러의 쓰기 큐/락은
// 프로세스(창) 내부 직렬화라 창 간에는 효력이 없어, 이 등록부가 유일한 안전선이다.
// 키 = 프로젝트명, 값 = 소유 창 webContents.id. 창이 닫히면 자동 해제(closed 훅).
const projectLocks = new Map<string, number>();

function findWindowByWcId(wcId: number): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows().find(
    (w) => !w.isDestroyed() && w.webContents.id === wcId,
  );
}

// 소유 창이 이미 사라진 낡은 락은 지우고 없는 것으로 취급한다(방어적 자가 치유).
function liveLockOwner(name: string): number | undefined {
  const owner = projectLocks.get(name);
  if (owner === undefined) return undefined;
  if (!findWindowByWcId(owner)) {
    projectLocks.delete(name);
    return undefined;
  }
  return owner;
}

ipcMain.handle('project-lock-acquire', (event, name: string) => {
  const owner = liveLockOwner(name);
  if (owner === undefined || owner === event.sender.id) {
    projectLocks.set(name, event.sender.id);
    return true;
  }
  return false;
});

ipcMain.handle('project-lock-release', (event, name: string) => {
  if (projectLocks.get(name) === event.sender.id) projectLocks.delete(name);
});

ipcMain.handle('project-lock-query', (event, name: string) => {
  const owner = liveLockOwner(name);
  if (owner === undefined) return { locked: false, mine: false };
  return { locked: true, mine: owner === event.sender.id };
});

// 락 소유 창을 앞으로 가져온다 — "다른 창에서 열려 있음" 충돌 UX용.
// notice 가 있으면 안내 토스트를 **소유 창**에 띄운다 — 포커스가 즉시 소유 창으로
// 넘어가므로 요청한 창에 토스트를 남기면 돌아왔을 때 낡은 메시지만 남는다(실기 피드백).
ipcMain.handle(
  'project-lock-focus-owner',
  (event, name: string, notice?: string) => {
    const owner = liveLockOwner(name);
    if (owner === undefined) return false;
    const win = findWindowByWcId(owner);
    if (!win) return false;
    if (win.isMinimized()) win.restore();
    win.focus();
    if (notice) win.webContents.send('lock-owner-notice', notice);
    return true;
  },
);

// ─── 전역 저장소 동기화 (W6 P2) ───
// 창 공유 저장소(config·글로벌 캐릭터 프리셋·휴지통·세션 메타)의 변경을 다른
// 창들에 알린다 — 낙관적 쓰기 + 변경 브로드캐스트(수신 창이 디스크에서 재로드).
// 보낸 창 자신은 제외한다(이미 최신 상태 + 재로드로 인한 편집 중 상태 유실 방지).
function broadcastGlobalStoreChanged(senderWcId: number, key: string) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed() && w.webContents.id !== senderWcId) {
      w.webContents.send('global-store-changed', key);
    }
  }
}

ipcMain.handle('notify-global-store-changed', (event, key: string) => {
  broadcastGlobalStoreChanged(event.sender.id, key);
});

// "새 창에서 열기"로 전달된 초기 프로젝트 — 새 창(wcId)이 부팅 후 1회 가져간다.
const pendingInitialProject = new Map<number, string>();

ipcMain.handle('take-initial-project', (event) => {
  const name = pendingInitialProject.get(event.sender.id) ?? null;
  pendingInitialProject.delete(event.sender.id);
  return name;
});

// 살아있는 창 하나(주 창 우선)를 복원·포커스한다. second-instance 처리용.
function focusAnyWindow() {
  const win =
    mainWindow && !mainWindow.isDestroyed()
      ? mainWindow
      : BrowserWindow.getAllWindows()[0];
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
}

async function listFilesInDirectory(dir: any) {
  try {
    const files = await fs.readdir(dir);
    return files; // Return the list of files
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return [];
    } else {
      throw err;
    }
  }
}

// Function to get the MIME type based on file extension
function getMimeType(filePath: any) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.jpeg':
    case '.jpg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.pdf':
      return 'application/pdf';
    case '.txt':
      return 'text/plain';
    case '.html':
      return 'text/html';
    default:
      return 'application/octet-stream';
  }
}

// Function to read file as Data URL
async function readFileAsDataURL(filePath: any) {
  try {
    const data = await fs.readFile(filePath);
    const mimeType = getMimeType(filePath);
    const base64Data = data.toString('base64');
    const dataURL = `data:${mimeType};base64,${base64Data}`;
    return dataURL;
  } catch (err) {
    console.error('Error reading file:', err);
    throw err;
  }
}

const DEFAULT_APP_DIR = app.getPath('userData') + '/' + 'SDStudio';
let APP_DIR = DEFAULT_APP_DIR;

let config: Config = {};

// 창 컨트롤 IPC — 호출한 창(event.sender)에만 작용한다(멀티 윈도우 안전).
ipcMain.handle('window-minimize', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});
ipcMain.handle('window-maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win?.isMaximized()) {
    win.unmaximize();
  } else {
    win?.maximize();
  }
});
ipcMain.handle('window-close', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});
ipcMain.handle('window-is-maximized', (event) => {
  return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
});
ipcMain.handle('get-config', async (event) => {
  return config;
});

ipcMain.handle('set-config', async (event, newConfig) => {
  config = newConfig;
  // tmp+rename 원자 쓰기 — 직접 쓰기는 강제 종료 시 파일이 반쯤 쓰여 파손되고,
  // 다음 부팅의 로드가 조용히 실패해 설정 전체가 기본값으로 초기화된다.
  const tmpFile = path.join(DEFAULT_APP_DIR, uuidv4());
  await fs.writeFile(tmpFile, JSON.stringify(config), 'utf-8');
  await fs.rename(tmpFile, path.join(DEFAULT_APP_DIR, 'config.json'));
  // 전역 저장소 동기화(W6 P2): 설정 변경을 다른 창들에 알린다 — 각 창이
  // get-config 재조회+미러 재적용(config-changed 경로)으로 반영한다.
  broadcastGlobalStoreChanged(event.sender.id, 'config');
});

ipcMain.handle('get-version', async (event) => {
  return app.getVersion();
});

// 런타임 진단(트랙2 WebP): 감지 코어 수와 실효 libuv 스레드풀 크기(=동시 인코딩
// 상한)를 노출한다. 환경설정 시스템 탭에서 병렬 상한이 실제로 코어 수로 잡혔는지
// 사용자가 눈으로 확인하는 용도.
ipcMain.handle('get-runtime-diag', async () => {
  return {
    cpus: require('os').cpus().length,
    uvThreadpool: process.env.UV_THREADPOOL_SIZE
      ? parseInt(process.env.UV_THREADPOOL_SIZE, 10)
      : 4,
  };
});

// 부팅 경고 조회: 사용자 지정 저장 경로 접근 실패로 기본 경로 폴백이 있었는지
// 렌더러에 전달한다. 렌더러는 부팅 후 1회 조회해 사용자에게 안내한다.
ipcMain.handle('get-boot-warnings', async () => {
  return { saveLocationFallback };
});

// 저장 경로 사전 검증: 사용자가 폴더를 저장 경로로 지정하기 전에 실제 쓰기 가능
// 여부를 확인한다(권한 없는 드라이브 지정 → 다음 부팅 벽돌화 예방). 데스크톱 전용.
ipcMain.handle('check-writable', async (event, absPath: string) => {
  try {
    await fs.mkdir(absPath, { recursive: true });
    const probe = path.join(absPath, '.' + uuidv4() + '.wtest');
    await fs.writeFile(probe, 'ok', 'utf-8');
    await fs.rm(probe).catch(() => {});
    return { ok: true };
  } catch (e: any) {
    return { ok: false, code: String(e?.code || e?.message || e) };
  }
});

ipcMain.handle('open-web-page', async (event, url) => {
  await shell.openExternal(url);
});

ipcMain.handle('show-file', async (event, arg) => {
  // 절대경로(목표 폴더 export 결과)면 그대로, 아니면 APP_DIR 기준 상대경로로 해석.
  const filePath = path.isAbsolute(arg) ? arg : path.join(APP_DIR, arg);
  shell.showItemInFolder(filePath);
});

const AdmZip = require('adm-zip');

const fsSync = require('fs');
const tar = require('tar-fs');
const tarStream = require('tar-stream');
const fs = require('fs').promises;

ipcMain.handle('zip-files', async (event, files, outPath) => {
  const finalPath = APP_DIR + '/' + outPath;
  const dir = path.dirname(finalPath);
  // 원자적 아카이브 쓰기: '.part' 임시 경로에 스트리밍 → 완료 시 rename.
  // 도중 강제 종료/앱 닫기 시 불완전 tar 가 최종 경로에 남지 않는다(임시 파일만
  // 잔존, 다음 부팅 정리 대상). 트랙1 (b) 마이그레이션 백업 원자성 스펙 §4-0.
  const tmpPath = finalPath + '.part';
  files = files.map((x: any) => ({
    name: x.name,
    path: APP_DIR + '/' + x.path,
  }));
  await fs.mkdir(dir, { recursive: true });
  const pack = tarStream.pack();
  const writeStream = fsSync.createWriteStream(tmpPath);
  pack.pipe(writeStream);
  try {
    let done = 0;
    for (const file of files) {
      event.sender.send('zip-progress', {
        done: done,
        total: files.length,
      });
      await new Promise((resolve, reject) => {
        const srcPath = file.path;
        const destPath = file.name;
        const size = fsSync.statSync(srcPath).size;
        const stream = fsSync.createReadStream(srcPath);
        const entry = pack.entry({ name: destPath, size: size });
        stream.on('error', reject);
        entry.on('error', reject);
        entry.on('finish', resolve);
        stream.pipe(entry);
      });
      done++;
    }
    event.sender.send('zip-progress', {
      done: files.length,
      total: files.length,
    });
    // pack.finalize() 이후 writeStream 이 실제로 닫힐 때까지 기다린 뒤 rename 해야
    // 최종 파일이 온전하다.
    await new Promise<void>((resolve, reject) => {
      writeStream.on('finish', () => resolve());
      writeStream.on('error', reject);
      pack.finalize();
    });
    await fs.rename(tmpPath, finalPath);
  } catch (e: any) {
    console.error('zip-files error:', e);
    pack.destroy();
    writeStream.destroy();
    // 불완전 임시 파일 정리 시도(실패는 무시)
    await fs.unlink(tmpPath).catch(() => {});
    throw new Error('압축 중 오류: ' + (e.message || e));
  }
});

// 데이터 루트 볼륨의 여유 공간(bytes) — 마이그레이션 백업 게이트 공간 판정용.
// statfs 미지원/오류 시 null(="알 수 없음")을 반환해 게이트가 경고 경로로 간다.
ipcMain.handle('get-free-space', async () => {
  try {
    const st: any = await fs.statfs(APP_DIR);
    return st.bavail * st.bsize;
  } catch (e) {
    console.error('get-free-space error:', e);
    return null;
  }
});

ipcMain.handle('unzip-files', async (event, zipPath, outPath) => {
  try {
    outPath = APP_DIR + '/' + outPath;
    await fs.mkdir(outPath, { recursive: true });
    const stream = fsSync.createReadStream(zipPath).pipe(tar.extract(outPath));
    await new Promise((resolve, reject) => {
      stream.on('finish', resolve);
      stream.on('error', reject);
    });
  } catch (e: any) {
    console.error('unzip-files error:', e);
    throw new Error('압축 해제 중 오류: ' + (e.message || e));
  }
});

ipcMain.handle('search-tags', async (event, word) => {
  return native.search(databases.tagDBId, word);
});

ipcMain.handle('load-pieces-db', async (event, pieces) => {
  const csv = pieces
    .map((x: string) => {
      return `<${x}>,0,0,null`;
    })
    .join('\n');
  native.loadDB(databases.pieceDBId, csv);
});

ipcMain.handle('search-pieces', async (event, word) => {
  return native.search(databases.pieceDBId, word);
});

ipcMain.handle('list-files', async (event, arg) => {
  return await listFilesInDirectory(APP_DIR + '/' + arg);
});

ipcMain.handle('list-files-with-stats', async (event, arg) => {
  const dir = APP_DIR + '/' + arg;
  try {
    const files = await fs.readdir(dir);
    const results = [];
    for (const name of files) {
      try {
        const stat = await fs.stat(path.join(dir, name));
        if (stat.isFile()) {
          results.push({ name, size: stat.size, mtime: stat.mtimeMs });
        }
      } catch (_) {}
    }
    return results;
  } catch (err: any) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
});

ipcMain.handle('read-file', async (event, filename) => {
  const data = await fs.readFile(APP_DIR + '/' + filename, 'utf-8');
  return data;
});

ipcMain.handle('write-file', async (event, filename, data) => {
  const dir = path.dirname(APP_DIR + '/' + filename);
  await fs.mkdir(dir, { recursive: true });
  const tmpFile = APP_DIR + '/' + uuidv4();
  await fs.writeFile(tmpFile, data, 'utf-8');
  await fs.rename(tmpFile, APP_DIR + '/' + filename, { recursive: true });
});

// 전역(저장 경로와 무관) 파일 IO — 로그인 토큰처럼 데이터 저장소가 아니라
// "이 PC의 앱"에 귀속되는 파일용. config.json 과 같은 DEFAULT_APP_DIR(userData)
// 고정이라 saveLocation 을 바꿔도 함께 이동/유실되지 않는다.
ipcMain.handle('read-global-file', async (event, filename) => {
  return await fs.readFile(DEFAULT_APP_DIR + '/' + filename, 'utf-8');
});

ipcMain.handle('write-global-file', async (event, filename, data) => {
  await fs.mkdir(DEFAULT_APP_DIR, { recursive: true });
  const tmpFile = DEFAULT_APP_DIR + '/' + uuidv4();
  await fs.writeFile(tmpFile, data, 'utf-8');
  await fs.rename(tmpFile, DEFAULT_APP_DIR + '/' + filename);
});

ipcMain.handle('copy-file', async (event, src, dest) => {
  const dir = path.dirname(APP_DIR + '/' + dest);
  await fs.mkdir(dir, { recursive: true });
  await fs.copyFile(APP_DIR + '/' + src, APP_DIR + '/' + dest);
});

// src(APP_DIR 상대) → 절대경로 dest 로 복사. 데스크톱 export 목표 폴더용.
ipcMain.handle('copy-file-absolute', async (event, src, absoluteDest) => {
  const dir = path.dirname(absoluteDest);
  await fs.mkdir(dir, { recursive: true });
  await fs.copyFile(APP_DIR + '/' + src, absoluteDest);
});

// ── 이미지 인코딩 단일 출처 (트랙2 WebP Phase 3) ──
// 원본(PNG 등) → webp/avif 인코딩. resize(선택)·품질·무손실·effort·EXIF 이월을
// 파라미터화한다. resize-image(내보내기·백업 최적화)와 convert-to-webp(생성 이미지
// 일괄 변환)가 각자 갖던 sharp 파이프라인을 여기로 통합한다.
// carryMetadata: NAI 프롬프트(원본 PNG tEXt 'Comment' JSON)를 EXIF ImageDescription
// 으로 이월 — 이전엔 convert-to-webp 만 보존하고 resize-image(내보내기)는 유실했다.
async function encodeImageFile(
  srcAbs: string,
  destAbs: string,
  opts: {
    format: 'webp' | 'avif';
    quality?: number;
    lossless?: boolean;
    effort?: number;
    resize?: { maxWidth: number; maxHeight: number };
    carryMetadata?: boolean;
    // NAI 알파 stealth 워터마크 보존(webp 전용). 소스에서 비트스트림을 추출해
    // 리사이즈된 출력 알파에 재삽입한다. 없으면/AVIF 면 일반 경로로 폴백.
    preserveStealth?: boolean;
  },
): Promise<void> {
  const buf = await fs.readFile(srcAbs);
  let comment: string | null = null;
  if (opts.carryMetadata) {
    try {
      const tags = ExifReader.load(buf);
      const c = tags['Comment'];
      if (c) comment = (c.value ?? c.description ?? '').toString() || null;
    } catch (e) {
      // 메타데이터 없음 — EXIF 없이 진행
    }
  }
  await fs.mkdir(path.dirname(destAbs), { recursive: true });

  // ── NAI stealth 보존 경로 (webp 전용) ──
  // 소스 알파에서 stealth 비트스트림을 추출 → 리사이즈된 출력 알파에 재삽입 →
  // webp 무손실 알파로 인코딩. AVIF 는 알파를 평탄화하므로 대상이 아니다.
  if (opts.preserveStealth && opts.format === 'webp') {
    const src = await sharp(buf)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const bits = extractStealthBits(
      src.data,
      src.info.width,
      src.info.height,
      src.info.channels,
    );
    if (bits) {
      let rp = sharp(buf);
      if (opts.resize) {
        rp = rp.resize(opts.resize.maxWidth, opts.resize.maxHeight, {
          fit: sharp.fit.inside,
          withoutEnlargement: true,
        });
      }
      const out = await rp
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      if (canEmbed(bits, out.info.width, out.info.height)) {
        embedStealthBits(
          out.data,
          out.info.width,
          out.info.height,
          out.info.channels,
          bits,
        );
        let enc = sharp(out.data, {
          raw: {
            width: out.info.width,
            height: out.info.height,
            channels: out.info.channels,
          },
        });
        // 무손실이면 알파도 무손실. 저손실이면 RGB 만 손실, 알파는 alphaQuality 100
        // 으로 무손실 유지(= stealth LSB 보존).
        enc = opts.lossless
          ? enc.webp({ lossless: true })
          : enc.webp({ quality: opts.quality ?? 80, lossless: false, alphaQuality: 100 });
        if (comment) {
          enc = enc.withMetadata({ exif: { IFD0: { ImageDescription: comment } } });
        }
        await enc.toFile(destAbs);
        return;
      }
    }
    // stealth 없음/담기 부족 → 아래 일반 경로로 폴백(경고 없이 자연 통과)
  }

  let pipeline = sharp(buf);
  if (opts.resize) {
    pipeline = pipeline.resize(opts.resize.maxWidth, opts.resize.maxHeight, {
      fit: sharp.fit.inside,
      withoutEnlargement: true,
    });
  }
  if (opts.format === 'avif') {
    pipeline = pipeline.avif({ quality: opts.quality ?? 50, effort: opts.effort ?? 4 });
  } else if (opts.lossless) {
    pipeline = pipeline.webp({ lossless: true });
  } else {
    pipeline = pipeline.webp({ quality: opts.quality ?? 80, lossless: false });
  }
  if (comment) {
    pipeline = pipeline.withMetadata({
      exif: { IFD0: { ImageDescription: comment } },
    });
  }
  await pipeline.toFile(destAbs);
}

// 생성 이미지 PNG → WebP 변환 (NAI 프롬프트 메타데이터를 EXIF ImageDescription 으로 이월).
ipcMain.handle('convert-to-webp', async (event, srcRel, destRel, quality) => {
  await encodeImageFile(APP_DIR + '/' + srcRel, APP_DIR + '/' + destRel, {
    format: 'webp',
    quality: quality ?? 80,
    carryMetadata: true,
  });
});

ipcMain.handle('read-data-file', async (event, arg) => {
  return await readFileAsDataURL(APP_DIR + '/' + arg);
});

ipcMain.handle('write-data-file', async (event, filename, data) => {
  const binaryData = Buffer.from(data, 'base64');
  const dir = path.dirname(APP_DIR + '/' + filename);
  await fs.mkdir(dir, { recursive: true });
  const tmpFile = APP_DIR + '/' + uuidv4();
  await fs.writeFile(tmpFile, binaryData);
  await fs.rename(tmpFile, APP_DIR + '/' + filename, { recursive: true });
});

ipcMain.handle('write-data-file-absolute', async (event, absolutePath, data) => {
  const binaryData = Buffer.from(data, 'base64');
  const dir = path.dirname(absolutePath);
  await fs.mkdir(dir, { recursive: true });
  const tmpFile = path.join(dir, uuidv4());
  await fs.writeFile(tmpFile, binaryData);
  await fs.rename(tmpFile, absolutePath, { recursive: true });
});

ipcMain.handle('exist-file-absolute', async (event, absolutePath) => {
  try {
    await fs.access(absolutePath);
    return true;
  } catch (e) {
    return false;
  }
});

ipcMain.handle('rename-file', async (event, oldfile, newfile) => {
  const oldPath = path.join(APP_DIR, oldfile);
  const newPath = path.join(APP_DIR, newfile);
  watchHandles.delete(oldPath);
  watchHandles.delete(newPath);
  await fs.mkdir(path.dirname(newPath), { recursive: true });
  return await fs.rename(oldPath, newPath);
});

async function safeRemove(dirPath: string, retries = 10, delay = 100) {
  if (!(await fsExtra.pathExists(dirPath))) return;
  for (let i = 0; i < retries; i++) {
    try {
      await fsExtra.remove(dirPath);
      return;
    } catch (err: any) {
      if (err.code === 'ENOENT') return;
      if (i === retries - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

ipcMain.handle('rename-dir', async (event, oldfile, newfile) => {
  const platform = os.platform();
  const oldPath = APP_DIR + '/' + oldfile;
  const newPath = APP_DIR + '/' + newfile;

  if (!(await fsExtra.pathExists(oldPath))) {
    return;
  }

  const normOldPath = path.normalize(oldPath);
  // Release watcher handles to prevent EPERM
  for (const [dir, handle] of dirWatchHandles.entries()) {
    if (dir === normOldPath || dir.startsWith(normOldPath + path.sep)) {
      await handle.close();
      dirWatchHandles.delete(dir);
    }
  }
  for (const curPath of watchHandles.keys()) {
    if (curPath.startsWith(normOldPath + path.sep)) {
      watchHandles.delete(curPath);
    }
  }

  if (platform === 'win32') {
    await fs.mkdir(path.dirname(newPath), { recursive: true });
    for (let i = 0; i < 10; i++) {
      try {
        await fs.rename(oldPath, newPath);
        return;
      } catch (e: any) {
        if (e.code === 'ENOENT') {
          return;
        }
        if (i === 9) {
          await fsExtra.copy(oldPath, newPath);
          await safeRemove(oldPath);
        } else {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    }
  } else {
    await fs.mkdir(path.dirname(newPath), { recursive: true });
    try {
      await fs.rename(oldPath, newPath);
    } catch (e: any) {
      if (e.code !== 'ENOENT') {
        throw e;
      }
    }
  }
});

ipcMain.handle('delete-file', async (event, filename) => {
  return await fs.unlink(APP_DIR + '/' + filename);
});

ipcMain.handle('delete-dir', async (event, filename) => {
  const dirPath = APP_DIR + '/' + filename;
  if (!(await fsExtra.pathExists(dirPath))) {
    return;
  }
  const normDirPath = path.normalize(dirPath);
  // Release watcher handles to prevent EPERM
  for (const [dir, handle] of dirWatchHandles.entries()) {
    if (dir === normDirPath || dir.startsWith(normDirPath + path.sep)) {
      await handle.close();
      dirWatchHandles.delete(dir);
    }
  }
  for (const curPath of watchHandles.keys()) {
    if (curPath.startsWith(normDirPath + path.sep)) {
      watchHandles.delete(curPath);
    }
  }

  if (os.platform() === 'win32') {
    return await safeRemove(dirPath);
  } else {
    try {
      return await fs.rmdir(dirPath, { recursive: true });
    } catch (e: any) {
      if (e.code !== 'ENOENT') {
        throw e;
      }
    }
  }
});

ipcMain.handle('trash-file', async (event, filename) => {
  await shell.trashItem(path.join(APP_DIR, filename));
});

ipcMain.handle('close', async (event) => {
  // 저장 완료 위임 — 호출한 창만 게이트를 열고 그 창만 다시 닫는다.
  const win = BrowserWindow.fromWebContents(event.sender);
  saveCompletedByWc.set(event.sender.id, true);
  win?.close();
});

// 앱 자체 재시작 — 종료 후 자동 재실행을 예약하고 정상 종료 경로(close)를 탄다.
// close 인터셉트(창별 saveCompleted 게이트)를 그대로 거치므로 렌더러의 종료 시
// 저장(flush)이 보장된다. 저장소 마이그레이션 재시작 버튼용. 앱 전체 재시작이라
// 모든 창을 닫는다(각 창이 자기 저장을 flush 한 뒤 닫힘 → 마지막 창에서 앱 종료·재실행).
ipcMain.handle('restart-app', async () => {
  app.relaunch();
  for (const w of BrowserWindow.getAllWindows()) w.close();
});

ipcMain.handle('exist-file', async (event, filename) => {
  try {
    await fs.access(APP_DIR + '/' + filename);
    return true;
  } catch (e) {
    return false;
  }
});

ipcMain.handle('download', async (event, url, dest, filename) => {
  dest = path.join(APP_DIR, dest);
  await fs.mkdir(dest, { recursive: true });
  // 요청한 창(event.sender)을 다운로드 소유 창·진행 이벤트 수신 창으로 삼는다.
  const reqWin = BrowserWindow.fromWebContents(event.sender) ?? mainWindow!;
  const options = {
    directory: dest,
    saveAs: false,
    openFolderWhenDone: false,
    filename,
    onProgress: (progress: any) => {
      event.sender.send('download-progress', progress);
    },
  };
  try {
    await electronDL.download(reqWin, url, options);
  } catch (e) {
    if (!(e instanceof electronDL.CancelError)) {
      console.error(e);
    }
  }
});

// ===== 아티스트 태깅: 로컬 ONNX 추론 (WD tagger / Kaloscope) =====
// onnxruntime-node는 시작 비용을 피하려고 핸들러 안에서 지연 require 한다.
// 세션/CSV는 경로 기준으로 캐시 (모델 파일은 APP_DIR/models/).
const artistTagSessions: Map<string, any> = new Map();
const artistTagCsvCache: Map<string, any> = new Map();

ipcMain.handle('artist-analyze', async (event, arg) => {
  const { imageBase64, model } = arg as {
    imageBase64: string;
    model: 'kaloscope' | 'wd-swinv2' | 'wd-eva02';
  };
  const ort = require('onnxruntime-node');
  const modelsDir = path.join(APP_DIR, 'models');

  const getSession = async (file: string) => {
    const p = path.join(modelsDir, file);
    if (!fsSync.existsSync(p)) {
      throw new Error('모델 파일이 없습니다: ' + file);
    }
    if (!artistTagSessions.has(p)) {
      artistTagSessions.set(p, await ort.InferenceSession.create(p));
    }
    return artistTagSessions.get(p);
  };

  const imgBuf = Buffer.from(imageBase64, 'base64');
  const SIZE = 448;

  if (model === 'kaloscope') {
    // 전처리: timm 표준 평가 변환 재현 (HF 데모 Space와 동일 결과를 내기 위함) —
    // 모델 cfg crop_pct=0.9 → 짧은 변을 497(=floor(448/0.9))로 비율 유지 리사이즈(bicubic)
    // 후 448 중앙 크롭 → RGB /255 → ImageNet 정규화 → NCHW
    const SCALE = Math.floor(SIZE / 0.9); // 497
    const off = Math.floor((SCALE - SIZE) / 2);
    const { data } = await sharp(imgBuf)
      .removeAlpha()
      .resize(SCALE, SCALE, { fit: 'cover', kernel: 'cubic' })
      .extract({ left: off, top: off, width: SIZE, height: SIZE })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const mean = [0.485, 0.456, 0.406];
    const std = [0.229, 0.224, 0.225];
    const f = new Float32Array(3 * SIZE * SIZE);
    for (let i = 0; i < SIZE * SIZE; i++) {
      for (let c = 0; c < 3; c++) {
        f[c * SIZE * SIZE + i] = (data[i * 3 + c] / 255 - mean[c]) / std[c];
      }
    }
    const session = await getSession('kaloscope_2-0.onnx');
    const out = await session.run({
      [session.inputNames[0]]: new ort.Tensor('float32', f, [1, 3, SIZE, SIZE]),
    });
    const logits = out[session.outputNames[0]].data;

    // softmax → top-20
    let mx = -Infinity;
    for (const v of logits) if (v > mx) mx = v;
    let sum = 0;
    const exps = new Float64Array(logits.length);
    for (let i = 0; i < logits.length; i++) {
      exps[i] = Math.exp(logits[i] - mx);
      sum += exps[i];
    }

    // class_mapping.csv: class_id,class_name (이름이 작은따옴표로 감싸인 경우 있음)
    const csvPath = path.join(modelsDir, 'kaloscope_class_mapping.csv');
    let names = artistTagCsvCache.get(csvPath);
    if (!names) {
      names = {} as any;
      const lines = (await fs.readFile(csvPath, 'utf-8')).split('\n');
      for (let i = 1; i < lines.length; i++) {
        const l = lines[i].trim();
        if (!l) continue;
        const ci = l.indexOf(',');
        const id = parseInt(l.slice(0, ci));
        let nm = l.slice(ci + 1);
        if (nm.startsWith("'") && nm.endsWith("'")) nm = nm.slice(1, -1);
        names[id] = nm;
      }
      artistTagCsvCache.set(csvPath, names);
    }
    const idx = Array.from({ length: logits.length }, (_: any, i: number) => i)
      .sort((a, b) => exps[b] - exps[a])
      .slice(0, 20);
    return {
      artists: idx.map((i) => ({
        tag: names[i] ?? String(i),
        score: exps[i] / sum,
      })),
    };
  }

  // WD tagger 전처리: 흰 배경 정사각 패딩 → 448 리사이즈(bicubic) → BGR → NHWC float32 0-255
  // (SmilingWolf wd-v3 표준 전처리)
  // 주의: sharp는 체인 호출 순서가 아니라 내부 고정 순서로 연산을 적용해
  // 한 파이프라인에서는 resize가 extend보다 먼저 실행된다 → 패딩과 리사이즈를
  // 반드시 두 단계로 분리해야 함 (합치면 비정사각 출력이 나와 결과가 망가짐)
  const meta = await sharp(imgBuf).metadata();
  const side = Math.max(meta.width!, meta.height!);
  const padded = await sharp(imgBuf)
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .extend({
      top: Math.floor((side - meta.height!) / 2),
      bottom: Math.ceil((side - meta.height!) / 2),
      left: Math.floor((side - meta.width!) / 2),
      right: Math.ceil((side - meta.width!) / 2),
      background: { r: 255, g: 255, b: 255 },
    })
    .toBuffer();
  const { data, info } = await sharp(padded)
    .resize(SIZE, SIZE, { fit: 'fill', kernel: 'cubic' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== SIZE || info.height !== SIZE || info.channels !== 3) {
    throw new Error(
      `전처리 결과 크기 오류: ${info.width}x${info.height}x${info.channels}`,
    );
  }
  const f = new Float32Array(SIZE * SIZE * 3);
  for (let i = 0; i < SIZE * SIZE; i++) {
    f[i * 3 + 0] = data[i * 3 + 2]; // B
    f[i * 3 + 1] = data[i * 3 + 1]; // G
    f[i * 3 + 2] = data[i * 3 + 0]; // R
  }
  // WD 두 모델은 전처리·태그 CSV가 동일하고 onnx 파일만 다름
  const session = await getSession(
    model === 'wd-eva02' ? 'wd-eva02-large-v3.onnx' : 'wd-swinv2-v3.onnx',
  );
  const out = await session.run({
    [session.inputNames[0]]: new ort.Tensor('float32', f, [1, SIZE, SIZE, 3]),
  });
  const probs = out[session.outputNames[0]].data;

  // selected_tags.csv: tag_id,name,category,count (category 9=rating, 0=general, 4=character)
  const csvPath = path.join(modelsDir, 'wd_selected_tags.csv');
  let tags = artistTagCsvCache.get(csvPath);
  if (!tags) {
    tags = [] as any[];
    const lines = (await fs.readFile(csvPath, 'utf-8')).split('\n');
    for (let i = 1; i < lines.length; i++) {
      const l = lines[i].trim();
      if (!l) continue;
      const parts = l.split(',');
      tags.push({ name: parts[1], category: parseInt(parts[2]) });
    }
    artistTagCsvCache.set(csvPath, tags);
  }
  const rating: any[] = [];
  const general: any[] = [];
  const character: any[] = [];
  for (let i = 0; i < tags.length; i++) {
    const p = probs[i];
    if (tags[i].category === 9) rating.push({ tag: tags[i].name, score: p });
    else if (tags[i].category === 0 && p >= 0.35)
      general.push({ tag: tags[i].name, score: p });
    else if (tags[i].category === 4 && p >= 0.85)
      character.push({ tag: tags[i].name, score: p });
  }
  rating.sort((a, b) => b.score - a.score);
  general.sort((a, b) => b.score - a.score);
  character.sort((a, b) => b.score - a.score);
  return { rating, general, character };
});

ipcMain.handle(
  'resize-image',
  async (
    event,
    { inputPath, outputPath, maxWidth, maxHeight, optimize, quality, preserveStealth },
  ) => {
    try {
      const srcAbs = APP_DIR + '/' + inputPath;
      const destAbs = APP_DIR + '/' + outputPath;
      // optimize 미지정 = 순수 리사이즈(썸네일 생성 등). 포맷 변환·EXIF 이월 없이
      // 확장자대로 인코딩한다(기존 동작 불변).
      if (!optimize) {
        await fs.mkdir(path.dirname(destAbs), { recursive: true });
        await sharp(srcAbs)
          .resize(maxWidth, maxHeight, {
            fit: sharp.fit.inside,
            withoutEnlargement: true,
          })
          .toFile(destAbs);
        return;
      }
      // 최적화 = webp/avif 인코딩(+리사이즈). quality 미지정 시 종전 하드코딩값
      // (webp 80·avif 50)과 동일. NAI 프롬프트 메타데이터를 보존한다(유실 버그 수정).
      await encodeImageFile(srcAbs, destAbs, {
        format: optimize === ImageOptimizeMethod.AVIF ? 'avif' : 'webp',
        lossless: optimize === ImageOptimizeMethod.LOSSLESS,
        quality,
        resize: { maxWidth, maxHeight },
        carryMetadata: true,
        preserveStealth,
      });
    } catch (e: any) {
      console.error('resize-image error:', e);
      throw new Error('이미지 리사이즈 실패: ' + (e.message || e));
    }
  },
);

ipcMain.handle('select-dir', async (event) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(
    BrowserWindow.fromWebContents(event.sender) ?? mainWindow!,
    {
      properties: ['openDirectory'],
    },
  );
  if (canceled) {
    return;
  } else {
    return filePaths[0];
  }
});

ipcMain.handle('select-file', async (event) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(
    BrowserWindow.fromWebContents(event.sender) ?? mainWindow!,
    {
      properties: ['openFile'],
    },
  );
  if (canceled) {
    return;
  } else {
    return filePaths[0];
  }
});

ipcMain.handle('select-files', async (event, options) => {
  const dialogOptions: any = {
    properties: ['openFile', 'multiSelections'],
  };
  if (options?.filters) {
    dialogOptions.filters = options.filters;
  }
  const { canceled, filePaths } = await dialog.showOpenDialog(
    BrowserWindow.fromWebContents(event.sender) ?? mainWindow!,
    dialogOptions,
  );
  if (canceled) {
    return [];
  } else {
    return filePaths;
  }
});

ipcMain.handle('read-binary-file', async (event, filePath) => {
  const data = await fs.readFile(filePath);
  return data.toString('base64');
});

ipcMain.handle('copy-image-to-clipboard', async (event, imagePath) => {
  const image = nativeImage.createFromPath(APP_DIR + '/' + imagePath);
  clipboard.writeImage(image);
});

const util = require('util');
const { exec } = require('child_process');
const execPromise = util.promisify(exec);

const dirWatchHandles = new Map<string, any>();
const watchHandles = new Map<string, any>();
const exclusiveCounter = new Map<string, number>();
let isWritingExifData = false;
const os = require('os');

async function openImageEditor(inputPath: string) {
  const editor = config.imageEditor ?? 'photoshop';
  const homeDir = os.homedir();
  const gimpBaseDirCand1 = path.join(homeDir, 'AppData', 'Local', 'Programs');
  const gimpBaseDirCand2 = 'C:\\Program Files';
  async function findGimpPath(baseDir: string) {
    const platform = os.platform();

    if (platform === 'win32') {
      const gimpDir = 'GIMP 2';
      const binDir = 'bin';
      const gimpPath = path.join(baseDir, gimpDir, binDir);
      const files = await fs.readdir(gimpPath);
      const gimpExecutable = files.find(
        (file: string) => file.startsWith('gimp-') && file.endsWith('.exe'),
      );
      if (gimpExecutable) {
        return path.join(gimpPath, gimpExecutable);
      } else {
        throw new Error('GIMP executable not found.');
      }
    } else if (platform === 'darwin') {
      return '/Applications/GIMP.app';
    } else {
      throw new Error('Unsupported platform: ' + platform);
    }
  }

  const commonPaths = [
    'C:\\Program Files\\Adobe\\Adobe Photoshop CC 2019\\Photoshop.exe',
    'C:\\Program Files\\Adobe\\Adobe Photoshop CC 2020\\Photoshop.exe',
    'C:\\Program Files\\Adobe\\Adobe Photoshop CC 2021\\Photoshop.exe',
    'C:\\Program Files\\Adobe\\Adobe Photoshop 2022\\Photoshop.exe',
    'C:\\Program Files\\Adobe\\Adobe Photoshop 2023\\Photoshop.exe',
    'C:\\Program Files\\Adobe\\Adobe Photoshop 2024\\Photoshop.exe',
    'C:\\Program Files\\Adobe\\Adobe Photoshop 2025\\Photoshop.exe',
    'C:\\Program Files\\Adobe\\Adobe Photoshop 2026\\Photoshop.exe',
    '/Applications/Adobe Photoshop CC 2019/Adobe Photoshop CC 2019.app',
    '/Applications/Adobe Photoshop CC 2020/Adobe Photoshop CC 2020.app',
    '/Applications/Adobe Photoshop CC 2021/Adobe Photoshop CC 2021.app',
    '/Applications/Adobe Photoshop 2022/Adobe Photoshop 2022.app',
    '/Applications/Adobe Photoshop 2023/Adobe Photoshop 2023.app',
    '/Applications/Adobe Photoshop 2024/Adobe Photoshop 2024.app',
    '/Applications/Adobe Photoshop 2025/Adobe Photoshop 2025.app',
    '/Applications/Adobe Photoshop 2026/Adobe Photoshop 2026.app',
  ];

  async function findPhotoshopPath(paths: string[]) {
    for (let photoshopPath of paths) {
      if (
        await fs
          .access(photoshopPath)
          .then(() => true)
          .catch(() => false)
      ) {
        return photoshopPath;
      }
    }
    return null;
  }

  const editorsToTry = ['photoshop', 'gimp', 'mspaint'];
  editorsToTry.splice(editorsToTry.indexOf(editor), 1);
  editorsToTry.unshift(editor);
  const runProgram = async (program: string) => {
    const command =
      os.platform() === 'win32'
        ? `"${program}" "${path.resolve(inputPath)}"`
        : `open -a "${program}" "${path.resolve(inputPath)}"`;

    exec(command, (err: any) => {
      if (err) {
        console.error(`Error opening Photoshop: ${err.message}`);
        return;
      }
      console.log('Image editor opened successfully.');
    });
  };
  for (const edi of editorsToTry) {
    switch (edi) {
      case 'photoshop':
        try {
          const photoshopPath = await findPhotoshopPath(commonPaths);
          if (photoshopPath) {
            runProgram(photoshopPath);
            return;
          }
        } catch (e) {}
        break;
      case 'gimp':
        try {
          const gimpPath = await findGimpPath(gimpBaseDirCand1);
          if (gimpPath) {
            runProgram(gimpPath);
            return;
          }
        } catch (e) {}
        try {
          const gimpPath = await findGimpPath(gimpBaseDirCand2);
          if (gimpPath) {
            runProgram(gimpPath);
            return;
          }
        } catch (e) {}
        break;
      case 'mspaint':
        if (os.platform() === 'win32') {
          runProgram('mspaint');
          return;
        }
        break;
    }
  }
}

ipcMain.handle('open-image-editor', async (event, inputPath) => {
  await openImageEditor(APP_DIR + '/' + inputPath);
});

ipcMain.handle('watch-image', async (event, inputPath) => {
  const orgDir = inputPath.split('/').slice(0, -1).join('/');
  inputPath = path.join(APP_DIR, inputPath);
  const dir = path.dirname(inputPath);
  console.log(orgDir);
  const curPath = path.join(dir, path.basename(inputPath));

  let tags = null;
  if (watchHandles.has(curPath) && watchHandles.get(curPath) !== 'null') {
    tags = watchHandles.get(curPath);
  } else {
    try {
      tags = await exiftool.read(curPath);
    } catch (e) {
      console.error('Could not read exif:', curPath, e);
    }
  }
  if (!dirWatchHandles.has(dir)) {
    const handle = chokidar.watch(dir, {
      persistent: true,
      ignoreInitial: true,
      usePolling: false,
    });

    handle.on('change', async (changedPath: string) => {
      console.log('File changed:', changedPath);
      const candPath = path.join(dir, path.basename(changedPath));
      if (watchHandles.has(candPath)) {
        console.log('Image changed:', changedPath);
        if (!isWritingExifData) {
          if (watchHandles.get(candPath) !== 'null') {
            const trigger = (dur: number, retry: boolean) => {
              const myCounter = (exclusiveCounter.get(changedPath) ?? 0) + 1;
              exclusiveCounter.set(changedPath, myCounter);
              setTimeout(async () => {
                if (exclusiveCounter.get(changedPath) !== myCounter) {
                  return;
                }
                try {
                  isWritingExifData = true;
                  await exiftool.write(changedPath, watchHandles.get(candPath));
                  console.log(
                    'Exif data written:',
                    orgDir + '/' + path.basename(changedPath),
                  );
                  // 디렉터리 감시자는 창 간 공유(dirWatchHandles 로 dedup)라 신뢰할 수
                  // 있는 단일 요청 창이 없다 → 전 창 브로드캐스트(관심 없는 창은 무시).
                  broadcast(
                    'image-changed',
                    orgDir + '/' + path.basename(changedPath),
                  );
                } catch (e) {
                } finally {
                  isWritingExifData = false;
                  exclusiveCounter.delete(changedPath);
                }
                if (retry) {
                  setTimeout(() => {
                    trigger(0, false);
                  }, dur);
                }
              }, 1000);
            };
            trigger(4000, true);
          }
          broadcast(
            'image-changed',
            orgDir + '/' + path.basename(changedPath),
          );
        }
      }
    });

    dirWatchHandles.set(dir, handle);
  }
  watchHandles.set(curPath, tags ?? 'null');
});

ipcMain.handle('unwatch-image', async (event, inputPath) => {
  const dir = path.dirname(inputPath);
  const curPath = path.join(dir, path.basename(inputPath));
  watchHandles.delete(curPath);
});

ipcMain.handle('load-model', async (event, modelPath) => {
  try {
    modelPath = path.resolve(path.join(APP_DIR, modelPath));
    await localAI.loadModel(modelPath, config.useCUDA ?? false);
  } catch (e: any) {
    console.error('load-model error:', e);
    throw new Error('모델 로드 실패: ' + (e.message || e));
  }
});

ipcMain.handle('extract-zip', async (event, zipPath, outPath) => {
  try {
    const platform = os.platform();

    if (platform === 'win32') {
      const dir = path.join(APP_DIR, outPath);
      const zip = new StreamZip.async({ file: path.join(APP_DIR, zipPath) });
      try {
        let numExtracted = 0;
        const entries = Object.values(await zip.entries());
        zip.on('extract', (entry: any, file: any) => {
          numExtracted++;
          event.sender.send('download-progress', {
            percent: numExtracted / entries.length,
          });
        });
        await fs.mkdir(dir, { recursive: true });
        await zip.extract(null, dir);
      } finally {
        await zip.close();
      }
    } else {
      const command = `unzip -o "${APP_DIR}/${zipPath}" -d "${APP_DIR}/${outPath}"`;
      await execPromise(command);
    }
  } catch (e: any) {
    console.error('extract-zip error:', e);
    throw new Error('ZIP 해제 실패: ' + (e.message || e));
  }
});

ipcMain.handle('lookup-tag', (event, word) => {
  return tagMap.get(word);
});

let localAIRunning = false;
let localAIProcess: ReturnType<typeof spawn> | null = null;

function killLocalAI() {
  if (localAIProcess && localAIProcess.pid) {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/F', '/T', '/PID', localAIProcess.pid.toString()], { windowsHide: true });
    } else {
      localAIProcess.kill();
    }
    localAIProcess = null;
    localAIRunning = false;
  }
}

const net = require('net');

function checkPort(port: number) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false); // Port is in use
      } else {
        reject(err); // Other errors
      }
    });

    server.once('listening', () => {
      server.close(() => {
        resolve(true); // Port is available
      });
    });

    server.listen(port);
  });
}

async function findAvailablePort(startPort: number) {
  let port = startPort;
  while (!(await checkPort(port))) {
    port++;
  }
  return port;
}

async function spawnLocalAI() {
  localAI.port = await findAvailablePort(5353);
  localAIProcess = spawn(
    path.join(APP_DIR, 'localai', 'localai'),
    ['--port', localAI.port.toString()],
    {
      stdio: 'inherit',
      windowsHide: true,
    },
  );
  localAIRunning = true;
  localAIProcess.on('close', (code) => {
    localAIRunning = false;
    localAIProcess = null;
  });
}

ipcMain.handle('spawn-local-ai', async (event) => {
  if (!localAIRunning) {
    await spawnLocalAI();
  }
});

ipcMain.handle('is-local-ai-running', async (event) => {
  return localAIRunning;
});

const qualityMap: any = {
  low: 320,
  normal: 640,
  high: 1024,
  veryhigh: 1536,
  veryveryhigh: 2048,
};

ipcMain.handle('remove-bg', async (event, inputImageBase64, outputPath) => {
  try {
    outputPath = path.join(APP_DIR, outputPath);
    await localAI.runModel(
      inputImageBase64,
      qualityMap[config.removeBgQuality ?? 'normal'],
      outputPath,
    );
  } catch (e: any) {
    console.error('remove-bg error:', e);
    throw new Error('배경 제거 실패: ' + (e.message || e));
  }
});

if (process.env.NODE_ENV === 'production') {
  const sourceMapSupport = require('source-map-support');
  sourceMapSupport.install();
}

const isDebug =
  process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true';

if (isDebug) {
  require('electron-debug')({ showDevTools: true });
}

const installExtensions = async () => {
  const installer = require('electron-devtools-installer');
  const forceDownload = !!process.env.UPGRADE_EXTENSIONS;
  const extensions = ['REACT_DEVELOPER_TOOLS'];

  return installer
    .default(
      extensions.map((name) => installer[name]),
      forceDownload,
    )
    .catch(console.log);
};

const RESOURCES_PATH = app.isPackaged
  ? path.join(process.resourcesPath, 'assets')
  : path.join(__dirname, '../../assets');

app.commandLine.appendSwitch('remote-allow-origins', 'http://localhost:8315');

const getAssetPath = (...paths: string[]): string => {
  return path.join(RESOURCES_PATH, ...paths);
};

// ── 창 위치·크기 상태 저장 (이 PC 귀속) ──────────────────────────────────────
// config.json 과 별개 파일로 관리한다. 렌더러 setConfig 가 config 전체를 덮어써도
// 창 상태가 지워지지 않도록 하기 위함.
const WINDOW_STATE_FILE = path.join(DEFAULT_APP_DIR, 'window-state.json');

interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

function loadWindowState(): WindowState | null {
  try {
    const s = JSON.parse(fsSync.readFileSync(WINDOW_STATE_FILE, 'utf-8'));
    if (typeof s.width === 'number' && typeof s.height === 'number') {
      return s as WindowState;
    }
  } catch (e) {}
  return null;
}

// 저장된 창이 현재 연결된 디스플레이 중 하나에 최소한 걸쳐 있는지 확인
// (모니터 분리/해상도 변경 후 화면 밖으로 복원되는 것을 방지)
function isVisibleOnSomeDisplay(s: WindowState): boolean {
  if (typeof s.x !== 'number' || typeof s.y !== 'number') return false;
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return (
      s.x! < a.x + a.width &&
      s.x! + s.width > a.x &&
      s.y! < a.y + a.height &&
      s.y! + s.height > a.y
    );
  });
}

function saveWindowState(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const isMaximized = mainWindow.isMaximized();
    // 최대화 상태에선 getBounds 가 최대화 크기를 주므로, 복원 시 이전 크기로 돌아가도록
    // 최대화 이전의 일반 크기(getNormalBounds)를 저장한다.
    const b = mainWindow.getNormalBounds();
    const state: WindowState = {
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      isMaximized,
    };
    const tmp = path.join(DEFAULT_APP_DIR, uuidv4());
    fsSync.writeFileSync(tmp, JSON.stringify(state), 'utf-8');
    fsSync.renameSync(tmp, WINDOW_STATE_FILE);
  } catch (e) {
    console.error('window state save failed', e);
  }
}

let saveWindowStateTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSaveWindowState(): void {
  if (saveWindowStateTimer) clearTimeout(saveWindowStateTimer);
  saveWindowStateTimer = setTimeout(saveWindowState, 400);
}

// 보조 창(secondary) 위치 계산 — 기준 창(포커스된 창 → 주 창 → 첫 창)에서
// +32,+32 캐스케이드하되, 화면(workArea) 밖으로 나가지 않게 클램프한다. 보조 창은
// 상태를 저장/복원하지 않는다(주 창만 window-state.json 관리, W6 P0 §8).
function computeCascadeBounds(): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const OFFSET = 32;
  const ref =
    BrowserWindow.getFocusedWindow() ??
    (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null) ??
    BrowserWindow.getAllWindows()[0] ??
    null;
  const display = ref
    ? screen.getDisplayMatching(ref.getBounds())
    : screen.getPrimaryDisplay();
  const wa = display.workArea;
  const base = ref
    ? ref.getBounds()
    : { x: wa.x, y: wa.y, width: wa.width, height: wa.height };
  const width = Math.min(base.width, wa.width);
  const height = Math.min(base.height, wa.height);
  let x = base.x + OFFSET;
  let y = base.y + OFFSET;
  // 우/하단으로 넘치면 workArea 안으로 되돌린다.
  if (x + width > wa.x + wa.width) x = wa.x;
  if (y + height > wa.y + wa.height) y = wa.y;
  return { x, y, width, height };
}

// 창 생성 — 재사용 가능(주 창·보조 창 공용). secondary=true 면 상태 저장/복원 없이
// 캐스케이드 위치로 열고, mainWindow 포인터에 담지 않는다(주 창은 유지).
// initialProject: "새 창에서 열기"로 전달된 프로젝트 — 새 창이 부팅 후 가져가 연다.
const createWindow = async (opts?: {
  secondary?: boolean;
  initialProject?: string;
}) => {
  const secondary = opts?.secondary === true;
  if (isDebug && !secondary) {
    await installExtensions();
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  const savedState = secondary ? null : loadWindowState();
  const useSavedPos = savedState != null && isVisibleOnSomeDisplay(savedState);
  const cascade = secondary ? computeCascadeBounds() : null;

  const win = new BrowserWindow({
    show: false,
    width: cascade?.width ?? savedState?.width ?? width,
    height: cascade?.height ?? savedState?.height ?? height,
    ...(cascade
      ? { x: cascade.x, y: cascade.y }
      : useSavedPos
        ? { x: savedState!.x, y: savedState!.y }
        : {}),
    minWidth: 1024,
    minHeight: 728,
    frame: false,
    icon: getAssetPath('icon.png'),
    webPreferences: {
      webviewTag: true,
      preload: app.isPackaged
        ? path.join(__dirname, 'preload.js')
        : path.join(__dirname, '../../.erb/dll/preload.js'),
    },
  });

  // 주 창만 전역 포인터에 담는다(상태 저장·포커스 기준).
  if (!secondary) {
    mainWindow = win;
    // 최초 실행(저장된 상태 없음)엔 최대화로 시작 — 과거엔 workArea 크기의 어중간한 창이었다.
    // 이전에 최대화 상태로 종료했다면 그대로 최대화 복원.
    if (!savedState || savedState.isMaximized) {
      win.maximize();
    }
    // 사용자가 창을 옮기거나 크기를 바꾸면(그리고 최대화 토글 시) 상태를 저장한다.
    // 주 창만 — 보조 창은 상태를 저장하지 않는다.
    win.on('resize', scheduleSaveWindowState);
    win.on('move', scheduleSaveWindowState);
    win.on('maximize', saveWindowState);
    win.on('unmaximize', saveWindowState);
  }

  contextMenu({
    window: win,
    // danbooru 태그는 일반 구글 검색이 무의미하므로 기본 "구글 검색" 항목을 끈다.
    showSearchWithGoogle: false,
    // 기본 메뉴 항목 한글화
    labels: {
      cut: '잘라내기',
      copy: '복사',
      paste: '붙여넣기',
      selectAll: '전체 선택',
      copyLink: '링크 주소 복사',
      copyImage: '이미지 복사',
      copyImageAddress: '이미지 주소 복사',
      saveImage: '이미지 저장',
      saveImageAs: '다른 이름으로 이미지 저장',
      inspect: '검사',
      learnSpelling: '맞춤법에 추가',
      lookUpSelection: '“{selection}” 찾아보기',
    },
    prepend: (defaultActions, params, browserWindow) => {
      console.log(params.mediaType);
      console.log(params.altText);
      console.log(params.titleText);
      // 콜백의 browserWindow(우클릭한 창)를 BrowserWindow 로 좁혀 그 창에만 send 한다.
      // (contextMenu 를 창마다 등록하므로 이 창 === 우클릭한 창)
      const bw = browserWindow as BrowserWindow;
      // 텍스트 드래그 선택 시: danbooru 태그 검색 (앱 내 웹 검색 탭으로 전달)
      if (
        params.selectionText &&
        params.selectionText.trim() &&
        params.mediaType !== 'image'
      ) {
        return [
          {
            label: 'Danbooru로 검색',
            click: () => {
              // 우클릭한 그 창으로 전달(멀티 윈도우 안전) — 콜백의 browserWindow 사용.
              bw?.webContents.send(
                'danbooru-search',
                params.selectionText,
              );
            },
          },
        ];
      }
      const handleContextAlt = (altContext: any) => {
        if (altContext.type === 'image') {
          return [
            {
              label: '해당 이미지를 다른 씬으로 복사',
              click: () => {
                bw?.webContents.send('copy-image', altContext);
              },
            },
            {
              label: '해당 이미지를 복제',
              click: () => {
                bw?.webContents.send('duplicate-image', altContext);
              },
            },
          ];
        } else {
          return [
            {
              label: '해당 씬을 맨위로 이동',
              click: () => {
                bw?.webContents.send('move-scene-front', altContext);
              },
            },
            {
              label: '해당 씬을 맨뒤로 이동',
              click: () => {
                bw?.webContents.send('move-scene-back', altContext);
              },
            },
            {
              label: '해당 씬을 복제',
              click: () => {
                bw?.webContents.send('duplicate-scene', altContext);
              },
            },
          ];
        }
      };
      if (params.mediaType === 'image' && params.altText) {
        try {
          const altContext = JSON.parse(params.altText);
          return handleContextAlt(altContext);
        } catch (e) {
          console.error(e);
        }
      }
      if (params.mediaType === 'none' && params.titleText) {
        try {
          const altContext = JSON.parse(params.titleText);
          return handleContextAlt(altContext);
        } catch (e) {
          console.error(e);
        }
      }
      return [];
    },
  });

  win.loadURL(resolveHtmlPath('index.html'));

  win.on('ready-to-show', () => {
    if (process.env.START_MINIMIZED) {
      win.minimize();
    } else {
      win.show();
    }
  });

  // webContents.id 는 생성 시점에 캡처해 둔다 — 'closed' 는 창이 파괴된 뒤 발화하므로
  // 핸들러 안에서 win.webContents 에 접근하면 "Object has been destroyed" 가 난다.
  const wcId = win.webContents.id;

  // "새 창에서 열기" 초기 프로젝트 예치 — 이 창의 렌더러가 부팅 후 take-initial-project 로 가져간다.
  if (opts?.initialProject) {
    pendingInitialProject.set(wcId, opts.initialProject);
  }

  win.on('close', (e) => {
    // 주 창만 닫히기 직전의 위치·크기·최대화 상태를 저장한다(다음 실행 복원용).
    if (!secondary) saveWindowState();
    // 저장이 끝나기 전이면 창 닫기를 막고 렌더러에 저장을 위임한다(창별 게이트).
    // 렌더러가 저장을 마치면 invoke('close')로 이 창의 게이트를 열고 다시 닫는다.
    if (!saveCompletedByWc.get(wcId)) {
      e.preventDefault();
      win.webContents.send('close');
    }
  });

  win.on('closed', () => {
    // 창별 종료 게이트 정리 (캡처한 wcId 사용 — 이 시점의 win 은 이미 파괴됨).
    saveCompletedByWc.delete(wcId);
    // 이 창이 보유하던 프로젝트 배타 락 자동 해제 (W6 P1).
    for (const [name, owner] of projectLocks) {
      if (owner === wcId) projectLocks.delete(name);
    }
    pendingInitialProject.delete(wcId);
    if (!secondary) mainWindow = null;
  });

  const menuBuilder = new MenuBuilder(win);
  menuBuilder.buildMenu();
  win.setMenu(null);

  // Open urls in the user's browser
  win.webContents.setWindowOpenHandler((edata) => {
    shell.openExternal(edata.url);
    return { action: 'deny' };
  });

  // Remove this if your app does not use auto updates
  // eslint-disable-next-line
  // new AppUpdater();
};

// 새 창 열기 IPC — 보조 창 규칙(캐스케이드, 상태 저장 없음)으로 생성한다(W6 P0 §10).
// projectName 이 오면 "새 창에서 열기" — 새 창이 부팅 후 그 프로젝트를 연다(W6 P1).
ipcMain.handle('open-new-window', async (event, projectName?: string) => {
  await createWindow({ secondary: true, initialProject: projectName });
});

const dataDir = isDebug
  ? path.join(webpackPaths.appPath, 'data')
  : path.join(__dirname, '../../data');

const localAI = new LocalAIService('http://127.0.0.1');

async function init() {
  await fs.mkdir(DEFAULT_APP_DIR, { recursive: true });
  try {
    config = JSON.parse(
      await fs.readFile(path.join(DEFAULT_APP_DIR, 'config.json'), 'utf-8'),
    );
  } catch (e) {}
  const dbCsvContent = await fs.readFile(path.join(dataDir, 'db.csv'), 'utf-8');
  databases.tagDBId = native.createDB('danbooru');
  native.loadDB(databases.tagDBId, dbCsvContent);
  databases.pieceDBId = native.createDB('pieces');
  dbCsvContent.split('\n').forEach((x: string) => {
    const comps: string[] = x.split(',');
    if (comps.length !== 4) return;
    tagMap.set(comps[0], {
      word: comps[0],
      normalized: comps[0],
      freq: parseInt(comps[2]),
      category: parseInt(comps[1]),
      redirect: comps[3],
      priority: 0,
    });
  });
  await initFolder();
}

// 사용자 지정 저장 경로(config.saveLocation) 접근/쓰기 불가로 기본 경로 폴백이
// 일어났을 때 채워진다. 렌더러가 부팅 후 get-boot-warnings 로 조회해 사용자에게
// 안내한다(설정에서 경로 재지정 유도). 폴백이 없으면 null.
let saveLocationFallback: { attempted: string; code: string } | null = null;

async function initFolder() {
  if (config.saveLocation) {
    APP_DIR = config.saveLocation;
  }
  try {
    await fs.mkdir(APP_DIR, { recursive: true });
    // mkdir 성공이 곧 쓰기 가능을 뜻하진 않는다(읽기전용 볼륨·ACL 제한). 실제 파일
    // 쓰기까지 확인해야 권한 없는 경로를 정확히 걸러낸다.
    const probe = path.join(APP_DIR, '.' + uuidv4() + '.wtest');
    await fs.writeFile(probe, 'ok', 'utf-8');
    await fs.rm(probe).catch(() => {});
  } catch (e: any) {
    // 사용자 지정 저장 경로에 접근/쓰기 불가 → 기본 경로로 폴백해 최소한 앱은 뜨게 한다.
    // 이 폴백이 없으면 잘못된 경로 하나로 initFolder 가 throw → createWindow 이전에
    // 부팅이 죽고 single-instance 락만 쥔 채 무반응(벽돌)이 된다. config.saveLocation
    // 은 일부러 건드리지 않는다 — 사용자가 UI 에서 직접 고치거나, 그 경로가 다시
    // 유효해지면(외장 재연결 등) 그대로 복구되도록.
    if (config.saveLocation && APP_DIR !== DEFAULT_APP_DIR) {
      saveLocationFallback = {
        attempted: config.saveLocation,
        code: String(e?.code || e?.message || e),
      };
      APP_DIR = DEFAULT_APP_DIR;
      await fs.mkdir(APP_DIR, { recursive: true });
    } else {
      // 기본 경로 자체가 실패면 더 손쓸 수 없다 — 원래대로 throw.
      throw e;
    }
  }
  // 원자 쓰기(tmp+rename)가 쓰기와 rename 사이 강제 종료로 남긴 고아 tmp 파일 정리.
  // tmp 는 항상 uuid v4 파일명(확장자 없음)이라 정확히 그 형태만 지운다.
  const uuidName = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  for (const dir of new Set([APP_DIR, DEFAULT_APP_DIR])) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.isFile() && uuidName.test(ent.name)) {
          await fs.rm(path.join(dir, ent.name)).catch(() => {});
        }
      }
    } catch (e) {}
  }
  if (config.refreshImage) {
    const handle = chokidar.watch(APP_DIR, {
      persistent: true,
      ignoreInitial: true,
      usePolling: false,
    });
    handle.on('change', async (changedPath: string) => {
      let curPath = path.relative(APP_DIR, changedPath);
      const comps = curPath.split(path.sep);
      if (comps.length === 0) return;
      if (comps[0] === '.') {
        comps.shift();
      }
      if (
        comps[0] === 'outs' ||
        comps[0] === 'inpaints' ||
        comps[0] === 'workspace'
      ) {
        // 저장 경로 전역 감시 — 어느 창이 볼지 알 수 없으니 전 창 브로드캐스트.
        broadcast('image-changed', comps.join('/'));
      }
    });
  }
}

const initPromise = init();

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    // 살아있는 아무 창(주 창 우선)을 복원·포커스한다(멀티 윈도우).
    focusAnyWindow();
  });
  /**
   * Add event listeners...
   */

  app.on('before-quit', () => {
    killLocalAI();
  });

  app.on('window-all-closed', () => {
    // Respect the OSX convention of having the application in memory even
    // after all windows have been closed
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app
    .whenReady()
    .then(async () => {
      await initPromise;
      createWindow();
      app.on('activate', () => {
        // On macOS it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        // 창이 하나도 없으면 새 주 창을 만든다.
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
        // APP_DIR = app.getPath('userData');
      });
    })
    .catch(console.log);
}
