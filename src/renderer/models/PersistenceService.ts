import { backend } from '.';

// ── 단일 쓰기 파이프라인 ──
// 상태 파일(JSON 등 "같은 경로에 반복 저장되는 파일")의 모든 쓰기가 여기를 거친다.
// 목적: 같은 파일에 여러 주체(주기 자동 저장·가시성 flush·종료 flush·디바운스 저장)가
// 동시에 쓰던 기존 구조의 "쓰기 경쟁" 을 구조적으로 제거한다.
//
// 보장:
//  - 직렬화: 같은 경로에 대한 쓰기는 도착 순서대로 하나씩 디스크에 반영된다.
//  - 병합(coalescing): 앞 쓰기가 진행 중일 때 밀린 쓰기들은 마지막 데이터만 실제로
//    기록한다. 밀린 호출들의 promise 는 모두 그 최종 기록 결과로 해소된다.
//    (상태 파일은 항상 전체 스냅숏을 쓰므로 마지막 것만 쓰면 충분하다)
//  - 경로 간 독립: 서로 다른 파일의 쓰기는 병렬로 진행되고 실패도 격리된다.
//
// 이미지 등 "한 번 쓰고 끝나는 유니크 경로" 파일은 경쟁이 없으므로 대상이 아니다.

type Settler = { resolve: () => void; reject: (e: any) => void };

export class PersistenceService {
  // 경로별 진행 중 펌프(쓰기 루프). 완료되면 스스로 제거된다.
  #pumps = new Map<string, Promise<void>>();
  // 경로별 대기 데이터 — 항상 최신 스냅숏 하나만 유지(병합).
  #queued = new Map<string, { data: string; settlers: Settler[] }>();

  write(path: string, data: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const q = this.#queued.get(path);
      if (q) {
        // 아직 시작 안 한 쓰기가 있으면 데이터만 최신으로 교체(병합)
        q.data = data;
        q.settlers.push({ resolve, reject });
      } else {
        this.#queued.set(path, { data, settlers: [{ resolve, reject }] });
      }
      this.#ensurePump(path);
    });
  }

  #ensurePump(path: string) {
    if (this.#pumps.has(path)) return;
    const pump = this.#pump(path).finally(() => {
      this.#pumps.delete(path);
      // 펌프 종료 마이크로태스크 직전에 끼어든 쓰기가 있으면 재가동 (유실 방지)
      if (this.#queued.has(path)) this.#ensurePump(path);
    });
    this.#pumps.set(path, pump);
  }

  async #pump(path: string) {
    let q: { data: string; settlers: Settler[] } | undefined;
    while ((q = this.#queued.get(path))) {
      this.#queued.delete(path);
      try {
        await backend.writeFile(path, q.data);
        for (const s of q.settlers) s.resolve();
      } catch (e) {
        for (const s of q.settlers) s.reject(e);
      }
    }
  }

  // 특정 경로의 대기·진행 중 쓰기가 모두 디스크에 반영될 때까지 기다린다.
  // (삭제/이름변경 등 경로가 바뀌는 작업이 파일 rename 직전에 호출 —
  //  옛 경로로 향하던 잔여 쓰기가 rename 뒤에 파일을 되살리는 것을 방지)
  async flushPath(path: string): Promise<void> {
    while (this.#pumps.has(path)) {
      await this.#pumps.get(path)!.catch(() => {});
    }
  }

  // 대기·진행 중인 모든 쓰기가 끝날 때까지 기다린다 (종료 flush 용).
  // 기다리는 동안 새로 들어온 쓰기까지 포함해 큐가 완전히 빌 때까지 반복한다.
  async flushAll(): Promise<void> {
    while (this.#pumps.size > 0) {
      await Promise.allSettled([...this.#pumps.values()]);
    }
  }
}

// 싱글톤 — models/index 가 아닌 이 모듈에서 직접 내보낸다.
// (테스트가 models/index 를 mock 해도 파이프라인 자체는 실제 구현이 동작하고,
//  backend 만 mock 을 바라보게 된다)
export const persistService = new PersistenceService();
