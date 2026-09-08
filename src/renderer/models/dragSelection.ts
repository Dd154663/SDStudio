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
