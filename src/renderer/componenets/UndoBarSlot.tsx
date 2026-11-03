// 되돌리기 버튼 바(UndoRedoBar)의 부착 자리(2026-11-03 U6 실기 보정).
// 하단 막대(BottomBar·V2MainRow·V2TierRows)가 자기 안 마지막 자식으로 이 빈 자리를 둔다. 자리는 막대 위 모서리 중앙
// (absolute bottom-full left-1/2 -translate-x-1/2)에 놓이고, App 에 한 번 마운트된 UndoRedoBar 가 「보이는 막대 중 가장
// 위의 것」의 자리 하나를 골라 포털로 바를 넣는다 — 그래서 바 아래 변이 막대 위 변에 정확히 맞닿는다(측정 오차 없음).
// 막대는 positioned(relative·absolute)여야 한다. 이 파일은 의존성이 없어야 한다(MobileV2Bars·BottomBar 가 가볍게 가져다 쓴다).

/** 하단 막대 표식 속성 — 바가 이 막대 위에 붙는다(자리 = 이 요소의 직속 자식 [data-undo-slot]) */
export const UNDO_ANCHOR_ATTR = 'data-undo-anchor';
/** 부착 자리 표식 속성 — 값 = 막대 색 종류(UndoSlotTone) */
export const UNDO_SLOT_ATTR = 'data-undo-slot';

/**
 * 되돌리기 버튼 바 높이(px) — 바의 클래스 h-9 와 같은 값(단일 출처). 토스트 여백 계산(UndoRedoBar)과 씬 격자 스크롤 바닥
 * 여백(SceneQueueControl — 끝까지 내리면 마지막 줄 카드가 바 위로 올라오게)에 쓴다. UndoRedoBar 가 재export 한다.
 */
export const UNDO_BAR_HEIGHT_PX = 36;

/** V2 메인 줄 선택 중 배경(하늘색 얇은 덮개) — V2MainRow 와 바가 함께 쓰는 단일 출처 */
export const V2_ROW_SELECT_TINT = 'rgba(14,165,233,0.10)';

/**
 * 막대 색 종류 — 바가 같은 배경·테두리를 쓰기 위해.
 * bar = 하단 바(BottomBar, zone-bar), row = V2 메인 줄, row-select = V2 메인 줄 선택 중(하늘색 얇은 덮개),
 * tier = V2 더보기 둘째 줄(--c-zone).
 */
export type UndoSlotTone = 'bar' | 'row' | 'row-select' | 'tier';

export const UndoBarSlot = ({ tone }: { tone: UndoSlotTone }) => (
  <div
    {...{ [UNDO_SLOT_ATTR]: tone }}
    className="absolute bottom-full left-1/2 -translate-x-1/2 z-[var(--z-widget)]"
  />
);
