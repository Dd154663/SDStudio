/** @jest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import Tooltip, {
  TOUCH_HOLD_MS,
  TOUCH_LINGER_MS,
} from '../../componenets/Tooltip';

const LABEL = '예약 추가';
const touch = (x = 10, y = 10) => ({ touches: [{ clientX: x, clientY: y }] });

function setup() {
  const onClick = jest.fn();
  const onCardMenu = jest.fn();
  render(
    <div onContextMenu={onCardMenu}>
      <Tooltip content={LABEL}>
        <button onClick={onClick}>plus</button>
      </Tooltip>
      <button>other</button>
    </div>,
  );
  return {
    trigger: screen.getByText('plus'),
    other: screen.getByText('other'),
    onClick,
    onCardMenu,
  };
}

describe('Tooltip 터치 계약', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('닿는 즉시 뜨고, 짧게 탭하면 버튼이 실행되며 합성 마우스 이벤트에도 남는다', () => {
    const { trigger, onClick } = setup();
    fireEvent.touchStart(trigger, touch());
    expect(screen.queryByText(LABEL)).not.toBeNull();
    act(() => jest.advanceTimersByTime(100));
    fireEvent.touchEnd(trigger);
    fireEvent.mouseEnter(trigger);
    fireEvent.mouseDown(trigger);
    fireEvent.click(trigger);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(LABEL)).not.toBeNull();
  });

  it('길게 누르면 실행하지 않고 설명만 남기며, 다음 탭은 정상 실행된다', () => {
    const { trigger, onClick, onCardMenu } = setup();
    fireEvent.touchStart(trigger, touch());
    act(() => jest.advanceTimersByTime(TOUCH_HOLD_MS + 50));
    fireEvent.contextMenu(trigger);
    fireEvent.touchEnd(trigger);
    fireEvent.click(trigger);
    expect(onClick).not.toHaveBeenCalled();
    expect(onCardMenu).not.toHaveBeenCalled();
    expect(screen.queryByText(LABEL)).not.toBeNull();

    fireEvent.touchStart(trigger, touch());
    act(() => jest.advanceTimersByTime(80));
    fireEvent.touchEnd(trigger);
    fireEvent.click(trigger);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('길게 눌렀지만 click 이 오지 않아도 다음 클릭을 삼키지 않는다', () => {
    const { trigger, onClick } = setup();
    fireEvent.touchStart(trigger, touch());
    act(() => jest.advanceTimersByTime(TOUCH_HOLD_MS + 50));
    fireEvent.touchEnd(trigger);
    act(() => jest.advanceTimersByTime(600));
    fireEvent.click(trigger);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('누른 채 이동하면 길게 누름으로 치지 않는다', () => {
    const { trigger, onClick } = setup();
    fireEvent.touchStart(trigger, touch(10, 10));
    fireEvent.touchMove(trigger, touch(60, 10));
    act(() => jest.advanceTimersByTime(TOUCH_HOLD_MS + 50));
    fireEvent.touchEnd(trigger);
    fireEvent.click(trigger);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('손을 뗀 뒤 유지 시간이 지나면 숨긴다', () => {
    const { trigger } = setup();
    fireEvent.touchStart(trigger, touch());
    fireEvent.touchEnd(trigger);
    act(() => jest.advanceTimersByTime(TOUCH_LINGER_MS - 100));
    expect(screen.queryByText(LABEL)).not.toBeNull();
    act(() => jest.advanceTimersByTime(200));
    expect(screen.queryByText(LABEL)).toBeNull();
  });

  it('다른 곳 터치·스크롤에는 즉시 닫힌다', () => {
    const { trigger, other } = setup();
    fireEvent.touchStart(trigger, touch());
    fireEvent.touchEnd(trigger);
    fireEvent.touchStart(other, touch());
    expect(screen.queryByText(LABEL)).toBeNull();
    fireEvent.touchStart(trigger, touch());
    act(() => {
      document.dispatchEvent(new Event('scroll'));
    });
    expect(screen.queryByText(LABEL)).toBeNull();
  });

  it('버튼이 다른 창에 가려지면 유지 시간을 기다리지 않고 닫는다', () => {
    const { trigger, other } = setup();
    (document as any).elementFromPoint = jest.fn().mockReturnValue(other);
    trigger.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 30, height: 30 }) as DOMRect;
    fireEvent.touchStart(trigger, touch());
    fireEvent.touchEnd(trigger);
    act(() => jest.advanceTimersByTime(250));
    expect(screen.queryByText(LABEL)).toBeNull();
    delete (document as any).elementFromPoint;
  });

  it('마우스 호버와 우클릭 전파는 그대로다', () => {
    const { trigger, onCardMenu } = setup();
    fireEvent.mouseEnter(trigger);
    act(() => jest.advanceTimersByTime(250));
    expect(screen.queryByText(LABEL)).not.toBeNull();
    fireEvent.contextMenu(trigger);
    expect(onCardMenu).toHaveBeenCalledTimes(1);
    fireEvent.mouseLeave(trigger);
    expect(screen.queryByText(LABEL)).toBeNull();
  });
});
