import { act, fireEvent, render } from '@testing-library/react';
import MobileKeyboardChip from '../../componenets/MobileKeyboardChip';
import {
  disposeFocusedPromptEditor,
  getFocusedPromptEditor,
  setFocusedPromptEditor,
  clearFocusedPromptEditor,
  type FocusedPromptEditor,
} from '../promptEditorFocus';
import type { PromptFindTarget } from '../promptFind';

jest.mock('../index', () => ({ isMobile: false }));
jest.mock('../util', () => ({
  buildDanbooruSearchUrl: (t: string) => (t ? 'https://example.invalid/' + t : ''),
}));

let ta: HTMLTextAreaElement;
let layer: HTMLDivElement;
let handle: FocusedPromptEditor;
let weight: { inner: string; weight: number } | undefined;

function makeEditor(value: string) {
  ta = document.createElement('textarea');
  ta.value = value;
  layer = document.createElement('div');
  layer.textContent = value;
  const scroll = document.createElement('div');
  scroll.appendChild(layer);
  scroll.appendChild(ta);
  document.body.appendChild(scroll);
  const find: PromptFindTarget = {
    getText: () => ta.value,
    getSelection: () => [ta.selectionStart ?? 0, ta.selectionEnd ?? 0],
    isReadOnly: () => false,
    applyFindEdit: (compute) => {
      const r = compute(ta.value);
      if (!r) return null;
      ta.value = r.text;
      layer.textContent = r.text;
      return r.text;
    },
    getHighlightRoot: () => layer,
    getScrollContainer: () => scroll,
    focusAt: (s, e) => {
      ta.focus();
      ta.setSelectionRange(s, e);
    },
  };
  handle = {
    element: ta,
    adjustWeight: () => {},
    getCaretWeight: () => weight as any,
    toggleComment: () => {},
    isCaretInComment: () => false,
    find,
  };
  ta.addEventListener('focus', () => setFocusedPromptEditor(handle));
  ta.addEventListener('blur', () => clearFocusedPromptEditor(handle));
}

async function focusEditor(caret: number) {
  await act(async () => {
    ta.focus();
    ta.setSelectionRange(caret, caret);
    document.dispatchEvent(new Event('selectionchange'));
  });
}

const chip = () => document.querySelector('[data-kbd-chip]');

beforeEach(() => {
  weight = { inner: 'cat', weight: 1 };
});
afterEach(() => {
  if (handle) disposeFocusedPromptEditor(handle);
  document.body.innerHTML = '';
});

describe('모바일 키보드 위 칩 — 이 칸에서 찾기', () => {
  test('조정 칩 끝에 돋보기, 누르면 찾기 모드(입력 칸 포커스에도 칩 유지), 돌아가기로 조정 줄', async () => {
    makeEditor('cat, dog, cat');
    render(<MobileKeyboardChip onSearch={() => {}} />);
    await focusEditor(1);
    expect(chip()!.getAttribute('data-kbd-chip')).toBe('adjust');
    const mag = chip()!.querySelector('[data-kbd-chip-find]') as HTMLButtonElement;
    expect(mag).not.toBeNull();
    // 돋보기는 # 뒤(마지막 버튼)
    const btns = Array.from(chip()!.querySelectorAll('button'));
    expect(btns[btns.length - 1]).toBe(mag);
    fireEvent.click(mag);
    expect(chip()!.getAttribute('data-kbd-chip')).toBe('find');
    const q = document.querySelector('[data-kbd-chip-find-query]') as HTMLInputElement;
    expect(document.activeElement).toBe(q);
    // 포커스가 칩 입력 칸으로 가도(focusin·selectionchange) 칩과 대상 편집기가 남는다
    await act(async () => {
      document.dispatchEvent(new Event('focusin'));
      document.dispatchEvent(new Event('selectionchange'));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(chip()!.getAttribute('data-kbd-chip')).toBe('find');
    expect(getFocusedPromptEditor()).toBe(handle);
    fireEvent.change(q, { target: { value: 'cat' } });
    expect(document.querySelector('[data-kbd-chip-find-count]')!.textContent).toBe('2 / 2');
    expect(document.querySelector('[data-kbd-chip-find-replace-row]')).not.toBeNull();
    // 모두 바꾸기
    const rep = document.querySelector('[data-kbd-chip-find-replacement]') as HTMLInputElement;
    fireEvent.change(rep, { target: { value: 'fox' } });
    await act(async () => {
      fireEvent.click(document.querySelector('[aria-label="모두 바꾸기"]')!);
    });
    expect(ta.value).toBe('fox, dog, fox');
    // 돌아가기(켜진 돋보기) → 조정 줄, 포커스는 편집기
    const back = document.querySelector('[data-kbd-chip="find"] [data-kbd-chip-find]') as HTMLButtonElement;
    expect(back.getAttribute('aria-pressed')).toBe('true');
    await act(async () => {
      fireEvent.click(back);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(document.activeElement).toBe(ta);
    expect(chip()!.getAttribute('data-kbd-chip')).toBe('adjust');
  });

  test('빈 구획이면 돋보기만 있는 작은 칩(칸에 글자가 있을 때), 빈 칸이면 칩 없음', async () => {
    weight = undefined;
    makeEditor('cat, , dog');
    render(<MobileKeyboardChip onSearch={() => {}} />);
    await focusEditor(5);
    expect(chip()!.getAttribute('data-kbd-chip')).toBe('find-entry');
    expect(chip()!.querySelectorAll('button')).toHaveLength(1);
    fireEvent.click(chip()!.querySelector('[data-kbd-chip-find]')!);
    expect(chip()!.getAttribute('data-kbd-chip')).toBe('find');
  });

  test('빈 칸은 칩 없음', async () => {
    weight = undefined;
    makeEditor('');
    render(<MobileKeyboardChip onSearch={() => {}} />);
    await focusEditor(0);
    expect(chip()).toBeNull();
  });

  test('글자를 끌어 고른 상태(Danbooru 검색 칩)에는 돋보기가 없다', async () => {
    makeEditor('cat, dog');
    render(<MobileKeyboardChip onSearch={() => {}} />);
    await act(async () => {
      ta.focus();
      ta.setSelectionRange(0, 3);
      document.dispatchEvent(new Event('selectionchange'));
    });
    expect(chip()!.getAttribute('data-kbd-chip')).toBe('search');
    expect(chip()!.querySelector('[data-kbd-chip-find]')).toBeNull();
  });

  test('칩과 편집기 밖을 누르거나 편집기가 사라지면 찾기 모드가 닫힌다', async () => {
    makeEditor('cat, dog');
    render(<MobileKeyboardChip onSearch={() => {}} />);
    await focusEditor(1);
    fireEvent.click(chip()!.querySelector('[data-kbd-chip-find]')!);
    expect(chip()!.getAttribute('data-kbd-chip')).toBe('find');
    fireEvent.pointerDown(ta);
    expect(chip()!.getAttribute('data-kbd-chip')).toBe('find');
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    await act(async () => {
      fireEvent.pointerDown(outside);
    });
    expect(document.querySelector('[data-kbd-chip="find"]')).toBeNull();
    // 다시 열고 편집기 언마운트
    await focusEditor(1);
    fireEvent.click(chip()!.querySelector('[data-kbd-chip-find]')!);
    expect(chip()!.getAttribute('data-kbd-chip')).toBe('find');
    await act(async () => {
      disposeFocusedPromptEditor(handle);
    });
    expect(document.querySelector('[data-kbd-chip="find"]')).toBeNull();
  });
});
