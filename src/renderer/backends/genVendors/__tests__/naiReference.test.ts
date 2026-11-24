/**
 * NovelAI 캐릭터(정밀) 레퍼런스 순수 규칙(2026-11-25) — naiReference.ts.
 */
import { ModelVersion } from '../../imageGen';
import { getNaiModelSpec, naiReferenceBlockReason } from '../naiModelCapabilities';
import {
  clampReferenceStrength,
  detectLetterboxRect,
  effectiveSameOutfit,
  insetLetterboxRect,
  letterboxContentRect,
  NAI_V5_REFERENCE_BUCKETS,
  naiReferenceCaption,
  parseNaiReferenceCaption,
  planReferenceBucket,
  referencesForModel,
} from '../naiReference';

const V5 = getNaiModelSpec(ModelVersion.V5).capabilities;
const V45 = getNaiModelSpec(ModelVersion.V4_5).capabilities;

describe('능력표', () => {
  test.each([
    [ModelVersion.V4, false, undefined],
    [ModelVersion.V4Curated, false, undefined],
    [ModelVersion.V4_5, true, undefined],
    [ModelVersion.V4_5Curated, true, undefined],
    [ModelVersion.V5, true, undefined],
    [ModelVersion.V5Curated, true, undefined],
    [ModelVersion.V5Medium, false, undefined],
  ])('%s 레퍼런스 지원 = %s', (version, supported) => {
    expect(getNaiModelSpec(version).capabilities.supportsCharacterReference).toBe(supported);
  });

  test('잠금 사유', () => {
    expect(naiReferenceBlockReason(ModelVersion.V4)).toBe('v4');
    expect(naiReferenceBlockReason(ModelVersion.V4Curated)).toBe('v4');
    expect(naiReferenceBlockReason(ModelVersion.V5Medium)).toBe('v5-medium');
    expect(naiReferenceBlockReason(ModelVersion.V5)).toBeUndefined();
    expect(naiReferenceBlockReason(ModelVersion.V5Curated)).toBeUndefined();
    expect(naiReferenceBlockReason(ModelVersion.V4_5)).toBeUndefined();
    expect(naiReferenceBlockReason(undefined)).toBeUndefined(); // 없음 = V4.5
  });

  test('V4.5 계열·V5 계열 레퍼런스 능력', () => {
    expect(V45).toMatchObject({
      referenceFidelity: true,
      referenceStrengthMax: 2,
      supportsOutfitReference: false,
      referencePreprocess: 'letterbox',
      supportsReferenceWithInpaint: true,
    });
    for (const v of [ModelVersion.V5, ModelVersion.V5Curated, ModelVersion.V5Medium]) {
      expect(getNaiModelSpec(v).capabilities).toMatchObject({
        supportsVibeTransfer: false,
        referenceFidelity: false,
        referenceStrengthMax: 5,
        supportsOutfitReference: true,
        referencePreprocess: 'bucket',
        supportsReferenceWithInpaint: false,
      });
    }
  });
});

describe('V5 크기 표·잘라 맞춤', () => {
  test('표 길이와 끝 값', () => {
    expect(NAI_V5_REFERENCE_BUCKETS).toHaveLength(97);
    expect(NAI_V5_REFERENCE_BUCKETS[0]).toEqual([256, 4096]);
    expect(NAI_V5_REFERENCE_BUCKETS[48]).toEqual([1024, 1024]);
    expect(NAI_V5_REFERENCE_BUCKETS[96]).toEqual([4096, 256]);
  });

  test.each([
    // [원본 폭, 높이, 기대 계획]
    [1024, 1024, { width: 1024, height: 1024, resizeWidth: 1024, resizeHeight: 1024, left: 0, top: 0 }],
    [1472, 1472, { width: 1024, height: 1024, resizeWidth: 1024, resizeHeight: 1024, left: 0, top: 0 }],
    [832, 1216, { width: 832, height: 1216, resizeWidth: 832, resizeHeight: 1216, left: 0, top: 0 }],
    [1000, 500, { width: 1408, height: 704, resizeWidth: 1408, resizeHeight: 704, left: 0, top: 0 }],
    // 1.43:1 → 1216×832 칸, 폭에 맞춰 키우고(×1.216) 위아래를 잘라 냄
    [1000, 700, { width: 1216, height: 832, resizeWidth: 1216, resizeHeight: 851, left: 0, top: 9 }],
    // 세로 0.7 → 832×1216 칸(가로의 거울), 높이에 맞춰 키우고 좌우를 잘라 냄
    [700, 1000, { width: 832, height: 1216, resizeWidth: 851, resizeHeight: 1216, left: 9, top: 0 }],
  ])('%s×%s', (w, h, expected) => {
    expect(planReferenceBucket(w, h)).toEqual(expected);
  });

  test('계획은 언제나 칸을 덮는다(resize ≥ 칸, 잘라 낸 영역이 안쪽)', () => {
    for (const [w, h] of [[3000, 400], [123, 4567], [1536, 1024], [1024, 1536], [1, 1]]) {
      const p = planReferenceBucket(w, h);
      expect(p.resizeWidth).toBeGreaterThanOrEqual(p.width);
      expect(p.resizeHeight).toBeGreaterThanOrEqual(p.height);
      expect(p.left + p.width).toBeLessThanOrEqual(p.resizeWidth);
      expect(p.top + p.height).toBeLessThanOrEqual(p.resizeHeight);
    }
  });
});

describe('종류 ↔ base_caption', () => {
  test.each([
    ['character', undefined, 'character'],
    ['character', false, 'character'],
    ['character', true, 'character_mainoutfit'],
    ['character&style', undefined, 'character&style'],
    ['character&style', true, 'character&style'],
    ['character&style', false, 'character&style_anyoutfit'],
    ['style', true, 'style'],
    ['costume', undefined, 'costume'],
    ['이상한값', undefined, 'character'],
    ['', undefined, 'character'],
  ])('V5: %s + %s → %s', (type, prefer, expected) => {
    expect(naiReferenceCaption(type, prefer as any, V5)).toBe(expected);
  });

  test.each([
    ['character', true, 'character'],
    ['character&style', false, 'character&style'],
    ['style', undefined, 'style'],
    ['costume', undefined, null],
    // 옛 메타 적용으로 base_caption 원문이 저장된 경우도 같은 규칙
    ['character_mainoutfit', undefined, 'character'],
  ])('의상 미지원(V4.5): %s + %s → %s', (type, prefer, expected) => {
    expect(naiReferenceCaption(type, prefer as any, V45)).toBe(expected);
  });

  test('역방향', () => {
    expect(parseNaiReferenceCaption('character_mainoutfit')).toEqual({
      referenceType: 'character',
      preferSameOutfit: true,
    });
    expect(parseNaiReferenceCaption('character&style_anyoutfit')).toEqual({
      referenceType: 'character&style',
      preferSameOutfit: false,
    });
    expect(parseNaiReferenceCaption('costume')).toEqual({ referenceType: 'costume' });
    expect(parseNaiReferenceCaption('character')).toEqual({ referenceType: 'character' });
    expect(parseNaiReferenceCaption('character&style')).toEqual({ referenceType: 'character&style' });
    expect(parseNaiReferenceCaption('style')).toEqual({ referenceType: 'style' });
    expect(parseNaiReferenceCaption('??')).toEqual({ referenceType: 'character' });
    expect(parseNaiReferenceCaption(undefined)).toEqual({ referenceType: 'character' });
  });

  test('왕복: 저장값 → caption → 저장값 → caption 이 같다', () => {
    for (const c of ['character', 'character_mainoutfit', 'character&style', 'character&style_anyoutfit', 'style', 'costume']) {
      const p = parseNaiReferenceCaption(c);
      expect(naiReferenceCaption(p.referenceType, p.preferSameOutfit, V5)).toBe(c);
    }
  });

  test('화면 토글 실효값', () => {
    expect(effectiveSameOutfit('character', undefined)).toBe(false);
    expect(effectiveSameOutfit('character', true)).toBe(true);
    expect(effectiveSameOutfit('character&style', undefined)).toBe(true);
    expect(effectiveSameOutfit('character&style', false)).toBe(false);
    expect(effectiveSameOutfit('style', true)).toBeUndefined();
    expect(effectiveSameOutfit('costume', undefined)).toBeUndefined();
  });
});

describe('referencesForModel', () => {
  const refs = [
    { path: 'a', referenceType: 'character' },
    { path: 'b', referenceType: 'costume' },
    { path: 'c', referenceType: 'style', enabled: false },
    { path: '', referenceType: 'character' },
    { path: 'd', referenceType: 'character&style', enabled: true },
  ];
  const paths = (xs: { path?: string }[]) => xs.map((x) => x.path);

  test('V5 Full·Curated: 켜짐·경로 있음 전부(의상 포함)', () => {
    expect(paths(referencesForModel(refs, ModelVersion.V5))).toEqual(['a', 'b', 'd']);
    expect(paths(referencesForModel(refs, ModelVersion.V5Curated))).toEqual(['a', 'b', 'd']);
  });
  test('V4.5: 의상은 보내지 않음', () => {
    expect(paths(referencesForModel(refs, ModelVersion.V4_5))).toEqual(['a', 'd']);
    expect(paths(referencesForModel(refs, undefined))).toEqual(['a', 'd']);
  });
  test('V4·V5 Medium: 없음', () => {
    expect(referencesForModel(refs, ModelVersion.V4)).toEqual([]);
    expect(referencesForModel(refs, ModelVersion.V4Curated)).toEqual([]);
    expect(referencesForModel(refs, ModelVersion.V5Medium)).toEqual([]);
    expect(referencesForModel(undefined, ModelVersion.V5)).toEqual([]);
  });
  test('Strength 상한', () => {
    expect(clampReferenceStrength(7, V5)).toBe(5);
    expect(clampReferenceStrength(3, V45)).toBe(2);
    expect(clampReferenceStrength(-1, V5)).toBe(0);
    expect(clampReferenceStrength(0.6, V45)).toBe(0.6);
  });
});

describe('검정 여백', () => {
  test('letterboxContentRect = normalizeReferenceImage 와 같은 계산', () => {
    expect(letterboxContentRect(1472, 1472, 1000, 500)).toEqual({ x: 0, y: 368, w: 1472, h: 736 });
    expect(letterboxContentRect(1024, 1536, 600, 1000)).toEqual({ x: 51, y: 0, w: 921, h: 1536 });
    expect(letterboxContentRect(1472, 1472, 1000, 1000)).toEqual({ x: 0, y: 0, w: 1472, h: 1472 });
  });

  test('insetLetterboxRect 는 띠가 있는 축만 들인다', () => {
    expect(insetLetterboxRect({ x: 0, y: 368, w: 1472, h: 736 }, 1472, 1472, 1)).toEqual({
      x: 0,
      y: 369,
      w: 1472,
      h: 734,
    });
    expect(insetLetterboxRect({ x: 0, y: 0, w: 1472, h: 1472 }, 1472, 1472, 1)).toEqual({
      x: 0,
      y: 0,
      w: 1472,
      h: 1472,
    });
  });

  /** w×h RGBA, 기본 회색 내용. paint(x, y) 가 true 면 검정. */
  function image(w: number, h: number, black: (x: number, y: number) => boolean, noise = 0) {
    const px = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const v = black(x, y) ? ((x * 7 + y * 13) % (noise + 1)) : 128;
        px[i] = v;
        px[i + 1] = v;
        px[i + 2] = v;
        px[i + 3] = 255;
      }
    }
    return px;
  }

  test('위아래 대칭 띠 → 띠 + 2px 안쪽으로 자름(JPEG 잡음 감안)', () => {
    const px = image(100, 200, (_x, y) => y < 20 || y >= 180, 12);
    expect(detectLetterboxRect(px, 100, 200)).toEqual({ x: 0, y: 22, w: 100, h: 156 });
  });

  test('양쪽 차이 3px 이하면 작은 쪽 기준', () => {
    const px = image(100, 200, (_x, y) => y < 20 || y >= 178);
    expect(detectLetterboxRect(px, 100, 200)).toEqual({ x: 0, y: 22, w: 100, h: 156 });
  });

  test('좌우 대칭 띠', () => {
    const px = image(200, 100, (x) => x < 10 || x >= 190);
    expect(detectLetterboxRect(px, 200, 100)).toEqual({ x: 12, y: 0, w: 176, h: 100 });
  });

  test('비대칭 어두운 가장자리는 띠로 보지 않음', () => {
    const px = image(100, 200, (_x, y) => y < 30);
    expect(detectLetterboxRect(px, 100, 200)).toEqual({ x: 0, y: 0, w: 100, h: 200 });
    const px2 = image(100, 200, (_x, y) => y < 30 || y >= 190);
    expect(detectLetterboxRect(px2, 100, 200)).toEqual({ x: 0, y: 0, w: 100, h: 200 });
  });

  test('줄 일부만 검정이면(1% 넘게 밝음) 띠가 아님', () => {
    const px = image(100, 200, (x, y) => (y < 20 || y >= 180) && x > 5);
    expect(detectLetterboxRect(px, 100, 200)).toEqual({ x: 0, y: 0, w: 100, h: 200 });
  });

  test('전체가 검정이거나 남는 영역이 너무 작으면 자르지 않음', () => {
    expect(detectLetterboxRect(image(50, 50, () => true), 50, 50)).toEqual({ x: 0, y: 0, w: 50, h: 50 });
    const thin = image(100, 100, (_x, y) => y < 44 || y >= 56);
    expect(detectLetterboxRect(thin, 100, 100)).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });

  test('두 축 모두 띠로 보이면 더 큰 쪽만', () => {
    const px = image(200, 200, (x, y) => y < 30 || y >= 170 || x < 5 || x >= 195);
    expect(detectLetterboxRect(px, 200, 200)).toEqual({ x: 0, y: 32, w: 200, h: 136 });
  });
});
