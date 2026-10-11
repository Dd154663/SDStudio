// 변형 씬(I2I·인페인트·미러) 생성의 샘플링·모델 설정 = 메인 사전 세팅(2026-10-11 사용자 결정, SPEC_GUIDE §7-5).
//
// 변형 씬 생성 요청의 샘플링·모델 설정 필드는 씬 프리셋이 아니라 **생성(예약) 시점의 메인 사전 세팅**
// (`session.getCommonSetup(session.selectedWorkflow)` 의 preset·shared — SDImageGen·SDImageGenEasy)에서 가져온다.
// 메인 씬 생성(`buildSDImageGenJob`)이 읽는 것과 같은 값 — 모델 계열별 샘플링 프로필(modelSamplingProfiles.ts)이
// 메인 프리셋에 적용해 둔 「현재 값」(활성 프로필 미러 필드)을 그대로 쓴다.
//
// - 단일 출처: 대상 필드 목록 = `VARIANT_SAMPLING_PRESET_KEYS`(= MODEL_SAMPLING_FIELDS)·`VARIANT_SAMPLING_SHARED_KEYS`,
//   적용 = `applyMainSampling`(순수). 변형 생성 경로는 전부 `createSDI2IHandler`(SDWorkFlow.ts)를 지나며 그곳에서
//   `resolveVariantSampling` 을 한 번 부른다(미러 핸들러·queueComboVariant·queueI2IWorkflow·queueMirrorWorkflow·
//   이미지 변형 메뉴(OneTimeFlows)·대량 작업이 모두 그 핸들러로 모인다). 다른 곳에서 샘플링 값을 따로 고르지 않는다.
// - 씬 고유 필드(이미지·마스크·강도·노이즈·프롬프트/네거티브/캐릭터 프롬프트·Focused·바이브·캐릭터 레퍼런스·
//   캐릭터 좌표·시드)는 손대지 않는다.
// - 데이터 모델 불변: 씬 프리셋의 샘플링 키는 그대로 남는다(롤백 호환 — 5.5.x 이하는 그 값으로 생성). 저장 데이터를 바꾸지 않는다.
// - 폴백: 메인 사전 세팅을 읽을 수 없으면(선택 워크플로우 없음·이미지 생성 계열이 아님·사전 세팅 없음·읽기 예외)
//   씬 프리셋 값을 쓰고 console.warn 한 줄.
import { MODEL_SAMPLING_FIELDS } from './modelSamplingProfiles';

/** 메인 사전 세팅 preset 에서 가져오는 필드(샘플링/모델 설정 그룹의 preset 필드 — 계열별 프로필 필드와 같은 목록). */
export const VARIANT_SAMPLING_PRESET_KEYS = MODEL_SAMPLING_FIELDS;

/** 메인 사전 세팅 shared 에서 가져오는 필드(변형 프리셋에서는 preset 필드). */
export const VARIANT_SAMPLING_SHARED_KEYS = ['normalizeStrength'] as const;

/** 변형 생성에서 메인 값을 따르는 전체 필드 목록(편집기에서 숨기는 「샘플링/모델 설정」 그룹과 같은 집합). */
export const VARIANT_SAMPLING_KEYS = [
  ...VARIANT_SAMPLING_PRESET_KEYS,
  ...VARIANT_SAMPLING_SHARED_KEYS,
] as const;

/** 메인 사전 세팅으로 읽을 수 있는 워크플로우(이미지 생성 계열). */
export const MAIN_SAMPLING_WORKFLOWS: readonly string[] = ['SDImageGen', 'SDImageGenEasy'];

export interface MainSamplingSource {
  preset: any;
  shared?: any;
}

export type MainSamplingRead =
  | { ok: true; main: MainSamplingSource }
  | { ok: false; reason: string };

/** 편집기 안내 문구(변형 씬 편집 칸 — 「샘플링/모델 설정」 그룹 자리). */
export const VARIANT_SAMPLING_TEXT = {
  notice: '샘플링·모델 설정은 메인 사전 세팅을 따릅니다',
  fallbackWarn: (reason: string) =>
    `[변형 씬 샘플링] 메인 사전 세팅을 읽지 못해 씬 프리셋 값을 사용합니다 — ${reason}`,
} as const;

const hasValue = (v: unknown) => v !== undefined && v !== null;

/**
 * 씬 프리셋 사본에 메인 사전 세팅의 샘플링·모델 설정 값을 덮어 돌려준다(순수 — 입력을 바꾸지 않는다).
 * main 이 없으면 씬 프리셋을 그대로(같은 참조) 돌려준다. 메인 쪽 값이 없는(undefined·null) 필드만 씬 값을 유지한다.
 */
export function applyMainSampling<T extends Record<string, any>>(
  scenePreset: T,
  main?: MainSamplingSource,
): T {
  if (!main || !main.preset) return scenePreset;
  const next: Record<string, any> = { ...scenePreset };
  for (const key of VARIANT_SAMPLING_PRESET_KEYS) {
    const v = main.preset[key];
    if (hasValue(v)) next[key] = v;
  }
  for (const key of VARIANT_SAMPLING_SHARED_KEYS) {
    const v = main.shared?.[key];
    if (hasValue(v)) next[key] = v;
  }
  return next as T;
}

/**
 * 생성 시점의 메인 사전 세팅(preset·shared)을 읽는다. 읽을 수 없으면 사유를 돌려준다(예외를 밖으로 내지 않음).
 * session 은 `selectedWorkflow`·`getCommonSetup` 만 쓴다(테스트·보조 창 대비 구조적 타입).
 */
export function readMainSampling(session: any): MainSamplingRead {
  try {
    const flow = session?.selectedWorkflow;
    if (!flow || !flow.workflowType) return { ok: false, reason: '선택된 워크플로우 없음' };
    if (!MAIN_SAMPLING_WORKFLOWS.includes(flow.workflowType)) {
      return { ok: false, reason: `이미지 생성 워크플로우가 아님(${flow.workflowType})` };
    }
    const [, preset, shared] = session.getCommonSetup(flow);
    if (!preset) return { ok: false, reason: '메인 사전 세팅 없음' };
    return { ok: true, main: { preset, shared } };
  } catch (e: any) {
    return { ok: false, reason: `메인 사전 세팅 읽기 실패: ${e?.message ?? e}` };
  }
}

/** 변형 생성 핸들러용 — 메인 값을 덮은 프리셋 사본, 메인을 못 읽으면 씬 프리셋 그대로 + console.warn 한 줄. */
export function resolveVariantSampling<T extends Record<string, any>>(
  session: any,
  scenePreset: T,
): T {
  const read = readMainSampling(session);
  if (!read.ok) {
    console.warn(VARIANT_SAMPLING_TEXT.fallbackWarn(read.reason));
    return scenePreset;
  }
  return applyMainSampling(scenePreset, read.main);
}

const fmtNumber = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '-';

/** 편집기 요약 한 줄 — 스텝·가이던스·CFG·샘플러(읽기 전용 표시). */
export function mainSamplingSummary(mainPreset: any): string {
  const sampler =
    typeof mainPreset?.sampling === 'string' && mainPreset.sampling ? mainPreset.sampling : '-';
  return [
    `스텝 ${fmtNumber(mainPreset?.steps)}`,
    `가이던스 ${fmtNumber(mainPreset?.promptGuidance)}`,
    `CFG ${fmtNumber(mainPreset?.cfgRescale)}`,
    `샘플러 ${sampler}`,
  ].join(' · ');
}
