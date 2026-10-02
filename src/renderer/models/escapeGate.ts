// 닫기 관문의 순수 규칙 (2026-10-03 정비 U1·X2) — BackStackService 가 쓴다.
//
// 열린 창(모달·FloatView·확인 창·환경설정·팝오버·선택 모드 등)은 BackStackService 에 열린 순서대로
// 쌓이고, Android 뒤로 가기와 PC Esc 는 **맨 위 한 겹만** 처리한다. 예전에는 Esc 리스너가 창마다
// window 캡처 단계에 따로 붙어 있어 한 번에 여러 겹이 닫히거나(드로어+템플릿 관리, 설정+작업 로그),
// 확인 창이 떠 있는데 아래 창이 닫혔다.
//
// 항목별 동작(LayerAction):
//   'close'   — 등록한 onClose 를 부른다(기본).
//   'consume' — 아무것도 하지 않고 삼킨다(아래 창으로 넘기지 않음). 진행 창·만료 프로젝트 창의 Esc.
//   'self'    — (Esc 전용) 이 항목이 자기 리스너로 직접 처리한다. 관문은 이벤트를 건드리지 않고 아래로도 넘기지 않는다.
//   'skip'    — 이 항목은 해당 입력의 대상이 아니다. 바로 아래 항목이 받는다.
//   함수      — onClose 대신 이 함수를 부른다(드로어의 단계별 Esc 등).
// preempt=true 인 항목(편집 모드·확인 창 층)은 등록 순서와 무관하게 먼저 받는다(그들끼리는 최근 등록 우선).

export type LayerAction = 'close' | 'consume' | 'self' | 'skip' | (() => void);

export interface LayerOptions {
  /** PC Esc 처리(기본 'close') */
  escape?: LayerAction;
  /** Android 뒤로 가기 처리(기본 'close'. 'self' 는 'consume' 으로 취급) */
  back?: LayerAction;
  /** 위에 다른 창이 있어도 먼저 받는다 */
  preempt?: boolean;
}

export interface LayerEntry {
  id: number;
  onClose: () => void;
  opts: LayerOptions;
}

export type GateKind = 'escape' | 'back';

export type GateDecision =
  | { kind: 'none' } // 받을 항목 없음 — Esc 는 그대로 통과, 뒤로 가기는 앱 최소화
  | { kind: 'self' }
  | { kind: 'consume' }
  | { kind: 'run'; run: () => void };

const actionOf = (entry: LayerEntry, kind: GateKind): LayerAction =>
  (kind === 'escape' ? entry.opts.escape : entry.opts.back) ?? 'close';

/** 이 입력을 받을 맨 위 항목. preempt 항목 먼저, 그다음 일반 항목(각각 최근 등록 우선), 'skip' 은 건너뛴다. */
export function pickLayer(
  stack: readonly LayerEntry[],
  kind: GateKind,
): LayerEntry | undefined {
  for (const preempt of [true, false]) {
    for (let i = stack.length - 1; i >= 0; i--) {
      const e = stack[i];
      if (!!e.opts.preempt !== preempt) continue;
      if (actionOf(e, kind) === 'skip') continue;
      return e;
    }
  }
  return undefined;
}

export function decide(
  stack: readonly LayerEntry[],
  kind: GateKind,
): GateDecision {
  const entry = pickLayer(stack, kind);
  if (!entry) return { kind: 'none' };
  const action = actionOf(entry, kind);
  if (action === 'consume') return { kind: 'consume' };
  if (action === 'self') return kind === 'escape' ? { kind: 'self' } : { kind: 'consume' };
  if (typeof action === 'function') return { kind: 'run', run: action };
  return { kind: 'run', run: entry.onClose };
}

const NON_TEXT_INPUT_TYPES = new Set([
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'range',
  'color',
  'file',
  'image',
]);

/** 글자 입력 요소(input·textarea·select·contenteditable)인가 — 이 경우 Esc 판단을 버블 단계로 미룬다. */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') {
    const type = ((el as HTMLInputElement).type || 'text').toLowerCase();
    return !NON_TEXT_INPUT_TYPES.has(type);
  }
  return !!el.isContentEditable;
}

/** 입력칸(또는 그 조상)이 「Esc 는 내가 취소로 처리한다」고 표시했는가(data-esc-cancel). */
export function hasOwnEscCancel(target: EventTarget | null): boolean {
  const el = target as Element | null;
  if (!el || typeof (el as Element).closest !== 'function') return false;
  const owner = el.closest('[data-esc-cancel]');
  return !!owner && owner.getAttribute('data-esc-cancel') !== 'false';
}

/** 한글 등 IME 조합 중인 키 입력(조합 확정·취소용 Enter·Esc 는 창 동작으로 쓰지 않는다). */
export function isImeComposing(e: { isComposing?: boolean; keyCode?: number }): boolean {
  return !!e.isComposing || e.keyCode === 229;
}
