// 되돌리기/다시 실행 버튼 바(2026-11-03 U6 — D19 결정: 상시 노출, 하단 바 위쪽 부착 / 2026-11-04 설계 E — 하단 부착 개선).
// 화면 하단 크롬 맨 위에 작은 탭 모양으로 붙어 [⋮⋮][되돌리기][다시 실행]을 늘 보여 준다(되돌릴 것이 없으면 흐리게 비활성).
//
// 부착(「항상 맨 위 호스트 위」): 호스트 = 하단 막대(PC·모바일 하단 바 BottomBar, 모바일 V2 메인 줄 V2MainRow·더보기 둘째 줄
// V2TierRows — 씬 목록·이미지 그리드·상세·씬 편집 창 하단 탭 바가 모두 V2MainRow) + 펼친 시트(이미지 상세 「자세한 정보」 손잡이
// — 펼쳤을 때만, V2 프롬프트 시트 — 반·전체일 때만). 막대·손잡이는 자기 안에 빈 자리 UndoBarSlot(위 모서리 바깥 높이 0 띠)을
// 두고, 프롬프트 시트는 잘라내기 안에서 움직여 자리를 둘 수 없으므로 표식(UNDO_SHEET_ATTR)만 단다. 이 컴포넌트는 App 에 한 번
// 마운트되어 「지금 보이는 호스트 중 화면상 가장 위의 것」(pickUndoAnchor — 크기 0·FloatView 등에 가려진 호스트는 건너뜀. 바 층
// (--z-widget) 이상의 오버레이 — 모달·드로어·확인 창·토스트 등 — 는 바도 함께 덮으므로 가림으로 치지 않고 그 아래를 본다. 위
// 모서리가 같은 높이면 쌓임 층 z 가 높은 쪽, 같으면 문서 뒤쪽)을 골라 막대면 createPortal 로 자리 안에, 프롬프트 시트면 그 위
// 모서리 바깥 위에 화면 고정(fixed)으로 둔다. 바 아래 변 = 호스트 위 변(막대는 위 테두리 안쪽 — 1px 선을 덮어 탭처럼 이어짐).
// 시트가 접히면 표식이 빠져 다시 막대로 돌아간다. 보이는 호스트가 없으면(컴팩트 템플릿 등) 화면 맨 아래 fixed(safe-area 위).
// 예외: 클래식 모바일 프롬프트 편집 창(FloatView undoCorner)이 보이면 하단에 여유가 없어 그 창 머리줄 오른쪽 구석(UndoCornerSlot)
// 에 임시로 놓는다(끌기 없음, 토스트 여백 변수 없음). 창이 닫히면 원래 부착으로.
//
// 가로 위치(설계 E): 부착된 띠 안에서 좌↔우로만 끌어 옮긴다(세로는 부착 고정). 손잡이 ⋮⋮ = 누르면 바로 끌기, 버튼 영역 = 꾹
// 누름(TOUCH_HOLD_MS 400ms) 뒤 끌기(그 누름의 click 은 삼킨다). 8px 미만 움직임은 끌기가 아니다. 위치 = 띠의 빈 폭(띠 폭 −
// 양 끝 여백 − 바 폭) 대비 비율 0(왼쪽)~1(오른쪽) — 호스트 폭이 바뀌어도(회전·다른 막대) 같은 쪽 구석·같은 상대 자리. 자동 clamp.
// 기억: localStorage 키 하나(UNDO_BAR_POS_KEY, {mobile, pc} — QuickMenu FAB 위치 선례, 기기 개인화). 기본 = 모바일 오른쪽
// 구석(1)·PC 중앙(0.5 — D19 그대로).
//
// 색: 호스트와 같은 배경·테두리 — 자리의 색 종류(UndoSlotTone)를 따른다. 하단 바 = zone-bar + --c-surface(PC 새 마감
// md 이상은 App.css 가 zone-bar 를 --c-canvas·투명 테두리로 바꾼다 — 하단 바와 같은 규칙을 그대로 받는다), V2 메인 줄 =
// --c-surface(선택 중이면 같은 하늘색 덮개), 더보기 줄·시트 = --c-zone, 구석 = --c-surface. 테두리 = line-color(클래식 마감 값
// 자동). 버튼은 하단 바 프로젝트 툴바(SessionSelect)의 무배경 아이콘 버튼과 같은 icon-button touch-hit mx-1.
//
// 층: 자리가 --z-widget(1000) — FloatView(--z-float-view 100) 위·모달(--z-modal 2000) 아래. 설정 화면·모달·드로어·확인
// 창은 그대로 이 바를 덮는다. 모든 막대·대체 위치가 앱 테마 루트(data-app-theme-root) 안이라 다크·커스텀 테마 토큰을 받는다.
// 바가 하단에 있는 동안 :root 의 --undo-bar-top(바 위 모서리의 화면 아래로부터 거리)을 설정 → 토스트(.alert-window)가 그 위로
// 올라간다. 시트 위에 붙으면 = 시트 아래 가장 위 막대의 위 모서리(토스트가 화면 위쪽으로 날아가지 않게), 구석·숨김이면 지운다.
//
// 숨김: 프로젝트 없음·읽기 전용 미러 프로젝트(단 전역 스택 — 프로젝트 즐겨찾기·폴더 작업 — 에 항목이 있으면 보인다, 2차 묶음 2)·파일 드롭 안내 중(suppressed — App 의 dragOverlay)·앱 안 드래그 중
// (react-dnd)·모바일 키보드 칩 표시 중(keyboardChipState)·모바일 V2 시트 키보드 중(하단 바도 숨는 때).
// WebView 함정: 바에 touch-action:none·select-none·contextmenu 억제(롱프레스 메뉴·텍스트 선택 방지), 잡힘 진동 = hapticTick.
// 되돌리기 로직은 undoService 그대로 — 이 파일은 UI 만.
import { observer } from 'mobx-react-lite';
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type React from 'react';
import { createPortal } from 'react-dom';
import { useDragLayer } from 'react-dnd';
import Tooltip, { TOUCH_HOLD_MS } from './Tooltip';
import { ActionIcon } from './ActionIcon';
import { hapticTick } from './haptics';
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
  UNDO_CORNER_ATTR,
  UNDO_SHEET_ATTR,
  UNDO_SLOT_ATTR,
  V2_ROW_SELECT_TINT,
  type UndoSlotTone,
} from './UndoBarSlot';

// 바 높이 단일 출처는 의존성 없는 UndoBarSlot.tsx(씬 격자 스크롤 바닥 여백도 같은 값을 쓴다) — 여기서는 재export
export { UNDO_ANCHOR_ATTR, UNDO_SLOT_ATTR, UNDO_SHEET_ATTR, UNDO_CORNER_ATTR, UNDO_BAR_HEIGHT_PX };
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

/** 바가 놓인 자리 종류 — 호스트 색 종류 + 화면 아래 대체 위치(screen) + 클래식 프롬프트 창 구석(corner) */
export type UndoBarTone = UndoSlotTone | 'screen' | 'corner';

/** 색 종류별 배경 클래스(테두리 굵기·모양은 공통) — 각 막대가 쓰는 토큰 그대로 */
export const UNDO_BAR_TONE_CLASS: Record<UndoBarTone, string> = {
  // 하단 바와 같은 zone-bar — PC 새 마감(md 이상)은 App.css 가 --c-canvas 배경·투명 테두리로 바꾼다
  bar: 'zone-bar bg-[var(--c-surface)]',
  row: 'bg-[var(--c-surface)]',
  'row-select': 'bg-[var(--c-surface)]',
  tier: 'bg-[var(--c-zone)]',
  // 펼친 시트(프롬프트 시트·자세한 정보) — 시트 배경과 같은 --c-zone
  sheet: 'bg-[var(--c-zone)]',
  // 막대 없음(화면 맨 아래) — 앱 바탕색
  screen: 'bg-[var(--c-surface)]',
  // 클래식 프롬프트 편집 창 머리줄 구석 — FloatView 바탕과 같은 색
  corner: 'bg-[var(--c-surface)]',
};

const SLOT_TONES: readonly UndoSlotTone[] = ['bar', 'row', 'row-select', 'tier', 'sheet'];

// ── 가로 위치(비율) ──
/** 띠 양 끝 여백(px) — 비율 0/1 이 막대 끝에서 이만큼 안쪽 */
export const UNDO_BAR_EDGE_PX = 8;
/** 끌기로 치는 최소 이동(px) — 이보다 작으면 위치를 바꾸지 않는다(오탭 방지) */
export const UNDO_BAR_DRAG_THRESHOLD_PX = 8;
/** 위치 기억 localStorage 키(값 = {mobile?: 비율, pc?: 비율}) */
export const UNDO_BAR_POS_KEY = 'sdstudio-undo-bar-pos';

export const clampUndoBarRatio = (r: number) =>
  Number.isFinite(r) ? Math.min(1, Math.max(0, r)) : 0.5;

/** 기본 위치 — 모바일 오른쪽 구석(1), PC 중앙(0.5, D19) */
export const undoBarDefaultRatio = (mobile: boolean) => (mobile ? 1 : 0.5);

/** 기억한 위치(없거나 깨졌으면 플랫폼 기본) */
export function loadUndoBarRatio(mobile: boolean): number {
  try {
    const raw = localStorage.getItem(UNDO_BAR_POS_KEY);
    if (raw) {
      const v = JSON.parse(raw)?.[mobile ? 'mobile' : 'pc'];
      if (typeof v === 'number' && Number.isFinite(v)) return clampUndoBarRatio(v);
    }
  } catch {}
  return undoBarDefaultRatio(mobile);
}

/** 위치 저장 — 같은 키 안의 다른 플랫폼 값은 보존 */
export function saveUndoBarRatio(mobile: boolean, ratio: number) {
  try {
    let obj: Record<string, unknown> = {};
    const raw = localStorage.getItem(UNDO_BAR_POS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') obj = parsed;
    }
    obj[mobile ? 'mobile' : 'pc'] = clampUndoBarRatio(ratio);
    localStorage.setItem(UNDO_BAR_POS_KEY, JSON.stringify(obj));
  } catch {}
}

/**
 * 끌어 놓을 바 왼쪽(px) → 비율. 띠의 빈 폭 = 띠 폭 − 양 끝 여백 − 바 폭, 비율 = (바 왼쪽 − 띠 왼쪽 − 여백) / 빈 폭,
 * 0~1 로 clamp(호스트 폭 안). 빈 폭이 없으면(바가 띠보다 넓음) 가운데.
 */
export function undoBarRatioFromLeft(
  containerLeft: number,
  containerWidth: number,
  barWidth: number,
  barLeft: number,
): number {
  const free = containerWidth - 2 * UNDO_BAR_EDGE_PX - barWidth;
  if (!(free > 0)) return 0.5;
  return clampUndoBarRatio((barLeft - containerLeft - UNDO_BAR_EDGE_PX) / free);
}

/**
 * 비율 → 가로 위치 스타일(측정 없이 CSS 로). left = 여백 + (기준 폭 − 2×여백) × r, translateX(−r×100%) 로 바 폭만큼 보정 →
 * 바 왼쪽 = 여백 + r × (기준 폭 − 2×여백 − 바 폭). 기준 폭 = 자리 띠(포털)·뷰포트(화면 아래) = 100%, 시트(fixed) = 시트 rect.
 */
export function undoBarLeftStyle(
  ratio: number,
  base?: { left: number; width: number },
): CSSProperties {
  const r = clampUndoBarRatio(ratio);
  const e = UNDO_BAR_EDGE_PX;
  const left = base
    ? `calc(${base.left + e}px + ${Math.max(0, base.width - 2 * e)}px * ${r})`
    : `calc(${e}px + (100% - ${2 * e}px) * ${r})`;
  return { left, transform: `translateX(${-r * 100}%)` };
}

/** 바의 색 인라인 스타일 — 대체 위치(screen)는 safe-area 위, V2 선택 중 줄은 같은 하늘색 덮개 */
export function undoBarStyle(tone: UndoBarTone): CSSProperties | undefined {
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

// 같은 높이 호스트 둘 중 위에 그려지는 쪽 고르기용 — 가장 바깥 쌓임 층 z(없으면 0).
const layerOf = (el: Element) => outermostLayerZ(el) ?? 0;

// 호스트가 실제로 보이는가 — 위 모서리 바로 아래 세 점(왼쪽·가운데·오른쪽) 중 하나라도 그 점에서 호스트를 「가리는」 요소가
// 없으면 보임. 점 위 요소를 위에서부터 보며(elementsFromPoint, 없으면 elementFromPoint 한 개):
//  · 호스트(또는 그 자손) → 보임
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

// 요소에 걸린 translateY(px) — 시트 FLIP 전환 중에도 멈출 자리(layout top)를 바로 쓰기 위해 rect 에서 뺀다.
function translateYOf(el: HTMLElement): number {
  try {
    const t = getComputedStyle(el).transform;
    if (!t || t === 'none') return 0;
    const m = /^matrix(3d)?\(([^)]+)\)$/.exec(t);
    if (!m) {
      // 계산값이 행렬이 아닌 환경(jsdom 등) — 인라인 translateY(Npx) 그대로
      const ty = /translateY\((-?[\d.]+)px\)/.exec(t);
      return ty ? parseFloat(ty[1]) : 0;
    }
    const v = m[2].split(',').map((s) => parseFloat(s));
    const ty = m[1] ? v[13] : v[5];
    return Number.isFinite(ty) ? ty : 0;
  } catch {
    return 0;
  }
}

export interface UndoAnchorPick {
  /** slot = 막대 자리에 포털 · sheet = 프롬프트 시트 위 fixed · corner = 클래식 프롬프트 창 구석에 포털 */
  kind: 'slot' | 'sheet' | 'corner';
  /** 바를 넣을 자리(slot: 막대의 직속 자식 [data-undo-slot] · corner: [data-undo-corner]) — sheet 는 null */
  slot: HTMLElement | null;
  /** 고른 호스트 요소 */
  host: HTMLElement;
  tone: UndoSlotTone | 'corner';
  /** 바 아래 변의 화면 아래로부터 거리(px) — slot: 막대 위 테두리 안쪽, sheet: 시트 위 모서리 바깥. corner 는 0 */
  barBottomPx: number;
  /** sheet: 시트 rect 의 가로 범위(바 가로 위치 기준) */
  hostLeft: number;
  hostWidth: number;
  /** sheet 를 손가락으로 끄는 중 — 자리는 지키되 바를 잠시 감춘다 */
  hidden: boolean;
  /**
   * 토스트 여백 변수(--undo-bar-top) 값의 바탕(px, 화면 아래로부터). slot = barBottomPx + 바 높이, sheet = 시트 아래 가장 위
   * 막대 위 모서리(없으면 null = 변수 지움), corner = null.
   */
  toastBottomPx: number | null;
}

type Candidate = {
  el: HTMLElement;
  slot: HTMLElement | null;
  sheet: string | null;
  top: number;
  z: number;
  rect: DOMRect;
};

/**
 * 부착할 호스트 고르기(없으면 null — 화면 아래 대체 위치).
 *  1. 보이는 구석 자리(클래식 모바일 프롬프트 편집 창)가 있으면 그것(예외 — 하단 호스트보다 우선).
 *  2. 아니면 보이는 호스트(자리 있는 막대·시트 표식) 중 위 모서리가 가장 높은 것. 같은 높이(±0.5px)면 쌓임 층 z 가 높은 쪽,
 *     같으면 문서 뒤쪽(위에 그려지는 쪽).
 */
export function pickUndoAnchor(): UndoAnchorPick | null {
  const vh = window.innerHeight;

  // 1. 구석 자리 — 그 머리줄(부모)이 보여야 한다(위에 다른 창이 떠 덮으면 건너뜀)
  let corner: HTMLElement | null = null;
  document.querySelectorAll<HTMLElement>(`[${UNDO_CORNER_ATTR}]`).forEach((c) => {
    const header = c.parentElement;
    if (!header) return;
    const r = header.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0 || r.top >= vh || r.bottom <= 0) return;
    if (!anchorExposed(header, r)) return;
    corner = c;
  });
  const cornerEl = corner as HTMLElement | null;
  if (cornerEl) {
    return {
      kind: 'corner',
      slot: cornerEl,
      host: cornerEl.parentElement!,
      tone: 'corner',
      barBottomPx: 0,
      hostLeft: 0,
      hostWidth: 0,
      hidden: false,
      toastBottomPx: null,
    };
  }

  // 2. 하단 호스트
  let best: Candidate | null = null;
  let bestBar: Candidate | null = null; // 시트를 뺀 가장 위 막대(시트 부착 때 토스트 여백용)
  const better = (c: Candidate, b: Candidate | null) =>
    !b || c.top < b.top - 0.5 || (Math.abs(c.top - b.top) <= 0.5 && c.z >= b.z);
  document.querySelectorAll<HTMLElement>(`[${UNDO_ANCHOR_ATTR}]`).forEach((el) => {
    const slotChild = Array.from(el.children).find((c) => c.hasAttribute(UNDO_SLOT_ATTR));
    const slot = slotChild instanceof HTMLElement ? slotChild : null;
    const sheet = slot ? null : el.getAttribute(UNDO_SHEET_ATTR);
    if (!slot && sheet == null) return;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    // 시트는 FLIP 전환 중이어도 멈출 자리 기준(가림 판정은 지금 보이는 rect 로)
    const top = sheet != null ? r.top - translateYOf(el) : r.top;
    if (top < 0 || top >= vh) return;
    if (!anchorExposed(el, r)) return;
    const c: Candidate = { el, slot, sheet, top, z: layerOf(el), rect: r };
    if (better(c, best)) best = c;
    if (slot && better(c, bestBar)) bestBar = c;
  });
  const chosen = best as Candidate | null;
  if (!chosen) return null;
  const barOf = (c: Candidate) =>
    // absolute bottom:100% 의 기준은 막대의 padding box 위 = 위 테두리 안쪽 → 바가 막대의 위 선 1px 을 덮는다
    Math.max(0, Math.round(vh - c.top - (c.el.clientTop || 0)));
  if (chosen.slot) {
    const raw = chosen.slot.getAttribute(UNDO_SLOT_ATTR);
    const tone = (SLOT_TONES as readonly string[]).includes(raw ?? '') ? (raw as UndoSlotTone) : 'row';
    const barBottomPx = barOf(chosen);
    return {
      kind: 'slot',
      slot: chosen.slot,
      host: chosen.el,
      tone,
      barBottomPx,
      hostLeft: chosen.rect.left,
      hostWidth: chosen.rect.width,
      hidden: false,
      toastBottomPx: barBottomPx + UNDO_BAR_HEIGHT_PX,
    };
  }
  const under = bestBar as Candidate | null;
  return {
    kind: 'sheet',
    slot: null,
    host: chosen.el,
    tone: 'sheet',
    // 시트 바깥 위 — 시트 위 테두리 위에 바 아래 변(시트 내용을 덮지 않는다)
    barBottomPx: Math.max(0, Math.round(vh - chosen.top)),
    hostLeft: chosen.rect.left,
    hostWidth: chosen.rect.width,
    hidden: chosen.sheet === 'drag',
    toastBottomPx: under ? barOf(under) : null,
  };
}

type PickState = {
  kind: UndoAnchorPick['kind'];
  slot: HTMLElement | null;
  tone: UndoSlotTone | 'corner';
  barBottomPx: number;
  hostLeft: number;
  hostWidth: number;
  hidden: boolean;
};
const samePick = (a: PickState | null, b: PickState | null) =>
  a === b ||
  (!!a &&
    !!b &&
    a.kind === b.kind &&
    a.slot === b.slot &&
    a.tone === b.tone &&
    a.hidden === b.hidden &&
    // fixed(시트) 만 좌표가 위치를 정한다 — 포털 자리는 CSS 가 정하므로 좌표 변화로 다시 그리지 않는다
    (a.kind !== 'sheet' ||
      (a.barBottomPx === b.barBottomPx && a.hostLeft === b.hostLeft && a.hostWidth === b.hostWidth)));

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  /** 끌기 켜짐(손잡이 = 누르자마자, 버튼 영역 = 꾹 누름 뒤) */
  armed: boolean;
  /** 꾹 누름으로 켜졌다(그 누름의 click 을 삼킨다) */
  byHold: boolean;
  /** 임계값 이상 움직였다(위치를 바꾸고 저장) */
  moved: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  containerLeft: number;
  containerWidth: number;
  barLeft: number;
  barWidth: number;
};

const UndoRedoBar = observer(({ suppressed }: { suppressed?: boolean }) => {
  const dragging = useDragLayer((monitor) => monitor.isDragging());
  const session = appState.curSession;
  // 프로젝트 스택(있고 미러 아님) 또는 전역 스택 항목 — 프로젝트가 없거나 미러여도 전역 항목은 되돌릴 수 있다(2차 묶음 2)
  const hasTarget =
    (!!session && !sessionService.isMirror(session.name)) || undoService.hasGlobalEntries;
  const shown =
    hasTarget &&
    !suppressed &&
    !dragging &&
    !keyboardChipVisible.get() &&
    !appState.mobileV2SheetKeyboard;

  const [pick, setPick] = useState<PickState | null>(null);
  const mobile = !!isMobile;
  const [ratio, setRatio] = useState(() => loadUndoBarRatio(mobile));
  const ratioRef = useRef(ratio);
  ratioRef.current = ratio;
  const [barDragging, setBarDragging] = useState(false);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const barRef = useRef<HTMLDivElement | null>(null);

  // 부착 자리 추적 + 토스트 여백 변수. 다시 고르는 때: DOM 자식 변화(창·줄 열림/닫힘)·자리 색 종류·호스트 표식·시트 상태 변화,
  // 호스트 크기 변화, 창·키보드 크기 변화, 전환 애니메이션 끝 — 한 프레임에 한 번만. 막대 자리의 위치는 CSS 가 정한다.
  useLayoutEffect(() => {
    const rootStyle = document.documentElement.style;
    if (!shown) {
      rootStyle.removeProperty(UNDO_BAR_TOP_VAR);
      setPick(null);
      return undefined;
    }
    let last: PickState | null | undefined;
    let lastTop: string | null | undefined;
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
      const state: PickState | null = next
        ? {
            kind: next.kind,
            slot: next.slot,
            tone: next.tone,
            barBottomPx: next.barBottomPx,
            hostLeft: next.hostLeft,
            hostWidth: next.hostWidth,
            hidden: next.hidden,
          }
        : null;
      if (last === undefined || !samePick(state, last)) {
        last = state;
        setPick(state);
      }
      // 구석·시트 아래 막대 없음 = 변수 없음(null), 호스트 없음(화면 아래) = safe-area + 바 높이
      const top = next
        ? next.toastBottomPx == null
          ? null
          : `${next.toastBottomPx}px`
        : undoBarTopCss(null);
      if (top !== lastTop) {
        lastTop = top;
        if (top == null) rootStyle.removeProperty(UNDO_BAR_TOP_VAR);
        else rootStyle.setProperty(UNDO_BAR_TOP_VAR, top);
      }
      if (ro) {
        // 떨어져 나간 막대는 관찰을 풀고, 새로 생긴 막대는 관찰을 건다(크기 0 ↔ 보임 전환도 여기서 잡힌다)
        observed.forEach((el) => {
          if (!el.isConnected) {
            ro.unobserve(el);
            observed.delete(el);
          }
        });
        document.querySelectorAll(`[${UNDO_ANCHOR_ATTR}], [${UNDO_CORNER_ATTR}]`).forEach((el) => {
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
    // attributes: 같은 V2 메인 줄이 선택 모드로 바뀌면 자리의 색 종류가, 시트가 펼쳐지거나 접히면 표식·상태가 바뀐다
    const mo = typeof MutationObserver === 'function' ? new MutationObserver(schedule) : null;
    mo?.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [UNDO_SLOT_ATTR, UNDO_ANCHOR_ATTR, UNDO_SHEET_ATTR],
    });
    window.addEventListener('resize', schedule);
    const vv = window.visualViewport;
    vv?.addEventListener('resize', schedule);
    // 시트 FLIP 전환이 끝나면 다시 잰다(전환 중에도 멈출 자리 기준으로 재지만, 가림 판정은 끝난 뒤가 정확)
    document.addEventListener('transitionend', schedule, true);
    return () => {
      if (frame != null) caf(frame);
      mo?.disconnect();
      ro?.disconnect();
      window.removeEventListener('resize', schedule);
      vv?.removeEventListener('resize', schedule);
      document.removeEventListener('transitionend', schedule, true);
      rootStyle.removeProperty(UNDO_BAR_TOP_VAR);
    };
  }, [shown]);

  // 숨거나 언마운트되면 진행 중인 꾹 누름 타이머를 정리
  useLayoutEffect(
    () => () => {
      if (dragRef.current?.timer) clearTimeout(dragRef.current.timer);
      dragRef.current = null;
    },
    [shown],
  );

  if (!shown) return null;

  // 자리가 연결이 끊긴 채 남았으면(막대가 막 사라짐) 다음 측정까지 화면 아래 대체 위치로
  const attached =
    pick && (pick.kind === 'sheet' || (pick.slot && pick.slot.isConnected)) ? pick : null;
  const kind: 'slot' | 'sheet' | 'corner' | 'screen' = attached ? attached.kind : 'screen';
  const tone: UndoBarTone = attached ? attached.tone : 'screen';
  // 구석 예외에서는 끌기 없음
  const draggable = kind !== 'corner';

  const endDrag = (commit: boolean) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (d.timer) clearTimeout(d.timer);
    if (!d.armed) return;
    setBarDragging(false);
    if (d.byHold) {
      // 꾹 누름 뒤 손을 떼면 오는 click 한 번을 삼킨다(끌기 중 버튼 탭 무시). click 이 안 오면 곧 해제.
      suppressClickRef.current = true;
      setTimeout(() => {
        suppressClickRef.current = false;
      }, 500);
    }
    if (commit && d.moved) saveUndoBarRatio(mobile, ratioRef.current);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggable) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (dragRef.current?.timer) clearTimeout(dragRef.current.timer);
    const barEl = e.currentTarget;
    const container =
      kind === 'sheet' && attached
        ? { left: attached.hostLeft, width: attached.hostWidth }
        : kind === 'slot' && attached?.slot
          ? (() => {
              const r = attached.slot.getBoundingClientRect();
              return { left: r.left, width: r.width };
            })()
          : { left: 0, width: window.innerWidth };
    const br = barEl.getBoundingClientRect();
    const onGrip = !!(e.target as Element | null)?.closest?.('[data-undo-bar-grip]');
    const pointerId = e.pointerId;
    const d: DragState = {
      pointerId,
      startX: e.clientX,
      startY: e.clientY,
      armed: false,
      byHold: false,
      moved: false,
      timer: null,
      containerLeft: container.left,
      containerWidth: container.width,
      barLeft: br.left,
      barWidth: br.width,
    };
    dragRef.current = d;
    const arm = (byHold: boolean) => {
      d.armed = true;
      d.byHold = byHold;
      d.timer = null;
      try {
        barEl.setPointerCapture?.(pointerId);
      } catch {}
      setBarDragging(true);
      if (byHold) void hapticTick();
    };
    if (onGrip) arm(false);
    else
      d.timer = setTimeout(() => {
        if (dragRef.current === d) arm(true);
      }, TOUCH_HOLD_MS);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.startX;
    if (!d.armed) {
      // 꾹 누름이 차기 전에 움직였으면 끌기 아님(그냥 탭/미끄러짐) — 타이머 해제
      if (Math.hypot(dx, e.clientY - d.startY) >= UNDO_BAR_DRAG_THRESHOLD_PX) {
        if (d.timer) clearTimeout(d.timer);
        dragRef.current = null;
      }
      return;
    }
    if (!d.moved && Math.abs(dx) < UNDO_BAR_DRAG_THRESHOLD_PX) return;
    d.moved = true;
    const next = undoBarRatioFromLeft(d.containerLeft, d.containerWidth, d.barWidth, d.barLeft + dx);
    ratioRef.current = next;
    setRatio(next);
  };

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

  const colorStyle = undoBarStyle(tone);
  const posStyle: CSSProperties | undefined =
    kind === 'corner'
      ? undefined
      : kind === 'sheet' && attached
        ? {
            ...undoBarLeftStyle(ratio, { left: attached.hostLeft, width: attached.hostWidth }),
            bottom: attached.barBottomPx,
          }
        : undoBarLeftStyle(ratio);
  const style: CSSProperties = {
    ...colorStyle,
    ...posStyle,
    ...(attached?.hidden ? { visibility: 'hidden' } : null),
  };
  // 자리(포털) = 높이 0 띠 안 absolute 바닥 맞춤, 시트·화면 아래 = 화면 고정, 구석 = 자리 안 일반 흐름
  const placeClass =
    kind === 'slot'
      ? ' absolute bottom-0 pointer-events-auto'
      : kind === 'corner'
        ? ''
        : ' fixed z-[var(--z-widget)]';
  // 구석은 막대에 붙지 않으므로 사방 테두리·둥근 사각, 나머지는 위만 둥근 탭(아래 변 = 호스트 위 변)
  const shapeClass =
    kind === 'corner' ? 'rounded-[10px] border' : 'rounded-t-[10px] border border-b-0';
  const node = (
    <div
      ref={barRef}
      data-undo-bar=""
      data-undo-bar-tone={tone}
      data-undo-bar-kind={kind}
      data-undo-bar-dragging={barDragging ? '' : undefined}
      // 가로 위치 비율(구석 예외는 없음) — 진단·테스트용 표식
      data-undo-bar-ratio={kind === 'corner' ? undefined : String(ratio)}
      data-edge-swipe-ignore=""
      role="toolbar"
      aria-label={UNDO_BAR_LABEL}
      className={`titlebar-no-drag h-9 w-max flex items-center px-1 select-none touch-none line-color whitespace-nowrap ${shapeClass} ${UNDO_BAR_TONE_CLASS[tone]}${placeClass}${
        barDragging ? ' cursor-grabbing' : ''
      }`}
      style={style}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => endDrag(true)}
      onPointerCancel={() => endDrag(false)}
      onClickCapture={(e) => {
        if (!suppressClickRef.current) return;
        suppressClickRef.current = false;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {draggable && (
        <span
          data-undo-bar-grip=""
          aria-hidden="true"
          className={`flex-none w-4 h-full flex items-center justify-center text-faint ${
            barDragging ? 'cursor-grabbing' : 'cursor-grab'
          }`}
        >
          <ActionIcon id="drag-handle" size={12} />
        </span>
      )}
      {button('undo')}
      {button('redo')}
    </div>
  );
  return attached && attached.slot ? createPortal(node, attached.slot) : node;
});

export default UndoRedoBar;
