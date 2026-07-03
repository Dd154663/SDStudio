// 쓰기 파이프라인(PersistenceService) 핵심 동작 테스트:
//  - 같은 경로 쓰기의 직렬화(동시 실행 없음) + 순서 보장
//  - 진행 중 쓰기 뒤에 밀린 쓰기들의 병합(마지막 데이터만 기록)
//  - 경로 간 독립(다른 파일은 병렬·실패 격리)
//  - flushAll(모든 대기·진행 쓰기 완료 대기)

// '.'(models 인덱스)를 mock 해 backend 만 제어한다.
let resolvers: (() => void)[] = [];
const written: { path: string; data: string }[] = [];
let failPaths = new Set<string>();
let manual = false; // true 면 쓰기가 resolvers 를 통해 수동으로 끝난다

const writeFile = jest.fn(async (path: string, data: string) => {
  if (manual) {
    await new Promise<void>((r) => resolvers.push(r));
  }
  if (failPaths.has(path)) throw new Error('write failed: ' + path);
  written.push({ path, data });
});

jest.mock('..', () => ({
  backend: { writeFile: (p: string, d: string) => writeFile(p, d) },
}));

import { PersistenceService } from '../PersistenceService';

beforeEach(() => {
  writeFile.mockClear();
  written.length = 0;
  resolvers = [];
  failPaths = new Set();
  manual = false;
});

// 마이크로태스크 큐를 비운다 (수동 모드에서 펌프가 다음 단계로 넘어가도록)
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('PersistenceService 쓰기 파이프라인', () => {
  test('같은 경로 연속 쓰기는 순서대로 기록된다', async () => {
    const svc = new PersistenceService();
    await Promise.all([svc.write('a.json', '1'), svc.write('a.json', '2')]);
    // 병합 여부와 무관하게 최종 디스크 내용은 마지막 데이터
    expect(written[written.length - 1]).toEqual({ path: 'a.json', data: '2' });
  });

  test('진행 중 쓰기 뒤에 밀린 쓰기들은 마지막 것으로 병합된다', async () => {
    manual = true;
    const svc = new PersistenceService();
    const p1 = svc.write('a.json', '1'); // 즉시 시작 (진행 중)
    await tick();
    const p2 = svc.write('a.json', '2'); // 대기열
    const p3 = svc.write('a.json', '3'); // 대기열 병합 (2 를 대체)
    // 첫 쓰기 완료
    resolvers.shift()!();
    await tick();
    // 병합된 두 번째 쓰기 완료
    resolvers.shift()!();
    await Promise.all([p1, p2, p3]);
    expect(written.map((w) => w.data)).toEqual(['1', '3']); // '2' 는 기록되지 않음
    expect(writeFile).toHaveBeenCalledTimes(2);
  });

  test('한 경로의 실패가 다른 경로에 영향을 주지 않는다', async () => {
    const svc = new PersistenceService();
    failPaths.add('bad.json');
    const bad = svc.write('bad.json', 'x');
    const good = svc.write('good.json', 'y');
    await expect(bad).rejects.toThrow('write failed');
    await expect(good).resolves.toBeUndefined();
    expect(written).toEqual([{ path: 'good.json', data: 'y' }]);
  });

  test('병합된 호출들의 promise 는 최종 기록 결과로 함께 해소된다', async () => {
    manual = true;
    const svc = new PersistenceService();
    const p1 = svc.write('a.json', '1');
    await tick();
    const p2 = svc.write('a.json', '2');
    const p3 = svc.write('a.json', '3');
    resolvers.shift()!();
    await tick();
    resolvers.shift()!();
    await expect(p2).resolves.toBeUndefined();
    await expect(p3).resolves.toBeUndefined();
    await expect(p1).resolves.toBeUndefined();
  });

  test('flushAll 은 대기·진행 중인 모든 쓰기가 끝날 때까지 기다린다', async () => {
    manual = true;
    const svc = new PersistenceService();
    void svc.write('a.json', '1');
    void svc.write('b.json', '2');
    await tick();
    const flush = svc.flushAll();
    let flushed = false;
    void flush.then(() => (flushed = true));
    await tick();
    expect(flushed).toBe(false); // 아직 쓰기 미완료
    resolvers.shift()!();
    resolvers.shift()!();
    await flush;
    expect(written.length).toBe(2);
  });
});
