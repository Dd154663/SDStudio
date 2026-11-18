// 글로벌 프리셋·글로벌 캐릭터 프리셋 삭제 되돌리기(2026-11-18 프리셋 유실 조사 경로 7·8, SPEC_GUIDE 「되돌리기 계약」, jest
// undoGlobalDelete.test.ts). 전역 스택(GLOBAL_UNDO_SCOPE)에 한 동작 = 한 항목(선택 여러 건도 한 항목).
//
// · 이미지 되살리기 = 「내용을 기록에 담아 두었다가 다시 쓰기」. 삭제 직전에 항목이 가리키는 이미지 파일 내용(data URI)을 읽어
//   기록에 보관하고, 서비스 삭제는 종전대로 파일까지 바로 지운다(파일 삭제를 미루지 않음 → 기록이 버려지거나 앱이 꺼져도 남는 파일
//   없음, 다음 실행 정리 불필요). 되돌림 = 서비스의 restoreDeletedEntry 가 같은 파일명으로 다시 쓰고(이미 있으면 덮지 않음) 같은 id·
//   내용·자리로 넣는다. 다시 실행 = 서비스 delete(기존 삭제 관문 그대로).
// · 메모리 한도(GLOBAL_DELETE_UNDO_LIMITS): 한 번의 삭제가 보관할 이미지가 perDeleteChars 를 넘으면 그 삭제는 기록하지 않는다 —
//   삭제 확인 창을 띄우기 **전에** prepare 가 이미지를 읽어 판정하므로 그때는 종전 「영구 삭제」 문구가 뜬다. 보관 중인 이미지 합계가
//   totalChars 를 넘으면 가장 오래된 기록의 이미지부터 비우고, 그 기록은 실행 때 「보관 한도」 이유로 버려진다(일부만 되살리지 않음).
// · 실행 직전 검사(D15): 읽기 실패로 막힌 저장소면 거부(서비스 assertWritable 과 같은 조건). 되돌림 때 같은 id 가 이미 있으면
//   (다른 창이 다시 만들었거나 불러옴) 그 항목은 되살리지 않고 안내한다. 다시 실행 때 그사이 내용이 바뀌었으면 지우지 않는다.
// · 이 모듈은 잠금을 쓰지 않고 파일을 직접 쓰거나 지우지 않는다 — 읽기(fetchImage)·삭제(delete)·되살리기(restoreDeleted)는
//   서비스 공개 메서드. 서비스 내부에서 기록하지 않는다(호출부 UI 가 prepare → 확인 → run).
import {
  GLOBAL_UNDO_SCOPE,
  undoDeepClone,
  undoDeepEqual,
  undoService,
  UNDO_TEXT,
  UndoOutcome,
  UndoService,
} from './undoService';

/**
 * 이미지 보관 한도(data URI 글자 수) — 큰 이미지 여러 장을 지울 때의 메모리 상한.
 * JS 문자열은 글자당 2바이트까지 쓰므로 실제 메모리는 글자 수의 최대 두 배다. 모바일 WebView 를 기준으로 낮게 잡는다
 * (2026-11-18 검토: 드문 삭제 되돌리기 때문에 평소 메모리를 크게 쥐고 있지 않게). 넘는 삭제는 종전처럼 영구 삭제 문구로 진행한다.
 */
export const GLOBAL_DELETE_UNDO_LIMITS = {
  /** 한 번의 삭제가 보관할 수 있는 이미지 합계 — 넘으면 그 삭제는 되돌리기 없이(영구 삭제 문구) */
  perDeleteChars: 16 * 1024 * 1024,
  /** 모든 삭제 기록이 함께 보관하는 이미지 합계 — 넘으면 오래된 기록의 이미지부터 비운다 */
  totalChars: 32 * 1024 * 1024,
};

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
  /** 항목이 가리키는 이미지 파일 토큰(파일명) */
  imageTokens(entry: E): string[];
  /** 토큰 → data URI(없으면 null) */
  fetchImage(token: string): Promise<string | null>;
  delete(id: string): Promise<void>;
  /** 지우기 직전 항목별 부가 정보(글로벌 캐릭터 = 폴더가 그사이 없어졌을 때의 처리) — deleting = 이번에 지우는 id 전부 */
  captureMeta?(entry: E, deleting: ReadonlySet<string>): M;
  /** 같은 id·내용으로 at 자리에 되살린다. 같은 id 가 이미 있으면 undefined(덮지 않음). 반환 = 실제로 들어간 항목(이름 충돌 반영) */
  restoreDeleted(entry: E, at: number, images: ReadonlyMap<string, string>, meta: M | undefined): Promise<E | undefined>;
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

// ── 이미지 보관함(메모리 전용) ──────────────────────────────────────────────

interface ImageHolder {
  chars: number;
  /** null = 한도 초과로 비움 */
  images: Map<string, string> | null;
}

const holders: ImageHolder[] = [];
let heldChars = 0;

function charsOf(images: ReadonlyMap<string, string>): number {
  let n = 0;
  for (const v of images.values()) n += v.length;
  return n;
}

function retain(holder: ImageHolder): void {
  holders.push(holder);
  heldChars += holder.chars;
  while (heldChars > GLOBAL_DELETE_UNDO_LIMITS.totalChars && holders.length > 1) {
    const old = holders.shift()!;
    if (old.images) {
      heldChars -= old.chars;
      old.images = null;
    }
  }
}

/** 테스트·진단용 — 보관 중인 이미지 글자 수 */
export function globalDeleteHeldChars(): number {
  return heldChars;
}

/** 테스트용 — 보관함 초기화 */
export function resetGlobalDeleteUndoState(): void {
  holders.length = 0;
  heldChars = 0;
}

// ── 준비(확인 창 전) → 실행(확인 뒤) ───────────────────────────────────────

export interface GlobalDeleteResult {
  /** 실제로 지운 항목 이름 */
  deleted: string[];
  /** 지우지 못한 항목(이유 포함) */
  failed: { id: string; name: string; error: string }[];
  /** 되돌리기 기록을 남겼는가 */
  recorded: boolean;
}

export interface GlobalDeletePlan {
  /** true = 확인 창을 'undoable' 문구로, false = 'permanent'(기록 불가·이미지 한도 초과·막힌 저장소) */
  readonly undoable: boolean;
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

async function readImages<E extends DeletableEntryLike>(
  ops: GlobalDeleteOps<E>,
  entries: readonly E[],
  into: Map<string, string>,
  cap: number,
): Promise<boolean> {
  let chars = charsOf(into);
  for (const e of entries) {
    for (const token of ops.imageTokens(e)) {
      if (!token || into.has(token)) continue;
      let data: string | null = null;
      try {
        data = await ops.fetchImage(token);
      } catch {
        data = null;
      }
      if (!data) continue; // 이미 없는 파일 — 되살릴 것도 없다(항목은 종전처럼 그 토큰을 그대로 가진다)
      into.set(token, data);
      chars += data.length;
      if (chars > cap) return false;
    }
  }
  return true;
}

/**
 * 삭제 준비 — 확인 창을 띄우기 전에 부른다. 기록할 수 있으면 이미지를 미리 읽어 두고 undoable=true.
 * run() 은 확인 뒤 한 번만 — 항목을 하나씩 서비스 delete 로 지우고(실패는 모아 돌려줌) 실제로 지운 것만 한 항목으로 기록한다.
 */
export async function prepareGlobalDelete(
  kind: GlobalDeleteKind,
  ids: Iterable<string>,
  opts: GlobalDeleteUndoOptions = {},
): Promise<GlobalDeletePlan> {
  const { service, ops } = resolve(kind, opts);
  const idList = [...new Set(ids)];
  const images = new Map<string, string>();
  let undoable = service.canRecord(GLOBAL_UNDO_SCOPE) && !ops.isBlocked();
  if (undoable) {
    const entries = idList.map((id) => ops.get(id)).filter((e): e is DeletableEntryLike => !!e);
    undoable = await readImages(ops, entries, images, GLOBAL_DELETE_UNDO_LIMITS.perDeleteChars);
    if (!undoable) images.clear();
  }
  let ran = false;
  return {
    undoable,
    run: async () => {
      if (ran) return { deleted: [], failed: [], recorded: false };
      ran = true;
      return runDelete(service, ops, idList, undoable, images);
    },
  };
}

async function runDelete<E extends DeletableEntryLike, M>(
  service: UndoService,
  ops: GlobalDeleteOps<E, M>,
  ids: string[],
  undoable: boolean,
  images: Map<string, string>,
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
    // 확인 창이 떠 있는 동안 이미지가 바뀌었으면(편집 저장·다른 창) 지우기 직전에 마저 읽는다
    if (undoable) await readImages(ops, [entry], images, Number.POSITIVE_INFINITY);
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
  if (!undoable || items.length === 0 || !service.canRecord(GLOBAL_UNDO_SCOPE)) {
    return { deleted, failed, recorded: false };
  }
  // 지운 항목이 쓰던 이미지만 남긴다
  const used = new Set(items.flatMap((i) => ops.imageTokens(i.entry)));
  for (const k of [...images.keys()]) if (!used.has(k)) images.delete(k);
  const holder: ImageHolder = { chars: charsOf(images), images };
  retain(holder);
  recordDelete(service, ops, items, holder);
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
  holder: ImageHolder,
): void {
  const label = ops.label(items.map((i) => i.entry.name));
  service.record(GLOBAL_UNDO_SCOPE, {
    label,
    kind: 'file',
    verify: () => {
      if (!holder.images) return UNDO_TEXT.globalDeleteImagesEvicted;
      if (ops.isBlocked()) return UNDO_TEXT.globalStoreBlocked;
      return true;
    },
    undo: async (): Promise<UndoOutcome> => {
      const imgs = holder.images ?? new Map<string, string>();
      // 원래 자리 오름차순으로 넣어야 여러 건이 원래 순서로 돌아온다
      const order = [...items].sort((a, b) => a.at - b.at);
      let failed = 0;
      let firstError: string | undefined;
      const kept: DeletedItem<E, M>[] = [];
      for (const it of order) {
        try {
          if (ops.get(it.entry.id)) throw new Error(UNDO_TEXT.globalDeleteIdTaken(it.entry.name));
          const restored = await ops.restoreDeleted(undoDeepClone(it.entry), it.at, imgs, it.meta);
          if (!restored) throw new Error(UNDO_TEXT.globalDeleteIdTaken(it.entry.name));
          it.restored = undoDeepClone(restored);
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
