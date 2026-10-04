/**
 * Focused inpainting 순수 계산(2026-10-04 S1) — 클램프·상한·64 배수 요청 해상도·재매핑·안쪽 사각형·
 * 마스크 규칙·페더 알파·블렌딩.
 */
import {
  blendRgba,
  boxRadiiForGauss,
  clampFocusRect,
  dilateMask,
  FEATHER_BLUR_PX,
  FEATHER_DILATE_PX,
  featherAlpha,
  FOCUS_CONTEXT_DEFAULT,
  FOCUS_MAX_AREA,
  FOCUS_TARGET_PIXEL_LIMIT,
  focusedMaskRule,
  focusedRequestSize,
  focusSpecFromPreset,
  focusTargetSize,
  innerContextRect,
  isFocusRectInput,
  normalizeFocusContext,
  remapCharacterCenter,
  requestMaskFromRectMask,
  snapMaskToGrid,
} from '../focusedInpaint';

describe('clampFocusRect', () => {
  test('8px 격자 정렬·이미지 안 유지', () => {
    const r = clampFocusRect({ x: 113, y: 301, w: 599, h: 603 }, 832, 1216)!;
    expect(r.w % 8).toBe(0);
    expect(r.h % 8).toBe(0);
    expect(r.x % 8).toBe(0);
    expect(r.y % 8).toBe(0);
    expect(r).toEqual({ x: 112, y: 304, w: 600, h: 600 });
  });

  test('넓이 상한 768² 초과는 중심·비율을 유지해 줄인다', () => {
    const r = clampFocusRect({ x: 0, y: 0, w: 1024, h: 1024 }, 2048, 2048)!;
    expect(r.w * r.h).toBeLessThanOrEqual(FOCUS_MAX_AREA);
    expect(r.w).toBe(768);
    expect(r.h).toBe(768);
    const wide = clampFocusRect({ x: 100, y: 100, w: 1600, h: 800 }, 4096, 4096)!;
    expect(wide.w * wide.h).toBeLessThanOrEqual(FOCUS_MAX_AREA);
    expect(Math.abs(wide.w / wide.h - 2)).toBeLessThan(0.05);
    // 중심 유지(격자 정렬 오차 8px 이내)
    expect(Math.abs(wide.x + wide.w / 2 - 900)).toBeLessThanOrEqual(8);
  });

  test('최소 변 32·이미지 밖은 안으로 밀어 넣는다', () => {
    expect(clampFocusRect({ x: 10, y: 10, w: 4, h: 4 }, 832, 1216)).toMatchObject({ w: 32, h: 32 });
    const edge = clampFocusRect({ x: 800, y: 1200, w: 200, h: 200 }, 832, 1216)!;
    expect(edge.x + edge.w).toBeLessThanOrEqual(832);
    expect(edge.y + edge.h).toBeLessThanOrEqual(1216);
    expect(clampFocusRect({ x: -50, y: -50, w: 100, h: 100 }, 832, 1216)).toMatchObject({ x: 0, y: 0 });
  });

  test('이미지보다 큰 사각형은 이미지 크기로, 너무 작은 이미지는 null', () => {
    const r = clampFocusRect({ x: 0, y: 0, w: 700, h: 700 }, 512, 512)!;
    expect(r).toEqual({ x: 0, y: 0, w: 512, h: 512 });
    expect(clampFocusRect({ x: 0, y: 0, w: 32, h: 32 }, 24, 24)).toBeNull();
    expect(clampFocusRect({ x: NaN, y: 0, w: 32, h: 32 } as any, 512, 512)).toBeNull();
  });
});

describe('focusTargetSize', () => {
  test('600² → 1024²(실험 2 와 같음)', () => {
    expect(focusTargetSize(600, 600)).toEqual({ width: 1024, height: 1024 });
  });

  test.each([
    [600, 600],
    [768, 768],
    [320, 480],
    [32, 32],
    [32, 768],
    [768, 512],
    [400, 1000],
  ])('%i×%i: 64 배수·≤1MP·원본보다 작지 않음·비율 근사', (w, h) => {
    const t = focusTargetSize(w, h);
    expect(t.width % 64).toBe(0);
    expect(t.height % 64).toBe(0);
    expect(t.width * t.height).toBeLessThanOrEqual(FOCUS_TARGET_PIXEL_LIMIT);
    expect(t.width).toBeGreaterThanOrEqual(w);
    expect(t.height).toBeGreaterThanOrEqual(h);
    expect(Math.abs(t.width / t.height - w / h) / (w / h)).toBeLessThan(0.25);
  });

  test('focusedRequestSize 는 클램프 후 크기', () => {
    expect(focusedRequestSize({ x: 112, y: 304, w: 600, h: 600 }, 832, 1216)).toEqual({ width: 1024, height: 1024 });
    expect(focusedRequestSize({ x: 0, y: 0, w: 32, h: 32 }, 8, 8)).toBeNull();
  });
});

describe('innerContextRect·context 정규화', () => {
  test('사방 context 만큼 안쪽(8 배수)', () => {
    expect(innerContextRect({ x: 112, y: 304, w: 600, h: 600 }, 48)).toEqual({ x: 48, y: 48, w: 504, h: 504 });
  });
  test('작은 사각형은 안쪽이 최소 8px 남는다', () => {
    const inner = innerContextRect({ x: 0, y: 0, w: 32, h: 96 }, 96);
    expect(inner.w).toBeGreaterThanOrEqual(8);
    expect(inner.h).toBeGreaterThanOrEqual(8);
    expect(inner.x % 8).toBe(0);
  });
  test('context 는 32~96·8 배수, 없음=48', () => {
    expect(normalizeFocusContext(undefined)).toBe(FOCUS_CONTEXT_DEFAULT);
    expect(normalizeFocusContext(10)).toBe(32);
    expect(normalizeFocusContext(200)).toBe(96);
    expect(normalizeFocusContext(51)).toBe(48);
  });
});

describe('remapCharacterCenter', () => {
  test('크롭 좌표계로 옮기고 0~1 로 자른다', () => {
    const rect = { x: 112, y: 304, w: 600, h: 600 };
    const c = remapCharacterCenter({ x: 412 / 832, y: 604 / 1216 }, rect, 832, 1216);
    expect(c.x).toBeCloseTo(0.5, 6);
    expect(c.y).toBeCloseTo(0.5, 6);
    expect(remapCharacterCenter({ x: 0, y: 1 }, rect, 832, 1216)).toEqual({ x: 0, y: 1 });
  });
});

describe('focusedMaskRule', () => {
  const w = 10;
  const h = 10;
  const inner = { x: 2, y: 2, w: 6, h: 6 };

  test('안쪽 밖은 지운다', () => {
    const mask = new Uint8Array(w * h);
    mask[0] = 1; // 바깥
    mask[3 * w + 3] = 1; // 안쪽
    const { mask: out, fullSizeMask } = focusedMaskRule(mask, w, h, inner);
    expect(fullSizeMask).toBe(false);
    expect(out[0]).toBe(0);
    expect(out[3 * w + 3]).toBe(1);
    expect(out.reduce((a, b) => a + b, 0)).toBe(1);
    expect(mask[0]).toBe(1); // 입력 불변
  });

  test('안쪽이 비면 안쪽 전체를 마스크로', () => {
    const mask = new Uint8Array(w * h);
    mask[0] = 1;
    const { mask: out, fullSizeMask } = focusedMaskRule(mask, w, h, inner);
    expect(fullSizeMask).toBe(true);
    expect(out.reduce((a, b) => a + b, 0)).toBe(36);
    expect(out[2 * w + 2]).toBe(1);
    expect(out[1 * w + 1]).toBe(0);
  });
});

describe('페더·블렌딩', () => {
  test('팽창은 정사각 반경', () => {
    const m = new Uint8Array(9 * 9);
    m[4 * 9 + 4] = 1;
    const d = dilateMask(m, 9, 9, 2);
    expect(d.reduce((a, b) => a + b, 0)).toBe(25);
    expect(d[2 * 9 + 2]).toBe(1);
    expect(d[1 * 9 + 4]).toBe(0);
  });

  test('상자 반경 3개(가우시안 20 근사)', () => {
    const radii = boxRadiiForGauss(FEATHER_BLUR_PX);
    expect(radii).toHaveLength(3);
    const variance = radii.reduce((s, r) => s + ((2 * r + 1) ** 2 - 1) / 12, 0);
    expect(Math.sqrt(variance)).toBeCloseTo(FEATHER_BLUR_PX, 0);
  });

  test('마스크 안은 1, 멀리 떨어진 곳은 정확히 0(원본 유지)', () => {
    const w = 400;
    const h = 400;
    const m = new Uint8Array(w * h);
    for (let y = 150; y < 250; y++) for (let x = 150; x < 250; x++) m[y * w + x] = 1;
    const a = featherAlpha(m, w, h);
    expect(a[200 * w + 200]).toBe(1);
    expect(a[0]).toBe(0);
    // 팽창 경계 바깥 쪽으로 갈수록 줄어든다
    const edge = 150 - FEATHER_DILATE_PX;
    expect(a[200 * w + edge]).toBeGreaterThan(0.3);
    expect(a[200 * w + edge]).toBeLessThan(0.7);
    expect(a[200 * w + 150]).toBeGreaterThan(0.9);
  });

  test('blendRgba: a=0 원본, a=1 결과, 중간은 선형', () => {
    const o = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
    const r = new Uint8ClampedArray([200, 100, 50, 255, 200, 100, 50, 255, 200, 100, 50, 255]);
    const out = blendRgba(o, r, new Float32Array([0, 1, 0.5]));
    expect(Array.from(out)).toEqual([0, 0, 0, 255, 200, 100, 50, 255, 100, 50, 25, 255]);
  });

  test('blendRgba: 서버 결과 알파는 무시 — 결과 알파 0 이어도 RGB 를 섞고 출력 알파는 원본값', () => {
    const o = new Uint8ClampedArray([10, 20, 30, 254, 10, 20, 30, 255, 10, 20, 30, 254]);
    const r = new Uint8ClampedArray([210, 120, 70, 0, 210, 120, 70, 0, 210, 120, 70, 180]);
    const out = blendRgba(o, r, new Float32Array([1, 0.5, 0]));
    expect(Array.from(out)).toEqual([210, 120, 70, 254, 110, 70, 50, 255, 10, 20, 30, 254]);
  });
});

describe('프리셋 → Focused 사양', () => {
  test('꺼짐·사각형 없음은 undefined', () => {
    expect(focusSpecFromPreset({ focusEnabled: false, focusX: 0, focusY: 0, focusW: 64, focusH: 64 })).toBeUndefined();
    expect(focusSpecFromPreset({ focusEnabled: true, focusX: null, focusY: 0, focusW: 64, focusH: 64 })).toBeUndefined();
    expect(focusSpecFromPreset({ focusEnabled: true, focusX: 0, focusY: 0, focusW: 0, focusH: 64 })).toBeUndefined();
    expect(focusSpecFromPreset(undefined)).toBeUndefined();
    expect(isFocusRectInput({ x: 0, y: 0, w: 8, h: 8 })).toBe(true);
  });
  test('켜짐 + 사각형 → context 정규화 포함', () => {
    expect(
      focusSpecFromPreset({ focusEnabled: true, focusX: 112, focusY: 304, focusW: 600, focusH: 600 }),
    ).toEqual({ x: 112, y: 304, w: 600, h: 600, context: 48 });
  });
});

/** 8×8 칸 중 일부만 칠해진 칸 수(0 이어야 서버 결과에 마스크 윤곽선 잡음이 없다). */
function partialCells(mask: Uint8Array, w: number, h: number): number {
  let partial = 0;
  for (let by = 0; by < h; by += 8) {
    for (let bx = 0; bx < w; bx += 8) {
      let n = 0;
      for (let y = by; y < by + 8; y++) for (let x = bx; x < bx + 8; x++) n += mask[y * w + x];
      if (n > 0 && n < 64) partial++;
    }
  }
  return partial;
}

describe('요청 마스크 8px 격자 스냅', () => {
  test('snapMaskToGrid: 칸에 하나라도 있으면 칸 전체, 입력을 포함하고 두 번 적용해도 같다', () => {
    const w = 16;
    const h = 16;
    const m = new Uint8Array(w * h);
    m[3 * w + 9] = 1; // 오른쪽 위 칸 한 점
    const s = snapMaskToGrid(m, w, h);
    expect(s.reduce((a, b) => a + b, 0)).toBe(64);
    for (let y = 0; y < 8; y++) for (let x = 8; x < 16; x++) expect(s[y * w + x]).toBe(1);
    expect(s[9 * w + 9]).toBe(0);
    expect(Array.from(snapMaskToGrid(s, w, h))).toEqual(Array.from(s));
    // 가장자리에서 잘린 칸도 안전
    const odd = snapMaskToGrid(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 1]), 10, 1);
    expect(Array.from(odd)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1, 1]);
  });

  test('실험 600²→1024²: 사각형 마스크(144–464) 경계가 240/792 로 맞고 일부만 칠해진 칸 0', () => {
    const rw = 600;
    const rect = new Uint8Array(rw * rw);
    for (let y = 144; y < 464; y++) rect.fill(1, y * rw + 144, y * rw + 464);
    const out = requestMaskFromRectMask(rect, rw, rw, 1024, 1024);
    expect(partialCells(out, 1024, 1024)).toBe(0);
    let x0 = 1024;
    let x1 = -1;
    let y0 = 1024;
    let y1 = -1;
    for (let y = 0; y < 1024; y++) {
      for (let x = 0; x < 1024; x++) {
        if (!out[y * 1024 + x]) continue;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
    expect([x0, y0, x1 + 1, y1 + 1]).toEqual([240, 240, 792, 792]);
    // 입력의 모든 칠한 픽셀(중심 표본)이 결과에 포함
    for (let y = 0; y < 1024; y++) {
      for (let x = 0; x < 1024; x++) {
        const sx = Math.floor(((x + 0.5) * rw) / 1024);
        const sy = Math.floor(((y + 0.5) * rw) / 1024);
        if (rect[sy * rw + sx]) expect(out[y * 1024 + x]).toBe(1);
      }
    }
  });

  test('비정수 비율 664×648→1024×960 · 안쪽 사각형 전체 마스크도 일부만 칠해진 칸 0', () => {
    const rect = { x: 136, y: 32, w: 664, h: 648 };
    const { width, height } = focusTargetSize(rect.w, rect.h);
    expect([width, height]).toEqual([1024, 960]);
    const inner = innerContextRect(rect, 48);
    const { mask, fullSizeMask } = focusedMaskRule(new Uint8Array(rect.w * rect.h), rect.w, rect.h, inner);
    expect(fullSizeMask).toBe(true);
    const out = requestMaskFromRectMask(mask, rect.w, rect.h, width, height);
    expect(partialCells(out, width, height)).toBe(0);
    // BrushTool 식 8px 칸 타원 마스크
    const brush = new Uint8Array(rect.w * rect.h);
    for (let y = 0; y < rect.h; y += 8) {
      for (let x = 0; x < rect.w; x += 8) {
        if (((x - 330) / 120) ** 2 + ((y - 300) / 170) ** 2 <= 1) {
          for (let yy = y; yy < y + 8; yy++) brush.fill(1, yy * rect.w + x, yy * rect.w + x + 8);
        }
      }
    }
    const ruled = focusedMaskRule(brush, rect.w, rect.h, inner).mask;
    expect(partialCells(requestMaskFromRectMask(ruled, rect.w, rect.h, width, height), width, height)).toBe(0);
  });
});
