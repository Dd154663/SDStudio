import type { WordTag } from './Tags';
import { PROMPT_WEIGHT_NUMBER_SOURCE } from './promptWeightSyntax';
import { promptCommentBoundsAt } from './promptCommentSyntax';

/** 맨 앞 여는 가중치 N::(.6:: 처럼 0 생략 포함)와 뒤 공백 — 숫자 표기는 promptWeightSyntax 단일 출처. */
const LEADING_WEIGHT_RE = new RegExp(`^${PROMPT_WEIGHT_NUMBER_SOURCE}::\\s*`);

/** Danbooru 태그 DB의 작가 카테고리. */
export const ARTIST_TAG_CATEGORY = 1;

function unwrapAutocompleteStart(word: string): string {
  return word
    .trim()
    .replace(LEADING_WEIGHT_RE, '')
    .replace(/^[{\[]*\s*/, '');
}

/** 현재 쉼표 구획이 NAI 공식 artist: 문법인지 판별한다. */
export function autocompleteTagCategory(word: string): number | undefined {
  return /^artist\s*:/i.test(unwrapAutocompleteStart(word))
    ? ARTIST_TAG_CATEGORY
    : undefined;
}

/** 태그 DB에 넘길 실제 검색어만 남기되 입력 쪽 장식은 보존하지 않는다. */
export function trimAutocompleteWord(word: string): string {
  return word
    .trim()
    .replace(LEADING_WEIGHT_RE, '')
    .replace(/::$/, '')
    .replace(/^[{\[]*\s*(?:artist\s*:\s*)?/i, '')
    .replace(/[}\]]*$/, '')
    .trim();
}

/** 테스트와 비네이티브 호출부에서 동일한 카테고리 계약을 재사용한다. */
export function filterTagsByCategory(
  tags: WordTag[],
  category?: number,
): WordTag[] {
  if (category === undefined) return tags;
  return tags.filter((tag) => tag.category === category);
}

/** 자동완성이 보는 「현재 단어」의 범위(편집기 두 벌 — PC EmulatedEditTextArea·모바일 NativeEditTextArea 공용). */
export interface AutocompleteWordRange {
  /** 교체 시작(구획 시작 = 쉼표·줄바꿈·주석 경계 바로 뒤). */
  start: number;
  /** 교체 끝(기본 모드 = 커서, 전체 단어 모드 = 구획 끝). */
  end: number;
  /** 교체 글자 앞에 붙일 공백(종전 규칙: 글 맨 앞·줄 맨 앞·주석 안 여는 `##` 바로 뒤가 아니면 ' '). */
  prefix: '' | ' ';
}

const isWordBreak = (c: string) => c === ',' || c === '\n';

/**
 * 커서 위치의 자동완성 단어 범위(2026-11-21). 단어 경계 = 쉼표·줄바꿈 + ##주석## 경계
 * (경계 규칙은 가중치 구획과 같은 promptCommentBoundsAt).
 * - 커서가 주석 밖이면 앞뒤 주석에서 끊고, 주석 안이면 그 주석 내용 안에서만 구획을 찾는다.
 * - 커서가 `##` 두 글자 사이면 undefined(검색어 없음·교체 안 함).
 * - 범위가 주석 경계(여는 `##` 앞, 주석 안의 닫는 `##` 앞)에서 끝나면 그 앞 공백은 범위에서 뺀다(지우지 않음).
 * - 주석이 없는 글은 종전 「커서에서 쉼표·줄바꿈까지」와 같다.
 */
export function autocompleteWordRangeAt(
  text: string,
  caret: number,
  fullWord: boolean,
): AutocompleteWordRange | undefined {
  const pos = Math.max(0, Math.min(caret, text.length));
  const bounds = promptCommentBoundsAt(text, pos);
  if (!bounds) return undefined;
  const { lo, hi, inComment } = bounds;
  let start = pos;
  while (start > lo && !isWordBreak(text[start - 1])) start--;
  let end = pos;
  if (fullWord) {
    while (end < hi && !isWordBreak(text[end])) end++;
  }
  // hi < text.length 이면 hi 는 주석 경계(밖이면 다음 주석의 여는 ##, 안이면 닫는 ##).
  if (end === hi && hi < text.length) {
    while (end > start && /\s/.test(text[end - 1])) end--;
  }
  const prefix =
    start === 0 || text[start - 1] === '\n' || (inComment && start === lo)
      ? ''
      : ' ';
  return { start, end, prefix };
}

/** 자동완성 검색어(앞뒤 공백 제외). 커서가 `##` 두 글자 사이면 ''. */
export function autocompleteWordAt(
  text: string,
  caret: number,
  fullWord: boolean,
): string {
  const range = autocompleteWordRangeAt(text, caret, fullWord);
  return range ? text.substring(range.start, range.end).trim() : '';
}

/**
 * 고른 자동완성 단어로 현재 단어를 바꾼 결과. caret = 바꾼 단어 바로 뒤.
 * 커서가 `##` 두 글자 사이면 undefined(아무것도 하지 않음).
 */
export function replaceAutocompleteWordAt(
  text: string,
  caret: number,
  word: string,
  fullWord: boolean,
): { text: string; start: number; caret: number } | undefined {
  const range = autocompleteWordRangeAt(text, caret, fullWord);
  if (!range) return undefined;
  const insert = range.prefix + word;
  return {
    text: text.substring(0, range.start) + insert + text.substring(range.end),
    start: range.start,
    caret: range.start + insert.length,
  };
}
