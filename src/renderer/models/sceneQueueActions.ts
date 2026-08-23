import { appState } from './AppService';
import {
  backend,
  imageService,
  promptService,
  sessionService,
  taskQueueService,
  templateService,
} from '.';
import {
  queueI2IWorkflow,
  queueMirrorWorkflow,
  queueWorkflow,
} from './TaskQueueService';
import { GenerationSettingsSnapshot } from '../backends/imageGen';
import {
  GenericScene,
  InpaintScene,
  Piece,
  PieceLibrary,
  Scene,
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
  generationSnapshot?: GenerationSettingsSnapshot,
) => {
  if (scene.type === 'scene') {
    await queueWorkflow(
      session,
      session.selectedWorkflow!,
      scene,
      samples,
      generationSnapshot,
    );
  } else {
    const inpaintScene = scene as InpaintScene;
    if (inpaintScene.workflowType === 'SDMirror') {
      await queueMirrorWorkflow(
        session,
        inpaintScene.workflowType,
        inpaintScene.preset,
        inpaintScene,
        samples,
        undefined,
        generationSnapshot,
      );
    } else {
      await queueI2IWorkflow(
        session,
        scene.workflowType,
        scene.preset,
        scene,
        samples,
        undefined,
        generationSnapshot,
      );
    }
  }
};

// ── 퀵 생성 전용 예약 (퀵 생성 개편, 2026-07-18 합의) ──
//
// 프롬프트/프리셋 해석은 promptSession(현재 프로젝트 좌측 패널), 태스크 귀속
// (출력 폴더·imageMap·통계·image-added 이벤트)은 quickSession(전용 숨김 프로젝트).
// queueWorkflow 를 그대로 쓰면 세션이 하나로 묶여 출력이 현재 프로젝트에 떨어지므로,
// 해석 단계(createPrompt — 조각/캐릭터 프리셋이 promptSession 기준)와 귀속 단계
// (def.handler — getOutputDir(session, scene)이 quickSession 기준)를 분리한다.
//
// 바이브/레퍼런스 파일은 실행 시점에 task.params.session(=quickSession) 폴더에서
// 로드되므로(TaskHandlers), 예약 시점에 현재 프로젝트 폴더에서 전용 프로젝트
// 폴더로 복사해 둔다(없을 때만 — 인코딩된 바이브도 함께 복사해 재인코딩 방지).
const copyIfMissing = async (src: string, dest: string) => {
  try {
    if (await backend.existFile(dest)) return;
    if (!(await backend.existFile(src))) return;
    await backend.copyFile(src, dest);
  } catch (e) {
    // 복사 실패 시 예약은 계속 — 실행 시점 로드 실패가 사용자 메시지로 안내된다
    console.warn('퀵 생성 자산 복사 실패:', src, e);
  }
};

const copyPresetAssets = async (
  from: Session,
  to: Session,
  shared: any,
): Promise<void> => {
  for (const v of shared.vibes ?? []) {
    if (!v?.path) continue;
    await copyIfMissing(
      imageService.getVibeImagePath(from, v.path),
      imageService.getVibeImagePath(to, v.path),
    );
    await copyIfMissing(
      imageService.getEncodedVibeImagePath(from, v.path, v.info),
      imageService.getEncodedVibeImagePath(to, v.path, v.info),
    );
  }
  for (const r of shared.characterReferences ?? []) {
    if (r?.enabled === false || !r?.path) continue;
    const name = r.path.split('/').pop()!;
    await copyIfMissing(
      imageService.getReferenceDir(from) + '/' + name,
      imageService.getReferenceDir(to) + '/' + name,
    );
  }
};

export const queueQuickScene = async (
  promptSession: Session,
  quickSession: Session,
  scene: Scene,
  samples: number,
) => {
  const workflow = promptSession.selectedWorkflow!;
  const [type, preset, shared, def] = promptSession.getCommonSetup(workflow);
  const prompts = await def.createPrompt!(promptSession, scene, preset, shared);
  const characterPrompts = await def.createCharacterPrompts!(
    promptSession,
    scene,
    preset,
    shared,
  );
  await copyPresetAssets(promptSession, quickSession, shared);
  for (let i = 0; i < prompts.length; i++) {
    await def.handler(
      quickSession,
      scene,
      prompts[i],
      characterPrompts[i],
      preset,
      shared,
      samples,
      scene.meta.get(type),
    );
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
      let generationSnapshot: GenerationSettingsSnapshot;
      try {
        generationSnapshot = await taskQueueService.captureGenerationSnapshot();
      } catch (e) {
        console.error('일괄 예약 생성 설정을 읽지 못했습니다:', e);
        appState.pushMessage('생성 설정을 읽지 못해 예약하지 못했습니다.');
        return;
      }
      for (const scene of scenes) {
        try {
          await queueScene(
            session,
            scene,
            appState.samples,
            generationSnapshot,
          );
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

// 한 세션의 모든 씬을 예약 추가 (프롬프트 에러 등 씬 단위 실패는 집계만)
const queueAllScenesOfSession = async (
  session: Session,
  samples: number,
  sharedSnapshot?: GenerationSettingsSnapshot,
) => {
  let queued = 0;
  let failed = 0;
  const scenes = session.getScenes('scene');
  let generationSnapshot = sharedSnapshot;
  if (!generationSnapshot) {
    try {
      generationSnapshot = await taskQueueService.captureGenerationSnapshot();
    } catch (e) {
      console.error('일괄 예약 생성 설정을 읽지 못했습니다:', e);
      return { queued: 0, failed: scenes.length };
    }
  }
  for (const scene of scenes) {
    try {
      await queueScene(session, scene, samples, generationSnapshot);
      queued++;
    } catch (e) {
      failed++;
    }
  }
  return { queued, failed };
};

// 단일 프로젝트에 "모든 씬 예약 추가" — 드로어 프로젝트 메뉴의 간편 예약
// (2026-07-17, 확인 창 없이 즉시). 예약 수 = 생성 위젯의 현재 예약 개수.
export const queueProjectForGeneration = async (name: string) => {
  const samples = appState.samples;
  let session: Session | undefined;
  try {
    session = await sessionService.get(name);
  } catch (e) {}
  if (!session) {
    appState.pushMessage('프로젝트를 불러올 수 없습니다.');
    return;
  }
  const { queued, failed } = await queueAllScenesOfSession(session, samples);
  const parts = [`씬 ${queued}개 × ${samples}장 예약됨`];
  if (failed > 0) parts.push(`실패 ${failed}개`);
  appState.pushMessage(`"${name}" — ${parts.join(' · ')}`);
};

// 폴더(서브폴더 포함) 안 모든 프로젝트에 "모든 씬 예약 추가"를 실행하는
// 일괄 생성 예약 (2026-07-17). 예약 수 = 생성 위젯의 현재 예약 개수
// (appState.samples). 큐에 추가만 하고 실행은 기존 예약 의미론대로 사용자가
// 시작한다. 비활성 세션 예약은 순차 생성 프로젝트 파일 모드와 같은 경로
// (queueScene 이 세션 매개변수화돼 있음). 프로젝트가 많아 누락 프롬프트조각
// 자동 생성을 대화형으로 물을 수 없으므로, 프롬프트 에러는 프로젝트 단위로
// 수집해 요약만 한다.
export const queueFolderProjectsForGeneration = async (folder: string) => {
  // 숨김 씬 템플릿은 일괄 예약 대상에서 제외 (씬 템플릿 개편 2026-07-18)
  const names = templateService
    .filterVisibleProjects(sessionService.list())
    .filter((n) => {
      const f = sessionService.getFolderOf(n);
      return f === folder || !!(f && f.startsWith(folder + '/'));
    });
  if (names.length === 0) {
    appState.pushMessage('이 폴더에 프로젝트가 없습니다.');
    return;
  }
  const samples = appState.samples;
  appState.pushDialog({
    type: 'confirm',
    text:
      `"${sessionService.folderLeafName(folder)}" 폴더(서브폴더 포함)의 ` +
      `프로젝트 ${names.length}개에\n프로젝트마다 모든 씬 × ${samples}장 ` +
      `생성 예약을 추가할까요?`,
    callback: async () => {
      let generationSnapshot: GenerationSettingsSnapshot;
      try {
        generationSnapshot = await taskQueueService.captureGenerationSnapshot();
      } catch (e) {
        console.error('일괄 예약 생성 설정을 읽지 못했습니다:', e);
        appState.pushMessage('생성 설정을 읽지 못해 예약하지 못했습니다.');
        return;
      }
      let queuedScenes = 0;
      const failed: string[] = [];
      appState.setProgressDialog({
        text: '일괄 생성 예약 중...',
        done: 0,
        total: names.length,
      });
      try {
        for (let i = 0; i < names.length; i++) {
          const name = names[i];
          try {
            const session = await sessionService.get(name);
            if (!session) throw new Error('프로젝트 로드 실패');
            const r = await queueAllScenesOfSession(
              session,
              samples,
              generationSnapshot,
            );
            queuedScenes += r.queued;
            if (r.failed > 0 && !failed.includes(name)) failed.push(name);
          } catch (e) {
            if (!failed.includes(name)) failed.push(name);
          }
          appState.setProgressDialog({
            text: '일괄 생성 예약 중...',
            done: i + 1,
            total: names.length,
          });
        }
      } finally {
        appState.setProgressDialog(undefined);
      }
      const parts = [`씬 ${queuedScenes}개 × ${samples}장 예약됨`];
      if (failed.length > 0) {
        parts.push(`문제 발생 ${failed.length}개 (${failed.join(', ')})`);
      }
      appState.pushMessage(`일괄 생성 예약 완료 — ${parts.join(' · ')}`);
    },
  });
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
  taskQueueService.removeTasksFromScenes(new Set(scenes), session);
};
