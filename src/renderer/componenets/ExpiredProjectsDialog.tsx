import { useState, useEffect, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import { runInAction } from 'mobx';
import { appState } from '../models/AppService';
import { trashService } from '../models';
import { PROJECT_RETENTION_DAYS } from '../models/TrashService';
import { trashDuplicateOrdinals, trashDuplicateSuffix } from '../models/trashList';
import { TrashNameBadge } from './TrashViews';

// 항목 키: 신 배치는 휴지통 폴더(dir — 동명 구분용 내부 식별자, 화면에 내지 않음), 구 배치는 이름.
type ExpiredItem = { name: string; deletedAt: number; dir?: string };
const itemKey = (p: ExpiredItem) => p.dir ?? p.name;

const ExpiredProjectsDialog = observer(() => {
  const projects = appState.pendingExpiredProjects as ExpiredItem[];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 같은 이름 (2)(3) 표시 번호 — 휴지통 목록과 같은 번호가 되도록 휴지통 전체 기준으로 계산(S2).
  const [allTrash, setAllTrash] = useState<ExpiredItem[] | null>(null);

  // Reset selection when project list changes
  useEffect(() => {
    setSelected(new Set());
  }, [projects.length]);

  useEffect(() => {
    if (projects.length === 0) return;
    let cancelled = false;
    trashService
      .getDeletedProjects()
      .then((items) => {
        if (!cancelled) setAllTrash(items);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projects.length]);

  const deferAll = useCallback(async () => {
    const items = projects.map((p) => ({ name: p.name, dir: p.dir }));
    if (items.length > 0) {
      await trashService.deferProjects(items);
    }
    runInAction(() => {
      appState.pendingExpiredProjects = [];
    });
  }, [projects]);

  // ESC 키로 닫기 비활성화 — 명시적 버튼 클릭 필요

  if (projects.length === 0) return null;

  const ordinals = trashDuplicateOrdinals(
    (allTrash ?? projects).map((p) => ({ key: itemKey(p), name: p.name, deletedAt: p.deletedAt })),
  );

  const now = Date.now();
  const allSelected = selected.size === projects.length && projects.length > 0;

  const toggleSelect = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(projects.map(itemKey)));
    }
  };

  const removeFromPending = (keys: string[]) => {
    runInAction(() => {
      appState.pendingExpiredProjects = (
        appState.pendingExpiredProjects as ExpiredItem[]
      ).filter((p) => !keys.includes(itemKey(p)));
    });
    setSelected((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => next.delete(k));
      return next;
    });
  };

  const handleDelete = async (keys: string[]) => {
    const targets = projects.filter((p) => keys.includes(itemKey(p)));
    const done: string[] = [];
    for (const p of targets) {
      try {
        await trashService.permanentlyDeleteProject(p.name, p.dir);
        done.push(itemKey(p));
      } catch (e: any) {
        appState.pushMessage(
          `프로젝트 "${p.name}" 영구 삭제에 실패했습니다: ${e?.message ?? e}`,
        );
      }
    }
    removeFromPending(done);
  };

  const handleDefer = async (keys: string[]) => {
    const targets = projects.filter((p) => keys.includes(itemKey(p)));
    await trashService.deferProjects(targets.map((p) => ({ name: p.name, dir: p.dir })));
    removeFromPending(keys);
  };

  const selectedKeys = Array.from(selected);
  const allKeys = projects.map(itemKey);

  return (
    <div
      className="fixed inset-0 flex items-center justify-center confirm-window"
    >
      <div className="flex flex-col m-4 p-4 rounded-md r-modal shadow-xl bg-[var(--c-zone)] text-default w-[28rem] max-h-[80vh]">
        <div className="text-center text-default font-bold mb-2">
          만료된 프로젝트 정리
        </div>
        <div className="text-center text-sm text-default mb-3">
          다음 프로젝트들의 보존 기한({PROJECT_RETENTION_DAYS}일)이 만료되었습니다.
          <br />
          영구 삭제하거나 {PROJECT_RETENTION_DAYS}일 유예할 수 있습니다.
        </div>

        {/* Select all */}
        <label className="flex items-center gap-2 px-2 py-1 cursor-pointer text-default text-sm border-b line-color">
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
            const key = itemKey(proj);
            const days = Math.floor(
              (now - proj.deletedAt) / (24 * 60 * 60 * 1000),
            );
            const d = new Date(proj.deletedAt);
            const dateStr = proj.deletedAt
              ? d.toLocaleDateString()
              : '알 수 없음';
            return (
              <label
                key={key}
                className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-100 dark:hover:bg-slate-700 cursor-pointer rounded"
              >
                <input
                  type="checkbox"
                  checked={selected.has(key)}
                  onChange={() => toggleSelect(key)}
                />
                <span className="flex-1 text-sm text-default truncate">
                  {proj.name}
                  <TrashNameBadge
                    text={trashDuplicateSuffix(ordinals.get(key)).trim()}
                    tone="orange"
                  />
                </span>
                <span className="text-xs text-muted flex-none">
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
            onClick={() => handleDelete(selectedKeys)}
          >
            선택 삭제
          </button>
          <button
            className="flex-1 min-w-[6rem] px-3 py-2 rounded back-red clickable text-sm"
            onClick={() => handleDelete(allKeys)}
          >
            모두 삭제
          </button>
          <button
            className="flex-1 min-w-[6rem] px-3 py-2 rounded back-sky clickable text-sm disabled:opacity-40"
            disabled={selected.size === 0}
            onClick={() => handleDefer(selectedKeys)}
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
