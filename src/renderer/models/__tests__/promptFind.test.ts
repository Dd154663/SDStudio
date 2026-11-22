import {
  findPromptMatches,
  foldPromptFindCase,
  pickPromptMatchIndex,
  promptFindCountLabel,
  promptFindPrefill,
  replaceAllPromptMatches,
  replacePromptMatchAt,
  stepPromptMatchIndex,
} from '../promptFind';

const spans = (text: string, q: string, cs = false) =>
  findPromptMatches(text, q, cs).map((m) => text.slice(m.start, m.end));

describe('「이 칸에서 찾기」 일치 계산', () => {
  test('대소문자 — 기본은 가리지 않고, 토글을 켜면 가린다', () => {
    const t = 'Blue hair, blue eyes, BLUE sky';
    expect(spans(t, 'blue')).toEqual(['Blue', 'blue', 'BLUE']);
    expect(spans(t, 'blue', true)).toEqual(['blue']);
    expect(findPromptMatches(t, 'BLUE', false).map((m) => m.start)).toEqual([0, 11, 22]);
  });

  test('겹치지 않게 앞에서부터', () => {
    expect(findPromptMatches('aaaa', 'aa', false)).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
    expect(findPromptMatches('aaa', 'aa', false)).toEqual([{ start: 0, end: 2 }]);
  });

  test('빈 찾는 말·빈 글은 일치 없음', () => {
    expect(findPromptMatches('abc', '', false)).toEqual([]);
    expect(findPromptMatches('', 'a', false)).toEqual([]);
  });

  test('여러 줄과 주석 안의 글자도 찾는다', () => {
    const t = 'cat\n##cat memo##\ndog, cat';
    expect(findPromptMatches(t, 'cat', false).map((m) => m.start)).toEqual([0, 6, 22]);
    expect(findPromptMatches(t, 'cat\n##', false)).toEqual([{ start: 0, end: 6 }]);
  });

  test('한글·이모지·전각 문자에서 오프셋이 원문과 맞는다', () => {
    const t = '😀파란 머리, ＡＢＣ, 😀파란 눈';
    const ms = findPromptMatches(t, '파란', false);
    expect(ms.map((m) => t.slice(m.start, m.end))).toEqual(['파란', '파란']);
    expect(ms[0].start).toBe(2); // 이모지 = UTF-16 두 칸
    const full = findPromptMatches(t, 'ａｂｃ', false);
    expect(full).toHaveLength(1);
    expect(t.slice(full[0].start, full[0].end)).toBe('ＡＢＣ');
  });

  test('소문자로 바꾸면 길이가 바뀌는 글자(İ)는 그대로 두어 오프셋을 지킨다', () => {
    expect('İ'.toLowerCase().length).toBe(2);
    const t = 'İstanbul, cat';
    expect(foldPromptFindCase(t)).toHaveLength(t.length);
    const m = findPromptMatches(t, 'CAT', false);
    expect(t.slice(m[0].start, m[0].end)).toBe('cat');
  });
});

describe('현재 자리·이동', () => {
  const ms = [
    { start: 2, end: 4 },
    { start: 10, end: 12 },
    { start: 20, end: 22 },
  ];
  test('커서 뒤 첫 일치, 없으면 처음, 일치가 없으면 -1', () => {
    expect(pickPromptMatchIndex(ms, 0)).toBe(0);
    expect(pickPromptMatchIndex(ms, 10)).toBe(1);
    expect(pickPromptMatchIndex(ms, 11)).toBe(2);
    expect(pickPromptMatchIndex(ms, 30)).toBe(0);
    expect(pickPromptMatchIndex([], 0)).toBe(-1);
  });
  test('다음·이전은 끝에서 처음으로 돈다', () => {
    expect(stepPromptMatchIndex(2, 3, 1)).toBe(0);
    expect(stepPromptMatchIndex(0, 3, -1)).toBe(2);
    expect(stepPromptMatchIndex(1, 3, 1)).toBe(2);
    expect(stepPromptMatchIndex(0, 0, 1)).toBe(-1);
  });
  test('개수 표시', () => {
    expect(promptFindCountLabel('', -1, 0)).toBe('');
    expect(promptFindCountLabel('x', -1, 0)).toBe('없음');
    expect(promptFindCountLabel('x', 1, 4)).toBe('2 / 4');
  });
  test('고른 글자 미리 채우기 — 한 줄·100자 이하만', () => {
    expect(promptFindPrefill('blue hair', 0, 4)).toBe('blue');
    expect(promptFindPrefill('a\nb', 0, 3)).toBe('');
    expect(promptFindPrefill('x'.repeat(101), 0, 101)).toBe('');
    expect(promptFindPrefill('x'.repeat(100), 0, 100)).toHaveLength(100);
    expect(promptFindPrefill('abc', 1, 1)).toBe('');
  });
});

describe('바꾸기', () => {
  test('하나 바꾸기 — 결과 글자와 다음 자리 기준', () => {
    const r = replacePromptMatchAt('cat, dog, cat', 'cat', false, 10, 'fox')!;
    expect(r.text).toBe('cat, dog, fox');
    expect(r.caret).toEqual([10, 13]);
    expect(r.resumeFrom).toBe(13);
    expect(r.count).toBe(1);
  });
  test('그 자리가 더는 일치가 아니면 바꾸지 않는다', () => {
    expect(replacePromptMatchAt('cat, dog', 'cat', false, 5, 'x')).toBeNull();
  });
  test('바꾼 결과를 다시 훑지 않는다(하나 바꾸기 뒤 다음 자리는 바꾼 글자 뒤)', () => {
    const r = replacePromptMatchAt('a, a', 'a', false, 0, 'aa')!;
    expect(r.text).toBe('aa, a');
    const next = findPromptMatches(r.text, 'a', false);
    expect(next[pickPromptMatchIndex(next, r.resumeFrom)].start).toBe(4);
  });
  test('모두 바꾸기 — 한 번 훑기, 대소문자 토글 반영', () => {
    const r = replaceAllPromptMatches('Cat cat CAT', 'cat', false, 'cat cat')!;
    expect(r.text).toBe('cat cat cat cat cat cat');
    expect(r.count).toBe(3);
    const cs = replaceAllPromptMatches('Cat cat CAT', 'cat', true, 'dog')!;
    expect(cs.text).toBe('Cat dog CAT');
    expect(replaceAllPromptMatches('abc', 'x', false, 'y')).toBeNull();
  });
  test('바꿀 말이 비면 지우기', () => {
    expect(replaceAllPromptMatches('a, b, a', 'a, ', false, '')!.text).toBe('b, a');
    expect(replacePromptMatchAt('a, b', 'b', false, 3, '')!.text).toBe('a, ');
  });
});
