// Google 드라이브에서 받은 백업을 기존 불러오기 흐름으로 넘기는 층 (드라이브 API ③, 2026-09-28, PC ·
// ④ 2026-10-01 Android — 받은 경로가 file:// URI 일 뿐 흐름은 같다)
//
// 불러오기 순서(SPEC §12-3 §0 일관화)는 그대로다. 드라이브는 「파일 고르기」 단계만 바꾼다:
//   출처 선택 [Google 드라이브 / 파일](driveSync.chooseImportSource) → 드라이브면 백업 관리 창
//   (고르기 모드, 종류 고정) → 받기(진행 창·취소) → 대상별 기존 흐름(정책 3선택지·확인 1회·
//   「추가 N · 갱신 N · 건너뜀 N」) → 받은 임시 파일 정리(성공·실패·취소 모두).
//
// 라우팅(resolveDriveRoute — 순수, jest):
//   project            → BackupService.handleTarImport(경로)   (정책·덮어쓰기 절차 = projectOverwrite)
//   global-presets·artist-library·project-templates → 각 *BackupImport({ pickedPath })
//   character-presets  → 텍스트 → importGlobalCharacterPresetsText(글로벌만)
//   scene-template     → 텍스트 → TemplateService.importSceneTemplateFile
//   config             → 텍스트 → configSyncFlow.importConfigText(미리보기·확인·재동기화)
//   token·토큰 파일명  → 불러오기 거부, 다운로드 폴더 저장만(드라이브에 있어선 안 되는 파일)
//   unknown(표식 없음) → 다운로드 폴더 저장만
//
// 백업 관리 창(componenets/DriveBackupManager.tsx)은 전역 호스트 1개가 이 파일의 요청 상태를 그린다.

import { observable, runInAction } from 'mobx';
import { backend, backupService, templateService } from '.';
import { appState } from './AppService';
import { platform } from './platform';
import {
  chooseImportSource,
  DRIVE_EXPORT_KIND_LABEL,
  DriveExportKind,
  isGoogleDriveConnectedHint,
  uploadPercent,
} from './driveSync';
import { formatBytes, GOOGLE_DRIVE_TEXT } from './googleDrive';
import { decodeBase64Utf8 } from './configSync';
import { importGlobalCharacterPresetsText } from './characterPresetImport';
import { ConfigImportContext, importConfigText } from './configSyncFlow';
import {
  DriveBackupItem,
  driveDownloadErrorText,
  isTokenExport,
} from '../../shared/googleDrive';

export interface DriveImportContext {
  // 환경설정 불러오기용(설정 화면의 저장 안 된 변경·적용 뒤 재동기화). 없으면 dirty=false·재동기화 없음.
  config?: ConfigImportContext;
}

export type DriveRoute =
  | { type: 'project' }
  | { type: 'library'; kind: 'global-presets' | 'artist-library' | 'project-templates' }
  | { type: 'character-presets' }
  | { type: 'scene-template' }
  | { type: 'config' }
  | { type: 'downloads-only'; reason: 'token' | 'unknown' };

// 받은 파일을 어디로 넘길지(순수). 토큰은 kind 또는 파일 이름(sdstudio-token-…) 어느 쪽이든 거부.
export function resolveDriveRoute(item: Pick<DriveBackupItem, 'kind' | 'name'>): DriveRoute {
  if (isTokenExport(item.kind, item.name)) return { type: 'downloads-only', reason: 'token' };
  switch (item.kind) {
    case 'project':
      return { type: 'project' };
    case 'global-presets':
    case 'artist-library':
    case 'project-templates':
      return { type: 'library', kind: item.kind };
    case 'character-presets':
      return { type: 'character-presets' };
    case 'scene-template':
      return { type: 'scene-template' };
    case 'config':
      return { type: 'config' };
    default:
      return { type: 'downloads-only', reason: 'unknown' };
  }
}

export function driveBackupKindLabel(kind: DriveBackupItem['kind']): string {
  return kind === 'unknown' ? GOOGLE_DRIVE_TEXT.unknownKind : DRIVE_EXPORT_KIND_LABEL[kind];
}

// ─── 백업 관리 창 요청 상태(전역 호스트가 그린다) ───

export interface DriveManagerRequest {
  id: number;
  // manage = 설정 화면 [백업 관리](받기·삭제), pick = 불러오기 출처로 드라이브를 골랐을 때(선택).
  mode: 'manage' | 'pick';
  // pick 모드의 고정 종류 필터.
  kind?: DriveExportKind;
  ctx: DriveImportContext;
  // pick 모드 결과(선택한 항목 또는 null=닫음).
  resolve?: (item: DriveBackupItem | null) => void;
}

let managerSeq = 0;
const managerBox = observable.box<DriveManagerRequest | null>(null, { deep: false });

export function currentDriveManagerRequest(): DriveManagerRequest | null {
  return managerBox.get();
}

function setManagerRequest(req: DriveManagerRequest | null) {
  const prev = managerBox.get();
  runInAction(() => managerBox.set(req));
  // 이전 고르기 요청이 남아 있으면 「고르지 않음」으로 끝낸다.
  if (prev && prev !== req) prev.resolve?.(null);
}

export function openDriveBackupManager(ctx: DriveImportContext = {}): void {
  setManagerRequest({ id: ++managerSeq, mode: 'manage', ctx });
}

export function pickDriveBackup(
  kind: DriveExportKind,
  ctx: DriveImportContext = {},
): Promise<DriveBackupItem | null> {
  return new Promise((resolve) => {
    setManagerRequest({ id: ++managerSeq, mode: 'pick', kind, ctx, resolve });
  });
}

// 창을 닫는다. pick 모드면 item(없으면 null)으로 결과를 돌려준다.
export function closeDriveBackupManager(item: DriveBackupItem | null = null): void {
  const req = managerBox.get();
  if (!req) return;
  runInAction(() => managerBox.set(null));
  req.resolve?.(item);
}

// ─── 받기(진행 창·취소) ───

let receiving = false;

export function isDriveReceiving(): boolean {
  return receiving;
}

function failureReason(e: any): string {
  if (e?.code) return driveDownloadErrorText(e.code) + (e.detail ? ` (${e.detail})` : '');
  return e?.message || String(e);
}

// 파일을 받아 절대 경로를 돌려준다. 취소·실패는 안내 뒤 null.
async function downloadWithProgress(
  item: DriveBackupItem,
  toDownloads: boolean,
): Promise<string | null> {
  let cancelRequested = false;
  let last = { received: 0, total: typeof item.size === 'number' ? item.size : 0 };
  const countText = () =>
    last.total > 0
      ? `${uploadPercent(last.received, last.total)}% · ${formatBytes(last.received)} / ${formatBytes(last.total)}`
      : formatBytes(last.received);
  const percent = () => (last.total > 0 ? uploadPercent(last.received, last.total) : 0);
  const onCancel = () => {
    if (cancelRequested) return;
    cancelRequested = true;
    appState.setProgressDialog({
      text: GOOGLE_DRIVE_TEXT.downloadCancelling,
      done: percent(),
      total: 100,
      countText: countText(),
    });
    backend.driveDownloadCancel().catch(() => {});
  };
  const show = () => {
    if (cancelRequested) return;
    appState.setProgressDialog({
      text: GOOGLE_DRIVE_TEXT.downloading(item.name),
      done: percent(),
      total: 100,
      countText: countText(),
      onCancel,
    });
  };
  show();
  try {
    const path = await backend.driveDownload(item, { toDownloads }, (p) => {
      last = { received: p.received, total: p.total || last.total };
      show();
    });
    appState.setProgressDialog(undefined);
    return path;
  } catch (e: any) {
    appState.setProgressDialog(undefined);
    if (cancelRequested || e?.code === 'cancelled') {
      appState.pushMessage(GOOGLE_DRIVE_TEXT.downloadCancelled);
    } else {
      appState.pushDialog({
        type: 'yes-only',
        text: GOOGLE_DRIVE_TEXT.downloadFailed(failureReason(e)),
      });
    }
    return null;
  }
}

function askConfirm(text: string, confirmText: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    appState.pushDialog({
      type: 'confirm',
      green: true,
      text,
      confirmText,
      callback: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}

// 토큰·알 수 없는 파일: 불러오지 않고, 확인 뒤 다운로드 폴더에 파일로만 저장.
async function saveDriveBackupToDownloads(
  item: DriveBackupItem,
  reason: 'token' | 'unknown',
): Promise<void> {
  const ok = await askConfirm(
    reason === 'token' ? GOOGLE_DRIVE_TEXT.tokenDownloadOnly : GOOGLE_DRIVE_TEXT.unknownDownloadOnly,
    GOOGLE_DRIVE_TEXT.saveToDownloads,
  );
  if (!ok) return;
  const path = await downloadWithProgress(item, true);
  if (path) appState.pushMessage(GOOGLE_DRIVE_TEXT.savedToDownloads(path));
}

// 받은 로컬 파일(절대 경로)의 UTF-8 텍스트(BOM 제거) — ConfigSyncSection pickJsonTextPc 관례.
async function readLocalText(localPath: string): Promise<string> {
  return decodeBase64Utf8(await backend.readBinaryFile(localPath)).replace(/^\uFEFF/, '');
}

const NO_CONFIG_CONTEXT: ConfigImportContext = { dirty: false, onConfigImported: () => {} };

// 받은 파일을 대상별 기존 흐름으로 넘긴다(각 흐름이 정책·확인·완료 안내를 한다).
export async function routeDriveBackup(
  route: Exclude<DriveRoute, { type: 'downloads-only' }>,
  localPath: string,
  ctx: DriveImportContext = {},
): Promise<void> {
  switch (route.type) {
    case 'project':
      await backupService.handleTarImport(localPath);
      return;
    case 'library':
      if (route.kind === 'global-presets') {
        await backupService.globalPresetBackupImport({ pickedPath: localPath });
      } else if (route.kind === 'artist-library') {
        await backupService.artistLibraryBackupImport({ pickedPath: localPath });
      } else {
        await backupService.projectTemplateBackupImport({ pickedPath: localPath });
      }
      return;
    case 'character-presets':
      await importGlobalCharacterPresetsText(await readLocalText(localPath));
      return;
    case 'scene-template':
      await templateService.importSceneTemplateFile(await readLocalText(localPath));
      return;
    case 'config':
      await importConfigText(await readLocalText(localPath), ctx.config ?? NO_CONFIG_CONTEXT);
      return;
  }
}

// 드라이브 백업 하나를 받아 불러온다(관리 창 [받기]·고르기 모드 공용).
export async function receiveDriveBackup(
  item: DriveBackupItem,
  ctx: DriveImportContext = {},
): Promise<void> {
  if (receiving) {
    appState.pushMessage(driveDownloadErrorText('busy'));
    return;
  }
  receiving = true;
  try {
    const route = resolveDriveRoute(item);
    if (route.type === 'downloads-only') {
      await saveDriveBackupToDownloads(item, route.reason);
      return;
    }
    try {
      const localPath = await downloadWithProgress(item, false);
      if (!localPath) return;
      await routeDriveBackup(route, localPath, ctx);
    } catch (e: any) {
      appState.setProgressDialog(undefined);
      appState.pushMessage(GOOGLE_DRIVE_TEXT.importFailed(e?.message || String(e)));
    } finally {
      // 성공·실패·취소 모두 받은 임시 폴더를 지운다(받기 실패·취소는 main 이 이미 지웠어도 무해, 실패는 무시).
      await backend.driveCleanupDownload(item.id).catch(() => {});
    }
  } finally {
    receiving = false;
  }
}

// 출처 선택에서 「Google 드라이브」를 골랐을 때: 관리 창(고르기, 종류 고정) → 받기 → 불러오기.
export async function importFromDrive(
  kind: DriveExportKind,
  ctx: DriveImportContext = {},
): Promise<void> {
  const item = await pickDriveBackup(kind, ctx);
  if (!item) return;
  await receiveDriveBackup(item, ctx);
}

// ─── Android: <input type=file> 진입점의 출처 선택 (드라이브 API ④) ───
// Android WebView 는 비동기 대화상자(출처 선택) 뒤의 input.click() 을 사용자 제스처로 보지 않아
// 선택기가 열리지 않을 수 있다. 그래서 연결돼 있을 때만 가로채 출처를 묻고, 「파일」은 문서 선택기
// (backend.selectFile — 네이티브라 제스처 제한 없음)로 고른 뒤 readBinaryFile 로 읽어 기존 텍스트
// 함수에 넘긴다. 미연결(또는 아직 모름)이면 가로채지 않고 기존 <input type=file> 그대로다.
export type TextImportKind = 'character-presets' | 'scene-template' | 'config';

// 문서 선택기에서 JSON 하나를 골라 UTF-8 텍스트(BOM 제거)로. 고르지 않으면 undefined.
export async function pickJsonFileText(): Promise<string | undefined> {
  let path: string | undefined;
  try {
    path = await backend.selectFile({ filters: [{ name: 'JSON', extensions: ['json'] }] });
  } catch (e: any) {
    // 문서 선택기에서 뒤로 가기 = 「pickFiles canceled.」 — 고르지 않은 것으로 본다.
    if (/cancel/i.test(String(e?.message ?? e))) return undefined;
    throw e;
  }
  if (!path) return undefined;
  return await readLocalText(path);
}

// 텍스트 대상별 기존 불러오기 흐름(<input type=file> onChange·드라이브 라우팅과 같은 함수).
export async function importTextByKind(
  kind: TextImportKind,
  text: string,
  ctx: DriveImportContext = {},
): Promise<void> {
  if (kind === 'character-presets') await importGlobalCharacterPresetsText(text);
  else if (kind === 'scene-template') await templateService.importSceneTemplateFile(text);
  else await importConfigText(text, ctx.config ?? NO_CONFIG_CONTEXT);
}

// Android 연결 시: 출처 선택 → 드라이브(고르기 창·받기) 또는 파일(문서 선택기) → 기존 흐름.
export async function importTextWithSource(
  kind: TextImportKind,
  ctx: DriveImportContext = {},
): Promise<void> {
  const source = await chooseImportSource(kind);
  if (source === 'drive') {
    await importFromDrive(kind, ctx);
    return;
  }
  if (source !== 'file') return;
  let text: string | undefined;
  try {
    text = await pickJsonFileText();
  } catch (e) {
    appState.pushMessage(GOOGLE_DRIVE_TEXT.fileReadFailed);
    return;
  }
  if (text === undefined) return;
  await importTextByKind(kind, text, ctx);
}

// <label><input type=file/></label> 형 [불러오기] 버튼용(캐릭터 프리셋·씬 템플릿).
// PC: 기본 동작(파일 선택기)을 막고 출처를 묻는다 — 「파일」이면 숨은 input 을 눌러 기존
// 선택기를 연다(Electron 은 대화상자 클릭이 사용자 활성화라 선택기가 열린다).
// Android(④): 연결돼 있을 때만 막고 importTextWithSource(「파일」= 문서 선택기). 미연결은 기존 그대로.
export function interceptFileImportClick(
  e: { target: EventTarget | null; preventDefault(): void },
  input: HTMLInputElement | null,
  kind: TextImportKind,
): void {
  if (!platform.supportsTargetFolder) {
    if (!isGoogleDriveConnectedHint()) return;
    if (input && e.target === input) return;
    e.preventDefault();
    void importTextWithSource(kind);
    return;
  }
  // 아래 input.click() 이 label 로 전파된 클릭은 그대로 통과(선택기 열기).
  if (!input || e.target === input) return;
  e.preventDefault();
  void (async () => {
    const source = await chooseImportSource(kind);
    if (source === 'file') input.click();
    else if (source === 'drive') await importFromDrive(kind);
  })();
}
