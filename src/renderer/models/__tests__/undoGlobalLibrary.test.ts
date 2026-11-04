// 전역 라이브러리 되돌리기(2026-11-04 2차 묶음 4 P5 — 전역 스택, SPEC_GUIDE 「되돌리기 계약」 「2차 P5」).
// 글로벌 캐릭터(이름·순서 병합·폴더 이동/일괄·새 폴더 자동 등록·폴더 만들기 조건·폴더 이름·폴더 삭제 복귀)·글로벌 프리셋
// (이름·기본 지정·일괄)·작가(이름·즐겨찾기·썸네일 원래 자리·계열·태그·태그 프리셋)·내보내기 프리셋(삭제 복원 포함)·템플릿(이름·배지 색
// 병합) 각각 되돌리기·다시 실행·verify 실패(다른 창 변경 시뮬레이션). 글로벌 캐릭터·작가·템플릿은 실제 서비스 클래스로 확인한다.
const backend = {
  readFile: jest.fn(async () => {
    throw new Error('no file');
  }),
  renameFile: jest.fn(async () => {}),
  notifyGlobalStoreChanged: jest.fn(async () => {}),
  deleteFile: jest.fn(async () => {}),
  deleteDir: jest.fn(async () => {}),
};
jest.mock('..', () => ({
  backend,
  imageService: {},
  workFlowService: {},
  sessionService: {},
  templateService: {
    clearFolderTemplatesByTemplateId: jest.fn(async () => {}),
    clearApplicationsByTemplateId: jest.fn(async () => {}),
  },
  globalPresetService: {},
  globalCharacterPresetService: {},
}));
jest.mock('../PersistenceService', () => ({
  persistService: { write: jest.fn(async () => {}) },
}));
jest.mock('../appStateRef', () => ({
  getAppState: () => ({ pushMessage: jest.fn() }),
}));
jest.mock('../types', () => ({
  VibeItem: { fromJSON: (j: any) => j },
  ReferenceItem: { fromJSON: (j: any) => j },
  CharacterPreset: { fromJSON: (j: any) => j },
  Session: class {},
}));
jest.mock('../ImageService', () => ({ dataUriToBase64: (s: string) => s }));
jest.mock('../imageFormats', () => ({ imageExtFromBase64: () => 'png' }));

import { GLOBAL_UNDO_SCOPE, UNDO_TEXT, UndoService } from '../undoService';
import { GlobalCharacterPresetService } from '../GlobalCharacterPresetService';
import { ArtistLibraryService } from '../ArtistLibraryService';
import { ProjectTemplateService } from '../ProjectTemplateService';
import {
  addArtistTagPresetRecorded,
  addArtistTagRecorded,
  createGlobalCharacterFolderRecorded,
  deleteGlobalCharacterFolderRecorded,
  GlobalLibraryOps,
  GlobalPresetEntryLike,
  removeArtistTagPresetRecorded,
  removeArtistTagRecorded,
  renameArtistRecorded,
  renameGlobalCharacterFolderRecorded,
  renameGlobalCharacterRecorded,
  renameGlobalPresetRecorded,
  renameTemplateRecorded,
  reorderGlobalCharactersRecorded,
  saveExportPresetsRecorded,
  setArtistImageFamilyRecorded,
  setArtistThumbnailRecorded,
  setGlobalCharacterFolderRecorded,
  setGlobalCharactersFolderRecorded,
  setGlobalPresetDefaultRecorded,
  setGlobalPresetsDefaultRecorded,
  setTemplateBadgeColorRecorded,
  toggleArtistFavoriteRecorded,
} from '../globalLibraryUndo';

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

/** 글로벌 프리셋 가짜(서비스 규칙: 같은 종류 안 이름 중복 거부·같은 값이면 무시) */
class FakePresets {
  list: GlobalPresetEntryLike[] = [];
  ops(): GlobalLibraryOps['presets'] {
    return {
      get: (id) => this.list.find((p) => p.id === id),
      getByName: (t, n) => this.list.find((p) => p.workflowType === t && p.name === n),
      rename: async (id, name) => {
        const e = this.list.find((p) => p.id === id);
        if (!e) throw new Error('프리셋을 찾을 수 없습니다');
        name = name.trim();
        if (e.name === name) return;
        if (this.list.some((p) => p.id !== id && p.workflowType === e.workflowType && p.name === name)) {
          throw new Error('이미 존재하는 이름입니다');
        }
        e.name = name;
      },
      setDefault: async (id, v) => {
        const e = this.list.find((p) => p.id === id);
        if (!e) throw new Error('프리셋을 찾을 수 없습니다');
        e.isDefault = v;
      },
    };
  }
}

function harness() {
  const toast = jest.fn();
  const clock = { t: 1000 };
  const service = new UndoService({
    curSession: () => undefined,
    isMirror: () => false,
    toast,
    now: () => clock.t,
    confirm: async () => true,
  });
  const chars = new GlobalCharacterPresetService();
  const artists = new ArtistLibraryService();
  const templates = new ProjectTemplateService();
  const presets = new FakePresets();
  const exportStore = { list: [] as any[] };
  const ops: GlobalLibraryOps = {
    characters: {
      list: () => chars.list(),
      get: (id) => chars.get(id),
      getByName: (n) => chars.getByName(n),
      listFolders: () => chars.listFolders(),
      registeredFolders: () => chars.folders.slice(),
      rename: (id, n) => chars.rename(id, n),
      reorder: (f, t) => chars.reorder(f, t),
      setFolder: (id, f) => chars.setFolder(id, f),
      createFolder: (n, at) => chars.createFolder(n, at),
      renameFolder: (a, b) => chars.renameFolder(a, b),
      deleteFolder: (n) => chars.deleteFolder(n),
    },
    presets: presets.ops(),
    artists: {
      getArtist: (id) => artists.getArtist(id),
      findArtistByName: (n, x) => artists.findArtistByName(n, x),
      tagPresets: () => artists.tagPresets.slice(),
      renameArtist: (id, n) => artists.renameArtist(id, n),
      setFavorite: (id, on) => artists.setFavorite(id, on),
      setThumbnail: (id, i) => artists.setThumbnail(id, i),
      setImageOrder: (id, ids) => artists.setImageOrder(id, ids),
      setImageFamily: (id, i, f) => artists.setImageFamily(id, i, f),
      addTag: (id, t) => artists.addTag(id, t),
      removeTag: (id, t) => artists.removeTag(id, t),
      setTags: (id, t) => artists.setTags(id, t),
      addTagPreset: (t) => artists.addTagPreset(t),
      removeTagPreset: (t) => artists.removeTagPreset(t),
      setTagPresets: (t) => artists.setTagPresets(t),
    },
    exportPresets: {
      load: () => exportStore.list,
      save: (p) => {
        exportStore.list = p;
      },
    },
    templates: {
      get: (id) => templates.get(id),
      getByName: (n) => templates.getByName(n),
      rename: (id, n) => templates.rename(id, n),
      setBadgeColor: (id, c) => templates.setBadgeColor(id, c),
    },
  };
  const opts = { service, ops };
  const past = () => service.entries(GLOBAL_UNDO_SCOPE).past.map((e) => e.label);
  const lastToast = () => toast.mock.calls[toast.mock.calls.length - 1]?.[0] as string;
  return { service, toast, lastToast, clock, chars, artists, templates, presets, exportStore, opts, past };
}

const seedChars = (svc: GlobalCharacterPresetService, list: Array<{ id: string; name: string; folder?: string }>) => {
  svc.presets = list.map((e) => ({ ...e, createdAt: 0, updatedAt: 0, preset: { name: e.name } as any }));
};

describe('글로벌 캐릭터 프리셋', () => {
  test('이름 변경 → 되돌림 → 다시 실행, 다른 창에서 이름이 바뀌면 폐기', async () => {
    const { service, chars, opts, past, lastToast } = harness();
    seedChars(chars, [{ id: 'a', name: '앨리스' }]);
    await renameGlobalCharacterRecorded('a', '밥', opts);
    expect(past()).toEqual([UNDO_TEXT.globalCharacterRename('앨리스', '밥')]);
    expect(await service.undo()).toBe(true);
    expect(chars.get('a')!.name).toBe('앨리스');
    expect(await service.redo()).toBe(true);
    expect(chars.get('a')!.name).toBe('밥');
    // 다른 창 저장 → 이 창이 재로드한 셈
    chars.get('a')!.name = '캐럴';
    expect(await service.undo()).toBe(false);
    expect(lastToast()).toBe(UNDO_TEXT.undoFailed(UNDO_TEXT.globalCharacterChanged('캐럴')));
    expect(service.entries(GLOBAL_UNDO_SCOPE).past).toHaveLength(0);
  });

  test('같은 이름이면 기록 없음', async () => {
    const { chars, opts, past } = harness();
    seedChars(chars, [{ id: 'a', name: 'A' }]);
    await renameGlobalCharacterRecorded('a', ' A ', opts);
    expect(past()).toEqual([]);
  });

  test('순서 드래그 연속(1초 안) = 한 항목, 되돌리면 처음 순서', async () => {
    const { service, chars, clock, opts, past } = harness();
    seedChars(chars, [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
      { id: 'c', name: 'C' },
    ]);
    reorderGlobalCharactersRecorded(0, 1, opts);
    clock.t += 300;
    reorderGlobalCharactersRecorded(1, 2, opts);
    expect(chars.list().map((e) => e.id)).toEqual(['b', 'c', 'a']);
    expect(past()).toEqual([UNDO_TEXT.globalCharacterOrder]);
    expect(await service.undo()).toBe(true);
    expect(chars.list().map((e) => e.id)).toEqual(['a', 'b', 'c']);
    expect(await service.redo()).toBe(true);
    expect(chars.list().map((e) => e.id)).toEqual(['b', 'c', 'a']);
    // 1초 넘게 지나면 새 항목
    clock.t += 2000;
    reorderGlobalCharactersRecorded(0, 2, opts);
    expect(past()).toHaveLength(2);
  });

  test('순서: 그사이 프리셋이 추가되면 폐기', async () => {
    const { service, chars, opts } = harness();
    seedChars(chars, [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ]);
    reorderGlobalCharactersRecorded(0, 1, opts);
    chars.presets = [...chars.presets, { id: 'z', name: 'Z', createdAt: 0, updatedAt: 0, preset: {} as any }];
    expect(await service.undo()).toBe(false);
    expect(chars.list().map((e) => e.id)).toEqual(['b', 'a', 'z']);
  });

  test('폴더 이동 → 되돌림/다시 실행, 일괄 이동은 한 항목(역순)', async () => {
    const { service, chars, opts, past } = harness();
    seedChars(chars, [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B', folder: 'X' },
      { id: 'c', name: 'C' },
    ]);
    chars.folders = ['X', 'Y'];
    await setGlobalCharacterFolderRecorded('a', 'Y', opts);
    expect(past()).toEqual([UNDO_TEXT.globalCharacterMove(['A'], 'Y')]);
    await setGlobalCharactersFolderRecorded(['b', 'c'], null, opts);
    // c 는 이미 미분류라 기록에서 빠짐
    expect(past()[1]).toBe(UNDO_TEXT.globalCharacterMove(['B'], UNDO_TEXT.unfiled));
    await setGlobalCharactersFolderRecorded(['a', 'c'], 'X', opts);
    expect(past()[2]).toBe(UNDO_TEXT.globalCharacterMove(['A', 'C'], 'X'));
    expect(await service.undo()).toBe(true);
    expect(chars.get('a')!.folder).toBe('Y');
    expect(chars.get('c')!.folder).toBeUndefined();
    expect(await service.undo()).toBe(true);
    expect(chars.get('b')!.folder).toBe('X');
    expect(await service.undo()).toBe(true);
    expect(chars.get('a')!.folder).toBeUndefined();
    expect(await service.redo()).toBe(true);
    expect(chars.get('a')!.folder).toBe('Y');
  });

  test('「새 폴더」로 처음 생긴 폴더는 되돌릴 때 비어 있으면 함께 지우고, 다시 실행하면 다시 생긴다', async () => {
    const { service, chars, opts } = harness();
    seedChars(chars, [{ id: 'a', name: 'A' }]);
    chars.folders = ['X'];
    await setGlobalCharacterFolderRecorded('a', '새것', opts);
    expect(chars.folders).toEqual(['X', '새것']);
    expect(await service.undo()).toBe(true);
    expect(chars.get('a')!.folder).toBeUndefined();
    expect(chars.folders).toEqual(['X']);
    expect(await service.redo()).toBe(true);
    expect(chars.get('a')!.folder).toBe('새것');
    expect(chars.folders).toEqual(['X', '새것']);
  });

  test('폴더 이동: 대상 폴더가 그사이 지워졌으면 되돌리지 않는다(폴더를 새로 만들지 않음)', async () => {
    const { service, chars, opts, lastToast } = harness();
    seedChars(chars, [{ id: 'a', name: 'A', folder: 'X' }]);
    chars.folders = ['X'];
    await setGlobalCharacterFolderRecorded('a', null, opts);
    chars.folders = [];
    expect(await service.undo()).toBe(false);
    expect(lastToast()).toBe(UNDO_TEXT.undoFailed(UNDO_TEXT.globalCharacterFolderGone('X')));
    expect(chars.folders).toEqual([]);
  });

  test('폴더 만들기: 비어 있으면 되돌림 = 삭제, 프리셋을 넣은 뒤면 폐기', async () => {
    const { service, chars, opts, lastToast } = harness();
    seedChars(chars, [{ id: 'a', name: 'A' }]);
    chars.folders = ['X', 'Y'];
    expect(await createGlobalCharacterFolderRecorded(' 새 폴더 ', opts)).toBe('새 폴더');
    expect(await service.undo()).toBe(true);
    expect(chars.folders).toEqual(['X', 'Y']);
    expect(await service.redo()).toBe(true);
    expect(chars.folders).toEqual(['X', 'Y', '새 폴더']);
    await chars.setFolder('a', '새 폴더'); // 기록 밖(테스트에서 직접)
    expect(await service.undo()).toBe(false);
    expect(lastToast()).toBe(UNDO_TEXT.undoFailed(UNDO_TEXT.globalCharacterFolderNotEmpty('새 폴더')));
    expect(chars.folders).toContain('새 폴더');
  });

  test('폴더 이름 변경 → 소속 프리셋과 함께 되돌림, 옛 이름이 그사이 생기면 폐기', async () => {
    const { service, chars, opts, past } = harness();
    seedChars(chars, [{ id: 'a', name: 'A', folder: 'X' }]);
    chars.folders = ['X'];
    await renameGlobalCharacterFolderRecorded('X', 'Z', opts);
    expect(past()).toEqual([UNDO_TEXT.globalCharacterFolderRename('X', 'Z')]);
    expect(service.peekLabel(undefined, 'undo')).toBe(UNDO_TEXT.globalCharacterFolderRename('Z', 'X'));
    expect(await service.undo()).toBe(true);
    expect(chars.folders).toEqual(['X']);
    expect(chars.get('a')!.folder).toBe('X');
    expect(await service.redo()).toBe(true);
    expect(chars.get('a')!.folder).toBe('Z');
    await chars.createFolder('X');
    expect(await service.undo()).toBe(false);
  });

  test('폴더 삭제(프리셋은 미분류로) → 되돌리면 원래 자리·소속 복귀, 그사이 다른 폴더로 옮긴 프리셋은 건너뜀', async () => {
    const { service, chars, opts, toast } = harness();
    seedChars(chars, [
      { id: 'a', name: 'A', folder: 'X' },
      { id: 'b', name: 'B', folder: 'X' },
      { id: 'c', name: 'C', folder: 'Y' },
    ]);
    chars.folders = ['X', 'Y'];
    await deleteGlobalCharacterFolderRecorded('X', opts);
    expect(chars.folders).toEqual(['Y']);
    expect(chars.get('a')!.folder).toBeUndefined();
    expect(chars.list()).toHaveLength(3); // 프리셋은 지워지지 않는다
    expect(await service.undo()).toBe(true);
    expect(chars.folders).toEqual(['X', 'Y']);
    expect(chars.get('a')!.folder).toBe('X');
    expect(chars.get('b')!.folder).toBe('X');
    expect(await service.redo()).toBe(true);
    expect(chars.folders).toEqual(['Y']);
    await chars.setFolder('b', 'Y'); // 기록 밖 이동
    toast.mockClear();
    expect(await service.undo()).toBe(true);
    expect(chars.get('a')!.folder).toBe('X');
    expect(chars.get('b')!.folder).toBe('Y');
    expect(toast.mock.calls[0][1]).toBe('error'); // 부분 실패 안내
  });
});

describe('글로벌 프리셋(그림체)', () => {
  test('이름 변경 되돌림·다시 실행, 같은 종류에 옛 이름이 생기면 폐기', async () => {
    const { service, presets, opts } = harness();
    presets.list = [{ id: 'p', name: '수채', workflowType: 'SDImageGen' }];
    await renameGlobalPresetRecorded('p', '유화', opts);
    expect(await service.undo()).toBe(true);
    expect(presets.list[0].name).toBe('수채');
    expect(await service.redo()).toBe(true);
    presets.list.push({ id: 'q', name: '수채', workflowType: 'SDImageGen' });
    expect(await service.undo()).toBe(false);
    expect(presets.list[0].name).toBe('유화');
  });

  test('기본 지정 절대값 + 일괄은 한 항목, 다른 창 변경이면 그 항목 실패', async () => {
    const { service, presets, opts, past } = harness();
    presets.list = [
      { id: 'p', name: 'P', workflowType: 'SDImageGen', isDefault: false },
      { id: 'q', name: 'Q', workflowType: 'SDImageGen', isDefault: true },
      { id: 'r', name: 'R', workflowType: 'SDImageGen', isDefault: false },
    ];
    await setGlobalPresetDefaultRecorded('p', true, opts);
    expect(past()).toEqual([UNDO_TEXT.globalPresetDefaultOn('P')]);
    await setGlobalPresetsDefaultRecorded(['q', 'r', 'missing'], true, opts);
    expect(past()[1]).toBe(UNDO_TEXT.globalPresetDefaultOn('R')); // q 는 이미 기본
    await setGlobalPresetsDefaultRecorded(['p', 'q', 'r'], false, opts);
    expect(past()[2]).toBe(UNDO_TEXT.globalPresetDefaultBulk(3, false));
    expect(await service.undo()).toBe(true);
    expect(presets.list.map((p) => p.isDefault)).toEqual([true, true, true]);
    presets.list[2].isDefault = false; // 다른 창
    expect(await service.undo()).toBe(false);
    expect(await service.undo()).toBe(true);
    expect(presets.list[0].isDefault).toBe(false);
  });
});

describe('작가 라이브러리', () => {
  const seedArtist = (svc: ArtistLibraryService) => {
    svc.artists = [
      {
        id: 'a',
        name: '작가',
        images: [
          { id: 'i1', path: 'p1' },
          { id: 'i2', path: 'p2', family: 'v4' as any },
          { id: 'i3', path: 'p3' },
        ],
        tags: ['#a', '#b', '#c'],
        favorite: false,
        createdAt: 0,
        updatedAt: 0,
      },
      { id: 'z', name: '다른작가', images: [], tags: [], favorite: false, createdAt: 1, updatedAt: 1 },
    ];
    svc.tagPresets = ['#x', '#y', '#z'];
  };

  test('이름 변경 되돌림·다시 실행, 중복 이름(서비스가 조용히 무시)은 기록 없음', () => {
    const h = harness();
    seedArtist(h.artists);
    renameArtistRecorded('a', '다른작가', h.opts);
    expect(h.past()).toEqual([]);
    renameArtistRecorded('a', '새이름', h.opts);
    expect(h.past()).toEqual([UNDO_TEXT.artistRename('작가', '새이름')]);
    return (async () => {
      expect(await h.service.undo()).toBe(true);
      expect(h.artists.getArtist('a')!.name).toBe('작가');
      expect(await h.service.redo()).toBe(true);
      expect(h.artists.getArtist('a')!.name).toBe('새이름');
    })();
  });

  test('즐겨찾기 절대값 — 다른 창에서 바뀌면 폐기', async () => {
    const h = harness();
    seedArtist(h.artists);
    toggleArtistFavoriteRecorded('a', h.opts);
    expect(h.artists.getArtist('a')!.favorite).toBe(true);
    expect(await h.service.undo()).toBe(true);
    expect(h.artists.getArtist('a')!.favorite).toBe(false);
    expect(await h.service.redo()).toBe(true);
    h.artists.setFavorite('a', false);
    expect(await h.service.undo()).toBe(false);
  });

  test('대표 썸네일 지정 되돌리면 이미지 순서가 원래 자리 그대로', async () => {
    const h = harness();
    seedArtist(h.artists);
    setArtistThumbnailRecorded('a', 'i3', h.opts);
    expect(h.artists.getArtist('a')!.images.map((i) => i.id)).toEqual(['i3', 'i1', 'i2']);
    expect(await h.service.undo()).toBe(true);
    expect(h.artists.getArtist('a')!.images.map((i) => i.id)).toEqual(['i1', 'i2', 'i3']);
    expect(await h.service.redo()).toBe(true);
    expect(h.artists.getArtist('a')!.images.map((i) => i.id)).toEqual(['i3', 'i1', 'i2']);
    // 이미 첫 이미지면 기록 없음
    setArtistThumbnailRecorded('a', 'i3', h.opts);
    expect(h.past()).toHaveLength(1);
  });

  test('샘플 모델 계열 — 이전 값(없음 포함)으로', async () => {
    const h = harness();
    seedArtist(h.artists);
    setArtistImageFamilyRecorded('a', 'i2', undefined, h.opts);
    expect(h.artists.getArtist('a')!.images[1].family).toBeUndefined();
    expect(await h.service.undo()).toBe(true);
    expect(h.artists.getArtist('a')!.images[1].family).toBe('v4');
    expect(await h.service.redo()).toBe(true);
    expect(h.artists.getArtist('a')!.images[1].family).toBeUndefined();
  });

  test('태그 추가(정규화 라벨)·제거(원래 자리로 복귀)', async () => {
    const h = harness();
    seedArtist(h.artists);
    addArtistTagRecorded('a', ' 러프 ', h.opts);
    expect(h.past()).toEqual([UNDO_TEXT.artistTagAdd('작가', '#러프')]);
    addArtistTagRecorded('a', '#a', h.opts); // 이미 있음 — 기록 없음
    expect(h.past()).toHaveLength(1);
    removeArtistTagRecorded('a', '#b', h.opts);
    expect(h.artists.getArtist('a')!.tags).toEqual(['#a', '#c', '#러프']);
    expect(await h.service.undo()).toBe(true);
    expect(h.artists.getArtist('a')!.tags).toEqual(['#a', '#b', '#c', '#러프']);
    expect(await h.service.undo()).toBe(true);
    expect(h.artists.getArtist('a')!.tags).toEqual(['#a', '#b', '#c']);
    expect(await h.service.redo()).toBe(true);
    h.artists.addTag('a', '#q'); // 다른 창
    expect(await h.service.redo()).toBe(false);
  });

  test('태그 프리셋 추가·제거 되돌림(원래 자리)', async () => {
    const h = harness();
    seedArtist(h.artists);
    removeArtistTagPresetRecorded('#y', h.opts);
    addArtistTagPresetRecorded('w', h.opts);
    expect(h.past()).toEqual([UNDO_TEXT.artistTagPresetRemove('#y'), UNDO_TEXT.artistTagPresetAdd('#w')]);
    expect(await h.service.undo()).toBe(true);
    expect(await h.service.undo()).toBe(true);
    expect(h.artists.tagPresets).toEqual(['#x', '#y', '#z']);
    expect(await h.service.redo()).toBe(true);
    expect(h.artists.tagPresets).toEqual(['#x', '#z']);
  });
});

describe('내보내기 프리셋', () => {
  test('삭제 → 되돌리면 같은 자리에 같은 내용, 다시 실행하면 다시 삭제', async () => {
    const h = harness();
    h.exportStore.list = [{ name: 'A', opt: 'original' }, { name: 'B', opt: 'lossy', imageSize: 1024 }, { name: 'C' }];
    const updated = h.exportStore.list.filter((_, i) => i !== 1);
    saveExportPresetsRecorded(updated, UNDO_TEXT.exportPresetDelete('B'), h.opts);
    expect(h.exportStore.list.map((p) => p.name)).toEqual(['A', 'C']);
    expect(h.past()).toEqual([UNDO_TEXT.exportPresetDelete('B')]);
    expect(await h.service.undo()).toBe(true);
    expect(h.exportStore.list).toEqual([{ name: 'A', opt: 'original' }, { name: 'B', opt: 'lossy', imageSize: 1024 }, { name: 'C' }]);
    // 되살린 목록은 새 배열(열린 관리 창이 「이 창 저장 아님」으로 알아본다)
    expect(h.exportStore.list).not.toBe(updated);
    expect(await h.service.redo()).toBe(true);
    expect(h.exportStore.list.map((p) => p.name)).toEqual(['A', 'C']);
  });

  test('같은 내용 저장은 기록 없음, 다른 창 저장 뒤에는 폐기', async () => {
    const h = harness();
    h.exportStore.list = [{ name: 'A' }];
    saveExportPresetsRecorded([{ name: 'A' }], UNDO_TEXT.exportPresetSave('A'), h.opts);
    expect(h.past()).toEqual([]);
    saveExportPresetsRecorded([{ name: 'A' }, { name: 'B' }], UNDO_TEXT.exportPresetAdd('B'), h.opts);
    h.exportStore.list = [{ name: 'A' }, { name: 'B' }, { name: 'C' }];
    expect(await h.service.undo()).toBe(false);
    expect(h.lastToast()).toBe(UNDO_TEXT.undoFailed(UNDO_TEXT.exportPresetsChanged));
  });
});

describe('프로젝트 템플릿', () => {
  test('이름 변경 되돌림·다시 실행', async () => {
    const h = harness();
    const t = await h.templates.create('템플릿');
    await renameTemplateRecorded(t.id, '새 템플릿', h.opts);
    expect(h.past()).toEqual([UNDO_TEXT.templateRename('템플릿', '새 템플릿')]);
    expect(await h.service.undo()).toBe(true);
    expect(h.templates.get(t.id)!.name).toBe('템플릿');
    expect(await h.service.redo()).toBe(true);
    expect(h.templates.get(t.id)!.name).toBe('새 템플릿');
  });

  test('배지 색 연속 클릭(1초 안) = 한 항목, 처음 색으로 돌아오면 항목 삭제, 다른 창 변경이면 폐기', async () => {
    const h = harness();
    const t = await h.templates.create('T');
    await setTemplateBadgeColorRecorded(t.id, '#f00', h.opts);
    h.clock.t += 200;
    await setTemplateBadgeColorRecorded(t.id, '#0f0', h.opts);
    expect(h.past()).toEqual([UNDO_TEXT.templateBadgeColor('T')]);
    expect(await h.service.undo()).toBe(true);
    expect(h.templates.get(t.id)!.badgeColor).toBeUndefined();
    expect(await h.service.redo()).toBe(true);
    expect(h.templates.get(t.id)!.badgeColor).toBe('#0f0');
    h.clock.t += 5000;
    await setTemplateBadgeColorRecorded(t.id, '#00f', h.opts);
    h.clock.t += 100;
    await setTemplateBadgeColorRecorded(t.id, '#0f0', h.opts);
    expect(h.past()).toHaveLength(1);
    await h.templates.setBadgeColor(t.id, '#123'); // 다른 창
    expect(await h.service.undo()).toBe(false);
  });
});

describe('전역 스택', () => {
  test('프로젝트가 없어도 기록·실행되고 서로 다른 라이브러리 작업이 역순으로 되돌아간다', async () => {
    const h = harness();
    seedChars(h.chars, [{ id: 'a', name: 'A' }]);
    h.exportStore.list = [];
    await renameGlobalCharacterRecorded('a', 'B', h.opts);
    saveExportPresetsRecorded([{ name: 'E' }], UNDO_TEXT.exportPresetAdd('E'), h.opts);
    expect(h.service.canUndoFor(undefined)).toBe(true);
    expect(await h.service.undo()).toBe(true);
    expect(h.exportStore.list).toEqual([]);
    expect(h.chars.get('a')!.name).toBe('B');
    expect(await h.service.undo()).toBe(true);
    expect(h.chars.get('a')!.name).toBe('A');
  });
});
