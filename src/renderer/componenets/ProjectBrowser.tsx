import React, { useState, useEffect, useCallback, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { FaStar, FaSearch, FaFolder, FaPlus, FaEllipsisV, FaCheck, FaPen, FaTrashAlt, FaTimes, FaPalette, FaFileExport, FaCopy, FaChevronDown, FaChevronRight, FaFolderPlus } from 'react-icons/fa';
import { sessionService, imageService, isMobile } from '../models';
import { appState } from '../models/AppService';
import { projectPath } from '../models/projectPaths';
import ModalOverlay from './ModalOverlay';
import Tooltip from './Tooltip';
import MobileColorPicker from './MobileColorPicker';
// 폴더 색상 팔레트 (단일 출처 folderColors.ts — 드로어와 동일)
import {
  FOLDER_COLORS,
  DEFAULT_FOLDER_COLOR,
  withAlpha,
} from './folderColors';

const RECENT_KEY = 'sdstudio-recent-projects';
const RECENT_MAX = 5;

export function pushRecentProject(name: string) {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    let list: string[] = raw ? JSON.parse(raw) : [];
    list = list.filter((n) => n !== name);
    list.unshift(name);
    if (list.length > RECENT_MAX) list.length = RECENT_MAX;
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {}
}

function getRecentProjects(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

// 한글 + 숫자 혼합 자연 정렬
const naturalCmp = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

// 폴더 뷰 식별자: 'all' | 'fav' | 'unfiled' | 폴더이름
type FolderView = string;

// 프로젝트 카드 썸네일
const ProjectThumbnail = ({ name }: { name: string }) => {
  const [image, setImage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchByRef = async (ref: { scene: string; image: string }) => {
      try {
        return (
          (await imageService.fetchImageSmall(
            projectPath('outs', name, ref.scene, ref.image),
            200,
          )) ?? undefined
        );
      } catch {
        return undefined;
      }
    };
    (async () => {
      try {
        // 1) 캐시 적중 → 세션 풀로딩 없이 바로 표시
        let ref = sessionService.getThumbnailRef(name);
        let small: string | undefined;
        if (ref) small = await fetchByRef(ref);
        // 2) 미스 또는 stale(이미지 삭제 등) → 1회 해석 후 캐시
        if (!small) {
          const resolved = await sessionService.resolveThumbnail(name);
          if (resolved) {
            sessionService.setThumbnailRef(name, resolved.scene, resolved.image);
            small = await fetchByRef(resolved);
          } else {
            sessionService.clearThumbnailRef(name);
          }
        }
        if (!cancelled && small) setImage(small);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [name]);

  if (!image) {
    return (
      <div className="w-full aspect-[3/4] bg-[var(--c-surface)] rounded-md" />
    );
  }
  return (
    <img
      src={image}
      className="w-full aspect-[3/4] object-cover rounded-md"
      draggable={false}
    />
  );
};

// 프로젝트 카드
const ProjectCard = ({
  name,
  isFav,
  isActive,
  isSelected,
  folder,
  onSelect,
  onToggleFav,
  onMove,
  draggable,
  onDragStart,
  onDragEnd,
  isDragging,
}: {
  name: string;
  isFav: boolean;
  isActive: boolean;
  isSelected?: boolean;
  folder: string | null;
  onSelect: () => void;
  onToggleFav: () => void;
  onMove: () => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  isDragging?: boolean;
}) => {
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart ? (e: React.DragEvent) => { e.stopPropagation(); onDragStart(e); } : undefined}
      onDragEnd={onDragEnd ? (e: React.DragEvent) => { e.stopPropagation(); onDragEnd(e); } : undefined}
      style={isDragging ? { opacity: 0.4 } : undefined}
      className={`cursor-pointer rounded-lg border-2 overflow-hidden transition-all hover:brightness-95 active:brightness-90 ${
        isSelected
          ? 'border-sky-500 ring-2 ring-sky-400'
          : isActive
            ? 'border-sky-500 ring-2 ring-sky-300'
            : isFav
              ? 'border-yellow-400'
              : 'line-color'
      }`}
      onClick={onSelect}
    >
      <div className="relative">
        <ProjectThumbnail name={name} />
        {isSelected && (
          <div className="absolute inset-0 bg-sky-500/30 p-1">
            <div className="bg-sky-500 text-white rounded-full w-5 h-5 flex items-center justify-center">
              <FaCheck size={10} />
            </div>
          </div>
        )}
      </div>
      <div className="px-2 py-2 bg-[var(--c-surface-2)] flex items-center gap-1">
        <Tooltip content={isFav ? '즐겨찾기 해제' : '즐겨찾기'}>
        <button
          className="flex-none text-sm"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFav();
          }}
        >
          <FaStar className={isFav ? 'text-yellow-400' : 'text-gray-300 dark:text-slate-600'} size={15} />
        </button>
        </Tooltip>
        <span className="text-[15px] text-default truncate flex-1">{name}</span>
        <Tooltip content="폴더로 이동">
        <button
          className="flex-none text-faint hover:text-gray-700 dark:hover:text-gray-200 px-0.5"
          onClick={(e) => {
            e.stopPropagation();
            onMove();
          }}
        >
          <FaEllipsisV size={14} />
        </button>
        </Tooltip>
      </div>
    </div>
  );
};

// 폴더 내비게이션 항목
const NavItem = ({
  active,
  onClick,
  icon,
  label,
  count,
  draggable,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  dropping,
  dragging,
  tint,
  onExport,
  onClone,
  onColor,
  colorActive,
  onRename,
  onDelete,
  onAddProject,
  onSubfolder,
  onMenu,
  editing,
  editValue,
  onEditChange,
  onEditCommit,
  onEditCancel,
}: {
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  label: string;
  count?: number;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  dropping?: boolean;
  dragging?: boolean;
  tint?: string;
  onExport?: () => void;
  onClone?: () => void;
  onColor?: () => void;
  colorActive?: boolean;
  onRename?: () => void;
  onDelete?: () => void;
  onAddProject?: () => void;
  onSubfolder?: () => void;
  onMenu?: () => void;
  editing?: boolean;
  editValue?: string;
  onEditChange?: (v: string) => void;
  onEditCommit?: () => void;
  onEditCancel?: () => void;
}) => {
  // 인라인 편집 모드: 라벨이 입력창으로 바뀌고 저장(V)/취소 버튼 노출
  if (editing) {
    return (
      <div className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[15px] whitespace-nowrap flex-none md:w-full bg-[var(--c-surface)] ring-2 ring-sky-400">
        {icon}
        <input
          autoFocus
          value={editValue}
          onChange={(e) => onEditChange?.(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onEditCommit?.();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onEditCancel?.();
            }
          }}
          onClick={(e) => e.stopPropagation()}
          className="w-24 md:w-auto md:flex-1 min-w-0 bg-transparent outline-none text-default text-sm"
        />
        <Tooltip content="저장">
        <span
          role="button"
          onClick={(e) => {
            e.stopPropagation();
            onEditCommit?.();
          }}
          className="text-green-500 hover:text-green-600 px-0.5"
        >
          <FaCheck size={13} />
        </span>
        </Tooltip>
        <Tooltip content="취소">
        <span
          role="button"
          onClick={(e) => {
            e.stopPropagation();
            onEditCancel?.();
          }}
          className="text-faint hover:text-gray-600 dark:hover:text-gray-200 px-0.5"
        >
          <FaTimes size={13} />
        </span>
        </Tooltip>
      </div>
    );
  }
  return (
    <button
      onClick={onClick}
      draggable={draggable}
      onDragStart={onDragStart ? (e: React.DragEvent) => { e.stopPropagation(); onDragStart(e); } : undefined}
      onDragEnd={onDragEnd ? (e: React.DragEvent) => { e.stopPropagation(); onDragEnd(e); } : undefined}
      onDragOver={onDragOver ? (e: React.DragEvent) => { e.stopPropagation(); onDragOver(e); } : undefined}
      onDragLeave={onDragLeave ? (e: React.DragEvent) => { e.stopPropagation(); onDragLeave(e); } : undefined}
      onDrop={onDrop ? (e: React.DragEvent) => { e.stopPropagation(); onDrop(e); } : undefined}
      style={{
        ...(dragging ? { opacity: 0.4 } : {}),
        ...(tint && !active ? { backgroundColor: withAlpha(tint, '26') } : {}),
      }}
      className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-[15px] whitespace-nowrap transition-colors flex-none md:w-full ${
        dropping ? 'ring-2 ring-sky-400 ' : ''
      }${
        active
          ? 'bg-sky-500 text-white'
          : 'btn-neutral text-body'
      }`}
    >
      {icon}
      <span className="truncate min-w-0 max-w-[7rem] md:max-w-none md:flex-1 text-left">{label}</span>
      {count != null && (
        <span className={`text-xs flex-none ${active ? 'text-sky-100' : 'text-faint dark:text-faint'}`}>
          {count}
        </span>
      )}
      {onMenu && isMobile ? (
        /* 모바일: ⋮ 메뉴 버튼 하나로 폴더 동작 5종 노출 */
        <Tooltip content="폴더 메뉴">
        <span
          role="button"
          onClick={(e) => {
            e.stopPropagation();
            onMenu();
          }}
          className={`ml-1 flex-none px-1.5 py-0.5 ${active ? 'text-white' : 'text-muted'}`}
        >
          <FaEllipsisV size={15} />
        </span>
        </Tooltip>
      ) : (
        <>
          {onExport && (
            <Tooltip content="폴더 내보내기/불러오기">
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                onExport();
              }}
              className={`ml-0.5 flex-none opacity-60 hover:opacity-100 ${
                active ? 'text-white' : 'hover:text-amber-500'
              }`}
            >
              <FaFileExport size={11} />
            </span>
            </Tooltip>
          )}
          {onClone && (
            <Tooltip content="폴더 복제">
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                onClone();
              }}
              className={`ml-0.5 flex-none opacity-60 hover:opacity-100 ${
                active ? 'text-white' : 'hover:text-green-500'
              }`}
            >
              <FaCopy size={11} />
            </span>
            </Tooltip>
          )}
          {onColor && (
            <Tooltip content="폴더 색상">
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                onColor();
              }}
              className={`ml-0.5 flex-none opacity-60 hover:opacity-100 ${
                active ? 'text-white' : colorActive ? 'text-sky-500 opacity-100' : ''
              }`}
            >
              <FaPalette size={12} />
            </span>
            </Tooltip>
          )}
          {onRename && (
            <Tooltip content="이름 편집">
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                onRename();
              }}
              className={`flex-none opacity-60 hover:opacity-100 ${active ? 'text-white' : ''}`}
            >
              <FaPen size={11} />
            </span>
            </Tooltip>
          )}
          {onDelete && (
            <Tooltip content="폴더 삭제">
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className={`flex-none opacity-60 hover:opacity-100 ${active ? 'text-white' : 'hover:text-red-500'}`}
            >
              <FaTrashAlt size={11} />
            </span>
            </Tooltip>
          )}
          {onAddProject && (
            <Tooltip content="이 폴더에 새 프로젝트">
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                onAddProject();
              }}
              className={`flex-none opacity-60 hover:opacity-100 ${active ? 'text-white' : 'hover:text-sky-500'}`}
            >
              <FaPlus size={11} />
            </span>
            </Tooltip>
          )}
          {onSubfolder && (
            <Tooltip content="서브폴더 만들기">
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                onSubfolder();
              }}
              className={`flex-none opacity-60 hover:opacity-100 ${active ? 'text-white' : 'hover:text-indigo-500'}`}
            >
              <FaFolderPlus size={11} />
            </span>
            </Tooltip>
          )}
        </>
      )}
    </button>
  );
};

const ProjectBrowser = observer(({ onClose }: { onClose: () => void }) => {
  const [filter, setFilter] = useState('');
  const [sessionNames, setSessionNames] = useState<string[]>([]);
  const [view, setView] = useState<FolderView>('all');
  const [, setVersion] = useState(0);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<{ type: 'project' | 'folder'; name: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [editingFolder, setEditingFolder] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [colorPickerFor, setColorPickerFor] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const filterRef = useRef<HTMLInputElement>(null);
  const dndEnabled = !isMobile;

  const refresh = useCallback(() => {
    setSessionNames(sessionService.list());
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    refresh();
    if (!isMobile) setTimeout(() => filterRef.current?.focus(), 100);
    const onUpdate = () => refresh();
    sessionService.addEventListener('listupdated', onUpdate);
    return () => sessionService.removeEventListener('listupdated', onUpdate);
  }, [refresh]);

  // Ctrl+E로 닫기: 그리드는 검색창 자동 포커스 때문에 전역 단축키가 억제되므로
  // 그리드가 열려 있을 때의 닫기 토글은 여기서 직접 처리한다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const folders = sessionService.getOrderedFolders();

  // 선택된 폴더 뷰가 사라졌으면 전체로 복귀
  useEffect(() => {
    if (
      view !== 'all' &&
      view !== 'fav' &&
      view !== 'unfiled' &&
      !folders.includes(view)
    ) {
      setView('all');
    }
  }, [view, folders]);

  const curName = appState.curSession?.name;
  const recentProjects = getRecentProjects().filter((n) => sessionNames.includes(n));

  const inView = useCallback(
    (v: FolderView, name: string) => {
      if (v === 'all') return true;
      if (v === 'fav') return sessionService.isFavorite(name);
      if (v === 'unfiled') return sessionService.getFolderOf(name) === null;
      const f = sessionService.getFolderOf(name);
      return f === v || (f !== null && f.startsWith(v + '/'));
    },
    [],
  );

  const countIn = (v: FolderView) => sessionNames.filter((n) => inView(v, n)).length;

  const allSorted = [...sessionNames].sort((a, b) => {
    const aFav = sessionService.isFavorite(a);
    const bFav = sessionService.isFavorite(b);
    if (aFav !== bFav) return aFav ? -1 : 1;
    return naturalCmp(a, b);
  });

  const filtered = allSorted
    .filter((n) => inView(view, n))
    .filter((n) => (filter.trim() ? n.toLowerCase().includes(filter.toLowerCase()) : true));

  const selectProject = useCallback(async (name: string) => {
    const session = await sessionService.get(name);
    if (session) {
      imageService.refreshBatch(session);
      appState.curSession = session;
      pushRecentProject(name);
    }
    onClose();
  }, [onClose]);

  const toggleFav = useCallback((name: string) => {
    sessionService.toggleFavorite(name);
    refresh();
  }, [refresh]);

  // A1: 현재 폴더 뷰에 새 프로젝트 생성 (폴더 뷰가 아니면 루트)
  const createProjectInView = useCallback(async () => {
    const folder =
      view !== 'all' && view !== 'fav' && view !== 'unfiled' ? view : null;
    const name = await appState.pushDialogAsync({
      type: 'input-confirm',
      text: folder ? `"${folder}" 폴더에 새 프로젝트 이름` : '신규 프로젝트 이름',
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
      refresh();
      appState.pushMessage(`프로젝트 "${name}"을(를) 만들었습니다.`);
    } catch (e: any) {
      appState.pushMessage(e.message || '프로젝트 생성에 실패했습니다.');
    }
  }, [view, refresh]);

  // 특정 폴더에 새 프로젝트 생성 (메뉴/버튼 공용)
  const createProjectInFolder = useCallback(async (folder: string) => {
    const name = await appState.pushDialogAsync({
      type: 'input-confirm',
      text: `"${folder}" 폴더에 새 프로젝트 이름`,
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
      try {
        await sessionService.moveToFolder(name, folder);
      } catch (e) {}
      refresh();
      appState.pushMessage(`프로젝트 "${name}"을(를) 만들었습니다.`);
    } catch (e: any) {
      appState.pushMessage(e.message || '프로젝트 생성에 실패했습니다.');
    }
  }, [refresh]);

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
    else if (v === 'add') createProjectInFolder(f);
    else if (v === 'subfolder') createFolder(f);
  };

  // A3: 다중 선택 일괄 이동
  const toggleSelect = useCallback((name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const exitSelect = useCallback(() => {
    setSelectMode(false);
    setSelected(new Set());
  }, []);

  const bulkMove = useCallback(async () => {
    const count = selected.size;
    if (count === 0) return;
    const folderList = sessionService.getOrderedFolders();
    const items: { text: string; value: string }[] = [
      { text: '📤 미분류로 이동', value: '__root__' },
      ...folderList.map((f) => ({ text: '📁 ' + f, value: f })),
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
    refresh();
    appState.pushMessage(`${count}개 프로젝트를 이동했습니다.`);
  }, [selected, exitSelect, refresh]);

  // 프로젝트를 폴더로 이동 (선택 다이얼로그)
  const moveProject = useCallback(async (name: string) => {
    const currentFolder = sessionService.getFolderOf(name);
    const folderList = sessionService.getOrderedFolders();
    const items: { text: string; value: string }[] = [];
    if (currentFolder !== null) items.push({ text: '📤 미분류로 이동', value: '__root__' });
    for (const f of folderList) {
      if (f !== currentFolder) items.push({ text: '📁 ' + f, value: f });
    }
    if (items.length === 0) {
      appState.pushMessage('이동할 폴더가 없습니다. 먼저 새 폴더를 만들어주세요.');
      return;
    }
    const target = await appState.pushDialogAsync({
      type: 'select',
      text: `"${name}" 폴더 이동`,
      items,
    });
    if (!target) return;
    try {
      await sessionService.moveToFolder(name, target === '__root__' ? null : target);
      refresh();
    } catch (e: any) {
      appState.pushMessage(e.message || '폴더 이동에 실패했습니다.');
    }
  }, [refresh]);

  // ===== 드래그&드롭 =====
  const canDropOnFolder = useCallback(
    (f: string) =>
      drag != null &&
      (drag.type === 'project'
        ? sessionService.getFolderOf(drag.name) !== f
        : drag.name !== f && !f.startsWith(drag.name + '/')),
    [drag],
  );

  const reorderFolders = useCallback((moved: string, target: string) => {
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
  }, []);

  const moveProjectTo = useCallback(
    async (name: string, folder: string | null) => {
      if (sessionService.getFolderOf(name) === folder) return;
      try {
        await sessionService.moveToFolder(name, folder);
        refresh();
      } catch (e: any) {
        appState.pushMessage(e?.message || '이동에 실패했습니다.');
      }
    },
    [refresh],
  );

  const handleFolderDrop = useCallback(
    async (targetFolder: string) => {
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
            refresh();
          } catch (e: any) {
            appState.pushMessage(e?.message || '폴더 이동에 실패했습니다.');
          }
        }
      } else moveProjectTo(d.name, targetFolder);
    },
    [drag, reorderFolders, moveProjectTo, refresh],
  );

  const handleUnfiledDrop = useCallback(() => {
    const d = drag;
    setDrag(null);
    setDropTarget(null);
    if (!d || d.type !== 'project') return;
    moveProjectTo(d.name, null);
  }, [drag, moveProjectTo]);

  const createFolder = useCallback(async (parentPath?: string) => {
    const hint = parentPath
      ? `"${sessionService.folderLeafName(parentPath)}" 안에 새 폴더 (예: 서브폴더 또는 상위/하위)`
      : '새 폴더 이름을 입력하세요 (예: 폴더 또는 상위/하위)';
    const value = await appState.pushDialogAsync({
      type: 'input-confirm',
      text: hint,
    });
    if (!value) return;
    const fullPath = parentPath ? parentPath + '/' + value.trim() : value.trim();
    try {
      await sessionService.createFolder(fullPath);
      setView(fullPath.trim());
      refresh();
    } catch (e: any) {
      appState.pushMessage(e.message || '폴더 생성에 실패했습니다.');
    }
  }, [refresh]);

  const handleNewFolder = useCallback(async () => {
    await createFolder();
  }, [createFolder]);

  const pickColor = useCallback(async (folder: string, c: string | null) => {
    setColorPickerFor(null);
    try {
      await sessionService.setFolderColor(folder, c);
    } catch (e) {}
  }, []);

  // 커스텀 컬러 피커 전용: 크로뮴은 색상 팝업을 드래그하는 동안 change 이벤트가
  // 연속 발생하므로, 패널을 닫지 않고(input 언마운트 → 팝업 닫힘 방지) 저장만
  // 디바운스한다. 이렇게 해야 슬라이더로 색을 자유롭게 조정할 수 있다.
  const customColorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pickCustomColor = useCallback((folder: string, c: string) => {
    if (customColorTimer.current) clearTimeout(customColorTimer.current);
    customColorTimer.current = setTimeout(() => {
      sessionService.setFolderColor(folder, c).catch(() => {});
    }, 200);
  }, []);

  // ===== 폴더 인라인 이름 편집 / 삭제 =====
  const startRename = useCallback((folder: string) => {
    setColorPickerFor(null);
    setEditingFolder(folder);
    setEditValue(sessionService.folderLeafName(folder));
  }, []);

  const cancelRename = useCallback(() => {
    setEditingFolder(null);
    setEditValue('');
  }, []);

  const commitRename = useCallback(async () => {
    const folder = editingFolder;
    if (!folder) return;
    const newLeaf = editValue.trim();
    if (!newLeaf || sessionService.folderLeafName(folder) === newLeaf) {
      cancelRename();
      return;
    }
    const parent = sessionService.folderParentPath(folder);
    const newFullPath = parent ? parent + '/' + newLeaf : newLeaf;
    try {
      await sessionService.renameFolder(folder, newFullPath);
      if (view === folder) setView(newFullPath);
      cancelRename();
      refresh();
    } catch (e: any) {
      appState.pushMessage(e.message || '이름 변경에 실패했습니다.');
    }
  }, [editingFolder, editValue, view, refresh, cancelRename]);

  const deleteFolderConfirm = useCallback(
    (folder: string) => {
      const cleanup = () => {
        if (view === folder) setView('all');
        if (editingFolder === folder) cancelRename();
        refresh();
      };
      const count = sessionService.getProjectsInFolder(folder).length;
      // 빈 폴더 → 단순 확인
      if (count === 0) {
        appState.pushDialog({
          type: 'confirm',
          text: `폴더 "${sessionService.folderLeafName(folder)}"를 삭제할까요?`,
          callback: async () => {
            try {
              await sessionService.deleteFolder(folder);
              cleanup();
            } catch (e: any) {
              appState.pushMessage(e.message || '폴더 삭제에 실패했습니다.');
            }
          },
        });
        return;
      }
      // 프로젝트가 있는 폴더 → 삭제 방식 선택
      appState.pushDialog({
        type: 'select',
        text: `폴더 "${sessionService.folderLeafName(folder)}" 삭제 (${count}개 프로젝트)`,
        items: [
          { text: '폴더만 삭제 (프로젝트는 미분류로 이동)', value: 'folderOnly' },
          { text: '⚠️ 폴더와 프로젝트 모두 삭제', value: 'withProjects' },
        ],
        callback: async (value) => {
          if (value === 'folderOnly') {
            try {
              await sessionService.deleteFolder(folder);
              cleanup();
            } catch (e: any) {
              appState.pushMessage(e.message || '폴더 삭제에 실패했습니다.');
            }
          } else if (value === 'withProjects') {
            // 위험 동작 → 2차 확인
            appState.pushDialog({
              type: 'confirm',
              text: `정말 폴더 "${sessionService.folderLeafName(folder)}"와 그 안의 ${count}개 프로젝트를 모두 삭제할까요?\n프로젝트는 휴지통으로 이동되어 복구할 수 있습니다.`,
              callback: async () => {
                await appState.deleteFolderWithProjects(folder);
                cleanup();
              },
            });
          }
        },
      });
    },
    [view, refresh, editingFolder, cancelRename],
  );

  const cloneFolder = useCallback(async (sourceFolder: string) => {
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
      appState.setProgressDialog({ text: '폴더 복제 중...', done: 0, total: 1 });
      await sessionService.cloneFolder(sourceFolder, targetPath, withImages);
      appState.setProgressDialog(undefined);
      refresh();
      appState.pushMessage(`"${value.trim}" 폴더로 복제되었습니다.`);
    } catch (e: any) {
      appState.setProgressDialog(undefined);
      appState.pushMessage(e.message || '폴더 복제에 실패했습니다.');
    }
  }, [refresh]);

  return (
    <ModalOverlay isOpen={true} onClose={onClose} title="프로젝트 탐색" width="max-w-3xl md:max-w-7xl">
      <div className="flex flex-col md:flex-row gap-3" style={{ height: '70vh' }}>
        {/* 폴더 내비게이션 (PC: 좌측 세로 / 모바일: 상단 가로 스크롤) */}
        <div className="flex md:flex-col gap-1.5 md:w-64 md:flex-none flex-none md:min-h-0">
          {/* 스크롤 영역: 폴더 목록 */}
          <div className="flex md:flex-col gap-1.5 overflow-x-auto md:overflow-y-auto flex-1 min-w-0 md:min-h-0 pb-1 md:pb-0">
            <NavItem
              active={view === 'all'}
              onClick={() => setView('all')}
              icon={<FaFolder className="opacity-70" size={14} />}
              label="전체"
              count={countIn('all')}
            />
            <NavItem
              active={view === 'fav'}
              onClick={() => setView('fav')}
              icon={<FaStar className="text-yellow-400" size={14} />}
              label="즐겨찾기"
              count={countIn('fav')}
            />
            <NavItem
              active={view === 'unfiled'}
              onClick={() => setView('unfiled')}
              icon={<FaFolder className="opacity-40" size={14} />}
              label="미분류"
              count={countIn('unfiled')}
              onDragOver={(e) => {
                if (
                  drag?.type === 'project' &&
                  sessionService.getFolderOf(drag.name) !== null
                ) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  setDropTarget('__unfiled__');
                }
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setDropTarget((t) => (t === '__unfiled__' ? null : t));
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                handleUnfiledDrop();
              }}
              dropping={
                dropTarget === '__unfiled__' &&
                drag?.type === 'project' &&
                sessionService.getFolderOf(drag.name) !== null
              }
            />
            {(() => {
              const rootFolders = folders.filter((f) => !f.includes('/'));
              const renderFolderNode = (f: string, depth: number): React.ReactNode => {
                const childFolders = sessionService.getChildFolders(f);
                const isOpen = expandedFolders.has(f);
                const folderColor =
                  sessionService.getFolderColor(f) || DEFAULT_FOLDER_COLOR;
                const picking = colorPickerFor === f;
                const leafName = sessionService.folderLeafName(f);
                const hasChildren = childFolders.length > 0;
                const toggleExpand = () => {
                  setExpandedFolders((prev) => {
                    const next = new Set(prev);
                    if (next.has(f)) next.delete(f);
                    else next.add(f);
                    return next;
                  });
                };
                return (
                <div key={f} className="flex flex-col gap-1 flex-none md:w-full" style={depth > 0 ? { paddingLeft: `${depth * 12}px` } : undefined}>
                <NavItem
                  active={view === f}
                  onClick={() => { if (hasChildren) toggleExpand(); setView(f); }}
                  icon={
                    hasChildren ? (
                      <span className="flex items-center gap-0.5">
                        {isOpen ? <FaChevronDown size={10} className="flex-none text-faint" /> : <FaChevronRight size={10} className="flex-none text-faint" />}
                        <FaFolder size={14} style={{ color: folderColor }} />
                      </span>
                    ) : (
                      <FaFolder size={14} style={{ color: folderColor }} />
                    )
                  }
                  label={leafName}
                  count={countIn(f)}
                  tint={folderColor}
                  onExport={() => appState.folderBackupMenu(f)}
                  onClone={() => cloneFolder(f)}
                  onColor={() => setColorPickerFor(picking ? null : f)}
                  colorActive={picking}
                  onRename={() => startRename(f)}
                  onDelete={() => deleteFolderConfirm(f)}
                  onAddProject={() => createProjectInFolder(f)}
                  onSubfolder={() => createFolder(f)}
                  onMenu={() => openFolderMenu(f)}
                  editing={editingFolder === f}
                  editValue={editValue}
                  onEditChange={setEditValue}
                  onEditCommit={commitRename}
                  onEditCancel={cancelRename}
                  draggable={dndEnabled && editingFolder !== f}
                  onDragStart={(e) => {
                    setDrag({ type: 'folder', name: f });
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragEnd={() => {
                    setDrag(null);
                    setDropTarget(null);
                  }}
                  onDragOver={(e) => {
                    if (canDropOnFolder(f)) {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      setDropTarget(f);
                    }
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      setDropTarget((t) => (t === f ? null : t));
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleFolderDrop(f);
                  }}
                  dropping={dropTarget === f && canDropOnFolder(f)}
                  dragging={drag?.type === 'folder' && drag.name === f}
                />
                {picking && (
                  <div className="flex flex-wrap items-center gap-1.5 px-2 py-2 rounded-lg bg-[var(--c-surface)] w-[12rem] md:w-full">
                    {FOLDER_COLORS.map((c) => {
                      const selected = folderColor === c;
                      return (
                        <button
                          key={c}
                          onClick={() => pickColor(f, c)}
                          title={c}
                          className="w-6 h-6 rounded-full flex-none transition-transform hover:scale-110"
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
                      className="px-2 h-6 rounded-md text-xs flex-none btn-neutral text-gray-600 dark:text-gray-200"
                    >
                      기본
                    </button>
                    {/* 직접 색상 선택: 데스크톱은 OS 네이티브 피커, 모바일은
                        빈약한 WebView 다이얼로그 대신 내장 HSL 피커 사용 */}
                    {!isMobile ? (
                      <label
                        title="직접 색상 선택"
                        className="relative w-6 h-6 rounded-full flex-none cursor-pointer overflow-hidden border line-color transition-transform hover:scale-110"
                        style={{
                          background:
                            'conic-gradient(red, orange, yellow, lime, cyan, blue, magenta, red)',
                        }}
                      >
                        <input
                          type="color"
                          defaultValue={
                            /^#[0-9a-fA-F]{6}$/.test(folderColor)
                              ? folderColor
                              : '#0ea5e9'
                          }
                          onInput={(e) =>
                            pickCustomColor(f, e.currentTarget.value)
                          }
                          onChange={(e) => pickCustomColor(f, e.target.value)}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        />
                      </label>
                    ) : (
                      <MobileColorPicker
                        initial={
                          /^#[0-9a-fA-F]{6}$/.test(folderColor)
                            ? folderColor
                            : '#0ea5e9'
                        }
                        onChange={(hex) => pickCustomColor(f, hex)}
                        onClose={() => setColorPickerFor(null)}
                      />
                    )}
                  </div>
                )}
                {isOpen && childFolders.map((child) => renderFolderNode(child, depth + 1))}
                </div>
                );
              };
              return rootFolders.map((f) => renderFolderNode(f, 0));
            })()}
            <button
              onClick={handleNewFolder}
              className="btn-ghost flex items-center justify-center md:justify-start gap-1.5 px-2.5 py-1.5 rounded-lg text-sm whitespace-nowrap flex-none md:w-full border border-dashed line-color text-muted"
            >
              <FaPlus size={11} />
              <span>새 폴더</span>
            </button>
          </div>
        </div>

        {/* 검색 + 그리드 */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 gap-3">
          <div className="relative flex-none">
            <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" size={14} />
            <input
              ref={filterRef}
              type="text"
              placeholder="프로젝트 검색..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-lg border line-color bg-[var(--c-input-bg)] text-default text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
            />
          </div>

          {/* 액션 바: 새 프로젝트 / 다중 선택 */}
          <div className="flex items-center gap-2 flex-none">
            {!selectMode ? (
              <>
                <button
                  onClick={createProjectInView}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm btn-solid-sky"
                >
                  <FaPlus size={11} />
                  새 프로젝트
                  {view !== 'all' && view !== 'fav' && view !== 'unfiled' && (
                    <span className="opacity-80">· 📁{view}</span>
                  )}
                </button>
                <div className="flex-1" />
                <button
                  onClick={() => setSelectMode(true)}
                  className="px-2.5 py-1.5 rounded-lg text-sm btn-neutral text-body"
                >
                  선택
                </button>
              </>
            ) : (
              <>
                <span className="text-sm text-sky-600 dark:text-sky-400 font-medium">
                  {selected.size}개 선택
                </span>
                <button
                  onClick={() => setSelected(new Set(filtered))}
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
                  <FaFolder size={12} /> 폴더로 이동
                </button>
                <button
                  onClick={exitSelect}
                  className="px-2.5 py-1.5 rounded-lg text-sm btn-neutral text-body"
                >
                  취소
                </button>
              </>
            )}
          </div>

          <div className="flex-1 overflow-y-auto min-h-0">
            {/* 최근 프로젝트 (전체 뷰 + 검색 없을 때만, 선택 모드 제외) */}
            {view === 'all' && !filter.trim() && !selectMode && recentProjects.length > 0 && (
              <div className="mb-4">
                <div className="text-xs font-medium text-muted mb-2">최근 프로젝트</div>
                <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                  {recentProjects.map((name) => (
                    <ProjectCard
                      key={'recent-' + name}
                      name={name}
                      isFav={sessionService.isFavorite(name)}
                      isActive={curName === name}
                      folder={sessionService.getFolderOf(name)}
                      onSelect={() => selectProject(name)}
                      onToggleFav={() => toggleFav(name)}
                      onMove={() => moveProject(name)}
                      draggable={dndEnabled && !selectMode}
                      onDragStart={(e) => {
                        setDrag({ type: 'project', name });
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragEnd={() => {
                        setDrag(null);
                        setDropTarget(null);
                      }}
                      isDragging={drag?.type === 'project' && drag.name === name}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* 프로젝트 그리드 */}
            <div>
              <div className="text-xs font-medium text-muted mb-2">
                {filter.trim() ? `검색 결과 (${filtered.length})` : `프로젝트 (${filtered.length})`}
              </div>
              {filtered.length === 0 ? (
                <div className="text-sm text-faint text-center py-8">
                  {filter.trim() ? '검색 결과가 없습니다' : '프로젝트가 없습니다'}
                </div>
              ) : (
                <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                  {filtered.map((name) => (
                    <ProjectCard
                      key={name}
                      name={name}
                      isFav={sessionService.isFavorite(name)}
                      isActive={curName === name}
                      isSelected={selectMode && selected.has(name)}
                      folder={sessionService.getFolderOf(name)}
                      onSelect={() =>
                        selectMode ? toggleSelect(name) : selectProject(name)
                      }
                      onToggleFav={() => toggleFav(name)}
                      onMove={() => moveProject(name)}
                      draggable={dndEnabled && !selectMode}
                      onDragStart={(e) => {
                        setDrag({ type: 'project', name });
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragEnd={() => {
                        setDrag(null);
                        setDropTarget(null);
                      }}
                      isDragging={drag?.type === 'project' && drag.name === name}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
});

export default ProjectBrowser;
