import { memo, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { FloatView } from './FloatView';
import SceneEditor from './SceneEditor';
import { FaBookmark, FaEdit, FaFileImage, FaPlus, FaRegCalendarTimes, FaSearch, FaStar, FaTimes, FaTrash, FaTrashRestore } from 'react-icons/fa';
import Tournament from './Tournament';
import ResultViewer from './ResultViewer';
import InPaintEditor from './InPaintEditor';
import { base64ToDataUri } from './BrushTool';
import { useDrag, useDrop } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';
import { useContextMenu } from 'react-contexify';
import SceneSelector from './SceneSelector';
import Tooltip from './Tooltip';
import { v4 } from 'uuid';
import { ImageOptimizeMethod } from '../backend';
import {
  isMobile,
  gameService,
  sessionService,
  imageService,
  taskQueueService,
  backend,
  localAIService,
  zipService,
  workFlowService,
  trashService,
  promptService,
} from '../models';
import {
  getMainImage,
  dataUriToBase64,
  deleteImageFiles,
} from '../models/ImageService';
import { queueI2IWorkflow, queueMirrorWorkflow, queueWorkflow } from '../models/TaskQueueService';
import {
  GenericScene,
  ContextMenuType,
  Scene,
  InpaintScene,
  Session,
  PieceLibrary,
  Piece,
} from '../models/types';
import { extractPromptDataFromBase64 } from '../models/util';
import { appState, SceneSelectorItem } from '../models/AppService';
import { observer } from 'mobx-react-lite';
import { createInpaintPreset, prepareMirrorCanvas } from '../models/workflows/SDWorkFlow';
import { reaction } from 'mobx';
import { oneTimeFlowMap, oneTimeFlows } from '../models/workflows/OneTimeFlows';

const createMissingPiecesForSession = (
  session: Session,
  missing: { library: string; piece: string }[],
) => {
  for (const m of missing) {
    let lib = session.library.get(m.library);
    if (!lib) {
      lib = new PieceLibrary();
      lib.name = m.library;
      session.library.set(m.library, lib);
    }
    if (!lib.pieces.find((x) => x.name === m.piece)) {
      const piece = new Piece();
      piece.name = m.piece;
      lib.pieces.push(piece);
    }
  }
  sessionService.dirty[session.name] = true;
  sessionService.reloadPieceLibraryDB(session);
};

const queueScene = async (
  session: Session,
  scene: GenericScene,
  samples: number,
) => {
  if (scene.type === 'scene') {
    await queueWorkflow(
      session,
      session.selectedWorkflow!,
      scene,
      samples,
    );
  } else {
    const inpaintScene = scene as InpaintScene;
    if (inpaintScene.workflowType === 'SDMirror') {
      await queueMirrorWorkflow(
        session,
        inpaintScene.workflowType,
        inpaintScene.preset,
        inpaintScene,
        samples,
      );
    } else {
      await queueI2IWorkflow(
        session,
        scene.workflowType,
        scene.preset,
        scene,
        samples,
      );
    }
  }
};

interface SceneCellProps {
  scene: GenericScene;
  curSession: Session;
  cellSize: number;
  getImage: (scene: GenericScene) => Promise<string | null>;
  setDisplayScene?: (scene: GenericScene) => void;
  setEditingScene?: (scene: GenericScene) => void;
  moveScene?: (scene: GenericScene, index: number) => void;
  style?: React.CSSProperties;
  isBookmarked?: boolean;
  onToggleBookmark?: () => void;
  disableHover?: boolean;
}

export const SceneCell = observer(
  ({
    scene,
    getImage,
    setDisplayScene,
    moveScene,
    setEditingScene,
    curSession,
    cellSize,
    style,
    isBookmarked,
    onToggleBookmark,
    disableHover,
  }: SceneCellProps) => {
    const { show, hideAll } = useContextMenu({
      id: ContextMenuType.Scene,
    });
    const [image, setImage] = useState<string | undefined>(undefined);
    let emoji = '';
    if (scene.type === 'inpaint') {
      const def = workFlowService.getDef(scene.workflowType);
      if (def) {
        emoji = def.emoji ?? '';
      }
    }

    const isClassic = appState.classicSceneCard;
    const tabType = scene.type === 'inpaint' ? 'inpaint' : 'scene';
    const cardStyle = curSession.sceneCardStyle?.[tabType] ?? 'portrait';
    const aspectMap: Record<string, string> = {
      portrait: 'aspect-[3/4]',
      square: 'aspect-square',
      landscape: 'aspect-[4/3]',
    };
    const aspectClass = aspectMap[cardStyle];
    const cellSizes = isMobile
      ? ['w-48 h-48', 'w-36 h-36', 'w-96 h-96']
      : aspectClass
        ? [`w-full ${aspectClass}`, `w-full ${aspectClass}`, `w-full ${aspectClass}`]
        : ['w-full h-48', 'w-full h-64', 'w-full h-96'];
    const cellSizes3 = isMobile
      ? ['w-48', 'w-36', 'w-96']
      : ['', '', ''];

    const curIndex = curSession.getScenes(scene.type).indexOf(scene);
    const [{ isDragging }, drag, preview] = useDrag(
      () => ({
        type: 'scene',
        item: { scene, curIndex, getImage, curSession, cellSize },
        collect: (monitor) => {
          const diff = monitor.getDifferenceFromInitialOffset();
          if (diff) {
            const dist = Math.sqrt(diff.x ** 2 + diff.y ** 2);
            if (dist > 20) {
              hideAll();
            }
          }
          return {
            isDragging: monitor.isDragging(),
          };
        },
        end: (item, monitor) => {
          // if (!isMobile) return;
          const { scene: droppedScene, curIndex: droppedIndex } = item;
          const didDrop = monitor.didDrop();
          if (!didDrop) {
            moveScene!(droppedScene, droppedIndex);
          }
        },
      }),
      [curIndex, scene, cellSize],
    );

    useEffect(() => {
      preview(getEmptyImage(), { captureDraggingState: true });
    }, [preview]);

    const [{ isOver }, drop] = useDrop<any, any, any>(
      () => ({
        accept: 'scene',
        canDrop: () => true,
        collect: (monitor) => {
          if (monitor.isOver()) {
            return {
              isOver: true,
            };
          }
          return { isOver: false };
        },
        hover({
          scene: draggedScene,
          curIndex: draggedIndex,
        }: {
          scene: GenericScene;
          curIndex: number;
        }) {},
        drop: (item: any, monitor) => {
          if (!isMobile || true) {
            const { scene: droppedScene, curIndex: droppedIndex } = item;
            const overIndex = curSession.getScenes(scene.type).indexOf(scene);
            moveScene!(droppedScene, overIndex);
          }
        },
      }),
      [moveScene],
    );

    const addToQueue = async (scene: GenericScene) => {
      try {
        const missing = promptService.findMissingPieces(curSession, scene);
        if (missing.length > 0) {
          const list = missing.map((m) => `<${m.library}.${m.piece}>`).join(', ');
          appState.pushDialog({
            type: 'confirm',
            text: `존재하지 않는 프롬프트조각이 발견되었습니다:\n${list}\n\n로컬 프롬프트조각으로 새로 만들까요?\n(빈 조각이 생성되며, 내용은 직접 채워주세요)`,
            callback: async () => {
              createMissingPiecesForSession(curSession, missing);
              try {
                await queueScene(curSession, scene, appState.samples);
              } catch (e: any) {
                appState.pushMessage('프롬프트 에러: ' + e.message);
              }
            },
          });
          return;
        }
        await queueScene(curSession, scene, appState.samples);
      } catch (e: any) {
        appState.pushMessage('프롬프트 에러: ' + e.message);
      }
    };

    const [_, rerender] = useState<{}>({});

    const removeFromQueue = (scene: GenericScene) => {
      taskQueueService.removeTasksFromScene(scene);
    };

    const getSceneQueueCount = (scene: GenericScene) => {
      const stats = taskQueueService.statsTasksFromScene(curSession!, scene);
      return stats.total - stats.done;
    };

    useEffect(() => {
      const onUpdate = () => {
        rerender({});
      };
      const refreshImage = async () => {
        try {
          const base64 = await getImage(scene);
          setImage(base64!);
        } catch (e: any) {
          setImage(undefined);
        }
        rerender({});
      };
      refreshImage();
      gameService.addEventListener('updated', refreshImage);
      taskQueueService.addEventListener('progress', onUpdate);
      imageService.addEventListener('image-cache-invalidated', refreshImage);
      const dispose = reaction(
        () => scene.mains.join(''),
        () => {
          refreshImage();
        },
      );
      const dispose2 = reaction(
        () => scene.type === 'inpaint' && scene.preset.image,
        () => {
          refreshImage();
        },
      );
      return () => {
        gameService.removeEventListener('updated', refreshImage);
        taskQueueService.removeEventListener('progress', onUpdate);
        imageService.removeEventListener(
          'image-cache-invalidated',
          refreshImage,
        );
        dispose();
        dispose2();
      };
    }, [scene]);

    const cardRef = (node: any) => drag(drop(node));
    const onContext = (e: any) => {
      show({ event: e, props: { ctx: { type: 'scene', scene } } });
    };
    const onClickCard = (event: any) => {
      if (isDragging) return;
      setDisplayScene?.(scene);
    };

    // 공통 버튼 렌더
    const renderButtons = (overlay?: boolean) => {
      const btnClass = overlay
        ? 'round-button scene-btn'
        : 'round-button scene-btn';
      const green = overlay ? 'bg-green-500 text-white' : 'back-green';
      const gray = overlay ? 'bg-gray-500 text-white' : 'back-gray';
      const orange = overlay ? 'bg-orange-500 text-white' : 'back-orange';
      return (
        <>
          <Tooltip content="예약 추가">
          <button className={`${btnClass} ${green}`}
            onClick={(e) => { e.stopPropagation(); addToQueue(scene); }}>
            <FaPlus />
          </button>
          </Tooltip>
          <Tooltip content="예약 제거">
          <button className={`${btnClass} ${gray}`}
            onClick={(e) => { e.stopPropagation(); removeFromQueue(scene); }}>
            <FaRegCalendarTimes />
          </button>
          </Tooltip>
          <Tooltip content="씬 편집">
          <button className={`${btnClass} ${orange}`}
            onClick={(e) => { e.stopPropagation(); setEditingScene?.(scene); }}>
            <FaEdit />
          </button>
          </Tooltip>
          <Tooltip content="씬 북마크">
          <button className={`${btnClass} ${isBookmarked ? orange : gray}`}
            onClick={(e) => { e.stopPropagation(); onToggleBookmark?.(); }}>
            <FaBookmark />
          </button>
          </Tooltip>
        </>
      );
    };

    if (isClassic) {
      // ===== 클래식 디자인 =====
      return (
        <div
          id={`scene-cell-${scene.type}-${scene.name}`}
          className={
            'relative z-0 m-2 p-1 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-500 ' +
            (isDragging ? 'opacity-0 no-touch ' : '') +
            (isOver ? ' outline outline-sky-500' : '')
          }
          style={style}
          ref={cardRef}
          onContextMenu={onContext}
        >
          {getSceneQueueCount(scene) > 0 && (
            <span className="absolute right-0 bg-yellow-400 dark:bg-indigo-400 inline-block mr-3 px-2 py-1 text-center align-middle rounded-md font-bold text-white">
              {getSceneQueueCount(scene)}
            </span>
          )}
          <div className="-z-10 clickable bg-white dark:bg-slate-800" onClick={onClickCard}>
            <div className={'p-2 flex text-lg text-default ' + cellSizes3[cellSize]}>
              <div className="truncate flex-1">
                {isBookmarked && <span className="text-orange-500">📌</span>}
                {emoji}
                {scene.name}
              </div>
              <div className="flex-none text-gray-400">
                {gameService.getOutputs(curSession!, scene).length}{' '}
              </div>
            </div>
            <div className={'relative image-cell overflow-hidden ' + cellSizes[cellSize]}>
              {image && (
                <div className="relative w-full h-full">
                  <img src={image} draggable={false}
                    className={'w-full h-full object-contain z-0' +
                      (scene.mains.length > 0 ? ' border-2 border-yellow-400' : '')} />
                  {scene.mains.length > 0 && (
                    <div className="absolute left-1 top-1 z-10 text-yellow-400 text-sm drop-shadow">
                      <FaStar />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="w-full flex mt-auto justify-center items-center gap-1 md:gap-2 p-1 md:p-2">
            {renderButtons(false)}
          </div>
        </div>
      );
    }

    // ===== 신규 디자인 =====
    return (
      <div
        id={`scene-cell-${scene.type}-${scene.name}`}
        className={
          (disableHover ? '' : 'group ') + 'relative z-0 m-1.5 p-1 rounded-lg bg-white dark:bg-slate-800 border-2 ' +
          (scene.mains.length > 0 ? 'border-yellow-400 ' : 'border-gray-200 dark:border-slate-600 ') +
          (isDragging ? 'opacity-0 no-touch ' : '') +
          (isOver ? ' ring-2 ring-sky-500' : '')
        }
        style={style}
        ref={cardRef}
        onContextMenu={onContext}
      >
        {getSceneQueueCount(scene) > 0 && (
          <span className="absolute left-2 top-2 z-20 bg-yellow-400 dark:bg-indigo-400 px-2 py-0.5 rounded-full text-sm font-bold text-white shadow">
            {getSceneQueueCount(scene)}
          </span>
        )}
        {/* PC 전용: 카드 전체 어두운 오버레이 */}
        {!isMobile && (
          <div className="absolute inset-0 rounded-lg bg-black/0 group-hover:bg-black/40 transition-colors duration-200 z-10 pointer-events-none" />
        )}
        <div className="clickable bg-white dark:bg-slate-800" onClick={onClickCard}>
          <div className={'relative image-cell overflow-hidden rounded-md ' + cellSizes[cellSize]}>
            {image && (
              <div className="relative w-full h-full">
                <img src={image} draggable={false}
                  className="w-full h-full object-cover z-0" />
                {scene.mains.length > 0 && (
                  <div className="absolute left-1 top-1 z-10 text-yellow-400 text-sm drop-shadow">
                    <FaStar />
                  </div>
                )}
              </div>
            )}
            {/* 씬 이름 + 이미지 카운트 오버레이 */}
            <div className="absolute bottom-0 left-0 right-0 z-[5] bg-gradient-to-t from-black/70 to-transparent px-2 pt-4 pb-1.5">
              <div className="flex items-center text-sm text-white">
                <div className="truncate flex-1 font-medium drop-shadow">
                  {isBookmarked && <span className="text-orange-500 mr-0.5">📌</span>}
                  {emoji}
                  {scene.name}
                </div>
                <div className="flex-none ml-1 text-white/80 drop-shadow">
                  {gameService.getOutputs(curSession!, scene).length}
                </div>
              </div>
            </div>
          </div>
        </div>
        {/* PC 전용: 호버 시 버튼 */}
        {!isMobile && (
          <div className="absolute bottom-0 left-0 right-0 flex justify-center items-center gap-1.5 z-20 py-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            {renderButtons(true)}
          </div>
        )}
        {/* 모바일 전용: 하단 버튼 */}
        <div className={`w-full flex mt-auto justify-center items-center gap-1 p-1 ${isMobile ? '' : 'md:hidden'}`}>
          {renderButtons(false)}
        </div>
      </div>
    );
  },
);

// ===== SceneTrashView 컴포넌트 =====

interface SceneTrashViewProps {
  projectName: string;
  onClose: () => void;
}

const SceneTrashView = ({ projectName, onClose }: SceneTrashViewProps) => {
  const [deletedScenes, setDeletedScenes] = useState<
    { name: string; type: string; deletedAt: number }[]
  >([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const items = await trashService.getDeletedScenes(projectName);
      setDeletedScenes(items);
    } catch (e) {
      setDeletedScenes([]);
    }
    setLoading(false);
  }, [projectName]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const formatDate = (ts: number) => {
    if (!ts) return '알 수 없음';
    const d = new Date(ts);
    return (
      d.toLocaleDateString() +
      ' ' +
      d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    );
  };

  const handleRestore = async (item: {
    name: string;
    type: string;
    deletedAt: number;
  }) => {
    try {
      await trashService.restoreScene(appState.curSession!, item.name);
      appState.pushMessage(`씬 "${item.name}"이(가) 복원되었습니다.`);
      await refresh();
    } catch (e: any) {
      appState.pushMessage(e.message || '씬 복원에 실패했습니다.');
    }
  };

  const handlePermanentDelete = async (item: {
    name: string;
    type: string;
    deletedAt: number;
  }) => {
    appState.pushDialog({
      type: 'confirm',
      text: `씬 "${item.name}"을(를) 영구 삭제하시겠습니까?`,
      callback: async () => {
        await trashService.permanentlyDeleteScene(
          projectName,
          item.name,
          item.type,
        );
        await refresh();
      },
    });
  };

  if (deletedScenes.length === 0 && !loading) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-none p-3 border-b line-color flex items-center justify-between">
          <span className="font-bold text-lg text-default">🗑️ 씬 휴지통</span>
          <button className="round-button back-gray" onClick={onClose}>
            닫기
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center text-gray-400 text-lg">
          휴지통이 비어있습니다
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-none p-3 border-b line-color flex items-center justify-between">
        <span className="font-bold text-lg text-default">🗑️ 씬 휴지통</span>
        <button className="round-button back-gray" onClick={onClose}>
          닫기
        </button>
      </div>
      <div className="flex-1 overflow-auto p-3">
        <div className="flex flex-col gap-2">
          {deletedScenes.map((item) => (
            <div
              key={item.name}
              className="flex items-center gap-3 p-3 border border-gray-300 dark:border-slate-500 rounded bg-white dark:bg-slate-800"
            >
              <div className="flex-1 min-w-0">
                <div className="font-bold text-default truncate">
                  {item.type === 'inpaint' ? '🎨 ' : '🖼️ '}
                  {item.name}
                </div>
                <div className="text-sm text-gray-400">
                  {item.type === 'inpaint' ? '인페인트' : '일반'} 씬 ·{' '}
                  {formatDate(item.deletedAt)}
                </div>
              </div>
              <button
                className="round-button back-green flex-none"
                onClick={() => handleRestore(item)}
              >
                <FaTrashRestore className="mr-1" />
                복원
              </button>
              <button
                className="round-button back-red flex-none"
                onClick={() => handlePermanentDelete(item)}
              >
                영구삭제
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

interface QueueControlProps {
  type: 'scene' | 'inpaint';
  filterFunc?: (scene: GenericScene) => boolean;
  onClose?: (x: number) => void;
  showPannel?: boolean;
  className?: string;
}

const QueueControl = observer(
  ({ type, className, showPannel, filterFunc, onClose }: QueueControlProps) => {
    const curSession = appState.curSession!;
    const [_, rerender] = useState<{}>({});
    const [editingScene, setEditingScene] = useState<GenericScene | undefined>(
      undefined,
    );
    const [inpaintEditScene, setInpaintEditScene] = useState<
      InpaintScene | undefined
    >(undefined);
    const [displayScene, setDisplayScene] = useState<GenericScene | undefined>(
      undefined,
    );
    const [cellSize, setCellSize] = useState(1);
    useEffect(() => {
      const onProgressUpdated = () => {
        rerender({});
      };
      taskQueueService.addEventListener('progress', onProgressUpdated);
      return () => {
        taskQueueService.removeEventListener('progress', onProgressUpdated);
      };
    }, []);
    useEffect(() => {
      imageService.refreshBatch(curSession!);
    }, [curSession]);

    const addAllToQueue = async () => {
      try {
        const scenes = curSession.getScenes(type);
        const allMissing: { library: string; piece: string }[] = [];
        for (const scene of scenes) {
          const missing = promptService.findMissingPieces(curSession, scene);
          for (const m of missing) {
            if (!allMissing.find((x) => x.library === m.library && x.piece === m.piece)) {
              allMissing.push(m);
            }
          }
        }
        const doQueue = async () => {
          for (const scene of scenes) {
            try {
              await queueScene(curSession, scene, appState.samples);
            } catch (e: any) {
              appState.pushMessage(`프롬프트 에러 (${scene.name}): ` + e.message);
            }
          }
        };
        if (allMissing.length > 0) {
          const list = allMissing.map((m) => `<${m.library}.${m.piece}>`).join(', ');
          appState.pushDialog({
            type: 'confirm',
            text: `존재하지 않는 프롬프트조각이 발견되었습니다:\n${list}\n\n로컬 프롬프트조각으로 새로 만들까요?\n(빈 조각이 생성되며, 내용은 직접 채워주세요)`,
            callback: async () => {
              createMissingPiecesForSession(curSession, allMissing);
              await doQueue();
            },
          });
          return;
        }
        await doQueue();
      } catch (e: any) {
        appState.pushMessage('프롬프트 에러: ' + e.message);
      }
    };

    // 단축키에서 모든 씬 예약 이벤트 수신
    useEffect(() => {
      const handler = (e: Event) => {
        const action = (e as CustomEvent).detail?.action;
        if (action === 'queue-all-scenes') {
          addAllToQueue();
        }
      };
      window.addEventListener('shortcut-action', handler);
      return () => window.removeEventListener('shortcut-action', handler);
    }, [curSession, type]);

    const addScene = () => {
      appState.pushDialog({
        type: 'textarea-confirm',
        text: '신규 씬 이름을 입력해주세요\n(줄바꿈으로 여러 씬을 동시에 추가할 수 있습니다)',
        inputValue: '씬 이름 (한 줄에 하나씩)',
        callback: async (inputValue) => {
          if (!inputValue) return;
          const names = inputValue
            .split('\n')
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
          if (names.length === 0) return;

          const scenes = curSession.getScenes(type);
          const existingNames = new Set(scenes.map((x) => x.name));
          const duplicates = names.filter((n) => existingNames.has(n));
          const seen = new Set<string>();
          const inputDups: string[] = [];
          for (const n of names) {
            if (seen.has(n)) inputDups.push(n);
            else seen.add(n);
          }
          if (duplicates.length > 0) {
            appState.pushMessage(
              '이미 존재하는 씬 이름: ' + duplicates.join(', '),
            );
            return;
          }
          if (inputDups.length > 0) {
            appState.pushMessage(
              '중복 입력된 이름: ' + [...new Set(inputDups)].join(', '),
            );
            return;
          }

          if (type === 'scene') {
            for (const name of names) {
              curSession.addScene(
                Scene.fromJSON({
                  type: 'scene',
                  name: name,
                  resolution: 'portrait',
                  slots: [
                    [
                      {
                        id: v4(),
                        prompt: '',
                        characterPrompts: [],
                        enabled: true,
                      },
                    ],
                  ],
                  mains: [],
                  imageMap: [],
                  meta: {},
                  round: undefined,
                  game: undefined,
                }),
              );
            }
          } else {
            const menu = await appState.pushDialogAsync({
              type: 'select',
              text: '이미지 변형 방법을 선택해주세요',
              items: workFlowService.i2iFlows.map((x) => ({
                text: (x.def.emoji ?? '') + x.def.title,
                value: x.getType(),
              })),
            });
            if (!menu) return;
            for (const name of names) {
              curSession.addScene(
                InpaintScene.fromJSON({
                  type: 'inpaint',
                  name: name,
                  resolution: 'portrait',
                  workflowType: menu,
                  preset: workFlowService.buildPreset(menu).toJSON(),
                  mains: [],
                  imageMap: [],
                  round: undefined,
                  game: undefined,
                }),
              );
            }
          }
        },
      });
    };

    const getImage = async (scene: GenericScene) => {
      if (scene.type === 'scene') {
        const image = await getMainImage(curSession!, scene as Scene, 500);
        if (!image) throw new Error('No image available');
        return image;
      } else {
        const imgPath = scene.preset?.image || (scene.workflowType === 'SDMirror' ? curSession?.mirrorImage : undefined);
        if (!imgPath) throw new Error('No image available');
        return await imageService.fetchVibeImage(
          curSession!,
          imgPath,
        );
      }
    };

    const cellSizes = ['스몰뷰', '미디엄뷰', '라지뷰'];

    const favButton = {
      text: (path: string) => {
        return isMainImage(path) ? '즐겨찾기 해제' : '즐겨찾기 지정';
      },
      className: 'back-orange',
      onClick: async (scene: Scene, path: string, close: () => void) => {
        const filename = path.split('/').pop()!;
        if (isMainImage(path)) {
          scene.mains = scene.mains.filter((x) => x !== filename);
        } else {
          scene.mains.push(filename);
        }
      },
    };

    const createInpaintScene = async (
      scene: GenericScene,
      workflowType: string,
      path: string,
      close: () => void,
    ) => {
      let image = await imageService.fetchImage(path);
      image = dataUriToBase64(image!);
      let cnt = 0;
      const newName = () => scene.name + cnt.toString();
      while (curSession!.inpaints.has(newName())) {
        cnt++;
      }
      const name = newName();
      const job = await extractPromptDataFromBase64(image);
      const preset = job
        ? workFlowService.createPreset(workflowType, job)
        : workFlowService.buildPreset(workflowType);

      if (workflowType === 'SDMirror') {
        // 미러: 세션 레벨 이미지 저장 + 합성 캔버스 생성
        const storedPath = await imageService.storeVibeImage(curSession!, image);
        curSession!.mirrorImage = storedPath;
        const result = await prepareMirrorCanvas(image, curSession!.mirrorMode || 'blank');
        preset.image = await imageService.storeVibeImage(curSession!, result.canvas);
        preset.mask = await imageService.storeVibeImage(curSession!, result.mask);
        const newScene = InpaintScene.fromJSON({
          type: 'inpaint',
          name: name,
          workflowType: workflowType,
          preset,
          resolution: 'custom',
          resolutionWidth: result.width,
          resolutionHeight: result.height,
          mirrorCropX: result.cropX,
          sceneRef: scene.type === 'scene' ? scene.name : undefined,
          imageMap: [],
          mains: [],
          round: undefined,
          game: undefined,
        });
        if (newScene) {
          curSession!.addScene(newScene);
          close();
          setInpaintEditScene(newScene);
        }
      } else {
        preset.image = await imageService.storeVibeImage(curSession!, image);
        const newScene = InpaintScene.fromJSON({
          type: 'inpaint',
          name: name,
          workflowType: workflowType,
          preset,
          resolution: scene.resolution,
          sceneRef: scene.type === 'scene' ? scene.name : undefined,
          imageMap: [],
          mains: [],
          round: undefined,
          game: undefined,
        });
        if (newScene) {
          curSession!.addScene(newScene);
          close();
          setInpaintEditScene(newScene);
        }
      }
    };

    const buttons: any =
      type === 'scene'
        ? [
            favButton,
            {
              text: '인페인팅 씬 생성',
              className: 'back-green',
              onClick: async (
                scene: Scene,
                path: string,
                close: () => void,
              ) => {
                await createInpaintScene(scene, 'SDInpaint', path, close);
              },
            },
          ]
        : [
            favButton,
            {
              text: '해당 이미지로 인페인트',
              className: 'back-orange',
              onClick: async (
                scene: InpaintScene,
                path: string,
                close: () => void,
              ) => {
                let image = await imageService.fetchImage(path);
                image = dataUriToBase64(image!);
                await imageService.writeVibeImage(
                  curSession!,
                  scene.preset.image,
                  image,
                );
                close();
                setInpaintEditScene(scene as InpaintScene);
              },
            },
            {
              text: '원본 씬으로 이미지 복사',
              className: 'back-green',
              onClick: async (
                scene: InpaintScene,
                path: string,
                close: () => void,
              ) => {
                if (!scene.sceneRef) {
                  appState.pushMessage('원본 씬이 없습니다.');
                  return;
                }
                const orgScene = curSession!.scenes.get(scene.sceneRef);
                if (!orgScene) {
                  appState.pushMessage('원본 씬이 삭제되었거나 이동했습니다.');
                  return;
                }
                await backend.copyFile(
                  path,
                  imageService.getImageDir(curSession!, orgScene) +
                    '/' +
                    Date.now().toString() +
                    '.png',
                );
                imageService.refresh(curSession!, orgScene);
                setDisplayScene(undefined);
                if (onClose) onClose(0);
                close();
              },
            },
          ];
    buttons.push({
      text: '이미지 변형',
      className: 'back-gray',
      // @ts-ignore
      onClick: async (scene: Scene, path: string, close: () => void) => {
        const menu = await appState.pushDialogAsync({
          type: 'select',
          text: '이미지 변형 방법을 선택해주세요',
          items: [
            {
              text: '이미지 변형 씬 생성',
              value: 'create',
            },
          ].concat(
            oneTimeFlows.map((x) => ({
              text: x.text,
              value: x.text,
            })),
          ),
        });
        if (!menu) return;
        if (menu === 'create') {
          const flows = workFlowService.i2iFlows;
          const items = flows.map((x) => ({
            text: (x.def.emoji ?? '') + x.def.title,
            value: x.getType(),
          }));
          const method = await appState.pushDialogAsync({
            type: 'select',
            text: '변형 씬에서 사용할 방법을 선택해주세요',
            items: items,
          });
          if (!method) return;
          await createInpaintScene(scene, method, path, close);
        } else {
          let image = await imageService.fetchImage(path);
          image = dataUriToBase64(image!);
          const job = await extractPromptDataFromBase64(image);
          const menuItem = oneTimeFlowMap.get(menu)!;
          const input = menuItem.getInput
            ? await menuItem.getInput(curSession!)
            : undefined;
          menuItem.handler(curSession!, scene, image, undefined, job, input);
        }
      },
    });

    const [adding, setAdding] = useState<boolean>(false);
    const panel = useMemo(() => {
      if (type === 'scene') {
        return (
          <>
            {inpaintEditScene && (
              <FloatView
                priority={3}
                onEscape={() => setInpaintEditScene(undefined)}
              >
                <InPaintEditor
                  editingScene={inpaintEditScene}
                  onConfirm={() => {
                    if (resultViewerRef.current)
                      resultViewerRef.current.setInpaintTab();
                    setInpaintEditScene(undefined);
                  }}
                  onDelete={() => {}}
                />
              </FloatView>
            )}
            {editingScene && (
              <FloatView
                priority={2}
                onEscape={() => setEditingScene(undefined)}
              >
                <SceneEditor
                  scene={editingScene as Scene}
                  onClosed={() => {
                    setEditingScene(undefined);
                  }}
                  onDeleted={() => {
                    if (showPannel) {
                      setDisplayScene(undefined);
                    }
                  }}
                />
              </FloatView>
            )}
          </>
        );
      } else {
        return (
          <>
            {inpaintEditScene && (
              <FloatView
                priority={3}
                onEscape={() => setInpaintEditScene(undefined)}
              >
                <InPaintEditor
                  editingScene={inpaintEditScene}
                  onConfirm={() => {
                    setInpaintEditScene(undefined);
                  }}
                  onDelete={() => {}}
                />
              </FloatView>
            )}
            {(editingScene || adding) && (
              <FloatView
                priority={2}
                onEscape={() => {
                  setEditingScene(undefined);
                  setAdding(false);
                }}
              >
                <InPaintEditor
                  editingScene={editingScene as InpaintScene}
                  onConfirm={() => {
                    setEditingScene(undefined);
                    setAdding(false);
                  }}
                  onDelete={() => {
                    setDisplayScene(undefined);
                  }}
                />
              </FloatView>
            )}
          </>
        );
      }
    }, [editingScene, inpaintEditScene, adding]);

    const onEdit = async (scene: GenericScene) => {
      setEditingScene(scene);
    };

    const isMainImage = (path: string) => {
      const filename = path.split('/').pop()!;
      return !!(displayScene && displayScene.mains.includes(filename));
    };

    const onFilenameChange = (src: string, dst: string) => {
      if (type === 'scene') {
        const scene = displayScene as Scene;
        src = src.split('/').pop()!;
        dst = dst.split('/').pop()!;
        if (scene.mains.includes(src) && !scene.mains.includes(dst)) {
          scene.mains = scene.mains.map((x) => (x === src ? dst : x));
        } else if (!scene.mains.includes(src) && scene.mains.includes(dst)) {
          scene.mains = scene.mains.map((x) => (x === dst ? src : x));
        }
      }
    };

    const resultViewerRef = useRef<any>(null);
    const resultViewer = useMemo(() => {
      if (displayScene)
        return (
          <FloatView
            priority={2}
            showToolbar={false}
            onEscape={() => {
              gameService.refreshList(curSession!, displayScene);
              setDisplayScene(undefined);
            }}
          >
            <ResultViewer
              ref={resultViewerRef}
              scene={displayScene}
              isMainImage={isMainImage}
              onFilenameChange={onFilenameChange}
              onEdit={onEdit}
              buttons={buttons}
              onSampleExtract={type === 'scene' ? (seeds: number[]) => {
                const sourceScene = displayScene;
                gameService.refreshList(curSession!, sourceScene);
                setDisplayScene(undefined);
                const allScenes = curSession!.getScenes('scene');
                const targetScenes = allScenes.filter((s) => s.name !== sourceScene.name);
                if (targetScenes.length === 0) {
                  appState.pushMessage('대상 씬이 없습니다.');
                  return;
                }
                setSceneSelector({
                  type: 'scene',
                  text: `🎲 샘플 뽑기 (${seeds.length}개 시드)`,
                  scenes: targetScenes,
                  callback: (selected) => {
                    setSceneSelector(undefined);
                    if (selected.length === 0) return;
                    appState.pushDialog({
                      type: 'confirm',
                      text: `${selected.length}개 씬에 ${seeds.length}개 시드로 각각 이미지를 생성하시겠습니까?\n(총 ${selected.length * seeds.length}장)`,
                      callback: async () => {
                        const workflow = curSession!.selectedWorkflow;
                        if (!workflow) {
                          appState.pushMessage('워크플로우가 선택되지 않았습니다.');
                          return;
                        }
                        const [wfType, , shared] = curSession!.getCommonSetup(workflow);
                        const originalSeed = shared?.seed;
                        try {
                          for (const targetScene of selected) {
                            for (const seed of seeds) {
                              if (shared) shared.seed = seed;
                              await queueWorkflow(curSession!, workflow, targetScene, 1);
                            }
                          }
                          appState.pushMessage(`${selected.length * seeds.length}개 이미지 생성이 예약되었습니다.`);
                        } catch (e: any) {
                          appState.pushMessage('샘플 뽑기 오류: ' + e.message);
                        } finally {
                          if (shared) shared.seed = originalSeed;
                        }
                      },
                    });
                  },
                });
              } : undefined}
            />
          </FloatView>
        );
      return <></>;
    }, [displayScene]);

    const [sceneSelector, setSceneSelector] = useState<
      SceneSelectorItem | undefined
    >(undefined);

    const [sceneSearchQuery, setSceneSearchQuery] = useState('');
    const [showSceneSearch, setShowSceneSearch] = useState(false);
    const sceneSearchRef = useRef<HTMLInputElement>(null);
    const [showSceneTrash, setShowSceneTrash] = useState(false);

    const [bmRev, setBmRev] = useState(0);
    useEffect(() => {
      const onBookmarkUpdated = () => setBmRev(r => r + 1);
      sessionService.addEventListener('bookmark-updated', onBookmarkUpdated);
      return () => sessionService.removeEventListener('bookmark-updated', onBookmarkUpdated);
    }, []);
    const sceneBookmark = sessionService.getSceneBookmark(curSession.name);

    const toggleSceneSearch = useCallback(() => {
      setShowSceneSearch((prev) => {
        if (prev) {
          setSceneSearchQuery('');
        } else {
          setTimeout(() => sceneSearchRef.current?.focus(), 50);
        }
        return !prev;
      });
    }, []);

    const moveScene = (draggingScene: GenericScene, targetIndex: number) => {
      curSession!.moveScene(draggingScene, targetIndex);
    };

    return (
      <div className={'flex flex-col h-full ' + (className ?? '')}>
        {sceneSelector && (
          <FloatView priority={0} onEscape={() => setSceneSelector(undefined)}>
            <SceneSelector
              text={sceneSelector.text}
              scenes={sceneSelector.scenes ?? curSession!.getScenes(type)}
              onConfirm={sceneSelector.callback}
              getImage={getImage}
            />
          </FloatView>
        )}
        {resultViewer}
        {showSceneTrash && (
          <FloatView priority={1} onEscape={() => setShowSceneTrash(false)}>
            <SceneTrashView
              projectName={curSession.name}
              onClose={() => setShowSceneTrash(false)}
            />
          </FloatView>
        )}
        {panel}
        {!!showPannel && (
          <div className="flex flex-none pb-1.5 flex-wrap">
            <div className="flex gap-1 md:gap-1.5 flex-wrap items-center">
              <button className={`round-button back-sky`} onClick={addScene}>
                씬 추가
              </button>
              <button
                className={`round-button back-sky`}
                onClick={addAllToQueue}
              >
                모두 예약추가
              </button>
              <button
                className={`round-button back-gray`}
                onClick={() => appState.exportPackage(type)}
              >
                {isMobile ? '' : '이미지 '}내보내기
              </button>
              <button
                className={`round-button back-gray`}
                onClick={() => {
                  appState.openBatchProcessMenu(type, setSceneSelector);
                }}
              >
                대량 작업
              </button>
              <Tooltip content="이미지 프롬프트 추출">
              <button
                className={`round-button back-gray`}
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = 'image/png';
                  input.onchange = (e: any) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      appState.handleFile(file);
                    }
                  };
                  input.click();
                }}
              >
                <FaFileImage size={18} />
              </button>
              </Tooltip>
              <Tooltip content="씬 검색">
              <button
                className={`round-button ${showSceneSearch ? 'back-sky' : 'back-gray'}`}
                onClick={toggleSceneSearch}
              >
                <FaSearch size={18} />
              </button>
              </Tooltip>
              <Tooltip content="북마크된 씬으로 이동">
              <button
                className={`round-button ${sceneBookmark ? 'back-orange' : 'back-gray'}`}
                onClick={() => {
                  if (!sceneBookmark) {
                    appState.pushMessage('북마크된 씬이 없습니다.');
                    return;
                  }
                  if (sceneBookmark.type !== type) {
                    appState.pushMessage('북마크된 씬은 ' + (sceneBookmark.type === 'scene' ? '일반' : '인페인트') + ' 탭에 있습니다.');
                    return;
                  }
                  const el = document.getElementById(`scene-cell-${type}-${sceneBookmark.name}`);
                  if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  } else {
                    appState.pushMessage('북마크된 씬을 찾을 수 없습니다.');
                  }
                }}
              >
                <FaBookmark size={18} />
              </button>
              </Tooltip>
              <Tooltip content="씬 휴지통">
              <button
                className={`round-button back-gray`}
                onClick={() => setShowSceneTrash(true)}
              >
                <FaTrash size={18} />
              </button>
              </Tooltip>
            </div>
            <div className="ml-auto mr-2 hidden md:flex items-center gap-2">
              {!appState.classicSceneCard && (
                <select
                  className="gray-input text-sm py-1 px-2"
                  value={curSession.sceneCardStyle?.[type] ?? 'portrait'}
                  onChange={(e) => {
                    curSession.sceneCardStyle = {
                      ...curSession.sceneCardStyle,
                      [type]: e.target.value,
                    };
                    sessionService.dirty[curSession.name] = true;
                  }}
                >
                  <option value="portrait">세로 3:4</option>
                  <option value="square">정사각형</option>
                  <option value="landscape">가로 4:3</option>
                  <option value="fixedHeight">높이 고정</option>
                </select>
              )}
              <button
                onClick={() => setCellSize((cellSize + 1) % 3)}
                className={`round-button back-gray`}
              >
                {cellSizes[cellSize]}
              </button>
            </div>
          </div>
        )}
        {showSceneSearch && (
          <div className="flex flex-none items-center gap-2 pb-2 px-1">
            <FaSearch className="text-gray-400 flex-none" />
            <input
              ref={sceneSearchRef}
              type="text"
              className="flex-1 px-2 py-1 border border-gray-300 dark:border-slate-500 rounded bg-white dark:bg-slate-700 text-default outline-none focus:border-sky-500"
              placeholder="씬 이름 검색..."
              value={sceneSearchQuery}
              onChange={(e) => setSceneSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setSceneSearchQuery('');
                  setShowSceneSearch(false);
                }
              }}
            />
            <button
              className="round-button back-gray"
              onClick={() => {
                setSceneSearchQuery('');
                setShowSceneSearch(false);
              }}
            >
              <FaTimes />
            </button>
          </div>
        )}
        <div className="flex flex-1 overflow-hidden">
          {(() => {
            const effectiveCellSize = showPannel || isMobile ? cellSize : 2;
            const minWidths = ['180px', '240px', '320px'];
            const useGrid = !isMobile;
            return (
              <div
                className={useGrid ? 'overflow-auto w-full content-start' : 'flex flex-wrap overflow-auto justify-start items-start content-start'}
                style={useGrid ? {
                  display: 'grid',
                  gridTemplateColumns: `repeat(auto-fill, minmax(${minWidths[effectiveCellSize]}, 1fr))`,
                  alignItems: 'start',
                  alignContent: 'start',
                } : undefined}
              >
                {curSession
                  .getScenes(type)
                  .filter((x) => {
                    if (!filterFunc) return true;
                    return filterFunc(x);
                  })
                  .filter((x) => {
                    if (!sceneSearchQuery) return true;
                    return x.name.toLowerCase().includes(sceneSearchQuery.toLowerCase());
                  })
                  .map((scene) => (
                    <SceneCell
                      cellSize={effectiveCellSize}
                      key={scene.name}
                      scene={scene}
                      getImage={getImage}
                      setDisplayScene={setDisplayScene}
                      setEditingScene={setEditingScene}
                      moveScene={moveScene}
                      curSession={curSession}
                      isBookmarked={sessionService.isSceneBookmarked(curSession.name, scene.name)}
                      onToggleBookmark={() => sessionService.toggleSceneBookmark(curSession.name, scene.name, scene.type)}
                      disableHover={!!(editingScene || displayScene)}
                    />
                  ))}
              </div>
            );
          })()}
        </div>
      </div>
    );
  },
);

export default QueueControl;
