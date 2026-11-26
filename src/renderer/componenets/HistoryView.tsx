// 히스토리 「크게 보기」(2026-11-26 사용자 결정 — 히스토리 확대 2단계). 상태·거르기·칸 크기 규칙은 models/historyView.ts.
// · 여는 곳 = 히스토리 PC 패널·모바일 서랍 머리줄의 「크게 보기」 버튼(ImageHistory.tsx). 새 탭 없음.
// · 틀 = FloatView(✕·Esc·Android 뒤로 가기로 닫힘, 되돌리기 허용 창). App 에 한 번 마운트(열림 상태는 앱 전체 하나).
// · 본문 = react-window 가상 격자 — 칸 = 히스토리 칸(HistoryImageCell)의 정사각 모양(씬 이름·별 버튼·우클릭/길게 누르기 메뉴 그대로).
//   칸을 누르면 그 자리에서 뷰어(HistoryImagePreview)가 열리고, 넘겨 보기 범위 = 지금 거른 목록.
// · 머리줄(FloatView headerSlot) = 제목 「히스토리」 + 장수(거른 뒤 / 전체) + 거르기 두 개(켜고 끄는 버튼, 기억하지 않음).
// · 떠 있는 동안 아래 화면의 단축키는 막힌다(KeyboardShortcutService — 미리 보기와 같은 규칙, 되돌리기·다시 실행만 통과).
// · 등장 움직임 없음.
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { observer } from 'mobx-react-lite';
import { FixedSizeGrid, GridChildComponentProps } from 'react-window';
import { imageHistoryService, isMobile } from '../models';
import { appState } from '../models/AppService';
import { GenerationHistoryEntry } from '../models/ImageHistoryService';
import { historyEntryCaption, openHistoryPreview } from '../models/historyPreview';
import {
  closeHistoryView,
  filterHistoryEntries,
  HISTORY_VIEW_CAPTION,
  HISTORY_VIEW_MOBILE_DEFAULT_STEP,
  HISTORY_VIEW_MOBILE_STEPS,
  HISTORY_VIEW_TEXT,
  historyViewCountText,
  historyViewEmptyText,
  historyViewMobileCell,
  historyViewPcCell,
  historyViewState,
  setHistoryViewSizePercent,
} from '../models/historyView';
import { GenericScene } from '../models/types';
import { EmptyState } from './EmptyState';
import { FloatView, useFloatViewHeaderSlot } from './FloatView';
import { HistoryImageCell } from './ImageHistory';
import SizeSlider from './SizeSlider';
import { useElementSize } from './historyHooks';

/** 크게 보기 격자가 0 크기로 재일 때(배치 전·테스트 환경) 쓰는 크기 */
const HISTORY_VIEW_FALLBACK = { width: 800, height: 600 };
/** 칸 안쪽 여백(칸 사이) */
const CELL_PAD = 3;

interface ViewGridData {
  items: readonly GenerationHistoryEntry[];
  columnCount: number;
  thumb: number;
  curSessionName: string | undefined;
  open: (entry: GenerationHistoryEntry) => void;
}

const ViewGridCell = ({ columnIndex, rowIndex, style, data }: GridChildComponentProps<ViewGridData>) => {
  const entry = data.items[rowIndex * data.columnCount + columnIndex];
  if (!entry) return null;
  return (
    <div style={{ ...style, padding: CELL_PAD }}>
      <HistoryImageCell
        entry={entry}
        caption={historyEntryCaption(entry, data.curSessionName)}
        thumbSize={data.thumb}
        square
        onClick={() => data.open(entry)}
      />
    </div>
  );
};

/** 「즐겨찾기만」 판정용 씬 읽기 — 켠 동안만, 항목마다 한 번(같은 프로젝트는 ResourceSyncService.get 이 한 번만 읽음) */
function useFavoriteScenes(
  entries: readonly GenerationHistoryEntry[],
  active: boolean,
): Map<string, GenericScene | null> {
  const [scenes, setScenes] = useState<Map<string, GenericScene | null>>(() => new Map());
  const askedRef = useRef<Set<string>>(new Set());
  // 목록이 바뀌어도 진행 중인 판정은 버리지 않는다(같은 항목을 다시 묻지 않으므로) — 창이 닫힐 때만 버린다
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);
  useEffect(() => {
    if (!active) return;
    // 프로젝트별로 묶어 그 프로젝트의 판정이 끝나면 한 번에 채운다(판정된 것부터 보인다)
    const groups = new Map<string, GenerationHistoryEntry[]>();
    for (const e of entries) {
      if (askedRef.current.has(e.id)) continue;
      askedRef.current.add(e.id);
      const g = groups.get(e.sessionName);
      if (g) g.push(e);
      else groups.set(e.sessionName, [e]);
    }
    for (const group of groups.values()) {
      Promise.all(
        group.map((e) =>
          imageHistoryService
            .resolveQuiet(e)
            .then((r) => [e.id, r ? r.scene : null] as const)
            .catch(() => [e.id, null] as const),
        ),
      ).then((pairs) => {
        if (!aliveRef.current) return;
        setScenes((prev) => {
          const next = new Map(prev);
          for (const [id, scene] of pairs) next.set(id, scene);
          return next;
        });
      });
    }
  }, [entries, active]);
  return scenes;
}

const HistoryViewBody = observer(() => {
  const entries = imageHistoryService.entries;
  const curSessionName = appState.curSession?.name;
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [currentProjectOnly, setCurrentProjectOnly] = useState(false);
  const [mobileStep, setMobileStep] = useState<number>(HISTORY_VIEW_MOBILE_DEFAULT_STEP);
  const headerSlotEl = useFloatViewHeaderSlot();
  const containerRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(containerRef, HISTORY_VIEW_FALLBACK);
  const scenes = useFavoriteScenes(entries, favoritesOnly);

  // 판정 함수 — filterHistoryEntries 가 렌더 중 값으로 부르므로 먼저 선언(선언 순서 주의).
  // scene.mains 는 mobx 옵저버블이라 즐겨찾기를 바꾸면 바로 다시 거른다. 씬을 못 찾은 항목은 즐겨찾기 아님.
  const isFavorite = (e: GenerationHistoryEntry): boolean | undefined => {
    if (!scenes.has(e.id)) return undefined;
    const scene = scenes.get(e.id);
    return !!scene && scene.mains.includes(e.filename);
  };
  const { items, pending } = filterHistoryEntries(
    entries,
    { favoritesOnly, currentProjectOnly },
    curSessionName,
    isFavorite,
  );
  const emptyText = historyViewEmptyText(entries.length, items.length, pending);

  const { cell, thumb } = isMobile
    ? historyViewMobileCell(mobileStep, size.width)
    : historyViewPcCell(historyViewState.sizePercent);
  const columnCount = Math.max(1, Math.floor(size.width / cell));
  const rowHeight = cell + HISTORY_VIEW_CAPTION;
  // 칸을 누르면 그 자리에서 뷰어 — 넘겨 볼 범위 = 지금 거른 목록(연 때 고정)
  const openEntry = (entry: GenerationHistoryEntry) => {
    openHistoryPreview(
      entry.id,
      items.map((e) => e.id),
    );
  };

  const toggleClass = (on: boolean) =>
    'round-button flex-none text-xs md:text-sm ' + (on ? 'back-sky toggle-on' : 'back-gray');

  const header = (
    <div className="flex items-center gap-2 md:gap-3 w-full min-w-0 pr-2" data-history-view-header="">
      {/* 좁은 폭에서는 제목이 먼저 줄어든다(거르기 버튼·장수는 그대로) */}
      <span className="min-w-0 truncate font-semibold text-default">{HISTORY_VIEW_TEXT.title}</span>
      <span className="flex-none text-sub tabular-nums" data-history-view-count="">
        {historyViewCountText(items.length, entries.length)}
      </span>
      {favoritesOnly && pending > 0 && (
        <span className="flex-none text-xs text-faint truncate">{HISTORY_VIEW_TEXT.checkingCount(pending)}</span>
      )}
      <div className="flex-1 min-w-0 md:min-w-[8px]" />
      <button
        className={toggleClass(favoritesOnly)}
        aria-pressed={favoritesOnly}
        data-history-filter="favorites"
        onClick={() => setFavoritesOnly((v) => !v)}
      >
        {HISTORY_VIEW_TEXT.favoritesOnly}
      </button>
      <button
        className={toggleClass(currentProjectOnly)}
        aria-pressed={currentProjectOnly}
        data-history-filter="project"
        onClick={() => setCurrentProjectOnly((v) => !v)}
      >
        {HISTORY_VIEW_TEXT.currentProjectOnly}
      </button>
    </div>
  );

  return (
    <div className="relative w-full h-full flex flex-col bg-[var(--c-zone)]" data-history-view="">
      {headerSlotEl ? createPortal(header, headerSlotEl) : header}
      <div ref={containerRef} className="flex-1 min-h-0 flex justify-center">
        {emptyText ? (
          <EmptyState size="lg" className="w-full h-full select-none">
            {emptyText}
          </EmptyState>
        ) : (
          <FixedSizeGrid<ViewGridData>
            columnCount={columnCount}
            columnWidth={cell}
            rowCount={Math.ceil(items.length / columnCount)}
            rowHeight={rowHeight}
            width={Math.min(size.width, columnCount * cell + (isMobile ? 0 : 12))}
            height={size.height}
            overscanRowCount={isMobile ? 2 : 4}
            style={{ overflowX: 'hidden' }}
            itemData={{ items, columnCount, thumb, curSessionName, open: openEntry }}
            itemKey={({ columnIndex, rowIndex, data }) =>
              data.items[rowIndex * data.columnCount + columnIndex]?.id ?? `empty-${rowIndex}:${columnIndex}`
            }
          >
            {ViewGridCell}
          </FixedSizeGrid>
        )}
      </div>
      {/* 칸 크기 — 자리·평소 흐림은 이미지 그리드와 같다. PC = 슬라이더(이미지 그리드와 별개로 기억), 모바일 = S/M/L(기억 안 함) */}
      {!emptyText && (
        <div
          className="absolute gap-1 m-2 bottom-0 right-0 bg-[var(--c-surface-2)] p-1 opacity-30 hover:opacity-100 flex"
          data-history-view-size=""
        >
          {!isMobile && (
            <SizeSlider
              label={HISTORY_VIEW_TEXT.sizeLabel}
              value={historyViewState.sizePercent}
              onChange={setHistoryViewSizePercent}
            />
          )}
          {isMobile &&
            HISTORY_VIEW_MOBILE_STEPS.map((step, index) => (
              <button
                key={step.name}
                className={
                  'w-8 h-8 hover:brightness-95 active:brightness-90 cursor-pointer ' +
                  (mobileStep === index ? 'back-sky' : 'back-gray')
                }
                aria-pressed={mobileStep === index}
                onClick={() => setMobileStep(index)}
              >
                {step.name}
              </button>
            ))}
        </div>
      )}
    </div>
  );
});

export const HistoryView = observer(() => {
  if (!historyViewState.open) return null;
  return (
    <FloatView priority={1} allowUndo headerSlot onEscape={closeHistoryView}>
      <HistoryViewBody />
    </FloatView>
  );
});

export default HistoryView;
