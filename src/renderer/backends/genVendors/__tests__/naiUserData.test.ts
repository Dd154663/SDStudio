/**
 * `/user/data` 연속 조회 방지(2026-10-03 갈래 T2) — 잔량·Opus 할당량은 같은 토큰이면 10초 안의
 * 직전 응답을 재사용하고 동시 호출은 합친다. force 는 새로 읽고, 토큰 검증은 캐시를 쓰지 않는다.
 * 30초 시간 제한(본문 포함). 실제 NovelAI 호출 없음(fetch 모킹).
 */
jest.mock('../../../models', () => ({ backend: { getConfig: jest.fn() } }));
jest.mock('../../../componenets/BrushTool', () => ({ getImageDimensions: jest.fn() }));

import { NovelAiImageGenService } from '../nai';
import { RequestTimeoutError } from '../../../models/requestTiming';

const userData = {
  subscription: {
    active: true,
    tier: 3,
    trainingStepsLeft: { fixedTrainingStepsLeft: 100, purchasedTrainingSteps: 20 },
    usage: { percent: 80, isNegative: false, timeUntilNextPercent: 30 },
  },
};

function okResponse(body: any = userData) {
  return { ok: true, status: 200, json: async () => body };
}

let fetchMock: jest.Mock;
const originalFetch = (global as any).fetch;

beforeEach(() => {
  fetchMock = jest.fn(async () => okResponse());
  (global as any).fetch = fetchMock;
});

afterEach(() => {
  (global as any).fetch = originalFetch;
  jest.useRealTimers();
});

function makeService() {
  return new NovelAiImageGenService({ fetchArrayBuffer: jest.fn() });
}

test('잔량과 Opus 할당량은 같은 토큰이면 10초 안에 한 번만 조회', async () => {
  const service = makeService();
  await expect(service.getRemainCredits('tokenA')).resolves.toBe(120);
  await expect(service.getOpusUsageStatus('tokenA')).resolves.toMatchObject({ percent: 80 });
  await service.getOpusUsageStatus('tokenA');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toBe('https://image.novelai.net/user/data');
});

test('10초가 지나면 다시 조회', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-03T00:00:00Z'));
  const service = makeService();
  await service.getRemainCredits('tokenA');
  jest.setSystemTime(new Date('2026-10-03T00:00:09.999Z'));
  await service.getRemainCredits('tokenA');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  jest.setSystemTime(new Date('2026-10-03T00:00:10Z'));
  await service.getRemainCredits('tokenA');
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test('동시 호출은 하나로 합친다', async () => {
  let resolve!: (v: any) => void;
  fetchMock.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
  const service = makeService();
  const a = service.getRemainCredits('tokenA');
  const b = service.getOpusUsageStatus('tokenA');
  resolve(okResponse());
  await expect(a).resolves.toBe(120);
  await expect(b).resolves.toMatchObject({ opusSubscribed: true });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('force 는 캐시를 건너뛰고, 다른 토큰은 따로 조회', async () => {
  const service = makeService();
  await service.getOpusUsageStatus('tokenA');
  await service.getOpusUsageStatus('tokenA', { force: true });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  await service.getOpusUsageStatus('tokenB');
  expect(fetchMock).toHaveBeenCalledTimes(3);
  const auth = fetchMock.mock.calls.map((c: any[]) => c[1].headers.Authorization);
  expect(auth).toEqual(['Bearer tokenA', 'Bearer tokenA', 'Bearer tokenB']);
});

test('실패 응답은 캐시하지 않는다', async () => {
  fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 500, json: async () => ({}) }));
  const service = makeService();
  await expect(service.getRemainCredits('tokenA')).rejects.toThrow('HTTP error:500');
  await expect(service.getRemainCredits('tokenA')).resolves.toBe(120);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test('토큰 검증은 캐시를 쓰지 않는다(사용자가 직접 누른 경로)', async () => {
  const service = makeService();
  await service.getRemainCredits('tokenA');
  await expect(service.validateToken('tokenA')).resolves.toBe('valid');
  await expect(service.validateToken('tokenA')).resolves.toBe('valid');
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

test('응답이 없으면 30초에 시간 초과(토큰 검증은 error 로 상태 유지)', async () => {
  jest.useFakeTimers();
  fetchMock.mockImplementation(() => new Promise(() => {}));
  const service = makeService();
  const credits = service.getRemainCredits('tokenA');
  const assertion = expect(credits).rejects.toBeInstanceOf(RequestTimeoutError);
  const validity = service.validateToken('tokenB');
  await Promise.resolve();
  jest.advanceTimersByTime(30000);
  await assertion;
  await expect(validity).resolves.toBe('error');
  // 요청에 abort 신호가 전달된다.
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
});
