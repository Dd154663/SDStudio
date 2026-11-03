/**
 * 월드컵 라운드 완료의 되돌리기 — 2026-11-03 2차 P4 (SPEC_GUIDE 「되돌리기 계약」, 사용자 결정 D5 = 라운드 단위).
 *  - 라운드가 끝날 때(마지막 매치 → finalizeMatch → nextRound → 다음 라운드 대입) 1항목
 *  - 되돌림 = 그 라운드의 시작 상태(같은 game·같은 참가자·승패 없음·첫 매치), 다시 실행 = 다음 라운드 첫 매치
 *  - 매치별 진행은 항목 없음, 라운드 도중 화면을 열었어도 시작 상태로, 다음 라운드를 진행했으면 D16 확인
 * 본문은 Tournament.nextMatch 의 라운드 끝 분기와 같은 순서(finalizeMatch 는 같은 계산을 옮겨 둠), 복원은 실제 GameService.applyRanking.
 */
jest.mock('..', () => ({
  backend: { notifySessionOp: jest.fn(async () => {}) },
  imageService: {
    addEventListener: jest.fn(),
    getOutputs: (_s: unknown, scene: { imageMap: string[] }) => [...scene.imageMap],
  },
  gameService: {},
  taskQueueService: { addLog: jest.fn() },
  workFlowService: {},
  isMobile: false,
}));

import { GameService } from '../GameService';
import { cloneRanking, roundStartRanking, sameRanking } from '../imageRanking';
import { ImageStateOps, recordRanking, recordRankingRound } from '../imageStateUndo';
import { Player, Scene, Session } from '../types';
import { UNDO_TEXT, UndoService } from '../undoService';

function harness() {
  const toast = jest.fn();
  const confirm = jest.fn<Promise<boolean>, [string, string]>(async () => true);
  const service = new UndoService({
    curSession: () => undefined,
    isMirror: () => false,
    toast,
    now: () => 1000,
    confirm,
  });
  return { service, toast, confirm };
}

const game = new GameService();
const restored = jest.fn();
game.addEventListener('ranking-restored', (e) => restored((e as CustomEvent).detail.scene));

const ops: ImageStateOps = {
  setImageMain: jest.fn(),
  getImageBookmark: () => undefined,
  setImageBookmark: jest.fn(async () => {}),
  applyImageOrder: (sc, order) => game.applyImageOrder(sc, order),
  applyRanking: (s, sc, snap) => game.applyRanking(s, sc, snap),
  refreshScene: jest.fn(async () => {}),
};

function makeScene(): { session: Session; scene: Scene } {
  const session = new Session();
  session.name = 'p';
  const scene = new Scene();
  scene.name = 'A';
  scene.imageMap = ['a.png', 'b.png', 'c.png', 'd.png'];
  scene.mains = [];
  session.addScene(scene);
  // 순위 초기화 직후(모두 같은 순위) + 첫 라운드
  scene.game = scene.imageMap.map((path) => ({ path, rank: 3 }));
  const [, round] = game.nextRound(scene.game);
  scene.round = round;
  return { session, scene };
}

/** Tournament.finalizeMatch 와 같은 계산(승자 순위 = 라운드 순위 − 패자 수) */
function finalizeMatch(scene: Scene) {
  const round = scene.round!;
  if (round.players.length % 2 === 1) round.winMask[round.players.length - 1] = true;
  let loses = 0;
  for (let i = 0; i < round.players.length; i++) if (!round.winMask[i]) loses++;
  const cvt = new Map<string, Player>(scene.game!.map((p) => [p.path, p]));
  const winRank = cvt.get(round.players[0])!.rank - loses;
  for (let i = 0; i < round.players.length; i++) {
    if (round.winMask[i]) cvt.get(round.players[i])!.rank = winRank;
  }
}

/** 매치 하나 진행(첫 선수 승) — 기록하지 않는 국소 동작. 라운드 끝이면 recordRankingRound 로 감싸 완료 */
async function playMatch(service: UndoService, session: Session, scene: Scene): Promise<void> {
  const r = scene.round!;
  r.winMask[r.curPlayer] = true;
  r.winMask[r.curPlayer + 1] = false;
  r.curPlayer += 2;
  if (r.curPlayer + 1 < r.players.length) return;
  await recordRankingRound(
    session,
    scene,
    UNDO_TEXT.rankingRound(scene.name, '준결승전'),
    () => {
      finalizeMatch(scene);
      const [, newRound] = game.nextRound(scene.game!);
      if (newRound) scene.round = newRound;
    },
    { service, ops },
  );
}

beforeEach(() => restored.mockClear());

describe('roundStartRanking(순수)', () => {
  test('같은 game·같은 참가자 순서·승패 없음·첫 매치, 새 객체', () => {
    const { scene } = makeScene();
    const r = scene.round!;
    r.winMask[0] = true;
    r.curPlayer = 2;
    const start = roundStartRanking(scene);
    expect(start.round).toEqual({ players: r.players, winMask: r.players.map(() => false), curPlayer: 0 });
    expect(start.round!.players).not.toBe(r.players);
    expect(sameRanking({ game: start.game }, { game: scene.game })).toBe(true);
    expect(roundStartRanking({ game: undefined, round: undefined })).toEqual({ game: undefined, round: undefined });
  });
});

describe('라운드 완료 = 1항목', () => {
  test('매치 진행은 항목 없음, 라운드 끝에 1항목 — 되돌림 = 라운드 시작, 다시 실행 = 다음 라운드 첫 매치', async () => {
    const { service, confirm } = harness();
    const { session, scene } = makeScene();
    const start = cloneRanking(scene);
    await playMatch(service, session, scene); // 1/2 — 기록 없음
    expect(service.entries(session).past).toHaveLength(0);
    await playMatch(service, session, scene); // 2/2 — 라운드 완료
    const past = service.entries(session).past;
    expect(past.map((e) => e.label)).toEqual([UNDO_TEXT.rankingRound('A', '준결승전')]);
    const next = cloneRanking(scene);
    expect(next.round!.curPlayer).toBe(0);
    expect(next.round!.players).toHaveLength(2); // 승자 둘의 다음 라운드
    expect(sameRanking(next, start)).toBe(false);

    expect(await service.undo(session)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(sameRanking(cloneRanking(scene), start)).toBe(true); // game 순위·대진 모두 라운드 시작
    expect(scene.game!.every((p) => p.rank === 3)).toBe(true);
    expect(scene.round!.curPlayer).toBe(0);
    expect(scene.round!.winMask.every((w) => !w)).toBe(true);
    expect(restored).toHaveBeenCalledWith(scene); // 열린 화면은 ranking-restored 로 대진을 다시 맞춘다
    expect(scene.imageMap).toEqual(['a.png', 'b.png', 'c.png', 'd.png']); // 이미지 목록 불변

    expect(await service.redo(session)).toBe(true);
    expect(sameRanking(cloneRanking(scene), next)).toBe(true);
  });

  test('라운드마다 1항목(결승까지 = 2항목) — 차례로 되돌리면 확인 창 없이 처음 상태', async () => {
    const { service, confirm } = harness();
    const { session, scene } = makeScene();
    const start = cloneRanking(scene);
    await playMatch(service, session, scene);
    await playMatch(service, session, scene); // 준결승 라운드 완료
    await playMatch(service, session, scene); // 결승 완료 → 다음 라운드 없음(3·4위 동순위 결정전이 남으면 계속)
    while (scene.round && scene.round.curPlayer + 1 < scene.round.players.length && service.entries(session).past.length < 5) {
      await playMatch(service, session, scene);
    }
    const n = service.entries(session).past.length;
    expect(n).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < n; i++) expect(await service.undo(session)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(sameRanking(cloneRanking(scene), start)).toBe(true);
  });

  test('라운드 도중 화면을 연 경우에도 이전 값은 라운드 시작 상태', async () => {
    const { service } = harness();
    const { session, scene } = makeScene();
    const start = cloneRanking(scene);
    // 지난번에 1매치까지 하고 닫았다가 다시 연 상태(그 진행은 기록 밖)
    scene.round!.winMask[0] = true;
    scene.round!.curPlayer = 2;
    await playMatch(service, session, scene);
    expect(service.entries(session).past).toHaveLength(1);
    await service.undo(session);
    expect(sameRanking(cloneRanking(scene), start)).toBe(true);
  });

  test('다음 라운드를 진행한 뒤 되돌리면 D16 확인 — 취소 = 그대로, 확인 = 라운드 시작', async () => {
    const { service, confirm } = harness();
    const { session, scene } = makeScene();
    const start = cloneRanking(scene);
    await playMatch(service, session, scene);
    await playMatch(service, session, scene);
    // 다음 라운드 첫 매치 승패만 고른 상태(기록 밖 진행)
    scene.round!.winMask[0] = true;
    confirm.mockResolvedValueOnce(false);
    expect(await service.undo(session)).toBe(false);
    expect(service.entries(session).past).toHaveLength(1); // 취소 = 항목 유지
    expect(scene.round!.winMask[0]).toBe(true);
    expect(await service.undo(session)).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(sameRanking(cloneRanking(scene), start)).toBe(true);
  });

  test('순위 초기화(recordRanking)는 종전대로 mutate 직전 상태가 이전 값', async () => {
    const { service } = harness();
    const { session, scene } = makeScene();
    scene.round!.winMask[0] = true;
    scene.round!.curPlayer = 2;
    const mid = cloneRanking(scene);
    await recordRanking(
      session,
      scene,
      UNDO_TEXT.rankingReset('A'),
      () => {
        scene.game = scene.imageMap.map((path) => ({ path, rank: 3 }));
        scene.round = undefined;
      },
      { service, ops },
    );
    await service.undo(session);
    expect(sameRanking(cloneRanking(scene), mid)).toBe(true);
  });
});
