/**
 * 개발자용 NovelAI API 주소 전환(2026-11-01, 부스트 모드 디버그 — shared/naiEndpoints.ts).
 * 변수가 없으면 실제 NovelAI 상수 그대로, 루프백 주소만 전환, 서비스는 주소가 정해진 뒤 요청한다.
 * 실제 NovelAI 호출 없음(fetch 모킹).
 */
jest.mock('../../../models', () => ({ backend: { getConfig: jest.fn(async () => ({})) } }));
jest.mock('../../../componenets/BrushTool', () => ({ getImageDimensions: jest.fn() }));

import { NovelAiImageGenService } from '../nai';
import {
  NAI_API_ENDPOINT,
  NAI_IMAGE_ENDPOINT,
  normalizeDevNaiApiBase,
  resolveNaiEndpoints,
} from '../../../../shared/naiEndpoints';

test('변수 없음·빈 값 = 실제 NovelAI 상수 그대로', () => {
  expect(NAI_API_ENDPOINT).toBe('https://api.novelai.net');
  expect(NAI_IMAGE_ENDPOINT).toBe('https://image.novelai.net');
  for (const base of [undefined, null, '', '   ']) {
    expect(resolveNaiEndpoints(base as any)).toEqual({
      api: 'https://api.novelai.net',
      image: 'https://image.novelai.net',
      overridden: false,
    });
  }
});

test('루프백 주소만 전환, 그 밖·형식 오류는 무시', () => {
  expect(resolveNaiEndpoints('http://127.0.0.1:18080')).toEqual({
    api: 'http://127.0.0.1:18080',
    image: 'http://127.0.0.1:18080',
    overridden: true,
  });
  expect(normalizeDevNaiApiBase(' http://localhost:18080/ ')).toBe('http://localhost:18080');
  expect(normalizeDevNaiApiBase('http://[::1]:9000')).toBe('http://[::1]:9000');
  expect(normalizeDevNaiApiBase('http://127.0.0.2:1')).toBe('http://127.0.0.2:1');
  for (const bad of [
    'https://image.novelai.net',
    'http://192.168.0.5:18080',
    'http://evil.example:18080',
    'ftp://127.0.0.1',
    'http://127.0.0.1:18080/api',
    'http://user:pw@127.0.0.1:18080',
    'not a url',
  ]) {
    expect(resolveNaiEndpoints(bad).overridden).toBe(false);
  }
});

describe('NovelAiImageGenService 주소', () => {
  const userData = {
    subscription: {
      active: true,
      tier: 3,
      trainingStepsLeft: { fixedTrainingStepsLeft: 1, purchasedTrainingSteps: 0 },
      usage: { percent: 50, isNegative: false, timeUntilNextPercent: 10 },
    },
  };
  let fetchMock: jest.Mock;
  const originalFetch = (global as any).fetch;
  beforeEach(() => {
    fetchMock = jest.fn(async () => ({ ok: true, status: 200, json: async () => userData }));
    (global as any).fetch = fetchMock;
  });
  afterEach(() => {
    (global as any).fetch = originalFetch;
  });

  test('전달값 null = 실제 주소, 경고 없음', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const service = new NovelAiImageGenService({ fetchArrayBuffer: jest.fn() }, Promise.resolve(null));
    await service.validateToken('t');
    expect(fetchMock.mock.calls[0][0]).toBe('https://image.novelai.net/user/data');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test('전달값 = 가짜 서버 주소, 응답 전 요청도 기다렸다가 그 주소로(경고 1회)', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    let release!: (v: string) => void;
    const base = new Promise<string>((resolve) => {
      release = resolve;
    });
    const fetchArrayBuffer = jest.fn(async () => new ArrayBuffer(0));
    const service = new NovelAiImageGenService({ fetchArrayBuffer }, base);
    const pending = service.getRemainCredits('t');
    const pendingValidate = service.validateToken('t2');
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
    release('http://127.0.0.1:18080');
    await expect(pending).resolves.toBe(1);
    await expect(pendingValidate).resolves.toBe('valid');
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      'http://127.0.0.1:18080/user/data',
      'http://127.0.0.1:18080/user/data',
    ]);
    await service.encodeVibeImage('t', { image: 'x', info: 1 } as any).catch(() => {});
    expect((fetchArrayBuffer.mock.calls[0] as any[])[0]).toBe('http://127.0.0.1:18080/ai/encode-vibe');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
