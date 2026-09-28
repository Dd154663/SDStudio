// Google 드라이브 연동 — main·renderer 공용 타입과 오류 문구 (드라이브 API ①, 2026-09-28)
//
// main(src/main/googleDrive)이 인증 상태의 유일한 진실이다. renderer 는 이 파일의
// DriveAuthStatus 만 받는다 — refresh/access 토큰·클라이언트 시크릿은 renderer 로 보내지 않는다.
// 오류는 코드(DriveAuthErrorCode)로 주고받고, 사용자 문구는 DRIVE_AUTH_ERROR_TEXT 한 곳에 둔다
// (main 의 status.error 와 renderer 의 연결 실패 안내가 같은 문구를 쓰도록).

export interface DriveAuthQuota {
  // 바이트. 무제한 계정은 limit 이 없다.
  limit?: number;
  usage?: number;
}

export interface DriveAuthStatus {
  connected: boolean;
  email?: string;
  // 연결 시각(ISO 8601).
  connectedAt?: string;
  // 인증 정보를 디스크에 암호화 저장할 수 있는지(연결 안 됨 상태에서도 미리 알림용).
  // false = safeStorage 암호화 불가 → 이 실행 중에만 유지.
  persistent: boolean;
  quota?: DriveAuthQuota;
  // 연결은 유지된 채 드라이브 정보 조회만 실패했을 때 등 표시용 문구.
  error?: string;
  // 어느 창에서든 브라우저 승인을 기다리는 중이면 true(다른 창 표시 동기화용).
  connecting?: boolean;
}

export type DriveAuthErrorCode =
  | 'cancelled'
  | 'timeout'
  | 'denied'
  | 'busy'
  | 'already-connected'
  | 'not-connected'
  | 'state-mismatch'
  | 'exchange-failed'
  | 'no-refresh-token'
  | 'expired'
  | 'network'
  | 'server'
  | 'unknown';

export const DRIVE_AUTH_ERROR_TEXT: Record<DriveAuthErrorCode, string> = {
  cancelled: '연결을 취소했습니다.',
  timeout: '5분 안에 브라우저 승인이 완료되지 않아 연결을 중단했습니다. 다시 시도해 주세요.',
  denied: '브라우저에서 권한 허용이 거부되었습니다.',
  busy: '이미 연결을 진행하고 있습니다. 브라우저에서 승인하거나 취소해 주세요.',
  'already-connected': '이미 연결되어 있습니다. 다른 계정으로 바꾸려면 먼저 연결을 해제해 주세요.',
  'not-connected': 'Google 드라이브에 연결되어 있지 않습니다.',
  'state-mismatch': '승인 응답이 이 요청과 일치하지 않아 중단했습니다. 다시 시도해 주세요.',
  'exchange-failed': 'Google 에서 인증 정보를 받지 못했습니다. 잠시 뒤 다시 시도해 주세요.',
  'no-refresh-token':
    'Google 에서 장기 인증 정보를 받지 못했습니다. Google 계정 권한 페이지에서 SDStudio 를 삭제한 뒤 다시 연결해 주세요.',
  expired: '연결이 만료되었거나 Google 계정에서 권한이 해제되었습니다. 다시 연결해 주세요.',
  network: '네트워크에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요.',
  server: 'Google 서버 응답이 올바르지 않습니다. 잠시 뒤 다시 시도해 주세요.',
  unknown: '알 수 없는 오류로 연결하지 못했습니다.',
};

// 연결은 유지된 채 이메일·용량 조회만 실패했을 때 status.error 문구.
export function driveInfoFailedText(code: DriveAuthErrorCode): string {
  return `드라이브 정보를 새로 고치지 못했습니다(연결은 유지됩니다). ${DRIVE_AUTH_ERROR_TEXT[code]}`;
}

export function isDriveAuthErrorCode(v: unknown): v is DriveAuthErrorCode {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(DRIVE_AUTH_ERROR_TEXT, v);
}

// 코드가 붙은 오류. main 은 throw, IPC 경계에서는 { ok:false, code, detail } 로 직렬화한다
// (Electron 이 invoke 오류 메시지 앞에 붙이는 접두어 없이 코드를 그대로 전달하기 위함).
export class DriveAuthError extends Error {
  readonly code: DriveAuthErrorCode;
  // Google 오류 코드 등 짧은 참고값(토큰·시크릿 값은 넣지 않는다).
  readonly detail?: string;

  constructor(code: DriveAuthErrorCode, detail?: string) {
    super(detail ? `${DRIVE_AUTH_ERROR_TEXT[code]} (${detail})` : DRIVE_AUTH_ERROR_TEXT[code]);
    this.name = 'DriveAuthError';
    this.code = code;
    this.detail = detail;
  }
}

// drive-auth-connect IPC 응답 형식.
export type DriveAuthConnectResult =
  | { ok: true; status: DriveAuthStatus }
  | { ok: false; code: DriveAuthErrorCode; detail?: string };

// IPC 채널 이름(main.ts·preload·electronBackend 공용).
export const DRIVE_AUTH_CHANNEL = {
  status: 'drive-auth-status',
  connect: 'drive-auth-connect',
  cancel: 'drive-auth-cancel',
  disconnect: 'drive-auth-disconnect',
  changed: 'drive-auth-changed',
} as const;
