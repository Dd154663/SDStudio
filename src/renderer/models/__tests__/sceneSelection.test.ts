import {
  EMPTY_SCENE_SELECTION,
  addScenesToSelectionState,
  isSceneSelected,
  removeScenesFromSelectionState,
  selectedCountForType,
  selectedScenesOfType,
  toggleSceneInSelection,
} from '../sceneSelection';

// 일괄 미러 복제는 변형 씬을 원본 씬과 같은 이름으로 만든다.
const normal = ['a', 'b', 'c'].map((name) => ({ name, type: 'scene' }));
const inpaint = ['a', 'b', 'c'].map((name) => ({ name, type: 'inpaint' }));

test('변형 탭에서 선택한 이름은 같은 이름의 일반 씬으로 해석되지 않는다', () => {
  const state = addScenesToSelectionState(EMPTY_SCENE_SELECTION, ['a', 'b'], 'inpaint');
  expect(selectedScenesOfType(state, 'inpaint', inpaint).map((s) => s.name)).toEqual(['a', 'b']);
  expect(selectedScenesOfType(state, 'scene', normal)).toEqual([]);
  expect(isSceneSelected(state, normal[0])).toBe(false);
  expect(isSceneSelected(state, inpaint[0])).toBe(true);
  expect(selectedCountForType(state, 'scene')).toBe(0);
  expect(selectedCountForType(state, 'inpaint')).toBe(2);
});

test('다른 종류의 탭에서 선택을 시작하면 이전 선택을 버린다', () => {
  let state = toggleSceneInSelection(EMPTY_SCENE_SELECTION, 'a', 'scene');
  state = toggleSceneInSelection(state, 'b', 'inpaint');
  expect(state).toEqual({ names: new Set(['b']), type: 'inpaint' });
  state = addScenesToSelectionState(state, ['c'], 'scene');
  expect(state).toEqual({ names: new Set(['c']), type: 'scene' });
});

test('토글·제거로 비면 종류도 초기화된다', () => {
  let state = toggleSceneInSelection(EMPTY_SCENE_SELECTION, 'a', 'scene');
  state = toggleSceneInSelection(state, 'a', 'scene');
  expect(state).toEqual({ names: new Set(), type: null });
  state = addScenesToSelectionState(state, ['a', 'b'], 'inpaint');
  expect(removeScenesFromSelectionState(state, ['a', 'b'], 'scene')).toBe(state);
  expect(removeScenesFromSelectionState(state, ['a', 'b'], 'inpaint')).toEqual({ names: new Set(), type: null });
});

test('선택 씬 목록은 표시 순서를 따르고 종류가 다른 씬은 제외한다', () => {
  const state = addScenesToSelectionState(EMPTY_SCENE_SELECTION, ['c', 'a'], 'scene');
  const mixed = [inpaint[0], normal[2], normal[0], normal[1]];
  expect(selectedScenesOfType(state, 'scene', mixed)).toEqual([normal[2], normal[0]]);
});
