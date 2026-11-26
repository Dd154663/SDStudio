// 히스토리 확대(2026-11-26, 1~2단계) — 순수 규칙(스와이프·썸네일→원본·거르기·크기·세로 높이·보기 방식 기억)과
// 뷰어가 받은 목록 안에서만 넘기는지, 크게 보기 창(거르기·빈 상태·칸 누름), Android 뒤로 가기 닫힘 순서.
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { observable, runInAction } from 'mobx';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// 닫기 스택 흉내 — push 순서대로 쌓이고, 뒤로 가기는 맨 위만 닫는다(BackStackService 와 같은 규칙)
const mockStack: { id: number; onClose: () => void }[] = [];
let mockStackId = 0;
const mockPush = (onClose: () => void) => {
  const layer = { id: ++mockStackId, onClose };
  mockStack.push(layer);
  return {
    remove: () => {
      const i = mockStack.indexOf(layer);
      if (i >= 0) mockStack.splice(i, 1);
    },
  };
};
const mockBack = () => mockStack[mockStack.length - 1]?.onClose();
jest.mock('../BackStackService', () => {
  const R = jest.requireActual('react');
  return {
    backStackService: { push: (fn: () => void) => mockPush(fn) },
    useBackLayer: (active: boolean, onClose: () => void) => {
      const ref = R.useRef(onClose);
      ref.current = onClose;
      R.useEffect(() => {
        if (!active) return undefined;
        const h = mockPush(() => ref.current());
        return () => h.remove();
      }, [active]);
    },
  };
});

// FloatView 흉내 — 마운트 때 닫기 스택에 올리고 머리줄 자리는 없음(헤더는 본문 안에 그려진다)
jest.mock('../../componenets/FloatView', () => {
  const R = jest.requireActual('react');
  return {
    FloatView: ({ children, onEscape }: any) => {
      const ref = R.useRef(onEscape);
      ref.current = onEscape;
      R.useEffect(() => {
        const h = mockPush(() => ref.current?.());
        return () => h.remove();
      }, []);
      return R.createElement('div', { 'data-mock-float-view': '' }, children);
    },
    useFloatViewHeaderSlot: () => null,
  };
});

const mockScenes: Record<string, any> = {
  p1: observable({ mains: [] as string[], resolution: 'portrait' }),
  p2: observable({ mains: [] as string[], resolution: 'landscape' }),
};
const mockHistory = observable({ entries: [] as any[] });
let mockResolveDelay: Promise<void> | null = null;
const mockSvc = {
  get entries() {
    return mockHistory.entries;
  },
  remove: jest.fn((id: string) =>
    runInAction(() => {
      mockHistory.entries = mockHistory.entries.filter((e: any) => e.id !== id);
    }),
  ),
  resolveQuiet: jest.fn(async (e: any) => {
    if (mockResolveDelay) await mockResolveDelay;
    return { session: {}, scene: mockScenes[e.sessionName] };
  }),
  toggleFavorite: jest.fn(async () => {}),
  navigateTo: jest.fn(async () => {}),
};
const mockFetchImage = jest.fn(async (p: string) => `data:full,${p}`);
const mockFetchSmall = jest.fn(async (p: string, size: number) => `data:small${size},${p}`);
jest.mock('../index', () => ({
  imageHistoryService: mockSvc,
  imageService: {
    fetchImage: (p: string) => mockFetchImage(p),
    fetchImageSmall: (p: string, s: number) => mockFetchSmall(p, s),
  },
  isMobile: false,
}));
jest.mock('../AppService', () => ({
  appState: {
    pushMessage: jest.fn(),
    dialogs: [],
    curSession: { name: 'p1' },
    historyColumns: 2,
    historyDrawerOpen: false,
  },
}));
jest.mock('../../componenets/Tooltip', () => ({ __esModule: true, default: ({ children }: any) => children }));
jest.mock('../../componenets/ToolbarDnd', () => ({ toolbarDragUi: { armed: null } }));
jest.mock('../layoutTemplates', () => ({ resolveLayout: () => ({ historySide: 'right' }) }));

import { horizontalSwipeStep, SWIPE_MIN_PX } from '../swipeNav';
import { progressiveImageReducer, initialProgressiveImageState } from '../progressiveImage';
import {
  filterHistoryEntries,
  historyViewCountText,
  historyViewEmptyText,
  historyViewMobileCell,
  historyViewPcCell,
  historyViewState,
  openHistoryView,
  closeHistoryView,
  HISTORY_VIEW_TEXT,
} from '../historyView';
import {
  adjustScrollForResize,
  AspectMemo,
  containBox,
  DEFAULT_HISTORY_ASPECT,
  historyItemAspect,
  historyListRowHeight,
  indexAtOffset,
  itemTopOf,
  scrollItemHeight,
  SCROLL_ITEM_CHROME,
  wantsFullInScroll,
  aspectFromSize,
} from '../historyLayout';
import {
  closeHistoryPreview,
  historyPreviewFallbackId,
  historyPreviewList,
  historyPreviewState,
  openHistoryPreview,
  readHistoryViewerMode,
  setHistoryViewerMode,
  writeHistoryViewerMode,
  HISTORY_VIEWER_MODE_STORAGE_KEY,
} from '../historyPreview';
import { HistoryImagePreview } from '../../componenets/HistoryImagePreview';
import { HistoryView } from '../../componenets/HistoryView';

const entry = (id: string, sessionName = 'p1', sceneName = 's-' + id) => ({
  id,
  path: id,
  filename: id.split('/').pop(),
  sessionName,
  sceneName,
  sceneType: 'scene',
  createdAt: 0,
});

describe('순수 규칙 — 스와이프', () => {
  test('50px 이상·가로가 세로의 1.5배 이상일 때만, 왼쪽 = 다음', () => {
    expect(horizontalSwipeStep(-SWIPE_MIN_PX, 0)).toBe(1);
    expect(horizontalSwipeStep(SWIPE_MIN_PX, 0)).toBe(-1);
    expect(horizontalSwipeStep(-49, 0)).toBe(0);
    expect(horizontalSwipeStep(-60, 40)).toBe(1); // 60 >= 40*1.5
    expect(horizontalSwipeStep(-60, 41)).toBe(0);
    expect(horizontalSwipeStep(0, 200)).toBe(0);
    expect(horizontalSwipeStep(NaN, 0)).toBe(0);
  });
});

describe('순수 규칙 — 썸네일 먼저, 원본으로 바꿔 끼우기', () => {
  const r = progressiveImageReducer;
  test('썸네일 → 원본, 원본 뒤에 온 썸네일은 무시', () => {
    let s = r(initialProgressiveImageState, { type: 'start', key: 1 });
    expect(s.stage).toBe('loading');
    s = r(s, { type: 'thumb', key: 1, src: 't' });
    expect(s).toEqual({ key: 1, stage: 'thumb', src: 't' });
    s = r(s, { type: 'full', key: 1, src: 'f' });
    expect(s.src).toBe('f');
    expect(r(s, { type: 'thumb', key: 1, src: 't2' }).src).toBe('f');
  });
  test('늦게 도착한 이전 장의 응답은 지금 장을 덮지 않는다', () => {
    let s = r(initialProgressiveImageState, { type: 'start', key: 1 });
    s = r(s, { type: 'start', key: 2 });
    expect(r(s, { type: 'full', key: 1, src: 'old' })).toBe(s);
    expect(r(s, { type: 'thumb', key: 1, src: 'old' })).toBe(s);
    expect(r(s, { type: 'missing', key: 1 })).toBe(s);
    expect(r(s, { type: 'start', key: 1 })).toBe(s); // 뒤처진 시작
  });
  test('원본 실패여도 썸네일은 남고, 파일 없음은 missing', () => {
    let s = r(r(initialProgressiveImageState, { type: 'start', key: 1 }), { type: 'thumb', key: 1, src: 't' });
    expect(r(s, { type: 'fail', key: 1 }).src).toBe('t');
    expect(r(s, { type: 'missing', key: 1 }).stage).toBe('missing');
    s = r(initialProgressiveImageState, { type: 'start', key: 3 });
    expect(r(s, { type: 'fail', key: 3 }).stage).toBe('error');
  });
});

describe('순수 규칙 — 크게 보기 거르기·문구·칸 크기', () => {
  const list = [entry('a', 'p1'), entry('b', 'p2'), entry('c', 'p1'), entry('d', 'p2')];
  const favs: Record<string, boolean | undefined> = { a: true, b: true, c: false, d: undefined };
  const isFav = (e: any) => favs[e.id];
  test('거르기 없음 = 전부', () => {
    const r = filterHistoryEntries(list, { favoritesOnly: false, currentProjectOnly: false }, 'p1', isFav);
    expect(r.items.map((e) => e.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(r.pending).toBe(0);
  });
  test('즐겨찾기만 — 판정 전 항목은 빼고 pending 으로 센다', () => {
    const r = filterHistoryEntries(list, { favoritesOnly: true, currentProjectOnly: false }, 'p1', isFav);
    expect(r.items.map((e) => e.id)).toEqual(['a', 'b']);
    expect(r.pending).toBe(1);
  });
  test('이 프로젝트만 / 둘 다 / 연 프로젝트 없음', () => {
    expect(
      filterHistoryEntries(list, { favoritesOnly: false, currentProjectOnly: true }, 'p1', isFav).items.map((e) => e.id),
    ).toEqual(['a', 'c']);
    const both = filterHistoryEntries(list, { favoritesOnly: true, currentProjectOnly: true }, 'p1', isFav);
    expect(both.items.map((e) => e.id)).toEqual(['a']);
    expect(both.pending).toBe(0); // 다른 프로젝트 항목은 판정할 필요 없음
    expect(filterHistoryEntries(list, { favoritesOnly: false, currentProjectOnly: true }, undefined, isFav).items).toEqual([]);
  });
  test('장수·빈 상태 문구', () => {
    expect(historyViewCountText(3, 200)).toBe('3 / 200장');
    expect(historyViewEmptyText(0, 0, 0)).toBe(HISTORY_VIEW_TEXT.emptyAll);
    expect(historyViewEmptyText(10, 0, 3)).toBe(HISTORY_VIEW_TEXT.checking);
    expect(historyViewEmptyText(10, 0, 0)).toBe(HISTORY_VIEW_TEXT.emptyFiltered);
    expect(historyViewEmptyText(10, 2, 3)).toBeNull();
  });
  test('칸 크기 — 썸네일은 단계 값만, 모바일은 400 까지', () => {
    expect(historyViewMobileCell(0, 400)).toEqual({ cell: 80, thumb: 200 });
    expect(historyViewMobileCell(1, 400)).toEqual({ cell: 160, thumb: 400 });
    expect(historyViewMobileCell(2, 400)).toEqual({ cell: 390, thumb: 400 });
    for (const p of [0, 25, 50, 60, 75, 100]) {
      expect([200, 400, 500]).toContain(historyViewPcCell(p).thumb);
    }
    expect(historyViewPcCell(50)).toEqual({ cell: 400, thumb: 400 });
  });
});

describe('순수 규칙 — 높이 추정·보정', () => {
  test('비율: 잰 값 → 씬 해상도 → 3:4', () => {
    expect(historyItemAspect(1.5, 0.5)).toBe(1.5);
    expect(historyItemAspect(undefined, 0.5)).toBe(0.5);
    expect(historyItemAspect()).toBe(DEFAULT_HISTORY_ASPECT);
    expect(historyItemAspect(0, NaN)).toBe(DEFAULT_HISTORY_ASPECT);
    expect(aspectFromSize(832, 1216)).toBeCloseTo(832 / 1216);
    expect(aspectFromSize(0, 0)).toBeUndefined();
  });
  test('세로 보기 장 높이 = 폭/비율 + 아래 줄', () => {
    expect(scrollItemHeight(300, 0.75)).toBe(400 + SCROLL_ITEM_CHROME);
  });
  test('위쪽 장이 커지면 스크롤을 그만큼 내리고, 아래쪽 장이면 그대로', () => {
    expect(adjustScrollForResize(1000, 200, 400, 600)).toBe(1200);
    expect(adjustScrollForResize(1000, 1000, 400, 600)).toBe(1000);
    expect(adjustScrollForResize(1000, 1500, 400, 600)).toBe(1000);
    expect(adjustScrollForResize(100, 0, 400, 100)).toBe(0); // 0 아래로 가지 않음
  });
  test('위치 ↔ 장 번호', () => {
    const h = (i: number) => [100, 200, 300][i];
    expect(itemTopOf(h, 2)).toBe(300);
    expect(indexAtOffset(h, 3, 0)).toBe(0);
    expect(indexAtOffset(h, 3, 299)).toBe(1);
    expect(indexAtOffset(h, 3, 300)).toBe(2);
    expect(indexAtOffset(h, 3, 9999)).toBe(2);
    expect(indexAtOffset(h, 0, 0)).toBe(-1);
  });
  test('원본은 지금 장과 위아래 한 장만', () => {
    expect([3, 4, 5, 6, 7].map((i) => wantsFullInScroll(i, 5))).toEqual([false, true, true, true, false]);
  });
  test('패널 줄 높이 = 그 줄에서 가장 높은 칸 + 이름 줄 + 칸 사이', () => {
    expect(historyListRowHeight(100, [1, 0.5])).toBe(200 + 20 + 6);
  });
  test('비율 기억은 오래된 것부터 지운다', () => {
    const m = new AspectMemo(2);
    m.set('a', 1);
    m.set('b', 1);
    m.set('c', 1);
    expect(m.get('a')).toBeUndefined();
    expect(m.size).toBe(2);
    m.set('x', NaN);
    expect(m.get('x')).toBeUndefined();
  });
  test('한 장씩: 영역에 담는 크기(원본보다 키우지 않음)', () => {
    expect(containBox(1000, 500, 1)).toEqual({ width: 500, height: 500 });
    expect(containBox(400, 1000, 0.5)).toEqual({ width: 400, height: 800 });
    expect(containBox(1000, 1000, 1, { width: 300, height: 300 })).toEqual({ width: 300, height: 300 });
    expect(containBox(0, 0, 1)).toBeUndefined();
  });
});

describe('순수 규칙 — 뷰어 목록·보기 방식 기억', () => {
  test('scopeIds 순서대로, 히스토리에서 빠진 것은 뺀다 / null = 전체', () => {
    const all = [entry('a'), entry('b'), entry('c')];
    expect(historyPreviewList(all, null)).toBe(all);
    expect(historyPreviewList(all, ['c', 'x', 'a']).map((e) => e.id)).toEqual(['c', 'a']);
  });
  test('보던 장이 빠지면 같은 자리(없으면 마지막)', () => {
    const l = [{ id: 'a' }, { id: 'b' }];
    expect(historyPreviewFallbackId(l, 1)).toBe('b');
    expect(historyPreviewFallbackId(l, 5)).toBe('b');
    expect(historyPreviewFallbackId([], 0)).toBeNull();
  });
  test('보기 방식 읽기·쓰기 — 모르는 값·실패는 한 장씩', () => {
    const store: Record<string, string> = {};
    const s = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => (store[k] = v) };
    expect(readHistoryViewerMode(s)).toBe('single');
    writeHistoryViewerMode(s, 'scroll');
    expect(store[HISTORY_VIEWER_MODE_STORAGE_KEY]).toBe('scroll');
    expect(readHistoryViewerMode(s)).toBe('scroll');
    store[HISTORY_VIEWER_MODE_STORAGE_KEY] = 'weird';
    expect(readHistoryViewerMode(s)).toBe('single');
    expect(readHistoryViewerMode({ getItem: () => { throw new Error('x'); }, setItem: () => {} })).toBe('single');
    expect(readHistoryViewerMode(undefined)).toBe('single');
  });
  test('setHistoryViewerMode 는 localStorage 에 기억한다', () => {
    setHistoryViewerMode('scroll');
    expect(localStorage.getItem('sdstudio-history-viewer-mode')).toBe('scroll');
    setHistoryViewerMode('single');
    expect(localStorage.getItem('sdstudio-history-viewer-mode')).toBe('single');
  });
});

// ===== 화면 =====

let container: HTMLDivElement;
let root: Root;
const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
};
const q = (sel: string) => container.querySelector(sel) as HTMLElement | null;
const btn = (label: string) => container.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null;
const click = (el: Element | null) =>
  act(() => {
    (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
const touch = (el: Element, type: 'touchstart' | 'touchend', x: number, y: number) => {
  const ev = new Event(type, { bubbles: true }) as any;
  const t = [{ clientX: x, clientY: y }];
  ev.touches = type === 'touchstart' ? t : [];
  ev.changedTouches = t;
  act(() => {
    el.dispatchEvent(ev);
  });
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  runInAction(() => {
    mockHistory.entries = [entry('outs/a.png'), entry('outs/b.png', 'p2'), entry('outs/c.png'), entry('outs/d.png', 'p2')];
    mockScenes.p1.mains.splice(0);
    mockScenes.p2.mains.splice(0);
  });
  mockResolveDelay = null;
  closeHistoryPreview();
  closeHistoryView();
  setHistoryViewerMode('single');
  mockStack.length = 0;
  jest.clearAllMocks();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('뷰어 — 받은 목록 안에서만 넘긴다', () => {
  const mount = async () => {
    act(() => root.render(<HistoryImagePreview />));
    await flush();
  };

  test('패널에서 열면 히스토리 전체', async () => {
    await mount();
    act(() => openHistoryPreview('outs/c.png'));
    await flush();
    click(btn('다음 이미지'));
    expect(historyPreviewState.entryId).toBe('outs/d.png');
    expect(q('[data-history-preview-position]')!.textContent).toBe('4 / 4');
  });

  test('크게 보기에서 열면 거른 목록 — 그 밖의 장으로는 가지 않는다', async () => {
    await mount();
    act(() => openHistoryPreview('outs/a.png', ['outs/a.png', 'outs/c.png']));
    await flush();
    expect(q('[data-history-preview-position]')!.textContent).toBe('1 / 2');
    click(btn('다음 이미지'));
    expect(historyPreviewState.entryId).toBe('outs/c.png'); // b 를 건너뜀
    expect(btn('다음 이미지')!.disabled).toBe(true);
    // 새 이미지가 히스토리에 들어와도 보던 장·목록은 그대로
    act(() =>
      runInAction(() => {
        mockHistory.entries = [entry('outs/new.png'), ...mockHistory.entries];
      }),
    );
    await flush();
    expect(historyPreviewState.entryId).toBe('outs/c.png');
    expect(q('[data-history-preview-position]')!.textContent).toBe('2 / 2');
  });

  test('패널 목록으로 열었을 때 새 이미지가 들어와도 보던 장 유지', async () => {
    await mount();
    act(() => openHistoryPreview('outs/b.png'));
    await flush();
    act(() =>
      runInAction(() => {
        mockHistory.entries = [entry('outs/new.png'), ...mockHistory.entries];
      }),
    );
    await flush();
    expect(historyPreviewState.entryId).toBe('outs/b.png');
    expect(q('img')!.getAttribute('src')).toBe('data:full,outs/b.png');
  });

  test('좌우 스와이프 — 판정 경계, 움직임 없이 바로 바뀜, 가장자리 제스처 양보 표식', async () => {
    await mount();
    act(() => openHistoryPreview('outs/b.png'));
    await flush();
    const area = q('[data-history-preview-area]')!;
    expect(area.hasAttribute('data-edge-swipe-ignore')).toBe(true);
    touch(area, 'touchstart', 300, 300);
    touch(area, 'touchend', 260, 300); // 40px — 안 넘어감
    expect(historyPreviewState.entryId).toBe('outs/b.png');
    touch(area, 'touchstart', 300, 300);
    touch(area, 'touchend', 240, 300); // 왼쪽 60px = 다음
    expect(historyPreviewState.entryId).toBe('outs/c.png');
    touch(area, 'touchstart', 300, 300);
    touch(area, 'touchend', 360, 300); // 오른쪽 = 이전
    expect(historyPreviewState.entryId).toBe('outs/b.png');
    touch(area, 'touchstart', 300, 300);
    touch(area, 'touchend', 240, 400); // 세로 우세 — 안 넘어감
    expect(historyPreviewState.entryId).toBe('outs/b.png');
    expect(q('[data-history-preview]')!.className).not.toMatch(/transition|animate/);
  });

  test('썸네일 먼저 → 원본, 늦게 온 이전 장의 원본은 지금 장을 덮지 않는다', async () => {
    let releaseA: (v: string) => void = () => {};
    mockFetchImage.mockImplementationOnce(
      () => new Promise<string>((res) => (releaseA = res)), // a 의 원본은 늦게 온다
    );
    await mount();
    act(() => openHistoryPreview('outs/a.png'));
    await flush();
    expect(mockFetchSmall).toHaveBeenCalledWith('outs/a.png', 400);
    expect(q('img')!.getAttribute('src')).toBe('data:small400,outs/a.png');
    expect(q('img')!.getAttribute('data-history-preview-stage')).toBe('thumb');
    click(btn('다음 이미지'));
    await flush();
    expect(q('img')!.getAttribute('src')).toBe('data:full,outs/b.png');
    await act(async () => {
      releaseA('data:full,outs/a.png');
      await Promise.resolve();
    });
    await flush();
    expect(q('img')!.getAttribute('src')).toBe('data:full,outs/b.png');
  });

  test('이웃 장 썸네일을 미리 읽는다', async () => {
    await mount();
    act(() => openHistoryPreview('outs/b.png'));
    await flush();
    const asked = mockFetchSmall.mock.calls.map((c) => c[0]);
    expect(asked).toEqual(expect.arrayContaining(['outs/a.png', 'outs/c.png']));
  });

  test('보기 방식 전환 — 세로로 이어 보기는 장마다 순번·별, 기억된다', async () => {
    await mount();
    act(() => openHistoryPreview('outs/a.png'));
    await flush();
    const sw = q('[data-history-viewer-mode-switch]')!;
    expect(sw.className).toContain('seg-group');
    expect(sw.className).toContain('seg-sm');
    click(sw.querySelector('[data-mode="scroll"]'));
    await flush();
    expect(historyPreviewState.mode).toBe('scroll');
    expect(localStorage.getItem('sdstudio-history-viewer-mode')).toBe('scroll');
    expect(q('[data-history-viewer-mode]')!.getAttribute('data-history-viewer-mode')).toBe('scroll');
    const items = container.querySelectorAll('[data-history-scroll-item]');
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(4);
    expect(container.textContent).toContain('1 / 4');
    expect(container.querySelectorAll('[data-history-scroll-fav]').length).toBe(items.length);
    // 지금 장(0)과 바로 아래 장만 원본 — 나머지는 썸네일만
    const fullAsked = mockFetchImage.mock.calls.map((c) => c[0]);
    expect(fullAsked).not.toContain('outs/d.png');
    click(sw.querySelector('[data-mode="single"]'));
    await flush();
    expect(q('[data-history-preview-area]')).not.toBeNull();
  });
});

describe('크게 보기 창', () => {
  const mount = async () => {
    act(() => root.render(<><HistoryView /><HistoryImagePreview /></>));
    await flush();
  };

  test('닫혀 있으면 그리지 않는다, 열면 제목·장수·거르기 두 개(꺼짐)', async () => {
    await mount();
    expect(q('[data-history-view]')).toBeNull();
    act(() => openHistoryView());
    await flush();
    expect(container.textContent).toContain('히스토리');
    expect(q('[data-history-view-count]')!.textContent).toBe('4 / 4장');
    const fav = q('[data-history-filter="favorites"]')!;
    const proj = q('[data-history-filter="project"]')!;
    expect(fav.textContent).toBe('즐겨찾기만');
    expect(proj.textContent).toBe('이 프로젝트만');
    expect(fav.getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelectorAll('[data-history-cell]').length).toBe(4);
  });

  test('이 프로젝트만 → 칸을 누르면 뷰어가 거른 목록으로 열린다', async () => {
    await mount();
    act(() => openHistoryView());
    await flush();
    const proj = q('[data-history-filter="project"]')!;
    click(proj);
    await flush();
    expect(proj.getAttribute('aria-pressed')).toBe('true');
    expect(proj.className).toContain('toggle-on');
    expect(q('[data-history-view-count]')!.textContent).toBe('2 / 4장');
    const cells = container.querySelectorAll('[data-history-cell]');
    expect(cells.length).toBe(2);
    click(cells[0]);
    expect(historyPreviewState.entryId).toBe('outs/a.png');
    expect(historyPreviewState.scopeIds).toEqual(['outs/a.png', 'outs/c.png']);
  });

  test('즐겨찾기만 — 판정 중에는 비어 보이지 않고, 끝나면 즐겨찾기만 남는다', async () => {
    runInAction(() => {
      mockScenes.p1.mains.push('c.png');
      mockScenes.p2.mains.push('b.png');
    });
    let release: () => void = () => {};
    mockResolveDelay = new Promise<void>((r) => (release = r));
    await mount();
    act(() => openHistoryView());
    await flush();
    click(q('[data-history-filter="favorites"]'));
    await flush();
    expect(container.textContent).toContain(HISTORY_VIEW_TEXT.checking);
    await act(async () => {
      release();
      mockResolveDelay = null;
    });
    await flush();
    expect(q('[data-history-view-count]')!.textContent).toBe('2 / 4장');
    // 즐겨찾기를 풀면 바로 다시 거른다(mobx)
    act(() => {
      runInAction(() => mockScenes.p1.mains.splice(0));
    });
    await flush();
    expect(q('[data-history-view-count]')!.textContent).toBe('1 / 4장');
    // 둘 다 켜면 둘 다 만족 — p1 의 즐겨찾기 없음
    click(q('[data-history-filter="project"]'));
    await flush();
    expect(container.textContent).toContain(HISTORY_VIEW_TEXT.emptyFiltered);
  });

  test('히스토리가 비었으면 빈 상태 문구', async () => {
    runInAction(() => {
      mockHistory.entries = [];
    });
    await mount();
    act(() => openHistoryView());
    await flush();
    expect(container.textContent).toContain(HISTORY_VIEW_TEXT.emptyAll);
  });

  test('Android 뒤로 가기: 뷰어 → 크게 보기 순으로 닫힘', async () => {
    await mount();
    act(() => openHistoryView());
    await flush();
    click(container.querySelectorAll('[data-history-cell]')[1]);
    await flush();
    expect(historyPreviewState.entryId).toBe('outs/b.png');
    expect(mockStack).toHaveLength(2);
    act(() => mockBack());
    await flush();
    expect(historyPreviewState.entryId).toBeNull();
    expect(historyViewState.open).toBe(true);
    act(() => mockBack());
    await flush();
    expect(historyViewState.open).toBe(false);
    expect(mockStack).toHaveLength(0);
  });

  test('떠 있는 동안 아래 화면 단축키는 되돌리기·다시 실행만 통과(미리 보기와 같은 관문)', () => {
    const src = jest.requireActual('fs').readFileSync(
      jest.requireActual('path').resolve(__dirname, '../KeyboardShortcutService.ts'),
      'utf8',
    );
    expect(src).toContain('historyPreviewOpen: historyPreviewState.entryId !== null || historyViewState.open');
  });
});
