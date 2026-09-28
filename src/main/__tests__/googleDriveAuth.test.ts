// Google 드라이브 연동 ① — main 순수 함수 검증(PKCE·콜백 판정·토큰 응답·인증 파일·상태 조립).
import crypto from 'crypto';
import {
  authorizationCodeParams,
  buildAuthUrl,
  callbackPage,
  createOAuthState,
  createPkcePair,
  isAccessTokenFresh,
  loopbackRedirectUri,
  parseAboutResponse,
  parseCallbackRequest,
  parseTokenResponse,
  pkceChallenge,
  refreshTokenParams,
  sanitizeOAuthErrorCode,
} from '../googleDrive/oauth';
import { decodeAuthFile, encodeAuthFile } from '../googleDrive/authFile';
import { buildDriveAuthStatus } from '../googleDrive/status';
import {
  DRIVE_AUTH_ERROR_TEXT,
  DriveAuthError,
  isDriveAuthErrorCode,
} from '../../shared/googleDriveAuth';

describe('PKCE', () => {
  test('RFC 7636 부록 B 벡터', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  test('verifier 는 43~128자 unreserved, challenge 는 패딩 없는 S256', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const { verifier, challenge } = createPkcePair();
      expect(verifier.length).toBeGreaterThanOrEqual(43);
      expect(verifier.length).toBeLessThanOrEqual(128);
      expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
      expect(challenge).toBe(crypto.createHash('sha256').update(verifier).digest('base64url'));
      expect(challenge).not.toContain('=');
      seen.add(verifier);
    }
    expect(seen.size).toBe(50);
  });

  test('state 는 난수 주입으로 결정적', () => {
    const fixed = (n: number) => Buffer.alloc(n, 7);
    expect(createOAuthState(fixed)).toBe(createOAuthState(fixed));
    expect(createOAuthState()).not.toBe(createOAuthState());
  });
});

describe('동의 URL·루프백', () => {
  test('redirect_uri 는 127.0.0.1 루프백 /callback', () => {
    expect(loopbackRedirectUri(51234)).toBe('http://127.0.0.1:51234/callback');
  });

  test('필수 파라미터(offline·consent·S256·drive.file·state)', () => {
    const url = new URL(
      buildAuthUrl({
        authEndpoint: 'https://accounts.google.com/o/oauth2/auth',
        clientId: 'cid',
        redirectUri: 'http://127.0.0.1:1/callback',
        scope: 'https://www.googleapis.com/auth/drive.file',
        challenge: 'ch',
        state: 'st',
      }),
    );
    const p = url.searchParams;
    expect(p.get('client_id')).toBe('cid');
    expect(p.get('redirect_uri')).toBe('http://127.0.0.1:1/callback');
    expect(p.get('response_type')).toBe('code');
    expect(p.get('scope')).toBe('https://www.googleapis.com/auth/drive.file');
    expect(p.get('access_type')).toBe('offline');
    expect(p.get('prompt')).toBe('consent');
    expect(p.get('code_challenge')).toBe('ch');
    expect(p.get('code_challenge_method')).toBe('S256');
    expect(p.get('state')).toBe('st');
  });
});

describe('콜백 판정', () => {
  test('콜백 경로가 아니면 무시', () => {
    expect(parseCallbackRequest('/favicon.ico', 's')).toEqual({ kind: 'not-callback' });
  });
  test('정상 코드', () => {
    expect(parseCallbackRequest('/callback?state=s&code=abc', 's')).toEqual({
      kind: 'code',
      code: 'abc',
    });
  });
  test('state 불일치는 거부', () => {
    expect(parseCallbackRequest('/callback?state=x&code=abc', 's')).toEqual({
      kind: 'error',
      code: 'state-mismatch',
    });
  });
  test('access_denied = denied', () => {
    expect(parseCallbackRequest('/callback?error=access_denied&state=s', 's')).toMatchObject({
      kind: 'error',
      code: 'denied',
    });
  });
  test('code 없음 = exchange-failed', () => {
    expect(parseCallbackRequest('/callback?state=s', 's')).toMatchObject({
      kind: 'error',
      code: 'exchange-failed',
    });
  });
  test('오류 코드 정제 — 이상한 문자는 버린다', () => {
    expect(sanitizeOAuthErrorCode('invalid_grant')).toBe('invalid_grant');
    expect(sanitizeOAuthErrorCode('<script>')).toBeUndefined();
    expect(sanitizeOAuthErrorCode(3)).toBeUndefined();
  });
  test('브라우저 페이지는 한국어 완료/실패 문구', () => {
    expect(callbackPage(true)).toContain('연결이 완료되었습니다. 이 창을 닫고 SDStudio 로 돌아가세요.');
    expect(callbackPage(false)).toContain('연결하지 못했습니다');
    expect(callbackPage(true)).not.toMatch(/<script|<link|src=/);
  });
});

describe('토큰 요청·응답', () => {
  test('교환 파라미터에 client_secret·code_verifier 포함', () => {
    expect(
      authorizationCodeParams({
        code: 'c',
        clientId: 'id',
        clientSecret: 'sec',
        verifier: 'v',
        redirectUri: 'r',
      }),
    ).toEqual({
      code: 'c',
      client_id: 'id',
      client_secret: 'sec',
      code_verifier: 'v',
      grant_type: 'authorization_code',
      redirect_uri: 'r',
    });
    expect(refreshTokenParams({ refreshToken: 'rt', clientId: 'id', clientSecret: 'sec' })).toEqual({
      client_id: 'id',
      client_secret: 'sec',
      grant_type: 'refresh_token',
      refresh_token: 'rt',
    });
  });

  test('성공 응답 → 만료 시각 계산·refresh token', () => {
    const r = parseTokenResponse(
      200,
      { access_token: 'at', expires_in: 3599, refresh_token: 'rt' },
      'authorization_code',
      1000,
    );
    expect(r).toEqual({ ok: true, accessToken: 'at', expiresAt: 1000 + 3599 * 1000, refreshToken: 'rt' });
  });

  test('갱신 invalid_grant = expired(연결 해제 신호)', () => {
    expect(parseTokenResponse(400, { error: 'invalid_grant' }, 'refresh_token', 0)).toEqual({
      ok: false,
      code: 'expired',
      detail: 'invalid_grant',
    });
  });

  test('교환 실패·서버 오류 분기, 오류 detail 에 토큰 값 없음', () => {
    const bad = parseTokenResponse(400, { error: 'invalid_request', access_token: '' }, 'authorization_code', 0);
    expect(bad).toEqual({ ok: false, code: 'exchange-failed', detail: 'invalid_request' });
    expect(parseTokenResponse(503, 'oops', 'refresh_token', 0)).toEqual({
      ok: false,
      code: 'server',
      detail: 'HTTP 503',
    });
  });

  test('access token 유효 판정(만료 1분 전이면 갱신 필요)', () => {
    expect(isAccessTokenFresh({ expiresAt: 200_000 }, 100_000, 60_000)).toBe(true);
    expect(isAccessTokenFresh({ expiresAt: 150_000 }, 100_000, 60_000)).toBe(false);
    expect(isAccessTokenFresh(null, 0, 60_000)).toBe(false);
  });
});

describe('about 응답', () => {
  test('이메일·용량(int64 문자열) 해석', () => {
    expect(
      parseAboutResponse({
        user: { emailAddress: 'a@b.c' },
        storageQuota: { limit: '16106127360', usage: '1000' },
      }),
    ).toEqual({ email: 'a@b.c', quota: { limit: 16106127360, usage: 1000 } });
  });
  test('무제한(limit 없음)·빈 응답', () => {
    expect(parseAboutResponse({ storageQuota: { usage: '5' } })).toEqual({
      email: undefined,
      quota: { usage: 5 },
    });
    expect(parseAboutResponse(null)).toEqual({ email: undefined, quota: undefined });
  });
});

describe('인증 파일', () => {
  // 가짜 암호화: 문자 순서 뒤집기(테스트 데이터는 ASCII 만)
  const enc = (plain: string) => Buffer.from(plain.split('').reverse().join(''), 'utf8');
  const dec = (cipher: Buffer) => cipher.toString('utf8').split('').reverse().join('');
  const record = {
    refreshToken: 'rt-secret',
    clientId: 'cid',
    email: 'a@b.c',
    connectedAt: '2026-09-28T00:00:00.000Z',
  };

  test('왕복 — 외부 형식에 평문 토큰이 드러나지 않음', () => {
    const text = encodeAuthFile(record, enc);
    const outer = JSON.parse(text);
    expect(outer).toMatchObject({ version: 1, encrypted: true });
    expect(text).not.toContain('rt-secret');
    expect(decodeAuthFile(text, dec, 'cid')).toEqual({ ok: true, record });
  });

  test('클라이언트 불일치·복호화 실패·형식 오류', () => {
    const text = encodeAuthFile(record, enc);
    expect(decodeAuthFile(text, dec, 'other')).toEqual({ ok: false, reason: 'client-mismatch' });
    expect(
      decodeAuthFile(
        text,
        () => {
          throw new Error('x');
        },
        'cid',
      ),
    ).toEqual({ ok: false, reason: 'decrypt' });
    expect(decodeAuthFile('{broken', dec, 'cid')).toEqual({ ok: false, reason: 'parse' });
    expect(decodeAuthFile('{"version":1,"encrypted":false,"payload":"a"}', dec, 'cid')).toEqual({
      ok: false,
      reason: 'format',
    });
    expect(
      decodeAuthFile(JSON.stringify({ version: 2, encrypted: true, payload: '' }), dec, 'cid'),
    ).toEqual({ ok: false, reason: 'version' });
  });
});

describe('상태 조립', () => {
  test('연결 안 됨 — persistent 는 저장소 가용 여부', () => {
    expect(buildDriveAuthStatus({ session: null, storageAvailable: false, connecting: false })).toEqual({
      connected: false,
      persistent: false,
    });
  });
  test('연결 중 표시', () => {
    expect(
      buildDriveAuthStatus({ session: null, storageAvailable: true, connecting: true }),
    ).toEqual({ connected: false, persistent: true, connecting: true });
  });
  test('연결됨 — 이메일·시각·용량·오류, 토큰 필드 없음', () => {
    const s = buildDriveAuthStatus({
      session: { email: 'a@b.c', connectedAt: 't', persistent: false },
      storageAvailable: true,
      quota: { usage: 1, limit: 2 },
      error: 'e',
      connecting: false,
    });
    expect(s).toEqual({
      connected: true,
      email: 'a@b.c',
      connectedAt: 't',
      persistent: false,
      quota: { usage: 1, limit: 2 },
      error: 'e',
    });
    expect(JSON.stringify(s)).not.toMatch(/token|secret/i);
  });
});

describe('공용 오류', () => {
  test('코드 판별·문구', () => {
    expect(isDriveAuthErrorCode('expired')).toBe(true);
    expect(isDriveAuthErrorCode('nope')).toBe(false);
    const e = new DriveAuthError('network', 'timeout');
    expect(e.code).toBe('network');
    expect(e.detail).toBe('timeout');
    expect(e.message).toBe(`${DRIVE_AUTH_ERROR_TEXT.network} (timeout)`);
    expect(e instanceof Error).toBe(true);
  });
});
