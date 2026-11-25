// 앱이 만든 이미지 한 장 저장(2026-11-25 「캡처」) — ImageDownloadService.saveGeneratedImage.
// PC = 다운로드 저장 폴더(없으면 폴더 선택)·같은 이름은 「_1」, 모바일 = exports/ 임시 → copyToDownloads → 임시 삭제·같은 이름은 「_2」.
let mockMobile = false;
let store: Record<string, any> = {};
const existing = new Set<string>();
const downloads = new Set<string>();
const backend = {
  selectDir: jest.fn(async (): Promise<string | undefined> => undefined),
  copyToDownloads: jest.fn(async (_p: string, _sub?: string) => {}),
  existInDownloads: jest.fn(async (n: string) => downloads.has(n)),
  writeDataFile: jest.fn(async (_p: string, _d: string) => {}),
  deleteFile: jest.fn(async (_p: string) => {}),
  writeDataFileAbsolute: jest.fn(async (_p: string, _d: string) => {}),
  existFileAbsolute: jest.fn(async (p: string) => existing.has(p)),
  existFile: jest.fn(async (_p: string) => false),
  getConfig: jest.fn(async () => JSON.parse(JSON.stringify(store))),
  setConfig: jest.fn(async (c: Record<string, any>) => {
    store = JSON.parse(JSON.stringify(c));
  }),
};
jest.mock('..', () => ({ backend, imageService: {} }));
const appState = { pushMessage: jest.fn(), setProgressDialog: jest.fn() };
jest.mock('../AppService', () => ({ appState }));
jest.mock('../ImageService', () => ({ cropMirrorResultFromDataUri: jest.fn(), dataUriToBase64: (d: string) => d }));
jest.mock('../platform', () => ({
  platform: {
    get isMobile() {
      return mockMobile;
    },
  },
}));

import { ImageDownloadService } from '../ImageDownloadService';

let svc: ImageDownloadService;
beforeEach(() => {
  jest.clearAllMocks();
  mockMobile = false;
  store = {};
  existing.clear();
  downloads.clear();
  svc = new ImageDownloadService();
});

describe('PC', () => {
  test('저장 폴더가 있으면 그곳, 금지 문자 정리, 같은 이름이 있으면 덮지 않고 _1', async () => {
    svc.settings.lastSavePath = 'D:/dl';
    existing.add('D:/dl/P_캡처_1.jpg');
    const name = await svc.saveGeneratedImage('QUJD', 'P_캡처_1', 'jpg');
    expect(name).toBe('P_캡처_1_1.jpg');
    expect(backend.writeDataFileAbsolute).toHaveBeenCalledWith('D:/dl/P_캡처_1_1.jpg', 'QUJD');
    expect(backend.selectDir).not.toHaveBeenCalled();
    expect(appState.pushMessage).toHaveBeenCalledWith('이미지가 저장되었습니다: P_캡처_1_1.jpg');
    await svc.saveGeneratedImage('QUJD', 'a:b/c', 'png');
    expect(backend.writeDataFileAbsolute).toHaveBeenLastCalledWith('D:/dl/a_b_c.png', 'QUJD');
  });

  test('저장 폴더가 없으면 폴더 선택 — 고르지 않으면 안내하고 저장하지 않음', async () => {
    svc.settings.lastSavePath = undefined as any;
    const name = await svc.saveGeneratedImage('QUJD', 'x', 'jpg');
    expect(name).toBeUndefined();
    expect(backend.selectDir).toHaveBeenCalled();
    expect(backend.writeDataFileAbsolute).not.toHaveBeenCalled();
    expect(appState.pushMessage).toHaveBeenCalledWith('저장 폴더를 고르지 않아 다운로드하지 않았습니다');
  });
});

describe('모바일', () => {
  test('exports/ 임시 파일 → 다운로드 폴더 복사 → 임시 삭제, 같은 이름이 있으면 _2', async () => {
    mockMobile = true;
    downloads.add('P_캡처.jpg');
    const name = await svc.saveGeneratedImage('QUJD', 'P_캡처', 'jpg');
    expect(name).toBe('P_캡처_2.jpg');
    expect(backend.writeDataFile).toHaveBeenCalledWith('exports/P_캡처_2.jpg', 'QUJD');
    expect(backend.copyToDownloads).toHaveBeenCalledWith('exports/P_캡처_2.jpg');
    expect(backend.deleteFile).toHaveBeenCalledWith('exports/P_캡처_2.jpg');
    expect(backend.selectDir).not.toHaveBeenCalled();
    expect(appState.pushMessage).toHaveBeenCalledWith('다운로드 폴더에 저장했습니다: P_캡처_2.jpg');
  });

  test('복사가 실패해도 임시 파일은 지우고 실패를 알린다', async () => {
    mockMobile = true;
    backend.copyToDownloads.mockRejectedValueOnce(new Error('denied'));
    const name = await svc.saveGeneratedImage('QUJD', 'P', 'png');
    expect(name).toBeUndefined();
    expect(backend.deleteFile).toHaveBeenCalledWith('exports/P.png');
    expect(appState.pushMessage).toHaveBeenCalledWith('이미지 저장 실패: denied');
  });
});
