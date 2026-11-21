// 편집 칸 색칠 층(highlightPrompt)의 ##주석## 처리(2026-11-21 포크 반영 묶음 4 결함 A).
// - 가중치 범위(N::…::)·괄호 깊이({}/[])는 주석을 같은 길이 공백으로 가린 글에서 계산한다(생성은 주석을 걷은 뒤 해석).
// - 주석과 같은 쉼표 구획의 주석 아닌 부분은 주석이 없을 때의 보통 단어와 같은 처리(가중치 색 포함)를 받는다.
// - 쉼표 토큰은 자기 위치로 색을 판정한다(종전에는 한 글자 뒤).
// - 불변식: 태그를 걷은 글자열(엔티티 해석 후) = 원문(입력 칸 위에 겹쳐 그리는 층).
jest.mock('../index', () => ({
  backend: {},
  isMobile: false,
  promptService: {
    tryExpandPiece: (p: string) => {
      if (p !== '<lib.p>') throw new Error('no piece');
    },
    isGlobal: () => false,
    isMulti: () => false,
  },
  globalPieceService: { library: new Map() },
}));

import { highlightPrompt } from '../PromptService';

const render = (text: string) => {
  const div = document.createElement('div');
  div.innerHTML = highlightPrompt({} as any, text);
  return div;
};

/** 원문 위치 i 의 글자를 감싼 요소들의 클래스(바깥 → 안). */
const classesAt = (div: HTMLElement, index: number): string[] => {
  const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT);
  let pos = 0;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const len = node.textContent!.length;
    if (index < pos + len) {
      const out: string[] = [];
      let el = node.parentElement;
      while (el && el !== div) {
        out.unshift(...Array.from(el.classList));
        el = el.parentElement;
      }
      return out;
    }
    pos += len;
  }
  throw new Error(`index ${index} out of range`);
};

const WEIGHT_CLASSES = [
  'syntax-weight-emphasis',
  'syntax-weight-deemphasis',
  'syntax-weight-negative',
];
const weightOf = (div: HTMLElement, index: number) =>
  classesAt(div, index).filter((c) => WEIGHT_CLASSES.includes(c));

/** 원문에서 needle(occurrence 번째) 의 모든 글자 위치. */
const indicesOf = (text: string, needle: string, occurrence = 0) => {
  let at = -1;
  for (let k = 0; k <= occurrence; k++) at = text.indexOf(needle, at + 1);
  if (at < 0) throw new Error(`${needle} not found`);
  return Array.from({ length: needle.length }, (_, i) => at + i);
};

const expectWeight = (
  text: string,
  needle: string,
  expected: string[],
  occurrence = 0,
) => {
  const div = render(text);
  for (const i of indicesOf(text, needle, occurrence)) {
    expect({ i, ch: text[i], w: weightOf(div, i) }).toEqual({
      i,
      ch: text[i],
      w: expected,
    });
  }
};

const expectClass = (text: string, needle: string, cls: string, has: boolean) => {
  const div = render(text);
  for (const i of indicesOf(text, needle)) {
    expect({ i, ch: text[i], has: classesAt(div, i).includes(cls) }).toEqual({
      i,
      ch: text[i],
      has,
    });
  }
};

describe('highlightPrompt — 주석 안의 가중치 표식은 바깥 색에 영향 없음', () => {
  test('주석 안 2:: 가 뒤의 :: 까지 범위로 잡히지 않는다', () => {
    const text = '##2::## tag, other, 1.2::strong::';
    expectWeight(text, 'tag', []);
    expectWeight(text, 'other', []);
    expectWeight(text, 'strong', ['syntax-weight-emphasis']);
    expectClass(text, '##2::##', 'syntax-comment', true);
  });

  test('주석 안 { 가 뒤 태그를 강조 색으로 만들지 않는다', () => {
    expectWeight('##{## tag', 'tag', []);
    expectWeight('##[## tag, other', 'other', []);
  });
});

describe('highlightPrompt — 주석과 같은 구획의 보통 단어', () => {
  test('가중치 범위를 가로지르는 주석: 양쪽 단어 모두 가중치 색, 주석은 주석 색만', () => {
    const text = '1.3::aaa ##메모## bbb::';
    expectWeight(text, 'aaa', ['syntax-weight-emphasis']);
    expectWeight(text, 'bbb', ['syntax-weight-emphasis']);
    expectWeight(text, '##메모##', []);
    expectClass(text, '##메모##', 'syntax-comment', true);
    expectClass(text, 'aaa', 'syntax-comment', false);
  });

  test('중괄호 안 주석 + 태그', () => {
    expectWeight('{##메모## tag}', 'tag', ['syntax-weight-emphasis']);
    expectWeight('[tag ##메모##]', 'tag', ['syntax-weight-deemphasis']);
    expectWeight('0.5::x ##m##::, y', 'x', ['syntax-weight-deemphasis']);
    expectWeight('-1::x ##m##::', 'x', ['syntax-weight-negative']);
  });

  test('조각·강조 괄호는 주석 옆에서도 보통 단어와 같은 클래스', () => {
    expectClass('<lib.p> ##메모##, a', '<lib.p>', 'syntax-wildcard', true);
    expectClass('##메모## {blue hair}', 'blue hair', 'syntax-strong', true);
    expectWeight('##메모## {blue hair}', 'blue hair', ['syntax-weight-emphasis']);
    expectClass('[red] ##m##', 'red', 'syntax-weak', true);
  });

  test('괄호 오류 표시는 주석 옆 단어에서도 그대로(주석 안 괄호는 무시)', () => {
    expectClass('a ##)## (b', '(', 'syntax-error', true);
    expectClass('a ##(## b', '(', 'syntax-error', false);
  });

  test('주석 안 쉼표·단어는 주석 색', () => {
    const text = 'a, ##x, {y}, 1.2::z::##, b';
    expectClass(text, '##x, {y}, 1.2::z::##', 'syntax-comment', true);
    expectWeight(text, '##x, {y}, 1.2::z::##', []);
  });
});

describe('highlightPrompt — 쉼표는 자기 위치로 판정', () => {
  test('가중치 범위 시작 바로 앞 쉼표는 칠하지 않는다', () => {
    expectWeight('a,{b}', ',', []);
    expectWeight('a,1.2::b::', ',', []);
  });
  test('가중치 범위 안 쉼표는 칠한다', () => {
    expectWeight('{a,b}', ',', ['syntax-weight-emphasis']);
    expectWeight('1.2::a,b::', ',', ['syntax-weight-emphasis']);
    expectWeight('{a,b},c', ',', ['syntax-weight-emphasis']);
    expectWeight('{a,b},c', ',', [], 1);
  });
});

describe('highlightPrompt — 여러 줄 주석', () => {
  test('줄을 넘는 주석의 모든 글자가 주석 색, 앞뒤 단어는 보통', () => {
    const text = 'a, ##x\ny, {z## b\nc';
    const div = render(text);
    for (const i of indicesOf(text, '##x')) expect(classesAt(div, i)).toContain('syntax-comment');
    for (const i of indicesOf(text, 'y, {z##')) expect(classesAt(div, i)).toContain('syntax-comment');
    expect(classesAt(div, text.indexOf('b'))).not.toContain('syntax-comment');
    expect(weightOf(div, text.indexOf('b'))).toEqual([]);
    expect(weightOf(div, text.indexOf('c'))).toEqual([]);
  });
  test('여러 줄 주석을 사이에 둔 강조 괄호', () => {
    expectWeight('{##x\n##y}', 'y', ['syntax-weight-emphasis']);
  });
});

describe('highlightPrompt — 태그를 걷은 글자열 = 원문', () => {
  const inputs = [
    '',
    'a',
    ',',
    ',,',
    'a,,b',
    'a, b\n\nc,',
    '\n',
    '  ,  ',
    '{blue hair}, [red], 1.5::smile::, <lib.p>, <x.y>, a | b',
    'a, (b',
    '1.2::a, {b}, [c]::, d',
    '##메모##',
    '####',
    '## 짝 없음',
    'a ## b',
    '##a##b##c##',
    'aaa, ##메모## bbb',
    '##2::## tag, other, 1.2::strong::',
    '1.3::aaa ##메모## bbb::',
    '{##메모## tag}',
    'a, ##x\ny, {z## b\nc',
    '##x\n\n\ny##\n',
    'a,##x,##,b',
    '<lib.p> ##m##, ##m## <x.y>',
    'a ##)## (b',
    '##<b>&amp;##, x',
    '  ##m##  ,  ',
    'a,\n##m##,\n',
  ];
  test.each(inputs)('%j', (text) => {
    expect(render(text).textContent).toBe(text);
  });
});

describe('highlightPrompt — 주석 없는 입력의 구조(종전 표시)', () => {
  // 쉼표 색 판정과 무관한 입력 — 글자별 클래스·감싸는 요소 구조로 종전 표시를 확인한다.
  const allClasses = (text: string) => {
    const div = render(text);
    return { div, at: (i: number) => classesAt(div, i).join(' ') };
  };

  test('강조·약화·명시 가중치·조각·분할 클래스', () => {
    const text = '{blue hair}, [red], 1.5::smile::, <lib.p>, <x.y>, a | b';
    const { div, at } = allClasses(text);
    for (const i of indicesOf(text, '{blue hair}'))
      expect(at(i)).toBe('syntax-line syntax-weight-emphasis syntax-strong');
    for (const i of indicesOf(text, '[red]'))
      expect(at(i)).toBe('syntax-line syntax-weight-deemphasis syntax-weak');
    for (const i of indicesOf(text, '1.5::smile::'))
      expect(at(i)).toBe('syntax-line syntax-weight-emphasis');
    for (const i of indicesOf(text, '<lib.p>')) expect(at(i)).toBe('syntax-line syntax-wildcard');
    for (const i of indicesOf(text, '<x.y>')) expect(at(i)).toBe('syntax-line syntax-error');
    // 구획 사이 공백·쉼표·분할 기호가 들어 있는 구획(a | b)은 감싸지 않음
    for (const i of indicesOf(text, ', a | b')) expect(at(i)).toBe('syntax-line');
    // 조각에는 툴팁 속성
    const wildcard = div.querySelector('.syntax-wildcard')!;
    expect(wildcard.getAttribute('onmousemove')).toContain("showPromptTooltip('<lib.p>'");
    expect(wildcard.getAttribute('onmouseout')).toContain('clearPromptTooltip');
    // 줄 하나 = syntax-line 하나, 겹친 span 없음
    expect(div.children).toHaveLength(1);
    expect(div.querySelectorAll('span span span')).toHaveLength(0);
  });

  test('분할 기호 단독 구획', () => {
    const text = 'a, |, b';
    const { div, at } = allClasses(text);
    expect(at(text.indexOf('|'))).toBe('syntax-line syntax-split');
    expect(div.querySelector('.syntax-split')!.getAttribute('onmousemove')).toContain(
      "showPromptTooltip('|'",
    );
  });

  test('줄·빈 구획·공백 구획은 글자만', () => {
    const text = 'a,,b\n\n  ,c';
    const { div } = allClasses(text);
    expect(div.children).toHaveLength(3);
    expect(Array.from(div.children).map((c) => c.className)).toEqual([
      'syntax-line',
      'syntax-line',
      'syntax-line',
    ]);
    expect(div.querySelectorAll('span span')).toHaveLength(0);
    expect(div.textContent).toBe(text);
  });

  test('괄호 오류 위치는 syntax-word 안의 syntax-error 한 글자', () => {
    const text = 'a, (b';
    const { div, at } = allClasses(text);
    expect(at(text.indexOf('('))).toBe('syntax-line syntax-word syntax-error');
    expect(at(text.indexOf('b'))).toBe('syntax-line syntax-word');
    expect(at(0)).toBe('syntax-line');
    expect(div.querySelector('.syntax-word')!.textContent).toBe(' (b');
  });

  test('가중치 범위 안 앞 공백은 하이라이트에 포함, 범위 밖 앞 공백은 제외', () => {
    const text = '1.2::a, b::, c';
    const { at } = allClasses(text);
    expect(at(text.indexOf(' b'))).toBe('syntax-line syntax-weight-emphasis');
    expect(at(text.indexOf(' c'))).toBe('syntax-line');
    const t2 = 'x, {y}';
    expect(allClasses(t2).at(t2.indexOf(' {'))).toBe('syntax-line');
    expect(allClasses(t2).at(t2.indexOf('{'))).toBe('syntax-line syntax-weight-emphasis syntax-strong');
  });
});

describe('highlightPrompt — 주석과 같은 구획의 꺾쇠 이스케이프', () => {
  test('꺾쇠가 여럿이어도 글자가 사라지지 않는다', () => {
    for (const text of ['<a.b> <c.d> ##메모##', '##m## <a> <b>, x', 'a<b ##m## c<d>e>']) {
      expect(render(text).textContent).toBe(text);
    }
  });
});
