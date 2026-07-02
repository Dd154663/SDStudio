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
} from 'react-icons/fa';
import { sessionService, imageService, isMobile } from '../models';
import { appState } from '../models/AppService';
import Tooltip from './Tooltip';
import MobileColorPicker from './MobileColorPicker';
import { pushRecentProject } from './ProjectBrowser';
import StorageManageModal from './StorageManageModal';

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
              className="p-2 rounded-md flex-none text-green-500 hover:bg-gray-100 dark:hover:bg-slate-700"
            >
              <FaCheck size={15} />
            </button>
          </Tooltip>
          <Tooltip content="취소">
            <button
              onClick={onEditCancel}
              className="p-2 rounded-md flex-none text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700"
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
        {folder && (
          <span
            className={`text-xs flex-none flex items-center gap-1 ${
              active ? 'text-sky-100' : 'text-gray-400'
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
                : 'text-gray-400 hover:bg-black/10 dark:hover:bg-white/10'
            }`}
          >
            <FaEllipsisV size={15} />
          </span>
        )}
      </button>
    );
  },
);

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
  // 선택 모드(다중 선택 → 폴더 일괄 이동)
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 드래그&드롭 상태 (PC 전용)
  const [drag, setDrag] = useState<{
    type: 'project' | 'folder';
    name: string;
  } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
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

  // 열림/닫힘 트랜지션 제어
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

  // 열릴 때마다 현재 프로젝트의 폴더 자동 펼침 + 검색/색상선택 초기화
  useEffect(() => {
    if (!open) return;
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
    try {
      await sessionService.add(name);
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
  };

  // 모바일: 프로젝트 행의 메뉴 아이콘에서 여는 액션 메뉴(폴더 메뉴와 동일 패턴)
  const openProjectMenu = async (n: string) => {
    const v = await appState.pushDialogAsync({
      type: 'select',
      text: `프로젝트 "${n}"`,
      items: [
        { text: '📤 내보내기/불러오기', value: 'export' },
        { text: '📋 프로젝트 복제', value: 'clone' },
        { text: '✏️ 이름 편집', value: 'rename' },
        { text: '🗑️ 프로젝트 삭제', value: 'delete' },
      ],
    });
    if (!v) return;
    if (v === 'export') handleProjectExportImport(n);
    else if (v === 'clone') handleProjectClone(n);
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

  // 폴더 헤더에 드롭: 폴더면 재부모화 or 순서변경, 프로젝트면 폴더로 이동
  const handleFolderDrop = async (targetFolder: string) => {
    const d = drag;
    setDrag(null);
    setDropTarget(null);
    if (!d) return;
    if (d.type === 'folder') {
      const source = d.name;
      if (source === targetFolder) return;
      const srcParent = sessionService.folderParentPath(source);
      const tgtParent = sessionService.folderParentPath(targetFolder);
      if (srcParent === tgtParent) {
        reorderFolders(source, targetFolder);
      } else {
        const leaf = sessionService.folderLeafName(source);
        const newPath = targetFolder + '/' + leaf;
        try {
          await sessionService.renameFolder(source, newPath);
        } catch (e: any) {
          appState.pushMessage(e?.message || '폴더 이동에 실패했습니다.');
        }
      }
    } else moveProjectTo(d.name, targetFolder);
  };

  // 미분류 헤더에 드롭: 프로젝트만 (폴더에서 빼내기)
  const handleUnfiledDrop = () => {
    const d = drag;
    setDrag(null);
    setDropTarget(null);
    if (!d || d.type !== 'project') return;
    moveProjectTo(d.name, null);
  };

  const dndEnabled = !isMobile;

  // 드롭 가능 여부 판정 (시각 피드백용)
  const canDropOnFolder = (f: string) =>
    drag != null &&
    (drag.type === 'project'
      ? sessionService.getFolderOf(drag.name) !== f
      : drag.name !== f && !f.startsWith(drag.name + '/'));

  // ===== 모바일 터치 드래그 (롱프레스로 잡아 폴더로 이동/재정렬) =====
  // PC는 HTML5 draggable을 그대로 쓰지만 그것은 터치를 지원하지 않으므로, 모바일은 별도
  // 터치 핸들러로 구현한다. 드롭 처리는 기존 handleFolderDrop/handleUnfiledDrop 재사용.
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const touchApiRef = useRef({
    handleFolderDrop,
    handleUnfiledDrop,
    setDrag,
    setDropTarget,
  });
  touchApiRef.current = {
    handleFolderDrop,
    handleUnfiledDrop,
    setDrag,
    setDropTarget,
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
        return (
          cand.type === 'project' &&
          sessionService.getFolderOf(cand.name) !== null
        );
      if (!f) return false;
      return cand.type === 'project'
        ? sessionService.getFolderOf(cand.name) !== f
        : cand.name !== f && !f.startsWith(cand.name + '/');
    };

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
      const folderEl = el?.closest('[data-drop-folder]') as HTMLElement | null;
      if (folderEl && st.cand) {
        const f = folderEl.getAttribute('data-drop-folder')!;
        if (canDrop(st.cand, 'folder', f)) target = f;
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
        touchApiRef.current.setDropTarget(target);
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
        'position:fixed;left:0;top:0;z-index:99999;pointer-events:none;' +
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
          else touchApiRef.current.handleFolderDrop(target);
        } else {
          touchApiRef.current.setDrag(null);
          touchApiRef.current.setDropTarget(null);
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
      setDrag({ type: 'project', name: n });
      e.dataTransfer.effectAllowed = 'move';
      e.stopPropagation();
    },
    onDragEnd: () => {
      setDrag(null);
      setDropTarget(null);
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
    await imageService.onRenameSession(old, newName);
    await sessionService.rename(old, newName);
    const sess = sessionService.resources[newName];
    if (sess) {
      sess.name = newName;
    }
    appState.pushMessage('프로젝트 이름이 변경되었습니다.');
  };

  const cancelProjectRename = () => {
    setEditingProject(null);
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
      style={{ zIndex: 2100 }}
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
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
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
              className="px-2 py-1.5 rounded-lg text-sm text-muted hover:bg-gray-100 dark:hover:bg-slate-700"
            >
              전체 선택
            </button>
            <div className="flex-1" />
            <button
              onClick={bulkMove}
              disabled={selected.size === 0}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm bg-sky-500 hover:bg-sky-600 text-white disabled:opacity-40"
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
              className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2.5 rounded-lg text-sm font-medium bg-sky-500 hover:bg-sky-600 text-white transition-colors whitespace-nowrap"
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
                <div className="text-sm text-gray-400 text-center py-6">
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
                        className="flex-none text-gray-400"
                      />
                    ) : (
                      <FaChevronRight
                        size={12}
                        className="flex-none text-gray-400"
                      />
                    )}
                    <span
                      className="flex items-center justify-center w-7 h-7 rounded-md flex-none"
                      style={{ backgroundColor: withAlpha('#facc15', '26') }}
                    >
                      <FaStar className="text-yellow-400" size={14} />
                    </span>
                    <span className="flex-1 text-left">즐겨찾기</span>
                    <span className="text-xs text-gray-400 font-normal">
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
                  const childFolders = sessionService.getChildFolders(f);
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
                              className="p-2 rounded-md flex-none text-green-500 hover:bg-gray-100 dark:hover:bg-slate-700"
                            >
                              <FaCheck size={15} />
                            </button>
                          </Tooltip>
                          <Tooltip content="취소">
                            <button
                              onClick={cancelRename}
                              className="p-2 rounded-md flex-none text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700"
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
                              setDrag({ type: 'folder', name: f });
                              e.dataTransfer.effectAllowed = 'move';
                              e.stopPropagation();
                            }}
                            onDragEnd={(e) => {
                              e.stopPropagation();
                              setDrag(null);
                              setDropTarget(null);
                            }}
                            className="flex-1 flex items-center gap-2 px-1 py-2.5 text-[15px] font-semibold text-body min-w-0"
                          >
                            {isOpen ? (
                              <FaChevronDown
                                size={12}
                                className="flex-none text-gray-400"
                              />
                            ) : (
                              <FaChevronRight
                                size={12}
                                className="flex-none text-gray-400"
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
                            <span className="text-xs text-gray-400 font-normal flex-none">
                              {projects.length}
                            </span>
                          </button>
                          {isMobile && (
                            <Tooltip content="폴더 메뉴">
                              <button
                                onClick={() => openFolderMenu(f)}
                                className="p-2 rounded-md flex-none text-muted hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
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
                          {projects.length === 0 &&
                          childFolders.length === 0 ? (
                            <div className="text-xs text-gray-400 px-2 py-1.5">
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
                  drag?.type === 'project' &&
                  sessionService.getFolderOf(drag.name) !== null;
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
                          className="flex-none text-gray-400"
                        />
                      ) : (
                        <FaChevronRight
                          size={11}
                          className="flex-none text-gray-400"
                        />
                      )}
                      <span
                        className="flex items-center justify-center w-7 h-7 rounded-md flex-none"
                        style={{ backgroundColor: withAlpha('#94a3b8', '26') }}
                      >
                        <FaFolder className="text-gray-400" size={14} />
                      </span>
                      <span className="flex-1 text-left">미분류</span>
                      <span className="text-xs text-gray-400 font-normal">
                        {unfiled.length}
                      </span>
                    </button>
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
      {toolbar &&
        createPortal(
          toolbar.type === 'folder' ? (
            <div
              id="floating-folder-toolbar"
              className="fixed z-[9999] flex items-center gap-0.5 p-1.5 bg-[var(--c-surface-2)] rounded-lg shadow-xl border line-color"
              style={{ left: toolbar.x, top: toolbar.y }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <Tooltip content="내보내기/불러오기">
                <button
                  onClick={() => {
                    appState.folderBackupMenu(toolbar.name);
                    setToolbar(null);
                  }}
                  className="p-2 rounded-md text-gray-400 hover:text-amber-500 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
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
                  className="p-2 rounded-md text-gray-400 hover:text-green-500 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
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
                  className="p-2 rounded-md text-gray-400 hover:text-sky-500 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
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
                  className="p-2 rounded-md text-gray-400 hover:text-sky-500 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
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
                  className="p-2 rounded-md text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
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
                  className="p-2 rounded-md text-gray-400 hover:text-sky-500 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
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
                  className="p-2 rounded-md text-gray-400 hover:text-indigo-500 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
                >
                  <FaFolderPlus size={13} />
                </button>
              </Tooltip>
            </div>
          ) : (
            <div
              id="floating-project-toolbar"
              className="fixed z-[9999] flex items-center gap-0.5 p-1.5 bg-[var(--c-surface-2)] rounded-lg shadow-xl border line-color"
              style={{ left: toolbar.x, top: toolbar.y }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <Tooltip content="내보내기/불러오기">
                <button
                  onClick={() => {
                    handleProjectExportImport(toolbar.name);
                    setToolbar(null);
                  }}
                  className="p-2 rounded-md text-gray-400 hover:text-amber-500 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
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
                  className="p-2 rounded-md text-gray-400 hover:text-green-500 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
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
                  className="p-2 rounded-md text-gray-400 hover:text-sky-500 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
                >
                  <FaPen size={15} />
                </button>
              </Tooltip>
              <Tooltip content="프로젝트 삭제">
                <button
                  onClick={() => {
                    handleProjectDelete(toolbar.name);
                    setToolbar(null);
                  }}
                  className="p-2 rounded-md text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
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
