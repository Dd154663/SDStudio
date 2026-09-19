// 씬 다중 선택 상태의 단일 출처 규칙 (SPEC_GUIDE 드래그 다중 선택 절).
//
// 선택은 (종류, 이름) 쌍이다. 일반 씬(scene)과 변형 씬(inpaint)은 서로 다른 Map에
// 살고 이름이 겹칠 수 있으므로(일괄 미러 복제는 원본 이름을 그대로 쓴다), 이름만으로
// scenes→inpaints 순으로 찾으면 다른 탭의 씬을 삭제·이동·예약하게 된다.
// 소비자는 반드시 이 모듈의 판정을 거치고 `session.getScene(type, name)`으로 조회한다.

export type SceneKind = 'scene' | 'inpaint';

export interface SceneSelectionState {
  names: Set<string>;
  type: SceneKind | null;
}

export const EMPTY_SCENE_SELECTION: SceneSelectionState = {
  names: new Set(),
  type: null,
};

function baseFor(state: SceneSelectionState, type: SceneKind): Set<string> {
  // 다른 종류의 탭에서 선택을 시작하면 이전 탭의 선택은 버린다.
  return state.type === type ? new Set(state.names) : new Set();
}

function finish(names: Set<string>, type: SceneKind): SceneSelectionState {
  return { names, type: names.size > 0 ? type : null };
}

export function toggleSceneInSelection(
  state: SceneSelectionState,
  name: string,
  type: SceneKind,
): SceneSelectionState {
  const next = baseFor(state, type);
  if (next.has(name)) next.delete(name);
  else next.add(name);
  return finish(next, type);
}

export function addScenesToSelectionState(
  state: SceneSelectionState,
  names: readonly string[],
  type: SceneKind,
): SceneSelectionState {
  const next = baseFor(state, type);
  for (const name of names) next.add(name);
  return finish(next, type);
}

export function removeScenesFromSelectionState(
  state: SceneSelectionState,
  names: readonly string[],
  type: SceneKind,
): SceneSelectionState {
  if (state.type !== type) return state;
  const next = new Set(state.names);
  for (const name of names) next.delete(name);
  return finish(next, type);
}

export function isSceneSelected(
  state: { names: Set<string>; type: SceneKind | null | undefined },
  scene: { name: string; type: string },
): boolean {
  return state.type === scene.type && state.names.has(scene.name);
}

// 선택 수를 표시할 때는 현재 탭(종류)과 일치하는 경우만 센다.
export function selectedCountForType(
  state: { names: Set<string>; type: SceneKind | null | undefined },
  type: SceneKind,
): number {
  return state.type === type ? state.names.size : 0;
}

// 목록 순서를 유지한 채 선택된 씬만 돌려준다. 종류가 다르면 항상 빈 배열.
export function selectedScenesOfType<T extends { name: string; type: string }>(
  state: { names: Set<string>; type: SceneKind | null | undefined },
  type: SceneKind,
  scenes: readonly T[],
): T[] {
  if (state.type !== type) return [];
  return scenes.filter((scene) => scene.type === type && state.names.has(scene.name));
}
