// 씬 구조 작업(생성·이름 변경·북마크)의 되돌리기 계측(2026-11-01 U2a, SPEC_GUIDE 「되돌리기 계약」, jest undoSceneStructure.test.ts).
//
// · 기록은 호출부(UI·흐름 계층)가 서비스·세션 등록이 **성공한 뒤** 부른다 — 이 모듈은 잠금 안에서 불리지 않는다.
// · 씬 생성 되돌림 = TrashService.moveSceneToTrash(슬롯 이름 기억), 다시 실행 = restoreScene(슬롯) + rebind(옛 객체 → 새 객체)
//   + (슬롯 이름이 원래 이름과 다르고 비어 있으면) 원래 이름으로 이름 변경 + 되돌릴 때의 자리로 이동.
//   Map 에서 직접 빼지 않는다(씬 유실 가드 — SPEC §8). 휴지통행이라 그사이 생긴 이미지도 함께 보존·복원된다.
//   생성 때 만든 파일(바이브·마스크 등)·예약은 되돌리지 않는다(남아도 무해).
// · 이름 변경 되돌림 = renameScene / renameInpaintScene 역호출(각자 다른 창 잠금·withLock). 동명 병합(mergeScene)은 기록하지 않는다.
// · 북마크 = SessionService.setSceneBookmark 절대값(이전 값 ↔ 이후 값).
// · 씬은 손잡이(undoRef)로 잡고 실행 시점에 세션에 그 객체가 아직 있는지·현재 이름을 확인한다.
// · 서비스는 models/index.ts 가 configureSceneStructureUndo 로 넣는다(순환 import 회피 — 테스트는 ops 를 직접 넘긴다).
import { runInAction } from 'mobx';
import type { GenericScene, Session } from './types';
import {
  rebind,
  undoRef,
  undoService,
  UNDO_TEXT,
  UndoEntryInit,
  UndoRef,
  UndoService,
} from './undoService';

export interface SceneBookmarkValue {
  name: string;
  type: string;
}

/** 이 모듈이 부르는 공개 서비스 메서드(각자 관문을 지킨다) */
export interface SceneStructureOps {
  /** 슬롯 이름 반환, 다른 창 잠금이면 undefined, 이동 실패는 throw */
  moveSceneToTrash(session: Session, scene: GenericScene): Promise<string | undefined>;
  /** 세션에 다시 넣은 씬 객체, 다른 창 잠금이면 undefined, 실패는 throw */
  restoreScene(session: Session, slot: string): Promise<GenericScene | undefined>;
  /** 다른 창 잠금이면 조용히 반환(호출 뒤 이름으로 확인) */
  renameScene(session: Session, oldName: string, newName: string): Promise<unknown>;
  /** true = 바뀜, false = 다른 창 잠금. 동명·이동 실패는 throw */
  renameInpaintScene(session: Session, oldName: string, newName: string): Promise<boolean>;
  getSceneBookmark(projectName: string): SceneBookmarkValue | undefined;
  setSceneBookmark(projectName: string, value: SceneBookmarkValue | undefined): Promise<void>;
}

let configuredOps: SceneStructureOps | undefined;

export function configureSceneStructureUndo(ops: SceneStructureOps): void {
  configuredOps = ops;
}

function resolveOps(ops?: SceneStructureOps): SceneStructureOps {
  const o = ops ?? configuredOps;
  if (!o) throw new Error('씬 구조 되돌리기가 준비되지 않았습니다');
  return o;
}

export interface SceneStructureUndoOptions {
  service?: UndoService;
  ops?: SceneStructureOps;
}

/** 세션에 그 객체가 아직 들어 있는가(이름이 아니라 객체로 — 이름 변경 중에도 판정이 흔들리지 않는다) */
export function sceneInSession(session: Session, scene: GenericScene): boolean {
  return session.getScene(scene.type, scene.name) === scene;
}

// ── 생성 ──────────────────────────────────────────────────────────────────

interface CreatedHooks {
  /** 휴지통으로 보낸 뒤(되돌림 성공 뒤) — 생성 때 함께 바꾼 세션 필드를 되돌릴 때 */
  afterUndo?: () => void;
  /** 다시 넣은 뒤 */
  afterRedo?: () => void;
}

function createdEntry(
  session: Session,
  scene: GenericScene,
  label: string,
  getOps: () => SceneStructureOps,
  hooks: CreatedHooks = {},
): UndoEntryInit {
  const ref: UndoRef<GenericScene> = undoRef(scene);
  const type = scene.type;
  let slot: string | undefined; // 되돌린 뒤 휴지통 슬롯
  let name = scene.name; // 되돌릴 때의 이름(다시 실행 후 이 이름으로)
  let index = -1; // 되돌릴 때의 자리
  return {
    label,
    kind: 'file',
    verify: (dir) => {
      if (dir === 'undo') {
        return sceneInSession(session, ref.current) ? true : UNDO_TEXT.sceneGone(ref.current.name);
      }
      return slot ? true : UNDO_TEXT.sceneNotInTrash;
    },
    undo: async () => {
      const cur = ref.current;
      if (!sceneInSession(session, cur)) throw new Error(UNDO_TEXT.sceneGone(cur.name));
      const curName = cur.name;
      const curIndex = session.getScenes(type).indexOf(cur);
      const s = await getOps().moveSceneToTrash(session, cur);
      // 다른 창 잠금으로 조용히 돌아온 경우(씬이 남아 있음)
      if (!s || sceneInSession(session, cur)) throw new Error(UNDO_TEXT.sceneStructureBlocked);
      slot = s;
      name = curName;
      index = curIndex;
      hooks.afterUndo?.();
    },
    redo: async () => {
      if (!slot) throw new Error(UNDO_TEXT.sceneNotInTrash);
      const ops = getOps();
      const restored = await ops.restoreScene(session, slot);
      if (!restored) throw new Error(UNDO_TEXT.sceneStructureBlocked);
      // 그 아래·위 항목(순서·이름 등)이 잡은 손잡이도 새 객체를 가리키게
      rebind(ref.current, restored);
      slot = undefined;
      // 슬롯 이름이 원래 이름과 다르면(휴지통에 같은 이름 기록이 있었음) 비어 있을 때 원래 이름으로
      if (restored.name !== name && !session.hasScene(type, name)) {
        try {
          if (type === 'scene') await ops.renameScene(session, restored.name, name);
          else await ops.renameInpaintScene(session, restored.name, name);
        } catch (e) {
          console.warn('다시 실행: 원래 씬 이름으로 바꾸지 못했습니다(휴지통 슬롯 이름 유지):', e);
        }
      }
      if (index >= 0 && sceneInSession(session, restored)) session.moveScene(restored, index);
      hooks.afterRedo?.();
    },
  };
}

/**
 * 방금 세션에 등록한 씬들을 1항목으로 기록(D14 — 한 번의 사용자 동작 = 1항목).
 * 실제로 세션에 들어 있는 씬만 기록한다. 여러 개면 묶음(되돌림 역순·다시 실행 정순, 일부 실패 시 나머지 계속).
 */
export function recordScenesCreated(
  session: Session | undefined,
  scenes: readonly GenericScene[],
  label: string,
  opts: SceneStructureUndoOptions & CreatedHooks = {},
): boolean {
  const service = opts.service ?? undoService;
  if (!session || !service.canRecord(session)) return false;
  const added = scenes.filter((s) => sceneInSession(session, s));
  if (added.length === 0) return false;
  const getOps = () => resolveOps(opts.ops);
  if (added.length === 1) {
    const hooks: CreatedHooks = { afterUndo: opts.afterUndo, afterRedo: opts.afterRedo };
    return !!service.record(session, createdEntry(session, added[0], label, getOps, hooks));
  }
  // 세션 필드 훅(afterUndo/afterRedo)은 씬 하나짜리 생성(변형 씬 생성)에서만 쓴다
  const g = service.beginGroup(session, label);
  for (const scene of added) g.add(createdEntry(session, scene, label, getOps));
  return g.commit();
}

/**
 * 미러 변형 씬 생성은 세션 미러 원본(mirrorImage)도 바꾼다 — 되돌림은 그 값이 아직 이번 생성 값일 때만 이전 값으로,
 * 다시 실행은 이전 값 그대로일 때만 다시 이번 값으로(그사이 다른 미러 원본으로 바뀌었으면 건드리지 않는다).
 */
export function mirrorImageHooks(
  session: Session,
  prev: string | undefined,
  next: string | undefined,
): CreatedHooks {
  if (prev === next) return {};
  return {
    afterUndo: () => {
      if (session.mirrorImage === next) runInAction(() => (session.mirrorImage = prev));
    },
    afterRedo: () => {
      if (session.mirrorImage === prev) runInAction(() => (session.mirrorImage = next));
    },
  };
}

// ── 이름 변경 ──────────────────────────────────────────────────────────────

/**
 * 이름 변경이 성공한 뒤(서비스 호출이 끝나고 잠금이 풀린 뒤) 부른다. scene 이 세션에 있고 이름이 oldName 에서
 * 바뀌었을 때만 기록 — 다른 창 잠금으로 조용히 돌아왔거나 병합·실패면 기록하지 않는다.
 */
export function recordSceneRename(
  session: Session | undefined,
  scene: GenericScene,
  oldName: string,
  opts: SceneStructureUndoOptions = {},
): boolean {
  const service = opts.service ?? undoService;
  if (!session || !service.canRecord(session)) return false;
  const newName = scene.name;
  if (newName === oldName || !sceneInSession(session, scene)) return false;
  const ref: UndoRef<GenericScene> = undoRef(scene);
  const type = scene.type;
  const renameTo = async (from: string, to: string) => {
    const ops = resolveOps(opts.ops);
    const cur = ref.current;
    if (type === 'scene') await ops.renameScene(session, from, to);
    else await ops.renameInpaintScene(session, from, to);
    // renameScene 은 다른 창 잠금이면 조용히 돌아온다 — 결과로 판정
    if (cur.name !== to || !sceneInSession(session, cur)) {
      throw new Error(UNDO_TEXT.sceneStructureBlocked);
    }
  };
  const check = (from: string, to: string): true | string => {
    const cur = ref.current;
    if (!sceneInSession(session, cur)) return UNDO_TEXT.sceneGone(cur.name);
    if (cur.name !== from) return UNDO_TEXT.sceneNameChanged(cur.name);
    if (session.hasScene(type, to)) return UNDO_TEXT.sceneNameTaken(to);
    return true;
  };
  return !!service.record(session, {
    label: UNDO_TEXT.sceneRename(oldName, newName),
    undoLabel: UNDO_TEXT.sceneRename(newName, oldName),
    kind: 'file',
    verify: (dir) => (dir === 'undo' ? check(newName, oldName) : check(oldName, newName)),
    undo: () => renameTo(newName, oldName),
    redo: () => renameTo(oldName, newName),
  });
}

// ── 북마크 ────────────────────────────────────────────────────────────────

/** 씬 북마크 토글(프로젝트당 1개) — 절대값으로 바꾸고 이전 값을 기록. 저장이 끝난 뒤 기록된다. */
export function toggleSceneBookmarkRecorded(
  session: Session,
  scene: GenericScene,
  opts: SceneStructureUndoOptions = {},
): Promise<void> {
  const service = opts.service ?? undoService;
  const ops = resolveOps(opts.ops);
  const before = ops.getSceneBookmark(session.name);
  const turningOff = before?.name === scene.name;
  const after: SceneBookmarkValue | undefined = turningOff
    ? undefined
    : { name: scene.name, type: scene.type };
  const prev = before ? { ...before } : undefined;
  return service.run(
    session,
    turningOff ? UNDO_TEXT.sceneBookmarkOff(scene.name) : UNDO_TEXT.sceneBookmarkOn(scene.name),
    {
      // 프로젝트 이름은 실행 시점 값(이름 변경 뒤에도 같은 인스턴스)
      apply: () => ops.setSceneBookmark(session.name, after),
      revert: () => ops.setSceneBookmark(session.name, prev),
    },
  );
}
