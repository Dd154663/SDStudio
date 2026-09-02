import { ModelVersion } from '../backends/imageGen';

export type ModelSamplingFamily = 'v4_5' | 'v5';

export const MODEL_SAMPLING_FIELDS = [
  'steps',
  'promptGuidance',
  'sampling',
  'noiseSchedule',
  'cfgRescale',
  'legacyPromptConditioning',
  'varietyPlus',
  'deliberateEulerAncestralBug',
] as const;

export type ModelSamplingField = (typeof MODEL_SAMPLING_FIELDS)[number];
export type ModelSamplingProfile = Partial<Record<ModelSamplingField, string | number | boolean>>;
export type ModelSamplingProfiles = Record<ModelSamplingFamily, ModelSamplingProfile>;

export function samplingFamilyForModel(
  modelVersion?: ModelVersion,
): ModelSamplingFamily | undefined {
  if (
    modelVersion === ModelVersion.V5 ||
    modelVersion === ModelVersion.V5Curated
  ) return 'v5';
  if (
    modelVersion === ModelVersion.V4_5 ||
    modelVersion === ModelVersion.V4_5Curated
  ) return 'v4_5';
  return undefined;
}

export function modelVersionForSamplingFamily(
  family: ModelSamplingFamily,
  current?: ModelVersion,
): ModelVersion {
  const curated =
    current === ModelVersion.V4_5Curated ||
    current === ModelVersion.V5Curated ||
    current === ModelVersion.V4Curated;
  if (family === 'v5') {
    return curated ? ModelVersion.V5Curated : ModelVersion.V5;
  }
  return curated ? ModelVersion.V4_5Curated : ModelVersion.V4_5;
}

function snapshotLegacySampling(preset: any): ModelSamplingProfile {
  const profile: ModelSamplingProfile = {};
  for (const field of MODEL_SAMPLING_FIELDS) {
    const value = preset?.[field];
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) profile[field] = value;
  }
  return profile;
}

function hasSamplingFields(preset: any): boolean {
  return MODEL_SAMPLING_FIELDS.some((field) => field in (preset || {}));
}

function copyProfile(profile?: ModelSamplingProfile): ModelSamplingProfile {
  const copied: ModelSamplingProfile = {};
  for (const field of MODEL_SAMPLING_FIELDS) {
    const value = profile?.[field];
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) copied[field] = value;
  }
  return copied;
}

export function normalizeSamplingProfiles(value: any): ModelSamplingProfiles | undefined {
  if (!value || typeof value !== 'object') return undefined;
  return {
    v4_5: copyProfile(value.v4_5),
    v5: copyProfile(value.v5),
  };
}

function ensureSamplingProfiles(
  preset: any,
  initialFamily: ModelSamplingFamily,
): ModelSamplingProfiles {
  const existing = normalizeSamplingProfiles(preset.samplingProfiles);
  if (existing) {
    preset.samplingProfiles = existing;
    return existing;
  }
  const current = snapshotLegacySampling(preset);
  const created = { v4_5: { ...current }, v5: { ...current } };
  preset.samplingProfiles = created;
  preset.samplingProfileFamily = initialFamily;
  return created;
}

function applyProfile(preset: any, profile: ModelSamplingProfile): void {
  for (const field of MODEL_SAMPLING_FIELDS) {
    if (field in preset && field in profile) preset[field] = profile[field];
  }
}

/**
 * 프리셋의 구 필드는 구버전 호환용 활성 프로필 미러다. 현재 미러가 어느 계열인지
 * 기록해 두었다가 다른 계열을 활성화할 때 출발 계열을 먼저 보존한다.
 */
export function activatePresetSamplingFamily(
  preset: any,
  targetFamily: ModelSamplingFamily,
): void {
  if (!preset || typeof preset !== 'object' || !hasSamplingFields(preset)) return;
  const hadProfiles = !!normalizeSamplingProfiles(preset.samplingProfiles);
  const profiles = ensureSamplingProfiles(preset, targetFamily);
  if (!hadProfiles) return;

  const sourceFamily: ModelSamplingFamily =
    preset.samplingProfileFamily === 'v4_5' || preset.samplingProfileFamily === 'v5'
      ? preset.samplingProfileFamily
      : targetFamily;
  profiles[sourceFamily] = snapshotLegacySampling(preset);
  if (sourceFamily !== targetFamily) applyProfile(preset, profiles[targetFamily]);
  preset.samplingProfileFamily = targetFamily;
}

export function setPresetSamplingField(
  preset: any,
  family: ModelSamplingFamily,
  field: string,
  value: any,
): boolean {
  if (!(MODEL_SAMPLING_FIELDS as readonly string[]).includes(field)) return false;
  activatePresetSamplingFamily(preset, family);
  preset[field] = value;
  preset.samplingProfiles[family][field] = value;
  return true;
}

export function switchSessionSamplingFamily(
  session: any,
  targetFamily: ModelSamplingFamily,
): void {
  if (!session) return;
  for (const presets of session.presets?.values?.() || []) {
    for (const preset of presets || []) activatePresetSamplingFamily(preset, targetFamily);
  }
  for (const scene of session.inpaints?.values?.() || []) {
    if (scene?.preset) activatePresetSamplingFamily(scene.preset, targetFamily);
  }
}
