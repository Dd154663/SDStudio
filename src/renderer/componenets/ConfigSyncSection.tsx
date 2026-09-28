// 환경설정 내보내기·불러오기 구역 (드라이브 동기화 C안 ③, 2026-09-28)
//
// 환경설정 「시스템」 탭(PC·모바일 공통)에 들어간다. 형식·필터·문구는 models/configSync.ts,
// 목적지 선택은 driveSync(saveJsonFile 'config'/'token'), 확인·완료 문구는 importFlow 를 쓴다.
//
// 불러오기 순서(§0 일관화): 파일 고르기 → 형식 검사 → (화면에 저장 안 된 변경이 있으면)
// 확인 → 미리보기(필드군별 바뀌는 항목·켬/끔) → 덮어쓰기 확인 1회 → 적용 → 완료 안내.
// 적용은 backend.getConfig() 위에 applyConfigGroups → backend.setConfig →
// sessionService.configChanged()(App 미러·다른 컴포넌트 재조회) → onConfigImported()
// (설정 화면 로컬 상태 다시 읽기 — 열린 화면에서 「저장」해도 되돌아가지 않게).
//
// 토큰: 기본 꺼짐. 켤 때 경고 확인, 설정 파일과 별도 파일. 받기는 LoginService 관문으로
// 추가만. 토큰 값은 화면·로그·토스트에 쓰지 않는다.

import React, { useRef, useState } from 'react';
import { backend, isMobile, loginService, sessionService } from '../models';
import { appState } from '../models/AppService';
import { saveJsonFile } from '../models/exportUtil';
import { getSyncFolder, syncFileName } from '../models/driveSync';
import { stringifyExportJson } from '../models/jsonExport';
import {
  confirmOverwrite,
  IMPORT_FLOW_TEXT,
  notifyImportDone,
} from '../models/importFlow';
import {
  applyConfigGroups,
  buildConfigExport,
  buildTokenExport,
  configFieldLabel,
  CONFIG_SYNC_TEXT,
  ConfigGroupDiff,
  ConfigGroupKey,
  countConfigChanges,
  decodeBase64Utf8,
  diffConfigGroups,
  ParsedConfigImport,
  parseConfigImport,
  parseTokenImport,
} from '../models/configSync';
import ModalOverlay from './ModalOverlay';

interface Props {
  // 설정 화면에 저장 안 된 변경이 있는지(ConfigScreen dirty).
  dirty: boolean;
  // 불러오기 적용 뒤 설정 화면 로컬 상태를 설정 파일에서 다시 읽는다.
  onConfigImported: () => Promise<void> | void;
}

interface PreviewState {
  parsed: ParsedConfigImport;
  diff: ConfigGroupDiff[];
  enabled: Partial<Record<ConfigGroupKey, boolean>>;
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
  const [preview, setPreview] = useState<PreviewState | null>(null);
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

  // ── 설정 불러오기 ──
  const handleConfigText = async (text: string) => {
    const parsed = parseConfigImport(text);
    if (!parsed.ok) {
      appState.pushDialog({
        type: 'yes-only',
        text:
          parsed.error === 'newer-version'
            ? CONFIG_SYNC_TEXT.newerVersion
            : CONFIG_SYNC_TEXT.notConfigFile,
      });
      return;
    }
    const current = await backend.getConfig();
    const diff = diffConfigGroups(current, parsed.value.groups);
    if (countConfigChanges(diff) === 0) {
      appState.pushDialog({ type: 'yes-only', text: CONFIG_SYNC_TEXT.noChanges });
      return;
    }
    if (dirty) {
      const ok = await askConfirm(
        CONFIG_SYNC_TEXT.unsavedConfirm,
        CONFIG_SYNC_TEXT.unsavedConfirmButton,
      );
      if (!ok) return;
    }
    const enabled: PreviewState['enabled'] = {};
    for (const d of diff) enabled[d.group] = d.changed.length > 0;
    setPreview({ parsed: parsed.value, diff, enabled });
  };

  const startConfigImport = async () => {
    if (busy) return;
    if (isMobile) {
      configInputRef.current?.click();
      return;
    }
    setBusy(true);
    try {
      const text = await pickJsonTextPc();
      if (text === undefined) return;
      await handleConfigText(text);
    } catch (e: any) {
      appState.pushMessage(CONFIG_SYNC_TEXT.readFailed);
    } finally {
      setBusy(false);
    }
  };

  const applyPreview = async () => {
    if (!preview) return;
    const count = countConfigChanges(preview.diff, preview.enabled);
    if (count === 0) return;
    const ok = await confirmOverwrite({
      label: CONFIG_SYNC_TEXT.itemLabel,
      count,
      protection: IMPORT_FLOW_TEXT.protection.replaceValue,
    });
    if (!ok) return;
    const { parsed, enabled } = preview;
    setPreview(null);
    setBusy(true);
    try {
      // 미리보기 이후 설정이 바뀌었을 수 있으므로 저장된 최신 값 위에 다시 계산한다.
      const current = await backend.getConfig();
      const freshDiff = diffConfigGroups(current, parsed.groups);
      const updated = countConfigChanges(freshDiff, enabled);
      const skipped = countConfigChanges(freshDiff) - updated;
      await backend.setConfig(applyConfigGroups(current, parsed.groups, enabled));
      sessionService.configChanged();
      await onConfigImported();
      notifyImportDone(CONFIG_SYNC_TEXT.doneLabel, { added: 0, updated, skipped });
    } catch (e: any) {
      appState.pushMessage(CONFIG_SYNC_TEXT.applyFailed(e?.message || String(e)));
    } finally {
      setBusy(false);
    }
  };

  // ── 토큰 불러오기 ──
  const handleTokenText = async (text: string) => {
    const parsed = parseTokenImport(text);
    if (!parsed.ok) {
      appState.pushDialog({
        type: 'yes-only',
        text:
          parsed.error === 'newer-version'
            ? CONFIG_SYNC_TEXT.newerVersion
            : CONFIG_SYNC_TEXT.notTokenFile,
      });
      return;
    }
    try {
      const res = await loginService.importTokenProfiles(parsed.profiles);
      notifyImportDone(CONFIG_SYNC_TEXT.tokenDoneLabel, {
        added: res.added,
        updated: 0,
        skipped: res.skipped + parsed.invalid,
      });
    } catch (e: any) {
      appState.pushMessage(CONFIG_SYNC_TEXT.tokenImportFailed(e?.message || String(e)));
    }
  };

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

  const previewCount = preview
    ? countConfigChanges(preview.diff, preview.enabled)
    : 0;
  const themePresetChanged = !!preview?.diff.some((d) =>
    d.changed.includes('uiThemePresets'),
  );

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
      {preview && (
        <ModalOverlay
          isOpen={true}
          onClose={() => setPreview(null)}
          title={CONFIG_SYNC_TEXT.previewTitle}
          width="max-w-md"
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
                      checked={!!preview.enabled[d.group]}
                      disabled={n === 0}
                      onChange={(e) =>
                        setPreview({
                          ...preview,
                          enabled: { ...preview.enabled, [d.group]: e.target.checked },
                        })
                      }
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
              <button className={btn + ' back-gray'} onClick={() => setPreview(null)}>
                {CONFIG_SYNC_TEXT.previewCancel}
              </button>
              <button
                className={btn + ' back-sky'}
                disabled={previewCount === 0}
                onClick={applyPreview}
              >
                {CONFIG_SYNC_TEXT.previewApply}
                {previewCount > 0 ? ` (${previewCount})` : ''}
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
};

export default ConfigSyncSection;
