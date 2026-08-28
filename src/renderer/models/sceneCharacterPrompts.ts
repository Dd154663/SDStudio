import { CharacterPrompt, Scene } from './types';

export type SceneCharacterPromptMode = 'base' | 'mix' | 'scene';

const MODES: SceneCharacterPromptMode[] = ['base', 'mix', 'scene'];

export function getSceneCharacterPromptMode(
  scene: Scene,
): SceneCharacterPromptMode {
  if (
    scene.sceneCharacterPromptMode &&
    MODES.includes(scene.sceneCharacterPromptMode)
  ) {
    return scene.sceneCharacterPromptMode;
  }
  return scene.useSceneCharacterPrompts ? 'scene' : 'base';
}

export function setSceneCharacterPromptMode(
  scene: Scene,
  mode: SceneCharacterPromptMode,
) {
  scene.sceneCharacterPromptMode = mode;
  // 구버전은 mix를 이해하지 못하므로 기본 캐릭터를 보존하는 쪽으로 폴백한다.
  scene.useSceneCharacterPrompts = mode === 'scene';
}

function ordered(items: CharacterPrompt[]): CharacterPrompt[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const ao = Number.isFinite(a.item.order) ? a.item.order! : Infinity;
      const bo = Number.isFinite(b.item.order) ? b.item.order! : Infinity;
      return ao - bo || a.index - b.index;
    })
    .map(({ item }) => item);
}

export function getOrderedBaseCharacterPrompts(
  preset: any,
  shared: any,
): CharacterPrompt[] {
  // order가 없는 구 프로젝트의 실제 생성 순서(preset → shared)를 유지한다.
  return ordered([
    ...(preset?.characterPrompts || []),
    ...(shared?.characterPrompts || []),
  ]);
}

export function reorderBaseCharacterPrompts(
  preset: any,
  shared: any,
  fromIndex: number,
  toIndex: number,
): boolean {
  const current = getOrderedBaseCharacterPrompts(preset, shared);
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= current.length ||
    toIndex >= current.length ||
    fromIndex === toIndex
  ) {
    return false;
  }
  const next = [...current];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  const orderById = new Map(next.map((item, index) => [item.id, index]));
  if (preset?.characterPrompts) {
    preset.characterPrompts = preset.characterPrompts.map(
      (item: CharacterPrompt) => ({
        ...item,
        order: orderById.get(item.id),
      }),
    );
  }
  if (shared?.characterPrompts) {
    shared.characterPrompts = shared.characterPrompts.map(
      (item: CharacterPrompt) => ({
        ...item,
        order: orderById.get(item.id),
      }),
    );
  }
  return true;
}

export function reorderSceneCharacterPrompts(
  scene: Scene,
  fromIndex: number,
  toIndex: number,
): boolean {
  const current = [...(scene.sceneCharacterPrompts || [])];
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= current.length ||
    toIndex >= current.length ||
    fromIndex === toIndex
  ) {
    return false;
  }
  const [moved] = current.splice(fromIndex, 1);
  current.splice(toIndex, 0, moved);
  scene.sceneCharacterPrompts = current;
  return true;
}

function joinPrompt(base: string, addition: string): string {
  return [base, addition]
    .map((value) => (value || '').trim())
    .filter(Boolean)
    .join(', ');
}

export function resolveSceneCharacterPrompts(
  preset: any,
  shared: any,
  scene: Scene,
): CharacterPrompt[] {
  const base = getOrderedBaseCharacterPrompts(preset, shared);
  const roles = scene.sceneCharacterPrompts || [];
  const mode = getSceneCharacterPromptMode(scene);

  if (mode === 'base' || roles.length === 0) return [...base];

  if (mode === 'mix') {
    // 역할은 같은 번호의 기본 캐릭터에만 적용한다. 남는 역할은 대기 상태이며
    // 외형 없는 캐릭터를 임의로 만들지 않는다.
    return base.map((character, index) => {
      const role = roles[index];
      if (!role) return { ...character };
      return {
        ...character,
        prompt: joinPrompt(character.prompt, role.prompt),
        uc: joinPrompt(character.uc, role.uc),
        position: role.position || character.position,
        enabled:
          character.enabled !== false && role.enabled !== false,
      };
    });
  }

  // 기존 씬 전용 동작: 직접입력 캐릭터는 대체하지만 적용된 캐릭터 프리셋은 유지한다.
  return [
    ...roles,
    ...ordered([...(shared?.characterPrompts || [])]),
  ];
}

export function usesSceneCharacterPromptData(scene: Scene): boolean {
  return (
    getSceneCharacterPromptMode(scene) !== 'base' &&
    (scene.sceneCharacterPrompts?.length || 0) > 0
  );
}
