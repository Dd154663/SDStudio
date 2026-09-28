/**
 * 드라이브 동기화 공용층(드라이브 동기화 C안 ①, 2026-09-28) — 파일명 규칙·충돌 접미·
 * 목적지 결정 순수 함수와 deliverExport 분기.
 * 드라이브 API ②(2026-09-28): Google 드라이브 연결 시 목적지·올리기·실패 전환·취소·토큰 방벽,
 * saveJsonFile 의 exports/ 경유.
 */
const backend = {
  getConfig: jest.fn(),
  publishExport: jest.fn(),
  copyFileToAbsolute: jest.fn(),
  deleteFile: jest.fn(),
  existFileAbsolute: jest.fn(),
  openPath: jest.fn(),
  writeFile: jest.fn(),
  driveAuthSupported: jest.fn(),
  driveAuthConnected: jest.fn(),
  driveUpload: jest.fn(),
  driveUploadCancel: jest.fn(),
  driveOpenFile: jest.fn(),
};
const appState = {
  pushDialog: jest.fn(),
  pushDialogAsync: jest.fn(),
  pushMessage: jest.fn(),
  setProgressDialog: jest.fn(),
};
const platform = { supportsTargetFolder: true };
jest.mock('..', () => ({ backend, isMobile: false }));
jest.mock('../AppService', () => ({ appState }));
jest.mock('../platform', () => ({ platform }));

import {
  collisionName,
  deliverExport,
  joinAbsolute,
  resolveExportDestinations,
  syncFileName,
  withCollisionSuffix,
  DRIVE_SYNC_TEXT,
  uploadPercent,
} from '../driveSync';
import { saveJsonFile } from '../exportUtil';
import { DRIVE_UPLOAD_ERROR_TEXT, DriveUploadError } from '../../../shared/googleDrive';

describe('syncFileName', () => {
  it('sdstudio-<kind>-<UTC 날짜> 규칙(기존 라이브러리 백업 이름과 동일)', () => {
    const d = new Date(Date.UTC(2026, 8, 28, 3, 4, 5, 678));
    expect(syncFileName('global-presets', d, 'tar')).toBe(
      'sdstudio-global-presets-2026-09-28T03-04-05.tar',
    );
    expect(syncFileName('character-presets', d, '.json')).toBe(
      'sdstudio-character-presets-2026-09-28T03-04-05.json',
    );
  });
});

describe('withCollisionSuffix', () => {
  it('없으면 그대로, 있으면 " (n)" 접미', async () => {
    expect(await withCollisionSuffix('a.tar', () => false)).toBe('a.tar');
    const taken = new Set(['a.tar', 'a (1).tar']);
    expect(await withCollisionSuffix('a.tar', (n) => taken.has(n))).toBe('a (2).tar');
    expect(await withCollisionSuffix('noext', async (n) => n === 'noext')).toBe('noext (1)');
  });
  it('점 시작 이름은 확장자로 보지 않는다', () => {
    expect(collisionName('.hidden', 1)).toBe('.hidden (1)');
    expect(collisionName('x.tar.gz', 3)).toBe('x.tar (3).gz');
  });
});

describe('resolveExportDestinations', () => {
  it('PC + 폴더 설정 = 드라이브·다운로드 순서', () => {
    expect(resolveExportDestinations({ syncFolder: 'D:\\Drive', supportsTargetFolder: true })).toEqual(['drive', 'downloads']);
  });
  it('폴더 미설정·공백·모바일 = 다운로드만', () => {
    expect(resolveExportDestinations({ supportsTargetFolder: true })).toEqual(['downloads']);
    expect(resolveExportDestinations({ syncFolder: '  ', supportsTargetFolder: true })).toEqual(['downloads']);
    expect(resolveExportDestinations({ syncFolder: '/drive', supportsTargetFolder: false })).toEqual(['downloads']);
  });
  it('Google 드라이브 연결(PC) = 드라이브·다운로드, 동기화 폴더가 있어도 같은 목록', () => {
    expect(resolveExportDestinations({ supportsTargetFolder: true, driveConnected: true })).toEqual(['drive', 'downloads']);
    expect(
      resolveExportDestinations({ syncFolder: 'D:\\Drive', supportsTargetFolder: true, driveConnected: true, kind: 'project' }),
    ).toEqual(['drive', 'downloads']);
  });
  it('연결돼도 모바일은 다운로드만(Android 기존 그대로)', () => {
    expect(resolveExportDestinations({ supportsTargetFolder: false, driveConnected: true })).toEqual(['downloads']);
  });
  it('NovelAI 토큰은 연결·동기화 폴더와 관계없이 다운로드만', () => {
    expect(resolveExportDestinations({ supportsTargetFolder: true, driveConnected: true, kind: 'token' })).toEqual(['downloads']);
    expect(resolveExportDestinations({ syncFolder: 'D:\\Drive', supportsTargetFolder: true, kind: 'token' })).toEqual(['downloads']);
    expect(
      resolveExportDestinations({ syncFolder: 'D:\\Drive', supportsTargetFolder: true, driveConnected: true, kind: 'token' }),
    ).toEqual(['downloads']);
    expect(resolveExportDestinations({ supportsTargetFolder: false, kind: 'token' })).toEqual(['downloads']);
  });
  it('미연결이면 기존 규칙(kind 가 있어도 동일)', () => {
    expect(
      resolveExportDestinations({ syncFolder: 'D:\\Drive', supportsTargetFolder: true, driveConnected: false, kind: 'config' }),
    ).toEqual(['drive', 'downloads']);
    expect(resolveExportDestinations({ supportsTargetFolder: true, driveConnected: false, kind: 'config' })).toEqual(['downloads']);
  });
  it('uploadPercent 는 0~100 정수', () => {
    expect(uploadPercent(0, 0)).toBe(0);
    expect(uploadPercent(1, 3)).toBe(33);
    expect(uploadPercent(5, 4)).toBe(100);
  });
  it('joinAbsolute 는 끝 구분자를 정리한다', () => {
    expect(joinAbsolute('D:\\Drive\\', 'a.tar')).toBe('D:\\Drive/a.tar');
    expect(joinAbsolute('/home/u/Drive//', 'a.tar')).toBe('/home/u/Drive/a.tar');
  });
});

describe('deliverExport', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    platform.supportsTargetFolder = true;
    backend.publishExport.mockResolvedValue(undefined);
    backend.deleteFile.mockResolvedValue(undefined);
    backend.openPath.mockResolvedValue(undefined);
  });

  it('폴더 미설정이면 기존 흐름(완료 창 + publishExport)', async () => {
    backend.getConfig.mockResolvedValue({});
    expect(await deliverExport('exports/x.tar', 'project', { doneText: '완료' })).toBe('downloads');
    expect(appState.pushDialog).toHaveBeenCalledWith({ type: 'yes-only', text: '완료' });
    expect(appState.pushDialogAsync).not.toHaveBeenCalled();
    expect(backend.publishExport).toHaveBeenCalledWith('exports/x.tar');
  });

  it('모바일은 설정이 있어도 publishExport 만', async () => {
    platform.supportsTargetFolder = false;
    backend.getConfig.mockResolvedValue({ syncFolder: '/drive' });
    expect(await deliverExport('exports/x.tar', 'project')).toBe('downloads');
    expect(appState.pushDialogAsync).not.toHaveBeenCalled();
    expect(backend.publishExport).toHaveBeenCalled();
  });

  it('드라이브 선택 시 충돌 접미 후 복사, 다운로드로 보내지 않는다', async () => {
    backend.getConfig.mockResolvedValue({ syncFolder: 'D:\\Drive' });
    appState.pushDialogAsync.mockResolvedValue('drive');
    backend.existFileAbsolute.mockImplementation(async (p: string) => p === 'D:\\Drive/x.tar');
    backend.copyFileToAbsolute.mockResolvedValue('copied');
    expect(await deliverExport('exports/x.tar', 'global-presets')).toBe('drive');
    const dialog = appState.pushDialogAsync.mock.calls[0][0];
    expect(dialog.text).toContain(DRIVE_SYNC_TEXT.chooseDestination('global-presets'));
    expect(dialog.items.map((i: any) => i.text)).toEqual(['드라이브 폴더', '다운로드 폴더']);
    expect(backend.copyFileToAbsolute).toHaveBeenCalledWith('exports/x.tar', 'D:\\Drive/x (1).tar');
    expect(backend.deleteFile).toHaveBeenCalledWith('exports/x.tar');
    expect(backend.publishExport).not.toHaveBeenCalled();
  });

  it('드라이브 복사 실패만 다운로드 폴더로 전환', async () => {
    backend.getConfig.mockResolvedValue({ syncFolder: '/drive' });
    appState.pushDialogAsync.mockResolvedValue('drive');
    backend.existFileAbsolute.mockResolvedValue(false);
    backend.copyFileToAbsolute.mockRejectedValue(new Error('EACCES'));
    expect(await deliverExport('exports/x.tar', 'project')).toBe('downloads');
    expect(backend.publishExport).toHaveBeenCalledWith('exports/x.tar');
  });

  it('다운로드 선택은 publishExport, 취소는 스테이징 정리', async () => {
    backend.getConfig.mockResolvedValue({ syncFolder: '/drive' });
    appState.pushDialogAsync.mockResolvedValueOnce('downloads');
    expect(await deliverExport('exports/a.json', 'scene-template')).toBe('downloads');
    expect(backend.publishExport).toHaveBeenCalledWith('exports/a.json');

    appState.pushDialogAsync.mockResolvedValueOnce(undefined);
    expect(await deliverExport('exports/b.json', 'scene-template')).toBe('cancelled');
    expect(backend.deleteFile).toHaveBeenCalledWith('exports/b.json');
    expect(backend.publishExport).toHaveBeenCalledTimes(1);
  });
});

describe('deliverExport — Google 드라이브 연결(드라이브 API ②)', () => {
  const file = {
    id: 'f1',
    name: 'x.tar',
    size: 10,
    webViewLink: 'https://drive.google.com/file/d/f1/view',
  };
  beforeEach(() => {
    jest.resetAllMocks();
    platform.supportsTargetFolder = true;
    backend.getConfig.mockResolvedValue({});
    backend.driveAuthSupported.mockReturnValue(true);
    backend.driveAuthConnected.mockResolvedValue(true);
    backend.publishExport.mockResolvedValue(undefined);
    backend.deleteFile.mockResolvedValue(undefined);
    backend.driveUploadCancel.mockResolvedValue(undefined);
    backend.driveOpenFile.mockResolvedValue(undefined);
  });

  it('선택지는 [Google 드라이브 / 다운로드 폴더], 드라이브 선택 시 올린 뒤 exports 사본 삭제', async () => {
    appState.pushDialogAsync.mockResolvedValue('drive');
    backend.driveUpload.mockImplementation(async (_p: string, _m: any, onProgress: any) => {
      onProgress({ sent: 5, total: 10 });
      return file;
    });
    expect(await deliverExport('exports/x.tar', 'project', { doneText: '완료' })).toBe('drive');
    const dialog = appState.pushDialogAsync.mock.calls[0][0];
    expect(dialog.text).toContain('완료');
    expect(dialog.items.map((i: any) => i.text)).toEqual(['Google 드라이브', '다운로드 폴더']);
    expect(backend.driveUpload).toHaveBeenCalledWith('exports/x.tar', { kind: 'project' }, expect.any(Function));
    expect(backend.deleteFile).toHaveBeenCalledWith('exports/x.tar');
    expect(backend.publishExport).not.toHaveBeenCalled();
    expect(backend.copyFileToAbsolute).not.toHaveBeenCalled();
    // 진행 표시 → 닫힘
    const progressCalls = appState.setProgressDialog.mock.calls.map((c: any[]) => c[0]);
    expect(progressCalls.some((p: any) => p && typeof p.countText === 'string' && p.countText.startsWith('50%'))).toBe(true);
    expect(progressCalls[progressCalls.length - 1]).toBeUndefined();
    // 완료 창 + [드라이브에서 열기]
    const done = appState.pushDialog.mock.calls[0][0];
    expect(done.text).toBe(DRIVE_SYNC_TEXT.googleDriveSaved('x.tar'));
    expect(done.confirmText).toBe(DRIVE_SYNC_TEXT.googleDriveOpen);
    done.callback();
    expect(backend.driveOpenFile).toHaveBeenCalledWith(file.webViewLink);
  });

  it('동기화 폴더가 있어도 연결 중이면 폴더 대신 Google 드라이브', async () => {
    backend.getConfig.mockResolvedValue({ syncFolder: 'D:\\Drive' });
    appState.pushDialogAsync.mockResolvedValue('drive');
    backend.driveUpload.mockResolvedValue({ ...file, webViewLink: undefined });
    expect(await deliverExport('exports/x.tar', 'global-presets')).toBe('drive');
    expect(backend.copyFileToAbsolute).not.toHaveBeenCalled();
    expect(backend.openPath).not.toHaveBeenCalled();
    // 드라이브 주소가 없으면 완료 창 대신 메시지
    expect(appState.pushMessage).toHaveBeenCalledWith(DRIVE_SYNC_TEXT.googleDriveSaved('x.tar'));
  });

  it('올리기 실패는 사유와 함께 다운로드 폴더로 전환(exports 사본은 다운로드로 이동)', async () => {
    appState.pushDialogAsync.mockResolvedValue('drive');
    backend.driveUpload.mockRejectedValue(new DriveUploadError('network', 'timeout'));
    expect(await deliverExport('exports/x.tar', 'project')).toBe('downloads');
    expect(backend.publishExport).toHaveBeenCalledWith('exports/x.tar');
    expect(backend.deleteFile).not.toHaveBeenCalled();
    const msg = appState.pushMessage.mock.calls[0][0];
    expect(msg).toContain('다운로드 폴더로 저장합니다');
    expect(msg).toContain(DRIVE_UPLOAD_ERROR_TEXT.network);
    expect(appState.setProgressDialog).toHaveBeenLastCalledWith(undefined);
  });

  it('진행 창 [취소] → main 취소 요청, 취소 결과는 스테이징 삭제·다운로드 전환 없음', async () => {
    appState.pushDialogAsync.mockResolvedValue('drive');
    backend.driveUpload.mockImplementation(async () => {
      const shown = appState.setProgressDialog.mock.calls[0][0];
      shown.onCancel();
      throw new DriveUploadError('cancelled');
    });
    expect(await deliverExport('exports/x.tar', 'project')).toBe('cancelled');
    expect(backend.driveUploadCancel).toHaveBeenCalled();
    expect(backend.deleteFile).toHaveBeenCalledWith('exports/x.tar');
    expect(backend.publishExport).not.toHaveBeenCalled();
    expect(appState.pushMessage).toHaveBeenCalledWith(DRIVE_SYNC_TEXT.cancelled);
    // 취소 접수 뒤 진행 창은 버튼 없이 갱신
    const afterCancel = appState.setProgressDialog.mock.calls[1][0];
    expect(afterCancel.onCancel).toBeUndefined();
  });

  it('NovelAI 토큰은 연결돼 있어도 선택 창 없이 다운로드만 + 안내', async () => {
    backend.getConfig.mockResolvedValue({ syncFolder: 'D:\\Drive' });
    expect(await deliverExport('exports/sdstudio-token-a.json', 'token')).toBe('downloads');
    expect(appState.pushDialogAsync).not.toHaveBeenCalled();
    expect(backend.driveUpload).not.toHaveBeenCalled();
    expect(appState.pushMessage).toHaveBeenCalledWith(DRIVE_SYNC_TEXT.tokenDownloadsOnly);
    expect(backend.publishExport).toHaveBeenCalledWith('exports/sdstudio-token-a.json');
  });

  it('연결 확인 실패는 미연결로 본다(기존 규칙)', async () => {
    backend.driveAuthConnected.mockRejectedValue(new Error('ipc'));
    expect(await deliverExport('exports/x.tar', 'project')).toBe('downloads');
    expect(appState.pushDialogAsync).not.toHaveBeenCalled();
  });

  it('Android 는 연결 조회 없이 기존 publishExport', async () => {
    platform.supportsTargetFolder = false;
    expect(await deliverExport('exports/x.tar', 'project')).toBe('downloads');
    expect(backend.driveAuthConnected).not.toHaveBeenCalled();
    expect(backend.driveUpload).not.toHaveBeenCalled();
    expect(backend.publishExport).toHaveBeenCalledWith('exports/x.tar');
  });
});

describe('saveJsonFile (PC) — 드라이브 API ②', () => {
  const origCreate = (URL as any).createObjectURL;
  const origRevoke = (URL as any).revokeObjectURL;
  beforeEach(() => {
    jest.resetAllMocks();
    platform.supportsTargetFolder = true;
    backend.getConfig.mockResolvedValue({});
    backend.driveAuthSupported.mockReturnValue(true);
    backend.writeFile.mockResolvedValue(undefined);
    backend.publishExport.mockResolvedValue(undefined);
    backend.deleteFile.mockResolvedValue(undefined);
    (URL as any).createObjectURL = jest.fn(() => 'blob:x');
    (URL as any).revokeObjectURL = jest.fn();
  });
  afterAll(() => {
    (URL as any).createObjectURL = origCreate;
    (URL as any).revokeObjectURL = origRevoke;
  });

  it('연결 시 exports/ 에 쓰고 목적지 선택을 거친다', async () => {
    backend.driveAuthConnected.mockResolvedValue(true);
    appState.pushDialogAsync.mockResolvedValue('downloads');
    expect(await saveJsonFile('sdstudio-config-a.json', '{}', 'config')).toBe('downloads');
    expect(backend.writeFile).toHaveBeenCalledWith('exports/sdstudio-config-a.json', '{}');
    expect(backend.publishExport).toHaveBeenCalledWith('exports/sdstudio-config-a.json');
    expect((URL as any).createObjectURL).not.toHaveBeenCalled();
  });

  it('미연결·폴더 미설정은 기존 Blob 다운로드(exports/ 미생성)', async () => {
    backend.driveAuthConnected.mockResolvedValue(false);
    expect(await saveJsonFile('a.json', '{}', 'scene-template')).toBe('downloads');
    expect(backend.writeFile).not.toHaveBeenCalled();
    expect((URL as any).createObjectURL).toHaveBeenCalled();
  });

  it('토큰은 연결돼 있어도 Blob 다운로드 + 다운로드 전용 안내', async () => {
    backend.driveAuthConnected.mockResolvedValue(true);
    expect(await saveJsonFile('sdstudio-token-a.json', '{}', 'token')).toBe('downloads');
    expect(backend.writeFile).not.toHaveBeenCalled();
    expect(backend.driveUpload).not.toHaveBeenCalled();
    expect(appState.pushMessage).toHaveBeenCalledWith(DRIVE_SYNC_TEXT.tokenDownloadsOnly);
    expect((URL as any).createObjectURL).toHaveBeenCalled();
  });
});
