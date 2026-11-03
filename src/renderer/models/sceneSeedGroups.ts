import { v4 as uuidv4 } from 'uuid';
import type { InpaintScene, Scene, Session } from './types';

export const SCENE_SEED_GROUP_META_KEY = '__sdstudioSceneSeedGroupV1';
export const MAX_NAI_SEED = 0xffffffff;

export interface SceneSeedGroupMeta {
  version: 1;
  id: string;
  order: number;
  seed?: number;
}

/**
 * 시드 그룹을 가질 수 있는 씬 — 이미지생성 씬(Scene)과 변형 씬(InpaintScene, 2026-11-03 이슈 #9)의 공통 모양(meta Map).
 * 그룹은 씬 종류(탭)별로 따로다: 이름표 A·B… 는 탭마다 독립이고, 일반↔변형 혼합 그룹은 만들지 않는다.
 */
export type SeedGroupScene = Scene | InpaintScene;
export type SeedGroupSceneKind = SeedGroupScene['type'];

export interface SceneSeedGroupInfo extends SceneSeedGroupMeta {
  label: string;
  displayIndex: number;
  scenes: SeedGroupScene[];
}

export function isValidNaiSeed(value: unknown): value is number {
  return validSeed(value);
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
  scene: SeedGroupScene,
): SceneSeedGroupMeta | undefined {
  // meta 가 없는 객체(테스트·보조 경로의 임시 씬 모양)는 그룹 없음으로 본다
  const raw = scene?.meta?.get?.(SCENE_SEED_GROUP_META_KEY);
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

/** 한 종류의 씬 목록이면 그 종류, 섞였거나 비었으면 undefined(혼합 그룹 거부의 단일 판정). */
function sceneKindOf(scenes: readonly SeedGroupScene[]): SeedGroupSceneKind | undefined {
  if (scenes.length === 0) return undefined;
  const kind = scenes[0].type;
  return scenes.every((scene) => scene.type === kind) ? kind : undefined;
}

/**
 * 한 종류(탭)의 시드 그룹 목록 — 이름표는 그 탭 안에서만 A·B… 로 매긴다(기본 = 이미지생성 씬, 기존 호출 호환).
 * 변형 씬 탭은 `type = 'inpaint'`(2026-11-03).
 */
export function listSceneSeedGroups(
  session: Session,
  type: SeedGroupSceneKind = 'scene',
): SceneSeedGroupInfo[] {
  const byId = new Map<
    string,
    { order: number; seed?: number; scenes: SeedGroupScene[]; firstIndex: number }
  >();
  (session.getScenes(type) as SeedGroupScene[]).forEach((scene, firstIndex) => {
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
  scene: SeedGroupScene,
): SceneSeedGroupInfo | undefined {
  const meta = readSceneSeedGroup(scene);
  if (!meta) return undefined;
  return listSceneSeedGroups(session, scene.type).find((group) => group.id === meta.id);
}

/** 같은 종류의 씬 2개 이상을 새 그룹으로 — 종류가 섞이면 만들지 않는다(undefined). */
export function createSceneSeedGroup(
  session: Session,
  scenes: SeedGroupScene[],
): SceneSeedGroupInfo | undefined {
  const unique = Array.from(new Set(scenes));
  if (unique.length < 2) return undefined;
  const kind = sceneKindOf(unique);
  if (!kind) return undefined;
  const groups = listSceneSeedGroups(session, kind);
  const order =
    groups.reduce((max, group) => Math.max(max, group.order), -1) + 1;
  const id = uuidv4();
  for (const scene of unique) {
    scene.meta.set(SCENE_SEED_GROUP_META_KEY, { version: 1, id, order });
  }
  return getSceneSeedGroupInfo(session, unique[0]);
}

/**
 * 기존 그룹에 합류 — 그룹은 씬과 같은 종류(탭)에서만 찾는다. 다른 종류의 그룹 id·종류가 섞인 씬 목록은 거부(false)
 * — 일반↔변형 혼합 그룹을 만들지 않는다(2026-11-03, 이름표가 탭별이라 섞이면 표시·해석이 어긋난다).
 */
export function assignScenesToSeedGroup(
  session: Session,
  scenes: SeedGroupScene[],
  groupId: string,
): boolean {
  const kind = sceneKindOf(Array.from(new Set(scenes)));
  if (!kind) return false;
  const target = listSceneSeedGroups(session, kind).find(
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

export function removeScenesFromSeedGroups(scenes: SeedGroupScene[]): number {
  let changed = 0;
  for (const scene of new Set(scenes)) {
    if (scene.meta.delete(SCENE_SEED_GROUP_META_KEY)) changed++;
  }
  return changed;
}

export function dissolveSceneSeedGroup(
  session: Session,
  groupId: string,
  type: SeedGroupSceneKind = 'scene',
): number {
  const target = listSceneSeedGroups(session, type).find(
    (group) => group.id === groupId,
  );
  return target ? removeScenesFromSeedGroups(target.scenes) : 0;
}

export function setSceneSeedGroupSeed(
  session: Session,
  groupId: string,
  seed: number | undefined,
  type: SeedGroupSceneKind = 'scene',
): boolean {
  if (seed !== undefined && !validSeed(seed)) return false;
  const target = listSceneSeedGroups(session, type).find(
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

/**
 * 생성 시드 우선순위(2026-09-26 사용자 결정): 씬 전용 시드 → 씬 그룹 시드 → 프롬프트(사전세팅) 시드 → 랜덤(undefined).
 * 각 단계는 유효한 정수(0~2^32-1)일 때만 채택하고 아니면 다음 단계로 넘어간다.
 */
export function resolveSceneSeed(
  scene: Scene,
  commonSeed?: number | null,
): number | undefined {
  if (validSeed(scene.sceneSeed)) return scene.sceneSeed;
  const groupSeed = readSceneSeedGroup(scene)?.seed;
  if (groupSeed !== undefined) return groupSeed;
  return validSeed(commonSeed) ? commonSeed : undefined;
}

/**
 * 변형 씬(I2I·인페인트·미러) 생성 시드 우선순위(2026-11-03 사용자 결정, 이슈 #9 — SPEC §11):
 * 변형 씬 시드(씬 프리셋 `seed` 편집 칸) → 변형 씬 시드 그룹 시드 → 메인 사전 세팅 프롬프트 시드 → 랜덤(undefined).
 * 각 단계는 유효한 정수(0~2^32-1)일 때만 채택. 그룹 시드는 저장된 변형 씬(`type === 'inpaint'`)에서만 읽는다 —
 * 이미지 변형 메뉴(OneTimeFlows)가 넘기는 이미지생성 씬의 그룹·씬 전용 시드는 옮기지 않는다(시드 비복사 계약).
 * 적용 지점은 `createSDI2IHandler`(SDWorkFlow.ts) 한 곳.
 */
export function resolveVariantSceneSeed(
  scene: { type?: string } | undefined,
  preset: { seed?: unknown } | undefined,
  mainSeed?: unknown,
): number | undefined {
  if (validSeed(preset?.seed)) return preset!.seed as number;
  if (scene?.type === 'inpaint') {
    const groupSeed = readSceneSeedGroup(scene as InpaintScene)?.seed;
    if (groupSeed !== undefined) return groupSeed;
  }
  return validSeed(mainSeed) ? mainSeed : undefined;
}

/**
 * 시드 입력 칸의 안내(비었을 때 placeholder) — 일반 씬 「씬 전용 시드」(SceneEditor)와 변형 편집 칸 「시드」 줄 공용(2026-11-03 통일).
 * 두 칸 모두 비우면 「그룹 시드 → 사전 세팅 시드 → 랜덤」으로 같은 대상을 가리키므로 문구도 하나만 둔다.
 */
export const SEED_INPUT_TEXT = {
  placeholder: '비우면 그룹 시드 → 사전 세팅 시드 → 랜덤',
} as const;
