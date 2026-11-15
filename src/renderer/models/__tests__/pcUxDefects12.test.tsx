// PC UI/UX 「명백한 결함」 묶음 1·2(2026-11-15) 회귀 검사.
// 렌더 검사: ToolbarOverflowMenu 자동 가로 정렬(오른쪽 넘침이면 right-0, 명시 align 우선) + 순수 판정 함수.
// 소스 검사(큰 파일·전역 CSS 라 렌더 대신): App.css 포커스 링 토큰·.gray-input:focus-visible·켜짐 클래스·10.5px 없음·
// 패널 폭 상한, 아이콘 토글 aria-pressed·.toggle-on, 닫기 ✕ 상수 재사용, 국소 클래스 수정(D3·D4·D12·D13·A1·A2·A3·S4·T2·T3·R1).
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('@capacitor/app', () => ({
  App: { addListener: jest.fn(), minimizeApp: jest.fn() },
}));
jest.mock('../index', () => ({ isMobile: false }));
jest.mock('../AppService', () => ({
  appState: { incrementModalOverlay: jest.fn(), decrementModalOverlay: jest.fn() },
}));
jest.mock('react-dnd', () => ({
  useDrag: () => [{ isDragging: false }, () => {}, () => {}],
  useDrop: () => [{}, () => {}],
  useDragLayer: (fn: any) =>
    fn({ isDragging: () => false, getItemType: () => null, getClientOffset: () => null }),
}));
jest.mock('react-dnd-html5-backend', () => ({ getEmptyImage: () => null }));
jest.mock('../../componenets/ToolbarDnd', () => ({
  LONG_PRESS_MS: 400,
  applyToolbarMove: jest.fn(),
  applyToolbarMoveFromCompanion: jest.fn(),
  armToolbarDrag: jest.fn(),
  disarmToolbarDrag: jest.fn(),
  isMenuDragArmed: () => false,
  metaOf: () => undefined,
}));
jest.mock('../../componenets/ModalOverlay', () => ({
  __esModule: true,
  default: ({ children }: any) => children,
}));

import ToolbarOverflowMenu, { resolveOverflowAlign } from '../../componenets/ToolbarOverflowMenu';

const COMP = path.resolve(__dirname, '../../componenets');
const read = (f: string) => fs.readFileSync(path.join(COMP, f), 'utf8');
const css = read('App.css');

describe('ToolbarOverflowMenu 자동 가로 정렬(T1)', () => {
  test('순수 판정 — 넘치지 않으면 left, 오른쪽이 넘치면 right, 오른쪽 정렬이 더 넘치면 left 유지', () => {
    expect(resolveOverflowAlign({ left: 100, right: 136 }, 240, { left: 0, right: 1000 })).toBe('left');
    expect(resolveOverflowAlign({ left: 900, right: 936 }, 240, { left: 0, right: 1000 })).toBe('right');
    // 잘리는 영역이 좁아 오른쪽 정렬이 왼쪽으로 더 많이 넘치는 경우
    expect(resolveOverflowAlign({ left: 10, right: 46 }, 240, { left: 0, right: 200 })).toBe('left');
  });

  let root: Root;
  let container: HTMLDivElement;
  const realRect = HTMLElement.prototype.getBoundingClientRect;
  beforeAll(() => {
    (global as any).IS_REACT_ACT_ENVIRONMENT = true;
  });
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 240 });
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      if (this.dataset.anchor === 'right-edge')
        return { left: 900, right: 936, top: 0, bottom: 32, width: 36, height: 32, x: 900, y: 0 } as DOMRect;
      if (this.dataset.anchor === 'left-edge')
        return { left: 100, right: 136, top: 0, bottom: 32, width: 36, height: 32, x: 100, y: 0 } as DOMRect;
      return realRect.call(this);
    };
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    HTMLElement.prototype.getBoundingClientRect = realRect;
    delete (HTMLElement.prototype as any).offsetWidth;
  });
  const items = [{ id: 'a', name: '가', node: <button>가</button> }];
  const renderAt = (anchor: string, align?: 'left' | 'right') =>
    act(async () =>
      root.render(
        <div className="relative" data-anchor={anchor}>
          <ToolbarOverflowMenu isOpen onClose={() => {}} title="더보기" items={items} align={align} />
        </div>,
      ),
    );
  const pop = () => container.querySelector('[data-anchor] > div') as HTMLElement;

  test('앵커가 오른쪽 끝이면 right-0 로 바뀐다', async () => {
    await renderAt('right-edge');
    expect(pop().className).toContain('right-0');
    expect(pop().className).not.toContain('left-0');
  });
  test('넘치지 않으면 종전처럼 left-0', async () => {
    await renderAt('left-edge');
    expect(pop().className).toContain('left-0');
  });
  test('명시 align 은 자동 판정보다 우선', async () => {
    await renderAt('right-edge', 'left');
    expect(pop().className).toContain('left-0');
  });
});

describe('App.css 상태 표시(D10·S3·S2·D11·W1)', () => {
  test('포커스 링 토큰 --c-focus-ring — 라이트 sky-700, 다크 종전 sky-400, 공용 :focus-visible 가 토큰 사용', () => {
    expect(css).toMatch(/:root\s*\{[^}]*--c-focus-ring:\s*#0369a1/);
    expect(css).toMatch(/\.dark\s*\{[^}]*--c-focus-ring:\s*rgb\(56,\s*189,\s*248\)/);
    expect(css).toMatch(/\.btn-link:focus-visible\s*\{\s*outline:\s*2px solid var\(--c-focus-ring\)/);
    expect(css).not.toMatch(/outline:\s*2px solid rgb\(56,\s*189,\s*248\)/);
  });
  test('.gray-input:focus-visible 링이 .gray-input 규칙 뒤에 있다', () => {
    const base = css.indexOf('.gray-input {');
    const focus = css.indexOf('.gray-input:focus-visible');
    expect(base).toBeGreaterThan(-1);
    expect(focus).toBeGreaterThan(base);
    expect(css.slice(focus, focus + 120)).toContain('var(--c-focus-ring)');
  });
  test('켜짐 클래스 .toggle-on — 안쪽 2px 링(토큰) + hover 에도 유지', () => {
    expect(css).toMatch(/\.toggle-on,\s*\.toggle-on:hover\s*\{\s*box-shadow:\s*inset 0 0 0 2px var\(--c-focus-ring\)/);
  });
  test('10.5px 글자 없음(툴바 캡션 11px)', () => {
    expect(css).not.toMatch(/font-size:\s*10\.5px/);
    expect(css).toMatch(/\.toolbar-group-caption\s*\{[^}]*font-size:\s*11px/);
    expect(read('SceneQueueControl.tsx')).toContain('toolbar-group-caption text-muted');
  });
  test('패널 폭 상한 — 1024 이상 프리셋 40vw·히스토리 30vw, 1023 이하 36vw 유지', () => {
    expect(css).toMatch(/@media \(max-width: 1023px\)\s*\{\s*\.panel-vw-clamp\s*\{\s*max-width: 36vw;/);
    expect(css).toMatch(/\.panel-vw-clamp\.panel-vw-clamp-preset\s*\{\s*max-width: 40vw;/);
    expect(css).toMatch(/\.panel-vw-clamp\.panel-vw-clamp-history\s*\{\s*max-width: 30vw;/);
    expect(read('App.tsx')).toContain('panel-vw-clamp panel-vw-clamp-preset');
    expect(read('ImageHistory.tsx')).toContain('panel-vw-clamp panel-vw-clamp-history');
  });
});

describe('아이콘 토글 켜짐 표시(S2)', () => {
  const sqc = read('SceneQueueControl.tsx');
  const rv = read('ResultViewer.tsx');
  const near = (src: string, marker: string) => {
    const i = src.indexOf(marker);
    expect(i).toBeGreaterThan(-1);
    return src.slice(Math.max(0, i - 400), i + 100);
  };
  test.each([
    [sqc, 'data-toolbar-toggle="multi-select"', 'appState.sceneSelectionMode'],
    [sqc, 'data-toolbar-toggle="scene-search"', 'showSceneSearch'],
    [sqc, 'data-toolbar-toggle="more"', 'showToolbarMenu'],
    [rv, 'data-viewer-toggle="select-mode"', 'selectMode'],
  ])('켜고 끄는 토글은 aria-pressed + toggle-on (%#)', (src, marker, stateExpr) => {
    const block = near(src, marker);
    expect(block).toContain(`aria-pressed={${stateExpr}}`);
    expect(block).toMatch(/'back-sky toggle-on'/);
  });
  test.each([
    [sqc, 'data-toolbar-toggle="bookmark-jump"', "'back-orange toggle-on'"],
    [rv, 'data-viewer-toggle="paste"', "'back-sky toggle-on'"],
    [rv, 'data-viewer-toggle="bookmark-jump"', "'back-orange toggle-on'"],
  ])('상태를 보여 주는 동작 버튼은 toggle-on 만(누름 상태가 아니라 aria-pressed 없음) (%#)', (src, marker, cls) => {
    const block = near(src, marker);
    expect(block).toContain(cls);
    expect(block.slice(block.indexOf(cls))).not.toContain('aria-pressed');
  });
  test('인페인트 [영역 도구]도 같은 켜짐 클래스', () => {
    expect(read('InPaintEditor.tsx')).toContain("focusTool ? 'back-sky toggle-on' : 'back-gray'");
  });
});

describe('닫기 ✕ 공용 모양(C2·S1)', () => {
  test('ModalOverlay 가 상수를 export 하고 머리줄 ✕ 가 그 상수를 쓴다', () => {
    const mo = read('ModalOverlay.tsx');
    expect(mo).toMatch(/export const OVERLAY_CLOSE_BUTTON_CLASS =\s*'p-1 rounded hover:bg-gray-200 dark:hover:bg-slate-600 text-muted transition-colors'/);
    expect(mo).toContain('export const OVERLAY_CLOSE_ICON_SIZE = 16');
    expect(mo).toContain('className={OVERLAY_CLOSE_BUTTON_CLASS}');
  });
  test.each(['ImageReview.tsx', 'ShortcutCheatsheet.tsx', 'TaskQueueControl.tsx'])('%s 의 직접 만든 ✕ 가 상수를 재사용', (f) => {
    const src = read(f);
    expect(src).toContain("from './ModalOverlay'");
    expect(src).toContain('OVERLAY_CLOSE_BUTTON_CLASS');
    expect(src).toContain('<FaTimes size={OVERLAY_CLOSE_ICON_SIZE} />');
  });
  test('작업 목록 ✕ 의 다크 짝 없는 hover:text-gray-700 이 사라졌다(S1)', () => {
    expect(read('TaskQueueControl.tsx')).not.toContain('hover:text-gray-700');
  });
});

describe('국소 클래스 수정(묶음 1)', () => {
  test('D3 예약 수 배지 — 사용자 롤백(2026-11-15): 종전 흰 글자 유지', () => {
    // 진한 글자(yellow-950/indigo-950)로 바꿨다가 실기에서 사용자가 종전 모양을 선호해 되돌림. 묶음 4(원색 배경 결정)와 함께 재검토.
    const src = read('SceneQueueControl.tsx');
    expect(src.match(/bg-yellow-400 dark:bg-indigo-400[^"]*text-white/g)).toHaveLength(2);
    expect(src).not.toContain('text-yellow-950');
  });
  test('D4·D12·D13', () => {
    expect(read('SessionSelect.tsx')).toContain('bg-green-700 text-white text-[11px]');
    expect(read('TaskQueueControl.tsx')).toContain('rounded-lg font-medium text-sm text-gray-700');
    expect(read('ResolutionPicker.tsx')).toContain('text-[11px] text-amber-700 dark:text-amber-500');
  });
  test('A1 단축키 도움말 아이콘 18', () => {
    expect(read('SceneQueueControl.tsx')).toContain('<ActionIcon id="shortcut-help" size={18} />');
  });
  test('A2 인페인트 머리줄 원형 버튼 없음', () => {
    expect(read('InPaintEditor.tsx')).not.toContain('rounded-full h-8 w-8');
  });
  test('A3 확인 창 체크 줄 mt-3 없음 · S4 이름 입력 [확인] 비활성 모양', () => {
    const src = read('ConfirmWindow.tsx');
    expect(src).not.toMatch(/<label[^>]*\bmt-3\b/);
    expect(src).toContain("'flex items-center')");
    expect(src).toContain('r-btn back-sky clickable disabled:opacity-50 disabled:cursor-not-allowed');
  });
  test('T2 파일 이름 break-all · T3 조각 이름 말줄임+Tooltip', () => {
    expect(read('ResultViewer.tsx')).toContain('<span className="break-all">{filename}</span>');
    const pe = read('PieceEditor.tsx');
    expect(pe).toMatch(/<Tooltip content=\{piece\.name\}>\s*<div\s+className="font-bold text-default min-w-0 truncate"/);
  });
  test('R1 PC 경로 10px 글자는 순번 원만 남는다(모바일 전용 파일 제외)', () => {
    const files = fs.readdirSync(COMP).filter((f) => f.endsWith('.tsx') && !f.startsWith('Mobile'));
    const hits = files.filter((f) => read(f).includes('text-[10px]')).sort();
    expect(hits).toEqual([
      'CharacterPositionOverlay.tsx',
      'PreSetEdtior.tsx',
      'SceneEditor.tsx',
      'TemplateManagerModal.tsx',
    ]);
  });
  test('S5 상호작용 클래스 병기', () => {
    expect(read('PieceEditor.tsx').match(/className=\{`btn \$\{wide/g)).toHaveLength(2);
    expect(read('ProjectDrawer.tsx')).toContain('className="btn w-full flex items-center gap-2 pl-1.5 pr-2 py-2.5 rounded-md');
    expect(read('PreSetEdtior.tsx')).toContain('className="btn-link flex items-center gap-2 text-xs mt-1 relative touch-hit"');
    expect(read('SceneEditor.tsx')).toContain('className="btn-link flex items-center gap-2 text-xs relative touch-hit"');
  });
});
