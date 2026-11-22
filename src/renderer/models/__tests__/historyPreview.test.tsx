// 히스토리 큰 미리 보기(2026-11-22) — 칸 누름 = 미리 보기, 즐겨찾기 = 칸 구석 별 버튼(전파 차단),
// 미리 보기의 이전/다음·즐겨찾기·「이미지 그리드에서 보기」·닫기(Esc/뒤로 가기 층)·파일 없음 처리.
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import * as fs from 'fs';
import * as path from 'path';
import { observable, runInAction } from 'mobx';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const mockLayers: { onClose: () => void }[] = [];
jest.mock('../BackStackService', () => {
  const R = jest.requireActual('react');
  return {
    backStackService: { push: () => ({ remove: () => {} }) },
    useBackLayer: (active: boolean, onClose: () => void) => {
      R.useEffect(() => {
        if (!active) return undefined;
        const layer = { onClose };
        mockLayers.push(layer);
        return () => {
          const i = mockLayers.indexOf(layer);
          if (i >= 0) mockLayers.splice(i, 1);
        };
      }, [active]);
    },
  };
});

const mockScene = observable({ mains: [] as string[] });
const mockHistory = observable({
  entries: [] as any[],
});
const mockSvc = {
  get entries() {
    return mockHistory.entries;
  },
  remove: jest.fn((id: string) =>
    runInAction(() => {
      mockHistory.entries = mockHistory.entries.filter((e: any) => e.id !== id);
    }),
  ),
  resolveQuiet: jest.fn(async () => ({ session: {}, scene: mockScene })),
  toggleFavorite: jest.fn(async (entry: any) =>
    runInAction(() => {
      const i = mockScene.mains.indexOf(entry.filename);
      if (i >= 0) mockScene.mains.splice(i, 1);
      else mockScene.mains.push(entry.filename);
    }),
  ),
  navigateTo: jest.fn(async () => {}),
};
const mockFetchImage = jest.fn(async (p: string) => (p.includes('gone') ? null : `data:image/png;base64,${p}`));
const mockFetchSmall = jest.fn(async (p: string) => `data:image/png;base64,small-${p}`);

jest.mock('../index', () => ({
  imageHistoryService: mockSvc,
  imageService: {
    fetchImage: (p: string) => mockFetchImage(p),
    fetchImageSmall: (p: string) => mockFetchSmall(p),
  },
  isMobile: false,
}));
const mockPushMessage = jest.fn();
jest.mock('../AppService', () => ({
  appState: {
    pushMessage: (...a: any[]) => mockPushMessage(...a),
    dialogs: [],
    curSession: { name: 'p1' },
    historyColumns: 2,
    historyPanelCollapsed: false,
    historyPanelWidth: 300,
    uiLayoutTemplate: 'default',
    uiLayoutSlots: {},
  },
}));
jest.mock('../layoutTemplates', () => ({ resolveLayout: () => ({ historySide: 'right' }) }));
jest.mock('../../componenets/Tooltip', () => ({ __esModule: true, default: ({ children }: any) => children }));
jest.mock('../../componenets/ToolbarDnd', () => ({ toolbarDragUi: { armed: null } }));
jest.mock('../edgeSwipe', () => ({
  EDGE_SWIPE_ZONE: 32,
  shouldIgnoreEdgeSwipeAt: () => false,
  canOpenDrawerBySwipe: () => false,
}));

import {
  closeHistoryPreview,
  historyEntryCaption,
  historyPreviewNeighbors,
  historyPreviewState,
  openHistoryPreview,
} from '../historyPreview';
import { HistoryImagePreview } from '../../componenets/HistoryImagePreview';
import { ImageHistoryPanel } from '../../componenets/ImageHistory';

const entry = (id: string, sessionName = 'p1', sceneName = 's-' + id) => ({
  id,
  path: id,
  filename: id.split('/').pop(),
  sessionName,
  sceneName,
  sceneType: 'scene',
  createdAt: 0,
});

let container: HTMLDivElement;
let root: Root;
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  runInAction(() => {
    mockHistory.entries = [entry('outs/a.png'), entry('outs/b.png', 'p2', '씬B'), entry('outs/c.png')];
    mockScene.mains.splice(0);
  });
  closeHistoryPreview();
  jest.clearAllMocks();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const q = (sel: string) => container.querySelector(sel) as HTMLElement | null;
const btn = (label: string) => container.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null;
const click = (el: Element | null) => act(() => (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })));

describe('순수 규칙', () => {
  test('이전/다음 = 목록 순서, 끝이면 null, 없는 id 는 둘 다 null', () => {
    const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as any;
    expect(historyPreviewNeighbors(list, 'a')).toEqual({ prev: null, next: 'b' });
    expect(historyPreviewNeighbors(list, 'b')).toEqual({ prev: 'a', next: 'c' });
    expect(historyPreviewNeighbors(list, 'c')).toEqual({ prev: 'b', next: null });
    expect(historyPreviewNeighbors(list, 'x')).toEqual({ prev: null, next: null });
    expect(historyPreviewNeighbors(list, null)).toEqual({ prev: null, next: null });
  });
  test('캡션: 다른 프로젝트면 프로젝트/씬, 같으면 씬', () => {
    expect(historyEntryCaption({ id: '1', sessionName: 'p2', sceneName: 's' }, 'p1')).toBe('p2/s');
    expect(historyEntryCaption({ id: '1', sessionName: 'p1', sceneName: 's' }, 'p1')).toBe('s');
    expect(historyEntryCaption({ id: '1', sessionName: 'p1', sceneName: 's' }, undefined)).toBe('p1/s');
  });
});

describe('미리 보기 창', () => {
  const mount = async () => {
    act(() => root.render(<HistoryImagePreview />));
    await flush();
  };

  test('닫힌 동안은 아무것도 그리지 않고 층도 올리지 않는다', async () => {
    await mount();
    expect(q('[data-history-preview]')).toBeNull();
    expect(mockLayers).toHaveLength(0);
  });

  test('열면 원본 이미지·캡션, 층 --z-modal-top, 등장 움직임 없음', async () => {
    await mount();
    act(() => openHistoryPreview('outs/b.png'));
    await flush();
    const overlay = q('[data-history-preview]')!;
    expect(overlay.style.zIndex).toBe('var(--z-modal-top)');
    expect(overlay.className).not.toMatch(/transition|animate|ui-pop-in/);
    expect(mockFetchImage).toHaveBeenCalledWith('outs/b.png');
    expect(q('img')!.getAttribute('src')).toBe('data:image/png;base64,outs/b.png');
    expect(container.textContent).toContain('p2/씬B'); // 다른 프로젝트 항목
    expect(mockLayers).toHaveLength(1);
  });

  test('이전/다음 버튼 — 끝에서는 비활성, 누르면 목록 순서대로 넘어간다', async () => {
    await mount();
    act(() => openHistoryPreview('outs/a.png'));
    await flush();
    expect(btn('이전 이미지')!.disabled).toBe(true);
    expect(btn('다음 이미지')!.disabled).toBe(false);
    click(btn('다음 이미지'));
    await flush();
    expect(historyPreviewState.entryId).toBe('outs/b.png');
    click(btn('다음 이미지'));
    await flush();
    expect(historyPreviewState.entryId).toBe('outs/c.png');
    expect(btn('다음 이미지')!.disabled).toBe(true);
  });

  test('별 버튼 = toggleFavorite 그대로, 상태가 바로 반영된다', async () => {
    await mount();
    act(() => openHistoryPreview('outs/a.png'));
    await flush();
    const fav = q('[data-history-preview-fav]')!;
    expect(fav.getAttribute('aria-pressed')).toBe('false');
    click(fav);
    await flush();
    expect(mockSvc.toggleFavorite).toHaveBeenCalledTimes(1);
    expect(mockSvc.toggleFavorite.mock.calls[0][0].id).toBe('outs/a.png');
    expect(q('[data-history-preview-fav]')!.getAttribute('aria-pressed')).toBe('true');
    expect(historyPreviewState.entryId).toBe('outs/a.png'); // 창은 그대로
  });

  test('「이미지 그리드에서 보기」 = navigateTo(openGrid) 후 닫힘', async () => {
    await mount();
    act(() => openHistoryPreview('outs/c.png'));
    await flush();
    const grid = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === '이미지 그리드에서 보기')!;
    click(grid);
    await flush();
    expect(mockSvc.navigateTo).toHaveBeenCalledWith(expect.objectContaining({ id: 'outs/c.png' }), { openGrid: true });
    expect(historyPreviewState.entryId).toBeNull();
  });

  test('닫기 버튼·Esc/뒤로 가기 층·바깥 어두운 영역', async () => {
    await mount();
    act(() => openHistoryPreview('outs/a.png'));
    await flush();
    click(btn('닫기'));
    expect(historyPreviewState.entryId).toBeNull();
    await flush();
    expect(mockLayers).toHaveLength(0);

    act(() => openHistoryPreview('outs/a.png'));
    await flush();
    act(() => mockLayers[mockLayers.length - 1].onClose());
    expect(historyPreviewState.entryId).toBeNull();

    act(() => openHistoryPreview('outs/a.png'));
    await flush();
    const area = q('[data-history-preview]')!.firstElementChild as HTMLElement;
    act(() => {
      area.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      area.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(historyPreviewState.entryId).toBeNull();
  });

  test('이미지를 누르면 닫히지 않는다', async () => {
    await mount();
    act(() => openHistoryPreview('outs/a.png'));
    await flush();
    const img = q('img')!;
    act(() => {
      img.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      img.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(historyPreviewState.entryId).toBe('outs/a.png');
  });

  test('파일이 사라졌으면 알림 → 히스토리에서 제거 → 닫힘', async () => {
    runInAction(() => {
      mockHistory.entries = [entry('outs/gone.png')];
    });
    await mount();
    act(() => openHistoryPreview('outs/gone.png'));
    await flush();
    await flush();
    expect(mockPushMessage).toHaveBeenCalledWith('이미지 파일을 찾을 수 없습니다');
    expect(mockSvc.remove).toHaveBeenCalledWith('outs/gone.png');
    expect(historyPreviewState.entryId).toBeNull();
    expect(q('[data-history-preview]')).toBeNull();
  });
});

describe('히스토리 칸', () => {
  const mount = async () => {
    act(() => root.render(<ImageHistoryPanel />));
    await flush();
    await flush();
  };

  test('칸을 누르면 미리 보기가 열리고 즐겨찾기는 바뀌지 않는다', async () => {
    await mount();
    const cells = container.querySelectorAll('.grid > div');
    expect(cells).toHaveLength(3);
    click(cells[1]);
    expect(historyPreviewState.entryId).toBe('outs/b.png');
    expect(mockSvc.toggleFavorite).not.toHaveBeenCalled();
  });

  test('별 버튼 = 즐겨찾기 전환만(미리 보기 안 열림), 즐겨찾기면 항상 보이고 아니면 PC 는 올렸을 때만', async () => {
    await mount();
    const stars = container.querySelectorAll('[data-history-fav-btn]');
    expect(stars).toHaveLength(3);
    expect(stars[0].className).toContain('card-overlay-btn');
    expect(stars[0].className).toContain('opacity-0 group-hover:opacity-100');
    click(stars[0]);
    await flush();
    expect(mockSvc.toggleFavorite).toHaveBeenCalledTimes(1);
    expect(historyPreviewState.entryId).toBeNull();
    const after = container.querySelectorAll('[data-history-fav-btn]')[0];
    expect(after.getAttribute('aria-pressed')).toBe('true');
    expect(after.className).not.toContain('opacity-0');
  });
});

describe('키보드', () => {
  const key = async (k: string, init: KeyboardEventInit = {}) => {
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
    });
    await flush();
  };
  test('좌우 화살표로 이전/다음, 끝에서는 그대로, 보조 키 조합은 무시', async () => {
    await act(async () => root.render(<HistoryImagePreview />));
    act(() => openHistoryPreview('outs/b.png'));
    await flush();
    await key('ArrowRight');
    expect(historyPreviewState.entryId).toBe('outs/c.png');
    await key('ArrowRight'); // 끝
    expect(historyPreviewState.entryId).toBe('outs/c.png');
    await key('ArrowLeft', { ctrlKey: true });
    expect(historyPreviewState.entryId).toBe('outs/c.png');
    await key('ArrowLeft');
    await key('ArrowLeft');
    expect(historyPreviewState.entryId).toBe('outs/a.png');
  });
  test('닫혀 있으면 화살표 키를 받지 않는다', async () => {
    await act(async () => root.render(<HistoryImagePreview />));
    await key('ArrowRight');
    expect(historyPreviewState.entryId).toBeNull();
  });
  test('미리 보기가 떠 있으면 전역 단축키는 되돌리기·다시 실행만 통과', () => {
    const { isShortcutActionActive } = jest.requireActual('../KeyboardShortcutService');
    const base = {
      imageGridFocusable: true, resultViewerOpen: true, dialogCount: 0, floatViewCount: 0, undoFloatViewCount: 0,
      configScreenOpen: false, pieceEditorOpen: false, findReplaceOpen: false,
    };
    const act1 = (category: string, extra: any = {}) => ({ id: 'x', label: 'x', category, defaultKey: 'K', ...extra });
    for (const c of ['image-grid', 'viewer', 'scene', 'global']) {
      expect(isShortcutActionActive(act1(c), { ...base, historyPreviewOpen: true })).toBe(false);
      expect(isShortcutActionActive(act1(c), base)).toBe(true);
    }
    expect(isShortcutActionActive(act1('global', { allowInFloatView: true }), { ...base, historyPreviewOpen: true })).toBe(true);
  });
});

describe('소스 계약', () => {
  const COMP = path.resolve(__dirname, '../../componenets');
  const read = (f: string) => fs.readFileSync(path.join(COMP, f), 'utf8');
  test('미리 보기는 App 에 한 번 마운트', () => {
    expect(read('App.tsx').match(/<HistoryImagePreview \/>/g)).toHaveLength(1);
  });
  test('칸 클릭은 더 이상 즐겨찾기를 바로 바꾸지 않는다', () => {
    const src = read('ImageHistory.tsx');
    expect(src).toContain('openHistoryPreview(entry.id)');
    expect(src.match(/imageHistoryService\.toggleFavorite\(/g)).toHaveLength(1); // 별 버튼 한 곳
  });
});
