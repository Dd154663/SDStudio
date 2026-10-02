/**
 * 요청 지연·타임아웃 단일 출처 (2026-10-03 정비 묶음 갈래 T, 사용자 결정 1차).
 *
 * ── 요청 사이 지연 ──
 *  · 실제 대기 = max(0, 기본 지연 + uniform(-랜덤, +랜덤)). 모든 NAI 요청 시도 앞에서 같은 식을
 *    쓴다(편집기 즉시 생성·재시도 포함). 종전의 배수 구조(즉시 1×·재시도 1~4×·일반 6~9×·
 *    2% 확률 12~18×)는 폐지.
 *  · config 키: `requestDelayMs`(0~10000, 없으면 1000) · `requestDelayJitterMs`(0~5000, 없으면 0).
 *    옛 키 `delayTime` 은 이어받지 않는다(5.4.0 이하에서 올라오면 처음엔 기본 1초).
 *  · 하위 호환: 저장할 때마다 옛 키 `delayTime` 에 min(requestDelayMs, 1000) 을 함께 쓴다 —
 *    5.4.0 이하로 롤백해도 옛 배수 로직이 1000 초과 값을 곱하지 않는다.
 *  · 주기적 긴 휴식: 성공 500~600장마다 5~7.5분. 기본 지연과 랜덤 지연이 둘 다 0 이면 쉬지 않는다.
 *
 * ── 타임아웃 ──
 *  · 안쪽 요청 타임아웃 T = 120초에서 시작, 같은 작업이 「타임아웃으로」 실패할 때마다 +60초
 *    (상한 300초). 5xx·네트워크 등 다른 실패는 늘리지 않는다.
 *  · 큐 바깥 타임아웃 = T + 10초(안쪽이 먼저 판정). 바깥이 끝나면 시도를 abort 해 진행 중 요청을 끊는다.
 *  · `/user/data` 계열 조회 = 30초.
 *
 * 이 모듈은 서비스·backend 를 import 하지 않는다(순수 계산·형식만, jest: requestTiming.test.ts).
 */
import type { Config } from '../../main/config';

// ── 요청 사이 지연 ──

export const REQUEST_DELAY_DEFAULT_MS = 1000;
export const REQUEST_DELAY_MAX_MS = 10_000;
export const REQUEST_DELAY_JITTER_DEFAULT_MS = 0;
export const REQUEST_DELAY_JITTER_MAX_MS = 5_000;
/** 설정 슬라이더 단위(0.1초). */
export const REQUEST_DELAY_STEP_MS = 100;
/** 옛 키 `delayTime` 에 병기하는 값의 상한(5.4.0 이하 슬라이더 범위). */
export const LEGACY_DELAY_TIME_MAX_MS = 1000;

export interface RequestDelaySettings {
  baseMs: number;
  jitterMs: number;
}

function clampMs(v: unknown, max: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(0, Math.round(v)));
}

/** 저장값 → 기본 지연(ms). 없음·NaN·문자열 = 1000, 음수 = 0, 상한 초과 = 10000. */
export function normalizeRequestDelayMs(v: unknown): number {
  return clampMs(v, REQUEST_DELAY_MAX_MS, REQUEST_DELAY_DEFAULT_MS);
}

/** 저장값 → 랜덤 지연 폭(ms). 없음·NaN = 0, 음수 = 0, 상한 초과 = 5000. */
export function normalizeRequestDelayJitterMs(v: unknown): number {
  return clampMs(v, REQUEST_DELAY_JITTER_MAX_MS, REQUEST_DELAY_JITTER_DEFAULT_MS);
}

/** config 에서 지연 설정을 읽는다(옛 `delayTime` 은 보지 않는다). */
export function resolveRequestDelaySettings(
  config: Pick<Config, 'requestDelayMs' | 'requestDelayJitterMs'> | null | undefined,
): RequestDelaySettings {
  return {
    baseMs: normalizeRequestDelayMs(config?.requestDelayMs),
    jitterMs: normalizeRequestDelayJitterMs(config?.requestDelayJitterMs),
  };
}

/** 옛 키 `delayTime` 에 병기할 값 = min(기본 지연, 1000). */
export function legacyDelayTimeFor(requestDelayMs: unknown): number {
  return Math.min(normalizeRequestDelayMs(requestDelayMs), LEGACY_DELAY_TIME_MAX_MS);
}

/** 지연 설정 3키(새 키 2개 + 옛 키 병기)를 config 에 써 넣은 새 객체. */
export function withRequestDelaySettings<T extends Config>(
  config: T,
  baseMs: unknown,
  jitterMs: unknown,
): T {
  const base = normalizeRequestDelayMs(baseMs);
  return {
    ...config,
    requestDelayMs: base,
    requestDelayJitterMs: normalizeRequestDelayJitterMs(jitterMs),
    delayTime: legacyDelayTimeFor(base),
  };
}

/** 이번 요청 앞 대기(ms) = max(0, 기본 + uniform(-랜덤, +랜덤)). rand 는 [0,1) 난수(주입 가능). */
export function computeRequestDelayMs(
  baseMs: number,
  jitterMs: number,
  rand: () => number = Math.random,
): number {
  const base = normalizeRequestDelayMs(baseMs);
  const jitter = normalizeRequestDelayJitterMs(jitterMs);
  if (jitter === 0) return base;
  const offset = (rand() * 2 - 1) * jitter;
  return Math.max(0, Math.round(base + offset));
}

/** 설정 화면 표시용 「1.0초」. */
export function formatDelaySeconds(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)}초`;
}

// ── 주기적 긴 휴식 ──

export const LONG_BREAK_MIN_MS = 5 * 60 * 1000;
export const LONG_BREAK_MAX_MS = 7.5 * 60 * 1000;
export const LONG_BREAK_INTERVAL_MIN = 500;
export const LONG_BREAK_INTERVAL_SPREAD = 100;

/** 다음 긴 휴식까지의 성공 장수(500~599). */
export function nextLongBreakCount(rand: () => number = Math.random): number {
  return Math.floor(LONG_BREAK_INTERVAL_MIN + rand() * LONG_BREAK_INTERVAL_SPREAD);
}

/** 긴 휴식 시간(ms). 기본·랜덤 지연이 둘 다 0(사용자가 지연을 끈 경우)이면 0 = 쉬지 않음. */
export function computeLongBreakMs(
  delay: RequestDelaySettings,
  rand: () => number = Math.random,
): number {
  if (delay.baseMs <= 0 && delay.jitterMs <= 0) return 0;
  return Math.round(LONG_BREAK_MIN_MS + rand() * (LONG_BREAK_MAX_MS - LONG_BREAK_MIN_MS));
}

// ── 예상 시간 ──

/** 요청 지연을 뺀 생성 1장 기본 예상(종전 22초 − 일반 큐 평균 지연 7.5초). */
export const GENERATION_ESTIMATE_BASE_MS = 14_500;
/** 샘플이 없을 때의 작업 1건 예상 = 생성 기본 + 평균 지연(기본 지연 1초). */
export const TASK_ESTIMATE_DEFAULT_MS = GENERATION_ESTIMATE_BASE_MS + REQUEST_DELAY_DEFAULT_MS;

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
 * 시간 제한이 있는 요청(`/user/data` 계열 — 본문 읽기까지 포함). 시간이 다 되면 signal 을
 * abort 하고 RequestTimeoutError 로 즉시 실패한다. Android 의 CapacitorHttp 가 가로챈 fetch 는
 * signal 을 무시할 수 있어, abort 와 별개로 경쟁(race)으로 반드시 끝낸다.
 * outerSignal(큐 시도의 폐기 신호)이 abort 되면 같이 끊고 StaleAttemptError 로 실패한다.
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
