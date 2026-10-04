/**
 * 요청 사이 지연·타임아웃·재시도 대기·`/user/data` 캐시 단일 출처(2026-10-03 갈래 T2·T3) —
 * 지연 식·급등·소량 완화·범위 보정·옛 키 병기·긴 휴식·경고 판정·환경설정 동기화,
 * 타임아웃 증가·시간 제한 래퍼·429 판정·재시도 사다리·정지 가능한 대기·최근 결과 캐시.
 */
import {
  computeLongBreakMs,
  computeRequestDelayMs,
  formatBreakRemaining,
  formatDelaySeconds,
  legacyDelayTimeFor,
  legacyRequestDelaySettings,
  LEGACY_DELAY_BASE_FACTOR,
  LEGACY_DELAY_JITTER_FACTOR,
  LONG_BREAK_IDLE_RESET_MS,
  LONG_BREAK_INTERVAL_MIN,
  LONG_BREAK_MAX_MS,
  LONG_BREAK_MIN_MS,
  nextLongBreakCount,
  REQUEST_DELAY_DEFAULT_MS,
  REQUEST_DELAY_WARNING_BELOW_MS,
  shouldResetLongBreakCounter,
  normalizeRequestDelayJitterMs,
  normalizeRequestDelayMs,
  REQUEST_DELAY_SURGE_CHANCE,
  REQUEST_DELAY_TEXT,
  resolveRequestDelaySettings,
  shouldWarnShortRequestDelay,
  SMALL_QUEUE_RELIEF_MAX_PENDING,
  TASK_ESTIMATE_DEFAULT_MS,
  withRequestDelaySettings,
  isRequestTimeoutError,
  nextRequestTimeoutMs,
  queueAttemptTimeoutMs,
  RATE_LIMIT_MIN_WAIT_MS,
  CONCURRENT_RETRY_WAIT_MS,
  CONSECUTIVE_FAILURE_STOP,
  NAI_MAX_TRIES,
  TASK_FAILURE_TEXT,
  RecentRequestCache,
  RequestTimeoutError,
  retryBackoffMs,
  retryWaitMs,
  sleepUnlessStopped,
  StaleAttemptError,
  USER_DATA_CACHE_MS,
  withRequestTimeout,
} from '../requestTiming';
import {
  createNaiApiError,
  isNaiConcurrentError,
  isNaiRateLimitError,
} from '../../backends/genVendors/naiErrors';
import { inferToastKind } from '../toastKind';
import {
  applyConfigGroups,
  buildConfigExport,
  CONFIG_GROUP_FIELDS,
  CONFIG_SYNC_EXCLUDED,
  diffConfigGroups,
  parseConfigImport,
} from '../configSync';

// 난수 열을 순서대로 돌려준다(다 쓰면 마지막 값 반복).
function seq(...values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

const BIG = 1000; // 소량 예약 완화가 걸리지 않는 잔량
const S = (baseMs: number, jitterMs: number) => ({ baseMs, jitterMs });

describe('요청 사이 지연 = max(0, 기본 ± 무작위 폭)', () => {
  test('0/0 은 항상 0', () => {
    expect(computeRequestDelayMs(S(0, 0), { fast: true, pendingCount: BIG }, () => 0)).toBe(0);
    expect(computeRequestDelayMs(S(0, 0), { fast: true, pendingCount: BIG }, () => 0.999)).toBe(0);
  });

  test('6000/5000 → 1000~11000 범위(양 끝·가운데), 급등 없음(fast)', () => {
    const fast = { fast: true, pendingCount: BIG };
    expect(computeRequestDelayMs(S(6000, 5000), fast, () => 0)).toBe(1000);
    expect(computeRequestDelayMs(S(6000, 5000), fast, () => 0.5)).toBe(6000);
    expect(computeRequestDelayMs(S(6000, 5000), fast, () => 0.999999)).toBe(11000);
    for (let i = 0; i < 200; i++) {
      const v = computeRequestDelayMs(S(6000, 5000), fast);
      expect(v).toBeGreaterThanOrEqual(1000);
      expect(v).toBeLessThanOrEqual(11000);
    }
  });

  test('1000/5000 은 음수 없이 0 이상(음수 구간은 0)', () => {
    const fast = { fast: true, pendingCount: BIG };
    expect(computeRequestDelayMs(S(1000, 5000), fast, () => 0)).toBe(0);
    expect(computeRequestDelayMs(S(1000, 5000), fast, () => 0.1)).toBe(0);
    expect(computeRequestDelayMs(S(1000, 5000), fast, () => 0.6)).toBe(2000);
    for (let i = 0; i < 200; i++) {
      expect(computeRequestDelayMs(S(1000, 5000), { fast: false, pendingCount: BIG })).toBeGreaterThanOrEqual(0);
    }
  });

  test('범위 밖 입력은 보정 후 계산', () => {
    const fast = { fast: true, pendingCount: BIG };
    expect(computeRequestDelayMs(S(-500, 0), fast)).toBe(0);
    expect(computeRequestDelayMs(S(99999, 99999), fast, () => 0.999999)).toBe(15000);
    // NaN 설정은 기본값(1.5초·±0.5초)
    expect(computeRequestDelayMs(S(NaN, NaN), fast, () => 0.5)).toBe(1500);
  });

  test('표시 형식 「1.0초」', () => {
    expect(formatDelaySeconds(1000)).toBe('1.0초');
    expect(formatDelaySeconds(0)).toBe('0.0초');
    expect(formatDelaySeconds(10000)).toBe('10.0초');
    expect(formatDelaySeconds(2300)).toBe('2.3초');
  });
});

describe('일반 큐 2% 급등 ×1.5~2.0', () => {
  const normal = { fast: false, pendingCount: BIG };

  test('급등 판정 난수가 2% 미만이면 배수(양 끝 1.5·2.0)', () => {
    expect(REQUEST_DELAY_SURGE_CHANCE).toBe(0.02);
    // 순서: 무작위 폭(0.5 → 0) · 급등 판정(0.01 → 급등) · 배수(0 → ×1.5 / 0.999999 → ×2.0)
    expect(computeRequestDelayMs(S(4000, 1000), normal, seq(0.5, 0.01, 0))).toBe(6000);
    expect(computeRequestDelayMs(S(4000, 1000), normal, seq(0.5, 0.01, 0.999999))).toBe(8000);
  });

  test('2% 이상이면 급등 없음', () => {
    expect(computeRequestDelayMs(S(4000, 1000), normal, seq(0.5, 0.02, 0.9))).toBe(4000);
    expect(computeRequestDelayMs(S(4000, 1000), normal, seq(0.5, 0.5, 0.9))).toBe(4000);
  });

  test('급등 배수 범위(무작위): 대기 / 무급등 대기 ∈ [1.5, 2.0]', () => {
    for (let i = 0; i < 200; i++) {
      const factorRand = Math.random();
      const v = computeRequestDelayMs(S(4000, 0), normal, seq(0.5, 0, factorRand));
      expect(v).toBeGreaterThanOrEqual(6000);
      expect(v).toBeLessThanOrEqual(8000);
    }
  });

  test('빠른 생성(fast)은 급등 판정을 하지 않는다', () => {
    const rand = jest.fn(seq(0.5, 0, 0.999999));
    expect(computeRequestDelayMs(S(4000, 1000), { fast: true, pendingCount: BIG }, rand)).toBe(4000);
    expect(rand).toHaveBeenCalledTimes(1);
  });
});

describe('소량 예약 완화(잔량 20장 이하)', () => {
  test('기본을 min(기본, 1초) 로 낮추고 무작위 폭은 그대로', () => {
    expect(SMALL_QUEUE_RELIEF_MAX_PENDING).toBe(20);
    const small = { fast: false, pendingCount: 20 };
    expect(computeRequestDelayMs(S(6000, 500), small, () => 0.5)).toBe(1000);
    expect(computeRequestDelayMs(S(6000, 500), small, () => 0)).toBe(500);
    expect(computeRequestDelayMs(S(6000, 500), small, () => 0.999999)).toBe(1500);
    // 1초 미만 설정은 그대로(낮추기만 한다)
    expect(computeRequestDelayMs(S(300, 0), small, () => 0.5)).toBe(300);
  });

  test('급등을 생략한다(급등 난수를 쓰지 않음)', () => {
    const rand = jest.fn(seq(0.5, 0, 0.999999));
    expect(computeRequestDelayMs(S(6000, 0), { fast: false, pendingCount: 1 }, rand)).toBe(1000);
    expect(rand).toHaveBeenCalledTimes(1);
  });

  test('21장부터는 완화 없음, 잔량을 알 수 없으면(NaN) 완화 없음', () => {
    expect(computeRequestDelayMs(S(6000, 0), { fast: false, pendingCount: 21 }, seq(0.5, 0.5))).toBe(6000);
    expect(computeRequestDelayMs(S(6000, 0), { fast: true, pendingCount: NaN }, () => 0.5)).toBe(6000);
  });
});

describe('설정 읽기: 기본값·범위 보정·옛 키 환산', () => {
  const DEF = { baseMs: 1500, jitterMs: 500 };

  test('기본값은 1.5초·±0.5초', () => {
    expect(REQUEST_DELAY_DEFAULT_MS).toBe(1500);
    expect(resolveRequestDelaySettings({})).toEqual(DEF);
    expect(resolveRequestDelaySettings(undefined)).toEqual(DEF);
    expect(resolveRequestDelaySettings(null)).toEqual(DEF);
  });

  test('옛 delayTime 환산: 기본 ×7.5 · 무작위 폭 ×1.5 (옛 일반 큐 배수 6~9 의 등가)', () => {
    expect(LEGACY_DELAY_BASE_FACTOR).toBe(7.5);
    expect(LEGACY_DELAY_JITTER_FACTOR).toBe(1.5);
    expect(resolveRequestDelaySettings({ delayTime: 1000 })).toEqual({ baseMs: 7500, jitterMs: 1500 });
    expect(resolveRequestDelaySettings({ delayTime: 200 })).toEqual({ baseMs: 1500, jitterMs: 300 });
    expect(legacyRequestDelaySettings(1000)).toEqual({ baseMs: 7500, jitterMs: 1500 });
  });

  test('옛 값이 0·음수·NaN·문자열·Infinity·없음이면 기본값', () => {
    for (const v of [0, -100, NaN, '700', Infinity, undefined, null]) {
      expect(resolveRequestDelaySettings({ delayTime: v } as any)).toEqual(DEF);
      expect(legacyRequestDelaySettings(v)).toBeNull();
    }
  });

  test('100ms 단위 반올림', () => {
    // 700 × 7.5 = 5250 → 5300, 700 × 1.5 = 1050 → 1100
    expect(resolveRequestDelaySettings({ delayTime: 700 })).toEqual({ baseMs: 5300, jitterMs: 1100 });
    // 1 × 7.5 = 7.5 → 0, 1 × 1.5 → 0
    expect(resolveRequestDelaySettings({ delayTime: 1 })).toEqual({ baseMs: 0, jitterMs: 0 });
    // 33 × 7.5 = 247.5 → 200, 33 × 1.5 = 49.5 → 0
    expect(resolveRequestDelaySettings({ delayTime: 33 })).toEqual({ baseMs: 200, jitterMs: 0 });
  });

  test('상한 보정(기본 10000·무작위 폭 5000)', () => {
    expect(resolveRequestDelaySettings({ delayTime: 5000 })).toEqual({ baseMs: 10000, jitterMs: 5000 });
    expect(resolveRequestDelaySettings({ delayTime: 2000 })).toEqual({ baseMs: 10000, jitterMs: 3000 });
  });

  test('새 키가 있으면 옛 키는 보지 않는다, 무작위 폭만 있으면 그 값을 우선', () => {
    expect(resolveRequestDelaySettings({ requestDelayMs: 2000, delayTime: 1000 })).toEqual({
      baseMs: 2000,
      jitterMs: 500,
    });
    expect(resolveRequestDelaySettings({ requestDelayMs: 0, delayTime: 1000 })).toEqual({
      baseMs: 0,
      jitterMs: 500,
    });
    expect(resolveRequestDelaySettings({ requestDelayJitterMs: 800, delayTime: 1000 })).toEqual({
      baseMs: 7500,
      jitterMs: 800,
    });
    // 새 키가 문자열 등으로 오염됐으면 없음과 같다 → 옛 키 환산
    expect(resolveRequestDelaySettings({ requestDelayMs: '3000', delayTime: 400 } as any)).toEqual({
      baseMs: 3000,
      jitterMs: 600,
    });
  });

  test('환산 → 저장 → 다시 읽기 왕복(옛 1000 → 7.5초 → 옛 키 병기 1000)', () => {
    const resolved = resolveRequestDelaySettings({ delayTime: 1000 });
    const saved = withRequestDelaySettings({ delayTime: 1000 }, resolved.baseMs, resolved.jitterMs);
    expect(saved).toEqual({ delayTime: 1000, requestDelayMs: 7500, requestDelayJitterMs: 1500 });
    expect(resolveRequestDelaySettings(saved)).toEqual(resolved);
  });

  test('음수·NaN·문자열·상한 초과 보정', () => {
    expect(normalizeRequestDelayMs(-1)).toBe(0);
    expect(normalizeRequestDelayMs(NaN)).toBe(1500);
    expect(normalizeRequestDelayMs('3000')).toBe(1500);
    expect(normalizeRequestDelayMs(Infinity)).toBe(1500);
    expect(normalizeRequestDelayMs(20000)).toBe(10000);
    expect(normalizeRequestDelayMs(2500.4)).toBe(2500);
    expect(normalizeRequestDelayMs(0)).toBe(0);
    expect(normalizeRequestDelayJitterMs(undefined)).toBe(500);
    expect(normalizeRequestDelayJitterMs('1')).toBe(500);
    expect(normalizeRequestDelayJitterMs(-3)).toBe(0);
    expect(normalizeRequestDelayJitterMs(9000)).toBe(5000);
    expect(normalizeRequestDelayJitterMs(NaN)).toBe(500);
    expect(normalizeRequestDelayJitterMs(0)).toBe(0);
    expect(resolveRequestDelaySettings({ requestDelayMs: 6000, requestDelayJitterMs: 5000 })).toEqual({
      baseMs: 6000,
      jitterMs: 5000,
    });
  });

  test('저장 시 옛 키 delayTime 에 min(지연, 1000) 병기', () => {
    expect(legacyDelayTimeFor(6000)).toBe(1000);
    expect(legacyDelayTimeFor(400)).toBe(400);
    expect(legacyDelayTimeFor(0)).toBe(0);
    expect(legacyDelayTimeFor(undefined)).toBe(1000);
    const saved = withRequestDelaySettings({ furryMode: true, delayTime: 0 }, 6500, 2000);
    expect(saved).toEqual({
      furryMode: true,
      requestDelayMs: 6500,
      requestDelayJitterMs: 2000,
      delayTime: 1000,
    });
    expect(withRequestDelaySettings({}, 300, -1)).toEqual({
      requestDelayMs: 300,
      requestDelayJitterMs: 0,
      delayTime: 300,
    });
  });
});

describe('짧은 지연 경고 판정', () => {
  test('1.5초 미만이고 직전 저장값과 다르거나 없을 때만', () => {
    expect(REQUEST_DELAY_WARNING_BELOW_MS).toBe(1500);
    expect(shouldWarnShortRequestDelay(500, 1000, false)).toBe(true);
    expect(shouldWarnShortRequestDelay(500, undefined, undefined)).toBe(true);
    expect(shouldWarnShortRequestDelay(0, 'x', false)).toBe(true);
    expect(shouldWarnShortRequestDelay(500, 500, false)).toBe(false); // 바꾸지 않음
    expect(shouldWarnShortRequestDelay(1499, 1500, false)).toBe(true); // 경계: 미만이면 경고
    expect(shouldWarnShortRequestDelay(1000, 500, false)).toBe(true); // 옛 기본 1초도 이제 경고
    expect(shouldWarnShortRequestDelay(1500, 500, false)).toBe(false); // 기본값 1.5초는 경고 없음(미만 기준)
    expect(shouldWarnShortRequestDelay(REQUEST_DELAY_DEFAULT_MS, undefined, false)).toBe(false);
    expect(shouldWarnShortRequestDelay(5000, undefined, false)).toBe(false);
  });

  test('「다시 알리지 않음」이면 경고하지 않는다', () => {
    expect(shouldWarnShortRequestDelay(0, 1000, true)).toBe(false);
  });

  test('문구의 숫자는 상수에서 만든다', () => {
    expect(REQUEST_DELAY_TEXT.delayLabel).toBe('생성 사이 지연 (0~10초)');
    expect(REQUEST_DELAY_TEXT.jitterLabel).toBe('무작위 폭 (±0~5초)');
    expect(REQUEST_DELAY_TEXT.help).toContain('20장 이하 예약은 지연을 최대 1초로 줄입니다');
    expect(REQUEST_DELAY_TEXT.help).toContain('300장마다 2~4분 쉽니다');
    expect(REQUEST_DELAY_TEXT.warningText).toContain('1.5초 미만이면');
    expect(REQUEST_DELAY_TEXT.warningText).toContain('권장 최소값은 1.5초입니다');
    expect(REQUEST_DELAY_TEXT.breakNotice).toBe(
      'NovelAI 매크로 판정을 피하려고 300장마다 2~4분 쉽니다. 정지하면 바로 끝납니다.',
    );
    expect(REQUEST_DELAY_TEXT.breakProgress(125_000)).toBe('휴식 중 · 남은 2:05');
    expect(REQUEST_DELAY_TEXT.breakProgress(59_001, true)).toBe('휴식·1:00');
  });

  test('휴식 남은 시간 형식 m:ss(초 올림, 음수·NaN 은 0:00)', () => {
    expect(formatBreakRemaining(240_000)).toBe('4:00');
    expect(formatBreakRemaining(1)).toBe('0:01');
    expect(formatBreakRemaining(0)).toBe('0:00');
    expect(formatBreakRemaining(-5000)).toBe('0:00');
    expect(formatBreakRemaining(NaN)).toBe('0:00');
  });
});

describe('주기적 긴 휴식', () => {
  test('고정 2~4분(설정과 무관)', () => {
    expect(LONG_BREAK_MIN_MS).toBe(120000);
    expect(LONG_BREAK_MAX_MS).toBe(240000);
    expect(computeLongBreakMs(() => 0)).toBe(LONG_BREAK_MIN_MS);
    expect(computeLongBreakMs(() => 0.999999)).toBeLessThanOrEqual(LONG_BREAK_MAX_MS);
    for (let i = 0; i < 200; i++) {
      const v = computeLongBreakMs();
      expect(v).toBeGreaterThanOrEqual(LONG_BREAK_MIN_MS);
      expect(v).toBeLessThanOrEqual(LONG_BREAK_MAX_MS);
    }
  });

  test('간격은 300~399장', () => {
    expect(LONG_BREAK_INTERVAL_MIN).toBe(300);
    expect(nextLongBreakCount(() => 0)).toBe(300);
    expect(nextLongBreakCount(() => 0.999999)).toBe(399);
    for (let i = 0; i < 200; i++) {
      const v = nextLongBreakCount();
      expect(v).toBeGreaterThanOrEqual(300);
      expect(v).toBeLessThanOrEqual(399);
    }
  });

  test('새 실행의 카운터 재설정: 직전 실행 종료 뒤 2분 이상 유휴일 때만', () => {
    expect(LONG_BREAK_IDLE_RESET_MS).toBe(LONG_BREAK_MIN_MS);
    const end = 1_000_000;
    expect(shouldResetLongBreakCounter(0, end)).toBe(false); // 직전 실행 없음
    expect(shouldResetLongBreakCounter(end, end + 10_000)).toBe(false);
    expect(shouldResetLongBreakCounter(end, end + 119_999)).toBe(false);
    expect(shouldResetLongBreakCounter(end, end + 120_000)).toBe(true);
    expect(shouldResetLongBreakCounter(NaN, end)).toBe(false);
  });

  test('기본 예상 = 14.5초 + 기본 지연 1.5초', () => {
    expect(TASK_ESTIMATE_DEFAULT_MS).toBe(16000);
  });
});

describe('환경설정 동기화(생성 설정 군) 포함', () => {
  const META = { createdAt: '2026-10-03T00:00:00.000Z', appVersion: '5.4.0', platform: 'pc' as const };

  test('새 키는 생성 군 화이트리스트, 옛 키·경고 표식은 제외 목록', () => {
    expect(CONFIG_GROUP_FIELDS.generation).toEqual(
      expect.arrayContaining(['requestDelayMs', 'requestDelayJitterMs']),
    );
    expect(CONFIG_SYNC_EXCLUDED).toContain('delayTime');
    expect(CONFIG_SYNC_EXCLUDED).toContain('requestDelayWarningDismissed');
  });

  test('내보내기 → 불러오기 왕복, 범위 밖 값은 보정·형식 불일치는 건너뜀', () => {
    const file = buildConfigExport(
      { requestDelayMs: 6000, requestDelayJitterMs: 5000, delayTime: 1000, requestDelayWarningDismissed: true },
      META,
    );
    expect(file.groups.generation.requestDelayMs).toBe(6000);
    expect(JSON.stringify(file)).not.toContain('"delayTime"');
    expect(JSON.stringify(file)).not.toContain('requestDelayWarningDismissed');
    const parsed = parseConfigImport({
      ...file,
      groups: { generation: { requestDelayMs: 99999, requestDelayJitterMs: '3' } },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.groups.generation).toEqual({ requestDelayMs: 10000 });
  });

  test('적용하면 옛 키 delayTime 에 min(…, 1000) 병기', () => {
    const next = applyConfigGroups(
      { delayTime: 0 },
      { generation: { requestDelayMs: 4000, requestDelayJitterMs: 1000 } },
      { generation: true },
    );
    expect(next).toEqual({ delayTime: 1000, requestDelayMs: 4000, requestDelayJitterMs: 1000 });
    const small = applyConfigGroups({}, { generation: { requestDelayMs: 300 } }, { generation: true });
    expect(small.delayTime).toBe(300);
  });

  test('없음과 기본값(1.5초·±0.5초)은 바뀌는 항목이 아니다', () => {
    const diff = diffConfigGroups(
      {},
      { generation: { requestDelayMs: 1500, requestDelayJitterMs: null } },
    );
    expect(diff.find((d) => d.group === 'generation')!.changed).toEqual([]);
  });
});

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

  test('종류 인자: rate-limit = true 와 같고, other = false 와 같다', () => {
    expect(retryWaitMs(1, 'rate-limit', mid)).toBe(retryWaitMs(1, true, mid));
    expect(retryWaitMs(3, 'other', mid)).toBe(retryWaitMs(3, false, mid));
  });

  test('409(concurrent)는 실패 횟수·난수와 무관하게 고정 30초(T4)', () => {
    expect(CONCURRENT_RETRY_WAIT_MS).toBe(30000);
    const rand = jest.fn(() => 0.999999);
    for (const n of [1, 2, 5, 9]) expect(retryWaitMs(n, 'concurrent', rand)).toBe(30000);
    expect(rand).not.toHaveBeenCalled();
  });
});

describe('409 판정(T4 — kind/status 우선, 문구는 폴백)', () => {
  test('NaiApiError 409 와 「Concurrent generation is locked」', () => {
    const e = createNaiApiError(409, JSON.stringify({ message: 'Concurrent generation is locked' }));
    expect(e.kind).toBe('concurrent');
    expect(e.retryable).toBe(true);
    expect(e.message).toBe('이전 요청 처리 중 (409): Concurrent generation is locked');
    expect(isNaiConcurrentError(e)).toBe(true);
    // 상태가 409 가 아니어도 서버 문구로 판정
    const e2 = createNaiApiError(400, 'Concurrent generation is locked');
    expect(e2.kind).toBe('concurrent');
    expect(isNaiConcurrentError(e2)).toBe(true);
  });

  test('429·5xx·요청 ID 의 409·타임아웃은 409 가 아니다', () => {
    expect(isNaiConcurrentError(createNaiApiError(429, ''))).toBe(false);
    expect(isNaiConcurrentError(createNaiApiError(500, 'oops', 'ray-409-abc'))).toBe(false);
    expect(isNaiConcurrentError(new RequestTimeoutError(1000))).toBe(false);
    expect(isNaiConcurrentError(new Error('HTTP error:409'))).toBe(false);
    expect(isNaiConcurrentError(undefined)).toBe(false);
    // 409 는 429 판정에도 걸리지 않는다
    expect(isNaiRateLimitError(createNaiApiError(409, ''))).toBe(false);
  });

  test('status·kind 가 없는 오류만 문구 폴백', () => {
    expect(isNaiConcurrentError(new Error('Concurrent generation is locked'))).toBe(true);
    expect(isNaiConcurrentError({ kind: 'concurrent', message: '' })).toBe(true);
  });
});

describe('재시도 횟수·연속 실패 문구(T4)', () => {
  test('상수와 문구', () => {
    expect(NAI_MAX_TRIES).toBe(10);
    expect(CONSECUTIVE_FAILURE_STOP).toBe(3);
    expect(TASK_FAILURE_TEXT.attempt(3, NAI_MAX_TRIES)).toBe(' [3/10]');
    expect(TASK_FAILURE_TEXT.retriesExhausted(NAI_MAX_TRIES)).toBe('10회 재시도 실패 - 건너뜀');
    expect(TASK_FAILURE_TEXT.consecutiveStop('서버 오류')).toBe(
      '작업 3개가 연속으로 실패해 예약을 중지했습니다.\n마지막 오류: 서버 오류\n서버 상태를 확인한 뒤 다시 시작해 주세요.',
    );
    expect(TASK_FAILURE_TEXT.outerTimeoutAbort(7)).toBe('요청 시간 초과 — 진행 중 요청 취소 요청(ID 7)');
  });

  test('토스트 종류: 409 안내는 info, 업스케일 타임아웃 안내는 error', () => {
    expect(inferToastKind(TASK_FAILURE_TEXT.concurrentRetry)).toBe('info');
    expect(inferToastKind(TASK_FAILURE_TEXT.upscaleTimeout)).toBe('error');
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
