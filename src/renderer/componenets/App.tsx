import './App.css';
import './contexify.css';
import {
  Component,
  ReactNode,
  useEffect,
  createContext,
  useState,
  useRef,
} from 'react';
import SessionSelect from './SessionSelect';
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
import { FaGlobe, FaImages, FaPenFancy } from 'react-icons/fa';
import ModalOverlay from './ModalOverlay';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { TouchBackend } from 'react-dnd-touch-backend';
import { usePreview } from 'react-dnd-preview';

import React from 'react';
import { CellPreview } from './ResultViewer';
import { SlotPiece } from './SceneEditor';
import EmbeddedBrowser from './EmbeddedBrowser';
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
import { AppContextMenu } from './AppContextMenu';

import { configure } from 'mobx';
import { ExternalImageView } from './ExternalImageView';
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
    const { scene, curSession, getImage, cellSize } = item as any;
    res = (
      <SceneCell
        scene={scene}
        curSession={curSession}
        getImage={getImage}
        cellSize={cellSize}
        style={style}
      />
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
      }
    };
    window.addEventListener('shortcut-action', handler);
    return () => window.removeEventListener('shortcut-action', handler);
  }, []);

  const [darkMode, setDarkMode] = useState(false);
  useEffect(() => {
    const refreshDarkMode = async () => {
      const conf = await backend.getConfig();
      setDarkMode(!conf.whiteMode);
      appState.classicSceneCard = conf.classicSceneCard ?? false;
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
      appState.setProgressDialog({
        text: '압축파일 생성 중..',
        done: progress.done,
        total: progress.total,
      });
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
      if (type === 'image/png' || type === 'image/jpeg' || type === 'image/webp') {
        return '이미지에서 프롬프트 메타데이터를 추출합니다';
      }
      if (type === 'application/json') {
        return '프로젝트 또는 프롬프트조각을 임포트합니다';
      }
      // type이 빈 문자열일 수 있음 — 파일 이름 확장자로 추정
      return null;
    };

    const handleDragEnter = (event: any) => {
      event.preventDefault();
      dragCounter.current++;
      if (dragCounter.current === 1) {
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
    }
    return () => {
      window.curSession = undefined;
    };
  }, [appState.curSession]);

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
    ...(!isMobile ? [{
      label: '웹 검색',
      content: <EmbeddedBrowser />,
      emoji: <FaGlobe />,
      banToggle: true,
    }] : []),
  ];
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
          'flex flex-col relative h-screen w-screen bg-white dark:bg-slate-900 ' +
          (darkMode ? 'dark' : '')
        }
      >
        <div className="z-[3000]">
          <DnDPreview />
        </div>
        <ErrorBoundary
          onErr={(error, errorInfo) => {
            appState.pushMessage(`${error.message}`);
          }}
        >
          <VerticalStack>
            <StackFixed>
              <TobBar />
            </StackFixed>
            <StackGrow className="relative">
              <FloatViewProvider>
                <AppContextMenu />
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
                <VerticalStack>
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
                    <div className="px-3 py-2 border-t flex gap-3 items-center line-color">
                      <div className="hidden md:block flex-1">
                        <SessionSelect />
                      </div>
                      <div className="flex flex-none gap-4 ml-auto">
                        <TaskQueueControl />
                      </div>
                    </div>
                  </StackFixed>
                </VerticalStack>
              </FloatViewProvider>
            </StackGrow>
          </VerticalStack>
        </ErrorBoundary>
        <AlertWindow />
        <ConfirmWindow />
        <ExpiredProjectsDialog />
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
        {dragOverlay && (
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center pointer-events-none"
            style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
          >
            <div className="bg-white dark:bg-slate-800 rounded-2xl px-8 py-6 shadow-2xl border-2 border-dashed border-sky-400 dark:border-sky-500 flex flex-col items-center gap-3">
              <svg className="w-12 h-12 text-sky-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v12m0 0l-4-4m4 4l4-4M4 18h16" />
              </svg>
              <p className="text-lg font-semibold text-gray-800 dark:text-gray-100">
                여기에 드랍하세요
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {dragOverlay}
              </p>
            </div>
          </div>
        )}
      </div>
    </DndProvider>
  );
});
