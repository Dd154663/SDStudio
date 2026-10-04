// 대량 작업 「🎭 인페인트 마스크 일괄 적용」(P3)·「🎚️ 강도·노이즈 일괄 변경」(P4) — 순수 규칙·문구(2026-10-04).
// 흐름(씬 선택·마스크 파일 저장·적용)은 variantBatchFlow.ts, 계약은 SPEC_GUIDE §6 「대량 작업 I2I」·§7-2.
// 이 파일은 서비스(models/index)를 import 하지 않는다 — jest variantBatch.test.ts 가 그대로 부른다.
import { clampFocusRect, normalizeFocusContext } from './focusedInpaint';
import type { FocusRect } from './focusedInpaint';
import { focusRectPresetPatch, presetFocusRect } from './focusedInpaintEditor';
import {
  failedTail,
  I2I_WORKFLOW_TYPE,
  INPAINT_WORKFLOW_TYPE,
  MIRROR_WORKFLOW_TYPE,
  workflowHasNoise,
} from './i2iBatch';

export const VARIANT_BATCH_TEXT = {
  maskMenu: '🎭 인페인트 마스크 일괄 적용',
  strengthMenu: '🎚️ 강도·노이즈 일괄 변경',
  maskSourceSelect: '🎭 마스크를 가져올 인페인트 씬 하나 선택(마스크가 있는 씬)',
  maskTargetSelect: '🎭 마스크를 적용할 인페인트 씬 선택',
  noMaskSources: '마스크가 있는 인페인트 씬이 없습니다. 인페인트 편집 창에서 마스크를 먼저 칠해 주세요.',
  pickOneMaskSource: '마스크를 가져올 씬을 하나만 선택해 주세요.',
  maskSourceReadFailed: '원본 씬의 마스크를 읽지 못했습니다.',
  noMaskTargets: (skipped: number) =>
    `마스크를 적용할 인페인트 씬(이미지 있음)이 없습니다.${skipped > 0 ? ` (건너뜀 ${skipped}개: 이미지 없음/미러/I2I 등)` : ''}`,
  maskOverwriteConfirm: (overwriting: number, total: number) =>
    `대상 인페인트 씬 ${total}개 중 ${overwriting}개는 이미 마스크가 있습니다.\n원본 씬의 마스크로 바꿀까요?\n(옛 마스크 파일은 지우지 않습니다.)`,
  maskOverwriteButton: '바꾸기',
  strengthTargetSelect: '🎚️ 강도·노이즈를 바꿀 변형 씬 선택(I2I·인페인트·미러)',
  noStrengthTargets: (skipped: number) =>
    `선택한 씬 중 강도를 바꿀 수 있는 씬(I2I·인페인트·미러)이 없습니다.${skipped > 0 ? ` (건너뜀 ${skipped}개)` : ''}`,
  strengthInput: (current: number) => `새 강도를 입력해 주세요 (0~1, 첫 대상의 현재 값 ${current})`,
  noiseQuestion: (count: number) => `I2I 씬 ${count}개의 노이즈도 바꿀까요?`,
  noiseChange: (current: number) => `변경(값 입력, 첫 I2I 씬의 현재 값 ${current})`,
  noiseKeep: '유지',
  noiseInput: (current: number) => `새 노이즈를 입력해 주세요 (0~1, 첫 I2I 씬의 현재 값 ${current})`,
} as const;

/** 마스크 원본 후보 — 마스크가 있는 인페인트 씬. */
export function isMaskSource(scene: { workflowType?: string; preset?: any }): boolean {
  return scene.workflowType === INPAINT_WORKFLOW_TYPE && !!scene.preset?.mask;
}

/**
 * P3 대상 나누기 — 첨부 이미지가 있는 인페인트 씬만 대상(마스크 크기를 이미지에 맞춘다).
 * 이미지 없는 인페인트·미러·I2I·이미지 수정은 건너뜀. 원본 씬 자신은 대상·건너뜀 어디에도 세지 않는다.
 */
export function splitMaskTargets<T extends { name: string; workflowType?: string; preset?: any }>(
  scenes: readonly T[],
  sourceName: string,
): { targets: T[]; skipped: T[] } {
  const targets: T[] = [];
  const skipped: T[] = [];
  for (const s of scenes) {
    if (s.name === sourceName) continue;
    if (s.workflowType === INPAINT_WORKFLOW_TYPE && !!s.preset?.image) targets.push(s);
    else skipped.push(s);
  }
  return { targets, skipped };
}

/** 마스크 크기가 대상 이미지와 같은가(같으면 원본 마스크 PNG 를 그대로, 다르면 최근접 크기 변경). */
export function sameSize(
  a: { width: number; height: number },
  b: { width: number; height: number },
): boolean {
  return a.width === b.width && a.height === b.height;
}

/** 대상에 쓸 Focused 값(focusEnabled·focusX/Y/W/H·focusContext). */
export interface FocusPatch {
  focusEnabled: boolean;
  focusX: number | null;
  focusY: number | null;
  focusW: number | null;
  focusH: number | null;
  focusContext: number;
}

/**
 * P3 — 원본 씬의 Focused 값을 대상 이미지에 맞춘다. 사각형(원본 이미지 픽셀 = 원본 마스크 크기 기준)은
 * 크기가 다르면 마스크와 같은 비율로 옮긴 뒤 `clampFocusRect`(8px 격자·768² 상한·이미지 안)로 대상 크기에 맞춘다.
 * 사각형이 없거나 클램프할 수 없으면(대상 이미지 32px 미만) 사각형 없음 + focusEnabled false.
 */
export function focusPatchForTarget(
  sourcePreset: any,
  sourceSize: { width: number; height: number },
  targetSize: { width: number; height: number },
): FocusPatch {
  const rect = presetFocusRect(sourcePreset);
  let clamped: FocusRect | null = null;
  if (rect) {
    const sx = sourceSize.width > 0 ? targetSize.width / sourceSize.width : 1;
    const sy = sourceSize.height > 0 ? targetSize.height / sourceSize.height : 1;
    const moved = sameSize(sourceSize, targetSize)
      ? rect
      : { x: rect.x * sx, y: rect.y * sy, w: rect.w * sx, h: rect.h * sy };
    clamped = clampFocusRect(moved, targetSize.width, targetSize.height);
  }
  return {
    focusEnabled: sourcePreset?.focusEnabled === true && !!clamped,
    ...focusRectPresetPatch(clamped),
    focusContext: normalizeFocusContext(sourcePreset?.focusContext),
  };
}

/** P3 완료 토스트 — 「N개 인페인트 씬에 마스크를 적용했습니다 · 크기 맞춤 M개 · 건너뜀 K개」 + 실패. */
export function maskApplyResultText(r: {
  applied: number;
  resized: number;
  skipped: number;
  failed: readonly string[];
}): string {
  const resized = r.resized > 0 ? ` · 크기 맞춤 ${r.resized}개` : '';
  const skipped = r.skipped > 0 ? ` · 건너뜀 ${r.skipped}개(이미지 없음/미러/I2I 등)` : '';
  return `${r.applied}개 인페인트 씬에 마스크를 적용했습니다${resized}${skipped}${failedTail(r.failed)}`;
}

/**
 * P4 대상 워크플로우 — 강도를 쓰는 변형 워크플로우. 미러 핸들러도 내부 인페인트 핸들러로 preset.strength 를 보내므로 포함
 * (노이즈는 I2I 만). 이미지 수정(Augment) 등은 건너뜀.
 */
const STRENGTH_TARGET_WORKFLOWS: ReadonlySet<string> = new Set([
  I2I_WORKFLOW_TYPE,
  INPAINT_WORKFLOW_TYPE,
  MIRROR_WORKFLOW_TYPE,
]);

export function splitStrengthTargets<T extends { workflowType?: string; preset?: any }>(
  scenes: readonly T[],
): { targets: T[]; skipped: T[] } {
  const targets: T[] = [];
  const skipped: T[] = [];
  for (const s of scenes) {
    if (s.workflowType && STRENGTH_TARGET_WORKFLOWS.has(s.workflowType) && s.preset) targets.push(s);
    else skipped.push(s);
  }
  return { targets, skipped };
}

/** 현재 값 제안 — 숫자가 아니면 기본값. */
export function currentUnitValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * P4 적용 — 모든 대상에 강도, I2I 에만 노이즈(값이 있을 때). 인페인트·미러 프리셋에는 noise 키를 만들지 않는다.
 * 호출부가 runInAction 한 번으로 감싼다. 반환 = 바꾼 씬 수·노이즈를 바꾼 씬 수.
 */
export function applyStrengthBatch(
  scenes: readonly { workflowType?: string; preset?: any }[],
  values: { strength: number; noise?: number },
): { changed: number; noiseChanged: number } {
  let changed = 0;
  let noiseChanged = 0;
  for (const s of scenes) {
    if (!s.preset) continue;
    s.preset.strength = values.strength;
    changed++;
    if (values.noise !== undefined && workflowHasNoise(s.workflowType)) {
      s.preset.noise = values.noise;
      noiseChanged++;
    }
  }
  return { changed, noiseChanged };
}

/** P4 완료 토스트 — 「N개 씬의 강도를 X로 바꿨습니다(노이즈 Y — I2I M개)」 + 건너뜀 + 실패. */
export function strengthBatchResultText(r: {
  changed: number;
  strength: number;
  noise?: number;
  noiseChanged: number;
  skipped: number;
  failed: readonly string[];
}): string {
  const noise =
    r.noise !== undefined && r.noiseChanged > 0 ? `(노이즈 ${r.noise} — I2I ${r.noiseChanged}개)` : '';
  const skipped = r.skipped > 0 ? ` · 건너뜀 ${r.skipped}개` : '';
  return `${r.changed}개 씬의 강도를 ${r.strength}(으)로 바꿨습니다${noise}${skipped}${failedTail(r.failed)}`;
}
