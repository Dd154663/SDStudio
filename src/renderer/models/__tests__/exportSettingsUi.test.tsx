import React, { act, StrictMode } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
const state: any = { directExportRequest: undefined };
let mobile = false;
jest.mock('..', () => ({ get isMobile() { return mobile; }, backend: { selectDir: async () => '/chosen' } }));
jest.mock('../AppService', () => ({ appState: state }));
jest.mock('../platform', () => ({ buildImageOptimizeOptions: () => [{ text: '원본', value: 'original' }, { text: 'WebP', value: 'lossy' }, ...(!mobile ? [{ text: '무손실', value: 'lossless' }] : []), { text: 'AVIF', value: 'avif' }] }));
// 슬롯(도구줄·왼쪽 목록·바닥줄 — 2026-11-11 오버레이 묶음 1)도 함께 그린다
jest.mock('../../componenets/ModalOverlay', () => ({ children, toolbar, aside, footer, footerStart }: any) => <div>{toolbar}{aside}{children}{footerStart}{footer}</div>);
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
  Object.assign(state, { exportPresetManagerOpen: true, loadExportPresets: () => [], saveExportPresets: jest.fn(), subscribeExportPresets: () => () => {}, pushMessage: jest.fn() });
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
  // 2026-11-12 정비 M1: 비활성 대신 빠진 칸 안내 — 버튼은 aria-disabled, 누르면 칸 이름 토스트·창 유지
  const exportButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '내보내기')!;
  expect(exportButton.disabled).toBe(false);
  expect(exportButton.getAttribute('aria-disabled')).toBe('true');
  expect(container.querySelector('[data-direct-export-problems]')!.textContent).toContain('화질(1~100)');
  act(() => click('내보내기'));
  expect(resolve).not.toHaveBeenCalled();
  expect(state.pushMessage).toHaveBeenCalledWith('다음 칸을 확인해 주세요: 화질(1~100)', 'error');
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

// 되돌리기·다시 실행(2차 묶음 4 P5)이 목록을 바꾸면 열린 관리 창이 다시 읽는다 — 자기 저장은 무시
test('preset manager re-reads the list when undo restores it from outside', async () => {
  let listener: ((list: any[]) => void) | undefined;
  state.loadExportPresets = () => [{ ...exportFormToPreset(emptyExportForm()), name: 'A' }];
  state.subscribeExportPresets = (fn: any) => {
    listener = fn;
    return () => {
      listener = undefined;
    };
  };
  await act(async () => root.render(<ExportPresetManager />));
  expect(container.textContent).toContain('A');
  expect(listener).toBeDefined();
  act(() => listener!([{ ...exportFormToPreset(emptyExportForm()), name: 'A' }, { ...exportFormToPreset(emptyExportForm()), name: 'B' }]));
  expect(container.textContent).toContain('B');
});

// 2026-11-12 정비 M1: 직접 내보내기 — 빠진 칸 이름 안내(캐릭터 이름 접두에서 이름 비움)
test('direct export names the missing field instead of silently disabling', async () => {
  await act(async () => root.render(<DirectExportDialog />));
  expect(container.querySelector('[data-direct-export-problems]')).toBeNull();
  const formatSelect = Array.from(container.querySelectorAll('select')).find((select) => select.querySelector('option[value="prefix"]'))!;
  act(() => Simulate.change(formatSelect, { target: { value: 'prefix' } } as any));
  expect(container.querySelector('[data-direct-export-problems]')!.textContent).toContain('캐릭터 이름');
  act(() => click('내보내기'));
  expect(resolve).not.toHaveBeenCalled();
  expect(state.pushMessage).toHaveBeenCalledWith('다음 칸을 확인해 주세요: 캐릭터 이름', 'error');
});

// 2026-11-12 정비 M1·R5: 폼 [프리셋 추가]·[수정 저장]도 같은 이름을 거부(인라인 이름 바꾸기와 같은 문구), 자기 자신은 제외
test('preset form rejects a name used by another preset but allows saving itself', async () => {
  state.loadExportPresets = () => [{ ...exportFormToPreset(emptyExportForm()), name: 'A' }];
  await act(async () => root.render(<ExportPresetManager />));
  const name = container.querySelector('input[placeholder="프리셋 이름"]')!;
  act(() => Simulate.change(name, { target: { value: ' A ' } } as any));
  act(() => click('프리셋 추가'));
  expect(state.saveExportPresets).not.toHaveBeenCalled();
  expect(state.pushMessage).toHaveBeenCalledWith('같은 이름의 내보내기 프리셋이 이미 있습니다: A', 'error');
  expect((name as HTMLInputElement).value).toBe(' A '); // 입력 보존
  // 목록의 A 를 열어 이름 그대로 수정 저장 = 통과
  const row = Array.from(container.querySelectorAll('*')).find((el) => el.children.length === 0 && el.textContent === 'A') as HTMLElement;
  act(() => row.click());
  act(() => click('수정 저장'));
  expect(state.saveExportPresets).toHaveBeenCalledTimes(1);
});
