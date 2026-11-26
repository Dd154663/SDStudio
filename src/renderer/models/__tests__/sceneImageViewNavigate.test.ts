// 이미지 뷰 1차(2026-11-26) — 히스토리 「해당 씬으로 이동」「이미지 그리드에서 보기」(ImageHistoryService.navigateTo)가
// 이미지 뷰에서는 카드 DOM 대기 대신 등록소(models/sceneImageView)의 칸 인덱스 길을 타고, 씬 카드 보기에서는 종전 DOM 길 그대로인지.
const mockSessionEvents = new EventTarget();
const mockScene = { name: 'S1', type: 'scene' };
const mockSession = { name: 'p', scenes: new Map([['S1', mockScene]]), inpaints: new Map() };
jest.mock('..', () => ({
  backend: {},
  imageService: { addEventListener: () => {}, images: {}, inpaints: {} },
  sessionService: {
    get: async () => mockSession,
    list: () => ['p'],
    dispatchEvent: (e: Event) => mockSessionEvents.dispatchEvent(e),
  },
}));
jest.mock('../ImageService', () => ({ toggleImageMain: jest.fn() }));
jest.mock('../PersistenceService', () => ({ persistService: { write: jest.fn() } }));
const mockApp: any = { pushMessage: jest.fn(), curSession: mockSession };
jest.mock('../appStateRef', () => ({ getAppState: () => mockApp }));

import { ImageHistoryService } from '../ImageHistoryService';
import { registerSceneRevealer } from '../sceneImageView';

const entry = {
  id: 'outs/p/S1/1700000000001.png',
  sessionName: 'p',
  sceneType: 'scene' as const,
  sceneName: 'S1',
  filename: '1700000000001.png',
  path: 'outs/p/S1/1700000000001.png',
  createdAt: 1,
};

let events: string[];
const onOpen = (e: Event) => events.push(`open:${(e as CustomEvent).detail.sceneName}:${(e as CustomEvent).detail.filename}`);
const onClose = () => events.push('close');
beforeEach(() => {
  events = [];
  mockSessionEvents.addEventListener('open-result-viewer', onOpen);
  mockSessionEvents.addEventListener('close-result-viewer', onClose);
});
afterEach(() => {
  mockSessionEvents.removeEventListener('open-result-viewer', onOpen);
  mockSessionEvents.removeEventListener('close-result-viewer', onClose);
  document.body.innerHTML = '';
});

const revealer = (ready = true, found = true) => ({
  isImageView: jest.fn(() => true),
  isReady: jest.fn(() => ready),
  reveal: jest.fn(() => found),
});

test('이미지 뷰: 「이미지 그리드에서 보기」 = 카드 DOM 없이 칸으로 스크롤 후 그리드 열기', async () => {
  const r = revealer();
  const off = registerSceneRevealer('scene', r);
  await new ImageHistoryService().navigateTo(entry, { openGrid: true });
  off();
  expect(r.reveal).toHaveBeenCalledWith('S1');
  expect(events).toEqual(['open:S1:1700000000001.png']);
});

test('이미지 뷰: 「해당 씬으로 이동」 = 그리드를 닫고 칸으로 스크롤', async () => {
  const r = revealer();
  const off = registerSceneRevealer('scene', r);
  await new ImageHistoryService().navigateTo(entry, { openGrid: false });
  off();
  expect(events).toEqual(['close']);
  expect(r.reveal).toHaveBeenCalledWith('S1');
});

test('이미지 뷰: 그 씬의 칸이 없어도(최근 순·이미지 없음) 그리드 열기는 막히지 않는다', async () => {
  const r = revealer(true, false);
  const off = registerSceneRevealer('scene', r);
  await new ImageHistoryService().navigateTo(entry, { openGrid: true });
  off();
  expect(r.reveal).toHaveBeenCalled();
  expect(events).toEqual(['open:S1:1700000000001.png']);
});

test('이미지 뷰: 격자가 그려질 때까지 기다린다(탭 전환 재발신)', async () => {
  let ready = false;
  const r = { isImageView: () => true, isReady: () => ready, reveal: jest.fn(() => true) };
  const off = registerSceneRevealer('scene', r);
  const tabs: string[] = [];
  const onTab = (e: Event) => tabs.push((e as CustomEvent).detail.action);
  window.addEventListener('shortcut-action', onTab);
  setTimeout(() => {
    ready = true;
  }, 150);
  await new ImageHistoryService().navigateTo(entry, { openGrid: true });
  window.removeEventListener('shortcut-action', onTab);
  off();
  expect(tabs.length).toBeGreaterThan(1);
  expect(tabs.every((t) => t === 'tab-1')).toBe(true);
  expect(events).toEqual(['open:S1:1700000000001.png']);
});

test('씬 카드 보기(등록은 있으나 isImageView 거짓): 종전 길 — 카드 DOM 을 찾아 scrollIntoView', async () => {
  const r = { isImageView: () => false, isReady: () => true, reveal: jest.fn(() => true) };
  const off = registerSceneRevealer('scene', r);
  const cell = document.createElement('div');
  cell.id = 'scene-cell-scene-S1';
  document.body.appendChild(cell);
  Object.defineProperty(cell, 'offsetParent', { get: () => document.body });
  const scroll = jest.fn();
  (cell as any).scrollIntoView = scroll;
  await new ImageHistoryService().navigateTo(entry, { openGrid: false });
  off();
  expect(r.reveal).not.toHaveBeenCalled();
  expect(events).toEqual(['close']);
  expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
});
