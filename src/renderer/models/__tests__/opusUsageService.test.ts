import { OpusUsageService } from '../OpusUsageService';

describe('OpusUsageService', () => {
  test('동시 조회를 하나로 합치고 정상 상태를 저장한다', async () => {
    let resolve!: (value: any) => void;
    const getOpusUsageStatus = jest.fn(
      () => new Promise<any>((r) => (resolve = r)),
    );
    const service = new OpusUsageService({ getOpusUsageStatus } as any);

    const a = service.refresh(true);
    const b = service.refresh(true);
    resolve({ percent: 8, isNegative: false, timeUntilNextPercent: 20 });

    await expect(a).resolves.toMatchObject({ percent: 8 });
    await expect(b).resolves.toMatchObject({ percent: 8 });
    expect(getOpusUsageStatus).toHaveBeenCalledTimes(1);
    expect(service.state).toBe('ready');
    expect(service.takeLowWarning(service.status)).toBe(true);
    expect(service.takeLowWarning(service.status)).toBe(false);
  });

  test('조회 실패와 0퍼센트를 유료 전환 위험으로 본다', async () => {
    const service = new OpusUsageService({
      getOpusUsageStatus: jest.fn().mockRejectedValue(new Error('network')),
    } as any);

    await expect(service.refresh(true)).resolves.toBeUndefined();
    expect(service.state).toBe('error');
    expect(service.isPaidRisk(undefined)).toBe(true);
    expect(
      service.isPaidRisk({
        percent: 0,
        isNegative: false,
        timeUntilNextPercent: 1,
      }),
    ).toBe(true);
  });

  test('자동 전환에서 확인한 새 토큰 상태를 추가 조회 없이 채택한다', () => {
    const getOpusUsageStatus = jest.fn();
    const service = new OpusUsageService({ getOpusUsageStatus } as any);

    service.adoptKnownStatus({
      percent: 35,
      isNegative: false,
      timeUntilNextPercent: 30,
    });

    expect(service.state).toBe('ready');
    expect(service.status).toEqual(expect.objectContaining({ percent: 35 }));
    expect(service.fetchedAt).toBeGreaterThan(0);
    expect(getOpusUsageStatus).not.toHaveBeenCalled();
  });

  test('자연 회복으로 임계값을 넘었다가 다시 내려와도 세션 경고를 반복하지 않는다', async () => {
    const getOpusUsageStatus = jest
      .fn()
      .mockResolvedValueOnce({
        percent: 9,
        isNegative: false,
        timeUntilNextPercent: 30,
      })
      .mockResolvedValueOnce({
        percent: 11,
        isNegative: false,
        timeUntilNextPercent: 30,
      })
      .mockResolvedValueOnce({
        percent: 9,
        isNegative: false,
        timeUntilNextPercent: 30,
      });
    const service = new OpusUsageService({ getOpusUsageStatus } as any);

    await service.refresh(true);
    expect(service.takeLowWarning(service.status, 10)).toBe(true);
    await service.refresh(true);
    await service.refresh(true);

    expect(service.takeLowWarning(service.status, 10)).toBe(false);
  });

  test('토큰 자동 전환 상태 채택도 이미 표시한 세션 경고를 재무장하지 않는다', () => {
    const service = new OpusUsageService({
      getOpusUsageStatus: jest.fn(),
    } as any);
    const low = {
      percent: 8,
      isNegative: false,
      timeUntilNextPercent: 30,
    };

    expect(service.takeLowWarning(low, 10)).toBe(true);
    service.adoptKnownStatus({ ...low, percent: 40 });

    expect(service.takeLowWarning(low, 10)).toBe(false);
  });
});
