// 일괄 삽입(2026-11-14 A-3 — 찾기 및 변환 창에서 독립 창 「일괄 삽입」으로 분리, 변형 씬도 대상).
// SPEC_GUIDE 「오버레이 창 크기 체계」 창별 배정표 「일괄 삽입」·되돌리기 계측 표·「생성/변형 모드 행동 동등성 규약」,
// jest overlayBatchInsert.test.tsx.
//
// · 대상 종류
//   - 'scene'         = 이미지생성 씬 — 조합 slots 의 조각 prompt 앞/뒤(모든 슬롯·열 n만), 또는 새 열(맨 뒤) 추가(종전 동작 그대로).
//   - 'comboVariant'  = 조합 모드 변형 씬(미러·조합 모드 I2I·인페인트, `variantComboMode` 참) — 이미지생성 씬과 같은 slots 처리.
//                       첫 조각은 preset.prompt 와 이중 보관(편집 창 중간 프롬프트)이라 값이 같으면 함께 맞춘다(찾기와 같은 규칙).
//                       slots 가 비었으면 preset.prompt 한 조각짜리 열 하나로 본다(variantCombo.ts 전개와 같음).
//   - 'singleVariant' = 단일 프롬프트 변형 씬(I2I·인페인트, 조합 모드 아님) — preset.prompt 앞/뒤. 「열 n만」「새 열」은 적용 불가.
//   - 그 밖의 변형(이미지 수정 등 프롬프트 칸이 없는 워크플로우)은 대상이 아니다(undefined).
// · 되돌리기: 한 번의 [적용] = 1항목(묶음 — 실제로 바뀐 씬만 하위 항목, 되돌림 역순). 이미지생성 씬 = captureSceneFields(slots),
//   변형 씬 = captureVariantFields(slots + preset.prompt). 라벨 UNDO_TEXT.comboBatchInsert(바뀐 씬 수). 이미지 필드는 담지 않는다.
// · 데이터 형식 변경 없음(기존 필드에 대입만, 저장은 기존 RS.watch 자동 persist). 잠금을 쓰지 않는다.
import { v4 as uuidv4 } from 'uuid';
import { variantComboMode } from './comboMode';
import { captureSceneFields, flushSceneFieldEdit } from './sceneFieldUndo';
import { captureVariantFields } from './variantSceneUndo';
import type { VariantFieldKeys } from './variantSceneUndo';
import { PromptPiece } from './types';
import type { GenericScene, InpaintScene, Session } from './types';
import { undoService, UNDO_TEXT, UndoPending, UndoService } from './undoService';

/** 단일 프롬프트(preset.prompt)를 쓰는 변형 워크플로우(조합 모드가 아닐 때) — FindReplaceDialog 의 같은 이름 상수와 같은 값 */
export const SINGLE_PROMPT_VARIANTS: ReadonlySet<string> = new Set(['SDI2I', 'SDInpaint']);

export type InsertTargetKind = 'scene' | 'comboVariant' | 'singleVariant';
export type InsertPosition = 'prepend' | 'append';
/** 'all' = 모든 슬롯 · 숫자 = 그 열(0부터)만 · 'new-column' = 새 열로 추가 */
export type InsertSlotTarget = 'all' | 'new-column' | number;

export interface BatchInsertOptions {
  text: string;
  position: InsertPosition;
  slotTarget: InsertSlotTarget;
}

/** 변형 씬이 받은 변경을 되돌리기에 담을 키(slots + 이중 보관 preset.prompt) */
export const BATCH_INSERT_VARIANT_KEYS: VariantFieldKeys = { scene: ['slots'], preset: ['prompt'] };

/** 씬의 일괄 삽입 대상 종류(대상이 아니면 undefined) */
export function insertTargetKind(scene: GenericScene): InsertTargetKind | undefined {
  if (scene.type !== 'inpaint') return 'scene';
  if (variantComboMode(scene)) return 'comboVariant';
  if (SINGLE_PROMPT_VARIANTS.has(scene.workflowType)) return 'singleVariant';
  return undefined;
}

/** 변형 씬이 삽입 대상인가(씬 선택 목록 거르기용) */
export const isInsertableVariant = (scene: InpaintScene) => insertTargetKind(scene) !== undefined;

/** 구분자(, )를 위치에 맞춰 붙인다 — 비어 있으면 넣을 말만 */
export function joinInsert(cur: string | undefined, text: string, position: InsertPosition): string {
  if (!cur) return text;
  return position === 'append' ? cur + ', ' + text : text + ', ' + cur;
}

/** slots 처리 대상(이미지생성·조합 변형)의 열 수 — 조합 변형의 빈 slots 는 preset.prompt 열 하나 */
function columnCount(scene: GenericScene, kind: InsertTargetKind): number {
  if (kind === 'comboVariant' && scene.slots.length === 0) return 1;
  return scene.slots.length;
}

/** 선택 씬 중 slots 처리 대상(이미지생성·조합 변형)이 있는가 — 없으면 「열 n만」「새 열」 비활성 */
export function hasSlotTargets(scenes: readonly GenericScene[]): boolean {
  return scenes.some((s) => {
    const k = insertTargetKind(s);
    return k === 'scene' || k === 'comboVariant';
  });
}

/** 「열 n만」 선택지 수 = slots 처리 대상 중 가장 많은 열 수 */
export function maxSlotRowOf(scenes: readonly GenericScene[]): number {
  let max = 0;
  for (const s of scenes) {
    const k = insertTargetKind(s);
    if (k !== 'scene' && k !== 'comboVariant') continue;
    max = Math.max(max, columnCount(s, k));
  }
  return max;
}

/** slots 처리 대상이 없으면 열 지정은 의미가 없어 「모든 슬롯」으로 본다(단일 프롬프트 변형만 선택) */
export function effectiveSlotTarget(scenes: readonly GenericScene[], target: InsertSlotTarget): InsertSlotTarget {
  return hasSlotTargets(scenes) ? target : 'all';
}

export interface BatchInsertCounts {
  /** 텍스트가 들어간(들어갈) 조각 수 — 이미지생성·조합 변형 */
  slots: number;
  /** 새 열이 추가된(추가될) 씬 수 — 이미지생성·조합 변형 */
  newColumns: number;
  /** preset.prompt 에 들어간(들어갈) 단일 프롬프트 변형 수 */
  singlePrompt: number;
}

/** 적용 예정 수(미리보기) — 실제 적용과 같은 규칙 */
export function countBatchInsert(scenes: readonly GenericScene[], opts: BatchInsertOptions): BatchInsertCounts {
  const out: BatchInsertCounts = { slots: 0, newColumns: 0, singlePrompt: 0 };
  if (!opts.text.trim()) return out;
  const target = effectiveSlotTarget(scenes, opts.slotTarget);
  for (const s of scenes) {
    const kind = insertTargetKind(s);
    if (!kind) continue;
    if (kind === 'singleVariant') {
      out.singlePrompt++;
      continue;
    }
    if (target === 'new-column') {
      out.newColumns++;
      continue;
    }
    if (kind === 'comboVariant' && s.slots.length === 0) {
      if (target === 'all' || target === 0) out.slots++;
      continue;
    }
    if (target === 'all') for (const slot of s.slots) out.slots += slot.length;
    else if (target < s.slots.length) out.slots += s.slots[target].length;
  }
  return out;
}

/** 조각 하나에 넣기 — 조합 변형의 첫 조각은 preset.prompt 와 같으면 함께(이중 보관) */
function insertIntoPiece(scene: GenericScene, kind: InsertTargetKind, si: number, pi: number, text: string, position: InsertPosition) {
  const piece = scene.slots[si][pi];
  const next = joinInsert(piece.prompt, text, position);
  if (kind === 'comboVariant' && si === 0 && pi === 0) {
    const preset = (scene as InpaintScene).preset;
    if (preset && preset.prompt === piece.prompt) preset.prompt = next;
  }
  piece.prompt = next;
}

const newPiece = (prompt: string) =>
  PromptPiece.fromJSON({ prompt, characterPrompts: [], enabled: true, id: uuidv4() });

/** 기록 없이 대입만(되돌리기 래퍼 applyBatchInsertRecorded 가 감싼다) */
export function applyBatchInsertRaw(scenes: readonly GenericScene[], opts: BatchInsertOptions): BatchInsertCounts {
  const out: BatchInsertCounts = { slots: 0, newColumns: 0, singlePrompt: 0 };
  const text = opts.text.trim();
  if (!text) return out;
  const target = effectiveSlotTarget(scenes, opts.slotTarget);
  for (const scene of scenes) {
    const kind = insertTargetKind(scene);
    if (!kind) continue;
    if (kind === 'singleVariant') {
      const preset = (scene as InpaintScene).preset;
      if (!preset) continue;
      preset.prompt = joinInsert(preset.prompt, text, opts.position);
      out.singlePrompt++;
      continue;
    }
    const emptyCombo = kind === 'comboVariant' && scene.slots.length === 0;
    if (target === 'new-column') {
      // 조합 변형의 빈 slots = preset.prompt 열 하나 — 새 열을 붙이기 전에 그 열을 실제 조각으로 만든다(전개 결과 불변)
      if (emptyCombo) scene.slots.push([newPiece((scene as InpaintScene).preset?.prompt ?? '')]);
      scene.slots.push([newPiece(text)]);
      out.newColumns++;
      continue;
    }
    if (emptyCombo) {
      if (target !== 'all' && target !== 0) continue;
      const preset = (scene as InpaintScene).preset;
      if (!preset) continue;
      preset.prompt = joinInsert(preset.prompt, text, opts.position);
      out.slots++;
      continue;
    }
    scene.slots.forEach((slot, si) => {
      if (target !== 'all' && target !== si) return;
      slot.forEach((_p, pi) => {
        insertIntoPiece(scene, kind, si, pi, text, opts.position);
        out.slots++;
      });
    });
  }
  return out;
}

export interface BatchInsertUndoOptions {
  service?: UndoService;
}

export interface BatchInsertOutcome extends BatchInsertCounts {
  /** 되돌리기 항목이 생겼는가 */
  recorded: boolean;
}

/**
 * [적용] — 선택한 씬(이미지생성 + 변형)에 넣고 되돌리기 1항목으로 묶는다. 화면 갱신(완료 문구)은 호출부.
 */
export function applyBatchInsertRecorded(
  session: Session | undefined,
  scenes: readonly GenericScene[],
  opts: BatchInsertOptions,
  undoOpts: BatchInsertUndoOptions = {},
): BatchInsertOutcome {
  const service = undoOpts.service ?? undoService;
  const targets = Array.from(new Set(scenes)).filter((s) => insertTargetKind(s) !== undefined);
  if (!session || !service.canRecord(session)) {
    return { ...applyBatchInsertRaw(targets, opts), recorded: false };
  }
  // 열린 편집 세션(프롬프트 입력 중)은 먼저 확정 — 기록 순서 = 동작 순서
  flushSceneFieldEdit();
  const label = UNDO_TEXT.comboBatchInsert;
  const group = service.beginGroup(session, label(0));
  const pendings: UndoPending[] = targets.map((s) =>
    s.type === 'inpaint'
      ? captureVariantFields(session, s, BATCH_INSERT_VARIANT_KEYS, label(1), { service })
      : captureSceneFields(session, s, ['slots'], label(1), { service }),
  );
  let counts: BatchInsertCounts = { slots: 0, newColumns: 0, singlePrompt: 0 };
  let recorded = false;
  try {
    counts = applyBatchInsertRaw(targets, opts);
  } finally {
    const changed = pendings.map((p) => p.commit()).filter(Boolean).length;
    group.setLabel(label(changed));
    recorded = group.commit();
  }
  return { ...counts, recorded };
}

const posWord = (p: InsertPosition) => (p === 'append' ? '뒤' : '앞');

/** 적용 예정(preview)·완료(done) 문구 — 단일 프롬프트 변형은 따로 적는다 */
export function batchInsertSummary(
  counts: BatchInsertCounts,
  target: InsertSlotTarget,
  position: InsertPosition,
  mode: 'preview' | 'done',
): string {
  const parts: string[] = [];
  const done = mode === 'done';
  if (target === 'new-column') {
    if (counts.newColumns > 0 || counts.singlePrompt === 0) {
      parts.push(done ? `${counts.newColumns}개 씬에 새 열이 추가되었습니다` : `${counts.newColumns}개 씬에 새 열 추가 예정`);
    }
  } else if (counts.slots > 0 || counts.singlePrompt === 0) {
    parts.push(done ? `${counts.slots}개 슬롯에 텍스트가 삽입되었습니다` : `${counts.slots}개 슬롯에 적용 예정`);
  }
  if (counts.singlePrompt > 0) {
    parts.push(
      done
        ? `단일 프롬프트 변형 ${counts.singlePrompt}개는 프롬프트 ${posWord(position)}에 삽입했습니다`
        : `단일 프롬프트 변형 ${counts.singlePrompt}개는 프롬프트 ${posWord(position)}에 삽입`,
    );
  }
  return parts.join(' · ');
}

/** 적용할 것이 있는가([적용] 활성 판정) */
export const batchInsertTotal = (c: BatchInsertCounts) => c.slots + c.newColumns + c.singlePrompt;
