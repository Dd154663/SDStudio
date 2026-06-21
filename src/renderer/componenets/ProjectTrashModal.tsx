import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import ModalOverlay from './ModalOverlay';
import { trashService, imageService, backend } from '../models';
import { appState } from '../models/AppService';
import {
  FaTrash,
  FaRecycle,
  FaFileExport,
  FaRegSquare,
  FaCheckSquare,
  FaTimes,
} from 'react-icons/fa';

interface TrashItem {
  path: string;
  filename: string;
  sceneName: string;
  isSceneDeleted: boolean;
  size: number;
  mtime: number;
}

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
};

const formatDate = (ts: number) => {
  if (!ts) return '알 수 없음';
  const d = new Date(ts);
  return (
    d.toLocaleDateString() +
    ' ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  );
};

interface ProjectTrashModalProps {
  isOpen: boolean;
  projectName: string;
  onClose: () => void;
}

const ProjectTrashModal = observer(({ isOpen, projectName, onClose }: ProjectTrashModalProps) => {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'active' | 'deleted'>('all');

  const scanTrash = useCallback(async () => {
    if (!projectName) return;
    setLoading(true);
    try {
      const trashFiles = await trashService.getAllProjectTrashFiles(projectName);
      // 정렬: 최신 삭제된 순
      trashFiles.sort((a, b) => b.mtime - a.mtime);
      setItems(trashFiles);
      setSelected(new Set());
    } catch (e) {
      console.error('휴지통 스캔 에러:', e);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [projectName]);

  useEffect(() => {
    if (isOpen) {
      scanTrash();
    }
  }, [isOpen, scanTrash]);

  // 썸네일 점진적 로딩
  useEffect(() => {
    let active = true;
    const loadThumbs = async () => {
      setThumbnails({});
      for (const item of items) {
        if (!active) break;
        try {
          const dataUri = await imageService.fetchImageSmall(item.path, 200);
          if (dataUri && active) {
            setThumbnails((prev) => ({ ...prev, [item.path]: dataUri }));
          }
        } catch (e) {}
      }
    };
    if (items.length > 0) {
      loadThumbs();
    }
    return () => {
      active = false;
    };
  }, [items]);

  // 필터링 적용된 목록
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (activeTab === 'active') return !item.isSceneDeleted;
      if (activeTab === 'deleted') return item.isSceneDeleted;
      return true;
    });
  }, [items, activeTab]);

  const toggleSelect = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selected.size === filteredItems.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredItems.map((i) => i.path)));
    }
  };

  const handleRestore = async () => {
    if (selected.size === 0) return;
    const toRestore = items.filter((i) => selected.has(i.path));
    
    // 삭제된 씬이 포함되어 있는 경우 사용자에게 사전에 경고 확인
    const hasDeletedScenes = toRestore.some((i) => i.isSceneDeleted);
    const confirmText = hasDeletedScenes
      ? `선택한 파일 중 삭제된 씬의 이미지가 포함되어 있습니다.\n해당 씬 자체가 함께 복구됩니다. 계속하시겠습니까?`
      : `${selected.size}개의 이미지를 원래 씬으로 복구하시겠습니까?`;

    appState.pushDialog({
      type: 'confirm',
      text: confirmText,
      callback: async () => {
        try {
          await trashService.restoreProjectTrashItems(projectName, toRestore);
          appState.pushMessage(`${selected.size}개의 항목이 복원되었습니다.`);
          // 메인 이미지 목록 및 화면 갱신
          const session = await appState.curSession;
          if (session && session.name === projectName) {
            await imageService.refreshBatch(session);
          }
          await scanTrash();
        } catch (e: any) {
          appState.pushMessage(`복원 실패: ${e.message}`);
        }
      },
    });
  };

  const handlePermanentDelete = async () => {
    if (selected.size === 0) return;
    const toDelete = items.filter((i) => selected.has(i.path));

    appState.pushDialog({
      type: 'confirm',
      text: `${selected.size}개의 항목을 영구 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`,
      callback: async () => {
        try {
          await trashService.permanentlyDeleteProjectTrashItems(projectName, toDelete);
          appState.pushMessage(`${selected.size}개의 항목이 영구 삭제되었습니다.`);
          await scanTrash();
        } catch (e: any) {
          appState.pushMessage(`삭제 실패: ${e.message}`);
        }
      },
    });
  };

  const handleMoveToExternal = async () => {
    if (selected.size === 0) return;
    const folder = await backend.selectDir();
    if (!folder) return;

    const toMove = items.filter((i) => selected.has(i.path));

    appState.pushDialog({
      type: 'confirm',
      text: `${selected.size}개의 항목을 지정된 외부 폴더로 이동하시겠습니까?\n이동이 완료되면 앱 휴지통에서는 비워집니다.\n(대상 폴더: ${folder})`,
      callback: async () => {
        try {
          await trashService.moveProjectTrashItemsToExternal(projectName, toMove, folder);
          appState.pushMessage(`${selected.size}개의 항목이 성공적으로 외부 폴더로 이동되었습니다.`);
          await scanTrash();
        } catch (e: any) {
          appState.pushMessage(`이동 실패: ${e.message}`);
        }
      },
    });
  };

  const handleEmptyAll = async () => {
    if (items.length === 0) return;
    appState.pushDialog({
      type: 'confirm',
      text: `이 프로젝트의 휴지통에 있는 모든 항목(${items.length}개)을 영구 삭제하시겠습니까?\n이 작업은 절대 되돌릴 수 없습니다.`,
      callback: async () => {
        try {
          await trashService.permanentlyDeleteProjectTrashItems(projectName, items);
          appState.pushMessage('휴지통을 완전히 비웠습니다.');
          await scanTrash();
        } catch (e: any) {
          appState.pushMessage(`휴지통 비우기 실패: ${e.message}`);
        }
      },
    });
  };

  return (
    <ModalOverlay
      isOpen={isOpen}
      onClose={onClose}
      title={`프로젝트 휴지통 관리자 - ${projectName}`}
      width="max-w-4xl"
    >
      <div className="flex flex-col h-[75vh] max-h-[800px]">
        {/* 컨트롤 영역 */}
        <div className="flex-none pb-3 border-b line-color flex flex-wrap items-center justify-between gap-3">
          {/* 탭 전환 */}
          <div className="flex gap-1.5 bg-gray-100 dark:bg-slate-700 p-0.5 rounded-lg">
            {(
              [
                { id: 'all', label: '전체' },
                { id: 'active', label: '활성 씬의 이미지' },
                { id: 'deleted', label: '삭제된 씬의 이미지' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  setSelected(new Set());
                }}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  activeTab === tab.id
                    ? 'bg-white dark:bg-slate-600 text-sky-500 font-semibold shadow-sm'
                    : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleSelectAll}
              disabled={filteredItems.length === 0}
              className="text-xs back-gray px-3 py-1.5 rounded hover:brightness-95 active:brightness-90 flex items-center gap-1.5 disabled:opacity-50"
            >
              {selected.size === filteredItems.length && filteredItems.length > 0 ? (
                <>
                  <FaCheckSquare className="text-sky-500" />
                  전체 해제
                </>
              ) : (
                <>
                  <FaRegSquare />
                  전체 선택
                </>
              )}
            </button>
            <button
              onClick={handleEmptyAll}
              disabled={items.length === 0}
              className="text-xs back-red px-3 py-1.5 rounded hover:brightness-95 active:brightness-90 flex items-center gap-1.5 disabled:opacity-50"
            >
              <FaTrash />
              휴지통 완전히 비우기
            </button>
          </div>
        </div>

        {/* 썸네일 그리드 영역 */}
        <div className="flex-1 overflow-y-auto py-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <span className="text-sm">휴지통 폴더를 스캔하는 중...</span>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <span className="text-sm">삭제된 항목이 없습니다.</span>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5">
              {filteredItems.map((item) => {
                const isSelected = selected.has(item.path);
                const thumb = thumbnails[item.path];
                return (
                  <div
                    key={item.path}
                    onClick={() => toggleSelect(item.path)}
                    className={`relative rounded-lg overflow-hidden border cursor-pointer select-none group transition-all ${
                      isSelected
                        ? 'border-sky-500 ring-2 ring-sky-500/20'
                        : 'border-gray-200 dark:border-slate-700 hover:border-gray-300 dark:hover:border-slate-600'
                    }`}
                  >
                    {/* 이미지 영역 */}
                    <div className="aspect-[3/4] w-full bg-slate-900 flex items-center justify-center overflow-hidden">
                      {thumb ? (
                        <img
                          src={thumb}
                          alt={item.filename}
                          className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-200"
                        />
                      ) : (
                        <div className="w-6 h-6 border-2 border-gray-600 border-t-sky-500 rounded-full animate-spin" />
                      )}
                    </div>

                    {/* 선택 체크박스 아이콘 */}
                    <div className="absolute top-2 left-2 z-10 drop-shadow-md">
                      {isSelected ? (
                        <FaCheckSquare className="text-sky-500 text-lg bg-white rounded-sm" />
                      ) : (
                        <FaRegSquare className="text-white text-lg bg-black/30 rounded-sm opacity-60 group-hover:opacity-100 transition-opacity" />
                      )}
                    </div>

                    {/* 정보 영역 */}
                    <div className="p-2 bg-white dark:bg-slate-800 text-[11px] leading-tight space-y-1">
                      <div className="truncate font-semibold text-gray-700 dark:text-gray-300">
                        {item.filename}
                      </div>
                      <div className="flex justify-between text-gray-400">
                        <span>{formatBytes(item.size)}</span>
                      </div>
                      <div className="truncate text-gray-400">
                        {item.isSceneDeleted ? (
                          <span className="text-red-400/90 font-medium">[삭제씬] {item.sceneName}</span>
                        ) : (
                          <span>[씬] {item.sceneName}</span>
                        )}
                      </div>
                      <div className="text-[10px] text-gray-400/70 pt-0.5 border-t border-gray-100 dark:border-slate-700">
                        {formatDate(item.mtime)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 액션바 영역 */}
        <div className="flex-none pt-3 border-t line-color flex items-center justify-between gap-3">
          <span className="text-xs gray-label">
            {selected.size > 0 ? (
              <span className="text-sky-500 font-semibold">{selected.size}개 선택됨</span>
            ) : (
              <span>정리할 이미지를 선택하세요</span>
            )}
          </span>

          <div className="flex gap-2">
            <button
              onClick={handleRestore}
              disabled={selected.size === 0}
              className="text-xs back-sky px-4 py-2 rounded font-semibold hover:brightness-95 active:brightness-90 flex items-center gap-1.5 disabled:opacity-50 transition-opacity"
            >
              <FaRecycle />
              선택 복원
            </button>
            <button
              onClick={handleMoveToExternal}
              disabled={selected.size === 0}
              className="text-xs back-green text-white px-4 py-2 rounded font-semibold hover:brightness-95 active:brightness-90 flex items-center gap-1.5 disabled:opacity-50 transition-opacity"
            >
              <FaFileExport />
              외부 폴더로 이동
            </button>
            <button
              onClick={handlePermanentDelete}
              disabled={selected.size === 0}
              className="text-xs back-red px-4 py-2 rounded font-semibold hover:brightness-95 active:brightness-90 flex items-center gap-1.5 disabled:opacity-50 transition-opacity"
            >
              <FaTrash />
              영구 삭제
            </button>
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
});

export default ProjectTrashModal;
