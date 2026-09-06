import React, { act, StrictMode } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
const state: any = { directExportRequest: undefined };
let mobile = false;
jest.mock('..', () => ({ get isMobile() { return mobile; }, backend: { selectDir: async () => '/chosen' } }));
jest.mock('../AppService', () => ({ appState: state }));
jest.mock('../platform', () => ({ buildImageOptimizeOptions: () => [{ text: '원본', value: 'original' }, { text: 'WebP', value: 'lossy' }, ...(!mobile ? [{ text: '무손실', value: 'lossless' }] : []), { text: 'AVIF', value: 'avif' }] }));
jest.mock('../../componenets/ModalOverlay', () => ({ children }: any) => <div>{children}</div>);
jest.mock('../../componenets/UtilComponents', () => ({ DropdownSelect: ({ selectedOption, options, onSelect }: any) => <select value={selectedOption} onChange={(e) => onSelect({ value: e.target.value })}>{options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> }));
import DirectExportDialog from '../../componenets/DirectExportDialog';
import ExportPresetManager from '../../componenets/ExportPresetManager';
import { emptyExportForm, exportFormToPreset } from '../exportSettings';

let root: Root;
let container: HTMLDivElement;
let resolve: jest.Mock;
beforeEach(() => {
  (global as any).IS_REACT_ACT_ENVIRONMENT = true;
  mobile = false;
  resolve = jest.fn();
  state.directExportRequest = { projectName: 'project', sceneNames: ['a b'], resolve };
  Object.assign(state, { exportPresetManagerOpen: true, loadExportPresets: () => [], saveExportPresets: jest.fn(), pushMessage: jest.fn() });
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const click = (text: string) => (Array.from(container.querySelectorAll('button')).find((button) => button.textContent === text) as HTMLButtonElement).click();

test('strict mode does not cancel on mount; direct submit uses common defaults without saving', async () => {
  await act(async () => root.render(<StrictMode><DirectExportDialog /></StrictMode>));
  expect(resolve).not.toHaveBeenCalled();
  act(() => click('내보내기'));
  expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ preset: expect.objectContaining({ menu: 'fav', opt: 'original', separator: '.', reoptimize: 'skip' }), charsToReplace: [] }));
});
test('format conditions and blank quality expose the AVIF default', async () => {
  await act(async () => root.render(<DirectExportDialog />));
  const optSelect = Array.from(container.querySelectorAll('select')).find((select) => select.querySelector('option[value="avif"]'))!;
  act(() => Simulate.change(optSelect, { target: { value: 'avif' } } as any));
  const quality = container.querySelector('input[placeholder="50"]') as HTMLInputElement;
  expect(quality.value).toBe('');
  act(() => Simulate.change(quality, { target: { value: '101' } } as any));
  expect(Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '내보내기')!.disabled).toBe(true);
  act(() => Simulate.change(quality, { target: { value: '' } } as any));
  act(() => click('내보내기'));
  expect(resolve.mock.calls[0][0].preset.quality).toBeUndefined();
});
test('mobile hides target directory and unsupported lossless; cancel has no configuration', async () => {
  mobile = true;
  await act(async () => root.render(<DirectExportDialog />));
  expect(container.querySelector('option[value="lossless"]')).toBeNull();
  expect(container.textContent).not.toContain('폴더 선택');
  act(() => click('취소'));
  expect(resolve).toHaveBeenCalledWith();
});

test('new preset saves the same defaults used by the direct form', async () => {
  await act(async () => root.render(<ExportPresetManager />));
  const name = container.querySelector('input[placeholder="프리셋 이름"]')!;
  act(() => Simulate.change(name, { target: { value: 'new' } } as any));
  act(() => click('프리셋 추가'));
  expect(state.saveExportPresets).toHaveBeenCalledWith([{ ...exportFormToPreset(emptyExportForm()), name: 'new' }]);
});
