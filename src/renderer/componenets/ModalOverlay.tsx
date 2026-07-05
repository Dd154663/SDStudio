import React, { ReactNode, useEffect, useCallback, useRef } from 'react';
import { FaTimes } from 'react-icons/fa';
import { appState } from '../models/AppService';
import { backStackService } from '../models/BackStackService';

interface ModalOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: string;
  // 마운트는 유지한 채 시각적으로만 숨김 — 내용물이 드래그 소스일 때
  // 드래그 도중 언마운트하면 드래그가 끊기므로 이 경로를 쓴다.
  hidden?: boolean;
}

const ModalOverlay = ({
  isOpen,
  onClose,
  title,
  children,
  width = 'max-w-xl',
  hidden,
}: ModalOverlayProps) => {
  const mouseDownOnBackdrop = useRef(false);

  // 안드로이드 뒤로가기로 이 모달을 닫는다. onClose 는 매 렌더마다 새 함수일 수
  // 있으므로 ref 로 최신값을 보관하고, 백스택 push/remove 는 isOpen 전환 시에만
  // 실행해 스택 순서가 렌더로 흔들리지 않게 한다.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    const handle = backStackService.push(() => onCloseRef.current());
    return () => handle.remove();
  }, [isOpen]);

  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (isOpen) {
      window.addEventListener('keydown', handleEscape, true);
      return () => window.removeEventListener('keydown', handleEscape, true);
    }
  }, [isOpen, handleEscape]);

  // 모달 열림/닫힘 시 카운터 관리 (드래그 오버레이 억제용)
  useEffect(() => {
    if (isOpen) {
      appState.incrementModalOverlay();
      return () => appState.decrementModalOverlay();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className={
        'fixed inset-0 flex items-center justify-center' +
        (hidden ? ' opacity-0 pointer-events-none' : '')
      }
      style={{
        zIndex: 2000,
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
          onClose();
        }
        mouseDownOnBackdrop.current = false;
      }}
    >
      <div
        className={`${width} w-[90vw] max-h-[85vh] bg-[var(--c-zone)] rounded-xl shadow-2xl flex flex-col overflow-hidden border line-color`}
      >
        {/* 타이틀 바 */}
        <div className="flex items-center justify-between px-5 py-3 border-b line-color flex-none">
          <h2 className="text-base font-semibold text-default">
            {title}
          </h2>
          <button
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-slate-600 text-muted transition-colors"
            onClick={onClose}
          >
            <FaTimes size={16} />
          </button>
        </div>
        {/* 콘텐츠 */}
        <div className="flex-1 overflow-auto p-5">{children}</div>
      </div>
    </div>
  );
};

export default ModalOverlay;
