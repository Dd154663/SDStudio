// 이미지 메타데이터 → 프롬프트 칸 분배(2026-10-05) — 「메타데이터 적용」(ExternalImageView)과
// 「이미지를 글로벌 프리셋으로」(GlobalPresetService)가 같은 규칙을 쓴다. 계약: SPEC_GUIDE 「SDStudio 전용 메타데이터」 줄.
//
// - SDStudio 전용 메타(promptSource, shared/sdstudioImageMetadata.ts)가 있고 대상이 이미지 생성 프리셋이면
//   상위→상위, 하위→하위, 추가→프로젝트 추가 프롬프트, 씬(중간)→현재 씬(사용자가 고를 때)으로 나눈다.
// - 놓을 자리가 없는 구획은 버리지 않고 생성 순서(상위→추가→씬→하위, PromptService.createSDPrompts)를 지키며 합친다:
//   추가는 상위 끝에, 씬은 하위 앞에(씬 정보가 없는 외부 이미지). 이미지가 나온 일반 씬이 있는데 씬을 바꾸지 않기로 하면
//   씬 구획은 그 씬이 이미 갖고 있으므로 프리셋에 넣지 않는다(중복 방지).
//   이지 모드 캐릭터 태그는 상위 끝, 배경 태그는 하위 앞(일반 대상일 때).
// - 메타가 없거나(NAI 공식·옛 SDStudio·I2I/인페인트 결과) 대상이 다른 워크플로우면 예전처럼 통합 프롬프트 → 상위.
import type { SDStudioPromptSourceV1 } from '../../shared/sdstudioImageMetadata';

/** 구획 분배를 지원하는 대상 프리셋 타입(이미지 생성 일반·이지). */
export const SPLIT_PROMPT_WORKFLOWS: ReadonlySet<string> = new Set([
  'SDImageGen',
  'SDImageGenEasy',
]);

const EASY_WORKFLOW = 'SDImageGenEasy';

export interface PromptImportOptions {
  /** 값을 넣을 프리셋 타입. */
  targetType: string | undefined;
  /** 프로젝트 추가 프롬프트에 넣을 수 있는가(세션 대상). false 면 상위 끝에 합친다. */
  placeExtra: boolean;
  /** 씬(중간) 구획 처리: 'scene' = 현재 씬에 넣음, 'omit' = 프리셋에 넣지 않음(씬이 이미 가짐), 'fold' = 하위 앞에 합침. */
  middle: 'scene' | 'omit' | 'fold';
}

export interface PromptImportPlan {
  /** true = 구획별 분배, false = 통합 프롬프트를 상위에(예전 동작). */
  split: boolean;
  frontPrompt: string;
  /** split 일 때만 값이 있다(통합이면 호출부 기존 규칙). */
  backPrompt?: string;
  /** 프로젝트 추가 프롬프트 — undefined 면 건드리지 않는다. */
  extraPrompt?: string;
  /** 씬 중간 프롬프트 — undefined 면 씬을 건드리지 않는다. */
  middlePrompt?: string;
  /** 이지 모드 대상의 공유 캐릭터·배경 태그 — undefined 면 건드리지 않는다. */
  characterPrompt?: string;
  backgroundPrompt?: string;
}

/** 쉼표 이어 붙이기(빈 칸 제외) — 생성 경로 toPARR 가 쉼표로 나누므로 결과 태그 순서가 같다. */
export function joinPromptSections(
  ...parts: (string | undefined | null)[]
): string {
  return parts
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join(', ');
}

export function canSplitPromptImport(
  source: SDStudioPromptSourceV1 | undefined,
  targetType: string | undefined,
): source is SDStudioPromptSourceV1 {
  return !!source && !!targetType && SPLIT_PROMPT_WORKFLOWS.has(targetType);
}

export function planPromptImport(
  mergedPrompt: string | undefined,
  source: SDStudioPromptSourceV1 | undefined,
  opts: PromptImportOptions,
): PromptImportPlan {
  if (!canSplitPromptImport(source, opts.targetType)) {
    return { split: false, frontPrompt: mergedPrompt ?? '' };
  }
  const targetEasy = opts.targetType === EASY_WORKFLOW;
  const plan: PromptImportPlan = { split: true, frontPrompt: '', backPrompt: '' };

  let front = source.frontPrompt;
  let back = source.backPrompt;
  if (targetEasy) {
    // 이지 대상: 캐릭터·배경 태그는 공유 칸 그대로(일반 이미지면 비워 생성 당시와 같게).
    plan.characterPrompt = source.characterPrompt ?? '';
    plan.backgroundPrompt = source.backgroundPrompt ?? '';
  } else {
    front = joinPromptSections(front, source.characterPrompt);
    back = joinPromptSections(source.backgroundPrompt, back);
  }

  if (opts.placeExtra) plan.extraPrompt = source.extraPrompt;
  else front = joinPromptSections(front, source.extraPrompt);

  if (opts.middle === 'scene') plan.middlePrompt = source.middlePrompt;
  else if (opts.middle === 'fold') back = joinPromptSections(source.middlePrompt, back);

  plan.frontPrompt = front;
  plan.backPrompt = back;
  return plan;
}

/** 씬 칸이 이미 「중간 프롬프트 하나」와 같은가(같으면 씬 교체 확인이 필요 없다). */
export function sceneSlotsMatchMiddle(
  slots: ReadonlyArray<ReadonlyArray<{ prompt?: string; enabled?: boolean }>>,
  middle: string,
): boolean {
  if (!middle.trim()) {
    // 빈 중간 = 칸마다 켜진 조각이 있고 모두 빈 글자(칸 0개 포함)면 이미 같은 결과
    // (켜진 조각이 없는 칸은 조합 0종 — dfsPrompts).
    return slots.every(
      (slot) =>
        slot.some((p) => p.enabled !== false) &&
        slot.every((p) => p.enabled === false || !(p.prompt ?? '').trim()),
    );
  }
  return (
    slots.length === 1 &&
    slots[0].length === 1 &&
    slots[0][0].enabled !== false &&
    (slots[0][0].prompt ?? '') === middle
  );
}
