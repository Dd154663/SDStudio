// Google 드라이브 연동 — 파일 작업(올리기 ②·목록·받기·휴지통 ③) main·renderer 공용 타입·오류·채널 (2026-09-28)
//
// 인증(연결·해제·상태)은 googleDriveAuth.ts, 파일 작업은 이 파일이다. 올리기 오류는 코드로
// 주고받고 사용자 문구는 DRIVE_UPLOAD_ERROR_TEXT 한 곳에 둔다(인증과 겹치는 코드는
// DRIVE_AUTH_ERROR_TEXT 를 그대로 재사용).
//
// NovelAI 토큰 방벽: 토큰 파일(kind 'token' 또는 파일명 sdstudio-token-…)은 드라이브에 올리지 않는다.
// renderer(목적지 결정)와 main(올리기 IPC) 양쪽이 isTokenExport 로 2중 차단한다.

import { DRIVE_AUTH_ERROR_TEXT, DriveAuthErrorCode } from './googleDriveAuth';

export interface DriveFileMeta {
  id: string;
  name: string;
  // 바이트(Drive API 는 문자열로 준다 — 숫자로 바꿔 전달, 모르면 없음).
  size?: number;
  // 드라이브 웹에서 여는 주소(https://drive.google.com/…).
  webViewLink?: string;
}

export interface DriveUploadProgress {
  sent: number;
  total: number;
}

export interface DriveUploadRequest {
  // APP_DIR 기준 상대 'exports/…'(publish-export 와 같은 경로 규칙).
  exportsPath: string;
  // 동기화 대상 종류(renderer DriveExportKind 와 같은 값). appProperties.kind 로 기록.
  kind: string;
  // 드라이브에 보일 파일 이름(생략하면 exportsPath 의 파일 이름).
  name?: string;
}

// ─── 목록·받기·휴지통 (드라이브 API ③) ───

// 올리는 쪽(renderer DriveExportKind)과 같은 값. appProperties.kind 검증에 쓴다.
export const DRIVE_BACKUP_KINDS = [
  'project',
  'global-presets',
  'artist-library',
  'project-templates',
  'character-presets',
  'scene-template',
  'config',
  'token',
] as const;
export type DriveBackupKind = (typeof DRIVE_BACKUP_KINDS)[number];

export function isDriveBackupKind(v: unknown): v is DriveBackupKind {
  return typeof v === 'string' && (DRIVE_BACKUP_KINDS as readonly string[]).includes(v);
}

// 드라이브 SDStudio 폴더의 파일 하나(백업 관리 창 목록 행).
// 표식(appProperties.kind)이 없거나 모르는 값이면 kind = 'unknown'(받기는 다운로드 폴더 저장만).
export interface DriveBackupItem {
  id: string;
  name: string;
  size?: number;
  // ISO 8601(UTC). 화면에서는 로컬 시각으로 바꿔 보인다.
  modifiedTime?: string;
  kind: DriveBackupKind | 'unknown';
  // 올린 기기 이름(appProperties.device)·앱 버전(appProperties.appVersion).
  device?: string;
  appVersion?: string;
  webViewLink?: string;
}

export interface DriveListResult {
  items: DriveBackupItem[];
  // SDStudio 폴더의 드라이브 웹 주소(폴더가 아직 없으면 없음).
  folderLink?: string;
}

export interface DriveDownloadRequest {
  fileId: string;
  // 드라이브의 파일 이름(로컬 파일 이름으로 정제해 쓴다).
  name: string;
  // 목록의 크기(진행률 분모). 없으면 응답의 Content-Length.
  size?: number;
  // true = OS 다운로드 폴더에 저장(같은 이름이면 " (n)" 접미). false = 앱 tmp/drive-download/<id>/.
  toDownloads?: boolean;
}

export interface DriveDownloadProgress {
  received: number;
  // 모르면 0.
  total: number;
}

export type DriveUploadErrorCode =
  | DriveAuthErrorCode
  | 'token-export-forbidden'
  | 'invalid-path'
  | 'file-missing'
  | 'quota-exceeded'
  | 'rate-limited'
  | 'upload-failed'
  // ③ 목록·받기·휴지통
  | 'not-found'
  | 'not-backup'
  | 'download-failed'
  | 'request-failed'
  | 'token-download-forbidden';

export const DRIVE_UPLOAD_ERROR_TEXT: Record<DriveUploadErrorCode, string> = {
  ...DRIVE_AUTH_ERROR_TEXT,
  cancelled: '올리기를 취소했습니다.',
  busy: '이 창에서 이미 드라이브에 올리고 있습니다. 끝난 뒤 다시 시도해 주세요.',
  unknown: '알 수 없는 오류로 드라이브에 올리지 못했습니다.',
  'token-export-forbidden': 'NovelAI 토큰 파일은 Google 드라이브에 올리지 않습니다.',
  'invalid-path': '내보내기 폴더 밖의 파일은 올릴 수 없습니다.',
  'file-missing': '올릴 내보내기 파일을 찾지 못했습니다.',
  'quota-exceeded': 'Google 드라이브 저장 공간이 부족합니다.',
  'rate-limited': 'Google 드라이브 요청이 너무 많아 잠시 거절되었습니다. 잠시 뒤 다시 시도해 주세요.',
  'upload-failed': 'Google 드라이브에 파일을 올리지 못했습니다.',
  'not-found': '드라이브에서 파일을 찾지 못했습니다. 이미 삭제되었을 수 있습니다.',
  'not-backup': 'SDStudio 폴더의 백업 파일이 아니어서 처리하지 않았습니다.',
  'download-failed': 'Google 드라이브에서 파일을 받지 못했습니다.',
  'request-failed': 'Google 드라이브 요청을 처리하지 못했습니다.',
  'token-download-forbidden':
    'NovelAI 토큰 파일은 드라이브에서 불러오지 않습니다. 다운로드 폴더에 파일로만 저장할 수 있습니다.',
};

// 받기·목록·휴지통에서 쓰는 문구(취소·중복 요청·알 수 없음만 올리기와 다르다).
export const DRIVE_DOWNLOAD_ERROR_TEXT: Record<DriveUploadErrorCode, string> = {
  ...DRIVE_UPLOAD_ERROR_TEXT,
  cancelled: '받기를 취소했습니다.',
  busy: '이 창에서 이미 드라이브에서 받고 있습니다. 끝난 뒤 다시 시도해 주세요.',
  unknown: '알 수 없는 오류로 Google 드라이브 작업을 마치지 못했습니다.',
};

export function driveDownloadErrorText(code: unknown): string {
  return isDriveUploadErrorCode(code)
    ? DRIVE_DOWNLOAD_ERROR_TEXT[code]
    : DRIVE_DOWNLOAD_ERROR_TEXT.unknown;
}

export function isDriveUploadErrorCode(v: unknown): v is DriveUploadErrorCode {
  return (
    typeof v === 'string' && Object.prototype.hasOwnProperty.call(DRIVE_UPLOAD_ERROR_TEXT, v)
  );
}

export function driveUploadErrorText(code: unknown): string {
  return isDriveUploadErrorCode(code)
    ? DRIVE_UPLOAD_ERROR_TEXT[code]
    : DRIVE_UPLOAD_ERROR_TEXT.unknown;
}

export class DriveUploadError extends Error {
  readonly code: DriveUploadErrorCode;
  // HTTP 상태·Google 오류 reason 등 짧은 참고값(토큰 값은 넣지 않는다).
  readonly detail?: string;

  constructor(code: DriveUploadErrorCode, detail?: string) {
    super(
      detail
        ? `${DRIVE_UPLOAD_ERROR_TEXT[code]} (${detail})`
        : DRIVE_UPLOAD_ERROR_TEXT[code],
    );
    this.name = 'DriveUploadError';
    this.code = code;
    this.detail = detail;
  }
}

// drive-upload IPC 응답 형식(오류는 코드로 직렬화 — Electron invoke 오류 접두어 회피).
export type DriveUploadResult =
  | { ok: true; file: DriveFileMeta }
  | { ok: false; code: DriveUploadErrorCode; detail?: string };

// drive-list / drive-download / drive-trash IPC 응답 형식(③).
export type DriveListIpcResult =
  | ({ ok: true } & DriveListResult)
  | { ok: false; code: DriveUploadErrorCode; detail?: string };
export type DriveDownloadIpcResult =
  | { ok: true; path: string }
  | { ok: false; code: DriveUploadErrorCode; detail?: string };
export type DriveTrashIpcResult =
  | { ok: true }
  | { ok: false; code: DriveUploadErrorCode; detail?: string };

export const DRIVE_FILE_CHANNEL = {
  upload: 'drive-upload',
  uploadCancel: 'drive-upload-cancel',
  uploadProgress: 'drive-upload-progress',
  openFile: 'drive-open-file',
  // ③ 목록·받기·휴지통
  list: 'drive-list',
  download: 'drive-download',
  downloadCancel: 'drive-download-cancel',
  downloadProgress: 'drive-download-progress',
  trash: 'drive-trash',
  cleanupDownload: 'drive-cleanup-download',
} as const;

// 드라이브 파일 id 형식(영숫자·-·_). 경로 조립 전에 반드시 검사한다.
export function isDriveFileId(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v);
}

// 드라이브 웹 주소만 브라우저로 연다(임의 URL 실행 방지).
export function isDriveWebUrl(url: unknown): url is string {
  return typeof url === 'string' && url.startsWith('https://drive.google.com/');
}

const TOKEN_FILE_PREFIX = 'sdstudio-token-';

// NovelAI 토큰 파일 판정 — kind 또는 파일 이름(경로 포함 가능, 대소문자 무시) 중 하나라도 맞으면 참.
export function isTokenExport(kind: unknown, fileName?: unknown): boolean {
  if (kind === 'token') return true;
  if (typeof fileName !== 'string') return false;
  const base = fileName.replace(/\\/g, '/').split('/').pop() || '';
  return base.toLowerCase().startsWith(TOKEN_FILE_PREFIX);
}
