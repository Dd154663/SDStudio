import { act, fireEvent, render } from '@testing-library/react';
import MobileKeyboardChip, {
  caretChipAllowed,
  chipKeyboardUp,
  resetChipKeyboardTrack,
} from '../../componenets/MobileKeyboardChip';
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

// 화면 높이(키보드가 뜨면 줄어드는 기기를 흉내) — 커서만 있는 칩은 키보드가 올라와 있을 때만 뜬다(2026-11-25).
function setScreenHeight(h: number) {
  Object.defineProperty(window, 'innerHeight', { value: h, configurable: true, writable: true });
}
/** 키보드가 올라온 상태로 만든다(가장 큰 높이 800 을 본 뒤 500 으로 줄어듦) */
function keyboardUp() {
  setScreenHeight(800);
  chipKeyboardUp();
  setScreenHeight(500);
}
/** 키보드가 내려간 상태 */
function keyboardDown() {
  setScreenHeight(800);
}

beforeEach(() => {
  weight = { inner: 'cat', weight: 1 };
  resetChipKeyboardTrack();
  keyboardUp();
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

describe('모바일 키보드 위 칩 — 커서만 있는 칩은 키보드가 올라와 있을 때만(2026-11-25)', () => {
  test('판정: 키보드가 올라와 있거나 「크게 편집」 창 안', () => {
    expect(caretChipAllowed(true, false)).toBe(true);
    expect(caretChipAllowed(false, true)).toBe(true);
    expect(caretChipAllowed(false, false)).toBe(false);
  });

  test('키보드 판정: 가장 큰 높이보다 120 넘게 줄면 올라온 것, 폭이 바뀌면 기준을 다시 잡는다', () => {
    resetChipKeyboardTrack();
    setScreenHeight(800);
    expect(chipKeyboardUp()).toBe(false);
    setScreenHeight(700);
    expect(chipKeyboardUp()).toBe(false);
    setScreenHeight(500);
    expect(chipKeyboardUp()).toBe(true);
    setScreenHeight(800);
    expect(chipKeyboardUp()).toBe(false);
    // 회전(폭 변화) — 낮아진 높이가 새 기준이 된다
    const width = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: width + 300, configurable: true, writable: true });
    setScreenHeight(400);
    expect(chipKeyboardUp()).toBe(false);
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true });
  });

  test('포커스는 남았지만 키보드가 내려가면 조정 칩이 사라지고, 다시 올라오면 돌아온다', async () => {
    makeEditor('cat, dog');
    render(<MobileKeyboardChip onSearch={() => {}} />);
    await focusEditor(1);
    expect(chip()!.getAttribute('data-kbd-chip')).toBe('adjust');
    // 뒤로 가기로 키보드만 내려감(포커스·커서는 그대로) — 화면 높이가 돌아오며 resize
    await act(async () => {
      keyboardDown();
      window.dispatchEvent(new Event('resize'));
    });
    expect(document.activeElement).toBe(ta);
    expect(chip()).toBeNull();
    // 다시 칸을 눌러 키보드가 올라옴
    await act(async () => {
      setScreenHeight(500);
      window.dispatchEvent(new Event('resize'));
    });
    expect(chip()!.getAttribute('data-kbd-chip')).toBe('adjust');
  });

  test('「크게 편집」 창(.prompt-full) 안의 칸은 키보드가 내려가 있어도 칩이 보인다', async () => {
    makeEditor('cat, dog');
    ta.parentElement!.classList.add('prompt-full');
    render(<MobileKeyboardChip onSearch={() => {}} />);
    await act(async () => {
      keyboardDown();
    });
    await focusEditor(1);
    expect(chip()!.getAttribute('data-kbd-chip')).toBe('adjust');
  });

  test('범위를 골랐을 때의 검색 칩은 키보드와 무관하다', async () => {
    makeEditor('cat, dog');
    render(<MobileKeyboardChip onSearch={() => {}} />);
    await act(async () => {
      keyboardDown();
      ta.focus();
      ta.setSelectionRange(0, 3);
      document.dispatchEvent(new Event('selectionchange'));
    });
    expect(chip()!.getAttribute('data-kbd-chip')).toBe('search');
  });
});
