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

test('미구독은 X로 표시하고 잔량·예상 장수·소진 경고를 표시하지 않는다', () => {
  const unsubscribed = { ...status(100), opusSubscribed: false };
  expect(presentOpusUsage(unsubscribed)).toMatchObject({ text: 'X', percent: undefined, images: undefined, tone: 'gray' });
  const html = render(<OpusUsageMeter status={unsubscribed} />);
  expect(html).toContain('Opus 미구독');
  expect(html).not.toContain('100%');
  expect(html).not.toContain('약 ');
  expect(html).not.toContain('할당량 소진');
  expect(html).not.toContain('progressbar');
});

describe('추가 충전(purchasedPercent) 표시(2026-10-25)', () => {
  const boosted = (percent: number, purchasedPercent: number, isNegative = false) => ({
    opusSubscribed: true, percent, purchasedPercent, isNegative, timeUntilNextPercent: 0,
  });

  test('배지 글자는 합산, 상세는 「X% + Y%」, 예상 장수는 합산', () => {
    const view = presentOpusUsage(boosted(80, 100));
    expect(view).toMatchObject({
      text: '180%', detailText: '80% + 100%', percent: 180, free: 80, purchased: 100,
      images: Math.floor(180 * 17.3), tone: 'green', usingPurchased: false,
    });
  });

  test('막대 눈금 0~100 고정 — 무료·추가 충전 막대는 각자 길이로 0 에서 시작해 겹친다', () => {
    // 무료 < 추가 충전: 보라 50 위에 무료 30, 겹침 0~30
    expect(presentOpusUsage(boosted(30, 50))).toMatchObject({
      fill: 50, freeFill: 30, purchasedFill: 50, overlapFill: 30, text: '80%',
    });
    // 무료 > 추가 충전: 무료 80 이 보라 20 을 다 덮음 — 겹침 0~20 으로 드러냄
    expect(presentOpusUsage(boosted(80, 20))).toMatchObject({
      fill: 80, freeFill: 80, purchasedFill: 20, overlapFill: 20,
    });
    // 100 초과는 막대에서만 자르고 수치·예상 장수는 합산 그대로
    expect(presentOpusUsage(boosted(80, 150))).toMatchObject({
      fill: 100, freeFill: 80, purchasedFill: 100, overlapFill: 80,
      text: '230%', images: Math.floor(230 * 17.3),
    });
    expect(presentOpusUsage(boosted(120, 150))).toMatchObject({
      fill: 100, freeFill: 100, purchasedFill: 100, overlapFill: 100,
    });
    // 추가 충전분 0 이면 종전 단일 막대(초과분 100 에서 자름), 보라·겹침 없음
    expect(presentOpusUsage(boosted(111, 0))).toMatchObject({
      fill: 100, freeFill: 100, purchasedFill: 0, overlapFill: 0, text: '111%', detailText: '111%',
    });
    // 무료 0·추가 충전만: 보라만, 겹침 없음
    expect(presentOpusUsage(boosted(0, 40))).toMatchObject({
      fill: 40, freeFill: 0, purchasedFill: 40, overlapFill: 0,
    });
  });

  test('2중첩 막대는 보라(아래)→무료(위)→겹침(맨 위) 순서로 그리고, 추가 충전분 0 이면 단일 막대', () => {
    const html = render(<OpusUsageBar status={boosted(30, 50)} />);
    const order = ['purchased', 'free', 'overlap'].map((k) => html.indexOf(`data-opus-bar="${k}"`));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).toContain('var(--c-purple-bg)');
    expect(html).toMatch(/data-opus-bar="purchased"[^>]*width:50%/);
    expect(html).toMatch(/data-opus-bar="free"[^>]*width:30%/);
    expect(html).toMatch(/data-opus-bar="overlap"[^>]*width:30%/);
    expect(html).toContain('opus-usage-bar-overlap');
    // aria-valuenow = 눈금상 막대 길이(더 긴 막대 끝), valuetext 는 분리 수치
    expect(html).toContain('aria-valuenow="50"');
    expect(html).toContain('무료 30%, 추가 충전 50% 남음');
    const plain = render(<OpusUsageBar status={boosted(80, 0)} />);
    expect(plain).not.toContain('data-opus-bar="purchased"');
    expect(plain).not.toContain('data-opus-bar="overlap"');
    expect(plain).not.toContain('--c-purple');
    const boostOnly = render(<OpusUsageBar status={boosted(0, 40)} />);
    expect(boostOnly).toMatch(/data-opus-bar="purchased"[^>]*width:40%/);
    expect(boostOnly).not.toContain('data-opus-bar="overlap"');
    // 배지 하단 선(line)도 같은 세 겹
    const lineHtml = render(<OpusUsageBar status={boosted(80, 20)} line />);
    expect(lineHtml).toContain('h-[3px]');
    expect(lineHtml).toMatch(/data-opus-bar="overlap"[^>]*width:20%/);
    expect(lineHtml).not.toContain('rounded-full');
  });

  test('무료 0·추가 충전 남음은 Anlas 문구 없이 「추가 충전분 사용 중」', () => {
    const view = presentOpusUsage(boosted(0, 100));
    expect(view).toMatchObject({ text: '100%', tone: 'green', usingPurchased: true });
    const html = render(<OpusUsageMeter status={boosted(0, 100)} />);
    expect(html).toContain('0% + 100%');
    expect(html).toContain('추가 충전분 사용 중');
    expect(html).not.toContain('Anlas 사용');
  });

  test('모두 소진(isNegative)이면 0%·빨강·Anlas 문구', () => {
    const view = presentOpusUsage(boosted(0, 100, true));
    expect(view).toMatchObject({ text: '0%', tone: 'red', purchased: 0 });
    expect(render(<OpusUsageMeter status={boosted(0, 100, true)} />)).toContain('생성 시 Anlas 사용');
  });

  test('저잔량 색은 합산 기준, 「기본 한도 초과」는 무료분 기준', () => {
    expect(presentOpusUsage(boosted(5, 100), 10).tone).toBe('green');
    expect(presentOpusUsage(boosted(3, 4), 10).tone).toBe('orange');
    expect(presentOpusUsage(boosted(50, 100)).tone).toBe('green');
    const html = render(<OpusUsageMeter status={boosted(50, 100)} />);
    expect(html).not.toContain('초과');
    expect(render(<OpusUsageMeter status={boosted(111, 100)} />)).toContain('11%p 초과');
  });
});

test('확인 시각 표시는 조회 없이 시간 차이를 계산한다', () => {
  expect(opusCheckedLabel(0)).toBe('아직 확인하지 않음');
  expect(opusCheckedLabel(1000, 1001)).toBe('방금 확인');
  expect(opusCheckedLabel(1000, 121000)).toBe('2분 전 확인');
  expect(opusCheckedLabel(1000, 7201000)).toBe('2시간 전 확인');
});
