/**
 * PC 메인 패널 프롬프트 칸 높이 비율 — 순수 규칙(2026-11-23, models/promptBoxWeights.ts).
 * 합 보존·하한·깨진 값·균등·저장 형식.
 */
import {
  PROMPT_BOX_HANDLE_TEXT,
  PROMPT_BOX_WEIGHTS_LS_KEY,
  PROMPT_BOX_WEIGHT_MAX,
  PROMPT_BOX_WEIGHT_MIN,
  dragPromptBoxWeights,
  loadPromptBoxWeights,
  parsePromptBoxWeights,
  promptBoxMinHeight,
  promptBoxWeightOf,
  sanitizePromptBoxWeights,
  savePromptBoxWeights,
} from '../promptBoxWeights';

function memStorage(init?: Record<string, string>) {
  const m = new Map<string, string>(Object.entries(init ?? {}));
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    map: m,
  };
}

describe('끌기 계산', () => {
  const base = { upperHeight: 200, lowerHeight: 200, upperWeight: 1, lowerWeight: 1, minHeight: 48 };
  test('두 칸이 높이를 주고받고 가중치 합은 그대로', () => {
    const r = dragPromptBoxWeights({ ...base, delta: 50 })!;
    expect(r.upper).toBeCloseTo(1.25);
    expect(r.lower).toBeCloseTo(0.75);
    expect(r.upper + r.lower).toBeCloseTo(2);
  });
  test('다른 가중치에서 시작해도 합 보존·높이 비율대로', () => {
    const r = dragPromptBoxWeights({ upperHeight: 300, lowerHeight: 100, upperWeight: 1.5, lowerWeight: 0.5, delta: -100, minHeight: 48 })!;
    expect(r.upper + r.lower).toBeCloseTo(2);
    expect(r.upper / r.lower).toBeCloseTo(200 / 200);
  });
  test('하한에 닿으면 더 끌리지 않는다(아래·위 모두)', () => {
    const down = dragPromptBoxWeights({ ...base, delta: 10000 })!;
    expect(down.lower).toBeCloseTo((2 * 48) / 400);
    const down2 = dragPromptBoxWeights({ ...base, delta: 352 - 200 })!;
    expect(down2).toEqual(down);
    const up = dragPromptBoxWeights({ ...base, delta: -10000 })!;
    expect(up.upper).toBeCloseTo((2 * 48) / 400);
  });
  test('두 칸 합이 하한 두 배보다 작거나 값을 못 읽으면 그대로(null)', () => {
    expect(dragPromptBoxWeights({ ...base, upperHeight: 40, lowerHeight: 40, delta: 10 })).toBeNull();
    expect(dragPromptBoxWeights({ ...base, upperHeight: 0, lowerHeight: 0, delta: 10 })).toBeNull();
    expect(dragPromptBoxWeights({ ...base, delta: NaN })).toBeNull();
    expect(dragPromptBoxWeights({ ...base, upperWeight: 0, lowerWeight: 0, delta: 10 })).toBeNull();
  });
  test('결과 가중치는 저장 정리 범위 안', () => {
    const r = dragPromptBoxWeights({ upperHeight: 3000, lowerHeight: 3000, upperWeight: 1, lowerWeight: 1, delta: 10000, minHeight: 48 })!;
    expect(r.lower).toBeGreaterThanOrEqual(PROMPT_BOX_WEIGHT_MIN);
    expect(r.upper).toBeLessThanOrEqual(PROMPT_BOX_WEIGHT_MAX);
    expect(r.upper + r.lower).toBeCloseTo(2);
  });
});

describe('하한', () => {
  test('편집기 줄 높이 × 두 줄, 못 읽으면 24px 기준', () => {
    expect(promptBoxMinHeight(24)).toBe(48);
    expect(promptBoxMinHeight(21)).toBe(42);
    expect(promptBoxMinHeight(NaN)).toBe(48);
    expect(promptBoxMinHeight(0)).toBe(48);
  });
});

describe('저장값 정리·읽기·쓰기', () => {
  test('깨진 값은 버리고(균등), 정상 값만 남긴다', () => {
    expect(sanitizePromptBoxWeights(null)).toEqual({});
    expect(sanitizePromptBoxWeights([1, 2])).toEqual({});
    expect(sanitizePromptBoxWeights('x')).toEqual({});
    expect(
      sanitizePromptBoxWeights({ frontPrompt: 1.5, uc: 'a', backPrompt: -1, extraPrompt: Infinity, big: 999, tiny: 0.001, ok: 0.5 }),
    ).toEqual({ frontPrompt: 1.5, ok: 0.5 });
    expect(parsePromptBoxWeights('{not json')).toEqual({});
    expect(parsePromptBoxWeights(null)).toEqual({});
  });
  test('값이 없으면 균등 1', () => {
    expect(promptBoxWeightOf({}, 'frontPrompt')).toBe(1);
    expect(promptBoxWeightOf({ frontPrompt: 1.3 }, 'frontPrompt')).toBe(1.3);
    expect(promptBoxWeightOf({ frontPrompt: NaN } as any, 'frontPrompt')).toBe(1);
  });
  test('저장 — 균등(1) 키는 적지 않고, 다 균등이면 키째 지움', () => {
    const s = memStorage();
    savePromptBoxWeights({ frontPrompt: 1.25, backPrompt: 0.75, uc: 1 }, s);
    expect(JSON.parse(s.map.get(PROMPT_BOX_WEIGHTS_LS_KEY)!)).toEqual({ frontPrompt: 1.25, backPrompt: 0.75 });
    expect(loadPromptBoxWeights(s)).toEqual({ frontPrompt: 1.25, backPrompt: 0.75 });
    savePromptBoxWeights({ frontPrompt: 1, backPrompt: 1 }, s);
    expect(s.map.has(PROMPT_BOX_WEIGHTS_LS_KEY)).toBe(false);
    expect(loadPromptBoxWeights(s)).toEqual({});
  });
  test('저장소가 던져도 조용히(보기 설정)', () => {
    const bad = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => { throw new Error('x'); } };
    expect(loadPromptBoxWeights(bad)).toEqual({});
    expect(() => savePromptBoxWeights({ a: 2 }, bad)).not.toThrow();
  });
  test('키 이름은 접힘(sdstudio-prompt-fold)과 나란한 별도 키', () => {
    expect(PROMPT_BOX_WEIGHTS_LS_KEY).toBe('sdstudio-prompt-box-weights');
  });
});

test('문구', () => {
  expect(PROMPT_BOX_HANDLE_TEXT.tooltip).toBe('끌어서 칸 높이 조절 (두 번 누르면 균등하게)');
  expect(PROMPT_BOX_HANDLE_TEXT.label).toBe('프롬프트 칸 높이 조절');
});
