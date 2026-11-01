// 씬 순서 변경의 되돌리기 계측(2026-11-01 U1 시범 — 드래그·맨 앞/뒤·이름순 정렬, SPEC_GUIDE 「되돌리기 계약」).
// 네 경로 모두 recordSceneOrder 로 감싼다: 드래그는 SceneQueueControl 의 moveScene/moveScenes(드롭 1회 = 변경 1회 —
// react-dnd 는 hover 중 순서를 바꾸지 않는다), 맨 앞/뒤는 AppContextMenu, 이름순 정렬은 BatchProcessService.
//
// 순서는 씬 객체 손잡이(undoRef) 배열로 보관하고, 되살릴 때는 Session.reorderScenes 로 병합한다 —
// 그사이 새로 생긴 씬(생성 중 추가·다른 작업)은 뒤에 남고, 사라진 씬은 건너뛴다. 씬 객체·이미지 필드는 손대지 않는다.
import type { GenericScene, Session } from './types';
import { undoRef, undoService, UndoRef, UndoService, UndoSnapshotAdapter } from './undoService';

type SceneKind = 'scene' | 'inpaint';

export function sceneOrderAdapter(
  session: Session,
  type: SceneKind,
): UndoSnapshotAdapter<UndoRef<GenericScene>[]> {
  return {
    snapshot: () => session.getScenes(type).map((s) => undoRef(s)),
    restore: (refs) =>
      session.reorderScenes(
        type,
        refs.map((r) => r.current),
      ),
    equals: (a, b) => a.length === b.length && a.every((r, i) => r === b[i]),
  };
}

/** 순서를 바꾸는 동작 mutate 를 감싸 1항목으로 기록(변화가 없으면 기록하지 않음 — 원위치 드롭·맨 앞 씬을 맨 앞으로 등) */
export function recordSceneOrder(
  session: Session | undefined,
  type: SceneKind,
  label: string,
  mutate: () => void,
  service: UndoService = undoService,
): void {
  if (!session) {
    mutate();
    return;
  }
  const pending = service.track(session, label, sceneOrderAdapter(session, type));
  try {
    mutate();
  } finally {
    pending.commit();
  }
}
