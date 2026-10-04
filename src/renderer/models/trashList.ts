// 휴지통 목록(프로젝트·씬) 표시·판정 순수 함수 — 2026-10-02 T1·S1·S2·S3.
//  · 목록은 개수 제한 없이 남아 있는 항목을 전부 보여 준다(자르기·최근 N개 금지). 스크롤은 모달 내용 영역이 맡는다.
//  · 정렬 = 최근 삭제 순. 삭제 시각을 모르는 항목(deletedAt 0·누락)은 맨 아래, 같은 시각이면 이름 순(안정).
//  · 이 파일은 의존성 없는 리프다(jest 단독 테스트 — __tests__/trashList.test.ts). 서비스·UI 모듈을 import 하지 말 것.

export interface TrashListEntry {
  name: string;
  deletedAt: number;
}

/** 최근 삭제 순으로 정렬한 새 배열(원본 불변). */
export function sortTrashNewestFirst<T extends TrashListEntry>(items: readonly T[]): T[] {
  const at = (t: T) => (Number.isFinite(t.deletedAt) && t.deletedAt > 0 ? t.deletedAt : -Infinity);
  return [...items].sort((a, b) => {
    const d = at(b) - at(a);
    if (d !== 0 && !Number.isNaN(d)) return d;
    return a.name.localeCompare(b.name);
  });
}

// ===== S1. 씬 휴지통 슬롯 이름 =====
// 씬을 휴지통에 넣을 때 기록 키(`프로젝트:슬롯`)·휴지통 폴더(.trash/<슬롯>)·마스크/원본 파일
// (.trash/<슬롯>.png)·sceneData.name 을 모두 같은 「슬롯 이름」으로 맞춘다. 슬롯은 원래 씬 이름이
// 비어 있으면 그대로, 이미 쓰이고 있으면 「이름 (삭제 2)」, 「(삭제 3)」… 중 비어 있는 첫 이름.
// 복원하면 씬 이름 = 슬롯 이름(사용자 결정 2026-10-02).

const TRASH_SLOT_SUFFIX_RE = /^(.*\S) \(삭제 (\d+)\)$/;

/**
 * 파일 이름 충돌 비교용 정규화. Windows·안드로이드 공용 저장소는 대소문자를 구분하지 않고,
 * Windows 는 끝의 점·공백을 버린다 — 「S」 와 「s」, 「S.」 는 같은 폴더가 된다.
 */
export function trashSlotCompareKey(name: string): string {
  return name.normalize('NFC').toLowerCase().replace(/[. ]+$/, '');
}

/**
 * 슬롯 이름 고르기. taken = 이미 쓰인 이름들(기록 키의 씬 이름·.trash 안의 폴더/파일 이름·
 * 현재 씬 이름 등). 비교는 trashSlotCompareKey 기준(대소문자·끝 점/공백 무시).
 * 원래 이름이 이미 「X (삭제 N)」 꼴이면 X 를 기준으로 번호를 붙인다(「X (삭제 2) (삭제 2)」 방지).
 */
export function pickTrashSlotName(name: string, taken: Iterable<string>): string {
  const set = new Set<string>();
  for (const t of taken) set.add(trashSlotCompareKey(t));
  if (!set.has(trashSlotCompareKey(name))) return name;
  const m = TRASH_SLOT_SUFFIX_RE.exec(name);
  const base = m ? m[1] : name;
  for (let n = 2; n < 100000; n++) {
    const candidate = `${base} (삭제 ${n})`;
    if (!set.has(trashSlotCompareKey(candidate))) return candidate;
  }
  throw new Error('휴지통에 넣을 씬 이름을 정하지 못했습니다.');
}

/**
 * 씬 휴지통 항목 표시: 원래 이름(base) + 보조 표기(suffix, 예 「(삭제 2)」).
 * 원래 이름 기록이 없거나(구버전 기록) 슬롯과 같으면 suffix 없음.
 */
export function sceneTrashLabel(entry: { name: string; originalName?: string }): {
  base: string;
  suffix: string;
} {
  const orig = entry.originalName;
  if (typeof orig === 'string' && orig && orig !== entry.name && entry.name.startsWith(orig)) {
    const suffix = entry.name.slice(orig.length).trim();
    if (suffix) return { base: orig, suffix };
  }
  return { base: entry.name, suffix: '' };
}

// ===== S2. 신 배치 프로젝트 휴지통 — 고유 폴더(id)로 동명 공존 =====

/**
 * 씬 휴지통 기록의 소속 판정. projectDir(신 배치 물리 폴더) 기록이 있으면 그것으로,
 * 없으면(구 배치·구버전 기록) 이름(키 접두)만으로 판정한다.
 *  - currentDir: 지금 그 이름으로 등록된(활성) 프로젝트의 물리 폴더. 구 배치·미등록이면 undefined.
 */
export function sceneTrashBelongsTo(
  entry: { projectDir?: string },
  currentDir: string | undefined,
): boolean {
  if (typeof entry.projectDir === 'string' && entry.projectDir) {
    return currentDir !== undefined && entry.projectDir === currentDir;
  }
  return true;
}

/**
 * 같은 이름 휴지통 프로젝트의 표시 번호. 휴지통 항목끼리만 비교해, 삭제 시각이 오래된
 * 것부터 첫 항목은 번호 없음, 다음부터 2, 3… (같은 시각이면 key 순으로 안정).
 * 반환: key → 번호(2 이상만 들어 있음).
 */
export function trashDuplicateOrdinals(
  items: readonly { key: string; name: string; deletedAt: number }[],
): Map<string, number> {
  const byName = new Map<string, { key: string; deletedAt: number }[]>();
  for (const it of items) {
    const list = byName.get(it.name) ?? [];
    list.push({ key: it.key, deletedAt: it.deletedAt });
    byName.set(it.name, list);
  }
  const at = (t: number) => (Number.isFinite(t) && t > 0 ? t : 0);
  const result = new Map<string, number>();
  for (const list of byName.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => at(a.deletedAt) - at(b.deletedAt) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    list.forEach((e, i) => {
      if (i > 0) result.set(e.key, i + 1);
    });
  }
  return result;
}

/** 표시 접미사 문자열(번호 2 이상만). 예: 2 → 「 (2)」 */
export function trashDuplicateSuffix(ordinal: number | undefined): string {
  return ordinal && ordinal >= 2 ? ` (${ordinal})` : '';
}

/**
 * 휴지통 프로젝트 복원 이름 계획. 같은 이름의 활성 프로젝트가 있으면 새 이름을 물어야 하고,
 * 기본값은 비어 있는 「이름 (2)」, 「(3)」… (활성 이름과 겹치지 않는 첫 이름).
 */
export function planProjectRestore(
  name: string,
  activeNames: readonly string[],
): { needsNewName: boolean; defaultName: string } {
  if (!activeNames.includes(name)) return { needsNewName: false, defaultName: name };
  const set = new Set(activeNames);
  for (let n = 2; n < 100000; n++) {
    const candidate = `${name} (${n})`;
    if (!set.has(candidate)) return { needsNewName: true, defaultName: candidate };
  }
  return { needsNewName: true, defaultName: name };
}

/**
 * 이름 지정 없이 프로젝트 휴지통 작업(영구 삭제 등)을 부를 때의 대상 선택:
 * 같은 이름 휴지통 폴더 중 삭제 시각이 가장 최근인 것(시각이 같으면 먼저 나온 것).
 */
export function pickNewestTrashDir(
  candidates: readonly { dir: string; deletedAt: number }[],
): string | undefined {
  let best: { dir: string; deletedAt: number } | undefined;
  for (const c of candidates) {
    const t = Number.isFinite(c.deletedAt) ? c.deletedAt : 0;
    if (!best || t > best.deletedAt) best = { dir: c.dir, deletedAt: t };
  }
  return best?.dir;
}

/**
 * 신 배치 .bak 자가치유 대상 판정. project.json 도 project.json.deleted(휴지통)도 없는 폴더만
 * 대상이다 — 휴지통 프로젝트 폴더(.deleted 있음)의 .bak 으로 활성 프로젝트를 되살리지 않는다.
 */
export function isWorkspaceBakHealCandidate(state: {
  hasJson: boolean;
  hasDeleted: boolean;
}): boolean {
  return !state.hasJson && !state.hasDeleted;
}

// ===== S3. 보존 기간 안내 =====

export function trashRetentionNotice(
  kind: 'scene' | 'project' | 'image',
  days: { image: number; scene: number; project: number },
): string {
  // 이미지 휴지통 탭·검수 휴지통 보기(2026-10-03 E1-5)
  if (kind === 'image') {
    return `이미지는 ${days.image}일이 지나면 자동으로 영구 삭제됩니다.`;
  }
  if (kind === 'scene') {
    return `씬은 ${days.scene}일, 이미지는 ${days.image}일이 지나면 자동으로 영구 삭제됩니다.`;
  }
  return `프로젝트는 ${days.project}일이 지나면 앱을 켤 때 영구 삭제할지 묻습니다(묻기 전에는 지우지 않습니다).`;
}
