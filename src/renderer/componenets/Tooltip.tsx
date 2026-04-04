import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  ReactNode,
} from 'react';
import ReactDOM from 'react-dom';

interface TooltipProps {
  content: string;
  children: ReactNode;
  delay?: number;
  placement?: 'top' | 'bottom';
}

const TooltipPortal = ({
  content,
  triggerRect,
  placement,
}: {
  content: string;
  triggerRect: DOMRect;
  placement: 'top' | 'bottom';
}) => {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    const el = tooltipRef.current;
    if (!el) return;
    const tt = el.getBoundingClientRect();
    const winW = window.innerWidth;
    const winH = window.innerHeight;

    // horizontal center aligned to trigger
    let left = triggerRect.left + triggerRect.width / 2 - tt.width / 2;
    if (left < 6) left = 6;
    if (left + tt.width > winW - 6) left = winW - 6 - tt.width;

    // vertical: prefer placement, flip if needed
    let top: number;
    if (placement === 'top') {
      top = triggerRect.top - tt.height - 6;
      if (top < 6) top = triggerRect.bottom + 6;
    } else {
      top = triggerRect.bottom + 6;
      if (top + tt.height > winH - 6) top = triggerRect.top - tt.height - 6;
    }

    setPos({ left, top });
  }, [triggerRect, placement]);

  return ReactDOM.createPortal(
    <div
      ref={tooltipRef}
      className="fixed pointer-events-none whitespace-pre-wrap max-w-xs tooltip-animate"
      style={{
        zIndex: 9999,
        left: pos ? pos.left : -9999,
        top: pos ? pos.top : -9999,
      }}
    >
      <div className="bg-gray-900 dark:bg-gray-800 text-white text-sm px-2.5 py-1.5 rounded-md shadow-lg border border-gray-600 dark:border-gray-500">
        {content}
      </div>
    </div>,
    document.body,
  );
};

const Tooltip = ({
  content,
  children,
  delay = 200,
  placement = 'bottom',
}: TooltipProps) => {
  const [visible, setVisible] = useState(false);
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);
  const [activePlacement, setActivePlacement] = useState(placement);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchHideRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const placementRef = useRef(placement);

  const showTooltip = useCallback(() => {
    const el = triggerRef.current;
    if (el) {
      const child = el.firstElementChild as HTMLElement | null;
      const rect = child
        ? child.getBoundingClientRect()
        : el.getBoundingClientRect();
      setTriggerRect(rect);
      setActivePlacement(placementRef.current);
      setVisible(true);
    }
  }, []);

  const show = useCallback(() => {
    placementRef.current = placement;
    timerRef.current = setTimeout(showTooltip, delay);
  }, [delay, showTooltip, placement]);

  const hide = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (touchHideRef.current) {
      clearTimeout(touchHideRef.current);
      touchHideRef.current = null;
    }
    setVisible(false);
  }, []);

  // 모바일: 터치 시 즉시 표시 (상단), 1.5초 후 자동 숨김
  const handleTouchStart = useCallback(() => {
    placementRef.current = 'top';
    showTooltip();
    if (touchHideRef.current) clearTimeout(touchHideRef.current);
    touchHideRef.current = setTimeout(() => {
      setVisible(false);
      touchHideRef.current = null;
    }, 1500);
  }, [showTooltip]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (touchHideRef.current) clearTimeout(touchHideRef.current);
    };
  }, []);

  if (!content) return <>{children}</>;

  return (
    <span
      ref={triggerRef}
      onMouseEnter={show}
      onMouseLeave={hide}
      onMouseDown={hide}
      onTouchStart={handleTouchStart}
      onTouchEnd={hide}
      className="contents"
    >
      {children}
      {visible && triggerRect && (
        <TooltipPortal
          content={content}
          triggerRect={triggerRect}
          placement={activePlacement}
        />
      )}
    </span>
  );
};

export default Tooltip;
