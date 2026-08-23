import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  FaArrowLeft,
  FaArrowRight,
  FaPaintBrush,
  FaPlay,
  FaTrash,
  FaTrashRestore,
  FaTimes,
} from 'react-icons/fa';
import {
  gameService,
  imageService,
  isMobile,
  trashService,
} from '../models';
import { backStackService } from '../models/BackStackService';
import { appState } from '../models/AppService';
import { deleteImageFiles } from '../models/ImageService';
import { queueScene } from '../models/sceneQueueActions';
import { GenericScene, Session } from '../models/types';
import Tooltip from './Tooltip';

interface ReviewItem {
  scene: GenericScene;
  filename: string;
  path: string;
}

interface Props {
  session: Session;
  type: 'scene' | 'inpaint';
  startScene?: GenericScene;
  onClose: () => void;
  onInpaint: (scene: GenericScene, path: string) => Promise<void>;
}

interface TrashItem {
  filename: string;
  deletedAt: number;
  thumbnail?: string | null;
}

const confirmAction = (text: string) =>
  new Promise<boolean>((resolve) => {
    appState.pushDialog({
      type: 'confirm',
      text,
      callback: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });

const collectReviewItems = (
  session: Session,
  type: 'scene' | 'inpaint',
  startScene?: GenericScene,
): ReviewItem[] => {
  const scenes = session.getScenes(type);
  const startIndex = startScene
    ? scenes.findIndex(
        (scene) =>
          scene.type === startScene.type && scene.name === startScene.name,
      )
    : -1;
  const orderedScenes =
    startIndex >= 0
      ? [...scenes.slice(startIndex), ...scenes.slice(0, startIndex)]
      : scenes;
  const seen = new Set<string>();
  const items: ReviewItem[] = [];

  for (const scene of orderedScenes) {
    const directory = imageService.getOutputDir(session, scene);
    const outputs = [...scene.mains, ...gameService.getOutputs(session, scene)];
    for (const filename of outputs) {
      const key = `${scene.type}|${scene.name}|${filename}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ scene, filename, path: `${directory}/${filename}` });
    }
  }
  return items;
};

const ImageReview = ({
  session,
  type,
  startScene,
  onClose,
  onInpaint,
}: Props) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [index, setIndex] = useState(0);
  const [image, setImage] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [samples, setSamples] = useState(Math.max(1, appState.samples || 1));
  const [lastDeletedScene, setLastDeletedScene] = useState<GenericScene>();
  const [trashScene, setTrashScene] = useState<GenericScene>();
  const [trashItems, setTrashItems] = useState<TrashItem[]>([]);
  const [trashLoading, setTrashLoading] = useState(false);

  const current = items[index];

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        await imageService.refreshBatch(session);
      } catch (e) {
        console.warn('이미지 검수 목록 새로고침 실패:', e);
      }
      if (cancelled) return;
      const next = collectReviewItems(session, type, startScene);
      setItems(next);
      setIndex(0);
      setLoading(false);
      if (next.length === 0) {
        appState.pushMessage('검수할 이미지가 없습니다.');
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [session, type, startScene]);

  useEffect(() => {
    let cancelled = false;
    if (!current) {
      setImage('');
      return () => {
        cancelled = true;
      };
    }
    setImage('');
    imageService
      .fetchImage(current.path)
      .then((result) => {
        if (!cancelled) setImage(result || '');
      })
      .catch((e) => {
        if (!cancelled) {
          appState.pushMessage(`이미지 로드 실패: ${e?.message ?? e}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [current?.path]);

  useLayoutEffect(() => {
    const timer = window.setTimeout(() => {
      rootRef.current?.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const handle = backStackService.push(() => {
      if (trashScene) setTrashScene(undefined);
      else onClose();
    });
    return () => handle.remove();
  }, [onClose, trashScene]);

  const move = useCallback(
    (delta: number) => {
      if (items.length === 0) return;
      setLastDeletedScene(undefined);
      setIndex((value) => (value + delta + items.length) % items.length);
    },
    [items.length],
  );

  const deleteCurrent = useCallback(
    async (skipConfirm: boolean) => {
      if (busy || !current) return;
      if (
        !skipConfirm &&
        !(await confirmAction(
          `현재 이미지를 삭제할까요?\n${current.scene.name} / ${current.filename}`,
        ))
      ) {
        return;
      }
      setBusy(true);
      try {
        const failed = await deleteImageFiles(
          session,
          [current.path],
          current.scene,
        );
        if (failed === 0) {
          setLastDeletedScene(current.scene);
          const next = items.filter((item) => item !== current);
          setItems(next);
          setIndex((value) => Math.min(value, Math.max(0, next.length - 1)));
        }
      } catch (e: any) {
        appState.pushMessage(`삭제 실패: ${e?.message ?? e}`);
      } finally {
        setBusy(false);
      }
    },
    [busy, current, items, session],
  );

  const queueCurrent = useCallback(async () => {
    if (busy || !current) return;
    const count = Math.max(1, Math.min(99, Number(samples) || 1));
    setSamples(count);
    setBusy(true);
    try {
      await queueScene(session, current.scene, count);
      appState.pushMessage(`${current.scene.name} 예약 ${count}장`);
    } catch (e: any) {
      appState.pushMessage(`프롬프트 오류: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  }, [busy, current, samples, session]);

  const openInpaint = useCallback(async () => {
    if (busy || !current) return;
    setBusy(true);
    try {
      await onInpaint(current.scene, current.path);
    } catch (e: any) {
      appState.pushMessage(`인페인트 열기 실패: ${e?.message ?? e}`);
      setBusy(false);
    }
  }, [busy, current, onInpaint]);

  const loadTrash = useCallback(
    async (scene: GenericScene) => {
      setTrashScene(scene);
      setTrashLoading(true);
      try {
        const entries = await trashService.getTrashImages(session, scene);
        const withThumbnails = await Promise.all(
          entries.map(async (entry) => {
            const path = trashService.getTrashImagePath(
              session,
              scene,
              entry.filename,
            );
            try {
              return {
                ...entry,
                thumbnail: await imageService.fetchImageSmall(
                  path,
                  isMobile ? 200 : 360,
                ),
              };
            } catch (e) {
              return entry;
            }
          }),
        );
        setTrashItems(withThumbnails);
      } catch (e) {
        setTrashItems([]);
      } finally {
        setTrashLoading(false);
      }
    },
    [session],
  );

  const restoreTrashItem = async (entry: TrashItem) => {
    if (!trashScene) return;
    await trashService.restoreImages(session, trashScene, [entry.filename]);
    await imageService.refresh(session, trashScene);
    const restored: ReviewItem = {
      scene: trashScene,
      filename: entry.filename,
      path: `${imageService.getOutputDir(session, trashScene)}/${entry.filename}`,
    };
    setItems((previous) => {
      if (previous.some((item) => item.path === restored.path)) return previous;
      const insertAt = Math.min(index + 1, previous.length);
      return [
        ...previous.slice(0, insertAt),
        restored,
        ...previous.slice(insertAt),
      ];
    });
    appState.pushMessage(`${entry.filename} 복원 완료`);
    await loadTrash(trashScene);
  };

  const permanentlyDeleteTrashItem = async (entry: TrashItem) => {
    if (!trashScene) return;
    if (!(await confirmAction(`${entry.filename} 파일을 영구 삭제할까요?`))) {
      return;
    }
    await trashService.permanentlyDeleteImages(session, trashScene, [
      entry.filename,
    ]);
    await loadTrash(trashScene);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable
      ) {
        return;
      }

      const immediateDelete = event.altKey && event.key === 'ArrowRight';
      const handled =
        immediateDelete ||
        [
          'ArrowLeft',
          'ArrowRight',
          'Delete',
          'Backspace',
          'Escape',
          'i',
          'I',
          'g',
          'G',
        ].includes(event.key);
      if (!handled) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (trashScene) {
        if (event.key === 'Escape') setTrashScene(undefined);
        return;
      }
      if (immediateDelete) {
        deleteCurrent(true);
      } else if (event.key === 'ArrowLeft') {
        move(-1);
      } else if (event.key === 'ArrowRight') {
        move(1);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        deleteCurrent(false);
      } else if (event.key === 'Escape') {
        onClose();
      } else if (event.key === 'i' || event.key === 'I') {
        openInpaint();
      } else if (event.key === 'g' || event.key === 'G') {
        queueCurrent();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [deleteCurrent, move, onClose, openInpaint, queueCurrent, trashScene]);

  const trashTarget = lastDeletedScene || current?.scene;
  const counter = useMemo(
    () => (items.length > 0 ? `${index + 1} / ${items.length}` : '0 / 0'),
    [index, items.length],
  );

  return createPortal(
    <div
      ref={rootRef}
      tabIndex={-1}
      role="dialog"
      aria-label="이미지 검수"
      data-no-scene-drag
      className="fixed inset-0 z-[var(--z-modal)] flex flex-col bg-[var(--c-surface)] text-default outline-none"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <header className="flex items-center gap-2 border-b line-color bg-[var(--c-surface-2)] px-3 py-2">
        <strong className="min-w-0 flex-1 truncate">
          {current
            ? `${current.scene.name} / ${current.filename}`
            : loading
              ? '이미지를 불러오는 중...'
              : '검수할 이미지가 없습니다.'}
        </strong>
        <span className="whitespace-nowrap text-sm text-muted">
          {counter}
        </span>
        <Tooltip content="이미지 검수 닫기">
          <button className="round-button back-gray" onClick={onClose}>
            <FaTimes />
          </button>
        </Tooltip>
      </header>

      <main className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3">
        {image ? (
          <img
            src={image}
            alt={current?.scene.name || ''}
            className="max-h-full max-w-full object-contain shadow-2xl"
            draggable={false}
          />
        ) : (
          <div className="text-muted">
            {loading ? '불러오는 중...' : '표시할 이미지가 없습니다.'}
          </div>
        )}
      </main>

      <footer className="flex flex-wrap items-center justify-center gap-2 border-t line-color bg-[var(--c-surface-2)] px-3 py-2">
        <Tooltip content="이전 이미지">
          <button className="round-button back-gray" onClick={() => move(-1)}>
            <FaArrowLeft />
          </button>
        </Tooltip>
        <Tooltip content="다음 이미지">
          <button className="round-button back-gray" onClick={() => move(1)}>
            <FaArrowRight />
          </button>
        </Tooltip>
        <Tooltip content="현재 이미지 삭제 (Alt + 오른쪽 화살표: 즉시 삭제)">
          <button
            className="round-button back-red"
            onClick={() => deleteCurrent(false)}
          >
            <FaTrash />
            <span className="ml-1">삭제</span>
          </button>
        </Tooltip>
        <Tooltip content="현재 이미지 인페인트">
          <button className="round-button back-green" onClick={openInpaint}>
            <FaPaintBrush />
            <span className="ml-1">인페인트</span>
          </button>
        </Tooltip>
        <Tooltip content="현재 씬에서 삭제한 이미지 보기">
          <button
            className="round-button back-gray"
            disabled={!trashTarget}
            onClick={() => trashTarget && loadTrash(trashTarget)}
          >
            <FaTrashRestore />
            <span className="ml-1">휴지통</span>
          </button>
        </Tooltip>
        <label
          className="ml-2 text-sm font-bold text-body"
          htmlFor="review-samples"
        >
          생성 수
        </label>
        <input
          id="review-samples"
          type="number"
          min={1}
          max={99}
          value={samples}
          onChange={(event) => setSamples(Number(event.target.value))}
          className="gray-input w-20 text-center"
        />
        <Tooltip content="현재 씬 이미지 생성 예약">
          <button className="round-button back-sky" onClick={queueCurrent}>
            <FaPlay />
            <span className="ml-1">생성 예약</span>
          </button>
        </Tooltip>
      </footer>

      {trashScene && (
        <div className="absolute inset-0 z-10 flex flex-col bg-[var(--c-surface)]">
          <header className="flex items-center gap-2 border-b line-color bg-[var(--c-surface-2)] px-3 py-2">
            <strong className="min-w-0 flex-1 truncate">
              {trashScene.name} / 휴지통
            </strong>
            <button
              className="round-button back-gray"
              onClick={() => setTrashScene(undefined)}
            >
              <FaTimes />
            </button>
          </header>
          <div className="grid flex-1 grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2 overflow-auto p-3">
            {trashLoading && (
              <div className="text-muted">불러오는 중...</div>
            )}
            {!trashLoading && trashItems.length === 0 && (
              <div className="text-muted">휴지통이 비어 있습니다.</div>
            )}
            {trashItems.map((entry) => (
              <div
                key={entry.filename}
                className="flex min-w-0 flex-col gap-2 rounded border line-color bg-[var(--c-surface-2)] p-2"
              >
                <div className="h-44 bg-[var(--c-canvas)]">
                  {entry.thumbnail && (
                    <img
                      src={entry.thumbnail}
                      alt={entry.filename}
                      className="h-full w-full object-contain"
                    />
                  )}
                </div>
                <div
                  className="truncate text-xs text-muted"
                  title={entry.filename}
                >
                  {entry.filename}
                </div>
                <div className="flex gap-1">
                  <button
                    className="round-button back-green"
                    onClick={() => restoreTrashItem(entry)}
                  >
                    복원
                  </button>
                  <button
                    className="round-button back-red"
                    onClick={() => permanentlyDeleteTrashItem(entry)}
                  >
                    영구 삭제
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
};

export default ImageReview;
