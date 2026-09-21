// 선택형 대화상자(select)의 폴더 묶음(2026-09-21). 항목에 group 이 있으면 같은 이름끼리 접이식 폴더로 묶는다.
// 접힘 상태는 localStorage 에 대화상자별 키(foldKey)로 저장해 앱을 다시 켜도 유지된다
// (프롬프트 구역 접기 PROMPT_FOLD_LS_KEY 와 같은 방식 — 기기별 UI 취향이라 config 가 아니라 localStorage).
export interface GroupableItem {
  text: string;
  value: string;
  group?: string;
}

export type SelectSection<T extends GroupableItem> =
  | { kind: 'group'; name: string; items: T[] }
  | { kind: 'item'; item: T };

/** 첫 등장 순서를 지키며 묶는다. group 이 없는 항목은 그 자리에 낱개로 남는다. */
export function sectionsOf<T extends GroupableItem>(items: T[]): SelectSection<T>[] {
  const out: SelectSection<T>[] = [];
  const byName = new Map<string, { kind: 'group'; name: string; items: T[] }>();
  for (const item of items) {
    if (!item.group) {
      out.push({ kind: 'item', item });
      continue;
    }
    let sec = byName.get(item.group);
    if (!sec) {
      sec = { kind: 'group', name: item.group, items: [] };
      byName.set(item.group, sec);
      out.push(sec);
    }
    sec.items.push(item);
  }
  return out;
}

const LS_PREFIX = 'selectDialogFold:';

/** 펼쳐진 폴더 이름 목록. 저장값이 없거나 깨졌으면 빈 목록(전부 접힘). */
export function loadOpenGroups(foldKey: string): Set<string> {
  try {
    const raw = localStorage.getItem(LS_PREFIX + foldKey);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : []);
  } catch (e) {
    return new Set();
  }
}

export function saveOpenGroups(foldKey: string, open: ReadonlySet<string>) {
  try {
    localStorage.setItem(LS_PREFIX + foldKey, JSON.stringify([...open]));
  } catch (e) {
    // 저장 실패는 무시(다음에 접힌 채로 열릴 뿐)
  }
}

/** 폴더 제목 아래에 보여줄 내용 미리보기: 이모지·앞뒤 공백을 뺀 항목 이름을 가운뎃점으로 잇는다. */
export function groupPreview(items: GroupableItem[]): string {
  return items
    .map((x) => x.text.replace(/^[^\p{L}\p{N}]+/u, '').trim())
    .join(' · ');
}
