// 2026-10-05 회귀 — 접두(artist:) 없는 작가 인식. 구획 → 핵심 이름 정규화(artistNameOfSegment)를
// 편집기 작가 버튼·접두 전환·작가 분해·샘플 생성이 함께 쓰고, 접두 없는 이름은 라이브러리·태그 DB 로 대조한다.
import {
  artistNameOfSegment,
  hasArtistNamed,
  isArtistSegment,
  makeArtistLookup,
  promptSegmentAt,
  removeArtistSegments,
  resolveUnprefixedArtistNames,
  transformArtistPrefix,
} from '../artistTags';
import { buildArtistPromptVariants } from '../promptTransforms';

// 작가 라이브러리(findArtistByName 규칙 흉내: 대소문자·연속 공백 무시)와 태그 DB 를 따로 둔다.
const LIBRARY = ['aaa', 'Lib Only'];
const libraryHas = (n: string) =>
  LIBRARY.some((a) => a.trim().replace(/\s+/g, ' ').toLowerCase() === n.trim().replace(/\s+/g, ' ').toLowerCase());
const TAG_DB: Record<string, { category: number }> = {
  bbb: { category: 1 },
  db_artist: { category: 1 },
  '1girl': { category: 0 },
  'blue hair': { category: 0 },
};
const lookup = makeArtistLookup(async (w) => TAG_DB[w], libraryHas);

const WRAPPED = ['0.8::aaa::', '.6::aaa::', '1.5:: aaa ::', '{{aaa}}', '[aaa]', '  aaa  ', '0.8::{aaa}::', '{0.8::aaa::}'];

describe('구획 → 핵심 이름 정규화', () => {
  it('가중치·.6:: 표기·N1 공백·강조 괄호·앞뒤 공백을 벗긴다', () => {
    for (const s of WRAPPED) {
      expect(artistNameOfSegment(s)).toMatchObject({ name: 'aaa', prefixed: false });
      expect(artistNameOfSegment(s.replace('aaa', 'artist:aaa'))).toMatchObject({ name: 'aaa', prefixed: true });
    }
  });
  it('다중 태그 묶음의 첫·마지막 태그', () => {
    expect(artistNameOfSegment('1.2::aaa')).toMatchObject({ name: 'aaa', prefixed: false });
    expect(artistNameOfSegment(' bbb::')).toMatchObject({ name: 'bbb', prefixed: false });
  });
  it('조각·랜덤·빈 구획은 후보가 아니다', () => {
    expect(artistNameOfSegment('<조각>')).toBeUndefined();
    expect(artistNameOfSegment('a|b')).toBeUndefined();
    expect(artistNameOfSegment('0.8::::')).toBeUndefined();
  });
});

describe('접두 없는 작가 판별(라이브러리 + 태그 DB)', () => {
  it('라이브러리 이름·태그 DB 작가는 인식, 둘 다 없으면 인식 안 함', async () => {
    expect(await isArtistSegment('0.8::aaa::', lookup)).toBe(true); // 라이브러리
    expect(await isArtistSegment('0.8::bbb::', lookup)).toBe(true); // 태그 DB
    expect(await isArtistSegment('0.8::LIB  only::', lookup)).toBe(true); // 대소문자·연속 공백 무시
    expect(await isArtistSegment('db artist', lookup)).toBe(true); // 공백→밑줄 표기
    expect(await isArtistSegment('0.8::zzz::', lookup)).toBe(false);
    expect(await isArtistSegment('0.8::1girl::', lookup)).toBe(false);
    expect(await isArtistSegment('0.8::artist:zzz::', lookup)).toBe(true); // 접두가 곧 의도
  });
  it('라이브러리는 캐시하지 않는다(나중에 추가된 작가도 인식)', async () => {
    const lib = new Set<string>();
    const look = makeArtistLookup(async () => undefined, (n) => lib.has(n));
    expect(await look('new one')).toBe(false);
    lib.add('new one');
    expect(await look('new one')).toBe(true);
  });
});

describe('접두 전환 — 래퍼 안에서만 바꾼다', () => {
  it('보고 사례 0.8::aaa:: 와 각 래퍼 형태', async () => {
    for (const s of WRAPPED) {
      const r = await transformArtistPrefix(s, 'toggle', lookup);
      expect(r.text).toBe(s.replace('aaa', 'artist:aaa'));
      expect(r.added).toBe(1);
      const back = await transformArtistPrefix(r.text, 'toggle', lookup);
      expect(back.text).toBe(s);
    }
  });
  it('다중 태그 묶음 1.2::aaa, bbb:: 와 라이브러리에 없는 이름', async () => {
    const r = await transformArtistPrefix('1.2::aaa, bbb::, zzz, 0.8::zzz::', 'toggle', lookup);
    expect(r.text).toBe('1.2::artist:aaa, artist:bbb::, zzz, 0.8::zzz::');
    expect(r.added).toBe(2);
  });
  it('줄바꿈으로 나뉜 작가도 인식하고 줄바꿈을 보존한다', async () => {
    const r = await transformArtistPrefix('1girl\n0.8::aaa::\nartist:bbb, smile', 'toggle', lookup);
    expect(r.text).toBe('1girl\n0.8::artist:aaa::\nbbb, smile');
  });
});

describe('작가 분해 — 접두 없는 작가 포함', () => {
  it('0.8::aaa:: 도 변형을 만들고 래퍼를 보존한다', async () => {
    const sources = { frontPrompt: '1girl, 0.8::aaa::, artist:ccc, zzz' };
    const isArtist = await resolveUnprefixedArtistNames([sources.frontPrompt], lookup);
    const variants = buildArtistPromptVariants(sources, isArtist);
    expect(variants.map((v) => v.artistTag)).toEqual(['aaa', 'artist:ccc']);
    expect(variants[0].frontPrompt).toBe('1girl, 0.8::aaa::, zzz');
    expect(variants[1].frontPrompt).toBe('1girl, artist:ccc, zzz');
  });
  it('묶음 1.2::aaa, bbb:: 는 하나씩 남기며 묶음 짝을 유지', async () => {
    const sources = { frontPrompt: '1girl, 1.2::aaa, bbb::, best' };
    const isArtist = await resolveUnprefixedArtistNames([sources.frontPrompt], lookup);
    const variants = buildArtistPromptVariants(sources, isArtist);
    expect(variants.map((v) => v.frontPrompt)).toEqual(['1girl, 1.2::aaa::, best', '1girl, 1.2::bbb::, best']);
  });
  it('접두 유무가 달라도 같은 작가는 한 변형', async () => {
    const sources = { frontPrompt: 'aaa, x', backPrompt: '{artist:AAA}' };
    const isArtist = await resolveUnprefixedArtistNames([sources.frontPrompt, sources.backPrompt], lookup);
    expect(buildArtistPromptVariants(sources, isArtist)).toHaveLength(1);
  });
  it('판별 함수가 없으면 예전처럼 접두 있는 것만', () => {
    expect(buildArtistPromptVariants({ frontPrompt: '0.8::aaa::, artist:ccc' }).map((v) => v.artistTag)).toEqual([
      'artist:ccc',
    ]);
  });
  it('줄바꿈 구획: 다른 작가를 빼고 줄을 살린다', async () => {
    const sources = { frontPrompt: '1girl\nartist:ccc\n0.8::aaa::, smile' };
    const isArtist = await resolveUnprefixedArtistNames([sources.frontPrompt], lookup);
    const variants = buildArtistPromptVariants(sources, isArtist);
    expect(variants.map((v) => v.artistTag)).toEqual(['artist:ccc', 'aaa']);
    // 뺀 구획 앞뒤에 줄바꿈·쉼표가 함께 있었으면 ',\n' 으로 잇는다
    expect(variants.map((v) => v.frontPrompt)).toEqual(['1girl\nartist:ccc,\nsmile', '1girl\n0.8::aaa::, smile']);
  });
});

describe('샘플 생성·이름 존재 판정', () => {
  it('다른 작가는 접두 유무와 관계없이 빼고 대상 작가는 가중치째 남긴다', async () => {
    const text = '1girl, 0.8::aaa::, bbb, artist:ccc, zzz';
    const isArtist = await resolveUnprefixedArtistNames([text], lookup);
    expect(removeArtistSegments(text, isArtist, 'aaa')).toBe('1girl, 0.8::aaa::, zzz');
    expect(removeArtistSegments(text)).toBe('1girl, 0.8::aaa::, bbb, zzz'); // 판별 없이 = 예전 동작
  });
  it('hasArtistNamed 는 래퍼·줄바꿈 안 이름도 본다', () => {
    expect(hasArtistNamed('1girl\n0.8::AAA::', 'aaa')).toBe(true);
    expect(hasArtistNamed('1.5:: aaa ::', 'aaa')).toBe(true);
  });
  it('편집기 커서 구획(promptSegmentAt)도 같은 정규화', () => {
    const text = '1girl, 0.8::aaa::';
    expect(artistNameOfSegment(promptSegmentAt(text, text.indexOf('aaa') + 1))?.name).toBe('aaa');
  });
});
