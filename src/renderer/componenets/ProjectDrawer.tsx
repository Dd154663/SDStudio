import React, { useState, useEffect, useCallback } from 'react';
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
} from 'react-icons/fa';
import { sessionService, imageService, isMobile } from '../models';
import { appState } from '../models/AppService';
import { pushRecentProject } from './ProjectBrowser';

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

// hex 색상에 알파를 붙여 옅은 배경을 만든다.
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
  }) => {
    const active = appState.curSession?.name === name;
    const isFav = sessionService.isFavorite(name);
    const folder = showFolder ? sessionService.getFolderOf(name) : null;
    const folderColor = folder
      ? sessionService.getFolderColor(folder) || DEFAULT_FOLDER_COLOR
      : null;
    const highlighted = selectMode ? selected : active;
    return (
      <button
        onClick={onSelect}
        draggable={dndEnabled}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        style={dragging ? { opacity: 0.4 } : undefined}
        className={`w-full flex items-center gap-2 px-2.5 py-2.5 rounded-md text-[15px] text-left transition-colors ${
          highlighted
            ? 'bg-sky-500 text-white shadow-sm'
            : 'hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-800 dark:text-gray-100'
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
          <span
            role="button"
            title={isFav ? '즐겨찾기 해제' : '즐겨찾기'}
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
              style={!active && folderColor ? { color: folderColor } : undefined}
            />
            <span className="max-w-[80px] truncate">{folder}</span>
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
  const [editValue, setEditValue] = useState('');
  // 선택 모드(다중 선택 → 폴더 일괄 이동)
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 드래그&드롭 상태 (PC 전용)
  const [drag, setDrag] = useState<{
    type: 'project' | 'folder';
    name: string;
  } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

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
        if (colorPickerFor) {
          setColorPickerFor(null);
          return;
        }
        if (selectMode) {
          setSelectMode(false);
          setSelected(new Set());
          return;
        }
        appState.projectDrawerOpen = false;
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, colorPickerFor, selectMode]);

  if (!render) return null;

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
      text: folder ? `"${folder}" 폴더에 새 프로젝트 이름` : '신규 프로젝트 이름',
    });
    if (!name) return;
    if (sessionService.list().includes(name)) {
      appState.pushMessage('이미 존재하는 프로젝트 이름입니다.');
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

  const createFolder = async () => {
    const value = await appState.pushDialogAsync({
      type: 'input-confirm',
      text: '새 폴더 이름을 입력하세요',
    });
    if (!value) return;
    try {
      await sessionService.createFolder(value);
      // 새로 만든 폴더를 펼친 상태로
      setExpanded((prev) => {
        const next = new Set(prev);
        next.add(value.trim());
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

  // ===== 폴더 인라인 이름 편집 / 삭제 =====
  const startRename = (f: string) => {
    setColorPickerFor(null);
    setEditingFolder(f);
    setEditValue(f);
  };

  const cancelRename = () => {
    setEditingFolder(null);
    setEditValue('');
  };

  const commitRename = async () => {
    const f = editingFolder;
    if (!f) return;
    const newName = editValue.trim();
    if (!newName || newName === f) {
      cancelRename();
      return;
    }
    try {
      await sessionService.renameFolder(f, newName);
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(f)) {
          next.delete(f);
          next.add(newName);
        }
        return next;
      });
      cancelRename();
    } catch (e: any) {
      appState.pushMessage(e.message || '이름 변경에 실패했습니다.');
    }
  };

  const deleteFolderConfirm = (f: string) => {
    const cleanup = () => {
      if (editingFolder === f) cancelRename();
    };
    const count = sessionService
      .list()
      .filter((n) => sessionService.getFolderOf(n) === f).length;
    // 빈 폴더 → 단순 확인
    if (count === 0) {
      appState.pushDialog({
        type: 'confirm',
        text: `폴더 "${f}"를 삭제할까요?`,
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
    // 프로젝트가 있는 폴더 → 삭제 방식 선택
    appState.pushDialog({
      type: 'select',
      text: `폴더 "${f}" 삭제 (${count}개 프로젝트)`,
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
          // 위험 동작 → 2차 확인
          appState.pushDialog({
            type: 'confirm',
            text: `정말 폴더 "${f}"와 그 안의 ${count}개 프로젝트를 모두 삭제할까요?\n프로젝트는 휴지통으로 이동되어 복구할 수 있습니다.`,
            callback: async () => {
              await appState.deleteFolderWithProjects(f);
              cleanup();
            },
          });
        }
      },
    });
  };

  // 모바일: 폴더마다 ⋮ 메뉴 (데스크톱은 인라인 버튼 유지)
  const openFolderMenu = async (f: string) => {
    const v = await appState.pushDialogAsync({
      type: 'select',
      text: `폴더 "${f}"`,
      items: [
        { text: '📤 내보내기/불러오기', value: 'export' },
        { text: '🎨 색상 변경', value: 'color' },
        { text: '✏️ 이름 편집', value: 'rename' },
        { text: '🗑️ 폴더 삭제', value: 'delete' },
        { text: '➕ 이 폴더에 새 프로젝트', value: 'add' },
      ],
    });
    if (!v) return;
    if (v === 'export') appState.folderBackupMenu(f);
    else if (v === 'color') setColorPickerFor((p) => (p === f ? null : f));
    else if (v === 'rename') startRename(f);
    else if (v === 'delete') deleteFolderConfirm(f);
    else if (v === 'add') createProject(f);
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

  // 폴더 헤더에 드롭: 폴더면 순서변경, 프로젝트면 폴더로 이동
  const handleFolderDrop = (targetFolder: string) => {
    const d = drag;
    setDrag(null);
    setDropTarget(null);
    if (!d) return;
    if (d.type === 'folder') reorderFolders(d.name, targetFolder);
    else moveProjectTo(d.name, targetFolder);
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
    (drag.type === 'project' ? sessionService.getFolderOf(drag.name) !== f : drag.name !== f);

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
  });

  return (
    <div className="fixed inset-0 titlebar-no-drag" style={{ zIndex: 2100 }} onClick={close}>
      <div
        className="absolute inset-0"
        style={{
          backgroundColor: 'rgba(0,0,0,0.35)',
          opacity: shown ? 1 : 0,
          transition: 'opacity 0.26s ease',
        }}
      />
      <div
        className="absolute left-0 top-0 h-full w-[90vw] max-w-[400px] bg-white dark:bg-slate-800 shadow-2xl border-r border-gray-200 dark:border-slate-600 flex flex-col"
        style={{
          transform: shown ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.26s cubic-bezier(0.4, 0, 0.2, 1)',
          willChange: 'transform',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-slate-600 flex-none">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
            프로젝트
          </h2>
          <div className="flex items-center gap-2">
            {!selectMode && (
              <button
                onClick={() => setSelectMode(true)}
                className="text-sm px-2.5 py-1 rounded-md bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-slate-600"
              >
                선택
              </button>
            )}
            <button
              className="p-1.5 rounded-md hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-500 dark:text-gray-400"
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
              className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
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
              className="px-2 py-1.5 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700"
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
              className="px-2.5 py-1.5 rounded-lg text-sm bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-slate-600"
            >
              취소
            </button>
          </div>
        ) : (
        <div className="px-3 py-2.5 flex gap-2 flex-none">
          <button
            onClick={() => createProject(null)}
            className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2.5 rounded-lg text-sm font-medium bg-sky-500 hover:bg-sky-600 text-white transition-colors"
          >
            <FaPlus size={12} /> 새 프로젝트
          </button>
          <button
            onClick={createFolder}
            title="새 폴더 만들기"
            className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-medium bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors"
          >
            <FaFolderPlus size={14} /> 폴더
          </button>
        </div>
        )}

        {/* 목록 */}
        <div className="flex-1 overflow-y-auto min-h-0 px-2 pb-3">
          {searching ? (
            <div>
              <div className="px-1 py-1 text-xs text-gray-500 dark:text-gray-400">
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
                    className="w-full flex items-center gap-2 pl-1.5 pr-2 py-2.5 text-[15px] font-semibold text-gray-700 dark:text-gray-200"
                  >
                    {expanded.has('__favorites__') ? (
                      <FaChevronDown size={12} className="flex-none text-gray-400" />
                    ) : (
                      <FaChevronRight size={12} className="flex-none text-gray-400" />
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
                        <ProjectRow key={'fav-' + n} showFolder {...rowProps(n)} />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 폴더들 */}
              {folders.map((f) => {
                const projects = folderToProjects.get(f) || [];
                const isOpen = expanded.has(f);
                const color =
                  sessionService.getFolderColor(f) || DEFAULT_FOLDER_COLOR;
                const picking = colorPickerFor === f;
                const isDropping = dropTarget === f && canDropOnFolder(f);
                const folderDragging =
                  drag?.type === 'folder' && drag.name === f;
                return (
                  <div
                    key={f}
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
                    }}
                    onDragOver={(e) => {
                      if (drag && canDropOnFolder(f)) {
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
                          className="flex-1 min-w-0 bg-white dark:bg-slate-700 border border-sky-400 rounded px-2 py-1.5 text-[15px] text-gray-900 dark:text-gray-100 outline-none"
                        />
                        <button
                          onClick={commitRename}
                          title="저장"
                          className="p-2 rounded-md flex-none text-green-500 hover:bg-gray-100 dark:hover:bg-slate-700"
                        >
                          <FaCheck size={15} />
                        </button>
                        <button
                          onClick={cancelRename}
                          title="취소"
                          className="p-2 rounded-md flex-none text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700"
                        >
                          <FaTimes size={15} />
                        </button>
                      </div>
                    ) : (
                    <div className="flex items-center gap-0.5 pl-1.5 pr-1">
                      <button
                        onClick={() => toggleFolder(f)}
                        draggable={dndEnabled && !selectMode}
                        onDragStart={(e) => {
                          setDrag({ type: 'folder', name: f });
                          e.dataTransfer.effectAllowed = 'move';
                          e.stopPropagation();
                        }}
                        onDragEnd={() => {
                          setDrag(null);
                          setDropTarget(null);
                        }}
                        className="flex-1 flex items-center gap-2 px-1 py-2.5 text-[15px] font-semibold text-gray-700 dark:text-gray-200 min-w-0"
                      >
                        {isOpen ? (
                          <FaChevronDown size={12} className="flex-none text-gray-400" />
                        ) : (
                          <FaChevronRight size={12} className="flex-none text-gray-400" />
                        )}
                        <span
                          className="flex items-center justify-center w-7 h-7 rounded-md flex-none"
                          style={{ backgroundColor: withAlpha(color, '26') }}
                        >
                          <FaFolder size={14} style={{ color }} />
                        </span>
                        <span className="truncate flex-1 text-left">{f}</span>
                        <span className="text-xs text-gray-400 font-normal flex-none">
                          {projects.length}
                        </span>
                      </button>
                      {isMobile ? (
                        /* 모바일: ⋮ 메뉴 하나로 폴더 동작 5종 노출 */
                        <button
                          onClick={() => openFolderMenu(f)}
                          title="폴더 메뉴"
                          className="p-2 rounded-md flex-none text-gray-500 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
                        >
                          <FaEllipsisV size={16} />
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => appState.folderBackupMenu(f)}
                            title="폴더 내보내기/불러오기"
                            className="p-1.5 rounded-md flex-none text-gray-400 hover:text-amber-500 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
                          >
                            <FaFileExport size={14} />
                          </button>
                          <button
                            onClick={() =>
                              setColorPickerFor(picking ? null : f)
                            }
                            title="폴더 색상"
                            className={`p-2 rounded-md flex-none transition-colors ${
                              picking
                                ? 'bg-gray-200 dark:bg-slate-600 text-sky-500'
                                : 'text-gray-400 hover:text-sky-500 hover:bg-gray-100 dark:hover:bg-slate-700'
                            }`}
                          >
                            <FaPalette size={15} />
                          </button>
                          <button
                            onClick={() => startRename(f)}
                            title="이름 편집"
                            className="p-2 rounded-md flex-none text-gray-400 hover:text-sky-500 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
                          >
                            <FaPen size={15} />
                          </button>
                          <button
                            onClick={() => deleteFolderConfirm(f)}
                            title="폴더 삭제"
                            className="p-2 rounded-md flex-none text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
                          >
                            <FaTrashAlt size={15} />
                          </button>
                          <button
                            onClick={() => createProject(f)}
                            title="이 폴더에 새 프로젝트"
                            className="p-2 rounded-md flex-none text-gray-400 hover:text-sky-500 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
                          >
                            <FaPlus size={15} />
                          </button>
                        </>
                      )}
                    </div>
                    )}
                    {picking && (
                      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 bg-gray-50 dark:bg-slate-700/50 rounded-md mx-1 mb-1">
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
                          className="px-2 h-7 rounded-md text-xs flex-none bg-gray-200 dark:bg-slate-600 text-gray-600 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-slate-500"
                        >
                          기본
                        </button>
                      </div>
                    )}
                    {isOpen && (
                      <div className="pl-3 pb-1">
                        {projects.length === 0 ? (
                          <div className="text-xs text-gray-400 px-2 py-1.5">
                            비어 있음
                          </div>
                        ) : (
                          projects.map((n) => <ProjectRow key={n} {...rowProps(n)} />)
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* 미분류 */}
              {(() => {
                const canDropUnfiled =
                  drag?.type === 'project' &&
                  sessionService.getFolderOf(drag.name) !== null;
                const unfiledDropping =
                  dropTarget === '__unfiled__' && canDropUnfiled;
                return (
              <div
                className="mb-1 rounded-md transition-shadow"
                style={{
                  borderLeft: '3px solid #94a3b8',
                  boxShadow: unfiledDropping
                    ? 'inset 0 0 0 2px #94a3b8'
                    : undefined,
                  backgroundColor: unfiledDropping ? '#94a3b826' : '#94a3b812',
                }}
                onDragOver={(e) => {
                  if (canDropUnfiled) {
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
              >
                <button
                  onClick={() => toggleFolder('__unfiled__')}
                  className="w-full flex items-center gap-2 pl-1.5 pr-2 py-2.5 text-[15px] font-semibold text-gray-700 dark:text-gray-200"
                >
                  {expanded.has('__unfiled__') ? (
                    <FaChevronDown size={11} className="flex-none text-gray-400" />
                  ) : (
                    <FaChevronRight size={11} className="flex-none text-gray-400" />
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
    </div>
  );
});

export default ProjectDrawer;
