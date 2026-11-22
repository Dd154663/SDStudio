import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { FaChevronDown, FaChevronUp, FaTimes } from 'react-icons/fa';
import {
  findPromptMatches,
  pickPromptMatchIndex,
  promptFindCountLabel,
  promptFindPrefill,
  replaceAllPromptMatches,
  replacePromptMatchAt,
  stepPromptMatchIndex,
  type PromptFindEditResult,
  type PromptFindMatch,
  type PromptFindTarget,
} from '../models/promptFind';
import {
  clearPromptFindHighlights,
  paintPromptFindHighlights,
  promptRangeToDomRange,
  scrollPromptRangeIntoView,
} from '../models/promptFindDom';

/**
 * 「이 칸에서 찾기·바꾸기」(2026-11-22). 규칙은 models/promptFind.ts, DOM 변환·표시는 models/promptFindDom.ts.
 *  · usePromptFind = PC 검색 줄(아래 PromptFindBar)과 모바일 키보드 위 칩의 찾기 모드가 함께 쓰는 상태·동작.
 *  · PromptFindBar = PC 검색 줄. 편집기(PromptEditTextArea) Fragment 의 형제로 fixed·프롬프트 팝업 층에 뜬다
 *    (자동완성과 같은 방식 — 포털·새 층 없음). 등장·퇴장 움직임 없음.
 * 키보드 단축키는 만들지 않는다(사용자 결정) — 검색 줄 입력 칸 안의 Enter·Shift+Enter 만. Esc 는 닫기 관문(호출부의 useBackLayer).
 */

/** 표시할 일치 수 상한 — 아주 짧은 찾는 말로 수천 개가 나와도 칠하기가 늘어지지 않게. 개수·이동은 전부 센다. */
const MAX_PAINTED_MATCHES = 2000;

export interface PromptFindController {
  query: string;
  setQuery(q: string): void;
  replacement: string;
  setReplacement(r: string): void;
  caseSensitive: boolean;
  toggleCase(): void;
  matches: PromptFindMatch[];
  index: number;
  countLabel: string;
  readOnly: boolean;
  next(): void;
  prev(): void;
  replaceOne(): Promise<void>;
  replaceAll(): Promise<void>;
  /** 편집기로 포커스를 돌려 현재 자리(없으면 연 때의 커서)를 고른다. collapse 면 현재 자리 끝에 캐럿만. */
  focusBack(collapse?: boolean): void;
  /** 열 때마다 1 씩 — 검색 입력의 포커스·전체 선택 시점. */
  openId: number;
}

export function usePromptFind(
  target: PromptFindTarget | null,
  active: boolean,
  opts?: { bottomLimit?: () => number | undefined },
): PromptFindController {
  const [text, setText] = useState('');
  const [query, setQueryState] = useState('');
  const [replacement, setReplacement] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [anchor, setAnchor] = useState(0);
  const [domVersion, setDomVersion] = useState(0);
  const [scrollTick, setScrollTick] = useState(0);
  const [openId, setOpenId] = useState(0);
  const origSelRef = useRef<[number, number]>([0, 0]);
  const busyRef = useRef(false);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const on = active && !!target;

  // 열 때: 글자·커서를 읽고, 고른 글자(한 줄·100자 이하)는 찾는 말로. 글자 층이 다시 그려지면 다시 읽는다.
  useLayoutEffect(() => {
    if (!on || !target) return undefined;
    const t = target.getText();
    const sel = target.getSelection();
    origSelRef.current = sel;
    setText(t);
    setQueryState(promptFindPrefill(t, sel[0], sel[1]));
    setReplacement('');
    setCaseSensitive(false);
    setAnchor(sel[0]);
    setScrollTick((x) => x + 1);
    setOpenId((x) => x + 1);
    const root = target.getHighlightRoot();
    let obs: MutationObserver | null = null;
    if (root && typeof MutationObserver !== 'undefined') {
      obs = new MutationObserver(() => {
        setText(target.getText());
        setDomVersion((v) => v + 1);
      });
      obs.observe(root, { childList: true, subtree: true, characterData: true });
    }
    return () => {
      obs?.disconnect();
      clearPromptFindHighlights();
    };
  }, [on, target]);

  const matches = useMemo(
    () => (on ? findPromptMatches(text, query, caseSensitive) : []),
    [on, text, query, caseSensitive],
  );
  const index = pickPromptMatchIndex(matches, anchor);
  const current = index >= 0 ? matches[index] : undefined;

  // 일치 표시 — 값이 바뀌어 글자 층이 다시 만들어질 때마다 Range 를 다시 만든다.
  useEffect(() => {
    if (!on || !target) return;
    const root = target.getHighlightRoot();
    if (!root || matches.length === 0) {
      clearPromptFindHighlights();
      return;
    }
    const ranges: Range[] = [];
    let cur: Range | null = null;
    const lo = Math.max(0, Math.min(index, matches.length - 1) - MAX_PAINTED_MATCHES / 2);
    const hi = Math.min(matches.length, lo + MAX_PAINTED_MATCHES);
    for (let i = lo; i < hi; i++) {
      const r = promptRangeToDomRange(root, matches[i].start, matches[i].end);
      if (!r) continue;
      ranges.push(r);
      if (i === index) cur = r;
    }
    paintPromptFindHighlights(ranges, cur);
  }, [on, target, matches, index, domVersion]);

  // 현재 자리가 보이게(이동·바꾸기·찾는 말 변경 때).
  useEffect(() => {
    if (!on || !target || !current) return;
    const root = target.getHighlightRoot();
    if (!root) return;
    const r = promptRangeToDomRange(root, current.start, current.end);
    if (!r) return;
    try {
      scrollPromptRangeIntoView(
        r,
        target.getScrollContainer(),
        optsRef.current?.bottomLimit?.(),
      );
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, target, current?.start, current?.end, scrollTick]);

  const readOnly = !target || target.isReadOnly();

  const setQuery = useCallback((q: string) => {
    setQueryState(q);
    setScrollTick((x) => x + 1);
  }, []);

  const move = (dir: 1 | -1) => {
    if (matches.length === 0) return;
    const i = stepPromptMatchIndex(index, matches.length, dir);
    setAnchor(matches[i].start);
    setScrollTick((x) => x + 1);
  };

  const run = async (
    compute: (t: string) => PromptFindEditResult | null,
  ): Promise<void> => {
    if (!target || readOnly || busyRef.current) return;
    busyRef.current = true;
    try {
      let resume: number | null = null;
      const res = await target.applyFindEdit((t) => {
        const r = compute(t);
        resume = r ? r.resumeFrom : null;
        return r;
      });
      if (res !== null && res !== undefined) {
        setText(res);
        if (resume !== null) setAnchor(resume);
      }
      setScrollTick((x) => x + 1);
    } finally {
      busyRef.current = false;
    }
  };

  return {
    query,
    setQuery,
    replacement,
    setReplacement,
    caseSensitive,
    toggleCase: () => {
      setCaseSensitive((v) => !v);
      setScrollTick((x) => x + 1);
    },
    matches,
    index,
    countLabel: promptFindCountLabel(query, index, matches.length),
    readOnly,
    openId,
    next: () => move(1),
    prev: () => move(-1),
    replaceOne: async () => {
      if (!current) return;
      const start = current.start;
      await run((t) =>
        replacePromptMatchAt(t, query, caseSensitive, start, replacement),
      );
    },
    replaceAll: async () => {
      if (matches.length === 0) return;
      await run((t) =>
        replaceAllPromptMatches(t, query, caseSensitive, replacement),
      );
    },
    focusBack: (collapse?: boolean) => {
      if (!target) return;
      try {
        if (current && collapse) target.focusAt(current.end, current.end);
        else if (current) target.focusAt(current.start, current.end);
        else target.focusAt(origSelRef.current[0], origSelRef.current[1]);
      } catch {}
    },
  };
}

/** 검색 줄 입력 칸의 Enter·Shift+Enter(한글 조합 중이면 무시). Esc 는 여기서 다루지 않는다(닫기 관문). */
export function promptFindEnterKey(
  e: React.KeyboardEvent,
  onEnter: (shift: boolean) => void,
): void {
  if (e.key !== 'Enter') return;
  const native = e.nativeEvent as KeyboardEvent;
  if (native?.isComposing || (native as any)?.keyCode === 229) return;
  e.preventDefault();
  onEnter(e.shiftKey);
}

const FIND_BAR_GAP = 5;
const FIND_BAR_WIDTH = 340;
const FIND_BAR_EDGE = 8;

/** 검색 줄 위치 — 편집기 뿌리 바로 위·오른쪽 맞춤, 위가 모자라면 바로 아래, 보이는 화면 안으로. */
export function placePromptFindBar(
  anchor: { top: number; bottom: number; right: number },
  bar: { width: number; height: number },
  view: { left: number; top: number; width: number; height: number },
): { left: number; top: number } {
  let left = anchor.right - bar.width;
  let top = anchor.top - FIND_BAR_GAP - bar.height;
  if (top < view.top + FIND_BAR_EDGE) top = anchor.bottom + FIND_BAR_GAP;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  left = clamp(
    left,
    view.left + FIND_BAR_EDGE,
    view.left + view.width - bar.width - FIND_BAR_EDGE,
  );
  top = clamp(
    top,
    view.top + FIND_BAR_EDGE,
    view.top + view.height - bar.height - FIND_BAR_EDGE,
  );
  return { left, top };
}

export function promptFindBarWidth(viewWidth: number): number {
  return Math.max(120, Math.min(FIND_BAR_WIDTH, viewWidth - 16));
}

const iconBtn = 'icon-button icon-only flex-none w-7 h-7 flex items-center justify-center';

export const PromptFindBar = React.forwardRef<
  HTMLDivElement,
  {
    finder: PromptFindController;
    anchor: HTMLElement | null;
    /** 크게 편집 전환 등 위치를 다시 잡아야 하는 값. */
    layoutKey?: unknown;
    onClose: () => void;
    onLeave?: (e: React.FocusEvent) => void;
  }
>(({ finder, anchor, layoutKey, onClose, onLeave }, ref) => {
  const barRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;

  const place = useCallback(() => {
    const bar = barRef.current;
    const a = anchorRef.current;
    if (!bar || !a) return;
    const vv = window.visualViewport;
    const view = {
      left: vv ? vv.offsetLeft : 0,
      top: vv ? vv.offsetTop : 0,
      width: vv ? vv.width : window.innerWidth,
      height: vv ? vv.height : window.innerHeight,
    };
    const width = promptFindBarWidth(view.width);
    bar.style.width = width + 'px';
    const pos = placePromptFindBar(
      a.getBoundingClientRect(),
      { width, height: bar.offsetHeight },
      view,
    );
    bar.style.left = pos.left + 'px';
    bar.style.top = pos.top + 'px';
    // 조상에 transform 이 있어 fixed 의 기준이 화면이 아니면 그 차이만큼 되돌린다.
    const r = bar.getBoundingClientRect();
    const dx = r.left - pos.left;
    const dy = r.top - pos.top;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      bar.style.left = pos.left - dx + 'px';
      bar.style.top = pos.top - dy + 'px';
    }
  }, []);

  useLayoutEffect(() => {
    place();
  });

  useLayoutEffect(() => {
    place();
  }, [layoutKey, place]);

  useEffect(() => {
    const onMove = () => place();
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    const vv = window.visualViewport;
    vv?.addEventListener('resize', onMove);
    vv?.addEventListener('scroll', onMove);
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && anchorRef.current) {
      ro = new ResizeObserver(onMove);
      ro.observe(anchorRef.current);
    }
    return () => {
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
      vv?.removeEventListener('resize', onMove);
      vv?.removeEventListener('scroll', onMove);
      ro?.disconnect();
    };
  }, [place]);

  // 열 때 검색 입력에 포커스(고른 글자가 들어왔으면 전체 선택).
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    try {
      el.select();
    } catch {}
  }, [finder.openId]);

  return (
    <div
      ref={(el) => {
        barRef.current = el;
        if (typeof ref === 'function') ref(el);
        else if (ref) ref.current = el;
      }}
      data-prompt-find-bar
      role="search"
      aria-label="이 칸에서 찾기"
      className="fixed z-[var(--z-prompt-popup)] flex flex-col gap-1.5 p-1.5 bg-[var(--c-surface-2)] text-default rounded-lg shadow-xl border line-color text-sm"
      style={{ left: -9999, top: -9999, width: FIND_BAR_WIDTH }}
      onBlurCapture={onLeave}
    >
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          data-prompt-find-query
          type="text"
          className="gray-input flex-1 min-w-0 px-2 text-sm"
          placeholder="이 칸에서 찾기"
          aria-label="찾을 말"
          spellCheck={false}
          value={finder.query}
          onChange={(e) => finder.setQuery(e.target.value)}
          onKeyDown={(e) =>
            promptFindEnterKey(e, (shift) => (shift ? finder.prev() : finder.next()))
          }
        />
        <span
          role="status"
          aria-live="polite"
          data-prompt-find-count
          className="flex-none min-w-[3.5rem] text-center text-xs text-muted tabular-nums"
        >
          {finder.countLabel}
        </span>
        <button
          type="button"
          className={iconBtn}
          aria-label="이전 일치"
          title="이전 일치"
          disabled={finder.matches.length === 0}
          onMouseDown={(e) => e.preventDefault()}
          onClick={finder.prev}
        >
          <FaChevronUp size={12} />
        </button>
        <button
          type="button"
          className={iconBtn}
          aria-label="다음 일치"
          title="다음 일치"
          disabled={finder.matches.length === 0}
          onMouseDown={(e) => e.preventDefault()}
          onClick={finder.next}
        >
          <FaChevronDown size={12} />
        </button>
        <button
          type="button"
          className={iconBtn + ' text-xs font-semibold'}
          aria-label="대소문자 구분"
          title="대소문자 구분"
          aria-pressed={finder.caseSensitive}
          data-prompt-find-case
          style={
            finder.caseSensitive
              ? {
                  color: 'var(--c-focus-ring)',
                  boxShadow: 'inset 0 0 0 1px var(--c-focus-ring)',
                }
              : undefined
          }
          onMouseDown={(e) => e.preventDefault()}
          onClick={finder.toggleCase}
        >
          Aa
        </button>
        <button
          type="button"
          className={iconBtn}
          aria-label="찾기 닫기"
          title="찾기 닫기"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClose}
        >
          <FaTimes size={12} />
        </button>
      </div>
      {!finder.readOnly && (
        <div className="flex items-center gap-1" data-prompt-find-replace-row>
          <input
            type="text"
            data-prompt-find-replacement
            className="gray-input flex-1 min-w-0 px-2 text-sm"
            placeholder="바꿀 말"
            aria-label="바꿀 말"
            spellCheck={false}
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
            className="round-button btn-neutral flex-none text-xs px-2 py-1"
            disabled={finder.index < 0}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void finder.replaceOne()}
          >
            바꾸기
          </button>
          <button
            type="button"
            className="round-button btn-neutral flex-none text-xs px-2 py-1"
            disabled={finder.matches.length === 0}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void finder.replaceAll()}
          >
            모두 바꾸기
          </button>
        </div>
      )}
    </div>
  );
});
PromptFindBar.displayName = 'PromptFindBar';
