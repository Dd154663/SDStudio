// I2I 조합 모드(2026-10-04 B4) — 변형 씬이 조합 에디터(slots)로 프롬프트를 전개하는지 판정하는 단일 출처(순수, import 없음).
// 계약: SPEC_GUIDE §7-4 「I2I 조합 모드」. 전개(예약)는 variantCombo.ts, 씬 필드는 types.ts InpaintScene.comboMode.
//
// - 'shared'   = 상위/하위 프롬프트·전역 네거티브를 현재 사전 세팅에서 실시간 공유(미러와 같음).
// - 'snapshot' = 복사 시점 값을 I2I 프리셋(frontPrompt·backPrompt·globalUc)에 고정해 그 값을 쓴다.
// - 없음(undefined) = 조합 모드 아님 — 단일 프롬프트(preset.prompt). 남아 있는 slots 는 무시한다.
// 미러(SDMirror)는 필드 없이 항상 'shared' 와 같은 경로를 탄다(동작 = 실시간 공유).
// 조합 모드를 고를 수 있는 워크플로우 = I2I(SDI2I)·인페인트(SDInpaint, 2026-10-04 P1 — Focused·마스크는 그대로).

export type ComboMode = 'shared' | 'snapshot';

export const COMBO_MODES: readonly ComboMode[] = ['shared', 'snapshot'];

export const MIRROR_WORKFLOW = 'SDMirror';
export const I2I_COMBO_WORKFLOW = 'SDI2I';
export const INPAINT_COMBO_WORKFLOW = 'SDInpaint';

/** comboMode 필드를 쓰는 워크플로우(I2I·인페인트). 미러는 필드 없이 항상 조합. */
export const COMBO_OPTIONAL_WORKFLOWS: ReadonlySet<string> = new Set([
  I2I_COMBO_WORKFLOW,
  INPAINT_COMBO_WORKFLOW,
]);

/** 저장값 해석 — 알 수 없는 값·손상값은 조합 모드 아님(undefined). */
export function normalizeComboMode(value: unknown): ComboMode | undefined {
  return COMBO_MODES.includes(value as ComboMode) ? (value as ComboMode) : undefined;
}

/**
 * 변형 씬의 조합 전개 방식 — 미러 = 'shared', 조합 모드 I2I·인페인트 = 저장값,
 * 그 밖(단일 I2I·단일 인페인트·이미지 수정) = undefined.
 */
export function variantComboMode(scene: {
  workflowType?: string;
  comboMode?: unknown;
}): ComboMode | undefined {
  if (scene.workflowType === MIRROR_WORKFLOW) return 'shared';
  if (scene.workflowType && COMBO_OPTIONAL_WORKFLOWS.has(scene.workflowType)) {
    return normalizeComboMode(scene.comboMode);
  }
  return undefined;
}

/** 조합 에디터·조합 전개를 쓰는 변형 씬인가(미러 또는 조합 모드 I2I·인페인트). */
export function isComboVariant(scene: { workflowType?: string; comboMode?: unknown }): boolean {
  return variantComboMode(scene) !== undefined;
}

/** 편집 창(InPaintEditor) 문구 — 조합 모드 I2I·인페인트·미러의 「프롬프트 에디터」 탭. */
export const COMBO_EDITOR_TEXT = {
  sharedFront: '상위 프롬프트 (전역):',
  sharedBack: '하위 프롬프트 (전역):',
  sharedUc: '네거티브 프롬프트 (전역):',
  snapshotFront: '상위 프롬프트 (복사 시점 고정):',
  snapshotBack: '하위 프롬프트 (복사 시점 고정):',
  snapshotUc: '전역 네거티브 프롬프트 (복사 시점 고정):',
  middle: '중간 프롬프트 (이 씬에만 적용됨):',
  modeShared: '조합 모드 · 사전 세팅과 실시간 공유',
  modeSnapshot: '조합 모드 · 복사 시점 설정 고정',
  turnOff: '조합 모드 끄기',
  turnOffConfirm: (middle: string) =>
    `조합 모드를 끌까요?\n앞으로 이 씬은 단일 프롬프트(첫 조합: ${middle || '(비어 있음)'})로 생성합니다.\n` +
    '상위·하위 프롬프트와 전역 네거티브는 더 이상 붙지 않고, 조합(슬롯)은 남지만 쓰이지 않습니다. 다시 켤 수는 없습니다.',
} as const;

/** 조합이 0종이라 예약하지 않았을 때(활성 조각이 없는 열이 있음 — 조합 에디터 「미리보기 0종」과 같은 규칙). */
export const COMBO_EMPTY_TEXT =
  '예약할 조합이 없습니다. 조합 에디터에서 모든 열에 켜진 조각이 하나 이상 있어야 합니다.';
