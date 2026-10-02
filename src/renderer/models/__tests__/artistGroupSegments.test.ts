// 2026-10-02 B3 회귀 — 가중치 묶음(N::a, b::) 안의 작가 태그 이름 추출과 묶음 보존 제거.
import {
  hasArtistNamed,
  joinPromptSegment,
  parsePromptSegment,
  prefixedArtistNameOfSegment,
  promptSegmentAt,
  removeArtistSegments,
  transformArtistPrefix,
} from '../artistTags';
import { buildArtistPromptVariants } from '../promptTransforms';

/** 편집기 「작가 라이브러리」 버튼과 같은 경로: 커서 구획 → parsePromptSegment → 접두 제거. */
function caretArtist(text: string, needle: string): string | undefined {
  return prefixedArtistNameOfSegment(promptSegmentAt(text, text.indexOf(needle) + 1));
}

describe('가중치 묶음 안 작가 이름 추출(커서 구획)', () => {
  it('재현 입력: 1.5::artist:aaa, artist:bbb:: 의 첫·마지막 태그', () => {
    const text = '1.5::artist:aaa, artist:bbb::';
    expect(caretArtist(text, 'aaa')).toBe('aaa');
    expect(caretArtist(text, 'bbb')).toBe('bbb');
  });
  it('묶음의 가운데 태그', () => {
    const text = '1.2::artist:aaa, artist:mid, artist:ccc::';
    expect(caretArtist(text, 'mid')).toBe('mid');
  });
  it('0 생략·음수 가중치 묶음', () => {
    expect(caretArtist('.6::artist:aaa, artist:bbb::', 'aaa')).toBe('aaa');
    expect(caretArtist('-1::artist:aaa, artist:bbb::', 'aaa')).toBe('aaa');
    expect(caretArtist('-.5::artist:aaa, artist:bbb::', 'bbb')).toBe('bbb');
    expect(caretArtist('1.::artist:aaa::', 'aaa')).toBe('aaa');
  });
  it('묶음 밖·한 구획 묶음·공백 변형', () => {
    expect(caretArtist('1girl, artist:aaa, best', 'aaa')).toBe('aaa');
    expect(caretArtist('1.3::artist:aaa::', 'aaa')).toBe('aaa');
    expect(caretArtist('1.5:: artist: aaa , artist:bbb ::', 'aaa')).toBe('aaa');
    expect(caretArtist('1.5:: artist: aaa , artist:bbb ::', 'bbb')).toBe('bbb');
  });
  it('{} / [] 감싼 경우(묶음 안팎, 가중치 바깥 괄호 포함)', () => {
    expect(caretArtist('{artist:aaa}', 'aaa')).toBe('aaa');
    expect(caretArtist('{artist:aaa, artist:bbb}', 'aaa')).toBe('aaa');
    expect(caretArtist('{artist:aaa, artist:bbb}', 'bbb')).toBe('bbb');
    expect(caretArtist('[[artist:aaa]]', 'aaa')).toBe('aaa');
    expect(caretArtist('1.5::{artist:aaa}, [artist:bbb]::', 'bbb')).toBe('bbb');
    expect(caretArtist('{1.5::artist:aaa::}', 'aaa')).toBe('aaa');
    expect(caretArtist('1.5::{artist:aaa, artist:bbb}::', 'aaa')).toBe('aaa');
    expect(caretArtist('1.5::{artist:aaa, artist:bbb}::', 'bbb')).toBe('bbb');
  });
  it('접두 없는 작가는 핵심만 남겨 DB 조회로 넘긴다', () => {
    expect(parsePromptSegment('1.5::aaa').core).toBe('aaa');
    expect(parsePromptSegment(' bbb::').core).toBe('bbb');
    expect(caretArtist('1.5::aaa, bbb::', 'aaa')).toBeUndefined();
  });
  it('줄바꿈도 구획 경계', () => {
    expect(caretArtist('1.5::artist:aaa\nartist:bbb::', 'bbb')).toBe('bbb');
  });
});

describe('구획 파싱 왕복', () => {
  it('한쪽만 있는 장식도 되돌리면 원문', () => {
    const samples = [
      '1.5::artist:aaa',
      ' artist:bbb::',
      ' .6::{x}',
      '[y]]::  ',
      '{1.5::z::}',
      '1.5::',
      '::',
      '-.5:: a ::',
    ];
    for (const s of samples) expect(joinPromptSegment(parsePromptSegment(s))).toBe(s);
  });
  it('여는 쪽만·닫는 쪽만 각각 분리', () => {
    expect(parsePromptSegment('1.5::{artist:aaa')).toMatchObject({
      weightPrefix: '1.5::',
      open: '{',
      core: 'artist:aaa',
      close: '',
      weightSuffix: '',
    });
    expect(parsePromptSegment(' artist:bbb}::')).toMatchObject({
      weightPrefix: '',
      open: '',
      core: 'artist:bbb',
      close: '}',
      weightSuffix: '::',
    });
  });
});

describe('작가 접두 전환 — 묶음 안 태그(동작 확인)', () => {
  const lookup = async (w: string) => ['aaa', 'bbb'].includes(w.trim().toLowerCase());
  it('묶음 첫·마지막 태그도 접두를 붙이고 떼며 :: 는 보존', async () => {
    const add = await transformArtistPrefix('1.5::aaa, bbb::, 1girl', 'toggle', lookup);
    expect(add.text).toBe('1.5::artist:aaa, artist:bbb::, 1girl');
    expect(add.added).toBe(2);
    const back = await transformArtistPrefix(add.text, 'toggle', lookup);
    expect(back.text).toBe('1.5::aaa, bbb::, 1girl');
  });
  it('묶음 밖 기존 동작 불변', async () => {
    const r = await transformArtistPrefix('1girl, artist:aaa, 1.3::bbb::', 'toggle', lookup);
    expect(r.text).toBe('1girl, aaa, 1.3::artist:bbb::');
  });
});

describe('작가 구획 제거 시 묶음 짝 보존(샘플 생성)', () => {
  it('묶음 전체가 작가면 표식까지 사라진다', () => {
    expect(removeArtistSegments('1girl, 1.5::artist:aaa, artist:bbb::, best')).toBe('1girl, best');
  });
  it('여는 쪽 작가를 빼면 N:: 가 다음 태그로 옮겨 간다', () => {
    expect(removeArtistSegments('1.5::artist:aaa, blue hair::, best')).toBe('1.5::blue hair::, best');
  });
  it('닫는 쪽 작가를 빼면 :: 가 앞 태그로 옮겨 간다', () => {
    expect(removeArtistSegments('1.5::blue hair, artist:bbb::, best')).toBe('1.5::blue hair::, best');
  });
  it('괄호 묶음도 같은 방식', () => {
    expect(removeArtistSegments('{artist:aaa, smile}, best')).toBe('{smile}, best');
    expect(removeArtistSegments('1.5::{artist:aaa}, smile::')).toBe('1.5::smile::');
  });
  it('이름 존재 판정도 묶음 안을 본다', () => {
    expect(hasArtistNamed('1.5::artist:aaa, artist:bbb::', 'bbb')).toBe(true);
    expect(hasArtistNamed('1.5::artist:aaa, artist:bbb::', 'aaa')).toBe(true);
  });
});

describe('작가 분해 — 묶음 안 작가', () => {
  it('태그 이름이 깨끗하고 고른 작가는 묶음 가중치를 유지한다', () => {
    const variants = buildArtistPromptVariants({
      frontPrompt: '1girl, 1.5::artist:aaa, artist:bbb::, best',
    });
    expect(variants.map((v) => v.artistTag)).toEqual(['artist:aaa', 'artist:bbb']);
    expect(variants[0].frontPrompt).toBe('1girl, 1.5::artist:aaa::, best');
    expect(variants[1].frontPrompt).toBe('1girl, 1.5::artist:bbb::, best');
  });
});
