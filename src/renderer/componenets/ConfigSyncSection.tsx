// 환경설정 내보내기·불러오기 구역 (드라이브 동기화 C안 ③, 2026-09-28)
//
// 환경설정 「드라이브」 탭(PC·모바일 공통, 드라이브 API ⑤ — 이전엔 「시스템」 탭)에 들어간다. 형식·필터·문구는 models/configSync.ts,
// 목적지 선택은 driveSync(saveJsonFile 'config'/'token'), 확인·완료 문구는 importFlow 를 쓴다.
//
// 불러오기 순서(§0 일관화): (PC·Google 드라이브 연결 시 출처 선택) → 파일 고르기 → 형식 검사 →
// (화면에 저장 안 된 변경이 있으면) 확인 → 미리보기(필드군별 바뀌는 항목·켬/끔) → 덮어쓰기 확인 1회
// → 적용 → 완료 안내. 텍스트 이후 단계는 models/configSyncFlow.ts(드라이브 백업 관리 창과 공용,
// 드라이브 API ③에서 컴포넌트 밖으로 이동 — 동작 불변). 미리보기 창은 아래
// ConfigImportPreviewHost(App 에 1개)가 띄운다.
//
// 토큰: 기본 꺼짐. 켤 때 경고 확인, 설정 파일과 별도 파일. 받기는 LoginService 관문으로
// 추가만(파일에서만 — 드라이브 출처 없음). 토큰 값은 화면·로그·토스트에 쓰지 않는다.

import React, { useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { backend, isMobile, loginService } from '../models';
import { appState } from '../models/AppService';
import { saveJsonFile } from '../models/exportUtil';
import {
  chooseImportSource,
  getSyncFolder,
  isGoogleDriveConnectedHint,
  syncFileName,
} from '../models/driveSync';
import { importFromDrive, importTextWithSource } from '../models/driveImport';
import { stringifyExportJson } from '../models/jsonExport';
import {
  buildConfigExport,
  buildTokenExport,
  configFieldLabel,
  CONFIG_SYNC_TEXT,
  countConfigChanges,
  decodeBase64Utf8,
} from '../models/configSync';
import {
  ConfigGroupSelection,
  currentConfigPreviewRequest,
  importConfigText,
  importTokenText,
} from '../models/configSyncFlow';
import ModalOverlay from './ModalOverlay';

interface Props {
  // 설정 화면에 저장 안 된 변경이 있는지(ConfigScreen dirty).
  dirty: boolean;
  // 불러오기 적용 뒤 설정 화면 로컬 상태를 설정 파일에서 다시 읽는다.
  onConfigImported: () => Promise<void> | void;
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

// PC: 드라이브 동기화 폴더(있으면)에서 JSON 필터로 선택기를 열고 원본 바이트를 읽는다.
async function pickJsonTextPc(): Promise<string | undefined> {
  const syncFolder = await getSyncFolder();
  const path = await backend.selectFile({
    ...(syncFolder ? { defaultPath: syncFolder } : {}),
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (!path) return undefined;
  return decodeBase64Utf8(await backend.readBinaryFile(path));
}

function formatCreatedAt(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleString();
}

const btn = 'round-button h-8 text-sm';

const ConfigSyncSection = ({ dirty, onConfigImported }: Props) => {
  const [includeToken, setIncludeToken] = useState(false);
  const [busy, setBusy] = useState(false);
  // Android 는 selectFile 이 tar 전용이라 JSON 은 기존 선례대로 <input type=file> 를 쓴다.
  const configInputRef = useRef<HTMLInputElement>(null);
  const tokenInputRef = useRef<HTMLInputElement>(null);

  // ── 내보내기 ──
  const toggleToken = async (checked: boolean) => {
    if (!checked) {
      setIncludeToken(false);
      return;
    }
    const ok = await askConfirm(
      CONFIG_SYNC_TEXT.tokenWarning,
      CONFIG_SYNC_TEXT.tokenWarningConfirm,
    );
    setIncludeToken(ok);
  };

  const exportToken = async (now: Date) => {
    try {
      const entries = await loginService.getTokenEntriesForExport(
        CONFIG_SYNC_TEXT.currentTokenName,
      );
      if (entries.length === 0) {
        appState.pushMessage(CONFIG_SYNC_TEXT.noToken);
        return;
      }
      const res = await saveJsonFile(
        syncFileName('token', now, 'json'),
        stringifyExportJson(buildTokenExport(entries, now.toISOString())),
        'token',
      );
      if (res !== 'cancelled') appState.pushMessage(CONFIG_SYNC_TEXT.tokenExported);
    } catch (e: any) {
      // 오류 메시지에는 토큰이 들어가지 않는다(파일 쓰기·읽기 오류만).
      appState.pushMessage(CONFIG_SYNC_TEXT.tokenExportFailed(e?.message || String(e)));
    }
  };

  const exportConfig = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (dirty) appState.pushMessage(CONFIG_SYNC_TEXT.exportSavedOnly);
      const now = new Date();
      try {
        const config = await backend.getConfig();
        const appVersion = await backend.getVersion().catch(() => '');
        const data = buildConfigExport(config, {
          createdAt: now.toISOString(),
          appVersion,
          platform: isMobile ? 'android' : 'pc',
        });
        const res = await saveJsonFile(
          syncFileName('config', now, 'json'),
          stringifyExportJson(data),
          'config',
        );
        if (res === 'cancelled') return;
        appState.pushMessage(CONFIG_SYNC_TEXT.exported);
      } catch (e: any) {
        appState.pushMessage(CONFIG_SYNC_TEXT.exportFailed(e?.message || String(e)));
        return;
      }
      if (includeToken) {
        await exportToken(now);
        // 토큰 내보내기는 매번 새로 켜고 경고를 확인하게 한다.
        setIncludeToken(false);
      }
    } finally {
      setBusy(false);
    }
  };

  // ── 설정 불러오기 ── (흐름은 models/configSyncFlow.ts — 드라이브 백업 관리 창과 공용)
  const importCtx = { dirty, onConfigImported };
  const handleConfigText = (text: string) => importConfigText(text, importCtx);

  const startConfigImport = async () => {
    if (busy) return;
    if (isMobile) {
      // Android 미연결(또는 Play 서비스 없음): 기존처럼 사용자 제스처 안에서 바로 선택기.
      if (!isGoogleDriveConnectedHint()) {
        configInputRef.current?.click();
        return;
      }
      // Android 연결(드라이브 API ④): 출처 선택 → 드라이브 또는 문서 선택기(제스처 제한 없음).
      setBusy(true);
      try {
        await importTextWithSource('config', { config: importCtx });
      } catch (e: any) {
        appState.pushMessage(CONFIG_SYNC_TEXT.readFailed);
      } finally {
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    try {
      // 불러오기 출처(드라이브 API ③): PC 에서 Google 드라이브에 연결돼 있으면
      // [Google 드라이브 / 파일]을 묻는다. 미연결이면 묻지 않고 파일.
      const source = await chooseImportSource('config');
      if (source === 'cancelled') return;
      if (source === 'drive') {
        await importFromDrive('config', { config: importCtx });
        return;
      }
      const text = await pickJsonTextPc();
      if (text === undefined) return;
      await handleConfigText(text);
    } catch (e: any) {
      appState.pushMessage(CONFIG_SYNC_TEXT.readFailed);
    } finally {
      setBusy(false);
    }
  };

  // ── 토큰 불러오기 ── (파일에서만 — 토큰 파일은 드라이브에 올리지도 받지도 않는다)
  const handleTokenText = importTokenText;

  const startTokenImport = async () => {
    if (busy) return;
    if (isMobile) {
      tokenInputRef.current?.click();
      return;
    }
    setBusy(true);
    try {
      const text = await pickJsonTextPc();
      if (text === undefined) return;
      await handleTokenText(text);
    } catch (e: any) {
      appState.pushMessage(CONFIG_SYNC_TEXT.readFailed);
    } finally {
      setBusy(false);
    }
  };

  const onMobileFile =
    (handler: (text: string) => Promise<void>) =>
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const input = e.target;
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      setBusy(true);
      try {
        const text = (await file.text()).replace(/^﻿/, '');
        await handler(text);
      } catch (err) {
        appState.pushMessage(CONFIG_SYNC_TEXT.readFailed);
      } finally {
        setBusy(false);
      }
    };

  return (
    <div className="space-y-2">
      <label className="block text-sm font-semibold gray-label">
        {CONFIG_SYNC_TEXT.sectionTitle}
      </label>
      <p className="text-xs text-muted">{CONFIG_SYNC_TEXT.sectionDescription}</p>
      {dirty && <p className="text-xs text-faint">{CONFIG_SYNC_TEXT.savedOnlyNote}</p>}
      <div className="flex flex-wrap gap-2">
        <button className={btn + ' back-sky'} disabled={busy} onClick={exportConfig}>
          {CONFIG_SYNC_TEXT.exportButton}
        </button>
        <button className={btn + ' back-gray'} disabled={busy} onClick={startConfigImport}>
          {CONFIG_SYNC_TEXT.importButton}
        </button>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <input
          type="checkbox"
          id="cfgSyncIncludeToken"
          checked={includeToken}
          disabled={busy}
          onChange={(e) => toggleToken(e.target.checked)}
        />
        <label htmlFor="cfgSyncIncludeToken" className="text-sm gray-label">
          {CONFIG_SYNC_TEXT.tokenExportLabel}
        </label>
      </div>
      <p className="text-xs text-faint ml-6">{CONFIG_SYNC_TEXT.tokenExportDescription}</p>
      <div className="flex flex-wrap gap-2 pt-1">
        <button className={btn + ' back-gray'} disabled={busy} onClick={startTokenImport}>
          {CONFIG_SYNC_TEXT.tokenImportButton}
        </button>
      </div>
      <p className="text-xs text-faint">{CONFIG_SYNC_TEXT.tokenImportDescription}</p>
      {isMobile && (
        <>
          <input
            ref={configInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={onMobileFile(handleConfigText)}
          />
          <input
            ref={tokenInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={onMobileFile(handleTokenText)}
          />
        </>
      )}
    </div>
  );
};

export default ConfigSyncSection;

// ── 불러오기 미리보기(전역 호스트, App 에 1개) ──
// 파일·드라이브 어느 쪽에서 불러와도 같은 창. Google 드라이브 백업 관리 창 위에 뜨도록
// 호스트는 관리 창 호스트 뒤에 두고 같은 층(--z-modal-top)을 쓴다.
const ConfigImportPreviewModal = ({
  req,
}: {
  req: NonNullable<ReturnType<typeof currentConfigPreviewRequest>>;
}) => {
  const { preview } = req;
  const [enabled, setEnabled] = useState<ConfigGroupSelection>(preview.enabled);
  const [applying, setApplying] = useState(false);
  const previewCount = countConfigChanges(preview.diff, enabled);
  const themePresetChanged = preview.diff.some((d) => d.changed.includes('uiThemePresets'));
  const cancel = () => req.resolve(null);
  const apply = async () => {
    if (applying || previewCount === 0) return;
    setApplying(true);
    try {
      if (await req.confirm(enabled)) req.resolve(enabled);
    } finally {
      setApplying(false);
    }
  };

  return (
    <ModalOverlay
      isOpen={true}
      onClose={cancel}
      title={CONFIG_SYNC_TEXT.previewTitle}
      width="max-w-md"
      zIndex="var(--z-modal-top)"
    >
      <div className="space-y-3">
        <p className="text-xs text-muted break-words">
          {CONFIG_SYNC_TEXT.previewSource(
            preview.parsed.platform,
            preview.parsed.appVersion,
            formatCreatedAt(preview.parsed.createdAt),
          )}
        </p>
        <p className="text-xs text-faint">{CONFIG_SYNC_TEXT.previewHint}</p>
        <div className="space-y-2">
          {preview.diff.map((d) => {
            const n = d.changed.length;
            const id = 'cfgSyncGroup-' + d.group;
            return (
              <div
                key={d.group}
                className={
                  'flex items-start gap-2 px-3 py-2 rounded-lg border line-color bg-[var(--c-surface-2)]' +
                  (n === 0 ? ' opacity-60' : '')
                }
              >
                <input
                  type="checkbox"
                  id={id}
                  className="mt-1"
                  checked={!!enabled[d.group]}
                  disabled={n === 0}
                  onChange={(e) => setEnabled({ ...enabled, [d.group]: e.target.checked })}
                />
                <label htmlFor={id} className="min-w-0 flex-1">
                  <span className="text-sm gray-label">
                    {CONFIG_SYNC_TEXT.groupLabel[d.group]}
                  </span>
                  <span className="text-xs text-muted">
                    {' · '}
                    {CONFIG_SYNC_TEXT.groupChanges(n)}
                  </span>
                  {n > 0 && (
                    <span className="block text-xs text-faint break-words">
                      {d.changed.map(configFieldLabel).join(', ')}
                    </span>
                  )}
                </label>
              </div>
            );
          })}
        </div>
        {themePresetChanged && (
          <p className="text-xs text-faint">{CONFIG_SYNC_TEXT.previewThemePresetNote}</p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <button className={btn + ' back-gray'} onClick={cancel}>
            {CONFIG_SYNC_TEXT.previewCancel}
          </button>
          <button
            className={btn + ' back-sky'}
            disabled={previewCount === 0 || applying}
            onClick={apply}
          >
            {CONFIG_SYNC_TEXT.previewApply}
            {previewCount > 0 ? ` (${previewCount})` : ''}
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
};

export const ConfigImportPreviewHost = observer(() => {
  const req = currentConfigPreviewRequest();
  if (!req) return null;
  return <ConfigImportPreviewModal key={req.id} req={req} />;
});
