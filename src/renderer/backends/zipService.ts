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
  // 데이터 루트 볼륨의 실제 여유 공간(bytes) — 네이티브 StatFs 기반.
  getFreeSpace(options: {}): Promise<{ bytes: number }>;
  // Android 11+ '모든 파일 접근' 특수 권한 상태 (저장소 부팅 게이트).
  // required=false(Android 10 이하)면 granted 는 항상 true.
  storagePermissionStatus(options: {}): Promise<{
    required: boolean;
    granted: boolean;
  }>;
  // '모든 파일 접근' 설정 화면 열기 (게이트 화면의 [설정 열기] 버튼).
  openAllFilesSettings(options: {}): Promise<void>;
}

const ZipService = registerPlugin<ZipPlugin>('ZipService');

export default ZipService;
