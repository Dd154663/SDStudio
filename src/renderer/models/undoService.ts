// 되돌리기/다시 실행 — 명령 계측형 스택(2026-11-01 U1, SPEC_GUIDE 「되돌리기 계약」, jest undoService.test.ts).
//
// · 기록은 UI·흐름 계층에서 사용자 동작이 성공한 뒤에만 헬퍼(set·capture·run·group·beginGroup·drag·focusEdit)로 한다.
//   서비스 내부(잠금 안)에서 기록하지 않는다 — 되돌림이 같은 잠금 안에서 서비스를 다시 부르는 교착을 막기 위함.
// · 스택은 프로젝트(Session) 인스턴스별 WeakMap, 메모리 전용(재시작·인스턴스 교체 시 자연 소멸), 깊이 100.
// · 실행은 하나씩(실행 중 연타는 무시하고 「진행 중」 안내), 실행 중에는 기록하지 않는다(되돌림이 또 기록되는 재귀 방지).
// · 이 모듈은 잠금을 쓰지 않는다 — 항목은 MobX 대입이나 공개 서비스 메서드만 부르고, 그 메서드가 각자 잠근다.
// · 미러(읽기 전용) 프로젝트는 기록·실행 모두 하지 않는다(저장되지 않는 편집이므로).
// · 항목은 이미지 목록 필드(imageMap·mains·game·round)를 통째로 되살리지 않는다 — 생성 중 새로 생긴 이미지를 지운다.
//   필드 단위·병합 복원만 쓴다(씬 순서는 Session.reorderScenes: 그사이 생긴 씬은 뒤에 남김).
import { isObservableMap, isObservableSet, makeObservable, observable, runInAction } from 'mobx';
import type { Session } from './types';
import type { ToastKind } from './toastKind';
import { getAppState } from './appStateRef';

export type UndoDirection = 'undo' | 'redo';
export type UndoKind = 'state' | 'file';

/** 묶음 항목 실행 결과 — 하위 항목 일부가 실패했을 때 안내용 */
export interface UndoOutcome {
  total: number;
  failed: number;
  firstError?: string;
}

type UndoRunResult = void | UndoOutcome;

export interface UndoEntryInit {
  label: string;
  /** 되돌림 방향 전용 문구(없으면 label). 이름 변경처럼 방향이 있는 작업은 「B → A」로 준다(2026-11-01 실기 지적) */
  undoLabel?: string;
  kind?: UndoKind;
  mergeKey?: string;
  undo(): UndoRunResult | Promise<UndoRunResult>;
  redo(): UndoRunResult | Promise<UndoRunResult>;
  /** 실행 직전 검사 — 문자열(이유)이면 실행하지 않고 그 항목만 버린다 */
  verify?(dir: UndoDirection): true | string;
  /**
   * 기록 밖 변경과 겹쳤는가(D16) — true 면 실행 전에 확인 창(`deps.confirm`)을 띄운다. 확인 = 실행, 취소 = 항목 유지
   * (폐기 아님 — 다시 누르면 다시 묻는다). 통째 복원 항목(capture·drag·focusEdit)이 「현재 값 ≠ 기록 시 결과」로 판정한다.
   */
  conflict?(dir: UndoDirection): boolean;
}

export interface UndoEntry extends UndoEntryInit {
  readonly id: number;
  kind: UndoKind;
  readonly createdAt: number;
  updatedAt: number;
}

/** 시작~끝을 감싸는 기록(capture·drag·focusEdit) — commit 은 기록했으면 true, 변화가 없어 버렸으면 false */
export interface UndoPending {
  commit(): boolean;
  cancel(): void;
}

export interface UndoGroupHandle extends UndoPending {
  /** 묶음 안에 항목을 직접 넣는다(헬퍼를 거치지 않는 경우) */
  add(init: UndoEntryInit): void;
}

/** drag·capture 용 상태 읽기/되살리기 짝 — 객체 필드가 아닌 상태(씬 순서 등)에 쓴다 */
export interface UndoSnapshotAdapter<S> {
  snapshot(): S;
  restore(snapshot: S): void;
  /** 같음 판정(없으면 깊은 비교) — 같으면 기록하지 않는다 */
  equals?(a: S, b: S): boolean;
  /**
   * 통째 덮어쓰는 복원인가(D16) — true 면 실행 직전 현재 상태가 기록 시 결과(되돌림 = 이후 값, 다시 실행 = 이전 값)와
   * 다를 때 확인 창을 띄운다. 병합 복원(씬 순서 — 그사이 생긴 씬은 뒤에 남김)은 덮어쓰지 않으므로 끈다.
   */
  detectConflict?: boolean;
  /** 실행 직전 검사(대상이 아직 있는가 등) — 문자열(이유)이면 실행하지 않고 그 항목만 버린다 */
  verify?(): true | string;
}

export interface UndoDeps {
  curSession(): Session | undefined;
  isMirror(session: Session): boolean;
  toast(message: string, kind: ToastKind): void;
  now(): number;
  /** 기록 밖 변경과 겹친 항목의 실행 확인(D16) — true = 계속. 기본은 appState.confirmAsync(danger 아님) */
  confirm(message: string, confirmText: string): Promise<boolean>;
}

export const UNDO_MAX_DEPTH = 100;
export const UNDO_MERGE_MS = 1000;

/** 사용자에게 보이는 문구 — 한 곳에서만 정한다 */
export const UNDO_TEXT = {
  undoName: '되돌리기',
  redoName: '다시 실행',
  undone: (label: string) => `되돌림: ${label}`,
  redone: (label: string) => `다시 실행: ${label}`,
  busy: '되돌리기·다시 실행을 처리하는 중입니다. 잠시 뒤 다시 눌러 주세요.',
  undoFailed: (reason: string) => `되돌릴 수 없습니다: ${reason}`,
  redoFailed: (reason: string) => `다시 실행할 수 없습니다: ${reason}`,
  partial: (failed: number, total: number) => ` (${total}개 중 ${failed}개는 처리하지 못했습니다)`,
  groupAllFailed: '묶인 작업을 하나도 처리하지 못했습니다',
  unknownError: '알 수 없는 오류',
  // keyHint = 현재 단축키 표시(PC 만 — 모바일은 단축키 없음)
  undoTooltip: (label?: string, keyHint?: string) =>
    (label ? `되돌리기: ${label}` : '되돌릴 작업 없음') + (keyHint ? ` (${keyHint})` : ''),
  redoTooltip: (label?: string, keyHint?: string) =>
    (label ? `다시 실행: ${label}` : '다시 실행할 작업 없음') + (keyHint ? ` (${keyHint})` : ''),
  // 계측 지점 라벨
  sceneOrderDrag: '씬 순서 변경',
  sceneMoveFront: '씬 맨 앞으로',
  sceneMoveBack: '씬 맨 뒤로',
  sceneSortByName: '씬 이름순 정렬',
  // U2a 씬 구조(생성·이름·북마크) — sceneStructureUndo.ts
  sceneAdd: (names: readonly string[]) =>
    names.length === 1 ? `씬 추가: ${names[0]}` : `씬 추가 ${names.length}개`,
  sceneDuplicate: (name: string) => `씬 복제: ${name}`,
  sceneRegenerate: (name: string) => `이미지에서 씬 재생성: ${name}`,
  variantSceneCreate: (name: string) => `변형 씬 생성: ${name}`,
  mirrorDuplicate: (names: readonly string[]) =>
    names.length === 1 ? `미러로 복제: ${names[0]}` : `미러로 복제 ${names.length}개`,
  // workflowLabel = i2iBatch.variantCopyLabel(…)(「I2I」·「인페인트」)
  variantCopy: (workflowLabel: string, count: number) => `${workflowLabel}로 씬 복사 ${count}개`,
  sceneRename: (from: string, to: string) => `씬 이름 변경: ${from} → ${to}`,
  sceneBookmarkOn: (name: string) => `씬 북마크: ${name}`,
  sceneBookmarkOff: (name: string) => `씬 북마크 해제: ${name}`,
  // 실패 이유(되돌릴 수 없습니다: …)
  sceneGone: (name: string) => `씬 "${name}"이(가) 이미 없습니다`,
  sceneStructureBlocked: '다른 창에서 열려 있는 프로젝트라 처리하지 못했습니다',
  sceneNotInTrash: '휴지통에 기록이 없습니다',
  sceneNameChanged: (name: string) => `씬 이름이 그사이 바뀌었습니다(현재 "${name}")`,
  sceneNameTaken: (name: string) => `같은 이름의 씬 "${name}"이(가) 이미 있습니다`,
  // D16 — 기록 밖 변경과 겹친 통째 복원 항목의 확인 창(danger 아님, 취소 = 항목 유지)
  conflictUndo: (label: string) =>
    `「${label}」 뒤에 같은 내용이 되돌리기 기록 밖에서 또 바뀌었습니다.\n` +
    '되돌리면 이후 바뀐 내용도 함께 되돌아갑니다. 계속할까요?',
  conflictRedo: (label: string) =>
    `「${label}」을(를) 되돌린 뒤 같은 내용이 되돌리기 기록 밖에서 또 바뀌었습니다.\n` +
    '다시 실행하면 이후 바뀐 내용도 함께 바뀝니다. 계속할까요?',
  // U2b 씬 필드·조합·씬 캐릭터·시드 그룹 — sceneFieldUndo.ts
  sceneSeed: (name: string) => `씬 전용 시드: ${name}`,
  sceneResolution: (name: string) => `해상도 변경: ${name}`,
  scenesResolution: (count: number) => `해상도 일괄 변경 ${count}개`,
  sceneMiddlePrompt: (name: string) => `중간 프롬프트 편집: ${name}`,
  sceneCharacterMiddlePrompt: (name: string) => `캐릭터 중간 프롬프트 편집: ${name}`,
  sceneNegative: (name: string) => `씬 전용 네거티브 편집: ${name}`,
  comboAddColumn: (name: string) => `조합 열 추가: ${name}`,
  comboAddRow: (name: string) => `조합 행 추가: ${name}`,
  comboRemovePiece: (name: string) => `조합 셀 삭제: ${name}`,
  comboMovePiece: (name: string) => `조합 셀 이동: ${name}`,
  comboTogglePiece: (name: string) => `조합 셀 활성화 변경: ${name}`,
  comboRenamePiece: (name: string) => `조합 셀 이름 변경: ${name}`,
  comboPiecePrompt: (name: string) => `조합 셀 프롬프트 편집: ${name}`,
  comboPieceCharacter: (name: string) => `조각 캐릭터 프롬프트 변경: ${name}`,
  comboQuickToggle: (name: string) => `조합 퀵 토글: ${name}`,
  comboBatchInsert: (count: number) => `일괄 삽입 ${count}개 씬`,
  sceneCharacterRoles: (name: string) => `씬 캐릭터 역할 변경: ${name}`,
  sceneCharacterRoleText: (name: string) => `씬 캐릭터 역할 편집: ${name}`,
  sceneCharacterRoleOrder: (name: string) => `씬 캐릭터 역할 순서: ${name}`,
  sceneCharacterPosition: (name: string) => `캐릭터 위치 이동: ${name}`,
  sceneCharacterMode: (name: string) => `캐릭터 모드 변경: ${name}`,
  sceneCharacterNegative: (name: string) => `씬 캐릭터 공통 네거티브 편집: ${name}`,
  baseCharacterOrder: '기본 캐릭터 순서 변경',
  seedGroupSet: (count: number) => `시드 그룹 설정 ${count}개 씬`,
  seedGroupRemove: '시드 그룹 해제',
  seedGroupSeed: (label: string) => `그룹 ${label} 시드 변경`,
  sceneContentCopy: (source: string, count: number) => `씬 내용 복제: ${source} → ${count}개`,
} as const;

// ── 참조 손잡이 ───────────────────────────────────────────────────────────
// 항목은 씬·프리셋을 이름이 아닌 손잡이로 잡는다. 삭제 되돌림으로 새 객체가 생기면 rebind 로 옮긴다.
export interface UndoRef<T extends object> {
  current: T;
}

const refs = new WeakMap<object, UndoRef<object>>();

/** 객체당 손잡이 하나(같은 객체면 같은 손잡이) */
export function undoRef<T extends object>(obj: T): UndoRef<T> {
  let r = refs.get(obj);
  if (!r) {
    r = { current: obj };
    refs.set(obj, r);
  }
  return r as UndoRef<T>;
}

/** old 를 잡던 손잡이가 이제 next 를 가리키게 한다(삭제 복원 등으로 객체가 바뀐 경우) */
export function rebind<T extends object>(oldObj: T, nextObj: T): void {
  const r = refs.get(oldObj);
  if (!r) return;
  r.current = nextObj;
  refs.set(nextObj, r);
}

// ── 깊은 복사·비교(순수) ────────────────────────────────────────────────────
// toJSON 이 배열(game·imageMap·mains 등)을 복사하지 않고 넘기므로(types.ts AbstractScene.toJSON),
// toJSON 결과를 그대로 보관하면 이후 변경이 스냅숏에 섞인다 → 항상 끝까지 복사한다.
export function undoDeepClone<T>(value: T): T {
  return cloneValue(value, new Map()) as T;
}

function cloneValue(v: unknown, seen: Map<unknown, unknown>): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (seen.has(v)) return seen.get(v);
  if (v instanceof Date) return new Date(v.getTime());
  if (v instanceof Map || isObservableMap(v)) {
    const out = new Map();
    seen.set(v, out);
    for (const [k, x] of (v as Map<unknown, unknown>).entries()) out.set(k, cloneValue(x, seen));
    return out;
  }
  if (v instanceof Set || isObservableSet(v)) {
    const out = new Set();
    seen.set(v, out);
    for (const x of (v as Set<unknown>).values()) out.add(cloneValue(x, seen));
    return out;
  }
  if (Array.isArray(v)) {
    const out: unknown[] = [];
    seen.set(v, out);
    for (const x of v) out.push(cloneValue(x, seen));
    return out;
  }
  const withToJSON = v as { toJSON?: () => unknown };
  if (typeof withToJSON.toJSON === 'function') {
    return cloneValue(withToJSON.toJSON(), seen);
  }
  const out: Record<string, unknown> = {};
  seen.set(v, out);
  for (const k of Object.keys(v as object)) out[k] = cloneValue((v as Record<string, unknown>)[k], seen);
  return out;
}

function canonical(v: unknown): unknown {
  if (v === undefined) return { __undef: true };
  if (v === null || typeof v !== 'object') return v;
  if (v instanceof Date) return { __date: v.getTime() };
  if (v instanceof Map) return { __map: [...v.entries()].map(([k, x]) => [canonical(k), canonical(x)]) };
  if (v instanceof Set) return { __set: [...v.values()].map(canonical) };
  if (Array.isArray(v)) return v.map(canonical);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v as object).sort()) out[k] = canonical((v as Record<string, unknown>)[k]);
  return out;
}

export function undoDeepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  return JSON.stringify(canonical(undoDeepClone(a))) === JSON.stringify(canonical(undoDeepClone(b)));
}

function isThenable(v: unknown): v is PromiseLike<unknown> {
  return !!v && typeof (v as { then?: unknown }).then === 'function';
}

function errorText(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === 'string' && e) return e;
  return UNDO_TEXT.unknownError;
}

// ── 서비스 ────────────────────────────────────────────────────────────────
interface Stack {
  past: UndoEntry[];
  future: UndoEntry[];
}

interface GroupFrame {
  label: string;
  children: UndoEntry[];
}

/** set 병합용 내부 상태 */
interface SetMergeState {
  before: unknown;
  after: unknown;
  assign(v: unknown): void;
}

const mergeStates = new WeakMap<UndoEntry, SetMergeState>();

const targetIds = new WeakMap<object, number>();
let nextTargetId = 1;
function targetId(obj: object): number {
  let id = targetIds.get(obj);
  if (id === undefined) {
    id = nextTargetId++;
    targetIds.set(obj, id);
  }
  return id;
}

const defaultDeps: UndoDeps = {
  curSession: () => {
    try {
      return getAppState().curSession;
    } catch {
      return undefined;
    }
  },
  // models/index.ts 가 sessionService.isMirror 로 바꿔 끼운다(순환 import 회피)
  isMirror: () => false,
  toast: (message, kind) => {
    try {
      getAppState().pushMessage(message, kind);
    } catch {
      /* 부팅 전 — 안내 생략 */
    }
  },
  now: () => Date.now(),
  confirm: (message, confirmText) => {
    try {
      return getAppState().confirmAsync(message, confirmText);
    } catch {
      // 부팅 전(확인 창을 띄울 수 없음) — 묻지 않고 진행(그때는 되돌릴 기록도 없다)
      return Promise.resolve(true);
    }
  },
};

export class UndoService {
  /** 스택이 바뀔 때마다 증가 — 버튼·퀵 메뉴의 활성 상태가 이것을 읽어 다시 그린다 */
  @observable accessor version: number = 0;

  #deps: UndoDeps;
  #stacks = new WeakMap<Session, Stack>();
  #groups = new WeakMap<Session, GroupFrame[]>();
  #pendingDrags = new WeakMap<Session, UndoPending>();
  #busy = false;
  #applying = false;
  #nextId = 1;
  maxDepth = UNDO_MAX_DEPTH;

  constructor(deps: Partial<UndoDeps> = {}) {
    this.#deps = { ...defaultDeps, ...deps };
    makeObservable(this);
  }

  configure(deps: Partial<UndoDeps>): void {
    this.#deps = { ...this.#deps, ...deps };
    this.#bump();
  }

  #bump() {
    runInAction(() => {
      this.version++;
    });
  }

  #stack(session: Session): Stack {
    let st = this.#stacks.get(session);
    if (!st) {
      st = { past: [], future: [] };
      this.#stacks.set(session, st);
    }
    return st;
  }

  /** 실행 중(되돌림·다시 실행 처리 중) — 이 동안 기록은 무시된다 */
  get isApplying(): boolean {
    return this.#applying;
  }

  get isBusy(): boolean {
    return this.#busy;
  }

  /** 이 프로젝트에 기록할 수 있는가(실행 중·미러면 아니오) */
  canRecord(session: Session | undefined): session is Session {
    if (!session) return false;
    if (this.#applying) return false;
    return !this.#deps.isMirror(session);
  }

  // ── 조회(UI) — curSession 기준 ──
  get canUndo(): boolean {
    return this.canUndoFor(this.#deps.curSession());
  }

  get canRedo(): boolean {
    return this.canRedoFor(this.#deps.curSession());
  }

  get undoLabel(): string | undefined {
    return this.peekLabel(this.#deps.curSession(), 'undo');
  }

  get redoLabel(): string | undefined {
    return this.peekLabel(this.#deps.curSession(), 'redo');
  }

  canUndoFor(session: Session | undefined): boolean {
    return !!this.peekLabel(session, 'undo');
  }

  canRedoFor(session: Session | undefined): boolean {
    return !!this.peekLabel(session, 'redo');
  }

  peekLabel(session: Session | undefined, dir: UndoDirection): string | undefined {
    void this.version; // 관찰 구독
    if (!session || this.#deps.isMirror(session)) return undefined;
    const st = this.#stacks.get(session);
    const list = dir === 'undo' ? st?.past : st?.future;
    if (!list || list.length === 0) return undefined;
    const top = list[list.length - 1];
    return dir === 'undo' ? (top.undoLabel ?? top.label) : top.label;
  }

  /** 테스트·진단용 스택 사본 */
  entries(session: Session): { past: readonly UndoEntry[]; future: readonly UndoEntry[] } {
    const st = this.#stacks.get(session);
    return { past: [...(st?.past ?? [])], future: [...(st?.future ?? [])] };
  }

  clear(session: Session): void {
    this.#stacks.delete(session);
    this.#bump();
  }

  // ── 기록 ──
  #makeEntry(init: UndoEntryInit): UndoEntry {
    const now = this.#deps.now();
    return {
      ...init,
      kind: init.kind ?? 'state',
      id: this.#nextId++,
      createdAt: now,
      updatedAt: now,
    };
  }

  #openFrame(session: Session): GroupFrame | undefined {
    const frames = this.#groups.get(session);
    return frames && frames.length > 0 ? frames[frames.length - 1] : undefined;
  }

  #push(session: Session, entry: UndoEntry) {
    const frame = this.#openFrame(session);
    if (frame) {
      frame.children.push(entry);
      return;
    }
    const st = this.#stack(session);
    st.past.push(entry);
    while (st.past.length > this.maxDepth) st.past.shift();
    st.future = [];
    this.#bump();
  }

  /** 항목 하나를 기록한다. 실행 중·미러면 무시(undefined) */
  record(session: Session | undefined, init: UndoEntryInit): UndoEntry | undefined {
    if (!this.canRecord(session)) return undefined;
    const entry = this.#makeEntry(init);
    this.#push(session, entry);
    return entry;
  }

  // ── 실행 ──
  undo(session: Session | undefined = this.#deps.curSession()): Promise<boolean> {
    return this.#execute(session, 'undo');
  }

  redo(session: Session | undefined = this.#deps.curSession()): Promise<boolean> {
    return this.#execute(session, 'redo');
  }

  #remove(list: UndoEntry[], entry: UndoEntry) {
    const i = list.lastIndexOf(entry);
    if (i >= 0) list.splice(i, 1);
  }

  async #execute(session: Session | undefined, dir: UndoDirection): Promise<boolean> {
    if (!session || this.#deps.isMirror(session)) return false;
    if (this.#busy) {
      this.#deps.toast(UNDO_TEXT.busy, 'info');
      return false;
    }
    // 끝나지 않은 드래그가 있으면 먼저 확정(놓친 pointerup — 기록 순서 보존)
    this.#pendingDrags.get(session)?.commit();
    const st = this.#stacks.get(session);
    const src = dir === 'undo' ? st?.past : st?.future;
    if (!st || !src || src.length === 0) return false;
    const entry = src[src.length - 1];
    const fail = (reason: string) => {
      this.#remove(src, entry);
      this.#deps.toast(
        dir === 'undo' ? UNDO_TEXT.undoFailed(reason) : UNDO_TEXT.redoFailed(reason),
        'error',
      );
      return false;
    };
    this.#busy = true;
    this.#bump();
    try {
      const v = entry.verify?.(dir);
      if (v !== undefined && v !== true) return fail(v);
      // D16 — 기록 밖 변경과 겹쳤으면 묻는다. 취소면 항목을 그대로 둔다(다시 누르면 다시 묻는다).
      if (entry.conflict?.(dir)) {
        const label = dir === 'undo' ? (entry.undoLabel ?? entry.label) : entry.label;
        const ok = await this.#deps.confirm(
          dir === 'undo' ? UNDO_TEXT.conflictUndo(label) : UNDO_TEXT.conflictRedo(label),
          dir === 'undo' ? UNDO_TEXT.undoName : UNDO_TEXT.redoName,
        );
        if (!ok) return false;
      }
      let outcome: UndoRunResult;
      this.#applying = true;
      try {
        const r = entry[dir]();
        outcome = isThenable(r) ? await r : r;
      } finally {
        this.#applying = false;
      }
      if (outcome && outcome.total > 0 && outcome.failed >= outcome.total) {
        return fail(outcome.firstError ?? UNDO_TEXT.groupAllFailed);
      }
      this.#remove(src, entry);
      const dst = dir === 'undo' ? st.future : st.past;
      dst.push(entry);
      while (dst.length > this.maxDepth) dst.shift();
      const base =
        dir === 'undo' ? UNDO_TEXT.undone(entry.undoLabel ?? entry.label) : UNDO_TEXT.redone(entry.label);
      const partial =
        outcome && outcome.failed > 0 ? UNDO_TEXT.partial(outcome.failed, outcome.total) : '';
      this.#deps.toast(base + partial, partial ? 'error' : 'info');
      return true;
    } catch (e) {
      return fail(errorText(e));
    } finally {
      this.#busy = false;
      this.#bump();
    }
  }

  // ── 헬퍼 ──

  /**
   * 값 하나를 바꾸고 기록. 같은 target·key 를 mergeMs(기본 1초) 안에 또 바꾸면 맨 위 항목에 합친다.
   * 합친 결과가 처음 값과 같아지면 항목을 지운다. 값은 원시값·불변 값 전용(객체는 capture 를 쓴다).
   */
  set<T extends object, K extends keyof T>(
    session: Session | undefined,
    target: T,
    key: K,
    next: T[K],
    label: string,
    opts: {
      mergeMs?: number;
      /** 되돌림·다시 실행 때 대입할 객체를 손잡이로(삭제 복원으로 객체가 바뀌어도 따라간다) */
      ref?: UndoRef<T>;
      /** 실행 직전 검사(대상이 아직 있는가 등) */
      verify?: () => true | string;
    } = {},
  ): void {
    const prev = target[key];
    if (Object.is(prev, next)) return;
    runInAction(() => {
      target[key] = next;
    });
    if (!this.canRecord(session)) return;
    const ref = opts.ref;
    const mergeKey = `set:${targetId(ref ?? target)}:${String(key)}`;
    const mergeMs = opts.mergeMs ?? UNDO_MERGE_MS;
    const now = this.#deps.now();
    const frame = this.#openFrame(session);
    const st = this.#stack(session);
    const top = frame
      ? frame.children[frame.children.length - 1]
      : st.future.length === 0
        ? st.past[st.past.length - 1]
        : undefined;
    const merge = top && top.mergeKey === mergeKey ? mergeStates.get(top) : undefined;
    if (top && merge && now - top.updatedAt <= mergeMs) {
      merge.after = next;
      top.updatedAt = now;
      if (Object.is(merge.before, next)) {
        if (frame) this.#remove(frame.children, top);
        else this.#remove(st.past, top);
      }
      this.#bump();
      return;
    }
    const assign = (v: unknown) =>
      runInAction(() => {
        (ref ? ref.current : target)[key] = v as T[K];
      });
    const state: SetMergeState = { before: prev, after: next, assign };
    const verify = opts.verify;
    const entry = this.record(session, {
      label,
      mergeKey,
      ...(verify ? { verify: () => verify() } : {}),
      undo: () => state.assign(state.before),
      redo: () => state.assign(state.after),
    });
    if (entry) mergeStates.set(entry, state);
  }

  /**
   * 지정 필드를 깊은 복사로 보관해 두었다가 commit 때 바뀌었으면 1항목. 되살릴 때마다 새 사본을 대입한다.
   * restore 를 주면 사본(평범한 JSON 형)을 클래스 객체로 되돌린다(fromJSON 등).
   */
  capture<T extends object>(
    session: Session | undefined,
    label: string,
    target: T,
    keys: (keyof T)[],
    opts: { restore?: (key: keyof T, plain: unknown) => unknown } = {},
  ): UndoPending {
    return this.#snapshotPending(session, label, this.#fieldsAdapter(target, keys, opts));
  }

  /** 객체 필드가 아닌 상태(씬 순서 등)를 상태 짝으로 감싼다 — 시작에 보관, commit 때 바뀌었으면 1항목 */
  track<S>(session: Session | undefined, label: string, adapter: UndoSnapshotAdapter<S>): UndoPending {
    return this.#snapshotPending(session, label, adapter);
  }

  #fieldsAdapter<T extends object>(
    target: T,
    keys: (keyof T)[],
    opts: { restore?: (key: keyof T, plain: unknown) => unknown },
  ): UndoSnapshotAdapter<unknown[]> {
    return {
      // 통째 덮어쓰는 복원 — 기록 밖 변경과 겹치면 확인(D16)
      detectConflict: true,
      snapshot: () => keys.map((k) => undoDeepClone(target[k])),
      restore: (snap) =>
        runInAction(() => {
          keys.forEach((k, i) => {
            const plain = undoDeepClone(snap[i]);
            target[k] = (opts.restore ? opts.restore(k, plain) : plain) as T[keyof T];
          });
        }),
    };
  }

  #snapshotPending<S>(
    session: Session | undefined,
    label: string,
    adapter: UndoSnapshotAdapter<S>,
    onSettle?: () => void,
  ): UndoPending {
    if (!this.canRecord(session)) {
      return { commit: () => false, cancel: () => {} };
    }
    const before = adapter.snapshot();
    let done = false;
    const settle = () => {
      done = true;
      onSettle?.();
    };
    return {
      commit: () => {
        if (done) return false;
        settle();
        if (!this.canRecord(session)) return false;
        const after = adapter.snapshot();
        const eq = (a: S, b: S) => (adapter.equals ? adapter.equals(a, b) : undoDeepEqual(a, b));
        if (eq(before, after)) return false;
        const verify = adapter.verify;
        this.record(session, {
          label,
          ...(verify ? { verify: () => verify() } : {}),
          // D16 — 되돌림은 지금이 「이후 값」, 다시 실행은 지금이 「이전 값」이어야 겹침 없음
          ...(adapter.detectConflict
            ? { conflict: (dir: UndoDirection) => !eq(adapter.snapshot(), dir === 'undo' ? after : before) }
            : {}),
          undo: () => adapter.restore(before),
          redo: () => adapter.restore(after),
        });
        return true;
      },
      cancel: () => {
        if (!done) settle();
      },
    };
  }

  /**
   * apply 를 실행하고 성공했을 때만 기록. 다시 실행 = apply, 되돌림 = revert. 비동기 허용(완료 뒤 기록).
   * 실패(예외)면 기록하지 않고 예외를 그대로 던진다.
   */
  run<R>(
    session: Session | undefined,
    label: string,
    op: {
      apply: () => R;
      revert: () => unknown;
      verify?: (dir: UndoDirection) => true | string;
      kind?: UndoKind;
    },
  ): R {
    const init = (): UndoEntryInit => ({
      label,
      kind: op.kind,
      verify: op.verify,
      redo: async () => {
        await op.apply();
      },
      undo: async () => {
        await op.revert();
      },
    });
    const r = op.apply();
    if (isThenable(r)) {
      return (r as unknown as Promise<unknown>).then((v) => {
        this.record(session, init());
        return v;
      }) as unknown as R;
    }
    this.record(session, init());
    return r;
  }

  /** fn 안에서 생긴 기록을 1항목으로 묶는다(되돌림 역순·다시 실행 정순). fn 이 실패해도 생긴 기록은 남긴다. */
  group<R>(session: Session | undefined, label: string, fn: () => R): R {
    const g = this.beginGroup(session, label);
    let r: R;
    try {
      r = fn();
    } catch (e) {
      g.commit();
      throw e;
    }
    if (isThenable(r)) {
      return (r as unknown as Promise<unknown>).then(
        (v) => {
          g.commit();
          return v;
        },
        (e) => {
          g.commit();
          throw e;
        },
      ) as unknown as R;
    }
    g.commit();
    return r;
  }

  /** 비동기 흐름용 묶음 — commit 까지 이 프로젝트의 기록이 묶음에 들어간다 */
  beginGroup(session: Session | undefined, label: string): UndoGroupHandle {
    if (!this.canRecord(session)) {
      return { add: () => {}, commit: () => false, cancel: () => {} };
    }
    const frame: GroupFrame = { label, children: [] };
    let frames = this.#groups.get(session);
    if (!frames) {
      frames = [];
      this.#groups.set(session, frames);
    }
    frames.push(frame);
    let done = false;
    const close = () => {
      done = true;
      const list = this.#groups.get(session);
      if (list) {
        const i = list.lastIndexOf(frame);
        if (i >= 0) list.splice(i, 1);
      }
    };
    return {
      add: (init) => {
        if (done || !this.canRecord(session)) return;
        frame.children.push(this.#makeEntry(init));
      },
      commit: () => {
        if (done) return false;
        close();
        if (frame.children.length === 0) return false;
        const children = frame.children;
        const kind: UndoKind = children.some((c) => c.kind === 'file') ? 'file' : 'state';
        const runAll = async (dir: UndoDirection): Promise<UndoOutcome> => {
          const order = dir === 'undo' ? [...children].reverse() : [...children];
          const total = order.length;
          let failed = 0;
          let firstError: string | undefined;
          for (const c of order) {
            const v = c.verify?.(dir);
            if (v !== undefined && v !== true) {
              failed++;
              firstError ??= v;
              this.#remove(children, c);
              continue;
            }
            try {
              const r = c[dir]();
              if (isThenable(r)) await r;
            } catch (e) {
              failed++;
              firstError ??= errorText(e);
              // 실패한 하위 항목만 버린다(D15) — 나머지는 다음 실행에도 유지
              this.#remove(children, c);
            }
          }
          return { total, failed, firstError };
        };
        const entry = this.#makeEntry({
          label,
          kind,
          // D16 — 하위 항목 하나라도 겹치면 묶음 전체를 한 번 묻는다(하위마다 묻지 않음)
          conflict: (dir) => children.some((c) => !!c.conflict?.(dir)),
          undo: () => runAll('undo'),
          redo: () => runAll('redo'),
        });
        this.#push(session, entry);
        return true;
      },
      cancel: () => {
        if (!done) close();
      },
    };
  }

  /**
   * 드래그·슬라이더처럼 누르는 동안 여러 번 바뀌는 상태 — 시작에 보관, 놓을 때 commit(변화 없으면 버림).
   * 객체 필드(target, keys) 또는 상태 짝(adapter)을 받는다. 같은 프로젝트에 끝나지 않은 드래그가 있으면 먼저 확정한다.
   */
  drag<T extends object>(
    session: Session | undefined,
    label: string,
    target: T | UndoSnapshotAdapter<unknown>,
    keys?: (keyof T)[],
  ): UndoPending {
    if (!this.canRecord(session)) return { commit: () => false, cancel: () => {} };
    this.#pendingDrags.get(session)?.commit();
    const adapter: UndoSnapshotAdapter<unknown> =
      keys !== undefined
        ? (this.#fieldsAdapter(target as T, keys, {}) as UndoSnapshotAdapter<unknown>)
        : (target as UndoSnapshotAdapter<unknown>);
    const pending: UndoPending = this.#snapshotPending(session, label, adapter, () => {
      if (this.#pendingDrags.get(session) === pending) this.#pendingDrags.delete(session);
    });
    this.#pendingDrags.set(session, pending);
    return pending;
  }

  /** 이 프로젝트의 끝나지 않은 drag(·편집 세션)가 아직 pending 인가 — 되돌리기 실행·다음 drag 로 확정됐으면 false */
  isPendingOpen(session: Session | undefined, pending: UndoPending): boolean {
    return !!session && this.#pendingDrags.get(session) === pending;
  }

  /** 입력 칸 포커스 진입 값을 보관하고, 떠날 때(commit) 바뀌었으면 1항목 */
  focusEdit<T extends object, K extends keyof T>(
    session: Session | undefined,
    target: T,
    key: K,
    label: string,
  ): UndoPending {
    return this.capture(session, label, target, [key]);
  }
}

export const undoService = new UndoService();
