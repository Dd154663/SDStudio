/**
 * Opus 추가 충전(Usage Boost, purchasedPercent) 판정 단일 출처(2026-10-25) — 이용 가능량·과금 위험·저잔량·
 * 전환 안내·「할당량 경고 하지 않음」·다중 토큰 순회 후보 등급.
 */
import type { OpusUsageStatus } from '../../backends/imageGen';
import {
  allowPurchasedRotationFallback,
  availablePercentOf,
  canBalanceRotate,
  describeOpusUsage,
  formatOpusUsageSplit,
  freePercentOf,
  isLowOpusUsage,
  isOpusPaidRisk,
  isOpusUsageQuiet,
  isUsingPurchasedUsage,
  needsPaidRiskConfirm,
  needsUrgentRotation,
  OPUS_USAGE_TEXT,
  parsePurchasedPercent,
  purchasedPercentOf,
  rotationCandidateTier,
} from '../opusUsageRules';

const s = (
  percent: number,
  purchasedPercent?: number,
  isNegative = false,
  opusSubscribed: boolean | undefined = true,
): OpusUsageStatus => ({
  opusSubscribed,
  percent,
  purchasedPercent,
  isNegative,
  timeUntilNextPercent: 60,
});

describe('파서', () => {
  test.each([
    [100, 100],
    [400, 400],
    [12.4, 12],
    [-1, 0],
    [undefined, 0],
    [null, 0],
    ['50', 0],
    [NaN, 0],
    [Infinity, 0],
  ])('%p → %p', (raw, expected) => {
    expect(parsePurchasedPercent(raw)).toBe(expected);
  });
});

describe('이용 가능량', () => {
  test('무료+추가 충전 합산, 필드 없음은 0', () => {
    expect(availablePercentOf(s(80, 100))).toBe(180);
    expect(availablePercentOf(s(80))).toBe(80);
    expect(freePercentOf(s(80, 100))).toBe(80);
    expect(purchasedPercentOf(s(80, 100))).toBe(100);
  });
  test('isNegative·미구독·미확인은 0', () => {
    expect(availablePercentOf(s(50, 100, true))).toBe(0);
    expect(availablePercentOf(s(50, 100, false, false))).toBe(0);
    expect(availablePercentOf(undefined)).toBe(0);
  });
  test('구버전 메모리 상태(opusSubscribed 없음)는 구독으로 본다', () => {
    expect(availablePercentOf(s(30, 20, false, undefined))).toBe(50);
  });
});

describe('과금 위험(Anlas 확인)', () => {
  test('무료 0 이어도 추가 충전분이 남으면 위험이 아니다', () => {
    expect(isOpusPaidRisk(s(0, 100))).toBe(false);
  });
  test('isNegative·미구독·미확인·무료+추가 충전 모두 0 은 위험', () => {
    expect(isOpusPaidRisk(s(0, 100, true))).toBe(true);
    expect(isOpusPaidRisk(s(100, 0, false, false))).toBe(true);
    expect(isOpusPaidRisk(undefined)).toBe(true);
    expect(isOpusPaidRisk(s(0, 0))).toBe(true);
    expect(isOpusPaidRisk(s(0))).toBe(true);
  });
  test('「할당량 경고 하지 않음」·세션 승인은 확인을 생략한다', () => {
    expect(needsPaidRiskConfirm(s(0, 0, true), { quiet: false, approvedForSession: false })).toBe(true);
    expect(needsPaidRiskConfirm(s(0, 0, true), { quiet: true, approvedForSession: false })).toBe(false);
    expect(needsPaidRiskConfirm(s(0, 0, true), { quiet: false, approvedForSession: true })).toBe(false);
    expect(needsPaidRiskConfirm(s(0, 50), { quiet: false, approvedForSession: false })).toBe(false);
  });
  test('quiet 설정 해석은 true 만 켬', () => {
    expect(isOpusUsageQuiet({ opusUsageQuiet: true })).toBe(true);
    expect(isOpusUsageQuiet({ opusUsageQuiet: 'true' })).toBe(false);
    expect(isOpusUsageQuiet({})).toBe(false);
    expect(isOpusUsageQuiet(undefined)).toBe(false);
  });
});

describe('저잔량·전환', () => {
  test('저잔량은 합산 기준', () => {
    expect(isLowOpusUsage(s(5, 100), 10)).toBe(false);
    expect(isLowOpusUsage(s(5, 3), 10)).toBe(true);
    expect(isLowOpusUsage(s(0, 8), 10)).toBe(true);
    expect(isLowOpusUsage(s(0, 0), 10)).toBe(false); // 소진은 과금 위험 쪽
    expect(isLowOpusUsage(s(5, 0, true), 10)).toBe(false);
    expect(isLowOpusUsage(s(5, 0, false, false), 10)).toBe(false);
  });
  test('추가 충전분 사용 중 = 무료 0·추가 충전>0·isNegative 아님', () => {
    expect(isUsingPurchasedUsage(s(0, 100))).toBe(true);
    expect(isUsingPurchasedUsage(s(1, 100))).toBe(false);
    expect(isUsingPurchasedUsage(s(0, 0))).toBe(false);
    expect(isUsingPurchasedUsage(s(0, 100, true))).toBe(false);
  });
  test('문구', () => {
    expect(formatOpusUsageSplit(s(80, 100))).toBe('80% + 100%');
    expect(formatOpusUsageSplit(s(80))).toBe('80%');
    expect(describeOpusUsage(s(0, 100))).toBe('무료 0% + 추가 충전 100%');
    expect(OPUS_USAGE_TEXT.lowWarning(s(2, 5))).toContain('7%');
    expect(OPUS_USAGE_TEXT.lowWarning(s(2, 5))).toContain('추가 충전 포함');
    expect(OPUS_USAGE_TEXT.purchasedNotice(s(0, 100))).toContain('100%');
  });
});

describe('다중 토큰 순회(무료분 기준·임계 시 무료 우선 → 추가 충전)', () => {
  test('임계 판정은 무료분 기준 — 추가 충전분이 많아도 무료분이 경고값 이하면 임계', () => {
    expect(needsUrgentRotation(s(5, 100), 10)).toBe(true);
    expect(needsUrgentRotation(s(50, 0), 10)).toBe(false);
    expect(needsUrgentRotation(s(50, 0, true), 10)).toBe(true);
    expect(needsUrgentRotation(s(50, 0, false, false), 10)).toBe(true);
  });
  test('추가 충전분 계정으로의 차선 전환은 현재 계정 이용 가능량도 경고값 이하일 때만', () => {
    expect(allowPurchasedRotationFallback(s(5, 100), 10)).toBe(false);
    expect(allowPurchasedRotationFallback(s(3, 4), 10)).toBe(true);
    expect(allowPurchasedRotationFallback(s(0, 0, true), 10)).toBe(true);
    expect(allowPurchasedRotationFallback(undefined, 10)).toBe(true);
  });
  test('후보 등급', () => {
    expect(rotationCandidateTier(s(30, 0), 25, true)).toBe('free');
    expect(rotationCandidateTier(s(30, 100), 25, false)).toBe('free');
    expect(rotationCandidateTier(s(5, 100), 25, true)).toBe('purchased');
    expect(rotationCandidateTier(s(5, 100), 25, false)).toBeUndefined();
    expect(rotationCandidateTier(s(5, 10), 25, true)).toBeUndefined();
    expect(rotationCandidateTier(s(20, 0), 25, true)).toBeUndefined();
    expect(rotationCandidateTier(s(90, 100, true), 25, true)).toBeUndefined();
    expect(rotationCandidateTier(s(100, 0, false, false), 25, true)).toBeUndefined();
  });
  test('여유 순회 검사 가능 여부', () => {
    expect(canBalanceRotate(s(80, 0))).toBe(true);
    expect(canBalanceRotate(s(80, 0, true))).toBe(false);
    expect(canBalanceRotate(undefined)).toBe(false);
  });
});
