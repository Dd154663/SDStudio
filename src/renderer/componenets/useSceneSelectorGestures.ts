import { useEffect, useRef, useState } from 'react';
import {
  applySweepSelection,
  edgeAutoScrollSpeed,
  indicesInBox,
  isOnNativeScrollbar,
} from '../models/dragSelection';

// 씬 선택 창(SceneSelector)의 다중 선택 제스처(2026-09-21).
//  · PC: 목록에서 끌면 상자가 그려지고 걸린 항목이 선택에 "추가"된다.
//  · 터치: 길게 누른 뒤 끌면 시작 카드~현재 카드 범위가 연속 선택(시작 카드가 선택돼 있었으면 연속 해제)된다.
//    길게 누르기 전에 움직이면 평소 스크롤이다.
// 항목은 목록 컨테이너 안에서 data-selector-index 로 찾는다(문서 전역 id 미사용). 계약은 SPEC_GUIDE "드래그 다중 선택".
const BOX_START_PX = 5;
export const SWEEP_HOLD_MS = 350;
const SWEEP_CANCEL_PX = 10;

export interface SelectionBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface Options {
  /** 목록 순서대로의 항목 이름 */
  getNames: () => string[];
  /** 현재 선택된 이름 */
  getSelected: () => ReadonlySet<string>;
  setSelected: (names: ReadonlySet<string>) => void;
}

export function useSceneSelectorGestures({ getNames, getSelected, setSelected }: Options) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState<SelectionBox | null>(null);
  const [sweeping, setSweeping] = useState(false);
  // 드래그·연속 선택 직후의 click 은 삼킨다(선택이 다시 토글되지 않게)
  const suppressClickRef = useRef(false);
  const api = useRef({ getNames, getSelected, setSelected });
  api.current = { getNames, getSelected, setSelected };

  useEffect(() => {
    const list = listRef.current;
    if (!list) return undefined;

    // 목록 내용 좌표(스크롤 포함)로 바꾼다 — 자동 스크롤 중에도 시작점이 고정된다
    const toContent = (clientX: number, clientY: number) => {
      const r = list.getBoundingClientRect();
      return {
        x: clientX - r.left + list.scrollLeft,
        y: clientY - r.top + list.scrollTop,
      };
    };
    const cellRects = () => {
      const r = list.getBoundingClientRect();
      return Array.from(
        list.querySelectorAll<HTMLElement>('[data-selector-index]'),
      ).map((el) => {
        const c = el.getBoundingClientRect();
        return {
          index: Number(el.dataset.selectorIndex),
          left: c.left - r.left + list.scrollLeft,
          top: c.top - r.top + list.scrollTop,
          right: c.right - r.left + list.scrollLeft,
          bottom: c.bottom - r.top + list.scrollTop,
        };
      });
    };
    const indexAt = (clientX: number, clientY: number): number | null => {
      const r = list.getBoundingClientRect();
      const x = Math.max(r.left + 1, Math.min(r.right - 1, clientX));
      const y = Math.max(r.top + 1, Math.min(r.bottom - 1, clientY));
      const hit = document.elementFromPoint(x, y);
      const el = hit ? hit.closest<HTMLElement>('[data-selector-index]') : null;
      return el && list.contains(el) ? Number(el.dataset.selectorIndex) : null;
    };

    // 가장자리 자동 스크롤
    let raf = 0;
    let pointer = { x: 0, y: 0 };
    let onFrame: (() => void) | null = null;
    const loop = () => {
      const r = list.getBoundingClientRect();
      const v = edgeAutoScrollSpeed(pointer.y, r.top, r.bottom);
      if (v !== 0) {
        const before = list.scrollTop;
        list.scrollTop += v;
        if (list.scrollTop !== before && onFrame) onFrame();
      }
      raf = requestAnimationFrame(loop);
    };
    const startLoop = (fn: () => void) => {
      onFrame = fn;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    };
    const stopLoop = () => {
      onFrame = null;
      cancelAnimationFrame(raf);
    };

    // ── PC: 드래그 상자 ──
    let lastTouchAt = 0;
    let boxStart: { x: number; y: number; cx: number; cy: number } | null = null;
    let boxActive = false;
    let boxBase = new Set<string>();
    const updateBox = () => {
      if (!boxStart) return;
      const cur = toContent(pointer.x, pointer.y);
      const next: SelectionBox = { x1: boxStart.x, y1: boxStart.y, x2: cur.x, y2: cur.y };
      setBox(next);
      const names = api.current.getNames();
      const selected = new Set(boxBase);
      for (const i of indicesInBox(cellRects(), next)) {
        if (names[i] != null) selected.add(names[i]);
      }
      api.current.setSelected(selected);
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!boxStart) return;
      pointer = { x: e.clientX, y: e.clientY };
      if (!boxActive) {
        if (
          Math.abs(e.clientX - boxStart.cx) < BOX_START_PX &&
          Math.abs(e.clientY - boxStart.cy) < BOX_START_PX
        ) {
          return;
        }
        boxActive = true;
        boxBase = new Set(api.current.getSelected());
        startLoop(updateBox);
      }
      e.preventDefault();
      updateBox();
    };
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      stopLoop();
      if (boxActive) {
        suppressClickRef.current = true;
        setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      }
      boxStart = null;
      boxActive = false;
      setBox(null);
    };
    const onMouseDown = (e: MouseEvent) => {
      // 터치가 합성한 마우스 이벤트는 무시
      if (e.button !== 0 || Date.now() - lastTouchAt < 1000) return;
      if (isOnNativeScrollbar(e.target as Element, e.clientX, e.clientY)) return;
      const c = toContent(e.clientX, e.clientY);
      boxStart = { x: c.x, y: c.y, cx: e.clientX, cy: e.clientY };
      pointer = { x: e.clientX, y: e.clientY };
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    // ── 터치: 길게 누른 뒤 끌어 연속 선택 ──
    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    let touchStart: { x: number; y: number; index: number } | null = null;
    let sweep: { anchor: number; select: boolean; base: Set<string> } | null = null;
    const clearHold = () => {
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
    };
    const updateSweep = () => {
      if (!sweep) return;
      const cur = indexAt(pointer.x, pointer.y);
      if (cur == null) return;
      api.current.setSelected(
        applySweepSelection(sweep.base, api.current.getNames(), sweep.anchor, cur, sweep.select),
      );
    };
    const onTouchStart = (e: TouchEvent) => {
      lastTouchAt = Date.now();
      clearHold();
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      const index = indexAt(t.clientX, t.clientY);
      if (index == null) return;
      touchStart = { x: t.clientX, y: t.clientY, index };
      pointer = { x: t.clientX, y: t.clientY };
      holdTimer = setTimeout(() => {
        holdTimer = null;
        if (!touchStart) return;
        const base = new Set(api.current.getSelected());
        const anchorName = api.current.getNames()[touchStart.index];
        sweep = { anchor: touchStart.index, select: !base.has(anchorName), base };
        setSweeping(true);
        startLoop(updateSweep);
        updateSweep();
      }, SWEEP_HOLD_MS);
    };
    const onTouchMove = (e: TouchEvent) => {
      lastTouchAt = Date.now();
      const t = e.touches[0];
      if (!t) return;
      pointer = { x: t.clientX, y: t.clientY };
      if (sweep) {
        // 연속 선택 중에는 스크롤 대신 선택(가장자리 자동 스크롤만)
        if (e.cancelable) e.preventDefault();
        updateSweep();
        return;
      }
      if (
        touchStart &&
        (Math.abs(t.clientX - touchStart.x) > SWEEP_CANCEL_PX ||
          Math.abs(t.clientY - touchStart.y) > SWEEP_CANCEL_PX)
      ) {
        // 길게 누르기 전에 움직였으면 평소 스크롤
        clearHold();
        touchStart = null;
      }
    };
    const onTouchEnd = () => {
      lastTouchAt = Date.now();
      clearHold();
      touchStart = null;
      if (sweep) {
        sweep = null;
        stopLoop();
        setSweeping(false);
        // 길게 누른 뒤 뗄 때 따라오는 click 이 시작 카드를 다시 토글하지 않게 한다
        suppressClickRef.current = true;
        setTimeout(() => {
          suppressClickRef.current = false;
        }, 400);
      }
    };
    const onContextMenu = (e: Event) => {
      if (Date.now() - lastTouchAt < 1500) e.preventDefault();
    };

    list.addEventListener('mousedown', onMouseDown);
    list.addEventListener('touchstart', onTouchStart, { passive: true });
    list.addEventListener('touchmove', onTouchMove, { passive: false });
    list.addEventListener('touchend', onTouchEnd);
    list.addEventListener('touchcancel', onTouchEnd);
    list.addEventListener('contextmenu', onContextMenu);
    return () => {
      clearHold();
      stopLoop();
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      list.removeEventListener('mousedown', onMouseDown);
      list.removeEventListener('touchstart', onTouchStart);
      list.removeEventListener('touchmove', onTouchMove);
      list.removeEventListener('touchend', onTouchEnd);
      list.removeEventListener('touchcancel', onTouchEnd);
      list.removeEventListener('contextmenu', onContextMenu);
    };
  }, []);

  return { listRef, box, sweeping, suppressClickRef };
}
