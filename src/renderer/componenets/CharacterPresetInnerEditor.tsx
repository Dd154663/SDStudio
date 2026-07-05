import * as React from 'react';
import { useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import {
  FaArrowLeft,
  FaCheck,
  FaToggleOff,
  FaToggleOn,
  FaTrash,
  FaUserAlt,
} from 'react-icons/fa';
import Tooltip from './Tooltip';
import { CharacterPreset, ReferenceItem, VibeItem } from '../models/types';
import { appState } from '../models/AppService';
import { FileUploadBase64 } from './UtilComponents';
import PromptEditTextArea from './PromptEditTextArea';
import { getRefDefaults } from './CharacterReferenceEditor';
import { EditableSliderValue } from './VibeEditor';
import { PresetImageBackend, VibeImage } from './CharacterPresetCards';

// CharacterPresetEditor.tsx 에서 분리된 프리셋 편집 폼.
// ─── 편집 폼 ─────────────────────────────────────────────────
interface CharacterPresetInnerEditorProps {
  preset: CharacterPreset;
  onSave: (preset: CharacterPreset) => void;
  onCancel: () => void;
  isNew: boolean;
  imageBackend: PresetImageBackend;
}

export const CharacterPresetInnerEditor = observer(({
  preset,
  onSave,
  onCancel,
  isNew,
  imageBackend,
}: CharacterPresetInnerEditorProps) => {
  const [name, setName] = useState(preset.name);
  const [characterPrompt, setCharacterPrompt] = useState(preset.characterPrompt);
  const [characterUC, setCharacterUC] = useState(preset.characterUC);
  const [backgroundPrompt] = useState(preset.backgroundPrompt);
  const [vibes, setVibes] = useState<VibeItem[]>([...preset.vibes]);
  const [characterReferences, setCharacterReferences] = useState<ReferenceItem[]>([...preset.characterReferences]);
  const [isDraggingVibe, setIsDraggingVibe] = useState(false);
  const [isDraggingRef, setIsDraggingRef] = useState(false);
  const [representativeImage, setRepresentativeImage] = useState(preset.representativeImage || '');
  // 파일명 옵션
  const [filenamePrefix, setFilenamePrefix] = useState(preset.filenamePrefix || '');
  const [filenameSuffix, setFilenameSuffix] = useState(preset.filenameSuffix || '');
  const [showFilenameOptions, setShowFilenameOptions] = useState(
    !!(preset.filenamePrefix || preset.filenameSuffix)
  );
  // 대표 이미지 선택 모드
  const [showRepImagePicker, setShowRepImagePicker] = useState(false);

  // 바이브 이미지 추가
  const handleVibeChange = async (vibe: string) => {
    if (!vibe) return;
    const path = await imageBackend.storeVibe(vibe);
    const newVibe = VibeItem.fromJSON({ path: path, info: 1.0, strength: 0.6 });
    setVibes((prev) => [...prev, newVibe]);
  };

  // 캐릭터 레퍼런스 이미지 추가
  const handleReferenceChange = async (reference: string) => {
    if (!reference) return;
    const path = await imageBackend.storeReference(reference);
    const defaults = getRefDefaults();
    const newRef = ReferenceItem.fromJSON({
      path: path,
      info: 1.0,
      strength: defaults.strength,
      fidelity: defaults.fidelity,
      referenceType: defaults.referenceType,
    }) as ReferenceItem;
    setCharacterReferences((prev) => [...prev, newRef]);
  };

  // 드래그 핸들러 (바이브)
  const handleVibeDragEnter = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDraggingVibe(true); };
  const handleVibeDragLeave = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDraggingVibe(false); };
  const handleVibeDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDraggingVibe(true); };
  const handleVibeDrop = async (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setIsDraggingVibe(false);
    const files = e.dataTransfer.files;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = async (event) => {
          const base64 = (event.target?.result as string)?.split(',')[1];
          if (base64) await handleVibeChange(base64);
        };
        reader.readAsDataURL(file);
      }
    }
  };

  // 드래그 핸들러 (레퍼런스)
  const handleRefDragEnter = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDraggingRef(true); };
  const handleRefDragLeave = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDraggingRef(false); };
  const handleRefDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDraggingRef(true); };
  const handleRefDrop = async (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setIsDraggingRef(false);
    const files = e.dataTransfer.files;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = async (event) => {
          const base64 = (event.target?.result as string)?.split(',')[1];
          if (base64) await handleReferenceChange(base64);
        };
        reader.readAsDataURL(file);
      }
    }
  };

  // 대표 이미지 업로드
  const handleRepImageUpload = async (base64: string) => {
    if (!base64) return;
    const path = await imageBackend.storeVibe(base64);
    setRepresentativeImage(path);
  };

  // 바이브 슬라이더 업데이트
  const updateVibeField = (index: number, field: 'info' | 'strength', value: number) => {
    setVibes((prev) => {
      const updated = [...prev];
      const vibe = VibeItem.fromJSON(updated[index].toJSON());
      vibe[field] = value;
      updated[index] = vibe;
      return updated;
    });
  };

  // 레퍼런스 슬라이더 업데이트
  const updateRefField = (index: number, field: string, value: any) => {
    setCharacterReferences((prev) => {
      const updated = [...prev];
      const ref = ReferenceItem.fromJSON(updated[index].toJSON());
      (ref as any)[field] = value;
      updated[index] = ref;
      return updated;
    });
  };

  // 저장 핸들러
  const handleSave = () => {
    if (!name.trim()) {
      appState.pushMessage('프리셋 이름을 입력해주세요');
      return;
    }
    const newPreset = new CharacterPreset();
    newPreset.name = name;
    newPreset.characterPrompt = characterPrompt;
    newPreset.characterUC = characterUC;
    newPreset.backgroundPrompt = backgroundPrompt;
    newPreset.vibes = vibes;
    newPreset.characterReferences = characterReferences;
    newPreset.filenamePrefix = filenamePrefix;
    newPreset.filenameSuffix = filenameSuffix;
    newPreset.representativeImage = representativeImage;
    onSave(newPreset);
  };

  // 파일명 미리보기
  const getFilenamePreview = () => {
    const parts: string[] = [];
    if (filenamePrefix) parts.push(filenamePrefix);
    parts.push('씬이름');
    if (filenameSuffix) parts.push(filenameSuffix);
    return parts.join('_') + '.png';
  };

  // 바이브/레퍼런스에서 대표 이미지 선택 가능한 이미지 목록
  const selectableImages = useMemo(() => {
    const images: { path: string; type: 'vibe' | 'reference' }[] = [];
    vibes.forEach((v) => images.push({ path: v.path, type: 'vibe' }));
    characterReferences.forEach((r) => images.push({ path: r.path, type: 'reference' }));
    return images;
  }, [vibes, characterReferences]);

  return (
    <div className="flex flex-col text-default">
      {/* 상단 바 — 돌아가기만 */}
      <div className="flex items-center mb-4">
        <button
          className="flex items-center gap-1.5 text-sm text-muted hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
          onClick={onCancel}
        >
          <FaArrowLeft size={12} />
          돌아가기
        </button>
      </div>

      {/* 프리셋 이름 */}
      <div className="mb-4">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block">프리셋 이름 *</label>
        <input
          className="w-full px-3 py-2 rounded-lg border line-color bg-[var(--c-input-bg)] text-default text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="캐릭터 프리셋 이름"
        />
      </div>

      {/* 대표 이미지 */}
      <div className="mb-4 p-3 border line-color rounded-lg">
        <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">대표 이미지</div>
        <div className="flex items-start gap-3">
          {representativeImage ? (
            <VibeImage
              path={imageBackend.vibePath(representativeImage)}
              className="w-20 h-20 object-cover rounded-lg flex-none"
            />
          ) : (
            <div className="w-20 h-20 flex items-center justify-center bg-[var(--c-surface)] rounded-lg flex-none border border-dashed line-color">
              <FaUserAlt className="text-faint" />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <FileUploadBase64
              notext
              disabled={false}
              onFileSelect={handleRepImageUpload}
            />
            {selectableImages.length > 0 && (
              <button
                className="text-xs text-sky-500 hover:text-sky-600 dark:text-sky-400 dark:hover:text-sky-300 text-left"
                onClick={() => setShowRepImagePicker(!showRepImagePicker)}
              >
                {showRepImagePicker ? '선택 닫기 ▲' : '바이브/레퍼런스에서 선택 ▼'}
              </button>
            )}
            {representativeImage && (
              <button
                className="text-xs text-red-500 hover:text-red-600 text-left"
                onClick={() => setRepresentativeImage('')}
              >
                삭제
              </button>
            )}
          </div>
        </div>
        {/* 바이브/레퍼런스 이미지 선택기 */}
        {showRepImagePicker && selectableImages.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2 p-2 bg-[var(--c-surface)] rounded-lg">
            {selectableImages.map((item, i) => (
              <div
                key={item.path + i}
                className={`relative cursor-pointer rounded-lg overflow-hidden border-2 transition-colors ${
                  representativeImage === item.path
                    ? 'border-sky-500'
                    : 'border-transparent hover:border-gray-400'
                }`}
                onClick={() => { setRepresentativeImage(item.path); setShowRepImagePicker(false); }}
              >
                <VibeImage
                  path={
                    item.type === 'vibe'
                      ? imageBackend.vibePath(item.path)
                      : imageBackend.referencePath(item.path)
                  }
                  className="w-14 h-14 object-cover"
                />
                {representativeImage === item.path && (
                  <div className="absolute inset-0 bg-sky-500/30 flex items-center justify-center">
                    <FaCheck className="text-white drop-shadow" />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 캐릭터 프롬프트 */}
      <div className="mb-4">
        <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">캐릭터 프롬프트</div>
        <PromptEditTextArea
          value={characterPrompt}
          onChange={setCharacterPrompt}
          disabled={false}
        />
      </div>

      {/* 캐릭터 네거티브 프롬프트 */}
      <div className="mb-4">
        <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">캐릭터 네거티브 프롬프트</div>
        <PromptEditTextArea
          value={characterUC}
          onChange={setCharacterUC}
          disabled={false}
        />
      </div>

      {/* 배경 프롬프트 - 레거시 (읽기 전용) */}
      {backgroundPrompt && (
        <div className="mb-4 p-3 border rounded-lg border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/20">
          <div className="text-sm font-medium text-amber-600 dark:text-amber-400 mb-1">
            Legacy: 배경 프롬프트
          </div>
          <div className="text-sm text-muted bg-[var(--c-surface)] p-2 rounded font-mono whitespace-pre-wrap break-all">
            {backgroundPrompt}
          </div>
          <div className="text-xs text-amber-600 dark:text-amber-400 mt-1">
            이 필드는 더 이상 편집할 수 없습니다. 이지모드 적용 시에만 기존 값이 사용됩니다.
          </div>
        </div>
      )}

      {/* 바이브 트랜스퍼 */}
      <div
        className={`mb-4 p-3 border rounded-lg transition-colors ${isDraggingVibe ? 'ring-2 ring-sky-500 bg-sky-50 dark:bg-sky-900/20 border-sky-400' : 'line-color'}`}
        onDragEnter={handleVibeDragEnter}
        onDragLeave={handleVibeDragLeave}
        onDragOver={handleVibeDragOver}
        onDrop={handleVibeDrop}
      >
        <div className="mb-2">
          <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">바이브 트랜스퍼</div>
          <FileUploadBase64
            notext
            disabled={false}
            onFileSelect={handleVibeChange}
          />
        </div>
        {vibes.length === 0 && (
          <div className="text-center py-4 text-sm text-faint">
            드래그하거나 클릭하여 이미지 추가
          </div>
        )}
        {vibes.map((vibe, index) => (
          <div key={vibe.path + index} className="border line-color mt-2 p-2 flex md:flex-row flex-col gap-2 items-start rounded-lg">
            <VibeImage
              path={imageBackend.vibePath(vibe.path)}
              className="flex-none w-28 h-28 object-cover rounded"
            />
            <div className="flex flex-col gap-2 w-full min-w-0">
              <div className="flex w-full items-center md:flex-row flex-col">
                <div className="whitespace-nowrap flex-none mr-auto md:mr-2 gray-label">정보 추출률 (IS):</div>
                <div className="flex flex-1 md:w-auto w-full gap-1">
                  <input className="flex-1 min-w-0" type="range" step="0.01" min="0" max="1"
                    value={vibe.info}
                    onChange={(e) => updateVibeField(index, 'info', parseFloat(e.target.value))}
                  />
                  <EditableSliderValue value={vibe.info} min={0} max={1} onChange={(v) => updateVibeField(index, 'info', v)} />
                </div>
              </div>
              <div className="flex w-full items-center md:flex-row flex-col">
                <div className="whitespace-nowrap flex-none mr-auto md:mr-2 gray-label">레퍼런스 강도 (RS):</div>
                <div className="flex flex-1 md:w-auto w-full gap-1">
                  <input className="flex-1 min-w-0" type="range" step="0.01" min="0" max="1"
                    value={vibe.strength}
                    onChange={(e) => updateVibeField(index, 'strength', parseFloat(e.target.value))}
                  />
                  <EditableSliderValue value={vibe.strength} min={0} max={1} onChange={(v) => updateVibeField(index, 'strength', v)} />
                </div>
              </div>
              <div className="flex justify-end mt-auto">
                <Tooltip content="바이브 삭제">
                  <button
                    className="round-button h-8 px-6 back-red"
                    onClick={() => {
                      if (representativeImage === vibe.path) setRepresentativeImage('');
                      setVibes(vibes.filter((_, i) => i !== index));
                    }}
                  >
                    <FaTrash />
                  </button>
                </Tooltip>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 캐릭터 레퍼런스 */}
      <div
        className={`mb-4 p-3 border rounded-lg transition-colors ${isDraggingRef ? 'ring-2 ring-sky-500 bg-sky-50 dark:bg-sky-900/20 border-sky-400' : 'line-color'}`}
        onDragEnter={handleRefDragEnter}
        onDragLeave={handleRefDragLeave}
        onDragOver={handleRefDragOver}
        onDrop={handleRefDrop}
      >
        <div className="mb-2">
          <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">캐릭터 레퍼런스</div>
          <FileUploadBase64
            notext
            disabled={false}
            onFileSelect={handleReferenceChange}
          />
        </div>
        {characterReferences.length === 0 && (
          <div className="text-center py-4 text-sm text-faint">
            드래그하거나 클릭하여 이미지 추가
          </div>
        )}
        {characterReferences.map((ref, index) => (
          <div
            key={ref.path + index}
            className={`mt-2 p-2 flex md:flex-row flex-col gap-2 items-start rounded-lg ${
              ref.enabled !== false
                ? 'border border-sky-500 bg-[var(--c-surface-2)]'
                : 'border line-color opacity-60'
            }`}
          >
            <VibeImage
              path={imageBackend.referencePath(ref.path)}
              className="flex-none w-28 h-28 object-cover rounded"
            />
            <div className="flex flex-col gap-2 w-full min-w-0">
              {/* 활성화 토글 + 삭제 */}
              <div className="flex items-center justify-between">
                <button
                  className={`text-sm px-3 py-1 rounded flex items-center gap-1 transition-colors ${
                    ref.enabled !== false
                      ? 'bg-sky-500 text-white'
                      : 'bg-gray-200 dark:bg-slate-600 text-muted'
                  }`}
                  onClick={() => updateRefField(index, 'enabled', ref.enabled === false)}
                >
                  {ref.enabled !== false ? <FaToggleOn size={13} /> : <FaToggleOff size={13} />}
                  {ref.enabled !== false ? '활성화됨' : '비활성화됨'}
                </button>
                <Tooltip content="레퍼런스 삭제">
                  <button
                    className="round-button h-8 px-6 back-red"
                    onClick={() => {
                      if (representativeImage === ref.path) setRepresentativeImage('');
                      setCharacterReferences(characterReferences.filter((_, i) => i !== index));
                    }}
                  >
                    <FaTrash />
                  </button>
                </Tooltip>
              </div>
              {/* Strength */}
              <div className="flex w-full items-center md:flex-row flex-col">
                <div className="whitespace-nowrap flex-none mr-auto md:mr-2 gray-label">Strength:</div>
                <div className="flex flex-1 md:w-auto w-full gap-1">
                  <input className="flex-1 min-w-0" type="range" step="0.01" min="0" max="2"
                    value={ref.strength}
                    onChange={(e) => updateRefField(index, 'strength', parseFloat(e.target.value))}
                  />
                  <EditableSliderValue value={ref.strength} min={0} max={2} onChange={(v) => updateRefField(index, 'strength', v)} />
                </div>
              </div>
              {/* Fidelity */}
              <div className="flex w-full items-center md:flex-row flex-col">
                <div className="whitespace-nowrap flex-none mr-auto md:mr-2 gray-label">Fidelity:</div>
                <div className="flex flex-1 md:w-auto w-full gap-1">
                  <input className="flex-1 min-w-0" type="range" step="0.01" min="0" max="2"
                    value={ref.fidelity}
                    onChange={(e) => updateRefField(index, 'fidelity', parseFloat(e.target.value))}
                  />
                  <EditableSliderValue value={ref.fidelity} min={0} max={2} onChange={(v) => updateRefField(index, 'fidelity', v)} />
                </div>
              </div>
              {/* 레퍼런스 타입 */}
              <div className="flex items-center gap-4 flex-wrap">
                {(['character', 'style', 'character&style'] as const).map((t) => (
                  <label key={t} className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio"
                      name={`refType-edit-${index}`}
                      checked={ref.referenceType === t}
                      onChange={() => updateRefField(index, 'referenceType', t)}
                      className="accent-sky-500"
                    />
                    <span className="gray-label">
                      {t === 'character' ? '캐릭터' : t === 'style' ? '스타일' : '캐릭터+스타일'}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 파일명 옵션 (옵셔널 섹션) */}
      <div className="mb-4 p-3 border line-color rounded-lg">
        <div
          className="flex items-center justify-between cursor-pointer"
          onClick={() => setShowFilenameOptions(!showFilenameOptions)}
        >
          <div className="text-sm font-medium text-gray-700 dark:text-gray-300">파일명 옵션 (선택사항)</div>
          <span className="text-sm text-muted">
            {showFilenameOptions ? '▼' : '▶'}
          </span>
        </div>
        {showFilenameOptions && (
          <div className="mt-3 space-y-3">
            <div>
              <label className="text-sm text-muted mb-1 block">파일명 접두사:</label>
              <input
                type="text"
                className="w-full px-3 py-1.5 rounded border line-color bg-[var(--c-input-bg)] text-default text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
                value={filenamePrefix}
                onChange={(e) => setFilenamePrefix(e.target.value)}
                placeholder="예: 캐릭터이름"
              />
            </div>
            <div>
              <label className="text-sm text-muted mb-1 block">파일명 접미사:</label>
              <input
                type="text"
                className="w-full px-3 py-1.5 rounded border line-color bg-[var(--c-input-bg)] text-default text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
                value={filenameSuffix}
                onChange={(e) => setFilenameSuffix(e.target.value)}
                placeholder="예: 표정"
              />
            </div>
            <div className="text-xs text-muted bg-[var(--c-surface)] p-2 rounded">
              <div className="font-medium mb-1">파일명 미리보기:</div>
              <code className="text-sky-600 dark:text-sky-400">
                {getFilenamePreview()}
              </code>
            </div>
          </div>
        )}
      </div>

      {/* 하단 저장 버튼 */}
      <div className="flex gap-2 pt-2 border-t line-color">
        <button
          className="flex-1 px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium transition-colors"
          onClick={handleSave}
        >
          <FaCheck className="inline mr-1.5" size={11} />
          {isNew ? '프리셋 추가' : '프리셋 저장'}
        </button>
        <button
          className="flex-1 px-4 py-2 rounded-lg btn-neutral text-body text-sm transition-colors"
          onClick={onCancel}
        >
          취소
        </button>
      </div>
    </div>
  );
});
