import React, { useEffect, useRef, useState } from 'react';
import { FaCaretLeft, FaCaretRight, FaSearch } from 'react-icons/fa';
import { buildDanbooruSearchUrl } from '../models/util';
import { getFocusedPromptEditor } from '../models/promptEditorFocus';
import {
  formatPromptWeightLabel,
  PROMPT_WEIGHT_STEP,
} from '../models/promptTransforms';

/**
 * 모바일 키보드 위 칩(2026-09-26). 화면 하단 중앙, 키보드 바로 위(visualViewport)에 하나만 뜬다.
 *  · 검색 모드: 입력 칸에 선택 범위가 있으면 「Danbooru 검색」(예전 App.tsx 의 칩 그대로).
 *  · 조정 모드: 프롬프트 편집기(NativeEditTextArea)에 커서만 있으면 커서 구획의 가중치를
 *    [구획 이름][−][◂ 값 ▸][+] 로 조절 — PC 의 Ctrl+휠/Ctrl+↑↓ 와 같은 함수·단위(0.05).
 *    탭=한 단계, 값 트랙을 좌우로 문지르면 KBD_CHIP_SCRUB_PX 마다 한 단계(문지르는 동안 값 말풍선),
 *    −/+ 길게 누르면 KBD_CHIP_HOLD_MS 뒤 KBD_CHIP_REPEAT_MS 간격 반복. 초기화·범위 제한 없음(음수 허용).
 * 칩 전체는 pointerdown 기본 동작을 막아 편집기 포커스·선택을 유지한다(키보드가 내려가지 않게).
 */
export const KBD_CHIP_HOLD_MS = 350;
export const KBD_CHIP_REPEAT_MS = 100;
export const KBD_CHIP_SCRUB_PX = 24;

type ChipState =
  | { mode: 'search'; text: string }
  | { mode: 'adjust'; name: string; weight: number }
  | null;

function keyboardOffset(): number {
  // visualViewport 로 키보드 높이를 인식해 키보드 바로 위에 배치(없으면 화면 하단).
  const vv = window.visualViewport;
  return (
    (vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0) + 16
  );
}

function readState(): ChipState {
  // 모바일 프롬프트 에디터는 실제 <textarea>(NativeEditTextArea)이므로 선택 텍스트는
  // window.getSelection()이 아니라 textarea.value의 selectionStart~End 구간에 있다.
  const el = document.activeElement as HTMLTextAreaElement | null;
  const isField =
    !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT');
  if (!isField) {
    // contenteditable 등(혹시 다른 입력 영역)
    const selection = window.getSelection?.();
    const t = selection?.toString().trim() ?? '';
    if (selection && !selection.isCollapsed && t && buildDanbooruSearchUrl(t))
      return { mode: 'search', text: t };
    return null;
  }
  const start = el!.selectionStart;
  const end = el!.selectionEnd;
  if (start != null && end != null && end > start) {
    const text = (el!.value || '').substring(start, end).trim();
    return text && buildDanbooruSearchUrl(text)
      ? { mode: 'search', text }
      : null;
  }
  const editor = getFocusedPromptEditor();
  if (!editor || editor.element !== el) return null;
  const weight = editor.getCaretWeight();
  return weight
    ? { mode: 'adjust', name: weight.inner, weight: weight.weight }
    : null;
}

export default function MobileKeyboardChip({
  onSearch,
}: {
  onSearch: (text: string) => void;
}) {
  const [state, setState] = useState<ChipState>(null);
  const [bottom, setBottom] = useState(16);
  const [scrubbing, setScrubbing] = useState(false);
  const holdRef = useRef<{ timer: number; repeating: boolean } | null>(null);
  const dragRef = useRef<{ x: number; acc: number } | null>(null);

  const refresh = () => {
    setState(readState());
    setBottom(keyboardOffset());
  };

  useEffect(() => {
    // 롱프레스로 텍스트를 선택하면 자동 검색하지 않고(네이티브 복사/붙여넣기 메뉴 보존) 명시적으로 탭할 때만 검색한다.
    // selectionchange는 일부 안드로이드 WebView에서 신뢰도가 낮아, contextmenu(롱프레스)·touchend(손 뗀 직후)·
    // focusin/focusout(편집기 등록 뒤)도 함께 트리거로 사용한다. contextmenu는 preventDefault 하지 않는다.
    const update = () => refresh();
    const deferred = () => window.setTimeout(update, 0);
    document.addEventListener('selectionchange', update);
    document.addEventListener('contextmenu', update);
    document.addEventListener('touchend', update);
    document.addEventListener('focusin', deferred);
    document.addEventListener('focusout', deferred);
    // 키보드 표시/숨김(visualViewport 변화) 시 칩 위치를 다시 계산해 키보드 위에 유지.
    const vv = window.visualViewport;
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    return () => {
      document.removeEventListener('selectionchange', update);
      document.removeEventListener('contextmenu', update);
      document.removeEventListener('touchend', update);
      document.removeEventListener('focusin', deferred);
      document.removeEventListener('focusout', deferred);
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
      if (holdRef.current) window.clearTimeout(holdRef.current.timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const step = (delta: number) => {
    const editor = getFocusedPromptEditor();
    if (!editor || editor.element !== document.activeElement) return;
    editor.adjustWeight(delta);
    refresh();
  };
  const clearHold = () => {
    if (holdRef.current) window.clearTimeout(holdRef.current.timer);
    holdRef.current = null;
  };
  // −/+ : 손을 떼면 한 단계, 길게 누르면 반복(반복이 시작됐으면 뗄 때 한 단계를 더하지 않는다)
  const startHold = (delta: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    clearHold();
    const hold = { timer: 0, repeating: false };
    holdRef.current = hold;
    const repeat = () => {
      hold.repeating = true;
      step(delta);
      hold.timer = window.setTimeout(repeat, KBD_CHIP_REPEAT_MS);
    };
    hold.timer = window.setTimeout(repeat, KBD_CHIP_HOLD_MS);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
  };
  const endHold = (delta: number) => (e: React.PointerEvent) => {
    const hold = holdRef.current;
    if (!hold) return;
    clearHold();
    if (!hold.repeating && e.type === 'pointerup') step(delta);
  };
  // 값 트랙: 좌우로 문지르면 KBD_CHIP_SCRUB_PX 마다 한 단계
  const onTrackDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { x: e.clientX, acc: 0 };
    setScrubbing(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
  };
  const onTrackMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    drag.acc += e.clientX - drag.x;
    drag.x = e.clientX;
    while (Math.abs(drag.acc) >= KBD_CHIP_SCRUB_PX) {
      const dir = drag.acc > 0 ? 1 : -1;
      drag.acc -= dir * KBD_CHIP_SCRUB_PX;
      step(dir * PROMPT_WEIGHT_STEP);
    }
  };
  const onTrackUp = () => {
    dragRef.current = null;
    setScrubbing(false);
  };

  if (!state) return null;
  const base =
    'fixed z-[var(--z-kbd-action)] left-1/2 -translate-x-1/2 flex items-center rounded-xl bg-gray-900/95 text-gray-50 text-sm font-medium border border-white/10 shadow-xl backdrop-blur-sm whitespace-nowrap select-none max-w-[94vw]';

  if (state.mode === 'search') {
    return (
      <button
        data-danbooru-search-btn
        data-kbd-chip="search"
        className={
          base + ' gap-2 px-4 py-2.5 active:scale-95 transition-transform'
        }
        style={{ bottom }}
        // pointerdown에서 선택 해제/포커스 이동을 막고 검색을 실행한다(탭 즉시 선택이
        // 사라지면 click 전에 버튼이 언마운트될 수 있으므로 pointerdown 사용).
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const text = state.text;
          // 검색 후 버튼이 다시 뜨지 않도록 활성 textarea 선택을 접는다.
          const el = document.activeElement as HTMLTextAreaElement | null;
          if (
            el &&
            (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') &&
            el.selectionStart != null
          ) {
            try {
              el.setSelectionRange(el.selectionStart, el.selectionStart);
            } catch {}
          }
          setState(null);
          onSearch(text);
        }}
      >
        <FaSearch size={12} className="opacity-80" />
        <span>Danbooru 검색</span>
        <span className="max-w-[40vw] truncate text-sky-300/90 font-normal">
          {state.text}
        </span>
      </button>
    );
  }

  const label = formatPromptWeightLabel(state.weight);
  const stepBtn =
    'relative touch-hit flex-none w-8 h-[30px] rounded-lg bg-white/10 active:bg-white/20 text-lg leading-none';
  return (
    <div
      data-kbd-chip="adjust"
      className={base + ' gap-1.5 pl-3 pr-1 py-1'}
      style={{ bottom }}
      onPointerDown={(e) => e.preventDefault()}
    >
      <span
        data-kbd-chip-name
        className="max-w-[34vw] truncate text-sky-300/90 font-normal"
      >
        {state.name}
      </span>
      <button
        type="button"
        aria-label="가중치 0.05 낮추기"
        data-kbd-chip-step="-1"
        className={stepBtn}
        onPointerDown={startHold(-PROMPT_WEIGHT_STEP)}
        onPointerUp={endHold(-PROMPT_WEIGHT_STEP)}
        onPointerCancel={endHold(-PROMPT_WEIGHT_STEP)}
      >
        −
      </button>
      <div
        data-kbd-chip-track
        role="slider"
        aria-label="좌우로 문질러 가중치 조정"
        aria-valuenow={state.weight}
        className="relative flex-none flex items-center justify-center gap-1 min-w-[4.5rem] h-[30px] rounded-lg bg-white/[.06] touch-none"
        onPointerDown={onTrackDown}
        onPointerMove={onTrackMove}
        onPointerUp={onTrackUp}
        onPointerCancel={onTrackUp}
      >
        <FaCaretLeft size={10} className="opacity-40" />
        <span
          data-kbd-chip-value
          className="min-w-[2rem] text-center tabular-nums font-semibold"
        >
          {label}
        </span>
        <FaCaretRight size={10} className="opacity-40" />
        {scrubbing && (
          <div
            data-kbd-chip-bubble
            className="absolute left-1/2 -translate-x-1/2 bottom-[calc(100%+10px)] px-2.5 py-1 rounded-lg bg-sky-500 text-white font-bold text-[15px] shadow-lg pointer-events-none"
          >
            {label}
          </div>
        )}
      </div>
      <button
        type="button"
        aria-label="가중치 0.05 높이기"
        data-kbd-chip-step="1"
        className={stepBtn}
        onPointerDown={startHold(PROMPT_WEIGHT_STEP)}
        onPointerUp={endHold(PROMPT_WEIGHT_STEP)}
        onPointerCancel={endHold(PROMPT_WEIGHT_STEP)}
      >
        +
      </button>
    </div>
  );
}
