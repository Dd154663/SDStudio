import type { WordTag } from './Tags';
import { PROMPT_WEIGHT_NUMBER_SOURCE } from './promptWeightSyntax';

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
