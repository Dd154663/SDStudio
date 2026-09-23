import React, { createContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FaChevronUp } from 'react-icons/fa';
import { appState } from '../models/AppService';
import { backStackService } from '../models/BackStackService';
import {
  V2SheetState,
  V2_SHEET_PEEK_PX,
  nearestSheetState,
  nextSheetState,
  resolveSheetTarget,
} from '../models/mobileV2';

// 모바일 V2 의 하단 시트 프롬프트(2026-09-21). 클래식의 「프롬프트 열기」 전체 화면을 대신한다.
//  · 접힘(44px) → 반 → 전체. 손잡이를 탭하면 다음 단계. 끌면 resolveSheetTarget(구간 25%·튕김 속도)로 붙는다.
//  · 반 = 빠른 수정(상위·추가 프롬프트+시드만, PresetCompactContext), 전체 = 패널 전부.
//    프롬프트 도구(찾기 및 변환·작가 분해)는 시트가 아니라 메인 줄의 더보기에 둔다(2026-09-21 실기기 피드백).
//  · 열려 있는 동안 Android 뒤로 가기는 한 단계씩 접는다. 배경(딤)을 누르면 접힘.
//  · 부모(TabComponent 루트, relative)의 바닥에 붙는다. 부모 높이가 곧 "전체" 높이.
//
// 2026-09-22 실기기 피드백(반응성) 반영:
//  ① 움직임은 height 가 아니라 transform(translateY)만 바꾼다 — 높이 전환은 프레임마다 패널 전체를 재배치해
//     실기기에서 2초 가까이 버벅였고 그동안 딤 탭도 먹지 않았다. 시트는 항상 "전체" 높이로 두고 아래로 밀어 내린다.
//     단 **멈춰 있을 때는 transform 을 남기지 않는다**(top 으로 자리 잡음, FLIP 방식으로 전환만 transform). transform 이
//     남아 있으면 안의 position:fixed(프롬프트 확장 편집기·자동완성)가 뷰포트가 아니라 시트 기준이 되어 시트 안에서
//     잘렸다(2026-09-22 실기기: 반 상태에서 프롬프트 칸 포커스 시 확장 창 하단이 잘림).
//  ② 패널 본문은 처음 열 때 한 번 마운트하고 이후 유지한다(접힘에서는 visibility 만 숨김). 열 때마다 마운트하던
//     비용이 애니메이션을 막았다. 접힌 동안의 compact 값은 마지막으로 열었던 상태를 따라 다시 열 때 재마운트가 없다.
//  ③ 열린 동안 딤은 뷰포트 상단까지(fixed) 덮어 상단 바를 막고, appState.mobileV2SheetOpen 으로 드로어 손잡이·
//     가장자리 스와이프를 막는다. 하단 바(생성·예약)는 시트 아래에 남아 그대로 쓸 수 있다.

/** true 면 프리셋 패널이 빠른 수정용 요소만 그린다(PreSetEdtior 의 PresetRootRender 가 읽는다). */
export const PresetCompactContext = createContext(false);

/**
 * 집중 모드(2026-09-23): 키보드가 떠 있고 시트 안 칸에 포커스가 있으면 그 칸만 남기고 나머지(사전세팅선택 포함)를
 * 숨긴다. 키보드가 뜨면 본문이 300px 안팎이라 flex 로 나눠 갖던 프롬프트 칸이 몇 줄로 접혀 편집이 안 됐다.
 * 예전 확장 창처럼 다른 자리로 점프하지 않고 같은 요소가 제자리에서 커지므로 포커스·커서가 유지된다.
 *  · key: 집중할 최상위 요소의 wfiElementKey, null 이면 평소 배치. 판정은 시트가 한다(kbdOpen && 포커스).
 *  · done: 머리줄의 완료 버튼 — 포커스를 풀어 키보드를 내린다(키보드가 내려가면 시트가 모드를 해제).
 *  · 공급자가 있을 때만(V2 시트) PresetRootRender 가 요소마다 data-wfi-key 래퍼(display:contents)를 두어,
 *    모드 진입·해제가 트리 모양을 바꾸지 않는다(포커스된 textarea 가 재마운트되면 포커스가 날아간다).
 *    PC·클래식 모바일은 공급자가 없어 마크업 불변.
 */
export const PresetFocusContext = createContext<{ key: string | null; done: () => void } | null>(
  null,
);
export const WFI_KEY_ATTR = 'data-wfi-key';

const HALF_RATIO = 0.56;
const DRAG_TAP_PX = 6;
const VELOCITY_WINDOW_MS = 100;
const KBD_SHRINK_PX = 120;
const TRANSITION = 'transform 0.22s cubic-bezier(0.4, 0, 0.2, 1)';

type DragSample = { t: number; y: number };
type Drag = { startY: number; startH: number; moved: boolean; samples: DragSample[] };

/** 마지막 100ms 안의 표본으로 속도(px/ms, 위=양수)를 구한다. */
function dragVelocity(samples: DragSample[]): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  let first = samples[0];
  for (let i = samples.length - 2; i >= 0; i -= 1) {
    first = samples[i];
    if (last.t - samples[i].t >= VELOCITY_WINDOW_MS) break;
  }
  const dt = last.t - first.t;
  if (dt <= 0) return 0;
  return (first.y - last.y) / dt;
}

const MobilePromptSheet: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<V2SheetState>('peek');
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const [containerH, setContainerH] = useState(0);
  // 뷰포트 바닥에서 부모 바닥까지의 거리(=하단 바 높이). 딤은 여기까지만 덮어 하단 바를 남긴다.
  const [dimBottom, setDimBottom] = useState(0);
  // 소프트 키보드가 떠서 부모가 크게 줄어든 상태. 이때 반 상태는 전체 높이로 잠시 키운다 — 줄어든 화면의 56% 로는
  // 프롬프트 칸(flex-1)이 0 높이로 접혀 보면서 편집할 수 없었다(2026-09-22 실기기 5차). 키보드가 내려가면 반으로 복귀.
  const [kbdOpen, setKbdOpen] = useState(false);
  const maxHRef = useRef(0);
  const widthRef = useRef(0);
  // 시트 본문 안에서 포커스를 가진 최상위 요소의 키(집중 모드 대상). 본문 밖으로 포커스가 나가면 null.
  const [focusKey, setFocusKey] = useState<string | null>(null);
  // 키보드가 내려갈 때까지 붙잡아 두는 마지막 집중 키. 완료·뒤로 가기로 포커스가 먼저 풀리면 칸들이 좁은 시트에
  // 다시 펼쳐지고, 그 뒤 키보드가 내려가며 또 재배치되어 화면이 들썩였다(2026-09-23). 키보드가 사라지는 순간
  // 집중 해제·반 배치·하단 바 복귀를 한 번에 한다.
  const heldKeyRef = useRef<string | null>(null);
  if (focusKey != null) heldKeyRef.current = focusKey;
  // 하단 바 높이(보일 때 측정). 키보드 전환 프레임에 하단 바가 사라지거나 돌아올 것을 미리 반영해 두 번 배치를 피한다.
  const barHRef = useRef(0);
  const onBodyFocus = (e: React.FocusEvent) => {
    const host = (e.target as HTMLElement | null)?.closest?.(`[${WFI_KEY_ATTR}]`) as HTMLElement | null;
    setFocusKey(host?.getAttribute(WFI_KEY_ATTR) || null);
  };
  const onBodyBlur = (e: React.FocusEvent) => {
    // 칸 사이 이동(blur→focus)에서 잠깐 null 이 되어 배치가 흔들리지 않게, 본문 밖으로 나갈 때만 해제
    const next = e.relatedTarget as Node | null;
    if (next && e.currentTarget.contains(next)) return;
    setFocusKey(null);
  };
  const focusDone = () => {
    const active = document.activeElement as HTMLElement | null;
    if (active && typeof active.blur === 'function') active.blur();
  };
  const [everOpened, setEverOpened] = useState(false);
  // 부모 높이를 잰 뒤 한 번 더 그린 다음에야 전환 애니메이션을 켠다 — 첫 측정으로 translateY 가 0→(전체−44)로
  // 바뀔 때 시트가 위에서 내려오는 것처럼 보이지 않게(마운트·프로젝트 전환마다 생기던 잔상).
  const [ready, setReady] = useState(false);
  const clipRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  // 접힌 동안 본문이 유지할 상태(마지막으로 열었던 상태) — 다시 열 때 재마운트를 피한다.
  const lastOpenRef = useRef<V2SheetState>('half');
  if (state !== 'peek') lastOpenRef.current = state;

  // 부모 높이·위치 추적(회전·키보드·상단 선반 펼침에 반응)
  useEffect(() => {
    const parent = clipRef.current?.parentElement;
    if (!parent) return undefined;
    const measure = () => {
      const h = parent.clientHeight;
      setContainerH(h);
      const rect = parent.getBoundingClientRect();
      setDimBottom(Math.max(0, Math.round(window.innerHeight - rect.bottom)));
      // 같은 가로 폭에서 본 최대 높이보다 120px 넘게 줄었으면 키보드로 본다(회전하면 기준을 다시 잡는다)
      if (window.innerWidth !== widthRef.current) {
        widthRef.current = window.innerWidth;
        maxHRef.current = 0;
      }
      maxHRef.current = Math.max(maxHRef.current, h);
      setKbdOpen(maxHRef.current - h > KBD_SHRINK_PX);
      const dock = document.querySelector('[data-gen-dock]');
      if (dock && dock.getClientRects().length > 0) {
        barHRef.current = Math.round(dock.getBoundingClientRect().height);
      }
    };
    measure();
    window.addEventListener('resize', measure);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(parent);
    // 키보드 버그 방어(2026-09-22 실기기): 반 상태에서 프롬프트 칸에 포커스가 가면 브라우저가 캐럿을 보이려고
    // overflow:hidden 조상까지 스크롤한다. 아래로 밀어 내린 시트가 클리퍼의 스크롤 여유를 만들어 클리퍼가
    // 위로 밀린 채 남았고(전체로 열어 여유가 0이 될 때까지 유지), 접힘·반 자리가 그만큼 어긋났다.
    // overflow:clip(스크롤 컨테이너가 아님)으로 막고, 지원하지 않는 엔진을 위해 스크롤되면 즉시 되돌린다.
    const clip = clipRef.current;
    const unscroll = () => {
      if (!clip) return;
      if (clip.scrollTop !== 0) clip.scrollTop = 0;
      if (clip.scrollLeft !== 0) clip.scrollLeft = 0;
    };
    clip?.addEventListener('scroll', unscroll);
    return () => {
      window.removeEventListener('resize', measure);
      ro?.disconnect();
      clip?.removeEventListener('scroll', unscroll);
    };
  }, []);

  const open = state !== 'peek';

  useEffect(() => {
    if (containerH > 0 && !ready) setReady(true);
  }, [containerH, ready]);

  // 열려 있는 동안 뒤로 가기 = 바로 접힘(전체에서도 반을 거치지 않는다, 2026-09-22 사용자)
  useEffect(() => {
    if (!open) return undefined;
    const handle = backStackService.push(() => {
      setState('peek');
    });
    return () => handle.remove();
  }, [open]);

  // 열림 표식: 드로어 손잡이·가장자리 스와이프가 이 값을 보고 물러난다(ProjectDrawer·ImageHistory).
  useEffect(() => {
    appState.mobileV2SheetOpen = open;
    if (open) setEverOpened(true);
  }, [open]);
  // 시트가 열린 채 키보드가 떠 있으면 하단 바를 숨긴다(BottomBar). 시트가 접힌 채 다른 입력(씬 검색 등)에서
  // 키보드가 뜨는 경우는 해당 없음.
  useEffect(() => {
    appState.mobileV2SheetKeyboard = open && kbdOpen;
  }, [open, kbdOpen]);
  useEffect(
    () => () => {
      appState.mobileV2SheetOpen = false;
      appState.mobileV2SheetKeyboard = false;
    },
    [],
  );

  // 하단 바 숨김 표식(appState.mobileV2SheetKeyboard)은 아래 effect 가 이 렌더 뒤에 갱신한다. 표식과 kbdOpen 이
  // 어긋난 렌더 = 하단 바가 곧 사라지거나(키보드 뜸) 곧 돌아올(키보드 내림) 프레임 → 그 변화를 미리 반영한
  // 부모 높이로 배치해, 하단 바가 실제로 바뀐 뒤의 재측정이 같은 결과를 내게 한다(두 번 배치 방지).
  const barShownNow = !appState.mobileV2SheetKeyboard;
  const barWillHide = open && kbdOpen && barShownNow;
  const barWillShow = !(open && kbdOpen) && !barShownNow;
  const baseH = barWillHide
    ? containerH + barHRef.current
    : barWillShow
      ? Math.max(0, containerH - barHRef.current)
      : containerH;
  const heights: Record<V2SheetState, number> = {
    peek: V2_SHEET_PEEK_PX,
    half: Math.max(V2_SHEET_PEEK_PX, Math.round(baseH * HALF_RATIO)),
    full: Math.max(V2_SHEET_PEEK_PX, baseH),
  };
  const heightsRef = useRef(heights);
  heightsRef.current = heights;

  // 손잡이 끌기(포인터 캡처). 6px 미만이면 탭으로 본다. 끄는 높이는 ref 에도 둔다(놓는 순간 stale state 방지).
  const drag = useRef<Drag | null>(null);
  const dragHRef = useRef<number | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = {
      startY: e.clientY,
      startH: heightsRef.current[stateRef.current],
      moved: false,
      samples: [{ t: e.timeStamp, y: e.clientY }],
    };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch (err) {
      /* 합성 이벤트 등 캡처 불가 — 무시 */
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    d.samples.push({ t: e.timeStamp, y: e.clientY });
    if (d.samples.length > 12) d.samples.shift();
    const dy = d.startY - e.clientY;
    if (Math.abs(dy) > DRAG_TAP_PX) d.moved = true;
    if (!d.moved) return;
    const h = heightsRef.current;
    const next = Math.max(h.peek, Math.min(h.full, d.startH + dy));
    dragHRef.current = next;
    setDragHeight(next);
  };
  const endDrag = (commit: boolean) => {
    const d = drag.current;
    drag.current = null;
    const h = dragHRef.current;
    dragHRef.current = null;
    if (!d) return;
    if (commit) {
      if (!d.moved) {
        setState(nextSheetState(stateRef.current));
      } else if (h != null) {
        setState(
          resolveSheetTarget({
            height: h,
            startHeight: d.startH,
            velocity: dragVelocity(d.samples),
            heights: heightsRef.current,
          }),
        );
      }
    }
    setDragHeight(null);
  };

  const dragging = dragHeight != null;
  // 멈춘 자리(top). 끄는 동안만 transform 으로 손가락을 따라가고, 상태 전환은 아래 FLIP 효과가 transform 으로 움직인
  // 뒤 transform 을 'none' 으로 되돌린다(멈춘 시트 안의 fixed 요소가 뷰포트 기준이 되도록).
  // 키보드가 떠 있으면(끄는 중이 아닐 때) 반 상태를 전체 높이로 배치한다. 내용은 그대로 반(compact)이다.
  const layoutHeight = (s: V2SheetState) =>
    kbdOpen && !dragging && s === 'half' ? heights.full : heights[s];
  const restTop = heights.full - layoutHeight(state);
  const dragOffset = dragging ? -(dragHeight - heights[state]) : 0;
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const visualTopRef = useRef(restTop);
  const prevFullRef = useRef(heights.full);
  const animRef = useRef<{ timer: number; done: () => void } | null>(null);
  useLayoutEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    // 부모 높이가 바뀐 재배치(키보드 뜸/내림·회전)는 애니메이션 없이 즉시 — 키보드마다 시트가 오르내리는
    // 울렁거림을 없앤다(2026-09-22 축소안). 상태 전환·끌기 놓기만 전환 애니메이션.
    const resized = heights.full !== prevFullRef.current;
    prevFullRef.current = heights.full;
    if (dragging) {
      visualTopRef.current = restTop + dragOffset;
      return;
    }
    const delta = visualTopRef.current - restTop;
    visualTopRef.current = restTop;
    // 자리가 그대로인 재렌더(예: 첫 열림 직후의 everOpened 갱신)는 진행 중인 전환을 건드리지 않는다 — 여기서
    // transform 을 none 으로 되돌리면 방금 시작한 전환이 끊겨 시트가 툭 튄다.
    if (!ready || Math.abs(delta) < 1) return;
    if (resized) {
      if (animRef.current) {
        window.clearTimeout(animRef.current.timer);
        el.removeEventListener('transitionend', animRef.current.done);
        animRef.current = null;
      }
      el.style.transition = 'none';
      el.style.transform = 'none';
      return;
    }
    if (animRef.current) {
      window.clearTimeout(animRef.current.timer);
      el.removeEventListener('transitionend', animRef.current.done);
      animRef.current = null;
    }
    // FLIP: 새 자리(top)에 놓인 요소를 이전 자리만큼 되돌려 놓고 0 으로 전환한다
    el.style.transition = 'none';
    el.style.transform = `translateY(${delta}px)`;
    void el.getBoundingClientRect();
    el.style.transition = TRANSITION;
    el.style.transform = 'translateY(0)';
    const done = () => {
      el.style.transition = 'none';
      el.style.transform = 'none';
      if (animRef.current?.done === done) animRef.current = null;
    };
    el.addEventListener('transitionend', done, { once: true });
    animRef.current = { timer: window.setTimeout(done, 300), done };
  });
  useEffect(
    () => () => {
      if (animRef.current) window.clearTimeout(animRef.current.timer);
    },
    [],
  );
  // 끄는 동안에는 도착할 상태 기준으로 본문을 미리 그려 둔다(접힘에서 끌어올릴 때 빈 시트가 보이지 않게).
  // 접힌 채로는 마지막으로 열었던 상태를 유지한다(재마운트 방지).
  const bodyState: V2SheetState = dragging
    ? nearestSheetState(Math.max(dragHeight, heights.half), heights)
    : open
      ? state
      : lastOpenRef.current;
  const showBody = everOpened || dragging;
  const bodyHidden = !open && !dragging;
  // 집중 모드 = 키보드가 떠 있고 본문 안에 포커스가 있을 때만. 키보드 내림 버튼은 포커스를 풀지 않으므로
  // 포커스만 보면 키보드가 내려간 뒤에도 모드가 남는다 → kbdOpen 을 함께 본다.
  // 키보드가 떠 있는 동안은 포커스가 풀려도 마지막 키를 유지한다(키보드가 내려가면 heldKey 도 비운다)
  if (!kbdOpen) heldKeyRef.current = null;
  const activeKey = focusKey ?? heldKeyRef.current;
  const focusMode = open && kbdOpen && !dragging && activeKey != null;
  const focusCtxKey = focusMode ? activeKey : null;
  const focusCtx = useMemo(() => ({ key: focusCtxKey, done: focusDone }), [focusCtxKey]);

  return (
    <>
      <div
        aria-hidden="true"
        className="fixed left-0 right-0 top-0 z-30 bg-black/35 transition-opacity duration-200"
        style={{ bottom: dimBottom, opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none' }}
        onClick={() => setState('peek')}
      />
      {/* 클리퍼: 아래로 밀어 내린 시트 부분이 하단 바 위로 그려지지 않게 부모 범위에서 잘라낸다 */}
      <div
        ref={clipRef}
        className="absolute inset-0 z-40 overflow-hidden pointer-events-none"
        style={{ overflow: 'clip' }}
      >
        <div
          ref={sheetRef}
          data-v2-sheet={state}
          data-edge-swipe-ignore=""
          className="absolute left-0 right-0 pointer-events-auto flex flex-col overflow-hidden rounded-t-2xl border-t line-color bg-[var(--c-zone)] shadow-[0_-6px_20px_rgba(0,0,0,0.35)]"
          style={{
            overflow: 'clip',
            height: heights.full,
            top: restTop,
            // 끄는 동안만 React 가 transform 을 쥔다. 멈추면 위 FLIP 효과가 'none' 으로 되돌린다.
            transform: dragging ? `translateY(${dragOffset}px)` : 'none',
            transition: 'none',
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
            {/* 손잡이는 막대+이름+화살표만(안내 문구는 시선을 끌어 제거, 2026-09-22 사용자). 상태 설명은 aria-label 로. */}
            <div className="mx-auto mb-1.5 h-1 w-9 rounded-full bg-[var(--c-line)]" />
            <div className="flex items-center justify-center gap-1.5 text-[12px] text-sub">
              <span>프롬프트</span>
              <FaChevronUp
                size={10}
                className="flex-none text-faint transition-transform duration-200"
                style={{ transform: state === 'full' ? 'rotate(180deg)' : undefined }}
              />
            </div>
          </div>
          {showBody && (
            <div
              aria-hidden={bodyHidden}
              className="flex-none min-h-0 overflow-hidden"
              onFocus={onBodyFocus}
              onBlur={onBodyBlur}
              style={{
                overflow: 'clip',
                // 본문 높이는 도착 상태 기준(시트 자체는 항상 전체 높이라 flex-1 을 쓰면 반 상태에서 바닥이 잘린다)
                height: Math.max(0, layoutHeight(bodyState) - V2_SHEET_PEEK_PX),
                visibility: bodyHidden ? 'hidden' : 'visible',
                // 접을 때는 내려가는 애니메이션이 끝난 뒤 숨기고, 열 때는 즉시 보인다
                transition: bodyHidden && ready ? 'visibility 0s linear 0.22s' : 'visibility 0s',
              }}
            >
              <PresetCompactContext.Provider value={bodyState !== 'full'}>
                <PresetFocusContext.Provider value={focusCtx}>{children}</PresetFocusContext.Provider>
              </PresetCompactContext.Provider>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default MobilePromptSheet;
