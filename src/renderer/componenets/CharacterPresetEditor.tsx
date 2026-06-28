import * as React from 'react';
import { useEffect, useState, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import Tooltip from './Tooltip';
import {
  FaPlus,
  FaTrash,
  FaCopy,
  FaFont,
  FaUserAlt,
  FaCheck,
  FaTimes,
  FaEdit,
  FaArrowLeft,
  FaToggleOn,
  FaToggleOff,
} from 'react-icons/fa';
import {
  CharacterPreset,
  VibeItem,
  ReferenceItem,
  ICharacterPreset,
} from '../models/types';
import {
  imageService,
  cyclingSessionService,
  taskQueueService,
  backend,
  isMobile,
  globalCharacterPresetService,
} from '../models';
import { appState } from '../models/AppService';
import { FaPlay, FaPause, FaStop, FaSync, FaDownload, FaUpload, FaGlobe, FaUsers, FaCloudUploadAlt, FaCloudDownloadAlt } from 'react-icons/fa';
import type { IGlobalCharacterPresetEntry } from '../models/GlobalCharacterPresetService';
import { FileUploadBase64 } from './UtilComponents';
import PromptEditTextArea from './PromptEditTextArea';
import ModalOverlay from './ModalOverlay';
import { useDrag, useDrop } from 'react-dnd';
import { getRefDefaults, EditableSliderValue } from './PreSetEdtior';

// 프리셋 편집기의 이미지 저장/표시 백엔드 (로컬=세션 디렉터리, 글로벌=글로벌 디렉터리)
export interface PresetImageBackend {
  storeVibe: (base64: string) => Promise<string>;
  storeReference: (base64: string) => Promise<string>;
  vibePath: (token: string) => string;
  referencePath: (token: string) => string;
}

const makeSessionImageBackend = (session: any): PresetImageBackend => ({
  storeVibe: (b) => imageService.storeVibeImage(session, b),
  storeReference: (b) => imageService.storeReferenceImage(session, b),
  vibePath: (t) => imageService.getVibeImagePath(session, t),
  referencePath: (t) => imageService.getReferenceImagePath(session, t),
});

const globalImageBackend: PresetImageBackend = {
  storeVibe: (b) => globalCharacterPresetService.storeVibeForEditor(b),
  storeReference: (b) => globalCharacterPresetService.storeReferenceForEditor(b),
  vibePath: (t) => globalCharacterPresetService.getImagePath(t),
  referencePath: (t) => globalCharacterPresetService.getImagePath(t),
};

// ─── 바이브 이미지 컴포넌트 ────────────────────────────────────
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
      {!image && (
        <div
          className={className + ' flex items-center justify-center bg-gray-200 dark:bg-gray-700 border border-gray-300 dark:border-gray-600'}
          onClick={onClick}
        >
          <span className="text-xs text-muted text-center px-1 select-none">
            NO IMAGE
          </span>
        </div>
      )}
    </>
  );
};

// ─── 카드용 대표 이미지 (폴백 체인) ────────────────────────────
const CardImage = observer(({
  preset,
  className,
}: {
  preset: CharacterPreset;
  className: string;
}) => {
  const { curSession } = appState;
  const imagePath = useMemo(() => {
    if (!curSession) return null;
    // 1. 직접 설정한 대표 이미지
    if (preset.representativeImage) {
      return imageService.getVibeImagePath(curSession, preset.representativeImage);
    }
    // 2. 첫 번째 캐릭터 레퍼런스
    if (preset.characterReferences.length > 0) {
      return imageService.getReferenceImagePath(curSession, preset.characterReferences[0].path);
    }
    // 3. 첫 번째 바이브
    if (preset.vibes.length > 0) {
      return imageService.getVibeImagePath(curSession, preset.vibes[0].path);
    }
    return null;
  }, [curSession, preset.representativeImage, preset.characterReferences.length, preset.vibes.length]);

  if (imagePath) {
    return <VibeImage path={imagePath} className={className} />;
  }

  // 4. 플레이스홀더
  return (
    <div className={className + ' flex flex-col items-center justify-center bg-gray-100 dark:bg-slate-700'}>
      <FaUserAlt className="text-3xl text-faint mb-1" />
      <span className="text-xs text-faint truncate max-w-full px-2">
        {preset.name}
      </span>
    </div>
  );
});

// ─── 프리셋 카드 ──────────────────────────────────────────────
interface CharacterPresetCardProps {
  preset: CharacterPreset;
  index: number;
  onEdit: () => void;
  onDelete: () => void;
  onApplyEasy: () => void;
  onApplyCharacter: () => void;
  onDuplicate: () => void;
  onMove: (fromIndex: number, toIndex: number) => void;
  onCopyToGlobal?: () => void;
  isEasyMode: boolean;
  hideActions?: boolean;
}

const CharacterPresetCard = observer(({
  preset,
  index,
  onEdit,
  onDelete,
  onApplyEasy,
  onApplyCharacter,
  onDuplicate,
  onMove,
  onCopyToGlobal,
  isEasyMode,
  hideActions,
}: CharacterPresetCardProps) => {
  const ref = React.useRef<HTMLDivElement>(null);

  const [{ isDragging }, drag] = useDrag(() => ({
    type: 'character-preset-card',
    item: { index },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  }), [index]);

  const [{ isOver }, drop] = useDrop(() => ({
    accept: 'character-preset-card',
    drop: (item: { index: number }) => {
      if (item.index !== index) {
        onMove(item.index, index);
        item.index = index;
      }
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
    }),
  }), [index, onMove]);

  drag(drop(ref));

  return (
    <div
      ref={ref}
      className={
        'group relative rounded-lg bg-[var(--c-surface-2)] border-2 overflow-hidden cursor-pointer transition-all hover:shadow-lg ' +
        (isDragging ? 'opacity-30 ' : '') +
        (isOver ? 'border-sky-400 ring-2 ring-sky-400 ' : 'border-gray-200 dark:border-slate-600 ')
      }
    >
      {/* 이미지 영역 (탭/클릭 = 편집. 편집 버튼은 제거하고 카드 탭으로 통일) */}
      <div className="relative overflow-hidden aspect-[3/4]" onClick={() => onEdit()}>
        <CardImage
          preset={preset}
          className="w-full h-full object-cover"
        />
        {/* 호버 오버레이 (PC: 호버 시, 모바일: 상단만 상시) */}
        <div className="absolute inset-0 bg-black/0 md:group-hover:bg-black/40 transition-colors duration-200 pointer-events-none" />
        {/* 편집 힌트: 카드 탭/클릭 = 편집. 매우 흐릿한 편집 아이콘 (장식용, 순차 생성 모드 제외) */}
        {!hideActions && (
          <FaEdit
            size={30}
            className="absolute left-1/2 bottom-14 -translate-x-1/2 text-white/30 drop-shadow pointer-events-none z-10"
          />
        )}
        {/* 그라디언트 텍스트 오버레이 */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-2.5 pt-6 pb-2">
          <div className="text-sm text-white font-medium drop-shadow truncate">
            {preset.name}
          </div>
          <div className="text-xs text-white/70 drop-shadow">
            {preset.vibes.length > 0 && `V:${preset.vibes.length}`}
            {preset.vibes.length > 0 && preset.characterReferences.length > 0 && ' '}
            {preset.characterReferences.length > 0 && `R:${preset.characterReferences.length}`}
            {preset.vibes.length === 0 && preset.characterReferences.length === 0 && '이미지 없음'}
          </div>
        </div>
      </div>
      {/* 액션 버튼 (PC: 호버 시 표시, 모바일: 항상 표시, 순차 생성 모드: 숨김) */}
      {!hideActions && <div className="absolute top-0 left-0 right-0 flex justify-center items-center gap-1 z-20 py-1.5 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-200">
        {isEasyMode && (
          <Tooltip content="이지모드 적용">
            <button
              className="w-8 h-8 rounded-full bg-sky-500 hover:bg-sky-600 text-white flex items-center justify-center shadow-lg transition-colors"
              onClick={(e) => { e.stopPropagation(); onApplyEasy(); }}
            >
              <FaFont size={12} />
            </button>
          </Tooltip>
        )}
        <Tooltip content="캐릭터 프롬프트 적용">
          <button
            className="w-8 h-8 rounded-full bg-yellow-500 hover:bg-yellow-600 text-white flex items-center justify-center shadow-lg transition-colors"
            onClick={(e) => { e.stopPropagation(); onApplyCharacter(); }}
          >
            <FaUserAlt size={12} />
          </button>
        </Tooltip>
        <Tooltip content="복제">
          <button
            className="w-8 h-8 rounded-full bg-orange-500 hover:bg-orange-600 text-white flex items-center justify-center shadow-lg transition-colors"
            onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
          >
            <FaCopy size={12} />
          </button>
        </Tooltip>
        {onCopyToGlobal && (
          <Tooltip content="글로벌로 복사">
            <button
              className="w-8 h-8 rounded-full bg-purple-500 hover:bg-purple-600 text-white flex items-center justify-center shadow-lg transition-colors"
              onClick={(e) => { e.stopPropagation(); onCopyToGlobal(); }}
            >
              <FaCloudUploadAlt size={13} />
            </button>
          </Tooltip>
        )}
        <Tooltip content="삭제">
          <button
            className="w-8 h-8 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center shadow-lg transition-colors"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
          >
            <FaTrash size={12} />
          </button>
        </Tooltip>
      </div>}
    </div>
  );
});

// ─── 글로벌 캐릭터 프리셋 카드 (보라색) ───────────────────────
const GlobalCardImage = ({
  entry,
  className,
}: {
  entry: IGlobalCharacterPresetEntry;
  className: string;
}) => {
  const [img, setImg] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const p: any = entry.preset;
      const file =
        p.representativeImage ||
        p.characterReferences?.[0]?.path ||
        p.vibes?.[0]?.path;
      if (!file) {
        if (!cancelled) setImg(null);
        return;
      }
      const data = await globalCharacterPresetService.fetchImageData(file);
      if (!cancelled) setImg(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [entry]);
  if (img) {
    return <img src={img} className={className} draggable={false} />;
  }
  return (
    <div
      className={
        className +
        ' flex flex-col items-center justify-center bg-purple-50 dark:bg-purple-900/20'
      }
    >
      <FaUserAlt className="text-3xl text-purple-300 dark:text-purple-500 mb-1" />
      <span className="text-xs text-purple-400 dark:text-purple-300 truncate max-w-full px-2">
        {entry.name}
      </span>
    </div>
  );
};

const GlobalCharacterPresetCard = ({
  entry,
  index,
  isEasyMode,
  onApplyEasy,
  onApplyCharacter,
  onLoad,
  onEdit,
  onDuplicate,
  onDelete,
  onMove,
  cyclingMode = false,
  selected = false,
  onToggleSelect,
}: {
  entry: IGlobalCharacterPresetEntry;
  index: number;
  isEasyMode: boolean;
  onApplyEasy: () => void;
  onApplyCharacter: () => void;
  onLoad: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMove: (fromIndex: number, toIndex: number) => void;
  cyclingMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) => {
  const ref = React.useRef<HTMLDivElement>(null);
  const [{ isDragging }, drag] = useDrag(
    () => ({
      type: 'global-character-preset-card',
      item: { index },
      collect: (monitor) => ({ isDragging: monitor.isDragging() }),
    }),
    [index],
  );
  const [{ isOver }, drop] = useDrop(
    () => ({
      accept: 'global-character-preset-card',
      drop: (item: { index: number }) => {
        if (item.index !== index) {
          onMove(item.index, index);
          item.index = index;
        }
      },
      collect: (monitor) => ({ isOver: monitor.isOver() }),
    }),
    [index, onMove],
  );
  drag(drop(ref));

  const p: any = entry.preset;
  const vcount = p.vibes?.length || 0;
  const rcount = p.characterReferences?.length || 0;
  return (
    <div
      ref={ref}
      className={
        'group relative rounded-lg bg-[var(--c-surface-2)] border-2 overflow-hidden transition-all hover:shadow-lg ' +
        (isDragging ? 'opacity-30 ' : '') +
        (isOver
          ? 'border-purple-400 ring-2 ring-purple-400 '
          : 'border-purple-300 dark:border-purple-600 ')
      }
    >
      <div
        className="relative overflow-hidden aspect-[3/4]"
        onClick={() => {
          if (cyclingMode) onToggleSelect?.();
          else onEdit();
        }}
      >
        <GlobalCardImage entry={entry} className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-black/0 md:group-hover:bg-black/40 transition-colors duration-200 pointer-events-none" />
        <div className="absolute top-1.5 left-1.5 bg-purple-500 text-white text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-1 shadow z-10">
          <FaGlobe size={9} />
          글로벌
        </div>
        {cyclingMode && (
          <div
            className="absolute top-2 right-2 z-30 cursor-pointer"
            onClick={(e) => { e.stopPropagation(); onToggleSelect?.(); }}
          >
            <div className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-colors ${
              selected
                ? 'bg-purple-500 border-purple-500 text-white'
                : 'bg-white/80 dark:bg-slate-800/80 border-gray-300 dark:border-gray-500'
            }`}>
              {selected && <FaCheck size={12} />}
            </div>
          </div>
        )}
        {/* 편집 힌트: 카드 탭/클릭 = 편집. 매우 흐릿한 편집 아이콘 (장식용, 순차 생성 모드 제외) */}
        {!cyclingMode && (
          <FaEdit
            size={30}
            className="absolute left-1/2 bottom-14 -translate-x-1/2 text-white/30 drop-shadow pointer-events-none z-10"
          />
        )}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-2.5 pt-6 pb-2">
          <div className="text-sm text-white font-medium drop-shadow truncate">
            {entry.name}
          </div>
          <div className="text-xs text-white/70 drop-shadow">
            {vcount > 0 && `V:${vcount}`}
            {vcount > 0 && rcount > 0 && ' '}
            {rcount > 0 && `R:${rcount}`}
            {vcount === 0 && rcount === 0 && '이미지 없음'}
          </div>
        </div>
        <div className={`absolute top-0 left-0 right-0 flex justify-center items-center gap-1 z-20 py-1.5 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-200 ${cyclingMode ? 'hidden' : ''}`}>
          {isEasyMode && (
            <Tooltip content="불러와서 이지모드 적용">
              <button
                className="w-8 h-8 rounded-full bg-sky-500 hover:bg-sky-600 text-white flex items-center justify-center shadow-lg transition-colors"
                onClick={(e) => { e.stopPropagation(); onApplyEasy(); }}
              >
                <FaFont size={12} />
              </button>
            </Tooltip>
          )}
          <Tooltip content="불러와서 캐릭터 프롬프트 적용">
            <button
              className="w-8 h-8 rounded-full bg-yellow-500 hover:bg-yellow-600 text-white flex items-center justify-center shadow-lg transition-colors"
              onClick={(e) => { e.stopPropagation(); onApplyCharacter(); }}
            >
              <FaUserAlt size={12} />
            </button>
          </Tooltip>
          <Tooltip content="프로젝트로 불러오기">
            <button
              className="w-8 h-8 rounded-full bg-purple-500 hover:bg-purple-600 text-white flex items-center justify-center shadow-lg transition-colors"
              onClick={(e) => { e.stopPropagation(); onLoad(); }}
            >
              <FaCloudDownloadAlt size={13} />
            </button>
          </Tooltip>
          <Tooltip content="복제">
            <button
              className="w-8 h-8 rounded-full bg-orange-500 hover:bg-orange-600 text-white flex items-center justify-center shadow-lg transition-colors"
              onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
            >
              <FaCopy size={12} />
            </button>
          </Tooltip>
          <Tooltip content="삭제">
            <button
              className="w-8 h-8 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center shadow-lg transition-colors"
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
            >
              <FaTrash size={12} />
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
};

// ─── 편집 폼 ─────────────────────────────────────────────────
interface CharacterPresetInnerEditorProps {
  preset: CharacterPreset;
  onSave: (preset: CharacterPreset) => void;
  onCancel: () => void;
  isNew: boolean;
  imageBackend: PresetImageBackend;
}

const CharacterPresetInnerEditor = observer(({
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
          className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="캐릭터 프리셋 이름"
        />
      </div>

      {/* 대표 이미지 */}
      <div className="mb-4 p-3 border border-gray-200 dark:border-gray-600 rounded-lg">
        <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">대표 이미지</div>
        <div className="flex items-start gap-3">
          {representativeImage ? (
            <VibeImage
              path={imageBackend.vibePath(representativeImage)}
              className="w-20 h-20 object-cover rounded-lg flex-none"
            />
          ) : (
            <div className="w-20 h-20 flex items-center justify-center bg-gray-100 dark:bg-slate-700 rounded-lg flex-none border border-dashed border-gray-300 dark:border-gray-600">
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
          <div className="mt-2 flex flex-wrap gap-2 p-2 bg-gray-50 dark:bg-slate-700/50 rounded-lg">
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
          <div className="text-sm text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-slate-700 p-2 rounded font-mono whitespace-pre-wrap break-all">
            {backgroundPrompt}
          </div>
          <div className="text-xs text-amber-600 dark:text-amber-400 mt-1">
            이 필드는 더 이상 편집할 수 없습니다. 이지모드 적용 시에만 기존 값이 사용됩니다.
          </div>
        </div>
      )}

      {/* 바이브 트랜스퍼 */}
      <div
        className={`mb-4 p-3 border rounded-lg transition-colors ${isDraggingVibe ? 'ring-2 ring-sky-500 bg-sky-50 dark:bg-sky-900/20 border-sky-400' : 'border-gray-200 dark:border-gray-600'}`}
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
          <div key={vibe.path + index} className="border border-gray-300 dark:border-gray-600 mt-2 p-2 flex md:flex-row flex-col gap-2 items-start rounded-lg">
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
        className={`mb-4 p-3 border rounded-lg transition-colors ${isDraggingRef ? 'ring-2 ring-sky-500 bg-sky-50 dark:bg-sky-900/20 border-sky-400' : 'border-gray-200 dark:border-gray-600'}`}
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
                ? 'border border-sky-500 bg-sky-50 dark:bg-sky-900/20'
                : 'border border-gray-300 dark:border-gray-600 opacity-60'
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
                      : 'bg-gray-200 dark:bg-slate-600 text-gray-600 dark:text-gray-300'
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
      <div className="mb-4 p-3 border border-gray-200 dark:border-gray-600 rounded-lg">
        <div
          className="flex items-center justify-between cursor-pointer"
          onClick={() => setShowFilenameOptions(!showFilenameOptions)}
        >
          <div className="text-sm font-medium text-gray-700 dark:text-gray-300">파일명 옵션 (선택사항)</div>
          <span className="text-sm text-gray-500">
            {showFilenameOptions ? '▼' : '▶'}
          </span>
        </div>
        {showFilenameOptions && (
          <div className="mt-3 space-y-3">
            <div>
              <label className="text-sm text-gray-600 dark:text-gray-400 mb-1 block">파일명 접두사:</label>
              <input
                type="text"
                className="w-full px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
                value={filenamePrefix}
                onChange={(e) => setFilenamePrefix(e.target.value)}
                placeholder="예: 캐릭터이름"
              />
            </div>
            <div>
              <label className="text-sm text-gray-600 dark:text-gray-400 mb-1 block">파일명 접미사:</label>
              <input
                type="text"
                className="w-full px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
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

      {/* 하단 저장 버튼 */}
      <div className="flex gap-2 pt-2 border-t border-gray-200 dark:border-gray-600">
        <button
          className="flex-1 px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium transition-colors"
          onClick={handleSave}
        >
          <FaCheck className="inline mr-1.5" size={11} />
          {isNew ? '프리셋 추가' : '프리셋 저장'}
        </button>
        <button
          className="flex-1 px-4 py-2 rounded-lg bg-gray-200 dark:bg-slate-600 hover:bg-gray-300 dark:hover:bg-slate-500 text-body text-sm transition-colors"
          onClick={onCancel}
        >
          취소
        </button>
      </div>
    </div>
  );
});

// ─── 캐릭터 프리셋 내보내기/불러오기 ─────────────────────────

interface ExportedPresetData {
  version: 1;
  presets: (ICharacterPreset & {
    vibeImages?: { filename: string; data: string }[];
    referenceImages?: { filename: string; data: string }[];
    representativeImageData?: string;
  })[];
}

async function exportCharacterPresets(session: any) {
  const presets = session.getCharacterPresets() as CharacterPreset[];
  if (presets.length === 0) {
    appState.pushMessage('내보낼 캐릭터 프리셋이 없습니다');
    return;
  }

  const exportData: ExportedPresetData = { version: 1, presets: [] };

  for (const preset of presets) {
    const json: any = preset.toJSON();

    // 바이브 이미지 데이터 포함
    json.vibeImages = [];
    for (const vibe of preset.vibes) {
      try {
        const path = imageService.getVibeImagePath(session, vibe.path);
        const data = await backend.readDataFile(path);
        json.vibeImages.push({ filename: vibe.path.split('/').pop()!, data });
      } catch (e) {}
    }

    // 레퍼런스 이미지 데이터 포함
    json.referenceImages = [];
    for (const ref of preset.characterReferences) {
      try {
        const path = imageService.getReferenceImagePath(session, ref.path);
        const data = await backend.readDataFile(path);
        json.referenceImages.push({ filename: ref.path.split('/').pop()!, data });
      } catch (e) {}
    }

    // 대표 이미지 데이터 포함
    if (preset.representativeImage) {
      try {
        const path = imageService.getVibeImagePath(session, preset.representativeImage);
        const data = await backend.readDataFile(path);
        json.representativeImageData = data;
      } catch (e) {}
    }

    exportData.presets.push(json);
  }

  const jsonStr = JSON.stringify(exportData);
  const fileName = session.name + '_character_presets.json';

  if (isMobile) {
    // 모바일: Capacitor Filesystem으로 저장 후 Share
    try {
      const outPath = 'exports/' + fileName;
      await backend.writeFile(outPath, jsonStr);
      await backend.showFile(outPath);
    } catch (e: any) {
      appState.pushMessage('내보내기 실패: ' + e.message);
      return;
    }
  } else {
    // PC: Blob 다운로드
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }
  appState.pushMessage(`${presets.length}개 캐릭터 프리셋을 내보냈습니다`);
}

async function importCharacterPresets(session: any, file: File) {
  const text = await file.text();
  let data: ExportedPresetData;
  try {
    data = JSON.parse(text);
  } catch (e) {
    appState.pushMessage('올바른 캐릭터 프리셋 파일이 아닙니다');
    return;
  }

  if (!data.presets || !Array.isArray(data.presets)) {
    appState.pushMessage('올바른 캐릭터 프리셋 파일이 아닙니다');
    return;
  }

  let imported = 0;
  for (const presetJson of data.presets) {
    // 바이브 이미지 복원 (원래 파일명으로 직접 저장)
    if (presetJson.vibeImages) {
      for (const img of presetJson.vibeImages) {
        try {
          const path = imageService.getVibesDir(session) + '/' + img.filename;
          await backend.writeDataFile(path, img.data);
        } catch (e) {}
      }
    }

    // 레퍼런스 이미지 복원
    if (presetJson.referenceImages) {
      for (const img of presetJson.referenceImages) {
        try {
          const path = imageService.getReferenceDir(session) + '/' + img.filename;
          await backend.writeDataFile(path, img.data);
        } catch (e) {}
      }
    }

    // 대표 이미지 복원
    if (presetJson.representativeImageData && presetJson.representativeImage) {
      try {
        const path = imageService.getVibesDir(session) + '/' + presetJson.representativeImage;
        await backend.writeDataFile(path, presetJson.representativeImageData);
      } catch (e) {}
    }

    // 임시 필드 제거 후 프리셋 생성
    delete presetJson.vibeImages;
    delete presetJson.referenceImages;
    delete presetJson.representativeImageData;

    const preset = CharacterPreset.fromJSON(presetJson as ICharacterPreset);

    // 중복 이름 처리
    while (session.hasCharacterPreset(preset.name)) {
      preset.name = preset.name + '_1';
    }

    session.addCharacterPreset(preset);
    imported++;
  }

  appState.pushMessage(`${imported}개 캐릭터 프리셋을 불러왔습니다`);
}

// ─── 메인 프리셋 매니저 (목록/편집 전환) ───────────────────────
interface CharacterPresetEditorProps {
  onApplyPreset?: (preset: CharacterPreset, mode: 'easy' | 'character') => void;
}

export const CharacterPresetEditor = observer(({
  onApplyPreset,
}: CharacterPresetEditorProps) => {
  const { curSession } = appState;
  const [editingPreset, setEditingPreset] = useState<CharacterPreset | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [editTarget, setEditTarget] = useState<'local' | 'global'>('local');
  const [editGlobalId, setEditGlobalId] = useState<string | null>(null);
  // 로컬/글로벌 뷰 전환
  const [globalView, setGlobalView] = useState(false);
  const [, setGlobalVersion] = useState(0);
  useEffect(() => {
    const onChanged = () => setGlobalVersion((v) => v + 1);
    globalCharacterPresetService.addEventListener('changed', onChanged);
    return () =>
      globalCharacterPresetService.removeEventListener('changed', onChanged);
  }, []);
  // 순차 생성 모드
  const [cyclingMode, setCyclingMode] = useState(false);
  const [selectedPresets, setSelectedPresets] = useState<Set<string>>(new Set());
  const [selectedGlobalIds, setSelectedGlobalIds] = useState<Set<string>>(new Set());
  const [selectedScenes, setSelectedScenes] = useState<Set<string>>(new Set());
  const [cyclingSamples, setCyclingSamples] = useState(10);
  const [sceneFilter, setSceneFilter] = useState('');
  // 프로젝트 파일 생성 모드: 프리셋마다 현재 프로젝트를 복제해 새 프로젝트로 생성
  const [projectFileMode, setProjectFileMode] = useState(false);

  const cyclingState = cyclingSessionService.state;

  if (!curSession) {
    return <div className="p-4 text-gray-500">세션을 선택해주세요</div>;
  }

  const presets = curSession.getCharacterPresets();
  const scenes = Array.from(curSession.scenes.values());
  const isEasyMode = curSession.selectedWorkflow?.workflowType === 'SDImageGenEasy';

  // 씬 필터링
  const filteredScenes = useMemo(() => {
    if (!sceneFilter.trim()) return scenes;
    const q = sceneFilter.toLowerCase();
    return scenes.filter((s) => s.name.toLowerCase().includes(q));
  }, [scenes, sceneFilter]);

  // 순차 생성 모드 진입 시 모든 선택 해제 (기본값)
  // 글로벌 뷰에서는 프로젝트 파일 생성 모드를 기본 ON (요청 핵심 동작)
  const enterCyclingMode = () => {
    setCyclingMode(true);
    setSelectedPresets(new Set());
    setSelectedGlobalIds(new Set());
    setSelectedScenes(new Set());
    setSceneFilter('');
    setProjectFileMode(globalView);
  };

  const exitCyclingMode = () => {
    setCyclingMode(false);
    setSelectedPresets(new Set());
    setSelectedGlobalIds(new Set());
    setSelectedScenes(new Set());
    setSceneFilter('');
  };

  const togglePresetSelection = (name: string) => {
    const next = new Set(selectedPresets);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setSelectedPresets(next);
  };

  const toggleGlobalSelection = (id: string) => {
    const next = new Set(selectedGlobalIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedGlobalIds(next);
  };

  const toggleSceneSelection = (name: string) => {
    const next = new Set(selectedScenes);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setSelectedScenes(next);
  };

  const selectedCyclingCount = globalView
    ? selectedGlobalIds.size
    : selectedPresets.size;

  const startCycling = () => {
    const selectedSceneList = scenes.filter((s) => selectedScenes.has(s.name));
    // 현재 뷰에 따라 큐 항목(디스크립터) 구성
    const items = globalView
      ? globalEntries
          .filter((e) => selectedGlobalIds.has(e.id))
          .map((e) => ({
            kind: 'global' as const,
            name: e.name,
            preset: CharacterPreset.fromJSON(
              JSON.parse(JSON.stringify(e.preset)),
            ),
            globalId: e.id,
          }))
      : presets
          .filter((p) => selectedPresets.has(p.name))
          .map((p) => ({
            kind: 'local' as const,
            name: p.name,
            preset: p,
          }));
    if (items.length === 0) {
      appState.pushMessage('프리셋을 하나 이상 선택해주세요');
      return;
    }
    if (selectedSceneList.length === 0) {
      appState.pushMessage('씬을 하나 이상 선택해주세요');
      return;
    }
    cyclingSessionService.start(
      curSession,
      items,
      selectedSceneList,
      cyclingSamples,
      { projectFileMode },
    );
  };

  const handleAddNew = () => {
    const newPreset = new CharacterPreset();
    newPreset.name = '새 캐릭터 프리셋';
    setEditTarget('local');
    setEditGlobalId(null);
    setEditingPreset(newPreset);
    setIsNew(true);
  };

  const handleEdit = (preset: CharacterPreset) => {
    const copy = CharacterPreset.fromJSON(preset.toJSON());
    setEditTarget('local');
    setEditGlobalId(null);
    setEditingPreset(copy);
    setIsNew(false);
  };

  const handleAddNewGlobal = () => {
    const newPreset = new CharacterPreset();
    newPreset.name = '새 글로벌 프리셋';
    setEditTarget('global');
    setEditGlobalId(null);
    setEditingPreset(newPreset);
    setIsNew(true);
  };

  const handleEditGlobal = (entry: IGlobalCharacterPresetEntry) => {
    const copy = CharacterPreset.fromJSON(
      JSON.parse(JSON.stringify(entry.preset)),
    );
    setEditTarget('global');
    setEditGlobalId(entry.id);
    setEditingPreset(copy);
    setIsNew(false);
  };

  const handleSave = async (preset: CharacterPreset) => {
    if (editTarget === 'global') {
      try {
        if (isNew) {
          await globalCharacterPresetService.addPresetObject(preset);
        } else if (editGlobalId) {
          await globalCharacterPresetService.updateEntry(editGlobalId, preset);
        }
      } catch (e: any) {
        appState.pushMessage(e.message || '글로벌 프리셋 저장 실패');
      }
    } else {
      if (isNew) {
        curSession.addCharacterPreset(preset);
      } else {
        curSession.updateCharacterPreset(editingPreset!.name, preset);
      }
    }
    setEditingPreset(null);
    setIsNew(false);
    setEditGlobalId(null);
  };

  const handleCancel = () => {
    setEditingPreset(null);
    setIsNew(false);
    setEditGlobalId(null);
  };

  const handleDelete = (preset: CharacterPreset) => {
    appState.pushDialog({
      type: 'confirm',
      text: `"${preset.name}" 프리셋을 삭제하시겠습니까?`,
      callback: () => {
        // 삭제하려는 프리셋이 현재 적용 중이면 먼저 해제
        if (appState.appliedCharacterPreset === preset.name) {
          appState.clearAppliedCharacterPreset();
        }
        curSession.removeCharacterPreset(preset.name);
      },
    });
  };

  const handleDuplicate = (preset: CharacterPreset) => {
    const copy = CharacterPreset.fromJSON(preset.toJSON());
    copy.name = preset.name + ' 복사본';
    curSession.addCharacterPreset(copy);
  };

  const handleApplyEasy = (preset: CharacterPreset) => {
    if (onApplyPreset) onApplyPreset(preset, 'easy');
  };

  const handleApplyCharacter = (preset: CharacterPreset) => {
    if (onApplyPreset) onApplyPreset(preset, 'character');
  };

  // ─── 글로벌 캐릭터 프리셋 ───
  const handleCopyToGlobal = async (preset: CharacterPreset) => {
    try {
      await globalCharacterPresetService.addFromSessionPreset(curSession, preset);
      appState.pushMessage(`"${preset.name}"을(를) 글로벌로 복사했습니다`);
    } catch (e: any) {
      appState.pushMessage(e.message || '글로벌 복사에 실패했습니다');
    }
  };

  const handleLoadGlobal = async (entry: IGlobalCharacterPresetEntry) => {
    try {
      const p = await globalCharacterPresetService.instantiateIntoSession(
        curSession,
        entry.id,
      );
      appState.pushMessage(`"${p.name}"을(를) 프로젝트로 불러왔습니다`);
    } catch (e: any) {
      appState.pushMessage(e.message || '불러오기에 실패했습니다');
    }
  };

  const handleRenameGlobal = (entry: IGlobalCharacterPresetEntry) => {
    appState.pushDialog({
      type: 'input-confirm',
      text: '새 글로벌 프리셋 이름을 입력해주세요',
      callback: async (v?: string) => {
        if (!v) return;
        try {
          await globalCharacterPresetService.rename(entry.id, v);
        } catch (e: any) {
          appState.pushMessage(e.message || '이름 변경에 실패했습니다');
        }
      },
    });
  };

  const handleDeleteGlobal = (entry: IGlobalCharacterPresetEntry) => {
    appState.pushDialog({
      type: 'confirm',
      text: `글로벌 프리셋 "${entry.name}"을(를) 삭제하시겠습니까?\n(이 작업은 모든 프로젝트에 영향을 줍니다)`,
      callback: async () => {
        await globalCharacterPresetService.delete(entry.id);
      },
    });
  };

  const handleDuplicateGlobal = (entry: IGlobalCharacterPresetEntry) => {
    globalCharacterPresetService.duplicateEntry(entry.id);
  };

  // 글로벌 프리셋 적용: 현재 프로젝트로 자동 불러온 뒤(이미지 복사) 적용
  const handleApplyGlobal = async (
    entry: IGlobalCharacterPresetEntry,
    mode: 'easy' | 'character',
  ) => {
    try {
      const local = await globalCharacterPresetService.instantiateIntoSession(
        curSession,
        entry.id,
      );
      if (onApplyPreset) onApplyPreset(local, mode);
      appState.pushMessage(`"${entry.name}"을(를) 불러와 적용했습니다`);
    } catch (e: any) {
      appState.pushMessage(e.message || '적용에 실패했습니다');
    }
  };

  const globalEntries = globalCharacterPresetService.list();

  // 편집 모드
  if (editingPreset) {
    return (
      <CharacterPresetInnerEditor
        preset={editingPreset}
        onSave={handleSave}
        onCancel={handleCancel}
        isNew={isNew}
        imageBackend={
          editTarget === 'global'
            ? globalImageBackend
            : makeSessionImageBackend(curSession)
        }
      />
    );
  }

  // 순회 진행 중 상태 표시
  if (cyclingState === 'running' || cyclingState === 'paused') {
    return (
      <div className="text-default">
        <div className="p-4 border border-sky-300 dark:border-sky-600 rounded-lg bg-sky-50 dark:bg-sky-900/20">
          <div className="flex items-center gap-2 mb-3">
            <FaSync className={`text-sky-500 ${cyclingState === 'running' ? 'animate-spin' : ''}`} />
            <span className="text-base font-medium text-sky-700 dark:text-sky-300">
              {cyclingState === 'running' ? '순차 생성 진행 중' : '순차 생성 일시정지'}
            </span>
          </div>
          <div className="text-sm text-gray-700 dark:text-gray-300 mb-2">
            현재: <span className="font-medium">{cyclingSessionService.currentPresetName}</span>
            {' '}({cyclingSessionService.completedPresets + 1}/{cyclingSessionService.totalPresets})
          </div>
          {/* 진행률 바 */}
          <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full mb-3">
            <div
              className="h-full bg-sky-500 rounded-full transition-all"
              style={{ width: `${(cyclingSessionService.completedPresets / cyclingSessionService.totalPresets) * 100}%` }}
            />
          </div>
          {/* 남은 프리셋 목록 */}
          {cyclingSessionService.remainingPresets.length > 0 && (
            <div className="text-xs text-muted mb-3">
              남은 프리셋: {cyclingSessionService.remainingPresets.map((p) => p.name).join(', ')}
            </div>
          )}
          {/* 컨트롤 버튼 */}
          <div className="flex gap-2">
            {cyclingState === 'running' ? (
              <button
                className="px-4 py-1.5 rounded-lg bg-yellow-500 hover:bg-yellow-600 text-white text-sm font-medium transition-colors flex items-center gap-1.5"
                onClick={() => {
                  taskQueueService.stop();
                }}
              >
                <FaPause size={10} />
                일시정지
              </button>
            ) : (
              <button
                className="px-4 py-1.5 rounded-lg bg-green-500 hover:bg-green-600 text-white text-sm font-medium transition-colors flex items-center gap-1.5"
                onClick={() => cyclingSessionService.resume()}
              >
                <FaPlay size={10} />
                재개
              </button>
            )}
            <button
              className="px-4 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors flex items-center gap-1.5"
              onClick={() => {
                taskQueueService.stop();
                cyclingSessionService.cancel();
              }}
            >
              <FaStop size={10} />
              취소
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 카드 그리드 모드
  return (
    <div className="text-default">
      {/* 상단 컨트롤 */}
      <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          {/* 로컬/글로벌 전환 토글 */}
          <button
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
              globalView
                ? 'bg-purple-500 text-white'
                : 'bg-gray-200 dark:bg-slate-600 text-body hover:bg-gray-300 dark:hover:bg-slate-500'
            }`}
            onClick={() => {
              if (cyclingMode) exitCyclingMode();
              setGlobalView(!globalView);
            }}
          >
            {globalView ? <FaGlobe size={12} /> : <FaUsers size={12} />}
            {globalView ? '글로벌' : '로컬'}
          </button>
          {(globalView ? globalEntries.length >= 2 : presets.length >= 2) && (
            <button
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                cyclingMode
                  ? (globalView ? 'bg-purple-500 text-white' : 'bg-sky-500 text-white')
                  : 'bg-gray-200 dark:bg-slate-600 text-body hover:bg-gray-300 dark:hover:bg-slate-500'
              }`}
              onClick={() => cyclingMode ? exitCyclingMode() : enterCyclingMode()}
            >
              <FaSync size={11} />
              {cyclingMode ? '순차 생성 모드 끄기' : '순차 생성 모드'}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!globalView && presets.length > 0 && (
            <Tooltip content="모든 프리셋 내보내기">
              <button
                className="px-3 py-1.5 rounded-lg text-sm bg-gray-200 dark:bg-slate-600 text-body hover:bg-gray-300 dark:hover:bg-slate-500 transition-colors flex items-center gap-1.5"
                onClick={() => exportCharacterPresets(curSession)}
              >
                <FaDownload size={11} />
                내보내기
              </button>
            </Tooltip>
          )}
          {!globalView && (
            <Tooltip content="프리셋 파일 불러오기">
              <label className="px-3 py-1.5 rounded-lg text-sm bg-gray-200 dark:bg-slate-600 text-body hover:bg-gray-300 dark:hover:bg-slate-500 transition-colors flex items-center gap-1.5 cursor-pointer">
                <FaUpload size={11} />
                불러오기
                <input
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      await importCharacterPresets(curSession, file);
                      e.target.value = '';
                    }
                  }}
                />
              </label>
            </Tooltip>
          )}
        </div>
      </div>

      {globalView ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: isMobile
              ? 'repeat(2, 1fr)'
              : 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: '0.75rem',
            alignContent: 'start',
          }}
        >
          {/* 새 글로벌 프리셋 카드 (순차 생성 모드가 아닐 때만) */}
          {!cyclingMode && (
            <div
              className="rounded-lg border-2 border-dashed border-purple-300 dark:border-purple-600 hover:border-purple-500 cursor-pointer flex flex-col items-center justify-center aspect-[3/4] transition-colors group"
              onClick={handleAddNewGlobal}
            >
              <FaPlus className="text-2xl text-purple-400 dark:text-purple-500 group-hover:text-purple-600 transition-colors mb-2" />
              <span className="text-sm text-purple-400 dark:text-purple-500 group-hover:text-purple-600 transition-colors">
                새 글로벌 프리셋
              </span>
            </div>
          )}
          {globalEntries.map((entry, i) => (
            <GlobalCharacterPresetCard
              key={entry.id}
              entry={entry}
              index={i}
              isEasyMode={isEasyMode}
              cyclingMode={cyclingMode}
              selected={selectedGlobalIds.has(entry.id)}
              onToggleSelect={() => toggleGlobalSelection(entry.id)}
              onApplyEasy={() => handleApplyGlobal(entry, 'easy')}
              onApplyCharacter={() => handleApplyGlobal(entry, 'character')}
              onLoad={() => handleLoadGlobal(entry)}
              onEdit={() => handleEditGlobal(entry)}
              onDuplicate={() => handleDuplicateGlobal(entry)}
              onDelete={() => handleDeleteGlobal(entry)}
              onMove={(from, to) =>
                globalCharacterPresetService.reorder(from, to)
              }
            />
          ))}
        </div>
      ) : presets.length === 0 ? (
        <div className="text-center py-12">
          <FaUserAlt className="text-4xl mx-auto mb-3 text-gray-300 dark:text-gray-600" />
          <div className="text-muted mb-1">캐릭터 프리셋이 없습니다</div>
          <div className="text-sm text-faint mb-4">새 프리셋을 추가해보세요</div>
          <button
            className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium transition-colors"
            onClick={handleAddNew}
          >
            <FaPlus className="inline mr-1.5" size={11} />
            새 프리셋 추가
          </button>
        </div>
      ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: '0.75rem',
              alignContent: 'start',
            }}
          >
            {/* 새 프리셋 카드 (순회 모드가 아닐 때만) */}
            {!cyclingMode && (
              <div
                className="rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 hover:border-sky-400 dark:hover:border-sky-500 cursor-pointer flex flex-col items-center justify-center aspect-[3/4] transition-colors group"
                onClick={handleAddNew}
              >
                <FaPlus className="text-2xl text-faint group-hover:text-sky-500 transition-colors mb-2" />
                <span className="text-sm text-faint group-hover:text-sky-500 transition-colors">
                  새 프리셋
                </span>
              </div>
            )}

            {/* 프리셋 카드들 */}
            {presets.map((preset, i) => (
              <div key={preset.name} className="relative">
                {cyclingMode && (
                  <div
                    className="absolute top-2 left-2 z-30 cursor-pointer"
                    onClick={(e) => { e.stopPropagation(); togglePresetSelection(preset.name); }}
                  >
                    <div className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-colors ${
                      selectedPresets.has(preset.name)
                        ? 'bg-sky-500 border-sky-500 text-white'
                        : 'bg-white/80 dark:bg-slate-800/80 border-gray-300 dark:border-gray-500'
                    }`}>
                      {selectedPresets.has(preset.name) && <FaCheck size={12} />}
                    </div>
                  </div>
                )}
                <CharacterPresetCard
                  preset={preset}
                  index={i}
                  onEdit={() => cyclingMode ? togglePresetSelection(preset.name) : handleEdit(preset)}
                  onDelete={() => handleDelete(preset)}
                  onApplyEasy={() => handleApplyEasy(preset)}
                  onApplyCharacter={() => handleApplyCharacter(preset)}
                  onDuplicate={() => handleDuplicate(preset)}
                  onMove={(from, to) => curSession.moveCharacterPreset(from, to)}
                  onCopyToGlobal={() => handleCopyToGlobal(preset)}
                  isEasyMode={isEasyMode}
                  hideActions={cyclingMode}
                />
              </div>
            ))}
          </div>
      )}
      {/* 순차 생성 설정 패널 (로컬/글로벌 공통) */}
      {cyclingMode && (
            <div className="mt-4 p-3 border border-gray-200 dark:border-gray-600 rounded-lg">
              {/* 씬 선택 */}
              <div className="mb-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    씬 선택 ({selectedScenes.size}/{scenes.length})
                  </span>
                  <button
                    onClick={() => {
                      const targets = filteredScenes.map((s) => s.name);
                      const allSelected = targets.every((n) => selectedScenes.has(n));
                      const next = new Set(selectedScenes);
                      targets.forEach((n) => allSelected ? next.delete(n) : next.add(n));
                      setSelectedScenes(next);
                    }}
                    className="text-xs text-sky-500 hover:text-sky-600"
                  >
                    {filteredScenes.every((s) => selectedScenes.has(s.name)) ? '전체 해제' : '전체 선택'}
                    {sceneFilter.trim() && ` (${filteredScenes.length}개)`}
                  </button>
                </div>
                <input
                  type="text"
                  placeholder="씬 이름 검색..."
                  value={sceneFilter}
                  onChange={(e) => setSceneFilter(e.target.value)}
                  className="w-full mb-1 px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
                />
                <div className="max-h-36 overflow-y-auto border border-gray-200 dark:border-gray-600 rounded-lg p-2 space-y-1">
                  {filteredScenes.map((scene) => (
                    <label key={scene.name} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700/50 rounded px-1 py-0.5">
                      <input
                        type="checkbox"
                        checked={selectedScenes.has(scene.name)}
                        onChange={() => toggleSceneSelection(scene.name)}
                        className="rounded border-gray-300 dark:border-gray-600"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{scene.name}</span>
                    </label>
                  ))}
                  {filteredScenes.length === 0 && (
                    <div className="text-xs text-gray-400 py-1">일치하는 씬이 없습니다</div>
                  )}
                </div>
              </div>
              {/* 프로젝트 파일 생성 모드 토글 */}
              <label className="flex items-start gap-2 mb-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={projectFileMode}
                  onChange={(e) => setProjectFileMode(e.target.checked)}
                  className="mt-0.5 rounded border-gray-300 dark:border-gray-600"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  <span className="font-medium">프로젝트 파일 생성으로 동작</span>
                  <span className="block text-xs text-muted">
                    각 프리셋을 프리셋 이름의 새 프로젝트로 복제(이미지 미포함)해 생성합니다. 원본 프로젝트는 그대로 유지됩니다.
                  </span>
                </span>
              </label>
              {/* 생성 수 + 시작 버튼 */}
              <div className="flex items-center gap-3 flex-wrap">
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  프리셋: <span className="font-medium text-gray-800 dark:text-gray-200">{selectedCyclingCount}개</span>
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  씬: <span className="font-medium text-gray-800 dark:text-gray-200">{selectedScenes.size}개</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm text-gray-600 dark:text-gray-400">생성 수:</span>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={cyclingSamples}
                    onChange={(e) => setCyclingSamples(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-16 px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
                  />
                </div>
                <button
                  className={`ml-auto px-4 py-1.5 rounded-lg text-white text-sm font-medium transition-colors flex items-center gap-1.5 ${
                    globalView ? 'bg-purple-500 hover:bg-purple-600' : 'bg-green-500 hover:bg-green-600'
                  }`}
                  onClick={startCycling}
                  disabled={selectedCyclingCount === 0 || selectedScenes.size === 0}
                >
                  <FaPlay size={10} />
                  순차 생성 시작
                </button>
              </div>
            </div>
          )}
    </div>
  );
});

// ─── ModalOverlay 래퍼 (FloatView 대체) ──────────────────────
interface CharacterPresetFloatEditorProps {
  onClose: () => void;
  onApplyPreset?: (preset: CharacterPreset, mode: 'easy' | 'character') => void;
}

export const CharacterPresetModalEditor = observer(({
  onClose,
  onApplyPreset,
}: CharacterPresetFloatEditorProps) => {
  return (
    <ModalOverlay
      isOpen={true}
      onClose={onClose}
      title="캐릭터 프리셋 관리"
      width="max-w-5xl"
    >
      <CharacterPresetEditor
        onApplyPreset={(preset, mode) => {
          if (onApplyPreset) onApplyPreset(preset, mode);
        }}
      />
    </ModalOverlay>
  );
});

// 하위호환: 기존 import명 유지
export const CharacterPresetFloatEditor = CharacterPresetModalEditor;

export default CharacterPresetEditor;
