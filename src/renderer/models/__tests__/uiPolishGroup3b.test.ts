// UI 정돈 그룹 3-b(2026-11-21, 움직임 — 자리마다) 회귀 검사 — 소스 검사형(3-a 와 같은 방식).
// 범위: 끌어 놓을 자리 표시의 크기 불변화(R11), 접기 화살표 회전 통일(R12), transition-all 좁히기(R17), 서랍 움직임 줄이기 판정(R15).
// 페이드류는 보류(2026-11-21 사용자) — 이 묶음은 opacity 전환을 새로 넣지 않는다.
import * as fs from 'fs';
import * as path from 'path';

const COMP = path.resolve(__dirname, '../../componenets');
const read = (f: string) => fs.readFileSync(path.join(COMP, f), 'utf8').replace(/\r\n/g, '\n');
const css = read('App.css');

describe('1. 끌어 놓을 자리 표시 — 테두리 굵기 대신 크기 불변 안쪽 선(R11)', () => {
  const files: [string, string[]][] = [
    ['ToolbarDnd.tsx', ["' drop-mark-top'", "' drop-mark-bottom'", "' drop-mark-left'", "' drop-mark-right'"]],
    ['ToolbarOverflowMenu.tsx', ["' drop-mark-top'", "' drop-mark-bottom'"]],
    ['PresetLayoutDnd.tsx', ["' drop-mark-top'", "' drop-mark-bottom'"]],
    ['CompanionDnd.tsx', ["' drop-mark-left'", "' drop-mark-right'"]],
  ];
  test.each(files)('%s: 테두리 굵기 클래스가 남지 않고 리터럴 drop-mark-* 를 쓴다', (f, marks) => {
    const src = read(f);
    expect(src).not.toMatch(/border-[tblr]-2 border-sky-400/);
    for (const m of marks) expect(src).toContain(m);
  });
  test('App.css: 네 방향 ::after 안쪽 그림자(--c-focus-ring), 전환 없음, @layer 밖', () => {
    const start = css.indexOf('/* 끌어 놓을 자리 표시(그룹 3-b');
    const end = css.indexOf('/* ── 움직임 줄이기 — 앱 전체 한 곳');
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const block = css.slice(start, end);
    expect(block).toMatch(/\.drop-mark-top::after \{\s*box-shadow: inset 0 2px 0 var\(--c-focus-ring\);/);
    expect(block).toMatch(/\.drop-mark-bottom::after \{\s*box-shadow: inset 0 -2px 0 var\(--c-focus-ring\);/);
    expect(block).toMatch(/\.drop-mark-left::after \{\s*box-shadow: inset 2px 0 0 var\(--c-focus-ring\);/);
    expect(block).toMatch(/\.drop-mark-right::after \{\s*box-shadow: inset -2px 0 0 var\(--c-focus-ring\);/);
    expect(block).toMatch(/pointer-events: none;/);
    const rules = block.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules).not.toMatch(/transition|animation|opacity|border-width/);
    expect(rules).not.toContain('@layer');
  });
});

describe('2. 접기 화살표 — 한 아이콘 + 펼치면 90도 회전(R12)', () => {
  // 바꿔치기: 삼항의 두 갈래에 서로 다른 셰브론
  const swap = /\?\s*\(?\s*<FaChevron(Down|Right)\b[^>]*\/>\s*\)?\s*:\s*\(?\s*<FaChevron(Down|Right)\b/;
  const rotate = /<FaChevronRight\b[^>]*?className=\{\s*'[^']*transition-transform'\s*\+[^>]*?' rotate-90'[^>]*?\/>/g;
  const files: [string, number][] = [
    ['ProjectDrawer.tsx', 3],
    ['ConfirmWindow.tsx', 1],
    ['ProjectBrowser.tsx', 1],
    ['SceneEditor.tsx', 1],
    ['PreSetEdtior.tsx', 1],
    ['CharacterPresetInnerEditor.tsx', 1],
    ['CharacterReferenceEditor.tsx', 1],
  ];
  test.each(files)('%s: Right↔Down 바꿔치기가 없고 회전 화살표 %i곳', (f, n) => {
    const src = read(f);
    expect(src).not.toMatch(swap);
    expect(src.match(rotate)?.length ?? 0).toBe(n);
    // 펼친 쪽이 rotate-90 (사전 세팅 칸만 folded 라 반대 갈래)
    expect(src).toContain('rotate-90');
  });
  test('사전 세팅 칸은 접힘(folded)일 때 회전하지 않는다', () => {
    expect(read('PreSetEdtior.tsx')).toContain("className={'transition-transform' + (folded ? '' : ' rotate-90')}");
  });
  test('이미 회전하던 자리는 그대로(해상도 선택 rotate-180)', () => {
    expect(read('ResolutionPicker.tsx')).toContain("'text-faint transition-transform' + (open ? ' rotate-180' : '')");
  });
});

describe('3. transition-all 좁히기(R17) — 레이아웃 속성은 움직이지 않게', () => {
  const files = [
    'CharacterPresetCards.tsx',
    'ProjectBrowser.tsx',
    'ResultViewer.tsx',
    'SceneEditor.tsx',
    'VibeEditor.tsx',
  ];
  test.each(files)('%s: transition-all 이 남지 않음', (f) => {
    expect(read(f)).not.toContain('transition-all');
  });
  test('자리별 좁힌 속성(hover 효과 유지)', () => {
    expect(read('CharacterPresetCards.tsx').match(/transition-\[box-shadow,opacity\] hover:shadow-lg/g)?.length).toBe(2);
    expect(read('ProjectBrowser.tsx')).toContain('transition-[filter,border-color,box-shadow,opacity] hover:brightness-95');
    expect(read('ResultViewer.tsx')).toContain('opacity-30 hover:opacity-100 transition-opacity flex');
    expect(read('SceneEditor.tsx')).toContain("transition-[border-color,background-color,opacity] ${");
    expect(read('VibeEditor.tsx')).toContain('hover:ring-2 hover:ring-sky-400 rounded transition-shadow');
  });
  test('진행 막대 채움(width 전환)은 건드리지 않음', () => {
    expect(read('ProgressIndicators.tsx')).toContain(
      "export const PROGRESS_FILL_CLASS = 'h-full bg-[var(--c-focus-ring)] rounded-full transition-all';",
    );
  });
});

describe('4. 서랍 2종 — 전역 움직임 줄이기 블록이 이미 덮음(R15, 코드 변경 없음)', () => {
  const tail = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
  test('전역 블록: 모든 요소(진행 막대·스피너 제외)에 transition-duration 1ms !important', () => {
    expect(tail).toMatch(/\*:not\(\.progress-clip-animation\):not\(\.animate-spin\),[\s\S]*transition-duration: 1ms !important;/);
  });
  test.each([
    ['ProjectDrawer.tsx', "translateX(-100%)"],
    ['ImageHistory.tsx', "translateX(100%)"],
  ])('%s: 슬라이드·배경막은 !important 없는 인라인 transition 축약형 260ms, 예외 클래스 없음, 닫힘 타이머 260', (f, hidden) => {
    const src = read(f);
    // 인라인 style 은 !important 를 쓸 수 없으므로 스타일시트의 !important 길이가 이긴다(축약형 안의 길이도 같은 속성).
    expect(src).toContain("transition: 'transform 0.26s cubic-bezier(0.4, 0, 0.2, 1)',");
    expect(src).toContain("transition: 'opacity 0.26s ease',");
    expect(src).toContain(`transform: shown ? 'translateX(0)' : '${hidden}'`);
    expect(src).not.toMatch(/progress-clip-animation|animate-spin/);
    expect(src).not.toContain('!important');
    expect(src).toContain('setTimeout(() => setRender(false), 260)');
  });
});
