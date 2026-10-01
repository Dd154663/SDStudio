/**
 * Google 드라이브 연동 ③ — 드라이브에서 받은 백업의 라우팅·거부 규칙과 받기 절차
 * (진행 창·임시 폴더 정리·고르기 모드·<label> 파일 입력 가로채기). 실제 IPC·Google 호출 없음.
 */
const backend = {
  driveDownload: jest.fn(),
  driveDownloadCancel: jest.fn(),
  driveCleanupDownload: jest.fn(),
  readBinaryFile: jest.fn(),
  driveAuthSupported: jest.fn(() => true),
  driveAuthConnected: jest.fn(),
  getConfig: jest.fn(),
};
const backupService = {
  handleTarImport: jest.fn(),
  globalPresetBackupImport: jest.fn(),
  artistLibraryBackupImport: jest.fn(),
  projectTemplateBackupImport: jest.fn(),
};
const templateService = { importSceneTemplateFile: jest.fn() };
const appState = {
  pushDialog: jest.fn(),
  pushDialogAsync: jest.fn(),
  pushMessage: jest.fn(),
  setProgressDialog: jest.fn(),
};
const platform = { supportsTargetFolder: true };
const mockImportConfigText = jest.fn();
const mockImportCharacterText = jest.fn();
jest.mock('..', () => ({
  backend,
  backupService,
  templateService,
  isMobile: false,
  loginService: {},
  sessionService: {},
  globalCharacterPresetService: {},
}));
jest.mock('../AppService', () => ({ appState }));
jest.mock('../platform', () => ({ platform }));
jest.mock('../configSyncFlow', () => ({
  importConfigText: (...a: any[]) => mockImportConfigText(...a),
}));
jest.mock('../characterPresetImport', () => ({
  importGlobalCharacterPresetsText: (...a: any[]) => mockImportCharacterText(...a),
}));

import {
  closeDriveBackupManager,
  currentDriveManagerRequest,
  driveBackupKindLabel,
  importFromDrive,
  interceptFileImportClick,
  receiveDriveBackup,
  resolveDriveRoute,
} from '../driveImport';
import { GOOGLE_DRIVE_TEXT } from '../googleDrive';
import { DRIVE_BACKUP_KINDS, DriveBackupItem, DriveUploadError } from '../../../shared/googleDrive';

const item = (kind: DriveBackupItem['kind'], name = 'x', id = 'F1'): DriveBackupItem => ({
  id,
  name,
  kind,
  size: 10,
});
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
// jsdom 환경엔 TextDecoder 가 없다(configSync.test 선례와 같은 보충).
(global as any).TextDecoder ??= require('util').TextDecoder;
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  jest.clearAllMocks();
  platform.supportsTargetFolder = true;
  backend.driveCleanupDownload.mockResolvedValue(undefined);
  backend.driveAuthSupported.mockReturnValue(true);
});

describe('resolveDriveRoute', () => {
  test('종류별 기존 불러오기 흐름으로', () => {
    expect(resolveDriveRoute(item('project'))).toEqual({ type: 'project' });
    expect(resolveDriveRoute(item('global-presets'))).toEqual({ type: 'library', kind: 'global-presets' });
    expect(resolveDriveRoute(item('artist-library'))).toEqual({ type: 'library', kind: 'artist-library' });
    expect(resolveDriveRoute(item('project-templates'))).toEqual({ type: 'library', kind: 'project-templates' });
    expect(resolveDriveRoute(item('character-presets'))).toEqual({ type: 'character-presets' });
    expect(resolveDriveRoute(item('scene-template'))).toEqual({ type: 'scene-template' });
    expect(resolveDriveRoute(item('config'))).toEqual({ type: 'config' });
  });
  test('토큰(kind 또는 파일 이름)은 받기 거부 — 다운로드 폴더 저장만', () => {
    expect(resolveDriveRoute(item('token'))).toEqual({ type: 'downloads-only', reason: 'token' });
    expect(resolveDriveRoute(item('config', 'SDStudio-Token-2026.json'))).toEqual({
      type: 'downloads-only',
      reason: 'token',
    });
    expect(resolveDriveRoute(item('unknown', 'sdstudio-token-a.json')).type).toBe('downloads-only');
  });
  test('표식 없는 파일(unknown)은 다운로드 폴더 저장만', () => {
    expect(resolveDriveRoute(item('unknown', 'a.tar'))).toEqual({ type: 'downloads-only', reason: 'unknown' });
  });
  test('모든 종류에 라벨이 있다', () => {
    for (const k of DRIVE_BACKUP_KINDS) expect(driveBackupKindLabel(k)).toBeTruthy();
    expect(driveBackupKindLabel('unknown')).toBe(GOOGLE_DRIVE_TEXT.unknownKind);
  });
});

describe('receiveDriveBackup', () => {
  test('프로젝트: 앱 임시 폴더로 받아 handleTarImport → 정리', async () => {
    backend.driveDownload.mockResolvedValue('C:/app/tmp/drive-download/F1/p.tar');
    await receiveDriveBackup(item('project', 'p.tar'));
    expect(backend.driveDownload).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'F1' }),
      { toDownloads: false },
      expect.any(Function),
    );
    expect(backupService.handleTarImport).toHaveBeenCalledWith('C:/app/tmp/drive-download/F1/p.tar');
    expect(backend.driveCleanupDownload).toHaveBeenCalledWith('F1');
    // 진행 창을 띄웠다가 닫는다(취소 버튼 포함).
    expect(appState.setProgressDialog.mock.calls[0][0]).toMatchObject({ onCancel: expect.any(Function) });
    expect(appState.setProgressDialog).toHaveBeenLastCalledWith(undefined);
  });

  test('라이브러리 3종: pickedPath 로 기존 복원(파일 선택기 없이)', async () => {
    backend.driveDownload.mockResolvedValue('/tmp/x.tar');
    await receiveDriveBackup(item('global-presets'));
    await receiveDriveBackup(item('artist-library'));
    await receiveDriveBackup(item('project-templates'));
    expect(backupService.globalPresetBackupImport).toHaveBeenCalledWith({ pickedPath: '/tmp/x.tar' });
    expect(backupService.artistLibraryBackupImport).toHaveBeenCalledWith({ pickedPath: '/tmp/x.tar' });
    expect(backupService.projectTemplateBackupImport).toHaveBeenCalledWith({ pickedPath: '/tmp/x.tar' });
    expect(backend.driveCleanupDownload).toHaveBeenCalledTimes(3);
  });

  test('JSON 3종: 텍스트로 읽어 각 흐름에(환경설정은 설정 화면 문맥 전달)', async () => {
    backend.driveDownload.mockResolvedValue('/tmp/a.json');
    backend.readBinaryFile.mockResolvedValue(b64('{"presets":[]}'));
    await receiveDriveBackup(item('character-presets'));
    expect(mockImportCharacterText).toHaveBeenCalledWith('{"presets":[]}');
    await receiveDriveBackup(item('scene-template'));
    expect(templateService.importSceneTemplateFile).toHaveBeenCalledWith('{"presets":[]}');
    const ctx = { config: { dirty: true, onConfigImported: jest.fn() } };
    await receiveDriveBackup(item('config'), ctx);
    expect(mockImportConfigText).toHaveBeenCalledWith('{"presets":[]}', ctx.config);
    expect(backend.readBinaryFile).toHaveBeenCalledWith('/tmp/a.json');
  });

  test('토큰: 확인 뒤 다운로드 폴더에만 저장, 불러오기 흐름 없음', async () => {
    appState.pushDialog.mockImplementation((d: any) => d.callback?.());
    backend.driveDownload.mockResolvedValue('C:/Users/u/Downloads/sdstudio-token-a.json');
    await receiveDriveBackup(item('token', 'sdstudio-token-a.json'));
    expect(appState.pushDialog.mock.calls[0][0].text).toBe(GOOGLE_DRIVE_TEXT.tokenDownloadOnly);
    expect(backend.driveDownload).toHaveBeenCalledWith(expect.anything(), { toDownloads: true }, expect.any(Function));
    expect(backend.readBinaryFile).not.toHaveBeenCalled();
    expect(mockImportConfigText).not.toHaveBeenCalled();
    expect(appState.pushMessage).toHaveBeenCalledWith(
      GOOGLE_DRIVE_TEXT.savedToDownloads('C:/Users/u/Downloads/sdstudio-token-a.json'),
    );
  });

  test('알 수 없음: 확인 거절이면 받지도 않는다', async () => {
    appState.pushDialog.mockImplementation((d: any) => d.onCancel?.());
    await receiveDriveBackup(item('unknown', 'a.tar'));
    expect(appState.pushDialog.mock.calls[0][0].text).toBe(GOOGLE_DRIVE_TEXT.unknownDownloadOnly);
    expect(backend.driveDownload).not.toHaveBeenCalled();
  });

  test('받기 실패·취소: 안내, 불러오기 없음, 임시 폴더 정리', async () => {
    backend.driveDownload.mockRejectedValueOnce(new DriveUploadError('network'));
    await receiveDriveBackup(item('project'));
    expect(appState.pushDialog.mock.calls[0][0].text).toContain('Google 드라이브에서 받지 못했습니다.');
    backend.driveDownload.mockRejectedValueOnce(new DriveUploadError('cancelled'));
    await receiveDriveBackup(item('project'));
    expect(appState.pushMessage).toHaveBeenCalledWith(GOOGLE_DRIVE_TEXT.downloadCancelled);
    expect(backupService.handleTarImport).not.toHaveBeenCalled();
    expect(backend.driveCleanupDownload).toHaveBeenCalledTimes(2);
  });

  test('불러오기 도중 오류여도 임시 폴더를 지운다', async () => {
    backend.driveDownload.mockResolvedValue('/tmp/p.tar');
    backupService.handleTarImport.mockRejectedValueOnce(new Error('boom'));
    await receiveDriveBackup(item('project'));
    expect(appState.pushMessage).toHaveBeenCalledWith(GOOGLE_DRIVE_TEXT.importFailed('boom'));
    expect(backend.driveCleanupDownload).toHaveBeenCalledWith('F1');
  });

  test('진행 창 [취소] = main 받기 중단 요청', async () => {
    let finish: (v: string) => void = () => {};
    backend.driveDownload.mockReturnValue(new Promise((r) => (finish = r)));
    backend.driveDownloadCancel.mockResolvedValue(undefined);
    const p = receiveDriveBackup(item('project'));
    await flush();
    appState.setProgressDialog.mock.calls[0][0].onCancel();
    expect(backend.driveDownloadCancel).toHaveBeenCalled();
    finish('/tmp/p.tar');
    await p;
  });
});

describe('고르기 모드·출처 가로채기', () => {
  test('importFromDrive: 관리 창(고르기·종류 고정) → 선택 → 받기·라우팅', async () => {
    backend.driveDownload.mockResolvedValue('/tmp/c.json');
    backend.readBinaryFile.mockResolvedValue(b64('{}'));
    const ctx = { config: { dirty: false, onConfigImported: jest.fn() } };
    const p = importFromDrive('config', ctx);
    const req = currentDriveManagerRequest();
    expect(req).toMatchObject({ mode: 'pick', kind: 'config' });
    closeDriveBackupManager(item('config', 'c.json'));
    await p;
    expect(currentDriveManagerRequest()).toBeNull();
    expect(mockImportConfigText).toHaveBeenCalledWith('{}', ctx.config);
  });

  test('importFromDrive: 고르지 않고 닫으면 아무것도 받지 않는다', async () => {
    const p = importFromDrive('project');
    closeDriveBackupManager(null);
    await p;
    expect(backend.driveDownload).not.toHaveBeenCalled();
  });

  test('Android: label 기본 동작(파일 선택기) 그대로', () => {
    platform.supportsTargetFolder = false;
    const e = { target: {} as any, preventDefault: jest.fn() };
    interceptFileImportClick(e, {} as any, 'scene-template');
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  test('PC 미연결: 기본 동작을 막고 묻지 않고 숨은 input 을 누른다', async () => {
    backend.driveAuthConnected.mockResolvedValue(false);
    const input = { click: jest.fn() } as any;
    const e = { target: {} as any, preventDefault: jest.fn() };
    interceptFileImportClick(e, input, 'character-presets');
    expect(e.preventDefault).toHaveBeenCalled();
    await flush();
    expect(appState.pushDialogAsync).not.toHaveBeenCalled();
    expect(input.click).toHaveBeenCalled();
    // input.click() 이 label 로 전파된 클릭은 통과
    const again = { target: input, preventDefault: jest.fn() };
    interceptFileImportClick(again, input, 'character-presets');
    expect(again.preventDefault).not.toHaveBeenCalled();
  });

  test('PC 연결: 「Google 드라이브」를 고르면 고르기 창을 연다', async () => {
    backend.driveAuthConnected.mockResolvedValue(true);
    appState.pushDialogAsync.mockResolvedValue('drive');
    const input = { click: jest.fn() } as any;
    interceptFileImportClick({ target: {} as any, preventDefault: jest.fn() }, input, 'scene-template');
    await flush();
    await flush();
    expect(currentDriveManagerRequest()).toMatchObject({ mode: 'pick', kind: 'scene-template' });
    expect(input.click).not.toHaveBeenCalled();
    closeDriveBackupManager(null);
  });
});
