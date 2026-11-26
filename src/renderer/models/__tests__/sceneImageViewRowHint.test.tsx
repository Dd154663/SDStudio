// 이미지 뷰 「가로 줄」 — 모바일의 가로 스크롤 힌트(2026-11-26 사용자: 환경설정 탭 스와이프 힌트처럼 옅은 화살표).
// 줄의 가로 막대를 숨기는 모바일에서, 가려진 칸이 있는 쪽에만 화살표가 뜨고 고정된 첫 칸은 가리지 않는다.
import React, { act, createRef } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { observable } from 'mobx';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const mockOutputs: Record<string, string[]> = {};
const mockGame = Object.assign(new EventTarget(), {
  getOutputs: jest.fn((_s: any, scene: any) => mockOutputs[scene.name] ?? []),
});
const mockImages = Object.assign(new EventTarget(), {
  fetchImageSmall: jest.fn(async (p: string, size: number) => `data:small${size},${p}`),
  fetchImage: jest.fn(async (p: string) => `data:full,${p}`),
  getOutputDir: (_s: any, scene: any) => `outs/${scene.type}/${scene.name}`,
  getVibeImagePath: (_s: any, name: string) => `vibes/${name}`,
});
jest.mock('../index', () => ({
  gameService: mockGame,
  imageService: mockImages,
  isMobile: true,
  workFlowService: { getDef: () => ({ emoji: '' }) },
}));
const mockApp = observable({ sceneCardSizePercent: 50 });
jest.mock('../AppService', () => ({ appState: mockApp }));
jest.mock('react-contexify', () => ({ useContextMenu: () => ({ show: jest.fn(), hideAll: () => {} }) }));
jest.mock('../imageDragOut', () => ({ imageDragOutProps: () => ({}) }));

import { SceneImageView, SceneImageViewHandle } from '../../componenets/SceneImageView';

const T = (n: number) => `${1700000000000 + n}.png`;
let root: Root;
let host: HTMLDivElement;
const session: any = { name: 'p', sceneCardStyle: {}, mirrorImage: undefined };
const mkScene = (name: string) =>
  observable({ name, type: 'scene', mains: [] as string[], workflowType: 'SDI2I', preset: { image: undefined as any } });
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

// jsdom 은 배치를 하지 않는다 — 줄의 스크롤 요소만 크기를 흉내 낸다(씬 Wide = 넘침, 그 밖 = 넘치지 않음)
const metricsOf = (el: HTMLElement) => {
  if (!el.hasAttribute('data-scene-row-scroll')) return undefined;
  const wide = el.parentElement?.getAttribute('data-scene-image-row') === 'Wide';
  return { clientWidth: 300, scrollWidth: wide ? 900 : 300 };
};
const saved: Record<string, PropertyDescriptor | undefined> = {};
beforeAll(() => {
  for (const key of ['clientWidth', 'scrollWidth'] as const) {
    saved[key] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, key);
    Object.defineProperty(HTMLElement.prototype, key, {
      configurable: true,
      get(this: HTMLElement) {
        return metricsOf(this)?.[key] ?? 0;
      },
    });
  }
});
afterAll(() => {
  for (const key of Object.keys(saved)) {
    const d = saved[key];
    if (d) Object.defineProperty(HTMLElement.prototype, key, d);
    else delete (HTMLElement.prototype as any)[key];
  }
});

beforeEach(() => {
  for (const k of Object.keys(mockOutputs)) delete mockOutputs[k];
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function render(scenes: any[]) {
  const ref = createRef<SceneImageViewHandle>();
  const containerRef = createRef<HTMLDivElement>();
  await act(async () => {
    root.render(
      <SceneImageView
        ref={ref}
        type="scene"
        mode="rows"
        session={session}
        scenes={scenes}
        isActive
        containerRef={containerRef}
        searching={false}
        {...handlers()}
      />,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
}

const rowOf = (name: string) => host.querySelector<HTMLElement>(`[data-scene-image-row="${name}"]`)!;
const hintOf = (name: string) => rowOf(name).querySelector<HTMLElement>('[data-scene-row-hint]');

test('모바일 가로 줄: 넘치는 줄만 오른쪽 화살표, 넘기면 왼쪽도, 끝에 닿으면 오른쪽이 사라진다', async () => {
  mockOutputs.Wide = Array.from({ length: 12 }, (_, i) => T(i));
  mockOutputs.Short = [T(1)];
  await render([mkScene('Wide'), mkScene('Short')]);
  // 넘치지 않는 줄에는 힌트가 없다
  expect(hintOf('Short')).toBeNull();
  // 처음 = 오른쪽만
  expect(hintOf('Wide')!.dataset.sceneRowHint).toBe('R');
  // 왼쪽 화살표가 고정된 첫 칸을 가리지 않게 첫 칸 폭만큼 들어가서 시작한다(모바일 칸 폭 = floor(800 / 3.3))
  expect(hintOf('Wide')!.style.left).toBe('242px');
  expect(hintOf('Wide')!.className).toContain('pointer-events-none');
  const scroller = rowOf('Wide').querySelector<HTMLElement>('[data-scene-row-scroll]')!;
  // 모바일은 줄의 가로 막대를 숨긴다
  expect(scroller.className).toContain('no-scrollbar');
  await act(async () => {
    scroller.scrollLeft = 200;
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  expect(hintOf('Wide')!.dataset.sceneRowHint).toBe('LR');
  await act(async () => {
    scroller.scrollLeft = 600;
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  expect(hintOf('Wide')!.dataset.sceneRowHint).toBe('L');
});

// 즐겨찾기 별(2026-11-26) — 모바일(hover 없음)은 항상 옅게 보이고 손가락 크기(히스토리 칸의 별과 같은 규칙)
test('모바일 즐겨찾기 별: 항상 옅게(opacity-60), 크게(w-7 h-7 touch-hit), 즐겨찾기면 진하게', async () => {
  mockOutputs.Short = [T(1), T(2)];
  const s = mkScene('Short');
  s.mains.push(T(1));
  await render([s]);
  const stars = Array.from(rowOf('Short').querySelectorAll<HTMLButtonElement>('[data-scene-image-fav-btn]'));
  // 첫 칸(T2, 즐겨찾기 아님) + 이미지 칸(T1, 즐겨찾기)
  expect(stars.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
  for (const b of stars) {
    expect(b.className).toContain('w-7 h-7 touch-hit');
    expect(b.className).not.toContain('w-6');
    expect(b.className).not.toContain('group-hover');
    expect(b.className).not.toContain('opacity-0');
  }
  expect(stars[0].className).toContain('opacity-60');
  expect(stars[1].className).not.toContain('opacity-60');
});
