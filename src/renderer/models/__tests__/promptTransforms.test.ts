import {
  adjustPromptWeightAtSelection,
  buildArtistPromptVariants,
  formatPromptWeightLabel,
  getPromptWeightAtSelection,
  PROMPT_WEIGHT_STEP,
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
