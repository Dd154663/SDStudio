import React from 'react';
import { opusCheckedLabel, presentOpusUsage } from '../opusUsagePresentation';
import OpusUsageMeter, { OpusUsageBar } from '../../componenets/OpusUsageMeter';

const status = (percent: number, isNegative = false) => ({
  percent,
  isNegative,
  timeUntilNextPercent: 0,
});
let render: (node: React.ReactNode) => string;
beforeAll(() => {
  const util = require('util');
  (global as any).TextEncoder ??= util.TextEncoder;
  (global as any).TextDecoder ??= util.TextDecoder;
  render = require('react-dom/server').renderToStaticMarkup;
});

test.each([
  [91, 1574],
  [88, 1522],
  [100, 1730],
  [111, 1920],
])('잔량 %s%%의 표준 생성 환산은 약 %s장', (percent, images) => {
  expect(presentOpusUsage(status(percent)).images).toBe(images);
});

test('미조회와 소진은 별개이며 음수 상태는 양수 퍼센트보다 우선한다', () => {
  expect(presentOpusUsage()).toMatchObject({
    text: '—',
    images: undefined,
    tone: 'gray',
  });
  expect(presentOpusUsage(status(42, true))).toMatchObject({
    text: '0%',
    images: 0,
    tone: 'red',
  });
  expect(presentOpusUsage(status(15), 20).tone).toBe('orange');
});

test('초과 잔량의 숫자는 유지하고 막대만 100%로 제한한다', () => {
  const html = render(<OpusUsageMeter status={status(111)} />);
  expect(html).toContain('111%');
  expect(html).toContain('1,920');
  expect(html).toContain('11%p 초과');
  expect(html).toContain('width:100%');
  expect(html).not.toContain('width:111%');
});

test('미조회에는 소진 경고나 0장 추정을 표시하지 않는다', () => {
  const html = render(<OpusUsageMeter error="조회 실패" />);
  expect(html).toContain('조회 실패');
  expect(html).not.toContain('할당량 소진');
  expect(html).not.toContain('약 0장');
  expect(render(<OpusUsageBar />)).not.toContain('aria-valuenow');
});

test('실제 소진에는 Anlas 사용 안내를 표시한다', () => {
  expect(render(<OpusUsageMeter status={status(0)} />)).toContain(
    '생성 시 Anlas 사용',
  );
});

test('확인 시각 표시는 조회 없이 시간 차이를 계산한다', () => {
  expect(opusCheckedLabel(0)).toBe('아직 확인하지 않음');
  expect(opusCheckedLabel(1000, 1001)).toBe('방금 확인');
  expect(opusCheckedLabel(1000, 121000)).toBe('2분 전 확인');
  expect(opusCheckedLabel(1000, 7201000)).toBe('2시간 전 확인');
});
