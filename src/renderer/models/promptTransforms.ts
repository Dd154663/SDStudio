export interface PromptWeightAdjustment {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

const WEIGHTED_PROMPT_RE = /^(-?\d+(?:\.\d+)?)::([\s\S]+)::$/;

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

  const caret = clamp(selectionStart, 0, text.length);
  const segmentStart = text.lastIndexOf(',', Math.max(0, caret - 1)) + 1;
  const nextComma = text.indexOf(',', caret);
  const segmentEnd = nextComma < 0 ? text.length : nextComma;
  const segment = text.slice(segmentStart, segmentEnd);
  const leading = segment.match(/^\s*/)?.[0] ?? '';
  const trailing = segment.match(/\s*$/)?.[0] ?? '';
  const core = segment.slice(leading.length, segment.length - trailing.length);
  if (!core) return undefined;

  const weighted = core.match(WEIGHTED_PROMPT_RE);
  const inner = weighted?.[2] ?? core;
  const oldPrefixLength = weighted?.[1].length
    ? weighted[1].length + 2
    : 0;
  const currentWeight = weighted ? Number(weighted[1]) : 1;
  const nextWeight = Math.round((currentWeight + delta) * 100) / 100;
  const nextPrefix = nextWeight === 1 ? '' : `${formatWeight(nextWeight)}::`;
  const nextSuffix = nextWeight === 1 ? '' : '::';
  const nextCore = nextPrefix + inner + nextSuffix;

  const mapPosition = (position: number) => {
    const relative = clamp(position - segmentStart, 0, segment.length);
    const logical = clamp(
      relative - leading.length - oldPrefixLength,
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

function artistTagOf(segment: string): string | undefined {
  let core = segment.trim();
  const weighted = core.match(WEIGHTED_PROMPT_RE);
  if (weighted) core = weighted[2].trim();
  core = core.replace(/^[{\[]+/, '').replace(/[}\]]+$/, '').trim();
  if (!/^artist\s*:\s*.+$/i.test(core)) return undefined;
  return core.replace(/^artist\s*:\s*/i, 'artist:').trim();
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
      const segments = value.split(',');
      variant[field] = segments
        .filter((segment, index) => {
          if (!artistTagOf(segment)) return true;
          return field === selected.field && index === selected.index;
        })
        .map((segment) => segment.trim())
        .filter(Boolean)
        .join(', ');
    }
    return variant;
  });
}
