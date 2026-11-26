// 씬 목록 「이미지 뷰 모드」 1차(2026-11-26) — 씬 별로 / 최근 순 격자. 규칙·상태는 models/sceneImageView.ts(순수).
// · 그리는 곳 = QueueControl(SceneQueueControl.tsx)의 메인 씬 목록 자리. 보기 방식이 cards 가 아니면 씬 카드 격자 대신 이것.
// · 가상 격자(react-window FixedSizeGrid, 모든 칸 같은 크기) — 화면에 보이는 칸만 그린다.
// · 이미지 칸 누름 = 그 씬의 이미지 그리드를 그 이미지 위치로(onOpenImage), 우클릭/길게 누르기 = 이미지 그리드의 이미지 메뉴(GallaryImage).
// · 씬 첫 칸의 이름 띠(빈 첫 칸은 칸 전체) 누름·우클릭 = 씬 메뉴(onSceneMenu). 더보기 칸 = 그 씬의 이미지 그리드(onOpenScene).
// · 숨은 탭(isActive 거짓)에서는 구독·격자를 쉰다(바깥 상자만 남겨 「보이는 탭」 판정 ref 를 유지).
// · 등장 움직임 없음. 색은 --c-* 토큰·기존 클래스만.
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { observer } from 'mobx-react-lite';
import { useContextMenu } from 'react-contexify';
import { FixedSizeGrid, GridChildComponentProps, GridOnItemsRenderedProps } from 'react-window';
import { gameService, imageService, isMobile, workFlowService } from '../models';
import { appState } from '../models/AppService';
import { imageDragOutProps } from '../models/imageDragOut';
import { effectiveSceneCardPercent } from '../models/sizeSlider';
import {
  createSceneImageLayoutMemo,
  sceneCellIndex,
  SceneImageCell,
  sceneImageGridMetrics,
  SceneImageSource,
  SceneImageViewMode,
  SCENE_IMAGE_CAPTION,
  SCENE_IMAGE_CELL_PAD,
  SCENE_VIEW_CAP_MAX,
  SCENE_VIEW_CAP_MIN,
  SCENE_VIEW_MODES,
  SCENE_VIEW_TEXT,
  scenesInCellRange,
  sceneViewModeOf,
  sceneViewState,
  SceneViewTab,
  setSceneViewCap,
  setSceneViewMode,
  normalizeSceneViewMode,
  normalizeSceneViewCap,
  visibleCellRange,
} from '../models/sceneImageView';
import { ContextMenuType, GenericScene, Session } from '../models/types';
import { EmptyState } from './EmptyState';
import { useElementSize, useProgressiveImage } from './historyHooks';
import { UNDO_BAR_HEIGHT_PX } from './UndoBarSlot';

/** 격자가 0 크기로 재일 때(배치 전·테스트 환경) 쓰는 크기 */
const SCENE_IMAGE_VIEW_FALLBACK = { width: 800, height: 600 };
/** PC 세로 스크롤 막대 몫(칸이 가로로 넘치지 않게 폭에서 뺀다) */
const PC_SCROLLBAR_GUTTER = 12;

export interface SceneImageViewHandle {
  /** 보이는 탭에 격자가 그려져 스크롤할 수 있는가 */
  isReady(): boolean;
  /** 그 씬의 칸으로 스크롤(씬 별로 = 첫 칸, 최근 순 = 가장 최근 이미지). 칸이 없으면 거짓 */
  scrollToScene(scene: string): boolean;
  /** 지금 화면에 칸이 하나라도 보이는 씬(목록 순서) */
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

interface GridData {
  cells: readonly SceneImageCell[];
  columnCount: number;
  thumb: number;
  imageHeight: number;
  caption: number;
  mode: SceneImageViewMode;
  session: Session;
  scenesByName: Map<string, GenericScene>;
  onOpenImage: SceneImageViewProps['onOpenImage'];
  onOpenScene: SceneImageViewProps['onOpenScene'];
  onSceneMenu: SceneImageViewProps['onSceneMenu'];
}

/** 이름 띠 — 씬 카드와 같은 모양(아래 검정 그라데이션 + 흰 글자). 누름·우클릭 = 씬 메뉴 */
const SceneNameStrip = observer(
  ({ scene, total, onSceneMenu }: { scene: GenericScene; total: number; onSceneMenu: GridData['onSceneMenu'] }) => {
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
            {emoji}
            {scene.name}
          </div>
          <div className="flex-none ml-1 text-white/80 drop-shadow">{total}</div>
        </div>
      </div>
    );
  },
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

const GridCell = observer(({ columnIndex, rowIndex, style, data }: GridChildComponentProps<GridData>) => {
  const index = rowIndex * data.columnCount + columnIndex;
  const cell = data.cells[index];
  const { show } = useContextMenu({ id: ContextMenuType.GallaryImage });
  if (!cell) return null;
  const scene = data.scenesByName.get(cell.scene);
  if (!scene) return null;
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
      <div style={{ ...style, padding: SCENE_IMAGE_CELL_PAD }} data-scene-image-cell="more">
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
    return (
      <div style={{ ...style, padding: SCENE_IMAGE_CELL_PAD }} data-scene-image-cell={empty ? 'head-empty' : 'head'}>
        <div
          className={`relative w-full overflow-hidden rounded-lg border-2 bg-[var(--c-surface-2)] ${
            isFav ? 'border-yellow-400' : 'border-[var(--c-sky-bg)]'
          }${empty ? ' cursor-pointer' : ''}`}
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
            <CellPicture path={picturePath} thumb={data.thumb} />
          </div>
          <SceneNameStrip scene={scene} total={cell.total} onSceneMenu={data.onSceneMenu} />
        </div>
      </div>
    );
  }

  const path = `${outputDir}/${cell.filename}`;
  const isFav = scene.mains.includes(cell.filename);
  return (
    <div style={{ ...style, padding: SCENE_IMAGE_CELL_PAD }} data-scene-image-cell="img">
      <div
        className="w-full cursor-pointer hover:brightness-95 active:brightness-90 rounded-md bg-[var(--c-surface)]"
        style={boxStyle}
        onClick={() => data.onOpenImage(scene, cell.filename)}
        onContextMenu={(e) => imageMenu(e, path)}
      >
        <CellPicture path={path} thumb={data.thumb} favorite={isFav} />
      </div>
      {data.caption > 0 && (
        <div className="text-xs text-sub truncate px-0.5 select-none" style={{ height: data.caption, lineHeight: `${data.caption}px` }} data-scene-image-caption="">
          {scene.name}
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
    const { type, mode, session, scenes, isActive, containerRef, searching } = props;
    const size = useElementSize(containerRef, SCENE_IMAGE_VIEW_FALLBACK);
    const gridRef = useRef<FixedSizeGrid<GridData>>(null);
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
    const cap = sceneViewState.cap;
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

    // 보이는 줄 범위(오버스캔 제외) — 캡처 「보이는 씬」
    const visibleRowsRef = useRef<{ start: number; stop: number }>({ start: 0, stop: -1 });
    const onItemsRendered = useCallback((p: GridOnItemsRenderedProps) => {
      visibleRowsRef.current = { start: p.visibleRowStartIndex, stop: p.visibleRowStopIndex };
    }, []);
    const latest = useRef({ layout, columnCount: metrics.columnCount });
    latest.current = { layout, columnCount: metrics.columnCount };

    useImperativeHandle(
      ref,
      () => ({
        // 칸이 하나도 없으면(빈 안내) 격자 없이도 준비 끝 — 히스토리 「이미지 그리드에서 보기」가 기다리다 포기하지 않게
        isReady: () =>
          !!containerRef.current &&
          containerRef.current.offsetParent !== null &&
          (!!gridRef.current || latest.current.layout.cells.length === 0),
        scrollToScene: (scene: string) => {
          const idx = sceneCellIndex(latest.current.layout, scene);
          if (idx < 0 || !gridRef.current) return false;
          gridRef.current.scrollToItem({ rowIndex: Math.floor(idx / latest.current.columnCount), columnIndex: 0, align: 'start' });
          return true;
        },
        visibleSceneNames: () => {
          const { start, stop } = visibleRowsRef.current;
          if (stop < start) return [];
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
        ...handlers,
      }),
      [layout, metrics.columnCount, metrics.thumb, metrics.imageHeight, caption, mode, session, scenesByName, handlers],
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
          (empty ?? (
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
          ))}
      </div>
    );
  }),
);

export const SceneImageView = SceneImageViewInner;
export default SceneImageView;

// ===== 보기 방식 고르기(PC 보기 설정 묶음) =====

/** 보기 방식 드롭다운 + 「씬 별로」일 때만 「씬당 [8]장」. 이미지생성·이미지변형 탭이 각자 값을 가진다(상한은 공용). */
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
      {mode === 'byScene' && <SceneViewCapInput />}
    </>
  );
});

/** 씬당 장수 — 입력 중에는 글자를 그대로 두고, 범위 안 숫자가 되면 바로 적용, 칸을 떠나면 정리된 값으로 */
const SceneViewCapInput = observer(() => {
  const cap = sceneViewState.cap;
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="flex items-center gap-1 text-sm text-muted" data-scene-view-cap="">
      <span>{SCENE_VIEW_TEXT.capPrefix}</span>
      <input
        type="number"
        className="gray-input w-14 h-8 p-1 text-center tabular-nums"
        aria-label={SCENE_VIEW_TEXT.capAria}
        min={SCENE_VIEW_CAP_MIN}
        max={SCENE_VIEW_CAP_MAX}
        value={draft ?? String(cap)}
        onChange={(e) => {
          const raw = e.currentTarget.value;
          setDraft(raw);
          const n = Number(raw);
          if (raw.trim() !== '' && Number.isFinite(n) && n >= SCENE_VIEW_CAP_MIN && n <= SCENE_VIEW_CAP_MAX) {
            setSceneViewCap(n);
          }
        }}
        onBlur={() => {
          if (draft != null) setSceneViewCap(normalizeSceneViewCap(draft === '' ? cap : draft));
          setDraft(null);
        }}
      />
      <span>{SCENE_VIEW_TEXT.capUnit}</span>
    </label>
  );
});
