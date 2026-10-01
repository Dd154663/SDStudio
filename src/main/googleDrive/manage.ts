// Google 드라이브 연동 — 백업 목록·휴지통 이동 (드라이브 API ③, 2026-09-28)
//
// - 목록: SDStudio 폴더(표식 → 이름 폴백, 만들지 않음) 바로 아래 파일을 files.list 로 페이지 이어
//   받기(100개씩, 수정 시각 내림차순). 폴더가 아직 없으면 빈 목록.
// - 휴지통: 파일이 SDStudio 폴더 바로 아래의 파일인지 files.get 으로 확인한 뒤
//   files.update {trashed:true}. **files.delete(즉시 영구 삭제)는 호출하지 않는다** — 데이터 안전
//   불변식(영구 삭제 금지)을 드라이브에도 적용. 드라이브 휴지통은 30일 뒤 자동으로 비워진다.

import log from 'electron-log';
import {
  DriveListIpcResult,
  DriveListResult,
  DriveTrashIpcResult,
  DriveUploadError,
  isDriveFileId,
} from '../../shared/googleDrive';
import {
  backupListUrl,
  buildTrashBody,
  fileGetUrl,
  isBackupFileInFolder,
  MAX_LIST_PAGES,
  parseBackupListPage,
  sortBackupItems,
  trashUrl,
} from './driveApi';
import {
  accessTokenOrThrow,
  driveRequest,
  findRootFolderInfo,
  jsonInit,
  toUploadError,
} from './upload';

// 폴더 확보 과정의 실패 코드(upload-failed)는 목록·휴지통 문맥에 맞게 바꾼다.
function toRequestError(e: unknown): DriveUploadError {
  const err = toUploadError(e);
  return err.code === 'upload-failed' ? new DriveUploadError('request-failed', err.detail) : err;
}

export async function listBackups(signal?: AbortSignal): Promise<DriveListResult> {
  await accessTokenOrThrow();
  const root = await findRootFolderInfo(signal);
  if (!root) return { items: [] };
  const items: DriveListResult['items'] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const r = await driveRequest(backupListUrl(root.id, pageToken), jsonInit('GET'), {
      signal,
      failCode: 'request-failed',
    });
    const parsed = parseBackupListPage(r.body);
    items.push(...parsed.items);
    pageToken = parsed.nextPageToken;
    if (!pageToken) break;
  }
  return {
    items: sortBackupItems(items),
    ...(root.webViewLink ? { folderLink: root.webViewLink } : {}),
  };
}

// 드라이브 휴지통으로 옮긴다(영구 삭제 아님). 이미 휴지통이면 그대로 성공.
export async function trashBackupFile(fileId: unknown): Promise<void> {
  if (!isDriveFileId(fileId)) throw new DriveUploadError('not-backup', 'file id');
  await accessTokenOrThrow();
  const root = await findRootFolderInfo();
  if (!root) throw new DriveUploadError('not-found', 'folder');
  if (fileId === root.id) throw new DriveUploadError('not-backup', 'folder');
  const meta = await driveRequest(
    fileGetUrl(fileId, 'id,parents,mimeType,trashed'),
    jsonInit('GET'),
    { passStatuses: [404], failCode: 'request-failed' },
  );
  if (meta.status === 404) throw new DriveUploadError('not-found', 'HTTP 404');
  if (!isBackupFileInFolder(meta.body, root.id)) throw new DriveUploadError('not-backup');
  if ((meta.body as any)?.trashed === true) return;
  const r = await driveRequest(trashUrl(fileId), jsonInit('PATCH', buildTrashBody()), {
    passStatuses: [404],
    failCode: 'request-failed',
  });
  if (r.status === 404) throw new DriveUploadError('not-found', 'HTTP 404');
}

// ─── IPC 경계용(오류를 코드로 직렬화) ───

function failure(e: unknown, what: string) {
  const err = toRequestError(e);
  if (err.code === 'unknown') {
    log.warn(`[googleDrive] ${what} 실패(예상 밖 오류)`, (e as any)?.name || 'Error', (e as any)?.message);
  } else if (err.code !== 'cancelled') {
    log.warn(`[googleDrive] ${what} 실패`, err.code, err.detail || '');
  }
  return { ok: false as const, code: err.code, ...(err.detail ? { detail: err.detail } : {}) };
}

export async function listBackupsForIpc(): Promise<DriveListIpcResult> {
  try {
    return { ok: true, ...(await listBackups()) };
  } catch (e) {
    return failure(e, '목록');
  }
}

export async function trashBackupFileForIpc(fileId: unknown): Promise<DriveTrashIpcResult> {
  try {
    await trashBackupFile(fileId);
    return { ok: true };
  } catch (e) {
    return failure(e, '휴지통 이동');
  }
}
