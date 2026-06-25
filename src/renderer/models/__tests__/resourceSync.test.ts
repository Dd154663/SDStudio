// 자동 저장 핵심 동작 테스트: 가드가 'skip' 하면 dirty 를 유지(재시도)하고,
// 'ok' 면 저장 후 dirty 를 해제하는지 검증. (저장소 불안정 시 자동 재개의 토대)

// '.'(models 인덱스)를 mock 해 무거운 싱글톤 초기화를 우회하고 backend 만 제어한다.
const writeFile = jest.fn(async () => {});
jest.mock('..', () => ({
  backend: {
    writeFile,
    listFiles: jest.fn(async () => []),
  },
}));

import { ResourceSyncService } from '../ResourceSyncService';

class FakeResource {
  constructor(public data: any) {}
  toJSON() {
    return this.data;
  }
  fromJSON(j: any) {
    return new FakeResource(j);
  }
}

class TestService extends ResourceSyncService<FakeResource> {
  public guardDecision: 'ok' | 'skip' = 'ok';
  constructor() {
    super('projects', 999999);
  }
  createDefault(name: string) {
    return new FakeResource({ name });
  }
  async getHook() {}
  migrate(rc: any) {
    return rc;
  }
  protected async guardResourceWrite(): Promise<'ok' | 'skip'> {
    return this.guardDecision;
  }
  // 보호 메서드/필드 테스트 접근용 헬퍼
  setResource(name: string, data: any) {
    (this as any).resources[name] = new FakeResource(data);
    (this as any).dirty[name] = true;
  }
  isDirty(name: string) {
    return !!(this as any).dirty[name];
  }
  runFlush() {
    return (this as any).flush();
  }
}

beforeEach(() => {
  writeFile.mockClear();
});

describe('ResourceSyncService flush/writeResource 재시도 로직', () => {
  test("가드가 'skip' 이면 저장하지 않고 dirty 를 유지한다(회복 시 재시도)", async () => {
    const svc = new TestService();
    svc.setResource('p1', { name: 'p1', scenes: {} });
    svc.guardDecision = 'skip';

    await svc.runFlush();

    expect(writeFile).not.toHaveBeenCalled();
    expect(svc.isDirty('p1')).toBe(true); // dirty 유지
  });

  test("가드가 'ok' 이면 저장하고 dirty 를 해제한다", async () => {
    const svc = new TestService();
    svc.setResource('p1', { name: 'p1', scenes: {} });
    svc.guardDecision = 'ok';

    await svc.runFlush();

    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(svc.isDirty('p1')).toBe(false); // dirty 해제
  });

  test('skip 으로 멈췄다가 ok 로 회복되면 그때 저장된다(자동 재개)', async () => {
    const svc = new TestService();
    svc.setResource('p1', { name: 'p1', scenes: {} });

    svc.guardDecision = 'skip';
    await svc.runFlush();
    expect(writeFile).not.toHaveBeenCalled();
    expect(svc.isDirty('p1')).toBe(true);

    svc.guardDecision = 'ok';
    await svc.runFlush();
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(svc.isDirty('p1')).toBe(false);
  });
});
