import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { observer } from 'mobx-react-lite';
import {
  FaTimes,
  FaSearch,
  FaFolder,
  FaStar,
  FaPlus,
  FaChevronDown,
  FaChevronRight,
  FaChevronLeft,
  FaPalette,
  FaFolderPlus,
  FaCheck,
  FaPen,
  FaTrashAlt,
  FaFileExport,
  FaEllipsisV,
  FaHdd,
  FaFileArchive,
  FaCopy,
  FaLayerGroup,
  FaThLarge,
  FaMagic,
  FaFileImport,
} from 'react-icons/fa';
import {
  sessionService,
  imageService,
  isMobile,
  templateService,
  projectTemplateService,
} from '../models';
import { appState } from '../models/AppService';
import { backStackService } from '../models/BackStackService';
import Tooltip from './Tooltip';
import MobileColorPicker from './MobileColorPicker';
import { pushRecentProject } from './ProjectBrowser';
import StorageManageModal from './StorageManageModal';
import {
  FolderTemplateModal,
  ReapplyTemplateModal,
} from './TemplateInheritModals';
import { TemplateManagerModal } from './TemplateManagerModal';

const naturalCmp = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

// 폴더 색상 팔레트 (hex). 미지정 폴더는 기본색을 사용한다.
const FOLDER_COLORS = [
  '#64748b', // slate
  '#ef4444', // red
  '#f97316', // orange
  '#f59e0b', // amber
  '#22c55e', // green
  '#14b8a6', // teal
  '#0ea5e9', // sky (기본)
  '#6366f1', // indigo
  '#a855f7', // purple
  '#ec4899', // pink
];
const DEFAULT_FOLDER_COLOR = '#0ea5e9';

// hex 색상에 알파를 붙여 옅은 배경을 만든다. (아이콘 배지/드롭 피드백 등 소형 색 강조용)
const withAlpha = (hex: string, alpha: string) => hex + alpha;

// 프로젝트 행. 모듈 레벨 컴포넌트(안정적 정체성)라 드래그 중 리렌더에도 언마운트되지 않는다.
const ProjectRow = observer(
  ({
    name,
    showFolder,
    dndEnabled,
    dragging,
    selectMode,
    selected,
    onSelect,
    onDragStart,
    onDragEnd,
    onContextMenu,
    onMenu,
    editing,
    editValue,
    onEditChange,
    onEditCommit,
    onEditCancel,
    onEditKeyDown,
  }: {
    name: string;
    showFolder?: boolean;
    dndEnabled?: boolean;
    dragging?: boolean;
    selectMode?: boolean;
    selected?: boolean;
    onSelect: () => void;
    onDragStart: (e: React.DragEvent) => void;
    onDragEnd: (e: React.DragEvent) => void;
    onContextMenu?: (e: React.MouseEvent) => void;
    onMenu?: () => void;
    editing?: boolean;
    editValue?: string;
    onEditChange?: (v: string) => void;
    onEditCommit?: () => void;
    onEditCancel?: () => void;
    onEditKeyDown?: (e: React.KeyboardEvent) => void;
  }) => {
    const active = appState.curSession?.name === name;
    const isFav = sessionService.isFavorite(name);
    const isSceneTpl = templateService.isSceneTemplate(name);
    const folder = showFolder ? sessionService.getFolderOf(name) : null;
    const folderColor = folder
      ? sessionService.getFolderColor(folder) || DEFAULT_FOLDER_COLOR
      : null;
    const highlighted = selectMode ? selected : active;
    if (editing) {
      return (
        <div className="flex items-center gap-1 pl-1.5 pr-1 py-1">
          <span
            className="flex items-center justify-center w-7 h-7 rounded-md flex-none"
            style={{ backgroundColor: '#e0f2fe' }}
          >
            <FaStar size={12} className="text-yellow-400" />
          </span>
          <input
            autoFocus
            value={editValue}
            onChange={(e) => onEditChange?.(e.target.value)}
            onKeyDown={onEditKeyDown}
            className="flex-1 min-w-0 bg-[var(--c-surface)] border border-sky-400 rounded px-2 py-1.5 text-[15px] text-default outline-none"
          />
          <Tooltip content="저장">
            <button
              onClick={onEditCommit}
              className="btn-ghost p-2 rounded-md flex-none text-green-500"
            >
              <FaCheck size={15} />
            </button>
          </Tooltip>
          <Tooltip content="취소">
            <button
              onClick={onEditCancel}
              className="btn-ghost p-2 rounded-md flex-none text-faint"
            >
              <FaTimes size={15} />
            </button>
          </Tooltip>
        </div>
      );
    }
    return (
      <button
        onClick={onSelect}
        onContextMenu={isMobile ? undefined : onContextMenu}
        data-drag-type={selectMode ? undefined : 'project'}
        data-drag-name={selectMode ? undefined : name}
        draggable={dndEnabled}
        onDragStart={(e: React.DragEvent) => {
          e.stopPropagation();
          onDragStart(e);
        }}
        onDragEnd={(e: React.DragEvent) => {
          e.stopPropagation();
          onDragEnd(e);
        }}
        style={dragging ? { opacity: 0.4 } : undefined}
        className={`w-full flex items-center gap-2 px-2.5 py-2.5 rounded-md text-[15px] text-left transition-colors ${
          highlighted
            ? 'bg-sky-500 text-white shadow-sm'
            : 'hover:bg-gray-100 dark:hover:bg-slate-700 text-default'
        }`}
      >
        {selectMode ? (
          <span
            className={`flex-none w-[15px] h-[15px] rounded-full border flex items-center justify-center ${
              selected
                ? 'bg-white border-white text-sky-500'
                : 'border-gray-400 dark:border-slate-400'
            }`}
          >
            {selected && <FaCheck size={9} />}
          </span>
        ) : (
          <Tooltip content={isFav ? '즐겨찾기 해제' : '즐겨찾기'}>
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                sessionService.toggleFavorite(name);
              }}
              className="flex-none -m-1 p-1 rounded cursor-pointer hover:bg-black/10 dark:hover:bg-white/10"
            >
              <FaStar
                size={13}
                className={`${
                  isFav
                    ? 'text-yellow-400'
                    : active
                      ? 'text-sky-100'
                      : 'text-gray-300 dark:text-slate-600'
                }`}
              />
            </span>
          </Tooltip>
        )}
        <span className="truncate flex-1">{name}</span>
        {isSceneTpl && (
          <Tooltip content="씬 템플릿 프로젝트">
            <span
              className={`flex-none flex items-center justify-center w-5 h-5 rounded ${
                active ? 'text-purple-100' : 'text-purple-500 dark:text-purple-400'
              }`}
            >
              <FaThLarge size={11} />
            </span>
          </Tooltip>
        )}
        {folder && (
          <span
            className={`text-xs flex-none flex items-center gap-1 ${
              active ? 'text-sky-100' : 'text-faint'
            }`}
          >
            <FaFolder
              size={10}
              style={
                !active && folderColor ? { color: folderColor } : undefined
              }
            />
            <span className="max-w-[80px] truncate">{folder}</span>
          </span>
        )}
        {isMobile && !selectMode && onMenu && (
          <span
            role="button"
            aria-label="프로젝트 메뉴"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onMenu();
            }}
            className={`flex-none -mr-1 p-1.5 rounded ${
              active
                ? 'text-sky-100 hover:bg-white/15'
                : 'text-faint hover:bg-black/10 dark:hover:bg-white/10'
            }`}
          >
            <FaEllipsisV size={15} />
          </span>
        )}
      </button>
    );
  },
);

// 모바일 좌측 가장자리 손잡이 — 프로젝트 오버레이 드로어 열기/닫기 토글.
// 히스토리 우측 핸들(ImageHistoryHandle)의 좌측 미러. 좌측 끝에서 우로 스와이프해도 열림.
// (좌측 끝은 우측 툴바 드래그와 겹치지 않아 toolbarDragUi 가드는 불필요.)
export const ProjectDrawerHandle = observer(() => {
  const open = appState.projectDrawerOpen;

  useEffect(() => {
    let startX = 0;
    let startY = 0;
    let tracking = false;
    const onStart = (e: TouchEvent) => {
      if (appState.projectDrawerOpen || e.touches.length !== 1) return;
      const t = e.touches[0];
      if (t.clientX > 32) return; // 좌측 끝 32px 에서 시작한 터치만
      startX = t.clientX;
      startY = t.clientY;
      tracking = true;
    };
    const onMove = (e: TouchEvent) => {
      if (!tracking || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (dx > 40 && Math.abs(dx) > Math.abs(dy)) {
        tracking = false;
        appState.projectDrawerOpen = true;
      }
    };
    const onEnd = () => {
      tracking = false;
    };
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });
    document.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  return (
    <button
      className="fixed left-0 top-1/2 -translate-y-1/2 md:hidden flex items-center justify-center w-6 h-14 rounded-r-md border border-l-0 line-color bg-[var(--c-surface-2)] opacity-70 active:opacity-100"
      style={{ zIndex: 'var(--z-drawer-handle)' }}
      onClick={() => {
        appState.projectDrawerOpen = !open;
      }}
    >
      {open ? (
        <FaChevronLeft size={11} className="text-faint" />
      ) : (
        <FaChevronRight size={11} className="text-faint" />
      )}
    </button>
  );
});

const ProjectDrawer = observer(() => {
  const [filter, setFilter] = useState('');
  const [, setVersion] = useState(0);
  // 즐겨찾기는 기본 펼침('__favorites__' 포함)
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(['__favorites__']),
  );
  const [colorPickerFor, setColorPickerFor] = useState<string | null>(null);
  const [editingFolder, setEditingFolder] = useState<string | null>(null);
  const [editingProject, setEditingProject] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editProjectValue, setEditProjectValue] = useState('');
  // 커스텀 컬러 피커 저장 디바운스 타이머 (훅 규칙: 조기 반환 이전에 선언)
  const customColorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 저장 공간 관리 모달
  const [storageOpen, setStorageOpen] = useState(false);
  // 폴더 기본 템플릿 지정 모달 (프로젝트 상속 v2) — 대상 폴더 경로
  const [folderTemplateFor, setFolderTemplateFor] = useState<string | null>(
    null,
  );
  // 템플릿 수동 재적용 모달 — 대상 프로젝트 이름
  const [reapplyFor, setReapplyFor] = useState<string | null>(null);
  // 템플릿 관리 오버레이 (프로젝트 상속 v2)
  const [templateManagerOpen, setTemplateManagerOpen] = useState(false);
  // 선택 모드(다중 선택 → 폴더 일괄 이동)
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 드래그&드롭 상태 (PC 전용)
  const [drag, setDrag] = useState<{
    type: 'project' | 'folder';
    name: string;
  } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  // 열린 폴더의 "여기에 넣기" 존 위에 폴더를 올렸을 때의 대상(서브폴더 중첩용)
  const [nestTarget, setNestTarget] = useState<string | null>(null);
  // dragstart에서 한 틱 미룬 setDrag 타이머 — dragend가 먼저 오면 취소해
  // 드래그 상태가 유령으로 남지 않게 한다
  const dragStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [toolbar, setToolbar] = useState<{
    type: 'folder' | 'project';
    name: string;
    x: number;
    y: number;
  } | null>(null);
  const toolbarRef = useRef(toolbar);
  toolbarRef.current = toolbar;

  const open = appState.projectDrawerOpen;
  // 슬라이드 애니메이션용 상태: render(마운트 여부) / shown(트랜지션 표시 여부)
  const [render, setRender] = useState(open);
  const [shown, setShown] = useState(open);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    const onUpdate = () => refresh();
    sessionService.addEventListener('listupdated', onUpdate);
    return () => sessionService.removeEventListener('listupdated', onUpdate);
  }, [refresh]);

  // 안드로이드 뒤로가기로 드로어 닫기
  useEffect(() => {
    if (!open) return;
    const handle = backStackService.push(() => {
      appState.projectDrawerOpen = false;
    });
    return () => handle.remove();
  }, [open]);

  // 열림/닫힘 트랜지션 제어
  useEffect(() => {
    if (open) {
      setRender(true);
      // 초기 상태(translateX -100%)가 실제로 페인트된 다음 프레임에 shown 을 켜야
      // 슬라이드 전환이 발동한다. 단일 rAF 는 페인트 이전에 실행될 수 있어(레이스)
      // 열기 애니메이션이 씹혔다 → 더블 rAF 로 한 프레임 뒤로 미룬다.
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setShown(true));
      });
      return () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
      };
    } else {
      setShown(false);
      const t = setTimeout(() => setRender(false), 260);
      return () => clearTimeout(t);
    }
  }, [open]);

  // 열릴 때마다 현재 프로젝트의 폴더 자동 펼침 + 검색/색상선택 초기화
  useEffect(() => {
    if (!open) return;
    templateService.ensureLoaded();
    setFilter('');
    setColorPickerFor(null);
    setSelectMode(false);
    setSelected(new Set());
    const cur = appState.curSession?.name;
    const folder = cur ? sessionService.getFolderOf(cur) : null;
    if (folder) {
      setExpanded((prev) => {
        const next = new Set(prev);
        next.add(folder);
        return next;
      });
    }
  }, [open]);

  // Esc로 닫기
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (toolbarRef.current) {
          setToolbar(null);
          return;
        }
        if (colorPickerFor) {
          setColorPickerFor(null);
          return;
        }
        if (selectMode) {
          setSelectMode(false);
          setSelected(new Set());
          return;
        }
        if (editingProject) {
          setEditingProject(null);
          return;
        }
        appState.projectDrawerOpen = false;
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, colorPickerFor, selectMode, editingProject]);

  // 플로팅 툴바 닫기 (외부 클릭 / Esc)
  useEffect(() => {
    if (!toolbar) return;
    const close = () => setToolbar(null);
    const onMouseDown = (e: MouseEvent) => {
      const el =
        document.getElementById('floating-folder-toolbar') ||
        document.getElementById('floating-project-toolbar');
      if (el && !el.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [toolbar]);

  const close = () => {
    appState.projectDrawerOpen = false;
  };

  const sessionNames = sessionService.list();
  const folders = sessionService.getOrderedFolders();

  const isFav = (n: string) => sessionService.isFavorite(n);
  const sortFn = (a: string, b: string) => {
    const af = isFav(a);
    const bf = isFav(b);
    if (af !== bf) return af ? -1 : 1;
    return naturalCmp(a, b);
  };

  const favs = sessionNames.filter(isFav).sort(naturalCmp);
  const folderToProjects = new Map<string, string[]>();
  folders.forEach((f) => folderToProjects.set(f, []));
  const unfiled: string[] = [];
  for (const n of sessionNames) {
    const f = sessionService.getFolderOf(n);
    if (f && folderToProjects.has(f)) folderToProjects.get(f)!.push(n);
    else unfiled.push(n);
  }
  folderToProjects.forEach((arr) => arr.sort(sortFn));
  unfiled.sort(sortFn);

  const searching = filter.trim().length > 0;
  const searchResults = searching
    ? sessionNames
        .filter((n) => n.toLowerCase().includes(filter.toLowerCase()))
        .sort(sortFn)
    : [];

  const toggleFolder = (f: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  };

  const selectProject = async (name: string) => {
    const session = await sessionService.get(name);
    if (session) {
      imageService.refreshBatch(session);
      appState.curSession = session;
      pushRecentProject(name);
    }
    close();
  };

  const createProject = async (folder: string | null) => {
    const name = await appState.pushDialogAsync({
      type: 'input-confirm',
      text: folder
        ? `"${folder}" 폴더에 새 프로젝트 이름`
        : '신규 프로젝트 이름',
    });
    if (!name) return;
    if (sessionService.list().includes(name)) {
      const conflictFolder = sessionService.getFolderOf(name);
      const where = conflictFolder ? `"${conflictFolder}" 폴더에 ` : '';
      appState.pushMessage(`같은 이름의 프로젝트가 ${where}이미 존재합니다.`);
      return;
    }
    // 폴더 기본 템플릿(조상 폴더 포함, 프로젝트 상속 v2)이 있으면 선택
    // 다이얼로그를 건너뛰고 자동 적용한다.
    const folderTpl = await templateService.resolveFolderTemplate(folder);
    let tplId: string | null;
    if (folderTpl) {
      tplId = folderTpl.templateId;
    } else {
      const picked = await projectTemplateService.pickForCreate();
      if (picked === undefined) return; // 사용자가 템플릿 선택을 취소
      tplId = picked;
    }
    try {
      if (tplId) {
        await sessionService.createSessionFromProjectTemplate(tplId, name);
      } else {
        await sessionService.add(name);
      }
      if (folder) {
        try {
          await sessionService.moveToFolder(name, folder);
        } catch (e) {}
      }
      const session = await sessionService.get(name);
      if (session) {
        imageService.refreshBatch(session);
        appState.curSession = session;
        pushRecentProject(name);
      }
      if (folderTpl) {
        const tplName =
          projectTemplateService.get(folderTpl.templateId)?.name ?? '';
        appState.pushMessage(
          `폴더 기본 템플릿 "${tplName}"이(가) 적용되었습니다.`,
        );
      }
      close();
    } catch (e: any) {
      appState.pushMessage(e.message || '프로젝트 생성에 실패했습니다.');
    }
  };

  const createFolder = async (parentPath?: string) => {
    const hint = parentPath
      ? `"${sessionService.folderLeafName(parentPath)}" 안에 새 폴더 (예: 서브폴더 또는 상위/하위)`
      : '새 폴더 이름을 입력하세요 (예: 폴더 또는 상위/하위)';
    const value = await appState.pushDialogAsync({
      type: 'input-confirm',
      text: hint,
    });
    if (!value) return;
    const fullPath = parentPath
      ? parentPath + '/' + value.trim()
      : value.trim();
    try {
      await sessionService.createFolder(fullPath);
      setExpanded((prev) => {
        const next = new Set(prev);
        next.add(fullPath);
        // 부모도 펼쳐서 새 폴더가 보이게 함
        if (parentPath) next.add(parentPath);
        return next;
      });
    } catch (e: any) {
      appState.pushMessage(e.message || '폴더 생성에 실패했습니다.');
    }
  };

  const pickColor = async (f: string, c: string | null) => {
    setColorPickerFor(null);
    try {
      await sessionService.setFolderColor(f, c);
    } catch (e) {}
  };

  // 커스텀 컬러 피커 전용: 크로뮴은 색상 팝업을 드래그하는 동안 change 이벤트가
  // 연속 발생하므로, 패널을 닫지 않고(input 언마운트 → 팝업 닫힘 방지) 저장만
  // 디바운스한다. 이렇게 해야 슬라이더로 색을 자유롭게 조정할 수 있다.
  const pickCustomColor = (f: string, c: string) => {
    if (customColorTimer.current) clearTimeout(customColorTimer.current);
    customColorTimer.current = setTimeout(() => {
      sessionService.setFolderColor(f, c).catch(() => {});
    }, 200);
  };

  // ===== 폴더 인라인 이름 편집 / 삭제 =====
  const startRename = (f: string) => {
    setColorPickerFor(null);
    setEditingFolder(f);
    setEditValue(sessionService.folderLeafName(f));
  };

  const cancelRename = () => {
    setEditingFolder(null);
    setEditValue('');
  };

  const commitRename = async () => {
    const f = editingFolder;
    if (!f) return;
    const newLeaf = editValue.trim();
    if (!newLeaf || sessionService.folderLeafName(f) === newLeaf) {
      cancelRename();
      return;
    }
    // 부모 경로 유지, 마지막 세그먼트만 변경
    const parent = sessionService.folderParentPath(f);
    const newFullPath = parent ? parent + '/' + newLeaf : newLeaf;
    try {
      await sessionService.renameFolder(f, newFullPath);
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(f)) {
          next.delete(f);
          next.add(newFullPath);
        }
        return next;
      });
      cancelRename();
    } catch (e: any) {
      appState.pushMessage(e.message || '이름 변경에 실패했습니다.');
    }
  };

  const deleteFolderConfirm = (f: string) => {
    const leafName = sessionService.folderLeafName(f);
    const cleanup = () => {
      if (editingFolder === f) cancelRename();
    };
    const count = sessionService
      .list()
      .filter((n) => sessionService.getFolderOf(n) === f).length;
    if (count === 0) {
      appState.pushDialog({
        type: 'confirm',
        text: `폴더 "${leafName}"를 삭제할까요?`,
        callback: async () => {
          try {
            await sessionService.deleteFolder(f);
            cleanup();
          } catch (e: any) {
            appState.pushMessage(e.message || '폴더 삭제에 실패했습니다.');
          }
        },
      });
      return;
    }
    appState.pushDialog({
      type: 'select',
      text: `폴더 "${leafName}" 삭제 (${count}개 프로젝트)`,
      items: [
        { text: '폴더만 삭제 (프로젝트는 미분류로 이동)', value: 'folderOnly' },
        { text: '⚠️ 폴더와 프로젝트 모두 삭제', value: 'withProjects' },
      ],
      callback: async (value) => {
        if (value === 'folderOnly') {
          try {
            await sessionService.deleteFolder(f);
            cleanup();
          } catch (e: any) {
            appState.pushMessage(e.message || '폴더 삭제에 실패했습니다.');
          }
        } else if (value === 'withProjects') {
          appState.pushDialog({
            type: 'confirm',
            text: `정말 폴더 "${leafName}"와 그 안의 ${count}개 프로젝트를 모두 삭제할까요?\n프로젝트는 휴지통으로 이동되어 복구할 수 있습니다.`,
            callback: async () => {
              await appState.deleteFolderWithProjects(f);
              cleanup();
            },
          });
        }
      },
    });
  };

  const cloneFolder = async (sourceFolder: string) => {
    const leafName = sessionService.folderLeafName(sourceFolder);
    const value = await appState.pushDialogAsync({
      type: 'input-confirm',
      text: `"${leafName}" 폴더를 복제합니다. 새 폴더 이름을 입력하세요.`,
    });
    if (!value) return;

    const mode = await appState.pushDialogAsync({
      text: '이미지 파일을 함께 복사할까요?',
      type: 'select',
      items: [
        { text: '설정만 복사 (프롬프트, 프리셋 등)', value: 'config' },
        { text: '이미지 포함 복사 (휴지통 제외)', value: 'with-images' },
      ],
    });
    if (!mode) return;

    const withImages = mode === 'with-images';
    const parent = sessionService.folderParentPath(sourceFolder);
    const targetPath = parent ? parent + '/' + value.trim() : value.trim();
    try {
      appState.setProgressDialog({
        text: '폴더 복제 중...',
        done: 0,
        total: 1,
      });
      await sessionService.cloneFolder(sourceFolder, targetPath, withImages);
      appState.setProgressDialog(undefined);
      appState.pushMessage(`"${value.trim}" 폴더로 복제되었습니다.`);
    } catch (e: any) {
      appState.setProgressDialog(undefined);
      appState.pushMessage(e.message || '폴더 복제에 실패했습니다.');
    }
  };

  // 모바일: 폴더마다 ⋮ 메뉴 (데스크톱은 인라인 버튼 유지)
  const openFolderMenu = async (f: string) => {
    await templateService.ensureLoaded(); // '기본 템플릿 (지정됨)' 라벨 판정용
    const leafName = sessionService.folderLeafName(f);
    const v = await appState.pushDialogAsync({
      type: 'select',
      text: `폴더 "${leafName}"`,
      items: [
        { text: '📤 내보내기/불러오기', value: 'export' },
        { text: '📋 폴더 복제', value: 'clone' },
        { text: '🎨 색상 변경', value: 'color' },
        { text: '✏️ 이름 편집', value: 'rename' },
        { text: '🗑️ 폴더 삭제', value: 'delete' },
        { text: '➕ 이 폴더에 새 프로젝트', value: 'add' },
        { text: '📂 이 폴더에 서브폴더', value: 'subfolder' },
        {
          text: templateService.getFolderTemplate(f)
            ? '✨ 기본 템플릿 (지정됨)'
            : '✨ 기본 템플릿',
          value: 'folder-template',
        },
      ],
    });
    if (!v) return;
    if (v === 'export') appState.folderBackupMenu(f);
    else if (v === 'clone') cloneFolder(f);
    else if (v === 'color') setColorPickerFor((p) => (p === f ? null : f));
    else if (v === 'rename') startRename(f);
    else if (v === 'delete') deleteFolderConfirm(f);
    else if (v === 'add') createProject(f);
    else if (v === 'subfolder') createFolder(f);
    else if (v === 'folder-template') setFolderTemplateFor(f);
  };

  // 모바일: 프로젝트 행의 메뉴 아이콘에서 여는 액션 메뉴(폴더 메뉴와 동일 패턴)
  const openProjectMenu = async (n: string) => {
    const v = await appState.pushDialogAsync({
      type: 'select',
      text: `프로젝트 "${n}"`,
      items: [
        { text: '📤 내보내기/불러오기', value: 'export' },
        { text: '📋 프로젝트 복제', value: 'clone' },
        {
          text: templateService.isSceneTemplate(n)
            ? '🧩 씬 템플릿 해제'
            : '🧩 씬 템플릿으로 지정',
          value: 'scene-template',
        },
        { text: '📥 템플릿 적용 (덮어쓰기)', value: 'reapply' },
        { text: '✏️ 이름 편집', value: 'rename' },
        { text: '🗑️ 프로젝트 삭제', value: 'delete' },
      ],
    });
    if (!v) return;
    if (v === 'export') handleProjectExportImport(n);
    else if (v === 'clone') handleProjectClone(n);
    else if (v === 'scene-template') handleProjectSceneTemplateToggle(n);
    else if (v === 'reapply') setReapplyFor(n);
    else if (v === 'rename') handleProjectRename(n);
    else if (v === 'delete') handleProjectDelete(n);
  };

  // ===== 드래그&드롭 =====
  const reorderFolders = (moved: string, target: string) => {
    if (moved === target) return;
    const cur = sessionService.getOrderedFolders();
    const from = cur.indexOf(moved);
    const to = cur.indexOf(target);
    if (from < 0 || to < 0) return;
    const without = cur.filter((f) => f !== moved);
    const tIdx = without.indexOf(target);
    const insertAt = from < to ? tIdx + 1 : tIdx;
    without.splice(insertAt, 0, moved);
    sessionService.setFolderOrder(without);
  };

  const moveProjectTo = async (name: string, folder: string | null) => {
    if (sessionService.getFolderOf(name) === folder) return;
    try {
      await sessionService.moveToFolder(name, folder);
    } catch (e: any) {
      appState.pushMessage(e?.message || '이동에 실패했습니다.');
    }
  };

  // 폴더 헤더에 드롭 = 순서변경(같은 부모) 또는 형제로 재배치(다른 부모).
  // 서브폴더로 "넣기"는 열린 폴더의 넣기 존(handleNestDrop)이 담당한다.
  // 프로젝트면 그 폴더로 이동.
  const handleFolderDrop = async (targetFolder: string) => {
    const d = drag;
    setDrag(null);
    setDropTarget(null);
    setNestTarget(null);
    if (!d) return;
    if (d.type === 'folder') {
      const source = d.name;
      if (source === targetFolder) return;
      // 자기 자신/하위로는 이동 불가
      if (targetFolder.startsWith(source + '/')) return;
      const srcParent = sessionService.folderParentPath(source);
      const tgtParent = sessionService.folderParentPath(targetFolder);
      if (srcParent === tgtParent) {
        reorderFolders(source, targetFolder);
      } else {
        // 다른 부모: target과 형제가 되도록 부모를 옮긴 뒤 그 자리에 배치.
        // (루트 폴더 헤더에 서브폴더를 떨구면 루트로 빠져나오는 등)
        const leaf = sessionService.folderLeafName(source);
        const newPath = tgtParent ? tgtParent + '/' + leaf : leaf;
        try {
          await sessionService.renameFolder(source, newPath);
          reorderFolders(newPath, targetFolder);
        } catch (e: any) {
          appState.pushMessage(e?.message || '폴더 이동에 실패했습니다.');
        }
      }
    } else moveProjectTo(d.name, targetFolder);
  };

  // 열린 폴더의 "여기에 넣기" 존에 드롭 = 그 폴더의 서브폴더로 중첩.
  const handleNestDrop = async (targetFolder: string) => {
    const d = drag;
    setDrag(null);
    setDropTarget(null);
    setNestTarget(null);
    if (!d) return;
    if (d.type === 'folder') {
      // 자기 자신/하위로 넣기, 이미 그 폴더의 자식이면 무시
      if (
        d.name === targetFolder ||
        targetFolder.startsWith(d.name + '/') ||
        sessionService.folderParentPath(d.name) === targetFolder
      )
        return;
      const leaf = sessionService.folderLeafName(d.name);
      try {
        await sessionService.renameFolder(d.name, targetFolder + '/' + leaf);
      } catch (e: any) {
        appState.pushMessage(e?.message || '폴더 이동에 실패했습니다.');
      }
    } else moveProjectTo(d.name, targetFolder);
  };

  // 미분류 헤더에 드롭: 프로젝트는 루트(미분류)로, 서브폴더는 루트로 빼내기.
  const handleUnfiledDrop = async () => {
    const d = drag;
    setDrag(null);
    setDropTarget(null);
    setNestTarget(null);
    if (!d) return;
    if (d.type === 'project') {
      moveProjectTo(d.name, null);
    } else {
      const parent = sessionService.folderParentPath(d.name);
      if (parent === null) return; // 이미 루트
      const leaf = sessionService.folderLeafName(d.name);
      try {
        await sessionService.renameFolder(d.name, leaf);
      } catch (e: any) {
        appState.pushMessage(e?.message || '폴더 이동에 실패했습니다.');
      }
    }
  };

  const dndEnabled = !isMobile;

  // 폴더 헤더 드롭(순서/재배치) 가능 여부 판정 (시각 피드백용)
  const canDropOnFolder = (f: string) =>
    drag != null &&
    (drag.type === 'project'
      ? sessionService.getFolderOf(drag.name) !== f
      : drag.name !== f && !f.startsWith(drag.name + '/'));

  // 열린 폴더 안에 서브폴더로 넣기 가능 여부 (넣기 존 표시·판정용)
  const canNestInto = (f: string) =>
    drag?.type === 'folder' &&
    drag.name !== f &&
    !f.startsWith(drag.name + '/') &&
    sessionService.folderParentPath(drag.name) !== f;

  // ===== 모바일 터치 드래그 (롱프레스로 잡아 폴더로 이동/재정렬) =====
  // PC는 HTML5 draggable을 그대로 쓰지만 그것은 터치를 지원하지 않으므로, 모바일은 별도
  // 터치 핸들러로 구현한다. 드롭 처리는 기존 handleFolderDrop/handleUnfiledDrop 재사용.
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const touchApiRef = useRef({
    handleFolderDrop,
    handleNestDrop,
    handleUnfiledDrop,
    setDrag,
    setDropTarget,
    setNestTarget,
  });
  touchApiRef.current = {
    handleFolderDrop,
    handleNestDrop,
    handleUnfiledDrop,
    setDrag,
    setDropTarget,
    setNestTarget,
  };

  useEffect(() => {
    if (!isMobile) return;
    type Cand = { type: 'project' | 'folder'; name: string };
    const st = {
      cand: null as Cand | null,
      startX: 0,
      startY: 0,
      timer: null as ReturnType<typeof setTimeout> | null,
      grabbed: false,
      ghost: null as HTMLElement | null,
      target: null as string | null, // 폴더명 | '__unfiled__' | null
      lastX: 0,
      lastY: 0,
      raf: null as number | null,
    };
    let suppressClick = false;

    const canDrop = (
      cand: Cand,
      kind: 'folder' | 'unfiled',
      f?: string,
    ): boolean => {
      if (kind === 'unfiled')
        return cand.type === 'project'
          ? sessionService.getFolderOf(cand.name) !== null
          : sessionService.folderParentPath(cand.name) !== null; // 서브폴더 빼내기
      if (!f) return false;
      return cand.type === 'project'
        ? sessionService.getFolderOf(cand.name) !== f
        : cand.name !== f && !f.startsWith(cand.name + '/');
    };

    // 열린 폴더의 넣기 존 위인지 판정 (폴더 드래그 전용)
    const canNest = (cand: Cand, f: string): boolean =>
      cand.type === 'folder' &&
      cand.name !== f &&
      !f.startsWith(cand.name + '/') &&
      sessionService.folderParentPath(cand.name) !== f;

    const moveGhost = (x: number, y: number) => {
      if (st.ghost)
        st.ghost.style.transform = `translate(${x + 12}px, ${y - 14}px)`;
    };

    const autoScroll = () => {
      st.raf = requestAnimationFrame(autoScroll);
      const sc = listScrollRef.current;
      if (!sc || !st.grabbed) return;
      const r = sc.getBoundingClientRect();
      const edge = 52;
      if (st.lastY < r.top + edge) sc.scrollTop -= 9;
      else if (st.lastY > r.bottom - edge) sc.scrollTop += 9;
    };

    const hitTest = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      let target: string | null = null;
      // 넣기 존을 먼저 판정 (열린 폴더 내용 상단). 넣기 존은 넣기 대상 폴더만 존재.
      const nestEl = el?.closest('[data-nest-folder]') as HTMLElement | null;
      if (nestEl && st.cand) {
        const f = nestEl.getAttribute('data-nest-folder')!;
        if (canNest(st.cand, f)) target = '__nest__' + f;
      }
      if (!target) {
        const folderEl = el?.closest(
          '[data-drop-folder]',
        ) as HTMLElement | null;
        if (folderEl && st.cand) {
          const f = folderEl.getAttribute('data-drop-folder')!;
          if (canDrop(st.cand, 'folder', f)) target = f;
        }
      }
      if (!target) {
        const unfiledEl = el?.closest(
          '[data-drop-unfiled]',
        ) as HTMLElement | null;
        if (unfiledEl && st.cand && canDrop(st.cand, 'unfiled'))
          target = '__unfiled__';
      }
      if (target !== st.target) {
        st.target = target;
        // 넣기 존이면 nestTarget, 그 외엔 dropTarget으로 하이라이트 분기
        if (target && target.startsWith('__nest__')) {
          touchApiRef.current.setNestTarget(target.slice('__nest__'.length));
          touchApiRef.current.setDropTarget(null);
        } else {
          touchApiRef.current.setDropTarget(target);
          touchApiRef.current.setNestTarget(null);
        }
      }
    };

    const begin = () => {
      if (!st.cand) return;
      st.grabbed = true;
      touchApiRef.current.setDrag({ type: st.cand.type, name: st.cand.name });
      const label =
        st.cand.type === 'folder'
          ? sessionService.folderLeafName(st.cand.name)
          : st.cand.name;
      const g = document.createElement('div');
      g.textContent = label;
      g.style.cssText =
        'position:fixed;left:0;top:0;z-index:var(--z-drag-ghost);pointer-events:none;' +
        'padding:8px 12px;border-radius:10px;font-size:14px;font-weight:600;' +
        'color:#fff;background:#0ea5e9;box-shadow:0 6px 16px rgba(0,0,0,.35);' +
        'max-width:60vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' +
        'will-change:transform;';
      document.body.appendChild(g);
      st.ghost = g;
      moveGhost(st.lastX, st.lastY);
      try {
        navigator.vibrate?.(15);
      } catch {}
      st.raf = requestAnimationFrame(autoScroll);
    };

    const cleanupTransient = () => {
      if (st.timer) {
        clearTimeout(st.timer);
        st.timer = null;
      }
      if (st.raf) {
        cancelAnimationFrame(st.raf);
        st.raf = null;
      }
      if (st.ghost) {
        st.ghost.remove();
        st.ghost = null;
      }
      st.cand = null;
      st.grabbed = false;
      st.target = null;
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        cleanupTransient();
        return;
      }
      const t = e.touches[0];
      const src = (e.target as HTMLElement)?.closest?.(
        '[data-drag-type]',
      ) as HTMLElement | null;
      if (!src) return;
      const name = src.getAttribute('data-drag-name') || '';
      if (!name) return;
      st.cand = {
        type: src.getAttribute('data-drag-type') as 'project' | 'folder',
        name,
      };
      st.startX = st.lastX = t.clientX;
      st.startY = st.lastY = t.clientY;
      st.timer = setTimeout(begin, 320);
    };

    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      st.lastX = t.clientX;
      st.lastY = t.clientY;
      if (st.grabbed) {
        e.preventDefault(); // 드래그 중 스크롤 방지
        moveGhost(t.clientX, t.clientY);
        hitTest(t.clientX, t.clientY);
        return;
      }
      if (st.cand && st.timer) {
        const dx = Math.abs(t.clientX - st.startX);
        const dy = Math.abs(t.clientY - st.startY);
        if (dx > 10 || dy > 10) {
          // 손가락이 움직임 → 스크롤로 간주, 드래그 후보 취소
          clearTimeout(st.timer);
          st.timer = null;
          st.cand = null;
        }
      }
    };

    const onEnd = (e: TouchEvent) => {
      if (st.grabbed) {
        e.preventDefault();
        const target = st.target;
        const cand = st.cand;
        if (target && cand) {
          if (target === '__unfiled__')
            touchApiRef.current.handleUnfiledDrop();
          else if (target.startsWith('__nest__'))
            touchApiRef.current.handleNestDrop(
              target.slice('__nest__'.length),
            );
          else touchApiRef.current.handleFolderDrop(target);
        } else {
          touchApiRef.current.setDrag(null);
          touchApiRef.current.setDropTarget(null);
          touchApiRef.current.setNestTarget(null);
        }
        // 드래그 직후 합성 click이 프로젝트를 열지 않도록 잠깐 억제
        suppressClick = true;
        setTimeout(() => {
          suppressClick = false;
        }, 500);
      }
      cleanupTransient();
    };

    const onClick = (e: MouseEvent) => {
      if (suppressClick) {
        e.stopPropagation();
        e.preventDefault();
      }
    };

    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd, { passive: false });
    document.addEventListener('touchcancel', onEnd, { passive: false });
    document.addEventListener('click', onClick, true);
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
      document.removeEventListener('click', onClick, true);
      cleanupTransient();
    };
  }, []);

  // 드로어가 닫혀 있으면 여기서 렌더 종료. 모든 훅 호출 이후이므로 훅 순서가 안전하다
  // (터치 드래그용 useRef/useEffect를 조기 return보다 앞에 두기 위해 위치를 내렸다).
  if (!render) return null;

  // ===== 선택 모드 (다중 선택 → 폴더 일괄 이동) =====
  const toggleSelect = (n: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  };

  const exitSelect = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  const selectAllVisible = () => {
    const all = filter.trim() ? searchResults : sessionNames;
    setSelected(new Set(all));
  };

  const bulkMove = async () => {
    const count = selected.size;
    if (count === 0) return;
    const items: { text: string; value: string }[] = [
      { text: '📤 미분류로 이동', value: '__root__' },
      ...folders.map((f) => ({ text: '📁 ' + f, value: f })),
    ];
    const target = await appState.pushDialogAsync({
      type: 'select',
      text: `선택한 ${count}개 프로젝트 이동`,
      items,
    });
    if (!target) return;
    const folder = target === '__root__' ? null : target;
    for (const name of selected) {
      try {
        await sessionService.moveToFolder(name, folder);
      } catch (e) {}
    }
    exitSelect();
    appState.pushMessage(`${count}개 프로젝트를 이동했습니다.`);
  };

  // 프로젝트 행 공통 props. ProjectRow는 모듈 레벨에 정의해
  // 드래그 도중 setDrag 리렌더로 인한 언마운트/리마운트(드래그 중단)를 방지한다.
  const rowProps = (n: string) => ({
    name: n,
    dndEnabled: dndEnabled && !selectMode,
    dragging: drag?.type === 'project' && drag.name === n,
    selectMode,
    selected: selected.has(n),
    onSelect: () => (selectMode ? toggleSelect(n) : selectProject(n)),
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = 'move';
      e.stopPropagation();
      // Chromium은 dragstart 처리 중 레이아웃 변화로 원본이 밀리면 드래그를
      // 즉시 취소한다. setDrag 리렌더(넣기 존 삽입 등)를 드래그 확정 뒤로 미룬다.
      dragStartTimerRef.current = setTimeout(() =>
        setDrag({ type: 'project', name: n }),
      );
    },
    onDragEnd: () => {
      if (dragStartTimerRef.current) {
        clearTimeout(dragStartTimerRef.current);
        dragStartTimerRef.current = null;
      }
      setDrag(null);
      setDropTarget(null);
      setNestTarget(null);
    },
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const x = Math.min(e.clientX, window.innerWidth - 200);
      const y = Math.min(e.clientY, window.innerHeight - 100);
      setToolbar({ type: 'project', name: n, x, y });
    },
    onMenu: () => openProjectMenu(n),
    editing: editingProject === n,
    editValue: editingProject === n ? editProjectValue : '',
    onEditChange: setEditProjectValue,
    onEditCommit: commitProjectRename,
    onEditCancel: cancelProjectRename,
    onEditKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitProjectRename();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelProjectRename();
      }
    },
  });

  // 프로젝트 우클릭 툴바 핸들러
  const handleProjectExportImport = async (name: string) => {
    const sess = await sessionService.get(name);
    if (!sess) {
      appState.pushMessage('프로젝트를 불러올 수 없습니다.');
      return;
    }
    appState.curSession = sess;
    appState.projectBackupMenu();
  };

  const handleProjectClone = async (name: string) => {
    const sess = await sessionService.get(name);
    if (!sess) {
      appState.pushMessage('프로젝트를 불러올 수 없습니다.');
      return;
    }
    appState.curSession = sess;
    await appState.duplicateProject();
  };

  const handleProjectRename = (name: string) => {
    setEditingProject(name);
    setEditProjectValue(name);
  };

  const commitProjectRename = async () => {
    const old = editingProject;
    const newName = editProjectValue.trim();
    setEditingProject(null);
    if (!old || !newName || old === newName) return;
    if (sessionService.list().includes(newName)) {
      const conflictFolder = sessionService.getFolderOf(newName);
      const where = conflictFolder ? `"${conflictFolder}" 폴더에 ` : '';
      appState.pushMessage(`같은 이름의 프로젝트가 ${where}이미 존재합니다.`);
      return;
    }
    await sessionService.get(old);
    try {
      await sessionService.renameProject(old, newName);
    } catch (e: any) {
      appState.pushMessage(e.message || '프로젝트 이름변경에 실패했습니다.');
      return;
    }
    const sess = sessionService.getLoaded(newName);
    if (sess) {
      sess.name = newName;
    }
    appState.pushMessage('프로젝트 이름이 변경되었습니다.');
  };

  const cancelProjectRename = () => {
    setEditingProject(null);
  };

  const handleProjectSceneTemplateToggle = async (name: string) => {
    const before = templateService.isSceneTemplate(name);
    await templateService.toggleSceneTemplate(name);
    const after = templateService.isSceneTemplate(name);
    if (after !== before) {
      appState.pushMessage(
        after
          ? '씬 템플릿으로 지정되었습니다.'
          : '씬 템플릿 지정이 해제되었습니다.',
      );
    }
  };

  const handleProjectDelete = async (name: string) => {
    appState.pushDialog({
      type: 'confirm',
      text: `프로젝트 "${name}"을(를) 삭제할까요?\n휴지통으로 이동되어 복구할 수 있습니다.`,
      callback: async () => {
        await sessionService.get(name);
        await sessionService.delete(name);
        appState.pushMessage('프로젝트가 휴지통으로 이동되었습니다.');
      },
    });
  };

  return (
    <div
      className="fixed inset-0 titlebar-no-drag"
      style={{ zIndex: 'var(--z-drawer)' }}
      onClick={() => {
        // 떠 있는 컨텍스트 툴바를 닫는 클릭이면 드로어는 유지하고 툴바만 닫는다.
        if (toolbar) return;
        close();
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
        className="absolute left-0 top-0 h-full w-[90vw] max-w-[400px] bg-[var(--c-zone)] shadow-2xl border-r line-color flex flex-col"
        style={{
          transform: shown ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.26s cubic-bezier(0.4, 0, 0.2, 1)',
          willChange: 'transform',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-3 border-b line-color flex-none">
          <h2 className="text-lg font-semibold text-default">
            프로젝트
          </h2>
          <div className="flex items-center gap-2">
            {!selectMode && (
              <button
                onClick={() => setSelectMode(true)}
                className="text-sm px-2.5 py-1 rounded-md btn-neutral text-body"
              >
                선택
              </button>
            )}
            <button
              className="p-1.5 rounded-md hover:bg-gray-200 dark:hover:bg-slate-600 text-muted"
              onClick={close}
            >
              <FaTimes size={18} />
            </button>
          </div>
        </div>

        {/* 검색 */}
        <div className="px-3 pt-3 flex-none">
          <div className="relative">
            <FaSearch
              className="absolute left-3 top-1/2 -translate-y-1/2 text-faint"
              size={13}
            />
            <input
              type="text"
              placeholder="프로젝트 검색..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 rounded-lg border line-color bg-[var(--c-input-bg)] text-default text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
            />
          </div>
        </div>

        {/* 액션 */}
        {selectMode ? (
          <div className="px-3 py-2.5 flex items-center gap-2 flex-none">
            <span className="text-sm font-medium text-sky-600 dark:text-sky-400 flex-none">
              {selected.size}개 선택
            </span>
            <button
              onClick={selectAllVisible}
              className="btn-ghost px-2 py-1.5 rounded-lg text-sm text-muted"
            >
              전체 선택
            </button>
            <div className="flex-1" />
            <button
              onClick={bulkMove}
              disabled={selected.size === 0}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm btn-solid-sky disabled:opacity-40"
            >
              <FaFolder size={12} /> 이동
            </button>
            <button
              onClick={exitSelect}
              className="px-2.5 py-1.5 rounded-lg text-sm btn-neutral text-body"
            >
              취소
            </button>
          </div>
        ) : (
          <div className="px-3 py-2.5 flex gap-2 flex-none">
            <button
              onClick={() => createProject(null)}
              className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2.5 rounded-lg text-sm font-medium btn-solid-sky whitespace-nowrap"
            >
              <FaPlus size={12} /> 새 프로젝트
            </button>
            <Tooltip content="새 폴더 만들기">
              <button
                onClick={() => createFolder()}
                className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-medium btn-neutral text-body transition-colors whitespace-nowrap"
              >
                <FaFolderPlus size={14} />{' '}
                <span className="hidden md:inline">폴더</span>
              </button>
            </Tooltip>
            <Tooltip content="프로젝트 저장 공간 관리">
              <button
                onClick={() => setStorageOpen(true)}
                className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-medium btn-neutral text-body transition-colors whitespace-nowrap"
              >
                <FaHdd size={14} />{' '}
                <span className="hidden md:inline">관리</span>
              </button>
            </Tooltip>
            <Tooltip content="템플릿 관리 (새 프로젝트 시작 구성)">
              <button
                onClick={() => setTemplateManagerOpen(true)}
                className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-medium btn-neutral text-body transition-colors whitespace-nowrap"
              >
                <FaLayerGroup size={14} />{' '}
                <span className="hidden md:inline">템플릿</span>
              </button>
            </Tooltip>
            <Tooltip content="전체 백업 / 복원">
              <button
                onClick={() => appState.fullBackupMenu()}
                className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-medium btn-neutral text-body transition-colors whitespace-nowrap"
              >
                <FaFileArchive size={14} />{' '}
                <span className="hidden md:inline">백업</span>
              </button>
            </Tooltip>
          </div>
        )}

        {/* 목록 */}
        <div
          ref={listScrollRef}
          className="flex-1 overflow-y-auto min-h-0 px-2 pb-3"
        >
          {searching ? (
            <div>
              <div className="px-1 py-1 text-xs text-muted">
                검색 결과 ({searchResults.length})
              </div>
              {searchResults.length === 0 ? (
                <div className="text-sm text-faint text-center py-6">
                  결과가 없습니다
                </div>
              ) : (
                searchResults.map((n) => (
                  <ProjectRow key={n} showFolder {...rowProps(n)} />
                ))
              )}
            </div>
          ) : (
            <>
              {/* 즐겨찾기 (접기 가능, 기본 펼침) */}
              {favs.length > 0 && (
                <div
                  className="mb-1.5 rounded-md"
                  style={{
                    borderLeft: '3px solid #facc15',
                    backgroundColor: withAlpha('#facc15', '12'),
                  }}
                >
                  <button
                    onClick={() => toggleFolder('__favorites__')}
                    className="w-full flex items-center gap-2 pl-1.5 pr-2 py-2.5 text-[15px] font-semibold text-body"
                  >
                    {expanded.has('__favorites__') ? (
                      <FaChevronDown
                        size={12}
                        className="flex-none text-faint"
                      />
                    ) : (
                      <FaChevronRight
                        size={12}
                        className="flex-none text-faint"
                      />
                    )}
                    <span
                      className="flex items-center justify-center w-7 h-7 rounded-md flex-none"
                      style={{ backgroundColor: withAlpha('#facc15', '26') }}
                    >
                      <FaStar className="text-yellow-400" size={14} />
                    </span>
                    <span className="flex-1 text-left">즐겨찾기</span>
                    <span className="text-xs text-faint font-normal">
                      {favs.length}
                    </span>
                  </button>
                  {expanded.has('__favorites__') && (
                    <div className="pl-3 pb-1">
                      {favs.map((n) => (
                        <ProjectRow
                          key={'fav-' + n}
                          showFolder
                          {...rowProps(n)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 폴더들 */}
              {(() => {
                const rootFolders = folders.filter((f) => !f.includes('/'));
                const renderFolderNode = (
                  f: string,
                  depth: number,
                ): React.ReactNode => {
                  const projects = folderToProjects.get(f) || [];
                  // 서브폴더도 사용자 지정 순서(folderOrder)를 따르도록 정렬한다.
                  // getChildFolders 는 folderList 순이라 그대로 쓰면 순서변경이 반영 안 됨.
                  const childFolders = sessionService
                    .getChildFolders(f)
                    .slice()
                    .sort((a, b) => folders.indexOf(a) - folders.indexOf(b));
                  // 헤더 카운트는 하위 폴더에 속한 프로젝트까지 포함한 전체 개수.
                  const totalCount = sessionService.getProjectsInFolder(f).length;
                  const isOpen = expanded.has(f);
                  const color =
                    sessionService.getFolderColor(f) || DEFAULT_FOLDER_COLOR;
                  const picking = colorPickerFor === f;
                  const isDropping = dropTarget === f && canDropOnFolder(f);
                  const folderDragging =
                    drag?.type === 'folder' && drag.name === f;
                  const leafName = sessionService.folderLeafName(f);
                  const indentStyle =
                    depth > 0 ? { marginLeft: `${depth * 14}px` } : undefined;
                  return (
                    <div
                      key={f}
                      data-drop-folder={f}
                      className="mb-1.5 rounded-md transition-shadow"
                      style={{
                        borderLeft: `3px solid ${color}`,
                        boxShadow: isDropping
                          ? `inset 0 0 0 2px ${color}`
                          : undefined,
                        backgroundColor: isDropping
                          ? withAlpha(color, '26')
                          : withAlpha(color, '12'),
                        opacity: folderDragging ? 0.4 : undefined,
                        ...indentStyle,
                      }}
                      onContextMenu={
                        isMobile
                          ? undefined
                          : (e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              const x = Math.min(
                                e.clientX,
                                window.innerWidth - 56,
                              );
                              const y = Math.min(
                                e.clientY,
                                window.innerHeight - 290,
                              );
                              setToolbar({ type: 'folder', name: f, x, y });
                            }
                      }
                      onDragOver={(e) => {
                        if (drag && canDropOnFolder(f)) {
                          e.stopPropagation();
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                          setDropTarget(f);
                        }
                      }}
                      onDragLeave={(e) => {
                        e.stopPropagation();
                        if (
                          !e.currentTarget.contains(e.relatedTarget as Node)
                        ) {
                          setDropTarget((t) => (t === f ? null : t));
                        }
                      }}
                      onDrop={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        handleFolderDrop(f);
                      }}
                    >
                      {editingFolder === f ? (
                        <div className="flex items-center gap-1 pl-1.5 pr-1 py-1">
                          <span
                            className="flex items-center justify-center w-7 h-7 rounded-md flex-none"
                            style={{ backgroundColor: withAlpha(color, '26') }}
                          >
                            <FaFolder size={14} style={{ color }} />
                          </span>
                          <input
                            autoFocus
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                commitRename();
                              } else if (e.key === 'Escape') {
                                e.preventDefault();
                                cancelRename();
                              }
                            }}
                            className="flex-1 min-w-0 bg-[var(--c-surface)] border border-sky-400 rounded px-2 py-1.5 text-[15px] text-default outline-none"
                          />
                          <Tooltip content="저장">
                            <button
                              onClick={commitRename}
                              className="btn-ghost p-2 rounded-md flex-none text-green-500"
                            >
                              <FaCheck size={15} />
                            </button>
                          </Tooltip>
                          <Tooltip content="취소">
                            <button
                              onClick={cancelRename}
                              className="btn-ghost p-2 rounded-md flex-none text-faint"
                            >
                              <FaTimes size={15} />
                            </button>
                          </Tooltip>
                        </div>
                      ) : (
                        <div className="flex items-center gap-0.5 pl-1.5 pr-1">
                          <button
                            onClick={() => toggleFolder(f)}
                            data-drag-type={selectMode ? undefined : 'folder'}
                            data-drag-name={selectMode ? undefined : f}
                            draggable={dndEnabled && !selectMode}
                            onDragStart={(e) => {
                              e.dataTransfer.effectAllowed = 'move';
                              e.stopPropagation();
                              // setDrag가 위쪽 펼침 폴더들에 "넣기 존"을 삽입해
                              // 이 폴더가 아래로 밀리면 Chromium이 드래그를 즉시
                              // 취소한다 → 리렌더를 드래그 확정 뒤로 미룬다.
                              dragStartTimerRef.current = setTimeout(() =>
                                setDrag({ type: 'folder', name: f }),
                              );
                            }}
                            onDragEnd={(e) => {
                              e.stopPropagation();
                              if (dragStartTimerRef.current) {
                                clearTimeout(dragStartTimerRef.current);
                                dragStartTimerRef.current = null;
                              }
                              setDrag(null);
                              setDropTarget(null);
                              setNestTarget(null);
                            }}
                            className="flex-1 flex items-center gap-2 px-1 py-2.5 text-[15px] font-semibold text-body min-w-0"
                          >
                            {isOpen ? (
                              <FaChevronDown
                                size={12}
                                className="flex-none text-faint"
                              />
                            ) : (
                              <FaChevronRight
                                size={12}
                                className="flex-none text-faint"
                              />
                            )}
                            <span
                              className="flex items-center justify-center w-7 h-7 rounded-md flex-none"
                              style={{
                                backgroundColor: withAlpha(color, '26'),
                              }}
                            >
                              <FaFolder size={14} style={{ color }} />
                            </span>
                            <span className="truncate flex-1 text-left">
                              {leafName}
                            </span>
                            <span className="text-xs text-faint font-normal flex-none">
                              {totalCount}
                            </span>
                          </button>
                          {isMobile && (
                            <Tooltip content="폴더 메뉴">
                              <button
                                onClick={() => openFolderMenu(f)}
                                className="btn-ghost p-2 rounded-md flex-none text-muted"
                              >
                                <FaEllipsisV size={16} />
                              </button>
                            </Tooltip>
                          )}
                        </div>
                      )}
                      {picking && (
                        <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 bg-[var(--c-surface)] rounded-md mx-1 mb-1">
                          {FOLDER_COLORS.map((c) => {
                            const selected = color === c;
                            return (
                              <button
                                key={c}
                                onClick={() => pickColor(f, c)}
                                title={c}
                                className="w-7 h-7 rounded-full flex-none transition-transform hover:scale-110"
                                style={{
                                  backgroundColor: c,
                                  boxShadow: selected
                                    ? `0 0 0 2px #fff, 0 0 0 4px ${c}`
                                    : 'none',
                                }}
                              />
                            );
                          })}
                          <button
                            onClick={() => pickColor(f, null)}
                            className="px-2 h-7 rounded-md text-xs flex-none btn-neutral text-gray-600 dark:text-gray-200"
                          >
                            기본
                          </button>
                          {!isMobile ? (
                            <label
                              title="직접 색상 선택"
                              className="relative w-7 h-7 rounded-full flex-none cursor-pointer overflow-hidden border line-color transition-transform hover:scale-110"
                              style={{
                                background:
                                  'conic-gradient(red, orange, yellow, lime, cyan, blue, magenta, red)',
                              }}
                            >
                              <input
                                type="color"
                                defaultValue={
                                  /^#[0-9a-fA-F]{6}$/.test(color)
                                    ? color
                                    : '#0ea5e9'
                                }
                                onInput={(e) =>
                                  pickCustomColor(f, e.currentTarget.value)
                                }
                                onChange={(e) =>
                                  pickCustomColor(f, e.target.value)
                                }
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                              />
                            </label>
                          ) : (
                            <MobileColorPicker
                              initial={
                                /^#[0-9a-fA-F]{6}$/.test(color)
                                  ? color
                                  : '#0ea5e9'
                              }
                              onChange={(hex) => pickCustomColor(f, hex)}
                              onClose={() => setColorPickerFor(null)}
                            />
                          )}
                        </div>
                      )}
                      {isOpen && (
                        <div className="pb-1">
                          {/* 서브폴더로 넣기 존: 폴더를 드래그하는 동안, 이 폴더
                              안으로 넣을 수 있을 때만 표시(접힌 폴더엔 없음 → 중첩 불가) */}
                          {drag?.type === 'folder' && canNestInto(f) && (
                            <div
                              data-nest-folder={f}
                              onDragOver={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                e.dataTransfer.dropEffect = 'move';
                                setNestTarget(f);
                                setDropTarget((t) => (t === f ? null : t));
                              }}
                              onDragLeave={(e) => {
                                e.stopPropagation();
                                if (
                                  !e.currentTarget.contains(
                                    e.relatedTarget as Node,
                                  )
                                ) {
                                  setNestTarget((t) => (t === f ? null : t));
                                }
                              }}
                              onDrop={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                handleNestDrop(f);
                              }}
                              className="mx-1 mb-1.5 px-2 py-2 rounded-md border-2 border-dashed text-xs text-center transition-colors"
                              style={{
                                borderColor: color,
                                color,
                                backgroundColor:
                                  nestTarget === f
                                    ? withAlpha(color, '2e')
                                    : withAlpha(color, '14'),
                              }}
                            >
                              📁 여기에 놓아 "{leafName}" 안에 넣기
                            </div>
                          )}
                          {projects.length === 0 &&
                          childFolders.length === 0 ? (
                            <div className="text-xs text-faint px-2 py-1.5">
                              비어 있음
                            </div>
                          ) : (
                            <>
                              {projects.map((n) => (
                                <div className="pl-3" key={n}>
                                  <ProjectRow {...rowProps(n)} />
                                </div>
                              ))}
                            </>
                          )}
                          {childFolders.map((child) =>
                            renderFolderNode(child, depth + 1),
                          )}
                        </div>
                      )}
                    </div>
                  );
                };
                return rootFolders.map((f) => renderFolderNode(f, 0));
              })()}

              {/* 미분류 */}
              {(() => {
                const canDropUnfiled =
                  (drag?.type === 'project' &&
                    sessionService.getFolderOf(drag.name) !== null) ||
                  (drag?.type === 'folder' &&
                    sessionService.folderParentPath(drag.name) !== null);
                const unfiledDropping =
                  dropTarget === '__unfiled__' && canDropUnfiled;
                return (
                  <div
                    data-drop-unfiled="1"
                    className="mb-1 rounded-md transition-shadow"
                    style={{
                      borderLeft: '3px solid #94a3b8',
                      boxShadow: unfiledDropping
                        ? 'inset 0 0 0 2px #94a3b8'
                        : undefined,
                      backgroundColor: unfiledDropping
                        ? '#94a3b826'
                        : '#94a3b812',
                    }}
                    onDragOver={(e) => {
                      if (canDropUnfiled) {
                        e.stopPropagation();
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        setDropTarget('__unfiled__');
                      }
                    }}
                    onDragLeave={(e) => {
                      e.stopPropagation();
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                        setDropTarget((t) => (t === '__unfiled__' ? null : t));
                      }
                    }}
                    onDrop={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      handleUnfiledDrop();
                    }}
                  >
                    <button
                      onClick={() => toggleFolder('__unfiled__')}
                      className="w-full flex items-center gap-2 pl-1.5 pr-2 py-2.5 text-[15px] font-semibold text-body"
                    >
                      {expanded.has('__unfiled__') ? (
                        <FaChevronDown
                          size={11}
                          className="flex-none text-faint"
                        />
                      ) : (
                        <FaChevronRight
                          size={11}
                          className="flex-none text-faint"
                        />
                      )}
                      <span
                        className="flex items-center justify-center w-7 h-7 rounded-md flex-none"
                        style={{ backgroundColor: withAlpha('#94a3b8', '26') }}
                      >
                        <FaFolder className="text-faint" size={14} />
                      </span>
                      <span className="flex-1 text-left">미분류</span>
                      <span className="text-xs text-faint font-normal">
                        {unfiled.length}
                      </span>
                    </button>
                    {/* 서브폴더를 드래그하는 동안: 여기 놓으면 루트로 빠져나옴 안내 */}
                    {drag?.type === 'folder' &&
                      sessionService.folderParentPath(drag.name) !== null && (
                        <div className="px-2 pb-2 text-xs text-faint text-center">
                          여기에 놓으면 "{sessionService.folderLeafName(drag.name)}"
                          를 루트로 빼냅니다
                        </div>
                      )}
                    {expanded.has('__unfiled__') && (
                      <div className="pl-3 pb-1">
                        {unfiled.map((n) => (
                          <ProjectRow key={n} {...rowProps(n)} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
            </>
          )}
        </div>
      </div>
      {/* 저장 공간 관리 모달.
          - 드로어 패널은 transform이 걸려 있어(fixed가 패널 기준이 됨) 루트에 렌더링.
          - 루트의 onClick={close}로 전파되지 않도록 차단. */}
      {storageOpen && (
        <div onClick={(e) => e.stopPropagation()}>
          <StorageManageModal
            isOpen={storageOpen}
            onClose={() => setStorageOpen(false)}
            onJump={(name) => {
              setStorageOpen(false);
              selectProject(name);
            }}
          />
        </div>
      )}
      {/* 템플릿 관리 / 폴더 기본 템플릿 지정 / 수동 재적용 (프로젝트 상속 v2) —
          StorageManageModal 과 동일하게 루트 렌더 + 전파 차단 */}
      {templateManagerOpen && (
        <div onClick={(e) => e.stopPropagation()}>
          <TemplateManagerModal
            isOpen={templateManagerOpen}
            onClose={() => setTemplateManagerOpen(false)}
          />
        </div>
      )}
      {folderTemplateFor && (
        <div onClick={(e) => e.stopPropagation()}>
          <FolderTemplateModal
            folder={folderTemplateFor}
            isOpen={!!folderTemplateFor}
            onClose={() => setFolderTemplateFor(null)}
            onOpenManager={() => setTemplateManagerOpen(true)}
          />
        </div>
      )}
      {reapplyFor && (
        <div onClick={(e) => e.stopPropagation()}>
          <ReapplyTemplateModal
            target={reapplyFor}
            isOpen={!!reapplyFor}
            onClose={() => setReapplyFor(null)}
          />
        </div>
      )}
      {toolbar &&
        createPortal(
          toolbar.type === 'folder' ? (
            <div
              id="floating-folder-toolbar"
              className="fixed z-[var(--z-context-menu)] flex items-center gap-0.5 p-1.5 bg-[var(--c-surface-2)] rounded-lg shadow-xl border line-color"
              style={{ left: toolbar.x, top: toolbar.y }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <Tooltip content="내보내기/불러오기">
                <button
                  onClick={() => {
                    appState.folderBackupMenu(toolbar.name);
                    setToolbar(null);
                  }}
                  className="btn-ghost p-2 rounded-md text-faint hover:text-amber-500"
                >
                  <FaFileExport size={14} />
                </button>
              </Tooltip>
              <Tooltip content="폴더 복제">
                <button
                  onClick={() => {
                    cloneFolder(toolbar.name);
                    setToolbar(null);
                  }}
                  className="btn-ghost p-2 rounded-md text-faint hover:text-green-500"
                >
                  <FaCopy size={14} />
                </button>
              </Tooltip>
              <Tooltip content="폴더 색상">
                <button
                  onClick={() => {
                    setColorPickerFor((p) =>
                      p === toolbar.name ? null : toolbar.name,
                    );
                    setToolbar(null);
                  }}
                  className="btn-ghost p-2 rounded-md text-faint hover:text-sky-500"
                >
                  <FaPalette size={15} />
                </button>
              </Tooltip>
              <Tooltip content="이름 편집">
                <button
                  onClick={() => {
                    startRename(toolbar.name);
                    setToolbar(null);
                  }}
                  className="btn-ghost p-2 rounded-md text-faint hover:text-sky-500"
                >
                  <FaPen size={15} />
                </button>
              </Tooltip>
              <Tooltip content="폴더 삭제">
                <button
                  onClick={() => {
                    deleteFolderConfirm(toolbar.name);
                    setToolbar(null);
                  }}
                  className="btn-ghost p-2 rounded-md text-faint hover:text-red-500"
                >
                  <FaTrashAlt size={15} />
                </button>
              </Tooltip>
              <Tooltip content="새 프로젝트">
                <button
                  onClick={() => {
                    createProject(toolbar.name);
                    setToolbar(null);
                  }}
                  className="btn-ghost p-2 rounded-md text-faint hover:text-sky-500"
                >
                  <FaPlus size={15} />
                </button>
              </Tooltip>
              <Tooltip content="서브폴더 만들기">
                <button
                  onClick={() => {
                    createFolder(toolbar.name);
                    setToolbar(null);
                  }}
                  className="btn-ghost p-2 rounded-md text-faint hover:text-indigo-500"
                >
                  <FaFolderPlus size={13} />
                </button>
              </Tooltip>
              <Tooltip
                content={
                  templateService.getFolderTemplate(toolbar.name)
                    ? '기본 템플릿 (지정됨)'
                    : '기본 템플릿'
                }
              >
                <button
                  onClick={() => {
                    setFolderTemplateFor(toolbar.name);
                    setToolbar(null);
                  }}
                  className="btn-ghost p-2 rounded-md text-faint hover:text-purple-500"
                >
                  <FaMagic size={14} />
                </button>
              </Tooltip>
            </div>
          ) : (
            <div
              id="floating-project-toolbar"
              className="fixed z-[var(--z-context-menu)] flex items-center gap-0.5 p-1.5 bg-[var(--c-surface-2)] rounded-lg shadow-xl border line-color"
              style={{ left: toolbar.x, top: toolbar.y }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <Tooltip content="내보내기/불러오기">
                <button
                  onClick={() => {
                    handleProjectExportImport(toolbar.name);
                    setToolbar(null);
                  }}
                  className="btn-ghost p-2 rounded-md text-faint hover:text-amber-500"
                >
                  <FaFileExport size={14} />
                </button>
              </Tooltip>
              <Tooltip content="프로젝트 복제">
                <button
                  onClick={() => {
                    handleProjectClone(toolbar.name);
                    setToolbar(null);
                  }}
                  className="btn-ghost p-2 rounded-md text-faint hover:text-green-500"
                >
                  <FaCopy size={14} />
                </button>
              </Tooltip>
              <Tooltip content="이름 편집">
                <button
                  onClick={() => {
                    handleProjectRename(toolbar.name);
                    setToolbar(null);
                  }}
                  className="btn-ghost p-2 rounded-md text-faint hover:text-sky-500"
                >
                  <FaPen size={15} />
                </button>
              </Tooltip>
              <Tooltip
                content={
                  templateService.isSceneTemplate(toolbar.name)
                    ? '씬 템플릿 해제'
                    : '씬 템플릿으로 지정'
                }
              >
                <button
                  onClick={() => {
                    handleProjectSceneTemplateToggle(toolbar.name);
                    setToolbar(null);
                  }}
                  className="btn-ghost p-2 rounded-md text-faint hover:text-purple-500"
                >
                  <FaThLarge size={14} />
                </button>
              </Tooltip>
              <Tooltip content="템플릿 적용 (덮어쓰기)">
                <button
                  onClick={() => {
                    setReapplyFor(toolbar.name);
                    setToolbar(null);
                  }}
                  className="btn-ghost p-2 rounded-md text-faint hover:text-purple-500"
                >
                  <FaFileImport size={14} />
                </button>
              </Tooltip>
              <Tooltip content="프로젝트 삭제">
                <button
                  onClick={() => {
                    handleProjectDelete(toolbar.name);
                    setToolbar(null);
                  }}
                  className="btn-ghost p-2 rounded-md text-faint hover:text-red-500"
                >
                  <FaTrashAlt size={15} />
                </button>
              </Tooltip>
            </div>
          ),
          document.body,
        )}
    </div>
  );
});

export default ProjectDrawer;
