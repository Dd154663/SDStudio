import {
  clearFocusedPromptEditor,
  getFocusedPromptEditor,
  setFocusedPromptEditor,
  type FocusedPromptEditor,
} from '../promptEditorFocus';

const handle = (): FocusedPromptEditor => ({
  element: {} as HTMLElement,
  adjustWeight: () => {},
  getCaretWeight: () => undefined,
});

describe('포커스된 프롬프트 편집기 등록소', () => {
  it('등록·조회·같은 핸들만 해제', () => {
    const a = handle();
    const b = handle();
    setFocusedPromptEditor(a);
    expect(getFocusedPromptEditor()).toBe(a);
    setFocusedPromptEditor(b);
    clearFocusedPromptEditor(a); // 늦게 온 a 의 blur 가 b 를 지우지 않는다
    expect(getFocusedPromptEditor()).toBe(b);
    clearFocusedPromptEditor(b);
    expect(getFocusedPromptEditor()).toBeNull();
  });
});
