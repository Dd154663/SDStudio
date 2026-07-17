import * as React from 'react';
import { useContext, useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { v4 } from 'uuid';
import { FaCloudUploadAlt, FaTimes, FaToggleOff, FaToggleOn, FaTrash } from 'react-icons/fa';
import { FileUploadBase64 } from './UtilComponents';
import Tooltip from './Tooltip';
import { ReferenceItem } from '../models/types';
import { imageService, isMobile } from '../models';
import { appState } from '../models/AppService';
import { WFIInlineInput, wfiElementKey } from '../models/workflows/WorkFlow';
import { ModelVersion } from '../backends/imageGen';
import { WFElementContext } from './wfElementContext';
import { EditableSliderValue, VibeImage, useNarrowContainer } from './VibeEditor';
import { resolveCompanionButtons } from '../models/companionSlots';
import { renderCompanionButtons } from './PortableToolbarButtons';
import { CompanionHostRow } from './CompanionDnd';

// PreSetEdtior.tsx 에서 분리된 캐릭터 레퍼런스 편집기 계열.
interface CharacterReferenceEditorProps {
  disabled: boolean;
}

// 레퍼런스 기본값 localStorage 키
const REF_DEFAULT_STRENGTH_KEY = 'sdstudio-ref-default-strength';
const REF_DEFAULT_FIDELITY_KEY = 'sdstudio-ref-default-fidelity';
const REF_DEFAULT_TYPE_KEY = 'sdstudio-ref-default-type';

export function getRefDefaults() {
  return {
    strength: parseFloat(localStorage.getItem(REF_DEFAULT_STRENGTH_KEY) || '0.6'),
    fidelity: parseFloat(localStorage.getItem(REF_DEFAULT_FIDELITY_KEY) || '1.0'),
    referenceType: (localStorage.getItem(REF_DEFAULT_TYPE_KEY) || 'character') as
      'character' | 'style' | 'character&style',
  };
}

export const CharacterReferenceEditor = observer(({ disabled }: CharacterReferenceEditorProps) => {
  const { curSession } = appState;
  const { preset, shared, editCharacterReference, setEditCharacterReference, meta } =
    useContext(WFElementContext)!;
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  // 패널 폭 적응 — 좁으면 항목을 세로 배치(이미지 위/컨트롤 아래)로 전환
  const narrow = useNarrowContainer(containerRef, editCharacterReference);
  const [showDefaults, setShowDefaults] = useState(false);
  const [refDefaults, setRefDefaults] = useState(getRefDefaults);
  // shared 필드의 fromPreset 항목 = 캐릭터 프리셋 귀속(개별 삭제 대신 프리셋 단위 해제 — W4)
  const isPresetActive = editCharacterReference?.fieldType === 'shared';

  const updateDefault = (key: string, value: string) => {
    localStorage.setItem(key, value);
    setRefDefaults(getRefDefaults());
  };

  const getField = () => {
    if (editCharacterReference!.fieldType === 'preset') return preset[editCharacterReference!.field];
    if (editCharacterReference!.fieldType === 'shared') return shared[editCharacterReference!.field];
    return meta![editCharacterReference!.field];
  };
  const setField = (val: any) => {
    if (editCharacterReference!.fieldType === 'preset') preset[editCharacterReference!.field] = val;
    else if (editCharacterReference!.fieldType === 'shared') shared[editCharacterReference!.field] = val;
    else meta![editCharacterReference!.field] = val;
  };
  const referenceChange = async (reference: string) => {
    if (!reference) return;
    const path = await imageService.storeReferenceImage(curSession!, reference);
    const defaults = getRefDefaults();
    getField().push(
      ReferenceItem.fromJSON({
        path: path,
        info: 1.0,
        strength: defaults.strength,
        fidelity: defaults.fidelity,
        referenceType: defaults.referenceType,
      }),
    );
  };

  // Handle paste event (Ctrl+V)
  useEffect(() => {
    if (!editCharacterReference) return;
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
                await referenceChange(base64);
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
  }, [editCharacterReference, disabled, curSession]);

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
            await referenceChange(base64);
          }
        };
        reader.readAsDataURL(file);
      }
    }
  };

  return (
    editCharacterReference && (
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
            {/* 기본값 설정 섹션 */}
            <div className="mx-2 mt-2 mb-1">
              <button
                className="text-xs text-muted hover:text-gray-700 dark:hover:text-gray-200 flex items-center gap-1"
                onClick={() => setShowDefaults(!showDefaults)}
              >
                {showDefaults ? '▾' : '▸'} 새 레퍼런스 기본값 설정
              </button>
              {showDefaults && (
                <div className="mt-2 p-3 bg-[var(--c-surface)] rounded-lg space-y-3 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="gray-label w-20 flex-none">Strength:</span>
                    <input
                      type="range"
                      className="flex-1 min-w-0"
                      min="0" max="2" step="0.01"
                      value={refDefaults.strength}
                      onChange={(e) => updateDefault(REF_DEFAULT_STRENGTH_KEY, e.target.value)}
                    />
                    <span className="w-10 text-center text-default">{refDefaults.strength.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="gray-label w-20 flex-none">Fidelity:</span>
                    <input
                      type="range"
                      className="flex-1 min-w-0"
                      min="0" max="2" step="0.01"
                      value={refDefaults.fidelity}
                      onChange={(e) => updateDefault(REF_DEFAULT_FIDELITY_KEY, e.target.value)}
                    />
                    <span className="w-10 text-center text-default">{refDefaults.fidelity.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="gray-label w-20 flex-none">유형:</span>
                    {(['character', 'style', 'character&style'] as const).map((t) => (
                      <label key={t} className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="radio"
                          name="ref-default-type"
                          checked={refDefaults.referenceType === t}
                          onChange={() => updateDefault(REF_DEFAULT_TYPE_KEY, t)}
                          className="accent-sky-500"
                        />
                        <span className="text-default">{t}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {getField().length === 0 && !isMobile && (
              <div className="flex flex-col items-center justify-center h-full text-faint p-8">
                <FaCloudUploadAlt size={48} className="mb-4 opacity-60" />
                <p className="text-base font-medium mb-1">이미지를 드래그하거나</p>
                <p className="text-base font-medium">Ctrl+V로 붙여넣기 할 수 있습니다</p>
              </div>
            )}
            {getField().map((reference: ReferenceItem) => (
              <div
                key={reference.path}
                className={`border mt-2 p-2 flex gap-2 ${narrow ? 'flex-col' : 'items-begin'} ${reference.enabled !== false ? 'border-sky-500 bg-[var(--c-surface-2)]' : 'line-color opacity-60'}`}
              >
                <VibeImage
                  path={
                    reference.path &&
                    imageService.getReferenceImagePath(curSession!, reference.path)
                  }
                  className="flex-none w-28 h-28 object-cover"
                />
                <div className="flex flex-col gap-2 w-full min-w-0">
                  <div className="flex w-full items-center justify-between gap-1 min-w-0">
                    <div className="flex gap-2 items-center min-w-0">
                      {isPresetActive && reference.fromPreset ? (
                        <Tooltip
                          content={`"${reference.fromPreset}" 프리셋 해제 — 연결된 캐릭터 프롬프트/바이브 함께 제거`}
                        >
                          <button
                            className="round-button back-gray h-8 px-3 text-xs max-w-full truncate"
                            onClick={() => {
                              if (disabled) return;
                              appState.removeAppliedCharacterPreset(
                                reference.fromPreset!,
                              );
                            }}
                          >
                            🔒 {reference.fromPreset}
                            <FaTimes className="ml-1.5" size={11} />
                          </button>
                        </Tooltip>
                      ) : (
                        <button
                          className={`round-button h-8 px-4 ${reference.enabled !== false ? 'back-sky' : 'back-gray'}`}
                          onClick={() => {
                            if (disabled) return;
                            reference.enabled = reference.enabled === false;
                          }}
                          disabled={disabled}
                        >
                          {reference.enabled !== false ? <FaToggleOn className="mr-1" /> : <FaToggleOff className="mr-1" />}
                          {reference.enabled !== false ? '활성화됨' : '비활성화됨'}
                        </button>
                      )}
                    </div>
                    {!(isPresetActive && reference.fromPreset) && (
                      <Tooltip content="레퍼런스 삭제">
                      <button
                        className={
                          `round-button h-8 px-4 ` +
                          (disabled ? 'back-gray' : 'back-red')
                        }
                        onClick={() => {
                          if (disabled) return;
                          setField(getField().filter((x: any) => x !== reference));
                        }}
                      >
                        <FaTrash />
                      </button>
                      </Tooltip>
                    )}
                  </div>
                  <div
                    className={`flex w-full items-center ${narrow ? 'flex-col' : 'md:flex-row flex-col'}`}
                  >
                    <div
                      className={`whitespace-nowrap flex-none gray-label ${narrow ? 'mr-auto' : 'mr-auto md:mr-0'}`}
                    >
                      Strength:
                    </div>
                    <div
                      className={`flex flex-1 gap-1 min-w-0 ${narrow ? 'w-full' : 'md:w-auto w-full'}`}
                    >
                      <input
                        className="flex-1 min-w-0"
                        type="range"
                        step="0.01"
                        min="0"
                        max="2"
                        value={reference.strength}
                        onChange={(e) => {
                          reference.strength = parseFloat(e.target.value);
                        }}
                        disabled={disabled}
                      />
                      <EditableSliderValue
                        value={reference.strength}
                        min={0}
                        max={2}
                        onChange={(v) => { reference.strength = v; }}
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
                      Fidelity:
                    </div>
                    <div
                      className={`flex flex-1 gap-1 min-w-0 ${narrow ? 'w-full' : 'md:w-auto w-full'}`}
                    >
                      <input
                        className="flex-1 min-w-0"
                        type="range"
                        step="0.01"
                        min="0"
                        max="2"
                        value={reference.fidelity}
                        onChange={(e) => {
                          reference.fidelity = parseFloat(e.target.value);
                        }}
                        disabled={disabled}
                      />
                      <EditableSliderValue
                        value={reference.fidelity}
                        min={0}
                        max={2}
                        onChange={(v) => { reference.fidelity = v; }}
                        disabled={disabled}
                      />
                    </div>
                  </div>
                  <div className="flex w-full md:flex-row flex-col items-center mt-2">
                    <div className="flex gap-4 items-center flex-wrap">
                      <label className="flex gap-1 items-center cursor-pointer">
                        <input
                          type="radio"
                          name={`refType-${reference.path}`}
                          checked={reference.referenceType === 'character'}
                          onChange={() => {
                            reference.referenceType = 'character';
                          }}
                          disabled={disabled}
                        />
                        <span className="gray-label">캐릭터</span>
                      </label>
                      <label className="flex gap-1 items-center cursor-pointer">
                        <input
                          type="radio"
                          name={`refType-${reference.path}`}
                          checked={reference.referenceType === 'style'}
                          onChange={() => {
                            reference.referenceType = 'style';
                          }}
                          disabled={disabled}
                        />
                        <span className="gray-label">스타일</span>
                      </label>
                      <label className="flex gap-1 items-center cursor-pointer">
                        <input
                          type="radio"
                          name={`refType-${reference.path}`}
                          checked={reference.referenceType === 'character&style'}
                          onChange={() => {
                            reference.referenceType = 'character&style';
                          }}
                          disabled={disabled}
                        />
                        <span className="gray-label">캐릭터+스타일</span>
                      </label>
                    </div>
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
              onFileSelect={referenceChange}
            ></FileUploadBase64>
            <button
              className={`round-button back-gray h-8 w-full`}
              onClick={() => {
                setEditCharacterReference(undefined);
              }}
            >
              캐릭터 레퍼런스 설정 닫기
            </button>
          </div>
        </div>
      </div>
    )
  );
});

export const CharacterReferenceButton = observer(({ input }: { input: WFIInlineInput }) => {
  const { editCharacterReference, setEditCharacterReference, preset, shared, meta, modelVersion } =
    useContext(WFElementContext)!;
  const [activeIndex, setActiveIndex] = useState(0);

  const getField = () => {
    if (input.fieldType === 'preset') return preset[input.field] || [];
    if (input.fieldType === 'shared') return shared[input.field] || [];
    return meta![input.field] || [];
  };

  // v4 모델은 캐릭터 레퍼런스 미지원
  const isV4 = modelVersion === ModelVersion.V4 || modelVersion === ModelVersion.V4Curated;
  const locked = isV4;

  const onClick = () => {
    if (locked) return;
    setEditCharacterReference(input);
  };

  const handleImageClick = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (locked) return;
    const enabledRefs = getField().filter((ref: ReferenceItem) => ref.enabled !== false);
    if (enabledRefs.length > 1) {
      setActiveIndex((prev: number) => (prev + 1) % enabledRefs.length);
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
  const enabledRefs = field.filter((ref: ReferenceItem) => ref.enabled !== false);
  const safeActiveIndex = enabledRefs.length > 0 ? Math.min(activeIndex, enabledRefs.length - 1) : 0;

  const currentReference = enabledRefs.length > 0 ? enabledRefs[safeActiveIndex] : null;
  const hasValidPath = currentReference && currentReference.path;

  // 동반 슬롯 (E2): 레퍼런스 행(hostKey = wfiElementKey = 인라인 필드 'characterReferences')
  // 옆에 붙일 portable 버튼. 빈 배열이면 슬롯 없음 = 현행 렌더 100% 동일(회귀 기준).
  // hostKey 를 renderCompanionButtons/CompanionHostRow 에 넘겨 편집모드(PC) 드래그(E4)를 붙인다.
  const hostKey = wfiElementKey(input) ?? input.field;
  const companionIds = resolveCompanionButtons(hostKey, appState.uiCompanionSlots);
  const companions = renderCompanionButtons(companionIds, hostKey);
  const hasCompanions = companions.length > 0;

  return (
    <CompanionHostRow hostKey={hostKey}>
      {editCharacterReference == undefined && field.length === 0 && (
        hasCompanions ? (
          <div className="w-full mt-2 md:mt-3 flex gap-1 items-stretch">
            <button
              className={`round-button h-8 flex-1 flex ${locked ? 'back-llgray opacity-50 cursor-not-allowed' : 'back-gray'}`}
              onClick={onClick}
              disabled={locked}
            >
              <div className="flex-1">
                {locked ? '캐릭터 레퍼런스 (v4 모델 미지원)' : '캐릭터 레퍼런스 설정 열기'}
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
              {locked ? '캐릭터 레퍼런스 (v4 모델 미지원)' : '캐릭터 레퍼런스 설정 열기'}
            </div>
          </button>
        )
      )}
      {editCharacterReference == undefined && field.length > 0 && (
        <div className={'w-full flex items-center mt-2 md:mt-3' + (locked ? ' opacity-50' : '')}>
          <div className={'flex-none mr-2 gray-label'}>
            레퍼런스 설정:
            {locked ? (
              <span className="ml-1 text-xs text-red-400">(v4 미지원)</span>
            ) : (
              <span className="ml-1 text-xs text-sky-500">
                ({enabledRefs.length}/{field.length} 활성화)
              </span>
            )}
          </div>
          <div className="flex-1 flex gap-1 items-center">
            {hasValidPath ? (
              <VibeImage
                path={imageService.getReferenceImagePath(
                  appState.curSession!,
                  currentReference.path,
                )}
                className={'flex-1 h-14 rounded-xl object-cover' + (locked ? ' grayscale' : ' cursor-pointer hover:brightness-95 active:brightness-90')}
                onClick={handleImageClick}
              />
            ) : (
              <div
                className={'flex-1 h-14 rounded-xl bg-[var(--c-surface)] flex items-center justify-center text-muted' + (locked ? '' : ' cursor-pointer hover:brightness-95 active:brightness-90')}
                onClick={handleImageClick}
              >
                {locked ? 'v4 모델 미지원' : enabledRefs.length === 0 ? '활성화된 이미지 없음' : '이미지 없음'}
              </div>
            )}
            {!locked && (
              <Tooltip content="레퍼런스 편집">
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
