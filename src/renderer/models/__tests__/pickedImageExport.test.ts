// 이미지 그리드 「선택한 이미지 내보내기」(2026-11-22) — 순수 규칙(pickedImageExport)과 ExportPresetService.exportPackage 의 picked 인자.
// 모킹 관례는 unifiedExport.test.tsx 와 같다(서비스 모듈 '..' 전체 모킹, isolatedModules).
const refreshBatch = jest.fn(async () => {});
const zipFiles = jest.fn(async (_paths: any[], _destination: string) => {});
const publishExport = jest.fn(async () => {});
let outputs: string[] = [];
const platform = { supportsTargetFolder: false, maxImageConcurrency: 2, exportConcurrency: 2 };
const state: any = { pushDialogAsync: jest.fn(), pushMessage: jest.fn(), showExportComplete: jest.fn(), openExportPresetManager: jest.fn() };
jest.mock('..', () => ({
  imageService: { refreshBatch, getOutputDir: (session: any, scene: any) => `${session.name}/${scene.name}` },
  gameService: { refreshList: jest.fn(), getOutputs: () => outputs },
  sessionService: { getFolderOf: () => null, folderLeafName: () => '' },
  zipService: { zipFiles, isZipping: false },
  backend: { getConfig: async () => ({}), resizeImage: jest.fn(), publishExport, copyFileToAbsolute: jest.fn(), copyFile: jest.fn() },
}));
jest.mock('../AppService', () => ({ appState: state }));
jest.mock('../PersistenceService', () => ({ persistService: { write: jest.fn() } }));
jest.mock('../ImageService', () => ({}));
jest.mock('../SessionService', () => ({}));
jest.mock('../types', () => ({}));
jest.mock('../util', () => ({}));
jest.mock('../legacy', () => ({}));
jest.mock('../workflows/OneTimeFlows', () => ({}));
jest.mock('../GlobalPresetService', () => ({}));
jest.mock('../platform', () => ({ platform }));
jest.mock('../../backend', () => ({ ImageOptimizeMethod: { LOSSY: 'lossy', LOSSLESS: 'lossless', AVIF: 'avif' } }));
import { ExportPresetService } from '../ExportPresetService';
import { emptyExportForm, exportFormToPreset, isExportFieldShown } from '../exportSettings';
import {
  dedupeExportNames,
  PICKED_EXPORT_TEXT,
  pickedOutputs,
  pickFileNames,
} from '../pickedImageExport';

describe('순수 규칙', () => {
  test('경로 → 파일 이름(중복 제거, 처음 순서)', () => {
    expect(pickFileNames(['p/s/1.png', 'p/s/2.png', '1.png'])).toEqual(['1.png', '2.png']);
  });

  test('고른 것만, 그리드 표시 순서대로 — 그사이 지워진 것은 빠진다', () => {
    expect(pickedOutputs(['c.png', 'b.png', 'a.png'], ['a.png', 'c.png', 'gone.png'])).toEqual(['c.png', 'a.png']);
    expect(pickedOutputs(['c.png'], ['gone.png'])).toEqual([]);
  });

  test('겹치는 이름은 대소문자 무시로 비교해 구분자+번호(2부터), 붙인 이름도 다시 겹치지 않게', () => {
    const r = dedupeExportNames(
      [{ name: 's.png' }, { name: 'S.PNG' }, { name: 's.2.png' }, { name: 's.png' }, { name: 'dir/x' }, { name: 'dir/X' }],
      '.',
    );
    expect(r.map((x) => x.name)).toEqual(['s.png', 'S.2.PNG', 's.2.2.png', 's.3.png', 'dir/x', 'dir/X.2']);
    // 겹치지 않으면 같은 객체 그대로
    const items = [{ name: 'a.png', path: 'x' }];
    expect(dedupeExportNames(items, '_')[0]).toBe(items[0]);
    expect(dedupeExportNames([{ name: 'a.png' }, { name: 'a.png' }], '_').map((x) => x.name)).toEqual(['a.png', 'a_2.png']);
  });

  test('직접 설정 창 — 고른 이미지 범위(images)는 「이미지 범위」 칸만 숨긴다', () => {
    expect(isExportFieldShown('menu', 'images')).toBe(false);
    expect(isExportFieldShown('format', 'images')).toBe(true);
    expect(isExportFieldShown('menu', 'project')).toBe(true);
    expect(isExportFieldShown('menu', 'folder')).toBe(true);
  });
});

describe('ExportPresetService.exportPackage(picked)', () => {
  let service: ExportPresetService;
  let session: any;
  let scene: any;
  beforeEach(() => {
    jest.clearAllMocks();
    state.directExportRequest = undefined;
    state.lastExportPicked = undefined;
    scene = { name: 'scene', mains: ['b.png'], type: 'scene' };
    session = { name: 'proj', getScenes: () => [scene] };
    state.curSession = session;
    outputs = ['c.png', 'b.png', 'a.png'];
    service = new ExportPresetService();
  });

  test('프리셋이 「즐겨찾기만」이어도 고른 이미지 전부를 그리드 순서로, 이름 규칙(구분자·번호)은 그대로', async () => {
    const preset = { ...exportFormToPreset(emptyExportForm()), menu: 'fav' as const };
    await service.exportPackage('scene', [scene], preset, { scene, files: ['a.png', 'c.png'] });
    expect(zipFiles.mock.calls[0][0]).toEqual([
      { path: 'proj/scene/c.png', name: 'scene.1.png' },
      { path: 'proj/scene/a.png', name: 'scene.2.png' },
    ]);
    expect(state.lastExportPicked).toEqual({ scene, files: ['a.png', 'c.png'] });
  });

  test('한 장이면 번호 없이(종전 이름 규칙과 같다)', async () => {
    await service.exportPackage('scene', [scene], exportFormToPreset(emptyExportForm()), { scene, files: ['b.png'] });
    expect(zipFiles.mock.calls[0][0]).toEqual([{ path: 'proj/scene/b.png', name: 'scene.png' }]);
  });

  test('고른 이미지가 모두 사라졌으면 「내보낼 이미지가 없습니다」 후 끝', async () => {
    outputs = ['c.png'];
    await service.exportPackage('scene', [scene], exportFormToPreset(emptyExportForm()), { scene, files: ['gone.png'] });
    expect(state.pushMessage).toHaveBeenCalledWith(PICKED_EXPORT_TEXT.empty);
    expect(zipFiles).not.toHaveBeenCalled();
    expect(publishExport).not.toHaveBeenCalled();
  });

  test('방법 고르기 창 문구에 장수, 직접 설정 창은 images 범위·장수', async () => {
    state.pushDialogAsync.mockResolvedValue('_manual');
    const pending = service.exportPackage('scene', [scene], undefined, { scene, files: ['a.png', 'c.png'] });
    await Promise.resolve();
    expect(state.pushDialogAsync.mock.calls[0][0].text).toBe(PICKED_EXPORT_TEXT.chooser(2));
    expect(state.pushDialogAsync.mock.calls[0][0].text).toContain('선택한 이미지 2장');
    expect(state.directExportRequest).toMatchObject({ projectName: 'proj', scope: 'images', imageCount: 2 });
    state.directExportRequest.resolve({ preset: { ...exportFormToPreset(emptyExportForm()), menu: 'fav' }, charsToReplace: [] });
    await pending;
    expect(zipFiles.mock.calls[0][0].map((x: any) => x.path)).toEqual(['proj/scene/c.png', 'proj/scene/a.png']);
  });

  test('씬 전체 내보내기(picked 없음)는 종전 그대로 — 즐겨찾기만, 문구·범위 그대로, 기억한 선택은 지운다', async () => {
    state.lastExportPicked = { scene, files: ['a.png'] };
    state.pushDialogAsync.mockResolvedValue('_manual');
    const pending = service.exportPackage('scene', [scene]);
    await Promise.resolve();
    expect(state.pushDialogAsync.mock.calls[0][0].text).toBe('내보내기 방법을 선택해주세요');
    expect(state.directExportRequest.scope).toBeUndefined();
    expect(state.directExportRequest.imageCount).toBeUndefined();
    expect(state.lastExportPicked).toBeUndefined();
    state.directExportRequest.resolve({ preset: exportFormToPreset(emptyExportForm()), charsToReplace: [] });
    await pending;
    expect(zipFiles.mock.calls[0][0]).toEqual([{ path: 'proj/scene/b.png', name: 'scene.png' }]);
  });

  test('프리셋 관리로 가도 고른 이미지를 기억한다(닫으면 같은 대상으로 다시 연다)', async () => {
    state.pushDialogAsync.mockResolvedValue('_manage');
    await service.exportPackage('scene', [scene], undefined, { scene, files: ['a.png'] });
    expect(state.openExportPresetManager).toHaveBeenCalled();
    expect(state.lastExportPicked).toEqual({ scene, files: ['a.png'] });
    expect(state.lastExportSelected).toEqual([scene]);
  });
});
