/**
 * 「이 칸에서 찾기·바꾸기」의 순수 규칙(2026-11-22). 프롬프트 칸 하나의 글자 안에서만 찾고 바꾼다.
 * PC 검색 줄(componenets/PromptFindBar.tsx)과 모바일 키보드 위 칩의 찾기 모드가 같은 함수를 쓴다.
 *
 *  · 일치 = 글자 그대로의 부분 일치, 앞에서부터 겹치지 않게. 주석(##…##) 안의 글자도 찾는다.
 *  · 대소문자를 가리지 않을 때도 **길이가 바뀌지 않는 비교**(글자마다 소문자로 바꾸되 길이가 달라지는 글자는 그대로)를
 *    써서 일치 오프셋이 원문과 어긋나지 않는다(`toLocaleLowerCase` 를 통째로 쓰면 İ 같은 글자에서 길이가 바뀐다).
 *  · 바꾸기는 원문에서 계산한 일치만 한 번 훑어 바꾼다 — 바꾼 결과 안에서 다시 찾지 않는다.
 */

export interface PromptFindMatch {
  start: number;
  end: number;
}

export interface PromptFindEditResult {
  text: string;
  /** 바꾼 뒤 둘 캐럿(바꾼 글자 범위). */
  caret: [number, number];
  /** 다음 「현재 자리」를 고를 기준 — 이 위치 이상에서 시작하는 첫 일치. */
  resumeFrom: number;
  /** 바꾼 개수. */
  count: number;
}

/** 검색 편집기 쪽 손잡이 — PC 편집기(EmulatedEditTextArea)와 모바일 편집기(NativeEditTextArea)가 같은 모양으로 낸다. */
export interface PromptFindTarget {
  /** 지금 편집기의 글자(값). */
  getText(): string;
  /** 편집기의 선택 범위(오프셋). 편집기에 선택이 없으면 마지막으로 알던 위치, 그것도 없으면 [0, 0]. */
  getSelection(): [number, number];
  /** 읽기 전용(비활성) 칸이면 true — 찾기만 된다. */
  isReadOnly(): boolean;
  /**
   * 편집기 지금 글자로 compute 를 돌려 그 결과를 한 번의 편집기 기록으로 적용한다. 포커스는 옮기지 않는다.
   * 바뀐 것이 없으면(null 또는 같은 글자) 아무것도 하지 않고 null. 적용했으면 새 글자.
   */
  applyFindEdit(
    compute: (text: string) => PromptFindEditResult | null,
  ): Promise<string | null> | string | null;
  /** 일치 표시를 칠할 글자 층(색칠된 DOM). */
  getHighlightRoot(): HTMLElement | null;
  /** 편집기 안쪽 스크롤 칸. */
  getScrollContainer(): HTMLElement | null;
  /** 편집기로 포커스를 돌리고 범위를 고른다. */
  focusAt(start: number, end: number): void;
}

/** 찾는 말을 미리 채울 수 있는 선택 글자의 최대 길이. */
export const PROMPT_FIND_PREFILL_MAX = 100;

/** 글자마다 소문자로 — 길이가 달라지는 글자는 원래 글자 그대로(오프셋 보존). */
export function foldPromptFindCase(s: string): string {
  let out = '';
  for (const ch of s) {
    const lower = ch.toLowerCase();
    out += lower.length === ch.length ? lower : ch;
  }
  return out;
}

export function findPromptMatches(
  text: string,
  query: string,
  caseSensitive: boolean,
): PromptFindMatch[] {
  if (!query || !text) return [];
  const hay = caseSensitive ? text : foldPromptFindCase(text);
  const needle = caseSensitive ? query : foldPromptFindCase(query);
  const out: PromptFindMatch[] = [];
  let from = 0;
  while (from <= hay.length - needle.length) {
    const i = hay.indexOf(needle, from);
    if (i < 0) break;
    out.push({ start: i, end: i + needle.length });
    from = i + needle.length;
  }
  return out;
}

/** anchor 이상에서 시작하는 첫 일치의 번호. 없으면 처음(0)으로 돈다. 일치가 없으면 -1. */
export function pickPromptMatchIndex(
  matches: readonly PromptFindMatch[],
  anchor: number,
): number {
  if (matches.length === 0) return -1;
  const i = matches.findIndex((m) => m.start >= anchor);
  return i < 0 ? 0 : i;
}

/** 다음(dir=1)·이전(dir=-1) 번호 — 끝에서 처음으로 돈다. */
export function stepPromptMatchIndex(
  index: number,
  count: number,
  dir: 1 | -1,
): number {
  if (count <= 0) return -1;
  if (index < 0) return dir > 0 ? 0 : count - 1;
  return (index + dir + count) % count;
}

/** 「현재 / 전체」 표시 글. 찾는 말이 비면 빈 글, 없으면 「없음」. */
export function promptFindCountLabel(
  query: string,
  index: number,
  count: number,
): string {
  if (!query) return '';
  if (count === 0) return '없음';
  return `${index + 1} / ${count}`;
}

/**
 * 선택 글자를 찾는 말로 넣을지 — 한 줄이고 PROMPT_FIND_PREFILL_MAX 자 이하일 때만 그 글자, 아니면 ''.
 */
export function promptFindPrefill(
  text: string,
  start: number,
  end: number,
): string {
  if (end <= start) return '';
  const sel = text.slice(start, end);
  if (!sel || sel.length > PROMPT_FIND_PREFILL_MAX || /[\r\n]/.test(sel)) return '';
  return sel;
}

/**
 * start 에서 시작하는 일치 하나를 바꾼다(지금 글자에서 다시 찾아 그 자리가 여전히 일치일 때만).
 * 바꿀 말이 비면 지우기.
 */
export function replacePromptMatchAt(
  text: string,
  query: string,
  caseSensitive: boolean,
  start: number,
  replacement: string,
): PromptFindEditResult | null {
  const m = findPromptMatches(text, query, caseSensitive).find(
    (x) => x.start === start,
  );
  if (!m) return null;
  const next = text.slice(0, m.start) + replacement + text.slice(m.end);
  const end = m.start + replacement.length;
  return { text: next, caret: [m.start, end], resumeFrom: end, count: 1 };
}

/** 모든 일치를 한 번에(뒤에서부터) 바꾼다. 일치가 없으면 null. */
export function replaceAllPromptMatches(
  text: string,
  query: string,
  caseSensitive: boolean,
  replacement: string,
): PromptFindEditResult | null {
  const matches = findPromptMatches(text, query, caseSensitive);
  if (matches.length === 0) return null;
  let next = text;
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    next = next.slice(0, m.start) + replacement + next.slice(m.end);
  }
  const first = matches[0].start;
  return {
    text: next,
    caret: [first, first + replacement.length],
    resumeFrom: first + replacement.length,
    count: matches.length,
  };
}
