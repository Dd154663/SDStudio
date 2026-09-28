// Google 드라이브 연동 — main 프로세스 HTTP 헬퍼 (드라이브 API ①, 2026-09-28)
//
// electron net.fetch(Chromium 네트워크 스택 — 시스템 프록시·인증서 설정을 따른다)를 쓰고,
// 없으면 Node 내장 fetch 로 대체한다. 외부 의존성 없음.
// 네트워크 오류는 DriveAuthError('network') 로 바꾼다. 요청·응답 본문은 로그에 남기지 않는다.

import { net } from 'electron';
import { DriveAuthError } from '../../shared/googleDriveAuth';
import { HTTP_TIMEOUT_MS } from './client';

export interface HttpResult {
  status: number;
  // JSON 이면 객체, 아니면 원문 문자열(빈 응답은 '').
  body: unknown;
}

function pickFetch(): typeof fetch {
  const netFetch = (net as any)?.fetch;
  if (typeof netFetch === 'function') return netFetch.bind(net) as typeof fetch;
  return globalThis.fetch.bind(globalThis);
}

export async function httpRequest(
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: string },
  timeoutMs = HTTP_TIMEOUT_MS,
): Promise<HttpResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await pickFetch()(url, { ...init, signal: controller.signal });
  } catch (e: any) {
    throw new DriveAuthError('network', controller.signal.aborted ? 'timeout' : undefined);
  } finally {
    clearTimeout(timer);
  }
  let text = '';
  try {
    text = await res.text();
  } catch {
    throw new DriveAuthError('network');
  }
  let body: unknown = text;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      /* JSON 아님 — 원문 유지 */
    }
  }
  return { status: res.status, body };
}

export function postForm(url: string, params: Record<string, string>): Promise<HttpResult> {
  return httpRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
}
