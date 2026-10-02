// NAI 명시 가중치(N::내용::)의 숫자 표기 단일 출처 — SPEC_GUIDE 「가중치 숫자 표기」(2026-10-02).
//  · 허용 표기: 2 · 1.5 · 1. · .6(= 0.6, 0 생략) · -1 · -.5 · -0.8
//  · 하이라이트·가중치 칩/단축키 조절·작가 태그 구획 파싱·자동완성이 모두 이 표기를 쓴다.
//  · 표시·조정 로직 전용이다. NovelAI 로 보내는 프롬프트 문자열은 이 모듈로 바꾸지 않는다.
//    (예외 하나: 숫자로 시작/끝나는 태그의 공백 보정은 promptWeightSpacing.ts 가 nai.ts 전송 직전에만 한다 — N1.)

/** 가중치 숫자 정규식 원문(캡처 그룹 없음). 다른 정규식에 끼워 쓴다. */
export const PROMPT_WEIGHT_NUMBER_SOURCE = String.raw`-?(?:\d+(?:\.\d*)?|\.\d+)`;

/** 문자열 맨 앞의 여는 가중치 표식 `N::`(뒤 공백은 포함하지 않음). 캡처 1 = 숫자. */
export const PROMPT_WEIGHT_OPEN_AT_START_RE = new RegExp(
  `^(${PROMPT_WEIGHT_NUMBER_SOURCE})::`,
);

/** 하이라이트용 `N::…::` 전역 검색 정규식을 새로 만든다(lastIndex 상태가 있어 호출마다 새로). 캡처 1 = 숫자. */
export function makeExplicitWeightRangeRegex(): RegExp {
  return new RegExp(`(${PROMPT_WEIGHT_NUMBER_SOURCE})::[\\s\\S]*?::`, 'g');
}

/** 가중치 숫자 표기를 수치로. `.6`→0.6, `-.5`→-0.5, `1.`→1. 표기가 아니면 NaN. */
export function parsePromptWeightNumber(raw: string): number {
  const t = raw.trim();
  if (!new RegExp(`^${PROMPT_WEIGHT_NUMBER_SOURCE}$`).test(t)) return NaN;
  return Number(t);
}
