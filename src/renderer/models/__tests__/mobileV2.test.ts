/** @jest-environment jsdom */
jest.mock('../AppService', () => ({ appState: { uiLayoutTemplate: 'classic' } }));

import { nearestSheetState, nextSheetState, prevSheetState, V2_SHEET_HALF_KEYS } from '../mobileV2';

describe('모바일 V2 하단 시트 상태', () => {
  const heights = { peek: 44, half: 388, full: 692 };
  it('손잡이 탭: 접힘→반→전체→접힘', () => {
    expect(nextSheetState('peek')).toBe('half');
    expect(nextSheetState('half')).toBe('full');
    expect(nextSheetState('full')).toBe('peek');
  });
  it('뒤로 가기: 한 단계씩 접는다', () => {
    expect(prevSheetState('full')).toBe('half');
    expect(prevSheetState('half')).toBe('peek');
    expect(prevSheetState('peek')).toBe('peek');
  });
  it('끌다 놓으면 가장 가까운 상태에 붙는다', () => {
    expect(nearestSheetState(100, heights)).toBe('peek');
    expect(nearestSheetState(300, heights)).toBe('half');
    expect(nearestSheetState(600, heights)).toBe('full');
  });
  it('반 상태의 요소 키는 상위·추가 프롬프트와 시드(wfiElementKey 계약)', () => {
    expect([...V2_SHEET_HALF_KEYS]).toEqual(['frontPrompt', 'extra-prompt', 'seed']);
  });
});
