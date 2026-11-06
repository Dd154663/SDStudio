// 되돌리기 버튼 바(UndoRedoBar)의 부착 자리(2026-11-03 U6 실기 보정, 2026-11-04 설계 E — 시트 호스트·구석 자리·수평 위치).
// 하단 막대(BottomBar·V2MainRow·V2TierRows)와 펼친 시트(이미지 「자세한 정보」 손잡이)가 자기 안 마지막 자식으로 이 빈 자리를
// 둔다. 자리는 막대 위 모서리 바깥에 막대 폭 그대로 깔린 높이 0 띠(absolute bottom-full left-0 right-0)이고, App 에 한 번
// 마운트된 UndoRedoBar 가 「보이는 호스트 중 화면상 가장 위의 것」의 자리 하나를 골라 포털로 바를 넣는다 — 바 아래 변이 막대
// 위 변에 정확히 맞닿고(측정 오차 없음), 띠 안의 가로 위치(비율)는 바가 스스로 정한다(사용자 끌기·기억).
// 막대는 positioned(relative·absolute)여야 한다. 이 파일은 의존성이 없어야 한다(MobileV2Bars·BottomBar 가 가볍게 가져다 쓴다).
//
// 자리를 둘 수 없는 호스트(잘라내기 overflow:clip 안에서 움직이는 V2 프롬프트 시트)는 자리 대신 UNDO_SHEET_ATTR 를 단다 —
// 바가 그 요소의 위 모서리를 재서 화면 고정(fixed)으로 그 바깥 위에 붙는다.
// 클래식 모바일 프롬프트 편집 창(FloatView undoCorner)은 머리줄 오른쪽 빈 곳에 UndoCornerSlot 을 둔다 — 하단에 여유가 없어
// 이 창이 보이는 동안만 바가 그 구석에 임시로 놓인다(끌기 없음).

/** 하단 막대 표식 속성 — 바가 이 막대 위에 붙는다(자리 = 이 요소의 직속 자식 [data-undo-slot]) */
export const UNDO_ANCHOR_ATTR = 'data-undo-anchor';
/** 부착 자리 표식 속성 — 값 = 막대 색 종류(UndoSlotTone) */
export const UNDO_SLOT_ATTR = 'data-undo-slot';
/**
 * 자리 없는 시트 호스트 표식(표식 UNDO_ANCHOR_ATTR 과 함께 단다) — 값 = 시트 상태(half·full·drag). 값이 바뀌면 바가 다시
 * 잰다. drag(손가락으로 끄는 중)이면 바는 그 자리를 지키되 잠시 감춘다(시트를 따라가지 못하므로).
 */
export const UNDO_SHEET_ATTR = 'data-undo-sheet';
/** 구석 자리 표식(클래식 모바일 프롬프트 편집 창 머리줄 오른쪽) */
export const UNDO_CORNER_ATTR = 'data-undo-corner';

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
 * tier = V2 더보기 둘째 줄(--c-zone), sheet = 펼친 시트(V2 프롬프트 시트·이미지 「자세한 정보」, --c-zone).
 */
export type UndoSlotTone = 'bar' | 'row' | 'row-select' | 'tier' | 'sheet';

export const UndoBarSlot = ({ tone }: { tone: UndoSlotTone }) => (
  <div
    {...{ [UNDO_SLOT_ATTR]: tone }}
    className="absolute bottom-full left-0 right-0 h-0 pointer-events-none z-[var(--z-widget)]"
  />
);

/** 구석 자리 — 머리줄(positioned) 오른쪽 끝 세로 가운데. 머리줄 왼쪽의 닫기 버튼과 겹치지 않는다. */
export const UndoCornerSlot = () => (
  <div
    {...{ [UNDO_CORNER_ATTR]: '' }}
    className="absolute right-2 top-1/2 -translate-y-1/2 z-[var(--z-widget)]"
  />
);
