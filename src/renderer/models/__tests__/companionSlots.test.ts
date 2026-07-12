// L3-1 동반 슬롯 해석 가드.
//
// resolveCompanionButtons(hostKey + 사용자 설정 → 붙일 버튼 id 목록)의 규칙별 케이스.
// companionSlots.ts 는 순수 상수·함수만이라 무거운 초기화(WorkFlow/models 인덱스)를
// 딸고 오지 않으므로 jest.mock 우회가 필요 없다.

import {
  resolveCompanionButtons,
  COMPANION_HOST_WHITELIST,
} from '../companionSlots';

describe('resolveCompanionButtons — 규칙 단위 검증', () => {
  it('① slots 미설정(undefined) → 빈 배열(슬롯 없음)', () => {
    expect(resolveCompanionButtons('characterPrompts', undefined)).toEqual([]);
  });

  it('① 해당 hostKey 항목 없음 → 빈 배열', () => {
    expect(resolveCompanionButtons('characterPrompts', {})).toEqual([]);
  });

  it('① hostKey 배열이 빈 배열 → 빈 배열', () => {
    expect(
      resolveCompanionButtons('characterPrompts', { characterPrompts: [] }),
    ).toEqual([]);
  });

  it('② 화이트리스트 밖 hostKey → 빈 배열(설정이 있어도 무시)', () => {
    // seed 는 화이트리스트에 없음 — 사용자가 설정을 넣어도 슬롯 대상 아님.
    expect(
      resolveCompanionButtons('seed', { seed: ['character-presets'] }),
    ).toEqual([]);
  });

  it('③ 정상 1건 → 허용 버튼 채택', () => {
    expect(
      resolveCompanionButtons('characterPrompts', {
        characterPrompts: ['character-presets'],
      }),
    ).toEqual(['character-presets']);
  });

  it('③ 비허용 버튼 id 는 조용히 무시(허용 목록 밖)', () => {
    // 'backup-export' 는 portable 이지만 이 hostKey 의 허용 목록엔 없다 → 버림.
    expect(
      resolveCompanionButtons('characterPrompts', {
        characterPrompts: ['backup-export', 'character-presets'],
      }),
    ).toEqual(['character-presets']);
  });

  it('③ stale(존재하지 않는) 버튼 id 무시', () => {
    expect(
      resolveCompanionButtons('characterPrompts', {
        characterPrompts: ['zombie', 'character-presets', 'ghost'],
      }),
    ).toEqual(['character-presets']);
  });

  it('③ 중복 버튼 id 는 첫 등장만 채택(중복 제거)', () => {
    expect(
      resolveCompanionButtons('characterPrompts', {
        characterPrompts: ['character-presets', 'character-presets'],
      }),
    ).toEqual(['character-presets']);
  });

  it('③ 결과는 slots 배열 순서를 따르되 허용 목록 밖은 걸러냄', () => {
    // 허용 목록이 확장돼도 순서는 slots 를 따르는지 미리 봉인(현 1건이라 단일 채택).
    expect(
      resolveCompanionButtons('characterPrompts', {
        characterPrompts: ['character-presets', 'not-allowed'],
      }),
    ).toEqual(['character-presets']);
  });
});

describe('COMPANION_HOST_WHITELIST — 계약 동결', () => {
  it('1차 화이트리스트는 characterPrompts → [character-presets] 단 1건', () => {
    expect(COMPANION_HOST_WHITELIST).toEqual({
      characterPrompts: ['character-presets'],
    });
  });
});
