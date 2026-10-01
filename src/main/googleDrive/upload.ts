// Google 드라이브 연동 — SDStudio 폴더 확보·resumable 올리기 (드라이브 API ②, 2026-09-28)
//
// - 모든 요청은 main 에서(access token 은 renderer 로 나가지 않는다). 요청 조립·응답 해석은
//   driveApi.ts 순수 함수, 여기는 순서·재시도·파일 읽기만.
// - 올리기는 크기와 관계없이 resumable 단일 경로(작은 JSON 도 같은 길 — 분기 없이 단순하게).
//   청크 8 MiB 를 파일에서 읽어 세션 URI 에 PUT, 308 이면 Range 로 다음 위치, 네트워크 끊김·
//   5xx·429 는 `Content-Range: bytes */total` 빈 PUT 으로 서버가 받은 위치를 물은 뒤 이어서 보낸다.
// - 취소: AbortSignal(IPC drive-upload-cancel). 진행 중 요청을 끊고 DriveUploadError('cancelled').
// - SDStudio 폴더 id 는 메모리에만 캐시하고, 쓸 때마다 files.get(id,trashed)로 확인한다
//   (휴지통·삭제·다른 계정이면 다시 찾거나 만든다). 인증 파일에는 저장하지 않는다.
// - NovelAI 토큰 파일은 거부한다(renderer 목적지 제외와 2중 방벽).

import os from 'os';
import { promises as fsp } from 'fs';
import { app } from 'electron';
import log from 'electron-log';
import { DriveAuthError } from '../../shared/googleDriveAuth';
import {
  DriveFileMeta,
  DriveUploadError,
  DriveUploadErrorCode,
  DriveUploadProgress,
  DriveUploadRequest,
  DriveUploadResult,
  isTokenExport,
} from '../../shared/googleDrive';
import { getAccessToken, invalidateAccessToken } from './index';
import { httpRequestRaw, HttpRawResult } from './http';
import {
  backoffDelayMs,
  buildFileMetadata,
  buildFolderCreateBody,
  CHUNK_TIMEOUT_MS,
  classifyDriveResponse,
  fileGetUrl,
  filesListUrl,
  firstFileId,
  firstFolderInfo,
  folderCreateUrl,
  isUsableFolder,
  MAX_BACKOFF_RETRIES,
  nextOffsetFromRange,
  parseFolderInfo,
  parseUploadedFile,
  ROOT_FOLDER_FIELDS,
  planChunk,
  resolveExportsSource,
  resumableInitUrl,
  rootFolderNameQuery,
  rootFolderQuery,
  shouldRetry,
  statusQueryContentRange,
  uploadDisplayName,
  uploadMimeType,
} from './driveApi';

// 작은 JSON 요청(폴더 조회·세션 시작)의 네트워크 끊김 재시도 횟수(오프라인에서 오래 기다리지 않게).
const JSON_NETWORK_RETRIES = 2;

// ③(download.ts·manage.ts)도 아래 공용 헬퍼(오류 변환·취소·대기·인증 요청)를 그대로 쓴다.
export function toUploadError(e: unknown): DriveUploadError {
  if (e instanceof DriveUploadError) return e;
  if (e instanceof DriveAuthError) return new DriveUploadError(e.code, e.detail);
  return new DriveUploadError('unknown');
}

export function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DriveUploadError('cancelled');
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DriveUploadError('cancelled'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DriveUploadError('cancelled'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function accessTokenOrThrow(): Promise<string> {
  try {
    return await getAccessToken();
  } catch (e) {
    throw toUploadError(e);
  }
}

export interface DriveRequestInit {
  method: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
}

// 인증·재시도를 붙인 요청. 2xx·308·passStatuses 는 응답을 그대로 돌려주고, 나머지는 DriveUploadError.
export async function driveRequest(
  url: string,
  init: DriveRequestInit,
  opts: {
    signal?: AbortSignal;
    timeoutMs?: number;
    networkRetries?: number;
    passStatuses?: number[];
    // 재시도하지 않는 실패의 코드(기본 upload-failed — ③ 목록·휴지통은 request-failed).
    failCode?: DriveUploadErrorCode;
  } = {},
): Promise<HttpRawResult> {
  const networkRetries = opts.networkRetries ?? JSON_NETWORK_RETRIES;
  let attempt = 0;
  let authRetried = false;
  for (;;) {
    throwIfAborted(opts.signal);
    const token = await accessTokenOrThrow();
    let r: HttpRawResult;
    try {
      r = await httpRequestRaw(
        url,
        {
          method: init.method,
          headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
          body: init.body,
          signal: opts.signal,
        },
        opts.timeoutMs,
      );
    } catch (e) {
      const err = toUploadError(e);
      if (err.code === 'network' && attempt < networkRetries) {
        await sleep(backoffDelayMs(attempt++), opts.signal);
        continue;
      }
      throw err;
    }
    if (opts.passStatuses?.includes(r.status)) return r;
    const c = classifyDriveResponse(r.status, r.body, opts.failCode);
    if (c.kind === 'ok' || c.kind === 'incomplete') return r;
    if (c.kind === 'auth') {
      if (!authRetried) {
        authRetried = true;
        invalidateAccessToken(token);
        continue;
      }
      throw new DriveUploadError('expired', 'HTTP 401');
    }
    if (c.kind === 'backoff' && shouldRetry(attempt)) {
      await sleep(backoffDelayMs(attempt++), opts.signal);
      continue;
    }
    throw new DriveUploadError(c.code, c.detail);
  }
}

export function jsonInit(method: string, body?: unknown): DriveRequestInit {
  return body === undefined
    ? { method }
    : {
        method,
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify(body),
      };
}

// ─── SDStudio 폴더 ───

// 폴더 id 와 드라이브 웹 주소(백업 관리 창 [드라이브에서 열기] — ③).
export interface RootFolderInfo {
  id: string;
  webViewLink?: string;
}

let cachedRootFolder: RootFolderInfo | null = null;
let rootFolderPromise: Promise<RootFolderInfo> | null = null;

async function findFolder(q: string, signal?: AbortSignal): Promise<RootFolderInfo | null> {
  const r = await driveRequest(filesListUrl(q), jsonInit('GET'), { signal });
  const info = firstFolderInfo(r.body);
  if (info) return info;
  const id = firstFileId(r.body);
  return id ? { id } : null;
}

async function resolveRootFolder(
  signal: AbortSignal | undefined,
  create: boolean,
): Promise<RootFolderInfo | null> {
  if (cachedRootFolder) {
    const r = await driveRequest(
      fileGetUrl(cachedRootFolder.id, ROOT_FOLDER_FIELDS),
      jsonInit('GET'),
      { signal, passStatuses: [404] },
    );
    if (r.status !== 404 && isUsableFolder(r.body)) {
      const link = parseFolderInfo(r.body)?.webViewLink;
      if (link) cachedRootFolder = { ...cachedRootFolder, webViewLink: link };
      return cachedRootFolder;
    }
    cachedRootFolder = null;
  }
  let info = await findFolder(rootFolderQuery(), signal);
  if (!info) info = await findFolder(rootFolderNameQuery(), signal);
  if (!info) {
    // 목록·휴지통(③)은 폴더를 만들지 않는다 — 없으면 null.
    if (!create) return null;
    const r = await driveRequest(folderCreateUrl(), jsonInit('POST', buildFolderCreateBody()), {
      signal,
    });
    info = parseFolderInfo(r.body);
    if (!info) throw new DriveUploadError('server', 'folder id');
    log.info('[googleDrive] SDStudio 폴더를 만들었습니다');
  }
  cachedRootFolder = info;
  return info;
}

// 캐시 비우기(jest 전용 — 실행 중에는 매번 files.get 으로 확인하므로 따로 부를 필요 없음).
export function resetRootFolderCache(): void {
  cachedRootFolder = null;
  rootFolderPromise = null;
}

// 동시에 여러 창이 올려도 폴더를 한 번만 찾거나 만든다.
export async function ensureRootFolderInfo(signal?: AbortSignal): Promise<RootFolderInfo> {
  if (!rootFolderPromise) {
    rootFolderPromise = resolveRootFolder(signal, true)
      .then((info) => {
        if (!info) throw new DriveUploadError('server', 'folder id');
        return info;
      })
      .finally(() => {
        rootFolderPromise = null;
      });
  }
  const info = await rootFolderPromise;
  throwIfAborted(signal);
  return info;
}

export async function ensureRootFolder(signal?: AbortSignal): Promise<string> {
  return (await ensureRootFolderInfo(signal)).id;
}

// 있으면 폴더 정보, 없으면 null(만들지 않는다 — 목록·휴지통용). 만드는 중이면 그 결과를 기다린다.
export async function findRootFolderInfo(signal?: AbortSignal): Promise<RootFolderInfo | null> {
  if (rootFolderPromise) {
    try {
      return await rootFolderPromise;
    } catch {
      /* 아래에서 다시 찾는다 */
    }
  }
  return await resolveRootFolder(signal, false);
}

// ─── resumable 올리기 ───

async function startResumableSession(
  metadata: unknown,
  mimeType: string,
  total: number,
  signal?: AbortSignal,
): Promise<string> {
  const r = await driveRequest(
    resumableInitUrl(),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType,
        'X-Upload-Content-Length': String(total),
      },
      body: JSON.stringify(metadata),
    },
    { signal },
  );
  const location = r.header('location');
  if (!location || !location.startsWith('https://')) {
    throw new DriveUploadError('server', 'upload session');
  }
  return location;
}

type SessionState = { done: DriveFileMeta } | { offset: number };

// 세션 URI 에 대한 PUT(청크·위치 질의) 응답 해석. 재시도할 오류는 retry, 그 밖은 throw.
function interpretSessionResponse(
  r: HttpRawResult,
): SessionState | { retry: DriveUploadError } {
  if (r.status === 200 || r.status === 201) {
    const file = parseUploadedFile(r.body);
    if (!file) throw new DriveUploadError('server', 'upload response');
    return { done: file };
  }
  if (r.status === 308) {
    const next = nextOffsetFromRange(r.header('range'));
    if (next === null) throw new DriveUploadError('server', 'Range');
    return { offset: next };
  }
  if (r.status === 404 || r.status === 410) {
    // 세션 만료(1주) 등 — 처음부터 다시 올려야 한다.
    throw new DriveUploadError('upload-failed', `HTTP ${r.status} session expired`);
  }
  const c = classifyDriveResponse(r.status, r.body);
  if (c.kind === 'backoff') return { retry: new DriveUploadError(c.code, c.detail) };
  if (c.kind === 'fail') throw new DriveUploadError(c.code, c.detail);
  throw new DriveUploadError('server', `HTTP ${r.status}`);
}

// 세션 PUT 에서 driveRequest 가 스스로 재시도하지 않고 돌려줄 상태(재개는 uploadChunks 가 한다).
const SESSION_PASS_STATUSES = [403, 404, 410, 429, 500, 502, 503, 504];

async function readChunk(
  fh: fsp.FileHandle,
  start: number,
  length: number,
): Promise<Uint8Array> {
  const buf = new Uint8Array(length);
  let read = 0;
  while (read < length) {
    const { bytesRead } = await fh.read(buf, read, length - read, start + read);
    if (bytesRead === 0) break;
    read += bytesRead;
  }
  if (read !== length) {
    // 올리는 도중 파일이 바뀌었다(잘림).
    throw new DriveUploadError('file-missing', 'size changed');
  }
  return buf;
}

async function uploadChunks(opts: {
  sessionUri: string;
  fh: fsp.FileHandle;
  total: number;
  mimeType: string;
  signal?: AbortSignal;
  onProgress?: (p: DriveUploadProgress) => void;
}): Promise<DriveFileMeta> {
  const { sessionUri, fh, total, mimeType, signal, onProgress } = opts;
  let offset = 0;
  let attempt = 0;
  // 끊김·재시도 뒤에는 서버가 받은 위치부터 다시 확인한다.
  let needQuery = false;
  onProgress?.({ sent: 0, total });

  const waitOrThrow = async (err: DriveUploadError) => {
    if (!shouldRetry(attempt, MAX_BACKOFF_RETRIES)) throw err;
    await sleep(backoffDelayMs(attempt++), signal);
    needQuery = true;
  };

  for (;;) {
    throwIfAborted(signal);
    const plan = needQuery ? null : planChunk(offset, total);
    let r: HttpRawResult;
    try {
      if (plan) {
        const body =
          plan.length > 0 ? await readChunk(fh, plan.start, plan.length) : new Uint8Array(0);
        r = await driveRequest(
          sessionUri,
          {
            method: 'PUT',
            headers: { 'Content-Type': mimeType, 'Content-Range': plan.contentRange },
            body,
          },
          {
            signal,
            timeoutMs: CHUNK_TIMEOUT_MS,
            networkRetries: 0,
            passStatuses: SESSION_PASS_STATUSES,
          },
        );
      } else {
        r = await driveRequest(
          sessionUri,
          { method: 'PUT', headers: { 'Content-Range': statusQueryContentRange(total) }, body: '' },
          { signal, networkRetries: 0, passStatuses: SESSION_PASS_STATUSES },
        );
      }
    } catch (e) {
      const err = toUploadError(e);
      if (err.code === 'network') {
        await waitOrThrow(err);
        continue;
      }
      throw err;
    }

    const state = interpretSessionResponse(r);
    if ('retry' in state) {
      await waitOrThrow(state.retry);
      continue;
    }
    if ('done' in state) {
      onProgress?.({ sent: total, total });
      return state.done;
    }
    if (state.offset > total) throw new DriveUploadError('server', 'Range');
    if (plan && state.offset <= offset) {
      // 청크를 보냈는데 진전 없음 — 재시도 한도 안에서 위치를 다시 묻고 보낸다.
      await waitOrThrow(new DriveUploadError('server', 'no progress'));
      continue;
    }
    if (state.offset > offset) attempt = 0;
    offset = state.offset;
    needQuery = false;
    if (offset >= total && total > 0) {
      // 전부 받았다는데 완료 응답이 없었다 — 위치 질의로 완료 응답을 받는다.
      await waitOrThrow(new DriveUploadError('server', 'no completion'));
      continue;
    }
    onProgress?.({ sent: offset, total });
  }
}

// exports/ 의 내보내기 파일 하나를 드라이브 SDStudio 폴더에 올린다.
export async function uploadExportFile(opts: {
  appDir: string;
  request: DriveUploadRequest;
  signal?: AbortSignal;
  onProgress?: (p: DriveUploadProgress) => void;
}): Promise<DriveFileMeta> {
  const req = opts.request || ({} as DriveUploadRequest);
  // 토큰 방벽(main 측) — 경로 해석보다 먼저.
  if (isTokenExport(req.kind, req.exportsPath) || isTokenExport(undefined, req.name)) {
    throw new DriveUploadError('token-export-forbidden');
  }
  if (typeof req.kind !== 'string' || !req.kind) throw new DriveUploadError('invalid-path', 'kind');
  const source = resolveExportsSource(opts.appDir, req.exportsPath);
  if (!source) throw new DriveUploadError('invalid-path');
  const name = uploadDisplayName(source, req.name);
  if (isTokenExport(undefined, name)) throw new DriveUploadError('token-export-forbidden');

  let size: number;
  try {
    const st = await fsp.stat(source);
    if (!st.isFile()) throw new DriveUploadError('invalid-path', 'not a file');
    size = st.size;
  } catch (e: any) {
    if (e instanceof DriveUploadError) throw e;
    throw new DriveUploadError('file-missing', e?.code);
  }

  // 미연결이면 여기서 바로 not-connected.
  await accessTokenOrThrow();
  throwIfAborted(opts.signal);
  const folderId = await ensureRootFolder(opts.signal);
  const mimeType = uploadMimeType(name);
  const metadata = buildFileMetadata({
    name,
    folderId,
    kind: req.kind,
    appVersion: app.getVersion(),
    device: os.hostname(),
  });

  const fh = await fsp.open(source, 'r').catch((e: any) => {
    throw new DriveUploadError('file-missing', e?.code);
  });
  try {
    const sessionUri = await startResumableSession(metadata, mimeType, size, opts.signal);
    return await uploadChunks({
      sessionUri,
      fh,
      total: size,
      mimeType,
      signal: opts.signal,
      onProgress: opts.onProgress,
    });
  } finally {
    await fh.close().catch(() => {});
  }
}

// IPC 경계용 — 오류를 코드로 직렬화한다.
export async function uploadExportFileForIpc(
  opts: Parameters<typeof uploadExportFile>[0],
): Promise<DriveUploadResult> {
  try {
    return { ok: true, file: await uploadExportFile(opts) };
  } catch (e: any) {
    const err = toUploadError(e);
    if (err.code === 'unknown') {
      log.warn('[googleDrive] 올리기 실패(예상 밖 오류)', e?.name || 'Error', e?.message);
    } else if (err.code !== 'cancelled') {
      log.warn('[googleDrive] 올리기 실패', err.code, err.detail || '');
    }
    return { ok: false, code: err.code, ...(err.detail ? { detail: err.detail } : {}) };
  }
}
