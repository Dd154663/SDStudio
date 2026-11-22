import { EmptyState } from './EmptyState';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { createPortal } from 'react-dom';
import { useV2Slot } from './useV2Slot';
import { isV2, V2_QUICK_BAR_SLOT_ID } from '../models/mobileV2';
import { useContextMenu } from 'react-contexify';
import { v4 } from 'uuid';
import {
  cyclingSessionService,
  gameService,
  imageService,
  sessionService,
  taskQueueService,
  templateService,
} from '../models';
import { appState } from '../models/AppService';
import { queueQuickScene } from '../models/sceneQueueActions';
import { ContextMenuType, Scene, Session } from '../models/types';
import { ResolutionPicker } from './ResolutionPicker';
import {
  getQuickGenCount,
  SAMPLE_COUNT_MAX,
  SAMPLE_COUNT_MIN,
  setQuickGenCount,
} from '../models/sampleCount';
import { FaChevronLeft, FaChevronRight } from 'react-icons/fa';
import {
  currentQuickView,
  QUICK_VIEW_FOLLOW_LATEST,
  QuickViewState,
  reconcileQuickView,
  stepQuickNewer,
  stepQuickOlder,
} from '../models/quickResultBrowse';
// PC: 큰 이미지를 끌어서 다른 프로그램에 파일로 놓기(공용 헬퍼 — 모바일은 빈 객체)
import { imageDragOutProps } from '../models/imageDragOut';

// 퀵 모드 탭 — NAI 공식 웹풍의 즉시 생성 화면.
// 중앙에 최신 생성 이미지를 크게 표시하고, 생성 버튼 하나로
// 클릭=즉시 N장 / 롱프레스=N장씩 자동(반복) / 생성 중 재클릭=취소 동작을 제공한다.
// N = 버튼 옆 장수 입력(퀵 생성 전용 — 일반 생성 개수(appState 의 samples)와 별개, 2026-11-22). 값은 해상도와 같이
// 퀵 생성 전용 프로젝트의 default 씬에 저장된다(models/sampleCount — 없으면 1).
// 프롬프트/파라미터는 기존 좌측 패널(모바일: 프롬프트 열기)을 그대로 사용.
//
// 개편(2026-07-18 합의): 씬/결과물은 현재 프로젝트의 default 씬이 아니라
// **퀵 생성 전용 숨김 프로젝트**(templateService.ensureQuickGenProject)의
// default 씬을 쓴다 — 어느 프로젝트에서 접근해도 결과물이 한 폴더에 쌓인다.
// 프롬프트/프리셋 해석만 현재 프로젝트 기준(queueQuickScene 이 분리 처리).
//
// 최근 결과 넘겨 보기(2026-11-22): 큰 이미지 양옆에 이전(오른쪽)·더 최신(왼쪽) 이미지가 카드 더미처럼 비치고,
// 더미(+ 화살표)를 누르면 한 장씩 넘긴다. 어느 이미지를 보여 줄지는 models/quickResultBrowse 규칙만 쓴다
// (최신 따라가기 / 넘기면 경로로 기억 / 삭제되면 이웃). 키보드 단축키·스와이프·전환 움직임은 일부러 없다.

const DEFAULT_SCENE = 'default';

// 더미 모양(좁은 화면 / md 이상). 카드는 큰 이미지 뒤에서 바깥으로 STEP 씩 비어져 나오고 뒤로 갈수록 작고 어둡다.
// 칸 폭 = 큰 이미지 바깥에 비워 두는 여백(누르는 영역) — 좁은 화면은 카드 1장만 비치게 해서 큰 이미지를 우선한다.
const STACK_SIDE_PX = { narrow: 28, wide: 88 };
const STACK_STEP_PX = { narrow: 12, wide: 16 };
const STACK_CARD_SCALE = [0.86, 0.74, 0.62]; // 가까운 것부터 큰 이미지 높이 대비
const STACK_CARD_BRIGHTNESS = [0.8, 0.65, 0.5];
const STACK_THUMB_SIZE = 400;
// 가운데 영역 폭이 이보다 좁으면 좁은 모양(모바일·PC 에서 양옆 패널로 좁아진 경우 모두)
const NARROW_AREA_PX = 560;

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

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

const QuickModeTab = observer(({ isActive = true }: { isActive?: boolean }) => {
  // 모바일 V2: 이 탭이 활성인 동안 하단 바 자리를 [생성][해상도] 두 개로 쓴다(큐용 하단 바는 숨김).
  // 생성은 어느 탭에서나 화면 맨 아래 — 탭 본문 바닥에 두면 접힌 프롬프트 시트에 가려진다.
  const v2Bar = isV2('main') && isActive;
  const v2BarSlot = useV2Slot(V2_QUICK_BAR_SLOT_ID, v2Bar);
  useEffect(() => {
    if (!v2Bar) return undefined;
    appState.mobileV2QuickBar = true;
    return () => {
      appState.mobileV2QuickBar = false;
    };
  }, [v2Bar]);
  const curSession = appState.curSession!;
  // 퀵 생성 전용 프로젝트 — 마운트 시 확보(없으면 자동 생성). 로드 전엔 null.
  const [quickSession, setQuickSession] = useState<Session | null>(null);
  // 결과 경로 목록(앞이 최신)과 보는 위치(최신 따라가기 / 경로로 기억 — models/quickResultBrowse)
  const [paths, setPaths] = useState<string[]>([]);
  const [viewState, setViewState] = useState<QuickViewState>(QUICK_VIEW_FOLLOW_LATEST);
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

  // ── 결과 목록 유지 (전용 프로젝트 default 씬, 앞이 최신) ──
  // 목록이 바뀔 때마다 보는 위치를 맞춘다: 따라가기면 새 최신, 넘겨 보는 중이면 같은 경로 유지, 지워졌으면 이웃.
  const refreshLatest = useCallback(() => {
    if (!quickSession) return;
    const scene = quickSession.scenes.get(DEFAULT_SCENE);
    let next: string[] = [];
    if (scene) {
      const dir = imageService.getOutputDir(quickSession, scene);
      next = gameService.getOutputs(quickSession, scene).map((f) => dir + '/' + f);
    }
    setPaths(next);
    setViewState((s) => reconcileQuickView(next, s));
  }, [quickSession]);

  // 탭을 떠나거나 프로젝트를 바꾸면 최신으로 돌아간다(보던 위치는 저장하지 않음)
  useEffect(() => {
    setViewState(QUICK_VIEW_FOLLOW_LATEST);
  }, [isActive, curSession?.name]);

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
        // 목록에서 다시 읽는다(바로 뒤 'updated' 와 중복이지만 무해). 넘겨 보는 중이면 보던 이미지는 그대로.
        refreshLatest();
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

  // 지금 보여 줄 것(큰 이미지·양옆 더미·위치 표시) — 규칙은 models/quickResultBrowse
  const view = currentQuickView(paths, viewState);
  const shownPath = view.path;
  const goOlder = () => setViewState((s) => stepQuickOlder(paths, s));
  const goNewer = () => setViewState((s) => stepQuickNewer(paths, s));

  // 고해상 이미지 로드 (중앙 대형 표시용)
  useEffect(() => {
    let canceled = false;
    if (!shownPath) {
      setImage(undefined);
      return;
    }
    imageService
      .fetchImage(shownPath)
      .then((b64) => {
        if (!canceled) setImage(b64 ?? undefined);
      })
      .catch(() => {});
    return () => {
      canceled = true;
    };
  }, [shownPath]);

  // 더미 카드 썸네일(기존 작은 이미지 경로). 지금 비치는 카드만 남기고, 이미 받은 것은 다시 받지 않는다.
  const stackPaths = [...view.newer, ...view.older];
  const stackKey = stackPaths.join('\n');
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  useEffect(() => {
    let canceled = false;
    const want = stackKey ? stackKey.split('\n') : [];
    setThumbs((prev) => {
      const kept: Record<string, string> = {};
      for (const p of want) if (prev[p]) kept[p] = prev[p];
      return kept;
    });
    for (const p of want) {
      imageService
        .fetchImageSmall(p, STACK_THUMB_SIZE)
        .then((b64) => {
          if (canceled || !b64) return;
          setThumbs((prev) => (prev[p] === b64 ? prev : { ...prev, [p]: b64 }));
        })
        .catch(() => {});
    }
    return () => {
      canceled = true;
    };
  }, [stackKey]);

  // 큰 이미지의 실제 자리(더미를 그 가장자리에 붙이기 위해) + 가운데 영역 폭(좁은 모양 판정).
  // 큰 이미지 표시 방식(max-w/max-h·object-contain)은 종전 그대로 두고 자리만 잰다.
  const areaRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [imgBox, setImgBox] = useState<Box | null>(null);
  const [areaWidth, setAreaWidth] = useState(0);
  const measure = useCallback(() => {
    const area = areaRef.current;
    const img = imgRef.current;
    if (area) setAreaWidth((w) => (w === area.clientWidth ? w : area.clientWidth));
    if (!img || !img.offsetWidth) {
      setImgBox((b) => (b ? null : b));
      return;
    }
    const next = {
      left: img.offsetLeft,
      top: img.offsetTop,
      width: img.offsetWidth,
      height: img.offsetHeight,
    };
    setImgBox((b) =>
      b &&
      b.left === next.left &&
      b.top === next.top &&
      b.width === next.width &&
      b.height === next.height
        ? b
        : next,
    );
  }, []);
  const hasBrowse = paths.length > 1;
  useEffect(() => {
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => measure());
    if (areaRef.current) ro.observe(areaRef.current);
    if (imgRef.current) ro.observe(imgRef.current);
    return () => ro.disconnect();
  }, [measure, image, hasBrowse]);

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
          await queueQuickScene(curSession, quickSession, scene, getQuickGenCount(scene));
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
      await queueQuickScene(curSession, quickSession!, scene, getQuickGenCount(scene));
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
  // 메뉴는 지금 크게 보이는 이미지 기준(넘겨 보는 중이면 그 이미지)
  const onImageContext = (e: React.MouseEvent) => {
    if (!shownPath || !quickSession) return;
    e.preventDefault();
    const entry = {
      id: shownPath,
      sessionName: quickSession.name,
      sceneType: 'scene' as const,
      sceneName: DEFAULT_SCENE,
      filename: shownPath.split('/').pop()!,
      path: shownPath,
      createdAt: 0,
    };
    showImageMenu({
      event: e,
      props: { ctx: { type: 'history_image', entry } },
    });
  };

  const progressText =
    sceneStats.total > 0 ? `${sceneStats.done}/${sceneStats.total}` : '';

  // ── 양옆 더미(오른쪽 = 더 이전, 왼쪽 = 더 최신 — 좌우 대칭) ──
  // 칸 하나가 통째로 버튼(큰 이미지 높이 × 칸 폭 — 터치 영역 충분). 카드는 큰 이미지 뒤(z 아래)에서
  // 가장자리 바깥으로 STEP 씩 비어져 나오고, 화살표는 더미 바깥 끝. 더 넘길 것이 없는 쪽은 그리지 않는다.
  const narrow = areaWidth > 0 && areaWidth < NARROW_AREA_PX;
  const sideW = narrow ? STACK_SIDE_PX.narrow : STACK_SIDE_PX.wide;
  const step = narrow ? STACK_STEP_PX.narrow : STACK_STEP_PX.wide;
  const arrowSize = narrow ? 24 : 28;
  const renderStack = (side: 'left' | 'right') => {
    const items = side === 'right' ? view.older : view.newer;
    if (!items.length || !imgBox || !image) return null;
    const cards = items.slice(0, narrow ? 1 : STACK_CARD_SCALE.length);
    const cardW = Math.max(step * 4, Math.min(imgBox.width * 0.5, 160));
    const arrowAt = Math.min(step * cards.length + 6, sideW - arrowSize - 2);
    const label = side === 'right' ? '이전 이미지 보기' : '더 최신 이미지 보기';
    return (
      <button
        type="button"
        aria-label={label}
        title={label}
        data-quick-stack={side}
        className="absolute z-0 select-none rounded focus:outline-none focus-visible:ring-2 focus:ring-[color:var(--c-focus-ring)]"
        style={{
          left: side === 'right' ? imgBox.left + imgBox.width : imgBox.left - sideW,
          top: imgBox.top,
          width: sideW,
          height: imgBox.height,
        }}
        onClick={side === 'right' ? goOlder : goNewer}
        onContextMenu={(e) => {
          // 더미 위 우클릭·롱프레스는 메뉴 없음(메뉴는 큰 이미지 기준)
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        {cards.map((p, k) => {
          const h = imgBox.height * STACK_CARD_SCALE[k];
          const out = step * (k + 1); // 큰 이미지 가장자리 바깥으로 비어져 나온 폭
          return (
            <span
              key={p}
              className="absolute block overflow-hidden rounded border line-color pointer-events-none"
              style={{
                top: (imgBox.height - h) / 2,
                height: h,
                width: cardW,
                [side === 'right' ? 'left' : 'right']: out - cardW,
                zIndex: STACK_CARD_SCALE.length - k,
                backgroundColor: 'var(--c-surface-2)',
                filter: `brightness(${STACK_CARD_BRIGHTNESS[k]})`,
              }}
            >
              {thumbs[p] && (
                <img
                  src={thumbs[p]}
                  alt=""
                  draggable={false}
                  className="w-full h-full object-cover select-none"
                />
              )}
            </span>
          );
        })}
        <span
          className="absolute card-overlay-btn rounded-full shadow-lg flex items-center justify-center"
          style={{
            top: (imgBox.height - arrowSize) / 2,
            [side === 'right' ? 'left' : 'right']: arrowAt,
            width: arrowSize,
            height: arrowSize,
            zIndex: STACK_CARD_SCALE.length + 1,
          }}
        >
          {side === 'right' ? <FaChevronRight size={narrow ? 11 : 13} /> : <FaChevronLeft size={narrow ? 11 : 13} />}
        </span>
      </button>
    );
  };

  // ── 해상도 컨트롤 (2026-07-18 피드백) ──
  // 하단에 퀵 씬의 해상도를 노출한다. 피커 UI(프리셋/직접 입력/Anlas confirm/
  // 64px 보정)는 공용 ResolutionPicker 로 추출됨 — 프리셋 패널과 공유.
  const quickScene = quickSession?.scenes.get(DEFAULT_SCENE);

  // 씬 확보 후 변경 적용 + 저장 (해상도·장수 — 퀵 씬은 curSession 밖이라 markDirty 명시 필요)
  const applyQuickScene = (fn: (scene: Scene) => void) => {
    if (!quickSession) return;
    const scene = ensureDefaultScene(quickSession);
    fn(scene);
    sessionService.markDirty(quickSession.name);
  };

  return (
    <div className="h-full w-full flex flex-col">
      {/* 중앙 대형 이미지 — 클릭 무동작, 우클릭/롱프레스로 메뉴. 넘길 것이 있으면 양옆에 더미 칸 폭만큼 여백. */}
      <div
        ref={areaRef}
        className="flex-1 min-h-0 relative flex items-center justify-center p-2"
        style={hasBrowse && image ? { paddingLeft: sideW, paddingRight: sideW } : undefined}
        onContextMenu={onImageContext}
      >
        {image ? (
          <img
            ref={imgRef}
            data-quick-main-image=""
            src={image}
            onLoad={measure}
            draggable={false}
            {...imageDragOutProps(shownPath)}
            className="relative z-[1] max-w-full max-h-full object-contain rounded select-none"
          />
        ) : (
          <EmptyState size="lg" className="px-6" hint="프롬프트를 입력하고 아래 버튼으로 바로 생성해보세요">
            아직 생성된 이미지가 없습니다
          </EmptyState>
        )}
        {renderStack('left')}
        {renderStack('right')}
        {/* 몇 번째를 보는지(최신이면 없음) — 큰 이미지 위쪽 가운데 */}
        {image && imgBox && view.label && (
          <div
            data-quick-view-position=""
            className="absolute z-[2] -translate-x-1/2 px-2 py-0.5 rounded-full border line-color pointer-events-none"
            style={{
              top: imgBox.top + 8,
              left: imgBox.left + imgBox.width / 2,
              backgroundColor: 'var(--c-surface-2)',
            }}
          >
            <span className="text-body text-xs tabular-nums">{view.label}</span>
          </div>
        )}
        {busy && (
          <div
            className="absolute z-[2] bottom-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full border line-color"
            style={{ backgroundColor: 'var(--c-surface-2)' }}
          >
            <span className="text-body text-xs">
              {autoOn ? '자동 생성 중' : '생성 중'}
              {progressText ? ` ${progressText}` : ''}…
            </span>
          </div>
        )}
      </div>
      {/* 생성 버튼 + 해상도 컨트롤 (퀵 모드 전용 동작). 모바일 V2 에서는 같은 내용을 하단 바 자리로 포털한다. */}
      {(() => {
        const controls = (
          <>
        <button
          className={
            (v2Bar
              ? 'round-button font-bold text-[15px] flex-1 min-w-0 !h-10 !rounded-xl px-3 select-none whitespace-nowrap '
              : 'round-button font-semibold text-base px-10 py-2.5 w-full max-w-md select-none ') +
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
        {/* 장수 — 일반 생성 개수 입력과 같은 칸·같은 판정(models/sampleCount), 값은 퀵 생성 전용 */}
        <div className="flex-none flex items-center whitespace-nowrap">
          <span className="sr-only md:not-sr-only whitespace-nowrap text-default md:text-sm">장수:</span>
          <input
            aria-label="퀵 생성 장수"
            data-quick-gen-count=""
            min={SAMPLE_COUNT_MIN}
            max={SAMPLE_COUNT_MAX}
            className={'ml-1 md:ml-2 p-1 w-10 md:w-16 md:h-8 text-center gray-input'}
            type="number"
            disabled={!quickSession}
            value={getQuickGenCount(quickScene)}
            onChange={(e: any) => {
              const raw = e.currentTarget.value;
              applyQuickScene((scene) => setQuickGenCount(scene, raw));
            }}
          />
        </div>
        {/* 해상도 표시 + 드롭다운 (공용 ResolutionPicker — 위로 열리는 패널) */}
        <ResolutionPicker
          className="flex-none"
          triggerClassName="h-full"
          disabled={!quickSession}
          value={
            quickScene
              ? {
                  resolution: quickScene.resolution,
                  width: quickScene.resolutionWidth,
                  height: quickScene.resolutionHeight,
                }
              : undefined
          }
          onApply={(v) =>
            applyQuickScene((scene) => {
              scene.resolution = v.resolution;
              if (v.resolution === 'custom') {
                scene.resolutionWidth = v.width;
                scene.resolutionHeight = v.height;
              }
            })
          }
        />
          </>
        );
        if (v2Bar) return v2BarSlot ? createPortal(controls, v2BarSlot) : null;
        return (
          <div className="flex-none flex justify-center items-stretch gap-2 px-3 pb-3 pt-1">
            {controls}
          </div>
        );
      })()}
    </div>
  );
});

export default QuickModeTab;
