// 씬 필드·조합·씬 캐릭터·시드 그룹의 되돌리기 계측(2026-11-01 U2b, SPEC_GUIDE 「되돌리기 계약」, jest undoSceneField.test.ts).
//
// · 기록은 호출부(UI·흐름 계층)의 사용자 동작 지점에서만 이 모듈의 헬퍼로 한다. 렌더·마운트 중 보정(SceneEditor 의
//   meta 보충·빈 조합 첫 조각 보장·조각 id 부여), refresh, 다른 창 동기화, 찾기/바꾸기는 헬퍼를 부르지 않는다.
// · 씬은 손잡이(undoRef)로 잡고 실행 시점에 세션에 그 객체가 아직 있는지 확인한다(없으면 그 항목만 실패·폐기).
//   세션에 등록되지 않은 씬(새 변형 씬 초안 등)의 편집은 기록하지 않는다.
// · 조합은 조각 단위가 아니라 씬 slots 통째(깊은 복사 → PromptPiece.fromJSON 으로 되살림) — 조각 객체를 손잡이로 잡지 않는다.
// · 이미지 필드(imageMap·mains·game·round·imageAccounts)는 절대 담지 않는다(생성 중 새 이미지 보존 — 최우선 원칙).
//   「씬 내용 복제」 되돌림도 그 필드는 건드리지 않는다.
// · 통째 복원 항목은 기록 밖 변경과 겹치면 실행 전에 확인 창(D16, undoService 의 conflict·deps.confirm).
// · 프롬프트 편집기·입력 칸의 연속 입력은 「편집 세션」 하나 = 1항목(D13): 첫 변경 직전에 touchSceneFieldEdit 로
//   이전 값을 보관하고, 그 입력 칸에서 포커스가 떠날 때(또는 되돌리기 실행 직전·다른 기록 직전·편집 창 닫힘) 확정한다.
//   편집기 자체 이력(PromptEditTextArea 의 Ctrl+Z)은 건드리지 않는다 — 편집 중에는 전역 단축키가 억제되므로 이중 기록 없음.
// · 이 모듈은 잠금을 쓰지 않는다(MobX 대입만 — 저장은 기존 RS.watch 자동 persist).
import { runInAction } from 'mobx';
import { isTextEntryElement } from './keyTargetGuard';
import { SCENE_SEED_GROUP_META_KEY } from './sceneSeedGroups';
import type { SeedGroupScene, SeedGroupSceneKind } from './sceneSeedGroups';
import { sceneInSession } from './sceneStructureUndo';
import { PromptPiece } from './types';
import type { CharacterPrompt, GenericScene, IPromptPiece, Session } from './types';
import {
  undoDeepClone,
  undoDeepEqual,
  undoRef,
  undoService,
  UNDO_TEXT,
  UndoPending,
  UndoScope,
  UndoService,
  UndoSnapshotAdapter,
} from './undoService';

/** 되돌리기가 담을 수 있는 씬 필드 — 이미지 필드는 없다 */
export type SceneFieldKey =
  | 'slots'
  | 'meta'
  | 'sceneCharacterPrompts'
  | 'useSceneCharacterPrompts'
  | 'sceneCharacterPromptMode'
  | 'sceneCharacterUC'
  | 'sceneUC'
  | 'sceneSeed'
  | 'resolution'
  | 'resolutionWidth'
  | 'resolutionHeight'
  | 'workflowType'
  | 'preset'
  | 'comboMode';

/** 담으면 안 되는 이미지 필드(생성 중 새 이미지가 들어오는 곳) */
export const SCENE_IMAGE_FIELDS = ['imageMap', 'mains', 'game', 'round', 'imageAccounts'] as const;

/**
 * 대량 작업 「씬 내용 복제(덮어쓰기)」가 바꾸는 내용 필드 — 되돌리기는 이것만 담는다(이미지 필드 제외, BatchProcessService).
 * 일반 씬은 sceneUC·sceneSeed·해상도를 복제하지 않는다(기존 동작), 변형 씬은 해상도도 맞춘다(R-res).
 * meta(시드 그룹 소속)는 양쪽 다 복제한다 — 변형 씬 meta 는 2026-11-03 신설(일반 씬과 같은 동작).
 */
export const SCENE_CONTENT_COPY_KEYS: Readonly<Record<'scene' | 'inpaint', readonly SceneFieldKey[]>> = {
  scene: [
    'slots',
    'meta',
    'sceneCharacterPrompts',
    'useSceneCharacterPrompts',
    'sceneCharacterPromptMode',
    'sceneCharacterUC',
  ],
  inpaint: ['workflowType', 'preset', 'resolution', 'resolutionWidth', 'resolutionHeight', 'comboMode', 'slots', 'meta'],
};

export interface SceneFieldUndoOptions {
  service?: UndoService;
  /** 평범한 JSON 사본 → 씬 필드 값(기본 restoreSceneFieldValue). 변형 씬 preset 은 호출부가 presetFromJSON 으로 */
  restore?: (key: SceneFieldKey, plain: unknown, current: unknown) => unknown;
}

const NOOP: UndoPending = { commit: () => false, cancel: () => {} };

/**
 * slots 되살리기 — 사본(평범한 JSON)으로 새 조합을 만들되, 지금 조합에 같은 id 조각 객체가 있으면 그 객체에 값을 넣어 다시 쓴다.
 * 열려 있는 조각 편집기(PC 편집기는 처음 받은 onChange 를 계속 쓴다)가 떨어져 나간 옛 객체에 입력하는 일을 막는다.
 * 값은 언제나 사본에서 오므로 보관본과 객체를 공유하지 않는다.
 */
export function restoreSlotsPreservingPieces(
  current: readonly (readonly PromptPiece[])[] | undefined,
  plain: IPromptPiece[][] | undefined,
): PromptPiece[][] {
  const live = new Map<string, PromptPiece>();
  for (const slot of current ?? []) {
    for (const p of slot) if (p && p.id && !live.has(p.id)) live.set(p.id, p);
  }
  const used = new Set<PromptPiece>();
  return (plain ?? []).map((slot) =>
    slot.map((json) => {
      const hit = json.id ? live.get(json.id) : undefined;
      if (!hit || used.has(hit)) return PromptPiece.fromJSON(json);
      used.add(hit);
      hit.prompt = json.prompt;
      hit.characterPrompts = Array.isArray(json.characterPrompts) ? [...json.characterPrompts] : [];
      hit.enabled = json.enabled;
      hit.name = json.name;
      return hit;
    }),
  );
}

/** 기본 되살리기 — slots 는 PromptPiece 로(같은 id 객체 재사용), meta 는 Map 으로, 나머지는 사본 그대로 */
export function restoreSceneFieldValue(key: SceneFieldKey, plain: unknown, current?: unknown): unknown {
  if (key === 'slots') {
    return restoreSlotsPreservingPieces(
      current as PromptPiece[][] | undefined,
      plain as IPromptPiece[][] | undefined,
    );
  }
  if (key === 'meta') return new Map(plain as Map<string, unknown>);
  return plain;
}

function assertNoImageFields(keys: readonly string[]) {
  for (const k of keys) {
    if ((SCENE_IMAGE_FIELDS as readonly string[]).includes(k)) {
      throw new Error(`되돌리기는 이미지 필드(${k})를 담지 않습니다`);
    }
  }
}

function sceneGoneCheck(session: Session, scene: GenericScene): () => true | string {
  const ref = undoRef(scene);
  return () => (sceneInSession(session, ref.current) ? true : UNDO_TEXT.sceneGone(ref.current.name));
}

/** 씬 필드 묶음 상태 짝 — 손잡이로 현재 씬 객체를 따라가고, 통째 복원이라 겹침 확인(D16)을 켠다 */
export function sceneFieldsAdapter(
  session: Session,
  scene: GenericScene,
  keys: readonly SceneFieldKey[],
  opts: SceneFieldUndoOptions = {},
): UndoSnapshotAdapter<unknown[]> {
  assertNoImageFields(keys);
  const ref = undoRef(scene);
  const read = (k: SceneFieldKey) => (ref.current as unknown as Record<string, unknown>)[k];
  const toValue = opts.restore ?? restoreSceneFieldValue;
  return {
    detectConflict: true,
    verify: sceneGoneCheck(session, scene),
    snapshot: () => keys.map((k) => undoDeepClone(read(k))),
    restore: (snap) =>
      runInAction(() => {
        const target = ref.current as unknown as Record<string, unknown>;
        keys.forEach((k, i) => {
          target[k] = toValue(k, undoDeepClone(snap[i]), target[k]);
        });
      }),
  };
}

function recordable(service: UndoService, session: Session | undefined, scene: GenericScene): session is Session {
  return !!session && service.canRecord(session) && sceneInSession(session, scene);
}

/** 지정 필드를 보관해 두었다가 commit 때 바뀌었으면 1항목 */
export function captureSceneFields(
  session: Session | undefined,
  scene: GenericScene,
  keys: readonly SceneFieldKey[],
  label: string,
  opts: SceneFieldUndoOptions = {},
): UndoPending {
  const service = opts.service ?? undoService;
  if (!recordable(service, session, scene)) return NOOP;
  // 열린 편집 세션이 있으면 먼저 확정(기록 순서 = 동작 순서)
  flushSceneFieldEdit();
  return service.track(session, label, sceneFieldsAdapter(session, scene, keys, opts));
}

/** mutate 를 감싸 한 번의 동작 = 1항목(바뀌지 않았으면 기록 없음) */
export function editSceneFields<R>(
  session: Session | undefined,
  scene: GenericScene,
  keys: readonly SceneFieldKey[],
  label: string,
  mutate: () => R,
  opts: SceneFieldUndoOptions & {
    /** mutate 뒤 true 면 기록하지 않는다(실질 변화 없음 — 값 정규화만 일어난 경우 등) */
    skipIf?: () => boolean;
  } = {},
): R {
  const pending = captureSceneFields(session, scene, keys, label, opts);
  let ok = false;
  try {
    const r = mutate();
    ok = true;
    return r;
  } finally {
    if (ok && opts.skipIf?.()) pending.cancel();
    else pending.commit();
  }
}

/** 여러 씬의 같은 필드를 한 번에 바꾸는 동작 = 1항목(묶음 — 되돌림 역순) */
export function editScenesFields<R>(
  session: Session | undefined,
  scenes: readonly GenericScene[],
  keys: readonly SceneFieldKey[],
  label: string,
  mutate: () => R,
  opts: SceneFieldUndoOptions = {},
): R {
  const service = opts.service ?? undoService;
  if (!session || !service.canRecord(session)) return mutate();
  flushSceneFieldEdit();
  const group = service.beginGroup(session, label);
  const pendings = Array.from(new Set(scenes)).map((s) => captureSceneFields(session, s, keys, label, opts));
  try {
    return mutate();
  } finally {
    pendings.forEach((p) => p.commit());
    group.commit();
  }
}

/** 누르는 동안 여러 번 바뀌는 필드(캐릭터 위치 드래그) — 놓을 때 commit, 변화 없으면 버림 */
export function dragSceneFields(
  session: Session | undefined,
  scene: GenericScene,
  keys: readonly SceneFieldKey[],
  label: string,
  opts: SceneFieldUndoOptions = {},
): UndoPending {
  const service = opts.service ?? undoService;
  if (!recordable(service, session, scene)) return NOOP;
  flushSceneFieldEdit();
  return service.drag(session, label, sceneFieldsAdapter(session, scene, keys, opts));
}

/** 원시값 필드 하나 — 같은 씬·필드를 1초 안에 또 바꾸면 합친다(D12). 대입은 항상 한다. */
export function setSceneField<K extends SceneFieldKey>(
  session: Session | undefined,
  scene: GenericScene,
  key: K,
  value: unknown,
  label: string,
  opts: { service?: UndoService } = {},
): void {
  const service = opts.service ?? undoService;
  const target = scene as unknown as Record<string, unknown>;
  if (!recordable(service, session, scene)) {
    runInAction(() => {
      target[key] = value;
    });
    return;
  }
  flushSceneFieldEdit();
  service.set(session, target, key, value, label, {
    ref: undoRef(target),
    verify: sceneGoneCheck(session, scene),
  });
}

// ── 편집 세션(D13 — 입력 칸을 떠날 때 1항목) ───────────────────────────────

/** 편집 세션이 끝났는지 감시 — onLeave 를 부르면 확정. 반환 = 감시 해제 */
export type FocusLeaveWatcher = (onLeave: () => void) => () => void;

/**
 * 기본 감시: 지금 포커스된 글자 입력 칸(편집기의 textarea·contentEditable)에서 포커스가 떠나면 확정.
 * 창 전환(alt-tab)처럼 activeElement 가 그대로면 이어진다. 입력 칸 밖에서 생긴 변경(칩·프로그램)은 바로 다음 틱에 확정.
 */
export const domFocusLeaveWatcher: FocusLeaveWatcher = (onLeave) => {
  const el = typeof document === 'undefined' ? null : document.activeElement;
  if (!el || !isTextEntryElement(el)) {
    const t = setTimeout(onLeave, 0);
    return () => clearTimeout(t);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onBlur = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      if (document.activeElement !== el) onLeave();
    }, 0);
  };
  el.addEventListener('blur', onBlur);
  return () => {
    el.removeEventListener('blur', onBlur);
    if (timer !== undefined) clearTimeout(timer);
  };
};

interface OpenEdit {
  key: string;
  /** 프로젝트 스택 또는 전역 스택(전역 조각 — 2차 묶음 5) */
  session: UndoScope;
  service: UndoService;
  pending: UndoPending;
  dispose: () => void;
}

let openEdit: OpenEdit | undefined;
/** 확정 보류(holdSceneFieldEdit) 중첩 수와, 보류 중 포커스 이탈로 미뤄진 확정이 있는지 */
let editHolds = 0;
let flushDeferred = false;
const editTargetIds = new WeakMap<object, number>();
let nextEditTargetId = 1;
/** 편집 세션 key 를 만들 때 쓰는 객체 번호(객체당 하나) — presetUndo 도 같은 번호를 쓴다 */
export function editTargetId(obj: object): number {
  let id = editTargetIds.get(obj);
  if (id === undefined) {
    id = nextEditTargetId++;
    editTargetIds.set(obj, id);
  }
  return id;
}

/**
 * 입력 칸의 변경 **직전**에 부른다(값이 실제로 바뀔 때만). 같은 씬·필드·라벨의 편집 세션이 열려 있으면 아무것도 하지
 * 않고, 아니면 이전 값을 보관해 새 세션을 연다(다른 세션은 먼저 확정). 세션은 포커스가 떠날 때·되돌리기 실행 직전
 * (undoService 의 끝나지 않은 drag 확정)·이 모듈의 다른 기록 직전·flushSceneFieldEdit(편집 창 닫힘) 때 확정된다.
 */
export function touchSceneFieldEdit(
  session: Session | undefined,
  scene: GenericScene,
  keys: readonly SceneFieldKey[],
  label: string,
  opts: SceneFieldUndoOptions & { watch?: FocusLeaveWatcher } = {},
): void {
  const service = opts.service ?? undoService;
  if (!recordable(service, session, scene)) return;
  const key = `${editTargetId(undoRef(scene))}|${keys.join(',')}|${label}`;
  touchUndoEdit(session, key, label, () => sceneFieldsAdapter(session, scene, keys, opts), {
    service,
    watch: opts.watch,
  });
}

/**
 * 편집 세션의 일반형(U3b — 사전 세팅·공용 설정·추가 프롬프트도 같은 세션 하나를 공유한다: 한 번에 하나만 열림).
 * key 가 같은 세션이 열려 있으면 아무것도 하지 않고, 아니면 다른 세션을 먼저 확정한 뒤 makeAdapter() 로 이전 값을 보관한다.
 * 기록 가능 여부(대상 범위·미러)는 호출부가 먼저 판정한다.
 */
export function touchUndoEdit(
  session: UndoScope,
  key: string,
  label: string,
  makeAdapter: () => UndoSnapshotAdapter<unknown>,
  opts: { service?: UndoService; watch?: FocusLeaveWatcher } = {},
): void {
  const service = opts.service ?? undoService;
  if (!service.canRecord(session)) return;
  if (
    openEdit &&
    openEdit.key === key &&
    openEdit.session === session &&
    openEdit.service === service &&
    service.isPendingOpen(session, openEdit.pending)
  ) {
    return;
  }
  flushSceneFieldEdit();
  const pending = service.drag(session, label, makeAdapter());
  const edit: OpenEdit = { key, session, service, pending, dispose: () => {} };
  openEdit = edit;
  const dispose = (opts.watch ?? domFocusLeaveWatcher)(() => {
    if (openEdit === edit) {
      // 확정 보류 중(편집 확정 직후 확인 창 — 가중치 공백 보정)이면 보류가 풀릴 때 확정한다.
      if (editHolds > 0) flushDeferred = true;
      else flushSceneFieldEdit();
    } else edit.dispose();
  });
  edit.dispose = dispose;
}

/** 열린 편집 세션을 확정(바뀌었으면 1항목) — 편집 창이 닫힐 때 호출부가 부른다 */
export function flushSceneFieldEdit(): boolean {
  flushDeferred = false;
  const e = openEdit;
  if (!e) return false;
  openEdit = undefined;
  e.dispose();
  return e.pending.commit();
}

/**
 * 포커스 이탈에 의한 편집 세션 확정을 잠시 미룬다(반환 = 해제 함수, 여러 번 불러도 한 번만 해제).
 * 편집 칸을 떠나는 순간(blur) 동기로 붙잡고, 그 뒤 확인 창에서 고른 결과(가중치 공백 [보정 적용])를 같은 칸에 반영한 뒤
 * 해제하면 「편집 + 보정」이 되돌리기 1항목이 된다(D13 경계 안). 보류 중 이탈이 있었으면 해제 때 확정한다.
 * 보류 중에도 다른 세션 시작·되돌리기 실행 직전·flushSceneFieldEdit 은 평소대로 즉시 확정한다.
 */
export function holdSceneFieldEdit(): () => void {
  editHolds += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    editHolds -= 1;
    if (editHolds === 0 && flushDeferred) flushSceneFieldEdit();
  };
}

/** 테스트·진단용 — 열린 편집 세션이 있는가 */
export function hasOpenSceneFieldEdit(): boolean {
  return !!openEdit;
}

// ── 시드 그룹(씬 meta 의 한 키만) ─────────────────────────────────────────

function seedGroupMetaAdapter(session: Session, scene: SeedGroupScene): UndoSnapshotAdapter<unknown> {
  const ref = undoRef(scene);
  return {
    detectConflict: true,
    verify: sceneGoneCheck(session, scene),
    snapshot: () => undoDeepClone((ref.current as SeedGroupScene).meta.get(SCENE_SEED_GROUP_META_KEY)),
    restore: (snap) =>
      runInAction(() => {
        const meta = (ref.current as SeedGroupScene).meta;
        const v = undoDeepClone(snap);
        if (v === undefined) meta.delete(SCENE_SEED_GROUP_META_KEY);
        else meta.set(SCENE_SEED_GROUP_META_KEY, v);
      }),
  };
}

/**
 * 시드 그룹 만들기·추가·해제·그룹 시드 값 — 그 종류(`opts.type`, 기본 이미지생성 씬 · 변형 탭은 'inpaint' — 2026-11-03)
 * 씬 전부의 그룹 키를 보관했다가 바뀐 씬만 묶음 1항목(되돌림 역순). meta 의 다른 키(워크플로우 메타)는 건드리지 않는다.
 */
export function editSeedGroups<R>(
  session: Session | undefined,
  label: string,
  mutate: () => R,
  opts: { service?: UndoService; type?: SeedGroupSceneKind } = {},
): R {
  const service = opts.service ?? undoService;
  if (!session || !service.canRecord(session)) return mutate();
  flushSceneFieldEdit();
  const group = service.beginGroup(session, label);
  const pendings = (session.getScenes(opts.type ?? 'scene') as SeedGroupScene[]).map((s) =>
    service.track(session, label, seedGroupMetaAdapter(session, s)),
  );
  try {
    return mutate();
  } finally {
    pendings.forEach((p) => p.commit());
    group.commit();
  }
}

// ── 기본 캐릭터 순서(사전 세팅·공유의 characterPrompts order 만) ────────────

interface OrderHolder {
  characterPrompts?: CharacterPrompt[];
}

type OrderSnapshot = [string, number | null][][];

/**
 * 씬 편집 창 「기본 캐릭터 프롬프트」 순서 변경 — preset·shared 캐릭터의 order 값만 보관·복원(내용은 건드리지 않는다).
 */
export function editBaseCharacterOrder<R>(
  session: Session | undefined,
  preset: OrderHolder | undefined,
  shared: OrderHolder | undefined,
  label: string,
  mutate: () => R,
  opts: { service?: UndoService } = {},
): R {
  const service = opts.service ?? undoService;
  if (!session || !service.canRecord(session)) return mutate();
  flushSceneFieldEdit();
  const holders = [preset, shared];
  const adapter: UndoSnapshotAdapter<OrderSnapshot> = {
    detectConflict: true,
    snapshot: () =>
      holders.map((h) =>
        (h?.characterPrompts ?? []).map((c): [string, number | null] => [
          c.id,
          Number.isFinite(c.order) ? (c.order as number) : null,
        ]),
      ),
    restore: (snap) =>
      runInAction(() => {
        holders.forEach((h, i) => {
          if (!h?.characterPrompts) return;
          const orders = new Map(snap[i] ?? []);
          h.characterPrompts = h.characterPrompts.map((c) =>
            orders.has(c.id) ? { ...c, order: orders.get(c.id) ?? undefined } : c,
          );
        });
      }),
    equals: (a, b) => undoDeepEqual(a, b),
  };
  const pending = service.track(session, label, adapter);
  try {
    return mutate();
  } finally {
    pending.commit();
  }
}
