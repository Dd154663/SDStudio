/**
 * 씬 구조 작업(생성·이름 변경·북마크)의 되돌리기 — 2026-11-01 U2a (SPEC_GUIDE 「되돌리기 계약」).
 *  - 생성 되돌림 = 실제 TrashService.moveSceneToTrash(슬롯 반환 사용), 다시 실행 = restoreScene + rebind
 *  - 여러 씬 생성 = 1항목(되돌림 역순·다시 실행 정순)
 *  - 생성 뒤 그 씬에 이미지가 생긴 상태에서 되돌림 → 휴지통행이라 이미지 보존, 다시 실행 → 이미지 그대로 복원
 *  - 이름 변경 되돌림·다시 실행 = renameScene/renameInpaintScene 역호출, 다른 창 잠금 = 실패 토스트+폐기
 *  - 북마크 = setSceneBookmark 절대값
 * 메모리 파일시스템 모킹은 trashRestoreU0a.test.ts 와 같다(세션·씬은 실제 types).
 */

// ---- 메모리 파일시스템 ----
const files = new Map<string, string>();

function exists(p: string): boolean {
  if (files.has(p)) return true;
  for (const k of files.keys()) if (k.startsWith(p + '/')) return true;
  return false;
}
function children(dir: string): string[] {
  const set = new Set<string>();
  for (const k of files.keys()) {
    if (k.startsWith(dir + '/')) set.add(k.slice(dir.length + 1).split('/')[0]);
  }
  return Array.from(set);
}
function movePrefix(from: string, to: string) {
  for (const k of Array.from(files.keys())) {
    if (k === from || k.startsWith(from + '/')) {
      const v = files.get(k)!;
      files.delete(k);
      files.set(to + k.slice(from.length), v);
    }
  }
}

jest.mock('../index', () => ({
  backend: {
    existFile: jest.fn(async (p: string) => exists(p)),
    readFile: jest.fn(async (p: string) => {
      if (!files.has(p)) throw new Error('ENOENT ' + p);
      return files.get(p)!;
    }),
    writeFile: jest.fn(async (p: string, c: string) => {
      files.set(p, c);
    }),
    listFiles: jest.fn(async (dir: string) => children(dir)),
    listFilesWithStats: jest.fn(async (dir: string) =>
      children(dir)
        .filter((n) => files.has(dir + '/' + n))
        .map((name) => ({ name })),
    ),
    renameFile: jest.fn(async (a: string, b: string) => {
      if (!files.has(a)) throw new Error('ENOENT ' + a);
      files.set(b, files.get(a)!);
      files.delete(a);
    }),
    renameDir: jest.fn(async (a: string, b: string) => {
      if (!exists(a)) return;
      if (exists(b)) throw new Error('ENOTEMPTY ' + b);
      movePrefix(a, b);
    }),
    deleteFile: jest.fn(async (p: string) => {
      files.delete(p);
    }),
    deleteDir: jest.fn(async () => {}),
    notifyGlobalStoreChanged: jest.fn(async () => {}),
  },
  imageService: { invalidateCacheBatch: jest.fn(async () => {}) },
  templateService: { removeProject: jest.fn(async () => {}) },
  sessionService: { guardCrossWindowLock: jest.fn(async () => true) },
  workFlowService: {},
}));
jest.mock('../PersistenceService', () => ({
  persistService: {
    write: jest.fn(async (p: string, c: string) => {
      files.set(p, c);
    }),
  },
}));

import { TrashService } from '../TrashService';
import { sessionService } from '../index';
import { setWorkspaceLayoutActive } from '../storageLayout';
import { InpaintScene, Scene, Session } from '../types';
import { undoRef, UNDO_TEXT, UndoService } from '../undoService';
import {
  mirrorImageHooks,
  recordSceneRename,
  recordScenesCreated,
  SceneBookmarkValue,
  SceneStructureOps,
  toggleSceneBookmarkRecorded,
} from '../sceneStructureUndo';

const lockMock = sessionService.guardCrossWindowLock as jest.Mock;

// ---- 하네스 ----
function makeService() {
  const toast = jest.fn();
  const mirrors = new Set<Session>();
  const service = new UndoService({
    curSession: () => undefined,
    isMirror: (s) => mirrors.has(s),
    toast,
    now: () => 1000,
  });
  return { service, toast, mirrors };
}

function scene(name: string): Scene {
  return Scene.fromJSON({
    type: 'scene',
    name,
    resolution: 'portrait',
    slots: [],
    mains: [],
    imageMap: [],
    meta: {},
    round: undefined,
    game: undefined,
  } as any);
}

function inpaint(name: string): InpaintScene {
  const s = new InpaintScene();
  s.name = name;
  return s;
}

function makeSession(...names: string[]): Session {
  const session = new Session();
  session.name = 'P';
  for (const n of names) session.addScene(scene(n));
  return session;
}

const order = (s: Session, type: 'scene' | 'inpaint' = 'scene') =>
  s.getScenes(type).map((x) => x.name);
const trashKeys = () =>
  Object.keys(JSON.parse(files.get('trash.json') || '{"scenes":{}}').scenes);

/** 일반 씬 이름 변경(SessionService.renameScene 계약: 다른 창 잠금이면 조용히 반환, 순서 보존) */
function fakeRename(blocked: { on: boolean }) {
  return jest.fn(async (session: Session, from: string, to: string) => {
    if (blocked.on) return;
    const s = session.scenes.get(from)!;
    s.name = to;
    const rebuilt = new Map();
    for (const [k, v] of session.scenes) rebuilt.set(k === from ? to : k, v);
    session.scenes = rebuilt as any;
  });
}

function fakeRenameInpaint(blocked: { on: boolean }) {
  return jest.fn(async (session: Session, from: string, to: string) => {
    if (blocked.on) return false;
    const s = session.inpaints.get(from)!;
    s.name = to;
    const rebuilt = new Map();
    for (const [k, v] of session.inpaints) rebuilt.set(k === from ? to : k, v);
    session.inpaints = rebuilt as any;
    return true;
  });
}

async function makeOps(
  overrides: Partial<SceneStructureOps> = {},
): Promise<{ ops: SceneStructureOps; trash: TrashService; bookmarks: Record<string, SceneBookmarkValue> }> {
  const trash = new TrashService();
  await trash.loadTrash();
  const blocked = { on: false };
  const bookmarks: Record<string, SceneBookmarkValue> = {};
  const ops: SceneStructureOps = {
    moveSceneToTrash: jest.fn((s, sc) => trash.moveSceneToTrash(s, sc)),
    restoreScene: jest.fn((s, slot) => trash.restoreScene(s, slot)),
    renameScene: fakeRename(blocked),
    renameInpaintScene: fakeRenameInpaint(blocked),
    getSceneBookmark: (p) => bookmarks[p],
    setSceneBookmark: jest.fn(async (p, v) => {
      if (v) bookmarks[p] = { ...v };
      else delete bookmarks[p];
    }),
    ...overrides,
  };
  return { ops, trash, bookmarks };
}

beforeEach(() => {
  files.clear();
  setWorkspaceLayoutActive(false);
  lockMock.mockReset();
  lockMock.mockResolvedValue(true);
});
afterAll(() => setWorkspaceLayoutActive(false));

describe('씬 생성 — 되돌림 = 휴지통행, 다시 실행 = 휴지통 복원', () => {
  test('씬 추가 → 되돌림이 moveSceneToTrash 경유(슬롯 기억) → 다시 실행이 restoreScene + rebind', async () => {
    const { service, toast } = makeService();
    const { ops } = await makeOps();
    const session = makeSession('X', 'Y');
    const a = scene('A');
    session.addScene(a);
    session.moveScene(a, 1); // X, A, Y
    expect(recordScenesCreated(session, [a], UNDO_TEXT.sceneAdd(['A']), { service, ops })).toBe(true);
    expect(service.peekLabel(session, 'undo')).toBe('씬 추가: A');

    expect(await service.undo(session)).toBe(true);
    expect(ops.moveSceneToTrash).toHaveBeenCalledWith(session, a);
    expect(session.hasScene('scene', 'A')).toBe(false);
    expect(trashKeys()).toEqual(['P:A']); // 휴지통 기록이 남는다(D18)
    expect(toast).toHaveBeenLastCalledWith(UNDO_TEXT.undone('씬 추가: A'), 'info');

    expect(await service.redo(session)).toBe(true);
    expect(ops.restoreScene).toHaveBeenCalledWith(session, 'A');
    const restored = session.getScene('scene', 'A')!;
    expect(restored).toBeDefined();
    expect(restored).not.toBe(a); // 역직렬화된 새 객체
    expect(undoRef(a).current).toBe(restored); // rebind
    expect(order(session)).toEqual(['X', 'A', 'Y']); // 원래 자리
    expect(trashKeys()).toEqual([]);

    // 다시 되돌림도 새 객체를 잡는다
    expect(await service.undo(session)).toBe(true);
    expect(session.hasScene('scene', 'A')).toBe(false);
  });

  test('휴지통에 같은 이름 기록이 있으면 슬롯 이름으로 보냈다가 다시 실행 때 원래 이름으로 돌린다', async () => {
    const { service } = makeService();
    files.set(
      'trash.json',
      JSON.stringify({ scenes: { 'P:A': { sceneData: { name: 'A', type: 'scene' }, deletedAt: 1 } }, projects: {} }),
    );
    const { ops } = await makeOps();
    const session = makeSession();
    const a = scene('A');
    session.addScene(a);
    recordScenesCreated(session, [a], UNDO_TEXT.sceneAdd(['A']), { service, ops });
    await service.undo(session);
    expect(trashKeys().sort()).toEqual(['P:A', 'P:A (삭제 2)']);
    expect(await service.redo(session)).toBe(true);
    expect(ops.restoreScene).toHaveBeenCalledWith(session, 'A (삭제 2)');
    expect(ops.renameScene).toHaveBeenCalledWith(session, 'A (삭제 2)', 'A');
    expect(order(session)).toEqual(['A']);
    expect(trashKeys()).toEqual(['P:A']); // 옛 기록은 그대로
  });

  test('여러 씬 생성(줄마다 추가·미러 복제·변형 씬 복사) = 1항목, 되돌림 역순·다시 실행 정순', async () => {
    const { service } = makeService();
    const { ops } = await makeOps();
    const session = makeSession('X');
    const made = ['A', 'B', 'C'].map((n) => {
      const s = scene(n);
      session.addScene(s);
      return s;
    });
    recordScenesCreated(session, made, UNDO_TEXT.sceneAdd(['A', 'B', 'C']), { service, ops });
    expect(service.entries(session).past.map((e) => e.label)).toEqual(['씬 추가 3개']);

    await service.undo(session);
    expect((ops.moveSceneToTrash as jest.Mock).mock.calls.map((c) => c[1].name)).toEqual(['C', 'B', 'A']);
    expect(order(session)).toEqual(['X']);

    await service.redo(session);
    expect((ops.restoreScene as jest.Mock).mock.calls.map((c) => c[1])).toEqual(['A', 'B', 'C']);
    expect(order(session)).toEqual(['X', 'A', 'B', 'C']);
    expect(made.map((s) => undoRef(s).current)).toEqual(
      ['A', 'B', 'C'].map((n) => session.getScene('scene', n)),
    );
  });

  test('세션에 들어가지 않은 씬은 기록하지 않는다(0개면 항목 없음)', async () => {
    const { service } = makeService();
    const { ops } = await makeOps();
    const session = makeSession();
    expect(recordScenesCreated(session, [scene('ghost')], 'x', { service, ops })).toBe(false);
    expect(service.canUndoFor(session)).toBe(false);
  });

  test('★ 생성 뒤 그 씬에 이미지가 생긴 상태에서 되돌림 → 이미지는 휴지통으로 보존, 다시 실행 → 이미지 그대로 복원', async () => {
    const { service } = makeService();
    const { ops } = await makeOps();
    const session = makeSession();
    const a = scene('A');
    session.addScene(a);
    recordScenesCreated(session, [a], UNDO_TEXT.sceneDuplicate('A'), { service, ops });
    // 그사이 생성 결과
    files.set('outs/P/A/1.png', 'img1');
    files.set('outs/P/A/2.png', 'img2');
    a.imageMap.push('1.png', '2.png');
    a.mains.push('2.png');

    await service.undo(session);
    expect(exists('outs/P/A')).toBe(false);
    expect(files.get('outs/P/.trash/A/1.png')).toBe('img1');
    expect(files.get('outs/P/.trash/A/2.png')).toBe('img2');

    await service.redo(session);
    const restored = session.getScene('scene', 'A')!;
    expect(files.get('outs/P/A/1.png')).toBe('img1');
    expect(files.get('outs/P/A/2.png')).toBe('img2');
    expect([...restored.imageMap]).toEqual(['1.png', '2.png']);
    expect([...restored.mains]).toEqual(['2.png']);
  });

  test('다른 창 잠금으로 휴지통 이동이 막히면 실패 토스트 + 항목 폐기, 씬은 그대로', async () => {
    const { service, toast } = makeService();
    const { ops } = await makeOps();
    const session = makeSession();
    const a = scene('A');
    session.addScene(a);
    recordScenesCreated(session, [a], 'x', { service, ops });
    lockMock.mockResolvedValue(false);
    expect(await service.undo(session)).toBe(false);
    expect(toast).toHaveBeenLastCalledWith(UNDO_TEXT.undoFailed(UNDO_TEXT.sceneStructureBlocked), 'error');
    expect(session.getScene('scene', 'A')).toBe(a);
    expect(service.canUndoFor(session)).toBe(false);
    expect(service.canRedoFor(session)).toBe(false);
  });

  test('그사이 기록 밖 경로로 씬이 지워졌으면 되돌림은 실행하지 않고 폐기', async () => {
    const { service, toast } = makeService();
    const { ops, trash } = await makeOps();
    const session = makeSession();
    const a = scene('A');
    session.addScene(a);
    recordScenesCreated(session, [a], 'x', { service, ops });
    await trash.moveSceneToTrash(session, a); // 기록하지 않은 삭제
    (ops.moveSceneToTrash as jest.Mock).mockClear();
    expect(await service.undo(session)).toBe(false);
    expect(ops.moveSceneToTrash).not.toHaveBeenCalled();
    expect(toast).toHaveBeenLastCalledWith(UNDO_TEXT.undoFailed(UNDO_TEXT.sceneGone('A')), 'error');
  });

  test('휴지통에서 그사이 사라졌으면(비우기 등) 다시 실행 실패 + 폐기', async () => {
    const { service, toast } = makeService();
    const { ops, trash } = await makeOps();
    const session = makeSession();
    const a = scene('A');
    session.addScene(a);
    recordScenesCreated(session, [a], 'x', { service, ops });
    await service.undo(session);
    await trash.permanentlyDeleteScene('P', 'A', 'scene');
    expect(await service.redo(session)).toBe(false);
    expect(toast.mock.calls[toast.mock.calls.length - 1][1]).toBe('error');
    expect(service.canRedoFor(session)).toBe(false);
    expect(session.hasScene('scene', 'A')).toBe(false);
  });

  test('미러 변형 씬: 되돌림은 세션 미러 원본을 이전 값으로(이번 값일 때만), 다시 실행은 다시 이번 값으로', async () => {
    const { service } = makeService();
    const { ops } = await makeOps();
    const session = makeSession();
    session.mirrorImage = 'old.png';
    const m = inpaint('M');
    session.mirrorImage = 'new.png';
    session.addScene(m);
    recordScenesCreated(session, [m], UNDO_TEXT.variantSceneCreate('M'), {
      service,
      ops,
      ...mirrorImageHooks(session, 'old.png', 'new.png'),
    });
    await service.undo(session);
    expect(session.hasScene('inpaint', 'M')).toBe(false);
    expect(session.mirrorImage).toBe('old.png');
    await service.redo(session);
    expect(session.hasScene('inpaint', 'M')).toBe(true);
    expect(session.mirrorImage).toBe('new.png');
    // 그사이 다른 미러 원본으로 바뀌었으면 건드리지 않는다
    session.mirrorImage = 'other.png';
    await service.undo(session);
    expect(session.mirrorImage).toBe('other.png');
  });

  test('미러(읽기 전용) 프로젝트는 기록하지 않는다', async () => {
    const { service, mirrors } = makeService();
    const { ops } = await makeOps();
    const session = makeSession();
    mirrors.add(session);
    const a = scene('A');
    session.addScene(a);
    expect(recordScenesCreated(session, [a], 'x', { service, ops })).toBe(false);
  });
});

describe('씬 이름 변경 — renameScene/renameInpaintScene 역호출', () => {
  test('일반 씬: 되돌림 = 새→옛, 다시 실행 = 옛→새', async () => {
    const { service, toast } = makeService();
    const { ops } = await makeOps();
    const session = makeSession('X', 'A', 'Y');
    const a = session.getScene('scene', 'A')!;
    await ops.renameScene(session, 'A', 'B');
    expect(recordSceneRename(session, a, 'A', { service, ops })).toBe(true);
    // 되돌림 문구는 방향을 뒤집어 보여 준다(실기 지적: 되돌림 토스트가 「A → B」로 나오던 문제)
    expect(service.peekLabel(session, 'undo')).toBe('씬 이름 변경: B → A');

    expect(await service.undo(session)).toBe(true);
    expect(ops.renameScene).toHaveBeenLastCalledWith(session, 'B', 'A');
    expect(order(session)).toEqual(['X', 'A', 'Y']);
    expect(a.name).toBe('A');
    expect(toast).toHaveBeenLastCalledWith(UNDO_TEXT.undone('씬 이름 변경: B → A'), 'info');

    expect(await service.redo(session)).toBe(true);
    expect(ops.renameScene).toHaveBeenLastCalledWith(session, 'A', 'B');
    expect(order(session)).toEqual(['X', 'B', 'Y']);
  });

  test('다른 창 잠금으로 이름이 안 바뀌면 실패 토스트 + 항목 폐기', async () => {
    const { service, toast } = makeService();
    const blocked = { on: false };
    const { ops } = await makeOps({ renameScene: fakeRename(blocked) });
    const session = makeSession('A');
    const a = session.getScene('scene', 'A')!;
    await ops.renameScene(session, 'A', 'B');
    recordSceneRename(session, a, 'A', { service, ops });
    blocked.on = true;
    expect(await service.undo(session)).toBe(false);
    expect(toast).toHaveBeenLastCalledWith(UNDO_TEXT.undoFailed(UNDO_TEXT.sceneStructureBlocked), 'error');
    expect(a.name).toBe('B');
    expect(service.canUndoFor(session)).toBe(false);
    expect(service.canRedoFor(session)).toBe(false);
  });

  test('처음 이름 변경이 막혀 이름이 그대로면 기록하지 않는다', async () => {
    const { service } = makeService();
    const blocked = { on: true };
    const { ops } = await makeOps({ renameScene: fakeRename(blocked) });
    const session = makeSession('A');
    const a = session.getScene('scene', 'A')!;
    await ops.renameScene(session, 'A', 'B');
    expect(recordSceneRename(session, a, 'A', { service, ops })).toBe(false);
    expect(service.canUndoFor(session)).toBe(false);
  });

  test('되돌릴 이름을 그사이 다른 씬이 쓰고 있으면 실행하지 않고 폐기', async () => {
    const { service, toast } = makeService();
    const { ops } = await makeOps();
    const session = makeSession('A');
    const a = session.getScene('scene', 'A')!;
    await ops.renameScene(session, 'A', 'B');
    recordSceneRename(session, a, 'A', { service, ops });
    session.addScene(scene('A'));
    (ops.renameScene as jest.Mock).mockClear();
    expect(await service.undo(session)).toBe(false);
    expect(ops.renameScene).not.toHaveBeenCalled();
    expect(toast).toHaveBeenLastCalledWith(UNDO_TEXT.undoFailed(UNDO_TEXT.sceneNameTaken('A')), 'error');
  });

  test('변형 씬: renameInpaintScene 역호출', async () => {
    const { service } = makeService();
    const { ops } = await makeOps();
    const session = makeSession();
    const v = inpaint('V');
    session.addScene(v);
    await ops.renameInpaintScene(session, 'V', 'W');
    recordSceneRename(session, v, 'V', { service, ops });
    await service.undo(session);
    expect(ops.renameInpaintScene).toHaveBeenLastCalledWith(session, 'W', 'V');
    expect(session.getScene('inpaint', 'V')).toBe(v);
    await service.redo(session);
    expect(ops.renameInpaintScene).toHaveBeenLastCalledWith(session, 'V', 'W');
    expect(session.getScene('inpaint', 'W')).toBe(v);
    expect(ops.renameScene).not.toHaveBeenCalled();
  });

  test('씬 추가 → 이름 변경 → 되돌림 2번 → 다시 실행 2번 (손잡이가 새 객체를 따라간다)', async () => {
    const { service } = makeService();
    const { ops } = await makeOps();
    const session = makeSession();
    const a = scene('A');
    session.addScene(a);
    recordScenesCreated(session, [a], UNDO_TEXT.sceneAdd(['A']), { service, ops });
    await ops.renameScene(session, 'A', 'B');
    recordSceneRename(session, a, 'A', { service, ops });
    await service.undo(session); // B → A
    await service.undo(session); // 휴지통
    expect(order(session)).toEqual([]);
    await service.redo(session); // 복원(새 객체 A)
    expect(await service.redo(session)).toBe(true); // 새 객체에 A → B
    expect(order(session)).toEqual(['B']);
    expect(session.getScene('scene', 'B')).toBe(undoRef(a).current);
  });
});

describe('씬 북마크 — setSceneBookmark 절대값', () => {
  test('켜기: 되돌림 = 이전 북마크(다른 씬)로, 다시 실행 = 이 씬으로', async () => {
    const { service } = makeService();
    const { ops, bookmarks } = await makeOps();
    const session = makeSession('X', 'A');
    bookmarks.P = { name: 'X', type: 'scene' };
    await toggleSceneBookmarkRecorded(session, session.getScene('scene', 'A')!, { service, ops });
    expect(bookmarks.P).toEqual({ name: 'A', type: 'scene' });
    expect(service.peekLabel(session, 'undo')).toBe(UNDO_TEXT.sceneBookmarkOn('A'));
    await service.undo(session);
    expect(ops.setSceneBookmark).toHaveBeenLastCalledWith('P', { name: 'X', type: 'scene' });
    expect(bookmarks.P).toEqual({ name: 'X', type: 'scene' });
    await service.redo(session);
    expect(bookmarks.P).toEqual({ name: 'A', type: 'scene' });
  });

  test('끄기: 되돌림 = 다시 이 씬, 다시 실행 = 없음', async () => {
    const { service } = makeService();
    const { ops, bookmarks } = await makeOps();
    const session = makeSession('A');
    bookmarks.P = { name: 'A', type: 'scene' };
    await toggleSceneBookmarkRecorded(session, session.getScene('scene', 'A')!, { service, ops });
    expect(bookmarks.P).toBeUndefined();
    expect(service.peekLabel(session, 'undo')).toBe(UNDO_TEXT.sceneBookmarkOff('A'));
    await service.undo(session);
    expect(bookmarks.P).toEqual({ name: 'A', type: 'scene' });
    await service.redo(session);
    expect(bookmarks.P).toBeUndefined();
    expect(ops.setSceneBookmark).toHaveBeenLastCalledWith('P', undefined);
  });

  test('프로젝트 이름이 바뀌어도(같은 인스턴스) 실행 시점 이름으로 적용', async () => {
    const { service } = makeService();
    const { ops } = await makeOps();
    const session = makeSession('A');
    await toggleSceneBookmarkRecorded(session, session.getScene('scene', 'A')!, { service, ops });
    session.name = 'Q';
    await service.undo(session);
    expect(ops.setSceneBookmark).toHaveBeenLastCalledWith('Q', undefined);
  });
});

