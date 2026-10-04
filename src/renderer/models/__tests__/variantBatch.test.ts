// 변형 씬 일괄 작업(2026-10-04 P3 「🎭 인페인트 마스크 일괄 적용」·P4 「🎚️ 강도·노이즈 일괄 변경」) — 순수 규칙(variantBatch.ts),
// 마스크 최근접 크기 변경(focusedInpaint.scaleMaskNearest), 흐름의 선택 모드 입력 경로(variantBatchFlow — 이미 고른 씬).
// 계약: SPEC_GUIDE §6 「대량 작업 I2I」·§7-2 「마스크 일괄 적용」.
const pushed: any[] = [];
const answers: (string | undefined)[] = [];
const messages: { text: string; kind?: string }[] = [];
const confirms: any[] = [];
let confirmAnswer = true;
const stored: string[] = [];
const sizes = new Map<string, { width: number; height: number }>();
const resized: { w: number; h: number }[] = [];
let mockSession: any;

jest.mock('../appStateRef', () => ({
  getAppState: () => ({
    pushDialogAsync: (dialog: any) => {
      pushed.push(dialog);
      return Promise.resolve(answers.shift());
    },
  }),
}));
jest.mock('../AppService', () => ({
  appState: {
    get curSession() {
      return mockSession;
    },
    pushMessage: (text: string, kind?: string) => messages.push({ text, kind }),
    pushDialogAsync: (dialog: any) => {
      pushed.push(dialog);
      return Promise.resolve(answers.shift());
    },
    confirmAsync: (opts: any) => {
      confirms.push(opts);
      return Promise.resolve(confirmAnswer);
    },
  },
}));
jest.mock('..', () => ({
  imageService: {
    fetchVibeImage: async (_s: any, path: string) => `data:image/png;base64,${path}`,
    storeVibeImage: async (_s: any, data: string) => {
      stored.push(data);
      return `vibe_${stored.length}.png`;
    },
  },
}));
jest.mock('../ImageService', () => ({
  dataUriToBase64: (d: string) => d.split(',')[1],
}));
jest.mock('../../componenets/BrushTool', () => ({
  getImageDimensions: async (b64: string) => {
    const size = sizes.get(b64);
    if (!size) throw new Error('decode');
    return size;
  },
}));
jest.mock('../focusedInpaintCanvas', () => ({
  resizeMaskPng: async (_b64: string, w: number, h: number) => {
    resized.push({ w, h });
    return `RESIZED_${w}x${h}`;
  },
}));

import { scaleMaskNearest } from '../focusedInpaint';
import {
  applyStrengthBatch,
  focusPatchForTarget,
  isMaskSource,
  maskApplyResultText,
  splitMaskTargets,
  splitStrengthTargets,
  strengthBatchResultText,
  VARIANT_BATCH_TEXT,
} from '../variantBatch';
import { openMaskApplyFlow, openStrengthBatchFlow } from '../variantBatchFlow';
import { chooseScenes } from '../sceneSelectorHost';

beforeEach(() => {
  pushed.splice(0);
  answers.splice(0);
  messages.splice(0);
  confirms.splice(0);
  stored.splice(0);
  resized.splice(0);
  sizes.clear();
  confirmAnswer = true;
});

const flush = () => new Promise((r) => setTimeout(r, 0));

function scene(name: string, workflowType: string, preset: any): any {
  return { type: 'inpaint', name, workflowType, preset };
}

function sessionOf(scenes: any[]): any {
  const map = new Map(scenes.map((s) => [s.name, s]));
  return {
    getScenes: () => [...map.values()],
    getScene: (_t: string, n: string) => map.get(n),
  };
}

describe('마스크 최근접 크기 변경(scaleMaskNearest) — 이진 유지', () => {
  test('크기가 같으면 같은 값', () => {
    const m = Uint8Array.from([1, 0, 0, 1]);
    expect(Array.from(scaleMaskNearest(m, 2, 2, 2, 2))).toEqual([1, 0, 0, 1]);
  });

  test('2배 확대 — 칸 복제, 결과는 0/1 뿐', () => {
    const m = Uint8Array.from([1, 0, 0, 1]);
    const out = scaleMaskNearest(m, 2, 2, 4, 4);
    expect(Array.from(out)).toEqual([1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1]);
    expect(new Set(out)).toEqual(new Set([0, 1]));
  });

  test('축소·비정수 비율도 0/1 만(회색 없음)', () => {
    const m = new Uint8Array(6 * 4);
    for (let i = 0; i < m.length; i++) m[i] = i % 3 === 0 ? 255 : 0; // 0 아닌 값도 1 로
    const out = scaleMaskNearest(m, 6, 4, 4, 3);
    expect(out.length).toBe(12);
    expect([...out].every((v) => v === 0 || v === 1)).toBe(true);
  });
});

describe('P3 대상·Focused 복사 규칙', () => {
  test('원본 후보 = 마스크 있는 인페인트 씬', () => {
    expect(isMaskSource(scene('a', 'SDInpaint', { mask: 'm.png' }))).toBe(true);
    expect(isMaskSource(scene('b', 'SDInpaint', { mask: '' }))).toBe(false);
    expect(isMaskSource(scene('c', 'SDMirror', { mask: 'm.png' }))).toBe(false);
  });

  test('대상 = 이미지 있는 인페인트, 원본 자신은 세지 않음, 나머지는 건너뜀', () => {
    const list = [
      scene('src', 'SDInpaint', { image: 'a.png', mask: 'm.png' }),
      scene('t1', 'SDInpaint', { image: 'b.png' }),
      scene('noimg', 'SDInpaint', { image: '' }),
      scene('mirror', 'SDMirror', { image: 'c.png' }),
      scene('i2i', 'SDI2I', { image: 'd.png' }),
    ];
    const { targets, skipped } = splitMaskTargets(list, 'src');
    expect(targets.map((s) => s.name)).toEqual(['t1']);
    expect(skipped.map((s) => s.name)).toEqual(['noimg', 'mirror', 'i2i']);
  });

  const src = {
    focusEnabled: true,
    focusX: 64,
    focusY: 128,
    focusW: 256,
    focusH: 256,
    focusContext: 64,
  };

  test('크기가 같으면 사각형 그대로(클램프만)', () => {
    const p = focusPatchForTarget(src, { width: 832, height: 1216 }, { width: 832, height: 1216 });
    expect(p).toEqual({
      focusEnabled: true,
      focusX: 64,
      focusY: 128,
      focusW: 256,
      focusH: 256,
      focusContext: 64,
    });
  });

  test('크기가 다르면 마스크와 같은 비율로 옮긴 뒤 대상 크기로 클램프', () => {
    const p = focusPatchForTarget(src, { width: 832, height: 1216 }, { width: 416, height: 608 });
    expect(p).toMatchObject({ focusEnabled: true, focusX: 32, focusY: 64, focusW: 128, focusH: 128 });
  });

  test('클램프할 수 없으면(대상 32px 미만) 사각형 없음·꺼짐, 사각형이 없어도 꺼짐', () => {
    expect(focusPatchForTarget(src, { width: 832, height: 1216 }, { width: 16, height: 16 })).toMatchObject({
      focusEnabled: false,
      focusX: null,
      focusW: null,
    });
    expect(
      focusPatchForTarget({ focusEnabled: true }, { width: 64, height: 64 }, { width: 64, height: 64 }),
    ).toMatchObject({ focusEnabled: false, focusX: null, focusContext: 48 });
  });

  test('토스트 — 적용 N개 · 크기 맞춤 M개 · 건너뜀 K개', () => {
    expect(maskApplyResultText({ applied: 3, resized: 1, skipped: 2, failed: [] })).toBe(
      '3개 인페인트 씬에 마스크를 적용했습니다 · 크기 맞춤 1개 · 건너뜀 2개(이미지 없음/미러/I2I 등)',
    );
  });
});

describe('P4 강도·노이즈 규칙', () => {
  test('대상 = I2I·인페인트·미러(미러 핸들러도 strength 를 보냄), 이미지 수정은 건너뜀', () => {
    const list = [
      scene('a', 'SDI2I', { strength: 1, noise: 0 }),
      scene('b', 'SDInpaint', { strength: 1 }),
      scene('c', 'SDMirror', { strength: 1 }),
      scene('d', 'Augment', {}),
    ];
    const { targets, skipped } = splitStrengthTargets(list);
    expect(targets.map((s) => s.name)).toEqual(['a', 'b', 'c']);
    expect(skipped.map((s) => s.name)).toEqual(['d']);
  });

  test('강도는 모두, 노이즈는 I2I 에만(인페인트·미러에는 noise 키를 만들지 않음)', () => {
    const i2i = scene('a', 'SDI2I', { strength: 1, noise: 0 });
    const inpaint = scene('b', 'SDInpaint', { strength: 1 });
    const mirror = scene('c', 'SDMirror', { strength: 1 });
    const r = applyStrengthBatch([i2i, inpaint, mirror], { strength: 0.4, noise: 0.2 });
    expect(r).toEqual({ changed: 3, noiseChanged: 1 });
    expect(i2i.preset).toEqual({ strength: 0.4, noise: 0.2 });
    expect(inpaint.preset).toEqual({ strength: 0.4 });
    expect(mirror.preset).toEqual({ strength: 0.4 });
    // 노이즈 유지
    const r2 = applyStrengthBatch([i2i], { strength: 0.5 });
    expect(r2).toEqual({ changed: 1, noiseChanged: 0 });
    expect(i2i.preset).toEqual({ strength: 0.5, noise: 0.2 });
  });

  test('토스트', () => {
    expect(
      strengthBatchResultText({ changed: 3, strength: 0.4, noise: 0.2, noiseChanged: 1, skipped: 1, failed: [] }),
    ).toBe('3개 씬의 강도를 0.4(으)로 바꿨습니다(노이즈 0.2 — I2I 1개) · 건너뜀 1개');
  });
});

describe('선택 모드 입력 경로(이미 고른 씬 — 씬 선택 창을 건너뜀)', () => {
  test('chooseScenes — preselected 가 있으면 창을 열지 않고 그대로', async () => {
    const setter = jest.fn();
    const picked = [scene('a', 'SDI2I', {})];
    await expect(chooseScenes(setter, { type: 'inpaint', text: 't' }, picked)).resolves.toEqual(picked);
    expect(setter).not.toHaveBeenCalled();
  });

  test('chooseScenes — 없으면 씬 선택 창을 열고, 고르면 닫는다', async () => {
    const setter = jest.fn();
    const p = chooseScenes(setter, { type: 'inpaint', text: 't' });
    const item = setter.mock.calls[0][0];
    item.callback([scene('x', 'SDI2I', {})]);
    await expect(p).resolves.toHaveLength(1);
    expect(setter).toHaveBeenLastCalledWith(undefined);
  });

  test('P4 — 고른 씬에 강도·(I2I)노이즈를 적용, 창은 열지 않는다', async () => {
    const i2i = scene('a', 'SDI2I', { strength: 1, noise: 0.1 });
    const inpaint = scene('b', 'SDInpaint', { strength: 0.8 });
    const aug = scene('c', 'Augment', {});
    mockSession = sessionOf([i2i, inpaint, aug]);
    const setter = jest.fn();
    answers.push('0.35', 'change', '0.05');
    await openStrengthBatchFlow('inpaint', setter, [i2i, inpaint, aug]);
    expect(setter).not.toHaveBeenCalled();
    expect(pushed[0].type).toBe('input-confirm');
    expect(pushed[0].inputValue).toBe('1'); // 첫 대상의 현재 값
    expect(pushed[1].text).toBe(VARIANT_BATCH_TEXT.noiseQuestion(1));
    expect(pushed[2].inputValue).toBe('0.1');
    expect(i2i.preset).toEqual({ strength: 0.35, noise: 0.05 });
    expect(inpaint.preset).toEqual({ strength: 0.35 });
    expect(messages[0].text).toContain('2개 씬의 강도를 0.35');
    expect(messages[0].text).toContain('건너뜀 1개');
  });

  test('P4 — 인페인트만이면 노이즈를 묻지 않는다', async () => {
    const inpaint = scene('b', 'SDInpaint', { strength: 0.8 });
    mockSession = sessionOf([inpaint]);
    answers.push('0.6');
    await openStrengthBatchFlow('inpaint', jest.fn(), [inpaint]);
    expect(pushed).toHaveLength(1);
    expect(inpaint.preset.strength).toBe(0.6);
  });

  test('P3 — 원본만 창으로 고르고 대상은 고른 씬, 크기가 다르면 맞추고 씬마다 새 파일', async () => {
    const src = scene('src', 'SDInpaint', {
      image: 'SRCIMG',
      mask: 'SRCMASK',
      focusEnabled: true,
      focusX: 0,
      focusY: 0,
      focusW: 64,
      focusH: 64,
      focusContext: 48,
    });
    const same = scene('same', 'SDInpaint', { image: 'IMG_A', mask: 'OLD' });
    const half = scene('half', 'SDInpaint', { image: 'IMG_B', mask: '' });
    const mirror = scene('mirror', 'SDMirror', { image: 'IMG_C' });
    mockSession = sessionOf([src, same, half, mirror]);
    sizes.set('SRCMASK', { width: 128, height: 128 });
    sizes.set('IMG_A', { width: 128, height: 128 });
    sizes.set('IMG_B', { width: 64, height: 64 });
    const setter = jest.fn();
    openMaskApplyFlow('inpaint', setter, [same, half, mirror]);
    // 원본 고르기 창(마스크 있는 인페인트 씬만)
    expect(setter).toHaveBeenCalledTimes(1);
    const item = setter.mock.calls[0][0];
    expect(item.scenes.map((s: any) => s.name)).toEqual(['src', 'same']);
    item.callback([src]);
    await flush();
    await flush();
    // 대상 씬 선택 창은 열지 않는다(닫기 호출 1번뿐)
    expect(setter.mock.calls.filter((c) => c[0] !== undefined)).toHaveLength(1);
    expect(confirms).toHaveLength(1); // 기존 마스크가 있는 대상 1개
    expect(confirms[0].danger).toBe(true);
    await flush();
    await flush();
    expect(stored).toEqual(['SRCMASK', 'RESIZED_64x64']);
    expect(resized).toEqual([{ w: 64, h: 64 }]);
    expect(same.preset.mask).toBe('vibe_1.png');
    expect(half.preset.mask).toBe('vibe_2.png');
    expect(half.preset).toMatchObject({ focusEnabled: true, focusX: 0, focusW: 32, focusH: 32 });
    expect(mirror.preset.mask).toBeUndefined();
    expect(messages[0].text).toBe(
      '2개 인페인트 씬에 마스크를 적용했습니다 · 크기 맞춤 1개 · 건너뜀 1개(이미지 없음/미러/I2I 등)',
    );
  });
});
