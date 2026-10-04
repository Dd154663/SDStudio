// 변형(I2I·인페인트·미러) 프리셋에 생성 설정을 옮기는 규칙 — 단일 출처(순수, jest i2iBatch.test.ts).
//
// 이미지에서 가져온 부분 메타데이터(Director Tools 출력 등은 prompt만 있음)가
// 기본값을 undefined로 지우지 않도록 누락 값은 기본 프리셋 값을 유지한다.
// createInpaintPreset·createI2IPreset·createMirrorPreset·대량 작업 「I2I로 이미지생성 씬 복사」가 같은 규칙을 쓴다
// (SPEC_GUIDE §12). 이미지·마스크·강도·노이즈·스텝·시드·바이브·캐릭터 레퍼런스는 옮기지 않는다.
import type { SDAbstractJob } from '../types';

/** 옮기는 키(순서 = 대입 순서). 여기에 없는 프리셋 키는 기본값 그대로. */
export const IMPORTED_JOB_KEYS = [
  'cfgRescale',
  'promptGuidance',
  'sampling',
  'noiseSchedule',
  'prompt',
  'uc',
  'characterPrompts',
  'useCoords',
  'legacyPromptConditioning',
  'normalizeStrength',
  'varietyPlus',
  'deliberateEulerAncestralBug',
] as const;

export function applyImportedJob(preset: any, job?: Partial<SDAbstractJob<string>>) {
  for (const key of IMPORTED_JOB_KEYS) {
    preset[key] = (job as any)?.[key] ?? preset[key];
  }
  return preset;
}
