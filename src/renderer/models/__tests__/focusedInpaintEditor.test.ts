// Focused inpainting 편집기(S2, SPEC_GUIDE §7-2 「편집기」) — 영역 도구의 순수 판정.
// 드래그 → 클램프 → 프리셋 값, 이미지 크기 변경 시 클램프, 영역 도구 활성 시 브러시 차단 판정, 오버레이 기하.
import { FOCUS_MAX_AREA, clampFocusRect } from '../focusedInpaint';
import {
  beginFocusDrag,
  clientToImagePoint,
  finishFocusDrag,
  focusOverlayGeometry,
  focusRectPresetPatch,
  focusRequestLabel,
  inpaintPointerTarget,
  presetFocusRect,
  presetSupportsFocus,
  previewFocusDrag,
  reconcileFocusRect,
} from '../focusedInpaintEditor';

const W = 832;
const H = 1216;

describe('포인터 대상 판정(브러시 차단)', () => {
  test('영역 도구가 활성이면 focus — 브러시 칠하기·이동(확대) 모두 아님', () => {
    expect(inpaintPointerTarget({ hasMask: true, brushing: true, focusTool: true })).toBe('focus');
  });
  test('브러시 모드 = brush, 이동 모드 = pan(영역 도구 선택이 남아 있어도)', () => {
    expect(inpaintPointerTarget({ hasMask: true, brushing: true, focusTool: false })).toBe('brush');
    expect(inpaintPointerTarget({ hasMask: true, brushing: false, focusTool: true })).toBe('pan');
    expect(inpaintPointerTarget({ hasMask: true, brushing: false, focusTool: false })).toBe('pan');
  });
  test('마스크 없는 워크플로우는 항상 pan', () => {
    expect(inpaintPointerTarget({ hasMask: false, brushing: true, focusTool: true })).toBe('pan');
  });
});

describe('화면 → 이미지 좌표', () => {
  test('확대된 상자에서도 이미지 픽셀로 환산하고 밖은 가장자리로 자른다', () => {
    const box = { left: 100, top: 50, width: 416, height: 608 }; // 0.5 배 표시
    expect(clientToImagePoint(100 + 208, 50 + 304, box, W, H)).toEqual({ x: 416, y: 608 });
    expect(clientToImagePoint(0, 0, box, W, H)).toEqual({ x: 0, y: 0 });
    expect(clientToImagePoint(9999, 9999, box, W, H)).toEqual({ x: W, y: H });
  });
});

describe('새 사각형 그리기', () => {
  test('빈 곳 드래그 → 8px 격자 사각형이 프리셋 값이 된다', () => {
    const drag = beginFocusDrag({ x: 101, y: 203 }, null);
    expect(drag.mode).toBe('draw');
    const res = finishFocusDrag(drag, { x: 403, y: 509 }, W, H);
    expect(res.kind).toBe('set');
    if (res.kind !== 'set') return;
    for (const v of Object.values(res.rect)) expect(v % 8).toBe(0);
    expect(res.rect).toEqual(clampFocusRect({ x: 101, y: 203, w: 302, h: 306 }, W, H));
    expect(focusRectPresetPatch(res.rect)).toEqual({
      focusX: res.rect.x,
      focusY: res.rect.y,
      focusW: res.rect.w,
      focusH: res.rect.h,
    });
  });
  test('거꾸로(오른쪽 아래 → 왼쪽 위) 끌어도 같은 사각형', () => {
    const a = finishFocusDrag(beginFocusDrag({ x: 403, y: 509 }, null), { x: 101, y: 203 }, W, H);
    const b = finishFocusDrag(beginFocusDrag({ x: 101, y: 203 }, null), { x: 403, y: 509 }, W, H);
    expect(a).toEqual(b);
  });
  test('넓이 상한(768²)을 넘으면 비율을 유지해 줄인다', () => {
    const res = finishFocusDrag(beginFocusDrag({ x: 0, y: 0 }, null), { x: W, y: H }, W, H);
    expect(res.kind).toBe('set');
    if (res.kind !== 'set') return;
    expect(res.rect.w * res.rect.h).toBeLessThanOrEqual(FOCUS_MAX_AREA);
    expect(Math.abs(res.rect.w / res.rect.h - W / H)).toBeLessThan(0.05);
    expect(res.rect.x + res.rect.w).toBeLessThanOrEqual(W);
    expect(res.rect.y + res.rect.h).toBeLessThanOrEqual(H);
  });
  test('하한(32) 미만으로 그리거나 짧게 누르면 사각형 해제', () => {
    const tap = finishFocusDrag(beginFocusDrag({ x: 300, y: 300 }, null), { x: 300, y: 300 }, W, H);
    expect(tap).toEqual({ kind: 'clear' });
    const thin = finishFocusDrag(beginFocusDrag({ x: 100, y: 100 }, null), { x: 400, y: 120 }, W, H);
    expect(thin).toEqual({ kind: 'clear' });
    expect(focusRectPresetPatch(null)).toEqual({ focusX: null, focusY: null, focusW: null, focusH: null });
  });
  test('미리보기: 작을 때는 그린 그대로(tooSmall), 하한 이상은 저장될 모습', () => {
    const drag = beginFocusDrag({ x: 100, y: 100 }, null);
    expect(previewFocusDrag(drag, { x: 110, y: 120 }, W, H)).toEqual({
      rect: { x: 100, y: 100, w: 10, h: 20 },
      tooSmall: true,
    });
    const big = previewFocusDrag(drag, { x: 300, y: 300 }, W, H);
    expect(big.tooSmall).toBe(false);
    expect(big.rect).toEqual(clampFocusRect({ x: 100, y: 100, w: 200, h: 200 }, W, H));
  });
});

describe('사각형 이동', () => {
  const rect = { x: 200, y: 400, w: 320, h: 320 };
  test('사각형 안에서 시작하면 이동 — 크기 유지·격자 맞춤', () => {
    const drag = beginFocusDrag({ x: 300, y: 500 }, rect);
    expect(drag.mode).toBe('move');
    const res = finishFocusDrag(drag, { x: 300 + 45, y: 500 - 21 }, W, H);
    expect(res).toEqual({ kind: 'set', rect: { x: 248, y: 376, w: 320, h: 320 } });
  });
  test('이미지 밖으로 끌면 가장자리에 멈춘다', () => {
    const drag = beginFocusDrag({ x: 300, y: 500 }, rect);
    const res = finishFocusDrag(drag, { x: 300 + 5000, y: 500 - 5000 }, W, H);
    expect(res).toEqual({ kind: 'set', rect: { x: W - 320, y: 0, w: 320, h: 320 } });
  });
  test('움직이지 않고 떼면 그대로(keep)', () => {
    const drag = beginFocusDrag({ x: 300, y: 500 }, rect);
    expect(finishFocusDrag(drag, { x: 302, y: 501 }, W, H)).toEqual({ kind: 'keep' });
  });
  test('사각형 밖에서 시작하면 새 사각형(기존 것을 대체)', () => {
    expect(beginFocusDrag({ x: 10, y: 10 }, rect).mode).toBe('draw');
  });
});

describe('이미지 크기 변경 시 클램프(U5)', () => {
  test('같은 이미지면 그대로', () => {
    const r = { x: 200, y: 400, w: 320, h: 320 };
    expect(reconcileFocusRect(r, W, H)).toEqual({ kind: 'keep' });
  });
  test('작은 이미지면 안으로 옮기거나 줄인다', () => {
    const r = { x: 600, y: 900, w: 320, h: 320 };
    const res = reconcileFocusRect(r, 512, 512);
    expect(res.kind).toBe('set');
    if (res.kind !== 'set') return;
    expect(res.rect.x + res.rect.w).toBeLessThanOrEqual(512);
    expect(res.rect.y + res.rect.h).toBeLessThanOrEqual(512);
  });
  test('하한보다 작은 이미지면 해제, 사각형이 없거나 크기를 모르면 그대로', () => {
    expect(reconcileFocusRect({ x: 0, y: 0, w: 64, h: 64 }, 24, 24)).toEqual({ kind: 'clear' });
    expect(reconcileFocusRect(null, W, H)).toEqual({ kind: 'keep' });
    expect(reconcileFocusRect({ x: 0, y: 0, w: 64, h: 64 }, 0, 0)).toEqual({ kind: 'keep' });
  });
});

describe('프리셋 읽기', () => {
  test('focus 키가 있는 프리셋만 영역 도구 대상(미러·I2I 는 키 없음)', () => {
    expect(presetSupportsFocus({ focusEnabled: false })).toBe(true);
    expect(presetSupportsFocus({ image: 'a' })).toBe(false);
    expect(presetSupportsFocus(undefined)).toBe(false);
  });
  test('사각형 숫자 4개가 있어야 사각형(켜짐 여부와 무관)', () => {
    expect(presetFocusRect({ focusX: 8, focusY: 16, focusW: 64, focusH: 64 })).toEqual({
      x: 8,
      y: 16,
      w: 64,
      h: 64,
    });
    expect(presetFocusRect({ focusX: null, focusY: 16, focusW: 64, focusH: 64 })).toBeNull();
  });
});

describe('오버레이 기하·요청 해상도 안내', () => {
  test('맥락 띠 4조각과 사각형 밖 어둡게 4조각, 안쪽은 사방 context 만큼 들어온다', () => {
    const g = focusOverlayGeometry({ x: 208, y: 304, w: 416, h: 608 }, 48, W, H);
    expect(g.outer).toEqual({ left: 25, top: 25, width: 50, height: 50 });
    expect(g.inner.left).toBeCloseTo(((208 + 48) / W) * 100);
    expect(g.inner.width).toBeCloseTo(((416 - 96) / W) * 100);
    expect(g.band).toHaveLength(4);
    expect(g.dim).toHaveLength(4);
  });
  test('이미지 가장자리에 붙은 사각형은 빈 어둡게 조각을 만들지 않는다', () => {
    const g = focusOverlayGeometry({ x: 0, y: 0, w: 320, h: 320 }, 48, W, H);
    expect(g.dim).toHaveLength(2);
  });
  test('요청 해상도 문구', () => {
    expect(focusRequestLabel({ x: 0, y: 0, w: 600, h: 600 }, W, H)).toBe('요청 1024×1024 (Focused)');
    expect(focusRequestLabel(null, W, H)).toBe('');
  });
});
