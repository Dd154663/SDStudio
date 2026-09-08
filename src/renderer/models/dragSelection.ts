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
