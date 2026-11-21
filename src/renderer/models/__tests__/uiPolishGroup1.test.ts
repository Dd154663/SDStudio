// UI 정돈 그룹 1(2026-11-20, 사용자 승인 목업) 회귀 검사 — 소스 검사형(전역 CSS·큰 컴포넌트라 렌더 대신).
// ① 드롭다운 목록 포털 대상·메뉴/옵션 선택자와 토큰 ② 덮개 토큰 --c-hover ③ body 포털 두 곳 → 테마 루트
// ④ 솔리드 버튼 비활성 공용 규칙(자리별 색 바꾸기 제거) ⑤ 흐려 안 보이던 세 자리.
import * as fs from 'fs';
import * as path from 'path';

const COMP = path.resolve(__dirname, '../../componenets');
const read = (f: string) => fs.readFileSync(path.join(COMP, f), 'utf8').replace(/\r\n/g, '\n');
const css = read('App.css');

// 선택자 한 줄(쉼표 묶음의 마지막 줄)로 시작하는 규칙 본문
const block = (selector: string) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`${esc}\\s*\\{([^}]*)\\}`).exec(css);
  if (!m) throw new Error(`블록 없음: ${selector}`);
  return m[1];
};

describe('① 드롭다운 목록(react-select)', () => {
  const src = read('UtilComponents.tsx');
  test('목록은 앱 테마 루트로 포털(body 아님)·층은 --z-tooltip 그대로', () => {
    expect(src).toContain("import { themePortalRoot } from './themePortal';");
    expect(src).toContain('menuPortalTarget={themePortalRoot()}');
    expect(src).not.toContain('menuPortalTarget={document.body}');
    expect(src).toContain("zIndex: 'var(--z-tooltip)'");
  });
  test('메뉴 규칙은 포털 감싸개 후손에도 걸린다 — 바탕 input-bg·테두리 2px line·글자 input-text', () => {
    expect(css).toMatch(
      /\.my-react-select__menu-portal \.my-react-select__menu,\s*\n\s*\.my-react-select-container \.my-react-select__menu \{/,
    );
    const b = block('.my-react-select-container .my-react-select__menu');
    expect(b).toContain('background-color: var(--c-input-bg);');
    expect(b).toContain('border: 2px solid var(--c-line);');
    expect(b).toContain('color: var(--c-input-text);');
  });
  test('옵션: 기본·초점(덮개)·선택(sky 쌍·600)·:active 까지 덮어 기본 파랑이 남지 않는다', () => {
    const base = block('.my-react-select__menu .my-react-select__option');
    expect(base).toContain('background-color: var(--c-input-bg);');
    expect(base).toContain('color: var(--c-input-text);');
    expect(css).toMatch(
      /\.my-react-select__menu \.my-react-select__option:active,\s*\n\s*\.my-react-select__menu \.my-react-select__option\.my-react-select__option--is-focused \{\s*background-color: var\(--c-hover\);/,
    );
    const sel = block('.my-react-select__menu .my-react-select__option.my-react-select__option--is-selected:active');
    expect(css).toMatch(
      /\.my-react-select__option\.my-react-select__option--is-selected,\s*\n\s*\.my-react-select__menu \.my-react-select__option\.my-react-select__option--is-selected:active \{/,
    );
    expect(sel).toContain('background-color: var(--c-sky-bg);');
    expect(sel).toContain('color: var(--c-sky-fg);');
    expect(sel).toContain('font-weight: 600;');
    // 선택 규칙이 초점 규칙보다 뒤(같은 특이도에서 선택이 이김)
    expect(css.indexOf('--is-selected:active')).toBeGreaterThan(css.indexOf('option--is-focused {'));
    // 종전 hover 색은 덮개로 대체
    expect(css).not.toContain('hover:bg-slate-200 dark:hover:bg-slate-800');
  });
  test('목록 규칙은 @layer components 밖(층 안이면 소스에 클래스 글자가 없을 때 Tailwind 가 빌드에서 뺀다)', () => {
    // 같은 react-select 컨트롤 규칙이 든 층 블록의 끝(마지막 @apply 규칙 뒤의 닫는 중괄호) 다음에 와야 한다.
    const layerEnd = css.indexOf('@apply text-[var(--c-input-text)];\n  }\n}\n');
    expect(layerEnd).toBeGreaterThan(-1);
    expect(css.indexOf('.my-react-select__menu-portal .my-react-select__menu,')).toBeGreaterThan(layerEnd);
    expect(css.indexOf('\n.my-react-select__menu .my-react-select__option {')).toBeGreaterThan(layerEnd);
  });
});

describe('② 덮개 토큰 --c-hover', () => {
  test('라이트 :root 검정 5%·다크 흰 10%, 트루다크·클래식 재정의 없음', () => {
    const light = /:root \{[\s\S]*?\n\}/.exec(css.slice(css.indexOf('/* ── 시맨틱 색 토큰')))![0];
    expect(light).toContain('--c-hover: rgb(0 0 0 / 0.05);');
    const dark = /\n\.dark \{[\s\S]*?\n\}/.exec(css)![0];
    expect(dark).toContain('--c-hover: rgb(255 255 255 / 0.1);');
    expect(css.match(/--c-hover:/g)).toHaveLength(2);
  });
  test('커스텀 테마는 재정의하지 않는다', () => {
    const theme = fs.readFileSync(path.resolve(__dirname, '../uiTheme.ts'), 'utf8');
    expect(theme).not.toContain('--c-hover');
  });
});

describe('③ body 포털 두 곳 → 테마 루트', () => {
  test('이미지 검수 전체 화면', () => {
    const src = read('ImageReview.tsx');
    expect(src).toContain("import { themePortalRoot } from './themePortal';");
    expect(src).toMatch(/<\/div>,\n\s*\/\/[^\n]*\n\s*themePortalRoot\(\),\n\s*\);/);
    expect(src).not.toContain('document.body');
    expect(src).toContain('fixed inset-0 z-[var(--z-modal)]');
  });
  test('부분 일괄 예약 팝오버 — 바깥 누름·닫기 관문 그대로', () => {
    const src = read('SceneQueueMenu.tsx');
    expect(src).toContain('</div>, themePortalRoot(anchor.current))}');
    expect(src).not.toContain('document.body');
    expect(src).toContain("document.addEventListener('pointerdown', outside);");
    expect(src).toContain("backStackService.push(() => setOpen(false), { escape: 'self' })");
    expect(src).toContain('fixed z-[var(--z-widget)]');
  });
});

describe('④ 솔리드 버튼 비활성', () => {
  test('공용 비활성 규칙(opacity 0.5·not-allowed, :where 로 사용처 유틸이 이김)', () => {
    const b = block(':where([class*="btn-solid-"]):disabled');
    expect(b).toContain('opacity: 0.5;');
    expect(b).toContain('cursor: not-allowed;');
  });
  test('비활성이면 hover 에도 평소 색 — 7색 모두 정의 뒤에 고정', () => {
    const defEnd = css.indexOf('.btn-solid-purple { @apply');
    for (const c of ['sky', 'green', 'red', 'orange', 'indigo', 'purple']) {
      const rule = `.btn-solid-${c}:disabled { @apply bg-${c}-600 dark:bg-${c}-500; }`;
      expect(css).toContain(rule);
      expect(css.indexOf(rule)).toBeGreaterThan(defEnd);
    }
    expect(css).toContain('.btn-solid-yellow:disabled { @apply bg-yellow-500; }');
  });
  test('자리별 비활성 색 바꾸기(disabled:bg-gray-*) 제거', () => {
    for (const f of ['BatchInsertDialog.tsx', 'FindReplaceDialog.tsx', 'PreSetEdtior.tsx']) {
      expect(read(f)).not.toMatch(/btn-solid-\w+ disabled:bg-gray-300 dark:disabled:bg-gray-600/);
    }
    // 그룹 2-b: 바닥줄 확정 버튼은 공용 상수(ModalOverlay DIALOG_PRIMARY_BTN)
    expect(read('BatchInsertDialog.tsx')).toContain('const PRIMARY_BUTTON = DIALOG_PRIMARY_BTN;');
  });
});

describe('⑤ 흐려 안 보이던 세 자리', () => {
  test('꺼진 즐겨찾기 별 = text-faint(켜진 별 yellow-400 그대로)', () => {
    const drawer = read('ProjectDrawer.tsx');
    expect(drawer).toMatch(/isFav\s*\? 'text-yellow-400'\s*: active\s*\? 'text-sky-100'\s*: 'text-faint'/);
    const browser = read('ProjectBrowser.tsx');
    expect(browser).toContain("<FaStar className={isFav ? 'text-yellow-400' : 'text-faint'} size={15} />");
    expect(drawer + browser).not.toContain('text-gray-300 dark:text-slate-600');
  });
  test('이미 추가된 작가 태그 = text-faint + 체크 아이콘(비활성 그대로)', () => {
    const src = read('ArtistLibraryTab.tsx');
    expect(src).toContain("(has ? 'line-color text-faint' : ");
    expect(src).toContain('<button key={t} disabled={has}');
    expect(src).toMatch(/\{has \? <FaCheck size=\{10\}[^>]*\/> : '\+ '\}\{t\}/);
    expect(src).not.toContain('text-gray-300 dark:text-gray-600');
  });
  test('프롬프트 칸 「크게 편집」 = --c-icon-text·평소 0.85·hover 1', () => {
    const src = read('PromptEditTextArea.tsx');
    expect(src).toContain('className="text-[var(--c-icon-text)] opacity-[0.85] hover:opacity-100 mr-1 mt-1"');
    expect(src).not.toContain('dark:text-slate-400 dark:hover:text-slate-300 opacity-50');
  });
});
