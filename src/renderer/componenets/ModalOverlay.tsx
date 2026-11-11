import React, { ReactNode, useEffect, useRef } from 'react';
import { FaTimes } from 'react-icons/fa';
import { appState } from '../models/AppService';
import { backStackService } from '../models/BackStackService';
import { isMobile } from '../models';
import { useGuardedClose } from './backdropClose';
import {
  OVERLAY_ASIDE_WIDTH,
  OVERLAY_SIDE_TABS_WIDTH,
  OverlaySize,
  overlayUsesColumns,
  resolveOverlayFrame,
} from '../models/overlaySizes';

interface ModalOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  // 제목 옆 도움말 아이콘 등 인라인 요소 허용 (h2 안에 그대로 렌더)
  title: ReactNode;
  children: ReactNode;
  // 창 크기 등급(2026-11-11 오버레이 크기 체계, models/overlaySizes.ts·SPEC_GUIDE 「오버레이 창 크기 체계」):
  // PC 폭 s 480·m 720·l 1000·xl 1280(모두 min(등급, 94vw)), full = 94vw×92vh. 높이 s·m = 내용(최소 200·360,
  // 최대 85vh — 넘치면 본문만 스크롤), l·xl = 고정 min(85vh, 760·860). 모바일은 폭 min(등급, 90vw)·최대 85vh 만.
  // 주면 width 보다 우선. 새 창은 size 만 쓴다.
  size?: OverlaySize;
  /**
   * @deprecated 옛 Tailwind 폭 클래스(예 'max-w-2xl'). 기존 호출부 호환용 — 주면(또는 size 를 생략하면) 종전과
   * 똑같이 렌더한다. 새 창은 `size` 를 쓴다(specGuard 가 새 사용을 막는다). 등급 추천은 LEGACY_WIDTH_TO_SIZE.
   */
  width?: string;
  // 머리줄 아래 도구줄(왼쪽 정렬 동작 버튼 줄) — 본문 스크롤 밖에 고정
  toolbar?: ReactNode;
  // 바닥줄(확정·취소 — 오른쪽 정렬) — 본문 스크롤 밖에 고정. 위험 버튼(삭제 등)은 footerStart(왼쪽)
  footer?: ReactNode;
  footerStart?: ReactNode;
  // 왼쪽 세로 탭 열(180px) — PC·size l/xl/full 에서만 그린다. 모바일·좁은 등급에서는 그리지 않으므로
  // 호출부가 본문 안 가로 탭을 따로 그린다(탭 배치 규칙: L 이상·탭 ≥4 → 세로, 모바일은 항상 가로).
  sideTabs?: ReactNode;
  // 「목록 | 편집」 두 열의 왼쪽 목록 열(280px, 각자 스크롤) — PC·size l/xl/full. 그 밖에서는 본문 위에 쌓는다.
  aside?: ReactNode;
  // 본문 여백 — 기본 'normal'(p-5). 'none' 이면 자식이 여백·붙박이 머리를 직접 그린다(두 열·붙박이 머리용).
  bodyPadding?: 'normal' | 'none';
  // 마운트는 유지한 채 시각적으로만 숨김 — 내용물이 드래그 소스일 때
  // 드래그 도중 언마운트하면 드래그가 끊기므로 이 경로를 쓴다.
  hidden?: boolean;
  // 전체 화면 변형(2026-09-26, 캐릭터 위치 지정 창): 모바일=화면 전체, PC=94vw×92vh. 내용 영역은 여백 없이
  // 자식이 높이를 전부 쓴다(flex-1 min-h-0 overflow-hidden). 뒤로 가기·Escape·모달 카운터는 그대로.
  fullscreen?: boolean;
  // 층(z-index) 교체 — 기본 var(--z-modal). 다른 모달·드로어 위에 떠야 하는 전역 창
  // (Google 드라이브 백업 창·환경설정 불러오기 미리보기)만 var(--z-modal-top) 을 쓴다.
  zIndex?: string;
  // 미저장 가드(2026-10-03 E2-3): 참을 돌려주면 ✕·바깥 클릭·Esc·뒤로 가기로 닫을 때
  // 「저장하지 않은 변경이 있습니다. 버리고 닫을까요?」를 묻고 확인했을 때만 onClose. 없으면 예전과 같다.
  dirty?: () => boolean;
}

const ModalOverlay = ({
  isOpen,
  onClose,
  title,
  children,
  size,
  width,
  toolbar,
  footer,
  footerStart,
  sideTabs,
  aside,
  bodyPadding = 'normal',
  hidden,
  fullscreen,
  zIndex,
  dirty,
}: ModalOverlayProps) => {
  const mouseDownOnBackdrop = useRef(false);

  // ✕·바깥 클릭·Esc/뒤로 가기 세 경로를 이 닫기 요청 하나로 모은다(미저장 가드 — dirty 가 없으면 곧바로 onClose).
  const requestClose = useGuardedClose(dirty, onClose);

  // 안드로이드 뒤로가기로 이 모달을 닫는다. requestClose 는 dirty·onClose 를 늦게 읽고,
  // 백스택 push/remove 는 isOpen 전환 시에만 실행해 스택 순서가 렌더로 흔들리지 않게 한다.
  const onCloseRef = useRef(requestClose);
  onCloseRef.current = requestClose;

  // 같은 항목이 PC Esc 도 받는다(닫기 관문 — 맨 위 한 겹만, BackStackService). 예전의 자체 window
  // 캡처 Esc 리스너는 아래·위 창과 동시에 닫히는 원인이라 없앴다(2026-10-03 U1·X2).
  useEffect(() => {
    if (!isOpen) return;
    const handle = backStackService.push(() => onCloseRef.current());
    return () => handle.remove();
  }, [isOpen]);

  // 모달 열림/닫힘 시 카운터 관리 (드래그 오버레이 억제용)
  useEffect(() => {
    if (isOpen) {
      appState.incrementModalOverlay();
      return () => appState.decrementModalOverlay();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // 창 틀(폭·높이) — 단일 출처 models/overlaySizes.ts. size 가 없으면 옛 width 클래스 그대로(동작 불변).
  const frame = resolveOverlayFrame({ size, width, fullscreen, mobile: isMobile });
  const columns = (sideTabs != null || aside != null) && overlayUsesColumns(frame, isMobile);
  // 본문: 옛 경로는 클래스 그대로(글자 하나까지), 등급 경로는 고정 높이에서도 줄어들게 min-h-0 를 더한다.
  const bodyClass =
    frame.mode === 'full'
      ? 'flex-1 min-h-0 overflow-hidden'
      : frame.mode === 'legacy'
        ? bodyPadding === 'none'
          ? 'flex-1 overflow-auto'
          : 'flex-1 overflow-auto p-5'
        : 'flex-1 min-h-0 overflow-auto' + (bodyPadding === 'none' ? '' : ' p-5');

  return (
    <div
      className={
        'fixed inset-0 flex items-center justify-center' +
        (hidden ? ' opacity-0 pointer-events-none' : '')
      }
      style={{
        zIndex: zIndex ?? 'var(--z-modal)',
        backgroundColor: 'rgba(0, 0, 0, 0.3)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
      onMouseDown={(e) => {
        // mousedown이 backdrop 자체에서 시작된 경우만 기록
        mouseDownOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        // mousedown도 backdrop에서 시작되고 click도 backdrop인 경우에만 닫기
        // (드래그로 밖에 나갔다 놓는 경우 방지)
        if (e.target === e.currentTarget && mouseDownOnBackdrop.current) {
          requestClose();
        }
        mouseDownOnBackdrop.current = false;
      }}
    >
      <div
        className={frame.className}
        style={frame.style}
        data-modal-fullscreen={frame.mode === 'full' ? '' : undefined}
        data-modal-size={frame.mode === 'size' ? frame.size : undefined}
      >
        {/* 타이틀 바 */}
        <div className="flex items-center justify-between px-5 py-3 border-b line-color flex-none">
          <h2 className="text-base font-semibold text-default">
            {title}
          </h2>
          <button
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-slate-600 text-muted transition-colors"
            onClick={requestClose}
            aria-label="닫기"
          >
            <FaTimes size={16} />
          </button>
        </div>
        {/* 도구줄 — 스크롤 밖 고정 */}
        {toolbar != null && (
          <div
            className="flex-none flex flex-wrap items-center gap-2 px-5 py-2 border-b line-color"
            data-modal-slot="toolbar"
          >
            {toolbar}
          </div>
        )}
        {/* 콘텐츠 — 두 열(세로 탭·왼쪽 목록)이면 열마다 따로 스크롤 */}
        {columns ? (
          <div className="flex-1 min-h-0 flex" data-modal-slot="columns">
            {sideTabs != null && (
              <nav
                className="flex-none overflow-auto border-r line-color py-2"
                style={{ width: OVERLAY_SIDE_TABS_WIDTH }}
                data-modal-slot="side-tabs"
              >
                {sideTabs}
              </nav>
            )}
            {aside != null && (
              <div
                className="flex-none overflow-auto border-r line-color"
                style={{ width: OVERLAY_ASIDE_WIDTH }}
                data-modal-slot="aside"
              >
                {aside}
              </div>
            )}
            <div className={'flex-1 min-w-0 ' + bodyClass} data-modal-slot="body">
              {children}
            </div>
          </div>
        ) : (
          <div className={bodyClass} data-modal-slot={frame.mode === 'size' ? 'body' : undefined}>
            {aside != null && (
              <div className="pb-3 mb-3 border-b line-color" data-modal-slot="aside">
                {aside}
              </div>
            )}
            {children}
          </div>
        )}
        {/* 바닥줄 — 스크롤 밖 고정. 왼쪽 = 위험 버튼, 오른쪽 = 확정·취소 */}
        {(footer != null || footerStart != null) && (
          <div
            className="flex-none flex items-center gap-2 px-5 py-3 border-t line-color"
            data-modal-slot="footer"
          >
            {footerStart != null && <div className="flex items-center gap-2">{footerStart}</div>}
            <div className="ml-auto flex items-center gap-2">{footer}</div>
          </div>
        )}
      </div>
    </div>
  );
};

// 등급 경로 본문(data-modal-slot="body")을 맨 위로 — 창 안 탭·범위 전환 때 이전 스크롤 위치가 남지 않게
// (2026-11-11 실기 피드백 1 ③). from = 본문 안의 아무 요소(호출부가 ref 로 잡은 내용 뿌리). 본문이 없으면 무동작.
export function scrollOverlayBodyToTop(from: Element | null | undefined) {
  const body = from?.closest('[data-modal-slot="body"]');
  if (body) body.scrollTop = 0;
}

export default ModalOverlay;
