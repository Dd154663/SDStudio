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
  FaThLarge,
  FaList,
  FaExpand,
  FaChevronDown,
  FaChevronRight,
  FaEye,
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
import {
  highlightPrompt,
  lowerPromptNode,
  enumerateCombinations,
  combinationCount,
} from '../models/PromptService';
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
          'max-w-full break-words bg-[var(--c-input-bg)] ' +
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
  // 단순 씬 에디터 모드: 프리셋 폼 대신 중간 프롬프트 + 씬 전용 네거티브 두 입력만 노출
  simplified?: boolean;
  getSceneUC?: () => string;
  setSceneUC?: (txt: string) => void;
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
    simplified,
    getSceneUC,
    setSceneUC,
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
        {!simplified && promptOpen && (
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
        {simplified ? (
          <div className="overflow-auto flex-none h-1/3 md:h-auto md:w-1/3 md:h-full">
            <div className="h-full flex flex-col p-2 gap-2 overflow-hidden">
              <div className="flex-none font-bold text-sub">
                중간 프롬프트 (이 씬에만 적용됨)
              </div>
              <div className="flex-[2] min-h-0 overflow-hidden">
                <PromptEditTextArea
                  disabled={editDisabled}
                  onChange={setMiddlePrompt}
                  value={getMiddlePrompt()}
                />
              </div>
              <div className="flex-none font-bold text-sub">
                씬 전용 네거티브 프롬프트 (이 씬에만 적용됨)
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                <PromptEditTextArea
                  disabled={editDisabled}
                  onChange={(t) => setSceneUC && setSceneUC(t)}
                  value={getSceneUC ? getSceneUC() : ''}
                />
              </div>
            </div>
          </div>
        ) : (
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
        )}
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
  colIndex?: number;
  rowIndex?: number;
  onExpand?: () => void;
}

// 조합 에디터 열 색상(영향 범위 표기) — 씬 캐릭터 팔레트 재사용.
const columnColor = (i: number) => sceneCharColors[i % sceneCharColors.length];
// 조각(셀) 기본 표시 이름 = "열-행"(1-based).
const pieceDefaultName = (col: number, row: number) => `${col + 1}-${row + 1}`;
const pieceLabel = (piece: PromptPiece, col: number, row: number) =>
  piece.name && piece.name.trim() ? piece.name.trim() : pieceDefaultName(col, row);

// 조합 에디터 뷰 모드 지속(appState 즉시 반영 + config 저장). applyCompanionSlots 패턴.
async function applyCombinationView(next: 'card' | 'list'): Promise<void> {
  appState.uiCombinationView = next;
  try {
    const config = await backend.getConfig();
    await backend.setConfig({ ...config, uiCombinationView: next });
  } catch (e) {
    console.error('조합 에디터 뷰 저장 실패:', e);
  }
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
  ({
    scene,
    piece,
    removePiece,
    moveSlotPiece,
    style,
    colIndex,
    rowIndex,
    onExpand,
  }: SlotPieceProps) => {
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

        <div className="flex items-center gap-1 mb-1 w-28 md:w-48">
          {colIndex !== undefined && (
            <span
              className="flex-none w-2.5 h-2.5 rounded-sm"
              style={{ backgroundColor: columnColor(colIndex) }}
            />
          )}
          <input
            className="gray-input text-xs h-6 min-w-0 flex-1"
            type="text"
            disabled={!moveSlotPiece}
            value={piece.name ?? ''}
            placeholder={
              colIndex !== undefined && rowIndex !== undefined
                ? pieceDefaultName(colIndex, rowIndex)
                : '이름'
            }
            onChange={(e) => {
              if (!moveSlotPiece) return;
              piece.name = e.currentTarget.value;
            }}
          />
          {onExpand && (
            <Tooltip content="확대 편집">
              <button
                className="flex-none active:brightness-90 hover:brightness-95 text-sky-600 dark:text-sky-400"
                onClick={() => {
                  if (!moveSlotPiece) return;
                  onExpand();
                }}
              >
                <FaExpand size={15} />
              </button>
            </Tooltip>
          )}
        </div>
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
          <div className="text-lg font-medium text-default">
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
        <div className="text-sm text-muted">
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
              className="relative bg-[var(--c-surface)] border line-color rounded select-none overflow-hidden"
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
          <div className="text-center text-muted py-8">
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
                    : 'line-color opacity-60'
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white" style={{ backgroundColor: sceneCharColors[index % sceneCharColors.length] }}>{index + 1}</div>
                    <span className="font-medium text-default">캐릭터 프롬프트</span>
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

                <div className="flex items-center gap-2 text-xs text-faint">
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

// 조각(셀) 확대 편집기 — 카드/목록 공용 FloatView 내용. 이름·큰 프롬프트·활성·캐릭터 프롬프트.
interface PieceExpandEditorProps {
  piece: PromptPiece;
  colIndex: number;
  rowIndex: number;
  editable: boolean;
  onClose: () => void;
}
const PieceExpandEditor = observer(
  ({ piece, colIndex, rowIndex, editable, onClose }: PieceExpandEditorProps) => {
    const [showChars, setShowChars] = useState(false);
    if (showChars) {
      return (
        <CharacterPromptsEditor
          piece={piece}
          onClose={() => setShowChars(false)}
        />
      );
    }
    return (
      <div className="w-full h-full flex flex-col p-4 gap-3 overflow-hidden">
        <div className="flex-none flex items-center gap-2">
          <span
            className="flex-none w-4 h-4 rounded-full"
            style={{ backgroundColor: columnColor(colIndex) }}
          />
          <label className="gray-label flex-none">이름</label>
          <input
            className="gray-input flex-1 min-w-0"
            type="text"
            disabled={!editable}
            value={piece.name ?? ''}
            placeholder={pieceDefaultName(colIndex, rowIndex)}
            onChange={(e) => {
              piece.name = e.currentTarget.value;
            }}
          />
        </div>
        <div className="flex-none flex items-center gap-3 flex-wrap">
          <label className="gray-label flex items-center gap-2">
            <input
              type="checkbox"
              disabled={!editable}
              checked={piece.enabled === undefined || piece.enabled}
              onChange={(e) => {
                piece.enabled = e.currentTarget.checked;
              }}
            />
            활성화
          </label>
          <button
            className="round-button back-sky h-8"
            onClick={() => setShowChars(true)}
          >
            <FaUser className="inline mr-1" />
            캐릭터 프롬프트
            {piece.characterPrompts.length > 0
              ? ` (${piece.characterPrompts.length})`
              : ''}
          </button>
        </div>
        <div className="flex-none font-bold text-sub">프롬프트</div>
        <div className="flex-1 min-h-0 overflow-hidden">
          <PromptEditTextArea
            disabled={!editable}
            value={piece.prompt}
            onChange={(s) => {
              piece.prompt = s;
            }}
          />
        </div>
        <div className="flex-none">
          <button
            className="round-button back-gray h-8 w-full"
            onClick={onClose}
          >
            닫기
          </button>
        </div>
      </div>
    );
  },
);

// 조합 미리보기 — 총 개수·열 색상 범례·조합별 색상 구분 프롬프트. 실시간(관찰) 파생, 저장 안 함.
const PREVIEW_RENDER_CAP = 100;
const CombinationPreview = observer(
  ({ scene }: { scene: { slots: PromptPieceSlot[] } }) => {
    const [open, setOpen] = useState(false);
    const sc = scene as unknown as Scene;
    const total = combinationCount(sc);
    const columns = scene.slots.length;
    const combos =
      open && total > 0 && total <= PREVIEW_RENDER_CAP
        ? enumerateCombinations(sc, PREVIEW_RENDER_CAP)
        : [];
    return (
      <div className="mx-2 mb-2 border line-color rounded-lg overflow-hidden">
        <button
          className="w-full flex items-center gap-2 px-3 py-2 bg-[var(--c-surface2)] text-left"
          onClick={() => setOpen(!open)}
        >
          <span className="flex-none">
            {open ? <FaChevronDown /> : <FaChevronRight />}
          </span>
          <FaEye className="flex-none" />
          <span className="font-bold flex-none">조합 미리보기</span>
          <span
            className="flex-none ml-1 px-2 py-0.5 rounded-full text-white text-sm"
            style={{ backgroundColor: total === 0 ? '#f87171' : '#22c55e' }}
          >
            총 {total}종
          </span>
          {total === 0 && (
            <span className="text-sm text-red-500 truncate">
              활성 조각이 없는 열이 있어 생성되지 않습니다
            </span>
          )}
        </button>
        {open && (
          <div className="p-3 max-h-72 overflow-auto">
            {columns > 0 && (
              <div className="flex flex-wrap gap-3 mb-3">
                {scene.slots.map((_, ci) => (
                  <span key={ci} className="flex items-center gap-1 text-sm">
                    <span
                      className="w-3 h-3 rounded-sm"
                      style={{ backgroundColor: columnColor(ci) }}
                    />
                    열 {ci + 1}
                  </span>
                ))}
              </div>
            )}
            {total === 0 ? (
              <div className="text-sm text-muted">생성될 조합이 없습니다.</div>
            ) : total > PREVIEW_RENDER_CAP ? (
              <div className="text-sm text-muted">
                조합이 {total}종으로 많아 목록 표시를 생략합니다. (미리보기 상한{' '}
                {PREVIEW_RENDER_CAP}종)
              </div>
            ) : (
              <div className="flex flex-col">
                {combos.map((combo, i) => {
                  const segs = combo.filter(
                    (seg) => seg.piece.prompt.trim() !== '',
                  );
                  return (
                    <div
                      key={i}
                      className="py-1.5 border-b line-color last:border-b-0"
                    >
                      <div className="flex flex-wrap gap-1 mb-1">
                        {combo.map((seg, j) => {
                          const row = sc.slots[seg.columnIndex].indexOf(
                            seg.piece,
                          );
                          return (
                            <span
                              key={j}
                              className="px-1.5 rounded text-xs text-white"
                              style={{
                                backgroundColor: columnColor(seg.columnIndex),
                              }}
                            >
                              {pieceLabel(seg.piece, seg.columnIndex, row)}
                            </span>
                          );
                        })}
                      </div>
                      <div className="break-words text-sm">
                        {segs.length === 0 ? (
                          <span className="text-faint">(빈 프롬프트)</span>
                        ) : (
                          segs.map((seg, j) => (
                            <span key={j}>
                              {j > 0 && (
                                <span className="text-faint">, </span>
                              )}
                              <span
                                style={{
                                  color: columnColor(seg.columnIndex),
                                }}
                              >
                                {seg.piece.prompt.trim()}
                              </span>
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    );
  },
);

// 초심자 안내 배너(접이식). 툴팁 1줄을 대체 — 목적/사용법/개수 규칙을 설명.
const CombinationHelpBanner = observer(() => {
  const [open, setOpen] = useState(false);
  return (
    <div className="mx-2 mt-1 mb-2 border line-color rounded-lg bg-[var(--c-surface2)] text-sm">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
        onClick={() => setOpen(!open)}
      >
        <span className="flex-none">
          {open ? <FaChevronDown /> : <FaChevronRight />}
        </span>
        <FaQuestionCircle className="flex-none text-yellow-500 dark:text-yellow-400" />
        <span className="font-bold">조합 에디터란?</span>
      </button>
      {open && (
        <div className="px-3 pb-3 text-muted leading-relaxed">
          같은 씬 안에서 <b>여러 바리에이션을 한 번에 생성</b>하는 도구입니다.
          <br />각 <b>열</b>에 후보 프롬프트(조각)를 넣으면, 생성할 때{' '}
          <b>열마다 하나씩 골라</b> 조합합니다. 만들어지는 이미지 수 = 열1 조각수
          × 열2 조각수 × … 입니다.
          <br />
          예) 열1 [봄, 여름] · 열2 [낮, 밤] → 봄·낮 / 봄·밤 / 여름·낮 / 여름·밤 =
          4종.
          <br />
          아래 <b>조합 미리보기</b>에서 실제로 몇 종이 어떻게 조합되는지 색으로
          확인할 수 있습니다.
        </div>
      )}
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

  const [expand, setExpand] = useState<{
    piece: PromptPiece;
    col: number;
    row: number;
    editable: boolean;
  } | null>(null);
  const view = appState.uiCombinationView;

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

  const newPiece = () =>
    PromptPiece.fromJSON({
      prompt: '',
      characterPrompts: [],
      enabled: true,
      id: uuidv4(),
    });
  const addRow = (slot: PromptPieceSlot) => slot.push(newPiece());
  const addColumn = () => scene.slots.push([newPiece()]);
  const isEnabled = (p: PromptPiece) => p.enabled === undefined || p.enabled;

  return (
    <div className="flex flex-col w-full h-full overflow-auto">
      {expand && (
        <FloatView priority={0} onEscape={() => setExpand(null)}>
          <PieceExpandEditor
            piece={expand.piece}
            colIndex={expand.col}
            rowIndex={expand.row}
            editable={expand.editable}
            onClose={() => setExpand(null)}
          />
        </FloatView>
      )}

      <CombinationHelpBanner />

      {/* 뷰 토글 */}
      <div className="flex items-center gap-2 px-2 mb-1">
        <span className="gray-label">보기:</span>
        <button
          className={`round-button h-8 ${
            view === 'card' ? 'back-sky' : 'back-gray'
          }`}
          onClick={() => applyCombinationView('card')}
        >
          <FaThLarge className="inline mr-1" />
          카드
        </button>
        <button
          className={`round-button h-8 ${
            view === 'list' ? 'back-sky' : 'back-gray'
          }`}
          onClick={() => applyCombinationView('list')}
        >
          <FaList className="inline mr-1" />
          목록
        </button>
      </div>

      <CombinationPreview scene={scene} />

      {view === 'list' ? (
        /* 컴팩트 목록 뷰 — 열 섹션마다 얇은 전체폭 행. 모바일 편집 편의. */
        <div className="flex flex-col px-2 pb-2 gap-3">
          {scene.slots.map((slot, ci) => (
            <div
              key={ci}
              className="border line-color rounded-lg overflow-hidden"
            >
              <div
                className="flex items-center gap-2 px-2 py-1.5 bg-[var(--c-surface2)]"
                style={{ borderLeft: `4px solid ${columnColor(ci)}` }}
              >
                <span
                  className="w-3 h-3 rounded-sm flex-none"
                  style={{ backgroundColor: columnColor(ci) }}
                />
                <span className="font-bold flex-none">열 {ci + 1}</span>
                <span className="text-faint text-xs flex-none">
                  {slot.filter(isEnabled).length}/{slot.length} 활성
                </span>
              </div>
              {slot.map((piece, ri) => (
                <div
                  key={piece.id!}
                  className="flex items-center gap-2 px-2 py-1.5 border-t line-color"
                >
                  <input
                    className="gray-input text-xs h-8 w-16 md:w-24 flex-none"
                    type="text"
                    value={piece.name ?? ''}
                    placeholder={pieceDefaultName(ci, ri)}
                    onChange={(e) => {
                      piece.name = e.currentTarget.value;
                    }}
                  />
                  <div className="flex-1 min-w-0 h-9">
                    <PromptEditTextArea
                      value={piece.prompt}
                      onChange={(s) => {
                        piece.prompt = s;
                      }}
                    />
                  </div>
                  <Tooltip content="활성화">
                    <input
                      type="checkbox"
                      className="flex-none"
                      checked={isEnabled(piece)}
                      onChange={(e) => {
                        piece.enabled = e.currentTarget.checked;
                      }}
                    />
                  </Tooltip>
                  <Tooltip content="확대 편집 / 캐릭터 프롬프트">
                    <button
                      className="flex-none relative text-sky-600 dark:text-sky-400 active:brightness-90 hover:brightness-95"
                      onClick={() =>
                        setExpand({
                          piece,
                          col: ci,
                          row: ri,
                          editable: true,
                        })
                      }
                    >
                      <FaExpand size={18} />
                      {piece.characterPrompts.length > 0 && (
                        <span className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-3.5 h-3.5 flex items-center justify-center text-[10px]">
                          {piece.characterPrompts.length}
                        </span>
                      )}
                    </button>
                  </Tooltip>
                  <button
                    className="flex-none text-red-500 dark:text-red-400 active:brightness-90 hover:brightness-95"
                    onClick={() => removePiece(slot, ri)}
                  >
                    <FaTrash size={18} />
                  </button>
                </div>
              ))}
              <button
                className="w-full flex items-center justify-center gap-1 py-1.5 border-t line-color back-lllgray clickable text-sm"
                onClick={() => addRow(slot)}
              >
                <FaPlus size={12} /> 행 추가
              </button>
            </div>
          ))}
          <button
            className="flex items-center justify-center gap-1 py-2 back-lllgray clickable rounded-lg"
            onClick={addColumn}
          >
            <FaPlus size={12} /> 열 추가
          </button>
        </div>
      ) : (
        /* 카드 뷰 — 기존 격자(열=세로 스택). 각 카드에 이름·확대 추가. */
        <div className="flex">
          {scene.slots.map((slot, slotIndex) => (
            <div key={slotIndex}>
              {slot.map((piece, pieceIndex) => (
                <SlotPiece
                  key={piece.id!}
                  scene={scene}
                  piece={piece}
                  colIndex={slotIndex}
                  rowIndex={pieceIndex}
                  onExpand={() =>
                    setExpand({
                      piece,
                      col: slotIndex,
                      row: pieceIndex,
                      editable: true,
                    })
                  }
                  removePiece={(piece: PromptPiece) =>
                    removePiece(slot, slot.indexOf(piece)!)
                  }
                  moveSlotPiece={moveSlotPiece}
                />
              ))}
              <button
                className="p-2 m-2 w-14 back-lllgray clickable rounded-xl flex justify-center"
                onClick={() => addRow(slot)}
              >
                <FaPlus />
              </button>
            </div>
          ))}
          <button
            className="p-2 m-2 h-14 flex items-center back-lllgray clickable rounded-xl"
            onClick={addColumn}
          >
            <FaPlus />
          </button>
        </div>
      )}
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

  const legacyScene = appState.legacySceneEditor;

  // 씬 전용 네거티브 프롬프트 (단순 씬 에디터 전용) — 생성 시 네거티브 뒤에 붙는다
  const getSceneUC = () => scene.sceneUC ?? '';
  const setSceneUC = (txt: string) => {
    scene.sceneUC = txt;
  };

  // 단순 씬 에디터에선 slots 가 비어 있으면 중간 프롬프트 입력이 불가하므로 첫 조각을 보장한다.
  useEffect(() => {
    if (
      !legacyScene &&
      (scene.slots.length === 0 || scene.slots[0].length === 0)
    ) {
      scene.slots = [
        [PromptPiece.fromJSON({ prompt: '', characterPrompts: [], id: uuidv4() })],
      ];
    }
  }, [scene, legacyScene]);

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
      simplified={!legacyScene}
      getSceneUC={getSceneUC}
      setSceneUC={setSceneUC}
    />
  );

  // 조합 에디터·씬 캐릭터 프롬프트·미리보기 — 레거시 탭과 단순 모드 고급 편집 오버레이가 공유
  const runPreview = () => {
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
  };
  const advancedTabs = [
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
      onClick: runPreview,
    },
  ];

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
              ...advancedTabs,
            ]}
          />
        </div>
      </div>
    </div>
  );
});

export default SceneEditor;
