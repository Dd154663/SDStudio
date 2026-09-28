// 프로젝트 백업 불러오기·덮어쓰기 (드라이브 동기화 C안 ⑤, 2026-09-28)
//
// 불러오기 순서는 importFlow 의 §0 일관화 계약을 따른다:
//   파일 고르기 → (같은 이름이 있으면) 정책 선택 → (덮어쓰기면) 확인 2회(프로젝트만)
//   → 적용 → 완료 안내 「추가 N · 갱신 N · 건너뜀 N」(+ 임시 백업 위치)
//
// 덮어쓰기는 기존 project.json 을 제자리 교체하지 않는다(씬 유실 가드와 충돌). 대신
// 기존 관문만 이어 붙인다(사용자 결정 2026-09-28: 휴지통 이관 + 임시 백업 2중 보호,
// 영구 삭제 안 함):
//   1. 다른 창에서 열려 있으면 중단
//   2. 대상 저장 flush → exportSessionDeep 로 임시 백업 tar → 저장 성공 확인
//   3. 백업 내용을 임시 이름 「<이름> (가져오는 중)」으로 먼저 가져오기
//   4. 기존 프로젝트를 「<이름> (덮어쓰기 전 <날짜>)」로 이름변경 → sessionService.delete
//      (휴지통 이관 관문). 이름을 먼저 바꾸는 이유: 구 배치는 이미지 폴더가 이름 키라
//      같은 이름으로 복원하면 휴지통 항목의 이미지와 겹치고, 신 배치도 휴지통의 동명
//      항목은 활성 프로젝트가 있으면 「고아」로 취급돼 복원 시 정리된다(TrashService
//      restoreProject). 다른 이름이면 두 배치 모두 휴지통에서 그대로 되살릴 수 있다.
//   5. 임시 이름 → 원래 이름(renameProject) → 원래 폴더(moveToFolder)
// 각 단계는 끝난 뒤 목록을 다시 확인한다(delete·rename·moveToFolder 는 교차 창 잠금 시
// 예외 없이 조용히 돌아오므로 — SessionService.guardCrossWindowLock).
//
// 이 모듈의 runProjectOverwrite 는 의존성을 주입받는 순수 절차라 jest 로 분기를
// 검증한다(__tests__/projectOverwrite.test.ts). 실제 서비스 연결은 BackupService.

import { invalidProjectName, isProjectNameTaken } from './projectPaths';
import { namedSyncFileName } from './driveSync';
import type { ImportPolicy } from './importFlow';

export const PROJECT_IMPORT_LABEL = '프로젝트';
export const PROJECT_BACKUP_TAG_BEFORE_OVERWRITE = 'before-overwrite';

// 사용자에게 보이는 문구는 전부 여기 한 곳에 둔다.
export const PROJECT_IMPORT_TEXT = {
  checking: '백업 파일을 확인하는 중...',
  unzipFailed: '압축 해제에 실패했습니다.',
  notRecognized: '인식할 수 없는 백업 파일입니다.',
  readFailed: '프로젝트 백업 파일(project.json)을 읽지 못했습니다.',
  namePrompt: '프로젝트 백업을 불러옵니다.\n프로젝트 이름을 확인해 주세요.',
  nameTaken: '이미 존재하는 프로젝트 이름입니다.',
  nameInvalid: (reason: string) => `사용할 수 없는 프로젝트 이름입니다(${reason}).`,
  importing: '프로젝트 백업을 불러오는 중입니다...',
  importFailed: (reason: string) => `백업 불러오기 실패: ${reason}`,
  busyZipping: '이미 내보내기 작업이 진행중입니다. 끝난 뒤 다시 시도해 주세요.',
  // 두 번째 확인(프로젝트만 2회 — §0-3). 첫 번째는 importFlow.confirmOverwrite.
  secondConfirm:
    '정말로 진행할까요?\n기존 프로젝트는 휴지통으로 옮기고, 그 전에 임시 백업 파일도 남깁니다.',
  secondConfirmButton: '예, 덮어씁니다',
  tempName: (name: string) => `${name} (가져오는 중)`,
  trashName: (name: string, date: string) => `${name} (덮어쓰기 전 ${date})`,
  progress: {
    flush: '기존 프로젝트를 저장하는 중..',
    backup: '기존 프로젝트의 임시 백업을 만드는 중..',
    save: '임시 백업 파일을 저장하는 중..',
    import: '백업 내용을 불러오는 중..',
    swap: '기존 프로젝트를 휴지통으로 옮기는 중..',
  },
  doneExtra: (backupLocation: string, trashName: string) =>
    `기존 프로젝트는 휴지통에 「${trashName}」(으)로 옮겼습니다.\n임시 백업 파일: ${backupLocation}`,
  folderRestoreFailed: (folder: string) =>
    `원래 폴더 「${folder}」(으)로 옮기지 못해 미분류에 두었습니다.`,
  failedTitle: '덮어쓰기를 중단했습니다.',
  failed: {
    missing: '덮어쓸 기존 프로젝트를 찾지 못했습니다. 아무것도 바뀌지 않았습니다.',
    locked:
      '기존 프로젝트가 다른 창에서 열려 있습니다. 그 창에서 프로젝트를 닫은 뒤 다시 시도해 주세요. 아무것도 바뀌지 않았습니다.',
    backup:
      '임시 백업 파일을 만들거나 저장하지 못했습니다. 기존 프로젝트는 그대로입니다.',
    import: '백업 내용을 불러오지 못했습니다. 기존 프로젝트는 그대로입니다.',
    trashRename: (tempName: string) =>
      `기존 프로젝트를 휴지통으로 옮기기 전 이름을 바꾸지 못했습니다. 기존 프로젝트는 그대로이고, 불러온 내용은 「${tempName}」 프로젝트로 추가돼 있습니다.`,
    trash: (tempName: string, trashName: string) =>
      `기존 프로젝트를 휴지통으로 옮기지 못했습니다. 기존 프로젝트는 「${trashName}」 이름으로 남아 있고, 불러온 내용은 「${tempName}」 프로젝트로 추가돼 있습니다.`,
    restoreName: (tempName: string, trashName: string) =>
      `불러온 프로젝트의 이름을 원래대로 바꾸지 못했습니다. 불러온 내용은 「${tempName}」, 기존 프로젝트는 휴지통의 「${trashName}」에 있습니다.`,
  },
  backupLocation: (loc: string) => `임시 백업 파일: ${loc}`,
  reason: (reason: string) => `(${reason})`,
};

// 프로젝트 백업 내보내기 파일명: sdstudio-project-<안전한 이름>-<날짜>.tar
export function projectBackupFileName(name: string, date: Date): string {
  return namedSyncFileName('project', name, date, 'tar');
}

// 덮어쓰기 전 임시 백업: sdstudio-project-<안전한 이름>-before-overwrite-<날짜>.tar
export function projectBeforeOverwriteFileName(name: string, date: Date): string {
  return namedSyncFileName(
    'project',
    name,
    date,
    'tar',
    PROJECT_BACKUP_TAG_BEFORE_OVERWRITE,
  );
}

// 사람이 읽는 로컬 날짜·시각(이름 접미용). 파일 시스템 예약 문자(':')는 쓰지 않는다.
export function localDateLabel(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ` +
    `${p(date.getHours())}-${p(date.getMinutes())}`
  );
}

// base 가 비어 있으면 base, 아니면 「base (2)」「base (3)」… (기존 복원 규칙과 같은 모양).
export function uniqueProjectName(
  base: string,
  taken: Iterable<string>,
): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  for (let n = 2; n < 100000; n++) {
    const candidate = `${base} (${n})`;
    if (!set.has(candidate)) return candidate;
  }
  throw new Error('사용할 수 있는 프로젝트 이름을 찾지 못했습니다.');
}

// 백업의 project.json 이름을 기본값으로. 쓸 수 없는 이름이면 파일 이름, 그것도
// 안 되면 기본 이름.
export function suggestProjectName(
  jsonName: unknown,
  fileStem?: string,
): string {
  const candidates = [jsonName, fileStem];
  for (const c of candidates) {
    if (typeof c !== 'string') continue;
    const trimmed = c.trim();
    if (trimmed && !invalidProjectName(trimmed)) return trimmed;
  }
  return '가져온 프로젝트';
}

// 경로의 마지막 조각에서 확장자를 뗀 이름(PC 절대 경로·Android content URI 공통 최선).
export function fileStemOf(path: string | undefined): string | undefined {
  if (!path) return undefined;
  let last = path.replace(/\\/g, '/').split('/').pop() || '';
  try {
    last = decodeURIComponent(last);
  } catch (e) {}
  last = last.split('/').pop() || last; // 인코딩된 '/'(%2F) 대비
  const dot = last.lastIndexOf('.');
  const stem = dot > 0 ? last.slice(0, dot) : last;
  return stem || undefined;
}

// 불러오기 계획: 같은 이름이 있는지·덮어쓰기를 보여 줄지.
// 이미지가 없는 백업은 덮어쓰기를 숨긴다(§0-2 — 기존 이미지가 사라지는 교체 방지).
export function planProjectImport(opts: {
  suggested: string;
  existing: readonly string[];
  hasImages: boolean;
}): { conflict: boolean; allowOverwrite: boolean; renameDefault: string } {
  const conflict = isProjectNameTaken(opts.existing, opts.suggested);
  return {
    conflict,
    allowOverwrite: conflict && opts.hasImages,
    renameDefault: conflict
      ? uniqueProjectName(opts.suggested, opts.existing)
      : opts.suggested,
  };
}

// 이름 입력 검사. 문제가 없으면 null.
export function checkNewProjectName(
  name: string,
  existing: readonly string[],
): string | null {
  const reason = invalidProjectName(name);
  if (reason) return PROJECT_IMPORT_TEXT.nameInvalid(reason);
  if (isProjectNameTaken(existing, name)) return PROJECT_IMPORT_TEXT.nameTaken;
  return null;
}

// 완료 안내 요약(importFlow.ImportSummary 모양).
export function projectImportSummary(
  policy: ImportPolicy,
): { added: number; updated: number; skipped: number } {
  return {
    added: policy === 'rename' ? 1 : 0,
    updated: policy === 'overwrite' ? 1 : 0,
    skipped: policy === 'skip' ? 1 : 0,
  };
}

// ───────────── 덮어쓰기 절차 (상태기계) ─────────────

export type OverwriteStage =
  | 'missing'
  | 'locked'
  | 'backup'
  | 'import'
  | 'trash-rename'
  | 'trash'
  | 'restore-name';

export type OverwriteProgress = keyof typeof PROJECT_IMPORT_TEXT.progress;

export interface OverwriteDeps {
  // 현재 활성 프로젝트 이름 목록(sessionService.list()) — 매 호출 최신값.
  listNames(): readonly string[];
  // 휴지통에 있는 프로젝트 이름(이름 충돌 회피용). 실패하면 빈 목록으로 본다.
  trashedNames(): Promise<readonly string[]>;
  // 다른 창이 소유 중이면 true(이 창 소유·단일 창·모바일은 false).
  isLockedElsewhere(name: string): Promise<boolean>;
  folderOf(name: string): string | null;
  folderExists(folder: string): boolean;
  flush(name: string): Promise<void>;
  exportBackup(name: string, exportsPath: string): Promise<void>;
  // 임시 백업을 앱 밖(드라이브 폴더 또는 다운로드 폴더)에 저장하고 위치를 돌려준다.
  saveBackup(exportsPath: string): Promise<string>;
  discardStaging(exportsPath: string): Promise<void>;
  importAs(name: string): Promise<void>;
  // 기존 프로젝트를 건드리기 직전 — 이 창에서 열려 있으면 닫는다.
  beforeSwap(name: string): void;
  rename(oldName: string, newName: string): Promise<void>;
  remove(name: string): Promise<void>;
  moveToFolder(name: string, folder: string): Promise<void>;
  onProgress?(stage: OverwriteProgress): void;
}

export type OverwriteResult =
  | {
      ok: true;
      backupLocation: string;
      trashName: string;
      folderRestoreFailed?: string;
    }
  | {
      ok: false;
      stage: OverwriteStage;
      reason?: string;
      backupLocation?: string;
      tempName?: string;
      trashName?: string;
    };

function errText(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) {
    const m = (e as any).message;
    if (typeof m === 'string' && m) return m;
  }
  return String(e);
}

export async function runProjectOverwrite(
  target: string,
  now: Date,
  deps: OverwriteDeps,
): Promise<OverwriteResult> {
  const has = (name: string) => deps.listNames().includes(name);

  // 1. 대상 존재·교차 창 잠금 — 여기까지는 아무것도 바꾸지 않는다.
  if (!has(target)) return { ok: false, stage: 'missing' };
  if (await deps.isLockedElsewhere(target)) return { ok: false, stage: 'locked' };
  const folder = deps.folderOf(target);

  // 2. 저장 flush → 임시 백업 tar → 앱 밖 저장 성공 확인. 실패 = 전체 중단(무변경).
  const exportsPath = 'exports/' + projectBeforeOverwriteFileName(target, now);
  let backupLocation: string;
  try {
    deps.onProgress?.('flush');
    await deps.flush(target);
    deps.onProgress?.('backup');
    await deps.exportBackup(target, exportsPath);
    deps.onProgress?.('save');
    backupLocation = await deps.saveBackup(exportsPath);
    if (!backupLocation) throw new Error('저장 위치를 확인하지 못했습니다.');
  } catch (e) {
    try {
      await deps.discardStaging(exportsPath);
    } catch (e2) {}
    return { ok: false, stage: 'backup', reason: errText(e) };
  }

  // 3. 임시 이름으로 먼저 가져오기. 실패 = 중단(기존 무변경, 임시 백업은 남김).
  const tempName = uniqueProjectName(
    PROJECT_IMPORT_TEXT.tempName(target),
    deps.listNames(),
  );
  deps.onProgress?.('import');
  try {
    await deps.importAs(tempName);
  } catch (e) {
    return { ok: false, stage: 'import', reason: errText(e), backupLocation };
  }
  if (!has(tempName)) {
    return {
      ok: false,
      stage: 'import',
      reason: '불러온 프로젝트가 목록에 나타나지 않았습니다.',
      backupLocation,
    };
  }

  // 4. 기존 프로젝트: 휴지통용 이름으로 바꾼 뒤 휴지통 이관 관문(delete).
  deps.onProgress?.('swap');
  let trashed: readonly string[] = [];
  try {
    trashed = await deps.trashedNames();
  } catch (e) {
    trashed = [];
  }
  const trashName = uniqueProjectName(
    PROJECT_IMPORT_TEXT.trashName(target, localDateLabel(now)),
    [...deps.listNames(), ...trashed],
  );
  deps.beforeSwap(target);
  // 가져오기 동안 다른 창이 열었을 수 있다 — 바꾸기 직전에 한 번 더 확인.
  if (await deps.isLockedElsewhere(target)) {
    return {
      ok: false,
      stage: 'trash-rename',
      reason: '다른 창에서 열려 있습니다.',
      backupLocation,
      tempName,
    };
  }
  try {
    await deps.rename(target, trashName);
  } catch (e) {
    return {
      ok: false,
      stage: 'trash-rename',
      reason: errText(e),
      backupLocation,
      tempName,
    };
  }
  if (has(target) || !has(trashName)) {
    return {
      ok: false,
      stage: 'trash-rename',
      reason: '이름변경이 반영되지 않았습니다.',
      backupLocation,
      tempName,
    };
  }
  try {
    await deps.remove(trashName);
  } catch (e) {
    return {
      ok: false,
      stage: 'trash',
      reason: errText(e),
      backupLocation,
      tempName,
      trashName,
    };
  }
  if (has(trashName)) {
    return {
      ok: false,
      stage: 'trash',
      reason: '삭제가 반영되지 않았습니다.',
      backupLocation,
      tempName,
      trashName,
    };
  }

  // 5. 임시 이름 → 원래 이름 → 원래 폴더.
  try {
    await deps.rename(tempName, target);
  } catch (e) {
    return {
      ok: false,
      stage: 'restore-name',
      reason: errText(e),
      backupLocation,
      tempName,
      trashName,
    };
  }
  if (!has(target) || has(tempName)) {
    return {
      ok: false,
      stage: 'restore-name',
      reason: '이름변경이 반영되지 않았습니다.',
      backupLocation,
      tempName,
      trashName,
    };
  }
  let folderRestoreFailed: string | undefined;
  if (folder) {
    if (!deps.folderExists(folder)) {
      folderRestoreFailed = folder;
    } else {
      try {
        await deps.moveToFolder(target, folder);
      } catch (e) {}
      if (deps.folderOf(target) !== folder) folderRestoreFailed = folder;
    }
  }
  return {
    ok: true,
    backupLocation,
    trashName,
    ...(folderRestoreFailed ? { folderRestoreFailed } : {}),
  };
}

// 실패 결과 → 안내 문구(여러 줄).
export function overwriteFailureText(r: Extract<OverwriteResult, { ok: false }>): string {
  const t = PROJECT_IMPORT_TEXT;
  let body: string;
  switch (r.stage) {
    case 'missing':
      body = t.failed.missing;
      break;
    case 'locked':
      body = t.failed.locked;
      break;
    case 'backup':
      body = t.failed.backup;
      break;
    case 'import':
      body = t.failed.import;
      break;
    case 'trash-rename':
      body = t.failed.trashRename(r.tempName ?? '');
      break;
    case 'trash':
      body = t.failed.trash(r.tempName ?? '', r.trashName ?? '');
      break;
    case 'restore-name':
    default:
      body = t.failed.restoreName(r.tempName ?? '', r.trashName ?? '');
      break;
  }
  const lines = [t.failedTitle, body];
  if (r.backupLocation) lines.push(t.backupLocation(r.backupLocation));
  if (r.reason) lines.push(t.reason(r.reason));
  return lines.join('\n');
}
