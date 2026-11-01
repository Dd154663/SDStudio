// 날(raw) keydown 리스너의 입력 대상 판정 — 순수 함수(2026-11-01 U0-b E7, jest keyTargetGuard.test.ts).
//
// KeyboardShortcutService 는 입력 칸 포커스·열린 확인 창에서 단축키를 억제하지만, 그 억제로 통과된 키는
// 화면별 raw keydown 리스너(이미지 상세 보기의 ←/→/Delete/Backspace 등)에 그대로 닿는다. 예전 상세 보기는
// 이를 검사하지 않아 이름 입력 중 Delete 로 이미지가 삭제됐고(「다시 묻지 않음」이면 확인 없이 즉시),
// 확인 창이 떠 있어도 삭제 확인 창이 하나 더 쌓였다. 모바일은 단축키 서비스가 null 이라 이 모듈을 직접 쓴다.

/** 글자 입력 대상(input·textarea·contentEditable·webview)인가 — KeyboardShortcutService 억제 기준과 같다 */
export function isTextEntryElement(el: Element | null | undefined): boolean {
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  // webview 내부 포커스도 입력 중으로 본다
  if (tag === 'webview') return true;
  return false;
}

/** 지금 포커스가 글자 입력 대상에 있는가 */
export function isTextEntryFocused(): boolean {
  if (typeof document === 'undefined') return false;
  return isTextEntryElement(document.activeElement);
}

export interface ViewerRawKeyContext {
  /** 포커스가 글자 입력 대상에 있음(isTextEntryFocused) */
  inputFocused: boolean;
  /** 확인 창이 하나 이상 열려 있음(appState.dialogs.length > 0) */
  dialogOpen: boolean;
}

/**
 * 이미지 상세 보기 raw keydown 을 무시할지.
 * - 입력 포커스 중에는 이동(←/→)·삭제 키 전부 무시 — 글자 편집 키를 가로채지 않는다.
 * - Delete/Backspace 는 확인 창이 열려 있어도 무시 — 확인 창 위에서 삭제가 일어나거나 겹쳐 뜨지 않게.
 */
export function shouldIgnoreViewerRawKey(key: string, ctx: ViewerRawKeyContext): boolean {
  if (ctx.inputFocused) return true;
  if ((key === 'Delete' || key === 'Backspace') && ctx.dialogOpen) return true;
  return false;
}
