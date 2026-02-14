import * as React from 'react';
import { useContext, useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import {
  FaPlus,
  FaTrash,
  FaCopy,
  FaFont,
  FaUserAlt,
  FaCheck,
  FaTimes,
  FaEdit,
} from 'react-icons/fa';
import { v4 } from 'uuid';
import {
  CharacterPreset,
  VibeItem,
  ReferenceItem,
  ICharacterPreset,
} from '../models/types';
import {
  imageService,
} from '../models';
import { appState } from '../models/AppService';
import { FileUploadBase64 } from './UtilComponents';
import PromptEditTextArea from './PromptEditTextArea';
import { FloatView } from './FloatView';

// 바이브 이미지 컴포넌트
const VibeImage = ({
  path,
  onClick,
  className,
}: {
  path: string;
  onClick?: (e?: React.MouseEvent) => void;
  className: string;
}) => {
  const [image, setImage] = useState<string | null>(null);
  useEffect(() => {
    const fetchImage = async () => {
      const data = await imageService.fetchImageSmall(path, 400);
      setImage(data);
    };
    fetchImage();
    const handler = (e: any) => {
      if (e.detail.path === path) {
        fetchImage();
      }
    };
    imageService.addEventListener('image-cache-invalidated', handler);
    return () => {
      imageService.removeEventListener('image-cache-invalidated', handler);
    };
  }, [path]);
  return (
    <>
      {image && (
        <img
          className={className}
          src={image}
          onClick={onClick}
          draggable={false}
        />
      )}
      {!image && <div className={className} onClick={onClick}></div>}
    </>
  );
};

// 캐릭터 프리셋 에디터 내부 컴포넌트
interface CharacterPresetInnerEditorProps {
  preset: CharacterPreset;
  onSave: (preset: CharacterPreset) => void;
  onCancel: () => void;
  isNew: boolean;
}

const CharacterPresetInnerEditor = observer(({
  preset,
  onSave,
  onCancel,
  isNew,
}: CharacterPresetInnerEditorProps) => {
  const { curSession } = appState;
  const [name, setName] = useState(preset.name);
  const [characterPrompt, setCharacterPrompt] = useState(preset.characterPrompt);
  const [characterUC, setCharacterUC] = useState(preset.characterUC);
  const [backgroundPrompt, setBackgroundPrompt] = useState(preset.backgroundPrompt);
  const [vibes, setVibes] = useState<VibeItem[]>([...preset.vibes]);
  const [characterReferences, setCharacterReferences] = useState<ReferenceItem[]>([...preset.characterReferences]);
  const [isDraggingVibe, setIsDraggingVibe] = useState(false);
  const [isDraggingRef, setIsDraggingRef] = useState(false);
  // 파일명 옵션
  const [filenamePrefix, setFilenamePrefix] = useState(preset.filenamePrefix || '');
  const [filenameSuffix, setFilenameSuffix] = useState(preset.filenameSuffix || '');
  const [showFilenameOptions, setShowFilenameOptions] = useState(
    !!(preset.filenamePrefix || preset.filenameSuffix)
  );

  // 바이브 이미지 추가
  const handleVibeChange = async (vibe: string) => {
    if (!vibe) return;
    const path = await imageService.storeVibeImage(curSession!, vibe);
    const newVibe = VibeItem.fromJSON({ path: path, info: 1.0, strength: 0.6 });
    setVibes([...vibes, newVibe]);
  };

  // 캐릭터 레퍼런스 이미지 추가
  const handleReferenceChange = async (reference: string) => {
    if (!reference) return;
    const path = await imageService.storeReferenceImage(curSession!, reference);
    const newRef = ReferenceItem.fromJSON({
      path: path,
      info: 1.0,
      strength: 1.0,
      description: 'character',
    }) as ReferenceItem;
    setCharacterReferences([...characterReferences, newRef]);
  };

  // 드래그 앤 드롭 핸들러 (바이브)
  const handleVibeDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingVibe(true);
  };

  const handleVibeDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingVibe(false);
  };

  const handleVibeDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingVibe(true);
  };

  const handleVibeDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingVibe(false);

    const files = e.dataTransfer.files;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = async (event) => {
          const base64 = (event.target?.result as string)?.split(',')[1];
          if (base64) {
            await handleVibeChange(base64);
          }
        };
        reader.readAsDataURL(file);
      }
    }
  };

  // 드래그 앤 드롭 핸들러 (레퍼런스)
  const handleRefDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingRef(true);
  };

  const handleRefDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingRef(false);
  };

  const handleRefDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingRef(true);
  };

  const handleRefDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingRef(false);

    const files = e.dataTransfer.files;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = async (event) => {
          const base64 = (event.target?.result as string)?.split(',')[1];
          if (base64) {
            await handleReferenceChange(base64);
          }
        };
        reader.readAsDataURL(file);
      }
    }
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
    // 파일명 옵션 저장
    newPreset.filenamePrefix = filenamePrefix;
    newPreset.filenameSuffix = filenameSuffix;

    onSave(newPreset);
  };

  // 파일명 미리보기 생성
  const getFilenamePreview = () => {
    const parts: string[] = [];
    if (filenamePrefix) parts.push(filenamePrefix);
    parts.push('씬이름');
    if (filenameSuffix) parts.push(filenameSuffix);
    return parts.join('_') + '.png';
  };

  return (
    <div className="flex flex-col h-full p-4 overflow-hidden">
      <div className="flex-none mb-4">
        <div className="flex items-center gap-2 mb-2">
          <label className="gray-label flex-none">프리셋 이름:</label>
          <input
            className="gray-input flex-1"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="캐릭터 프리셋 이름"
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {/* 캐릭터 프롬프트 */}
        <div className="mb-4">
          <div className="gray-label mb-2">캐릭터 프롬프트:</div>
          <PromptEditTextArea
            value={characterPrompt}
            onChange={setCharacterPrompt}
            disabled={false}
          />
        </div>

        {/* 캐릭터 네거티브 프롬프트 */}
        <div className="mb-4">
          <div className="gray-label mb-2">캐릭터 네거티브 프롬프트:</div>
          <PromptEditTextArea
            value={characterUC}
            onChange={setCharacterUC}
            disabled={false}
          />
        </div>

        {/* 배경 프롬프트 */}
        <div className="mb-4">
          <div className="gray-label mb-2">배경 프롬프트:</div>
          <PromptEditTextArea
            value={backgroundPrompt}
            onChange={setBackgroundPrompt}
            disabled={false}
          />
        </div>

        {/* 바이브 트랜스퍼 */}
        <div
          className={`mb-4 p-3 border rounded-lg ${isDraggingVibe ? 'ring-2 ring-sky-500 bg-sky-50 dark:bg-sky-900/20' : 'border-gray-300'}`}
          onDragEnter={handleVibeDragEnter}
          onDragLeave={handleVibeDragLeave}
          onDragOver={handleVibeDragOver}
          onDrop={handleVibeDrop}
        >
          <div className="gray-label mb-2">바이브 트랜스퍼:</div>
          <div className="flex flex-wrap gap-2 mb-2">
            {vibes.map((vibe, index) => (
              <div key={vibe.path + index} className="relative">
                <VibeImage
                  path={imageService.getVibeImagePath(curSession!, vibe.path)}
                  className="w-20 h-20 object-cover rounded"
                />
                <button
                  className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-xs"
                  onClick={() => setVibes(vibes.filter((_, i) => i !== index))}
                >
                  <FaTimes />
                </button>
                <div className="text-xs text-center mt-1">
                  IS:{vibe.info.toFixed(1)} RS:{vibe.strength.toFixed(1)}
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2 items-center">
            <FileUploadBase64
              notext
              disabled={false}
              onFileSelect={handleVibeChange}
            />
            <span className="text-xs text-gray-500">드래그하거나 클릭하여 이미지 추가</span>
          </div>
        </div>

        {/* 캐릭터 레퍼런스 */}
        <div
          className={`mb-4 p-3 border rounded-lg ${isDraggingRef ? 'ring-2 ring-sky-500 bg-sky-50 dark:bg-sky-900/20' : 'border-gray-300'}`}
          onDragEnter={handleRefDragEnter}
          onDragLeave={handleRefDragLeave}
          onDragOver={handleRefDragOver}
          onDrop={handleRefDrop}
        >
          <div className="gray-label mb-2">캐릭터 레퍼런스:</div>
          <div className="flex flex-wrap gap-2 mb-2">
            {characterReferences.map((ref, index) => (
              <div key={ref.path + index} className="relative">
                <VibeImage
                  path={imageService.getReferenceImagePath(curSession!, ref.path)}
                  className="w-20 h-20 object-cover rounded"
                />
                <button
                  className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-xs"
                  onClick={() => setCharacterReferences(characterReferences.filter((_, i) => i !== index))}
                >
                  <FaTimes />
                </button>
                <div className="text-xs text-center mt-1">
                  IE:{ref.info.toFixed(1)} RS:{ref.strength.toFixed(1)}
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2 items-center">
            <FileUploadBase64
              notext
              disabled={false}
              onFileSelect={handleReferenceChange}
            />
            <span className="text-xs text-gray-500">드래그하거나 클릭하여 이미지 추가</span>
          </div>
        </div>

        {/* 파일명 옵션 (옵셔널 섹션) */}
        <div className="mb-4 p-3 border rounded-lg border-gray-300">
          <div
            className="flex items-center justify-between cursor-pointer"
            onClick={() => setShowFilenameOptions(!showFilenameOptions)}
          >
            <div className="gray-label">파일명 옵션 (선택사항)</div>
            <span className="text-sm text-gray-500">
              {showFilenameOptions ? '▼' : '▶'}
            </span>
          </div>
          {showFilenameOptions && (
            <div className="mt-3 space-y-3">
              <div>
                <label className="text-sm text-gray-600 dark:text-gray-400 mb-1 block">
                  파일명 접두사:
                </label>
                <input
                  type="text"
                  className="gray-input w-full"
                  value={filenamePrefix}
                  onChange={(e) => setFilenamePrefix(e.target.value)}
                  placeholder="예: 캐릭터이름"
                />
              </div>
              <div>
                <label className="text-sm text-gray-600 dark:text-gray-400 mb-1 block">
                  파일명 접미사:
                </label>
                <input
                  type="text"
                  className="gray-input w-full"
                  value={filenameSuffix}
                  onChange={(e) => setFilenameSuffix(e.target.value)}
                  placeholder="예: 표정"
                />
              </div>
              <div className="text-xs text-gray-500 bg-gray-100 dark:bg-slate-700 p-2 rounded">
                <div className="font-medium mb-1">파일명 미리보기:</div>
                <code className="text-sky-600 dark:text-sky-400">
                  {getFilenamePreview()}
                </code>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 버튼 영역 */}
      <div className="flex-none flex gap-2 mt-4">
        <button
          className="round-button back-green flex-1 h-10"
          onClick={handleSave}
        >
          <FaCheck className="mr-2" />
          {isNew ? '프리셋 추가' : '프리셋 저장'}
        </button>
        <button
          className="round-button back-gray flex-1 h-10"
          onClick={onCancel}
        >
          <FaTimes className="mr-2" />
          취소
        </button>
      </div>
    </div>
  );
});

// 캐릭터 프리셋 목록 아이템
interface CharacterPresetItemProps {
  preset: CharacterPreset;
  onEdit: () => void;
  onDelete: () => void;
  onApply: () => void;
  onDuplicate: () => void;
}

const CharacterPresetItem = observer(({
  preset,
  onEdit,
  onDelete,
  onApply,
  onDuplicate,
}: CharacterPresetItemProps) => {
  const { curSession } = appState;

  return (
    <div className="border rounded-lg p-3 mb-2 hover:bg-gray-50 dark:hover:bg-slate-700">
      <div className="flex items-center justify-between mb-2">
        <div className="font-medium text-lg">{preset.name}</div>
        <div className="flex gap-1">
          <button
            className="icon-button back-sky"
            onClick={onApply}
            title="씬에 적용"
          >
            <FaCheck />
          </button>
          <button
            className="icon-button back-green"
            onClick={onEdit}
            title="편집"
          >
            <FaEdit />
          </button>
          <button
            className="icon-button back-orange-500"
            onClick={onDuplicate}
            title="복제"
          >
            <FaCopy />
          </button>
          <button
            className="icon-button back-red"
            onClick={onDelete}
            title="삭제"
          >
            <FaTrash />
          </button>
        </div>
      </div>

      {/* 프리뷰 정보 */}
      <div className="text-sm text-gray-600 dark:text-gray-400">
        <div className="truncate mb-1">
          <span className="font-medium">캐릭터:</span> {preset.characterPrompt || '(없음)'}
        </div>
        <div className="truncate mb-1">
          <span className="font-medium">배경:</span> {preset.backgroundPrompt || '(없음)'}
        </div>
        <div className="flex gap-2">
          <span>바이브: {preset.vibes.length}개</span>
          <span>레퍼런스: {preset.characterReferences.length}개</span>
        </div>
      </div>

      {/* 이미지 프리뷰 */}
      {(preset.vibes.length > 0 || preset.characterReferences.length > 0) && (
        <div className="flex gap-2 mt-2 overflow-x-auto">
          {preset.vibes.slice(0, 3).map((vibe, i) => (
            <VibeImage
              key={vibe.path + i}
              path={imageService.getVibeImagePath(curSession!, vibe.path)}
              className="w-12 h-12 object-cover rounded flex-none"
            />
          ))}
          {preset.characterReferences.slice(0, 3).map((ref, i) => (
            <VibeImage
              key={ref.path + i}
              path={imageService.getReferenceImagePath(curSession!, ref.path)}
              className="w-12 h-12 object-cover rounded flex-none border-2 border-sky-500"
            />
          ))}
        </div>
      )}
    </div>
  );
});

// 메인 캐릭터 프리셋 에디터 컴포넌트
interface CharacterPresetEditorProps {
  onApplyPreset?: (preset: CharacterPreset) => void;
}

export const CharacterPresetEditor = observer(({
  onApplyPreset,
}: CharacterPresetEditorProps) => {
  const { curSession } = appState;
  const [editingPreset, setEditingPreset] = useState<CharacterPreset | null>(null);
  const [isNew, setIsNew] = useState(false);

  if (!curSession) {
    return <div className="p-4 text-gray-500">세션을 선택해주세요</div>;
  }

  const presets = curSession.getCharacterPresets();

  const handleAddNew = () => {
    const newPreset = new CharacterPreset();
    newPreset.name = '새 캐릭터 프리셋';
    setEditingPreset(newPreset);
    setIsNew(true);
  };

  const handleEdit = (preset: CharacterPreset) => {
    // 복사본 생성
    const copy = CharacterPreset.fromJSON(preset.toJSON());
    setEditingPreset(copy);
    setIsNew(false);
  };

  const handleSave = (preset: CharacterPreset) => {
    if (isNew) {
      curSession.addCharacterPreset(preset);
    } else {
      curSession.updateCharacterPreset(editingPreset!.name, preset);
    }
    setEditingPreset(null);
    setIsNew(false);
  };

  const handleCancel = () => {
    setEditingPreset(null);
    setIsNew(false);
  };

  const handleDelete = (preset: CharacterPreset) => {
    appState.pushDialog({
      type: 'confirm',
      text: `"${preset.name}" 프리셋을 삭제하시겠습니까?`,
      callback: () => {
        curSession.removeCharacterPreset(preset.name);
      },
    });
  };

  const handleDuplicate = (preset: CharacterPreset) => {
    const copy = CharacterPreset.fromJSON(preset.toJSON());
    copy.name = preset.name + ' 복사본';
    curSession.addCharacterPreset(copy);
  };

  const handleApply = (preset: CharacterPreset) => {
    if (onApplyPreset) {
      onApplyPreset(preset);
    } else {
      appState.pushMessage(`"${preset.name}" 프리셋이 적용되었습니다`);
    }
  };

  // 편집 모드
  if (editingPreset) {
    return (
      <CharacterPresetInnerEditor
        preset={editingPreset}
        onSave={handleSave}
        onCancel={handleCancel}
        isNew={isNew}
      />
    );
  }

  // 목록 모드
  return (
    <div className="flex flex-col h-full p-4">
      <div className="flex-none flex items-center justify-between mb-4">
        <div className="text-lg font-medium">
          <FaUserAlt className="inline mr-2" />
          캐릭터 프리셋 관리
        </div>
        <button
          className="round-button back-green h-8"
          onClick={handleAddNew}
        >
          <FaPlus className="mr-2" />
          새 프리셋
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {presets.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            <FaUserAlt className="text-4xl mx-auto mb-2 opacity-50" />
            <div>캐릭터 프리셋이 없습니다</div>
            <div className="text-sm mt-1">새 프리셋을 추가해보세요</div>
          </div>
        ) : (
          presets.map((preset) => (
            <CharacterPresetItem
              key={preset.name}
              preset={preset}
              onEdit={() => handleEdit(preset)}
              onDelete={() => handleDelete(preset)}
              onApply={() => handleApply(preset)}
              onDuplicate={() => handleDuplicate(preset)}
            />
          ))
        )}
      </div>
    </div>
  );
});

// FloatView로 감싼 캐릭터 프리셋 에디터
interface CharacterPresetFloatEditorProps {
  onClose: () => void;
  onApplyPreset?: (preset: CharacterPreset) => void;
}

export const CharacterPresetFloatEditor = observer(({
  onClose,
  onApplyPreset,
}: CharacterPresetFloatEditorProps) => {
  return (
    <FloatView priority={1} onEscape={onClose}>
      <div className="w-full h-full flex flex-col">
        <div className="flex-none flex items-center justify-between p-3 border-b">
          <div className="text-lg font-medium">캐릭터 프리셋 관리</div>
          <button
            className="icon-button back-gray"
            onClick={onClose}
          >
            <FaTimes />
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          <CharacterPresetEditor onApplyPreset={onApplyPreset} />
        </div>
      </div>
    </FloatView>
  );
});

export default CharacterPresetEditor;