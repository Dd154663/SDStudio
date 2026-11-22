/** @jest-environment jsdom */
// PC 사전세팅선택 행 개편(2026-11-22 사용자 결정): 라벨 제거·둥근 사각 드롭다운 칸·오른쪽 ▾,
// 프롬프트조각 기본 자리 = 이 행(동반 슬롯 'preset-select' 의 기본 배치, 저장된 배치 보존 규칙).
import React from 'react';
import { render, screen } from '@testing-library/react';
import * as fs from 'fs';
import * as path from 'path';
import {
  COMPANION_DEFAULT_PLACEMENTS,
  COMPANION_KEPT_IN_TOOLBAR_KEY,
  CompanionDefaultContext,
  assignCompanion,
  companionAssignedIds,
  removeCompanion,
  resolveCompanionButtons,
  withCompanionDefaults,
} from '../companionSlots';
import { TOOLBAR_VIEW_MAIN, resolveToolbarView } from '../uiLayout';
import {
  PRESET_SELECT_ARIA_LABEL,
  PRESET_SELECT_EXTRA_BUTTON_PX,
  PRESET_SELECT_PIECE_LABEL_MIN_ROW_PX,
  presetSelectAriaLabel,
  presetSelectPieceLabeled,
} from '../presetSelectRow';

jest.mock('../AppService', () => ({
  appState: {
    appliedCharacterPresetNames: [] as string[],
    openPieceEditor: jest.fn(),
    openCharacterPresets: jest.fn(),
    openProjectTrash: jest.fn(),
  },
}));
// CompanionDnd 는 react-dnd(ESM)를 끌어와 jest 가 읽지 못한다 — 감싸기 없이 그대로.
jest.mock('../../componenets/CompanionDnd', () => ({
  CompanionButtonSlot: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// eslint-disable-next-line import/first
import { renderCompanionButtons } from '../../componenets/PortableToolbarButtons';

const PC: CompanionDefaultContext = { isMobile: false, template: 'classic', toolbar: {} };
const SRC = fs.readFileSync(
  path.join(__dirname, '../../componenets/PreSetEdtior.tsx'),
  'utf8',
);
const presetSelectSrc = SRC.slice(
  SRC.indexOf('const PreSetSelect = observer('),
  SRC.indexOf('{bulkOpen && ('),
);

describe('프롬프트조각 기본 자리 = 사전세팅선택 행(가상 적용)', () => {
  test('기본 배치 표는 프롬프트조각 → preset-select 하나', () => {
    expect(COMPANION_DEFAULT_PLACEMENTS).toEqual([{ id: 'piece-editor', host: 'preset-select' }]);
  });

  test('PC·저장 배치 없음 → 사전세팅선택 행에 붙고 툴바에서는 빠진다', () => {
    for (const saved of [undefined, {}]) {
      const view = withCompanionDefaults(saved, PC);
      expect(resolveCompanionButtons('preset-select', view)).toEqual(['piece-editor']);
      const project = resolveToolbarView(TOOLBAR_VIEW_MAIN, {}, false, companionAssignedIds(view)).find(
        (a) => a.area === 'project',
      )!;
      expect(project.inline).not.toContain('piece-editor');
      expect(project.menu).not.toContain('piece-editor');
    }
    // 저장 파일 쪽은 그대로(가상 적용) — 종전 해석으로는 툴바에 있다
    const before = resolveToolbarView(TOOLBAR_VIEW_MAIN, {}, false, companionAssignedIds({})).find(
      (a) => a.area === 'project',
    )!;
    expect(before.inline).toContain('piece-editor');
  });

  test('다른 버튼만 이 행에 옮겨 둔 저장 배치 → 프롬프트조각은 그 뒤(끝)에', () => {
    const saved = { 'preset-select': ['project-trash'] };
    const view = withCompanionDefaults(saved, PC)!;
    expect(resolveCompanionButtons('preset-select', view)).toEqual(['project-trash', 'piece-editor']);
    expect(saved).toEqual({ 'preset-select': ['project-trash'] }); // 원본 불변
  });

  test('툴바 다른 버튼을 옮긴 기록(areas 전개)만 있으면 → 프롬프트조각을 직접 옮긴 것이 아니므로 새 기본 자리', () => {
    const toolbar = {
      schema: 2 as const,
      areas: { project: { inline: ['add-session', 'piece-editor'], menu: [], hidden: [] } },
      buttons: { 'add-session': 'pinned' as const },
    };
    const view = withCompanionDefaults({}, { ...PC, toolbar });
    expect(resolveCompanionButtons('preset-select', view)).toEqual(['piece-editor']);
  });

  test('저장된 배치 보존: 다른 행에 있음·툴바 유지 표·툴바에서 직접 옮김이면 손대지 않음', () => {
    const elsewhere = { vibes: ['piece-editor'] };
    expect(withCompanionDefaults(elsewhere, PC)).toBe(elsewhere);
    const kept = { [COMPANION_KEPT_IN_TOOLBAR_KEY]: ['piece-editor'] };
    expect(withCompanionDefaults(kept, PC)).toBe(kept);
    for (const placement of ['pinned', 'menu', 'hidden'] as const) {
      const ctx = { ...PC, toolbar: { buttons: { 'piece-editor': placement } } };
      expect(withCompanionDefaults({}, ctx)).toEqual({});
    }
  });

  test('적용 안 함: 모바일·모던 사이드바·클래식 툴바·레거시 작업모드', () => {
    const cases: CompanionDefaultContext[] = [
      { ...PC, isMobile: true },
      { ...PC, isMobile: true, template: 'mobile-v2' },
      { ...PC, template: 'modern' },
      { ...PC, toolbar: { classic: true } },
      { ...PC, legacyWorkflowMode: true },
    ];
    for (const ctx of cases) {
      expect(withCompanionDefaults({}, ctx)).toEqual({});
    }
  });

  test('컴팩트·프로젝트 사이드바 템플릿에도 적용', () => {
    for (const template of ['compact', 'sidebar']) {
      expect(resolveCompanionButtons('preset-select', withCompanionDefaults({}, { ...PC, template }))).toEqual([
        'piece-editor',
      ]);
    }
  });

  test('툴바로 되돌리면 툴바 유지 표에 적혀 다시 기본 자리로 돌아오지 않는다', () => {
    const view = withCompanionDefaults({}, PC);
    const next = removeCompanion(view, 'piece-editor');
    expect(next).toEqual({ [COMPANION_KEPT_IN_TOOLBAR_KEY]: ['piece-editor'] });
    const again = withCompanionDefaults(next, PC);
    expect(resolveCompanionButtons('preset-select', again)).toEqual([]);
    expect(companionAssignedIds(again).has('piece-editor')).toBe(false);
  });

  test('다른 버튼 편집(저장값 입력)은 기본 배치를 저장에 옮겨 적지 않고, 화면은 그대로', () => {
    const next = assignCompanion({}, 'characterPrompts', 'character-presets');
    expect(next).toEqual({ characterPrompts: ['character-presets'] });
    expect(resolveCompanionButtons('preset-select', withCompanionDefaults(next, PC))).toEqual(['piece-editor']);
    // 같은 행에 다른 버튼을 놓아도 프롬프트조각은 끝에 계속 보인다
    const same = assignCompanion({}, 'preset-select', 'project-trash');
    expect(resolveCompanionButtons('preset-select', withCompanionDefaults(same, PC))).toEqual([
      'project-trash',
      'piece-editor',
    ]);
  });

  test('프롬프트조각을 직접 다른 행으로 옮기면 저장에 적히고 기본 자리는 쉰다', () => {
    const next = assignCompanion({}, 'vibes', 'piece-editor');
    const view = withCompanionDefaults(next, PC);
    expect(resolveCompanionButtons('preset-select', view)).toEqual([]);
    expect(resolveCompanionButtons('vibes', view)).toEqual(['piece-editor']);
  });

  test('프리셋 패널을 접어 둔 동안은 툴바에 남는다(호스트 행이 없어 양쪽에서 사라지지 않게)', () => {
    const view = withCompanionDefaults({}, { ...PC, presetPanelHidden: true });
    expect(view).toEqual({});
    const project = resolveToolbarView(TOOLBAR_VIEW_MAIN, {}, false, companionAssignedIds(view)).find(
      (a) => a.area === 'project',
    )!;
    expect(project.inline).toContain('piece-editor');
  });

  test('「레이아웃 배치 초기화」(동반 슬롯 {}) 뒤에는 툴바 유지 표도 비워져 기본 자리로', () => {
    expect(resolveCompanionButtons('preset-select', withCompanionDefaults({}, PC))).toEqual(['piece-editor']);
  });
});

describe('프롬프트조각 모양 — 자리가 되면 아이콘+이름, 좁으면 아이콘+툴팁', () => {
  test('행 폭 판정', () => {
    const MIN = PRESET_SELECT_PIECE_LABEL_MIN_ROW_PX;
    expect(MIN).toBeLessThanOrEqual(340); // 기본 패널 폭(행 약 370px)에서 글자가 보여야 한다
    expect(presetSelectPieceLabeled(null, 0)).toBe(true); // 첫 측정 전
    expect(presetSelectPieceLabeled(MIN, 0)).toBe(true);
    expect(presetSelectPieceLabeled(MIN - 1, 0)).toBe(false);
    expect(presetSelectPieceLabeled(MIN + PRESET_SELECT_EXTRA_BUTTON_PX - 1, 1)).toBe(false);
    expect(presetSelectPieceLabeled(MIN + PRESET_SELECT_EXTRA_BUTTON_PX, 1)).toBe(true);
  });

  test('labeled → 글자 버튼(이름 보임·32px·14px·ml 없음), 아니면 종전 아이콘 버튼', () => {
    const { container, unmount } = render(
      <div>{renderCompanionButtons(['piece-editor'], 'preset-select', 'project', { labeled: true })}</div>,
    );
    const btn = container.querySelector('button')!;
    // 글자는 짧은 「조각」, 전체 이름은 툴팁·접근성 이름으로(2026-11-22 사용자)
    expect(btn.textContent).toBe('조각');
    expect(btn.getAttribute('title')).toBe('프롬프트조각');
    expect(btn.getAttribute('aria-label')).toBe('프롬프트조각');
    expect(btn.className).toContain('h-8');
    expect(btn.className).toContain('md:text-sm');
    expect(btn.className).toContain('back-green');
    expect(btn.className).not.toContain('ml-1');
    expect(btn.hasAttribute('data-companion-label')).toBe(true);
    unmount();

    const icon = render(<div>{renderCompanionButtons(['piece-editor'], 'preset-select', 'project')}</div>);
    const iconBtn = icon.container.querySelector('button')!;
    expect(iconBtn.textContent).not.toContain('조각');
    expect(iconBtn.className).toContain('icon-button');
    expect(iconBtn.hasAttribute('data-companion-label')).toBe(false);
  });
});

describe('PC 사전세팅선택 칸(PreSetEdtior.tsx PreSetSelect)', () => {
  test('글자 라벨은 모바일 분기에만 남는다', () => {
    expect(presetSelectSrc).toContain('{isMobile && companions.length === 0 && (');
    expect(presetSelectSrc.match(/사전세팅선택:<\/div>/g)?.length).toBe(1);
  });

  test('접근성 이름 = 「사전 세팅 선택: 이름」', () => {
    expect(PRESET_SELECT_ARIA_LABEL).toBe('사전 세팅 선택');
    expect(presetSelectAriaLabel('작가한놈')).toBe('사전 세팅 선택: 작가한놈');
    expect(presetSelectAriaLabel(undefined)).toBe('사전 세팅 선택');
    expect(presetSelectSrc).toContain(
      'aria-label={presetSelectAriaLabel(curSession.selectedWorkflow?.presetName)}',
    );
  });

  test('둥근 사각·테두리·입력 바탕·왼쪽 정렬 말줄임·오른쪽 ▾', () => {
    const box = presetSelectSrc.slice(presetSelectSrc.indexOf('data-preset-select-box'));
    const cls = box.match(/className="([^"]+)"/)![1];
    for (const c of [
      'preset-select-box',
      'rounded-md',
      'border',
      'border-[color:var(--c-line-strong)]',
      'bg-[var(--c-input-bg)]',
      'h-8',
      'flex-1',
      'min-w-0',
    ]) {
      expect(cls.split(' ')).toContain(c);
    }
    expect(cls).not.toContain('round-button'); // 알약 아님
    expect(box).toMatch(/flex-1 min-w-0 truncate text-left/);
    expect(box).toMatch(/<FaChevronDown[\s\S]{0,120}data-preset-select-chevron/);
    // 목록·동작은 그대로(같은 isOpen 토글, listbox)
    expect(presetSelectSrc).toContain('aria-haspopup="listbox"');
  });

  test('프롬프트조각 글자 판정은 PC 에서만, 동반 버튼 렌더에 labeled 로 넘긴다', () => {
    expect(presetSelectSrc).toMatch(/const pieceLabeled =\s*!isMobile &&/);
    expect(presetSelectSrc).toMatch(/renderCompanionButtons\(companionIds, 'preset-select', 'project', \{\s*labeled: pieceLabeled/);
  });

  test('화면 해석 경로(호스트 행·툴바 제외)는 기본 배치가 적용된 동반 슬롯(companionSlotsView)을 읽는다', () => {
    // 편집 경로(CompanionDnd·ToolbarDnd·ConfigLayoutTab 의 assign/remove)는 저장값 입력이 계약이라 대상 아님.
    const files = [
      'PreSetEdtior.tsx',
      'VibeEditor.tsx',
      'CharacterReferenceEditor.tsx',
      'SceneQueueControl.tsx',
      'SessionSelect.tsx',
    ];
    for (const f of files) {
      const src = fs
        .readFileSync(path.join(__dirname, '../../componenets', f), 'utf8')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .join('\n');
      // 남은 uiCompanionSlots 접근은 쓰기(대입)뿐(주석 줄 제외)
      const reads = src.match(/appState\.uiCompanionSlots(?!\s*=[^=])/g) ?? [];
      expect({ f, reads }).toEqual({ f, reads: [] });
    }
  });

  test('선택 칸 상태 CSS(올림·열림·포커스) — 색만, 토큰만', () => {
    const css = fs.readFileSync(path.join(__dirname, '../../componenets/App.css'), 'utf8');
    const start = css.indexOf('.preset-select-box:hover');
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf('/* ── 움직임 줄이기', start));
    expect(block).not.toMatch(/transition|animation/); // 색만 즉시
    expect(block).toContain("[aria-expanded='true']");
    expect(block).toContain('border-color: var(--c-text-faint)');
    expect(block).toContain('outline: 2px solid var(--c-focus-ring)');
  });
});
