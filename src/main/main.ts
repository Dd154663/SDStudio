/* eslint global-require: off, no-console: off, promise/always-return: off */

/**
 * This module executes inside of electron's main process. You can start
 * electron renderer process from here and communicate with the other processes
 * through IPC.
 *
 * When running `npm run build` or `npm run build:main`, this file is compiled to
 * `./src/main.js` using webpack. This gives us some performance wins.
 */
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
const ExifReader = require('exifreader');
const native = require('sdsnative');
const { exiftool } = require('exiftool-vendored');
const chokidar = require('chokidar');
import webpackPaths from '../../.erb/configs/webpack.paths';
import { Config } from './config';
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

let mainWindow: BrowserWindow | null = null;
let tagMap: Map<string, any> = new Map();

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

let saveCompleted = false;
let config: Config = {};

ipcMain.handle('window-minimize', () => {
  mainWindow?.minimize();
});
ipcMain.handle('window-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
ipcMain.handle('window-close', () => {
  mainWindow?.close();
});
ipcMain.handle('window-is-maximized', () => {
  return mainWindow?.isMaximized() ?? false;
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
});

ipcMain.handle('get-version', async (event) => {
  return app.getVersion();
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
  const dir = path.dirname(APP_DIR + '/' + outPath);
  files = files.map((x: any) => ({
    name: x.name,
    path: APP_DIR + '/' + x.path,
  }));
  await fs.mkdir(dir, { recursive: true });
  const pack = tarStream.pack();
  const writeStream = fsSync.createWriteStream(APP_DIR + '/' + outPath);
  pack.pipe(writeStream);
  try {
    let done = 0;
    for (const file of files) {
      mainWindow!.webContents.send('zip-progress', {
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
    mainWindow!.webContents.send('zip-progress', {
      done: files.length,
      total: files.length,
    });
    pack.finalize();
  } catch (e: any) {
    console.error('zip-files error:', e);
    pack.destroy();
    writeStream.destroy();
    throw new Error('압축 중 오류: ' + (e.message || e));
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

// 생성 이미지 PNG → WebP 변환 (NAI 프롬프트 메타데이터를 EXIF ImageDescription 으로 이월).
// 원본 PNG tEXt 'Comment'(NAI 생성정보 JSON)를 추출해 webp EXIF 에 박는다.
ipcMain.handle('convert-to-webp', async (event, srcRel, destRel, quality) => {
  const srcAbs = APP_DIR + '/' + srcRel;
  const destAbs = APP_DIR + '/' + destRel;
  const buf = await fs.readFile(srcAbs);
  let comment: string | null = null;
  try {
    const tags = ExifReader.load(buf);
    const c = tags['Comment'];
    if (c) comment = (c.value ?? c.description ?? '').toString() || null;
  } catch (e) {
    // 메타데이터 없음 — EXIF 없이 변환 진행
  }
  await fs.mkdir(path.dirname(destAbs), { recursive: true });
  let pipeline = sharp(buf).webp({ quality: quality ?? 80 });
  if (comment) {
    pipeline = pipeline.withMetadata({
      exif: { IFD0: { ImageDescription: comment } },
    });
  }
  await pipeline.toFile(destAbs);
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
  saveCompleted = true;
  mainWindow!.close();
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
  const options = {
    directory: dest,
    saveAs: false,
    openFolderWhenDone: false,
    filename,
    onProgress: (progress: any) => {
      mainWindow!.webContents.send('download-progress', progress);
    },
  };
  try {
    await electronDL.download(mainWindow!, url, options);
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
  async (event, { inputPath, outputPath, maxWidth, maxHeight, optimize }) => {
    try {
      inputPath = APP_DIR + '/' + inputPath;
      outputPath = APP_DIR + '/' + outputPath;
      const dir = path.dirname(outputPath);
      await fs.mkdir(dir, { recursive: true });
      let instance = sharp(inputPath).resize(maxWidth, maxHeight, {
        fit: sharp.fit.inside,
        withoutEnlargement: true,
      });
      if (optimize === ImageOptimizeMethod.LOSSY) {
        instance = instance.webp({
          quality: 80,
          lossless: false,
        });
      }
      if (optimize === ImageOptimizeMethod.LOSSLESS) {
        instance = instance.webp({
          lossless: true,
        });
      }
      if (optimize === ImageOptimizeMethod.AVIF) {
        instance = instance.avif({
          quality: 50,
          effort: 4,
        });
      }
      await instance.toFile(outputPath);
    } catch (e: any) {
      console.error('resize-image error:', e);
      throw new Error('이미지 리사이즈 실패: ' + (e.message || e));
    }
  },
);

ipcMain.handle('select-dir', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
  });
  if (canceled) {
    return;
  } else {
    return filePaths[0];
  }
});

ipcMain.handle('select-file', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'],
  });
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
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow!, dialogOptions);
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
                  mainWindow!.webContents.send(
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
          mainWindow!.webContents.send(
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
          mainWindow!.webContents.send('download-progress', {
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

const createWindow = async () => {
  if (isDebug) {
    await installExtensions();
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  mainWindow = new BrowserWindow({
    show: false,
    width: width,
    height: height,
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

  contextMenu({
    window: mainWindow,
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
              mainWindow!.webContents.send(
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
                mainWindow!.webContents.send('copy-image', altContext);
              },
            },
            {
              label: '해당 이미지를 복제',
              click: () => {
                mainWindow!.webContents.send('duplicate-image', altContext);
              },
            },
          ];
        } else {
          return [
            {
              label: '해당 씬을 맨위로 이동',
              click: () => {
                mainWindow!.webContents.send('move-scene-front', altContext);
              },
            },
            {
              label: '해당 씬을 맨뒤로 이동',
              click: () => {
                mainWindow!.webContents.send('move-scene-back', altContext);
              },
            },
            {
              label: '해당 씬을 복제',
              click: () => {
                mainWindow!.webContents.send('duplicate-scene', altContext);
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

  mainWindow.loadURL(resolveHtmlPath('index.html'));

  mainWindow.on('ready-to-show', () => {
    if (!mainWindow) {
      throw new Error('"mainWindow" is not defined');
    }
    if (process.env.START_MINIMIZED) {
      mainWindow.minimize();
    } else {
      mainWindow.show();
    }
  });

  mainWindow.on('close', (e) => {
    // 저장이 끝나기 전이면 창 닫기를 막고 렌더러에 저장을 위임한다.
    // 렌더러가 저장을 마치면 invoke('close')로 saveCompleted=true 후 다시 닫는다.
    if (!saveCompleted) {
      e.preventDefault();
      mainWindow!.webContents.send('close');
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const menuBuilder = new MenuBuilder(mainWindow);
  menuBuilder.buildMenu();
  mainWindow.setMenu(null);

  // Open urls in the user's browser
  mainWindow.webContents.setWindowOpenHandler((edata) => {
    shell.openExternal(edata.url);
    return { action: 'deny' };
  });

  // Remove this if your app does not use auto updates
  // eslint-disable-next-line
  // new AppUpdater();
};

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

async function initFolder() {
  if (config.saveLocation) {
    APP_DIR = config.saveLocation;
  }
  await fs.mkdir(APP_DIR, { recursive: true });
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
      if (comps[0] === 'outs' || comps[0] === 'inpaints') {
        mainWindow!.webContents.send('image-changed', comps.join('/'));
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
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
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
        if (mainWindow === null) createWindow();
        // APP_DIR = app.getPath('userData');
      });
    })
    .catch(console.log);
}
