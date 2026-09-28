// Google 드라이브 연동 — 파일 작업(올리기) main·renderer 공용 타입·오류·채널 (드라이브 API ②, 2026-09-28)
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

export type DriveUploadErrorCode =
  | DriveAuthErrorCode
  | 'token-export-forbidden'
  | 'invalid-path'
  | 'file-missing'
  | 'quota-exceeded'
  | 'rate-limited'
  | 'upload-failed';

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
};

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

export const DRIVE_FILE_CHANNEL = {
  upload: 'drive-upload',
  uploadCancel: 'drive-upload-cancel',
  uploadProgress: 'drive-upload-progress',
  openFile: 'drive-open-file',
} as const;

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
