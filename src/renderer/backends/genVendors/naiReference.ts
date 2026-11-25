/**
 * NovelAI 캐릭터(정밀) 레퍼런스 순수 규칙(2026-11-25) — DOM·서비스 의존 없음.
 *
 * - 종류(저장값 referenceType + preferSameOutfit) ↔ 요청 base_caption 양방향 변환
 * - 모델이 받는 레퍼런스 고르기(referencesForModel — 예약 비용 판정·calculateCost·handleTask 공용)
 * - V5 레퍼런스 이미지 크기 표·잘라 맞춤 계산(공식 웹 클라이언트와 같은 표·식)
 * - 저장된 검정 여백(letterbox)의 내용 영역 계산·탐지
 */
import { ModelVersion } from '../imageGen';
import {
  NaiModelCapabilities,
  naiCapabilitiesOf,
} from './naiModelCapabilities';

export type ReferenceType = 'character' | 'style' | 'character&style' | 'costume';

const REFERENCE_TYPES: ReadonlySet<string> = new Set([
  'character',
  'style',
  'character&style',
  'costume',
]);

export function isReferenceType(value: unknown): value is ReferenceType {
  return typeof value === 'string' && REFERENCE_TYPES.has(value);
}

/**
 * 요청 base_caption 값 → 저장값. 「같은 의상 선호」 변형은 종류 + 명시 값으로, 평범한 값은 preferSameOutfit 없음.
 * 모르는 값은 character.
 */
export function parseNaiReferenceCaption(caption: unknown): {
  referenceType: ReferenceType;
  preferSameOutfit?: boolean;
} {
  switch (caption) {
    case 'character_mainoutfit':
      return { referenceType: 'character', preferSameOutfit: true };
    case 'character&style_anyoutfit':
      return { referenceType: 'character&style', preferSameOutfit: false };
    case 'character':
    case 'style':
    case 'character&style':
    case 'costume':
      return { referenceType: caption };
    default:
      return { referenceType: 'character' };
  }
}

/**
 * 저장값 → 요청 base_caption. null = 그 항목을 보내지 않는다(의상을 지원하지 않는 모델의 costume).
 * 의상을 지원하지 않는 모델에는 같은 의상 선호 변형을 평범한 값으로 보낸다.
 */
export function naiReferenceCaption(
  type: unknown,
  preferSameOutfit: boolean | undefined,
  caps: Pick<NaiModelCapabilities, 'supportsOutfitReference'>,
): string | null {
  let kind: ReferenceType;
  let prefer = preferSameOutfit;
  if (isReferenceType(type)) {
    kind = type;
  } else {
    // 옛 메타 적용으로 base_caption 원문이 저장됐을 수 있다 — 같은 규칙으로 읽고, 모르는 값은 character.
    const parsed = parseNaiReferenceCaption(type);
    kind = parsed.referenceType;
    if (prefer === undefined) prefer = parsed.preferSameOutfit;
  }
  if (!caps.supportsOutfitReference) {
    return kind === 'costume' ? null : kind;
  }
  if (kind === 'character') return prefer === true ? 'character_mainoutfit' : 'character';
  if (kind === 'character&style') {
    return prefer === false ? 'character&style_anyoutfit' : 'character&style';
  }
  return kind;
}

/** 화면 「같은 의상 선호」 토글의 실효값 — 캐릭터 기본 꺼짐, 캐릭터+스타일 기본 켜짐, 그 밖은 해당 없음. */
export function effectiveSameOutfit(
  type: unknown,
  preferSameOutfit: boolean | undefined,
): boolean | undefined {
  if (type === 'character') return preferSameOutfit ?? false;
  if (type === 'character&style') return preferSameOutfit ?? true;
  return undefined;
}

export interface ReferenceLike {
  enabled?: boolean;
  path?: string;
  referenceType?: string;
  preferSameOutfit?: boolean;
}

/**
 * 이 모델로 실제 보낼 레퍼런스 — 모델이 지원하지 않으면 [], 지원하면 켜져 있고 경로가 있으며 보낼 종류인 것만.
 * 예약 시점 비용 판정(boostFacts)·calculateCost·handleTask 가 모두 이 함수 하나를 쓴다.
 */
export function referencesForModel<T extends ReferenceLike>(
  refs: readonly T[] | undefined | null,
  version: ModelVersion | unknown,
): T[] {
  const caps = naiCapabilitiesOf(version);
  if (!caps.supportsCharacterReference || !refs?.length) return [];
  return refs.filter(
    (ref) =>
      !!ref &&
      ref.enabled !== false &&
      !!ref.path &&
      naiReferenceCaption(ref.referenceType, ref.preferSameOutfit, caps) !== null,
  );
}

/** 캐릭터 레퍼런스 1장이 생성 이미지 1장마다 쓰는 Anlas(NovelAI 공지 — V4.5·V5 같음). */
export const NAI_REFERENCE_ANLAS_PER_IMAGE = 5;

/** 이 모델로 생성 이미지 1장을 만들 때 레퍼런스가 쓰는 Anlas(실제로 보낼 레퍼런스 수 × 5). */
export function referenceAnlasPerImage(
  refs: readonly ReferenceLike[] | undefined | null,
  version: ModelVersion | unknown,
): number {
  return NAI_REFERENCE_ANLAS_PER_IMAGE * referencesForModel(refs, version).length;
}

export function clampReferenceStrength(
  strength: number,
  caps: Pick<NaiModelCapabilities, 'referenceStrengthMax'>,
): number {
  if (!Number.isFinite(strength)) return 0;
  return Math.min(Math.max(strength, 0), caps.referenceStrengthMax);
}

// ── V5 레퍼런스 크기 표(공식 웹 클라이언트와 같음) ─────────────────────────

export const NAI_V5_REFERENCE_BUCKETS: ReadonlyArray<readonly [number, number]> = [
  [256, 4096], [256, 4032], [256, 3968], [256, 3904], [256, 3840], [256, 3776], [256, 3712], [256, 3648],
  [256, 3584], [256, 3520], [256, 3456], [256, 3392], [256, 3328], [320, 3264], [320, 3200], [320, 3136],
  [320, 3072], [320, 3008], [320, 2944], [320, 2880], [320, 2816], [320, 2752], [384, 2688], [384, 2624],
  [384, 2560], [384, 2496], [384, 2432], [384, 2368], [448, 2304], [448, 2240], [448, 2176], [448, 2112],
  [512, 2048], [512, 1984], [512, 1920], [512, 1856], [576, 1792], [576, 1728], [576, 1664], [640, 1600],
  [640, 1536], [704, 1472], [704, 1408], [768, 1344], [768, 1280], [832, 1216], [896, 1152], [960, 1088],
  [1024, 1024], [1088, 960], [1152, 896], [1216, 832], [1280, 768], [1344, 768], [1408, 704], [1472, 704],
  [1536, 640], [1600, 640], [1664, 576], [1728, 576], [1792, 576], [1856, 512], [1920, 512], [1984, 512],
  [2048, 512], [2112, 448], [2176, 448], [2240, 448], [2304, 448], [2368, 384], [2432, 384], [2496, 384],
  [2560, 384], [2624, 384], [2688, 384], [2752, 320], [2816, 320], [2880, 320], [2944, 320], [3008, 320],
  [3072, 320], [3136, 320], [3200, 320], [3264, 320], [3328, 256], [3392, 256], [3456, 256], [3520, 256],
  [3584, 256], [3648, 256], [3712, 256], [3776, 256], [3840, 256], [3904, 256], [3968, 256], [4032, 256],
  [4096, 256],
].map((b) => Object.freeze(b as [number, number]));

export interface ReferenceBucketPlan {
  width: number;
  height: number;
  resizeWidth: number;
  resizeHeight: number;
  left: number;
  top: number;
}

/**
 * 원본(폭 e, 높이 t)을 로그 종횡비가 가장 가까운 칸에 덮도록 늘이거나 줄인 뒤 가운데를 잘라 내는 계획.
 * 원본을 resizeWidth×resizeHeight 로 그린 다음 (left, top) 에서 width×height 를 잘라 낸다.
 */
export function planReferenceBucket(e: number, t: number): ReferenceBucketPlan {
  const a = Math.log(Math.max(e, 1) / Math.max(t, 1));
  let best = NAI_V5_REFERENCE_BUCKETS[0];
  let bestDiff = Math.abs(a - Math.log(best[0] / best[1]));
  for (const b of NAI_V5_REFERENCE_BUCKETS) {
    const d = Math.abs(a - Math.log(b[0] / b[1]));
    if (d < bestDiff) {
      best = b;
      bestDiff = d;
    }
  }
  const [W, H] = best;
  const s = Math.max(W / e, H / t);
  const r = Math.max(Math.floor(e * s + 0.5), W);
  const l = Math.max(Math.floor(t * s + 0.5), H);
  return {
    width: W,
    height: H,
    resizeWidth: r,
    resizeHeight: l,
    left: Math.floor((r - W) / 2),
    top: Math.floor((l - H) / 2),
  };
}

// ── 저장된 검정 여백(letterbox) ───────────────────────────────────────────

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 저장 캔버스 규격(ImageService.chooseReferenceResolution 과 같은 세 가지). */
export const REFERENCE_CANVAS_SIZES: ReadonlyArray<readonly [number, number]> = [
  [1472, 1472],
  [1024, 1536],
  [1536, 1024],
];

export function isReferenceCanvasSize(width: number, height: number): boolean {
  return REFERENCE_CANVAS_SIZES.some(([w, h]) => w === width && h === height);
}

/** ImageService.normalizeReferenceImage 와 같은 계산(scale = min, floor)으로 저장 캔버스 안의 내용 영역. */
export function letterboxContentRect(
  canvasW: number,
  canvasH: number,
  srcW: number,
  srcH: number,
): Rect {
  const scale = Math.min(canvasW / srcW, canvasH / srcH);
  const w = Math.floor(scale * srcW);
  const h = Math.floor(scale * srcH);
  const x = Math.floor((canvasW - w) / 2);
  const y = Math.floor((canvasH - h) / 2);
  return { x, y, w, h };
}

/** 띠가 있는 축만 px 만큼 안쪽으로 들인다(경계의 JPEG 번짐 제거). 남는 영역이 너무 작으면 그대로. */
export function insetLetterboxRect(
  rect: Rect,
  canvasW: number,
  canvasH: number,
  px: number,
): Rect {
  let { x, y, w, h } = rect;
  if (w < canvasW && w - 2 * px >= MIN_CONTENT_SIDE) {
    x += px;
    w -= 2 * px;
  }
  if (h < canvasH && h - 2 * px >= MIN_CONTENT_SIDE) {
    y += px;
    h -= 2 * px;
  }
  return { x, y, w, h };
}

/** 이보다 작은 변이 남으면 자르지 않는다. */
const MIN_CONTENT_SIDE = 16;
/** 「거의 검정」 — JPEG 잡음을 감안한 채널 최댓값 상한. */
const BLACK_CHANNEL_MAX = 16;
/** 한 줄에서 거의 검정인 표본 비율이 이 값 이상이면 검정 줄. */
const BLACK_LINE_RATIO = 0.99;
/** 양쪽 띠 두께 차이 허용(대칭 판정). */
const BAND_SYMMETRY_TOLERANCE = 3;
/** 띠 경계에서 안쪽으로 들여 자르는 폭. */
const BAND_INSET = 2;
/** 한 줄에서 보는 표본 수(대략). */
const LINE_SAMPLES = 256;

/**
 * 원본 크기 기록이 없는 기존 레퍼런스용 — 검정 띠를 탐지해 내용 영역을 돌려준다(RGBA 픽셀 배열).
 * 띠는 한 축에만 양쪽 대칭으로 있다고 본다. 띠로 인정하지 못하면 전체 영역.
 */
export function detectLetterboxRect(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): Rect {
  const full: Rect = { x: 0, y: 0, w: width, h: height };
  if (width <= 0 || height <= 0 || pixels.length < width * height * 4) return full;

  const isBlack = (i: number) =>
    pixels[i] <= BLACK_CHANNEL_MAX &&
    pixels[i + 1] <= BLACK_CHANNEL_MAX &&
    pixels[i + 2] <= BLACK_CHANNEL_MAX;

  const rowBlack = (y: number) => {
    const step = Math.max(1, Math.floor(width / LINE_SAMPLES));
    let total = 0;
    let black = 0;
    for (let x = 0; x < width; x += step) {
      total++;
      if (isBlack((y * width + x) * 4)) black++;
    }
    return black >= total * BLACK_LINE_RATIO;
  };
  const colBlack = (x: number) => {
    const step = Math.max(1, Math.floor(height / LINE_SAMPLES));
    let total = 0;
    let black = 0;
    for (let y = 0; y < height; y += step) {
      total++;
      if (isBlack((y * width + x) * 4)) black++;
    }
    return black >= total * BLACK_LINE_RATIO;
  };

  let top = 0;
  while (top < height && rowBlack(top)) top++;
  if (top >= height) return full; // 전체가 검정
  let bottom = 0;
  while (bottom < height && rowBlack(height - 1 - bottom)) bottom++;
  let left = 0;
  while (left < width && colBlack(left)) left++;
  let right = 0;
  while (right < width && colBlack(width - 1 - right)) right++;

  const band = (a: number, b: number) =>
    a > 0 && b > 0 && Math.abs(a - b) <= BAND_SYMMETRY_TOLERANCE ? Math.min(a, b) : 0;
  const vBand = band(top, bottom);
  const hBand = band(left, right);
  if (!vBand && !hBand) return full;

  if (vBand >= hBand) {
    const cut = vBand + BAND_INSET;
    const h = height - 2 * cut;
    if (h < MIN_CONTENT_SIDE) return full;
    return { x: 0, y: cut, w: width, h };
  }
  const cut = hBand + BAND_INSET;
  const w = width - 2 * cut;
  if (w < MIN_CONTENT_SIDE) return full;
  return { x: cut, y: 0, w, h: height };
}
