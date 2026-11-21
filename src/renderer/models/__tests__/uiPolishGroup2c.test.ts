// UI 정돈 그룹 2-c(2026-11-21, 사용자 승인 목업) 회귀 검사 — 소스 검사형(전역 CSS·큰 컴포넌트라 렌더 대신).
// 「화면을 바꾸는 작업 탭」과 「값 하나 고르기(택일)」가 같은 알약 묶음(.tab-seg)이던 것을 나눈다:
// 작업 탭 = 밑줄 탭(.tab-line), 택일 = 붙은 사각 묶음(.seg-group). 모바일 주 탭(아이콘 탭, SPEC §6-5)은 그대로.
import * as fs from 'fs';
import * as path from 'path';

const COMP = path.resolve(__dirname, '../../componenets');
const read = (f: string) => fs.readFileSync(path.join(COMP, f), 'utf8').replace(/\r\n/g, '\n');
const css = read('App.css');

const block = (selector: string) => {
  const re = new RegExp(`(^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`);
  const m = re.exec(css);
  if (!m) throw new Error(`블록 없음: ${selector}`);
  return m[2];
};

describe('공용 클래스 CSS 값', () => {
  test('두 공용 클래스는 @layer components 안(컨테이너 display 는 사용처 유틸이 이김)', () => {
    const start = css.indexOf('.tab-line {');
    const layerStart = css.lastIndexOf('@layer components {', start);
    expect(layerStart).toBeGreaterThan(-1);
    expect(css.indexOf('.seg-group {')).toBeGreaterThan(start);
    // 공용 클래스 본문에 display 를 두지 않는다(hidden md:flex 같은 유틸과 다투지 않게)
    expect(block('.tab-line')).not.toMatch(/display:/);
    expect(block('.seg-group')).not.toMatch(/display:/);
  });

  test('밑줄 탭: 글자만, 고른 탭 = --c-text·700·아래 3px --c-focus-ring, 나머지 = --c-text-faint·500, 줄 아래 1px --c-line', () => {
    const line = block('.tab-line');
    expect(line).toMatch(/gap: 4px;/);
    expect(line).toMatch(/box-shadow: inset 0 -1px 0 var\(--c-line\);/);
    expect(line).not.toMatch(/background/);
    const item = block('.tab-line > .tab-line-item');
    expect(item).toMatch(/height: 2\.25rem;/);
    expect(item).toMatch(/padding: 0 12px;/);
    expect(item).toMatch(/background-color: transparent;/);
    expect(item).toMatch(/color: var\(--c-text-faint\);/);
    expect(item).toMatch(/font-weight: 500;/);
    const on = block('.tab-line > .tab-line-item.tab-line-on');
    expect(on).toMatch(/color: var\(--c-text\);/);
    expect(on).toMatch(/font-weight: 700;/);
    expect(on).toMatch(/box-shadow: inset 0 -3px 0 var\(--c-focus-ring\);/);
    expect(css).toMatch(/@media \(hover: hover\) \{\s*\.tab-line > \.tab-line-item:not\(\.tab-line-on\):hover \{\s*color: var\(--c-text-label\);/);
    expect(block('.tab-line > .tab-line-item:focus-visible')).toMatch(/outline: 2px solid var\(--c-focus-ring\);/);
    expect(block('.tab-line.tab-line-bare')).toMatch(/box-shadow: none;/);
    expect(block('.tab-line.tab-line-compact > .tab-line-item')).toMatch(/height: 2rem;/);
  });

  test('택일 묶음: 1px --c-line-strong 테두리·구분선, 모서리 7px, 바탕 --c-input-bg, 넘침 숨김', () => {
    const g = block('.seg-group');
    expect(g).toMatch(/border: 1px solid var\(--c-line-strong\);/);
    expect(g).toMatch(/border-radius: 7px;/);
    expect(g).toMatch(/background-color: var\(--c-input-bg\);/);
    expect(g).toMatch(/overflow: hidden;/);
    expect(block('.seg-group > .seg-item + .seg-item')).toMatch(/border-left: 1px solid var\(--c-line-strong\);/);
    const item = block('.seg-group > .seg-item');
    expect(item).toMatch(/color: var\(--c-text-label\);/);
    expect(item).toMatch(/min-width: 44px;/);
    expect(item).toMatch(/min-height: 2rem;/);
    expect(item).toMatch(/padding: 0 12px;/);
  });

  test('고른 칸 = --c-sky-bg·--c-sky-fg·600, 뜻이 다른 선택 = 솔리드 보라 + 흰 글자, 올림 = --c-hover, 비활성 흐림', () => {
    const on = block('.seg-group > .seg-item.seg-on');
    expect(on).toMatch(/background-color: var\(--c-sky-bg\);/);
    expect(on).toMatch(/color: var\(--c-sky-fg\);/);
    expect(on).toMatch(/font-weight: 600;/);
    expect(block('.seg-group > .seg-item.seg-on-purple')).toMatch(/@apply bg-purple-600 dark:bg-purple-500 text-white;\s*font-weight: 600;/);
    expect(css).toMatch(
      /@media \(hover: hover\) \{\s*\.seg-group > \.seg-item:not\(\.seg-on\):not\(\.seg-on-purple\):not\(:disabled\):hover \{\s*background-color: var\(--c-hover\);/,
    );
    expect(block('.seg-group > .seg-item:disabled')).toMatch(/opacity: 0\.5;/);
    expect(block('.seg-group > .seg-item:focus-visible')).toMatch(/outline: 2px solid var\(--c-focus-ring\);/);
  });

  test('높이 세 단계(기본 32·큰 것 36·작은 것 28), 모바일은 작은 것이 아니면 36px', () => {
    expect(block('.seg-group.seg-lg > .seg-item')).toMatch(/min-height: 2\.25rem;/);
    expect(block('.seg-group.seg-sm > .seg-item')).toMatch(/min-height: 1\.75rem;/);
    expect(css).toMatch(/@media \(max-width: 767px\) \{\s*\.seg-group:not\(\.seg-sm\) > \.seg-item \{\s*min-height: 36px;/);
    expect(block('.seg-group.seg-fill > .seg-item')).toMatch(/flex: 1 1 0;\s*min-width: 0;/);
  });

  test('색은 토큰만(보라 = 그룹 2-b 값 그대로) — 두 블록 안에 # 색 리터럴 없음', () => {
    const start = css.indexOf('.tab-line {');
    const end = css.indexOf('.seg-group > .seg-item:focus-visible', start);
    expect(css.slice(start, end)).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });
});

// 자리 분류표(보고서 g2c-report.md 와 같은 순서). marker = 그 자리에 있어야 하는 소스 조각.
const TAB_SITES: [string, string][] = [
  ['UtilComponents.tsx', 'className="tab-line md:flex w-full max-w-full min-w-0 overflow-x-auto no-scrollbar hidden"'],
  ['UtilComponents.tsx', "'tab-line-item text-sm' + (index === activeTab ? ' tab-line-on' : '')"],
  ['TemplateManagerModal.tsx', 'className="tab-line tab-line-bare tab-line-compact flex" data-template-tabs=""'],
  ['TemplateManagerModal.tsx', "'tab-line-item text-sm' + (tab === key ? ' tab-line-on' : '')"],
];
const SEG_SITES: [string, string][] = [
  ['ModelFamilySwitch.tsx', "'seg-group flex ' + (compact ? 'seg-sm' : 'seg-lg')"],
  ['ArtistTagModal.tsx', "'seg-group seg-sm flex' + (stretch ? ' seg-fill' : '')"],
  ['ArtistLibraryTab.tsx', 'className="seg-group seg-lg flex text-sm" role="group" aria-label="모델 계열 보기"'],
  ['TemplateManagerModal.tsx', 'className="seg-group seg-sm inline-flex flex-wrap"'],
  ['SceneEditor.tsx', 'className="seg-group seg-fill flex flex-1 min-w-0"'],
  ['SceneEditor.tsx', '<div className="seg-group inline-flex">\n            {modeButton(\'base\', \'기본만\')}'],
  ['CharacterPositionOverlay.tsx', 'className="seg-group flex flex-none"'],
  ['CharacterPresetEditor.tsx', 'className="seg-group seg-fill flex" role="group" aria-label="프리셋 보기"'],
  ['PieceEditor.tsx', "'seg-group seg-fill flex flex-1 min-w-0' : 'seg-group inline-flex'"],
  ['ConfigThemeTab.tsx', '<div className="seg-group inline-flex">'],
];

describe('자리 분류표 — 각 자리가 맞는 클래스를 쓴다', () => {
  test.each(TAB_SITES)('작업 탭 %s', (f, marker) => {
    expect(read(f)).toContain(marker);
  });
  test.each(SEG_SITES)('택일 %s', (f, marker) => {
    expect(read(f)).toContain(marker);
  });

  test('택일 자리 파일에는 .tab-seg·.tab-seg-off 가 남지 않음', () => {
    const files = Array.from(new Set(SEG_SITES.map(([f]) => f)));
    for (const f of files) {
      expect([f, /\btab-seg(-off)?\b/.test(read(f).replace(/\/\/.*$/gm, ''))]).toEqual([f, false]);
    }
  });

  test('택일 칸에 종전 선택 표시(back-sky·btn-ghost·solid 리터럴)가 섞이지 않음', () => {
    expect(read('ModelFamilySwitch.tsx')).toContain("className={btn + (selected ? ' seg-on' : '')}");
    expect(read('ArtistLibraryTab.tsx')).toContain("className={'seg-item' + (familyView === v ? ' seg-on' : '')}");
    expect(read('ArtistTagModal.tsx')).not.toContain("'bg-sky-600 text-white dark:bg-sky-500'");
    const scene = read('SceneEditor.tsx');
    expect(scene).toContain("className={'seg-item text-sm' + (mode === value ? ' seg-on' : '')}");
    expect(scene).not.toContain("mode === value ? 'btn-solid-sky' : 'btn-neutral'");
  });

  test('문구·칸 수·aria 는 그대로', () => {
    const scene = read('SceneEditor.tsx');
    expect(scene).toContain("{modeButton('mix', '역할 혼합')}");
    expect(scene).toContain("['scene', '씬 전용']");
    expect(read('CharacterPositionOverlay.tsx')).toContain('aria-pressed={guide === g.key}');
    expect(read('ModelFamilySwitch.tsx')).toContain('aria-pressed={selected}');
    expect(read('TemplateManagerModal.tsx')).toContain('aria-pressed={tab === key}');
    expect(read('ConfigThemeTab.tsx')).toContain('밝은 배경용 (검은 텍스트)');
  });
});

describe('모바일 주 탭(아이콘 탭)은 그대로', () => {
  test('TabComponent 모바일 줄 = .tab-seg + 미선택 back-llgray tab-seg-off, h-10/h-9', () => {
    const src = read('UtilComponents.tsx');
    expect(src).toContain('className={`tab-seg flex gap-1 ml-auto overflow-x-auto no-scrollbar py-0.5 ${');
    expect(src).toContain("(wideTabs ? 'flex-1 basis-0 min-w-0 h-9 ' : 'h-10 flex-none ')");
    expect(src).toContain("(index === activeTab ? `back-sky` : 'back-llgray tab-seg-off')");
    // .tab-seg 규칙은 남은 사용처(모바일 주 탭)가 있어 유지
    expect(css).toContain('html:not(.finish-classic) .tab-seg {');
    expect(css).toContain('html:not(.finish-classic) .tab-seg > .tab-seg-off {');
  });
  test('.tab-seg 사용처는 모바일 주 탭 한 곳뿐', () => {
    const files = fs.readdirSync(COMP).filter((f) => f.endsWith('.tsx'));
    const users = files.filter((f) => /className=\{?[`'"][^`'"]*\btab-seg\b/.test(read(f)));
    expect(users).toEqual(['UtilComponents.tsx']);
    expect(read('UtilComponents.tsx').match(/className=\{?[`'"]tab-seg\b/g)).toHaveLength(1);
  });
});
