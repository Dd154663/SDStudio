import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { observable, runInAction } from 'mobx';

class TrackedEvents extends EventTarget {
  listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  addEventListener(type: string, listener: any, options?: any) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
    super.addEventListener(type, listener, options);
  }
  removeEventListener(type: string, listener: any, options?: any) {
    this.listeners.get(type)?.delete(listener);
    super.removeEventListener(type, listener, options);
  }
  count(type: string) { return this.listeners.get(type)?.size ?? 0; }
  emit(type: string) { this.dispatchEvent(new Event(type)); }
}
let remaining = 1;
let outputs = ['a.png', 'b.png'];
const queue = Object.assign(new TrackedEvents(), {
  statsTasksFromScene: jest.fn(() => ({ total: remaining, done: 0 })),
});
const game = Object.assign(new TrackedEvents(), { getOutputs: jest.fn(() => outputs) });
const images = Object.assign(new TrackedEvents(), {
  fetchImageSmall: jest.fn(async () => 'preview-current'),
  fetchVibeImage: jest.fn(async () => 'representative'),
  getOutputDir: () => 'outs/project/scene',
});
const sessions = Object.assign(new TrackedEvents(), {
  getSceneBookmark: () => undefined,
  isSceneBookmarked: () => false,
});
const state: any = {
  selectedScenes: new Set(), dialogs: [], samples: 1, floatViewCount: 0,
  uiToolbar: { classic: false },
  clearSceneSelection: jest.fn(), toggleSceneSelection: jest.fn(),
};
const dragSpecs = new Map<any, any>();
const dropSpecs: any[] = [];
jest.mock('react-dnd', () => ({
  useDrag: (factory: any) => {
    const spec = factory();
    dragSpecs.set(spec.item().scene, spec);
    return [{ isDragging: false }, (node: any) => node, () => {}];
  },
  useDrop: (factory: any) => {
    dropSpecs.push(factory());
    return [{ isOver: false }, (node: any) => node];
  },
}));
jest.mock('react-dnd-html5-backend', () => ({ getEmptyImage: () => null }));
jest.mock('react-contexify', () => ({ useContextMenu: () => ({ show: () => {}, hideAll: () => {} }) }));
jest.mock('..', () => ({
  isMobile: false, taskQueueService: queue, imageService: images, gameService: game,
  sessionService: sessions, workFlowService: { getDef: () => ({ emoji: '' }), i2iFlows: [] },
  backend: {}, localAIService: {}, zipService: {}, trashService: {}, promptService: {},
}));
jest.mock('../AppService', () => ({ appState: state }));
jest.mock('../types', () => ({ ContextMenuType: { Scene: 'scene', Image: 'image' } }));
jest.mock('../ImageService', () => ({ toggleImageMain: jest.fn() }));
jest.mock('../TaskQueueService', () => ({}));
jest.mock('../sceneQueueActions', () => ({}));
jest.mock('../util', () => ({}));
jest.mock('../workflows/SDWorkFlow', () => ({}));
jest.mock('../workflows/OneTimeFlows', () => ({ oneTimeFlows: [], oneTimeFlowMap: new Map() }));
jest.mock('../sceneSeedGroups', () => ({ getSceneSeedGroupInfo: () => undefined }));
jest.mock('../combinationSelection', () => ({}));
jest.mock('../companionSlots', () => ({ companionAssignedIds: () => new Set() }));
jest.mock('../uiLayout', () => ({ TOOLBAR_VIEW_MAIN: [], resolveToolbarView: () => [] }));
jest.mock('../BackStackService', () => ({ backStackService: { push: () => ({ remove() {} }) } }));
jest.mock('../../componenets/FloatView', () => ({ FloatView: ({ children }: any) => children }));
jest.mock('../../componenets/ModalOverlay', () => ({ children }: any) => children);
jest.mock('../../componenets/SceneEditor', () => () => null);
jest.mock('../../componenets/Tournament', () => () => null);
jest.mock('../../componenets/ResultViewer', () => () => <div data-viewer />);
jest.mock('../../componenets/InPaintEditor', () => () => null);
jest.mock('../../componenets/ImageReview', () => () => null);
jest.mock('../../componenets/ShortcutCheatsheet', () => () => null);
jest.mock('../../componenets/SceneQuickPromptModal', () => () => null);
jest.mock('../../componenets/BrushTool', () => ({}));
jest.mock('../../componenets/SceneSelector', () => () => null);
jest.mock('../../componenets/Tooltip', () => ({ children }: any) => children);
jest.mock('../../componenets/CombinationList', () => ({}));
jest.mock('../../componenets/ToolbarOverflowMenu', () => () => null);
jest.mock('../../componenets/PortableToolbarButtons', () => ({ portableToolbarButtons: () => ({}) }));
jest.mock('../../componenets/ToolbarDnd', () => ({
  useToolbarDragState: () => ({ active: false }),
  useToolbarRowDrop: () => ({ drop: () => {}, isOver: false }),
  toolbarRowHighlightClass: () => '',
  DraggableToolbarButton: ({ children }: any) => children,
  ToolbarHideZone: () => null, ToolbarMenuDropTarget: ({ children }: any) => children,
}));
import QueueControl, { SceneCell } from '../../componenets/SceneQueueControl';

let root: Root;
let container: HTMLDivElement;
let scene: any;
let session: any;
let getImage: jest.Mock;
function deferred() {
  let resolve!: (value: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const currentImage = () => container.querySelector('img')?.getAttribute('src');
async function renderCard(active = true, extra: any = {}) {
  await act(async () => root.render(<SceneCell scene={scene} curSession={session} getImage={getImage}
    cellSize={0} sceneIndex={0} isActive={active} {...extra} />));
}
beforeEach(() => {
  (global as any).IS_REACT_ACT_ENVIRONMENT = true;
  remaining = 1; outputs = ['a.png', 'b.png'];
  jest.clearAllMocks(); dragSpecs.clear(); dropSpecs.length = 0;
  scene = observable({ name: 'scene', type: 'inpaint', workflowType: 'test', mains: [], preset: { image: 'source' }, imageMap: [] });
  session = { name: 'project', getScenes: jest.fn(() => [scene]), sceneCardStyle: {}, inpaints: new Map([[scene.name, scene]]), scenes: new Map() };
  state.curSession = session;
  state.selectedScenes.clear();
  getImage = jest.fn(async () => 'initial');
  images.fetchImageSmall.mockReset().mockResolvedValue('preview-current');
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount()); container.remove();
  expect(queue.count('progress')).toBe(0);
  expect(game.count('updated')).toBe(0);
  expect(images.count('image-cache-invalidated')).toBe(0);
});

test('hidden cards detach display subscriptions, preserve DOM and catch up once', async () => {
  await renderCard();
  const card = container.firstChild;
  expect(getImage).toHaveBeenCalledTimes(1);
  await renderCard(false);
  getImage.mockClear(); queue.statsTasksFromScene.mockClear();
  remaining = 9;
  await act(async () => {
    for (let i = 0; i < 20; i++) { queue.emit('progress'); game.emit('updated'); images.emit('image-cache-invalidated'); }
    runInAction(() => { scene.mains.push('new.png'); scene.preset.image = 'changed'; });
  });
  expect(queue.count('progress')).toBe(0);
  expect(getImage).not.toHaveBeenCalled();
  // MobX can still render observable changes; this test targets subscriptions, not all renders.
  expect(container.firstChild).toBe(card);
  getImage.mockResolvedValue('fresh');
  await renderCard(true);
  expect(getImage).toHaveBeenCalledTimes(1);
  expect(currentImage()).toBe('fresh');
  expect(container.textContent).toContain('9');
  for (let i = 0; i < 100; i++) { await renderCard(false); await renderCard(true); }
  expect(queue.count('progress')).toBe(1);
  expect(game.count('updated')).toBe(1);
  expect(images.count('image-cache-invalidated')).toBe(1);
});

test.each(['resolve', 'reject'] as const)('discard %s from an obsolete image request after reactivation', async (finish) => {
  const old = deferred();
  getImage.mockReturnValueOnce(old.promise).mockResolvedValue('fresh');
  await renderCard();
  await renderCard(false);
  await renderCard(true);
  await act(async () => { if (finish === 'resolve') old.resolve('stale'); else old.reject(new Error('stale')); });
  expect(currentImage()).toBe('fresh');
});

test('newer image events win and changing getImage identity does not resubscribe', async () => {
  await renderCard();
  const old = deferred();
  getImage.mockReturnValueOnce(old.promise).mockResolvedValue('newest');
  await act(async () => game.emit('updated'));
  await act(async () => images.emit('image-cache-invalidated'));
  await act(async () => old.resolve('obsolete'));
  expect(currentImage()).toBe('newest');
  const replacement = jest.fn(async () => 'replacement');
  await renderCard(true, { getImage: replacement });
  expect(replacement).not.toHaveBeenCalled();
  await act(async () => game.emit('updated'));
  expect(replacement).toHaveBeenCalledTimes(1);
  expect(currentImage()).toBe('replacement');
});

test('preview requests and keyboard navigation stop while hidden and stale results are ignored', async () => {
  const old = deferred();
  images.fetchImageSmall.mockReturnValueOnce(old.promise).mockResolvedValue('preview-fresh');
  await renderCard(true, { isFocused: true });
  const navigate = () => window.dispatchEvent(new CustomEvent('scene-image-nav', {
    detail: { sceneName: scene.name, sceneType: scene.type, action: 'next' },
  }));
  await act(async () => navigate());
  await renderCard(false, { isFocused: true });
  const calls = images.fetchImageSmall.mock.calls.length;
  await act(async () => navigate());
  expect(images.fetchImageSmall).toHaveBeenCalledTimes(calls);
  await renderCard(true, { isFocused: true });
  await act(async () => old.resolve('preview-stale'));
  expect(currentImage()).toBe('preview-fresh');
});

test('passed original index (including zero) avoids per-card scans; preview fallback remains', async () => {
  await renderCard(true, { sceneIndex: 7 });
  expect(dragSpecs.get(scene).item().curIndex).toBe(7);
  expect(session.getScenes).not.toHaveBeenCalled();
  await renderCard(true, { sceneIndex: 0 });
  expect(dragSpecs.get(scene).item().curIndex).toBe(0);
  expect(session.getScenes).not.toHaveBeenCalled();
  await renderCard(true, { sceneIndex: undefined });
  expect(session.getScenes).toHaveBeenCalled();
  expect(dragSpecs.get(scene).item().curIndex).toBe(0);
});

test('filtered QueueControl passes original indices and stops parent plus card progress listeners', async () => {
  const scenes = Array.from({ length: 8 }, (_, i) => ({ ...scene, name: `scene-${i}`, mains: [] }));
  session.getScenes.mockImplementation(() => scenes);
  const filter = (item: any) => item.name === 'scene-7';
  await act(async () => root.render(<QueueControl type="inpaint" filterFunc={filter} isActive />));
  expect(dragSpecs.get(scenes[7]).item().curIndex).toBe(7);
  expect(queue.count('progress')).toBe(2);
  await act(async () => root.render(<QueueControl type="inpaint" filterFunc={filter} isActive={false} />));
  expect(queue.count('progress')).toBe(0);
  session.getScenes.mockClear();
  await act(async () => queue.emit('progress'));
  expect(session.getScenes).not.toHaveBeenCalled();
  expect(sessions.count('close-result-viewer')).toBe(1);
});

test('drag rollback retains its start index, while a multi-drop reads the current order', async () => {
  const moveScene = jest.fn();
  const moveScenes = jest.fn();
  const other = { ...scene, name: 'other' };
  session.inpaints.set(other.name, other);
  await renderCard(true, { sceneIndex: 7, moveScene, moveScenes });
  const drag = dragSpecs.get(scene);
  drag.end(drag.item(), { didDrop: () => false });
  expect(moveScene).toHaveBeenCalledWith(scene, 7);
  session.getScenes.mockReturnValue([other, scene]);
  dropSpecs[dropSpecs.length - 1].drop({ scene: other, selectedSceneNames: [other.name, scene.name] }, {});
  expect(moveScenes).toHaveBeenCalledWith([other, scene], 1);
});

test.each([100, 500, 1000])('%i cards use a constant number of list scans per progress event', async (count) => {
  const scenes = Array.from({ length: count }, (_, i) => ({ ...scene, name: `scene-${i}`, mains: [] }));
  session.getScenes.mockImplementation(() => scenes);
  await act(async () => root.render(<QueueControl type="inpaint" isActive />));
  expect(queue.count('progress')).toBe(count + 1);
  session.getScenes.mockClear();
  images.fetchVibeImage.mockClear();
  // Separate acts prevent React's event batching from hiding repeated work.
  for (let i = 0; i < 3; i++) await act(async () => queue.emit('progress'));
  expect(session.getScenes.mock.calls.length).toBeLessThanOrEqual(12);
  expect(images.fetchVibeImage).not.toHaveBeenCalled();
  await act(async () => root.render(<QueueControl type="inpaint" isActive={false} />));
  session.getScenes.mockClear();
  for (let i = 0; i < 100; i++) await act(async () => queue.emit('progress'));
  expect(queue.count('progress')).toBe(0);
  expect(session.getScenes).not.toHaveBeenCalled();
  expect(images.fetchVibeImage).not.toHaveBeenCalled();
});
