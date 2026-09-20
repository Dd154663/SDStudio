/** @jest-environment jsdom */
import {
  EDGE_SWIPE_IGNORE_ATTR,
  shouldIgnoreEdgeSwipe,
  shouldIgnoreEdgeSwipeAt,
  createSwipeTracker,
  canOpenDrawerBySwipe,
  isInsideOverlay,
} from '../edgeSwipe';

function setSize(el: HTMLElement, scrollWidth: number, clientWidth: number) {
  Object.defineProperty(el, 'scrollWidth', { value: scrollWidth, configurable: true });
  Object.defineProperty(el, 'clientWidth', { value: clientWidth, configurable: true });
}

describe('shouldIgnoreEdgeSwipe', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('일반 영역에서 시작한 터치는 가장자리 스와이프로 허용한다', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    expect(shouldIgnoreEdgeSwipe(div)).toBe(false);
    expect(shouldIgnoreEdgeSwipe(null)).toBe(false);
  });

  it('가로 스크롤 영역 안에서 시작한 터치는 양보한다', () => {
    const row = document.createElement('div');
    row.style.overflowX = 'auto';
    setSize(row, 600, 300);
    const button = document.createElement('button');
    row.appendChild(button);
    document.body.appendChild(row);
    expect(shouldIgnoreEdgeSwipe(button)).toBe(true);
  });

  it('넘치지 않거나 overflow 가 visible 인 영역은 양보하지 않는다', () => {
    const fits = document.createElement('div');
    fits.style.overflowX = 'auto';
    setSize(fits, 300, 300);
    const visible = document.createElement('div');
    setSize(visible, 600, 300);
    document.body.append(fits, visible);
    expect(shouldIgnoreEdgeSwipe(fits)).toBe(false);
    expect(shouldIgnoreEdgeSwipe(visible)).toBe(false);
  });

  it('표식 속성 영역과 range 슬라이더는 양보한다', () => {
    const viewer = document.createElement('div');
    viewer.setAttribute(EDGE_SWIPE_IGNORE_ATTR, '');
    const img = document.createElement('img');
    viewer.appendChild(img);
    const range = document.createElement('input');
    range.type = 'range';
    document.body.append(viewer, range);
    expect(shouldIgnoreEdgeSwipe(img)).toBe(true);
    expect(shouldIgnoreEdgeSwipe(range)).toBe(true);
  });

  it('텍스트 노드에서 시작해도 부모 기준으로 판정한다', () => {
    const viewer = document.createElement('div');
    viewer.setAttribute(EDGE_SWIPE_IGNORE_ATTR, '');
    const text = document.createTextNode('x');
    viewer.appendChild(text);
    document.body.appendChild(viewer);
    expect(shouldIgnoreEdgeSwipe(text)).toBe(true);
  });

  it('target 이 바깥 여백이어도 안쪽 지점이 가로 스크롤 행이면 양보한다', () => {
    const margin = document.createElement('div');
    const row = document.createElement('div');
    row.style.overflowX = 'auto';
    setSize(row, 600, 300);
    document.body.append(margin, row);
    const probe = jest.fn().mockReturnValue(row);
    (document as any).elementFromPoint = probe;
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    expect(shouldIgnoreEdgeSwipeAt(margin, 385, 170, 'right')).toBe(true);
    expect(probe).toHaveBeenCalledWith(357, 170);
    probe.mockReturnValue(margin);
    expect(shouldIgnoreEdgeSwipeAt(margin, 385, 600, 'right')).toBe(false);
    expect(shouldIgnoreEdgeSwipeAt(margin, 5, 170, 'left')).toBe(false);
    expect(probe).toHaveBeenLastCalledWith(33, 170);
    delete (document as any).elementFromPoint;
  });
});

describe('createSwipeTracker', () => {
  it('수평 우세로 40px 넘게 밀면 한 번만 발동한다', () => {
    const t = createSwipeTracker('right');
    t.start(5, 300, 0);
    expect(t.move(30, 302, 50)).toBe(false);
    expect(t.move(50, 305, 90)).toBe(true);
    expect(t.move(90, 305, 120)).toBe(false);
  });

  it('방향이 반대거나 세로가 우세하면 발동하지 않는다', () => {
    const left = createSwipeTracker('left');
    left.start(300, 300, 0);
    expect(left.move(360, 300, 60)).toBe(false);
    const right = createSwipeTracker('right');
    right.start(5, 300, 0);
    expect(right.move(50, 400, 60)).toBe(false);
  });

  it('왼쪽 방향은 오른쪽에서 왼쪽으로 밀 때 발동한다', () => {
    const t = createSwipeTracker('left');
    t.start(300, 300, 0);
    expect(t.move(250, 303, 80)).toBe(true);
  });

  it('길게 누른 뒤 움직이기 시작한 터치는 스와이프로 치지 않는다', () => {
    const t = createSwipeTracker('left');
    t.start(300, 300, 0);
    expect(t.move(302, 300, 200)).toBe(false);
    expect(t.move(240, 300, 450)).toBe(false);
    expect(t.move(100, 300, 600)).toBe(false);
  });

  it('end 이후에는 발동하지 않는다', () => {
    const t = createSwipeTracker('right');
    t.start(5, 300, 0);
    t.end();
    expect(t.move(100, 300, 50)).toBe(false);
  });
});

describe('canOpenDrawerBySwipe', () => {
  it('자기나 반대쪽 드로어가 열려 있으면 열기 스와이프를 막는다', () => {
    expect(canOpenDrawerBySwipe({ selfOpen: false, otherOpen: false })).toBe(true);
    expect(canOpenDrawerBySwipe({ selfOpen: true, otherOpen: false })).toBe(false);
    expect(canOpenDrawerBySwipe({ selfOpen: false, otherOpen: true })).toBe(false);
  });
});

describe('isInsideOverlay', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });
  it('모달·뷰어 안의 터치만 오버레이로 본다', () => {
    document.body.innerHTML =
      '<div id="main"><span id="a"></span></div><div class="fixed inset-0"><b id="m"></b></div><div class="float-view"><i id="v"></i></div>';
    expect(isInsideOverlay(document.getElementById('a'))).toBe(false);
    expect(isInsideOverlay(document.getElementById('m'))).toBe(true);
    expect(isInsideOverlay(document.getElementById('v'))).toBe(true);
    expect(isInsideOverlay(null)).toBe(false);
  });
});
