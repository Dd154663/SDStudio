// 좌우 스와이프로 한 장씩 넘기는 판정(2026-11-26 히스토리 확대) — 순수 함수(DOM·서비스 의존 없음), jest historyViewer.test.ts.
// 기준은 이미지 상세 보기(ResultViewer 의 swipeProps)와 같다: 가로 이동 50px 이상 + 가로가 세로의 1.5배 이상.
// 손가락을 따라 끌려오는 움직임은 없다(손을 뗄 때 한 번 판정해 바로 바꾼다).

export const SWIPE_MIN_PX = 50;
export const SWIPE_DOMINANCE = 1.5;

/**
 * 터치 시작→끝 이동량으로 넘길 방향. 왼쪽으로 밀면(dx<0) 다음(+1), 오른쪽으로 밀면 이전(-1), 아니면 0.
 * 이동량이 숫자가 아니면 0.
 */
export function horizontalSwipeStep(dx: number, dy: number): -1 | 0 | 1 {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return 0;
  if (Math.abs(dx) < SWIPE_MIN_PX) return 0;
  if (Math.abs(dx) < Math.abs(dy) * SWIPE_DOMINANCE) return 0;
  return dx < 0 ? 1 : -1;
}
