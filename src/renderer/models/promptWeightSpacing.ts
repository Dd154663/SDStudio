// NovelAI 가중치 구문 숫자 태그 공백 보정 — SPEC_GUIDE §12 「가중치 숫자 태그 공백(N1)」(2026-10-02).
//  · NAI 자체 버그: 양 끝 중 하나라도 숫자인 태그(예: 작가 0aaa0)를 `N::태그::` 로 감싸면 태그의 숫자가
//    가중치 숫자로 잘못 읽힌다. 회피 = 여는 `N::` 뒤와 닫는 `::` 앞에 공백 하나씩.
//    예: `1.5::0aaa0::` → `1.5:: 0aaa0 ::`
//  · NovelAI 로 보내는 최종 문자열(nai.ts generateImage)에만 적용한다. 편집기 원문·저장 데이터는 바꾸지 않는다.
//  · 멱등: 이미 공백이 있으면 더 넣지 않으므로 여러 번 적용해도 결과가 같다.
//  · 숫자 표기는 promptWeightSyntax 단일 출처(`2`·`1.5`·`1.`·`.6`·`-1`·`-.5`).

import { PROMPT_WEIGHT_NUMBER_SOURCE } from './promptWeightSyntax';

/** 문자열 끝에 붙은 가중치 숫자(가장 긴 것). 캡처 1 = 숫자. */
const WEIGHT_NUMBER_AT_END_RE = new RegExp(`(${PROMPT_WEIGHT_NUMBER_SOURCE})$`);

const DIGIT_RE = /\d/;

/** 줄바꿈이 아닌 공백(스페이스·탭 등). 줄바꿈은 태그 경계로 본다. */
function isInlineSpace(c: string): boolean {
  return c !== '\n' && c !== '\r' && /\s/.test(c);
}

function isSpace(c: string | undefined): boolean {
  return c !== undefined && /\s/.test(c);
}

/**
 * `::` 가 position p 에서 시작할 때, 바로 앞의 숫자가 여는 가중치 `N::` 인지.
 * 숫자가 태그의 시작 자리(문자열 처음·쉼표·`|`·줄바꿈·괄호·다른 `::` 뒤, 사이 공백 허용)에 있어야 한다.
 * `artist:0aaa0::` 의 `0` 이나 `year 2000::` 의 `2000` 처럼 태그 안의 숫자는 닫는 `::` 앞 글자일 뿐이다.
 * 반환: 여는 표식이면 숫자 시작 위치, 아니면 -1.
 */
function weightOpenerStart(text: string, p: number): number {
  const m = text.slice(0, p).match(WEIGHT_NUMBER_AT_END_RE);
  if (!m) return -1;
  const numStart = p - m[1].length;
  let i = numStart - 1;
  while (i >= 0 && isInlineSpace(text[i])) i -= 1;
  if (i < 0) return numStart;
  const c = text[i];
  if (c === ',' || c === '|' || c === '\n' || c === '\r') return numStart;
  if ('{}[]()'.includes(c)) return numStart;
  if (c === ':' && i > 0 && text[i - 1] === ':') return numStart;
  return -1;
}

interface WeightGroup {
  /** 여는 `N::` 의 숫자 시작 위치. */
  openerStart: number;
  /** 여는 `::` 바로 뒤(내용 시작). */
  contentStart: number;
  /** 닫는 `::` 시작 위치. 닫히지 않은 묶음이면 null(내용은 문자열 끝까지). */
  closeStart: number | null;
}

/** 문자열의 가중치 묶음을 찾는다(중첩 허용, 닫는 `::` 없는 묶음은 closeStart=null). */
export function findPromptWeightGroups(text: string): WeightGroup[] {
  const groups: WeightGroup[] = [];
  const stack: { openerStart: number; contentStart: number }[] = [];
  let p = text.indexOf('::');
  while (p >= 0) {
    const openerStart = weightOpenerStart(text, p);
    if (openerStart >= 0) {
      stack.push({ openerStart, contentStart: p + 2 });
    } else if (stack.length) {
      const open = stack.pop()!;
      groups.push({ ...open, closeStart: p });
    }
    // 여는 표식도 닫는 표식도 아닌 `::`(묶음 밖 잔여)는 건드리지 않는다.
    p = text.indexOf('::', p + 2);
  }
  for (const open of stack) groups.push({ ...open, closeStart: null });
  return groups;
}

/**
 * 가중치 묶음 내용의 양 끝(여는 `N::` 바로 뒤·닫는 `::` 바로 앞에 닿는 태그 글자)이 숫자이면
 * 그 묶음의 여는 쪽 뒤와 닫는 쪽 앞에 공백 하나씩을 보장한다. 양 끝 모두 숫자가 아니면 그대로.
 *  · 판단은 앞뒤 공백을 뺀 내용 기준. 쉼표로 여러 태그면 첫 태그 첫 글자·마지막 태그 마지막 글자.
 *  · `.hack` 처럼 `.` 으로 시작하는 태그는 숫자로 보지 않는다(`0.5x` 는 숫자 시작).
 *  · 내용이 중첩 여는 표식(`1.5::0.8::x::::` 의 `0.8::`)으로 시작하면 그 숫자는 태그가 아니므로 보지 않는다.
 *  · 멱등.
 */
export function padDigitEdgedWeightGroups(text: string): string {
  if (!text || text.indexOf('::') < 0) return text;
  const groups = findPromptWeightGroups(text);
  if (!groups.length) return text;
  const openerStarts = new Set(groups.map((g) => g.openerStart));
  const inserts = new Set<number>();
  for (const g of groups) {
    const end = g.closeStart ?? text.length;
    let a = g.contentStart;
    let b = end;
    while (a < b && isSpace(text[a])) a += 1;
    while (b > a && isSpace(text[b - 1])) b -= 1;
    if (a >= b) continue; // 빈 내용
    const firstIsTagDigit = DIGIT_RE.test(text[a]) && !openerStarts.has(a);
    // 내용이 `-1::` 같은 중첩 여는 표식으로 시작하면 첫 글자는 `-` 라 숫자가 아니므로 따로 볼 필요 없다.
    const lastIsDigit = DIGIT_RE.test(text[b - 1]);
    if (!firstIsTagDigit && !lastIsDigit) continue;
    if (!isSpace(text[g.contentStart])) inserts.add(g.contentStart);
    if (g.closeStart !== null && !isSpace(text[g.closeStart - 1])) {
      inserts.add(g.closeStart);
    }
  }
  if (!inserts.size) return text;
  const positions = [...inserts].sort((x, y) => x - y);
  let out = '';
  let prev = 0;
  for (const pos of positions) {
    out += text.slice(prev, pos) + ' ';
    prev = pos;
  }
  return out + text.slice(prev);
}
