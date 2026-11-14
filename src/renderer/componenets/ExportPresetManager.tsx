import ExportSettingsFields from './ExportSettingsFields';
import { ExportFormState as FormState, emptyExportForm as emptyForm, presetToExportForm as presetToForm, exportFormProblems, exportFormToPreset } from '../models/exportSettings';
import React, { useState, useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { isMobile } from '../models';
import { appState, ExportPreset } from '../models/AppService';
import Tooltip from './Tooltip';
import { validateName } from '../models/nameInput';
import { deleteConfirmText } from '../models/deleteFlowRules';
import { ExportPresetOps, saveExportPresetsRecorded } from '../models/globalLibraryUndo';
import { UNDO_TEXT } from '../models/undoService';

import ModalOverlay from './ModalOverlay';
import { useGuardedClose } from './backdropClose';

import { FaPlus, FaTrash, FaPen } from 'react-icons/fa';
import { ActionIcon } from './ActionIcon';

const EXPORT_PRESET_OPS: ExportPresetOps<ExportPreset> = {
  load: () => appState.loadExportPresets(),
  save: (presets) => appState.saveExportPresets(presets),
};

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
      presetsRef.current = loaded;
      setPresets(loaded);
      setEditingIndex(null);
      setFormAndBaseline(emptyForm());
    }
  }, [appState.exportPresetManagerOpen]);

  // 되돌리기·다시 실행(2차 묶음 4 P5)이 목록을 바꾸면 열린 창도 다시 읽는다 — 이 창의 낡은 목록으로 덮어쓰지 않게.
  // 이 창 자신의 저장(commitPresets)은 같은 배열이 돌아오므로 무시한다. 편집 중이던 프리셋은 이름으로 다시 찾는다.
  const presetsRef = useRef<ExportPreset[]>(presets);
  const editingIndexRef = useRef<number | null>(editingIndex);
  presetsRef.current = presets;
  editingIndexRef.current = editingIndex;
  useEffect(() => {
    if (!appState.exportPresetManagerOpen) return;
    return appState.subscribeExportPresets((list) => {
      if (list === presetsRef.current) return;
      const prev = presetsRef.current;
      const ei = editingIndexRef.current;
      const editingName = ei !== null ? prev[ei]?.name : undefined;
      presetsRef.current = list;
      setPresets(list);
      setRenamingIndex(null);
      if (ei !== null) {
        const ni = editingName !== undefined ? list.findIndex((p) => p.name === editingName) : -1;
        setEditingIndex(ni >= 0 ? ni : null);
      }
    });
  }, [appState.exportPresetManagerOpen]);

  // 목록 저장 공용 — 되돌리기 전역 스택에 한 항목(통째 스냅숏). 읽기·저장은 종전처럼 appState 위임 경유
  const commitPresets = (updated: ExportPreset[], label: string) => {
    presetsRef.current = updated;
    setPresets(updated);
    saveExportPresetsRecorded(updated, label, { ops: { exportPresets: EXPORT_PRESET_OPS } });
  };

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

  // 빠진·잘못된 필수 칸(2026-11-11 오버레이 묶음 1): 저장 버튼을 막아 두기만 하던 것을 칸 이름 안내로 바꿨다.
  const problems = exportFormProblems(form, true);

  const savePreset = () => {
    if (problems.length > 0) {
      appState.pushMessage(`다음 칸을 확인해 주세요: ${problems.join(', ')}`, 'error');
      return;
    }
    const preset = exportFormToPreset(form);
    // 다른 프리셋과 같은 이름이면 거부 — 인라인 이름 바꾸기와 같은 문구, 폼·입력은 그대로(2026-11-12 정비 M1·R5).
    // 수정 중인 자기 자신은 제외. 이미 있던 중복 이름 프리셋은 그대로 둔다(저장 때만 막음).
    const duplicate = validateName(preset.name, {
      kind: 'exportPreset',
      existing: (n) => presets.some((p, i) => i !== editingIndex && p.name === n),
    });
    if (duplicate) {
      appState.pushMessage(duplicate, 'error');
      return;
    }
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
    commitPresets(
      updated,
      editingIndex !== null ? UNDO_TEXT.exportPresetSave(preset.name) : UNDO_TEXT.exportPresetAdd(preset.name),
    );
    // 저장한 폼이 새 기준값 — 저장 뒤 닫기는 가드를 타지 않는다
    setBaseline(form);
    if (editingIndex === null) {
      setEditingIndex(updated.length - 1);
    }
    appState.pushMessage(`프리셋 "${preset.name}"이(가) 저장되었습니다`);
  };

  const deletePreset = (idx: number) => {
    const updated = presets.filter((_, i) => i !== idx);
    commitPresets(updated, UNDO_TEXT.exportPresetDelete(presets[idx]?.name ?? ''));
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
    commitPresets(updated, UNDO_TEXT.exportPresetRename(currentName ?? '', name));
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
    commitPresets(updated, UNDO_TEXT.exportPresetDuplicate(name));
    // 삽입으로 뒤쪽 인덱스가 밀리므로 편집 중 인덱스 보정
    if (editingIndex !== null && editingIndex > idx) {
      setEditingIndex(editingIndex + 1);
    }
    appState.pushMessage(`프리셋 "${name}"이(가) 복제되었습니다`);
  };

  // ── 화면 조각 ──
  // PC(2026-11-11 오버레이 묶음 1): 크기 등급 L(1000·고정 높이) — 왼쪽 aside = [새 프리셋 추가]+목록(열 전체 높이),
  // 본문 = 편집 폼(2열 격자), 바닥줄 = [저장][취소](오른쪽)·빠진 칸 안내(왼쪽). 모바일은 종전 세로 쌓기 그대로
  // (aside·바닥줄 없이 본문 한 열 — 목록 max-h-40·폼 안 버튼).
  const wide = !isMobile;

  const newPresetButton = (
    <button
      onClick={newPreset}
      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border-2 border-dashed line-color hover:border-sky-400 dark:hover:border-sky-500 text-muted hover:text-sky-500 transition-colors text-sm"
    >
      <FaPlus size={12} />
      새 프리셋 추가
    </button>
  );

  const presetRows = presets.map((p, i) => (
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
        <div className="min-w-0 text-sm font-medium text-default truncate flex items-center gap-1">
          {p.isDefault && (
            <ActionIcon
              id="quick-export"
              className="flex-none text-amber-500"
              aria-label="빠른 내보내기 기본 프리셋"
            />
          )}
          <span className="truncate">{p.name}</span>
        </div>
      )}
      <div className="flex-none flex items-center gap-0.5">
        <Tooltip content={renamingIndex === i ? '이름 변경 완료' : '이름 변경'}>
          <button
            aria-label={renamingIndex === i ? '이름 변경 완료' : '이름 변경'}
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
        </Tooltip>
        <Tooltip content="복제">
          <button
            aria-label="복제"
            onClick={(e) => { e.stopPropagation(); duplicatePreset(i); }}
            className="p-1.5 rounded text-faint hover:text-sky-500 hover:bg-sky-50 dark:hover:bg-sky-900/20 transition-colors"
          >
            <ActionIcon id="duplicate" size={11} />
          </button>
        </Tooltip>
        <Tooltip content="삭제">
          <button
            aria-label="삭제"
            onClick={(e) => { e.stopPropagation(); requestDeletePreset(i); }}
            className="p-1.5 rounded text-faint hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            <FaTrash size={11} />
          </button>
        </Tooltip>
      </div>
    </div>
  ));

  const formTitle = editingIndex !== null ? `"${presets[editingIndex]?.name}" 편집` : '새 프리셋';

  const formFields = (
    <>
      {/* 프리셋 이름 */}
      <div className="flex items-center gap-3">
        <label className="text-sm text-muted flex-none w-24">이름 *</label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="프리셋 이름"
          aria-invalid={problems.includes('이름') || undefined}
          className={
            'flex-1 min-w-0 px-3 py-1.5 rounded border bg-[var(--c-input-bg)] text-default text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 ' +
            (wide && problems.includes('이름') ? 'border-red-400 dark:border-red-500' : 'line-color')
          }
        />
      </div>

      <ExportSettingsFields form={form} setForm={setForm} twoColumn={wide} />
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
    </>
  );

  // 저장·취소 — [확인][취소] 순서(SPEC §5). 취소 = 창 닫기 요청(미저장 가드 경유, 2026-10-03 E2-4).
  // 저장 색 = .btn-solid-sky(SPEC §2 솔리드 버튼). 빠진 칸이 있으면 누를 때 칸 이름을 안내한다(비활성 대신).
  const saveButtons = (
    <>
      <button
        onClick={savePreset}
        aria-disabled={problems.length > 0 || undefined}
        className={
          'px-4 py-2 rounded-lg btn-solid-sky text-sm font-medium transition-colors' +
          (problems.length > 0 ? ' opacity-50' : '')
        }
      >
        {editingIndex !== null ? '수정 저장' : '프리셋 추가'}
      </button>
      <button
        onClick={requestClose}
        className="px-4 py-2 rounded-lg btn-neutral text-body text-sm transition-colors"
      >
        취소
      </button>
    </>
  );

  const problemHint =
    problems.length > 0 ? (
      <span className="text-xs text-red-500 dark:text-red-400" data-export-preset-problems="">
        필수 칸을 채워 주세요: {problems.join(', ')}
      </span>
    ) : null;

  if (wide) {
    return (
      <ModalOverlay
        isOpen={true}
        onClose={onClose}
        dirty={isDirty}
        title="내보내기 프리셋 관리"
        size="l"
        aside={
          <div className="flex flex-col gap-2 p-3">
            {newPresetButton}
            {presets.length === 0 ? (
              <div className="text-xs text-faint text-center py-6">저장된 프리셋이 없습니다</div>
            ) : (
              <div className="border line-color rounded-lg divide-y divide-[color:var(--c-line)] overflow-hidden">
                {presetRows}
              </div>
            )}
          </div>
        }
        footerStart={problemHint}
        footer={saveButtons}
      >
        <div className="space-y-3">
          <div className="text-sm font-medium text-gray-700 dark:text-gray-300">{formTitle}</div>
          {formFields}
        </div>
      </ModalOverlay>
    );
  }

  return (
    <ModalOverlay
      isOpen={true}
      onClose={onClose}
      dirty={isDirty}
      title="내보내기 프리셋 관리"
      // 모바일 = 90vw(옛 max-w-lg 512 와 같은 단일 열 — s 480 상한이라 휴대폰에서는 폭이 그대로)
      size="s"
    >
      <div className="flex flex-col gap-4">
        {/* 새 프리셋 버튼 */}
        {newPresetButton}

        {/* 프리셋 목록 */}
        {presets.length > 0 && (
          <div className="max-h-40 overflow-y-auto border line-color rounded-lg divide-y divide-[color:var(--c-line)]">
            {presetRows}
          </div>
        )}

        {/* 편집 폼 */}
        <div className="border line-color rounded-lg p-4 space-y-3">
          <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{formTitle}</div>
          {formFields}
          <div className="flex justify-end gap-2 pt-2">{saveButtons}</div>
          {problemHint && <div className="text-right">{problemHint}</div>}
        </div>
      </div>
    </ModalOverlay>
  );
});

export default ExportPresetManager;
