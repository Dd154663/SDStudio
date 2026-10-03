/**
 * NovelAI 요청 타임아웃·재시도 대기·`/user/data` 조회 단일 출처
 * (2026-10-03 정비 갈래 T2 — 「결함 수정만 복구」, 사용자 결정 2차).
 *
 * 요청 사이 지연(`config.delayTime` 에 배수를 곱하는 `handleNAIDelay`)은 이 모듈이 다루지 않는다 —
 * 5.4.0 과 같은 구조를 그대로 둔다(재검토 중). 여기의 재시도 대기는 그 지연 「앞에」 더해진다.
 *
 * ── 타임아웃 ──
 *  · 안쪽 요청 타임아웃 T = 120초에서 시작, 같은 작업이 「타임아웃으로」 실패할 때마다 +60초
 *    (상한 300초). 5xx·네트워크 등 다른 실패는 늘리지 않는다. PC·Android 공통.
 *  · 큐 바깥 타임아웃 = T + 10초(안쪽이 먼저 판정). 바깥이 끝나면 시도를 abort 해 진행 중 요청을 끊는다.
 *  · `/user/data` 계열 조회 = 30초(본문 읽기 포함).
 *
 * ── 오류 재시도 대기(연타 방지) ──
 *  · 한 작업 안에서 재시도 가능한 실패 뒤 다음 시도 전 대기 = 실패 횟수 사다리
 *    5→10→20→40→60초(상한 60초) ±20% 무작위. 429 는 종전 60초를 최소값으로 유지.
 *
 * ── `/user/data` 연속 조회 방지 ──
 *  · 같은 키(토큰)의 조회가 10초 안에 다시 오면 직전 성공 결과를 재사용, 진행 중이면 그 Promise 공유.
 *    `force` 는 캐시를 건너뛰고 새로 읽는다(결과는 다시 캐시). 실패는 캐시하지 않는다.
 *
 * 이 모듈은 서비스·backend 를 import 하지 않는다(순수 계산·형식만, jest: requestTiming.test.ts).
 */

// ── 타임아웃 ──

export const REQUEST_TIMEOUT_BASE_MS = 120_000;
export const REQUEST_TIMEOUT_STEP_MS = 60_000;
export const REQUEST_TIMEOUT_MAX_MS = 300_000;
/** 큐 바깥 타임아웃 = 안쪽 + 이 값(안쪽이 먼저 정상 판정). */
export const QUEUE_TIMEOUT_MARGIN_MS = 10_000;
/** `/user/data`(잔량·할당량·토큰 검증) 조회 타임아웃. */
export const USER_DATA_TIMEOUT_MS = 30_000;

/** 같은 작업의 타임아웃 실패 횟수 → 이번 시도의 안쪽 요청 타임아웃(120→180→240→300→300…). */
export function nextRequestTimeoutMs(timeoutFailures: number): number {
  const n = Number.isFinite(timeoutFailures) ? Math.max(0, Math.floor(timeoutFailures)) : 0;
  return Math.min(REQUEST_TIMEOUT_MAX_MS, REQUEST_TIMEOUT_BASE_MS + n * REQUEST_TIMEOUT_STEP_MS);
}

/** 큐 바깥 타임아웃 = 안쪽 + 10초. */
export function queueAttemptTimeoutMs(requestTimeoutMs: number): number {
  return requestTimeoutMs + QUEUE_TIMEOUT_MARGIN_MS;
}

/** fetcher 로 넘기는 요청 옵션(호출별 타임아웃·취소 신호). */
export interface NaiRequestOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** 요청 타임아웃 실패. 재시도 대상이며 큐는 다음 시도의 타임아웃을 늘린다. */
export class RequestTimeoutError extends Error {
  readonly kind = 'timeout' as const;
  readonly retryable = true;
  readonly timeoutMs: number;
  constructor(timeoutMs: number, scope: 'request' | 'queue' = 'request') {
    super(
      `${scope === 'queue' ? '작업' : '요청'} 시간 초과 (${Math.round(timeoutMs / 1000)}초)`,
    );
    this.name = 'RequestTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export function isRequestTimeoutError(e: unknown): boolean {
  if (e instanceof RequestTimeoutError) return true;
  const err = e as any;
  return !!err && (err.kind === 'timeout' || err.name === 'TimeoutError');
}

/** 폐기된(바깥 타임아웃 등) 시도가 계속 진행하지 않도록 끊는다. */
export class StaleAttemptError extends Error {
  readonly retryable = true;
  constructor() {
    super('이전 시도가 폐기돼 결과를 버렸습니다');
    this.name = 'StaleAttemptError';
  }
}

export function throwIfAborted(signal: AbortSignal | undefined | null): void {
  if (signal?.aborted) throw new StaleAttemptError();
}

/**
 * 시간 제한이 있는 요청. 시간이 다 되면 signal 을 abort 하고 RequestTimeoutError 로 즉시
 * 실패한다. Android 의 CapacitorHttp 가 가로챈 fetch 는 signal 을 무시할 수 있어, abort 와
 * 별개로 경쟁(race)으로 반드시 끝낸다. outerSignal(큐 시도의 폐기 신호)이 abort 되면 같이
 * 끊고 StaleAttemptError 로 실패한다.
 */
export function withRequestTimeout<T>(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
  outerSignal?: AbortSignal | null,
): Promise<T> {
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const onOuterAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      controller.abort();
      reject(new StaleAttemptError());
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      outerSignal?.removeEventListener('abort', onOuterAbort);
      controller.abort();
      reject(new RequestTimeoutError(timeoutMs));
    }, timeoutMs);
    if (outerSignal?.aborted) {
      onOuterAbort();
      return;
    }
    outerSignal?.addEventListener('abort', onOuterAbort);
    const cleanup = () => {
      clearTimeout(timer);
      outerSignal?.removeEventListener('abort', onOuterAbort);
    };
    let p: Promise<T>;
    try {
      p = run(controller.signal);
    } catch (e) {
      p = Promise.reject(e);
    }
    p.then(
      (v) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(v);
      },
      (e) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(e);
      },
    );
  });
}

// ── 오류 재시도 대기(연타 방지) ──

/** 실패 1회째 뒤 대기(이후 2배씩). */
export const RETRY_BACKOFF_BASE_MS = 5_000;
/** 사다리 상한. */
export const RETRY_BACKOFF_MAX_MS = 60_000;
/** ±무작위 폭(비율). */
export const RETRY_BACKOFF_JITTER_RATIO = 0.2;
/** 429(요청 제한) 뒤 최소 대기 — 종전 고정 60초를 하한으로 유지. */
export const RATE_LIMIT_MIN_WAIT_MS = 60_000;

/**
 * 같은 작업에서 실패한 횟수(1부터) → 다음 시도 전 대기(ms).
 * 사다리 5→10→20→40→60→60…초에 ±20% 무작위(rand 는 [0,1) 난수, 주입 가능).
 * 0 이하·NaN 은 1회째로 본다.
 */
export function retryBackoffMs(
  failureCount: number,
  rand: () => number = Math.random,
): number {
  const n = Number.isFinite(failureCount) ? Math.max(1, Math.floor(failureCount)) : 1;
  // 2^(n-1) 이 너무 커지지 않게 지수를 자른다(상한 60초라 6 이면 충분).
  const step = Math.min(
    RETRY_BACKOFF_MAX_MS,
    RETRY_BACKOFF_BASE_MS * Math.pow(2, Math.min(n - 1, 6)),
  );
  const offset = (rand() * 2 - 1) * RETRY_BACKOFF_JITTER_RATIO;
  return Math.max(0, Math.round(step * (1 + offset)));
}

/** 재시도 전 대기: 429 면 max(사다리, 60초), 그 외는 사다리 그대로. */
export function retryWaitMs(
  failureCount: number,
  rateLimited: boolean,
  rand: () => number = Math.random,
): number {
  const ladder = retryBackoffMs(failureCount, rand);
  return rateLimited ? Math.max(ladder, RATE_LIMIT_MIN_WAIT_MS) : ladder;
}

/**
 * 정지 가능한 대기. shouldStop 이 참이 되면(폴링 간격 pollMs) 남은 시간을 버리고 false 로
 * 끝난다. 끝까지 기다렸으면 true.
 */
export async function sleepUnlessStopped(
  ms: number,
  shouldStop: () => boolean,
  pollMs = 250,
): Promise<boolean> {
  const end = Date.now() + Math.max(0, ms);
  while (true) {
    if (shouldStop()) return false;
    const left = end - Date.now();
    if (left <= 0) return true;
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(pollMs, left)));
  }
}

// ── `/user/data` 연속 조회 방지 ──

/** 같은 토큰의 `/user/data` 성공 결과를 재사용하는 시간. */
export const USER_DATA_CACHE_MS = 10_000;

export interface RecentRequestOptions {
  /** 캐시·진행 중 조회를 건너뛰고 새로 읽는다(결과는 다시 캐시). */
  force?: boolean;
}

/**
 * 키별 최근 성공 결과 재사용 + 진행 중 조회 합치기.
 *  · 같은 키가 windowMs 안에 다시 오면 직전 성공 값을 돌려준다(요청 없음).
 *  · 진행 중인 조회가 있으면 새로 보내지 않고 그 Promise 를 공유한다(실패도 공유).
 *  · force 는 둘 다 건너뛴다. 실패는 캐시하지 않는다(다음 호출이 새로 읽는다).
 *  · 진행 중에 force 조회가 시작되면, 앞선 조회가 늦게 끝나도 force 결과를 덮지 않는다.
 */
export class RecentRequestCache<T> {
  private readonly entries = new Map<string, { value: T; at: number; seq: number }>();
  private readonly inFlight = new Map<string, { seq: number; promise: Promise<T> }>();
  private seq = 0;

  constructor(
    private readonly windowMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get(key: string, load: () => Promise<T>, options?: RecentRequestOptions): Promise<T> {
    const force = options?.force === true;
    if (!force) {
      const hit = this.entries.get(key);
      if (hit && this.now() - hit.at < this.windowMs) return Promise.resolve(hit.value);
      const pending = this.inFlight.get(key);
      if (pending) return pending.promise;
    }
    this.prune();
    const seq = ++this.seq;
    let promise: Promise<T>;
    try {
      promise = load();
    } catch (e) {
      promise = Promise.reject(e);
    }
    const tracked = promise.then(
      (value) => {
        // 더 나중에 시작한 조회(force)가 있으면 그 결과를 우선한다.
        if (this.inFlight.get(key)?.seq === seq) this.inFlight.delete(key);
        const prev = this.entries.get(key);
        if (!prev || prev.seq <= seq) {
          this.entries.set(key, { value, at: this.now(), seq });
        }
        return value;
      },
      (e) => {
        if (this.inFlight.get(key)?.seq === seq) this.inFlight.delete(key);
        throw e;
      },
    );
    this.inFlight.set(key, { seq, promise: tracked });
    return tracked;
  }

  /** 키 하나(또는 전부)의 캐시를 버린다. 진행 중 조회는 그대로 둔다. */
  invalidate(key?: string): void {
    if (key === undefined) this.entries.clear();
    else this.entries.delete(key);
  }

  // 오래된 항목 정리(토큰 문자열을 오래 쥐고 있지 않게).
  private prune(): void {
    const t = this.now();
    this.entries.forEach((entry, key) => {
      if (t - entry.at >= this.windowMs) this.entries.delete(key);
    });
  }
}
