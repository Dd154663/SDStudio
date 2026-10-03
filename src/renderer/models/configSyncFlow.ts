// 환경설정·토큰 불러오기 흐름 (드라이브 동기화 C안 ③ → 드라이브 API ③에서 컴포넌트 밖으로 이동, 2026-09-28)
//
// ConfigSyncSection(파일에서 불러오기)과 Google 드라이브 백업 관리 창(드라이브에서 받기)이 같은
// 흐름을 쓰도록 텍스트 단계부터를 여기 둔다. 순서·문구는 이동 전과 같다:
//   형식 검사 → (바뀌는 항목 없음이면 안내) → (화면에 저장 안 된 변경이 있으면) 확인 → 미리보기
//   (필드군별 켬/끔) → [적용] 시 덮어쓰기 확인 1회(거절하면 미리보기 유지) → 적용 → 재동기화 → 완료 안내.
// 적용 = backend.getConfig() 위에 applyConfigGroups → setConfig → sessionService.configChanged()
// → ctx.onConfigImported()(열린 설정 화면 로컬 상태 다시 읽기).
//
// 미리보기 창은 전역 호스트(ConfigSyncSection.tsx 의 ConfigImportPreviewHost, App 에 1개)가 띄운다
// — 드라이브 백업 관리 창 위에서도 보이게.

import { observable, runInAction } from 'mobx';
import { backend, loginService, sessionService } from '.';
import { appState } from './AppService';
import { confirmOverwrite, IMPORT_FLOW_TEXT, notifyImportDone } from './importFlow';
import {
  applyConfigGroups,
  ConfigGroupDiff,
  ConfigGroupKey,
  CONFIG_SYNC_TEXT,
  countConfigChanges,
  diffConfigGroups,
  ParsedConfigImport,
  parseConfigImport,
  parseTokenImport,
} from './configSync';

export interface ConfigImportContext {
  // 설정 화면에 저장 안 된 변경이 있는지(ConfigScreen dirty).
  dirty: boolean;
  // 적용 뒤 설정 화면 로컬 상태를 설정 파일에서 다시 읽는다.
  onConfigImported: () => Promise<void> | void;
}

export type ConfigGroupSelection = Partial<Record<ConfigGroupKey, boolean>>;

export interface ConfigImportPreview {
  parsed: ParsedConfigImport;
  diff: ConfigGroupDiff[];
  enabled: ConfigGroupSelection;
}

export interface ConfigPreviewRequest {
  // 창 구분(React key).
  id: number;
  preview: ConfigImportPreview;
  // [적용] — 덮어쓰기 확인. true 면 창을 닫고 적용, false 면 창을 그대로 둔다.
  confirm: (enabled: ConfigGroupSelection) => Promise<boolean>;
  // 창을 닫으며 결과를 돌려준다(null = 취소).
  resolve: (enabled: ConfigGroupSelection | null) => void;
}

let previewSeq = 0;
const previewBox = observable.box<ConfigPreviewRequest | null>(null, { deep: false });

// 호스트 컴포넌트가 읽는다(observer).
export function currentConfigPreviewRequest(): ConfigPreviewRequest | null {
  return previewBox.get();
}

function showConfigImportPreview(
  preview: ConfigImportPreview,
  confirm: ConfigPreviewRequest['confirm'],
): Promise<ConfigGroupSelection | null> {
  return new Promise((resolve) => {
    // 이전 요청이 남아 있으면 취소로 닫는다(동시에 두 개를 띄우지 않는다).
    previewBox.get()?.resolve(null);
    const req: ConfigPreviewRequest = {
      id: ++previewSeq,
      preview,
      confirm,
      resolve: (enabled) => {
        runInAction(() => {
          if (previewBox.get() === req) previewBox.set(null);
        });
        resolve(enabled);
      },
    };
    runInAction(() => previewBox.set(req));
  });
}

// ── 설정 불러오기 ──
export async function importConfigText(
  text: string,
  ctx: ConfigImportContext,
): Promise<void> {
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
  if (ctx.dirty) {
    const ok = await appState.confirmAsync(
      CONFIG_SYNC_TEXT.unsavedConfirm,
      CONFIG_SYNC_TEXT.unsavedConfirmButton,
      { danger: true },
    );
    if (!ok) return;
  }
  const enabled: ConfigGroupSelection = {};
  for (const d of diff) enabled[d.group] = d.changed.length > 0;

  const chosen = await showConfigImportPreview(
    { parsed: parsed.value, diff, enabled },
    async (sel) => {
      const count = countConfigChanges(diff, sel);
      if (count === 0) return false;
      return await confirmOverwrite({
        label: CONFIG_SYNC_TEXT.itemLabel,
        count,
        protection: IMPORT_FLOW_TEXT.protection.replaceValue,
      });
    },
  );
  if (!chosen) return;

  try {
    // 미리보기 이후 설정이 바뀌었을 수 있으므로 저장된 최신 값 위에 다시 계산한다.
    const latest = await backend.getConfig();
    const freshDiff = diffConfigGroups(latest, parsed.value.groups);
    const updated = countConfigChanges(freshDiff, chosen);
    const skipped = countConfigChanges(freshDiff) - updated;
    await backend.setConfig(applyConfigGroups(latest, parsed.value.groups, chosen));
    sessionService.configChanged();
    await ctx.onConfigImported();
    notifyImportDone(CONFIG_SYNC_TEXT.doneLabel, { added: 0, updated, skipped });
  } catch (e: any) {
    appState.pushMessage(CONFIG_SYNC_TEXT.applyFailed(e?.message || String(e)));
  }
}

// ── 토큰 불러오기(파일에서만 — 드라이브 출처 없음) ──
export async function importTokenText(text: string): Promise<void> {
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
}
