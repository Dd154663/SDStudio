import { v4 as uuidv4 } from 'uuid';
import { Scene, Session } from './types';

export const SCENE_SEED_GROUP_META_KEY = '__sdstudioSceneSeedGroupV1';
export const MAX_NAI_SEED = 0xffffffff;

export interface SceneSeedGroupMeta {
  version: 1;
  id: string;
  order: number;
  seed?: number;
}

export interface SceneSeedGroupInfo extends SceneSeedGroupMeta {
  label: string;
  displayIndex: number;
  scenes: Scene[];
}

function validSeed(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_NAI_SEED
  );
}

export function readSceneSeedGroup(
  scene: Scene,
): SceneSeedGroupMeta | undefined {
  const raw = scene.meta.get(SCENE_SEED_GROUP_META_KEY);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  if (raw.version !== 1 || typeof raw.id !== 'string' || raw.id.length === 0)
    return undefined;
  if (!Number.isFinite(raw.order) || raw.order < 0) return undefined;
  if (raw.seed !== undefined && !validSeed(raw.seed)) return undefined;
  return {
    version: 1,
    id: raw.id,
    order: Math.floor(raw.order),
    ...(validSeed(raw.seed) ? { seed: raw.seed } : {}),
  };
}

export function sceneSeedGroupLabel(index: number): string {
  let value = Math.max(0, Math.floor(index));
  let label = '';
  do {
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return label;
}

export function listSceneSeedGroups(session: Session): SceneSeedGroupInfo[] {
  const byId = new Map<
    string,
    { order: number; seed?: number; scenes: Scene[]; firstIndex: number }
  >();
  Array.from(session.scenes.values()).forEach((scene, firstIndex) => {
    const meta = readSceneSeedGroup(scene);
    if (!meta) return;
    const found = byId.get(meta.id);
    if (found) {
      found.scenes.push(scene);
      found.order = Math.min(found.order, meta.order);
      if (found.seed === undefined && meta.seed !== undefined)
        found.seed = meta.seed;
      return;
    }
    byId.set(meta.id, {
      order: meta.order,
      seed: meta.seed,
      scenes: [scene],
      firstIndex,
    });
  });

  return Array.from(byId.entries())
    .sort(
      ([idA, a], [idB, b]) =>
        a.order - b.order ||
        a.firstIndex - b.firstIndex ||
        idA.localeCompare(idB),
    )
    .map(([id, group], index) => ({
      version: 1,
      id,
      order: group.order,
      seed: group.seed,
      scenes: group.scenes,
      label: sceneSeedGroupLabel(index),
      displayIndex: index,
    }));
}

export function getSceneSeedGroupInfo(
  session: Session,
  scene: Scene,
): SceneSeedGroupInfo | undefined {
  const meta = readSceneSeedGroup(scene);
  if (!meta) return undefined;
  return listSceneSeedGroups(session).find((group) => group.id === meta.id);
}

export function createSceneSeedGroup(
  session: Session,
  scenes: Scene[],
): SceneSeedGroupInfo | undefined {
  const unique = Array.from(new Set(scenes));
  if (unique.length < 2) return undefined;
  const groups = listSceneSeedGroups(session);
  const order =
    groups.reduce((max, group) => Math.max(max, group.order), -1) + 1;
  const id = uuidv4();
  for (const scene of unique) {
    scene.meta.set(SCENE_SEED_GROUP_META_KEY, { version: 1, id, order });
  }
  return getSceneSeedGroupInfo(session, unique[0]);
}

export function assignScenesToSeedGroup(
  session: Session,
  scenes: Scene[],
  groupId: string,
): boolean {
  const target = listSceneSeedGroups(session).find(
    (group) => group.id === groupId,
  );
  if (!target) return false;
  for (const scene of new Set(scenes)) {
    scene.meta.set(SCENE_SEED_GROUP_META_KEY, {
      version: 1,
      id: target.id,
      order: target.order,
      ...(target.seed !== undefined ? { seed: target.seed } : {}),
    });
  }
  return true;
}

export function removeScenesFromSeedGroups(scenes: Scene[]): number {
  let changed = 0;
  for (const scene of new Set(scenes)) {
    if (scene.meta.delete(SCENE_SEED_GROUP_META_KEY)) changed++;
  }
  return changed;
}

export function dissolveSceneSeedGroup(
  session: Session,
  groupId: string,
): number {
  const target = listSceneSeedGroups(session).find(
    (group) => group.id === groupId,
  );
  return target ? removeScenesFromSeedGroups(target.scenes) : 0;
}

export function setSceneSeedGroupSeed(
  session: Session,
  groupId: string,
  seed: number | undefined,
): boolean {
  if (seed !== undefined && !validSeed(seed)) return false;
  const target = listSceneSeedGroups(session).find(
    (group) => group.id === groupId,
  );
  if (!target) return false;
  for (const scene of target.scenes) {
    scene.meta.set(SCENE_SEED_GROUP_META_KEY, {
      version: 1,
      id: target.id,
      order: target.order,
      ...(seed !== undefined ? { seed } : {}),
    });
  }
  return true;
}

export function resolveSceneSeed(
  scene: Scene,
  commonSeed?: number | null,
): number | undefined {
  const groupSeed = readSceneSeedGroup(scene)?.seed;
  if (groupSeed !== undefined) return groupSeed;
  return validSeed(commonSeed) ? commonSeed : undefined;
}
