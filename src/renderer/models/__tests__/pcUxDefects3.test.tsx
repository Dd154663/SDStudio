// PC UI/UX 「명백한 결함」 묶음 3(2026-11-15, 흐린 글자 토큰 — 사용자 결정 안 1) 회귀 검사.
// 소스 검사(전역 CSS·큰 파일이라 렌더 대신): D5·D6 토큰 값, D9 --c-link·.btn-link·.text-link, D7 .gray-input::placeholder,
// D8 .syntax-* 라이트 값 + :is(.dark) 짝, R2 작은 아이콘 버튼(14px 이상 + faint 미사용), 커스텀 테마 파생 계수.
import * as fs from 'fs';
import * as path from 'path';
import { buildThemeVars } from '../uiTheme';

const COMP = path.resolve(__dirname, '../../componenets');
const read = (f: string) => fs.readFileSync(path.join(COMP, f), 'utf8');
const css = read('App.css');

const block = (selector: string) => {
  const re = new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([\\s\\S]*?)\\n\\}`);
  const m = re.exec(css);
  if (!m) throw new Error(`블록 없음: ${selector}`);
  return m[2];
};

describe('D5·D6 글자 토큰 한 단계 진하게', () => {
  test('라이트 :root — muted gray-600 · faint gray-500 (정의는 :root·.dark 두 곳뿐, 순서대로)', () => {
    expect(css.match(/--c-text-muted:\s*#[0-9a-f]{6}/g)).toEqual(['--c-text-muted: #4b5563', '--c-text-muted: #d1d5db']);
    expect(css.match(/--c-text-faint:\s*#[0-9a-f]{6}/g)).toEqual([
      '--c-text-faint: #6b7280',
      '--c-text-faint: #9ca3af',
    ]);
  });
  test('다크 .dark — muted gray-300 · faint gray-400, 트루다크는 글자 토큰을 재정의하지 않음', () => {
    const dark = block('.dark');
    expect(dark).toMatch(/--c-text-muted:\s*#d1d5db/);
    expect(dark).toMatch(/--c-text-faint:\s*#9ca3af/);
    const trueDark = block('.true-dark');
    expect(trueDark).not.toMatch(/--c-text-(muted|faint)/);
  });
});

describe('D9 링크 토큰', () => {
  test('--c-link 라이트 sky-700 · 다크 sky-500, hover 한 단계 진하게', () => {
    expect(css).toMatch(/--c-link:\s*#0369a1/);
    expect(css).toMatch(/--c-link-hover:\s*#075985/);
    expect(block('.dark')).toMatch(/--c-link:\s*#0ea5e9/);
    expect(block('.dark')).toMatch(/--c-link-hover:\s*#0284c7/);
  });
  test('.btn-link·.text-link 가 토큰을 쓰고 sky-500 하드코딩이 없음', () => {
    expect(block('.btn-link')).toMatch(/color:\s*var\(--c-link\)/);
    expect(block('.btn-link:hover')).toMatch(/color:\s*var\(--c-link-hover\)/);
    expect(block('.text-link')).toMatch(/color:\s*var\(--c-link\)/);
    expect(css).not.toMatch(/\.btn-link\s*\{\s*@apply text-sky-500/);
  });
  test('링크 사용처 — 프롬프트 편집 칸 작가 칩·환경설정 링크', () => {
    expect(read('PromptEditTextArea.tsx')).toContain('border line-color text-link opacity-90');
    expect(read('ConfigScreen.tsx')).toContain('className="btn-link cursor-pointer underline"');
    const sys = read('ConfigSystemTab.tsx');
    expect(sys.match(/className="btn-link cursor-pointer"/g)?.length).toBe(2);
    expect(sys).not.toContain('text-sky-500 hover:text-sky-400 cursor-pointer');
  });
});

describe('D7 입력 안내 문구', () => {
  test('.gray-input::placeholder = --c-text-muted, placeholder:text-gray-400 제거', () => {
    expect(block('.gray-input::placeholder')).toMatch(/color:\s*var\(--c-text-muted\)/);
    expect(block('.gray-input')).not.toContain('placeholder:text-gray-400');
  });
});

describe('D8 프롬프트 문법 색', () => {
  const pairs: [string, string, string][] = [
    ['.syntax-error', '#b91c1c', '#fca5a5'],
    ['.syntax-comment', '#4b5563', '#d1d5db'],
    ['.syntax-wildcard', '#0369a1', '#38bdf8'],
    ['.syntax-multi-wildcard', '#166534', '#4ade80'],
    ['.syntax-global-wildcard', '#7e22ce', '#d8b4fe'],
    ['.syntax-global-multi-wildcard', '#6b21a8', '#e9d5ff'],
    ['.syntax-split', '#9a3412', '#fdba74'],
  ];
  test.each(pairs)('%s 라이트 %s + :is(.dark) %s', (sel, light, dark) => {
    expect(block(sel)).toMatch(new RegExp(`color:\\s*${light}`));
    expect(css).toContain(`:is(.dark) ${sel} { color: ${dark}; }`);
  });
  test('종전 흐린 값·@apply dark: 변형이 남지 않음', () => {
    for (const [sel] of pairs) {
      const b = block(sel);
      expect(b).not.toContain('@apply');
      expect(b).not.toMatch(/#ff8e38|#0ea5e9|#22c55e|#a855f7|#c084fc/);
    }
  });
  test('굵기 800 유지', () => {
    expect(block('.syntax-wildcard')).toMatch(/font-weight:\s*800/);
    expect(block('.syntax-split')).toMatch(/font-weight:\s*800/);
  });
  test('트루다크 루트는 .dark 를 함께 가진다(:is(.dark) 짝 적용 구조)', () => {
    expect(read('App.tsx')).toContain("(darkMode ? 'dark' : '') + (trueDark && darkMode ? ' true-dark' : '')");
  });
});

describe('R2 작은 아이콘 버튼 — 아이콘 14px 이상, 흐린 색 미사용', () => {
  const cases: [string, RegExp[]][] = [
    ['ExportPresetManager.tsx', [/<FaPen size=\{14\}/, /<ActionIcon id="duplicate" size=\{14\}/, /<FaTrash size=\{14\}/]],
    ['SceneTemplateManager.tsx', [/<FaCheck size=\{14\}/, /<FaTimes size=\{14\}/, /<FaPen size=\{14\}/, /<ActionIcon id="delete" size=\{14\}/]],
    ['ProjectDrawer.tsx', [/<FaFolderPlus size=\{14\}/, /<FaUnlink size=\{14\}/]],
    ['ProjectBrowser.tsx', [/<FaWindowRestore size=\{14\}/]],
    ['PresetReleaseButton.tsx', [/<FaTimes size=\{14\}/]],
    ['PreSetEdtior.tsx', [/<FaArrowUp size=\{14\}/, /<FaArrowDown size=\{14\}/]],
    ['SceneEditor.tsx', [/<FaArrowUp size=\{14\}/, /<FaArrowDown size=\{14\}/]],
    ['EmbeddedBrowser.tsx', [/<FaArrowLeft size=\{14\}/, /<FaArrowRight size=\{14\}/, /<FaRedo size=\{14\}/]],
    ['SceneQuickPromptModal.tsx', [/<FaPuzzlePiece size=\{14\}/, /<FaExpand size=\{14\}/, /<FaTimes size=\{14\}/]],
  ];
  test.each(cases)('%s', (file, res) => {
    const src = read(file);
    for (const re of res) expect(src).toMatch(re);
  });
  test('캐릭터 위/아래 이동 버튼에 11px 아이콘이 남지 않음', () => {
    for (const f of ['PreSetEdtior.tsx', 'SceneEditor.tsx']) {
      expect(read(f)).not.toMatch(/<FaArrow(Up|Down) size=\{1[0-3]\}/);
    }
  });
  test('흐린 색 아이콘 버튼이 muted 로', () => {
    expect(read('ExportPresetManager.tsx')).not.toMatch(/p-1\.5 rounded text-faint/);
    expect(read('SceneTemplateManager.tsx')).not.toContain('btn-ghost p-2 rounded-md text-faint');
    expect(read('ProjectDrawer.tsx')).not.toContain('btn-ghost p-2 rounded-md text-faint');
    expect(read('ProjectBrowser.tsx')).toContain('className="flex-none text-muted hover:text-sky-500 px-0.5"');
    const al = read('ArtistLibraryTab.tsx');
    expect(al).toContain('<button className="text-muted hover:text-red-500" aria-label={`태그 프리셋 ${t} 삭제`}');
    expect(al).not.toMatch(/<FaTrash size=\{11\} \/>/);
    const sqc = read('SceneQueueControl.tsx');
    expect(sqc).not.toContain('rounded-md clickable text-faint');
    expect(sqc).toMatch(/aria-label="검색어 지우기"[\s\S]{0,400}<FaTimes size=\{14\}/);
    expect(sqc).toMatch(/aria-label="씬 찾기·북마크 이동"[\s\S]{0,400}<FaChevronDown size=\{14\}/);
    expect(read('ConfigScreen.tsx')).toMatch(/aria-label=\{`\$\{profile\.name\} 이름 변경`\}[\s\S]{0,400}<FaPen size=\{14\}/);
    expect(read('SessionSelect.tsx')).toMatch(/이 프리셋 해제 \(연결 항목 함께 제거\)[\s\S]{0,800}<FaTimes size=\{14\}/);
  });
});

describe('커스텀 테마 파생 — 기본 테마와 같은 방향으로 한 단계 진하게', () => {
  test('밝은 패턴(흰 배경) muted #545454 · faint #737373, 링크 라이트 값', () => {
    const v = buildThemeVars({ textPattern: 'light' } as any, true);
    expect(v['--c-text-muted']).toBe('#545454');
    expect(v['--c-text-faint']).toBe('#737373');
    expect(v['--c-link']).toBe('#0369a1');
    expect(v['--c-link-hover']).toBe('#075985');
  });
  test('어두운 패턴은 링크 다크 값, 흐림이 보조보다 배경 쪽', () => {
    const v = buildThemeVars({ textPattern: 'dark' } as any, false);
    expect(v['--c-link']).toBe('#0ea5e9');
    expect(v['--c-link-hover']).toBe('#0284c7');
    const g = (h: string) => parseInt(h.slice(1, 3), 16);
    expect(g(v['--c-text-muted'])).toBeGreaterThan(g(v['--c-text-faint']));
  });
  test('텍스트 패턴이 없으면 글자·링크 토큰을 건드리지 않음(기본 테마 값 따름)', () => {
    const v = buildThemeVars({ surface: '#fdf2f8' } as any, true);
    expect(v['--c-text-muted']).toBeUndefined();
    expect(v['--c-link']).toBeUndefined();
  });
});
