// 글로벌 저장소(글로벌 프리셋·전역 조각·글로벌 캐릭터 프리셋·작가 라이브러리·프로젝트 템플릿)의 「바뀐 것만 지금 저장」
// 묶음과 백그라운드 전환 훅(2026-11-17 Android 보강 B, 플랜 guides/plans/2026-11-17-global-store-safety.md).
//
// Android 는 종료 훅(onClose)이 no-op 이라, 2초 디바운스 대기 중에 앱이 백그라운드에서 정리되면 그 편집이 사라졌다.
// 프로젝트 쪽(ResourceSyncService 의 visibilitychange 강제 저장)과 같이 화면이 숨겨질 때 글로벌 저장소도 비운다.
// 각 flushSave 는 바뀐 것(dirty·대기 중 저장)이 있을 때만 쓰므로, 무변경이면 디스크를 건드리지 않는다.
// 서비스를 import 하지 않는다(호출부가 목록을 넘긴다 — 테스트 주입).

export interface FlushableGlobalStore {
  flushSave(): Promise<void>;
}

/** 순서대로 비운다. 한 저장소의 실패가 뒤 저장소를 건너뛰게 하지 않는다 */
export async function flushGlobalStores(stores: FlushableGlobalStore[]): Promise<void> {
  for (const s of stores) {
    try {
      await s.flushSave();
    } catch (e) {
      console.error('글로벌 저장소 저장 실패(다음 저장소 계속):', e);
    }
  }
}

interface VisibilityDoc {
  readonly hidden: boolean;
  addEventListener(type: 'visibilitychange', fn: () => void): void;
}

let hiddenFlushInstalled = false;

/**
 * 화면이 숨겨질 때(document.hidden) flush 를 부르는 훅을 한 번만 설치한다. 다시 부르면 무동작(false).
 * doc 이 없으면(테스트·비브라우저) 설치하지 않는다.
 */
export function installGlobalStoreHiddenFlush(
  flush: () => Promise<void>,
  doc: VisibilityDoc | undefined = typeof document !== 'undefined' ? document : undefined,
): boolean {
  if (hiddenFlushInstalled || !doc) return false;
  hiddenFlushInstalled = true;
  doc.addEventListener('visibilitychange', () => {
    if (!doc.hidden) return;
    flush().catch((e) => console.error('백그라운드 전환 글로벌 저장소 저장 실패:', e));
  });
  return true;
}

/** 테스트 전용 — 설치 표시 초기화 */
export function __resetGlobalStoreHiddenFlushForTest(): void {
  hiddenFlushInstalled = false;
}
