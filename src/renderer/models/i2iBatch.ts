// 대량 작업 「I2I로 이미지생성 씬 복사」(B1)·「인페인트로 이미지생성 씬 복사」(P1, B1 과 같은 흐름 — 워크플로우 매개변수)·
// 「일괄 이미지 첨부」(B2, I2I·인페인트 — P2) — 순수 규칙·문구·값 입력(2026-10-04).
// 흐름(씬 선택·이미지 고르기·씬 생성/적용)은 i2iBatchFlow.ts, 계약은 SPEC_GUIDE §6 「대량 작업 I2I」·§7-3 ⓕ·ⓖ.
// 이 파일은 서비스(models/index)를 import 하지 않는다 — jest i2iBatch.test.ts 가 그대로 부른다.
import type { CharacterPrompt, PromptNode, SDAbstractJob } from './types';
import { applyImportedJob } from './workflows/importedJob';
import { getAppState } from './appStateRef';
import type { ComboMode } from './comboMode';

/** 이미지 투 이미지 워크플로우(노이즈가 있는 유일한 변형 워크플로우). */
export const I2I_WORKFLOW_TYPE = 'SDI2I';
/** 인페인트 워크플로우(마스크·Focused 영역이 있음 — 노이즈 없음). */
export const INPAINT_WORKFLOW_TYPE = 'SDInpaint';
/** 이미지 미러 워크플로우(합성 캔버스 — 첨부·마스크 일괄 대상 아님, 강도는 핸들러가 씀). */
export const MIRROR_WORKFLOW_TYPE = 'SDMirror';

/** 이미지생성 씬을 복사해 만들 수 있는 변형 워크플로우(B1 = I2I, P1 = 인페인트 — 같은 흐름). */
export type VariantCopyWorkflow = typeof I2I_WORKFLOW_TYPE | typeof INPAINT_WORKFLOW_TYPE;

/** 노이즈 값이 있는 워크플로우인가(I2I 만 — 인페인트·미러 프리셋에는 noise 키가 없다). */
export function workflowHasNoise(workflowType: string | undefined): boolean {
  return workflowType === I2I_WORKFLOW_TYPE;
}

/** B1 이 프롬프트를 옮길 수 있는 생성 워크플로우(일반·이지 모드 — 같은 잡 조립 규칙). */
export const I2I_COPY_SOURCE_WORKFLOWS: ReadonlySet<string> = new Set([
  'SDImageGen',
  'SDImageGenEasy',
]);

export const I2I_BATCH_TEXT = {
  copyMenu: '🖼️ I2I로 이미지생성 씬 복사',
  inpaintCopyMenu: '🖌️ 인페인트로 이미지생성 씬 복사',
  attachMenu: '📎 일괄 이미지 첨부',
  copySelect: '🖼️ I2I로 복사할 이미지생성 씬 선택',
  inpaintCopySelect: '🖌️ 인페인트로 복사할 이미지생성 씬 선택',
  comboModeQuestion: '상위·하위 프롬프트와 전역 네거티브를 어떻게 할까요?',
  comboShared: '현재 사전 세팅과 실시간 공유',
  comboSnapshot: '복사 시점 설정을 1회 복제',
  attachSelect: '📎 이미지를 첨부할 변형 씬 선택(I2I·인페인트 씬에만 적용)',
  sourceSelect: '🖼️ 기본 이미지로 쓸 씬 하나 선택(씬의 대표 이미지)',
  imageQuestion: '기본 이미지를 함께 첨부할까요?',
  attachImageQuestion: '첨부할 이미지를 골라 주세요.',
  fromFile: '파일에서 선택',
  fromExisting: '기존 이미지에서 선택',
  noImage: '이미지 없이',
  strengthQuestion: '강도·노이즈를 함께 적용할까요?',
  strengthOnlyQuestion: '강도를 함께 적용할까요?',
  applyWithValues: '함께 적용(값 입력)',
  imageOnly: '이미지만',
  strengthInput: (def: number) => `강도를 입력해 주세요 (0~1, 기본 ${def})`,
  noiseInput: (def: number) => `노이즈를 입력해 주세요 (0~1, 기본 ${def})`,
  unitRange: '0 이상 1 이하의 숫자를 입력해 주세요.',
  noImageGenScenes: '이미지생성 씬이 없습니다.',
  noSourceImages: '결과 이미지가 있는 이미지생성 씬이 없습니다.',
  pickOneSource: '기본 이미지로 쓸 씬을 하나만 선택해 주세요.',
  sourceHasNoImage: '선택한 씬에 이미지가 없습니다.',
  imageReadFailed: '이미지를 읽지 못했습니다. 다른 이미지를 골라 주세요.',
  noCopySetup:
    '현재 생성 설정(사전 세팅)을 찾을 수 없어 프롬프트를 옮길 수 없습니다. 이미지생성 탭에서 사전 세팅을 고른 뒤 다시 시도해 주세요.',
  sessionChanged: '작업 도중 프로젝트가 바뀌어 중단했습니다.',
  noAttachTargets: (skipped: number) =>
    `선택한 씬 중 이미지 투 이미지(I2I)·인페인트 씬이 없습니다.${skipped > 0 ? ` (건너뜀 ${skipped}개: 미러 등)` : ''}`,
  overwriteConfirm: (overwriting: number, total: number, inpaintWithMask: number) =>
    `대상 씬 ${total}개 중 ${overwriting}개는 이미 첨부 이미지가 있습니다.\n새 이미지로 바꿀까요?` +
    (inpaintWithMask > 0
      ? `\n마스크가 있는 인페인트 씬 ${inpaintWithMask}개는 새 이미지와 크기가 다르면 마스크가 초기화됩니다(파일은 남음).`
      : ''),
  overwriteConfirmButton: '바꾸기',
} as const;

/** 선택지 값(select) — 이미지 출처·강도/노이즈 적용 여부. */
export type ImageSourceChoice = 'file' | 'existing' | 'none';
export type StrengthNoiseChoice = 'with-values' | 'image-only';

export interface StrengthNoise {
  strength: number;
  /** 노이즈를 묻지 않았으면(대상에 I2I 가 없음) undefined. */
  noise?: number;
}

/** 실패 이름 목록 꼬리(최대 5개). */
export function failedTail(failed: readonly string[]): string {
  if (failed.length === 0) return '';
  const names = failed.slice(0, 5).join(', ') + (failed.length > 5 ? ' 외' : '');
  return ` · 실패 ${failed.length}개: ${names}`;
}

/** 복사 결과 토스트에 쓰는 워크플로우 이름. */
export function variantCopyLabel(workflow: VariantCopyWorkflow): string {
  return workflow === INPAINT_WORKFLOW_TYPE ? '인페인트' : 'I2I';
}

/** B1·P1 메뉴·씬 선택 창 문구. */
export function variantCopyMenuText(workflow: VariantCopyWorkflow): { menu: string; select: string } {
  return workflow === INPAINT_WORKFLOW_TYPE
    ? { menu: I2I_BATCH_TEXT.inpaintCopyMenu, select: I2I_BATCH_TEXT.inpaintCopySelect }
    : { menu: I2I_BATCH_TEXT.copyMenu, select: I2I_BATCH_TEXT.copySelect };
}

/** B1·P1 완료 토스트 — 「N개 I2I(인페인트) 씬 생성(이미지 첨부 M개)」 + 실패. */
export function i2iCopyResultText(r: {
  created: number;
  withImage: number;
  failed: readonly string[];
  firstError?: string;
  /** 기본 'SDI2I'. */
  workflow?: VariantCopyWorkflow;
}): string {
  const label = variantCopyLabel(r.workflow ?? I2I_WORKFLOW_TYPE);
  const head = `${r.created}개 ${label} 씬 생성(이미지 첨부 ${r.withImage}개)`;
  const err = r.failed.length > 0 && r.firstError ? `\n첫 오류: ${r.firstError}` : '';
  return head + failedTail(r.failed) + err;
}

/** B2 완료 토스트 — 「N개 씬(I2I·인페인트)에 이미지 첨부」 + 마스크 초기화 + 건너뜀(미러 등) + 실패. */
export function imageAttachResultText(r: {
  applied: number;
  skipped: number;
  failed: readonly string[];
  /** 새 이미지와 크기가 달라 마스크 참조를 비운 인페인트 씬 수. */
  maskReset?: number;
}): string {
  const maskReset = r.maskReset ? ` · 마스크 초기화 ${r.maskReset}개` : '';
  const skipped = r.skipped > 0 ? ` · 건너뜀 ${r.skipped}개(미러 등)` : '';
  return `${r.applied}개 씬(I2I·인페인트)에 이미지를 첨부했습니다${maskReset}${skipped}${failedTail(r.failed)}`;
}

/** 결과 토스트 종류 — 하나도 못 했으면 error, 일부 실패면 info, 다 됐으면 success. */
export function batchResultKind(done: number, failed: number): 'error' | 'info' | 'success' {
  if (done === 0 && failed > 0) return 'error';
  return failed > 0 ? 'info' : 'success';
}

/** B2 대상 워크플로우 — I2I·인페인트(P2). 미러(합성 캔버스)·이미지 수정은 건너뜀. */
const ATTACH_TARGET_WORKFLOWS: ReadonlySet<string> = new Set([
  I2I_WORKFLOW_TYPE,
  INPAINT_WORKFLOW_TYPE,
]);

/**
 * B2 대상 나누기 — 이미지 투 이미지(SDI2I)·인페인트(SDInpaint) 씬이 대상, 나머지(미러·이미지 수정)는 건너뜀.
 */
export function splitAttachTargets<T extends { workflowType?: string }>(
  scenes: readonly T[],
): { targets: T[]; skipped: T[] } {
  const targets: T[] = [];
  const skipped: T[] = [];
  for (const s of scenes) {
    if (s.workflowType && ATTACH_TARGET_WORKFLOWS.has(s.workflowType)) targets.push(s);
    else skipped.push(s);
  }
  return { targets, skipped };
}

/**
 * B2 인페인트 씬의 기존 마스크 판정(P2) — 새 이미지와 크기가 같으면 유지('keep'), 다르거나 마스크를 읽지 못했으면
 * 참조를 비운다('reset' — 파일은 지우지 않음). 마스크가 없으면 'none'.
 */
export function attachMaskDecision(
  hasMask: boolean,
  maskSize: { width: number; height: number } | undefined,
  imageSize: { width: number; height: number },
): 'none' | 'keep' | 'reset' {
  if (!hasMask) return 'none';
  if (!maskSize) return 'reset';
  return maskSize.width === imageSize.width && maskSize.height === imageSize.height
    ? 'keep'
    : 'reset';
}

/**
 * 일반 씬 생성 잡(PromptNode) → 변형 프리셋에 옮길 문자열 잡. 프롬프트·캐릭터 프롬프트를 글자로 낮춘다
 * ({a|b} 무작위는 이때 한 번 고른다 — 예약 때와 같은 lowerPromptNode).
 */
export function lowerJobForI2I(
  job: SDAbstractJob<PromptNode>,
  lower: (node: PromptNode) => string,
): Partial<SDAbstractJob<string>> {
  return {
    ...job,
    prompt: lower(job.prompt),
    characterPrompts: (job.characterPrompts || []).map((cp) => ({
      ...cp,
      prompt: lower(cp.prompt),
    })),
  };
}

/**
 * B1 프리셋 변환 — 새 I2I 프리셋(buildPreset('SDI2I'))에 「즐겨찾기 이미지 변형」과 같은 규칙
 * (importedJob.applyImportedJob)으로 생성 설정을 옮긴다. 이미지·마스크·강도·노이즈는 건드리지 않는다.
 */
export function i2iPresetFromGeneralJob(
  preset: any,
  job: SDAbstractJob<PromptNode>,
  lower: (node: PromptNode) => string,
): any {
  return applyImportedJob(preset, lowerJobForI2I(job, lower));
}

/**
 * B1·P1 조합 모드 프리셋(2026-10-04 B4, SPEC §7-4) — 생성 설정(샘플링 등)은 잡에서 같은 규칙(applyImportedJob)으로 옮기고,
 * 프롬프트 자리는 조합 모드 규칙으로 채운다: prompt = 첫 조합의 중간 프롬프트(롤백·조합 모드 끄기용),
 * uc = 씬 네거티브(씬 캐릭터 UC·씬 전용 네거티브 — 전역 네거티브 제외), characterPrompts = 씬 캐릭터 해석 결과
 * (조각 미해석). 꺼진 캐릭터도 순서 그대로 남긴다 — 조각의 캐릭터란(piece.characterPrompts[i])이 번호로 짝지어지므로
 * 빼면 어긋난다(꺼진 것은 예약 때 전개에서 뺀다). order 는 지운다(배열 순서가 곧 순서).
 * 'snapshot' 이면 상위·하위·전역 네거티브 고정값도 넣는다('shared' 는 빈 값 — 예약 때 사전 세팅을 읽는다).
 * preset 은 buildPreset('SDI2I') 또는 buildPreset('SDInpaint')(P1 — 같은 고정값 키가 있다).
 */
export function i2iComboPresetFromJob(
  preset: any,
  job: SDAbstractJob<PromptNode>,
  parts: {
    middlePrompt: string;
    sceneUc: string;
    characterPrompts: readonly CharacterPrompt[];
    mode: ComboMode;
    snapshot?: { frontPrompt: string; backPrompt: string; globalUc: string };
  },
): any {
  applyImportedJob(preset, {
    ...job,
    prompt: parts.middlePrompt,
    uc: parts.sceneUc,
    characterPrompts: parts.characterPrompts.map((cp) => {
      const { order: _order, ...rest } = cp;
      return { ...rest, position: cp.position ? { ...cp.position } : cp.position };
    }),
  });
  if (parts.mode === 'snapshot' && parts.snapshot) {
    preset.frontPrompt = parts.snapshot.frontPrompt;
    preset.backPrompt = parts.snapshot.backPrompt;
    preset.globalUc = parts.snapshot.globalUc;
  }
  return preset;
}

/** B1 — 상위·하위·전역 네거티브 처리 방식을 묻는다. 취소 = undefined. */
export async function askComboMode(): Promise<ComboMode | undefined> {
  const value = await getAppState().pushDialogAsync({
    type: 'select',
    text: I2I_BATCH_TEXT.comboModeQuestion,
    items: [
      { text: I2I_BATCH_TEXT.comboShared, value: 'shared' },
      { text: I2I_BATCH_TEXT.comboSnapshot, value: 'snapshot' },
    ],
  });
  return value === 'shared' || value === 'snapshot' ? value : undefined;
}

/**
 * 「함께 적용」이면 강도(·노이즈)를 프리셋에 넣는다. undefined(이미지만)면 그대로.
 * 노이즈는 allowNoise(= I2I 프리셋)이고 값이 있을 때만 — 인페인트·미러 프리셋에는 noise 키를 만들지 않는다.
 */
export function applyStrengthNoise(
  preset: any,
  values: StrengthNoise | undefined,
  allowNoise = true,
): void {
  if (!values) return;
  preset.strength = values.strength;
  if (allowNoise && values.noise !== undefined) preset.noise = values.noise;
}

/** 0~1 숫자 입력 해석(0.01 단위 반올림 — 프리셋 슬라이더 step). 아니면 undefined. */
export function parseUnitInterval(raw: string | undefined | null): number | undefined {
  const text = (raw ?? '').trim();
  if (!text) return undefined;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0 || n > 1) return undefined;
  return Math.round(n * 100) / 100;
}

/**
 * 0~1 숫자 하나를 묻는다(검증은 창 안 — 실패면 창 유지). 취소면 undefined.
 * 강도·노이즈 숫자 입력의 단일 helper(B1·B2·P1·P2·P4 공용 — specGuard input-confirm allowlist 1곳).
 */
export async function promptUnitValue(text: string, initial: number): Promise<number | undefined> {
  const raw = await getAppState().pushDialogAsync({
    type: 'input-confirm',
    text,
    inputValue: String(initial),
    validate: (value: string) =>
      parseUnitInterval(value) === undefined ? I2I_BATCH_TEXT.unitRange : null,
  });
  if (raw === undefined) return undefined;
  return parseUnitInterval(raw);
}

/**
 * 「강도·노이즈 적용」 — [함께 적용(값 입력)][이미지만]. 함께 적용이면 강도·노이즈를 차례로 묻는다
 * (처음 값 = defaults, 보통 대상 워크플로우 프리셋 기본값). withNoise 가 거짓(인페인트만 — 노이즈 없음)이면
 * 질문이 「강도를 함께 적용할까요?」이고 강도만 묻는다(values.noise 없음).
 * 취소 = undefined, 이미지만 = { values: undefined }.
 */
export async function askStrengthNoise(
  defaults: { strength: number; noise?: number },
  withNoise = true,
): Promise<{ values: StrengthNoise | undefined } | undefined> {
  const appState = getAppState();
  const choice = (await appState.pushDialogAsync({
    type: 'select',
    text: withNoise ? I2I_BATCH_TEXT.strengthQuestion : I2I_BATCH_TEXT.strengthOnlyQuestion,
    items: [
      { text: I2I_BATCH_TEXT.applyWithValues, value: 'with-values' },
      { text: I2I_BATCH_TEXT.imageOnly, value: 'image-only' },
    ],
  })) as StrengthNoiseChoice | undefined;
  if (!choice) return undefined;
  if (choice === 'image-only') return { values: undefined };
  const strength = await promptUnitValue(
    I2I_BATCH_TEXT.strengthInput(defaults.strength),
    defaults.strength,
  );
  if (strength === undefined) return undefined;
  if (!withNoise) return { values: { strength } };
  const noiseDefault = defaults.noise ?? 0;
  const noise = await promptUnitValue(I2I_BATCH_TEXT.noiseInput(noiseDefault), noiseDefault);
  if (noise === undefined) return undefined;
  return { values: { strength, noise } };
}

/** 이미지 출처를 묻는다 — allowNone 이면 [이미지 없이] 포함(B1). 취소 = undefined. */
export async function askImageSource(allowNone: boolean): Promise<ImageSourceChoice | undefined> {
  const items: { text: string; value: ImageSourceChoice }[] = [
    { text: I2I_BATCH_TEXT.fromFile, value: 'file' },
    { text: I2I_BATCH_TEXT.fromExisting, value: 'existing' },
  ];
  if (allowNone) items.push({ text: I2I_BATCH_TEXT.noImage, value: 'none' });
  const value = await getAppState().pushDialogAsync({
    type: 'select',
    text: allowNone ? I2I_BATCH_TEXT.imageQuestion : I2I_BATCH_TEXT.attachImageQuestion,
    items,
  });
  return value as ImageSourceChoice | undefined;
}
