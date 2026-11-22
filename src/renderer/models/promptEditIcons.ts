// 프롬프트 칸(PC) 오른쪽 위 아이콘 세로 쌓기 판정(2026-11-22).
// 아이콘은 글자가 들어오지 않는 오른쪽 띠(편집기 pr 여백)에 위에서부터 [크게 편집][돋보기][작가] 로 쌓는다.
// 칸 높이가 모자라면(한 줄짜리 낮은 칸) 그 칸만 종전 가로 배치로 떨어진다 — 칸 밖으로 넘치거나 잘리지 않게.
// 아래 숫자는 PromptEditTextArea 의 클래스와 짝: 위 여백 = mt-1(4px), 아이콘 사이 = gap-0.5(2px).

export const PROMPT_ICON_STACK_TOP = 4;
export const PROMPT_ICON_STACK_GAP = 2;
export const PROMPT_ICON_STACK_BOTTOM = 2;

/** 세로로 쌓은 아이콘 count 개가 boxHeight 안에 들어가는가. 잴 수 없으면(0 = 숨김·측정 전) 기본인 세로. */
export function fitsPromptIconStack(
  boxHeight: number,
  iconHeight: number,
  count: number,
): boolean {
  if (!(boxHeight > 0) || !(iconHeight > 0) || count <= 1) return true;
  const need =
    PROMPT_ICON_STACK_TOP +
    count * iconHeight +
    (count - 1) * PROMPT_ICON_STACK_GAP +
    PROMPT_ICON_STACK_BOTTOM;
  return need <= boxHeight;
}
