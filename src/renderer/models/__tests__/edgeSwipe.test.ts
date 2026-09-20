/** @jest-environment jsdom */
import {
  EDGE_SWIPE_IGNORE_ATTR,
  shouldIgnoreEdgeSwipe,
  shouldIgnoreEdgeSwipeAt,
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
