/**
 * 이미지 상태 작업의 되돌리기 — 2026-11-01 U3a (SPEC_GUIDE 「되돌리기 계약」).
 *  - 즐겨찾기: 단일·선택 일괄·지정·전부 해제·상위 n등 = 실제 setImageMain 절대값(다른 창 알림 notifySessionOp 포함)
 *  - 북마크: setImageBookmark 절대값(이전 값 ↔ 이후 값)
 *  - ★ 순서: 기록 뒤 생성으로 새 이미지가 생긴 상태에서 되돌림 → 새 이미지 유지·순서만 복원, 사라진 이미지 건너뜀
 *  - 순위 초기화·대진 리롤: 지금 있는 파일의 참가자만·round 새 객체, 그사이 매치 진행이면 D16 확인
 *  - 생성 설정 적용: 세션 부분만(추가 프롬프트·그림체·공용 설정·씬 조합·새 그림체 추가) 1항목, D16
 * 순서·순위 복원은 실제 GameService.applyImageOrder·applyRanking(병합 복원)을 쓴다.
 */
const notifySessionOp = jest.fn(async (_op: unknown) => {});

jest.mock('..', () => ({
  backend: { notifySessionOp: (op: unknown) => notifySessionOp(op) },
  imageService: {
    addEventListener: jest.fn(),
    getOutputs: (_s: unknown, scene: { imageMap: string[] }) => [...scene.imageMap],
  },
  gameService: {},
  taskQueueService: { addLog: jest.fn() },
  workFlowService: {},
  isMobile: false,
}));

import { makeAutoObservable } from 'mobx';
import { GameService } from '../GameService';
import { setImageMain } from '../ImageService';
import {
  cleanGameRanks,
  cloneRanking,
  mergeImageOrder,
  rankingForFiles,
  sameRanking,
} from '../imageRanking';
import {
  beginMetaApplyRecord,
  ImageStateOps,
  recordImageOrder,
  recordRanking,
  setFavoritesInScenes,
  setImageFavorites,
  toggleImageBookmarkRecorded,
  toggleImageFavorite,
} from '../imageStateUndo';
import { PromptPiece, Scene, Session, VibeItem } from '../types';
import { UNDO_TEXT, UndoService } from '../undoService';

interface Harness {
  service: UndoService;
  toast: jest.Mock;
  confirm: jest.Mock<Promise<boolean>, [string, string]>;
  mirror: { on: boolean };
}

function harness(): Harness {
  const toast = jest.fn();
  const confirm = jest.fn<Promise<boolean>, [string, string]>(async () => true);
  const mirror = { on: false };
  const service = new UndoService({
    curSession: () => undefined,
    isMirror: () => mirror.on,
    toast,
    now: () => 1000,
    confirm,
  });
  return { service, toast, confirm, mirror };
}

const bookmarks = new Map<string, string>();
const game = new GameService();
const refreshScene = jest.fn(async (_s: Session, _sc: unknown) => {});
const restored = jest.fn();
game.addEventListener('ranking-restored', (e) => restored((e as CustomEvent).detail.scene));

const setMain = jest.fn((s: Session, sc: Scene, f: string, on: boolean) => setImageMain(s, sc, f, on));
const setBookmark = jest.fn(async (p: string, sc: string, f: string | undefined) => {
  if (f) bookmarks.set(p + ':' + sc, f);
  else bookmarks.delete(p + ':' + sc);
});

const ops: ImageStateOps = {
  setImageMain: (s, sc, f, on) => setMain(s, sc as Scene, f, on),
  getImageBookmark: (p, sc) => bookmarks.get(p + ':' + sc),
  setImageBookmark: (p, sc, f) => setBookmark(p, sc, f),
  applyImageOrder: (sc, order) => game.applyImageOrder(sc, order),
  applyRanking: (s, sc, snap) => game.applyRanking(s, sc, snap),
  refreshScene: (s, sc) => refreshScene(s, sc),
};

function makeSession(...names: string[]): { session: Session; scenes: Scene[] } {
  const session = new Session();
  session.name = 'p';
  const scenes = names.map((name) => {
    const scene = new Scene();
    scene.name = name;
    scene.slots = [[PromptPiece.fromJSON({ prompt: 'a', characterPrompts: [], enabled: true, id: name + '-1' })]];
    scene.imageMap = ['a.png', 'b.png', 'c.png', 'd.png'];
    scene.mains = [];
    session.addScene(scene);
    return scene;
  });
  return { session, scenes };
}

beforeEach(() => {
  notifySessionOp.mockClear();
  setMain.mockClear();
  setBookmark.mockClear();
  refreshScene.mockClear();
  restored.mockClear();
  bookmarks.clear();
});

// ── 순수 계산 ──
describe('imageRanking 순수 계산', () => {
  test('mergeImageOrder — 기록 순서대로, 없는 것 건너뜀, 새 이미지는 지금 상대 순서로 뒤에', () => {
    expect(mergeImageOrder(['a', 'd', 'b', 'e', 'f'], ['a', 'b', 'c', 'd'])).toEqual(['a', 'b', 'd', 'e', 'f']);
    expect(mergeImageOrder(['x'], [])).toEqual(['x']);
  });

  test('rankingForFiles — 있는 파일만·결번 정규화·round 는 참가자가 모두 있을 때만(새 객체)', () => {
    const snap = {
      game: [
        { path: 'a', rank: 0 },
        { path: 'b', rank: 1 },
        { path: 'c', rank: 1 },
        { path: 'd', rank: 3 },
      ],
      round: { players: ['b', 'c'], winMask: [false, false], curPlayer: 0 },
    };
    const all = rankingForFiles(snap, ['a', 'b', 'c', 'd']);
    expect(all.game).toEqual(snap.game);
    expect(all.game).not.toBe(snap.game);
    expect(all.round).toEqual(snap.round);
    expect(all.round).not.toBe(snap.round);
    const noC = rankingForFiles(snap, ['a', 'b', 'd']);
    const expected = [
      { path: 'a', rank: 0 },
      { path: 'b', rank: 1 },
      { path: 'd', rank: 3 },
    ];
    cleanGameRanks(expected);
    expect(noC.game).toEqual(expected);
    expect(noC.round).toBeUndefined();
    expect(rankingForFiles(snap, []).game).toBeUndefined();
  });

  test('sameRanking 은 game 정렬 순서와 무관', () => {
    const a = { game: [{ path: 'a', rank: 0 }, { path: 'b', rank: 1 }] };
    const b = { game: [{ path: 'b', rank: 1 }, { path: 'a', rank: 0 }] };
    expect(sameRanking(a, b)).toBe(true);
    expect(sameRanking(a, { game: [] })).toBe(false);
    expect(sameRanking({ game: [] }, {})).toBe(true);
  });
});

// ── 즐겨찾기 ──
describe('즐겨찾기 — setImageMain 절대값·다른 창 알림', () => {
  test('단일 토글 → 되돌림(해제)·다시 실행(지정), 알림도 절대값', async () => {
    const { service } = harness();
    const { session, scenes } = makeSession('A');
    const [a] = scenes;
    toggleImageFavorite(session, a, 'b.png', { service, ops });
    expect(a.mains).toEqual(['b.png']);
    expect(service.entries(session).past.map((e) => e.label)).toEqual([UNDO_TEXT.imageFavoriteOn('A', 1)]);
    notifySessionOp.mockClear();
    await service.undo(session);
    expect(a.mains).toEqual([]);
    expect(setMain).toHaveBeenLastCalledWith(session, a, 'b.png', false);
    expect(notifySessionOp).toHaveBeenCalledWith(
      expect.objectContaining({ op: 'set-main', filename: 'b.png', on: false, sceneName: 'A', project: 'p' }),
    );
    await service.redo(session);
    expect(a.mains).toEqual(['b.png']);
    expect(notifySessionOp).toHaveBeenLastCalledWith(expect.objectContaining({ filename: 'b.png', on: true }));
  });

  test('선택 일괄 전환(섞임) = 1항목, 되돌림은 파일마다 이전 값', async () => {
    const { service } = harness();
    const { session, scenes } = makeSession('A');
    const [a] = scenes;
    a.mains = ['a.png'];
    setImageFavorites(session, a, ['a.png', 'c.png'], 'toggle', { service, ops });
    expect(a.mains).toEqual(['c.png']);
    const past = service.entries(session).past;
    expect(past).toHaveLength(1);
    expect(past[0].label).toBe(UNDO_TEXT.imageFavoriteToggle('A', 2));
    await service.undo(session);
    expect([...a.mains].sort()).toEqual(['a.png']);
    await service.redo(session);
    expect(a.mains).toEqual(['c.png']);
  });

  test('즐겨찾기 지정(이미 지정)이면 기록 없음, 세션에 없는 씬·미러도 기록 없음', () => {
    const { service, mirror } = harness();
    const { session, scenes } = makeSession('A');
    const [a] = scenes;
    a.mains = ['a.png'];
    setImageFavorites(session, a, ['a.png'], true, { service, ops });
    expect(service.entries(session).past).toHaveLength(0);
    expect(setMain).toHaveBeenCalledWith(session, a, 'a.png', true); // 호출 자체(알림)는 그대로
    const loose = new Scene();
    loose.name = 'loose';
    loose.imageMap = ['x.png'];
    toggleImageFavorite(session, loose, 'x.png', { service, ops });
    expect(loose.mains).toEqual(['x.png']);
    expect(service.entries(session).past).toHaveLength(0);
    mirror.on = true;
    toggleImageFavorite(session, a, 'b.png', { service, ops });
    expect(a.mains).toContain('b.png');
    expect(service.entries(session).past).toHaveLength(0);
  });

  test('전부 해제(여러 씬) = 1항목, 되돌림은 해제했던 파일만 — 그사이 사라진 이미지는 다시 지정하지 않음', async () => {
    const { service } = harness();
    const { session, scenes } = makeSession('A', 'B', 'C');
    const [a, b, c] = scenes;
    a.mains = ['a.png', 'b.png'];
    b.mains = ['d.png'];
    notifySessionOp.mockClear();
    setFavoritesInScenes(
      session,
      scenes.map((scene) => ({ scene, filenames: [...scene.mains], on: false })),
      UNDO_TEXT.favoritesClearAll(2),
      { service, ops },
    );
    expect(a.mains).toEqual([]);
    expect(b.mains).toEqual([]);
    expect(c.mains).toEqual([]);
    // 예전 직접 대입(scene.mains = [])은 알림이 없었다(E13) — 이제 파일마다 알림
    expect(notifySessionOp).toHaveBeenCalledTimes(3);
    expect(service.entries(session).past).toHaveLength(1);
    // 그사이 생성으로 새 이미지·새 즐겨찾기, 그리고 b.png 삭제
    a.imageMap = ['a.png', 'c.png', 'd.png', 'new.png'];
    a.mains.push('new.png');
    await service.undo(session);
    expect([...a.mains].sort()).toEqual(['a.png', 'new.png']);
    expect(b.mains).toEqual(['d.png']);
    await service.redo(session);
    expect(a.mains).toEqual(['new.png']);
    expect(b.mains).toEqual([]);
  });

  test('상위 n등 지정 — 기존 즐겨찾기 뒤에 추가(중복 제외), 되돌림은 새로 지정한 것만 해제', async () => {
    const { service } = harness();
    const { session, scenes } = makeSession('A');
    const [a] = scenes;
    a.mains = ['c.png'];
    setFavoritesInScenes(
      session,
      [{ scene: a, filenames: ['d.png', 'c.png'], on: true }],
      UNDO_TEXT.favoritesTopN(2, 1),
      { service, ops },
    );
    expect(a.mains).toEqual(['c.png', 'd.png']);
    await service.undo(session);
    expect(a.mains).toEqual(['c.png']);
    await service.redo(session);
    expect(a.mains).toEqual(['c.png', 'd.png']);
  });

  test('씬이 세션에서 빠지면 그 항목만 실패·폐기', async () => {
    const { service, toast } = harness();
    const { session, scenes } = makeSession('A');
    const [a] = scenes;
    toggleImageFavorite(session, a, 'a.png', { service, ops });
    session.scenes.delete('A');
    expect(await service.undo(session)).toBe(false);
    expect(toast).toHaveBeenCalledWith(UNDO_TEXT.undoFailed(UNDO_TEXT.sceneGone('A')), 'error');
    expect(service.entries(session).past).toHaveLength(0);
  });
});

// ── 북마크 ──
describe('이미지 북마크 — setImageBookmark 절대값', () => {
  test('다른 이미지 북마크가 있던 씬에서 지정 → 되돌림은 이전 파일로, 다시 실행은 새 파일로', async () => {
    const { service } = harness();
    const { session, scenes } = makeSession('A');
    const [a] = scenes;
    bookmarks.set('p:A', 'a.png');
    await toggleImageBookmarkRecorded(session, a, 'c.png', { service, ops });
    expect(bookmarks.get('p:A')).toBe('c.png');
    expect(service.entries(session).past[0].label).toBe(UNDO_TEXT.imageBookmarkOn('A'));
    await service.undo(session);
    expect(setBookmark).toHaveBeenLastCalledWith('p', 'A', 'a.png');
    expect(bookmarks.get('p:A')).toBe('a.png');
    await service.redo(session);
    expect(bookmarks.get('p:A')).toBe('c.png');
  });

  test('해제 → 되돌림은 다시 지정', async () => {
    const { service } = harness();
    const { session, scenes } = makeSession('A');
    const [a] = scenes;
    bookmarks.set('p:A', 'b.png');
    await toggleImageBookmarkRecorded(session, a, 'b.png', { service, ops });
    expect(bookmarks.has('p:A')).toBe(false);
    expect(service.entries(session).past[0].label).toBe(UNDO_TEXT.imageBookmarkOff('A'));
    await service.undo(session);
    expect(bookmarks.get('p:A')).toBe('b.png');
  });
});

// ── 순서 ──
describe('그리드 드래그 순서 — 병합 복원', () => {
  const dragDBeforeB = (scene: Scene) => async () => {
    scene.imageMap.splice(scene.imageMap.indexOf('d.png'), 1);
    scene.imageMap.splice(scene.imageMap.indexOf('b.png'), 0, 'd.png');
  };

  test('★ 기록 뒤 생성으로 새 이미지가 추가된 상태에서 되돌림 → 새 이미지 유지·순서만 복원', async () => {
    const { service, confirm } = harness();
    const { session, scenes } = makeSession('A');
    const [a] = scenes;
    await recordImageOrder(session, a, dragDBeforeB(a), { service, ops });
    expect(a.imageMap).toEqual(['a.png', 'd.png', 'b.png', 'c.png']);
    expect(service.entries(session).past.map((e) => e.label)).toEqual([UNDO_TEXT.imageOrderDrag('A')]);
    // 생성 중: 새 이미지 두 장이 들어오고 하나는 즐겨찾기(refresh 가 끝에 붙인다)
    a.imageMap = [...a.imageMap, 'e.png', 'f.png'];
    a.mains.push('e.png');
    await service.undo(session);
    expect(a.imageMap).toEqual(['a.png', 'b.png', 'c.png', 'd.png', 'e.png', 'f.png']);
    expect(a.mains).toEqual(['e.png']);
    expect(refreshScene).toHaveBeenCalledWith(session, a);
    expect(confirm).not.toHaveBeenCalled(); // 순서는 병합이라 겹침 확인 없음
    await service.redo(session);
    expect(a.imageMap).toEqual(['a.png', 'd.png', 'b.png', 'c.png', 'e.png', 'f.png']);
  });

  test('그사이 사라진 이미지는 건너뛴다', async () => {
    const { service } = harness();
    const { session, scenes } = makeSession('A');
    const [a] = scenes;
    await recordImageOrder(session, a, dragDBeforeB(a), { service, ops });
    a.imageMap = a.imageMap.filter((f) => f !== 'c.png').concat(['g.png']);
    await service.undo(session);
    expect(a.imageMap).toEqual(['a.png', 'b.png', 'd.png', 'g.png']);
  });

  test('변화가 없으면 기록하지 않는다', async () => {
    const { service } = harness();
    const { session, scenes } = makeSession('A');
    await recordImageOrder(session, scenes[0], async () => {}, { service, ops });
    expect(service.entries(session).past).toHaveLength(0);
  });

  test('순위가 함께 바뀐 드래그 — 순위도 지금 파일에 맞춰 복원, 그사이 매치 진행이면 D16 확인(취소 = 유지)', async () => {
    const { service, confirm } = harness();
    const { session, scenes } = makeSession('A');
    const [a] = scenes;
    a.game = [
      { path: 'a.png', rank: 0 },
      { path: 'b.png', rank: 1 },
      { path: 'c.png', rank: 1 },
      { path: 'd.png', rank: 1 },
    ];
    const round = { players: ['b.png', 'c.png'], winMask: [false, false], curPlayer: 0 };
    a.round = round;
    await recordImageOrder(
      session,
      a,
      async () => {
        // ResultViewer 드롭과 같은 꼴: d 를 a 의 순위로, round 해제
        a.game!.splice(a.game!.findIndex((p) => p.path === 'd.png'), 1);
        a.game!.push({ path: 'd.png', rank: 0 });
        cleanGameRanks(a.game!);
        a.round = undefined;
        await dragDBeforeB(a)();
      },
      { service, ops },
    );
    // 기록 밖: 순위 제자리 수정(월드컵 진행 흉내)
    a.game!.find((p) => p.path === 'b.png')!.rank = 0;
    confirm.mockResolvedValueOnce(false);
    expect(await service.undo(session)).toBe(false);
    expect(confirm).toHaveBeenCalledWith(UNDO_TEXT.conflictUndo(UNDO_TEXT.imageOrderDrag('A')), UNDO_TEXT.undoName);
    expect(service.entries(session).past).toHaveLength(1);
    expect(await service.undo(session)).toBe(true);
    expect(a.imageMap).toEqual(['a.png', 'b.png', 'c.png', 'd.png']);
    expect(sameRanking(cloneRanking(a), { game: [
      { path: 'a.png', rank: 0 },
      { path: 'b.png', rank: 1 },
      { path: 'c.png', rank: 1 },
      { path: 'd.png', rank: 1 },
    ], round })).toBe(true);
    expect(a.round).not.toBe(round);
    expect(restored).toHaveBeenCalledWith(a);
  });
});

// ── 순위 초기화·대진 리롤 ──
describe('순위 초기화·대진 리롤 — 지금 파일만·round 새 객체', () => {
  function seedGame(a: Scene) {
    a.game = [
      { path: 'a.png', rank: 0 },
      { path: 'b.png', rank: 1 },
      { path: 'c.png', rank: 2 },
      { path: 'd.png', rank: 2 },
    ];
    a.round = { players: ['c.png', 'd.png'], winMask: [false, false], curPlayer: 0 };
  }

  test('초기화 되돌림 — 그사이 삭제된 이미지는 빼고(결번 정규화), 생성된 이미지는 순위에 넣지 않음, round 는 새 객체', async () => {
    const { service, confirm } = harness();
    const { session, scenes } = makeSession('A');
    const [a] = scenes;
    seedGame(a);
    const oldRound = a.round!;
    await recordRanking(
      session,
      a,
      UNDO_TEXT.rankingReset('A'),
      async () => {
        a.game = a.imageMap.map((path) => ({ path, rank: 3 }));
        a.round = { players: ['b.png', 'a.png', 'c.png', 'd.png'], winMask: [false, false, false, false], curPlayer: 0 };
      },
      { service, ops },
    );
    expect(service.entries(session).past.map((e) => e.label)).toEqual([UNDO_TEXT.rankingReset('A')]);
    // 생성으로 e 추가, b 삭제(refresh 의 자가 화해: game 거르고 결번 정규화, round 해제)
    a.imageMap = ['a.png', 'c.png', 'd.png', 'e.png'];
    const alive = a.game!.filter((p) => p.path !== 'b.png');
    cleanGameRanks(alive);
    a.game = alive;
    a.round = undefined;
    await service.undo(session);
    expect(confirm).not.toHaveBeenCalled(); // 자가 화해는 겹침이 아니다
    const expected = [
      { path: 'a.png', rank: 0 },
      { path: 'c.png', rank: 2 },
      { path: 'd.png', rank: 2 },
    ];
    cleanGameRanks(expected);
    expect(sameRanking({ game: a.game }, { game: expected })).toBe(true);
    expect(a.game!.some((p) => p.path === 'e.png')).toBe(false);
    expect(a.round).toEqual(oldRound); // c·d 가 있으므로 대진 복원
    expect(a.round).not.toBe(oldRound);
    expect(a.imageMap).toEqual(['a.png', 'c.png', 'd.png', 'e.png']); // 이미지 목록은 건드리지 않음
    expect(restored).toHaveBeenCalledWith(a);
  });

  test('대진 리롤(round 제자리 수정) 되돌림 — 새 round 객체로 이전 대진', async () => {
    const { service } = harness();
    const { session, scenes } = makeSession('A');
    const [a] = scenes;
    seedGame(a);
    a.round = { players: ['b.png', 'c.png', 'd.png', 'a.png'], winMask: [false, false, false, false], curPlayer: 0 };
    const live = a.round;
    await recordRanking(
      session,
      a,
      UNDO_TEXT.rankingReroll('A'),
      () => {
        live.players = ['d.png', 'a.png', 'b.png', 'c.png'];
      },
      { service, ops },
    );
    expect(service.entries(session).past).toHaveLength(1);
    await service.undo(session);
    expect(a.round!.players).toEqual(['b.png', 'c.png', 'd.png', 'a.png']);
    expect(a.round).not.toBe(live);
    await service.redo(session);
    expect(a.round!.players).toEqual(['d.png', 'a.png', 'b.png', 'c.png']);
  });

  test('초기화 뒤 매치를 진행했으면 D16 확인 — 확인 = 이후 진행도 함께 되돌아감', async () => {
    const { service, confirm } = harness();
    const { session, scenes } = makeSession('A');
    const [a] = scenes;
    seedGame(a);
    await recordRanking(
      session,
      a,
      UNDO_TEXT.rankingReset('A'),
      () => {
        a.game = a.imageMap.map((path) => ({ path, rank: 3 }));
        a.round = { players: ['a.png', 'b.png', 'c.png', 'd.png'], winMask: [false, false, false, false], curPlayer: 0 };
      },
      { service, ops },
    );
    a.round!.winMask[0] = true; // 기록 밖 제자리 진행
    a.round!.curPlayer = 2;
    await service.undo(session);
    expect(confirm).toHaveBeenCalledWith(UNDO_TEXT.conflictUndo(UNDO_TEXT.rankingReset('A')), UNDO_TEXT.undoName);
    expect(a.round!.players).toEqual(['c.png', 'd.png']);
  });
});

// ── 생성 설정 적용 ──
describe('생성 설정 적용 — 세션 부분만 1항목', () => {
  function presetObj() {
    return {
      type: 'SDImageGen',
      name: 'cur',
      frontPrompt: 'front',
      backPrompt: 'back',
      uc: 'uc',
      characterPrompts: [] as unknown[],
      steps: 28,
    };
  }

  test('추가 프롬프트·그림체·공용 설정(바이브 클래스 복원)·씬 조합을 되돌리고 다시 실행', async () => {
    const { service } = harness();
    const { session, scenes } = makeSession('A');
    const [a] = scenes;
    session.extraPrompt = 'extra-old';
    const preset = presetObj();
    const shared = { seed: 1, vibes: [VibeItem.fromJSON({ path: 'v1.png', info: 1, strength: 0.5 } as never)], normalizeStrength: true };
    const rec = beginMetaApplyRecord(session, { service });
    rec.preset(preset);
    rec.scene(a, ['slots']);
    session.extraPrompt = 'extra-new';
    preset.frontPrompt = 'front-new';
    preset.steps = 40;
    a.slots = [[PromptPiece.fromJSON({ prompt: 'meta', characterPrompts: [], enabled: true, id: 'm1' })]];
    rec.shared(shared);
    shared.seed = 99;
    shared.vibes = [];
    expect(rec.commit()).toBe(true);
    const past = service.entries(session).past;
    expect(past).toHaveLength(1);
    expect(past[0].label).toBe(UNDO_TEXT.metaApply);
    await service.undo(session);
    expect(session.extraPrompt).toBe('extra-old');
    expect(preset.frontPrompt).toBe('front');
    expect(preset.steps).toBe(28);
    expect(a.slots[0][0].prompt).toBe('a');
    expect(shared.seed).toBe(1);
    expect(shared.vibes[0]).toBeInstanceOf(VibeItem);
    expect(shared.vibes[0].path).toBe('v1.png');
    expect(a.imageMap).toEqual(['a.png', 'b.png', 'c.png', 'd.png']);
    await service.redo(session);
    expect(session.extraPrompt).toBe('extra-new');
    expect(preset.frontPrompt).toBe('front-new');
    expect(shared.vibes).toEqual([]);
  });

  test('새 그림체로 적용 — 되돌림은 추가한 그림체 제거·선택 복원, 다시 실행은 같은 객체 재추가', async () => {
    const { service } = harness();
    const { session } = makeSession('A');
    // 실제 그림체는 makeAutoObservable 객체(WorkFlow.createMobxObject) — 관찰 배열에 넣어도 같은 객체로 남는다
    const old = makeAutoObservable({ ...presetObj(), name: 'old' });
    session.presets.set('SDImageGen', [old]);
    session.selectedWorkflow = { workflowType: 'SDImageGen', presetName: 'old' };
    const rec = beginMetaApplyRecord(session, { service });
    const added = makeAutoObservable({ ...presetObj(), name: 'external image' });
    const prev = session.selectedWorkflow;
    session.addPreset(added);
    session.selectedWorkflow = { workflowType: 'SDImageGen', presetName: added.name };
    rec.presetAdded(added, prev);
    expect(rec.commit()).toBe(true);
    await service.undo(session);
    expect(session.presets.get('SDImageGen')).toEqual([old]);
    expect(session.selectedWorkflow).toEqual({ workflowType: 'SDImageGen', presetName: 'old' });
    await service.redo(session);
    expect(session.presets.get('SDImageGen')![1]).toBe(added);
    expect(session.selectedWorkflow).toEqual({ workflowType: 'SDImageGen', presetName: 'external image' });
  });

  test('아무것도 안 바뀌면 기록 없음, 미러면 기록기 자체가 무동작', () => {
    const { service, mirror } = harness();
    const { session } = makeSession('A');
    const rec = beginMetaApplyRecord(session, { service });
    rec.preset(presetObj());
    expect(rec.commit()).toBe(false);
    mirror.on = true;
    const rec2 = beginMetaApplyRecord(session, { service });
    session.extraPrompt = 'z';
    expect(rec2.commit()).toBe(false);
    expect(service.entries(session).past).toHaveLength(0);
  });

  test('적용 뒤 같은 칸이 기록 밖에서 또 바뀌면 D16 확인', async () => {
    const { service, confirm } = harness();
    const { session } = makeSession('A');
    const preset = presetObj();
    const rec = beginMetaApplyRecord(session, { service });
    rec.preset(preset);
    preset.uc = 'meta-uc';
    rec.commit();
    preset.uc = 'hand-edit';
    confirm.mockResolvedValueOnce(false);
    expect(await service.undo(session)).toBe(false);
    expect(confirm).toHaveBeenCalledWith(UNDO_TEXT.conflictUndo(UNDO_TEXT.metaApply), UNDO_TEXT.undoName);
    expect(preset.uc).toBe('hand-edit');
    expect(service.entries(session).past).toHaveLength(1);
  });
});
