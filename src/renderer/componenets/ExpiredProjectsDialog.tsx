import { useState, useEffect, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import { runInAction } from 'mobx';
import { appState } from '../models/AppService';
import { trashService } from '../models';

const ExpiredProjectsDialog = observer(() => {
  const projects = appState.pendingExpiredProjects;
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Reset selection when project list changes
  useEffect(() => {
    setSelected(new Set());
  }, [projects.length]);

  const deferAll = useCallback(async () => {
    const names = projects.map((p) => p.name);
    if (names.length > 0) {
      await trashService.deferProjects(names);
    }
    runInAction(() => {
      appState.pendingExpiredProjects = [];
    });
  }, [projects]);

  // ESC key handler
  useEffect(() => {
    if (projects.length === 0) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        deferAll();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [projects.length, deferAll]);

  if (projects.length === 0) return null;

  const now = Date.now();
  const allSelected = selected.size === projects.length && projects.length > 0;

  const toggleSelect = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(projects.map((p) => p.name)));
    }
  };

  const handleDelete = async (names: string[]) => {
    for (const name of names) {
      await trashService.permanentlyDeleteProject(name);
    }
    runInAction(() => {
      appState.pendingExpiredProjects =
        appState.pendingExpiredProjects.filter((p) => !names.includes(p.name));
    });
    setSelected((prev) => {
      const next = new Set(prev);
      names.forEach((n) => next.delete(n));
      return next;
    });
  };

  const handleDefer = async (names: string[]) => {
    await trashService.deferProjects(names);
    runInAction(() => {
      appState.pendingExpiredProjects =
        appState.pendingExpiredProjects.filter((p) => !names.includes(p.name));
    });
    setSelected((prev) => {
      const next = new Set(prev);
      names.forEach((n) => next.delete(n));
      return next;
    });
  };

  const selectedNames = Array.from(selected);
  const allNames = projects.map((p) => p.name);

  return (
    <div
      className="fixed inset-0 flex items-center justify-center confirm-window"
      onClick={(e) => {
        if (e.target === e.currentTarget) deferAll();
      }}
    >
      <div className="flex flex-col m-4 p-4 rounded-md shadow-xl bg-white dark:bg-slate-800 text-black w-[28rem] max-h-[80vh]">
        <div className="text-center text-default font-bold mb-2">
          만료된 프로젝트 정리
        </div>
        <div className="text-center text-sm text-default mb-3">
          다음 프로젝트들의 보존 기한(30일)이 만료되었습니다.
          <br />
          영구 삭제하거나 30일 유예할 수 있습니다.
        </div>

        {/* Select all */}
        <label className="flex items-center gap-2 px-2 py-1 cursor-pointer text-default text-sm border-b dark:border-slate-600">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
          />
          전체 선택 ({selected.size}/{projects.length})
        </label>

        {/* Project list */}
        <div className="overflow-y-auto max-h-60 my-2">
          {projects.map((proj) => {
            const days = Math.floor(
              (now - proj.deletedAt) / (24 * 60 * 60 * 1000),
            );
            const d = new Date(proj.deletedAt);
            const dateStr = proj.deletedAt
              ? d.toLocaleDateString()
              : '알 수 없음';
            return (
              <label
                key={proj.name}
                className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-100 dark:hover:bg-slate-700 cursor-pointer rounded"
              >
                <input
                  type="checkbox"
                  checked={selected.has(proj.name)}
                  onChange={() => toggleSelect(proj.name)}
                />
                <span className="flex-1 text-sm text-default truncate">
                  {proj.name}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400 flex-none">
                  {dateStr} ({days}일 경과)
                </span>
              </label>
            );
          })}
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2 mt-2">
          <button
            className="flex-1 min-w-[6rem] px-3 py-2 rounded back-red clickable text-sm disabled:opacity-40"
            disabled={selected.size === 0}
            onClick={() => handleDelete(selectedNames)}
          >
            선택 삭제
          </button>
          <button
            className="flex-1 min-w-[6rem] px-3 py-2 rounded back-red clickable text-sm"
            onClick={() => handleDelete(allNames)}
          >
            모두 삭제
          </button>
          <button
            className="flex-1 min-w-[6rem] px-3 py-2 rounded back-sky clickable text-sm disabled:opacity-40"
            disabled={selected.size === 0}
            onClick={() => handleDefer(selectedNames)}
          >
            선택 미루기
          </button>
          <button
            className="flex-1 min-w-[6rem] px-3 py-2 rounded back-sky clickable text-sm"
            onClick={() => deferAll()}
          >
            모두 미루기
          </button>
        </div>
      </div>
    </div>
  );
});

export default ExpiredProjectsDialog;
