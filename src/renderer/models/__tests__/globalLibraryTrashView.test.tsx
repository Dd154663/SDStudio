// 글로벌 프리셋·글로벌 캐릭터 프리셋 휴지통 화면(2026-11-24 — componenets/GlobalLibraryTrashView.tsx).
//  · 진입 버튼 「휴지통 (N)」(비면 숫자 없이)·모바일 좁은 줄은 아이콘 + 개수
//  · 휴지통 보기: 줄(이름·종류·남은 일수) [복원]·[영구 삭제](위험 확인 'permanent')·[휴지통 비우기]·선택 모드
//  · PC·모바일(ModalOverlay 모바일 틀) 모두 그려진다
//  · 소스 검사: 두 화면에 진입 버튼, 삭제 확인 = 휴지통 갈래(GLOBAL_LIBRARY_TRASH_DAYS), 종전 'undoable'/'permanent' 갈래 없음
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import * as fs from 'fs';
import * as path from 'path';

const mockEnv = { mobile: false };
const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const mockGps: any = {
  trash: [] as any[],
  fetchProfileImage: jest.fn(async () => null),
  restoreFromTrash: jest.fn(async (id: string) => ({ kind: 'restored', entry: { id, name: 'R' }, missingImages: 0 })),
  purgeFromTrash: jest.fn(async (ids: string[]) => ({ removed: ids.length, filesDeleted: 1, saved: true })),
  emptyTrash: jest.fn(async () => ({ removed: 2, filesDeleted: 2, saved: true })),
};
const mockGcs: any = {
  trash: [] as any[],
  fetchImageData: jest.fn(async () => null),
  restoreFromTrash: jest.fn(async (id: string) => ({
    kind: 'restored',
    entry: { id, name: 'C' },
    missingImages: 2,
    folderDropped: 'F',
  })),
  purgeFromTrash: jest.fn(async () => ({ removed: 1, filesDeleted: 0, saved: true })),
  emptyTrash: jest.fn(async () => ({ removed: 1, filesDeleted: 0, saved: true })),
};

jest.mock('../BackStackService', () => ({
  useBackLayer: () => {},
  backStackService: { push: () => ({ remove: () => {} }) },
}));
jest.mock('../index', () => ({
  get isMobile() {
    return mockEnv.mobile;
  },
  globalPresetService: mockGps,
  globalCharacterPresetService: mockGcs,
}));
const mockAppState: any = {
  pushMessage: jest.fn(),
  pushDialog: jest.fn(),
  incrementModalOverlay: jest.fn(),
  decrementModalOverlay: jest.fn(),
};
jest.mock('../AppService', () => ({ appState: mockAppState }));
jest.mock('../appStateRef', () => ({ getAppState: () => mockAppState }));
jest.mock('../../componenets/TrashViews', () => ({ formatTrashDate: () => '어제' }));
jest.mock('../../componenets/ActionIcon', () => ({ ActionIcon: () => null }));

import {
  GlobalLibraryTrashButton,
  GlobalLibraryTrashView,
  restoreOutcomeText,
} from '../../componenets/GlobalLibraryTrashView';
import { GLOBAL_TRASH_TEXT } from '../globalLibraryTrash';

let container: HTMLDivElement;
let root: Root;
beforeAll(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  jest.clearAllMocks();
  mockEnv.mobile = false;
  mockGps.trash = [];
  mockGcs.trash = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (el: React.ReactElement) => act(() => root.render(el));
const flush = () => act(async () => {});
const q = (sel: string) => container.querySelector(sel) as HTMLElement | null;
const buttons = () => Array.from(container.querySelectorAll('button')) as HTMLButtonElement[];
const byText = (t: string) => buttons().find((b) => b.textContent?.includes(t));
const lastDialog = () => mockAppState.pushDialog.mock.calls[mockAppState.pushDialog.mock.calls.length - 1][0];

const p = (id: string, name: string, daysAgo: number) => ({
  entry: { id, name, workflowType: 'SDImageGen', profile: `${id}.png` },
  deletedAt: NOW - daysAgo * DAY,
});

describe('진입 버튼', () => {
  test('비어 있으면 「휴지통」, 있으면 「휴지통 (N)」, 누르면 보기가 열린다', () => {
    render(<GlobalLibraryTrashButton kind="presets" className="x" />);
    expect(q('[data-global-trash-open="presets"]')!.textContent).toBe('휴지통');
    act(() => root.unmount());
    root = createRoot(container);
    mockGps.trash = [p('a', 'A', 1), p('b', 'B', 2)];
    render(<GlobalLibraryTrashButton kind="presets" className="x" />);
    const btn = q('[data-global-trash-open="presets"]')!;
    expect(btn.textContent).toBe('휴지통 (2)');
    act(() => Simulate.click(btn));
    expect(q('[data-global-trash-list="presets"]')).not.toBeNull();
  });

  test('compact = 아이콘 + 개수만(이름은 aria-label)', () => {
    mockGcs.trash = [{ entry: { id: 'c', name: 'C', preset: {} }, deletedAt: NOW }];
    render(<GlobalLibraryTrashButton kind="characters" className="x" compact />);
    const btn = q('[data-global-trash-open="characters"]')!;
    expect(btn.textContent).toBe('1');
    expect(btn.getAttribute('aria-label')).toBe('휴지통 (1)');
  });
});

describe('휴지통 보기', () => {
  test('줄 = 이름·종류·남은 일수(최근 삭제 순), 비우기는 0개면 비활성', () => {
    render(<GlobalLibraryTrashView kind="presets" onClose={() => {}} />);
    expect(container.textContent).toContain(GLOBAL_TRASH_TEXT.empty);
    expect((q('[data-global-trash-empty]') as HTMLButtonElement).disabled).toBe(true);
    mockGps.trash = [p('old', 'Old', 10), p('new', 'New', 1)];
    render(<GlobalLibraryTrashView kind="presets" onClose={() => {}} />);
    const rows = Array.from(container.querySelectorAll('[data-global-trash-row]'));
    expect(rows.map((r) => r.getAttribute('data-global-trash-row'))).toEqual(['new', 'old']);
    expect(rows[0].textContent).toContain('그림체 프리셋');
    expect(rows[0].textContent).toContain('29일 남음');
    expect(rows[1].textContent).toContain('20일 남음');
    expect(container.textContent).toContain(GLOBAL_TRASH_TEXT.notice);
  });

  test('[복원] → 서비스 restoreFromTrash, 안내에 이미지 없음·폴더 없음', async () => {
    mockGcs.trash = [{ entry: { id: 'c', name: 'C', folder: 'F', preset: {} }, deletedAt: NOW }];
    render(<GlobalLibraryTrashView kind="characters" onClose={() => {}} />);
    expect(container.textContent).toContain('폴더 F');
    await act(async () => Simulate.click(byText('복원')!));
    expect(mockGcs.restoreFromTrash).toHaveBeenCalledWith('c');
    const msg = mockAppState.pushMessage.mock.calls[0][0];
    expect(msg).toContain(GLOBAL_TRASH_TEXT.imageMissing(2));
    expect(msg).toContain(GLOBAL_TRASH_TEXT.folderDropped('F'));
  });

  test('[영구 삭제] = 위험 확인(Enter 무시) 뒤에만 purgeFromTrash', async () => {
    mockGps.trash = [p('a', 'A', 1)];
    render(<GlobalLibraryTrashView kind="presets" onClose={() => {}} />);
    act(() => Simulate.click(byText('영구 삭제')!));
    expect(mockGps.purgeFromTrash).not.toHaveBeenCalled();
    const d = lastDialog();
    expect(d.danger).toBe('permanent');
    expect(d.text).toContain('영구 삭제할까요?');
    expect(d.confirmText).toBe('영구 삭제');
    await act(async () => d.callback());
    expect(mockGps.purgeFromTrash).toHaveBeenCalledWith(['a']);
  });

  test('[휴지통 비우기] = 위험 확인 → emptyTrash', async () => {
    mockGps.trash = [p('a', 'A', 1), p('b', 'B', 1)];
    render(<GlobalLibraryTrashView kind="presets" onClose={() => {}} />);
    act(() => Simulate.click(q('[data-global-trash-empty]')!));
    const d = lastDialog();
    expect(d.danger).toBe('permanent');
    expect(d.text).toContain('글로벌 프리셋 2개를 영구 삭제할까요?');
    await act(async () => d.callback());
    expect(mockGps.emptyTrash).toHaveBeenCalled();
    expect(mockAppState.pushMessage).toHaveBeenCalledWith(GLOBAL_TRASH_TEXT.emptied(2));
  });

  test('선택 모드 → 전체 선택 → 선택 복원 / 선택 영구 삭제', async () => {
    mockGps.trash = [p('a', 'A', 1), p('b', 'B', 2)];
    render(<GlobalLibraryTrashView kind="presets" onClose={() => {}} />);
    act(() => Simulate.click(byText('선택 모드')!));
    expect(byText('복원')!.textContent).toContain('선택 복원'); // 줄 버튼은 숨김
    act(() => Simulate.click(byText('전체 선택')!));
    act(() => Simulate.click(byText('선택 영구 삭제')!));
    await act(async () => lastDialog().callback());
    expect(mockGps.purgeFromTrash).toHaveBeenCalledWith(['a', 'b']);
    act(() => Simulate.click(byText('선택 모드')!));
    act(() => Simulate.click(byText('전체 선택')!));
    await act(async () => Simulate.click(byText('선택 복원')!));
    await flush();
    expect(mockGps.restoreFromTrash).toHaveBeenCalledTimes(2);
  });

  test('모바일에서도 그려진다(ModalOverlay 모바일 틀)', () => {
    mockEnv.mobile = true;
    mockGcs.trash = [{ entry: { id: 'c', name: '모바일 C', preset: {} }, deletedAt: NOW }];
    render(<GlobalLibraryTrashView kind="characters" onClose={() => {}} />);
    expect(container.textContent).toContain('모바일 C');
    expect(byText('복원')).toBeDefined();
    expect(q('[data-global-trash-empty]')).not.toBeNull();
  });

  test('restoreOutcomeText — 이름 바뀜·없음·같은 id', () => {
    expect(restoreOutcomeText('A', { kind: 'restored', entry: { name: 'A (2)' }, renamedFrom: 'A', missingImages: 0 })).toBe(
      GLOBAL_TRASH_TEXT.restoredAs('A', 'A (2)'),
    );
    expect(restoreOutcomeText('A', { kind: 'not-in-trash' })).toBe(GLOBAL_TRASH_TEXT.notInTrash);
    expect(restoreOutcomeText('A', { kind: 'id-taken' })).toBe(GLOBAL_TRASH_TEXT.idTaken('A'));
  });
});

describe('소스 검사 — 진입 자리·삭제 확인 문구', () => {
  const read = (f: string) => fs.readFileSync(path.join(__dirname, '../../componenets', f), 'utf8');
  test('글로벌 프리셋 탭(PC·모바일)과 캐릭터 프리셋 관리 글로벌 보기에 진입 버튼', () => {
    const tab = read('GlobalPresetTab.tsx');
    expect(tab.match(/<GlobalLibraryTrashButton\s+kind="presets"/g)).toHaveLength(2);
    const cpe = read('CharacterPresetEditor.tsx');
    expect(cpe).toMatch(/globalView && \(\s*<GlobalLibraryTrashButton\s+kind="characters"/);
  });
  test('삭제 확인은 휴지통 갈래(상수 일수) — 종전 undoable/permanent 갈래와 plan.undoable 없음', () => {
    for (const f of ['GlobalPresetTab.tsx', 'CharacterPresetEditor.tsx']) {
      const src = read(f);
      expect(src).toContain('outcome: { trashDays: GLOBAL_LIBRARY_TRASH_DAYS }');
      expect(src).not.toContain('plan.undoable');
      expect(src).not.toContain('plan?.undoable');
    }
  });
});
