import { Config } from '../../main/config';
import {
  EncodeVibeImageInput,
  ImageAugmentInput,
  ImageGenInput,
  ImageGenService,
  LoginValidity,
  ModelVersion,
} from './imageGen';
import {
  Backend,
  FileEntry,
  ImageOptimizeMethod,
  ResizeImageInput,
} from '../backend';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import {
  FileOpener,
  FileOpenerOptions,
} from '@capacitor-community/file-opener';
import { Buffer } from 'buffer';
import { v4 as uuidv4 } from 'uuid';
import Pica from 'pica';
import { NovelAiFetcher, NovelAiImageGenService } from './genVendors/nai';
import { createNaiApiError } from './genVendors/naiErrors';
import { assertDeletableDirPath } from './dataPathGuard';
import FetchService from './fecthService';
import JSZip from 'jszip';
import { BackgroundMode } from '@anuradev/capacitor-background-mode';
import { App as CapacitorApp } from '@capacitor/app';
import { TagDB } from './tagDB';
import { isV5ModelVersion } from './genVendors/naiModelCapabilities';
// @ts-ignore
import DBCSV from '../../../assets/db.txt';
// @ts-ignore
import V5DBCSV from '../../../assets/db_v5.txt';
import packageInfo from '../../../package.json';
import ZipService from './zipService';
import { FilePicker } from '@capawesome/capacitor-file-picker';
import { Share } from '@capacitor/share';
import { Clipboard } from '@capacitor/clipboard';
import { WordTag } from '../models/Tags';

const APP_DIR = '.SDStudio';
let config: Config = {};
let configLoaded = false;
let configLoadFailed = false; // 읽기 실패(권한 등) — 게이트 통과 후 재읽기 대상
let configLoadPromise: Promise<void> | null = null;
const pica = new Pica();
type TagDatabaseKind = 'legacy' | 'v5';

function extname(filename: string): string {
  const parts = filename.split('.');
  return parts[parts.length - 1];
}

// Function to get the MIME type based on file extension
function getMimeType(filePath: any) {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case 'jpeg':
    case 'jpg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'pdf':
      return 'application/pdf';
    case 'txt':
      return 'text/plain';
    case 'html':
      return 'text/html';
    case 'zip':
      return 'application/zip';
    case 'tar':
      return 'application/x-tar';
    default:
      return 'vnd.android.document/directory';
  }
}

function getDirName(filePath: string): string {
  const parts = filePath.split('/');
  parts.pop();
  return parts.join('/');
}

class AndroidFetcher implements NovelAiFetcher {
  async fetchArrayBuffer(
    url: string,
    body: any,
    headers: any,
  ): Promise<ArrayBuffer> {
    const controller = new AbortController();
    const response = await FetchService.fetchData({
      url: url,
      body: JSON.stringify(body),
      headers: JSON.stringify(headers),
    });
    function base64ToArrayBuffer(base64: string) {
      // Decode the base64 string
      const binaryString = atob(base64);

      // Create a new ArrayBuffer with the same length as the binary string
      const len = binaryString.length;
      const bytes = new Uint8Array(len);

      // Write the decoded binary string to the array buffer
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      return bytes.buffer;
    }
    if (response.status < 200 || response.status >= 300) {
      let detail = '';
      try {
        detail = new TextDecoder().decode(
          base64ToArrayBuffer(response.data || ''),
        );
      } catch (_) {}
      throw createNaiApiError(
        response.status,
        detail,
        response.correlationId,
      );
    }
    return base64ToArrayBuffer(response.data);
  }
}

export class AndroidBackend extends Backend {
  private imageGenService: ImageGenService;
  private tagDBId?: number;
  private piecesDBId?: number;
  private tagMap: Map<string, WordTag>;
  private activeTagDatabase?: TagDatabaseKind;
  private tagDatabaseLoadPromise: Promise<void> = Promise.resolve();
  constructor() {
    super();
    this.tagMap = new Map();
    Filesystem.mkdir({
      path: APP_DIR,
      recursive: true,
      directory: Directory.Documents,
    });
    this.imageGenService = new NovelAiImageGenService(new AndroidFetcher());
    configLoadPromise = (async () => {
      try {
        const data = await Filesystem.readFile({
          path: `${APP_DIR}/config.json`,
          directory: Directory.Documents,
          encoding: Encoding.UTF8,
        });
        config = JSON.parse(data.data.toString());
      } catch {
        // 파일 없음(첫 실행)일 수도, 저장소 권한 미허용일 수도 있다.
        // 후자는 게이트(storagePermissionGate)가 권한 확보 후 재읽기로 복구.
        configLoadFailed = true;
      }
      configLoaded = true;
    })();
    // 원자 쓰기(tmp+rename)가 쓰기와 rename 사이 강제 종료로 남긴 고아 tmp 정리.
    // tmp 는 항상 uuid v4 파일명(확장자 없음)이라 정확히 그 형태만 지운다. (비차단)
    (async () => {
      const uuidName =
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      try {
        const { files } = await Filesystem.readdir({
          path: APP_DIR,
          directory: Directory.Documents,
        });
        for (const f of files) {
          if (f.type === 'file' && uuidName.test(f.name)) {
            await Filesystem.deleteFile({
              path: `${APP_DIR}/${f.name}`,
              directory: Directory.Documents,
            }).catch(() => {});
          }
        }
      } catch (e) {}
    })();
    (async () => {
      // 알림 권한·배터리 최적화 제외는 여기서 자동 요청하지 않는다 —
      // 부팅 완료 후 안내 모달(models/mobilePermissions.ts)에서 사용자가
      // '확인'을 눌렀을 때만 시스템 창을 연다. (로딩과 겹쳐 자동 노출 →
      // 무심코 터치로 스킵 → 알림 권한 2회 거부 시 영구 차단되는 문제 방지)
      // 포그라운드 서비스 설정 + enable. 최초 1회는 안내용 기본 문구 포함.
      await this.ensureBackgroundMode(true);
      try {
        await BackgroundMode.disableWebViewOptimizations();
      } catch (e) {}
    })();

    // 견고화: 앱이 포그라운드로 돌아올 때마다 백그라운드 모드를 재적용한다.
    // 콜드 스타트 직후의 enable()/설정은 다음 백그라운드 전환에 안정적으로
    // 반영되지 않아 알림이 뜨지 않는 문제가 있었다. resume 마다 재적용하면
    // 다음 백그라운드 진입 직전에 항상 신선한 상태가 보장된다. (권한 안내
    // 모달로 알림 권한이 부팅 뒤 늦게 허용되는 경우도 이 경로가 흡수한다)
    // (text 는 생략 → 진행 중 생성 알림 문구를 덮어쓰지 않음)
    try {
      CapacitorApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive) {
          this.ensureBackgroundMode(false).catch(() => {});
        }
      });
    } catch (e) {}

    this.tagDatabaseLoadPromise = (async () => {
      this.tagDBId = (await TagDB.createDB({ name: 'tags' })).id;
      this.piecesDBId = (await TagDB.createDB({ name: 'pieces' })).id;
      if (configLoadPromise) await configLoadPromise;
      await this.applyTagDatabase(
        this.tagDatabaseKindForModel(config.modelVersion),
      );
    })();
  }

  private tagDatabaseKindForModel(
    modelVersion?: ModelVersion,
  ): TagDatabaseKind {
    return isV5ModelVersion(modelVersion ?? ModelVersion.V4_5)
      ? 'v5'
      : 'legacy';
  }

  private async applyTagDatabase(kind: TagDatabaseKind): Promise<void> {
    const csv = kind === 'v5' ? V5DBCSV : DBCSV;
    await TagDB.loadDB({ id: this.tagDBId!, path: csv });

    const nextMap = new Map<string, WordTag>();
    csv.split('\n').forEach((line: string) => {
      const comps = line.split(',');
      if (comps.length !== 4) return;
      nextMap.set(comps[0], {
        word: comps[0],
        normalized: comps[0],
        freq: parseInt(comps[2], 10),
        category: parseInt(comps[1], 10),
        redirect: comps[3],
        priority: 0,
      });
    });
    this.tagMap = nextMap;
    this.activeTagDatabase = kind;
  }

  private loadTagDatabase(modelVersion?: ModelVersion): Promise<void> {
    const kind = this.tagDatabaseKindForModel(modelVersion);
    const previous = this.tagDatabaseLoadPromise.catch(() => undefined);
    this.tagDatabaseLoadPromise = previous.then(async () => {
      if (this.activeTagDatabase === kind) return;
      await this.applyTagDatabase(kind);
    });
    return this.tagDatabaseLoadPromise;
  }

  async getConfig(): Promise<Config> {
    if (!configLoaded && configLoadPromise) {
      await configLoadPromise;
    }
    return config;
  }

  // 생성자 시점 config 읽기가 실패(저장소 권한 미허용 등)했다면 재읽기.
  // storagePermissionGate 가 권한 확보 직후 호출한다 — 빈 config 로 세션이
  // 진행돼 setConfig 가 기존 설정을 덮어쓰는 유실을 막는다.
  async reloadConfigIfFailed(): Promise<void> {
    if (configLoadPromise) await configLoadPromise;
    if (!configLoadFailed) return;
    try {
      const data = await Filesystem.readFile({
        path: `${APP_DIR}/config.json`,
        directory: Directory.Documents,
        encoding: Encoding.UTF8,
      });
      config = JSON.parse(data.data.toString());
      configLoadFailed = false;
    } catch {
      // 진짜 파일 없음(첫 실행) — 빈 config 그대로 진행
      return;
    }
    await this.loadTagDatabase(config.modelVersion);
  }

  async setConfig(newConfig: Config): Promise<void> {
    // 저장된 모델과 자동완성 DB가 어긋나지 않도록 전환을 먼저 완료한다.
    await this.loadTagDatabase(newConfig.modelVersion);
    config = newConfig;
    // writeFile 경유 = tmp+rename(+.bak) 원자 쓰기 — 직접 쓰기는 강제 종료 시
    // 파일이 반쯤 쓰여 파손되고, 로드가 조용히 실패해 설정 전체가 초기화된다.
    await this.writeFile('config.json', JSON.stringify(config));
    this.imageGenService.invalidateConfigCache?.();
  }

  // 포그라운드 서비스 설정 적용 + enable. (resume/시작/생성 시 반복 호출되어 자가복구)
  // includeText=true 면 안내용 기본 문구도 설정(최초 1회). false 면 현재 진행 문구 보존.
  private async ensureBackgroundMode(includeText: boolean): Promise<void> {
    try {
      const settings: any = {
        channelName: '백그라운드 생성',
        channelDescription: '이미지 생성 진행 상태',
        resume: true,
        // 주의: 이 플러그인의 silent=true 는 "알림 자체를 표시하지 않음"을 의미한다.
        // (소리 없음이 아님 — 채널은 IMPORTANCE_LOW 라 어차피 무음)
        // 백그라운드 알림이 보여야 하므로 반드시 false.
        silent: false,
        hidden: false,
        showWhen: false,
      };
      if (includeText) {
        settings.title = 'SDStudio';
        settings.text = '백그라운드 실행 준비됨';
      }
      await BackgroundMode.setSettings(settings);
    } catch (e) {}
    try {
      await BackgroundMode.enable();
    } catch (e) {}
  }

  // 포그라운드 서비스 알림 내용 갱신 (생성 진행 상태 표시)
  async updateBackgroundNotification(title: string, text: string): Promise<void> {
    try {
      // 생성 시작 시점에 백그라운드 모드가 확실히 활성화되도록 자가복구(enable 포함).
      // (2번째 실행 이후 알림 미동작 대비 — 어느 경로로든 생성 직전에 establish 보장)
      await BackgroundMode.setSettings({ title, text, silent: false });
      await BackgroundMode.enable();
    } catch (e) {}
  }

  async getVersion(): Promise<string> {
    return packageInfo.version;
  }

  async openWebPage(url: string): Promise<void> {
    window.open(url);
  }

  async generateImage(arg: ImageGenInput): Promise<void> {
    const token = await this.readFile('TOKEN.txt');
    const res = await this.imageGenService.generateImage(token, arg);
    await this.writeDataFile(arg.outputFilePath, res);
  }

  async augmentImage(arg: ImageAugmentInput): Promise<void> {
    const token = await this.readFile('TOKEN.txt');
    const res = await this.imageGenService.augmentImage(token, arg);
    await this.writeDataFile(arg.outputFilePath, res);
  }

  async getRemainCredits(): Promise<number> {
    const token = await this.readFile('TOKEN.txt');
    return await this.imageGenService.getRemainCredits(token);
  }

  async getOpusUsageStatus() {
    const token = await this.readFile('TOKEN.txt');
    return await this.imageGenService.getOpusUsageStatus(token);
  }

  async getOpusUsageStatusForToken(token: string) {
    return await this.imageGenService.getOpusUsageStatus(token);
  }

  async login(email: string, password: string): Promise<void> {
    const token = await this.imageGenService.login(email, password);
    await this.writeFile('TOKEN.txt', token.accessToken);
  }

  async loginWithToken(token: string): Promise<void> {
    await this.writeFile('TOKEN.txt', token);
  }

  async validateToken(token: string): Promise<LoginValidity> {
    return await this.imageGenService.validateToken(token);
  }

  async validateLogin(): Promise<LoginValidity> {
    let token: string;
    try {
      token = await this.readFile('TOKEN.txt');
    } catch (e) {
      return 'invalid'; // 토큰 파일 없음 → 로그아웃
    }
    return await this.imageGenService.validateToken(token);
  }

  async readLoginToken(): Promise<string | undefined> {
    try {
      const token = (await this.readFile('TOKEN.txt')).trim();
      return token || undefined;
    } catch (e) {
      if (this.isNotFoundError(e)) return undefined;
      throw e;
    }
  }

  async readTokenProfileData(): Promise<string | undefined> {
    try {
      return await this.readFile('TOKEN_PROFILES.json');
    } catch (e) {
      if (!this.isNotFoundError(e)) throw e;
      // 원자 교체 도중 앱이 종료돼 본문만 사라진 경우 직전 백업으로 복구한다.
      try {
        return await this.readFile('TOKEN_PROFILES.json.bak');
      } catch (bakError) {
        if (this.isNotFoundError(bakError)) return undefined;
        throw bakError;
      }
    }
  }

  async writeTokenProfileData(data: string): Promise<void> {
    await this.writeFile('TOKEN_PROFILES.json', data);
    // 정상 저장 뒤에는 삭제된 토큰이 과거 .bak 에 장기 잔류하지 않게 정리한다.
    try {
      await this.deleteFile('TOKEN_PROFILES.json.bak');
    } catch (e) {}
  }

  async encodeVibeImage(arg: EncodeVibeImageInput): Promise<string> {
    const token = await this.readFile('TOKEN.txt');
    const res = await this.imageGenService.encodeVibeImage(token, arg);
    return res;
  }

  async openPath(arg: string): Promise<void> {
    // 모바일은 OS 파일 탐색기 열기 미지원 — no-op (호출 UI 는 PC 전용 게이트)
  }

  async showFile(arg: string): Promise<void> {
    const { appState } = require('../models/AppService');
    const urlRes = await Filesystem.getUri({
      path: `${APP_DIR}/${arg}`,
      directory: Directory.Documents,
    });
    // 다운로드에 저장 vs 공유 선택
    const choice = await new Promise<string | undefined>((resolve) => {
      appState.pushDialog({
        type: 'select',
        text: '파일 내보내기가 완료되었습니다.',
        items: [
          { text: '다운로드에 저장', value: 'download' },
          { text: '공유', value: 'share' },
        ],
        callback: (value?: string) => resolve(value),
        onCancel: () => resolve(undefined),
      });
    });
    if (choice === 'download') {
      try {
        await this.copyToDownloads(arg);
      } catch (e: any) {
        appState.pushMessage('다운로드 폴더 복사 실패: ' + (e?.message || e));
      }
    } else if (choice === 'share') {
      await Share.share({ url: urlRes.uri });
    }
  }

  async copyToDownloads(path: string): Promise<void> {
    // 파일 내용을 base64 문자열로 JS까지 왕복시키면 대용량 파일(원본 PNG 다수를 묶은
    // tar 등 수백 MB)에서 네이티브 힙 OOM으로 앱이 크래시하므로, 데이터를 브리지에
    // 태우지 않는 네이티브 파일 복사(Filesystem.copy)로 처리한다.
    try {
      await Filesystem.mkdir({
        path: 'Download',
        directory: Directory.ExternalStorage,
      });
    } catch (e) {}
    const fileName = path.split('/').pop()!;
    const destRel = 'Download/' + fileName;
    await Filesystem.copy({
      from: `${APP_DIR}/${path}`,
      directory: Directory.Documents,
      to: destRel,
      toDirectory: Directory.ExternalStorage,
    });
    // Filesystem.copy는 디스크에만 쓰고 MediaStore에 등록하지 않아(targetSdk 34 + 모든 파일
    // 접근) 갤러리/파일앱에서 안 보인다. 이미지 파일이면 미디어스캔으로 MediaStore에 등록한다.
    const mime = (() => {
      const ext = fileName.split('.').pop()!.toLowerCase();
      if (ext === 'png') return 'image/png';
      if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
      if (ext === 'webp') return 'image/webp';
      return null; // 이미지가 아니면(zip/tar 등) 스캔하지 않음
    })();
    if (mime) {
      try {
        const uriRes = await Filesystem.getUri({
          path: destRel,
          directory: Directory.ExternalStorage,
        });
        const absPath = uriRes.uri.replace(/^file:\/\//, '');
        await ZipService.scanMedia({ path: absPath, mime });
      } catch (e) {}
    }
    await ZipService.showDownloads({});
  }

  async zipFiles(files: FileEntry[], outPath: string): Promise<void> {
    const dir = getDirName(`${APP_DIR}/${outPath}`);
    try {
      await Filesystem.mkdir({
        path: dir,
        directory: Directory.Documents,
        recursive: true,
      });
    } catch (e) {}
    const urlRes = await Filesystem.getUri({
      path: `${APP_DIR}`,
      directory: Directory.Documents,
    });
    const fullDir = urlRes.uri.slice(7);
    files = files.map((x) => ({
      name: x.name,
      path: fullDir + '/' + x.path,
    }));
    outPath = fullDir + '/' + outPath;

    await ZipService.zipFiles({ files, outPath });
  }

  async unzipFiles(zipPath: string, outPath: string): Promise<void> {
    const urlRes = await Filesystem.getUri({
      path: `${APP_DIR}`,
      directory: Directory.Documents,
    });
    const fullDir = urlRes.uri.slice(7);
    await ZipService.unzipFiles({
      zipPath: zipPath,
      outPath: fullDir + '/' + outPath,
    });
  }

  async getFreeSpace(): Promise<number | null> {
    // 네이티브 StatFs 로 데이터 루트 볼륨의 실제 여유 공간을 조회한다.
    // (navigator.storage.estimate() 는 WebView 가 캡된 쿼터를 돌려줘 실제 디스크
    //  여유와 무관 — 항상 ~10GB 로 추정되던 버그. ZipService.getFreeSpace 로 교체)
    // 조회 실패 시 null(="알 수 없음")로 폴백한다.
    try {
      const res = await ZipService.getFreeSpace({});
      if (res && typeof res.bytes === 'number') return res.bytes;
    } catch (e) {}
    return null;
  }

  async getRuntimeDiag(): Promise<{ cpus: number; uvThreadpool: number } | null> {
    // 모바일은 libuv 스레드풀(=데스크톱 sharp 병렬) 개념이 없다 — 진단 미해당.
    return null;
  }

  async getBootWarnings(): Promise<{
    saveLocationFallback: { attempted: string; code: string } | null;
  } | null> {
    // 모바일은 saveLocation(사용자 지정 저장 경로)을 쓰지 않는다 — 부팅 경고 미해당.
    return null;
  }

  async checkWritable(
    _absolutePath: string,
  ): Promise<{ ok: boolean; code?: string }> {
    // 모바일은 saveLocation 미사용 — 사전 검증 대상 아님.
    return { ok: true };
  }

  async selectFile(): Promise<string | undefined> {
    const result = await FilePicker.pickFiles({
      types: ['application/x-tar'],
    });
    return result.files[0].path;
  }

  async selectFiles(options?: {
    filters?: { name: string; extensions: string[] }[];
  }): Promise<string[]> {
    // FilePicker 기본 limit=0(무제한)이라 다중 선택 지원.
    // 데스크톱 필터(extensions)는 안드로이드 문서 선택기의 MIME 방식과 달라
    // PNG 프리셋 가져오기 용도에 맞춰 image/png 로 고정한다.
    const result = await FilePicker.pickFiles({
      types: ['image/png'],
    });
    return result.files
      .map((f) => f.path)
      .filter((p): p is string => !!p);
  }

  async readBinaryFile(filePath: string): Promise<string> {
    // FilePicker 가 돌려준 절대 URI(file:// 또는 content://)를 그대로 읽는다.
    // encoding 미지정 → base64 문자열 반환 (electronBackend 와 동일 계약).
    const data = await Filesystem.readFile({ path: filePath });
    return data.data.toString();
  }

  async searchTags(word: string): Promise<any> {
    await this.tagDatabaseLoadPromise;
    const args = { id: this.tagDBId!, query: word };
    return (await TagDB.search(args)).results;
  }

  async lookupTag(word: string): Promise<any> {
    await this.tagDatabaseLoadPromise;
    return this.tagMap.get(word);
  }

  async loadPiecesDB(pieces: string[]): Promise<void> {
    const csv = pieces
      .map((x: string) => {
        return `<${x}>,0,0,null`;
      })
      .join('\n');
    const args = { id: this.piecesDBId!, path: csv };
    await TagDB.loadDB(args);
  }

  async searchPieces(word: string): Promise<any> {
    const args = { id: this.piecesDBId!, query: word };
    return (await TagDB.search(args)).results;
  }

  // Capacitor Filesystem 오류 중 "대상 부재"(ENOENT 상당) 판별.
  // listFiles/listFilesWithStats 의 전 앱 공통 계약은 "부재→[], 실오류(권한 등)→throw"
  // (데스크톱 main.ts 핸들러와 동일). 종전엔 stats 가 모든 오류를 [] 로 삼켜
  // 백업 목록/용량 실측에서 파일이 통째로 누락돼도(불완전 tar) 조용히 지나갔다.
  private isNotFoundError(e: any): boolean {
    const msg = String(e?.message ?? e ?? '');
    return /does not exist|ENOENT|no such file/i.test(msg);
  }

  async listFiles(arg: string): Promise<string[]> {
    try {
      const { files } = await Filesystem.readdir({
        path: `${APP_DIR}/${arg}`,
        directory: Directory.Documents,
      });
      return files.map((x) => x.name);
    } catch (e) {
      if (this.isNotFoundError(e)) return [];
      throw e;
    }
  }

  async listFilesWithStats(arg: string): Promise<any[]> {
    try {
      const { files } = await Filesystem.readdir({
        path: `${APP_DIR}/${arg}`,
        directory: Directory.Documents,
      });
      return files
        .filter((x) => x.type === 'file')
        .map((x) => ({
          name: x.name,
          size: x.size ?? 0,
          mtime: x.mtime ?? 0,
        }));
    } catch (e) {
      if (this.isNotFoundError(e)) return [];
      throw e;
    }
  }

  async readFile(filename: string): Promise<string> {
    const data = await Filesystem.readFile({
      path: `${APP_DIR}/${filename}`,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
    });
    return data.data.toString();
  }

  async writeFile(filename: string, data: string): Promise<void> {
    const dir = getDirName(`${APP_DIR}/${filename}`);
    try {
      await Filesystem.mkdir({
        path: dir,
        directory: Directory.Documents,
        recursive: true,
      });
    } catch (e) {}
    const tmpFile = `${APP_DIR}/${uuidv4()}`;
    await Filesystem.writeFile({
      path: tmpFile,
      data,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
    });
    // Capacitor 의 rename 은 "대상 삭제 후 renameTo" 라 교체가 원자적이지 않다 —
    // 삭제와 rename 사이에 강제 종료되면 파일이 통째로 사라진다. 기존 파일을 먼저
    // .bak 으로 물려 두는 2단계 교체로, 어느 시점에 죽어도 본문 또는 .bak 중
    // 하나는 반드시 남는다 (.bak 은 프로젝트 로드 실패 시 자동 복구에 사용됨).
    try {
      await Filesystem.rename({
        from: `${APP_DIR}/${filename}`,
        to: `${APP_DIR}/${filename}.bak`,
        directory: Directory.Documents,
      });
    } catch (e) {} // 기존 파일 없음(첫 저장) 등 — 무시
    await Filesystem.rename({
      from: tmpFile,
      to: `${APP_DIR}/${filename}`,
      directory: Directory.Documents,
    });
  }

  async copyFile(src: string, dest: string): Promise<void> {
    const dir = getDirName(`${APP_DIR}/${dest}`);
    try {
      await Filesystem.mkdir({
        path: dir,
        directory: Directory.Documents,
        recursive: true,
      });
    } catch (e) {}
    await Filesystem.copy({
      from: `${APP_DIR}/${src}`,
      to: `${APP_DIR}/${dest}`,
      directory: Directory.Documents,
    });
  }

  async copyFileToAbsolute(src: string, absoluteDest: string): Promise<void> {
    // 모바일은 임의 절대 경로 쓰기가 제한적이라 목표 폴더 export 를 지원하지 않는다.
    // (UI 에서 데스크톱 전용으로 막혀 있어 정상 흐름에선 호출되지 않음)
    throw new Error('모바일에서는 목표 폴더 내보내기를 지원하지 않습니다.');
  }

  async convertToWebp(src: string, dest: string, quality: number): Promise<void> {
    // 모바일은 sharp 가 없어 wasm libwebp(렌더러)로 인코딩한다 — 자동 WebP 변환과
    // 씬/프로젝트 일괄 변환이 공용으로 쓰는 경로(일괄은 경고+취소 제공).
    // wasm 번들이 무거워 동적 import 로 필요 시점에만 로드한다.
    const { encodePngBase64ToWebp } = await import('./wasmWebp');
    const data = await Filesystem.readFile({
      path: `${APP_DIR}/${src}`,
      directory: Directory.Documents,
    });
    const webpBase64 = await encodePngBase64ToWebp(data.data.toString(), quality);
    await this.writeDataFile(dest, webpBase64);
  }

  async readDataFile(arg: string): Promise<string> {
    const data = await Filesystem.readFile({
      path: `${APP_DIR}/${arg}`,
      directory: Directory.Documents,
    });
    const mimeType = getMimeType(arg);
    const base64Data = data.data.toString();
    const dataURL = `data:${mimeType};base64,${base64Data}`;
    return dataURL;
  }

  async writeDataFile(filename: string, data: string): Promise<void> {
    const binaryData = Buffer.from(data, 'base64').toString('base64');
    const dir = getDirName(`${APP_DIR}/${filename}`);
    try {
      await Filesystem.mkdir({
        path: dir,
        directory: Directory.Documents,
        recursive: true,
      });
    } catch (e) {}
    const tmpFile = `${APP_DIR}/${uuidv4()}`;
    await Filesystem.writeFile({
      path: tmpFile,
      data: binaryData,
      directory: Directory.Documents,
    });
    await Filesystem.rename({
      from: tmpFile,
      to: `${APP_DIR}/${filename}`,
      directory: Directory.Documents,
    });
  }

  async writeDataFileAbsolute(absolutePath: string, data: string): Promise<void> {
    // Android에서는 절대 경로 저장이 제한적이므로 Downloads 폴더에 저장
    const filename = absolutePath.split('/').pop() || 'image.png';
    const binaryData = Buffer.from(data, 'base64').toString('base64');
    await Filesystem.writeFile({
      path: `Download/${filename}`,
      data: binaryData,
      directory: Directory.ExternalStorage,
      recursive: true,
    });
  }

  async existFileAbsolute(absolutePath: string): Promise<boolean> {
    // Android에서는 Downloads 폴더 기준으로 확인
    const filename = absolutePath.split('/').pop() || '';
    try {
      await Filesystem.stat({
        path: `Download/${filename}`,
        directory: Directory.ExternalStorage,
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  async renameFile(oldfile: string, newfile: string): Promise<void> {
    const oldPath = `${APP_DIR}/${oldfile}`;
    const newPath = `${APP_DIR}/${newfile}`;
    return await Filesystem.rename({
      from: oldPath,
      to: newPath,
      directory: Directory.Documents,
    });
  }

  async renameDir(oldfile: string, newfile: string): Promise<void> {
    return await Filesystem.rename({
      from: `${APP_DIR}/${oldfile}`,
      to: `${APP_DIR}/${newfile}`,
      directory: Directory.Documents,
    });
  }

  async deleteFile(filename: string): Promise<void> {
    await Filesystem.deleteFile({
      path: `${APP_DIR}/${filename}`,
      directory: Directory.Documents,
    });
  }

  async deleteDir(filename: string): Promise<void> {
    // 데이터 루트/비정상 경로 삭제 거부 (2026-07-06 outs 전체 증발 사고 방지)
    assertDeletableDirPath(filename);
    await Filesystem.rmdir({
      path: `${APP_DIR}/${filename}`,
      directory: Directory.Documents,
      recursive: true,
    });
  }

  async trashFile(filename: string): Promise<void> {
    await this.deleteFile(filename);
  }

  async close(): Promise<void> {
    return;
  }

  async restartApp(): Promise<void> {
    // 앱 프로세스 재실행 API 가 없어 WebView reload 로 부트스트랩을 재실행한다
    // (MigrationGate 치명 실패 화면의 "앱 다시 시작"과 동일 방식). 호출부가
    // 사전에 저장 flush 를 마친 뒤 부른다.
    window.location.reload();
  }

  async existFile(filename: string): Promise<boolean> {
    try {
      await Filesystem.stat({
        path: `${APP_DIR}/${filename}`,
        directory: Directory.Documents,
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  async download(url: string, dest: string, filename: string): Promise<void> {
    return;
  }

  async resizeImage(input: ResizeImageInput): Promise<void> {
    let { inputPath, outputPath, maxWidth, maxHeight } = input;
    inputPath = `${APP_DIR}/${inputPath}`;
    outputPath = `${APP_DIR}/${outputPath}`;
    const dir = getDirName(outputPath);

    try {
      await Filesystem.mkdir({
        path: dir,
        directory: Directory.Documents,
        recursive: true,
      });
    } catch (e) {}

    const { data } = await Filesystem.readFile({
      path: inputPath,
      directory: Directory.Documents,
    });

    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;

    canvas.width = img.width;
    canvas.height = img.height;
    context.drawImage(img, 0, 0);

    // Create a canvas for the output image
    const outputCanvas = document.createElement('canvas');
    if (img.width > img.height) {
      const ratio = img.height / img.width;
      outputCanvas.width = Math.min(img.width, maxWidth);
      outputCanvas.height = Math.floor(outputCanvas.width * ratio);
    } else {
      const ratio = img.width / img.height;
      outputCanvas.height = Math.min(img.height, maxWidth);
      outputCanvas.width = Math.floor(outputCanvas.height * ratio);
    }

    await pica.resize(canvas, outputCanvas, {
      unsharpAmount: 160,
      unsharpRadius: 0.6,
      unsharpThreshold: 1,
    });

    let outputBlob: any;
    if (input.optimize === ImageOptimizeMethod.AVIF) {
      outputBlob = await pica.toBlob(outputCanvas, 'image/avif', 0.5);
    } else if (input.optimize === ImageOptimizeMethod.LOSSY) {
      outputBlob = await pica.toBlob(outputCanvas, 'image/webp', 0.8);
    } else {
      outputBlob = await pica.toBlob(outputCanvas, 'image/png', 0.9);
    }

    const arrayBuffer = await outputBlob.arrayBuffer();
    const outputBuffer = Buffer.from(arrayBuffer);

    await Filesystem.writeFile({
      path: outputPath,
      data: outputBuffer.toString('base64'),
      directory: Directory.Documents,
    });
  }

  async openImageEditor(inputPath: string): Promise<void> {
    return;
  }

  async watchImage(inputPath: string): Promise<void> {
    return;
  }

  async unwatchImage(inputPath: string): Promise<void> {
    return;
  }

  async loadModel(modelPath: string): Promise<void> {
    return;
  }

  async extractZip(zipPath: string, outPath: string): Promise<void> {
    return;
  }

  async spawnLocalAI(): Promise<void> {
    return;
  }

  async isLocalAIRunning(): Promise<boolean> {
    return false;
  }

  async removeBackground(
    inputImageBase64: string,
    outputPath: string,
  ): Promise<void> {
    return;
  }

  async analyzeArtistTags(arg: {
    imageBase64: string;
    model: 'kaloscope' | 'wd-swinv2' | 'wd-eva02';
  }): Promise<any> {
    throw new Error('데스크톱 전용 기능입니다');
  }

  async selectDir(): Promise<string | undefined> {
    return undefined;
  }

  onDownloadProgress(
    callback: (progress: any) => void | Promise<void>,
  ): () => void {
    return () => {};
  }

  onZipProgress(callback: (progress: any) => void | Promise<void>): () => void {
    return () => {};
  }

  onImageChanged(callback: (path: string) => void | Promise<void>): () => void {
    return () => {};
  }

  onClose(callback: () => void): () => void {
    return () => {};
  }

  // 모바일은 네이티브 텍스트 선택 메뉴를 쓰지 않고 contextmenu 이벤트로 직접 처리하므로 no-op
  onDanbooruSearch(callback: (text: string) => void): () => void {
    return () => {};
  }

  async copyImageToClipboard(imagePath: string): Promise<void> {
    const dataUri = await this.readDataFile(imagePath);
    await Clipboard.write({
      image: dataUri,
    });
  }
}
