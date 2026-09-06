const refreshBatch = jest.fn(async () => {});
const resizeImage = jest.fn(async () => {});
const zipFiles = jest.fn(async (_paths: any[], _destination: string) => {});
const publishExport = jest.fn(async () => {});
const copyFileToAbsolute = jest.fn(async () => {});
const platform = { supportsTargetFolder: true, maxImageConcurrency: 2, exportConcurrency: 2 };
const state: any = { pushDialogAsync: jest.fn(), pushMessage: jest.fn(), showExportComplete: jest.fn(), getAppliedCharacterPreset: () => undefined };
jest.mock('..', () => ({
  imageService: { refreshBatch, getOutputDir: (session: any, scene: any) => `${session.name}/${scene.name}` },
  gameService: { refreshList: jest.fn(), getOutputs: () => ['image.webp'] },
  sessionService: { getFolderOf: () => null, folderLeafName: () => '' },
  zipService: { zipFiles, isZipping: false },
  backend: { getConfig: async () => ({}), resizeImage, publishExport, copyFileToAbsolute, showFile: jest.fn(), copyFile: jest.fn() },
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
import { emptyExportForm, exportFormToPreset, isExportFormValid, presetToExportForm } from '../exportSettings';

let service: ExportPresetService;
let session: any;
beforeEach(() => {
  jest.clearAllMocks();
  state.directExportRequest = undefined;
  platform.supportsTargetFolder = true;
  session = { name: 'original-project', getScenes: () => [{ name: 'scene', mains: [], type: 'scene' }] };
  state.curSession = session;
  service = new ExportPresetService();
});
test('new defaults match and legacy separator/quality/confirmation remain intact', () => {
  const defaults = emptyExportForm();
  expect(defaults.separator).toBe('.');
  expect(exportFormToPreset(defaults).quality).toBeUndefined();
  expect(defaults.reoptimize).toBe('skip');
  const old = { ...exportFormToPreset(defaults), separator: '', quality: 37, reoptimize: undefined };
  expect(presetToExportForm(old)).toMatchObject({ separator: '', quality: 37, reoptimize: 'ask' });
});
test('size and quality validation share the same rules', () => {
  expect(isExportFormValid({ ...emptyExportForm(), opt: 'lossy', imageSize: 1.2 })).toBe(false);
  expect(isExportFormValid({ ...emptyExportForm(), opt: 'avif', quality: 101 })).toBe(false);
  expect(isExportFormValid({ ...emptyExportForm(), opt: 'avif', quality: '' })).toBe(true);
  expect(isExportFormValid(emptyExportForm(), true)).toBe(false);
});
test('direct setup cancellation performs no image refresh or output', async () => {
  state.pushDialogAsync.mockResolvedValue('_manual');
  const pending = service.exportPackage('scene');
  await Promise.resolve();
  state.directExportRequest.resolve();
  await pending;
  expect(refreshBatch).not.toHaveBeenCalled();
  expect(zipFiles).not.toHaveBeenCalled();
});
test('direct export keeps the captured project and never asks follow-up questions', async () => {
  state.pushDialogAsync.mockResolvedValue('_manual');
  const pending = service.exportPackage('scene');
  await Promise.resolve();
  state.curSession = { name: 'other', getScenes: () => [] };
  state.directExportRequest.resolve({ preset: { ...exportFormToPreset(emptyExportForm()), opt: 'lossy' }, charsToReplace: [] });
  await pending;
  expect(state.pushDialogAsync).toHaveBeenCalledTimes(1);
  expect(refreshBatch).toHaveBeenCalledWith(session);
  expect(resizeImage).not.toHaveBeenCalled();
  expect(zipFiles.mock.calls[0][0]).toEqual([{ path: 'original-project/scene/image.webp', name: 'scene.webp' }]);
});
test('legacy optimization policy still asks and can cancel', async () => {
  state.pushDialogAsync.mockResolvedValue('cancel');
  await service.exportPackage('scene', undefined, { ...exportFormToPreset(emptyExportForm()), opt: 'lossy', reoptimize: undefined });
  expect(state.pushDialogAsync).toHaveBeenCalledTimes(1);
  expect(zipFiles).not.toHaveBeenCalled();
});
test('explicit reoptimization reaches the existing image processor', async () => {
  await service.exportPackage('scene', undefined, { ...exportFormToPreset(emptyExportForm()), opt: 'avif', reoptimize: 'all', quality: 50 });
  expect(state.pushDialogAsync).not.toHaveBeenCalled();
  expect(resizeImage).toHaveBeenCalledWith(expect.objectContaining({ optimize: 'avif', quality: 50, maxWidth: 1024 }));
  expect(zipFiles).toHaveBeenCalledTimes(1);
});
test('mobile ignores desktop target folders and uses publication', async () => {
  platform.supportsTargetFolder = false;
  await service.exportPackage('scene', undefined, { ...exportFormToPreset(emptyExportForm()), targetFolder: '/target' });
  expect(copyFileToAbsolute).not.toHaveBeenCalled();
  expect(publishExport).toHaveBeenCalledTimes(1);
});
