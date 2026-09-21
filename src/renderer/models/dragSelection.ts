// Keep native reordering on content in normal mode; padding can start a box.
export function canStartSelectionBox(
  target: EventTarget | null,
  selectionMode: boolean,
  contentSelector: string,
): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('button,input,textarea,select,a,[contenteditable="true"],.scrollbar-thumb,.scrollbar-track,.scene-btn,[data-no-scene-drag]')) return false;
  return selectionMode || !target.closest(contentSelector);
}

// The surface is the middle app row, never the header/footer or a portal.
export function mainSceneDragSurface(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const surface = target.closest<HTMLElement>('.scene-selection-surface');
  if (!surface || target.closest('[data-no-scene-drag],input,textarea,select,button,a,label,[contenteditable]:not([contenteditable="false"]),[role="button"],[role="dialog"],[role="menu"],[role="slider"],[role="separator"],.r-popover,.r-modal,.react-contexify,.scrollbar-thumb,.scrollbar-track')) return null;
  for (let node: Element | null = target; node && node !== surface; node = node.parentElement) {
    const style = window.getComputedStyle(node);
    if (style.position === 'fixed' || Number(style.zIndex) >= 100 || style.cursor.includes('resize')) return null;
    // Native scrollbars are checked separately using the pointer coordinates.
  }
  if (!target.closest('[id^="scene-cell-"]') && target.closest('img,canvas,[draggable="true"]')) return null;
  return surface;
}

export function isOnNativeScrollbar(target: Element, x: number, y: number): boolean {
  for (let node: Element | null = target; node; node = node.parentElement) {
    if (!(node instanceof HTMLElement)) continue;
    const rect = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowY) && node.offsetWidth > node.clientWidth && x >= rect.left + node.clientLeft + node.clientWidth) return true;
    if (/(auto|scroll)/.test(style.overflowX) && node.offsetHeight > node.clientHeight && y >= rect.top + node.clientTop + node.clientHeight) return true;
  }
  return false;
}

export function imagePathsInSelectionBox(
  container: HTMLElement,
  paths: string[],
  box: { x1: number; y1: number; x2: number; y2: number },
): string[] {
  const origin = container.getBoundingClientRect();
  const left = Math.min(box.x1, box.x2) + origin.left;
  const right = Math.max(box.x1, box.x2) + origin.left;
  const top = Math.min(box.y1, box.y2) + origin.top;
  const bottom = Math.max(box.y1, box.y2) + origin.top;
  const selected: string[] = [];
  container.querySelectorAll<HTMLElement>('[data-image-index]').forEach((cell) => {
    const index = Number(cell.dataset.imageIndex);
    const path = paths[index];
    if (!path) return;
    const rect = cell.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && left < rect.right && right > rect.left && top < rect.bottom && bottom > rect.top) selected.push(path);
  });
  return selected;
}

// ── 씬 선택 창(SceneSelector) 다중 선택 (2026-09-21) ────────────────────────────
export interface IndexedRect {
  index: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 상자와 겹치는 항목의 index 목록. 좌표계는 호출부가 맞춘다(상자·항목 모두 같은 기준). */
export function indicesInBox(
  rects: IndexedRect[],
  box: { x1: number; y1: number; x2: number; y2: number },
): number[] {
  const left = Math.min(box.x1, box.x2);
  const right = Math.max(box.x1, box.x2);
  const top = Math.min(box.y1, box.y2);
  const bottom = Math.max(box.y1, box.y2);
  return rects
    .filter(
      (r) =>
        r.right > r.left &&
        r.bottom > r.top &&
        left < r.right &&
        right > r.left &&
        top < r.bottom &&
        bottom > r.top,
    )
    .map((r) => r.index);
}

/**
 * 길게 누른 뒤 끌어 연속 선택: 시작 전 선택(base)에서 출발해 anchor~current 범위(목록 순서)에만
 * select(true=선택, false=해제)를 적용한다. 범위 밖은 base 그대로라, 손가락을 되돌리면 원상 복구된다.
 */
export function applySweepSelection(
  base: ReadonlySet<string>,
  names: string[],
  anchor: number,
  current: number,
  select: boolean,
): Set<string> {
  const next = new Set(base);
  const from = Math.max(0, Math.min(anchor, current));
  const to = Math.min(names.length - 1, Math.max(anchor, current));
  for (let i = from; i <= to; i++) {
    if (select) next.add(names[i]);
    else next.delete(names[i]);
  }
  return next;
}

/** 가장자리 자동 스크롤 속도(px/프레임). 영역 밖이면 0. */
export function edgeAutoScrollSpeed(
  pointerY: number,
  top: number,
  bottom: number,
  zone = 36,
  max = 14,
): number {
  if (pointerY < top + zone) {
    return -Math.ceil(max * Math.min(1, (top + zone - pointerY) / zone));
  }
  if (pointerY > bottom - zone) {
    return Math.ceil(max * Math.min(1, (pointerY - (bottom - zone)) / zone));
  }
  return 0;
}
