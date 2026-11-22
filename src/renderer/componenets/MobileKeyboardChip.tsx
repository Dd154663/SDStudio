import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  FaCaretLeft,
  FaCaretRight,
  FaChevronDown,
  FaChevronUp,
  FaSearch,
} from 'react-icons/fa';
import { buildDanbooruSearchUrl } from '../models/util';
import {
  getFocusedPromptEditor,
  pinFocusedPromptEditor,
  subscribePromptEditorDispose,
  type FocusedPromptEditor,
} from '../models/promptEditorFocus';
import {
  formatPromptWeightLabel,
  PROMPT_WEIGHT_STEP,
} from '../models/promptTransforms';
import { setKeyboardChipVisible } from '../models/keyboardChipState';
import { useBackLayer } from '../models/BackStackService';
import { promptFindEnterKey, usePromptFind } from './PromptFindBar';

/**
 * 모바일 키보드 위 칩(2026-09-26). 화면 하단 중앙, 키보드 바로 위(visualViewport)에 하나만 뜬다.
 *  · 검색 모드: 입력 칸에 선택 범위가 있으면 「Danbooru 검색」(예전 App.tsx 의 칩 그대로).
 *  · 조정 모드: 프롬프트 편집기(NativeEditTextArea)에 커서만 있으면 커서 구획의 가중치를
 *    [구획 이름][−][◂ 값 ▸][+] 로 조절 — PC 의 Ctrl+휠/Ctrl+↑↓ 와 같은 함수·단위(0.05).
 *    탭=한 단계, 값 트랙을 좌우로 문지르면 KBD_CHIP_SCRUB_PX 마다 한 단계(문지르는 동안 값 말풍선),
 *    −/+ 길게 누르면 KBD_CHIP_HOLD_MS 뒤 KBD_CHIP_REPEAT_MS 간격 반복. 초기화·범위 제한 없음(음수 허용).
 *    [+] 오른쪽 [#] = 커서 기준 ##주석## 토글(2026-10-03, 주석 안이면 풀기·밖이면 구획을 감싸기, 주석 안이면 활성 표시).
 *    [#] 는 구분선으로 [+] 와 분리(2026-10-03 실기 피드백 — 오터치 방지, [+]~[#] 간격 약 17px).
 * 칩 전체는 pointerdown 기본 동작을 막아 편집기 포커스·선택을 유지한다(키보드가 내려가지 않게).
 *  · 찾기 모드(2026-11-22 「이 칸에서 찾기·바꾸기」): 조정 칩 끝(구분선 뒤)의 돋보기 — 커서가 빈 구획이라 조정 칩이 없을 때도
 *    칸에 글자가 있으면 돋보기만 있는 작은 칩. 누르면 칩 내용이 검색 창(1줄 찾기·개수·▲▼·Aa·돌아가기 / 2줄 바꿀 말·바꾸기·모두,
 *    읽기 전용 칸은 1줄)으로 바뀐다. 이때는 칩의 입력 칸이 포커스를 받고(입력 칸만 pointerdown 기본 동작을 막지 않음),
 *    등록소의 핸들을 붙잡아(pinFocusedPromptEditor) 대상 편집기를 계속 기억한다. 규칙은 PC 검색 줄과 같은 usePromptFind.
 *    닫힘 = 돌아가기(조정 줄로, 포커스는 편집기) · 대상 편집기와 칩 밖 누름 · 키보드 내려감 · 편집기 언마운트 · 뒤로 가기(닫기 관문).
 *    Danbooru 검색 칩에는 돋보기를 넣지 않는다(돋보기 아이콘이 둘이 됨).
 */
export const KBD_CHIP_HOLD_MS = 350;
export const KBD_CHIP_REPEAT_MS = 100;
export const KBD_CHIP_SCRUB_PX = 24;
/**
 * 집중 모드(편집 칸이 남는 높이를 전부 쓰는 배치)에서 칩이 마지막 줄을 가리지 않게 컨테이너 아래에 비워 두는 높이(2026-09-27).
 * = 칩 높이 약 38px + 화면 아래 띄움 16px. V2 시트·PromptFocusShell·씬 편집 창 집중 모드가 같은 값을 쓴다.
 */
export const KBD_CHIP_RESERVE_PX = 56;

type ChipState =
  | { mode: 'search'; text: string }
  | {
      mode: 'adjust';
      name: string;
      weight: number;
      inComment: boolean;
      canFind: boolean;
    }
  // 커서가 빈 구획이지만 칸에 글자가 있음 — 돋보기만 있는 작은 칩(찾기 모드로 들어갈 길을 남긴다)
  | { mode: 'find-entry' }
  | null;

/** 찾기 모드에 들어간 뒤 이 시간 동안은 키보드 높이 변화로 닫지 않는다(포커스가 칩 입력 칸으로 옮겨 가는 사이의 흔들림). */
const FIND_KEYBOARD_SETTLE_MS = 600;
/** 보이는 화면 높이가 찾기 모드에 들어갈 때보다 이만큼 커지면 키보드가 내려간 것으로 본다. */
const FIND_KEYBOARD_DOWN_PX = 120;

function visibleHeight(): number {
  const vv = window.visualViewport;
  return vv ? vv.height : window.innerHeight;
}

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
  if (weight)
    return {
      mode: 'adjust',
      name: weight.inner,
      weight: weight.weight,
      inComment: editor.isCaretInComment(),
      canFind: !!editor.find,
    };
  return editor.find && (el!.value || '').length > 0
    ? { mode: 'find-entry' }
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
  const commentPressRef = useRef(false);

  // 찾기 모드 — 대상 편집기 핸들(등록소에서 붙잡음)과 들어갈 때의 보이는 높이·시각.
  const [find, setFind] = useState<{
    target: FocusedPromptEditor;
    startHeight: number;
    at: number;
  } | null>(null);
  const findRef = useRef(find);
  findRef.current = find;
  const unpinRef = useRef<(() => void) | null>(null);
  const chipRef = useRef<HTMLDivElement | null>(null);
  const queryRef = useRef<HTMLInputElement | null>(null);
  const finder = usePromptFind(find?.target.find ?? null, !!find, {
    // 현재 자리가 칩(두 줄이라 조정 줄보다 높음)과 키보드에 가리지 않게 — 칩 윗변이 아래 경계.
    bottomLimit: () => chipRef.current?.getBoundingClientRect().top,
  });
  const finderRef = useRef(finder);
  finderRef.current = finder;

  const closeFind = (opts: { focus: boolean }) => {
    const cur = findRef.current;
    if (!cur) return;
    findRef.current = null;
    unpinRef.current?.();
    unpinRef.current = null;
    setFind(null);
    if (opts.focus) {
      // 조정 줄로 돌아가게 캐럿은 접어서 둔다(범위를 고르면 Danbooru 검색 칩이 된다).
      finderRef.current.focusBack(true);
    } else {
      try {
        cur.target.leave?.();
      } catch {}
    }
    window.setTimeout(() => {
      setState(readState());
      setBottom(keyboardOffset());
    }, 0);
  };
  const closeFindRef = useRef(closeFind);
  closeFindRef.current = closeFind;

  const enterFind = () => {
    const editor = getFocusedPromptEditor();
    if (!editor || !editor.find || editor.element !== document.activeElement)
      return;
    unpinRef.current?.();
    unpinRef.current = pinFocusedPromptEditor(editor);
    const next = { target: editor, startHeight: visibleHeight(), at: Date.now() };
    findRef.current = next;
    setFind(next);
  };

  const refresh = () => {
    setState(readState());
    setBottom(keyboardOffset());
    const f = findRef.current;
    if (
      f &&
      Date.now() - f.at > FIND_KEYBOARD_SETTLE_MS &&
      visibleHeight() > f.startHeight + FIND_KEYBOARD_DOWN_PX
    ) {
      closeFindRef.current({ focus: false });
    }
  };

  // 찾기 모드: 검색 입력에 포커스(같은 사용자 동작 안에서 — 키보드가 내려가지 않게 layout effect).
  useLayoutEffect(() => {
    if (!find) return;
    const el = queryRef.current;
    if (!el) return;
    el.focus();
    try {
      el.select();
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!find, finder.openId]);

  // 찾기 모드: 대상 편집기와 칩 밖을 누르면 닫는다(포커스는 건드리지 않음). 편집기가 사라지면 닫는다.
  useEffect(() => {
    if (!find) return undefined;
    const onDown = (e: Event) => {
      const n = e.target as Node | null;
      if (!n) return;
      if (chipRef.current?.contains(n)) return;
      const scroll = find.target.find?.getScrollContainer();
      if (find.target.element.contains(n) || scroll?.contains(n)) return;
      closeFindRef.current({ focus: false });
    };
    document.addEventListener('pointerdown', onDown, true);
    const offDispose = subscribePromptEditorDispose((editor) => {
      if (findRef.current?.target === editor) {
        // 편집기가 이미 없으니 「칸을 떠남」 확인은 부르지 않는다.
        findRef.current = null;
        unpinRef.current?.();
        unpinRef.current = null;
        setFind(null);
      }
    });
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      offDispose();
    };
  }, [find]);

  useEffect(
    () => () => {
      unpinRef.current?.();
      unpinRef.current = null;
    },
    [],
  );

  // Android 뒤로 가기·외장 키보드 Esc = 찾기 모드만 닫는다(닫기 관문 맨 위 층). 키보드를 다시 올리지 않게 포커스는 그대로.
  useBackLayer(!!find, () => closeFind({ focus: false }));

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

  // 칩 표시 여부를 관찰 상자로 알린다 — 되돌리기 버튼 바(UndoRedoBar)가 칩이 떠 있는 동안 숨는다.
  useEffect(() => {
    setKeyboardChipVisible(!!state || !!find);
  }, [state, find]);
  useEffect(() => () => setKeyboardChipVisible(false), []);

  const step = (delta: number) => {
    const editor = getFocusedPromptEditor();
    if (!editor || editor.element !== document.activeElement) return;
    editor.adjustWeight(delta);
    refresh();
  };
  // # : 주석 토글 — −/+ 처럼 손을 뗄 때 한 번(길게 누르기 반복 없음)
  const onCommentDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    commentPressRef.current = true;
  };
  const onCommentUp = (e: React.PointerEvent) => {
    const pressed = commentPressRef.current;
    commentPressRef.current = false;
    if (!pressed || e.type !== 'pointerup') return;
    const editor = getFocusedPromptEditor();
    if (!editor || editor.element !== document.activeElement) return;
    editor.toggleComment();
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

  const base =
    'fixed z-[var(--z-kbd-action)] left-1/2 -translate-x-1/2 flex items-center rounded-xl bg-gray-900/95 text-gray-50 text-sm font-medium border border-white/10 shadow-xl backdrop-blur-sm whitespace-nowrap select-none max-w-[94vw]';
  const btnShape =
    'relative touch-hit flex-none w-8 h-[30px] rounded-lg leading-none';
  const stepBtn = btnShape + ' bg-white/10 active:bg-white/20 text-lg';
  const onBtn = 'bg-sky-500/80 active:bg-sky-500 text-white';
  const offBtn = 'bg-white/10 active:bg-white/20';
  const magnifier = (pressed: boolean, onTap: () => void) => (
    <button
      type="button"
      aria-label="이 칸에서 찾기"
      aria-pressed={pressed}
      data-kbd-chip-find
      className={
        btnShape + ' flex items-center justify-center ' + (pressed ? onBtn : offBtn)
      }
      onClick={onTap}
    >
      <FaSearch size={12} />
    </button>
  );

  if (find) {
    const fieldCls =
      'flex-1 min-w-0 h-[30px] rounded-lg bg-white/10 px-2 text-sm font-normal text-gray-50 placeholder:text-gray-400 outline-none focus:ring-1 focus:ring-[color:var(--c-focus-ring)] select-text';
    return (
      <div
        ref={chipRef}
        data-kbd-chip="find"
        data-prompt-find-bar
        role="search"
        aria-label="이 칸에서 찾기"
        className={base + ' flex-col items-stretch gap-1 p-1.5 w-[94vw] sm:w-[26rem]'}
        style={{ bottom }}
        // 입력 칸은 포커스를 받아야 하므로 막지 않는다. 버튼은 막아 입력 칸 포커스(키보드)를 지킨다.
        onPointerDown={(e) => {
          const t = e.target as HTMLElement | null;
          if (t && typeof t.closest === 'function' && t.closest('input')) return;
          e.preventDefault();
        }}
      >
        <div className="flex items-center gap-1">
          <input
            ref={queryRef}
            type="text"
            data-kbd-chip-find-query
            className={fieldCls}
            placeholder="이 칸에서 찾기"
            aria-label="찾을 말"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            value={finder.query}
            onChange={(e) => finder.setQuery(e.target.value)}
            onKeyDown={(e) =>
              promptFindEnterKey(e, (shift) => (shift ? finder.prev() : finder.next()))
            }
          />
          <span
            role="status"
            aria-live="polite"
            data-kbd-chip-find-count
            className="flex-none min-w-[2.75rem] text-center text-xs font-normal tabular-nums text-gray-300"
          >
            {finder.countLabel}
          </span>
          <button
            type="button"
            aria-label="이전 일치"
            className={btnShape + ' flex items-center justify-center ' + offBtn}
            onClick={finder.prev}
          >
            <FaChevronUp size={11} />
          </button>
          <button
            type="button"
            aria-label="다음 일치"
            className={btnShape + ' flex items-center justify-center ' + offBtn}
            onClick={finder.next}
          >
            <FaChevronDown size={11} />
          </button>
          <button
            type="button"
            aria-label="대소문자 구분"
            aria-pressed={finder.caseSensitive}
            data-kbd-chip-find-case
            className={btnShape + ' text-xs font-semibold ' + (finder.caseSensitive ? onBtn : offBtn)}
            onClick={finder.toggleCase}
          >
            Aa
          </button>
          {magnifier(true, () => closeFind({ focus: true }))}
        </div>
        {!finder.readOnly && (
          <div className="flex items-center gap-1" data-kbd-chip-find-replace-row>
            <input
              type="text"
              data-kbd-chip-find-replacement
              className={fieldCls}
              placeholder="바꿀 말"
              aria-label="바꿀 말"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              value={finder.replacement}
              onChange={(e) => finder.setReplacement(e.target.value)}
              onKeyDown={(e) =>
                promptFindEnterKey(e, () => {
                  void finder.replaceOne();
                })
              }
            />
            <button
              type="button"
              className={btnShape + ' w-auto px-2.5 text-xs disabled:opacity-50 ' + offBtn}
              disabled={finder.index < 0}
              onClick={() => void finder.replaceOne()}
            >
              바꾸기
            </button>
            <button
              type="button"
              aria-label="모두 바꾸기"
              className={btnShape + ' w-auto px-2.5 text-xs disabled:opacity-50 ' + offBtn}
              disabled={finder.matches.length === 0}
              onClick={() => void finder.replaceAll()}
            >
              모두
            </button>
          </div>
        )}
      </div>
    );
  }

  if (!state) return null;

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

  if (state.mode === 'find-entry') {
    return (
      <div
        data-kbd-chip="find-entry"
        className={base + ' px-1.5 py-1'}
        style={{ bottom }}
        onPointerDown={(e) => e.preventDefault()}
      >
        {magnifier(false, enterFind)}
      </div>
    );
  }

  const label = formatPromptWeightLabel(state.weight);
  return (
    <div
      data-kbd-chip="adjust"
      className={base + ' gap-1.5 pl-3 pr-1.5 py-1'}
      style={{ bottom }}
      onPointerDown={(e) => e.preventDefault()}
    >
      <span
        data-kbd-chip-name
        className="max-w-[24vw] truncate text-sky-300/90 font-normal"
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
            className="absolute left-1/2 -translate-x-1/2 bottom-[calc(100%+10px)] px-2.5 py-1 rounded-lg bg-sky-600 text-white dark:bg-sky-500 font-bold text-[15px] shadow-lg pointer-events-none"
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
      {/* [+] 와 [#] 를 별도 영역으로: gap 6 + mx-0.5 2 + 선 1 + 2 + gap 6 = 약 17px(터치 판정 확장 4px 씩 빼도 9px) */}
      <span
        aria-hidden
        data-kbd-chip-divider
        className="flex-none self-center h-5 mx-0.5 border-l border-white/15"
      />
      <button
        type="button"
        aria-label="주석 토글(##로 감싸기/풀기)"
        aria-pressed={state.inComment}
        data-kbd-chip-comment
        className={
          btnShape +
          ' text-base font-semibold ' +
          (state.inComment
            ? 'bg-sky-500/80 active:bg-sky-500 text-white'
            : 'bg-white/10 active:bg-white/20')
        }
        onPointerDown={onCommentDown}
        onPointerUp={onCommentUp}
        onPointerCancel={onCommentUp}
      >
        #
      </button>
      {state.canFind && (
        <>
          <span
            aria-hidden
            data-kbd-chip-divider
            className="flex-none self-center h-5 mx-0.5 border-l border-white/15"
          />
          {magnifier(false, enterFind)}
        </>
      )}
    </div>
  );
}
