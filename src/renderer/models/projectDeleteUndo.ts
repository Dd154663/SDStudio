// 프로젝트·폴더 삭제류의 되돌리기 계측(2026-11-04 되돌리기 2차 묶음 3 = P1-b, SPEC_GUIDE 「되돌리기 계약」 「2차 P1-b」,
// jest undoProjectDelete.test.ts). 사용자 결정 D7 ① = 폴더 전용 로컬 템플릿 스냅숏 복원, D8 ① = 되돌린 프로젝트 자동 열기 안 함.
//
// · 대상: 프로젝트 삭제(휴지통 이동) ↔ 휴지통 복원 짝, 휴지통 목록의 수동 복원, 폴더 삭제(폴더만 — 프로젝트는 상위 폴더로),
//   폴더+프로젝트 삭제(흐름 전체 한 항목). 영구 삭제·만료 미루기·백업 복원·가져오기 덮어쓰기는 기록하지 않는다.
// · 모두 프로젝트 밖(휴지통·사이드카·폴더 목록)이라 **전역 스택**(GLOBAL_UNDO_SCOPE)에 쌓는다.
// · 역연산은 기존 관문만 부른다 — 삭제 = projectDeleteFlow.runProjectTrashDelete(현재 프로젝트면 닫음),
//   복원 = SessionService.restoreProjectFromTrash(사이드카 재적용), 폴더 = SessionService.createFolder·deleteFolder·moveToFolder·
//   setFolderColor·setFolderOrder, 템플릿 = TemplateService.snapshotFolderTemplates·restoreFolderTemplates.
//   이 모듈은 잠금을 쓰지 않고 파일을 직접 쓰지 않는다(specGuard UNDO_MODULES).
// · 되돌려 살린 프로젝트는 열지 않는다(D8). 다시 실행(삭제)이 현재 프로젝트를 닫는 것은 삭제 관문의 기존 규칙.
// · 실패 = 그 항목 폐기·토스트(D15). 같은 이름 활성 프로젝트·휴지통에 없음·다른 창 잠금이 대표 이유. D16 확인 창은 없다.
// · 서비스는 models/index.ts 가 configureProjectDeleteUndo 로 넣는다(순환 import 회피 — 테스트는 ops 를 직접 넘긴다).
import { GLOBAL_UNDO_SCOPE, undoService, UNDO_TEXT, UndoOutcome, UndoService } from './undoService';
import type { ProjectDeleteOutcome } from './projectDeleteFlow';
import type { FolderDeleteResult } from './folderDeleteFlow';
import type { FolderTemplateSnapshot } from './TemplateService';

/** 복원 결과(SessionService.ProjectRestoreOutcome 과 같은 모양 — 순환 import 를 피하려 필요한 필드만) */
export interface ProjectRestoreResult {
  name: string;
  dir?: string;
  sidecarRestored: boolean;
  sidecarFailed: readonly string[];
}

/** 이 모듈이 부르는 공개 서비스 메서드(각자 관문을 지킨다) */
export interface ProjectDeleteUndoOps {
  listProjects(): string[];
  listFolders(): string[];
  getFolderOf(name: string): string | null;
  /** 신 배치 물리 폴더(동명 휴지통 구분). 구 배치는 undefined */
  physicalDirOf(name: string): string | undefined;
  /** 휴지통 프로젝트 목록(trashService.getDeletedProjects) */
  getDeletedProjects(): Promise<{ name: string; dir?: string }[]>;
  /** 휴지통 이동 관문(projectDeleteFlow.runProjectTrashDelete — 현재 프로젝트면 닫음) */
  deleteProject(name: string): Promise<ProjectDeleteOutcome>;
  /** 휴지통 복원 관문(sessionService.restoreProjectFromTrash — 사이드카 재적용·목록 갱신, 열지 않음) */
  restoreFromTrash(name: string, opts: { dir?: string; newName?: string }): Promise<ProjectRestoreResult>;
  /** 다른 창에서 열린 프로젝트면 조용히 반환(호출 뒤 폴더로 확인) */
  moveToFolder(name: string, folder: string | null): Promise<void>;
  createFolder(folder: string): Promise<void>;
  deleteFolder(folder: string): Promise<void>;
  /** 「폴더만 삭제」 때 프로젝트가 갈 폴더(상위 폴더, 없으면 null = 미분류) */
  folderDeleteTarget(folder: string): string | null;
  getFolderColor(folder: string): string | undefined;
  setFolderColor(folder: string, color: string | null): Promise<void>;
  getOrderedFolders(): string[];
  setFolderOrder(order: string[]): Promise<void>;
  /** 폴더와 그 하위에 속한 프로젝트 */
  getProjectsInFolder(folder: string): string[];
  /** 폴더·하위 폴더의 기본 템플릿 지정 + 폴더 전용 로컬 템플릿(이미지 포함) + 적용 기록 스냅숏 */
  snapshotFolderTemplates(folder: string): Promise<FolderTemplateSnapshot>;
  restoreFolderTemplates(snap: FolderTemplateSnapshot): Promise<{ failed: number }>;
}

let configuredOps: ProjectDeleteUndoOps | undefined;

export function configureProjectDeleteUndo(ops: ProjectDeleteUndoOps): void {
  configuredOps = ops;
}

export interface ProjectDeleteUndoOptions {
  service?: UndoService;
  ops?: ProjectDeleteUndoOps;
}

function resolve(opts: ProjectDeleteUndoOptions): { service: UndoService; ops: ProjectDeleteUndoOps } {
  const ops = opts.ops ?? configuredOps;
  if (!ops) throw new Error('프로젝트 삭제 되돌리기가 준비되지 않았습니다');
  return { service: opts.service ?? undoService, ops };
}

const folderText = (folder: string | null) => folder ?? UNDO_TEXT.unfiled;
const leafOf = (folder: string) => folder.slice(folder.lastIndexOf('/') + 1);
const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : UNDO_TEXT.unknownError);

/** 실패·안내를 모아 UndoOutcome 으로 — 안내가 있으면 부분 실패 문구 대신 「(…)」로 붙는다 */
class OutcomeBuilder {
  total = 0;
  failed = 0;
  firstError: string | undefined;
  notices: string[] = [];
  fail(reason: string) {
    this.failed++;
    this.firstError ??= reason;
  }
  build(): UndoOutcome | undefined {
    if (this.total === 0) return undefined;
    const parts: string[] = [];
    if (this.failed > 0 && this.failed < this.total) {
      parts.push(`${this.total}개 중 ${this.failed}개는 처리하지 못했습니다: ${this.firstError ?? UNDO_TEXT.unknownError}`);
    }
    parts.push(...this.notices);
    return {
      total: this.total,
      failed: this.failed,
      firstError: this.firstError,
      notice: parts.length > 0 ? parts.join(' / ') : undefined,
    };
  }
}

// ── 공용: 휴지통 이동·복원 ─────────────────────────────────────────────────

/** 휴지통으로 — 목록에서 사라졌으면 성공(부가 정리 예외는 성공으로 본다), 남아 있으면 이유로 throw */
async function deleteOrThrow(ops: ProjectDeleteUndoOps, name: string): Promise<void> {
  const outcome = await ops.deleteProject(name);
  if (!ops.listProjects().includes(name)) return;
  throw new Error(outcome.kind === 'error' && outcome.message ? outcome.message : UNDO_TEXT.projectDeleteBlocked(name));
}

function inTrash(trashed: readonly { name: string; dir?: string }[], name: string, dir: string | undefined): boolean {
  return trashed.some((t) => t.name === name && (dir === undefined || t.dir === dir));
}

/**
 * 휴지통에서 살린다(열지 않음 — D8). folder = 삭제 전 소속(복원 위치 안내용 — 신 배치는 meta.folder, 구 배치는 .deleted 위치로
 * 돌아간다. 폴더가 그사이 사라졌으면 다른 곳에 복원되므로 안내). trashed = 미리 읽은 휴지통 목록(없으면 여기서 읽는다).
 */
async function restoreOrThrow(
  ops: ProjectDeleteUndoOps,
  name: string,
  dir: string | undefined,
  folder: string | null,
  out: OutcomeBuilder,
  trashed?: readonly { name: string; dir?: string }[],
): Promise<ProjectRestoreResult> {
  if (ops.listProjects().includes(name)) throw new Error(UNDO_TEXT.projectNameActive(name));
  const list = trashed ?? (await ops.getDeletedProjects());
  if (!inTrash(list, name, dir)) throw new Error(UNDO_TEXT.projectNotInTrash(name));
  const r = await ops.restoreFromTrash(name, { dir });
  if (r.sidecarFailed.length > 0) out.notices.push(UNDO_TEXT.projectSidecarNotRestored(r.name));
  const now = ops.getFolderOf(r.name);
  if (folder !== null && now !== folder) out.notices.push(UNDO_TEXT.projectRestoredElsewhere(r.name, folderText(now)));
  return r;
}

// ── P1-b-1 프로젝트 삭제 ↔ 휴지통 복원 ────────────────────────────────────

/**
 * projectDeleteFlow.runProjectTrashDelete 대신(드로어·툴바·씬 템플릿 관리자). 실제로 목록에서 사라졌을 때만 기록.
 * 되돌림 = 휴지통 복원(같은 물리 폴더 — 신 배치 동명 구분, 열지 않음), 다시 실행 = 다시 휴지통으로(현재 프로젝트면 닫힘).
 * 폴더+프로젝트 흐름(deleteProjectForFolderFlow)은 아래 deleteFolderWithProjectsRecorded 가 묶어 기록하므로 이것을 쓰지 않는다.
 */
export async function deleteProjectRecorded(
  name: string,
  opts: ProjectDeleteUndoOptions & { sceneTemplate?: boolean } = {},
): Promise<ProjectDeleteOutcome> {
  const { service, ops } = resolve(opts);
  let folder = ops.getFolderOf(name);
  let dir = ops.physicalDirOf(name);
  const outcome = await ops.deleteProject(name);
  if (ops.listProjects().includes(name)) return outcome;
  service.record(GLOBAL_UNDO_SCOPE, {
    label: opts.sceneTemplate ? UNDO_TEXT.sceneTemplateDelete(name) : UNDO_TEXT.projectDelete(name),
    kind: 'file',
    verify: (d) => {
      const active = ops.listProjects().includes(name);
      if (d === 'undo') return active ? UNDO_TEXT.projectNameActive(name) : true;
      return active ? true : UNDO_TEXT.projectGone(name);
    },
    undo: async () => {
      const out = new OutcomeBuilder();
      out.total = 1;
      await restoreOrThrow(ops, name, dir, folder, out);
      return out.build();
    },
    redo: async () => {
      folder = ops.getFolderOf(name);
      dir = ops.physicalDirOf(name);
      await deleteOrThrow(ops, name);
    },
  });
  return outcome;
}

/**
 * 휴지통 목록의 수동 복원(SessionSelect) — sessionService.restoreProjectFromTrash 대신. 실패(throw)는 기록 없이 그대로 던진다.
 * 되돌림 = 최종 이름(새 이름 복원이면 새 이름)을 다시 휴지통으로, 다시 실행 = 그 이름·물리 폴더로 복원(열지 않음).
 */
export async function restoreProjectRecorded(
  name: string,
  restoreOpts: { dir?: string; newName?: string },
  opts: ProjectDeleteUndoOptions = {},
): Promise<ProjectRestoreResult> {
  const { service, ops } = resolve(opts);
  const r = await ops.restoreFromTrash(name, restoreOpts);
  const finalName = r.name;
  let dir = r.dir ?? ops.physicalDirOf(finalName);
  let folder = ops.getFolderOf(finalName);
  service.record(GLOBAL_UNDO_SCOPE, {
    label: UNDO_TEXT.projectTrashRestore(finalName),
    kind: 'file',
    verify: (d) => {
      const active = ops.listProjects().includes(finalName);
      if (d === 'undo') return active ? true : UNDO_TEXT.projectGone(finalName);
      return active ? UNDO_TEXT.projectNameActive(finalName) : true;
    },
    undo: async () => {
      folder = ops.getFolderOf(finalName);
      dir = ops.physicalDirOf(finalName) ?? dir;
      await deleteOrThrow(ops, finalName);
    },
    redo: async () => {
      const out = new OutcomeBuilder();
      out.total = 1;
      await restoreOrThrow(ops, finalName, dir, folder, out);
      return out.build();
    },
  });
  return r;
}

// ── 폴더 트리 스냅숏(P1-b-2·P1-b-3 공용) ──────────────────────────────────

interface FolderMember {
  name: string;
  /** 삭제 전 소속 폴더 */
  folder: string | null;
  /** 신 배치 물리 폴더(휴지통 동명 구분) */
  dir?: string;
}

interface FolderTreeSnapshot {
  root: string;
  /** root 와 하위 폴더 — 얕은 것부터(재생성 순서) */
  folders: string[];
  colors: Record<string, string>;
  /** 삭제 전 보이는 폴더 순서 전체 */
  order: string[];
  members: FolderMember[];
  templates: FolderTemplateSnapshot;
}

const inTree = (f: string, root: string) => f === root || f.startsWith(root + '/');

async function captureTree(ops: ProjectDeleteUndoOps, root: string): Promise<FolderTreeSnapshot> {
  const folders = ops
    .listFolders()
    .filter((f) => inTree(f, root))
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  const colors: Record<string, string> = {};
  for (const f of folders) {
    const c = ops.getFolderColor(f);
    if (c) colors[f] = c;
  }
  const members = ops.getProjectsInFolder(root).map((name) => ({
    name,
    folder: ops.getFolderOf(name),
    dir: ops.physicalDirOf(name),
  }));
  // 템플릿 스냅숏은 지연 로드·이미지 읽기를 동반한다 — 실패해도 삭제는 막지 않는다(지정 없음으로 — 되돌림 때 안내)
  let templates: FolderTemplateSnapshot;
  try {
    templates = await ops.snapshotFolderTemplates(root);
  } catch (e) {
    console.warn('폴더 템플릿 스냅숏 실패(되돌리기에서 템플릿 제외):', root, e);
    templates = { assignments: [], locals: [], applications: [] };
  }
  return { root, folders, colors, order: ops.getOrderedFolders().slice(), members, templates };
}

/** 사라진 폴더를 얕은 것부터 다시 만든다(있는 폴더는 건드리지 않는다). 실패는 throw(항목 폐기 — D15) */
async function recreateFolders(ops: ProjectDeleteUndoOps, snap: FolderTreeSnapshot): Promise<void> {
  for (const f of snap.folders) {
    if (ops.listFolders().includes(f)) continue;
    await ops.createFolder(f);
    if (!ops.listFolders().includes(f)) throw new Error(UNDO_TEXT.folderGone(f));
  }
}

/** 색·순서·템플릿 — 폴더가 다시 생긴 뒤. 템플릿 실패는 안내만 */
async function restoreFolderSidecars(
  ops: ProjectDeleteUndoOps,
  snap: FolderTreeSnapshot,
  out: OutcomeBuilder,
): Promise<void> {
  for (const [f, c] of Object.entries(snap.colors)) {
    if (!ops.listFolders().includes(f) || ops.getFolderColor(f) === c) continue;
    await ops.setFolderColor(f, c);
  }
  const now = ops.getOrderedFolders();
  const same = now.length === snap.order.length && now.every((f, i) => f === snap.order[i]);
  if (!same) await ops.setFolderOrder(snap.order.slice());
  let failed = 0;
  try {
    failed = (await ops.restoreFolderTemplates(snap.templates)).failed;
  } catch (e) {
    console.warn('폴더 템플릿 복원 실패:', snap.root, e);
    failed = snap.templates.assignments.length;
  }
  if (failed > 0) out.notices.push(UNDO_TEXT.folderTemplatesNotRestored(failed));
}

/** 프로젝트를 원래 폴더로 — expectedNow(지금 있어야 할 곳)에 있는 것만 옮긴다. 이미 원래 폴더면 그대로 성공 */
async function moveBack(
  ops: ProjectDeleteUndoOps,
  m: FolderMember,
  expectedNow: string | null,
  out: OutcomeBuilder,
): Promise<void> {
  if (!ops.listProjects().includes(m.name)) return out.fail(UNDO_TEXT.projectGone(m.name));
  const cur = ops.getFolderOf(m.name);
  if (cur === m.folder) return;
  if (cur !== expectedNow) return out.fail(UNDO_TEXT.projectFolderChanged(m.name));
  if (m.folder !== null && !ops.listFolders().includes(m.folder)) return out.fail(UNDO_TEXT.folderGone(m.folder));
  try {
    await ops.moveToFolder(m.name, m.folder);
  } catch (e) {
    return out.fail(errText(e));
  }
  if (ops.getFolderOf(m.name) !== m.folder) out.fail(UNDO_TEXT.projectMoveBlocked(m.name));
}

// ── P1-b-2 폴더 삭제(폴더만) ───────────────────────────────────────────────

/**
 * sessionService.deleteFolder 대신(드로어·브라우저 「폴더만 삭제」·빈 폴더 삭제). 안의 프로젝트는 상위 폴더(루트 폴더면 미분류)로
 * 간다(349669f). 실제로 바뀐 것(폴더가 사라짐·프로젝트가 옮겨짐)이 있으면 기록 — 다른 창 잠금으로 중간에 멈춘 경우(예외)도
 * 옮겨진 프로젝트만큼 기록한 뒤 예외를 그대로 던진다.
 * 되돌림 = 폴더 재생성(상위부터) → 프로젝트 원래 폴더 → 색·순서 → 로컬 템플릿 재생성·지정(D7). 다시 실행 = deleteFolder.
 */
export async function deleteFolderRecorded(folder: string, opts: ProjectDeleteUndoOptions = {}): Promise<void> {
  const { service, ops } = resolve(opts);
  let snap = await captureTree(ops, folder);
  let movedTo = ops.folderDeleteTarget(folder);
  let error: unknown;
  try {
    await ops.deleteFolder(folder);
  } catch (e) {
    error = e;
  }
  const rootGone = !ops.listFolders().includes(folder);
  const moved = snap.members.some((m) => ops.getFolderOf(m.name) !== m.folder);
  if (rootGone || moved) {
    service.record(GLOBAL_UNDO_SCOPE, {
      label: UNDO_TEXT.folderDelete(folder),
      kind: 'file',
      verify: (d) => {
        const list = ops.listFolders();
        if (d === 'redo') return list.includes(folder) ? true : UNDO_TEXT.folderGone(folder);
        if (!list.includes(folder) && ops.listProjects().includes(leafOf(folder))) {
          return UNDO_TEXT.folderNameTaken(folder);
        }
        return true;
      },
      undo: async () => {
        const out = new OutcomeBuilder();
        out.total = snap.members.length + 1;
        await recreateFolders(ops, snap);
        for (const m of snap.members) await moveBack(ops, m, movedTo, out);
        await restoreFolderSidecars(ops, snap, out);
        return out.build();
      },
      redo: async () => {
        snap = await captureTree(ops, folder);
        movedTo = ops.folderDeleteTarget(folder);
        await ops.deleteFolder(folder);
      },
    });
  }
  if (error !== undefined) throw error;
}

// ── P1-b-3 폴더+프로젝트 삭제 ─────────────────────────────────────────────

/**
 * BackupService.deleteFolderWithProjects 의 흐름(runFolderDeleteWithProjects — 프로젝트를 미분류로 옮긴 뒤 휴지통, 전부 지웠으면 폴더 삭제)
 * 전체를 한 항목으로. run = 확인 창 없이 그 흐름을 한 번 실행(진행 창 포함)하는 함수 — 다시 실행도 같은 함수를 부른다.
 * 휴지통으로 가지 못한 프로젝트는 항목에서 빠지고(흐름이 원래 폴더로 되돌려 둔다), 폴더가 안 지워졌으면 폴더 부분도 빠진다.
 * 되돌림(역순) = 폴더 재생성 → 프로젝트 휴지통 복원(열지 않음) → 원래 폴더로 → 색·순서·템플릿.
 */
export async function deleteFolderWithProjectsRecorded(
  folder: string,
  run: () => Promise<FolderDeleteResult>,
  opts: ProjectDeleteUndoOptions = {},
): Promise<FolderDeleteResult> {
  const { service, ops } = resolve(opts);
  let snap = await captureTree(ops, folder);
  const result = await run();
  const pick = (s: FolderTreeSnapshot, r: FolderDeleteResult) => ({
    projects: s.members.filter((m) => r.deleted.includes(m.name)),
    folderDeleted: r.folderDeleted,
  });
  let state = pick(snap, result);
  if (state.projects.length === 0 && !state.folderDeleted) return result;
  service.record(GLOBAL_UNDO_SCOPE, {
    label: UNDO_TEXT.folderDeleteWithProjects(folder, state.projects.length),
    kind: 'file',
    verify: (d) => {
      const list = ops.listFolders();
      if (d === 'redo') return list.includes(folder) ? true : UNDO_TEXT.folderGone(folder);
      if (state.folderDeleted && (list.includes(folder) || ops.listProjects().includes(leafOf(folder)))) {
        return UNDO_TEXT.folderNameTaken(folder);
      }
      return true;
    },
    undo: async () => {
      const out = new OutcomeBuilder();
      out.total = state.projects.length + (state.folderDeleted ? 1 : 0);
      if (state.folderDeleted) await recreateFolders(ops, snap);
      const trashed = await ops.getDeletedProjects();
      for (const m of [...state.projects].reverse()) {
        let restored: ProjectRestoreResult;
        try {
          // 흐름이 미분류로 옮긴 뒤 지웠으므로 원래 폴더 안내는 여기서 하지 않는다(아래에서 원래 폴더로 옮긴다)
          restored = await restoreOrThrow(ops, m.name, m.dir, null, out, trashed);
        } catch (e) {
          out.fail(errText(e));
          continue;
        }
        if (m.folder === null) continue;
        const cur = ops.getFolderOf(restored.name);
        if (cur === m.folder) continue;
        if (ops.listFolders().includes(m.folder)) {
          try {
            await ops.moveToFolder(restored.name, m.folder);
          } catch (e) {
            // 아래 확인에서 안내
          }
        }
        const now = ops.getFolderOf(restored.name);
        if (now !== m.folder) out.notices.push(UNDO_TEXT.projectRestoredElsewhere(restored.name, folderText(now)));
      }
      if (state.folderDeleted) await restoreFolderSidecars(ops, snap, out);
      return out.build();
    },
    redo: async () => {
      snap = await captureTree(ops, folder);
      const r = await run();
      state = pick(snap, r);
      const total = r.total + 1;
      const failed = r.failed.length + (r.folderDeleted ? 0 : 1);
      const firstError = r.failed[0] ? `${r.failed[0].name}: ${r.failed[0].reason}` : r.folderError;
      return { total, failed: state.projects.length === 0 && !r.folderDeleted ? total : failed, firstError };
    },
  });
  return result;
}
