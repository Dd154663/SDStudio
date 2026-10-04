// 휴지통 목록 공용 부품 + 씬 휴지통 — 2026-10-02 T1.
//  · 남아 있는 항목을 개수 제한 없이 전부 렌더하고, 스크롤은 ModalOverlay 내용 영역(overflow-auto)이 맡는다.
//  · 머리 줄(개수·「휴지통 비우기」)은 스크롤해도 위에 붙어 있어 긴 목록에서도 개수와 일괄 비우기가 보인다.
//  · 정렬은 models/trashList.sortTrashNewestFirst(최근 삭제 순) — 프로젝트·씬 휴지통 공통.
//  · 복원·영구 삭제·휴지통 비우기의 동작은 예전 그대로(TrashService 관문 경유).
import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { FaTrash, FaTrashRestore } from 'react-icons/fa';
import { trashService } from '../models';
import { appState } from '../models/AppService';
import {
  batchResultLine,
  deleteConfirmText,
  failedNamesLine,
} from '../models/deleteFlowRules';
import {
  sceneTrashLabel,
  sortTrashNewestFirst,
  trashRetentionNotice,
} from '../models/trashList';
import {
  IMAGE_RETENTION_DAYS,
  PROJECT_RETENTION_DAYS,
  SCENE_RETENTION_DAYS,
} from '../models/TrashService';

// 「휴지통 비우기」 확인 창의 덧붙임 줄 — 프로젝트·씬·이미지 휴지통 공통(2026-10-03 E1-5).
export const EMPTY_TRASH_EXTRA = '휴지통에 있는 항목 전부입니다.';

// 보존 기간 안내 문구(S3) — 기간 숫자는 TrashService 상수가 단일 출처.
export function trashNoticeText(kind: 'scene' | 'project' | 'image'): string {
  return trashRetentionNotice(kind, {
    image: IMAGE_RETENTION_DAYS,
    scene: SCENE_RETENTION_DAYS,
    project: PROJECT_RETENTION_DAYS,
  });
}

/**
 * 「모두 비우기」 결과 안내(2026-10-03 X13) — 전부 성공이면 토스트, 실패가 있으면
 * 「삭제 N · 실패 N」과 실패한 이름을 확인 창(yes-only)으로.
 */
export function reportEmptyResult(
  label: string,
  total: number,
  failedNames: readonly string[],
): void {
  const failed = failedNames.length;
  const ok = Math.max(0, total - failed);
  if (failed === 0) {
    appState.pushMessage(`${label}을 비웠습니다. (${batchResultLine(ok, 0)})`);
    return;
  }
  appState.pushDialog({
    type: 'yes-only',
    text:
      `${label} 비우기: ${batchResultLine(ok, failed)}\n` +
      `영구 삭제하지 못한 항목: ${failedNamesLine(failedNames)}\n` +
      '다른 창에서 열려 있거나 파일이 잠겨 있을 수 있습니다. 잠시 뒤 다시 시도해 주세요.',
  });
}

/** 휴지통 이름 옆 보조 표기(동명 구분 번호·삭제 슬롯). 라이트·다크·트루다크 공통 상태색 토큰 사용. */
export function TrashNameBadge({
  text,
  tone,
}: {
  text: string;
  tone: 'orange' | 'sky';
}) {
  if (!text) return null;
  return (
    <span
      className={`${tone === 'orange' ? 'back-orange' : 'back-sky'} rounded px-1 ml-1 text-xs font-bold align-middle`}
    >
      {text}
    </span>
  );
}

export interface TrashListRow {
  key: string;
  title: React.ReactNode;
  subtitle: React.ReactNode;
}

export function formatTrashDate(ts: number): string {
  if (!ts) return '알 수 없음';
  const d = new Date(ts);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

/** 휴지통 목록 표시(프로젝트·씬 공용). 비었으면 안내 문구. */
export function TrashList({
  rows,
  loading,
  onRestore,
  onPermanentDelete,
  onEmptyAll,
  notice,
}: {
  rows: TrashListRow[];
  loading: boolean;
  onRestore: (key: string) => void;
  onPermanentDelete: (key: string) => void;
  onEmptyAll: () => void;
  // 보존 기간 안내(S3) — 머리 줄 아래 한 줄, 좁은 폭에서는 줄바꿈.
  notice?: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="text-center py-10">
        <div className="text-faint text-lg">
          {loading ? '불러오는 중…' : '휴지통이 비어있습니다'}
        </div>
        {notice && !loading && (
          <div className="mt-2 text-xs text-faint break-keep">{notice}</div>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2" data-trash-list>
      {/* 머리 줄: 모달 내용 영역(p-5) 위쪽 여백까지 덮어 스크롤 중에도 위에 붙는다 */}
      <div className="sticky -top-5 z-10 -mx-5 -mt-5 px-5 pt-5 pb-2 bg-[var(--c-zone)] border-b line-color">
        <div className="flex items-center gap-2">
          <span className="flex-1 min-w-0 text-sm text-muted">
            {rows.length}개 · 최근 삭제 순
          </span>
          <button className="round-button back-red flex-none" onClick={onEmptyAll}>
            <FaTrash className="mr-1" />
            휴지통 비우기
          </button>
        </div>
        {notice && (
          <div className="mt-1 text-xs text-faint break-keep">{notice}</div>
        )}
      </div>
      {rows.map((row) => (
        <div
          key={row.key}
          className="flex items-center gap-3 p-3 border line-color rounded r-card bg-[var(--c-surface-2)]"
        >
          <div className="flex-1 min-w-0">
            <div className="font-bold text-default truncate">{row.title}</div>
            <div className="text-sm text-faint">{row.subtitle}</div>
          </div>
          <button
            className="round-button back-green flex-none"
            onClick={() => onRestore(row.key)}
          >
            <FaTrashRestore className="mr-1" />
            복원
          </button>
          <button
            className="round-button back-red flex-none"
            onClick={() => onPermanentDelete(row.key)}
          >
            영구 삭제
          </button>
        </div>
      ))}
    </div>
  );
}

// ===== SceneTrashView (씬 휴지통) =====
// 전역 오버레이(App.tsx)가 호스트. 예전 SceneQueueControl.tsx 의 같은 이름 컴포넌트를 대체한다
// (T1 — 최근 삭제 순 정렬·개수 머리 줄 추가, 동작 불변).

// name = 휴지통 슬롯 이름(복원 시 씬 이름, S1), originalName = 슬롯과 다를 때 원래 이름(표시용)
type DeletedScene = {
  name: string;
  type: 'scene' | 'inpaint';
  deletedAt: number;
  originalName?: string;
};

export function SceneTrashView({ projectName }: { projectName: string }) {
  const [deletedScenes, setDeletedScenes] = useState<DeletedScene[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const items = await trashService.getDeletedScenes(projectName);
      setDeletedScenes(sortTrashNewestFirst(items));
    } catch (e) {
      setDeletedScenes([]);
    }
    setLoading(false);
  }, [projectName]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const findItem = (name: string) => deletedScenes.find((s) => s.name === name);
  const sceneKey = (it: { name: string; type: string }) => it.type + ':' + it.name;
  // 삭제 뒤 휴지통에 남아 있는 항목(실패 판정용). 목록을 못 읽으면 undefined(판정 생략).
  const remainingSceneKeys = async (): Promise<Set<string> | undefined> => {
    try {
      const items = await trashService.getDeletedScenes(projectName);
      return new Set(items.map(sceneKey));
    } catch (e) {
      return undefined;
    }
  };

  const handleRestore = async (name: string) => {
    try {
      await trashService.restoreScene(appState.curSession!, name);
      appState.pushMessage(`씬 "${name}"이(가) 복원되었습니다.`);
      await refresh();
    } catch (e: any) {
      appState.pushMessage(e.message || '씬 복원에 실패했습니다.');
    }
  };

  const handlePermanentDelete = (name: string) => {
    const item = findItem(name);
    if (!item) return;
    appState.pushDialog({
      type: 'confirm',
      ...deleteConfirmText({
        kind: item.type === 'inpaint' ? 'inpaintScene' : 'scene',
        name: item.name,
        outcome: 'permanent',
      }),
      callback: async () => {
        // 일괄 작업 잠금(2026-07-18): 씬 폴더 삭제(이미지 다수)는 무거움 — 전체화면 잠금
        appState.setProgressDialog({
          text: '씬 영구 삭제 중...',
          done: 0,
          total: 1,
        });
        let error: string | undefined;
        try {
          await trashService.permanentlyDeleteScene(
            projectName,
            item.name,
            item.type,
          );
        } catch (e: any) {
          error = e?.message || '씬을 영구 삭제하지 못했습니다.';
        } finally {
          appState.setProgressDialog(undefined);
        }
        // 실패를 삼키지 않는다 — 예외이거나 목록에 그대로 남아 있으면 실패로 안내(X13)
        const left = await remainingSceneKeys();
        if (error || left?.has(sceneKey(item))) {
          appState.pushMessage(error || `씬 "${item.name}"을(를) 영구 삭제하지 못했습니다.`);
        } else {
          appState.pushMessage(`씬 "${item.name}"을(를) 영구 삭제했습니다.`);
        }
        await refresh();
      },
    });
  };

  // 프로젝트 휴지통과 동일하게 「휴지통 비우기」를 제공(휴지통 3종 기능 일관성).
  const handleEmptyAll = () => {
    appState.pushDialog({
      type: 'confirm',
      ...deleteConfirmText({
        kind: 'scene',
        count: deletedScenes.length,
        outcome: 'permanent',
        extra: EMPTY_TRASH_EXTRA,
      }),
      callback: async () => {
        // 일괄 작업 잠금(2026-07-18): 저사양(특히 모바일) 보호 — finally 해제 보장
        const lockText = '씬 휴지통 비우는 중...';
        const targets = deletedScenes.slice();
        const total = targets.length;
        let done = 0;
        const thrown = new Set<string>();
        appState.setProgressDialog({ text: lockText, done, total });
        try {
          for (const item of targets) {
            try {
              await trashService.permanentlyDeleteScene(
                projectName,
                item.name,
                item.type,
              );
            } catch (e) {
              console.error('씬 영구 삭제 실패:', item.name, e);
              thrown.add(sceneKey(item));
            }
            appState.setProgressDialog({ text: lockText, done: ++done, total });
          }
        } finally {
          appState.setProgressDialog(undefined);
        }
        // 개별 실패를 세어 결과를 알린다 — 예외 또는 비운 뒤에도 목록에 남은 항목(X13)
        const left = await remainingSceneKeys();
        const failedNames = targets
          .filter((it) => thrown.has(sceneKey(it)) || left?.has(sceneKey(it)))
          .map((it) => it.name);
        reportEmptyResult('씬 휴지통', total, failedNames);
        await refresh();
      },
    });
  };

  return (
    <TrashList
      loading={loading}
      notice={trashNoticeText('scene')}
      rows={deletedScenes.map((item) => {
        // 같은 이름 재삭제·일반/변형 동명은 「S (삭제 2)」 슬롯으로 따로 보관된다 — 원래 이름 + 보조 표기
        const label = sceneTrashLabel(item);
        return {
          key: item.name,
          title: (
            <>
              {item.type === 'inpaint' ? '🎨 ' : '🖼️ '}
              {label.base}
              <TrashNameBadge text={label.suffix} tone="sky" />
            </>
          ),
          subtitle:
            `${item.type === 'inpaint' ? '인페인트' : '일반'} 씬 · ${formatTrashDate(item.deletedAt)}` +
            (label.suffix ? ` · 복원하면 「${item.name}」 이름으로 돌아옵니다` : ''),
        };
      })}
      onRestore={handleRestore}
      onPermanentDelete={handlePermanentDelete}
      onEmptyAll={handleEmptyAll}
    />
  );
}
