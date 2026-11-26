// 씬 목록 이미지 뷰 1차(2026-11-26) — 실제로 그려 보는 렌더 검사: 두 방식의 격자, 첫 칸 테두리·이름, 더보기 카드,
// 빈 첫 칸, 이미지 칸 누름 → 그리드 열기 콜백, 이름 띠 → 씬 메뉴, 우클릭 → 이미지 메뉴, 빈 프로젝트, 숨은 탭 구독 끊기,
// 첫 칸의 호버 버튼 넷(씬 카드와 같은 동작), 줄이 바뀔 때 씬 이름 다시 적기.
// 2026-11-26: 이미지 칸 누름 = 상세 보기로 바로(onOpenImage), 그리드 열기는 이미지 메뉴(ctx.openGrid), 칸 왼쪽 위 즐겨찾기 별.
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
  setSceneViewRowCap,
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
  onOpenGrid: jest.fn(),
  onToggleFavorite: jest.fn(),
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

  test('이미지 칸 누름 = 그 이미지 상세 보기(onOpenImage), 첫 칸 그림 누름도 같음, 더보기 = 그 씬 그리드', async () => {
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
        props: {
          ctx: {
            type: 'gallary_image',
            path: [`outs/scene/A/${T(1)}`],
            scene: a,
            starable: true,
            openGrid: expect.any(Function),
          },
        },
      }),
    );
    // 이 화면에서 연 메뉴에만 「이미지 그리드에서 보기」 — 고르면 그 씬 그리드를 그 이미지 위치로(onOpenGrid)
    mockShow.mock.calls.at(-1)[0].props.ctx.openGrid();
    expect(h.onOpenGrid).toHaveBeenCalledWith(a, T(1));
    expect(h.onOpenImage).not.toHaveBeenCalled();
  });

  test('즐겨찾기 이미지 = 노란 테두리 + 늘 보이는 노란 별(칸 테두리는 그대로)', async () => {
    const a = mkScene('A', 'scene', { mains: [T(1)] });
    mockOutputs.A = [T(1), T(2)];
    await render({ type: 'scene', mode: 'byScene', scenes: [a], ...handlers() });
    expect(cells('img')[0].querySelector('img')!.className).toContain('border-yellow-400');
    expect(host.querySelector('[data-scene-head="A"]')!.className).not.toContain('border-yellow-400');
    // 버튼 = 첫 칸의 호버 버튼 넷 + 별 둘(첫 칸 그림·이미지 칸)
    expect(host.querySelectorAll('button').length).toBe(6);
    const star = cells('img')[0].querySelector<HTMLButtonElement>('[data-scene-image-fav-btn]')!;
    expect(cells('img')[0].querySelectorAll('button').length).toBe(1);
    expect(star.getAttribute('aria-label')).toBe('즐겨찾기 해제');
    expect(star.getAttribute('aria-pressed')).toBe('true');
    expect(star.className).not.toContain('opacity-0');
    expect(star.querySelector('svg')!.getAttribute('class')).toContain('text-yellow-400');
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
  test('네 방식, 씬 별로일 때만 씬당 장수 입력, 탭 종류별 값', async () => {
    await act(async () => root.render(<SceneViewModeControl type="inpaint" />));
    const select = host.querySelector<HTMLSelectElement>('select')!;
    expect(select.className).toContain('app-select app-select-tight');
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['씬 카드', '씬 별로', '가로 줄', '최근 순']);
    expect(host.querySelector('[data-scene-view-cap]')).toBeNull();
    expect(host.querySelector('[data-scene-view-row-cap]')).toBeNull();
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
    // 버튼은 이미지 칸의 즐겨찾기 별뿐
    expect(host.querySelectorAll('button').length).toBe(1);
    expect(host.querySelectorAll('[data-scene-image-fav-btn]').length).toBe(1);
  });
});

describe('가로 줄(2026-11-26 2차)', () => {
  const rowsOf = () => Array.from(host.querySelectorAll<HTMLElement>('[data-scene-image-row]'));
  const kindsIn = (row: HTMLElement) =>
    Array.from(row.querySelectorAll<HTMLElement>('[data-scene-image-cell]')).map((c) => c.dataset.sceneImageCell);
  // 그리기 전에 되돌린다(afterEach 에서 바꾸면 해제 전 목록이 act 밖에서 다시 그려진다)
  beforeEach(() => setSceneViewRowCap(20));
  afterAll(() => setSceneViewRowCap(20));

  test('씬마다 줄 하나(빈 씬 포함), 줄 안 칸 순서 = 첫 칸 → 이미지 최신순 → 더보기, 줄 안은 가로 스크롤', async () => {
    setSceneViewRowCap(3);
    const a = mkScene('A');
    const empty = mkScene('Empty');
    const b = mkScene('B');
    mockOutputs.A = [T(1), T(2), T(3), T(4), T(5)];
    mockOutputs.B = [T(9)];
    await render({ type: 'scene', mode: 'rows', scenes: [a, empty, b], ...handlers() });
    expect(host.querySelector('[data-scene-image-view="rows"]')).not.toBeNull();
    expect(rowsOf().map((r) => r.dataset.sceneImageRow)).toEqual(['A', 'Empty', 'B']);
    expect(kindsIn(rowsOf()[0])).toEqual(['head', 'img', 'img', 'more']);
    expect(kindsIn(rowsOf()[1])).toEqual(['head-empty']);
    expect(kindsIn(rowsOf()[2])).toEqual(['head']);
    const imgs = Array.from(rowsOf()[0].querySelectorAll('[data-scene-image-cell="img"] img')).map((x) => x.getAttribute('src'));
    expect(imgs).toEqual([`data:small400,outs/scene/A/${T(4)}`, `data:small400,outs/scene/A/${T(3)}`]);
    expect(rowsOf()[0].querySelector('[data-scene-image-cell="more"]')!.textContent).toContain('+2');
    const scroller = rowsOf()[0].querySelector<HTMLElement>('[data-scene-row-scroll]')!;
    expect(scroller.className).toContain('overflow-x-auto');
    // PC 는 가로 막대를 숨기지 않는다(줄 높이에 막대 몫을 더함)
    expect(scroller.className).not.toContain('no-scrollbar');
    // 줄 안 칸은 같은 고정 폭
    const widths = Array.from(rowsOf()[0].querySelectorAll<HTMLElement>('[data-scene-image-cell]')).map((c) => c.style.width);
    expect(new Set(widths).size).toBe(1);
    // 씬 별로 전용 「이어진 줄」 표시는 없다
    expect(host.querySelector('[data-scene-group-continued]')).toBeNull();
  });

  test('첫 칸은 줄 왼쪽에 고정(sticky) + 불투명 바탕 + z-index, 다른 칸은 고정이 아님, 첫 칸 테두리 색 고정', async () => {
    const a = mkScene('A', 'scene', { mains: [T(2)] });
    mockOutputs.A = [T(1), T(2)];
    await render({ type: 'scene', mode: 'rows', scenes: [a], ...handlers() });
    const head = host.querySelector<HTMLElement>('[data-scene-image-cell="head"]')!;
    expect(head.className).toContain('sticky');
    expect(head.className).toContain('left-0');
    expect(head.className).toContain('z-10');
    expect(head.className).toContain('bg-[var(--c-surface)]');
    expect(host.querySelector<HTMLElement>('[data-scene-image-cell="img"]')!.className).not.toContain('sticky');
    // 첫 칸이 즐겨찾기여도 테두리는 하늘색, 즐겨찾기는 그림 안쪽 노란 테두리
    const box = host.querySelector<HTMLElement>('[data-scene-head="A"]')!;
    expect(box.className).toContain('border-[var(--c-sky-bg)]');
    expect(box.className).not.toContain('border-yellow-400');
    expect(box.querySelector('img')!.className).toContain('border-yellow-400');
  });

  test('칸 동작 = 씬 별로와 같음: 이미지 누름·첫 칸 누름 = 열기, 이름 띠 = 씬 메뉴, 우클릭 = 이미지 메뉴, 더보기 = 그 씬 그리드', async () => {
    setSceneViewRowCap(3);
    const h = handlers();
    const a = mkScene('A');
    const empty = mkScene('Empty');
    mockOutputs.A = Array.from({ length: 6 }, (_, i) => T(i));
    await render({ type: 'scene', mode: 'rows', scenes: [a, empty], ...h });
    await act(async () => cells('img')[0].querySelector<HTMLElement>('[data-scene-image-box]')!.click());
    expect(h.onOpenImage).toHaveBeenCalledWith(a, T(4));
    await act(async () => host.querySelector<HTMLElement>('[data-scene-head="A"]')!.click());
    expect(h.onOpenImage).toHaveBeenLastCalledWith(a, T(5));
    await act(async () => cells('more')[0].querySelector('button')!.click());
    expect(h.onOpenScene).toHaveBeenCalledWith(a);
    expect(h.onSceneMenu).not.toHaveBeenCalled();
    await act(async () => host.querySelector<HTMLElement>('[data-scene-head="A"] [data-scene-name-strip]')!.click());
    expect(h.onSceneMenu).toHaveBeenCalledWith(a, expect.anything());
    await act(async () => host.querySelector<HTMLElement>('[data-scene-head="Empty"]')!.click());
    expect(h.onSceneMenu).toHaveBeenLastCalledWith(empty, expect.anything());
    await act(async () => {
      cells('img')[0].querySelector('[data-scene-image-box]')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    });
    expect(mockShow).toHaveBeenCalledWith(
      expect.objectContaining({
        props: {
          ctx: {
            type: 'gallary_image',
            path: [`outs/scene/A/${T(4)}`],
            scene: a,
            starable: true,
            openGrid: expect.any(Function),
          },
        },
      }),
    );
    mockShow.mock.calls.at(-1)[0].props.ctx.openGrid();
    expect(h.onOpenGrid).toHaveBeenCalledWith(a, T(4));
  });

  test('첫 칸 호버 버튼 넷(PC) — 같은 순서·콜백, 북마크 표시', async () => {
    const h = handlers();
    const a = mkScene('A');
    const b = mkScene('B');
    mockOutputs.A = [T(1)];
    await render({ type: 'scene', mode: 'rows', scenes: [a, b], bookmarkedScene: 'B', ...h });
    const bs = Array.from(host.querySelectorAll<HTMLButtonElement>('[data-scene-head="A"] [data-scene-head-buttons] button'));
    expect(bs.map((x) => x.getAttribute('aria-label'))).toEqual(['예약 추가', '예약 제거', '씬 편집', '씬 북마크']);
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
    expect(host.querySelector('[data-scene-head="B"] [data-scene-name-strip] [aria-label="북마크됨"]')).not.toBeNull();
    expect(host.querySelector('[data-scene-head="A"] [data-scene-name-strip] [aria-label="북마크됨"]')).toBeNull();
  });

  test('변형 탭: 줄 첫 칸 = 입력 원본, 상한−1 장 결과', async () => {
    setSceneViewRowCap(2);
    const v = mkScene('V', 'inpaint', { preset: { image: 'src.png' } });
    mockOutputs.V = [T(1), T(2)];
    await render({ type: 'inpaint', mode: 'rows', scenes: [v], ...handlers() });
    expect(kindsIn(rowsOf()[0])).toEqual(['head', 'img', 'more']);
    expect(host.querySelector('[data-scene-head="V"] img')!.getAttribute('src')).toBe('data:small400,vibes/src.png');
  });

  test('씬으로 이동 = 그 씬의 줄(이미지 없는 씬도 참, 목록에 없으면 거짓) / 보이는 씬 = 보이는 줄의 씬', async () => {
    const a = mkScene('A');
    const empty = mkScene('Empty');
    const b = mkScene('B');
    mockOutputs.A = [T(1)];
    mockOutputs.B = [T(2)];
    const { ref } = await render({ type: 'scene', mode: 'rows', scenes: [a, empty, b], ...handlers() });
    // 기본 크기 800×600, 줄 높이 361(그림 341 + 여백 6 + 가로 막대 14) → 처음 보이는 줄 = A·Empty
    expect(ref.current!.visibleSceneNames()).toEqual(['A', 'Empty']);
    let ok = false;
    await act(async () => {
      ok = ref.current!.scrollToScene('Empty');
    });
    expect(ok).toBe(true);
    await act(async () => {
      ok = ref.current!.scrollToScene('B');
    });
    expect(ok).toBe(true);
    expect(ref.current!.visibleSceneNames()).toEqual(['Empty', 'B']);
    await act(async () => {
      ok = ref.current!.scrollToScene('Nope');
    });
    expect(ok).toBe(false);
  });

  test('줄의 가로 스크롤 위치는 씬별로 기억해 줄이 다시 그려질 때 되살린다', async () => {
    const a = mkScene('A');
    mockOutputs.A = Array.from({ length: 10 }, (_, i) => T(i));
    await render({ type: 'scene', mode: 'rows', scenes: [a], ...handlers() });
    const scroller = () => host.querySelector<HTMLElement>('[data-scene-image-row="A"] [data-scene-row-scroll]')!;
    await act(async () => {
      scroller().scrollLeft = 120;
      scroller().dispatchEvent(new Event('scroll'));
    });
    // 썸네일 무효화 = 줄째 다시 그림(새 DOM) → 기억값으로 복원
    const before = scroller();
    await act(async () => {
      mockImages.dispatchEvent(new Event('image-cache-invalidated'));
    });
    expect(scroller()).not.toBe(before);
    expect(scroller().scrollLeft).toBe(120);
  });

  test('숨은 탭은 구독·목록을 쉼(바깥 상자는 남음)', async () => {
    const a = mkScene('A');
    mockOutputs.A = [T(1)];
    await render({ type: 'scene', mode: 'rows', scenes: [a], ...handlers() });
    expect(mockGame.count('updated')).toBe(1);
    expect(rowsOf().length).toBe(1);
    const { containerRef } = await render({ type: 'scene', mode: 'rows', scenes: [a], isActive: false, ...handlers() });
    expect(mockGame.count('updated')).toBe(0);
    expect(mockImages.count('image-cache-invalidated')).toBe(0);
    expect(rowsOf().length).toBe(0);
    expect(host.querySelector('[data-scene-image-view="rows"]')).not.toBeNull();
    expect(containerRef.current).not.toBeNull();
  });

  test('씬이 없으면 안내', async () => {
    await render({ type: 'scene', mode: 'rows', scenes: [], ...handlers() });
    expect(host.textContent).toContain('아직 씬이 없습니다');
    expect(rowsOf().length).toBe(0);
  });

  test('드롭다운: 가로 줄일 때는 줄당 장수 입력(가로 줄 상한에 묶임, 씬 별로 입력은 없음)', async () => {
    await act(async () => root.render(<SceneViewModeControl type="scene" />));
    await act(async () => setSceneViewMode('scene', 'rows'));
    expect(host.querySelector<HTMLSelectElement>('select')!.value).toBe('rows');
    expect(host.querySelector('[data-scene-view-cap]')).toBeNull();
    const label = host.querySelector('[data-scene-view-row-cap]')!;
    expect(label.textContent).toContain('줄당');
    const input = label.querySelector<HTMLInputElement>('input')!;
    expect(input.value).toBe('20');
    expect(input.max).toBe('50');
    expect(input.getAttribute('aria-label')).toBe('가로 줄마다 보여 줄 이미지 수');
    await act(async () => setSceneViewRowCap(33));
    expect(input.value).toBe('33');
    expect(sceneViewState.cap).toBe(8);
    await act(async () => setSceneViewMode('scene', 'byScene'));
    expect(host.querySelector('[data-scene-view-row-cap]')).toBeNull();
    expect(host.querySelector<HTMLInputElement>('[data-scene-view-cap] input')!.value).toBe('8');
    await act(async () => setSceneViewMode('scene', 'cards'));
  });
});

describe('즐겨찾기 별(2026-11-26 — 히스토리 칸의 별과 같은 모양·규칙)', () => {
  const starIn = (el: Element) => el.querySelector<HTMLButtonElement>('[data-scene-image-fav-btn]');

  test('대상 = 이미지 칸 전부 + 생성 탭 첫 칸, 빈 첫 칸·더보기에는 없음', async () => {
    setSceneViewCap(3);
    const a = mkScene('A');
    const empty = mkScene('Empty');
    mockOutputs.A = [T(1), T(2), T(3), T(4), T(5)];
    await render({ type: 'scene', mode: 'byScene', scenes: [a, empty], ...handlers() });
    expect(cells('img').map((c) => !!starIn(c))).toEqual([true, true]);
    expect(starIn(cells('head')[0])).not.toBeNull();
    expect(starIn(cells('head-empty')[0])).toBeNull();
    expect(starIn(cells('more')[0])).toBeNull();
  });

  test('변형 탭 첫 칸(입력 원본)에는 없고 결과 이미지 칸에는 있다(모드 동등)', async () => {
    const v = mkScene('V', 'inpaint', { preset: { image: 'src.png' } });
    mockOutputs.V = [T(1)];
    await render({ type: 'inpaint', mode: 'byScene', scenes: [v], ...handlers() });
    expect(starIn(cells('head')[0])).toBeNull();
    expect(starIn(cells('img')[0])).not.toBeNull();
  });

  test('PC: 히스토리와 같은 모양, 즐겨찾기가 아니면 그 칸에 올렸을 때만(이름 붙인 그룹), 키보드 포커스 때도 보임', async () => {
    const a = mkScene('A');
    mockOutputs.A = [T(1), T(2)];
    await render({ type: 'scene', mode: 'byScene', scenes: [a], ...handlers() });
    const img = starIn(cells('img')[0])!;
    for (const c of ['absolute', 'left-0', 'top-0', 'z-10', 'm-1', 'rounded-full', 'card-overlay-btn', 'shadow', 'w-6', 'h-6'])
      expect(img.className.split(' ')).toContain(c);
    expect(img.className).not.toContain('touch-hit');
    expect(img.className).toContain('opacity-0');
    expect(img.className).toContain('group-hover/scene-img:opacity-100');
    expect(img.className).toContain('focus-visible:opacity-100');
    // 바깥의 다른 .group 에 반응하지 않게 이름 붙인 그룹만
    expect(img.className).not.toMatch(/(^| )group-hover:/);
    expect(cells('img')[0].querySelector('[data-scene-image-box]')!.className).toContain('group/scene-img');
    expect(img.getAttribute('aria-label')).toBe('즐겨찾기');
    expect(img.getAttribute('title')).toBe('즐겨찾기');
    expect(img.getAttribute('aria-pressed')).toBe('false');
    const head = starIn(cells('head')[0])!;
    expect(head.className).toContain('group-hover/scene-head:opacity-100');
  });

  test('누름 = onToggleFavorite(그 씬·그 파일)만 — 칸 누름(상세 보기)·씬 메뉴로 번지지 않음', async () => {
    const h = handlers();
    const a = mkScene('A');
    mockOutputs.A = [T(1), T(2)];
    await render({ type: 'scene', mode: 'byScene', scenes: [a], ...h });
    await act(async () => starIn(cells('img')[0])!.click());
    expect(h.onToggleFavorite).toHaveBeenCalledWith(a, T(1));
    await act(async () => starIn(cells('head')[0])!.click());
    expect(h.onToggleFavorite).toHaveBeenLastCalledWith(a, T(2));
    expect(h.onOpenImage).not.toHaveBeenCalled();
    expect(h.onOpenScene).not.toHaveBeenCalled();
    expect(h.onSceneMenu).not.toHaveBeenCalled();
  });

  test('즐겨찾기 상태가 바뀌면 별도 바로 바뀐다(observer)', async () => {
    const a = mkScene('A');
    mockOutputs.A = [T(1), T(2)];
    await render({ type: 'scene', mode: 'byScene', scenes: [a], ...handlers() });
    expect(starIn(cells('img')[0])!.getAttribute('aria-pressed')).toBe('false');
    await act(async () => {
      runInAction(() => a.mains.push(T(1)));
    });
    expect(starIn(cells('img')[0])!.getAttribute('aria-pressed')).toBe('true');
    expect(starIn(cells('img')[0])!.className).not.toContain('opacity-0');
  });

  test('가로 줄·최근 순에도 같은 별', async () => {
    const h = handlers();
    const a = mkScene('A');
    mockOutputs.A = [T(1), T(2)];
    await render({ type: 'scene', mode: 'rows', scenes: [a], ...h });
    expect(starIn(cells('img')[0])).not.toBeNull();
    expect(starIn(cells('head')[0])).not.toBeNull();
    await render({ type: 'scene', mode: 'recent', scenes: [a], ...h });
    await act(async () => starIn(cells('img')[1])!.click());
    expect(h.onToggleFavorite).toHaveBeenCalledWith(a, T(1));
    expect(h.onOpenImage).not.toHaveBeenCalled();
  });

  test('씬 별로의 이어진 줄 표시(씬 이름)는 별과 겹치지 않게 칸 왼쪽 아래', async () => {
    const a = mkScene('A');
    mockOutputs.A = Array.from({ length: 12 }, (_, i) => T(i));
    await render({ type: 'scene', mode: 'byScene', scenes: [a], ...handlers() });
    const tag = host.querySelector<HTMLElement>('[data-scene-group-continued]')!;
    expect(tag).not.toBeNull();
    expect(tag.textContent).toBe('A');
    expect(tag.className).toContain('bottom-1');
    expect(tag.className).toContain('left-1');
    expect(tag.className).not.toContain('top-1');
    expect(tag.className).toContain('pointer-events-none');
  });
});
