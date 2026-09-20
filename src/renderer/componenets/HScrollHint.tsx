import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FaChevronLeft, FaChevronRight } from 'react-icons/fa';

// 가로 스크롤 힌트 — 스크롤바를 숨긴 가로 스크롤 행에서, 각 방향에 가려진 항목이 있을 때만
// 양 끝에 옅은 화살표를 띄운다(표시 전용, 클릭 무반응). 환경설정 탭 바에서 쓰던 것을
// 공용화했다(2026-09-20). SPEC_GUIDE §6-4.

export interface HScrollHintState {
  left: boolean;
  right: boolean;
}

export function calcHScrollHint(el: {
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
}): HScrollHintState {
  return {
    left: el.scrollLeft > 2,
    right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2,
  };
}

/** ref 를 스크롤 요소에, onScroll 을 그 요소의 onScroll 에 연결한다. */
export function useHScrollHint<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);
  const [hint, setHint] = useState<HScrollHintState>({
    left: false,
    right: false,
  });
  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const next = calcHScrollHint(el);
    setHint((prev) =>
      prev.left === next.left && prev.right === next.right ? prev : next,
    );
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    return () => ro.disconnect();
  }, [update]);
  // 내용(버튼 수)이 바뀌어도 컨테이너 크기는 그대로라 ResizeObserver 가 못 잡는다 →
  // 렌더마다 다시 계산한다. 값이 같으면 setState 를 건너뛰므로 루프가 되지 않는다.
  useEffect(() => {
    update();
  });
  return { ref, hint, onScroll: update };
}

interface HScrollHintArrowProps {
  side: 'left' | 'right';
  /** 행이 놓인 면의 배경색(그라데이션 시작색). 예: 'var(--c-zone)' */
  surface: string;
  /** 위치 클래스 재정의(기본: 해당 쪽 가장자리). 예: sticky 버튼 왼쪽에 붙일 때 'right-full' */
  positionClass?: string;
}

export const HScrollHintArrow = ({
  side,
  surface,
  positionClass,
}: HScrollHintArrowProps) => (
  <div
    aria-hidden="true"
    className={`absolute top-0 bottom-0 w-5 flex items-center pointer-events-none ${
      side === 'left' ? 'justify-start pl-1' : 'justify-end pr-1'
    } ${positionClass ?? (side === 'left' ? 'left-0' : 'right-0')}`}
    style={{
      background: `linear-gradient(to ${side === 'left' ? 'right' : 'left'}, ${surface}, transparent)`,
    }}
  >
    {side === 'left' ? (
      <FaChevronLeft size={9} className="text-faint" />
    ) : (
      <FaChevronRight size={9} className="text-faint" />
    )}
  </div>
);
