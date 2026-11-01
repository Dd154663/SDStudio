// 고정 시드 연쇄 — 장 번호로 시드를 정한다(부스트 모드 B0, 2026-10-29). 순수 모듈, 의존성 없음.
//
// 예약 1건(Task)은 예약 시점에 정한 시작 시드(job.seed)에서 장마다 stepSeed 를 한 번씩 적용한 연쇄를 쓴다:
// 0번째 = 시작 시드, k번째 = stepSeed 를 k번 적용한 값. 예전엔 성공할 때마다 job.seed 를 제자리에서
// 바꿨지만(job 변이), 이제 job 은 그대로 두고 「몇 번째 시드인가」(Task.seedCursor)만 세어
// seedForImageIndex 로 계산한다 — 여러 시도가 같은 작업을 나눠 처리해도(B1 워커 풀) 시작 시드가 흔들리지 않는다.
//
// 단일 실행 루프에서의 결과는 예전과 같다: 커서는 예전에 job.seed 를 전진시키던 바로 그 자리에서만 +1
// (성공·폐기 검사 통과 뒤), 실패·재시도·폐기면 그대로라 다음 시도는 같은 시드를 쓴다.
// 시작 시드가 없거나(랜덤) 0 이면 연쇄하지 않는다(예전 `if (job.seed)` 와 같음).

// 고정 시드 연속 생성 시 다음 시드 계산(xorshift32). NAI 시드 공간은 32비트
// 전체(0~4,294,967,295)다 — 과거의 % 2,100,000,000 접기는 임의 제한이라 제거
// (2026-07-25). 21억 이상 시드도 그대로 순회한다.
export function stepSeed(seed: number) {
  seed = seed >>> 0;
  seed ^= seed << 13;
  seed >>>= 0;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  seed >>>= 0;
  return Math.max(1, seed);
}

/** 이 시작 시드가 장마다 연쇄하는가 — 랜덤(undefined)·0 은 연쇄하지 않는다(예전 `if (job.seed)`). */
export function chainsSeed(baseSeed: number | undefined | null): baseSeed is number {
  return !!baseSeed;
}

/**
 * k번째 장(0부터)의 시드 = 시작 시드에 stepSeed 를 k번 적용한 값.
 * 연쇄하지 않는 시드(랜덤 undefined·0)는 그대로 돌려준다. k 가 정수가 아니거나 음수면 0으로 본다.
 * 계산은 O(k) — 한 작업의 장 수 범위(수천 이하)에서는 장마다 다시 계산해도 충분히 빠르다.
 */
export function seedForImageIndex<T extends number | undefined>(baseSeed: T, k: number): T {
  if (!chainsSeed(baseSeed)) return baseSeed;
  const n = Number.isFinite(k) && k > 0 ? Math.floor(k) : 0;
  let seed: number = baseSeed;
  for (let i = 0; i < n; i++) seed = stepSeed(seed);
  return seed as T;
}

/** 시드를 한 장 소비한 뒤의 커서 — 연쇄하지 않는 시드면 그대로(예전엔 job.seed 를 바꾸지 않던 경우). */
export function advanceSeedCursor(baseSeed: number | undefined | null, cursor: number | undefined): number {
  const cur = cursor ?? 0;
  return chainsSeed(baseSeed) ? cur + 1 : cur;
}
