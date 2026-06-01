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
  FaThLarge,
  FaPalette,
  FaFolderPlus,
} from 'react-icons/fa';
import { sessionService, imageService } from '../models';
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

const ProjectDrawer = observer(() => {
  const [filter, setFilter] = useState('');
  const [, setVersion] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [colorPickerFor, setColorPickerFor] = useState<string | null>(null);

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
        appState.projectDrawerOpen = false;
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, colorPickerFor]);

  if (!render) return null;

  const close = () => {
    appState.projectDrawerOpen = false;
  };

  const sessionNames = sessionService.list();
  const folders = [...sessionService.listFolders()].sort(naturalCmp);

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

  const openGrid = () => {
    close();
    appState.projectBrowserOpen = true;
  };

  const ProjectRow = ({
    name,
    showFolder,
  }: {
    name: string;
    showFolder?: boolean;
  }) => {
    const active = appState.curSession?.name === name;
    const folder = showFolder ? sessionService.getFolderOf(name) : null;
    const folderColor = folder
      ? sessionService.getFolderColor(folder) || DEFAULT_FOLDER_COLOR
      : null;
    return (
      <button
        onClick={() => selectProject(name)}
        className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-sm text-left transition-colors ${
          active
            ? 'bg-sky-500 text-white shadow-sm'
            : 'hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-800 dark:text-gray-100'
        }`}
      >
        <FaStar
          size={12}
          className={`flex-none ${
            isFav(name)
              ? 'text-yellow-400'
              : active
                ? 'text-sky-100'
                : 'text-gray-300 dark:text-slate-600'
          }`}
        />
        <span className="truncate flex-1">{name}</span>
        {folder && (
          <span
            className={`text-xs flex-none flex items-center gap-1 ${
              active ? 'text-sky-100' : 'text-gray-400'
            }`}
          >
            <FaFolder
              size={9}
              style={!active && folderColor ? { color: folderColor } : undefined}
            />
            <span className="max-w-[80px] truncate">{folder}</span>
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="fixed inset-0" style={{ zIndex: 2100 }} onClick={close}>
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
          <button
            className="p-1.5 rounded-md hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-500 dark:text-gray-400"
            onClick={close}
          >
            <FaTimes size={18} />
          </button>
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
          <button
            onClick={openGrid}
            title="그리드로 보기"
            className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-medium bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors"
          >
            <FaThLarge size={14} /> 그리드
          </button>
        </div>

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
                  <ProjectRow key={n} name={n} showFolder />
                ))
              )}
            </div>
          ) : (
            <>
              {/* 즐겨찾기 */}
              {favs.length > 0 && (
                <div
                  className="mb-1.5 rounded-md"
                  style={{ borderLeft: '3px solid #facc15' }}
                >
                  <div className="flex items-center gap-2 pl-2.5 pr-2 py-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
                    <span
                      className="flex items-center justify-center w-6 h-6 rounded-md flex-none"
                      style={{ backgroundColor: withAlpha('#facc15', '26') }}
                    >
                      <FaStar className="text-yellow-400" size={13} />
                    </span>
                    <span className="flex-1">즐겨찾기</span>
                    <span className="text-xs text-gray-400 font-normal">
                      {favs.length}
                    </span>
                  </div>
                  <div className="pl-2 pb-1">
                    {favs.map((n) => (
                      <ProjectRow key={'fav-' + n} name={n} showFolder />
                    ))}
                  </div>
                </div>
              )}

              {/* 폴더들 */}
              {folders.map((f) => {
                const projects = folderToProjects.get(f) || [];
                const isOpen = expanded.has(f);
                const color =
                  sessionService.getFolderColor(f) || DEFAULT_FOLDER_COLOR;
                const picking = colorPickerFor === f;
                return (
                  <div
                    key={f}
                    className="mb-1.5 rounded-md"
                    style={{ borderLeft: `3px solid ${color}` }}
                  >
                    <div className="flex items-center gap-1 pl-1.5 pr-1">
                      <button
                        onClick={() => toggleFolder(f)}
                        className="flex-1 flex items-center gap-2 px-1 py-2 text-sm font-semibold text-gray-700 dark:text-gray-200 min-w-0"
                      >
                        {isOpen ? (
                          <FaChevronDown size={11} className="flex-none text-gray-400" />
                        ) : (
                          <FaChevronRight size={11} className="flex-none text-gray-400" />
                        )}
                        <span
                          className="flex items-center justify-center w-6 h-6 rounded-md flex-none"
                          style={{ backgroundColor: withAlpha(color, '26') }}
                        >
                          <FaFolder size={13} style={{ color }} />
                        </span>
                        <span className="truncate flex-1 text-left">{f}</span>
                        <span className="text-xs text-gray-400 font-normal flex-none">
                          {projects.length}
                        </span>
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
                        <FaPalette size={14} />
                      </button>
                      <button
                        onClick={() => createProject(f)}
                        title="이 폴더에 새 프로젝트"
                        className="p-2 rounded-md flex-none text-gray-400 hover:text-sky-500 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
                      >
                        <FaPlus size={14} />
                      </button>
                    </div>
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
                          projects.map((n) => <ProjectRow key={n} name={n} />)
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* 미분류 */}
              <div
                className="mb-1 rounded-md"
                style={{ borderLeft: '3px solid #94a3b8' }}
              >
                <button
                  onClick={() => toggleFolder('__unfiled__')}
                  className="w-full flex items-center gap-2 pl-1.5 pr-2 py-2 text-sm font-semibold text-gray-700 dark:text-gray-200"
                >
                  {expanded.has('__unfiled__') ? (
                    <FaChevronDown size={11} className="flex-none text-gray-400" />
                  ) : (
                    <FaChevronRight size={11} className="flex-none text-gray-400" />
                  )}
                  <span
                    className="flex items-center justify-center w-6 h-6 rounded-md flex-none"
                    style={{ backgroundColor: withAlpha('#94a3b8', '26') }}
                  >
                    <FaFolder className="text-gray-400" size={13} />
                  </span>
                  <span className="flex-1 text-left">미분류</span>
                  <span className="text-xs text-gray-400 font-normal">
                    {unfiled.length}
                  </span>
                </button>
                {expanded.has('__unfiled__') && (
                  <div className="pl-3 pb-1">
                    {unfiled.map((n) => (
                      <ProjectRow key={n} name={n} />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
});

export default ProjectDrawer;
