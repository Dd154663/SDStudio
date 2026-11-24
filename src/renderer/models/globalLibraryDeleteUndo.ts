// 글로벌 프리셋·글로벌 캐릭터 프리셋 삭제 되돌리기(2026-11-18 프리셋 유실 조사 경로 7·8, SPEC_GUIDE 「되돌리기 계약」, jest
// undoGlobalDelete.test.ts). 전역 스택(GLOBAL_UNDO_SCOPE)에 한 동작 = 한 항목(선택 여러 건도 한 항목).
//
// · 2026-11-24 휴지통(globalLibraryTrash.ts): 서비스 delete 는 항목을 같은 저장소 파일의 휴지통으로 옮기고 이미지 파일은 지우지
//   않는다. 그래서 되돌림 = 서비스 restoreFromTrash(같은 id·원래 자리로), 다시 실행 = 서비스 delete(다시 휴지통으로).
//   종전의 「이미지 내용을 메모리에 담아 두었다가 다시 쓰기」와 보관 한도(16M·32M 글자)는 없앴다 — 크기와 관계없이 모든 삭제가
//   휴지통으로 가고 기록된다. 앱을 다시 켠 뒤에는 휴지통 화면에서 복원한다.
// · 실행 직전 검사(D15): 읽기 실패로 막힌 저장소면 거부(서비스 assertWritable 과 같은 조건). 되돌림 때 같은 id 가 이미 목록에 있으면
//   (다른 창이 다시 만들었거나 불러옴) 그 항목은 되살리지 않고 안내한다. 그사이 휴지통에서 영구 삭제됐으면(또는 다른 창이 복원)
//   조용히 넘어가지 않고 실패로 안내한다. 다시 실행 때 그사이 내용이 바뀌었으면 지우지 않는다.
// · 이 모듈은 잠금을 쓰지 않고 파일을 직접 쓰거나 지우지 않는다 — 삭제(delete)·복원(restoreFromTrash)은 서비스 공개 메서드.
//   서비스 내부에서 기록하지 않는다(호출부 UI 가 prepare → 확인 → run).
import {
  GLOBAL_UNDO_SCOPE,
  undoDeepClone,
  undoDeepEqual,
  undoService,
  UNDO_TEXT,
  UndoOutcome,
  UndoService,
} from './undoService';
import type { GlobalTrashRestoreOutcome } from './globalLibraryTrash';

export interface DeletableEntryLike {
  id: string;
  name: string;
}

/** 삭제 되돌리기에 필요한 서비스 공개 메서드(GlobalPresetService·GlobalCharacterPresetService 공용) */
export interface GlobalDeleteOps<E extends DeletableEntryLike = DeletableEntryLike, M = unknown> {
  /** 읽기 실패로 저장·변경이 막혔는가 */
  isBlocked(): boolean;
  list(): E[];
  get(id: string): E | undefined;
  /** 삭제 = 휴지통으로 이동(서비스 delete) */
  delete(id: string): Promise<void>;
  /** 휴지통에 그 id 가 있는가 */
  inTrash(id: string): boolean;
  /** 지우기 직전 항목별 부가 정보(글로벌 캐릭터 = 폴더가 그사이 없어졌을 때의 처리) — deleting = 이번에 지우는 id 전부 */
  captureMeta?(entry: E, deleting: ReadonlySet<string>): M;
  /** 휴지통 → 목록 at 자리(서비스 restoreFromTrash). 반환 = 복원 결과(이름 충돌 반영) */
  restoreFromTrash(id: string, at: number, meta: M | undefined): Promise<GlobalTrashRestoreOutcome<E>>;
  label(names: readonly string[]): string;
  gone(name: string): string;
  changed(name: string): string;
}

export type GlobalDeleteKind = 'presets' | 'characters';

let configured: Partial<Record<GlobalDeleteKind, GlobalDeleteOps<any, any>>> = {};

/** models/index.ts 가 서비스 배선을 넣는다(순환 import 회피 — 테스트는 ops 를 직접 넘긴다) */
export function configureGlobalLibraryDeleteUndo(ops: Partial<Record<GlobalDeleteKind, GlobalDeleteOps<any, any>>>): void {
  configured = { ...configured, ...ops };
}

export interface GlobalDeleteUndoOptions {
  service?: UndoService;
  ops?: GlobalDeleteOps<any, any>;
}

function resolve(kind: GlobalDeleteKind, opts: GlobalDeleteUndoOptions) {
  const ops = opts.ops ?? configured[kind];
  if (!ops) throw new Error('전역 라이브러리 되돌리기가 준비되지 않았습니다');
  return { service: opts.service ?? undoService, ops };
}

/** 글로벌 캐릭터 삭제의 부가 정보 — 되살릴 때 폴더가 없으면 그대로 둘지(이 삭제로만 사라지는 파생 폴더) */
export interface GlobalCharacterDeleteMeta {
  keepMissingFolder: boolean;
}

/**
 * 폴더가 레지스트리에 없고(엔트리에만 있는 파생 폴더) 이번에 지우는 항목 말고는 그 폴더를 쓰는 항목이 없으면 true —
 * 이 삭제가 폴더를 사라지게 하는 것이므로 되살릴 때 폴더도 그대로 되살린다. 등록된 폴더가 그사이 지워졌으면 미분류로.
 */
export function globalCharacterMetaOf(
  svc: { list(): { id: string; folder?: string }[]; folders: readonly string[] },
  entry: { id: string; folder?: string },
  deleting: ReadonlySet<string>,
): GlobalCharacterDeleteMeta {
  const folder = entry.folder;
  if (!folder || svc.folders.includes(folder)) return { keepMissingFolder: false };
  const others = svc.list().some((e) => e.folder === folder && !deleting.has(e.id));
  return { keepMissingFolder: !others };
}

// ── 준비(확인 창 전) → 실행(확인 뒤) ───────────────────────────────────────

export interface GlobalDeleteResult {
  /** 실제로 휴지통으로 옮긴 항목 이름 */
  deleted: string[];
  /** 옮기지 못한 항목(이유 포함) */
  failed: { id: string; name: string; error: string }[];
  /** 되돌리기 기록을 남겼는가 */
  recorded: boolean;
}

export interface GlobalDeletePlan {
  run(): Promise<GlobalDeleteResult>;
}

interface DeletedItem<E, M> {
  entry: E;
  /** 지우기 전 목록 자리 */
  at: number;
  meta: M | undefined;
  /** 되돌린 뒤 실제로 들어간 내용(다시 실행 검사용) */
  restored?: E;
}

const errorText = (e: unknown) => (e instanceof Error && e.message ? e.message : UNDO_TEXT.unknownError);

/**
 * 삭제 준비 — 확인 창을 띄우기 전에 부른다(종전 호출 모양 유지 — 지금은 미리 읽을 것이 없다).
 * run() 은 확인 뒤 한 번만 — 항목을 하나씩 서비스 delete 로 휴지통에 옮기고(실패는 모아 돌려줌) 실제로 옮긴 것만 한 항목으로 기록한다.
 * 기록할 수 없는 때(미러 창 등)에도 휴지통 이동은 그대로 한다(기록만 없음).
 */
export async function prepareGlobalDelete(
  kind: GlobalDeleteKind,
  ids: Iterable<string>,
  opts: GlobalDeleteUndoOptions = {},
): Promise<GlobalDeletePlan> {
  const { service, ops } = resolve(kind, opts);
  const idList = [...new Set(ids)];
  let ran = false;
  return {
    run: async () => {
      if (ran) return { deleted: [], failed: [], recorded: false };
      ran = true;
      return runDelete(service, ops, idList);
    },
  };
}

async function runDelete<E extends DeletableEntryLike, M>(
  service: UndoService,
  ops: GlobalDeleteOps<E, M>,
  ids: string[],
): Promise<GlobalDeleteResult> {
  const order = ops.list().map((e) => e.id);
  const deleting = new Set(ids.filter((id) => !!ops.get(id)));
  // 부가 정보는 하나도 지우기 전에(같은 폴더의 다른 선택 항목이 아직 있을 때) 잡는다
  const metas = new Map<string, M | undefined>();
  for (const id of deleting) {
    const e = ops.get(id);
    if (e) metas.set(id, ops.captureMeta?.(e, deleting));
  }
  const items: DeletedItem<E, M>[] = [];
  const failed: GlobalDeleteResult['failed'] = [];
  for (const id of ids) {
    const live = ops.get(id);
    if (!live) continue; // 그사이 없어진 항목 — 지운 것으로도 실패로도 세지 않는다(종전 delete 와 같음)
    const entry = undoDeepClone(live);
    try {
      await ops.delete(id);
    } catch (e) {
      failed.push({ id, name: entry.name, error: errorText(e) });
      continue;
    }
    if (ops.get(id)) {
      failed.push({ id, name: entry.name, error: UNDO_TEXT.unknownError });
      continue;
    }
    items.push({ entry, at: order.indexOf(id), meta: metas.get(id) });
  }
  const deleted = items.map((i) => i.entry.name);
  if (items.length === 0 || !service.canRecord(GLOBAL_UNDO_SCOPE)) {
    return { deleted, failed, recorded: false };
  }
  recordDelete(service, ops, items);
  return { deleted, failed, recorded: true };
}

/** 일부만 실패하면 이유를 토스트에 함께(종전 부분 실패 문구는 개수만 알린다) */
function outcomeOf(total: number, failed: number, firstError: string | undefined): UndoOutcome {
  if (failed > 0 && failed < total && firstError) {
    return { total, failed, firstError, notice: `${firstError} · ${UNDO_TEXT.partial(failed, total).trim()}` };
  }
  return { total, failed, firstError };
}

function recordDelete<E extends DeletableEntryLike, M>(
  service: UndoService,
  ops: GlobalDeleteOps<E, M>,
  items: DeletedItem<E, M>[],
): void {
  const label = ops.label(items.map((i) => i.entry.name));
  service.record(GLOBAL_UNDO_SCOPE, {
    label,
    kind: 'file',
    verify: () => {
      if (ops.isBlocked()) return UNDO_TEXT.globalStoreBlocked;
      return true;
    },
    undo: async (): Promise<UndoOutcome> => {
      // 원래 자리 오름차순으로 넣어야 여러 건이 원래 순서로 돌아온다
      const order = [...items].sort((a, b) => a.at - b.at);
      let failed = 0;
      let firstError: string | undefined;
      const kept: DeletedItem<E, M>[] = [];
      for (const it of order) {
        try {
          if (ops.get(it.entry.id)) throw new Error(UNDO_TEXT.globalDeleteIdTaken(it.entry.name));
          // 그사이 휴지통에서 영구 삭제됐거나(만료 포함) 다른 곳에서 복원됨 — 조용히 넘어가지 않고 실패로 안내
          if (!ops.inTrash(it.entry.id)) throw new Error(UNDO_TEXT.globalDeleteTrashGone(it.entry.name));
          const r = await ops.restoreFromTrash(it.entry.id, it.at, it.meta);
          if (r.kind === 'id-taken') throw new Error(UNDO_TEXT.globalDeleteIdTaken(it.entry.name));
          if (r.kind !== 'restored') throw new Error(UNDO_TEXT.globalDeleteTrashGone(it.entry.name));
          it.restored = undoDeepClone(r.entry);
          kept.push(it);
        } catch (e) {
          failed++;
          firstError ??= errorText(e);
        }
      }
      // 되살리지 못한 항목은 다시 실행 대상에서 뺀다(D15)
      items.splice(0, items.length, ...kept);
      return outcomeOf(order.length, failed, firstError);
    },
    redo: async (): Promise<UndoOutcome> => {
      let failed = 0;
      let firstError: string | undefined;
      const kept: DeletedItem<E, M>[] = [];
      const total = items.length;
      for (const it of [...items]) {
        const cur = ops.get(it.entry.id);
        const reason = !cur
          ? ops.gone(it.restored?.name ?? it.entry.name)
          : it.restored && !undoDeepEqual(cur, it.restored)
            ? ops.changed(cur.name)
            : undefined;
        if (reason) {
          failed++;
          firstError ??= reason;
          continue;
        }
        try {
          await ops.delete(it.entry.id);
          if (ops.get(it.entry.id)) throw new Error(UNDO_TEXT.unknownError);
          // 다음 되돌림은 마지막으로 되살렸던 내용(이름 충돌로 바뀐 이름 포함)으로
          if (it.restored) it.entry = it.restored;
          kept.push(it);
        } catch (e) {
          failed++;
          firstError ??= errorText(e);
        }
      }
      items.splice(0, items.length, ...kept);
      return outcomeOf(total, failed, firstError);
    },
  });
}
