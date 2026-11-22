import fs from 'fs';
import path from 'path';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import PromptEditTextArea from '../../componenets/PromptEditTextArea';
import { backStackService } from '../BackStackService';

jest.mock('../index', () => ({
  isMobile: false,
  backend: {},
  artistLibraryService: {},
}));
jest.mock('../AppService', () => ({ appState: {} }));
jest.mock('../sceneFieldUndo', () => ({
  holdSceneFieldEdit: jest.fn(() => () => {}),
}));
jest.mock('../promptWeightSpacingFlow', () => ({
  offerWeightSpacing: jest.fn(() => Promise.resolve()),
}));

beforeEach(() => {
  const createRange = document.createRange.bind(document);
  jest
    .spyOn(document, 'createRange')
    .mockImplementation(() =>
      Object.assign(createRange(), {
        getBoundingClientRect: () => ({ bottom: 0 }),
      }),
    );
});

afterEach(() => {
  window.getSelection()!.removeAllRanges();
  jest.restoreAllMocks();
  delete (globalThis as any).Highlight;
  delete (globalThis as any).CSS;
});

const bar = () => document.querySelector('[data-prompt-find-bar]');
const query = () =>
  document.querySelector('[data-prompt-find-query]') as HTMLInputElement;
const count = () =>
  document.querySelector('[data-prompt-find-count]')!.textContent;

function setup(props: { value?: string; disabled?: boolean } = {}) {
  const onChange = jest.fn();
  const utils = render(
    <PromptEditTextArea
      value={props.value ?? 'cat, dog, cat'}
      disabled={props.disabled}
      onChange={onChange}
    />,
  );
  const editor = utils.container.querySelector('[contenteditable]') as HTMLElement;
  const toggle = utils.container.querySelector(
    '[data-prompt-find-toggle]',
  ) as HTMLButtonElement;
  return { ...utils, onChange, editor, toggle };
}

function select(node: Node, start: number, end: number) {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const s = window.getSelection()!;
  s.removeAllRanges();
  s.addRange(range);
}

function open(toggle: HTMLButtonElement) {
  fireEvent.mouseDown(toggle);
  fireEvent.click(toggle);
}

describe('이 칸에서 찾기·바꾸기(PC 검색 줄)', () => {
  test('돋보기는 「크게 편집」 바로 아래(세로 쌓기), 누르면 검색 줄이 열리고 검색 입력에 포커스', () => {
    const { toggle, container } = setup();
    const expand = container.querySelector('[aria-label="크게 편집"]')!;
    expect(toggle.getAttribute('aria-label')).toBe('이 칸에서 찾기');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    // 같은 아이콘 줄 안에서 돋보기가 크게 편집 다음(세로 쌓기 = 아래, 2026-11-22)
    const row = expand.closest('div')!;
    const buttons = Array.from(row.querySelectorAll('button'));
    expect(buttons.indexOf(toggle)).toBe(buttons.indexOf(expand as HTMLButtonElement) + 1);
    expect(bar()).toBeNull();
    open(toggle);
    expect(bar()).not.toBeNull();
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(query());
    expect(document.querySelector('[data-prompt-find-replace-row]')).not.toBeNull();
    // 다시 누르면 닫힘
    open(toggle);
    expect(bar()).toBeNull();
  });

  test('고른 글자(한 줄)를 찾는 말로 넣고 「현재 / 전체」를 센다', () => {
    const { toggle, editor } = setup();
    const textNode = editor.querySelector('.syntax-line')!.firstChild!;
    select(textNode, 5, 8); // dog
    open(toggle);
    expect(query().value).toBe('dog');
    expect(count()).toBe('1 / 1');
    fireEvent.change(query(), { target: { value: 'CAT' } });
    // 커서(고른 범위 시작 5) 뒤 첫 일치 = 두 번째 cat
    expect(count()).toBe('2 / 2');
    fireEvent.keyDown(query(), { key: 'Enter' });
    expect(count()).toBe('1 / 2');
    fireEvent.keyDown(query(), { key: 'Enter', shiftKey: true });
    expect(count()).toBe('2 / 2');
    fireEvent.click(document.querySelector('[data-prompt-find-case]')!);
    expect(count()).toBe('없음');
    fireEvent.change(query(), { target: { value: '' } });
    expect(count()).toBe('');
  });

  test('읽기 전용 칸은 찾기만(바꾸기 줄 없음)', () => {
    const { toggle } = setup({ disabled: true });
    open(toggle);
    expect(bar()).not.toBeNull();
    expect(document.querySelector('[data-prompt-find-replace-row]')).toBeNull();
    fireEvent.change(query(), { target: { value: 'cat' } });
    expect(count()).toBe('1 / 2');
  });

  test('Esc 는 검색 줄만 닫는다(닫기 관문 맨 위 층) — 바깥 창은 그대로', () => {
    const outer = jest.fn();
    const handle = backStackService.push(outer);
    try {
      const { toggle } = setup();
      open(toggle);
      fireEvent.keyDown(query(), { key: 'Escape' });
      expect(bar()).toBeNull();
      expect(outer).not.toHaveBeenCalled();
    } finally {
      handle.remove();
    }
  });

  test('검색 줄과 그 칸 밖을 누르면 닫힌다(안쪽 누름은 유지)', () => {
    const { toggle, editor } = setup();
    open(toggle);
    fireEvent.pointerDown(query());
    fireEvent.pointerDown(editor);
    expect(bar()).not.toBeNull();
    fireEvent.pointerDown(document.body);
    expect(bar()).toBeNull();
  });

  test('모두 바꾸기 = 편집기 기록 1항목(되돌리기 한 번에 원래대로), 포커스는 검색 줄에', async () => {
    const { toggle, editor, onChange } = setup();
    open(toggle);
    fireEvent.change(query(), { target: { value: 'cat' } });
    const rep = document.querySelector(
      '[data-prompt-find-replacement]',
    ) as HTMLInputElement;
    fireEvent.change(rep, { target: { value: 'fox' } });
    const all = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent === '모두 바꾸기',
    )!;
    await act(async () => {
      fireEvent.click(all);
    });
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('fox, dog, fox'));
    expect(editor.textContent).toBe('fox, dog, fox');
    expect(document.activeElement).not.toBe(editor);
    await waitFor(() => expect(count()).toBe('없음'));
    // 편집기 되돌리기 — 한 번에 바꾸기 전으로, 그다음 되돌리기는 없음
    select(editor.querySelector('.syntax-line')!.firstChild!, 0, 0);
    onChange.mockClear();
    await act(async () => {
      fireEvent.keyDown(editor, { key: 'z', ctrlKey: true });
    });
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('cat, dog, cat'));
    onChange.mockClear();
    select(editor.querySelector('.syntax-line')!.firstChild!, 0, 0);
    await act(async () => {
      fireEvent.keyDown(editor, { key: 'z', ctrlKey: true });
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  test('바꾸기 = 현재 자리 하나를 바꾸고 다음으로, 바꾼 글자는 다시 훑지 않음', async () => {
    const { toggle, onChange } = setup({ value: 'a, a' });
    open(toggle);
    fireEvent.change(query(), { target: { value: 'a' } });
    const rep = document.querySelector(
      '[data-prompt-find-replacement]',
    ) as HTMLInputElement;
    fireEvent.change(rep, { target: { value: 'aa' } });
    await act(async () => {
      fireEvent.keyDown(rep, { key: 'Enter' });
    });
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('aa, a'));
    await waitFor(() => expect(count()).toBe('3 / 3'));
  });

  test('CSS.highlights 가 있으면 칠하고 닫으면 지운다', () => {
    const reg = new Map<string, any>();
    (globalThis as any).CSS = { highlights: reg };
    (globalThis as any).Highlight = class {
      ranges: Range[];
      constructor(...ranges: Range[]) {
        this.ranges = ranges;
      }
    };
    const { toggle } = setup();
    open(toggle);
    fireEvent.change(query(), { target: { value: 'cat' } });
    expect(reg.get('sdstudio-find-current')?.ranges).toHaveLength(1);
    expect(reg.get('sdstudio-find-match')?.ranges).toHaveLength(1);
    fireEvent.click(document.querySelector('[aria-label="찾기 닫기"]')!);
    expect(bar()).toBeNull();
    expect(reg.size).toBe(0);
  });

  test('편집기에 찾기 단축키(Ctrl+F·Ctrl+H) 분기가 없다(사용자 결정)', () => {
    for (const f of ['PromptEditTextArea.tsx', 'PromptFindBar.tsx', 'MobileKeyboardChip.tsx']) {
      const src = fs.readFileSync(
        path.join(__dirname, '../../componenets', f),
        'utf8',
      );
      expect(src).not.toMatch(/key\s*===\s*['"][fFhH]['"]/);
      expect(src).not.toMatch(/Key[FH]['"]/);
    }
  });
});
