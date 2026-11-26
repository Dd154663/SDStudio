// 씬 목록 이미지 뷰 1차(2026-11-26) — 실제로 그려 보는 렌더 검사: 두 방식의 격자, 첫 칸 테두리·이름, 더보기 카드,
// 빈 첫 칸, 이미지 칸 누름 → 그리드 열기 콜백, 이름 띠 → 씬 메뉴, 우클릭 → 이미지 메뉴, 빈 프로젝트, 숨은 탭 구독 끊기,
// 첫 칸의 호버 버튼 넷(씬 카드와 같은 동작), 줄이 바뀔 때 씬 이름 다시 적기.
import React, { act, createRef } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { observable, runInAction } from 'mobx';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

class Events extends EventTarget {
  n = new Map<string, number>();
  addEventListener(t: string, l: any, o?: any) {
    this.n.set(t, (this.n.get(t) ?? 0) + 1);
    super.addEventListener(t, l, o);
  }
  removeEventListener(t: string, l: any, o?: any) {
    this.n.set(t, (this.n.get(t) ?? 0) - 1);
    super.removeEventListener(t, l, o);
  }
  count(t: string) {
    return this.n.get(t) ?? 0;
  }
}
const mockOutputs: Record<string, string[]> = {};
const mockGame = Object.assign(new Events(), {
  getOutputs: jest.fn((_s: any, scene: any) => mockOutputs[scene.name] ?? []),
});
const mockImages = Object.assign(new Events(), {
  fetchImageSmall: jest.fn(async (p: string, size: number) => `data:small${size},${p}`),
  fetchImage: jest.fn(async (p: string) => `data:full,${p}`),
  getOutputDir: (_s: any, scene: any) => `outs/${scene.type}/${scene.name}`,
  getVibeImagePath: (_s: any, name: string) => `vibes/${name}`,
});
jest.mock('../index', () => ({
  gameService: mockGame,
  imageService: mockImages,
  isMobile: false,
  workFlowService: { getDef: () => ({ emoji: '🎨' }) },
}));
const mockApp = observable({ sceneCardSizePercent: 50 });
jest.mock('../AppService', () => ({ appState: mockApp }));
const mockShow = jest.fn();
jest.mock('react-contexify', () => ({ useContextMenu: () => ({ show: mockShow, hideAll: () => {} }) }));
jest.mock('../imageDragOut', () => ({ imageDragOutProps: () => ({}) }));

import { SceneImageView, SceneImageViewHandle, SceneViewModeControl } from '../../componenets/SceneImageView';
import {
  sceneViewState,
  setSceneViewCap,
  setSceneViewMode,
  sceneContinuesRow,
} from '../sceneImageView';

const T = (n: number) => `${1700000000000 + n}.png`;
let root: Root;
let host: HTMLDivElement;
const session: any = { name: 'p', sceneCardStyle: {}, mirrorImage: undefined };
const mkScene = (name: string, type: 'scene' | 'inpaint' = 'scene', extra: any = {}) =>
  observable({ name, type, mains: [] as string[], workflowType: 'SDI2I', preset: { image: undefined as any }, ...extra });

const handlers = () => ({
  onOpenImage: jest.fn(),
  onOpenScene: jest.fn(),
  onSceneMenu: jest.fn(),
  onQueueAdd: jest.fn(),
  onQueueRemove: jest.fn(),
  onEditScene: jest.fn(),
  onToggleBookmark: jest.fn(),
});

async function render(props: any) {
  const ref = createRef<SceneImageViewHandle>();
  const containerRef = createRef<HTMLDivElement>();
  await act(async () => {
    root.render(
      <SceneImageView
        ref={ref}
        session={session}
        isActive
        containerRef={containerRef}
        searching={false}
        {...props}
      />,
    );
  });
  // 썸네일 읽기(비동기) 반영
  await act(async () => {
    await Promise.resolve();
  });
  return { ref, containerRef };
}

const cells = (kind?: string) =>
  Array.from(host.querySelectorAll<HTMLElement>(kind ? `[data-scene-image-cell="${kind}"]` : '[data-scene-image-cell]'));

beforeEach(() => {
  for (const k of Object.keys(mockOutputs)) delete mockOutputs[k];
  jest.clearAllMocks();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  runInAction(() => {
    mockApp.sceneCardSizePercent = 50;
  });
  setSceneViewCap(8);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  expect(mockGame.count('updated')).toBe(0);
  expect(mockImages.count('image-cache-invalidated')).toBe(0);
});

describe('씬 별로', () => {
  test('첫 칸(테두리·이름 띠·장수) → 이미지 → 더보기(+남은 장수), 빈 씬 = 빈 첫 칸, 줄을 바꾸지 않고 이어짐', async () => {
    setSceneViewCap(3);
    const a = mkScene('A');
    const empty = mkScene('Empty');
    const b = mkScene('B');
    mockOutputs.A = [T(1), T(2), T(3), T(4), T(5)];
    mockOutputs.B = [T(9)];
    await render({ type: 'scene', mode: 'byScene', scenes: [a, empty, b], ...handlers() });
    expect(cells().map((c) => c.dataset.sceneImageCell)).toEqual(['head', 'img', 'img', 'more', 'head-empty', 'head']);
    const head = host.querySelector<HTMLElement>('[data-scene-head="A"]')!;
    expect(head.className).toContain('border-2');
    expect(head.className).toContain('border-[var(--c-sky-bg)]');
    expect(head.textContent).toContain('A');
    expect(head.textContent).toContain('5');
    // 첫 칸 그림 = 가장 최근 이미지(썸네일 단계 값)
    expect(head.querySelector('img')!.getAttribute('src')).toBe(`data:small400,outs/scene/A/${T(5)}`);
    expect(cells('more')[0].textContent).toContain('…');
    expect(cells('more')[0].textContent).toContain('+2');
    expect(cells('head-empty')[0].querySelector('img')).toBeNull();
    expect(cells('head-empty')[0].textContent).toContain('Empty');
  });

  test('이미지 칸 누름 = 그 씬 그리드를 그 이미지로, 첫 칸 그림 누름도 같음, 더보기 = 그 씬 그리드', async () => {
    const h = handlers();
    const a = mkScene('A');
    mockOutputs.A = Array.from({ length: 10 }, (_, i) => T(i));
    await render({ type: 'scene', mode: 'byScene', scenes: [a], ...h });
    await act(async () => cells('img')[0].querySelector<HTMLElement>('[data-scene-image-box]')!.click());
    expect(h.onOpenImage).toHaveBeenCalledWith(a, T(8));
    await act(async () => host.querySelector<HTMLElement>('[data-scene-head="A"]')!.click());
    expect(h.onOpenImage).toHaveBeenLastCalledWith(a, T(9));
    await act(async () => cells('more')[0].querySelector('button')!.click());
    expect(h.onOpenScene).toHaveBeenCalledWith(a);
    expect(h.onSceneMenu).not.toHaveBeenCalled();
  });

  test('이름 띠 누름·우클릭 = 씬 메뉴, 빈 첫 칸은 칸 전체, 이미지 우클릭 = 이미지 그리드 메뉴(GallaryImage 형태)', async () => {
    const h = handlers();
    const a = mkScene('A');
    const empty = mkScene('Empty');
    mockOutputs.A = [T(1), T(2)];
    await render({ type: 'scene', mode: 'byScene', scenes: [a, empty], ...h });
    const strip = host.querySelector<HTMLElement>('[data-scene-head="A"] [data-scene-name-strip]')!;
    await act(async () => strip.click());
    expect(h.onSceneMenu).toHaveBeenCalledWith(a, expect.anything());
    expect(h.onOpenImage).not.toHaveBeenCalled();
    await act(async () => {
      strip.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    });
    expect(h.onSceneMenu).toHaveBeenCalledTimes(2);
    expect(mockShow).not.toHaveBeenCalled();
    await act(async () => host.querySelector<HTMLElement>('[data-scene-head="Empty"]')!.click());
    expect(h.onSceneMenu).toHaveBeenLastCalledWith(empty, expect.anything());
    await act(async () => {
      cells('img')[0].querySelector('[data-scene-image-box]')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    });
    expect(mockShow).toHaveBeenCalledWith(
      expect.objectContaining({
        props: { ctx: { type: 'gallary_image', path: [`outs/scene/A/${T(1)}`], scene: a, starable: true } },
      }),
    );
  });

  test('즐겨찾기 이미지 = 노란 테두리(별 버튼 없음)', async () => {
    const a = mkScene('A', 'scene', { mains: [T(1)] });
    mockOutputs.A = [T(1), T(2)];
    await render({ type: 'scene', mode: 'byScene', scenes: [a], ...handlers() });
    expect(cells('img')[0].querySelector('img')!.className).toContain('border-yellow-400');
    expect(host.querySelector('[data-scene-head="A"]')!.className).not.toContain('border-yellow-400');
    // 버튼은 첫 칸의 호버 버튼 넷뿐(이미지 칸에 별 버튼 없음)
    expect(host.querySelectorAll('button').length).toBe(4);
    expect(cells('img')[0].querySelectorAll('button').length).toBe(0);
  });

  test('변형 탭: 첫 칸 = 입력 원본(썸네일 읽기), 결과가 이어짐, 입력 그림 누름 = 그 씬 그리드·우클릭 = 씬 메뉴', async () => {
    const h = handlers();
    const v = mkScene('V', 'inpaint', { preset: { image: 'src.png' } });
    mockOutputs.V = [T(1)];
    await render({ type: 'inpaint', mode: 'byScene', scenes: [v], ...h });
    expect(cells().map((c) => c.dataset.sceneImageCell)).toEqual(['head', 'img']);
    const head = host.querySelector<HTMLElement>('[data-scene-head="V"]')!;
    expect(head.querySelector('img')!.getAttribute('src')).toBe('data:small400,vibes/src.png');
    expect(mockImages.fetchImage).not.toHaveBeenCalled();
    expect(head.textContent).toContain('🎨V');
    await act(async () => head.click());
    expect(h.onOpenScene).toHaveBeenCalledWith(v);
    await act(async () => {
      head.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    });
    expect(h.onSceneMenu).toHaveBeenCalledWith(v, expect.anything());
  });

  test('미러 씬은 프로젝트 미러 이미지가 입력', async () => {
    const m = mkScene('M', 'inpaint', { workflowType: 'SDMirror' });
    session.mirrorImage = 'mirror.png';
    await render({ type: 'inpaint', mode: 'byScene', scenes: [m], ...handlers() });
    expect(host.querySelector('[data-scene-head="M"] img')!.getAttribute('src')).toBe('data:small400,vibes/mirror.png');
    session.mirrorImage = undefined;
  });
});

describe('최근 순', () => {
  test('모든 씬의 이미지를 최신 먼저 + 칸 아래 씬 이름, 이미지 없는 씬은 안 보임', async () => {
    const h = handlers();
    const a = mkScene('A');
    const b = mkScene('B');
    const c = mkScene('C');
    mockOutputs.A = [T(1), T(5)];
    mockOutputs.B = [T(3), 'up-uuid.png'];
    await render({ type: 'scene', mode: 'recent', scenes: [a, b, c], ...h });
    expect(cells().map((x) => x.querySelector('[data-scene-image-caption]')!.textContent)).toEqual(['A', 'B', 'A', 'B']);
    expect(cells().map((x) => x.querySelector('img')!.getAttribute('src'))).toEqual([
      `data:small400,outs/scene/A/${T(5)}`,
      `data:small400,outs/scene/B/${T(3)}`,
      `data:small400,outs/scene/A/${T(1)}`,
      'data:small400,outs/scene/B/up-uuid.png',
    ]);
    expect(host.querySelector('[data-scene-head]')).toBeNull();
    await act(async () => cells()[1].querySelector<HTMLElement>('div')!.click());
    expect(h.onOpenImage).toHaveBeenCalledWith(b, T(3));
  });

  test('씬은 있으나 이미지가 하나도 없으면 안내', async () => {
    await render({ type: 'scene', mode: 'recent', scenes: [mkScene('A')], ...handlers() });
    expect(host.textContent).toContain('아직 이미지가 없습니다');
  });
});

describe('빈 프로젝트·검색·숨은 탭·갱신', () => {
  test('씬이 없으면 안내(두 방식), 검색 중이면 검색 결과 없음', async () => {
    await render({ type: 'scene', mode: 'byScene', scenes: [], ...handlers() });
    expect(host.textContent).toContain('아직 씬이 없습니다');
    expect(cells().length).toBe(0);
    await render({ type: 'scene', mode: 'recent', scenes: [], ...handlers() });
    expect(host.textContent).toContain('아직 씬이 없습니다');
    await render({ type: 'scene', mode: 'recent', scenes: [], searching: true, ...handlers() });
    expect(host.textContent).toContain('검색 결과가 없습니다');
  });

  test('새 이미지(gameService updated) → 반영, 숨은 탭은 구독·격자를 쉼(바깥 상자는 남음)', async () => {
    const a = mkScene('A');
    mockOutputs.A = [T(1)];
    await render({ type: 'scene', mode: 'byScene', scenes: [a], ...handlers() });
    expect(cells().length).toBe(1);
    expect(mockGame.count('updated')).toBe(1);
    mockOutputs.A = [T(1), T(2)];
    await act(async () => {
      mockGame.dispatchEvent(new Event('updated'));
    });
    expect(cells().length).toBe(2);
    expect(host.querySelector('[data-scene-head="A"] img')!.getAttribute('src')).toBe(`data:small400,outs/scene/A/${T(2)}`);
    const { containerRef } = await render({ type: 'scene', mode: 'byScene', scenes: [a], isActive: false, ...handlers() });
    expect(mockGame.count('updated')).toBe(0);
    expect(cells().length).toBe(0);
    expect(host.querySelector('[data-scene-image-view]')).not.toBeNull();
    expect(containerRef.current).not.toBeNull();
  });

  test('씬으로 이동: 씬 별로 = 첫 칸, 칸이 없는 씬은 거짓 / 보이는 씬 = 그려진 줄의 씬', async () => {
    const a = mkScene('A');
    const b = mkScene('B');
    mockOutputs.A = [T(1)];
    const { ref } = await render({ type: 'scene', mode: 'recent', scenes: [a, b], ...handlers() });
    const scroll = async (h: SceneImageViewHandle, name: string) => {
      let ok = false;
      await act(async () => {
        ok = h.scrollToScene(name);
      });
      return ok;
    };
    expect(await scroll(ref.current!, 'A')).toBe(true);
    expect(await scroll(ref.current!, 'B')).toBe(false);
    expect(ref.current!.visibleSceneNames()).toEqual(['A']);
    const r2 = await render({ type: 'scene', mode: 'byScene', scenes: [a, b], ...handlers() });
    expect(await scroll(r2.ref.current!, 'B')).toBe(true);
    expect(r2.ref.current!.visibleSceneNames()).toEqual(['A', 'B']);
  });
});

describe('PC 보기 방식 드롭다운', () => {
  test('세 방식, 씬 별로일 때만 씬당 장수 입력, 탭 종류별 값', async () => {
    await act(async () => root.render(<SceneViewModeControl type="inpaint" />));
    const select = host.querySelector<HTMLSelectElement>('select')!;
    expect(select.className).toContain('app-select app-select-tight');
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['씬 카드', '씬 별로', '최근 순']);
    expect(host.querySelector('[data-scene-view-cap]')).toBeNull();
    await act(async () => setSceneViewMode('inpaint', 'byScene'));
    expect(host.querySelector('[data-scene-view-cap]')!.textContent).toContain('씬당');
    expect(host.querySelector<HTMLInputElement>('[data-scene-view-cap] input')!.value).toBe('8');
    expect(sceneViewState.modes.scene).toBe('cards');
    await act(async () => setSceneViewMode('inpaint', 'cards'));
  });
});

describe('씬 별로 — 씬 구분(2026-11-26)', () => {
  test('줄 첫 칸인데 씬의 첫 칸이 아니면 이어진 줄(씬 이름을 다시 적는다)', () => {
    const list: any[] = [
      { kind: 'head', scene: 'A', total: 3 },
      { kind: 'img', scene: 'A', filename: 'a1' },
      { kind: 'img', scene: 'A', filename: 'a2' },
      { kind: 'head', scene: 'B', total: 0 },
      { kind: 'head', scene: 'C', total: 9 },
      { kind: 'more', scene: 'C', remaining: 5 },
    ];
    // 2열: [A머리 a1] [a2 B머리] [C머리 더보기]
    expect(list.map((_, i) => sceneContinuesRow(list, i, 2))).toEqual([false, false, true, false, false, false]);
    // 3열: [A머리 a1 a2] [B머리 C머리 더보기]
    expect(list.map((_, i) => sceneContinuesRow(list, i, 3))).toEqual([false, false, false, false, false, false]);
    expect(sceneContinuesRow(list, 99, 2)).toBe(false);
  });

  test('묶음 띠는 없다(실기에서 티가 나지 않아 걷어냄) — 칸 여백은 두 방식이 같다', async () => {
    const a = mkScene('A');
    mockOutputs.A = [T(1), T(2)];
    await render({ type: 'scene', mode: 'byScene', scenes: [a], ...handlers() });
    expect(host.querySelector('[data-scene-group-band]')).toBeNull();
    const padOf = () => cells().map((c) => c.style.padding);
    const byScene = padOf();
    await render({ type: 'scene', mode: 'recent', scenes: [a], ...handlers() });
    expect(new Set([...byScene, ...padOf()]).size).toBe(1);
  });
});

describe('씬 별로 — 첫 칸의 호버 버튼 넷(PC, 씬 카드와 같은 버튼)', () => {
  const buttons = (name: string) =>
    Array.from(host.querySelectorAll<HTMLButtonElement>(`[data-scene-head="${name}"] [data-scene-head-buttons] button`));

  test('예약 추가·예약 제거·씬 편집·씬 북마크 순서와 색, 누르면 그 씬으로 콜백(그림 누름·씬 메뉴로 번지지 않음)', async () => {
    const h = handlers();
    const a = mkScene('A');
    const empty = mkScene('Empty');
    mockOutputs.A = [T(1), T(2)];
    await render({ type: 'scene', mode: 'byScene', scenes: [a, empty], ...h });
    const row = host.querySelector<HTMLElement>('[data-scene-head="A"] [data-scene-head-buttons]')!;
    // 평소에는 숨고 첫 칸에 마우스를 올리면 보인다. 줄 자체는 눌림을 받지 않는다(이름 띠가 눌리게)
    expect(row.className).toContain('opacity-0');
    expect(row.className).toContain('group-hover/scene-head:opacity-100');
    expect(row.className).toContain('pointer-events-none');
    expect(host.querySelector<HTMLElement>('[data-scene-head="A"]')!.className).toContain('group/scene-head');
    const bs = buttons('A');
    expect(bs.map((b) => b.getAttribute('aria-label'))).toEqual(['예약 추가', '예약 제거', '씬 편집', '씬 북마크']);
    expect(bs[0].className).toContain('bg-green-500');
    expect(bs[1].className).toContain('bg-gray-500');
    expect(bs[2].className).toContain('bg-orange-500');
    expect(bs[3].className).toContain('bg-gray-500');
    for (const b of bs) expect(b.className).toContain('round-button scene-btn');
    await act(async () => bs[0].click());
    expect(h.onQueueAdd).toHaveBeenCalledWith(a);
    await act(async () => bs[1].click());
    expect(h.onQueueRemove).toHaveBeenCalledWith(a);
    await act(async () => bs[2].click());
    expect(h.onEditScene).toHaveBeenCalledWith(a);
    await act(async () => bs[3].click());
    expect(h.onToggleBookmark).toHaveBeenCalledWith(a);
    expect(h.onOpenImage).not.toHaveBeenCalled();
    expect(h.onSceneMenu).not.toHaveBeenCalled();
    // 이미지가 없는 씬의 빈 첫 칸에도 같은 버튼(예약 추가가 가장 쓸모 있는 자리)
    await act(async () => buttons('Empty')[0].click());
    expect(h.onQueueAdd).toHaveBeenLastCalledWith(empty);
    expect(h.onSceneMenu).not.toHaveBeenCalled();
    // 버튼 위 우클릭 = 씬 메뉴(이미지 메뉴 아님)
    await act(async () => {
      bs[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    });
    expect(h.onSceneMenu).toHaveBeenCalledWith(a, expect.anything());
    expect(mockShow).not.toHaveBeenCalled();
  });

  test('북마크된 씬 = 북마크 버튼이 주황 + 이름 띠에 북마크 표시', async () => {
    const a = mkScene('A');
    const b = mkScene('B');
    mockOutputs.A = [T(1)];
    mockOutputs.B = [T(2)];
    await render({ type: 'scene', mode: 'byScene', scenes: [a, b], bookmarkedScene: 'B', ...handlers() });
    expect(buttons('A')[3].className).toContain('bg-gray-500');
    expect(buttons('B')[3].className).toContain('bg-orange-500');
    expect(buttons('B')[3].className).toContain('scene-btn-on');
    expect(host.querySelector('[data-scene-head="A"] [data-scene-name-strip] [aria-label="북마크됨"]')).toBeNull();
    expect(host.querySelector('[data-scene-head="B"] [data-scene-name-strip] [aria-label="북마크됨"]')).not.toBeNull();
  });

  test('최근 순에는 첫 칸이 없으므로 버튼도 없다', async () => {
    const a = mkScene('A');
    mockOutputs.A = [T(1)];
    await render({ type: 'scene', mode: 'recent', scenes: [a], ...handlers() });
    expect(host.querySelector('[data-scene-head-buttons]')).toBeNull();
    expect(host.querySelectorAll('button').length).toBe(0);
  });
});
