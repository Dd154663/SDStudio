import * as React from 'react';
import { useContext, useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { v4 } from 'uuid';
import { FaCloudUploadAlt, FaImages, FaTimes, FaTrash } from 'react-icons/fa';
import { FileUploadBase64 } from './UtilComponents';
import Tooltip from './Tooltip';
import { ReferenceItem, VibeItem } from '../models/types';
import { imageService, isMobile } from '../models';
import { appState } from '../models/AppService';
import { WFIInlineInput, wfiElementKey } from '../models/workflows/WorkFlow';
import { ModelVersion } from '../backends/imageGen';
import { WFElementContext, PresetIconRowContext } from './wfElementContext';
import { resolveCompanionButtons } from '../models/companionSlots';
import { renderCompanionButtons } from './PortableToolbarButtons';
import { CompanionHostRow } from './CompanionDnd';

// PreSetEdtior.tsx 에서 분리된 바이브(vibe) 편집기 계열.
// VibeImage/EditableSliderValue 는 CharacterReferenceEditor 와 본체도 공용.

// 패널 폭 적응(2026-07-17): 좌측 프리셋 패널은 폭을 자유 조정할 수 있어 창 기준
// md: 브레이크포인트로는 부족 — 컨테이너 실폭을 관찰해 좁으면 세로 배치로 전환한다
// (바이브/레퍼런스 항목의 슬라이더 영역이 화면 밖으로 잘리는 오버플로 방지).
// active: 편집기가 조건부 마운트라 열릴 때 재관찰하도록 의존성으로 받는다.
export function useNarrowContainer(
  ref: React.RefObject<HTMLElement | null>,
  active: any,
  threshold = 340,
) {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () =>
      setNarrow(el.clientWidth > 0 && el.clientWidth < threshold);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, active, threshold]);
  return narrow;
}
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

// 클릭 시 직접 입력 가능한 슬라이더 값 표시 컴포넌트
export const EditableSliderValue = ({
  value,
  min,
  max,
  onChange,
  disabled,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (val: number) => void;
  disabled?: boolean;
}) => {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const startEditing = () => {
    if (disabled) return;
    setEditing(true);
    setInputValue(String(value));
  };

  const commitValue = () => {
    setEditing(false);
    const parsed = parseFloat(inputValue);
    if (isNaN(parsed)) return;
    const clamped = Math.round(Math.min(max, Math.max(min, parsed)) * 100) / 100;
    onChange(clamped);
  };

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="w-14 flex-none text-sm text-center border border-sky-400 rounded bg-[var(--c-input-bg)] text-default outline-none px-0.5 py-0.5"
        value={inputValue}
        onChange={(e) => {
          const v = e.target.value;
          if (/^[0-9]*\.?[0-9]*$/.test(v)) {
            setInputValue(v);
          }
        }}
        onBlur={commitValue}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commitValue();
          if (e.key === 'Escape') setEditing(false);
        }}
      />
    );
  }

  return (
    <div
      className="w-11 flex-none text-lg text-center back-lllgray cursor-pointer hover:ring-2 hover:ring-sky-400 rounded transition-all"
      onClick={startEditing}
      title="클릭하여 직접 입력"
    >
      {value}
    </div>
  );
};

interface VibeEditorProps {
  disabled: boolean;
}

export const VibeEditor = observer(({ disabled }: VibeEditorProps) => {
  const { curSession } = appState;
  const { preset, shared, editVibe, setEditVibe, meta } =
    useContext(WFElementContext)!;
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  // 패널 폭 적응 — 좁으면 항목을 세로 배치(이미지 위/컨트롤 아래)로 전환
  const narrow = useNarrowContainer(containerRef, editVibe);
  // shared 필드의 fromPreset 항목 = 캐릭터 프리셋 귀속(개별 삭제 대신 프리셋 단위 해제 — W4)
  const isPresetActive = editVibe?.fieldType === 'shared';

  const getField = () => {
    if (editVibe!.fieldType === 'preset') return preset[editVibe!.field];
    if (editVibe!.fieldType === 'shared') return shared[editVibe!.field];
    return meta![editVibe!.field];
  };
  const setField = (val: any) => {
    if (editVibe!.fieldType === 'preset') preset[editVibe!.field] = val;
    else if (editVibe!.fieldType === 'shared') shared[editVibe!.field] = val;
    else meta![editVibe!.field] = val;
  };
  const vibeChange = async (vibe: string) => {
    if (!vibe) return;
    const path = await imageService.storeVibeImage(curSession!, vibe);
    getField().push(
      VibeItem.fromJSON({ path: path, info: 1.0, strength: 0.6 }),
    );
  };

  // Handle paste event (Ctrl+V)
  useEffect(() => {
    if (!editVibe) return;
    const handlePaste = async (e: ClipboardEvent) => {
      if (disabled) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            const reader = new FileReader();
            reader.onload = async (event) => {
              const base64 = (event.target?.result as string)?.split(',')[1];
              if (base64) {
                await vibeChange(base64);
              }
            };
            reader.readAsDataURL(file);
          }
          break;
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [editVibe, disabled, curSession]);

  // Handle drag and drop
  const handleDragEnter = (e: React.DragEvent) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDrop = async (e: React.DragEvent) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = async (event) => {
          const base64 = (event.target?.result as string)?.split(',')[1];
          if (base64) {
            await vibeChange(base64);
          }
        };
        reader.readAsDataURL(file);
      }
    }
  };

  return (
    editVibe && (
      <div
        ref={containerRef}
        className={`w-full h-full overflow-hidden flex flex-col ${isDragging ? 'ring-2 ring-sky-500 bg-sky-50 dark:bg-sky-900/20' : ''}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <div className="flex-1 overflow-hidden">
          <div className="h-full overflow-auto">
            {getField().length === 0 && !isMobile && (
              <div className="flex flex-col items-center justify-center h-full text-faint p-8">
                <FaCloudUploadAlt size={48} className="mb-4 opacity-60" />
                <p className="text-base font-medium mb-1">이미지를 드래그하거나</p>
                <p className="text-base font-medium">Ctrl+V로 붙여넣기 할 수 있습니다</p>
              </div>
            )}
            {getField().map((vibe: VibeItem) => (
              <div
                key={vibe.path}
                className={`border line-color mt-2 p-2 flex gap-2 ${narrow ? 'flex-col' : 'items-begin'}`}
              >
                <VibeImage
                  path={
                    vibe.path &&
                    imageService.getVibeImagePath(curSession!, vibe.path)
                  }
                  className="flex-none w-28 h-28 object-cover"
                />
                <div className="flex flex-col gap-2 w-full min-w-0">
                  <div
                    className={`flex w-full items-center ${narrow ? 'flex-col' : 'md:flex-row flex-col'}`}
                  >
                    <div
                      className={`whitespace-nowrap flex-none gray-label ${narrow ? 'mr-auto' : 'mr-auto md:mr-0'}`}
                    >
                      정보 추출률 (IS):
                    </div>
                    <div
                      className={`flex flex-1 gap-1 min-w-0 ${narrow ? 'w-full' : 'md:w-auto w-full'}`}
                    >
                      <input
                        className="flex-1 min-w-0"
                        type="range"
                        step="0.01"
                        min="0"
                        max="1"
                        value={vibe.info}
                        onChange={(e) => {
                          vibe.info = parseFloat(e.target.value);
                        }}
                        disabled={disabled}
                      />
                      <EditableSliderValue
                        value={vibe.info}
                        min={0}
                        max={1}
                        onChange={(v) => { vibe.info = v; }}
                        disabled={disabled}
                      />
                    </div>
                  </div>
                  <div
                    className={`flex w-full items-center ${narrow ? 'flex-col' : 'md:flex-row flex-col'}`}
                  >
                    <div
                      className={`whitespace-nowrap flex-none gray-label ${narrow ? 'mr-auto' : 'mr-auto md:mr-0'}`}
                    >
                      레퍼런스 강도 (RS):
                    </div>
                    <div
                      className={`flex flex-1 gap-1 min-w-0 ${narrow ? 'w-full' : 'md:w-auto w-full'}`}
                    >
                      <input
                        className="flex-1 min-w-0"
                        type="range"
                        step="0.01"
                        min="0"
                        max="1"
                        value={vibe.strength}
                        onChange={(e) => {
                          vibe.strength = parseFloat(e.target.value);
                        }}
                        disabled={disabled}
                      />
                      <EditableSliderValue
                        value={vibe.strength}
                        min={0}
                        max={1}
                        onChange={(v) => { vibe.strength = v; }}
                        disabled={disabled}
                      />
                    </div>
                  </div>
                  <div className="flex-none flex ml-auto mt-auto min-w-0 max-w-full">
                    {isPresetActive && vibe.fromPreset ? (
                      <Tooltip
                        content={`"${vibe.fromPreset}" 프리셋 해제 — 연결된 캐릭터 프롬프트/레퍼런스 함께 제거`}
                      >
                        <button
                          className="round-button back-gray h-8 px-3 text-xs max-w-full truncate"
                          onClick={() => {
                            if (disabled) return;
                            appState.removeAppliedCharacterPreset(
                              vibe.fromPreset!,
                            );
                          }}
                        >
                          🔒 {vibe.fromPreset}
                          <FaTimes className="ml-1.5" size={11} />
                        </button>
                      </Tooltip>
                    ) : (
                      <Tooltip content="바이브 삭제">
                      <button
                        className={
                          `round-button h-8 px-8 ml-auto ` +
                          (disabled ? 'back-gray' : 'back-red')
                        }
                        onClick={() => {
                          if (disabled) return;
                          setField(getField().filter((x: any) => x !== vibe));
                        }}
                      >
                        <FaTrash />
                      </button>
                      </Tooltip>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex-none mt-auto pt-2 flex flex-col gap-2">
          {getField().length > 0 && !isMobile && (
            <div className="text-xs text-muted text-center">
              이미지를 드래그하거나 Ctrl+V로 붙여넣기 할 수 있습니다
            </div>
          )}
          <div className="flex gap-2 items-center">
            <FileUploadBase64
              notext
              disabled={disabled}
              onFileSelect={vibeChange}
            ></FileUploadBase64>
            <button
              className={`round-button back-gray h-8 w-full`}
              onClick={() => {
                setEditVibe(undefined);
              }}
            >
              바이브 설정 닫기
            </button>
          </div>
        </div>
      </div>
    )
  );
});

export const VibeButton = observer(({ input }: { input: WFIInlineInput }) => {
  const { editVibe, setEditVibe, preset, shared, meta, modelVersion } =
    useContext(WFElementContext)!;
  const iconRow = useContext(PresetIconRowContext);
  const [activeIndex, setActiveIndex] = useState(0);

  const getField = () => {
    if (input.fieldType === 'preset') return preset[input.field];
    if (input.fieldType === 'shared') return shared[input.field];
    return meta![input.field];
  };

  // v4.5에서 캐릭터 레퍼런스에 이미지가 있으면 바이브 잠금
  const hasCharacterReferences = (() => {
    const refs = shared?.characterReferences;
    if (!refs || !Array.isArray(refs)) return false;
    return refs.some((ref: ReferenceItem) => ref.enabled !== false && ref.path);
  })();
  const isV4_5 = modelVersion === ModelVersion.V4_5 || modelVersion === ModelVersion.V4_5Curated;
  const isV5 = modelVersion === ModelVersion.V5 || modelVersion === ModelVersion.V5Curated;
  const locked = isV5 || (isV4_5 && hasCharacterReferences);
  const lockedLabel = isV5
    ? '바이브 이미지 설정 (V5 미지원)'
    : '바이브 이미지 설정 (캐릭터 레퍼런스 사용 중)';

  const onClick = () => {
    if (locked) return;
    setEditVibe(input);
  };

  const handleImageClick = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (locked) return;
    const field = getField();
    if (field.length > 1) {
      setActiveIndex((prev: number) => (prev + 1) % field.length);
    } else {
      onClick();
    }
  };

  const handleOpenEditor = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (locked) return;
    onClick();
  };

  const field = getField();
  const safeActiveIndex = field.length > 0 ? Math.min(activeIndex, field.length - 1) : 0;

  // 동반 슬롯 (E2): 바이브 행(hostKey = wfiElementKey = 인라인 필드 'vibes') 옆에 붙일
  // portable 버튼. 빈 배열이면 슬롯 없음 = 현행 렌더 100% 동일(회귀 기준).
  // hostKey 를 renderCompanionButtons/CompanionHostRow 에 넘겨 편집모드(PC) 드래그(E4)를 붙인다.
  const hostKey = wfiElementKey(input) ?? input.field;
  const companionIds = resolveCompanionButtons(hostKey, appState.uiCompanionSlots);
  const companions = renderCompanionButtons(companionIds, hostKey);
  const hasCompanions = companions.length > 0;

  // 하단 아이콘 행(uiPresetIconRow) 안 — 아이콘+장수 압축 형태. 잠금 의미는 넓은
  // 버튼과 동일(툴팁으로 사유 안내), 동반 버튼은 그대로 이웃.
  if (iconRow) {
    return (
      <CompanionHostRow hostKey={hostKey}>
        <Tooltip
          content={
            locked
              ? lockedLabel
              : '바이브 이미지 설정 열기'
          }
        >
          <button
            className={`round-button h-8 flex-1 !min-w-0 ${locked ? 'back-llgray opacity-50 cursor-not-allowed' : 'back-gray'}`}
            onClick={onClick}
            disabled={locked}
          >
            <FaImages size={14} className="inline-block" />
            {field.length > 0 && (
              <span className="ml-1 text-xs">{field.length}</span>
            )}
          </button>
        </Tooltip>
        {companions}
      </CompanionHostRow>
    );
  }

  return (
    <CompanionHostRow hostKey={hostKey}>
      {editVibe == undefined && getField().length === 0 && (
        hasCompanions ? (
          <div className="w-full mt-2 md:mt-3 flex gap-1 items-stretch">
            <button
              className={`round-button h-8 flex-1 flex ${locked ? 'back-llgray opacity-50 cursor-not-allowed' : 'back-gray'}`}
              onClick={onClick}
              disabled={locked}
            >
              <div className="flex-1">
                {locked ? lockedLabel : '바이브 이미지 설정 열기'}
              </div>
            </button>
            {companions}
          </div>
        ) : (
          <button
            className={`round-button h-8 w-full flex mt-2 md:mt-3 ${locked ? 'back-llgray opacity-50 cursor-not-allowed' : 'back-gray'}`}
            onClick={onClick}
            disabled={locked}
          >
            <div className="flex-1">
              {locked ? lockedLabel : '바이브 이미지 설정 열기'}
            </div>
          </button>
        )
      )}
      {editVibe == undefined && getField().length > 0 && (
        <div className={'w-full flex items-center mt-2 md:mt-3' + (locked ? ' opacity-50' : '')}>
          <div className={'flex-none mr-2 gray-label'}>
            바이브 설정:
            {locked && (
              <span className="ml-1 text-xs text-red-400">(비활성)</span>
            )}
            {!locked && field.length > 1 && (
              <span className="ml-1 text-xs text-sky-500">
                ({safeActiveIndex + 1}/{field.length})
              </span>
            )}
          </div>
          <div className="flex-1 flex gap-1 items-center">
            <VibeImage
              path={imageService.getVibeImagePath(
                appState.curSession!,
                getField()[safeActiveIndex].path,
              )}
              className={'flex-1 h-14 rounded-xl object-cover' + (locked ? ' grayscale' : ' cursor-pointer hover:brightness-95 active:brightness-90')}
              onClick={handleImageClick}
            />
            {!locked && field.length > 1 && (
              <Tooltip content="바이브 편집">
              <button
                className="flex-none px-2 h-14 rounded-lg back-sky text-white text-xs hover:brightness-95 active:brightness-90"
                onClick={handleOpenEditor}
              >
                편집
              </button>
              </Tooltip>
            )}
          </div>
          {hasCompanions && (
            <div className="flex-none flex gap-1 items-center ml-1">
              {companions}
            </div>
          )}
        </div>
      )}
    </CompanionHostRow>
  );
});
