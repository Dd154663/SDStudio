/**
 * @jest-environment node
 */
// Google 드라이브 연동 ③ — 목록·받기·휴지통.
// 순수 함수(목록 쿼리·항목 변환·정렬·파일 이름 정제·임시 폴더·휴지통 본문)와, HTTP 를 가짜로 바꾼
// 절차(목록 페이지 이어 받기·폴더 없으면 만들지 않음·휴지통=PATCH trashed 만·받기 성공/취소/401/5xx/
// 끊김/크기 불일치/토큰 거부/다운로드 폴더 저장). 실제 Google 호출 없음.
import fs from 'fs';
import os from 'os';
import path from 'path';

const mockHttp = jest.fn();
const mockStream = jest.fn();
const mockGetAccessToken = jest.fn(async () => 'tok-1');
const mockInvalidate = jest.fn();
jest.mock('electron', () => ({ app: { getVersion: () => '5.4.0' }, net: {} }));
jest.mock('electron-log', () => ({ info: jest.fn(), warn: jest.fn() }));
jest.mock('../googleDrive/http', () => ({
  httpRequestRaw: (...args: any[]) => mockHttp(...args),
  httpRequestStream: (...args: any[]) => mockStream(...args),
}));
jest.mock('../googleDrive/index', () => ({
  getAccessToken: () => mockGetAccessToken(),
  invalidateAccessToken: (t: string) => mockInvalidate(t),
}));

import {
  backupListQuery,
  backupListUrl,
  buildTrashBody,
  classifyDriveResponse,
  downloadDirFor,
  downloadTotal,
  fileMediaUrl,
  isBackupFileInFolder,
  parseBackupItem,
  parseBackupListPage,
  sanitizeDownloadName,
  sortBackupItems,
  trashUrl,
} from '../googleDrive/driveApi';
import { resetRootFolderCache } from '../googleDrive/upload';
import { listBackups, trashBackupFile, trashBackupFileForIpc } from '../googleDrive/manage';
import {
  cleanupDriveDownload,
  downloadDriveFile,
  downloadDriveFileForIpc,
} from '../googleDrive/download';
import { DriveAuthError } from '../../shared/googleDriveAuth';
import { isDriveBackupKind, isDriveFileId } from '../../shared/googleDrive';

function res(status: number, body: unknown = '', headers: Record<string, string> = {}) {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return { status, body, header: (n: string) => lower[n.toLowerCase()] ?? null };
}

function streamRes(parts: Uint8Array[], headers: Record<string, string> = {}) {
  const r = res(200, undefined, headers);
  return {
    ...r,
    chunks: (async function* () {
      for (const p of parts) yield p;
    })(),
  };
}

const bytes = (n: number, v = 1) => new Uint8Array(n).fill(v);
const ROOT = { id: 'ROOT', webViewLink: 'https://drive.google.com/drive/folders/ROOT' };

// ─── 순수 함수 ───

describe('목록 쿼리·항목 변환', () => {
  test('SDStudio 폴더 바로 아래·휴지통 제외·폴더 제외', () => {
    expect(backupListQuery('ROOT')).toBe(
      "'ROOT' in parents and trashed=false and mimeType != 'application/vnd.google-apps.folder'",
    );
    expect(backupListQuery("a'b")).toContain("'a\\'b' in parents");
  });
  test('files.list 주소: pageSize 100·최신 먼저·필드·다음 페이지', () => {
    const url = new URL(backupListUrl('ROOT', 'PAGE2'));
    expect(url.searchParams.get('q')).toBe(backupListQuery('ROOT'));
    expect(url.searchParams.get('pageSize')).toBe('100');
    expect(url.searchParams.get('orderBy')).toBe('modifiedTime desc');
    expect(url.searchParams.get('fields')).toBe(
      'nextPageToken,files(id,name,size,modifiedTime,appProperties,webViewLink)',
    );
    expect(url.searchParams.get('pageToken')).toBe('PAGE2');
    expect(new URL(backupListUrl('ROOT')).searchParams.has('pageToken')).toBe(false);
  });
  test('appProperties.kind 검증 — 결여·모르는 값은 unknown', () => {
    const ok = parseBackupItem({
      id: 'F1',
      name: 'sdstudio-project-a.tar',
      size: '1234',
      modifiedTime: '2026-09-28T12:00:00.000Z',
      appProperties: { sdstudio: 'backup', kind: 'project', device: 'PC-1', appVersion: '5.4.0' },
      webViewLink: 'https://drive.google.com/file/d/F1/view',
    });
    expect(ok).toEqual({
      id: 'F1',
      name: 'sdstudio-project-a.tar',
      size: 1234,
      modifiedTime: '2026-09-28T12:00:00.000Z',
      kind: 'project',
      device: 'PC-1',
      appVersion: '5.4.0',
      webViewLink: 'https://drive.google.com/file/d/F1/view',
    });
    expect(parseBackupItem({ id: 'F2', name: 'x.tar' })).toEqual({ id: 'F2', name: 'x.tar', kind: 'unknown' });
    expect(parseBackupItem({ id: 'F3', name: 'y', appProperties: { kind: 'evil' } })!.kind).toBe('unknown');
    expect(parseBackupItem({ id: 'F4', name: 'z', modifiedTime: 'nope', size: 'x' })).toEqual({
      id: 'F4',
      name: 'z',
      kind: 'unknown',
    });
    expect(parseBackupItem({ name: 'no id' })).toBeNull();
    expect(isDriveBackupKind('token')).toBe(true);
    expect(isDriveBackupKind('unknown')).toBe(false);
  });
  test('페이지 해석과 정렬(최신 먼저, 시각 없는 항목은 뒤)', () => {
    const page = parseBackupListPage({
      nextPageToken: 'N',
      files: [
        { id: 'a', name: 'a', modifiedTime: '2026-09-01T00:00:00Z' },
        { id: 'b', name: 'b', modifiedTime: '2026-09-28T00:00:00Z' },
        { id: 'c', name: 'c' },
        { bad: true },
      ],
    });
    expect(page.nextPageToken).toBe('N');
    expect(page.items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(sortBackupItems(page.items).map((i) => i.id)).toEqual(['b', 'a', 'c']);
    expect(parseBackupListPage({}).items).toEqual([]);
  });
});

describe('받기 경로·이름', () => {
  test('파일 이름 정제: 구분자·금지 문자·끝 점·예약 이름·빈 이름', () => {
    expect(sanitizeDownloadName('a/b\\c:d*e?.tar', 'fb')).toBe('a_b_c_d_e_.tar');
    expect(sanitizeDownloadName('../../evil.tar', 'fb')).toBe('.._.._evil.tar');
    expect(sanitizeDownloadName('name. . ', 'fb')).toBe('name');
    expect(sanitizeDownloadName('CON.json', 'fb')).toBe('_CON.json');
    expect(sanitizeDownloadName('', 'fb')).toBe('fb');
    expect(sanitizeDownloadName('...', 'fb')).toBe('fb');
    expect(sanitizeDownloadName(undefined, 'fb')).toBe('fb');
    const long = sanitizeDownloadName('x'.repeat(300) + '.tar', 'fb');
    expect(long.length).toBe(150);
    expect(long.endsWith('.tar')).toBe(true);
  });
  test('임시 폴더 = APP_DIR/tmp/drive-download/<id>, id 형식이 아니면 null', () => {
    expect(downloadDirFor('/app', 'AbC-1_2')).toBe(path.join('/app', 'tmp', 'drive-download', 'AbC-1_2'));
    expect(downloadDirFor('/app', '../x')).toBeNull();
    expect(downloadDirFor('/app', 'a/b')).toBeNull();
    expect(downloadDirFor('/app', '')).toBeNull();
    expect(isDriveFileId('..')).toBe(false);
  });
  test('alt=media 주소·진행률 분모', () => {
    expect(fileMediaUrl('F1')).toBe('https://www.googleapis.com/drive/v3/files/F1?alt=media');
    expect(downloadTotal(10, '99')).toBe(10);
    expect(downloadTotal(undefined, '99')).toBe(99);
    expect(downloadTotal(undefined, 'x')).toBe(0);
  });
});

describe('휴지통 본문·확인', () => {
  test('files.update {trashed:true} — 영구 삭제 아님', () => {
    expect(buildTrashBody()).toEqual({ trashed: true });
    expect(trashUrl('F1')).toContain('/files/F1?fields=');
  });
  test('SDStudio 폴더 바로 아래 파일만', () => {
    expect(isBackupFileInFolder({ id: 'F', parents: ['ROOT'], mimeType: 'application/x-tar' }, 'ROOT')).toBe(true);
    expect(isBackupFileInFolder({ id: 'F', parents: ['OTHER'] }, 'ROOT')).toBe(false);
    expect(
      isBackupFileInFolder({ id: 'F', parents: ['ROOT'], mimeType: 'application/vnd.google-apps.folder' }, 'ROOT'),
    ).toBe(false);
    expect(isBackupFileInFolder({ id: 'ROOT', parents: ['ROOT'] }, 'ROOT')).toBe(false);
  });
  test('실패 코드 지정(받기·요청)', () => {
    expect(classifyDriveResponse(400, {}, 'download-failed')).toMatchObject({ kind: 'fail', code: 'download-failed' });
    expect(classifyDriveResponse(400, {})).toMatchObject({ kind: 'fail', code: 'upload-failed' });
  });
});

// ─── 가짜 HTTP 절차 ───

describe('목록·휴지통 (가짜 HTTP)', () => {
  beforeEach(() => {
    mockHttp.mockReset();
    mockGetAccessToken.mockReset();
    mockGetAccessToken.mockResolvedValue('tok-1');
    resetRootFolderCache();
  });

  test('폴더 표식 검색 → 2페이지 이어 받기 → 정렬·폴더 링크', async () => {
    mockHttp
      .mockResolvedValueOnce(res(200, { files: [ROOT] }))
      .mockResolvedValueOnce(
        res(200, { nextPageToken: 'P2', files: [{ id: 'a', name: 'a', modifiedTime: '2026-09-01T00:00:00Z' }] }),
      )
      .mockResolvedValueOnce(
        res(200, { files: [{ id: 'b', name: 'b', modifiedTime: '2026-09-28T00:00:00Z', appProperties: { kind: 'config' } }] }),
      );
    const out = await listBackups();
    expect(out.folderLink).toBe(ROOT.webViewLink);
    expect(out.items.map((i) => [i.id, i.kind])).toEqual([
      ['b', 'config'],
      ['a', 'unknown'],
    ]);
    const second = new URL(mockHttp.mock.calls[2][0]);
    expect(second.searchParams.get('pageToken')).toBe('P2');
    expect(mockHttp.mock.calls.every((c) => c[1].method === 'GET')).toBe(true);
  });

  test('폴더가 없으면 빈 목록(폴더를 만들지 않는다)', async () => {
    mockHttp.mockResolvedValueOnce(res(200, { files: [] })).mockResolvedValueOnce(res(200, { files: [] }));
    expect(await listBackups()).toEqual({ items: [] });
    expect(mockHttp).toHaveBeenCalledTimes(2);
    expect(mockHttp.mock.calls.some((c) => c[1].method === 'POST')).toBe(false);
  });

  test('휴지통 = 확인 GET 뒤 PATCH {trashed:true}, DELETE 는 없다', async () => {
    mockHttp
      .mockResolvedValueOnce(res(200, { files: [ROOT] }))
      .mockResolvedValueOnce(res(200, { id: 'F1', parents: ['ROOT'], mimeType: 'application/x-tar', trashed: false }))
      .mockResolvedValueOnce(res(200, { id: 'F1', trashed: true }));
    await trashBackupFile('F1');
    const calls = mockHttp.mock.calls;
    expect(calls[2][1].method).toBe('PATCH');
    expect(JSON.parse(calls[2][1].body)).toEqual({ trashed: true });
    expect(calls.some((c) => c[1].method === 'DELETE')).toBe(false);
  });

  test('폴더 밖 파일·없는 파일·잘못된 id 는 PATCH 없이 거부', async () => {
    mockHttp
      .mockResolvedValueOnce(res(200, { files: [ROOT] }))
      .mockResolvedValueOnce(res(200, { id: 'F9', parents: ['ELSE'] }));
    await expect(trashBackupFile('F9')).rejects.toMatchObject({ code: 'not-backup' });
    mockHttp.mockResolvedValueOnce(res(200, { id: 'ROOT', trashed: false })).mockResolvedValueOnce(res(404, {}));
    expect(await trashBackupFileForIpc('GONE')).toMatchObject({ ok: false, code: 'not-found' });
    expect(await trashBackupFileForIpc('../x')).toMatchObject({ ok: false, code: 'not-backup' });
    expect(mockHttp.mock.calls.some((c) => c[1].method === 'PATCH' || c[1].method === 'DELETE')).toBe(false);
  });
});

describe('downloadDriveFile (가짜 HTTP)', () => {
  let appDir: string;
  let downloadsDir: string;
  beforeEach(() => {
    appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdstudio-drive-dl-'));
    downloadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdstudio-drive-dl-out-'));
    mockStream.mockReset();
    mockInvalidate.mockReset();
    mockGetAccessToken.mockReset();
    mockGetAccessToken.mockResolvedValue('tok-1');
    jest.spyOn(Math, 'random').mockReturnValue(0);
  });
  afterEach(() => {
    (Math.random as any).mockRestore?.();
    fs.rmSync(appDir, { recursive: true, force: true });
    fs.rmSync(downloadsDir, { recursive: true, force: true });
  });
  const dlDir = (id: string) => path.join(appDir, 'tmp', 'drive-download', id);

  test('성공: .part 에 스트리밍 → rename, 진행률, 인증 헤더', async () => {
    mockStream.mockResolvedValueOnce(streamRes([bytes(3, 1), bytes(4, 2)], { 'Content-Length': '7' }));
    const progress: any[] = [];
    const out = await downloadDriveFile({
      appDir,
      request: { fileId: 'F1', name: 'sdstudio-config-x.json' },
      onProgress: (p) => progress.push(p),
    });
    expect(out).toBe(path.join(dlDir('F1'), 'sdstudio-config-x.json'));
    expect(Array.from(fs.readFileSync(out))).toEqual([1, 1, 1, 2, 2, 2, 2]);
    expect(fs.existsSync(out + '.part')).toBe(false);
    expect(progress[0]).toEqual({ received: 0, total: 7 });
    expect(progress[progress.length - 1]).toEqual({ received: 7, total: 7 });
    const [url, init] = mockStream.mock.calls[0];
    expect(url).toBe(fileMediaUrl('F1'));
    expect(init.headers.Authorization).toBe('Bearer tok-1');
    await cleanupDriveDownload(appDir, 'F1');
    expect(fs.existsSync(dlDir('F1'))).toBe(false);
  });

  test('취소: 받는 도중 중단 → .part·임시 폴더 삭제, cancelled', async () => {
    const controller = new AbortController();
    mockStream.mockImplementationOnce(async (_url: string, init: any) => ({
      ...res(200),
      chunks: (async function* () {
        yield bytes(5);
        controller.abort();
        await new Promise((r) => setTimeout(r, 5));
        if (init.signal.aborted) throw new DriveAuthError('cancelled');
        yield bytes(5);
      })(),
    }));
    const result = await downloadDriveFileForIpc({
      appDir,
      request: { fileId: 'F2', name: 'a.tar', size: 10 },
      signal: controller.signal,
    });
    expect(result).toEqual({ ok: false, code: 'cancelled' });
    expect(fs.existsSync(dlDir('F2'))).toBe(false);
    expect(mockStream).toHaveBeenCalledTimes(1);
  });

  test('401 → 토큰 무효화 후 1회 재시도', async () => {
    mockGetAccessToken.mockResolvedValueOnce('old').mockResolvedValueOnce('old').mockResolvedValue('new');
    mockStream.mockResolvedValueOnce(res(401, {})).mockResolvedValueOnce(streamRes([bytes(2)]));
    const out = await downloadDriveFile({ appDir, request: { fileId: 'F3', name: 'b.json' } });
    expect(fs.readFileSync(out).length).toBe(2);
    expect(mockInvalidate).toHaveBeenCalledWith('old');
    expect(mockStream.mock.calls[1][1].headers.Authorization).toBe('Bearer new');
  });

  test('5xx 뒤 처음부터 다시 받기 → 성공', async () => {
    mockStream.mockResolvedValueOnce(res(503, {})).mockResolvedValueOnce(streamRes([bytes(4)]));
    const out = await downloadDriveFile({ appDir, request: { fileId: 'F4', name: 'c.tar', size: 4 } });
    expect(fs.readFileSync(out).length).toBe(4);
    expect(mockStream).toHaveBeenCalledTimes(2);
  });

  test('도중 끊김·크기 불일치도 처음부터 다시(.part 를 새로 쓴다)', async () => {
    mockStream
      .mockResolvedValueOnce({
        ...res(200),
        chunks: (async function* () {
          yield bytes(3, 9);
          throw new DriveAuthError('network');
        })(),
      })
      .mockResolvedValueOnce(streamRes([bytes(3, 9)]))
      .mockResolvedValueOnce(streamRes([bytes(6, 5)]));
    const out = await downloadDriveFile({ appDir, request: { fileId: 'F5', name: 'd.tar', size: 6 } });
    expect(Array.from(fs.readFileSync(out))).toEqual([5, 5, 5, 5, 5, 5]);
    expect(mockStream).toHaveBeenCalledTimes(3);
  }, 15000);

  test('404 = not-found(재시도 없음), 4xx = download-failed', async () => {
    mockStream.mockResolvedValueOnce(res(404, {}));
    await expect(
      downloadDriveFile({ appDir, request: { fileId: 'F6', name: 'e.tar' } }),
    ).rejects.toMatchObject({ code: 'not-found' });
    mockStream.mockResolvedValueOnce(res(400, {}));
    await expect(
      downloadDriveFile({ appDir, request: { fileId: 'F6', name: 'e.tar' } }),
    ).rejects.toMatchObject({ code: 'download-failed' });
    expect(mockStream).toHaveBeenCalledTimes(2);
    expect(fs.existsSync(dlDir('F6'))).toBe(false);
  });

  test('토큰 파일은 앱 안으로 받지 않는다(다운로드 폴더 저장만 허용)', async () => {
    await expect(
      downloadDriveFile({ appDir, request: { fileId: 'T1', name: 'sdstudio-token-2026.json' } }),
    ).rejects.toMatchObject({ code: 'token-download-forbidden' });
    expect(mockStream).not.toHaveBeenCalled();
    mockStream.mockResolvedValueOnce(streamRes([bytes(2)]));
    const out = await downloadDriveFile({
      appDir,
      downloadsDir,
      request: { fileId: 'T1', name: 'sdstudio-token-2026.json', toDownloads: true },
    });
    expect(path.dirname(out)).toBe(downloadsDir);
  });

  test('다운로드 폴더 저장: 같은 이름이면 " (n)" 접미, 임시 폴더 정리', async () => {
    fs.writeFileSync(path.join(downloadsDir, 'x.tar'), 'old');
    mockStream.mockResolvedValueOnce(streamRes([bytes(3)]));
    const out = await downloadDriveFile({
      appDir,
      downloadsDir,
      request: { fileId: 'F7', name: 'x.tar', toDownloads: true },
    });
    expect(out).toBe(path.join(downloadsDir, 'x (1).tar'));
    expect(fs.readFileSync(path.join(downloadsDir, 'x.tar'), 'utf8')).toBe('old');
    expect(fs.existsSync(dlDir('F7'))).toBe(false);
  });

  test('잘못된 id·미연결', async () => {
    await expect(
      downloadDriveFile({ appDir, request: { fileId: '../x', name: 'a' } }),
    ).rejects.toMatchObject({ code: 'not-backup' });
    mockGetAccessToken.mockRejectedValueOnce(new DriveAuthError('not-connected'));
    expect(
      await downloadDriveFileForIpc({ appDir, request: { fileId: 'F8', name: 'a.tar' } }),
    ).toEqual({ ok: false, code: 'not-connected' });
    expect(mockStream).not.toHaveBeenCalled();
  });
});
