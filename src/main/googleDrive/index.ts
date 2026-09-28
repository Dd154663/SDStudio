// Google 드라이브 연동 — main 단일 인증 상태 (드라이브 API ①, 2026-09-28)
//
// 모든 창이 이 모듈 하나의 상태를 공유한다(다중 창 안전). 상태가 바뀌면 전 창에
// 'drive-auth-changed'(DriveAuthStatus) 를 보낸다. renderer 에는 상태만 나가고
// refresh/access token·client_secret 은 main 밖으로 나가지 않는다.
//
// - 연결: 루프백 PKCE(auth.ts) → 토큰 교환(client_secret 필수) → safeStorage 저장(store.ts)
//   → about.get 으로 이메일·용량. 저장 불가 환경은 메모리만(persistent:false).
// - access token: 메모리만. 만료 1분 전 자동 갱신, 갱신이 invalid_grant 면 연결 해제 상태로
//   바꾸고 파일 삭제.
// - 해제: 로컬 인증 정보(메모리·파일)를 먼저 지운 뒤 revoke 요청(실패해도 해제는 완료).
// - getAccessToken() 은 ②(업로드) 이후 Drive 호출이 쓴다.

import { BrowserWindow, shell } from 'electron';
import log from 'electron-log';
import {
  DRIVE_AUTH_CHANNEL,
  DRIVE_AUTH_ERROR_TEXT,
  DriveAuthConnectResult,
  DriveAuthError,
  DriveAuthQuota,
  DriveAuthStatus,
  driveInfoFailedText,
} from '../../shared/googleDriveAuth';
import {
  ACCESS_TOKEN_REFRESH_MARGIN_MS,
  AUTH_TIMEOUT_MS,
  GOOGLE_AUTH_ENDPOINT,
  GOOGLE_DRIVE_ABOUT_ENDPOINT,
  GOOGLE_DRIVE_SCOPE,
  GOOGLE_OAUTH_CLIENT_ID,
  GOOGLE_OAUTH_CLIENT_SECRET,
  GOOGLE_REVOKE_ENDPOINT,
  GOOGLE_TOKEN_ENDPOINT,
} from './client';
import { LoopbackAuthorization, startLoopbackAuthorization } from './auth';
import {
  authorizationCodeParams,
  isAccessTokenFresh,
  parseAboutResponse,
  parseTokenResponse,
  refreshTokenParams,
} from './oauth';
import { httpRequest, postForm } from './http';
import {
  deleteAuthFile,
  isPersistentStorageAvailable,
  loadAuthRecord,
  saveAuthRecord,
} from './store';
import type { DriveAuthRecord } from './authFile';
import { buildDriveAuthStatus } from './status';

interface Session {
  record: DriveAuthRecord;
  // 디스크(암호화)에 저장됐는지. false = 이 실행 중에만 유지.
  persistent: boolean;
}

interface PendingConnect {
  auth: LoopbackAuthorization | null;
  cancelled: boolean;
}

let loadPromise: Promise<void> | null = null;
let session: Session | null = null;
let access: { token: string; expiresAt: number } | null = null;
let refreshing: Promise<string> | null = null;
let quota: DriveAuthQuota | undefined;
let lastError: string | undefined;
let pending: PendingConnect | null = null;
// 세션이 바뀔 때마다 증가 — 진행 중이던 갱신·조회 결과가 해제/재연결 뒤에 반영되지 않게 한다.
let generation = 0;

function ensureLoaded(): Promise<void> {
  if (!loadPromise) {
    loadPromise = (async () => {
      const record = await loadAuthRecord(GOOGLE_OAUTH_CLIENT_ID);
      if (record && !session) {
        session = { record, persistent: true };
        generation++;
      }
    })();
  }
  return loadPromise;
}

function currentStatus(): DriveAuthStatus {
  return buildDriveAuthStatus({
    session: session
      ? {
          email: session.record.email,
          connectedAt: session.record.connectedAt,
          persistent: session.persistent,
        }
      : null,
    storageAvailable: isPersistentStorageAvailable(),
    quota,
    error: lastError,
    connecting: !!pending,
  });
}

function broadcastStatus() {
  const status = currentStatus();
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(DRIVE_AUTH_CHANNEL.changed, status);
  }
}

async function clearSession(): Promise<void> {
  session = null;
  access = null;
  quota = undefined;
  generation++;
  await deleteAuthFile();
}

async function persistSession(): Promise<void> {
  if (!session || !session.persistent) return;
  const ok = await saveAuthRecord(session.record);
  if (!ok) session.persistent = false;
}

async function refreshAccessToken(): Promise<string> {
  if (!session) throw new DriveAuthError('not-connected');
  const gen = generation;
  const r = await postForm(
    GOOGLE_TOKEN_ENDPOINT,
    refreshTokenParams({
      refreshToken: session.record.refreshToken,
      clientId: GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: GOOGLE_OAUTH_CLIENT_SECRET,
    }),
  );
  if (gen !== generation || !session) throw new DriveAuthError('not-connected');
  const parsed = parseTokenResponse(r.status, r.body, 'refresh_token', Date.now());
  if (!parsed.ok) {
    if (parsed.code === 'expired') {
      log.warn('[googleDrive] refresh token 이 만료·철회되어 연결을 해제합니다');
      await clearSession();
      lastError = DRIVE_AUTH_ERROR_TEXT.expired;
      broadcastStatus();
    }
    throw new DriveAuthError(parsed.code, parsed.detail);
  }
  access = { token: parsed.accessToken, expiresAt: parsed.expiresAt };
  // Google 이 새 refresh token 을 주는 경우(드묾)만 교체 저장.
  if (parsed.refreshToken && parsed.refreshToken !== session.record.refreshToken) {
    session.record = { ...session.record, refreshToken: parsed.refreshToken };
    await persistSession();
  }
  return parsed.accessToken;
}

// Drive API 호출용 access token(②~에서 사용). 연결 안 됨·만료는 DriveAuthError.
export async function getAccessToken(): Promise<string> {
  await ensureLoaded();
  if (!session) throw new DriveAuthError('not-connected');
  if (access && isAccessTokenFresh(access, Date.now(), ACCESS_TOKEN_REFRESH_MARGIN_MS)) {
    return access.token;
  }
  if (!refreshing) {
    refreshing = refreshAccessToken().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

// Drive 호출이 401 을 받았을 때 — 메모리의 access token 을 버려 다음 getAccessToken 이 갱신하게 한다.
// usedToken 이 지금 토큰과 다르면(이미 다른 호출이 갱신함) 아무것도 하지 않는다.
export function invalidateAccessToken(usedToken: string): void {
  if (access && access.token === usedToken) access = null;
}

// 연결 여부만(네트워크 조회 없음). 내보내기 목적지 결정용(드라이브 API ②).
export async function isConnected(): Promise<boolean> {
  await ensureLoaded();
  return !!session;
}

// about.get 으로 이메일·용량 갱신. 401 이면 access token 을 버리고 1회 재시도.
async function refreshAboutInfo(): Promise<void> {
  const gen = generation;
  let r = await httpRequest(GOOGLE_DRIVE_ABOUT_ENDPOINT, {
    method: 'GET',
    headers: { Authorization: `Bearer ${await getAccessToken()}` },
  });
  if (r.status === 401 && gen === generation) {
    access = null;
    r = await httpRequest(GOOGLE_DRIVE_ABOUT_ENDPOINT, {
      method: 'GET',
      headers: { Authorization: `Bearer ${await getAccessToken()}` },
    });
  }
  if (gen !== generation || !session) return;
  if (r.status < 200 || r.status >= 300) {
    throw new DriveAuthError('server', `HTTP ${r.status}`);
  }
  const info = parseAboutResponse(r.body);
  quota = info.quota;
  if (info.email && info.email !== session.record.email) {
    session.record = { ...session.record, email: info.email };
    await persistSession();
  }
}

// 연결 유지 중 조회 실패는 status.error 문구로만 남긴다. 만료(연결 해제)는 이미 처리됨.
async function refreshAboutSafely(): Promise<void> {
  try {
    await refreshAboutInfo();
    if (session) lastError = undefined;
  } catch (e: any) {
    if (session) {
      lastError = driveInfoFailedText(e instanceof DriveAuthError ? e.code : 'unknown');
    }
  }
}

export async function getStatus(): Promise<DriveAuthStatus> {
  await ensureLoaded();
  if (session && !pending) {
    await refreshAboutSafely();
  }
  return currentStatus();
}

async function revokeToken(token: string): Promise<void> {
  try {
    const r = await httpRequest(
      `${GOOGLE_REVOKE_ENDPOINT}?token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: '',
      },
    );
    if (r.status < 200 || r.status >= 300) {
      log.warn('[googleDrive] 권한 철회 요청 실패', `HTTP ${r.status}`);
    }
  } catch (e: any) {
    log.warn('[googleDrive] 권한 철회 요청 실패', e?.code || 'network');
  }
}

export async function connect(): Promise<DriveAuthStatus> {
  await ensureLoaded();
  if (pending) throw new DriveAuthError('busy');
  if (session) throw new DriveAuthError('already-connected');
  const attempt: PendingConnect = { auth: null, cancelled: false };
  pending = attempt;
  lastError = undefined;
  broadcastStatus();
  try {
    const auth = await startLoopbackAuthorization({
      authEndpoint: GOOGLE_AUTH_ENDPOINT,
      clientId: GOOGLE_OAUTH_CLIENT_ID,
      scope: GOOGLE_DRIVE_SCOPE,
      timeoutMs: AUTH_TIMEOUT_MS,
      openExternal: (url) => shell.openExternal(url),
    });
    attempt.auth = auth;
    if (attempt.cancelled) auth.cancel();
    const code = await auth.code;
    if (attempt.cancelled) throw new DriveAuthError('cancelled');

    const r = await postForm(
      GOOGLE_TOKEN_ENDPOINT,
      authorizationCodeParams({
        code,
        clientId: GOOGLE_OAUTH_CLIENT_ID,
        clientSecret: GOOGLE_OAUTH_CLIENT_SECRET,
        verifier: auth.verifier,
        redirectUri: auth.redirectUri,
      }),
    );
    const parsed = parseTokenResponse(r.status, r.body, 'authorization_code', Date.now());
    if (!parsed.ok) throw new DriveAuthError(parsed.code, parsed.detail);
    if (!parsed.refreshToken) {
      // 장기 연결을 유지할 수 없으므로 받은 access token 도 철회하고 실패로 끝낸다.
      await revokeToken(parsed.accessToken);
      throw new DriveAuthError('no-refresh-token');
    }
    if (attempt.cancelled) {
      // 교환 중 취소 — 방금 받은 권한을 되돌린다.
      await revokeToken(parsed.refreshToken);
      throw new DriveAuthError('cancelled');
    }

    const record: DriveAuthRecord = {
      refreshToken: parsed.refreshToken,
      clientId: GOOGLE_OAUTH_CLIENT_ID,
      connectedAt: new Date().toISOString(),
    };
    const persistent = await saveAuthRecord(record);
    session = { record, persistent };
    access = { token: parsed.accessToken, expiresAt: parsed.expiresAt };
    quota = undefined;
    generation++;
  } catch (e: any) {
    if (e instanceof DriveAuthError) {
      if (e.code !== 'cancelled') log.warn('[googleDrive] 연결 실패', e.code);
      throw e;
    }
    log.warn('[googleDrive] 연결 실패(예상 밖 오류)', e?.name || 'Error');
    throw new DriveAuthError('unknown');
  } finally {
    if (pending === attempt) pending = null;
    broadcastStatus();
  }
  // 이메일·용량은 실패해도 연결을 유지한다.
  await refreshAboutSafely();
  broadcastStatus();
  return currentStatus();
}

// IPC 경계용 — 오류를 코드로 직렬화한다(Electron invoke 오류 접두어 회피).
export async function connectForIpc(): Promise<DriveAuthConnectResult> {
  try {
    return { ok: true, status: await connect() };
  } catch (e: any) {
    if (e instanceof DriveAuthError) {
      return { ok: false, code: e.code, ...(e.detail ? { detail: e.detail } : {}) };
    }
    return { ok: false, code: 'unknown' };
  }
}

export function cancelConnect(): void {
  if (!pending) return;
  pending.cancelled = true;
  pending.auth?.cancel();
}

export async function disconnect(): Promise<void> {
  await ensureLoaded();
  cancelConnect();
  const token = session?.record.refreshToken;
  // 저장소 불가 환경에서 읽지 않은 파일이 남아 있을 수 있으므로 세션 유무와 관계없이 삭제한다.
  await clearSession();
  lastError = undefined;
  broadcastStatus();
  if (token) await revokeToken(token);
}
