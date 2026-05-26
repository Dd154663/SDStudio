import React, { useState, useEffect, useCallback, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { FaStar, FaSearch } from 'react-icons/fa';
import { sessionService, imageService, gameService, isMobile } from '../models';
import { appState } from '../models/AppService';
import { getMainImage } from '../models/ImageService';
import { Session } from '../models/types';
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

// 프로젝트 카드 썸네일
const ProjectThumbnail = ({ name }: { name: string }) => {
  const [image, setImage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await sessionService.get(name);
        if (!session || cancelled) return;
        const scenes = Array.from(session.scenes.values());
        if (scenes.length === 0) return;
        const img = await getMainImage(session, scenes[0], 200);
        if (!cancelled && img) setImage(img);
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
  onSelect,
  onToggleFav,
}: {
  name: string;
  isFav: boolean;
  isActive: boolean;
  onSelect: () => void;
  onToggleFav: () => void;
}) => {
  return (
    <div
      className={`cursor-pointer rounded-lg border-2 overflow-hidden transition-all hover:brightness-95 active:brightness-90 ${
        isActive
          ? 'border-sky-500 ring-2 ring-sky-300'
          : isFav
            ? 'border-yellow-400'
            : 'border-gray-200 dark:border-slate-600'
      }`}
      onClick={onSelect}
    >
      <ProjectThumbnail name={name} />
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
      </div>
    </div>
  );
};

const ProjectBrowser = observer(({ onClose }: { onClose: () => void }) => {
  const [filter, setFilter] = useState('');
  const [sessionNames, setSessionNames] = useState<string[]>([]);
  const filterRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSessionNames(sessionService.list());
    if (!isMobile) setTimeout(() => filterRef.current?.focus(), 100);
  }, []);

  const recentProjects = getRecentProjects().filter((n) => sessionNames.includes(n));
  const curName = appState.curSession?.name;

  const allSorted = [...sessionNames].sort((a, b) => {
    const aFav = sessionService.isFavorite(a);
    const bFav = sessionService.isFavorite(b);
    if (aFav !== bFav) return aFav ? -1 : 1;
    return a.localeCompare(b);
  });

  const filtered = filter.trim()
    ? allSorted.filter((n) => n.toLowerCase().includes(filter.toLowerCase()))
    : allSorted;

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
    setSessionNames([...sessionService.list()]);
  }, []);

  return (
    <ModalOverlay isOpen={true} onClose={onClose} title="프로젝트 탐색" width="max-w-3xl">
      <div className="flex flex-col gap-4" style={{ maxHeight: '70vh' }}>
        {/* 검색 */}
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

        <div className="flex-1 overflow-y-auto min-h-0">
          {/* 최근 프로젝트 */}
          {!filter.trim() && recentProjects.length > 0 && (
            <div className="mb-4">
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">최근 프로젝트</div>
              <div className="grid grid-cols-5 gap-2">
                {recentProjects.map((name) => (
                  <ProjectCard
                    key={'recent-' + name}
                    name={name}
                    isFav={sessionService.isFavorite(name)}
                    isActive={curName === name}
                    onSelect={() => selectProject(name)}
                    onToggleFav={() => toggleFav(name)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* 전체 프로젝트 */}
          <div>
            <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
              {filter.trim() ? `검색 결과 (${filtered.length})` : `전체 프로젝트 (${filtered.length})`}
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
                    onSelect={() => selectProject(name)}
                    onToggleFav={() => toggleFav(name)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
});

export default ProjectBrowser;
