// 모바일 씬 편집 창 집중 모드(SPEC §6-5)의 「편집 포커스」 판정(2026-10-02 B1 분리).
//
// 집중 모드가 켜지면 머리 줄([data-scene-editor-head] = 씬 이름·해상도·삭제)을 [씬 이름 … 완료] 표시로
// 바꾼다. 머리 줄 안의 씬 이름 input 에 포커스를 줬을 때도 집중 모드가 켜지면, 키보드가 올라오는 순간
// 그 input 자체가 사라져 이름을 고칠 수 없었다. 그래서 머리 줄 안의 입력은 편집 포커스로 치지 않는다.

/** 모바일 씬 편집 창 한 줄 머리의 표식 속성 */
export const SCENE_EDITOR_HEAD_ATTR = 'data-scene-editor-head';

const EDITABLE_SELECTOR =
  'textarea,input:not([type=checkbox]):not([type=range]),[contenteditable="true"]';

/** 집중 모드를 켜는 편집 요소인가: 편집 가능한 요소이면서 머리 줄 밖에 있을 것 */
export const isSceneEditorFocusTarget = (el: Element | null): boolean => {
  if (!el || typeof el.matches !== 'function') return false;
  if (!el.matches(EDITABLE_SELECTOR)) return false;
  return !el.closest(`[${SCENE_EDITOR_HEAD_ATTR}]`);
};
