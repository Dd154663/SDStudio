import './App.css';
import './contexify.css';
import {
  Component,
  ReactNode,
  useEffect,
  createContext,
  useState,
  useRef,
  useCallback,
} from 'react';
import SessionSelect from './SessionSelect';
import ProjectDrawer from './ProjectDrawer';
import ProjectBrowser from './ProjectBrowser';
import { ImageHistoryPanel, ImageHistoryDrawer, ImageHistoryHandle } from './ImageHistory';
import QuickModeTab from './QuickModeTab';
import PreSetEditor from './PreSetEdtior';
import SceneQueuControl, { SceneCell } from './SceneQueueControl';
import TaskQueueControl from './TaskQueueControl';
import TobBar from './TobBar';
import AlertWindow from './AlertWindow';
import { DropdownSelect, TabComponent } from './UtilComponents';
import PieceEditor, { PieceCell } from './PieceEditor';
import PromptTooltip from './PromptTooltip';
import ConfirmWindow, { Dialog } from './ConfirmWindow';
import ExpiredProjectsDialog from './ExpiredProjectsDialog';
import QueueControl from './SceneQueueControl';
import { FloatView, FloatViewProvider } from './FloatView';
import { observer, useObserver } from 'mobx-react-lite';
import { FaGlobe, FaImages, FaPenFancy, FaStar, FaPalette, FaSearch, FaBolt } from 'react-icons/fa';
import { GlobalPresetTab, GlobalPresetPickerOverlay } from './GlobalPresetTab';
import ModalOverlay from './ModalOverlay';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { TouchBackend } from 'react-dnd-touch-backend';
import { usePreview } from 'react-dnd-preview';

import React from 'react';
import { CellPreview } from './ResultViewer';
import { SlotPiece } from './SceneEditor';
import EmbeddedBrowser from './EmbeddedBrowser';
import ArtistLibraryTab from './ArtistLibraryTab';
import { StackFixed, StackGrow, VerticalStack } from './LayoutComponents';
import ProgressWindow, { ProgressDialog } from './ProgressWindow';
import ResizableSplitter from './ResizableSplitter';
import {
  taskQueueService,
  backend,
  sessionService,
  appUpdateNoticeService,
  localAIService,
  imageService,
  isMobile,
} from '../models';
import { appState } from '../models/AppService';
import { keyboardShortcutService } from '../models/KeyboardShortcutService';
import { buildDanbooruSearchUrl } from '../models/util';
import { isImportImageMime } from '../models/imageFormats';
import { buildThemeVars } from '../models/uiTheme';
import { AppContextMenu } from './AppContextMenu';

import { configure } from 'mobx';
import { ExternalImageView } from './ExternalImageView';
import FindReplaceDialog from './FindReplaceDialog';
import ExportPresetManager from './ExportPresetManager';
configure({
  enforceActions: 'never',
});

interface ErrorBoundaryProps {
  children: ReactNode;
  onErr?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    if (this.props.onErr) {
      this.props.onErr(error, errorInfo);
    }
  }

  render() {
    return this.props.children;
  }
}

const DnDPreview = () => {
  const preview = usePreview();
  if (!preview.display) {
    return null;
  }
  const { itemType, item, style } = preview;
  style['rotate'] = '2deg';
  style['transformOrigin'] = 'center';
  let res: any = null;
  if (itemType === 'scene') {
    const { scene, curSession, getImage, cellSize, cardWidth, selectedSceneNames } = item as any;
    const sceneStyle = cardWidth
      ? { ...style, width: cardWidth + 'px' }
      : style;
    const count = selectedSceneNames?.length || 0;
    res = (
      <div style={{ position: 'relative' }}>
        <SceneCell
          scene={scene}
          curSession={curSession}
          getImage={getImage}
          cellSize={cellSize}
          style={sceneStyle}
        />
        {count > 1 && (
          <div
            style={{
              position: 'absolute',
              top: -4,
              right: -4,
              backgroundColor: '#0ea5e9',
              color: '#fff',
              borderRadius: '9999px',
              width: 20,
              height: 20,
              fontSize: 11,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
              zIndex: 10,
              boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
            }}
          >
            {count}
          </div>
        )}
      </div>
    );
  } else if (itemType === 'image') {
    const { path, cellSize, imageSize } = item as any;
    res = (
      <CellPreview
        path={path}
        cellSize={cellSize}
        imageSize={imageSize}
        style={style}
      />
    );
  } else if (itemType === 'piece') {
    res = <PieceCell {...(item as any)} style={style} />;
  } else if (itemType === 'slot') {
    res = <SlotPiece {...(item as any)} style={style} />;
  } else if (
    typeof itemType === 'string' &&
    itemType.startsWith('toolbar-btn/')
  ) {
    // 툴바 버튼 재배치 드래그 — 실제 버튼 노드 그대로(원래 너비 유지) 반투명 프리뷰
    const { name, node, width } = item as any;
    res = (
      <div
        className="pointer-events-none"
        style={{ ...style, ...(width ? { width } : {}), opacity: 0.85 }}
      >
        {node ?? (
          <div className="round-button back-sky shadow-xl">{name}</div>
        )}
      </div>
    );
  } else {
    return <></>;
  }
  return res;
};

export const App = observer(() => {
  useEffect(() => {
    return () => {
      taskQueueService.stop();
    };
  }, []);

  // 단축키 이벤트 수신
  useEffect(() => {
    const handler = (e: Event) => {
      const action = (e as CustomEvent).detail?.action;
      switch (action) {
        case 'toggle-left-panel':
          appState.toggleLeftPanel();
          break;
        case 'toggle-project-favorite':
          if (appState.curSession) {
            sessionService.toggleFavorite(appState.curSession.name).then(() => {
              const isFav = sessionService.isFavorite(appState.curSession!.name);
              appState.pushMessage(isFav ? '즐겨찾기에 추가되었습니다' : '즐겨찾기에서 제거되었습니다');
            });
          }
          break;
        case 'open-piece-editor':
          if (appState.curSession) {
            appState.openPieceEditor();
          }
          break;
        case 'find-replace':
          if (appState.curSession) {
            appState.openFindReplace();
          }
          break;
        case 'open-project-drawer':
          appState.projectDrawerOpen = !appState.projectDrawerOpen;
          break;
        case 'open-project-grid':
          appState.projectBrowserOpen = !appState.projectBrowserOpen;
          break;
        case 'toggle-history-panel':
          if (isMobile) {
            appState.historyDrawerOpen = !appState.historyDrawerOpen;
          } else {
            appState.toggleHistoryPanel();
          }
          break;
      }
    };
    window.addEventListener('shortcut-action', handler);
    return () => window.removeEventListener('shortcut-action', handler);
  }, []);

  const [darkMode, setDarkMode] = useState(false);
  const [trueDark, setTrueDark] = useState(false);
  const [themeOverrides, setThemeOverrides] = useState<Record<string, string>>(
    {},
  );
  useEffect(() => {
    const refreshDarkMode = async () => {
      const conf = await backend.getConfig();
      setDarkMode(!conf.whiteMode);
      setTrueDark(conf.trueDark ?? false);
      setThemeOverrides(buildThemeVars(conf.uiTheme, !!conf.whiteMode));
      appState.classicSceneCard = conf.classicSceneCard ?? false;
      appState.legacyProjectMode = conf.legacyProjectMode ?? false;
      appState.storageWriteGuard = conf.storageWriteGuard ?? true;
      appState.uiToolbar = conf.uiToolbar ?? {};
    };
    refreshDarkMode();
    sessionService.addEventListener('config-changed', refreshDarkMode);
    return () => {
      sessionService.removeEventListener('config-changed', refreshDarkMode);
    };
  }, []);
  useEffect(() => {
    const handleUpdate = () => {
      const latest = appUpdateNoticeService.latestVersion;
      if (appUpdateNoticeService.outdated && !appUpdateNoticeService.isDismissed(latest)) {
        appState.pushDialog({
          type: 'select',
          text: `새로운 버전(${latest})이 있습니다.\n새로 다운 받으시겠습니까?`,
          green: true,
          items: [
            { text: '다운로드 페이지 열기', value: 'open' },
            { text: '다시 알리지 않음', value: 'dismiss' },
          ],
          callback: (value?: string) => {
            if (value === 'open') {
              backend.openWebPage('https://github.com/Dd154663/SDStudio/releases');
            } else if (value === 'dismiss') {
              appUpdateNoticeService.dismissVersion(latest);
            }
          },
        });
      }
    };
    appUpdateNoticeService.addEventListener('updated', handleUpdate);
    return () => {
      appUpdateNoticeService.removeEventListener('updated', handleUpdate);
    };
  }, []);
  useEffect(() => {
    const removeDonwloadProgressListener = backend.onDownloadProgress(
      (progress: any) => {
        localAIService.notifyDownloadProgress(progress.percent);
      },
    );
    const removeZipProgressListener = backend.onZipProgress((progress: any) => {
      // exportProgress가 이미 클리어된 후 늦게 도착하는 이벤트 무시
      if (appState.exportProgress) {
        appState.exportProgress = {
          text: '압축파일 생성 중..',
          done: progress.done,
          total: progress.total,
        };
      }
    });
    const removeImageChangedListener = backend.onImageChanged(
      async (path: string) => {
        imageService.invalidateCache(path);
      },
    );
    const handleIPCheckFail = () => {
      appState.pushDialog({
        type: 'yes-only',
        text: '네트워크 변경을 감지하고 작업을 중단했습니다. 잦은 네트워크 변경은 계정 공유로 취급되어 밴의 위험이 있습니다. 이를 무시하고 싶으면 환경설정에서 "IP 체크 끄기"를 켜주세요.',
      });
    };
    taskQueueService.addEventListener('ip-check-fail', handleIPCheckFail);
    return () => {
      removeDonwloadProgressListener();
      removeImageChangedListener();
      removeZipProgressListener();
      taskQueueService.removeEventListener('ip-check-fail', handleIPCheckFail);
    };
  }, [appState.curSession]);

  const [dragOverlay, setDragOverlay] = useState<string | null>(null);
  const dragCounter = useRef(0);
  useEffect(() => {
    const getDropDescription = (dataTransfer: DataTransfer): string | null => {
      const items = dataTransfer.items;
      if (!items || items.length === 0) return null;
      const item = items[0];
      if (item.kind !== 'file') return null;
      const type = item.type;
      if (isImportImageMime(type)) {
        return '이미지에서 프롬프트 메타데이터를 추출합니다';
      }
      if (type === 'application/json') {
        return '프로젝트 또는 프롬프트조각을 임포트합니다';
      }
      // tar 백업(프로젝트/폴더). 드래그 중에는 보안상 파일명(dataTransfer.files)을 읽을 수 없고,
      // tar 의 MIME 도 환경마다 application/x-tar 또는 빈 문자열로 다르게 보고된다.
      // → MIME 타입 기준으로 안내(드롭 시 handleTarImport 가 폴더/프로젝트 백업을 정확히 구분).
      if (
        type === 'application/x-tar' ||
        type === 'application/x-gtar' ||
        type === 'application/tar' ||
        type === '' // 확장자/타입 미상 — tar 등 백업 파일 가능성
      ) {
        return '프로젝트 또는 폴더 백업을 불러옵니다';
      }
      return null;
    };

    const handleDragEnter = (event: any) => {
      event.preventDefault();
      dragCounter.current++;
      if (dragCounter.current === 1) {
        // 모달 오버레이가 열려 있으면 메타데이터 드래그 안내를 표시하지 않음
        if (appState.modalOverlayCount > 0) return;
        const desc = getDropDescription(event.dataTransfer);
        if (desc) {
          setDragOverlay(desc);
        }
      }
    };

    const handleDragOver = (event: any) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    };

    const handleDragLeave = (event: any) => {
      event.preventDefault();
      dragCounter.current--;
      if (dragCounter.current <= 0) {
        dragCounter.current = 0;
        setDragOverlay(null);
      }
    };

    const handleDrop = (event: any) => {
      event.preventDefault();
      event.stopPropagation();
      dragCounter.current = 0;
      setDragOverlay(null);
      // 모달 오버레이가 열려 있으면 메타데이터 처리도 차단
      if (appState.modalOverlayCount > 0) return;
      const file = event.dataTransfer.files[0];
      if (file) {
        appState.handleFile(file);
      }
    };
    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, [appState.curSession, appState.dialogs, appState.messages]);

  useEffect(() => {
    window.curSession = appState.curSession;
    if (appState.curSession) {
      sessionService.reloadPieceLibraryDB(appState.curSession);
      imageService.refreshBatch(appState.curSession);
      appState.cleanupOrphanedPresetApplication();
    }
    return () => {
      window.curSession = undefined;
    };
  }, [appState.curSession]);

  // 글로벌 프리셋 손상 복구 알림
  useEffect(() => {
    const handler = (e: any) => {
      const backupName = e.detail?.backupName;
      appState.pushDialog({
        type: 'yes-only',
        text:
          '글로벌 프리셋 파일이 손상되어 빈 상태로 초기화되었습니다.' +
          (backupName ? `\n\n백업: ${backupName}` : ''),
      });
    };
    window.globalPresetService?.addEventListener('corrupted', handler);
    return () => {
      window.globalPresetService?.removeEventListener('corrupted', handler);
    };
  }, []);

  const tabs = [
    {
      label: '이미지생성',
      content: <QueueControl type="scene" showPannel />,
      emoji: <FaImages />,
    },
    {
      label: '이미지변형',
      content: <QueueControl type="inpaint" showPannel />,
      emoji: <FaPenFancy />,
    },
    {
      label: '글로벌 프리셋',
      content: <GlobalPresetTab />,
      emoji: <FaStar />,
      banToggle: true,
    },
    {
      label: '작가 라이브러리',
      content: <ArtistLibraryTab />,
      emoji: <FaPalette />,
      banToggle: true,
    },
    {
      // NAI풍 즉시 생성 화면. banToggle 미설정 → 모바일에서 공용 "프롬프트 열기" 사용
      label: '퀵 생성',
      content: <QuickModeTab />,
      emoji: <FaBolt />,
    },
    ...(!isMobile ? [{
      label: '웹 검색',
      content: <EmbeddedBrowser />,
      emoji: <FaGlobe />,
      banToggle: true,
    }] : []),
  ];

  // 모바일: 선택 텍스트가 있을 때 화면 하단에 띄우는 'Danbooru 검색' 칩의 검색어
  const [danbooruSel, setDanbooruSel] = useState<string | null>(null);

  // 텍스트 드래그 → "Danbooru로 검색"
  const goDanbooruSearch = useCallback(
    (text: string) => {
      const url = buildDanbooruSearchUrl(text);
      if (!url) return;
      if (isMobile) {
        // 모바일: 기본 브라우저로 열기
        backend.openWebPage(url);
        return;
      }
      // PC: 앱 내 웹 검색 탭으로 전환 후 danbooru 검색 페이지로 이동
      window.dispatchEvent(
        new CustomEvent('danbooru-navigate', { detail: { url } }),
      );
      window.dispatchEvent(
        new CustomEvent('shortcut-action', {
          detail: { action: `tab-${tabs.length}` },
        }),
      );
    },
    [tabs.length],
  );

  useEffect(() => {
    // PC: 메인 프로세스 컨텍스트 메뉴에서 IPC로 선택 텍스트 전달
    const removeIpc = backend.onDanbooruSearch((text: string) =>
      goDanbooruSearch(text),
    );
    // 앱 내부(작가 라이브러리 카드 등)에서 직접 요청하는 danbooru 검색
    const handleRequest = (e: Event) => {
      const text = (e as CustomEvent).detail?.text;
      if (text) goDanbooruSearch(text);
    };
    window.addEventListener('danbooru-search-request', handleRequest);
    return () => {
      removeIpc();
      window.removeEventListener('danbooru-search-request', handleRequest);
    };
  }, [goDanbooruSearch]);

  // 모바일: 롱프레스로 텍스트를 선택하면 자동 검색하지 않고(네이티브 복사/붙여넣기 메뉴 보존),
  // 선택 영역 근처에 'Danbooru 검색' 버튼을 띄워 사용자가 명시적으로 탭할 때만 검색한다.
  // selectionchange는 일부 안드로이드 WebView에서 신뢰도가 낮아, contextmenu(롱프레스)·
  // touchend(손 뗀 직후)도 함께 트리거로 사용한다.
  useEffect(() => {
    if (!isMobile) return;
    const update = () => {
      // 모바일 프롬프트 에디터는 실제 <textarea>(NativeEditTextArea)이므로 선택 텍스트는
      // window.getSelection()이 아니라 textarea.value의 selectionStart~End 구간에 있다.
      const el = document.activeElement as HTMLTextAreaElement | null;
      let text = '';
      if (
        el &&
        (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') &&
        el.selectionStart != null &&
        el.selectionEnd != null &&
        el.selectionEnd > el.selectionStart
      ) {
        text = (el.value || '')
          .substring(el.selectionStart, el.selectionEnd)
          .trim();
      } else {
        // contenteditable 등(혹시 다른 입력 영역)
        const selection = window.getSelection?.();
        const t = selection?.toString().trim() ?? '';
        if (selection && !selection.isCollapsed && t) text = t;
      }
      setDanbooruSel(text && buildDanbooruSearchUrl(text) ? text : null);
    };
    // contextmenu는 preventDefault 하지 않는다(네이티브 선택 메뉴 보존).
    document.addEventListener('selectionchange', update);
    document.addEventListener('contextmenu', update);
    document.addEventListener('touchend', update);
    // 키보드 표시/숨김(visualViewport 변화) 시 칩 위치를 다시 계산해 키보드 위에 유지.
    const vv = window.visualViewport;
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    return () => {
      document.removeEventListener('selectionchange', update);
      document.removeEventListener('contextmenu', update);
      document.removeEventListener('touchend', update);
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
    };
  }, []);

  return (
    <DndProvider
      backend={isMobile ? TouchBackend : HTML5Backend}
      options={{
        enableTouchEvents: true,
        enableMouseEvents: false,
        delayTouchStart: 400,
      }}
    >
      <div
        className={
          'flex flex-col relative h-screen w-screen ' +
          (darkMode ? 'dark' : '') + (trueDark && darkMode ? ' true-dark' : '')
        }
        style={
          {
            backgroundColor: 'var(--c-surface)',
            ...themeOverrides,
          } as React.CSSProperties
        }
      >
        <div className="z-[3000]">
          <DnDPreview />
        </div>
        {isMobile && danbooruSel && (
          <button
            data-danbooru-search-btn
            className="fixed z-[6000] left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gray-900/95 text-gray-50 text-sm font-medium border border-white/10 shadow-xl backdrop-blur-sm whitespace-nowrap select-none active:scale-95 transition-transform"
            style={{
              // visualViewport로 키보드 높이를 인식해 키보드 바로 위에 배치(없으면 화면 하단).
              bottom:
                (window.visualViewport
                  ? Math.max(
                      0,
                      window.innerHeight -
                        window.visualViewport.height -
                        window.visualViewport.offsetTop,
                    )
                  : 0) + 16,
            }}
            // pointerdown에서 선택 해제/포커스 이동을 막고 검색을 실행한다(탭 즉시 선택이
            // 사라지면 click 전에 버튼이 언마운트될 수 있으므로 pointerdown 사용).
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const text = danbooruSel;
              // 검색 후 버튼이 다시 뜨지 않도록 활성 textarea 선택을 접는다.
              const el = document.activeElement as HTMLTextAreaElement | null;
              if (
                el &&
                (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') &&
                el.selectionStart != null
              ) {
                try {
                  el.setSelectionRange(el.selectionStart, el.selectionStart);
                } catch {}
              }
              setDanbooruSel(null);
              goDanbooruSearch(text);
            }}
          >
            <FaSearch size={12} className="opacity-80" />
            <span>Danbooru 검색</span>
            <span className="max-w-[40vw] truncate text-sky-300/90 font-normal">
              {danbooruSel}
            </span>
          </button>
        )}
        <ErrorBoundary
          onErr={(error, errorInfo) => {
            appState.pushMessage(`${error.message}`);
          }}
        >
          {/* 부팅 게이트: bootstrapApp() 완료 전에는 메인 UI 를 마운트하지 않아
              "서비스 준비 전 사용" 류 race 를 원천 차단한다 (완료 후 항상 열림) */}
          {!appState.bootReady ? (
            <div className="flex-1 h-full w-full flex flex-col items-center justify-center gap-3">
              <div className="w-8 h-8 rounded-full border-2 border-[color:var(--c-line)] border-t-sky-500 animate-spin" />
              <div className="text-sub text-sm whitespace-pre-line text-center px-6">
                {appState.bootStatusMessage || 'SDStudio 시작 중…'}
              </div>
            </div>
          ) : (
          <VerticalStack>
            {!isMobile && (
              <StackFixed>
                <TobBar />
              </StackFixed>
            )}
            <StackGrow className="flex">
              {/* FloatView가 덮는 범위를 이 relative 컨테이너로 한정 —
                  우측 히스토리 패널은 형제라서 어떤 FloatView가 떠도 항상 접근 가능 */}
              <div className="relative flex-1 min-w-0 h-full">
              <FloatViewProvider>
                <AppContextMenu />
                <ProjectDrawer />
                {isMobile && <ImageHistoryDrawer />}
                {isMobile && <ImageHistoryHandle />}
                {appState.projectBrowserOpen && (
                  <ProjectBrowser
                    onClose={() => {
                      appState.projectBrowserOpen = false;
                    }}
                  />
                )}
                <div className="h-full w-full flex flex-col overflow-hidden">
                  {isMobile && <div className="flex-none"><TobBar /></div>}
                  <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                    <StackGrow className="flex">
                      {appState.curSession && (
                        <>
                          {!appState.leftPanelCollapsed && (
                            <div
                              style={{ width: appState.leftPanelWidth, minWidth: 250 }}
                              className="flex-none overflow-hidden hidden md:block h-full"
                            >
                              <div className="h-full w-full overflow-hidden">
                                <PreSetEditor
                                  key={appState.curSession.name}
                                  middlePromptMode={false}
                                />
                              </div>
                            </div>
                          )}
                          <div className="flex-none hidden md:flex">
                            <ResizableSplitter />
                          </div>
                          <StackGrow>
                            <TabComponent
                              key={appState.curSession.name}
                              tabs={tabs}
                              toggleView={
                                <PreSetEditor
                                  key={appState.curSession.name + '2'}
                                  middlePromptMode={false}
                                />
                              }
                            />
                          </StackGrow>
                        </>
                      )}
                    </StackGrow>
                    <StackFixed>
                      <div
                        className="px-3 pt-2 border-t flex gap-3 items-center line-color"
                        style={{
                          // 제스처바가 있는 기기에서 실행/중지 버튼이 바에 가리지 않도록
                          // 기존 하단 여백(0.5rem)에 safe-area 를 더한다(inset 0이면 기존과 동일).
                          paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))',
                        }}
                      >
                        <div className="hidden md:block flex-1">
                          <SessionSelect />
                        </div>
                        <div className="flex flex-none gap-4 ml-auto">
                          <TaskQueueControl />
                        </div>
                      </div>
                    </StackFixed>
                  </div>
                </div>
                {appState.externalImage && (
                  <FloatView
                    onEscape={() => {
                      appState.closeExternalImage();
                    }}
                    priority={1}
                  >
                    <ExternalImageView
                      image={appState.externalImage}
                      onClose={() => {
                        appState.closeExternalImage();
                      }}
                    />
                  </FloatView>
                )}
              </FloatViewProvider>
              </div>
              <ImageHistoryPanel />
            </StackGrow>
          </VerticalStack>
          )}
        </ErrorBoundary>
        {/* 내보내기 진행 플로팅 위젯 (비차단형) */}
        {appState.exportProgress && (
          <div className="fixed bottom-16 right-4 z-[1000] bg-[var(--c-surface-2)] rounded-lg shadow-xl border line-color p-3 min-w-[220px]">
            <div className="text-sm font-medium text-default mb-1.5">
              💾 {appState.exportProgress.text}
            </div>
            <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-sky-500 rounded-full transition-all"
                style={{ width: `${(appState.exportProgress.done / Math.max(appState.exportProgress.total, 1)) * 100}%` }}
              />
            </div>
            <div className="text-xs text-muted mt-1">
              {appState.exportProgress.done}/{appState.exportProgress.total}
            </div>
          </div>
        )}
        <AlertWindow />
        <ConfirmWindow />
        <ExpiredProjectsDialog />
        <GlobalPresetPickerOverlay />
        {appState.progressDialog && (
          <ProgressWindow dialog={appState.progressDialog} />
        )}
        <PromptTooltip />
        <ModalOverlay
          isOpen={appState.pieceEditorOpen}
          onClose={() => appState.closePieceEditor()}
          title="프롬프트조각"
          width="max-w-3xl"
        >
          {appState.curSession && <PieceEditor />}
        </ModalOverlay>
        <FindReplaceDialog />
        <ExportPresetManager />
        {dragOverlay && (
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center pointer-events-none"
            style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
          >
            <div className="bg-[var(--c-surface-2)] rounded-2xl px-8 py-6 shadow-2xl border-2 border-dashed border-sky-400 dark:border-sky-500 flex flex-col items-center gap-3">
              <svg className="w-12 h-12 text-sky-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v12m0 0l-4-4m4 4l4-4M4 18h16" />
              </svg>
              <p className="text-lg font-semibold text-default">
                여기에 드랍하세요
              </p>
              <p className="text-sm text-muted">
                {dragOverlay}
              </p>
            </div>
          </div>
        )}
      </div>
    </DndProvider>
  );
});
