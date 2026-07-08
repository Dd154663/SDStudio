// 동시 실행 수 제한 병렬 처리(worker-pool) 단일 출처.
//
// 내보내기 최적화(ExportPresetService)·전체 백업 최적화(BackupService)·
// WebP 일괄 변환(BatchProcessService)이 모두 동일한 "고정 개수의 워커가 공유
// 큐를 소진" 패턴을 쓴다(트랙2 WebP 고속화 Phase 1). 세 곳이 같은 알고리즘을
// 공유하도록 여기로 추출한다. 향후 동시성 상한 상향(Phase 2)도 이 한 곳만 바꾼다.
//
// 의미(기존 인라인 구현과 동작 동일):
//  - 워커 수 = min(max(1, concurrency), items.length). items 가 비면 0개(즉시 완료).
//  - 각 워커는 큐(FIFO)에서 하나씩 꺼내 worker(item, index) 를 await 한다.
//  - worker 내부 예외는 호출부에서 try/catch 로 처리(현행 각 사용처가 자체 집계).
export async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const queue = items.map((item, index) => ({ item, index }));
  const workerCount = Math.min(Math.max(1, concurrency), queue.length);
  const runners = Array.from({ length: workerCount }, async () => {
    while (queue.length > 0) {
      const task = queue.shift();
      if (!task) break;
      await worker(task.item, task.index);
    }
  });
  await Promise.all(runners);
}
