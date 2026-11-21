// 랜덤 조각(여러 줄 조각 — 「이 중 한 줄 랜덤 선택」)의 ##주석## 줄 처리(결함 B).
// - 줄 나누기는 짝이 맞는 주석 밖의 줄바꿈에서만(주석 범위 = stripPromptComments 와 같은 규칙).
// - 주석을 걷어 내용이 없어진 줄(주석이 있던 줄)은 후보에서 뺀다. 주석 없이 일부러 비운 줄은 후보로 남긴다(종전 동작).
// - 후보가 하나도 없으면 랜덤 노드를 넣지 않는다.
const globalLibrary = new Map<string, any>();
jest.mock('../index', () => ({
  backend: {},
  isMobile: false,
  promptService: {},
  globalPieceService: { library: globalLibrary },
}));

import { PromptService } from '../PromptService';

const session = (prompt: string) =>
  ({
    name: 'project',
    library: new Map([
      ['lib', { pieces: [{ name: 'rand', prompt, multi: true }] }],
    ]),
  }) as any;

// 랜덤 노드의 후보 → 각 후보의 글자 목록
const optionsOf = (prompt: string): string[][] | undefined => {
  const svc = new PromptService();
  const node: any = svc.parseWord('<lib.rand>', session(prompt));
  expect(node.type).toBe('group');
  const rand = node.children.find((c: any) => c.type === 'random');
  if (!rand) {
    expect(node.children).toEqual([]);
    return undefined;
  }
  expect(node.children).toHaveLength(1);
  return rand.options.map((o: any) => o.children.map((c: any) => c.text));
};

describe('랜덤 조각의 주석 줄', () => {
  test('주석 없는 조각은 결과 불변(빈 줄은 「아무것도 안 넣기」 후보로 유지)', () => {
    expect(optionsOf('a, b\nc\n\nd')).toEqual([['a', 'b'], ['c'], [], ['d']]);
    expect(optionsOf('a\r\nb\rc')).toEqual([['a'], ['b'], ['c']]);
  });

  test('주석뿐인 줄은 후보에서 빠지고, 주석 없이 비운 줄은 남는다', () => {
    expect(optionsOf('a\n##꺼 둔 후보##\nb\n\nc')).toEqual([['a'], ['b'], [], ['c']]);
    // 공백·쉼표만 남는 줄도 주석이 있었으면 뺀다
    expect(optionsOf('a\n  ##x##, \nb')).toEqual([['a'], ['b']]);
  });

  test('한 줄에 주석과 내용이 섞이면 주석만 빠진 후보', () => {
    expect(optionsOf('blue hair, ##red hair##\ngreen hair')).toEqual([
      ['blue hair'],
      ['green hair'],
    ]);
  });

  test('여러 줄에 걸친 주석은 한 덩어리로 걷히고 ## 글자가 남지 않는다', () => {
    const opts = optionsOf('a\n##메모 1\n메모 2##\nb\nc ##x\ny## d');
    expect(opts).toEqual([['a'], ['b'], ['c  d']]);
    expect(JSON.stringify(opts)).not.toContain('#');
  });

  test('모든 줄이 주석이면 랜덤 노드를 넣지 않는다', () => {
    expect(optionsOf('##a##\n##b\nc##')).toBeUndefined();
  });

  test('툴팁 미리보기의 줄도 생성 후보와 같은 함수(같은 개수·같은 글자)', () => {
    const prompt = 'a\n##꺼 둔 후보##\nb\n\n##메모\n메모##\nc, ##x##';
    const svc = new PromptService();
    (window as any).curSession = session(prompt);
    let text = '';
    svc.addEventListener('prompt-tooltip', (e: any) => {
      text = e.detail.text;
    });
    svc.showPromptTooltip('<lib.rand>', { clientX: 0, clientY: 0 });
    delete (window as any).curSession;
    expect(text).toBe('이 중 한 줄 랜덤 선택:\na\nb\n\nc, ');
    expect(optionsOf(prompt)).toHaveLength(4);
  });

  test('짝 없는 ## 하나는 글자 그대로(종전 규칙)', () => {
    expect(optionsOf('a ## b\nc')).toEqual([['a ## b'], ['c']]);
  });
});
