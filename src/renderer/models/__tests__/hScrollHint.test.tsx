/** @jest-environment jsdom */
import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import {
  HScrollHintArrow,
  calcHScrollHint,
  useHScrollHint,
} from '../../componenets/HScrollHint';

describe('calcHScrollHint', () => {
  it('넘치지 않으면 양쪽 모두 없음', () => {
    expect(
      calcHScrollHint({ scrollLeft: 0, clientWidth: 300, scrollWidth: 300 }),
    ).toEqual({ left: false, right: false });
  });
  it('처음 위치에서는 오른쪽만, 중간은 양쪽, 끝에서는 왼쪽만', () => {
    expect(
      calcHScrollHint({ scrollLeft: 0, clientWidth: 300, scrollWidth: 425 }),
    ).toEqual({ left: false, right: true });
    expect(
      calcHScrollHint({ scrollLeft: 60, clientWidth: 300, scrollWidth: 425 }),
    ).toEqual({ left: true, right: true });
    expect(
      calcHScrollHint({ scrollLeft: 125, clientWidth: 300, scrollWidth: 425 }),
    ).toEqual({ left: true, right: false });
  });
});

function Row({ width }: { width: number }) {
  const { ref, hint, onScroll } = useHScrollHint<HTMLDivElement>();
  return (
    <div>
      <div
        data-testid="row"
        ref={(el) => {
          if (el) {
            Object.defineProperty(el, 'clientWidth', { value: 300, configurable: true });
            Object.defineProperty(el, 'scrollWidth', { value: width, configurable: true });
          }
          ref.current = el;
        }}
        onScroll={onScroll}
      />
      {hint.left && <HScrollHintArrow side="left" surface="red" />}
      {hint.right && (
        <HScrollHintArrow side="right" surface="red" positionClass="right-full" />
      )}
    </div>
  );
}

describe('useHScrollHint', () => {
  it('넘침과 스크롤 위치에 따라 화살표가 바뀐다', () => {
    const { container, getByTestId, rerender } = render(<Row width={300} />);
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBe(0);
    rerender(<Row width={425} />);
    let arrows = container.querySelectorAll('[aria-hidden="true"]');
    expect(arrows.length).toBe(1);
    expect(arrows[0].className).toContain('right-full');
    const row = getByTestId('row');
    row.scrollLeft = 125;
    fireEvent.scroll(row);
    arrows = container.querySelectorAll('[aria-hidden="true"]');
    expect(arrows.length).toBe(1);
    expect(arrows[0].className).toContain('left-0');
  });
});
