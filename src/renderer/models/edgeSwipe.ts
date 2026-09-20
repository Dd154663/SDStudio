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

// ── 드로어 스와이프 판정(열기·닫기 공용) ─────────────────────────────
// 수평 우세 + SWIPE_DISTANCE 이상 이동이면 발동. 길게 누른 뒤 움직이는 조작(드래그 정렬·
// 프로젝트 끌어 옮기기, 320~400ms 롱프레스)은 스와이프가 아니므로, 터치 후 SWIPE_START_WINDOW
// 안에 움직이기 시작하지 않으면 그 터치는 스와이프 후보에서 뺀다.
export const SWIPE_DISTANCE = 40;
export const SWIPE_START_WINDOW = 300;
const SWIPE_SLOP = 10;

export type SwipeDirection = 'left' | 'right';

export interface SwipeTracker {
  start(x: number, y: number, time: number): void;
  /** 발동하면 true 를 한 번만 돌려준다. */
  move(x: number, y: number, time: number): boolean;
  end(): void;
}

export function createSwipeTracker(direction: SwipeDirection): SwipeTracker {
  let active = false;
  let moving = false;
  let sx = 0;
  let sy = 0;
  let st = 0;
  return {
    start(x, y, time) {
      active = true;
      moving = false;
      sx = x;
      sy = y;
      st = time;
    },
    move(x, y, time) {
      if (!active) return false;
      const dx = x - sx;
      const dy = y - sy;
      if (!moving) {
        if (Math.hypot(dx, dy) < SWIPE_SLOP) return false;
        if (time - st > SWIPE_START_WINDOW) {
          active = false; // 길게 누른 뒤 이동 = 드래그 조작
          return false;
        }
        moving = true;
      }
      const along = direction === 'right' ? dx : -dx;
      if (along > SWIPE_DISTANCE && Math.abs(dx) > Math.abs(dy)) {
        active = false;
        return true;
      }
      return false;
    },
    end() {
      active = false;
    },
  };
}

/** 반대쪽 드로어가 열려 있으면 이쪽 가장자리 열기 스와이프는 반응하지 않는다(겹침 방지). */
export function canOpenDrawerBySwipe(state: {
  selfOpen: boolean;
  otherOpen: boolean;
}): boolean {
  return !state.selfOpen && !state.otherOpen;
}

/**
 * 터치가 전체 화면 오버레이(모달 `.fixed.inset-0`, 뷰어 `.float-view`) 안에서 시작했는지.
 * 프로젝트 드로어는 메인 화면의 조작이라, 환경설정·이미지 뷰어 위에서는 가장자리 스와이프로
 * 열지 않는다(히스토리 드로어는 뷰어에서도 쓰므로 이 규칙을 적용하지 않는다).
 */
export function isInsideOverlay(target: EventTarget | null): boolean {
  const el =
    target instanceof Element
      ? target
      : target instanceof Node
        ? target.parentElement
        : null;
  return !!el?.closest('.fixed.inset-0, .float-view');
}
