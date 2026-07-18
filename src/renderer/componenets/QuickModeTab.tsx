import React, { useCallback, useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useContextMenu } from 'react-contexify';
import { FaChevronDown } from 'react-icons/fa';
import { v4 } from 'uuid';
import {
  cyclingSessionService,
  gameService,
  imageService,
  sessionService,
  taskQueueService,
  templateService,
} from '../models';
import { Resolution, resolutionMap } from '../backends/imageGen';
import { appState } from '../models/AppService';
import { queueQuickScene } from '../models/sceneQueueActions';
import { ContextMenuType, Scene, Session } from '../models/types';

// 퀵 모드 탭 — NAI 공식 웹풍의 즉시 생성 화면.
// 중앙에 최신 생성 이미지를 크게 표시하고, 생성 버튼 하나로
// 클릭=즉시 1장 / 롱프레스=자동(반복) / 생성 중 재클릭=취소 동작을 제공한다.
// 프롬프트/파라미터는 기존 좌측 패널(모바일: 프롬프트 열기)을 그대로 사용.
//
// 개편(2026-07-18 합의): 씬/결과물은 현재 프로젝트의 default 씬이 아니라
// **퀵 생성 전용 숨김 프로젝트**(templateService.ensureQuickGenProject)의
// default 씬을 쓴다 — 어느 프로젝트에서 접근해도 결과물이 한 폴더에 쌓인다.
// 프롬프트/프리셋 해석만 현재 프로젝트 기준(queueQuickScene 이 분리 처리).

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
  // 퀵 생성 전용 프로젝트 — 마운트 시 확보(없으면 자동 생성). 로드 전엔 null.
  const [quickSession, setQuickSession] = useState<Session | null>(null);
  const [latestPath, setLatestPath] = useState<string | undefined>(undefined);
  const [image, setImage] = useState<string | undefined>(undefined);
  const [running, setRunning] = useState(taskQueueService.isRunning());
  const [sceneStats, setSceneStats] = useState({ done: 0, total: 0 });
  const [autoOn, setAutoOn] = useState(false);
  const autoRef = useRef(false);
  // 직전 자동 사이클에서 실제로 생성이 성공했는지 추적.
  // 지속 실패(토큰 만료·Anlas 소진 등) 시 실패→재예약→실패의 무한 루프(오류 요청 폭주)를 막는다.
  const producedRef = useRef(false);

  useEffect(() => {
    let canceled = false;
    templateService.ensureQuickGenProject().then((s) => {
      if (!canceled) setQuickSession(s);
    });
    return () => {
      canceled = true;
    };
  }, []);

  // ── 최신 이미지 경로 유지 (전용 프로젝트 default 씬의 가장 최근 생성작) ──
  const refreshLatest = useCallback(() => {
    if (!quickSession) return;
    const scene = quickSession.scenes.get(DEFAULT_SCENE);
    if (!scene) {
      setLatestPath(undefined);
      return;
    }
    const outputs = gameService.getOutputs(quickSession, scene);
    setLatestPath(
      outputs.length
        ? imageService.getOutputDir(quickSession, scene) + '/' + outputs[0]
        : undefined,
    );
  }, [quickSession]);

  useEffect(() => {
    if (!quickSession) return;
    (async () => {
      const scene = quickSession.scenes.get(DEFAULT_SCENE);
      if (scene) await imageService.refresh(quickSession, scene);
      refreshLatest();
    })();
    const onAdded = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (
        d?.session?.name === quickSession.name &&
        d.sceneType === 'scene' &&
        d.sceneName === DEFAULT_SCENE
      ) {
        setLatestPath(d.path);
      }
    };
    const onUpdated = () => refreshLatest();
    // 보조 창 대비: image-added 는 생성 호스트 창의 imageService 에서만 발화하므로,
    // 위임 완료 브리지의 'complete' 이벤트에서 폴더를 재스캔해 최신작을 반영한다.
    // (단일 창에서는 image-added 와 중복이지만 무해 — 파일 목록 1회 조회)
    const onComplete = async () => {
      const scene = quickSession.scenes.get(DEFAULT_SCENE);
      if (!scene) return;
      await imageService.refresh(quickSession, scene);
      refreshLatest();
    };
    imageService.addEventListener('image-added', onAdded);
    imageService.addEventListener('updated', onUpdated);
    taskQueueService.addEventListener('complete', onComplete);
    return () => {
      imageService.removeEventListener('image-added', onAdded);
      imageService.removeEventListener('updated', onUpdated);
      taskQueueService.removeEventListener('complete', onComplete);
    };
  }, [quickSession, refreshLatest]);

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
      const scene = quickSession?.scenes.get(DEFAULT_SCENE);
      setSceneStats(
        quickSession && scene
          ? taskQueueService.statsTasksFromScene(quickSession, scene)
          : { done: 0, total: 0 },
      );
    };
    update();
    const events = ['start', 'stop', 'progress', 'complete', 'error'];
    for (const ev of events) taskQueueService.addEventListener(ev, update);
    return () => {
      for (const ev of events) taskQueueService.removeEventListener(ev, update);
    };
  }, [quickSession]);

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
          if (!quickSession) throw new Error('퀵 생성 프로젝트가 없습니다');
          const scene = ensureDefaultScene(quickSession);
          await queueQuickScene(curSession, quickSession, scene, 1);
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
  }, [curSession, quickSession]);

  // ── 생성 시작/취소 ──
  const guardCycling = () => {
    if (cyclingSessionService.state === 'running') {
      appState.pushMessage('사이클링 생성이 진행 중입니다. 완료 후 사용해주세요');
      return false;
    }
    if (!quickSession) {
      appState.pushMessage('퀵 생성 프로젝트를 준비하지 못했습니다');
      return false;
    }
    return true;
  };

  const startOnce = async () => {
    if (!guardCycling()) return;
    try {
      const scene = ensureDefaultScene(quickSession!);
      await queueQuickScene(curSession, quickSession!, scene, 1);
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
    const scene = quickSession?.scenes.get(DEFAULT_SCENE);
    if (quickSession && scene)
      taskQueueService.removeTasksFromScene(scene, quickSession);
    taskQueueService.stop();
  };

  // ── 버튼 상태/롱프레스 판정 ──
  // "퀵 모드 작업 진행 중" = 자동 모드이거나, 큐 실행 중이면서 퀵 씬 태스크가 남아있을 때
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
    if (!latestPath || !quickSession) return;
    e.preventDefault();
    const entry = {
      id: latestPath,
      sessionName: quickSession.name,
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

  // ── 해상도 컨트롤 (2026-07-18 피드백) ──
  // 하단에 퀵 씬의 해상도를 노출하고, 드롭다운 버튼으로 위로 열리는 패널에서
  // 프리셋 선택/직접 입력(64px 배수 자동 보정)으로 변경한다.
  const [resOpen, setResOpen] = useState(false);
  const [wText, setWText] = useState('');
  const [hText, setHText] = useState('');
  const quickScene = quickSession?.scenes.get(DEFAULT_SCENE);
  // 표시용 현재 해상도 — 씬 생성 전에는 ensureDefaultScene 기본값(portrait) 표시
  const curRes = (() => {
    if (!quickScene) return resolutionMap.portrait;
    if (quickScene.resolution === 'custom')
      return {
        width: quickScene.resolutionWidth ?? 0,
        height: quickScene.resolutionHeight ?? 0,
      };
    return (
      resolutionMap[quickScene.resolution as Resolution] ??
      resolutionMap.portrait
    );
  })();

  // 씬 확보 후 변경 적용 + 저장 (퀵 씬은 curSession 밖이라 markDirty 명시 필요)
  const applyResolution = (fn: (scene: Scene) => void) => {
    if (!quickSession) return;
    const scene = ensureDefaultScene(quickSession);
    fn(scene);
    sessionService.markDirty(quickSession.name);
  };

  const openResPanel = () => {
    // 패널을 열 때 직접 입력칸을 현재 값으로 채운다
    setWText(String(curRes.width || ''));
    setHText(String(curRes.height || ''));
    setResOpen(true);
  };

  const selectPreset = (key: Resolution) => {
    setResOpen(false);
    const apply = () =>
      applyResolution((scene) => {
        scene.resolution = key;
      });
    // Anlas 소모 해상도는 씬 편집기와 동일하게 확인을 거친다
    if (key.startsWith('large') || key.startsWith('wallpaper')) {
      appState.pushDialog({
        type: 'confirm',
        text: '해당 해상도는 Anlas를 소모합니다 (유료임) 계속하시겠습니까?',
        callback: apply,
      });
    } else {
      apply();
    }
  };

  const applyCustom = () => {
    const w = parseInt(wText);
    const h = parseInt(hText);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
      appState.pushMessage('올바른 숫자를 입력해주세요');
      return;
    }
    // 64px 배수로 올림 보정 (씬 편집기 커스텀 해상도와 동일 규칙)
    const w64 = Math.max(64, (w + 63) & ~63);
    const h64 = Math.max(64, (h + 63) & ~63);
    setResOpen(false);
    applyResolution((scene) => {
      scene.resolution = 'custom' as Resolution;
      scene.resolutionWidth = w64;
      scene.resolutionHeight = h64;
    });
    if (w64 !== w || h64 !== h) {
      appState.pushMessage(`64px 배수로 보정되었습니다 — ${w64}x${h64}`);
    }
  };

  // 프리셋 목록: 씬 편집기와 동일하게 small 계열 제외, custom 은 입력칸이 대신한다
  const presetOptions = Object.entries(resolutionMap).filter(
    ([key]) => !key.startsWith('small') && key !== 'custom',
  ) as [Resolution, { width: number; height: number }][];

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
      {/* 생성 버튼 + 해상도 컨트롤 (퀵 모드 전용 동작) */}
      <div className="flex-none flex justify-center items-stretch gap-2 px-3 pb-3 pt-1">
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
        {/* 해상도 표시 + 드롭다운 (위로 열리는 패널) */}
        <div className="relative flex-none">
          <button
            className="h-full flex items-center gap-1.5 px-3 rounded-lg border line-color bg-[var(--c-input-bg)] text-body text-sm whitespace-nowrap select-none hover:brightness-95"
            disabled={!quickSession}
            onClick={() => (resOpen ? setResOpen(false) : openResPanel())}
          >
            {curRes.width}x{curRes.height}
            <FaChevronDown
              size={10}
              className={'text-faint transition-transform' + (resOpen ? ' rotate-180' : '')}
            />
          </button>
          {resOpen && (
            <>
              {/* 투명 백드롭 — 바깥 클릭 닫기 (퀵 메뉴 PC 팝오버 관례) */}
              <div
                className="fixed inset-0 z-[var(--z-widget)]"
                onClick={() => setResOpen(false)}
              />
              <div className="absolute bottom-full right-0 mb-2 z-[var(--z-widget)] w-56 rounded-lg border line-color bg-[var(--c-surface-2)] shadow-xl p-1.5">
                {presetOptions.map(([key, value]) => {
                  const active =
                    quickScene?.resolution === key ||
                    (!quickScene && key === 'portrait');
                  return (
                    <button
                      key={key}
                      className={
                        'btn-ghost w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-sm text-left ' +
                        (active ? 'font-semibold text-sky-500' : 'text-default')
                      }
                      onClick={() => selectPreset(key)}
                    >
                      <span>
                        {value.width}x{value.height}
                      </span>
                      {(key.startsWith('large') ||
                        key.startsWith('wallpaper')) && (
                        <span className="text-[10px] text-amber-500">Anlas</span>
                      )}
                    </button>
                  );
                })}
                {/* 직접 입력 (64px 배수 자동 보정) */}
                <div className="border-t line-color mt-1.5 pt-1.5 px-1 pb-0.5">
                  <div className="flex items-center gap-1.5">
                    <input
                      className="w-0 flex-1 px-2 py-1 rounded border line-color bg-[var(--c-input-bg)] text-default text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
                      inputMode="numeric"
                      placeholder="너비"
                      value={wText}
                      onChange={(e) => setWText(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && applyCustom()}
                    />
                    <span className="text-faint text-xs">x</span>
                    <input
                      className="w-0 flex-1 px-2 py-1 rounded border line-color bg-[var(--c-input-bg)] text-default text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
                      inputMode="numeric"
                      placeholder="높이"
                      value={hText}
                      onChange={(e) => setHText(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && applyCustom()}
                    />
                    <button
                      className="round-button back-sky text-sm !py-1 px-2.5 flex-none"
                      onClick={applyCustom}
                    >
                      적용
                    </button>
                  </div>
                  <div className="text-[10px] text-faint mt-1 px-0.5">
                    직접 입력 — 64px 배수로 자동 보정
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
});

export default QuickModeTab;
