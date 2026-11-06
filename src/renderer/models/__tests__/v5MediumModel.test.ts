// V5 Medium(V5M, 2026-11-06) — 계열 3택·프로필 분리·메타 판정·생성 설정 적용 규칙.
jest.mock('..', () => ({ workFlowService: {} }));

import { ModelVersion, Sampling } from '../../backends/imageGen';
import {
  activatePresetSamplingFamily,
  baseFamilyOf,
  isModelSamplingFamily,
  MODEL_FAMILY_LABEL,
  MODEL_SAMPLING_FAMILIES,
  modelVersionForSamplingFamily,
  nextModelFamily,
  normalizeSamplingProfiles,
  samplingFamilyForModel,
  samplingFamilyForModelId,
  setPresetSamplingField,
  switchSessionSamplingFamily,
} from '../modelSamplingProfiles';
import { buildNaiMetadataDiagnostics, parseCommentToJob } from '../util';
import {
  importedModelVersionOf,
  skipsFixedSamplingImport,
} from '../sdstudioPromptImport';
import { normalizeSDStudioImageMetadata } from '../../../shared/sdstudioImageMetadata';

const V5_HEAVY =
  'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page';

function preset() {
  return {
    steps: 28,
    promptGuidance: 5,
    sampling: Sampling.KEulerAncestral,
    noiseSchedule: 'karras',
    cfgRescale: 0,
    legacyPromptConditioning: false,
    varietyPlus: false,
    deliberateEulerAncestralBug: false,
  };
}

describe('계열 3택(4.5 | 5 | V5M)', () => {
  test('모델 ↔ 계열', () => {
    expect(MODEL_SAMPLING_FAMILIES).toEqual(['v4_5', 'v5', 'v5m']);
    expect(MODEL_FAMILY_LABEL.v5m).toBe('V5M');
    expect(samplingFamilyForModel(ModelVersion.V5Medium)).toBe('v5m');
    expect(samplingFamilyForModel(ModelVersion.V5)).toBe('v5');
    expect(samplingFamilyForModel(ModelVersion.V5Curated)).toBe('v5');
    expect(modelVersionForSamplingFamily('v5m', ModelVersion.V5Curated)).toBe(ModelVersion.V5Medium);
    expect(modelVersionForSamplingFamily('v5m', ModelVersion.V4_5)).toBe(ModelVersion.V5Medium);
    expect(modelVersionForSamplingFamily('v5', ModelVersion.V5Medium)).toBe(ModelVersion.V5);
    expect(modelVersionForSamplingFamily('v4_5', ModelVersion.V5Medium)).toBe(ModelVersion.V4_5);
  });

  test('순환 토글 4.5 → 5 → V5M → 4.5', () => {
    expect(nextModelFamily('v4_5')).toBe('v5');
    expect(nextModelFamily('v5')).toBe('v5m');
    expect(nextModelFamily('v5m')).toBe('v4_5');
  });

  test('화풍 계열은 세대만(v5m → v5), 모델 ID 판정도 v5', () => {
    expect(baseFamilyOf('v5m')).toBe('v5');
    expect(baseFamilyOf('v4_5')).toBe('v4_5');
    expect(baseFamilyOf(undefined)).toBeUndefined();
    expect(samplingFamilyForModelId('nai-diffusion-5-full-medium')).toBe('v5');
  });
});

describe('v5m 프로필 분리·저장 형식', () => {
  test('세 계열 값을 따로 보관·복원한다', () => {
    const p: any = preset();
    activatePresetSamplingFamily(p, 'v5');
    setPresetSamplingField(p, 'v5', 'promptGuidance', 6);
    activatePresetSamplingFamily(p, 'v5m');
    setPresetSamplingField(p, 'v5m', 'promptGuidance', 4.2);
    activatePresetSamplingFamily(p, 'v4_5');
    setPresetSamplingField(p, 'v4_5', 'promptGuidance', 7);

    activatePresetSamplingFamily(p, 'v5m');
    expect(p.promptGuidance).toBe(4.2);
    expect(p.samplingProfileFamily).toBe('v5m');
    activatePresetSamplingFamily(p, 'v5');
    expect(p.promptGuidance).toBe(6);
    activatePresetSamplingFamily(p, 'v4_5');
    expect(p.promptGuidance).toBe(7);
    expect(p.samplingProfiles.v5m.promptGuidance).toBe(4.2);
  });

  test('옛 JSON(v5m 키 없음)은 v5 값으로 시작하고, 구 키는 그대로', () => {
    const old = { v4_5: { steps: 28 }, v5: { steps: 23, promptGuidance: 5.5 } };
    expect(normalizeSamplingProfiles(old)).toEqual({
      v4_5: { steps: 28 },
      v5: { steps: 23, promptGuidance: 5.5 },
      v5m: { steps: 23, promptGuidance: 5.5 },
    });
    // v5m 이 있으면 그것을 쓴다
    expect(normalizeSamplingProfiles({ ...old, v5m: { promptGuidance: 3 } })!.v5m).toEqual({ promptGuidance: 3 });
  });

  test('세션 전환은 프리셋·변형 씬 프리셋 모두 v5m 으로', () => {
    const a: any = preset();
    const b: any = preset();
    activatePresetSamplingFamily(a, 'v5');
    activatePresetSamplingFamily(b, 'v5');
    const session = {
      presets: new Map([['SDImageGen', [a]]]),
      inpaints: new Map([['s', { preset: b }]]),
    };
    switchSessionSamplingFamily(session, 'v5m');
    expect(a.samplingProfileFamily).toBe('v5m');
    expect(b.samplingProfileFamily).toBe('v5m');
  });

  test('저장된 계열 값 판정 — v5m 허용, 모르는 값은 버린다', () => {
    expect(isModelSamplingFamily('v5m')).toBe(true);
    expect(isModelSamplingFamily('v5')).toBe(true);
    expect(isModelSamplingFamily('v6')).toBe(false);
  });
});

describe('메타 — Source 해시 판정·생성 설정 적용', () => {
  const comment = {
    prompt: '1girl',
    uc: V5_HEAVY,
    steps: 14,
    sampler: 'k_euler_ancestral',
    scale: 5,
    seed: 1,
    width: 832,
    height: 1216,
    v4_prompt: { caption: { base_caption: '1girl', char_captions: [] } },
    v4_negative_prompt: { caption: { base_caption: V5_HEAVY, char_captions: [] } },
  };

  test('Source 93F4BD30 → V5M 표시·modelVersion', () => {
    expect(buildNaiMetadataDiagnostics({}, 'NovelAI Diffusion V5 93F4BD30')).toMatchObject({
      model: 'V5 Full Medium (V5M)',
      modelVersion: ModelVersion.V5Medium,
    });
    expect(buildNaiMetadataDiagnostics({}, 'NovelAI Diffusion V5 70AB5786').modelVersion).toBe(
      ModelVersion.V5Medium,
    );
    // V5 Full 해시는 표시 종전 그대로
    expect(buildNaiMetadataDiagnostics({}, 'NovelAI Diffusion V5 657484A5').model).toBe('V5 Full');
  });

  test('V5M 이미지의 uc(Heavy 문구)는 UC 칸에 넣지 않는다', () => {
    const job = parseCommentToJob(comment, 'NovelAI Diffusion V5 93F4BD30')!;
    expect(job.uc).toBe('');
    expect(importedModelVersionOf(job)).toBe(ModelVersion.V5Medium);
    expect(skipsFixedSamplingImport(importedModelVersionOf(job))).toBe(true);
    // 같은 내용의 V5 Full 이미지는 종전대로(Heavy 문구 유지, 모델 미적용)
    const full = parseCommentToJob(comment, 'NovelAI Diffusion V5 657484A5')!;
    expect(full.uc).toBe(V5_HEAVY);
    expect(importedModelVersionOf(full)).toBeUndefined();
    expect(skipsFixedSamplingImport(importedModelVersionOf(full))).toBe(false);
  });

  test('SDStudio 전용 메타의 5-full-medium 을 받아들이고 우선한다', () => {
    const meta = normalizeSDStudioImageMetadata({
      schemaVersion: 1,
      promptSource: {
        schemaVersion: 1,
        workflowType: 'SDImageGen',
        frontPrompt: 'a',
        extraPrompt: '',
        middlePrompt: '',
        backPrompt: '',
      },
      generationSettings: {
        schemaVersion: 1,
        modelVersion: '5-full-medium',
        furryMode: false,
        disableQuality: false,
        ucPreset: 'light',
      },
    });
    expect(meta?.generationSettings?.modelVersion).toBe('5-full-medium');
    expect(importedModelVersionOf({ sdstudioMetadata: meta })).toBe(ModelVersion.V5Medium);
    // 모르는 모델 값은 generationSettings 를 버린다(종전 규칙 — 구버전 롤백과 같은 동작)
    const unknown = normalizeSDStudioImageMetadata({
      ...meta,
      generationSettings: { ...meta!.generationSettings, modelVersion: '9-future' },
    });
    expect(unknown?.generationSettings).toBeUndefined();
    expect(importedModelVersionOf({ sdstudioMetadata: unknown })).toBeUndefined();
  });
});
