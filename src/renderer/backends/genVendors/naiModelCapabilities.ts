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
  /** 캐릭터(정밀) 레퍼런스 — 화면 잠금·작업 조립·요청·비용 판정이 모두 이 값을 읽는다(2026-11-25). */
  supportsCharacterReference: boolean;
  /** 레퍼런스 Fidelity(secondary strength) 지원 — 없으면 secondary 는 항상 0, 화면에서 Fidelity 줄을 숨긴다. */
  referenceFidelity: boolean;
  /** 레퍼런스 Strength 상한. */
  referenceStrengthMax: number;
  /** 레퍼런스 종류 「의상(costume)」·「같은 의상 선호」 지원. */
  supportsOutfitReference: boolean;
  /** 보낼 때 레퍼런스 이미지 손질 — 'letterbox' = 저장된 검정 여백 그대로, 'bucket' = 여백을 잘라 V5 크기 표에 맞춤. */
  referencePreprocess: 'letterbox' | 'bucket';
  /** 인페인트(infill) 요청에도 레퍼런스를 실을 수 있는가. */
  supportsReferenceWithInpaint: boolean;
  supportsVarietyPlus: boolean;
  supportsTransparentBackground: boolean;
  forcedNoiseSchedule?: NoiseSchedule;
  /** false = 요청에 cfg_rescale 키 자체를 넣지 않는다(V5 Medium). 없음 = 지원(종전). */
  supportsCfgRescale?: boolean;
}

/**
 * 송신 직전에 고정되는 값(공식 웹 `fixedSettings` 와 같음 — V5 Medium). 있으면 사용자 스텝·샘플러·UC 프리셋 대신
 * 이 값을 보내고, UC 는 사용자 네거티브를 버리고 프리셋 문구만, 캐릭터 UC 는 모두 빈 문자열.
 */
export interface NaiFixedSettings {
  steps: number;
  sampler: Sampling;
  ucPreset: 'heavy';
}

export interface NaiModelSpec {
  version: ModelVersion;
  generationModelId: string;
  inpaintModelId: string;
  inpaintFallbackVersion?: ModelVersion;
  capabilities: NaiModelCapabilities;
  fixedSettings?: NaiFixedSettings;
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

const legacyCapabilities = (
  supportsCharacterReference: boolean,
): NaiModelCapabilities => ({
  paramsVersion: 3,
  supportedSamplers: LEGACY_SAMPLERS,
  supportsVibeTransfer: true,
  // V4·V4 Curated 는 정밀 레퍼런스 미지원(종전에도 작업 조립에서 버렸다 — 표를 사실에 맞춤).
  supportsCharacterReference,
  referenceFidelity: true,
  // 공식 웹의 V4.5 상한은 1 이지만 이 앱 슬라이더의 기존 범위(2)를 이번에는 바꾸지 않는다.
  referenceStrengthMax: 2,
  supportsOutfitReference: false,
  referencePreprocess: 'letterbox',
  supportsReferenceWithInpaint: true,
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
  // 공식 웹과 같게 V5 Full(High)·Curated 에서 정밀 레퍼런스를 연다(Medium 은 아래에서 끈다).
  supportsCharacterReference: true,
  referenceFidelity: false,
  referenceStrengthMax: 5,
  supportsOutfitReference: true,
  referencePreprocess: 'bucket',
  supportsReferenceWithInpaint: false,
  supportsVarietyPlus: false,
  supportsTransparentBackground: true,
  forcedNoiseSchedule: NoiseSchedule.Karras,
});

/** V5 Medium 고정값 — 공식 웹 번들 `fixedSettings:{steps:14, sampler:"k_euler_ancestral", ucPresetId:"heavy"}`. */
export const V5_MEDIUM_FIXED_SETTINGS: Readonly<NaiFixedSettings> = Object.freeze({
  steps: 14,
  sampler: Sampling.KEulerAncestral,
  ucPreset: 'heavy',
});

export const NAI_MODEL_SPECS: Readonly<Record<ModelVersion, NaiModelSpec>> = {
  [ModelVersion.V5]: {
    version: ModelVersion.V5,
    generationModelId: 'nai-diffusion-5-full',
    inpaintModelId: 'nai-diffusion-5-full-inpainting',
    capabilities: v5Capabilities(1471),
  },
  // V5 Full Medium Effort(2026-11-06, 공식 웹 2026-10-08 출시): effort 는 요청 필드가 아니라 모델 ID 교체.
  // 생성·I2I = 같은 모델(action 만 img2img), 인페인트 = -inpainting. 능력은 V5 Full 과 같고 CFG Rescale 만 없음.
  [ModelVersion.V5Medium]: {
    version: ModelVersion.V5Medium,
    generationModelId: 'nai-diffusion-5-full-medium',
    inpaintModelId: 'nai-diffusion-5-full-medium-inpainting',
    // 공식 웹도 「Precise Reference needs High effort」 로 막는다 — 레퍼런스만 끄고 나머지는 물려받는다.
    capabilities: {
      ...v5Capabilities(1471),
      supportsCfgRescale: false,
      supportsCharacterReference: false,
    },
    fixedSettings: V5_MEDIUM_FIXED_SETTINGS,
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
    capabilities: legacyCapabilities(true),
  },
  [ModelVersion.V4_5Curated]: {
    version: ModelVersion.V4_5Curated,
    generationModelId: 'nai-diffusion-4-5-curated',
    inpaintModelId: 'nai-diffusion-4-5-curated-inpainting',
    capabilities: legacyCapabilities(true),
  },
  [ModelVersion.V4]: {
    version: ModelVersion.V4,
    generationModelId: 'nai-diffusion-4-full',
    inpaintModelId: 'nai-diffusion-4-full-inpainting',
    capabilities: legacyCapabilities(false),
  },
  [ModelVersion.V4Curated]: {
    version: ModelVersion.V4Curated,
    generationModelId: 'nai-diffusion-4-curated-preview',
    inpaintModelId: 'nai-diffusion-4-curated-inpainting',
    capabilities: legacyCapabilities(false),
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

export function isV5ModelVersion(version: ModelVersion | undefined): boolean {
  return (
    version === ModelVersion.V5 ||
    version === ModelVersion.V5Medium ||
    version === ModelVersion.V5Curated
  );
}

/** 모델 능력(모르는 값·없음은 normalizeModelVersion 과 같은 폴백). */
export function naiCapabilitiesOf(version: unknown): NaiModelCapabilities {
  return getNaiModelSpec(normalizeModelVersion(version)).capabilities;
}

/** 캐릭터 레퍼런스 잠금 사유 — 'v4' = V4·V4 Curated, 'v5-medium' = V5 Medium, undefined = 지원. */
export function naiReferenceBlockReason(
  version: unknown,
): 'v4' | 'v5-medium' | undefined {
  const v = normalizeModelVersion(version);
  if (getNaiModelSpec(v).capabilities.supportsCharacterReference) return undefined;
  return v === ModelVersion.V5Medium ? 'v5-medium' : 'v4';
}

const KNOWN_MODEL_VERSIONS: ReadonlySet<string> = new Set(Object.values(ModelVersion));

export function isKnownModelVersion(value: unknown): value is ModelVersion {
  return typeof value === 'string' && KNOWN_MODEL_VERSIONS.has(value);
}

/**
 * 저장된 modelVersion(config·생성 스냅샷·이미지 메타) 정규화 — 전진 호환(2026-11-06).
 * 없음 = V4.5 Full(종전 기본). 모르는 값(앞으로 생길 모델을 고른 뒤 이 버전으로 롤백 등)은 같은 세대로 폴백:
 * '5' 로 시작하면 V5 Full, 그 밖은 V4.5 Full. 예전에는 getNaiModelSpec 이 예외를 던져 생성이 멈췄다.
 */
export function normalizeModelVersion(value: unknown): ModelVersion {
  if (isKnownModelVersion(value)) return value;
  if (typeof value === 'string' && value.startsWith('5')) return ModelVersion.V5;
  return ModelVersion.V4_5;
}

/** 이 모델의 송신 고정값(V5 Medium 만). */
export function naiFixedSettings(version: ModelVersion | undefined): NaiFixedSettings | undefined {
  const spec = version ? NAI_MODEL_SPECS[version] : undefined;
  return spec?.fixedSettings;
}

/** 실제로 보낼 스텝 수 — 고정값이 있으면 그 값, 없으면 모델 상한까지 자른 사용자 값(요청 조립·무료 판정·비용 안내 공용). */
export function effectiveNaiSteps(version: ModelVersion | undefined, steps: number): number {
  const fixed = naiFixedSettings(version);
  if (fixed) return fixed.steps;
  const spec = version ? NAI_MODEL_SPECS[version] : undefined;
  const max = spec?.capabilities.maxSteps;
  return max !== undefined ? Math.min(steps, max) : steps;
}

/**
 * 공식 웹 PNG 메타 `Source`(「NovelAI Diffusion V5 <해시>」)의 모델 해시 → 모델(2026-11-06, 공식 웹 번들 판정 함수와 같은 표).
 * 해시는 대문자 8자리. 같은 해시가 생성용·인페인트용 두 개인 모델도 있다(Medium: 93F4BD30·70AB5786).
 */
export const NAI_SOURCE_MODEL_HASHES: Readonly<Record<string, ModelVersion>> = Object.freeze({
  '657484A5': ModelVersion.V5,
  '0ADF9AB7': ModelVersion.V5,
  '93F4BD30': ModelVersion.V5Medium,
  '70AB5786': ModelVersion.V5Medium,
  DB276663: ModelVersion.V5Curated,
});

/** `Source` 문자열(또는 model_name·model_hash 를 합친 문자열)에서 알려진 모델 해시를 찾는다. 없으면 undefined. */
export function modelVersionFromNaiSource(source: string | undefined | null): ModelVersion | undefined {
  const text = (source ?? '').toUpperCase();
  if (!text) return undefined;
  for (const [hash, version] of Object.entries(NAI_SOURCE_MODEL_HASHES)) {
    if (new RegExp(`(^|[^0-9A-F])${hash}($|[^0-9A-F])`).test(text)) return version;
  }
  return undefined;
}

export function normalizeNaiSampling(
  version: ModelVersion,
  sampling: Sampling,
): Sampling {
  const supported = getNaiModelSpec(version).capabilities.supportedSamplers;
  return supported.includes(sampling) ? sampling : Sampling.KEulerAncestral;
}

/** Opus 무료 생성 픽셀 상한(1MP = 1024×1024) — 무료 판정·미러 캔버스 축소·인페인트 해상도 안내 공용. */
export const NAI_FREE_PIXEL_LIMIT = 1_048_576;

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
    width * height <= NAI_FREE_PIXEL_LIMIT &&
    steps <= 28
  );
}
