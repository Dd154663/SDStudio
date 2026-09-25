import {
  hasArtistPrefix,
  isTransformableCore,
  joinPromptSegment,
  makeArtistLookup,
  parsePromptSegment,
  stripArtistPrefix,
  transformArtistPrefix,
} from '../artistTags';

const ARTISTS = new Set(['ixy', 'lunch boxer', 'maccha (mochancc)', 'shouu-kun']);
const lookup = async (word: string) => ARTISTS.has(word.trim().toLowerCase());

describe('작가 태그 구획 파싱', () => {
  it('가중치·괄호·공백을 장식으로 분리하고 되돌리면 원문', () => {
    const samples = [' 1.3::artist:ixy::', '{{lunch boxer}}', '  0.5::[maccha (mochancc)]::  ', 'plain', '', '  '];
    for (const s of samples) {
      expect(joinPromptSegment(parsePromptSegment(s))).toBe(s);
    }
    const p = parsePromptSegment(' 1.3::{artist:ixy}:: ');
    expect(p).toEqual({
      leading: ' ',
      weightPrefix: '1.3::',
      open: '{',
      core: 'artist:ixy',
      close: '}',
      weightSuffix: '::',
      trailing: ' ',
    });
  });
  it('접두 판별과 제거', () => {
    expect(hasArtistPrefix('artist:ixy')).toBe(true);
    expect(hasArtistPrefix('Artist : ixy')).toBe(true);
    expect(hasArtistPrefix('ixy')).toBe(false);
    expect(stripArtistPrefix('artist: ixy')).toBe('ixy');
    expect(stripArtistPrefix('ixy')).toBe('ixy');
  });
  it('조각·랜덤·빈 구획은 변환 대상이 아니다', () => {
    expect(isTransformableCore('<조각>')).toBe(false);
    expect(isTransformableCore('a|b')).toBe(false);
    expect(isTransformableCore('')).toBe(false);
    expect(isTransformableCore('1girl')).toBe(true);
  });
});

describe('artist: 일괄 추가', () => {
  it('DB 상 작가에만 붙이고 가중치·괄호·공백은 보존, 이미 있는 것은 세지 않는다', async () => {
    const r = await transformArtistPrefix(
      '1girl, ixy, 1.3::lunch boxer::, {maccha (mochancc)}, artist:shouu-kun, <조각>, a|b',
      'add',
      lookup,
    );
    expect(r.text).toBe(
      '1girl, artist:ixy, 1.3::artist:lunch boxer::, {artist:maccha (mochancc)}, artist:shouu-kun, <조각>, a|b',
    );
    expect(r.changed).toBe(3);
    expect(r.artists).toBe(4);
  });
  it('두 번 적용해도 같다(멱등)', async () => {
    const once = await transformArtistPrefix('ixy, lunch boxer', 'add', lookup);
    const twice = await transformArtistPrefix(once.text, 'add', lookup);
    expect(twice.text).toBe(once.text);
    expect(twice.changed).toBe(0);
  });
});

describe('artist: 일괄 제거', () => {
  it('접두만 떼고 나머지는 그대로, DB 를 보지 않는다', async () => {
    const never = async () => {
      throw new Error('should not lookup');
    };
    const r = await transformArtistPrefix(
      '1girl, artist:ixy, 1.3::artist: lunch boxer::, {Artist:maccha (mochancc)}, not artist',
      'remove',
      never,
    );
    expect(r.text).toBe('1girl, ixy, 1.3::lunch boxer::, {maccha (mochancc)}, not artist');
    expect(r.changed).toBe(3);
    expect(r.artists).toBe(3);
  });
});

describe('artist: 반전(toggle)', () => {
  it('섞여 있으면 구획마다 반전하고 한쪽으로 몰지 않는다', async () => {
    const r = await transformArtistPrefix(
      '1girl, artist:ixy, lunch boxer, 1.3::artist: maccha (mochancc)::, shouu-kun, <조각>',
      'toggle',
      lookup,
    );
    expect(r.text).toBe(
      '1girl, ixy, artist:lunch boxer, 1.3::maccha (mochancc)::, artist:shouu-kun, <조각>',
    );
    expect(r.added).toBe(2);
    expect(r.removed).toBe(2);
    expect(r.changed).toBe(4);
    expect(r.artists).toBe(4);
  });
  it('두 번 반전하면 원문으로 돌아온다', async () => {
    const src = '1girl, artist:ixy, lunch boxer';
    const once = await transformArtistPrefix(src, 'toggle', lookup);
    const twice = await transformArtistPrefix(once.text, 'toggle', lookup);
    expect(twice.text).toBe(src);
  });
});

describe('작가 조회 래퍼', () => {
  it('원문·밑줄·공백 표기를 차례로 찾고 같은 단어는 한 번만 조회한다', async () => {
    const calls: string[] = [];
    const db: Record<string, { category: number }> = { lunch_boxer: { category: 1 }, '1girl': { category: 0 } };
    const look = makeArtistLookup(async (w) => {
      calls.push(w);
      return db[w];
    });
    expect(await look('lunch boxer')).toBe(true);
    expect(await look('lunch boxer')).toBe(true);
    expect(await look('1girl')).toBe(false);
    expect(await look('')).toBe(false);
    expect(calls).toEqual(['lunch boxer', 'lunch_boxer', '1girl']);
  });
});
