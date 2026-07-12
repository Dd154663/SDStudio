// L1-2 프리셋 에디터 요소 순서 오버라이드 해석 가드.
//
// resolvePresetOrder(정의 순서 + 사용자 오버라이드 → 최종 렌더 순서)의 규칙별
// 케이스와 순열 불변식을, presetStackKeys 는 합성 스택으로 검증한다.
//
// 무거운 초기화 우회: presetLayout → WorkFlow → types → models 인덱스('..') 순으로
// 앱 서비스(androidBackend 등, 번들 에셋 db.txt 로드)가 딸려온다. WorkFlow 의 UI 정의
// 헬퍼는 이들에 의존하지 않으므로 인덱스만 빈 객체로 대체한다(workflowElementKey.test 와 동일).
jest.mock('..', () => ({}));

import {
  resolvePresetOrder,
  presetStackKeys,
  presetLayoutSlotKey,
  resolveStackInputs,
  movePresetOrder,
  presetRowLabel,
  PRESET_LAYOUT_ANCHOR_KEYS,
} from '../presetLayout';
import {
  WFIStack,
  wfiStack,
  wfiInlineInput,
  wfiPresetSelect,
  wfiGroup,
  wfiMiddlePlaceholderInput,
  wfiPush,
  wfiIfIn,
  wfiSceneOnly,
} from '../workflows/WorkFlow';

describe('resolvePresetOrder — 규칙 단위 검증', () => {
  it('오버라이드 없음(undefined) → 정의 순서 그대로', () => {
    const def = ['a', 'b', 'c'];
    expect(resolvePresetOrder(def, undefined)).toEqual(['a', 'b', 'c']);
  });

  it('오버라이드 빈 배열 → 정의 순서 그대로', () => {
    const def = ['a', 'b', 'c'];
    expect(resolvePresetOrder(def, [])).toEqual(['a', 'b', 'c']);
  });

  it('반환 배열은 새 인스턴스(입력 definitionKeys 를 변형하지 않음)', () => {
    const def = ['a', 'b', 'c'];
    const out = resolvePresetOrder(def, undefined);
    expect(out).not.toBe(def);
    expect(def).toEqual(['a', 'b', 'c']);
  });

  it('예시 1: def=[a,b,c], override=[c,a] → [c,a,b]', () => {
    expect(resolvePresetOrder(['a', 'b', 'c'], ['c', 'a'])).toEqual([
      'c',
      'a',
      'b',
    ]);
  });

  it('예시 2: def=[x,a,b], override=[b,a] → [x,b,a] (신규 x 는 맨 앞)', () => {
    expect(resolvePresetOrder(['x', 'a', 'b'], ['b', 'a'])).toEqual([
      'x',
      'b',
      'a',
    ]);
  });

  it('예시 3: def=[a,b], override=[b,zombie,a] → [b,a] (stale 무시)', () => {
    expect(resolvePresetOrder(['a', 'b'], ['b', 'zombie', 'a'])).toEqual([
      'b',
      'a',
    ]);
  });

  it('완전 재배열(전 키 포함) → 오버라이드 순서 그대로', () => {
    expect(
      resolvePresetOrder(['a', 'b', 'c', 'd'], ['d', 'c', 'b', 'a']),
    ).toEqual(['d', 'c', 'b', 'a']);
  });

  it('오버라이드 내 중복 키는 첫 등장만 채택(신규 c 는 정의상 앞선 b 뒤)', () => {
    // override 유효 dedup → [b,a]. 신규 c 는 정의 순서상 바로 앞 b 뒤에 삽입 → [b,c,a].
    expect(resolvePresetOrder(['a', 'b', 'c'], ['b', 'b', 'a'])).toEqual([
      'b',
      'c',
      'a',
    ]);
  });

  it('신규 키는 정의 순서상 앞선 배치 키 뒤에 삽입(중간 위치)', () => {
    // def=[a,b,c,d], override=[d,b] → 신규 a(맨 앞), c(b 뒤) 삽입
    expect(resolvePresetOrder(['a', 'b', 'c', 'd'], ['d', 'b'])).toEqual([
      'a',
      'd',
      'b',
      'c',
    ]);
  });

  it('모든 신규 키(오버라이드에 유효 키 0개) → 정의 순서 복원', () => {
    // stale 만 있는 오버라이드는 사실상 무시되어 정의 순서로 수렴한다.
    expect(resolvePresetOrder(['a', 'b', 'c'], ['zzz', 'yyy'])).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('순열 불변식: 임의 오버라이드에도 결과는 정의 키의 순열(누락·중복 없음)', () => {
    const def = ['a', 'b', 'c', 'd', 'e'];
    const cases: string[][] = [
      [],
      ['e', 'a'],
      ['c'],
      ['x', 'e', 'y', 'b'],
      ['d', 'd', 'c', 'b', 'a', 'e'],
      ['zombie'],
    ];
    for (const override of cases) {
      const out = resolvePresetOrder(def, override);
      // 길이 = 정의 키 수, 집합 동일, 중복 없음.
      expect(out.length).toBe(def.length);
      expect(new Set(out)).toEqual(new Set(def));
      expect(new Set(out).size).toBe(out.length);
    }
  });
});

describe('presetStackKeys — 합성 스택 검증', () => {
  it('최상위 요소들의 wfiElementKey 를 정의 순서대로 반환', () => {
    // presetSelect(명시 id) + inline(field 키) + ifIn/sceneOnly(내부 폴백) 혼합.
    const stack: WFIStack = wfiStack([
      wfiPresetSelect('presetSelect'),
      wfiInlineInput('시드', 'seed', 'shared', 'flex-none'),
      wfiIfIn('method', 'shared', ['txt2img'], wfiInlineInput(
        '프롬프트',
        'frontPrompt',
        'preset',
        'flex-1',
      )),
      wfiSceneOnly(wfiInlineInput('감정', 'emotion', 'meta', 'flex-none')),
    ]);
    expect(presetStackKeys(stack)).toEqual([
      'presetSelect',
      'seed',
      'frontPrompt',
      'emotion',
    ]);
  });

  it('키를 구할 수 없는 요소(id 없는 presetSelect)는 방어적으로 걸러낸다', () => {
    const stack: WFIStack = wfiStack([
      wfiPresetSelect(), // id 없음 → 키 undefined → 제외
      wfiInlineInput('시드', 'seed', 'shared', 'flex-none'),
    ]);
    expect(presetStackKeys(stack)).toEqual(['seed']);
  });
});

describe('movePresetOrder — 편집모드 이동 계산(앵커 클램프)', () => {
  // 앵커 목록을 명시 지정해 테스트를 상수 변경에 독립시킨다.
  const AK = ['anchor'];

  it('아래로 이동: 대상 인덱스(제거 후 배열 기준)에 삽입', () => {
    // order=[a,b,c,d], a 를 c 뒤(제거 후 [b,c,d] 의 idx 2)로 → [b,c,a,d]
    expect(movePresetOrder(['a', 'b', 'c', 'd'], 'a', 2, [])).toEqual([
      'b',
      'c',
      'a',
      'd',
    ]);
  });

  it('위로 이동: 앞쪽 인덱스에 삽입', () => {
    // order=[a,b,c,d], d 를 맨 앞(idx 0)으로 → 제거 후 [a,b,c], 삽입 → [d,a,b,c]
    expect(movePresetOrder(['a', 'b', 'c', 'd'], 'd', 0, [])).toEqual([
      'd',
      'a',
      'b',
      'c',
    ]);
  });

  it('맨 뒤로 이동(toIndex 상한 클램프)', () => {
    expect(movePresetOrder(['a', 'b', 'c'], 'a', 99, [])).toEqual([
      'b',
      'c',
      'a',
    ]);
  });

  it('앵커 앞 삽입 시도 → 앵커 바로 뒤로 클램프', () => {
    // order=[anchor,a,b], b 를 맨 앞(idx 0) 시도 → 앵커 뒤(idx 1)로 클램프 → [anchor,b,a]
    expect(movePresetOrder(['anchor', 'a', 'b'], 'b', 0, AK)).toEqual([
      'anchor',
      'b',
      'a',
    ]);
  });

  it('앵커 키 자체는 이동 무시(원본 순열의 새 복사본)', () => {
    const order = ['anchor', 'a', 'b'];
    const out = movePresetOrder(order, 'anchor', 2, AK);
    expect(out).toEqual(['anchor', 'a', 'b']);
    expect(out).not.toBe(order); // 새 배열
  });

  it('없는 키 이동 시도 → 원본의 새 복사본(무해)', () => {
    const order = ['a', 'b'];
    const out = movePresetOrder(order, 'zombie', 0, []);
    expect(out).toEqual(['a', 'b']);
    expect(out).not.toBe(order);
  });

  it('순열 불변식: 임의 이동에도 결과는 원본 키의 순열(누락·중복 없음)', () => {
    const order = ['anchor', 'a', 'b', 'c', 'd'];
    for (const [from, to] of [
      ['a', 0],
      ['d', 1],
      ['b', 99],
      ['c', -5],
    ] as [string, number][]) {
      const out = movePresetOrder(order, from, to, AK);
      expect(out.length).toBe(order.length);
      expect(new Set(out)).toEqual(new Set(order));
      expect(new Set(out).size).toBe(out.length);
      // 앵커는 항상 맨 앞 유지.
      expect(out[0]).toBe('anchor');
    }
  });

  it('기본 앵커 상수로 preset-select 는 최상단 고정', () => {
    const order = ['preset-select', 'frontPrompt', 'seed'];
    // seed 를 맨 앞 시도 → 앵커(preset-select) 뒤로 클램프.
    expect(movePresetOrder(order, 'seed', 0)).toEqual([
      'preset-select',
      'seed',
      'frontPrompt',
    ]);
    expect(PRESET_LAYOUT_ANCHOR_KEYS).toContain('preset-select');
    expect(PRESET_LAYOUT_ANCHOR_KEYS).toContain('profile-preset-select');
  });
});

describe('presetRowLabel — 빈 행 자리표시 칩 라벨 도출', () => {
  it('inline 은 label 을 그대로 쓴다', () => {
    expect(
      presetRowLabel(wfiInlineInput('상위 프롬프트', 'frontPrompt', 'preset', 'flex-1')),
    ).toBe('상위 프롬프트');
  });

  it('group 은 label 을 그대로 쓴다', () => {
    expect(presetRowLabel(wfiGroup('고급 설정', []))).toBe('고급 설정');
  });

  it('middlePlaceholder 는 label 을 그대로 쓴다', () => {
    expect(presetRowLabel(wfiMiddlePlaceholderInput('중간 프롬프트'))).toBe(
      '중간 프롬프트',
    );
  });

  it('ifIn 래퍼는 내부 요소의 label 로 폴백한다', () => {
    const inner = wfiInlineInput('네거티브', 'negativePrompt', 'preset', 'flex-1');
    expect(presetRowLabel(wfiIfIn('method', 'shared', ['txt2img'], inner))).toBe(
      '네거티브',
    );
  });

  it('sceneOnly 래퍼도 내부 요소 label 로 폴백한다', () => {
    const inner = wfiInlineInput('감정', 'emotion', 'meta', 'flex-none');
    expect(presetRowLabel(wfiSceneOnly(inner))).toBe('감정');
  });

  it('label 없는 타입은 안정 키 문자열(id)로 폴백한다', () => {
    // push 는 label 이 없다 — 편집모드에서 키가 필요하므로 id 를 폴백 라벨로.
    expect(presetRowLabel(wfiPush('bottom', 'tailPush'))).toBe('tailPush');
  });

  it('label·키 모두 없으면 타입명으로 폴백한다', () => {
    // id 없는 push → 키 undefined → 타입명 'push'.
    expect(presetRowLabel(wfiPush('bottom'))).toBe('push');
  });
});

describe('presetLayoutSlotKey — 슬롯 키 계약', () => {
  it('editor 루트(inner=false)는 workflowType 그대로', () => {
    expect(presetLayoutSlotKey('SDImageGen', false)).toBe('SDImageGen');
  });

  it('innerEditor 루트(inner=true)는 `${type}@inner`', () => {
    expect(presetLayoutSlotKey('SDImageGenEasy', true)).toBe(
      'SDImageGenEasy@inner',
    );
  });
});

describe('resolveStackInputs — 루트 스택 재배열(렌더 순서 결정)', () => {
  const mkStack = () =>
    wfiStack([
      wfiPresetSelect('presetSelect'),
      wfiInlineInput('시드', 'seed', 'shared', 'flex-none'),
      wfiInlineInput('프롬프트', 'frontPrompt', 'preset', 'flex-1'),
    ]);

  it('오버라이드 없음(undefined) → 원본 inputs 동일 참조(회귀 기준)', () => {
    const stack = mkStack();
    expect(resolveStackInputs(stack, undefined)).toBe(stack.inputs);
  });

  it('오버라이드 빈 배열 → 원본 inputs 동일 참조', () => {
    const stack = mkStack();
    expect(resolveStackInputs(stack, [])).toBe(stack.inputs);
  });

  it('오버라이드 적용 → 요소를 키 순서로 재배열(동일 요소 참조 유지)', () => {
    const stack = mkStack();
    const [presetSel, seed, frontPrompt] = stack.inputs;
    const out = resolveStackInputs(stack, ['frontPrompt', 'presetSelect']);
    // resolvePresetOrder(['presetSelect','seed','frontPrompt'], ['frontPrompt','presetSelect'])
    //   = ['frontPrompt','presetSelect','seed'] (신규 seed 는 presetSelect 뒤에 삽입)
    expect(out).toEqual([frontPrompt, presetSel, seed]);
    // 재배열은 원본 요소 참조를 그대로 재사용한다(복제·소실 없음).
    expect(out).toContain(presetSel);
    expect(out).toContain(seed);
    expect(out).toContain(frontPrompt);
  });

  it('순열 불변식: 임의 오버라이드에도 결과는 원본 요소의 순열(누락·중복 없음)', () => {
    const stack = mkStack();
    const cases: string[][] = [
      ['frontPrompt', 'seed', 'presetSelect'],
      ['seed'],
      ['zombie', 'frontPrompt'],
    ];
    for (const override of cases) {
      const out = resolveStackInputs(stack, override);
      expect(out.length).toBe(stack.inputs.length);
      expect(new Set(out)).toEqual(new Set(stack.inputs));
      expect(new Set(out).size).toBe(out.length);
    }
  });

  it('키 없는 최상위 요소가 있으면 순서 적용 포기 → 정의 순서(동일 참조)', () => {
    // id 없는 presetSelect(키 undefined)가 섞이면 오버라이드가 있어도 통째로 정의 순서 폴백.
    const stack: WFIStack = wfiStack([
      wfiPresetSelect(), // 키 없음
      wfiInlineInput('시드', 'seed', 'shared', 'flex-none'),
    ]);
    expect(resolveStackInputs(stack, ['seed'])).toBe(stack.inputs);
  });
});
