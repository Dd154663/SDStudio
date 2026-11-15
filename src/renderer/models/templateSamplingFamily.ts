import { ModelVersion, NoiseSchedule, Sampling } from '../backends/imageGen';
import {
  NAI_MODEL_SPECS,
  naiFixedSettings,
} from '../backends/genVendors/naiModelCapabilities';
import {
  MODEL_SAMPLING_FIELDS,
  ModelSamplingFamily,
  isModelSamplingFamily,
  modelVersionForSamplingFamily,
  normalizeSamplingProfiles,
  samplingFamilyForModel,
  setPresetSamplingField,
} from './modelSamplingProfiles';

/**
 * 템플릿 편집기 샘플링 칸의 모델 계열 선택(2026-11-15 B안).
 *
 * 템플릿 프리셋도 사전 세팅과 같은 저장 형식(겉 필드 = 미러 계열 값 + `samplingProfiles` 3벌 + `samplingProfileFamily`)을 쓴다.
 * 알약은 「이 템플릿에서 어느 계열 값을 고칠지」만 고르고 앱의 모델(config.modelVersion)은 바꾸지 않는다.
 * 새 저장 필드는 없다 — 새 프로젝트 생성 경로(presetFromJSON → 사전 세팅 편집기의 계열 활성화)는 그대로다.
 */

/** 템플릿 편집기가 그리는 샘플링 칸 5개. */
export const TEMPLATE_SAMPLING_FIELDS = [
  'steps',
  'promptGuidance',
  'cfgRescale',
  'sampling',
  'noiseSchedule',
] as const;
export type TemplateSamplingField = (typeof TEMPLATE_SAMPLING_FIELDS)[number];

/** 값이 하나도 없을 때의 종전 표시 기본값(편집기 종전 동작과 같음). */
export const TEMPLATE_SAMPLING_DEFAULTS: Readonly<
  Record<TemplateSamplingField, number | string>
> = {
  steps: 28,
  promptGuidance: 5,
  cfgRescale: 0,
  sampling: Sampling.KEulerAncestral,
  noiseSchedule: NoiseSchedule.Karras,
};

export const TEMPLATE_SAMPLING_TEXT = {
  familyHelp:
    '새 프로젝트는 그때 선택된 모델 계열의 값으로 시작합니다. 알약은 이 템플릿에서 어느 계열 값을 고칠지만 바꾸고 앱의 모델은 바꾸지 않습니다.',
  noiseScheduleForced: (value: string) => `V5 계열에서는 ${value} 로 고정됩니다`,
} as const;

/** 초기 계열 — 템플릿의 미러 계열 → 현재 앱 모델 계열 → 4.5. */
export function initialTemplateSamplingFamily(
  preset: any,
  globalModel?: ModelVersion,
): ModelSamplingFamily {
  if (isModelSamplingFamily(preset?.samplingProfileFamily)) {
    return preset.samplingProfileFamily;
  }
  return samplingFamilyForModel(globalModel) ?? 'v4_5';
}

const validValue = (field: TemplateSamplingField, v: unknown) =>
  typeof v === typeof TEMPLATE_SAMPLING_DEFAULTS[field];

/**
 * 표시 값 — 미러 계열(또는 프로필이 없으면)은 겉 필드가 진실, 그 밖의 계열은 그 계열 프로필 값.
 * 프로필에 값이 없으면 겉 필드, 그것도 없으면 종전 기본값.
 */
export function readTemplateSamplingValue(
  preset: any,
  family: ModelSamplingFamily,
  field: TemplateSamplingField,
): number | string {
  const outer = preset?.[field];
  const profiles = normalizeSamplingProfiles(preset?.samplingProfiles);
  const mirror = isModelSamplingFamily(preset?.samplingProfileFamily)
    ? preset.samplingProfileFamily
    : undefined;
  if (profiles && mirror !== family) {
    const v = profiles[family][field];
    if (validValue(field, v)) return v as number | string;
  }
  if (validValue(field, outer)) return outer;
  return TEMPLATE_SAMPLING_DEFAULTS[field];
}

/**
 * 한 칸 변경 → patchPreset 인자. 프리셋을 깊은 복제해 그 계열을 활성화한 뒤 값을 기록하고,
 * 얕은 병합(patchPreset)에 맞춰 `samplingProfiles`·`samplingProfileFamily`·겉 샘플링 필드를 함께 돌려준다.
 * 겉 필드가 비어 있으면(빈 골격) 종전 기본값으로 먼저 채운다 — 계열 활성화가 겉 필드를 전제하기 때문.
 */
export function buildTemplateSamplingPatch(
  preset: any,
  family: ModelSamplingFamily,
  field: TemplateSamplingField,
  value: number | string,
): Record<string, any> {
  const clone: any = preset ? JSON.parse(JSON.stringify(preset)) : {};
  for (const f of TEMPLATE_SAMPLING_FIELDS) {
    if (!validValue(f, clone[f])) clone[f] = TEMPLATE_SAMPLING_DEFAULTS[f];
  }
  setPresetSamplingField(clone, family, field, value);
  const patch: Record<string, any> = {
    samplingProfiles: clone.samplingProfiles,
    samplingProfileFamily: clone.samplingProfileFamily,
  };
  for (const f of MODEL_SAMPLING_FIELDS) {
    if (f in clone) patch[f] = clone[f];
  }
  return patch;
}

export interface TemplateSamplingLocks {
  /** V5M 고정 스텝(있으면 칸 비활성). */
  fixedSteps?: number;
  /** V5M 고정 샘플러(있으면 칸 비활성). */
  fixedSampler?: string;
  /** CFG 리스케일을 쓰지 않는 모델(V5M). */
  cfgRescaleUnsupported: boolean;
  /** 모델이 강제하는 노이즈 스케줄(V5 계열 = karras). */
  forcedNoiseSchedule?: string;
  /** 입력한 네거티브를 쓰지 않는 모델(V5M). */
  negativeUnused: boolean;
}

/** 선택 계열의 고정·미사용 칸 — 표시만 바꾸고 저장값은 지우지 않는다. */
export function templateSamplingLocks(
  family: ModelSamplingFamily,
): TemplateSamplingLocks {
  const version = modelVersionForSamplingFamily(family);
  const fixed = naiFixedSettings(version);
  const caps = NAI_MODEL_SPECS[version]?.capabilities;
  return {
    fixedSteps: fixed?.steps,
    fixedSampler: fixed?.sampler,
    cfgRescaleUnsupported: caps?.supportsCfgRescale === false,
    forcedNoiseSchedule: caps?.forcedNoiseSchedule,
    negativeUnused: !!fixed,
  };
}
