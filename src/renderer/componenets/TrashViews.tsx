// 휴지통 목록 공용 부품 + 씬 휴지통 — 2026-10-02 T1.
//  · 남아 있는 항목을 개수 제한 없이 전부 렌더하고, 스크롤은 ModalOverlay 내용 영역(overflow-auto)이 맡는다.
//  · 머리 줄(개수·「휴지통 비우기」·보존 안내)은 ModalOverlay 도구줄(toolbar 슬롯, 스크롤 밖)에 있어 긴 목록에서도 보인다
//    (2026-11-14 오버레이 묶음 B — 종전 sticky·음수 여백 머리를 대체, useTrashListPanel).
//  · 정렬은 models/trashList.sortTrashNewestFirst(최근 삭제 순) — 프로젝트·씬 휴지통 공통.
//  · 복원·영구 삭제·휴지통 비우기의 동작은 예전 그대로(TrashService 관문 경유).
import { EmptyState } from './EmptyState';
import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { FaTrash } from 'react-icons/fa';
import { ActionIcon } from './ActionIcon';
import ModalOverlay from './ModalOverlay';
import { trashService } from '../models';
import { appState } from '../models/AppService';
import { restoreSceneFromTrashRecorded } from '../models/deleteUndo';
import {
  batchResultLine,
  DELETE_RESULT_TEXT,
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

export interface TrashListPanelProps {
  rows: TrashListRow[];
  loading: boolean;
  onRestore: (key: string) => void;
  onPermanentDelete: (key: string) => void;
  onEmptyAll: () => void;
  // 보존 기간 안내(S3) — 도구줄 둘째 줄, 좁은 폭에서는 줄바꿈.
  notice?: string;
}

/**
 * 휴지통 목록 패널(프로젝트·씬 공용) — 2026-11-14 오버레이 묶음 B, 규약 ⑥(공용 본문의 슬롯 패턴).
 * toolbar = 「N개 · 최근 삭제 순」 + [휴지통 비우기] + 보존 안내(ModalOverlay toolbar 슬롯 — 스크롤 밖 고정),
 * body = 목록만(음수 여백·sticky 없음). 비었으면 본문에 안내 문구, 도구줄은 0개 + 비활성 [휴지통 비우기]
 * (자리가 출렁이지 않게 숨기지 않는다). 창 안에 직접 그리는 호출부는 {toolbar}{body} 를 차례로 둔다.
 */
export function useTrashListPanel({
  rows,
  loading,
  onRestore,
  onPermanentDelete,
  onEmptyAll,
  notice,
}: TrashListPanelProps): { toolbar: React.ReactNode; body: React.ReactNode } {
  const empty = rows.length === 0;
  const toolbar = (
    <div className="w-full" data-trash-toolbar>
      <div className="flex items-center gap-2">
        <span className="flex-1 min-w-0 text-sm text-muted">
          {rows.length}개 · 최근 삭제 순
        </span>
        <button
          className="round-button back-red flex-none disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={onEmptyAll}
          disabled={empty}
        >
          <FaTrash className="mr-1" />
          휴지통 비우기
        </button>
      </div>
      {notice && (
        <div className="mt-1 text-xs text-faint break-keep">{notice}</div>
      )}
    </div>
  );
  const body = empty ? (
    <EmptyState size="lg" className="py-10">
      {loading ? '불러오는 중…' : '휴지통이 비어 있습니다'}
    </EmptyState>
  ) : (
    <div className="flex flex-col gap-2" data-trash-list>
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
            <ActionIcon id="restore" className="mr-1" />
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
  return { toolbar, body };
}

// ===== SceneTrashView (씬 휴지통) =====
// 전역 오버레이 — App.tsx 가 열려 있을 때만 마운트하고, 창(ModalOverlay size m·toolbar)은 이 컴포넌트가 직접 그린다
// (2026-11-14 오버레이 묶음 B). 예전 SceneQueueControl.tsx 의 같은 이름 컴포넌트를 대체(T1 — 최근 삭제 순·개수 머리 줄, 동작 불변).

// name = 휴지통 슬롯 이름(복원 시 씬 이름, S1), originalName = 슬롯과 다를 때 원래 이름(표시용)
type DeletedScene = {
  name: string;
  type: 'scene' | 'inpaint';
  deletedAt: number;
  originalName?: string;
};

export function SceneTrashView({
  projectName,
  onClose,
}: {
  projectName: string;
  onClose: () => void;
}) {
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
      // 복원됐으면 되돌리기 기록(U4 — 되돌림 = 다시 휴지통으로, 다시 실행 = 다시 꺼냄)
      const restored = await restoreSceneFromTrashRecorded(appState.curSession!, name);
      // undefined = 다른 창 잠금으로 조용히 돌아옴(씬·기록 그대로) — 성공 문구를 내지 않는다.
      appState.pushMessage(
        restored ? `씬 "${name}"이(가) 복원되었습니다.` : DELETE_RESULT_TEXT.sceneRestoreBlocked,
      );
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

  const { toolbar, body } = useTrashListPanel({
    loading,
    notice: trashNoticeText('scene'),
    rows: deletedScenes.map((item) => {
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
    }),
    onRestore: handleRestore,
    onPermanentDelete: handlePermanentDelete,
    onEmptyAll: handleEmptyAll,
  });

  return (
    <ModalOverlay isOpen onClose={onClose} title="🗑️ 씬 휴지통" size="m" toolbar={toolbar}>
      {body}
    </ModalOverlay>
  );
}
