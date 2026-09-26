import type { PromptWeightInfo } from './promptTransforms';

/**
 * 포커스된 프롬프트 편집기 등록소(2026-09-26, 모바일 가중치 퀵 조정 칩).
 * 키보드 위 칩(MobileKeyboardChip)은 편집기 트리 밖(App)에 있어 ref 를 직접 잡을 수 없다.
 * 편집기(NativeEditTextArea)가 포커스를 얻을 때 자기 조작 핸들을 올리고 잃을 때 내린다.
 * 의존성 없음 — 어디서든 import 가능.
 */
export interface FocusedPromptEditor {
  /** 편집 중인 실제 입력 요소. 칩은 document.activeElement 와 같을 때만 이 핸들을 쓴다. */
  element: HTMLElement;
  /** 커서 구획의 가중치를 delta 만큼 조절(promptTransforms.adjustPromptWeightAtSelection 과 같은 규칙). */
  adjustWeight(delta: number): void;
  /** 커서 구획의 현재 가중치. 빈 구획이면 undefined. */
  getCaretWeight(): PromptWeightInfo | undefined;
}

let focused: FocusedPromptEditor | null = null;

export function setFocusedPromptEditor(editor: FocusedPromptEditor): void {
  focused = editor;
}

/** 같은 핸들일 때만 내린다(다른 편집기가 먼저 포커스를 가져간 경우를 덮어쓰지 않게). */
export function clearFocusedPromptEditor(editor: FocusedPromptEditor): void {
  if (focused === editor) focused = null;
}

export function getFocusedPromptEditor(): FocusedPromptEditor | null {
  return focused;
}
