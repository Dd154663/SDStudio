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
export interface DirectExportRequest {
  projectName: string;
  sceneNames: string[];
  resolve: (result?: DirectExportResult) => void;
}
