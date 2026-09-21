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

/** 반만 연 시트에서 보여줄 프리셋 요소 키(wfiElementKey 계약): 상위 프롬프트·추가 프롬프트·시드. */
export const V2_SHEET_HALF_KEYS: readonly string[] = ['frontPrompt', 'extra-prompt', 'seed'];

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

/** Android 뒤로 가기: 한 단계씩 접는다. */
export function prevSheetState(state: V2SheetState): V2SheetState {
  return state === 'full' ? 'half' : 'peek';
}
