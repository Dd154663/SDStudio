// 씬 화면 모드 전환(2026-11-25 사용자 스케치 — 한 씬 안에서 [이미지 | 편집] 을 오감) — 순수 판정.
// 구조 = 쌓임 유지(안 A): 이미지 그리드 창은 편집 창 아래에 마운트된 채 남는다(탭·스크롤·선택 보존).
// 상태 주인은 QueueControl(SceneQueueControl.tsx)의 지역 state — 여기는 「다음 상태」만 정한다.

/** 씬 화면의 두 모드 — 이미지 그리드 / 씬 편집 창 */
export type SceneScreenMode = 'images' | 'edit';

/** QueueControl 이 쥔 씬 화면 상태(그리드에 열린 씬 · 편집 창에 열린 씬) */
export interface SceneScreenState<S> {
  gridScene: S | undefined;
  editScene: S | undefined;
}

/**
 * 편집 창(그리드 위에 쌓인 경우)의 ✕·Esc·모바일 뒤로 가기가 아래 같은 씬의 그리드도 함께 닫는가.
 * 참 = 씬 화면 전체를 닫음(2026-11-25 결정 — 그리드로 돌아가는 길은 [이미지] 칸). 거짓 = 편집 창만 닫아 그리드로(종전).
 * 이 결정을 뒤집을 때는 이 값 하나만 바꾼다.
 */
export const EDITOR_CLOSE_CLOSES_GRID = true;

/** 그리드에서 [편집] — 편집 창을 그리드 위에 올린다(그리드는 그대로). */
export function planShowEdit<S>(st: SceneScreenState<S>): SceneScreenState<S> {
  if (!st.gridScene) return st;
  return { gridScene: st.gridScene, editScene: st.gridScene };
}

/**
 * 편집 창에서 [이미지] — 아래에 같은 씬의 그리드가 있으면 편집 창만 닫는다.
 * 없으면(카드의 편집 버튼·Tab·우클릭으로 연 경우, 또는 다른 씬의 그리드) 같은 틱에 그 씬의 그리드를 열고 편집 창을 닫는다.
 * gridReplaced = 그리드를 새로 열거나 다른 씬의 그리드를 바꿔 낌(호출부가 옛 그리드 정리·포커스 해제를 한다).
 */
export function planShowImages<S>(
  st: SceneScreenState<S>,
): { next: SceneScreenState<S>; gridReplaced: boolean } {
  if (!st.editScene) return { next: st, gridReplaced: false };
  if (st.gridScene === st.editScene) {
    return { next: { gridScene: st.gridScene, editScene: undefined }, gridReplaced: false };
  }
  return { next: { gridScene: st.editScene, editScene: undefined }, gridReplaced: true };
}

/**
 * 편집 창 닫기(✕·Esc·뒤로) — EDITOR_CLOSE_CLOSES_GRID 이면 아래의 **같은 씬** 그리드도 함께 닫는다.
 * 다른 씬의 그리드(드문 경로)는 건드리지 않는다. closesGrid = 그리드까지 닫음(호출부가 그리드 닫기 정리를 한다).
 */
export function planCloseEditor<S>(
  st: SceneScreenState<S>,
  closesGrid: boolean = EDITOR_CLOSE_CLOSES_GRID,
): { next: SceneScreenState<S>; closesGrid: boolean } {
  const both = closesGrid && !!st.gridScene && st.gridScene === st.editScene;
  return {
    next: { gridScene: both ? undefined : st.gridScene, editScene: undefined },
    closesGrid: both,
  };
}

/**
 * 이미지 그리드 단축키(image-grid 범주)를 켜 둘 것인가 — appState.imageGridFocusable 의 값.
 * 모바일 아님 && 그리드 안 상세 보기·번호 고르기 창이 없음 && 위에 씬 편집 창이 쌓이지 않음.
 * (편집 창이 위에 있으면 보이지 않는 그리드에서 방향키·Delete·Ctrl+←/→ 가 일어나지 않게 — 2026-11-25)
 */
export function imageGridShortcutsActive(st: {
  isMobile: boolean;
  detailOpen: boolean;
  pickerOpen: boolean;
  coveredByEditor: boolean;
}): boolean {
  return !st.isMobile && !st.detailOpen && !st.pickerOpen && !st.coveredByEditor;
}
