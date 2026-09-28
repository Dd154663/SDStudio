// Google 드라이브 연동 — OAuth 순수 함수 (드라이브 API ①, 2026-09-28)
//
// electron 을 import 하지 않는다(jest 로 직접 검증: src/main/__tests__/googleDriveAuth.test.ts).
// 루프백(127.0.0.1 임의 포트) + PKCE(S256) 설치형 앱 흐름. 참고본:
// guides/experiments/2026-09-28-drive-visibility/drive-exp.mjs(실험으로 검증된 절차).
//
// 보안 규칙: 여기서 만드는 오류 detail 에는 Google 의 오류 코드(error 필드)만 담는다.
// 토큰·시크릿·승인 코드 값은 어떤 문자열에도 넣지 않는다.

import crypto from 'crypto';
import type { DriveAuthErrorCode, DriveAuthQuota } from '../../shared/googleDriveAuth';

export type RandomBytes = (size: number) => Buffer;

const defaultRandom: RandomBytes = (size) => crypto.randomBytes(size);

export function base64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// RFC 7636: challenge = BASE64URL(SHA256(ASCII(verifier))).
export function pkceChallenge(verifier: string): string {
  return base64url(crypto.createHash('sha256').update(verifier, 'ascii').digest());
}

// verifier 는 unreserved 문자 43~128자. 64바이트 → base64url 86자.
export function createPkcePair(random: RandomBytes = defaultRandom): {
  verifier: string;
  challenge: string;
} {
  const verifier = base64url(random(64));
  return { verifier, challenge: pkceChallenge(verifier) };
}

export function createOAuthState(random: RandomBytes = defaultRandom): string {
  return base64url(random(24));
}

export const LOOPBACK_CALLBACK_PATH = '/callback';

export function loopbackRedirectUri(port: number): string {
  return `http://127.0.0.1:${port}${LOOPBACK_CALLBACK_PATH}`;
}

export function buildAuthUrl(opts: {
  authEndpoint: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  challenge: string;
  state: string;
}): string {
  const url = new URL(opts.authEndpoint);
  url.search = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: 'code',
    scope: opts.scope,
    // refresh token 발급(오프라인 접근) + 매번 동의 화면(재연결 시에도 refresh token 보장)
    access_type: 'offline',
    prompt: 'consent',
    code_challenge: opts.challenge,
    code_challenge_method: 'S256',
    state: opts.state,
  }).toString();
  return url.toString();
}

export type CallbackResult =
  | { kind: 'not-callback' }
  | { kind: 'code'; code: string }
  | { kind: 'error'; code: DriveAuthErrorCode; detail?: string };

// 루프백 서버가 받은 요청 경로(req.url)를 판정한다. 콜백 경로가 아니면 무시(favicon 등).
export function parseCallbackRequest(
  reqUrl: string | undefined,
  expectedState: string,
): CallbackResult {
  let u: URL;
  try {
    u = new URL(reqUrl || '/', 'http://127.0.0.1');
  } catch {
    return { kind: 'not-callback' };
  }
  if (u.pathname !== LOOPBACK_CALLBACK_PATH) return { kind: 'not-callback' };
  const error = u.searchParams.get('error');
  if (error) {
    return {
      kind: 'error',
      code: error === 'access_denied' ? 'denied' : 'exchange-failed',
      detail: sanitizeOAuthErrorCode(error),
    };
  }
  if (u.searchParams.get('state') !== expectedState) {
    return { kind: 'error', code: 'state-mismatch' };
  }
  const code = u.searchParams.get('code');
  if (!code) return { kind: 'error', code: 'exchange-failed', detail: 'no_code' };
  return { kind: 'code', code };
}

// Google 오류 코드는 영문 소문자·밑줄이다. 그 밖의 문자는 표시하지 않는다(주입·유출 방지).
export function sanitizeOAuthErrorCode(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.slice(0, 64);
  return /^[a-z0-9_.-]+$/i.test(s) ? s : undefined;
}

// 브라우저에 보여 줄 완료/실패 페이지. 인라인 스타일만(외부 요청 없음).
export function callbackPage(ok: boolean): string {
  const title = ok ? '연결이 완료되었습니다' : '연결하지 못했습니다';
  const message = ok
    ? '연결이 완료되었습니다. 이 창을 닫고 SDStudio 로 돌아가세요.'
    : '연결하지 못했습니다. 이 창을 닫고 SDStudio 에서 다시 시도해 주세요.';
  const color = ok ? '#15803d' : '#b91c1c';
  return (
    '<!doctype html><html lang="ko"><head><meta charset="utf-8">' +
    `<meta name="viewport" content="width=device-width,initial-scale=1"><title>SDStudio — ${title}</title></head>` +
    '<body style="margin:0;font-family:system-ui,-apple-system,\'Segoe UI\',\'Malgun Gothic\',sans-serif;background:#f8fafc;color:#0f172a">' +
    '<div style="max-width:32rem;margin:15vh auto;padding:2rem;border-radius:12px;background:#fff;border:1px solid #e2e8f0">' +
    `<h1 style="margin:0 0 .75rem;font-size:1.25rem;color:${color}">${title}</h1>` +
    `<p style="margin:0;line-height:1.6">${message}</p>` +
    '</div></body></html>'
  );
}

export function authorizationCodeParams(opts: {
  code: string;
  clientId: string;
  clientSecret: string;
  verifier: string;
  redirectUri: string;
}): Record<string, string> {
  return {
    code: opts.code,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    code_verifier: opts.verifier,
    grant_type: 'authorization_code',
    redirect_uri: opts.redirectUri,
  };
}

export function refreshTokenParams(opts: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Record<string, string> {
  return {
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: opts.refreshToken,
  };
}

export type TokenResponseResult =
  | {
      ok: true;
      accessToken: string;
      // 절대 시각(ms). expires_in 이 없으면 보수적으로 1시간 뒤.
      expiresAt: number;
      refreshToken?: string;
    }
  | { ok: false; code: DriveAuthErrorCode; detail?: string };

// 토큰 엔드포인트 응답 해석. grant = 교환(authorization_code)인지 갱신(refresh_token)인지.
// 갱신에서 invalid_grant(만료·철회) = 'expired' → 호출부가 연결을 해제 상태로 바꾼다.
export function parseTokenResponse(
  httpStatus: number,
  body: unknown,
  grant: 'authorization_code' | 'refresh_token',
  now: number,
): TokenResponseResult {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  if (httpStatus >= 200 && httpStatus < 300 && typeof b.access_token === 'string' && b.access_token) {
    const sec = Number(b.expires_in);
    return {
      ok: true,
      accessToken: b.access_token,
      expiresAt: now + (Number.isFinite(sec) && sec > 0 ? sec : 3600) * 1000,
      refreshToken:
        typeof b.refresh_token === 'string' && b.refresh_token ? b.refresh_token : undefined,
    };
  }
  const error = sanitizeOAuthErrorCode(b.error);
  if (grant === 'refresh_token' && error === 'invalid_grant') {
    return { ok: false, code: 'expired', detail: error };
  }
  if (httpStatus >= 500) {
    return { ok: false, code: 'server', detail: error ?? `HTTP ${httpStatus}` };
  }
  return { ok: false, code: 'exchange-failed', detail: error ?? `HTTP ${httpStatus}` };
}

function toFiniteNumber(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

// about.get(fields=user(emailAddress),storageQuota) 응답 → 이메일·용량.
// storageQuota 의 값은 int64 문자열이다. limit 없음 = 무제한.
export function parseAboutResponse(body: unknown): { email?: string; quota?: DriveAuthQuota } {
  const b = body && typeof body === 'object' ? (body as any) : {};
  const email =
    typeof b.user?.emailAddress === 'string' && b.user.emailAddress ? b.user.emailAddress : undefined;
  const sq = b.storageQuota && typeof b.storageQuota === 'object' ? b.storageQuota : undefined;
  let quota: DriveAuthQuota | undefined;
  if (sq) {
    const limit = toFiniteNumber(sq.limit);
    const usage = toFiniteNumber(sq.usage);
    if (limit !== undefined || usage !== undefined) {
      quota = {};
      if (limit !== undefined) quota.limit = limit;
      if (usage !== undefined) quota.usage = usage;
    }
  }
  return { email, quota };
}

export function isAccessTokenFresh(
  access: { expiresAt: number } | null | undefined,
  now: number,
  marginMs: number,
): boolean {
  return !!access && Number.isFinite(access.expiresAt) && now < access.expiresAt - marginMs;
}
