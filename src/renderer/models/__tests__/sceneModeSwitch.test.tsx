/**
 * 씬 화면 모드 전환 [이미지 | 편집](2026-11-25 사용자 스케치) 회귀 검사.
 * - 렌더: 공용 머리 SceneModeHeader(칸 표시·aria-pressed·콜백, 그리드 모드에서만 이전/다음 씬)
 * - 순수: 전환 판정(models/sceneModeSwitch), 그리드 단축키 끔 판정, 마스크 저장 기다림(models/inpaintMaskSave)
 * - 소스 계약: 세 FloatView 판(그리드·일반 씬 편집·변형 씬 편집)의 headerSlot·배선, 그리드 제목 줄·「씬 편집」 버튼 제거
 */
jest.mock('../../componenets/FloatView', () => ({ useFloatViewHeaderSlot: () => null }));

import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import * as fs from 'fs';
import * as path from 'path';
import { SceneModeHeader, SCENE_MODE_TEXT } from '../../componenets/SceneModeHeader';
import {
  EDITOR_CLOSE_CLOSES_GRID,
  imageGridShortcutsActive,
  planCloseEditor,
  planShowEdit,
  planShowImages,
} from '../sceneModeSwitch';
import {
  hasPendingMaskSave,
  trackPendingMaskSave,
  waitPendingMaskSave,
} from '../inpaintMaskSave';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const COMP = path.resolve(__dirname, '../../componenets');
const read = (f: string) => fs.readFileSync(path.join(COMP, f), 'utf8').replace(/\r\n/g, '\n');

describe('SceneModeHeader 렌더', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const render = (el: React.ReactElement) => act(() => root.render(el));
  const seg = (mode: string) =>
    host.querySelector(`[data-scene-mode-switch] [data-mode="${mode}"]`) as HTMLButtonElement;

  test('택일 묶음 = role group·aria-label, 칸 둘(이미지·편집), 지금 모드만 seg-on·aria-pressed', () => {
    render(<SceneModeHeader kindIcon="🖼️" name="default" mode="images" onMode={() => {}} />);
    const group = host.querySelector('[data-scene-mode-switch]')!;
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')).toBe(SCENE_MODE_TEXT.group);
    expect(group.className).toContain('seg-group');
    expect(group.querySelectorAll('.seg-item')).toHaveLength(2);
    expect(seg('images').className).toContain('seg-on');
    expect(seg('images').getAttribute('aria-pressed')).toBe('true');
    expect(seg('edit').className).not.toContain('seg-on');
    expect(seg('edit').getAttribute('aria-pressed')).toBe('false');
    // 좁은 폭은 아이콘만 — 글자는 md 이상에서만 보이고, 이름은 aria-label·title 로
    expect(seg('edit').getAttribute('aria-label')).toBe('편집');
    expect(seg('edit').getAttribute('title')).toBe('편집');
    expect(seg('edit').querySelector('span.hidden.md\\:inline')!.textContent).toBe('편집');
    expect(seg('images').querySelector('svg')).not.toBeNull();
  });

  test('다른 칸을 누르면 그 모드로 onMode, 지금 칸은 아무 일 없음', () => {
    const onMode = jest.fn();
    render(<SceneModeHeader kindIcon="🖼️" name="default" mode="images" onMode={onMode} />);
    act(() => seg('images').click());
    expect(onMode).not.toHaveBeenCalled();
    act(() => seg('edit').click());
    expect(onMode).toHaveBeenCalledWith('edit');
  });

  test('이름 = 아이콘 + 씬 이름만(「일반 씬」「의 생성된 이미지」 없음), 말줄임', () => {
    render(<SceneModeHeader kindIcon="🎨" name="긴 이름의 씬" mode="edit" onMode={() => {}} />);
    const title = host.querySelector('[data-scene-mode-title]')!;
    expect(title.textContent).toBe('🎨긴 이름의 씬');
    expect(title.className).toContain('min-w-0');
    expect(title.querySelector('.truncate')!.getAttribute('title')).toBe('긴 이름의 씬');
    expect(host.textContent).not.toContain('생성된 이미지');
    expect(host.textContent).not.toContain('일반 씬');
  });

  test('선택 모드면 이름 자리에 「이미지 선택 모드 ON」', () => {
    render(<SceneModeHeader kindIcon="🖼️" name="default" mode="images" selectMode onMode={() => {}} />);
    expect(host.querySelector('[data-scene-mode-title]')!.textContent).toBe('이미지 선택 모드 ON');
  });

  test('이전/다음 씬은 그리드 모드에서만 — 동작·비활성 그대로', () => {
    const go = jest.fn();
    const nav = { hasPrev: false, hasNext: true, go };
    render(<SceneModeHeader kindIcon="🖼️" name="a" mode="images" sceneNav={nav} onMode={() => {}} />);
    const prev = host.querySelector('[aria-label="이전 씬"]') as HTMLButtonElement;
    const next = host.querySelector('[aria-label="다음 씬"]') as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    expect(prev.className).toContain('opacity-40');
    act(() => next.click());
    expect(go).toHaveBeenCalledWith(1);

    render(<SceneModeHeader kindIcon="🖼️" name="a" mode="edit" sceneNav={nav} onMode={() => {}} />);
    expect(host.querySelector('[aria-label="이전 씬"]')).toBeNull();
    expect(host.querySelector('[aria-label="다음 씬"]')).toBeNull();
    // 자리(PC 가운데 정렬용)는 남는다
    expect(host.querySelector('[data-scene-mode-nav]')).not.toBeNull();
  });

  test('머리 내용은 창 끌기에 먹히지 않게 titlebar-no-drag', () => {
    render(<SceneModeHeader kindIcon="🖼️" name="a" mode="images" onMode={() => {}} />);
    expect(host.querySelector('[data-scene-mode-header]')!.className).toContain('titlebar-no-drag');
  });
});

describe('전환 판정(순수)', () => {
  const A = { n: 'A' };
  const B = { n: 'B' };

  test('그리드에서 [편집] = 그리드 위에 같은 씬 편집 창', () => {
    expect(planShowEdit({ gridScene: A, editScene: undefined })).toEqual({ gridScene: A, editScene: A });
  });

  test('편집 창 [이미지]: 아래 같은 씬 그리드가 있으면 편집 창만 닫음', () => {
    const r = planShowImages({ gridScene: A, editScene: A });
    expect(r.next).toEqual({ gridScene: A, editScene: undefined });
    expect(r.gridReplaced).toBe(false);
  });

  test('편집 창 [이미지]: 그리드가 없으면 그 씬의 그리드를 열고 편집 창을 닫음(쌓임 2단 이하)', () => {
    const r = planShowImages({ gridScene: undefined, editScene: A });
    expect(r.next).toEqual({ gridScene: A, editScene: undefined });
    expect(r.gridReplaced).toBe(true);
  });

  test('편집 창 [이미지]: 아래가 다른 씬 그리드면 그 씬 그리드로 바꿔 낌', () => {
    const r = planShowImages({ gridScene: B, editScene: A });
    expect(r.next).toEqual({ gridScene: A, editScene: undefined });
    expect(r.gridReplaced).toBe(true);
  });

  test('닫기(✕·Esc·뒤로) = 씬 화면 전체(편집 창 + 아래 같은 씬 그리드)', () => {
    expect(EDITOR_CLOSE_CLOSES_GRID).toBe(true);
    const r = planCloseEditor({ gridScene: A, editScene: A });
    expect(r.next).toEqual({ gridScene: undefined, editScene: undefined });
    expect(r.closesGrid).toBe(true);
  });

  test('닫기: 그리드가 없거나 다른 씬이면 편집 창만, 결정을 뒤집으면(거짓) 편집 창만', () => {
    expect(planCloseEditor({ gridScene: undefined, editScene: A })).toEqual({
      next: { gridScene: undefined, editScene: undefined },
      closesGrid: false,
    });
    expect(planCloseEditor({ gridScene: B, editScene: A }).next).toEqual({ gridScene: B, editScene: undefined });
    expect(planCloseEditor({ gridScene: A, editScene: A }, false)).toEqual({
      next: { gridScene: A, editScene: undefined },
      closesGrid: false,
    });
  });
});

describe('그리드 단축키 끔 판정', () => {
  const base = { isMobile: false, detailOpen: false, pickerOpen: false, coveredByEditor: false };
  test('그리드가 맨 위면 종전처럼 켬', () => {
    expect(imageGridShortcutsActive(base)).toBe(true);
  });
  test.each([
    ['위에 씬 편집 창', { coveredByEditor: true }],
    ['상세 보기', { detailOpen: true }],
    ['번호 고르기 창', { pickerOpen: true }],
    ['모바일', { isMobile: true }],
  ])('%s 이면 끔', (_n, patch) => {
    expect(imageGridShortcutsActive({ ...base, ...patch })).toBe(false);
  });
});

describe('변형 씬 마스크 저장 기다림', () => {
  test('진행 중인 저장이 끝난 뒤에야 기다림이 풀림, 끝나면 기록이 지워짐', async () => {
    const scene = {};
    let finish!: () => void;
    const task = new Promise<void>((r) => {
      finish = r;
    });
    trackPendingMaskSave(scene, task);
    expect(hasPendingMaskSave(scene)).toBe(true);
    let waited = false;
    const w = waitPendingMaskSave(scene).then(() => {
      waited = true;
    });
    await Promise.resolve();
    expect(waited).toBe(false);
    finish();
    await w;
    expect(waited).toBe(true);
    await Promise.resolve();
    expect(hasPendingMaskSave(scene)).toBe(false);
  });

  test('저장 실패도 기다림을 풀고, 저장이 없으면 곧바로', async () => {
    const scene = {};
    trackPendingMaskSave(scene, Promise.reject(new Error('x'))).catch(() => {});
    await expect(waitPendingMaskSave(scene)).resolves.toBeUndefined();
    await expect(waitPendingMaskSave({})).resolves.toBeUndefined();
  });

  test('InPaintEditor: 닫힐 때 저장을 적고, 마스크를 읽기 전에 기다림', () => {
    const src = read('InPaintEditor.tsx');
    expect(src.match(/trackPendingMaskSave\(\s*scene,/g)).toHaveLength(2);
    const load = src.slice(src.indexOf('async function loadMask()'), src.indexOf('const dispose = reaction('));
    expect(load.indexOf('await waitPendingMaskSave(editingScene);')).toBeLessThan(load.indexOf('fetchVibeImage'));
  });
});

describe('배선 소스 계약', () => {
  const sq = read('SceneQueueControl.tsx');
  const rv = read('ResultViewer.tsx');

  test('세 FloatView 판(그리드·일반 씬 편집·변형 씬 편집)이 headerSlot 을 켬', () => {
    expect(sq.match(/^\s*headerSlot$/gm)).toHaveLength(3);
    expect(sq).toContain('onEscape={() => closeGridOf(displayScene)}');
    expect(sq.match(/onEscape=\{closeSceneEditor\}/g)).toHaveLength(1);
    expect(sq).toMatch(/onEscape=\{\(\) => \{\s*closeSceneEditor\(\);\s*setAdding\(false\);/);
    expect(sq.match(/<EditorSceneModeHeader/g)).toHaveLength(2);
    expect(sq).toContain('coveredByEditor={!!editingScene}');
    expect(sq).toContain('}, [displayScene, displayFocus, getFilteredScenes, editingScene]);');
    // 판정은 ref 로 지금 값을 읽는다(panel useMemo 의 낡은 displayScene 방지)
    expect(sq).toContain('sceneScreenRef.current = { gridScene: displayScene, editScene: editingScene };');
  });

  test('닫기·전환 함수는 그것을 값으로 읽는 panel useMemo 보다 먼저 선언된다(선언 전 접근 오류 방지)', () => {
    // panel useMemo 는 렌더 중 바로 실행되며 onEscape={closeSceneEditor}·onImages={showSceneImages} 를 값으로 읽는다.
    // 선언이 뒤에 있으면 편집 창을 여는 순간 「Cannot access before initialization」 — 타입 검사·빌드는 잡지 못한다(2026-11-25 실기 발견).
    const panelAt = sq.indexOf('const panel = useMemo(');
    expect(panelAt).toBeGreaterThan(0);
    for (const name of ['closeGridOf', 'closeSceneEditor', 'showSceneImages']) {
      const at = sq.indexOf(`const ${name} = `);
      expect(at).toBeGreaterThan(0);
      expect(at).toBeLessThan(panelAt);
    }
  });

  test('그리드: 머리줄 포털로 씬 화면 머리, 종전 제목 줄·「씬 편집」 버튼 없음', () => {
    expect(rv).toContain('<SceneModeHeaderPortal');
    expect(rv).not.toContain('의 생성된 이미지');
    expect(rv).not.toContain('🖼️ 일반 씬');
    expect(rv).not.toContain("tierItem('edit'");
    expect(rv).not.toContain("{!isMobile ? '씬 편집' : <ActionIcon id=\"edit\" />}");
    expect(rv).toContain('if (m === \'edit\') onEdit(scene);');
    expect(rv).toMatch(/imageGridShortcutsActive\(\{[\s\S]*?coveredByEditor,\s*\}\)/);
  });
});
