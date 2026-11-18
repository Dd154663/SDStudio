// 글로벌 프리셋·글로벌 캐릭터 삭제 되돌리기(2026-11-18 프리셋 유실 조사 경로 7·8 — globalLibraryDeleteUndo.ts).
//  · 한 건 삭제 → 되돌림 = 같은 id·내용·자리 + 이미지 파일 내용 복귀 → 다시 실행 = 다시 삭제(파일도)
//  · 선택 여러 건 = 한 항목(원래 순서로 복귀) · 글로벌 캐릭터 폴더(있으면 그 폴더, 그사이 지워졌으면 미분류)
//  · 같은 이미지 파일을 다른 항목이 쓰면 지우지도 덮지도 않음 · 막힌 저장소는 거부 · 다른 창이 같은 id 를 만들면 덮지 않음
//  · 지원하지 않는 종류의 보존분(heldEntries)은 삭제·복원 뒤에도 그대로 · 정리 뒤 찌꺼기 파일 없음 · 이미지 보관 한도
// 메모리 backend 목 — 실제 사용자 데이터 폴더는 건드리지 않는다.

const files = new Map<string, string>();
const enoent = (p: string) =>
  new Error(`Error invoking remote method 'read-file': Error: ENOENT: no such file or directory, open '${p}'`);
const backend = {
  readFile: jest.fn(async (p: string) => {
    if (!files.has(p)) throw enoent(p);
    return files.get(p)!;
  }),
  renameFile: jest.fn(async (a: string, b: string) => {
    if (!files.has(a)) throw enoent(a);
    files.set(b, files.get(a)!);
    files.delete(a);
  }),
  copyFile: jest.fn(async (a: string, b: string) => {
    if (!files.has(a)) throw enoent(a);
    files.set(b, files.get(a)!);
  }),
  existFile: jest.fn(async (p: string) => files.has(p)),
  // 이미지 파일은 data URI 로 읽힌다(Electron read-data-file 과 같음)
  readDataFile: jest.fn(async (p: string) => (files.has(p) ? `data:image/png;base64,${files.get(p)}` : null)),
  writeDataFile: jest.fn(async (p: string, b64: string) => {
    files.set(p, b64);
  }),
  deleteFile: jest.fn(async (p: string) => {
    files.delete(p);
  }),
  notifyGlobalStoreChanged: jest.fn(async () => {}),
};
const write = jest.fn(async (p: string, d: string) => {
  files.set(p, d);
});

jest.mock('..', () => ({
  backend,
  imageService: {},
  workFlowService: {},
  sessionService: {},
  globalPresetService: {},
  globalCharacterPresetService: {},
}));
jest.mock('../PersistenceService', () => ({ persistService: { write } }));
jest.mock('../appStateRef', () => ({ getAppState: () => ({ pushMessage: jest.fn() }) }));
jest.mock('../SessionService', () => ({
  readJSONFromPNG: () => undefined,
  embedJSONInPNG: () => '',
  normalizePresetJson: (j: any) => j,
  createImageWithText: () => '',
}));
jest.mock('../util', () => ({ extractPromptDataFromBase64: async () => undefined }));
jest.mock('../presetExportDecoration', () => ({ decoratePresetExportImage: async (x: any) => x }));
jest.mock('../sdstudioPromptImport', () => ({
  planPromptImport: () => ({ frontPrompt: '', backPrompt: '' }),
}));
jest.mock('../types', () => ({
  VibeItem: { fromJSON: (j: any) => j },
  ReferenceItem: { fromJSON: (j: any) => j },
  CharacterPreset: { fromJSON: (j: any) => ({ ...j, toJSON: () => JSON.parse(JSON.stringify(j)) }) },
  Session: class {},
}));
jest.mock('../ImageService', () => ({
  dataUriToBase64: (s: string) => (s.includes(',') ? s.split(',')[1] : s),
}));

import { GLOBAL_UNDO_SCOPE, UNDO_TEXT, UndoService } from '../undoService';
import { GlobalPresetService } from '../GlobalPresetService';
import { GlobalCharacterPresetService } from '../GlobalCharacterPresetService';
import {
  GLOBAL_DELETE_UNDO_LIMITS,
  GlobalDeleteOps,
  globalCharacterMetaOf,
  globalDeleteHeldChars,
  prepareGlobalDelete,
  resetGlobalDeleteUndoState,
} from '../globalLibraryDeleteUndo';
import { deleteConfirmText } from '../deleteFlowRules';

const GP = 'global_presets.json';
const GC = 'global_character_presets.json';
const vibe = (f: string) => `global_vibes/${f}`;
const charImg = (f: string) => `global_char_images/${f}`;

const preset = (id: string, name: string, profile?: string, workflowType = 'SDImageGen') => ({
  id,
  name,
  workflowType,
  isDefault: false,
  createdAt: 1,
  updatedAt: 1,
  ...(profile ? { profile } : {}),
  preset: { frontPrompt: `${name} 프롬프트`, nested: { deep: [1, 2] } },
});
const character = (id: string, name: string, imgs: { vibe?: string; ref?: string; rep?: string } = {}, folder?: string) => ({
  id,
  name,
  createdAt: 1,
  updatedAt: 1,
  ...(folder ? { folder } : {}),
  preset: {
    name,
    vibes: imgs.vibe ? [{ path: imgs.vibe, info: 0.5, strength: 0.6 }] : [],
    characterReferences: imgs.ref ? [{ path: imgs.ref }] : [],
    representativeImage: imgs.rep ?? '',
    characterPrompt: `${name} 프롬프트`,
  },
});

function harness() {
  const toast = jest.fn();
  const service = new UndoService({
    curSession: () => undefined,
    isMirror: () => false,
    toast,
    now: () => 1000,
    confirm: async () => true,
  });
  const gp = new GlobalPresetService();
  const gc = new GlobalCharacterPresetService();
  const presetOps: GlobalDeleteOps<any> = {
    isBlocked: () => gp.loadFailed,
    list: () => gp.list(),
    get: (id) => gp.get(id),
    imageTokens: (e) => gp.imageTokensOf(e),
    fetchImage: (t) => gp.fetchProfileImage(t),
    delete: (id) => gp.delete(id),
    restoreDeleted: (e, at, images) => gp.restoreDeletedEntry(e, at, images),
    label: (n) => UNDO_TEXT.globalPresetDelete(n),
    gone: (n) => UNDO_TEXT.globalPresetGone(n),
    changed: (n) => UNDO_TEXT.globalPresetChanged(n),
  };
  const charOps: GlobalDeleteOps<any, any> = {
    isBlocked: () => gc.loadFailed,
    list: () => gc.list(),
    get: (id) => gc.get(id),
    imageTokens: (e) => gc.imageTokensOf(e),
    fetchImage: (t) => gc.fetchImageData(t),
    delete: (id) => gc.delete(id),
    captureMeta: (e, deleting) => globalCharacterMetaOf(gc, e, deleting),
    restoreDeleted: (e, at, images, meta) => gc.restoreDeletedEntry(e, at, images, !!meta?.keepMissingFolder),
    label: (n) => UNDO_TEXT.globalCharacterDelete(n),
    gone: (n) => UNDO_TEXT.globalCharacterGone(n),
    changed: (n) => UNDO_TEXT.globalCharacterChanged(n),
  };
  const past = () => service.entries(GLOBAL_UNDO_SCOPE).past.map((e) => e.label);
  const lastToast = () => toast.mock.calls[toast.mock.calls.length - 1]?.[0] as string;
  return {
    service,
    gp,
    gc,
    past,
    lastToast,
    pOpts: { service, ops: presetOps },
    cOpts: { service, ops: charOps },
  };
}

const ids = (list: { id: string }[]) => list.map((e) => e.id);
const strip = (e: any) => JSON.parse(JSON.stringify(e));
const imageFiles = () => [...files.keys()].filter((k) => k.startsWith('global_vibes/') || k.startsWith('global_char_images/')).sort();

beforeEach(() => {
  files.clear();
  jest.clearAllMocks();
  resetGlobalDeleteUndoState();
});

describe('글로벌 프리셋 삭제 되돌리기', () => {
  test('한 건: 삭제 → 되돌림(같은 id·내용·자리·이미지) → 다시 실행(다시 삭제·파일도)', async () => {
    const h = harness();
    files.set(GP, JSON.stringify({ version: 2, presets: [preset('a', 'A', 'a.png'), preset('b', 'B', 'b.png'), preset('c', 'C')] }));
    files.set(vibe('a.png'), 'AAA');
    files.set(vibe('b.png'), 'BBB');
    await h.gp.load();
    const before = strip(h.gp.get('b'));

    const plan = await prepareGlobalDelete('presets', ['b'], h.pOpts);
    expect(plan.undoable).toBe(true);
    const r = await plan.run();
    expect(r).toMatchObject({ deleted: ['B'], failed: [], recorded: true });
    expect(ids(h.gp.list())).toEqual(['a', 'c']);
    expect(files.has(vibe('b.png'))).toBe(false); // 파일은 종전처럼 바로 지운다
    expect(h.past()).toEqual([UNDO_TEXT.globalPresetDelete(['B'])]);

    await h.service.undo();
    expect(ids(h.gp.list())).toEqual(['a', 'b', 'c']);
    expect(strip(h.gp.get('b'))).toEqual(before);
    expect(files.get(vibe('b.png'))).toBe('BBB');
    expect(await h.gp.fetchProfileImage('b.png')).toBe('data:image/png;base64,BBB');

    await h.service.redo();
    expect(ids(h.gp.list())).toEqual(['a', 'c']);
    expect(files.has(vibe('b.png'))).toBe(false);
    // 다시 되돌려도 같다(보관한 내용은 기록이 살아 있는 동안 유지)
    await h.service.undo();
    expect(strip(h.gp.get('b'))).toEqual(before);
    expect(files.get(vibe('b.png'))).toBe('BBB');
    // 저장(dirty) — 되살린 항목이 저장 대상
    await h.gp.flushSave();
    expect(JSON.parse(files.get(GP)!).presets.map((p: any) => p.id)).toEqual(['a', 'b', 'c']);
  });

  test('선택 여러 건 = 한 항목, 원래 순서로 돌아온다', async () => {
    const h = harness();
    files.set(GP, JSON.stringify({ version: 2, presets: ['a', 'b', 'c', 'd'].map((x) => preset(x, x.toUpperCase(), `${x}.png`)) }));
    for (const x of ['a', 'b', 'c', 'd']) files.set(vibe(`${x}.png`), x.repeat(3));
    await h.gp.load();
    const plan = await prepareGlobalDelete('presets', ['d', 'a', 'c'], h.pOpts);
    await plan.run();
    expect(ids(h.gp.list())).toEqual(['b']);
    expect(h.past()).toEqual([UNDO_TEXT.globalPresetDelete(['D', 'A', 'C'])]);
    expect(imageFiles()).toEqual([vibe('b.png')]);
    await h.service.undo();
    expect(ids(h.gp.list())).toEqual(['a', 'b', 'c', 'd']);
    expect(imageFiles()).toEqual(['a', 'b', 'c', 'd'].map((x) => vibe(`${x}.png`)));
    await h.service.redo();
    expect(ids(h.gp.list())).toEqual(['b']);
    expect(imageFiles()).toEqual([vibe('b.png')]); // 찌꺼기 없음
  });

  test('같은 이미지 파일을 다른 항목이 쓰면 지우지도 덮지도 않는다', async () => {
    const h = harness();
    files.set(GP, JSON.stringify({ version: 2, presets: [preset('a', 'A', 'same.png'), preset('b', 'B', 'same.png')] }));
    files.set(vibe('same.png'), 'SAME');
    await h.gp.load();
    await (await prepareGlobalDelete('presets', ['a'], h.pOpts)).run();
    expect(files.get(vibe('same.png'))).toBe('SAME');
    backend.writeDataFile.mockClear();
    await h.service.undo();
    expect(backend.writeDataFile).not.toHaveBeenCalled();
    expect(ids(h.gp.list())).toEqual(['a', 'b']);
  });

  test('다른 창이 같은 id 를 다시 만든 뒤 되돌림 → 덮지 않고 안내, 이름이 겹치면 「X (2)」', async () => {
    const h = harness();
    files.set(GP, JSON.stringify({ version: 2, presets: [preset('a', 'A', 'a.png'), preset('b', 'B')] }));
    files.set(vibe('a.png'), 'AAA');
    await h.gp.load();
    await (await prepareGlobalDelete('presets', ['a', 'b'], h.pOpts)).run();
    await h.gp.flushSave(); // 이 창의 삭제가 저장된 뒤
    // 다른 창이 a 를 같은 id 로 다시 만들고(불러오기 등) 새 항목 「B」를 만든 상황 — 다른 창 저장 알림으로 다시 읽음
    files.set(GP, JSON.stringify({ version: 2, presets: [{ ...preset('a', 'A 새것'), preset: { frontPrompt: '다른 창' } }, preset('x', 'B')] }));
    await h.gp.reloadExternal();
    await h.service.undo();
    expect(h.gp.get('a')!.name).toBe('A 새것'); // 덮지 않음
    expect(h.gp.get('a')!.preset).toEqual({ frontPrompt: '다른 창' });
    expect(h.gp.get('b')!.name).toBe('B (2)');
    expect(h.lastToast()).toContain(UNDO_TEXT.globalDeleteIdTaken('A'));
    // 덮지 않았으므로 a.png 도 다시 쓰지 않는다(새 a 는 이미지 없음 → 찌꺼기 없음)
    expect(files.has(vibe('a.png'))).toBe(false);
  });

  test('다시 실행 직전 그사이 바뀌었으면 지우지 않는다', async () => {
    const h = harness();
    files.set(GP, JSON.stringify({ version: 2, presets: [preset('a', 'A')] }));
    await h.gp.load();
    await (await prepareGlobalDelete('presets', ['a'], h.pOpts)).run();
    await h.service.undo();
    await h.gp.updatePreset('a', { frontPrompt: '고침' });
    await h.service.redo();
    expect(h.gp.get('a')).toBeDefined();
    expect(h.lastToast()).toContain(UNDO_TEXT.globalPresetChanged('A'));
  });

  test('지원하지 않는 종류의 보존분은 삭제·복원 뒤에도 그대로', async () => {
    const h = harness();
    const future = { id: 'f', name: '미래', workflowType: 'SDFuture', extra: { k: 1 } };
    files.set(GP, JSON.stringify({ version: 2, presets: [preset('a', 'A'), future, preset('b', 'B')] }));
    await h.gp.load();
    await (await prepareGlobalDelete('presets', ['a'], h.pOpts)).run();
    await h.gp.flushSave();
    expect(JSON.parse(files.get(GP)!).presets).toContainEqual(future);
    await h.service.undo();
    await h.gp.flushSave();
    const saved = JSON.parse(files.get(GP)!).presets;
    expect(saved.map((p: any) => p.id)).toEqual(['a', 'f', 'b']);
    expect(saved[1]).toEqual(future);
  });

  test('막힌 저장소에서는 거부(되돌림·삭제 모두)', async () => {
    const h = harness();
    files.set(GP, JSON.stringify({ version: 2, presets: [preset('a', 'A')] }));
    await h.gp.load();
    await (await prepareGlobalDelete('presets', ['a'], h.pOpts)).run();
    (h.gp as any).store.status = 'blocked'; // 읽기 실패 차단 상태 흉내
    expect(await h.service.undo()).toBe(false);
    expect(h.gp.get('a')).toBeUndefined();
    expect(h.lastToast()).toContain(UNDO_TEXT.globalStoreBlocked);
    // 막힌 동안의 삭제 준비는 기록 불가 → 영구 문구, 실행은 서비스가 거부
    const plan = await prepareGlobalDelete('presets', ['a'], h.pOpts);
    expect(plan.undoable).toBe(false);
    await expect(h.gp.restoreDeletedEntry(preset('z', 'Z') as any, 0, new Map())).rejects.toThrow();
  });

  test('이미지 보관 한도: 한 번에 넘으면 기록하지 않음(영구 문구), 합계가 넘으면 오래된 기록부터 비움', async () => {
    const h = harness();
    const saved = { ...GLOBAL_DELETE_UNDO_LIMITS };
    GLOBAL_DELETE_UNDO_LIMITS.perDeleteChars = 100;
    GLOBAL_DELETE_UNDO_LIMITS.totalChars = 150;
    try {
      files.set(GP, JSON.stringify({ version: 2, presets: ['a', 'b', 'c', 'd'].map((x) => preset(x, x, `${x}.png`)) }));
      for (const x of ['a', 'b', 'c', 'd']) files.set(vibe(`${x}.png`), x.repeat(40)); // data URI ≈ 62자
      await h.gp.load();
      const big = await prepareGlobalDelete('presets', ['a', 'b'], h.pOpts); // 약 124자 > 100
      expect(big.undoable).toBe(false);
      expect(deleteConfirmText({ kind: 'globalPreset', count: 2, outcome: big.undoable ? 'undoable' : 'permanent' }).text).toContain('영구 삭제');
      await (await prepareGlobalDelete('presets', ['c'], h.pOpts)).run();
      await (await prepareGlobalDelete('presets', ['d'], h.pOpts)).run();
      await (await prepareGlobalDelete('presets', ['b'], h.pOpts)).run(); // 합계 약 186 > 150 → 「c」 기록의 이미지를 비움
      expect(globalDeleteHeldChars()).toBeLessThanOrEqual(150);
      await h.service.undo(); // b
      await h.service.undo(); // d
      expect(ids(h.gp.list())).toEqual(['a', 'b', 'd']);
      expect(await h.service.undo()).toBe(false); // c — 보관 한도로 비운 기록
      expect(h.lastToast()).toContain(UNDO_TEXT.globalDeleteImagesEvicted);
      expect(h.gp.get('c')).toBeUndefined();
    } finally {
      Object.assign(GLOBAL_DELETE_UNDO_LIMITS, saved);
    }
  });
});

describe('글로벌 캐릭터 프리셋 삭제 되돌리기', () => {
  test('한 건: 폴더·첨부 이미지 3종 복귀 → 다시 실행 = 다시 삭제(찌꺼기 없음)', async () => {
    const h = harness();
    files.set(
      GC,
      JSON.stringify({
        version: 1,
        presets: [character('a', '앨리스', {}, 'F1'), character('b', '밥', { vibe: 'v.png', ref: 'r.png', rep: 'p.png' }, 'F1')],
        folders: ['F1'],
      }),
    );
    files.set(charImg('v.png'), 'V');
    files.set(charImg('r.png'), 'R');
    files.set(charImg('p.png'), 'P');
    await h.gc.load();
    const before = strip(h.gc.get('b'));
    await (await prepareGlobalDelete('characters', ['b'], h.cOpts)).run();
    expect(imageFiles()).toEqual([]);
    await h.service.undo();
    expect(strip(h.gc.get('b'))).toEqual(before);
    expect(ids(h.gc.list())).toEqual(['a', 'b']);
    expect(imageFiles()).toEqual([charImg('p.png'), charImg('r.png'), charImg('v.png')]);
    expect(files.get(charImg('v.png'))).toBe('V');
    await h.service.redo();
    expect(h.gc.get('b')).toBeUndefined();
    expect(imageFiles()).toEqual([]);
  });

  test('그사이 등록 폴더가 지워졌으면 미분류로, 이 삭제로만 사라진 파생 폴더는 그대로 되살림', async () => {
    const h = harness();
    files.set(
      GC,
      JSON.stringify({
        version: 1,
        presets: [character('a', 'A', {}, 'Reg'), character('b', 'B', {}, 'Derived'), character('c', 'C', {}, 'Derived')],
        folders: ['Reg'],
      }),
    );
    await h.gc.load();
    await (await prepareGlobalDelete('characters', ['a', 'b', 'c'], h.cOpts)).run();
    expect(h.gc.listFolders()).toEqual(['Reg']);
    await h.gc.deleteFolder('Reg');
    await h.service.undo();
    expect(h.gc.get('a')!.folder).toBeUndefined();
    expect(h.gc.get('b')!.folder).toBe('Derived');
    expect(h.gc.get('c')!.folder).toBe('Derived');
  });

  test('복제본이 같은 이미지 파일을 쓰면 지우지 않고, 되돌릴 때 덮지 않는다', async () => {
    const h = harness();
    files.set(
      GC,
      JSON.stringify({
        version: 1,
        presets: [character('a', 'A', { vibe: 'shared.png' }), character('b', 'A 복사본', { vibe: 'shared.png' })],
        folders: [],
      }),
    );
    files.set(charImg('shared.png'), 'S');
    await h.gc.load();
    await (await prepareGlobalDelete('characters', ['a'], h.cOpts)).run();
    expect(files.get(charImg('shared.png'))).toBe('S');
    backend.writeDataFile.mockClear();
    await h.service.undo();
    expect(backend.writeDataFile).not.toHaveBeenCalled();
    // 둘 다 지우면 마지막 것이 지울 때 파일이 사라지고, 되돌리면 한 번만 다시 쓴다
    await (await prepareGlobalDelete('characters', ['a', 'b'], h.cOpts)).run();
    expect(imageFiles()).toEqual([]);
    await h.service.undo();
    expect(imageFiles()).toEqual([charImg('shared.png')]);
    expect(ids(h.gc.list())).toEqual(['a', 'b']);
  });

  test('되살리는 중 다른 창이 같은 id 를 만들었으면 방금 쓴 파일을 거두고 덮지 않는다', async () => {
    const h = harness();
    files.set(GC, JSON.stringify({ version: 1, presets: [character('a', 'A', { vibe: 'v.png' })], folders: [] }));
    files.set(charImg('v.png'), 'V');
    await h.gc.load();
    await (await prepareGlobalDelete('characters', ['a'], h.cOpts)).run();
    await h.gc.flushSave(); // 이 창의 삭제가 저장된 뒤
    // writeDataFile 도중 다른 창 재로드가 같은 id(이미지 없음)를 들여온 상황
    backend.writeDataFile.mockImplementationOnce(async (p: string, b64: string) => {
      files.set(p, b64);
      files.set(GC, JSON.stringify({ version: 1, presets: [character('a', '다른 창 A')], folders: [] }));
      await h.gc.reloadExternal();
    });
    await h.service.undo();
    expect(h.gc.get('a')!.name).toBe('다른 창 A');
    expect(imageFiles()).toEqual([]); // 찌꺼기 없음
  });
});
