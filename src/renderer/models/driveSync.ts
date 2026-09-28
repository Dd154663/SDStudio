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

import { backend } from '.';
import { appState } from './AppService';
import { platform } from './platform';
import { transferExportArchive } from './exportArchiveTransfer';

// 대상 종류 = 파일명 규칙 sdstudio-<kind>-<날짜> 의 kind. 기존 라이브러리 백업 파일명
// (sdstudio-global-presets-…, sdstudio-artist-library-…)과 같은 값을 쓴다.
export type DriveExportKind =
  | 'global-presets'
  | 'artist-library'
  | 'character-presets'
  | 'scene-template'
  | 'project';

export type ExportDestination = 'drive' | 'downloads';

export const DRIVE_EXPORT_KIND_LABEL: Record<DriveExportKind, string> = {
  'global-presets': '글로벌 프리셋 백업',
  'artist-library': '작가 라이브러리 백업',
  'character-presets': '캐릭터 프리셋',
  'scene-template': '씬 템플릿',
  project: '프로젝트 백업',
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
// 드라이브 폴더는 임의 절대 경로 쓰기가 되는 플랫폼(PC)에서 폴더가 지정된 경우만.
export function resolveExportDestinations(opts: {
  syncFolder?: string;
  supportsTargetFolder: boolean;
}): ExportDestination[] {
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

export type DeliverResult = 'drive' | 'downloads' | 'cancelled';

// 내보내기 끝 공용 처리. exportsPath 는 앱 내부 exports/ 의 완성 산출물.
// doneText 는 기존 흐름이 띄우던 완료 문구(있으면 선택 대화상자 머리에 붙이고,
// 선택지가 하나뿐이면 기존처럼 확인 창으로 띄운 뒤 publishExport).
export async function deliverExport(
  exportsPath: string,
  kind: DriveExportKind,
  opts: { doneText?: string } = {},
): Promise<DeliverResult> {
  const syncFolder = await getSyncFolder();
  const destinations = resolveExportDestinations({
    syncFolder,
    supportsTargetFolder: platform.supportsTargetFolder,
  });

  if (destinations.length === 1 || !syncFolder) {
    // 기존 동작 그대로(PC 폴더 미설정·Android).
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
      text: DRIVE_SYNC_TEXT.destination[d],
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
