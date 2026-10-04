import ExportSettingsFields from './ExportSettingsFields';
import { ExportFormState as FormState, emptyExportForm as emptyForm, presetToExportForm as presetToForm, isExportFormValid, exportFormToPreset } from '../models/exportSettings';
import React, { useState, useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { appState, ExportPreset } from '../models/AppService';
import { validateName } from '../models/nameInput';
import { deleteConfirmText } from '../models/deleteFlowRules';

import ModalOverlay from './ModalOverlay';
import { useGuardedClose } from './backdropClose';

import { FaPlus, FaTrash, FaPen } from 'react-icons/fa';
import { ActionIcon } from './ActionIcon';

const ExportPresetManager = observer(() => {
  const [presets, setPresets] = useState<ExportPreset[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [renamingIndex, setRenamingIndex] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  // Esc 로 취소했거나 이미 확정한 편집 — 뒤따르는 blur 가 다시 확정하지 않게(D2 인라인 규칙)
  const renameClosedRef = useRef(false);
  // 미저장 가드(2026-10-03 E2-4): 편집 폼의 기준값(불러오기·선택·새로 만들기·저장 때 갱신).
  // 폼이 기준값과 다르면 ✕·바깥 클릭·Esc·뒤로 가기·[취소] 로 닫을 때 「버리고 닫을까요?」를 묻는다.
  const [baseline, setBaseline] = useState<FormState>(emptyForm());
  const isDirty = () => JSON.stringify(form) !== JSON.stringify(baseline);
  const setFormAndBaseline = (next: FormState) => {
    setForm(next);
    setBaseline(next);
  };


  useEffect(() => {
    if (appState.exportPresetManagerOpen) {
      const loaded = appState.loadExportPresets();
      setPresets(loaded);
      setEditingIndex(null);
      setFormAndBaseline(emptyForm());
    }
  }, [appState.exportPresetManagerOpen]);

  // 바닥 [취소] 도 ✕·바깥 클릭·Esc 와 같은 닫기 요청(가드 경유) — 폼만 되돌리고 창을 남기지 않는다
  const requestClose = useGuardedClose(isDirty, () => onClose());

  if (!appState.exportPresetManagerOpen) return null;

  // 닫으면 내보내기 선택 창을 다시 연다(기존 동작)
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
    setFormAndBaseline(presetToForm(presets[idx]));
  };

  const newPreset = () => {
    setEditingIndex(null);
    setFormAndBaseline(emptyForm());
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
    // 저장한 폼이 새 기준값 — 저장 뒤 닫기는 가드를 타지 않는다
    setBaseline(form);
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
      setFormAndBaseline(emptyForm());
    } else if (editingIndex !== null && editingIndex > idx) {
      setEditingIndex(editingIndex - 1);
    }
  };

  // 삭제 전 한 번 확인
  const requestDeletePreset = (idx: number) => {
    appState.pushDialog({
      type: 'confirm',
      ...deleteConfirmText({
        kind: 'exportPreset',
        name: presets[idx]?.name,
        outcome: 'permanent',
      }),
      callback: () => deletePreset(idx),
    });
  };

  // 인라인 이름 변경 (오버레이 없이 목록에서 바로)
  const startRename = (idx: number) => {
    renameClosedRef.current = false;
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
    if (renamingIndex === null || renameClosedRef.current) return;
    const name = renameValue.trim();
    const currentName = presets[renamingIndex]?.name;
    if (!name || name === currentName) {
      renameClosedRef.current = true;
      setRenamingIndex(null);
      return;
    }
    // 다른 프리셋과 같은 이름이면 거부 — 편집을 유지하고 입력을 보존한다
    const idx = renamingIndex;
    const problem = validateName(name, {
      kind: 'exportPreset',
      current: currentName,
      existing: (n) => presets.some((p, i) => i !== idx && p.name === n),
    });
    if (problem) {
      appState.pushMessage(problem, 'error');
      return;
    }
    renameClosedRef.current = true;
    const updated = presets.map((p, i) =>
      i === renamingIndex ? { ...p, name } : p,
    );
    setPresets(updated);
    appState.saveExportPresets(updated);
    // 편집 중인 폼이 이 프리셋이면 폼 이름도 동기화(이미 저장된 이름이라 기준값도 함께)
    if (editingIndex === renamingIndex) {
      setForm((f) => ({ ...f, name }));
      setBaseline((b) => ({ ...b, name }));
    }
    setRenamingIndex(null);
  };

  const cancelRename = () => {
    renameClosedRef.current = true;
    setRenamingIndex(null);
  };

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
    <ModalOverlay
      isOpen={true}
      onClose={onClose}
      dirty={isDirty}
      title="내보내기 프리셋 관리"
      width="max-w-lg"
    >
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
                    data-esc-cancel
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
                    {p.isDefault && (
                      <ActionIcon
                        id="quick-export"
                        className="flex-none text-amber-500"
                        aria-label="빠른 내보내기 기본 프리셋"
                      />
                    )}
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
                    <ActionIcon id="duplicate" size={11} />
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
              <ActionIcon id="quick-export" className="inline-block mr-1 align-[-0.125em]" />
              빠른 내보내기 기본 프리셋으로 사용
            </span>
          </label>

          {/* 저장·취소 버튼 — [확인][취소] 순서(SPEC §5). 취소 = 창 닫기 요청(미저장 가드 경유, 2026-10-03 E2-4) */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={savePreset}
              disabled={!isFormValid()}
              className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-600 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white text-sm font-medium transition-colors"
            >
              {editingIndex !== null ? '수정 저장' : '프리셋 추가'}
            </button>
            <button
              onClick={requestClose}
              className="px-4 py-2 rounded-lg btn-neutral text-body text-sm transition-colors"
            >
              취소
            </button>
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
});

export default ExportPresetManager;
