// 프롬프트 ##주석## 범위 규칙의 단일 출처(2026-11-21).
//  · 짝이 맞는 `##…##`(여러 줄·쉼표 포함 가능, 가장 가까운 닫는 `##` 까지). 짝 없는 `##` 하나는 글자 그대로.
//  · NAI 전송 직전 제거(PromptService.stripPromptComments), 주석 토글·가중치 조절의 범위 계산(promptTransforms),
//    랜덤 조각 줄 나누기(splitMultiPieceLines)가 모두 이 규칙을 쓴다.
//  · 다른 모델 모듈을 import 하지 않는다(PromptService ↔ promptTransforms 사이의 import 순환 방지).
//  · 저장 데이터는 원문 유지 — 이 모듈은 사본 문자열만 만든다.

const PROMPT_COMMENT_SOURCE = String.raw`##[\s\S]*?##`;

export interface PromptCommentRange {
  /** 여는 `##` 의 시작 위치. */
  start: number;
  /** 닫는 `##` 바로 뒤 위치. */
  end: number;
}

/** 짝이 맞는 주석들의 범위(앞에서부터, 겹치지 않음). */
export function promptCommentRanges(text: string): PromptCommentRange[] {
  const ranges: PromptCommentRange[] = [];
  const re = new RegExp(PROMPT_COMMENT_SOURCE, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  return ranges;
}

/** 커서가 속한 「주석 경계 안 구간」. */
export interface PromptCommentBounds {
  /** 구간 시작(앞 주석의 닫는 `##` 바로 뒤, 주석 안이면 여는 `##` 바로 뒤, 없으면 0). */
  lo: number;
  /** 구간 끝(다음 주석의 여는 `##`, 주석 안이면 닫는 `##`, 없으면 글 끝). */
  hi: number;
  /** 커서가 주석 내용 안이면 true. */
  inComment: boolean;
}

/**
 * 커서 위치의 주석 경계 구간 — 가중치 구획(promptTransforms.weightSegmentOf)과
 * 자동완성 단어(promptAutocomplete.autocompleteWordRangeAt)가 같은 규칙을 쓴다(2026-11-21).
 * - 커서가 주석 밖(여는 `##` 바로 앞·닫는 `##` 바로 뒤 포함)이면 앞 주석 끝 ~ 다음 주석 시작.
 * - 커서가 주석 안(여는 `##` 바로 뒤 ~ 닫는 `##` 바로 앞 포함)이면 그 주석 내용.
 * - 커서가 `##` 표식 두 글자 사이면 undefined.
 * caret 은 0 ~ text.length 로 맞춰 넘긴다. ranges 를 이미 구했으면 넘겨 다시 계산하지 않는다.
 */
export function promptCommentBoundsAt(
  text: string,
  caret: number,
  ranges: PromptCommentRange[] = promptCommentRanges(text),
): PromptCommentBounds | undefined {
  let lo = 0;
  let hi = text.length;
  for (const r of ranges) {
    if (caret === r.start + 1 || caret === r.end - 1) return undefined;
    if (r.start + 2 <= caret && caret <= r.end - 2) {
      return { lo: r.start + 2, hi: r.end - 2, inComment: true };
    }
    if (r.end <= caret) lo = r.end;
    else if (caret <= r.start) {
      hi = r.start;
      break;
    }
  }
  return { lo, hi, inComment: false };
}

/**
 * ##주석## 블록 제거.
 * - 여러 줄, 콤마 포함 가능 (non-greedy)
 * - 짝이 맞지 않는 단일 `##` 는 리터럴로 유지
 * - API 송신 직전에만 제거. 저장 데이터는 원문 유지.
 */
export function stripPromptComments(str: string): string {
  return str.replace(new RegExp(PROMPT_COMMENT_SOURCE, 'g'), '');
}

/**
 * 랜덤 조각(「이 중 한 줄 랜덤 선택」)의 후보 줄 — 생성(parseWord)과 미리보기(툴팁)가 같은 결과를 쓴다.
 * - 줄은 짝이 맞는 주석 **밖**의 줄바꿈(CRLF·CR·LF)에서만 나눈다(여러 줄 주석은 한 덩어리로 걷힌다).
 * - 각 줄은 주석을 걷은 글자. 주석이 있던 줄이 걷은 뒤 공백·쉼표만 남으면 후보에서 뺀다.
 * - 주석 없이 일부러 비운 줄은 후보로 남긴다(「아무것도 안 넣기」 선택지 — 종전 동작).
 */
export function splitMultiPieceLines(text: string): string[] {
  const ranges = promptCommentRanges(text);
  const lines: string[] = [];
  let current = '';
  let hadComment = false;
  const flush = () => {
    if (!(hadComment && current.replace(/[\s,]/g, '') === '')) lines.push(current);
    current = '';
    hadComment = false;
  };
  let r = 0;
  let i = 0;
  while (i < text.length) {
    if (r < ranges.length && i === ranges[r].start) {
      hadComment = true;
      i = ranges[r].end;
      r++;
      continue;
    }
    const ch = text[i];
    if (ch === '\r' || ch === '\n') {
      flush();
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    current += ch;
    i++;
  }
  flush();
  return lines;
}
