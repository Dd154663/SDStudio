/**
 * 캐릭터(정밀) 레퍼런스 요청 본문(2026-11-25) — V5 Full·Curated 는 보내고, V5 Medium·인페인트는 보내지 않으며,
 * V4.5 는 기존 데이터에 대해 종전과 같은 본문(의상 항목만 빠짐).
 */
const getConfig = jest.fn();

jest.mock('../../../models', () => ({
  backend: {
    getConfig,
  },
}));

import JSZip from 'jszip';
import {
  CharacterReference,
  ImageGenInput,
  Model,
  ModelVersion,
  NoiseSchedule,
  Sampling,
} from '../../imageGen';
import { NovelAiFetcher, NovelAiImageGenService } from '../nai';

async function makeZipResponse(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file('image_0.png', new Uint8Array([137, 80, 78, 71]));
  return zip.generateAsync({ type: 'arraybuffer' });
}

function makeInput(modelVersion: ModelVersion, refs?: CharacterReference[]): ImageGenInput {
  return {
    model: Model.Anime,
    prompt: 'base prompt',
    uc: 'base uc',
    resolution: { width: 832, height: 1216 },
    sampling: Sampling.KEuler,
    outputFilePath: 'unused.png',
    steps: 23,
    promptGuidance: 7,
    cfgRescale: 0,
    noiseSchedule: NoiseSchedule.Native,
    vibes: [],
    seed: 123,
    useCoords: false,
    legacyPromptConditioning: true,
    normalizeStrength: false,
    originalImage: false,
    varietyPlus: true,
    ...(refs ? { characterReferences: refs } : {}),
    generationSettings: {
      schemaVersion: 1,
      modelVersion,
      furryMode: false,
      disableQuality: true,
      ucPreset: 'none',
      autoConvertWebp: false,
      autoConvertWebpQuality: 80,
    },
  };
}

async function bodyOf(input: ImageGenInput) {
  const fetchArrayBuffer = jest.fn(async (_u: string, _b: any, _h: any) => makeZipResponse());
  const fetcher: NovelAiFetcher = { fetchArrayBuffer };
  await new NovelAiImageGenService(fetcher).generateImage('test-token', input);
  return fetchArrayBuffer.mock.calls[0][1];
}

const ref = (over: Partial<CharacterReference>): CharacterReference => ({
  image: 'IMG',
  info: 1,
  strength: 0.6,
  fidelity: 1,
  description: 'character',
  referenceType: 'character',
  ...over,
});

beforeEach(() => getConfig.mockReset());

describe('V4.5 요청 본문 불변', () => {
  // 종전 nai.ts 와 같은 규칙: base_caption = referenceType, legacy_uc = 입력값, strength 그대로, secondary = 1 - fidelity.
  const legacyRefs = [
    ref({ image: 'A', info: 0.8, strength: 0.5, fidelity: 0.7, referenceType: 'character' }),
    ref({ image: 'B', info: 1, strength: 1.2, fidelity: 1, referenceType: 'style' }),
    ref({ image: 'C', info: 0.4, strength: 2, fidelity: 0.25, referenceType: 'character&style' }),
  ];
  const legacyDirector = {
    director_reference_images: ['A', 'B', 'C'],
    director_reference_descriptions: [
      { caption: { base_caption: 'character', char_captions: [] }, legacy_uc: true },
      { caption: { base_caption: 'style', char_captions: [] }, legacy_uc: true },
      { caption: { base_caption: 'character&style', char_captions: [] }, legacy_uc: true },
    ],
    director_reference_strength_values: [0.5, 1.2, 2],
    director_reference_secondary_strength_values: [1 - 0.7, 1 - 1, 1 - 0.25],
    director_reference_information_extracted: [0.8, 1, 0.4],
  };

  test.each([ModelVersion.V4_5, ModelVersion.V4_5Curated])(
    '%s: 기존 데이터는 레퍼런스 없는 본문 + 종전 director_* 다섯 배열과 바이트 단위로 같다',
    async (version) => {
      const without = await bodyOf(makeInput(version));
      const withRefs = await bodyOf(makeInput(version, legacyRefs));
      // 레퍼런스가 실리면 Variety+ 는 꺼진다(skip_cfg_above_sigma = null — 종전 규칙)
      const expected = {
        ...without,
        parameters: { ...without.parameters, skip_cfg_above_sigma: null, ...legacyDirector },
      };
      expect(JSON.stringify(withRefs)).toBe(JSON.stringify(expected));
      expect(without.parameters.skip_cfg_above_sigma).not.toBeNull(); // Variety+ 켜짐 확인
    },
  );

  test('의상 항목이 섞이면 그 항목만 빠지고 나머지는 같다', async () => {
    const mixed = [
      legacyRefs[0],
      ref({ image: 'X', referenceType: 'costume' }),
      legacyRefs[1],
      legacyRefs[2],
    ];
    const a = await bodyOf(makeInput(ModelVersion.V4_5, legacyRefs));
    const b = await bodyOf(makeInput(ModelVersion.V4_5, mixed));
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  test('의상만 있으면 레퍼런스 필드가 없고 Variety+ 가 그대로', async () => {
    const without = await bodyOf(makeInput(ModelVersion.V4_5));
    const b = await bodyOf(makeInput(ModelVersion.V4_5, [ref({ referenceType: 'costume' })]));
    expect(JSON.stringify(b)).toBe(JSON.stringify(without));
  });

  test('V4.5 인페인트에는 종전대로 실린다', async () => {
    const input = makeInput(ModelVersion.V4_5, [legacyRefs[0]]);
    input.model = Model.Inpaint;
    input.image = 'image';
    input.mask = 'mask';
    const body = await bodyOf(input);
    expect(body.parameters.director_reference_images).toEqual(['A']);
  });

  test('V4 는 레퍼런스를 싣지 않는다(작업 조립에서도 빠짐)', async () => {
    const body = await bodyOf(makeInput(ModelVersion.V4, legacyRefs));
    expect(body.parameters).not.toHaveProperty('director_reference_images');
  });
});

describe('V5 요청 본문', () => {
  const v5Refs = [
    ref({ image: 'A', strength: 6, fidelity: 0.3, info: 0.9, referenceType: 'character', preferSameOutfit: true }),
    ref({ image: 'B', strength: 1, referenceType: 'character' }),
    ref({ image: 'C', strength: 2.5, referenceType: 'character&style', preferSameOutfit: false }),
    ref({ image: 'D', referenceType: 'character&style' }),
    ref({ image: 'E', referenceType: 'costume' }),
    ref({ image: 'F', referenceType: 'style' }),
    ref({ image: '', referenceType: 'style' }), // 빈 이미지는 뺀다
  ];

  test.each([ModelVersion.V5, ModelVersion.V5Curated])('%s: 다섯 배열·secondary 0·strength 상한 5·legacy_uc false', async (version) => {
    const body = await bodyOf(makeInput(version, v5Refs));
    const p = body.parameters;
    expect(p.director_reference_images).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    expect(p.director_reference_descriptions.map((d: any) => d.caption.base_caption)).toEqual([
      'character_mainoutfit',
      'character',
      'character&style_anyoutfit',
      'character&style',
      'costume',
      'style',
    ]);
    expect(p.director_reference_descriptions.every((d: any) => d.legacy_uc === false)).toBe(true);
    expect(p.director_reference_descriptions[0].caption.char_captions).toEqual([]);
    expect(p.director_reference_strength_values).toEqual([5, 1, 2.5, 0.6, 0.6, 0.6]);
    expect(p.director_reference_secondary_strength_values).toEqual([0, 0, 0, 0, 0, 0]);
    expect(p.director_reference_information_extracted).toEqual([0.9, 1, 1, 1, 1, 1]);
    expect(p.skip_cfg_above_sigma).toBeNull();
    expect(p).not.toHaveProperty('reference_image_multiple');
  });

  test('V5 는 바이브를 계속 보내지 않는다', async () => {
    const input = makeInput(ModelVersion.V5, v5Refs);
    input.vibes = [{ image: 'vibe', info: 1, strength: 0.5 }];
    const body = await bodyOf(input);
    expect(body.parameters).not.toHaveProperty('reference_image_multiple');
    expect(body.parameters).not.toHaveProperty('reference_strength_multiple');
  });

  test('V5 Medium 은 레퍼런스를 보내지 않는다', async () => {
    const body = await bodyOf(makeInput(ModelVersion.V5Medium, v5Refs));
    expect(body.model).toBe('nai-diffusion-5-full-medium');
    expect(body.parameters).not.toHaveProperty('director_reference_images');
    expect(body.parameters).not.toHaveProperty('director_reference_descriptions');
  });

  test('V5 인페인트(마스크)에는 레퍼런스를 싣지 않는다', async () => {
    const input = makeInput(ModelVersion.V5, v5Refs);
    input.model = Model.Inpaint;
    input.image = 'image';
    input.mask = 'mask';
    const body = await bodyOf(input);
    expect(body.action).toBe('infill');
    expect(body.parameters).not.toHaveProperty('director_reference_images');
  });

  test('V5 I2I 에는 싣는다', async () => {
    const input = makeInput(ModelVersion.V5, [ref({ image: 'A' })]);
    input.model = Model.I2I;
    input.image = 'image';
    const body = await bodyOf(input);
    expect(body.action).toBe('img2img');
    expect(body.parameters.director_reference_images).toEqual(['A']);
  });
});
