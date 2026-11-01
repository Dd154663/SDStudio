// 생성 결과 파일명 할당기(부스트 모드 B0, 2026-10-29) — 순수 모듈, 의존성은 imageFormats 뿐.
//
// 결과 파일명은 예전부터 「저장 시각(ms) 숫자 + .png」 이다(이미지 목록은 파일명 자연 정렬 = 생성 순서).
// 같은 ms 에 두 요청이 파일명을 받으면 같은 경로가 되어 나중 결과가 앞 결과를 원자 교체로 덮고
// 씬 추가는 중복으로 무시돼 1장이 조용히 사라진다. 그래서 같은 프로세스 안에서는
// max(현재 시각, 직전에 준 값 + 1) 로 항상 증가하는 숫자를 준다 — 숫자 이름·자연 정렬·확장자는 그대로.
//
// 상태는 이 renderer 프로세스 하나에 하나다. 생성 실행은 호스트 창 한 곳에서만 돌므로(보조 창은 위임)
// 창마다 상태가 따로여도 같은 큐 안에서는 충돌하지 않는다.

import { PNG_IMAGE_EXT } from './imageFormats';

let lastIssued = 0;

/** 다음 결과 파일 타임스탬프 — 같은 ms 연속 호출·시계 역행에도 직전보다 항상 크다. */
export function nextOutputTimestamp(now: number = Date.now()): number {
  const base = Number.isFinite(now) ? Math.floor(now) : 0;
  const next = Math.max(base, lastIssued + 1);
  lastIssued = next;
  return next;
}

/** 결과 PNG 경로 = 출력 폴더/단조 증가 타임스탬프.PNG_IMAGE_EXT (생성·증강·배경 제거 공용). */
export function nextOutputPngPath(outputDir: string, now?: number): string {
  return outputDir + '/' + nextOutputTimestamp(now) + '.' + PNG_IMAGE_EXT;
}

/** 테스트 전용 — 할당기 상태를 처음으로 되돌린다. */
export function resetOutputTimestampForTest(): void {
  lastIssued = 0;
}
