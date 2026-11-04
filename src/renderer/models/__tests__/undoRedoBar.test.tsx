// 되돌리기/다시 실행 하단 상시 버튼 바(2026-11-03 U6 — D19 결정) 렌더 테스트.
// 활성·비활성, 클릭 → undoService 호출, 숨김 조건(세션 없음·미러·파일 드롭·앱 안 드래그·키보드 칩·V2 시트 키보드),
// 토스트 여백 변수(--undo-bar-top) 설정/해제, 부착(보이는 하단 막대 중 가장 위의 UndoBarSlot 에 포털, 색 종류·대체 위치),
// 가림 판정(FloatView 등 바 층 아래 요소만 가림 — 바 층 이상 오버레이는 무시), ⋯ 메뉴 임시 버튼 제거·퀵 메뉴 유지,
// 단축키 도움말 전역 항목.
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';

let mockDragging = false;

jest.mock('react-dnd', () => ({
  useDragLayer: (collect: (m: { isDragging: () => boolean }) => unknown) =>
    collect({ isDragging: () => mockDragging }),
}));
jest.mock('../AppService', () => {
  const { observable } = require('mobx');
  return {
    appState: observable(
      {
        curSession: { name: 'p1' } as { name: string } | undefined,
        mobileV2SheetKeyboard: false,
        curMainTab: 'scene',
      },
      { curSession: observable.ref },
    ),
  };
});
jest.mock('..', () => {
  const { observable } = require('mobx');
  const mirrors: Set<string> = observable.set();
  return {
    isMobile: false,
    __mirrors: mirrors,
    sessionService: { isMirror: (name: string) => mirrors.has(name) },
  };
});
jest.mock('../undoService', () => {
  const actual = jest.requireActual('../undoService');
  const { observable } = require('mobx');
  const state = observable({
    canUndo: false,
    canRedo: false,
    undoLabel: undefined as string | undefined,
    redoLabel: undefined as string | undefined,
    hasGlobalEntries: false,
  });
  return {
    ...actual,
    __state: state,
    undoService: {
      get canUndo() {
        return state.canUndo;
      },
      get canRedo() {
        return state.canRedo;
      },
      get undoLabel() {
        return state.undoLabel;
      },
      get redoLabel() {
        return state.redoLabel;
      },
      get hasGlobalEntries() {
        return state.hasGlobalEntries;
      },
      undo: jest.fn(async () => true),
      redo: jest.fn(async () => true),
    },
  };
});
jest.mock('../KeyboardShortcutService', () => ({
  KeyboardShortcutService: { keyDisplayName: (k: string) => k },
  keyboardShortcutService: {
    getBinding: (id: string) => (id === 'undo' ? 'Ctrl+Z' : id === 'redo' ? 'Ctrl+Y' : undefined),
  },
}));

import { runInAction } from 'mobx';
import { appState } from '../AppService';
import * as models from '..';
import * as undoModule from '../undoService';
import { setKeyboardChipVisible } from '../keyboardChipState';
import UndoRedoBar, {
  pickUndoAnchor,
  undoBarStyle,
  UNDO_ANCHOR_ATTR,
  UNDO_BAR_TOP_VAR,
  undoBarTopCss,
} from '../../componenets/UndoRedoBar';
import { UndoBarSlot, UndoSlotTone, V2_ROW_SELECT_TINT } from '../../componenets/UndoBarSlot';
import ShortcutCheatsheet from '../../componenets/ShortcutCheatsheet';
import {
  sceneToolbarRegistry,
  portableButtonIds,
  resolveToolbarView,
  TOOLBAR_VIEW_MAIN,
} from '../uiLayout';
import { globalActionById, globalActionMeta, resolveQuickMenu } from '../globalActions';

const undoState = (undoModule as any).__state as {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string;
  redoLabel?: string;
  hasGlobalEntries: boolean;
};
const mirrors = (models as any).__mirrors as Set<string>;
const { undoService } = undoModule;

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (global as any).IS_REACT_ACT_ENVIRONMENT = true;
  mockDragging = false;
  runInAction(() => {
    (appState as any).curSession = { name: 'p1' };
    (appState as any).mobileV2SheetKeyboard = false;
    undoState.canUndo = false;
    undoState.canRedo = false;
    undoState.undoLabel = undefined;
    undoState.redoLabel = undefined;
    undoState.hasGlobalEntries = false;
    mirrors.clear();
  });
  setKeyboardChipVisible(false);
  (undoService.undo as jest.Mock).mockClear();
  (undoService.redo as jest.Mock).mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.querySelectorAll(`[${UNDO_ANCHOR_ATTR}]`).forEach((el) => el.remove());
});

const render = (props: { suppressed?: boolean } = {}) =>
  act(() => root.render(<UndoRedoBar {...props} />));
const bar = () => document.querySelector<HTMLElement>('[data-undo-bar]');
const btn = (dir: 'undo' | 'redo') =>
  document.querySelector<HTMLButtonElement>(`[data-undo-bar-button="${dir}"]`);
const topVar = () => document.documentElement.style.getPropertyValue(UNDO_BAR_TOP_VAR);

describe('UndoRedoBar 표시·활성', () => {
  test('되돌릴 것이 없으면 두 버튼 모두 비활성(흐리게), 바는 상시 표시', () => {
    render();
    expect(bar()).not.toBeNull();
    expect(bar()!.getAttribute('role')).toBe('toolbar');
    expect(btn('undo')!.disabled).toBe(true);
    expect(btn('redo')!.disabled).toBe(true);
    expect(btn('undo')!.className).toContain('disabled:opacity-40');
    expect(btn('undo')!.getAttribute('aria-label')).toBe('되돌리기');
    expect(btn('redo')!.getAttribute('aria-label')).toBe('다시 실행');
  });

  test('canUndo/canRedo 를 따라 각각 활성화된다(관찰 구독)', () => {
    render();
    act(() => runInAction(() => (undoState.canUndo = true)));
    expect(btn('undo')!.disabled).toBe(false);
    expect(btn('redo')!.disabled).toBe(true);
    act(() => runInAction(() => (undoState.canRedo = true)));
    expect(btn('redo')!.disabled).toBe(false);
  });

  test('클릭 → undoService.undo/redo(appState.curSession)', () => {
    runInAction(() => {
      undoState.canUndo = true;
      undoState.canRedo = true;
    });
    render();
    act(() => btn('undo')!.click());
    expect(undoService.undo).toHaveBeenCalledTimes(1);
    expect(undoService.undo).toHaveBeenCalledWith(appState.curSession);
    act(() => btn('redo')!.click());
    expect(undoService.redo).toHaveBeenCalledWith(appState.curSession);
  });

  test('비활성 버튼 클릭은 아무것도 부르지 않는다', () => {
    render();
    act(() => btn('undo')!.click());
    expect(undoService.undo).not.toHaveBeenCalled();
  });
});

describe('UndoRedoBar 숨김 조건', () => {
  test('프로젝트 없음 → 미렌더', () => {
    runInAction(() => ((appState as any).curSession = undefined));
    render();
    expect(bar()).toBeNull();
  });

  // 2차 묶음 2 — 전역 스택(프로젝트 즐겨찾기·폴더 작업)에 항목이 있으면 프로젝트가 없거나 미러여도 보이고 동작한다
  test('프로젝트 없이 전역 항목만 있으면 표시·활성, 클릭 → undoService.undo(undefined)', () => {
    runInAction(() => {
      (appState as any).curSession = undefined;
      undoState.hasGlobalEntries = true;
      undoState.canUndo = true;
      undoState.undoLabel = '폴더 색 변경: f';
    });
    render();
    expect(bar()).not.toBeNull();
    expect(btn('undo')!.disabled).toBe(false);
    expect(btn('redo')!.disabled).toBe(true);
    act(() => btn('undo')!.click());
    expect(undoService.undo).toHaveBeenCalledWith(undefined);
    // 전역 항목이 모두 없어지면 다시 숨는다
    act(() => runInAction(() => (undoState.hasGlobalEntries = false)));
    expect(bar()).toBeNull();
  });

  test('미러 프로젝트라도 전역 항목이 있으면 표시', () => {
    runInAction(() => {
      mirrors.add('p1');
      undoState.hasGlobalEntries = true;
    });
    render();
    expect(bar()).not.toBeNull();
  });

  test('읽기 전용 미러 프로젝트 → 미렌더(미러 해제 시 다시 표시)', () => {
    runInAction(() => mirrors.add('p1'));
    render();
    expect(bar()).toBeNull();
    act(() => runInAction(() => mirrors.delete('p1')));
    expect(bar()).not.toBeNull();
  });

  test('파일 드롭 안내(suppressed) 중 → 미렌더', () => {
    render({ suppressed: true });
    expect(bar()).toBeNull();
    render({ suppressed: false });
    expect(bar()).not.toBeNull();
  });

  test('앱 안 드래그(react-dnd) 중 → 미렌더', () => {
    mockDragging = true;
    render();
    expect(bar()).toBeNull();
  });

  test('모바일 키보드 칩 표시 중 → 미렌더, 칩이 사라지면 다시 표시', () => {
    render();
    expect(bar()).not.toBeNull();
    act(() => setKeyboardChipVisible(true));
    expect(bar()).toBeNull();
    act(() => setKeyboardChipVisible(false));
    expect(bar()).not.toBeNull();
  });

  test('모바일 V2 시트 키보드 중(하단 바도 숨는 때) → 미렌더', () => {
    runInAction(() => ((appState as any).mobileV2SheetKeyboard = true));
    render();
    expect(bar()).toBeNull();
  });
});

describe('토스트 여백 변수 --undo-bar-top', () => {
  test('바가 보이면 설정, 숨으면 지움, 언마운트 때도 지움', () => {
    render();
    expect(topVar()).not.toBe('');
    act(() => setKeyboardChipVisible(true));
    expect(topVar()).toBe('');
    act(() => setKeyboardChipVisible(false));
    expect(topVar()).not.toBe('');
    act(() => root.unmount());
    expect(topVar()).toBe('');
    root = createRoot(container); // afterEach 의 unmount 용
  });

  test('값 = 바 아래 변(막대 위 테두리 안쪽)의 거리 + 바 높이 36px, 막대 없으면 safe-area + 36px', () => {
    expect(undoBarTopCss(52)).toBe('88px');
    expect(undoBarTopCss(0)).toBe('36px');
    expect(undoBarTopCss(null)).toBe('calc(env(safe-area-inset-bottom) + 36px)');
  });
});

// 하단 막대 흉내: data-undo-anchor 를 단 relative 요소 + 끝의 UndoBarSlot(실제 컴포넌트). rect·clientTop 은 jsdom 이
// 계산하지 않으므로 직접 준다.
const anchorRoots: { root: Root; host: HTMLElement }[] = [];
const mountAnchor = (
  top: number,
  height: number,
  tone: UndoSlotTone = 'bar',
  borderTop = 1,
  parent: HTMLElement = document.body,
) => {
  const host = document.createElement('div');
  parent.appendChild(host);
  const r = createRoot(host);
  anchorRoots.push({ root: r, host });
  act(() =>
    r.render(
      <div {...{ [UNDO_ANCHOR_ATTR]: '' }} className="relative">
        <span>막대 내용</span>
        <UndoBarSlot tone={tone} />
      </div>,
    ),
  );
  const el = host.firstElementChild as HTMLElement;
  el.getBoundingClientRect = () =>
    ({ top, bottom: top + height, left: 0, right: 400, width: height > 0 ? 400 : 0, height, x: 0, y: top, toJSON() {} }) as DOMRect;
  Object.defineProperty(el, 'clientTop', { configurable: true, get: () => borderTop });
  return el;
};
const slotOf = (anchorEl: HTMLElement) =>
  anchorEl.querySelector<HTMLElement>(':scope > [data-undo-slot]')!;

describe('부착 — 막대 안 자리(UndoBarSlot)에 포털', () => {
  const origEfp = document.elementFromPoint;
  afterEach(() => {
    (document as any).elementFromPoint = origEfp;
    // 바(포털)를 먼저 내린 뒤 막대를 내린다
    act(() => root.unmount());
    root = createRoot(container);
    anchorRoots.splice(0).forEach(({ root: r, host }) => {
      act(() => r.unmount());
      host.remove();
    });
  });

  test('자리 = 막대 위 모서리 중앙 absolute(bottom-full left-1/2 -translate-x-1/2, z-widget)', () => {
    const a = mountAnchor(window.innerHeight - 52, 52);
    const slot = slotOf(a);
    for (const c of ['absolute', 'bottom-full', 'left-1/2', '-translate-x-1/2', 'z-[var(--z-widget)]'])
      expect(slot.className.split(' ')).toContain(c);
    expect(slot.getAttribute('data-undo-slot')).toBe('bar');
  });

  test('막대가 있으면 바는 그 자리 안(fixed 아님), 하단 바 색 = zone-bar + --c-surface, 위만 둥근 탭·막대와 같은 선', () => {
    const vh = window.innerHeight;
    const a = mountAnchor(vh - 52, 52, 'bar');
    render();
    expect(bar()!.parentElement).toBe(slotOf(a));
    const cls = bar()!.className.split(' ');
    expect(cls).not.toContain('fixed');
    for (const c of ['zone-bar', 'bg-[var(--c-surface)]', 'rounded-t-[10px]', 'border', 'border-b-0', 'line-color'])
      expect(cls).toContain(c);
    expect(cls).not.toContain('shadow-sm');
    expect(bar()!.getAttribute('data-undo-bar-tone')).toBe('bar');
    // 토스트 여백 = (막대 위 52px − 위 테두리 1px) + 36px
    expect(topVar()).toBe(`${52 - 1 + 36}px`);
  });

  test('버튼 = 하단 바 프로젝트 툴바와 같은 무배경 아이콘 버튼(icon-button touch-hit mx-1)', () => {
    mountAnchor(window.innerHeight - 52, 52);
    render();
    const cls = btn('undo')!.className.split(' ');
    for (const c of ['icon-button', 'touch-hit', 'mx-1']) expect(cls).toContain(c);
    expect(cls).not.toContain('icon-only');
  });

  test('막대가 없으면 화면 맨 아래 fixed(safe-area 위) 대체 위치', () => {
    render();
    expect(bar()!.parentElement).toBe(container);
    expect(bar()!.className.split(' ')).toContain('fixed');
    expect(bar()!.getAttribute('data-undo-bar-tone')).toBe('screen');
    // jsdom 은 env() 를 버리므로 스타일 값은 함수로 확인
    expect(undoBarStyle('screen')).toEqual({ bottom: 'env(safe-area-inset-bottom)' });
    expect(topVar()).toBe('calc(env(safe-area-inset-bottom) + 36px)');
  });

  test('보이는 막대 중 가장 위(하단 바 위 V2 메인 줄 → 메인 줄, 그 위 더보기 줄 → 더보기 줄)', () => {
    const vh = window.innerHeight;
    mountAnchor(vh - 52, 52, 'bar');
    const row = mountAnchor(vh - 104, 52, 'row');
    expect(pickUndoAnchor()!.slot).toBe(slotOf(row));
    expect(pickUndoAnchor()!.tone).toBe('row');
    const tier = mountAnchor(vh - 160, 56, 'tier');
    render();
    expect(bar()!.parentElement).toBe(slotOf(tier));
    expect(bar()!.className.split(' ')).toContain('bg-[var(--c-zone)]');
  });

  test('V2 메인 줄 선택 중 = 같은 하늘색 덮개', () => {
    mountAnchor(window.innerHeight - 52, 52, 'row-select');
    render();
    expect(bar()!.getAttribute('data-undo-bar-tone')).toBe('row-select');
    expect(bar()!.className.split(' ')).toContain('bg-[var(--c-surface)]');
    expect(undoBarStyle('row-select')).toEqual({
      backgroundImage: `linear-gradient(${V2_ROW_SELECT_TINT}, ${V2_ROW_SELECT_TINT})`,
    });
    expect(undoBarStyle('row')).toBeUndefined();
    expect(undoBarStyle('bar')).toBeUndefined();
  });

  test('크기 0(display:none) 막대·자리 없는 표식은 건너뛴다', () => {
    const vh = window.innerHeight;
    const a = mountAnchor(vh - 52, 52);
    mountAnchor(0, 0, 'row');
    const bare = document.createElement('div');
    bare.setAttribute(UNDO_ANCHOR_ATTR, '');
    bare.getBoundingClientRect = () =>
      ({ top: vh - 200, bottom: vh - 150, left: 0, right: 400, width: 400, height: 50, x: 0, y: vh - 200, toJSON() {} }) as DOMRect;
    document.body.appendChild(bare);
    expect(pickUndoAnchor()!.slot).toBe(slotOf(a));
    bare.remove();
  });

  test('다른 요소(FloatView 등)에 가려진 막대는 건너뛴다', () => {
    const vh = window.innerHeight;
    const bottomBar = mountAnchor(vh - 52, 52);
    const covered = mountAnchor(vh - 104, 52, 'row');
    const cover = document.createElement('div');
    document.body.appendChild(cover);
    (document as any).elementFromPoint = (_x: number, y: number) =>
      y < vh - 52 ? cover : bottomBar;
    expect(pickUndoAnchor()!.slot).toBe(slotOf(bottomBar));
    expect(covered.isConnected).toBe(true);
    cover.remove();
  });

  test('막대가 모두 없으면 null', () => {
    expect(pickUndoAnchor()).toBeNull();
  });
});

// 가림 판정(2026-11-03 실기 보고: 확인 창·드로어가 뜨면 바가 화면 바닥으로 떨어짐) — 점을 덮은 요소가 속한 가장 바깥
// 쌓임 층의 z 가 바 층(--z-widget 1000) 이상이면 바도 함께 덮는 오버레이라 가림으로 치지 않는다. FloatView(100)는 가림.
describe('가림 판정 — 바 층 이상 오버레이는 무시, FloatView 는 가림', () => {
  const origEfp = document.elementFromPoint;
  const origEfps = (document as any).elementsFromPoint;
  const extras: HTMLElement[] = [];
  /** position·z-index 를 인라인으로 준 층 요소(+ 점에 잡힐 안쪽 자식) */
  const layer = (position: string, z: number, parent: HTMLElement = document.body) => {
    const el = document.createElement('div');
    el.style.position = position;
    el.style.zIndex = String(z);
    const inner = document.createElement('div');
    el.appendChild(inner);
    parent.appendChild(el);
    if (parent === document.body) extras.push(el);
    return { el, inner };
  };
  afterEach(() => {
    (document as any).elementFromPoint = origEfp;
    (document as any).elementsFromPoint = origEfps;
    act(() => root.unmount());
    root = createRoot(container);
    anchorRoots.splice(0).forEach(({ root: r, host }) => {
      act(() => r.unmount());
      host.remove();
    });
    extras.splice(0).forEach((el) => el.remove());
  });

  test('확인 창(5100)·드로어(2100)·모달(2000)·토스트(5000)·바 층(1000)이 점을 덮어도 하단 바에 그대로 붙는다', () => {
    const vh = window.innerHeight;
    const bottomBar = mountAnchor(vh - 52, 52, 'bar');
    for (const z of [5100, 2100, 2000, 5000, 1000]) {
      const overlay = layer('fixed', z);
      (document as any).elementFromPoint = () => overlay.inner;
      expect(pickUndoAnchor()?.slot).toBe(slotOf(bottomBar));
      overlay.el.remove();
    }
    // 렌더해도 대체 위치(fixed)로 떨어지지 않고 막대 자리 안
    const confirm = layer('fixed', 5100);
    (document as any).elementFromPoint = () => confirm.inner;
    render();
    expect(bar()!.parentElement).toBe(slotOf(bottomBar));
    expect(bar()!.className.split(' ')).not.toContain('fixed');
    expect(topVar()).toBe(`${52 - 1 + 36}px`);
  });

  test('FloatView(z 100)가 하단 바를 덮으면 하단 바는 탈락하고 FloatView 안 V2 메인 줄을 고른다', () => {
    const vh = window.innerHeight;
    const bottomBar = mountAnchor(vh - 52, 52, 'bar');
    const floatView = layer('absolute', 100);
    floatView.el.className = 'float-view';
    // 편집 창 탭 바가 하단 바보다 낮게(위 모서리가 아래) — 하단 바가 보였다면 하단 바가 뽑혔을 배치
    const row = mountAnchor(vh - 40, 40, 'row', 1, floatView.el);
    (document as any).elementFromPoint = (_x: number, y: number) =>
      y >= vh - 40 ? row : floatView.inner;
    expect(pickUndoAnchor()!.slot).toBe(slotOf(row));
    // 편집 창 탭 바가 없으면(하단 줄 없는 창) 보이는 막대 없음 → null(화면 아래 대체 위치)
    (document as any).elementFromPoint = () => floatView.inner;
    act(() => anchorRoots.pop()!.root.unmount());
    expect(pickUndoAnchor()).toBeNull();
    expect(bottomBar.isConnected).toBe(true);
  });

  test('가장 바깥 층으로 판정 — FloatView(100) 안에 뜬 z 2000 모달은 바 층 아래라 가림', () => {
    const vh = window.innerHeight;
    mountAnchor(vh - 52, 52, 'bar');
    const floatView = layer('absolute', 100);
    const innerModal = layer('fixed', 2000, floatView.el);
    (document as any).elementFromPoint = () => innerModal.inner;
    expect(pickUndoAnchor()).toBeNull();
  });

  test('elementsFromPoint: 드로어(2100) 아래를 보고 FloatView 가 덮은 하단 바는 탈락, 편집 창 줄은 유지', () => {
    const vh = window.innerHeight;
    const bottomBar = mountAnchor(vh - 52, 52, 'bar');
    const floatView = layer('absolute', 100);
    const row = mountAnchor(vh - 40, 40, 'row', 1, floatView.el);
    const drawer = layer('fixed', 2100);
    (document as any).elementFromPoint = () => drawer.inner;
    (document as any).elementsFromPoint = (_x: number, y: number) =>
      y >= vh - 40
        ? [drawer.inner, drawer.el, row, floatView.el, document.body]
        : [drawer.inner, drawer.el, floatView.inner, floatView.el, bottomBar, document.body];
    expect(pickUndoAnchor()!.slot).toBe(slotOf(row));
    // FloatView 가 닫히면(점 아래가 곧 하단 바) 드로어가 떠 있어도 하단 바
    act(() => anchorRoots.pop()!.root.unmount());
    (document as any).elementsFromPoint = () => [drawer.inner, drawer.el, bottomBar, document.body];
    expect(pickUndoAnchor()!.slot).toBe(slotOf(bottomBar));
  });

  test('일반 흐름 요소(z 없음)·바 층 아래 백드롭(z 10)은 가림', () => {
    const vh = window.innerHeight;
    mountAnchor(vh - 52, 52, 'bar');
    const plain = document.createElement('div');
    document.body.appendChild(plain);
    extras.push(plain);
    (document as any).elementFromPoint = () => plain;
    expect(pickUndoAnchor()).toBeNull();
    const backdrop = layer('fixed', 10);
    (document as any).elementFromPoint = () => backdrop.inner;
    expect(pickUndoAnchor()).toBeNull();
  });
});

describe('⋯ 메뉴 임시 버튼 제거(U6) · 퀵 메뉴 유지', () => {
  test('씬 툴바 레지스트리·portable 풀에 undo/redo 가 없다', () => {
    const ids = sceneToolbarRegistry.map((b) => b.id);
    expect(ids).not.toContain('undo');
    expect(ids).not.toContain('redo');
    expect(portableButtonIds()).not.toContain('undo');
  });

  test('저장된 배치에 남은 undo/redo id 는 조용히 무시된다', () => {
    const r = resolveToolbarView(
      TOOLBAR_VIEW_MAIN,
      {
        buttons: { undo: 'pinned' },
        areas: { scene: { inline: ['undo', 'add-scene'], menu: ['redo'], hidden: [] } },
      } as any,
      false,
    );
    const all = r.flatMap((a) => [...a.inline, ...a.menu]);
    expect(all).not.toContain('undo');
    expect(all).not.toContain('redo');
    expect(all).toContain('add-scene');
  });

  test('퀵 메뉴 GLOBAL_ACTIONS 의 undo/redo 는 남고 이름도 그대로', () => {
    expect(globalActionById('undo')).toBeDefined();
    expect(globalActionById('redo')).toBeDefined();
    expect(globalActionMeta('undo')?.name).toBe('되돌리기');
    expect(globalActionMeta('redo')?.name).toBe('다시 실행');
    expect(resolveQuickMenu(['undo', 'redo'], true).map((a) => a.id)).toEqual(['undo', 'redo']);
  });
});

describe('단축키 도움말 전역 항목', () => {
  test('씬·이미지 그리드 도움말에 되돌리기 Ctrl+Z·다시 실행 Ctrl+Y', () => {
    for (const scope of ['scene', 'image-grid'] as const) {
      act(() => root.render(<ShortcutCheatsheet scope={scope} onClose={() => {}} />));
      const section = container.querySelector('[data-shortcut-section="global"]');
      expect(section).not.toBeNull();
      expect(container.textContent).toContain('되돌리기');
      expect(container.textContent).toContain('Ctrl+Z');
      expect(container.textContent).toContain('다시 실행');
      expect(container.textContent).toContain('Ctrl+Y');
    }
  });

  test('월드컵 도움말에는 넣지 않는다(되돌리기 허용 창 아님)', () => {
    act(() => root.render(<ShortcutCheatsheet scope="tournament" onClose={() => {}} />));
    expect(container.querySelector('[data-shortcut-section="global"]')).toBeNull();
  });
});
