// V5 Full Medium Effort(V5M, 2026-11-06) — 능력표·모델 ID·요청 본문·폴백·Source 해시·가짜 서버 차감.
const getConfig = jest.fn();

jest.mock('../../../models', () => ({
  backend: {
    getConfig,
  },
}));

import JSZip from 'jszip';
import {
  GenerationSettingsSnapshot,
  ImageGenInput,
  Model,
  ModelVersion,
  NoiseSchedule,
  Sampling,
} from '../../imageGen';
import { NovelAiFetcher, NovelAiImageGenService } from '../nai';
import {
  effectiveNaiSteps,
  getNaiModelSpec,
  isOpusFreeEligible,
  isV5ModelVersion,
  modelVersionFromNaiSource,
  naiFixedSettings,
  normalizeModelVersion,
  resolveNaiModelId,
  V5_SAMPLERS,
} from '../naiModelCapabilities';
import { mergeUcPreset, stripUcPreset } from '../naiQualityPresets';
import { captureGenerationSettings } from '../../generationSettings';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockServer = require('../../../../../dev/mock-nai/server.cjs');

const V5_HEAVY =
  'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page';

async function makeZipResponse(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file('image_0.png', new Uint8Array([137, 80, 78, 71]));
  return zip.generateAsync({ type: 'arraybuffer' });
}

function makeService() {
  const fetchArrayBuffer = jest.fn(
    async (_url: string, _body: any, _headers: any) => makeZipResponse(),
  );
  const fetcher: NovelAiFetcher = { fetchArrayBuffer };
  return { service: new NovelAiImageGenService(fetcher), fetchArrayBuffer };
}

function snapshot(
  modelVersion: ModelVersion,
  ucPreset: GenerationSettingsSnapshot['ucPreset'] = 'light',
): GenerationSettingsSnapshot {
  return {
    schemaVersion: 1,
    modelVersion,
    furryMode: false,
    disableQuality: false,
    qualityPreset: 'standard',
    ucPreset,
    autoConvertWebp: false,
    autoConvertWebpQuality: 80,
  };
}

function makeInput(model = Model.Anime): ImageGenInput {
  return {
    model,
    prompt: 'girl, 1.5::0aaa0::',
    uc: 'hat, artist:someone, 2::9tag9::',
    resolution: { width: 832, height: 1216 },
    sampling: Sampling.KDPMPP2M,
    outputFilePath: 'unused.png',
    steps: 40,
    promptGuidance: 6.5,
    cfgRescale: 0.4,
    noiseSchedule: NoiseSchedule.Native,
    vibes: [],
    seed: 777,
    useCoords: true,
    legacyPromptConditioning: false,
    normalizeStrength: false,
    originalImage: false,
    characterPrompts: ['boy', 'cat'],
    characterUCs: ['bad hands', 'blurry'],
    characterPositions: [
      { x: 0.3, y: 0.5 },
      { x: 0.7, y: 0.5 },
    ],
    generationSettings: snapshot(ModelVersion.V5Medium),
  };
}

beforeEach(() => {
  getConfig.mockReset();
});

describe('V5 Medium 능력표·모델 ID', () => {
  test.each([
    [Model.Anime, 'nai-diffusion-5-full-medium'],
    [Model.I2I, 'nai-diffusion-5-full-medium'],
    [Model.Inpaint, 'nai-diffusion-5-full-medium-inpainting'],
  ])('%s → %s', (model, expected) => {
    expect(resolveNaiModelId(model, ModelVersion.V5Medium)).toBe(expected);
  });

  test('V5 Full 과 같은 능력 + CFG Rescale 미지원 + 고정값', () => {
    const spec = getNaiModelSpec(ModelVersion.V5Medium);
    expect(spec.capabilities).toMatchObject({
      paramsVersion: 4,
      promptTokenLimit: 1471,
      maxPromptGuidance: 10,
      maxCharacterPrompts: 32,
      supportsVibeTransfer: false,
      supportsCharacterReference: false,
      supportsVarietyPlus: false,
      supportsTransparentBackground: true,
      forcedNoiseSchedule: NoiseSchedule.Karras,
      supportsCfgRescale: false,
    });
    expect(spec.capabilities.supportedSamplers).toEqual(V5_SAMPLERS);
    expect(spec.fixedSettings).toEqual({
      steps: 14,
      sampler: Sampling.KEulerAncestral,
      ucPreset: 'heavy',
    });
    expect(spec.inpaintFallbackVersion).toBeUndefined();
    // V5 Full·Curated 에는 고정값이 없다(종전 동작 불변)
    expect(naiFixedSettings(ModelVersion.V5)).toBeUndefined();
    expect(naiFixedSettings(ModelVersion.V5Curated)).toBeUndefined();
    expect(getNaiModelSpec(ModelVersion.V5).capabilities.supportsCfgRescale).toBeUndefined();
    expect(isV5ModelVersion(ModelVersion.V5Medium)).toBe(true);
  });

  test('실제 스텝 = 14 고정 → 사용자 스텝 40 이어도 Opus 무료 대상', () => {
    expect(effectiveNaiSteps(ModelVersion.V5Medium, 40)).toBe(14);
    expect(effectiveNaiSteps(ModelVersion.V5, 80)).toBe(50);
    expect(effectiveNaiSteps(ModelVersion.V4_5, 80)).toBe(80);
    expect(effectiveNaiSteps(undefined, 33)).toBe(33);
    expect(
      isOpusFreeEligible({
        version: ModelVersion.V5Medium,
        width: 832,
        height: 1216,
        steps: effectiveNaiSteps(ModelVersion.V5Medium, 40),
        hasCharacterReference: false,
      }),
    ).toBe(true);
  });
});

describe('모르는 modelVersion 폴백(전진 호환)', () => {
  test.each([
    [undefined, ModelVersion.V4_5],
    ['4-5-full', ModelVersion.V4_5],
    ['5-full-medium', ModelVersion.V5Medium],
    ['5-full-high-future', ModelVersion.V5],
    ['6-full', ModelVersion.V4_5],
    [42, ModelVersion.V4_5],
  ])('%p → %s', (value, expected) => {
    expect(normalizeModelVersion(value)).toBe(expected);
  });

  test('생성 스냅샷도 정규화된 값을 담는다', () => {
    expect(captureGenerationSettings({ modelVersion: '5-xyz' } as any).modelVersion).toBe(
      ModelVersion.V5,
    );
    expect(
      captureGenerationSettings({ modelVersion: ModelVersion.V5Medium } as any).modelVersion,
    ).toBe(ModelVersion.V5Medium);
  });

  test('config 에 모르는 값이 있어도 요청이 예외 없이 V5 Full 로 나간다', async () => {
    getConfig.mockResolvedValue({ modelVersion: '5-unknown', ucPreset: 'none' });
    const { service, fetchArrayBuffer } = makeService();
    const input = makeInput();
    delete input.generationSettings;
    await service.generateImage('t', input);
    expect(fetchArrayBuffer.mock.calls[0][1].model).toBe('nai-diffusion-5-full');
  });
});

describe('V5 Medium 요청 본문', () => {
  test('생성: 스텝·샘플러·UC(Heavy 만)·캐릭터 UC "" ·tag_hint 2·cfg_rescale 없음, 가이던스·시드·해상도는 그대로', async () => {
    const { service, fetchArrayBuffer } = makeService();
    await service.generateImage('t', makeInput());
    const [, body] = fetchArrayBuffer.mock.calls[0];
    const p = body.parameters;

    expect(body.model).toBe('nai-diffusion-5-full-medium');
    expect(body.action).toBe('generate');
    expect(body.use_new_shared_trial).toBe(true);
    expect(p).toMatchObject({
      params_version: 4,
      width: 832,
      height: 1216,
      noise_schedule: 'karras',
      scale: 6.5,
      sampler: 'k_euler_ancestral',
      steps: 14,
      seed: 777,
      n_samples: 1,
      prefer_brownian: true,
      deliberate_euler_ancestral_bug: false,
      tag_hint_uc_preset: 2,
      tag_hint_qt: 1,
      negative_prompt: V5_HEAVY,
    });
    expect(p).not.toHaveProperty('cfg_rescale');
    expect(p.negative_prompt).toBe(mergeUcPreset('', ModelVersion.V5, 'heavy'));
    expect(p.v4_negative_prompt.caption.base_caption).toBe(V5_HEAVY);
    // 사용자 UC(hat·작가 태그·공백 보정 대상)는 어디에도 없다
    expect(JSON.stringify(p)).not.toContain('hat, artist');
    expect(JSON.stringify(p)).not.toContain('9tag9');
    // 캐릭터 UC 는 모두 빈 문자열, 캐릭터 프롬프트·좌표는 유지
    expect(p.characterPrompts).toEqual([
      { prompt: 'boy', uc: '', center: { x: 0.3, y: 0.5 } },
      { prompt: 'cat', uc: '', center: { x: 0.7, y: 0.5 } },
    ]);
    expect(p.v4_negative_prompt.caption.char_captions).toEqual([
      { char_caption: '', centers: [{ x: 0.3, y: 0.5 }] },
      { char_caption: '', centers: [{ x: 0.7, y: 0.5 }] },
    ]);
    // 프롬프트 쪽 공백 보정·퀄리티 태그는 종전 V5 그대로
    expect(body.input).toBe('girl, 1.5:: 0aaa0 ::, very aesthetic, masterpiece, no text');
  });

  test('config 의 UC 프리셋(light 등)과 무관하게 Heavy 로 고정', async () => {
    const { service, fetchArrayBuffer } = makeService();
    const input = makeInput();
    input.generationSettings = snapshot(ModelVersion.V5Medium, 'none');
    await service.generateImage('t', input);
    const p = fetchArrayBuffer.mock.calls[0][1].parameters;
    expect(p.negative_prompt).toBe(V5_HEAVY);
    expect(p.tag_hint_uc_preset).toBe(2);
  });

  test('I2I: 같은 medium 모델 + img2img, 고정값 동일', async () => {
    const { service, fetchArrayBuffer } = makeService();
    const input = makeInput(Model.I2I);
    input.image = 'img';
    input.imageStrength = 0.6;
    input.noise = 0.1;
    await service.generateImage('t', input);
    const [, body] = fetchArrayBuffer.mock.calls[0];
    expect(body.model).toBe('nai-diffusion-5-full-medium');
    expect(body.action).toBe('img2img');
    expect(body.parameters).toMatchObject({ steps: 14, sampler: 'k_euler_ancestral', negative_prompt: V5_HEAVY });
    expect(body.parameters).not.toHaveProperty('cfg_rescale');
  });

  test('인페인트: -inpainting 모델 + infill, add_original_image 유지', async () => {
    const { service, fetchArrayBuffer } = makeService();
    const input = makeInput(Model.Inpaint);
    input.image = 'img';
    input.mask = 'mask';
    input.imageStrength = 1;
    input.originalImage = true;
    await service.generateImage('t', input);
    const [, body] = fetchArrayBuffer.mock.calls[0];
    expect(body.model).toBe('nai-diffusion-5-full-medium-inpainting');
    expect(body.action).toBe('infill');
    expect(body.parameters).toMatchObject({
      steps: 14,
      sampler: 'k_euler_ancestral',
      negative_prompt: V5_HEAVY,
      add_original_image: true,
    });
    expect(body.parameters).not.toHaveProperty('cfg_rescale');
  });

  test('V5 Full 은 종전대로 사용자 값·cfg_rescale 을 보낸다(회귀)', async () => {
    const { service, fetchArrayBuffer } = makeService();
    const input = makeInput();
    input.generationSettings = snapshot(ModelVersion.V5, 'none');
    await service.generateImage('t', input);
    const [, body] = fetchArrayBuffer.mock.calls[0];
    expect(body.model).toBe('nai-diffusion-5-full');
    expect(body.parameters).toMatchObject({
      steps: 40,
      sampler: 'k_dpmpp_2m',
      cfg_rescale: 0.4,
      tag_hint_uc_preset: 0,
    });
    expect(body.parameters.negative_prompt).toContain('hat, artist:someone');
    expect(body.parameters.characterPrompts[0].uc).toBe('bad hands');
  });
});

describe('공식 PNG Source 해시 판정·Heavy 문구 떼기', () => {
  test.each([
    ['NovelAI Diffusion V5 93F4BD30', ModelVersion.V5Medium],
    ['NovelAI Diffusion V5 70AB5786', ModelVersion.V5Medium],
    ['novelai diffusion v5 93f4bd30', ModelVersion.V5Medium],
    ['NovelAI Diffusion V5 657484A5', ModelVersion.V5],
    ['NovelAI Diffusion V5 0ADF9AB7', ModelVersion.V5],
    ['NovelAI Diffusion V5 DB276663', ModelVersion.V5Curated],
    ['NovelAI Diffusion V4.5 4BDE2A90', undefined],
    ['', undefined],
    [undefined, undefined],
    ['V5 A93F4BD30', undefined],
  ])('%p → %p', (source, expected) => {
    expect(modelVersionFromNaiSource(source)).toBe(expected);
  });

  test('stripUcPreset 는 앞의 Heavy 문구만 뗀다', () => {
    expect(stripUcPreset(V5_HEAVY, ModelVersion.V5Medium, 'heavy')).toBe('');
    expect(stripUcPreset(`${V5_HEAVY}, hat`, ModelVersion.V5Medium, 'heavy')).toBe('hat');
    expect(stripUcPreset('hat, lowres', ModelVersion.V5Medium, 'heavy')).toBe('hat, lowres');
  });
});

describe('가짜 서버 V5 Medium 차감', () => {
  test('모델 인식 — medium·medium-inpainting 만', () => {
    expect(mockServer.isV5MediumModel('nai-diffusion-5-full-medium')).toBe(true);
    expect(mockServer.isV5MediumModel('nai-diffusion-5-full-medium-inpainting')).toBe(true);
    expect(mockServer.isV5MediumModel('nai-diffusion-5-full')).toBe(false);
    expect(mockServer.isV5MediumModel('nai-diffusion-5-full-inpainting')).toBe(false);
  });

  test('High(23스텝) ÷ 1.75 — Anlas 올림·최소 2, 할당 % 소수 둘째 자리', () => {
    expect(mockServer.mediumAdjustedCost('nai-diffusion-5-full-medium', 26, 'anlas')).toBe(15);
    expect(mockServer.mediumAdjustedCost('nai-diffusion-5-full-medium', 20, 'anlas')).toBe(12);
    expect(mockServer.mediumAdjustedCost('nai-diffusion-5-full-medium', 1, 'anlas')).toBe(2);
    expect(mockServer.mediumAdjustedCost('nai-diffusion-5-full-medium-inpainting', 5, 'percent')).toBe(2.86);
    expect(mockServer.mediumAdjustedCost('nai-diffusion-5-full', 26, 'anlas')).toBe(26);
    expect(mockServer.mediumAdjustedCost('nai-diffusion-5-full-medium', 0, 'percent')).toBe(0);
  });
});
