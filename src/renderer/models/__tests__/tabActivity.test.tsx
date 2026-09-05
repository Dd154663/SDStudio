import React, { act, useEffect, useState } from 'react';
import { createRoot, Root } from 'react-dom/client';

jest.mock('..', () => ({ isMobile: false }));
jest.mock('../../componenets/FloatView', () => ({ FloatView: ({ children }: any) => children }));
import { TabComponent } from '../../componenets/UtilComponents';

let container: HTMLDivElement;
let root: Root;
let mounts: number;
function StatefulTab({ active, name }: { active: boolean; name: string }) {
  const [value, setValue] = useState(0);
  useEffect(() => { mounts++; }, []);
  return <button data-tab={name} data-active={active} onClick={() => setValue(value + 1)}>{value}</button>;
}
const tabs = ['one', 'two'].map((name) => ({
  label: name, emoji: name,
  content: (active: boolean) => <StatefulTab name={name} active={active} />,
}));
beforeEach(() => {
  (global as any).IS_REACT_ACT_ENVIRONMENT = true;
  mounts = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
const tab = (name: string) => container.querySelector<HTMLButtonElement>(`[data-tab="${name}"]`)!;

test('click and shortcut changes preserve mounted state and report actual activity', async () => {
  await act(async () => root.render(<TabComponent tabs={tabs} />));
  act(() => tab('one').click());
  const original = tab('one');
  const header = [...container.querySelectorAll('button')].find((b) => b.textContent === 'two')!;
  act(() => header.click());
  expect(tab('one').dataset.active).toBe('false');
  expect(tab('two').dataset.active).toBe('true');
  act(() => window.dispatchEvent(new CustomEvent('shortcut-action', { detail: { action: 'tab-1' } })));
  expect(tab('one')).toBe(original);
  expect(tab('one').textContent).toBe('1');
  expect(tab('one').dataset.active).toBe('true');
  expect(mounts).toBe(2);
});

test('default tab changes and project remounts agree with activity; static contents still render', async () => {
  await act(async () => root.render(<TabComponent key="project-a" tabs={tabs} />));
  act(() => tab('one').click());
  await act(async () => root.render(<TabComponent key="project-a" tabs={tabs} defaultActiveTab={1} />));
  expect(tab('two').dataset.active).toBe('true');
  expect(tab('one').textContent).toBe('1');
  expect(mounts).toBe(2);
  await act(async () => root.render(<TabComponent key="project-b" tabs={[...tabs, { label: 'static', emoji: '', content: <span>legacy content</span> }]} />));
  expect(tab('one').dataset.active).toBe('true');
  expect(tab('one').textContent).toBe('0');
  expect(mounts).toBe(4);
  expect(container.textContent).toContain('legacy content');
});
