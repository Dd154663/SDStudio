import {
  REFERENCE_SLIDER_STEPS,
  isCurvedStrengthSlider,
  isSteepStrength,
  sliderPosToStrength,
  strengthToSliderPos,
} from '../referenceEditorSpec';

describe('레퍼런스 Strength 슬라이더 눈금', () => {
  const S = REFERENCE_SLIDER_STEPS;

  test('상한 5(V5): 앞 절반 0~1, 뒤 절반 1~5', () => {
    expect(isCurvedStrengthSlider(5)).toBe(true);
    expect(sliderPosToStrength(0, 5)).toBe(0);
    expect(sliderPosToStrength(S / 4, 5)).toBe(0.5);
    expect(sliderPosToStrength(S / 2, 5)).toBe(1);
    expect(sliderPosToStrength((S * 3) / 4, 5)).toBe(3);
    expect(sliderPosToStrength(S, 5)).toBe(5);
    // 앞 절반은 0.01 단위
    expect(sliderPosToStrength(1, 5)).toBe(0.01);
    expect(sliderPosToStrength(60, 5)).toBe(0.6);
  });

  test('상한 5: 값 → 위치 → 값이 앞 절반에서 정확히 돌아온다', () => {
    for (const v of [0, 0.01, 0.37, 0.6, 0.99, 1]) {
      expect(sliderPosToStrength(strengthToSliderPos(v, 5), 5)).toBe(v);
    }
    expect(strengthToSliderPos(1, 5)).toBe(S / 2);
    expect(strengthToSliderPos(3, 5)).toBe((S * 3) / 4);
    expect(strengthToSliderPos(5, 5)).toBe(S);
    // 범위를 벗어난 값은 양 끝
    expect(strengthToSliderPos(9, 5)).toBe(S);
    expect(strengthToSliderPos(-1, 5)).toBe(0);
  });

  test('상한 2(V4.5): 종전처럼 고른 눈금·0.01 단위', () => {
    expect(isCurvedStrengthSlider(2)).toBe(false);
    expect(sliderPosToStrength(S / 2, 2)).toBe(1);
    expect(sliderPosToStrength(S, 2)).toBe(2);
    for (const v of [0, 0.01, 0.6, 1.23, 2]) {
      expect(sliderPosToStrength(strengthToSliderPos(v, 2), 2)).toBe(v);
    }
  });

  test('가파른 구간 판정', () => {
    expect(isSteepStrength(1, 5)).toBe(false);
    expect(isSteepStrength(1.04, 5)).toBe(true);
    expect(isSteepStrength(1.5, 2)).toBe(false);
  });
});
