// Google 드라이브 연동 — 설정 화면 문구와 표시용 순수 함수 (드라이브 API ①, 2026-09-28)
//
// 인증 상태의 진실은 main(src/main/googleDrive)이다. 여기서는 backend.driveAuthStatus()
// 결과(DriveAuthStatus)를 화면 요약으로 바꾸기만 한다. 사용자 문구는 이 파일 한 곳에 둔다
// (오류 코드별 문구는 main 과 공유하는 shared/googleDriveAuth.ts 의 DRIVE_AUTH_ERROR_TEXT).
// jest: __tests__/googleDrive.test.ts

import {
  DRIVE_AUTH_ERROR_TEXT,
  DriveAuthStatus,
  isDriveAuthErrorCode,
} from '../../shared/googleDriveAuth';

export const GOOGLE_DRIVE_TEXT = {
  sectionTitle: 'Google 드라이브 연동',
  status: {
    connected: '연결됨',
    disconnected: '연결 안 됨',
    connecting: '연결 중…',
    loading: '확인 중…',
  },
  connectButton: 'Google 계정 연결',
  disconnectButton: '연결 해제',
  cancelButton: '취소',
  connectingHint: '브라우저에서 승인해 주세요',
  description:
    '앱이 만든 SDStudio 폴더의 백업 파일에만 접근합니다(drive.file). 자동 동기화는 없으며 올리기·받기는 직접 실행합니다.',
  storageNote:
    '인증 정보는 이 PC 에만 암호화해 저장되며, 백업·내보내기·환경설정 파일에는 포함되지 않습니다.',
  notPersistentConnected:
    '이 PC 에서는 인증 정보를 암호화해 저장할 수 없어 이 실행 중에만 유지됩니다. 앱을 다시 시작하면 다시 연결해야 합니다.',
  notPersistentBefore:
    '이 PC 에서는 인증 정보를 암호화해 저장할 수 없어, 연결하더라도 이 실행 중에만 유지됩니다.',
  emailUnknown: '계정 이메일을 확인하지 못했습니다',
  androidUnsupported: 'Android 에서는 아직 Google 드라이브 연동을 지원하지 않습니다.',
  disconnectConfirm:
    '연결을 해제하면 저장된 인증 정보가 삭제됩니다. 드라이브의 파일은 그대로 남습니다.',
  disconnectConfirmButton: '연결 해제',
  connected: (email?: string) =>
    `Google 드라이브에 연결했습니다${email ? ` (${email})` : ''}.`,
  disconnected: 'Google 드라이브 연결을 해제했습니다.',
  connectFailed: (code: unknown, detail?: string) => {
    const reason = isDriveAuthErrorCode(code)
      ? DRIVE_AUTH_ERROR_TEXT[code]
      : DRIVE_AUTH_ERROR_TEXT.unknown;
    return `Google 드라이브에 연결하지 못했습니다.\n${reason}${detail ? `\n(${detail})` : ''}`;
  },
  statusFailed: '연결 상태를 확인하지 못했습니다. 앱을 다시 시작한 뒤 확인해 주세요.',
  disconnectFailed: (message: string) =>
    `연결 해제 중 문제가 발생했습니다.\n${message}`,
  quotaUsed: (usage: string, limit?: string) =>
    limit ? `${usage} / ${limit} 사용` : `${usage} 사용`,
};

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

// 1024 단위. 100 이상은 정수, 그 아래는 소수 한 자리(끝 .0 생략). Google 드라이브 표기와 맞춘다
// (15 GiB 무료 용량 = 「15 GB」).
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  if (unit === 0) return `${Math.round(value)} B`;
  const text = value >= 100 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, '');
  return `${text} ${BYTE_UNITS[unit]}`;
}

// 「3.2 GB / 15 GB 사용」. 사용량을 모르면 빈 문자열, 한도가 없으면(무제한) 사용량만.
export function formatQuota(usage?: number, limit?: number): string {
  if (usage === undefined || usage === null) return '';
  const u = formatBytes(usage);
  if (!u) return '';
  const l = limit === undefined || limit === null ? '' : formatBytes(limit);
  return GOOGLE_DRIVE_TEXT.quotaUsed(u, l || undefined);
}

export type DriveStatusTone = 'loading' | 'connecting' | 'connected' | 'disconnected';

export interface DriveStatusView {
  tone: DriveStatusTone;
  label: string;
  // 상태 태그 색(App.css .back-*)
  tagClass: 'back-green' | 'back-gray' | 'back-sky';
  // 이메일 · 용량 한 줄(없으면 빈 문자열)
  detail: string;
  // 암호화 저장 불가 경고(해당 없으면 undefined)
  persistenceNote?: string;
  error?: string;
  canConnect: boolean;
  canDisconnect: boolean;
  canCancel: boolean;
}

// status = null 이면 첫 조회 전(확인 중). localConnecting = 이 창에서 연결을 시작해 대기 중.
export function describeStatus(
  status: DriveAuthStatus | null,
  localConnecting = false,
): DriveStatusView {
  const T = GOOGLE_DRIVE_TEXT;
  if (!status) {
    return {
      tone: localConnecting ? 'connecting' : 'loading',
      label: localConnecting ? T.status.connecting : T.status.loading,
      tagClass: localConnecting ? 'back-sky' : 'back-gray',
      detail: '',
      canConnect: false,
      canDisconnect: false,
      canCancel: localConnecting,
    };
  }
  const connecting = localConnecting || !!status.connecting;
  if (connecting && !status.connected) {
    return {
      tone: 'connecting',
      label: T.status.connecting,
      tagClass: 'back-sky',
      detail: '',
      ...(status.persistent ? {} : { persistenceNote: T.notPersistentBefore }),
      canConnect: false,
      canDisconnect: false,
      canCancel: true,
    };
  }
  if (status.connected) {
    const parts = [
      status.email || T.emailUnknown,
      formatQuota(status.quota?.usage, status.quota?.limit),
    ].filter(Boolean);
    return {
      tone: 'connected',
      label: T.status.connected,
      tagClass: 'back-green',
      detail: parts.join(' · '),
      ...(status.persistent ? {} : { persistenceNote: T.notPersistentConnected }),
      ...(status.error ? { error: status.error } : {}),
      canConnect: false,
      canDisconnect: true,
      canCancel: false,
    };
  }
  return {
    tone: 'disconnected',
    label: T.status.disconnected,
    tagClass: 'back-gray',
    detail: '',
    ...(status.persistent ? {} : { persistenceNote: T.notPersistentBefore }),
    ...(status.error ? { error: status.error } : {}),
    canConnect: true,
    canDisconnect: false,
    canCancel: false,
  };
}
