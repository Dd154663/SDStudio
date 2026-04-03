import React, { ReactNode, useEffect, useCallback } from 'react';
import { FaTimes } from 'react-icons/fa';

interface ModalOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: string;
}

const ModalOverlay = ({
  isOpen,
  onClose,
  title,
  children,
  width = 'max-w-xl',
}: ModalOverlayProps) => {
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

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{
        zIndex: 2000,
        backgroundColor: 'rgba(0, 0, 0, 0.3)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
      onClick={onClose}
    >
      <div
        className={`${width} w-[90vw] max-h-[85vh] bg-white dark:bg-slate-800 rounded-xl shadow-2xl flex flex-col overflow-hidden border border-gray-200 dark:border-slate-600`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 타이틀 바 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-slate-600 flex-none">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">
            {title}
          </h2>
          <button
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-500 dark:text-gray-400 transition-colors"
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
