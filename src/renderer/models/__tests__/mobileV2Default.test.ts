/**
 * 모바일 기본 배치 = V2 (2026-09-27) — 순수 판단 planMobileV2Default.
 */
jest.mock('..', () => ({ backend: {}, isMobile: true }));
jest.mock('../AppService', () => ({ appState: {} }));

import { planMobileV2Default } from '../mobileV2Default';

describe('planMobileV2Default', () => {
  it('PC 는 아무것도 하지 않는다', () => {
    expect(planMobileV2Default({}, 'none', false)).toEqual({ patch: {}, showIntro: false });
  });
  it('표식이 있으면 어떤 경우에도 다시 하지 않는다', () => {
    expect(planMobileV2Default({ mobileV2IntroDone: true, uiLayoutTemplate: 'classic' }, 'none', true)).toEqual({ patch: {}, showIntro: false });
    expect(planMobileV2Default({ mobileV2IntroDone: true }, 'fresh', true)).toEqual({ patch: {}, showIntro: false });
  });
  it('새 설치(fresh): V2 로 시작하되 안내는 없다', () => {
    expect(planMobileV2Default({}, 'fresh', true)).toEqual({
      patch: { mobileV2IntroDone: true, uiLayoutTemplate: 'mobile-v2', uiPresetIconRow: true },
      showIntro: false,
    });
  });
  it('기존 사용자(none/legacy/unknown): V2 로 바꾸고 한 번 안내', () => {
    for (const det of ['none', 'legacy', 'unknown'] as const) {
      expect(planMobileV2Default({ uiLayoutTemplate: 'classic' }, det, true)).toEqual({
        patch: { mobileV2IntroDone: true, uiLayoutTemplate: 'mobile-v2', uiPresetIconRow: true },
        showIntro: true,
      });
    }
    expect(planMobileV2Default({}, 'none', true).showIntro).toBe(true);
  });
  it('이미 V2 를 쓰던 사용자는 표식만 남기고 안내하지 않는다', () => {
    expect(planMobileV2Default({ uiLayoutTemplate: 'mobile-v2', uiPresetIconRow: false }, 'none', true)).toEqual({
      patch: { mobileV2IntroDone: true },
      showIntro: false,
    });
  });
});
