// 퀵 생성 탭의 「최근 결과 넘겨 보기」 규칙(2026-11-22) — 어느 이미지를 크게 보여 줄지 정하는 순수 모듈.
// 컴포넌트(QuickModeTab)는 이 함수들만 쓰고 직접 인덱스를 계산하지 않는다.
//
// 입력 `paths` = 퀵 생성 전용 프로젝트 default 씬의 결과 경로 목록(앞이 최신 — gameService.getOutputs 순서).
// 규칙:
// - 기본은 「최신 따라가기」(pinned = null): 새 이미지가 들어오면 그것을 보여 준다.
// - 이전으로 넘기면 보던 이미지를 **경로로** 기억한다(pinned). 새 이미지가 들어와 인덱스가 밀려도 같은 이미지를 유지.
// - 넘겨 볼 수 있는 범위 = 최근 QUICK_RESULT_WINDOW 장. 보던 이미지가 새 이미지에 밀려 범위 밖으로 나가도
//   넘기기 전까지는 그대로 보이고, 넘기면(더 최신 쪽으로) 범위 안으로 돌아온다. 범위 밖에서는 더 이전으로 가지 않는다.
// - 보던 이미지가 목록에서 사라지면(삭제) 마지막으로 보던 자리의 이웃(같은 자리 = 한 장 더 이전, 없으면 더 최신)으로 옮긴다.
// - 1번째(최신)에 도달하면 다시 「최신 따라가기」로 돌아간다.

/** 넘겨 볼 수 있는 최근 결과 장수. */
export const QUICK_RESULT_WINDOW = 10;
/** 양옆 더미에 비치는 카드 최대 장수(가까운 것부터). 좁은 화면은 컴포넌트가 1장만 그린다. */
export const QUICK_STACK_MAX = 3;

export interface QuickViewState {
  /** 보고 있는 이미지 경로. null = 최신 따라가기. */
  pinned: string | null;
  /** 마지막으로 확인한 보던 자리(삭제됐을 때 이웃을 고르는 기준). */
  lastIndex: number;
}

export const QUICK_VIEW_FOLLOW_LATEST: QuickViewState = { pinned: null, lastIndex: 0 };

/** 범위 안에서 넘겨 볼 수 있는 장수(목록이 더 짧으면 목록 길이). */
export function quickWindowCount(paths: readonly string[]): number {
  return Math.min(paths.length, QUICK_RESULT_WINDOW);
}

/** 인덱스 하나를 상태로 — 0 이면 최신 따라가기. */
function stateAt(paths: readonly string[], index: number): QuickViewState {
  if (index <= 0 || index >= paths.length) return QUICK_VIEW_FOLLOW_LATEST;
  return { pinned: paths[index], lastIndex: index };
}

/**
 * 목록이 바뀐 뒤(새 이미지 도착·삭제·재스캔) 상태를 맞춘다.
 * 보던 이미지가 있으면 자리만 갱신, 없으면 이웃으로 옮긴다. 바뀐 게 없으면 같은 객체를 돌려준다.
 */
export function reconcileQuickView(
  paths: readonly string[],
  state: QuickViewState,
): QuickViewState {
  if (state.pinned == null) return state;
  const i = paths.indexOf(state.pinned);
  if (i > 0) return i === state.lastIndex ? state : { pinned: state.pinned, lastIndex: i };
  if (i === 0) return QUICK_VIEW_FOLLOW_LATEST;
  // 보던 이미지가 사라짐 → 같은 자리(= 한 장 더 이전), 없으면 끝(더 최신 쪽 이웃). 비었으면 빈 상태(따라가기).
  if (paths.length === 0) return QUICK_VIEW_FOLLOW_LATEST;
  return stateAt(paths, Math.min(state.lastIndex, paths.length - 1));
}

export interface QuickViewInfo {
  /** 지금 크게 보이는 이미지(없으면 빈 상태). */
  path: string | undefined;
  /** paths 안의 자리(없으면 -1). 범위 밖일 수 있다. */
  index: number;
  /** 더 이전(오른쪽 더미) — 가까운 것부터, 최대 QUICK_STACK_MAX 장. 비었으면 오른쪽에 그리지 않는다. */
  older: string[];
  /** 더 최신(왼쪽 더미) — 가까운 것부터, 최대 QUICK_STACK_MAX 장. 비었으면 왼쪽에 그리지 않는다. */
  newer: string[];
  /** 위치 표시(「3 / 10」). 최신을 보고 있으면 null. */
  label: string | null;
}

/** 지금 보여 줄 것을 계산한다(reconcile 을 거친 상태를 넣는 것이 전제지만, 안 거쳐도 안전하게 동작). */
export function currentQuickView(
  paths: readonly string[],
  state: QuickViewState,
): QuickViewInfo {
  const fixed = reconcileQuickView(paths, state);
  const index = paths.length === 0 ? -1 : fixed.pinned == null ? 0 : paths.indexOf(fixed.pinned);
  if (index < 0) return { path: undefined, index: -1, older: [], newer: [], label: null };
  const count = quickWindowCount(paths);
  const older: string[] = [];
  for (let k = index + 1; k < count && older.length < QUICK_STACK_MAX; k++) older.push(paths[k]);
  const newer: string[] = [];
  for (let k = Math.min(index, count) - 1; k >= 0 && newer.length < QUICK_STACK_MAX; k--) newer.push(paths[k]);
  const label = index === 0 ? null : index < count ? `${index + 1} / ${count}` : `${index + 1}번째`;
  return { path: paths[index], index, older, newer, label };
}

/** 오른쪽(한 장 더 이전)으로. 더 갈 곳이 없으면 같은 상태. */
export function stepQuickOlder(paths: readonly string[], state: QuickViewState): QuickViewState {
  const { index } = currentQuickView(paths, state);
  if (index < 0 || index + 1 >= quickWindowCount(paths)) return reconcileQuickView(paths, state);
  return stateAt(paths, index + 1);
}

/** 왼쪽(한 장 더 최신)으로. 범위 밖에 있었으면 범위의 마지막 장으로 돌아온다. 1번째에 닿으면 최신 따라가기. */
export function stepQuickNewer(paths: readonly string[], state: QuickViewState): QuickViewState {
  const { index } = currentQuickView(paths, state);
  if (index <= 0) return QUICK_VIEW_FOLLOW_LATEST;
  return stateAt(paths, Math.min(index - 1, quickWindowCount(paths) - 1));
}
