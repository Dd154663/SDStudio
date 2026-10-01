/**
 * @jest-environment node
 */
// Google 드라이브 연동 ② — Drive API 요청 조립·청크 계산·응답 분류 순수 함수와,
// HTTP 를 가짜로 바꾼 올리기 절차(폴더 확보·resumable·재개·토큰 방벽) 검증.
// 실제 Google 호출 없음(http.ts 의 httpRequestRaw 를 모킹).
import fs from 'fs';
import os from 'os';
import path from 'path';

const mockHttp = jest.fn();
const mockGetAccessToken = jest.fn(async () => 'tok-1');
const mockInvalidate = jest.fn();
jest.mock('electron', () => ({ app: { getVersion: () => '5.4.0' }, net: {} }));
jest.mock('electron-log', () => ({ info: jest.fn(), warn: jest.fn() }));
jest.mock('../googleDrive/http', () => ({
  httpRequestRaw: (...args: any[]) => mockHttp(...args),
}));
jest.mock('../googleDrive/index', () => ({
  getAccessToken: () => mockGetAccessToken(),
  invalidateAccessToken: (t: string) => mockInvalidate(t),
}));

import {
  APP_PROPERTY_MAX_BYTES,
  assertValidChunkSize,
  backoffDelayMs,
  buildAppProperties,
  buildFileMetadata,
  buildFolderCreateBody,
  classifyDriveResponse,
  contentRangeHeader,
  filesListUrl,
  nextOffsetFromRange,
  parseUploadedFile,
  planAllChunks,
  planChunk,
  resolveExportsSource,
  RESUMABLE_CHUNK_UNIT,
  rootFolderNameQuery,
  rootFolderQuery,
  shouldRetry,
  statusQueryContentRange,
  truncateAppPropertyValue,
  UPLOAD_CHUNK_SIZE,
  uploadDisplayName,
  uploadMimeType,
} from '../googleDrive/driveApi';
import { resetRootFolderCache, uploadExportFile, uploadExportFileForIpc } from '../googleDrive/upload';
import { DriveAuthError } from '../../shared/googleDriveAuth';
import { isDriveWebUrl, isTokenExport } from '../../shared/googleDrive';

const MiB = 1024 * 1024;

describe('resumable 청크 계산', () => {
  test('청크 크기는 256 KiB 배수(8 MiB)', () => {
    expect(UPLOAD_CHUNK_SIZE % RESUMABLE_CHUNK_UNIT).toBe(0);
    expect(UPLOAD_CHUNK_SIZE).toBe(8 * MiB);
    expect(() => assertValidChunkSize(300 * 1024)).toThrow();
    expect(() => assertValidChunkSize(0)).toThrow();
  });
  test('총 크기 0 = 본문 없는 단일 청크(bytes */0)', () => {
    expect(planChunk(0, 0)).toEqual({ start: 0, end: -1, length: 0, contentRange: 'bytes */0', last: true });
    expect(planAllChunks(0)).toHaveLength(1);
  });
  test('청크보다 작은 파일 = 한 조각', () => {
    expect(planAllChunks(1000)).toEqual([
      { start: 0, end: 999, length: 1000, contentRange: 'bytes 0-999/1000', last: true },
    ]);
  });
  test('정확히 배수 = 마지막 조각도 온전한 청크', () => {
    const chunks = planAllChunks(2 * UPLOAD_CHUNK_SIZE);
    expect(chunks.map((c) => c.contentRange)).toEqual([
      `bytes 0-${UPLOAD_CHUNK_SIZE - 1}/${2 * UPLOAD_CHUNK_SIZE}`,
      `bytes ${UPLOAD_CHUNK_SIZE}-${2 * UPLOAD_CHUNK_SIZE - 1}/${2 * UPLOAD_CHUNK_SIZE}`,
    ]);
    expect(chunks.map((c) => c.last)).toEqual([false, true]);
  });
  test('마지막 조각만 256 KiB 배수가 아니어도 된다', () => {
    const total = UPLOAD_CHUNK_SIZE + 5;
    const chunks = planAllChunks(total);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].length % RESUMABLE_CHUNK_UNIT).toBe(0);
    expect(chunks[1]).toEqual({
      start: UPLOAD_CHUNK_SIZE,
      end: total - 1,
      length: 5,
      contentRange: `bytes ${UPLOAD_CHUNK_SIZE}-${total - 1}/${total}`,
      last: true,
    });
  });
  test('범위 밖 위치는 거부', () => {
    expect(() => planChunk(10, 10)).toThrow();
    expect(() => planChunk(-1, 10)).toThrow();
  });
  test('Content-Range 문자열', () => {
    expect(contentRangeHeader(0, 262143, 1000000)).toBe('bytes 0-262143/1000000');
    expect(statusQueryContentRange(1000000)).toBe('bytes */1000000');
  });
});

describe('308 Range 해석', () => {
  test('받은 끝 + 1 이 다음 위치', () => {
    expect(nextOffsetFromRange('bytes=0-524287')).toBe(524288);
    expect(nextOffsetFromRange(' bytes = 0 - 0 ')).toBe(1);
  });
  test('헤더 없음 = 아직 0바이트', () => {
    expect(nextOffsetFromRange(null)).toBe(0);
    expect(nextOffsetFromRange(undefined)).toBe(0);
    expect(nextOffsetFromRange('')).toBe(0);
  });
  test('해석 불가·0 이 아닌 시작은 null', () => {
    expect(nextOffsetFromRange('bytes 0-10')).toBeNull();
    expect(nextOffsetFromRange('bytes=5-10')).toBeNull();
    expect(nextOffsetFromRange('garbage')).toBeNull();
  });
});

describe('appProperties', () => {
  test('키+값 UTF-8 124바이트 이하로 자른다', () => {
    const v = truncateAppPropertyValue('device', 'x'.repeat(300));
    expect(Buffer.byteLength('device' + v)).toBe(APP_PROPERTY_MAX_BYTES);
  });
  test('한글은 글자 중간에서 자르지 않는다', () => {
    const v = truncateAppPropertyValue('device', '가'.repeat(100));
    expect(Buffer.byteLength('device' + v)).toBeLessThanOrEqual(APP_PROPERTY_MAX_BYTES);
    expect(v).toBe('가'.repeat(Math.floor((APP_PROPERTY_MAX_BYTES - 6) / 3)));
    expect(truncateAppPropertyValue('k', 'short')).toBe('short');
  });
  test('키만으로 한도를 넘으면 빈 값', () => {
    expect(truncateAppPropertyValue('k'.repeat(130), 'v')).toBe('');
  });
  test('빈 값은 빼고 개수는 30개까지', () => {
    const props: Record<string, string | undefined> = { a: '1', b: '', c: undefined, d: '  ' };
    for (let i = 0; i < 40; i++) props['p' + i] = 'v';
    const out = buildAppProperties(props);
    expect(out.a).toBe('1');
    expect('b' in out || 'c' in out || 'd' in out).toBe(false);
    expect(Object.keys(out)).toHaveLength(30);
  });
  test('올릴 파일 메타 = 이름·부모 폴더·표식', () => {
    const meta = buildFileMetadata({
      name: 'sdstudio-project-a-2026.tar',
      folderId: 'F1',
      kind: 'project',
      appVersion: '5.4.0',
      device: 'MY-PC',
    });
    expect(meta).toEqual({
      name: 'sdstudio-project-a-2026.tar',
      parents: ['F1'],
      appProperties: {
        sdstudio: 'backup',
        kind: 'project',
        app: 'SDStudio',
        appVersion: '5.4.0',
        device: 'MY-PC',
      },
    });
  });
});

describe('폴더 쿼리', () => {
  test('appProperties 표식 쿼리', () => {
    expect(rootFolderQuery()).toBe(
      "mimeType='application/vnd.google-apps.folder' and trashed=false and " +
        "appProperties has { key='sdstudio' and value='root' }",
    );
  });
  test('이름 폴백 쿼리는 최상위 + 작은따옴표 이스케이프', () => {
    expect(rootFolderNameQuery()).toContain("name='SDStudio' and 'root' in parents");
    expect(rootFolderNameQuery("a'b")).toContain("name='a\\'b'");
  });
  test('files.list 주소에 q 가 인코딩되어 들어간다', () => {
    const url = new URL(filesListUrl(rootFolderQuery()));
    expect(url.searchParams.get('q')).toBe(rootFolderQuery());
    expect(url.searchParams.get('fields')).toBe('files(id,name,webViewLink)');
  });
  test('새 폴더 = 폴더 MIME + root 표식', () => {
    expect(buildFolderCreateBody()).toEqual({
      name: 'SDStudio',
      mimeType: 'application/vnd.google-apps.folder',
      appProperties: { sdstudio: 'root' },
    });
  });
});

describe('토큰 방벽·주소·경로', () => {
  test('kind token 또는 sdstudio-token- 파일명(경로·대소문자 무관)', () => {
    expect(isTokenExport('token')).toBe(true);
    expect(isTokenExport('config', 'exports/sdstudio-token-2026.json')).toBe(true);
    expect(isTokenExport(undefined, 'C:\\x\\SDStudio-Token-1.json')).toBe(true);
    expect(isTokenExport('config', 'exports/sdstudio-config-2026.json')).toBe(false);
    expect(isTokenExport('project', 'exports/my-token-project.tar')).toBe(false);
  });
  test('드라이브 웹 주소만 연다', () => {
    expect(isDriveWebUrl('https://drive.google.com/file/d/x/view')).toBe(true);
    expect(isDriveWebUrl('https://evil.example/drive.google.com/')).toBe(false);
    expect(isDriveWebUrl('file:///C:/x')).toBe(false);
    expect(isDriveWebUrl(undefined)).toBe(false);
  });
  test('exports/ 상대 경로만 허용(publish-export 와 같은 규칙)', () => {
    const appDir = path.resolve('/app');
    expect(resolveExportsSource(appDir, 'exports/a.tar')).toBe(path.resolve(appDir, 'exports/a.tar'));
    expect(resolveExportsSource(appDir, 'exports\\sub\\a.tar')).toBe(path.resolve(appDir, 'exports/sub/a.tar'));
    expect(resolveExportsSource(appDir, 'exports/../config.json')).toBeNull();
    expect(resolveExportsSource(appDir, 'projects/a.json')).toBeNull();
    expect(resolveExportsSource(appDir, 'exports/')).toBeNull();
    expect(resolveExportsSource(appDir, 42)).toBeNull();
  });
  test('표시 이름·MIME', () => {
    expect(uploadDisplayName('/app/exports/a.tar')).toBe('a.tar');
    expect(uploadDisplayName('/app/exports/a.tar', 'x/y.tar')).toBe('x_y.tar');
    expect(uploadMimeType('a.tar')).toBe('application/x-tar');
    expect(uploadMimeType('a.JSON')).toBe('application/json');
    expect(uploadMimeType('a.bin')).toBe('application/octet-stream');
  });
  test('올리기 응답 해석(size 문자열 → 숫자)', () => {
    expect(parseUploadedFile({ id: 'a', name: 'n', size: '12', webViewLink: 'https://drive.google.com/x' })).toEqual({
      id: 'a',
      name: 'n',
      size: 12,
      webViewLink: 'https://drive.google.com/x',
    });
    expect(parseUploadedFile({ name: 'n' })).toBeNull();
  });
});

describe('응답 분류·백오프', () => {
  const err = (reason: string) => ({ error: { errors: [{ reason }] } });
  test('성공·진행 중·인증', () => {
    expect(classifyDriveResponse(200, {}).kind).toBe('ok');
    expect(classifyDriveResponse(201, {}).kind).toBe('ok');
    expect(classifyDriveResponse(308, '').kind).toBe('incomplete');
    expect(classifyDriveResponse(401, {}).kind).toBe('auth');
  });
  test('429·5xx·403 요청 한도는 백오프', () => {
    expect(classifyDriveResponse(429, {})).toMatchObject({ kind: 'backoff', code: 'rate-limited' });
    expect(classifyDriveResponse(503, {})).toMatchObject({ kind: 'backoff', code: 'server' });
    expect(classifyDriveResponse(500, {})).toMatchObject({ kind: 'backoff', code: 'server' });
    expect(classifyDriveResponse(403, err('userRateLimitExceeded'))).toMatchObject({ kind: 'backoff', code: 'rate-limited' });
  });
  test('403 저장 공간 부족·권한 등은 즉시 실패', () => {
    expect(classifyDriveResponse(403, err('storageQuotaExceeded'))).toMatchObject({
      kind: 'fail',
      code: 'quota-exceeded',
      detail: 'HTTP 403 storageQuotaExceeded',
    });
    expect(classifyDriveResponse(403, err('insufficientFilePermissions'))).toMatchObject({ kind: 'fail', code: 'upload-failed' });
    expect(classifyDriveResponse(400, {})).toMatchObject({ kind: 'fail', code: 'upload-failed', detail: 'HTTP 400' });
  });
  test('지수 백오프 1s·2s·…(+지터), 최대 32s, 5회까지', () => {
    expect(backoffDelayMs(0, 0)).toBe(1000);
    expect(backoffDelayMs(0, 0.999)).toBe(1999);
    expect(backoffDelayMs(3, 0)).toBe(8000);
    expect(backoffDelayMs(10, 1)).toBe(32000);
    expect(shouldRetry(4)).toBe(true);
    expect(shouldRetry(5)).toBe(false);
  });
});

// ─── 올리기 절차(가짜 HTTP) ───

function res(status: number, body: unknown = '', headers: Record<string, string> = {}) {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return { status, body, header: (n: string) => lower[n.toLowerCase()] ?? null };
}

const SESSION = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=abc';

describe('uploadExportFile (가짜 HTTP)', () => {
  let appDir: string;
  beforeAll(() => {
    appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdstudio-drive-test-'));
    fs.mkdirSync(path.join(appDir, 'exports'));
    fs.writeFileSync(path.join(appDir, 'exports', 'small.json'), '{"a":1}');
    // 8 MiB + 3 바이트 → 청크 2개
    const big = new Uint8Array(UPLOAD_CHUNK_SIZE + 3).fill(7);
    fs.writeFileSync(path.join(appDir, 'exports', 'big.tar'), big);
    fs.writeFileSync(path.join(appDir, 'exports', 'sdstudio-token-x.json'), '{}');
  });
  afterAll(() => {
    fs.rmSync(appDir, { recursive: true, force: true });
  });
  beforeEach(() => {
    mockHttp.mockReset();
    mockInvalidate.mockReset();
    mockGetAccessToken.mockReset();
    mockGetAccessToken.mockResolvedValue('tok-1');
    resetRootFolderCache();
  });

  test('토큰 kind·토큰 파일명은 HTTP 없이 거부', async () => {
    await expect(
      uploadExportFile({ appDir, request: { exportsPath: 'exports/small.json', kind: 'token' } }),
    ).rejects.toMatchObject({ code: 'token-export-forbidden' });
    await expect(
      uploadExportFile({ appDir, request: { exportsPath: 'exports/sdstudio-token-x.json', kind: 'config' } }),
    ).rejects.toMatchObject({ code: 'token-export-forbidden' });
    await expect(
      uploadExportFile({ appDir, request: { exportsPath: 'exports/small.json', kind: 'config', name: 'sdstudio-token-y.json' } }),
    ).rejects.toMatchObject({ code: 'token-export-forbidden' });
    expect(mockHttp).not.toHaveBeenCalled();
    expect(mockGetAccessToken).not.toHaveBeenCalled();
  });

  test('exports 밖·없는 파일·미연결', async () => {
    await expect(
      uploadExportFile({ appDir, request: { exportsPath: 'exports/../x.json', kind: 'config' } }),
    ).rejects.toMatchObject({ code: 'invalid-path' });
    await expect(
      uploadExportFile({ appDir, request: { exportsPath: 'exports/none.json', kind: 'config' } }),
    ).rejects.toMatchObject({ code: 'file-missing' });
    mockGetAccessToken.mockRejectedValue(new DriveAuthError('not-connected'));
    expect(
      await uploadExportFileForIpc({ appDir, request: { exportsPath: 'exports/small.json', kind: 'config' } }),
    ).toEqual({ ok: false, code: 'not-connected' });
    expect(mockHttp).not.toHaveBeenCalled();
  });

  test('폴더 없음 → 표식 달아 생성 → 세션 → 2청크(308 Range) → 완료', async () => {
    mockHttp
      .mockResolvedValueOnce(res(200, { files: [] })) // 표식 검색
      .mockResolvedValueOnce(res(200, { files: [] })) // 이름 폴백
      .mockResolvedValueOnce(res(200, { id: 'FOLDER', name: 'SDStudio' })) // 폴더 생성
      .mockResolvedValueOnce(res(200, '', { Location: SESSION })) // 세션 시작
      .mockResolvedValueOnce(res(308, '', { Range: `bytes=0-${UPLOAD_CHUNK_SIZE - 1}` }))
      .mockResolvedValueOnce(
        res(200, { id: 'FILE', name: 'big.tar', size: String(UPLOAD_CHUNK_SIZE + 3), webViewLink: 'https://drive.google.com/file/d/FILE/view' }),
      );
    const progress: number[] = [];
    const file = await uploadExportFile({
      appDir,
      request: { exportsPath: 'exports/big.tar', kind: 'project' },
      onProgress: (p) => progress.push(p.sent),
    });
    expect(file).toEqual({
      id: 'FILE',
      name: 'big.tar',
      size: UPLOAD_CHUNK_SIZE + 3,
      webViewLink: 'https://drive.google.com/file/d/FILE/view',
    });
    const calls = mockHttp.mock.calls;
    expect(calls).toHaveLength(6);
    // 생성 본문 = 표식
    expect(JSON.parse(calls[2][1].body)).toEqual(buildFolderCreateBody());
    // 세션 시작: 메타·길이 헤더
    const init = calls[3];
    expect(init[0]).toContain('uploadType=resumable');
    expect(init[1].headers['X-Upload-Content-Length']).toBe(String(UPLOAD_CHUNK_SIZE + 3));
    expect(init[1].headers['X-Upload-Content-Type']).toBe('application/x-tar');
    const meta = JSON.parse(init[1].body);
    expect(meta.parents).toEqual(['FOLDER']);
    expect(meta.appProperties).toMatchObject({ sdstudio: 'backup', kind: 'project', app: 'SDStudio', appVersion: '5.4.0' });
    // 청크
    expect(calls[4][0]).toBe(SESSION);
    expect(calls[4][1].headers['Content-Range']).toBe(`bytes 0-${UPLOAD_CHUNK_SIZE - 1}/${UPLOAD_CHUNK_SIZE + 3}`);
    expect(calls[4][1].body.length).toBe(UPLOAD_CHUNK_SIZE);
    expect(calls[5][1].headers['Content-Range']).toBe(
      `bytes ${UPLOAD_CHUNK_SIZE}-${UPLOAD_CHUNK_SIZE + 2}/${UPLOAD_CHUNK_SIZE + 3}`,
    );
    expect(calls[5][1].body.length).toBe(3);
    expect(calls.every((c) => c[1].headers.Authorization === 'Bearer tok-1')).toBe(true);
    expect(progress).toEqual([0, UPLOAD_CHUNK_SIZE, UPLOAD_CHUNK_SIZE + 3]);
  });

  test('다음 올리기는 캐시 폴더를 files.get 으로 확인, 휴지통이면 다시 찾는다', async () => {
    // 1회차: 표식 검색으로 찾음
    mockHttp
      .mockResolvedValueOnce(res(200, { files: [{ id: 'F1', name: 'SDStudio' }] }))
      .mockResolvedValueOnce(res(200, '', { Location: SESSION }))
      .mockResolvedValueOnce(res(200, { id: 'A', name: 'small.json' }));
    await uploadExportFile({ appDir, request: { exportsPath: 'exports/small.json', kind: 'config' } });
    // 2회차: 캐시 F1 이 휴지통 → 표식 검색 없음 → 이름 폴백 F2
    mockHttp
      .mockResolvedValueOnce(res(200, { id: 'F1', trashed: true }))
      .mockResolvedValueOnce(res(200, { files: [] }))
      .mockResolvedValueOnce(res(200, { files: [{ id: 'F2' }] }))
      .mockResolvedValueOnce(res(200, '', { Location: SESSION }))
      .mockResolvedValueOnce(res(200, { id: 'B', name: 'small.json' }));
    await uploadExportFile({ appDir, request: { exportsPath: 'exports/small.json', kind: 'config' } });
    const calls = mockHttp.mock.calls;
    expect(calls[3][0]).toContain('/files/F1?fields=');
    expect(JSON.parse(calls[6][1].body).parents).toEqual(['F2']);
  });

  test('401 은 토큰을 버리고 1회 재시도', async () => {
    // 버려지기 전까지는 같은 토큰, invalidate 뒤에는 갱신된 토큰(index.ts 동작 흉내).
    let current = 'old';
    mockGetAccessToken.mockImplementation(async () => current);
    mockInvalidate.mockImplementation((t: string) => {
      if (t === current) current = 'new';
    });
    mockHttp
      .mockResolvedValueOnce(res(401, { error: { code: 401 } }))
      .mockResolvedValueOnce(res(200, { files: [{ id: 'F1' }] }))
      .mockResolvedValueOnce(res(200, '', { Location: SESSION }))
      .mockResolvedValueOnce(res(200, { id: 'A', name: 'small.json' }));
    await uploadExportFile({ appDir, request: { exportsPath: 'exports/small.json', kind: 'config' } });
    expect(mockInvalidate).toHaveBeenCalledWith('old');
    expect(mockHttp.mock.calls[1][1].headers.Authorization).toBe('Bearer new');
  });

  test('403 저장 공간 부족은 재시도 없이 quota-exceeded', async () => {
    mockHttp
      .mockResolvedValueOnce(res(200, { files: [{ id: 'F1' }] }))
      .mockResolvedValueOnce(res(403, { error: { errors: [{ reason: 'storageQuotaExceeded' }] } }));
    const r = await uploadExportFileForIpc({ appDir, request: { exportsPath: 'exports/small.json', kind: 'config' } });
    expect(r).toEqual({ ok: false, code: 'quota-exceeded', detail: 'HTTP 403 storageQuotaExceeded' });
    expect(mockHttp).toHaveBeenCalledTimes(2);
  });

  test('청크 전송 중 끊김 → 위치 질의(bytes */total) → 받은 위치부터 이어서', async () => {
    const total = UPLOAD_CHUNK_SIZE + 3;
    mockHttp
      .mockResolvedValueOnce(res(200, { files: [{ id: 'F1' }] }))
      .mockResolvedValueOnce(res(200, '', { Location: SESSION }))
      .mockRejectedValueOnce(new DriveAuthError('network')) // 첫 청크 끊김
      .mockResolvedValueOnce(res(308, '', { Range: `bytes=0-${RESUMABLE_CHUNK_UNIT - 1}` })) // 서버는 일부만 받음
      .mockResolvedValueOnce(res(308, '', { Range: `bytes=0-${total - 4}` }))
      .mockResolvedValueOnce(res(200, { id: 'FILE', name: 'big.tar' }));
    const file = await uploadExportFile({ appDir, request: { exportsPath: 'exports/big.tar', kind: 'project' } });
    expect(file.id).toBe('FILE');
    const calls = mockHttp.mock.calls;
    expect(calls[3][1].headers['Content-Range']).toBe(`bytes */${total}`);
    expect(calls[4][1].headers['Content-Range']).toBe(`bytes ${RESUMABLE_CHUNK_UNIT}-${total - 1}/${total}`);
    expect(calls[5][1].headers['Content-Range']).toBe(`bytes ${total - 3}-${total - 1}/${total}`);
  }, 10000);

  test('취소 신호면 cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const r = await uploadExportFileForIpc({
      appDir,
      request: { exportsPath: 'exports/small.json', kind: 'config' },
      signal: controller.signal,
    });
    expect(r).toEqual({ ok: false, code: 'cancelled' });
    expect(mockHttp).not.toHaveBeenCalled();
  });
});
