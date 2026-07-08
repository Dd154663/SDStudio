import React, { useState, useEffect, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { appState, ExportPreset } from '../models/AppService';
import { isMobile, backend } from '../models';
import ModalOverlay from './ModalOverlay';
import { DropdownSelect } from './UtilComponents';
import { FaPlus, FaTrash, FaFolderOpen, FaPen, FaCopy } from 'react-icons/fa';

const menuOptions = [
  { value: 'fav' as const, label: '즐겨찾기 이미지만' },
  { value: 'all' as const, label: '모든 이미지 전부' },
];

const formatOptions = [
  { value: 'normal' as const, label: '(씬이름).(번호).png' },
  { value: 'prefix' as const, label: '(캐릭터).(씬이름).(번호)' },
  { value: 'prefix_ask' as const, label: '(캐릭터).(씬이름).(번호) - 이름 직접 입력' },
];

const filenamePatternOptions = [
  { value: 'scene' as const, label: '(씬이름) — 기본' },
  { value: 'project.scene' as const, label: '(프로젝트).(씬이름)' },
  { value: 'folder.project.scene' as const, label: '(폴더).(프로젝트).(씬이름)' },
];

const outputModeOptions = [
  { value: 'tar' as const, label: 'tar 압축파일 — 기본' },
  { value: 'files' as const, label: '개별 이미지 파일 (무압축)' },
];

const getOptOptions = () => {
  const opts: { value: 'original' | 'lossy' | 'lossless' | 'avif'; label: string }[] = [
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
  quality: number;
  separator: string;
  filenamePattern: 'scene' | 'project.scene' | 'folder.project.scene';
  outputMode: 'tar' | 'files';
  applyCharacterAffix: boolean;
  autoConvertSeparator: boolean;
  isDefault: boolean;
  targetFolder: string;
  useProjectRelativePath: boolean;
}

const emptyForm = (): FormState => ({
  name: '',
  menu: undefined,
  format: undefined,
  prefix: '',
  opt: undefined,
  imageSize: 1024,
  quality: 80,
  separator: '',
  filenamePattern: 'scene',
  outputMode: 'tar',
  applyCharacterAffix: true,
  autoConvertSeparator: false,
  isDefault: false,
  targetFolder: '',
  useProjectRelativePath: false,
});

const presetToForm = (p: ExportPreset): FormState => ({
  name: p.name,
  menu: p.menu,
  format: p.format,
  prefix: p.prefix,
  opt: p.opt,
  imageSize: p.imageSize,
  quality: p.quality ?? 80,
  separator: p.separator,
  filenamePattern: p.filenamePattern ?? 'scene',
  outputMode: p.outputMode ?? 'tar',
  applyCharacterAffix: p.applyCharacterAffix !== false,
  autoConvertSeparator: p.autoConvertSeparator === true,
  isDefault: p.isDefault ?? false,
  targetFolder: p.targetFolder ?? '',
  useProjectRelativePath: p.useProjectRelativePath ?? false,
});

const ExportPresetManager = observer(() => {
  const [presets, setPresets] = useState<ExportPreset[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [renamingIndex, setRenamingIndex] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
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

  const selectTargetFolder = async () => {
    const folder = await backend.selectDir();
    if (!folder) return;
    setForm((f) => ({ ...f, targetFolder: folder }));
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
      // 화질은 lossy/avif 만 의미. 유효(1~100)할 때만 저장, 그 외엔 미설정(기본값 사용).
      quality:
        (form.opt === 'lossy' || form.opt === 'avif') &&
        form.quality >= 1 &&
        form.quality <= 100
          ? form.quality
          : undefined,
      separator: form.separator,
      filenamePattern: form.filenamePattern,
      outputMode: form.outputMode,
      applyCharacterAffix: form.applyCharacterAffix,
      autoConvertSeparator: form.autoConvertSeparator,
      isDefault: form.isDefault,
      targetFolder: form.targetFolder,
      useProjectRelativePath: form.useProjectRelativePath,
    };
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

          {/* 이미지 범위 */}
          <div className="flex items-center gap-3">
            <label className="text-sm text-muted flex-none w-24">이미지 범위 *</label>
            <div className="flex-1 min-w-0">
              <DropdownSelect
                selectedOption={form.menu}
                options={menuOptions}
                onSelect={(o: any) => setForm({ ...form, menu: o.value })}
              />
            </div>
          </div>

          {/* 파일명 형식 */}
          <div className="flex items-center gap-3">
            <label className="text-sm text-muted flex-none w-24">파일명 형식 *</label>
            <div className="flex-1 min-w-0">
              <DropdownSelect
                selectedOption={form.format}
                options={formatOptions}
                onSelect={(o: any) => setForm({ ...form, format: o.value })}
              />
            </div>
          </div>

          {/* 파일명 패턴 (프로젝트/폴더 접두) */}
          <div className="flex items-center gap-3">
            <label className="text-sm text-muted flex-none w-24">파일명 패턴</label>
            <div className="flex-1 min-w-0">
              <DropdownSelect
                selectedOption={form.filenamePattern}
                options={filenamePatternOptions}
                onSelect={(o: any) => setForm({ ...form, filenamePattern: o.value })}
              />
            </div>
          </div>

          {/* 출력 형태 (tar / 개별 파일) */}
          <div className="flex items-center gap-3">
            <label className="text-sm text-muted flex-none w-24">출력 형태</label>
            <div className="flex-1 min-w-0">
              <DropdownSelect
                selectedOption={form.outputMode}
                options={outputModeOptions}
                onSelect={(o: any) => setForm({ ...form, outputMode: o.value })}
              />
            </div>
          </div>

          {/* 캐릭터 이름 (format=prefix 시) */}
          {form.format === 'prefix' && (
            <div className="flex items-center gap-3">
              <label className="text-sm text-muted flex-none w-24">캐릭터 이름 *</label>
              <input
                type="text"
                value={form.prefix}
                onChange={(e) => setForm({ ...form, prefix: e.target.value })}
                placeholder="캐릭터 이름"
                className="flex-1 min-w-0 px-3 py-1.5 rounded border line-color bg-[var(--c-input-bg)] text-default text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
              />
            </div>
          )}

          {/* 캐릭터 프리셋 접두/접미사 적용 토글 */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.applyCharacterAffix}
              onChange={(e) => setForm({ ...form, applyCharacterAffix: e.target.checked })}
              className="w-4 h-4 accent-sky-500"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              캐릭터 프리셋 접두사/접미사 적용
            </span>
          </label>

          {/* 최적화 방법 */}
          <div className="flex items-center gap-3">
            <label className="text-sm text-muted flex-none w-24">최적화 *</label>
            <div className="flex-1 min-w-0">
              <DropdownSelect
                selectedOption={form.opt}
                options={optOptions}
                onSelect={(o: any) => setForm({ ...form, opt: o.value })}
              />
            </div>
          </div>

          {/* 이미지 크기 (opt≠original 시) */}
          {form.opt !== undefined && form.opt !== 'original' && (
            <div className="flex items-center gap-3">
              <label className="text-sm text-muted flex-none w-24">이미지 크기 *</label>
              <input
                type="number"
                value={form.imageSize}
                onChange={(e) => setForm({ ...form, imageSize: parseInt(e.target.value) || 0 })}
                placeholder="1024"
                className="flex-1 min-w-0 px-3 py-1.5 rounded border line-color bg-[var(--c-input-bg)] text-default text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
              />
              <span className="text-xs text-faint">px</span>
            </div>
          )}

          {/* 압축 화질 (lossy/avif 시) — 픽셀 크기와 별개 축(해상도 vs 압축 강도) */}
          {(form.opt === 'lossy' || form.opt === 'avif') && (
            <div className="flex items-center gap-3">
              <label className="text-sm text-muted flex-none w-24">화질</label>
              <input
                type="number"
                min={1}
                max={100}
                value={form.quality}
                onChange={(e) =>
                  setForm({ ...form, quality: parseInt(e.target.value) || 0 })
                }
                placeholder={form.opt === 'avif' ? '50' : '80'}
                className="flex-1 min-w-0 px-3 py-1.5 rounded border line-color bg-[var(--c-input-bg)] text-default text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
              />
              <span className="text-xs text-faint">1~100</span>
            </div>
          )}

          {/* 구분자 — 텍스트 입력, 빈 칸 허용 */}
          <div className="flex items-center gap-3">
            <label className="text-sm text-muted flex-none w-24">파일명 구분자</label>
            <input
              type="text"
              value={form.separator}
              onChange={(e) => setForm({ ...form, separator: e.target.value })}
              placeholder="비워두면 구분자 없음"
              className="flex-1 px-3 py-1.5 rounded border line-color bg-[var(--c-input-bg)] text-default text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
            />
          </div>

          {/* 구분자 자동 변환 (특수문자 묻지 않음) */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.autoConvertSeparator}
              onChange={(e) => setForm({ ...form, autoConvertSeparator: e.target.checked })}
              className="w-4 h-4 accent-sky-500"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              특수문자 묻지 않고 구분자로 자동 변환
            </span>
          </label>

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

          {/* 목표 폴더 (데스크톱 전용 — 모바일은 임의 폴더 저장 미지원) */}
          {!isMobile && (
            <div className="space-y-2 border-t line-color pt-3">
              <div className="text-xs text-muted">
                내보내기 목표 폴더 (비우면 환경설정의 기본 폴더 사용)
              </div>
              <div className="text-sm text-body bg-gray-100 dark:bg-slate-700 rounded px-3 py-2 break-all">
                {form.targetFolder || '미설정'}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={selectTargetFolder}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded border line-color text-sm text-body hover:bg-gray-50 dark:hover:bg-slate-600 transition-colors"
                >
                  <FaFolderOpen size={12} />
                  폴더 선택
                </button>
                {form.targetFolder && (
                  <button
                    onClick={() => setForm({ ...form, targetFolder: '' })}
                    className="px-3 py-1.5 rounded border line-color text-sm text-muted hover:bg-gray-50 dark:hover:bg-slate-600 transition-colors"
                  >
                    지우기
                  </button>
                )}
              </div>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={form.useProjectRelativePath}
                  onChange={(e) => setForm({ ...form, useProjectRelativePath: e.target.checked })}
                  className="w-4 h-4 accent-sky-500"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  프로젝트 폴더 경로로 하위 폴더 생성
                </span>
              </label>
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
