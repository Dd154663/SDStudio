import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useDrag, useDrop } from 'react-dnd';
import {
  FaCheck,
  FaCloudDownloadAlt,
  FaCloudUploadAlt,
  FaCopy,
  FaEdit,
  FaFolder,
  FaFont,
  FaPen,
  FaTrash,
  FaUserAlt,
} from 'react-icons/fa';
import Tooltip from './Tooltip';
import { CharacterPreset } from '../models/types';
import { imageService, globalCharacterPresetService } from '../models';
import { appState } from '../models/AppService';
import type { IGlobalCharacterPresetEntry } from '../models/GlobalCharacterPresetService';

// CharacterPresetEditor.tsx 에서 분리된 카드/이미지 표시 계열.
// 프리셋 편집기의 이미지 저장/표시 백엔드 (로컬=세션 디렉터리, 글로벌=글로벌 디렉터리)
export interface PresetImageBackend {
  storeVibe: (base64: string) => Promise<string>;
  storeReference: (base64: string) => Promise<string>;
  vibePath: (token: string) => string;
  referencePath: (token: string) => string;
}

export const makeSessionImageBackend = (session: any): PresetImageBackend => ({
  storeVibe: (b) => imageService.storeVibeImage(session, b),
  storeReference: (b) => imageService.storeReferenceImage(session, b),
  vibePath: (t) => imageService.getVibeImagePath(session, t),
  referencePath: (t) => imageService.getReferenceImagePath(session, t),
});

export const globalImageBackend: PresetImageBackend = {
  storeVibe: (b) => globalCharacterPresetService.storeVibeForEditor(b),
  storeReference: (b) => globalCharacterPresetService.storeReferenceForEditor(b),
  vibePath: (t) => globalCharacterPresetService.getImagePath(t),
  referencePath: (t) => globalCharacterPresetService.getImagePath(t),
};

// ─── 바이브 이미지 컴포넌트 ────────────────────────────────────
export const VibeImage = ({
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
          className={className + ' flex items-center justify-center bg-[var(--c-surface)] border line-color'}
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
    <div className={className + ' flex flex-col items-center justify-center bg-[var(--c-surface)]'}>
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

export const CharacterPresetCard = observer(({
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
        (isOver ? 'border-sky-400 ring-2 ring-sky-400 ' : 'line-color ')
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
            {appState.appliedCharacterPresetNames.includes(preset.name) && (
              <span className="text-green-300 font-semibold mr-1">✓ 적용됨</span>
            )}
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
              className="w-8 h-8 rounded-full btn-solid-sky flex items-center justify-center shadow-lg transition-colors"
              onClick={(e) => { e.stopPropagation(); onApplyEasy(); }}
            >
              <FaFont size={12} />
            </button>
          </Tooltip>
        )}
        <Tooltip content="캐릭터 프롬프트 적용">
          <button
            className="w-8 h-8 rounded-full btn-solid-yellow flex items-center justify-center shadow-lg transition-colors"
            onClick={(e) => { e.stopPropagation(); onApplyCharacter(); }}
          >
            <FaUserAlt size={12} />
          </button>
        </Tooltip>
        <Tooltip content="복제">
          <button
            className="w-8 h-8 rounded-full btn-solid-orange flex items-center justify-center shadow-lg transition-colors"
            onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
          >
            <FaCopy size={12} />
          </button>
        </Tooltip>
        {onCopyToGlobal && (
          <Tooltip content="글로벌로 복사">
            <button
              className="w-8 h-8 rounded-full btn-solid-purple flex items-center justify-center shadow-lg transition-colors"
              onClick={(e) => { e.stopPropagation(); onCopyToGlobal(); }}
            >
              <FaCloudUploadAlt size={13} />
            </button>
          </Tooltip>
        )}
        <Tooltip content="삭제">
          <button
            className="w-8 h-8 rounded-full btn-solid-red flex items-center justify-center shadow-lg transition-colors"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
          >
            <FaTrash size={12} />
          </button>
        </Tooltip>
      </div>}
    </div>
  );
});

// ─── 글로벌 폴더 필터 칩 (1단계 평면 폴더 — 배치 생성 P0) ──────
//
// [전체]+파생 폴더 목록+[미분류] 칩 행 — 캐릭터 프리셋 라이브러리와 일괄 생성
// 위저드가 공유하는 단일 출처. 폴더가 하나도 없으면 렌더하지 않는다.
// value: '__all__' | '__unfiled__' | 폴더명 (소멸 폴더 폴백은 호출측 소관).
export const GlobalFolderFilterChips = observer(
  ({
    value,
    onChange,
    onRenameFolder,
  }: {
    value: string;
    onChange: (v: string) => void;
    // 지정 시 선택된 칩에 이름 변경 아이콘(모바일 대응)+우클릭 이름 변경 노출
    onRenameFolder?: (folder: string) => void;
  }) => {
    const entries = globalCharacterPresetService.list();
    const folders = globalCharacterPresetService.listFolders();
    if (folders.length === 0) return null;
    return (
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        <button
          className={`px-2.5 py-1 rounded-full text-xs whitespace-nowrap flex-none transition-colors ${
            value === '__all__'
              ? 'bg-purple-500 text-white'
              : 'btn-neutral text-body'
          }`}
          onClick={() => onChange('__all__')}
        >
          전체 ({entries.length})
        </button>
        {folders.map((f) => {
          const selected = value === f;
          const count = entries.filter((e) => e.folder === f).length;
          return (
            <button
              key={f}
              className={`px-2.5 py-1 rounded-full text-xs whitespace-nowrap flex-none transition-colors flex items-center gap-1 ${
                selected ? 'bg-purple-500 text-white' : 'btn-neutral text-body'
              }`}
              onClick={() => onChange(f)}
              onContextMenu={
                onRenameFolder
                  ? (e) => {
                      // 데스크톱: 우클릭으로 이름 변경
                      e.preventDefault();
                      onRenameFolder(f);
                    }
                  : undefined
              }
            >
              <FaFolder size={10} />
              {f} ({count})
              {/* 선택된 칩에만 이름 변경 아이콘 노출 (롱프레스 불필요) */}
              {selected && onRenameFolder && (
                <span
                  role="button"
                  aria-label="폴더 이름 변경"
                  className="-mr-0.5 p-0.5 rounded hover:bg-white/20"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRenameFolder(f);
                  }}
                >
                  <FaPen size={9} />
                </span>
              )}
            </button>
          );
        })}
        <button
          className={`px-2.5 py-1 rounded-full text-xs whitespace-nowrap flex-none transition-colors ${
            value === '__unfiled__'
              ? 'bg-purple-500 text-white'
              : 'btn-neutral text-body'
          }`}
          onClick={() => onChange('__unfiled__')}
        >
          미분류 ({entries.filter((e) => !e.folder).length})
        </button>
      </div>
    );
  },
);

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

export const GlobalCharacterPresetCard = observer(({
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
  onMoveToFolder,
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
  // 폴더로 이동 (1단계 평면 폴더 — 배치 생성 P0)
  onMoveToFolder?: () => void;
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
        {/* "글로벌" 코너 배지 제거 — 글로벌이 기본 화면이 되면서(주종 역전,
            2026-07-16) 더 이상 구분 표기가 불필요. */}
        {cyclingMode && (
          <div
            className="absolute top-2 right-2 z-30 cursor-pointer"
            onClick={(e) => { e.stopPropagation(); onToggleSelect?.(); }}
          >
            <div className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-colors ${
              selected
                ? 'bg-purple-500 border-purple-500 text-white'
                : 'bg-white/80 dark:bg-slate-800/80 line-color'
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
          <div className="text-xs text-white/70 drop-shadow truncate">
            {appState.appliedCharacterPresetNames.includes(entry.name) && (
              <span className="text-green-300 font-semibold mr-1">✓ 적용됨</span>
            )}
            {vcount > 0 && `V:${vcount}`}
            {vcount > 0 && rcount > 0 && ' '}
            {rcount > 0 && `R:${rcount}`}
            {vcount === 0 && rcount === 0 && '이미지 없음'}
            {entry.folder && ` · 📁${entry.folder}`}
          </div>
        </div>
        <div className={`absolute top-0 left-0 right-0 flex flex-wrap justify-center items-center gap-1 z-20 py-1.5 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-200 ${cyclingMode ? 'hidden' : ''}`}>
          {isEasyMode && (
            <Tooltip content="불러와서 이지모드 적용">
              <button
                className="w-8 h-8 rounded-full btn-solid-sky flex items-center justify-center shadow-lg transition-colors"
                onClick={(e) => { e.stopPropagation(); onApplyEasy(); }}
              >
                <FaFont size={12} />
              </button>
            </Tooltip>
          )}
          <Tooltip content="불러와서 캐릭터 프롬프트 적용">
            <button
              className="w-8 h-8 rounded-full btn-solid-yellow flex items-center justify-center shadow-lg transition-colors"
              onClick={(e) => { e.stopPropagation(); onApplyCharacter(); }}
            >
              <FaUserAlt size={12} />
            </button>
          </Tooltip>
          <Tooltip content="프로젝트로 불러오기">
            <button
              className="w-8 h-8 rounded-full btn-solid-purple flex items-center justify-center shadow-lg transition-colors"
              onClick={(e) => { e.stopPropagation(); onLoad(); }}
            >
              <FaCloudDownloadAlt size={13} />
            </button>
          </Tooltip>
          <Tooltip content="복제">
            <button
              className="w-8 h-8 rounded-full btn-solid-orange flex items-center justify-center shadow-lg transition-colors"
              onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
            >
              <FaCopy size={12} />
            </button>
          </Tooltip>
          {onMoveToFolder && (
            <Tooltip content="폴더로 이동">
              <button
                className="w-8 h-8 rounded-full btn-solid-indigo flex items-center justify-center shadow-lg transition-colors"
                onClick={(e) => { e.stopPropagation(); onMoveToFolder(); }}
              >
                <FaFolder size={12} />
              </button>
            </Tooltip>
          )}
          <Tooltip content="삭제">
            <button
              className="w-8 h-8 rounded-full btn-solid-red flex items-center justify-center shadow-lg transition-colors"
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
            >
              <FaTrash size={12} />
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
});
