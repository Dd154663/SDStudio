// 확인 창(ConfirmWindow) Enter 규칙 — 순수 함수(2026-10-03 U1·X1, jest confirmWindowKeys.test.tsx).
//
// - Enter 로 「확인」하는 타입: confirm·yes-only·input-confirm·dropdown(값을 고른 뒤)·checkbox.
// - select(선택지 목록)는 Enter 를 무시한다 — 예전엔 「선택 없음」으로 콜백을 불러 대량 작업 메뉴가 엉뚱한
//   흐름으로 가거나 내보내기 목적지 선택이 취소 처리됐다. 선택지는 직접 눌러야 한다.
// - textarea-confirm 은 Enter 가 줄바꿈이라 확인하지 않는다(버튼으로만).
// - IME 조합 중(한글 조합 확정 Enter)은 건드리지 않는다.
// - 창 안 버튼에 포커스가 있으면(Tab 이동) 그 버튼의 기본 동작(클릭)을 존중한다.
// - 드롭다운 목록이 펼쳐져 있으면 Enter 는 목록 항목 고르기다.
// - confirm 의 위험도(danger, 2026-10-03 D1): 없음·true 는 Enter=확인, 'permanent'(되돌릴 수 없는 영구 삭제·
//   덮어쓰기)만 Enter 를 무시한다 — [확인] 버튼을 직접 눌러야 한다. 위험도와 별개로 requireClick 도 Enter 무시
//   (생성 도중 비동기로 뜨는 과금 확인).
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

/**
 * 확인 창 위험도(2026-10-03 D1).
 * - 없음 = 중립: [확인] 파랑, Enter = 확인(진행·Anlas 소모·붙여넣기·복사 등)
 * - true = 파괴적: [확인] 빨강, Enter = 확인(삭제·휴지통 이동·덮어쓰기·초기화·연결 해제·상속 끊기·병합)
 * - 'permanent' = 되돌릴 수 없는 영구 삭제·덮어쓰기: [확인] 빨강, Enter 무시
 */
export type ConfirmDanger = boolean | 'permanent';

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
  /** 확인 창 위험도 — confirm 이 'permanent' 면 Enter 를 무시한다 */
  danger?: ConfirmDanger;
  /**
   * 버튼 클릭·탭 필수(위험도와 별개) — confirm 의 Enter 를 무시한다. 생성 도중 비동기로 뜨는 과금 확인처럼
   * 다른 칸에서 치던 Enter 가 승인으로 새면 안 되는 창에 쓴다(2026-10-03 D1).
   */
  requireClick?: boolean;
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
      return ctx.danger === 'permanent' || ctx.requireClick ? 'ignore' : 'confirm';
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

// ── 내장 취소 단일화(2026-10-03 D3) ──
// select·checkbox·dropdown 은 ConfirmWindow 가 내장 취소 버튼 하나를 그린다. items 에 「취소」류 항목을 또
// 넣으면 같은 뜻의 버튼이 두 개가 되므로(예전 4곳) 창이 걸러낸다(개발 빌드는 console.warn — 런타임 가드).
// 라벨을 바꾸려면 cancelText(예: 업데이트 알림의 「나중에」)를 쓴다. 신규 유입은 specGuard 가 막는다.
const CANCEL_LIKE_ITEM_TEXT = /^(취소|닫기|아니오|아니요|나중에)$/;

export function isCancelLikeItem(item: { text: string; value: string }): boolean {
  return CANCEL_LIKE_ITEM_TEXT.test(item.text.trim()) || item.value === 'cancel';
}

/** 「취소」류 항목을 뺀 목록. 그런 항목이 없으면 원본 배열을 그대로 돌려준다. */
export function withoutCancelLikeItems<T extends { text: string; value: string }>(
  items: readonly T[] | undefined,
): T[] {
  if (!items) return [];
  return items.some(isCancelLikeItem)
    ? items.filter((it) => !isCancelLikeItem(it))
    : (items as T[]);
}
