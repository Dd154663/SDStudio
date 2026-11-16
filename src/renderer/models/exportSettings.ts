import type { ExportPreset } from './AppService';

export type ExportFormState = Omit<ExportPreset, 'quality'> & { quality: number | '' };

export const emptyExportForm = (): ExportFormState => ({
  name: '', menu: 'fav', format: 'normal', prefix: '', opt: 'original',
  imageSize: 1024, quality: '', preserveStealth: false, separator: '.',
  filenamePattern: 'scene', outputMode: 'tar', applyCharacterAffix: true,
  autoConvertSeparator: false, isDefault: false, targetFolder: '',
  useProjectRelativePath: false, reoptimize: 'skip',
});

export const presetToExportForm = (preset: ExportPreset): ExportFormState => ({
  ...emptyExportForm(), ...preset,
  quality: preset.quality ?? '',
  // 기존 프리셋의 실행 시 확인 정책을 보존한다.
  reoptimize: preset.reoptimize ?? 'ask',
});

/**
 * 비었거나 잘못된 칸의 화면 라벨 목록(2026-11-11 오버레이 묶음 1 — 내보내기 프리셋 관리 「빠진 칸 안내」).
 * 라벨은 ExportSettingsFields·관리 창의 칸 이름과 같다. 빈 배열이면 저장할 수 있다(isExportFormValid 의 단일 출처).
 */
export function exportFormProblems(form: ExportFormState, requireName = false): string[] {
  const out: string[] = [];
  if (requireName && !form.name.trim()) out.push('이름');
  if (!['fav', 'all'].includes(form.menu)) out.push('이미지 범위');
  if (!['normal', 'prefix', 'prefix_ask'].includes(form.format)) out.push('파일명 형식');
  if (form.format === 'prefix' && !form.prefix.trim()) out.push('캐릭터 이름');
  if (!['original', 'lossy', 'lossless', 'avif'].includes(form.opt)) out.push('최적화');
  if (form.opt !== 'original' && (!Number.isInteger(form.imageSize) || form.imageSize <= 0)) out.push('이미지 크기');
  if ((form.opt === 'lossy' || form.opt === 'avif') && form.quality !== '' &&
    (!Number.isInteger(form.quality) || form.quality < 1 || form.quality > 100)) out.push('화질(1~100)');
  return out;
}

export function isExportFormValid(form: ExportFormState, requireName = false): boolean {
  return exportFormProblems(form, requireName).length === 0;
}

export const exportFormToPreset = (form: ExportFormState): ExportPreset => ({
  ...form, name: form.name.trim(),
  quality: (form.opt === 'lossy' || form.opt === 'avif') && form.quality !== '' ? form.quality : undefined,
  preserveStealth: (form.opt === 'lossy' || form.opt === 'lossless') && form.preserveStealth ? true : undefined,
});

export function exportSpecialChars(names: string[]): string[] {
  return Array.from(new Set(names.flatMap((name) => name.match(/[^a-zA-Z0-9가-힣ぁ-んァ-ヶ一-龥　-〿]/g) ?? [])));
}

export interface DirectExportResult { preset: ExportPreset; charsToReplace: string[] }

/**
 * 직접 내보내기 창의 범위(2026-11-16 M5 묶음 b P8). 'project' = 프로젝트 이미지 내보내기(종전),
 * 'folder' = 폴더 일괄 이미지 내보내기 — 종전 연속 질문 6~7개를 같은 폼 한 창으로.
 */
export type DirectExportScope = 'project' | 'folder';

export interface DirectExportRequest {
  /** scope 'folder' 이면 폴더 이름 */
  projectName: string;
  sceneNames: string[];
  /** 생략 = 'project' */
  scope?: DirectExportScope;
  /** scope 'folder' 일 때 폴더 안 프로젝트 수(머리 안내용) */
  projectCount?: number;
  resolve: (result?: DirectExportResult) => void;
}

/** ExportSettingsFields 의 칸 키 — 범위별 숨김 판정용 */
export type ExportFieldKey =
  | 'menu' | 'format' | 'filenamePattern' | 'outputMode' | 'prefix' | 'applyCharacterAffix'
  | 'opt' | 'imageSize' | 'quality' | 'preserveStealth' | 'separator' | 'autoConvertSeparator'
  | 'targetFolder' | 'reoptimize';

/**
 * 폴더 일괄 이미지 내보내기가 쓰지 않는 칸(BackupService.folderExportImages·buildSessionImageEntries 대조).
 * 폼에서 숨기고 FOLDER_EXPORT_FIXED_NOTE 로 이유를 한 줄 안내한다(조용히 무시하지 않음).
 */
export const FOLDER_EXPORT_UNUSED_FIELDS: readonly ExportFieldKey[] = [
  'filenamePattern', 'outputMode', 'applyCharacterAffix', 'quality', 'preserveStealth',
  'targetFolder', 'reoptimize',
];

export function isExportFieldShown(key: ExportFieldKey, scope: DirectExportScope = 'project'): boolean {
  return scope !== 'folder' || !FOLDER_EXPORT_UNUSED_FIELDS.includes(key);
}

export const FOLDER_EXPORT_FIXED_NOTE =
  '폴더 일괄 내보내기는 프로젝트별 하위 폴더로 묶은 tar 압축파일 하나를 기본 내보내기 위치에 만듭니다. ' +
  '그래서 파일명 패턴·출력 형태·목표 폴더·화질·스테가노그래피 보존 칸은 쓰지 않고, ' +
  '캐릭터 프리셋 접두사/접미사는 지금 적용된 캐릭터 프리셋 기준으로 늘 붙이며, ' +
  '이미 최적화된 이미지가 있으면 프로젝트마다 다시 묻습니다.';

/** 폴더 일괄 이미지 내보내기가 실제로 쓰는 옵션(BackupService.buildSessionImageEntries 인자) */
export interface FolderImageOptions {
  prefix: string;
  fav: boolean;
  opt: string;
  imageSize: number;
  separator: string;
}

/**
 * 프리셋(저장된 프리셋 또는 직접 설정 폼 결과)을 폴더 일괄 옵션으로. 종전 askFolderImageOptions 의
 * 프리셋 분기와 같은 규칙: prefix 형식은 「이름+구분자」, prefix_ask 는 입력받은 이름+구분자, 그 밖은 빈 접두.
 */
export function folderImageOptionsFromPreset(ep: ExportPreset, askedName = ''): FolderImageOptions {
  let prefix = '';
  if (ep.format === 'prefix' && ep.prefix) prefix = ep.prefix + ep.separator;
  else if (ep.format === 'prefix_ask') prefix = askedName + ep.separator;
  return {
    prefix,
    fav: ep.menu === 'fav',
    opt: ep.opt,
    imageSize: ep.imageSize,
    separator: ep.separator,
  };
}
