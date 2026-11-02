/**
 * 삭제·휴지통 복원·복제·복사·붙여넣기의 되돌리기 — 2026-11-02 U4 (SPEC_GUIDE 「되돌리기 계약」·§8).
 *  - 씬 삭제(단일·다중) 되돌림 = 실제 TrashService.restoreScene → 원래 이름·자리·rebind, 다시 실행 = 재삭제(새 슬롯)
 *  - 휴지통 기록 없음(14일 경과·영구 삭제)·같은 이름 씬·다른 창 잠금 → 실패 토스트 + 폐기
 *  - 씬 휴지통 복원 기록(되돌림 = 다시 휴지통)
 *  - 이미지 삭제 되돌림 = restoreImages → 순서 병합(★ 그사이 생긴 이미지는 뒤에 유지) → 즐겨찾기 → 순위(삭제 직후와 같을 때만)
 *  - 3일 경과·같은 이름 파일 → 남은 것만 복원 + 사유별 안내, 다시 실행은 복원분만 재삭제, 여러 씬 = 1항목
 *  - 복제·복사·붙여넣기 = 새 이름(원본 형식·충돌 없음, E9) → 되돌림 = 만든 파일만 휴지통, 다시 실행 = 복원
 * 메모리 파일시스템은 undoSceneStructure.test.ts 와 같다(세션·씬은 실제 types, TrashService·copyImageFilesInto 는 실제).
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

const dirOf = (scene: { type: string; name: string }) =>
  (scene.type === 'scene' ? 'outs/P/' : 'inpaints/P/') + scene.name;

/** ImageService.refresh 와 같은 화해 규칙(목록 = 디스크, 새 파일은 뒤에, 즐겨찾기·순위 죽은 참조 정리) */
async function fakeRefresh(_s: any, scene: any) {
  const dir = dirOf(scene);
  const names = children(dir)
    .filter((n) => files.has(dir + '/' + n) && /\.(png|webp)$/.test(n))
    .sort();
  const set = new Set(names);
  const seen = new Set<string>();
  const next: string[] = [];
  for (const x of scene.imageMap as string[]) {
    if (set.has(x) && !seen.has(x)) {
      seen.add(x);
      next.push(x);
    }
  }
  for (const n of names) if (!seen.has(n)) next.push(n);
  scene.imageMap = next;
  if (scene.type === 'scene') scene.mains = scene.mains.filter((x: string) => set.has(x));
  if (scene.game && scene.game.some((p: any) => !set.has(p.path))) {
    const alive = scene.game.filter((p: any) => set.has(p.path));
    if (alive.length > 0) {
      cleanGameRanks(alive);
      scene.game = alive;
    } else scene.game = undefined;
  }
  if (scene.round && scene.round.players.some((p: string) => !set.has(p))) scene.round = undefined;
  return 'files';
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
    copyFile: jest.fn(async (a: string, b: string) => {
      if (!files.has(a)) throw new Error('ENOENT ' + a);
      files.set(b, files.get(a)!);
    }),
    deleteFile: jest.fn(async (p: string) => {
      files.delete(p);
    }),
    deleteDir: jest.fn(async (p: string) => {
      for (const k of Array.from(files.keys())) if (k === p || k.startsWith(p + '/')) files.delete(k);
    }),
    notifyGlobalStoreChanged: jest.fn(async () => {}),
  },
  isMobile: false,
  gameService: {},
  taskQueueService: { addLog: jest.fn() },
  imageService: {
    invalidateCacheBatch: jest.fn(async () => {}),
    getOutputDir: (_s: any, scene: any) => dirOf(scene),
    refresh: (s: any, scene: any) => fakeRefresh(s, scene),
  },
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
jest.mock('../appStateRef', () => ({
  getAppState: () => ({ pushMessage: jest.fn() }),
}));

import { TrashService } from '../TrashService';
import { sessionService } from '../index';
import { setWorkspaceLayoutActive } from '../storageLayout';
import { Scene, Session } from '../types';
import { undoRef, UNDO_TEXT, UndoService } from '../undoService';
import { SceneStructureOps } from '../sceneStructureUndo';
import { cleanGameRanks, mergeImageOrder, rankingForFiles } from '../imageRanking';
import { allocateImageCopyNames, copyImageFilesInto } from '../ImageService';
import {
  beginImageDelete,
  beginSceneDelete,
  copyImagesRecorded,
  deleteImageFilesRecorded,
  ImageFileOps,
  restoreSceneFromTrashRecorded,
  restoreTrashImagesRecorded,
} from '../deleteUndo';

const lockMock = sessionService.guardCrossWindowLock as jest.Mock;

// ---- 하네스 ----
function makeService() {
  const toast = jest.fn();
  const service = new UndoService({
    curSession: () => undefined,
    isMirror: () => false,
    toast,
    now: () => 1000,
  });
  return { service, toast };
}

function scene(name: string, imgs: string[] = [], extra: Record<string, unknown> = {}): Scene {
  const s = Scene.fromJSON({
    type: 'scene',
    name,
    resolution: 'portrait',
    slots: [],
    mains: [],
    imageMap: [],
    meta: {},
    round: undefined,
    game: undefined,
    ...extra,
  } as any);
  for (const f of imgs) files.set(`outs/P/${name}/${f}`, `${name}:${f}`);
  return s;
}

function makeSession(...scenes: Scene[]): Session {
  const session = new Session();
  session.name = 'P';
  for (const s of scenes) session.addScene(s);
  return session;
}

const order = (s: Session) => s.getScenes('scene').map((x) => x.name);
const trashKeys = () =>
  Object.keys(JSON.parse(files.get('trash.json') || '{"scenes":{}}').scenes).sort();

async function makeOps(): Promise<{
  trash: TrashService;
  sceneOps: SceneStructureOps;
  imageOps: ImageFileOps;
}> {
  const trash = new TrashService();
  await trash.loadTrash();
  const sceneOps: SceneStructureOps = {
    moveSceneToTrash: jest.fn((s, sc) => trash.moveSceneToTrash(s, sc)),
    restoreScene: jest.fn((s, slot) => trash.restoreScene(s, slot)),
    renameScene: jest.fn(async () => {}),
    renameInpaintScene: jest.fn(async () => true),
    getSceneBookmark: () => undefined,
    setSceneBookmark: jest.fn(async () => {}),
    hasTrashedScene: (s, slot) => trash.getDeletedScenes(s.name).some((d) => d.name === slot),
    sceneRetentionDays: 14,
  };
  const imageOps: ImageFileOps = {
    outputDir: (_s, sc) => dirOf(sc),
    deleteImageFiles: jest.fn(async (s, sc, paths) => {
      const r = await trash.moveImagesToTrashDetailed(s, sc, paths);
      await fakeRefresh(s, sc);
      return r;
    }),
    restoreImages: jest.fn((s, sc, names) => trash.restoreImages(s, sc, names)),
    refreshScene: (s, sc) => fakeRefresh(s, sc),
    setImageMain: jest.fn((_s, sc, f, on) => {
      const has = sc.mains.includes(f);
      if (on && !has) sc.mains.push(f);
      else if (!on && has) sc.mains.splice(sc.mains.indexOf(f), 1);
    }),
    applyImageOrder: (sc, ord) => {
      sc.imageMap = mergeImageOrder(sc.imageMap, ord);
      return true;
    },
    applyRanking: jest.fn((_s, sc, snap) => {
      const r = rankingForFiles(snap, sc.imageMap);
      sc.game = r.game;
      sc.round = r.round;
    }),
    copyImageFiles: (s, sc, src) => copyImageFilesInto(s, sc, src),
    imageRetentionDays: 3,
  };
  return { trash, sceneOps, imageOps };
}

beforeEach(() => {
  files.clear();
  setWorkspaceLayoutActive(false);
  lockMock.mockReset();
  lockMock.mockResolvedValue(true);
});
afterAll(() => setWorkspaceLayoutActive(false));

// ─────────────────────────────────────────────────────────────────────────────
describe('씬 삭제 — 되돌림 = 휴지통에서 원래 이름·자리로, 다시 실행 = 재삭제', () => {
  test('단일: 원래 자리·이미지 폴더·rebind, 다시 실행 = 새 슬롯으로 재삭제(확인 없음)', async () => {
    const { service, toast } = makeService();
    const { sceneOps } = await makeOps();
    const y = scene('Y', ['1.png']);
    const session = makeSession(scene('X'), y, scene('Z'));
    const rec = beginSceneDelete(session, { service, sceneOps });
    expect(await rec.trash(y)).toBe('Y');
    expect(rec.commit()).toBe(true);
    expect(service.peekLabel(session, 'undo')).toBe('씬 삭제: Y');
    expect(trashKeys()).toEqual(['P:Y']);
    expect(files.has('outs/P/.trash/Y/1.png')).toBe(true);

    expect(await service.undo(session)).toBe(true);
    expect(toast).toHaveBeenLastCalledWith(UNDO_TEXT.undone('씬 삭제: Y'), 'info');
    expect(order(session)).toEqual(['X', 'Y', 'Z']);
    const restored = session.getScene('scene', 'Y')!;
    expect(restored).not.toBe(y);
    expect(undoRef(y).current).toBe(restored); // 위·아래 항목도 새 객체를 잡는다
    expect(files.has('outs/P/Y/1.png')).toBe(true);
    expect(trashKeys()).toEqual([]);

    expect(await service.redo(session)).toBe(true);
    expect(session.hasScene('scene', 'Y')).toBe(false);
    expect(trashKeys()).toEqual(['P:Y']);
    expect(await service.undo(session)).toBe(true);
    expect(order(session)).toEqual(['X', 'Y', 'Z']);
  });

  test('다중 = 1항목, 되돌림 역순으로 원래 순서·부분 실패는 집계하고 나머지는 복원', async () => {
    const { service, toast } = makeService();
    const { sceneOps, trash } = await makeOps();
    const a = scene('A');
    const c = scene('C');
    const e = scene('E');
    const session = makeSession(a, scene('B'), c, scene('D'), e);
    const rec = beginSceneDelete(session, { service, sceneOps });
    for (const s of [a, c, e]) await rec.trash(s);
    rec.commit();
    expect(service.entries(session).past.map((x) => x.label)).toEqual(['씬 3개 삭제']);
    expect(order(session)).toEqual(['B', 'D']);

    // C 의 휴지통 기록이 영구 삭제됨(보존 기간 경과 등)
    await trash.permanentlyDeleteScene('P', 'C', 'scene');
    expect(await service.undo(session)).toBe(true);
    expect(order(session)).toEqual(['A', 'B', 'D', 'E']);
    expect(toast).toHaveBeenLastCalledWith(
      UNDO_TEXT.undone('씬 3개 삭제') + UNDO_TEXT.partial(1, 3),
      'error',
    );
    // 다시 실행은 남은 둘만
    expect(await service.redo(session)).toBe(true);
    expect(order(session)).toEqual(['B', 'D']);
  });

  test('휴지통 기록 없음(14일 경과·비우기·영구 삭제) → 실패 토스트 + 폐기', async () => {
    const { service, toast } = makeService();
    const { sceneOps, trash } = await makeOps();
    const y = scene('Y');
    const session = makeSession(scene('X'), y);
    const rec = beginSceneDelete(session, { service, sceneOps });
    await rec.trash(y);
    rec.commit();
    await trash.permanentlyDeleteScene('P', 'Y', 'scene');
    expect(await service.undo(session)).toBe(false);
    expect(toast).toHaveBeenLastCalledWith(UNDO_TEXT.undoFailed(UNDO_TEXT.sceneTrashGone(14)), 'error');
    expect(service.canUndoFor(session)).toBe(false);
  });

  test('같은 이름 씬이 그사이 생겼으면 복원하지 않고 안내(휴지통 기록 보존)', async () => {
    const { service, toast } = makeService();
    const { sceneOps } = await makeOps();
    const y = scene('Y');
    const session = makeSession(y);
    const rec = beginSceneDelete(session, { service, sceneOps });
    await rec.trash(y);
    rec.commit();
    session.addScene(scene('Y'));
    expect(await service.undo(session)).toBe(false);
    expect(toast).toHaveBeenLastCalledWith(UNDO_TEXT.undoFailed(UNDO_TEXT.sceneSlotTaken('Y')), 'error');
    expect(trashKeys()).toEqual(['P:Y']);
  });

  test('다른 창 잠금: 삭제가 막히면 기록 없음, 되돌릴 때 막히면 실패 토스트 + 폐기', async () => {
    const { service, toast } = makeService();
    const { sceneOps } = await makeOps();
    const y = scene('Y');
    const session = makeSession(y);
    lockMock.mockResolvedValue(false);
    const rec = beginSceneDelete(session, { service, sceneOps });
    expect(await rec.trash(y)).toBeUndefined();
    expect(rec.commit()).toBe(false);
    expect(session.hasScene('scene', 'Y')).toBe(true);

    lockMock.mockResolvedValue(true);
    const rec2 = beginSceneDelete(session, { service, sceneOps });
    await rec2.trash(y);
    rec2.commit();
    lockMock.mockResolvedValue(false);
    expect(await service.undo(session)).toBe(false);
    expect(toast).toHaveBeenLastCalledWith(UNDO_TEXT.undoFailed(UNDO_TEXT.sceneStructureBlocked), 'error');
    expect(session.hasScene('scene', 'Y')).toBe(false);
    expect(trashKeys()).toEqual(['P:Y']);
  });

  test('휴지통 탭 복원 기록 — 되돌림 = 다시 휴지통, 다시 실행 = 다시 꺼냄', async () => {
    const { service } = makeService();
    const { sceneOps, trash } = await makeOps();
    const y = scene('Y', ['1.png']);
    const session = makeSession(scene('X'), y);
    await trash.moveSceneToTrash(session, y); // 기록 밖(예전 삭제)
    const restored = await restoreSceneFromTrashRecorded(session, 'Y', { service, sceneOps });
    expect(restored).toBeDefined();
    expect(service.peekLabel(session, 'undo')).toBe('휴지통 복원: 씬 Y');
    expect(await service.undo(session)).toBe(true);
    expect(session.hasScene('scene', 'Y')).toBe(false);
    expect(files.has('outs/P/.trash/Y/1.png')).toBe(true);
    expect(await service.redo(session)).toBe(true);
    expect(order(session)).toEqual(['X', 'Y']);
    expect(files.has('outs/P/Y/1.png')).toBe(true);
  });

  test('씬 삭제를 되돌린 뒤 그 아래 이미지 삭제 항목도 새 씬 객체에서 되살아난다(rebind)', async () => {
    const { service } = makeService();
    const { sceneOps, imageOps } = await makeOps();
    const y = scene('Y', ['a.png', 'b.png']);
    const session = makeSession(y);
    await fakeRefresh(session, y);
    await deleteImageFilesRecorded(session, ['outs/P/Y/a.png'], y, { service, imageOps });
    const rec = beginSceneDelete(session, { service, sceneOps });
    await rec.trash(y);
    rec.commit();
    expect(await service.undo(session)).toBe(true); // 씬 복원
    expect(await service.undo(session)).toBe(true); // 이미지 복원(새 객체)
    const cur = session.getScene('scene', 'Y')!;
    expect(cur).not.toBe(y);
    expect(cur.imageMap).toEqual(['a.png', 'b.png']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('이미지 삭제 — 병합 복원(즐겨찾기·순서·순위), 사유별 실패', () => {
  async function rankedScene() {
    const s = scene('S', ['a.png', 'b.png', 'c.png', 'd.png'], {
      imageMap: ['c.png', 'a.png', 'd.png', 'b.png'],
      mains: ['a.png', 'd.png'],
      game: [
        { path: 'c.png', rank: 0 },
        { path: 'a.png', rank: 1 },
        { path: 'd.png', rank: 2 },
        { path: 'b.png', rank: 3 },
      ],
    });
    const session = makeSession(s);
    await fakeRefresh(session, s);
    return { s, session };
  }

  test('★ 삭제 뒤 생성으로 새 이미지가 생겨도 되돌림이 새 이미지를 유지하고 복원분은 원래 상대 순서', async () => {
    const { service, toast } = makeService();
    const { imageOps } = await makeOps();
    const { s, session } = await rankedScene();
    expect(
      await deleteImageFilesRecorded(session, ['outs/P/S/a.png', 'outs/P/S/d.png'], s, { service, imageOps }),
    ).toBe(0);
    expect(service.peekLabel(session, 'undo')).toBe('이미지 2장 삭제: S');
    expect(s.imageMap).toEqual(['c.png', 'b.png']);
    expect(s.mains).toEqual([]);

    // 생성 결과로 새 이미지가 추가됨
    files.set('outs/P/S/n1.png', 'new');
    await fakeRefresh(session, s);
    expect(s.imageMap).toEqual(['c.png', 'b.png', 'n1.png']);

    expect(await service.undo(session)).toBe(true);
    expect(toast).toHaveBeenLastCalledWith(UNDO_TEXT.undone('이미지 2장 삭제: S'), 'info');
    expect(s.imageMap).toEqual(['c.png', 'a.png', 'd.png', 'b.png', 'n1.png']);
    expect([...s.mains].sort()).toEqual(['a.png', 'd.png']);
    expect(s.game!.map((p) => [p.path, p.rank])).toEqual([
      ['c.png', 0],
      ['a.png', 1],
      ['d.png', 2],
      ['b.png', 3],
    ]);
    expect(files.has('outs/P/S/n1.png')).toBe(true);

    // 다시 실행 = 같은 두 장만 휴지통으로(새 이미지는 그대로)
    expect(await service.redo(session)).toBe(true);
    expect(s.imageMap).toEqual(['c.png', 'b.png', 'n1.png']);
    expect(files.has('outs/P/S/.trash/a.png')).toBe(true);
  });

  test('순위가 삭제 뒤 바뀌었으면 순위는 건너뛰고 안내(이미지·즐겨찾기는 복원)', async () => {
    const { service, toast } = makeService();
    const { imageOps } = await makeOps();
    const { s, session } = await rankedScene();
    await deleteImageFilesRecorded(session, ['outs/P/S/a.png'], s, { service, imageOps });
    s.game = undefined; // 그사이 순위 초기화(기록 밖)
    expect(await service.undo(session)).toBe(true);
    expect(toast).toHaveBeenLastCalledWith(
      UNDO_TEXT.undone('이미지 1장 삭제: S') + ` (${UNDO_TEXT.rankingNotRestored})`,
      'info',
    );
    expect(s.game).toBeUndefined();
    expect(s.imageMap).toContain('a.png');
    expect(s.mains).toContain('a.png');
  });

  test('3일 경과·같은 이름 파일 → 남은 것만 복원 + 사유별 안내, 다시 실행은 복원분만', async () => {
    const { service, toast } = makeService();
    const { imageOps } = await makeOps();
    const { s, session } = await rankedScene();
    await deleteImageFilesRecorded(
      session,
      ['outs/P/S/a.png', 'outs/P/S/b.png', 'outs/P/S/c.png'],
      s,
      { service, imageOps },
    );
    files.delete('outs/P/S/.trash/b.png'); // 자동 정리(3일)·비우기
    files.set('outs/P/S/c.png', 'other'); // 원래 자리에 같은 이름 파일
    expect(await service.undo(session)).toBe(true);
    expect(toast).toHaveBeenLastCalledWith(
      UNDO_TEXT.undone('이미지 3장 삭제: S') +
        ` (${UNDO_TEXT.imagesTrashGone(1, 3)} · ${UNDO_TEXT.imagesRestoreBlocked(1)})`,
      'error',
    );
    expect(files.get('outs/P/S/a.png')).toBe('S:a.png');
    expect(files.get('outs/P/S/c.png')).toBe('other'); // 덮어쓰지 않음
    (imageOps.deleteImageFiles as jest.Mock).mockClear();
    expect(await service.redo(session)).toBe(true);
    expect((imageOps.deleteImageFiles as jest.Mock).mock.calls[0][2]).toEqual(['outs/P/S/a.png']);
    expect(files.get('outs/P/S/c.png')).toBe('other');
  });

  test('전부 휴지통에서 사라졌으면 그 항목만 버리고 이유를 알린다', async () => {
    const { service, toast } = makeService();
    const { imageOps } = await makeOps();
    const { s, session } = await rankedScene();
    await deleteImageFilesRecorded(session, ['outs/P/S/a.png'], s, { service, imageOps });
    files.delete('outs/P/S/.trash/a.png');
    expect(await service.undo(session)).toBe(false);
    expect(toast).toHaveBeenLastCalledWith(UNDO_TEXT.undoFailed(UNDO_TEXT.imagesTrashGone(1, 3)), 'error');
    expect(service.canUndoFor(session)).toBe(false);
  });

  test('여러 씬 일괄 삭제 = 1항목, 되돌림이 씬마다 복원', async () => {
    const { service } = makeService();
    const { imageOps } = await makeOps();
    const s1 = scene('S1', ['a.png', 'b.png']);
    const s2 = scene('S2', ['x.png']);
    const session = makeSession(s1, s2);
    await fakeRefresh(session, s1);
    await fakeRefresh(session, s2);
    const rec = beginImageDelete(session, { service, imageOps });
    await rec.delete(s1, ['outs/P/S1/a.png', 'outs/P/S1/b.png'], { notify: false });
    await rec.delete(s2, ['outs/P/S2/x.png'], { notify: false });
    await rec.delete(s2, [], { notify: false }); // 0장 씬은 기록에 들어가지 않음
    expect(rec.commit()).toBe(true);
    expect(service.entries(session).past.map((x) => x.label)).toEqual(['이미지 3장 삭제(2개 씬)']);
    expect(s1.imageMap).toEqual([]);
    expect(await service.undo(session)).toBe(true);
    expect(s1.imageMap).toEqual(['a.png', 'b.png']);
    expect(s2.imageMap).toEqual(['x.png']);
  });

  test('옮겨진 것이 없으면(이동 실패) 기록하지 않는다', async () => {
    const { service } = makeService();
    const { imageOps } = await makeOps();
    const { s, session } = await rankedScene();
    expect(await deleteImageFilesRecorded(session, ['outs/P/S/zz.png'], s, { service, imageOps })).toBe(1);
    expect(service.canUndoFor(session)).toBe(false);
  });

  test('휴지통 탭 이미지 복원 기록 — 되돌림 = 다시 휴지통, 다시 실행 = 다시 꺼냄', async () => {
    const { service } = makeService();
    const { imageOps, trash } = await makeOps();
    const { s, session } = await rankedScene();
    await trash.moveImagesToTrashDetailed(session, s, ['outs/P/S/a.png']); // 기록 밖
    await fakeRefresh(session, s);
    const r = await restoreTrashImagesRecorded(session, s, ['a.png'], { service, imageOps });
    expect(r).toEqual({ restored: ['a.png'], failed: [], missing: [] });
    await fakeRefresh(session, s); // 호출부(RV·검수)가 하던 목록 갱신
    expect(service.peekLabel(session, 'undo')).toBe('휴지통 복원: 이미지 1장(S)');
    expect(await service.undo(session)).toBe(true);
    expect(s.imageMap).not.toContain('a.png');
    expect(files.has('outs/P/S/.trash/a.png')).toBe(true);
    expect(await service.redo(session)).toBe(true);
    expect(s.imageMap).toContain('a.png');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('이미지 복제·복사·붙여넣기 — 새 이름 반환(E9)·되돌림 = 만든 파일만 휴지통', () => {
  test('allocateImageCopyNames: 원본 형식 유지·기존·이번 이름과 겹치지 않음', () => {
    expect(
      allocateImageCopyNames(
        ['outs/P/S/a.png', 'outs/P/S/b.webp', 'outs/P/S/c.PNG', 'outs/P/S/d.jpg'],
        ['123_0.png', '123_2.PNG'],
        123,
      ),
    ).toEqual(['123_1.png', '123_2.webp', '123_3.png', '123_4.png']); // 123_2.PNG 와는 확장자가 달라 안 겹침
  });

  test('복제: 같은 ms 여러 장도 덮어쓰지 않고, 되돌림 = 만든 것만 휴지통, 다시 실행 = 복원', async () => {
    const { service } = makeService();
    const { imageOps } = await makeOps();
    const s = scene('S', ['a.png', 'w.webp']);
    const session = makeSession(s);
    await fakeRefresh(session, s);
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(777);
    files.set('outs/P/S/777_0.png', 'existing'); // 이미 있는 이름
    await fakeRefresh(session, s);
    const r = await copyImagesRecorded(
      session,
      s,
      ['outs/P/S/a.png', 'outs/P/S/a.png', 'outs/P/S/w.webp'],
      'duplicate',
      { service, imageOps },
    );
    nowSpy.mockRestore();
    expect(r.created).toEqual(['777_1.png', '777_2.png', '777_3.webp']);
    expect(files.get('outs/P/S/777_0.png')).toBe('existing');
    expect(files.get('outs/P/S/777_3.webp')).toBe('S:w.webp');
    expect(service.peekLabel(session, 'undo')).toBe('이미지 복제 3장: S');

    expect(await service.undo(session)).toBe(true);
    expect(s.imageMap.sort()).toEqual(['777_0.png', 'a.png', 'w.webp']);
    expect(files.has('outs/P/S/.trash/777_3.webp')).toBe(true);
    expect(await service.redo(session)).toBe(true);
    expect(s.imageMap).toEqual(expect.arrayContaining(['777_1.png', '777_2.png', '777_3.webp']));
  });

  test('다른 씬으로 복사·붙여넣기: 대상 씬 기준 기록, 원본은 그대로', async () => {
    const { service } = makeService();
    const { imageOps } = await makeOps();
    const src = scene('A', ['x.webp']);
    const dst = scene('B');
    const session = makeSession(src, dst);
    await fakeRefresh(session, src);
    const r = await copyImagesRecorded(session, dst, ['outs/P/A/x.webp'], 'copy', { service, imageOps });
    expect(r.created).toHaveLength(1);
    expect(r.created[0].endsWith('.webp')).toBe(true);
    expect(service.peekLabel(session, 'undo')).toBe('이미지 1장 다른 씬으로 복사: B');
    const p = await copyImagesRecorded(session, dst, ['outs/P/A/x.webp'], 'paste', { service, imageOps });
    expect(p.created[0]).not.toBe(r.created[0]);
    expect(service.peekLabel(session, 'undo')).toBe('이미지 붙여넣기 1장: B');
    expect(await service.undo(session)).toBe(true);
    expect(await service.undo(session)).toBe(true);
    expect(dst.imageMap).toEqual([]);
    expect(src.imageMap).toEqual(['x.webp']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('비동기 대기 정책 — 실행 중 다른 동작의 기록이 사라지지 않는다', () => {
  test('이미지 삭제 되돌림을 기다리는 동안의 기록은 끝난 뒤 쌓인다(순서 보존)', async () => {
    const { service } = makeService();
    const { imageOps } = await makeOps();
    const s = scene('S', ['a.png']);
    const session = makeSession(s);
    await fakeRefresh(session, s);
    await deleteImageFilesRecorded(session, ['outs/P/S/a.png'], s, { service, imageOps });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const realRestore = imageOps.restoreImages;
    imageOps.restoreImages = async (...args) => {
      await gate;
      return realRestore(...args);
    };
    const running = service.undo(session);
    await Promise.resolve();
    expect(service.isBusy).toBe(true);
    // 기다리는 동안 사용자가 시드를 바꿈
    service.set(session, s, 'sceneSeed', 42 as any, '시드');
    expect(service.isApplying).toBe(false);
    release();
    expect(await running).toBe(true);
    const { past, future } = service.entries(session);
    expect(past.map((e) => e.label)).toEqual(['시드']);
    expect(future).toHaveLength(0); // 새 동작이 생겼으므로 다시 실행은 비워진다(표준)
    expect(await service.undo(session)).toBe(true);
    expect(s.sceneSeed).toBeUndefined();
  });
});
