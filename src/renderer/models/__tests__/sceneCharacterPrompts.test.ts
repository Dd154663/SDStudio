jest.mock('..', () => ({}));

import { Scene } from '../types';
import {
  getSceneCharacterPromptMode,
  reorderBaseCharacterPrompts,
  reorderSceneCharacterPrompts,
  resolveSceneCharacterPrompts,
  setSceneCharacterPromptMode,
} from '../sceneCharacterPrompts';

const cp = (id: string, prompt: string, x = 0.5) => ({
  id,
  prompt,
  uc: '',
  position: { x, y: 0.5 },
  enabled: true,
});

describe('씬 캐릭터 역할 혼합', () => {
  test('구 프로젝트의 boolean 모드를 같은 의미로 해석한다', () => {
    const scene = new Scene();
    expect(getSceneCharacterPromptMode(scene)).toBe('base');
    scene.useSceneCharacterPrompts = true;
    expect(getSceneCharacterPromptMode(scene)).toBe('scene');
  });

  test('역할 혼합은 같은 순번의 프롬프트와 UC를 합치고 역할 좌표를 사용한다', () => {
    const scene = new Scene();
    scene.sceneCharacterPrompts = [
      { ...cp('role-1', 'pointing sword', 0.2), uc: 'shield' },
      cp('role-2', 'sitting', 0.8),
    ];
    setSceneCharacterPromptMode(scene, 'mix');
    const preset = {
      characterPrompts: [
        { ...cp('alice', 'alice'), uc: 'hat' },
        cp('bob', 'bob'),
      ],
    };

    const result = resolveSceneCharacterPrompts(preset, {}, scene);

    expect(result.map((item) => item.prompt)).toEqual([
      'alice, pointing sword',
      'bob, sitting',
    ]);
    expect(result[0].uc).toBe('hat, shield');
    expect(result[0].position.x).toBe(0.2);
    expect(result[1].position.x).toBe(0.8);
  });

  test('기본 캐릭터보다 많은 역할은 대기하고 기본의 남는 캐릭터는 유지한다', () => {
    const scene = new Scene();
    scene.sceneCharacterPrompts = [
      cp('role-1', 'left'),
      cp('role-2', 'right'),
      cp('role-3', 'center'),
    ];
    setSceneCharacterPromptMode(scene, 'mix');

    const one = resolveSceneCharacterPrompts(
      { characterPrompts: [cp('a', 'A')] },
      {},
      scene,
    );
    expect(one.map((item) => item.prompt)).toEqual(['A, left']);

    scene.sceneCharacterPrompts = [cp('role-1', 'left')];
    const two = resolveSceneCharacterPrompts(
      { characterPrompts: [cp('a', 'A'), cp('b', 'B')] },
      {},
      scene,
    );
    expect(two.map((item) => item.prompt)).toEqual(['A, left', 'B']);
  });

  test('역할을 끄면 대응 기본 캐릭터만 비활성화한다', () => {
    const scene = new Scene();
    scene.sceneCharacterPrompts = [
      { ...cp('role-1', 'left'), enabled: false },
      cp('role-2', 'right'),
    ];
    setSceneCharacterPromptMode(scene, 'mix');

    const result = resolveSceneCharacterPrompts(
      { characterPrompts: [cp('a', 'A'), cp('b', 'B')] },
      {},
      scene,
    );

    expect(result.map((item) => item.enabled)).toEqual([false, true]);
  });

  test('씬 전용 모드는 구 동작처럼 역할 뒤에 적용 프리셋 캐릭터를 유지한다', () => {
    const scene = new Scene();
    scene.sceneCharacterPrompts = [cp('role-1', 'R1')];
    setSceneCharacterPromptMode(scene, 'scene');

    const result = resolveSceneCharacterPrompts(
      { characterPrompts: [cp('direct', 'Direct')] },
      { characterPrompts: [{ ...cp('linked', 'Linked'), fromPreset: 'P' }] },
      scene,
    );

    expect(result.map((item) => item.prompt)).toEqual(['R1', 'Linked']);
  });

  test('기본과 역할 순서를 각각 바꿀 수 있다', () => {
    const preset = { characterPrompts: [cp('a', 'A'), cp('b', 'B')] };
    const shared = { characterPrompts: [cp('c', 'C')] };
    expect(reorderBaseCharacterPrompts(preset, shared, 2, 0)).toBe(true);
    const scene = new Scene();
    scene.sceneCharacterPrompts = [cp('r1', 'R1'), cp('r2', 'R2')];
    expect(reorderSceneCharacterPrompts(scene, 1, 0)).toBe(true);
    setSceneCharacterPromptMode(scene, 'mix');

    expect(
      resolveSceneCharacterPrompts(preset, shared, scene).map(
        (item) => item.prompt,
      ),
    ).toEqual(['C, R2', 'A, R1', 'B']);
  });

  test('mix는 구버전에서 기본 프롬프트를 보존하도록 boolean을 끈다', () => {
    const scene = new Scene();
    setSceneCharacterPromptMode(scene, 'mix');
    expect(scene.useSceneCharacterPrompts).toBe(false);
    expect(scene.toJSON().sceneCharacterPromptMode).toBe('mix');
    expect(Scene.fromJSON(scene.toJSON()).sceneCharacterPromptMode).toBe('mix');
  });
});
