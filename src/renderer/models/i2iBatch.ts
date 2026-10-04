// 대량 작업 「I2I로 이미지생성 씬 복사」(B1)·「일괄 이미지 첨부」(B2) — 순수 규칙·문구·값 입력(2026-10-04).
// 흐름(씬 선택·이미지 고르기·씬 생성/적용)은 i2iBatchFlow.ts, 계약은 SPEC_GUIDE §6 「대량 작업 I2I」·§7-3 ⓕ·ⓖ.
// 이 파일은 서비스(models/index)를 import 하지 않는다 — jest i2iBatch.test.ts 가 그대로 부른다.
import type { CharacterPrompt, PromptNode, SDAbstractJob } from './types';
import { applyImportedJob } from './workflows/importedJob';
import { getAppState } from './appStateRef';
import type { ComboMode } from './comboMode';

/** 변형 씬 중 B2(일괄 이미지 첨부)가 적용되는 워크플로우 — 이미지 투 이미지만. */
export const I2I_WORKFLOW_TYPE = 'SDI2I';

/** B1 이 프롬프트를 옮길 수 있는 생성 워크플로우(일반·이지 모드 — 같은 잡 조립 규칙). */
export const I2I_COPY_SOURCE_WORKFLOWS: ReadonlySet<string> = new Set([
  'SDImageGen',
  'SDImageGenEasy',
]);

export const I2I_BATCH_TEXT = {
  copyMenu: '🖼️ I2I로 이미지생성 씬 복사',
  attachMenu: '📎 일괄 이미지 첨부',
  copySelect: '🖼️ I2I로 복사할 이미지생성 씬 선택',
  comboModeQuestion: '상위·하위 프롬프트와 전역 네거티브를 어떻게 할까요?',
  comboShared: '현재 사전 세팅과 실시간 공유',
  comboSnapshot: '복사 시점 설정을 1회 복제',
  attachSelect: '📎 이미지를 첨부할 변형 씬 선택(I2I 씬에만 적용)',
  sourceSelect: '🖼️ 기본 이미지로 쓸 씬 하나 선택(씬의 대표 이미지)',
  imageQuestion: '기본 이미지를 함께 첨부할까요?',
  attachImageQuestion: '첨부할 이미지를 골라 주세요.',
  fromFile: '파일에서 선택',
  fromExisting: '기존 이미지에서 선택',
  noImage: '이미지 없이',
  strengthQuestion: '강도·노이즈를 함께 적용할까요?',
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
  noI2ITargets: (skipped: number) =>
    `선택한 씬 중 이미지 투 이미지(I2I) 씬이 없습니다.${skipped > 0 ? ` (건너뜀 ${skipped}개: 인페인트/미러 등)` : ''}`,
  overwriteConfirm: (overwriting: number, total: number) =>
    `I2I 씬 ${total}개 중 ${overwriting}개는 이미 첨부 이미지가 있습니다.\n새 이미지로 바꿀까요?`,
  overwriteConfirmButton: '바꾸기',
} as const;

/** 선택지 값(select) — 이미지 출처·강도/노이즈 적용 여부. */
export type ImageSourceChoice = 'file' | 'existing' | 'none';
export type StrengthNoiseChoice = 'with-values' | 'image-only';

export interface StrengthNoise {
  strength: number;
  noise: number;
}

/** 실패 이름 목록 꼬리(최대 5개). */
function failedTail(failed: readonly string[]): string {
  if (failed.length === 0) return '';
  const names = failed.slice(0, 5).join(', ') + (failed.length > 5 ? ' 외' : '');
  return ` · 실패 ${failed.length}개: ${names}`;
}

/** B1 완료 토스트 — 「N개 I2I 씬 생성(이미지 첨부 M개)」 + 실패. */
export function i2iCopyResultText(r: {
  created: number;
  withImage: number;
  failed: readonly string[];
  firstError?: string;
}): string {
  const head = `${r.created}개 I2I 씬 생성(이미지 첨부 ${r.withImage}개)`;
  const err = r.failed.length > 0 && r.firstError ? `\n첫 오류: ${r.firstError}` : '';
  return head + failedTail(r.failed) + err;
}

/** B2 완료 토스트 — 「N개 I2I 씬에 이미지 첨부」 + 건너뜀(인페인트/미러 등) + 실패. */
export function imageAttachResultText(r: {
  applied: number;
  skipped: number;
  failed: readonly string[];
}): string {
  const skipped = r.skipped > 0 ? ` · 건너뜀 ${r.skipped}개(인페인트/미러 등)` : '';
  return `${r.applied}개 I2I 씬에 이미지를 첨부했습니다${skipped}${failedTail(r.failed)}`;
}

/** 결과 토스트 종류 — 하나도 못 했으면 error, 일부 실패면 info, 다 됐으면 success. */
export function batchResultKind(done: number, failed: number): 'error' | 'info' | 'success' {
  if (done === 0 && failed > 0) return 'error';
  return failed > 0 ? 'info' : 'success';
}

/**
 * B2 대상 나누기 — 이미지 투 이미지(SDI2I) 씬만 대상, 나머지(인페인트·미러·이미지 수정)는 건너뜀.
 */
export function splitI2ITargets<T extends { workflowType?: string }>(
  scenes: readonly T[],
): { targets: T[]; skipped: T[] } {
  const targets: T[] = [];
  const skipped: T[] = [];
  for (const s of scenes) {
    if (s.workflowType === I2I_WORKFLOW_TYPE) targets.push(s);
    else skipped.push(s);
  }
  return { targets, skipped };
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
 * B1 조합 모드 프리셋(2026-10-04 B4, SPEC §7-4) — 생성 설정(샘플링 등)은 잡에서 같은 규칙(applyImportedJob)으로 옮기고,
 * 프롬프트 자리는 조합 모드 규칙으로 채운다: prompt = 첫 조합의 중간 프롬프트(롤백·조합 모드 끄기용),
 * uc = 씬 네거티브(씬 캐릭터 UC·씬 전용 네거티브 — 전역 네거티브 제외), characterPrompts = 씬 캐릭터 해석 결과
 * (조각 미해석). 꺼진 캐릭터도 순서 그대로 남긴다 — 조각의 캐릭터란(piece.characterPrompts[i])이 번호로 짝지어지므로
 * 빼면 어긋난다(꺼진 것은 예약 때 전개에서 뺀다). order 는 지운다(배열 순서가 곧 순서).
 * 'snapshot' 이면 상위·하위·전역 네거티브 고정값도 넣는다('shared' 는 빈 값 — 예약 때 사전 세팅을 읽는다).
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

/** 「함께 적용」이면 강도·노이즈를 프리셋에 넣는다. undefined(이미지만)면 그대로. */
export function applyStrengthNoise(preset: any, values: StrengthNoise | undefined): void {
  if (!values) return;
  preset.strength = values.strength;
  preset.noise = values.noise;
}

/** 0~1 숫자 입력 해석(0.01 단위 반올림 — 프리셋 슬라이더 step). 아니면 undefined. */
export function parseUnitInterval(raw: string | undefined | null): number | undefined {
  const text = (raw ?? '').trim();
  if (!text) return undefined;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0 || n > 1) return undefined;
  return Math.round(n * 100) / 100;
}

/** 0~1 숫자 하나를 묻는다(검증은 창 안 — 실패면 창 유지). 취소면 undefined. */
async function promptUnitValue(text: string, initial: number): Promise<number | undefined> {
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
 * (처음 값 = defaults, 보통 I2I 프리셋 기본값). 취소 = undefined, 이미지만 = { values: undefined }.
 */
export async function askStrengthNoise(
  defaults: StrengthNoise,
): Promise<{ values: StrengthNoise | undefined } | undefined> {
  const appState = getAppState();
  const choice = (await appState.pushDialogAsync({
    type: 'select',
    text: I2I_BATCH_TEXT.strengthQuestion,
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
  const noise = await promptUnitValue(I2I_BATCH_TEXT.noiseInput(defaults.noise), defaults.noise);
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
