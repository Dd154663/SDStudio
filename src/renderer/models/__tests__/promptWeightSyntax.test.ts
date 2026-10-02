// 2026-10-02 I2 회귀 — 0 생략 소수(.6::) 등 가중치 숫자 표기를 하이라이트·칩·조절이 같게 읽는다.
import {
  makeExplicitWeightRangeRegex,
  parsePromptWeightNumber,
  PROMPT_WEIGHT_OPEN_AT_START_RE,
} from '../promptWeightSyntax';
import {
  adjustPromptWeightAtSelection,
  getPromptWeightAtSelection,
} from '../promptTransforms';
import { trimAutocompleteWord, autocompleteTagCategory } from '../promptAutocomplete';

/** 하이라이트(highlightPrompt)가 모으는 명시 가중치 범위와 같은 계산. */
function explicitWeights(text: string) {
  const re = makeExplicitWeightRangeRegex();
  const out: { start: number; weight: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push({ start: m.index, weight: parsePromptWeightNumber(m[1]) });
  return out;
}

describe('가중치 숫자 표기 파싱', () => {
  it('여러 표기를 일관되게 수치화', () => {
    expect(parsePromptWeightNumber('.6')).toBe(0.6);
    expect(parsePromptWeightNumber('0.6')).toBe(0.6);
    expect(parsePromptWeightNumber('-.5')).toBe(-0.5);
    expect(parsePromptWeightNumber('-0.8')).toBe(-0.8);
    expect(parsePromptWeightNumber('1.')).toBe(1);
    expect(parsePromptWeightNumber('1.0')).toBe(1);
    expect(parsePromptWeightNumber('2')).toBe(2);
    expect(parsePromptWeightNumber('abc')).toBeNaN();
    expect(parsePromptWeightNumber('.')).toBeNaN();
  });
  it('여는 표식 정규식', () => {
    expect('.6::x'.match(PROMPT_WEIGHT_OPEN_AT_START_RE)?.[1]).toBe('.6');
    expect('-.5::x'.match(PROMPT_WEIGHT_OPEN_AT_START_RE)?.[1]).toBe('-.5');
    expect('1girl::'.match(PROMPT_WEIGHT_OPEN_AT_START_RE)).toBeNull();
  });
});

describe('하이라이트 명시 가중치 범위', () => {
  it('.6::text:: 는 0.6 으로(예전엔 6 으로 읽어 강조 색)', () => {
    expect(explicitWeights('.6::text::')).toEqual([{ start: 0, weight: 0.6 }]);
    expect(explicitWeights('0.6::text::')).toEqual([{ start: 0, weight: 0.6 }]);
  });
  it('음수·끝 점·정수와 묶음', () => {
    expect(explicitWeights('a, -.5::bad::')).toEqual([{ start: 3, weight: -0.5 }]);
    expect(explicitWeights('1.::x::, 2::y, z::').map((w) => w.weight)).toEqual([1, 2]);
  });
});

describe('칩·단축키 가중치 조절', () => {
  it('.6:: 를 0.6 으로 읽고 조절한다(래퍼 중복 없음)', () => {
    const text = '1girl, .6::text::';
    const at = text.indexOf('text');
    expect(getPromptWeightAtSelection(text, at)).toEqual({ core: '.6::text::', inner: 'text', weight: 0.6 });
    const r = adjustPromptWeightAtSelection(text, at, at, 0.05)!;
    expect(r.text).toBe('1girl, 0.65::text::');
    expect(r.text.slice(r.selectionStart, r.selectionStart + 4)).toBe('text');
  });
  it('-.5:: 와 1.:: 도 같은 규칙', () => {
    expect(getPromptWeightAtSelection('-.5::bad::', 6)!.weight).toBe(-0.5);
    const r = adjustPromptWeightAtSelection('1.::x::', 4, 4, 0.05)!;
    expect(r.text).toBe('1.05::x::');
  });
});

describe('자동완성 검색어 정리', () => {
  it('.6:: 접두도 벗긴다', () => {
    expect(trimAutocompleteWord('.6::{artist:ab')).toBe('ab');
    expect(autocompleteTagCategory('-.5::artist:ab')).toBe(1);
  });
});
