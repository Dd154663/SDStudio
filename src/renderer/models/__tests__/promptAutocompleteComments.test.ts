// 자동완성 현재 단어의 ##주석## 경계(2026-11-21 포크 반영 묶음 4 결함 B).
// - 단어 경계 = 쉼표·줄바꿈 + 주석 경계(가중치 구획 weightSegmentOf 와 같은 promptCommentBoundsAt).
// - 편집기 두 벌(PC EmulatedEditTextArea·모바일 NativeEditTextArea)의 getCurWord·setCurWord 가 이 함수만 쓴다.
import * as fs from 'fs';
import * as path from 'path';
import {
  autocompleteWordAt,
  replaceAutocompleteWordAt,
} from '../promptAutocomplete';
import { promptCommentRanges } from '../promptCommentSyntax';

/** `|` 위치를 커서로. */
const at = (marked: string) => {
  const caret = marked.indexOf('|');
  if (caret < 0) throw new Error('no caret');
  return { text: marked.slice(0, caret) + marked.slice(caret + 1), caret };
};
const word = (marked: string, full = false) => {
  const { text, caret } = at(marked);
  return autocompleteWordAt(text, caret, full);
};
/** 교체 결과를 `|` 커서 표시와 함께. 교체 안 하면 undefined. */
const replace = (marked: string, w: string, full = false) => {
  const { text, caret } = at(marked);
  const r = replaceAutocompleteWordAt(text, caret, w, full);
  return r && r.text.slice(0, r.caret) + '|' + r.text.slice(r.caret);
};

// 고치기 전 네 곳(getCurWord·setCurWord ×2)의 「커서에서 쉼표·줄바꿈까지」 규칙 그대로.
const legacyWord = (text: string, start: number, full: boolean) => {
  let s = start;
  while (s > 0 && !',\n'.includes(text[s - 1])) s--;
  if (full) {
    let e = start;
    while (e < text.length && !',\n'.includes(text[e])) e++;
    return text.substring(s, e).trim();
  }
  return text.substring(s, start).trim();
};
const legacyReplace = (text: string, start: number, w: string, full: boolean) => {
  let s = start;
  while (s > 0 && !',\n'.includes(text[s - 1])) s--;
  let e = start;
  if (full) while (e < text.length && !',\n'.includes(text[e])) e++;
  if (s !== 0 && text[s - 1] !== '\n') w = ' ' + w;
  return { text: text.substring(0, s) + w + text.substring(e), caret: s + w.length };
};

describe('자동완성 단어 — 주석 밖', () => {
  test('앞 주석에서 끊는다', () => {
    expect(word('aaa, ##메모## bl|')).toBe('bl');
    expect(word('aaa, ##메모## bl|', true)).toBe('bl');
    expect(replace('aaa, ##메모## bl|', 'black')).toBe('aaa, ##메모## black|');
    expect(replace('aaa, ##메모## bl|', 'black', true)).toBe('aaa, ##메모## black|');
  });

  test('닫는 ## 바로 뒤는 종전 규칙대로 공백', () => {
    expect(word('##메모##bl|')).toBe('bl');
    expect(replace('##메모##bl|', 'black')).toBe('##메모## black|');
  });

  test('전체 단어 모드: 뒤 주석에서 끊고 주석 앞 공백은 지우지 않는다', () => {
    expect(word('aaa, bl|ue ##메모##', true)).toBe('blue');
    expect(replace('aaa, bl|ue ##메모##', 'black', true)).toBe('aaa, black| ##메모##');
    expect(replace('aaa, bl|ue##메모##', 'black', true)).toBe('aaa, black|##메모##');
  });

  test('기본 모드: 커서가 여는 ## 바로 앞이면 그 앞 공백은 지우지 않는다', () => {
    expect(word('aaa, blue |##m##')).toBe('blue');
    expect(replace('aaa, blue |##m##', 'black')).toBe('aaa, black| ##m##');
  });
});

describe('자동완성 단어 — 주석 안', () => {
  test('주석 내용 안에서만 구획', () => {
    expect(word('##bl|ue, red##')).toBe('bl');
    expect(word('##bl|ue, red##', true)).toBe('blue');
    expect(word('aaa, ##red, bl|ue## x', true)).toBe('blue');
    expect(word('aaa, ##red, bl|ue## x')).toBe('bl');
  });

  test('여는 ## 바로 뒤는 공백을 붙이지 않는다', () => {
    expect(replace('##bl|, red##', 'black')).toBe('##black|, red##');
    expect(replace('##bl|ue, red##', 'black', true)).toBe('##black|, red##');
  });

  test('주석 안 쉼표 뒤는 종전 규칙대로 공백, 닫는 ## 앞 공백은 남긴다', () => {
    expect(replace('##red,bl|##', 'black')).toBe('##red, black|##');
    expect(replace('##red, bl|ue ##', 'black', true)).toBe('##red, black| ##');
  });

  test('## 두 글자 사이면 검색어 없음·교체 안 함', () => {
    expect(word('a, #|#메모##')).toBe('');
    expect(word('a, ##메모#|#', true)).toBe('');
    expect(replace('a, #|#메모##', 'black')).toBeUndefined();
    expect(replace('a, ##메모#|#', 'black', true)).toBeUndefined();
  });
});

describe('자동완성 단어 — 여러 줄 주석·짝 없는 ##·글 끝', () => {
  test('여러 줄 주석', () => {
    expect(word('a, ##x\ny## b|')).toBe('b');
    expect(word('##x\nbl|ue##', true)).toBe('blue');
    expect(replace('##x\nbl|ue##', 'black', true)).toBe('##x\nblack|##');
    expect(word('##x, y\nz## bl|ue, c', true)).toBe('blue');
    expect(replace('##x, y\nz## bl|ue, c', 'black', true)).toBe('##x, y\nz## black|, c');
  });

  test('짝 없는 ## 는 주석이 아니므로 종전과 같다', () => {
    for (const marked of ['## bl|', 'a, ## bl|ue', 'a ##, bl|', '#|#', 'a## b|']) {
      const { text, caret } = at(marked);
      for (const full of [false, true]) {
        expect(autocompleteWordAt(text, caret, full)).toBe(legacyWord(text, caret, full));
        expect(replaceAutocompleteWordAt(text, caret, 'black', full)).toMatchObject(
          legacyReplace(text, caret, 'black', full),
        );
      }
    }
  });

  test('글 맨 앞·맨 끝', () => {
    expect(word('|')).toBe('');
    expect(replace('|', 'black')).toBe('black|');
    expect(replace('bl|', 'black')).toBe('black|');
    expect(replace('aaa, bl|', 'black')).toBe('aaa, black|');
    expect(replace('|##m##', 'black')).toBe('black|##m##');
    expect(replace('##m##|', 'black')).toBe('##m## black|');
    expect(replace('##|m##', 'black')).toBe('##black|m##');
    expect(replace('##m|##', 'black')).toBe('##black|##');
  });
});

describe('자동완성 단어 — 주석 없는 글은 종전과 완전히 같다', () => {
  test('무작위 입력 비교(기본·전체 단어 모드, 모든 커서 위치)', () => {
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const alpha = ['a', 'b', ' ', ' ', ',', '\n', '{', '1.2::', '<x>', '#', '\t'];
    for (let t = 0; t < 400; t++) {
      let text = '';
      const len = Math.floor(rnd() * 10);
      for (let i = 0; i < len; i++) text += alpha[Math.floor(rnd() * alpha.length)];
      if (promptCommentRanges(text).length > 0) continue;
      for (let caret = 0; caret <= text.length; caret++) {
        for (const full of [false, true]) {
          expect(autocompleteWordAt(text, caret, full)).toBe(legacyWord(text, caret, full));
          expect(replaceAutocompleteWordAt(text, caret, 'tag', full)).toMatchObject(
            legacyReplace(text, caret, 'tag', full),
          );
        }
      }
    }
  });
});

describe('편집기 두 벌이 같은 함수를 쓴다(소스 검사)', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../componenets/PromptEditTextArea.tsx'),
    'utf-8',
  );
  test("쉼표·줄바꿈 직접 판정(',\\n'.includes()이 남아 있지 않다", () => {
    expect(src).not.toMatch(/',\\n'\.includes\(/);
  });
  test('getCurWord 두 곳은 autocompleteWordAt, setCurWord 두 곳은 replaceAutocompleteWordAt', () => {
    expect(src.match(/autocompleteWordAt\(/g)).toHaveLength(2);
    expect(src.match(/replaceAutocompleteWordAt\(/g)).toHaveLength(2);
  });
});
