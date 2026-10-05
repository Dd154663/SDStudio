// 작가 태그(artist:) 단일 출처 — SPEC_GUIDE 「작가 태그 접두(artist:) 계약」.
//  · 쉼표 구획 하나를 [앞 공백][가중치 접두 N::][괄호 {[ ][핵심][괄호 ]}][가중치 접미 ::][뒤 공백] 으로 나눈다.
//    가중치 묶음(N::a, b::)의 첫·마지막 태그처럼 여는 쪽·닫는 쪽만 있는 구획도 각각 벗긴다(2026-10-02).
//  · "작가인가" 판별은 두 갈래: ①핵심이 artist: 접두를 가짐 ②접두가 없어도 작가 라이브러리 이름이거나 태그 DB(카테고리 1=작가)에 있는 단어.
//  · 구획 → 핵심 이름 정규화는 artistNameOfSegment 하나(가중치·괄호·공백·접두를 벗김). 구획 경계는 쉼표와 줄바꿈(2026-10-05).
//  · 일괄 추가/제거는 핵심만 바꾸고 가중치·괄호·공백은 그대로 둔다. 조각(<이름>)·랜덤({a|b})·빈 구획은 건드리지 않는다.

import { PROMPT_WEIGHT_NUMBER_SOURCE } from './promptWeightSyntax';

/** Danbooru 태그 DB의 작가 카테고리(promptAutocomplete.ts 의 ARTIST_TAG_CATEGORY 와 같은 값). */
export const ARTIST_CATEGORY = 1;

const ARTIST_PREFIX_RE = /^artist\s*:\s*/i;
/** 구획 앞쪽 장식 토큰 하나: 괄호 `{` `[` 또는 여는 가중치 `N::`(.6:: 처럼 0 생략 포함) + 뒤 공백. */
const OPEN_DECOR_TOKEN_RE = new RegExp(`^(?:[{[]|${PROMPT_WEIGHT_NUMBER_SOURCE}::)\\s*`);
/** 구획 뒤쪽 장식 토큰 하나: 앞 공백 + 괄호 `}` `]` 또는 닫는 가중치 `::`. */
const CLOSE_DECOR_TOKEN_RE = /\s*(?:[}\]]|::)$/;

export interface PromptSegmentParts {
  leading: string;
  /** 여는 가중치 `N::` 까지의 앞 장식(가중치 바깥 괄호가 있으면 함께). 가중치가 없으면 ''. */
  weightPrefix: string;
  /** 핵심 바로 앞 괄호(와 공백). */
  open: string;
  core: string;
  /** 핵심 바로 뒤 괄호(와 공백). */
  close: string;
  /** 닫는 가중치 `::` 부터의 뒤 장식(가중치 바깥 괄호가 있으면 함께). 가중치가 없으면 ''. */
  weightSuffix: string;
  trailing: string;
}

/**
 * 쉼표 구획 하나를 장식과 핵심으로 나눈다. joinPromptSegment 로 되돌리면 원문과 같다.
 * NAI 가중치 묶음 `N::a, b, c::` 는 쉼표로 쪼개면 여는 `N::` 와 닫는 `::` 가 서로 다른 구획에 놓인다
 * (첫 태그=여는 쪽만, 마지막 태그=닫는 쪽만). 그래서 앞·뒤 장식을 각각 따로 벗긴다(2026-10-02 B3 수정 —
 * 예전에는 한 구획에 둘 다 있을 때만 벗겨 `artist:bbb::` 가 이름으로 나왔다).
 */
export function parsePromptSegment(segment: string): PromptSegmentParts {
  const leading = segment.match(/^\s*/)?.[0] ?? '';
  const rest = segment.slice(leading.length); // 공백뿐인 구획에서 앞·뒤 공백이 겹치지 않게 앞 공백을 뗀 뒤 잰다
  const trailing = rest.match(/\s*$/)?.[0] ?? '';
  const body = rest.slice(0, rest.length - trailing.length);
  // 앞 장식: 괄호·여는 가중치 토큰을 차례로 벗긴다. 마지막 가중치 토큰까지가 weightPrefix, 그 뒤 괄호가 open.
  let pre = '';
  let weightPrefixLen = 0;
  for (;;) {
    const m = body.slice(pre.length).match(OPEN_DECOR_TOKEN_RE);
    if (!m || !m[0]) break;
    pre += m[0];
    if (m[0][0] !== '{' && m[0][0] !== '[') weightPrefixLen = pre.length;
  }
  // 뒤 장식: 남은 부분 끝에서 괄호·닫는 가중치 토큰을 벗긴다. 가장 왼쪽 :: 부터가 weightSuffix, 그 앞 괄호가 close.
  const afterPre = body.slice(pre.length);
  let post = '';
  let weightSuffixLen = 0;
  for (;;) {
    const m = afterPre.slice(0, afterPre.length - post.length).match(CLOSE_DECOR_TOKEN_RE);
    if (!m || !m[0]) break;
    post = m[0] + post;
    if (m[0].trim() === '::') weightSuffixLen = post.length;
  }
  return {
    leading,
    weightPrefix: pre.slice(0, weightPrefixLen),
    open: pre.slice(weightPrefixLen),
    core: afterPre.slice(0, afterPre.length - post.length),
    close: post.slice(0, post.length - weightSuffixLen),
    weightSuffix: post.slice(post.length - weightSuffixLen),
    trailing,
  };
}

type DecorKind = '{' | '[' | 'w';

/** 장식 문자열을 토큰(공백 제거)과 종류로 나눈다. 여는 쪽은 바깥→안, 닫는 쪽은 안→바깥 순서. */
function decorTokens(decor: string, side: 'open' | 'close'): { text: string; kind: DecorKind }[] {
  const out: { text: string; kind: DecorKind }[] = [];
  let rest = decor.trim();
  while (rest) {
    if (side === 'open') {
      const m = rest.match(OPEN_DECOR_TOKEN_RE);
      if (!m || !m[0]) break;
      const text = m[0].trim();
      out.push({ text, kind: text === '{' ? '{' : text === '[' ? '[' : 'w' });
      rest = rest.slice(m[0].length).trim();
    } else {
      const m = rest.match(/^\s*(?:[}\]]|::)/);
      if (!m) break;
      const text = m[0].trim();
      out.push({ text, kind: text === '}' ? '{' : text === ']' ? '[' : 'w' });
      rest = rest.slice(m[0].length).trim();
    }
  }
  return out;
}

/**
 * 구획 안에서 짝이 맞지 않는 장식 — 묶음의 첫·마지막 태그가 가진 여는 `N::`/`{`/`[`, 닫는 `::`/`}`/`]`.
 * 안쪽부터 같은 종류끼리 짝지어 상쇄하고 남은 바깥쪽만 돌려준다.
 */
function unbalancedDecor(parts: PromptSegmentParts) {
  const opens = decorTokens(parts.weightPrefix + parts.open, 'open');
  const closes = decorTokens(parts.close + parts.weightSuffix, 'close');
  let i = opens.length - 1;
  let j = 0;
  while (i >= 0 && j < closes.length && opens[i].kind === closes[j].kind) {
    i -= 1;
    j += 1;
  }
  return { opens: opens.slice(0, i + 1), closes: closes.slice(j) };
}

/**
 * 조건에 맞는 쉼표 구획을 빼되 가중치 묶음·괄호의 짝은 보존한다(2026-10-02).
 *  · 뺀 구획이 묶음을 여는 쪽이면(`1.5::artist:a`) 그 `1.5::` 를 다음에 남는 구획 앞으로 넘긴다.
 *  · 뺀 구획이 묶음을 닫는 쪽이면(`artist:b::`) 넘겨받은 여는 장식과 상쇄하고, 없으면 앞에 남은 구획 뒤에 붙인다.
 *  · 결과는 남은 구획을 trim 해 ', '(사이에 줄바꿈이 있었으면 줄바꿈)로 잇는다(빈 구획 정리). 끝까지 닫히지 않은 여는 장식은 버린다.
 *  · index 는 splitPromptSegments(쉼표·줄바꿈 경계) 기준 구획 번호.
 */
export function removePromptSegmentsKeepingGroups(
  text: string,
  shouldRemove: (parts: PromptSegmentParts, index: number) => boolean,
): string {
  const out: string[] = [];
  let pending: { text: string; kind: DecorKind }[] = [];
  // 구획 경계는 쉼표·줄바꿈. 남는 구획 사이에 줄바꿈이 있었으면 줄바꿈으로 되살린다(줄 없는 프롬프트는 예전처럼 ', ').
  let sepComma = false;
  let sepNewline = false;
  text.split(/([,\n])/).forEach((token, i) => {
    if (i % 2 === 1) {
      if (token === '\n') sepNewline = true;
      else sepComma = true;
      return;
    }
    const segment = token;
    const index = i / 2;
    const parts = parsePromptSegment(segment);
    if (!shouldRemove(parts, index)) {
      const kept = segment.trim();
      if (!kept) return;
      const joiner = out.length === 0 ? '' : sepNewline ? (sepComma ? ',\n' : '\n') : ', ';
      out.push(joiner + pending.map((t) => t.text).join('') + kept);
      pending = [];
      sepComma = false;
      sepNewline = false;
      return;
    }
    const { opens, closes } = unbalancedDecor(parts);
    for (const c of closes) {
      if (pending.length > 0 && pending[pending.length - 1].kind === c.kind) {
        pending.pop();
      } else if (out.length > 0) {
        out[out.length - 1] += c.text;
      }
    }
    pending = pending.concat(opens);
  });
  return out.join('');
}

/** 프롬프트를 구획으로 나눈다 — 경계는 쉼표와 줄바꿈(promptSegmentAt·생성 경로 toPARR 와 같은 기준, 2026-10-05). */
export function splitPromptSegments(text: string): string[] {
  return text.split(/[,\n]/);
}

export interface ArtistSegmentName {
  /** 핵심 이름 — 가중치(N::·.6::·N1 공백 형태·묶음 첫/끝 태그)·괄호({{ }}·[ ])·앞뒤 공백·artist: 접두를 벗긴 것. */
  name: string;
  /** 원문 핵심에 artist: 접두가 있었는가. */
  prefixed: boolean;
  parts: PromptSegmentParts;
}

/**
 * 구획 → 핵심 이름 정규화 단일 출처(2026-10-05). 편집기 작가 버튼·접두 전환·작가 분해·샘플 생성·이름 존재 판정이 함께 쓴다.
 * 조각(<…>)·랜덤(a|b)·빈 구획은 undefined. 작가인지는 정하지 않는다 — 접두가 없으면 name 을 ArtistLookup 으로 대조한다.
 */
export function artistNameOfSegment(segment: string): ArtistSegmentName | undefined {
  const parts = parsePromptSegment(segment);
  if (!isTransformableCore(parts.core)) return undefined;
  const prefixed = hasArtistPrefix(parts.core);
  const name = (prefixed ? stripArtistPrefix(parts.core) : parts.core).trim();
  if (!name) return undefined;
  return { name, prefixed, parts };
}

/**
 * 커서 구획 등 쉼표 구획 하나에서 artist: 접두가 달린 작가 이름(접두·가중치·괄호 제거)을 뽑는다. 없으면 undefined.
 * 접두 없는 작가는 artistNameOfSegment(...).name 을 ArtistLookup 으로 대조한다.
 */
export function prefixedArtistNameOfSegment(segment: string): string | undefined {
  const n = artistNameOfSegment(segment);
  return n && n.prefixed ? n.name : undefined;
}

/**
 * 동기 경로(작가 분해·샘플 생성)용: 여러 칸에서 접두 없는 후보 이름을 모아 lookup 으로 미리 판별한다.
 * 반환 함수는 이름(대소문자 무시)이 작가인지 답한다. 접두 있는 구획은 호출자가 prefixed 로 이미 안다.
 */
export async function resolveUnprefixedArtistNames(
  texts: string[],
  lookup: ArtistLookup,
): Promise<(name: string) => boolean> {
  const known = new Set<string>();
  const seen = new Set<string>();
  for (const text of texts) {
    for (const segment of splitPromptSegments(text)) {
      const n = artistNameOfSegment(segment);
      if (!n || n.prefixed) continue;
      const key = n.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      // eslint-disable-next-line no-await-in-loop
      if (await lookup(n.name)) known.add(key);
    }
  }
  return (name: string) => known.has(name.trim().toLowerCase());
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

/** 핵심 이름(artistNameOfSegment 의 name)이 작가인지 답하는 조회. */
export type ArtistLookup = (word: string) => Promise<boolean>;

/**
 * 접두 없는 작가 판별: ①작가 라이브러리 이름(libraryHas — findArtistByName 규칙: 대소문자·연속 공백 무시)
 * ②태그 DB 카테고리 1(backend.lookupTag). 두 쪽 모두 원문·밑줄·공백 표기를 차례로 시도한다(2026-10-05 ① 추가 —
 * 태그 DB 에 없는 작가도 라이브러리에 있으면 인식). 라이브러리는 바뀔 수 있어 매번 보고, 태그 DB 결과만 단어별로 캐시한다.
 */
export function makeArtistLookup(
  lookupTag: (word: string) => Promise<{ category?: number } | undefined | null>,
  libraryHas?: (name: string) => boolean,
): ArtistLookup {
  const cache = new Map<string, boolean>();
  return async (word: string) => {
    const key = word.trim().toLowerCase();
    if (!key) return false;
    const candidates = Array.from(new Set([key, key.replace(/\s+/g, '_'), key.replace(/_/g, ' ')]));
    if (libraryHas && candidates.some((c) => libraryHas(c))) return true;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
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

/** 구획이 작가인가: artist: 접두가 있으면 바로, 없으면 핵심 이름을 lookup(라이브러리·태그 DB)으로 판별. */
export async function isArtistSegment(segment: string, lookup: ArtistLookup): Promise<boolean> {
  const n = artistNameOfSegment(segment);
  if (!n) return false;
  return n.prefixed || lookup(n.name);
}

/**
 * 작가 구획을 뺀 프롬프트(작가 라이브러리 샘플 생성용 — 대상 작가만 남기기 전에 쓴다, 2026-09-26). 빈 구획은 정리한다.
 * artist: 접두 구획은 전부 뺀다. 접두 없는 구획은 isUnprefixedArtist 가 작가라 답하고 keepName(대상 작가)이 아닌 것만 뺀다
 * (작가 분해와 같은 기준, 2026-10-05 — 예전에는 접두 없는 작가를 남겨 샘플에 다른 작가가 섞였다).
 */
export function removeArtistSegments(
  text: string,
  isUnprefixedArtist?: (name: string) => boolean,
  keepName?: string,
): string {
  const keep = keepName?.trim().toLowerCase();
  // 가중치 묶음 안의 작가를 빼도 묶음의 여는 N:: / 닫는 :: 는 남는 태그로 옮겨 짝을 유지한다(2026-10-02).
  return removePromptSegmentsKeepingGroups(text, (parts) => {
    const n = artistNameOfSegment(joinPromptSegment(parts));
    if (!n) return false;
    if (n.prefixed) return true;
    return !!isUnprefixedArtist?.(n.name) && n.name.toLowerCase() !== keep;
  });
}

/** 프롬프트에 그 작가(접두 유무 무관, 대소문자 무시)가 이미 있는가. */
export function hasArtistNamed(text: string, name: string): boolean {
  const key = name.trim().toLowerCase();
  return splitPromptSegments(text).some(
    (segment) => artistNameOfSegment(segment)?.name.toLowerCase() === key,
  );
}

/** add=접두 없는 작가에 붙임, remove=접두 뗌, toggle=구획마다 반전(있으면 뗌, 없는 작가엔 붙임 — 섞여 있어도 한쪽으로 몰지 않음). */

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
 *  · 붙이기는 접두 없는 작가(라이브러리·태그 DB 판별)에만. 떼기는 접두가 있는 구획에만(DB 조회 없음 — 접두가 곧 의도).
 *  · toggle 은 사용자 결정(2026-09-26): 버튼 하나로, 달린 것은 떼고 안 달린 작가에는 붙인다.
 */
export async function transformArtistPrefix(
  text: string,
  mode: ArtistPrefixMode,
  lookup: ArtistLookup,
): Promise<ArtistPrefixResult> {
  // 구획 경계는 쉼표·줄바꿈(구분자는 그대로 되살린다 — 줄마다 적은 작가도 인식, 2026-10-05).
  const segments = text.split(/([,\n])/);
  let added = 0;
  let removed = 0;
  let artists = 0;
  const out: string[] = [];
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    const n = i % 2 === 1 ? undefined : artistNameOfSegment(segment);
    if (!n) {
      out.push(segment);
      continue;
    }
    const { parts } = n;
    if (n.prefixed) {
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
    const isArtist = await lookup(n.name);
    if (!isArtist) {
      out.push(segment);
      continue;
    }
    artists += 1;
    added += 1;
    out.push(joinPromptSegment({ ...parts, core: 'artist:' + n.name }));
  }
  return { text: out.join(''), changed: added + removed, added, removed, artists };
}
