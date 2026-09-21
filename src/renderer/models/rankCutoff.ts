// "n등" 입력 해석 — 대량 작업(n등 이하 삭제·상위 n등 즐겨찾기)과 이미지 그리드(n등 이하 삭제)의 단일 출처.
// parseInt 결과를 그대로 slice 에 넘기면 숫자가 아닌 입력(NaN)이 slice(0) 이 되어
// "n등 이하 삭제"가 즐겨찾기 외 전부 삭제로 바뀐다 → 1 이상의 정수만 받는다(2026-09-21).
export function parseRankCutoff(value: string | undefined | null): number | null {
  if (value == null) return null;
  const text = value.trim();
  if (!/^\d+$/.test(text)) return null;
  const n = parseInt(text, 10);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

export const RANK_CUTOFF_INVALID_MESSAGE = '1 이상의 숫자를 입력해주세요.';
