import {
  applySweepSelection,
  edgeAutoScrollSpeed,
  indicesInBox,
} from '../dragSelection';

describe('indicesInBox', () => {
  const rects = [
    { index: 0, left: 0, top: 0, right: 100, bottom: 100 },
    { index: 1, left: 110, top: 0, right: 210, bottom: 100 },
    { index: 2, left: 0, top: 110, right: 100, bottom: 210 },
    { index: 3, left: 0, top: 0, right: 0, bottom: 0 }, // 숨겨진 항목(크기 0)
  ];
  it('상자와 겹치는 항목만 고른다', () => {
    expect(indicesInBox(rects, { x1: 50, y1: 50, x2: 150, y2: 60 })).toEqual([0, 1]);
  });
  it('끄는 방향과 무관하다(오른쪽 아래에서 왼쪽 위로)', () => {
    expect(indicesInBox(rects, { x1: 150, y1: 150, x2: 50, y2: 50 })).toEqual([0, 1, 2]);
  });
  it('항목 사이 빈틈만 지나면 아무것도 고르지 않는다', () => {
    expect(indicesInBox(rects, { x1: 102, y1: 0, x2: 108, y2: 300 })).toEqual([]);
  });
});

describe('applySweepSelection', () => {
  const names = ['a', 'b', 'c', 'd', 'e'];
  it('시작~현재 범위를 선택한다', () => {
    expect([...applySweepSelection(new Set(), names, 1, 3, true)].sort()).toEqual(['b', 'c', 'd']);
  });
  it('거꾸로 끌어도 같은 범위다', () => {
    expect([...applySweepSelection(new Set(), names, 3, 1, true)].sort()).toEqual(['b', 'c', 'd']);
  });
  it('범위를 줄이면 벗어난 항목은 시작 전 상태로 돌아간다', () => {
    const base = new Set(['e']);
    const wide = applySweepSelection(base, names, 0, 4, true);
    expect(wide.size).toBe(5);
    expect([...applySweepSelection(base, names, 0, 1, true)].sort()).toEqual(['a', 'b', 'e']);
  });
  it('해제 모드는 범위 안의 선택만 지운다', () => {
    const base = new Set(['a', 'b', 'c', 'e']);
    expect([...applySweepSelection(base, names, 1, 2, false)].sort()).toEqual(['a', 'e']);
  });
  it('base 를 바꾸지 않는다', () => {
    const base = new Set(['a']);
    applySweepSelection(base, names, 0, 4, false);
    expect([...base]).toEqual(['a']);
  });
});

describe('edgeAutoScrollSpeed', () => {
  it('가운데에서는 0, 위쪽 가장자리는 음수, 아래쪽은 양수', () => {
    expect(edgeAutoScrollSpeed(300, 100, 500)).toBe(0);
    expect(edgeAutoScrollSpeed(105, 100, 500)).toBeLessThan(0);
    expect(edgeAutoScrollSpeed(495, 100, 500)).toBeGreaterThan(0);
  });
  it('영역 밖으로 나가도 최대 속도를 넘지 않는다', () => {
    expect(edgeAutoScrollSpeed(-500, 100, 500)).toBe(-14);
    expect(edgeAutoScrollSpeed(5000, 100, 500)).toBe(14);
  });
});
