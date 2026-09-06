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

export function isExportFormValid(form: ExportFormState, requireName = false): boolean {
  if (requireName && !form.name.trim()) return false;
  if (!['fav', 'all'].includes(form.menu) || !['normal', 'prefix', 'prefix_ask'].includes(form.format)) return false;
  if (form.format === 'prefix' && !form.prefix.trim()) return false;
  if (!['original', 'lossy', 'lossless', 'avif'].includes(form.opt)) return false;
  if (form.opt !== 'original' && (!Number.isInteger(form.imageSize) || form.imageSize <= 0)) return false;
  if ((form.opt === 'lossy' || form.opt === 'avif') && form.quality !== '' &&
    (!Number.isInteger(form.quality) || form.quality < 1 || form.quality > 100)) return false;
  return true;
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
