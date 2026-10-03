/**
 * 요청 타임아웃·재시도 대기·`/user/data` 캐시 단일 출처(2026-10-03 갈래 T2) —
 * 타임아웃 증가·시간 제한 래퍼·429 판정·재시도 사다리·정지 가능한 대기·최근 결과 캐시.
 * (요청 사이 지연은 5.4.0 배수 구조 그대로라 여기서 다루지 않는다.)
 */
import {
  isRequestTimeoutError,
  nextRequestTimeoutMs,
  queueAttemptTimeoutMs,
  RATE_LIMIT_MIN_WAIT_MS,
  RecentRequestCache,
  RequestTimeoutError,
  retryBackoffMs,
  retryWaitMs,
  sleepUnlessStopped,
  StaleAttemptError,
  USER_DATA_CACHE_MS,
  withRequestTimeout,
} from '../requestTiming';
import { createNaiApiError, isNaiRateLimitError } from '../../backends/genVendors/naiErrors';

describe('타임아웃 증가', () => {
  test('120→180→240→300→300 (상한)', () => {
    expect([0, 1, 2, 3, 4, 10].map(nextRequestTimeoutMs)).toEqual([
      120000, 180000, 240000, 300000, 300000, 300000,
    ]);
    expect(nextRequestTimeoutMs(-1)).toBe(120000);
    expect(nextRequestTimeoutMs(NaN)).toBe(120000);
  });

  test('바깥 = 안쪽 + 10초', () => {
    expect(queueAttemptTimeoutMs(120000)).toBe(130000);
    expect(queueAttemptTimeoutMs(300000)).toBe(310000);
  });

  test('타임아웃 오류 판정', () => {
    expect(isRequestTimeoutError(new RequestTimeoutError(1000))).toBe(true);
    expect(isRequestTimeoutError({ kind: 'timeout' })).toBe(true);
    expect(isRequestTimeoutError(createNaiApiError(500, ''))).toBe(false);
    expect(isRequestTimeoutError(new Error('Network request failed'))).toBe(false);
    expect(new RequestTimeoutError(120000).retryable).toBe(true);
  });
});

describe('withRequestTimeout', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('시간이 다 되면 signal 을 abort 하고 RequestTimeoutError', async () => {
    let seen: AbortSignal | undefined;
    const p = withRequestTimeout(30000, (signal) => {
      seen = signal;
      return new Promise<string>(() => {}); // signal 을 무시하는 요청(CapacitorHttp 등)
    });
    const assertion = expect(p).rejects.toBeInstanceOf(RequestTimeoutError);
    jest.advanceTimersByTime(29999);
    expect(seen!.aborted).toBe(false);
    jest.advanceTimersByTime(1);
    await assertion;
    expect(seen!.aborted).toBe(true);
  });

  test('제때 끝나면 값 그대로, 타이머 정리', async () => {
    const p = withRequestTimeout(30000, async () => 'ok');
    await expect(p).resolves.toBe('ok');
    expect(jest.getTimerCount()).toBe(0);
  });

  test('바깥 신호가 abort 되면 요청 signal 도 끊고 StaleAttemptError', async () => {
    const outer = new AbortController();
    let seen: AbortSignal | undefined;
    const p = withRequestTimeout(
      120000,
      (signal) => {
        seen = signal;
        return new Promise<string>(() => {});
      },
      outer.signal,
    );
    const assertion = expect(p).rejects.toBeInstanceOf(StaleAttemptError);
    outer.abort();
    await assertion;
    expect(seen!.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('이미 abort 된 바깥 신호면 요청을 보내지 않는다', async () => {
    const outer = new AbortController();
    outer.abort();
    const run = jest.fn(async () => 'x');
    await expect(withRequestTimeout(1000, run, outer.signal)).rejects.toBeInstanceOf(StaleAttemptError);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('429 판정(status/kind 우선, 문자열은 폴백)', () => {
  test('NaiApiError status 로 판정', () => {
    expect(isNaiRateLimitError(createNaiApiError(429, 'Too many'))).toBe(true);
    expect(isNaiRateLimitError(createNaiApiError(500, ''))).toBe(false);
  });

  test('요청 ID 에 429 가 섞여도 오판정하지 않는다', () => {
    expect(isNaiRateLimitError(createNaiApiError(500, 'oops', 'abc429def'))).toBe(false);
    expect(isNaiRateLimitError(createNaiApiError(502, '', '8c4290aa-ray'))).toBe(false);
  });

  test('status·kind 가 없는 오류만 문자열 폴백', () => {
    expect(isNaiRateLimitError(new Error('HTTP error:429'))).toBe(true);
    expect(isNaiRateLimitError({ kind: 'rate-limit', message: '' })).toBe(true);
    expect(isNaiRateLimitError(new RequestTimeoutError(1000))).toBe(false);
    expect(isNaiRateLimitError(undefined)).toBe(false);
  });
});

describe('오류 재시도 대기 사다리', () => {
  const mid = () => 0.5; // 무작위 0(가운데)

  test('실패 횟수별 5→10→20→40→60→60초(상한)', () => {
    expect([1, 2, 3, 4, 5, 6, 40].map((n) => retryBackoffMs(n, mid))).toEqual([
      5000, 10000, 20000, 40000, 60000, 60000, 60000,
    ]);
  });

  test('0 이하·NaN 은 1회째로 본다', () => {
    expect(retryBackoffMs(0, mid)).toBe(5000);
    expect(retryBackoffMs(-3, mid)).toBe(5000);
    expect(retryBackoffMs(NaN, mid)).toBe(5000);
  });

  test('±20% 무작위(양 끝)', () => {
    expect(retryBackoffMs(1, () => 0)).toBe(4000);
    expect(retryBackoffMs(1, () => 0.999999)).toBe(6000);
    expect(retryBackoffMs(5, () => 0)).toBe(48000);
    expect(retryBackoffMs(5, () => 0.999999)).toBe(72000);
    for (let i = 0; i < 200; i++) {
      const v = retryBackoffMs(3);
      expect(v).toBeGreaterThanOrEqual(16000);
      expect(v).toBeLessThanOrEqual(24000);
    }
  });

  test('429 는 최소 60초(사다리가 더 길면 사다리)', () => {
    expect(RATE_LIMIT_MIN_WAIT_MS).toBe(60000);
    expect(retryWaitMs(1, true, mid)).toBe(60000);
    expect(retryWaitMs(4, true, () => 0.999999)).toBe(60000);
    expect(retryWaitMs(5, true, () => 0.999999)).toBe(72000);
    expect(retryWaitMs(1, false, mid)).toBe(5000);
  });
});

describe('sleepUnlessStopped', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  async function flush() {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  }

  test('끝까지 기다리면 true', async () => {
    let done: boolean | undefined;
    sleepUnlessStopped(1000, () => false).then((v) => { done = v; });
    await flush();
    jest.advanceTimersByTime(999);
    await flush();
    expect(done).toBeUndefined();
    jest.advanceTimersByTime(1);
    await flush();
    jest.advanceTimersByTime(1);
    await flush();
    expect(done).toBe(true);
  });

  test('정지되면 남은 대기를 버리고 false', async () => {
    let stopped = false;
    let done: boolean | undefined;
    sleepUnlessStopped(60000, () => stopped).then((v) => { done = v; });
    await flush();
    jest.advanceTimersByTime(1000);
    await flush();
    stopped = true;
    jest.advanceTimersByTime(250);
    await flush();
    expect(done).toBe(false);
  });
});

describe('RecentRequestCache — /user/data 연속 조회 방지', () => {
  function setup() {
    let t = 1_000_000;
    const cache = new RecentRequestCache<number>(USER_DATA_CACHE_MS, () => t);
    return { cache, advance: (ms: number) => { t += ms; } };
  }

  test('10초 창: 같은 키는 직전 성공 결과 재사용, 창이 지나면 새로 읽음', async () => {
    const { cache, advance } = setup();
    let n = 0;
    const load = jest.fn(async () => ++n);
    expect(USER_DATA_CACHE_MS).toBe(10000);
    await expect(cache.get('tokenA', load)).resolves.toBe(1);
    advance(9999);
    await expect(cache.get('tokenA', load)).resolves.toBe(1);
    expect(load).toHaveBeenCalledTimes(1);
    advance(1);
    await expect(cache.get('tokenA', load)).resolves.toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
  });

  test('다른 키(토큰)는 따로', async () => {
    const { cache } = setup();
    const load = jest.fn(async () => 7);
    await cache.get('tokenA', load);
    await cache.get('tokenB', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  test('force 는 캐시를 건너뛰고 새로 읽어 다시 캐시', async () => {
    const { cache } = setup();
    let n = 0;
    const load = jest.fn(async () => ++n);
    await cache.get('tokenA', load);
    await expect(cache.get('tokenA', load, { force: true })).resolves.toBe(2);
    await expect(cache.get('tokenA', load)).resolves.toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
  });

  test('진행 중 조회는 합친다(동시 호출 1회 요청)', async () => {
    const { cache } = setup();
    let resolve!: (v: number) => void;
    const load = jest.fn(() => new Promise<number>((r) => { resolve = r; }));
    const a = cache.get('tokenA', load);
    const b = cache.get('tokenA', load);
    expect(load).toHaveBeenCalledTimes(1);
    resolve(42);
    await expect(a).resolves.toBe(42);
    await expect(b).resolves.toBe(42);
  });

  test('실패는 공유하되 캐시하지 않는다', async () => {
    const { cache } = setup();
    let reject!: (e: Error) => void;
    const load = jest
      .fn()
      .mockImplementationOnce(() => new Promise<number>((_r, j) => { reject = j; }))
      .mockResolvedValueOnce(5);
    const a = cache.get('tokenA', load);
    const b = cache.get('tokenA', load);
    reject(new Error('HTTP error:500'));
    await expect(a).rejects.toThrow('500');
    await expect(b).rejects.toThrow('500');
    await expect(cache.get('tokenA', load)).resolves.toBe(5);
    expect(load).toHaveBeenCalledTimes(2);
  });

  test('진행 중에 force 가 시작되면 앞선 조회가 늦게 끝나도 force 결과를 덮지 않는다', async () => {
    const { cache } = setup();
    let resolveOld!: (v: number) => void;
    let resolveNew!: (v: number) => void;
    const load = jest
      .fn()
      .mockImplementationOnce(() => new Promise<number>((r) => { resolveOld = r; }))
      .mockImplementationOnce(() => new Promise<number>((r) => { resolveNew = r; }));
    const old = cache.get('tokenA', load);
    const fresh = cache.get('tokenA', load, { force: true });
    resolveNew(2);
    await fresh;
    resolveOld(1);
    await old;
    await expect(cache.get('tokenA', jest.fn())).resolves.toBe(2);
  });

  test('load 가 동기 예외를 던져도 거부된 Promise 로', async () => {
    const { cache } = setup();
    await expect(
      cache.get('tokenA', () => { throw new Error('boom'); }),
    ).rejects.toThrow('boom');
  });
});
