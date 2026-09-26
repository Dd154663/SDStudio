import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PresetFocusContext, WFI_KEY_ATTR } from './MobilePromptSheet';
import { PromptAutoExpandContext } from './PromptAutoExpand';

/**
 * 클래식 모바일 프롬프트 창(FloatView)용 집중 모드 껍데기(2026-09-27, 모바일 V2 「인라인 편집기」 부위).
 * V2 하단 시트의 집중 모드와 같은 규칙을 시트 없이 제공한다:
 *  · 키보드 판정 = 이 껍데기의 높이가 같은 폭에서 본 최대 높이보다 PROMPT_FOCUS_KBD_SHRINK_PX 넘게 줄면 kbdOpen.
 *  · 포커스 판정 = 본문 안 `data-wfi-key` 래퍼 아래에 포커스가 있으면 그 키. 밖으로 나가면 해제(칸 사이 이동은 유지).
 *  · 키보드가 떠 있는 동안은 포커스가 풀려도 마지막 키를 붙잡아(heldKey) 키보드가 내려가는 렌더에서 한 번에 해제.
 * PresetRootRender 는 공급자가 있으면 요소마다 래퍼를 두고, 집중 키가 있으면 그 칸만 보이고 머리줄(칸 이름+완료)을 그린다.
 * V2 시트(MobilePromptSheet)가 있는 배치에서는 시트가 공급자라 이 껍데기를 쓰지 않는다.
 */
export const PROMPT_FOCUS_KBD_SHRINK_PX = 120;

export const PromptFocusShell = ({ children }: { children: React.ReactNode }) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [kbdOpen, setKbdOpen] = useState(false);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const heldKeyRef = useRef<string | null>(null);
  if (focusKey != null) heldKeyRef.current = focusKey;

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    let maxH = 0;
    let width = window.innerWidth;
    const measure = () => {
      const h = el.clientHeight;
      if (window.innerWidth !== width) {
        width = window.innerWidth;
        maxH = 0;
      }
      maxH = Math.max(maxH, h);
      setKbdOpen(maxH - h > PROMPT_FOCUS_KBD_SHRINK_PX);
    };
    measure();
    window.addEventListener('resize', measure);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(el);
    return () => {
      window.removeEventListener('resize', measure);
      ro?.disconnect();
    };
  }, []);

  const onFocus = (e: React.FocusEvent) => {
    const host = (e.target as HTMLElement | null)?.closest?.(`[${WFI_KEY_ATTR}]`) as HTMLElement | null;
    setFocusKey(host?.getAttribute(WFI_KEY_ATTR) || null);
  };
  const onBlur = (e: React.FocusEvent) => {
    const next = e.relatedTarget as Node | null;
    if (next && e.currentTarget.contains(next)) return;
    setFocusKey(null);
  };
  const done = () => {
    const active = document.activeElement as HTMLElement | null;
    if (active && typeof active.blur === 'function') active.blur();
  };

  if (!kbdOpen) heldKeyRef.current = null;
  const activeKey = focusKey ?? heldKeyRef.current;
  const key = kbdOpen && activeKey != null ? activeKey : null;
  const ctx = useMemo(() => ({ key, done }), [key]);

  return (
    <div
      ref={rootRef}
      className="h-full w-full"
      data-prompt-focus-shell={key != null ? 'on' : 'off'}
      onFocusCapture={onFocus}
      onBlurCapture={onBlur}
    >
      <PresetFocusContext.Provider value={ctx}>
        <PromptAutoExpandContext.Provider value={false}>{children}</PromptAutoExpandContext.Provider>
      </PresetFocusContext.Provider>
    </div>
  );
};

export default PromptFocusShell;
