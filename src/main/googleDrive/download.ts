// Google 드라이브 연동 — 백업 파일 받기 (드라이브 API ③, 2026-09-28)
//
// - `GET files/<id>?alt=media` 를 스트리밍으로 받아 `<파일>.part` 에 쓰고, 다 받으면 rename
//   (zip-files 의 .part → rename 관례). 메모리에 파일 전체를 모으지 않는다.
// - 목적지: 기본 = APP_DIR/tmp/drive-download/<fileId>/<정제한 파일 이름>(불러오기 흐름이 이 경로를
//   그대로 쓴 뒤 renderer 가 drive-cleanup-download 로 폴더째 지운다). toDownloads = OS 다운로드
//   폴더(같은 이름이면 " (n)" 접미 — publish-export 와 같은 규칙), 임시 폴더는 여기서 지운다.
// - 재시도: 5xx·429·403(요청 한도)·끊김·60초 무응답 → 처음부터 다시 받기 최대 3회(청크 재개 없음).
//   401 → access token 갱신 후 1회. 404 → not-found.
// - 취소(AbortSignal)·실패 시 .part 와 임시 폴더를 지운다.
// - NovelAI 토큰 파일(sdstudio-token-…)은 앱 안으로 받지 않는다(toDownloads 만 허용 — renderer
//   라우팅 거부와 2중 방벽).

import path from 'path';
import { promises as fsp } from 'fs';
import log from 'electron-log';
import {
  DriveDownloadIpcResult,
  DriveDownloadProgress,
  DriveDownloadRequest,
  DriveUploadError,
  isDriveFileId,
  isTokenExport,
} from '../../shared/googleDrive';
import { DriveAuthError } from '../../shared/googleDriveAuth';
import { httpRequestStream, HttpStreamResult } from './http';
import { invalidateAccessToken } from './index';
import {
  backoffDelayMs,
  classifyDriveResponse,
  DOWNLOAD_IDLE_TIMEOUT_MS,
  DOWNLOAD_MAX_RETRIES,
  DOWNLOAD_PROGRESS_STEP,
  downloadDirFor,
  downloadTotal,
  fileMediaUrl,
  sanitizeDownloadName,
  shouldRetry,
} from './driveApi';
import { accessTokenOrThrow, sleep, throwIfAborted, toUploadError } from './upload';

// 다운로드 폴더에서 겹치지 않는 이름 고르기(main.ts moveExportToDownloads 와 같은 모양).
async function uniqueDestination(dir: string, fileName: string): Promise<string> {
  const parsed = path.parse(fileName);
  let destination = path.join(dir, fileName);
  let suffix = 1;
  for (;;) {
    try {
      await fsp.access(destination);
      destination = path.join(dir, `${parsed.name} (${suffix++})${parsed.ext}`);
    } catch (e: any) {
      if (e?.code === 'ENOENT') return destination;
      throw e;
    }
  }
}

async function moveFile(source: string, destination: string): Promise<void> {
  try {
    await fsp.rename(source, destination);
  } catch (e: any) {
    if (e?.code !== 'EXDEV') throw e;
    await fsp.copyFile(source, destination);
    await fsp.unlink(source).catch(() => {});
  }
}

async function removeQuietly(target: string, recursive = false): Promise<void> {
  try {
    await fsp.rm(target, { force: true, recursive });
  } catch {
    /* 정리 실패는 무시(다음 받기·정리 요청에서 다시 지운다) */
  }
}

type AttemptOutcome = { ok: true } | { retry: DriveUploadError } | { reauth: string };

// 한 번 받기 시도. 성공하면 partPath 에 total 바이트가 쓰여 있다.
async function attemptDownload(opts: {
  fileId: string;
  partPath: string;
  expectedSize?: number;
  signal?: AbortSignal;
  onProgress?: (p: DriveDownloadProgress) => void;
}): Promise<AttemptOutcome> {
  const token = await accessTokenOrThrow();
  throwIfAborted(opts.signal);

  // 이 시도 전용 신호: 외부 취소 + 무응답 제한.
  const controller = new AbortController();
  let idle = false;
  const onExternal = () => controller.abort();
  if (opts.signal) opts.signal.addEventListener('abort', onExternal, { once: true });
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idle = true;
      controller.abort();
    }, DOWNLOAD_IDLE_TIMEOUT_MS);
  };
  const disarm = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    opts.signal?.removeEventListener('abort', onExternal);
  };
  // 외부 취소가 아닌 중단(무응답)·끊김은 재시도 대상.
  const asRetryOrThrow = (e: unknown): AttemptOutcome => {
    if (opts.signal?.aborted) throw new DriveUploadError('cancelled');
    const err = toUploadError(e);
    if (idle || err.code === 'network' || err.code === 'cancelled') {
      return { retry: new DriveUploadError('network', idle ? 'idle timeout' : err.detail) };
    }
    throw err;
  };

  let r: HttpStreamResult;
  try {
    r = await httpRequestStream(fileMediaUrl(opts.fileId), {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
  } catch (e) {
    disarm();
    return asRetryOrThrow(e);
  }

  if (r.status < 200 || r.status >= 300) {
    disarm();
    if (r.status === 404) throw new DriveUploadError('not-found', 'HTTP 404');
    const c = classifyDriveResponse(r.status, r.body, 'download-failed');
    if (c.kind === 'auth') return { reauth: token };
    if (c.kind === 'backoff') return { retry: new DriveUploadError(c.code, c.detail) };
    if (c.kind === 'fail') throw new DriveUploadError(c.code, c.detail);
    throw new DriveUploadError('download-failed', `HTTP ${r.status}`);
  }

  const total = downloadTotal(opts.expectedSize, r.header('content-length'));
  let received = 0;
  let lastReported = 0;
  opts.onProgress?.({ received: 0, total });
  let fh: fsp.FileHandle | null = null;
  try {
    fh = await fsp.open(opts.partPath, 'w');
    armIdle();
    for await (const chunk of r.chunks || []) {
      armIdle();
      let written = 0;
      while (written < chunk.byteLength) {
        const { bytesWritten } = await fh.write(chunk, written, chunk.byteLength - written);
        written += bytesWritten;
      }
      received += chunk.byteLength;
      if (received - lastReported >= DOWNLOAD_PROGRESS_STEP) {
        lastReported = received;
        opts.onProgress?.({ received, total });
      }
    }
  } catch (e: any) {
    disarm();
    await fh?.close().catch(() => {});
    const isDriveError = e instanceof DriveAuthError || e instanceof DriveUploadError;
    if (!isDriveError && typeof e?.code === 'string') {
      // 디스크 쓰기·열기 오류(ENOSPC·EACCES 등) — 다시 받아도 같다.
      throw new DriveUploadError('download-failed', e.code.slice(0, 40));
    }
    return asRetryOrThrow(e);
  }
  disarm();
  await fh.close();
  if (opts.signal?.aborted) throw new DriveUploadError('cancelled');
  if (total > 0 && received !== total) {
    // 중간에 끊긴 응답(크기 불일치) — 처음부터 다시.
    return { retry: new DriveUploadError('network', 'size mismatch') };
  }
  opts.onProgress?.({ received, total: total || received });
  return { ok: true };
}

// 드라이브 파일 하나를 받는다. 반환 = 저장된 절대 경로.
export async function downloadDriveFile(opts: {
  appDir: string;
  // toDownloads 목적지(생략하면 electron app.getPath('downloads') — main.ts 가 넘긴다).
  downloadsDir?: string;
  request: DriveDownloadRequest;
  signal?: AbortSignal;
  onProgress?: (p: DriveDownloadProgress) => void;
}): Promise<string> {
  const req = opts.request || ({} as DriveDownloadRequest);
  if (!isDriveFileId(req.fileId)) throw new DriveUploadError('not-backup', 'file id');
  const dir = downloadDirFor(opts.appDir, req.fileId);
  if (!dir) throw new DriveUploadError('not-backup', 'file id');
  const localName = sanitizeDownloadName(req.name, `drive-${req.fileId}`);
  const toDownloads = req.toDownloads === true;
  if (!toDownloads && isTokenExport(undefined, localName)) {
    throw new DriveUploadError('token-download-forbidden');
  }
  if (toDownloads && !opts.downloadsDir) throw new DriveUploadError('invalid-path', 'downloads');

  // 미연결이면 여기서 바로 not-connected.
  await accessTokenOrThrow();
  throwIfAborted(opts.signal);

  await removeQuietly(dir, true);
  await fsp.mkdir(dir, { recursive: true });
  const finalTmp = path.join(dir, localName);
  const partPath = finalTmp + '.part';

  try {
    let attempt = 0;
    let reauthed = false;
    for (;;) {
      throwIfAborted(opts.signal);
      const outcome = await attemptDownload({
        fileId: req.fileId,
        partPath,
        expectedSize: typeof req.size === 'number' ? req.size : undefined,
        signal: opts.signal,
        onProgress: opts.onProgress,
      });
      if ('ok' in outcome) break;
      if ('reauth' in outcome) {
        if (reauthed) throw new DriveUploadError('expired', 'HTTP 401');
        reauthed = true;
        invalidateAccessToken(outcome.reauth);
        continue;
      }
      if (!shouldRetry(attempt, DOWNLOAD_MAX_RETRIES)) throw outcome.retry;
      await sleep(backoffDelayMs(attempt++), opts.signal);
    }
    await fsp.rename(partPath, finalTmp);
  } catch (e) {
    await removeQuietly(dir, true);
    throw toUploadError(e);
  }

  if (!toDownloads) return finalTmp;
  try {
    const destination = await uniqueDestination(opts.downloadsDir!, localName);
    await moveFile(finalTmp, destination);
    return destination;
  } catch (e: any) {
    throw new DriveUploadError('download-failed', e?.code || 'move');
  } finally {
    await removeQuietly(dir, true);
  }
}

// IPC 경계용 — 오류를 코드로 직렬화한다.
export async function downloadDriveFileForIpc(
  opts: Parameters<typeof downloadDriveFile>[0],
): Promise<DriveDownloadIpcResult> {
  try {
    return { ok: true, path: await downloadDriveFile(opts) };
  } catch (e: any) {
    const err = toUploadError(e);
    if (err.code === 'unknown') {
      log.warn('[googleDrive] 받기 실패(예상 밖 오류)', e?.name || 'Error', e?.message);
    } else if (err.code !== 'cancelled') {
      log.warn('[googleDrive] 받기 실패', err.code, err.detail || '');
    }
    return { ok: false, code: err.code, ...(err.detail ? { detail: err.detail } : {}) };
  }
}

// 받은 임시 폴더(tmp/drive-download/<fileId>)를 지운다. id 형식이 아니면 아무것도 하지 않는다.
export async function cleanupDriveDownload(appDir: string, fileId: unknown): Promise<void> {
  const dir = downloadDirFor(appDir, fileId);
  if (!dir) return;
  await removeQuietly(dir, true);
}
