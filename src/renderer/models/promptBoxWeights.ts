// PC 메인 화면 프리셋 패널 — 프롬프트 칸 사이 손잡이로 나누는 높이 비율(2026-11-23 사용자 결정).
// 칸 본문은 종전처럼 flex-basis 0 으로 남는 높이를 나눠 갖고, 칸마다 flex-grow 값(가중치)만 다르게 준다.
// 고정 픽셀이 아니라 비율이라 칸들의 합은 늘 패널 안에 들어가고(패널은 스크롤하지 않음), 창 높이가 바뀌면 비율대로 다시 나뉜다.
// 기억 = localStorage(필드명 키 → 가중치). 접힘 `sdstudio-prompt-fold` 와 같은 방식 — 기기별 화면 보기 설정이라
// config 필드·저장 파일·환경설정 내보내기·동기화 대상이 아니다. 값이 없거나 깨졌으면 그 칸은 균등(1).

export const PROMPT_BOX_WEIGHTS_LS_KEY = 'sdstudio-prompt-box-weights';

/** 가중치 기본값(균등). 끌기는 두 칸의 합을 보존하므로 평균이 1 근처에 머물러, 가중치 없는 다른 flex-1 요소와도 섞여 쓸 수 있다. */
export const PROMPT_BOX_WEIGHT_DEFAULT = 1;
/** 저장값 정리 범위 — 밖이면 깨진 값으로 보고 버린다(균등). */
export const PROMPT_BOX_WEIGHT_MIN = 0.05;
export const PROMPT_BOX_WEIGHT_MAX = 20;

/** 손잡이의 잡히는 높이(px) — 다음 칸 머리 줄 위 여백(PC 12px) 안에 겹쳐 놓는다(레이아웃 높이 0). */
export const PROMPT_BOX_HANDLE_HIT_PX = 8;

/** 칸 최소 높이 = 편집기 두 줄. 줄 높이를 못 읽으면 기본 글자 16px × 1.5 = 24px 기준(48px). */
export const PROMPT_BOX_MIN_LINES = 2;
export const PROMPT_BOX_FALLBACK_LINE_PX = 24;

export const PROMPT_BOX_HANDLE_TEXT = {
  label: '프롬프트 칸 높이 조절',
  tooltip: '끌어서 칸 높이 조절 (두 번 누르면 균등하게)',
} as const;

export type PromptBoxWeights = Record<string, number>;

function validWeight(v: unknown): v is number {
  return (
    typeof v === 'number' &&
    Number.isFinite(v) &&
    v >= PROMPT_BOX_WEIGHT_MIN &&
    v <= PROMPT_BOX_WEIGHT_MAX
  );
}

/** 저장값 정리 — 객체가 아니면 빈 값, 키마다 범위 밖·숫자 아님은 버린다. */
export function sanitizePromptBoxWeights(raw: unknown): PromptBoxWeights {
  const out: PromptBoxWeights = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (k && validWeight(v)) out[k] = v;
  }
  return out;
}

export function parsePromptBoxWeights(text: string | null | undefined): PromptBoxWeights {
  if (!text) return {};
  try {
    return sanitizePromptBoxWeights(JSON.parse(text));
  } catch {
    return {};
  }
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): StorageLike | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function loadPromptBoxWeights(storage: StorageLike | undefined = defaultStorage()): PromptBoxWeights {
  if (!storage) return {};
  try {
    return parsePromptBoxWeights(storage.getItem(PROMPT_BOX_WEIGHTS_LS_KEY));
  } catch {
    return {};
  }
}

/** 저장 — 균등(1)인 키는 적지 않고, 남는 것이 없으면 키째 지운다. 실패는 조용히 무시(보기 설정). */
export function savePromptBoxWeights(
  weights: PromptBoxWeights,
  storage: StorageLike | undefined = defaultStorage(),
): void {
  if (!storage) return;
  const clean = sanitizePromptBoxWeights(weights);
  for (const k of Object.keys(clean)) {
    if (clean[k] === PROMPT_BOX_WEIGHT_DEFAULT) delete clean[k];
  }
  try {
    if (Object.keys(clean).length === 0) storage.removeItem(PROMPT_BOX_WEIGHTS_LS_KEY);
    else storage.setItem(PROMPT_BOX_WEIGHTS_LS_KEY, JSON.stringify(clean));
  } catch {
    /* 저장 실패는 보기 설정이라 무시 */
  }
}

export function promptBoxWeightOf(weights: PromptBoxWeights, key: string): number {
  const v = weights[key];
  return validWeight(v) ? v : PROMPT_BOX_WEIGHT_DEFAULT;
}

/** 칸 최소 높이(px) — 편집기 줄 높이 × 두 줄. 줄 높이를 못 읽으면(NaN·0·'normal') 기본 24px. */
export function promptBoxMinHeight(lineHeightPx: number): number {
  const lh =
    Number.isFinite(lineHeightPx) && lineHeightPx > 0 ? lineHeightPx : PROMPT_BOX_FALLBACK_LINE_PX;
  return Math.round(lh * PROMPT_BOX_MIN_LINES);
}

export interface PromptBoxDragInput {
  /** 끌기 시작 때 위 칸·아래 칸 본문 높이(px) */
  upperHeight: number;
  lowerHeight: number;
  /** 끌기 시작 때 두 칸의 가중치 */
  upperWeight: number;
  lowerWeight: number;
  /** 시작점에서 끈 거리(px, 아래로 +) */
  delta: number;
  /** 칸 최소 높이(px) */
  minHeight: number;
}

/**
 * 끌기 계산 — 두 칸이 높이를 주고받는다(합 보존). 위 칸 새 높이를 [하한, 합−하한] 안으로 자르고
 * 가중치 합을 높이 비율대로 다시 나눈다. 두 칸 합이 하한 두 배보다 작거나 값을 못 읽으면 null(그대로 둠).
 */
export function dragPromptBoxWeights(input: PromptBoxDragInput): { upper: number; lower: number } | null {
  const { upperHeight, lowerHeight, upperWeight, lowerWeight, delta, minHeight } = input;
  const total = upperHeight + lowerHeight;
  const wSum = upperWeight + lowerWeight;
  if (!(total > 0) || !(wSum > 0) || !Number.isFinite(delta)) return null;
  const min = Math.max(0, minHeight);
  if (total < min * 2) return null;
  const nextUpper = Math.min(total - min, Math.max(min, upperHeight + delta));
  // 저장 정리 범위 안에 머물게(아주 높은 창에서 하한 칸의 비율이 범위 밖으로 나가 다시 켤 때 균등으로 풀리지 않게)
  const lo = PROMPT_BOX_WEIGHT_MIN;
  const hi = Math.min(PROMPT_BOX_WEIGHT_MAX, wSum - PROMPT_BOX_WEIGHT_MIN);
  if (hi < lo) return null;
  const upper = Math.min(hi, Math.max(lo, (wSum * nextUpper) / total));
  const lower = wSum - upper;
  if (lower > PROMPT_BOX_WEIGHT_MAX) return null;
  return { upper, lower };
}
