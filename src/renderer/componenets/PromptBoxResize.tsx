import React, { createContext, useLayoutEffect, useRef, useState } from 'react';
import { action, makeObservable, observable } from 'mobx';
import { observer } from 'mobx-react-lite';
import { appState } from '../models/AppService';
import {
  PROMPT_BOX_HANDLE_TEXT,
  dragPromptBoxWeights,
  loadPromptBoxWeights,
  promptBoxMinHeight,
  promptBoxWeightOf,
  savePromptBoxWeights,
} from '../models/promptBoxWeights';

// PC 메인 화면 프리셋 패널 — 펼친 프롬프트 칸 사이 손잡이로 높이 비율 나누기(2026-11-23 사용자 결정).
// 규칙·계산·문구는 models/promptBoxWeights.ts. 여기는 화면 쪽 배선만:
//  - 공급자(PromptBoxResizeContext)는 PreSetEditorImpl 이 메인 패널(promptResize·PC)일 때만 둔다.
//    공급자가 없으면(씬 편집 창·인페인트/I2I·조합·그림체 편집 등 inner 편집기, 모바일) EditorField 는 종전 마크업 그대로.
//  - 펼친 칸 본문(ResizablePromptBody)이 자기 키로 등록하고, 등록된 본문을 DOM 순서로 줄 세워
//    「이 칸과 그다음 펼친 프롬프트 칸」이 손잡이로 주고받는다(사이에 다른 줄이 끼어도 같음 — 접힌 칸은 본문이 없어 건너뜀).
//  - 가중치는 칸별 observable 값이라 끄는 동안(프레임당 한 번 반영) 두 칸 본문만 다시 그린다.
//    편집기(children)는 같은 요소라 React 가 다시 그리지 않는다 — 큰 프롬프트 입력 성능과 무관.

export class PromptBoxResizeStore {
  /** 칸별 가중치(없으면 균등 1) — 키 = 프롬프트 필드명(접힘 foldKey 와 같음) */
  weights = observable.map<string, number>();
  /** 지금 펼쳐져 본문이 있는 칸의 키, DOM 위→아래 순서 */
  order: string[] = [];
  private bodies = new Map<string, HTMLElement>();

  constructor() {
    makeObservable<PromptBoxResizeStore, 'refreshOrder'>(this, {
      order: observable.ref,
      setPair: action,
      resetAll: action,
      refreshOrder: action,
    });
    const saved = loadPromptBoxWeights();
    for (const [k, v] of Object.entries(saved)) this.weights.set(k, v);
  }

  weightOf(key: string): number {
    const v = this.weights.get(key);
    return promptBoxWeightOf(v === undefined ? {} : { [key]: v }, key);
  }

  /** 다음 펼친 칸의 키(없으면 undefined = 손잡이 없음) */
  nextOf(key: string): string | undefined {
    const i = this.order.indexOf(key);
    return i >= 0 ? this.order[i + 1] : undefined;
  }

  /** 요소 순서 편집모드 래퍼용 — 펼친 칸이면 그 가중치, 아니면 undefined(종전 flex-1) */
  expandedWeightOf(key: string | undefined): number | undefined {
    if (!key || !this.order.includes(key)) return undefined;
    return this.weightOf(key);
  }

  bodyOf(key: string): HTMLElement | undefined {
    return this.bodies.get(key);
  }

  register(key: string, el: HTMLElement) {
    this.bodies.set(key, el);
    this.refreshOrder();
  }

  unregister(key: string, el: HTMLElement) {
    if (this.bodies.get(key) === el) this.bodies.delete(key);
    this.refreshOrder();
  }

  private refreshOrder() {
    const next = [...this.bodies.entries()]
      .filter(([, el]) => el.isConnected)
      .sort(([, a], [, b]) =>
        a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
      )
      .map(([k]) => k);
    const same =
      next.length === this.order.length && next.every((k, i) => k === this.order[i]);
    if (!same) this.order = next;
  }

  setPair(upperKey: string, upper: number, lowerKey: string, lower: number) {
    if (this.weights.get(upperKey) !== upper) this.weights.set(upperKey, upper);
    if (this.weights.get(lowerKey) !== lower) this.weights.set(lowerKey, lower);
  }

  /** 두 번 누름 — 모든 칸 균등 */
  resetAll() {
    this.weights.clear();
    this.persist();
  }

  persist() {
    savePromptBoxWeights(Object.fromEntries(this.weights.entries()));
  }
}

export const PromptBoxResizeContext = createContext<PromptBoxResizeStore | null>(null);

// 편집기 줄 높이(px) — 하한(두 줄) 계산용. 못 읽으면 NaN → 모델의 기본값.
function editorLineHeight(body: HTMLElement): number {
  const ed = (body.querySelector('[contenteditable]') as HTMLElement | null) ?? body;
  try {
    return parseFloat(getComputedStyle(ed).lineHeight);
  } catch {
    return NaN;
  }
}

// 손잡이 — 레이아웃 높이 0 인 줄 안에 겹쳐 놓은 잡히는 영역(위로 2px 띄워 8px). 다음 칸 머리 줄 위 여백(PC 12px) 위에 놓여
// 칸 간격·머리 줄 위치는 그대로다. 평소 무채색 옅은 짧은 선(--c-line-strong), 마우스를 올리거나 끄는 동안만 패널 폭 손잡이(ResizableSplitter)와 같은 하늘색.
// 키보드 조작·탭 순서 없음(프롬프트 칸 주변에 새 단축키를 만들지 않는 규칙). 끌기 요소라 Tooltip 대신 title(SPEC 설명 표시 기준).
const PromptBoxHandle = observer(
  ({
    store,
    upperKey,
    lowerKey,
  }: {
    store: PromptBoxResizeStore;
    upperKey: string;
    lowerKey: string;
  }) => {
    const [dragging, setDragging] = useState(false);
    const onMouseDown = (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      // 편집기 포커스·글자 선택을 지킨다(끌기는 편집 내용·되돌리기와 무관한 보기 설정)
      e.preventDefault();
      e.stopPropagation();
      const up = store.bodyOf(upperKey);
      const lo = store.bodyOf(lowerKey);
      if (!up || !lo) return;
      const start = {
        upperHeight: up.getBoundingClientRect().height,
        lowerHeight: lo.getBoundingClientRect().height,
        upperWeight: store.weightOf(upperKey),
        lowerWeight: store.weightOf(lowerKey),
        minHeight: promptBoxMinHeight(editorLineHeight(up)),
      };
      const startY = e.clientY;
      let lastY = startY;
      let raf = 0;
      let moved = false;
      const apply = () => {
        raf = 0;
        const r = dragPromptBoxWeights({ ...start, delta: lastY - startY });
        if (r) {
          moved = true;
          store.setPair(upperKey, r.upper, lowerKey, r.lower);
        }
      };
      // 프레임당 한 번만 반영
      const onMove = (ev: MouseEvent) => {
        lastY = ev.clientY;
        if (!raf) raf = requestAnimationFrame(apply);
      };
      const end = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', end);
        window.removeEventListener('blur', end);
        if (raf) {
          cancelAnimationFrame(raf);
          apply();
        }
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        setDragging(false);
        if (moved) store.persist();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', end);
      window.addEventListener('blur', end);
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
      setDragging(true);
    };
    return (
      <div className="relative flex-none h-0">
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label={PROMPT_BOX_HANDLE_TEXT.label}
          title={PROMPT_BOX_HANDLE_TEXT.tooltip}
          data-prompt-box-handle={upperKey}
          className="group/prompt-box-handle absolute inset-x-0 top-0.5 h-2 flex items-center justify-center cursor-row-resize select-none"
          onMouseDown={onMouseDown}
          onDoubleClick={(e) => {
            e.preventDefault();
            store.resetAll();
          }}
        >
          <div
            className={
              'h-1 w-10 rounded-full ' +
              (dragging
                ? 'bg-sky-400 dark:bg-sky-500'
                : // 평소 = 무채색 옅은 선(--c-line-strong — 보이되 시선을 끌지 않게, 2026-11-23 사용자), 마우스를 올리면 하늘색
                  'bg-[var(--c-line-strong)] group-hover/prompt-box-handle:bg-sky-400 dark:group-hover/prompt-box-handle:bg-sky-500')
            }
          />
        </div>
      </div>
    );
  },
);

// 펼친 프롬프트 칸 본문(메인 패널 전용) — 종전 `flex-1 min-h-0` 그대로에 flex-grow 만 가중치로.
// 자기 키로 등록해 다음 펼친 칸을 알고, 다음 칸이 있고 요소 순서 편집모드가 아니면 본문 바로 아래에 손잡이.
export const ResizablePromptBody = observer(
  ({
    store,
    boxKey,
    children,
  }: {
    store: PromptBoxResizeStore;
    boxKey: string;
    children: React.ReactNode;
  }) => {
    const ref = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
      const el = ref.current;
      if (!el) return undefined;
      store.register(boxKey, el);
      return () => store.unregister(boxKey, el);
    }, [store, boxKey]);
    const next = store.nextOf(boxKey);
    return (
      <>
        <div
          ref={ref}
          className="flex-1 min-h-0"
          style={{ flexGrow: store.weightOf(boxKey) }}
          data-prompt-box={boxKey}
        >
          {children}
        </div>
        {next && !appState.editMode && (
          <PromptBoxHandle store={store} upperKey={boxKey} lowerKey={next} />
        )}
      </>
    );
  },
);
