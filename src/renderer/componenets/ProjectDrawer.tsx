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
} from 'react-icons/fa';
import { sessionService, imageService } from '../models';
import { appState } from '../models/AppService';
import { pushRecentProject } from './ProjectBrowser';

const naturalCmp = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

const ProjectDrawer = observer(() => {
  const [filter, setFilter] = useState('');
  const [, setVersion] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const open = appState.projectDrawerOpen;

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    const onUpdate = () => refresh();
    sessionService.addEventListener('listupdated', onUpdate);
    return () => sessionService.removeEventListener('listupdated', onUpdate);
  }, [refresh]);

  // 열릴 때마다 현재 프로젝트의 폴더 자동 펼침 + 검색 초기화
  useEffect(() => {
    if (!open) return;
    setFilter('');
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
        appState.projectDrawerOpen = false;
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  if (!open) return null;

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
    return (
      <button
        onClick={() => selectProject(name)}
        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left ${
          active
            ? 'bg-sky-500 text-white'
            : 'hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-800 dark:text-gray-100'
        }`}
      >
        <FaStar
          size={11}
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
          <span className={`text-xs flex-none ${active ? 'text-sky-100' : 'text-gray-400'}`}>
            📁{folder}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="fixed inset-0" style={{ zIndex: 2100 }} onClick={close}>
      <div
        className="absolute inset-0"
        style={{ backgroundColor: 'rgba(0,0,0,0.3)' }}
      />
      <div
        className="absolute left-0 top-0 h-full w-[85vw] max-w-[340px] bg-white dark:bg-slate-800 shadow-2xl border-r border-gray-200 dark:border-slate-600 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-3 py-3 border-b border-gray-200 dark:border-slate-600 flex-none">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">
            프로젝트
          </h2>
          <button
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-500 dark:text-gray-400"
            onClick={close}
          >
            <FaTimes size={16} />
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
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
            />
          </div>
        </div>

        {/* 액션 */}
        <div className="px-3 py-2 flex gap-2 flex-none">
          <button
            onClick={() => createProject(null)}
            className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-sm bg-sky-500 hover:bg-sky-600 text-white"
          >
            <FaPlus size={11} /> 새 프로젝트
          </button>
          <button
            onClick={openGrid}
            title="그리드로 보기"
            className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-slate-600"
          >
            <FaThLarge size={13} /> 그리드
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
                <div className="mb-1">
                  <div className="flex items-center gap-1.5 px-2 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-300">
                    <FaStar className="text-yellow-400" size={12} />
                    <span>즐겨찾기</span>
                    <span className="text-xs text-gray-400">{favs.length}</span>
                  </div>
                  <div className="pl-2">
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
                return (
                  <div key={f}>
                    <div className="flex items-center gap-1 px-1">
                      <button
                        onClick={() => toggleFolder(f)}
                        className="flex-1 flex items-center gap-1.5 px-1 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 min-w-0"
                      >
                        {isOpen ? (
                          <FaChevronDown size={10} className="flex-none" />
                        ) : (
                          <FaChevronRight size={10} className="flex-none" />
                        )}
                        <FaFolder className="text-sky-400 flex-none" size={12} />
                        <span className="truncate flex-1 text-left">{f}</span>
                        <span className="text-xs text-gray-400 flex-none">
                          {projects.length}
                        </span>
                      </button>
                      <button
                        onClick={() => createProject(f)}
                        title="이 폴더에 새 프로젝트"
                        className="px-1 py-1 text-gray-400 hover:text-sky-500 flex-none"
                      >
                        <FaPlus size={11} />
                      </button>
                    </div>
                    {isOpen && (
                      <div className="pl-4">
                        {projects.length === 0 ? (
                          <div className="text-xs text-gray-400 px-2 py-1">비어 있음</div>
                        ) : (
                          projects.map((n) => <ProjectRow key={n} name={n} />)
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* 미분류 */}
              <div>
                <button
                  onClick={() => toggleFolder('__unfiled__')}
                  className="w-full flex items-center gap-1.5 px-2 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200"
                >
                  {expanded.has('__unfiled__') ? (
                    <FaChevronDown size={10} className="flex-none" />
                  ) : (
                    <FaChevronRight size={10} className="flex-none" />
                  )}
                  <FaFolder className="text-gray-400 flex-none" size={12} />
                  <span className="flex-1 text-left">미분류</span>
                  <span className="text-xs text-gray-400">{unfiled.length}</span>
                </button>
                {expanded.has('__unfiled__') && (
                  <div className="pl-4">
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
