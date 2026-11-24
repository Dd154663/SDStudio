// 글로벌 프리셋·글로벌 캐릭터 삭제 되돌리기(2026-11-18 프리셋 유실 조사 경로 7·8 — globalLibraryDeleteUndo.ts).
// 2026-11-24 휴지통: 삭제 = 같은 저장소 파일의 휴지통으로 이동(이미지 파일은 남김), 되돌림 = 휴지통에서 복원, 다시 실행 = 다시 휴지통으로.
//  · 한 건 삭제 → 되돌림 = 같은 id·내용·자리 → 다시 실행 = 다시 휴지통(파일은 계속 남음)
//  · 선택 여러 건 = 한 항목(원래 순서로 복귀) · 글로벌 캐릭터 폴더(있으면 그 폴더, 그사이 지워졌으면 미분류)
//  · 막힌 저장소는 거부 · 다른 창이 같은 id 를 만들면 덮지 않음 · 그사이 휴지통에서 영구 삭제됐으면 실패 안내
//  · 지원하지 않는 종류의 보존분(heldEntries)은 삭제·복원 뒤에도 그대로 · 큰 이미지도 한도 없이 기록(종전 16MB 갈래 없음)
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
import { GlobalDeleteOps, globalCharacterMetaOf, prepareGlobalDelete } from '../globalLibraryDeleteUndo';

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
    delete: (id) => gp.delete(id),
    inTrash: (id) => !!gp.getTrashItem(id),
    restoreFromTrash: (id, at) => gp.restoreFromTrash(id, at),
    label: (n) => UNDO_TEXT.globalPresetDelete(n),
    gone: (n) => UNDO_TEXT.globalPresetGone(n),
    changed: (n) => UNDO_TEXT.globalPresetChanged(n),
  };
  const charOps: GlobalDeleteOps<any, any> = {
    isBlocked: () => gc.loadFailed,
    list: () => gc.list(),
    get: (id) => gc.get(id),
    delete: (id) => gc.delete(id),
    inTrash: (id) => !!gc.getTrashItem(id),
    captureMeta: (e, deleting) => globalCharacterMetaOf(gc, e, deleting),
    restoreFromTrash: (id, at, meta) => gc.restoreFromTrash(id, at, !!meta?.keepMissingFolder),
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
});

describe('글로벌 프리셋 삭제 되돌리기', () => {
  test('한 건: 삭제(= 휴지통) → 되돌림(같은 id·내용·자리) → 다시 실행(다시 휴지통) — 이미지 파일은 계속 남는다', async () => {
    const h = harness();
    files.set(GP, JSON.stringify({ version: 2, presets: [preset('a', 'A', 'a.png'), preset('b', 'B', 'b.png'), preset('c', 'C')] }));
    files.set(vibe('a.png'), 'AAA');
    files.set(vibe('b.png'), 'BBB');
    await h.gp.load();
    const before = strip(h.gp.get('b'));

    const plan = await prepareGlobalDelete('presets', ['b'], h.pOpts);
    const r = await plan.run();
    expect(r).toMatchObject({ deleted: ['B'], failed: [], recorded: true });
    expect(ids(h.gp.list())).toEqual(['a', 'c']);
    expect(h.gp.trash.map((t) => t.entry.id)).toEqual(['b']);
    expect(files.get(vibe('b.png'))).toBe('BBB'); // 휴지통 이동은 파일을 지우지 않는다
    expect(h.past()).toEqual([UNDO_TEXT.globalPresetDelete(['B'])]);

    await h.service.undo();
    expect(ids(h.gp.list())).toEqual(['a', 'b', 'c']);
    expect(strip(h.gp.get('b'))).toEqual(before);
    expect(h.gp.trash).toEqual([]);
    expect(await h.gp.fetchProfileImage('b.png')).toBe('data:image/png;base64,BBB');

    await h.service.redo();
    expect(ids(h.gp.list())).toEqual(['a', 'c']);
    expect(h.gp.trash.map((t) => t.entry.id)).toEqual(['b']);
    expect(files.get(vibe('b.png'))).toBe('BBB');
    await h.service.undo();
    expect(strip(h.gp.get('b'))).toEqual(before);
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
    const all = ['a', 'b', 'c', 'd'].map((x) => vibe(`${x}.png`));
    expect(imageFiles()).toEqual(all); // 휴지통에 있는 동안 파일은 그대로
    await h.service.undo();
    expect(ids(h.gp.list())).toEqual(['a', 'b', 'c', 'd']);
    expect(imageFiles()).toEqual(all);
    await h.service.redo();
    expect(ids(h.gp.list())).toEqual(['b']);
    expect(h.gp.trash.map((t) => t.entry.id).sort()).toEqual(['a', 'c', 'd']);
  });

  test('같은 이미지 파일을 다른 항목이 써도 삭제·되돌림이 파일을 쓰거나 지우지 않는다', async () => {
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
    const saved = JSON.parse(files.get(GP)!);
    // 다른 창이 a 를 같은 id 로 다시 만들고(불러오기 등) 새 항목 「B」를 만든 상황 — 다른 창 저장 알림으로 다시 읽음.
    // 다른 창의 파일에도 휴지통(a·b)은 그대로 실려 있다 — 목록에 다시 생긴 a 는 목록 우선 규칙으로 휴지통에서 빠진다
    files.set(
      GP,
      JSON.stringify({
        version: 2,
        presets: [{ ...preset('a', 'A 새것'), preset: { frontPrompt: '다른 창' } }, preset('x', 'B')],
        trash: saved.trash,
      }),
    );
    await h.gp.reloadExternal();
    expect(h.gp.trash.map((t) => t.entry.id)).toEqual(['b']);
    await h.service.undo();
    expect(h.gp.get('a')!.name).toBe('A 새것'); // 덮지 않음
    expect(h.gp.get('a')!.preset).toEqual({ frontPrompt: '다른 창' });
    expect(h.gp.get('b')!.name).toBe('B (2)');
    expect(h.lastToast()).toContain(UNDO_TEXT.globalDeleteIdTaken('A'));
  });

  test('그사이 휴지통에서 영구 삭제됐으면 되돌림이 조용히 넘어가지 않고 실패를 알린다', async () => {
    const h = harness();
    files.set(GP, JSON.stringify({ version: 2, presets: [preset('a', 'A', 'a.png'), preset('b', 'B')] }));
    files.set(vibe('a.png'), 'AAA');
    await h.gp.load();
    await (await prepareGlobalDelete('presets', ['a'], h.pOpts)).run();
    await h.gp.purgeFromTrash(['a']);
    expect(files.has(vibe('a.png'))).toBe(false);
    expect(await h.service.undo()).toBe(false);
    expect(h.lastToast()).toContain(UNDO_TEXT.globalDeleteTrashGone('A'));
    expect(h.gp.get('a')).toBeUndefined();
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
    // 막힌 동안에는 휴지통 복원·삭제 모두 서비스가 거부
    await expect(h.gp.restoreFromTrash('a')).rejects.toThrow();
  });

  test('큰 이미지(종전 16MB 한도를 넘는 크기)도 휴지통으로 가고 기록된다 — 메모리에 내용을 담지 않는다', async () => {
    const h = harness();
    files.set(GP, JSON.stringify({ version: 2, presets: ['a', 'b'].map((x) => preset(x, x, `${x}.png`)) }));
    const big = 'x'.repeat(17 * 1024 * 1024);
    files.set(vibe('a.png'), big);
    files.set(vibe('b.png'), big);
    await h.gp.load();
    backend.readDataFile.mockClear();
    const r = await (await prepareGlobalDelete('presets', ['a', 'b'], h.pOpts)).run();
    expect(r.recorded).toBe(true);
    expect(backend.readDataFile).not.toHaveBeenCalled(); // 이미지 내용을 읽지 않는다
    await h.service.undo();
    expect(ids(h.gp.list())).toEqual(['a', 'b']);
  });
});

describe('글로벌 캐릭터 프리셋 삭제 되돌리기', () => {
  test('한 건: 폴더·첨부 이미지 3종 그대로 복귀 → 다시 실행 = 다시 휴지통(파일은 남음)', async () => {
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
    const imgs = [charImg('p.png'), charImg('r.png'), charImg('v.png')];
    await (await prepareGlobalDelete('characters', ['b'], h.cOpts)).run();
    expect(imageFiles()).toEqual(imgs);
    expect(h.gc.trash.map((t) => t.entry.id)).toEqual(['b']);
    expect(h.gc.trash[0].entry.folder).toBe('F1'); // 원래 폴더 정보
    await h.service.undo();
    expect(strip(h.gc.get('b'))).toEqual(before);
    expect(ids(h.gc.list())).toEqual(['a', 'b']);
    expect(imageFiles()).toEqual(imgs);
    expect(files.get(charImg('v.png'))).toBe('V');
    await h.service.redo();
    expect(h.gc.get('b')).toBeUndefined();
    expect(imageFiles()).toEqual(imgs);
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

  test('복제본이 같은 이미지 파일을 써도 삭제·되돌림이 파일을 쓰거나 지우지 않는다', async () => {
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
    // 둘 다 지워도 휴지통에 있는 동안 파일은 남는다
    await (await prepareGlobalDelete('characters', ['a', 'b'], h.cOpts)).run();
    expect(imageFiles()).toEqual([charImg('shared.png')]);
    await h.service.undo();
    expect(imageFiles()).toEqual([charImg('shared.png')]);
    expect(ids(h.gc.list())).toEqual(['a', 'b']);
  });

  test('되살리는 중(파일 확인 await) 다른 창이 같은 id 를 들여왔으면 덮지 않는다', async () => {
    const h = harness();
    files.set(GC, JSON.stringify({ version: 1, presets: [character('a', 'A', { vibe: 'v.png' })], folders: [] }));
    files.set(charImg('v.png'), 'V');
    await h.gc.load();
    await (await prepareGlobalDelete('characters', ['a'], h.cOpts)).run();
    await h.gc.flushSave(); // 이 창의 삭제가 저장된 뒤
    // 복원 중 이미지 존재 확인 도중 다른 창 재로드가 같은 id 를 들여온 상황(휴지통은 그대로)
    const saved = JSON.parse(files.get(GC)!);
    backend.existFile.mockImplementationOnce(async (p: string) => {
      files.set(GC, JSON.stringify({ version: 1, presets: [character('a', '다른 창 A')], folders: [], trash: saved.trash }));
      await h.gc.reloadExternal();
      return files.has(p);
    });
    await h.service.undo();
    expect(h.gc.get('a')!.name).toBe('다른 창 A');
    expect(h.gc.list()).toHaveLength(1);
    expect(h.gc.trash).toEqual([]); // 목록 우선 — 휴지통 쪽은 버림
  });
});
