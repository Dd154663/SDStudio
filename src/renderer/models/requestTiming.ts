/**
 * NovelAI 요청 사이 지연·타임아웃·재시도 대기·`/user/data` 조회 단일 출처
 * (2026-10-03 정비 갈래 T2 「결함 수정만 복구」 + T3 「요청 사이 지연 재설계」, 사용자 결정).
 *
 * ── 요청 사이 지연(T3) ──
 *  · config 키: `requestDelayMs`(0~10000, 기본 1500) · `requestDelayJitterMs`(0~5000, 기본 500)
 *    · `requestDelayWarningDismissed`(1.5초 미만 경고 「다시 알리지 않음」).
 *  · 옛 값 환산(T3b): 새 키 `requestDelayMs` 가 없고 옛 키 `delayTime` 이 0 보다 크면
 *    기본 = delayTime × 7.5, 무작위 폭 = delayTime × 1.5(옛 일반 큐 배수 6~9 = 평균 7.5 ± 1.5 의
 *    등가, 100ms 단위 반올림·상한 보정). 옛 값이 0·없음·NaN 이면 기본값.
 *  · 하위 호환: 저장할 때마다 옛 키 `delayTime` 에 min(requestDelayMs, 1000) 을 함께 쓴다 —
 *    5.4.0 이하로 롤백해도 옛 배수 로직이 1000 초과 값을 곱하지 않는다.
 *  · 1회 대기 = max(0, 기본 + uniform(-무작위 폭, +무작위 폭)). 작업의 첫 시도에만 적용하고,
 *    재시도는 이 지연 없이 아래 「오류 재시도 대기」 사다리만 기다린다.
 *  · 일반 큐(빠른 생성 아님)는 2% 확률로 그 대기에 ×1.5~2.0(급등).
 *  · 소량 예약 완화: 대기 시점의 큐 잔량(모든 작업의 남은 장수 합)이 20장 이하면 기본을
 *    min(기본, 1초) 로 낮추고 급등을 생략한다(무작위 폭은 그대로).
 *  · 주기적 긴 휴식: 성공 300~399장마다 2~4분(설정과 무관 — 지연 0초여도 쉰다). 카운터는 큐
 *    서비스 수준이라 실행(run)을 넘어 이어지고, 직전 실행 종료 뒤 2분 이상 쉬었으면 새로 센다.
 *  · 설정 화면 경고: 1.5초 미만으로 바꿔 저장하면 경고(「다시 알리지 않음」이면 생략).
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
import type { Config } from '../../main/config';

// ── 요청 사이 지연 ──

export const REQUEST_DELAY_DEFAULT_MS = 1500;
export const REQUEST_DELAY_MAX_MS = 10_000;
export const REQUEST_DELAY_JITTER_DEFAULT_MS = 500;
export const REQUEST_DELAY_JITTER_MAX_MS = 5_000;
/** 설정 슬라이더 단위(0.1초). */
export const REQUEST_DELAY_STEP_MS = 100;
/** 옛 키 `delayTime` 에 병기하는 값의 상한(5.4.0 이하 슬라이더 범위). */
export const LEGACY_DELAY_TIME_MAX_MS = 1000;
/** 이 값 「미만」으로 저장하면 설정 화면이 경고한다(권장 최소값 — 기본값은 경고 없음). */
export const REQUEST_DELAY_WARNING_BELOW_MS = 1500;
/** 옛 키 `delayTime` 환산 배수(옛 일반 큐 배수 6~9 = 평균 7.5 ± 1.5 의 등가). */
export const LEGACY_DELAY_BASE_FACTOR = 7.5;
export const LEGACY_DELAY_JITTER_FACTOR = 1.5;

/** 일반 큐 급등 확률·배수(대기 × uniform(MIN, MAX)). 빠른 생성·소량 예약은 급등 없음. */
export const REQUEST_DELAY_SURGE_CHANCE = 0.02;
export const REQUEST_DELAY_SURGE_MIN_FACTOR = 1.5;
export const REQUEST_DELAY_SURGE_MAX_FACTOR = 2.0;

/** 소량 예약 완화: 큐 잔량이 이 장수 이하면 기본 지연을 아래 값 이하로 낮추고 급등을 생략한다. */
export const SMALL_QUEUE_RELIEF_MAX_PENDING = 20;
export const SMALL_QUEUE_RELIEF_DELAY_MS = 1000;

export interface RequestDelaySettings {
  baseMs: number;
  jitterMs: number;
}

function clampMs(v: unknown, max: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(0, Math.round(v)));
}

/** 저장값 → 기본 지연(ms). 없음·NaN·문자열 = 1500, 음수 = 0, 상한 초과 = 10000. */
export function normalizeRequestDelayMs(v: unknown): number {
  return clampMs(v, REQUEST_DELAY_MAX_MS, REQUEST_DELAY_DEFAULT_MS);
}

/** 저장값 → 무작위 폭(ms). 없음·NaN·문자열 = 500, 음수 = 0, 상한 초과 = 5000. */
export function normalizeRequestDelayJitterMs(v: unknown): number {
  return clampMs(v, REQUEST_DELAY_JITTER_MAX_MS, REQUEST_DELAY_JITTER_DEFAULT_MS);
}

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/** 100ms 단위 반올림 후 0~max 로 보정. */
function roundStepClamp(v: number, max: number): number {
  const stepped = Math.round(v / REQUEST_DELAY_STEP_MS) * REQUEST_DELAY_STEP_MS;
  return Math.min(max, Math.max(0, stepped));
}

/**
 * 옛 키 `delayTime`(5.4.0 이하, 0~1000ms 배수 구조) → 새 설정 환산. 유한수이고 0 보다 클 때만
 * 기본 = ×7.5, 무작위 폭 = ×1.5(각 100ms 단위 반올림·상한 보정). 그 밖(0·음수·없음·NaN·문자열)은 null.
 */
export function legacyRequestDelaySettings(delayTime: unknown): RequestDelaySettings | null {
  if (!isFiniteNumber(delayTime) || delayTime <= 0) return null;
  return {
    baseMs: roundStepClamp(delayTime * LEGACY_DELAY_BASE_FACTOR, REQUEST_DELAY_MAX_MS),
    jitterMs: roundStepClamp(delayTime * LEGACY_DELAY_JITTER_FACTOR, REQUEST_DELAY_JITTER_MAX_MS),
  };
}

/**
 * config 에서 지연 설정을 읽는다. 새 키 `requestDelayMs` 가 있으면(유한수) 새 키만 본다.
 * 없으면 옛 키 `delayTime` 을 환산한다(`legacyRequestDelaySettings` — 무작위 폭은 새 키
 * `requestDelayJitterMs` 가 유한수로 있으면 그 값을 우선). 옛 값도 없으면 기본값.
 * 실행 루프·설정 화면 불러오기·미저장 판정이 모두 이 함수를 쓴다.
 */
export function resolveRequestDelaySettings(
  config: Pick<Config, 'requestDelayMs' | 'requestDelayJitterMs' | 'delayTime'> | null | undefined,
): RequestDelaySettings {
  if (!isFiniteNumber(config?.requestDelayMs)) {
    const legacy = legacyRequestDelaySettings(config?.delayTime);
    if (legacy) {
      return {
        baseMs: legacy.baseMs,
        jitterMs: isFiniteNumber(config?.requestDelayJitterMs)
          ? normalizeRequestDelayJitterMs(config?.requestDelayJitterMs)
          : legacy.jitterMs,
      };
    }
  }
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

/** 큐 잔량이 소량 예약 완화 대상인가(20장 이하). 잔량을 알 수 없으면(NaN 등) 완화하지 않는다. */
export function isSmallQueueRelief(pendingCount: number): boolean {
  return Number.isFinite(pendingCount) && pendingCount <= SMALL_QUEUE_RELIEF_MAX_PENDING;
}

export interface RequestDelayContext {
  /** 빠른 생성(nodelay — 편집기 즉시 생성)이면 급등 없음. */
  fast: boolean;
  /** 대기 시점의 큐 잔량(장, 현재 작업 포함). */
  pendingCount: number;
}

/**
 * 첫 시도 앞 대기(ms) = max(0, 기본 + uniform(-폭, +폭)), 일반 큐는 2% 확률로 ×1.5~2.0.
 * 소량 예약(잔량 20장 이하)은 기본을 min(기본, 1초) 로 낮추고 급등을 생략한다.
 * rand 는 [0,1) 난수(주입 가능) — 호출 순서: 무작위 폭 1회, (급등 대상이면) 급등 판정 1회·배수 1회.
 */
export function computeRequestDelayMs(
  settings: RequestDelaySettings,
  ctx: RequestDelayContext,
  rand: () => number = Math.random,
): number {
  const relief = isSmallQueueRelief(ctx.pendingCount);
  let base = normalizeRequestDelayMs(settings.baseMs);
  if (relief) base = Math.min(base, SMALL_QUEUE_RELIEF_DELAY_MS);
  const jitter = normalizeRequestDelayJitterMs(settings.jitterMs);
  const offset = (rand() * 2 - 1) * jitter;
  let ms = Math.max(0, base + offset);
  if (!ctx.fast && !relief && rand() < REQUEST_DELAY_SURGE_CHANCE) {
    const factor =
      REQUEST_DELAY_SURGE_MIN_FACTOR +
      rand() * (REQUEST_DELAY_SURGE_MAX_FACTOR - REQUEST_DELAY_SURGE_MIN_FACTOR);
    ms *= factor;
  }
  return Math.round(ms);
}

/**
 * 설정 화면 저장 시 「짧은 지연 경고」를 띄울지. 1.5초 미만이고, 직전 저장값과 다르거나 직전 저장값이
 * 없으며(새 키가 없는 5.4.0 이하 설정 포함), 「다시 알리지 않음」을 고르지 않았을 때.
 */
export function shouldWarnShortRequestDelay(
  nextMs: number,
  savedMs: unknown,
  dismissed: boolean | undefined,
): boolean {
  if (dismissed === true) return false;
  const next = normalizeRequestDelayMs(nextMs);
  if (next >= REQUEST_DELAY_WARNING_BELOW_MS) return false;
  const hasSaved = typeof savedMs === 'number' && Number.isFinite(savedMs);
  return !hasSaved || normalizeRequestDelayMs(savedMs) !== next;
}

/** 설정 화면 표시용 「1.0초」. */
export function formatDelaySeconds(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)}초`;
}

// ── 주기적 긴 휴식 ──

export const LONG_BREAK_MIN_MS = 2 * 60 * 1000;
export const LONG_BREAK_MAX_MS = 4 * 60 * 1000;
export const LONG_BREAK_INTERVAL_MIN = 300;
export const LONG_BREAK_INTERVAL_SPREAD = 100;
/** 직전 실행 종료 뒤 이만큼 쉬었으면(그 유휴가 휴식 역할) 새 실행에서 카운터를 새로 센다. */
export const LONG_BREAK_IDLE_RESET_MS = LONG_BREAK_MIN_MS;

/** 다음 긴 휴식까지의 성공 장수(300~399). */
export function nextLongBreakCount(rand: () => number = Math.random): number {
  return Math.floor(LONG_BREAK_INTERVAL_MIN + rand() * LONG_BREAK_INTERVAL_SPREAD);
}

/** 긴 휴식 시간(ms) = 2~4분. 지연 설정과 무관(지연 0초여도 쉰다). */
export function computeLongBreakMs(rand: () => number = Math.random): number {
  return Math.round(LONG_BREAK_MIN_MS + rand() * (LONG_BREAK_MAX_MS - LONG_BREAK_MIN_MS));
}

/**
 * 새 실행 시작 때 휴식 카운터를 새로 셀지. 직전 실행 종료 시각(epoch ms, 0 = 아직 없음)부터
 * 지금까지의 유휴가 2분(`LONG_BREAK_IDLE_RESET_MS`) 이상이면 참 — 그렇지 않으면 이어서 센다.
 */
export function shouldResetLongBreakCounter(lastRunEndedAt: number, now: number): boolean {
  return (
    isFiniteNumber(lastRunEndedAt) &&
    lastRunEndedAt > 0 &&
    now - lastRunEndedAt >= LONG_BREAK_IDLE_RESET_MS
  );
}

/** 휴식 남은 시간 표시 「m:ss」(초 올림, 음수는 0:00). */
export function formatBreakRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil((Number.isFinite(ms) ? ms : 0) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ── 설정 화면·경고 창 문구(숫자는 위 상수에서 만든다 — 다른 파일에 숫자를 다시 쓰지 않는다) ──

// 초 표시: 소수 1자리까지(「1.5초」), 정수면 소수 없이(「10초」).
const sec = (ms: number) => `${Math.round(ms / 100) / 10}초`;
const minutes = (ms: number) => Math.round(ms / 60_000);

export const REQUEST_DELAY_TEXT = {
  delayLabel: `생성 사이 지연 (0~${sec(REQUEST_DELAY_MAX_MS)})`,
  jitterLabel: `무작위 폭 (±0~${sec(REQUEST_DELAY_JITTER_MAX_MS)})`,
  help:
    `고정 지연에 ±이 값만큼 무작위로 더합니다. ` +
    `${SMALL_QUEUE_RELIEF_MAX_PENDING}장 이하 예약은 지연을 최대 ${sec(SMALL_QUEUE_RELIEF_DELAY_MS)}로 줄입니다. ` +
    `${LONG_BREAK_INTERVAL_MIN}장마다 ${minutes(LONG_BREAK_MIN_MS)}~${minutes(LONG_BREAK_MAX_MS)}분 쉽니다. ` +
    `생성 중에 바꾸면 다음 실행부터 적용됩니다.`,
  warningText:
    `짧은 지연 경고\n\n` +
    `생성 사이 지연이 ${sec(REQUEST_DELAY_WARNING_BELOW_MS)} 미만이면 NovelAI 매크로 판정으로 계정 제재를 받을 위험이 있습니다. ` +
    `권장 최소값은 ${sec(REQUEST_DELAY_WARNING_BELOW_MS)}입니다.`,
  warningOk: '이해했습니다',
  warningDismiss: '다시 알리지 않음',
  /** 진행 바: 긴 휴식 중 문구(fit = 좁은 막대). */
  breakProgress: (remainingMs: number, fit?: boolean) =>
    fit
      ? `휴식·${formatBreakRemaining(remainingMs)}`
      : `휴식 중 · 남은 ${formatBreakRemaining(remainingMs)}`,
  /** 진행 바: 휴식 중 누르면 띄우는 안내(확인 한 개 창). */
  breakNotice:
    `NovelAI 매크로 판정을 피하려고 ${LONG_BREAK_INTERVAL_MIN}장마다 ` +
    `${minutes(LONG_BREAK_MIN_MS)}~${minutes(LONG_BREAK_MAX_MS)}분 쉽니다. 정지하면 바로 끝납니다.`,
};

// ── 예상 시간 ──

/** 요청 지연을 뺀 생성 1장 기본 예상(종전 22초 − 일반 큐 평균 지연 7.5초). */
export const GENERATION_ESTIMATE_BASE_MS = 14_500;
/** 샘플이 없을 때의 작업 1건 예상 = 생성 기본 + 평균 지연(기본 지연 1.5초 — 무작위 폭은 평균 0). */
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
