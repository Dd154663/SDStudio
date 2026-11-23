// UI 정돈 그룹 2-b(2026-11-21, 사용자 승인 목업) 회귀 검사 — 소스 검사형(전역 CSS·큰 컴포넌트라 렌더 대신).
// 같은 역할인데 모양이 다른 것 통일: ① 창 확정·취소 버튼 ② 씬·이미지 우클릭 메뉴(react-contexify) 테마 토큰
// ③ 카드 「선택됨」·「여기에 놓기」 ④ 로컬/글로벌 전환 ⑤ 이미지 그리드 크기 단추.
import * as fs from 'fs';
import * as path from 'path';
import {
  DIALOG_DANGER_BTN,
  DIALOG_PRIMARY_BTN,
  DIALOG_SECONDARY_BTN,
  DIALOG_SOLID_BTN,
} from '../../componenets/ModalOverlay';

jest.mock('../AppService', () => ({ appState: {} }));
jest.mock('../index', () => ({ isMobile: false }));
jest.mock('../BackStackService', () => ({ backStackService: { push: () => ({ remove: () => {} }) } }));
jest.mock('../../componenets/backdropClose', () => ({ useGuardedClose: (_d: unknown, f: unknown) => f }));

const COMP = path.resolve(__dirname, '../../componenets');
const read = (f: string) => fs.readFileSync(path.join(COMP, f), 'utf8').replace(/\r\n/g, '\n');
const css = read('App.css');
const contexify = read('contexify.css');
const count = (src: string, needle: string) => src.split(needle).length - 1;

describe('① 창 확정·취소 버튼 — 솔리드 알약·중립 알약 한 모양', () => {
  test('공용 상수: 알약 .r-btn(클래식 rounded 4px 병기)·px-4 py-2 text-sm, 확정 = btn-solid-*, 취소 = btn-neutral', () => {
    expect(DIALOG_SOLID_BTN).toBe('dialog-btn px-4 py-2 rounded r-btn text-sm font-medium transition-colors');
    expect(DIALOG_PRIMARY_BTN).toBe(`${DIALOG_SOLID_BTN} btn-solid-sky`);
    expect(DIALOG_DANGER_BTN).toBe(`${DIALOG_SOLID_BTN} btn-solid-red`);
    expect(DIALOG_SECONDARY_BTN).toBe('dialog-btn px-4 py-2 rounded r-btn btn-neutral text-body text-sm transition-colors');
  });
  test('종전 바닥줄 문자열(rounded-lg 8px 사각)이 창 확정·취소 자리에 남지 않음', () => {
    const old = [
      'px-4 py-2 rounded-lg btn-neutral text-body text-sm transition-colors',
      'px-4 py-2 rounded-lg btn-solid-red text-sm font-medium transition-colors',
    ];
    for (const f of fs.readdirSync(COMP).filter((n) => n.endsWith('.tsx'))) {
      for (const o of old) expect([f, read(f).includes(o)]).toEqual([f, false]);
    }
  });
  test('일반 창 바닥줄 자리가 상수를 씀', () => {
    const uses: [string, string, number][] = [
      ['ConfigScreen.tsx', 'DIALOG_PRIMARY_BTN', 1],
      ['ConfigScreen.tsx', 'DIALOG_SECONDARY_BTN', 1],
      ['ConfigSystemTab.tsx', 'DIALOG_DANGER_BTN', 1],
      ['EmbeddedBrowser.tsx', 'DIALOG_PRIMARY_BTN', 1],
      ['PresetEditModal.tsx', 'DIALOG_SECONDARY_BTN', 1],
      ['ConfigSyncSection.tsx', 'DIALOG_PRIMARY_BTN', 1],
      ['TemplateInheritModals.tsx', 'DIALOG_DANGER_BTN', 1],
      ['DirectExportDialog.tsx', 'DIALOG_PRIMARY_BTN', 1],
      ['ExportPresetManager.tsx', 'DIALOG_PRIMARY_BTN', 1],
      ['PreSetEdtior.tsx', 'DIALOG_DANGER_BTN', 1],
      ['TemplateManagerModal.tsx', 'DIALOG_PRIMARY_BTN', 1],
      ['CharacterPresetInnerEditor.tsx', 'DIALOG_PRIMARY_BTN', 2],
      ['CharacterPresetInnerEditor.tsx', 'DIALOG_SECONDARY_BTN', 2],
    ];
    for (const [f, c, n] of uses) expect([f, c, count(read(f), c) >= n + 1]).toEqual([f, c, true]); // +1 = import 줄
    expect(read('BatchInsertDialog.tsx')).toContain('const PRIMARY_BUTTON = DIALOG_PRIMARY_BTN;');
    expect(read('FindReplaceDialog.tsx')).toContain('const CLOSE_BUTTON = DIALOG_SECONDARY_BTN;');
    expect(read('FindReplaceDialog.tsx')).toContain("className={DIALOG_SOLID_BTN + ' btn-solid-orange'}");
  });
  test('확인 창: confirm·yes-only·입력형 = 상수, 선택형·드롭다운·체크 목록 = 구조 그대로 색·반경만(back-* 채움·clickable 없음)', () => {
    const src = read('ConfirmWindow.tsx');
    expect(src).toContain("'mr-2 ' + (curDialog.danger ? DIALOG_DANGER_BTN : DIALOG_PRIMARY_BTN)");
    expect(src).toContain("className={'mr-2 ' + DIALOG_PRIMARY_BTN + ' disabled:opacity-50 disabled:cursor-not-allowed'}");
    expect(count(src, 'className={DIALOG_SECONDARY_BTN}')).toBe(2);
    expect(src).toContain('className={DIALOG_PRIMARY_BTN}');
    expect(src).not.toMatch(/r-btn back-(sky|gray|red|lgray)/);
    expect(src).not.toMatch(/back-(sky|gray|red) clickable/);
    expect(src).toContain("'dialog-btn w-full px-4 py-2 rounded r-btn transition-colors shrink-0 '");
    expect(count(src, 'dialog-btn flex-1 px-4 py-2')).toBe(4);
    expect(src).toContain('dialog-btn w-full px-4 py-2 rounded r-btn btn-neutral text-body transition-colors shrink-0');
  });
  test('만료 프로젝트 창: 4px 사각 back-* 대신 상수(위험 = DANGER, 미루기 = PRIMARY, 취소 = SECONDARY)', () => {
    const src = read('ExpiredProjectsDialog.tsx');
    expect(src).not.toMatch(/rounded back-(red|sky|gray) clickable/);
    expect(count(src, 'DIALOG_DANGER_BTN +')).toBe(3);
    expect(count(src, 'DIALOG_PRIMARY_BTN +')).toBe(2);
    expect(count(src, 'DIALOG_SECONDARY_BTN +')).toBe(1);
  });
  test('App.css: 솔리드 버튼이 공통 포커스 링 목록에, .dialog-btn 누름 표시', () => {
    expect(css).toMatch(/\.btn-link:focus-visible,\s*\[class\*="btn-solid-"\]:focus-visible\s*\{\s*outline: 2px solid var\(--c-focus-ring\);/);
    expect(css).toMatch(/\.dialog-btn:active:not\(:disabled\) \{\s*filter: brightness\(0\.85\);/);
    // .dark .btn-neutral:hover 보다 뒤(같은 특이도 — 누르는 동안 이김)
    expect(css.indexOf('.dialog-btn:active')).toBeGreaterThan(css.indexOf('.dark .btn-neutral:hover'));
  });
});

// 2026-11-21 실기 지적: 다크의 확인 창(거의 검은 배경막 위)에서 솔리드 500 확정 버튼이 눈부심 → 그 창 안에서만 반투명 상태색.
describe('①-b 다크 확인 창 계열의 확정 버튼은 반투명 상태색(모양·클래스는 그대로)', () => {
  test('.confirm-window 안의 솔리드 하늘·빨강 = back-* 토큰, 일반·hover·비활성 모두', () => {
    for (const color of ['sky', 'red']) {
      const sel = `.dark .confirm-window .dialog-btn.btn-solid-${color}`;
      expect(css).toContain(
        `${sel},\n${sel}:hover,\n${sel}:disabled {\n  background-color: var(--c-${color}-bg);\n  color: var(--c-${color}-fg);\n}`,
      );
    }
  });
  test('일반 창 바닥줄(.confirm-window 밖)에는 걸리지 않는다 — 다크 전용 dialog-btn 규칙은 모두 .confirm-window 안', () => {
    const rules = css.split('\n').filter((line) => line.startsWith('.dark ') && line.includes('.dialog-btn'));
    expect(rules.length).toBeGreaterThanOrEqual(8);
    for (const rule of rules) expect(rule.startsWith('.dark .confirm-window ')).toBe(true);
  });
  test('확인 창·만료 프로젝트 창이 그 배경막 클래스를 쓴다', () => {
    expect(read('ConfirmWindow.tsx')).toContain('confirm-window');
    expect(read('ExpiredProjectsDialog.tsx')).toContain('confirm-window');
  });
});

describe('② contexify 우클릭 메뉴 — 테마 토큰', () => {
  test('고정색(#fff·#3498db 등 hex) 없음, 색 변수는 .contexify 에서 --c-* 토큰으로', () => {
    expect(contexify).not.toMatch(/#fff\b/i);
    expect(contexify).not.toContain('#3498db');
    expect(contexify).not.toMatch(/#[0-9a-f]{3,6}\b/i);
    const root = contexify.slice(contexify.indexOf(':root {'), contexify.indexOf('}', contexify.indexOf(':root {')));
    expect(root).not.toMatch(/Color|color/);
    expect(contexify).toMatch(/\.contexify \{\s*--contexify-menu-bgColor: var\(--c-surface-2\);\s*--contexify-menu-borderColor: var\(--c-line\);/);
    expect(contexify).toContain('--contexify-separator-color: var(--c-line);');
    expect(contexify).toContain('--contexify-item-color: var(--c-text-label);');
    expect(contexify).toContain('--contexify-activeItem-color: var(--c-text-label);');
    expect(contexify).toContain('--contexify-activeItem-bgColor: var(--c-hover);');
    expect(contexify).toContain('--contexify-arrow-color: var(--c-text-muted);');
    expect(contexify).toContain('border: 1px solid var(--contexify-menu-borderColor);');
    expect(contexify).toMatch(/\.contexify_item-disabled > \.contexify_itemContent \{\s*color: var\(--contexify-disabledItem-color\);/);
    expect(contexify).toContain('--contexify-disabledItem-color: var(--c-text-faint);');
  });
  test('움직임: 앱이 쓰는 fade 는 그룹 3-a 에서 짧게(uiPolishGroup3a.test.ts), 쓰지 않는 scale 은 그대로', () => {
    expect(contexify).toContain('animation: contexify_fadeIn var(--motion-base, 130ms) var(--motion-ease-out, ease-out);');
    expect(contexify).toContain('animation: contexify_scaleIn 0.3s;');
  });
  test('메뉴는 테마 루트 안에서 그려짐(AppContextMenu 가 [data-app-theme-root] 안, 라이브러리는 포털 없음)', () => {
    const app = read('App.tsx');
    const root = app.indexOf('data-app-theme-root');
    expect(root).toBeGreaterThan(-1);
    expect(app.indexOf('<AppContextMenu />')).toBeGreaterThan(root);
    expect(app).toContain("import './contexify.css';");
  });
});

describe('③ 카드 「선택됨」·「여기에 놓기」', () => {
  test('App.css 공용 클래스: 선택 = 실선 + ::after 체크, 놓기 = 점선 + 옅은 막, 토큰 --c-drop-bg', () => {
    expect(css).toMatch(/\.card-selected \{\s*outline: 2px solid var\(--c-focus-ring\);\s*outline-offset: -2px;/);
    expect(css).toMatch(/\.card-selected\.card-selected-outside \{\s*outline-offset: 0;/);
    expect(css).toMatch(/\.card-selected:not\(\.card-check-none\)::after \{[^}]*content: '\\2713';[^}]*background-color: var\(--c-focus-ring\);[^}]*color: var\(--c-surface\);[^}]*pointer-events: none;/);
    expect(css).toMatch(/\.card-drop-target \{\s*outline: 2px dashed var\(--c-focus-ring\);\s*outline-offset: -2px;\s*background-image: linear-gradient\(var\(--c-drop-bg\), var\(--c-drop-bg\)\);/);
    expect(css).toMatch(/:root \{[^}]*--c-drop-bg: rgb\(2 132 199 \/ 0\.1\);/);
    expect(css).toMatch(/\.dark \{[^}]*--c-drop-bg: rgb\(56 189 248 \/ 0\.16\);/);
  });
  test('적용 자리(선택·놓기)와 종전 하늘 링 제거', () => {
    const sqc = read('SceneQueueControl.tsx');
    expect(sqc).toContain("isOver ? ' card-drop-target' : ''");
    expect(sqc).toContain("' card-selected card-check-none bg-sky-50 dark:bg-sky-900/20'");
    expect(sqc).toContain("isSelected ? ' card-selected card-selected-outside card-check-none' : ''");
    expect(sqc).toContain("currentPreviewIsFavorite ? 'border-yellow-400 ' : 'line-color '");
    expect(sqc).not.toContain("' ring-2 ring-sky-400'");
    expect(sqc).not.toContain("' ring-2 ring-sky-500'");
    expect(sqc).not.toContain("' outline outline-sky-500'");
    const pse = read('PreSetEdtior.tsx');
    expect(pse).toContain("(isSelected ? ' card-selected' : '')");
    expect(pse).toContain("(isOver ? ' card-drop-target' : '')");
    const cpc = read('CharacterPresetCards.tsx');
    expect(count(cpc, "(isOver ? 'card-drop-target ' : '')")).toBe(2);
    expect(cpc).not.toContain('ring-2 ring-sky-400');
    expect(cpc).not.toContain('ring-2 ring-purple-400');
    const pb = read('ProjectBrowser.tsx');
    expect(pb).toContain("'line-color card-selected card-check-none'");
    expect(pb).toContain("dropping ? 'card-drop-target ' : ''");
    expect(read('CharacterPresetEditor.tsx')).toContain("droppable && isOver ? 'card-drop-target ' : ''");
    expect(read('GlobalPresetTab.tsx')).toContain("(selected ? ' card-selected card-check-none' : '')");
    const rv = read('ResultViewer.tsx');
    expect(rv).toContain("(isSelected ? 'card-selected' : '')");
    expect(rv).toContain("(isOver ? ' card-drop-target' : '')");
    expect(rv).not.toContain("(isOver ? ' border-2 border-sky-500' : '')");
  });
  test('카드에 ::after 를 쓰는 다른 클래스(touch-hit)와 겹치지 않음', () => {
    for (const f of ['SceneQueueControl.tsx', 'PreSetEdtior.tsx', 'ResultViewer.tsx']) {
      for (const line of read(f).split('\n')) {
        if (line.includes('card-selected')) expect(line).not.toContain('touch-hit');
      }
    }
  });
});

// 그룹 2-c(2026-11-21): 두 자리 모두 택일 묶음 .seg-group 으로 옮김 — 같은 모양이라는 이 검사의 뜻은 그대로(값만 새 클래스).
describe('④ 로컬/글로벌 전환 — 한 모양(그룹 2-c 부터 .seg-group)', () => {
  test('캐릭터 프리셋 관리(PC aside): seg-group seg-fill, 로컬 seg-on·글로벌 seg-on-purple, aria-pressed 유지', () => {
    const src = read('CharacterPresetEditor.tsx');
    const start = src.indexOf('const asideViewToggle = (');
    const block = src.slice(start, src.indexOf('// [순차 생성 모드][선택 모드]', start));
    expect(block).toContain('className="seg-group seg-fill flex"');
    expect(block).not.toContain('tab-seg');
    expect(block).toContain("(!globalView ? ' seg-on' : '')");
    expect(block).toContain("(globalView ? ' seg-on-purple' : '')");
    expect(count(block, 'aria-pressed=')).toBe(2);
    expect(block).toContain('로컬');
    expect(block).toContain('글로벌');
    // 모바일 한 버튼 전환은 그대로
    expect(src).toContain('const mobileViewToggle = (');
    expect(src).toContain("? 'bg-purple-600 text-white dark:bg-purple-500'\n          : 'btn-neutral text-body'");
  });
  test('프롬프트조각: seg-group + 같은 선택 표시(전역 = seg-on-purple), 문구 「전역」 그대로, 도움말은 묶음 밖', () => {
    const src = read('PieceEditor.tsx');
    const start = src.indexOf('const scopeToggle = (');
    const block = src.slice(start, src.indexOf('const scopeNotice', start));
    expect(block).toContain("'seg-group seg-fill flex flex-1 min-w-0' : 'seg-group inline-flex'");
    expect(block).toContain("(scope === 'local' ? ' seg-on' : '')");
    expect(block).toContain("(scope === 'global' ? ' seg-on-purple' : '')");
    expect(block).not.toContain('tab-seg');
    // 보라 값은 공용 클래스가 그룹 2-b 값 그대로 담는다
    expect(css).toMatch(/\.seg-group > \.seg-item\.seg-on-purple \{\s*@apply bg-purple-600 dark:bg-purple-500 text-white;/);
    expect(block).not.toContain('purple-400/25');
    expect(block).toContain('전역 조각');
    expect(block.indexOf('</div>\n      <span className="inline-flex items-center ml-1">')).toBeGreaterThan(-1);
  });
});

// 2026-11-23: PC 는 이미지 크기 슬라이더로 바뀜(검사 sizeSlider) — 이 단추는 모바일 전용으로 남고 색·크기·평소 흐림은 그대로.
describe('⑤ 이미지 그리드 크기 단추(모바일)', () => {
  test('색 = 상태 토큰(back-sky 선택·back-gray 미선택), 자리·크기·평소 흐림은 그대로', () => {
    const src = read('ResultViewer.tsx');
    expect(src).toContain("${imageSize === index ? 'back-sky' : 'back-gray'}");
    expect(src).not.toContain("imageSize === index ? 'bg-gray-600' : 'bg-gray-400'");
    expect(src).toContain('className={`w-8 h-8 hover:brightness-95 active:brightness-90 cursor-pointer');
    expect(src).toContain('right-0 opacity-30 hover:opacity-100 transition-opacity flex'); // 그룹 3-b: transition-all → transition-opacity
  });
});
