// 작가 태그(artist:) 단일 출처 — SPEC_GUIDE 「작가 태그 접두(artist:) 계약」.
//  · 쉼표 구획 하나를 [앞 공백][가중치 접두 N::][괄호 {[ ][핵심][괄호 ]}][가중치 접미 ::][뒤 공백] 으로 나눈다.
//  · "작가인가" 판별은 두 갈래: ①핵심이 artist: 접두를 가짐 ②접두가 없어도 태그 DB(카테고리 1=작가)에 있는 단어.
//  · 일괄 추가/제거는 핵심만 바꾸고 가중치·괄호·공백은 그대로 둔다. 조각(<이름>)·랜덤({a|b})·빈 구획은 건드리지 않는다.

/** Danbooru 태그 DB의 작가 카테고리(promptAutocomplete.ts 의 ARTIST_TAG_CATEGORY 와 같은 값). */
export const ARTIST_CATEGORY = 1;

const ARTIST_PREFIX_RE = /^artist\s*:\s*/i;
const WEIGHT_RE = /^(-?\d+(?:\.\d+)?::)([\s\S]*?)(::)$/;

export interface PromptSegmentParts {
  leading: string;
  weightPrefix: string;
  open: string;
  core: string;
  close: string;
  weightSuffix: string;
  trailing: string;
}

/** 쉼표 구획 하나를 장식과 핵심으로 나눈다. joinPromptSegment 로 되돌리면 원문과 같다. */
export function parsePromptSegment(segment: string): PromptSegmentParts {
  const leading = segment.match(/^\s*/)?.[0] ?? '';
  const rest = segment.slice(leading.length); // 공백뿐인 구획에서 앞·뒤 공백이 겹치지 않게 앞 공백을 뗀 뒤 잰다
  const trailing = rest.match(/\s*$/)?.[0] ?? '';
  let body = rest.slice(0, rest.length - trailing.length);
  let weightPrefix = '';
  let weightSuffix = '';
  const weighted = body.match(WEIGHT_RE);
  if (weighted) {
    weightPrefix = weighted[1];
    body = weighted[2];
    weightSuffix = weighted[3];
  }
  const open = body.match(/^[{[]*/)?.[0] ?? '';
  const close = body.match(/[}\]]*$/)?.[0] ?? '';
  const core = body.slice(open.length, body.length - close.length);
  return { leading, weightPrefix, open, core, close, weightSuffix, trailing };
}

/** 커서 위치(caret)가 놓인 쉼표 구획의 원문(장식 포함). 줄바꿈도 구획 경계로 본다. */
export function promptSegmentAt(text: string, caret: number): string {
  const c = Math.max(0, Math.min(text.length, caret));
  let start = c;
  while (start > 0 && !',\n'.includes(text[start - 1])) start -= 1;
  let end = c;
  while (end < text.length && !',\n'.includes(text[end])) end += 1;
  return text.slice(start, end);
}

export function joinPromptSegment(p: PromptSegmentParts): string {
  return p.leading + p.weightPrefix + p.open + p.core + p.close + p.weightSuffix + p.trailing;
}

export function hasArtistPrefix(core: string): boolean {
  return ARTIST_PREFIX_RE.test(core.trim());
}

/** artist: 접두를 뗀 이름(공백 정리). 접두가 없으면 그대로. */
export function stripArtistPrefix(core: string): string {
  return core.trim().replace(ARTIST_PREFIX_RE, '');
}

/** 일괄 변환 대상이 될 수 있는 핵심인가 — 빈 구획·프롬프트 조각(<…>)·랜덤(a|b)은 제외. */
export function isTransformableCore(core: string): boolean {
  const t = core.trim();
  if (!t) return false;
  if (t.includes('<') || t.includes('>')) return false;
  if (t.includes('|')) return false;
  return true;
}

/** 단어가 작가 태그인지(태그 DB 기준) 답하는 조회. 결과는 호출자가 캐시한다. */
export type ArtistLookup = (word: string) => Promise<boolean>;

/**
 * backend.lookupTag 을 작가 판별로 감싼다. DB 단어 표기가 공백/밑줄 어느 쪽이든 맞도록 원문·밑줄·공백 순으로 찾는다.
 * 같은 단어는 한 번만 조회한다(한 프롬프트 안에 같은 작가가 여러 칸에 있을 수 있음).
 */
export function makeArtistLookup(
  lookupTag: (word: string) => Promise<{ category?: number } | undefined | null>,
): ArtistLookup {
  const cache = new Map<string, boolean>();
  return async (word: string) => {
    const key = word.trim().toLowerCase();
    if (!key) return false;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const candidates = Array.from(new Set([key, key.replace(/\s+/g, '_'), key.replace(/_/g, ' ')]));
    let found = false;
    for (const c of candidates) {
      let tag: { category?: number } | undefined | null;
      try {
        tag = await lookupTag(c);
      } catch (e) {
        tag = undefined;
      }
      if (tag && tag.category === ARTIST_CATEGORY) {
        found = true;
        break;
      }
    }
    cache.set(key, found);
    return found;
  };
}

/** 구획이 작가인가: artist: 접두가 있으면 바로, 없으면 태그 DB 로 판별. */
export async function isArtistCore(core: string, lookup: ArtistLookup): Promise<boolean> {
  if (!isTransformableCore(core)) return false;
  if (hasArtistPrefix(core)) return true;
  return lookup(core.trim());
}

/** add=접두 없는 작가에 붙임, remove=접두 뗌, toggle=구획마다 반전(있으면 뗌, 없는 작가엔 붙임 — 섞여 있어도 한쪽으로 몰지 않음). */
/**
 * artist: 접두가 달린 구획을 전부 뺀 프롬프트(작가 라이브러리 샘플 생성용 — 대상 작가만 남기기 전에 쓴다, 2026-09-26).
 * 접두 없는 작가(DB 판별)는 건드리지 않는다(작가 분해와 같은 기준: 접두가 곧 의도). 빈 구획은 정리한다.
 */
export function removeArtistSegments(text: string): string {
  return text
    .split(',')
    .filter((segment) => {
      const core = parsePromptSegment(segment).core;
      return !(isTransformableCore(core) && hasArtistPrefix(core));
    })
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join(', ');
}

/** 프롬프트에 그 작가(접두 유무 무관, 대소문자 무시)가 이미 있는가. */
export function hasArtistNamed(text: string, name: string): boolean {
  const key = name.trim().toLowerCase();
  return text.split(',').some((segment) => {
    const core = parsePromptSegment(segment).core;
    return stripArtistPrefix(core).toLowerCase() === key;
  });
}

export type ArtistPrefixMode = 'add' | 'remove' | 'toggle';

export interface ArtistPrefixResult {
  text: string;
  /** 실제로 바뀐 구획 수(= added + removed) */
  changed: number;
  /** 접두를 붙인 구획 수 */
  added: number;
  /** 접두를 뗀 구획 수 */
  removed: number;
  /** 작가로 판별된 구획 수(안 바뀐 것 포함) */
  artists: number;
}

/**
 * 프롬프트 한 칸의 작가 구획 전부에 artist: 접두를 붙이거나(add) 떼거나(remove) 반전한다(toggle).
 *  · 붙이기는 접두 없는 작가 태그(DB 판별)에만. 떼기는 접두가 있는 구획에만(DB 조회 없음 — 접두가 곧 의도).
 *  · toggle 은 사용자 결정(2026-09-26): 버튼 하나로, 달린 것은 떼고 안 달린 작가에는 붙인다.
 */
export async function transformArtistPrefix(
  text: string,
  mode: ArtistPrefixMode,
  lookup: ArtistLookup,
): Promise<ArtistPrefixResult> {
  const segments = text.split(',');
  let added = 0;
  let removed = 0;
  let artists = 0;
  const out: string[] = [];
  for (const segment of segments) {
    const parts = parsePromptSegment(segment);
    if (!isTransformableCore(parts.core)) {
      out.push(segment);
      continue;
    }
    const prefixed = hasArtistPrefix(parts.core);
    if (prefixed) {
      artists += 1;
      if (mode === 'add') {
        out.push(segment);
      } else {
        const next = stripArtistPrefix(parts.core);
        if (next !== parts.core) removed += 1;
        out.push(joinPromptSegment({ ...parts, core: next }));
      }
      continue;
    }
    if (mode === 'remove') {
      out.push(segment);
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const isArtist = await lookup(parts.core.trim());
    if (!isArtist) {
      out.push(segment);
      continue;
    }
    artists += 1;
    added += 1;
    out.push(joinPromptSegment({ ...parts, core: 'artist:' + parts.core.trim() }));
  }
  return { text: out.join(','), changed: added + removed, added, removed, artists };
}
