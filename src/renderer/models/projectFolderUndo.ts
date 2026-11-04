// 프로젝트·폴더 상태 작업의 되돌리기 계측(2026-11-03 되돌리기 2차 묶음 2 = P1-a, SPEC_GUIDE 「되돌리기 계약」 「2차 P1-a」,
// jest undoProjectFolder.test.ts).
//
// · 대상: 프로젝트 즐겨찾기·폴더 색·폴더 순서·프로젝트 폴더 이동·폴더 이름 변경/이동·폴더 만들기. 모두 프로젝트 밖 사이드카
//   (favorites.json·folderColors.json·folderOrder.json·프로젝트 meta.folder/구 배치 파일 위치)라 **전역 스택**(GLOBAL_UNDO_SCOPE)에 쌓는다
//   — 프로젝트 전환과 무관, 미러 창이어도 기록한다(사이드카 저장은 미러와 무관).
// · 헬퍼 이름은 서비스 메서드와 1:1(…Recorded) — 호출부는 sessionService.X(...) 를 X Recorded(...) 로 바꾸기만 한다.
//   서비스 호출이 **끝난 뒤** 실제로 바뀐 것만 기록한다(같은 값·다른 창 잠금으로 조용히 돌아온 이동은 기록 없음).
// · 역연산은 전부 기존 sessionService 공개 메서드(setFavorite·setFolderColor·setFolderOrder·moveToFolder·renameFolder·
//   createFolder·deleteFolder) — 관문(다른 창 잠금·구 배치 잠금·사이드카 저장·다른 창 알림)을 그대로 지난다.
//   이 모듈은 잠금을 쓰지 않고 파일을 직접 쓰지 않는다.
// · 실행 직전 현재 값을 다시 읽어(다른 창 변경은 'session-meta' 알림으로 이 창 메모리에 들어온다) 기록 결과와 다르면 실행하지 않고
//   그 항목만 버린다(D15). 전역 항목에는 D16 확인 창을 쓰지 않는다.
// · 저장 차단 상태(부팅 때 사이드카 읽기 실패 — SessionService.metaSaveBlocked)에서도 기록한다: 순방향도 메모리만 바뀌고 저장은
//   건너뛰므로, 되돌림이 같은 메서드로 메모리만 되돌리는 것이 일관된다(파일 보호는 서비스 관문이 계속 담당).
// · 서비스는 models/index.ts 가 configureProjectFolderUndo 로 넣는다(순환 import 회피 — 테스트는 ops 를 직접 넘긴다).
import {
  GLOBAL_UNDO_SCOPE,
  undoService,
  UNDO_TEXT,
  UndoOutcome,
  UndoService,
  UndoSnapshotAdapter,
} from './undoService';

/** 이 모듈이 부르는 공개 서비스 메서드(각자 관문을 지킨다) */
export interface ProjectFolderOps {
  listProjects(): string[];
  listFolders(): string[];
  isFavorite(name: string): boolean;
  setFavorite(name: string, on: boolean): Promise<void>;
  getFolderColor(folder: string): string | undefined;
  setFolderColor(folder: string, color: string | null): Promise<void>;
  /** 보이는 폴더 순서(저장 순서 + 빠진 폴더 자연 정렬) */
  getOrderedFolders(): string[];
  setFolderOrder(order: string[]): Promise<void>;
  getFolderOf(name: string): string | null;
  /** 다른 창에서 열린 프로젝트면 조용히 반환(호출 뒤 폴더로 확인) */
  moveToFolder(name: string, folder: string | null): Promise<void>;
  renameFolder(from: string, to: string): Promise<void>;
  createFolder(folder: string): Promise<void>;
  deleteFolder(folder: string): Promise<void>;
  /** 폴더와 그 하위에 속한 프로젝트 */
  getProjectsInFolder(folder: string): string[];
  /**
   * 폴더 기본 템플릿 지정이 있는가 — 있으면 폴더 만들기 되돌림(폴더 삭제)이 지정·폴더 전용 템플릿까지 지우므로 막는다.
   * 지정 저장소가 지연 로드라 비동기(실행 중 삭제 직전에 확인).
   */
  hasFolderTemplate(folder: string): Promise<boolean>;
}

let configuredOps: ProjectFolderOps | undefined;

export function configureProjectFolderUndo(ops: ProjectFolderOps): void {
  configuredOps = ops;
}

export interface ProjectFolderUndoOptions {
  service?: UndoService;
  ops?: ProjectFolderOps;
}

function resolve(opts: ProjectFolderUndoOptions): { service: UndoService; ops: ProjectFolderOps } {
  const ops = opts.ops ?? configuredOps;
  if (!ops) throw new Error('프로젝트·폴더 되돌리기가 준비되지 않았습니다');
  return { service: opts.service ?? undoService, ops };
}

const folderText = (folder: string | null) => folder ?? UNDO_TEXT.unfiled;

/** 폴더 경로의 마지막 마디(같은 이름 프로젝트 검사용 — SessionService 규칙과 같다) */
const leafOf = (folder: string) => folder.slice(folder.lastIndexOf('/') + 1);

// ── 프로젝트 즐겨찾기 ──────────────────────────────────────────────────────

/**
 * sessionService.toggleFavorite 대신 — 절대값(켬/끔)으로 기록. 되돌림 = 반대 값, 다시 실행 = 이 값.
 * 실행 직전 즐겨찾기가 기대값이 아니면(다른 창에서 바뀜) 폐기.
 */
export async function toggleFavoriteRecorded(
  name: string,
  opts: ProjectFolderUndoOptions = {},
): Promise<void> {
  const { service, ops } = resolve(opts);
  const on = !ops.isFavorite(name);
  await ops.setFavorite(name, on);
  if (ops.isFavorite(name) !== on) return;
  service.record(GLOBAL_UNDO_SCOPE, {
    label: on ? UNDO_TEXT.projectFavoriteOn(name) : UNDO_TEXT.projectFavoriteOff(name),
    verify: (dir) => {
      if (!ops.listProjects().includes(name)) return UNDO_TEXT.projectGone(name);
      // 되돌림 = 지금 on 이어야, 다시 실행 = 지금 !on 이어야
      const expected = dir === 'undo' ? on : !on;
      return ops.isFavorite(name) === expected ? true : UNDO_TEXT.projectFavoriteChanged(name);
    },
    undo: () => ops.setFavorite(name, !on),
    redo: () => ops.setFavorite(name, on),
  });
}

// ── 폴더 색 ────────────────────────────────────────────────────────────────

/**
 * sessionService.setFolderColor 대신 — 같은 폴더를 1초 안에 또 바꾸면 한 항목(드로어·브라우저 사용자 지정 색의 200ms 디바운스
 * 연속 입력, D12). 합친 결과가 처음 색이면 항목 삭제. 실패(throw)는 기록 없이 그대로 던진다.
 */
export async function setFolderColorRecorded(
  folder: string,
  color: string | null,
  opts: ProjectFolderUndoOptions = {},
): Promise<void> {
  const { service, ops } = resolve(opts);
  const adapter: UndoSnapshotAdapter<string | null> = {
    snapshot: () => ops.getFolderColor(folder) ?? null,
    restore: (c) => ops.setFolderColor(folder, c),
    equals: (a, b) => a === b,
    verify: () => (ops.listFolders().includes(folder) ? true : UNDO_TEXT.folderGone(folder)),
    staleReason: UNDO_TEXT.folderColorChanged(folder),
  };
  const pending = service.track(GLOBAL_UNDO_SCOPE, UNDO_TEXT.folderColor(folder), adapter, {
    key: `folderColor:${folder}`,
  });
  try {
    await ops.setFolderColor(folder, color);
  } catch (e) {
    pending.cancel();
    throw e;
  }
  pending.commit();
}

// ── 폴더 순서 ──────────────────────────────────────────────────────────────

/**
 * sessionService.setFolderOrder 대신 — 이전/이후 = 보이는 순서(getOrderedFolders — 서비스가 보정한 결과), 1초 병합.
 * 되돌림 = setFolderOrder(이전 순서). 실행 직전 보이는 순서가 기록 결과와 다르면(폴더가 생기거나 다른 창이 바꿈) 폐기.
 */
export async function setFolderOrderRecorded(
  order: string[],
  opts: ProjectFolderUndoOptions = {},
): Promise<void> {
  const { service, ops } = resolve(opts);
  const adapter: UndoSnapshotAdapter<string[]> = {
    snapshot: () => ops.getOrderedFolders().slice(),
    restore: (o) => ops.setFolderOrder(o.slice()),
    equals: (a, b) => a.length === b.length && a.every((f, i) => f === b[i]),
    staleReason: UNDO_TEXT.folderOrderChanged,
  };
  const pending = service.track(GLOBAL_UNDO_SCOPE, UNDO_TEXT.folderOrder, adapter, { key: 'folderOrder' });
  try {
    await ops.setFolderOrder(order);
  } catch (e) {
    pending.cancel();
    throw e;
  }
  pending.commit();
}

// ── 프로젝트 폴더 이동 ─────────────────────────────────────────────────────

interface ProjectMove {
  name: string;
  from: string | null;
  to: string | null;
}

function recordMoves(service: UndoService, ops: ProjectFolderOps, moves: ProjectMove[], target: string | null) {
  if (moves.length === 0) return;
  const label = UNDO_TEXT.projectMove(
    moves.map((m) => m.name),
    folderText(target),
  );
  // 되돌림 = 역순으로 원래 폴더, 다시 실행 = 정순으로 대상 폴더. 실패한 프로젝트만 항목에서 빠진다(D15 — 나머지는 유지)
  const apply = async (dir: 'undo' | 'redo'): Promise<UndoOutcome> => {
    const order = dir === 'undo' ? [...moves].reverse() : [...moves];
    const total = order.length;
    let failed = 0;
    let firstError: string | undefined;
    const drop = (m: ProjectMove, reason: string) => {
      failed++;
      firstError ??= reason;
      const i = moves.indexOf(m);
      if (i >= 0) moves.splice(i, 1);
    };
    for (const m of order) {
      const expected = dir === 'undo' ? m.to : m.from;
      const dest = dir === 'undo' ? m.from : m.to;
      if (!ops.listProjects().includes(m.name)) {
        drop(m, UNDO_TEXT.projectGone(m.name));
        continue;
      }
      if (ops.getFolderOf(m.name) !== expected) {
        drop(m, UNDO_TEXT.projectFolderChanged(m.name));
        continue;
      }
      if (dest !== null && !ops.listFolders().includes(dest)) {
        drop(m, UNDO_TEXT.folderGone(dest));
        continue;
      }
      try {
        await ops.moveToFolder(m.name, dest);
      } catch (e) {
        drop(m, e instanceof Error && e.message ? e.message : UNDO_TEXT.unknownError);
        continue;
      }
      // 다른 창에서 열린 프로젝트는 서비스가 조용히 돌아온다 — 결과로 판정
      if (ops.getFolderOf(m.name) !== dest) drop(m, UNDO_TEXT.projectMoveBlocked(m.name));
    }
    return { total, failed, firstError };
  };
  service.record(GLOBAL_UNDO_SCOPE, {
    label,
    kind: 'file',
    undo: () => apply('undo'),
    redo: () => apply('redo'),
  });
}

/**
 * sessionService.moveToFolder 대신(프로젝트 하나 — 드래그·이동 대화상자). 실제로 옮겨졌을 때만 기록(같은 폴더·다른 창 잠금으로
 * 조용히 돌아온 경우 제외). 서비스 오류는 기록 없이 그대로 던진다.
 */
export async function moveToFolderRecorded(
  name: string,
  folder: string | null,
  opts: ProjectFolderUndoOptions = {},
): Promise<void> {
  const { service, ops } = resolve(opts);
  const from = ops.getFolderOf(name);
  await ops.moveToFolder(name, folder);
  if (from !== folder && ops.getFolderOf(name) === folder) {
    recordMoves(service, ops, [{ name, from, to: folder }], folder);
  }
}

/**
 * 선택한 여러 프로젝트를 한 폴더로(일괄 이동) — 한 동작 = 한 항목(실제로 옮겨진 것만), 되돌림 역순.
 * 종전 호출부처럼 프로젝트별 오류는 삼키고 다음 프로젝트를 계속한다. 옮겨진 수를 돌려준다.
 */
export async function moveProjectsToFolderRecorded(
  names: Iterable<string>,
  folder: string | null,
  opts: ProjectFolderUndoOptions = {},
): Promise<number> {
  const { service, ops } = resolve(opts);
  const moves: ProjectMove[] = [];
  for (const name of names) {
    const from = ops.getFolderOf(name);
    try {
      await ops.moveToFolder(name, folder);
    } catch (e) {
      continue;
    }
    if (from !== folder && ops.getFolderOf(name) === folder) moves.push({ name, from, to: folder });
  }
  recordMoves(service, ops, moves, folder);
  return moves.length;
}

// ── 폴더 이름 변경·이동 ────────────────────────────────────────────────────

/**
 * sessionService.renameFolder 대신 — 되돌림 = renameFolder(새, 옛), 다시 실행 = renameFolder(옛, 새)(하위 폴더·소속 프로젝트·
 * 색·순서·폴더 템플릿 키를 서비스가 함께 옮긴다). move = 폴더 드래그 이동(라벨만 다름). 서비스 오류는 기록 없이 던진다.
 * verify: 옮길 폴더가 있고 목표 이름이 비어 있어야(폴더·같은 이름 프로젝트 없음). 구 배치는 파일 이동을 동반하므로 실패 = 폐기.
 */
export async function renameFolderRecorded(
  from: string,
  to: string,
  opts: ProjectFolderUndoOptions & { move?: boolean } = {},
): Promise<void> {
  const { service, ops } = resolve(opts);
  const target = to.trim();
  await ops.renameFolder(from, to);
  const folders = ops.listFolders();
  if (from === target || !folders.includes(target) || folders.includes(from)) return;
  const text = opts.move ? UNDO_TEXT.folderMove : UNDO_TEXT.folderRename;
  const step = async (src: string, dst: string) => {
    await ops.renameFolder(src, dst);
    if (!ops.listFolders().includes(dst)) throw new Error(UNDO_TEXT.folderGone(dst));
  };
  service.record(GLOBAL_UNDO_SCOPE, {
    label: text(from, target),
    undoLabel: text(target, from),
    kind: 'file',
    verify: (dir) => {
      const [src, dst] = dir === 'undo' ? [target, from] : [from, target];
      const list = ops.listFolders();
      if (!list.includes(src)) return UNDO_TEXT.folderGone(src);
      if (list.includes(dst) || ops.listProjects().includes(leafOf(dst))) return UNDO_TEXT.folderNameTaken(dst);
      return true;
    },
    undo: () => step(target, from),
    redo: () => step(from, target),
  });
}

/**
 * 여러 폴더 작업을 한 항목으로(폴더 드래그 이동 = renameFolder + setFolderOrder). 되돌림 역순·다시 실행 정순.
 */
export function groupProjectFolderOps<R>(
  label: string,
  fn: () => Promise<R>,
  opts: ProjectFolderUndoOptions = {},
): Promise<R> {
  const service = opts.service ?? undoService;
  return service.group(GLOBAL_UNDO_SCOPE, label, fn);
}

// ── 폴더 만들기 ────────────────────────────────────────────────────────────

/** 깊은 폴더부터(삭제 순서) */
const deepestFirst = (folders: string[]) =>
  [...folders].sort((a, b) => b.split('/').length - a.split('/').length || b.localeCompare(a));

/**
 * sessionService.createFolder 대신 — 함께 새로 생긴 조상 폴더(생성 전후 폴더 목록 차이)까지 한 항목.
 * 되돌림 = 그 폴더들이 **비어 있을 때만**(프로젝트·이 항목 밖 하위 폴더·폴더 기본 템플릿 없음) 깊은 것부터 deleteFolder,
 * 하나라도 걸리면 실행하지 않고 폐기(D15). 다시 실행 = createFolder(경로)(새로 생긴 폴더 목록을 다시 계산).
 */
export async function createFolderRecorded(folder: string, opts: ProjectFolderUndoOptions = {}): Promise<void> {
  const { service, ops } = resolve(opts);
  const path = folder.trim();
  const createAndDiff = async (): Promise<string[]> => {
    const before = new Set(ops.listFolders());
    await ops.createFolder(path);
    return deepestFirst(ops.listFolders().filter((f) => !before.has(f)));
  };
  let created = await createAndDiff();
  if (created.length === 0) return;
  service.record(GLOBAL_UNDO_SCOPE, {
    label: UNDO_TEXT.folderCreate(path),
    kind: 'file',
    verify: (dir) => {
      const list = ops.listFolders();
      if (dir === 'redo') {
        if (list.includes(path) || ops.listProjects().includes(leafOf(path))) return UNDO_TEXT.folderNameTaken(path);
        return true;
      }
      const mine = new Set(created);
      for (const f of created) {
        if (!list.includes(f)) return UNDO_TEXT.folderGone(f);
        if (ops.getProjectsInFolder(f).length > 0) return UNDO_TEXT.folderNotEmpty(f);
        if (list.some((x) => x.startsWith(f + '/') && !mine.has(x))) return UNDO_TEXT.folderNotEmpty(f);
      }
      return true;
    },
    undo: async () => {
      // 템플릿 지정은 지연 로드라 여기서(삭제 전에 전부) 확인 — 하나라도 있으면 아무것도 지우지 않고 실패(폐기)
      for (const f of created) {
        if (await ops.hasFolderTemplate(f)) throw new Error(UNDO_TEXT.folderHasTemplate(f));
      }
      for (const f of created) await ops.deleteFolder(f);
    },
    redo: async () => {
      created = await createAndDiff();
    },
  });
}
