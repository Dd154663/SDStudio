jest.mock('..', () => ({ workFlowService: {} }));

import { samplingFamilyForModelId } from '../modelSamplingProfiles';

describe('모델 id → 계열 (작가 라이브러리 샘플 자동 판정, 2026-09-26)', () => {
  it('nai-diffusion-5-* 는 v5, nai-diffusion-4-5-* 는 v4_5', () => {
    expect(samplingFamilyForModelId('nai-diffusion-5-full')).toBe('v5');
    expect(samplingFamilyForModelId('nai-diffusion-5-curated')).toBe('v5');
    expect(samplingFamilyForModelId('nai-diffusion-5-full-inpainting')).toBe('v5');
    expect(samplingFamilyForModelId('nai-diffusion-4-5-full')).toBe('v4_5');
    expect(samplingFamilyForModelId('NAI-Diffusion-4-5-Curated')).toBe('v4_5');
  });
  it('모르는 id·빈 값은 undefined', () => {
    expect(samplingFamilyForModelId('nai-diffusion-4-full')).toBeUndefined();
    expect(samplingFamilyForModelId('nai-diffusion-3')).toBeUndefined();
    expect(samplingFamilyForModelId('')).toBeUndefined();
    expect(samplingFamilyForModelId(undefined)).toBeUndefined();
  });
});
