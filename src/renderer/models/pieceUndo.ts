// 조각그룹(로컬 = 프로젝트 session.library, 전역 = GlobalPieceService.library)의 되돌리기 계측
// (2026-11-02 U5 로컬, 2026-11-04 되돌리기 2차 묶음 5 전역 — SPEC_GUIDE 「되돌리기 계약」, jest undoVariantPiece.test.ts·undoBundle5.test.ts).
//
// · 기록은 호출부(PieceEditor·PieceCell·AppState 조각 JSON 드롭)의 사용자 동작 지점에서만 이 모듈의 헬퍼로 한다.
// · 범위 = 대상 Map·그룹이 어디에 있는가로 헬퍼가 정한다(호출부는 범위를 넘기지 않는다):
//   - 현재 프로젝트 session.library → 그 프로젝트 스택. 통째 복원이라 기록 밖 변경과 겹치면 확인(D16).
//   - 전역 조각(configurePieceUndo 의 globalLibrary() — GlobalPieceService.library) → **전역 스택**(GLOBAL_UNDO_SCOPE).
//     프로젝트가 없어도 기록·실행한다. D16 확인 창 대신 실행 직전 지금 내용이 기록 결과와 다르면 실패+폐기(staleReason·verify —
//     2차 묶음 2·4 전역 규칙). 라벨 앞에 「전역」(UNDO_TEXT.globalPieceLabel).
//   - 그 밖(다른 프로젝트 Map 등) → 실행만.
// · 복원 단위 = 조각그룹(이름별 JSON 깊은 사본) + 그룹 순서. 되살릴 때 지금 그룹 객체·조각 객체를 다시 쓴다(이름이 같은 조각,
//   없으면 같은 자리의 남는 조각) — 열린 편집기(PromptEditTextArea 가 처음 받은 onChange 를 계속 씀)가 떨어진 옛 객체에 입력하는
//   일을 막는다. 값은 언제나 사본에서 온다. 지워진 그룹은 원래 자리로 되살린다. 기록 밖에서 생긴 그룹은 지우지 않고 뒤에 남긴다.
// · 되살린 뒤: 로컬 = 자동완성 조각 목록 재구성(onRestored), 전역 = 저장 예약(GlobalPieceService.scheduleSave — 기존 저장 경로)
//   + 현재 프로젝트 자동완성 재구성(onGlobalRestored).
// · 조각 파일·내보내기는 다루지 않는다. 이 모듈은 잠금을 쓰지 않는다(MobX 대입만 — 로컬 저장은 기존 RS.watch 자동 persist,
//   전역 저장은 scheduleSave → persistService). 직접 파일을 쓰지 않는다.
import { runInAction } from 'mobx';
import { editTargetId, flushSceneFieldEdit, touchUndoEdit } from './sceneFieldUndo';
import type { FocusLeaveWatcher } from './sceneFieldUndo';
import { Piece, PieceLibrary } from './types';
import type { IPieceLibrary, Session } from './types';
import {
  GLOBAL_UNDO_SCOPE,
  undoDeepClone,
  undoDeepEqual,
  undoRef,
  undoService,
  UNDO_TEXT,
  UndoDirection,
  UndoPending,
  UndoScope,
  UndoService,
  UndoSnapshotAdapter,
} from './undoService';

export interface PieceUndoDeps {
  /** 로컬 그룹을 되살린 뒤 — 자동완성 조각 목록 재구성(sessionService.reloadPieceLibraryDB) */
  onRestored?(session: Session): void;
  /** 전역 조각그룹 Map(GlobalPieceService.library — 부를 때의 값. load 가 새 Map 으로 바꿀 수 있다) */
  globalLibrary?(): Map<string, PieceLibrary>;
  /** 전역 그룹을 되살린 뒤 — 저장 예약 + 현재 프로젝트 자동완성 재구성 */
  onGlobalRestored?(): void;
}

let deps: PieceUndoDeps = {};

/** models/index.ts 가 배선한다(순환 import 회피) */
export function configurePieceUndo(next: PieceUndoDeps): void {
  deps = { ...deps, ...next };
}

export interface PieceUndoOptions {
  service?: UndoService;
}

const NOOP: UndoPending = { commit: () => false, cancel: () => {} };

/** 이 조각그룹 객체가 현재 프로젝트 로컬 조각에 있으면 그 이름(전역·다른 프로젝트면 undefined) */
export function localGroupNameOf(session: Session | undefined, lib: PieceLibrary | null | undefined): string | undefined {
  if (!session || !lib) return undefined;
  for (const [name, v] of session.library.entries()) if (v === lib) return name;
  return undefined;
}

/** 이 조각그룹 객체가 전역 조각에 있으면 그 이름(배선 전·없으면 undefined) */
export function globalGroupNameOf(lib: PieceLibrary | null | undefined): string | undefined {
  const map = deps.globalLibrary?.();
  if (!map || !lib) return undefined;
  for (const [name, v] of map.entries()) if (v === lib) return name;
  return undefined;
}

// ── 범위(로컬 프로젝트 / 전역) ─────────────────────────────────────────────

interface PieceHost {
  /** 기록할 스택 */
  scope: UndoScope;
  global: boolean;
  /** 지금 그룹 Map(부를 때마다 다시 읽는다) */
  map(): Map<string, PieceLibrary>;
  /** 그룹 순서를 keys 로(같은 그룹 객체 유지) */
  reorder(keys: string[]): void;
  afterRestore(): void;
  label(label: string): string;
}

function localHost(session: Session): PieceHost {
  return {
    scope: session,
    global: false,
    map: () => session.library,
    reorder: (keys) => {
      const lib = session.library;
      session.library = new Map(keys.map((k) => [k, lib.get(k)!] as [string, PieceLibrary]));
    },
    afterRestore: () => deps.onRestored?.(session),
    label: (l) => l,
  };
}

function globalHost(): PieceHost | undefined {
  const get = deps.globalLibrary;
  if (!get) return undefined;
  return {
    scope: GLOBAL_UNDO_SCOPE,
    global: true,
    map: get,
    // 전역 Map 은 서비스 필드라 제자리에서 순서를 바꾼다(지우고 다시 넣으면 뒤로 간다 — 같은 객체 유지)
    reorder: (keys) => {
      const m = get();
      for (const k of keys) {
        const v = m.get(k);
        if (!v) continue;
        m.delete(k);
        m.set(k, v);
      }
    },
    afterRestore: () => deps.onGlobalRestored?.(),
    label: (l) => UNDO_TEXT.globalPieceLabel(l),
  };
}

/** 대상 Map 의 범위 — 이 프로젝트 로컬 / 전역 / 그 밖(undefined = 실행만) */
function hostOfMap(session: Session | undefined, target: Map<string, PieceLibrary> | undefined): PieceHost | undefined {
  if (!target) return undefined;
  if (session && target === session.library) return localHost(session);
  if (deps.globalLibrary && target === deps.globalLibrary()) return globalHost();
  return undefined;
}

/** 그룹 객체의 범위와 이름 */
function hostOfLib(
  session: Session | undefined,
  lib: PieceLibrary | null | undefined,
): { host: PieceHost; name: string } | undefined {
  const local = localGroupNameOf(session, lib);
  if (local !== undefined) return { host: localHost(session!), name: local };
  const global = globalGroupNameOf(lib);
  if (global !== undefined) {
    const host = globalHost();
    if (host) return { host, name: global };
  }
  return undefined;
}

function canRecordHost(service: UndoService, host: PieceHost | undefined): host is PieceHost {
  return !!host && service.canRecord(host.scope);
}

// ── 상태 짝 ───────────────────────────────────────────────────────────────

interface GroupsSnap {
  /** 그룹 이름 순서(전체) — 지운 그룹을 원래 자리로 되살릴 때만 쓴다 */
  order: string[];
  /** 담은 그룹의 JSON(없던 그룹 = undefined) */
  groups: (IPieceLibrary | undefined)[];
}

/** 그룹 객체에 사본 값을 넣는다 — 이름이 같은 조각 객체, 없으면 같은 자리의 남는 조각 객체를 다시 쓴다 */
function restoreLibraryInto(lib: PieceLibrary, json: IPieceLibrary): void {
  lib.version = json.version;
  lib.name = json.name;
  const live = lib.pieces;
  const used = new Set<Piece>();
  const byName = (name: string) => live.find((p) => !used.has(p) && p.name === name);
  // 1차: 이름이 같은 조각
  const picked: (Piece | undefined)[] = json.pieces.map((j) => {
    const hit = byName(j.name);
    if (hit) used.add(hit);
    return hit;
  });
  // 2차: 이름이 바뀐 조각(이름 변경 되돌림 등) — 같은 자리의 남는 객체
  const next = json.pieces.map((j, i) => {
    let p = picked[i];
    if (!p) {
      const sameSlot = live[i];
      if (sameSlot && !used.has(sameSlot) && !json.pieces.some((x) => x.name === sameSlot.name)) {
        p = sameSlot;
        used.add(p);
      }
    }
    if (!p) return Piece.fromJSON({ ...j });
    p.name = j.name;
    p.prompt = j.prompt;
    p.multi = j.multi;
    return p;
  });
  if (next.length !== live.length || next.some((p, i) => p !== live[i])) lib.pieces = next;
}

function groupsAdapter(host: PieceHost, names: readonly string[]): UndoSnapshotAdapter<GroupsSnap> {
  const read = (): GroupsSnap => {
    const lib = host.map();
    return {
      order: Array.from(lib.keys()),
      groups: names.map((n) => {
        const g = lib.get(n);
        return g ? undoDeepClone(g.toJSON()) : undefined;
      }),
    };
  };
  return {
    // 로컬 = 겹치면 확인(D16), 전역 = 겹치면 실패+폐기(전역 스택 규칙 — D16 확인 창 없음)
    ...(host.global ? { staleReason: UNDO_TEXT.globalPieceChanged(names.join(', ')) } : { detectConflict: true }),
    snapshot: read,
    // 순서는 비교하지 않는다(담은 그룹의 내용·있고 없음만) — 다른 그룹이 기록 밖에서 생겨도 겹침이 아니다
    equals: (a, b) => undoDeepEqual(a.groups, b.groups),
    restore: (snap) => {
      runInAction(() => {
        const lib = host.map();
        names.forEach((name, i) => {
          const json = snap.groups[i];
          const cur = lib.get(name);
          if (!json) {
            if (cur) lib.delete(name);
          } else if (cur) {
            restoreLibraryInto(cur, undoDeepClone(json));
          } else {
            lib.set(name, PieceLibrary.fromJSON(undoDeepClone(json)));
          }
        });
        // 되살린 그룹을 원래 자리로 — 기록 때 순서에 있던 이름은 그 순서대로, 기록 밖에서 생긴 이름은 지금 상대 순서로 뒤에
        const nowKeys = Array.from(lib.keys());
        const known = new Set(snap.order);
        const desired = [...snap.order.filter((k) => lib.has(k)), ...nowKeys.filter((k) => !known.has(k))];
        if (desired.some((k, i) => k !== nowKeys[i])) host.reorder(desired);
      });
      host.afterRestore();
    },
  };
}

/**
 * 조각그룹 이름 단위 동작(그룹 추가·삭제·JSON 불러오기·다른 범위에서 복사·와일드카드 그룹 자동 생성) — mutate 를 감싸 1항목.
 * target 이 이 프로젝트의 session.library 면 프로젝트 스택, 전역 조각 Map 이면 전역 스택(프로젝트 없어도), 그 밖이면 mutate 만.
 */
export function editPieceGroups<R>(
  session: Session | undefined,
  target: Map<string, PieceLibrary> | undefined,
  names: readonly string[],
  label: string,
  mutate: () => R,
  opts: PieceUndoOptions = {},
): R {
  const service = opts.service ?? undoService;
  const host = hostOfMap(session, target);
  if (!canRecordHost(service, host) || names.length === 0) return mutate();
  flushSceneFieldEdit();
  const pending = service.track(host.scope, host.label(label), groupsAdapter(host, Array.from(new Set(names))));
  try {
    return mutate();
  } finally {
    pending.commit();
  }
}

/** 그룹 객체 안의 동작(조각 추가·삭제·랜덤 줄 모드) — lib 가 로컬·전역 그룹이 아니면 mutate 만 */
export function editPieceLibrary<R>(
  session: Session | undefined,
  lib: PieceLibrary | null | undefined,
  label: (groupName: string) => string,
  mutate: () => R,
  opts: PieceUndoOptions = {},
): R {
  const hit = hostOfLib(session, lib);
  if (!hit) return mutate();
  return editPieceGroups(session, hit.host.map(), [hit.name], label(hit.name), mutate, opts);
}

/**
 * 조각 이름 변경 — 이름을 바꾸고(로컬·전역 그룹이면) 1항목. 되돌림 라벨은 「B → A」. 그룹 JSON 복원이라 조각 객체는 같은 자리
 * 객체를 다시 쓴다(열린 칸 유지).
 */
export function renamePieceRecorded(
  session: Session | undefined,
  lib: PieceLibrary | null | undefined,
  piece: Piece,
  next: string,
  opts: PieceUndoOptions = {},
): void {
  const service = opts.service ?? undoService;
  const from = piece.name;
  const apply = () =>
    runInAction(() => {
      piece.name = next;
    });
  const hit = hostOfLib(session, lib);
  if (from === next || !hit || !canRecordHost(service, hit.host)) {
    apply();
    return;
  }
  const { host, name: group } = hit;
  flushSceneFieldEdit();
  const adapter = groupsAdapter(host, [group]);
  const before = adapter.snapshot();
  apply();
  const after = adapter.snapshot();
  if (adapter.equals!(before, after)) return;
  const differs = (dir: UndoDirection) => !adapter.equals!(adapter.snapshot(), dir === 'undo' ? after : before);
  service.record(host.scope, {
    label: host.label(UNDO_TEXT.pieceRename(group, from, next)),
    undoLabel: host.label(UNDO_TEXT.pieceRename(group, next, from)),
    // 로컬 = 겹치면 확인(D16), 전역 = 겹치면 실패+폐기
    ...(host.global
      ? { verify: (dir: UndoDirection) => (differs(dir) ? UNDO_TEXT.globalPieceChanged(group) : true) }
      : { conflict: differs }),
    undo: () => adapter.restore(before),
    redo: () => adapter.restore(after),
  });
}

/**
 * 조각 내용 글자 입력 — 변경 **직전**에 부른다(값이 실제로 바뀔 때만). 입력 칸을 떠날 때 1항목(D13, 편집 세션 공유).
 * 로컬·전역 그룹이 아니면 아무것도 하지 않는다.
 */
export function touchPieceEdit(
  session: Session | undefined,
  lib: PieceLibrary | null | undefined,
  piece: Piece,
  opts: PieceUndoOptions & { watch?: FocusLeaveWatcher } = {},
): void {
  const service = opts.service ?? undoService;
  const hit = hostOfLib(session, lib);
  if (!hit || !canRecordHost(service, hit.host)) return;
  const { host, name: group } = hit;
  const label = host.label(UNDO_TEXT.piecePrompt(group, piece.name));
  const key = `piece|${editTargetId(undoRef(lib!))}|${editTargetId(piece)}`;
  touchUndoEdit(host.scope, key, label, () => groupsAdapter(host, [group]) as UndoSnapshotAdapter<unknown>, {
    service,
    watch: opts.watch,
  });
}

/** 조각 순서 드래그 — 끌기 시작에 보관, 끝(end)에 commit(변화 없으면 버림). 로컬·전역 그룹이 아니면 NOOP */
export function beginPieceDrag(
  session: Session | undefined,
  lib: PieceLibrary | null | undefined,
  opts: PieceUndoOptions = {},
): UndoPending {
  const service = opts.service ?? undoService;
  const hit = hostOfLib(session, lib);
  if (!hit || !canRecordHost(service, hit.host)) return NOOP;
  flushSceneFieldEdit();
  return service.drag(hit.host.scope, hit.host.label(UNDO_TEXT.pieceMove(hit.name)), groupsAdapter(hit.host, [hit.name]));
}

// ── 조각 드래그(F1 수정 — 되돌리기와 별개 결함) ─────────────────────────────

/** react-dnd 드래그 항목 — 옮길 조각 이름(pieceName)을 반드시 담는다(예전엔 빠져 movePiece(undefined) → 마지막 조각이 옮겨짐) */
export function pieceDragItem<T extends { name: string }, L>(piece: T, curPieceLibrary: L, name: string, width: number) {
  return { piece, pieceName: piece.name, curPieceLibrary, name, width };
}

/**
 * 같은 그룹 안에서 from 조각을 to 조각 자리로 옮긴다. 둘 중 하나라도 없거나 같으면 아무것도 하지 않는다(false).
 * (예전 구현은 이름을 못 찾으면 splice(-1, 1) 로 마지막 조각을 빼서 옮겼다 — F1)
 */
export function movePieceInLibrary(lib: { pieces: Piece[] }, from: string | undefined, to: string | undefined): boolean {
  if (from === undefined || to === undefined || from === to) return false;
  const fromIndex = lib.pieces.findIndex((p) => p.name === from);
  const toIndex = lib.pieces.findIndex((p) => p.name === to);
  if (fromIndex < 0 || toIndex < 0) return false;
  runInAction(() => {
    const [moved] = lib.pieces.splice(fromIndex, 1);
    lib.pieces.splice(toIndex, 0, moved);
  });
  return true;
}
