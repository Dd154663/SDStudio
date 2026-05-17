import React, { useState, useEffect, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { appState, ExportPreset } from '../models/AppService';
import { isMobile } from '../models';
import ModalOverlay from './ModalOverlay';
import { DropdownSelect } from './UtilComponents';
import { FaPlus, FaTrash } from 'react-icons/fa';

const menuOptions = [
  { value: 'fav' as const, label: '즐겨찾기 이미지만' },
  { value: 'all' as const, label: '모든 이미지 전부' },
];

const formatOptions = [
  { value: 'normal' as const, label: '(씬이름).(번호).png' },
  { value: 'prefix' as const, label: '(캐릭터).(씬이름).(번호)' },
  { value: 'prefix_ask' as const, label: '(캐릭터).(씬이름).(번호) - 이름 직접 입력' },
];

const getOptOptions = () => {
  const opts = [
    { value: 'original' as const, label: '원본' },
    { value: 'lossy' as const, label: '저손실 webp 최적화' },
  ];
  if (!isMobile) {
    opts.push({ value: 'lossless' as const, label: '무손실 webp 최적화' });
  }
  opts.push({ value: 'avif' as const, label: 'AVIF 최적화' });
  return opts;
};

// 편집 폼 상태 — 드롭다운은 미선택(undefined) 상태로 시작
interface FormState {
  name: string;
  menu: 'fav' | 'all' | undefined;
  format: 'normal' | 'prefix' | 'prefix_ask' | undefined;
  prefix: string;
  opt: 'original' | 'lossy' | 'lossless' | 'avif' | undefined;
  imageSize: number;
  separator: string;
}

const emptyForm = (): FormState => ({
  name: '',
  menu: undefined,
  format: undefined,
  prefix: '',
  opt: undefined,
  imageSize: 1024,
  separator: '',
});

const presetToForm = (p: ExportPreset): FormState => ({
  name: p.name,
  menu: p.menu,
  format: p.format,
  prefix: p.prefix,
  opt: p.opt,
  imageSize: p.imageSize,
  separator: p.separator,
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
    const type = appState.lastExportType || 'scene';
    setTimeout(() => appState.exportPackage(type), 100);
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
    if (form.format === undefined) return false;
    if (form.format === 'prefix' && !form.prefix.trim()) return false;
    if (form.opt === undefined) return false;
    if (form.opt !== 'original' && (!form.imageSize || form.imageSize <= 0)) return false;
    return true;
  };

  const savePreset = () => {
    if (!isFormValid()) return;
    const preset: ExportPreset = {
      name: form.name.trim(),
      menu: form.menu!,
      format: form.format!,
      prefix: form.prefix,
      opt: form.opt!,
      imageSize: form.imageSize,
      separator: form.separator,
    };
    const updated = [...presets];
    if (editingIndex !== null) {
      updated[editingIndex] = preset;
    } else {
      updated.push(preset);
    }
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

  return (
    <ModalOverlay isOpen={true} onClose={onClose} title="내보내기 프리셋 관리" width="max-w-lg">
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
                  {p.name}
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
            <label className="text-sm text-gray-600 dark:text-gray-400 flex-none w-24">이름 *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="프리셋 이름"
              className="flex-1 px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
            />
          </div>

          {/* 이미지 범위 */}
          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-600 dark:text-gray-400 flex-none w-24">이미지 범위 *</label>
            <div className="flex-1">
              <DropdownSelect
                selectedOption={form.menu !== undefined ? menuOptions.find((o) => o.value === form.menu) : undefined}
                options={menuOptions}
                onSelect={(o: any) => setForm({ ...form, menu: o.value })}
              />
            </div>
          </div>

          {/* 파일명 형식 */}
          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-600 dark:text-gray-400 flex-none w-24">파일명 형식 *</label>
            <div className="flex-1">
              <DropdownSelect
                selectedOption={form.format !== undefined ? formatOptions.find((o) => o.value === form.format) : undefined}
                options={formatOptions}
                onSelect={(o: any) => setForm({ ...form, format: o.value })}
              />
            </div>
          </div>

          {/* 캐릭터 이름 (format=prefix 시) */}
          {form.format === 'prefix' && (
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-600 dark:text-gray-400 flex-none w-24">캐릭터 이름 *</label>
              <input
                type="text"
                value={form.prefix}
                onChange={(e) => setForm({ ...form, prefix: e.target.value })}
                placeholder="캐릭터 이름"
                className="flex-1 px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
              />
            </div>
          )}

          {/* 최적화 방법 */}
          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-600 dark:text-gray-400 flex-none w-24">최적화 *</label>
            <div className="flex-1">
              <DropdownSelect
                selectedOption={form.opt !== undefined ? optOptions.find((o) => o.value === form.opt) : undefined}
                options={optOptions}
                onSelect={(o: any) => setForm({ ...form, opt: o.value })}
              />
            </div>
          </div>

          {/* 이미지 크기 (opt≠original 시) */}
          {form.opt !== undefined && form.opt !== 'original' && (
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-600 dark:text-gray-400 flex-none w-24">이미지 크기 *</label>
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

          {/* 구분자 — 텍스트 입력, 빈 칸 허용 */}
          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-600 dark:text-gray-400 flex-none w-24">파일명 구분자</label>
            <input
              type="text"
              value={form.separator}
              onChange={(e) => setForm({ ...form, separator: e.target.value })}
              placeholder="비워두면 구분자 없음"
              className="flex-1 px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
            />
          </div>

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
