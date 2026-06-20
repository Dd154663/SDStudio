import React, { useEffect, useState, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import ModalOverlay from './ModalOverlay';
import { trashService } from '../models';
import { appState } from '../models/AppService';
import { FaTrash, FaRecycle, FaTimes } from 'react-icons/fa';

interface TrashProjectSummary {
  name: string;
  deletedAt: number;
  size: number;
}

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
};

const formatAgo = (ts: number) => {
  const d = Date.now() - ts;
  if (d < 60 * 1000) return '방금';
  if (d < 60 * 60 * 1000) return Math.floor(d / (60 * 1000)) + '분 전';
  if (d < 24 * 60 * 60 * 1000) return Math.floor(d / (60 * 60 * 1000)) + '시간 전';
  return Math.floor(d / (24 * 60 * 60 * 1000)) + '일 전';
};

interface ProjectTrashListModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ProjectTrashListModal = observer(({ isOpen, onClose }: ProjectTrashListModalProps) => {
  const [projects, setProjects] = useState<TrashProjectSummary[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await trashService.getTrashedProjectsWithSize();
      result.sort((a, b) => b.deletedAt - a.deletedAt);
      setProjects(result.filter((p) => p.size > 0));
    } catch (e) {
      console.error('휴지통 목록 로드 실패:', e);
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) load();
  }, [isOpen, load]);

  const handleRestore = async (name: string) => {
    appState.pushDialog({
      type: 'confirm',
      text: `프로젝트 "${name}"을(를) 복구하시겠습니까?`,
      callback: async () => {
        try {
          await trashService.restoreProject(name);
          appState.pushMessage(`"${name}"이(가) 복구되었습니다.`);
          await load();
        } catch (e: any) {
          appState.pushMessage(`복구 실패: ${e.message}`);
        }
      },
    });
  };

  const handleDelete = async (name: string) => {
    appState.pushDialog({
      type: 'confirm',
      text: `프로젝트 "${name}"의 모든 데이터를 영구 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`,
      callback: async () => {
        try {
          await trashService.permanentlyDeleteProject(name);
          appState.pushMessage(`"${name}"이(가) 영구 삭제되었습니다.`);
          await load();
        } catch (e: any) {
          appState.pushMessage(`삭제 실패: ${e.message}`);
        }
      },
    });
  };

  const handleEmptyAll = async () => {
    if (projects.length === 0) return;
    appState.pushDialog({
      type: 'confirm',
      text: `휴지통의 모든 프로젝트 데이터(${projects.length}개)를 영구 삭제하시겠습니까?\n이 작업은 절대 되돌릴 수 없습니다.`,
      callback: async () => {
        try {
          await trashService.emptyAllProjectTrashDirs();
          appState.pushMessage('휴지통을 완전히 비웠습니다.');
          await load();
        } catch (e: any) {
          appState.pushMessage(`휴지통 비우기 실패: ${e.message}`);
        }
      },
    });
  };

  const totalSize = projects.reduce((sum, p) => sum + p.size, 0);

  return (
    <ModalOverlay
      isOpen={isOpen}
      onClose={onClose}
      title="휴지통 관리"
      width="max-w-lg"
    >
      <div className="flex flex-col max-h-[70vh]">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-gray-400 text-sm">
            휴지통 스캔 중...
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <FaRecycle size={40} className="mb-3 opacity-30" />
            <span className="text-sm">휴지통이 비어 있습니다</span>
          </div>
        ) : (
          <>
            <div className="overflow-y-auto flex-1">
              {projects.map((p) => (
                <div
                  key={p.name}
                  className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                      {p.name}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {formatAgo(p.deletedAt)} · {formatBytes(p.size)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-none">
                    <button
                      onClick={() => handleRestore(p.name)}
                      className="px-3 py-1.5 text-xs rounded-md bg-sky-500 hover:bg-sky-600 text-white font-medium transition-colors flex items-center gap-1"
                    >
                      <FaRecycle size={11} />
                      복구
                    </button>
                    <button
                      onClick={() => handleDelete(p.name)}
                      className="px-3 py-1.5 text-xs rounded-md bg-red-500 hover:bg-red-600 text-white font-medium transition-colors flex items-center gap-1"
                    >
                      <FaTimes size={11} />
                      삭제
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-slate-600 bg-gray-50 dark:bg-slate-800/50">
              <span className="text-xs text-gray-500">
                {projects.length}개 프로젝트 · 총 {formatBytes(totalSize)}
              </span>
              <button
                onClick={handleEmptyAll}
                className="px-3 py-1.5 text-xs rounded-md bg-red-500 hover:bg-red-600 text-white font-medium transition-colors flex items-center gap-1"
              >
                <FaTrash size={11} />
                모두 비우기
              </button>
            </div>
          </>
        )}
      </div>
    </ModalOverlay>
  );
});

export default ProjectTrashListModal;
