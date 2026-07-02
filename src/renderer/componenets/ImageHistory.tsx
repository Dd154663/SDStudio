import React, { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useContextMenu } from 'react-contexify';
import { FaChevronLeft, FaChevronRight, FaTimes } from 'react-icons/fa';
import { imageHistoryService, imageService, isMobile } from '../models';
import { GenerationHistoryEntry } from '../models/ImageHistoryService';
import { appState } from '../models/AppService';
import { ContextMenuType } from '../models/types';
import Tooltip from './Tooltip';

// 최근 생성 이미지 히스토리 사이드바.
// PC: 우측 밀어내기(push) 패널 — 펼치면 중앙 영역이 그만큼 줄어듦.
// 모바일: 우측 오버레이 드로어 (ProjectDrawer의 우측 미러).

const HistoryImageCell = ({
  entry,
  caption,
  onClick,
}: {
  entry: GenerationHistoryEntry;
  caption: string;
  onClick: () => void;
}) => {
  const [image, setImage] = useState<string | undefined>(undefined);
  const { show } = useContextMenu({ id: ContextMenuType.HistoryImage });

  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        const base64 = await imageService.fetchImageSmall(entry.path, 200);
        if (canceled) return;
        if (!base64) {
          // 파일이 사라진 항목은 히스토리에서 제거
          imageHistoryService.remove(entry.id);
          return;
        }
        setImage(base64);
      } catch (e) {
        if (!canceled) imageHistoryService.remove(entry.id);
      }
    })();
    return () => {
      canceled = true;
    };
  }, [entry.path]);

  return (
    <div
      className="flex flex-col cursor-pointer select-none hover:brightness-95 active:brightness-90"
      onClick={onClick}
      onContextMenu={(e) => {
        show({
          event: e,
          props: { ctx: { type: 'history_image', entry } },
        });
      }}
    >
      <div className="w-full aspect-square rounded overflow-hidden bg-[var(--c-input-bg)] flex items-center justify-center">
        {image && (
          <img
            src={image}
            draggable={false}
            className="w-full h-full object-cover"
          />
        )}
      </div>
      <div className="text-[10px] text-faint truncate text-center leading-tight mt-0.5 mb-1">
        {caption}
      </div>
    </div>
  );
};

// PC/모바일 공용 목록 (2열 그리드, 최신순)
const HistoryList = observer(() => {
  const entries = imageHistoryService.entries;

  const onClickEntry = (entry: GenerationHistoryEntry) => {
    // 이미지 그리드(ResultViewer)가 떠 있으면 그리드로, 아니면 씬 카드 스크롤로
    const openGrid = appState.resultViewerOpen;
    if (isMobile) appState.historyDrawerOpen = false;
    imageHistoryService.navigateTo(entry, { openGrid });
  };

  if (entries.length === 0) {
    return (
      <div className="flex-1 p-4 text-xs text-faint text-center">
        아직 생성된 이미지가 없습니다
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-y-auto p-2 grid grid-cols-2 gap-1.5 content-start">
      {entries.map((entry) => (
        <HistoryImageCell
          key={entry.id}
          entry={entry}
          caption={
            entry.sessionName !== appState.curSession?.name
              ? `${entry.sessionName}/${entry.sceneName}`
              : entry.sceneName
          }
          onClick={() => onClickEntry(entry)}
        />
      ))}
    </div>
  );
});

// PC 우측 밀어내기 패널 (+ 항상 보이는 접기/펼치기 스트립)
export const ImageHistoryPanel = observer(() => {
  const collapsed = appState.historyPanelCollapsed;
  return (
    <div className="flex-none hidden md:flex h-full flex-row">
      <div
        className={
          'flex-none w-5 flex flex-col items-center border-l line-color ' +
          (collapsed ? 'cursor-pointer' : '')
        }
        onClick={collapsed ? () => appState.toggleHistoryPanel() : undefined}
      >
        <Tooltip content={collapsed ? '히스토리 펼치기' : '히스토리 접기'}>
          <button
            className="splitter-toggle-btn"
            onClick={(e) => {
              e.stopPropagation();
              appState.toggleHistoryPanel();
            }}
          >
            {collapsed ? (
              <FaChevronLeft size={10} />
            ) : (
              <FaChevronRight size={10} />
            )}
          </button>
        </Tooltip>
      </div>
      {!collapsed && (
        <div
          className="flex flex-col h-full border-l line-color bg-[var(--c-surface-2)]"
          style={{ width: 240 }}
        >
          <div className="flex-none px-3 py-2 border-b line-color text-sm font-semibold gray-label">
            히스토리
          </div>
          <HistoryList />
        </div>
      )}
    </div>
  );
});

// 모바일 우측 가장자리 손잡이 — 어떤 FloatView/모달 위에서도 항상 보이는 드로어 진입점
export const ImageHistoryHandle = observer(() => {
  if (appState.historyDrawerOpen) return null;
  return (
    <button
      className="fixed right-0 top-1/2 -translate-y-1/2 md:hidden flex items-center justify-center w-6 h-14 rounded-l-md border border-r-0 line-color bg-[var(--c-surface-2)] opacity-70 active:opacity-100"
      style={{ zIndex: 2200 }}
      onClick={() => {
        appState.historyDrawerOpen = true;
      }}
    >
      <FaChevronLeft size={11} className="text-faint" />
    </button>
  );
});

// 모바일 우측 오버레이 드로어 (ProjectDrawer의 애니메이션 패턴 미러)
export const ImageHistoryDrawer = observer(() => {
  const open = appState.historyDrawerOpen;
  const [render, setRender] = useState(open);
  const [shown, setShown] = useState(open);

  useEffect(() => {
    if (open) {
      setRender(true);
      const id = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(id);
    } else {
      setShown(false);
      const t = setTimeout(() => setRender(false), 260);
      return () => clearTimeout(t);
    }
  }, [open]);

  if (!render) return null;
  return (
    <div
      className="fixed inset-0 titlebar-no-drag"
      style={{ zIndex: 2100 }}
      onClick={() => {
        appState.historyDrawerOpen = false;
      }}
    >
      <div
        className="absolute inset-0"
        style={{
          backgroundColor: 'rgba(0,0,0,0.35)',
          opacity: shown ? 1 : 0,
          transition: 'opacity 0.26s ease',
        }}
      />
      <div
        className="absolute right-0 top-0 h-full w-[80vw] max-w-[360px] bg-[var(--c-zone)] shadow-2xl border-l line-color flex flex-col"
        style={{
          transform: shown ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.26s cubic-bezier(0.4, 0, 0.2, 1)',
          willChange: 'transform',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b line-color flex-none">
          <h2 className="text-lg font-semibold text-default">히스토리</h2>
          <button
            className="icon-button"
            onClick={() => {
              appState.historyDrawerOpen = false;
            }}
          >
            <FaTimes size={18} />
          </button>
        </div>
        <HistoryList />
      </div>
    </div>
  );
});
