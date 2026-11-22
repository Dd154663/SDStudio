// PC 사전세팅선택 행(PreSetEdtior.tsx PreSetSelect)의 규칙 — 2026-11-22 사용자 결정.
// 「사전세팅선택:」 글자 라벨을 없애고 선택 칸을 둥근 사각 드롭다운(테두리 + 오른쪽 ▾)으로, 프롬프트조각 기본 자리를 이 행으로.
// 모바일(클래식·V2)은 종전 모습(라벨 + 알약 칸) 그대로 — 이 규칙은 PC 에서만 쓴다.

/** 선택 칸의 접근성 이름(라벨 글자를 없앤 대신). */
export const PRESET_SELECT_ARIA_LABEL = '사전 세팅 선택';
/** 선택 칸 접근성 이름 — 「사전 세팅 선택: 현재 이름」(이름이 없으면 앞부분만). aria-label 이 보이는 글자를 덮으므로 이름을 함께 싣는다. */
export function presetSelectAriaLabel(presetName?: string): string {
  return presetName ? `${PRESET_SELECT_ARIA_LABEL}: ${presetName}` : PRESET_SELECT_ARIA_LABEL;
}

/**
 * 이 행에 붙은 프롬프트조각 버튼의 글자(2026-11-22 사용자 「"조각" 텍스트까지 보이게 확실히 노출」) — 긴 「프롬프트조각」
 * 대신 짧은 「조각」을 써서 기본 패널 폭(약 370px)에서도 아이콘+글자가 보이게 한다. 전체 이름은 툴팁·접근성 이름으로.
 */
export const PRESET_SELECT_PIECE_SHORT_LABEL = '조각';

/**
 * 프롬프트조각을 아이콘+글자(「조각」)로 보일 최소 행 폭(px). 행 = [선택 칸 flex-1][＋][글로벌 복사][일괄 삭제][조각].
 * 아이콘 버튼 셋 약 28px·간격 8px, 「조각」 버튼 약 78px — 이 폭에서 선택 칸이 약 100px 남는다. 그보다 좁으면
 * 아이콘만(툴팁으로 이름). 함께 붙은 다른 동반 버튼은 하나에 PRESET_SELECT_EXTRA_BUTTON_PX 씩 더 요구한다.
 */
export const PRESET_SELECT_PIECE_LABEL_MIN_ROW_PX = 300;
export const PRESET_SELECT_EXTRA_BUTTON_PX = 40;

/**
 * 프롬프트조각을 이름까지 보일지. rowWidth 가 없으면(첫 측정 전·측정 불가 환경) 이름을 보인다.
 * otherCompanions = 이 행에 함께 붙은 프롬프트조각 외 동반 버튼 수.
 */
export function presetSelectPieceLabeled(
  rowWidth: number | null | undefined,
  otherCompanions: number,
): boolean {
  if (rowWidth == null || rowWidth <= 0) return true;
  return (
    rowWidth >=
    PRESET_SELECT_PIECE_LABEL_MIN_ROW_PX +
      Math.max(0, otherCompanions) * PRESET_SELECT_EXTRA_BUTTON_PX
  );
}
