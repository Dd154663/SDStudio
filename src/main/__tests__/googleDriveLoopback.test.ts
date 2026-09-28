/**
 * @jest-environment node
 */
// Google 드라이브 연동 ① — 루프백 승인 대기(실제 127.0.0.1 서버) 동작 검증.
// Google 에는 요청하지 않는다: openExternal 을 가짜로 바꿔 브라우저 대신 콜백을 직접 호출한다.
import http from 'http';
import { startLoopbackAuthorization } from '../googleDrive/auth';
import { DriveAuthError } from '../../shared/googleDriveAuth';

function get(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode || 0, body }));
      })
      .on('error', reject);
  });
}

const base = {
  authEndpoint: 'https://accounts.google.com/o/oauth2/auth',
  clientId: 'cid',
  scope: 'https://www.googleapis.com/auth/drive.file',
};

describe('startLoopbackAuthorization', () => {
  test('state 일치 콜백 → 코드 수신·완료 페이지·서버 닫힘', async () => {
    let opened = '';
    const auth = await startLoopbackAuthorization({
      ...base,
      timeoutMs: 10_000,
      openExternal: async (url) => {
        opened = url;
      },
    });
    const u = new URL(opened);
    expect(u.searchParams.get('redirect_uri')).toBe(auth.redirectUri);
    expect(auth.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    const state = u.searchParams.get('state');

    const miss = await get(auth.redirectUri.replace('/callback', '/favicon.ico'));
    expect(miss.status).toBe(404);

    const page = await get(`${auth.redirectUri}?state=${state}&code=CODE123`);
    expect(page.status).toBe(200);
    expect(page.body).toContain('연결이 완료되었습니다');
    await expect(auth.code).resolves.toBe('CODE123');
    // 서버가 닫혀 추가 요청은 실패한다.
    await expect(get(`${auth.redirectUri}?state=${state}&code=X`)).rejects.toBeTruthy();
  });

  test('state 불일치 → state-mismatch 거부', async () => {
    const auth = await startLoopbackAuthorization({
      ...base,
      timeoutMs: 10_000,
      openExternal: async () => {},
    });
    const page = await get(`${auth.redirectUri}?state=wrong&code=C`);
    expect(page.status).toBe(400);
    await expect(auth.code).rejects.toMatchObject({ code: 'state-mismatch' });
  });

  test('취소 → cancelled', async () => {
    const auth = await startLoopbackAuthorization({
      ...base,
      timeoutMs: 10_000,
      openExternal: async () => {},
    });
    auth.cancel();
    await expect(auth.code).rejects.toBeInstanceOf(DriveAuthError);
    await expect(auth.code).rejects.toMatchObject({ code: 'cancelled' });
  });

  test('시간 초과 → timeout', async () => {
    const auth = await startLoopbackAuthorization({
      ...base,
      timeoutMs: 50,
      openExternal: async () => {},
    });
    await expect(auth.code).rejects.toMatchObject({ code: 'timeout' });
  });

  test('브라우저 열기 실패 → unknown(open_browser)', async () => {
    const auth = await startLoopbackAuthorization({
      ...base,
      timeoutMs: 10_000,
      openExternal: async () => {
        throw new Error('no browser');
      },
    });
    await expect(auth.code).rejects.toMatchObject({ code: 'unknown', detail: 'open_browser' });
  });
});
