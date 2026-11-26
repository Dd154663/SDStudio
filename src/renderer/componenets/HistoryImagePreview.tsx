import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { VariableSizeList, ListChildComponentProps } from 'react-window';
import {
  FaChevronLeft,
  FaChevronRight,
  FaRegImage,
  FaRegStar,
  FaStar,
  FaStream,
  FaTimes,
} from 'react-icons/fa';
import { imageHistoryService, imageService, isMobile } from '../models';
import { appState } from '../models/AppService';
import { useBackLayer } from '../models/BackStackService';
import { GenerationHistoryEntry } from '../models/ImageHistoryService';
import {
  closeHistoryPreview,
  HISTORY_VIEWER_TEXT,
  historyEntryCaption,
  historyPreviewFallbackId,
  historyPreviewList,
  historyPreviewNeighbors,
  historyPreviewState,
  HistoryViewerMode,
  setHistoryViewerMode,
  showHistoryPreviewEntry,
} from '../models/historyPreview';
import { closeHistoryView } from '../models/historyView';
import {
  adjustScrollForResize,
  aspectChanged,
  aspectFromSize,
  containBox,
  historyItemAspect,
  indexAtOffset,
  itemTopOf,
  scrollColumnWidth,
  scrollItemHeight,
  wantsFullInScroll,
} from '../models/historyLayout';
import { horizontalSwipeStep } from '../models/swipeNav';
import { imageDragOutProps } from '../models/imageDragOut';
import { isTextEntryFocused } from '../models/keyTargetGuard';
import { GenericScene } from '../models/types';
import { resolutionMap } from '../backends/imageGen';
import { useBackdropClose } from './backdropClose';
import {
  historyAspectMemo,
  historySceneAspectMemo,
  useElementSize,
  useProgressiveImage,
} from './historyHooks';

// 히스토리 큰 미리 보기(2026-11-22) — 히스토리 칸을 누르면 지금 화면 위에 크게 띄운다.
// App 에 한 번만 마운트(드로어 DOM 밖). 층은 --z-modal-top(모바일 드로어·손잡이 위, 토스트·확인 창·컨텍스트 메뉴 아래).
// 등장 움직임 없음(바로 뜨고 바로 닫힘, 넘김도 움직임 없이 바로 바뀜). 다른 프로젝트 항목도 entry.path·resolveQuiet 로 다룬다.
// 이전/다음은 버튼과 좌우 화살표 키 — 이 창이 떠 있는 동안 전역 단축키는 막힌다(KeyboardShortcutService 의
// historyPreviewOpen — 되돌리기·다시 실행만 통과). 우클릭 메뉴는 달지 않는다 — 메뉴 결과 창(생성 설정 적용·씬 이동 등)이 이 창 아래에 뜬다.
//
// 2026-11-26 히스토리 확대:
//  · 넘겨 볼 목록 = models/historyPreview 의 scopeIds(패널에서 열면 히스토리 전체, 크게 보기에서 열면 거른 목록).
//  · 「한 장씩」 = 400 썸네일 먼저 → 원본으로 바꿔 끼움(늦게 온 이전 장의 읽기는 무시), 좌우 스와이프(상세 보기와 같은 판정,
//    data-edge-swipe-ignore 로 가장자리 서랍 제스처에 양보받음), 이웃 장 썸네일 미리 읽기.
//  · 「세로로 이어 보기」 = 가상 세로 목록(웹툰처럼), 폭 맞춤, 높이는 추정(잰 비율 → 씬 해상도 → 3:4) 뒤 실제 비율로 보정.
//    지금 장과 위아래 한 장만 원본, 나머지는 썸네일. 장마다 별 버튼·씬 이름·순번.
//  · 보기 방식 택일은 localStorage 에 기억(sdstudio-history-viewer-mode).

const VIEWER_MODES: { mode: HistoryViewerMode; label: string; icon: React.ReactNode }[] = [
  { mode: 'single', label: HISTORY_VIEWER_TEXT.single, icon: <FaRegImage aria-hidden="true" /> },
  { mode: 'scroll', label: HISTORY_VIEWER_TEXT.scroll, icon: <FaStream aria-hidden="true" /> },
];

/** 씬 해상도 → 비율(모르면 undefined) — 세로 보기의 읽기 전 추정용 */
function sceneAspectOf(scene: GenericScene | undefined): number | undefined {
  if (!scene) return undefined;
  const s = scene as any;
  if (s.resolution === 'custom') return aspectFromSize(s.resolutionWidth, s.resolutionHeight);
  const size = (resolutionMap as Record<string, { width: number; height: number } | undefined>)[s.resolution];
  return aspectFromSize(size?.width, size?.height);
}

const sceneKeyOf = (e: GenerationHistoryEntry) => `${e.sessionName}/${e.sceneType}/${e.sceneName}`;

/** 파일이 사라진 항목 — 칸과 같은 규칙으로 히스토리에서 지운다(알림은 한 장씩 보기에서만) */
function removeMissing(entry: GenerationHistoryEntry, notify: boolean) {
  if (notify) appState.pushMessage('이미지 파일을 찾을 수 없습니다');
  imageHistoryService.remove(entry.id);
}

// ===== 한 장씩 =====

const SingleImageArea = ({
  entry,
  caption,
  prevEntry,
  nextEntry,
  onStep,
  backdropProps,
}: {
  entry: GenerationHistoryEntry;
  caption: string;
  prevEntry: GenerationHistoryEntry | undefined;
  nextEntry: GenerationHistoryEntry | undefined;
  onStep: (delta: -1 | 1) => void;
  backdropProps: ReturnType<typeof useBackdropClose>;
}) => {
  const img = useProgressiveImage(entry.path, true, { onMissing: () => removeMissing(entry, true) });
  const areaRef = useRef<HTMLDivElement>(null);
  const area = useElementSize(areaRef, { width: 0, height: 0 });
  const [natural, setNatural] = useState<{ path: string; width: number; height: number } | undefined>(undefined);
  // 비율을 처음 잰 뒤 담는 크기를 다시 계산하게(비율 기억은 mobx 가 아니라 다시 그리기를 직접 부른다)
  const [, bumpAspect] = useState(0);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  // 이웃 장의 썸네일을 미리 읽어 둔다(연달아 넘길 때 빈 화면이 보이지 않게 — 400 썸네일은 캐시에 남는다)
  useEffect(() => {
    for (const e of [prevEntry, nextEntry]) {
      if (e) imageService.fetchImageSmall(e.path, 400).catch(() => {});
    }
  }, [prevEntry?.path, nextEntry?.path]);

  // 썸네일과 원본이 같은 크기로 그려지게 영역 안에 담는 크기를 직접 정한다(원본 크기를 알면 그보다 키우지 않음).
  // 영역 안쪽 여백(p-3 / md:p-6)을 뺀 값.
  const pad = isMobile ? 24 : 48;
  const aspect = historyAspectMemo.get(entry.path);
  const box = containBox(
    area.width - pad,
    area.height - pad,
    aspect,
    img.stage === 'full' && natural && natural.path === entry.path ? natural : undefined,
  );
  const showSrc = img.stage === 'thumb' || img.stage === 'full' ? img.src : undefined;

  return (
    <div
      ref={areaRef}
      className="flex-1 min-h-0 w-full flex items-center justify-center p-3 md:p-6"
      // 좌우 스와이프로 넘기는 영역 — 가장자리 드로어 스와이프에 양보받는다(edgeSwipe.ts)
      data-edge-swipe-ignore=""
      data-history-preview-area=""
      {...backdropProps}
      onTouchStart={(e) => {
        touchStart.current =
          e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
      }}
      onTouchEnd={(e) => {
        const start = touchStart.current;
        touchStart.current = null;
        if (!start) return;
        const t = e.changedTouches[0];
        const step = horizontalSwipeStep(t.clientX - start.x, t.clientY - start.y);
        if (step !== 0) onStep(step);
      }}
    >
      {showSrc ? (
        <img
          src={showSrc}
          draggable={false}
          {...imageDragOutProps(entry.path)}
          alt={caption}
          data-history-preview-stage={img.stage}
          className="max-w-full max-h-full object-contain rounded"
          style={box ? { width: box.width, height: box.height } : undefined}
          onLoad={(e) => {
            const im = e.currentTarget;
            if (!(im.naturalWidth > 0 && im.naturalHeight > 0)) return;
            historyAspectMemo.set(entry.path, im.naturalWidth / im.naturalHeight);
            if (img.stage === 'full') {
              setNatural({ path: entry.path, width: im.naturalWidth, height: im.naturalHeight });
            } else if (!aspect) {
              bumpAspect((n) => n + 1);
            }
          }}
        />
      ) : (
        <div className="text-sm text-white/80" data-history-preview-status={img.stage === 'error' ? 'error' : 'loading'}>
          {img.stage === 'error' ? '이미지를 불러오지 못했습니다' : '불러오는 중…'}
        </div>
      )}
    </div>
  );
};

// ===== 세로로 이어 보기 =====

interface ScrollRowData {
  list: readonly GenerationHistoryEntry[];
  columnWidth: number;
  current: number;
  curSessionName: string | undefined;
  aspectOf: (i: number) => number;
  onAspect: (i: number, prev: number, next: number) => void;
  onSceneAspect: (i: number, aspect: number) => void;
}

const ScrollRow = observer(({ index, style, data }: ListChildComponentProps<ScrollRowData>) => {
  const entry = data.list[index];
  const wantFull = wantsFullInScroll(index, data.current);
  const img = useProgressiveImage(entry?.path, wantFull, {
    onMissing: () => entry && removeMissing(entry, false),
  });
  const [scene, setScene] = useState<GenericScene | undefined>(undefined);
  useEffect(() => {
    if (!entry) return undefined;
    let canceled = false;
    setScene(undefined);
    imageHistoryService.resolveQuiet(entry).then((r) => {
      if (canceled || !r) return;
      setScene(r.scene);
      const a = sceneAspectOf(r.scene);
      if (a) data.onSceneAspect(index, a);
    });
    return () => {
      canceled = true;
    };
  }, [entry?.path]);
  if (!entry) return null;
  const aspect = data.aspectOf(index);
  const imgH = Math.max(1, Math.round(data.columnWidth / aspect));
  const isFav = !!scene && scene.mains.includes(entry.filename);
  const showSrc = img.stage === 'thumb' || img.stage === 'full' ? img.src : undefined;
  return (
    <div style={style} className="flex flex-col items-center" data-history-scroll-item={index}>
      <div
        className="relative rounded overflow-hidden bg-[var(--c-input-bg)]"
        style={{ width: data.columnWidth, height: imgH }}
      >
        {showSrc && (
          <img
            src={showSrc}
            draggable={false}
            {...imageDragOutProps(entry.path)}
            alt={entry.sceneName}
            className="w-full h-full object-contain"
            onLoad={(e) => {
              const im = e.currentTarget;
              if (im.naturalWidth > 0 && im.naturalHeight > 0) {
                data.onAspect(index, aspect, im.naturalWidth / im.naturalHeight);
              }
            }}
          />
        )}
        {!!scene && (
          <button
            className={
              'absolute left-0 top-0 z-10 m-2 rounded-full card-overlay-btn flex items-center justify-center shadow ' +
              (isMobile ? 'w-8 h-8 touch-hit' : 'w-7 h-7')
            }
            aria-label={isFav ? '즐겨찾기 해제' : '즐겨찾기'}
            title={isFav ? '즐겨찾기 해제' : '즐겨찾기'}
            aria-pressed={isFav}
            data-history-scroll-fav=""
            onClick={() => imageHistoryService.toggleFavorite(entry)}
          >
            {isFav ? <FaStar size={14} className="text-yellow-400" /> : <FaRegStar size={14} />}
          </button>
        )}
      </div>
      <div
        className="flex items-center justify-between gap-2 text-xs text-white/80 mt-1"
        style={{ width: data.columnWidth }}
      >
        <span className="truncate">{historyEntryCaption(entry, data.curSessionName)}</span>
        <span className="flex-none tabular-nums">{HISTORY_VIEWER_TEXT.position(index + 1, data.list.length)}</span>
      </div>
    </div>
  );
});

interface ScrollApi {
  scrollToIndex: (i: number) => void;
}

const ScrollArea = ({
  list,
  startIndex,
  onCurrent,
  apiRef,
}: {
  list: readonly GenerationHistoryEntry[];
  startIndex: number;
  onCurrent: (index: number) => void;
  apiRef: React.MutableRefObject<ScrollApi | null>;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<VariableSizeList<ScrollRowData>>(null);
  const size = useElementSize(containerRef, { width: 600, height: 800 });
  const scrollRef = useRef(0);
  const [current, setCurrent] = useState(startIndex);
  const [, setRev] = useState(0);
  const curSessionName = appState.curSession?.name;
  const columnWidth = scrollColumnWidth(size.width, isMobile);

  // 아래 함수들은 렌더 중(initialScrollOffset·itemSize·itemData) 값으로 읽히므로 Grid 보다 먼저 선언(선언 순서 주의)
  const aspectOf = (i: number): number => {
    const e = list[i];
    if (!e) return historyItemAspect();
    return historyItemAspect(historyAspectMemo.get(e.path), historySceneAspectMemo.get(sceneKeyOf(e)));
  };
  const heightOf = (i: number) => scrollItemHeight(columnWidth, aspectOf(i));
  // 처음 위치 = 시작 장의 위쪽(연 뒤에는 바꾸지 않는다 — 장을 넘겨도 다시 그 자리로 끌려가지 않게)
  const [initialOffset] = useState(() => itemTopOf(heightOf, startIndex));

  // i 번째 장의 높이가 old → new 로 바뀌었을 때 — 그 장부터 다시 재고, 보던 위치보다 위면 스크롤 보정
  const applyResize = (i: number, oldH: number, newH: number) => {
    const l = listRef.current;
    if (!l || oldH === newH) return;
    const top = itemTopOf(heightOf, i);
    l.resetAfterIndex(i, true);
    const next = adjustScrollForResize(scrollRef.current, top, oldH, newH);
    if (next !== scrollRef.current) {
      scrollRef.current = next;
      l.scrollTo(next);
    }
  };
  const onAspect = (i: number, prev: number, next: number) => {
    const e = list[i];
    if (!e) return;
    const known = historyAspectMemo.get(e.path);
    historyAspectMemo.set(e.path, next);
    if (!aspectChanged(known ?? prev, next)) return;
    applyResize(i, scrollItemHeight(columnWidth, known ?? prev), scrollItemHeight(columnWidth, next));
  };
  const onSceneAspect = (i: number, aspect: number) => {
    const e = list[i];
    if (!e) return;
    const key = sceneKeyOf(e);
    if (!aspectChanged(historySceneAspectMemo.get(key), aspect)) return;
    historySceneAspectMemo.set(key, aspect);
    // 같은 씬의 다른 장도 이 추정을 쓴다 — 아직 잰 비율이 없는 장이 있으면 처음부터 다시 잰다(드문 일)
    listRef.current?.resetAfterIndex(0, true);
    setRev((r) => r + 1);
  };
  const updateCurrent = (offset: number) => {
    // 화면 위에서 1/3 지점에 걸친 장 = 지금 장
    const i = indexAtOffset(heightOf, list.length, offset + size.height / 3);
    if (i >= 0 && i !== current) {
      setCurrent(i);
      onCurrent(i);
    }
  };

  apiRef.current = {
    scrollToIndex: (i: number) => {
      if (i < 0 || i >= list.length) return;
      listRef.current?.scrollToItem(i, 'start');
    },
  };

  // 폭이 바뀌면(처음 측정 포함) 높이를 처음부터 다시 재고 지금 장의 위쪽으로 다시 맞춘다
  const currentRef = useRef(current);
  currentRef.current = current;
  useLayoutEffect(() => {
    const l = listRef.current;
    if (!l) return;
    l.resetAfterIndex(0, true);
    const top = itemTopOf(heightOf, currentRef.current);
    scrollRef.current = top;
    l.scrollTo(top);
  }, [columnWidth]);
  // 목록이 바뀌면(항목이 빠짐) 높이 기억을 다시
  useEffect(() => {
    listRef.current?.resetAfterIndex(0, true);
  }, [list]);

  return (
    <div ref={containerRef} className="flex-1 min-h-0 w-full" data-history-scroll="">
      <VariableSizeList<ScrollRowData>
        ref={listRef}
        width={size.width}
        height={size.height}
        itemCount={list.length}
        itemSize={heightOf}
        estimatedItemSize={heightOf(startIndex)}
        initialScrollOffset={initialOffset}
        overscanCount={1}
        itemKey={(i, data) => data.list[i]?.id ?? `empty-${i}`}
        itemData={{ list, columnWidth, current, curSessionName, aspectOf, onAspect, onSceneAspect }}
        onScroll={({ scrollOffset }) => {
          scrollRef.current = scrollOffset;
          updateCurrent(scrollOffset);
        }}
      >
        {ScrollRow}
      </VariableSizeList>
    </div>
  );
};

// ===== 창 =====

export const HistoryImagePreview = observer(() => {
  const entryId = historyPreviewState.entryId;
  const mode = historyPreviewState.mode;
  const allEntries = imageHistoryService.entries;
  const scopeIds = historyPreviewState.scopeIds;
  // 목록 — 히스토리가 바뀌거나 다른 목록으로 열 때만 다시 만든다(세로 보기가 목록 바뀜을 보고 높이를 다시 잰다)
  const list = useMemo(() => historyPreviewList(allEntries, scopeIds), [allEntries, scopeIds]);
  const index = entryId ? list.findIndex((e) => e.id === entryId) : -1;
  const entry = index >= 0 ? list[index] : undefined;
  const open = !!entry;
  const lastIndexRef = useRef(0);
  if (index >= 0) lastIndexRef.current = index;
  const scrollApiRef = useRef<ScrollApi | null>(null);

  // 항목이 목록에서 사라지면(파일 없음으로 제거·삭제 등) — 한 장씩 = 닫는다(종전), 세로 보기 = 같은 자리의 다음 장으로
  useEffect(() => {
    if (!entryId || entry) return;
    const fallback = mode === 'scroll' ? historyPreviewFallbackId(list, lastIndexRef.current) : null;
    if (fallback) showHistoryPreviewEntry(fallback);
    else closeHistoryPreview();
  }, [entryId, entry]);

  // Esc·안드로이드 뒤로 가기 — 맨 위 한 겹(이 창)만 닫힌다. 크게 보기 창(FloatView)이 아래에 있으면 그다음 뒤로 가기에 닫힌다.
  useBackLayer(open, closeHistoryPreview);
  const backdrop = useBackdropClose(closeHistoryPreview);
  const imageAreaBackdrop = useBackdropClose(closeHistoryPreview);

  const [scene, setScene] = useState<GenericScene | undefined>(undefined);
  const path = entry?.path;
  useEffect(() => {
    if (!entry) return undefined;
    let canceled = false;
    setScene(undefined);
    imageHistoryService.resolveQuiet(entry).then((r) => {
      if (!canceled && r) setScene(r.scene);
    });
    return () => {
      canceled = true;
    };
  }, [path]);

  const neighbors = historyPreviewNeighbors(list, entry ? entry.id : null);
  const prevId = neighbors.prev;
  const nextId = neighbors.next;
  // 이전/다음 — 한 장씩 = 그 장으로 바꿈, 세로 보기 = 그 장으로 스크롤(지금 장은 스크롤이 정한다).
  // 키 처리·버튼·스와이프가 값으로 읽으므로 아래 effect 보다 먼저 선언(선언 순서 주의)
  const go = (targetId: string | null) => {
    if (!targetId) return;
    if (mode === 'scroll') {
      const i = list.findIndex((e) => e.id === targetId);
      scrollApiRef.current?.scrollToIndex(i);
      showHistoryPreviewEntry(targetId);
    } else {
      showHistoryPreviewEntry(targetId);
    }
  };

  // 좌우 화살표로 이전/다음(PC). 미리 보기가 떠 있는 동안 전역 단축키는 KeyboardShortcutService 가 막으므로
  // (ShortcutGateState.historyPreviewOpen) 아래 화면의 이미지·씬 이동과 겹치지 않는다. 입력 칸 포커스 중·보조 키 조합은 무시.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (isTextEntryFocused() || appState.dialogs.length > 0) return;
      const target = e.key === 'ArrowLeft' ? prevId : nextId;
      e.preventDefault();
      go(target);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, prevId, nextId, mode]);

  if (!entry) return null;

  const { prev, next } = neighbors;
  // scene.mains 는 mobx 옵저버블 — 즐겨찾기 전환이 바로 반영된다
  const isFav = !!scene && scene.mains.includes(entry.filename);
  const caption = historyEntryCaption(entry, appState.curSession?.name);
  const prevEntry = prev ? list[index - 1] : undefined;
  const nextEntry = next ? list[index + 1] : undefined;

  const openGrid = async () => {
    await imageHistoryService.navigateTo(entry, { openGrid: true });
    closeHistoryPreview();
    // 크게 보기 창 위로 그리드가 쌓이면 그리드 단축키가 막히므로 함께 닫는다
    closeHistoryView();
  };

  return (
    <div
      className="fixed inset-0 titlebar-no-drag flex flex-col select-none"
      style={{ zIndex: 'var(--z-modal-top)', backgroundColor: 'rgba(0,0,0,0.8)' }}
      data-history-preview=""
      data-history-viewer-mode={mode}
      {...backdrop}
    >
      {/* 이미지 영역(첫 자식) — 한 장씩: 이미지 바깥(어두운 곳)을 누르면 닫힌다 / 세로 보기: 스크롤 영역 */}
      {mode === 'scroll' ? (
        <ScrollArea
          list={list}
          startIndex={index}
          onCurrent={(i) => {
            const e = list[i];
            if (e) showHistoryPreviewEntry(e.id);
          }}
          apiRef={scrollApiRef}
        />
      ) : (
        <SingleImageArea
          entry={entry}
          caption={caption}
          prevEntry={prevEntry}
          nextEntry={nextEntry}
          onStep={(d) => go(d > 0 ? nextId : prevId)}
          backdropProps={imageAreaBackdrop}
        />
      )}
      {/* 아래 막대: 캡션·순번 / 이전·다음·즐겨찾기 / 보기 방식 / 그리드에서 보기·닫기 */}
      <div className="flex-none flex flex-wrap items-center justify-center gap-2 mx-auto mb-3 px-3 py-2 max-w-[calc(100vw-16px)] rounded-xl border line-color bg-[var(--c-zone)] shadow-2xl">
        <div className="w-full md:w-auto md:max-w-[40vw] text-sm text-default truncate text-center">
          {caption}
          <span className="ml-2 text-sub tabular-nums" data-history-preview-position="">
            {HISTORY_VIEWER_TEXT.position(index + 1, list.length)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="relative icon-button icon-only touch-hit"
            aria-label="이전 이미지"
            title="이전 이미지"
            disabled={!prev}
            onClick={() => go(prev)}
          >
            <FaChevronLeft size={16} />
          </button>
          <button
            className="relative icon-button icon-only touch-hit"
            aria-label="다음 이미지"
            title="다음 이미지"
            disabled={!next}
            onClick={() => go(next)}
          >
            <FaChevronRight size={16} />
          </button>
          <button
            className="relative icon-button icon-only touch-hit"
            aria-label={isFav ? '즐겨찾기 해제' : '즐겨찾기'}
            title={isFav ? '즐겨찾기 해제' : '즐겨찾기'}
            aria-pressed={isFav}
            data-history-preview-fav=""
            onClick={() => imageHistoryService.toggleFavorite(entry)}
          >
            {isFav ? (
              <FaStar size={16} className="text-yellow-400" />
            ) : (
              <FaRegStar size={16} />
            )}
          </button>
          <div
            className="seg-group seg-sm flex flex-none"
            role="group"
            aria-label={HISTORY_VIEWER_TEXT.group}
            data-history-viewer-mode-switch=""
          >
            {VIEWER_MODES.map((m) => (
              <button
                key={m.mode}
                type="button"
                className={'seg-item text-sm' + (mode === m.mode ? ' seg-on' : '')}
                aria-pressed={mode === m.mode}
                aria-label={m.label}
                title={m.label}
                data-mode={m.mode}
                onClick={() => {
                  if (mode !== m.mode) setHistoryViewerMode(m.mode);
                }}
              >
                {m.icon}
                <span className="hidden md:inline">{m.label}</span>
              </button>
            ))}
          </div>
          <button className="round-button back-gray" onClick={openGrid}>
            이미지 그리드에서 보기
          </button>
          <button
            className="relative icon-button icon-only touch-hit"
            aria-label="닫기"
            title="닫기"
            onClick={closeHistoryPreview}
          >
            <FaTimes size={16} />
          </button>
        </div>
      </div>
    </div>
  );
});
