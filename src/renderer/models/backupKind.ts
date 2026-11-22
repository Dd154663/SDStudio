// 백업 tar 를 풀어 놓은 폴더에서 백업 종류를 가린다(2026-11-22 백업 불러오기 견고화 — 조사 P5·P6·3-6).
//
// 종류 = 전체 백업(_backup.json) / 폴더 백업(_folder.json) / 프로젝트 백업(project.json) / 알 수 없음.
// 백업 tar 를 받는 모든 불러오기 경로(전체 백업 불러오기·handleTarImport(끌어 놓기·프로젝트 백업 불러오기·드라이브)·
// 폴더 백업 불러오기·폴더 메뉴의 프로젝트 백업 불러오기·라이브러리 백업 불러오기의 형식 불일치)가 이 판정 하나를 쓰고,
// 어느 경로로 들어왔든 종류에 맞는 기존 복원 흐름으로 넘긴다(BackupService.routeExtractedBackup).
//
// 규칙:
//  · 한 번만 푼다 — 판정에 쓴 폴더를 그대로 복원에 쓴다.
//  · 맨 위 단계에서 판정되지 않고, 맨 위에 폴더 하나만 있으면(파일 없음) 그 안을 한 번만 더 본다
//    (사용자가 풀었다가 폴더째 다시 묶은 경우). 두 겹 이상은 보지 않는다.
//  · 판정 순서 = 전체 → 폴더 → 프로젝트(종전 handleTarImport 의 폴더 → 프로젝트 순서 유지).
//  · 매니페스트 version 상한 검사는 판정 뒤 호출부가 종전 guardManifestVersion 으로 한다(판정은 type 만 본다).
// backend 는 읽기만 주입한다(jest 는 메모리 목).

export const FULL_BACKUP_MANIFEST_FILE = '_backup.json';
export const FOLDER_BACKUP_MANIFEST_FILE = '_folder.json';
export const PROJECT_BACKUP_FILE = 'project.json';

export const FULL_BACKUP_TYPE = 'sdstudio-full-backup';
export const FOLDER_BACKUP_TYPE = 'sdstudio-folder-backup';

export type BackupKind = 'full' | 'folder' | 'project' | 'unknown';

export type BackupDetection =
  /** root = 복원에 쓸 뿌리(한 겹 벗겼으면 그 안쪽) */
  | { kind: 'full'; root: string; manifest: any; unwrapped: boolean }
  | { kind: 'folder'; root: string; manifest: any; unwrapped: boolean }
  | { kind: 'project'; root: string; unwrapped: boolean }
  | { kind: 'unknown'; root: string; unwrapped: false };

/** 판정에 쓰는 backend 읽기(주입) */
export interface BackupKindReader {
  readFile(path: string): Promise<string>;
  existFile(path: string): Promise<boolean>;
  /** 이름 목록(폴더 포함) */
  listFiles(path: string): Promise<string[]>;
  /** 파일만(폴더 제외) */
  listFilesWithStats(path: string): Promise<{ name: string }[]>;
}

async function readJsonOrNull(io: BackupKindReader, path: string): Promise<any | null> {
  try {
    return JSON.parse(await io.readFile(path));
  } catch (e) {
    return null;
  }
}

/** 폴더 백업 매니페스트 유효성(종전 readFolderBackupManifest 와 같은 기준) */
export function isFolderBackupManifest(m: any): boolean {
  return !!m && m.type === FOLDER_BACKUP_TYPE && Array.isArray(m.projects);
}

/** 전체 백업 매니페스트 유효성(종전 fullBackupImport 와 같은 기준 — type 만) */
export function isFullBackupManifest(m: any): boolean {
  return !!m && m.type === FULL_BACKUP_TYPE;
}

// 한 단계에서만 본다. 판정되지 않으면 null.
async function detectAt(
  dir: string,
  io: BackupKindReader,
  unwrapped: boolean,
): Promise<Exclude<BackupDetection, { kind: 'unknown' }> | null> {
  const full = await readJsonOrNull(io, dir + '/' + FULL_BACKUP_MANIFEST_FILE);
  if (isFullBackupManifest(full)) return { kind: 'full', root: dir, manifest: full, unwrapped };
  const folder = await readJsonOrNull(io, dir + '/' + FOLDER_BACKUP_MANIFEST_FILE);
  if (isFolderBackupManifest(folder)) return { kind: 'folder', root: dir, manifest: folder, unwrapped };
  let isProject = false;
  try {
    isProject = await io.existFile(dir + '/' + PROJECT_BACKUP_FILE);
  } catch (e) {
    isProject = false;
  }
  if (isProject) return { kind: 'project', root: dir, unwrapped };
  return null;
}

/** 맨 위에 폴더 하나만 있으면(파일 없음) 그 이름, 아니면 null */
async function singleWrapperDir(root: string, io: BackupKindReader): Promise<string | null> {
  let names: string[];
  let files: { name: string }[];
  try {
    names = await io.listFiles(root);
    files = await io.listFilesWithStats(root);
  } catch (e) {
    return null;
  }
  if (names.length !== 1 || files.length !== 0) return null;
  const only = names[0];
  if (!only || only === '.' || only === '..' || only.includes('/') || only.includes('\\')) return null;
  return only;
}

/** 풀어 놓은 폴더(root)의 백업 종류. 던지지 않는다. */
export async function detectBackupKind(root: string, io: BackupKindReader): Promise<BackupDetection> {
  const top = await detectAt(root, io, false);
  if (top) return top;
  const inner = await singleWrapperDir(root, io);
  if (inner) {
    const d = await detectAt(root + '/' + inner, io, true);
    if (d) return d;
  }
  return { kind: 'unknown', root, unwrapped: false };
}

/** 백업 tar 로 받을 파일 이름인지(끌어 놓기·파일 불러오기) — 확장자 .tar 만, 대소문자 무관 */
export function isTarFileName(name: string): boolean {
  return typeof name === 'string' && name.toLowerCase().endsWith('.tar');
}

// ─── 경로별 넘기기 계획 ───

/**
 * 들어온 길.
 *  · full   = 「전체 백업 불러오기」
 *  · tar    = handleTarImport(끌어 놓기·프로젝트 불러오기 메뉴의 「프로젝트 백업 불러오기」·드라이브의 프로젝트)
 *  · folder = 「폴더 백업 불러오기」
 *  · folderDeep = 폴더 메뉴의 「프로젝트 백업 불러오기」(이름을 먼저 받음)
 *  · library = 라이브러리 백업 불러오기(제 매니페스트가 아닐 때만 여기로)
 */
export type BackupImportEntry = 'full' | 'tar' | 'folder' | 'folderDeep' | 'library';

/** 그 길이 원래 받는 종류(이 밖의 종류면 넘기기 전에 한 줄 안내) */
const ENTRY_ACCEPTS: Record<BackupImportEntry, readonly BackupKind[]> = {
  full: ['full'],
  tar: ['folder', 'project'],
  folder: ['folder'],
  folderDeep: ['project'],
  library: [],
};

export type BackupRoutePlan =
  | { action: 'unknown' }
  | { action: 'full' | 'folder' | 'project'; notice: string | null };

/** 판정 결과를 어느 기존 흐름으로 넘길지(순수) */
export function planBackupRoute(entry: BackupImportEntry, kind: BackupKind): BackupRoutePlan {
  if (kind === 'unknown') return { action: 'unknown' };
  const accepted = ENTRY_ACCEPTS[entry].includes(kind);
  return { action: kind, notice: accepted ? null : BACKUP_IMPORT_TEXT.kindNotice(kind) };
}

// ─── 문구(한곳) ───

export const BACKUP_KIND_LABEL: Record<Exclude<BackupKind, 'unknown'>, string> = {
  full: '전체 백업',
  folder: '폴더 백업',
  project: '프로젝트 백업',
};

export const BACKUP_IMPORT_TEXT = {
  /** 풀기 실패(다른 프로그램으로 다시 묶은 zip·tar.gz·잘린 파일 등) */
  unzipFailed:
    '백업 파일을 풀 수 없습니다. 백업 파일(.tar)은 압축 프로그램으로 다시 묶지 않은, SDStudio 가 만든 원본 그대로여야 합니다(zip·tar.gz 로 다시 묶었거나 받는 도중 잘린 파일은 열 수 없습니다).',
  /** 풀었지만 종류를 알 수 없음 */
  unknownKind:
    'SDStudio 백업 파일이 아니거나, 풀었다가 다시 묶으면서 구조가 바뀐 파일입니다. SDStudio 에서 만든 백업 파일(.tar)을 그대로 넣어 주세요.',
  /** 다른 종류의 메뉴로 들어왔을 때 넘기기 전 한 줄 */
  kindNotice: (kind: Exclude<BackupKind, 'unknown'>): string =>
    kind === 'full'
      ? '이 파일은 전체 백업입니다. 전체 백업으로 불러옵니다.'
      : kind === 'folder'
        ? '이 파일은 폴더 백업입니다. 폴더로 불러옵니다.'
        : '이 파일은 프로젝트 백업입니다. 프로젝트로 불러옵니다.',
} as const;
