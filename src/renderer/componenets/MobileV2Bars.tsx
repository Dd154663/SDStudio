import React, { ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { appState } from '../models/AppService';
import { backStackService } from '../models/BackStackService';
import { tierRows } from '../models/mobileV2';

// 모바일 V2 의 하단 메인 줄(탭 바 모양)과 "위로 밀기 빠른 실행"(2026-09-21).
//  · 메인 줄: 아이콘+이름이 세로로 놓인 같은 폭의 칸. 칸 구성은 고정(사용자 결정) — 길게 눌러 이동 대상이 아니다.
//  · 위로 밀기: 같은 기능의 "빠른 변형"이 있는 칸에만 단다. 누르는 순간 칸 위로 안내 기둥이 솟고 화살표가 아래→위로 흐른다.
//    40px 이상 세로 우세로 밀면 기둥이 차며 「놓으면 실행」, 그 상태에서 떼면 빠른 실행. 다시 내리면 취소(탭 동작도 실행 안 함).
//    계약: 밀기는 지름길일 뿐(같은 기능에 탭 경로로도 닿아야 함), 삭제류에는 달지 않는다.
export const V2_SWIPE_UP_PX = 40;
const TRACK_H = 112;

export interface V2SlotDef {
  key: string;
  name: string;
  icon: React.ReactNode;
  onTap: (e: React.MouseEvent) => void;
  /** 위로 밀기 빠른 실행(선택) */
  swipeUp?: { name: string; run: () => void };
  tone?: 'default' | 'accent' | 'danger';
  disabled?: boolean;
  badge?: React.ReactNode;
  /** 이 칸이 펼쳐 둔 것(더보기 둘째 줄)이 열려 있는가 — 강조 + aria-expanded */
  expanded?: boolean;
}

/** 위로 밀기 판정: 세로 이동이 기준을 넘고 가로보다 우세한가. */
export function isSwipeUpArmed(dx: number, dy: number): boolean {
  return dy >= V2_SWIPE_UP_PX && dy > Math.abs(dx) * 1.2;
}

const SwipeHint: React.FC<{
  rect: DOMRect;
  name: string;
  armed: boolean;
  progress: number;
}> = ({ rect, name, armed, progress }) => {
  const cx = Math.round(rect.left + rect.width / 2);
  const w = Math.max(72, Math.round(rect.width) + 12);
  return createPortal(
    <div className="fixed inset-0 pointer-events-none z-[var(--z-context-menu)]" data-v2-swipe-hint="">
      <div
        className="v2-swipe-glow absolute"
        style={{
          left: cx,
          top: Math.round(rect.top - TRACK_H - 34),
          width: w + 110,
          height: TRACK_H + 90,
          background: `radial-gradient(closest-side, rgba(14,165,233,${armed ? 0.55 : 0.32}), rgba(14,165,233,0))`,
        }}
      />
      <div
        className={`v2-swipe-track absolute overflow-hidden rounded-[14px] border-[1.5px] bg-[var(--c-surface-2)] shadow-[0_8px_24px_rgba(0,0,0,0.4)] flex flex-col items-center justify-between px-1 pt-2 pb-1.5${
          armed ? ' v2-swipe-armed' : ''
        }`}
        data-armed={armed ? '1' : '0'}
        style={{
          left: cx,
          top: Math.round(rect.top - TRACK_H - 4),
          width: w,
          height: TRACK_H,
          borderColor: armed ? 'rgb(14,165,233)' : 'rgba(14,165,233,0.45)',
        }}
      >
        <div
          className="absolute left-0 right-0 bottom-0"
          style={{
            height: `${Math.round((armed ? 1 : progress * 0.55) * 100)}%`,
            opacity: armed ? 1 : 0.35 + progress * 0.4,
            background: 'linear-gradient(to top, rgb(14,165,233), rgba(14,165,233,0.35))',
            transition: 'height 0.08s linear, opacity 0.12s',
          }}
        />
        <div
          className={`relative text-xs font-bold leading-[14px] text-center whitespace-nowrap ${
            armed ? 'text-white' : 'text-default'
          }`}
        >
          {armed ? '놓으면 실행' : name}
        </div>
        {!armed && (
          <div className="v2-swipe-flow relative flex-1 w-full text-sky-400">
            <i>⌃</i>
            <i>⌃</i>
            <i>⌃</i>
          </div>
        )}
        <div
          className={`relative text-[10px] leading-3 whitespace-nowrap ${
            armed ? 'text-white' : 'text-faint'
          }`}
        >
          {armed ? '✓' : '위로 밀기'}
        </div>
      </div>
    </div>,
    document.body,
  );
};

const V2Slot: React.FC<{ def: V2SlotDef }> = ({ def }) => {
  const ref = useRef<HTMLButtonElement | null>(null);
  const gesture = useRef<{ x: number; y: number; moved: boolean; armed: boolean } | null>(null);
  const skipClick = useRef(false);
  const [hint, setHint] = useState<{ rect: DOMRect; armed: boolean; progress: number } | null>(null);
  const [lift, setLift] = useState(0);
  const swipe = def.swipeUp;

  useEffect(() => () => setHint(null), []);

  const end = (run: boolean) => {
    const g = gesture.current;
    gesture.current = null;
    setHint(null);
    setLift(0);
    if (!g) return;
    // 밀었다면(실행이든 취소든) 뒤따르는 click(기본 동작)은 삼킨다
    if (g.moved || g.armed) {
      skipClick.current = true;
      setTimeout(() => {
        skipClick.current = false;
      }, 400);
    }
    if (run && g.armed && swipe) swipe.run();
  };

  const tone =
    def.tone === 'danger'
      ? 'text-red-500'
      : def.tone === 'accent' || def.expanded
        ? 'text-sky-500'
        : 'text-sub';

  return (
    <button
      ref={ref}
      type="button"
      disabled={def.disabled}
      aria-label={swipe ? `${def.name} (위로 밀면 ${swipe.name})` : def.name}
      aria-expanded={def.expanded === undefined ? undefined : def.expanded}
      data-v2-slot={def.key}
      className={`relative flex-1 basis-0 min-w-0 h-[46px] flex flex-col items-center justify-center gap-px px-0.5 rounded-[10px] clickable select-none disabled:opacity-40 ${tone}`}
      style={{
        touchAction: swipe ? 'none' : undefined,
        background: hint || def.expanded ? 'rgba(14,165,233,0.14)' : 'transparent',
      }}
      onClick={(e) => {
        if (skipClick.current) {
          skipClick.current = false;
          return;
        }
        def.onTap(e);
      }}
      onContextMenu={swipe ? (e) => e.preventDefault() : undefined}
      onPointerDown={
        swipe
          ? (e) => {
              gesture.current = { x: e.clientX, y: e.clientY, moved: false, armed: false };
              if (ref.current) {
                setHint({ rect: ref.current.getBoundingClientRect(), armed: false, progress: 0 });
              }
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch (err) {
                /* 합성 이벤트 등 캡처 불가 — 무시 */
              }
            }
          : undefined
      }
      onPointerMove={
        swipe
          ? (e) => {
              const g = gesture.current;
              if (!g || !ref.current) return;
              const dx = e.clientX - g.x;
              const dy = g.y - e.clientY;
              if (Math.abs(dx) > 10 || Math.abs(dy) > 10) g.moved = true;
              g.armed = isSwipeUpArmed(dx, dy);
              setLift(Math.round(Math.max(0, Math.min(dy, 30)) * 0.6));
              setHint({
                rect: ref.current.getBoundingClientRect(),
                armed: g.armed,
                progress: Math.max(0, Math.min(1, dy / V2_SWIPE_UP_PX)),
              });
            }
          : undefined
      }
      onPointerUp={swipe ? () => end(true) : undefined}
      onPointerCancel={swipe ? () => end(false) : undefined}
    >
      {swipe && (
        <span className="absolute top-0 left-1/2 -translate-x-1/2 text-[8px] leading-[8px] opacity-55 pointer-events-none">
          ▲
        </span>
      )}
      <span
        className="h-5 flex items-center justify-center text-[17px] leading-5"
        style={{ transform: lift ? `translateY(-${lift}px)` : undefined }}
      >
        {def.icon}
      </span>
      <span className="text-[11px] leading-[13px] whitespace-nowrap max-w-full truncate">
        {def.name}
        {def.badge}
      </span>
      {hint && swipe && (
        <SwipeHint rect={hint.rect} name={swipe.name} armed={hint.armed} progress={hint.progress} />
      )}
    </button>
  );
};

export interface V2TierItem {
  id: string;
  /** 칸 라벨(레지스트리 v2Label ?? name) */
  label: string;
  /** 기존 툴바 버튼 노드 그대로(onClick 재배선 없음 — ToolbarOverflowMenu 와 같은 원칙) */
  node: ReactNode;
}

// 더보기 둘째 줄(2계층, 2026-09-24 사용자 제안·목업 검수): 창을 여는 대신 메인 줄 바로 위에 같은 모양의 칸 줄이
// 덮어 올라온다(본문을 밀지 않음). perRow 를 넘으면 줄을 더 쌓고, 남는 칸은 빈 칸으로 채워 칸 폭을 고정한다.
// 접힘 = 도구 실행 · 줄 밖 탭(백드롭이 탭을 흡수 — 더보기 재탭·메인 줄 다른 칸도 여기 해당) · Android 뒤로 가기 · Escape.
// 부모는 position:relative 인 메인 줄 래퍼여야 한다(bottom-full 로 그 위에 붙는다).
export const V2TierRows: React.FC<{
  open: boolean;
  onClose: () => void;
  items: V2TierItem[];
  perRow: number;
}> = ({ open, onClose, items, perRow }) => {
  const tierRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return undefined;
    const handle = backStackService.push(onClose);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    // 백드롭이 못 덮는 곳(다른 쌓임 맥락의 상단 바·하단 바 등)을 탭해도 접힌다 — 그쪽 동작은 막지 않는다.
    // click 단계에 듣는 이유: pointerdown 에서 접으면 백드롭이 먼저 사라져 그 아래 요소가 click 을 받는다.
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (t && tierRef.current?.contains(t)) return;
      if (t instanceof Element && t.closest('[data-v2-tier-back]')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('click', onDocClick, true);
    return () => {
      handle.remove();
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('click', onDocClick, true);
    };
  }, [open, onClose]);

  if (!open) return null;
  const cellClass =
    'relative flex-1 basis-0 min-w-0 h-[46px] flex flex-col items-center justify-center gap-px px-0.5 rounded-[10px] select-none text-sub';
  return (
    <>
      <div
        data-v2-tier-back=""
        className="fixed inset-0 z-10"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div
        ref={tierRef}
        data-v2-tier=""
        data-edge-swipe-ignore=""
        className="absolute left-0 right-0 bottom-full z-20 flex flex-col bg-[var(--c-zone)] border-t line-color shadow-[0_-6px_16px_rgba(0,0,0,0.25)]"
      >
        {tierRows(items, perRow).map((row, ri) => (
          <div
            // eslint-disable-next-line react/no-array-index-key
            key={ri}
            data-v2-tier-row=""
            className="flex items-center gap-0.5 px-1 pt-[3px] pb-0.5"
          >
            {row.map((item, ci) =>
              item ? (
                <div
                  key={item.id}
                  data-v2-tier-cell={item.id}
                  className={`v2-tier-cell clickable ${cellClass}`}
                  onClick={(e) => {
                    // 편집 모드 중에는 기능 오발 방지(ToolbarOverflowMenu 와 동일)
                    if (appState.editMode) {
                      e.preventDefault();
                      e.stopPropagation();
                      return;
                    }
                    const target = e.target as HTMLElement;
                    if (!target.closest('button')) {
                      // 라벨/여백 탭 → 칸 안의 실제 버튼으로 위임. click() 이 버블로 다시 들어와 아래에서 접힌다.
                      e.currentTarget.querySelector('button')?.click();
                      return;
                    }
                    // 버튼 탭: 버블 단계라 버튼 자신의 onClick 이 먼저 실행된 뒤 접힘
                    onClose();
                  }}
                >
                  <div className="h-5 flex items-center justify-center">{item.node}</div>
                  <span className="text-[11px] leading-[13px] whitespace-nowrap max-w-full truncate">
                    {item.label}
                  </span>
                </div>
              ) : (
                <div
                  // eslint-disable-next-line react/no-array-index-key
                  key={`blank-${ci}`}
                  data-v2-tier-blank=""
                  aria-hidden="true"
                  className={`invisible ${cellClass}`}
                />
              ),
            )}
          </div>
        ))}
      </div>
    </>
  );
};

export const V2MainRow: React.FC<{ slots: V2SlotDef[]; selecting?: boolean }> = ({
  slots,
  selecting,
}) => (
  <div
    data-v2-main-row={selecting ? 'select' : 'main'}
    data-edge-swipe-ignore=""
    className="flex-none flex items-center gap-0.5 px-1 pt-[3px] pb-0.5 border-t line-color"
    style={{ background: selecting ? 'rgba(14,165,233,0.10)' : undefined }}
  >
    {slots.map((def) => (
      <V2Slot key={def.key} def={def} />
    ))}
  </div>
);
