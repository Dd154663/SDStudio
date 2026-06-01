import React, { useState, useEffect, useCallback, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { FaStar, FaSearch, FaFolder, FaPlus, FaEllipsisV, FaCheck, FaBars } from 'react-icons/fa';
import { sessionService, imageService, isMobile } from '../models';
import { appState } from '../models/AppService';
import ModalOverlay from './ModalOverlay';

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
        return await imageService.fetchImageSmall(
          'outs/' + name + '/' + ref.scene + '/' + ref.image,
          200,
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
      <div className="w-full aspect-[3/4] bg-gray-100 dark:bg-slate-700 rounded-md" />
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
}: {
  name: string;
  isFav: boolean;
  isActive: boolean;
  isSelected?: boolean;
  folder: string | null;
  onSelect: () => void;
  onToggleFav: () => void;
  onMove: () => void;
}) => {
  return (
    <div
      className={`cursor-pointer rounded-lg border-2 overflow-hidden transition-all hover:brightness-95 active:brightness-90 ${
        isSelected
          ? 'border-sky-500 ring-2 ring-sky-400'
          : isActive
            ? 'border-sky-500 ring-2 ring-sky-300'
            : isFav
              ? 'border-yellow-400'
              : 'border-gray-200 dark:border-slate-600'
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
      <div className="px-2 py-1.5 bg-white dark:bg-slate-800 flex items-center gap-1">
        <button
          className="flex-none text-sm"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFav();
          }}
        >
          <FaStar className={isFav ? 'text-yellow-400' : 'text-gray-300 dark:text-slate-600'} size={14} />
        </button>
        <span className="text-sm text-gray-800 dark:text-gray-100 truncate flex-1">{name}</span>
        <button
          className="flex-none text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-0.5"
          title="폴더로 이동"
          onClick={(e) => {
            e.stopPropagation();
            onMove();
          }}
        >
          <FaEllipsisV size={13} />
        </button>
      </div>
    </div>
  );
};

// 폴더 내비게이션 항목
const NavItem = ({
  active,
  onClick,
  onMenu,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  onMenu?: () => void;
  icon?: React.ReactNode;
  label: string;
  count?: number;
}) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors flex-none ${
      active
        ? 'bg-sky-500 text-white'
        : 'bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-slate-600'
    }`}
  >
    {icon}
    <span className="truncate max-w-[7rem] md:max-w-[8rem]">{label}</span>
    {count != null && (
      <span className={`text-xs ${active ? 'text-sky-100' : 'text-gray-400 dark:text-gray-400'}`}>
        {count}
      </span>
    )}
    {onMenu && (
      <span
        role="button"
        title="폴더 메뉴"
        onClick={(e) => {
          e.stopPropagation();
          onMenu();
        }}
        className={`ml-0.5 opacity-60 hover:opacity-100 ${active ? 'text-white' : ''}`}
      >
        <FaEllipsisV size={11} />
      </span>
    )}
  </button>
);

const ProjectBrowser = observer(({ onClose }: { onClose: () => void }) => {
  const [filter, setFilter] = useState('');
  const [sessionNames, setSessionNames] = useState<string[]>([]);
  const [view, setView] = useState<FolderView>('all');
  const [, setVersion] = useState(0);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const filterRef = useRef<HTMLInputElement>(null);

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

  const folders = [...sessionService.listFolders()].sort(naturalCmp);

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
      return sessionService.getFolderOf(name) === v;
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
      refresh();
      appState.pushMessage(`프로젝트 "${name}"을(를) 만들었습니다.`);
    } catch (e: any) {
      appState.pushMessage(e.message || '프로젝트 생성에 실패했습니다.');
    }
  }, [view, refresh]);

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
    const folderList = [...sessionService.listFolders()].sort(naturalCmp);
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
    const folderList = [...sessionService.listFolders()].sort(naturalCmp);
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

  // 드로어로 전환 (그리드 닫고 좌측 드로어 열기)
  const openDrawer = useCallback(() => {
    onClose();
    appState.projectDrawerOpen = true;
  }, [onClose]);

  const handleNewFolder = useCallback(async () => {
    const value = await appState.pushDialogAsync({
      type: 'input-confirm',
      text: '새 폴더 이름을 입력하세요',
    });
    if (!value) return;
    try {
      await sessionService.createFolder(value);
      setView(value.trim());
      refresh();
    } catch (e: any) {
      appState.pushMessage(e.message || '폴더 생성에 실패했습니다.');
    }
  }, [refresh]);

  const handleFolderMenu = useCallback(async (folder: string) => {
    const action = await appState.pushDialogAsync({
      type: 'select',
      text: `폴더 "${folder}"`,
      items: [
        { text: '✏️ 이름 변경', value: 'rename' },
        { text: '🗑️ 폴더 삭제 (프로젝트는 미분류로 이동)', value: 'delete' },
      ],
    });
    if (action === 'rename') {
      const newName = await appState.pushDialogAsync({
        type: 'input-confirm',
        text: '새 폴더 이름',
      });
      if (!newName) return;
      try {
        await sessionService.renameFolder(folder, newName);
        if (view === folder) setView(newName.trim());
        refresh();
      } catch (e: any) {
        appState.pushMessage(e.message || '이름 변경에 실패했습니다.');
      }
    } else if (action === 'delete') {
      appState.pushDialog({
        type: 'confirm',
        text: `폴더 "${folder}"를 삭제할까요?\n안의 프로젝트는 삭제되지 않고 "미분류"로 이동됩니다.`,
        callback: async () => {
          try {
            await sessionService.deleteFolder(folder);
            if (view === folder) setView('all');
            refresh();
          } catch (e: any) {
            appState.pushMessage(e.message || '폴더 삭제에 실패했습니다.');
          }
        },
      });
    }
  }, [view, refresh]);

  return (
    <ModalOverlay isOpen={true} onClose={onClose} title="프로젝트 탐색" width="max-w-3xl md:max-w-6xl">
      <div className="flex flex-col md:flex-row gap-3" style={{ maxHeight: '70vh' }}>
        {/* 폴더 내비게이션 (PC: 좌측 세로 / 모바일: 상단 가로 스크롤) */}
        <div className="flex md:flex-col gap-1.5 md:w-48 md:flex-none flex-none md:min-h-0">
          {/* 스크롤 영역: 폴더 목록 */}
          <div className="flex md:flex-col gap-1.5 overflow-x-auto md:overflow-y-auto flex-1 min-w-0 md:min-h-0 pb-1 md:pb-0">
            <NavItem
              active={view === 'all'}
              onClick={() => setView('all')}
              icon={<FaFolder className="opacity-70" size={13} />}
              label="전체"
              count={countIn('all')}
            />
            <NavItem
              active={view === 'fav'}
              onClick={() => setView('fav')}
              icon={<FaStar className="text-yellow-400" size={13} />}
              label="즐겨찾기"
              count={countIn('fav')}
            />
            <NavItem
              active={view === 'unfiled'}
              onClick={() => setView('unfiled')}
              icon={<FaFolder className="opacity-40" size={13} />}
              label="미분류"
              count={countIn('unfiled')}
            />
            {folders.map((f) => (
              <NavItem
                key={f}
                active={view === f}
                onClick={() => setView(f)}
                onMenu={() => handleFolderMenu(f)}
                icon={
                  <FaFolder
                    size={13}
                    style={{
                      color:
                        sessionService.getFolderColor(f) || '#38bdf8',
                    }}
                  />
                }
                label={f}
                count={countIn(f)}
              />
            ))}
            <button
              onClick={handleNewFolder}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm whitespace-nowrap flex-none border border-dashed border-gray-300 dark:border-slate-500 text-gray-500 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700"
              title="새 폴더"
            >
              <FaPlus size={11} />
              <span>새 폴더</span>
            </button>
          </div>
          {/* 좌하단: 드로어로 보기 */}
          <button
            onClick={openDrawer}
            className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm whitespace-nowrap flex-none bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-slate-600 md:mt-1"
            title="좌측 드로어로 보기"
          >
            <FaBars size={13} />
            <span>드로어로 보기</span>
          </button>
        </div>

        {/* 검색 + 그리드 */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 gap-3">
          <div className="relative flex-none">
            <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
            <input
              ref={filterRef}
              type="text"
              placeholder="프로젝트 검색..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
            />
          </div>

          {/* 액션 바: 새 프로젝트 / 다중 선택 */}
          <div className="flex items-center gap-2 flex-none">
            {!selectMode ? (
              <>
                <button
                  onClick={createProjectInView}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm bg-sky-500 hover:bg-sky-600 text-white"
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
                  className="px-2.5 py-1.5 rounded-lg text-sm bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-slate-600"
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
                  <FaFolder size={12} /> 폴더로 이동
                </button>
                <button
                  onClick={exitSelect}
                  className="px-2.5 py-1.5 rounded-lg text-sm bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-slate-600"
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
                <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">최근 프로젝트</div>
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
                    />
                  ))}
                </div>
              </div>
            )}

            {/* 프로젝트 그리드 */}
            <div>
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
                {filter.trim() ? `검색 결과 (${filtered.length})` : `프로젝트 (${filtered.length})`}
              </div>
              {filtered.length === 0 ? (
                <div className="text-sm text-gray-400 text-center py-8">
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
