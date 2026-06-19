import { Config } from '../../main/config';
import {
  EncodeVibeImageInput,
  ImageAugmentInput,
  ImageGenInput,
  ImageGenService,
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
import FetchService from './fecthService';
import JSZip from 'jszip';
import { BackgroundMode } from '@anuradev/capacitor-background-mode';
import { App as CapacitorApp } from '@capacitor/app';
import { TagDB } from './tagDB';
// @ts-ignore
import DBCSV from '../../../assets/db.txt';
import packageInfo from '../../../package.json';
import ZipService from './zipService';
import { FilePicker } from '@capawesome/capacitor-file-picker';
import { Share } from '@capacitor/share';
import { Clipboard } from '@capacitor/clipboard';
import { WordTag } from '../models/Tags';

const APP_DIR = '.SDStudio';
let config: Config = {};
let configLoaded = false;
let configLoadPromise: Promise<void> | null = null;
const pica = new Pica();

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
    return base64ToArrayBuffer(response.data);
  }
}

export class AndroidBackend extends Backend {
  private imageGenService: ImageGenService;
  private tagDBId?: number;
  private piecesDBId?: number;
  private tagMap: Map<string, WordTag>;
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
      } catch {}
      configLoaded = true;
    })();
    (async () => {
      // 알림 권한 요청 (Android 13+). 권한이 없으면 포그라운드 서비스 알림이 표시되지 않아
      // 서비스가 더 쉽게 종료될 수 있으므로 먼저 요청한다.
      try {
        await BackgroundMode.requestNotificationsPermission();
      } catch (e) {}
      try {
        const battery = await BackgroundMode.checkBatteryOptimizations();
        if (!battery.disabled) {
          await BackgroundMode.requestDisableBatteryOptimizations();
        }
      } catch (e) {}
      // 포그라운드 서비스 설정 + enable. 최초 1회는 안내용 기본 문구 포함.
      await this.ensureBackgroundMode(true);
      try {
        await BackgroundMode.disableWebViewOptimizations();
      } catch (e) {}
    })();

    // 견고화: 앱이 포그라운드로 돌아올 때마다 백그라운드 모드를 재적용한다.
    // 최초 실행은 권한 다이얼로그가 enable() 타이밍을 자연스럽게 맞춰주지만, 2번째
    // 실행(콜드 스타트, 다이얼로그 없음)에서는 enable()/설정이 다음 백그라운드 전환에
    // 안정적으로 반영되지 않아 알림이 뜨지 않는 문제가 있었다. resume 마다 재적용하면
    // 다음 백그라운드 진입 직전에 항상 신선한 상태가 보장된다.
    // (text 는 생략 → 진행 중 생성 알림 문구를 덮어쓰지 않음)
    try {
      CapacitorApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive) {
          this.ensureBackgroundMode(false).catch(() => {});
        }
      });
    } catch (e) {}

    (async () => {
      this.tagDBId = (await TagDB.createDB({ name: 'tags' })).id;
      this.piecesDBId = (await TagDB.createDB({ name: 'pieces' })).id;
      await TagDB.loadDB({ id: this.tagDBId, path: DBCSV });
      DBCSV.split('\n').forEach((x: string) => {
        const comps: string[] = x.split(',');
        if (comps.length !== 4) return;
        this.tagMap.set(comps[0], {
          word: comps[0],
          normalized: comps[0],
          freq: parseInt(comps[2]),
          category: parseInt(comps[1]),
          redirect: comps[3],
          priority: 0,
        });
      });
    })();
  }

  async getConfig(): Promise<Config> {
    if (!configLoaded && configLoadPromise) {
      await configLoadPromise;
    }
    return config;
  }

  async setConfig(newConfig: Config): Promise<void> {
    config = newConfig;
    await Filesystem.writeFile({
      path: `${APP_DIR}/config.json`,
      data: JSON.stringify(config),
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
    });
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

  async login(email: string, password: string): Promise<void> {
    const token = await this.imageGenService.login(email, password);
    await this.writeFile('TOKEN.txt', token.accessToken);
  }

  async loginWithToken(token: string): Promise<void> {
    await this.writeFile('TOKEN.txt', token);
  }

  async encodeVibeImage(arg: EncodeVibeImageInput): Promise<string> {
    const token = await this.readFile('TOKEN.txt');
    const res = await this.imageGenService.encodeVibeImage(token, arg);
    return res;
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
    await Filesystem.copy({
      from: `${APP_DIR}/${path}`,
      directory: Directory.Documents,
      to: 'Download/' + path.split('/').pop()!,
      toDirectory: Directory.ExternalStorage,
    });
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

  async selectFile(): Promise<string | undefined> {
    const result = await FilePicker.pickFiles({
      types: ['application/x-tar'],
    });
    return result.files[0].path;
  }

  async searchTags(word: string): Promise<any> {
    const args = { id: this.tagDBId!, query: word };
    return (await TagDB.search(args)).results;
  }

  async lookupTag(word: string): Promise<any> {
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

  async listFiles(arg: string): Promise<string[]> {
    const { files } = await Filesystem.readdir({
      path: `${APP_DIR}/${arg}`,
      directory: Directory.Documents,
    });
    return files.map((x) => x.name);
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
    } catch {
      return [];
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
