import {
  ARTIST_TAG_CATEGORY,
  autocompleteTagCategory,
  filterTagsByCategory,
  trimAutocompleteWord,
} from '../promptAutocomplete';

describe('프롬프트 자동완성 문맥', () => {
  it.each([
    'artist:',
    'artist:cil',
    '{artist:cil}',
    '1.2::artist:cil::',
    '1.2::{ ARTIST : cil }::',
  ])('%s 뒤에서는 작가 태그만 요청한다', (word) => {
    expect(autocompleteTagCategory(word)).toBe(ARTIST_TAG_CATEGORY);
  });

  it.each(['cil', '1girl', '{artist}', '<piece>'])(
    '%s는 일반 태그 검색 범위를 유지한다',
    (word) => {
      expect(autocompleteTagCategory(word)).toBeUndefined();
    },
  );

  it('검색어에서 가중치와 artist 접두어만 제거한다', () => {
    expect(trimAutocompleteWord('1.2::{ artist:ciloranko }::')).toBe(
      'ciloranko',
    );
  });

  it('작가 카테고리가 지정되면 다른 후보를 제외한다', () => {
    const tags = [
      { word: 'general', category: 0 },
      { word: 'artist-name', category: 1 },
    ] as any[];
    expect(filterTagsByCategory(tags, ARTIST_TAG_CATEGORY)).toEqual([
      tags[1],
    ]);
    expect(filterTagsByCategory(tags)).toEqual(tags);
  });
});
