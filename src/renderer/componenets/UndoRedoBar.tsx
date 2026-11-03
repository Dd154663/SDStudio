// 되돌리기/다시 실행 버튼 바(2026-11-03 U6 — D19 결정: 상시 노출, 하단 바 중앙 위쪽 부착).
// 화면 하단 중앙에 작은 탭 모양으로 붙어 [되돌리기][다시 실행] 두 버튼을 늘 보여 준다(되돌릴 것이 없으면 흐리게 비활성).
//
// 부착(2026-11-03 실기 보정 — fixed 측정 → 막대 안 자식): 하단 막대(PC·모바일 하단 바 BottomBar, 모바일 V2 메인 줄
// V2MainRow·더보기 둘째 줄 V2TierRows — 씬 목록·이미지 그리드·상세·씬 편집 창 하단 탭 바가 모두 V2MainRow)가 자기 안에
// 빈 자리 UndoBarSlot(absolute bottom-full left-1/2 -translate-x-1/2)을 둔다. 이 컴포넌트는 App 에 한 번 마운트되어
// 「지금 보이는 막대 중 가장 위의 것」(pickUndoAnchor — 크기 0·FloatView 등에 가려진 막대는 건너뜀. 바 층(--z-widget)
// 이상의 오버레이 — 모달·드로어·확인 창·토스트 등 — 는 바도 함께 덮으므로 가림으로 치지 않고 그 아래를 본다)의 자리를 골라
// createPortal 로 바를 넣는다. 그래서 바 아래 변 = 막대 위 테두리 안쪽(막대의 1px 위 선을 바가 덮어 탭처럼 이어짐), 틈 0.
// 보이는 막대가 없으면(컴팩트 템플릿·하단 줄 없는 모바일 클래식 편집 창) 화면 맨 아래 fixed(safe-area 위)로 대신한다.
// PC = 하단 바 위, 모바일 클래식 = 하단 바 위, 모바일 V2 = 메인 줄 위(더보기 줄이 펼쳐지면 그 위), 편집 창이 하단 바를
// 덮으면 그 창의 하단 줄 위.
//
// 색: 막대와 같은 배경·테두리 — 자리의 색 종류(UndoSlotTone)를 따른다. 하단 바 = zone-bar + --c-surface(PC 새 마감
// md 이상은 App.css 가 zone-bar 를 --c-canvas·투명 테두리로 바꾼다 — 하단 바와 같은 규칙을 그대로 받는다), V2 메인 줄 =
// --c-surface(선택 중이면 같은 하늘색 덮개), 더보기 줄 = --c-zone. 테두리 = line-color(클래식 마감 값 자동). 버튼은 하단 바
// 프로젝트 툴바(SessionSelect)의 무배경 아이콘 버튼과 같은 icon-button touch-hit mx-1(전경색 --c-icon-text).
//
// 층: 자리가 --z-widget(1000) — FloatView(--z-float-view 100) 위·모달(--z-modal 2000) 아래. 설정 화면·모달·드로어·확인
// 창은 그대로 이 바를 덮는다. 모든 막대·대체 위치가 앱 테마 루트(data-app-theme-root) 안이라 다크·커스텀 테마 토큰을 받는다.
// 바가 보이는 동안 :root 의 --undo-bar-top(바 위 모서리의 화면 아래로부터 거리)을 설정 → 토스트(.alert-window)가 그 위로
// 올라간다. 숨으면 지운다.
//
// 숨김: 프로젝트 없음·읽기 전용 미러 프로젝트·파일 드롭 안내 중(suppressed — App 의 dragOverlay)·앱 안 드래그 중
// (react-dnd)·모바일 키보드 칩 표시 중(keyboardChipState)·모바일 V2 시트 키보드 중(하단 바도 숨는 때).
// 되돌리기 로직은 undoService 그대로 — 이 파일은 UI 만.
import { observer } from 'mobx-react-lite';
import { useLayoutEffect, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useDragLayer } from 'react-dnd';
import Tooltip from './Tooltip';
import { ActionIcon } from './ActionIcon';
import { appState } from '../models/AppService';
import { isMobile, sessionService } from '../models';
import { undoService, UNDO_TEXT } from '../models/undoService';
import {
  KeyboardShortcutService,
  keyboardShortcutService,
} from '../models/KeyboardShortcutService';
import { keyboardChipVisible } from '../models/keyboardChipState';
import {
  UNDO_ANCHOR_ATTR,
  UNDO_BAR_HEIGHT_PX,
  UNDO_SLOT_ATTR,
  V2_ROW_SELECT_TINT,
  type UndoSlotTone,
} from './UndoBarSlot';

// 바 높이 단일 출처는 의존성 없는 UndoBarSlot.tsx(씬 격자 스크롤 바닥 여백도 같은 값을 쓴다) — 여기서는 재export
export { UNDO_ANCHOR_ATTR, UNDO_SLOT_ATTR, UNDO_BAR_HEIGHT_PX };
/** 토스트가 읽는 CSS 변수(바 위 모서리 = 화면 아래로부터의 거리) */
export const UNDO_BAR_TOP_VAR = '--undo-bar-top';
/** 바 전체의 접근성 이름 — 버튼 이름(UNDO_TEXT)에서 파생 */
export const UNDO_BAR_LABEL = `${UNDO_TEXT.undoName}·${UNDO_TEXT.redoName}`;

/**
 * 토스트 여백 변수 값. 막대에 붙었으면 = 바 아래 변(막대 위 테두리 안쪽)의 화면 아래로부터 거리 + 바 높이,
 * 막대가 없어 화면 맨 아래면(null) = safe-area + 바 높이.
 */
export const undoBarTopCss = (barBottomPx: number | null) =>
  barBottomPx == null
    ? `calc(env(safe-area-inset-bottom) + ${UNDO_BAR_HEIGHT_PX}px)`
    : `${barBottomPx + UNDO_BAR_HEIGHT_PX}px`;

/** 색 종류별 배경 클래스(테두리 굵기·모양은 공통) — 각 막대가 쓰는 토큰 그대로 */
export const UNDO_BAR_TONE_CLASS: Record<UndoSlotTone | 'screen', string> = {
  // 하단 바와 같은 zone-bar — PC 새 마감(md 이상)은 App.css 가 --c-canvas 배경·투명 테두리로 바꾼다
  bar: 'zone-bar bg-[var(--c-surface)]',
  row: 'bg-[var(--c-surface)]',
  'row-select': 'bg-[var(--c-surface)]',
  tier: 'bg-[var(--c-zone)]',
  // 막대 없음(화면 맨 아래) — 앱 바탕색
  screen: 'bg-[var(--c-surface)]',
};

const SLOT_TONES: readonly UndoSlotTone[] = ['bar', 'row', 'row-select', 'tier'];

/** 바의 인라인 스타일 — 대체 위치(screen)는 safe-area 위, V2 선택 중 줄은 같은 하늘색 덮개 */
export function undoBarStyle(tone: UndoSlotTone | 'screen'): CSSProperties | undefined {
  if (tone === 'screen') return { bottom: 'env(safe-area-inset-bottom)' };
  if (tone === 'row-select')
    return { backgroundImage: `linear-gradient(${V2_ROW_SELECT_TINT}, ${V2_ROW_SELECT_TINT})` };
  return undefined;
}

// 바 자리의 층(--z-widget). 읽지 못하면 App.css 의 값 1000.
const BAR_LAYER_FALLBACK = 1000;
function barLayerZ(): number {
  try {
    const v = parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--z-widget').trim(),
      10,
    );
    return Number.isFinite(v) ? v : BAR_LAYER_FALLBACK;
  } catch {
    return BAR_LAYER_FALLBACK;
  }
}

// 요소가 속한 가장 바깥(body 에 가장 가까운) 쌓임 층의 z — 조상으로 올라가며 position 이 static 이 아니고 z-index 가 숫자인
// 요소 중 마지막(가장 바깥) 것. 그런 조상이 없으면 null(= 일반 흐름, 바 층 아래).
// 가장 바깥을 보는 이유: FloatView(--z-float-view 100) 안에 뜬 z 2000 모달은 실제로는 100 층 안이라 바(1000)보다 아래다.
function outermostLayerZ(node: Element): number | null {
  let z: number | null = null;
  for (
    let n: Element | null = node;
    n && n !== document.body && n !== document.documentElement;
    n = n.parentElement
  ) {
    const cs = getComputedStyle(n);
    if (cs.position === 'static') continue;
    const v = parseInt(cs.zIndex, 10);
    if (Number.isFinite(v)) z = v;
  }
  return z;
}

// 막대가 실제로 보이는가 — 위 모서리 바로 아래 세 점(왼쪽·가운데·오른쪽) 중 하나라도 그 점에서 막대를 「가리는」 요소가
// 없으면 보임. 점 위 요소를 위에서부터 보며(elementsFromPoint, 없으면 elementFromPoint 한 개):
//  · 막대(또는 그 자손) → 보임
//  · 이 바 자신(화면 아래 대체 위치 등)·바 층(--z-widget) 이상의 오버레이(모달 2000·드로어 2100·확인 창 5100·토스트 등)
//    → 바도 함께 덮으므로 앵커 선택과 무관 — 건너뛰고 그 아래를 본다
//  · 그 밖(FloatView 100·V2 더보기 백드롭 z-10·일반 흐름 요소) → 가려짐
// 건너뛰다 목록이 끝나면(elementFromPoint 한 개뿐이라 아래를 모름) 보인다고 본다. 둘 다 없는 환경(jsdom)도 보임.
function anchorExposed(el: HTMLElement, r: DOMRect): boolean {
  const many = typeof document.elementsFromPoint === 'function';
  if (!many && typeof document.elementFromPoint !== 'function') return true;
  const layer = barLayerZ();
  const y = Math.min(r.bottom - 1, r.top + 2);
  const xs = [r.left + 8, r.left + r.width / 2, r.right - 8];
  return xs.some((x) => {
    const hits = many
      ? document.elementsFromPoint(x, y)
      : [document.elementFromPoint(x, y)].filter((h): h is Element => !!h);
    for (const hit of hits) {
      if (el.contains(hit)) return true;
      if (hit.closest('[data-undo-bar]')) continue;
      const z = outermostLayerZ(hit);
      if (z != null && z >= layer) continue;
      return false;
    }
    // 위 요소가 모두 바 층 이상 오버레이·바 자신이었다(아래는 모름) — 오버레이가 바를 덮으니 고른 막대를 유지
    return hits.length > 0;
  });
}

export interface UndoAnchorPick {
  /** 바를 넣을 자리(막대의 직속 자식 [data-undo-slot]) */
  slot: HTMLElement;
  tone: UndoSlotTone;
  /** 바 아래 변(= 막대 위 테두리 안쪽)의 화면 아래로부터 거리(px) */
  barBottomPx: number;
}

/** 보이는 하단 막대 중 위 모서리가 가장 높은 것의 부착 자리(없으면 null) */
export function pickUndoAnchor(): UndoAnchorPick | null {
  const vh = window.innerHeight;
  let best: { el: HTMLElement; slot: HTMLElement; top: number } | null = null;
  document.querySelectorAll<HTMLElement>(`[${UNDO_ANCHOR_ATTR}]`).forEach((el) => {
    const slot = Array.from(el.children).find((c) => c.hasAttribute(UNDO_SLOT_ATTR));
    if (!(slot instanceof HTMLElement)) return;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0 || r.top < 0 || r.top >= vh) return;
    if (!anchorExposed(el, r)) return;
    if (!best || r.top < best.top) best = { el, slot, top: r.top };
  });
  const chosen = best as { el: HTMLElement; slot: HTMLElement; top: number } | null;
  if (!chosen) return null;
  // absolute bottom:100% 의 기준은 막대의 padding box 위 = 위 테두리 안쪽 → 바가 막대의 위 선 1px 을 덮는다
  const barBottomPx = Math.max(0, Math.round(vh - chosen.top - (chosen.el.clientTop || 0)));
  const raw = chosen.slot.getAttribute(UNDO_SLOT_ATTR);
  const tone = (SLOT_TONES as readonly string[]).includes(raw ?? '') ? (raw as UndoSlotTone) : 'row';
  return { slot: chosen.slot, tone, barBottomPx };
}

const UndoRedoBar = observer(({ suppressed }: { suppressed?: boolean }) => {
  const dragging = useDragLayer((monitor) => monitor.isDragging());
  const session = appState.curSession;
  const shown =
    !!session &&
    !sessionService.isMirror(session.name) &&
    !suppressed &&
    !dragging &&
    !keyboardChipVisible.get() &&
    !appState.mobileV2SheetKeyboard;

  const [pick, setPick] = useState<{ slot: HTMLElement; tone: UndoSlotTone } | null>(null);

  // 부착 자리 추적 + 토스트 여백 변수. 다시 고르는 때: DOM 자식 변화(창·줄 열림/닫힘)·자리 색 종류 변화(선택 모드),
  // 막대 크기 변화, 창·키보드 크기 변화 — 한 프레임에 한 번만. 위치 자체는 CSS(자리 = 막대 안 absolute)가 정한다.
  useLayoutEffect(() => {
    const rootStyle = document.documentElement.style;
    if (!shown) {
      rootStyle.removeProperty(UNDO_BAR_TOP_VAR);
      setPick(null);
      return undefined;
    }
    let lastSlot: HTMLElement | null | undefined;
    let lastTone: UndoSlotTone | undefined;
    let lastTop = '';
    let frame: number | null = null;
    const raf =
      typeof window.requestAnimationFrame === 'function'
        ? (cb: () => void) => window.requestAnimationFrame(cb)
        : (cb: () => void) => window.setTimeout(cb, 16);
    const caf =
      typeof window.cancelAnimationFrame === 'function'
        ? (id: number) => window.cancelAnimationFrame(id)
        : (id: number) => window.clearTimeout(id);
    const ro =
      typeof ResizeObserver === 'function' ? new ResizeObserver(() => schedule()) : null;
    const observed = new Set<Element>();
    const measure = () => {
      frame = null;
      const next = pickUndoAnchor();
      const slot = next?.slot ?? null;
      if (slot !== lastSlot || next?.tone !== lastTone) {
        lastSlot = slot;
        lastTone = next?.tone;
        setPick(next ? { slot: next.slot, tone: next.tone } : null);
      }
      const top = undoBarTopCss(next ? next.barBottomPx : null);
      if (top !== lastTop) {
        lastTop = top;
        rootStyle.setProperty(UNDO_BAR_TOP_VAR, top);
      }
      if (ro) {
        // 떨어져 나간 막대는 관찰을 풀고, 새로 생긴 막대는 관찰을 건다(크기 0 ↔ 보임 전환도 여기서 잡힌다)
        observed.forEach((el) => {
          if (!el.isConnected) {
            ro.unobserve(el);
            observed.delete(el);
          }
        });
        document.querySelectorAll(`[${UNDO_ANCHOR_ATTR}]`).forEach((el) => {
          if (!observed.has(el)) {
            observed.add(el);
            ro.observe(el);
          }
        });
      }
    };
    function schedule() {
      if (frame == null) frame = raf(measure);
    }
    measure();
    // attributes(data-undo-slot): 같은 V2 메인 줄이 선택 모드로 바뀌면 자리의 색 종류도 바뀐다
    const mo = typeof MutationObserver === 'function' ? new MutationObserver(schedule) : null;
    mo?.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [UNDO_SLOT_ATTR],
    });
    window.addEventListener('resize', schedule);
    const vv = window.visualViewport;
    vv?.addEventListener('resize', schedule);
    return () => {
      if (frame != null) caf(frame);
      mo?.disconnect();
      ro?.disconnect();
      window.removeEventListener('resize', schedule);
      vv?.removeEventListener('resize', schedule);
      rootStyle.removeProperty(UNDO_BAR_TOP_VAR);
    };
  }, [shown]);

  if (!shown) return null;

  const button = (dir: 'undo' | 'redo') => {
    const enabled = dir === 'undo' ? undoService.canUndo : undoService.canRedo;
    // 단축키 안내는 PC 만(모바일은 단축키 서비스 없음), 사용자가 바꾼 키 그대로
    const bound = !isMobile ? keyboardShortcutService?.getBinding(dir) : undefined;
    const keyHint = bound ? KeyboardShortcutService.keyDisplayName(bound) : undefined;
    const tooltip =
      dir === 'undo'
        ? UNDO_TEXT.undoTooltip(undoService.undoLabel, keyHint)
        : UNDO_TEXT.redoTooltip(undoService.redoLabel, keyHint);
    return (
      <Tooltip content={tooltip} placement="top">
        <button
          type="button"
          data-undo-bar-button={dir}
          className="icon-button touch-hit relative mx-1 inline-flex items-center justify-center disabled:opacity-40"
          aria-label={dir === 'undo' ? UNDO_TEXT.undoName : UNDO_TEXT.redoName}
          disabled={!enabled}
          onClick={() =>
            void (dir === 'undo'
              ? undoService.undo(appState.curSession)
              : undoService.redo(appState.curSession))
          }
        >
          <ActionIcon id={dir} size={18} />
        </button>
      </Tooltip>
    );
  };

  // 자리가 연결이 끊긴 채 남았으면(막대가 막 사라짐) 다음 측정까지 화면 아래 대체 위치로
  const attached = pick && pick.slot.isConnected ? pick : null;
  const tone: UndoSlotTone | 'screen' = attached ? attached.tone : 'screen';
  const style = undoBarStyle(tone);
  const node = (
    <div
      data-undo-bar=""
      data-undo-bar-tone={tone}
      data-edge-swipe-ignore=""
      role="toolbar"
      aria-label={UNDO_BAR_LABEL}
      className={`titlebar-no-drag h-9 flex items-center px-1 rounded-t-[10px] border border-b-0 line-color whitespace-nowrap ${UNDO_BAR_TONE_CLASS[tone]}${
        attached ? '' : ' fixed left-1/2 -translate-x-1/2 z-[var(--z-widget)]'
      }`}
      style={style}
    >
      {button('undo')}
      {button('redo')}
    </div>
  );
  return attached ? createPortal(node, attached.slot) : node;
});

export default UndoRedoBar;
