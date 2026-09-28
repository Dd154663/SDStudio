// Google 드라이브 연동 — Drive API 요청 조립·응답 해석 순수 함수 (드라이브 API ②, 2026-09-28)
//
// 네트워크·파일 접근 없음(jest: src/main/__tests__/googleDriveApi.test.ts). 실제 호출은 upload.ts.
// - SDStudio 폴더: appProperties {sdstudio:'root'} 표식으로 찾고, 없으면 내 드라이브 최상위의
//   「SDStudio」 폴더(앱이 만든 것만 보임 — drive.file), 그래도 없으면 표식을 달아 새로 만든다.
// - 올린 파일: appProperties {sdstudio:'backup', kind, app, appVersion, device}.
//   Drive 한도 = 파일당 30개, 키+값 UTF-8 합 124바이트 → 값은 바이트 기준으로 자른다.
// - resumable 업로드: 청크 8 MiB(256 KiB 배수 필수, 마지막 청크만 예외), 308 의 Range 로 다음 위치.
// - 오류 분류: 401 → 토큰 갱신 후 1회 재시도, 429·5xx·403(요청 한도 사유) → 지수 백오프 최대 5회.

import path from 'path';
import type { DriveFileMeta, DriveUploadErrorCode } from '../../shared/googleDrive';

export const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
export const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3/files';
export const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';
export const SDSTUDIO_FOLDER_NAME = 'SDStudio';
export const APP_PROPERTY_ROOT = { key: 'sdstudio', value: 'root' } as const;
export const APP_PROPERTY_BACKUP_VALUE = 'backup';

// 파일 응답에 요청할 필드(올리기 완료 응답·폴더 조회 공용).
export const UPLOADED_FILE_FIELDS = 'id,name,size,webViewLink';

export const RESUMABLE_CHUNK_UNIT = 256 * 1024;
export const UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024; // 256 KiB × 32
export const MAX_BACKOFF_RETRIES = 5;
export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_MAX_MS = 32 * 1000;
// 청크 PUT 한 번의 제한 시간(느린 회선에서 8 MiB 를 올릴 여유).
export const CHUNK_TIMEOUT_MS = 5 * 60 * 1000;

// Drive 제한: 키+값 UTF-8 바이트 합.
export const APP_PROPERTY_MAX_BYTES = 124;
export const APP_PROPERTY_MAX_COUNT = 30;

// ─── 검색 쿼리 ───

// q 문자열 리터럴 이스케이프(역슬래시·작은따옴표).
export function escapeQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function rootFolderQuery(): string {
  return (
    `mimeType='${DRIVE_FOLDER_MIME}' and trashed=false and ` +
    `appProperties has { key='${APP_PROPERTY_ROOT.key}' and value='${APP_PROPERTY_ROOT.value}' }`
  );
}

// 표식 없는 이전 폴더 폴백: 내 드라이브 최상위의 같은 이름 폴더.
export function rootFolderNameQuery(name = SDSTUDIO_FOLDER_NAME): string {
  return (
    `mimeType='${DRIVE_FOLDER_MIME}' and trashed=false and ` +
    `name='${escapeQueryValue(name)}' and 'root' in parents`
  );
}

export function filesListUrl(q: string): string {
  const params = new URLSearchParams({
    q,
    spaces: 'drive',
    pageSize: '10',
    orderBy: 'createdTime',
    fields: 'files(id,name)',
  });
  return `${DRIVE_API_BASE}/files?${params.toString()}`;
}

export function fileGetUrl(fileId: string, fields: string): string {
  return `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(fields)}`;
}

export function folderCreateUrl(): string {
  return `${DRIVE_API_BASE}/files?fields=${encodeURIComponent('id,name')}`;
}

export function buildFolderCreateBody(name = SDSTUDIO_FOLDER_NAME) {
  return {
    name,
    mimeType: DRIVE_FOLDER_MIME,
    appProperties: { [APP_PROPERTY_ROOT.key]: APP_PROPERTY_ROOT.value },
  };
}

// files.list 응답의 첫 파일 id(없으면 undefined).
export function firstFileId(body: unknown): string | undefined {
  const files = (body as any)?.files;
  if (!Array.isArray(files)) return undefined;
  for (const f of files) {
    if (f && typeof f.id === 'string' && f.id) return f.id;
  }
  return undefined;
}

// files.get?fields=id,trashed 응답이 쓸 수 있는 폴더인지.
export function isUsableFolder(body: unknown): boolean {
  const b = body as any;
  return !!b && typeof b.id === 'string' && b.id !== '' && b.trashed !== true;
}

// ─── appProperties ───

function utf8Bytes(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

// 키+값이 maxBytes 를 넘지 않게 값을 자른다(코드 포인트 중간에서 자르지 않음).
// 키만으로 한도를 넘으면 빈 문자열.
export function truncateAppPropertyValue(
  key: string,
  value: string,
  maxBytes = APP_PROPERTY_MAX_BYTES,
): string {
  const budget = maxBytes - utf8Bytes(key);
  if (budget <= 0) return '';
  if (utf8Bytes(value) <= budget) return value;
  let out = '';
  let used = 0;
  for (const ch of value) {
    const b = utf8Bytes(ch);
    if (used + b > budget) break;
    out += ch;
    used += b;
  }
  return out;
}

// 빈 값은 빼고, 값은 바이트 한도로 자르고, 개수는 30개까지.
export function buildAppProperties(
  props: Record<string, string | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  let count = 0;
  for (const [key, raw] of Object.entries(props)) {
    if (count >= APP_PROPERTY_MAX_COUNT) break;
    if (typeof raw !== 'string') continue;
    const value = truncateAppPropertyValue(key, raw.trim());
    if (!value) continue;
    out[key] = value;
    count++;
  }
  return out;
}

export function buildFileMetadata(opts: {
  name: string;
  folderId: string;
  kind: string;
  appVersion?: string;
  device?: string;
}) {
  return {
    name: opts.name,
    parents: [opts.folderId],
    appProperties: buildAppProperties({
      [APP_PROPERTY_ROOT.key]: APP_PROPERTY_BACKUP_VALUE,
      kind: opts.kind,
      app: 'SDStudio',
      appVersion: opts.appVersion,
      device: opts.device,
    }),
  };
}

export function uploadMimeType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.tar') return 'application/x-tar';
  if (ext === '.json') return 'application/json';
  if (ext === '.zip') return 'application/zip';
  return 'application/octet-stream';
}

export function resumableInitUrl(): string {
  return `${DRIVE_UPLOAD_BASE}?uploadType=resumable&fields=${encodeURIComponent(UPLOADED_FILE_FIELDS)}`;
}

// ─── resumable 청크 ───

export interface ChunkPlan {
  start: number;
  // 마지막 바이트 위치(포함). 빈 파일이면 -1.
  end: number;
  length: number;
  contentRange: string;
  last: boolean;
}

export function assertValidChunkSize(chunkSize: number): void {
  if (
    !Number.isInteger(chunkSize) ||
    chunkSize <= 0 ||
    chunkSize % RESUMABLE_CHUNK_UNIT !== 0
  ) {
    throw new Error(`청크 크기는 256 KiB 의 배수여야 합니다: ${chunkSize}`);
  }
}

export function contentRangeHeader(start: number, end: number, total: number): string {
  return `bytes ${start}-${end}/${total}`;
}

// 중단 뒤 서버에 받은 위치를 묻는 빈 PUT 의 Content-Range.
export function statusQueryContentRange(total: number): string {
  return `bytes */${total}`;
}

// offset 에서 시작하는 다음 청크. 빈 파일은 본문 없는 단일 청크(bytes */0).
export function planChunk(
  offset: number,
  total: number,
  chunkSize = UPLOAD_CHUNK_SIZE,
): ChunkPlan {
  assertValidChunkSize(chunkSize);
  if (total <= 0) {
    return { start: 0, end: -1, length: 0, contentRange: statusQueryContentRange(0), last: true };
  }
  if (offset < 0 || offset >= total) {
    throw new Error(`올리기 위치가 파일 범위를 벗어났습니다: ${offset}/${total}`);
  }
  const length = Math.min(chunkSize, total - offset);
  const end = offset + length - 1;
  return {
    start: offset,
    end,
    length,
    contentRange: contentRangeHeader(offset, end, total),
    last: end === total - 1,
  };
}

// 전체 청크 목록(테스트·계획 확인용).
export function planAllChunks(total: number, chunkSize = UPLOAD_CHUNK_SIZE): ChunkPlan[] {
  const chunks: ChunkPlan[] = [];
  if (total <= 0) return [planChunk(0, 0, chunkSize)];
  let offset = 0;
  while (offset < total) {
    const c = planChunk(offset, total, chunkSize);
    chunks.push(c);
    offset = c.end + 1;
  }
  return chunks;
}

// 308 응답의 Range 헤더("bytes=0-524287") → 다음에 보낼 위치(524288).
// 헤더가 없으면 서버가 아직 아무 바이트도 받지 않은 것 → 0. 해석 불가면 null.
export function nextOffsetFromRange(range: string | null | undefined): number | null {
  if (range === null || range === undefined || range.trim() === '') return 0;
  const m = /^\s*bytes\s*=\s*(\d+)\s*-\s*(\d+)\s*$/i.exec(range);
  if (!m) return null;
  const start = Number(m[1]);
  const end = Number(m[2]);
  if (start !== 0 || end < start) return null;
  return end + 1;
}

// ─── 응답 해석 ───

export function parseUploadedFile(body: unknown): DriveFileMeta | null {
  const b = body as any;
  if (!b || typeof b.id !== 'string' || !b.id) return null;
  const size = typeof b.size === 'string' || typeof b.size === 'number' ? Number(b.size) : NaN;
  return {
    id: b.id,
    name: typeof b.name === 'string' ? b.name : '',
    ...(Number.isFinite(size) ? { size } : {}),
    ...(typeof b.webViewLink === 'string' ? { webViewLink: b.webViewLink } : {}),
  };
}

// Google 오류 응답의 reason(예: storageQuotaExceeded). 없으면 status 문자열.
export function driveErrorReason(body: unknown): string | undefined {
  const err = (body as any)?.error;
  if (!err || typeof err !== 'object') return undefined;
  const first = Array.isArray(err.errors) ? err.errors[0] : undefined;
  const reason = first && typeof first.reason === 'string' ? first.reason : undefined;
  if (reason) return reason.slice(0, 60);
  return typeof err.status === 'string' ? err.status.slice(0, 60) : undefined;
}

const RATE_LIMIT_REASONS = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'backendError',
  'RESOURCE_EXHAUSTED',
]);
const QUOTA_REASONS = new Set(['storageQuotaExceeded', 'quotaExceeded', 'teamDriveFileLimitExceeded']);

export type DriveResponseClass =
  | { kind: 'ok' }
  | { kind: 'incomplete' } // 308 — resumable 진행 중
  | { kind: 'auth' } // 401 — 토큰 갱신 후 1회 재시도
  | { kind: 'backoff'; code: DriveUploadErrorCode; detail: string }
  | { kind: 'fail'; code: DriveUploadErrorCode; detail: string };

export function classifyDriveResponse(status: number, body: unknown): DriveResponseClass {
  if (status >= 200 && status < 300) return { kind: 'ok' };
  if (status === 308) return { kind: 'incomplete' };
  const reason = driveErrorReason(body);
  const detail = reason ? `HTTP ${status} ${reason}` : `HTTP ${status}`;
  if (status === 401) return { kind: 'auth' };
  if (status === 429) return { kind: 'backoff', code: 'rate-limited', detail };
  if (status === 403) {
    if (reason && QUOTA_REASONS.has(reason)) return { kind: 'fail', code: 'quota-exceeded', detail };
    if (reason && RATE_LIMIT_REASONS.has(reason)) {
      return { kind: 'backoff', code: 'rate-limited', detail };
    }
    return { kind: 'fail', code: 'upload-failed', detail };
  }
  if (status >= 500) return { kind: 'backoff', code: 'server', detail };
  return { kind: 'fail', code: 'upload-failed', detail };
}

// 재시도 대기 시간: 1s·2s·4s·8s·16s(+0~1s 무작위), 최대 32s. attempt 는 0부터.
export function backoffDelayMs(attempt: number, random = Math.random()): number {
  const base = Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempt), BACKOFF_MAX_MS);
  const jitter = Math.floor(Math.max(0, Math.min(1, random)) * 1000);
  return Math.min(base + jitter, BACKOFF_MAX_MS);
}

export function shouldRetry(attempt: number, max = MAX_BACKOFF_RETRIES): boolean {
  return attempt < max;
}

// ─── 로컬 경로 ───

// renderer 가 준 'exports/…' 상대 경로를 APP_DIR 기준 절대 경로로(publish-export 와 같은 규칙).
// exports/ 밖·상위 이동·exports 폴더 자체는 null.
export function resolveExportsSource(appDir: string, arg: unknown): string | null {
  if (typeof arg !== 'string') return null;
  const normalized = arg.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized.startsWith('exports/') || normalized.includes('../')) return null;
  const exportRoot = path.resolve(appDir, 'exports');
  const source = path.resolve(appDir, normalized);
  const rel = path.relative(exportRoot, source);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return source;
}

// 드라이브에 보일 이름: 요청 이름(경로 구분자 제거) 또는 원본 파일 이름.
export function uploadDisplayName(sourcePath: string, requested?: unknown): string {
  if (typeof requested === 'string') {
    const clean = requested.replace(/[\\/]/g, '_').trim();
    if (clean) return clean;
  }
  return path.basename(sourcePath);
}
