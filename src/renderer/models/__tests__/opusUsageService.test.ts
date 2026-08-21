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
});
