// 전역 라이브러리의 파일 부작용 없는 작업 되돌리기 계측(2026-11-04 되돌리기 2차 묶음 4 = P5, SPEC_GUIDE 「되돌리기 계약」
// 「2차 P5」, jest undoGlobalLibrary.test.ts).
//
// · 대상: 글로벌 캐릭터 프리셋(이름·순서·폴더 이동·폴더 만들기/이름/삭제), 글로벌 프리셋(이름·기본 지정), 작가 라이브러리(이름·
//   즐겨찾기·대표 썸네일·샘플 모델 계열·태그·태그 프리셋), 내보내기 프리셋(목록 저장 전부 — 추가·저장·삭제·이름·복제),
//   프로젝트 템플릿(이름·배지 색). 모두 프로젝트 밖 저장소라 **전역 스택**(GLOBAL_UNDO_SCOPE)에 쌓는다 — 프로젝트 전환·미러와 무관.
// · 헬퍼 이름은 서비스 메서드와 1:1(…Recorded) — 호출부는 service.X(...) 를 XRecorded(...) 로 바꾸기만 한다.
//   서비스 호출이 **끝난 뒤** 실제로 바뀐 것만 기록한다(같은 값·중복 이름으로 조용히 돌아온 경우 기록 없음). 서비스 오류는 기록 없이 던진다.
// · 역연산은 전부 기존 서비스 공개 메서드(저장 예약·changed 이벤트·다른 창 알림이 따라온다). 이 모듈은 잠금을 쓰지 않고
//   파일을 직접 쓰지 않는다(specGuard UNDO_MODULES).
// · 실행 직전 이 창 메모리의 지금 값(다른 창 저장은 각 서비스의 재로드로 들어온다)을 다시 읽어 기록 결과와 다르면 실행하지 않고
//   그 항목만 버린다(D15). D16 확인 창은 쓰지 않는다(묶음 2 규칙).
// · 기록 안 함(이미지 파일 생성·영구 삭제·불러오기 — SPEC 「2차 P5」): 글로벌 캐릭터 저장·편집 저장·복제·삭제·불러오기, 글로벌 프리셋
//   추가·편집 저장(이름 포함)·삭제·백업, 작가 생성·샘플 추가·삭제·병합·백업, 템플릿 생성·복제·삭제·내용 편집·불러오기·적용·폴더 기본
//   템플릿 지정/해제(엔티티 생성·영구 삭제와 한 동작), 내보내기 프리셋 백업 불러오기.
// · 서비스는 models/index.ts 가 configureGlobalLibraryUndo 로 넣는다(순환 import 회피 — 테스트는 ops 를 직접 넘긴다).
import type { ModelSamplingFamily } from './modelSamplingProfiles';
import {
  GLOBAL_UNDO_SCOPE,
  undoDeepClone,
  undoDeepEqual,
  undoService,
  UNDO_TEXT,
  UndoOutcome,
  UndoService,
  UndoSnapshotAdapter,
} from './undoService';

// ── 서비스 배선 ────────────────────────────────────────────────────────────

export interface GlobalCharacterEntryLike {
  id: string;
  name: string;
  folder?: string;
}

/** GlobalCharacterPresetService 공개 메서드 */
export interface GlobalCharacterOps {
  list(): GlobalCharacterEntryLike[];
  get(id: string): GlobalCharacterEntryLike | undefined;
  getByName(name: string): GlobalCharacterEntryLike | undefined;
  /** 보이는 폴더(레지스트리 + 엔트리에만 있는 파생 폴더) */
  listFolders(): string[];
  /** 폴더 레지스트리(저장되는 순서) */
  registeredFolders(): string[];
  rename(id: string, name: string): Promise<void>;
  reorder(from: number, to: number): void;
  setFolder(id: string, folder: string | null): Promise<void>;
  createFolder(name: string, at?: number): Promise<string>;
  renameFolder(from: string, to: string): Promise<void>;
  deleteFolder(name: string): Promise<void>;
}

export interface GlobalPresetEntryLike {
  id: string;
  name: string;
  workflowType: string;
  isDefault?: boolean;
}

/** GlobalPresetService 공개 메서드 */
export interface GlobalPresetOps {
  get(id: string): GlobalPresetEntryLike | undefined;
  getByName(workflowType: string, name: string): GlobalPresetEntryLike | undefined;
  rename(id: string, name: string): Promise<void>;
  setDefault(id: string, value: boolean): Promise<void>;
}

export interface ArtistEntryLike {
  id: string;
  name: string;
  favorite: boolean;
  images: { id: string; family?: ModelSamplingFamily }[];
  tags: string[];
}

/** ArtistLibraryService 공개 메서드(전부 동기) */
export interface ArtistOps {
  getArtist(id: string): ArtistEntryLike | undefined;
  findArtistByName(name: string, excludeId?: string): ArtistEntryLike | undefined;
  tagPresets(): string[];
  renameArtist(id: string, name: string): void;
  setFavorite(id: string, on: boolean): void;
  setThumbnail(id: string, imageId: string): void;
  setImageOrder(id: string, imageIds: string[]): void;
  setImageFamily(id: string, imageId: string, family: ModelSamplingFamily | undefined): void;
  addTag(id: string, tag: string): void;
  removeTag(id: string, tag: string): void;
  setTags(id: string, tags: string[]): void;
  addTagPreset(tag: string): void;
  removeTagPreset(tag: string): void;
  setTagPresets(tags: string[]): void;
}

/** ExportPresetService(내보내기 프리셋 — 파일 없는 JSON 목록) */
export interface ExportPresetOps<P = unknown> {
  load(): P[];
  save(presets: P[]): void;
}

export interface TemplateEntryLike {
  id: string;
  name: string;
  badgeColor?: string;
}

/** ProjectTemplateService 공개 메서드 */
export interface TemplateOps {
  get(id: string): TemplateEntryLike | undefined;
  getByName(name: string): TemplateEntryLike | undefined;
  rename(id: string, name: string): Promise<void>;
  setBadgeColor(id: string, color: string | null): Promise<void>;
}

export interface GlobalLibraryOps {
  characters: GlobalCharacterOps;
  presets: GlobalPresetOps;
  artists: ArtistOps;
  exportPresets: ExportPresetOps;
  templates: TemplateOps;
}

let configuredOps: GlobalLibraryOps | undefined;

export function configureGlobalLibraryUndo(ops: GlobalLibraryOps): void {
  configuredOps = ops;
}

export interface GlobalLibraryUndoOptions {
  service?: UndoService;
  ops?: Partial<GlobalLibraryOps>;
}

function resolve<K extends keyof GlobalLibraryOps>(
  opts: GlobalLibraryUndoOptions,
  key: K,
): { service: UndoService; ops: GlobalLibraryOps[K] } {
  const ops = (opts.ops?.[key] ?? configuredOps?.[key]) as GlobalLibraryOps[K] | undefined;
  if (!ops) throw new Error('전역 라이브러리 되돌리기가 준비되지 않았습니다');
  return { service: opts.service ?? undoService, ops };
}

const folderText = (folder: string | null | undefined) => folder || UNDO_TEXT.unfiled;
const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

// ── 글로벌 캐릭터 프리셋 ───────────────────────────────────────────────────

/** globalCharacterPresetService.rename 대신 — 되돌림 = rename(옛), 다시 실행 = rename(새). */
export async function renameGlobalCharacterRecorded(
  id: string,
  name: string,
  opts: GlobalLibraryUndoOptions = {},
): Promise<void> {
  const { service, ops } = resolve(opts, 'characters');
  const before = ops.get(id)?.name;
  await ops.rename(id, name);
  const after = ops.get(id)?.name;
  if (before === undefined || after === undefined || before === after) return;
  service.record(GLOBAL_UNDO_SCOPE, {
    label: UNDO_TEXT.globalCharacterRename(before, after),
    undoLabel: UNDO_TEXT.globalCharacterRename(after, before),
    verify: (dir) => {
      const [cur, dst] = dir === 'undo' ? [after, before] : [before, after];
      const e = ops.get(id);
      if (!e) return UNDO_TEXT.globalCharacterGone(cur);
      if (e.name !== cur) return UNDO_TEXT.globalCharacterChanged(e.name);
      const other = ops.getByName(dst);
      if (other && other.id !== id) return UNDO_TEXT.globalCharacterNameTaken(dst);
      return true;
    },
    undo: () => ops.rename(id, before),
    redo: () => ops.rename(id, after),
  });
}

/** 지금 목록을 ids 순서로(reorder 반복 — 서비스 메서드만). 집합이 같다는 것은 verify 가 먼저 확인한다 */
function applyCharacterOrder(ops: GlobalCharacterOps, ids: readonly string[]) {
  for (let i = 0; i < ids.length; i++) {
    const cur = ops.list().map((e) => e.id);
    const j = cur.indexOf(ids[i]);
    if (j >= 0 && j !== i) ops.reorder(j, i);
  }
}

/**
 * globalCharacterPresetService.reorder 대신 — 이전/이후 = 전체 id 순서, 카드 드래그 hover 연속은 1초 병합(한 항목).
 * 되돌림 = 이전 순서로, 실행 직전 지금 순서가 기록 결과와 다르면(추가·삭제·다른 창 변경) 폐기.
 */
export function reorderGlobalCharactersRecorded(
  from: number,
  to: number,
  opts: GlobalLibraryUndoOptions = {},
): void {
  const { service, ops } = resolve(opts, 'characters');
  const adapter: UndoSnapshotAdapter<string[]> = {
    snapshot: () => ops.list().map((e) => e.id),
    restore: (ids) => applyCharacterOrder(ops, ids),
    equals: sameList,
    staleReason: UNDO_TEXT.globalCharacterOrderChanged,
  };
  const pending = service.track(GLOBAL_UNDO_SCOPE, UNDO_TEXT.globalCharacterOrder, adapter, {
    key: 'globalCharacterOrder',
  });
  try {
    ops.reorder(from, to);
  } catch (e) {
    pending.cancel();
    throw e;
  }
  pending.commit();
}

interface CharacterMove {
  id: string;
  name: string;
  from: string | null;
  to: string | null;
}

/** 폴더 이동 묶음 기록 — createdFolder = 이 이동이 레지스트리에 새로 등록한 폴더(setFolder 의 자동 등록) */
function recordCharacterMoves(
  service: UndoService,
  ops: GlobalCharacterOps,
  moves: CharacterMove[],
  target: string | null,
  createdFolder: string | null,
) {
  if (moves.length === 0) return;
  const label = UNDO_TEXT.globalCharacterMove(
    moves.map((m) => m.name),
    folderText(target),
  );
  const apply = async (dir: 'undo' | 'redo'): Promise<UndoOutcome> => {
    const order = dir === 'undo' ? [...moves].reverse() : [...moves];
    const total = order.length;
    let failed = 0;
    let firstError: string | undefined;
    const drop = (m: CharacterMove, reason: string) => {
      failed++;
      firstError ??= reason;
      const i = moves.indexOf(m);
      if (i >= 0) moves.splice(i, 1);
    };
    for (const m of order) {
      const expected = dir === 'undo' ? m.to : m.from;
      const dest = dir === 'undo' ? m.from : m.to;
      const e = ops.get(m.id);
      if (!e) {
        drop(m, UNDO_TEXT.globalCharacterGone(m.name));
        continue;
      }
      if ((e.folder || null) !== expected) {
        drop(m, UNDO_TEXT.globalCharacterChanged(e.name));
        continue;
      }
      // 사라진 폴더로는 되돌리지 않는다(setFolder 가 그 이름으로 폴더를 새로 등록해 버린다) — 다시 실행의 자동 등록 폴더는 예외
      const recreating = dir === 'redo' && dest !== null && dest === createdFolder;
      if (dest !== null && !recreating && !ops.listFolders().includes(dest)) {
        drop(m, UNDO_TEXT.globalCharacterFolderGone(dest));
        continue;
      }
      try {
        await ops.setFolder(m.id, dest);
      } catch (err) {
        drop(m, err instanceof Error && err.message ? err.message : UNDO_TEXT.unknownError);
      }
    }
    // 이 이동이 새로 만든 폴더는 되돌릴 때 비어 있으면 함께 지운다(다시 실행은 setFolder 가 다시 등록)
    if (dir === 'undo' && createdFolder && failed === 0) {
      const used = ops.list().some((x) => x.folder === createdFolder);
      if (!used && ops.registeredFolders().includes(createdFolder)) await ops.deleteFolder(createdFolder);
    }
    return { total, failed, firstError };
  };
  service.record(GLOBAL_UNDO_SCOPE, {
    label,
    undo: () => apply('undo'),
    redo: () => apply('redo'),
  });
}

/**
 * globalCharacterPresetService.setFolder 대신(카드 하나 — 폴더 탭 드롭·이동 대화상자). 실제로 옮겨졌을 때만 기록.
 * 대화상자의 「새 폴더」로 처음 생긴 폴더는 되돌릴 때 비어 있으면 함께 지운다.
 */
export async function setGlobalCharacterFolderRecorded(
  id: string,
  folder: string | null,
  opts: GlobalLibraryUndoOptions = {},
): Promise<void> {
  await setGlobalCharactersFolderRecorded([id], folder, opts);
}

/**
 * 선택한 여러 카드를 한 폴더로(일괄 이동) — 한 동작 = 한 항목(실제로 옮겨진 것만), 되돌림 역순.
 * 종전 호출부처럼 오류가 나면 거기서 멈추고 던진다(그 전까지 옮겨진 것은 기록).
 */
export async function setGlobalCharactersFolderRecorded(
  ids: Iterable<string>,
  folder: string | null,
  opts: GlobalLibraryUndoOptions = {},
): Promise<void> {
  const { service, ops } = resolve(opts, 'characters');
  const target = (folder ?? '').trim() || null;
  const registeredBefore = new Set(ops.registeredFolders());
  const knownBefore = new Set(ops.listFolders());
  const moves: CharacterMove[] = [];
  const finish = () => {
    const created =
      target !== null && !knownBefore.has(target) && !registeredBefore.has(target) && ops.registeredFolders().includes(target)
        ? target
        : null;
    recordCharacterMoves(service, ops, moves, target, created);
  };
  try {
    for (const id of ids) {
      const e = ops.get(id);
      if (!e) continue;
      const from = e.folder || null;
      await ops.setFolder(id, folder);
      const after = ops.get(id);
      if (after && (after.folder || null) === target && from !== target) {
        moves.push({ id, name: after.name, from, to: target });
      }
    }
  } catch (e) {
    finish();
    throw e;
  }
  finish();
}

/**
 * globalCharacterPresetService.createFolder 대신 — 되돌림 = 비어 있을 때만 deleteFolder(프리셋이 들어 있으면 폐기),
 * 다시 실행 = 같은 자리에 createFolder. 반환 = 서비스가 정규화한 이름.
 */
export async function createGlobalCharacterFolderRecorded(
  name: string,
  opts: GlobalLibraryUndoOptions = {},
): Promise<string> {
  const { service, ops } = resolve(opts, 'characters');
  const created = await ops.createFolder(name);
  let at = ops.registeredFolders().indexOf(created);
  service.record(GLOBAL_UNDO_SCOPE, {
    label: UNDO_TEXT.globalCharacterFolderCreate(created),
    verify: (dir) => {
      const list = ops.listFolders();
      if (dir === 'redo') {
        return list.includes(created) ? UNDO_TEXT.globalCharacterFolderTaken(created) : true;
      }
      if (!list.includes(created)) return UNDO_TEXT.globalCharacterFolderGone(created);
      if (ops.list().some((e) => e.folder === created)) return UNDO_TEXT.globalCharacterFolderNotEmpty(created);
      return true;
    },
    undo: async () => {
      at = ops.registeredFolders().indexOf(created);
      await ops.deleteFolder(created);
    },
    redo: async () => {
      await ops.createFolder(created, at >= 0 ? at : undefined);
    },
  });
  return created;
}

/** globalCharacterPresetService.renameFolder 대신 — 되돌림 = renameFolder(새, 옛)(소속 프리셋을 서비스가 함께 옮긴다) */
export async function renameGlobalCharacterFolderRecorded(
  from: string,
  to: string,
  opts: GlobalLibraryUndoOptions = {},
): Promise<void> {
  const { service, ops } = resolve(opts, 'characters');
  const target = to.trim();
  await ops.renameFolder(from, to);
  const list = ops.listFolders();
  if (from === target || !list.includes(target) || list.includes(from)) return;
  service.record(GLOBAL_UNDO_SCOPE, {
    label: UNDO_TEXT.globalCharacterFolderRename(from, target),
    undoLabel: UNDO_TEXT.globalCharacterFolderRename(target, from),
    verify: (dir) => {
      const [src, dst] = dir === 'undo' ? [target, from] : [from, target];
      const folders = ops.listFolders();
      if (!folders.includes(src)) return UNDO_TEXT.globalCharacterFolderGone(src);
      if (folders.includes(dst)) return UNDO_TEXT.globalCharacterFolderTaken(dst);
      return true;
    },
    undo: () => ops.renameFolder(target, from),
    redo: () => ops.renameFolder(from, target),
  });
}

/**
 * globalCharacterPresetService.deleteFolder 대신 — 서비스는 폴더만 지우고 소속 프리셋은 **미분류로 옮긴다**(프리셋·이미지는 남음).
 * 되돌림 = 레지스트리 원래 자리에 createFolder(레지스트리에 없던 파생 폴더면 건너뜀) → 그때 소속이던 프리셋을 setFolder 로 복귀
 * (그사이 지워졌거나 다른 폴더로 옮겨진 프리셋은 건너뛰고 부분 실패로 안내). 다시 실행 = deleteFolder.
 */
export async function deleteGlobalCharacterFolderRecorded(
  name: string,
  opts: GlobalLibraryUndoOptions = {},
): Promise<void> {
  const { service, ops } = resolve(opts, 'characters');
  const at = ops.registeredFolders().indexOf(name);
  let members = ops
    .list()
    .filter((e) => e.folder === name)
    .map((e) => ({ id: e.id, name: e.name }));
  const existed = ops.listFolders().includes(name);
  await ops.deleteFolder(name);
  if (!existed || ops.listFolders().includes(name)) return;
  service.record(GLOBAL_UNDO_SCOPE, {
    label: UNDO_TEXT.globalCharacterFolderDelete(name),
    verify: (dir) => {
      const has = ops.listFolders().includes(name);
      if (dir === 'undo') return has ? UNDO_TEXT.globalCharacterFolderTaken(name) : true;
      return has ? true : UNDO_TEXT.globalCharacterFolderGone(name);
    },
    undo: async (): Promise<UndoOutcome> => {
      if (at >= 0) await ops.createFolder(name, at);
      let failed = 0;
      let firstError: string | undefined;
      const kept: typeof members = [];
      for (const m of members) {
        const e = ops.get(m.id);
        const reason = !e
          ? UNDO_TEXT.globalCharacterGone(m.name)
          : e.folder
            ? UNDO_TEXT.globalCharacterChanged(e.name)
            : undefined;
        if (reason) {
          failed++;
          firstError ??= reason;
          continue;
        }
        await ops.setFolder(m.id, name);
        kept.push(m);
      }
      members = kept;
      // 폴더 자체는 되살렸으므로 전부 실패로 보지 않는다(total = 폴더 1 + 프리셋)
      return { total: kept.length + failed + 1, failed, firstError };
    },
    redo: async () => {
      members = ops
        .list()
        .filter((e) => e.folder === name)
        .map((e) => ({ id: e.id, name: e.name }));
      await ops.deleteFolder(name);
    },
  });
}

// ── 글로벌 프리셋(그림체) ──────────────────────────────────────────────────

/** globalPresetService.rename 대신(목록 「이름 변경」) — 편집 창 저장 안의 이름 변경은 편집 저장과 한 동작이라 기록하지 않는다 */
export async function renameGlobalPresetRecorded(
  id: string,
  name: string,
  opts: GlobalLibraryUndoOptions = {},
): Promise<void> {
  const { service, ops } = resolve(opts, 'presets');
  const before = ops.get(id)?.name;
  await ops.rename(id, name);
  const entry = ops.get(id);
  const after = entry?.name;
  if (!entry || before === undefined || after === undefined || before === after) return;
  const type = entry.workflowType;
  service.record(GLOBAL_UNDO_SCOPE, {
    label: UNDO_TEXT.globalPresetRename(before, after),
    undoLabel: UNDO_TEXT.globalPresetRename(after, before),
    verify: (dir) => {
      const [cur, dst] = dir === 'undo' ? [after, before] : [before, after];
      const e = ops.get(id);
      if (!e) return UNDO_TEXT.globalPresetGone(cur);
      if (e.name !== cur) return UNDO_TEXT.globalPresetChanged(e.name);
      const other = ops.getByName(type, dst);
      if (other && other.id !== id) return UNDO_TEXT.globalPresetNameTaken(dst);
      return true;
    },
    undo: () => ops.rename(id, before),
    redo: () => ops.rename(id, after),
  });
}

interface DefaultChange {
  id: string;
  name: string;
}

function recordDefaultChanges(service: UndoService, ops: GlobalPresetOps, changes: DefaultChange[], value: boolean) {
  if (changes.length === 0) return;
  const label =
    changes.length === 1
      ? value
        ? UNDO_TEXT.globalPresetDefaultOn(changes[0].name)
        : UNDO_TEXT.globalPresetDefaultOff(changes[0].name)
      : UNDO_TEXT.globalPresetDefaultBulk(changes.length, value);
  const apply = async (dir: 'undo' | 'redo'): Promise<UndoOutcome> => {
    // 되돌림 = 지금 value 여야, 다시 실행 = 지금 !value 여야
    const expected = dir === 'undo' ? value : !value;
    const order = dir === 'undo' ? [...changes].reverse() : [...changes];
    let failed = 0;
    let firstError: string | undefined;
    for (const c of order) {
      const e = ops.get(c.id);
      const reason = !e
        ? UNDO_TEXT.globalPresetGone(c.name)
        : !!e.isDefault !== expected
          ? UNDO_TEXT.globalPresetChanged(e.name)
          : undefined;
      if (reason) {
        failed++;
        firstError ??= reason;
        changes.splice(changes.indexOf(c), 1);
        continue;
      }
      await ops.setDefault(c.id, !expected);
    }
    return { total: order.length, failed, firstError };
  };
  service.record(GLOBAL_UNDO_SCOPE, {
    label,
    undo: () => apply('undo'),
    redo: () => apply('redo'),
  });
}

/** globalPresetService.setDefault 대신 — 절대값 기록(되돌림 = 반대 값) */
export async function setGlobalPresetDefaultRecorded(
  id: string,
  value: boolean,
  opts: GlobalLibraryUndoOptions = {},
): Promise<void> {
  const { service, ops } = resolve(opts, 'presets');
  const before = ops.get(id)?.isDefault;
  await ops.setDefault(id, value);
  const e = ops.get(id);
  if (!e || !!before === value || !!e.isDefault !== value) return;
  recordDefaultChanges(service, ops, [{ id, name: e.name }], value);
}

/** 선택 일괄 기본 지정/해제 — 한 동작 = 한 항목(실제로 바뀐 것만). 종전처럼 개별 오류는 삼킨다 */
export async function setGlobalPresetsDefaultRecorded(
  ids: Iterable<string>,
  value: boolean,
  opts: GlobalLibraryUndoOptions = {},
): Promise<void> {
  const { service, ops } = resolve(opts, 'presets');
  const changes: DefaultChange[] = [];
  for (const id of ids) {
    const before = ops.get(id)?.isDefault;
    try {
      await ops.setDefault(id, value);
    } catch (e) {
      continue;
    }
    const e = ops.get(id);
    if (e && !!before !== value && !!e.isDefault === value) changes.push({ id, name: e.name });
  }
  recordDefaultChanges(service, ops, changes, value);
}

// ── 작가 라이브러리(동기 메서드) ───────────────────────────────────────────

/** artistLibraryService.renameArtist 대신 — 서비스는 같은 이름 작가가 있으면 조용히 돌아온다(그때는 기록 없음) */
export function renameArtistRecorded(id: string, name: string, opts: GlobalLibraryUndoOptions = {}): void {
  const { service, ops } = resolve(opts, 'artists');
  const before = ops.getArtist(id)?.name;
  ops.renameArtist(id, name);
  const after = ops.getArtist(id)?.name;
  if (before === undefined || after === undefined || before === after) return;
  const step = (dst: string) => {
    ops.renameArtist(id, dst);
    if (ops.getArtist(id)?.name !== dst) throw new Error(UNDO_TEXT.artistNameTaken(dst));
  };
  service.record(GLOBAL_UNDO_SCOPE, {
    label: UNDO_TEXT.artistRename(before, after),
    undoLabel: UNDO_TEXT.artistRename(after, before),
    verify: (dir) => {
      const [cur, dst] = dir === 'undo' ? [after, before] : [before, after];
      const a = ops.getArtist(id);
      if (!a) return UNDO_TEXT.artistGone(cur);
      if (a.name !== cur) return UNDO_TEXT.artistChanged(a.name);
      if (ops.findArtistByName(dst, id)) return UNDO_TEXT.artistNameTaken(dst);
      return true;
    },
    undo: () => step(before),
    redo: () => step(after),
  });
}

/** artistLibraryService.toggleFavorite 대신 — 절대값(setFavorite) 기록 */
export function toggleArtistFavoriteRecorded(id: string, opts: GlobalLibraryUndoOptions = {}): void {
  const { service, ops } = resolve(opts, 'artists');
  const a = ops.getArtist(id);
  if (!a) return;
  const on = !a.favorite;
  const name = a.name;
  ops.setFavorite(id, on);
  if (ops.getArtist(id)?.favorite !== on) return;
  service.record(GLOBAL_UNDO_SCOPE, {
    label: on ? UNDO_TEXT.artistFavoriteOn(name) : UNDO_TEXT.artistFavoriteOff(name),
    verify: (dir) => {
      const cur = ops.getArtist(id);
      if (!cur) return UNDO_TEXT.artistGone(name);
      const expected = dir === 'undo' ? on : !on;
      return cur.favorite === expected ? true : UNDO_TEXT.artistChanged(cur.name);
    },
    undo: () => ops.setFavorite(id, !on),
    redo: () => ops.setFavorite(id, on),
  });
}

/**
 * 작가 한 명의 목록 상태(이미지 순서·태그) 전후 기록 — 되살리기는 통째 지정 메서드(setImageOrder·setTags, 원래 자리 그대로).
 * 실행 직전 지금 값이 기록 결과와 다르면 폐기(D15).
 */
function recordArtistList(
  service: UndoService,
  ops: ArtistOps,
  id: string,
  label: string,
  before: string[],
  read: (a: ArtistEntryLike) => string[],
  write: (list: string[]) => void,
): void {
  const a = ops.getArtist(id);
  if (!a) return;
  const after = read(a).slice();
  if (sameList(before, after)) return;
  const name = a.name;
  service.record(GLOBAL_UNDO_SCOPE, {
    label,
    verify: (dir) => {
      const cur = ops.getArtist(id);
      if (!cur) return UNDO_TEXT.artistGone(name);
      return sameList(read(cur), dir === 'undo' ? after : before) ? true : UNDO_TEXT.artistChanged(cur.name);
    },
    undo: () => write(before.slice()),
    redo: () => write(after.slice()),
  });
}

const imageIdsOf = (a: ArtistEntryLike) => a.images.map((i) => i.id);
const tagsOf = (a: ArtistEntryLike) => a.tags.slice();
/** 목록에 새로 생긴 값(정규화된 태그 — 라벨용) */
const addedOf = (before: string[], after: string[]) => after.find((t) => !before.includes(t));

/** artistLibraryService.setThumbnail 대신 — 이미지 순서 전체를 보관했다가 setImageOrder 로 되살린다(원래 자리 그대로) */
export function setArtistThumbnailRecorded(id: string, imageId: string, opts: GlobalLibraryUndoOptions = {}): void {
  const { service, ops } = resolve(opts, 'artists');
  const a = ops.getArtist(id);
  if (!a) return;
  const before = imageIdsOf(a);
  ops.setThumbnail(id, imageId);
  recordArtistList(service, ops, id, UNDO_TEXT.artistThumbnail(a.name), before, imageIdsOf, (ids) =>
    ops.setImageOrder(id, ids),
  );
}

/** artistLibraryService.setImageFamily 대신 — 되돌림 = 이전 계열(없음 포함) */
export function setArtistImageFamilyRecorded(
  id: string,
  imageId: string,
  family: ModelSamplingFamily | undefined,
  opts: GlobalLibraryUndoOptions = {},
): void {
  const { service, ops } = resolve(opts, 'artists');
  const a = ops.getArtist(id);
  const img = a?.images.find((i) => i.id === imageId);
  if (!a || !img) return;
  const name = a.name;
  const before = img.family;
  ops.setImageFamily(id, imageId, family);
  const after = ops.getArtist(id)?.images.find((i) => i.id === imageId)?.family;
  if (before === after) return;
  service.record(GLOBAL_UNDO_SCOPE, {
    label: UNDO_TEXT.artistImageFamily(name),
    verify: (dir) => {
      const cur = ops.getArtist(id);
      if (!cur) return UNDO_TEXT.artistGone(name);
      const curImg = cur.images.find((i) => i.id === imageId);
      if (!curImg) return UNDO_TEXT.artistImageGone(cur.name);
      return curImg.family === (dir === 'undo' ? after : before) ? true : UNDO_TEXT.artistChanged(cur.name);
    },
    undo: () => ops.setImageFamily(id, imageId, before),
    redo: () => ops.setImageFamily(id, imageId, after),
  });
}

/** artistLibraryService.addTag 대신 — 태그 목록 전후(setTags 로 되살림). 라벨 = 정규화된 태그(「#」 보장) */
export function addArtistTagRecorded(id: string, tag: string, opts: GlobalLibraryUndoOptions = {}): void {
  const { service, ops } = resolve(opts, 'artists');
  const a = ops.getArtist(id);
  if (!a) return;
  const before = tagsOf(a);
  ops.addTag(id, tag);
  const now = ops.getArtist(id);
  const added = now ? addedOf(before, now.tags) : undefined;
  if (!added) return;
  recordArtistList(service, ops, id, UNDO_TEXT.artistTagAdd(a.name, added), before, tagsOf, (tags) =>
    ops.setTags(id, tags),
  );
}

/** artistLibraryService.removeTag 대신 — 되돌리면 원래 자리로 */
export function removeArtistTagRecorded(id: string, tag: string, opts: GlobalLibraryUndoOptions = {}): void {
  const { service, ops } = resolve(opts, 'artists');
  const a = ops.getArtist(id);
  if (!a) return;
  const before = tagsOf(a);
  ops.removeTag(id, tag);
  recordArtistList(service, ops, id, UNDO_TEXT.artistTagRemove(a.name, tag), before, tagsOf, (tags) =>
    ops.setTags(id, tags),
  );
}

/** 태그 프리셋 팔레트 전후 기록(setTagPresets 로 되살림) */
function recordTagPresets(service: UndoService, ops: ArtistOps, label: string, before: string[]) {
  const after = ops.tagPresets().slice();
  if (sameList(before, after)) return;
  service.record(GLOBAL_UNDO_SCOPE, {
    label,
    verify: (dir) =>
      sameList(ops.tagPresets(), dir === 'undo' ? after : before) ? true : UNDO_TEXT.artistTagPresetsChanged,
    undo: () => ops.setTagPresets(before.slice()),
    redo: () => ops.setTagPresets(after.slice()),
  });
}

/** artistLibraryService.addTagPreset 대신 */
export function addArtistTagPresetRecorded(tag: string, opts: GlobalLibraryUndoOptions = {}): void {
  const { service, ops } = resolve(opts, 'artists');
  const before = ops.tagPresets().slice();
  ops.addTagPreset(tag);
  const added = addedOf(before, ops.tagPresets());
  if (!added) return;
  recordTagPresets(service, ops, UNDO_TEXT.artistTagPresetAdd(added), before);
}

/** artistLibraryService.removeTagPreset 대신 — 되돌리면 원래 자리로 */
export function removeArtistTagPresetRecorded(tag: string, opts: GlobalLibraryUndoOptions = {}): void {
  const { service, ops } = resolve(opts, 'artists');
  const before = ops.tagPresets().slice();
  ops.removeTagPreset(tag);
  recordTagPresets(service, ops, UNDO_TEXT.artistTagPresetRemove(tag), before);
}

// ── 내보내기 프리셋 ────────────────────────────────────────────────────────

/**
 * appState.saveExportPresets 대신 — 목록이 작은 JSON(이미지 파일 없음)이라 **통째 스냅숏** 한 항목(추가·저장·삭제·이름·복제 공용,
 * 라벨은 호출부가 정한다). 되돌림 = 이전 목록 사본 저장, 다시 실행 = 이후 목록 사본 저장. 실행 직전 지금 목록이 기록 결과와
 * 다르면(다른 창 저장 등) 폐기. 저장한 배열(next)은 서비스가 그대로 캐시하므로 기록은 깊은 사본으로 한다.
 */
export function saveExportPresetsRecorded<P>(next: P[], label: string, opts: GlobalLibraryUndoOptions = {}): void {
  const { service, ops } = resolve(opts, 'exportPresets');
  const before = undoDeepClone(ops.load()) as unknown[];
  ops.save(next);
  const after = undoDeepClone(next) as unknown[];
  if (undoDeepEqual(before, after)) return;
  service.record(GLOBAL_UNDO_SCOPE, {
    label,
    verify: (dir) =>
      undoDeepEqual(ops.load(), dir === 'undo' ? after : before) ? true : UNDO_TEXT.exportPresetsChanged,
    undo: () => ops.save(undoDeepClone(before)),
    redo: () => ops.save(undoDeepClone(after)),
  });
}

// ── 프로젝트 템플릿 ────────────────────────────────────────────────────────

/** projectTemplateService.rename 대신(템플릿 관리 창 「이름 변경」) */
export async function renameTemplateRecorded(
  id: string,
  name: string,
  opts: GlobalLibraryUndoOptions = {},
): Promise<void> {
  const { service, ops } = resolve(opts, 'templates');
  const before = ops.get(id)?.name;
  await ops.rename(id, name);
  const after = ops.get(id)?.name;
  if (before === undefined || after === undefined || before === after) return;
  service.record(GLOBAL_UNDO_SCOPE, {
    label: UNDO_TEXT.templateRename(before, after),
    undoLabel: UNDO_TEXT.templateRename(after, before),
    verify: (dir) => {
      const [cur, dst] = dir === 'undo' ? [after, before] : [before, after];
      const e = ops.get(id);
      if (!e) return UNDO_TEXT.templateGone(cur);
      if (e.name !== cur) return UNDO_TEXT.templateChanged(e.name);
      const other = ops.getByName(dst);
      if (other && other.id !== id) return UNDO_TEXT.templateNameTaken(dst);
      return true;
    },
    undo: () => ops.rename(id, before),
    redo: () => ops.rename(id, after),
  });
}

/**
 * projectTemplateService.setBadgeColor 대신(폴더 기본 템플릿 창 배지 색) — 같은 템플릿을 1초 안에 또 바꾸면 한 항목,
 * 처음 색으로 돌아오면 항목 삭제. 실패(throw)는 기록 없이 그대로 던진다.
 */
export async function setTemplateBadgeColorRecorded(
  id: string,
  color: string | null,
  opts: GlobalLibraryUndoOptions = {},
): Promise<void> {
  const { service, ops } = resolve(opts, 'templates');
  const name = ops.get(id)?.name ?? '';
  const adapter: UndoSnapshotAdapter<string | null> = {
    snapshot: () => ops.get(id)?.badgeColor ?? null,
    restore: (c) => ops.setBadgeColor(id, c),
    equals: (a, b) => a === b,
    verify: () => (ops.get(id) ? true : UNDO_TEXT.templateGone(name)),
    staleReason: UNDO_TEXT.templateChanged(name),
  };
  const pending = service.track(GLOBAL_UNDO_SCOPE, UNDO_TEXT.templateBadgeColor(name), adapter, {
    key: `templateBadge:${id}`,
  });
  try {
    await ops.setBadgeColor(id, color);
  } catch (e) {
    pending.cancel();
    throw e;
  }
  pending.commit();
}
