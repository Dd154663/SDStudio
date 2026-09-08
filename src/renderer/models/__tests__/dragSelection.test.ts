import { canStartSelectionBox, imagePathsInSelectionBox } from '../dragSelection';

afterEach(() => { document.body.innerHTML = ''; });

test('scene background starts immediately while cards keep normal reordering', () => {
  document.body.innerHTML = '<main><div id="scene-cell-scene-a"><span>Scene</span><button>Queue</button></div></main>';
  const selector = '[id^="scene-cell-"]';
  expect(canStartSelectionBox(document.querySelector('main'), false, selector)).toBe(true);
  expect(canStartSelectionBox(document.querySelector('span'), false, selector)).toBe(false);
  expect(canStartSelectionBox(document.querySelector('span'), true, selector)).toBe(true);
  expect(canStartSelectionBox(document.querySelector('button'), true, selector)).toBe(false);
});

test('image cell padding starts a box; image content requires selection mode', () => {
  document.body.innerHTML = '<div class="image-cell"><div data-image-content><img /></div></div><div class="scrollbar-thumb"></div>';
  expect(canStartSelectionBox(document.querySelector('.image-cell'), false, '[data-image-content]')).toBe(true);
  expect(canStartSelectionBox(document.querySelector('img'), false, '[data-image-content]')).toBe(false);
  expect(canStartSelectionBox(document.querySelector('img'), true, '[data-image-content]')).toBe(true);
  expect(canStartSelectionBox(document.querySelector('.scrollbar-thumb'), true, '[data-image-content]')).toBe(false);
});

test('visible favorite gallery selects its own cells despite duplicate indices elsewhere', () => {
  document.body.innerHTML = '<div id="hidden"><div data-image-index="0"></div></div><main><div data-image-index="0"></div><div data-image-index="1"></div><div data-image-index="2"></div></main>';
  const container = document.querySelector('main')!;
  const rect = (left: number, top: number, width: number, height: number) => ({ left, top, right: left + width, bottom: top + height, width, height } as DOMRect);
  container.getBoundingClientRect = () => rect(100, 200, 300, 300);
  const cells = container.querySelectorAll<HTMLElement>('[data-image-index]');
  cells[0].getBoundingClientRect = () => rect(110, 210, 80, 80);
  cells[1].getBoundingClientRect = () => rect(200, 210, 80, 80);
  cells[2].getBoundingClientRect = () => rect(110, 300, 80, 80);
  expect(imagePathsInSelectionBox(container, ['favorite', 'outside'], { x1: 95, y1: 95, x2: 0, y2: 0 })).toEqual(['favorite']);
  expect(imagePathsInSelectionBox(container, ['favorite', 'outside'], { x1: 0, y1: 0, x2: 300, y2: 300 })).toEqual(['favorite', 'outside']);
});
