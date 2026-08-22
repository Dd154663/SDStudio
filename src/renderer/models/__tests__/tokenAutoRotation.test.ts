import {
  minimumTokenRotateTarget,
  normalizeTokenRotateTarget,
  normalizeTokenRotateWarning,
} from '../tokenAutoRotation';

describe('다중 토큰 자동 순회 설정', () => {
  test('누락된 값은 10퍼센트와 25퍼센트 기본값을 사용한다', () => {
    expect(normalizeTokenRotateWarning(undefined)).toBe(10);
    expect(normalizeTokenRotateTarget(undefined, undefined)).toBe(25);
  });

  test('경고 임계값은 1에서 24 사이로 제한한다', () => {
    expect(normalizeTokenRotateWarning(-10)).toBe(1);
    expect(normalizeTokenRotateWarning(99)).toBe(24);
  });

  test('사용 토큰 여유값은 경고 임계값보다 최소 5퍼센트포인트 높게 보정한다', () => {
    expect(minimumTokenRotateTarget(24)).toBe(29);
    expect(normalizeTokenRotateTarget(12, 10)).toBe(15);
    expect(normalizeTokenRotateTarget(99, 24)).toBe(50);
  });
});
