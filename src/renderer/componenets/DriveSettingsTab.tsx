// 환경설정 「드라이브」 탭 (드라이브 API ⑤, 2026-10-01 — PC·모바일 공통)
//
// 위→아래 4구역:
//   ① Google 드라이브 연동(DriveConnectSection — 연결 상태·연결/해제). 미지원 기기(Google Play 서비스가
//      없는 Android 등)는 「지원하지 않습니다」 안내만.
//   ② 백업 목록 인라인(DriveBackupList 관리 모드 — 필터·새로 고침·드라이브에서 열기·받기·삭제=휴지통).
//      연결됐을 때만. 설정 화면은 모든 탭을 늘 마운트하므로 active(이 탭이 보이는지)가 true 로 바뀔 때
//      조회하고 그 뒤는 [새로 고침]으로만 다시 읽는다. 미연결이면 안내 한 줄.
//   ③ 환경설정 내보내기·불러오기(ConfigSyncSection — 「시스템」 탭에서 이동, props 그대로).
//   ④ PC 전용 「고급: 로컬 동기화 폴더」(syncFolder — 「저장/이미지」 탭에서 이동). 접이식·기본 접힘,
//      Google 드라이브에 연결돼 있으면 숨긴다(과도기 1단계 — 값은 보존·저장 그대로, 연결 시 목적지로
//      제안하지 않는 규칙은 driveSync.resolveExportDestinations).
//
// 연결 여부의 진실은 main/네이티브다. 첫 표시는 네트워크 없는 isGoogleDriveConnected() 로 정하고, 이후는
// DriveConnectSection 의 상태(조회·연결·해제·다른 창 방송)를 따른다.

import React, { useCallback, useEffect, useState } from 'react';
import { backend, isMobile } from '../models';
import { GOOGLE_DRIVE_TEXT } from '../models/googleDrive';
import { DRIVE_SYNC_TEXT, isGoogleDriveConnected } from '../models/driveSync';
import type { DriveAuthStatus } from '../../shared/googleDriveAuth';
import DriveConnectSection from './DriveConnectSection';
import { DriveBackupList } from './DriveBackupManager';
import ConfigSyncSection from './ConfigSyncSection';

interface Props {
  // 이 탭이 지금 보이는지(설정 화면 activeTab).
  active: boolean;
  // 설정 화면에 저장 안 된 변경이 있는지(환경설정 불러오기 확인용).
  dirty: boolean;
  // 환경설정 불러오기 적용 뒤 설정 화면 로컬 상태를 다시 읽는다.
  reloadConfig: () => Promise<void> | void;
  // 로컬 동기화 폴더(PC 전용, 설정 화면 로컬 상태 — 「저장」 때 config.syncFolder 로 기록).
  syncFolder: string;
  setSyncFolder: (value: string) => void;
  selectSyncFolder: () => void;
}

const DriveSettingsTab = ({
  active,
  dirty,
  reloadConfig,
  syncFolder,
  setSyncFolder,
  selectSyncFolder,
}: Props) => {
  const T = GOOGLE_DRIVE_TEXT;
  // 지원 여부는 렌더마다 읽는다(Android 는 앱 시작 직후 Play 서비스 확인이 끝나기 전 false 일 수 있어,
  // 탭을 바꿀 때 다시 그려지면서 반영된다).
  const supported = backend.driveAuthSupported();
  // null = 아직 모름(목록·고급 구역을 잠시 보류).
  const [connected, setConnected] = useState<boolean | null>(null);
  // 클라이언트 값이 주입되지 않은 빌드(2026-10-02) — 백업 목록 구역을 숨긴다.
  const [notConfigured, setNotConfigured] = useState(false);

  useEffect(() => {
    if (!supported) return undefined;
    let alive = true;
    isGoogleDriveConnected().then((c) => {
      // DriveConnectSection 이 먼저 알려 줬으면 그 값을 둔다.
      if (alive) setConnected((prev) => (prev === null ? c : prev));
    });
    return () => {
      alive = false;
    };
  }, [supported]);

  const onStatusChange = useCallback((s: DriveAuthStatus) => {
    setConnected(!!s.connected);
    setNotConfigured(!!s.notConfigured);
  }, []);

  // 고급 구역: PC 만, 미지원이거나 연결 안 됐을 때만(연결 여부를 모르는 동안은 보류).
  const showAdvanced = !isMobile && (!supported || connected === false);

  return (
    <div className="space-y-4">
      {/* ① 연결 */}
      {supported ? (
        <DriveConnectSection onStatusChange={onStatusChange} />
      ) : (
        <div className="space-y-1">
          <label className="block text-sm font-semibold gray-label">{T.sectionTitle}</label>
          <p className="text-sm text-body break-words">{T.unsupported}</p>
          {isMobile && (
            <p className="text-xs text-muted break-words">{T.unsupportedHintMobile}</p>
          )}
        </div>
      )}

      {/* ② 백업 목록(관리 모드 인라인) */}
      {supported && !notConfigured && (
        <>
          <hr className="line-color" />
          <div className="space-y-2">
            <label className="block text-sm font-semibold gray-label">{T.managerTitle}</label>
            {connected === true && (
              <DriveBackupList
                mode="manage"
                active={active}
                ctx={{ config: { dirty, onConfigImported: reloadConfig } }}
                listClassName="max-h-[40vh] overflow-y-auto pr-1"
              />
            )}
            {connected === false && (
              <p className="text-sm text-muted break-words">{T.backupListDisconnected}</p>
            )}
            {connected === null && <p className="text-sm text-muted">{T.status.loading}</p>}
          </div>
        </>
      )}

      {/* ③ 환경설정 내보내기·불러오기 */}
      <hr className="line-color" />
      <ConfigSyncSection dirty={dirty} onConfigImported={reloadConfig} />

      {/* ④ 고급: 로컬 동기화 폴더(PC 전용, 연결 시 숨김 — 값은 보존). 문구 단일 출처 = driveSync.ts */}
      {showAdvanced && (
        <>
          <hr className="line-color" />
          <details>
            <summary className="cursor-pointer select-none text-sm font-semibold gray-label">
              {DRIVE_SYNC_TEXT.settingAdvancedTitle}
            </summary>
            <div className="mt-3 space-y-2">
              <p className="text-xs text-muted">{DRIVE_SYNC_TEXT.settingReplacedNote}</p>
              <div>
                <label className="block text-sm gray-label mb-1">
                  {DRIVE_SYNC_TEXT.settingLabel}
                </label>
                <p className="text-xs text-muted mb-2">{DRIVE_SYNC_TEXT.settingDescription}</p>
                <div className="text-sm text-muted bg-[var(--c-surface-2)] rounded px-3 py-2 break-all">
                  {syncFolder || DRIVE_SYNC_TEXT.settingUnset}
                </div>
              </div>
              <div className="flex gap-2">
                <button className="btn flex-1 back-green py-2 rounded" onClick={selectSyncFolder}>
                  {DRIVE_SYNC_TEXT.settingSelect}
                </button>
                {syncFolder && (
                  <button
                    className="btn px-3 back-gray py-2 rounded"
                    onClick={() => setSyncFolder('')}
                  >
                    {DRIVE_SYNC_TEXT.settingClear}
                  </button>
                )}
              </div>
            </div>
          </details>
        </>
      )}
    </div>
  );
};

export default DriveSettingsTab;
