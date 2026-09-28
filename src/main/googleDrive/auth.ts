// Google 드라이브 연동 — 루프백 승인 대기 (드라이브 API ①, 2026-09-28)
//
// 1) PKCE·state 생성 → 2) 127.0.0.1 포트 0(임의 포트) 로 1회용 HTTP 서버 → 3) 시스템
// 브라우저로 동의 화면 열기(임베디드 WebView 는 Google 이 차단) → 4) /callback 에서 state
// 검증 후 승인 코드 수신 → 서버 닫기. 5분 제한·취소 지원. 토큰 교환은 index.ts 가 한다.

import http from 'http';
import type { AddressInfo } from 'net';
import { DriveAuthError } from '../../shared/googleDriveAuth';
import {
  buildAuthUrl,
  callbackPage,
  createOAuthState,
  createPkcePair,
  loopbackRedirectUri,
  parseCallbackRequest,
} from './oauth';

export interface LoopbackAuthorization {
  redirectUri: string;
  verifier: string;
  // 승인 코드로 resolve. 거부·state 불일치·시간 초과·취소는 DriveAuthError 로 reject.
  code: Promise<string>;
  cancel: () => void;
}

export async function startLoopbackAuthorization(opts: {
  authEndpoint: string;
  clientId: string;
  scope: string;
  timeoutMs: number;
  openExternal: (url: string) => Promise<void>;
}): Promise<LoopbackAuthorization> {
  const { verifier, challenge } = createPkcePair();
  const state = createOAuthState();

  let settled = false;
  let resolveCode!: (code: string) => void;
  let rejectCode!: (e: Error) => void;
  const code = new Promise<string>((res, rej) => {
    resolveCode = res;
    rejectCode = rej;
  });
  // 호출부가 await 하기 전에 거부돼도 처리되지 않은 거부 경고가 나지 않게 한다.
  code.catch(() => {});

  let timer: ReturnType<typeof setTimeout> | null = null;

  const server = http.createServer((req, res) => {
    const parsed = parseCallbackRequest(req.url, state);
    if (parsed.kind === 'not-callback') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', Connection: 'close' });
      res.end('not found');
      return;
    }
    const ok = parsed.kind === 'code';
    res.writeHead(ok ? 200 : 400, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'close',
    });
    res.end(callbackPage(ok));
    // 응답은 Connection: close 로 전송 뒤 소켓이 닫히므로 강제 종료하지 않는다.
    if (parsed.kind === 'code') settle(null, parsed.code, false);
    else settle(new DriveAuthError(parsed.code, parsed.detail), undefined, false);
  });

  // force = 브라우저가 열어 둔 keep-alive·예비 연결까지 끊는다(취소·시간 초과).
  const shutdown = (force: boolean) => {
    if (timer) clearTimeout(timer);
    timer = null;
    try {
      server.close();
      if (force) (server as any).closeAllConnections?.();
      else (server as any).closeIdleConnections?.();
    } catch {
      /* 이미 닫힘 */
    }
  };

  function settle(err: Error | null, value?: string, force = true) {
    if (settled) return;
    settled = true;
    shutdown(force);
    if (err) rejectCode(err);
    else resolveCode(value!);
  }

  await new Promise<void>((resolve, reject) => {
    const onError = (e: any) => {
      reject(new DriveAuthError('unknown', `loopback_${e?.code || 'error'}`));
    };
    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError);
      // 대기 중 서버 오류 = 연결 실패로 끝낸다.
      server.on('error', (e: any) =>
        settle(new DriveAuthError('unknown', `loopback_${e?.code || 'error'}`)),
      );
      resolve();
    });
  });

  const port = (server.address() as AddressInfo).port;
  const redirectUri = loopbackRedirectUri(port);
  const authUrl = buildAuthUrl({
    authEndpoint: opts.authEndpoint,
    clientId: opts.clientId,
    redirectUri,
    scope: opts.scope,
    challenge,
    state,
  });

  timer = setTimeout(() => settle(new DriveAuthError('timeout')), opts.timeoutMs);

  try {
    await opts.openExternal(authUrl);
  } catch {
    settle(new DriveAuthError('unknown', 'open_browser'));
  }

  return {
    redirectUri,
    verifier,
    code,
    cancel: () => settle(new DriveAuthError('cancelled')),
  };
}
