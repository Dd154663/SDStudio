import {
  Model,
  ModelVersion,
  NoiseSchedule,
  Sampling,
} from '../../imageGen';
import {
  getNaiModelSpec,
  isOpusFreeEligible,
  isV5ModelVersion,
  normalizeNaiSampling,
  resolveNaiModelId,
  V5_SAMPLERS,
} from '../naiModelCapabilities';

describe('NAI 중앙 모델 스펙', () => {
  test.each([
    [ModelVersion.V4_5, Model.Anime, 'nai-diffusion-4-5-full'],
    [ModelVersion.V4_5, Model.Inpaint, 'nai-diffusion-4-5-full-inpainting'],
    [ModelVersion.V4_5Curated, Model.Anime, 'nai-diffusion-4-5-curated'],
    [
      ModelVersion.V4_5Curated,
      Model.Inpaint,
      'nai-diffusion-4-5-curated-inpainting',
    ],
    [ModelVersion.V4, Model.Anime, 'nai-diffusion-4-full'],
    [ModelVersion.V4, Model.Inpaint, 'nai-diffusion-4-full-inpainting'],
    [ModelVersion.V4Curated, Model.Anime, 'nai-diffusion-4-curated-preview'],
    [
      ModelVersion.V4Curated,
      Model.Inpaint,
      'nai-diffusion-4-curated-inpainting',
    ],
    [ModelVersion.V5, Model.Anime, 'nai-diffusion-5-full'],
    [ModelVersion.V5, Model.I2I, 'nai-diffusion-5-full'],
    [ModelVersion.V5, Model.Inpaint, 'nai-diffusion-5-full-inpainting'],
    [ModelVersion.V5Curated, Model.Anime, 'nai-diffusion-5-curated'],
    [
      ModelVersion.V5Curated,
      Model.Inpaint,
      'nai-diffusion-4-5-curated-inpainting',
    ],
  ])('%s + %s 모델 ID를 명시적으로 해석한다', (version, model, expected) => {
    expect(resolveNaiModelId(model, version)).toBe(expected);
  });

  test('V5 능력과 Curated 인페인트 폴백을 중앙에서 제공한다', () => {
    const full = getNaiModelSpec(ModelVersion.V5);
    const curated = getNaiModelSpec(ModelVersion.V5Curated);

    expect(full.capabilities).toMatchObject({
      paramsVersion: 4,
      maxPromptGuidance: 10,
      maxSteps: 50,
      maxCharacterPrompts: 32,
      promptTokenLimit: 1471,
      supportsVibeTransfer: false,
      supportsCharacterReference: false,
      supportsVarietyPlus: false,
      supportsTransparentBackground: true,
      forcedNoiseSchedule: NoiseSchedule.Karras,
    });
    expect(curated.inpaintFallbackVersion).toBe(ModelVersion.V4_5Curated);
    expect(curated.capabilities.promptTokenLimit).toBe(703);
    expect(curated.capabilities.supportedSamplers).toEqual(V5_SAMPLERS);
  });

  test('V5에서 DDIM만 Euler Ancestral로 정규화하고 구 모델은 유지한다', () => {
    expect(normalizeNaiSampling(ModelVersion.V5, Sampling.DDIM)).toBe(
      Sampling.KEulerAncestral,
    );
    expect(normalizeNaiSampling(ModelVersion.V5, Sampling.KEuler)).toBe(
      Sampling.KEuler,
    );
    expect(normalizeNaiSampling(ModelVersion.V4_5, Sampling.DDIM)).toBe(
      Sampling.DDIM,
    );
  });

  test('Opus 무료 대상 조건을 실제 요청값으로 판정한다', () => {
    const base = {
      version: ModelVersion.V5,
      width: 832,
      height: 1216,
      steps: 28,
      hasCharacterReference: false,
    };

    expect(isOpusFreeEligible(base)).toBe(true);
    expect(isOpusFreeEligible({ ...base, steps: 29 })).toBe(false);
    expect(isOpusFreeEligible({ ...base, width: 1024, height: 1216 })).toBe(
      false,
    );
    expect(isOpusFreeEligible({ ...base, hasCharacterReference: true })).toBe(
      false,
    );
    expect(
      isOpusFreeEligible({ ...base, version: ModelVersion.V4_5 }),
    ).toBe(false);
    expect(isV5ModelVersion(ModelVersion.V5Curated)).toBe(true);
  });
});
