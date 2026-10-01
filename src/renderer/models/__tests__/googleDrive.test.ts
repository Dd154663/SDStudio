// Google 드라이브 연동 ① — 설정 화면 표시용 순수 함수 검증.
import {
  describeStatus,
  formatBytes,
  formatQuota,
  GOOGLE_DRIVE_TEXT,
  nativeDriveAuthError,
  nativeDriveAuthStatus,
  nativeDriveFileError,
} from '../googleDrive';
import { DRIVE_AUTH_ERROR_TEXT, DriveAuthError, driveInfoFailedText } from '../../../shared/googleDriveAuth';
import { DriveUploadError } from '../../../shared/googleDrive';

const GiB = 1024 ** 3;

describe('formatBytes / formatQuota', () => {
  test('단위 경계', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024 ** 2)).toBe('1 MB');
    expect(formatBytes(150 * 1024 ** 2)).toBe('150 MB');
    expect(formatBytes(15 * GiB)).toBe('15 GB');
    expect(formatBytes(2 * 1024 ** 4)).toBe('2 TB');
    expect(formatBytes(-1)).toBe('');
    expect(formatBytes(NaN)).toBe('');
  });

  test('사용량 / 한도 사용', () => {
    expect(formatQuota(3.2 * GiB, 15 * GiB)).toBe('3.2 GB / 15 GB 사용');
  });

  test('한도 없음(무제한)은 사용량만', () => {
    expect(formatQuota(3.2 * GiB)).toBe('3.2 GB 사용');
  });

  test('사용량 없음은 빈 문자열', () => {
    expect(formatQuota(undefined, 15 * GiB)).toBe('');
    expect(formatQuota()).toBe('');
  });
});

describe('describeStatus', () => {
  test('첫 조회 전 = 확인 중(버튼 없음)', () => {
    const v = describeStatus(null);
    expect(v.tone).toBe('loading');
    expect(v.label).toBe(GOOGLE_DRIVE_TEXT.status.loading);
    expect(v.canConnect || v.canDisconnect || v.canCancel).toBe(false);
  });

  test('연결 안 됨 = 회색·연결 버튼', () => {
    const v = describeStatus({ connected: false, persistent: true });
    expect(v).toMatchObject({
      tone: 'disconnected',
      label: '연결 안 됨',
      tagClass: 'back-gray',
      canConnect: true,
      canDisconnect: false,
    });
    expect(v.persistenceNote).toBeUndefined();
  });

  test('연결 안 됨 + 암호화 저장 불가 = 사전 경고', () => {
    const v = describeStatus({ connected: false, persistent: false });
    expect(v.persistenceNote).toBe(GOOGLE_DRIVE_TEXT.notPersistentBefore);
  });

  test('연결 중(이 창 또는 다른 창) = 취소만', () => {
    for (const v of [
      describeStatus({ connected: false, persistent: true }, true),
      describeStatus({ connected: false, persistent: true, connecting: true }),
      describeStatus(null, true),
    ]) {
      expect(v).toMatchObject({
        tone: 'connecting',
        label: '연결 중…',
        canConnect: false,
        canDisconnect: false,
        canCancel: true,
      });
    }
  });

  test('연결됨 = 초록·이메일·용량 한 줄·해제 버튼', () => {
    const v = describeStatus({
      connected: true,
      persistent: true,
      email: 'user@example.com',
      quota: { usage: 3.2 * GiB, limit: 15 * GiB },
    });
    expect(v).toMatchObject({
      tone: 'connected',
      label: '연결됨',
      tagClass: 'back-green',
      detail: 'user@example.com · 3.2 GB / 15 GB 사용',
      canConnect: false,
      canDisconnect: true,
      canCancel: false,
    });
  });

  test('연결됨 + 저장 불가 + 조회 실패 = 경고·오류 문구, 이메일 없으면 대체 문구', () => {
    const v = describeStatus({ connected: true, persistent: false, error: '조회 실패' });
    expect(v.detail).toBe(GOOGLE_DRIVE_TEXT.emailUnknown);
    expect(v.persistenceNote).toBe(GOOGLE_DRIVE_TEXT.notPersistentConnected);
    expect(v.error).toBe('조회 실패');
  });
});

describe('문구', () => {
  test('연결 실패 문구는 코드별 공용 문구를 쓴다', () => {
    expect(GOOGLE_DRIVE_TEXT.connectFailed('timeout')).toContain(DRIVE_AUTH_ERROR_TEXT.timeout);
    expect(GOOGLE_DRIVE_TEXT.connectFailed('???')).toContain(DRIVE_AUTH_ERROR_TEXT.unknown);
    expect(GOOGLE_DRIVE_TEXT.connectFailed('exchange-failed', 'invalid_client')).toContain(
      '(invalid_client)',
    );
  });
  test('해제 확인 문구', () => {
    expect(GOOGLE_DRIVE_TEXT.disconnectConfirm).toBe(
      '연결을 해제하면 저장된 인증 정보가 삭제됩니다. 드라이브의 파일은 그대로 남습니다.',
    );
  });
});

describe('Android 네이티브 응답 변환(드라이브 API ④)', () => {
  test('미연결 = persistent true(영속 토큰 없음), 권한 해제는 expired 문구', () => {
    expect(nativeDriveAuthStatus({ connected: false })).toEqual({ connected: false, persistent: true });
    expect(nativeDriveAuthStatus(null)).toEqual({ connected: false, persistent: true });
    expect(nativeDriveAuthStatus({ connected: false, authError: 'expired' })).toEqual({
      connected: false,
      persistent: true,
      error: DRIVE_AUTH_ERROR_TEXT.expired,
    });
  });

  test('연결 = 이메일·시각·용량, 조회 실패는 PC 와 같은 「연결 유지」 문구', () => {
    const s = nativeDriveAuthStatus({
      connected: true,
      email: 'a@b.c',
      connectedAt: '2026-10-01T00:00:00.000Z',
      quota: { limit: 15 * GiB, usage: GiB },
    });
    expect(s).toEqual({
      connected: true,
      persistent: true,
      email: 'a@b.c',
      connectedAt: '2026-10-01T00:00:00.000Z',
      quota: { limit: 15 * GiB, usage: GiB },
    });
    expect(describeStatus(s).detail).toBe('a@b.c · 1 GB / 15 GB 사용');
    expect(nativeDriveAuthStatus({ connected: true, infoError: 'network' }).error).toBe(
      driveInfoFailedText('network'),
    );
    // 인증 코드가 아닌 값(rate-limited 등)은 server 문구로
    expect(nativeDriveAuthStatus({ connected: true, infoError: 'rate-limited' }).error).toBe(
      driveInfoFailedText('server'),
    );
    // 잘못된 용량 값은 버린다
    expect(nativeDriveAuthStatus({ connected: true, quota: { limit: -1, usage: 'x' } }).quota).toBeUndefined();
  });

  test('플러그인 오류 코드 → DriveAuthError / DriveUploadError(모르는 코드는 unknown)', () => {
    const a = nativeDriveAuthError({ code: 'cancelled', data: { detail: 'x' } });
    expect(a).toBeInstanceOf(DriveAuthError);
    expect(a.code).toBe('cancelled');
    expect(a.detail).toBe('x');
    expect(nativeDriveAuthError({ code: 'UNIMPLEMENTED' }).code).toBe('unknown');
    const f = nativeDriveFileError({ code: 'quota-exceeded', data: { detail: 'HTTP 403 storageQuotaExceeded' } });
    expect(f).toBeInstanceOf(DriveUploadError);
    expect(f.code).toBe('quota-exceeded');
    expect(f.detail).toBe('HTTP 403 storageQuotaExceeded');
    expect(nativeDriveFileError({ code: 'token-export-forbidden' }).code).toBe('token-export-forbidden');
    expect(nativeDriveFileError(new Error('boom')).code).toBe('unknown');
    const same = new DriveUploadError('cancelled');
    expect(nativeDriveFileError(same)).toBe(same);
  });
});
