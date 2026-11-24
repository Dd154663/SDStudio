// 글로벌 프리셋·글로벌 캐릭터 프리셋 휴지통 보기(2026-11-24, 플랜 guides/plans/2026-11-18-global-library-trash.md).
//  · 진입 = 글로벌 프리셋 탭 도구줄·캐릭터 프리셋 관리 창 글로벌 보기의 「휴지통 (N)」(GlobalLibraryTrashButton). 앱의 기존
//    휴지통 화면(프로젝트·씬·이미지)에는 섞지 않는다.
//  · 모양은 TrashViews.tsx 의 휴지통 목록(useTrashListPanel)을 본뜬다 — ModalOverlay size m, 도구줄(스크롤 밖) =
//    「N개 · 최근 삭제 순」 + [선택 모드] + [휴지통 비우기](back-red, 0개면 비활성·숨기지 않음) + 보관 안내, 본문 = 목록만.
//    줄 = 이름·종류·삭제한 날·남은 보관 일수(+ 작은 대표 이미지) + [복원](back-green) [영구 삭제](back-red).
//    선택 모드 = 체크 + 둘째 줄 [선택 복원][선택 영구 삭제](줄 버튼은 숨김 — 한 자리에 같은 동작이 두 벌 보이지 않게).
//  · 새 색·새 z 값·등장 움직임 없음(기존 btn·back-*·round-button·line-color·r-card 토큰 클래스만).
//  · 동작은 서비스 공개 메서드(restoreFromTrash·purgeFromTrash·emptyTrash)만 — 저장·이미지 파일 정리는 서비스가 한다.
import * as React from 'react';
import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { FaCheckSquare, FaSquare, FaTrash } from 'react-icons/fa';
import { ActionIcon } from './ActionIcon';
import { EmptyState } from './EmptyState';
import ModalOverlay from './ModalOverlay';
import { globalCharacterPresetService, globalPresetService } from '../models';
import { appState } from '../models/AppService';
import { deleteConfirmText, failedNamesLine } from '../models/deleteFlowRules';
import { formatTrashDate } from './TrashViews';
import {
  GLOBAL_TRASH_TEXT,
  sortGlobalTrashNewestFirst,
  trashDaysLeft,
  type GlobalTrashPurgeResult,
  type GlobalTrashRestoreOutcome,
} from '../models/globalLibraryTrash';

export type GlobalLibraryTrashKind = 'presets' | 'characters';

interface TrashRowData {
  id: string;
  name: string;
  kindText: string;
  deletedAt: number;
  extra?: string;
  /** 대표 이미지 토큰(없으면 칸만) */
  image?: string;
}

interface TrashSource {
  label: string;
  rows(): TrashRowData[];
  fetchImage(token: string): Promise<string | null>;
  restore(id: string): Promise<GlobalTrashRestoreOutcome<{ name: string }>>;
  purge(ids: string[]): Promise<GlobalTrashPurgeResult>;
  empty(): Promise<GlobalTrashPurgeResult>;
}

const PRESET_KIND_TEXT: Record<string, string> = {
  SDImageGen: '그림체 프리셋',
  SDImageGenEasy: '그림체 프리셋(이지)',
};

function sourceOf(kind: GlobalLibraryTrashKind): TrashSource {
  if (kind === 'presets') {
    return {
      label: '글로벌 프리셋',
      rows: () =>
        sortGlobalTrashNewestFirst(globalPresetService.trash).map((t) => ({
          id: t.entry.id,
          name: t.entry.name,
          kindText: PRESET_KIND_TEXT[t.entry.workflowType] ?? '글로벌 프리셋',
          deletedAt: t.deletedAt,
          image: t.entry.profile,
        })),
      fetchImage: (token) => globalPresetService.fetchProfileImage(token),
      restore: (id) => globalPresetService.restoreFromTrash(id),
      purge: (ids) => globalPresetService.purgeFromTrash(ids),
      empty: () => globalPresetService.emptyTrash(),
    };
  }
  return {
    label: '글로벌 캐릭터 프리셋',
    rows: () =>
      sortGlobalTrashNewestFirst(globalCharacterPresetService.trash).map((t) => ({
        id: t.entry.id,
        name: t.entry.name,
        kindText: '캐릭터 프리셋',
        deletedAt: t.deletedAt,
        extra: t.entry.folder ? `폴더 ${t.entry.folder}` : '미분류',
        image: t.entry.preset?.representativeImage || t.entry.preset?.vibes?.[0]?.path || undefined,
      })),
    fetchImage: (token) => globalCharacterPresetService.fetchImageData(token),
    restore: (id) => globalCharacterPresetService.restoreFromTrash(id),
    purge: (ids) => globalCharacterPresetService.purgeFromTrash(ids),
    empty: () => globalCharacterPresetService.emptyTrash(),
  };
}

/** 휴지통 항목 수(진입 버튼 숫자) */
export function globalTrashCount(kind: GlobalLibraryTrashKind): number {
  const svc = kind === 'presets' ? globalPresetService : globalCharacterPresetService;
  return svc.trash?.length ?? 0;
}

/** 복원 결과 → 안내 한 줄(이름 바뀜·이미지 없음·폴더 없음 덧붙임) */
export function restoreOutcomeText(name: string, r: GlobalTrashRestoreOutcome<{ name: string }>): string {
  if (r.kind === 'not-in-trash') return GLOBAL_TRASH_TEXT.notInTrash;
  if (r.kind === 'id-taken') return GLOBAL_TRASH_TEXT.idTaken(name);
  const parts = [
    r.renamedFrom ? GLOBAL_TRASH_TEXT.restoredAs(r.renamedFrom, r.entry.name) : GLOBAL_TRASH_TEXT.restored(r.entry.name),
  ];
  if (r.missingImages > 0) parts.push(GLOBAL_TRASH_TEXT.imageMissing(r.missingImages));
  if ('folderDropped' in r && r.folderDropped) parts.push(GLOBAL_TRASH_TEXT.folderDropped(r.folderDropped));
  return parts.join(' ');
}

const TrashThumb = ({ token, fetchImage }: { token?: string; fetchImage: (t: string) => Promise<string | null> }) => {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    if (!token) return;
    fetchImage(token)
      .then((d) => {
        if (!cancelled) setSrc(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [token]);
  return src ? (
    <img src={src} draggable={false} className="w-10 h-10 flex-none rounded object-cover" alt="" />
  ) : (
    <div className="w-10 h-10 flex-none rounded border line-color bg-[var(--c-surface)]" aria-hidden />
  );
};

export const GlobalLibraryTrashView = observer(
  ({ kind, onClose }: { kind: GlobalLibraryTrashKind; onClose: () => void }) => {
    const source = sourceOf(kind);
    const rows = source.rows();
    const [selectMode, setSelectMode] = useState(false);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const now = Date.now();
    // 휴지통이 바뀌면(다른 창·만료 정리) 사라진 선택은 버린다
    const liveSelected = rows.filter((r) => selected.has(r.id)).map((r) => r.id);
    const empty = rows.length === 0;

    const toggle = (id: string) =>
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    const exitSelect = () => {
      setSelectMode(false);
      setSelected(new Set());
    };

    const handleRestore = async (row: TrashRowData) => {
      try {
        const r = await source.restore(row.id);
        appState.pushMessage(restoreOutcomeText(row.name, r));
      } catch (e: any) {
        appState.pushMessage(e?.message || '복원하지 못했습니다.');
      }
    };

    const reportPurge = (r: GlobalTrashPurgeResult, text: string) => {
      appState.pushMessage(r.saved ? text : GLOBAL_TRASH_TEXT.saveFailed);
    };

    // 영구 삭제 확인 = 되돌릴 수 없는 위험 확인(danger 'permanent' — Enter 로 넘어가지 않는다)
    const handlePurge = (row: TrashRowData) => {
      appState.pushDialog({
        type: 'confirm',
        ...deleteConfirmText({
          kind: 'globalPreset',
          name: row.name,
          outcome: 'permanent',
          extra: GLOBAL_TRASH_TEXT.purgeExtra,
        }),
        callback: async () => {
          try {
            const r = await source.purge([row.id]);
            reportPurge(r, GLOBAL_TRASH_TEXT.purged(r.removed));
          } catch (e: any) {
            appState.pushMessage(e?.message || '영구 삭제하지 못했습니다.');
          }
        },
      });
    };

    const handleRestoreSelected = async () => {
      const targets = rows.filter((r) => selected.has(r.id));
      if (targets.length === 0) return;
      let ok = 0;
      const failed: string[] = [];
      const notes: string[] = [];
      for (const row of targets) {
        try {
          const r = await source.restore(row.id);
          if (r.kind === 'restored') {
            ok++;
            if (r.renamedFrom || r.missingImages > 0 || ('folderDropped' in r && r.folderDropped)) {
              notes.push(restoreOutcomeText(row.name, r));
            }
          } else failed.push(row.name);
        } catch (e) {
          failed.push(row.name);
        }
      }
      exitSelect();
      if (failed.length === 0 && notes.length === 0) {
        appState.pushMessage(GLOBAL_TRASH_TEXT.restoredMany(ok));
        return;
      }
      appState.pushDialog({
        type: 'yes-only',
        text: [
          GLOBAL_TRASH_TEXT.restoredMany(ok),
          ...(failed.length > 0 ? [`복원하지 못한 항목: ${failedNamesLine(failed)}`] : []),
          ...notes.slice(0, 5),
        ].join('\n'),
      });
    };

    const handlePurgeSelected = () => {
      const ids = liveSelected;
      if (ids.length === 0) return;
      appState.pushDialog({
        type: 'confirm',
        ...deleteConfirmText({
          kind: 'globalPreset',
          count: ids.length,
          outcome: 'permanent',
          extra: GLOBAL_TRASH_TEXT.purgeExtra,
        }),
        callback: async () => {
          try {
            const r = await source.purge(ids);
            exitSelect();
            reportPurge(r, GLOBAL_TRASH_TEXT.purged(r.removed));
          } catch (e: any) {
            appState.pushMessage(e?.message || '영구 삭제하지 못했습니다.');
          }
        },
      });
    };

    const handleEmpty = () => {
      if (empty) return;
      appState.pushDialog({
        type: 'confirm',
        ...deleteConfirmText({
          kind: 'globalPreset',
          count: rows.length,
          outcome: 'permanent',
          extra: GLOBAL_TRASH_TEXT.emptyExtra,
        }),
        callback: async () => {
          try {
            const r = await source.empty();
            exitSelect();
            reportPurge(r, GLOBAL_TRASH_TEXT.emptied(r.removed));
          } catch (e: any) {
            appState.pushMessage(e?.message || '휴지통을 비우지 못했습니다.');
          }
        },
      });
    };

    const allSelected = rows.length > 0 && liveSelected.length === rows.length;

    const toolbar = (
      <div className="w-full flex flex-col gap-2" data-trash-toolbar data-global-trash-toolbar={kind}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="flex-1 min-w-0 text-sm text-muted">{rows.length}개 · 최근 삭제 순</span>
          {!empty && (
            <button
              className={'round-button flex-none ' + (selectMode ? 'back-orange' : 'back-gray')}
              aria-pressed={selectMode}
              onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
            >
              <FaCheckSquare className="mr-1" />
              선택 모드
            </button>
          )}
          <button
            className="round-button back-red flex-none disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleEmpty}
            disabled={empty}
            data-global-trash-empty=""
          >
            <FaTrash className="mr-1" />
            휴지통 비우기
          </button>
        </div>
        {selectMode && !empty && (
          <div className="flex items-center gap-2 flex-wrap" data-global-trash-selection="">
            <span className="text-sm text-muted">{liveSelected.length}개 선택</span>
            <button
              className="text-xs btn-link"
              onClick={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
            >
              {allSelected ? '전체 해제' : '전체 선택'}
            </button>
            <button
              className="round-button back-green flex-none"
              disabled={liveSelected.length === 0}
              onClick={handleRestoreSelected}
            >
              <ActionIcon id="restore" className="mr-1" />
              선택 복원
            </button>
            <button
              className="round-button back-red flex-none"
              disabled={liveSelected.length === 0}
              onClick={handlePurgeSelected}
            >
              선택 영구 삭제
            </button>
          </div>
        )}
        <div className="text-xs text-faint break-keep">{GLOBAL_TRASH_TEXT.notice}</div>
      </div>
    );

    const body = empty ? (
      <EmptyState size="lg" className="py-10">
        {GLOBAL_TRASH_TEXT.empty}
      </EmptyState>
    ) : (
      <div className="flex flex-col gap-2" data-trash-list data-global-trash-list={kind}>
        {rows.map((row) => {
          const isSel = selected.has(row.id);
          return (
            <div
              key={row.id}
              className={
                'flex items-center gap-3 p-3 border rounded r-card flex-wrap ' +
                (isSel ? 'border-sky-500 list-row-selected' : 'line-color bg-[var(--c-surface-2)]')
              }
              data-global-trash-row={row.id}
            >
              {selectMode && (
                <button
                  className="icon-button flex-none"
                  aria-label={isSel ? '선택 해제' : '선택'}
                  onClick={() => toggle(row.id)}
                >
                  {isSel ? (
                    <FaCheckSquare className="text-sky-500" size={20} />
                  ) : (
                    <FaSquare className="text-faint" size={20} />
                  )}
                </button>
              )}
              <TrashThumb token={row.image} fetchImage={source.fetchImage} />
              <div className="flex-1 min-w-0">
                <div className="font-bold text-default truncate">{row.name}</div>
                <div className="text-sm text-faint">
                  {row.kindText}
                  {row.extra ? ` · ${row.extra}` : ''} · {formatTrashDate(row.deletedAt)} ·{' '}
                  {GLOBAL_TRASH_TEXT.daysLeft(trashDaysLeft(row.deletedAt, now))}
                </div>
              </div>
              {!selectMode && (
                <div className="flex items-center gap-2 flex-none ml-auto">
                  <button className="round-button back-green flex-none" onClick={() => handleRestore(row)}>
                    <ActionIcon id="restore" className="mr-1" />
                    복원
                  </button>
                  <button className="round-button back-red flex-none" onClick={() => handlePurge(row)}>
                    영구 삭제
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );

    return (
      <ModalOverlay
        isOpen
        onClose={onClose}
        title={`🗑️ ${GLOBAL_TRASH_TEXT.title(source.label)}`}
        size="m"
        toolbar={toolbar}
      >
        {body}
      </ModalOverlay>
    );
  },
);

/**
 * 진입 버튼 「휴지통 (N)」(비어 있으면 숫자 없이) + 누르면 휴지통 보기. className 은 놓이는 도구줄의 버튼 모양(중립)을 그대로 받는다.
 */
export const GlobalLibraryTrashButton = observer(
  ({
    kind,
    className,
    iconSize = 14,
    compact = false,
  }: {
    kind: GlobalLibraryTrashKind;
    className: string;
    iconSize?: number;
    /** 좁은 줄(모바일 글로벌 프리셋 도구줄) — 아이콘 + 개수만(이름은 aria-label) */
    compact?: boolean;
  }) => {
    const [open, setOpen] = useState(false);
    const count = globalTrashCount(kind);
    return (
      <>
        <button
          type="button"
          className={className}
          onClick={() => setOpen(true)}
          data-global-trash-open={kind}
          aria-label={GLOBAL_TRASH_TEXT.button(count)}
          title={GLOBAL_TRASH_TEXT.button(count)}
        >
          <FaTrash size={iconSize} />
          {compact ? count > 0 && <span className="tabular-nums">{count}</span> : <span>{GLOBAL_TRASH_TEXT.button(count)}</span>}
        </button>
        {open && <GlobalLibraryTrashView kind={kind} onClose={() => setOpen(false)} />}
      </>
    );
  },
);
