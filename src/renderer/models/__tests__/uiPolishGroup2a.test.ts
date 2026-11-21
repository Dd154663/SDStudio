// UI 정돈 그룹 2-a(2026-11-21, 사용자 승인 목업) 회귀 검사 — 소스 검사형(전역 CSS·큰 컴포넌트라 렌더 대신).
// ① 마우스 올림 표시 = 덮개 토큰 --c-hover ② 입력 중인 칸 = --c-focus-ring ③ 남은 작은 어긋남.
import * as fs from 'fs';
import * as path from 'path';

const COMP = path.resolve(__dirname, '../../componenets');
const read = (f: string) => fs.readFileSync(path.join(COMP, f), 'utf8').replace(/\r\n/g, '\n');
const css = read('App.css');
const tsxFiles = fs.readdirSync(COMP).filter((f) => f.endsWith('.tsx'));

describe('① 마우스 올림 덮개 --c-hover', () => {
  test('.btn-ghost: hover 는 마우스 환경에서만 덮개, 누르는 동안도 덮개 — 종전 gray-100/slate-700 없음', () => {
    expect(css).toMatch(/\.btn-ghost \{\s*@apply transition-colors;\s*\}/);
    expect(css).toMatch(/@media \(hover: hover\) \{\s*\.btn-ghost:hover \{\s*background-color: var\(--c-hover\);/);
    expect(css).toMatch(/\.btn-ghost:active \{\s*background-color: var\(--c-hover\);/);
    expect(css).not.toContain('hover:bg-gray-100 dark:hover:bg-slate-700;');
  });
  test('무배경 .icon-button 만 덮개(back-*·btn-solid-*·bg-* 제외), 밝기·누름 방식은 그대로', () => {
    expect(css).toMatch(
      /@media \(hover: hover\) \{\s*\.icon-button:not\(\[class\*="back-"\]\):not\(\[class\*="btn-solid-"\]\):not\(\[class\*="bg-"\]\):hover \{\s*background-color: var\(--c-hover\);/,
    );
    expect(css).toContain('@apply active:brightness-90 hover:brightness-95 select-none whitespace-nowrap p-1;');
  });
  test('.hover-row 정의 + 목록 줄 11곳 교체(종전 gray-50/slate-700/50 리터럴 없음)', () => {
    expect(css).toMatch(/@media \(hover: hover\) \{\s*\.hover-row:hover \{\s*background-color: var\(--c-hover\);/);
    expect(css).toMatch(/\.hover-row:active \{\s*background-color: var\(--c-hover\);/);
    let n = 0;
    for (const f of tsxFiles) {
      const src = read(f);
      expect(src).not.toContain('hover:bg-gray-50');
      n += (src.match(/\bhover-row\b/g) || []).length;
    }
    // 그룹 2-d: 조각 그룹 목록(PieceEditor)의 선택 안 된 줄도 .hover-row(종전 hover:bg-gray-100) — 12곳
    expect(n).toBe(12);
  });
  test('선택 바탕이 있는 줄은 선택되지 않았을 때만 hover-row', () => {
    expect(read('ExportPresetManager.tsx')).toMatch(/: 'hover-row'/);
    expect(read('TemplateManagerModal.tsx')).toMatch(/: 'hover-row'/);
  });
  test('같은 값 리터럴(black/5·white/10) 덮개가 토큰으로', () => {
    expect(css).toMatch(/\.setting-icon-btn:hover \{\s*background-color: var\(--c-hover\);/);
    expect(css).not.toMatch(/rgb\(0 0 0 \/ 0\.05\)[^;]*;\s*color: var\(--c-text\)/);
    for (const f of tsxFiles) {
      expect(read(f)).not.toContain('hover:bg-black/5');
    }
    expect(read('PreSetEdtior.tsx')).toContain('transition-colors hover:bg-[var(--c-hover)] active:bg-black/10');
  });
  test('창 닫기 ✕ 상수와 같은 모양 ✕ 의 hover = 덮개', () => {
    expect(read('ModalOverlay.tsx')).toContain(
      "'p-1 rounded hover:bg-[var(--c-hover)] text-muted transition-colors'",
    );
    for (const f of ['ModalOverlay.tsx', 'ConfigScreen.tsx', 'ExternalImageView.tsx', 'ProjectDrawer.tsx', 'SceneQuickPromptModal.tsx']) {
      expect(read(f)).not.toContain('hover:bg-gray-200 dark:hover:bg-slate-600');
    }
  });
  test('체크 줄·스위치 줄 비활성은 누를 때도 덮개 없음', () => {
    expect(css).toMatch(/\.setting-check-row\[data-disabled\]:hover,\s*\.setting-check-row\[data-disabled\]:active \{\s*background-color: transparent;/);
    expect(css).toMatch(/\.setting-switch-row\[data-disabled\]:hover,\s*\.setting-switch-row\[data-disabled\]:active \{\s*background-color: transparent;/);
  });
});

describe('② 입력 중인 칸 표시', () => {
  test('componenets/*.tsx 에 focus:ring-sky-400 리터럴이 남지 않음(전수) — 토큰 링', () => {
    let tokens = 0;
    for (const f of tsxFiles) {
      const src = read(f);
      expect(src).not.toContain('focus:ring-sky-400');
      tokens += (src.match(/focus:ring-\[color:var\(--c-focus-ring\)\]/g) || []).length;
    }
    expect(tokens).toBeGreaterThanOrEqual(26);
  });
  test('프롬프트 편집 칸: 입력 중이면 같은 1px 링 색만 --c-focus-ring(클래식 마감 제외, 전체 화면은 input-ring 없음)', () => {
    expect(css).toMatch(
      /html:not\(\.finish-classic\) \.input-ring\.prompt-edit-ring:focus-within \{\s*box-shadow: inset 0 0 0 1px var\(--c-focus-ring\);\s*\}/,
    );
    const src = read('PromptEditTextArea.tsx');
    expect(src).toContain("' input-ring prompt-edit-ring overflow-hidden h-full relative rounded-md'");
    expect(src).toContain("' left-0 m-4 p-2 overflow-hidden fixed z-[var(--z-prompt-popup)] h-96 prompt-full rounded-lg'");
  });
});

describe('③ 남은 작은 어긋남', () => {
  test('서랍 이름 변경 중 별 칸: 인라인 #e0f2fe 대신 테마 토큰 바탕', () => {
    const src = read('ProjectDrawer.tsx');
    expect(src).not.toContain("backgroundColor: '#e0f2fe'");
    expect(src).toContain('rounded-md flex-none bg-[var(--c-surface)]"');
  });
  test('진행 창 막대: 다크 채움 indigo → sky(라이트 600·다크 500), 모양 그대로', () => {
    const src = read('ProgressWindow.tsx');
    expect(src).toContain('absolute top-0 left-0 h-8 bg-sky-600 dark:bg-sky-500');
    expect(src).not.toContain('indigo');
  });
  test('전체 화면 보기 「뒤로」 ✕: 레거시 .button 자리 그대로 + hover 덮개·focus-visible 링', () => {
    const src = read('FloatView.tsx');
    expect(src).toMatch(/className="text-default button rounded hover:bg-\[var\(--c-hover\)\] focus-visible:outline[^"]*focus-visible:outline-\[color:var\(--c-focus-ring\)\]"/);
    expect(src).toContain('<FaTimes size={20} />');
  });
  test('환경설정 탭 선택 글자: 라이트 --c-link, 다크 종전 sky-400 유지', () => {
    const src = read('ConfigScreen.tsx');
    expect(src).not.toContain('text-sky-600');
    expect(src).toContain("'bg-sky-50 dark:bg-sky-900/30 text-[color:var(--c-link)] dark:text-sky-400'");
    expect(src).toContain("'border-sky-500 text-[color:var(--c-link)] dark:text-sky-400'");
  });
  test('작가 라이브러리 선택 칩 글자: sky-500 → --c-link(칩 모양·다크 바탕 짝 그대로)', () => {
    const src = read('ArtistLibraryTab.tsx');
    expect(src).toContain("'border-sky-500 text-[color:var(--c-link)] bg-sky-100 dark:bg-sky-900/40'");
    expect(src).not.toContain('text-sky-500 bg-sky-100');
  });
  test('아이콘만 버튼에 text-faint 없음(SPEC §2 R2)', () => {
    expect(read('TemplateManagerModal.tsx')).toContain("const iconBtnCls = 'btn-ghost p-1.5 rounded-md text-muted';");
    for (const f of tsxFiles) {
      expect(read(f)).not.toMatch(/(btn-ghost|icon-button)[^"'`]*\btext-faint\b/);
    }
    expect(read('CharacterPresetEditor.tsx')).toContain('className="text-muted hover:text-gray-800 dark:hover:text-gray-200 px-0.5"');
    const pb = read('ProjectBrowser.tsx');
    expect(pb).toContain('className="flex-none text-muted hover:text-gray-800 dark:hover:text-gray-200 px-0.5"');
    expect(pb).toContain('className="text-muted hover:text-gray-800 dark:hover:text-gray-200 px-0.5"');
  });
});
