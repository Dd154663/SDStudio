// 가중치 조절·표시(PC Ctrl+휠·Ctrl+↑↓, 모바일 칩)가 ##주석## 표식을 깨뜨리지 않는다(결함 C).
// - 커서가 주석 밖이면 앞뒤 주석이 구획 경계(주석 끝 ~ 다음 주석 시작 사이에서만 쉼표 구획).
//   표식 바깥 경계(여는 `##` 바로 앞·닫는 `##` 바로 뒤)는 「밖」.
// - 커서가 주석 안(여는 `##` 바로 뒤 ~ 닫는 `##` 바로 앞, 안쪽 경계 포함)이면 그 주석 내용 안에서만 쉼표 구획.
// - 커서가 `##` 표식 두 글자 사이면 조절하지 않음(undefined).
// - 표식은 절대 감싸지 않는다 — 조절 뒤 주석 범위의 개수·내용(가중치 글자 제외)이 같다.
// 주석 토글(getPromptCommentAtSelection·togglePromptCommentAtSelection)은 종전 구획 그대로(promptTransforms.test.ts 가 고정).
import {
  adjustPromptWeightAtSelection,
  getPromptWeightAtSelection,
  PROMPT_WEIGHT_STEP,
} from '../promptTransforms';
import { promptCommentRanges } from '../promptCommentSyntax';

const up = (text: string, caret: number, end = caret) =>
  adjustPromptWeightAtSelection(text, caret, end, PROMPT_WEIGHT_STEP);

// 주석 내용(가중치 표식 글자를 걷은 것)
const commentBodies = (text: string) =>
  promptCommentRanges(text).map((r) =>
    text.slice(r.start, r.end).replace(/-?(?:\d+(?:\.\d*)?|\.\d+)::|::/g, ''),
  );

const expectCommentsKept = (before: string, after: string) => {
  expect(promptCommentRanges(after)).toHaveLength(promptCommentRanges(before).length);
  expect(commentBodies(after)).toEqual(commentBodies(before));
};

describe('주석 밖 커서 — 앞뒤 주석이 구획 경계', () => {
  test('aaa, ##bbb, ccc## ddd — ddd 에서 올리면 ddd 만', () => {
    const text = 'aaa, ##bbb, ccc## ddd';
    const caret = text.indexOf('ddd') + 1;
    const r = up(text, caret)!;
    expect(r.text).toBe('aaa, ##bbb, ccc## 1.05::ddd::');
    expect(r.text[r.selectionStart]).toBe('d');
    expect(r.text.slice(r.selectionStart - 1, r.selectionStart + 2)).toBe('ddd');
    expectCommentsKept(text, r.text);
    expect(getPromptWeightAtSelection(text, caret)).toEqual({ core: 'ddd', inner: 'ddd', weight: 1 });
  });

  test('##메모## tag — tag 만 감싼다', () => {
    const text = '##메모## tag';
    const r = up(text, text.length)!;
    expect(r.text).toBe('##메모## 1.05::tag::');
    expectCommentsKept(text, r.text);
  });

  test('주석 앞쪽 — tag##메모## 에서 tag 만', () => {
    const text = 'tag##메모##, x';
    const r = up(text, 1)!;
    expect(r.text).toBe('1.05::tag::##메모##, x');
    expectCommentsKept(text, r.text);
  });

  test('바깥 경계: 여는 ## 바로 앞·닫는 ## 바로 뒤는 「밖」', () => {
    const text = 'aa ##m## bb';
    const open = text.indexOf('##');
    const closeEnd = text.lastIndexOf('##') + 2;
    expect(up(text, open)!.text).toBe('1.05::aa:: ##m## bb');
    expect(getPromptWeightAtSelection(text, open)!.core).toBe('aa');
    expect(up(text, closeEnd)!.text).toBe('aa ##m## 1.05::bb::');
    // 주석 사이에 내용이 없으면 조절하지 않음
    expect(up('##a## ##b##', 5)).toBeUndefined();
    expect(up('##a##', 0)).toBeUndefined();
    expect(up('##a##', 5)).toBeUndefined();
  });

  test('기존 가중치 이어서 조절·1.0 이면 풀기도 주석 경계 안에서', () => {
    const text = '##m## 1.05::tag::';
    const caret = text.indexOf('tag');
    const r = up(text, caret)!;
    expect(r.text).toBe('##m## 1.1::tag::');
    const back = adjustPromptWeightAtSelection(text, caret, caret, -PROMPT_WEIGHT_STEP)!;
    expect(back.text).toBe('##m## tag');
    expect(getPromptWeightAtSelection(text, caret)!.weight).toBe(1.05);
  });
});

describe('주석 안 커서 — 그 주석 내용 안에서만', () => {
  test('aaa, ##bbb, ccc## ddd — ccc 에서 올리면 ccc 만(닫는 ## 는 그대로)', () => {
    const text = 'aaa, ##bbb, ccc## ddd';
    const caret = text.indexOf('ccc') + 1;
    const r = up(text, caret)!;
    expect(r.text).toBe('aaa, ##bbb, 1.05::ccc::## ddd');
    expect(r.text[r.selectionStart]).toBe('c');
    expectCommentsKept(text, r.text);
    expect(getPromptWeightAtSelection(text, caret)!.core).toBe('ccc');
  });

  test('bbb 에서 올리면 bbb 만(여는 ## 는 그대로)', () => {
    const text = 'aaa, ##bbb, ccc## ddd';
    const r = up(text, text.indexOf('bbb'))!;
    expect(r.text).toBe('aaa, ##1.05::bbb::, ccc## ddd');
    expectCommentsKept(text, r.text);
  });

  test('안쪽 경계: 여는 ## 바로 뒤·닫는 ## 바로 앞은 「안」', () => {
    const text = 'x, ##m, n## y';
    const innerStart = text.indexOf('##') + 2;
    const innerEnd = text.lastIndexOf('##');
    expect(up(text, innerStart)!.text).toBe('x, ##1.05::m::, n## y');
    expect(up(text, innerEnd)!.text).toBe('x, ##m, 1.05::n::## y');
    // 빈 주석
    expect(up('a ####', 4)).toBeUndefined();
  });

  test('여러 줄 주석 안에서도 내용 안 구획', () => {
    const text = 'a, ##one\ntwo, three## b';
    const r = up(text, text.indexOf('two'))!;
    expect(r.text).toBe('a, ##1.05::one\ntwo::, three## b');
    expectCommentsKept(text, r.text);
  });
});

describe('표식 위 커서 — 조절하지 않음', () => {
  test('여는·닫는 ## 두 글자 사이면 undefined', () => {
    const text = 'aaa, ##bbb## ccc';
    const open = text.indexOf('##');
    const close = text.lastIndexOf('##');
    expect(up(text, open + 1)).toBeUndefined();
    expect(up(text, close + 1)).toBeUndefined();
    expect(getPromptWeightAtSelection(text, open + 1)).toBeUndefined();
    expect(getPromptWeightAtSelection(text, close + 1)).toBeUndefined();
  });
});

describe('주석 없는 텍스트 — 결과 불변', () => {
  test.each([
    ['artist:aaa, artist:bbb', 15, 'artist:aaa, 1.05::artist:bbb::'],
    ['a, b', 3, 'a, 1.05::b::'],
    ['1.05::tag::', 7, '1.1::tag::'],
    ['tag ## lone, x', 2, '1.05::tag ## lone::, x'],
  ])('%s', (text, caret, expected) => {
    expect(up(text, caret)!.text).toBe(expected);
  });
});
