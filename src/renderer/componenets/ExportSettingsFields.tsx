import React from 'react';
import { isMobile, backend } from '../models';
import { buildImageOptimizeOptions } from '../models/platform';
import { ExportFormState } from '../models/exportSettings';
import { DropdownSelect } from './UtilComponents';
import { FaFolderOpen } from 'react-icons/fa';
const menuOptions = [
  { value: 'fav' as const, label: '즐겨찾기 이미지만' },
  { value: 'all' as const, label: '모든 이미지 전부' },
];

const formatOptions = [
  { value: 'normal' as const, label: '(씬이름).(번호).(원본 확장자)' },
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

export default function ExportSettingsFields({ form, setForm, direct = false }: {
  form: ExportFormState;
  setForm: React.Dispatch<React.SetStateAction<ExportFormState>>;
  direct?: boolean;
}) {
  const optOptions = buildImageOptimizeOptions().map(({ text, value }) => ({ label: text, value }));
  const selectTargetFolder = async () => {
    const folder = await backend.selectDir();
    if (folder) setForm((current) => ({ ...current, targetFolder: folder }));
  };
  return <div className="space-y-3">
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
                options={direct ? formatOptions.filter((option) => option.value !== 'prefix_ask') : formatOptions}
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
              checked={!!form.applyCharacterAffix}
              onChange={(e) => setForm({ ...form, applyCharacterAffix: e.target.checked })}
              className="w-4 h-4 accent-sky-500"
            />
            <span className="text-sm text-default">
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
                onChange={(e) => setForm({ ...form, imageSize: Number(e.target.value) })}
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
                  setForm({ ...form, quality: e.target.value === '' ? '' : Number(e.target.value) })
                }
                placeholder={form.opt === 'avif' ? '50' : '80'}
                className="flex-1 min-w-0 px-3 py-1.5 rounded border line-color bg-[var(--c-input-bg)] text-default text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
              />
              <span className="text-xs text-faint">1~100</span>
            </div>
          )}

          {/* NAI 스테가노그래피 보존 (webp: lossy/lossless 시) */}
          {(form.opt === 'lossy' || form.opt === 'lossless') && (
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={!!form.preserveStealth}
                onChange={(e) => setForm({ ...form, preserveStealth: e.target.checked })}
                className="w-4 h-4 accent-sky-500"
              />
              <span className="text-sm text-default">
                NAI 스테가노그래피 보존 (NAI 인스펙터 인식 유지, 처리 느려짐)
              </span>
            </label>
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
              checked={!!form.autoConvertSeparator}
              onChange={(e) => setForm({ ...form, autoConvertSeparator: e.target.checked })}
              className="w-4 h-4 accent-sky-500"
            />
            <span className="text-sm text-default">
              특수문자 묻지 않고 구분자로 자동 변환
            </span>
          </label>

          {/* 목표 폴더 (데스크톱 전용 — 모바일은 임의 폴더 저장 미지원) */}
          {!isMobile && (
            <div className="space-y-2 border-t line-color pt-3">
              <div className="text-xs text-muted">
                내보내기 목표 폴더 (비우면 환경설정 기본 폴더, 둘 다 없으면 다운로드 폴더 사용)
              </div>
              <div className="text-sm text-body bg-[var(--c-surface-2)] rounded px-3 py-2 break-all">
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
                  checked={!!form.useProjectRelativePath}
                  onChange={(e) => setForm({ ...form, useProjectRelativePath: e.target.checked })}
                  className="w-4 h-4 accent-sky-500"
                />
                <span className="text-sm text-default">
                  프로젝트 폴더 경로로 하위 폴더 생성
                </span>
              </label>
            </div>
          )}

    {form.opt !== 'original' && <div className="flex items-center gap-3">
      <label className="text-sm text-muted flex-none w-24">재최적화</label>
      <div className="flex-1 min-w-0"><DropdownSelect selectedOption={form.reoptimize}
        options={[
          { value: 'skip', label: '이미 최적화된 이미지는 원본 유지' },
          { value: 'all', label: '모두 다시 최적화' },
          ...(!direct ? [{ value: 'ask', label: '실행할 때 확인' }] : []),
        ]} onSelect={(option: any) => setForm({ ...form, reoptimize: option.value })} /></div>
    </div>}
  </div>;
}