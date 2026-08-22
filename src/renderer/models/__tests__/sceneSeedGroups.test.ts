jest.mock('..', () => ({ workFlowService: {} }));

import { Scene, Session } from '../types';
import {
  assignScenesToSeedGroup,
  createSceneSeedGroup,
  dissolveSceneSeedGroup,
  getSceneSeedGroupInfo,
  listSceneSeedGroups,
  readSceneSeedGroup,
  removeScenesFromSeedGroups,
  resolveSceneSeed,
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
