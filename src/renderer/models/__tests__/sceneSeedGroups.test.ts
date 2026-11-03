jest.mock('..', () => ({ workFlowService: {} }));

import { InpaintScene, Scene, Session } from '../types';
import {
  assignScenesToSeedGroup,
  createSceneSeedGroup,
  dissolveSceneSeedGroup,
  getSceneSeedGroupInfo,
  listSceneSeedGroups,
  readSceneSeedGroup,
  removeScenesFromSeedGroups,
  resolveSceneSeed,
  resolveVariantSceneSeed,
  sceneSeedGroupLabel,
  setSceneSeedGroupSeed,
} from '../sceneSeedGroups';

function makeSession(...names: string[]): {
  session: Session;
  scenes: Scene[];
} {
  const session = new Session();
  session.name = 'test';
  const scenes = names.map((name) => {
    const scene = new Scene();
    scene.name = name;
    session.scenes.set(name, scene);
    return scene;
  });
  return { session, scenes };
}

describe('sceneSeedGroups', () => {
  it('그룹 시드가 없으면 공통 시드와 랜덤 흐름을 유지한다', () => {
    const scene = new Scene();
    expect(resolveSceneSeed(scene, 123)).toBe(123);
    expect(resolveSceneSeed(scene, null)).toBeUndefined();
  });

  it('그룹 시드가 공통 시드보다 우선한다', () => {
    const { session, scenes } = makeSession('a', 'b');
    const group = createSceneSeedGroup(session, scenes)!;
    expect(setSceneSeedGroupSeed(session, group.id, 987654321)).toBe(true);
    expect(resolveSceneSeed(scenes[0], 123)).toBe(987654321);
    expect(resolveSceneSeed(scenes[1], null)).toBe(987654321);
  });

  it('0 시드를 명시값으로 유지한다', () => {
    const { session, scenes } = makeSession('a', 'b');
    const group = createSceneSeedGroup(session, scenes)!;
    expect(setSceneSeedGroupSeed(session, group.id, 0)).toBe(true);
    expect(resolveSceneSeed(scenes[0], 123)).toBe(0);
  });

  it('그룹 삭제 후 표기 문자를 A부터 자동으로 다시 붙인다', () => {
    const { session, scenes } = makeSession('a', 'b', 'c', 'd');
    const first = createSceneSeedGroup(session, scenes.slice(0, 2))!;
    createSceneSeedGroup(session, scenes.slice(2))!;
    expect(listSceneSeedGroups(session).map((g) => g.label)).toEqual([
      'A',
      'B',
    ]);
    dissolveSceneSeedGroup(session, first.id);
    expect(listSceneSeedGroups(session).map((g) => g.label)).toEqual(['A']);
    expect(getSceneSeedGroupInfo(session, scenes[2])?.label).toBe('A');
  });

  it('기존 그룹 합류와 일부 제외를 지원한다', () => {
    const { session, scenes } = makeSession('a', 'b', 'c');
    const group = createSceneSeedGroup(session, scenes.slice(0, 2))!;
    expect(assignScenesToSeedGroup(session, [scenes[2]], group.id)).toBe(true);
    expect(listSceneSeedGroups(session)[0].scenes).toHaveLength(3);
    expect(removeScenesFromSeedGroups([scenes[1]])).toBe(1);
    expect(listSceneSeedGroups(session)[0].scenes).toHaveLength(2);
  });

  it('씬 JSON 라운드트립에서 예약 메타를 보존한다', () => {
    const { session, scenes } = makeSession('a', 'b');
    const group = createSceneSeedGroup(session, scenes)!;
    setSceneSeedGroupSeed(session, group.id, 42);
    const restored = Scene.fromJSON(scenes[0].toJSON());
    expect(readSceneSeedGroup(restored)).toEqual(readSceneSeedGroup(scenes[0]));
  });

  it('손상된 메타와 범위 밖 시드는 무시한다', () => {
    const scene = new Scene();
    scene.meta.set('__sdstudioSceneSeedGroupV1', {
      version: 1,
      id: 'x',
      order: 0,
      seed: 4294967296,
    });
    expect(readSceneSeedGroup(scene)).toBeUndefined();
    expect(resolveSceneSeed(scene, 7)).toBe(7);
  });

  it('26개 이후 표기를 AA로 확장한다', () => {
    expect(sceneSeedGroupLabel(0)).toBe('A');
    expect(sceneSeedGroupLabel(25)).toBe('Z');
    expect(sceneSeedGroupLabel(26)).toBe('AA');
    expect(sceneSeedGroupLabel(27)).toBe('AB');
  });
});

describe('씬 전용 시드 우선순위(2026-09-26)', () => {
  it('씬 전용 시드 → 그룹 시드 → 공통 시드 → 랜덤 순', () => {
    const { session, scenes } = makeSession('a', 'b');
    const group = createSceneSeedGroup(session, scenes)!;
    setSceneSeedGroupSeed(session, group.id, 777);
    scenes[0].sceneSeed = 42;
    expect(resolveSceneSeed(scenes[0], 123)).toBe(42);
    expect(resolveSceneSeed(scenes[1], 123)).toBe(777);
    scenes[0].sceneSeed = undefined;
    expect(resolveSceneSeed(scenes[0], 123)).toBe(777);
    const lone = new Scene();
    lone.sceneSeed = 5;
    expect(resolveSceneSeed(lone, 123)).toBe(5);
    lone.sceneSeed = undefined;
    expect(resolveSceneSeed(lone, 123)).toBe(123);
    expect(resolveSceneSeed(lone, null)).toBeUndefined();
  });
  it('범위 밖 씬 전용 시드는 무시하고 다음 단계로', () => {
    const scene = new Scene();
    scene.sceneSeed = -1;
    expect(resolveSceneSeed(scene, 9)).toBe(9);
    scene.sceneSeed = 1.5;
    expect(resolveSceneSeed(scene, 9)).toBe(9);
  });
  it('직렬화: 있으면 저장, 없으면 키 생략, 손상 값은 미설정으로 복원', () => {
    const scene = new Scene();
    scene.name = 's';
    scene.slots = [];
    expect('sceneSeed' in scene.toJSON()).toBe(false);
    scene.sceneSeed = 0;
    const json = scene.toJSON();
    expect(json.sceneSeed).toBe(0);
    expect(Scene.fromJSON(json).sceneSeed).toBe(0);
    expect(Scene.fromJSON({ ...json, sceneSeed: undefined }).sceneSeed).toBeUndefined();
    expect(Scene.fromJSON({ ...json, sceneSeed: '12' as any }).sceneSeed).toBeUndefined();
    expect(Scene.fromJSON({ ...json, sceneSeed: 2 ** 32 }).sceneSeed).toBeUndefined();
  });
});

// 변형 씬(I2I·인페인트·미러) 시드 고정·시드 그룹(2026-11-03 이슈 #9)
function makeVariant(name: string): InpaintScene {
  return InpaintScene.fromJSON({
    type: 'inpaint',
    name,
    workflowType: 'SDI2I',
    resolution: 'portrait',
    imageMap: [],
    mains: [],
  } as any)!;
}

function makeMixedSession(normal: string[], variant: string[]) {
  const session = new Session();
  session.name = 'mixed';
  const scenes = normal.map((name) => {
    const scene = new Scene();
    scene.name = name;
    session.addScene(scene);
    return scene;
  });
  const variants = variant.map((name) => {
    const scene = makeVariant(name);
    session.addScene(scene);
    return scene;
  });
  return { session, scenes, variants };
}

describe('변형 씬 시드 우선순위(2026-11-03)', () => {
  it('프리셋 시드 → 그룹 시드 → 메인 시드 → 랜덤 순', () => {
    const { session, variants } = makeMixedSession([], ['a', 'b']);
    const group = createSceneSeedGroup(session, variants)!;
    expect(setSceneSeedGroupSeed(session, group.id, 777, 'inpaint')).toBe(true);
    const [a] = variants;
    expect(resolveVariantSceneSeed(a, { seed: 42 }, 123)).toBe(42);
    expect(resolveVariantSceneSeed(a, { seed: null }, 123)).toBe(777);
    expect(resolveVariantSceneSeed(a, {}, 123)).toBe(777);
    removeScenesFromSeedGroups([a]);
    expect(resolveVariantSceneSeed(a, { seed: undefined }, 123)).toBe(123);
    expect(resolveVariantSceneSeed(a, { seed: undefined }, undefined)).toBeUndefined();
    expect(resolveVariantSceneSeed(a, undefined, null)).toBeUndefined();
  });

  it('0 은 유효, 범위 밖·소수·문자열은 다음 단계로', () => {
    const scene = makeVariant('v');
    expect(resolveVariantSceneSeed(scene, { seed: 0 }, 5)).toBe(0);
    expect(resolveVariantSceneSeed(scene, { seed: -1 }, 5)).toBe(5);
    expect(resolveVariantSceneSeed(scene, { seed: 1.5 }, 5)).toBe(5);
    expect(resolveVariantSceneSeed(scene, { seed: '12' }, 5)).toBe(5);
    expect(resolveVariantSceneSeed(scene, { seed: 2 ** 32 }, 5)).toBe(5);
    expect(resolveVariantSceneSeed(scene, {}, 2 ** 32)).toBeUndefined();
    expect(resolveVariantSceneSeed(scene, {}, 0)).toBe(0);
  });

  it('이미지생성 씬(이미지 변형 메뉴가 넘기는 씬)의 그룹·씬 전용 시드는 읽지 않는다', () => {
    const { session, scenes } = makeMixedSession(['a', 'b'], []);
    const group = createSceneSeedGroup(session, scenes)!;
    setSceneSeedGroupSeed(session, group.id, 999);
    scenes[0].sceneSeed = 55;
    expect(resolveVariantSceneSeed(scenes[0], {}, 123)).toBe(123);
    expect(resolveVariantSceneSeed(scenes[0], {}, undefined)).toBeUndefined();
    // meta 가 없는 임시 씬 모양도 안전
    expect(resolveVariantSceneSeed({ type: 'inpaint' }, {}, 7)).toBe(7);
  });
});

describe('변형 씬 시드 그룹(2026-11-03)', () => {
  it('이름표는 탭(씬 종류)별로 독립', () => {
    const { session, scenes, variants } = makeMixedSession(['n1', 'n2', 'n3', 'n4'], ['v1', 'v2']);
    createSceneSeedGroup(session, scenes.slice(0, 2));
    createSceneSeedGroup(session, scenes.slice(2));
    const vg = createSceneSeedGroup(session, variants)!;
    expect(vg.label).toBe('A');
    expect(listSceneSeedGroups(session).map((g) => g.label)).toEqual(['A', 'B']);
    expect(listSceneSeedGroups(session, 'inpaint').map((g) => g.label)).toEqual(['A']);
    expect(listSceneSeedGroups(session, 'inpaint')[0].scenes).toEqual(variants);
    expect(getSceneSeedGroupInfo(session, variants[1])?.id).toBe(vg.id);
    // 다른 탭의 그룹 시드·해제 함수는 그 탭에서만 찾는다
    expect(setSceneSeedGroupSeed(session, vg.id, 5)).toBe(false);
    expect(setSceneSeedGroupSeed(session, vg.id, 5, 'inpaint')).toBe(true);
    expect(dissolveSceneSeedGroup(session, vg.id)).toBe(0);
    expect(dissolveSceneSeedGroup(session, vg.id, 'inpaint')).toBe(2);
    expect(listSceneSeedGroups(session, 'inpaint')).toHaveLength(0);
    expect(listSceneSeedGroups(session)).toHaveLength(2);
  });

  it('일반↔변형 혼합 그룹은 만들거나 합류할 수 없다', () => {
    const { session, scenes, variants } = makeMixedSession(['n1', 'n2'], ['v1', 'v2', 'v3']);
    expect(createSceneSeedGroup(session, [scenes[0], variants[0]])).toBeUndefined();
    const ng = createSceneSeedGroup(session, scenes)!;
    const vg = createSceneSeedGroup(session, variants.slice(0, 2))!;
    // 다른 종류 그룹 id → 거부
    expect(assignScenesToSeedGroup(session, [variants[2]], ng.id)).toBe(false);
    expect(readSceneSeedGroup(variants[2])).toBeUndefined();
    // 섞인 씬 목록 → 거부
    expect(assignScenesToSeedGroup(session, [variants[2], scenes[0]], vg.id)).toBe(false);
    expect(readSceneSeedGroup(variants[2])).toBeUndefined();
    // 같은 종류는 합류
    expect(assignScenesToSeedGroup(session, [variants[2]], vg.id)).toBe(true);
    expect(listSceneSeedGroups(session, 'inpaint')[0].scenes).toHaveLength(3);
  });

  it('InpaintScene meta JSON 왕복 — 비면 키 생략, 키 없음·손상값은 빈 Map', () => {
    const { session, variants } = makeMixedSession([], ['a', 'b']);
    expect('meta' in variants[0].toJSON()).toBe(false);
    const group = createSceneSeedGroup(session, variants)!;
    setSceneSeedGroupSeed(session, group.id, 42, 'inpaint');
    const json = variants[0].toJSON();
    expect(json.meta).toBeDefined();
    const restored = InpaintScene.fromJSON(JSON.parse(JSON.stringify(json)))!;
    expect(typeof restored.meta.get).toBe('function');
    expect(readSceneSeedGroup(restored)).toEqual(readSceneSeedGroup(variants[0]));
    expect(resolveVariantSceneSeed(restored, {}, 1)).toBe(42);
    const { meta: _m, ...noMeta } = json;
    expect(InpaintScene.fromJSON(noMeta as any)!.meta.size).toBe(0);
    for (const bad of [null, 'abc', [1, 2], 3]) {
      const scene = InpaintScene.fromJSON({ ...json, meta: bad } as any)!;
      expect(typeof scene.meta.get).toBe('function');
      expect(scene.meta.size).toBe(0);
      expect('meta' in scene.toJSON()).toBe(false);
    }
  });
});
