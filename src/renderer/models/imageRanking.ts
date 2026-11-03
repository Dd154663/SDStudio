// 이미지 순서·순위(game·round)의 순수 계산(2026-11-01 되돌리기 U3a, SPEC_GUIDE 「되돌리기 계약」, jest undoImageState.test.ts).
//
// · 대입하지 않는다 — 계산 결과를 실제 씬에 넣는 곳은 GameService.applyImageOrder·applyRanking 하나다
//   (되돌리기 모듈은 이미지 필드에 직접 대입하지 않는다 — specGuard 「되돌리기 모듈의 이미지 필드 대입」).
// · 병합 원칙(생성 중 새 이미지 보존 — 최우선): 기록한 순서에 없는 이미지(그사이 생성된 것)는 지금 상대 순서대로 뒤에 남기고,
//   기록에 있지만 지금 없는 이미지(그사이 삭제된 것)는 건너뛴다. 순위는 지금 있는 파일의 참가자만 남긴다.
import type { Game, GenericScene, Player, Round } from './types';

export const sortGame = (game: Game) => {
  game.sort((a, b) => {
    if (a.rank !== b.rank) {
      return a.rank - b.rank;
    } else {
      if (a.path < b.path) return -1;
      if (a.path > b.path) return 1;
      return 0;
    }
  });
};

/** 순위 결번 정규화(대진 로직의 전제) — 제자리 정렬·rank 재부여. GameService.cleanGame 의 본체 */
export function cleanGameRanks(game: Game): void {
  sortGame(game);
  let curRank = game.length - 1;
  let prev = -1;
  let cnt = 0;
  for (let i = game.length - 1; i >= 0; i--) {
    if (game[i].rank !== prev) {
      prev = game[i].rank;
      curRank -= cnt;
      cnt = 0;
    }
    game[i].rank = curRank;
    cnt++;
  }
}

/**
 * 순서 병합 — order 순서대로 지금 있는 이미지를 먼저 세우고(없는 것·중복은 건너뜀),
 * order 에 없는 지금 이미지(그사이 생긴 것)는 지금 상대 순서대로 뒤에 남긴다. 새 배열을 돌려준다.
 */
export function mergeImageOrder(current: readonly string[], order: readonly string[]): string[] {
  const present = new Set(current);
  const placed = new Set<string>();
  const next: string[] = [];
  for (const f of order) {
    if (!present.has(f) || placed.has(f)) continue;
    placed.add(f);
    next.push(f);
  }
  for (const f of current) {
    if (placed.has(f)) continue;
    placed.add(f);
    next.push(f);
  }
  return next;
}

export interface RankingSnapshot {
  game?: Player[];
  round?: Round;
}

function cloneRound(round: Round): Round {
  return {
    players: [...round.players],
    winMask: [...round.winMask],
    curPlayer: round.curPlayer,
  };
}

function cloneGame(game: readonly Player[]): Player[] {
  return game.map((p) => ({ path: p.path, rank: p.rank }));
}

/** 씬의 game·round 깊은 사본(toJSON 은 배열을 공유하므로 직접 복사 — 이후 제자리 수정이 섞이지 않게) */
export function cloneRanking(scene: Pick<GenericScene, 'game' | 'round'>): RankingSnapshot {
  return {
    game: scene.game ? cloneGame(scene.game) : undefined,
    round: scene.round ? cloneRound(scene.round) : undefined,
  };
}

/**
 * 진행 중 라운드의 「시작 상태」 사본(2026-11-03 되돌리기 2차 P4) — 라운드 안의 매치 진행은 round 의 winMask·curPlayer 만 바꾸고
 * game(순위)은 라운드가 끝날 때(finalizeMatch) 한 번 바뀌므로, 같은 game + 같은 참가자 순서 + 승패 없음 + 첫 매치(curPlayer 0)
 * = GameService.nextRound 가 만든 그 라운드의 처음 모습. round 가 없으면 지금 사본 그대로. 항상 새 객체.
 */
export function roundStartRanking(scene: Pick<GenericScene, 'game' | 'round'>): RankingSnapshot {
  const snap = cloneRanking(scene);
  if (!snap.round) return snap;
  return {
    game: snap.game,
    round: {
      players: snap.round.players,
      winMask: snap.round.players.map(() => false),
      curPlayer: 0,
    },
  };
}

/**
 * 지금 있는 파일(files)에 맞춘 순위 사본 — 참가자는 있는 파일만 남기고, 빠진 참가자가 있으면 결번을 정규화한다
 * (ImageService.refresh 의 죽은 참조 정리와 같은 규칙). 남은 참가자가 없으면 game 없음.
 * round 는 참가자 중 하나라도 없으면 없음(진행 중 대진은 짝이 맞아야 하므로 refresh 와 같은 규칙). 항상 새 객체.
 */
export function rankingForFiles(snap: RankingSnapshot, files: Iterable<string>): RankingSnapshot {
  const set = files instanceof Set ? (files as Set<string>) : new Set(files);
  let game: Player[] | undefined;
  if (snap.game) {
    const alive = cloneGame(snap.game.filter((p) => set.has(p.path)));
    if (alive.length > 0) {
      if (alive.length < snap.game.length) cleanGameRanks(alive);
      game = alive;
    }
  }
  const round =
    snap.round && snap.round.players.every((p) => set.has(p)) ? cloneRound(snap.round) : undefined;
  return { game, round };
}

/** 같은 순위인가 — game 은 (rank, path) 정렬 뒤 비교(nextRound 등이 제자리 정렬해도 같다고 본다), round 는 값 비교 */
export function sameRanking(a: RankingSnapshot, b: RankingSnapshot): boolean {
  const norm = (g?: Player[]) => {
    if (!g || g.length === 0) return undefined;
    const c = cloneGame(g);
    sortGame(c);
    return c.map((p) => `${p.rank}\u0000${p.path}`).join('\u0001');
  };
  if (norm(a.game) !== norm(b.game)) return false;
  const ra = a.round;
  const rb = b.round;
  if (!ra || !rb) return !ra && !rb;
  return (
    ra.curPlayer === rb.curPlayer &&
    ra.players.length === rb.players.length &&
    ra.players.every((p, i) => p === rb.players[i]) &&
    ra.winMask.length === rb.winMask.length &&
    ra.winMask.every((w, i) => !!w === !!rb.winMask[i])
  );
}
