// E2 동반 슬롯 계약·해석 가드.
//
// resolveCompanionButtons(hostKey + 사용자 설정 → 붙일 버튼 id 목록) 규칙,
// 유일성(first-host-wins), companionAssignedIds, assign/removeCompanion 쓰기 헬퍼.
// companionSlots.ts 는 uiLayout(config 타입만 의존)만 딸고 오므로 mock 우회 불필요.

import {
  resolveCompanionButtons,
  companionAssignedIds,
  assignCompanion,
  assignCompanionAt,
  removeCompanion,
  COMPANION_HOSTS,
} from '../companionSlots';
import { portableButtonIds } from '../uiLayout';

describe('COMPANION_HOSTS — 호스트 목록 계약', () => {
  it('호스트 5종(characterPrompts·vibes·characterReferences·sampling-group·preset-select)', () => {
    expect(COMPANION_HOSTS).toEqual([
      'characterPrompts',
      'vibes',
      'characterReferences',
      'sampling-group',
      'preset-select', // ④ 호스트 확대(2026-07-18): 사전세팅선택 행
    ]);
  });
});

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

  it('② 호스트 목록 밖 hostKey → 빈 배열(설정이 있어도 무시)', () => {
    // seed 는 호스트 목록에 없음 — 사용자가 설정을 넣어도 슬롯 대상 아님.
    expect(
      resolveCompanionButtons('seed', { seed: ['character-presets'] }),
    ).toEqual([]);
  });

  it('③ 정상 1건 → portable 버튼 채택', () => {
    expect(
      resolveCompanionButtons('characterPrompts', {
        characterPrompts: ['character-presets'],
      }),
    ).toEqual(['character-presets']);
  });

  it('③ 풀(portable) 밖 버튼 id 는 조용히 무시', () => {
    // 'add-scene' 은 portable 이 아니다(씬 툴바 비이관 버튼) → 버림.
    expect(
      resolveCompanionButtons('characterPrompts', {
        characterPrompts: ['add-scene', 'character-presets'],
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

  it('③ 결과는 slots 배열 순서를 따르되 풀 밖은 걸러냄', () => {
    // backup-export·piece-editor 는 portable 이라 순서대로 채택, not-allowed 는 버림.
    expect(
      resolveCompanionButtons('vibes', {
        vibes: ['piece-editor', 'not-allowed', 'backup-export'],
      }),
    ).toEqual(['piece-editor', 'backup-export']);
  });

  it('portable 전체가 어느 호스트에서도 허용 풀 — 풀 목록과 일치', () => {
    const pool = portableButtonIds();
    expect(pool).toContain('character-presets');
    // 풀 전체를 sampling-group 에 실으면 순서대로 전부 채택.
    expect(
      resolveCompanionButtons('sampling-group', { 'sampling-group': pool }),
    ).toEqual(pool);
  });
});

describe('유일성(first-host-wins) — 한 버튼은 최대 한 호스트', () => {
  it('두 호스트가 같은 id 요청 → 앞선 호스트(COMPANION_HOSTS 순)가 소유', () => {
    const slots = {
      // characterReferences 가 COMPANION_HOSTS 상 뒤 → characterPrompts 우선.
      characterReferences: ['character-presets'],
      characterPrompts: ['character-presets'],
    };
    expect(resolveCompanionButtons('characterPrompts', slots)).toEqual([
      'character-presets',
    ]);
    // 뒤 호스트는 뺏겨 빈 배열.
    expect(resolveCompanionButtons('characterReferences', slots)).toEqual([]);
  });

  it('companionAssignedIds — 전 호스트 배정 합집합(유일성·풀 반영)', () => {
    const slots = {
      characterPrompts: ['character-presets', 'add-scene'], // add-scene=풀 밖
      vibes: ['backup-export', 'character-presets'], // character-presets 는 앞 호스트가 소유
      characterReferences: ['piece-editor'],
    };
    expect(companionAssignedIds(slots)).toEqual(
      new Set(['character-presets', 'backup-export', 'piece-editor']),
    );
  });

  it('companionAssignedIds — 빈 설정이면 빈 집합(파생 숨김 없음)', () => {
    expect(companionAssignedIds(undefined).size).toBe(0);
    expect(companionAssignedIds({}).size).toBe(0);
  });
});

describe('assignCompanion — 라스트 윈(이동 의미론)', () => {
  it('빈 설정에 배정 → 해당 호스트에 추가', () => {
    expect(assignCompanion({}, 'characterPrompts', 'character-presets')).toEqual({
      characterPrompts: ['character-presets'],
    });
  });

  it('다른 호스트에 있던 버튼을 재배정 → 이전 호스트에서 제거 후 새 호스트로', () => {
    const before = { characterPrompts: ['character-presets'] };
    const after = assignCompanion(before, 'vibes', 'character-presets');
    expect(after).toEqual({ vibes: ['character-presets'] });
    // 원본 불변.
    expect(before).toEqual({ characterPrompts: ['character-presets'] });
  });

  it('같은 호스트의 다른 버튼과 공존(끝에 추가)', () => {
    const after = assignCompanion(
      { vibes: ['backup-export'] },
      'vibes',
      'piece-editor',
    );
    expect(after).toEqual({ vibes: ['backup-export', 'piece-editor'] });
  });

  it('빈 배열이 된 호스트는 정리(빈 객체 의미 유지)', () => {
    const after = assignCompanion(
      { characterPrompts: ['character-presets'] },
      'characterPrompts',
      'character-presets',
    );
    // 이전 자리에서 제거 → 같은 호스트 재추가라 결과는 동일하나 배열 1건.
    expect(after).toEqual({ characterPrompts: ['character-presets'] });
  });
});

describe('assignCompanionAt — 위치 지정 배정(E4 드래그 순서 조정)', () => {
  it('anchor 없음 → 끝에 추가(assignCompanion 과 동일)', () => {
    const after = assignCompanionAt(
      { vibes: ['backup-export'] },
      'vibes',
      'piece-editor',
    );
    expect(after).toEqual({ vibes: ['backup-export', 'piece-editor'] });
  });

  it('같은 호스트 내 순서 조정 — 대상 버튼 앞(before)에 삽입', () => {
    // piece-editor 를 backup-export 앞으로.
    const after = assignCompanionAt(
      { vibes: ['backup-export', 'piece-editor'] },
      'vibes',
      'piece-editor',
      { id: 'backup-export', side: 'before' },
    );
    expect(after).toEqual({ vibes: ['piece-editor', 'backup-export'] });
  });

  it('같은 호스트 내 순서 조정 — 대상 버튼 뒤(after)에 삽입', () => {
    // character-presets 를 piece-editor 뒤로(맨 끝).
    const after = assignCompanionAt(
      { vibes: ['character-presets', 'backup-export', 'piece-editor'] },
      'vibes',
      'character-presets',
      { id: 'piece-editor', side: 'after' },
    );
    expect(after).toEqual({
      vibes: ['backup-export', 'piece-editor', 'character-presets'],
    });
  });

  it('다른 호스트로 위치 지정 재배정 — 이전 호스트 제거 + 대상 위치 삽입', () => {
    const before = {
      characterPrompts: ['character-presets'],
      vibes: ['backup-export', 'piece-editor'],
    };
    const after = assignCompanionAt(before, 'vibes', 'character-presets', {
      id: 'piece-editor',
      side: 'before',
    });
    expect(after).toEqual({
      vibes: ['backup-export', 'character-presets', 'piece-editor'],
    });
    // 원본 불변.
    expect(before).toEqual({
      characterPrompts: ['character-presets'],
      vibes: ['backup-export', 'piece-editor'],
    });
  });

  it('anchor 가 대상 호스트에 없으면 끝에 붙인다', () => {
    const after = assignCompanionAt(
      { vibes: ['backup-export'] },
      'vibes',
      'piece-editor',
      { id: 'character-presets', side: 'before' },
    );
    expect(after).toEqual({ vibes: ['backup-export', 'piece-editor'] });
  });

  it('anchor 가 자기 자신이면 무시하고 끝(제자리 근처)에', () => {
    const after = assignCompanionAt(
      { vibes: ['character-presets', 'backup-export'] },
      'vibes',
      'character-presets',
      { id: 'character-presets', side: 'before' },
    );
    // 제거 후 끝에 재삽입 → 순서만 뒤로.
    expect(after).toEqual({ vibes: ['backup-export', 'character-presets'] });
  });
});

describe('removeCompanion — 전 호스트에서 제거', () => {
  it('배정된 버튼 제거 → 슬롯에서 사라짐(툴바 복귀)', () => {
    const after = removeCompanion(
      { characterPrompts: ['character-presets'] },
      'character-presets',
    );
    expect(after).toEqual({});
  });

  it('여러 호스트에 흩어져 있어도 전부 제거 + 빈 호스트 정리', () => {
    const after = removeCompanion(
      {
        characterPrompts: ['character-presets'],
        vibes: ['character-presets', 'backup-export'],
      },
      'character-presets',
    );
    expect(after).toEqual({ vibes: ['backup-export'] });
  });

  it('없는 버튼 제거는 무해(그대로)', () => {
    const after = removeCompanion({ vibes: ['backup-export'] }, 'character-presets');
    expect(after).toEqual({ vibes: ['backup-export'] });
  });
});
