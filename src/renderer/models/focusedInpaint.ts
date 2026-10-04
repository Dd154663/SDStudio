/**
 * Focused inpainting(2026-10-04 S1) — 순수 계산 단일 출처.
 *
 * NovelAI 공식 웹의 Focused area 는 서버 API 전용 필드가 없는 클라이언트 crop-and-stitch 다.
 * 선택 사각형(8px 격자, 넓이 상한 768², 변 하한 32)을 원본·마스크에서 잘라 약 1MP 로 확대해
 * 일반 인페인트(`action: 'infill'`, `add_original_image=false`)로 1회 요청하고, 결과를 다시
 * 사각형 크기로 줄여 팽창·흐림 페더 마스크로 원본에 섞는다.
 *
 * 이 모듈은 좌표·크기·마스크 판정만 담당한다(서비스·캔버스 import 없음, jest 대상).
 * 캔버스 조작은 `focusedInpaintCanvas.ts`, PNG 텍스트 메타 이관은 `pngTextChunks.ts`.
 * 계약: SPEC_GUIDE §7 「Focused inpainting」.
 */

/** 이미지 픽셀 좌표의 사각형. */
export interface FocusRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 잡에 실리는 Focused 요청 사양(프리셋 focusX/Y/W/H·focusContext 를 옮긴 것). */
export interface FocusedInpaintSpec extends FocusRect {
  context: number;
}

/** 마스크 격자(공식 웹과 같은 8px). */
export const FOCUS_GRID = 8;
/** 선택 사각형 넓이 상한(공식 웹 768²). */
export const FOCUS_MAX_AREA = 768 * 768;
/** 선택 사각형 변 하한. */
export const FOCUS_MIN_SIDE = 32;
/** 요청 해상도 격자(NAI 요청 width/height 는 64 배수). */
export const FOCUS_TARGET_GRID = 64;
/** 요청 해상도 상한 ≈1MP — V5 Opus 무료 판정(`isOpusFreeEligible`)과 같은 기준. */
export const FOCUS_TARGET_PIXEL_LIMIT = 1024 * 1024;
/** 「Minimum Context Area」 범위·기본값(공식 웹 슬라이더 32~96 step 8). */
export const FOCUS_CONTEXT_MIN = 32;
export const FOCUS_CONTEXT_MAX = 96;
export const FOCUS_CONTEXT_DEFAULT = 48;
/** 합성 페더: 마스크 팽창(정사각 커널 반경)·가우시안 흐림 표준편차(2026-10-04 실험 3 검증값). */
export const FEATHER_DILATE_PX = 32;
export const FEATHER_BLUR_PX = 20;

const floorTo = (v: number, grid: number) => Math.floor(v / grid) * grid;
const roundTo = (v: number, grid: number) => Math.round(v / grid) * grid;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 프리셋 값이 Focused 요청에 쓸 수 있는 사각형인지(숫자·양수 크기). */
export function isFocusRectInput(rect: Partial<FocusRect> | null | undefined): rect is FocusRect {
  if (!rect) return false;
  const { x, y, w, h } = rect;
  return (
    [x, y, w, h].every((v) => typeof v === 'number' && Number.isFinite(v)) &&
    (w as number) > 0 &&
    (h as number) > 0
  );
}

/**
 * 프리셋에서 Focused 사양을 만든다. 꺼져 있거나 사각형이 비어 있으면 undefined.
 * (SDMirror 프리셋에는 focus 키가 없어 항상 undefined.)
 */
export function focusSpecFromPreset(preset: any): FocusedInpaintSpec | undefined {
  if (!preset || preset.focusEnabled !== true) return undefined;
  const rect = { x: preset.focusX, y: preset.focusY, w: preset.focusW, h: preset.focusH };
  if (!isFocusRectInput(rect)) return undefined;
  return { ...rect, context: normalizeFocusContext(preset.focusContext) };
}

/** context 를 32~96·8 배수로 정규화(없음·NaN = 기본 48). */
export function normalizeFocusContext(context: unknown): number {
  if (typeof context !== 'number' || !Number.isFinite(context)) return FOCUS_CONTEXT_DEFAULT;
  return clamp(roundTo(context, FOCUS_GRID), FOCUS_CONTEXT_MIN, FOCUS_CONTEXT_MAX);
}

/**
 * 선택 사각형을 8px 격자에 맞추고 넓이 상한(768²)·변 하한(32)을 적용한 뒤 이미지 안으로 넣는다.
 * 상한·이미지 크기 초과는 중심·비율을 유지해 줄이고, 아니면 모서리를 격자에 맞춘다. 이미지가 32px 보다 작으면 null.
 */
export function clampFocusRect(rect: FocusRect, imageW: number, imageH: number): FocusRect | null {
  if (!isFocusRectInput(rect)) return null;
  const maxW = floorTo(imageW, FOCUS_GRID);
  const maxH = floorTo(imageH, FOCUS_GRID);
  if (maxW < FOCUS_MIN_SIDE || maxH < FOCUS_MIN_SIDE) return null;

  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  let w = Math.max(FOCUS_MIN_SIDE, roundTo(rect.w, FOCUS_GRID));
  let h = Math.max(FOCUS_MIN_SIDE, roundTo(rect.h, FOCUS_GRID));
  let shrunk = false;
  if (w * h > FOCUS_MAX_AREA) {
    shrunk = true;
    const s = Math.sqrt(FOCUS_MAX_AREA / (w * h));
    w = Math.max(FOCUS_MIN_SIDE, floorTo(w * s, FOCUS_GRID));
    h = Math.max(FOCUS_MIN_SIDE, floorTo(h * s, FOCUS_GRID));
    // 한 변이 하한에 걸려 넓이가 다시 넘으면 다른 변을 줄인다.
    if (w * h > FOCUS_MAX_AREA) {
      if (w >= h) w = Math.max(FOCUS_MIN_SIDE, floorTo(FOCUS_MAX_AREA / h, FOCUS_GRID));
      else h = Math.max(FOCUS_MIN_SIDE, floorTo(FOCUS_MAX_AREA / w, FOCUS_GRID));
    }
  }
  if (w > maxW || h > maxH) shrunk = true;
  w = Math.min(w, maxW);
  h = Math.min(h, maxH);
  // 줄였으면 중심 유지, 아니면 왼쪽 위 모서리를 격자에 맞춘다.
  const x0 = shrunk ? cx - w / 2 : roundTo(rect.x, FOCUS_GRID);
  const y0 = shrunk ? cy - h / 2 : roundTo(rect.y, FOCUS_GRID);
  const x = clamp(floorTo(x0, FOCUS_GRID), 0, floorTo(imageW - w, FOCUS_GRID));
  const y = clamp(floorTo(y0, FOCUS_GRID), 0, floorTo(imageH - h, FOCUS_GRID));
  return { x, y, w, h };
}

/**
 * 크롭을 ≈1MP 이하에서 가장 크게 확대한 요청 해상도(비율 유지, 폭·높이 각각 64 배수 내림).
 * 원본 크롭보다 작아지지 않게 하고(64 배수로 올림), 그래도 1MP 를 넘지 않게 다른 변을 줄인다.
 */
export function focusTargetSize(w: number, h: number): { width: number; height: number } {
  const G = FOCUS_TARGET_GRID;
  const s = Math.max(1, Math.sqrt(FOCUS_TARGET_PIXEL_LIMIT / (w * h)));
  let width = Math.max(G, floorTo(w * s, G));
  let height = Math.max(G, floorTo(h * s, G));
  if (width < w) width = Math.ceil(w / G) * G;
  if (height < h) height = Math.ceil(h / G) * G;
  while (width * height > FOCUS_TARGET_PIXEL_LIMIT && (width > G || height > G)) {
    if (width / w >= height / h && width > G) width -= G;
    else if (height > G) height -= G;
    else width -= G;
  }
  return { width, height };
}

/** 이미지 크기를 알 때 Focused 요청 해상도(비용·무료 판정용). 사각형이 무효면 null. */
export function focusedRequestSize(
  spec: FocusRect,
  imageW: number,
  imageH: number,
): { width: number; height: number } | null {
  const rect = clampFocusRect(spec, imageW, imageH);
  return rect ? focusTargetSize(rect.w, rect.h) : null;
}

/**
 * 크롭 좌표계(0,0 = 사각형 왼쪽 위)의 안쪽 사각형 — 사방에서 context 만큼 들어온 영역.
 * 마스크는 이 안쪽만 유효하다. 작은 사각형은 안쪽이 최소 8px 남도록 축별로 context 를 줄인다.
 */
export function innerContextRect(rect: FocusRect, context: number): FocusRect {
  const c = normalizeFocusContext(context);
  const cx = Math.max(0, Math.min(c, floorTo((rect.w - FOCUS_GRID) / 2, FOCUS_GRID)));
  const cy = Math.max(0, Math.min(c, floorTo((rect.h - FOCUS_GRID) / 2, FOCUS_GRID)));
  return { x: cx, y: cy, w: rect.w - cx * 2, h: rect.h - cy * 2 };
}

/** 캐릭터 center(0~1, 원본 기준)를 크롭 좌표계로 재매핑하고 0~1 로 자른다(공식 웹과 같음). */
export function remapCharacterCenter(
  center: { x: number; y: number },
  rect: FocusRect,
  imageW: number,
  imageH: number,
): { x: number; y: number } {
  const x = (center.x * imageW - rect.x) / rect.w;
  const y = (center.y * imageH - rect.y) / rect.h;
  return { x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
}

/**
 * Focused 마스크 규칙(크롭 크기 이진 마스크, 1 = 다시 그림):
 * 안쪽 사각형 밖은 지우고, 안쪽에 칠한 곳이 하나도 없으면 안쪽 전체를 마스크로 한다.
 * 반환값은 새 배열이며 `fullSizeMask` 는 안쪽 전체로 채웠는지 여부.
 */
export function focusedMaskRule(
  mask: Uint8Array,
  w: number,
  h: number,
  inner: FocusRect,
): { mask: Uint8Array; fullSizeMask: boolean } {
  const out = new Uint8Array(w * h);
  let any = false;
  const x1 = inner.x + inner.w;
  const y1 = inner.y + inner.h;
  for (let y = inner.y; y < y1; y++) {
    for (let x = inner.x; x < x1; x++) {
      const i = y * w + x;
      if (mask[i]) {
        out[i] = 1;
        any = true;
      }
    }
  }
  if (!any) {
    for (let y = inner.y; y < y1; y++) out.fill(1, y * w + inner.x, y * w + x1);
  }
  return { mask: out, fullSizeMask: !any };
}

/**
 * 이진 마스크를 grid 격자 칸 단위로 맞춘다 — 칸 안에 1 이 하나라도 있으면 칸 전체를 1 로 채운다.
 * NAI 는 마스크를 잠재 공간(1/8) 칸 단위로 다루므로 요청 마스크 경계가 8 배수가 아니면 칸 일부만 덮인
 * 경계를 따라 올리브색 윤곽선 같은 잡음이 생긴다(2026-10-04 실기 결함, 공식 웹도 1/8 칸으로 양자화).
 * 요청 해상도는 64 배수라 칸이 딱 나뉘지만, 가장자리 칸이 잘려도 안전하게 처리한다.
 */
export function snapMaskToGrid(mask: Uint8Array, w: number, h: number, grid = FOCUS_GRID): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let by = 0; by < h; by += grid) {
    const y1 = Math.min(h, by + grid);
    for (let bx = 0; bx < w; bx += grid) {
      const x1 = Math.min(w, bx + grid);
      let any = false;
      for (let y = by; y < y1 && !any; y++) {
        for (let x = bx; x < x1; x++) {
          if (mask[y * w + x]) {
            any = true;
            break;
          }
        }
      }
      if (any) for (let y = by; y < y1; y++) out.fill(1, y * w + bx, y * w + x1);
    }
  }
  return out;
}

/**
 * 사각형 크기 이진 마스크 → 요청 해상도 마스크: 최근접 확대(픽셀 중심 표본) 뒤 8px 격자 스냅.
 * 캔버스를 쓰지 않는 순수 계산(jest 대상) — 결과에 일부만 칠해진 8×8 칸이 없다.
 */
export function requestMaskFromRectMask(
  rectMask: Uint8Array,
  rw: number,
  rh: number,
  width: number,
  height: number,
): Uint8Array {
  return snapMaskToGrid(scaleMaskNearest(rectMask, rw, rh, width, height), width, height, FOCUS_GRID);
}

/**
 * 이진 마스크 최근접 크기 변경(픽셀 중심 표본, 결과도 0/1 — 회색 없음). 순수 계산.
 * Focused 요청 마스크와 대량 작업 「인페인트 마스크 일괄 적용」(크기가 다른 대상, SPEC §7-2)이 같이 쓴다.
 */
export function scaleMaskNearest(
  mask: Uint8Array,
  sw: number,
  sh: number,
  width: number,
  height: number,
): Uint8Array {
  const scaled = new Uint8Array(width * height);
  const sxOf = new Int32Array(width);
  for (let x = 0; x < width; x++) sxOf[x] = Math.min(sw - 1, Math.floor(((x + 0.5) * sw) / width));
  for (let y = 0; y < height; y++) {
    const sy = Math.min(sh - 1, Math.floor(((y + 0.5) * sh) / height));
    const src = sy * sw;
    const dst = y * width;
    for (let x = 0; x < width; x++) scaled[dst + x] = mask[src + sxOf[x]] ? 1 : 0;
  }
  return scaled;
}

/** 이진 마스크 정사각 팽창(반경 r, 분리형 누적합 — O(w·h)). */
export function dilateMask(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return mask.slice();
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  const row = new Int32Array(w + 1);
  for (let y = 0; y < h; y++) {
    const base = y * w;
    for (let x = 0; x < w; x++) row[x + 1] = row[x] + (mask[base + x] ? 1 : 0);
    for (let x = 0; x < w; x++) {
      const a = Math.max(0, x - r);
      const b = Math.min(w, x + r + 1);
      tmp[base + x] = row[b] - row[a] > 0 ? 1 : 0;
    }
  }
  const col = new Int32Array(h + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) col[y + 1] = col[y] + tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      const a = Math.max(0, y - r);
      const b = Math.min(h, y + r + 1);
      out[y * w + x] = col[b] - col[a] > 0 ? 1 : 0;
    }
  }
  return out;
}

/** 가우시안(표준편차 sigma)을 상자 흐림 n 회로 근사할 상자 반경들. */
export function boxRadiiForGauss(sigma: number, n = 3): number[] {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  const radii: number[] = [];
  for (let i = 0; i < n; i++) radii.push(((i < m ? wl : wu) - 1) / 2);
  return radii;
}

function boxBlurPass(src: Float32Array, dst: Float32Array, w: number, h: number, r: number, horizontal: boolean) {
  const len = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const step = horizontal ? 1 : w;
  const prefix = new Float64Array(len + 1);
  const size = r * 2 + 1;
  for (let l = 0; l < lines; l++) {
    const base = horizontal ? l * w : l;
    for (let i = 0; i < len; i++) prefix[i + 1] = prefix[i] + src[base + i * step];
    for (let i = 0; i < len; i++) {
      const a = Math.max(0, i - r);
      const b = Math.min(len, i + r + 1);
      // 가장자리 밖은 0 으로 취급(분모 고정) — 크롭 경계 밖으로 새지 않는다.
      dst[base + i * step] = (prefix[b] - prefix[a]) / size;
    }
  }
}

/**
 * 페더 알파(0~1): 마스크를 팽창한 뒤 가우시안 근사(상자 흐림 3회, 가로·세로 분리) — `ctx.filter`
 * 미지원 WebView 에서도 같은 결과가 나오도록 수동 구현. 지원 범위 밖 값은 정확히 0 이라 원본이 그대로 남는다.
 */
export function featherAlpha(
  mask: Uint8Array,
  w: number,
  h: number,
  dilatePx = FEATHER_DILATE_PX,
  blurSigma = FEATHER_BLUR_PX,
): Float32Array {
  const dil = dilateMask(mask, w, h, dilatePx);
  const a = new Float32Array(w * h);
  for (let i = 0; i < a.length; i++) a[i] = dil[i];
  if (blurSigma <= 0) return a;
  const b = new Float32Array(w * h);
  for (const r of boxRadiiForGauss(blurSigma, 3)) {
    boxBlurPass(a, b, w, h, r, true);
    boxBlurPass(b, a, w, h, r, false);
  }
  // 부동소수 누적 오차로 생기는 미세값을 0/1 로 정리한다.
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    a[i] = v < 1e-6 ? 0 : v > 1 - 1e-6 ? 1 : v;
  }
  return a;
}

/**
 * RGBA 바이트를 알파로 섞는다: RGB = orig·(1−a) + res·a, **출력 알파 = 원본 알파**.
 * 서버 결과의 알파 채널은 무시한다(결과 픽셀은 불투명으로 간주) — NAI stealth 알파 패턴·서버 알파 변동이
 * 합성에 섞여 윤곽선으로 보이지 않게 한다(2026-10-04 실기 결함).
 */
export function blendRgba(
  original: Uint8ClampedArray,
  result: Uint8ClampedArray,
  alpha: Float32Array,
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(original.length);
  for (let i = 0, p = 0; p < alpha.length; p++, i += 4) {
    const a = alpha[p];
    if (a <= 0) {
      out[i] = original[i];
      out[i + 1] = original[i + 1];
      out[i + 2] = original[i + 2];
    } else if (a >= 1) {
      out[i] = result[i];
      out[i + 1] = result[i + 1];
      out[i + 2] = result[i + 2];
    } else {
      for (let c = 0; c < 3; c++) {
        out[i + c] = Math.round(original[i + c] * (1 - a) + result[i + c] * a);
      }
    }
    out[i + 3] = original[i + 3];
  }
  return out;
}
