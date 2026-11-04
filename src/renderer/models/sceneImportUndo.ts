// 씬 불러오기 두 경로의 되돌리기 계측(2026-11-04 되돌리기 2차 묶음 5, SPEC_GUIDE 「되돌리기 계약」 「2차 묶음 5」,
// jest undoBundle5.test.ts).
//
// · 씬 템플릿에서 씬 불러오기(TemplateService.importSceneTemplate — 씬 템플릿 관리자 「프로젝트로 복사」·순차 생성 「씬 템플릿을
//   프로젝트로 복사」): 서비스는 기록하지 않고(SPEC — 서비스 안 기록 금지) 들어간 씬·휴지통으로 보낸 기존 씬을 돌려준다.
//   호출부가 그 결과로 recordSceneTemplateImport 를 부른다 → 1항목(묶음). 되돌림(역순) = 들어간 씬을 휴지통으로(outs 함께 —
//   moveSceneToTrash) → 덮어쓴 기존 씬을 휴지통에서 원래 이름·자리로 꺼냄. 다시 실행(정순) = 기존 씬 다시 휴지통 → 들어간 씬 꺼냄.
//   짝은 U2a·U4 와 같은 sceneStructureUndo(sceneDeletedEntry·sceneRestoredEntry) — 씬 제거는 언제나 휴지통 관문.
// · 현재 프로젝트에 씬만 불러오기(AppService 프로젝트 파일 드롭 → 「현재 프로젝트에 씬만 불러오기」): importProjectScenesRecorded 가
//   같은 이름 씬의 slots·resolution 덮어쓰기(editScenesFields — slots 는 restoreSlotsPreservingPieces 규칙)와 새 씬
//   (recordScenesCreated)을 1항목(묶음)으로. 되돌림(역순) = 새 씬 휴지통 → 덮어쓴 필드 복원(D16 겹침 확인은 필드 항목 규칙 그대로).
// · 이미지 필드(imageMap·mains·game·round)는 담지 않는다. 잠금(withLock)·직접 파일 쓰기·Map 직접 삭제 없음(specGuard UNDO_MODULES).
import { editScenesFields, flushSceneFieldEdit } from './sceneFieldUndo';
import type { SceneFieldKey } from './sceneFieldUndo';
import {
  recordScenesCreated,
  sceneDeletedEntry,
  sceneInSession,
  sceneRestoredEntry,
} from './sceneStructureUndo';
import type { SceneStructureOps, TrashedSceneInfo } from './sceneStructureUndo';
import type { GenericScene, Session } from './types';
import { undoService, UNDO_TEXT, UndoService } from './undoService';

export interface SceneImportUndoOptions {
  service?: UndoService;
  ops?: SceneStructureOps;
}

/** TemplateService.importSceneTemplate 결과 중 기록에 쓰는 부분(SceneTemplateImportResult 와 같은 모양) */
export interface SceneTemplateImportLike {
  template: string;
  added: readonly GenericScene[];
  trashed: readonly { scene: GenericScene; info: TrashedSceneInfo }[];
}

/**
 * 씬 템플릿에서 씬 불러오기를 1항목으로 기록 — 서비스가 끝난 뒤(잠금 밖) 호출부가 부른다.
 * 실제로 세션에 들어 있는 씬·실제로 세션에서 빠진 기존 씬만 담는다. 아무것도 없으면 기록하지 않는다(false).
 */
export function recordSceneTemplateImport(
  session: Session | undefined,
  result: SceneTemplateImportLike | null | undefined,
  opts: SceneImportUndoOptions = {},
): boolean {
  const service = opts.service ?? undoService;
  if (!session || !result || !service.canRecord(session)) return false;
  const trashed = result.trashed.filter((t) => !sceneInSession(session, t.scene));
  const added = result.added.filter((s) => sceneInSession(session, s));
  if (trashed.length === 0 && added.length === 0) return false;
  flushSceneFieldEdit();
  const label = UNDO_TEXT.sceneTemplateImport(result.template, added.length);
  const g = service.beginGroup(session, label);
  // 순서 = 실제 일 순서(기존 씬 휴지통 → 새 씬 등록). 되돌림은 역순이라 새 씬이 먼저 빠져 원래 이름이 비어 있다.
  for (const t of trashed) g.add(sceneDeletedEntry(session, t.scene, t.info, label, { ops: opts.ops }));
  for (const s of added) g.add(sceneRestoredEntry(session, s, label, { ops: opts.ops }));
  return g.commit();
}

/** 「현재 프로젝트에 씬만 불러오기」가 같은 이름 씬에서 바꾸는 필드(AppService — 동작 불변) */
export const PROJECT_SCENE_IMPORT_KEYS: readonly SceneFieldKey[] = ['slots', 'resolution'];

/**
 * 「현재 프로젝트에 씬만 불러오기」 — apply 가 overwritten 씬의 PROJECT_SCENE_IMPORT_KEYS 를 바꾸고 새 씬을 세션에 넣은 뒤
 * 새 씬 목록을 돌려준다. 덮어쓰기 + 새 씬 = 1항목(묶음 — 되돌림 역순). 기록할 수 없으면(미러·실행 중) apply 만.
 */
export function importProjectScenesRecorded(
  session: Session,
  overwritten: readonly GenericScene[],
  apply: () => GenericScene[],
  opts: SceneImportUndoOptions = {},
): GenericScene[] {
  const service = opts.service ?? undoService;
  if (!service.canRecord(session)) return apply();
  flushSceneFieldEdit();
  const g = service.beginGroup(session, UNDO_TEXT.sceneImportToProject(0));
  let created: GenericScene[] = [];
  try {
    editScenesFields(
      session,
      overwritten,
      PROJECT_SCENE_IMPORT_KEYS,
      UNDO_TEXT.sceneImportToProject(overwritten.length),
      () => {
        created = apply();
      },
      { service },
    );
    recordScenesCreated(session, created, UNDO_TEXT.sceneAdd(created.map((s) => s.name)), {
      service,
      ops: opts.ops,
    });
  } finally {
    g.setLabel(UNDO_TEXT.sceneImportToProject(overwritten.length + created.length));
    g.commit();
  }
  return created;
}
