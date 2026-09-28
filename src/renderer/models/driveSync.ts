// 드라이브 동기화 공용층 (드라이브 동기화 C안 ①, 2026-09-28)
//
// 올리기 = 기존 내보내기 흐름의 "끝"에서 목적지를 고르는 방식이다. 새 버튼을 늘리지
// 않고, 대상(글로벌 프리셋·작가 라이브러리·캐릭터 프리셋·씬 템플릿·프로젝트 백업)이
// 모두 여기의 deliverExport 하나를 호출해 같은 문구·같은 순서의 선택지를 만난다.
//
// - PC: 환경설정 「드라이브 동기화 폴더」(config.syncFolder)가 있으면
//   [드라이브 폴더 / 다운로드 폴더] 선택. 드라이브는 기존 transferExportArchive
//   (copyFileToAbsolute + exports/ 원본 정리)를 재사용하고, 같은 이름이 있으면
//   " (n)" 접미로 피한다(기존 파일을 덮지 않는다).
// - PC(폴더 미설정)·Android: 기존 publishExport 그대로. Android 는 publishExport 의
//   「공유」가 Google Drive 로 올리는 경로다(변경 없음).
//
// 순수 함수(syncFileName·withCollisionSuffix·resolveExportDestinations·joinAbsolute)는
// jest 로 검증한다(__tests__/driveSync.test.ts).
//
// Google 드라이브 연동 ②(2026-09-28, PC): 드라이브에 연결돼 있으면 목적지는
// [Google 드라이브 / 다운로드 폴더]이고(동기화 폴더는 이때 제안하지 않음 — 과도기 1단계),
// 'drive' 선택 시 main 이 드라이브 SDStudio 폴더에 올린다(backend.driveUpload). 실패는 다운로드
// 폴더로 전환, 취소는 스테이징 삭제. NovelAI 토큰 파일('token')은 연결·동기화 폴더와 관계없이
// 다운로드 폴더에만 저장한다(main 올리기도 한 번 더 거부 — 2중 방벽).

import { backend } from '.';
import { appState } from './AppService';
import { platform } from './platform';
import { transferExportArchive } from './exportArchiveTransfer';
import { sanitizeFilenamePart } from './exportPresetUtils';
import { formatBytes } from './googleDrive';
import {
  DriveFileMeta,
  driveUploadErrorText,
  isDriveWebUrl,
} from '../../shared/googleDrive';

// 대상 종류 = 파일명 규칙 sdstudio-<kind>-<날짜> 의 kind. 기존 라이브러리 백업 파일명
// (sdstudio-global-presets-…, sdstudio-artist-library-…)과 같은 값을 쓴다.
export type DriveExportKind =
  | 'global-presets'
  | 'artist-library'
  | 'character-presets'
  | 'scene-template'
  | 'project'
  | 'config'
  | 'token'
  | 'project-templates';

export type ExportDestination = 'drive' | 'downloads';

export const DRIVE_EXPORT_KIND_LABEL: Record<DriveExportKind, string> = {
  'global-presets': '글로벌 프리셋 백업',
  'artist-library': '작가 라이브러리 백업',
  'character-presets': '캐릭터 프리셋',
  'scene-template': '씬 템플릿',
  project: '프로젝트 백업',
  config: '환경설정',
  token: 'NovelAI 토큰',
  'project-templates': '프로젝트 템플릿 백업',
};

// 사용자에게 보이는 문구는 전부 여기 한 곳에 둔다(대상별로 달라지지 않게).
export const DRIVE_SYNC_TEXT = {
  settingLabel: '드라이브 동기화 폴더',
  settingDescription:
    'Google Drive 등 데스크톱 동기화 앱이 올리는 로컬 폴더를 지정하면 내보내기 끝에서 이 폴더를 고를 수 있습니다.',
  settingUnset: '미설정 (내보내기는 다운로드 폴더로 저장)',
  settingSelect: '드라이브 동기화 폴더 지정',
  settingClear: '지우기',
  settingNotWritable: (code?: string) =>
    `이 폴더에는 쓰기 권한이 없어 드라이브 동기화 폴더로 사용할 수 없습니다.${code ? `\n(${code})` : ''}\n\n다른 위치를 선택하거나 폴더 권한을 확인해 주세요.`,
  chooseDestination: (kind: DriveExportKind) =>
    `${DRIVE_EXPORT_KIND_LABEL[kind]} 파일을 어디에 저장할까요?`,
  destination: {
    drive: '드라이브 폴더',
    downloads: '다운로드 폴더',
  } as Record<ExportDestination, string>,
  // Google 드라이브 연결 시 'drive' 선택지 라벨(드라이브 API ②).
  googleDriveDestination: 'Google 드라이브',
  tokenDownloadsOnly: 'NovelAI 토큰 파일은 다운로드 폴더에만 저장합니다.',
  googleDriveUploading: (fileName: string) =>
    `Google 드라이브에 올리는 중입니다… (${fileName})`,
  googleDriveCancelling: 'Google 드라이브 올리기를 취소하는 중입니다…',
  googleDriveProgress: (percent: number, sent: string, total: string) =>
    total ? `${percent}% · ${sent} / ${total}` : `${percent}%`,
  googleDriveSaved: (fileName: string) =>
    `Google 드라이브의 SDStudio 폴더에 저장했습니다: ${fileName}`,
  googleDriveOpen: '드라이브에서 열기',
  googleDriveClose: '닫기',
  googleDriveCleanupFailed:
    'Google 드라이브 저장은 완료했지만 앱 내부의 임시 사본을 정리하지 못했습니다.',
  googleDriveFailed: (reason: string) =>
    `Google 드라이브에 올리지 못해 다운로드 폴더로 저장합니다: ${reason}`,
  driveSaved: (fileName: string) => `드라이브 폴더에 저장했습니다: ${fileName}`,
  driveCleanupFailed:
    '드라이브 폴더 저장은 완료했지만 앱 내부의 임시 사본을 정리하지 못했습니다.',
  driveCopyFailed: (reason: string) =>
    `드라이브 폴더로 복사하지 못해 다운로드 폴더로 저장합니다: ${reason}`,
  cancelled: '내보내기를 취소했습니다.',
};

// 기존 백업 파일명 날짜 규칙(UTC ISO, ':'·'.' → '-', 초까지)과 동일.
export function exportDateStamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

// sdstudio-<kind>-<YYYY-MM-DDTHH-mm-ss>.<ext>
export function syncFileName(
  kind: DriveExportKind,
  date: Date,
  ext: string,
): string {
  const cleanExt = ext.replace(/^\.+/, '');
  return `sdstudio-${kind}-${exportDateStamp(date)}${cleanExt ? '.' + cleanExt : ''}`;
}

// 대상 이름을 넣은 변형(드라이브 동기화 ⑤ 프로젝트 백업):
// sdstudio-<kind>-<안전한 이름>[-<tag>]-<YYYY-MM-DDTHH-mm-ss>.<ext>
// 이름의 파일 시스템 위험 문자·공백은 기존 sanitizeFilenamePart 규칙으로 '_' 치환,
// 정제 결과가 비면 이름 자리를 생략한다(=syncFileName 과 같은 모양).
export function namedSyncFileName(
  kind: DriveExportKind,
  name: string,
  date: Date,
  ext: string,
  tag?: string,
): string {
  const safe = sanitizeFilenamePart(name);
  const cleanExt = ext.replace(/^\.+/, '');
  const parts = ['sdstudio', kind];
  if (safe) parts.push(safe);
  if (tag) parts.push(tag);
  parts.push(exportDateStamp(date));
  return parts.join('-') + (cleanExt ? '.' + cleanExt : '');
}

// "a.tar" → exists 면 "a (1).tar", "a (2).tar" … (publish-export 의 다운로드 폴더
// 충돌 규칙과 같은 모양). 확장자 없는 이름은 끝에 접미한다.
export function collisionName(name: string, n: number): string {
  if (n <= 0) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  return `${stem} (${n})${ext}`;
}

export async function withCollisionSuffix(
  name: string,
  exists: (candidate: string) => boolean | Promise<boolean>,
  maxTries = 9999,
): Promise<string> {
  for (let n = 0; n <= maxTries; n++) {
    const candidate = collisionName(name, n);
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error('같은 이름의 파일이 너무 많아 저장할 이름을 정하지 못했습니다.');
}

// 절대 폴더 + 파일명. 끝 구분자를 정리하고 '/' 로 잇는다(기존 목표 폴더 내보내기
// `${targetFolder}/${name}` 와 같은 결합 — Node 가 Windows 에서도 해석한다).
export function joinAbsolute(folder: string, fileName: string): string {
  return folder.replace(/[\\/]+$/, '') + '/' + fileName;
}

export function normalizeSyncFolder(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

// 이 기기에서 고를 수 있는 목적지 목록(표시 순서 = 배열 순서).
// - NovelAI 토큰('token')은 항상 다운로드 폴더만(드라이브 API ② — 드라이브·동기화 폴더 모두 제외).
// - PC(임의 절대 경로 쓰기가 되는 플랫폼)에서 Google 드라이브에 연결돼 있으면 'drive' =
//   Google 드라이브. 동기화 폴더가 있어도 이때는 제안하지 않는다(과도기 1단계).
// - 미연결이면 기존 규칙: 동기화 폴더가 지정된 경우만 'drive' = 드라이브 폴더.
export function resolveExportDestinations(opts: {
  syncFolder?: string;
  supportsTargetFolder: boolean;
  driveConnected?: boolean;
  kind?: DriveExportKind;
}): ExportDestination[] {
  if (opts.kind === 'token') return ['downloads'];
  if (opts.supportsTargetFolder && opts.driveConnected) return ['drive', 'downloads'];
  if (opts.supportsTargetFolder && normalizeSyncFolder(opts.syncFolder)) {
    return ['drive', 'downloads'];
  }
  return ['downloads'];
}

// 현재 설정의 드라이브 동기화 폴더(PC 전용). 모바일·미설정·읽기 실패는 undefined.
export async function getSyncFolder(): Promise<string | undefined> {
  if (!platform.supportsTargetFolder) return undefined;
  try {
    const config = await backend.getConfig();
    return normalizeSyncFolder(config.syncFolder);
  } catch (e) {
    return undefined;
  }
}

// PC 에서 Google 드라이브에 연결돼 있는지(네트워크 조회 없음). 미지원·오류는 false.
export async function isGoogleDriveConnected(): Promise<boolean> {
  if (!platform.supportsTargetFolder) return false;
  try {
    return backend.driveAuthSupported() && (await backend.driveAuthConnected());
  } catch (e) {
    return false;
  }
}

export interface ExportTarget {
  destinations: ExportDestination[];
  syncFolder?: string;
  // true 면 'drive' = Google 드라이브(아니면 동기화 폴더).
  driveConnected: boolean;
  // 토큰이라 드라이브·동기화 폴더 선택지를 뺐을 때 true(안내 문구용).
  tokenRestricted: boolean;
}

export async function resolveExportTarget(kind: DriveExportKind): Promise<ExportTarget> {
  const [syncFolder, driveConnected] = await Promise.all([
    getSyncFolder(),
    isGoogleDriveConnected(),
  ]);
  const base = {
    syncFolder,
    supportsTargetFolder: platform.supportsTargetFolder,
    driveConnected,
  };
  const destinations = resolveExportDestinations({ ...base, kind });
  const tokenRestricted =
    kind === 'token' && resolveExportDestinations(base).length > 1;
  return { destinations, syncFolder, driveConnected, tokenRestricted };
}

export function pushTokenDownloadsOnlyNotice(): void {
  appState.pushMessage(DRIVE_SYNC_TEXT.tokenDownloadsOnly);
}

export type DeliverResult = 'drive' | 'downloads' | 'cancelled';

// 내보내기 끝 공용 처리. exportsPath 는 앱 내부 exports/ 의 완성 산출물.
// doneText 는 기존 흐름이 띄우던 완료 문구(있으면 선택 대화상자 머리에 붙이고,
// 선택지가 하나뿐이면 기존처럼 확인 창으로 띄운 뒤 publishExport).
export async function deliverExport(
  exportsPath: string,
  kind: DriveExportKind,
  opts: { doneText?: string } = {},
): Promise<DeliverResult> {
  const target = await resolveExportTarget(kind);
  const { destinations, syncFolder, driveConnected } = target;

  if (destinations.length === 1 || (!syncFolder && !driveConnected)) {
    // 기존 동작 그대로(PC 폴더 미설정·미연결·Android·토큰).
    if (target.tokenRestricted) pushTokenDownloadsOnlyNotice();
    if (opts.doneText) appState.pushDialog({ type: 'yes-only', text: opts.doneText });
    await backend.publishExport(exportsPath);
    return 'downloads';
  }

  const choice = await appState.pushDialogAsync({
    type: 'select',
    text:
      (opts.doneText ? opts.doneText + '\n' : '') +
      DRIVE_SYNC_TEXT.chooseDestination(kind),
    items: destinations.map((d) => ({
      text:
        d === 'drive' && driveConnected
          ? DRIVE_SYNC_TEXT.googleDriveDestination
          : DRIVE_SYNC_TEXT.destination[d],
      value: d,
    })),
  });

  if (choice !== 'drive' && choice !== 'downloads') {
    // 취소 — 스테이징 사본을 남기지 않는다(원본 데이터와 무관한 내보내기 사본).
    try {
      await backend.deleteFile(exportsPath);
    } catch (e) {}
    appState.pushMessage(DRIVE_SYNC_TEXT.cancelled);
    return 'cancelled';
  }

  if (choice === 'downloads') {
    await backend.publishExport(exportsPath);
    return 'downloads';
  }

  if (driveConnected) return await uploadToGoogleDrive(exportsPath, kind);
  if (!syncFolder) {
    await backend.publishExport(exportsPath);
    return 'downloads';
  }

  const baseName = exportsPath.replace(/\\/g, '/').split('/').pop()!;
  let finalName: string;
  try {
    finalName = await withCollisionSuffix(baseName, (candidate) =>
      backend.existFileAbsolute(joinAbsolute(syncFolder, candidate)),
    );
    const { cleanupFailed } = await transferExportArchive(
      backend,
      exportsPath,
      joinAbsolute(syncFolder, finalName),
    );
    if (cleanupFailed) appState.pushMessage(DRIVE_SYNC_TEXT.driveCleanupFailed);
  } catch (e: any) {
    // 복사 실패만 다운로드 폴더로 전환한다(정리·폴더 열기 실패로 재내보내기하지 않음 —
    // 「동일 파일 내보내기 보존」 계약).
    appState.pushMessage(DRIVE_SYNC_TEXT.driveCopyFailed(e?.message || String(e)));
    await backend.publishExport(exportsPath);
    return 'downloads';
  }
  appState.pushMessage(DRIVE_SYNC_TEXT.driveSaved(finalName));
  try {
    await backend.openPath(syncFolder);
  } catch (e) {}
  return 'drive';
}

function exportBaseName(exportsPath: string): string {
  return exportsPath.replace(/\\/g, '/').split('/').pop() || exportsPath;
}

export function uploadPercent(sent: number, total: number): number {
  if (!(total > 0)) return 0;
  return Math.max(0, Math.min(100, Math.floor((sent / total) * 100)));
}

// Google 드라이브 올리기(드라이브 API ②). 진행 표시는 기존 전체 화면 진행 창(progressDialog)을
// 재사용하고 [취소]로 main 의 올리기를 중단한다. 성공 뒤에만 exports/ 사본을 지운다(정리 실패는
// 안내만 — 다시 내보내지 않음). 실패는 다운로드 폴더로 전환, 취소는 스테이징 삭제.
async function uploadToGoogleDrive(
  exportsPath: string,
  kind: DriveExportKind,
): Promise<DeliverResult> {
  const name = exportBaseName(exportsPath);
  let cancelRequested = false;
  let last = { sent: 0, total: 0 };
  const countText = () =>
    DRIVE_SYNC_TEXT.googleDriveProgress(
      uploadPercent(last.sent, last.total),
      last.total > 0 ? formatBytes(last.sent) : '',
      last.total > 0 ? formatBytes(last.total) : '',
    );
  const onCancel = () => {
    if (cancelRequested) return;
    cancelRequested = true;
    // 취소 접수 후에는 버튼을 숨긴다(ProgressDialog 계약).
    appState.setProgressDialog({
      text: DRIVE_SYNC_TEXT.googleDriveCancelling,
      done: uploadPercent(last.sent, last.total),
      total: 100,
      countText: countText(),
    });
    backend.driveUploadCancel().catch(() => {});
  };
  const show = () => {
    if (cancelRequested) return;
    appState.setProgressDialog({
      text: DRIVE_SYNC_TEXT.googleDriveUploading(name),
      done: uploadPercent(last.sent, last.total),
      total: 100,
      countText: countText(),
      onCancel,
    });
  };
  show();

  let file: DriveFileMeta;
  try {
    file = await backend.driveUpload(exportsPath, { kind }, (p) => {
      last = { sent: p.sent, total: p.total };
      show();
    });
  } catch (e: any) {
    appState.setProgressDialog(undefined);
    if (cancelRequested || e?.code === 'cancelled') {
      try {
        await backend.deleteFile(exportsPath);
      } catch (err) {}
      appState.pushMessage(DRIVE_SYNC_TEXT.cancelled);
      return 'cancelled';
    }
    const reason = e?.code
      ? driveUploadErrorText(e.code) + (e.detail ? ` (${e.detail})` : '')
      : e?.message || String(e);
    appState.pushMessage(DRIVE_SYNC_TEXT.googleDriveFailed(reason));
    await backend.publishExport(exportsPath);
    return 'downloads';
  }
  appState.setProgressDialog(undefined);

  try {
    await backend.deleteFile(exportsPath);
  } catch (e) {
    appState.pushMessage(DRIVE_SYNC_TEXT.googleDriveCleanupFailed);
  }

  const savedText = DRIVE_SYNC_TEXT.googleDriveSaved(file.name || name);
  const link = file.webViewLink;
  if (isDriveWebUrl(link)) {
    appState.pushDialog({
      type: 'confirm',
      green: true,
      text: savedText,
      confirmText: DRIVE_SYNC_TEXT.googleDriveOpen,
      cancelText: DRIVE_SYNC_TEXT.googleDriveClose,
      callback: () => {
        backend.driveOpenFile(link).catch(() => {});
      },
    });
  } else {
    appState.pushMessage(savedText);
  }
  return 'drive';
}

// 대화상자 없이 저장만 한다(프로젝트 덮어쓰기 임시 백업, 드라이브 동기화 ⑤).
// PC 에 드라이브 동기화 폴더가 있으면 그 폴더(같은 이름은 " (n)" 접미, 복사 후
// existFileAbsolute 로 실제 존재 확인), 없거나 복사가 실패하면 다운로드 폴더
// (backend.saveExportToDownloads — Android 는 Download/ 복사 성공 기준).
// 반환 = 사용자에게 보여 줄 저장 위치. 두 곳 모두 실패하면 throw(호출부는 중단).
export async function saveExportSilently(exportsPath: string): Promise<string> {
  const syncFolder = await getSyncFolder();
  if (syncFolder) {
    try {
      const baseName = exportsPath.replace(/\\/g, '/').split('/').pop()!;
      const finalName = await withCollisionSuffix(baseName, (candidate) =>
        backend.existFileAbsolute(joinAbsolute(syncFolder, candidate)),
      );
      const dest = joinAbsolute(syncFolder, finalName);
      await transferExportArchive(backend, exportsPath, dest);
      if (await backend.existFileAbsolute(dest)) return dest;
    } catch (e) {
      console.error('드라이브 폴더 임시 백업 저장 실패 — 다운로드 폴더로 전환:', e);
    }
  }
  return await backend.saveExportToDownloads(exportsPath);
}
