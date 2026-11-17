import type { ExportPreset } from './AppService';
import type { FilenamePattern } from './exportPresetUtils';

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
 * 폴더 일괄 이미지 내보내기가 쓰지 않는 칸. 2026-11-16 M5 묶음 b-2 부터 폴더도 프로젝트 이미지 내보내기와 같은
 * 함수(ExportPresetService.buildExportImageList·optimizeExportImages·deliverExportImages)로 모든 칸을 쓰므로 비어 있다.
 * 범위별로 칸을 숨길 일이 다시 생기면 여기에 넣고 FOLDER_EXPORT_FIXED_NOTE 로 이유를 안내한다(조용히 무시하지 않음).
 */
export const FOLDER_EXPORT_UNUSED_FIELDS: readonly ExportFieldKey[] = [];

export function isExportFieldShown(key: ExportFieldKey, scope: DirectExportScope = 'project'): boolean {
  return scope !== 'folder' || !FOLDER_EXPORT_UNUSED_FIELDS.includes(key);
}

/** 폴더 범위 직접 설정 창의 안내 한 줄 — 프로젝트 내보내기와 달라지는 사실만 */
export const FOLDER_EXPORT_FIXED_NOTE =
  '폴더 일괄 내보내기는 결과 안에 프로젝트마다 하위 폴더(프로젝트 이름)를 만들어 이미지를 나눠 담습니다. ' +
  '파일명 패턴·캐릭터 프리셋 접두사/접미사는 프로젝트마다 그 프로젝트 기준으로 붙고, ' +
  '「프로젝트 폴더 경로로 하위 폴더 생성」은 이 폴더의 경로를 씁니다.';

/**
 * 프리셋 한 개를 실행할 때 쓰는 옵션(프로젝트 이미지 내보내기·폴더 일괄 이미지 내보내기 공용, 2026-11-16 M5 묶음 b-2).
 * 변환할 특수문자·목표 폴더·캐릭터 접두/접미사 값은 실행 쪽이 따로 정한다.
 */
export interface ExportRunOptions {
  /** 파일명 형식의 캐릭터 이름 접두(「이름+구분자」, 없으면 '') */
  prefix: string;
  fav: boolean;
  opt: string;
  imageSize: number;
  quality: number | undefined;
  preserveStealth: boolean;
  separator: string;
  filenamePattern: FilenamePattern | undefined;
  applyCharacterAffix: boolean;
  outputMode: 'tar' | 'zip' | 'files';
  reoptimize: 'ask' | 'skip' | 'all';
}

/**
 * 프리셋(저장된 프리셋 또는 직접 설정 폼 결과) → 실행 옵션. 종전 ExportPresetService.runPreset 의 인자 해석 그대로:
 * prefix 형식은 「이름+구분자」, prefix_ask 는 입력받은 이름+구분자, 그 밖은 빈 접두 / 출력 형태 누락·모르는 값 = tar /
 * 재최적화 누락 = ask(구 프리셋) / 접두·접미사 토글 누락 = 켬.
 */
export function exportRunOptionsFromPreset(ep: ExportPreset, askedName = ''): ExportRunOptions {
  let prefix = '';
  if (ep.format === 'prefix' && ep.prefix) prefix = ep.prefix + ep.separator;
  else if (ep.format === 'prefix_ask') prefix = askedName + ep.separator;
  return {
    prefix,
    fav: ep.menu === 'fav',
    opt: ep.opt,
    imageSize: ep.imageSize,
    quality: ep.quality,
    preserveStealth: ep.preserveStealth === true,
    separator: ep.separator,
    filenamePattern: ep.filenamePattern,
    applyCharacterAffix: ep.applyCharacterAffix !== false,
    outputMode: ep.outputMode === 'files' || ep.outputMode === 'zip' ? ep.outputMode : 'tar',
    reoptimize: ep.reoptimize ?? 'ask',
  };
}
