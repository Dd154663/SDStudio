// Google 드라이브 연동 — 인증 파일 직렬화 순수 함수 (드라이브 API ①, 2026-09-28)
//
// 파일 형식: { version:1, encrypted:true, payload:<base64(safeStorage.encryptString(JSON))> }
// 내부 JSON: { refresh_token, client_id, email?, connected_at }
// 암호화·복호화 함수는 주입받는다(electron safeStorage 는 store.ts 에서만 쓴다) → jest 로 검증.

export interface DriveAuthRecord {
  refreshToken: string;
  clientId: string;
  email?: string;
  // ISO 8601
  connectedAt: string;
}

export const DRIVE_AUTH_FILE_VERSION = 1;

export function encodeAuthFile(
  record: DriveAuthRecord,
  encrypt: (plain: string) => Buffer,
): string {
  const inner = JSON.stringify({
    refresh_token: record.refreshToken,
    client_id: record.clientId,
    ...(record.email ? { email: record.email } : {}),
    connected_at: record.connectedAt,
  });
  return JSON.stringify({
    version: DRIVE_AUTH_FILE_VERSION,
    encrypted: true,
    payload: encrypt(inner).toString('base64'),
  });
}

// 실패 사유는 로그용 짧은 코드만 돌려준다(내용 미포함).
export type DecodeAuthFileResult =
  | { ok: true; record: DriveAuthRecord }
  | {
      ok: false;
      reason: 'parse' | 'format' | 'version' | 'decrypt' | 'payload' | 'client-mismatch';
    };

export function decodeAuthFile(
  text: string,
  decrypt: (cipher: Buffer) => string,
  expectedClientId: string,
): DecodeAuthFileResult {
  let outer: any;
  try {
    outer = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return { ok: false, reason: 'parse' };
  }
  if (!outer || typeof outer !== 'object' || outer.encrypted !== true || typeof outer.payload !== 'string') {
    return { ok: false, reason: 'format' };
  }
  if (outer.version !== DRIVE_AUTH_FILE_VERSION) return { ok: false, reason: 'version' };
  let plain: string;
  try {
    plain = decrypt(Buffer.from(outer.payload, 'base64'));
  } catch {
    return { ok: false, reason: 'decrypt' };
  }
  let inner: any;
  try {
    inner = JSON.parse(plain);
  } catch {
    return { ok: false, reason: 'payload' };
  }
  if (
    !inner ||
    typeof inner !== 'object' ||
    typeof inner.refresh_token !== 'string' ||
    !inner.refresh_token ||
    typeof inner.client_id !== 'string'
  ) {
    return { ok: false, reason: 'payload' };
  }
  if (inner.client_id !== expectedClientId) return { ok: false, reason: 'client-mismatch' };
  return {
    ok: true,
    record: {
      refreshToken: inner.refresh_token,
      clientId: inner.client_id,
      email: typeof inner.email === 'string' && inner.email ? inner.email : undefined,
      connectedAt: typeof inner.connected_at === 'string' ? inner.connected_at : '',
    },
  };
}
