// Google 드라이브 연동 — Android 네이티브 플러그인 타입 (드라이브 API ④, 2026-10-01)
//
// 구현: android/app/src/main/java/io/sunho/SDStudio/GoogleDrivePlugin.kt(MainActivity 에서 등록).
// access token 은 네이티브 메모리에만 있고 여기로 오지 않는다. 오류는 PC 와 같은 코드 문자열로
// reject 된다(error.code, 참고값은 error.data.detail) — 변환은 models/googleDrive.ts 의 순수 함수.

import { registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import type { DriveAuthQuota } from '../../shared/googleDriveAuth';
import type {
  DriveBackupItem,
  DriveDownloadProgress,
  DriveFileMeta,
  DriveUploadProgress,
} from '../../shared/googleDrive';

// 네이티브 상태(→ DriveAuthStatus 변환: nativeDriveAuthStatus).
export interface NativeDriveStatus {
  connected: boolean;
  email?: string;
  connectedAt?: string;
  quota?: DriveAuthQuota;
  // 연결은 유지된 채 이메일·용량 조회만 실패한 코드(PC status.error 와 같은 문구로 바꾼다).
  infoError?: string;
  // 권한이 해제돼 연결이 끊겼을 때 'expired'.
  authError?: string;
}

export interface GoogleDrivePluginType {
  // Google Play 서비스 사용 가능 여부(없으면 연동 구역을 숨기고 기존 공유 시트 흐름).
  isAvailable(): Promise<{ available: boolean }>;
  // 연결 여부만(네트워크 없음).
  connected(): Promise<{ connected: boolean }>;
  status(): Promise<NativeDriveStatus>;
  connect(): Promise<NativeDriveStatus>;
  disconnect(): Promise<void>;
  // appDir = 데이터 루트의 file:// URI(Filesystem.getUri), exportsPath = 'exports/…' 상대 경로.
  upload(options: {
    appDir: string;
    exportsPath: string;
    kind: string;
    name?: string;
    appVersion?: string;
  }): Promise<{ file: DriveFileMeta }>;
  uploadCancel(): Promise<void>;
  // kinds = 유효한 appProperties.kind 값(shared DRIVE_BACKUP_KINDS — 목록 하나만 유지).
  list(options: { kinds: string[] }): Promise<{ items: DriveBackupItem[]; folderLink?: string }>;
  // 반환 path: 기본 = tmp/drive-download/<id>/<이름> 의 file:// URI(unzipFiles·readBinaryFile 이 그대로 연다),
  // toDownloads = 기기 Download/ 의 절대 경로(표시용).
  download(options: {
    appDir: string;
    fileId: string;
    name: string;
    size?: number;
    toDownloads?: boolean;
  }): Promise<{ path: string }>;
  downloadCancel(): Promise<void>;
  trash(options: { fileId: string }): Promise<void>;
  cleanupDownload(options: { appDir: string; fileId: string }): Promise<void>;
  openFile(options: { url: string }): Promise<void>;
  addListener(
    eventName: 'driveAuthChanged',
    listener: (status: NativeDriveStatus) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'driveUploadProgress',
    listener: (p: DriveUploadProgress) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'driveDownloadProgress',
    listener: (p: DriveDownloadProgress) => void,
  ): Promise<PluginListenerHandle>;
}

const GoogleDrive = registerPlugin<GoogleDrivePluginType>('GoogleDrive');

export default GoogleDrive;
