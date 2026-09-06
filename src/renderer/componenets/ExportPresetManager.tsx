import ExportSettingsFields from './ExportSettingsFields';
import { ExportFormState as FormState, emptyExportForm as emptyForm, presetToExportForm as presetToForm, isExportFormValid, exportFormToPreset } from '../models/exportSettings';
import React, { useState, useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { appState, ExportPreset } from '../models/AppService';

import ModalOverlay from './ModalOverlay';

import { FaPlus, FaTrash, FaPen, FaCopy } from 'react-icons/fa';

const ExportPresetManager = observer(() => {
  const [presets, setPresets] = useState<ExportPreset[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [renamingIndex, setRenamingIndex] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');


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
    const session = appState.lastExportSession;
    const selected = appState.lastExportSelected;
    setTimeout(() => {
      if (session && appState.curSession === session) appState.exportPackage(type, selected);
    }, 100);
  };

  const selectPreset = (idx: number) => {
    setEditingIndex(idx);
    setForm(presetToForm(presets[idx]));
  };

  const newPreset = () => {
    setEditingIndex(null);
    setForm(emptyForm());
  };

  const isFormValid = () => isExportFormValid(form, true);

  const savePreset = () => {
    if (!isFormValid()) return;
    const preset = exportFormToPreset(form);
    let updated = [...presets];
    if (editingIndex !== null) {
      updated[editingIndex] = preset;
    } else {
      updated.push(preset);
    }
    // 기본 프리셋은 하나만 — 이 프리셋이 기본이면 나머지의 기본 플래그를 해제
    if (preset.isDefault) {
      updated = updated.map((p) =>
        p === preset ? p : { ...p, isDefault: false },
      );
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

  // 삭제 전 한 번 확인
  const requestDeletePreset = (idx: number) => {
    appState.pushDialog({
      type: 'confirm',
      text: `프리셋 "${presets[idx]?.name}"을(를) 정말 삭제하시겠습니까?`,
      callback: () => deletePreset(idx),
    });
  };

  // 인라인 이름 변경 (오버레이 없이 목록에서 바로)
  const startRename = (idx: number) => {
    setRenamingIndex(idx);
    setRenameValue(presets[idx].name);
  };

  // ✏️ 버튼 토글: 이미 그 행을 편집 중이면 저장하고 끄고, 아니면 편집 시작.
  const toggleRename = (idx: number) => {
    if (renamingIndex === idx) {
      commitRename();
    } else {
      startRename(idx);
    }
  };

  const commitRename = () => {
    if (renamingIndex === null) return;
    const name = renameValue.trim();
    if (!name) {
      setRenamingIndex(null);
      return;
    }
    const updated = presets.map((p, i) =>
      i === renamingIndex ? { ...p, name } : p,
    );
    setPresets(updated);
    appState.saveExportPresets(updated);
    // 편집 중인 폼이 이 프리셋이면 폼 이름도 동기화
    if (editingIndex === renamingIndex) setForm((f) => ({ ...f, name }));
    setRenamingIndex(null);
  };

  const cancelRename = () => setRenamingIndex(null);

  // 프리셋 복제 (고유 이름 부여, 바로 아래에 삽입). 복제본은 기본 프리셋 해제.
  const duplicatePreset = (idx: number) => {
    const src = presets[idx];
    const base = `${src.name} (복사)`;
    let name = base;
    let n = 2;
    while (presets.some((p) => p.name === name)) {
      name = `${base} ${n++}`;
    }
    const copy: ExportPreset = { ...src, name, isDefault: false };
    const updated = [...presets];
    updated.splice(idx + 1, 0, copy);
    setPresets(updated);
    appState.saveExportPresets(updated);
    // 삽입으로 뒤쪽 인덱스가 밀리므로 편집 중 인덱스 보정
    if (editingIndex !== null && editingIndex > idx) {
      setEditingIndex(editingIndex + 1);
    }
    appState.pushMessage(`프리셋 "${name}"이(가) 복제되었습니다`);
  };

  return (
    <ModalOverlay isOpen={true} onClose={onClose} title="내보내기 프리셋 관리" width="max-w-lg">
      <div className="flex flex-col gap-4">
        {/* 새 프리셋 버튼 */}
        <button
          onClick={newPreset}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border-2 border-dashed line-color hover:border-sky-400 dark:hover:border-sky-500 text-muted hover:text-sky-500 transition-colors text-sm"
        >
          <FaPlus size={12} />
          새 프리셋 추가
        </button>

        {/* 프리셋 목록 */}
        {presets.length > 0 && (
          <div className="max-h-40 overflow-y-auto border line-color rounded-lg divide-y divide-[color:var(--c-line)]">
            {presets.map((p, i) => (
              <div
                key={i}
                onClick={() => renamingIndex === null && selectPreset(i)}
                className={`px-3 py-2 cursor-pointer flex justify-between items-center gap-2 ${
                  editingIndex === i
                    ? 'bg-sky-50 dark:bg-sky-900/30 border-l-2 border-sky-500'
                    : 'hover:bg-gray-50 dark:hover:bg-slate-700/50'
                }`}
              >
                {renamingIndex === i ? (
                  <input
                    autoFocus
                    type="text"
                    value={renameValue}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename();
                      else if (e.key === 'Escape') cancelRename();
                    }}
                    className="flex-1 min-w-0 px-2 py-1 rounded border border-sky-400 bg-[var(--c-input-bg)] text-default text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
                  />
                ) : (
                  <div className="text-sm font-medium text-default truncate flex items-center gap-1">
                    {p.isDefault && <span title="빠른 export 기본 프리셋">⚡</span>}
                    {p.name}
                  </div>
                )}
                <div className="flex-none flex items-center gap-0.5">
                  <button
                    title={renamingIndex === i ? '이름 변경 완료' : '이름 변경'}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => { e.stopPropagation(); toggleRename(i); }}
                    className={`p-1.5 rounded transition-colors ${
                      renamingIndex === i
                        ? 'text-sky-500 bg-sky-50 dark:bg-sky-900/20'
                        : 'text-faint hover:text-sky-500 hover:bg-sky-50 dark:hover:bg-sky-900/20'
                    }`}
                  >
                    <FaPen size={11} />
                  </button>
                  <button
                    title="복제"
                    onClick={(e) => { e.stopPropagation(); duplicatePreset(i); }}
                    className="p-1.5 rounded text-faint hover:text-sky-500 hover:bg-sky-50 dark:hover:bg-sky-900/20 transition-colors"
                  >
                    <FaCopy size={11} />
                  </button>
                  <button
                    title="삭제"
                    onClick={(e) => { e.stopPropagation(); requestDeletePreset(i); }}
                    className="p-1.5 rounded text-faint hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    <FaTrash size={11} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 편집 폼 */}
        <div className="border line-color rounded-lg p-4 space-y-3">
          <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            {editingIndex !== null ? `"${presets[editingIndex]?.name}" 편집` : '새 프리셋'}
          </div>

          {/* 프리셋 이름 */}
          <div className="flex items-center gap-3">
            <label className="text-sm text-muted flex-none w-24">이름 *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="프리셋 이름"
              className="flex-1 px-3 py-1.5 rounded border line-color bg-[var(--c-input-bg)] text-default text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
            />
          </div>

          <ExportSettingsFields form={form} setForm={setForm} />
          {/* ⚡ 빠른 export 기본 프리셋 지정 */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
              className="w-4 h-4 accent-sky-500"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              ⚡ 빠른 export 기본 프리셋으로 사용
            </span>
          </label>

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
