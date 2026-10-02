// 확인 창(ConfirmWindow) Enter 규칙 — 순수 함수(2026-10-03 U1·X1, jest confirmKeys.test.ts).
//
// - Enter 로 「확인」하는 타입: confirm·yes-only·input-confirm·dropdown(값을 고른 뒤)·checkbox.
// - select(선택지 목록)는 Enter 를 무시한다 — 예전엔 「선택 없음」으로 콜백을 불러 대량 작업 메뉴가 엉뚱한
//   흐름으로 가거나 내보내기 목적지 선택이 취소 처리됐다. 선택지는 직접 눌러야 한다.
// - textarea-confirm 은 Enter 가 줄바꿈이라 확인하지 않는다(버튼으로만).
// - IME 조합 중(한글 조합 확정 Enter)은 건드리지 않는다.
// - 창 안 버튼에 포커스가 있으면(Tab 이동) 그 버튼의 기본 동작(클릭)을 존중한다.
// - 드롭다운 목록이 펼쳐져 있으면 Enter 는 목록 항목 고르기다.
// 'ignore' = 아무 동작 없이 삼킨다(아래 화면으로 Enter 가 새지 않게), 'pass' = 건드리지 않는다.

export type ConfirmDialogType =
  | 'confirm'
  | 'yes-only'
  | 'input-confirm'
  | 'textarea-confirm'
  | 'select'
  | 'dropdown'
  | 'checkbox';

export type ConfirmEnterAction = 'confirm' | 'ignore' | 'pass';

export interface ConfirmEnterContext {
  composing?: boolean;
  /** 대상이 확인 창 안의 textarea */
  inTextarea?: boolean;
  /** 대상이 확인 창 안의 버튼 */
  onDialogButton?: boolean;
  /** 드롭다운 목록이 펼쳐져 있음 */
  dropdownMenuOpen?: boolean;
  /** 드롭다운에서 값을 골랐음 */
  dropdownChosen?: boolean;
}

export function confirmEnterAction(
  type: ConfirmDialogType,
  ctx: ConfirmEnterContext = {},
): ConfirmEnterAction {
  if (ctx.composing) return 'pass';
  if (ctx.inTextarea) return 'pass';
  if (ctx.onDialogButton) return 'pass';
  switch (type) {
    case 'confirm':
    case 'yes-only':
    case 'input-confirm':
    case 'checkbox':
      return 'confirm';
    case 'dropdown':
      if (ctx.dropdownMenuOpen) return 'pass';
      return ctx.dropdownChosen ? 'confirm' : 'ignore';
    case 'select':
    case 'textarea-confirm':
    default:
      return 'ignore';
  }
}

/**
 * 확인 창을 띄워 [확인]=true / [취소]·Esc·뒤로 가기=false 로 돌려준다 — appState.confirmAsync 의 본체
 * (2026-10-03 U1·X14). push 는 대화상자를 쌓는 함수(appState.pushDialog).
 */
export function confirmViaDialog<
  D extends { type: string; callback?: (...a: any[]) => any; onCancel?: () => void },
>(
  push: (dialog: D) => void,
  opts: Omit<D, 'type' | 'callback' | 'onCancel'> & { type?: 'confirm' | 'yes-only' },
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    push({
      ...(opts as any),
      type: opts.type ?? 'confirm',
      callback: () => resolve(true),
      onCancel: () => resolve(false),
    } as D);
  });
}
