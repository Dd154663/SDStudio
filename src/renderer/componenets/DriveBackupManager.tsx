// Google 드라이브 백업 관리 창 (드라이브 API ③, 2026-09-28, PC 전용)
//
// 전역 호스트(App 에 1개)가 models/driveImport.ts 의 요청 상태를 그린다. 두 가지로 열린다:
// - 관리(manage): 설정 「시스템」 탭 Google 드라이브 연동 구역의 [백업 관리]. 행마다 [받기][삭제].
//   [받기] = 받아서 바로 불러오기(대상별 기존 흐름), [삭제] = 확인 1회 뒤 드라이브 휴지통 이동(영구 삭제 아님).
// - 고르기(pick): 불러오기 출처로 「Google 드라이브」를 골랐을 때. 종류 필터 고정·숨김, 행마다 [선택].
// 목록은 SDStudio 폴더 바로 아래 파일(최신 먼저). 표식 없는 파일은 종류 「알 수 없음」(관리 모드에만 보임).
// 다른 모달·드로어 위에 뜨도록 --z-modal-top 층을 쓴다(진행 창·확인 창은 그보다 위).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { backend } from '../models';
import { appState } from '../models/AppService';
import {
  closeDriveBackupManager,
  currentDriveManagerRequest,
  driveBackupKindLabel,
  DriveManagerRequest,
  receiveDriveBackup,
} from '../models/driveImport';
import { formatBytes, formatDriveTime, GOOGLE_DRIVE_TEXT } from '../models/googleDrive';
import { DRIVE_EXPORT_KIND_LABEL } from '../models/driveSync';
import {
  DRIVE_BACKUP_KINDS,
  DriveBackupItem,
  driveDownloadErrorText,
  isDriveWebUrl,
} from '../../shared/googleDrive';
import ModalOverlay from './ModalOverlay';

type KindFilter = 'all' | DriveBackupItem['kind'];

const btn = 'round-button h-8 text-sm px-3';
const tag = 'text-xs px-2 py-0.5 rounded-full whitespace-nowrap';

function errorReason(e: any): string {
  if (e?.code) return driveDownloadErrorText(e.code) + (e.detail ? ` (${e.detail})` : '');
  return e?.message || String(e);
}

function askConfirm(text: string, confirmText: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    appState.pushDialog({
      type: 'confirm',
      text,
      confirmText,
      callback: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}

const ManagerBody = ({ req }: { req: DriveManagerRequest }) => {
  const T = GOOGLE_DRIVE_TEXT;
  const pick = req.mode === 'pick';
  const [items, setItems] = useState<DriveBackupItem[] | null>(null);
  const [folderLink, setFolderLink] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<KindFilter>(pick && req.kind ? req.kind : 'all');
  const aliveRef = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const res = await backend.driveList();
      if (!aliveRef.current) return;
      setItems(res.items);
      setFolderLink(res.folderLink);
    } catch (e: any) {
      if (!aliveRef.current) return;
      setItems(null);
      setError(T.listFailed(errorReason(e)));
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [T]);

  useEffect(() => {
    aliveRef.current = true;
    load();
    return () => {
      aliveRef.current = false;
    };
  }, [load]);

  // 필터 선택지 = 전체 + 목록에 있는 종류(공용 순서, 알 수 없음은 끝).
  const kindOptions = useMemo(() => {
    const present = new Set((items || []).map((i) => i.kind));
    const kinds: DriveBackupItem['kind'][] = DRIVE_BACKUP_KINDS.filter((k) => present.has(k));
    if (present.has('unknown')) kinds.push('unknown');
    return kinds;
  }, [items]);

  const visible = useMemo(() => {
    const list = items || [];
    if (pick) return list.filter((i) => i.kind === req.kind);
    return filter === 'all' ? list : list.filter((i) => i.kind === filter);
  }, [items, filter, pick, req.kind]);

  const receive = async (item: DriveBackupItem) => {
    if (busy) return;
    setBusy(true);
    try {
      await receiveDriveBackup(item, req.ctx);
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  };

  const trash = async (item: DriveBackupItem) => {
    if (busy) return;
    const ok = await askConfirm(T.trashConfirm(item.name), T.trashConfirmButton);
    if (!ok) return;
    setBusy(true);
    try {
      await backend.driveTrash(item.id);
      appState.pushMessage(T.trashed(item.name));
    } catch (e: any) {
      appState.pushDialog({ type: 'yes-only', text: T.trashFailed(errorReason(e)) });
    } finally {
      if (aliveRef.current) {
        setBusy(false);
        await load();
      }
    }
  };

  const openFolder = () => {
    if (isDriveWebUrl(folderLink)) backend.driveOpenFile(folderLink).catch(() => {});
  };

  const emptyText =
    (items || []).length === 0 ? T.empty : pick || filter !== 'all' ? T.emptyFiltered : T.empty;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn + ' back-gray'} disabled={loading || busy} onClick={load}>
          {T.refresh}
        </button>
        {isDriveWebUrl(folderLink) && (
          <button className={btn + ' back-gray'} onClick={openFolder}>
            {T.openFolder}
          </button>
        )}
      </div>
      <p className="text-xs text-faint break-words">{pick ? T.pickHint : T.manageHint}</p>
      {!pick && kindOptions.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted mr-1">{T.filterLabel}</span>
          {(['all', ...kindOptions] as KindFilter[]).map((k) => (
            <button
              key={k}
              className={
                'round-button h-7 text-xs px-2.5 ' + (filter === k ? 'back-sky' : 'back-gray')
              }
              onClick={() => setFilter(k)}
            >
              {k === 'all' ? T.filterAll : driveBackupKindLabel(k)}
            </button>
          ))}
        </div>
      )}
      {error && <p className="text-sm text-red-500 whitespace-pre-line break-words">{error}</p>}
      {loading && !items && <p className="text-sm text-muted">{T.loading}</p>}
      {items && visible.length === 0 && !loading && (
        <p className="text-sm text-muted py-4 text-center">{emptyText}</p>
      )}
      {visible.length > 0 && (
        <ul className="space-y-2">
          {visible.map((item) => {
            const meta = [
              formatDriveTime(item.modifiedTime),
              typeof item.size === 'number' ? formatBytes(item.size) : T.sizeUnknown,
              item.device || T.deviceUnknown,
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <li
                key={item.id}
                className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg border line-color bg-[var(--c-surface-2)]"
              >
                <div className="min-w-0 flex-1 basis-56">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={`${tag} ${item.kind === 'unknown' ? 'back-gray' : 'back-sky'}`}
                    >
                      {driveBackupKindLabel(item.kind)}
                    </span>
                    <span className="text-sm text-default break-all">{item.name}</span>
                  </div>
                  <div className="text-xs text-muted mt-0.5 break-words">{meta}</div>
                </div>
                <div className="flex flex-none items-center gap-1.5">
                  {pick ? (
                    <button
                      className={btn + ' back-sky'}
                      disabled={busy}
                      onClick={() => closeDriveBackupManager(item)}
                    >
                      {T.select}
                    </button>
                  ) : (
                    <>
                      <button
                        className={btn + ' back-sky'}
                        disabled={busy}
                        onClick={() => receive(item)}
                      >
                        {T.receive}
                      </button>
                      <button
                        className={btn + ' back-red'}
                        disabled={busy}
                        onClick={() => trash(item)}
                      >
                        {T.trash}
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export const DriveBackupManagerHost = observer(() => {
  const req = currentDriveManagerRequest();
  if (!req) return null;
  const title =
    req.mode === 'pick' && req.kind
      ? GOOGLE_DRIVE_TEXT.pickerTitle(DRIVE_EXPORT_KIND_LABEL[req.kind])
      : GOOGLE_DRIVE_TEXT.managerTitle;
  return (
    <ModalOverlay
      isOpen={true}
      onClose={() => closeDriveBackupManager(null)}
      title={title}
      width="max-w-2xl"
      zIndex="var(--z-modal-top)"
    >
      <ManagerBody key={req.id} req={req} />
    </ModalOverlay>
  );
});

export default DriveBackupManagerHost;
