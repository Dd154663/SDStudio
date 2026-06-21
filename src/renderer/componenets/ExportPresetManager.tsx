import React, { useState, useEffect, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { appState, ExportPreset } from '../models/AppService';
import { backend, isMobile } from '../models';
import ModalOverlay from './ModalOverlay';
import { DropdownSelect, Option } from './UtilComponents';
import { FaPlus, FaTrash, FaFolderOpen } from 'react-icons/fa';

type MenuType = 'fav' | 'all';
type PatternType = 'folder.project.scene' | 'project.scene';
type OutputModeType = 'tar' | 'files';
type OptType = 'original' | 'lossy' | 'lossless' | 'avif';

const menuOptions: Option<MenuType>[] = [
  { value: 'fav', label: '즐겨찾기 이미지만' },
  { value: 'all', label: '모든 이미지 전부' },
];

const patternOptions: Option<PatternType>[] = [
  { value: 'folder.project.scene', label: '(folder명).(프로젝트).(씬).(번호)' },
  { value: 'project.scene', label: '(프로젝트).(씬).(번호)' },
];

const outputModeOptions: Option<OutputModeType>[] = [
  { value: 'tar', label: '.tar 압축파일' },
  { value: 'files', label: '개별 이미지 파일' },
];

const getOptOptions = (): Option<OptType>[] => {
  const opts: Option<OptType>[] = [
    { value: 'original', label: '원본' },
    { value: 'lossy', label: '저손실 webp 최적화' },
  ];
  if (!isMobile) {
    opts.push({ value: 'lossless', label: '무손실 webp 최적화' });
  }
  opts.push({ value: 'avif', label: 'AVIF 최적화' });
  return opts;
};

// 드롭다운은 미선택(undefined) 상태로 시작
interface FormState {
  name: string;
  menu: MenuType | undefined;
  filenamePattern: PatternType | undefined;
  outputMode: OutputModeType | undefined;
  targetFolder: string;
  useProjectRelativePath: boolean;
  opt: OptType | undefined;
  imageSize: number;
  isDefault: boolean;
}

const emptyForm = (): FormState => ({
  name: '',
  menu: undefined,
  filenamePattern: undefined,
  outputMode: undefined,
  targetFolder: '',
  useProjectRelativePath: true,
  opt: undefined,
  imageSize: 1024,
  isDefault: false,
});

const presetToForm = (p: ExportPreset): FormState => ({
  name: p.name,
  menu: p.menu,
  filenamePattern: p.filenamePattern,
  outputMode: p.outputMode,
  targetFolder: p.targetFolder,
  useProjectRelativePath: p.useProjectRelativePath,
  opt: p.opt,
  imageSize: p.imageSize,
  isDefault: p.isDefault ?? false,
});

const ExportPresetManager = observer(() => {
  const [presets, setPresets] = useState<ExportPreset[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const optOptions = useMemo(getOptOptions, []);

  useEffect(() => {
    if (appState.exportPresetManagerOpen) {
      const loaded = appState.loadExportPresets();
      setPresets(loaded);
      setEditingIndex(null);
      setForm(emptyForm());
    }
  }, [appState.exportPresetManagerOpen]);

  if (!appState.exportPresetManagerOpen) return null;

  const onClose = () => {
    appState.closeExportPresetManager();
  };

  const selectPreset = (idx: number) => {
    setEditingIndex(idx);
    setForm(presetToForm(presets[idx]));
  };

  const newPreset = () => {
    setEditingIndex(null);
    setForm(emptyForm());
  };

  const isFormValid = (): boolean => {
    if (!form.name.trim()) return false;
    if (form.menu === undefined) return false;
    if (form.filenamePattern === undefined) return false;
    if (form.outputMode === undefined) return false;
    if (form.opt === undefined) return false;
    if (form.opt !== 'original' && (!form.imageSize || form.imageSize <= 0)) return false;
    return true;
  };

  const savePreset = () => {
    if (!isFormValid()) return;
    const preset: ExportPreset = {
      name: form.name.trim(),
      menu: form.menu!,
      filenamePattern: form.filenamePattern!,
      outputMode: form.outputMode!,
      targetFolder: form.targetFolder,
      useProjectRelativePath: form.useProjectRelativePath,
      opt: form.opt!,
      imageSize: form.imageSize,
      isDefault: form.isDefault,
    };
    let updated = [...presets];
    // 기본 프리셋은 하나만 유지
    if (preset.isDefault) {
      updated = updated.map((p) => ({ ...p, isDefault: false }));
    }
    if (editingIndex !== null) {
      updated[editingIndex] = preset;
    } else {
      updated.push(preset);
    }
    // 첫 번째 프리셋이고 기본 지정이 없으면 자동으로 기본으로 간주(quickExport fallback)
    setPresets(updated);
    appState.saveExportPresets(updated);
    if (editingIndex === null) {
      setEditingIndex(updated.length - 1);
    }
    appState.pushMessage(`프리셋 "${preset.name}"이(가) 저장되었습니다`);
  };

  const deletePreset = (idx: number) => {
    const updated = presets.filter((_, i) => i !== idx);
    setPresets(updated);
    appState.saveExportPresets(updated);
    if (editingIndex === idx) {
      setEditingIndex(null);
      setForm(emptyForm());
    } else if (editingIndex !== null && editingIndex > idx) {
      setEditingIndex(editingIndex - 1);
    }
  };

  const selectTargetFolder = async () => {
    const folder = await backend.selectDir();
    if (folder) {
      setForm({ ...form, targetFolder: folder });
    }
  };

  const clearTargetFolder = () => {
    setForm({ ...form, targetFolder: '' });
  };

  return (
    <ModalOverlay isOpen={true} onClose={onClose} title="export 프리셋 관리" width="max-w-lg">
      <div className="flex flex-col gap-4">
        {/* 새 프리셋 버튼 */}
        <button
          onClick={newPreset}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 hover:border-sky-400 dark:hover:border-sky-500 text-gray-500 dark:text-gray-400 hover:text-sky-500 transition-colors text-sm"
        >
          <FaPlus size={12} />
          새 프리셋 추가
        </button>

        {/* 프리셋 목록 */}
        {presets.length > 0 && (
          <div className="max-h-40 overflow-y-auto border border-gray-200 dark:border-gray-600 rounded-lg divide-y divide-gray-100 dark:divide-gray-700">
            {presets.map((p, i) => (
              <div
                key={i}
                onClick={() => selectPreset(i)}
                className={`px-3 py-2 cursor-pointer flex justify-between items-center ${
                  editingIndex === i
                    ? 'bg-sky-50 dark:bg-sky-900/30 border-l-2 border-sky-500'
                    : 'hover:bg-gray-50 dark:hover:bg-slate-700/50'
                }`}
              >
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                  {p.name} {p.isDefault && <span className="text-sky-500 text-xs">(기본)</span>}
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); deletePreset(i); }}
                  className="flex-none ml-2 p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                >
                  <FaTrash size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 편집 폼 */}
        <div className="border border-gray-200 dark:border-gray-600 rounded-lg p-4 space-y-3">
          <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            {editingIndex !== null ? `"${presets[editingIndex]?.name}" 편집` : '새 프리셋'}
          </div>

          {/* 프리셋 이름 */}
          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-600 dark:text-gray-400 flex-none w-28">이름 *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="프리셋 이름"
              className="flex-1 px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
            />
          </div>

          {/* 기본 프리셋 */}
          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-600 dark:text-gray-400 flex-none w-28">기본 프리셋</label>
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
              id="cfgDefaultPreset"
            />
            <label htmlFor="cfgDefaultPreset" className="text-sm text-gray-600 dark:text-gray-400">
              빠른 export 버튼에 사용
            </label>
          </div>

          {/* 이미지 범위 */}
          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-600 dark:text-gray-400 flex-none w-28">이미지 범위 *</label>
            <div className="flex-1">
              <DropdownSelect
                selectedOption={form.menu}
                options={menuOptions}
                onSelect={(o) => setForm({ ...form, menu: o.value })}
              />
            </div>
          </div>

          {/* 파일명 형식 */}
          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-600 dark:text-gray-400 flex-none w-28">파일명 형식 *</label>
            <div className="flex-1">
              <DropdownSelect
                selectedOption={form.filenamePattern}
                options={patternOptions}
                onSelect={(o) => setForm({ ...form, filenamePattern: o.value })}
              />
            </div>
          </div>

          {/* 출력 형태 */}
          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-600 dark:text-gray-400 flex-none w-28">출력 형태 *</label>
            <div className="flex-1">
              <DropdownSelect
                selectedOption={form.outputMode}
                options={outputModeOptions}
                onSelect={(o) => setForm({ ...form, outputMode: o.value })}
              />
            </div>
          </div>

          {/* 목표 folder */}
          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-600 dark:text-gray-400 flex-none w-28">목표 folder</label>
            <div className="flex-1 flex gap-2">
              <input
                type="text"
                value={form.targetFolder}
                onChange={(e) => setForm({ ...form, targetFolder: e.target.value })}
                placeholder="비워두면 전역 기본 folder 사용"
                className="flex-1 px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
              />
              <button
                onClick={selectTargetFolder}
                className="px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-slate-600 text-gray-600 dark:text-gray-300"
                title="folder 선택"
              >
                <FaFolderOpen size={14} />
              </button>
              {form.targetFolder && (
                <button
                  onClick={clearTargetFolder}
                  className="px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-slate-600 text-xs text-gray-600 dark:text-gray-300"
                >
                  지우기
                </button>
              )}
            </div>
          </div>

          {/* 상대 경로 사용 */}
          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-600 dark:text-gray-400 flex-none w-28">상대 경로</label>
            <input
              type="checkbox"
              checked={form.useProjectRelativePath}
              onChange={(e) => setForm({ ...form, useProjectRelativePath: e.target.checked })}
              id="cfgRelativePath"
            />
            <label htmlFor="cfgRelativePath" className="text-sm text-gray-600 dark:text-gray-400">
              프로젝트 상위 folder 구조로 export
            </label>
          </div>

          {/* 최적화 방법 */}
          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-600 dark:text-gray-400 flex-none w-28">최적화 *</label>
            <div className="flex-1">
              <DropdownSelect
                selectedOption={form.opt}
                options={optOptions}
                onSelect={(o) => setForm({ ...form, opt: o.value })}
              />
            </div>
          </div>

          {/* 이미지 크기 (opt≠original 시) */}
          {form.opt !== undefined && form.opt !== 'original' && (
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-600 dark:text-gray-400 flex-none w-28">이미지 크기 *</label>
              <input
                type="number"
                value={form.imageSize}
                onChange={(e) => setForm({ ...form, imageSize: parseInt(e.target.value) || 0 })}
                placeholder="1024"
                className="flex-1 px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
              />
              <span className="text-xs text-gray-400">px</span>
            </div>
          )}

          {/* 저장 버튼 */}
          <div className="flex justify-end pt-2">
            <button
              onClick={savePreset}
              disabled={!isFormValid()}
              className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-600 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white text-sm font-medium transition-colors"
            >
              {editingIndex !== null ? '수정 저장' : '프리셋 추가'}
            </button>
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
});

export default ExportPresetManager;
