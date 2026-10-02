import {
  findPromptWeightGroups,
  padDigitEdgedWeightGroups,
} from '../promptWeightSpacing';
import {
  hasArtistNamed,
  joinPromptSegment,
  parsePromptSegment,
  prefixedArtistNameOfSegment,
} from '../artistTags';
import { makeExplicitWeightRangeRegex } from '../promptWeightSyntax';
import {
  adjustPromptWeightAtSelection,
  getPromptWeightAtSelection,
} from '../promptTransforms';

const pad = padDigitEdgedWeightGroups;

describe('padDigitEdgedWeightGroups — 숫자로 시작/끝나는 태그의 가중치 묶음 공백(N1)', () => {
  test('사용자 예시: 양 끝이 숫자인 작가 태그', () => {
    expect(pad('1.5::0aaa0::')).toBe('1.5:: 0aaa0 ::');
  });

  test('첫 글자만 숫자', () => {
    expect(pad('1.5::0aaa::')).toBe('1.5:: 0aaa ::');
    expect(pad('1.2::1girl::, solo')).toBe('1.2:: 1girl ::, solo');
  });

  test('마지막 글자만 숫자(artist:0aaa0 처럼 접두 있는 태그 포함)', () => {
    expect(pad('1.5::aaa0::')).toBe('1.5:: aaa0 ::');
    expect(pad('1.5::artist:0aaa0::')).toBe('1.5:: artist:0aaa0 ::');
    expect(pad('1.5::year 2000::')).toBe('1.5:: year 2000 ::');
  });

  test('이미 공백이 있으면 그대로(멱등)', () => {
    expect(pad('1.5:: 0aaa0 ::')).toBe('1.5:: 0aaa0 ::');
    const once = pad('a, 1.5::0aaa0::, 2::b9, c::, -1::3d::');
    expect(pad(once)).toBe(once);
    expect(pad(pad(pad('1.5::0aaa0')))).toBe('1.5:: 0aaa0');
  });

  test('한쪽만 공백이 있으면 빠진 쪽만 채운다', () => {
    expect(pad('1.5:: 0aaa0::')).toBe('1.5:: 0aaa0 ::');
    expect(pad('1.5::0aaa0 ::')).toBe('1.5:: 0aaa0 ::');
  });

  test('여러 묶음을 각각 판단한다', () => {
    expect(pad('1.5::0aaa0::, 2::girl::, 0.8::b2::')).toBe(
      '1.5:: 0aaa0 ::, 2::girl::, 0.8:: b2 ::',
    );
  });

  test('묶음 밖 숫자 태그는 바꾸지 않는다', () => {
    expect(pad('0aaa0, 1girl, 2::solo::, artist:abc9')).toBe(
      '0aaa0, 1girl, 2::solo::, artist:abc9',
    );
  });

  test('여러 태그 묶음: 첫 태그 첫 글자·마지막 태그 마지막 글자 기준', () => {
    expect(pad('1.5::artist:aaa, artist:bbb9::')).toBe(
      '1.5:: artist:aaa, artist:bbb9 ::',
    );
    expect(pad('1.5::1girl, solo::')).toBe('1.5:: 1girl, solo ::');
    // 가운데 태그만 숫자면 그대로
    expect(pad('1.5::aaa, 0bbb0, ccc::')).toBe('1.5::aaa, 0bbb0, ccc::');
  });

  test('닫는 :: 없는 열린 묶음은 여는 쪽 뒤에만 공백', () => {
    expect(pad('1.5::0aaa0')).toBe('1.5:: 0aaa0');
    expect(pad('a, 1.5::b, c9')).toBe('a, 1.5:: b, c9');
    expect(pad('1.5::abc')).toBe('1.5::abc');
  });

  test('음수·0 생략 가중치 표기', () => {
    expect(pad('-1::0aaa0::')).toBe('-1:: 0aaa0 ::');
    expect(pad('.6::0aaa0::')).toBe('.6:: 0aaa0 ::');
    expect(pad('-.5::x9::')).toBe('-.5:: x9 ::');
    expect(pad('1.::9x::')).toBe('1.:: 9x ::');
  });

  test('숫자 태그가 없으면 바꾸지 않는다', () => {
    const s = '1.5::artist:aaa, artist:bbb::, {masterpiece}, [bad], -2::ugly::';
    expect(pad(s)).toBe(s);
  });

  test('빈 문자열·:: 없는 문자열·빈 묶음', () => {
    expect(pad('')).toBe('');
    expect(pad('1girl, 2b, score_9')).toBe('1girl, 2b, score_9');
    expect(pad('1.5::::')).toBe('1.5::::');
    expect(pad('1.5::  ::')).toBe('1.5::  ::');
  });

  test('중첩 묶음: 안쪽 여는 숫자는 태그로 보지 않는다', () => {
    expect(pad('1.5::0.8::x::::')).toBe('1.5::0.8::x::::');
    expect(pad('1.5::a, 0.8::0b::, c::')).toBe('1.5::a, 0.8:: 0b ::, c::');
    // 바깥 묶음 마지막 태그가 숫자로 끝나면 바깥 여는 쪽 뒤에도 공백(안쪽 여는 표식 앞 공백은 무해)
    expect(pad('2::0.5::9a::, c3::')).toBe('2:: 0.5:: 9a ::, c3 ::');
    expect(pad('2::0.5::9a::, 3c::')).toBe('2::0.5:: 9a ::, 3c::');
  });

  test('{}·[] 병용: 괄호 안 묶음은 보정, 괄호에 닿은 묶음은 그대로', () => {
    expect(pad('{1.5::0aaa0::}')).toBe('{1.5:: 0aaa0 ::}');
    expect(pad('[[2::a1::]]')).toBe('[[2:: a1 ::]]');
    expect(pad('1.5::{0aaa0}::')).toBe('1.5::{0aaa0}::');
  });

  test('.hack 처럼 점으로 시작하는 태그는 숫자로 보지 않고 0.5x 는 숫자 시작', () => {
    expect(pad('1.5::.hack::')).toBe('1.5::.hack::');
    expect(pad('1.5::0.5x::')).toBe('1.5:: 0.5x ::');
  });

  test('태그 안 숫자와 :: 가 붙은 묶음 밖 잔여 :: 는 여는 표식으로 보지 않는다', () => {
    expect(pad('score_9::, a')).toBe('score_9::, a');
    expect(pad('artist:abc0::')).toBe('artist:abc0::');
  });

  test('줄바꿈·| 경계 뒤의 여는 표식도 인식', () => {
    expect(pad('a\n1.5::0aaa0::')).toBe('a\n1.5:: 0aaa0 ::');
    expect(pad('{a|1.5::0b::}')).toBe('{a|1.5:: 0b ::}');
  });
});

describe('공백 보정 형태(1.5:: 0aaa0 ::)를 편집기 쪽 파서가 올바로 읽는다', () => {
  test('작가 구획 파싱·작가 이름 추출', () => {
    const parts = parsePromptSegment('1.5:: artist:0aaa0 ::');
    expect(parts.core).toBe('artist:0aaa0');
    expect(joinPromptSegment(parts)).toBe('1.5:: artist:0aaa0 ::');
    expect(prefixedArtistNameOfSegment('1.5:: artist:0aaa0 ::')).toBe('0aaa0');
    expect(hasArtistNamed('a, 1.5:: artist:aaa, artist:0bbb0 ::', '0bbb0')).toBe(true);
  });

  test('하이라이트 가중치 범위·숫자', () => {
    const re = makeExplicitWeightRangeRegex();
    const m = re.exec('x, 1.5:: 0aaa0 ::, y');
    expect(m?.[0]).toBe('1.5:: 0aaa0 ::');
    expect(m?.[1]).toBe('1.5');
  });

  test('가중치 칩 표시·조절(1.0 으로 풀면 안쪽 공백 제거)', () => {
    const text = 'a, 1.05:: 0aaa0 ::';
    const info = getPromptWeightAtSelection(text, 12);
    expect(info?.weight).toBe(1.05);
    expect(info?.inner).toBe('0aaa0');
    const up = adjustPromptWeightAtSelection(text, 12, 12, 0.05)!;
    expect(up.text).toBe('a, 1.1:: 0aaa0 ::');
    const down = adjustPromptWeightAtSelection(text, 12, 12, -0.05)!;
    expect(down.text).toBe('a, 0aaa0');
    expect(down.selectionStart).toBeGreaterThanOrEqual(3);
    expect(down.selectionStart).toBeLessThanOrEqual(8);
  });
});

describe('findPromptWeightGroups', () => {
  test('여는 위치·내용 시작·닫는 위치', () => {
    expect(findPromptWeightGroups('x, 1.5::a9::')).toEqual([
      { openerStart: 3, contentStart: 8, closeStart: 10 },
    ]);
    expect(findPromptWeightGroups('1.5::a')).toEqual([
      { openerStart: 0, contentStart: 5, closeStart: null },
    ]);
  });
});
