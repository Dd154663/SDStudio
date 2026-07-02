import React, {
  useState,
  useEffect,
  useCallback,
  useContext,
  useRef,
  useMemo,
  memo,
  useImperativeHandle,
  forwardRef,
} from 'react';
import { BiBrush, BiImage } from 'react-icons/bi';
import {
  FixedSizeGrid as Grid,
  GridChildComponentProps,
  areEqual,
} from 'react-window';
import ResizeObserver from 'resize-observer-polyfill';
import { userInfo } from 'os';
import { CustomScrollbars } from './UtilComponents';
import Tournament from './Tournament';
import ShortcutCheatsheet from './ShortcutCheatsheet';
import {
  FaArrowLeft,
  FaArrowRight,
  FaBookmark,
  FaCalendarTimes,
  FaCheck,
  FaDice,
  FaDownload,
  FaEdit,
  FaFolder,
  FaPaintBrush,
  FaRegObjectGroup,
  FaStar,
  FaTrash,
  FaTrashRestore,
  FaClone,
  FaShareSquare,
} from 'react-icons/fa';
import { PromptHighlighter } from './SceneEditor';
import QueueControl from './SceneQueueControl';
import { FloatView } from './FloatView';
import memoizeOne from 'memoize-one';
import { FaPlus, FaRegSquareCheck, FaCopy, FaPaste } from 'react-icons/fa6';
import { useContextMenu } from 'react-contexify';
import { useDrag, useDrop } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';
import { reaction, set } from 'mobx';
import Tooltip from './Tooltip';
import {
  CharacterPrompt,
  ContextMenuType,
  GenericScene,
  Scene,
  SelectedWorkflow,
} from '../models/types';
import {
  imageService,
  sessionService,
  isMobile,
  gameService,
  backend,
  taskQueueService,
  workFlowService,
  imageDownloadService,
  trashService,
} from '../models';
import { queueI2IWorkflow, queueWorkflow } from '../models/TaskQueueService';
import { dataUriToBase64, deleteImageFiles } from '../models/ImageService';
import { getResultDirectory } from '../models/SessionService';
import { extractPromptDataFromBase64 } from '../models/util';
import { appState } from '../models/AppService';
import { observer } from 'mobx-react-lite';
import { DownloadDialog } from './DownloadDialog';
import { Session, GenericScene as GenericSceneType } from '../models/types';

// ===== TrashImageView 컴포넌트 =====

interface TrashImageViewProps {
  session: Session;
  scene: GenericSceneType;
  imageSize: number;
}

const TrashImageView = ({ session, scene, imageSize }: TrashImageViewProps) => {
  const [trashImages, setTrashImages] = useState<
    { filename: string; deletedAt: number }[]
  >([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const items = await trashService.getTrashImages(session, scene);
      setTrashImages(items);
      // 기존 선택 중 유효하지 않은 것 제거
      setSelected((prev) => {
        const validNames = new Set(items.map((i) => i.filename));
        const next = new Set<string>();
        prev.forEach((f) => {
          if (validNames.has(f)) next.add(f);
        });
        return next;
      });
    } catch (e) {
      setTrashImages([]);
    }
    setLoading(false);
  }, [session, scene]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 썸네일 로드
  useEffect(() => {
    const loadThumbnails = async () => {
      const newThumbs: Record<string, string> = {};
      for (const item of trashImages) {
        const path = trashService.getTrashImagePath(
          session,
          scene,
          item.filename,
        );
        try {
          const thumb = await imageService.fetchImageSmall(
            path,
            isMobile ? 200 : Math.min(imageSize, 400),
          );
          if (thumb) newThumbs[item.filename] = thumb;
        } catch (e) {}
      }
      setThumbnails(newThumbs);
    };
    if (trashImages.length > 0) loadThumbnails();
    else setThumbnails({});
  }, [trashImages, session, scene, imageSize]);

  const toggleSelect = (filename: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  };

  const selectAll = () => {
    setSelected(new Set(trashImages.map((i) => i.filename)));
  };

  const handleRestore = async () => {
    if (selected.size === 0) return;
    await trashService.restoreImages(session, scene, Array.from(selected));
    await imageService.refresh(session, scene);
    appState.pushMessage(selected.size + '장의 이미지가 복원되었습니다.');
    setSelected(new Set());
    await refresh();
  };

  const handlePermanentDelete = async () => {
    if (selected.size === 0) return;
    appState.pushDialog({
      type: 'confirm',
      text: selected.size + '장의 이미지를 영구 삭제하시겠습니까?',
      callback: async () => {
        await trashService.permanentlyDeleteImages(
          session,
          scene,
          Array.from(selected),
        );
        setSelected(new Set());
        await refresh();
      },
    });
  };

  const handleEmptyTrash = async () => {
    if (trashImages.length === 0) return;
    appState.pushDialog({
      type: 'confirm',
      text: '휴지통을 비우시겠습니까? 모든 이미지가 영구 삭제됩니다.',
      callback: async () => {
        await trashService.emptyImageTrash(session, scene);
        setSelected(new Set());
        await refresh();
      },
    });
  };

  const formatDate = (ts: number) => {
    if (!ts) return '알 수 없음';
    const d = new Date(ts);
    return (
      d.toLocaleDateString() +
      ' ' +
      d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    );
  };

  const cellSize = isMobile ? imageSize / 2.5 : Math.min(imageSize, 400);

  if (trashImages.length === 0 && !loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-lg">
        휴지통이 비어있습니다
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-none p-2 flex gap-2 flex-wrap border-b line-color">
        <button
          className={`round-button back-green`}
          onClick={handleRestore}
          disabled={selected.size === 0}
        >
          <FaTrashRestore className="mr-1" />
          선택 복원 ({selected.size})
        </button>
        <button className={`round-button back-gray`} onClick={selectAll}>
          전체 선택
        </button>
        <button
          className={`round-button back-red`}
          onClick={handlePermanentDelete}
          disabled={selected.size === 0}
        >
          선택 영구삭제
        </button>
        <button
          className={`round-button back-red ml-auto`}
          onClick={handleEmptyTrash}
        >
          <FaTrash className="mr-1" />
          휴지통 비우기
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        <div className="flex flex-wrap gap-1 p-2">
          {trashImages.map((item) => {
            const isSelected = selected.has(item.filename);
            return (
              <div
                key={item.filename}
                className={
                  'relative cursor-pointer hover:brightness-95 active:brightness-90 ' +
                  (isSelected ? 'ring-2 ring-sky-500' : '')
                }
                style={{ width: cellSize, height: cellSize }}
                onClick={() => toggleSelect(item.filename)}
              >
                {thumbnails[item.filename] ? (
                  <img
                    src={thumbnails[item.filename]}
                    className="w-full h-full object-contain bg-checkboard"
                    draggable={false}
                  />
                ) : (
                  <div className="w-full h-full bg-[var(--c-surface)] flex items-center justify-center text-gray-400">
                    ...
                  </div>
                )}
                {isSelected && (
                  <div className="absolute left-0 top-0 z-10 bg-sky-500 opacity-40 w-full h-full" />
                )}
                <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-60 text-white text-xs px-1 py-0.5 truncate">
                  {formatDate(item.deletedAt)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

interface ImageGalleryProps {
  scene: GenericScene;
  filePaths: string[];
  imageSize: number;
  onSelected?: (index: number) => void;
  isMainImage?: (path: string) => boolean;
  onFilenameChange?: (src: string, dst: string) => void;
  pageSize?: number;
  isHidden?: boolean;
  selectMode?: boolean;
  selectedImages: Set<string>;
  bookmarkedImagePath?: string;
  focusedIndex?: number | null;
  onSelectedImagesChange?: (paths: string[], deselect: boolean) => void;
  onClearSelection?: () => void;
}

interface ImageGalleryRef {
  refresh: () => void;
  refeshImage(path: string): void;
  scrollToIndex(index: number): void;
  getColumnCount(): number;
  getItemCount(): number;
}

export const CellPreview = ({
  path,
  cellSize,
  imageSize,
  style,
}: {
  path: string;
  cellSize: number;
  imageSize: number;
  style: React.CSSProperties;
}) => {
  const [image, setImage] = useState<string | undefined>(undefined);
  useEffect(() => {
    const fetchImage = async () => {
      try {
        const base64Image = await imageService.fetchImageSmall(
          path,
          imageSize,
        )!;
        setImage(base64Image!);
      } catch (e: any) {
        setImage(undefined);
      }
    };
    fetchImage();
  }, [path, imageSize]);

  return (
    <div className="relative" style={style}>
      {image && (
        <img
          draggable={false}
          src={image}
          style={{
            maxWidth: cellSize,
            maxHeight: cellSize,
          }}
          className="image-anime relative bg-checkboard w-auto h-auto"
        />
      )}
    </div>
  );
};

const Cell = memo(
  ({ columnIndex, rowIndex, style, data }: GridChildComponentProps) => {
    const {
      scene,
      filePaths,
      onSelected,
      columnCount,
      refreshImageFuncs,
      isMainImage,
      onFilenameChange,
      imageSize,
      selectedImages,
      bookmarkedImagePath,
      focusedIndex,
      onCellEnter,
      onCellLeave,
    } = data as any;

    const { curSession } = appState;
    const index = rowIndex * columnCount + columnIndex;
    const path = filePaths[index];
    const isFocused = focusedIndex === index;

    const [image, setImage] = useState<string | undefined>(undefined);
    const [_, forceUpdate] = useState<{}>({});
    useEffect(() => {
      if (!path) {
        setImage(undefined);
        return;
      }
      const refreshImage = async () => {
        try {
          const base64Image = await imageService.fetchImageSmall(
            path,
            imageSize,
          )!;
          setImage(base64Image!);
        } catch (e: any) {
          setImage(undefined);
        }
        forceUpdate({});
      };
      const dispose = reaction(
        () => scene.mains.join(''),
        () => {
          forceUpdate({});
        },
      );
      const refreshMainImage = () => {
        forceUpdate({});
      };
      refreshImageFuncs.current.set(path, refreshImage);

      sessionService.addEventListener('main-image-updated', refreshMainImage);
      refreshImage();
      return () => {
        refreshImageFuncs.current.delete(path);
        sessionService.removeEventListener(
          'main-image-updated',
          refreshMainImage,
        );
        dispose();
      };
    }, [data, imageSize]);

    const isMain = !!(isMainImage && path && isMainImage(path));
    const isBookmarked = !!(path && bookmarkedImagePath === path);
    let cellSize = isMobile ? imageSize / 2.5 : imageSize;
    if (isMobile && imageSize === 500) {
      cellSize = style.width;
    }

    const { show, hideAll } = useContextMenu({
      id: ContextMenuType.GallaryImage,
    });

    const [{ isDragging }, drag, preview] = useDrag(
      () => ({
        type: 'image',
        item: { scene, path, cellSize, imageSize, index },
        canDrag: () => index < filePaths.length,
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
      }),
      [path, imageSize, index],
    );

    const [{ isOver }, drop] = useDrop(
      () => ({
        accept: 'image',
        canDrop: () => index < filePaths.length,
        collect: (monitor) => {
          if (monitor.isOver()) {
            return {
              isOver: true,
            };
          }
          return { isOver: false };
        },
        drop: async (item: any, monitor) => {
          const mscene = scene as GenericScene;
          let { path: draggedPath, index: draggedIndex } = item;
          draggedPath = draggedPath.split('/').pop()!;
          const dropPath = path.split('/').pop()!;

          if (draggedPath !== dropPath) {
            const getPlayer = (path: string) => {
              if (mscene.game) {
                for (const player of mscene.game) {
                  if (player.path === path) {
                    return player;
                  }
                }
              }
              return undefined;
            };
            const draggedPlayer = getPlayer(draggedPath);
            const dropPlayer = getPlayer(dropPath);
            if (draggedPlayer) {
              mscene.game!.splice(mscene.game!.indexOf(draggedPlayer), 1);
            }
            if (dropPlayer) {
              mscene.game!.push({
                path: draggedPath,
                rank: dropPlayer.rank,
              });
            }
            if (draggedPlayer || dropPlayer) {
              gameService.cleanGame(mscene.game!);
              mscene.round = undefined;
            }
            const draggedImageIndex = mscene.imageMap.indexOf(draggedPath);
            mscene.imageMap.splice(draggedImageIndex, 1);
            const dropImageIndex = mscene.imageMap.indexOf(dropPath);
            if (draggedIndex < index) {
              mscene.imageMap.splice(dropImageIndex, 0, draggedPath);
            } else {
              mscene.imageMap.splice(dropImageIndex + 1, 0, draggedPath);
            }
            await imageService.refresh(curSession!, mscene);
          }
        },
      }),
      [path, imageSize, index],
    );

    useEffect(() => {
      preview(getEmptyImage(), { captureDraggingState: true });
    }, [preview]);

    return (
      <div
        key={index.toString() + path + imageSize.toString()}
        id={`image-cell-${index}`}
        style={style}
        className={
          'image-cell relative hover:brightness-95 active:brightness-90 bg-[var(--c-surface)] cursor-pointer ' +
          (isDragging ? 'opacity-0 no-touch' : '') +
          (isOver ? ' border-2 border-sky-500' : '')
        }
        draggable
        onClick={() => {
          if (path) {
            if (onSelected) {
              onSelected(index);
            }
          }
        }}
        onMouseEnter={() => onCellEnter?.(index)}
        onMouseLeave={() => onCellLeave?.(index)}
        ref={(node) => drag(drop(node))}
      >
        {path && image && (
          <>
            <div className="relative ">
              <img
                src={image}
                style={{
                  maxWidth: cellSize,
                  maxHeight: cellSize,
                }}
                draggable={false}
                onContextMenu={(e) => {
                  show({
                    event: e,
                    props: {
                      ctx: {
                        type: 'gallary_image',
                        path: [path],
                        scene: scene,
                        starable: true,
                      },
                    },
                  });
                }}
                className={
                  'image-anime relative bg-checkboard w-auto h-auto ' +
                  (isMain ? 'border-2 border-yellow-400' : '')
                }
              />
              {isMain && (
                <div className="absolute left-0 top-0 z-10 text-yellow-400 m-2 text-md ">
                  <FaStar />
                </div>
              )}
              {isBookmarked && (
                <div className="absolute right-0 top-0 z-10 text-orange-500 m-2 text-md">
                  <FaBookmark />
                </div>
              )}
              {selectedImages.has(path) && (
                <div
                  className="absolute left-0 top-0 z-10 bg-sky-500 opacity-50 text-md w-full h-full"
                  onContextMenu={(e) => {
                    const cands = [];
                    const set = new Set<string>();
                    for (const image of filePaths) {
                      set.add(image);
                    }
                    for (const image of selectedImages) {
                      if (set.has(image)) {
                        cands.push(image);
                      }
                    }
                    show({
                      event: e,
                      props: {
                        ctx: {
                          type: 'gallary_image',
                          path: cands,
                          scene: scene,
                          starable: true,
                        },
                      },
                    });
                  }}
                ></div>
              )}
            </div>
          </>
        )}
        {isFocused && (
          <div className="absolute inset-0 border-4 border-sky-400 z-20 pointer-events-none rounded-sm" />
        )}
      </div>
    );
  },
  areEqual,
);

const CustomScrollbarsVirtualGrid = memo(
  forwardRef((props, ref) => (
    <CustomScrollbars {...props} forwardedRef={ref} />
  )),
);

const createItemData = memoizeOne(
  (
    scene,
    filePaths,
    onSelected,
    columnCount,
    refreshImageFuncs,
    draggedIndex,
    isMainImage,
    onFilenameChange,
    imageSize,
    selectedImages,
    bookmarkedImagePath,
    focusedIndex,
    onCellEnter,
    onCellLeave,
  ) => {
    return {
      scene,
      filePaths,
      onSelected,
      columnCount,
      refreshImageFuncs,
      draggedIndex,
      isMainImage,
      onFilenameChange,
      imageSize,
      selectedImages,
      bookmarkedImagePath,
      focusedIndex,
      onCellEnter,
      onCellLeave,
    };
  },
);

const ImageGallery = forwardRef<ImageGalleryRef, ImageGalleryProps>(
  (
    {
      scene,
      isHidden,
      imageSize,
      filePaths,
      isMainImage,
      onSelected,
      selectMode,
      selectedImages,
      onFilenameChange,
      bookmarkedImagePath,
      focusedIndex,
      onSelectedImagesChange,
      onClearSelection,
    },
    ref,
  ) => {
    const { curSession } = appState;
    const [containerWidth, setContainerWidth] = useState(0);
    const [containerHeight, setContainerHeight] = useState(0);
    const refreshImageFuncs = useRef(new Map<string, () => void>());
    const draggedIndex = useRef<number | null>(null);
    const hoveredIndexRef = useRef<number | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const gridRef = useRef<any>(null);

    type DragBox = {
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      deselect: boolean;
    };
    const [dragBox, setDragBox] = useState<DragBox | null>(null);
    // 드래그 중 window 리스너가 최신 좌표를 읽을 수 있도록 ref 로도 동기화한다.
    const dragBoxRef = useRef<DragBox | null>(null);
    const [isSelecting, setIsSelecting] = useState(false);
    const isDraggingRef = useRef(false);
    const wasDraggingRef = useRef(false);

    useImperativeHandle(ref, () => ({
      refresh: () => {
        refreshImageFuncs.current.forEach((refresh) => refresh());
      },
      refeshImage: (path: string) => {
        const refresh = refreshImageFuncs.current.get(path);
        if (refresh) {
          refresh();
        }
      },
      scrollToIndex: (index: number) => {
        if (gridRef.current && columnCount > 0) {
          const rowIndex = Math.floor(index / columnCount);
          gridRef.current.scrollToItem({ rowIndex, align: 'center' });
        }
      },
      getColumnCount: () => columnCount,
      getItemCount: () => filePaths.length,
    }));

    useEffect(() => {
      const resizeObserver = new ResizeObserver((entries) => {
        for (let entry of entries) {
          setContainerWidth(entry.contentRect.width);
          setContainerHeight(entry.contentRect.height);
        }
      });
      if (containerRef.current) {
        resizeObserver.observe(containerRef.current);
      }
      return () => resizeObserver.disconnect();
    }, []);

    let columnWidth = isMobile ? imageSize / 2.5 : imageSize;
    let rowHeight = isMobile ? imageSize / 2.5 : imageSize;
    if (isMobile && imageSize === 500) {
      columnWidth = containerWidth - 10;
      rowHeight = containerWidth - 10;
    }
    const columnCount = Math.max(1, Math.floor(containerWidth / columnWidth));
    // preload 4 pages
    const overcountCounts = isMobile ? [4, 2, 1] : [32, 16, 8];

    const onCellEnter = useCallback((index: number) => {
      hoveredIndexRef.current = index;
    }, []);
    const onCellLeave = useCallback((index: number) => {
      if (hoveredIndexRef.current === index) {
        hoveredIndexRef.current = null;
      }
    }, []);

    useEffect(() => {
      const handleKey = (e: KeyboardEvent) => {
        if (e.key !== 'f' && e.key !== 'F') return;
        if (isHidden) return;
        const idx = hoveredIndexRef.current;
        if (idx == null || idx >= filePaths.length) return;
        const tag = (e.target as HTMLElement)?.tagName;
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          (e.target as HTMLElement)?.isContentEditable
        )
          return;
        e.preventDefault();
        const path = filePaths[idx];
        if (!path) return;
        const filename = path.split('/').pop()!;
        if (scene.mains.includes(filename)) {
          scene.mains.splice(scene.mains.indexOf(filename), 1);
        } else {
          scene.mains.push(filename);
        }
      };
      window.addEventListener('keydown', handleKey);
      return () => window.removeEventListener('keydown', handleKey);
    }, [filePaths, scene, isHidden]);

    // clientX/Y 를 컨테이너 기준 좌표로 변환 + 컨테이너 범위로 클램프.
    // (그리드 밖으로 끌어도 드래그가 유지되며, 박스는 가장자리에 머문다)
    const toContainerXY = (clientX: number, clientY: number) => {
      const el = containerRef.current!;
      const r = el.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(clientX - r.left, r.width)),
        y: Math.max(0, Math.min(clientY - r.top, r.height)),
      };
    };

    const handleGridMouseDown = (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest('.image-cell')) return;
      // 스크롤바 위에서는 박스 선택을 시작하지 않는다(스크롤 동작 방해 금지)
      if (target.closest('.scrollbar-thumb') || target.closest('.scrollbar-track'))
        return;
      if (!containerRef.current) return;
      const { x, y } = toContainerXY(e.clientX, e.clientY);
      const start: DragBox = {
        x1: x,
        y1: y,
        x2: x,
        y2: y,
        deselect: e.shiftKey || e.ctrlKey,
      };
      dragBoxRef.current = start;
      setDragBox(start);
      isDraggingRef.current = false;
      wasDraggingRef.current = false;
      // 드래그 추적을 window 로 넘긴다(아래 useEffect). 그리드를 벗어나도
      // 드래그가 끊기지 않고, 실제 mouseup 에서만 종료된다.
      setIsSelecting(true);
    };

    // 박스 선택 진행: window 레벨에서 추적해 프롬프트/스크롤 영역에 닿아도
    // 드래그가 중도 취소되지 않게 한다.
    useEffect(() => {
      if (!isSelecting) return;

      const onMove = (e: MouseEvent) => {
        const start = dragBoxRef.current;
        const el = containerRef.current;
        if (!start || !el) return;
        const r = el.getBoundingClientRect();
        const dx = Math.abs(e.clientX - (start.x1 + r.left));
        const dy = Math.abs(e.clientY - (start.y1 + r.top));
        if (dx > 3 || dy > 3) isDraggingRef.current = true;
        if (!isDraggingRef.current) return;
        const { x, y } = toContainerXY(e.clientX, e.clientY);
        const next: DragBox = { ...start, x2: x, y2: y };
        dragBoxRef.current = next;
        setDragBox(next);
      };

      const onUp = () => {
        wasDraggingRef.current = isDraggingRef.current;
        const box = dragBoxRef.current;
        if (isDraggingRef.current && box) {
          const left = Math.min(box.x1, box.x2);
          const right = Math.max(box.x1, box.x2);
          const top = Math.min(box.y1, box.y2);
          const bottom = Math.max(box.y1, box.y2);
          const selected: string[] = [];
          const el = containerRef.current;
          if (el) {
            const cr = el.getBoundingClientRect();
            filePaths.forEach((path, index) => {
              const cell = document.getElementById(`image-cell-${index}`);
              if (!cell) return;
              const cc = cell.getBoundingClientRect();
              const cx = cc.left - cr.left;
              const cy = cc.top - cr.top;
              const cw = cc.width;
              const ch = cc.height;
              if (left < cx + cw && right > cx && top < cy + ch && bottom > cy) {
                selected.push(path);
              }
            });
          }
          if (selected.length > 0 && onSelectedImagesChange) {
            onSelectedImagesChange(selected, box.deselect);
          }
        }
        dragBoxRef.current = null;
        setDragBox(null);
        isDraggingRef.current = false;
        setIsSelecting(false);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      return () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
    }, [isSelecting, filePaths, onSelectedImagesChange]);

    const handleGridClick = (e: React.MouseEvent) => {
      if (wasDraggingRef.current) {
        wasDraggingRef.current = false;
        return;
      }
      if (
        e.target === containerRef.current ||
        (e.target as HTMLElement).classList.contains('CustomScrollbars') ||
        ((e.target as HTMLElement).tagName === 'DIV' &&
          !(e.target as HTMLElement).closest('.image-cell'))
      ) {
        if (onClearSelection) {
          onClearSelection();
        }
      }
    };

    return (
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%' }}
        className={
          'flex justify-center relative select-none ' +
          (isHidden ? 'hidden' : '')
        }
        onMouseDown={handleGridMouseDown}
        onClick={handleGridClick}
      >
        <Grid
          ref={gridRef}
          columnCount={columnCount}
          columnWidth={columnWidth}
          height={containerHeight}
          className={'bg-gray-100 ' + (isHidden ? 'hidden' : '')}
          rowCount={Math.ceil(filePaths.length / columnCount)}
          rowHeight={rowHeight}
          width={columnCount * columnWidth}
          itemData={createItemData(
            scene,
            filePaths,
            onSelected,
            columnCount,
            refreshImageFuncs,
            draggedIndex,
            isMainImage,
            onFilenameChange,
            imageSize,
            selectedImages,
            bookmarkedImagePath,
            focusedIndex ?? null,
            onCellEnter,
            onCellLeave,
          )}
          outerElementType={CustomScrollbarsVirtualGrid}
          overscanRowCount={overcountCounts[Math.ceil(imageSize / 200) - 1]}
        >
          {Cell}
        </Grid>
        {dragBox && isDraggingRef.current && (
          <div
            className="absolute bg-sky-500/30 border-2 border-sky-500 rounded pointer-events-none z-50"
            style={{
              left: Math.min(dragBox.x1, dragBox.x2),
              top: Math.min(dragBox.y1, dragBox.y2),
              width: Math.abs(dragBox.x2 - dragBox.x1),
              height: Math.abs(dragBox.y2 - dragBox.y1),
            }}
          />
        )}
      </div>
    );
  },
);

interface ResultDetailViewButton {
  text: string | ((path: string) => string);
  className: string;
  onClick: (scene: GenericScene, path: string, close: () => void) => void;
}

interface ResultDetailViewProps {
  scene: GenericScene;
  getPaths: () => string[];
  initialSelectedIndex: number;
  buttons: ResultDetailViewButton[];
  onClose: () => void;
}
const ResultDetailView = observer(
  ({
    scene,
    buttons,
    getPaths,
    initialSelectedIndex,
    onClose,
  }: ResultDetailViewProps) => {
    const { curSession } = appState;

    // 단축키 시스템에 ResultViewer 열림 상태 전달
    useEffect(() => {
      appState.resultViewerOpen = true;
      return () => {
        appState.resultViewerOpen = false;
      };
    }, []);
    const [selectedIndex, setSelectedIndex] =
      useState<number>(initialSelectedIndex);
    const [paths, setPaths] = useState<string[]>(getPaths());
    const [filename, setFilename] = useState<string>(
      paths[selectedIndex].split('/').pop()!,
    );
    const filenameRef = useRef<string>(filename);
    const [image, setImage] = useState<string | undefined>(undefined);
    const watchedImages = useRef(new Set<string>());
    const [middlePrompt, setMiddlePrompt] = useState<string>('');
    const [characterPrompts, setCharacterPrompts] = useState<CharacterPrompt[]>(
      [],
    );
    const [seed, setSeed] = useState<string>('');
    const [scale, setScale] = useState<string>('');
    const [sampler, setSampler] = useState<string>('');
    const [steps, setSteps] = useState<string>('');
    const [uc, setUc] = useState<string>('');
    const [_, forceUpdate] = useState<{}>({});
    useEffect(() => {
      const fetchImage = async () => {
        if (!paths[selectedIndex]) return;
        try {
          let base64Image = await imageService.fetchImage(
            paths[selectedIndex],
          )!;
          setImage(base64Image!);
          base64Image = dataUriToBase64(base64Image!);
          try {
            const job = await extractPromptDataFromBase64(base64Image);
            if (job) {
              const { prompt, seed, promptGuidance, sampling, steps, uc } = job;
              setMiddlePrompt(prompt);
              setCharacterPrompts(job.characterPrompts);
              setSeed(seed?.toString() ?? '');
              setScale(promptGuidance.toString());
              setSampler(sampling);
              setSteps(steps.toString());
              setUc(uc);
            } else {
              setMiddlePrompt('');
              setCharacterPrompts([]);
              setSeed('');
              setScale('');
              setSampler('');
              setSteps('');
              setUc('');
            }
          } catch (e: any) {
            setMiddlePrompt('');
            setCharacterPrompts([]);
            setSeed('');
            setScale('');
            setSampler('');
            setSteps('');
            setUc('');
          }
          setFilename(paths[selectedIndex].split('/').pop()!);
        } catch (e: any) {
          console.log(e);
          setImage(undefined);
          setMiddlePrompt('');
          setCharacterPrompts([]);
          setSeed('');
          setScale('');
          setSampler('');
          setSteps('');
          setUc('');
          setFilename('');
        }
      };
      const rerender = () => {
        forceUpdate({});
      };
      fetchImage();
      filenameRef.current = paths[selectedIndex].split('/').pop()!;
      const handleKeyDown = async (e: KeyboardEvent) => {
        if (e.key === 'ArrowLeft') {
          setSelectedIndex((selectedIndex - 1 + paths.length) % paths.length);
        } else if (e.key === 'ArrowRight') {
          setSelectedIndex((selectedIndex + 1) % paths.length);
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
          const doDel = async () => {
            await deleteImageFiles(curSession!, [paths[selectedIndex]], scene);
          };
          if (appState.skipImageDeleteConfirm) {
            await doDel();
            return;
          }
          appState.pushDialog({
            type: 'confirm',
            text: '정말로 파일을 삭제하시겠습니까?',
            showSkipConfirm: true,
            callback: doDel,
          });
        }
      };
      const handleShortcut = async (e: Event) => {
        const action = (e as CustomEvent).detail?.action;
        if (action === 'prev-image') {
          setSelectedIndex((selectedIndex - 1 + paths.length) % paths.length);
        } else if (action === 'next-image') {
          setSelectedIndex((selectedIndex + 1) % paths.length);
        } else if (action === 'delete-image') {
          const doDel = async () => {
            await deleteImageFiles(curSession!, [paths[selectedIndex]], scene);
          };
          if (appState.skipImageDeleteConfirm) {
            await doDel();
            return;
          }
          appState.pushDialog({
            type: 'confirm',
            text: '정말로 파일을 삭제하시겠습니까?',
            showSkipConfirm: true,
            callback: doDel,
          });
        } else if (action === 'toggle-favorite') {
          const path = paths[selectedIndex].split('/').pop()!;
          if (scene.mains.includes(path)) {
            scene.mains.splice(scene.mains.indexOf(path), 1);
          } else {
            scene.mains.push(path);
          }
        } else if (action === 'toggle-bookmark') {
          const filename = paths[selectedIndex]?.split('/').pop();
          if (filename) {
            sessionService.toggleImageBookmark(
              curSession!.name,
              scene.name,
              filename,
            );
          }
        } else if (action === 'save-image') {
          imageDownloadService.downloadSingleImage(
            curSession!,
            scene,
            paths[selectedIndex],
            appState.getAppliedCharacterPreset(),
          );
        }
      };
      const refreshPaths = () => {
        const newPaths = getPaths();
        if (newPaths.length === 0) onClose();
        else {
          let newIndex = newPaths.indexOf(
            imageService.getOutputDir(curSession!, scene) +
              '/' +
              filenameRef.current,
          );
          if (newIndex !== -1) {
            setSelectedIndex(newIndex);
          } else {
            setSelectedIndex((prev) => Math.min(prev, newPaths.length - 1));
          }
          setPaths(newPaths);
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('shortcut-action', handleShortcut);
      sessionService.addEventListener('main-image-updated', rerender);
      imageService.addEventListener('image-cache-invalidated', fetchImage);
      gameService.addEventListener('updated', refreshPaths);
      return () => {
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('shortcut-action', handleShortcut);
        sessionService.removeEventListener('main-image-updated', rerender);
        imageService.removeEventListener('image-cache-invalidated', fetchImage);
        gameService.removeEventListener('updated', refreshPaths);
      };
    }, [selectedIndex, paths]);

    useEffect(() => {
      return () => {
        watchedImages.current.forEach((path) => {
          // invoke('unwatch-image', path);
        });
      };
    });

    const [showPrompt, setShowPrompt] = useState<boolean>(false);
    const { show, hideAll } = useContextMenu({
      id: ContextMenuType.Image,
    });

    const [bmRev2, setBmRev2] = useState(0);
    useEffect(() => {
      const onBmUpdate = () => setBmRev2((r) => r + 1);
      sessionService.addEventListener('bookmark-updated', onBmUpdate);
      return () =>
        sessionService.removeEventListener('bookmark-updated', onBmUpdate);
    }, []);
    const currentFilename = paths[selectedIndex]?.split('/').pop();
    const isImageBm = !!(
      currentFilename &&
      sessionService.isImageBookmarked(
        curSession!.name,
        scene.name,
        currentFilename,
      )
    );

    if (!paths[selectedIndex]) return null;

    return (
      <div className="z-10 bg-[var(--c-surface)] w-full h-full flex overflow-auto flex-col md:flex-row">
        <div className="flex-none md:w-1/3 p-2 md:p-4 overflow-y-auto">
          <div className="flex gap-2 md:gap-3 mb-2 md:mb-6 flex-wrap w-full">
            {!isMobile && (
              <button
                className={`round-button back-green`}
                onClick={async () => {
                  // 다운로드 다이얼로그 열기
                  await imageDownloadService.downloadSingleImage(
                    curSession!,
                    scene,
                    paths[selectedIndex],
                    appState.getAppliedCharacterPreset(),
                  );
                }}
              >
                <FaDownload className="mr-1" />
                다운로드
              </button>
            )}
            <button
              className={`round-button back-sky`}
              onClick={async () => {
                if (isMobile) {
                  await backend.copyToDownloads(paths[selectedIndex]);
                } else {
                  await backend.showFile(paths[selectedIndex]);
                }
              }}
            >
              {!isMobile ? '파일 위치 열기' : '파일 다운로드'}
            </button>
            {!isMobile && (
              <button
                className={`round-button back-sky`}
                onClick={async () => {
                  await backend.openImageEditor(paths[selectedIndex]);
                  watchedImages.current.add(paths[selectedIndex]);
                  backend.watchImage(paths[selectedIndex]);
                }}
              >
                이미지 편집
              </button>
            )}
            <button
              className={`round-button back-red`}
              onClick={() => {
                const doDel = async () => {
                  await deleteImageFiles(
                    curSession!,
                    [paths[selectedIndex]],
                    scene,
                  );
                };
                if (appState.skipImageDeleteConfirm) {
                  doDel();
                  return;
                }
                appState.pushDialog({
                  type: 'confirm',
                  text: '정말로 파일을 삭제하시겠습니까?',
                  showSkipConfirm: true,
                  callback: doDel,
                });
              }}
            >
              파일 삭제
            </button>
            <button
              className={`round-button ${isImageBm ? 'back-orange' : 'back-gray'}`}
              onClick={() => {
                if (currentFilename) {
                  sessionService.toggleImageBookmark(
                    curSession!.name,
                    scene.name,
                    currentFilename,
                  );
                }
              }}
            >
              <FaBookmark className="mr-1" />
              {isImageBm ? '북마크 해제' : '북마크'}
            </button>
            <button
              className={`round-button back-sky`}
              onClick={() => {
                appState.copyImagesToClipboard([paths[selectedIndex]]);
              }}
            >
              <FaCopy className="mr-1" />
              이미지 복사
            </button>
            {buttons.map((button, index) => (
              <button
                key={index}
                className={`round-button ${button.className}`}
                onClick={() => {
                  button.onClick(scene, paths[selectedIndex], onClose);
                }}
              >
                {button.text instanceof Function
                  ? button.text(paths[selectedIndex])
                  : button.text}
              </button>
            ))}
          </div>
          <button
            className={`round-button back-gray md:hidden`}
            onClick={() => setShowPrompt(!showPrompt)}
          >
            {!showPrompt ? '자세한 정보 보기' : '자세한 정보 숨기기'}
          </button>
          <div
            className={
              'mt-2 md:mt-0 md:block ' + (showPrompt ? 'block' : 'hidden')
            }
          >
            <div className="max-w-full mb-2 text-sub">
              <span className="gray-label">파일이름: </span>
              <span>{filename}</span>
            </div>
            <div className="w-full mb-2">
              <div className="gray-label">프롬프트 </div>
              <PromptHighlighter
                text={middlePrompt}
                className="w-full h-24 overflow-auto"
              />
            </div>
            <div className="w-full mb-2">
              <div className="gray-label">네거티브 프롬프트 </div>
              <PromptHighlighter
                text={uc}
                className="w-full h-24 overflow-auto"
              />
            </div>
            {characterPrompts.map((prompt, index) => (
              <div
                key={index}
                className="w-full mb-4 border line-color rounded-md p-3"
              >
                <div className="gray-label">캐릭터 프롬프트 </div>
                <PromptHighlighter
                  text={prompt.prompt}
                  className="w-full h-24 overflow-auto"
                />
                <div className="gray-label">네거티브 프롬프트 </div>
                <PromptHighlighter
                  text={prompt.uc}
                  className="w-full h-24 overflow-auto"
                />
              </div>
            ))}
            <div className="w-full mb-2 text-sub">
              <span className="gray-label">시드: </span>
              {seed}
            </div>
            <div className="w-full mb-2 text-sub">
              <span className="gray-label">프롬프트 가이던스: </span>
              {scale}
            </div>
            <div className="w-full mb-2 text-sub">
              <span className="gray-label">샘플러: </span>
              {sampler}
            </div>
            <div className="w-full mb-2 text-sub">
              <span className="gray-label">스텝: </span>
              {steps}
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-auto">
          {image && (
            <img
              src={image}
              draggable={false}
              onContextMenu={(e) => {
                show({
                  event: e,
                  props: {
                    ctx: {
                      type: 'image',
                      path: paths[selectedIndex],
                      scene: scene,
                      starable: true,
                    },
                  },
                });
              }}
              className="w-full h-full object-contain bg-checkboard"
            />
          )}
          <div className="absolute bottom-0 md:bottom-auto right-0 md:top-10 flex gap-3 p-4 w-full md:w-auto">
            <button
              className={`round-button  ml-0 md:ml-auto h-10 md:h-8 w-20 md:w-auto bg-gray-300 text-gray-700 mr-auto md:mr-0 text-xl md:text-base`}
              onClick={() => {
                setSelectedIndex(
                  (selectedIndex - 1 + paths.length) % paths.length,
                );
              }}
            >
              <FaArrowLeft />
            </button>
            <button
              className={`round-button h-10 md:h-8 w-20 md:w-auto bg-gray-300 text-xl text-gray-700 md:text-base`}
              onClick={() => {
                setSelectedIndex((selectedIndex + 1) % paths.length);
              }}
            >
              <FaArrowRight />
            </button>
          </div>
        </div>
      </div>
    );
  },
);

interface ResultVieweRef {
  setImageTab: () => void;
  setInpaintTab: () => void;
}

interface ResultViewerProps {
  scene: GenericScene;
  buttons: any[];
  onFilenameChange: (src: string, dst: string) => void;
  onEdit: (scene: GenericScene) => void;
  isMainImage?: (path: string) => boolean;
  starScene?: Scene;
  onSampleExtract?: (seeds: number[]) => void;
  // 히스토리 사이드바에서 특정 이미지로 점프할 때 포커스할 파일명
  focusFilename?: string;
}

const ResultViewer = forwardRef<ResultVieweRef, ResultViewerProps>(
  (
    {
      scene,
      onFilenameChange,
      onEdit,
      starScene,
      isMainImage,
      buttons,
      onSampleExtract,
      focusFilename,
    }: ResultViewerProps,
    ref,
  ) => {
    const { curSession, samples } = appState;
    const [_, forceUpdate] = useState<{}>({});
    const [selectMode, setSelectMode] = useState<boolean>(false);
    const [showImageCheatsheet, setShowImageCheatsheet] =
      useState<boolean>(false);
    const [tournament, setTournament] = useState<boolean>(false);
    const selectedImages = useRef(new Set<string>());
    const [selectedImageIndex, setSelectedImageIndex] = useState<
      number | undefined
    >(undefined);
    const gallaryRef = useRef<ImageGalleryRef>(null);
    const gallaryRef2 = useRef<ImageGalleryRef>(null);
    const imagesSizes = [
      { name: 'S', size: 200 },
      { name: 'M', size: 400 },
      { name: 'L', size: 500 },
    ];
    const [imageSize, setImageSize] = useState<number>(1);
    const [selectedTab, setSelectedTab] = useState<number>(0);
    const [showDownloadDialog, setShowDownloadDialog] =
      useState<boolean>(false);
    const tabNames =
      scene.type === 'scene'
        ? ['이미지', '즐겨찾기', '휴지통', '인페인트 씬']
        : ['이미지', '즐겨찾기', '휴지통'];
    useEffect(() => {
      imageService.refresh(curSession!, scene);
    }, []);

    const [bmRev3, setBmRev3] = useState(0);
    useEffect(() => {
      const onBmUpdate = () => setBmRev3((r) => r + 1);
      sessionService.addEventListener('bookmark-updated', onBmUpdate);
      return () =>
        sessionService.removeEventListener('bookmark-updated', onBmUpdate);
    }, []);
    const bookmarkedImageFilename = sessionService.getImageBookmark(
      curSession!.name,
      scene.name,
    );
    const bookmarkedImagePath = bookmarkedImageFilename
      ? imageService.getOutputDir(curSession!, scene) +
        '/' +
        bookmarkedImageFilename
      : undefined;

    useImperativeHandle(ref, () => ({
      setImageTab: () => {
        setSelectedTab(0);
      },
      setInpaintTab: () => {
        setSelectedTab(3);
      },
    }));

    useEffect(() => {
      const handleGameChanged = () => {
        if (!tournament) forceUpdate({});
      };
      gameService.addEventListener('updated', handleGameChanged);
      return () => {
        gameService.removeEventListener('updated', handleGameChanged);
      };
    }, [tournament]);

    const paths = gameService
      .getOutputs(curSession!, scene)
      .map(
        (path) => imageService.getOutputDir(curSession!, scene) + '/' + path,
      );
    // 히스토리 → 특정 이미지 포커스: 그리드를 해당 이미지 위치로 스크롤
    useEffect(() => {
      if (!focusFilename) return;
      const idx = paths.findIndex((p) => p.endsWith('/' + focusFilename));
      if (idx >= 0) {
        const t = setTimeout(() => gallaryRef.current?.scrollToIndex(idx), 100);
        return () => clearTimeout(t);
      }
    }, [focusFilename]);

    const onSelected = useCallback(
      (index: any) => {
        if (selectMode) {
          if (selectedImages.current.has(paths[index])) {
            selectedImages.current.delete(paths[index]);
          } else {
            selectedImages.current.add(paths[index]);
          }
          if (gallaryRef.current) {
            gallaryRef.current.refeshImage(paths[index]);
          }
          if (gallaryRef2.current) {
            gallaryRef2.current.refeshImage(paths[index]);
          }
          forceUpdate({});
        } else {
          setSelectedImageIndex(index);
        }
      },
      [selectMode, paths],
    );

    const onSelectedImagesChange = useCallback(
      (selectedPaths: string[], deselect: boolean) => {
        if (!selectMode) {
          setSelectMode(true);
        }
        for (const p of selectedPaths) {
          if (deselect) {
            selectedImages.current.delete(p);
          } else {
            selectedImages.current.add(p);
          }
        }
        if (gallaryRef.current) {
          gallaryRef.current.refresh();
        }
        if (gallaryRef2.current) {
          gallaryRef2.current.refresh();
        }
        forceUpdate({});
      },
      [selectMode],
    );

    const onClearSelection = useCallback(() => {
      selectedImages.current.clear();
      setSelectMode(false);
      if (gallaryRef.current) {
        gallaryRef.current.refresh();
      }
      if (gallaryRef2.current) {
        gallaryRef2.current.refresh();
      }
      forceUpdate({});
    }, []);

    const onToggleFavoriteSelected = useCallback(() => {
      if (selectedImages.current.size === 0) return;
      for (const path_ of selectedImages.current) {
        const filename = path_.split('/').pop()!;
        if (scene.mains.includes(filename)) {
          scene.mains.splice(scene.mains.indexOf(filename), 1);
        } else {
          scene.mains.push(filename);
        }
      }
      if (gallaryRef.current) gallaryRef.current.refresh();
      if (gallaryRef2.current) gallaryRef2.current.refresh();
      sessionService.dirty[curSession!.name] = true;
      forceUpdate({});
    }, [scene, curSession]);

    const onDuplicateSelected = useCallback(async () => {
      if (selectedImages.current.size === 0) return;
      let counter = 0;
      for (const path of selectedImages.current) {
        const tmp = path.slice(0, path.lastIndexOf('/'));
        await backend.copyFile(
          path,
          tmp + '/' + Date.now().toString() + '_' + counter++ + '.png',
        );
      }
      imageService.refresh(curSession!, scene);
      appState.pushDialog({
        type: 'yes-only',
        text: '이미지를 복제했습니다',
      });
    }, [scene, curSession]);

    const onCopyToSceneSelected = useCallback(() => {
      if (selectedImages.current.size === 0) return;
      appState.pushDialog({
        type: 'dropdown',
        text: '이미지를 어디에 복사할까요?',
        items: Array.from(curSession!.scenes.keys()).map((key) => ({
          text: key,
          value: key,
        })),
        callback: async (value) => {
          if (!value) return;
          const targetScene = curSession!.scenes.get(value);
          if (!targetScene) return;

          let counter = 0;
          for (const path of selectedImages.current) {
            await backend.copyFile(
              path,
              imageService.getImageDir(curSession!, targetScene) +
                '/' +
                Date.now().toString() +
                '_' +
                counter++ +
                '.png',
            );
          }
          imageService.refresh(curSession!, targetScene);
          appState.pushDialog({
            type: 'yes-only',
            text: '이미지를 복사했습니다',
          });
        },
      });
    }, [curSession]);

    const onDeleteImages = async (scene: GenericScene) => {
      appState.pushDialog({
        type: 'select',
        text: '이미지를 삭제합니다. 원하시는 작업을 선택해주세요.',
        items: [
          {
            text: '모든 이미지 삭제',
            value: 'all',
          },
          {
            text: '즐겨찾기 제외 n등 이하 이미지 삭제',
            value: 'n',
          },
          {
            text: '즐겨찾기 제외 모든 이미지 삭제',
            value: 'fav',
          },
        ],
        callback: async (value) => {
          if (value === 'all') {
            const doDel = async () => {
              await deleteImageFiles(curSession!, paths, scene);
            };
            if (appState.skipImageDeleteConfirm) {
              await doDel();
              return;
            }
            appState.pushDialog({
              type: 'confirm',
              text: '정말로 모든 이미지를 삭제하시겠습니까?',
              showSkipConfirm: true,
              callback: doDel,
            });
          } else if (value === 'n') {
            appState.pushDialog({
              type: 'input-confirm',
              text: '몇등 이하 이미지를 삭제할지 입력해주세요.',
              callback: async (value) => {
                if (value) {
                  const n = parseInt(value);
                  await deleteImageFiles(
                    curSession!,
                    paths
                      .slice(n)
                      .filter((x) => !isMainImage || !isMainImage(x)),
                    scene,
                  );
                }
              },
            });
          } else {
            const doDel = async () => {
              await deleteImageFiles(
                curSession!,
                paths.filter((x) => !isMainImage || !isMainImage(x)),
                scene,
              );
            };
            if (appState.skipImageDeleteConfirm) {
              await doDel();
              return;
            }
            appState.pushDialog({
              type: 'confirm',
              text: '정말로 즐겨찾기 외 모든 이미지를 삭제하시겠습니까?',
              showSkipConfirm: true,
              callback: doDel,
            });
          }
        },
      });
    };

    const getPaths = () => {
      const paths = gameService
        .getOutputs(curSession!, scene)
        .map(
          (path) => imageService.getOutputDir(curSession!, scene) + '/' + path,
        );
      return selectedTab === 0
        ? paths
        : paths.filter((path) => isMainImage && isMainImage(path));
    };

    // ===== 이미지 그리드 키보드 네비게이션 =====
    const [focusedImageIndex, setFocusedImageIndex] = useState<number | null>(
      null,
    );

    const activePaths =
      selectedTab === 0
        ? paths
        : selectedTab === 1
          ? paths.filter((p) => isMainImage && isMainImage(p))
          : [];
    const activeGalleryRef = selectedTab === 0 ? gallaryRef : gallaryRef2;

    // image-grid 카테고리 활성화 조건 동기화
    // 탭 전환 단축키(Ctrl+1/2/3/4)는 모든 탭에서 동작해야 하므로 selectedTab을 조건에서 제외.
    // 그리드 조작(방향키/즐겨찾기/북마크/삭제/상세 보기)은 핸들러 내부에서 selectedTab 가드 적용.
    useEffect(() => {
      const active = !isMobile && selectedImageIndex == null;
      appState.imageGridFocusable = active;
      return () => {
        appState.imageGridFocusable = false;
      };
    }, [selectedImageIndex]);

    // 탭 변경 시 포커스 리셋
    useEffect(() => {
      setFocusedImageIndex(null);
    }, [selectedTab]);

    // 포커스 이미지를 화면 안으로 스크롤
    useEffect(() => {
      if (focusedImageIndex != null) {
        activeGalleryRef.current?.scrollToIndex(focusedImageIndex);
      }
    }, [focusedImageIndex]);

    // 단축키 핸들러
    useEffect(() => {
      const onShortcut = (e: Event) => {
        const action = (e as CustomEvent).detail?.action as string | undefined;
        if (!action?.startsWith('image-')) return;

        // 탭 전환 — 모든 탭에서 작동 (count/selectedTab 가드 전에 처리)
        if (
          action === 'image-tab-1' ||
          action === 'image-tab-2' ||
          action === 'image-tab-3' ||
          action === 'image-tab-4'
        ) {
          const tabIdx =
            action === 'image-tab-1'
              ? 0
              : action === 'image-tab-2'
                ? 1
                : action === 'image-tab-3'
                  ? 2
                  : 3;
          // 인페인트 씬 탭(3)은 scene 타입 전용
          if (tabIdx === 3 && scene.type !== 'scene') return;
          setSelectedTab(tabIdx);
          return;
        }

        // 이하 그리드 조작은 이미지/즐겨찾기 탭에서만 의미 있음
        if (selectedTab !== 0 && selectedTab !== 1) return;

        const count = activePaths.length;
        const cols = activeGalleryRef.current?.getColumnCount() ?? 1;
        if (count === 0) return;

        const toggleSelectAt = (idx: number) => {
          const path = activePaths[idx];
          if (selectedImages.current.has(path)) {
            selectedImages.current.delete(path);
          } else {
            selectedImages.current.add(path);
          }
          gallaryRef.current?.refeshImage(path);
          gallaryRef2.current?.refeshImage(path);
          forceUpdate({});
        };

        // 선택 모드 진입/취소는 포커스가 없어도 동작 (씬 그리드와 동일 UX)
        if (action === 'image-clear-select') {
          selectedImages.current.clear();
          setSelectMode(false);
          gallaryRef.current?.refresh();
          gallaryRef2.current?.refresh();
          forceUpdate({});
          return;
        }
        if (action === 'image-toggle-select') {
          // 모드 진입 후엔 수정자 없는 S만으로 토글이 이어진다(아래 keydown 핸들러).
          if (!selectMode) setSelectMode(true);
          const idx = focusedImageIndex ?? 0;
          if (focusedImageIndex == null) setFocusedImageIndex(0);
          toggleSelectAt(idx);
          return;
        }

        // 첫 입력 시 포커스 0으로 초기화 (방향키에 한해)
        if (
          focusedImageIndex == null &&
          (action === 'image-left' ||
            action === 'image-right' ||
            action === 'image-up' ||
            action === 'image-down')
        ) {
          setFocusedImageIndex(0);
          return;
        }

        if (focusedImageIndex == null) return;
        const i = focusedImageIndex;

        if (action === 'image-left') {
          setFocusedImageIndex(Math.max(0, i - 1));
        } else if (action === 'image-right') {
          setFocusedImageIndex(Math.min(count - 1, i + 1));
        } else if (action === 'image-up') {
          setFocusedImageIndex(Math.max(0, i - cols));
        } else if (action === 'image-down') {
          setFocusedImageIndex(Math.min(count - 1, i + cols));
        } else if (action === 'image-open-detail') {
          // activePaths[i]의 원본 paths 내 인덱스로 전환 (ResultDetailView는 전체 paths 기준)
          const originalIdx = paths.indexOf(activePaths[i]);
          if (originalIdx >= 0) setSelectedImageIndex(originalIdx);
        } else if (action === 'image-toggle-favorite') {
          const filename = activePaths[i].split('/').pop()!;
          if (scene.mains.includes(filename)) {
            scene.mains.splice(scene.mains.indexOf(filename), 1);
          } else {
            scene.mains.push(filename);
          }
        } else if (action === 'image-toggle-bookmark') {
          const filename = activePaths[i].split('/').pop()!;
          sessionService.toggleImageBookmark(
            curSession!.name,
            scene.name,
            filename,
          );
        } else if (action === 'image-delete') {
          appState.pushDialog({
            type: 'confirm',
            text: '정말로 파일을 삭제하시겠습니까?',
            callback: async () => {
              await deleteImageFiles(curSession!, [activePaths[i]], scene);
              const newCount = count - 1;
              if (newCount === 0) setFocusedImageIndex(null);
              else setFocusedImageIndex(Math.min(i, newCount - 1));
            },
          });
        }
      };
      window.addEventListener('shortcut-action', onShortcut);
      return () => window.removeEventListener('shortcut-action', onShortcut);
    }, [
      focusedImageIndex,
      activePaths,
      paths,
      scene,
      selectedTab,
      curSession,
      selectMode,
    ]);

    // 선택 모드(Ctrl+S로 진입)에서 수정자 없는 S로 포커스 이미지 선택 토글.
    // 모드 밖에서는 실수 선택을 막기 위해 무시한다(씬 그리드와 동일 UX).
    useEffect(() => {
      const handler = (e: KeyboardEvent) => {
        if (e.key !== 's' && e.key !== 'S') return;
        if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
        if (isMobile) return;
        if (selectedImageIndex != null) return; // 상세 보기 열림
        if (selectedTab !== 0 && selectedTab !== 1) return;
        if (!selectMode || focusedImageIndex == null) return;
        const el = document.activeElement;
        if (el) {
          const tag = el.tagName.toLowerCase();
          if (
            tag === 'input' ||
            tag === 'textarea' ||
            (el as HTMLElement).isContentEditable
          )
            return;
        }
        if (focusedImageIndex >= activePaths.length) return;
        e.preventDefault();
        const path = activePaths[focusedImageIndex];
        if (selectedImages.current.has(path)) {
          selectedImages.current.delete(path);
        } else {
          selectedImages.current.add(path);
        }
        gallaryRef.current?.refeshImage(path);
        gallaryRef2.current?.refeshImage(path);
        forceUpdate({});
      };
      window.addEventListener('keydown', handler);
      return () => window.removeEventListener('keydown', handler);
    }, [selectMode, focusedImageIndex, activePaths, selectedTab, selectedImageIndex]);

    // H로 이미지 그리드 전용 단축키 도움말 토글.
    // 토너먼트/상세 보기 중에는 각자의 도움말이 우선하므로 무시한다.
    useEffect(() => {
      const handler = (e: KeyboardEvent) => {
        if (e.key !== 'h' && e.key !== 'H') return;
        if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
        if (isMobile) return;
        if (tournament || selectedImageIndex != null) return;
        const el = document.activeElement;
        if (el) {
          const tag = el.tagName.toLowerCase();
          if (
            tag === 'input' ||
            tag === 'textarea' ||
            (el as HTMLElement).isContentEditable
          )
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        setShowImageCheatsheet((v) => !v);
      };
      window.addEventListener('keydown', handler, true);
      return () => window.removeEventListener('keydown', handler, true);
    }, [tournament, selectedImageIndex]);

    let emoji = '';
    let title = '';
    if (scene.type === 'inpaint') {
      emoji = workFlowService.getDef(scene.workflowType)?.emoji ?? '';
      title = workFlowService.getDef(scene.workflowType)?.title ?? '';
    }

    return (
      <div className="w-full h-full flex flex-col">
        {!isMobile && showImageCheatsheet && !tournament && (
          <ShortcutCheatsheet
            scope="image-grid"
            onClose={() => setShowImageCheatsheet(false)}
          />
        )}
        {tournament && (
          <FloatView
            priority={2}
            onEscape={() => {
              setTournament(false);
            }}
          >
            <Tournament
              scene={scene}
              path={getResultDirectory(curSession!, scene)}
            />
          </FloatView>
        )}
        <div className="flex-none p-2 md:p-4 border-b line-color">
          <div className="mb-2 md:mb-4 flex items-center">
            <span className="font-bold text-lg md:text-2xl text-default">
              {selectMode ? (
                <span className="inline-flex items-center gap-1">
                  이미지 선택 모드 ON
                </span>
              ) : !isMobile ? (
                scene.type === 'inpaint' ? (
                  <span className="inline-flex items-center gap-1">
                    {emoji} {title} 씬 {scene.name}의 생성된 이미지
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1">
                    🖼️ 일반 씬 {scene.name}의 생성된 이미지
                  </span>
                )
              ) : scene.type === 'inpaint' ? (
                <span className="inline-flex items-center gap-1">
                  {emoji} {title} 씬 {scene.name}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  🖼️ 일반 씬 {scene.name}
                </span>
              )}
            </span>
          </div>
          <div className="md:flex justify-between items-center mt-2 md:mt-4">
            <div className="flex gap-2 md:gap-3 flex-wrap">
              <button
                className={`round-button back-sky`}
                onClick={() => setTournament(true)}
              >
                이상형 월드컵
              </button>
              <button
                className={`round-button back-green`}
                onClick={async () => {
                  if (scene.type === 'scene') {
                    await queueWorkflow(
                      curSession!,
                      curSession!.selectedWorkflow!,
                      scene,
                      appState.samples,
                    );
                  } else {
                    await queueI2IWorkflow(
                      curSession!,
                      scene.workflowType,
                      scene.preset,
                      scene,
                      appState.samples,
                    );
                  }
                }}
              >
                {!isMobile ? '예약 추가' : <FaPlus />}
              </button>
              <Tooltip content="예약 제거">
                <button
                  className={`round-button back-gray`}
                  onClick={() => {
                    taskQueueService.removeTasksFromScene(scene);
                  }}
                >
                  {!isMobile ? '예약 제거' : <FaCalendarTimes />}
                </button>
              </Tooltip>
              <Tooltip content="씬 편집">
                <button
                  className={`round-button back-orange`}
                  onClick={() => {
                    onEdit(scene);
                  }}
                >
                  {!isMobile ? '씬 편집' : <FaEdit />}
                </button>
              </Tooltip>
              {!isMobile && (
                <Tooltip content="폴더 열기">
                  <button
                    className={`round-button back-sky`}
                    onClick={async () => {
                      await backend.showFile(
                        getResultDirectory(curSession!, scene),
                      );
                    }}
                  >
                    <FaFolder />
                  </button>
                </Tooltip>
              )}
              <Tooltip content="이미지 선택 모드">
                <button
                  className={
                    `round-button ` + (selectMode ? 'back-sky' : 'back-gray')
                  }
                  onClick={() => {
                    if (selectMode) {
                      selectedImages.current.clear();
                    }
                    setSelectMode(!selectMode);
                  }}
                >
                  <FaRegSquareCheck />
                </button>
              </Tooltip>
              {isMainImage && (
                <Tooltip content="즐겨찾기 이미지 일괄 선택">
                  <button
                    className={`round-button back-yellow`}
                    onClick={() => {
                      const favPaths = paths.filter((p) => isMainImage!(p));
                      if (favPaths.length === 0) {
                        appState.pushMessage('즐겨찾기 이미지가 없습니다.');
                        return;
                      }
                      if (!selectMode) {
                        setSelectMode(true);
                      }
                      selectedImages.current.clear();
                      for (const p of favPaths) {
                        selectedImages.current.add(p);
                      }
                      gallaryRef.current?.refresh();
                      gallaryRef2.current?.refresh();
                      appState.pushMessage(
                        favPaths.length +
                          '장의 즐겨찾기 이미지가 선택되었습니다.',
                      );
                    }}
                  >
                    {/* 즐겨찾기 '선택' 헬퍼: 별+체크 배지로 토글 버튼(순수 별)과 구분 */}
                    <span className="relative inline-flex items-center justify-center">
                      <FaStar />
                      <FaCheck className="absolute -right-1.5 -bottom-1 text-[9px]" />
                    </span>
                  </button>
                </Tooltip>
              )}
              <Tooltip content="이미지 다운로드">
                <button
                  className={`round-button back-green`}
                  onClick={() => {
                    if (selectMode && selectedImages.current.size > 0) {
                      setShowDownloadDialog(true);
                    } else {
                      setShowDownloadDialog(true);
                    }
                  }}
                >
                  <FaDownload />
                </button>
              </Tooltip>
              <Tooltip content="이미지 복사">
                <button
                  className={`round-button back-sky`}
                  onClick={() => {
                    if (selectMode && selectedImages.current.size > 0) {
                      const selected = [...selectedImages.current];
                      appState.copyImagesToClipboard(selected);
                    } else {
                      appState.copyImagesToClipboard(paths);
                    }
                  }}
                >
                  <FaCopy />
                </button>
              </Tooltip>
              <Tooltip content="이미지 붙여넣기">
                <button
                  className={`round-button ${appState.imageClipboard.length > 0 ? 'back-sky' : 'back-gray'}`}
                  onClick={() => {
                    appState.pushDialog({
                      type: 'confirm',
                      text:
                        appState.imageClipboard.length +
                        '장의 이미지를 이 씬에 붙여넣으시겠습니까?',
                      callback: async () => {
                        await appState.pasteImagesFromClipboard(
                          curSession!,
                          scene,
                        );
                      },
                    });
                  }}
                >
                  <FaPaste />
                </button>
              </Tooltip>
              {selectMode && selectedImages.current.size > 0 && (
                <>
                  <Tooltip content="선택 이미지 즐겨찾기 토글">
                    <button
                      className="round-button back-yellow"
                      onClick={onToggleFavoriteSelected}
                    >
                      <FaStar />
                    </button>
                  </Tooltip>
                  <Tooltip content="선택 이미지 복제">
                    <button
                      className="round-button back-sky"
                      onClick={onDuplicateSelected}
                    >
                      <FaClone />
                    </button>
                  </Tooltip>
                  <Tooltip content="선택 이미지를 다른 씬으로 복사">
                    <button
                      className="round-button back-sky"
                      onClick={onCopyToSceneSelected}
                    >
                      <FaShareSquare />
                    </button>
                  </Tooltip>
                </>
              )}
              <Tooltip content="이미지 삭제">
                <button
                  className={`round-button back-red`}
                  onClick={() => {
                    onDeleteImages(scene);
                  }}
                >
                  <FaTrash />
                </button>
              </Tooltip>
              {onSampleExtract && (
                <Tooltip content="샘플 뽑기 (시드 추출)">
                  <button
                    className={`round-button back-sky`}
                    onClick={async () => {
                      if (!selectMode || selectedImages.current.size === 0) {
                        appState.pushMessage('이미지를 먼저 선택해주세요.');
                        return;
                      }
                      const selectedPaths = Array.from(selectedImages.current);
                      const seeds: number[] = [];
                      for (const path of selectedPaths) {
                        try {
                          const image = await imageService.fetchImage(path);
                          if (!image) continue;
                          const base64 = dataUriToBase64(image);
                          const job = await extractPromptDataFromBase64(base64);
                          if (job?.seed) seeds.push(job.seed);
                        } catch (e) {
                          // 시드 추출 실패 시 스킵
                        }
                      }
                      if (seeds.length === 0) {
                        appState.pushMessage(
                          '선택한 이미지에서 시드를 추출할 수 없습니다.',
                        );
                        return;
                      }
                      onSampleExtract(seeds);
                    }}
                  >
                    <FaDice />
                  </button>
                </Tooltip>
              )}
              <Tooltip content="북마크된 이미지로 이동">
                <button
                  className={`round-button ${bookmarkedImageFilename ? 'back-orange' : 'back-gray'}`}
                  onClick={() => {
                    if (!bookmarkedImageFilename) {
                      appState.pushMessage('북마크된 이미지가 없습니다.');
                      return;
                    }
                    const bmPath =
                      imageService.getOutputDir(curSession!, scene) +
                      '/' +
                      bookmarkedImageFilename;
                    const index = paths.indexOf(bmPath);
                    if (index !== -1) {
                      // 이미지 탭으로 전환 후 해당 위치로 스크롤
                      setSelectedTab(0);
                      setTimeout(() => {
                        gallaryRef.current?.scrollToIndex(index);
                      }, 50);
                    } else {
                      appState.pushMessage(
                        '북마크된 이미지를 찾을 수 없습니다.',
                      );
                    }
                  }}
                >
                  <FaBookmark />
                </button>
              </Tooltip>
            </div>
            <span className="flex ml-auto gap-1 md:gap-2 mt-2 md:mt-0">
              {tabNames.map((tabName, index) => (
                <button
                  className={
                    `round-button ` +
                    (selectedTab === index ? 'back-sky' : 'back-llgray')
                  }
                  onClick={() => setSelectedTab(index)}
                >
                  {tabName}
                </button>
              ))}
            </span>
          </div>
        </div>
        <div className="flex-1 pt-2 relative h-full overflow-hidden">
          <ImageGallery
            scene={scene}
            onFilenameChange={onFilenameChange}
            ref={gallaryRef}
            isMainImage={isMainImage}
            filePaths={paths}
            imageSize={imagesSizes[imageSize].size}
            isHidden={selectedTab !== 0}
            selectedImages={selectedImages.current}
            onSelected={onSelected}
            selectMode={selectMode}
            bookmarkedImagePath={bookmarkedImagePath}
            focusedIndex={selectedTab === 0 ? focusedImageIndex : null}
            onSelectedImagesChange={onSelectedImagesChange}
            onClearSelection={onClearSelection}
          />
          {selectedTab === 2 && (
            <TrashImageView
              session={curSession!}
              scene={scene}
              imageSize={imagesSizes[imageSize].size}
            />
          )}
          <QueueControl
            type="inpaint"
            className={selectedTab === 3 ? 'px-1 md:px-4 ' : 'hidden'}
            onClose={(x) => {
              setSelectedTab(x);
            }}
            filterFunc={(x: any) => {
              return !!(x.sceneRef && x.sceneRef === scene.name);
            }}
          ></QueueControl>
          {selectedImageIndex != null && (
            <FloatView
              priority={1}
              onEscape={() => setSelectedImageIndex(undefined)}
            >
              <ResultDetailView
                buttons={buttons}
                onClose={() => {
                  setSelectedImageIndex(undefined);
                }}
                scene={scene}
                getPaths={getPaths}
                initialSelectedIndex={selectedImageIndex}
              />
            </FloatView>
          )}
          {showDownloadDialog && (
            <DownloadDialog
              session={curSession!}
              scene={scene}
              imagePaths={
                selectMode && selectedImages.current.size > 0
                  ? Array.from(selectedImages.current)
                  : paths
              }
              characterPreset={appState.getAppliedCharacterPreset()}
              onClose={() => setShowDownloadDialog(false)}
              onDownloadComplete={() => {
                if (selectMode) {
                  selectedImages.current.clear();
                  setSelectMode(false);
                }
              }}
            />
          )}
          <ImageGallery
            scene={scene}
            ref={gallaryRef2}
            onFilenameChange={onFilenameChange}
            isMainImage={isMainImage}
            filePaths={paths.filter((path) => isMainImage && isMainImage(path))}
            imageSize={imagesSizes[imageSize].size}
            selectedImages={selectedImages.current}
            isHidden={selectedTab !== 1}
            onSelected={onSelected}
            bookmarkedImagePath={bookmarkedImagePath}
            focusedIndex={selectedTab === 1 ? focusedImageIndex : null}
            onSelectedImagesChange={onSelectedImagesChange}
            onClearSelection={onClearSelection}
          />
        </div>
        <div className="absolute gap-1 m-2 bottom-0 bg-[var(--c-surface-2)] p-1 right-0 opacity-30 hover:opacity-100 transition-all flex">
          {selectedTab !== 2 &&
            selectedTab !== 3 &&
            imagesSizes.map((size, index) => (
              <button
                key={index}
                className={`text-white w-8 h-8 hover:brightness-95 active:brightness-90 cursor-pointer
          ${imageSize === index ? 'bg-gray-600' : 'bg-gray-400'}`}
                onClick={() => {
                  setImageSize(index);
                }}
              >
                {size.name}
              </button>
            ))}
        </div>
      </div>
    );
  },
);

export default ResultViewer;
