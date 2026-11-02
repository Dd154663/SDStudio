// 사전 세팅(그림체)·공용 설정·바이브·레퍼런스·로컬 캐릭터 프리셋의 되돌리기 계측(2026-11-02 U3b, SPEC_GUIDE 「되돌리기 계약」,
// jest undoPreset.test.ts).
//
// · 기록은 호출부(UI·흐름 계층)의 사용자 동작 지점에서만 이 모듈의 헬퍼로 한다. PreSetEditor 의 렌더 중 자동 보정
//   (작업모드·사전 세팅 목록·공용 설정·선택 이름 보충)과 마운트 중 샘플링 계열 활성화는 이 헬퍼를 거치지 않는다(기록 금지).
// · 기록 대상 범위 = 현재 프로젝트의 그림체(session.presets 안의 객체)·공용 설정(session.presetShareds 의 값)·프로젝트 필드
//   (추가 프롬프트·새 씬 해상도·선택)·로컬 캐릭터 프리셋. 같은 편집기를 쓰는 변형 씬 프리셋(U5)·씬 메타(레거시 증강 워크플로우)·
//   글로벌 라이브러리(보류)는 대입만 하고 기록하지 않는다.
// · 그림체 목록(추가·복제·삭제·순서·불러오기·글로벌→프로젝트)은 「목록 차분」으로 되돌린다 — 그 동작이 넣은 객체는 빼고,
//   뺀 객체는 **같은 객체**를 원래 자리에 다시 넣는다(삭제는 파일을 지우지 않으므로 대표 이미지 등은 그대로 — 손잡이 rebind 불필요).
//   그사이 기록 밖에서 생긴 그림체는 지우지 않고 뒤에 남긴다(씬 순서와 같은 병합 복원). 다시 넣을 이름을 다른 그림체가 쓰면 그 항목만 실패.
// · 필드 편집은 PreSetEditor 의 setField 한 곳(setWorkflowField)으로 모은다 — 샘플링 필드는 필드 + 샘플링 프로필(samplingProfiles·
//   samplingProfileFamily·다른 샘플링 미러 필드)을 함께 보관한다. 같은 칸 1초 안 연속 = 1항목(D12), 슬라이더는 누름~뗌 1항목,
//   글자 입력은 편집 세션(D13 — sceneFieldUndo.touchUndoEdit 공유, 한 번에 하나만 열림).
// · 이미지 필드(imageMap·mains·game·round)는 다루지 않는다. 이 모듈은 잠금을 쓰지 않는다(MobX 대입만 — 저장은 기존 RS.watch).
import { runInAction } from 'mobx';
import { MODEL_SAMPLING_FIELDS, setPresetSamplingField } from './modelSamplingProfiles';
import type { ModelSamplingFamily } from './modelSamplingProfiles';
import { editTargetId, flushSceneFieldEdit, touchUndoEdit } from './sceneFieldUndo';
import type { FocusLeaveWatcher } from './sceneFieldUndo';
import { CharacterPreset, ReferenceItem, VibeItem } from './types';
import type { ICharacterPreset, IReferenceItem, IVibeItem, SelectedWorkflow, Session } from './types';
import {
  undoDeepClone,
  undoDeepEqual,
  undoService,
  UNDO_TEXT,
  UndoOutcome,
  UndoPending,
  UndoService,
  UndoSnapshotAdapter,
} from './undoService';

export type WorkflowFieldType = 'preset' | 'shared' | 'meta';

/** PreSetEditor 문맥(WFElementContext)의 대상 묶음 */
export interface WorkflowHolders {
  preset?: any;
  shared?: any;
  meta?: any;
}

const NOOP: UndoPending = { commit: () => false, cancel: () => {} };

// ── 범위 판정 ─────────────────────────────────────────────────────────────

/** 이 그림체 객체가 현재 프로젝트 목록에 있으면 그 종류·목록 */
export function projectPresetList(
  session: Session | undefined,
  preset: unknown,
): { type: string; list: any[] } | undefined {
  if (!session || !preset || typeof preset !== 'object') return undefined;
  for (const [type, list] of session.presets) {
    if ((list ?? []).includes(preset)) return { type, list };
  }
  return undefined;
}

export function isProjectPreset(session: Session | undefined, preset: unknown): boolean {
  return !!projectPresetList(session, preset);
}

export function isProjectShared(session: Session | undefined, shared: unknown): boolean {
  if (!session || !shared || typeof shared !== 'object') return false;
  for (const v of session.presetShareds.values()) if (v === shared) return true;
  return false;
}

function holderOf(holders: WorkflowHolders, kind: WorkflowFieldType): any {
  if (kind === 'preset') return holders.preset;
  if (kind === 'shared') return holders.shared;
  return holders.meta;
}

/** 기록 대상인가 — 씬 메타(레거시 증강 워크플로우의 씬 전용 칸)는 기록하지 않는다 */
function inScope(session: Session | undefined, kind: WorkflowFieldType, holder: unknown): boolean {
  if (kind === 'preset') return isProjectPreset(session, holder);
  if (kind === 'shared') return isProjectShared(session, holder);
  return false;
}

/** 실행 직전 — 대상이 아직 이 프로젝트에 있는가 */
function holderCheck(session: Session, kind: WorkflowFieldType | 'session', holder: any): () => true | string {
  if (kind === 'preset') {
    return () => (isProjectPreset(session, holder) ? true : UNDO_TEXT.presetGone(String(holder?.name ?? '')));
  }
  if (kind === 'shared') {
    return () => (isProjectShared(session, holder) ? true : UNDO_TEXT.sharedGone);
  }
  return () => true;
}

/** 라벨 — 그림체 칸이면 그림체 이름, 공용 설정이면 「공용 설정」 */
export function workflowFieldLabel(kind: WorkflowFieldType, fieldLabel: string, holders: WorkflowHolders): string {
  if (kind === 'preset') return UNDO_TEXT.presetField(fieldLabel, String(holders.preset?.name ?? ''));
  return UNDO_TEXT.sharedField(fieldLabel);
}

/** 캐릭터 프롬프트 라벨의 주인(그림체 이름 또는 「공용 설정」) */
export function workflowOwnerName(kind: WorkflowFieldType, holders: WorkflowHolders): string {
  return kind === 'preset' ? String(holders.preset?.name ?? '') : '공용 설정';
}

// ── 값 되살리기 ───────────────────────────────────────────────────────────

const VIBE_KEYS = ['path', 'info', 'strength', 'fromPreset'] as const;
const REFERENCE_KEYS = ['path', 'info', 'strength', 'fidelity', 'referenceType', 'enabled', 'fromPreset'] as const;

/**
 * 바이브·레퍼런스 배열 되살리기 — 사본(평범한 JSON)으로 새 배열을 만들되 지금 배열에 같은 경로의 항목 객체가 있으면 그 객체에
 * 값을 넣어 다시 쓴다(열린 슬라이더·키(path)가 그대로 — 되살릴 때마다 항목이 새로 그려지지 않게). 값은 언제나 사본에서 온다.
 */
function restoreItems(
  current: unknown,
  plain: unknown,
  keys: readonly string[],
  make: (json: any) => any,
): unknown {
  if (!Array.isArray(plain)) return plain;
  const live = Array.isArray(current) ? (current as any[]) : [];
  const used = new Set<object>();
  return plain
    .filter((x) => x && (x as { path?: string }).path)
    .map((json: any) => {
      const hit = live.find((o) => o && typeof o === 'object' && o.path === json.path && !used.has(o));
      if (!hit) return make(json);
      used.add(hit);
      for (const k of keys) hit[k] = json[k];
      return hit;
    });
}

/** 기본 되살리기 — vibes·characterReferences 는 클래스 객체로(같은 경로 객체 재사용), 나머지는 사본 그대로 */
export function restoreWorkflowValue(key: string, plain: unknown, current?: unknown): unknown {
  if (key === 'vibes') return restoreItems(current, plain, VIBE_KEYS, (j) => VibeItem.fromJSON(j as IVibeItem));
  if (key === 'characterReferences') {
    return restoreItems(current, plain, REFERENCE_KEYS, (j) => ReferenceItem.fromJSON(j as IReferenceItem));
  }
  return plain;
}

// ── 필드 상태 짝 ──────────────────────────────────────────────────────────

interface FieldTarget {
  kind: WorkflowFieldType | 'session';
  holder: any;
  keys: string[];
}

function fieldsAdapter(session: Session, targets: readonly FieldTarget[]): UndoSnapshotAdapter<unknown[][]> {
  const checks = targets.map((t) => holderCheck(session, t.kind, t.holder));
  return {
    // 통째 복원 — 기록 밖 변경과 겹치면 확인(D16)
    detectConflict: true,
    verify: () => {
      for (const c of checks) {
        const v = c();
        if (v !== true) return v;
      }
      return true;
    },
    snapshot: () => targets.map((t) => t.keys.map((k) => undoDeepClone(t.holder[k]))),
    restore: (snap) =>
      runInAction(() => {
        targets.forEach((t, i) => {
          t.keys.forEach((k, j) => {
            const plain = undoDeepClone(snap[i]?.[j]);
            if (plain === undefined && !(k in t.holder)) return;
            t.holder[k] = restoreWorkflowValue(k, plain, t.holder[k]);
          });
        });
      }),
  };
}

/** 샘플링 필드면 필드 + 프로필(활성화가 다른 미러 필드도 바꿀 수 있어 샘플링 필드 전부) */
export function workflowFieldKeys(kind: WorkflowFieldType, holder: any, field: string): string[] {
  if (kind === 'preset' && (MODEL_SAMPLING_FIELDS as readonly string[]).includes(field)) {
    const keys = MODEL_SAMPLING_FIELDS.filter((f) => f === field || (holder && f in holder)) as string[];
    return [...keys, 'samplingProfiles', 'samplingProfileFamily'];
  }
  return [field];
}

function assignWorkflowField(
  kind: WorkflowFieldType,
  holder: any,
  field: string,
  value: unknown,
  family: ModelSamplingFamily | undefined,
): void {
  runInAction(() => {
    if (kind === 'preset' && family && setPresetSamplingField(holder, family, field, value)) return;
    holder[field] = value;
  });
}

const slotKey = (holder: object, field: string) => `p|${editTargetId(holder)}|${field}`;

// ── 슬라이더(누름~뗌 1항목) ─────────────────────────────────────────────────

interface OpenSlide {
  session: Session;
  service: UndoService;
  pending: UndoPending;
  covers: Set<string>;
}

let openSlide: OpenSlide | undefined;

function slideCovers(session: Session, service: UndoService, holder: object, field: string): boolean {
  const s = openSlide;
  if (!s || s.session !== session || s.service !== service) return false;
  if (!service.isPendingOpen(session, s.pending)) {
    openSlide = undefined;
    return false;
  }
  return s.covers.has(slotKey(holder, field));
}

/**
 * 누르는 동안 여러 번 바뀌는 칸(슬라이더·캐릭터 위치) — 시작에 보관하고, 열려 있는 동안 같은 칸의 setWorkflowField·
 * setWorkflowItemValue 는 대입만 한다. commit(손 뗌)에 바뀌었으면 1항목. 대상이 기록 범위 밖이면 아무것도 하지 않는다.
 */
export function beginWorkflowSlide(
  session: Session | undefined,
  holders: WorkflowHolders,
  targets: readonly [WorkflowFieldType, string][],
  label: string,
  opts: { service?: UndoService } = {},
): UndoPending {
  const service = opts.service ?? undoService;
  if (!session || !service.canRecord(session)) return NOOP;
  const live: FieldTarget[] = [];
  for (const [kind, field] of targets) {
    const holder = holderOf(holders, kind);
    if (!holder || !inScope(session, kind, holder)) continue;
    live.push({ kind, holder, keys: workflowFieldKeys(kind, holder, field) });
  }
  if (live.length === 0) return NOOP;
  flushSceneFieldEdit();
  if (openSlide) openSlide.pending.commit();
  const inner = service.drag(session, label, fieldsAdapter(session, live));
  const slide: OpenSlide = {
    session,
    service,
    pending: inner,
    covers: new Set(targets.map(([kind, field]) => slotKey(holderOf(holders, kind) ?? {}, field))),
  };
  openSlide = slide;
  const settle = () => {
    if (openSlide === slide) openSlide = undefined;
  };
  return {
    commit: () => {
      settle();
      return inner.commit();
    },
    cancel: () => {
      settle();
      inner.cancel();
    },
  };
}

/** 슬라이더를 누른 직후 부른다 — 어디서 손을 떼든(pointerup·pointercancel) 한 번 확정 */
export function commitOnPointerRelease(pending: UndoPending): void {
  if (typeof window === 'undefined') return;
  const done = () => {
    window.removeEventListener('pointerup', done, true);
    window.removeEventListener('pointercancel', done, true);
    pending.commit();
  };
  window.addEventListener('pointerup', done, true);
  window.addEventListener('pointercancel', done, true);
}

// ── 필드 편집(PreSetEditor setField 집약) ───────────────────────────────────

/** 'merge' = 같은 칸 1초 안 연속은 합침(선택·체크·슬라이더 키보드) · 'edit' = 편집 세션(글자 입력) · 'discrete' = 매번 1항목 */
export type WorkflowFieldMode = 'merge' | 'edit' | 'discrete';

export interface WorkflowFieldOptions {
  label: string;
  mode?: WorkflowFieldMode;
  /** 지금 모델 계열 — 그림체의 샘플링 필드는 setPresetSamplingField 로 프로필까지 함께 바꾼다 */
  family?: ModelSamplingFamily;
  service?: UndoService;
  watch?: FocusLeaveWatcher;
}

/**
 * PreSetEditor 의 setField 단일 지점 — 값을 바꾸고(샘플링 필드는 프로필 동기화 포함) 기록 대상이면 기록한다.
 * 값이 같으면 대입만 한다(기록 없음). 범위 밖(변형 씬 프리셋·씬 메타·미러)도 대입만.
 */
export function setWorkflowField(
  session: Session | undefined,
  holders: WorkflowHolders,
  kind: WorkflowFieldType,
  field: string,
  value: unknown,
  opts: WorkflowFieldOptions,
): void {
  const holder = holderOf(holders, kind);
  if (!holder) return;
  const service = opts.service ?? undoService;
  const apply = () => assignWorkflowField(kind, holder, field, value, opts.family);
  if (
    !session ||
    !service.canRecord(session) ||
    !inScope(session, kind, holder) ||
    Object.is(holder[field], value) ||
    slideCovers(session, service, holder, field)
  ) {
    apply();
    return;
  }
  const target: FieldTarget = { kind, holder, keys: workflowFieldKeys(kind, holder, field) };
  const mode = opts.mode ?? 'merge';
  if (mode === 'edit') {
    touchUndoEdit(session, `${slotKey(holder, field)}|${opts.label}`, opts.label, () => fieldsAdapter(session, [target]), {
      service,
      watch: opts.watch,
    });
    apply();
    return;
  }
  flushSceneFieldEdit();
  const pending = service.track(
    session,
    opts.label,
    fieldsAdapter(session, [target]),
    mode === 'merge' ? { key: slotKey(holder, field) } : undefined,
  );
  try {
    apply();
  } finally {
    pending.commit();
  }
}

/**
 * 배열 칸 안 항목 하나의 값(바이브 IS/RS, 레퍼런스 Strength/Fidelity) — 같은 항목·키 1초 안 연속 = 1항목, 슬라이더가 열려
 * 있으면 대입만. 되돌림은 배열 칸 통째(같은 경로 객체 재사용)라 그사이 지워진 항목도 되살아난다.
 */
export function setWorkflowItemValue(
  session: Session | undefined,
  holders: WorkflowHolders,
  kind: WorkflowFieldType,
  field: string,
  item: any,
  key: string,
  value: unknown,
  label: string,
  opts: { service?: UndoService } = {},
): void {
  const holder = holderOf(holders, kind);
  const service = opts.service ?? undoService;
  const apply = () =>
    runInAction(() => {
      item[key] = value;
    });
  if (
    !holder ||
    !session ||
    !service.canRecord(session) ||
    !inScope(session, kind, holder) ||
    Object.is(item[key], value) ||
    slideCovers(session, service, holder, field)
  ) {
    apply();
    return;
  }
  flushSceneFieldEdit();
  const pending = service.track(
    session,
    label,
    fieldsAdapter(session, [{ kind, holder, keys: [field] }]),
    { key: `${slotKey(holder, field)}|${editTargetId(item)}|${key}` },
  );
  try {
    apply();
  } finally {
    pending.commit();
  }
}

/**
 * 한 번의 동작으로 칸 여러 개를 바꾸는 경우(바이브 추가·삭제·레퍼런스 토글·작가 접두 전환 등) — mutate 를 감싸 1항목.
 * targets 의 'session' 은 프로젝트 필드(추가 프롬프트 등). 범위 밖 대상은 빼고, 남는 대상이 없으면 mutate 만 한다.
 */
export function editWorkflowFields<R>(
  session: Session | undefined,
  holders: WorkflowHolders,
  targets: readonly [WorkflowFieldType | 'session', string][],
  label: string,
  mutate: () => R,
  opts: { service?: UndoService } = {},
): R {
  const service = opts.service ?? undoService;
  if (!session || !service.canRecord(session)) return mutate();
  const byHolder = new Map<object, FieldTarget>();
  for (const [kind, field] of targets) {
    const holder = kind === 'session' ? session : holderOf(holders, kind);
    if (!holder) continue;
    if (kind !== 'session' && !inScope(session, kind, holder)) continue;
    let t = byHolder.get(holder);
    if (!t) {
      t = { kind, holder, keys: [] };
      byHolder.set(holder, t);
    }
    for (const k of kind === 'session' ? [field] : workflowFieldKeys(kind, holder, field)) {
      if (!t.keys.includes(k)) t.keys.push(k);
    }
  }
  if (byHolder.size === 0) return mutate();
  flushSceneFieldEdit();
  const pending = service.track(session, label, fieldsAdapter(session, [...byHolder.values()]));
  try {
    return mutate();
  } finally {
    pending.commit();
  }
}

// ── 프로젝트 필드(추가 프롬프트·새 씬 해상도) ────────────────────────────────

/** 추가 프롬프트 글자 입력 — 편집 세션(D13). 변경 직전에 부르고 대입한다 */
export function setExtraPromptRecorded(
  session: Session | undefined,
  value: string,
  opts: { service?: UndoService; watch?: FocusLeaveWatcher } = {},
): void {
  if (!session) return;
  const service = opts.service ?? undoService;
  if (service.canRecord(session) && session.extraPrompt !== value) {
    const target: FieldTarget = { kind: 'session', holder: session, keys: ['extraPrompt'] };
    touchUndoEdit(
      session,
      `${slotKey(session, 'extraPrompt')}|${UNDO_TEXT.extraPromptEdit}`,
      UNDO_TEXT.extraPromptEdit,
      () => fieldsAdapter(session, [target]),
      { service, watch: opts.watch },
    );
  }
  runInAction(() => {
    session.extraPrompt = value;
  });
}

/** 새 씬 기본 해상도 — 1초 안 연속 = 1항목 */
export function setNewSceneResolutionRecorded(
  session: Session | undefined,
  value: Session['newSceneResolution'],
  opts: { service?: UndoService } = {},
): void {
  if (!session) return;
  const service = opts.service ?? undoService;
  const apply = () =>
    runInAction(() => {
      session.newSceneResolution = value ? { ...value } : value;
    });
  if (!service.canRecord(session) || undoDeepEqual(session.newSceneResolution, value)) {
    apply();
    return;
  }
  flushSceneFieldEdit();
  const pending = service.track(
    session,
    UNDO_TEXT.newSceneResolution,
    fieldsAdapter(session, [{ kind: 'session', holder: session, keys: ['newSceneResolution'] }]),
    { key: slotKey(session, 'newSceneResolution') },
  );
  try {
    apply();
  } finally {
    pending.commit();
  }
}

// ── 선택(그림체·작업모드) ──────────────────────────────────────────────────

function cloneSel(sel: SelectedWorkflow | undefined): SelectedWorkflow | undefined {
  return sel ? { ...sel } : undefined;
}

function sameSel(a: SelectedWorkflow | undefined, b: SelectedWorkflow | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.workflowType === b.workflowType && (a.presetName ?? undefined) === (b.presetName ?? undefined);
}

/**
 * 그림체 선택·작업모드 전환 — 선택 값을 바꾸고 1항목(1초 안 연속 선택은 합침). 되돌림은 이전 선택을 그대로 대입한다
 * (이름이 사라졌으면 PreSetEditor 의 렌더 보정이 첫 그림체로 맞춘다 — 보정 자체는 기록 안 함).
 */
export function selectWorkflowRecorded(
  session: Session | undefined,
  next: SelectedWorkflow,
  label: string,
  opts: { service?: UndoService } = {},
): void {
  if (!session) return;
  const service = opts.service ?? undoService;
  const apply = () =>
    runInAction(() => {
      session.selectedWorkflow = cloneSel(next);
    });
  if (!service.canRecord(session) || sameSel(session.selectedWorkflow, next)) {
    apply();
    return;
  }
  flushSceneFieldEdit();
  const adapter: UndoSnapshotAdapter<SelectedWorkflow | undefined> = {
    snapshot: () => cloneSel(session.selectedWorkflow),
    restore: (snap) =>
      runInAction(() => {
        session.selectedWorkflow = cloneSel(snap);
      }),
    equals: sameSel,
  };
  const pending = service.track(session, label, adapter, { key: `p|select|${editTargetId(session)}` });
  try {
    apply();
  } finally {
    pending.commit();
  }
}

// ── 그림체 목록(추가·복제·삭제·순서·불러오기·글로벌→프로젝트) ───────────────

interface PresetListSnap {
  lists: Map<string, any[]>;
  sel: SelectedWorkflow | undefined;
}

function snapPresetLists(session: Session): PresetListSnap {
  const lists = new Map<string, any[]>();
  for (const [type, list] of session.presets) lists.set(type, [...(list ?? [])]);
  return { lists, sel: cloneSel(session.selectedWorkflow) };
}

function sameRefs(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function samePresetLists(a: PresetListSnap, b: PresetListSnap): boolean {
  if (!sameSel(a.sel, b.sel)) return false;
  const types = new Set([...a.lists.keys(), ...b.lists.keys()]);
  for (const t of types) if (!sameRefs(a.lists.get(t) ?? [], b.lists.get(t) ?? [])) return false;
  return true;
}

function selectionValid(session: Session, sel: SelectedWorkflow | undefined): boolean {
  if (!sel?.presetName) return false;
  return (session.presets.get(sel.workflowType) ?? []).some((p) => p?.name === sel.presetName);
}

/**
 * 목록 from(지금 되돌리려는 쪽의 기록 상태) → to(되살릴 상태) 차분 적용. from 에만 있는 객체(그 동작이 넣은 것)는 빼고,
 * to 에만 있는 객체(그 동작이 뺀 것)는 같은 객체를 to 의 순서대로 다시 넣는다. 둘 다에 있는 객체는 to 순서로, 기록 밖에서 생긴
 * 객체는 지금 상대 순서대로 뒤에 남긴다(지우지 않음). 다시 넣을 이름을 다른 그림체가 쓰면 그 객체만 넣지 않는다(실패 집계).
 */
function applyPresetListDiff(session: Session, from: PresetListSnap, to: PresetListSnap): UndoOutcome | void {
  let total = 0;
  let failed = 0;
  let firstError: string | undefined;
  const reinserted = new Set<any>();
  runInAction(() => {
    const types = new Set([...from.lists.keys(), ...to.lists.keys()]);
    for (const type of types) {
      const fromList = from.lists.get(type) ?? [];
      const toList = to.lists.get(type) ?? [];
      const fromSet = new Set(fromList);
      const toSet = new Set(toList);
      const current = session.presets.get(type) ?? [];
      const curSet = new Set(current);
      const keepers = toList.filter((o) => curSet.has(o));
      const strangers = current.filter((o) => !toSet.has(o) && !fromSet.has(o));
      const taken = new Set([...keepers, ...strangers].map((o) => o?.name));
      const next: any[] = [];
      for (const o of toList) {
        if (curSet.has(o)) {
          next.push(o);
        } else if (!fromSet.has(o)) {
          // 그 동작이 뺀 객체 — 같은 객체를 원래 자리로
          total++;
          if (taken.has(o?.name)) {
            failed++;
            firstError ??= UNDO_TEXT.presetNameTaken(String(o?.name ?? ''));
            continue;
          }
          taken.add(o?.name);
          reinserted.add(o);
          next.push(o);
        }
        // 기록 밖에서 이미 사라진 객체는 건너뛴다
      }
      next.push(...strangers);
      if (!sameRefs(next, current)) session.presets.set(type, next);
    }
    // 선택: 지금 선택이 기록 시 결과 그대로이거나 이미 없는 그림체를 가리키거나, 기록 시 결과가 「이름 없음」(동작이 선택을 비워
    // 렌더 보정이 첫 그림체를 고른 경우)이거나, 되살린 그림체가 원래 선택이었으면 되살린다.
    // 그사이 사용자가 다른 그림체를 골랐으면 건드리지 않는다.
    const cur = session.selectedWorkflow;
    const toSelReinserted =
      !!to.sel?.presetName &&
      [...reinserted].some((o) => o?.type === to.sel!.workflowType && o?.name === to.sel!.presetName);
    if (
      !sameSel(cur, to.sel) &&
      (sameSel(cur, from.sel) ||
        !selectionValid(session, cur) ||
        (!!from.sel && !from.sel.presetName) ||
        toSelReinserted)
    ) {
      session.selectedWorkflow = cloneSel(to.sel);
    }
  });
  if (total > 0 && failed > 0) return { total, failed, firstError };
}

export interface PresetListRecorder {
  /** 바뀌었으면 1항목 — label 을 주면 그것으로(불러온 개수처럼 끝나야 아는 문구) */
  commit(label?: string): boolean;
  cancel(): void;
}

/** 비동기 흐름용(불러오기·글로벌→프로젝트) — 시작에 목록·선택을 보관, commit 때 차분 1항목 */
export function beginPresetListRecord(
  session: Session | undefined,
  label: string,
  opts: { service?: UndoService } = {},
): PresetListRecorder {
  const service = opts.service ?? undoService;
  if (!session || !service.canRecord(session)) return { commit: () => false, cancel: () => {} };
  flushSceneFieldEdit();
  const before = snapPresetLists(session);
  let done = false;
  return {
    commit: (override) => {
      if (done) return false;
      done = true;
      if (!service.canRecord(session)) return false;
      const after = snapPresetLists(session);
      if (samePresetLists(before, after)) return false;
      return !!service.record(session, {
        label: override ?? label,
        undo: () => applyPresetListDiff(session, after, before),
        redo: () => applyPresetListDiff(session, before, after),
      });
    },
    cancel: () => {
      done = true;
    },
  };
}

/** 동기 동작(추가·복제·삭제·순서) — mutate 를 감싸 1항목 */
export function editPresetList<R>(
  session: Session | undefined,
  label: string,
  mutate: () => R,
  opts: { service?: UndoService } = {},
): R {
  const rec = beginPresetListRecord(session, label, opts);
  try {
    return mutate();
  } finally {
    rec.commit();
  }
}

/**
 * 그림체 이름 변경 — 이름을 바꾸고(선택 중이면 선택 이름도) 1항목. 되돌림·다시 실행 직전 검사: 그림체가 프로젝트에 있고
 * 이름이 기록 때 그대로이며 목표 이름을 다른 그림체가 쓰지 않을 것.
 */
export function renamePresetRecorded(
  session: Session | undefined,
  preset: any,
  newName: string,
  opts: { service?: UndoService } = {},
): void {
  if (!session || !preset) return;
  const service = opts.service ?? undoService;
  const prevName: string = preset.name;
  if (prevName === newName) return;
  const doRename = (from: string, to: string) =>
    runInAction(() => {
      const type = projectPresetList(session, preset)?.type ?? preset.type;
      const sel = session.selectedWorkflow;
      const selected = sel?.presetName === from && sel?.workflowType === type;
      preset.name = to;
      if (selected) session.selectedWorkflow = { workflowType: type, presetName: to };
    });
  const recordable = service.canRecord(session) && isProjectPreset(session, preset);
  if (recordable) flushSceneFieldEdit();
  doRename(prevName, newName);
  if (!recordable) return;
  service.record(session, {
    label: UNDO_TEXT.presetRename(prevName, newName),
    undoLabel: UNDO_TEXT.presetRename(newName, prevName),
    verify: (dir) => {
      const found = projectPresetList(session, preset);
      if (!found) return UNDO_TEXT.presetGone(String(preset.name));
      const expected = dir === 'undo' ? newName : prevName;
      if (preset.name !== expected) return UNDO_TEXT.presetNameChanged(String(preset.name));
      const target = dir === 'undo' ? prevName : newName;
      if (found.list.some((p) => p !== preset && p?.name === target)) return UNDO_TEXT.presetNameTaken(target);
      return true;
    },
    undo: () => doRename(newName, prevName),
    redo: () => doRename(prevName, newName),
  });
}

// ── 로컬 캐릭터 프리셋 + 적용 상태(공용 설정의 캐릭터 항목) ──────────────────

/** 캐릭터 프리셋 적용·해제가 바꾸는 공용 설정 필드 */
export const SHARED_CHARACTER_KEYS = [
  'vibes',
  'characterReferences',
  'characterPrompts',
  'characterPrompt',
  'backgroundPrompt',
  'uc',
  '_appliedPresetName',
] as const;

interface CharacterStateSnap {
  presets: [string, ICharacterPreset][];
  shareds: [string, Record<string, unknown>][];
}

function snapCharacterState(session: Session): CharacterStateSnap {
  return {
    presets: Array.from(session.characterPresets.entries()).map(
      ([k, p]) => [k, undoDeepClone(p.toJSON())] as [string, ICharacterPreset],
    ),
    shareds: Array.from(session.presetShareds.entries()).map(([t, s]) => {
      const fields: Record<string, unknown> = {};
      for (const k of SHARED_CHARACTER_KEYS) fields[k] = s && k in s ? undoDeepClone(s[k]) : undefined;
      return [t, fields] as [string, Record<string, unknown>];
    }),
  };
}

function restoreCharacterState(session: Session, snap: CharacterStateSnap): void {
  runInAction(() => {
    const cur = session.characterPresets;
    const next = new Map<string, CharacterPreset>();
    for (const [k, json] of snap.presets) {
      const live = cur.get(k);
      // 내용이 같으면 지금 객체를 그대로(열린 화면·순차 생성 목록의 참조 유지), 다르면 사본에서 새 객체
      next.set(
        k,
        live && undoDeepEqual(live.toJSON(), json) ? live : CharacterPreset.fromJSON(undoDeepClone(json)),
      );
    }
    const same =
      next.size === cur.size &&
      [...next.entries()].every(([k, v], i) => {
        const e = [...cur.entries()][i];
        return e && e[0] === k && e[1] === v;
      });
    if (!same) session.characterPresets = next;
    for (const [type, fields] of snap.shareds) {
      const shared = session.presetShareds.get(type);
      if (!shared) continue;
      for (const k of SHARED_CHARACTER_KEYS) {
        const v = fields[k];
        if (v === undefined && !(k in shared)) continue;
        shared[k] = restoreWorkflowValue(k, undoDeepClone(v), shared[k]);
      }
    }
  });
}

function characterStateAdapter(session: Session): UndoSnapshotAdapter<CharacterStateSnap> {
  return {
    detectConflict: true,
    snapshot: () => snapCharacterState(session),
    restore: (snap) => restoreCharacterState(session, snap),
  };
}

// 안쪽 호출(예: 삭제 흐름 안의 「적용 해제」)이 따로 기록하지 않게 — 바깥 기록 하나가 전체를 담는다
let characterDepth = 0;

/**
 * 로컬 캐릭터 프리셋 목록(저장·삭제·복제·순서)·적용 상태(적용·해제) — mutate 를 감싸 1항목(통째 복원, D16).
 * 이미 바깥 기록이 열려 있으면 mutate 만 한다.
 */
export function editCharacterPresets<R>(
  session: Session | undefined,
  label: string,
  mutate: () => R,
  opts: { service?: UndoService } = {},
): R {
  const service = opts.service ?? undoService;
  if (characterDepth > 0 || !session || !service.canRecord(session)) return mutate();
  flushSceneFieldEdit();
  const pending = service.track(session, label, characterStateAdapter(session));
  characterDepth++;
  try {
    return mutate();
  } finally {
    characterDepth--;
    pending.commit();
  }
}

/**
 * 비동기 흐름(글로벌→프로젝트 불러오기·적용)용 — commit/cancel 까지 바깥 기록으로 열려 있다. 호출부는 try/finally 로 닫는다.
 */
export function beginCharacterPresetRecord(
  session: Session | undefined,
  label: string,
  opts: { service?: UndoService } = {},
): PresetListRecorder {
  const service = opts.service ?? undoService;
  if (characterDepth > 0 || !session || !service.canRecord(session)) {
    return { commit: () => false, cancel: () => {} };
  }
  flushSceneFieldEdit();
  const adapter = characterStateAdapter(session);
  const before = adapter.snapshot();
  characterDepth++;
  let done = false;
  const settle = () => {
    if (done) return false;
    done = true;
    characterDepth = Math.max(0, characterDepth - 1);
    return true;
  };
  return {
    commit: (override) => {
      if (!settle()) return false;
      if (!service.canRecord(session)) return false;
      const after = adapter.snapshot();
      if (undoDeepEqual(before, after)) return false;
      return !!service.record(session, {
        label: override ?? label,
        conflict: (dir) => !undoDeepEqual(adapter.snapshot(), dir === 'undo' ? after : before),
        undo: () => adapter.restore(before),
        redo: () => adapter.restore(after),
      });
    },
    cancel: () => {
      settle();
    },
  };
}

/** 테스트·진단용 */
export function resetPresetUndoState(): void {
  characterDepth = 0;
  openSlide = undefined;
}
