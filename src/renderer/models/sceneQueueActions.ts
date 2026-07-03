import { appState } from './AppService';
import { promptService, sessionService, taskQueueService } from '.';
import {
  queueI2IWorkflow,
  queueMirrorWorkflow,
  queueWorkflow,
} from './TaskQueueService';
import {
  GenericScene,
  InpaintScene,
  Piece,
  PieceLibrary,
  Session,
} from './types';

// 씬 큐 예약(추가/제거) 공유 로직 단일 출처.
// SceneQueueControl(툴바·단축키·카드 버튼)과 AppContextMenu(우클릭 메뉴)가 함께 사용한다.
// (이전엔 SceneQueueControl 내부에만 있던 것을 추출해 중복 없이 재사용)

export const createMissingPiecesForSession = (
  session: Session,
  missing: { library: string; piece: string }[],
) => {
  for (const m of missing) {
    let lib = session.library.get(m.library);
    if (!lib) {
      lib = new PieceLibrary();
      lib.name = m.library;
      session.library.set(m.library, lib);
    }
    if (!lib.pieces.find((x) => x.name === m.piece)) {
      const piece = new Piece();
      piece.name = m.piece;
      lib.pieces.push(piece);
    }
  }
  sessionService.markDirty(session.name);
  sessionService.reloadPieceLibraryDB(session);
};

export const queueScene = async (
  session: Session,
  scene: GenericScene,
  samples: number,
) => {
  if (scene.type === 'scene') {
    await queueWorkflow(session, session.selectedWorkflow!, scene, samples);
  } else {
    const inpaintScene = scene as InpaintScene;
    if (inpaintScene.workflowType === 'SDMirror') {
      await queueMirrorWorkflow(
        session,
        inpaintScene.workflowType,
        inpaintScene.preset,
        inpaintScene,
        samples,
      );
    } else {
      await queueI2IWorkflow(
        session,
        scene.workflowType,
        scene.preset,
        scene,
        samples,
      );
    }
  }
};

// 모든(또는 선택한) 씬을 큐에 예약 추가. 누락 프롬프트조각이 있으면 생성 여부를 확인한다.
export const addScenesToQueue = async (
  session: Session,
  type: 'scene' | 'inpaint',
  selectedOnly: boolean,
) => {
  try {
    let scenes = session.getScenes(type);
    if (selectedOnly) {
      const selectedNames = appState.selectedScenes;
      scenes = scenes.filter((s) => selectedNames.has(s.name));
    }
    if (scenes.length === 0) return;

    const allMissing: { library: string; piece: string }[] = [];
    for (const scene of scenes) {
      const missing = promptService.findMissingPieces(session, scene);
      for (const m of missing) {
        if (
          !allMissing.find(
            (x) => x.library === m.library && x.piece === m.piece,
          )
        ) {
          allMissing.push(m);
        }
      }
    }

    const doQueue = async () => {
      for (const scene of scenes) {
        try {
          await queueScene(session, scene, appState.samples);
        } catch (e: any) {
          appState.pushMessage(`프롬프트 에러 (${scene.name}): ${e.message}`);
        }
      }
    };

    if (allMissing.length > 0) {
      const list = allMissing
        .map((m) => `<${m.library}.${m.piece}>`)
        .join(', ');
      appState.pushDialog({
        type: 'confirm',
        text: `존재하지 않는 프롬프트조각이 발견되었습니다:\n${list}\n\n로컬 프롬프트조각으로 새로 만들까요?\n(빈 조각이 생성되며, 내용은 직접 채워주세요)`,
        callback: async () => {
          createMissingPiecesForSession(session, allMissing);
          await doQueue();
        },
      });
      return;
    }
    await doQueue();
  } catch (e: any) {
    appState.pushMessage(`프롬프트 에러: ${e.message}`);
  }
};

// 모든(또는 선택한) 씬의 예약을 큐에서 제거.
export const removeScenesFromQueue = (
  session: Session,
  type: 'scene' | 'inpaint',
  selectedOnly: boolean,
) => {
  let scenes = session.getScenes(type);
  if (selectedOnly) {
    const selectedNames = appState.selectedScenes;
    scenes = scenes.filter((s) => selectedNames.has(s.name));
  }
  if (scenes.length === 0) return;
  for (const scene of scenes) {
    taskQueueService.removeTasksFromScene(scene);
  }
};
