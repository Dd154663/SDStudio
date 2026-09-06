import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { configure, observable } from 'mobx';

jest.mock('..', () => ({ isMobile: false }));
jest.mock('../types', () => ({ PromptPiece: { fromJSON: (value: any) => value } }));
jest.mock('../../componenets/SceneEditor', () => ({ SlotEditor: () => <div>full editor</div> }));
jest.mock('../../componenets/FloatView', () => ({ FloatView: ({ children }: any) => children }));
jest.mock('../../componenets/ModalOverlay', () => ({ children, title }: any) => <div>{title}{children}</div>);
jest.mock('../../componenets/PromptEditTextArea', () => (props: any) => <textarea value={props.value} onChange={(e) => props.onChange(e.target.value)} />);
jest.mock('../../componenets/CombinationList', () => ({ columnColor: () => 'transparent', pieceLabel: (_piece: any, col: number, row: number) => `${col + 1}-${row + 1}` }));
import SceneQuickPromptModal from '../../componenets/SceneQuickPromptModal';
import CompactCombinationPieces from '../../componenets/CompactCombinationPieces';

let container: HTMLDivElement;
let root: Root;
let scene: any;
const button = (label: string) => [...container.querySelectorAll('button')].find((b) => b.textContent === label || b.getAttribute('aria-label') === label)!;
beforeEach(() => {
  configure({ enforceActions: 'never' });
  (global as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  scene = observable({ name: 'test', slots: [
    [{ id: 'a', prompt: 'first', enabled: true }, { id: 'b', prompt: 'second', enabled: false }],
    [{ id: 'c', prompt: 'third', enabled: true }],
  ] });
});
afterEach(() => { act(() => root.unmount()); container.remove(); jest.useRealTimers(); });

test.each([false, true])('quick editor switches pieces without changing enabled flags (popover=%s)', async (popover) => {
  await act(async () => root.render(<SceneQuickPromptModal scene={scene} onClose={() => {}} anchor={popover ? { left: 10, top: 10, width: 200, height: 100 } as DOMRect : undefined} />));
  expect(container.querySelector('textarea')!.value).toBe('first');
  act(() => Simulate.change(container.querySelector('textarea')!, { target: { value: 'first edited' } } as any));
  act(() => button('조합 펼치기').click());
  expect(container.querySelector('textarea')).toBeNull();
  act(() => button('1-2').click());
  expect(container.querySelector('textarea')!.value).toBe('second');
  act(() => Simulate.change(container.querySelector('textarea')!, { target: { value: 'second edited' } } as any));
  act(() => button('조합 펼치기').click());
  act(() => button('2-1').click());
  expect(container.querySelector('textarea')!.value).toBe('third');
  act(() => button('조합 펼치기').click());
  act(() => button('1-1').click());
  expect(container.querySelector('textarea')!.value).toBe('first edited');
  expect(scene.slots[0][1].prompt).toBe('second edited');
  expect(scene.slots[0][1].enabled).toBe(false);
});

test('empty first column initializes without destroying later columns', async () => {
  scene.slots[0] = [];
  const retained = scene.slots[1][0];
  await act(async () => root.render(<SceneQuickPromptModal scene={scene} onClose={() => {}} />));
  expect(scene.slots[0]).toHaveLength(1);
  expect(scene.slots[1][0]).toBe(retained);
  act(() => button('조합 펼치기').click());
  act(() => button('2-1').click());
  expect(container.querySelector('textarea')!.value).toBe('third');
});

test('shared compact list preserves selection callbacks and prompt hover preview', async () => {
  jest.useFakeTimers();
  const select = jest.fn();
  await act(async () => root.render(<CompactCombinationPieces scene={scene} selected={new Set(['0:0'])} onSelect={select} />));
  expect(button('1-1').getAttribute('aria-pressed')).toBe('true');
  expect(button('1-2').getAttribute('aria-pressed')).toBe('false');
  act(() => button('1-2').click());
  expect(select).toHaveBeenCalledWith('0:1', scene.slots[0][1]);
  act(() => Simulate.mouseEnter(button('1-2').parentElement!));
  act(() => jest.advanceTimersByTime(300));
  expect(document.body.textContent).toContain('second');
});
