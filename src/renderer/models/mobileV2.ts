import { appState } from './AppService';
import { isMobileV2Layout } from './layoutTemplates';

// 모바일 V2 배치(선택형)의 공용 상수·판정. 분기는 반드시 여기(=isMobileV2Layout)를 거친다 — SPEC_GUIDE §6-2.
// 구조: 탭 묶음(TabComponent)이 빈 자리(슬롯)를 만들고, 상태를 가진 쪽(씬 목록·퀵 생성)이 포털로 채운다.
const mobile = window.electron == null;

/** 지금 모바일 V2 배치인가(observable 을 읽으므로 observer 안에서 호출하면 전환에 반응한다). */
export function isV2(): boolean {
  return isMobileV2Layout(appState.uiLayoutTemplate, mobile);
}

/** 상단 줄 왼쪽: 활성 씬 탭이 [씬 검색+찾기][프롬프트조각]을 넣는다. 다른 탭은 비워 둔다(폭 유지). */
export const V2_TOP_SLOT_ID = 'v2-top-slot';
/** 상단 줄의 프롬프트조각 자리: 이미지생성 탭의 씬 목록이 탭과 무관하게 항상 넣는다(어느 탭에서든 같은 자리).
 *  프로젝트 선반에서는 같은 버튼을 뺀다 — 진입점 중복 방지(2026-09-21 실기기 피드백). */
export const V2_TOP_PIECE_SLOT_ID = 'v2-top-piece-slot';
/** 하단 바 자리: 퀵 생성 탭이 [생성][해상도]를 넣는다(그동안 큐용 하단 바는 숨김). */
export const V2_QUICK_BAR_SLOT_ID = 'v2-quick-bar-slot';

/** 접힌 하단 시트의 높이(px). 본문 바닥 여백과 시트 접힘 높이가 같은 값을 쓴다. */
export const V2_SHEET_PEEK_PX = 44;

/** 반만 연 시트에서 보여줄 프리셋 요소 키(wfiElementKey 계약): 사전세팅선택(일반·프로필)·상위 프롬프트·추가 프롬프트·시드.
 *  사전세팅선택은 2026-09-22 추가 — 패널 맨 위 기능이 반 상태에서만 안 보이는 것이 어색하다는 사용자 판단. */
export const V2_SHEET_HALF_KEYS: readonly string[] = [
  'preset-select',
  'profile-preset-select',
  'frontPrompt',
  'extra-prompt',
  'seed',
];

/**
 * 더보기 둘째 줄(2계층) 줄 나누기(2026-09-24 사용자 제안·목업 검수). 메인 줄과 같은 칸 수(perRow)로 자르고,
 * 마지막 줄의 남는 자리는 null(빈 칸)로 채워 칸 폭이 고정되게 한다. 항목이 없으면 빈 배열.
 */
export function tierRows<T>(items: readonly T[], perRow: number): (T | null)[][] {
  const per = Math.max(1, Math.floor(perRow));
  const rows: (T | null)[][] = [];
  for (let i = 0; i < items.length; i += per) {
    const row: (T | null)[] = items.slice(i, i + per);
    while (row.length < per) row.push(null);
    rows.push(row);
  }
  return rows;
}

export type V2SheetState = 'peek' | 'half' | 'full';

// 프로젝트 선반(상단 2줄째)의 펼침 상태 — 앱을 다시 켜도 유지(기기별 UI 취향이라 config 가 아니라 localStorage).
const V2_SHELF_LS_KEY = 'sdstudio-v2-shelf-open';
export function loadV2ShelfOpen(): boolean {
  try {
    return localStorage.getItem(V2_SHELF_LS_KEY) === '1';
  } catch (e) {
    return false;
  }
}
export function saveV2ShelfOpen(open: boolean) {
  try {
    localStorage.setItem(V2_SHELF_LS_KEY, open ? '1' : '0');
  } catch (e) {
    // 저장 실패는 무시(다음에 접힌 채로 열릴 뿐)
  }
}

/** 손잡이를 끌다 놓았을 때 가장 가까운 상태로 붙인다. */
export function nearestSheetState(
  height: number,
  heights: Record<V2SheetState, number>,
): V2SheetState {
  let best: V2SheetState = 'peek';
  let bestDist = Infinity;
  (Object.keys(heights) as V2SheetState[]).forEach((k) => {
    const dist = Math.abs(heights[k] - height);
    if (dist < bestDist) {
      best = k;
      bestDist = dist;
    }
  });
  return best;
}

/** 손잡이를 탭했을 때의 다음 상태: 접힘→반→전체→접힘. */
export function nextSheetState(state: V2SheetState): V2SheetState {
  return state === 'peek' ? 'half' : state === 'half' ? 'full' : 'peek';
}

// Android 뒤로 가기는 상태와 무관하게 바로 접힘(peek)이다 — 전체에서 반을 거치지 않는다(2026-09-22 사용자).

// ── 손잡이 끌기 판정 (2026-09-22 실기기 피드백: 가장 가까운 상태 붙이기는 너무 엄격 — 한 손 엄지로 전체까지 못 감) ──
/** 느린 끌기: 지금 있는 구간(접힘↔반, 반↔전체)에서 진행 방향으로 이 비율 이상 갔으면 그쪽 끝에 붙는다. */
export const V2_SHEET_SNAP_RATIO = 0.25;
/** 손을 뗄 때 속도(px/ms)가 이 이상이면 거리와 무관하게 진행 방향의 다음 상태로. */
export const V2_SHEET_FLING_V = 0.5;
/** 이 이상이면 한 번에 끝까지(위=전체, 아래=접힘). 1.0 은 반만 열려던 손짓도 전체로 보내 1.8 로(2026-09-22 실기기). */
export const V2_SHEET_FAST_V = 1.8;

const SHEET_ORDER: readonly V2SheetState[] = ['peek', 'half', 'full'];

/**
 * 손을 뗐을 때 도착할 상태. velocity 는 px/ms, 위로 움직이면 양수.
 *  · 빠른 튕김(FAST 이상): 위=전체, 아래=접힘.
 *  · 튕김(FLING 이상): 현재 위치 기준 진행 방향의 다음 상태.
 *  · 느린 끌기: 현재 구간에서 진행 방향으로 SNAP_RATIO 이상 갔으면 그쪽 끝, 아니면 출발 쪽 끝.
 */
export function resolveSheetTarget(p: {
  height: number;
  startHeight: number;
  velocity: number;
  heights: Record<V2SheetState, number>;
}): V2SheetState {
  const { height, startHeight, velocity, heights } = p;
  const speed = Math.abs(velocity);
  const up = speed >= V2_SHEET_FLING_V ? velocity > 0 : height >= startHeight;
  if (speed >= V2_SHEET_FAST_V) return up ? 'full' : 'peek';
  if (speed >= V2_SHEET_FLING_V) {
    if (up) return SHEET_ORDER.find((k) => heights[k] > height + 1) ?? 'full';
    return [...SHEET_ORDER].reverse().find((k) => heights[k] < height - 1) ?? 'peek';
  }
  let lo: V2SheetState = 'peek';
  let hi: V2SheetState = 'full';
  for (let i = 0; i < SHEET_ORDER.length - 1; i += 1) {
    const a = SHEET_ORDER[i];
    const b = SHEET_ORDER[i + 1];
    if (height >= heights[a] && height <= heights[b]) {
      lo = a;
      hi = b;
      break;
    }
  }
  const span = heights[hi] - heights[lo];
  if (span <= 0) return lo;
  const frac = (height - heights[lo]) / span;
  if (up) return frac >= V2_SHEET_SNAP_RATIO ? hi : lo;
  return frac <= 1 - V2_SHEET_SNAP_RATIO ? lo : hi;
}
