import {
  prefixedArtistNameOfSegment,
  removePromptSegmentsKeepingGroups,
} from './artistTags';
import {
  parsePromptWeightNumber,
  PROMPT_WEIGHT_NUMBER_SOURCE,
} from './promptWeightSyntax';

export interface PromptWeightAdjustment {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

// 가중치 숫자는 promptWeightSyntax 단일 출처 — .6:: 처럼 0 을 생략한 표기도 0.6 으로 읽는다(2026-10-02 I2).
const WEIGHTED_PROMPT_RE = new RegExp(`^(${PROMPT_WEIGHT_NUMBER_SOURCE})::([\\s\\S]+)::$`);

/** 가중치 조절 한 단계(PC Ctrl+휠/Ctrl+↑↓, 모바일 키보드 위 칩 공통). */
export const PROMPT_WEIGHT_STEP = 0.05;

export interface PromptWeightInfo {
  /** 커서 구획의 핵심(앞뒤 공백 제외, 가중치 래퍼 포함). */
  core: string;
  /** 가중치 래퍼를 벗긴 안쪽. 래퍼가 없으면 core 와 같다. */
  inner: string;
  /** 현재 가중치. 래퍼가 없으면 1. */
  weight: number;
}

interface CaretSegment {
  segmentStart: number;
  segmentEnd: number;
  segment: string;
  leading: string;
  trailing: string;
  core: string;
}

/** 커서가 놓인 쉼표 구간(앞뒤 공백 분리). */
function caretSegmentOf(text: string, selectionStart: number): CaretSegment {
  const caret = clamp(selectionStart, 0, text.length);
  const segmentStart = text.lastIndexOf(',', Math.max(0, caret - 1)) + 1;
  const nextComma = text.indexOf(',', caret);
  const segmentEnd = nextComma < 0 ? text.length : nextComma;
  const segment = text.slice(segmentStart, segmentEnd);
  const leading = segment.match(/^\s*/)?.[0] ?? '';
  const trailing = segment.match(/\s*$/)?.[0] ?? '';
  const core = segment.slice(leading.length, segment.length - trailing.length);
  return { segmentStart, segmentEnd, segment, leading, trailing, core };
}

/** 커서 구획의 현재 가중치(모바일 칩 표시용). 빈 구획이면 undefined. */
export function getPromptWeightAtSelection(
  text: string,
  selectionStart: number,
): PromptWeightInfo | undefined {
  const { core } = caretSegmentOf(text, selectionStart);
  if (!core) return undefined;
  const weighted = core.match(WEIGHTED_PROMPT_RE);
  return {
    core,
    // `1.5:: 0aaa0 ::`(N1 공백 보정 형태, 메타데이터에서 불러온 프롬프트) 의 안쪽 공백은 표시에서 뺀다.
    inner: weighted ? weighted[2].trim() : core,
    weight: weighted ? parsePromptWeightNumber(weighted[1]) : 1,
  };
}

/** 칩에 보이는 값: 1 → "1.0", 그 외는 소수 둘째 자리까지(1.15, 0.95, -0.05). */
export function formatPromptWeightLabel(weight: number): string {
  const rounded = Math.round(weight * 100) / 100;
  return Number.isInteger(rounded) ? rounded.toFixed(1) : String(rounded);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function formatWeight(value: number): string {
  return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * 커서가 놓인 쉼표 구간 하나의 NAI 가중치를 0.05 단위로 조절한다.
 * 1.0은 래퍼가 없는 원문으로 되돌려 불필요한 문법 누적을 피한다.
 */
export function adjustPromptWeightAtSelection(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  delta: number,
): PromptWeightAdjustment | undefined {
  if (!Number.isFinite(delta) || delta === 0) return undefined;

  const { segmentStart, segmentEnd, segment, leading, trailing, core } =
    caretSegmentOf(text, selectionStart);
  if (!core) return undefined;

  const weighted = core.match(WEIGHTED_PROMPT_RE);
  const wrappedInner = weighted?.[2] ?? core;
  const oldPrefixLength = weighted?.[1].length
    ? weighted[1].length + 2
    : 0;
  const currentWeight = weighted ? parsePromptWeightNumber(weighted[1]) : 1;
  const nextWeight = Math.round((currentWeight + delta) * 100) / 100;
  // 1.0 으로 풀 때는 안쪽 앞뒤 공백(`1.05:: 0aaa0 ::` 같은 N1 공백 보정 형태)을 걷어 이중 공백을 남기지 않는다.
  const unwrapping = !!weighted && nextWeight === 1;
  const innerLeadCut = unwrapping ? (wrappedInner.match(/^\s*/)?.[0].length ?? 0) : 0;
  const inner = unwrapping ? wrappedInner.trim() : wrappedInner;
  const nextPrefix = nextWeight === 1 ? '' : `${formatWeight(nextWeight)}::`;
  const nextSuffix = nextWeight === 1 ? '' : '::';
  const nextCore = nextPrefix + inner + nextSuffix;

  const mapPosition = (position: number) => {
    const relative = clamp(position - segmentStart, 0, segment.length);
    const logical = clamp(
      relative - leading.length - oldPrefixLength - innerLeadCut,
      0,
      inner.length,
    );
    return segmentStart + leading.length + nextPrefix.length + logical;
  };

  return {
    text:
      text.slice(0, segmentStart) +
      leading +
      nextCore +
      trailing +
      text.slice(segmentEnd),
    selectionStart: mapPosition(selectionStart),
    selectionEnd: mapPosition(selectionEnd),
  };
}

// ##주석## 범위 — PromptService.stripPromptComments·하이라이트와 같은 규칙(여러 줄 허용, 짝 없는 단일 ## 는 리터럴).
const PROMPT_COMMENT_RE = /##[\s\S]*?##/g;

export interface PromptCommentRange {
  /** 여는 `##` 의 시작 위치. */
  start: number;
  /** 닫는 `##` 바로 뒤 위치. */
  end: number;
}

function promptCommentRanges(text: string): PromptCommentRange[] {
  const ranges: PromptCommentRange[] = [];
  const re = new RegExp(PROMPT_COMMENT_RE.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  return ranges;
}

/**
 * 커서가 속한 주석(모바일 칩 주석 토글·활성 표시용, 2026-10-03).
 * - 커서가 주석 범위 안이거나 `##` 표식 안쪽/바깥 경계에 닿아 있으면(start <= caret <= end) 그 주석.
 * - 아니면 커서 쉼표 구획의 core 가 통째로 주석 하나일 때 그 주석(구획 앞 공백에 커서가 있어도 풀 수 있게).
 */
export function getPromptCommentAtSelection(
  text: string,
  caret: number,
): PromptCommentRange | undefined {
  const ranges = promptCommentRanges(text);
  const at = clamp(caret, 0, text.length);
  const hit = ranges.find((r) => r.start <= at && at <= r.end);
  if (hit) return hit;
  const { segmentStart, leading, core } = caretSegmentOf(text, at);
  if (!core) return undefined;
  const coreStart = segmentStart + leading.length;
  return ranges.find(
    (r) => r.start === coreStart && r.end === coreStart + core.length,
  );
}

/**
 * 커서 기준 주석 토글(모바일 키보드 위 칩 # 버튼, 2026-10-03).
 * - 주석 안(getPromptCommentAtSelection)이면 그 주석의 여는·닫는 `##` 만 지운다(안쪽 텍스트 보존).
 * - 아니면 커서 쉼표 구획의 core(앞뒤 공백 제외, 가중치 래퍼 포함)를 `##core##` 로 감싼다.
 *   빈 구획이거나, 감싸면 다른 주석의 짝이 바뀌는 경우(core 안의 `##`, 다른 곳의 짝 없는 `##` 등)는 undefined.
 * 가중치는 건드리지 않는다. 저장 데이터·NAI 전송 처리(stripPromptComments)는 그대로.
 */
export function togglePromptCommentAtSelection(
  text: string,
  selectionStart: number,
  selectionEnd: number,
): PromptWeightAdjustment | undefined {
  const comment = getPromptCommentAtSelection(text, selectionStart);
  if (comment) {
    const { start, end } = comment;
    const innerEnd = end - 4;
    const mapPosition = (position: number) => {
      const p = clamp(position, 0, text.length);
      if (p <= start) return p;
      if (p <= start + 2) return start;
      if (p <= end - 2) return p - 2;
      if (p <= end) return innerEnd;
      return p - 4;
    };
    return {
      text:
        text.slice(0, start) +
        text.slice(start + 2, end - 2) +
        text.slice(end),
      selectionStart: mapPosition(selectionStart),
      selectionEnd: mapPosition(selectionEnd),
    };
  }

  const { segmentStart, leading, core } = caretSegmentOf(text, selectionStart);
  if (!core) return undefined;
  const coreStart = segmentStart + leading.length;
  const coreEnd = coreStart + core.length;
  const next =
    text.slice(0, coreStart) + '##' + core + '##' + text.slice(coreEnd);

  // 감싼 뒤의 주석 범위가 「기존 주석(위치만 이동) + 새 주석 하나」와 정확히 같을 때만 허용한다.
  // core 안에 `##` 가 섞였거나 다른 곳에 짝 없는 `##` 가 있으면 짝이 바뀌어 여기서 거부된다.
  const expected = [
    ...promptCommentRanges(text).map((r) =>
      r.end <= coreStart ? r : { start: r.start + 4, end: r.end + 4 },
    ),
    { start: coreStart, end: coreEnd + 4 },
  ].sort((a, b) => a.start - b.start);
  const actual = promptCommentRanges(next);
  if (
    actual.length !== expected.length ||
    actual.some(
      (r, i) => r.start !== expected[i].start || r.end !== expected[i].end,
    )
  ) {
    return undefined;
  }

  const mapPosition = (position: number) => {
    const p = clamp(position, 0, text.length);
    if (p < coreStart) return p;
    if (p <= coreEnd) return p + 2;
    return p + 4;
  };
  return {
    text: next,
    selectionStart: mapPosition(selectionStart),
    selectionEnd: mapPosition(selectionEnd),
  };
}

export interface ArtistPromptSources {
  frontPrompt?: string;
  extraPrompt?: string;
  backPrompt?: string;
  characterPrompt?: string;
  backgroundPrompt?: string;
}

export interface ArtistPromptVariant extends ArtistPromptSources {
  artistTag: string;
}

interface ArtistSegment {
  field: keyof ArtistPromptSources;
  index: number;
  tag: string;
  key: string;
}

const ARTIST_FIELDS: (keyof ArtistPromptSources)[] = [
  'frontPrompt',
  'extraPrompt',
  'backPrompt',
  'characterPrompt',
  'backgroundPrompt',
];

// 구획 파싱·접두 판별은 artistTags 단일 출처(2026-10-02) — 가중치 묶음(1.5::artist:a, artist:b::)의
// 첫·마지막 태그도 작가로 본다. 예전에는 묶음 첫 태그를 놓치고 마지막 태그를 artist:b:: 로 썼다.
function artistTagOf(segment: string): string | undefined {
  const name = prefixedArtistNameOfSegment(segment);
  return name ? 'artist:' + name : undefined;
}

/** 현재 양의 프롬프트들에서 작가 태그 하나만 남긴 예약용 변형을 만든다. */
export function buildArtistPromptVariants(
  sources: ArtistPromptSources,
): ArtistPromptVariant[] {
  const found: ArtistSegment[] = [];
  for (const field of ARTIST_FIELDS) {
    const segments = (sources[field] ?? '').split(',');
    segments.forEach((segment, index) => {
      const tag = artistTagOf(segment);
      if (!tag) return;
      const key = tag.toLocaleLowerCase();
      if (found.some((item) => item.key === key)) return;
      found.push({ field, index, tag, key });
    });
  }

  return found.map((selected) => {
    const variant: ArtistPromptVariant = { artistTag: selected.tag };
    for (const field of ARTIST_FIELDS) {
      const value = sources[field];
      if (value === undefined) continue;
      // 뺀 작가가 가중치 묶음의 여는/닫는 쪽이면 그 표식은 남는 태그로 옮겨 짝을 유지한다(2026-10-02).
      variant[field] = removePromptSegmentsKeepingGroups(
        value,
        (parts, index) =>
          !!artistTagOf(parts.core) &&
          !(field === selected.field && index === selected.index),
      );
    }
    return variant;
  });
}
