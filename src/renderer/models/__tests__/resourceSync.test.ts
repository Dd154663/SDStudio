// 자동 저장 핵심 동작 테스트: 가드가 'skip' 하면 dirty 를 유지(재시도)하고,
// 'ok' 면 저장 후 dirty 를 해제하는지 검증. (저장소 불안정 시 자동 재개의 토대)

// '.'(models 인덱스)를 mock 해 무거운 싱글톤 초기화를 우회하고 backend 만 제어한다.
const writeFile = jest.fn(async () => {});
jest.mock('..', () => ({
  backend: {
    writeFile,
    listFiles: jest.fn(async () => []),
    listFilesWithStats: jest.fn(async () => []),
    renameFile: jest.fn(async () => {}),
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
  public guardDecision: 'ok' | 'skip' | 'skip-keep' = 'ok';
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
  protected async guardResourceWrite(): Promise<'ok' | 'skip' | 'skip-keep'> {
    return this.guardDecision;
  }
  // 보호 메서드/필드 테스트 접근용 헬퍼 (수명주기 엔트리 직접 주입)
  setResource(name: string, data: any) {
    (this as any).entries.set(name, {
      state: 'ready',
      dirty: true,
      seq: 0,
      instance: new FakeResource(data),
    });
  }
  isDirty(name: string) {
    return !!(this as any).entries.get(name)?.dirty;
  }
  runFlush() {
    return (this as any).flush();
  }
}

beforeEach(() => {
  writeFile.mockClear();
});

describe('ResourceSyncService flush/writeResource 재시도 로직', () => {
  test("'skip-keep'(일시적 보류) 이면 저장하지 않고 dirty 를 유지한다(회복 시 재시도)", async () => {
    const svc = new TestService();
    svc.setResource('p1', { name: 'p1', scenes: {} });
    svc.guardDecision = 'skip-keep';

    await svc.runFlush();

    expect(writeFile).not.toHaveBeenCalled();
    expect(svc.isDirty('p1')).toBe(true); // dirty 유지(재시도)
  });

  test("'skip'(구조적 드롭) 이면 저장도 안 하고 dirty 도 해제한다(재시도 스핀 없음)", async () => {
    const svc = new TestService();
    svc.setResource('p1', { name: 'p1', scenes: {} });
    svc.guardDecision = 'skip';

    await svc.runFlush();

    expect(writeFile).not.toHaveBeenCalled();
    expect(svc.isDirty('p1')).toBe(false); // dirty 해제 → 매 사이클 재시도 안 함
  });

  test("'ok' 이면 저장하고 dirty 를 해제한다", async () => {
    const svc = new TestService();
    svc.setResource('p1', { name: 'p1', scenes: {} });
    svc.guardDecision = 'ok';

    await svc.runFlush();

    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(svc.isDirty('p1')).toBe(false); // dirty 해제
  });

  test("'skip-keep' 으로 멈췄다가 'ok' 로 회복되면 그때 저장된다(자동 재개)", async () => {
    const svc = new TestService();
    svc.setResource('p1', { name: 'p1', scenes: {} });

    svc.guardDecision = 'skip-keep';
    await svc.runFlush();
    expect(writeFile).not.toHaveBeenCalled();
    expect(svc.isDirty('p1')).toBe(true);

    svc.guardDecision = 'ok';
    await svc.runFlush();
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(svc.isDirty('p1')).toBe(false);
  });
});

describe('리소스 수명주기 상태 머신', () => {
  test('withLock 중(busy)에는 flush 가 해당 리소스를 건너뛰고, 해제 후 저장된다', async () => {
    const svc = new TestService();
    svc.setResource('p1', { name: 'p1', scenes: {} });
    let writesDuringLock = -1;
    await svc.withLock(['p1'], async () => {
      await svc.runFlush();
      writesDuringLock = writeFile.mock.calls.length;
    });
    expect(writesDuringLock).toBe(0); // busy 동안 저장 안 됨
    expect(svc.isDirty('p1')).toBe(true); // dirty 는 유지 → 락 해제 후 재시도
    await svc.runFlush();
    expect(writeFile).toHaveBeenCalledTimes(1);
  });

  test('rename 은 dirty/인스턴스를 새 이름으로 옮기고 옛 이름을 남기지 않는다', async () => {
    const svc = new TestService();
    svc.setResource('p1', { name: 'p1', scenes: {} });
    await svc.rename('p1', 'p2');
    expect((svc as any).entries.has('p1')).toBe(false);
    expect((svc as any).entries.get('p2')?.instance).toBeTruthy();
    // rename 내부 update() 가 dirty 를 새 이름(p2) 경로로 저장했는지
    const paths = writeFile.mock.calls.map((c: any[]) => c[0]);
    expect(paths).toContain('projects/p2.json');
    expect(paths).not.toContain('projects/p1.json');
  });

  test('미로드 이름을 잠갔다 풀면 자리표시자 엔트리가 남지 않는다', async () => {
    const svc = new TestService();
    await svc.withLock(['ghost'], async () => {
      expect((svc as any).entries.get('ghost')?.state).toBe('busy');
    });
    expect((svc as any).entries.has('ghost')).toBe(false);
  });

  test('같은 이름의 withLock 은 도착 순서대로 직렬화된다(동시 진입 없음)', async () => {
    const svc = new TestService();
    svc.setResource('p1', { name: 'p1', scenes: {} });
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((r) => (releaseFirst = r));
    const first = svc.withLock(['p1'], async () => {
      order.push('A-시작');
      await firstGate; // 첫 작업을 인위적으로 붙잡아 둔다
      order.push('A-끝');
    });
    const second = svc.withLock(['p1'], async () => {
      order.push('B-시작');
    });
    // 두 번째 락이 먼저 끝났는지 겨루게 한 뒤 첫 락을 풀어 준다
    await Promise.resolve();
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(['A-시작', 'A-끝', 'B-시작']); // B 는 A 완료 후에만 진입
  });

  test('flush 의 가드 대기 중 삭제가 완료되면 옛 경로로 쓰지 않는다(부활 방지)', async () => {
    const svc = new TestService();
    svc.setResource('p1', { name: 'p1', scenes: {} });
    // 가드를 인위적으로 붙잡아 "flush 수집 후 ~ 쓰기 전" 창을 크게 연다
    let releaseGuard!: () => void;
    const guardGate = new Promise<void>((r) => (releaseGuard = r));
    (svc as any).guardResourceWrite = async () => {
      await guardGate;
      return 'ok';
    };
    const flushing = svc.runFlush();
    await Promise.resolve(); // flush 가 가드에 진입하도록 양보
    await svc.delete('p1'); // 그 사이 삭제 완료 (renameFile mock 즉시 성공)
    releaseGuard();
    await flushing;
    const paths = writeFile.mock.calls.map((c: any[]) => c[0]);
    expect(paths).not.toContain('projects/p1.json'); // 삭제된 파일 재생성 없음
  });
});
