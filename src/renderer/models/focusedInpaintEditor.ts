/**
 * Focused inpainting 편집기(2026-10-04 S2) — 영역 도구의 순수 판정·좌표 계산.
 *
 * 인페인트 편집기(InPaintEditor·FocusAreaOverlay)가 쓰는 드래그(새 사각형·이동)·이미지 크기 변경 시
 * 클램프·오버레이 기하·포인터 대상 판정을 모은다. 사각형 규칙(8px 격자·768² 상한·하한 32)과 안쪽
 * 사각형은 `focusedInpaint.ts` 의 `clampFocusRect`·`innerContextRect` 를 그대로 쓴다(재구현 금지).
 * 서비스·DOM import 없음(jest 대상). 계약: SPEC_GUIDE §7-2 「편집기」.
 */
import {
  FOCUS_MIN_SIDE,
  FocusRect,
  clampFocusRect,
  focusedRequestSize,
  innerContextRect,
  isFocusRectInput,
} from './focusedInpaint';

export interface FocusPoint {
  x: number;
  y: number;
}

/** 프리셋의 focusX/Y/W/H 를 사각형으로(없거나 무효면 null). 켜짐 여부와 무관. */
export function presetFocusRect(preset: any): FocusRect | null {
  if (!preset) return null;
  const rect = { x: preset.focusX, y: preset.focusY, w: preset.focusW, h: preset.focusH };
  return isFocusRectInput(rect) ? rect : null;
}

/** 이 프리셋이 Focused 키를 가지고 있는가(SDInpaint 전용 — 미러·I2I 는 없음). */
export function presetSupportsFocus(preset: any): boolean {
  return !!preset && typeof preset === 'object' && 'focusEnabled' in preset;
}

/**
 * 캔버스 위 포인터를 누를 때 어느 동작이 받는가.
 * - `pan`: 이동 모드(TransformWrapper 가 확대·이동) — 마스크가 없는 워크플로우도 여기.
 * - `brush`: 브러시·지우개가 마스크 캔버스에 칠한다.
 * - `focus`: 영역 도구 — 오버레이가 받아 사각형을 그리거나 옮기고, 브러시 칠하기는 막는다.
 * 영역 도구는 브러시 모드의 하위 도구다(지우개와 같음): 이동 모드로 바꾸면 `pan`.
 */
export type InpaintPointerTarget = 'pan' | 'brush' | 'focus';
export function inpaintPointerTarget(opts: {
  hasMask: boolean;
  brushing: boolean;
  focusTool: boolean;
}): InpaintPointerTarget {
  if (!opts.hasMask || !opts.brushing) return 'pan';
  return opts.focusTool ? 'focus' : 'brush';
}

/** 화면 좌표 → 이미지 픽셀 좌표(이미지 밖은 가장자리로 자름). box 는 변환이 적용된 화면상 상자. */
export function clientToImagePoint(
  clientX: number,
  clientY: number,
  box: { left: number; top: number; width: number; height: number },
  imageW: number,
  imageH: number,
): FocusPoint {
  const sx = box.width > 0 ? imageW / box.width : 0;
  const sy = box.height > 0 ? imageH / box.height : 0;
  const x = (clientX - box.left) * sx;
  const y = (clientY - box.top) * sy;
  return {
    x: Math.min(imageW, Math.max(0, x)),
    y: Math.min(imageH, Math.max(0, y)),
  };
}

export function pointInRect(p: FocusPoint, r: FocusRect | null): boolean {
  return !!r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

/** 진행 중인 드래그 — 빈 곳에서 시작하면 새 사각형, 사각형 안에서 시작하면 이동. */
export type FocusDrag =
  | { mode: 'draw'; start: FocusPoint }
  | { mode: 'move'; start: FocusPoint; origin: FocusRect };

export function beginFocusDrag(p: FocusPoint, current: FocusRect | null): FocusDrag {
  if (current && pointInRect(p, current)) return { mode: 'move', start: p, origin: current };
  return { mode: 'draw', start: p };
}

/** 두 점이 이루는 사각형(이미지 안으로 자름, 격자 맞춤 전). */
function rawDrawRect(a: FocusPoint, b: FocusPoint, imageW: number, imageH: number): FocusRect {
  const cx = (v: number) => Math.min(imageW, Math.max(0, v));
  const cy = (v: number) => Math.min(imageH, Math.max(0, v));
  const x0 = cx(Math.min(a.x, b.x));
  const x1 = cx(Math.max(a.x, b.x));
  const y0 = cy(Math.min(a.y, b.y));
  const y1 = cy(Math.max(a.y, b.y));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * 드래그 중 미리보기 사각형.
 * - 그리기: 두 변이 모두 하한(32) 이상이면 저장될 모습(`clampFocusRect` — 격자·768² 상한) 그대로,
 *   아직 작으면 손가락이 그린 그대로(`tooSmall` — 놓으면 해제된다).
 * - 이동: 원래 크기를 유지한 채 격자에 맞춰 이미지 안으로 클램프.
 */
export function previewFocusDrag(
  drag: FocusDrag,
  p: FocusPoint,
  imageW: number,
  imageH: number,
): { rect: FocusRect | null; tooSmall: boolean } {
  if (drag.mode === 'move') {
    const o = drag.origin;
    const moved = { x: o.x + (p.x - drag.start.x), y: o.y + (p.y - drag.start.y), w: o.w, h: o.h };
    return { rect: clampFocusRect(moved, imageW, imageH), tooSmall: false };
  }
  const raw = rawDrawRect(drag.start, p, imageW, imageH);
  if (raw.w < FOCUS_MIN_SIDE || raw.h < FOCUS_MIN_SIDE) return { rect: raw, tooSmall: true };
  return { rect: clampFocusRect(raw, imageW, imageH), tooSmall: false };
}

/** 드래그를 놓았을 때 프리셋에 반영할 결과. */
export type FocusDragResult =
  | { kind: 'set'; rect: FocusRect }
  | { kind: 'clear' }
  | { kind: 'keep' };

export function finishFocusDrag(
  drag: FocusDrag,
  p: FocusPoint,
  imageW: number,
  imageH: number,
): FocusDragResult {
  const { rect, tooSmall } = previewFocusDrag(drag, p, imageW, imageH);
  if (drag.mode === 'move') {
    if (!rect || sameRect(rect, drag.origin)) return { kind: 'keep' };
    return { kind: 'set', rect };
  }
  // 빈 곳을 짧게 누르거나 하한(32) 미만으로 그리면 사각형 해제(Focused 는 꺼지지 않음 — 사각형이 없으면 일반 인페인트).
  if (tooSmall || !rect) return { kind: 'clear' };
  return { kind: 'set', rect };
}

export function sameRect(a: FocusRect | null, b: FocusRect | null): boolean {
  if (!a || !b) return a === b;
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/**
 * 표시 이미지 크기가 정해졌을 때(다른 이미지 선택·생성 결과 표시) 저장된 사각형을 맞춘다.
 * 그대로면 keep, 이미지 밖·격자 어긋남이면 set(클램프 결과), 이미지가 하한보다 작아 무효면 clear.
 */
export function reconcileFocusRect(
  rect: FocusRect | null,
  imageW: number,
  imageH: number,
): FocusDragResult {
  if (!rect || !(imageW > 0) || !(imageH > 0)) return { kind: 'keep' };
  const c = clampFocusRect(rect, imageW, imageH);
  if (!c) return { kind: 'clear' };
  return sameRect(c, rect) ? { kind: 'keep' } : { kind: 'set', rect: c };
}

/** 프리셋에 쓸 값(focusX/Y/W/H). clear 면 모두 null. */
export function focusRectPresetPatch(rect: FocusRect | null): {
  focusX: number | null;
  focusY: number | null;
  focusW: number | null;
  focusH: number | null;
} {
  return rect
    ? { focusX: rect.x, focusY: rect.y, focusW: rect.w, focusH: rect.h }
    : { focusX: null, focusY: null, focusW: null, focusH: null };
}

/**
 * 오버레이 기하(이미지 픽셀 → 0~100%): 사각형·안쪽 사각형(마스크가 유효한 곳)·
 * 둘 사이 맥락 띠 4조각(위·아래·왼·오)·사각형 밖 어둡게 4조각(위·아래·왼·오).
 */
export interface PctRect {
  left: number;
  top: number;
  width: number;
  height: number;
}
export function focusOverlayGeometry(
  rect: FocusRect,
  context: number,
  imageW: number,
  imageH: number,
): { outer: PctRect; inner: PctRect; band: PctRect[]; dim: PctRect[] } {
  const inner0 = innerContextRect(rect, context);
  const inner = { x: rect.x + inner0.x, y: rect.y + inner0.y, w: inner0.w, h: inner0.h };
  const px = (x: number) => (x / imageW) * 100;
  const py = (y: number) => (y / imageH) * 100;
  const pct = (x: number, y: number, w: number, h: number): PctRect => ({
    left: px(x),
    top: py(y),
    width: px(w),
    height: py(h),
  });
  const r = rect;
  const band = [
    pct(r.x, r.y, r.w, inner.y - r.y),
    pct(r.x, inner.y + inner.h, r.w, r.y + r.h - (inner.y + inner.h)),
    pct(r.x, inner.y, inner.x - r.x, inner.h),
    pct(inner.x + inner.w, inner.y, r.x + r.w - (inner.x + inner.w), inner.h),
  ].filter((b) => b.width > 0 && b.height > 0);
  const dim = [
    pct(0, 0, imageW, r.y),
    pct(0, r.y + r.h, imageW, imageH - (r.y + r.h)),
    pct(0, r.y, r.x, r.h),
    pct(r.x + r.w, r.y, imageW - (r.x + r.w), r.h),
  ].filter((b) => b.width > 0 && b.height > 0);
  return {
    outer: pct(r.x, r.y, r.w, r.h),
    inner: pct(inner.x, inner.y, inner.w, inner.h),
    band,
    dim,
  };
}

/** 안내 한 줄에 쓸 요청 해상도 문구(예: 「요청 1024×1024 (Focused)」). 계산 불가면 ''. */
export function focusRequestLabel(rect: FocusRect | null, imageW: number, imageH: number): string {
  if (!rect || !(imageW > 0) || !(imageH > 0)) return '';
  const size = focusedRequestSize(rect, imageW, imageH);
  return size ? `요청 ${size.width}×${size.height} (Focused)` : '';
}

/** 편집기 안내 문구(U4 — 마스크 규칙 미리보기). */
export const FOCUS_EDITOR_TEXT = {
  toolLabel: 'Focused 영역',
  toolTooltip: 'Focused 영역 — 사각형 안만 확대해 다시 그립니다(드래그 = 새 사각형, 사각형 안 드래그 = 이동)',
  contextLabel: '맥락 여백:',
  contextTooltip: '맥락 여백(Minimum Context Area) — 사각형 가장자리에서 이만큼은 다시 그리지 않고 맥락으로만 씁니다',
  maskRule: '빨간 띠(맥락 여백)에 칠한 마스크는 요청 때 지워집니다. 상자 안을 비우면 상자 전체(안쪽)를 인페인트합니다.',
  noRect: '이미지 위를 드래그해 Focused 영역을 지정하세요.',
  off: '끄기',
} as const;
