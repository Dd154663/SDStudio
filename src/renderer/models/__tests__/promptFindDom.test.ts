import {
  clearPromptFindHighlights,
  paintPromptFindHighlights,
  promptOffsetToDomPoint,
  promptRangeToDomRange,
  PROMPT_FIND_HIGHLIGHT_ALL,
  PROMPT_FIND_HIGHLIGHT_CURRENT,
  supportsPromptFindHighlight,
} from '../promptFindDom';

// 색칠된 편집기 DOM 과 같은 모양: 줄 span · 단어 span 중첩 · 줄바꿈 글자 · 끝의 <span></span><br>
const TEXT = 'cat, {blue hair}\n##memo##, dog';
function makeRoot(): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML =
    '<span class="syntax-line">cat, <span class="syntax-weight-emphasis syntax-strong">{blue hair}</span></span>\n' +
    '<span class="syntax-line"><span class="syntax-comment">##memo##</span>, dog</span>' +
    '<span></span><br>';
  document.body.appendChild(root);
  return root;
}

afterEach(() => {
  document.body.innerHTML = '';
  delete (globalThis as any).Highlight;
  delete (globalThis as any).CSS;
});

describe('오프셋 → DOM 점·Range', () => {
  test('색칠 DOM 의 글자는 원문과 같다', () => {
    expect(makeRoot().textContent).toBe(TEXT);
  });
  test('span 중첩·줄바꿈을 지나도 Range 글자가 원문 구간과 같다', () => {
    const root = makeRoot();
    for (const q of ['cat', 'blue', '{blue hair}', 'hair}\n##me', '##memo##', 'dog', ', ']) {
      let from = 0;
      for (;;) {
        const i = TEXT.indexOf(q, from);
        if (i < 0) break;
        const r = promptRangeToDomRange(root, i, i + q.length)!;
        expect(r).not.toBeNull();
        expect(r.toString()).toBe(q);
        from = i + q.length;
      }
    }
  });
  test('경계 위치 — 기본은 앞 노드 끝(setCaretPosition 규칙), preferNext 면 다음 노드 처음', () => {
    const root = makeRoot();
    const at = 'cat, '.length;
    const a = promptOffsetToDomPoint(root, at)!;
    expect(a.node.textContent).toBe('cat, ');
    expect(a.offset).toBe(5);
    const b = promptOffsetToDomPoint(root, at, true)!;
    expect(b.node.textContent).toBe('{blue hair}');
    expect(b.offset).toBe(0);
  });
  test('끝(<br> 앞)과 글자 층보다 긴 위치', () => {
    const root = makeRoot();
    expect(promptOffsetToDomPoint(root, TEXT.length)).not.toBeNull();
    // 글자 끝을 다음 노드 쪽으로 = 끝의 <br>
    expect(promptOffsetToDomPoint(root, TEXT.length, true)!.node.nodeName).toBe('BR');
    expect(promptRangeToDomRange(root, 0, TEXT.length + 5)).toBeNull();
  });
});

describe('일치 표시(CSS Custom Highlight API)', () => {
  test('지원하지 않는 환경에서는 예외 없이 아무것도 하지 않는다', () => {
    expect(supportsPromptFindHighlight()).toBe(false);
    const root = makeRoot();
    const r = promptRangeToDomRange(root, 0, 3)!;
    expect(() => paintPromptFindHighlights([r], r)).not.toThrow();
    expect(() => clearPromptFindHighlights()).not.toThrow();
  });
  test('지원하면 전체·현재 두 이름으로 등록하고 지운다', () => {
    const reg = new Map<string, any>();
    (globalThis as any).CSS = { highlights: reg };
    (globalThis as any).Highlight = class {
      ranges: Range[];
      priority = 0;
      constructor(...ranges: Range[]) {
        this.ranges = ranges;
      }
    };
    expect(supportsPromptFindHighlight()).toBe(true);
    const root = makeRoot();
    const a = promptRangeToDomRange(root, 0, 3)!;
    const b = promptRangeToDomRange(root, 27, 30)!;
    paintPromptFindHighlights([a, b], b);
    expect(reg.get(PROMPT_FIND_HIGHLIGHT_ALL).ranges).toEqual([a]);
    expect(reg.get(PROMPT_FIND_HIGHLIGHT_CURRENT).ranges).toEqual([b]);
    expect(reg.get(PROMPT_FIND_HIGHLIGHT_CURRENT).priority).toBe(1);
    clearPromptFindHighlights();
    expect(reg.size).toBe(0);
  });
});
