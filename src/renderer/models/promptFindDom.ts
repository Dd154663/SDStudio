/**
 * 프롬프트 편집기의 색칠된 DOM 과 글자 오프셋 사이의 변환·「이 칸에서 찾기」 일치 표시(2026-11-22).
 *
 * 오프셋 규칙(PC 편집기 CursorMemorizeEditor.setCaretPosition 과 같은 규칙 — 그 메서드도 이 함수를 쓴다):
 *  텍스트 노드는 글자 수만큼, `<br>` 은 1 로 센다. 노드를 앞에서부터 훑어 「여기까지 센 수 + 이 텍스트 노드 길이 ≥ 위치」인
 *  첫 텍스트 노드(또는 정확히 그 위치의 `<br>`)에 점을 둔다. preferNext 면 경계 위치를 다음 노드의 처음에 둔다
 *  (범위의 시작점 — 칠하기·스크롤 대상 요소가 실제 글자를 담은 요소가 되게).
 *
 * 일치 표시는 색칠 파이프라인(highlightPrompt → innerHTML)을 건드리지 않고 CSS Custom Highlight API 로 칠한다.
 * 이름은 전역 두 개(한 번에 한 칸만 열림). 지원하지 않는 환경에서는 아무것도 하지 않는다(예외 없음).
 */

export const PROMPT_FIND_HIGHLIGHT_ALL = 'sdstudio-find-match';
export const PROMPT_FIND_HIGHLIGHT_CURRENT = 'sdstudio-find-current';

export interface DomPoint {
  node: Node;
  offset: number;
}

export function promptOffsetToDomPoint(
  root: Node,
  pos: number,
  preferNext: boolean = false,
): DomPoint | null {
  const doc = root.ownerDocument ?? document;
  const it = doc.createNodeIterator(
    root,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    null,
  );
  let offset = 0;
  let node: Node | null;
  while ((node = it.nextNode())) {
    if (node.nodeName === 'BR') {
      if (offset === pos) return { node, offset: 0 };
      offset += 1;
    }
    if (node.nodeType === 3) {
      const len = node.textContent!.length;
      if (preferNext ? offset + len > pos : offset + len >= pos) {
        return { node, offset: pos - offset };
      }
      offset += len;
    }
  }
  return null;
}

/** [start, end) 를 DOM Range 로. 글자 층이 더 짧으면(값과 화면이 잠깐 어긋남) null. */
export function promptRangeToDomRange(
  root: Node,
  start: number,
  end: number,
): Range | null {
  if (end < start) return null;
  const a = promptOffsetToDomPoint(root, start, true);
  const b = promptOffsetToDomPoint(root, end, false);
  if (!a || !b) return null;
  try {
    const doc = root.ownerDocument ?? document;
    const r = doc.createRange();
    r.setStart(a.node, a.offset);
    r.setEnd(b.node, b.offset);
    return r;
  } catch {
    return null;
  }
}

function highlightRegistry(): any | null {
  try {
    const css: any = typeof CSS !== 'undefined' ? CSS : undefined;
    const Ctor: any = (globalThis as any).Highlight;
    if (!css || !css.highlights || typeof Ctor !== 'function') return null;
    return css.highlights;
  } catch {
    return null;
  }
}

export function supportsPromptFindHighlight(): boolean {
  return !!highlightRegistry();
}

/** 모든 일치 = 옅은 표시, 현재 자리 = 진한 표시. 지원하지 않으면 무동작. */
export function paintPromptFindHighlights(
  all: readonly Range[],
  current: Range | null,
): void {
  const reg = highlightRegistry();
  if (!reg) return;
  try {
    const Ctor: any = (globalThis as any).Highlight;
    const others = current ? all.filter((r) => r !== current) : all;
    if (others.length) reg.set(PROMPT_FIND_HIGHLIGHT_ALL, new Ctor(...others));
    else reg.delete(PROMPT_FIND_HIGHLIGHT_ALL);
    if (current) {
      const h = new Ctor(current);
      try {
        h.priority = 1;
      } catch {}
      reg.set(PROMPT_FIND_HIGHLIGHT_CURRENT, h);
    } else reg.delete(PROMPT_FIND_HIGHLIGHT_CURRENT);
  } catch {
    // 표시는 보조 기능 — 실패해도 찾기·바꾸기는 그대로.
  }
}

export function clearPromptFindHighlights(): void {
  const reg = highlightRegistry();
  if (!reg) return;
  try {
    reg.delete(PROMPT_FIND_HIGHLIGHT_ALL);
    reg.delete(PROMPT_FIND_HIGHLIGHT_CURRENT);
  } catch {}
}

function rangeRect(range: Range): DOMRect | null {
  if (typeof (range as any).getBoundingClientRect !== 'function') return null;
  try {
    const rects =
      typeof range.getClientRects === 'function' ? range.getClientRects() : null;
    const r =
      rects && rects.length > 0 ? rects[0] : range.getBoundingClientRect();
    if (!r || (r.width === 0 && r.height === 0 && r.top === 0 && r.left === 0))
      return null;
    return r as DOMRect;
  } catch {
    return null;
  }
}

function isScrollable(el: HTMLElement): boolean {
  if (el.scrollHeight <= el.clientHeight + 1) return false;
  try {
    const oy = getComputedStyle(el).overflowY;
    return oy === 'auto' || oy === 'scroll' || oy === 'overlay';
  } catch {
    return false;
  }
}

/**
 * 현재 자리가 보이게 스크롤한다 — 편집기 스크롤 칸(위·아래 양방향)과 그 바깥 스크롤 조상.
 * bottomLimit = 화면에서 가려지는 아래 경계(모바일 키보드 위 칩의 윗변 등). 없으면 보이는 화면 아래.
 */
export function scrollPromptRangeIntoView(
  range: Range,
  container: HTMLElement | null,
  bottomLimit?: number,
): void {
  const MARGIN = 8;
  const chain: HTMLElement[] = [];
  if (container) chain.push(container);
  let p = (container ?? null)?.parentElement ?? null;
  while (p && p !== document.body && p !== document.documentElement) {
    if (isScrollable(p)) chain.push(p);
    p = p.parentElement;
  }
  for (const el of chain) {
    const r = rangeRect(range);
    if (!r) return;
    const box = el.getBoundingClientRect();
    let top = box.top;
    let bottom = box.bottom;
    if (typeof bottomLimit === 'number') bottom = Math.min(bottom, bottomLimit);
    if (bottom - top < r.height + MARGIN * 2) {
      // 보이는 칸이 줄 하나보다 좁으면 위쪽 맞춤만.
      bottom = top + r.height + MARGIN * 2;
    }
    if (r.top < top + MARGIN) el.scrollTop -= top + MARGIN - r.top;
    else if (r.bottom > bottom - MARGIN) el.scrollTop += r.bottom - (bottom - MARGIN);
  }
}
