/**
 * 드라이브 동기화 공용층(드라이브 동기화 C안 ①, 2026-09-28) — 파일명 규칙·충돌 접미·
 * 목적지 결정 순수 함수와 deliverExport 분기.
 */
const backend = {
  getConfig: jest.fn(),
  publishExport: jest.fn(),
  copyFileToAbsolute: jest.fn(),
  deleteFile: jest.fn(),
  existFileAbsolute: jest.fn(),
  openPath: jest.fn(),
};
const appState = {
  pushDialog: jest.fn(),
  pushDialogAsync: jest.fn(),
  pushMessage: jest.fn(),
};
const platform = { supportsTargetFolder: true };
jest.mock('..', () => ({ backend }));
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
} from '../driveSync';

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
