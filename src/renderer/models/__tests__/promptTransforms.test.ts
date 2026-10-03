import {
  adjustPromptWeightAtSelection,
  buildArtistPromptVariants,
  formatPromptWeightLabel,
  getPromptCommentAtSelection,
  getPromptWeightAtSelection,
  PROMPT_WEIGHT_STEP,
  togglePromptCommentAtSelection,
} from '../promptTransforms';

describe('커서 구획의 현재 가중치 읽기(모바일 칩)', () => {
  it('래퍼가 없으면 1, 있으면 그 값과 안쪽을 돌려준다', () => {
    const text = '1girl, 1.15::{artist:ixy}::, , -0.05::bad::';
    expect(getPromptWeightAtSelection(text, 2)).toEqual({ core: '1girl', inner: '1girl', weight: 1 });
    const at = text.indexOf('ixy');
    expect(getPromptWeightAtSelection(text, at)).toEqual({ core: '1.15::{artist:ixy}::', inner: '{artist:ixy}', weight: 1.15 });
    expect(getPromptWeightAtSelection(text, text.indexOf('bad'))!.weight).toBe(-0.05);
    expect(getPromptWeightAtSelection(text, text.indexOf(', ,') + 2)).toBeUndefined();
    expect(getPromptWeightAtSelection('', 0)).toBeUndefined();
  });
  it('조절 함수와 같은 구획을 본다 — 조절 뒤 읽으면 새 값', () => {
    const text = 'a, b';
    const r = adjustPromptWeightAtSelection(text, 3, 3, -PROMPT_WEIGHT_STEP)!;
    expect(getPromptWeightAtSelection(r.text, r.selectionStart)!.weight).toBe(0.95);
    const r2 = adjustPromptWeightAtSelection(r.text, r.selectionStart, r.selectionEnd, PROMPT_WEIGHT_STEP)!;
    expect(r2.text).toBe('a, b');
    expect(getPromptWeightAtSelection(r2.text, r2.selectionStart)!.weight).toBe(1);
  });
  it('표시 형식: 1 → 1.0, 그 외 둘째 자리까지, 음수 허용', () => {
    expect(formatPromptWeightLabel(1)).toBe('1.0');
    expect(formatPromptWeightLabel(1.15)).toBe('1.15');
    expect(formatPromptWeightLabel(0.95)).toBe('0.95');
    expect(formatPromptWeightLabel(2)).toBe('2.0');
    expect(formatPromptWeightLabel(-0.05)).toBe('-0.05');
    expect(formatPromptWeightLabel(0.1 + 0.2)).toBe('0.3');
  });
});

describe('커서 기준 프롬프트 가중치 조절', () => {
  it('커서가 있는 쉼표 구간만 0.05 올린다', () => {
    const text = 'artist:aaa, artist:bbb';
    const caret = text.indexOf('bbb') + 1;
    const result = adjustPromptWeightAtSelection(text, caret, caret, 0.05)!;
    expect(result.text).toBe('artist:aaa, 1.05::artist:bbb::');
    expect(result.text[result.selectionStart]).toBe('b');
  });

  it('기존 가중치를 이어서 조절하고 1.0이면 래퍼를 제거한다', () => {
    const weighted = '1.05::artist:bbb::';
    const caret = weighted.indexOf('bbb');
    const raised = adjustPromptWeightAtSelection(
      weighted,
      caret,
      caret,
      0.05,
    )!;
    expect(raised.text).toBe('1.1::artist:bbb::');
    const reset = adjustPromptWeightAtSelection(
      raised.text,
      raised.selectionStart,
      raised.selectionEnd,
      -0.1,
    )!;
    expect(reset.text).toBe('artist:bbb');
  });

  it('빈 쉼표 구간은 변경하지 않는다', () => {
    expect(adjustPromptWeightAtSelection('tag,   , next', 6, 6, 0.05)).toBe(
      undefined,
    );
  });
});

describe('커서 기준 주석 토글(모바일 칩 #)', () => {
  const toggleAt = (text: string, caret: number) =>
    togglePromptCommentAtSelection(text, caret, caret);

  it('단순 태그 구획을 감싸고 커서는 같은 글자 앞에 둔다', () => {
    const text = '1girl, blue hair, smile';
    const caret = text.indexOf('hair');
    const r = toggleAt(text, caret)!;
    expect(r.text).toBe('1girl, ##blue hair##, smile');
    expect(r.text.slice(r.selectionStart, r.selectionStart + 4)).toBe('hair');
    expect(r.selectionEnd).toBe(r.selectionStart);
  });

  it('앞뒤 공백은 주석 밖에 남긴다', () => {
    expect(toggleAt('a,   b c  , d', 6)!.text).toBe('a,   ##b c##  , d');
  });

  it('가중치 래퍼 구획은 래퍼째 감싸고 가중치는 건드리지 않는다', () => {
    const text = 'a, 1.2::x y::, b';
    const r = toggleAt(text, text.indexOf('y'))!;
    expect(r.text).toBe('a, ##1.2::x y::##, b');
    expect(r.text[r.selectionStart]).toBe('y');
  });

  it('선택 범위 양끝을 함께 매핑한다(구획 앞·안·뒤)', () => {
    const text = 'aa, bb, cc';
    // 커서 구획은 selectionStart 기준(bb). start=bb 안, end=cc 안
    const r = togglePromptCommentAtSelection(text, 5, 9)!;
    expect(r.text).toBe('aa, ##bb##, cc');
    expect(r.selectionStart).toBe(7); // b|b → ##b|b
    expect(r.selectionEnd).toBe(13); // c|c 가 4칸 밀림
    expect(r.text.slice(r.selectionStart, r.selectionEnd)).toBe('b##, c');
  });

  it('커서가 주석 안이면 여는·닫는 ## 만 지우고 안쪽은 보존한다', () => {
    const text = 'a, ##b, c ##, d';
    const caret = text.indexOf('c ');
    const r = toggleAt(text, caret)!;
    expect(r.text).toBe('a, b, c , d');
    expect(r.text[r.selectionStart]).toBe('c');
  });

  it('## 표식 안쪽·바깥 경계에 닿아 있어도 그 주석으로 본다', () => {
    const text = 'x, ##memo##, y';
    const start = text.indexOf('##');
    const end = text.indexOf('##', start + 2) + 2;
    for (const caret of [start, start + 1, start + 2, end - 2, end - 1, end]) {
      expect(getPromptCommentAtSelection(text, caret)).toEqual({ start, end });
      expect(toggleAt(text, caret)!.text).toBe('x, memo, y');
    }
    // 경계 매핑: 여는 표식 안 → 안쪽 시작, 닫는 표식 안·바로 뒤 → 안쪽 끝
    expect(toggleAt(text, start + 1)!.selectionStart).toBe(start);
    expect(toggleAt(text, end)!.selectionStart).toBe(end - 4);
    expect(toggleAt(text, end - 1)!.selectionStart).toBe(end - 4);
    expect(getPromptCommentAtSelection(text, text.indexOf('y'))).toBeUndefined();
  });

  it('여러 주석 중 커서가 있는 것만 풀고, 뒤쪽 선택은 4칸 당긴다', () => {
    const text = '##a##, ##b##, ##c##';
    const caret = text.indexOf('b');
    const r = togglePromptCommentAtSelection(text, caret, text.indexOf('c'))!;
    expect(r.text).toBe('##a##, b, ##c##');
    expect(r.text[r.selectionStart]).toBe('b');
    expect(r.text[r.selectionEnd]).toBe('c');
  });

  it('커서 구획이 통째로 주석이면 구획 앞 공백에 커서가 있어도 푼다', () => {
    const text = 'a, ##b##';
    expect(getPromptCommentAtSelection(text, 2)).toEqual({ start: 3, end: 8 });
    expect(toggleAt(text, 2)!.text).toBe('a, b');
  });

  it('빈 구획·짝이 깨지는 경우는 거부한다', () => {
    expect(toggleAt('tag,   , next', 6)).toBeUndefined();
    expect(toggleAt('', 0)).toBeUndefined();
    // core 안에 홀수 ## (감싸면 짝이 바뀐다)
    expect(toggleAt('a, b##c, d', 4)).toBeUndefined();
    // core 안에 완결 주석이 섞인 경우(커서는 주석 밖)
    const mixed = 'a, x ##m## y, d';
    expect(toggleAt(mixed, mixed.indexOf('x'))).toBeUndefined();
    // 다른 구획의 짝 없는 ## 가 새 표식과 짝을 이루게 되는 경우
    expect(toggleAt('## a, b', 6)).toBeUndefined();
  });

  it('감싸기 → 풀기는 원문과 커서를 되돌린다(멱등)', () => {
    const cases: Array<[string, number]> = [
      ['1girl, blue hair, smile', 9],
      ['a, 1.2::x y::, b', 9],
      ['a,   b c  , d', 6],
      ['solo', 0],
      ['solo', 4],
      ['##a##, b', 7],
    ];
    for (const [text, caret] of cases) {
      const wrapped = toggleAt(text, caret)!;
      expect(getPromptCommentAtSelection(wrapped.text, wrapped.selectionStart)).toBeDefined();
      const back = toggleAt(wrapped.text, wrapped.selectionStart)!;
      expect(back.text).toBe(text);
      expect(back.selectionStart).toBe(caret);
    }
  });
});

describe('작가 분해 프롬프트 변형', () => {
  it('여러 양의 프롬프트 영역에서 작가 태그 하나씩만 남긴다', () => {
    const variants = buildArtistPromptVariants({
      frontPrompt: '1girl, artist:aaa, best quality',
      extraPrompt: '{artist:bbb}, outdoors',
      backPrompt: '1.2::artist:ccc::, year 2026',
    });
    expect(variants.map((v) => v.artistTag)).toEqual([
      'artist:aaa',
      'artist:bbb',
      'artist:ccc',
    ]);
    expect(variants[1]).toMatchObject({
      frontPrompt: '1girl, best quality',
      extraPrompt: '{artist:bbb}, outdoors',
      backPrompt: 'year 2026',
    });
  });

  it('같은 작가가 여러 번 있으면 예약 변형을 중복 생성하지 않는다', () => {
    const variants = buildArtistPromptVariants({
      frontPrompt: 'artist:AAA, tag',
      backPrompt: '{artist:aaa}',
    });
    expect(variants).toHaveLength(1);
    expect(variants[0].frontPrompt).toBe('artist:AAA, tag');
    expect(variants[0].backPrompt).toBe('');
  });
});
