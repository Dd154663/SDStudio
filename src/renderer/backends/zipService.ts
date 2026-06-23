import { registerPlugin } from '@capacitor/core';

export interface FileEntry {
  name: string;
  path: string;
}

export interface ZipPlugin {
  zipFiles(options: { files: FileEntry[]; outPath: string }): Promise<void>;
  unzipFiles(options: { zipPath: string; outPath: string }): Promise<void>;
  showFileInFolder(options: { filePath: string }): Promise<void>;
  showDownloads(options: {}): Promise<void>;
  // 다운로드한 파일을 MediaStore에 등록(미디어스캔)해 갤러리/파일앱에 노출시킨다.
  scanMedia(options: {
    path: string;
    mime?: string;
  }): Promise<{ path: string; uri: string | null }>;
}

const ZipService = registerPlugin<ZipPlugin>('ZipService');

export default ZipService;
