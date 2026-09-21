import React, { createContext, useEffect, useRef, useState } from 'react';
import { FaChevronUp } from 'react-icons/fa';
import { backStackService } from '../models/BackStackService';
import {
  V2SheetState,
  V2_SHEET_PEEK_PX,
  nearestSheetState,
  nextSheetState,
  prevSheetState,
} from '../models/mobileV2';

// 모바일 V2 의 하단 시트 프롬프트(2026-09-21). 클래식의 「프롬프트 열기」 전체 화면을 대신한다.
//  · 접힘(44px) → 반 → 전체. 손잡이를 탭하면 다음 단계, 끌면 가장 가까운 단계에 붙는다.
//  · 반 = 빠른 수정(상위·추가 프롬프트+시드만, PresetCompactContext), 전체 = 패널 전부.
//    프롬프트 도구(찾기 및 변환·작가 분해)는 시트가 아니라 메인 줄의 더보기에 둔다(2026-09-21 실기기 피드백).
//  · 열려 있는 동안 Android 뒤로 가기는 한 단계씩 접는다. 배경(딤)을 누르면 접힘.
//  · 부모(TabComponent 루트, relative)의 바닥에 붙는다. 부모 높이가 곧 "전체" 높이.
// 패널 본문은 접힘 상태에서는 마운트하지 않는다(클래식도 닫혀 있을 때는 마운트하지 않음 — 비용 동일).

/** true 면 프리셋 패널이 빠른 수정용 요소만 그린다(PreSetEdtior 의 PresetRootRender 가 읽는다). */
export const PresetCompactContext = createContext(false);

const HALF_RATIO = 0.56;
const DRAG_TAP_PX = 6;

const MobilePromptSheet: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<V2SheetState>('peek');
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const [containerH, setContainerH] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  // 부모 높이 추적(회전·키보드·상단 선반 펼침에 반응)
  useEffect(() => {
    const parent = rootRef.current?.parentElement;
    if (!parent) return undefined;
    const measure = () => setContainerH(parent.clientHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);

  // 열려 있는 동안 뒤로 가기 = 한 단계 접기
  useEffect(() => {
    if (state === 'peek') return undefined;
    const handle = backStackService.push(() => {
      setState(prevSheetState(stateRef.current));
    });
    return () => handle.remove();
  }, [state]);

  const heights: Record<V2SheetState, number> = {
    peek: V2_SHEET_PEEK_PX,
    half: Math.max(V2_SHEET_PEEK_PX, Math.round(containerH * HALF_RATIO)),
    full: Math.max(V2_SHEET_PEEK_PX, containerH),
  };
  const heightsRef = useRef(heights);
  heightsRef.current = heights;

  // 손잡이 끌기(포인터 캡처). 6px 미만이면 탭으로 본다.
  const drag = useRef<{ startY: number; startH: number; moved: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { startY: e.clientY, startH: heightsRef.current[stateRef.current], moved: false };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch (err) {
      /* 합성 이벤트 등 캡처 불가 — 무시 */
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dy = d.startY - e.clientY;
    if (Math.abs(dy) > DRAG_TAP_PX) d.moved = true;
    if (!d.moved) return;
    const h = heightsRef.current;
    setDragHeight(Math.max(h.peek, Math.min(h.full, d.startH + dy)));
  };
  const endDrag = (commit: boolean) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!commit) {
      setDragHeight(null);
      return;
    }
    if (!d.moved) {
      setState(nextSheetState(stateRef.current));
    } else if (dragHeight != null) {
      setState(nearestSheetState(dragHeight, heightsRef.current));
    }
    setDragHeight(null);
  };

  const open = state !== 'peek';
  const height = dragHeight ?? heights[state];
  // 끄는 동안에는 도착할 상태 기준으로 본문을 미리 그려 둔다(접힘에서 끌어올릴 때 빈 시트가 보이지 않게)
  const bodyState: V2SheetState =
    dragHeight != null ? nearestSheetState(Math.max(dragHeight, heights.half), heights) : state;
  const showBody = open || dragHeight != null;

  return (
    <>
      <div
        aria-hidden="true"
        className="absolute inset-0 z-30 bg-black/35 transition-opacity duration-200"
        style={{ opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none' }}
        onClick={() => setState('peek')}
      />
      <div
        ref={rootRef}
        data-v2-sheet={state}
        data-edge-swipe-ignore=""
        className="absolute left-0 right-0 bottom-0 z-40 flex flex-col overflow-hidden rounded-t-2xl border-t line-color bg-[var(--c-zone)] shadow-[0_-6px_20px_rgba(0,0,0,0.35)]"
        style={{
          height,
          transition: dragHeight != null ? 'none' : 'height 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        <div
          role="button"
          aria-label="프롬프트 시트 열기/닫기"
          aria-expanded={open}
          className="flex-none select-none cursor-grab px-3 pt-1.5"
          style={{ height: V2_SHEET_PEEK_PX, touchAction: 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => endDrag(true)}
          onPointerCancel={() => endDrag(false)}
        >
          <div className="mx-auto mb-1.5 h-1 w-9 rounded-full bg-[var(--c-line)]" />
          <div className="flex items-center gap-2 text-sm">
            <span className="round-tag back-gray flex-none !px-2 !py-0 text-[11px] rounded-md">
              프롬프트
            </span>
            <span className="flex-1 min-w-0 truncate text-sub">
              {state === 'peek'
                ? '눌러서 빠른 수정, 한 번 더 눌러 전체 보기'
                : state === 'half'
                  ? '빠른 수정 — 한 번 더 눌러 전체 보기'
                  : '전체 — 눌러서 접기'}
            </span>
            <FaChevronUp
              size={11}
              className="flex-none text-faint transition-transform duration-200"
              style={{ transform: state === 'full' ? 'rotate(180deg)' : undefined }}
            />
          </div>
        </div>
        {showBody && (
          <div className="flex-1 min-h-0 overflow-hidden">
            <PresetCompactContext.Provider value={bodyState !== 'full'}>
              {children}
            </PresetCompactContext.Provider>
          </div>
        )}
      </div>
    </>
  );
};

export default MobilePromptSheet;
