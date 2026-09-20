// 모바일 가장자리 스와이프(히스토리·프로젝트 드로어 열기)의 예외 판정 — 단일 출처.
// 가장자리 감지는 document 전체에 걸려 시작 위치와 방향만 보므로, 같은 가로 제스처를
// 쓰는 영역(가로 스크롤 툴바, 이미지 좌우 넘기기, 슬라이더)에서 시작한 터치는 그 영역에 양보한다.

/** 이 속성을 가진 요소(와 그 자손)에서 시작한 터치는 가장자리 스와이프로 보지 않는다. */
export const EDGE_SWIPE_IGNORE_ATTR = 'data-edge-swipe-ignore';

function isHorizontallyScrollable(el: Element): boolean {
  if (el.scrollWidth <= el.clientWidth + 1) return false;
  const overflowX = window.getComputedStyle(el).overflowX;
  return overflowX === 'auto' || overflowX === 'scroll';
}

/** 가장자리 감지 폭(px). 드로어 손잡이들의 시작 조건과 같은 값. */
export const EDGE_SWIPE_ZONE = 32;

/**
 * 터치 시작 지점 기준 판정. 가로 스크롤 행은 화면 끝까지 닿지 않는 경우가 많아(바깥 여백)
 * 맨 끝에서 시작한 터치의 target 은 여백 요소가 된다 → 같은 높이에서 가장자리 폭만큼
 * 안쪽 지점의 요소도 함께 검사해, 손가락이 걸친 가로 제스처 영역을 놓치지 않는다.
 */
export function shouldIgnoreEdgeSwipeAt(
  target: EventTarget | null,
  clientX: number,
  clientY: number,
  side: 'left' | 'right',
): boolean {
  if (shouldIgnoreEdgeSwipe(target)) return true;
  if (typeof document.elementFromPoint !== 'function') return false;
  const probeX =
    side === 'right'
      ? Math.min(clientX, window.innerWidth - EDGE_SWIPE_ZONE - 1)
      : Math.max(clientX, EDGE_SWIPE_ZONE + 1);
  return shouldIgnoreEdgeSwipe(document.elementFromPoint(probeX, clientY));
}

export function shouldIgnoreEdgeSwipe(target: EventTarget | null): boolean {
  let el: Element | null =
    target instanceof Element
      ? target
      : target instanceof Node
        ? target.parentElement
        : null;
  while (el && el !== document.body && el !== document.documentElement) {
    if (el.hasAttribute(EDGE_SWIPE_IGNORE_ATTR)) return true;
    if (el instanceof HTMLInputElement && el.type === 'range') return true;
    if (isHorizontallyScrollable(el)) return true;
    el = el.parentElement;
  }
  return false;
}
