import * as React from 'react';
import { useContext, useEffect, useRef, useState } from 'react';
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
  FaTimes,
  FaTrashAlt,
  FaUserAlt,
  FaArrowsAlt,
  FaToggleOn,
  FaToggleOff,
  FaFolderOpen,
} from 'react-icons/fa';
import { FloatView } from './FloatView';
import { useDrag, useDrop } from 'react-dnd';
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
  wfiElementKey,
} from '../models/workflows/WorkFlow';
import {
  presetLayoutSlotKey,
  resolveStackInputs,
  presetRowLabel,
} from '../models/presetLayout';
import { resolveCompanionButtons } from '../models/companionSlots';
import { renderCompanionButtons } from './PortableToolbarButtons';
import { CompanionHostRow } from './CompanionDnd';
import {
  DraggablePresetRow,
  resetPresetOrder,
  isPresetAnchorKey,
} from './PresetLayoutDnd';
import { StackFixed, StackGrow, VerticalStack } from './LayoutComponents';
import Tooltip from './Tooltip';
import ModalOverlay from './ModalOverlay';
import { FaCloudUploadAlt } from 'react-icons/fa';
import { ModelVersion } from '../backends/imageGen';
import { EditableSliderValue, VibeEditor, VibeButton, VibeImage } from './VibeEditor';
import {
  CharacterReferenceEditor,
  CharacterReferenceButton,
} from './CharacterReferenceEditor';
import { WFElementContext } from './wfElementContext';

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
    <div className="inline-flex md:flex gap-3 items-center flex-none text-eplsis overflow-hidden gap-3 mb-1 mt-2 md:mt-3">
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
      <div className={'pt-2 md:pt-3 pb-1 gray-label'}>
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
    <div className="field-row pt-2 md:pt-3 flex gap-2 items-center">
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

// 드래그 가능한 프리셋 카드
const DraggablePresetCard = observer(({
  presetItem,
  index,
  isSelected,
  type,
  curSession,
  onSelect,
  onContextMenu,
}: {
  presetItem: any;
  index: number;
  isSelected: boolean;
  type: string;
  curSession: any;
  onSelect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) => {
  const ref = React.useRef<HTMLDivElement>(null);

  const [{ isDragging }, drag] = useDrag(() => ({
    type: 'preset-card',
    item: { index },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  }), [index]);

  const [{ isOver }, drop] = useDrop(() => ({
    accept: 'preset-card',
    drop: (item: { index: number }) => {
      if (item.index !== index) {
        curSession.movePreset(type, item.index, index);
        item.index = index;
      }
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
    }),
  }), [index, type, curSession]);

  drag(drop(ref));

  return (
    <div
      ref={ref}
      className={
        'h-full relative flex-none hover:brightness-95 active:brightness-90 cursor-pointer transition-opacity ' +
        (isSelected ? 'border-2 border-sky-500' : 'border-2 line-color') +
        (isDragging ? ' opacity-30' : '') +
        (isOver ? ' ring-2 ring-sky-400' : '')
      }
      onContextMenu={onContextMenu}
      onClick={onSelect}
    >
      {presetItem.profile && (
        <VibeImage
          path={
            imageService.getVibesDir(curSession) +
            '/' +
            presetItem.profile.split('/').pop()!
          }
          className="w-auto h-full"
        />
      )}
      {!presetItem.profile && <div className="w-40 h-full"></div>}
      <div
        className="absolute bottom-0 right-0 bg-gray-700 opacity-80 text-sm text-white p-1 rounded-xl m-2 truncate select-none"
        style={{ maxWidth: '90%' }}
      >
        {presetItem.name}
      </div>
    </div>
  );
});

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
        'mt-2 md:mt-3 overflow-hidden min-h-0 ' + (middlePromptMode ? 'h-1/5' : 'h-1/3')
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
        {presets.map((x, i) => (
          <DraggablePresetCard
            key={x.name}
            presetItem={x}
            index={i}
            isSelected={x === preset}
            type={type}
            curSession={curSession!}
            onSelect={() => {
              curSession!.selectedWorkflow = {
                workflowType: type,
                presetName: x.name,
              };
            }}
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
          />
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
    <div className="flex w-full items-center md:flex-row flex-col mt-2 md:mt-3 gap-2">
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

const PreSetBulkManageModal = observer(
  ({
    workflowType,
    onClose,
  }: {
    workflowType: string;
    onClose: () => void;
  }) => {
    const curSession = appState.curSession!;
    const presets = curSession.presets.get(workflowType)!;
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [filter, setFilter] = useState('');

    const filtered = React.useMemo(() => {
      if (!filter.trim()) return presets;
      const q = filter.toLowerCase();
      return presets.filter((p) => p.name.toLowerCase().includes(q));
    }, [presets, filter, presets.length]);

    const toggle = (name: string) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(name)) next.delete(name);
        else next.add(name);
        return next;
      });
    };

    const allSelected =
      filtered.length > 0 && filtered.every((p) => selected.has(p.name));

    const toggleAll = () => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (allSelected) filtered.forEach((p) => next.delete(p.name));
        else filtered.forEach((p) => next.add(p.name));
        return next;
      });
    };

    const doDelete = () => {
      if (selected.size === 0) return;
      if (selected.size >= presets.length) {
        appState.pushMessage('최소 1개의 사전 세팅은 남겨야 합니다');
        return;
      }
      appState.pushDialog({
        type: 'confirm',
        text: `선택한 ${selected.size}개의 사전 세팅을 삭제하시겠습니까? 되돌릴 수 없습니다.`,
        callback: () => {
          const names = Array.from(selected);
          const curName = curSession.selectedWorkflow?.presetName;
          for (const name of names) {
            curSession.removePreset(workflowType, name);
          }
          // 현재 선택 중인 사전 세팅이 삭제되었으면 첫 항목으로 재설정
          if (curName && names.includes(curName)) {
            const remaining = curSession.presets.get(workflowType)!;
            curSession.selectedWorkflow = {
              workflowType,
              presetName: remaining.length > 0 ? remaining[0].name : undefined,
            };
          }
          setSelected(new Set());
        },
      });
    };

    return (
      <ModalOverlay
        isOpen={true}
        onClose={onClose}
        title="사전 세팅 일괄 삭제"
        width="max-w-lg"
      >
        <div className="flex flex-col gap-3">
          <input
            type="text"
            placeholder="이름으로 검색..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full px-3 py-1.5 rounded border line-color bg-[var(--c-input-bg)] text-default text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
          />
          <div className="flex items-center justify-between">
            <button
              onClick={toggleAll}
              className="text-xs btn-link"
            >
              {allSelected ? '전체 해제' : '전체 선택'}
              {filter.trim() && ` (${filtered.length}개)`}
            </button>
            <span className="text-xs text-muted">
              전체 {presets.length}개
            </span>
          </div>
          <div className="max-h-72 overflow-y-auto border line-color rounded-lg p-2 space-y-0.5">
            {filtered.map((p) => (
              <label
                key={p.name}
                className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700/50 rounded px-1 py-0.5"
              >
                <input
                  type="checkbox"
                  checked={selected.has(p.name)}
                  onChange={() => toggle(p.name)}
                  className="rounded line-color"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300 truncate">
                  {p.name}
                  {curSession.selectedWorkflow?.presetName === p.name && (
                    <span className="ml-2 text-xs text-sky-500">(현재 선택)</span>
                  )}
                </span>
              </label>
            ))}
            {filtered.length === 0 && (
              <div className="text-xs text-faint py-1">
                일치하는 사전 세팅이 없습니다
              </div>
            )}
          </div>
          <div className="flex items-center justify-between pt-2 border-t line-color">
            <span className="text-sm text-gray-700 dark:text-gray-300">
              <span className="text-red-500 font-bold">{selected.size}</span>개
              선택됨
            </span>
            <button
              onClick={doDelete}
              disabled={selected.size === 0}
              className="px-4 py-2 rounded-lg btn-solid-red disabled:bg-gray-300 dark:disabled:bg-gray-600 text-sm font-medium transition-colors"
            >
              선택 삭제
            </button>
          </div>
        </div>
      </ModalOverlay>
    );
  },
);

const PreSetSelect = observer(({ workflowType }: { workflowType: string }) => {
  const curSession = appState.curSession!;
  const [isOpen, setIsOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
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
  // 동반 슬롯 (④ 호스트 확대): 사전세팅선택 행 옆에 portable 버튼을 붙인다.
  // 빈 배열이면 슬롯 없음 = 현행 렌더 100% 동일. 드롭다운은 이미 flex-1 !min-w-0
  // truncate 라 아이콘 버튼 자리를 자연스럽게 내준다. 편집모드 밖은
  // CompanionHostRow 가 fragment 라 렌더 무변화.
  const companionIds = resolveCompanionButtons(
    'preset-select',
    appState.uiCompanionSlots,
  );
  // variant 'project': 이 행의 이웃 버튼(+·★·🗑)이 무배경 icon-button 이라 동반 버튼도
  // 무배경으로 적응(배경형 companion 스타일은 이 행에서 이질적 — 실기 보정).
  const companions =
    companionIds.length > 0
      ? renderCompanionButtons(companionIds, 'preset-select', 'project')
      : [];
  return (
    <CompanionHostRow hostKey="preset-select">
    <div className="field-row flex gap-2 mt-2 md:mt-3 items-center relative">
      {/* 동반 버튼이 붙으면 라벨을 숨겨 자리를 내준다(실기 보정) */}
      {companions.length === 0 && (
        <div className="flex-none gray-label">사전세팅선택:</div>
      )}
      {/* flex-1 !min-w-0 + truncate: 이름이 길어도 행 폭을 밀어내지 않고 말줄임 —
          우측 +·★·🗑 버튼이 밖으로 밀려 못 누르게 되던 문제 방지.
          !min-w-0 필수: .round-button 의 min-width(App.css, md 미디어 룰의 unset)가
          Tailwind min-w-0 보다 캐스케이드에서 뒤라 ! 없이는 축소가 막힌다.
          span 쪽 min-w-0 도 필수(플렉스 아이템 기본 min-width:auto 로는 truncate 미발동). */}
      <div
        className="round-button back-gray h-8 flex-1 !min-w-0 overflow-hidden"
        onClick={() => {
          setIsOpen(!isOpen);
          clicked.current = true;
        }}
      >
        <span className="min-w-0 truncate">
          {curSession.selectedWorkflow?.presetName}
        </span>
      </div>
      <button
        className={`icon-button flex-none`}
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
            className={`icon-button flex-none`}
            onClick={() => {
              appState.openGlobalPresetPicker('SDImageGen');
            }}
          >
            <FaStar />
          </button>
        </Tooltip>
      )}
      <Tooltip content="사전 세팅 일괄 삭제">
        <button
          className={`icon-button flex-none`}
          onClick={() => setBulkOpen(true)}
        >
          <FaTrashAlt />
        </button>
      </Tooltip>
      {companions}
      {bulkOpen && (
        <PreSetBulkManageModal
          workflowType={workflowType}
          onClose={() => setBulkOpen(false)}
        />
      )}
      {isOpen && (
        <ul className="left-0 top-10 absolute max-h-60 z-20 w-full mt-1 bg-white border-2 line-color rounded-md r-popover shadow-lg overflow-auto dark:bg-slate-700">
          {presets.map((option) => (
            <li
              key={option.name}
              className="text-default flex items-center justify-between p-2 clickable bg-[var(--c-surface)]"
            >
              <button
                onClick={() => {
                  curSession.selectedWorkflow = {
                    workflowType: workflowType,
                    presetName: option.name,
                  };
                }}
                // flex-1 min-w-0 truncate: 긴 이름이 우측 수정/삭제 아이콘을 밀어내지 않게
                className="flex-1 min-w-0 text-left truncate"
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
                  className="p-2 mx-1 icon-button btn-solid-green"
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
                  className="p-2 mx-1 icon-button btn-solid-sky"
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
                  className="p-2 mx-1 icon-button btn-solid-orange"
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
                      className="p-2 mx-1 icon-button btn-solid-yellow"
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
                  className="p-2 mx-1 icon-button btn-solid-red"
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
    </CompanionHostRow>
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

interface WFElementProps {
  element: WFIElement;
}


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
    <div className="mt-2 md:mt-3">
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
    <div className="mt-4 pt-4 border-t line-color">
      <div className="text-sm font-semibold text-muted mb-3">
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
  // 동반 슬롯 (E2): 그룹 행(hostKey = wfiElementKey = 그룹 id 'sampling-group') 옆에
  // 붙일 portable 버튼. 빈 배열이면 슬롯 없음 = 현행 렌더 100% 동일(회귀 기준).
  // hostKey 를 renderCompanionButtons/CompanionHostRow 에 넘겨 편집모드(PC) 드래그(E4)를
  // 붙인다 — 편집모드 밖은 CompanionHostRow 가 fragment 라 렌더 무변화.
  const hostKey = wfiElementKey(element) ?? grp.label;
  const companionIds = resolveCompanionButtons(hostKey, appState.uiCompanionSlots);
  const companions = renderCompanionButtons(companionIds, hostKey);
  const hasCompanions = companions.length > 0;
  // 슬롯 없음 = 현행 렌더 100% 동일(회귀 기준). 동반 버튼이 있으면 그룹 버튼을 flex-1 로
  // 축소하고 옆에 아이콘 버튼을 붙이는 flex 행으로 감싼다.
  return (
    <CompanionHostRow hostKey={hostKey}>
      {!hasCompanions ? (
        <button
          className={`round-button back-gray h-8 w-full mt-2 md:mt-3`}
          onClick={() => {
            setShowGroupOverlay(grp.label);
          }}
        >
          {grp.label}
        </button>
      ) : (
        <div className="w-full mt-2 md:mt-3 flex gap-1 items-stretch">
          <button
            className={`round-button back-gray h-8 flex-1`}
            onClick={() => {
              setShowGroupOverlay(grp.label);
            }}
          >
            {grp.label}
          </button>
          {companions}
        </div>
      )}
    </CompanionHostRow>
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

// 편집모드 래퍼가 세로 성장(flex-1)을 보존해야 하는 요소인지(L1-4).
// EditorField(프롬프트 flex-1)·middlePlaceholder(항상 full)만 flex-1 콘텐츠를 낸다 —
// 이 경우 래퍼도 flex-1 로 감싸야 프롬프트가 편집모드에서 접히지 않는다. 그 외는 flex-none.
// ifIn/sceneOnly 래퍼는 내부 요소로 폴백(wfiElementKey 와 동일 계약).
function presetRowGrows(el: WFIElement): boolean {
  let cur: WFIElement = el;
  while (cur.type === 'ifIn' || cur.type === 'sceneOnly') {
    cur = (cur as WFIIfIn | WFISceneOnly).element;
  }
  if (cur.type === 'middlePlaceholder') return true;
  if (cur.type === 'inline') return (cur as WFIInlineInput).flex === 'flex-1';
  return false;
}

// 루트 스택 렌더의 단일 관문(L1-4). 편집모드 꺼짐(또는 모바일·비스택·키 없음)이면
// 기존 경로(<WFRenderElement element/>)를 100% 그대로 태운다 = L1-3 회귀 기준 유지.
// 편집모드 활성(PC) && 최상위 전 요소가 유효 키일 때만 각 요소를 세로 드래그 래퍼로 감싼다.
// 앵커 키(PRESET_LAYOUT_ANCHOR_KEYS)는 래퍼 없이 그대로 렌더 = 최상단 고정·드래그 불가.
const PresetRootRender = observer(
  ({ element, slotKey }: { element: WFIElement; slotKey?: string }) => {
    const editing =
      appState.editMode &&
      !isMobile &&
      element.type === 'stack' &&
      !!slotKey;
    if (!editing) {
      // 평상시 마크업/클래스 무변경 — 원래 렌더 경로 그대로.
      return <WFRenderElement element={element} />;
    }
    const stk = element as WFIStack;
    const keys = stk.inputs.map((x) => wfiElementKey(x));
    // 키 없는 최상위 요소 방어 — 하나라도 있으면 편집 비활성(정의 순서 그대로 폴백).
    const allKeyed = keys.every(
      (k): k is string => typeof k === 'string' && k.length > 0,
    );
    if (!allKeyed) {
      return <WFRenderElement element={element} />;
    }
    const order = keys as string[]; // 현재 렌더된 전체 키 순서(앵커 포함)
    const hasOverride = !!appState.uiPresetLayout[slotKey!];

    // WFRStack 과 동일한 VerticalStack 골격 — 자식만 편집 래퍼로 감싼다.
    return (
      <VerticalStack>
        {hasOverride && (
          <div className="flex-none flex justify-end mb-1">
            <button
              className="round-button back-gray text-sm !px-2 !py-0.5 !min-w-0 !min-h-0"
              onClick={() => resetPresetOrder(slotKey!)}
              title="이 화면의 요소 순서를 기본값으로 되돌립니다"
            >
              순서 초기화
            </button>
          </div>
        )}
        {stk.inputs.map((x, i) => {
          const key = order[i];
          // 앵커 = 최상단 고정 — 드래그/드롭 대상 아님(그대로 렌더).
          if (isPresetAnchorKey(key)) {
            return <WFRenderElement key={key} element={x} />;
          }
          return (
            <DraggablePresetRow
              key={key}
              slotKey={slotKey!}
              elementKey={key}
              order={order}
              grow={presetRowGrows(x)}
              label={presetRowLabel(x)}
            >
              <WFRenderElement element={x} />
            </DraggablePresetRow>
          );
        })}
      </VerticalStack>
    );
  },
);

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

    const sharedCPs = shared?.characterPrompts || [];
    const hasSharedPresetCPs = input.fieldType === 'preset' && sharedCPs.length > 0;

    const [showCoordMap, setShowCoordMap] = useState(false);
    const allChars = [...(hasSharedPresetCPs ? sharedCPs : []), ...getField()];
    const coordMapRef = useRef<HTMLDivElement>(null);
    const [draggingId, setDraggingId] = useState<string | null>(null);

    const handleCoordPointer = (e: React.PointerEvent, charId: string, isDown = false) => {
      const rect = coordMapRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      // preset(워크플로우) 캐릭터 프롬프트에서 찾기
      const inField = getField().find((c: CharacterPrompt) => c.id === charId);
      if (inField) {
        updateCharacter(charId, { position: { x, y } });
      } else {
        // shared(캐릭터 프리셋) 캐릭터 프롬프트에서 찾기
        // in-place 변형은 자동 저장 reaction이 추적하지 못하므로 배열을 재할당한다.
        const inShared = sharedCPs.find((c: CharacterPrompt) => c.id === charId);
        if (inShared) {
          shared.characterPrompts = (shared.characterPrompts || []).map(
            (c: CharacterPrompt) =>
              c.id === charId ? { ...c, position: { x, y } } : c,
          );
        }
      }
      if (isDown) {
        setDraggingId(charId);
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }
    };

    const charColors = ['#38bdf8', '#f472b6', '#a78bfa', '#fb923c', '#4ade80', '#facc15', '#f87171', '#94a3b8'];

    return (
      <div className="w-full h-full overflow-hidden flex flex-col">
        <div className="flex-none mx-3 mt-3 flex items-center gap-2">
          <input
            type="checkbox"
            id="useCoords"
            checked={preset.useCoords ?? false}
            onChange={(e) => { preset.useCoords = e.target.checked; }}
          />
          <label htmlFor="useCoords" className="text-sm gray-label cursor-pointer">캐릭터 위치 지정 모드</label>
        </div>
        {preset.useCoords && allChars.length > 0 && (
          <div className="flex-none mx-3 mt-2">
            <button
              className="text-xs text-sky-500 hover:text-sky-400 mb-1"
              onClick={() => setShowCoordMap(!showCoordMap)}
            >
              {showCoordMap ? '▼ 좌표평면 접기' : '▶ 좌표평면 펼치기'}
            </button>
            {showCoordMap && (
              <div
                ref={coordMapRef}
                className="relative w-full bg-[var(--c-surface)] border line-color rounded select-none overflow-hidden"
                style={{ aspectRatio: '4 / 3', touchAction: 'none' }}
                onPointerMove={(e) => {
                  if (draggingId) handleCoordPointer(e, draggingId);
                }}
                onPointerUp={() => setDraggingId(null)}
              >
                {/* 9등분 격자선 */}
                <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 300 300" preserveAspectRatio="none">
                  <line x1="100" y1="0" x2="100" y2="300" stroke="currentColor" className="text-gray-200 dark:text-slate-600" strokeWidth="0.5" />
                  <line x1="200" y1="0" x2="200" y2="300" stroke="currentColor" className="text-gray-200 dark:text-slate-600" strokeWidth="0.5" />
                  <line x1="0" y1="100" x2="300" y2="100" stroke="currentColor" className="text-gray-200 dark:text-slate-600" strokeWidth="0.5" />
                  <line x1="0" y1="200" x2="300" y2="200" stroke="currentColor" className="text-gray-200 dark:text-slate-600" strokeWidth="0.5" />
                </svg>
                {/* 캐릭터 마커 */}
                {allChars.map((c: CharacterPrompt, i: number) => {
                  const isFromPreset = !!(c as any).fromPreset;
                  const color = charColors[i % charColors.length];
                  return (
                    <div
                      key={c.id}
                      className="absolute"
                      style={{
                        left: `${(c.position?.x ?? 0.5) * 100}%`,
                        top: `${(c.position?.y ?? 0.5) * 100}%`,
                        transform: 'translate(-50%, -50%)',
                        cursor: 'grab',
                        zIndex: draggingId === c.id ? 10 : 1,
                      }}
                      onPointerDown={(e) => {
                        handleCoordPointer(e, c.id, true);
                      }}
                    >
                      <div
                        className="w-8 h-8 rounded-full border-2 border-white dark:border-gray-900 shadow-lg flex items-center justify-center text-xs font-bold text-white"
                        style={{ backgroundColor: color, opacity: c.enabled === false ? 0.4 : 1 }}
                      >
                        {i + 1}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {hasSharedPresetCPs && sharedCPs.map((cp: CharacterPrompt, idx: number) => (
          <div key={cp.id || idx} className={`flex-none mx-3 mt-3 p-2 border rounded-lg border-green-300 dark:border-green-600 bg-green-50 dark:bg-green-900/20`}>
            <div className="flex items-center justify-between mb-1">
              <div className="min-w-0 text-sm font-medium text-green-700 dark:text-green-400 flex items-center gap-1.5">
                <div className="flex-none w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white" style={{ backgroundColor: charColors[idx % charColors.length] }}>{idx + 1}</div>
                <span className="truncate">🔒 프리셋: {(cp as any).fromPreset}</span>
              </div>
              <Tooltip content={`"${(cp as any).fromPreset}" 프리셋 해제 — 연결된 바이브/레퍼런스 함께 제거`}>
                <button
                  className="flex-none text-muted hover:text-red-500 dark:hover:text-red-400 p-1"
                  onClick={() =>
                    appState.removeAppliedCharacterPreset((cp as any).fromPreset)
                  }
                >
                  <FaTimes size={13} />
                </button>
              </Tooltip>
            </div>
            <div className="text-xs text-muted mb-0.5">캐릭터 프롬프트:</div>
            <div className="text-xs text-gray-700 dark:text-gray-300 bg-[var(--c-surface)] p-1.5 rounded font-mono whitespace-pre-wrap break-all mb-1">
              {cp.prompt || '(비어 있음)'}
            </div>
            {cp.uc && (
              <>
                <div className="text-xs text-muted mb-0.5">네거티브 프롬프트:</div>
                <div className="text-xs text-gray-700 dark:text-gray-300 bg-[var(--c-surface)] p-1.5 rounded font-mono whitespace-pre-wrap break-all">
                  {cp.uc}
                </div>
              </>
            )}
          </div>
        ))}
        <div className="flex-1 overflow-hidden">
          <div className="h-full overflow-auto">
            {getField().map((character: CharacterPrompt, i: number) => (
              <div
                key={character.id}
                className={`border rounded-md r-card mt-3 p-3 ${character.enabled === false ? 'opacity-60 line-color' : 'border-sky-500 bg-[var(--c-surface-2)]'}`}
              >
                <div className="flex justify-between items-center mb-2">
                  <div className="flex items-center gap-2 gray-label">
                    <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white" style={{ backgroundColor: charColors[((hasSharedPresetCPs ? sharedCPs.length : 0) + i) % charColors.length] }}>{(hasSharedPresetCPs ? sharedCPs.length : 0) + i + 1}</div>
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
                  <div className="flex items-center gap-2 text-xs text-faint mt-1">
                    <div className="w-3 h-3 rounded-full border" style={{ backgroundColor: charColors[((hasSharedPresetCPs ? sharedCPs.length : 0) + i) % charColors.length] }} />
                    위치: ({character.position?.x?.toFixed(2)}, {character.position?.y?.toFixed(2)})
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

export const CharacterButton = observer(({ input }: { input: WFIInlineInput }) => {
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
  const sharedCPs = shared?.characterPrompts || [];
  const hasPresetApplied = input.fieldType === 'preset' && sharedCPs.length > 0;
  const anyCharacters = field.length > 0 || hasPresetApplied;

  // 동반 슬롯 (L3-2): 이 호스트 행(hostKey = wfiElementKey, 인라인은 id ?? field)에
  // 붙일 portable 버튼 목록. 빈 배열이면 슬롯 없음 = 현행 렌더 100% 동일(회귀 기준).
  // hostKey 를 renderCompanionButtons/CompanionHostRow 에 넘겨 편집모드(PC) 드래그(E4)를 붙인다.
  const hostKey = wfiElementKey(input) ?? input.field;
  const companionIds = resolveCompanionButtons(hostKey, appState.uiCompanionSlots);
  const companions =
    companionIds.length > 0 ? renderCompanionButtons(companionIds, hostKey) : [];
  const hasCompanions = companions.length > 0;
  // 동반 버튼이 있으면 호스트는 flex-1 로 축소해 아이콘 버튼 자리를 내준다.
  const hostWidth = hasCompanions ? 'flex-1' : 'w-full';

  return (
    <CompanionHostRow hostKey={hostKey}>
      {editCharacters === undefined &&
        !anyCharacters &&
        (hasCompanions ? (
          <div className="w-full mt-2 md:mt-3 flex gap-1 items-stretch">
            <button
              className={`round-button back-gray h-8 flex-1 flex`}
              onClick={onClick}
            >
              <div className="flex-1">
                <FaUserAlt className="inline mr-2" />
                캐릭터 프롬프트 열기
              </div>
            </button>
            {companions}
          </div>
        ) : (
          <button
            className={`round-button back-gray h-8 w-full flex mt-2 md:mt-3`}
            onClick={onClick}
          >
            <div className="flex-1">
              <FaUserAlt className="inline mr-2" />
              캐릭터 프롬프트 열기
            </div>
          </button>
        ))}
      {editCharacters === undefined && anyCharacters && (
        <div
          className={`w-full mt-2 md:mt-3${hasCompanions ? ' flex gap-1 items-stretch' : ''}`}
        >
          <button
            className={`round-button ${hasPresetApplied ? 'back-green' : 'back-sky'} h-8 ${hostWidth} flex justify-between items-center`}
            onClick={onClick}
          >
            <div className="flex items-center">
              <FaUserAlt className="mr-2" />
              <span>캐릭터 프롬프트 열기</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {hasPresetApplied && (
                <span className="px-2 py-0.5 text-xs rounded-full bg-white/30">
                  프리셋 적용 중
                </span>
              )}
              {totalCount > 0 && (
                <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-green-800">
                  {enabledCount}/{totalCount} 활성화
                </span>
              )}
            </div>
          </button>
          {hasCompanions && companions}
        </div>
      )}
    </CompanionHostRow>
  );
});

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
  // 루트 스택 슬롯 키 계약(L1-3): innerEditor 렌더면 true → `${type}@inner`.
  // 미지정(false) = 일반 editor. 순서 오버라이드 슬롯 구분에만 쓰인다.
  inner?: boolean;
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
    inner,
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

    // 루트 스택 최상위 요소 순서 오버라이드 적용(L1-3, 읽기 배선).
    //   재배열 대상은 이 "루트 스택"의 최상위 요소뿐 — 중첩 스택/그룹 내부는 손대지 않는다.
    //   오버라이드 없음(현재 모든 사용자)이면 resolveStackInputs 가 원본 inputs 동일 참조를
    //   돌려주므로 rootElement === element 가 되어 현행 렌더 결과 100% 동일(회귀 기준).
    //   appState.uiPresetLayout 읽기는 observer 컴포넌트라 MobX 로 즉시 반응한다.
    let rootElement: WFIElement = element;
    let rootSlotKey: string | undefined;
    if (element.type === 'stack') {
      const stk = element as WFIStack;
      rootSlotKey = presetLayoutSlotKey(type, !!inner);
      const ordered = resolveStackInputs(stk, appState.uiPresetLayout[rootSlotKey]);
      if (ordered !== stk.inputs) {
        rootElement = { ...stk, inputs: ordered };
      }
    }

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
              <PresetRootRender element={rootElement} slotKey={rootSlotKey} />
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
      <VerticalStack className={nopad ? '' : 'p-2 md:p-3'}>
        <PreSetEditorImpl
          type={type}
          shared={shared}
          preset={preset}
          meta={meta}
          element={element}
          inner={true}
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
    // 레거시 작업모드(W3): 기본(OFF)에선 작업모드를 SDImageGen 하나로 고정.
    // 세션 데이터는 비파괴 — 이지모드/수정 프리셋은 보존되고 포인터만 바뀐다.
    const legacyWf = appState.legacyWorkflowMode;
    const workflowType = curSession.selectedWorkflow?.workflowType;
    const shared = curSession.presetShareds?.get(workflowType!);
    const presets = curSession.presets?.get(workflowType!);
    if (!workflowType) {
      curSession.selectedWorkflow = {
        workflowType: legacyWf
          ? workFlowService.generalFlows[0].getType()
          : 'SDImageGen',
      };
      rerender({});
    } else if (!legacyWf && workflowType !== 'SDImageGen') {
      curSession.selectedWorkflow = { workflowType: 'SDImageGen' };
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
        <VerticalStack className="p-2 md:p-3">
          {/* 작업모드 선택 — 레거시 작업모드에서만 노출(기본은 SDImageGen 고정, 행 제거로 공간 확보) */}
          {legacyWf && (
            <StackFixed className="field-row flex gap-2 items-center">
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
          )}
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
