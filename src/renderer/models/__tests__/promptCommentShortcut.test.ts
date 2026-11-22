// 편집기 안 Ctrl+3 주석 켜기/끄기(2026-11-22) — 「고른 범위 그대로」 경로(useSelectedText)와 단축키 분기.
// 모바일 # 칩 경로(인자 없음)는 promptTransforms.test.ts 가 그대로 고정한다.
import fs from 'fs';
import path from 'path';
import {
  isPromptCommentToggleKey,
  togglePromptCommentAtSelection,
} from '../promptTransforms';

const sel = (text: string, a: number, b: number) =>
  togglePromptCommentAtSelection(text, a, b, { useSelectedText: true });

describe('고른 범위 그대로 주석 토글(useSelectedText)', () => {
  test('여러 태그를 고르면 고른 범위 그대로 감싼다', () => {
    const text = '1girl, blue hair, smile, solo';
    const a = text.indexOf('blue');
    const b = text.indexOf('smile') + 'smile'.length;
    const r = sel(text, a, b)!;
    expect(r.text).toBe('1girl, ##blue hair, smile##, solo');
    // 감싼 뒤 선택은 안쪽 그대로 — 다시 누르면 풀린다
    expect(r.text.slice(r.selectionStart, r.selectionEnd)).toBe('blue hair, smile');
    const back = sel(r.text, r.selectionStart, r.selectionEnd)!;
    expect(back.text).toBe(text);
    expect(back.text.slice(back.selectionStart, back.selectionEnd)).toBe('blue hair, smile');
  });

  test('앞뒤 공백까지 고르면 공백은 주석 밖에 둔다', () => {
    const text = 'a,  b c  , d';
    const r = sel(text, 2, text.indexOf(', d'))!;
    expect(r.text).toBe('a,  ##b c##  , d');
    // 선택 양끝은 공백 자리에 그대로 — 다시 누르면 같은 주석을 푼다
    const back = sel(r.text, r.selectionStart, r.selectionEnd)!;
    expect(back.text).toBe(text);
  });

  test('공백만 고르면 아무것도 하지 않는다', () => {
    expect(sel('a,   , b', 2, 5)).toBeUndefined();
  });

  test('주석 안쪽 일부를 고르거나 주석째 고르면 그 주석을 푼다', () => {
    const text = 'x, ##memo one, two##, y';
    const inner = sel(text, text.indexOf('one'), text.indexOf('one') + 3)!;
    expect(inner.text).toBe('x, memo one, two, y');
    expect(inner.text.slice(inner.selectionStart, inner.selectionEnd)).toBe('one');
    const s = text.indexOf('##');
    const e = text.lastIndexOf('##') + 2;
    expect(sel(text, s, e)!.text).toBe('x, memo one, two, y');
    // 표식 안쪽까지만 고른 경우도 같은 주석
    expect(sel(text, s + 2, e - 2)!.text).toBe('x, memo one, two, y');
  });

  test('## 가 섞인 범위·짝이 바뀌는 범위는 거부한다', () => {
    const text = 'a, ##m##, b, c';
    // 주석과 그 밖을 함께 고름(범위 안에 완결 주석)
    expect(sel(text, text.indexOf('a'), text.indexOf('b') + 1)).toBeUndefined();
    // 주석에 걸쳐 고름(범위 안에 ## 하나)
    expect(sel(text, text.indexOf('m'), text.indexOf('b') + 1)).toBeUndefined();
    // 다른 곳의 짝 없는 ## 와 짝이 바뀜
    const loose = '## a, b, c';
    expect(sel(loose, loose.indexOf('b'), loose.indexOf('c') + 1)).toBeUndefined();
  });

  test('여러 줄을 고르면 줄바꿈째 감싼다', () => {
    const text = 'a,\nb, c\nd, e';
    const r = sel(text, text.indexOf('b'), text.indexOf('d') + 1)!;
    expect(r.text).toBe('a,\n##b, c\nd##, e');
    expect(sel(r.text, r.selectionStart, r.selectionEnd)!.text).toBe(text);
  });

  test('선택이 없으면 종전(모바일 칩)과 결과가 같다', () => {
    const cases: Array<[string, number]> = [
      ['1girl, blue hair, smile', 9],
      ['a, 1.2::x y::, b', 9],
      ['a,   b c  , d', 6],
      ['x, ##memo##, y', 5],
      ['a, ##b##', 2],
      ['tag,   , next', 6],
      ['a, b##c, d', 4],
      ['', 0],
    ];
    for (const [text, caret] of cases) {
      expect(sel(text, caret, caret)).toEqual(
        togglePromptCommentAtSelection(text, caret, caret),
      );
    }
  });

  test('선택 인자 없이 범위를 넘기면 종전처럼 커서 구획 기준(칩 동작 불변)', () => {
    const text = 'aa, bb, cc';
    expect(togglePromptCommentAtSelection(text, 5, 9)!.text).toBe('aa, ##bb##, cc');
    expect(sel(text, 4, 6)!.text).toBe('aa, ##bb##, cc');
    expect(sel(text, 4, 10)!.text).toBe('aa, ##bb, cc##');
  });
});

describe('Ctrl+3 단축키 판정', () => {
  test('Ctrl+3 만(code 또는 key), 다른 수정자·조합 중이면 아님', () => {
    expect(isPromptCommentToggleKey({ ctrlKey: true, code: 'Digit3', key: '3' })).toBe(true);
    expect(isPromptCommentToggleKey({ ctrlKey: true, key: '3' })).toBe(true);
    expect(isPromptCommentToggleKey({ ctrlKey: true, code: 'Digit3', key: '#' })).toBe(true);
    expect(isPromptCommentToggleKey({ key: '3', code: 'Digit3' })).toBe(false);
    expect(isPromptCommentToggleKey({ ctrlKey: true, shiftKey: true, code: 'Digit3' })).toBe(false);
    expect(isPromptCommentToggleKey({ ctrlKey: true, altKey: true, code: 'Digit3' })).toBe(false);
    expect(isPromptCommentToggleKey({ ctrlKey: true, metaKey: true, code: 'Digit3' })).toBe(false);
    expect(isPromptCommentToggleKey({ ctrlKey: true, code: 'Digit3', isComposing: true })).toBe(false);
    expect(isPromptCommentToggleKey({ ctrlKey: true, code: 'Digit3', keyCode: 229 })).toBe(false);
    expect(
      isPromptCommentToggleKey({ ctrlKey: true, code: 'Digit3', nativeEvent: { isComposing: true } }),
    ).toBe(false);
    expect(isPromptCommentToggleKey({ ctrlKey: true, code: 'Digit4', key: '4' })).toBe(false);
  });

  test('두 편집기(PC CursorMemorizeEditor·모바일 NativeEditTextArea)에 분기가 있다', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../componenets/PromptEditTextArea.tsx'),
      'utf8',
    );
    const pc = src.slice(src.indexOf('class CursorMemorizeEditor'), src.indexOf('const PromptAutoComplete'));
    expect(pc).toMatch(/async handleKeyDown\(e: any\) \{\s*\/\/[^\n]*\n\s*if \(isPromptCommentToggleKey\(e\)\)/);
    expect(pc).toContain('useSelectedText: true');
    expect(pc).toContain('this.pushHistory();');
    const native = src.slice(src.indexOf('const NativeEditTextArea'));
    const onKeyDown = native.slice(native.indexOf('onKeyDown='));
    expect(onKeyDown.slice(0, 600)).toContain('isPromptCommentToggleKey(e)');
    expect(onKeyDown.slice(0, 900)).toContain('{ useSelectedText: true }');
    // 키보드 위 # 칩(toggleComment)은 종전 인자 그대로
    const chip = native.slice(native.indexOf('const toggleComment'), native.indexOf('const doUndo'));
    expect(chip).not.toContain('useSelectedText');
  });
});
