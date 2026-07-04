import React, { useCallback, useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useContextMenu } from 'react-contexify';
import { v4 } from 'uuid';
import {
  cyclingSessionService,
  gameService,
  imageService,
  sessionService,
  taskQueueService,
} from '../models';
import { appState } from '../models/AppService';
import { queueScene } from '../models/sceneQueueActions';
import { ContextMenuType, Scene, Session } from '../models/types';

// 퀵 모드 탭 — NAI 공식 웹풍의 즉시 생성 화면.
// 중앙에 default 씬의 최신 생성 이미지를 크게 표시하고, 생성 버튼 하나로
// 클릭=즉시 1장 / 롱프레스=자동(반복) / 생성 중 재클릭=취소 동작을 제공한다.
// 프롬프트/파라미터는 기존 좌측 패널(모바일: 프롬프트 열기)을 그대로 사용.

const DEFAULT_SCENE = 'default';

// default 씬 확보 — 없으면 씬 추가 버튼과 동일한 최소 스펙으로 생성
function ensureDefaultScene(session: Session): Scene {
  let scene = session.scenes.get(DEFAULT_SCENE);
  if (!scene) {
    session.addScene(
      Scene.fromJSON({
        type: 'scene',
        name: DEFAULT_SCENE,
        resolution: 'portrait',
        slots: [
          [{ id: v4(), prompt: '', characterPrompts: [], enabled: true }],
        ],
        mains: [],
        imageMap: [],
        meta: {},
        round: undefined,
        game: undefined,
      }),
    );
    sessionService.markDirty(session.name);
    scene = session.scenes.get(DEFAULT_SCENE)!;
  }
  return scene;
}

const QuickModeTab = observer(() => {
  const curSession = appState.curSession!;
  const [latestPath, setLatestPath] = useState<string | undefined>(undefined);
  const [image, setImage] = useState<string | undefined>(undefined);
  const [running, setRunning] = useState(taskQueueService.isRunning());
  const [sceneStats, setSceneStats] = useState({ done: 0, total: 0 });
  const [autoOn, setAutoOn] = useState(false);
  const autoRef = useRef(false);
  // 직전 자동 사이클에서 실제로 생성이 성공했는지 추적.
  // 지속 실패(토큰 만료·Anlas 소진 등) 시 실패→재예약→실패의 무한 루프(오류 요청 폭주)를 막는다.
  const producedRef = useRef(false);

  // ── 최신 이미지 경로 유지 (default 씬의 가장 최근 생성작) ──
  const refreshLatest = useCallback(() => {
    const scene = curSession.scenes.get(DEFAULT_SCENE);
    if (!scene) {
      setLatestPath(undefined);
      return;
    }
    const outputs = gameService.getOutputs(curSession, scene);
    setLatestPath(
      outputs.length
        ? imageService.getOutputDir(curSession, scene) + '/' + outputs[0]
        : undefined,
    );
  }, [curSession]);

  useEffect(() => {
    (async () => {
      const scene = curSession.scenes.get(DEFAULT_SCENE);
      if (scene) await imageService.refresh(curSession, scene);
      refreshLatest();
    })();
    const onAdded = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (
        d?.session?.name === curSession.name &&
        d.sceneType === 'scene' &&
        d.sceneName === DEFAULT_SCENE
      ) {
        setLatestPath(d.path);
      }
    };
    const onUpdated = () => refreshLatest();
    imageService.addEventListener('image-added', onAdded);
    imageService.addEventListener('updated', onUpdated);
    return () => {
      imageService.removeEventListener('image-added', onAdded);
      imageService.removeEventListener('updated', onUpdated);
    };
  }, [curSession, refreshLatest]);

  // 고해상 이미지 로드 (중앙 대형 표시용)
  useEffect(() => {
    let canceled = false;
    if (!latestPath) {
      setImage(undefined);
      return;
    }
    imageService
      .fetchImage(latestPath)
      .then((b64) => {
        if (!canceled) setImage(b64 ?? undefined);
      })
      .catch(() => {});
    return () => {
      canceled = true;
    };
  }, [latestPath]);

  // ── 큐 상태 구독 (이벤트 기반 — TaskProgressBar 패턴) ──
  useEffect(() => {
    const update = () => {
      setRunning(taskQueueService.isRunning());
      const scene = curSession.scenes.get(DEFAULT_SCENE);
      setSceneStats(
        scene
          ? taskQueueService.statsTasksFromScene(curSession, scene)
          : { done: 0, total: 0 },
      );
    };
    update();
    const events = ['start', 'stop', 'progress', 'complete', 'error'];
    for (const ev of events) taskQueueService.addEventListener(ev, update);
    return () => {
      for (const ev of events) taskQueueService.removeEventListener(ev, update);
    };
  }, [curSession]);

  // ── 자동 모드: 큐 자연 완료 시 다음 1장 재예약 (CyclingSessionService 패턴) ──
  useEffect(() => {
    const onComplete = () => {
      producedRef.current = true;
    };
    const onStop = () => {
      if (!autoRef.current) return;
      if (!taskQueueService.isEmpty()) return; // 수동 정지 등은 재예약하지 않음
      // 큐가 비었는데 성공한 생성이 하나도 없다 = 태스크가 재시도 초과로 전부
      // 건너뛰어진 것("완료"가 아니라 "실패"). 재예약하면 무한 루프가 되므로 중지.
      if (!producedRef.current) {
        autoRef.current = false;
        setAutoOn(false);
        appState.pushMessage('생성이 계속 실패하여 자동 생성을 중지했습니다');
        return;
      }
      producedRef.current = false; // 다음 사이클 판정을 위해 리셋
      (async () => {
        try {
          const scene = ensureDefaultScene(curSession);
          await queueScene(curSession, scene, 1);
          taskQueueService.run();
        } catch (e: any) {
          autoRef.current = false;
          setAutoOn(false);
          appState.pushMessage(`자동 생성 중단: ${e.message}`);
        }
      })();
    };
    taskQueueService.addEventListener('complete', onComplete);
    taskQueueService.addEventListener('stop', onStop);
    return () => {
      taskQueueService.removeEventListener('complete', onComplete);
      taskQueueService.removeEventListener('stop', onStop);
      autoRef.current = false;
    };
  }, [curSession]);

  // ── 생성 시작/취소 ──
  const guardCycling = () => {
    if (cyclingSessionService.state === 'running') {
      appState.pushMessage('사이클링 생성이 진행 중입니다. 완료 후 사용해주세요');
      return false;
    }
    return true;
  };

  const startOnce = async () => {
    if (!guardCycling()) return;
    try {
      const scene = ensureDefaultScene(curSession);
      await queueScene(curSession, scene, 1);
      taskQueueService.run();
    } catch (e: any) {
      appState.pushMessage(`프롬프트 에러: ${e.message}`);
    }
  };

  const startAuto = async () => {
    if (!guardCycling()) return;
    autoRef.current = true;
    producedRef.current = false; // 첫 사이클부터 성공 여부 판정
    setAutoOn(true);
    await startOnce();
  };

  const cancelAll = () => {
    // 순서 중요: 자동 플래그를 먼저 꺼야 stop 이벤트에서 재예약되지 않음
    autoRef.current = false;
    setAutoOn(false);
    const scene = curSession.scenes.get(DEFAULT_SCENE);
    if (scene) taskQueueService.removeTasksFromScene(scene);
    taskQueueService.stop();
  };

  // ── 버튼 상태/롱프레스 판정 ──
  // "퀵 모드 작업 진행 중" = 자동 모드이거나, 큐 실행 중이면서 default 씬 태스크가 남아있을 때
  // (다른 탭에서 예약한 다른 씬 작업과는 간섭하지 않도록 구분)
  const busy = autoOn || (running && sceneStats.done < sceneStats.total);

  const press = useRef<{
    timer: ReturnType<typeof setTimeout> | null;
    long: boolean;
  }>({ timer: null, long: false });

  const onPointerDown = () => {
    press.current.long = false;
    if (busy) return; // 진행 중엔 롱프레스 없음 — 클릭(취소)만
    press.current.timer = setTimeout(() => {
      press.current.timer = null;
      press.current.long = true;
      startAuto();
    }, 500);
  };
  const cancelPress = () => {
    if (press.current.timer) {
      clearTimeout(press.current.timer);
      press.current.timer = null;
    }
  };
  const onClick = () => {
    if (press.current.long) {
      // 롱프레스로 이미 처리됨 — 뒤따르는 합성 클릭 무시
      press.current.long = false;
      return;
    }
    if (busy) cancelAll();
    else startOnce();
  };

  // 이미지 우클릭/롱프레스 → 히스토리 이미지 메뉴 재사용
  // (씬으로 이동·그리드 보기·즐겨찾기·다운로드·삭제 — AppContextMenu.HistoryImage)
  // 클릭(탭)은 의도적으로 무동작: 오터치로 그리드에 끌려가는 문제 방지.
  const { show: showImageMenu } = useContextMenu({
    id: ContextMenuType.HistoryImage,
  });
  const onImageContext = (e: React.MouseEvent) => {
    if (!latestPath) return;
    e.preventDefault();
    const entry = {
      id: latestPath,
      sessionName: curSession.name,
      sceneType: 'scene' as const,
      sceneName: DEFAULT_SCENE,
      filename: latestPath.split('/').pop()!,
      path: latestPath,
      createdAt: 0,
    };
    showImageMenu({
      event: e,
      props: { ctx: { type: 'history_image', entry } },
    });
  };

  const progressText =
    sceneStats.total > 0 ? `${sceneStats.done}/${sceneStats.total}` : '';

  return (
    <div className="h-full w-full flex flex-col">
      {/* 중앙 대형 이미지 — 클릭 무동작, 우클릭/롱프레스로 메뉴 */}
      <div
        className="flex-1 min-h-0 relative flex items-center justify-center p-2"
        onContextMenu={onImageContext}
      >
        {image ? (
          <img
            src={image}
            draggable={false}
            className="max-w-full max-h-full object-contain rounded select-none"
          />
        ) : (
          <div className="text-faint text-sm text-center px-6">
            아직 생성된 이미지가 없습니다
            <br />
            프롬프트를 입력하고 아래 버튼으로 바로 생성해보세요
          </div>
        )}
        {busy && (
          <div
            className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full border line-color"
            style={{ backgroundColor: 'var(--c-surface-2)' }}
          >
            <span className="text-body text-xs">
              {autoOn ? '자동 생성 중' : '생성 중'}
              {progressText ? ` ${progressText}` : ''}…
            </span>
          </div>
        )}
      </div>
      {/* 생성 버튼 (퀵 모드 전용 동작) */}
      <div className="flex-none flex justify-center px-3 pb-3 pt-1">
        <button
          className={
            'round-button font-semibold text-base px-10 !py-2.5 w-full max-w-md select-none ' +
            (autoOn ? 'back-red' : busy ? 'back-gray' : 'back-sky')
          }
          onPointerDown={onPointerDown}
          onPointerUp={cancelPress}
          onPointerLeave={cancelPress}
          onPointerCancel={cancelPress}
          onClick={onClick}
          onContextMenu={(e) => e.preventDefault()}
        >
          {autoOn
            ? '자동 생성 중 — 탭하여 중지'
            : busy
              ? `생성 중${progressText ? ' ' + progressText : ''} — 탭하여 취소`
              : '생성 (길게 눌러 자동)'}
        </button>
      </div>
    </div>
  );
});

export default QuickModeTab;
