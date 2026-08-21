import {
  Model,
  ModelVersion,
  NoiseSchedule,
  Sampling,
} from '../imageGen';

export interface NaiModelCapabilities {
  paramsVersion: 3 | 4;
  supportedSamplers: readonly Sampling[];
  maxPromptGuidance?: number;
  maxSteps?: number;
  maxCharacterPrompts?: number;
  promptTokenLimit?: number;
  supportsVibeTransfer: boolean;
  supportsCharacterReference: boolean;
  supportsVarietyPlus: boolean;
  supportsTransparentBackground: boolean;
  forcedNoiseSchedule?: NoiseSchedule;
}

export interface NaiModelSpec {
  version: ModelVersion;
  generationModelId: string;
  inpaintModelId: string;
  inpaintFallbackVersion?: ModelVersion;
  capabilities: NaiModelCapabilities;
}

const LEGACY_SAMPLERS: readonly Sampling[] = [
  Sampling.KEulerAncestral,
  Sampling.KEuler,
  Sampling.KDPMPP2SAncestral,
  Sampling.KDPMPP2M,
  Sampling.KDPMPPSDE,
  Sampling.KDPMPP2MSDE,
  Sampling.DDIM,
];

export const V5_SAMPLERS: readonly Sampling[] = [
  Sampling.KEulerAncestral,
  Sampling.KEuler,
  Sampling.KDPMPP2SAncestral,
  Sampling.KDPMPP2MSDE,
  Sampling.KDPMPP2M,
  Sampling.KDPMPPSDE,
];

const legacyCapabilities = (): NaiModelCapabilities => ({
  paramsVersion: 3,
  supportedSamplers: LEGACY_SAMPLERS,
  supportsVibeTransfer: true,
  supportsCharacterReference: true,
  supportsVarietyPlus: true,
  supportsTransparentBackground: false,
});

const v5Capabilities = (
  promptTokenLimit: number,
): NaiModelCapabilities => ({
  paramsVersion: 4,
  supportedSamplers: V5_SAMPLERS,
  maxPromptGuidance: 10,
  maxSteps: 50,
  maxCharacterPrompts: 32,
  promptTokenLimit,
  supportsVibeTransfer: false,
  supportsCharacterReference: false,
  supportsVarietyPlus: false,
  supportsTransparentBackground: true,
  forcedNoiseSchedule: NoiseSchedule.Karras,
});

export const NAI_MODEL_SPECS: Readonly<Record<ModelVersion, NaiModelSpec>> = {
  [ModelVersion.V5]: {
    version: ModelVersion.V5,
    generationModelId: 'nai-diffusion-5-full',
    inpaintModelId: 'nai-diffusion-5-full-inpainting',
    capabilities: v5Capabilities(1471),
  },
  [ModelVersion.V5Curated]: {
    version: ModelVersion.V5Curated,
    generationModelId: 'nai-diffusion-5-curated',
    inpaintModelId: 'nai-diffusion-4-5-curated-inpainting',
    inpaintFallbackVersion: ModelVersion.V4_5Curated,
    capabilities: v5Capabilities(703),
  },
  [ModelVersion.V4_5]: {
    version: ModelVersion.V4_5,
    generationModelId: 'nai-diffusion-4-5-full',
    inpaintModelId: 'nai-diffusion-4-5-full-inpainting',
    capabilities: legacyCapabilities(),
  },
  [ModelVersion.V4_5Curated]: {
    version: ModelVersion.V4_5Curated,
    generationModelId: 'nai-diffusion-4-5-curated',
    inpaintModelId: 'nai-diffusion-4-5-curated-inpainting',
    capabilities: legacyCapabilities(),
  },
  [ModelVersion.V4]: {
    version: ModelVersion.V4,
    generationModelId: 'nai-diffusion-4-full',
    inpaintModelId: 'nai-diffusion-4-full-inpainting',
    capabilities: legacyCapabilities(),
  },
  [ModelVersion.V4Curated]: {
    version: ModelVersion.V4Curated,
    generationModelId: 'nai-diffusion-4-curated-preview',
    inpaintModelId: 'nai-diffusion-4-curated-inpainting',
    capabilities: legacyCapabilities(),
  },
};

export function getNaiModelSpec(version: ModelVersion): NaiModelSpec {
  const spec = NAI_MODEL_SPECS[version];
  if (!spec) throw new Error(`지원하지 않는 NAI 모델 버전: ${version}`);
  return spec;
}

export function resolveNaiModelId(
  model: Model,
  version: ModelVersion,
): string {
  const spec = getNaiModelSpec(version);
  return model === Model.Inpaint
    ? spec.inpaintModelId
    : spec.generationModelId;
}

export function isV5ModelVersion(version: ModelVersion): boolean {
  return version === ModelVersion.V5 || version === ModelVersion.V5Curated;
}

export function normalizeNaiSampling(
  version: ModelVersion,
  sampling: Sampling,
): Sampling {
  const supported = getNaiModelSpec(version).capabilities.supportedSamplers;
  return supported.includes(sampling) ? sampling : Sampling.KEulerAncestral;
}

export interface OpusFreeEligibilityInput {
  version: ModelVersion;
  width: number;
  height: number;
  steps: number;
  hasCharacterReference: boolean;
}

export function isOpusFreeEligible({
  version,
  width,
  height,
  steps,
  hasCharacterReference,
}: OpusFreeEligibilityInput): boolean {
  return (
    isV5ModelVersion(version) &&
    !hasCharacterReference &&
    width * height <= 1_048_576 &&
    steps <= 28
  );
}
