// 글로벌 프리셋·글로벌 캐릭터 프리셋 휴지통의 공용 규칙(2026-11-24, 플랜 guides/plans/2026-11-18-global-library-trash.md).
// 순수 모듈 — 서비스·UI·backend 를 import 하지 않는다(jest 단독 검사 __tests__/globalLibraryTrash.test.ts).
//
// 저장 형식: 각 저장소 파일(global_presets.json · global_character_presets.json)에 선택 필드 `trash` 를 더한다.
//   "trash": [{ "entry": <목록 항목 원본 그대로>, "deletedAt": <삭제 시각 ms> }, …]
//   · 기존 필드·버전은 그대로. 휴지통이 비면 필드를 쓰지 않는다(지금까지의 파일과 글자 하나까지 같음).
//   · 필드가 없거나 배열이 아니면 빈 휴지통. entry 에 id·name 문자열이 없는 칸은 손상으로 버린다(목록 규칙과 같음).
//   · 글로벌 캐릭터의 원래 폴더 = entry.folder(항목 원본에 그대로 들어 있음).
//   · 구버전 앱이 이 파일을 저장하면 모르는 필드인 trash 가 떨어질 수 있다(지운 항목만 잃고 이미지 파일은 남는다 — 수용한 한계).
// 규칙:
//   · 같은 id 가 목록과 휴지통 양쪽에 있으면 목록 쪽을 남기고 휴지통 쪽을 버린다(되살아난 것을 다시 지우지 않게 — 로드·다른 창 교체·병합 공통).
//   · 보관 기한 GLOBAL_LIBRARY_TRASH_DAYS(30일). 만료 정리는 서비스가 저장소를 정상(ok)으로 읽은 경우에만 한다.
//   · 이미지 파일은 휴지통으로 옮길 때 지우지 않는다. 영구 삭제(수동·만료) 때만, 목록·휴지통·보존분 어디에서도 참조하지 않는 파일을 지운다.

import { mergeById } from './storeMerge';
import { holdEntry, type HeldEntry } from './heldEntries';

/** 보관 기한(일) — 확인 문구·남은 일수·만료 정리가 모두 이 상수를 쓴다 */
export const GLOBAL_LIBRARY_TRASH_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
export const GLOBAL_LIBRARY_TRASH_MS = GLOBAL_LIBRARY_TRASH_DAYS * DAY_MS;
/** 만료 정리를 앱 시작 뒤 얼마나 늦게 할지(ms) — 기존 휴지통 자동 정리(TrashService.autoCleanup)와 같은 10초 */
export const GLOBAL_LIBRARY_TRASH_CLEANUP_DELAY_MS = 10000;

export interface GlobalTrashItem<E> {
  /** 목록 항목 원본(깊은 사본) */
  entry: E;
  /** 휴지통으로 옮긴 시각(ms) */
  deletedAt: number;
}

/** 휴지통 → 목록 복원 결과 */
export type GlobalTrashRestoreOutcome<E> =
  | {
      kind: 'restored';
      /** 실제로 목록에 들어간 항목(이름 충돌 반영) */
      entry: E;
      /** 이름이 겹쳐 바꿨으면 원래 이름 */
      renamedFrom?: string;
      /** 항목이 가리키는데 파일이 없는 이미지 수(항목은 복원하되 이미지 없음 상태) */
      missingImages: number;
      /** 원래 폴더가 없어져 미분류로 복원했으면 그 폴더 이름(글로벌 캐릭터만) */
      folderDropped?: string;
    }
  /** 휴지통에 없다(그사이 영구 삭제·다른 창이 복원) */
  | { kind: 'not-in-trash' }
  /** 같은 id 가 이미 목록에 있다 */
  | { kind: 'id-taken' };

/** 영구 삭제(수동·만료) 결과 */
export interface GlobalTrashPurgeResult {
  /** 휴지통에서 뺀 항목 수 */
  removed: number;
  /** 실제로 지운 이미지 파일 수 */
  filesDeleted: number;
  /** 저장까지 끝났는가(false 면 이미지 파일은 지우지 않았다) */
  saved: boolean;
}

const deepCopy = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** 이미지 파일 토큰 비교 키(경로가 붙어 있어도 파일 이름으로) */
export function imageTokenKey(token: string): string {
  return token.split('/').pop() ?? token;
}

/**
 * 파일의 trash 필드 → 쓸 수 있는 휴지통 항목 + 보존분.
 * isEntry 가 거짓이면 손상(버림), isSupported 가 거짓이면 이 버전이 모르는 종류라 원본 그대로 보존(저장 때 원래 자리로 되돌려 씀).
 * deletedAt 이 숫자가 아니면 now 로 본다(보관 기한이 지금부터 다시 센다 — 덜 지우는 쪽).
 */
export function splitTrashField<E extends { id: string }>(
  raw: unknown,
  isEntry: (e: any) => boolean,
  now: number,
  isSupported?: (e: E) => boolean,
): { items: GlobalTrashItem<E>[]; held: HeldEntry[] } {
  const items: GlobalTrashItem<E>[] = [];
  const held: HeldEntry[] = [];
  if (!Array.isArray(raw)) return { items, held };
  const seen = new Set<string>();
  let index = 0;
  for (const t of raw) {
    if (!t || typeof t !== 'object' || !isEntry((t as any).entry)) continue;
    const entry = (t as any).entry as E;
    if (isSupported && !isSupported(entry)) {
      held.push(holdEntry(index, t));
      index++;
      continue;
    }
    if (seen.has(entry.id)) continue; // 휴지통 안 같은 id 는 앞의 것만
    seen.add(entry.id);
    const at = (t as any).deletedAt;
    items.push({
      entry,
      deletedAt: typeof at === 'number' && Number.isFinite(at) && at > 0 ? at : now,
    });
    index++;
  }
  return { items, held };
}

/** 같은 id 가 목록에 있으면 휴지통 쪽을 버린다(목록 우선). 바뀐 것이 없으면 같은 배열을 돌려준다 */
export function dropListedFromTrash<E extends { id: string }>(
  trash: GlobalTrashItem<E>[],
  listIds: Iterable<string>,
): GlobalTrashItem<E>[] {
  const ids = new Set(listIds);
  if (!trash.some((t) => ids.has(t.entry.id))) return trash;
  return trash.filter((t) => !ids.has(t.entry.id));
}

/**
 * 여러 창 3방향 병합(storeMerge.mergeById 와 같은 규칙 — 항목 키 = entry.id).
 * 결과에서 목록 쪽과 겹치는 id 를 빼는 것은 호출부가 목록 병합 뒤 dropListedFromTrash 로 한다.
 */
export function mergeTrash<E extends { id: string }>(
  base: GlobalTrashItem<E>[],
  local: GlobalTrashItem<E>[],
  remote: GlobalTrashItem<E>[],
): GlobalTrashItem<E>[] {
  const wrap = (list: GlobalTrashItem<E>[]) => list.map((item) => ({ id: item.entry.id, item }));
  return mergeById(wrap(base), wrap(local), wrap(remote)).map((w) => w.item);
}

/** 휴지통 항목 하나를 만든다(원본 깊은 사본 + 삭제 시각) */
export function makeTrashItem<E>(entry: E, now: number): GlobalTrashItem<E> {
  return { entry: deepCopy(entry), deletedAt: now };
}

export function isTrashExpired(item: { deletedAt: number }, now: number): boolean {
  return now - item.deletedAt >= GLOBAL_LIBRARY_TRASH_MS;
}

/** 남은 보관 일수(올림, 0 이상) — 화면 표시용 */
export function trashDaysLeft(deletedAt: number, now: number): number {
  const left = GLOBAL_LIBRARY_TRASH_MS - (now - deletedAt);
  return left <= 0 ? 0 : Math.ceil(left / DAY_MS);
}

/** 지울 후보 토큰 중 참조 집합(파일 이름 기준)에 없는 것만(중복 없이, 순서 유지) */
export function unreferencedTokens(candidates: Iterable<string>, referenced: Iterable<string>): string[] {
  const refs = new Set<string>();
  for (const r of referenced) if (typeof r === 'string' && r) refs.add(imageTokenKey(r));
  const out: string[] = [];
  const taken = new Set<string>();
  for (const c of candidates) {
    if (typeof c !== 'string' || !c) continue;
    const key = imageTokenKey(c);
    if (refs.has(key) || taken.has(key)) continue;
    taken.add(key);
    out.push(c);
  }
  return out;
}

/** 휴지통 화면에 보일 순서 — 최근 삭제 순(같은 시각이면 이름 순) */
export function sortGlobalTrashNewestFirst<E extends { name: string }>(
  items: readonly GlobalTrashItem<E>[],
): GlobalTrashItem<E>[] {
  return [...items].sort((a, b) => b.deletedAt - a.deletedAt || a.entry.name.localeCompare(b.entry.name));
}

/** 사용자 문구 단일 출처 */
export const GLOBAL_TRASH_TEXT = {
  /** 진입 버튼 — 비어 있으면 숫자 없이 */
  button: (count: number) => (count > 0 ? `휴지통 (${count})` : '휴지통'),
  title: (label: string) => `${label} 휴지통`,
  notice: `휴지통의 항목은 ${GLOBAL_LIBRARY_TRASH_DAYS}일이 지나면 자동으로 영구 삭제됩니다. 이미지는 영구 삭제할 때 함께 지워집니다.`,
  empty: '휴지통이 비어 있습니다',
  daysLeft: (days: number) => (days > 0 ? `${days}일 남음` : '곧 영구 삭제'),
  restored: (name: string) => `"${name}"을(를) 복원했습니다.`,
  restoredAs: (name: string, newName: string) => `"${name}"을(를) "${newName}"(으)로 복원했습니다.`,
  restoredMany: (count: number) => `${count}개를 복원했습니다.`,
  imageMissing: (count: number) => `이미지 ${count}개는 파일이 없어 이미지 없이 복원했습니다.`,
  folderDropped: (folder: string) => `원래 폴더 "${folder}"이(가) 없어 미분류로 복원했습니다.`,
  notInTrash: '휴지통에 없는 항목입니다(이미 영구 삭제되었거나 다른 곳에서 복원되었습니다).',
  idTaken: (name: string) => `"${name}"과(와) 같은 항목이 이미 목록에 있어 복원하지 않았습니다.`,
  purged: (count: number) => `${count}개를 영구 삭제했습니다.`,
  emptied: (count: number) => `휴지통을 비웠습니다. (${count}개 영구 삭제)`,
  saveFailed: '저장하지 못해 이미지 파일은 지우지 않았습니다. 잠시 뒤 다시 시도해 주세요.',
  emptyExtra: '휴지통에 있는 항목 전부입니다. 이미지 파일도 함께 지워집니다.',
  purgeExtra: '이미지 파일도 함께 지워집니다(다른 항목이 쓰는 파일은 남깁니다).',
} as const;
