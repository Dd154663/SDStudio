import {
  isWorkspaceBakHealCandidate,
  pickNewestTrashDir,
  pickTrashSlotName,
  planProjectRestore,
  sceneTrashBelongsTo,
  sceneTrashLabel,
  sortTrashNewestFirst,
  trashDuplicateOrdinals,
  trashDuplicateSuffix,
  trashRetentionNotice,
  trashSlotCompareKey,
} from '../trashList';
import { invalidProjectName } from '../projectPaths';

describe('pickTrashSlotName — 씬 휴지통 슬롯 이름(S1)', () => {
  test('비어 있으면 원래 이름 그대로', () => {
    expect(pickTrashSlotName('S', [])).toBe('S');
    expect(pickTrashSlotName('S', ['T', 'S (삭제 2)'])).toBe('S');
  });

  test('같은 이름 재삭제(기록 키 있음) → 「S (삭제 2)」, 연속이면 다음 빈 번호', () => {
    expect(pickTrashSlotName('S', ['S'])).toBe('S (삭제 2)');
    expect(pickTrashSlotName('S', ['S', 'S (삭제 2)'])).toBe('S (삭제 3)');
    expect(pickTrashSlotName('S', ['S', 'S (삭제 2)', 'S (삭제 4)'])).toBe('S (삭제 3)');
  });

  test('일반+변형 동명(키 이름공간 공유) — 먼저 지운 쪽 키가 있으면 다음 쪽은 슬롯 2', () => {
    // 일반 씬 S 를 지운 뒤 변형 씬 S 를 지우는 경우: 키 `P:S` 가 이미 있음
    expect(pickTrashSlotName('S', ['S'])).toBe('S (삭제 2)');
  });

  test('.trash 에 기록 없는 고아 폴더/마스크 파일만 있어도 피한다', () => {
    // 호출부는 .trash 목록(폴더 S, 마스크 S.png 의 확장자 뗀 이름)을 taken 에 넣는다
    expect(pickTrashSlotName('S', ['.gitkeep', 'S'])).toBe('S (삭제 2)');
  });

  test('대소문자·끝 점/공백 차이는 같은 폴더로 본다(Windows·안드로이드 공용 저장소)', () => {
    expect(pickTrashSlotName('S', ['s'])).toBe('S (삭제 2)');
    expect(pickTrashSlotName('S', ['S.'])).toBe('S (삭제 2)');
    expect(pickTrashSlotName('Scene', ['scene (삭제 2)', 'SCENE'])).toBe('Scene (삭제 3)');
    expect(trashSlotCompareKey('Ab. ')).toBe('ab');
  });

  test('이미 「X (삭제 N)」 꼴인 이름은 X 기준으로 번호를 붙인다', () => {
    expect(pickTrashSlotName('S (삭제 2)', ['S (삭제 2)'])).toBe('S (삭제 3)');
  });

  test('긴 이름·특수 문자 이름도 접미사만 붙고 경로 세그먼트 규칙을 지킨다', () => {
    const long = '가'.repeat(120);
    const slot = pickTrashSlotName(long, [long]);
    expect(slot).toBe(long + ' (삭제 2)');
    const odd = 'a.b [c] (1)';
    const slot2 = pickTrashSlotName(odd, [odd]);
    expect(slot2).toBe('a.b [c] (1) (삭제 2)');
    for (const s of [slot, slot2]) {
      expect(s.includes('/')).toBe(false);
      expect(s.includes('\\')).toBe(false);
      expect(invalidProjectName(s)).toBeNull();
    }
  });
});

describe('sceneTrashLabel — 휴지통 씬 표시(원래 이름 + 보조 표기)', () => {
  test('슬롯이 원래 이름과 다르면 원래 이름 + 「(삭제 2)」', () => {
    expect(sceneTrashLabel({ name: 'S (삭제 2)', originalName: 'S' })).toEqual({
      base: 'S',
      suffix: '(삭제 2)',
    });
  });
  test('구버전 기록(originalName 없음)·같은 이름은 그대로', () => {
    expect(sceneTrashLabel({ name: 'S' })).toEqual({ base: 'S', suffix: '' });
    expect(sceneTrashLabel({ name: 'S', originalName: 'S' })).toEqual({ base: 'S', suffix: '' });
  });
  test('접두가 다르면(예상 밖 기록) 슬롯 이름만', () => {
    expect(sceneTrashLabel({ name: 'Q', originalName: 'S' })).toEqual({ base: 'Q', suffix: '' });
  });
});

describe('S2 — 신 배치 동명 프로젝트 공존 판정', () => {
  test('sceneTrashBelongsTo: projectDir 있으면 그 폴더만, 없으면 이름(구버전 기록)으로', () => {
    expect(sceneTrashBelongsTo({ projectDir: 'P__a' }, 'P__a')).toBe(true);
    expect(sceneTrashBelongsTo({ projectDir: 'P__a' }, 'P__b')).toBe(false);
    expect(sceneTrashBelongsTo({ projectDir: 'P__a' }, undefined)).toBe(false);
    expect(sceneTrashBelongsTo({}, 'P__b')).toBe(true);
    expect(sceneTrashBelongsTo({}, undefined)).toBe(true);
  });

  test('trashDuplicateOrdinals: 같은 이름끼리 오래된 순 첫 항목 번호 없음, 다음 (2)(3)', () => {
    const m = trashDuplicateOrdinals([
      { key: 'P__c', name: 'P', deletedAt: 300 },
      { key: 'P__a', name: 'P', deletedAt: 100 },
      { key: 'Q', name: 'Q', deletedAt: 50 },
      { key: 'P__b', name: 'P', deletedAt: 200 },
    ]);
    expect(m.get('P__a')).toBeUndefined();
    expect(m.get('P__b')).toBe(2);
    expect(m.get('P__c')).toBe(3);
    expect(m.has('Q')).toBe(false);
    expect(trashDuplicateSuffix(m.get('P__b'))).toBe(' (2)');
    expect(trashDuplicateSuffix(undefined)).toBe('');
  });

  test('trashDuplicateOrdinals: 시각을 모르는(0) 항목이 가장 오래된 것, 같은 시각은 key 순', () => {
    const m = trashDuplicateOrdinals([
      { key: 'b', name: 'P', deletedAt: 5 },
      { key: 'a', name: 'P', deletedAt: 5 },
      { key: 'z', name: 'P', deletedAt: 0 },
    ]);
    expect(m.get('z')).toBeUndefined();
    expect(m.get('a')).toBe(2);
    expect(m.get('b')).toBe(3);
  });

  test('planProjectRestore: 활성 동명 없으면 원래 이름, 있으면 비어 있는 「이름 (n)」 기본값', () => {
    expect(planProjectRestore('P', ['A'])).toEqual({ needsNewName: false, defaultName: 'P' });
    expect(planProjectRestore('P', ['P'])).toEqual({ needsNewName: true, defaultName: 'P (2)' });
    expect(planProjectRestore('P', ['P', 'P (2)'])).toEqual({
      needsNewName: true,
      defaultName: 'P (3)',
    });
  });

  test('pickNewestTrashDir: 이름만으로 부르면 가장 최근 삭제 폴더(같으면 먼저 나온 것)', () => {
    expect(
      pickNewestTrashDir([
        { dir: 'a', deletedAt: 1 },
        { dir: 'b', deletedAt: 3 },
        { dir: 'c', deletedAt: 2 },
      ]),
    ).toBe('b');
    expect(pickNewestTrashDir([{ dir: 'a', deletedAt: 0 }, { dir: 'b', deletedAt: 0 }])).toBe('a');
    expect(pickNewestTrashDir([])).toBeUndefined();
  });

  test('isWorkspaceBakHealCandidate: 휴지통 폴더(.deleted 있음)는 .bak 자가치유 대상이 아니다', () => {
    expect(isWorkspaceBakHealCandidate({ hasJson: false, hasDeleted: false })).toBe(true);
    expect(isWorkspaceBakHealCandidate({ hasJson: false, hasDeleted: true })).toBe(false);
    expect(isWorkspaceBakHealCandidate({ hasJson: true, hasDeleted: false })).toBe(false);
    expect(isWorkspaceBakHealCandidate({ hasJson: true, hasDeleted: true })).toBe(false);
  });
});

describe('trashRetentionNotice — 보존 기간 안내(S3)', () => {
  test('씬·프로젝트 문구에 기간 숫자가 그대로 들어간다', () => {
    const days = { image: 3, scene: 14, project: 30 };
    expect(trashRetentionNotice('scene', days)).toContain('14일');
    expect(trashRetentionNotice('scene', days)).toContain('3일');
    expect(trashRetentionNotice('project', days)).toContain('30일');
  });
});

describe('sortTrashNewestFirst — 휴지통 목록 최근 삭제 순(T1)', () => {
  test('최근 삭제가 위, 개수 제한 없음(수백 개도 전부 유지)', () => {
    const items = Array.from({ length: 500 }, (_, i) => ({ name: `s${i}`, deletedAt: 1000 + i }));
    const sorted = sortTrashNewestFirst(items);
    expect(sorted).toHaveLength(500);
    expect(sorted[0].name).toBe('s499');
    expect(sorted[499].name).toBe('s0');
  });

  test('삭제 시각을 모르는 항목(0·NaN)은 맨 아래, 같은 시각은 이름 순', () => {
    const sorted = sortTrashNewestFirst([
      { name: 'b', deletedAt: 0 },
      { name: 'c', deletedAt: 5 },
      { name: 'a', deletedAt: NaN },
      { name: 'e', deletedAt: 5 },
      { name: 'd', deletedAt: 9 },
    ]);
    expect(sorted.map((s) => s.name)).toEqual(['d', 'c', 'e', 'a', 'b']);
  });

  test('원본 배열은 바꾸지 않고 추가 필드는 보존', () => {
    const items = [
      { name: 'x', deletedAt: 1, type: 'scene' as const },
      { name: 'y', deletedAt: 2, type: 'inpaint' as const },
    ];
    const sorted = sortTrashNewestFirst(items);
    expect(items.map((s) => s.name)).toEqual(['x', 'y']);
    expect(sorted[0]).toEqual({ name: 'y', deletedAt: 2, type: 'inpaint' });
  });
});
