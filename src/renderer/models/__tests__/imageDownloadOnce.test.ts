// 번호 고르기 창의 「이번 다운로드에만 쓰는 저장 폴더」와 파일명 미리보기(2026-11-23):
// (a) 파일명 규칙을 downloadNameAffixes·downloadBaseFilename 으로 떼어 낸 전후 동일성, 미리보기 = 실제 저장 이름
// (b) savePath 를 주면 그 폴더로 저장하고 설정(lastSavePath·config)을 건드리지 않음, 주지 않으면 종전과 같음, pickFolderOnce 는 설정 불변.
let mockMobile = false;
let store: Record<string, any> = {};
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const backend = {
  selectDir: jest.fn(async (): Promise<string | undefined> => undefined),
  copyToDownloads: jest.fn(async (_p: string, _sub?: string) => {}),
  existInDownloads: jest.fn(async (_n: string) => false),
  writeDataFileAbsolute: jest.fn(async (_p: string, _d: string) => {}),
  existFileAbsolute: jest.fn(async (_p: string) => false),
  existFile: jest.fn(async (_p: string) => false),
  getConfig: jest.fn(async () => clone(store)),
  setConfig: jest.fn(async (c: Record<string, any>) => {
    store = clone(c);
  }),
};
// 바이트 판정: PNG 시그니처(iVBOR…)면 png, 'UklGR'(RIFF)면 webp
const PNG = 'data:image/png;base64,iVBORw0KGgo';
const WEBP = 'data:image/webp;base64,UklGRiQAAABXRUJQVlA4';
const imageService = { fetchImage: jest.fn(async (p: string) => (p.endsWith('.webp') ? WEBP : PNG)) };
jest.mock('..', () => ({ backend, imageService }));
const appState = { pushMessage: jest.fn(), setProgressDialog: jest.fn() };
jest.mock('../AppService', () => ({ appState }));
jest.mock('../ImageService', () => ({
  cropMirrorResultFromDataUri: jest.fn(async () => 'iVBORcropped'),
  dataUriToBase64: (d: string) => d.split(',')[1],
}));
jest.mock('../platform', () => ({
  platform: {
    get isMobile() {
      return mockMobile;
    },
  },
}));

import {
  ImageDownloadService,
  buildDownloadNamePreview,
  downloadBaseFilename,
  downloadNameAffixes,
  generateFilename,
  DOWNLOAD_PREVIEW_TIMESTAMP,
} from '../ImageDownloadService';

const session: any = { name: 'proj' };
const scene: any = { type: 'scene', name: 'scene' };
const mirror: any = { type: 'inpaint', name: 'mir', workflowType: 'SDMirror', mirrorCropX: 100 };
let svc: ImageDownloadService;
let nowSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  mockMobile = false;
  store = { unrelatedKey: 'keep-me' };
  svc = new ImageDownloadService();
  nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1763884800123);
});
afterEach(() => nowSpy.mockRestore());

const written = () => backend.writeDataFileAbsolute.mock.calls.map((c) => c[0]);

describe('(a) 파일명 규칙 — 떼어 낸 전후 동일성', () => {
  // 떼어 내기 전 downloadSingleImage·downloadMultipleImages 안에 있던 식 그대로(비교 기준)
  const oldAffixes = (settings: any, cp?: any) => ({
    prefix: cp?.filenamePrefix || settings.defaultPrefix || '',
    suffix: cp?.filenameSuffix || settings.defaultSuffix || '',
  });
  const oldSingle = (sceneName: string, settings: any, cp?: any) => {
    const { prefix, suffix } = oldAffixes(settings, cp);
    return generateFilename({ sceneName, prefix, suffix, includeTimestamp: settings.includeTimestamp });
  };
  const oldMulti = (sceneName: string, settings: any, i: number, cp?: any) => {
    const { prefix, suffix } = oldAffixes(settings, cp);
    return generateFilename({
      sceneName,
      prefix,
      suffix,
      includeTimestamp: settings.includeTimestamp,
      includeIndex: true,
      index: i + 1,
    });
  };
  const settingsCases: any[] = [
    {},
    { defaultPrefix: 'pre' },
    { defaultSuffix: 'suf' },
    { defaultPrefix: 'p:re', defaultSuffix: 's/uf', includeTimestamp: true },
    { includeTimestamp: true },
  ];
  const presetCases: any[] = [
    undefined,
    { filenamePrefix: 'cp' },
    { filenameSuffix: 'cs' },
    { filenamePrefix: 'cp', filenameSuffix: 'cs' },
    { filenamePrefix: '' },
  ];
  const names = ['scene', '씬 A?', '  ..dots..  ', ''];

  test('접두사·접미사·캐릭터 프리셋·타임스탬프·한 장/여러 장 조합 전부 같다', () => {
    for (const st of settingsCases) {
      for (const cp of presetCases) {
        expect(downloadNameAffixes(st, cp)).toEqual(oldAffixes(st, cp));
        const { prefix, suffix } = downloadNameAffixes(st, cp);
        for (const nm of names) {
          expect(downloadBaseFilename({ sceneName: nm, prefix, suffix, includeTimestamp: st.includeTimestamp })).toBe(
            oldSingle(nm, st, cp),
          );
          for (const i of [0, 1, 8, 99, 999, 1234]) {
            expect(
              downloadBaseFilename({ sceneName: nm, prefix, suffix, includeTimestamp: st.includeTimestamp, index: i + 1 }),
            ).toBe(oldMulti(nm, st, i, cp));
          }
        }
      }
    }
  });

  test('타임스탬프 자리 글자는 넘길 때만(저장은 Date.now())', () => {
    const base = { sceneName: 's', prefix: '', suffix: '', includeTimestamp: true };
    expect(downloadBaseFilename(base)).toBe('s_1763884800123');
    expect(downloadBaseFilename({ ...base, timestampText: DOWNLOAD_PREVIEW_TIMESTAMP })).toBe('s_{시각}');
    expect(downloadBaseFilename({ ...base, index: 2, timestampText: DOWNLOAD_PREVIEW_TIMESTAMP })).toBe('s_002_{시각}');
  });

  test('실제 저장 결과(종전 기대값): 한 장·여러 장·캐릭터 프리셋·타임스탬프·확장자', async () => {
    svc.settings = { ...svc.settings, lastSavePath: 'D:/Out', defaultPrefix: 'pre', defaultSuffix: 'suf' };
    await svc.downloadImages(session, scene, ['outs/a.png']);
    expect(written()).toEqual(['D:/Out/pre_scene_suf.png']);
    backend.writeDataFileAbsolute.mockClear();
    await svc.downloadImages(session, scene, ['outs/a.png', 'outs/b.webp'], { filenamePrefix: 'cp' } as any, true);
    expect(written()).toEqual(['D:/Out/scene/cp_scene_suf_001.png', 'D:/Out/scene/cp_scene_suf_002.webp']);
    backend.writeDataFileAbsolute.mockClear();
    svc.settings = { ...svc.settings, includeTimestamp: true, defaultPrefix: '', defaultSuffix: '' };
    await svc.downloadImages(session, scene, ['outs/a.webp']);
    expect(written()).toEqual(['D:/Out/scene_1763884800123.webp']);
  });

  test('미리보기 = 실제 저장 이름(타임스탬프 자리만 다름)', async () => {
    const cases: { sc: any; paths: string[]; cp?: any; st: any }[] = [
      { sc: scene, paths: ['outs/a.png'], st: {} },
      { sc: scene, paths: ['outs/a.webp'], st: { includeTimestamp: true, defaultPrefix: 'p' } },
      { sc: scene, paths: ['outs/a.png', 'outs/b.webp', 'outs/c.png'], cp: { filenameSuffix: 'cs' }, st: { defaultPrefix: 'p' } },
      { sc: mirror, paths: ['inpaints/a.webp', 'inpaints/b.png'], st: { includeTimestamp: true } },
      { sc: { type: 'scene', name: 'a/b:c' }, paths: ['outs/1.png', 'outs/2.png'], st: {} },
    ];
    for (const c of cases) {
      backend.writeDataFileAbsolute.mockClear();
      svc.settings = { autoNumbering: true, overwriteExisting: false, includeTimestamp: false, lastSavePath: 'D:/Out', ...c.st };
      await svc.downloadImages(session, c.sc, c.paths, c.cp, true);
      const actual = written().map((p) => p.slice('D:/Out/'.length));
      const preview = svc.previewDownloadNames(c.sc, c.paths, c.cp, 99);
      expect(preview.names.map((n) => n.split(DOWNLOAD_PREVIEW_TIMESTAMP).join('1763884800123'))).toEqual(actual);
      expect(preview.rest).toBe(0);
      expect(preview.timestampMark).toBe(c.st.includeTimestamp ? DOWNLOAD_PREVIEW_TIMESTAMP : undefined);
    }
  });

  test('미리보기: 처음 3개 + 나머지 수, 0장, 모바일은 원본 파일명(여러 장이면 씬 이름 폴더)', () => {
    const settings: any = { autoNumbering: true, overwriteExisting: false, includeTimestamp: true };
    const five = ['o/a.png', 'o/b.png', 'o/c.png', 'o/d.png', 'o/e.png'];
    expect(buildDownloadNamePreview({ scene, imagePaths: five, settings, mobile: false })).toEqual({
      names: ['scene/scene_001_{시각}.png', 'scene/scene_002_{시각}.png', 'scene/scene_003_{시각}.png'],
      rest: 2,
      timestampMark: '{시각}',
    });
    expect(buildDownloadNamePreview({ scene, imagePaths: [], settings, mobile: false })).toEqual({
      names: [],
      rest: 0,
      timestampMark: undefined,
    });
    expect(buildDownloadNamePreview({ scene, imagePaths: five, settings, mobile: true })).toEqual({
      names: ['scene/a.png', 'scene/b.png', 'scene/c.png'],
      rest: 2,
      timestampMark: undefined,
    });
    expect(buildDownloadNamePreview({ scene, imagePaths: ['o/x.webp'], settings, mobile: true }).names).toEqual(['x.webp']);
  });
});

describe('(b) 이번 다운로드에만 쓰는 저장 폴더', () => {
  test('PC 여러 장: savePath 폴더 안 씬 이름 폴더로 저장, 설정·config 불변, 폴더 선택 창 없음', async () => {
    svc.settings = { ...svc.settings, lastSavePath: 'D:/Default' };
    const r = await svc.downloadImages(session, scene, ['a.png', 'b.png'], undefined, true, { savePath: 'E:/Once' });
    expect(r).toEqual({ success: 2, failed: 0 });
    expect(written()).toEqual(['E:/Once/scene/scene_001.png', 'E:/Once/scene/scene_002.png']);
    expect(backend.existFileAbsolute).toHaveBeenCalledWith('E:/Once/scene');
    expect(svc.settings.lastSavePath).toBe('D:/Default');
    expect(backend.setConfig).not.toHaveBeenCalled();
    expect(backend.selectDir).not.toHaveBeenCalled();
  });
  test('PC 한 장·진행 창 없는 여러 장도 같은 폴더, 설정이 미지정이어도 폴더 선택 창 없음·설정 그대로 미지정', async () => {
    await svc.downloadImages(session, scene, ['a.png'], undefined, true, { savePath: 'E:/Once' });
    await svc.downloadImages(session, scene, ['a.png', 'b.png'], undefined, false, { savePath: 'E:/Once' });
    expect(written()).toEqual(['E:/Once/scene.png', 'E:/Once/scene/scene_001.png', 'E:/Once/scene/scene_002.png']);
    expect(svc.settings.lastSavePath).toBeUndefined();
    expect(backend.selectDir).not.toHaveBeenCalled();
    expect(backend.setConfig).not.toHaveBeenCalled();
    expect(backend.getConfig).not.toHaveBeenCalled();
  });
  test('savePath 를 주지 않으면 종전: 설정 미지정 → 폴더 선택 창 → 설정에 저장', async () => {
    backend.selectDir.mockResolvedValueOnce('D:/Picked');
    await svc.downloadImages(session, scene, ['a.png', 'b.png'], undefined, true);
    expect(written()).toEqual(['D:/Picked/scene/scene_001.png', 'D:/Picked/scene/scene_002.png']);
    expect(store.downloadSettings.lastSavePath).toBe('D:/Picked');
    expect(store.unrelatedKey).toBe('keep-me');
    // 빈 문자열도 「주지 않음」과 같다
    backend.writeDataFileAbsolute.mockClear();
    await svc.downloadImages(session, scene, ['a.png'], undefined, true, { savePath: '' });
    expect(written()).toEqual(['D:/Picked/scene.png']);
  });
  test('모바일은 savePath 를 무시하고 기기 다운로드 폴더(종전)', async () => {
    mockMobile = true;
    await svc.downloadImages(session, scene, ['o/a.png', 'o/b.png'], undefined, true, { savePath: 'E:/Once' });
    expect(backend.copyToDownloads.mock.calls).toEqual([
      ['o/a.png', 'scene'],
      ['o/b.png', 'scene'],
    ]);
    expect(backend.writeDataFileAbsolute).not.toHaveBeenCalled();
  });
  test('pickFolderOnce: 폴더만 고르고 설정 불변, 취소 = undefined, 모바일 = 아무것도 안 함', async () => {
    svc.settings = { ...svc.settings, lastSavePath: 'D:/Default' };
    backend.selectDir.mockResolvedValueOnce('E:/Once');
    expect(await svc.pickFolderOnce()).toBe('E:/Once');
    expect(svc.settings.lastSavePath).toBe('D:/Default');
    expect(backend.setConfig).not.toHaveBeenCalled();
    expect(backend.getConfig).not.toHaveBeenCalled();
    backend.selectDir.mockResolvedValueOnce(undefined);
    expect(await svc.pickFolderOnce()).toBeUndefined();
    expect(svc.supportsSaveFolder).toBe(true);
    mockMobile = true;
    backend.selectDir.mockClear();
    expect(await svc.pickFolderOnce()).toBeUndefined();
    expect(backend.selectDir).not.toHaveBeenCalled();
    expect(svc.supportsSaveFolder).toBe(false);
  });
});
