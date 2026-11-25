// 변형 씬 편집 창(InPaintEditor)이 닫힐 때(언마운트) 하는 마스크 저장은 기다리지 않는 비동기다. 그 저장이 끝나기 전에 같은 씬의
// 편집 창을 다시 열면(2026-11-25 [이미지 | 편집] 전환으로 잦아짐) 새 창이 옛 마스크(캐시·쓰는 중인 파일)를 읽거나, 아직 마스크
// 경로가 없는 씬이면 빈 마스크로 시작해 그 위 붓질이 앞 저장을 덮을 수 있다. 진행 중인 저장을 씬별로 적어 두고, 여는 쪽은
// 마스크를 읽기 전에 그것을 기다린다. 저장 실패는 삼킨다(기다림만 풀림 — 종전에도 알림 없음).

const pending = new WeakMap<object, Promise<void>>();

/** 씬의 마스크 저장 작업을 적어 둔다(같은 씬에 겹치면 모두 끝날 때까지). 넘긴 작업을 그대로 돌려준다. */
export function trackPendingMaskSave<T>(scene: object, task: Promise<T>): Promise<T> {
  const settled = task.then(
    () => undefined,
    () => undefined,
  );
  const prev = pending.get(scene);
  const all: Promise<void> = prev
    ? Promise.all([prev, settled]).then(() => undefined)
    : settled;
  pending.set(scene, all);
  void all.then(() => {
    if (pending.get(scene) === all) pending.delete(scene);
  });
  return task;
}

/** 그 씬에 진행 중인 마스크 저장이 있으면 끝날 때까지 기다린다(없으면 곧바로). */
export function waitPendingMaskSave(scene: object): Promise<void> {
  return pending.get(scene) ?? Promise.resolve();
}

/** 진행 중인 저장이 있는가(테스트·진단용) */
export function hasPendingMaskSave(scene: object): boolean {
  return pending.has(scene);
}
