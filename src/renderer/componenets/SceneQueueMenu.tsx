import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FaChevronDown } from 'react-icons/fa';
import { Session } from '../models/types';
import { addScenesToQueue, SceneQueueFilter } from '../models/sceneQueueActions';
import { backStackService } from '../models/BackStackService';

// 툴바 overflow와 하단 도크에서도 잘리지 않도록 포털로 표시한다.
export default function SceneQueueMenu({ children, session, type, selectedOnly }: {
  children: ReactNode;
  session?: Session;
  type: 'scene' | 'inpaint';
  selectedOnly: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const anchor = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const focusRequested = useRef(false);
  const show = () => { if (session) setOpen(true); };

  useEffect(() => { setOpen(false); }, [session, type]);
  useEffect(() => {
    if (!open) return;
    const handle = backStackService.push(() => setOpen(false));
    return () => handle.remove();
  }, [open]);
  useLayoutEffect(() => {
    if (!open || !anchor.current || !panel.current) return;
    const rect = anchor.current.getBoundingClientRect();
    const menu = panel.current.getBoundingClientRect();
    setPosition({
      left: Math.max(4, Math.min(rect.left, window.innerWidth - menu.width - 4)),
      top: rect.bottom + menu.height + 4 <= window.innerHeight
        ? rect.bottom + 4 : Math.max(4, rect.top - menu.height - 4),
    });
    if (focusRequested.current) {
      panel.current.querySelector('button')?.focus({ preventScroll: true });
      focusRequested.current = false;
    }
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!anchor.current?.contains(e.target as Node) && !panel.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); toggle.current?.focus(); }
    };
    const dismiss = () => setOpen(false);
    document.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', escape, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('keydown', escape, true);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [open]);
  const reserve = (filter: SceneQueueFilter) => {
    setOpen(false);
    if (session) void addScenesToQueue(session, type, selectedOnly, filter);
  };
  return <span ref={anchor} className="inline-flex items-center">
    {children}
    <button ref={toggle} type="button" className="round-button back-sky px-1 h-8"
      aria-label="부분 일괄 예약 옵션" aria-expanded={open} disabled={!session}
      onClick={() => { focusRequested.current = !open; setOpen(!open); }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (open) panel.current?.querySelector('button')?.focus({ preventScroll: true });
          else { focusRequested.current = true; show(); }
        }
      }}>
      <FaChevronDown size={10} />
    </button>
    {open && createPortal(<div ref={panel} role="group" aria-label="부분 일괄 예약"
      className="fixed z-[var(--z-widget)] bg-[var(--c-surface-2)] text-default border line-color rounded-lg shadow-lg p-1 flex flex-col gap-1"
      style={{ ...position, maxWidth: 'calc(100vw - 8px)' }}>
      <button type="button" className="btn-ghost text-left px-3 py-2" onClick={() => reserve('empty')}>빈 씬만 일괄 예약</button>
      <button type="button" className="btn-ghost text-left px-3 py-2" onClick={() => reserve('no-favorites')}>즐겨찾기 이미지 없는 씬만 예약</button>
    </div>, document.body)}
  </span>;
}
