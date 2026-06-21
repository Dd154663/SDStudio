// 이미지 export 프리셋 관련 순수 유틸리티.
// UI/백엔드 의존성이 없어 단위 테스트하기 쉽습니다.

export type FilenamePattern = 'folder.project.scene' | 'project.scene';
export type OutputMode = 'tar' | 'files';

export interface ExportPresetV2 {
  name: string;
  menu: 'fav' | 'all';
  filenamePattern: FilenamePattern;
  outputMode: OutputMode;
  targetFolder: string;
  useProjectRelativePath: boolean;
  opt: 'original' | 'lossy' | 'lossless' | 'avif';
  imageSize: number;
  /** 빠른 export 버튼이 사용할 기본 프리셋 여부 */
  isDefault?: boolean;
}

/** 이전 형식의 프리셋 (마이그레이션용) */
export interface LegacyExportPreset {
  name: string;
  menu: 'fav' | 'all';
  format: 'normal' | 'prefix' | 'prefix_ask';
  prefix: string;
  opt: 'original' | 'lossy' | 'lossless' | 'avif';
  imageSize: number;
  separator: string;
}

/**
 * Resolves the final destination directory for an export.
 * @returns absolute path string, or null if not configured
 */
export function resolveExportTargetFolder(
  preset: ExportPresetV2,
  projectFolder: string | null,
  defaultFolder: string | undefined,
): string | null {
  const base = preset.targetFolder || defaultFolder;
  if (!base) return null;
  if (preset.useProjectRelativePath && projectFolder) {
    return `${base}/${projectFolder}`;
  }
  return base;
}

/**
 * 파일명에 쓸 각 부분에서 파일 시스템상 문제를 일으킬 문자를 제거합니다.
 */
export function sanitizeFilenamePart(name: string, replacement = '_'): string {
  // Windows/macOS/Linux에서 사용 불가능하거나 위험한 문자를 치환
  let sanitized = name
    .replace(/[\\/:*?"<>|]/g, replacement)
    .replace(/\s+/g, replacement)
    .trim();
  // 앞뒤의 점/공백/치환문자는 제거 (Windows에서 숨김/예약 문제 방지)
  const trimRegex = new RegExp(`^[.${replacement}\\s]+|[.${replacement}\\s]+$`, 'g');
  sanitized = sanitized.replace(trimRegex, '');
  return sanitized;
}

/**
 * Assembles one export file name.
 */
export function buildExportFileName(
  pattern: FilenamePattern,
  folderName: string,
  projectName: string,
  sceneName: string,
  index: number,
  ext: string,
): string {
  const folderPart =
    pattern === 'folder.project.scene'
      ? sanitizeFilenamePart(folderName) + '.'
      : '';
  const base =
    folderPart +
    sanitizeFilenamePart(projectName) +
    '.' +
    sanitizeFilenamePart(sceneName);
  const safeExt = ext.replace(/^\.+/, '').toLowerCase();
  return `${base}.${index}.${safeExt}`;
}

/**
 * 이전 형식의 프리셋을 새 형식으로 마이그레이션합니다.
 * 사용자가 불평했던 '프리셋에 캐릭터 이름 저장'은 제거됩니다.
 */
export function migrateExportPreset(
  preset: LegacyExportPreset | ExportPresetV2,
): ExportPresetV2 {
  if ('filenamePattern' in preset) {
    return preset as ExportPresetV2;
  }
  const legacy = preset as LegacyExportPreset;
  return {
    name: legacy.name,
    menu: legacy.menu,
    filenamePattern:
      legacy.format === 'normal' ? 'project.scene' : 'folder.project.scene',
    outputMode: 'tar',
    targetFolder: '',
    useProjectRelativePath: true,
    opt: legacy.opt,
    imageSize: legacy.imageSize,
    isDefault: false,
  };
}
