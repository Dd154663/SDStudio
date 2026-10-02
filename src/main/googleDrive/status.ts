// Google 드라이브 연동 — renderer 에 보낼 상태 조립 순수 함수 (드라이브 API ①, 2026-09-28)
//
// 토큰 값은 입력에 받지 않는다(구조상 renderer 로 새지 않게). jest 로 분기 검증.

import { DRIVE_AUTH_ERROR_TEXT } from '../../shared/googleDriveAuth';
import type { DriveAuthQuota, DriveAuthStatus } from '../../shared/googleDriveAuth';

export interface DriveAuthStateSnapshot {
  // 연결된 세션(없으면 null). 세션이 디스크에 저장됐는지(persistent) 포함.
  session: { email?: string; connectedAt?: string; persistent: boolean } | null;
  // 이번 실행에서 safeStorage 암호화를 쓸 수 있는지(연결 안 됨일 때 persistent 로 표시).
  storageAvailable: boolean;
  quota?: DriveAuthQuota;
  error?: string;
  connecting: boolean;
  // OAuth 클라이언트 값이 주입되지 않은 빌드면 false(생략 = true).
  configured?: boolean;
}

export function buildDriveAuthStatus(s: DriveAuthStateSnapshot): DriveAuthStatus {
  // 설정 없는 빌드 — 세션·오류·연결 중 여부와 무관하게 「설정 없음」 하나로 고정한다.
  if (s.configured === false) {
    return {
      connected: false,
      persistent: s.storageAvailable,
      notConfigured: true,
      error: DRIVE_AUTH_ERROR_TEXT['not-configured'],
    };
  }
  const out: DriveAuthStatus = s.session
    ? {
        connected: true,
        persistent: s.session.persistent,
        ...(s.session.email ? { email: s.session.email } : {}),
        ...(s.session.connectedAt ? { connectedAt: s.session.connectedAt } : {}),
        ...(s.quota ? { quota: { ...s.quota } } : {}),
      }
    : { connected: false, persistent: s.storageAvailable };
  if (s.error) out.error = s.error;
  if (s.connecting) out.connecting = true;
  return out;
}
