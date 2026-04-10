import * as React from 'react';
import { useContext, useEffect, useState } from 'react';
import * as mobx from 'mobx';
import {
  TextAreaWithUndo,
  NumberSelect,
  Collapsible,
  FileUploadBase64,
  DropdownSelect,
} from './UtilComponents';
import { NoiseSchedule, Resolution, Sampling } from '../backends/imageGen';
import PromptEditTextArea from './PromptEditTextArea';
import {
  FaCopy,
  FaFont,
  FaImage,
  FaPlus,
  FaShare,
  FaStar,
  FaTrash,
  FaTrashAlt,
  FaUserAlt,
  FaArrowsAlt,
  FaToggleOn,
  FaToggleOff,
  FaFolderOpen,
} from 'react-icons/fa';
import { FloatView } from './FloatView';
import { v4 } from 'uuid';
import { BigPromptEditor, SlotPiece } from './SceneEditor';
import { useContextMenu } from 'react-contexify';
import {
  CharacterPrompt,
  ContextMenuType,
  PromptNode,
  PromptPiece,
  ReferenceItem,
  Scene,
  VibeItem,
} from '../models/types';
import {
  sessionService,
  imageService,
  backend,
  promptService,
  taskQueueService,
  workFlowService,
  isMobile,
} from '../models';
import { toPARR } from '../models/PromptService';
import { appState } from '../models/AppService';
import { observer } from 'mobx-react-lite';
import {
  WFAbstractVar,
  WFIElement,
  WFIGroup,
  WFIIfIn,
  WFIInlineInput,
  WFIMiddlePlaceholderInput,
  WFIPush,
  WFISceneOnly,
  WFIShowImage,
  WFIStack,
  WFVar,
  WorkFlowDef,
} from '../models/workflows/WorkFlow';
import { StackFixed, StackGrow, VerticalStack } from './LayoutComponents';
import Tooltip from './Tooltip';
import ModalOverlay from './ModalOverlay';
import { FaCloudUploadAlt } from 'react-icons/fa';
import { ModelVersion } from '../backends/imageGen';

const ImageSelect = observer(({ input }: { input: WFIInlineInput }) => {
  const { curSession } = appState;
  const { type, preset, shared, meta, editVibe } =
    useContext(WFElementContext)!;
  const getField = () => {
    if (input.fieldType === 'preset') return preset[input.field];
    if (input.fieldType === 'shared') return shared[input.field];
    return meta![input.field];
  };
  const setField = (val: any) => {
    if (input.fieldType === 'preset') preset[input.field] = val;
    else if (input.fieldType === 'shared') shared[input.field] = val;
    else meta![input.field] = val;
  };
  return (
    <div className="inline-flex md:flex gap-3 items-center flex-none text-eplsis overflow-hidden gap-3 mb-1 mt-2">
      <span className="gray-label">{input.label}: </span>
      <div className="w-24 md:w-48">
        <FileUploadBase64
          onFileSelect={async (file: string) => {
            if (!getField()) {
              const path = await imageService.storeVibeImage(curSession!, file);
              setField(path);
            } else {
              await imageService.writeVibeImage(curSession!, getField(), file);
            }
          }}
        ></FileUploadBase64>
      </div>
      {!isMobile && (
        <button
          className={`round-button back-sky`}
          onClick={() => {
            if (!getField()) return;
            const path = imageService.getVibeImagePath(curSession!, getField());
            backend.openImageEditor(path);
            backend.watchImage(path);
          }}
        >
          {input.label} 편집
        </button>
      )}
    </div>
  );
});

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
          <span className="text-xs text-gray-500 dark:text-gray-400 text-center px-1 select-none">
            NO IMAGE
          </span>
        </div>
      )}
    </>
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
              <div className="flex flex-col items-center justify-center h-full text-gray-400 dark:text-gray-500 p-8">
                <FaCloudUploadAlt size={48} className="mb-4 opacity-60" />
                <p className="text-base font-medium mb-1">이미지를 드래그하거나</p>
                <p className="text-base font-medium">Ctrl+V로 붙여넣기 할 수 있습니다</p>
              </div>
            )}
            {getField().map((vibe: VibeItem) => (
              <div
                key={vibe.path}
                className="border border-gray-300 mt-2 p-2 flex gap-2 items-begin"
              >
                <VibeImage
                  path={
                    vibe.path &&
                    imageService.getVibeImagePath(curSession!, vibe.path)
                  }
                  className="flex-none w-28 h-28 object-cover"
                />
                <div className="flex flex-col gap-2 w-full">
                  <div className="flex w-full items-center md:flex-row flex-col">
                    <div
                      className={
                        'whitespace-nowrap flex-none mr-auto md:mr-0 gray-label'
                      }
                    >
                      정보 추출률 (IS):
                    </div>
                    <div className="flex flex-1 md:w-auto w-full gap-1">
                      <input
                        className="flex-1"
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
                      <div className="w-11 flex-none text-lg text-center back-lllgray">
                        {vibe.info}
                      </div>
                    </div>
                  </div>
                  <div className="flex w-full md:flex-row flex-col items-center">
                    <div
                      className={
                        'whitepace-nowrap flex-none mr-auto md:mr-0 gray-label'
                      }
                    >
                      레퍼런스 강도 (RS):
                    </div>
                    <div className="flex flex-1 md:w-auto w-full gap-1">
                      <input
                        className="flex-1"
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
                      <div className="w-11 flex-none text-lg text-center back-lllgray">
                        {vibe.strength}
                      </div>
                    </div>
                  </div>
                  <div className="flex-none flex ml-auto mt-auto">
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
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex-none mt-auto pt-2 flex flex-col gap-2">
          {getField().length > 0 && !isMobile && (
            <div className="text-xs text-gray-500 dark:text-gray-400 text-center">
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

export const VibeButton = ({ input }: { input: WFIInlineInput }) => {
  const { editVibe, setEditVibe, preset, shared, meta, modelVersion } =
    useContext(WFElementContext)!;
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
  const locked = isV4_5 && hasCharacterReferences;

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

  return (
    <>
      {editVibe == undefined && getField().length === 0 && (
        <button
          className={`round-button h-8 w-full flex mt-2 ${locked ? 'back-llgray opacity-50 cursor-not-allowed' : 'back-gray'}`}
          onClick={onClick}
          disabled={locked}
        >
          <div className="flex-1">
            {locked ? '바이브 이미지 설정 (캐릭터 레퍼런스 사용 중)' : '바이브 이미지 설정 열기'}
          </div>
        </button>
      )}
      {editVibe == undefined && getField().length > 0 && (
        <div className={'w-full flex items-center mt-2' + (locked ? ' opacity-50' : '')}>
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
        </div>
      )}
    </>
  );
};

interface CharacterReferenceEditorProps {
  disabled: boolean;
}

export const CharacterReferenceEditor = observer(({ disabled }: CharacterReferenceEditorProps) => {
  const { curSession } = appState;
  const { preset, shared, editCharacterReference, setEditCharacterReference, meta } =
    useContext(WFElementContext)!;
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

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
    getField().push(
      ReferenceItem.fromJSON({
        path: path,
        info: 1.0,
        strength: 0.6,
        fidelity: 1.0,
        referenceType: 'character'
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
            {getField().length === 0 && !isMobile && (
              <div className="flex flex-col items-center justify-center h-full text-gray-400 dark:text-gray-500 p-8">
                <FaCloudUploadAlt size={48} className="mb-4 opacity-60" />
                <p className="text-base font-medium mb-1">이미지를 드래그하거나</p>
                <p className="text-base font-medium">Ctrl+V로 붙여넣기 할 수 있습니다</p>
              </div>
            )}
            {getField().map((reference: ReferenceItem) => (
              <div
                key={reference.path}
                className={`border mt-2 p-2 flex gap-2 items-begin ${reference.enabled !== false ? 'border-sky-500 bg-sky-50 dark:bg-sky-900/20' : 'border-gray-300 opacity-60'}`}
              >
                <VibeImage
                  path={
                    reference.path &&
                    imageService.getReferenceImagePath(curSession!, reference.path)
                  }
                  className="flex-none w-28 h-28 object-cover"
                />
                <div className="flex flex-col gap-2 w-full">
                  <div className="flex w-full items-center justify-between">
                    <div className="flex gap-2 items-center">
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
                    </div>
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
                  </div>
                  <div className="flex w-full md:flex-row flex-col items-center">
                    <div
                      className={
                        'whitespace-nowrap flex-none mr-auto md:mr-0 gray-label'
                      }
                    >
                      Strength:
                    </div>
                    <div className="flex flex-1 md:w-auto w-full gap-1">
                      <input
                        className="flex-1"
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
                      <div className="w-11 flex-none text-lg text-center back-lllgray">
                        {reference.strength}
                      </div>
                    </div>
                  </div>
                  <div className="flex w-full md:flex-row flex-col items-center">
                    <div
                      className={
                        'whitespace-nowrap flex-none mr-auto md:mr-0 gray-label'
                      }
                    >
                      Fidelity:
                    </div>
                    <div className="flex flex-1 md:w-auto w-full gap-1">
                      <input
                        className="flex-1"
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
                      <div className="w-11 flex-none text-lg text-center back-lllgray">
                        {reference.fidelity}
                      </div>
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
            <div className="text-xs text-gray-500 dark:text-gray-400 text-center">
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

export const CharacterReferenceButton = ({ input }: { input: WFIInlineInput }) => {
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

  return (
    <>
      {editCharacterReference == undefined && field.length === 0 && (
        <button
          className={`round-button h-8 w-full flex mt-2 ${locked ? 'back-llgray opacity-50 cursor-not-allowed' : 'back-gray'}`}
          onClick={onClick}
          disabled={locked}
        >
          <div className="flex-1">
            {locked ? '캐릭터 레퍼런스 (v4 모델 미지원)' : '캐릭터 레퍼런스 설정 열기'}
          </div>
        </button>
      )}
      {editCharacterReference == undefined && field.length > 0 && (
        <div className={'w-full flex items-center mt-2' + (locked ? ' opacity-50' : '')}>
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
                className={'flex-1 h-14 rounded-xl bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-gray-500' + (locked ? '' : ' cursor-pointer hover:brightness-95 active:brightness-90')}
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
        </div>
      )}
    </>
  );
};

const EditorField = ({
  label,
  full,
  children,
  bold,
}: {
  label: string;
  children: React.ReactNode;
  full: boolean;
  bold?: boolean;
}) => {
  return (
    <>
      <div className={'pt-2 pb-1 gray-label'}>
        {bold ? <b>{label}</b> : label}
      </div>
      <div className={full ? 'flex-1 min-h-0' : 'flex-none mt-3'}>
        {children}
      </div>
    </>
  );
};

const InlineEditorField = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => {
  return (
    <div className="pt-2 flex gap-2 items-center">
      <span className={'flex-none gray-label'}>{label}:</span>
      {children}
    </div>
  );
};

interface InnerEditorProps {
  type: string;
  shared: any;
  preset: any;
}

const InnerEditor: React.FC<InnerEditorProps> = ({ type, shared, preset }) => {
  const { curSession } = appState;
  const prompt = React.useRef<string>('');
  const presets = curSession!.presets.get(type)!;
  const getPrompt = () => prompt.current;
  const setPrompt = (txt: string) => {
    prompt.current = txt;
  };
  const [name, setName] = useState(preset.name);
  const queueprompt = async (
    middle: string,
    callback: (path: string) => void,
  ) => {
    let scene = curSession!.getScene('scene', 'style_test') as
      | Scene
      | undefined;
    if (!scene) {
      scene = new Scene();
      scene.name = 'style_test';
      curSession!.addScene(scene);
    }
    scene.resolution = 'portrait';
    scene.slots = [
      [
        PromptPiece.fromJSON({
          enabled: true,
          prompt: middle,
          characterPrompts: [],
          id: v4(),
        }),
      ],
    ];
    const dummyShared = workFlowService.buildShared(type);
    const prompts = await workFlowService.createPrompts(
      type,
      curSession!,
      scene,
      preset,
      dummyShared,
    );
    const characterPrompts = await workFlowService.createCharacterPrompts(
      type,
      curSession!,
      scene,
      preset,
      dummyShared,
    );
    await workFlowService.pushJob(
      type,
      curSession!,
      scene,
      prompts[0],
      characterPrompts[0],
      preset,
      dummyShared,
      1,
      undefined,
      callback,
      true,
    );
    taskQueueService.run();
  };
  const setMainImage = async (path: string) => {
    const newPath = imageService.getVibesDir(curSession!) + '/' + v4() + '.png';
    await backend.copyFile(path, newPath);
    preset.profile = newPath.split('/').pop()!;
  };
  return (
    <div className="flex flex-col h-full">
      <div className="grow-0 pt-1 px-2 flex gap-2 items-center text-nowrap flex-wrap mb-1 md:mb-0">
        <div className="flex items-center gap-2">
          <label className="gray-label">그림체 이름:</label>
          <input
            className="gray-input"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </div>
        <button
          className={`round-button back-sky`}
          onClick={async () => {
            if (presets.find((x) => x.name === name)) {
              appState.pushMessage('이미 존재하는 그림체 이름입니다');
              return;
            }
            if (curSession!.selectedWorkflow?.presetName === preset.name) {
              preset.name = name;
              curSession!.selectedWorkflow = {
                workflowType: type,
                presetName: name,
              };
            } else {
              preset.name = name;
            }
          }}
        >
          이름변경
        </button>
      </div>
      <div className="flex-1 overflow-hidden p-2">
        <BigPromptEditor
          key="bigprompt"
          general={false}
          type={type}
          preset={preset}
          shared={shared}
          getMiddlePrompt={getPrompt}
          setMiddlePrompt={setPrompt}
          getCharacterMiddlePrompt={() => ''}
          setCharacterMiddlePrompt={() => {}}
          queuePrompt={queueprompt}
          setMainImage={setMainImage}
          initialImagePath={undefined}
        />
      </div>
    </div>
  );
};

const ProfilePreSetSelect = observer(({}) => {
  const { curSession } = appState;
  const { preset, type, shared, middlePromptMode } =
    useContext(WFElementContext)!;
  const presets = curSession!.presets.get(type)!;
  const [selected, setSelected] = useState<any | undefined>(undefined);
  const { show, hideAll } = useContextMenu({
    id: ContextMenuType.Style,
  });
  const containerRef = React.useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onStyleEdit = (e: any) => {
      if (e.detail.container !== containerRef.current) return;
      setSelected(e.detail.preset);
    };
    sessionService.addEventListener('style-edit', onStyleEdit);
    return () => {
      sessionService.removeEventListener('style-edit', onStyleEdit);
    };
  });

  return (
    <div
      ref={containerRef}
      className={
        'mt-2 overflow-hidden min-h-0 ' + (middlePromptMode ? 'h-1/5' : 'h-1/3')
      }
    >
      {selected && (
        <FloatView
          priority={1}
          onEscape={() => {
            setSelected(undefined);
          }}
        >
          <InnerEditor type={type} shared={shared} preset={selected} />
        </FloatView>
      )}
      <div className="h-full w-full flex overflow-auto gap-2">
        {presets.map((x) => (
          <div
            className={
              'h-full relative flex-none hover:brightness-95 active:brightness-90 cursor-pointer ' +
              (x == preset ? 'border-2 border-sky-500' : 'border-2 line-color')
            }
            key={x.name}
            onContextMenu={(e) => {
              show({
                event: e,
                props: {
                  ctx: {
                    type: 'style',
                    preset: x,
                    session: curSession!,
                    container: containerRef.current!,
                  },
                },
              });
            }}
            onClick={() => {
              curSession!.selectedWorkflow = {
                workflowType: type,
                presetName: x.name,
              };
            }}
          >
            {x.profile && (
              <VibeImage
                path={
                  imageService.getVibesDir(curSession!) +
                  '/' +
                  x.profile.split('/').pop()!
                }
                className="w-auto h-full"
              />
            )}
            {!x.profile && <div className="w-40 h-full"></div>}
            <div
              className="absolute bottom-0 right-0 bg-gray-700 opacity-80 text-sm text-white p-1 rounded-xl m-2 truncate select-none"
              style={{ maxWidth: '90%' }}
            >
              {x.name}
            </div>
          </div>
        ))}
        <div className="h-full relative flex-none flex flex-col gap-2">
          <Tooltip content="새 그림체 추가">
          <div
            className="flex-1 w-10 flex m-4 items-center justify-center rounded-xl clickable back-lllgray"
            onClick={async () => {
              const name = await appState.pushDialogAsync({
                type: 'input-confirm',
                text: '그림체 이름을 입력하세요',
              });
              if (!name) return;
              if (presets.find((x) => x.name === name)) {
                appState.pushMessage('이미 존재하는 그림체 이름입니다');
                return;
              }
              const newPreset = workFlowService.buildPreset(type);
              newPreset.name = name;
              presets.push(newPreset);
            }}
          >
            <FaPlus />
          </div>
          </Tooltip>
          <Tooltip content="여러 그림체 파일 가져오기">
          <div
            className="flex-1 w-10 flex m-4 items-center justify-center rounded-xl clickable back-lllgray"
            onClick={async () => {
              await appState.importMultiplePresets();
            }}
          >
            <FaFolderOpen />
          </div>
          </Tooltip>
          <Tooltip content="글로벌 프리셋에서 가져오기">
          <div
            className="flex-1 w-10 flex m-4 items-center justify-center rounded-xl clickable back-lllgray"
            onClick={() => {
              appState.openGlobalPresetPicker('SDImageGenEasy');
            }}
          >
            <FaStar />
          </div>
          </Tooltip>
        </div>
      </div>
    </div>
  );
});

const IntSliderInput = ({
  label,
  value,
  onChange,
  disabled,
  step,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (val: number) => void;
  disabled: boolean;
  step: number;
  min: number;
  max: number;
}) => {
  return (
    <div className="flex w-full items-center md:flex-row flex-col mt-2 gap-2">
      <div className={'whitespace-nowrap flex-none mr-auto md:mr-0 gray-label'}>
        {label}:
      </div>
      <div className="flex flex-1 md:w-auto w-full gap-1">
        <input
          className="flex-1"
          type="range"
          step={step}
          min={min}
          max={max}
          value={value}
          onChange={(e) => {
            onChange(parseFloat(e.target.value));
          }}
          disabled={disabled}
        />
        <div className="w-11 flex-none text-lg text-center back-lllgray">
          {value}
        </div>
      </div>
    </div>
  );
};

const PreSetSelect = observer(({ workflowType }: { workflowType: string }) => {
  const curSession = appState.curSession!;
  const [isOpen, setIsOpen] = useState(false);
  const clicked = React.useRef(false);
  const presets = curSession.presets.get(workflowType)!;
  const { preset } = useContext(WFElementContext)!;
  useEffect(() => {
    const close = () => {
      if (!clicked.current) setIsOpen(false);
      else clicked.current = false;
    };
    window.addEventListener('click', close);
    return () => {
      window.removeEventListener('click', close);
    };
  });
  return (
    <div className="flex gap-2 mt-2 items-center relative">
      <div className="flex-none gray-label">사전세팅선택:</div>
      <div
        className="round-button back-gray h-9 w-full"
        onClick={() => {
          setIsOpen(!isOpen);
          clicked.current = true;
        }}
      >
        {curSession.selectedWorkflow?.presetName}
      </div>
      <button
        className={`icon-button`}
        onClick={async () => {
          const name = await appState.pushDialogAsync({
            type: 'input-confirm',
            text: '사전 세팅 이름을 입력하세요',
          });
          if (!name) return;
          if (presets.find((x) => x.name === name)) {
            appState.pushMessage('이미 존재하는 사전 세팅 이름입니다');
            return;
          }
          const newPreset = workFlowService.buildPreset(workflowType);
          newPreset.name = name;
          curSession.addPreset(newPreset);
          curSession.selectedWorkflow = {
            workflowType: workflowType,
            presetName: name,
          };
        }}
      >
        <FaPlus />
      </button>
      {workflowType === 'SDImageGen' && (
        <Tooltip content="글로벌 프리셋에서 가져오기">
          <button
            className={`icon-button`}
            onClick={() => {
              appState.openGlobalPresetPicker('SDImageGen');
            }}
          >
            <FaStar />
          </button>
        </Tooltip>
      )}
      {isOpen && (
        <ul className="left-0 top-10 absolute max-h-60 z-20 w-full mt-1 bg-white border-2 border-gray-300 dark:border-slate-600 rounded-md shadow-lg overflow-auto dark:bg-slate-700">
          {presets.map((option) => (
            <li
              key={option.name}
              className="text-default flex items-center justify-between p-2 clickable bg-white dark:bg-slate-700"
            >
              <button
                onClick={() => {
                  curSession.selectedWorkflow = {
                    workflowType: workflowType,
                    presetName: option.name,
                  };
                }}
                className="w-full text-left"
              >
                {option.name}
              </button>
              <div className="flex">
                <button
                  onClick={async () => {
                    const newName = await appState.pushDialogAsync({
                      type: 'input-confirm',
                      text: '새 사전 세팅 이름을 입력하세요',
                    });
                    if (!newName) return;
                    if (presets.find((x) => x.name === newName)) {
                      appState.pushMessage(
                        '이미 존재하는 사전 세팅 이름입니다',
                      );
                      return;
                    }
                    if (
                      curSession.selectedWorkflow?.presetName === option.name
                    ) {
                      option.name = newName;
                      curSession.selectedWorkflow = {
                        workflowType: workflowType,
                        presetName: newName,
                      };
                    } else {
                      option.name = newName;
                    }
                  }}
                  className="p-2 mx-1 icon-button bg-green-500"
                >
                  <FaFont />
                </button>
                <Tooltip content="그림체 복제">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const newPreset = workFlowService.presetFromJSON(
                      preset.toJSON(),
                    );
                    let num = 1;
                    while (
                      presets.find(
                        (x) =>
                          x.name === preset.name + ' copy ' + num.toString(),
                      )
                    ) {
                      num++;
                    }
                    const newName = preset.name + ' copy ' + num.toString();
                    newPreset.name = newName;
                    curSession!.addPreset(newPreset);
                  }}
                  className="p-2 mx-1 icon-button bg-sky-500"
                >
                  <FaCopy />
                </button>
                </Tooltip>
                <Tooltip content="그림체 내보내기">
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    await appState.exportPreset(curSession, option);
                  }}
                  className="p-2 mx-1 icon-button bg-orange-500"
                >
                  <FaShare />
                </button>
                </Tooltip>
                {(workflowType === 'SDImageGen' ||
                  workflowType === 'SDImageGenEasy') && (
                  <Tooltip content="글로벌 프리셋으로 저장">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        appState.exportPresetToGlobal(curSession, option);
                      }}
                      className="p-2 mx-1 icon-button bg-yellow-500"
                    >
                      <FaStar />
                    </button>
                  </Tooltip>
                )}
                <Tooltip content="그림체 삭제">
                <button
                  onClick={() => {
                    if (presets.length === 1) {
                      appState.pushMessage(
                        '마지막 사전 세팅은 삭제할 수 없습니다',
                      );
                      return;
                    }
                    appState.pushDialog({
                      type: 'confirm',
                      text: '정말로 사전 세팅을 삭제하시겠습니까?',
                      callback: () => {
                        curSession!.removePreset(workflowType, option.name);
                        curSession!.selectedWorkflow = {
                          workflowType: workflowType,
                          presetName: undefined,
                        };
                      },
                    });
                  }}
                  className="p-2 mx-1 icon-button bg-red-500"
                >
                  <FaTrash />
                </button>
                </Tooltip>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});

interface NullIntInputProps {
  label: string;
  value: number | null;
  disabled: boolean;
  onChange: (val: number | undefined) => void;
}

const NullIntInput = ({
  label,
  value,
  onChange,
  disabled,
}: NullIntInputProps) => {
  return (
    <input
      className={`w-full gray-input`}
      disabled={disabled}
      value={value ? value.toString() : ''}
      onChange={(e) => {
        try {
          const num = parseInt(e.target.value);
          if (e.target.value === '') throw new Error('No seed');
          if (isNaN(num)) throw new Error('Invalid seed');
          if (!Number.isInteger(num))
            throw new Error('Seed must be an integer');
          if (num <= 0) throw new Error('Seed must be positive');
          onChange(num);
        } catch (e) {
          onChange(undefined);
        }
      }}
    />
  );
};

interface IWFElementContext {
  preset: any;
  shared: any;
  meta?: any;
  type: string;
  middlePromptMode: boolean;
  editVibe: WFIInlineInput | undefined;
  setEditVibe: (vibe: WFIInlineInput | undefined) => void;
  editCharacterReference: WFIInlineInput | undefined;
  setEditCharacterReference: (reference: WFIInlineInput | undefined) => void;
  editCharacters: string | undefined;
  setEditCharacters: (field: string | undefined) => void;
  showGroup?: string;
  setShowGroup: (group: string | undefined) => void;
  showGroupOverlay?: string;
  setShowGroupOverlay: (group: string | undefined) => void;
  groupElement?: WFIGroup;
  getMiddlePrompt?: () => string;
  onMiddlePromptChange?: (txt: string) => void;
  getCharacterMiddlePrompt?: (index: number) => string;
  onCharacterMiddlePromptChange?: (index: number, txt: string) => void;
  modelVersion: ModelVersion;
}

interface WFElementProps {
  element: WFIElement;
}

const WFElementContext = React.createContext<IWFElementContext | null>(null);

interface IWFGroupContext {
  curGroup?: string;
}

const WFGroupContext = React.createContext<IWFGroupContext | null>(null);

const WFRenderElement = observer(({ element }: WFElementProps) => {
  switch (element.type) {
    case 'stack':
      return <WFRStack element={element} />;
    case 'inline':
      return <WFRInline element={element} />;
    case 'group':
      return <WFRGroup element={element} />;
    case 'presetSelect':
      return <WFRPresetSelect element={element} />;
    case 'profilePresetSelect':
      return <WFRProfilePresetSelect element={element} />;
    case 'push':
      return <WFRPush element={element} />;
    case 'middlePlaceholder':
      return <WFRMiddlePlaceholder element={element} />;
    case 'showImage':
      return <WFRShowImage element={element} />;
    case 'ifIn':
      return <WFRIfIn element={element} />;
    case 'sceneOnly':
      return <WFRSceneOnly element={element} />;
  }
});

const WFRSceneOnly = observer(({ element }: WFElementProps) => {
  const { type, shared, preset, meta, editVibe, showGroup } =
    useContext(WFElementContext)!;
  const { curGroup } = useContext(WFGroupContext)!;
  const input = element as WFISceneOnly;
  if (editVibe != undefined || curGroup !== showGroup) {
    return <></>;
  }
  if (!meta) {
    return <></>;
  }
  return <WFRenderElement element={input.element} />;
});

const WFRIfIn = observer(({ element }: WFElementProps) => {
  const { type, shared, preset, meta, showGroup, editVibe } =
    useContext(WFElementContext)!;
  const { curGroup } = useContext(WFGroupContext)!;
  const input = element as WFIIfIn;
  const getField = () => {
    if (input.fieldType === 'preset') return preset[input.field];
    if (input.fieldType === 'shared') return shared[input.field];
    return meta![input.field];
  };
  if (editVibe != undefined || curGroup !== showGroup) {
    return <></>;
  }
  if (!input.values.includes(getField())) {
    return <></>;
  }
  return <WFRenderElement element={input.element} />;
});

const WFRShowImage = observer(({ element }: WFElementProps) => {
  const curSession = appState.curSession;
  const { type, meta, preset, shared, editVibe, showGroup } =
    useContext(WFElementContext)!;
  const { curGroup } = useContext(WFGroupContext)!;
  const input = element as WFIShowImage;
  const getField = () => {
    if (input.fieldType === 'preset') return preset[input.field];
    if (input.fieldType === 'shared') return shared[input.field];
    return meta![input.field];
  };
  if (editVibe != undefined || curGroup !== showGroup) {
    return <></>;
  }
  return (
    <div className="mt-2">
      {getField() && (
        <VibeImage
          path={imageService.getVibeImagePath(curSession!, getField())}
          className="flex-none w-40 h-40 object-cover"
        />
      )}
    </div>
  );
});

const WFRMiddlePlaceholder = observer(({ element }: WFElementProps) => {
  const { editVibe, showGroup, getMiddlePrompt, onMiddlePromptChange } =
    useContext(WFElementContext)!;
  const input = element as WFIMiddlePlaceholderInput;
  if (!getMiddlePrompt || !onMiddlePromptChange) {
    return <></>;
  }
  if (showGroup || editVibe) {
    return <></>;
  }
  return (
    <EditorField label={input.label} full={true} bold>
      <PromptEditTextArea
        value={getMiddlePrompt!()}
        disabled={false}
        onChange={onMiddlePromptChange!}
      ></PromptEditTextArea>
    </EditorField>
  );
});

const WFRProfilePresetSelect = observer(({ element }: WFElementProps) => {
  const { type } = useContext(WFElementContext)!;
  return <ProfilePreSetSelect />;
});

const WFRPresetSelect = observer(({ element }: WFElementProps) => {
  const { type } = useContext(WFElementContext)!;
  return <PreSetSelect workflowType={type} />;
});

const GlobalModelSettings = observer(() => {
  const [modelVersion, setModelVersion] = useState<ModelVersion>(ModelVersion.V4_5);
  const [furryMode, setFurryMode] = useState(false);
  const [disableQuality, setDisableQuality] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const config = await backend.getConfig();
      setModelVersion(config.modelVersion ?? ModelVersion.V4_5);
      setFurryMode(config.furryMode ?? false);
      setDisableQuality(config.disableQuality ?? false);
      setLoaded(true);
    })();
  }, []);

  const saveConfig = async (updates: Record<string, any>) => {
    const config = await backend.getConfig();
    await backend.setConfig({ ...config, ...updates });
    sessionService.configChanged();
  };

  if (!loaded) return null;

  return (
    <div className="mt-4 pt-4 border-t border-gray-200 dark:border-slate-600">
      <div className="text-sm font-semibold text-gray-600 dark:text-gray-300 mb-3">
        모델 설정 (전역)
      </div>
      <div className="space-y-3">
        <div>
          <label className="text-sm gray-label mb-1 block">NAI 모델 버전</label>
          <DropdownSelect
            selectedOption={modelVersion}
            menuPlacement="auto"
            options={[
              { label: 'V4.5 Full', value: ModelVersion.V4_5 },
              { label: 'V4.5 Curated', value: ModelVersion.V4_5Curated },
              { label: 'V4 Full', value: ModelVersion.V4 },
              { label: 'V4 Curated', value: ModelVersion.V4Curated },
            ]}
            onSelect={(opt) => {
              setModelVersion(opt.value as ModelVersion);
              saveConfig({ modelVersion: opt.value });
            }}
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="globalFurryMode"
            checked={furryMode}
            onChange={(e) => {
              setFurryMode(e.target.checked);
              saveConfig({ furryMode: e.target.checked });
            }}
          />
          <label htmlFor="globalFurryMode" className="text-sm gray-label">
            퍼리 모드 켜기
          </label>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="globalDisableQuality"
            checked={disableQuality}
            onChange={(e) => {
              setDisableQuality(e.target.checked);
              saveConfig({ disableQuality: e.target.checked });
            }}
          />
          <label htmlFor="globalDisableQuality" className="text-sm gray-label">
            NAI 자동 퀄리티 태그 비활성화
          </label>
        </div>
      </div>
    </div>
  );
});

const WFRGroup = observer(({ element }: WFElementProps) => {
  const grp = element as WFIGroup;
  const { editVibe, setShowGroupOverlay } =
    useContext(WFElementContext)!;
  if (editVibe != undefined) {
    return <></>;
  }
  return (
    <button
      className={`round-button back-gray h-8 w-full mt-2`}
      onClick={() => {
        setShowGroupOverlay(grp.label);
      }}
    >
      {grp.label}
    </button>
  );
});

const WFRStack = observer(({ element }: WFElementProps) => {
  const stk = element as WFIStack;
  return (
    <VerticalStack>
      {stk.inputs.map((x) => (
        <WFRenderElement element={x} />
      ))}
    </VerticalStack>
  );
});

const WFRPush = observer(({ element }: WFElementProps) => {
  const { showGroup, showGroupOverlay, editVibe } = useContext(WFElementContext)!;
  const { curGroup } = useContext(WFGroupContext)!;
  const push = element as WFIPush;
  const isInOverlay = curGroup !== undefined && curGroup === showGroupOverlay;
  if (!isInOverlay) {
    if (curGroup !== showGroup || editVibe != undefined) {
      return <></>;
    }
  }

  if (push.direction === 'top') {
    return <div className="mt-auto"></div>;
  } else if (push.direction === 'bottom') {
    return <div className="mb-auto"></div>;
  } else if (push.direction === 'left') {
    return <div className="ml-auto"></div>;
  } else if (push.direction === 'right') {
    return <div className="mr-auto"></div>;
  }
});

const CharacterPromptEditor = observer(
  ({ input }: { input: WFIInlineInput }) => {
    const {
      preset,
      shared,
      meta,
      type,
      editCharacters,
      setEditCharacters,
      middlePromptMode,
      getCharacterMiddlePrompt,
      onCharacterMiddlePromptChange,
    } = useContext(WFElementContext)!;

    const getField = () => {
      if (input.fieldType === 'preset') return preset[input.field] || [];
      if (input.fieldType === 'shared') return shared[input.field] || [];
      return meta![input.field] || [];
    };

    const setField = (val: any) => {
      if (input.fieldType === 'preset') preset[input.field] = val;
      else if (input.fieldType === 'shared') shared[input.field] = val;
      else meta![input.field] = val;
    };

    const addCharacter = () => {
      const characters = [...getField()];
      characters.push({
        id: v4(),
        name: '',
        prompt: '',
        uc: '',
        position: { x: 0.5, y: 0.5 },
        enabled: true,
      });
      setField(characters);
    };

    const removeCharacter = (id: string) => {
      const characters = getField().filter((c: CharacterPrompt) => c.id !== id);
      setField(characters);
    };

    const updateCharacter = (id: string, updates: Partial<CharacterPrompt>) => {
      const characters = getField().map((c: CharacterPrompt) =>
        c.id === id ? { ...c, ...updates } : c,
      );
      setField(characters);
    };

    const toggleCharacter = (id: string) => {
      const characters = getField().map((c: CharacterPrompt) =>
        c.id === id ? { ...c, enabled: c.enabled === false ? true : false } : c,
      );
      setField(characters);
    };

    if (editCharacters !== input.field) {
      return null;
    }

    return (
      <div className="w-full h-full overflow-hidden flex flex-col">
        <div className="flex-1 overflow-hidden">
          <div className="h-full overflow-auto">
            {getField().map((character: CharacterPrompt, i: number) => (
              <div
                key={character.id}
                className={`border rounded-md mt-3 p-3 ${character.enabled === false ? 'opacity-60 border-gray-300' : 'border-sky-500 bg-sky-50 dark:bg-sky-900/20'}`}
              >
                <div className="flex justify-between items-center mb-2">
                  <div className="flex items-center gap-2 gray-label">
                    캐릭터 프롬프트
                  </div>
                  <div className="flex items-center gap-2">
                    <Tooltip content={character.enabled !== false ? '비활성화' : '활성화'}>
                    <button
                      className={`round-button h-8 px-4 ${character.enabled !== false ? 'back-sky' : 'back-gray'}`}
                      onClick={() => toggleCharacter(character.id)}
                    >
                      {character.enabled !== false ? <FaToggleOn className="mr-1" /> : <FaToggleOff className="mr-1" />}
                      {character.enabled !== false ? '활성화됨' : '비활성화됨'}
                    </button>
                    </Tooltip>
                    <Tooltip content="캐릭터 삭제">
                    <button
                      className="icon-button back-red"
                      onClick={() => removeCharacter(character.id)}
                    >
                      <FaTrash />
                    </button>
                    </Tooltip>
                  </div>
                </div>
                <div className="mb-2">
                  <PromptEditTextArea
                    value={character.prompt}
                    onChange={(value) =>
                      updateCharacter(character.id, { prompt: value })
                    }
                  />
                </div>
                {middlePromptMode && (
                  <>
                    <div className="flex justify-between items-center mb-2">
                      <div className="flex items-center gap-2 gray-label">
                        중간 프롬프트 (이 씬에만 적용됨)
                      </div>
                    </div>
                    <div className="mb-2">
                      <PromptEditTextArea
                        value={getCharacterMiddlePrompt!(i)}
                        onChange={(value) =>
                          onCharacterMiddlePromptChange!(i, value)
                        }
                      />
                    </div>
                  </>
                )}
                <div className="flex justify-between items-center mb-2">
                  <div className="flex items-center gap-2 gray-label">
                    네거티브 프롬프트
                  </div>
                </div>
                <div className="mb-2">
                  <PromptEditTextArea
                    value={character.uc}
                    onChange={(value) =>
                      updateCharacter(character.id, { uc: value })
                    }
                  />
                </div>
                {preset.useCoords && (
                  <div className="flex w-full items-center md:flex-row flex-col gap-2">
                    <div
                      className={
                        'whitespace-nowrap flex-none mr-auto md:mr-0 gray-label'
                      }
                    >
                      X 위치:
                    </div>
                    <div className="flex flex-1 md:w-auto w-full gap-1">
                      <input
                        className="flex-1"
                        type="range"
                        step="0.01"
                        min="0"
                        max="1"
                        value={character.position?.x}
                        onChange={(e) =>
                          updateCharacter(character.id, {
                            position: {
                              ...character.position,
                              x: parseFloat(e.target.value),
                            },
                          })
                        }
                      />
                      <div className="w-11 flex-none text-lg text-center back-lllgray">
                        {character.position?.x?.toFixed(2)}
                      </div>
                    </div>
                    <div
                      className={
                        'whitespace-nowrap flex-none mr-auto md:mr-0 gray-label'
                      }
                    >
                      Y 위치:
                    </div>
                    <div className="flex flex-1 md:w-auto w-full gap-1">
                      <input
                        className="flex-1"
                        type="range"
                        step="0.01"
                        min="0"
                        max="1"
                        value={character.position?.y}
                        onChange={(e) =>
                          updateCharacter(character.id, {
                            position: {
                              ...character.position,
                              y: parseFloat(e.target.value),
                            },
                          })
                        }
                      />
                      <div className="w-11 flex-none text-lg text-center back-lllgray">
                        {character.position?.y?.toFixed(2)}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="flex-none mt-auto pt-2 flex gap-2 items-center">
          <button
            className="round-button back-green h-8"
            onClick={addCharacter}
          >
            캐릭터 추가
          </button>
          <button
            className="round-button back-gray h-8 w-full"
            onClick={() => {
              setEditCharacters(undefined);
            }}
          >
            캐릭터 프롬프트 닫기
          </button>
        </div>
      </div>
    );
  },
);

export const CharacterButton = ({ input }: { input: WFIInlineInput }) => {
  const { editCharacters, setEditCharacters, preset, shared, meta } =
    useContext(WFElementContext)!;

  const getField = () => {
    if (input.fieldType === 'preset') return preset[input.field] || [];
    if (input.fieldType === 'shared') return shared[input.field] || [];
    return meta![input.field] || [];
  };

  const onClick = () => {
    setEditCharacters(input.field);
  };

  const field = getField();
  const enabledCount = field.filter((c: CharacterPrompt) => c.enabled !== false).length;
  const totalCount = field.length;

  return (
    <>
      {editCharacters === undefined && field.length === 0 && (
        <button
          className={`round-button back-gray h-8 w-full flex mt-2`}
          onClick={onClick}
        >
          <div className="flex-1">
            <FaUserAlt className="inline mr-2" />
            캐릭터 프롬프트 열기
          </div>
        </button>
      )}
      {editCharacters === undefined && field.length > 0 && (
        <div className="w-full mt-2">
          <button
            className="round-button back-sky h-8 w-full flex justify-between items-center"
            onClick={onClick}
          >
            <div className="flex items-center">
              <FaUserAlt className="mr-2" />
              <span>캐릭터 프롬프트 열기</span>
            </div>
            <div className="flex flex-wrap gap-1">
              <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-green-800">
                {enabledCount}/{totalCount} 활성화
              </span>
            </div>
          </button>
        </div>
      )}
    </>
  );
};

const WFRInline = observer(({ element }: WFElementProps) => {
  const { editVibe, editCharacters, type, showGroup, showGroupOverlay, preset, shared, meta } =
    useContext(WFElementContext)!;
  const { curGroup } = useContext(WFGroupContext)!;
  const input = element as WFIInlineInput;
  const field = workFlowService.getVarDef(type, input.fieldType, input.field)!;
  const getField = () => {
    if (input.fieldType === 'preset') {
      return preset[input.field];
    } else if (input.fieldType === 'shared') {
      return shared[input.field];
    } else {
      return meta![input.field];
    }
  };
  const setField = (val: any) => {
    if (input.fieldType === 'preset') {
      preset[input.field] = val;
    } else if (input.fieldType === 'shared') {
      shared[input.field] = val;
    } else {
      meta![input.field] = val;
    }
  };
  // 오버레이 내부에서는 curGroup이 설정됨 — showGroupOverlay와 비교
  // 일반 인라인에서는 기존대로 showGroup과 비교
  const isInOverlay = curGroup !== undefined && curGroup === showGroupOverlay;
  if (!isInOverlay) {
    if (
      curGroup !== showGroup ||
      editVibe != undefined
    ) {
      return <></>;
    }
  }
  const key = `${type}_${preset.name}_${input.field}`;
  switch (field.type) {
    case 'prompt':
      return (
        <EditorField label={input.label} full={input.flex === 'flex-1'}>
          <PromptEditTextArea
            key={key}
            value={getField()}
            disabled={false}
            onChange={setField}
          ></PromptEditTextArea>
        </EditorField>
      );
    case 'select':
      return (
        <InlineEditorField label={input.label}>
          <DropdownSelect
            key={key}
            selectedOption={getField()}
            disabled={false}
            menuPlacement={input.menuPlacement}
            options={field.options.map((x) => ({
              label: x.label,
              value: x.value,
            }))}
            onSelect={(opt) => {
              setField(opt.value);
            }}
          />
        </InlineEditorField>
      );
    case 'characterPrompts':
      return <CharacterButton input={input} key={key} />;
    case 'nullInt':
      return (
        <InlineEditorField label={input.label}>
          <NullIntInput
            label={input.label}
            value={getField()}
            disabled={false}
            onChange={(val) => setField(val)}
            key={key}
          />
        </InlineEditorField>
      );
    case 'vibeSet':
      return <VibeButton input={input} key={key} />;
    case 'characterReferences':
      return <CharacterReferenceButton input={input} key={key} />;
    case 'bool':
      return (
        <InlineEditorField label={input.label}>
          <input
            key={key}
            type="checkbox"
            checked={getField()}
            onChange={(e) => setField(e.target.checked)}
          />
        </InlineEditorField>
      );
    case 'int':
      return (
        <IntSliderInput
          label={input.label}
          value={getField()}
          onChange={setField}
          disabled={false}
          min={field.min}
          max={field.max}
          step={field.step}
          key={key}
        />
      );
    case 'sampling':
      return (
        <InlineEditorField label={input.label}>
          <DropdownSelect
            key={key}
            selectedOption={getField()}
            disabled={false}
            menuPlacement="auto"
            options={Object.values(Sampling).map((x) => ({
              label: x,
              value: x,
            }))}
            onSelect={(opt) => {
              setField(opt.value);
            }}
          />
        </InlineEditorField>
      );
    case 'noiseSchedule':
      return (
        <InlineEditorField label={input.label}>
          <DropdownSelect
            key={key}
            selectedOption={getField()}
            disabled={false}
            menuPlacement="auto"
            options={Object.values(NoiseSchedule).map((x) => ({
              label: x,
              value: x,
            }))}
            onSelect={(opt) => {
              setField(opt.value);
            }}
          />
        </InlineEditorField>
      );
    case 'image':
      return <ImageSelect input={input} key={key} />;
  }
  return <InlineEditorField label={input.label}>asdf</InlineEditorField>;
});

interface ImplProps {
  type: string;
  shared: any;
  preset: any;
  meta?: any;
  middlePromptMode: boolean;
  element: WFIElement;
  getMiddlePrompt?: () => string;
  onMiddlePromptChange?: (txt: string) => void;
  getCharacterMiddlePrompt?: (index: number) => string;
  onCharacterMiddlePromptChange?: (index: number, txt: string) => void;
}

export const PreSetEditorImpl = observer(
  ({
    type,
    shared,
    preset,
    element,
    meta,
    middlePromptMode,
    getMiddlePrompt,
    onMiddlePromptChange,
    getCharacterMiddlePrompt,
    onCharacterMiddlePromptChange,
  }: ImplProps) => {
    const [editVibe, setEditVibe] = useState<WFIInlineInput | undefined>(
      undefined,
    );
    const [editCharacterReference, setEditCharacterReference] = useState<WFIInlineInput | undefined>(
      undefined,
    );
    const [editCharacters, setEditCharacters] = useState<string | undefined>(
      undefined,
    );
    const [showGroup, setShowGroup] = useState<string | undefined>(undefined);
    const [showGroupOverlay, setShowGroupOverlay] = useState<string | undefined>(undefined);
    const [modelVersion, setModelVersion] = useState<ModelVersion>(ModelVersion.V4_5);

    useEffect(() => {
      (async () => {
        const config = await backend.getConfig();
        setModelVersion(config.modelVersion ?? ModelVersion.V4_5);
      })();
      const onConfigChanged = async () => {
        const config = await backend.getConfig();
        setModelVersion(config.modelVersion ?? ModelVersion.V4_5);
      };
      sessionService.addEventListener('config-changed', onConfigChanged);
      return () => sessionService.removeEventListener('config-changed', onConfigChanged);
    }, []);

    // element 트리에서 group 요소 찾기
    const findGroupElement = (el: WFIElement): WFIGroup | undefined => {
      if (el.type === 'group') return el as WFIGroup;
      if (el.type === 'stack') {
        for (const child of (el as WFIStack).inputs) {
          const found = findGroupElement(child);
          if (found) return found;
        }
      }
      return undefined;
    };
    const groupElement = findGroupElement(element);

    useEffect(() => {
      setShowGroup(undefined);
      setShowGroupOverlay(undefined);
    }, [type]);

    // 단축키에서 샘플링/모델 설정 열기 이벤트 수신
    useEffect(() => {
      const handler = (e: Event) => {
        const action = (e as CustomEvent).detail?.action;
        if (action === 'open-sampling-settings' && groupElement) {
          setShowGroupOverlay('샘플링/모델 설정');
        }
      };
      window.addEventListener('shortcut-action', handler);
      return () => window.removeEventListener('shortcut-action', handler);
    }, [groupElement]);
    return (
      <StackGrow>
        <WFElementContext.Provider
          value={{
            preset: preset,
            shared: shared,
            meta: meta,
            showGroup: showGroup,
            editVibe: editVibe,
            setEditVibe: setEditVibe,
            editCharacterReference: editCharacterReference,
            setEditCharacterReference: setEditCharacterReference,
            editCharacters: editCharacters,
            setEditCharacters: setEditCharacters,
            setShowGroup: setShowGroup,
            showGroupOverlay: showGroupOverlay,
            setShowGroupOverlay: setShowGroupOverlay,
            groupElement: groupElement,
            type: type,
            middlePromptMode,
            modelVersion,
            getMiddlePrompt,
            onMiddlePromptChange,
            getCharacterMiddlePrompt,
            onCharacterMiddlePromptChange,
          }}
        >
          <WFGroupContext.Provider value={{}}>
            <VibeEditor disabled={false} />
            <CharacterReferenceEditor disabled={false} />
            {editCharacters && (
              <CharacterPromptEditor
                input={
                  {
                    type: 'inline',
                    label: 'Characters',
                    field: editCharacters,
                    fieldType:
                      shared?.type === 'SDImageGenEasy' ? 'shared' : 'preset',
                    flex: 'flex-none',
                  } as WFIInlineInput
                }
              />
            )}
            {!editVibe && !editCharacters && !editCharacterReference && (
              <WFRenderElement element={element} />
            )}
          </WFGroupContext.Provider>
          {/* 샘플링/모델 설정 오버레이 */}
          <ModalOverlay
            isOpen={!!showGroupOverlay && !!groupElement}
            onClose={() => setShowGroupOverlay(undefined)}
            title={showGroupOverlay || ''}
            width="max-w-xl"
          >
            {showGroupOverlay && groupElement && (
              <WFGroupContext.Provider value={{ curGroup: showGroupOverlay }}>
                {groupElement.inputs.map((x, i) => (
                  <WFRenderElement key={i} element={x} />
                ))}
                <GlobalModelSettings />
              </WFGroupContext.Provider>
            )}
          </ModalOverlay>
        </WFElementContext.Provider>
      </StackGrow>
    );
  },
);

interface InnerProps {
  type: string;
  shared: any;
  preset: any;
  meta?: any;
  element: WFIElement;
  middlePromptMode: boolean;
  nopad?: boolean;
  getMiddlePrompt?: () => string;
  onMiddlePromptChange?: (txt: string) => void;
  getCharacterMiddlePrompt?: (index: number) => string;
  onCharacterMiddlePromptChange?: (index: number, txt: string) => void;
}

interface UnionProps {
  general: boolean;
  type?: string;
  shared?: any;
  meta?: any;
  preset?: any;
  middlePromptMode: boolean;
  getMiddlePrompt?: () => string;
  onMiddlePromptChange?: (txt: string) => void;
  getCharacterMiddlePrompt?: (index: number) => string;
  onCharacterMiddlePromptChange?: (index: number, txt: string) => void;
}

export const InnerPreSetEditor = observer(
  ({
    type,
    shared,
    preset,
    meta,
    element,
    middlePromptMode,
    getMiddlePrompt,
    onMiddlePromptChange,
    getCharacterMiddlePrompt,
    onCharacterMiddlePromptChange,
    nopad,
  }: InnerProps) => {
    return (
      <VerticalStack className={nopad ? '' : 'p-2'}>
        <PreSetEditorImpl
          type={type}
          shared={shared}
          preset={preset}
          meta={meta}
          element={element}
          middlePromptMode={middlePromptMode}
          getMiddlePrompt={getMiddlePrompt}
          onMiddlePromptChange={onMiddlePromptChange}
          getCharacterMiddlePrompt={getCharacterMiddlePrompt}
          onCharacterMiddlePromptChange={onCharacterMiddlePromptChange}
        />
      </VerticalStack>
    );
  },
);

interface Props {
  meta?: any;
  middlePromptMode: boolean;
  getMiddlePrompt?: () => string;
  onMiddlePromptChange?: (txt: string) => void;
  getCharacterMiddlePrompt?: (index: number) => string;
  onCharacterMiddlePromptChange?: (index: number, txt: string) => void;
}

const PreSetEditor = observer(
  ({
    middlePromptMode,
    getMiddlePrompt,
    onMiddlePromptChange,
    getCharacterMiddlePrompt,
    onCharacterMiddlePromptChange,
    meta,
  }: Props) => {
    const [_, rerender] = useState<{}>({});
    const curSession = appState.curSession!;
    const workflowType = curSession.selectedWorkflow?.workflowType;
    const shared = curSession.presetShareds?.get(workflowType!);
    const presets = curSession.presets?.get(workflowType!);
    if (!workflowType) {
      curSession.selectedWorkflow = {
        workflowType: workFlowService.generalFlows[0].getType(),
      };
      rerender({});
    } else {
      if (!presets) {
        const preset = workFlowService.buildPreset(workflowType);
        preset.name = 'default';
        curSession.presets.set(workflowType, [preset]);
        rerender({});
      } else if (!shared) {
        curSession.presetShareds.set(
          workflowType,
          workFlowService.buildShared(workflowType),
        );
        rerender({});
      } else if (
        !curSession.selectedWorkflow!.presetName ||
        !presets.find((x) => x.name === curSession.selectedWorkflow!.presetName)
      ) {
        if (presets.length === 0) {
          const preset = workFlowService.buildPreset(workflowType);
          preset.name = 'default';
          curSession.presets.set(workflowType, [preset]);
          curSession.selectedWorkflow!.presetName = 'default';
        } else {
          curSession.selectedWorkflow!.presetName = presets[0].name;
        }
        rerender({});
      }
    }
    return (
      workflowType &&
      shared &&
      curSession.selectedWorkflow!.presetName && (
        <VerticalStack className="p-2">
          <StackFixed className="flex gap-2 items-center">
            <span className={'flex-none gray-label'}>작업모드: </span>
            <DropdownSelect
              selectedOption={workflowType}
              menuPlacement="bottom"
              options={workFlowService.generalFlows.map((x) => ({
                value: x.getType(),
                label: x.getTitle(),
              }))}
              onSelect={(opt) => {
                curSession.selectedWorkflow = {
                  workflowType: opt.value,
                };
              }}
            />
          </StackFixed>
          <PreSetEditorImpl
            type={workflowType}
            shared={shared}
            meta={meta}
            preset={
              presets!.find(
                (x) => x.name === curSession.selectedWorkflow!.presetName,
              )!
            }
            middlePromptMode={middlePromptMode}
            element={workFlowService.getGeneralEditor(workflowType)}
            getMiddlePrompt={getMiddlePrompt}
            onMiddlePromptChange={onMiddlePromptChange}
            getCharacterMiddlePrompt={getCharacterMiddlePrompt}
            onCharacterMiddlePromptChange={onCharacterMiddlePromptChange}
          />
        </VerticalStack>
      )
    );
  },
);

export const UnionPreSetEditor = observer(
  ({
    general,
    type,
    shared,
    meta,
    preset,
    middlePromptMode,
    getMiddlePrompt,
    onMiddlePromptChange,
    getCharacterMiddlePrompt,
    onCharacterMiddlePromptChange,
  }: UnionProps) => {
    return general ? (
      <PreSetEditor
        meta={meta}
        middlePromptMode={middlePromptMode}
        getMiddlePrompt={getMiddlePrompt}
        onMiddlePromptChange={onMiddlePromptChange}
        getCharacterMiddlePrompt={getCharacterMiddlePrompt}
        onCharacterMiddlePromptChange={onCharacterMiddlePromptChange}
      />
    ) : (
      <InnerPreSetEditor
        meta={meta}
        type={type!}
        shared={shared!}
        preset={preset!}
        element={workFlowService.getInnerEditor(type!)}
        middlePromptMode={middlePromptMode}
        getMiddlePrompt={getMiddlePrompt}
        onMiddlePromptChange={onMiddlePromptChange}
        getCharacterMiddlePrompt={getCharacterMiddlePrompt}
        onCharacterMiddlePromptChange={onCharacterMiddlePromptChange}
      />
    );
  },
);

export default PreSetEditor;
