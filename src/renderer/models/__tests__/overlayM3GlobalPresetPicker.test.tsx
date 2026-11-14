// 오버레이 M3(2026-11-14) — 글로벌 프리셋 고르기 2창(템플릿 관리 「글로벌 프리셋에서 복사」·사전 세팅
// 「글로벌에서 가져오기」)을 공용 GlobalPresetPicker(size xl·도구줄 검색·정렬·개수)로 합친 결과의 검사.
// (a) 검색·정렬 단일 출처 filterSortGlobalPresets 단위 검사
// (b) GlobalPresetPicker 렌더 — xl 등급·카드 = 버튼·기본 우선 정렬·검색·개수·빈 목록/검색 0건 문구·
//     danger 면 확인 후에만 onPick·아니면 즉시·열릴 때 load()
// (c) GlobalPresetPickerOverlay — appState.globalPresetPicker 가 없으면 아무것도 그리지 않고, 있으면 제목에 적용 대상
// (d) 소스 검사 — 템플릿 관리의 옛 고르기 창·글로벌 프리셋 탭의 직접 만든 창이 남지 않는다
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import * as fs from 'fs';
import * as path from 'path';

const mockGps: { presets: any[]; loaded: boolean; load: jest.Mock; list: () => any[]; fetchProfileImage: jest.Mock } = {
  presets: [],
  loaded: true,
  load: jest.fn(async () => {}),
  list: () => mockGps.presets.slice(),
  fetchProfileImage: jest.fn(async () => null),
};
const mockStack: (() => void)[] = [];

jest.mock('../BackStackService', () => ({
  useBackLayer: () => {},
  backStackService: {
    push: (fn: () => void) => {
      mockStack.push(fn);
      return {
        remove: () => {
          const i = mockStack.indexOf(fn);
          if (i >= 0) mockStack.splice(i, 1);
        },
      };
    },
  },
}));
jest.mock('../index', () => ({
  isMobile: false,
  globalPresetService: mockGps,
  backend: {},
  imageService: {},
  sessionService: {},
}));
const mockAppState: any = {
  globalPresetPicker: undefined,
  closeGlobalPresetPicker: jest.fn(),
  pushMessage: jest.fn(),
  confirmAsync: jest.fn(async () => true),
  incrementModalOverlay: jest.fn(),
  decrementModalOverlay: jest.fn(),
};
jest.mock('../AppService', () => ({ appState: mockAppState }));
jest.mock('../GlobalPresetService', () => ({ SUPPORTED_GLOBAL_PRESET_TYPES: ['SDImageGen', 'SDImageGenEasy'] }));
jest.mock('../PersistenceService', () => ({ persistService: {} }));
jest.mock('../presetUndo', () => ({ beginPresetListRecord: jest.fn() }));
jest.mock('../undoService', () => ({ UNDO_TEXT: {} }));
jest.mock('../globalLibraryUndo', () => ({
  renameGlobalPresetRecorded: jest.fn(),
  setGlobalPresetDefaultRecorded: jest.fn(),
  setGlobalPresetsDefaultRecorded: jest.fn(),
}));
jest.mock('../../componenets/PresetEditModal', () => ({ PresetEditModal: () => null }));
jest.mock('../../componenets/ActionIcon', () => ({ ActionIcon: () => null }));

import { filterSortGlobalPresets } from '../globalPresetListView';
import { GlobalPresetPicker } from '../../componenets/GlobalPresetPicker';
import { GlobalPresetPickerOverlay } from '../../componenets/GlobalPresetTab';

const SAMPLE = [
  { id: 'a', name: 'Tree 10', workflowType: 'SDImageGen', isDefault: false, updatedAt: 300 },
  { id: 'b', name: 'tree 2', workflowType: 'SDImageGenEasy', isDefault: true, updatedAt: 100 },
  { id: 'c', name: 'Apple', workflowType: 'SDImageGen', isDefault: false, updatedAt: 200 },
];

describe('filterSortGlobalPresets — 글로벌 프리셋 탭과 같은 검색·정렬', () => {
  const ids = (l: { id: string }[]) => l.map((p) => p.id);
  test('recent = 수정 시각 최신순', () => {
    expect(ids(filterSortGlobalPresets(SAMPLE, '', 'recent'))).toEqual(['a', 'c', 'b']);
  });
  test('name = 숫자 자연 정렬·대소문자 무시', () => {
    expect(ids(filterSortGlobalPresets(SAMPLE, '', 'name'))).toEqual(['c', 'b', 'a']);
  });
  test('default = 기본 먼저, 그 안은 최신순', () => {
    expect(ids(filterSortGlobalPresets(SAMPLE, '', 'default'))).toEqual(['b', 'a', 'c']);
  });
  test('검색 = 앞뒤 공백 제거·대소문자 무시 부분 일치, 원본 불변', () => {
    expect(ids(filterSortGlobalPresets(SAMPLE, '  APP ', 'recent'))).toEqual(['c']);
    expect(ids(filterSortGlobalPresets(SAMPLE, 'TREE', 'name'))).toEqual(['b', 'a']);
    expect(filterSortGlobalPresets(SAMPLE, '없음', 'recent')).toEqual([]);
    expect(ids(SAMPLE)).toEqual(['a', 'b', 'c']);
  });
  test('updatedAt·isDefault 없는 항목도 0·거짓으로 다룬다', () => {
    const l = [{ name: 'x' }, { name: 'y', updatedAt: 5 }];
    expect(filterSortGlobalPresets(l, '', 'default').map((p) => p.name)).toEqual(['y', 'x']);
  });
});

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (global as any).IS_REACT_ACT_ENVIRONMENT = true;
  mockGps.presets = SAMPLE.map((p) => ({ ...p }));
  mockGps.loaded = true;
  mockGps.load = jest.fn(async () => {});
  mockAppState.globalPresetPicker = undefined;
  mockAppState.closeGlobalPresetPicker = jest.fn();
  mockAppState.confirmAsync = jest.fn(async () => true);
  mockStack.length = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const q = (sel: string) => container.querySelector(sel) as HTMLElement | null;
const cards = () => Array.from(container.querySelectorAll('[data-global-picker-card]')) as HTMLElement[];
const cardNames = () => cards().map((c) => c.getAttribute('aria-label'));
const flush = () => act(async () => {});

const renderPicker = async (props: Partial<React.ComponentProps<typeof GlobalPresetPicker>> = {}) => {
  const onPick = jest.fn();
  const onClose = jest.fn();
  await act(async () =>
    root.render(<GlobalPresetPicker isOpen onClose={onClose} onPick={onPick} title="고르기" {...props} />),
  );
  return { onPick, onClose };
};
const typeSearch = async (text: string) => {
  const input = q('[data-global-picker-search]') as HTMLInputElement;
  await act(async () => {
    input.value = text;
    Simulate.change(input);
  });
};

describe('GlobalPresetPicker — 공용 글로벌 프리셋 고르기 창', () => {
  test('size xl 등급, 도구줄에 검색·정렬·개수, 카드 = 버튼, 기본 우선 정렬', async () => {
    await renderPicker();
    expect(q('[data-modal-size]')!.getAttribute('data-modal-size')).toBe('xl');
    const toolbar = q('[data-modal-slot="toolbar"]')!;
    expect(toolbar.querySelector('[data-global-picker-search]')).not.toBeNull();
    expect((toolbar.querySelector('[data-global-picker-search]') as HTMLInputElement).placeholder).toBe('이름 검색');
    expect((toolbar.querySelector('select') as HTMLSelectElement).value).toBe('default');
    expect(toolbar.querySelector('[data-global-picker-count]')!.textContent).toBe('3 / 전체 3');
    expect(cards().every((c) => c.tagName === 'BUTTON' && c.getAttribute('type') === 'button')).toBe(true);
    expect(cardNames()).toEqual(['tree 2', 'Tree 10', 'Apple']);
    // 기본 지정 배지는 기본 프리셋 카드에만
    expect(cards()[0].querySelector('[data-global-picker-default]')).not.toBeNull();
    expect(cards()[1].querySelector('[data-global-picker-default]')).toBeNull();
  });

  test('정렬을 바꾸면 카드 순서가 바뀐다', async () => {
    await renderPicker();
    const select = q('[data-global-picker-sort]') as HTMLSelectElement;
    await act(async () => {
      select.value = 'name';
      Simulate.change(select);
    });
    expect(cardNames()).toEqual(['Apple', 'tree 2', 'Tree 10']);
  });

  test('검색이 카드를 거르고 개수가 따라 바뀐다, 0건이면 「검색 결과가 없습니다.」', async () => {
    await renderPicker();
    await typeSearch('tree');
    expect(cardNames()).toEqual(['tree 2', 'Tree 10']);
    expect(q('[data-global-picker-count]')!.textContent).toBe('2 / 전체 3');
    await typeSearch('zzz');
    expect(cards()).toHaveLength(0);
    expect(container.textContent).toContain('검색 결과가 없습니다.');
    expect(q('[data-global-picker-count]')!.textContent).toBe('0 / 전체 3');
  });

  test('목록이 비면 「글로벌 프리셋이 없습니다.」', async () => {
    mockGps.presets = [];
    await renderPicker();
    expect(container.textContent).toContain('글로벌 프리셋이 없습니다.');
    expect(container.textContent).not.toContain('검색 결과가 없습니다.');
  });

  test('danger 가 아니면 고르는 즉시 onPick', async () => {
    const { onPick } = await renderPicker();
    await act(async () => Simulate.click(cards()[1]));
    expect(mockAppState.confirmAsync).not.toHaveBeenCalled();
    expect(onPick).toHaveBeenCalledWith('a');
  });

  test('danger 면 덮어쓰기 확인 — [취소]면 onPick 없음, [확인]이면 onPick', async () => {
    mockAppState.confirmAsync = jest.fn(async () => false);
    const { onPick } = await renderPicker({ danger: true, description: '덮어씁니다.' });
    expect(q('[data-global-picker-description]')!.className).toContain('text-red-500');
    await act(async () => Simulate.click(cards()[0]));
    await flush();
    expect(mockAppState.confirmAsync).toHaveBeenCalledTimes(1);
    const opts = mockAppState.confirmAsync.mock.calls[0][0];
    expect(opts.text).toBe('「tree 2」의 프롬프트·샘플링 설정으로 이 템플릿을 덮어쓸까요?');
    expect(opts.danger).toBe(true);
    expect(onPick).not.toHaveBeenCalled();

    mockAppState.confirmAsync = jest.fn(async () => true);
    await act(async () => Simulate.click(cards()[0]));
    await flush();
    expect(onPick).toHaveBeenCalledWith('b');
  });

  test('열릴 때 아직 안 불러왔으면 load(), 불러왔으면 부르지 않는다', async () => {
    mockGps.loaded = false;
    await renderPicker();
    expect(mockGps.load).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
    root = createRoot(container);
    mockGps.loaded = true;
    mockGps.load = jest.fn(async () => {});
    await renderPicker();
    expect(mockGps.load).not.toHaveBeenCalled();
  });

  test('닫힌 상태는 아무것도 그리지 않고, Esc(백스택 맨 위)는 onClose', async () => {
    await act(async () =>
      root.render(<GlobalPresetPicker isOpen={false} onClose={jest.fn()} onPick={jest.fn()} title="고르기" />),
    );
    expect(container.innerHTML).toBe('');
    const { onClose } = await renderPicker();
    await act(async () => mockStack[mockStack.length - 1]());
    expect(onClose).toHaveBeenCalled();
  });
});

describe('GlobalPresetPickerOverlay — appState.globalPresetPicker 호스트', () => {
  test('picker 가 없으면 아무것도 그리지 않는다', async () => {
    await act(async () => root.render(<GlobalPresetPickerOverlay />));
    expect(container.innerHTML).toBe('');
  });

  test('picker 가 있으면 공용 창(xl)·적용 대상 제목, 고르면 onSelect·✕ 는 closeGlobalPresetPicker', async () => {
    const onSelect = jest.fn();
    mockAppState.globalPresetPicker = { workflowType: 'SDImageGenEasy', onSelect };
    await act(async () => root.render(<GlobalPresetPickerOverlay />));
    expect(q('[data-modal-size]')!.getAttribute('data-modal-size')).toBe('xl');
    expect(q('h2')!.textContent).toContain('글로벌 프리셋을 프로젝트로 복사');
    expect(q('h2')!.textContent).toContain('(→ 그림체 (이지모드)로 적용)');
    await act(async () => Simulate.click(cards()[0]));
    expect(mockAppState.confirmAsync).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledWith('b');
    await act(async () => Simulate.click(container.querySelector('button[aria-label="닫기"]')!));
    expect(mockAppState.closeGlobalPresetPicker).toHaveBeenCalled();
  });
});

describe('소스 검사 — 옛 고르기 창이 남지 않는다', () => {
  const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
  test('템플릿 관리: GlobalPresetPickerModal 없음, 공용 창을 danger 로 쓴다', () => {
    const src = read('componenets/TemplateManagerModal.tsx');
    expect(src).not.toContain('GlobalPresetPickerModal');
    expect(src).toMatch(/<GlobalPresetPicker[\s\S]*?danger[\s\S]*?\/>/);
  });
  test('글로벌 프리셋 탭: 고르기 호스트에 직접 만든 창(bg-black/50·useBackdropClose) 없음', () => {
    const src = read('componenets/GlobalPresetTab.tsx');
    const host = src.slice(src.indexOf('export const GlobalPresetPickerOverlay'));
    expect(host).toContain('<GlobalPresetPicker');
    expect(host).not.toContain('bg-black/50');
    expect(src).not.toContain('useBackdropClose');
    expect(src).not.toContain('저장된 글로벌 프리셋이 없습니다');
  });
});
