/** @jest-environment jsdom */
jest.mock('../AppService', () => ({ appState: { uiLayoutTemplate: 'classic' } }));

import { nearestSheetState, nextSheetState, V2_SHEET_HALF_KEYS } from '../mobileV2';

describe('모바일 V2 하단 시트 상태', () => {
  const heights = { peek: 44, half: 388, full: 692 };
  it('손잡이 탭: 접힘→반→전체→접힘', () => {
    expect(nextSheetState('peek')).toBe('half');
    expect(nextSheetState('half')).toBe('full');
    expect(nextSheetState('full')).toBe('peek');
  });
  it('끌다 놓으면 가장 가까운 상태에 붙는다', () => {
    expect(nearestSheetState(100, heights)).toBe('peek');
    expect(nearestSheetState(300, heights)).toBe('half');
    expect(nearestSheetState(600, heights)).toBe('full');
  });
  it('반 상태의 요소 키는 사전세팅선택(일반·프로필)·상위·추가 프롬프트·시드(wfiElementKey 계약)', () => {
    expect([...V2_SHEET_HALF_KEYS]).toEqual([
      'preset-select',
      'profile-preset-select',
      'frontPrompt',
      'extra-prompt',
      'seed',
    ]);
  });
});

describe('모바일 V2 하단 시트 끌기 판정 (2026-09-22, 덜 엄격하게)', () => {
  const { resolveSheetTarget } = jest.requireActual('../mobileV2');
  const heights = { peek: 44, half: 388, full: 692 };
  const go = (height: number, startHeight: number, velocity = 0) =>
    resolveSheetTarget({ height, startHeight, velocity, heights });
  it('느린 끌기: 구간의 25% 를 넘기면 그쪽 끝, 못 넘기면 출발 쪽', () => {
    expect(go(120, 44)).toBe('peek'); // 76/344 = 22%
    expect(go(130, 44)).toBe('half'); // 86/344 = 25%
    expect(go(400, 44)).toBe('half'); // 반을 조금 지남
    expect(go(470, 44)).toBe('full'); // 반↔전체 구간 27%
  });
  it('느린 내리기: 전체에서 25% 넘게 내리면 반, 아니면 전체 유지', () => {
    expect(go(640, 692)).toBe('full');
    expect(go(600, 692)).toBe('half');
    expect(go(300, 388)).toBe('peek');
  });
  it('튕김(0.5px/ms 이상): 거리와 무관하게 진행 방향의 다음 상태', () => {
    expect(go(80, 44, 0.6)).toBe('half');
    expect(go(400, 44, 0.6)).toBe('full');
    expect(go(600, 692, -0.6)).toBe('half');
    expect(go(300, 388, -0.6)).toBe('peek');
    expect(go(80, 44, 0.4)).toBe('peek'); // 튕김 미만은 느린 끌기 규칙
  });
  it('빠른 튕김(1.8px/ms 이상): 한 번에 끝까지 — 보통 손짓(1.2)은 한 단계만', () => {
    expect(go(80, 44, 2.0)).toBe('full');
    expect(go(650, 692, -2.0)).toBe('peek');
    expect(go(80, 44, 1.2)).toBe('half');
  });
  it('움직였다가 제자리로 돌아오면 출발 상태', () => {
    expect(go(44, 44)).toBe('peek');
    expect(go(388, 388)).toBe('half');
    expect(go(692, 692)).toBe('full');
  });
});
