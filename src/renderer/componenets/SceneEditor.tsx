import {
  createRef,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import Tooltip from './Tooltip';
import {
  CustomScrollbars,
  DropdownSelect,
  TabComponent,
  TextAreaWithUndo,
} from './UtilComponents';
import {
  FaImages,
  FaPlay,
  FaPlus,
  FaPuzzlePiece,
  FaSearch,
  FaStar,
  FaStop,
  FaTimes,
  FaTrash,
  FaUser,
  FaUserAlt,
  FaCheck,
  FaToggleOn,
  FaToggleOff,
  FaEdit,
  FaQuestionCircle,
} from 'react-icons/fa';
import Denque from 'denque';
import { writeFileSync } from 'original-fs';
import { windowsStore } from 'process';
import Scrollbars from 'react-custom-scrollbars-2';
import PromptEditTextArea from './PromptEditTextArea';
import PreSetEditor, { UnionPreSetEditor } from './PreSetEdtior';
import { TaskProgressBar } from './TaskQueueControl';
import { Resolution, resolutionMap } from '../backends/imageGen';
import { FloatView } from './FloatView';
import { v4 as uuidv4 } from 'uuid';
import { useDrag, useDrop } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';
import {
  imageService,
  taskQueueService,
  isMobile,
  sessionService,
  backend,
  workFlowService,
} from '../models';
import { getMainImagePath } from '../models/ImageService';
import { highlightPrompt, lowerPromptNode } from '../models/PromptService';
import { renameScene, mergeScene } from '../models/SessionService';
import {
  Scene,
  PromptPiece,
  PromptPieceSlot,
  PromptNode,
  CharacterPreset,
  CharacterPrompt,
} from '../models/types';
import { appState } from '../models/AppService';
import { observer } from 'mobx-react-lite';

interface Props {
  scene: Scene;
  onClosed: () => void;
  onDeleted?: () => void;
  initialTab?: number;
}
interface PromptHighlighterProps {
  text: string;
  className?: string;
}

export const PromptHighlighter = observer(
  ({ className, text }: PromptHighlighterProps) => {
    const { curSession } = appState;
    return (
      <div
        className={
          'max-w-full break-words bg-gray-200 dark:bg-slate-700 ' +
          (className ?? '')
        }
        dangerouslySetInnerHTML={{ __html: highlightPrompt(curSession!, text) }}
      ></div>
    );
  },
);

interface SlotEditorProps {
  scene: { slots: PromptPieceSlot[] };
  big?: boolean;
}

interface BigPromptEditorProps {
  type?: string;
  shared?: any;
  preset?: any;
  meta?: any;
  general: boolean;
  getMiddlePrompt: () => string;
  setMiddlePrompt: (txt: string) => void;
  getCharacterMiddlePrompt: (index: number) => string;
  setCharacterMiddlePrompt: (index: number, txt: string) => void;
  queuePrompt: (middle: string, callback: (path: string) => void) => void;
  setMainImage?: (path: string) => void;
  initialImagePath?: string;
}

export const BigPromptEditor = observer(
  ({
    general,
    type,
    shared,
    preset,
    meta,
    getMiddlePrompt,
    setMiddlePrompt,
    getCharacterMiddlePrompt,
    setCharacterMiddlePrompt,
    initialImagePath,
    queuePrompt,
    setMainImage,
  }: BigPromptEditorProps) => {
    const [image, setImage] = useState<string | undefined>(undefined);
    const [path, setPath] = useState<string | undefined>(initialImagePath);
    const [_, rerender] = useState<{}>({});
    useEffect(() => {
      setImage(undefined);
      (async () => {
        if (path) {
          const dataUri = await imageService.fetchImage(path);
          setImage(dataUri!);
        }
      })();
    }, [path]);
    useEffect(() => {
      const handleProgress = () => {
        rerender({});
      };
      taskQueueService.addEventListener('start', handleProgress);
      taskQueueService.addEventListener('stop', handleProgress);
      taskQueueService.addEventListener('progress', handleProgress);
      return () => {
        taskQueueService.removeEventListener('start', handleProgress);
        taskQueueService.removeEventListener('stop', handleProgress);
        taskQueueService.removeEventListener('progress', handleProgress);
      };
    });

    const [promptOpen, setPromptOpen] = useState(false);
    const [editDisabled, setEditDisabled] = useState(true);

    useEffect(() => {
      const timer = setTimeout(() => {
        setEditDisabled(false);
      }, 100);
      return () => {
        clearTimeout(timer);
      };
    }, []);

    return (
      <div className="flex h-full flex-col md:flex-row">
        {promptOpen && (
          <FloatView
            key="float"
            priority={0}
            onEscape={() => {
              setPromptOpen(false);
            }}
          >
            <UnionPreSetEditor
              general={general}
              type={type}
              preset={preset}
              meta={meta}
              shared={shared}
              middlePromptMode={true}
              getMiddlePrompt={getMiddlePrompt}
              onMiddlePromptChange={setMiddlePrompt}
              getCharacterMiddlePrompt={getCharacterMiddlePrompt}
              onCharacterMiddlePromptChange={setCharacterMiddlePrompt}
            />
          </FloatView>
        )}
        <div
          className={
            'overflow-auto flex-none h-1/3 md:h-auto md:w-1/3 md:h-full'
          }
        >
          <div className={'hidden md:block h-full '}>
            <UnionPreSetEditor
              general={general}
              type={type}
              preset={preset}
              meta={meta}
              shared={shared}
              middlePromptMode={true}
              getMiddlePrompt={getMiddlePrompt}
              onMiddlePromptChange={setMiddlePrompt}
              getCharacterMiddlePrompt={getCharacterMiddlePrompt}
              onCharacterMiddlePromptChange={setCharacterMiddlePrompt}
            />
          </div>
          <div className="h-full flex flex-col p-2 overflow-hidden block md:hidden">
            <div className="flex-none font-bold text-sub">
              중위 프롬프트 (이 씬에만 적용됨):
            </div>
            <div className="flex-1 p-2 overflow-hidden">
              <PromptEditTextArea
                disabled={editDisabled}
                onChange={setMiddlePrompt}
                value={getMiddlePrompt()}
              />
            </div>
            <div className="flex-none">
              <button
                className={`round-button back-sky`}
                onClick={() => setPromptOpen(true)}
              >
                상세설정
              </button>
            </div>
          </div>
        </div>
        <div className="flex-none h-2/3 md:h-auto md:w-2/3 overflow-hidden">
          <div className="flex flex-col h-full">
            <div className="flex-1 overflow-hidden">
              {image && (
                <img
                  className="w-full h-full object-contain"
                  src={image}
                  draggable={false}
                />
              )}
            </div>
            <div className="ml-auto flex-none flex gap-4 pt-2 mb-2 md:mb-0">
              {path && (
                <button
                  className={`round-button back-orange h-8 md:w-36 flex items-center justify-center`}
                  onClick={() => {
                    setMainImage && setMainImage(path);
                  }}
                >
                  {general ? (
                    !isMobile ? (
                      '즐겨찾기 지정'
                    ) : (
                      <FaStar />
                    )
                  ) : (
                    '프로필 지정'
                  )}
                </button>
              )}
              <TaskProgressBar fast />
              {!taskQueueService.isRunning() ? (
                <Tooltip content="생성">
                <button
                  className={`round-button back-green h-8 w-16 md:w-36 flex items-center justify-center`}
                  onClick={() => {
                    queuePrompt(getMiddlePrompt(), (path: string) => {
                      setPath(path);
                    });
                  }}
                >
                  <FaPlay size={15} />
                </button>
                </Tooltip>
              ) : (
                <Tooltip content="중지">
                <button
                  className={`round-button back-red h-8 w-16 md:w-36 flex items-center justify-center`}
                  onClick={() => {
                    taskQueueService.removeAllTasks();
                    taskQueueService.stop();
                  }}
                >
                  <FaStop size={15} />
                </button>
                </Tooltip>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  },
);

interface SlotPieceProps {
  scene: { slots: PromptPieceSlot[] };
  piece: PromptPiece;
  removePiece?: (piece: PromptPiece) => void;
  moveSlotPiece?: (from: string, to: string) => void;
  style?: React.CSSProperties;
}

interface CharacterPromptsEditorProps {
  piece: PromptPiece;
  onClose: () => void;
}

const CharacterPromptsEditor = observer(
  ({ piece, onClose }: CharacterPromptsEditorProps) => {
    const addCharacterPrompt = () => {
      piece.characterPrompts.push('');
    };

    const updatePrompt = (index: number, value: string) => {
      piece.characterPrompts[index] = value;
    };

    const removePrompt = (index: number) => {
      piece.characterPrompts.splice(index, 1);
    };

    return (
      <div className="w-full h-full overflow-hidden flex flex-col p-3">
        <div className="flex-1 overflow-hidden">
          <div className="h-full overflow-auto">
            {piece.characterPrompts.length > 0 &&
              piece.characterPrompts.map((prompt, index) => (
                <div key={index} className="border rounded-md mt-3 p-3">
                  <div className="flex justify-between items-center mb-2">
                    <div className="flex items-center gap-2 gray-label">
                      캐릭터 프롬프트
                    </div>
                    <div className="flex items-center gap-2">
                      <Tooltip content="캐릭터 프롬프트 삭제">
                      <button
                        className="icon-button back-red"
                        onClick={() => removePrompt(index)}
                      >
                        <FaTrash />
                      </button>
                      </Tooltip>
                    </div>
                  </div>
                  <div className="mb-2">
                    <PromptEditTextArea
                      value={prompt}
                      onChange={(value) => updatePrompt(index, value)}
                    />
                  </div>
                </div>
              ))}
          </div>
        </div>
        <div className="flex-none mt-auto pt-2 flex gap-2 items-center">
          <button
            className="round-button back-green h-8"
            onClick={addCharacterPrompt}
          >
            캐릭터 추가
          </button>
          <button
            className="round-button back-gray h-8 w-full"
            onClick={onClose}
          >
            캐릭터 프롬프트 닫기
          </button>
        </div>
      </div>
    );
  },
);

export const SlotPiece = observer(
  ({ scene, piece, removePiece, moveSlotPiece, style }: SlotPieceProps) => {
    const [showCharacterPrompts, setShowCharacterPrompts] = useState(false);
    const [{ isDragging }, drag, preview] = useDrag(
      () => ({
        type: 'slot',
        item: { scene, piece },
        collect: (monitor) => {
          return {
            isDragging: monitor.isDragging(),
          };
        },
      }),
      [scene, piece],
    );

    const [{ isOver }, drop] = useDrop(
      () => ({
        accept: 'slot',
        canDrop: () => true,
        collect: (monitor) => {
          if (monitor.isOver()) {
            return {
              isOver: true,
            };
          }
          return { isOver: false };
        },
        drop: async (item: any, monitor) => {
          if (!moveSlotPiece) return;
          moveSlotPiece(item.piece.id, piece.id!);
        },
      }),
      [scene, piece],
    );

    useEffect(() => {
      preview(getEmptyImage(), { captureDraggingState: true });
    }, [preview]);

    return (
      <div
        key={piece.id!}
        ref={(node) => drag(drop(node))}
        style={style}
        className={
          'p-3 m-2 bg-gray-200 dark:bg-slate-600 rounded-xl ' +
          (isDragging ? 'opacity-0' : '') +
          (isOver ? ' outline outline-sky-500' : '')
        }
      >
        {showCharacterPrompts && (
          <FloatView
            priority={0}
            onEscape={() => setShowCharacterPrompts(false)}
          >
            <CharacterPromptsEditor
              piece={piece}
              onClose={() => setShowCharacterPrompts(false)}
            />
          </FloatView>
        )}

        <div className={'mb-3 h-12 w-28 md:h-24 md:w-48'}>
          <PromptEditTextArea
            whiteBg
            disabled={!moveSlotPiece}
            value={piece.prompt}
            onChange={(s) => {
              if (!moveSlotPiece) return;
              piece.prompt = s;
            }}
          />
        </div>
        <div className="flex gap-2 select-none">
          <label className="gray-label">활성화</label>
          <input
            type="checkbox"
            checked={piece.enabled == undefined || piece.enabled}
            onChange={(e) => {
              if (!moveSlotPiece) return;
              piece.enabled = e.currentTarget.checked;
            }}
          />
          <Tooltip content="캐릭터 프롬프트 편집">
          <button
            className="active:brightness-90 hover:brightness-95 text-blue-600 dark:text-blue-400"
            onClick={() => {
              if (!moveSlotPiece) return;
              setShowCharacterPrompts(true);
            }}
          >
            <FaUser size={20} />
            {piece.characterPrompts.length > 0 && (
              <span className="absolute top-0 right-0 transform translate-x-1/2 -translate-y-1/3 bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-xs">
                {piece.characterPrompts.length}
              </span>
            )}
          </button>
          </Tooltip>
          <button
            className="active:brightness-90 hover:brightness-95 ml-auto text-red-500 dark:text-red-400"
            onClick={() => {
              if (!moveSlotPiece) return;
              removePiece && removePiece(piece);
            }}
          >
            <FaTrash size={20} />
          </button>
        </div>
      </div>
    );
  },
);

// 씬별 캐릭터 프롬프트 에디터 (씬 전용 캐릭터 프롬프트 직접 입력)
interface SceneCharacterPromptEditorProps {
  scene: Scene;
}

const sceneCharColors = ['#38bdf8', '#f472b6', '#a78bfa', '#fb923c', '#4ade80', '#facc15', '#f87171', '#94a3b8'];

const SceneCharacterPromptEditor = observer(({ scene }: SceneCharacterPromptEditorProps) => {
  const [showCoordMap, setShowCoordMap] = useState(false);
  const coordMapRef = useRef<HTMLDivElement>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const addCharacter = () => {
    const newCharacter: CharacterPrompt = {
      id: uuidv4(),
      prompt: '',
      uc: '',
      position: { x: 0.5, y: 0.5 },
      enabled: true,
    };
    scene.sceneCharacterPrompts = [...(scene.sceneCharacterPrompts || []), newCharacter];
  };

  const removeCharacter = (id: string) => {
    scene.sceneCharacterPrompts = (scene.sceneCharacterPrompts || []).filter(c => c.id !== id);
  };

  const updateCharacter = (id: string, updates: Partial<CharacterPrompt>) => {
    scene.sceneCharacterPrompts = (scene.sceneCharacterPrompts || []).map(c =>
      c.id === id ? { ...c, ...updates } : c
    );
  };

  const toggleCharacter = (id: string) => {
    scene.sceneCharacterPrompts = (scene.sceneCharacterPrompts || []).map(c =>
      c.id === id ? { ...c, enabled: c.enabled === false ? true : false } : c
    );
  };

  const handleCoordPointer = (e: React.PointerEvent, charId: string, isDown = false) => {
    const rect = coordMapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    updateCharacter(charId, { position: { x, y } });
    if (isDown) {
      setDraggingId(charId);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }
  };

  const characters = scene.sceneCharacterPrompts || [];
  const enabledCount = characters.filter(c => c.enabled !== false).length;

  return (
    <div className="flex flex-col h-full p-4 overflow-hidden">
      <div className="flex-none mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-lg font-medium text-gray-800 dark:text-gray-100">
            <FaUser className="inline mr-2" />
            씬 전용 캐릭터 프롬프트
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={scene.useSceneCharacterPrompts || false}
                onChange={(e) => {
                  scene.useSceneCharacterPrompts = e.target.checked;
                }}
                className="w-4 h-4"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">씬 전용 캐릭터 프롬프트 사용</span>
            </label>
          </div>
        </div>
        <div className="text-sm text-gray-500 dark:text-gray-400">
          이 씬에서만 사용할 캐릭터 프롬프트를 직접 입력하세요.
          {scene.useSceneCharacterPrompts
            ? ' (활성화됨 - 공유 캐릭터 프롬프트 대신 이 프롬프트가 사용됩니다)'
            : ' (비활성화됨 - 공유 캐릭터 프롬프트가 사용됩니다)'}
        </div>
        {characters.length > 0 && (
          <div className="mt-2 text-sm">
            <span className="px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded">
              {enabledCount}/{characters.length} 캐릭터 활성화
            </span>
          </div>
        )}
      </div>

      {/* 좌표평면 */}
      {characters.length > 0 && (
        <div className="flex-none mb-3">
          <button
            className="text-xs text-sky-500 hover:text-sky-400 mb-1"
            onClick={() => setShowCoordMap(!showCoordMap)}
          >
            {showCoordMap ? '▼ 좌표평면 접기' : '▶ 좌표평면 펼치기'}
          </button>
          {showCoordMap && (
            <div
              ref={coordMapRef}
              className="relative bg-gray-100 dark:bg-slate-700 border border-gray-300 dark:border-slate-500 rounded select-none overflow-hidden"
              style={{ aspectRatio: '4 / 3', maxWidth: '360px', touchAction: 'none' }}
              onPointerMove={(e) => {
                if (draggingId) handleCoordPointer(e, draggingId);
              }}
              onPointerUp={() => setDraggingId(null)}
            >
              <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 300 300" preserveAspectRatio="none">
                <line x1="100" y1="0" x2="100" y2="300" stroke="currentColor" className="text-gray-200 dark:text-slate-600" strokeWidth="0.5" />
                <line x1="200" y1="0" x2="200" y2="300" stroke="currentColor" className="text-gray-200 dark:text-slate-600" strokeWidth="0.5" />
                <line x1="0" y1="100" x2="300" y2="100" stroke="currentColor" className="text-gray-200 dark:text-slate-600" strokeWidth="0.5" />
                <line x1="0" y1="200" x2="300" y2="200" stroke="currentColor" className="text-gray-200 dark:text-slate-600" strokeWidth="0.5" />
              </svg>
              {characters.map((c, i) => {
                const color = sceneCharColors[i % sceneCharColors.length];
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
                    onPointerDown={(e) => handleCoordPointer(e, c.id, true)}
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

      <div className="flex-1 overflow-auto">
        {characters.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            <FaUser className="text-4xl mx-auto mb-2 opacity-50" />
            <div>캐릭터 프롬프트가 없습니다</div>
            <div className="text-sm mt-1">아래 버튼을 눌러 캐릭터를 추가하세요</div>
          </div>
        ) : (
          <div className="space-y-4">
            {characters.map((character, index) => (
              <div
                key={character.id}
                className={`border rounded-lg p-4 transition-all ${
                  character.enabled !== false
                    ? 'border-sky-500 bg-sky-50 dark:bg-sky-900/20'
                    : 'border-gray-300 opacity-60'
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white" style={{ backgroundColor: sceneCharColors[index % sceneCharColors.length] }}>{index + 1}</div>
                    <span className="font-medium text-gray-800 dark:text-gray-100">캐릭터 프롬프트</span>
                    <button
                      className={`round-button h-7 px-3 text-sm ${
                        character.enabled !== false ? 'back-sky' : 'back-gray'
                      }`}
                      onClick={() => toggleCharacter(character.id)}
                    >
                      {character.enabled !== false ? (
                        <>
                          <FaToggleOn className="mr-1" />
                          활성화
                        </>
                      ) : (
                        <>
                          <FaToggleOff className="mr-1" />
                          비활성화
                        </>
                      )}
                    </button>
                  </div>
                  <button
                    className="icon-button back-red"
                    onClick={() => removeCharacter(character.id)}
                  >
                    <FaTrash />
                  </button>
                </div>

                <div className="mb-3">
                  <label className="block text-sm font-medium mb-1 gray-label">
                    캐릭터 프롬프트
                  </label>
                  <PromptEditTextArea
                    value={character.prompt}
                    onChange={(value) => updateCharacter(character.id, { prompt: value })}
                  />
                </div>

                <div className="mb-3">
                  <label className="block text-sm font-medium mb-1 gray-label">
                    캐릭터 네거티브 프롬프트
                  </label>
                  <PromptEditTextArea
                    value={character.uc}
                    onChange={(value) => updateCharacter(character.id, { uc: value })}
                  />
                </div>

                <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
                  <div className="w-3 h-3 rounded-full border" style={{ backgroundColor: sceneCharColors[index % sceneCharColors.length] }} />
                  위치: ({character.position?.x?.toFixed(2) || '0.50'}, {character.position?.y?.toFixed(2) || '0.50'})
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex-none mt-4 pt-4 border-t">
        <div className="flex gap-2">
          <button
            className="round-button back-green h-8 flex-1"
            onClick={addCharacter}
          >
            <FaPlus className="mr-2" />
            캐릭터 추가
          </button>
        </div>

        {/* 씬 전용 캐릭터 네거티브 프롬프트 (전체) */}
        <div className="mt-4">
          <label className="block text-sm font-medium mb-1 gray-label">
            씬 전용 캐릭터 공통 네거티브 프롬프트
          </label>
          <PromptEditTextArea
            value={scene.sceneCharacterUC || ''}
            onChange={(value) => {
              scene.sceneCharacterUC = value;
            }}
          />
        </div>
      </div>
    </div>
  );
});

export const SlotEditor = observer(({ scene, big }: SlotEditorProps) => {
  useEffect(() => {
    for (const slot of scene.slots) {
      for (const piece of slot) {
        if (!piece.id) {
          piece.id = uuidv4();
        }
      }
    }
  }, [scene]);

  const removePiece = (slot: PromptPieceSlot, pieceIndex: number) => {
    // 1열 1행 슬롯은 프롬프트 에디터와 연동되므로 삭제 불가
    const slotIndex = scene.slots.indexOf(slot);
    if (slotIndex === 0 && pieceIndex === 0) {
      appState.pushMessage('첫 번째 슬롯(1열 1행)은 프롬프트 에디터와 연동되어 삭제할 수 없습니다');
      return;
    }
    slot.splice(pieceIndex, 1);
    if (slot.length === 0) {
      scene.slots.splice(slotIndex, 1);
    }
  };

  const moveSlotPiece = (from: string, to: string) => {
    if (from === to) return;
    const fromSlotIndex = scene.slots.findIndex((slot) =>
      slot.some((piece) => piece.id === from),
    );
    const fromPieceIndex = scene.slots[fromSlotIndex].findIndex(
      (piece) => piece.id === from,
    );
    const toSlotIndex = scene.slots.findIndex((slot) =>
      slot.some((piece) => piece.id === to),
    );
    const toPieceIndex = scene.slots[toSlotIndex].findIndex(
      (piece) => piece.id === to,
    );

    const piece = scene.slots[fromSlotIndex][fromPieceIndex];
    scene.slots[fromSlotIndex].splice(fromPieceIndex, 1);
    scene.slots[toSlotIndex].splice(toPieceIndex, 0, piece);
    if (scene.slots[fromSlotIndex].length === 0) {
      scene.slots.splice(fromSlotIndex, 1);
    }
  };

  return (
    <div className="flex flex-col w-full">
      <div className="flex items-center gap-1 px-2 pt-1 pb-0.5">
        <Tooltip content={"각 열의 프롬프트를 조합하여 열×행의 모든 경우의 수만큼 이미지를 생성합니다.\n열 추가: 오른쪽 + 버튼 | 행 추가: 열 하단 + 버튼"}>
          <span className="text-yellow-500 dark:text-yellow-400 cursor-help" onMouseDown={(e) => e.stopPropagation()}>
            <FaQuestionCircle size={15} />
          </span>
        </Tooltip>
      </div>
      <div className="flex w-full">
        {scene.slots.map((slot, slotIndex) => (
          <div key={slotIndex}>
            {slot.map((piece, pieceIndex) => (
              <SlotPiece
                key={piece.id!}
                scene={scene}
                piece={piece}
                removePiece={(piece: PromptPiece) =>
                  removePiece(slot, slot.indexOf(piece)!)
                }
                moveSlotPiece={moveSlotPiece}
              />
            ))}
            <button
              className="p-2 m-2 w-14 back-lllgray clickable rounded-xl flex justify-center"
              onClick={() => {
                slot.push(
                  PromptPiece.fromJSON({
                    prompt: '',
                    characterPrompts: [],
                    enabled: true,
                    id: uuidv4(),
                  }),
                );
              }}
            >
              <FaPlus />
            </button>
          </div>
        ))}
        <button
          className="p-2 m-2 h-14 flex items-center back-lllgray clickable rounded-xl"
          onClick={() => {
            scene.slots.push([
              PromptPiece.fromJSON({
                prompt: '',
                characterPrompts: [],
                enabled: true,
                id: uuidv4(),
              }),
            ]);
          }}
        >
          <FaPlus />
        </button>
      </div>
    </div>
  );
});

const SceneEditor = observer(({ scene, onClosed, onDeleted, initialTab }: Props) => {
  const { curSession } = appState;
  const [_, rerender] = useState<{}>({});
  const [curName, setCurName] = useState('');
  const [type, preset, shared, def] = curSession!.getCommonSetup(
    curSession!.selectedWorkflow!,
  );

  if (type && !scene.meta.has(type)) {
    scene.meta.set(type, workFlowService.buildMeta(type));
    rerender({});
  }

  const curNameRef = useRef('');
  useEffect(() => {
    setCurName(scene.name);
    curNameRef.current = scene.name;
  }, [scene]);

  // 씬 이름 변경 ref 동기화
  useEffect(() => {
    curNameRef.current = curName;
  }, [curName]);

  // 컴포넌트 언마운트(편집 창 닫기) 시 이름이 바뀌었으면 자동 적용
  useEffect(() => {
    return () => {
      const trimmedName = curNameRef.current.trimEnd();
      if (trimmedName && trimmedName !== scene.name) {
        if (curSession!.hasScene(scene.type, trimmedName)) {
          appState.pushMessage(
            '같은 이름의 씬이 이미 있어 이름 변경이 취소되었습니다. (병합하려면 "이름 변경" 버튼을 사용하세요)',
          );
          return;
        }
        renameScene(curSession!, scene.name, trimmedName);
      }
    };
  }, [scene]);

  const getMiddlePrompt = () => {
    if (scene.slots.length === 0 || scene.slots[0].length === 0) {
      return '';
    }
    return scene.slots[0][0].prompt;
  };

  const onMiddlePromptChange = (txt: string) => {
    if (scene.slots.length === 0 || scene.slots[0].length === 0) {
      return;
    }
    scene.slots[0][0].prompt = txt;
  };

  const getCharacterMiddlePrompt = (index: number) => {
    if (scene.slots.length === 0 || scene.slots[0].length === 0) {
      return '';
    }
    return scene.slots[0][0].characterPrompts[index] || '';
  };

  const onCharacterMiddlePromptChange = (index: number, txt: string) => {
    if (scene.slots.length === 0 || scene.slots[0].length === 0) {
      return;
    }
    scene.slots[0][0].characterPrompts[index] = txt;
  };

  const queuePrompt = async (
    middle: string,
    callback: (path: string) => void,
  ) => {
    try {
      const prompts = await workFlowService.createPrompts(
        type,
        curSession!,
        scene,
        preset,
        shared,
      );
      const characterPrompts = await workFlowService.createCharacterPrompts(
        type,
        curSession!,
        scene,
        preset,
        shared,
      );
      await workFlowService.pushJob(
        type,
        curSession!,
        scene,
        prompts[0],
        characterPrompts[0],
        preset,
        shared,
        1,
        scene.meta.get(type),
        callback,
        true,
      );
      taskQueueService.run();
    } catch (e: any) {
      appState.pushMessage(e.message);
      return;
    }
  };

  const setMainImage = (path: string) => {
    const filename = path.split('/').pop()!;
    if (!(filename in scene.mains)) {
      scene.mains.push(filename);
    }
  };

  const [previews, setPreviews] = useState<PromptNode[]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const PromptPreview = previewError ? (
    <div className="bg-red-500 p-2 m-2">{previewError}</div>
  ) : (
    <div>
      {previews.map((preview, index) => (
        <PromptHighlighter
          className="inline-block word-breaks p-2 m-2"
          key={index}
          text={lowerPromptNode(preview)}
        />
      ))}
    </div>
  );

  const SmallSlotEditor = <SlotEditor scene={scene} big={false} />;

  const BigEditor = (
    <BigPromptEditor
      general={true}
      meta={type && scene.meta.get(type)}
      getMiddlePrompt={getMiddlePrompt}
      setMiddlePrompt={onMiddlePromptChange}
      getCharacterMiddlePrompt={getCharacterMiddlePrompt}
      setCharacterMiddlePrompt={onCharacterMiddlePromptChange}
      queuePrompt={queuePrompt}
      setMainImage={setMainImage}
      initialImagePath={getMainImagePath(curSession!, scene)}
    />
  );

  const resolutionOptions = Object.entries(resolutionMap)
    .map(([key, value]) => {
      const resolVal =
        (scene.resolutionWidth ?? '') + 'x' + (scene.resolutionHeight ?? '');
      if (key === 'custom')
        return { label: '커스텀 (' + resolVal + ')', value: key };
      return { label: `${value.width}x${value.height}`, value: key };
    })
    .filter((x) => !x.value.startsWith('small'));

  return (
    <div className="w-full h-full overflow-hidden">
      <div className="flex flex-col overflow-hidden h-full w-full">
        <div className="grow-0 pt-2 px-3 flex gap-3 items-center text-nowrap flex-wrap mb-2 md:mb-0">
          <div className="flex items-center gap-2">
            <label className="gray-label">씬 이름:</label>
            <input
              className="gray-input"
              type="text"
              value={curName}
              onChange={(e) => {
                setCurName(e.currentTarget.value);
              }}
            />
          </div>
          <div className="flex items-center gap-2 ">
            <label className="gray-label">해상도:</label>
            <div className="md:w-36">
              <DropdownSelect
                options={resolutionOptions}
                menuPlacement="bottom"
                selectedOption={scene.resolution}
                onSelect={async (opt) => {
                  if (
                    opt.value.startsWith('large') ||
                    opt.value.startsWith('wallpaper')
                  ) {
                    appState.pushDialog({
                      type: 'confirm',
                      text: '해당 해상도는 Anlas를 소모합니다 (유로임) 계속하시겠습니까?',
                      callback: () => {
                        scene.resolution = opt.value as Resolution;
                      },
                    });
                  } else if (opt.value === 'custom') {
                    const width = await appState.pushDialogAsync({
                      type: 'input-confirm',
                      text: '해상도 너비를 입력해주세요',
                    });
                    if (width == null) return;
                    const height = await appState.pushDialogAsync({
                      type: 'input-confirm',
                      text: '해상도 높이를 입력해주세요',
                    });
                    if (height == null) return;
                    try {
                      const customResolution = {
                        width: parseInt(width),
                        height: parseInt(height),
                      };
                      scene.resolution = opt.value as Resolution;
                      scene.resolutionWidth =
                        (customResolution.width + 63) & ~63;
                      scene.resolutionHeight =
                        (customResolution.height + 63) & ~63;
                    } catch (e: any) {
                      appState.pushMessage(e.message);
                    }
                  } else {
                    scene.resolution = opt.value as Resolution;
                  }
                }}
              />
            </div>
          </div>

          <button
            className={`round-button back-sky`}
            onClick={async () => {
              const trimmedName = curName.trimEnd();
              if (!trimmedName) return;
              if (trimmedName === scene.name) return;
              // 중복 이름 검사 (scenes는 Map이므로 hasScene으로 검사해야 함)
              if (curSession!.hasScene(scene.type, trimmedName)) {
                // 중복 시 병합/취소 선택. 확인을 누르면 병합한다.
                appState.pushDialog({
                  type: 'confirm',
                  green: false,
                  text:
                    `"${trimmedName}" 씬이 이미 존재합니다.\n두 씬을 병합할까요?\n\n` +
                    `• 이미지: 두 씬의 이미지가 "${trimmedName}" 씬으로 합쳐집니다\n` +
                    `• 프롬프트/설정: 기존 "${trimmedName}" 씬의 것을 유지하고,\n  지금 편집 중인 씬의 프롬프트는 사라집니다\n\n` +
                    `이 작업은 되돌릴 수 없습니다.`,
                  callback: async () => {
                    try {
                      await mergeScene(curSession!, scene.name, trimmedName);
                      // 병합 후 편집 중인(사라진) 씬의 에디터를 닫는다.
                      // 언마운트 시 자동 이름 변경이 다시 트리거되지 않도록 ref를 원상태로 둔다.
                      curNameRef.current = scene.name;
                      appState.pushMessage(`"${trimmedName}" 씬으로 병합했습니다`);
                      onClosed();
                      if (onDeleted) onDeleted();
                    } catch (e: any) {
                      appState.pushMessage(
                        '씬 병합 중 오류가 발생했습니다: ' + (e?.message ?? e),
                      );
                    }
                  },
                });
                return;
              }
              await renameScene(curSession!, scene.name, trimmedName);
            }}
          >
            이름 변경
          </button>
          <button
            className={`round-button back-red`}
            onClick={() => {
              appState.pushDialog({
                type: 'confirm',
                text: '정말로 해당 씬을 삭제하시겠습니까? (휴지통으로 이동)',
                callback: async () => {
                  const { trashService } = await import('../models');
                  await trashService.moveSceneToTrash(curSession!, scene);
                  onClosed();
                  if (onDeleted) {
                    onDeleted();
                  }
                },
              });
            }}
          >
            삭제
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          <TabComponent
            defaultActiveTab={initialTab}
            tabs={[
              {
                label: '프롬프트 에디터',
                content: BigEditor,
                emoji: <FaImages />,
              },
              {
                label: '조합 에디터',
                content: SmallSlotEditor,
                emoji: <FaPuzzlePiece />,
              },
              {
                label: '씬 캐릭터 프롬프트',
                content: <SceneCharacterPromptEditor scene={scene} />,
                emoji: <FaUser />,
              },
              {
                label: '최종 프롬프트 미리보기',
                content: PromptPreview,
                emoji: <FaSearch />,
                onClick: () => {
                  (async () => {
                    try {
                      const prompts = await workFlowService.createPrompts(
                        type,
                        curSession!,
                        scene,
                        preset,
                        shared,
                      );
                      setPreviews(prompts);
                    } catch (e: any) {
                      setPreviewError(e.message);
                    }
                  })();
                },
              },
            ]}
          />
        </div>
      </div>
    </div>
  );
});

export default SceneEditor;
