import { ModelVersion } from '../backends/imageGen';

/**
 * 샘플링 프로필 계열 = 상단 퀵 전환 칸(2026-11-06: 'v5m' = V5 Full Medium Effort 추가, 라벨 V5M).
 * 계열마다 샘플링 값을 따로 보관·복원한다. 저장 형식은 선택 키(`samplingProfiles.v5m`) 추가뿐 — 옛 JSON 은 키가 없어
 * v5 프로필을 복사해 시작하고, 5.5.2 이하는 v5m 키를 모르고 버린다(그 버전의 v4_5·v5 값은 그대로).
 */
export type ModelSamplingFamily = 'v4_5' | 'v5' | 'v5m';

/** 화풍(작가 라이브러리 샘플) 계열 — 모델 세대만 본다(V5 Medium 은 V5 의 증류 모델이라 'v5'). */
export type ModelBaseFamily = 'v4_5' | 'v5';

export const MODEL_SAMPLING_FAMILIES: readonly ModelSamplingFamily[] = ['v4_5', 'v5', 'v5m'];

export function isModelSamplingFamily(value: unknown): value is ModelSamplingFamily {
  return value === 'v4_5' || value === 'v5' || value === 'v5m';
}

/** 퀵 전환·편집기 표시용 라벨(칸 글자)과 이름(안내 문장용). */
export const MODEL_FAMILY_LABEL: Readonly<Record<ModelSamplingFamily, string>> = {
  v4_5: '4.5',
  v5: '5',
  v5m: 'V5M',
};
export const MODEL_FAMILY_NAME: Readonly<Record<ModelSamplingFamily, string>> = {
  v4_5: 'v4.5',
  v5: 'v5',
  v5m: 'v5 medium',
};

/** 순환 토글(클래식 모바일 단일 버튼)의 다음 계열 — 4.5 → 5 → V5M → 4.5. */
export function nextModelFamily(family: ModelSamplingFamily): ModelSamplingFamily {
  const i = MODEL_SAMPLING_FAMILIES.indexOf(family);
  return MODEL_SAMPLING_FAMILIES[(i + 1) % MODEL_SAMPLING_FAMILIES.length];
}

/** 샘플링 계열 → 화풍 계열(v5m → v5). */
export function baseFamilyOf(family: ModelSamplingFamily | undefined): ModelBaseFamily | undefined {
  if (!family) return undefined;
  return family === 'v4_5' ? 'v4_5' : 'v5';
}

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
  if (modelVersion === ModelVersion.V5Medium) return 'v5m';
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

/**
 * NAI 모델 id 문자열(이미지 메타데이터 naiDiagnostics.model, 예: nai-diffusion-4-5-full / nai-diffusion-5-curated)
 * → 모델 계열. 작가 라이브러리의 샘플 이미지 계열 자동 판정에 쓴다(2026-09-26). 모르는 id 는 undefined.
 */
export function samplingFamilyForModelId(
  modelId?: string | null,
): ModelBaseFamily | undefined {
  const id = (modelId ?? '').trim().toLowerCase();
  if (/^nai-diffusion-5(-|$)/.test(id)) return 'v5';
  if (/^nai-diffusion-4-5(-|$)/.test(id)) return 'v4_5';
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
  // V5 Medium 은 Curated 변형이 없다 — Curated 를 쓰던 사용자도 V5M 칸은 Full Medium.
  if (family === 'v5m') return ModelVersion.V5Medium;
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
    // 옛 JSON(v5m 없음) = v5 값으로 시작 — 가이던스 등 V5 계열 값이 이어진다(스텝·샘플러는 V5M 에서 고정이라 무관).
    v5m: copyProfile(value.v5m && typeof value.v5m === 'object' ? value.v5m : value.v5),
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
  const created = { v4_5: { ...current }, v5: { ...current }, v5m: { ...current } };
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

  const sourceFamily: ModelSamplingFamily = isModelSamplingFamily(preset.samplingProfileFamily)
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

/** V5 Medium(V5M) 편집기 안내 문구 단일 출처(2026-11-06) — 사전 세팅 편집기·변형 씬 안내·조합 전역 네거티브 칸. */
export const V5_MEDIUM_TEXT = {
  negativeNotice:
    'V5M(Medium)에서는 네거티브가 쓰이지 않습니다.',
  fixedField: (value: string) => `V5M(Medium) 고정값: ${value}`,
  cfgRescaleUnsupported: 'V5M(Medium)에서는 CFG 리스케일이 쓰이지 않습니다',
  ucPresetFixed: 'V5M(Medium)에서는 네거티브 프리셋이 강함(Heavy)으로 고정됩니다',
  modelNotice:
    'V5M(Medium Effort)은 스텝 14·Euler Ancestral·네거티브 프리셋 Heavy 로 고정되고, 입력한 네거티브는 쓰이지 않습니다. 비용은 V5 Full 보다 적습니다.',
  variantSummary: (guidance: string) =>
    `V5M 고정 · 스텝 14 · 가이던스 ${guidance} · 샘플러 k_euler_ancestral`,
} as const;
