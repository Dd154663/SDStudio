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
import ProjectDrawer, { ProjectDrawerHandle } from './ProjectDrawer';
import ProjectSideBar from './ProjectSideBar';
import ProjectBrowser from './ProjectBrowser';
import { ImageHistoryPanel, ImageHistoryDrawer, ImageHistoryHandle } from './ImageHistory';
import QuickModeTab from './QuickModeTab';
import PreSetEditor from './PreSetEdtior';
import SceneQueuControl, { SceneCell } from './SceneQueueControl';
import BottomBar from './BottomBar';
import { GenControlFloating } from './GenControlWidget';
import EditModeShell from './EditModeShell';
import { resolveLayout, dockOrder, DOCK_RANK } from '../models/layoutTemplates';
import TobBar from './TobBar';
import AlertWindow from './AlertWindow';
import { DropdownSelect, TabComponent } from './UtilComponents';
import PieceEditor, { PieceCell } from './PieceEditor';
import { CharacterPresetFloatEditor } from './CharacterPresetEditor';
import PromptTooltip from './PromptTooltip';
import ConfirmWindow, { Dialog } from './ConfirmWindow';
import ExpiredProjectsDialog from './ExpiredProjectsDialog';
import MigrationGate from './MigrationGate';
import QueueControl from './SceneQueueControl';
import {
  FloatView,
  FloatViewProvider,
  FLOAT_VIEW_WIDE_ANCHOR_ID,
} from './FloatView';
import { observer, useObserver } from 'mobx-react-lite';
import { FaGlobe, FaImages, FaPenFancy, FaStar, FaPalette, FaSearch, FaBolt } from 'react-icons/fa';
import { GlobalPresetTab, GlobalPresetPickerOverlay } from './GlobalPresetTab';
import ModalOverlay from './ModalOverlay';
import { ProjectTrashView } from './SessionSelect';
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
      appState.legacySceneEditor = conf.legacySceneEditor ?? false;
      appState.legacyWorkflowMode = conf.legacyWorkflowMode ?? false;
      appState.sceneToolbarLegacyText = conf.sceneToolbarLegacyText ?? false;
      // 조합 에디터 뷰: 미설정 시 데스크톱=카드·모바일=목록(모바일 편집 편의).
      appState.uiCombinationView =
        conf.uiCombinationView ?? (isMobile ? 'list' : 'card');
      appState.storageWriteGuard = conf.storageWriteGuard ?? true;
      appState.uiToolbar = conf.uiToolbar ?? {};
      appState.uiPresetLayout = conf.uiPresetLayout ?? {};
      appState.uiCompanionSlots = conf.uiCompanionSlots ?? {};
      appState.uiLayoutTemplate = conf.uiLayoutTemplate ?? 'classic';
      appState.genWidget = conf.genWidget ?? {};
      appState.uiLayoutSlots = conf.uiLayoutSlots ?? {};
      appState.uiFloatViewMode = conf.uiFloatViewMode ?? 'cover';
      appState.uiFont = conf.uiFont ?? 'system';
      appState.uiClassicFinish = conf.uiClassicFinish ?? false;
      appState.allowDuplicateProjectOpen = conf.allowDuplicateProjectOpen ?? false;
    };
    refreshDarkMode();
    sessionService.addEventListener('config-changed', refreshDarkMode);
    return () => {
      sessionService.removeEventListener('config-changed', refreshDarkMode);
    };
  }, []);
  // 글꼴 옵션(환경설정 → 개인 설정) 적용 — 'pretendard'면 html 에 클래스를 얹어
  // 번들 글꼴로 전환한다(App.css 의 html.font-pretendard, 기본=시스템 스택).
  useEffect(() => {
    document.documentElement.classList.toggle(
      'font-pretendard',
      appState.uiFont === 'pretendard',
    );
  }, [appState.uiFont]);
  // 클래식 마감 옵션(환경설정 → 개인 설정) 적용 — 켜면 html 에 클래스를 얹어
  // 심미 개편 전 모양으로 복원한다(App.css 의 html.finish-classic 토큰 오버라이드).
  useEffect(() => {
    document.documentElement.classList.toggle(
      'finish-classic',
      appState.uiClassicFinish,
    );
  }, [appState.uiClassicFinish]);
  // 부팅 경고: 지정한 저장 경로에 접근할 수 없어 기본 위치로 폴백해 실행 중이면
  // 사용자에게 안내한다(설정에서 경로를 쓰기 가능한 위치로 재지정 유도). 이 안내가
  // 없으면 사용자는 저장 경로가 조용히 무시된 사실을 모른다.
  useEffect(() => {
    (async () => {
      const warnings = await backend.getBootWarnings();
      const fb = warnings?.saveLocationFallback;
      if (!fb) return;
      appState.pushDialog({
        type: 'yes-only',
        text:
          `지정한 저장 경로에 접근할 수 없어(${fb.code}) 기본 위치에서 실행 중입니다.\n\n` +
          `경로: ${fb.attempted}\n\n` +
          `환경설정 → 이미지에서 저장 위치를 쓰기 가능한 폴더로 다시 지정한 뒤 프로그램을 껐다 켜주세요. ` +
          `해당 드라이브의 쓰기 권한을 먼저 확인하는 것도 방법입니다.`,
      });
    })();
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

  // 레이아웃 템플릿 해석은 렌더당 1회 — observer 라 uiLayoutTemplate 변경 시 자동 재렌더된다.
  // 모바일은 resolveLayout 내부에서 항상 classic('bottom') 강제.
  const resolvedLayout = resolveLayout(
    appState.uiLayoutTemplate,
    isMobile,
    appState.uiLayoutSlots,
  );
  const bottomBarPlacement = resolvedLayout.bottomBar;

  // 슬롯 기반 좌/우 전환은 CSS order 유틸로만 처리한다(SPEC_GUIDE §6-2 계약).
  // DOM 순서·부모·key 는 절대 바꾸지 않아 콘텐츠 상태 유실(재마운트)을 막는다.
  //  - 중앙 콘텐츠: 항상 order-2 고정
  //  - 왼쪽(기본): 프리셋 order-1, 스플리터 order-1(동순위 → DOM 순서상 프리셋 뒤=사이),
  //    결과 프리셋 | 스플리터 | 중앙.
  //  - 오른쪽: 프리셋 order-4, 스플리터 order-3 → 중앙(2) | 스플리터(3) | 프리셋(4).
  //    스플리터는 항상 프리셋의 "중앙 쪽" 모서리에 인접(스플리터·프리셋 형제 관계 유지).
  //  - 히스토리 패널: 바깥 행에서 별도 처리(아래 ImageHistoryPanel order 참고)
  // 모바일에서는 프리셋 패널/스플리터가 md:hidden·md:flex 로 미렌더되므로 order 는 영향 없음.
  const presetRight = resolvedLayout.presetSide === 'right';
  // 프리셋 도크(패널+스플리터)는 바깥 flex 레벨의 형제로 배치되고, 좌/우는 이 래퍼의
  // CSS order 로만 바뀐다(아래 배치부). 도크 내부는 스플리터가 항상 "중앙 쪽" 모서리에
  // 오도록 방향을 뒤집는다(reversed 로 드래그 델타·접기 화살표도 반전).
  const presetDock = appState.curSession ? (
    <div
      className={
        // zone-card(아래 패널): 구역 카드화 마감(App.css) — 캔버스 배경은 도크 행이 담당
        'flex-none hidden md:flex h-full ' +
        (presetRight ? 'flex-row-reverse' : 'flex-row')
      }
      style={{ order: dockOrder(resolvedLayout.presetSide, DOCK_RANK.preset) }}
    >
      {!appState.leftPanelCollapsed && (
        <div
          data-slot="preset"
          // panel-vw-clamp(App.css): 좁은 창(<1024, W6 후속)에서만 뷰포트 비례
          // 상한을 걸어 좌우 패널이 중앙을 완전히 삼키지 않게 한다. 저장된 폭은
          // 그대로라 창을 넓히면 복원. (min-width 250 이 상한보다 우선)
          style={{ width: appState.leftPanelWidth, minWidth: 250 }}
          className="panel-vw-clamp zone-card flex-none overflow-hidden h-full"
        >
          <div className="h-full w-full overflow-hidden">
            <PreSetEditor
              key={appState.curSession.name}
              middlePromptMode={false}
            />
          </div>
        </div>
      )}
      {/* 접힌 동안엔 항상 존재하는 스플리터를 편집 배지 마커로 대신 쓴다
          (펼친 상태에선 위 프리셋 div 가 마커라 여기엔 부여하지 않음 — 중복 방지). */}
      <div
        data-slot={appState.leftPanelCollapsed ? 'preset' : undefined}
        className="flex-none flex"
      >
        <ResizableSplitter reversed={presetRight} />
      </div>
    </div>
  ) : null;

  // 중앙 탭 콘텐츠만 담는다(프리셋·스플리터는 presetDock 로 분리됨 — 리마운트 방지 위해
  // key·부모 체인은 그대로 유지).
  const mainStackContent = (
    <StackGrow className="flex">
      {appState.curSession && (
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
      )}
    </StackGrow>
  );

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
        <div className="z-[var(--z-dnd-preview)]">
          <DnDPreview />
        </div>
        {isMobile && danbooruSel && (
          <button
            data-danbooru-search-btn
            className="fixed z-[var(--z-kbd-action)] left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gray-900/95 text-gray-50 text-sm font-medium border border-white/10 shadow-xl backdrop-blur-sm whitespace-nowrap select-none active:scale-95 transition-transform"
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
            {/* zone-canvas: 구역 카드화(D) — 도크 행을 캔버스 배경+여백으로, 각 구역은
                zone-card 로 라운딩 카드화(App.css, PC 새 마감 전용). 클래식/모바일 무변화. */}
            <StackGrow className="zone-canvas flex">
              {/* 도크 행: [히스토리 도크]와 [넓은 앵커(프로젝트/프리셋/중앙)]가 형제다.
                  FloatView 가 덮는 범위는 창 배치 옵션(uiFloatViewMode)에 따른다 —
                  'cover'(기본)는 넓은 앵커에 포털로 붙어 프로젝트/프리셋 패널 위까지
                  덮고, 히스토리 도크는 앵커 밖(형제)이라 뷰어 옆에 그대로 남아 항상
                  접근 가능(v4.14.0 동작). 'center'는 중앙 콘텐츠 블록만 덮는다.
                  좌/우 배치는 각 래퍼의 CSS order(dockOrder)로만 바꾼다 —
                  DOM 순서·부모·key 는 불변(재마운트 방지). 같은 쪽이면 가장자리부터
                  프로젝트<프리셋 순으로 겹치고(rank 강제), 히스토리는 앵커 밖이라
                  같은 쪽에 두면 항상 최외곽(가장자리 쪽)에 온다. */}
              {/* 넓은 앵커 — 창 배치 'cover' 오버레이의 경계. order 0 (히스토리 도크의
                  ±1 과 경쟁해 좌/우가 정해진다). */}
              <div
                id={FLOAT_VIEW_WIDE_ANCHOR_ID}
                className="relative flex-1 min-w-0 h-full flex"
                style={{ order: 0 }}
              >
              {/* 프로젝트 사이드 바(PC): 'sidebar' 템플릿에서만. 세션이 없어도 렌더. */}
              {!isMobile && resolvedLayout.projectSidebar && (
                <div
                  data-slot="project"
                  className="flex-none hidden md:flex h-full"
                  style={{
                    order: dockOrder(resolvedLayout.projectSide, DOCK_RANK.project),
                  }}
                >
                  <ProjectSideBar side={resolvedLayout.projectSide} />
                </div>
              )}
              {/* 프리셋 도크(PC) — 패널+스플리터 */}
              {presetDock}
              {/* 중앙 콘텐츠 블록(콘텐츠+FloatView+오버레이 드로어들) — order 0 */}
              <div
                className="zone-card relative flex-1 min-w-0 h-full"
                style={{ order: 0 }}
              >
              <FloatViewProvider>
                <AppContextMenu />
                <ProjectDrawer />
                {isMobile && <ImageHistoryDrawer />}
                {isMobile && <ImageHistoryHandle />}
                {isMobile && resolvedLayout.projectSidebar && <ProjectDrawerHandle />}
                {appState.projectBrowserOpen && (
                  <ProjectBrowser
                    onClose={() => {
                      appState.projectBrowserOpen = false;
                    }}
                  />
                )}
                <div className="h-full w-full flex flex-col overflow-hidden">
                  {isMobile && <div className="flex-none"><TobBar /></div>}
                  {/* 하단바(bottom)는 PC 에선 이 중앙 블록 밖(VerticalStack 최하단)에서
                      전폭으로 렌더된다 — 좌/우 도크 펼침과 무관하게 항상 하단 전체를
                      차지(클래식 복원). 모바일은 도크가 없어 전폭이 동일하므로 기존
                      위치(FloatView 가 덮는 영역 안)를 유지한다. */}
                  <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                    {mainStackContent}
                    {isMobile && bottomBarPlacement !== 'none' && (
                      <BottomBar
                        placement={bottomBarPlacement}
                        genControl={resolvedLayout.genControl}
                        projectSidebar={resolvedLayout.projectSidebar}
                      />
                    )}
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
              </div>
              {/* 히스토리 도크 — 넓은 앵커 밖(행 직속 형제)이라 창 배치 'cover'의
                  뷰어가 떠도 옆에 그대로 남아 항상 접근 가능. 좌/우는 dockOrder(rank 3,
                  앵커의 order 0 과 경쟁해 ±1)로만. 래퍼 상시 존재라 패널 인스턴스
                  재마운트 없음. hidden md:flex 라 모바일은 기존대로 미렌더. */}
              <div
                data-slot="history"
                className="flex-none hidden md:flex h-full"
                style={{
                  order: dockOrder(resolvedLayout.historySide, DOCK_RANK.history),
                }}
              >
                <ImageHistoryPanel />
              </div>
            </StackGrow>
            {/* PC 하단바: 도크 행(StackGrow)의 형제 — 좌/우 패널 상태와 무관하게
                항상 창 전폭을 꽉 채운다. FloatView 는 어느 창 배치에서도 도크 행
                밖을 덮지 않으므로 뷰어가 떠 있어도 하단바는 접근 가능. */}
            {!isMobile && bottomBarPlacement !== 'none' && (
              <BottomBar
                placement={bottomBarPlacement}
                genControl={resolvedLayout.genControl}
                projectSidebar={resolvedLayout.projectSidebar}
              />
            )}
          </VerticalStack>
          )}
        </ErrorBoundary>
        {/* 저장소 v2 마이그레이션 게이트 — 활성 시 부팅 스피너 포함 전체를 덮는다
            (bootReady 이전 실행). 스펙: track1-b-migration-spec.md §4. */}
        <MigrationGate />
        {/* 분리형 생성 컨트롤 위젯 (PC 전용).
            분리 상태이거나, 컴팩트 템플릿(하단바 없음)이면 항상 플로팅으로 표시. */}
        {!isMobile &&
          (appState.genWidget.detached ||
            bottomBarPlacement === 'none' ||
            resolvedLayout.genControl === 'floating') && (
            <GenControlFloating />
          )}
        {/* 편집 모드 셸(PC 전용). 진입점이 PC 전용이지만 만약을 위해 !isMobile 가드. */}
        {!isMobile && appState.editMode && <EditModeShell />}
        {/* 내보내기 진행 플로팅 위젯 (비차단형) */}
        {appState.exportProgress && (
          <div className="fixed bottom-16 right-4 z-[var(--z-widget)] bg-[var(--c-surface-2)] rounded-lg shadow-xl border line-color p-3 min-w-[220px]">
            {appState.exportProgress.completed ? (
              // 완료 상태(PC): 진행바 대신 완료 표시 + 확인 버튼. 15초 후 자동 소멸.
              <div className="flex items-center gap-2">
                <span className="flex-none text-green-500 text-lg">✓</span>
                <span className="flex-1 text-sm font-medium text-default">
                  {appState.exportProgress.text}
                </span>
                <button
                  className="round-button back-gray flex-none text-sm px-3 h-8"
                  onClick={() => appState.dismissExportComplete()}
                >
                  확인
                </button>
              </div>
            ) : (
              <>
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
              </>
            )}
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
        <ModalOverlay
          isOpen={appState.projectTrashOpen}
          onClose={() => appState.closeProjectTrash()}
          title="🗑️ 프로젝트 휴지통"
        >
          <ProjectTrashView />
        </ModalOverlay>
        {appState.characterPresetsOpen && appState.curSession && (
          <CharacterPresetFloatEditor
            onClose={() => appState.closeCharacterPresets()}
            onApplyPreset={(preset, mode) =>
              appState.applyCharacterPreset(preset, mode)
            }
          />
        )}
        <ExportPresetManager />
        {dragOverlay && (
          <div
            className="fixed inset-0 z-[var(--z-drag-overlay)] flex items-center justify-center pointer-events-none"
            style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
          >
            <div className="bg-[var(--c-surface-2)] rounded-2xl r-modal px-8 py-6 shadow-2xl border-2 border-dashed border-sky-400 dark:border-sky-500 flex flex-col items-center gap-3">
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
