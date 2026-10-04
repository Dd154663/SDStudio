import { useState, useEffect, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import { runInAction } from 'mobx';
import { appState } from '../models/AppService';
import { trashService } from '../models';
import { PROJECT_RETENTION_DAYS } from '../models/TrashService';
import { trashDuplicateOrdinals, trashDuplicateSuffix } from '../models/trashList';
import { TrashNameBadge } from './TrashViews';
import { deleteConfirmText } from '../models/deleteFlowRules';
import { useBackLayer } from '../models/BackStackService';

// 항목 키: 신 배치는 휴지통 폴더(dir — 동명 구분용 내부 식별자, 화면에 내지 않음), 구 배치는 이름.
type ExpiredItem = { name: string; deletedAt: number; dir?: string };
const itemKey = (p: ExpiredItem) => p.dir ?? p.name;

const ExpiredProjectsDialog = observer(() => {
  const projects = appState.pendingExpiredProjects as ExpiredItem[];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 같은 이름 (2)(3) 표시 번호 — 휴지통 목록과 같은 번호가 되도록 휴지통 전체 기준으로 계산(S2).
  const [allTrash, setAllTrash] = useState<ExpiredItem[] | null>(null);
  // 영구 삭제 확인(창 안 확인 줄) — 대상 키. null 이면 확인 중이 아님(2026-10-03 U1·X5).
  // 전역 확인 창(ConfirmWindow)과 이 창이 같은 층(--z-confirm)이고 이 창이 DOM 뒤에 있어 가려지므로 창 안에서 묻는다.
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null);
  // 영구 삭제 실패 안내 — 토스트는 이 창 백드롭 아래 층이라 가려져 창 안에 보인다.
  const [failures, setFailures] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);

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

  // ESC·Android 뒤로 가기로 닫지 않는다 — 명시적 버튼 선택 필요(의도 유지). 닫기 관문에 「삼키기」로 올려
  // 아래 창이 대신 닫히거나(Esc) 앱이 최소화되지(뒤로 가기) 않게 한다. 영구 삭제 확인 줄이 떠 있으면
  // Esc·뒤로 가기는 그 확인만 취소한다. 확인 창 층이라 선점(preempt).
  useBackLayer(projects.length > 0, () => {
    if (pendingDelete) setPendingDelete(null);
  }, { preempt: true });

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
    const failed: string[] = [];
    setDeleting(true);
    for (const p of targets) {
      try {
        await trashService.permanentlyDeleteProject(p.name, p.dir);
        done.push(itemKey(p));
      } catch (e: any) {
        failed.push(`「${p.name}」 영구 삭제에 실패했습니다: ${e?.message ?? e}`);
      }
    }
    setDeleting(false);
    setFailures(failed);
    removeFromPending(done);
  };

  // [선택 영구 삭제]·[모두 영구 삭제] → 창 안 확인 1회 → 실행
  const askDelete = (keys: string[]) => {
    if (keys.length === 0) return;
    setFailures([]);
    setPendingDelete(keys);
  };

  const handleDefer = async (keys: string[]) => {
    const targets = projects.filter((p) => keys.includes(itemKey(p)));
    await trashService.deferProjects(targets.map((p) => ({ name: p.name, dir: p.dir })));
    removeFromPending(keys);
  };

  const selectedKeys = Array.from(selected);
  const allKeys = projects.map(itemKey);
  // 창 안 확인 줄의 문구·버튼 라벨 — 삭제 확인 문구 단일 출처(2026-10-03 E1)
  const pendingConfirm = pendingDelete
    ? deleteConfirmText({ kind: 'project', count: pendingDelete.length, outcome: 'permanent' })
    : null;

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

        {/* 영구 삭제 실패 안내(창 안 — 토스트는 이 창에 가려진다) */}
        {failures.length > 0 && (
          <div
            className="mb-2 px-3 py-2 rounded text-sm back-red whitespace-pre-wrap break-words"
            role="alert"
            data-expired-failures
          >
            {failures.join('\n')}
          </div>
        )}

        {pendingDelete ? (
          // 영구 삭제 확인 1회(되돌릴 수 없음) — [영구 삭제] / [취소]
          <div className="flex flex-col gap-2 mt-2" data-expired-confirm>
            <div className="text-center text-sm text-default whitespace-pre-line">
              {pendingConfirm!.text}
            </div>
            <div className="flex gap-2">
              <button
                className="flex-1 px-3 py-2 rounded back-red clickable text-sm disabled:opacity-40"
                disabled={deleting}
                onClick={async () => {
                  const keys = pendingDelete;
                  await handleDelete(keys);
                  setPendingDelete(null);
                }}
              >
                {deleting ? '삭제 중…' : pendingConfirm!.confirmText}
              </button>
              <button
                className="flex-1 px-3 py-2 rounded back-gray clickable text-sm disabled:opacity-40"
                disabled={deleting}
                onClick={() => setPendingDelete(null)}
              >
                취소
              </button>
            </div>
          </div>
        ) : (
          /* Action buttons */
          <div className="flex flex-wrap gap-2 mt-2">
            <button
              className="flex-1 min-w-[6rem] px-3 py-2 rounded back-red clickable text-sm disabled:opacity-40"
              disabled={selected.size === 0}
              onClick={() => askDelete(selectedKeys)}
            >
              선택 영구 삭제
            </button>
            <button
              className="flex-1 min-w-[6rem] px-3 py-2 rounded back-red clickable text-sm"
              onClick={() => askDelete(allKeys)}
            >
              모두 영구 삭제
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
        )}
      </div>
    </div>
  );
});

export default ExpiredProjectsDialog;
