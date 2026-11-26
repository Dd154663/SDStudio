// 씬 목록 「이미지 뷰 모드」(2026-11-26) — 씬 별로 / 가로 줄 / 최근 순. 규칙·상태는 models/sceneImageView.ts(순수).
// · 그리는 곳 = QueueControl(SceneQueueControl.tsx)의 메인 씬 목록 자리. 보기 방식이 cards 가 아니면 씬 카드 격자 대신 이것.
// · 씬 별로·최근 순 = 가상 격자(react-window FixedSizeGrid, 모든 칸 같은 크기) — 화면에 보이는 칸만 그린다.
// · 가로 줄 = 가상 세로 목록(FixedSizeList, 한 줄 = 씬 하나), 줄 안은 평범한 가로 스크롤(줄 안 칸은 가상화하지 않음).
//   첫 칸은 줄 왼쪽에 고정(sticky), 줄의 가로 스크롤 위치는 씬 이름별로 메모리에만 기억해 줄이 다시 그려질 때 되살린다.
//   모바일은 줄의 가로 막대를 숨기는 대신 가려진 칸이 있는 쪽에 옅은 화살표(공용 HScrollHint — 환경설정 탭 바와 같은 것).
// · 칸 그리기는 격자·줄 공용 부품(SceneImageCellView) 하나.
// · 이미지 칸 누름 = 그 씬의 이미지 그리드를 그 이미지 위치로(onOpenImage), 우클릭/길게 누르기 = 이미지 그리드의 이미지 메뉴(GallaryImage).
// · 씬 첫 칸의 이름 띠(빈 첫 칸은 칸 전체) 누름·우클릭 = 씬 메뉴(onSceneMenu). 더보기 칸 = 그 씬의 이미지 그리드(onOpenScene).
// · 숨은 탭(isActive 거짓)에서는 구독·격자를 쉰다(바깥 상자만 남겨 「보이는 탭」 판정 ref 를 유지).
// · 씬 첫 칸(PC)에 마우스를 올리면 씬 카드와 같은 네 버튼(예약 추가·예약 제거·씬 편집·씬 북마크)이 뜬다(2026-11-26).
// · 등장 움직임 없음(첫 칸의 네 버튼만 씬 카드와 같은 나타남). 색은 --c-* 토큰·기존 클래스만.
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { observer } from 'mobx-react-lite';
import { useContextMenu } from 'react-contexify';
import {
  FixedSizeGrid,
  FixedSizeList,
  GridChildComponentProps,
  GridOnItemsRenderedProps,
  ListChildComponentProps,
  ListOnItemsRenderedProps,
} from 'react-window';
import { gameService, imageService, isMobile, workFlowService } from '../models';
import { appState } from '../models/AppService';
import { imageDragOutProps } from '../models/imageDragOut';
import { effectiveSceneCardPercent } from '../models/sizeSlider';
import {
  createSceneImageLayoutMemo,
  sceneCellIndex,
  SceneImageCell,
  sceneImageGridMetrics,
  SceneImageRow,
  sceneImageRowMetrics,
  SceneImageSource,
  SceneImageViewMode,
  SCENE_IMAGE_CAPTION,
  SCENE_IMAGE_CELL_PAD,
  sceneContinuesRow,
  sceneRowIndex,
  SCENE_VIEW_CAP_MAX,
  SCENE_VIEW_CAP_MIN,
  SCENE_VIEW_MODES,
  SCENE_VIEW_ROW_CAP_MAX,
  SCENE_VIEW_ROW_CAP_MIN,
  SCENE_VIEW_TEXT,
  scenesInCellRange,
  scenesInRowRange,
  sceneViewModeOf,
  sceneViewState,
  SceneViewTab,
  setSceneViewCap,
  setSceneViewMode,
  setSceneViewRowCap,
  normalizeSceneViewMode,
  normalizeSceneViewCap,
  normalizeSceneViewRowCap,
  visibleCellRange,
} from '../models/sceneImageView';
import { ContextMenuType, GenericScene, Session } from '../models/types';
import { ActionIcon } from './ActionIcon';
import { EmptyState } from './EmptyState';
import { useElementSize, useProgressiveImage } from './historyHooks';
import { HScrollHintArrow, useHScrollHint } from './HScrollHint';
import Tooltip from './Tooltip';
import { UNDO_BAR_HEIGHT_PX } from './UndoBarSlot';

/** 격자가 0 크기로 재일 때(배치 전·테스트 환경) 쓰는 크기 */
const SCENE_IMAGE_VIEW_FALLBACK = { width: 800, height: 600 };
/** PC 세로 스크롤 막대 몫(칸이 가로로 넘치지 않게 폭에서 뺀다) */
const PC_SCROLLBAR_GUTTER = 12;
/** 가로 줄이 아닐 때의 빈 줄 목록(렌더마다 새 배열을 만들지 않게) */
const EMPTY_ROWS: readonly SceneImageRow[] = [];

export interface SceneImageViewHandle {
  /** 보이는 탭에 격자가 그려져 스크롤할 수 있는가 */
  isReady(): boolean;
  /** 그 씬의 칸으로 스크롤(씬 별로 = 첫 칸, 가로 줄 = 그 씬의 줄, 최근 순 = 가장 최근 이미지). 칸이 없으면 거짓 */
  scrollToScene(scene: string): boolean;
  /** 지금 화면에 칸이 하나라도 보이는 씬(목록 순서) — 가로 줄은 보이는 줄의 씬 */
  visibleSceneNames(): string[];
}

export interface SceneImageViewProps {
  type: SceneViewTab;
  mode: SceneImageViewMode;
  session: Session;
  /** 지금 목록(검색 반영 getFilteredScenes) — 칸 순서 */
  scenes: GenericScene[];
  isActive: boolean;
  /** 바깥 상자 ref — QueueControl 의 gridContainerRef(「보이는 탭」 판정 6곳이 이것을 본다) */
  containerRef: React.RefObject<HTMLDivElement>;
  /** 검색 중(빈 목록 문구) */
  searching: boolean;
  onOpenImage: (scene: GenericScene, filename: string) => void;
  onOpenScene: (scene: GenericScene) => void;
  onSceneMenu: (scene: GenericScene, e: React.MouseEvent) => void;
  /** 북마크된 씬 이름(없으면 undefined) — 첫 칸의 북마크 버튼·이름 띠 표시 */
  bookmarkedScene?: string;
  /** 씬 첫 칸의 호버 버튼 넷(PC) — 씬 카드의 네 버튼과 같은 동작 */
  onQueueAdd: (scene: GenericScene) => void;
  onQueueRemove: (scene: GenericScene) => void;
  onEditScene: (scene: GenericScene) => void;
  onToggleBookmark: (scene: GenericScene) => void;
}

/** 변형 씬의 입력 원본 이름(지금 변형 카드가 보여 주는 것 — 미러면 프로젝트 미러 이미지) */
export function sceneInputImageOf(session: Session, scene: GenericScene): string | undefined {
  if (scene.type !== 'inpaint') return undefined;
  return (
    scene.preset?.image ||
    (scene.workflowType === 'SDMirror' ? session.mirrorImage : undefined) ||
    undefined
  );
}

/** 칸 하나를 그리는 데 필요한 것 — 격자(GridData)·가로 줄(RowsData) 공용 */
interface CellData {
  thumb: number;
  imageHeight: number;
  caption: number;
  session: Session;
  scenesByName: Map<string, GenericScene>;
  onOpenImage: SceneImageViewProps['onOpenImage'];
  onOpenScene: SceneImageViewProps['onOpenScene'];
  onSceneMenu: SceneImageViewProps['onSceneMenu'];
  bookmarkedScene?: string;
  onQueueAdd: SceneImageViewProps['onQueueAdd'];
  onQueueRemove: SceneImageViewProps['onQueueRemove'];
  onEditScene: SceneImageViewProps['onEditScene'];
  onToggleBookmark: SceneImageViewProps['onToggleBookmark'];
}

interface GridData extends CellData {
  cells: readonly SceneImageCell[];
  columnCount: number;
  mode: SceneImageViewMode;
}

interface RowsData extends CellData {
  rows: readonly SceneImageRow[];
  cellWidth: number;
  cellHeight: number;
  /** 씬 이름 → 줄의 가로 스크롤 위치(메모리만 — 줄이 다시 그려질 때 되살림) */
  scrollMemo: Map<string, number>;
  /** 썸네일 무효화 회차 — 칸 key 에 넣어 다시 읽게 한다 */
  cacheRev: number;
}

/** 이름 띠 — 씬 카드와 같은 모양(아래 검정 그라데이션 + 흰 글자). 누름·우클릭 = 씬 메뉴 */
const SceneNameStrip = observer(
  ({
    scene,
    total,
    bookmarked,
    onSceneMenu,
  }: {
    scene: GenericScene;
    total: number;
    bookmarked?: boolean;
    onSceneMenu: CellData['onSceneMenu'];
  }) => {
    const emoji = scene.type === 'inpaint' ? (workFlowService.getDef(scene.workflowType)?.emoji ?? '') : '';
    return (
      <div
        role="button"
        aria-label={SCENE_VIEW_TEXT.sceneMenuAria(scene.name)}
        data-scene-name-strip=""
        className="absolute bottom-0 left-0 right-0 z-[5] bg-gradient-to-t from-black/70 to-transparent px-2 pt-4 pb-1.5 cursor-pointer"
        onClick={(e) => {
          e.stopPropagation();
          onSceneMenu(scene, e);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onSceneMenu(scene, e);
        }}
      >
        <div className="flex items-center text-sm text-white">
          <div className="truncate flex-1 font-medium drop-shadow">
            {bookmarked && (
              <ActionIcon
                id="bookmark"
                className="inline-block text-orange-500 mr-0.5 align-[-0.125em]"
                aria-label="북마크됨"
              />
            )}
            {emoji}
            {scene.name}
          </div>
          <div className="flex-none ml-1 text-white/80 drop-shadow">{total}</div>
        </div>
      </div>
    );
  },
);

/**
 * 씬 첫 칸의 호버 버튼 넷(PC 전용, 2026-11-26 사용자 요청) — 씬 카드의 이미지 위 네 버튼과 같은 순서·색·아이콘·동작.
 * 색은 씬 카드와 같게 둔다(「한 자리에 주 동작 하나만 색」·.card-overlay-btn 정돈 대상이 아님 — SceneQueueControl renderButtons 주석).
 * 줄 자체는 눌림을 받지 않는다(버튼 사이로 이름 띠가 눌리게). 버튼 위 우클릭 = 씬 메뉴.
 */
const HeadSceneButtons = ({ scene, bookmarked, data }: { scene: GenericScene; bookmarked: boolean; data: CellData }) => {
  const stop = (fn: (s: GenericScene) => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn(scene);
  };
  const btn = 'round-button scene-btn pointer-events-auto';
  const gray = 'bg-gray-500 text-white';
  const orange = 'bg-orange-500 text-white';
  return (
    <div
      data-scene-head-buttons=""
      className="absolute bottom-0 left-0 right-0 flex justify-center items-center gap-1.5 z-20 py-2 opacity-0 group-hover/scene-head:opacity-100 transition-opacity duration-200 pointer-events-none"
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        data.onSceneMenu(scene, e);
      }}
    >
      <Tooltip content="예약 추가">
        <button type="button" className={`${btn} bg-green-500 text-white`} onClick={stop(data.onQueueAdd)}>
          <ActionIcon id="queue-add" />
        </button>
      </Tooltip>
      <Tooltip content="예약 제거">
        <button type="button" className={`${btn} ${gray}`} onClick={stop(data.onQueueRemove)}>
          <ActionIcon id="queue-remove" />
        </button>
      </Tooltip>
      <Tooltip content="씬 편집">
        <button type="button" className={`${btn} ${orange}`} onClick={stop(data.onEditScene)}>
          <ActionIcon id="edit" />
        </button>
      </Tooltip>
      <Tooltip content="씬 북마크">
        <button
          type="button"
          className={`${btn} ${bookmarked ? orange + ' scene-btn-on' : gray}`}
          onClick={stop(data.onToggleBookmark)}
        >
          <ActionIcon id="bookmark" />
        </button>
      </Tooltip>
    </div>
  );
};

/** 앞줄에서 이어진 씬의 줄 첫 칸 — 씬 이름을 작게 다시 적는다(누를 수 없는 표시) */
const ContinuedTag = ({ name }: { name: string }) => (
  <div
    data-scene-group-continued=""
    className="absolute top-1 left-1 z-[5] max-w-[85%] truncate rounded px-1.5 text-[11px] leading-[18px] text-white/90 bg-black/55 pointer-events-none select-none"
  >
    {name}
  </div>
);

/** 썸네일 한 장(가상 칸 안). path 가 없으면 빈 자리 */
const CellPicture = ({ path, thumb, favorite }: { path?: string; thumb: number; favorite?: boolean }) => {
  const { src } = useProgressiveImage(path, false, { thumbSize: thumb });
  if (!path || !src) return null;
  return (
    <img
      src={src}
      draggable={false}
      {...imageDragOutProps(path)}
      data-scene-image-picture=""
      className={`w-full h-full object-cover rounded-md${favorite ? ' border-2 border-yellow-400' : ''}`}
    />
  );
};

/**
 * 칸 하나(첫 칸·이미지·더보기) — 격자(GridCell)와 가로 줄(SceneRow)이 함께 쓴다.
 * style = 바깥 상자 자리(격자 = react-window 위치, 줄 = 고정 폭), 여백은 여기서 붙인다.
 * continued = 「씬 별로」의 이어진 줄 표시(격자만 넘긴다), className = 바깥 상자 추가 클래스(가로 줄 첫 칸의 고정).
 */
const SceneImageCellView = observer(
  ({
    cell,
    style,
    data,
    continued,
    className,
  }: {
    cell: SceneImageCell;
    style: React.CSSProperties;
    data: CellData;
    continued?: React.ReactNode;
    className?: string;
  }) => {
  const { show } = useContextMenu({ id: ContextMenuType.GallaryImage });
  const scene = data.scenesByName.get(cell.scene);
  if (!scene) return null;
  const outer = { ...style, padding: SCENE_IMAGE_CELL_PAD };
  const outputDir = imageService.getOutputDir(data.session, scene);
  const imageMenu = (e: React.MouseEvent, path: string) => {
    e.preventDefault();
    show({
      event: e,
      props: { ctx: { type: 'gallary_image', path: [path], scene, starable: true } },
    });
  };
  const boxStyle: React.CSSProperties = { height: data.imageHeight };

  if (cell.kind === 'more') {
    return (
      <div style={outer} className={className} data-scene-image-cell="more">
        <div className="relative">
          {continued}
        <button
          type="button"
          aria-label={SCENE_VIEW_TEXT.moreAria(scene.name, cell.remaining)}
          className="w-full flex flex-col items-center justify-center gap-1 rounded-lg border line-color bg-[var(--c-surface-2)] shadow-md text-muted clickable"
          style={boxStyle}
          onClick={() => data.onOpenScene(scene)}
        >
          <span className="text-2xl leading-none">…</span>
          <span className="text-sm tabular-nums">{SCENE_VIEW_TEXT.more(cell.remaining)}</span>
        </button>
        </div>
      </div>
    );
  }

  if (cell.kind === 'head') {
    const isFav = !!cell.filename && scene.mains.includes(cell.filename);
    const picturePath = cell.filename
      ? `${outputDir}/${cell.filename}`
      : cell.input
        ? imageService.getVibeImagePath(data.session, cell.input)
        : undefined;
    const empty = !picturePath;
    const bookmarked = data.bookmarkedScene === scene.name;
    return (
      <div style={outer} className={className} data-scene-image-cell={empty ? 'head-empty' : 'head'}>
        <div
          // 첫 칸의 테두리는 늘 같은 색(즐겨찾기 노랑으로 바뀌면 씬의 시작 표시가 묻힌다) — 즐겨찾기는 그림 안쪽 테두리로
          className={`group/scene-head relative w-full overflow-hidden rounded-lg border-2 bg-[var(--c-surface-2)] border-[var(--c-sky-bg)]${
            empty ? ' cursor-pointer' : ''
          }`}
          style={boxStyle}
          data-scene-head={scene.name}
          onClick={(e) => {
            if (empty) data.onSceneMenu(scene, e);
            else if (cell.filename) data.onOpenImage(scene, cell.filename);
            else data.onOpenScene(scene);
          }}
          onContextMenu={(e) => {
            if (empty || !cell.filename) {
              e.preventDefault();
              data.onSceneMenu(scene, e);
            } else {
              imageMenu(e, `${outputDir}/${cell.filename}`);
            }
          }}
        >
          <div className={`w-full h-full${empty ? '' : ' cursor-pointer'}`}>
            <CellPicture path={picturePath} thumb={data.thumb} favorite={isFav} />
          </div>
          <SceneNameStrip scene={scene} total={cell.total} bookmarked={bookmarked} onSceneMenu={data.onSceneMenu} />
          {!isMobile && <HeadSceneButtons scene={scene} bookmarked={bookmarked} data={data} />}
        </div>
      </div>
    );
  }

  const path = `${outputDir}/${cell.filename}`;
  const isFav = scene.mains.includes(cell.filename);
  return (
    <div style={outer} className={className} data-scene-image-cell="img">
      <div
        data-scene-image-box=""
        className="relative w-full cursor-pointer hover:brightness-95 active:brightness-90 rounded-md bg-[var(--c-surface)]"
        style={boxStyle}
        onClick={() => data.onOpenImage(scene, cell.filename)}
        onContextMenu={(e) => imageMenu(e, path)}
      >
        {continued}
        <CellPicture path={path} thumb={data.thumb} favorite={isFav} />
      </div>
      {data.caption > 0 && (
        <div className="text-xs text-sub truncate px-0.5 select-none" style={{ height: data.caption, lineHeight: `${data.caption}px` }} data-scene-image-caption="">
          {scene.name}
        </div>
      )}
    </div>
  );
  },
);

/** 격자 칸 — 칸 인덱스를 구해 공용 칸 부품에 넘긴다 */
const GridCell = observer(({ columnIndex, rowIndex, style, data }: GridChildComponentProps<GridData>) => {
  const index = rowIndex * data.columnCount + columnIndex;
  const cell = data.cells[index];
  if (!cell) return null;
  // 「씬 별로」에서 씬이 다음 줄로 이어지면 그 줄 첫 칸에 씬 이름을 다시 적는다(최근 순은 칸 아래 이름이 있음)
  const continued =
    data.mode === 'byScene' && sceneContinuesRow(data.cells, index, data.columnCount) ? (
      <ContinuedTag name={cell.scene} />
    ) : null;
  return <SceneImageCellView cell={cell} style={style} data={data} continued={continued} />;
});

/** 가로 줄 첫 칸의 고정 — 바탕은 씬 목록 바탕(App 루트 --c-surface)과 같게 불투명, 뒤로 지나가는 이미지 위 */
const ROW_HEAD_STICKY = 'sticky left-0 z-10 bg-[var(--c-surface)]';

/** 가로 줄 하나(= 씬 하나) — 줄 안은 평범한 가로 스크롤, 칸은 가상화하지 않음 */
const SceneRow = observer(({ index, style, data }: ListChildComponentProps<RowsData>) => {
  const row = data.rows[index];
  // 스크롤 요소 ref 는 가로 스크롤 힌트 훅의 것을 함께 쓴다(가로 위치 복원도 이 ref)
  const { ref: scrollRef, hint, onScroll: updateHint } = useHScrollHint<HTMLDivElement>();
  const sceneName = row?.scene;
  const cellStyle = useMemo<React.CSSProperties>(
    () => ({ flex: 'none', width: data.cellWidth, height: data.cellHeight }),
    [data.cellWidth, data.cellHeight],
  );
  // 세로 스크롤로 줄이 다시 그려질 때 기억해 둔 가로 위치를 되살린다(그리기 전에 — 깜빡임 없이)
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || sceneName == null) return;
    const x = data.scrollMemo.get(sceneName);
    if (x) el.scrollLeft = x;
  }, [sceneName, data.scrollMemo]);
  if (!row) return null;
  return (
    <div style={style} data-scene-image-row={row.scene}>
      <div
        ref={scrollRef}
        // 모바일은 줄의 가로 막대를 숨긴다(자리를 차지하지 않게 — 옆 칸이 걸쳐 보여 넘길 수 있음을 알린다)
        className={`flex items-start h-full overflow-x-auto overflow-y-hidden${isMobile ? ' no-scrollbar' : ''}`}
        data-scene-row-scroll=""
        onScroll={(e) => {
          data.scrollMemo.set(row.scene, e.currentTarget.scrollLeft);
          updateHint();
        }}
      >
        {row.cells.map((cell) => (
          <SceneImageCellView
            key={`${cell.kind}:${cell.kind === 'img' ? cell.filename : cell.kind === 'head' ? `${cell.filename ?? ''}|${cell.input ?? ''}` : ''}:${data.cacheRev}`}
            cell={cell}
            style={cellStyle}
            data={data}
            className={cell.kind === 'head' ? ROW_HEAD_STICKY : undefined}
          />
        ))}
      </div>
      {/* 모바일: 가려진 칸이 있는 쪽에 옅은 화살표(표시 전용). 왼쪽 화살표는 고정된 첫 칸의 오른쪽에 붙인다 */}
      {isMobile && (hint.left || hint.right) && (
        <div
          className="absolute top-0 bottom-0 right-0 z-10 pointer-events-none"
          style={{ left: data.cellWidth }}
          data-scene-row-hint={`${hint.left ? 'L' : ''}${hint.right ? 'R' : ''}`}
        >
          {hint.left && <HScrollHintArrow side="left" surface="var(--c-surface)" />}
          {hint.right && <HScrollHintArrow side="right" surface="var(--c-surface)" />}
        </div>
      )}
    </div>
  );
});

/** 스크롤 바닥에 되돌리기 버튼 바 높이만큼 여백 — 씬 카드 격자와 같은 규칙(끝까지 내리면 마지막 줄이 바 위로) */
const InnerWithUndoGap = forwardRef<HTMLDivElement, { style: React.CSSProperties }>(({ style, ...rest }, ref) => (
  <div
    ref={ref}
    style={{ ...style, height: (Number.parseFloat(String(style?.height ?? 0)) || 0) + UNDO_BAR_HEIGHT_PX }}
    {...rest}
  />
));

const SceneImageViewInner = observer(
  forwardRef<SceneImageViewHandle, SceneImageViewProps>((props, ref) => {
    const { type, mode, session, scenes, isActive, containerRef, searching, bookmarkedScene } = props;
    const size = useElementSize(containerRef, SCENE_IMAGE_VIEW_FALLBACK);
    const gridRef = useRef<FixedSizeGrid<GridData>>(null);
    // 가로 줄 — 세로 가상 목록과 줄별 가로 스크롤 위치 기억(메모리만)
    const listRef = useRef<FixedSizeList<RowsData>>(null);
    const rowScrollMemoRef = useRef(new Map<string, number>());
    const memoRef = useRef(createSceneImageLayoutMemo());
    // 새 이미지(gameService 'updated' — 결과 목록 배열이 바뀜)·썸네일 무효화 때 다시 그린다. 숨은 탭에서는 구독하지 않는다.
    const [, setRev] = useState(0);
    const [cacheRev, setCacheRev] = useState(0);
    useEffect(() => {
      if (!isActive) return undefined;
      const onUpdated = () => setRev((r) => r + 1);
      const onInvalidated = () => setCacheRev((r) => r + 1);
      gameService.addEventListener('updated', onUpdated);
      imageService.addEventListener('image-cache-invalidated', onInvalidated);
      onUpdated();
      return () => {
        gameService.removeEventListener('updated', onUpdated);
        imageService.removeEventListener('image-cache-invalidated', onInvalidated);
      };
    }, [isActive]);

    // 재료 — 씬마다 결과 목록(배열 정체성이 메모 키)과 변형 입력. 렌더마다 만들지만 칸 목록은 바뀐 때만 다시 계산된다.
    const sources: SceneImageSource[] = isActive
      ? scenes.map((s) => ({
          name: s.name,
          outputs: gameService.getOutputs(session, s),
          input: sceneInputImageOf(session, s),
        }))
      : [];
    const rowsMode = mode === 'rows';
    // 가로 줄은 가로 줄 전용 상한, 그 밖은 씬 별로 상한(최근 순은 상한을 쓰지 않음)
    const cap = rowsMode ? sceneViewState.rowCap : sceneViewState.cap;
    const layout = memoRef.current(mode, sources, cap, type);
    // 목록 배열은 렌더마다 새로 오므로(getFilteredScenes) 원소가 같으면 직전 지도를 그대로 쓴다
    const scenesMapRef = useRef<{ list: GenericScene[]; names: string[]; map: Map<string, GenericScene> }>();
    const prevMap = scenesMapRef.current;
    if (
      !prevMap ||
      prevMap.list.length !== scenes.length ||
      prevMap.list.some((s, i) => s !== scenes[i] || prevMap.names[i] !== s.name)
    ) {
      scenesMapRef.current = {
        list: scenes,
        names: scenes.map((s) => s.name),
        map: new Map(scenes.map((s) => [s.name, s])),
      };
    }
    const scenesByName = scenesMapRef.current!.map;

    const percent = effectiveSceneCardPercent(appState.sceneCardSizePercent, true);
    const cardStyle = session.sceneCardStyle?.[type];
    const caption = mode === 'recent' ? SCENE_IMAGE_CAPTION : 0;
    const gridWidth = Math.max(1, size.width - (isMobile ? 0 : PC_SCROLLBAR_GUTTER));
    const metrics = sceneImageGridMetrics({ width: gridWidth, mobile: isMobile, percent, cardStyle, caption });
    const rowCount = Math.ceil(layout.cells.length / metrics.columnCount);
    // 가로 줄 칸 크기(PC = 위 격자와 같은 열 폭·그림 높이, 모바일 = 폭/3.3 정사각)
    const rowMetrics = sceneImageRowMetrics({ width: gridWidth, mobile: isMobile, percent, cardStyle });
    const sceneRows = layout.rows ?? EMPTY_ROWS;

    // 보이는 줄 범위(오버스캔 제외) — 캡처 「보이는 씬」. 격자 = 격자 줄, 가로 줄 = 목록 줄(= 씬)
    const visibleRowsRef = useRef<{ start: number; stop: number }>({ start: 0, stop: -1 });
    const onItemsRendered = useCallback((p: GridOnItemsRenderedProps) => {
      visibleRowsRef.current = { start: p.visibleRowStartIndex, stop: p.visibleRowStopIndex };
    }, []);
    const onRowsRendered = useCallback((p: ListOnItemsRenderedProps) => {
      visibleRowsRef.current = { start: p.visibleStartIndex, stop: p.visibleStopIndex };
    }, []);
    const latest = useRef({ layout, columnCount: metrics.columnCount, rowsMode });
    latest.current = { layout, columnCount: metrics.columnCount, rowsMode };

    useImperativeHandle(
      ref,
      () => ({
        // 칸이 하나도 없으면(빈 안내) 격자 없이도 준비 끝 — 히스토리 「이미지 그리드에서 보기」가 기다리다 포기하지 않게
        isReady: () =>
          !!containerRef.current &&
          containerRef.current.offsetParent !== null &&
          (!!(latest.current.rowsMode ? listRef.current : gridRef.current) || latest.current.layout.cells.length === 0),
        scrollToScene: (scene: string) => {
          if (latest.current.rowsMode) {
            // 가로 줄 = 그 씬의 줄로 세로 스크롤(이미지 없는 씬도 줄이 있다)
            const rowIdx = sceneRowIndex(latest.current.layout, scene);
            if (rowIdx < 0 || !listRef.current) return false;
            listRef.current.scrollToItem(rowIdx, 'start');
            return true;
          }
          const idx = sceneCellIndex(latest.current.layout, scene);
          if (idx < 0 || !gridRef.current) return false;
          gridRef.current.scrollToItem({ rowIndex: Math.floor(idx / latest.current.columnCount), columnIndex: 0, align: 'start' });
          return true;
        },
        visibleSceneNames: () => {
          const { start, stop } = visibleRowsRef.current;
          if (stop < start) return [];
          if (latest.current.rowsMode) return scenesInRowRange(latest.current.layout.rows ?? EMPTY_ROWS, start, stop);
          const [from, to] = visibleCellRange(start, stop, latest.current.columnCount);
          return scenesInCellRange(latest.current.layout.cells, from, to);
        },
      }),
      [containerRef],
    );

    // 콜백은 QueueControl 이 렌더마다 새로 만든다 → 고정된 감싸개가 부르는 순간의 최신 콜백을 부른다(칸이 괜히 다시 그려지지 않게)
    const handlersRef = useRef(props);
    handlersRef.current = props;
    const handlers = useMemo(
      () => ({
        onOpenImage: (s: GenericScene, f: string) => handlersRef.current.onOpenImage(s, f),
        onOpenScene: (s: GenericScene) => handlersRef.current.onOpenScene(s),
        onSceneMenu: (s: GenericScene, e: React.MouseEvent) => handlersRef.current.onSceneMenu(s, e),
        onQueueAdd: (s: GenericScene) => handlersRef.current.onQueueAdd(s),
        onQueueRemove: (s: GenericScene) => handlersRef.current.onQueueRemove(s),
        onEditScene: (s: GenericScene) => handlersRef.current.onEditScene(s),
        onToggleBookmark: (s: GenericScene) => handlersRef.current.onToggleBookmark(s),
      }),
      [],
    );
    const itemData = useMemo<GridData>(
      () => ({
        cells: layout.cells,
        columnCount: metrics.columnCount,
        thumb: metrics.thumb,
        imageHeight: metrics.imageHeight,
        caption,
        mode,
        session,
        scenesByName,
        bookmarkedScene,
        ...handlers,
      }),
      [layout, metrics.columnCount, metrics.thumb, metrics.imageHeight, caption, mode, session, scenesByName, bookmarkedScene, handlers],
    );
    const rowsData = useMemo<RowsData>(
      () => ({
        rows: sceneRows,
        cellWidth: rowMetrics.cellWidth,
        cellHeight: rowMetrics.cellHeight,
        thumb: rowMetrics.thumb,
        imageHeight: rowMetrics.imageHeight,
        caption: 0,
        session,
        scenesByName,
        bookmarkedScene,
        scrollMemo: rowScrollMemoRef.current,
        cacheRev,
        ...handlers,
      }),
      [
        sceneRows,
        rowMetrics.cellWidth,
        rowMetrics.cellHeight,
        rowMetrics.thumb,
        rowMetrics.imageHeight,
        session,
        scenesByName,
        bookmarkedScene,
        cacheRev,
        handlers,
      ],
    );

    let empty: React.ReactNode = null;
    if (isActive) {
      if (scenes.length === 0) {
        empty = searching ? (
          <EmptyState size="lg" className="w-full h-full select-none">
            {SCENE_VIEW_TEXT.noSearchResult}
          </EmptyState>
        ) : (
          <EmptyState size="lg" className="w-full h-full select-none" hint={SCENE_VIEW_TEXT.noScenesHint}>
            {SCENE_VIEW_TEXT.noScenes}
          </EmptyState>
        );
      } else if (layout.cells.length === 0) {
        empty = (
          <EmptyState size="lg" className="w-full h-full select-none">
            {SCENE_VIEW_TEXT.noImages}
          </EmptyState>
        );
      }
    }

    return (
      <div ref={containerRef} className="relative flex-1 min-w-0 h-full overflow-hidden" data-scene-image-view={mode}>
        {isActive &&
          (empty ??
            (rowsMode ? (
              <FixedSizeList<RowsData>
                ref={listRef}
                itemCount={sceneRows.length}
                itemSize={rowMetrics.rowHeight}
                width={size.width}
                height={size.height}
                overscanCount={isMobile ? 2 : 4}
                style={{ overflowX: 'hidden' }}
                innerElementType={InnerWithUndoGap}
                onItemsRendered={onRowsRendered}
                itemData={rowsData}
                // 썸네일 무효화 때는 줄째 다시 그린다(가로 위치는 기억값으로 되살아남)
                itemKey={(index, data) => `${data.rows[index]?.scene ?? `empty-${index}`}:${data.cacheRev}`}
              >
                {SceneRow}
              </FixedSizeList>
            ) : (
            <FixedSizeGrid<GridData>
              ref={gridRef}
              columnCount={metrics.columnCount}
              columnWidth={metrics.columnWidth}
              rowCount={rowCount}
              rowHeight={metrics.rowHeight}
              width={size.width}
              height={size.height}
              overscanRowCount={isMobile ? 2 : 4}
              style={{ overflowX: 'hidden' }}
              innerElementType={InnerWithUndoGap}
              onItemsRendered={onItemsRendered}
              itemData={itemData}
              itemKey={({ columnIndex, rowIndex, data }) => {
                const c = data.cells[rowIndex * data.columnCount + columnIndex];
                if (!c) return `empty-${rowIndex}:${columnIndex}`;
                const k = c.kind === 'img' ? c.filename : c.kind === 'head' ? `${c.filename ?? ''}|${c.input ?? ''}` : '';
                return `${c.kind}:${c.scene}:${k}:${cacheRev}`;
              }}
            >
              {GridCell}
            </FixedSizeGrid>
            )))}
      </div>
    );
  }),
);

export const SceneImageView = SceneImageViewInner;
export default SceneImageView;

// ===== 보기 방식 고르기(PC 보기 설정 묶음) =====

/**
 * 보기 방식 드롭다운 + 「씬 별로」일 때 「씬당 [8]장」, 「가로 줄」일 때 「줄당 [20]장」.
 * 이미지생성·이미지변형 탭이 각자 보기 방식을 가진다(상한은 둘 다 앱 전체 공용).
 */
export const SceneViewModeControl = observer(({ type }: { type: SceneViewTab }) => {
  const mode = sceneViewModeOf(type);
  return (
    <>
      <select
        className="app-select app-select-tight text-sm h-8"
        aria-label={SCENE_VIEW_TEXT.label}
        data-scene-view-mode=""
        value={mode}
        onChange={(e) => setSceneViewMode(type, normalizeSceneViewMode(e.target.value))}
      >
        {SCENE_VIEW_MODES.map((m) => (
          <option key={m} value={m}>
            {SCENE_VIEW_TEXT.modes[m]}
          </option>
        ))}
      </select>
      {mode === 'byScene' && <SceneViewCapInput key="scene" kind="scene" />}
      {mode === 'rows' && <SceneViewCapInput key="row" kind="row" />}
    </>
  );
});

/** 상한 입력의 종류별 값 — scene = 씬 별로(씬당), row = 가로 줄(줄당). data 속성도 종류별로 구분한다 */
const CAP_INPUT_KINDS = {
  scene: {
    prefix: SCENE_VIEW_TEXT.capPrefix,
    aria: SCENE_VIEW_TEXT.capAria,
    min: SCENE_VIEW_CAP_MIN,
    max: SCENE_VIEW_CAP_MAX,
    read: () => sceneViewState.cap,
    set: setSceneViewCap,
    normalize: normalizeSceneViewCap,
    dataAttr: { 'data-scene-view-cap': '' },
  },
  row: {
    prefix: SCENE_VIEW_TEXT.rowCapPrefix,
    aria: SCENE_VIEW_TEXT.rowCapAria,
    min: SCENE_VIEW_ROW_CAP_MIN,
    max: SCENE_VIEW_ROW_CAP_MAX,
    read: () => sceneViewState.rowCap,
    set: setSceneViewRowCap,
    normalize: normalizeSceneViewRowCap,
    dataAttr: { 'data-scene-view-row-cap': '' },
  },
} as const;

/** 장수 입력 — 입력 중에는 글자를 그대로 두고, 범위 안 숫자가 되면 바로 적용, 칸을 떠나면 정리된 값으로 */
const SceneViewCapInput = observer(({ kind }: { kind: keyof typeof CAP_INPUT_KINDS }) => {
  const k = CAP_INPUT_KINDS[kind];
  const cap = k.read();
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="flex items-center gap-1 text-sm text-muted" {...k.dataAttr}>
      <span>{k.prefix}</span>
      <input
        type="number"
        className="gray-input w-14 h-8 p-1 text-center tabular-nums"
        aria-label={k.aria}
        min={k.min}
        max={k.max}
        value={draft ?? String(cap)}
        onChange={(e) => {
          const raw = e.currentTarget.value;
          setDraft(raw);
          const n = Number(raw);
          if (raw.trim() !== '' && Number.isFinite(n) && n >= k.min && n <= k.max) {
            k.set(n);
          }
        }}
        onBlur={() => {
          if (draft != null) k.set(k.normalize(draft === '' ? cap : draft));
          setDraft(null);
        }}
      />
      <span>{SCENE_VIEW_TEXT.capUnit}</span>
    </label>
  );
});
