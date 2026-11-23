import { EmptyState } from './EmptyState';
import { Spinner } from './ProgressIndicators';
import { canStartSelectionBox, imagePathsInSelectionBox } from '../models/dragSelection';
import { imageDragOutProps } from '../models/imageDragOut';
import { parseRankCutoff, RANK_CUTOFF_INVALID_MESSAGE } from '../models/rankCutoff';
import { isTextEntryFocused, shouldIgnoreViewerRawKey } from '../models/keyTargetGuard';
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
  useLayoutEffect,
} from 'react';
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
  FaCheck,
  FaDice,
  FaDownload,
  FaFolderOpen,
  FaStar,
  FaTrash,
  FaShareSquare,
  FaChevronUp,
  FaExchangeAlt,
  FaSearchPlus,
  FaReply,
  FaTrophy,
  FaInfoCircle,
} from 'react-icons/fa';
import { ActionIcon } from './ActionIcon';
import { isV2, V2_SHEET_PEEK_PX } from '../models/mobileV2';
import { V2MainRow, V2TierRows, type V2SlotDef, type V2TierItem } from './MobileV2Bars';
import { UndoBarSlot, UNDO_ANCHOR_ATTR } from './UndoBarSlot';
import { PromptHighlighter } from './SceneEditor';
import QueueControl from './SceneQueueControl';
import { FloatView, useFloatViewHeaderSlot } from './FloatView';
import { createPortal } from 'react-dom';
import { ImageDetailInfo, type ImageDetailInfoPart } from './ImageDetailInfo';
import { fitFrame } from './CharacterPositionOverlay';
import {
  base64ByteLength,
  buildImageDetailInfo,
  detailRankOf,
} from '../models/imageDetailInfo';
import { detailWideColumns, IMAGE_DETAIL_INFO_TEXT } from '../models/imageDetailInfoOpen';
import { imageExtFromBase64 } from '../models/imageFormats';
import memoizeOne from 'memoize-one';
import {
  FaPaste,
  FaChevronLeft,
  FaChevronRight,
} from 'react-icons/fa6';
import { useContextMenu } from 'react-contexify';
import { useDrag, useDrop } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';
import { reaction, set } from 'mobx';
import Tooltip from './Tooltip';
import { ButtonNameSlot, useButtonNameStage } from './ToolbarButtonName';
import SizeSlider from './SizeSlider';
import {
  SIZE_SLIDER_TEXT,
  imageGridCellPx,
  imageGridThumbPx,
  normalizeSizePercent,
} from '../models/sizeSlider';

// PC 이미지 그리드 머리줄 아이콘 버튼의 아래 이름(2026-11-18 버튼 이름 표시) — 이 머리줄 버튼은 툴바 레지스트리가
// 없어 이 표가 단일 출처. 글자 버튼(이상형 월드컵·예약 추가·예약 제거·씬 편집)에는 이름을 달지 않는다.
export const GRID_HEADER_NAMES = {
  folder: '폴더',
  selectMode: '선택',
  favSelect: '즐겨찾기 선택',
  download: '다운로드',
  copy: '복사',
  paste: '붙여넣기',
  favToggle: '즐겨찾기',
  duplicate: '복제',
  copyToScene: '씬 복사',
  delete: '삭제',
  sample: '샘플 뽑기',
  bookmark: '북마크',
  viewOrder: '보기 순서',
} as const;
import {
  ContextMenuType,
  GenericScene,
  ImportableMetadata,
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
import { queueWorkflow } from '../models/TaskQueueService';
import { queueScene } from '../models/sceneQueueActions';
import { queueNaiUpscale } from '../models/workflows/NaiUpscaleFlow';
import { estimateNaiUpscaleCost } from '../backends/genVendors/naiUpscale';
import { getImageDimensions } from './BrushTool';
import { dataUriToBase64 } from '../models/ImageService';
import {
  isImageCacheInvalidationFor,
  pickInvalidatedEntries,
} from '../models/imageCacheInvalidation';
import {
  copyImagesRecorded,
  deleteImageFilesRecorded,
  restoreTrashImagesRecorded,
} from '../models/deleteUndo';
import {
  recordImageOrder,
  setImageFavorites,
  toggleImageBookmarkRecorded,
  toggleImageFavorite,
} from '../models/imageStateUndo';
import { IMAGE_RETENTION_DAYS } from '../models/TrashService';
import {
  deleteConfirmText,
  imageCopyResultText,
  imageDeleteScopeLine,
  imageRestoreResultText,
  NO_IMAGES_TO_DELETE_MESSAGE,
  NO_SELECTED_IMAGES_MESSAGE,
  planGridImageDelete,
  shouldSkipImageDeleteConfirm,
  showImageDeleteSkipOption,
} from '../models/deleteFlowRules';
import { EMPTY_TRASH_EXTRA, trashNoticeText } from './TrashViews';
import { getResultDirectory } from '../models/SessionService';
import { extractPromptDataFromBase64 } from '../models/util';
import { appState } from '../models/AppService';
import { backStackService } from '../models/BackStackService';
import { observer } from 'mobx-react-lite';
import {
  buildGridDownloadMenu,
  GRID_DOWNLOAD_TEXT,
  gridDownloadTargets,
} from '../models/gridDownloadMenu';
import { IMAGE_DOWNLOAD_TEXT, type DownloadTargetOptions } from '../models/ImageDownloadService';
import { pickFileNames } from '../models/pickedImageExport';
import GridDownloadPicker from './GridDownloadPicker';
import {
  applyImageViewOrder,
  buildImageViewOrderMenu,
  canReorderInViewOrder,
  IMAGE_VIEW_ORDER_TEXT,
  normalizeImageViewOrder,
} from '../models/imageOrderSort';
import { Session, GenericScene as GenericSceneType } from '../models/types';
import { BOOST_TEXT } from '../models/boostMode';

// ===== TrashImageView 컴포넌트 =====

interface TrashImageViewProps {
  session: Session;
  scene: GenericSceneType;
  /** 칸 크기(PC = 이미지 크기 슬라이더의 연속 값, 모바일 = S/M/L 단계 값) */
  imageSize: number;
  /** 받아 올 썸네일 크기(단계 값 200·400·500 — 끄는 동안 바뀌지 않게, models/sizeSlider imageGridThumbPx) */
  thumbSize: number;
}

const TrashImageView = ({ session, scene, imageSize, thumbSize }: TrashImageViewProps) => {
  const [trashImages, setTrashImages] = useState<
    { filename: string; deletedAt: number }[]
  >([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const thumbnailLoadGenerationRef = useRef(0);
  const thumbnailLoadPromiseRef = useRef<Promise<void> | null>(null);

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
    const generation = ++thumbnailLoadGenerationRef.current;
    const loadThumbnails = async () => {
      const newThumbs: Record<string, string> = {};
      for (const item of trashImages) {
        if (generation !== thumbnailLoadGenerationRef.current) break;
        const path = trashService.getTrashImagePath(
          session,
          scene,
          item.filename,
        );
        try {
          const thumb = await imageService.fetchImageSmall(
            path,
            isMobile ? 200 : Math.min(thumbSize, 400),
          );
          if (generation !== thumbnailLoadGenerationRef.current) break;
          if (thumb) newThumbs[item.filename] = thumb;
        } catch (e) {}
      }
      if (generation === thumbnailLoadGenerationRef.current) {
        setThumbnails(newThumbs);
      }
    };
    if (trashImages.length > 0) {
      const promise = loadThumbnails();
      thumbnailLoadPromiseRef.current = promise;
      void promise.finally(() => {
        if (thumbnailLoadPromiseRef.current === promise) {
          thumbnailLoadPromiseRef.current = null;
        }
      });
    } else {
      setThumbnails({});
    }
    return () => {
      if (thumbnailLoadGenerationRef.current === generation) {
        thumbnailLoadGenerationRef.current++;
      }
    };
  }, [trashImages, session, scene, thumbSize]);

  // 삭제/복원 전에 진행 중인 썸네일 한 장만 마치고 다음 리사이즈를 중단한다.
  // Android에서 삭제 루프와 썸네일 루프가 같은 mutex를 번갈아 잡는 현상을 방지한다.
  const stopThumbnailLoading = useCallback(async () => {
    thumbnailLoadGenerationRef.current++;
    const current = thumbnailLoadPromiseRef.current;
    if (current) {
      try {
        await current;
      } catch (e) {}
    }
  }, []);

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
    await stopThumbnailLoading();
    // 복원된 것이 있으면 되돌리기 기록(U4 — 되돌림 = 다시 휴지통으로)
    const { restored, failed } = await restoreTrashImagesRecorded(
      session,
      scene,
      Array.from(selected),
    );
    await imageService.refresh(session, scene);
    appState.pushMessage(imageRestoreResultText(restored.length, failed.length));
    // 복원하지 못한 것만 선택으로 남긴다(무엇이 남았는지 보이도록).
    setSelected(new Set(failed));
    await refresh();
  };

  const handlePermanentDelete = async () => {
    if (selected.size === 0) return;
    appState.pushDialog({
      type: 'confirm',
      ...deleteConfirmText({ kind: 'image', count: selected.size, outcome: 'permanent' }),
      callback: async () => {
        await stopThumbnailLoading();
        // 일괄 작업 잠금(2026-07-18): 저사양(특히 모바일) 보호 — finally 해제 보장
        const lockText = '이미지 영구 삭제 중...';
        appState.setProgressDialog({
          text: lockText,
          done: 0,
          total: selected.size,
        });
        let failed = 0;
        try {
          failed = await trashService.permanentlyDeleteImages(
            session,
            scene,
            Array.from(selected),
            (done, total) =>
              appState.setProgressDialog({ text: lockText, done, total }),
          );
        } finally {
          appState.setProgressDialog(undefined);
        }
        if (failed > 0) {
          appState.pushMessage(
            failed + '장의 이미지를 삭제하지 못했습니다. 잠시 후 다시 시도해주세요.',
          );
        }
        setSelected(new Set());
        await refresh();
      },
    });
  };

  const handleEmptyTrash = async () => {
    if (trashImages.length === 0) return;
    appState.pushDialog({
      type: 'confirm',
      ...deleteConfirmText({
        kind: 'image',
        count: trashImages.length,
        outcome: 'permanent',
        extra: EMPTY_TRASH_EXTRA,
      }),
      callback: async () => {
        await stopThumbnailLoading();
        // 일괄 작업 잠금(2026-07-18): 저사양(특히 모바일) 보호 — finally 해제 보장
        const lockText = '휴지통 비우는 중...';
        appState.setProgressDialog({
          text: lockText,
          done: 0,
          total: trashImages.length,
        });
        let failed = 0;
        try {
          failed = await trashService.emptyImageTrash(session, scene, (done, total) =>
            appState.setProgressDialog({ text: lockText, done, total }),
          );
        } finally {
          appState.setProgressDialog(undefined);
        }
        if (failed > 0) {
          appState.pushMessage(
            failed + '장의 이미지를 삭제하지 못했습니다. 잠시 후 다시 시도해주세요.',
          );
        }
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

  // 보존 기간 안내(2026-10-03 E1-5) — 씬·프로젝트 휴지통(TrashViews notice)과 같은 형식, 일수는 TrashService 상수
  const retentionNotice = trashNoticeText('image');

  if (trashImages.length === 0 && !loading) {
    return (
      <EmptyState size="lg" className="h-full px-4" hint={<span className="break-keep">{retentionNotice}</span>}>
        휴지통이 비어 있습니다
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-none px-2 pt-2 text-xs text-faint break-keep">{retentionNotice}</div>
      <div className="flex-none p-2 flex gap-2 flex-wrap border-b line-color">
        <button
          className={`round-button back-green`}
          onClick={handleRestore}
          disabled={selected.size === 0}
        >
          <ActionIcon id="restore" className="mr-1" />
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
          선택 영구 삭제
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
                  (isSelected ? 'card-selected' : '')
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
                  <div className="w-full h-full bg-[var(--c-surface)] flex items-center justify-center text-faint">
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
  /** 칸 크기(PC = 이미지 크기 슬라이더의 연속 값, 모바일 = S/M/L 단계 값 200·400·500) */
  imageSize: number;
  /** 받아 올 썸네일 크기 — 단계 값(models/sizeSlider imageGridThumbPx). 없으면 imageSize(모바일은 같은 값) */
  thumbSize?: number;
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
  emptyText?: string;
  emptyHint?: string;
  // 끌어서 순서 바꾸기 허용(보기 순서가 「기본 순서」일 때만 — imageOrderSort.canReorderInViewOrder). 없으면 허용.
  // 보조 키를 누른 채 끌어 다른 프로그램에 놓기(imageDragOutProps)는 이 값과 무관하게 그대로.
  reorderable?: boolean;
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
      selectMode,
      reorderable,
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
      // 늦게 도착한 이전 요청이 새 셀 내용 위에 덮어써 잔상이 남지 않도록
      // 언마운트/의존성 변경 시 진행 중 요청 결과를 버린다.
      let cancelled = false;
      // 같은 칸에서 다시 읽기가 겹치면(무효화 직후 선택 토글 등) 마지막 요청의 결과만 반영한다 —
      // 무효화 전에 시작한 요청이 늦게 와 새 썸네일을 옛 그림으로 덮지 않게(2026-11-21).
      // 다시 읽는 동안 이전 그림을 그대로 두므로 칸이 비었다 뜨지 않는다.
      let requestSeq = 0;
      // keepOnError = 무효화로 다시 읽을 때 — 파일이 막 옮겨져(WebP 변환·휴지통 이동) 읽기에 실패하면 목록이
      // 갱신될 때까지 이전 그림을 둔다(일괄 변환 중 칸이 비어 보이지 않게).
      const refreshImage = async (opts?: { keepOnError?: boolean }) => {
        const seq = ++requestSeq;
        try {
          const base64Image = await imageService.fetchImageSmall(
            path,
            imageSize,
          )!;
          if (cancelled || seq !== requestSeq) return;
          // 원본이 이미 없으면 fetchImageSmall 은 던지지 않고 null 을 준다 — 이것도 「읽기 실패」로 본다.
          if (!base64Image && opts?.keepOnError) return;
          setImage(base64Image!);
        } catch (e: any) {
          if (cancelled || seq !== requestSeq) return;
          if (opts?.keepOnError) return;
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
        cancelled = true;
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
    // imageSize = 받아 오는 썸네일 크기(PC 는 단계 값으로 올림 — models/sizeSlider imageGridThumbPx). PC 칸 크기는 그리드가 정한
    // 칸 폭(style.width = 이미지 크기 슬라이더의 연속 값)을 그대로 쓴다. 모바일은 종전 그대로(단계 값 / 2.5, 500 = 화면 폭).
    let cellSize = isMobile ? imageSize / 2.5 : (style.width as number);
    if (isMobile && imageSize === 500) {
      cellSize = style.width as number;
    }

    const { show, hideAll } = useContextMenu({
      id: ContextMenuType.GallaryImage,
    });

    const [{ isDragging }, drag, preview] = useDrag(
      () => ({
        type: 'image',
        item: { scene, path, cellSize, imageSize, index },
        // 「즐겨찾기 먼저」 등 기본 순서가 아닌 보기에서는 순서 바꾸기 끌기를 시작하지 않는다(reorderable=false).
        canDrag: () => !selectMode && reorderable !== false && index < filePaths.length,
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
      [path, imageSize, cellSize, index, selectMode, reorderable],
    );

    const [{ isOver }, drop] = useDrop(
      () => ({
        accept: 'image',
        canDrop: () => reorderable !== false && index < filePaths.length,
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
            // 되돌리기 기록(U3a): 순서 사본·순위 깊은 사본 — 되돌림은 병합 복원(그사이 생성된 이미지 유지)
            await recordImageOrder(curSession!, mscene, async () => {
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
            });
          }
        },
      }),
      [path, imageSize, index, reorderable],
    );

    useEffect(() => {
      preview(getEmptyImage(), { captureDraggingState: true });
    }, [preview]);

    return (
      <div
        key={index.toString() + path + imageSize.toString()}
        data-image-index={index}
        style={style}
        className={
          'image-cell relative hover:brightness-95 active:brightness-90 bg-[var(--c-surface)] cursor-pointer ' +
          (isDragging ? 'opacity-0 no-touch' : '') +
          (isOver ? ' card-drop-target' : '')
        }
        draggable={!selectMode}
        // PC: 보조 키(Windows Ctrl·mac Option)를 누른 채 끌면 다른 프로그램에 원본 파일로 놓기(2026-11-22).
        // 보조 키 없이 끌면 헬퍼가 아무것도 하지 않아 아래 react-dnd 순서 바꾸기가 그대로 동작한다.
        {...imageDragOutProps(path, { modifier: true })}
        onClick={() => {
          if (path) {
            if (onSelected) {
              onSelected(index);
            }
          }
        }}
        onMouseEnter={() => onCellEnter?.(index)}
        onMouseLeave={() => onCellLeave?.(index)}
        ref={(node) => drag(drop(selectMode ? null : node))}
      >
        {path && image && (
          <>
            <div data-image-content className="relative w-fit">
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
                  <ActionIcon id="bookmark" />
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
    selectMode,
    reorderable,
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
      selectMode,
      reorderable,
    };
  },
);

const ImageGallery = forwardRef<ImageGalleryRef, ImageGalleryProps>(
  (
    {
      scene,
      isHidden,
      imageSize,
      thumbSize,
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
      emptyText,
      emptyHint,
      reorderable,
    },
    ref,
  ) => {
    const { curSession } = appState;
    const [containerWidth, setContainerWidth] = useState(0);
    const [containerHeight, setContainerHeight] = useState(0);
    const refreshImageFuncs = useRef(
      new Map<string, (opts?: { keepOnError?: boolean }) => void>(),
    );
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

    // 썸네일 무효화(밖에서 고친 이미지·WebP 변환·삭제 등) → 지금 그려진 칸 중 그 경로의 칸만 다시 읽는다(2026-11-21).
    // 리스너는 그리드에 하나(칸마다 달지 않음). 등록되지 않은 경로는 Map 조회만 하고 끝나며,
    // detail 에 경로가 없으면 아무것도 하지 않는다(전체 칸 다시 읽기 없음). 경로 비교 = imageCacheInvalidation.ts.
    useEffect(() => {
      const onInvalidated = (e: Event) => {
        const refreshes = pickInvalidatedEntries(
          refreshImageFuncs.current,
          (e as CustomEvent).detail,
        );
        for (const refresh of refreshes) refresh({ keepOnError: true });
      };
      imageService.addEventListener('image-cache-invalidated', onInvalidated);
      return () => {
        imageService.removeEventListener('image-cache-invalidated', onInvalidated);
      };
    }, []);

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
    // 받아 오는 썸네일 크기 = 단계 값(PC 슬라이더를 끄는 동안 바뀌지 않음 → 칸이 다시 읽지 않는다)
    const fetchSize = thumbSize ?? imageSize;
    // preload 4 pages — 단계(200·400·500)별, 범위 밖은 양 끝 단계
    const overcountCounts = isMobile ? [4, 2, 1] : [32, 16, 8];
    const overscanTier = Math.min(
      overcountCounts.length - 1,
      Math.max(0, Math.ceil(fetchSize / 200) - 1),
    );

    // 크기 슬라이더로 칸 크기가 바뀌면(2026-11-23) 보던 자리를 지킨다 — 화면 맨 위 칸(줄 안 위치 비율 포함)이
    // 새 칸 크기에서도 맨 위에 오도록 스크롤을 옮긴다. 픽셀 스크롤 값을 그대로 두면 엉뚱한 줄로 튄다.
    const scrollTopRef = useRef(0);
    const prevGridMetricsRef = useRef<{ rowHeight: number; columnCount: number } | null>(null);
    useLayoutEffect(() => {
      const prev = prevGridMetricsRef.current;
      prevGridMetricsRef.current = { rowHeight, columnCount };
      // 모바일(S/M/L 단추)은 종전 그대로 — 손대지 않는다
      if (isMobile || !prev || prev.rowHeight === rowHeight || prev.rowHeight <= 0 || rowHeight <= 0) return;
      const top = scrollTopRef.current;
      if (top <= 0 || !gridRef.current) return;
      const firstIndex = Math.floor(top / prev.rowHeight) * prev.columnCount;
      const withinRow = (top % prev.rowHeight) / prev.rowHeight;
      const nextTop = Math.max(
        0,
        Math.round((Math.floor(firstIndex / columnCount) + withinRow) * rowHeight),
      );
      scrollTopRef.current = nextTop;
      gridRef.current.scrollTo({ scrollTop: nextTop });
    }, [rowHeight, columnCount]);

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
        if (appState.dialogs.length > 0) return; // 확인 창 위에서 즐겨찾기가 바뀌지 않게(U0-b E8)
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
        // 창 간 동기화 헬퍼(읽기 전용 미러): 소유 창 위임 + 로컬 반영 + 되돌리기 기록(U3a)
        toggleImageFavorite(curSession!, scene, filename);
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
      if (e.button !== 0 || dragBoxRef.current || isHidden) return;
      if (!canStartSelectionBox(e.target, !!selectMode, '[data-image-content]')) return;
      if (!containerRef.current) return;
      e.preventDefault();
      e.stopPropagation();
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
          const selected = containerRef.current
            ? imagePathsInSelectionBox(containerRef.current, filePaths, box)
            : [];
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
        e.preventDefault();
        e.stopPropagation();
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
        onMouseDownCapture={handleGridMouseDown}
        onClickCapture={handleGridClick}
      >
        <Grid
          ref={gridRef}
          columnCount={columnCount}
          columnWidth={columnWidth}
          height={containerHeight}
          className={'bg-[var(--c-zone)] ' + (isHidden ? 'hidden' : '')}
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
            fetchSize,
            selectedImages,
            bookmarkedImagePath,
            focusedIndex ?? null,
            onCellEnter,
            onCellLeave,
            selectMode,
            reorderable !== false,
          )}
          // 셀 키를 위치가 아닌 이미지 경로 기준으로 — 목록이 바뀌면 셀이
          // 언마운트되어 이전 이미지 state(잔상)가 재사용되지 않는다.
          itemKey={({ columnIndex, rowIndex, data }: any) => {
            const idx = rowIndex * data.columnCount + columnIndex;
            return data.filePaths[idx] ?? `empty-${rowIndex}:${columnIndex}`;
          }}
          outerElementType={CustomScrollbarsVirtualGrid}
          overscanRowCount={overcountCounts[overscanTier]}
          onScroll={({ scrollTop }: { scrollTop: number }) => {
            scrollTopRef.current = scrollTop;
          }}
        >
          {Cell}
        </Grid>
        {filePaths.length === 0 && (
          <EmptyState size="lg" className="absolute inset-0 select-none pointer-events-none" hint={emptyHint || undefined}>
            {emptyText ?? '이미지가 없습니다'}
          </EmptyState>
        )}
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
  // PC 넓은 폭 버튼 줄의 묶음·색 판정(2026-11-22, SceneQueueControl 이 채움) — 'favorite'·'inpaint'·'copy-to-original'·'variant'.
  // 모바일 V2 는 종전처럼 라벨 글자로 칸을 나누고 className 색을 쓴다(이 필드를 읽지 않음).
  id?: string;
  /** 켜짐 상태(즐겨찾기) — 라벨을 고정한 PC 버튼 줄이 색·aria-pressed 로 보인다 */
  isOn?: (path: string) => boolean;
}

// 이미지 상세 보기의 PC 넓은 폭 배치 판정(Tailwind md = 768px 과 같은 기준, 플랫폼이 아니라 폭)
const DETAIL_WIDE_QUERY = '(min-width: 768px)';
function useDetailWide(): boolean {
  const get = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(DETAIL_WIDE_QUERY).matches
      : false;
  const [wide, setWide] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(DETAIL_WIDE_QUERY);
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return wide;
}
// 이미지 정보 여닫힘(2026-11-23 사용자 결정) — 앱 전체 하나로 기억(appState.imageDetailInfoOpen, localStorage), 기본 접힘.
// PC 넓은 폭·좁은 폭 클래식·모바일 V2 가 같은 값을 쓴다(종전 useState(false) — 매번 접힘으로 시작하던 것을 대신함).
function useImageDetailInfoOpen(): [boolean, (open: boolean) => void] {
  return [appState.imageDetailInfoOpen, (open: boolean) => appState.setImageDetailInfoOpen(open)];
}
/** 처음 연 이미지의 크기를 알기 전 이미지 칸 비율(가로/세로) — 흔한 세로 832×1216 */
const DETAIL_FALLBACK_RATIO = 832 / 1216;

interface ResultDetailViewProps {
  scene: GenericScene;
  getPaths: () => string[];
  initialSelectedIndex: number;
  buttons: ResultDetailViewButton[];
  onClose: () => void;
}
// 모바일 V2 이미지 그리드 하단 줄 높이(V2MainRow 46px 칸 + 위 3px·아래 2px 여백 + 위 테두리 1px) — S/M/L 을 이 위로 올린다
const V2_GALLERY_BAR_PX = 52;

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
    const [imageLoadFailed, setImageLoadFailed] = useState(false);
    const [upscalePreparing, setUpscalePreparing] = useState(false);
    const [upscaleInfo, setUpscaleInfo] = useState<{ path: string; cost?: number; error?: string }>();
    // 보고 있는 이미지 파일의 실제 픽셀 크기(상세 정보 「해상도」) — 불러오기 effect 의 getImageDimensions 값
    const [imageSize, setImageSize] = useState<{ path: string; width: number; height: number }>();
    const [imageRetryRevision, setImageRetryRevision] = useState(0);
    const watchedImages = useRef(new Set<string>());
    // 모바일 좌우 스와이프로 이미지 전환. 시작 좌표를 저장해 끝점과 비교한다.
    const touchStart = useRef<{ x: number; y: number } | null>(null);
    // 정보 칸 원료(2026-11-22 개편): 읽어 낸 job 한 벌 + 파일 사실(바이트 수·형식). 참조 이미지 base64 는 job 안 한 벌뿐 —
    // 다른 상태로 복사하지 않는다. 다음 이미지를 다 읽을 때까지 직전 값을 그대로 둔다(예전 문자열 상태와 같은 동작).
    const [meta, setMeta] = useState<{
      path: string;
      job?: ImportableMetadata;
      bytes?: number;
      format?: string;
      failed?: boolean;
    }>();
    const [_, forceUpdate] = useState<{}>({});
    // 이미지 불러오기는 보고 있는 경로(문자열)와 다시 시도 번호에만 묶는다 — 생성 중 'updated' 로
    // 목록 배열만 새로 만들어지면 같은 이미지를 다시 읽고 비우지 않는다(2026-11-21).
    const currentImagePath = paths[selectedIndex];
    // 요청 번호: 최신 요청이 아니면(다른 이미지로 넘어감·겹친 재요청·정리됨) 상태를 건드리지 않는다.
    const imageRequestRef = useRef(0);
    useEffect(() => {
      const imagePath = currentImagePath;
      if (!imagePath) return;
      const fetchImage = async () => {
        const requestId = ++imageRequestRef.current;
        const isStale = () => imageRequestRef.current !== requestId;
        setImage(undefined);
        setImageLoadFailed(false);
        setUpscaleInfo(undefined);
        setImageSize(undefined);
        try {
          let base64Image = await imageService.fetchImage(imagePath);
          if (isStale()) return;
          if (!base64Image) {
            throw new Error('이미지 파일을 찾을 수 없습니다.');
          }
          setImage(base64Image!);
          base64Image = dataUriToBase64(base64Image!);
          const upscalePath = imagePath;
          void getImageDimensions(base64Image).then(({ width, height }) => {
            if (isStale()) return;
            // 해상도 칸(시드 옆)도 같은 측정값을 쓴다 — 경로를 함께 담아 넘긴 뒤 이전 값이 남지 않게
            setImageSize({ path: upscalePath, width, height });
            const cost = estimateNaiUpscaleCost(width, height);
            setUpscaleInfo({ path: upscalePath, cost });
          }).catch((e) => {
            if (isStale()) return;
            setUpscaleInfo({ path: upscalePath, error: e?.message ?? '이미지 확인 실패' });
          });
          // 파일 사실 — 이미 읽은 base64 로 싸게(전용 stat API 없음): 바이트 수·실제 형식(머리 바이트)
          const fileFacts = {
            path: imagePath,
            bytes: base64ByteLength(base64Image),
            format: imageExtFromBase64(base64Image),
          };
          try {
            const job = await extractPromptDataFromBase64(base64Image);
            if (isStale()) return;
            setMeta({ ...fileFacts, job: job ?? undefined });
          } catch (e: any) {
            if (isStale()) return;
            setMeta(fileFacts);
          }
          setFilename(imagePath.split('/').pop()!);
        } catch (e: any) {
          if (isStale()) return;
          console.log(e);
          setImage(undefined);
          setImageLoadFailed(true);
          setMeta({ path: imagePath, failed: true });
          setFilename('');
        }
      };
      // 캐시 무효화는 보고 있는 이미지 것일 때만 다시 읽는다(detail 없으면 안전하게 다시 읽음).
      const onImageInvalidated = (e: Event) => {
        if (
          !isImageCacheInvalidationFor(
            (e as CustomEvent).detail,
            imagePath,
          )
        )
          return;
        void fetchImage();
      };
      void fetchImage();
      imageService.addEventListener('image-cache-invalidated', onImageInvalidated);
      return () => {
        imageRequestRef.current++;
        imageService.removeEventListener('image-cache-invalidated', onImageInvalidated);
      };
    }, [currentImagePath, imageRetryRevision]);
    useEffect(() => {
      const rerender = () => {
        forceUpdate({});
      };
      // 목록이 줄어드는 사이 경로가 비면 직전 파일 이름을 유지한다(refreshPaths 가 새 위치를 찾는 기준).
      const currentFilename = paths[selectedIndex]?.split('/').pop();
      if (currentFilename) filenameRef.current = currentFilename;
      const handleKeyDown = async (e: KeyboardEvent) => {
        // 입력 칸 포커스 중엔 전부, 확인 창이 열려 있으면 Delete/Backspace 무시(2026-11-01 U0-b E7)
        if (
          shouldIgnoreViewerRawKey(e.key, {
            inputFocused: isTextEntryFocused(),
            dialogOpen: appState.dialogs.length > 0,
          })
        )
          return;
        if (e.key === 'ArrowLeft') {
          setSelectedIndex((selectedIndex - 1 + paths.length) % paths.length);
        } else if (e.key === 'ArrowRight') {
          setSelectedIndex((selectedIndex + 1) % paths.length);
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
          const doDel = async () => {
            await deleteImageFilesRecorded(curSession!, [paths[selectedIndex]], scene);
          };
          if (shouldSkipImageDeleteConfirm(appState.skipImageDeleteConfirm, 1)) {
            await doDel();
            return;
          }
          appState.pushDialog({
            type: 'confirm',
            ...deleteConfirmText({ kind: 'image', outcome: { trashDays: IMAGE_RETENTION_DAYS } }),
            showSkipConfirm: showImageDeleteSkipOption(1),
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
            await deleteImageFilesRecorded(curSession!, [paths[selectedIndex]], scene);
          };
          if (shouldSkipImageDeleteConfirm(appState.skipImageDeleteConfirm, 1)) {
            await doDel();
            return;
          }
          appState.pushDialog({
            type: 'confirm',
            ...deleteConfirmText({ kind: 'image', outcome: { trashDays: IMAGE_RETENTION_DAYS } }),
            showSkipConfirm: showImageDeleteSkipOption(1),
            callback: doDel,
          });
        } else if (action === 'toggle-favorite') {
          const path = paths[selectedIndex].split('/').pop()!;
          toggleImageFavorite(curSession!, scene, path);
        } else if (action === 'toggle-bookmark') {
          const filename = paths[selectedIndex]?.split('/').pop();
          if (filename) {
            void toggleImageBookmarkRecorded(curSession!, scene, filename);
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
      gameService.addEventListener('updated', refreshPaths);
      return () => {
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('shortcut-action', handleShortcut);
        sessionService.removeEventListener('main-image-updated', rerender);
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

    const [showPrompt, setShowPrompt] = useImageDetailInfoOpen();
    // 모바일 V2(2026-09-26): 넓은 버튼 묶음 대신 이미지 아래 [자세한 정보 손잡이][하단 6칸 줄]. 클래식·PC 마크업은 불변.
    const v2 = isV2('grid');
    const [v2More, setV2More] = useState(false);
    // PC 넓은 폭 배치(2026-11-22 개편): 머리줄(씬 이름·n/전체·순위·←→) + 버튼 줄 + [프롬프트 열 | (펼침) 상세 열 | 이미지 영역](2026-11-23). 좁은 폭·V2 는 종전 배치.
    const isWide = useDetailWide();
    const wideLayout = !v2 && isWide;
    const headerSlotEl = useFloatViewHeaderSlot();
    const [bodyEl, setBodyEl] = useState<HTMLDivElement | null>(null);
    const [bodySize, setBodySize] = useState({ width: 0, height: 0 });
    useEffect(() => {
      if (!bodyEl) return undefined;
      const ro = new ResizeObserver((entries) => {
        const r = entries[0]?.contentRect;
        if (r) setBodySize({ width: r.width, height: r.height });
      });
      ro.observe(bodyEl);
      return () => ro.disconnect();
    }, [bodyEl]);
    // 이미지 칸 비율(가로/세로) — 새 이미지의 크기를 알 때까지 직전 값을 유지해 넘길 때 칸 폭이 출렁이지 않게 한다.
    const [displayRatio, setDisplayRatio] = useState<number>();
    useEffect(() => {
      if (imageSize && imageSize.path === currentImagePath && imageSize.height > 0) {
        setDisplayRatio(imageSize.width / imageSize.height);
      }
    }, [imageSize, currentImagePath]);
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

    // 버튼 동작(클래식 넓은 버튼과 V2 하단 줄이 공유)
    const actDownloadFile = async () => {
      if (isMobile) {
        await backend.copyToDownloads(paths[selectedIndex]);
      } else {
        await backend.showFile(paths[selectedIndex]);
      }
    };
    const actDeleteFile = () => {
      const doDel = async () => {
        await deleteImageFilesRecorded(curSession!, [paths[selectedIndex]], scene);
      };
      if (shouldSkipImageDeleteConfirm(appState.skipImageDeleteConfirm, 1)) {
        doDel();
        return;
      }
      appState.pushDialog({
        type: 'confirm',
        ...deleteConfirmText({ kind: 'image', outcome: { trashDays: IMAGE_RETENTION_DAYS } }),
        showSkipConfirm: showImageDeleteSkipOption(1),
        callback: doDel,
      });
    };
    const actToggleBookmark = () => {
      if (currentFilename) {
        void toggleImageBookmarkRecorded(curSession!, scene, currentFilename);
      }
    };
    const actCopyImage = () => {
      appState.copyImagesToClipboard([paths[selectedIndex]]);
    };
    const actLoadSettings = () => {
      if (!image) return;
      appState.openExternalImage(dataUriToBase64(image), scene);
    };
    const upscaleTitle = upscaleInfo?.error ?? '가로·세로 2배 · 원본 유지 · Anlas 사용';
    const upscaleDisabled =
      upscalePreparing || upscaleInfo?.path !== paths[selectedIndex] || !upscaleInfo?.cost;
    const upscaleLabel = upscalePreparing
      ? '예약 중…'
      : `업스케일 ×2 · ${upscaleInfo?.path === paths[selectedIndex] && upscaleInfo.cost ? `${upscaleInfo.cost} Anlas` : upscaleInfo?.error ? '미지원' : '…'}`;
    // PC 넓은 폭 버튼 줄(2026-11-22 사용자): 버튼 글자에서 Anlas 숫자를 빼고 툴팁으로 옮긴다(줄 폭을 아이콘에 씀).
    const upscaleCost =
      upscaleInfo?.path === paths[selectedIndex] && upscaleInfo.cost ? upscaleInfo.cost : undefined;
    const upscaleWideLabel = upscalePreparing ? '예약 중…' : upscaleInfo?.error ? '업스케일 미지원' : '업스케일 ×2';
    const upscaleWideTitle =
      upscaleInfo?.error ??
      (upscaleCost !== undefined
        ? `가로·세로 2배 · 원본 유지 · ${upscaleCost} Anlas 사용`
        : upscaleTitle);
    const actUpscale = async () => {
      const path = paths[selectedIndex];
      const session = curSession;
      if (!path || !session || upscalePreparing) return;
      setUpscalePreparing(true);
      try {
        const source = await imageService.fetchImage(path);
        if (!source) throw new Error('원본 이미지를 읽지 못했습니다.');
        await queueNaiUpscale(session, scene, dataUriToBase64(source));
      } catch (e: any) {
        appState.pushMessage(e?.message ?? 'NAI 업스케일을 예약하지 못했습니다.');
      } finally {
        setUpscalePreparing(false);
      }
    };
    const pluginLabel = (b: any) =>
      String(typeof b.text === 'function' ? b.text(paths[selectedIndex]) : b.text);
    const runPlugin = (b: any) => b.onClick(scene, paths[selectedIndex], onClose);

    // 「이미지 편집」(PC) — 넓은 폭 버튼 줄·좁은 폭 버튼 벽 공용
    const actEditImage = async () => {
      const editPath = paths[selectedIndex];
      // 열기 실패(사용자 지정 실행 파일 없음 등)는 알림 한 줄, 감시는 시작하지 않는다(2026-11-22)
      try {
        await backend.openImageEditor(editPath);
      } catch (e: any) {
        appState.pushMessage(e?.message || '이미지 편집기를 열지 못했습니다.', 'error');
        return;
      }
      watchedImages.current.add(editPath);
      backend.watchImage(editPath);
    };
    // 「다운로드」(PC) — 파일명 규칙 저장(단축키 save-image 와 같은 경로)
    const actSaveImage = async () => {
      await imageDownloadService.downloadSingleImage(
        curSession!,
        scene,
        paths[selectedIndex],
        appState.getAppliedCharacterPreset(),
      );
    };
    const goPrev = () => setSelectedIndex((selectedIndex - 1 + paths.length) % paths.length);
    const goNext = () => setSelectedIndex((selectedIndex + 1) % paths.length);

    // 넘겨받은 버튼(SceneQueueControl) — PC 줄·좁은 폭 벽은 id 로 묶음·색을 정한다. 넘겨받은 className 색은 V2 만 쓴다.
    // 색 원칙(그리드 머리 줄과 같음): 회색 기본, 즐겨찾기는 켜졌을 때만 노랑(+toggle-on·aria-pressed), 다운로드 초록·삭제 빨강.
    const pluginOn = (b: ResultDetailViewButton) => !!b.isOn?.(paths[selectedIndex]);
    const pluginTone = (b: ResultDetailViewButton) =>
      b.id === 'favorite' ? (pluginOn(b) ? 'back-yellow toggle-on' : 'back-gray') : 'back-gray';
    const KNOWN_PLUGIN_IDS = ['favorite', 'inpaint', 'variant', 'copy-to-original'];
    const pluginsOf = (id: string) => buttons.filter((b) => b.id === id);
    const pluginOthers = buttons.filter((b) => !b.id || !KNOWN_PLUGIN_IDS.includes(b.id));

    // 정보 칸 내용(PC·좁은 폭·V2 공용, models/imageDetailInfo) — 다음 이미지를 다 읽을 때까지 직전 값을 보인다
    const metaFilename = meta ? meta.path.split('/').pop() ?? '' : '';
    const detailInfo = meta
      ? buildImageDetailInfo(meta.job, {
          filename: metaFilename,
          pixel: imageSize && imageSize.path === meta.path ? imageSize : undefined,
          format: meta.format,
          bytes: meta.bytes,
          account: scene.imageAccounts?.[metaFilename],
          accountLabel: BOOST_TEXT.accountLabel,
          sourceScene: scene.type === 'inpaint' ? (scene as any).sceneRef : undefined,
          workflowTitle: (t) => workFlowService.getDef(t)?.title,
        })
      : undefined;
    // part: 'all' = 한 열 전부(좁은 폭·V2·PC 합침), 'prompt'/'detail' = PC 넓은 폭의 프롬프트 열/상세 열
    const renderInfo = (part: ImageDetailInfoPart) =>
      detailInfo ? (
        <ImageDetailInfo
          info={detailInfo}
          job={meta?.job}
          part={part}
          loadFailed={meta?.failed}
        />
      ) : null;

    // 모바일 V2 하단 6칸 줄(2026-09-26 사용자 결정): 다운로드·삭제·설정 불러오기·즐겨찾기·인페인트+더보기.
    // 즐겨찾기·인페인트는 SceneQueueControl 이 넘기는 plugin 버튼(text 로 식별), 나머지 plugin 은 더보기로.
    const favBtn = v2 ? buttons.find((b: any) => /즐겨찾기/.test(pluginLabel(b))) : undefined;
    const inpaintBtn = v2 ? buttons.find((b: any) => /인페인/.test(pluginLabel(b))) : undefined;
    const otherBtns = v2 ? buttons.filter((b: any) => b !== favBtn && b !== inpaintBtn) : [];
    const detailSlots: V2SlotDef[] = v2
      ? [
          { key: 'download', name: '다운로드', icon: <ActionIcon id="download" />, onTap: () => void actDownloadFile() },
          { key: 'delete', name: '삭제', icon: <ActionIcon id="delete" />, tone: 'danger', onTap: actDeleteFile },
          { key: 'settings', name: '설정 적용', icon: <ActionIcon id="gen-settings" />, onTap: actLoadSettings, disabled: !image },
          {
            key: 'fav',
            name: '즐겨찾기',
            icon: <ActionIcon id="favorite" />,
            tone: favBtn && /해제/.test(pluginLabel(favBtn)) ? 'accent' : 'default',
            onTap: () => favBtn && runPlugin(favBtn),
            disabled: !favBtn,
          },
          {
            key: 'inpaint',
            name: '인페인트',
            icon: <ActionIcon id="inpaint" />,
            onTap: () => inpaintBtn && runPlugin(inpaintBtn),
            disabled: !inpaintBtn,
          },
          { key: 'more', name: '더보기', icon: <ActionIcon id="more" />, onTap: () => setV2More((v) => !v), expanded: v2More },
        ]
      : [];
    const detailTier: V2TierItem[] = v2
      ? [
          {
            id: 'bookmark',
            label: isImageBm ? '북마크 해제' : '북마크',
            node: (
              <button className={`round-button ${isImageBm ? 'back-orange' : 'back-gray'}`} onClick={actToggleBookmark} aria-label={isImageBm ? '북마크 해제' : '북마크'}>
                <ActionIcon id="bookmark" />
              </button>
            ),
          },
          {
            id: 'copy',
            label: '복사',
            node: (
              <button className="round-button back-sky" onClick={actCopyImage} aria-label="복사">
                <ActionIcon id="copy" />
              </button>
            ),
          },
          {
            id: 'upscale',
            label: '업스케일',
            node: (
              <button className="round-button back-sky" title={upscaleTitle} disabled={upscaleDisabled} onClick={actUpscale}>
                <FaSearchPlus />
              </button>
            ),
          },
          ...otherBtns.map((b: any, i: number) => ({
            id: `plugin-${i}`,
            label: pluginLabel(b),
            node: (
              <button className={`round-button ${b.className}`} onClick={() => runPlugin(b)} aria-label={pluginLabel(b)}>
                <FaExchangeAlt />
              </button>
            ),
          })),
        ]
      : [];

    // PC 넓은 폭 열 폭(2026-11-23) — [프롬프트 열(항상, 같은 폭) | 상세 열(펼침에서만) | 이미지 영역(남는 폭)].
    // 이미지는 이미지 영역 × 본문 높이 안에서 비율대로 맞춰(fitFrame 재사용) 영역 가운데에 놓는다.
    const wideCols = detailWideColumns(bodySize.width, showPrompt);
    const imageFit = wideLayout
      ? fitFrame(wideCols.image, bodySize.height, displayRatio ?? DETAIL_FALLBACK_RATIO)
      : undefined;
    // 이미지 요소 하나(넓은 폭·좁은 폭·V2 공용) — 우클릭 메뉴·끌어서 밖으로 놓기·불러오는 중·실패 표시 그대로.
    // 넓은 폭은 그려진 크기 그대로의 상자라 체크무늬가 이미지 뒤에만 깔린다(바깥은 화면 바탕).
    const imageContent = image ? (
      <img
        src={image}
        draggable={false}
        // PC: 끌어서 다른 프로그램에 원본 파일로 놓기(2026-11-22, 모바일은 속성 없음)
        {...imageDragOutProps(paths[selectedIndex])}
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
        onLoad={(e) => {
          const el = e.currentTarget;
          if (el.naturalWidth > 0 && el.naturalHeight > 0) {
            setDisplayRatio(el.naturalWidth / el.naturalHeight);
          }
        }}
        className={imageFit ? 'block flex-none object-contain bg-checkboard' : 'w-full h-full object-contain bg-checkboard'}
        style={imageFit ? { width: imageFit.width, height: imageFit.height } : undefined}
      />
    ) : imageLoadFailed ? (
      <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-muted">
        <span>이미지를 불러오지 못했습니다.</span>
        <button
          className="round-button back-sky"
          onClick={async () => {
            const path = paths[selectedIndex];
            if (path) {
              await imageService.invalidateCache(path).catch(() => {});
            }
            await imageService.refresh(curSession!, scene).catch(() => {});
            setImageRetryRevision((v) => v + 1);
          }}
        >
          다시 시도
        </button>
      </div>
    ) : (
      // 이미지 전환/로딩 중 빈 화면 깜빡임 대신 로딩 표시(부팅 스피너와 동일 스타일).
      <div className="w-full h-full flex items-center justify-center">
        <Spinner />
      </div>
    );
    // 좌우 스와이프로 이미지를 넘기는 영역 — 가장자리 드로어 스와이프에 양보받는다(edgeSwipe.ts).
    const swipeProps = {
      'data-edge-swipe-ignore': '',
      onTouchStart: (e: React.TouchEvent) => {
        if (e.touches.length !== 1) {
          touchStart.current = null;
          return;
        }
        touchStart.current = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
        };
      },
      onTouchEnd: (e: React.TouchEvent) => {
        const start = touchStart.current;
        touchStart.current = null;
        if (!start || paths.length < 2) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - start.x;
        const dy = t.clientY - start.y;
        // 명확한 가로 스와이프만 처리(세로 스크롤/핀치와 충돌 방지):
        // 이동 50px 이상 + 가로가 세로보다 우세할 때.
        if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        if (dx < 0) goNext();
        else goPrev();
      },
    };

    if (wideLayout) {
      const rank = detailRankOf(scene.game, currentFilename ?? '');
      // FloatView 머리줄(✕ 오른쪽)에 그려 넣는 내용 — 씬 이름 · n / 전체 · 순위, 오른쪽 끝 이전/다음
      const headerContent = (
        <div className="flex items-center gap-3 w-full min-w-0 pr-2" data-detail-header="">
          <span className="min-w-0 truncate font-semibold text-default" title={scene.name}>
            {scene.name}
          </span>
          <span className="flex-none text-sub tabular-nums">
            {selectedIndex + 1} / {paths.length}
          </span>
          {rank !== undefined && (
            <span className="flex-none text-sub" data-detail-rank="">
              순위 {rank}등
            </span>
          )}
          <div className="ml-auto flex-none flex gap-2">
            <button className="round-button icon-only back-gray" onClick={goPrev} aria-label="이전 이미지" title="이전 이미지">
              <FaArrowLeft />
            </button>
            <button className="round-button icon-only back-gray" onClick={goNext} aria-label="다음 이미지" title="다음 이미지">
              <FaArrowRight />
            </button>
          </div>
        </div>
      );
      const groupSep = <span aria-hidden="true" className="self-stretch w-px my-1 bg-[var(--c-line)]" />;
      // 버튼마다 앞에 참고 아이콘(2026-11-22 사용자 「가시성」) — 사전(ActionIcon) 우선, 없으면 같은 기능에 이미 쓰는 아이콘
      // (업스케일 = 우클릭 메뉴의 FaSearchPlus, 파일 위치 = FaFolderOpen, 이미지 변형 = V2 줄의 FaExchangeAlt,
      // 원본 씬으로 이미지 복사 = 되돌려 보내는 화살표 FaReply).
      const pluginIcon = (b: ResultDetailViewButton) =>
        b.id === 'inpaint' ? (
          <ActionIcon id="inpaint" className="mr-1" />
        ) : b.id === 'variant' ? (
          <FaExchangeAlt className="mr-1" />
        ) : b.id === 'copy-to-original' ? (
          <FaReply className="mr-1" />
        ) : null;
      const pluginBtn = (b: ResultDetailViewButton, i: number) => (
        <button
          key={`${b.id ?? 'plugin'}-${i}`}
          className={`round-button ${pluginTone(b)}`}
          onClick={() => runPlugin(b)}
        >
          {pluginIcon(b)}
          {pluginLabel(b)}
        </button>
      );
      return (
        <div className="z-10 bg-[var(--c-surface)] w-full h-full flex flex-col overflow-hidden" data-detail-layout="wide">
          {headerSlotEl ? (
            createPortal(headerContent, headerSlotEl)
          ) : (
            <div className="flex-none px-3 py-1 border-b line-color">{headerContent}</div>
          )}
          {/* 버튼 줄 = 세 묶음(구분선·묶음 이름). 좁아지면 줄 바뀜. 동작·조건·확인 창은 좁은 폭 버튼 벽과 같은 act* */}
          <div className="flex-none flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 border-b line-color" data-detail-buttons="">
            <div className="flex flex-wrap items-center gap-2" data-detail-button-group="image">
              {pluginsOf('favorite').map((b, i) => (
                <button
                  key={`favorite-${i}`}
                  className={`round-button ${pluginTone(b)}`}
                  aria-pressed={pluginOn(b)}
                  onClick={() => runPlugin(b)}
                >
                  <ActionIcon id="favorite" className="mr-1" />
                  즐겨찾기
                </button>
              ))}
              <button
                className={`round-button ${isImageBm ? 'back-orange' : 'back-gray'}`}
                onClick={actToggleBookmark}
              >
                <ActionIcon id="bookmark" className="mr-1" />
                {isImageBm ? '북마크 해제' : '북마크'}
              </button>
              {!isMobile ? (
                <button className="round-button back-green" onClick={actSaveImage}>
                  <FaDownload className="mr-1" />
                  다운로드
                </button>
              ) : (
                <button className="round-button back-green" onClick={actDownloadFile}>
                  <FaDownload className="mr-1" />
                  파일 다운로드
                </button>
              )}
              <button className="round-button back-red" onClick={actDeleteFile}>
                <ActionIcon id="delete" className="mr-1" />
                삭제
              </button>
            </div>
            {groupSep}
            <div className="flex flex-wrap items-center gap-2" data-detail-button-group="use">
              <span className="text-xs text-faint">이 이미지로</span>
              {pluginsOf('inpaint').map(pluginBtn)}
              {pluginsOf('variant').map(pluginBtn)}
              <button
                className="round-button back-gray"
                title={upscaleWideTitle}
                disabled={upscaleDisabled}
                onClick={actUpscale}
                data-detail-upscale=""
              >
                <FaSearchPlus className="mr-1" />
                {upscaleWideLabel}
              </button>
              <button className="round-button back-gray" onClick={actLoadSettings}>
                <ActionIcon id="gen-settings" className="mr-1" />
                생성 설정 적용
              </button>
              {pluginsOf('copy-to-original').map(pluginBtn)}
              {pluginOthers.map(pluginBtn)}
            </div>
            {groupSep}
            <div className="flex flex-wrap items-center gap-2" data-detail-button-group="file">
              <span className="text-xs text-faint">파일</span>
              {!isMobile && (
                <button className="round-button back-gray" onClick={actDownloadFile}>
                  <FaFolderOpen className="mr-1" />
                  파일 위치 열기
                </button>
              )}
              {!isMobile && (
                <button className="round-button back-gray" onClick={actEditImage}>
                  <ActionIcon id="edit" className="mr-1" />
                  이미지 편집
                </button>
              )}
              <button className="round-button back-gray" onClick={actCopyImage}>
                <ActionIcon id="copy" className="mr-1" />
                이미지 복사
              </button>
            </div>
          </div>
          {/* 본문 = 접힘 [프롬프트 열 | 이미지 영역] / 펼침 [프롬프트 열 | 상세 열 | 이미지 영역]. 열은 고정 폭·열 안만 세로 스크롤,
              이미지 영역은 남는 폭 전부(이미지는 가운데). 본문이 좁아 합치면 상세 묶음을 프롬프트 열에 이어 붙인다(한 열). */}
          <div ref={setBodyEl} className="flex-1 min-h-0 flex" data-detail-info-open={showPrompt ? 'true' : 'false'}>
            <div
              className="flex-none min-w-0 flex flex-col border-r line-color"
              style={{ width: wideCols.prompt }}
              data-detail-info-pane=""
            >
              {/* 열 머리(스크롤 밖 고정): 「상세 정보」 여닫기 — 정보를 읽는 자리(왼쪽 열) 바로 위에 둔다(2026-11-23 사용자:
                  머리 줄 오른쪽 끝에 있으면 왼쪽 정보에 시선이 끌려 못 볼 위험). 버튼은 열의 오른쪽 가장자리 = 상세 열이
                  펼쳐지는 경계. 이름은 두 상태에서 같고 상태는 색 + aria-pressed + 화살표 방향(› 펼치기 / ‹ 접기). */}
              <div className="flex-none flex items-center gap-2 px-4 pt-3 pb-1" data-detail-info-head="">
                <span className="min-w-0 truncate text-sm font-semibold gray-label">이미지 정보</span>
                <button
                  className={`ml-auto flex-none round-button h-7 px-3 text-sm ${showPrompt ? 'back-sky toggle-on' : 'back-gray'}`}
                  onClick={() => setShowPrompt(!showPrompt)}
                  aria-pressed={showPrompt}
                  aria-label={IMAGE_DETAIL_INFO_TEXT.wideToggle}
                  title={IMAGE_DETAIL_INFO_TEXT.wideToggle}
                  data-detail-info-toggle=""
                >
                  <FaInfoCircle className="mr-1" />
                  {IMAGE_DETAIL_INFO_TEXT.wideToggle}
                  {showPrompt ? <FaChevronLeft className="ml-1" size={11} /> : <FaChevronRight className="ml-1" size={11} />}
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 pt-2">
                {renderInfo(wideCols.merged ? 'all' : 'prompt')}
              </div>
            </div>
            {wideCols.side > 0 && (
              <div
                className="flex-none min-w-0 overflow-y-auto p-4 border-r line-color"
                style={{ width: wideCols.side }}
                data-detail-side-pane=""
              >
                {renderInfo('detail')}
              </div>
            )}
            <div
              className="flex-1 min-w-0 h-full flex items-center justify-center overflow-hidden"
              data-detail-image-pane=""
              {...swipeProps}
            >
              {imageContent}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="z-10 bg-[var(--c-surface)] w-full h-full flex overflow-auto flex-col md:flex-row">
        {!v2 && (
        <div className="flex-none md:w-1/3 p-2 md:p-4 overflow-y-auto">
          {/* 좁은 폭 버튼 벽 — 자리·순서·라벨 그대로, 색만 그리드 머리 줄 원칙(회색 기본·다운로드 초록·삭제 빨강·즐겨찾기 켜짐 노랑) */}
          <div className="flex gap-2 md:gap-3 mb-2 md:mb-6 flex-wrap w-full">
            {!isMobile && (
              <button
                className={`round-button back-green`}
                onClick={actSaveImage}
              >
                <FaDownload className="mr-1" />
                다운로드
              </button>
            )}
            <button
              className={`round-button back-gray`}
              onClick={actDownloadFile}
            >
              {!isMobile ? '파일 위치 열기' : '파일 다운로드'}
            </button>
            {!isMobile && (
              <button
                className={`round-button back-gray`}
                onClick={actEditImage}
              >
                이미지 편집
              </button>
            )}
            <button
              className={`round-button back-red`}
              onClick={actDeleteFile}
            >
              파일 삭제
            </button>
            <button
              className={`round-button ${isImageBm ? 'back-orange' : 'back-gray'}`}
              onClick={actToggleBookmark}
            >
              <ActionIcon id="bookmark" className="mr-1" />
              {isImageBm ? '북마크 해제' : '북마크'}
            </button>
            <button
              className={`round-button back-gray`}
              onClick={actCopyImage}
            >
              <ActionIcon id="copy" className="mr-1" />
              이미지 복사
            </button>
            <button
              className="round-button back-gray"
              onClick={actLoadSettings}
            >
              생성 설정 적용
            </button>
            <button
              className="round-button back-gray"
              title={upscaleTitle}
              disabled={upscaleDisabled}
              onClick={actUpscale}
            >
              {upscaleLabel}
            </button>
            {buttons.map((button, index) => (
              <button
                key={index}
                className={`round-button ${pluginTone(button)}`}
                aria-pressed={button.id === 'favorite' ? pluginOn(button) : undefined}
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
            {renderInfo('all')}
          </div>
        </div>
        )}
        <div
          className={v2 ? 'flex-1 overflow-auto relative min-h-0' : 'flex-1 overflow-auto'}
          {...swipeProps}
        >
          {imageContent}
          <div className={'absolute bottom-0 md:bottom-auto right-0 md:top-10 flex gap-3 p-4 w-full md:w-auto' + (v2 ? ' opacity-60' : '')}>
            <button
              className={`round-button icon-only  ml-0 md:ml-auto h-10 md:h-8 w-20 md:w-auto bg-[var(--c-input-bg)] text-body mr-auto md:mr-0 text-xl md:text-base`}
              onClick={goPrev}
              aria-label="이전 이미지"
            >
              <FaArrowLeft />
            </button>
            <button
              className={`round-button icon-only h-10 md:h-8 w-20 md:w-auto bg-[var(--c-input-bg)] text-xl text-body md:text-base`}
              onClick={goNext}
              aria-label="다음 이미지"
            >
              <FaArrowRight />
            </button>
          </div>
        </div>
        {v2 && (
          <>
            {/* 자세한 정보 = 이미지 아래 손잡이(프롬프트 시트와 같은 언어). 탭하면 아래로 정보가 펼쳐지고 이미지가 줄어든다. */}
            <div
              role="button"
              aria-label={showPrompt ? '자세한 정보 접기' : '자세한 정보 펼치기'}
              aria-expanded={showPrompt}
              data-v2-detail-info-handle=""
              // 되돌리기 버튼 바(UndoRedoBar) 호스트(설계 E, 2026-11-04): 펼친 동안만 — 바가 아래 메인 줄 대신 이 손잡이 위
              // 모서리 바깥에 붙어 펼친 정보를 덮지 않는다. 접히면 표식·자리가 빠져 메인 줄로 돌아간다.
              {...(showPrompt ? { [UNDO_ANCHOR_ATTR]: '' } : null)}
              className="relative flex-none select-none cursor-pointer px-3 pt-1.5 border-t line-color bg-[var(--c-zone)]"
              style={{ height: V2_SHEET_PEEK_PX }}
              onClick={() => setShowPrompt(!showPrompt)}
            >
              {showPrompt && <UndoBarSlot tone="sheet" />}
              <div className="mx-auto mb-1.5 h-1 w-9 rounded-full bg-[var(--c-line)]" />
              <div className="flex items-center justify-center gap-1.5 text-[12px] text-sub">
                <span>자세한 정보</span>
                <FaChevronUp
                  size={10}
                  className="flex-none text-faint transition-transform duration-200"
                  style={{ transform: showPrompt ? 'rotate(180deg)' : undefined }}
                />
              </div>
            </div>
            {showPrompt && (
              <div data-v2-detail-info="" className="flex-none overflow-auto px-3 py-2 bg-[var(--c-zone)] text-sm" style={{ maxHeight: '45%' }}>
                {renderInfo('all')}
              </div>
            )}
            <div className="relative flex-none" data-v2-detail-bar="">
              <V2TierRows open={v2More} onClose={() => setV2More(false)} items={detailTier} perRow={6} />
              <V2MainRow slots={detailSlots} />
            </div>
          </>
        )}
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
  // 씬 탭 이동(W1): 뷰어를 연 채 그리드 표시 순서대로 이전/다음 씬으로 전환
  sceneNav?: {
    hasPrev: boolean;
    hasNext: boolean;
    go: (delta: number) => void;
  };
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
      sceneNav,
    }: ResultViewerProps,
    ref,
  ) => {
    const { curSession, samples } = appState;
    const [_, forceUpdate] = useState<{}>({});
    const [selectMode, setSelectMode] = useState<boolean>(false);
    // 모바일 V2(2026-09-26): 머리의 액션 버튼 줄 대신 하단 5칸 줄(+더보기 둘째 줄). 클래식·PC 마크업은 불변.
    const v2 = isV2('detail');
    const [v2More, setV2More] = useState(false);
    // PC 머리줄 버튼 이름(환경설정 「버튼 이름 표시」, 기본 켬) — 머리줄이 한 줄에 다 들어갈 때만 보인다. 모바일은 없음.
    const { rowRef: headerNamesRef, mode: headerNameMode } = useButtonNameStage(
      !isMobile && !v2 && appState.uiToolbarButtonNames,
    );
    const hn = (key: keyof typeof GRID_HEADER_NAMES, node: React.ReactNode) => (
      <ButtonNameSlot name={GRID_HEADER_NAMES[key]} mode={headerNameMode}>
        {node}
      </ButtonNameSlot>
    );
    const [showImageCheatsheet, setShowImageCheatsheet] =
      useState<boolean>(false);
    const [tournament, setTournament] = useState<boolean>(false);
    const selectedImages = useRef(new Set<string>());
    const [selectedImageIndex, setSelectedImageIndex] = useState<
      number | undefined
    >(undefined);
    const gallaryRef = useRef<ImageGalleryRef>(null);
    const gallaryRef2 = useRef<ImageGalleryRef>(null);
    // 「번호로 골라서 다운로드」 창(2026-11-23) — 연 때의 그리드 순서 목록·처음 켤 경로. 열려 있는 동안 그리드 단축키는 쉰다.
    const [downloadPick, setDownloadPick] = useState<
      { paths: string[]; preselected: string[] } | undefined
    >(undefined);
    const pickerOpen = downloadPick != null;
    // 모바일 = 종전 S/M/L 단추(기억하지 않음 — 그리드를 다시 열면 M). PC = 이미지 크기 슬라이더(2026-11-23,
    // appState.imageGridSizePercent — 앱 전체 하나로 기억). 25%·50%·75% = S·M·L, 규칙은 models/sizeSlider.ts.
    const imagesSizes = [
      { name: 'S', size: 200 },
      { name: 'M', size: 400 },
      { name: 'L', size: 500 },
    ];
    const [imageSize, setImageSize] = useState<number>(1);
    // 이 컴포넌트는 observer 가 아니라 값을 자기 상태로도 들고 있는다(슬라이더가 화면 그리기마다 최대 한 번 알림)
    const [gridSizePercent, setGridSizePercent] = useState<number>(() =>
      normalizeSizePercent(appState.imageGridSizePercent),
    );
    const onGridSizePercent = (percent: number) => {
      setGridSizePercent(percent);
      appState.setImageGridSizePercent(percent);
    };
    // 칸 크기(연속 값)와 받아 올 썸네일 크기(단계 값으로 올림 — 끄는 동안 새 썸네일 파일이 생기거나 칸이 깜빡이지 않게)
    const gridCellSize = isMobile ? imagesSizes[imageSize].size : imageGridCellPx(gridSizePercent);
    const gridThumbSize = isMobile ? gridCellSize : imageGridThumbPx(gridCellSize);
    const [selectedTab, setSelectedTab] = useState<number>(0);
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

    // 보기 순서(2026-11-22, 앱 전체 하나 — appState.imageViewOrder): 표시 순서를 정하는 단 한 곳.
    // 그리드 칸(이미지·즐겨찾기 탭)·상세 보기 이전/다음(getPaths)·키보드 이동·선택·다운로드 대상 순서가 모두 이것을 쓴다.
    // 보기 설정일 뿐 — scene.imageMap·game·mains 는 읽기만 한다(되돌리기 기록 없음).
    // 「n등 이하 삭제」는 순위 기준이라 이것 대신 GameService 순서를 그대로 쓴다(onDeleteImages).
    const viewOrder = normalizeImageViewOrder(appState.imageViewOrder);
    const viewPaths = () =>
      applyImageViewOrder(
        gameService
          .getOutputs(curSession!, scene)
          .map((path) => imageService.getOutputDir(curSession!, scene) + '/' + path),
        scene.mains,
        normalizeImageViewOrder(appState.imageViewOrder),
      );
    const paths = viewPaths();
    const reorderable = canReorderInViewOrder(viewOrder);
    // 즐겨찾기 먼저 보기에서는 즐겨찾기 전환이 곧 자리 이동 — 이 컴포넌트는 observer 가 아니라 mains 변화에 다시 그린다.
    useEffect(() => {
      if (viewOrder === 'default') return undefined;
      return reaction(
        () => scene.mains.join('\n'),
        () => forceUpdate({}),
      );
    }, [viewOrder, scene]);
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

    // 이미지 선택 모드 중 Android 뒤로 가기·PC Esc = 선택 모드 종료(닫기 관문, 2026-10-03 U1·X6 — 예전엔 그리드째 닫힘)
    useEffect(() => {
      if (!selectMode) return undefined;
      const handle = backStackService.push(onClearSelection);
      return () => handle.remove();
    }, [selectMode, onClearSelection]);

    const onToggleFavoriteSelected = useCallback(() => {
      if (selectedImages.current.size === 0) return;
      // 선택 이미지 즐겨찾기 일괄 전환 — 파일마다 반전, 되돌리기는 1항목(U3a)
      setImageFavorites(
        curSession!,
        scene,
        Array.from(selectedImages.current, (p) => p.split('/').pop()!),
        'toggle',
      );
      if (gallaryRef.current) gallaryRef.current.refresh();
      if (gallaryRef2.current) gallaryRef2.current.refresh();
      sessionService.markDirty(curSession!.name);
      forceUpdate({});
    }, [scene, curSession]);

    const onDuplicateSelected = useCallback(async () => {
      if (selectedImages.current.size === 0) return;
      // 원본 확장자 보존(.png 고정이던 결함)·같은 ms 이름 충돌 없음(E9), 만든 파일만 되돌리기 기록(U4)
      const r = await copyImagesRecorded(curSession!, scene, [...selectedImages.current], 'duplicate');
      appState.pushDialog({
        type: 'yes-only',
        text: imageCopyResultText('복제', r.created.length, r.failed.length),
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

          // 원본 확장자 보존·이름 충돌 없음(E9), 만든 파일만 되돌리기 기록(U4 — 대상 씬 기준)
          const r = await copyImagesRecorded(
            curSession!,
            targetScene,
            [...selectedImages.current],
            'copy',
          );
          appState.pushDialog({
            type: 'yes-only',
            text: imageCopyResultText('복사', r.created.length, r.failed.length),
          });
        },
      });
    }, [curSession]);

    const onDeleteImages = async (scene: GenericScene) => {
      // 삭제 대상은 실행 시점에 재계산한다 — 렌더 시점 스냅샷(paths)을 쓰면
      // 다이얼로그가 떠 있는 동안 새로 생성된 이미지(표시 순서상 맨 윗줄)가
      // 삭제 목록에서 빠져 화면에 남는 간헐 버그가 있었다.
      const currentPaths = () =>
        gameService
          .getOutputs(curSession!, scene)
          .map(
            (p) => imageService.getOutputDir(curSession!, scene) + '/' + p,
          );
      // 이동 실패(파일 잠금 등)는 공용 deleteImageFiles 가 한 번 알린다(호출부에서 다시 알리지 않음, X13).
      // 「다시 묻지 않음」은 장수와 무관하게 이미지 삭제 전부에 적용(v5.4.0 범위) — 고르는 메뉴(select)와
      // n등 이하의 입력 창은 늘 띄우고, 그 뒤 개수 확인 창만 설정에 따라 생략한다(deleteFlowRules).
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
          const notFav = (x: string) => !isMainImage || !isMainImage(x);
          // 확인 창은 대상 개수를 보인다(삭제 확인 문구 단일 출처, 2026-10-03 E1). 대상은 실행 시점에 다시 계산한다.
          const confirmDelete = (
            count: number,
            scope: Parameters<typeof imageDeleteScopeLine>[0],
            targets: () => string[],
          ) => {
            if (count === 0) {
              appState.pushMessage(NO_IMAGES_TO_DELETE_MESSAGE);
              return;
            }
            const doDel = async () => {
              await deleteImageFilesRecorded(curSession!, targets(), scene);
            };
            if (shouldSkipImageDeleteConfirm(appState.skipImageDeleteConfirm, count)) {
              void doDel();
              return;
            }
            appState.pushDialog({
              type: 'confirm',
              ...deleteConfirmText({
                kind: 'image',
                count,
                outcome: { trashDays: IMAGE_RETENTION_DAYS },
                extra: imageDeleteScopeLine(scope),
              }),
              showSkipConfirm: showImageDeleteSkipOption(count),
              callback: doDel,
            });
          };
          if (value === 'all') {
            confirmDelete(currentPaths().length, {}, () => currentPaths());
          } else if (value === 'n') {
            appState.pushDialog({
              type: 'input-confirm',
              text: '몇등 이하 이미지를 삭제할지 입력해주세요.',
              callback: async (value) => {
                if (value) {
                  // 숫자가 아닌 입력은 slice(NaN)=slice(0) 이 되어 즐겨찾기 외 전부를 지운다 → 공용 해석기로 거른다
                  const n = parseRankCutoff(value);
                  if (n == null) {
                    appState.pushMessage(RANK_CUTOFF_INVALID_MESSAGE);
                    return;
                  }
                  // 예전엔 입력만 받고 확인 없이 지웠다 — 개수를 보이고 한 번 확인한다(E1-3)
                  const targets = () => currentPaths().slice(n).filter(notFav);
                  confirmDelete(targets().length, { rankBelow: n }, targets);
                }
              },
            });
          } else if (value === 'fav') {
            // 값이 없을 때(취소·선택 없음) 이 분기로 떨어지지 않게 명시 비교한다.
            const targets = () => currentPaths().filter(notFav);
            confirmDelete(targets().length, { excludeFav: true }, targets);
          }
        },
      });
    };

    // 이미지 그리드 「삭제」 버튼(V2 하단 줄·PC 클래식 툴바 공용, X3):
    // 선택 모드면 선택한 이미지만 지우고(확인 1회 — 「다시 묻지 않음」 체크박스·설정 존중), 아니면 기존 씬 전체 삭제 메뉴.
    const onDeleteButton = () => {
      const current = gameService
        .getOutputs(curSession!, scene)
        .map((p) => imageService.getOutputDir(curSession!, scene) + '/' + p);
      const plan = planGridImageDelete(
        selectMode,
        selectedImages.current,
        current,
      );
      if (plan.kind === 'scene-menu') {
        onDeleteImages(scene);
        return;
      }
      if (plan.kind === 'empty-selection') {
        appState.pushMessage(NO_SELECTED_IMAGES_MESSAGE);
        return;
      }
      const targets = plan.paths;
      const doDel = async () => {
        await deleteImageFilesRecorded(curSession!, targets, scene);
        // 지워진 이미지는 선택에서 뺀다(실패해 남은 것은 선택 유지 — 다시 시도 가능).
        const remaining = new Set(
          gameService
            .getOutputs(curSession!, scene)
            .map((p) => imageService.getOutputDir(curSession!, scene) + '/' + p),
        );
        for (const p of targets) {
          if (!remaining.has(p)) selectedImages.current.delete(p);
        }
        gallaryRef.current?.refresh();
        gallaryRef2.current?.refresh();
        forceUpdate({});
      };
      if (shouldSkipImageDeleteConfirm(appState.skipImageDeleteConfirm, targets.length)) {
        void doDel();
        return;
      }
      appState.pushDialog({
        type: 'confirm',
        ...deleteConfirmText({
          kind: 'image',
          count: targets.length,
          outcome: { trashDays: IMAGE_RETENTION_DAYS },
        }),
        showSkipConfirm: showImageDeleteSkipOption(targets.length),
        callback: doDel,
      });
    };

    const getPaths = () => {
      // 상세 보기 이전/다음도 그리드와 같은 보기 순서(viewPaths)
      const paths = viewPaths();
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
    // 번호 고르기 창이 열려 있으면 상세 보기처럼 그리드 단축키를 끈다(창 아래 그리드에서 삭제·이동이 일어나지 않게)
    useEffect(() => {
      const active = !isMobile && selectedImageIndex == null && !pickerOpen;
      appState.imageGridFocusable = active;
      return () => {
        appState.imageGridFocusable = false;
      };
    }, [selectedImageIndex, pickerOpen]);

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

        // 씬 탭 이동(W1) — 어느 탭에서든 동작 (전환 시 새 씬으로 리마운트되어 탭 초기화)
        if (action === 'image-prev-scene' || action === 'image-next-scene') {
          sceneNav?.go(action === 'image-prev-scene' ? -1 : 1);
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
          toggleImageFavorite(curSession!, scene, filename);
        } else if (action === 'image-toggle-bookmark') {
          const filename = activePaths[i].split('/').pop()!;
          void toggleImageBookmarkRecorded(curSession!, scene, filename);
        } else if (action === 'image-delete') {
          // 그리드 Del 단일 삭제 — 상세 보기와 같은 규칙(「다시 묻지 않음」 체크박스·설정 존중, deleteFlowRules)
          const doDel = async () => {
            await deleteImageFilesRecorded(curSession!, [activePaths[i]], scene);
            const newCount = count - 1;
            if (newCount === 0) setFocusedImageIndex(null);
            else setFocusedImageIndex(Math.min(i, newCount - 1));
          };
          if (shouldSkipImageDeleteConfirm(appState.skipImageDeleteConfirm, 1)) {
            void doDel();
            return;
          }
          appState.pushDialog({
            type: 'confirm',
            ...deleteConfirmText({ kind: 'image', outcome: { trashDays: IMAGE_RETENTION_DAYS } }),
            showSkipConfirm: showImageDeleteSkipOption(1),
            callback: doDel,
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
      sceneNav,
    ]);

    // 선택 모드(Ctrl+S로 진입)에서 수정자 없는 S로 포커스 이미지 선택 토글.
    // 모드 밖에서는 실수 선택을 막기 위해 무시한다(씬 그리드와 동일 UX).
    useEffect(() => {
      const handler = (e: KeyboardEvent) => {
        if (e.key !== 's' && e.key !== 'S') return;
        if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
        if (isMobile) return;
        if (selectedImageIndex != null) return; // 상세 보기 열림
        if (pickerOpen) return; // 번호 고르기 창 열림
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
    }, [selectMode, focusedImageIndex, activePaths, selectedTab, selectedImageIndex, pickerOpen]);

    // H로 이미지 그리드 전용 단축키 도움말 토글.
    // 토너먼트/상세 보기 중에는 각자의 도움말이 우선하므로 무시한다.
    useEffect(() => {
      const handler = (e: KeyboardEvent) => {
        if (e.key !== 'h' && e.key !== 'H') return;
        if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
        if (isMobile) return;
        if (tournament || selectedImageIndex != null || pickerOpen) return;
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
    }, [tournament, selectedImageIndex, pickerOpen]);

    let emoji = '';
    let title = '';
    if (scene.type === 'inpaint') {
      emoji = workFlowService.getDef(scene.workflowType)?.emoji ?? '';
      title = workFlowService.getDef(scene.workflowType)?.title ?? '';
    }

    // 액션 동작(클래식 머리 버튼과 V2 하단 줄이 공유)
    const actQueueAdd = async () => {
      if (scene.type === 'scene') {
        await queueWorkflow(curSession!, curSession!.selectedWorkflow!, scene, appState.samples);
      } else {
        // 변형 씬은 씬 툴바 예약과 같은 관문(미러 합성 캔버스·미러/I2I 조합 전개 — 2026-10-04 B4 C6, 예전엔 조합 무시)
        try {
          await queueScene(curSession!, scene, appState.samples);
        } catch (e: any) {
          appState.pushMessage(e?.message ? String(e.message) : '예약하지 못했습니다.', 'error');
        }
      }
    };
    const actQueueRemove = () => {
      taskQueueService.removeTasksFromScene(scene);
    };
    const actToggleSelect = () => {
      if (selectMode) {
        selectedImages.current.clear();
      }
      setSelectMode(!selectMode);
    };
    const actSelectFavorites = () => {
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
      appState.pushMessage(favPaths.length + '장의 즐겨찾기 이미지가 선택되었습니다.');
    };
    const actSelectAll = () => {
      selectedImages.current.clear();
      for (const p of activePaths) selectedImages.current.add(p);
      gallaryRef.current?.refresh();
      gallaryRef2.current?.refresh();
      forceUpdate({});
    };
    // 다운로드 = 메시지형 선택 창(2026-11-19 개편 — 종전 독자 창 DownloadDialog 대체). 고르면 확인 없이 바로 저장,
    // 여러 장은 진행 창. 플랫폼 분기(모바일 = 다운로드 폴더)는 imageDownloadService 한 곳.
    // 선택 창의 「선택한 이미지」·「전체」·「즐겨찾기만」과 번호 고르기 창의 [N장 다운로드]가 모두 이 함수로 저장한다.
    // opts.savePath = 번호 고르기 창에서 바꾼 이번에만 쓰는 저장 폴더(설정 불변). 선택 창 경로는 주지 않는다(종전 그대로).
    const downloadGridPaths = async (targets: string[], opts?: DownloadTargetOptions) => {
      if (targets.length === 0) return;
      const result = await imageDownloadService.downloadImages(
        curSession!,
        scene,
        targets,
        appState.getAppliedCharacterPreset(),
        true,
        opts,
      );
      if (selectMode && result.success > 0) {
        selectedImages.current.clear();
        setSelectMode(false);
        gallaryRef.current?.refresh();
        gallaryRef2.current?.refresh();
      }
    };
    // 고른 이미지만 기존 내보내기 흐름으로(선택 창 「선택한 이미지만 프리셋으로 내보내기」와 번호 고르기 창이 공유)
    const exportGridPaths = (targets: string[]) => {
      if (targets.length === 0) return;
      // 같은 내보내기 흐름에 고른 이미지만(프리셋 이미지 범위 무시, 이름 겹침은 번호로 구분 — ExportPresetService)
      appState.exportPackage(scene.type, [scene], { scene, files: pickFileNames(targets) });
    };
    const GRID_CAN_EXPORT = true;
    const actDownload = async () => {
      const selectedPaths = selectMode ? Array.from(selectedImages.current) : [];
      const favoritePaths = isMainImage ? paths.filter((p) => isMainImage(p)) : [];
      const menu = buildGridDownloadMenu({
        sceneName: scene.name,
        selectedCount: selectedPaths.length,
        allCount: paths.length,
        favoriteCount: favoritePaths.length,
        canExport: GRID_CAN_EXPORT,
        isMobile,
        savePath: imageDownloadService.settings.lastSavePath,
      });
      if (!menu.hasImages) {
        appState.pushMessage(GRID_DOWNLOAD_TEXT.empty);
        return;
      }
      const choice = await appState.pushDialogAsync({
        type: 'select',
        text: menu.text,
        items: menu.items,
      });
      if (!choice) return;
      if (choice === 'export') {
        // 기존 이미지 내보내기 흐름(형식·이름 규칙·프리셋)을 이 씬 하나로 한정
        appState.exportPackage(scene.type, [scene]);
        return;
      }
      if (choice === 'export-selected') {
        exportGridPaths(selectedPaths);
        return;
      }
      if (choice === 'pick') {
        // 번호 고르기 창 — 번호 = 지금 그리드 보기 순서(paths = viewPaths()), 선택 모드에서 고른 것이 있으면 그것만 켜고 시작
        setDownloadPick({ paths, preselected: selectedPaths });
        return;
      }
      if (choice === 'change-folder') {
        const newPath = await imageDownloadService.changeSavePath();
        if (newPath) appState.pushMessage(IMAGE_DOWNLOAD_TEXT.folderChanged(newPath));
        return;
      }
      const targets = gridDownloadTargets(choice, {
        selected: selectedPaths,
        all: paths,
        favorites: favoritePaths,
      });
      if (!targets || targets.length === 0) return;
      await downloadGridPaths(targets);
    };
    const actCopyImages = () => {
      if (selectMode && selectedImages.current.size > 0) {
        const selected = [...selectedImages.current];
        appState.copyImagesToClipboard(selected);
      } else {
        appState.copyImagesToClipboard(paths);
      }
    };
    const actPaste = () => {
      appState.pushDialog({
        type: 'confirm',
        text: appState.imageClipboard.length + '장의 이미지를 이 씬에 붙여넣으시겠습니까?',
        callback: async () => {
          await appState.pasteImagesFromClipboard(curSession!, scene);
        },
      });
    };
    const actSampleExtract = async () => {
      if (!onSampleExtract) return;
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
        appState.pushMessage('선택한 이미지에서 시드를 추출할 수 없습니다.');
        return;
      }
      onSampleExtract(seeds);
    };
    const actGoBookmark = () => {
      if (!bookmarkedImageFilename) {
        appState.pushMessage('북마크된 이미지가 없습니다.');
        return;
      }
      const bmPath = imageService.getOutputDir(curSession!, scene) + '/' + bookmarkedImageFilename;
      const index = paths.indexOf(bmPath);
      if (index !== -1) {
        // 이미지 탭으로 전환 후 해당 위치로 스크롤
        setSelectedTab(0);
        setTimeout(() => {
          gallaryRef.current?.scrollToIndex(index);
        }, 50);
      } else {
        appState.pushMessage('북마크된 이미지를 찾을 수 없습니다.');
      }
    };
    // 「보기 순서」 택일(2026-11-22) — 보여 주는 순서만 고르는 앱 전체 보기 설정(appState.setImageViewOrder, localStorage).
    // 데이터(imageMap·game·mains)를 쓰지 않고 되돌리기 기록도 없다. 이미지 장수와 무관하게 고를 수 있다.
    const viewOrderOn = viewOrder !== 'default';
    const actChooseViewOrder = async () => {
      const menu = buildImageViewOrderMenu(viewOrder);
      const choice = await appState.pushDialogAsync({
        type: 'select',
        text: menu.text,
        items: menu.items,
      });
      if (!choice) return;
      const next = normalizeImageViewOrder(choice);
      if (next === normalizeImageViewOrder(appState.imageViewOrder)) return;
      appState.setImageViewOrder(next);
      setFocusedImageIndex(null);
      forceUpdate({});
    };

    // 모바일 V2 하단 줄(2026-09-26 사용자 결정): 평소=선택·삭제·즐겨찾기(일괄 선택)·북마크(+더보기),
    // 선택 중=전체·즐겨찾기 토글·삭제·더보기·완료. 나머지 액션은 더보기 둘째 줄(V2TierRows, 5칸씩).
    const selectedCount = selectedImages.current.size;
    const moreSlot: V2SlotDef = {
      key: 'more',
      name: '더보기',
      icon: <ActionIcon id="more" />,
      onTap: () => setV2More((v) => !v),
      expanded: v2More,
    };
    const deleteSlot: V2SlotDef = {
      key: 'delete',
      name: '삭제',
      icon: <ActionIcon id="delete" />,
      tone: 'danger',
      // 선택 중 줄에서는 선택한 이미지만, 평소 줄에서는 씬 전체 삭제 메뉴(X3)
      onTap: onDeleteButton,
    };
    const gallerySlots: V2SlotDef[] = v2
      ? [
          { key: 'select', name: '선택', icon: <ActionIcon id="multi-select" />, onTap: actToggleSelect },
          deleteSlot,
          isMainImage
            ? {
                key: 'fav-select',
                name: '즐겨찾기',
                icon: (
                  <span className="relative inline-flex items-center justify-center">
                    <FaStar />
                    <FaCheck className="absolute -right-1.5 -bottom-1 text-[9px]" />
                  </span>
                ),
                onTap: actSelectFavorites,
              }
            : { key: 'download', name: '다운로드', icon: <ActionIcon id="download" />, onTap: () => void actDownload() },
          {
            key: 'bookmark',
            name: '북마크 이동',
            icon: <ActionIcon id="bookmark-jump" />,
            tone: bookmarkedImageFilename ? 'accent' : 'default',
            onTap: actGoBookmark,
          },
          moreSlot,
        ]
      : [];
    const gallerySelectSlots: V2SlotDef[] = v2
      ? [
          { key: 'all', name: '전체', icon: <ActionIcon id="select-all" />, onTap: actSelectAll },
          {
            key: 'fav-toggle',
            name: '즐겨찾기',
            icon: <ActionIcon id="favorite" />,
            onTap: () => {
              if (selectedCount === 0) {
                appState.pushMessage('이미지를 먼저 선택해주세요.');
                return;
              }
              onToggleFavoriteSelected();
            },
          },
          deleteSlot,
          moreSlot,
          { key: 'done', name: '완료', icon: <FaCheck />, tone: 'accent', onTap: onClearSelection },
        ]
      : [];
    const tierItem = (id: string, label: string, className: string, icon: React.ReactNode, onClick: () => void, disabled?: boolean): V2TierItem => ({
      id,
      label,
      node: (
        <button className={`round-button ${className}`} onClick={onClick} disabled={disabled} aria-label={label}>
          {icon}
        </button>
      ),
    });
    const galleryTier: V2TierItem[] = v2
      ? [
          tierItem('queue-add', '예약 추가', 'back-green', <ActionIcon id="queue-add" />, () => void actQueueAdd()),
          tierItem('queue-remove', '예약 제거', 'back-gray', <ActionIcon id="queue-remove" />, actQueueRemove),
          tierItem('edit', '씬 편집', 'back-orange', <ActionIcon id="edit" />, () => onEdit(scene)),
          tierItem('download', '다운로드', 'back-green', <ActionIcon id="download" />, () => void actDownload()),
          tierItem('copy', '복사', 'back-sky', <ActionIcon id="copy" />, actCopyImages),
          tierItem('paste', '붙여넣기', appState.imageClipboard.length > 0 ? 'back-sky' : 'back-gray', <FaPaste />, actPaste),
          ...(onSampleExtract ? [tierItem('sample', '샘플 뽑기', 'back-sky', <FaDice />, () => void actSampleExtract())] : []),
          tierItem('tournament', '월드컵', 'back-sky', <FaTrophy />, () => setTournament(true)),
          tierItem(
            'view-order',
            GRID_HEADER_NAMES.viewOrder,
            viewOrderOn ? 'back-sky toggle-on' : 'back-gray',
            <ActionIcon id="image-view-order" />,
            () => void actChooseViewOrder(),
          ),
        ]
      : [];
    const gallerySelectTier: V2TierItem[] = v2
      ? [
          tierItem('download', '다운로드', 'back-green', <ActionIcon id="download" />, () => void actDownload()),
          tierItem('copy', '복사', 'back-sky', <ActionIcon id="copy" />, actCopyImages),
          tierItem('duplicate', '복제', 'back-sky', <ActionIcon id="duplicate" />, () => void onDuplicateSelected(), selectedCount === 0),
          tierItem('copy-to', '다른 씬', 'back-sky', <FaShareSquare />, onCopyToSceneSelected, selectedCount === 0),
          ...(onSampleExtract ? [tierItem('sample', '샘플 뽑기', 'back-sky', <FaDice />, () => void actSampleExtract())] : []),
          ...(isMainImage ? [tierItem('fav-select', '즐겨찾기 선택', 'back-yellow', <FaStar />, actSelectFavorites)] : []),
        ]
      : [];

    // 이미지·즐겨찾기·휴지통·인페인트 씬 탭 — 모양 두 벌(순서·이름·동작은 같음).
    // 종전 알약 탭: 모바일 V2 가 그대로 쓴다(2026-11-22 범위 밖).
    const renderPillTabs = () => (
      <span className="flex ml-auto gap-1 md:gap-2 mt-2 md:mt-0">
        {tabNames.map((tabName, index) => (
          <button
            key={tabName}
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
    );
    // 작업 탭 = 밑줄 탭 .tab-line(SPEC §2 「작업 탭과 택일 버튼은 다른 모양」, PC 주 탭 TabComponent 와 같은 마크업).
    // 머리 영역 아래 테두리(border-b)가 줄 아래 선 노릇을 하므로 .tab-line-bare, 아래 안쪽 여백만큼 내려 그 선 위에 앉힌다.
    // 좁은 폭은 줄바꿈 대신 가로 스크롤(TabComponent 와 같은 기법).
    const renderLineTabs = () => (
      <div className="tab-line tab-line-bare flex max-w-full min-w-0 overflow-x-auto no-scrollbar -mb-2 md:-mb-4">
        {tabNames.map((tabName, index) => (
          <button
            key={tabName}
            className={
              'tab-line-item text-sm' + (selectedTab === index ? ' tab-line-on' : '')
            }
            onClick={() => setSelectedTab(index)}
          >
            {tabName}
          </button>
        ))}
      </div>
    );

    return (
      <div className="w-full h-full flex flex-col">
        {!isMobile && showImageCheatsheet && !tournament && (
          <ShortcutCheatsheet
            scope="image-grid"
            onClose={() => setShowImageCheatsheet(false)}
          />
        )}
        {downloadPick && (
          <GridDownloadPicker
            sceneName={scene.name}
            paths={downloadPick.paths}
            preselected={downloadPick.preselected}
            isFavorite={isMainImage}
            canExport={GRID_CAN_EXPORT}
            scene={scene}
            characterPreset={appState.getAppliedCharacterPreset()}
            onDownload={(targets, opts) => {
              setDownloadPick(undefined);
              void downloadGridPaths(targets, opts);
            }}
            onExport={(targets) => {
              setDownloadPick(undefined);
              exportGridPaths(targets);
            }}
            onClose={() => setDownloadPick(undefined)}
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
            {sceneNav && (
              <span className="ml-auto flex-none inline-flex items-center gap-1 md:gap-2 pl-2">
                <Tooltip content="이전 씬 그리드 (Ctrl+←)">
                  <button
                    className={`round-button icon-only back-gray ${!sceneNav.hasPrev ? 'opacity-40' : ''}`}
                    disabled={!sceneNav.hasPrev}
                    onClick={() => sceneNav.go(-1)}
                  >
                    <FaChevronLeft />
                  </button>
                </Tooltip>
                <Tooltip content="다음 씬 그리드 (Ctrl+→)">
                  <button
                    className={`round-button icon-only back-gray ${!sceneNav.hasNext ? 'opacity-40' : ''}`}
                    disabled={!sceneNav.hasNext}
                    onClick={() => sceneNav.go(1)}
                  >
                    <FaChevronRight />
                  </button>
                </Tooltip>
              </span>
            )}
          </div>
          {/* 탭 줄 위치(2026-11-22 사용자 결정 「탭은 버튼 줄 아래로」): PC·모바일 클래식은 버튼 줄과 탭이 다른 줄 —
              바깥 줄이 flex 가 아니라 이름 표시 판정(measureButtonNames)의 가용 폭 = 머리 영역 폭 전체(탭 폭을 빼지 않음).
              모바일 V2 는 버튼 줄이 없고 종전 바깥 줄·알약 탭 그대로(renderPillTabs). */}
          <div
            ref={headerNamesRef as React.RefObject<HTMLDivElement>}
            className={v2 ? 'md:flex justify-between items-center mt-2 md:mt-4' : 'mt-2 md:mt-4'}
          >
            {!v2 && (
            <div
              data-bn-row=""
              data-bn-items=""
              data-grid-header-buttons=""
              className={`flex gap-2 md:gap-3 flex-wrap${headerNameMode === 'show' ? ' items-start' : ''}`}
            >
              {/* 머리 줄 색(2026-11-22 사용자 결정 「색을 차분하게」): 아이콘 버튼은 중립 회색(back-gray)이 기본.
                  지금 색조를 남기는 것 = 즐겨찾기 선택·즐겨찾기 토글(노랑)·다운로드(초록)·삭제(빨강),
                  씬 카드에서 익숙한 글자 버튼 = 예약 추가(초록)·예약 제거(회색)·씬 편집(주황) 종전 그대로.
                  상태 표시(선택 모드·붙여넣기 가능·북마크 있음·보기 순서가 기본 아님)는 켜졌을 때만 .toggle-on 색. */}
              <button
                className={`round-button back-gray`}
                onClick={() => setTournament(true)}
              >
                이상형 월드컵
              </button>
              <Tooltip content="예약 추가">
                <button
                  className={`round-button${isMobile ? ' icon-only' : ''} back-green`}
                  onClick={actQueueAdd}
                  aria-label="예약 추가"
                >
                  {!isMobile ? '예약 추가' : <ActionIcon id="queue-add" />}
                </button>
              </Tooltip>
              <Tooltip content="예약 제거">
                <button
                  className={`round-button${isMobile ? ' icon-only' : ''} back-gray`}
                  onClick={() => {
                    taskQueueService.removeTasksFromScene(scene);
                  }}
                >
                  {!isMobile ? '예약 제거' : <ActionIcon id="queue-remove" />}
                </button>
              </Tooltip>
              <Tooltip content="씬 편집">
                <button
                  className={`round-button${isMobile ? ' icon-only' : ''} back-orange`}
                  onClick={() => {
                    onEdit(scene);
                  }}
                >
                  {!isMobile ? '씬 편집' : <ActionIcon id="edit" />}
                </button>
              </Tooltip>
              {!isMobile && hn('folder', (
                  <Tooltip content="폴더 열기">
                    <button
                      className={`round-button icon-only back-gray`}
                      onClick={async () => {
                        await backend.showFile(
                          getResultDirectory(curSession!, scene),
                        );
                      }}
                    >
                      <FaFolderOpen />
                    </button>
                  </Tooltip>
              ))}
              {hn('selectMode', (
                <Tooltip content="이미지 선택 모드">
                  <button
                    className={
                      `round-button icon-only ` + (selectMode ? 'back-sky toggle-on' : 'back-gray')
                    }
                    aria-pressed={selectMode}
                    data-viewer-toggle="select-mode"
                    onClick={actToggleSelect}
                  >
                    <ActionIcon id="multi-select" />
                  </button>
                </Tooltip>
              ))}
              {isMainImage && hn('favSelect', (
                  <Tooltip content="즐겨찾기 이미지 일괄 선택">
                    <button
                      className={`round-button icon-only back-yellow`}
                      onClick={actSelectFavorites}
                    >
                      {/* 즐겨찾기 '선택' 헬퍼: 별+체크 배지로 토글 버튼(순수 별)과 구분 */}
                      <span className="relative inline-flex items-center justify-center">
                        <FaStar />
                        <FaCheck className="absolute -right-1.5 -bottom-1 text-[9px]" />
                      </span>
                    </button>
                  </Tooltip>
              ))}
              {hn('download', (
                <Tooltip content="이미지 다운로드">
                  <button
                    className={`round-button icon-only back-green`}
                    onClick={() => void actDownload()}
                  >
                    <FaDownload />
                  </button>
                </Tooltip>
              ))}
              {hn('copy', (
                <Tooltip content="이미지 복사">
                  <button
                    className={`round-button icon-only back-gray`}
                    onClick={actCopyImages}
                  >
                    <ActionIcon id="copy" />
                  </button>
                </Tooltip>
              ))}
              {hn('paste', (
                <Tooltip content="이미지 붙여넣기">
                  <button
                    className={`round-button icon-only ${appState.imageClipboard.length > 0 ? 'back-sky toggle-on' : 'back-gray'}`}
                    data-viewer-toggle="paste"
                    onClick={actPaste}
                  >
                    <FaPaste />
                  </button>
                </Tooltip>
              ))}
              {selectMode && selectedImages.current.size > 0 && (
                <>
                  {hn('favToggle', (
                    <Tooltip content="선택 이미지 즐겨찾기 토글">
                      <button
                        className="round-button icon-only back-yellow"
                        onClick={onToggleFavoriteSelected}
                      >
                        <FaStar />
                      </button>
                    </Tooltip>
                  ))}
                  {hn('duplicate', (
                    <Tooltip content="선택 이미지 복제">
                      <button
                        className="round-button icon-only back-gray"
                        onClick={onDuplicateSelected}
                      >
                        <ActionIcon id="duplicate" />
                      </button>
                    </Tooltip>
                  ))}
                  {hn('copyToScene', (
                    <Tooltip content="선택 이미지를 다른 씬으로 복사">
                      <button
                        className="round-button icon-only back-gray"
                        onClick={onCopyToSceneSelected}
                      >
                        <FaShareSquare />
                      </button>
                    </Tooltip>
                  ))}
                </>
              )}
              {hn('delete', (
                <Tooltip
                  content={
                    selectMode ? '선택한 이미지 삭제' : '이미지 삭제'
                  }
                >
                  <button
                    className={`round-button icon-only back-red`}
                    aria-label={selectMode ? '선택한 이미지 삭제' : '이미지 삭제'}
                    onClick={onDeleteButton}
                  >
                    <FaTrash />
                  </button>
                </Tooltip>
              ))}
              {onSampleExtract && hn('sample', (
                  <Tooltip content="샘플 뽑기 (시드 추출)">
                    <button
                      className={`round-button icon-only back-gray`}
                      onClick={actSampleExtract}
                    >
                      <FaDice />
                    </button>
                  </Tooltip>
              ))}
              {hn('bookmark', (
                <Tooltip content="북마크된 이미지로 이동">
                  <button
                    className={`round-button icon-only ${bookmarkedImageFilename ? 'back-orange toggle-on' : 'back-gray'}`}
                    data-viewer-toggle="bookmark-jump"
                    onClick={actGoBookmark}
                  >
                    <ActionIcon id="bookmark-jump" />
                  </button>
                </Tooltip>
              ))}
              {hn('viewOrder', (
                <Tooltip content={IMAGE_VIEW_ORDER_TEXT.tooltip(viewOrder)}>
                  {/* 고르는 창을 여는 버튼 — 「상태 있음」 표시만(.toggle-on, aria-pressed 없음 — SPEC §2 토글 규칙) */}
                  <button
                    className={`round-button icon-only ${viewOrderOn ? 'back-sky toggle-on' : 'back-gray'}`}
                    aria-label={IMAGE_VIEW_ORDER_TEXT.tooltip(viewOrder)}
                    aria-haspopup="dialog"
                    data-viewer-toggle="view-order"
                    onClick={() => void actChooseViewOrder()}
                  >
                    <ActionIcon id="image-view-order" />
                  </button>
                </Tooltip>
              ))}
            </div>
            )}
            {v2 ? (
              renderPillTabs()
            ) : (
              // 버튼 줄 아래 자기 줄(머리 영역의 마지막 줄). 탭 모양을 알약으로 되돌릴 때는 이 한 곳만 renderPillTabs() 로.
              <div data-grid-tabs="" className="mt-2 md:mt-3">
                {renderLineTabs()}
              </div>
            )}
          </div>
        </div>
        <div className={v2 ? 'flex-1 pt-2 relative min-h-0 overflow-hidden' : 'flex-1 pt-2 relative h-full overflow-hidden'}>
          <ImageGallery
            scene={scene}
            onFilenameChange={onFilenameChange}
            ref={gallaryRef}
            isMainImage={isMainImage}
            filePaths={paths}
            imageSize={gridCellSize}
            thumbSize={gridThumbSize}
            isHidden={selectedTab !== 0}
            selectedImages={selectedImages.current}
            onSelected={onSelected}
            selectMode={selectMode}
            bookmarkedImagePath={bookmarkedImagePath}
            focusedIndex={selectedTab === 0 ? focusedImageIndex : null}
            onSelectedImagesChange={onSelectedImagesChange}
            onClearSelection={onClearSelection}
            reorderable={reorderable}
            emptyText="아직 생성된 이미지가 없습니다"
            emptyHint="씬을 예약하면 생성된 이미지가 여기에 표시됩니다"
          />
          {selectedTab === 2 && (
            <TrashImageView
              session={curSession!}
              scene={scene}
              imageSize={gridCellSize}
              thumbSize={gridThumbSize}
            />
          )}
          <QueueControl
            type="inpaint"
            isActive={selectedTab === 3}
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
              // 이미지 상세 — 전역 되돌리기 단축키 허용(D9, 바깥 이미지 그리드 창도 허용이라 함께 통과)
              allowUndo
              // 머리줄 내용 자리 — PC 넓은 폭 상세가 씬 이름·n/전체·순위·이전/다음을 그려 넣는다(좁은 폭·V2 는 쓰지 않음)
              headerSlot
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
          <ImageGallery
            scene={scene}
            ref={gallaryRef2}
            selectMode={selectMode}
            onFilenameChange={onFilenameChange}
            isMainImage={isMainImage}
            filePaths={paths.filter((path) => isMainImage && isMainImage(path))}
            imageSize={gridCellSize}
            thumbSize={gridThumbSize}
            selectedImages={selectedImages.current}
            isHidden={selectedTab !== 1}
            onSelected={onSelected}
            bookmarkedImagePath={bookmarkedImagePath}
            focusedIndex={selectedTab === 1 ? focusedImageIndex : null}
            onSelectedImagesChange={onSelectedImagesChange}
            onClearSelection={onClearSelection}
            reorderable={reorderable}
            emptyText="즐겨찾기한 이미지가 없습니다"
            emptyHint="이미지에 ★(즐겨찾기)를 지정하면 여기에 모입니다"
          />
        </div>
        {v2 && (
          <div className="relative flex-none" data-v2-gallery-bar="">
            <V2TierRows
              open={v2More}
              onClose={() => setV2More(false)}
              items={selectMode ? gallerySelectTier : galleryTier}
              perRow={5}
            />
            <V2MainRow slots={selectMode ? gallerySelectSlots : gallerySlots} selecting={selectMode} />
          </div>
        )}
        <div
          className="absolute gap-1 m-2 bottom-0 bg-[var(--c-surface-2)] p-1 right-0 opacity-30 hover:opacity-100 transition-opacity flex"
          // V2: 하단 줄(52px) 위로 올린다(가려지지 않게)
          style={v2 ? { bottom: V2_GALLERY_BAR_PX } : undefined}
        >
          {/* PC = 이미지 크기 슬라이더(2026-11-23 사용자 결정, 종전 S/M/L 자리·평소 흐림 그대로) / 모바일 = 종전 S/M/L 단추 */}
          {selectedTab !== 2 && selectedTab !== 3 && !isMobile && (
            <SizeSlider
              label={SIZE_SLIDER_TEXT.imageGrid}
              value={gridSizePercent}
              onChange={onGridSizePercent}
            />
          )}
          {selectedTab !== 2 &&
            selectedTab !== 3 &&
            isMobile &&
            imagesSizes.map((size, index) => (
              <button
                key={index}
                // 색 = 상태 토큰(UI 정돈 그룹 2-b — 종전 text-white + bg-gray-600/400 고정이라 다크 짝이 없었다).
                // 선택 = back-sky(--c-sky-bg/fg), 미선택 = back-gray(--c-gray-bg/fg). 자리·크기·평소 흐림은 그대로.
                className={`w-8 h-8 hover:brightness-95 active:brightness-90 cursor-pointer
          ${imageSize === index ? 'back-sky' : 'back-gray'}`}
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
