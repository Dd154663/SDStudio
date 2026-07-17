import { Config } from '../../main/config';
import {
  EncodeVibeImageInput,
  ImageAugmentInput,
  ImageGenInput,
  ImageGenService,
  LoginValidity,
} from './imageGen';
import { Backend, FileEntry, ResizeImageInput } from '../backend';
import { assertDeletableDirPath } from './dataPathGuard';
import { NovelAiFetcher, NovelAiImageGenService } from './genVendors/nai';
import { ImageContextAlt, SceneContextAlt } from '../models/types';

const invoke = window.electron?.ipcRenderer?.invoke;

class ElectronFetcher implements NovelAiFetcher {
  async fetchArrayBuffer(
    url: string,
    body: any,
    headers: any,
  ): Promise<ArrayBuffer> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 120 * 1000);
    const response = await fetch(url, {
      body: JSON.stringify(body),
      headers: headers,
      method: 'POST',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      console.error(await response.json());
      throw new Error(`Failed to fetch: ${response.status}`);
    }
    return await response.arrayBuffer();
  }
}

export class ElectornBackend extends Backend {
  private imageGenService: ImageGenService;
  constructor() {
    super();
    this.imageGenService = new NovelAiImageGenService(new ElectronFetcher());
  }

  // 로그인 토큰 — 저장 경로(saveLocation)와 무관하게 이 PC 전역(userData,
  // config.json 과 동일 위치)에 보관한다. 종전에는 데이터 루트(APP_DIR)에 있어
  // 저장 경로를 바꾸면 로그인이 풀렸다. 구 위치 토큰은 발견 시 전역으로 1회
  // 이관하고, 원본은 구버전 롤백 호환을 위해 남겨둔다(전역본이 있으면 무시됨).
  private async readToken(): Promise<string> {
    try {
      return await invoke('read-global-file', 'TOKEN.txt');
    } catch (e: any) {
      const legacy = await invoke('read-file', 'TOKEN.txt');
      // 이관은 전역본 부재(ENOENT)일 때만 — 일시 IO 오류로 읽기만 실패한 경우
      // 이미 있는 전역본을 구 위치의 스테일 토큰으로 덮어쓰지 않는다.
      // 이관 쓰기 실패도 이번 호출을 막지 않는다(legacy 토큰으로 진행, 다음에 재시도).
      if (String(e?.message || e).includes('ENOENT')) {
        try {
          await invoke('write-global-file', 'TOKEN.txt', legacy);
        } catch (e2) {}
      }
      return legacy;
    }
  }

  private async writeToken(token: string): Promise<void> {
    await invoke('write-global-file', 'TOKEN.txt', token);
  }

  async getConfig(): Promise<Config> {
    return await invoke('get-config');
  }

  async setConfig(newConfig: Config): Promise<void> {
    await invoke('set-config', newConfig);
  }

  async getVersion(): Promise<string> {
    return await invoke('get-version');
  }

  async openWebPage(url: string): Promise<void> {
    await invoke('open-web-page', url);
  }

  async generateImage(arg: ImageGenInput): Promise<void> {
    const token = await this.readToken();
    const res = await this.imageGenService.generateImage(token, arg);
    await this.writeDataFile(arg.outputFilePath, res);
  }

  async augmentImage(arg: ImageAugmentInput): Promise<void> {
    const token = await this.readToken();
    const res = await this.imageGenService.augmentImage(token, arg);
    await this.writeDataFile(arg.outputFilePath, res);
  }

  async getRemainCredits(): Promise<number> {
    const token = await this.readToken();
    return await this.imageGenService.getRemainCredits(token);
  }

  async login(email: string, password: string): Promise<void> {
    const token = await this.imageGenService.login(email, password);
    await this.writeToken(token.accessToken);
  }

  async loginWithToken(token: string): Promise<void> {
    await this.writeToken(token);
  }

  async validateLogin(): Promise<LoginValidity> {
    let token: string;
    try {
      token = await this.readToken();
    } catch (e) {
      return 'invalid'; // 토큰 파일 없음(전역·구 위치 모두) → 로그아웃
    }
    return await this.imageGenService.validateToken(token);
  }

  async encodeVibeImage(arg: EncodeVibeImageInput): Promise<string> {
    const token = await this.readToken();
    return await this.imageGenService.encodeVibeImage(token, arg);
  }

  async showFile(arg: string): Promise<void> {
    await invoke('show-file', arg);
  }

  async copyToDownloads(path: string): Promise<void> {
    return;
  }

  async zipFiles(files: FileEntry[], outPath: string): Promise<void> {
    await invoke('zip-files', files, outPath);
  }

  async unzipFiles(zipPath: string, outPath: string): Promise<void> {
    await invoke('unzip-files', zipPath, outPath);
  }

  async getFreeSpace(): Promise<number | null> {
    return await invoke('get-free-space');
  }

  async getRuntimeDiag(): Promise<{ cpus: number; uvThreadpool: number } | null> {
    return await invoke('get-runtime-diag');
  }

  async getBootWarnings(): Promise<{
    saveLocationFallback: { attempted: string; code: string } | null;
  } | null> {
    return await invoke('get-boot-warnings');
  }

  async checkWritable(
    absolutePath: string,
  ): Promise<{ ok: boolean; code?: string }> {
    return await invoke('check-writable', absolutePath);
  }

  async searchTags(word: string): Promise<any> {
    return await invoke('search-tags', word);
  }

  async lookupTag(word: string): Promise<any> {
    return await invoke('lookup-tag', word);
  }

  async loadPiecesDB(pieces: string[]): Promise<void> {
    await invoke('load-pieces-db', pieces);
  }

  async searchPieces(word: string): Promise<any> {
    return await invoke('search-pieces', word);
  }

  async listFiles(arg: string): Promise<string[]> {
    return await invoke('list-files', arg);
  }

  async listFilesWithStats(arg: string): Promise<any[]> {
    return await invoke('list-files-with-stats', arg);
  }

  async readFile(filename: string): Promise<string> {
    return await invoke('read-file', filename);
  }

  async writeFile(filename: string, data: string): Promise<void> {
    await invoke('write-file', filename, data);
  }

  async copyFile(src: string, dest: string): Promise<void> {
    await invoke('copy-file', src, dest);
  }

  async copyFileToAbsolute(src: string, absoluteDest: string): Promise<void> {
    await invoke('copy-file-absolute', src, absoluteDest);
  }

  async convertToWebp(src: string, dest: string, quality: number): Promise<void> {
    await invoke('convert-to-webp', src, dest, quality);
  }

  async readDataFile(arg: string): Promise<string> {
    return await invoke('read-data-file', arg);
  }

  async writeDataFile(filename: string, data: string): Promise<void> {
    await invoke('write-data-file', filename, data);
  }

  async writeDataFileAbsolute(absolutePath: string, data: string): Promise<void> {
    await invoke('write-data-file-absolute', absolutePath, data);
  }

  async existFileAbsolute(absolutePath: string): Promise<boolean> {
    return await invoke('exist-file-absolute', absolutePath);
  }

  async renameFile(oldfile: string, newfile: string): Promise<void> {
    await invoke('rename-file', oldfile, newfile);
  }

  async renameDir(oldfile: string, newfile: string): Promise<void> {
    await invoke('rename-dir', oldfile, newfile);
  }

  async deleteFile(filename: string): Promise<void> {
    await invoke('delete-file', filename);
  }

  async deleteDir(filename: string): Promise<void> {
    // 데이터 루트/비정상 경로 삭제 거부 (2026-07-06 outs 전체 증발 사고 방지)
    assertDeletableDirPath(filename);
    await invoke('delete-dir', filename);
  }

  async trashFile(filename: string): Promise<void> {
    await invoke('trash-file', filename);
  }

  async close(): Promise<void> {
    await invoke('close');
  }

  async restartApp(): Promise<void> {
    await invoke('restart-app');
  }

  async existFile(filename: string): Promise<boolean> {
    return await invoke('exist-file', filename);
  }

  async download(url: string, dest: string, filename: string): Promise<void> {
    await invoke('download', url, dest, filename);
  }

  async resizeImage(input: ResizeImageInput): Promise<void> {
    await invoke('resize-image', input);
  }

  async openImageEditor(inputPath: string): Promise<void> {
    await invoke('open-image-editor', inputPath);
  }

  async watchImage(inputPath: string): Promise<void> {
    await invoke('watch-image', inputPath);
  }

  async unwatchImage(inputPath: string): Promise<void> {
    await invoke('unwatch-image', inputPath);
  }

  async loadModel(modelPath: string): Promise<void> {
    await invoke('load-model', modelPath);
  }

  async extractZip(zipPath: string, outPath: string): Promise<void> {
    await invoke('extract-zip', zipPath, outPath);
  }

  async spawnLocalAI(): Promise<void> {
    await invoke('spawn-local-ai');
  }

  async isLocalAIRunning(): Promise<boolean> {
    return await invoke('is-local-ai-running');
  }

  async selectDir() {
    return await invoke('select-dir');
  }

  async selectFile() {
    return await invoke('select-file');
  }

  async selectFiles(options?: { filters?: { name: string; extensions: string[] }[] }): Promise<string[]> {
    return await invoke('select-files', options);
  }

  async readBinaryFile(filePath: string): Promise<string> {
    return await invoke('read-binary-file', filePath);
  }

  async removeBackground(
    inputImageBase64: string,
    outputPath: string,
  ): Promise<void> {
    await invoke('remove-bg', inputImageBase64, outputPath);
  }

  async analyzeArtistTags(arg: {
    imageBase64: string;
    model: 'kaloscope' | 'wd-swinv2' | 'wd-eva02';
  }): Promise<any> {
    return await invoke('artist-analyze', arg);
  }

  onDownloadProgress(
    callback: (progress: any) => void | Promise<void>,
  ): () => void {
    return window.electron.ipcRenderer.on('download-progress', callback);
  }

  onZipProgress(callback: (progress: any) => void | Promise<void>): () => void {
    return window.electron.ipcRenderer.on('zip-progress', callback);
  }

  onDuplicateScene(
    callback: (ctx: SceneContextAlt) => void | Promise<void>,
  ): () => void {
    return window.electron.ipcRenderer.on('duplicate-scene', callback);
  }

  onImageChanged(callback: (path: string) => void | Promise<void>): () => void {
    return window.electron.ipcRenderer.on('image-changed', callback);
  }

  onDuplicateImage(
    callback: (ctx: ImageContextAlt) => void | Promise<void>,
  ): () => void {
    return window.electron.ipcRenderer.on('duplicate-image', callback);
  }

  onCopyImage(
    callback: (ctx: ImageContextAlt) => void | Promise<void>,
  ): () => void {
    return window.electron.ipcRenderer.on('copy-image', callback);
  }

  onMoveSceneFront(
    callback: (ctx: SceneContextAlt) => void | Promise<void>,
  ): () => void {
    return window.electron.ipcRenderer.on('move-scene-front', callback);
  }

  onMoveSceneBack(
    callback: (ctx: SceneContextAlt) => void | Promise<void>,
  ): () => void {
    return window.electron.ipcRenderer.on('move-scene-back', callback);
  }

  onClose(callback: () => void | Promise<void>): () => void {
    return window.electron.ipcRenderer.on('close', callback);
  }

  onDanbooruSearch(callback: (text: string) => void | Promise<void>): () => void {
    return window.electron.ipcRenderer.on('danbooru-search', callback);
  }

  async copyImageToClipboard(imagePath: string): Promise<void> {
    await invoke('copy-image-to-clipboard', imagePath);
  }

  // 새 창 열기(멀티 윈도우 W6) — main 이 보조 창을 캐스케이드 위치로 생성한다.
  // projectName 이 있으면 새 창이 부팅 후 그 프로젝트를 연다("새 창에서 열기").
  async openNewWindow(projectName?: string): Promise<void> {
    await invoke('open-new-window', projectName);
  }

  // ─── 프로젝트 배타 락 (W6 P1) — main 의 창 간 등록부에 위임 ───
  async acquireProjectLock(name: string): Promise<boolean> {
    return await invoke('project-lock-acquire', name);
  }
  async releaseProjectLock(name: string): Promise<void> {
    await invoke('project-lock-release', name);
  }
  async queryProjectLock(
    name: string,
  ): Promise<{ locked: boolean; mine: boolean }> {
    return await invoke('project-lock-query', name);
  }
  async focusProjectLockOwner(name: string, notice?: string): Promise<void> {
    await invoke('project-lock-focus-owner', name, notice);
  }

  onLockOwnerNotice(callback: (message: string) => void): () => void {
    return window.electron.ipcRenderer.on('lock-owner-notice', callback);
  }

  async takeInitialProject(): Promise<string | null> {
    return await invoke('take-initial-project');
  }
}
