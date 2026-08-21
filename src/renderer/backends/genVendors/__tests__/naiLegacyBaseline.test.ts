const getConfig = jest.fn();

jest.mock('../../../models', () => ({
  backend: {
    getConfig,
  },
}));

import JSZip from 'jszip';
import {
  ImageGenInput,
  Model,
  ModelVersion,
  NoiseSchedule,
  Sampling,
} from '../../imageGen';
import {
  NovelAiFetcher,
  NovelAiImageGenService,
} from '../nai';

const jsonValue = (value: unknown) => JSON.parse(JSON.stringify(value));

async function makeZipResponse(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file('image_0.png', new Uint8Array([137, 80, 78, 71]));
  return zip.generateAsync({ type: 'arraybuffer' });
}

function makeInput(): ImageGenInput {
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
    legacyPromptConditioning: false,
    normalizeStrength: false,
    originalImage: false,
  };
}

function makeService() {
  const fetchArrayBuffer = jest.fn(
    async (_url: string, _body: any, _headers: any) => makeZipResponse(),
  );
  const fetcher: NovelAiFetcher = { fetchArrayBuffer };
  return {
    service: new NovelAiImageGenService(fetcher),
    fetchArrayBuffer,
  };
}

beforeEach(() => {
  getConfig.mockReset();
});

describe('NovelAI V5 도입 전 V4.5 요청 기준선', () => {
  test('V4.5 Full 기본 요청의 모델·필드·값을 유지한다', async () => {
    getConfig.mockResolvedValue({
      modelVersion: ModelVersion.V4_5,
      disableQuality: true,
      ucPreset: 'none',
    });
    const { service, fetchArrayBuffer } = makeService();

    await service.generateImage('test-token', makeInput());

    expect(fetchArrayBuffer).toHaveBeenCalledTimes(1);
    const [url, body, headers] = fetchArrayBuffer.mock.calls[0];
    expect(url).toBe('https://image.novelai.net/ai/generate-image');
    expect(headers).toEqual({
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json',
    });
    expect(jsonValue(body)).toEqual({
      input: 'base prompt',
      model: 'nai-diffusion-4-5-full',
      action: 'generate',
      parameters: {
        params_version: 3,
        width: 832,
        height: 1216,
        noise_schedule: 'native',
        controlnet_strength: 1,
        dynamic_thresholding: false,
        scale: 7,
        sampler: 'k_euler',
        steps: 23,
        seed: 123,
        n_samples: 1,
        ucPreset: 4,
        negative_prompt: 'base uc',
        qualityToggle: false,
        characterPrompts: [],
        use_coords: false,
        legacy: false,
        legacy_v3_extend: false,
        prefer_brownian: true,
        autoSmea: false,
        legacy_uc: false,
        cfg_rescale: 0,
        add_original_image: false,
        normalize_reference_strength_multiple: false,
        skip_cfg_above_sigma: null,
        v4_prompt: {
          caption: {
            base_caption: 'base prompt',
            char_captions: [],
          },
          use_coords: false,
          use_order: true,
        },
        v4_negative_prompt: {
          caption: {
            base_caption: 'base uc',
            char_captions: [],
          },
          legacy_uc: false,
        },
      },
    });
  });

  test('V4.5 Curated 모델 ID를 유지한다', async () => {
    getConfig.mockResolvedValue({
      modelVersion: ModelVersion.V4_5Curated,
      disableQuality: true,
      ucPreset: 'none',
    });
    const { service, fetchArrayBuffer } = makeService();

    await service.generateImage('test-token', makeInput());

    const [, body] = fetchArrayBuffer.mock.calls[0];
    expect(body.model).toBe('nai-diffusion-4-5-curated');
    expect(body.parameters.params_version).toBe(3);
  });

  test('예약 스냅샷이 있으면 실행 시점 config 변경보다 우선한다', async () => {
    getConfig.mockResolvedValue({
      modelVersion: ModelVersion.V5,
      disableQuality: false,
      ucPreset: 'heavy',
    });
    const { service, fetchArrayBuffer } = makeService();
    const input = makeInput();
    input.generationSettings = {
      schemaVersion: 1,
      modelVersion: ModelVersion.V4_5Curated,
      furryMode: false,
      disableQuality: true,
      ucPreset: 'none',
      autoConvertWebp: false,
      autoConvertWebpQuality: 80,
    };

    await service.generateImage('test-token', input);

    const [, body] = fetchArrayBuffer.mock.calls[0];
    expect(body.model).toBe('nai-diffusion-4-5-curated');
    expect(body.input).toBe('base prompt');
    expect(body.parameters.negative_prompt).toBe('base uc');
    expect(getConfig).not.toHaveBeenCalled();
  });
});

describe('NovelAI V5 최소 요청', () => {
  test('V5 Full은 params 4와 할당량 플래그를 쓰고 미지원 필드를 보내지 않는다', async () => {
    const { service, fetchArrayBuffer } = makeService();
    const input = makeInput();
    input.sampling = Sampling.DDIM;
    input.steps = 80;
    input.promptGuidance = 15;
    input.varietyPlus = true;
    input.vibes = [{ image: 'vibe', info: 1, strength: 0.5 }];
    input.characterReferences = [
      {
        image: 'ref',
        info: 1,
        strength: 0.6,
        fidelity: 1,
        description: 'character',
        referenceType: 'character',
      },
    ];
    input.generationSettings = {
      schemaVersion: 1,
      modelVersion: ModelVersion.V5,
      furryMode: false,
      disableQuality: true,
      ucPreset: 'none',
      autoConvertWebp: false,
      autoConvertWebpQuality: 80,
    };

    await service.generateImage('test-token', input);

    const [, body] = fetchArrayBuffer.mock.calls[0];
    expect(body).toMatchObject({
      model: 'nai-diffusion-5-full',
      action: 'generate',
      use_new_shared_trial: true,
      parameters: {
        params_version: 4,
        noise_schedule: 'karras',
        sampler: 'k_euler_ancestral',
        steps: 50,
        scale: 10,
        deliberate_euler_ancestral_bug: false,
      },
    });
    expect(body.parameters).not.toHaveProperty('reference_image_multiple');
    expect(body.parameters).not.toHaveProperty('director_reference_images');
    expect(body.parameters).not.toHaveProperty('controlnet_strength');
    expect(body.parameters).not.toHaveProperty('dynamic_thresholding');
    expect(body.parameters).not.toHaveProperty('autoSmea');
    expect(body.parameters).not.toHaveProperty('legacy_uc');
    expect(body.parameters).not.toHaveProperty('legacy_v3_extend');
  });

  test('V5 Curated 인페인트는 명시된 V4.5 Curated 모델로 폴백한다', async () => {
    const { service, fetchArrayBuffer } = makeService();
    const input = makeInput();
    input.model = Model.Inpaint;
    input.image = 'image';
    input.mask = 'mask';
    input.imageStrength = 0.7;
    input.generationSettings = {
      schemaVersion: 1,
      modelVersion: ModelVersion.V5Curated,
      furryMode: false,
      disableQuality: true,
      ucPreset: 'none',
      autoConvertWebp: false,
      autoConvertWebpQuality: 80,
    };

    await service.generateImage('test-token', input);

    const [, body] = fetchArrayBuffer.mock.calls[0];
    expect(body.model).toBe('nai-diffusion-4-5-curated-inpainting');
    expect(body.action).toBe('infill');
    expect(body.parameters.params_version).toBe(4);
  });

  test('V5 Full 인페인트는 전용 V5 모델을 사용한다', async () => {
    const { service, fetchArrayBuffer } = makeService();
    const input = makeInput();
    input.model = Model.Inpaint;
    input.image = 'image';
    input.mask = 'mask';
    input.generationSettings = {
      schemaVersion: 1,
      modelVersion: ModelVersion.V5,
      furryMode: false,
      disableQuality: false,
      qualityPreset: 'standard',
      ucPreset: 'none',
      transparentBackground: false,
      autoConvertWebp: false,
      autoConvertWebpQuality: 80,
    };

    await service.generateImage('test-token', input);

    const [, body] = fetchArrayBuffer.mock.calls[0];
    expect(body.model).toBe('nai-diffusion-5-full-inpainting');
  });

  test('V5 Light·UC 힌트·투명 배경을 공식 요청 형태로 보낸다', async () => {
    const { service, fetchArrayBuffer } = makeService();
    const input = makeInput();
    input.generationSettings = {
      schemaVersion: 1,
      modelVersion: ModelVersion.V5,
      furryMode: false,
      disableQuality: false,
      qualityPreset: 'light',
      ucPreset: 'humanFocus',
      transparentBackground: true,
      autoConvertWebp: false,
      autoConvertWebpQuality: 80,
    };

    await service.generateImage('test-token', input);

    const [, body] = fetchArrayBuffer.mock.calls[0];
    expect(body.input).toBe(
      'transparent background, base prompt, very aesthetic, amazing quality, no text',
    );
    expect(body.parameters).toMatchObject({
      tag_hint_qt: 3,
      tag_hint_uc_preset: 4,
      tag_hint_transparent_background: true,
    });
    expect(body.parameters.negative_prompt).toContain('mismatched pupils');
    expect(body.parameters).not.toHaveProperty('qualityToggle');
    expect(body.parameters).not.toHaveProperty('ucPreset');
    expect(body.parameters).not.toHaveProperty('straight_alpha');
  });

  test('빈 캐릭터는 제외하고 원래 좌표 정렬을 유지하며 32개로 제한한다', async () => {
    const { service, fetchArrayBuffer } = makeService();
    const input = makeInput();
    input.useCoords = true;
    input.characterPrompts = [' ', ...Array.from({ length: 35 }, (_, i) => `c${i}`)];
    input.characterUCs = ['empty', ...Array.from({ length: 35 }, (_, i) => `u${i}`)];
    input.characterPositions = [
      { x: 0, y: 0 },
      ...Array.from({ length: 35 }, (_, i) => ({ x: i / 100, y: 0.5 })),
    ];
    input.generationSettings = {
      schemaVersion: 1,
      modelVersion: ModelVersion.V5Curated,
      furryMode: false,
      disableQuality: true,
      ucPreset: 'none',
      autoConvertWebp: false,
      autoConvertWebpQuality: 80,
    };

    await service.generateImage('test-token', input);

    const [, body] = fetchArrayBuffer.mock.calls[0];
    expect(body.parameters.characterPrompts).toHaveLength(32);
    expect(body.parameters.characterPrompts[0]).toEqual({
      prompt: 'c0',
      uc: 'u0',
      center: { x: 0, y: 0.5 },
    });
    expect(body.parameters.v4_prompt.caption.char_captions).toHaveLength(32);
    expect(body.parameters.v4_negative_prompt.caption.char_captions).toHaveLength(32);
  });
});

describe('NovelAI Opus 사용량 조회', () => {
  test('user/data의 subscription.usage를 Opus 잔량으로 읽는다', async () => {
    const originalFetch = (global as any).fetch;
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        subscription: {
          usage: {
            percent: 88,
            isNegative: false,
            timeUntilNextPercent: 123,
          },
        },
      }),
    } as Response);
    (global as any).fetch = fetchMock;
    const { service } = makeService();

    await expect(service.getOpusUsageStatus('test-token')).resolves.toEqual({
      percent: 88,
      isNegative: false,
      timeUntilNextPercent: 123,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://image.novelai.net/user/data',
      expect.objectContaining({ method: 'GET' }),
    );
    (global as any).fetch = originalFetch;
  });

  test('usage가 없으면 가짜 0퍼센트 대신 조회 실패로 처리한다', async () => {
    const originalFetch = (global as any).fetch;
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ subscription: {} }),
    } as Response);
    const { service } = makeService();

    await expect(service.getOpusUsageStatus('test-token')).rejects.toThrow(
      'Opus usage data is unavailable',
    );
    (global as any).fetch = originalFetch;
  });
});
