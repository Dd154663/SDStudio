// 글로벌 프리셋·글로벌 캐릭터 프리셋 휴지통(2026-11-24 — globalLibraryTrash.ts·GlobalPresetService·GlobalCharacterPresetService).
//  (a) 삭제 = 휴지통 이동(파일 유지·한 번의 저장·dirty)  (b) 복원(이름 겹침·폴더 없음·이미지 없음)
//  (c) 영구 삭제는 목록·휴지통 어디에서도 참조하지 않는 파일만  (d) 만료 정리(30일, 읽기 실패·사본 복구 상태에서는 무동작)
//  (e) 휴지통 필드 없는 옛 파일 읽기·다시 저장, 휴지통 있는 파일 왕복  (f) 여러 창 병합(같은 id 는 목록 우선)
//  (h) 항목 단위 백업에 휴지통이 안 실림, 백업 불러오기가 휴지통을 건드리지 않음(덮어쓰기 = 기존 항목 휴지통)
// 메모리 backend 목 — 실제 사용자 데이터 폴더는 건드리지 않는다.

const files = new Map<string, string>();
const enoent = (p: string) =>
  new Error(`Error invoking remote method 'read-file': Error: ENOENT: no such file or directory, open '${p}'`);
const backend = {
  readFile: jest.fn(async (p: string) => {
    if (!files.has(p)) throw enoent(p);
    return files.get(p)!;
  }),
  writeFile: jest.fn(async (p: string, d: string) => {
    files.set(p, d);
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

import { GlobalPresetService } from '../GlobalPresetService';
import { GlobalCharacterPresetService } from '../GlobalCharacterPresetService';
import {
  GLOBAL_LIBRARY_TRASH_DAYS,
  GLOBAL_LIBRARY_TRASH_MS,
  GLOBAL_TRASH_TEXT,
  dropListedFromTrash,
  mergeTrash,
  splitTrashField,
  trashDaysLeft,
  unreferencedTokens,
} from '../globalLibraryTrash';
import { deleteConfirmText } from '../deleteFlowRules';
import { IMPORT_FLOW_TEXT } from '../importFlow';

const GP = 'global_presets.json';
const GC = 'global_character_presets.json';
const vibe = (f: string) => `global_vibes/${f}`;
const charImg = (f: string) => `global_char_images/${f}`;
const DAY = 24 * 60 * 60 * 1000;

const preset = (id: string, name: string, profile?: string, workflowType = 'SDImageGen') => ({
  id,
  name,
  workflowType,
  isDefault: false,
  createdAt: 1,
  updatedAt: 1,
  ...(profile ? { profile } : {}),
  preset: { frontPrompt: `${name} 프롬프트` },
});
const character = (id: string, name: string, imgs: { vibe?: string; rep?: string } = {}, folder?: string) => ({
  id,
  name,
  createdAt: 1,
  updatedAt: 1,
  ...(folder ? { folder } : {}),
  preset: {
    name,
    vibes: imgs.vibe ? [{ path: imgs.vibe, info: 0.5, strength: 0.6 }] : [],
    characterReferences: [],
    representativeImage: imgs.rep ?? '',
  },
});
const ids = (list: { id: string }[]) => list.map((e) => e.id);
const trashIds = (svc: { trash: { entry: { id: string } }[] }) => svc.trash.map((t) => t.entry.id);
const saved = (p: string) => JSON.parse(files.get(p)!);
const mainWrites = (p: string) => write.mock.calls.filter((c) => c[0] === p + '.tmp' || c[0] === p).length;

beforeEach(() => {
  files.clear();
  jest.clearAllMocks();
});

describe('(a) 삭제 = 휴지통 이동', () => {
  test('글로벌 프리셋: 목록 → 휴지통, 파일 유지, dirty, 한 번의 저장', async () => {
    const gp = new GlobalPresetService();
    files.set(GP, JSON.stringify({ version: 2, presets: [preset('a', 'A', 'a.png'), preset('b', 'B', 'b.png')] }));
    files.set(vibe('b.png'), 'BBB');
    await gp.load();
    await gp.delete('b');
    expect(ids(gp.list())).toEqual(['a']);
    expect(trashIds(gp)).toEqual(['b']);
    expect(gp.trash[0].entry).toEqual(preset('b', 'B', 'b.png')); // 원본 그대로
    expect(typeof gp.trash[0].deletedAt).toBe('number');
    expect(files.get(vibe('b.png'))).toBe('BBB');
    expect((gp as any).store.dirty).toBe(true);
    expect(backend.deleteFile).not.toHaveBeenCalled();
    await gp.flushSave();
    expect(mainWrites(GP)).toBe(1);
    const f = saved(GP);
    expect(ids(f.presets)).toEqual(['a']);
    expect(f.trash.map((t: any) => t.entry.id)).toEqual(['b']);
    expect(f.version).toBe(2);
  });

  test('글로벌 캐릭터: 원래 폴더가 entry.folder 로 휴지통에 남고, 첨부 이미지는 지우지 않는다', async () => {
    const gc = new GlobalCharacterPresetService();
    files.set(GC, JSON.stringify({ version: 1, presets: [character('a', 'A', { vibe: 'v.png' }, 'F')], folders: ['F'] }));
    files.set(charImg('v.png'), 'V');
    await gc.load();
    await gc.delete('a');
    expect(gc.list()).toEqual([]);
    expect(gc.trash[0].entry.folder).toBe('F');
    expect(files.get(charImg('v.png'))).toBe('V');
    await gc.flushSave();
    expect(mainWrites(GC)).toBe(1);
    expect(saved(GC).trash[0].entry.folder).toBe('F');
    expect(saved(GC).folders).toEqual(['F']);
  });

  test('확인 문구 = 휴지통 갈래(30일, danger true — Enter 확인)', () => {
    const t = deleteConfirmText({ kind: 'globalPreset', name: 'X', outcome: { trashDays: GLOBAL_LIBRARY_TRASH_DAYS } });
    expect(t.text).toBe('글로벌 프리셋 "X"을(를) 삭제할까요?\n휴지통으로 이동되어 30일 동안 복원할 수 있습니다.');
    expect(t.danger).toBe(true);
    expect(GLOBAL_LIBRARY_TRASH_DAYS).toBe(30);
  });

  test('막힌 저장소에서는 삭제·복원·영구 삭제 모두 거부', async () => {
    const gp = new GlobalPresetService();
    files.set(GP, JSON.stringify({ version: 2, presets: [preset('a', 'A')], trash: [{ entry: preset('t', 'T'), deletedAt: 5 }] }));
    await gp.load();
    (gp as any).store.status = 'blocked';
    await expect(gp.delete('a')).rejects.toThrow();
    await expect(gp.restoreFromTrash('t')).rejects.toThrow();
    await expect(gp.purgeFromTrash(['t'])).rejects.toThrow();
    await expect(gp.emptyTrash()).rejects.toThrow();
    expect(trashIds(gp)).toEqual(['t']);
  });
});

describe('(b) 복원', () => {
  test('이름이 겹치면 「X (2)」, 끝에 붙고, 휴지통에서 빠지고 저장된다', async () => {
    const gp = new GlobalPresetService();
    files.set(GP, JSON.stringify({ version: 2, presets: [preset('a', 'A', 'a.png'), preset('b', 'B')] }));
    files.set(vibe('a.png'), 'A');
    await gp.load();
    await gp.delete('a');
    await gp.addFromPresetAndImage({ type: 'SDImageGen', name: 'A' }, null, 'A'); // 같은 이름 새로 만듦
    const r = await gp.restoreFromTrash('a');
    expect(r).toMatchObject({ kind: 'restored', renamedFrom: 'A', missingImages: 0 });
    expect(gp.get('a')!.name).toBe('A (2)');
    expect(ids(gp.list())[2]).toBe('a');
    expect(gp.trash).toEqual([]);
    await gp.flushSave();
    expect(saved(GP).trash).toBeUndefined(); // 비면 필드를 쓰지 않는다
    expect(GLOBAL_TRASH_TEXT.restoredAs('A', 'A (2)')).toContain('A (2)');
  });

  test('이미지 파일이 없으면 항목은 복원하되 이미지 없음으로 알린다', async () => {
    const gp = new GlobalPresetService();
    files.set(GP, JSON.stringify({ version: 2, presets: [preset('a', 'A', 'gone.png')] }));
    await gp.load();
    await gp.delete('a');
    const r = await gp.restoreFromTrash('a');
    expect(r).toMatchObject({ kind: 'restored', missingImages: 1 });
    expect(gp.get('a')!.profile).toBe('gone.png');
    expect(await gp.fetchProfileImage('gone.png')).toBeNull();
  });

  test('글로벌 캐릭터: 원래 폴더가 없어졌으면 미분류로, 있으면 그 폴더로, 첨부 이미지 없음 개수', async () => {
    const gc = new GlobalCharacterPresetService();
    files.set(
      GC,
      JSON.stringify({
        version: 1,
        presets: [character('a', 'A', { vibe: 'v.png', rep: 'none.png' }, 'Gone'), character('b', 'B', {}, 'Keep')],
        folders: ['Gone', 'Keep'],
      }),
    );
    files.set(charImg('v.png'), 'V');
    await gc.load();
    await gc.delete('a');
    await gc.delete('b');
    await gc.deleteFolder('Gone');
    const ra = await gc.restoreFromTrash('a');
    expect(ra).toMatchObject({ kind: 'restored', missingImages: 1, folderDropped: 'Gone' });
    expect(gc.get('a')!.folder).toBeUndefined();
    const rb = await gc.restoreFromTrash('b');
    expect(rb).toMatchObject({ kind: 'restored', missingImages: 0 });
    expect(gc.get('b')!.folder).toBe('Keep');
  });

  test('휴지통에 없으면 not-in-trash, 같은 id 가 목록에 있으면 id-taken', async () => {
    const gc = new GlobalCharacterPresetService();
    files.set(GC, JSON.stringify({ version: 1, presets: [character('a', 'A')], folders: [] }));
    await gc.load();
    expect(await gc.restoreFromTrash('zz')).toEqual({ kind: 'not-in-trash' });
    expect(await gc.restoreFromTrash('a')).toEqual({ kind: 'id-taken' });
  });
});

describe('(c) 영구 삭제는 참조 없는 파일만', () => {
  test('글로벌 프리셋: 목록의 다른 항목이 같은 파일을 쓰면 남기고, 휴지통의 다른 항목이 써도 남긴다', async () => {
    const gp = new GlobalPresetService();
    files.set(
      GP,
      JSON.stringify({
        version: 2,
        presets: [preset('a', 'A', 'same.png'), preset('b', 'B', 'same.png'), preset('c', 'C', 'same.png'), preset('d', 'D', 'own.png')],
      }),
    );
    files.set(vibe('same.png'), 'S');
    files.set(vibe('own.png'), 'O');
    await gp.load();
    await gp.delete('a');
    await gp.delete('b');
    await gp.delete('d');
    let r = await gp.purgeFromTrash(['a']); // b(휴지통)·c(목록)가 같은 파일
    expect(r).toEqual({ removed: 1, filesDeleted: 0, saved: true });
    expect(files.has(vibe('same.png'))).toBe(true);
    await gp.delete('c');
    r = await gp.purgeFromTrash(['b']); // c(휴지통)가 같은 파일
    expect(files.has(vibe('same.png'))).toBe(true);
    r = await gp.emptyTrash(); // c·d — 이제 아무도 쓰지 않는다
    expect(r).toEqual({ removed: 2, filesDeleted: 2, saved: true });
    expect(files.has(vibe('same.png'))).toBe(false);
    expect(files.has(vibe('own.png'))).toBe(false);
    expect(saved(GP).trash).toBeUndefined();
    expect(saved(GP).presets).toEqual([]);
  });

  test('지원하지 않는 종류의 보존분이 쓰는 파일도 남긴다', async () => {
    const gp = new GlobalPresetService();
    const future = { id: 'f', name: '미래', workflowType: 'SDFuture', profile: 'same.png' };
    files.set(GP, JSON.stringify({ version: 2, presets: [preset('a', 'A', 'same.png'), future] }));
    files.set(vibe('same.png'), 'S');
    await gp.load();
    await gp.delete('a');
    await gp.emptyTrash();
    expect(files.has(vibe('same.png'))).toBe(true);
    expect(saved(GP).presets).toEqual([future]);
  });

  test('글로벌 캐릭터: 복제본(목록·휴지통)이 같은 파일을 쓰면 남긴다', async () => {
    const gc = new GlobalCharacterPresetService();
    files.set(
      GC,
      JSON.stringify({
        version: 1,
        presets: [character('a', 'A', { vibe: 'sh.png' }), character('b', 'A 복사본', { vibe: 'sh.png', rep: 'rep.png' })],
        folders: [],
      }),
    );
    files.set(charImg('sh.png'), 'S');
    files.set(charImg('rep.png'), 'R');
    await gc.load();
    await gc.delete('b');
    const r = await gc.purgeFromTrash(['b']);
    expect(r.filesDeleted).toBe(1); // rep.png 만
    expect(files.has(charImg('sh.png'))).toBe(true);
    expect(files.has(charImg('rep.png'))).toBe(false);
  });

  test('저장이 실패하면 이미지 파일은 지우지 않는다', async () => {
    const gp = new GlobalPresetService();
    files.set(GP, JSON.stringify({ version: 2, presets: [preset('a', 'A', 'a.png')] }));
    files.set(vibe('a.png'), 'A');
    await gp.load();
    await gp.delete('a');
    write.mockImplementation(async () => {
      throw new Error('디스크 오류');
    });
    try {
      const r = await gp.purgeFromTrash(['a']);
      expect(r).toEqual({ removed: 1, filesDeleted: 0, saved: false });
      expect(files.has(vibe('a.png'))).toBe(true);
      expect((gp as any).store.dirty).toBe(true); // 다음 저장이 다시 쓴다
    } finally {
      write.mockImplementation(async (p: string, d: string) => {
        files.set(p, d);
      });
    }
  });
});

describe('(d) 만료 정리', () => {
  test('30일이 지난 항목만 지우고 파일도 정리, 29일은 남긴다', async () => {
    const now = Date.now();
    const gp = new GlobalPresetService();
    files.set(
      GP,
      JSON.stringify({
        version: 2,
        presets: [],
        trash: [
          { entry: preset('old', 'Old', 'old.png'), deletedAt: now - 31 * DAY },
          { entry: preset('new', 'New', 'new.png'), deletedAt: now - 29 * DAY },
        ],
      }),
    );
    files.set(vibe('old.png'), 'O');
    files.set(vibe('new.png'), 'N');
    await gp.load();
    expect(await gp.purgeExpiredTrash(now)).toBe(1);
    expect(trashIds(gp)).toEqual(['new']);
    expect(files.has(vibe('old.png'))).toBe(false);
    expect(files.has(vibe('new.png'))).toBe(true);
    expect(saved(GP).trash.map((t: any) => t.entry.id)).toEqual(['new']);
    expect(trashDaysLeft(now - 29 * DAY, now)).toBe(1);
    expect(trashDaysLeft(now - GLOBAL_LIBRARY_TRASH_MS, now)).toBe(0);
  });

  test('읽기 실패(저장 차단) 상태에서는 아무것도 지우지 않는다', async () => {
    const now = Date.now();
    const gc = new GlobalCharacterPresetService();
    backend.readFile.mockImplementation(async (p: string) => {
      if (p === GC) throw Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' });
      if (!files.has(p)) throw enoent(p);
      return files.get(p)!;
    });
    const sleepless = (gc as any).store.deps;
    (gc as any).store.deps = { ...sleepless, sleep: async () => {} };
    try {
      files.set(GC, JSON.stringify({ version: 1, presets: [], trash: [{ entry: character('o', 'O', { vibe: 'o.png' }), deletedAt: now - 40 * DAY }] }));
      files.set(charImg('o.png'), 'O');
      await gc.load();
      expect(gc.loadFailed).toBe(true);
      expect(await gc.purgeExpiredTrash(now)).toBe(0);
      expect(files.has(charImg('o.png'))).toBe(true);
      expect(backend.deleteFile).not.toHaveBeenCalled();
    } finally {
      backend.readFile.mockImplementation(async (p: string) => {
        if (!files.has(p)) throw enoent(p);
        return files.get(p)!;
      });
    }
  });

  test('사본(.bak)에서 되살린 세션에서는 만료 정리를 하지 않는다', async () => {
    const now = Date.now();
    const gp = new GlobalPresetService();
    (gp as any).store.deps = { ...(gp as any).store.deps, sleep: async () => {} };
    files.set(GP, '{손상');
    files.set(
      GP + '.bak1',
      JSON.stringify({ version: 2, presets: [preset('a', 'A')], trash: [{ entry: preset('o', 'O', 'o.png'), deletedAt: now - 40 * DAY }] }),
    );
    files.set(vibe('o.png'), 'O');
    await gp.load();
    expect(trashIds(gp)).toEqual(['o']);
    expect(await gp.purgeExpiredTrash(now)).toBe(0);
    expect(files.has(vibe('o.png'))).toBe(true);
  });

  test('아직 읽지 않았으면 무동작', async () => {
    const gp = new GlobalPresetService();
    expect(await gp.purgeExpiredTrash()).toBe(0);
  });
});

describe('(e) 옛 파일·왕복', () => {
  test('휴지통 필드 없는 옛 파일 = 빈 휴지통, 다시 저장해도 trash 키가 생기지 않는다(글자 그대로)', async () => {
    const gp = new GlobalPresetService();
    const raw = JSON.stringify({ version: 2, presets: [preset('a', 'A')] });
    files.set(GP, raw);
    await gp.load();
    expect(gp.trash).toEqual([]);
    await gp.setDefault('a', true);
    await gp.setDefault('a', false);
    await gp.flushSave();
    const f = saved(GP);
    expect('trash' in f).toBe(false);
    expect(JSON.stringify(f)).toBe(raw.replace('"updatedAt":1', `"updatedAt":${f.presets[0].updatedAt}`));

    const gc = new GlobalCharacterPresetService();
    files.set(GC, JSON.stringify({ version: 1, presets: [character('c', 'C')], folders: [] }));
    await gc.load();
    expect(gc.trash).toEqual([]);
    await gc.rename('c', 'C2');
    await gc.flushSave();
    expect('trash' in saved(GC)).toBe(false);
  });

  test('휴지통이 있는 파일의 왕복 — 내용·순서·삭제 시각이 그대로, 모르는 종류의 휴지통 항목도 보존', async () => {
    const gp = new GlobalPresetService();
    const futureTrash = { entry: { id: 'f', name: '미래', workflowType: 'SDFuture' }, deletedAt: 7, extra: 1 };
    const trash = [{ entry: preset('t1', 'T1', 't1.png'), deletedAt: 5 }, futureTrash, { entry: preset('t2', 'T2'), deletedAt: 6 }];
    files.set(GP, JSON.stringify({ version: 2, presets: [preset('a', 'A')], trash }));
    await gp.load();
    expect(trashIds(gp)).toEqual(['t1', 't2']); // 모르는 종류는 화면에 안 보임
    await gp.rename('a', 'A2');
    await gp.flushSave();
    expect(saved(GP).trash).toEqual(trash);

    const gc = new GlobalCharacterPresetService();
    const ctrash = [{ entry: character('x', 'X', {}, 'F'), deletedAt: 9 }];
    files.set(GC, JSON.stringify({ version: 1, presets: [], folders: ['F'], trash: ctrash }));
    await gc.load();
    await gc.createFolder('G');
    await gc.flushSave();
    expect(saved(GC).trash).toEqual(ctrash);
  });

  test('손상 칸은 버리고, 목록과 같은 id 는 목록 우선, trash 가 배열이 아니면 빈 휴지통', async () => {
    const gp = new GlobalPresetService();
    files.set(
      GP,
      JSON.stringify({
        version: 2,
        presets: [preset('a', 'A')],
        trash: [null, { entry: { name: 'id 없음' } }, { entry: preset('a', '옛 A'), deletedAt: 1 }, { entry: preset('t', 'T'), deletedAt: 2 }],
      }),
    );
    await gp.load();
    expect(trashIds(gp)).toEqual(['t']);
    expect(gp.get('a')!.name).toBe('A');
    files.set(GP, JSON.stringify({ version: 2, presets: [], trash: 'x' }));
    const gp2 = new GlobalPresetService();
    await gp2.load();
    expect(gp2.trash).toEqual([]);
  });
});

describe('(f) 여러 창 병합', () => {
  test('다른 창이 휴지통에서 복원 + 이 창은 다른 편집 중(dirty) → 목록에 들어오고 휴지통에서 빠진다', async () => {
    const gp = new GlobalPresetService();
    files.set(GP, JSON.stringify({ version: 2, presets: [preset('a', 'A')], trash: [{ entry: preset('x', 'X'), deletedAt: 3 }] }));
    await gp.load();
    await gp.rename('a', 'A 이 창'); // 저장 대기(dirty)
    // 다른 창: x 를 복원해 저장
    files.set(GP, JSON.stringify({ version: 2, presets: [preset('a', 'A'), preset('x', 'X')] }));
    await gp.reloadExternal();
    expect(ids(gp.list())).toEqual(['a', 'x']);
    expect(gp.get('a')!.name).toBe('A 이 창');
    expect(gp.trash).toEqual([]);
  });

  test('이 창이 지움(휴지통에 넣음) + 다른 창이 다른 항목 추가 → 둘 다 유지, 이 창의 휴지통 항목 유지', async () => {
    const gc = new GlobalCharacterPresetService();
    files.set(GC, JSON.stringify({ version: 1, presets: [character('a', 'A'), character('b', 'B')], folders: [] }));
    await gc.load();
    await gc.delete('a'); // dirty
    files.set(GC, JSON.stringify({ version: 1, presets: [character('a', 'A'), character('b', 'B'), character('n', 'N')], folders: [] }));
    await gc.reloadExternal();
    expect(ids(gc.list())).toEqual(['b', 'n']);
    expect(trashIds(gc)).toEqual(['a']);
    await gc.flushSave();
    expect(saved(GC).trash.map((t: any) => t.entry.id)).toEqual(['a']);
  });

  test('병합 뒤 같은 id 가 목록과 휴지통 양쪽이면 목록 쪽을 남긴다(이 창이 지운 사이 다른 창이 같은 id 를 고침)', async () => {
    const gp = new GlobalPresetService();
    files.set(GP, JSON.stringify({ version: 2, presets: [preset('a', 'A')] }));
    await gp.load();
    await gp.delete('a'); // 이 창: a → 휴지통(dirty)
    // 다른 창: a 를 휴지통에 넣었다가 복원·수정한 결과(목록에 a)와, 휴지통에도 같은 id 가 남은 이상한 파일
    files.set(
      GP,
      JSON.stringify({ version: 2, presets: [{ ...preset('a', 'A 다른 창') }], trash: [{ entry: preset('a', 'A'), deletedAt: 1 }] }),
    );
    await gp.reloadExternal();
    // 목록: 이 창이 지움 → 지운 채 유지(mergeById 규칙). 휴지통엔 a 하나
    const listed = new Set(ids(gp.list()));
    for (const t of gp.trash) expect(listed.has(t.entry.id)).toBe(false);
    // 교체 경로(이 창 dirty 아님)에서도 목록 우선
    await gp.flushSave();
    files.set(GP, JSON.stringify({ version: 2, presets: [preset('a', 'A')], trash: [{ entry: preset('a', 'A'), deletedAt: 1 }] }));
    await gp.reloadExternal();
    expect(ids(gp.list())).toEqual(['a']);
    expect(gp.trash).toEqual([]);
  });

  test('순수 함수: mergeTrash·dropListedFromTrash·unreferencedTokens·splitTrashField', () => {
    const it = (id: string, at = 1) => ({ entry: { id, name: id }, deletedAt: at });
    // base [a,b], local [a,c](b 를 복원, c 추가), remote [a,b,d](d 추가)
    const m = mergeTrash([it('a'), it('b')], [it('a'), it('c')], [it('a'), it('b'), it('d')]);
    expect(m.map((t) => t.entry.id)).toEqual(['a', 'c', 'd']);
    expect(dropListedFromTrash(m, ['c']).map((t) => t.entry.id)).toEqual(['a', 'd']);
    const same = [it('z')];
    expect(dropListedFromTrash(same, ['q'])).toBe(same);
    expect(unreferencedTokens(['x.png', 'dir/y.png', 'y.png', ''], ['y.png'])).toEqual(['x.png']);
    const s = splitTrashField<any>([it('a', 0), it('a', 5)], (e) => !!e?.id, 123);
    expect(s.items).toEqual([{ entry: { id: 'a', name: 'a' }, deletedAt: 123 }]);
  });
});

describe('(h) 백업', () => {
  test('항목 단위 백업은 목록만(휴지통·휴지통 이미지 제외), 휴지통이 없으면 종전처럼 본 파일 그대로', async () => {
    const gp = new GlobalPresetService();
    files.set(GP, JSON.stringify({ version: 2, presets: [preset('a', 'A', 'a.png'), preset('b', 'B', 'b.png')] }));
    files.set(vibe('a.png'), 'A');
    files.set(vibe('b.png'), 'B');
    await gp.load();
    let entries = await gp.buildBackupEntries();
    expect(entries[0]).toEqual({ path: GP, name: 'global_presets.json' });
    await gp.delete('b');
    entries = await gp.buildBackupEntries();
    expect(entries[0].name).toBe('global_presets.json');
    expect(entries[0].path).not.toBe(GP);
    expect(entries[0].path.startsWith('tmp/')).toBe(true);
    const inTar = JSON.parse(files.get(entries[0].path)!);
    expect('trash' in inTar).toBe(false);
    expect(ids(inTar.presets)).toEqual(['a']);
    expect(entries.map((e) => e.name)).toEqual(['global_presets.json', 'global_vibes/a.png']);
  });

  test('백업 불러오기는 휴지통 필드를 들이지 않고 지금 휴지통을 지우지 않는다, 덮어쓰기 = 기존 항목 휴지통', async () => {
    const gp = new GlobalPresetService();
    files.set(
      GP,
      JSON.stringify({ version: 2, presets: [preset('a', 'A', 'a.png')], trash: [{ entry: preset('mine', 'Mine'), deletedAt: 4 }] }),
    );
    files.set(vibe('a.png'), 'OLD');
    await gp.load();
    files.set(
      'bk/global_presets.json',
      JSON.stringify({ version: 2, presets: [preset('a2', 'A')], trash: [{ entry: preset('theirs', 'Theirs'), deletedAt: 1 }] }),
    );
    const r = await gp.restoreFromBackupDir('bk', 'overwrite');
    expect(r).toEqual({ added: 1, skipped: 0, overwritten: 1 });
    expect(trashIds(gp).sort()).toEqual(['a', 'mine']); // 들어온 휴지통(theirs)은 없음, 지금 휴지통 유지 + 덮인 a
    expect(files.get(vibe('a.png'))).toBe('OLD'); // 덮인 항목의 이미지는 남는다
    expect(gp.list().map((p) => p.name)).toEqual(['A']);
    expect(IMPORT_FLOW_TEXT.protection.trashReplaced).toContain('휴지통');
  });
});
