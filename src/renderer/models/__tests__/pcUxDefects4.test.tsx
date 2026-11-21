// PC UI/UX 「명백한 결함」 묶음 4(2026-11-16, 원색 배경 위 흰 글자 — 사용자 결정 안 B) 회귀 검사.
// 소스 검사: 라이트 상태색 토큰 600 단계(초록·하늘·빨강·주황), 노랑·회색·보라 토큰과 .dark·.true-dark 블록 불변,
// .btn-solid-* 6종 라이트 600/hover 700 + 다크 500/hover 600 짝(노랑 불변), .back-llgray gray-500,
// 예약 수 배지(D3) 불변, 하드코딩 bg-{색}-500 잔존이 제외 목록(글자 없는 막대·점, 이미지 위 오버레이 등)과 일치,
// CharacterPresetCards 카드 위 원형 버튼 아이콘 14(R2 잔여).
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const COMP = path.join(ROOT, 'componenets');
const read = (f: string) => fs.readFileSync(path.join(COMP, f), 'utf8');
const css = read('App.css');

const block = (selector: string) => {
  const re = new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([\\s\\S]*?)\\n\\}`);
  const m = re.exec(css);
  if (!m) throw new Error(`블록 없음: ${selector}`);
  return m[2];
};
// App.css 에는 :root 블록이 여럿(z-index 사다리 등) — 색 토큰을 가진 블록을 고른다.
const rootBlock = () => {
  const all = [...css.matchAll(/(^|\n):root\s*\{([\s\S]*?)\n\}/g)].map((m) => m[2]);
  const hit = all.filter((b) => b.includes('--c-green-bg'));
  if (hit.length !== 1) throw new Error(`색 토큰 :root 블록 ${hit.length}개`);
  return hit[0];
};

describe('D1 라이트 상태색 토큰 600 단계', () => {
  test.each([
    ['green', '#16a34a'],
    ['sky', '#0284c7'],
    ['red', '#dc2626'],
    ['orange', '#ea580c'],
  ])('--c-%s-bg = %s, fg 흰색', (name, hex) => {
    const root = rootBlock();
    expect(root).toMatch(new RegExp(`--c-${name}-bg:\\s*${hex};`));
    expect(root).toMatch(new RegExp(`--c-${name}-fg:\\s*#ffffff;`));
  });
  test('회색·노랑(보류)·보라(막대 전용) 토큰은 그대로', () => {
    const root = rootBlock();
    expect(root).toMatch(/--c-gray-bg:\s*#6b7280;/);
    expect(root).toMatch(/--c-yellow-bg:\s*#eab308;\s*--c-yellow-fg:\s*#ffffff;/);
    expect(root).toMatch(/--c-purple-bg:\s*#a855f7;\s*--c-purple-fg:\s*#ffffff;/);
  });
  test('다크 .dark 상태색은 종전 반투명 값 그대로, 트루다크는 상태색을 재정의하지 않음', () => {
    const dark = block('.dark');
    expect(dark).toContain('--c-green-bg: rgba(45, 212, 191, 0.25);  --c-green-fg: #2dd4bf;');
    expect(dark).toContain('--c-sky-bg: rgba(56, 189, 248, 0.25);    --c-sky-fg: #38bdf8;');
    expect(dark).toContain('--c-red-bg: rgba(248, 113, 113, 0.25);   --c-red-fg: #f87171;');
    expect(dark).toContain('--c-gray-bg: rgba(156, 163, 175, 0.25);  --c-gray-fg: #e5e7eb;');
    expect(dark).toContain('--c-orange-bg: rgba(251, 146, 60, 0.25); --c-orange-fg: #fed7aa;');
    expect(dark).toContain('--c-yellow-bg: rgba(129, 140, 248, 0.25); --c-yellow-fg: #818cf8;');
    expect(dark).toContain('--c-purple-bg: rgba(192, 132, 252, 0.25); --c-purple-fg: #c084fc;');
    expect(block('.true-dark')).not.toMatch(/--c-(green|sky|red|gray|orange|yellow|purple)-(bg|fg)/);
  });
});

describe('D2 .btn-solid-*', () => {
  test.each(['sky', 'green', 'red', 'orange', 'indigo', 'purple'])(
    '.btn-solid-%s 라이트 600/hover 700 · 다크 500/hover 600 · 흰 글자',
    (c) => {
      expect(css).toContain(
        `.btn-solid-${c} { @apply bg-${c}-600 hover:bg-${c}-700 dark:bg-${c}-500 dark:hover:bg-${c}-600 text-white; }`,
      );
    },
  );
  test('.btn-solid-yellow 는 종전 그대로(노랑 보류)', () => {
    expect(css).toContain('.btn-solid-yellow { @apply bg-yellow-500 hover:bg-yellow-600 text-white; }');
  });
  test('하드코딩이던 버튼 → .btn-solid-*', () => {
    const artist = read('ArtistLibraryTab.tsx');
    expect(artist.match(/icon-button btn-solid-red !rounded-md/g)).toHaveLength(2);
    expect(artist).not.toContain('bg-red-500');
    expect(read('CharacterPresetEditor.tsx')).toContain("globalView ? 'btn-solid-purple' : 'btn-solid-green'");
  });
});

describe('D1 .back-llgray', () => {
  test('라이트 gray-500 흰 글자, 다크 값 그대로', () => {
    expect(block('.back-llgray')).toMatch(/@apply bg-gray-500 text-white dark:bg-gray-400\/25 dark:text-gray-200;/);
  });
});

describe('제외·보류 항목 불변', () => {
  test('D3 예약 수 배지(노랑) 흰 글자 그대로', () => {
    const src = read('SceneQueueControl.tsx');
    expect(src.match(/bg-yellow-400 dark:bg-indigo-400[^"]*text-white/g)).toHaveLength(2);
  });
  test('카드 원형 버튼의 노랑(캐릭터 프롬프트 적용)은 btn-solid-yellow 그대로', () => {
    expect(read('CharacterPresetCards.tsx').match(/btn-solid-yellow/g)).toHaveLength(2);
  });
});

describe('하드코딩 bg-{색}-500 잔존 = 제외 목록', () => {
  // 글자 없는 막대·점·미리보기 도형, 이미지 위 오버레이(체크·기본 표시·씬 카드 오버레이 버튼), 흰 글자 아닌 오류 상자.
  const EXPECTED: Record<string, number> = {
    'componenets/App.tsx': 1, // 진행 막대
    'componenets/ArtistTagModal.tsx': 1, // 진행 막대
    'componenets/BatchCreateModal.tsx': 1, // 진행 막대
    'componenets/CharacterPresetCards.tsx': 1, // 카드 이미지 위 순차 선택 체크
    'componenets/CharacterPresetEditor.tsx': 2, // 진행 막대 + 카드 이미지 위 선택 체크
    'componenets/ConfigLayoutTab.tsx': 8, // 배치 미리보기 도형
    'componenets/GlobalPresetPicker.tsx': 1, // 썸네일 위 기본 표시
    'componenets/GlobalPresetTab.tsx': 1, // 썸네일 위 기본 표시
    'componenets/MigrationGate.tsx': 2, // 진행 막대
    'componenets/ProjectBrowser.tsx': 1, // 썸네일 위 선택 체크
    'componenets/ResultViewer.tsx': 2, // 이미지 위 선택 덮개(반투명)
    'componenets/SceneEditor.tsx': 2, // 열 표시 점 + 미리보기 오류 상자(흰 글자 아님)
    'componenets/SceneQueueControl.tsx': 2, // 씬 카드 이미지 위 오버레이 버튼(초록·주황)
    'componenets/StorageManageModal.tsx': 2, // 사용량 막대
  };
  const RE = /(^|[^:a-z-])bg-(sky|green|red|orange|purple|indigo|emerald|blue|teal)-500(?![/0-9])/g;
  const walk = (dir: string, out: string[] = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === '__tests__' || e.name === 'node_modules') continue;
        walk(p, out);
      } else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
    }
    return out;
  };
  test('파일별 건수 정확 일치', () => {
    const got: Record<string, number> = {};
    for (const f of walk(ROOT)) {
      const n = (fs.readFileSync(f, 'utf8').match(RE) ?? []).length;
      if (n) got[path.relative(ROOT, f).split(path.sep).join('/')] = n;
    }
    expect(got).toEqual(EXPECTED);
  });
  test('바뀐 선택·강조 자리는 라이트 600 + 다크 500 짝', () => {
    expect(read('ProjectBrowser.tsx')).toContain("'bg-sky-600 text-white dark:bg-sky-500'");
    expect(read('ProjectDrawer.tsx')).toContain("'bg-sky-600 text-white dark:bg-sky-500 shadow-sm'");
    expect(read('ProjectDrawer.tsx')).toContain("'bg-emerald-600 text-white dark:bg-emerald-500'");
    expect(read('CharacterPresetCards.tsx').match(/'bg-purple-600 text-white dark:bg-purple-500'/g)).toHaveLength(3);
    expect(read('PieceEditor.tsx')).toContain("'bg-purple-600 text-white dark:bg-purple-400/25 dark:text-purple-300 font-bold'");
    expect(read('SceneEditor.tsx')).toContain('bg-red-600 text-white dark:bg-red-500 rounded-full w-4 h-4');
    expect(read('TaskQueueControl.tsx')).toContain("'bg-sky-600 dark:bg-indigo-400' : 'bg-red-600 dark:bg-red-500'");
    // 그룹 2-a: 진행 창 막대의 다크 채움을 indigo-400 → 다른 진행 막대와 같은 하늘색 계열(sky-500, 흰 글자 다크 500 규칙)
    expect(read('ProgressWindow.tsx')).toContain('h-8 bg-sky-600 dark:bg-sky-500');
  });
});

describe('R2 잔여 — 캐릭터 프리셋 카드 위 원형 버튼 아이콘 14', () => {
  test('w-8 h-8 원형 버튼 안 아이콘은 모두 size 14', () => {
    const src = read('CharacterPresetCards.tsx');
    const buttons = src.match(/className="w-8 h-8 rounded-full btn-solid-[a-z]+[^"]*"[\s\S]*?<\/button>/g) ?? [];
    expect(buttons.length).toBe(11);
    for (const b of buttons) {
      const sizes = [...b.matchAll(/size=\{(\d+)\}/g)].map((m) => Number(m[1]));
      expect(sizes).toEqual([14]);
    }
  });
});
