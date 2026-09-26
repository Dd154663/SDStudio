/** @jest-environment jsdom */
jest.mock('../AppService', () => ({ appState: { uiLayoutTemplate: 'classic' } }));

import { isV2, nearestSheetState, nextSheetState, normalizeV2Parts, tierRows, V2_PART_OPTIONS, V2_SHEET_HALF_KEYS } from '../mobileV2';
const { appState } = jest.requireMock('../AppService') as { appState: { uiLayoutTemplate: string; uiMobileV2Parts?: unknown } };

describe('모바일 V2 더보기 둘째 줄 나누기 (2026-09-24)', () => {
  it('5칸 기준: 5개면 한 줄 꽉 참, 6개면 두 줄이고 둘째 줄은 빈 칸 4개', () => {
    expect(tierRows(['a', 'b', 'c', 'd', 'e'], 5)).toEqual([['a', 'b', 'c', 'd', 'e']]);
    expect(tierRows(['a', 'b', 'c', 'd', 'e', 'f'], 5)).toEqual([
      ['a', 'b', 'c', 'd', 'e'],
      ['f', null, null, null, null],
    ]);
  });
  it('항목이 없으면 줄도 없다, 칸 수가 0 이하면 1칸으로 본다', () => {
    expect(tierRows([], 5)).toEqual([]);
    expect(tierRows(['a', 'b'], 0)).toEqual([['a'], ['b']]);
  });
});

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

describe('모바일 V2 일부 적용 (2026-09-27)', () => {
  afterEach(() => {
    appState.uiLayoutTemplate = 'classic';
    appState.uiMobileV2Parts = undefined;
  });
  it('부위 값이 없거나 일부만 있으면 나머지는 켬, 불리언 아닌 값은 무시', () => {
    expect(normalizeV2Parts(undefined)).toEqual({ main: true, editor: true, grid: true, detail: true });
    expect(normalizeV2Parts({ grid: false })).toEqual({ main: true, editor: true, grid: false, detail: true });
    expect(normalizeV2Parts({ main: 'no' })).toEqual({ main: true, editor: true, grid: true, detail: true });
    expect(V2_PART_OPTIONS.map((p) => p.key)).toEqual(['main', 'editor', 'grid', 'detail']);
  });
  it('클래식 템플릿이면 부위와 무관하게 전부 꺼짐', () => {
    appState.uiMobileV2Parts = { main: true, grid: true };
    expect(isV2()).toBe(false);
    expect(isV2('main')).toBe(false);
  });
  it('V2 템플릿: 부위 값이 없으면 전부 켬, 끈 부위만 false, 인자 없는 호출은 템플릿 판정', () => {
    appState.uiLayoutTemplate = 'mobile-v2';
    expect(isV2()).toBe(true);
    expect(isV2('grid')).toBe(true);
    appState.uiMobileV2Parts = { grid: false, editor: false };
    expect(isV2()).toBe(true);
    expect(isV2('main')).toBe(true);
    expect(isV2('grid')).toBe(false);
    expect(isV2('editor')).toBe(false);
    expect(isV2('detail')).toBe(true);
  });
});
