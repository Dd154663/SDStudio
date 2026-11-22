// UI 정돈 시범(2026-11-19 — 사용자 고른 시안: ① 문법 설명 패널 ② 체크 줄 ③ 묶음·선택 칸·순서 목록 ④ 움직임).
// 문법 설명 데이터(묶음·줄·PC/모바일 차이·「.6」 설명 없음)와 위치 계산, 패널 열고 닫기(버튼·바깥·닫기 관문),
// 체크 줄(글자를 눌러도 토글·id 유지·비활성), 커스텀·레이아웃 탭 묶음 구성, 퀵 메뉴 순서 목록 버튼 이름·동작,
// 선택 칸 클래스, 움직임 CSS(움직임 줄이기에서 끔)·연결 소스 검사.
import React, { act, useState } from 'react';
import { createRoot, Root } from 'react-dom/client';
import * as fs from 'fs';
import * as path from 'path';

let mockMobile = false;
// 닫기 관문(BackStackService) — 올라온 겹을 기록해 Esc·뒤로 가기를 흉내 낸다.
const backLayers: { close: () => void; removed: boolean }[] = [];
jest.mock('../BackStackService', () => ({
  backStackService: {
    push: (close: () => void) => {
      const entry = { close, removed: false };
      backLayers.push(entry);
      return { remove: () => (entry.removed = true) };
    },
  },
}));
const mockAppState: Record<string, any> = { uiCompanionSlots: {}, pushDialog: jest.fn(), pushMessage: jest.fn() };
jest.mock('..', () => ({
  get isMobile() {
    return mockMobile;
  },
  backend: { getConfig: jest.fn(async () => ({})), setConfig: jest.fn(async () => {}) },
}));
jest.mock('../AppService', () => ({ appState: mockAppState }));
jest.mock('../undoService', () => ({ undoService: {}, UNDO_TEXT: {} }));
jest.mock('../../componenets/CompanionDnd', () => ({ applyCompanionSlots: jest.fn() }));
jest.mock('../../componenets/ToolbarLayoutEditor', () => () => null);

import {
  placeAnchoredPanel,
  PROMPT_SYNTAX_HELP_TEXT,
  promptSyntaxHelpGroups,
} from '../promptSyntaxHelp';
import { PromptSyntaxHelpButton } from '../../componenets/PromptSyntaxHelp';
import { SettingCheckRow } from '../../componenets/SettingControls';
import PersonalTab from '../../componenets/ConfigPersonalTab';
import LayoutTab from '../../componenets/ConfigLayoutTab';
import { DEFAULT_QUICK_MENU, expandQuickMenu, globalActionMeta } from '../globalActions';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const COMP = path.resolve(__dirname, '../../componenets');
const read = (f: string) => fs.readFileSync(path.join(COMP, f), 'utf8').replace(/\r\n/g, '\n');

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  mockMobile = false;
  backLayers.length = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const render = (el: React.ReactElement) => act(async () => root.render(el));

describe('① 문법 설명 데이터', () => {
  test('묶음 넷(세기·넣기·적어 두기·입력 보조)과 줄 수 3·3·2·2(PC 는 Ctrl+3 주석 줄·돋보기 찾기 줄로 4)', () => {
    for (const mobile of [false, true]) {
      const groups = promptSyntaxHelpGroups(mobile);
      expect(groups.map((g) => g.title)).toEqual(['세기', '넣기', '적어 두기', '입력 보조']);
      expect(groups.map((g) => g.rows.length)).toEqual([3, 3, 2, mobile ? 2 : 4]);
    }
  });
  test('PC 입력 보조 끝줄 = Ctrl 3 주석 켜기/끄기(2026-11-22)', () => {
    const row = promptSyntaxHelpGroups(false)[3].rows[2];
    expect(row.id).toBe('comment-keys');
    expect(row.example).toEqual({ kind: 'keys', keys: ['Ctrl', '3'] });
    expect(row.desc).toBe('주석 켜기/끄기. 고른 글자, 없으면 커서가 있는 구획');
  });
  test('예시 칩은 편집 칸과 같은 문법 클래스', () => {
    const rows = promptSyntaxHelpGroups(false).flatMap((g) => g.rows);
    const ex = (id: string) => rows.find((r) => r.id === id)!.example as any;
    expect(ex('emphasis').parts[0]).toEqual({ text: '{blue hair}', cls: 'syntax-weight-emphasis syntax-strong' });
    expect(ex('deemphasis').parts[0].cls).toBe('syntax-weight-deemphasis syntax-weak');
    expect(ex('explicit-weight').parts[0]).toEqual({ text: '1.5::smile::', cls: 'syntax-weight-emphasis' });
    expect(ex('piece').parts[0]).toEqual({ text: '<옷.교복>', cls: 'syntax-wildcard' });
    expect(ex('comment').parts[0]).toEqual({ text: '##나중에 수정##', cls: 'syntax-comment' });
    expect(ex('newline')).toEqual({ kind: 'label', text: '줄바꿈' });
  });
  test('PC 는 Ctrl ↑ ↓ 키 줄, 모바일은 그 자리에 키보드 칩 줄', () => {
    const pcLast = promptSyntaxHelpGroups(false)[3].rows[1];
    expect(pcLast.example).toEqual({ kind: 'keys', keys: ['Ctrl', '↑', '↓'] });
    expect(pcLast.desc).toBe('커서가 있는 구획의 세기를 0.05 씩');
    const mLast = promptSyntaxHelpGroups(true)[3].rows[1];
    expect(mLast.id).toBe('mobile-chips');
    expect(mLast.desc).toBe('키보드 위 칩으로 세기 조절, # 칩으로 주석 감싸기와 풀기');
    expect(JSON.stringify(promptSyntaxHelpGroups(true))).not.toContain('Ctrl');
  });
  test('「.6 처럼 0 생략」 설명은 넣지 않는다(PC·모바일)', () => {
    for (const mobile of [false, true]) {
      const text = JSON.stringify(promptSyntaxHelpGroups(mobile));
      expect(text).not.toMatch(/\.6|0 생략/);
    }
  });
});

describe('① 패널 위치', () => {
  const vp = { width: 1000, height: 800 };
  test('아래가 넉넉하면 버튼 아래 왼쪽 맞춤', () => {
    expect(placeAnchoredPanel({ left: 100, top: 100, bottom: 120 }, { width: 430, height: 300 }, vp)).toEqual({
      left: 100,
      top: 126,
      maxHeight: 800 - 8 - 126,
    });
  });
  test('아래가 모자라고 위가 더 넓으면 버튼 위로, 오른쪽이 넘치면 왼쪽으로 당긴다', () => {
    const p = placeAnchoredPanel({ left: 900, top: 600, bottom: 620 }, { width: 430, height: 300 }, vp);
    expect(p.left).toBe(1000 - 8 - 430);
    expect(p.top).toBe(600 - 6 - 300);
    expect(p.top + 300).toBeLessThanOrEqual(600);
  });
  test('양쪽 다 모자라면 넓은 쪽에 붙이고 maxHeight 로 줄인다(패널 안 스크롤)', () => {
    const p = placeAnchoredPanel({ left: 10, top: 300, bottom: 320 }, { width: 430, height: 900 }, { width: 360, height: 640 });
    expect(p.left).toBe(8);
    expect(p.top).toBe(326);
    expect(p.maxHeight).toBe(640 - 8 - 326);
  });
});

describe('① 패널 열고 닫기', () => {
  const button = () => container.querySelector<HTMLButtonElement>(`button[aria-label="${PROMPT_SYNTAX_HELP_TEXT.buttonLabel}"]`)!;
  const panel = () => document.body.querySelector<HTMLElement>('[data-prompt-syntax-panel]');
  const press = (el: EventTarget) =>
    act(async () => {
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

  test('누르면 열리고 다시 누르면 닫힌다 — aria-expanded·aria-controls·닫기 관문 한 겹', async () => {
    await render(<PromptSyntaxHelpButton mobile={false} />);
    expect(button().getAttribute('aria-expanded')).toBe('false');
    expect(panel()).toBeNull();
    await act(async () => button().click());
    expect(button().getAttribute('aria-expanded')).toBe('true');
    const p = panel()!;
    expect(p.getAttribute('role')).toBe('dialog');
    expect(button().getAttribute('aria-controls')).toBe(p.id);
    expect(p.textContent).toContain('프롬프트 문법');
    // 묶음 표식은 2026-11-20 그룹 1-b 공용 패널(HelpPanel)에서 data-syntax-group → data-help-group
    expect(p.querySelectorAll('[data-help-group]')).toHaveLength(4);
    // Ctrl ↑ ↓ + Ctrl 3(2026-11-22 주석 줄)
    expect(p.querySelectorAll('kbd')).toHaveLength(5);
    expect(p.className).toContain('ui-pop-in');
    expect(backLayers).toHaveLength(1);
    await act(async () => button().click());
    expect(panel()).toBeNull();
    expect(button().getAttribute('aria-expanded')).toBe('false');
    expect(backLayers[0].removed).toBe(true);
  });

  test('바깥을 누르면 닫히고, 패널 안을 누르면 그대로', async () => {
    await render(<PromptSyntaxHelpButton mobile={false} />);
    await act(async () => button().click());
    await press(panel()!.querySelector('h3')!);
    expect(panel()).not.toBeNull();
    await press(document.body);
    expect(panel()).toBeNull();
  });

  test('Esc·뒤로 가기(닫기 관문의 맨 위 겹)로 닫힌다', async () => {
    await render(<PromptSyntaxHelpButton mobile={false} />);
    await act(async () => button().click());
    await act(async () => backLayers[backLayers.length - 1].close());
    expect(panel()).toBeNull();
    expect(backLayers[backLayers.length - 1].removed).toBe(true);
  });

  test('모바일은 키 표시 대신 키보드 칩 줄', async () => {
    await render(<PromptSyntaxHelpButton mobile />);
    await act(async () => button().click());
    expect(panel()!.querySelectorAll('kbd')).toHaveLength(0);
    expect(panel()!.textContent).toContain('# 칩으로 주석 감싸기와 풀기');
  });
});

describe('② 체크 줄', () => {
  const Harness = ({ disabled }: { disabled?: boolean }) => {
    const [on, setOn] = useState(false);
    return (
      <SettingCheckRow
        id="cfgTestRow"
        checked={on}
        onChange={setOn}
        disabled={disabled}
        label="시험 항목"
        description="설명 글"
      />
    );
  };
  test('<label> 이 체크 상자·제목·설명을 감싸고, 제목·설명 글자를 눌러도 토글 — id·type 유지', async () => {
    await render(<Harness />);
    const cb = container.querySelector<HTMLInputElement>('#cfgTestRow')!;
    expect(cb.type).toBe('checkbox');
    expect(cb.className).toContain('setting-check');
    const row = cb.closest('label')!;
    expect(row.className).toContain('setting-check-row');
    expect(row.textContent).toContain('시험 항목');
    expect(row.textContent).toContain('설명 글');
    const title = Array.from(row.querySelectorAll('span')).find((s) => s.textContent === '시험 항목')!;
    await act(async () => title.click());
    expect(cb.checked).toBe(true);
    const desc = Array.from(row.querySelectorAll('span')).find((s) => s.textContent === '설명 글')!;
    await act(async () => desc.click());
    expect(cb.checked).toBe(false);
  });
  test('비활성이면 줄을 눌러도 바뀌지 않는다', async () => {
    await render(<Harness disabled />);
    const cb = container.querySelector<HTMLInputElement>('#cfgTestRow')!;
    const row = cb.closest('label')!;
    expect(row.hasAttribute('data-disabled')).toBe(true);
    await act(async () => row.click());
    expect(cb.checked).toBe(false);
  });
});

const groupsOf = () =>
  Array.from(container.querySelectorAll<HTMLElement>('[data-setting-group]')).map((g) => ({
    title: g.getAttribute('data-setting-group'),
    ids: Array.from(g.querySelectorAll('input[type="checkbox"], select')).map((i) => i.id),
  }));

describe('③ 커스텀 탭 묶음', () => {
  const noop = () => {};
  const props = {
    classicSceneCard: false, setClassicSceneCard: noop,
    fullWordAc: false, setFullWordAc: noop,
    legacyProjectMode: false, setLegacyProjectMode: noop,
    legacySceneEditor: false, setLegacySceneEditor: noop,
    legacyWorkflowMode: false, setLegacyWorkflowMode: noop,
    sceneToolbarLegacyText: false, setSceneToolbarLegacyText: noop,
    uiFont: 'system', setUiFont: noop,
    uiClassicFinish: false, setUiClassicFinish: noop,
    uiPillButtons: false, setUiPillButtons: noop,
    allowDuplicateProjectOpen: false, setAllowDuplicateProjectOpen: noop,
    promptWeightSpacingFix: true, setPromptWeightSpacingFix: noop,
  };
  test('화면 모양 / 입력 동작 / 예전 방식 / 여러 창 — 항목 id 그대로, 탭 뿌리의 직계 자식(2단 흐름 단위)', async () => {
    await render(<PersonalTab {...props} />);
    expect(groupsOf()).toEqual([
      { title: '화면 모양', ids: ['cfgClassicScene', 'cfgClassicFinish', 'cfgPillButtons'] },
      { title: '입력 동작', ids: ['cfgFullWordAc', 'cfgWeightSpacingFix'] },
      { title: '예전 방식', ids: ['cfgLegacyProject', 'cfgLegacyScene', 'cfgLegacyWorkflow', 'cfgSceneToolbarText'] },
      { title: '여러 창', ids: ['cfgAllowDupOpen'] },
    ]);
    const rootEl = container.firstElementChild!;
    expect(Array.from(rootEl.children).every((c) => c.hasAttribute('data-setting-group'))).toBe(true);
    // 글꼴 고르기는 화면 모양 상자 안
    expect(container.querySelector('[data-setting-group="화면 모양"]')!.textContent).toContain('글꼴');
    // 모든 체크 상자가 체크 줄 모양
    container.querySelectorAll('input[type="checkbox"]').forEach((i) => {
      expect(i.className).toContain('setting-check');
      expect(i.closest('label')?.className).toContain('setting-check-row');
    });
  });
  test('클래식 마감이면 알약형 버튼 줄은 켜짐 표시 + 비활성 + 덧붙임 문구', async () => {
    await render(<PersonalTab {...props} uiClassicFinish />);
    const pill = container.querySelector<HTMLInputElement>('#cfgPillButtons')!;
    expect(pill.checked).toBe(true);
    expect(pill.disabled).toBe(true);
    expect(pill.closest('label')!.textContent).toContain('클래식 마감에서는 항상 알약형');
  });
});

describe('③ 레이아웃 탭 묶음·선택 칸·순서 목록', () => {
  const noop = () => {};
  const baseProps = (over: Record<string, any> = {}) => ({
    uiLayoutTemplate: 'classic', setUiLayoutTemplate: noop,
    uiMobileV2Parts: {}, setUiMobileV2Parts: noop, setModernExitReset: noop,
    uiPresetIconRow: false, setUiPresetIconRow: noop,
    uiToolbarButtonNames: true, setUiToolbarButtonNames: noop,
    uiZoomPercent: 100, setUiZoomPercent: noop,
    uiToolbar: {}, setUiToolbar: noop,
    quickMenu: undefined, setQuickMenu: noop,
    quickMenuButton: false, setQuickMenuButton: noop,
    uiFloatViewMode: 'cover', setUiFloatViewMode: noop,
    mobileMode: false, onClose: async () => true,
    ...over,
  });
  test('PC: 화면 배치 / 패널과 창 / PC 화면과 툴바 / 퀵 메뉴 구성', async () => {
    await render(<LayoutTab {...baseProps()} />);
    expect(groupsOf()).toEqual([
      { title: '화면 배치', ids: [] },
      { title: '패널과 창', ids: ['cfgPresetIconRow'] },
      { title: 'PC 화면과 툴바', ids: ['cfgUiZoom', 'cfgClassicToolbar', 'cfgToolbarButtonNames', 'cfgShortcutHelpOnStartup'] },
      { title: '퀵 메뉴 구성', ids: ['cfgQuickMenuButton'] },
    ]);
    // 묶음 상자 안에서는 퀵 메뉴 자체 제목을 다시 그리지 않는다
    const qm = container.querySelector('[data-setting-group="퀵 메뉴 구성"]')!;
    expect(qm.textContent!.match(/퀵 메뉴 구성/g)).toHaveLength(1);
    expect(container.querySelector('#cfgUiZoom')!.className).toContain('app-select');
  });
  test('모바일: 화면 배치 / 패널과 창 / 동반 버튼 — 위치 선택 칸도 app-select', async () => {
    mockMobile = true;
    await render(<LayoutTab {...baseProps({ mobileMode: true })} />);
    expect(groupsOf().map((g) => g.title)).toEqual(['화면 배치', '패널과 창', '동반 버튼']);
    const selects = container.querySelectorAll<HTMLSelectElement>('[data-setting-group="동반 버튼"] select');
    expect(selects.length).toBeGreaterThan(0);
    selects.forEach((s) => {
      expect(s.className).toContain('app-select');
      expect(s.getAttribute('aria-label')).toMatch(/ 위치$/);
    });
  });
  test('모바일 V2 적용 범위 체크도 체크 줄(id cfgV2Part-* 유지)', async () => {
    mockMobile = true;
    await render(<LayoutTab {...baseProps({ mobileMode: true, uiLayoutTemplate: 'mobile-v2' })} />);
    const parts = container.querySelectorAll<HTMLInputElement>('[data-cfg-v2-parts] input[type="checkbox"]');
    expect(parts.length).toBeGreaterThan(0);
    parts.forEach((p) => {
      expect(p.id).toMatch(/^cfgV2Part-/);
      expect(p.closest('label')!.className).toContain('setting-check-row');
    });
  });
  test('순서 목록: 위로·아래로·제거 아이콘 버튼(글자 ▲▼✕ 없음), 누르면 종전대로 순서·제거', async () => {
    const setQuickMenu = jest.fn();
    await render(<LayoutTab {...baseProps({ setQuickMenu })} />);
    const list = container.querySelector<HTMLElement>('[data-quick-menu-list]')!;
    expect(list.textContent).not.toMatch(/[▲▼✕]/);
    const up = list.querySelectorAll<HTMLButtonElement>('button[aria-label="위로"]');
    const down = list.querySelectorAll<HTMLButtonElement>('button[aria-label="아래로"]');
    const remove = list.querySelectorAll<HTMLButtonElement>('button[aria-label="제거"]');
    expect(up.length).toBeGreaterThan(1);
    expect(down.length).toBe(up.length);
    expect(remove.length).toBe(up.length);
    [...up, ...down, ...remove].forEach((b) => {
      expect(b.className).toContain('setting-icon-btn');
      expect(b.className).toContain('ui-press');
      expect(b.querySelector('svg')).not.toBeNull();
    });
    expect(remove[0].className).toContain('setting-icon-btn-danger');
    const visible = expandQuickMenu(DEFAULT_QUICK_MENU).filter((id) => !id.startsWith('!') && globalActionMeta(id));
    await act(async () => down[0].click());
    const moved = setQuickMenu.mock.calls[0][0] as string[];
    expect(moved.filter((id) => !id.startsWith('!')).slice(0, 2)).toEqual([visible[1], visible[0]]);
    await act(async () => remove[0].click());
    const removed = setQuickMenu.mock.calls[1][0] as string[];
    expect(removed).not.toContain(visible[0]);
  });
});

describe('④ 움직임·연결(소스 검사)', () => {
  const css = read('App.css');
  test('열림 페이드·누름·체크 전환은 0.15초 이내, 움직임 줄이기 블록에서 모두 끈다', () => {
    expect(css).toMatch(/\.ui-pop-in \{\s*animation: ui-pop-in 130ms/);
    expect(css).toMatch(/@keyframes ui-pop-in \{\s*from \{\s*opacity: 0;\s*transform: translateY\(-4px\);/);
    expect(css).toMatch(/\.ui-press:active:not\(:disabled\) \{\s*transform: scale\(0\.94\);/);
    const block = css.slice(css.indexOf('@keyframes ui-pop-in'));
    const reduced = block.slice(block.indexOf('@media (prefers-reduced-motion: reduce)'));
    for (const sel of ['.ui-pop-in', '.ui-press', '.setting-check-row', '.setting-check::after']) {
      expect(reduced).toContain(sel);
    }
    // 시범 범위 밖 공용 버튼 클래스에는 누름을 넣지 않았다
    expect(css).not.toMatch(/\.round-button:active[^{]*\{[^}]*scale/);
  });
  test('서랍 우클릭 목록이 열림 움직임을 쓰고, 문법 패널이 상위 프롬프트에 연결됐다', () => {
    expect(read('ContextMenuList.tsx')).toContain('className="ui-pop-in fixed');
    const editor = read('PreSetEdtior.tsx');
    expect(editor).not.toMatch(/const PROMPT_SYNTAX_HELP\b/);
    expect(editor).toContain("help={input.field === 'frontPrompt' ? <PromptSyntaxHelpButton mobile={isMobile} /> : undefined}");
  });
});
