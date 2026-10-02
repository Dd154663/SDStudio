import { isSceneEditorFocusTarget, SCENE_EDITOR_HEAD_ATTR } from '../sceneEditorFocus';

// 모바일 씬 편집 창 집중 모드 판정(2026-10-02 B1): 머리 줄의 씬 이름 칸은 집중 모드를 켜지 않는다.
describe('씬 편집 창 집중 모드 편집 포커스 판정', () => {
  const build = () => {
    document.body.innerHTML = `
      <div id="root">
        <div ${SCENE_EDITOR_HEAD_ATTR}="">
          <input id="name" type="text" />
          <div><input id="dummy" readonly /></div>
        </div>
        <div id="body">
          <textarea id="prompt"></textarea>
          <input id="seed" type="text" inputmode="numeric" />
          <input id="check" type="checkbox" />
          <input id="range" type="range" />
          <div id="ce" contenteditable="true"></div>
          <button id="btn">완료</button>
        </div>
      </div>`;
    return (id: string) => document.getElementById(id);
  };

  it('머리 줄 안의 씬 이름·해상도 입력은 편집 포커스가 아니다', () => {
    const $ = build();
    expect(isSceneEditorFocusTarget($('name'))).toBe(false);
    expect(isSceneEditorFocusTarget($('dummy'))).toBe(false);
  });

  it('본문의 프롬프트 칸·시드 입력·contenteditable 은 그대로 편집 포커스다', () => {
    const $ = build();
    expect(isSceneEditorFocusTarget($('prompt'))).toBe(true);
    expect(isSceneEditorFocusTarget($('seed'))).toBe(true);
    expect(isSceneEditorFocusTarget($('ce'))).toBe(true);
  });

  it('체크박스·범위·버튼·null 은 편집 포커스가 아니다', () => {
    const $ = build();
    expect(isSceneEditorFocusTarget($('check'))).toBe(false);
    expect(isSceneEditorFocusTarget($('range'))).toBe(false);
    expect(isSceneEditorFocusTarget($('btn'))).toBe(false);
    expect(isSceneEditorFocusTarget(null)).toBe(false);
  });
});
