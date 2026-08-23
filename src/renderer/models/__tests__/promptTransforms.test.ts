import {
  adjustPromptWeightAtSelection,
  buildArtistPromptVariants,
} from '../promptTransforms';

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
