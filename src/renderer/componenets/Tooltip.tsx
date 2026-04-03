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
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => {
      const el = triggerRef.current;
      if (el) {
        // display:contents makes the wrapper have no box, so use the first child's rect
        const child = el.firstElementChild as HTMLElement | null;
        const rect = child
          ? child.getBoundingClientRect()
          : el.getBoundingClientRect();
        setTriggerRect(rect);
        setVisible(true);
      }
    }, delay);
  }, [delay]);

  const hide = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setVisible(false);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (!content) return <>{children}</>;

  return (
    <span
      ref={triggerRef}
      onMouseEnter={show}
      onMouseLeave={hide}
      onMouseDown={hide}
      className="contents"
    >
      {children}
      {visible && triggerRect && (
        <TooltipPortal
          content={content}
          triggerRect={triggerRect}
          placement={placement}
        />
      )}
    </span>
  );
};

export default Tooltip;
