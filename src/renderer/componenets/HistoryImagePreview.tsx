import React, { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import {
  FaChevronLeft,
  FaChevronRight,
  FaRegStar,
  FaStar,
  FaTimes,
} from 'react-icons/fa';
import { imageHistoryService, imageService } from '../models';
import { appState } from '../models/AppService';
import { useBackLayer } from '../models/BackStackService';
import {
  closeHistoryPreview,
  historyEntryCaption,
  historyPreviewNeighbors,
  historyPreviewState,
  openHistoryPreview,
} from '../models/historyPreview';
import { imageDragOutProps } from '../models/imageDragOut';
import { isTextEntryFocused } from '../models/keyTargetGuard';
import { GenericScene } from '../models/types';
import { useBackdropClose } from './backdropClose';

// 히스토리 큰 미리 보기(2026-11-22) — 히스토리 칸을 누르면 지금 화면 위에 원본을 크게 띄운다.
// App 에 한 번만 마운트(드로어 DOM 밖). 층은 --z-modal-top(모바일 드로어·손잡이 위, 토스트·확인 창·컨텍스트 메뉴 아래).
// 등장 움직임 없음(바로 뜨고 바로 닫힘). 다른 프로젝트 항목도 entry.path·resolveQuiet 로 다룬다(현재 프로젝트 전제 없음).
// 이전/다음은 버튼과 좌우 화살표 키 — 이 창이 떠 있는 동안 전역 단축키는 막힌다(KeyboardShortcutService 의
// historyPreviewOpen — 되돌리기·다시 실행만 통과). 우클릭 메뉴는 달지 않는다 — 메뉴 결과 창(생성 설정 적용·씬 이동 등)이 이 창 아래에 뜬다.

type LoadState = { kind: 'loading' } | { kind: 'error' } | { kind: 'ok'; src: string };

export const HistoryImagePreview = observer(() => {
  const entryId = historyPreviewState.entryId;
  const entries = imageHistoryService.entries;
  const entry = entryId ? entries.find((e) => e.id === entryId) : undefined;
  const open = !!entry;

  // 항목이 히스토리에서 사라지면(파일 없음으로 제거·삭제 등) 닫는다
  useEffect(() => {
    if (entryId && !entry) closeHistoryPreview();
  }, [entryId, entry]);

  // Esc·안드로이드 뒤로 가기 — 맨 위 한 겹(이 창)만 닫힌다
  useBackLayer(open, closeHistoryPreview);
  const backdrop = useBackdropClose(closeHistoryPreview);
  const imageAreaBackdrop = useBackdropClose(closeHistoryPreview);

  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [scene, setScene] = useState<GenericScene | undefined>(undefined);
  const path = entry?.path;

  useEffect(() => {
    if (!entry) return undefined;
    let canceled = false;
    setLoad({ kind: 'loading' });
    setScene(undefined);
    (async () => {
      try {
        const data = await imageService.fetchImage(entry.path);
        if (canceled) return;
        if (!data) {
          // 파일이 사라진 항목 — 칸과 같은 규칙으로 히스토리에서 지운다(지우면 위 effect 가 창을 닫는다)
          appState.pushMessage('이미지 파일을 찾을 수 없습니다');
          imageHistoryService.remove(entry.id);
          return;
        }
        setLoad({ kind: 'ok', src: data });
      } catch (e) {
        if (!canceled) setLoad({ kind: 'error' });
      }
    })();
    imageHistoryService.resolveQuiet(entry).then((r) => {
      if (!canceled && r) setScene(r.scene);
    });
    return () => {
      canceled = true;
    };
  }, [path]);

  // 좌우 화살표로 이전/다음(PC). 미리 보기가 떠 있는 동안 전역 단축키는 KeyboardShortcutService 가 막으므로
  // (ShortcutGateState.historyPreviewOpen) 아래 화면의 이미지·씬 이동과 겹치지 않는다. 입력 칸 포커스 중·보조 키 조합은 무시.
  const neighbors = historyPreviewNeighbors(entries, entry ? entry.id : null);
  const prevId = neighbors.prev;
  const nextId = neighbors.next;
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (isTextEntryFocused() || appState.dialogs.length > 0) return;
      const target = e.key === 'ArrowLeft' ? prevId : nextId;
      e.preventDefault();
      if (target) openHistoryPreview(target);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, prevId, nextId]);

  if (!entry) return null;

  const { prev, next } = neighbors;
  // scene.mains 는 mobx 옵저버블 — 즐겨찾기 전환이 바로 반영된다
  const isFav = !!scene && scene.mains.includes(entry.filename);
  const caption = historyEntryCaption(entry, appState.curSession?.name);

  const openGrid = async () => {
    await imageHistoryService.navigateTo(entry, { openGrid: true });
    closeHistoryPreview();
  };

  return (
    <div
      className="fixed inset-0 titlebar-no-drag flex flex-col select-none"
      style={{ zIndex: 'var(--z-modal-top)', backgroundColor: 'rgba(0,0,0,0.8)' }}
      data-history-preview=""
      {...backdrop}
    >
      {/* 이미지 영역 — 이미지 바깥(어두운 곳)을 누르면 닫힌다 */}
      <div
        className="flex-1 min-h-0 w-full flex items-center justify-center p-3 md:p-6"
        {...imageAreaBackdrop}
      >
        {load.kind === 'ok' ? (
          <img
            src={load.src}
            draggable={false}
            {...imageDragOutProps(entry.path)}
            alt={caption}
            className="max-w-full max-h-full object-contain rounded"
          />
        ) : (
          <div className="text-sm text-white/80" data-history-preview-status={load.kind}>
            {load.kind === 'loading' ? '불러오는 중…' : '이미지를 불러오지 못했습니다'}
          </div>
        )}
      </div>
      {/* 아래 막대: 이전·다음 / 캡션 / 즐겨찾기·그리드에서 보기·닫기 */}
      <div className="flex-none flex flex-wrap items-center justify-center gap-2 mx-auto mb-3 px-3 py-2 max-w-[calc(100vw-16px)] rounded-xl border line-color bg-[var(--c-zone)] shadow-2xl">
        <div className="w-full md:w-auto md:max-w-[40vw] text-sm text-default truncate text-center">
          {caption}
        </div>
        <div className="flex items-center gap-2">
          <button
            className="relative icon-button icon-only touch-hit"
            aria-label="이전 이미지"
            title="이전 이미지"
            disabled={!prev}
            onClick={() => prev && openHistoryPreview(prev)}
          >
            <FaChevronLeft size={16} />
          </button>
          <button
            className="relative icon-button icon-only touch-hit"
            aria-label="다음 이미지"
            title="다음 이미지"
            disabled={!next}
            onClick={() => next && openHistoryPreview(next)}
          >
            <FaChevronRight size={16} />
          </button>
          <button
            className="relative icon-button icon-only touch-hit"
            aria-label={isFav ? '즐겨찾기 해제' : '즐겨찾기'}
            title={isFav ? '즐겨찾기 해제' : '즐겨찾기'}
            aria-pressed={isFav}
            data-history-preview-fav=""
            onClick={() => imageHistoryService.toggleFavorite(entry)}
          >
            {isFav ? (
              <FaStar size={16} className="text-yellow-400" />
            ) : (
              <FaRegStar size={16} />
            )}
          </button>
          <button className="round-button back-gray" onClick={openGrid}>
            이미지 그리드에서 보기
          </button>
          <button
            className="relative icon-button icon-only touch-hit"
            aria-label="닫기"
            title="닫기"
            onClick={closeHistoryPreview}
          >
            <FaTimes size={16} />
          </button>
        </div>
      </div>
    </div>
  );
});
