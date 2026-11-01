// 이미지 상세 보기 raw keydown 가드 — 2026-11-01 U0-b E7
import {
  isTextEntryElement,
  isTextEntryFocused,
  shouldIgnoreViewerRawKey,
} from '../keyTargetGuard';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('isTextEntryElement / isTextEntryFocused', () => {
  test('input·textarea·contentEditable·webview 는 입력 대상, 버튼·없음은 아님', () => {
    const div = document.createElement('div');
    div.contentEditable = 'true';
    // jsdom 은 isContentEditable 을 계산하지 않는다 — 브라우저 값 흉내
    Object.defineProperty(div, 'isContentEditable', { value: true });
    expect(isTextEntryElement(document.createElement('input'))).toBe(true);
    expect(isTextEntryElement(document.createElement('textarea'))).toBe(true);
    expect(isTextEntryElement(div)).toBe(true);
    expect(isTextEntryElement(document.createElement('webview'))).toBe(true);
    expect(isTextEntryElement(document.createElement('button'))).toBe(false);
    expect(isTextEntryElement(null)).toBe(false);
  });

  test('이름 입력 칸에 포커스가 있으면 입력 중으로 본다', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    expect(isTextEntryFocused()).toBe(false);
    input.focus();
    expect(isTextEntryFocused()).toBe(true);
  });
});

describe('shouldIgnoreViewerRawKey', () => {
  test('입력 포커스 중에는 Delete·Backspace·←/→ 전부 무시', () => {
    const ctx = { inputFocused: true, dialogOpen: false };
    for (const key of ['Delete', 'Backspace', 'ArrowLeft', 'ArrowRight']) {
      expect(shouldIgnoreViewerRawKey(key, ctx)).toBe(true);
    }
  });

  test('확인 창이 열려 있으면 Delete·Backspace 만 무시, 평소엔 통과', () => {
    const open = { inputFocused: false, dialogOpen: true };
    expect(shouldIgnoreViewerRawKey('Delete', open)).toBe(true);
    expect(shouldIgnoreViewerRawKey('Backspace', open)).toBe(true);
    expect(shouldIgnoreViewerRawKey('ArrowLeft', open)).toBe(false);
    const idle = { inputFocused: false, dialogOpen: false };
    expect(shouldIgnoreViewerRawKey('Delete', idle)).toBe(false);
    expect(shouldIgnoreViewerRawKey('ArrowRight', idle)).toBe(false);
  });
});
