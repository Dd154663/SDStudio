// UI 정돈 그룹 2-d(2026-11-21) 회귀 검사 — 목업 없이 진행한 「일관성 정리」 묶음.
// ① 목록 「지금 고른 줄」 = .list-row-selected(옅은 바탕 --c-selected-bg + 왼쪽 3px --c-focus-ring 띠), 서랍 진한 강조는 그대로
// ② 진행 막대·스피너 공용 부품(ProgressIndicators) ③ 빈 상태 공용 부품(EmptyState) ④ <details> 기본 삼각형 → 셰브론
// ⑤ 개수 배지 .count-badge·상태 태그 .round-tag-sm·호박색 안내 배지 .warn-badge ⑥ 토스트 종류 아이콘
// ⑦ 비활성 표현 수렴·설정 설명 글자 진하기 ⑧ 창 제목 크기·「＋ 여기에 추가」 .add-slot
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import * as fs from 'fs';
import * as path from 'path';
import { ProgressBar, Spinner, clampPercent, PROGRESS_TRACK_CLASS, PROGRESS_FILL_CLASS } from '../../componenets/ProgressIndicators';
import { EmptyState } from '../../componenets/EmptyState';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const COMP = path.resolve(__dirname, '../../componenets');
const read = (f: string) => fs.readFileSync(path.join(COMP, f), 'utf8').replace(/\r\n/g, '\n');
const css = read('App.css');

const block = (selector: string) => {
  const re = new RegExp(`(^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`);
  const m = re.exec(css);
  if (!m) throw new Error(`블록 없음: ${selector}`);
  return m[2];
};

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
const render = (el: React.ReactElement) => act(() => root.render(el));

describe('① 목록 고른 줄 .list-row-selected', () => {
  test('토큰 --c-selected-bg: 라이트 sky-600 12%, 다크 sky-400 16%(트루다크·커스텀·클래식 재정의 없음)', () => {
    expect(css).toContain('--c-selected-bg: rgb(2 132 199 / 0.12);');
    expect(css).toContain('--c-selected-bg: rgb(56 189 248 / 0.16);');
    expect(css.match(/--c-selected-bg:/g)).toHaveLength(2);
    expect(block('.true-dark')).not.toContain('--c-selected-bg');
    expect(block('html.finish-classic')).not.toContain('--c-selected-bg');
  });

  test('바탕 + 왼쪽 3px 안쪽 띠(크기 불변) + --c-text·600, @layer components 안', () => {
    const b = block('.list-row-selected');
    expect(b).toMatch(/background-color: var\(--c-selected-bg\);/);
    expect(b).toMatch(/box-shadow: inset 3px 0 0 var\(--c-focus-ring\);/);
    expect(b).toMatch(/color: var\(--c-text\);/);
    expect(b).toMatch(/font-weight: 600;/);
    expect(b).not.toMatch(/border|padding|margin/);
    const start = css.indexOf('.list-row-selected {');
    expect(css.lastIndexOf('@layer components {', start)).toBeGreaterThan(css.indexOf('.card-drop-target {'));
    // 고른 줄에 .hover-row 가 함께 붙어도 덮개 대신 고른 바탕
    expect(css).toMatch(/\.list-row-selected\.hover-row:hover,\n\.list-row-selected\.hover-row:active \{\n\s*background-color: var\(--c-selected-bg\);/);
  });

  test('적용 자리 5곳 — 종전 세 모양이 남지 않음', () => {
    expect(read('TemplateManagerModal.tsx')).toContain("? 'list-row-selected'");
    expect(read('ExportPresetManager.tsx')).toContain("? 'list-row-selected'");
    expect(read('PieceEditor.tsx')).toMatch(/\? 'list-row-selected'\n\s*: 'text-default hover-row'/);
    expect(read('SceneSelector.tsx')).toContain('list-row-selected');
    expect(read('GlobalPresetTab.tsx')).toContain("'border-sky-500 list-row-selected font-normal'");
    for (const f of ['TemplateManagerModal.tsx', 'ExportPresetManager.tsx']) {
      expect(read(f)).not.toContain('border-l-2 border-sky-500');
    }
    expect(read('PieceEditor.tsx')).not.toContain("'bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300 font-semibold'");
    expect(read('SceneSelector.tsx')).not.toContain('bg-sky-200 dark:bg-slate-700');
    expect(read('GlobalPresetTab.tsx')).not.toContain("'border-sky-500 bg-sky-50 dark:bg-sky-900'");
  });

  test('제외: 프로젝트 서랍 진한 강조·환경설정 세로 탭은 그대로', () => {
    expect(read('ProjectDrawer.tsx')).not.toContain('list-row-selected');
    expect(read('ConfigScreen.tsx')).not.toContain('list-row-selected');
    expect(read('ConfigScreen.tsx')).toContain("'bg-sky-50 dark:bg-sky-900/30 text-[color:var(--c-link)] dark:text-sky-400'");
  });
});

describe('② 진행 막대·스피너', () => {
  test('막대: 트랙 --c-input-bg·채움 --c-focus-ring·알약, role=progressbar·aria-valuenow, 높이 prop', () => {
    expect(PROGRESS_TRACK_CLASS).toContain('bg-[var(--c-input-bg)]');
    expect(PROGRESS_TRACK_CLASS).toContain('rounded-full');
    expect(PROGRESS_FILL_CLASS).toContain('bg-[var(--c-focus-ring)]');
    render(<ProgressBar value={0.42} heightClass="h-1.5" />);
    const bar = container.querySelector('[role="progressbar"]') as HTMLElement;
    expect(bar.getAttribute('aria-valuenow')).toBe('42');
    expect(bar.className).toContain('h-1.5');
    expect((bar.firstElementChild as HTMLElement).style.width).toBe('42%');
    render(<ProgressBar percent={250} />);
    expect(container.querySelector('[role="progressbar"]')!.className).toContain('h-2');
    expect((container.querySelector('[role="progressbar"]')!.firstElementChild as HTMLElement).style.width).toBe('100%');
    expect(clampPercent(NaN)).toBe(0);
    expect(clampPercent(-3)).toBe(0);
  });

  test('스피너: 종전 마크업 그대로(기본 32px)', () => {
    render(<Spinner />);
    const s = container.querySelector('[data-spinner]') as HTMLElement;
    expect(s.className).toBe('rounded-full border-2 border-[color:var(--c-line)] border-t-sky-500 animate-spin');
    expect(s.style.width).toBe('32px');
  });

  test('자리 교체 — 복사 마크업이 남지 않음, MigrationGate 는 모양만', () => {
    for (const f of ['App.tsx', 'MigrationGate.tsx', 'BatchCreateModal.tsx', 'CharacterPresetEditor.tsx', 'ArtistTagModal.tsx']) {
      expect(read(f)).toContain('<ProgressBar');
      expect(read(f)).not.toMatch(/className="h-full bg-(sky|purple)-500( rounded-full)? transition-all"/);
    }
    for (const f of ['App.tsx', 'MigrationGate.tsx', 'ResultViewer.tsx']) {
      expect(read(f)).toContain('<Spinner />');
      expect(read(f)).not.toContain('w-8 h-8 rounded-full border-2 border-[color:var(--c-line)] border-t-sky-500 animate-spin');
    }
    expect(read('MigrationGate.tsx').match(/<ProgressBar/g)).toHaveLength(2);
    expect(read('ArtistTagModal.tsx')).toContain('<ProgressBar heightClass="h-1.5" percent={artistTagService.downloadPercent} />');
  });

  test('제외: 진행 창 큰 막대·하단 작업 막대는 그대로', () => {
    expect(read('ProgressWindow.tsx')).toContain('h-8 bg-sky-600 dark:bg-sky-500');
    expect(read('ProgressWindow.tsx')).not.toContain('ProgressIndicators');
    expect(read('TaskQueueControl.tsx')).not.toContain('ProgressIndicators');
  });
});

describe('③ 빈 상태 EmptyState', () => {
  test('작은 형 = text-sm text-faint 가운데 / 큰 형 = text-base text-muted + 힌트 text-sm text-faint', () => {
    render(<EmptyState className="py-6" data-list-no-hits="">없음</EmptyState>);
    const sm = container.querySelector('[data-empty-state="sm"]') as HTMLElement;
    expect(sm.className).toBe('text-sm text-faint text-center py-6');
    expect(sm.hasAttribute('data-list-no-hits')).toBe(true);
    render(<EmptyState size="lg" hint="둘째 줄">첫 줄</EmptyState>);
    const lg = container.querySelector('[data-empty-state="lg"]') as HTMLElement;
    expect(lg.className).toContain('text-center');
    expect((lg.children[0] as HTMLElement).className).toBe('text-base text-muted');
    expect((lg.children[1] as HTMLElement).className).toBe('text-sm text-faint');
    expect(lg.querySelector('svg')).toBeNull(); // 아이콘·삽화 없음
    render(<EmptyState size="lg">한 줄</EmptyState>);
    expect(container.querySelector('[data-empty-state="lg"]')!.children).toHaveLength(1);
  });

  test('적용 자리·띄어쓰기 「비어 있습니다」', () => {
    const sites: Record<string, number> = {
      'ExportPresetManager.tsx': 2, 'TemplateManagerModal.tsx': 2, 'PieceEditor.tsx': 2, 'CharacterPresetEditor.tsx': 3,
      'GlobalPresetPicker.tsx': 2, 'ProjectDrawer.tsx': 1, 'StorageManageModal.tsx': 1, 'SceneTemplateManager.tsx': 1,
      'CompactCombinationPieces.tsx': 1, 'SceneEditor.tsx': 1, 'ImageHistory.tsx': 1, 'ImageReview.tsx': 1,
      'BatchInsertDialog.tsx': 1, 'DriveBackupManager.tsx': 1, 'ArtistLibraryTab.tsx': 1, 'GlobalPresetTab.tsx': 2,
      'QuickModeTab.tsx': 1, 'ResultViewer.tsx': 2, 'TrashViews.tsx': 1,
    };
    for (const [f, n] of Object.entries(sites)) {
      expect([f, (read(f).match(/<EmptyState[\s>]/g) ?? []).length]).toEqual([f, n]);
    }
    for (const f of ['GlobalPresetTab.tsx', 'ResultViewer.tsx', 'TrashViews.tsx']) {
      expect(read(f)).not.toContain('비어있습니다');
      expect(read(f)).toContain('비어 있습니다');
    }
    // 이미지 그리드 빈 상태 = 큰 형(문구·힌트 prop 그대로)
    expect(read('ResultViewer.tsx')).toContain("hint={emptyHint || undefined}>\n            {emptyText ?? '이미지가 없습니다'}");
  });
});

describe('④ 접기 구획 셰브론', () => {
  test('summary 기본 표식 지움 + ::before 셰브론, 열리면 아래', () => {
    expect(block('details > summary')).toMatch(/list-style: none;/);
    expect(block('details > summary::-webkit-details-marker')).toMatch(/display: none;/);
    const b = block('details > summary::before');
    expect(b).toMatch(/border-right: 1\.5px solid var\(--c-text-faint\);/);
    expect(b).toMatch(/rotate\(-45deg\)/);
    expect(block('details[open] > summary::before')).toMatch(/rotate\(45deg\)/);
    for (const f of ['ArtistTagModal.tsx', 'DriveSettingsTab.tsx', 'OpusUsageMeter.tsx']) expect(read(f)).toContain('<summary');
  });
});

describe('⑤ 배지·태그', () => {
  test('.count-badge = 최소 폭 1rem·높이 1rem·11px·좌우 4px·알약, 색 없음', () => {
    const b = block('.count-badge');
    expect(b).toMatch(/min-width: 1rem;/);
    expect(b).toMatch(/height: 1rem;/);
    expect(b).toMatch(/font-size: 11px;/);
    expect(b).toMatch(/padding: 0 4px;/);
    expect(b).toMatch(/border-radius: 9999px;/);
    expect(b).not.toMatch(/color/);
  });

  test('자리 — 색은 그대로', () => {
    expect(read('SceneEditor.tsx')).toContain('bg-red-600 text-white dark:bg-red-500 count-badge');
    expect(read('SceneQueueControl.tsx').match(/"bg-black\/70 text-white count-badge"/g)).toHaveLength(2);
    expect(read('SessionSelect.tsx')).toContain('bg-green-700 text-white count-badge');
    expect(read('ProjectDrawer.tsx')).toContain('flex-none count-badge ${');
    expect(read('ProjectDrawer.tsx')).toContain("'bg-emerald-600 text-white dark:bg-emerald-500'");
  });

  test('상태 태그 한 정의(.round-tag + .round-tag-sm), 호박색 안내 배지 한 정의(.warn-badge)', () => {
    expect(block('.round-tag.round-tag-sm')).toMatch(/@apply text-xs px-2 py-0\.5 whitespace-nowrap;/);
    expect(read('ConfigScreen.tsx')).toContain("const roundTag = 'round-tag round-tag-sm';");
    expect(read('DriveBackupManager.tsx')).toContain("const tag = 'round-tag round-tag-sm';");
    expect(read('DriveConnectSection.tsx')).toContain("const tag = 'round-tag round-tag-sm';");
    expect(block('.warn-badge')).toContain('border-amber-300');
    expect(read('ConfigScreen.tsx')).toContain("'warn-badge shadow-sm'");
    expect(read('ConfigScreen.tsx')).not.toContain('bg-amber-100 text-amber-700 border border-amber-300');
    expect(read('SessionSelect.tsx')).toContain('titlebar-no-drag warn-badge max-w-[9rem]');
  });
});

describe('⑥ 토스트 종류 아이콘', () => {
  test('오류 = 느낌표 원·성공 = 체크 원·안내 = 정보 원, 첫 줄 높이 상자', () => {
    // AlertWindow 는 AppService 를 끌어와 렌더 대신 소스 검사
    const src = read('AlertWindow.tsx');
    expect(src).toMatch(/error: FaExclamationCircle,\n\s*success: FaCheckCircle,\n\s*info: FaInfoCircle,/);
    expect(src).toContain('flex items-start gap-2');
    expect(src).toContain('<span className="flex-none h-6 flex items-center" data-toast-icon={kind} aria-hidden>');
    expect(src).toContain('<Icon size={15} />');
    // 색·표시 시간 그대로
    expect(src).toContain("error: { layer: 'bg-red-600 text-white'");
    expect(src).toContain('const TOAST_DURATION = 5000;');
  });
});

describe('⑦ 비활성 표현·설명 글자', () => {
  test('componenets 에 disabled:opacity-40/-30 이 남지 않음', () => {
    for (const f of fs.readdirSync(COMP).filter((x) => x.endsWith('.tsx'))) {
      expect([f, /disabled:opacity-(30|40)\b/.test(read(f))]).toEqual([f, false]);
    }
  });

  test('설정 체크 줄·스위치 줄 설명 = text-muted(note 는 faint)', () => {
    const src = read('SettingControls.tsx');
    expect(src.match(/<span className="block text-xs text-muted mt-0\.5">\{description\}<\/span>/g)).toHaveLength(2);
    expect(src).not.toContain('block text-xs text-faint mt-0.5');
    expect(src).toContain('<span className="ml-2 text-xs text-faint">{note}</span>');
  });
});

describe('⑧ 창 제목·「＋ 여기에 추가」', () => {
  test('직접 창 제목 = text-base font-semibold, 관문 큰 제목은 그대로', () => {
    expect(read('ShortcutCheatsheet.tsx')).toContain('<span className="text-base font-semibold text-default">단축키 도움말</span>');
    expect(read('ExpiredProjectsDialog.tsx')).toContain('className="text-center text-base font-semibold text-default mb-2"');
    expect(read('MigrationGate.tsx')).toContain('text-lg font-semibold');
    expect(read('SaveLocationGate.tsx')).toContain('text-lg font-semibold');
  });

  test('.add-slot = 1px 점선 --c-line-strong·rounded-lg·--c-text-muted, hover 덮개', () => {
    const b = block('.add-slot');
    expect(b).toMatch(/border: 1px dashed var\(--c-line-strong\);/);
    expect(b).toMatch(/border-radius: 0\.5rem;/);
    expect(b).toMatch(/color: var\(--c-text-muted\);/);
    expect(css).toMatch(/@media \(hover: hover\) \{\n\s*\.add-slot:hover:not\(:disabled\) \{\n\s*background-color: var\(--c-hover\);/);
  });

  test('자리 — 점선 상자 여러 벌이 한 클래스로, 채운 주 동작 버튼·보라 글로벌 카드는 그대로', () => {
    const sites: Record<string, number> = {
      'ExportPresetManager.tsx': 1, 'TemplateManagerModal.tsx': 1, 'SceneEditor.tsx': 2, 'CharacterPresetEditor.tsx': 2,
      'ProjectBrowser.tsx': 1, 'ArtistLibraryTab.tsx': 3, 'SceneQueueControl.tsx': 1,
    };
    for (const [f, n] of Object.entries(sites)) {
      expect([f, (read(f).match(/add-slot /g) ?? []).length]).toEqual([f, n]);
    }
    expect(read('ArtistLibraryTab.tsx')).toContain('round-button back-sky px-4 py-2 text-sm flex items-center gap-1');
    expect(read('CharacterPresetEditor.tsx')).toContain('border-2 border-dashed border-purple-300');
  });
});
