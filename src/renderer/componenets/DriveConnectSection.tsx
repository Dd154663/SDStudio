// Google 드라이브 연동 구역 (드라이브 API ①, 2026-09-28)
//
// 환경설정 「시스템」 탭에서 환경설정 내보내기·불러오기(ConfigSyncSection) 바로 위에 들어간다.
// backend.driveAuthSupported() 가 false 인 플랫폼(Android, ④ 전까지)은 렌더하지 않는다.
//
// 상태의 진실은 main 이다: 마운트 시 driveAuthStatus() 로 조회하고, onDriveAuthChanged 로
// 다른 창의 연결·해제도 반영한다. 연결은 시스템 브라우저 승인(최대 5분)을 기다리며, 그동안
// [취소] 를 보인다. 해제는 확인 1회. 문구·요약 규칙은 models/googleDrive.ts.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { backend } from '../models';
import { appState } from '../models/AppService';
import { describeStatus, GOOGLE_DRIVE_TEXT } from '../models/googleDrive';
import type { DriveAuthStatus } from '../../shared/googleDriveAuth';

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

const btn = 'round-button h-8 text-sm';
const tag = 'text-xs px-2 py-1 rounded-full whitespace-nowrap';

const DriveConnectSection = () => {
  const supported = backend.driveAuthSupported();
  const [status, setStatus] = useState<DriveAuthStatus | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const aliveRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const s = await backend.driveAuthStatus();
      if (aliveRef.current) setStatus(s);
    } catch (e: any) {
      if (aliveRef.current) {
        setStatus({ connected: false, persistent: true, error: GOOGLE_DRIVE_TEXT.statusFailed });
      }
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    if (!supported) return undefined;
    refresh();
    const off = backend.onDriveAuthChanged((s) => {
      if (aliveRef.current) setStatus(s);
    });
    return () => {
      aliveRef.current = false;
      off();
    };
  }, [supported, refresh]);

  if (!supported) return null;

  const view = describeStatus(status, connecting);

  const connect = async () => {
    if (connecting || busy) return;
    setConnecting(true);
    try {
      const s = await backend.driveAuthConnect();
      if (aliveRef.current) setStatus(s);
      appState.pushMessage(GOOGLE_DRIVE_TEXT.connected(s.email));
    } catch (e: any) {
      if (e?.code !== 'cancelled') {
        appState.pushDialog({
          type: 'yes-only',
          text: GOOGLE_DRIVE_TEXT.connectFailed(e?.code, e?.detail),
        });
      }
      // 실패·취소 뒤 표시를 main 기준으로 맞춘다(방송을 놓쳤을 때 대비).
      await refresh();
    } finally {
      if (aliveRef.current) setConnecting(false);
    }
  };

  const cancel = async () => {
    try {
      await backend.driveAuthCancel();
    } catch (e: any) {
      /* 대기 중인 연결이 없으면 무시 */
    }
  };

  const disconnect = async () => {
    if (busy) return;
    const ok = await askConfirm(
      GOOGLE_DRIVE_TEXT.disconnectConfirm,
      GOOGLE_DRIVE_TEXT.disconnectConfirmButton,
    );
    if (!ok) return;
    setBusy(true);
    try {
      await backend.driveAuthDisconnect();
      appState.pushMessage(GOOGLE_DRIVE_TEXT.disconnected);
    } catch (e: any) {
      appState.pushMessage(GOOGLE_DRIVE_TEXT.disconnectFailed(e?.message || String(e)));
    } finally {
      await refresh();
      if (aliveRef.current) setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="block text-sm font-semibold gray-label">
          {GOOGLE_DRIVE_TEXT.sectionTitle}
        </label>
        <span className={`${tag} ${view.tagClass}`}>{view.label}</span>
      </div>
      {view.detail && (
        <p className="text-sm text-body break-all">{view.detail}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {view.canConnect && (
          <button className={btn + ' back-sky'} disabled={busy} onClick={connect}>
            {GOOGLE_DRIVE_TEXT.connectButton}
          </button>
        )}
        {view.canCancel && (
          <>
            <button className={btn + ' back-gray'} onClick={cancel}>
              {GOOGLE_DRIVE_TEXT.cancelButton}
            </button>
            <span className="text-xs text-muted">{GOOGLE_DRIVE_TEXT.connectingHint}</span>
          </>
        )}
        {view.canDisconnect && (
          <button className={btn + ' back-gray'} disabled={busy} onClick={disconnect}>
            {GOOGLE_DRIVE_TEXT.disconnectButton}
          </button>
        )}
      </div>
      {view.error && <p className="text-xs text-red-500 break-words">{view.error}</p>}
      {view.persistenceNote && (
        <p className="text-xs text-faint break-words">{view.persistenceNote}</p>
      )}
      <div className="r-card rounded-lg border line-color bg-[var(--c-zone)] p-3 text-xs text-body space-y-1">
        <p>{GOOGLE_DRIVE_TEXT.description}</p>
        <p className="text-muted">{GOOGLE_DRIVE_TEXT.storageNote}</p>
      </div>
    </div>
  );
};

export default DriveConnectSection;
