// 이미지 export 프리셋 관련 순수 유틸리티.
// UI/백엔드 의존성이 없어 단위 테스트하기 쉽습니다.

export type FilenamePattern = 'scene' | 'project.scene' | 'folder.project.scene';

/**
 * 파일명에 쓸 각 부분에서 파일 시스템상 문제를 일으킬 문자를 제거/치환합니다.
 * (Windows/macOS/Linux 공통 위험 문자 + 공백 + 앞뒤 점/공백)
 */
export function sanitizeFilenamePart(name: string, replacement = '_'): string {
  if (typeof name !== 'string') return '';
  let sanitized = name
    .replace(/[\\/:*?"<>|]/g, replacement)
    .replace(/\s+/g, replacement)
    .trim();
  // 앞뒤의 점/공백/치환문자 제거 (Windows 숨김/예약 문제 방지)
  const trimRegex = new RegExp(
    `^[.${replacement}\\s]+|[.${replacement}\\s]+$`,
    'g',
  );
  sanitized = sanitized.replace(trimRegex, '');
  return sanitized;
}

/**
 * 파일명 패턴에 따라 프로젝트/폴더 컨텍스트 프리픽스를 만듭니다.
 * 반환값은 (비어있지 않을 때) separator 로 끝나므로 기존 baseName 앞에 그대로 붙이면 됩니다.
 * 'scene'(기본)이면 빈 문자열을 반환합니다.
 */
export function buildPatternPrefix(
  pattern: FilenamePattern | undefined,
  folderName: string,
  projectName: string,
  separator: string,
): string {
  const proj = sanitizeFilenamePart(projectName);
  const folder = sanitizeFilenamePart(folderName);
  if (pattern === 'folder.project.scene') {
    const folderPart = folder ? folder + separator : '';
    return folderPart + proj + separator;
  }
  if (pattern === 'project.scene') {
    return proj + separator;
  }
  return '';
}

/**
 * export 목표 폴더(절대경로)를 결정합니다. 데스크톱 전용 기능.
 * 프리셋 지정 폴더 > 글로벌 기본 폴더 순으로 사용하며, 둘 다 없으면 null.
 * useProjectRelativePath 가 켜져 있고 프로젝트가 폴더에 속해 있으면 그 아래 하위 경로를 만든다.
 */
export function resolveExportTargetFolder(
  preset: { targetFolder?: string; useProjectRelativePath?: boolean },
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
