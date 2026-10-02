/**
 * 요청 지연·타임아웃 단일 출처(2026-10-03 갈래 T) — 지연 식·범위 보정·옛 키 병기·
 * 긴 휴식·타임아웃 증가·시간 제한 래퍼·429 판정·환경설정 동기화 포함 여부.
 */
import {
  computeLongBreakMs,
  computeRequestDelayMs,
  formatDelaySeconds,
  isRequestTimeoutError,
  legacyDelayTimeFor,
  LONG_BREAK_MAX_MS,
  LONG_BREAK_MIN_MS,
  nextLongBreakCount,
  nextRequestTimeoutMs,
  normalizeRequestDelayJitterMs,
  normalizeRequestDelayMs,
  queueAttemptTimeoutMs,
  RequestTimeoutError,
  resolveRequestDelaySettings,
  StaleAttemptError,
  withRequestDelaySettings,
  withRequestTimeout,
} from '../requestTiming';
import { createNaiApiError, isNaiRateLimitError } from '../../backends/genVendors/naiErrors';
import {
  applyConfigGroups,
  buildConfigExport,
  CONFIG_GROUP_FIELDS,
  CONFIG_SYNC_EXCLUDED,
  diffConfigGroups,
  parseConfigImport,
} from '../configSync';

describe('요청 사이 지연 = max(0, 기본 ± 랜덤)', () => {
  test('0/0 은 항상 0', () => {
    expect(computeRequestDelayMs(0, 0, () => 0)).toBe(0);
    expect(computeRequestDelayMs(0, 0, () => 0.999)).toBe(0);
  });

  test('랜덤 0 이면 기본값 그대로(난수를 쓰지 않는다)', () => {
    const rand = jest.fn(() => 0.3);
    expect(computeRequestDelayMs(1000, 0, rand)).toBe(1000);
    expect(rand).not.toHaveBeenCalled();
  });

  test('6000/5000 → 1000~11000 범위(양 끝·가운데)', () => {
    expect(computeRequestDelayMs(6000, 5000, () => 0)).toBe(1000);
    expect(computeRequestDelayMs(6000, 5000, () => 0.5)).toBe(6000);
    expect(computeRequestDelayMs(6000, 5000, () => 0.999999)).toBe(11000);
    for (let i = 0; i < 200; i++) {
      const v = computeRequestDelayMs(6000, 5000);
      expect(v).toBeGreaterThanOrEqual(1000);
      expect(v).toBeLessThanOrEqual(11000);
    }
  });

  test('1000/5000 은 음수 없이 0 이상(음수 구간은 0)', () => {
    expect(computeRequestDelayMs(1000, 5000, () => 0)).toBe(0);
    expect(computeRequestDelayMs(1000, 5000, () => 0.1)).toBe(0);
    expect(computeRequestDelayMs(1000, 5000, () => 0.6)).toBe(2000);
    for (let i = 0; i < 200; i++) {
      expect(computeRequestDelayMs(1000, 5000)).toBeGreaterThanOrEqual(0);
    }
  });

  test('범위 밖 입력은 보정 후 계산', () => {
    expect(computeRequestDelayMs(-500, 0)).toBe(0);
    expect(computeRequestDelayMs(99999, 99999, () => 0.999999)).toBe(15000);
  });

  test('표시 형식 「1.0초」', () => {
    expect(formatDelaySeconds(1000)).toBe('1.0초');
    expect(formatDelaySeconds(0)).toBe('0.0초');
    expect(formatDelaySeconds(10000)).toBe('10.0초');
    expect(formatDelaySeconds(2300)).toBe('2.3초');
  });
});

describe('설정 읽기: 기본값·범위 보정·옛 키 무시', () => {
  test('새 키가 없으면 기본 1초·랜덤 0 — 옛 delayTime 은 이어받지 않는다', () => {
    expect(resolveRequestDelaySettings({})).toEqual({ baseMs: 1000, jitterMs: 0 });
    expect(resolveRequestDelaySettings({ delayTime: 0 } as any)).toEqual({ baseMs: 1000, jitterMs: 0 });
    expect(resolveRequestDelaySettings({ delayTime: 700 } as any)).toEqual({ baseMs: 1000, jitterMs: 0 });
    expect(resolveRequestDelaySettings(undefined)).toEqual({ baseMs: 1000, jitterMs: 0 });
  });

  test('음수·NaN·문자열·상한 초과 보정', () => {
    expect(normalizeRequestDelayMs(-1)).toBe(0);
    expect(normalizeRequestDelayMs(NaN)).toBe(1000);
    expect(normalizeRequestDelayMs('3000')).toBe(1000);
    expect(normalizeRequestDelayMs(Infinity)).toBe(1000);
    expect(normalizeRequestDelayMs(20000)).toBe(10000);
    expect(normalizeRequestDelayMs(2500.4)).toBe(2500);
    expect(normalizeRequestDelayMs(0)).toBe(0);
    expect(normalizeRequestDelayJitterMs(undefined)).toBe(0);
    expect(normalizeRequestDelayJitterMs(-3)).toBe(0);
    expect(normalizeRequestDelayJitterMs(9000)).toBe(5000);
    expect(normalizeRequestDelayJitterMs(NaN)).toBe(0);
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

describe('주기적 긴 휴식', () => {
  test('고정 5~7.5분', () => {
    expect(computeLongBreakMs({ baseMs: 1000, jitterMs: 0 }, () => 0)).toBe(LONG_BREAK_MIN_MS);
    expect(computeLongBreakMs({ baseMs: 10000, jitterMs: 5000 }, () => 0.999999)).toBeLessThanOrEqual(
      LONG_BREAK_MAX_MS,
    );
    expect(LONG_BREAK_MIN_MS).toBe(300000);
    expect(LONG_BREAK_MAX_MS).toBe(450000);
  });

  test('기본·랜덤 둘 다 0 이면 쉬지 않는다, 하나라도 있으면 쉰다', () => {
    expect(computeLongBreakMs({ baseMs: 0, jitterMs: 0 }, () => 0.5)).toBe(0);
    expect(computeLongBreakMs({ baseMs: 0, jitterMs: 100 }, () => 0)).toBe(LONG_BREAK_MIN_MS);
  });

  test('간격은 500~599장', () => {
    expect(nextLongBreakCount(() => 0)).toBe(500);
    expect(nextLongBreakCount(() => 0.999999)).toBe(599);
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

describe('환경설정 동기화(생성 설정 군) 포함', () => {
  const META = { createdAt: '2026-10-03T00:00:00.000Z', appVersion: '5.4.0', platform: 'pc' as const };

  test('새 키는 생성 군 화이트리스트, 옛 키 delayTime 은 제외 목록', () => {
    expect(CONFIG_GROUP_FIELDS.generation).toEqual(
      expect.arrayContaining(['requestDelayMs', 'requestDelayJitterMs']),
    );
    expect(CONFIG_SYNC_EXCLUDED).toContain('delayTime');
  });

  test('내보내기 → 불러오기 왕복, 범위 밖 값은 보정·형식 불일치는 건너뜀', () => {
    const file = buildConfigExport({ requestDelayMs: 6000, requestDelayJitterMs: 5000, delayTime: 1000 }, META);
    expect(file.groups.generation.requestDelayMs).toBe(6000);
    expect(JSON.stringify(file)).not.toContain('"delayTime"');
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

  test('없음과 기본값(1초·랜덤 0)은 바뀌는 항목이 아니다', () => {
    const diff = diffConfigGroups(
      {},
      { generation: { requestDelayMs: 1000, requestDelayJitterMs: null } },
    );
    expect(diff.find((d) => d.group === 'generation')!.changed).toEqual([]);
  });
});
