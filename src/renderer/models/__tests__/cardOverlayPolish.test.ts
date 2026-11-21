// 화면 다듬기 4건(2026-11-21) 소스 검사.
// 1 환경설정 단축키 탭 붙박이 그룹 머리 — 본문 슬롯 여백 없음(bodyPadding='none' + 안쪽 p-5)이라 sticky top-0 가 스크롤 영역 맨 위에 붙는다.
// 2 캐릭터 프리셋 관리 [순차 생성 모드][선택 모드] — 라벨이 상태와 무관하게 같고 「끄기」 없음, aria-pressed.
// 3·4 글로벌 프리셋 카드·캐릭터 프리셋 카드 위 보조 버튼 = 공용 .card-overlay-btn(App.css 한 곳), 솔리드 색 없음
//     (가운데 「프로젝트로 복사」 제외), 글로벌 프리셋 탭 PC 도구줄은 한 단계 작은 규격.
import * as fs from 'fs';
import * as path from 'path';

const COMP = path.resolve(__dirname, '../../componenets');
const read = (f: string) => fs.readFileSync(path.join(COMP, f), 'utf8');
const between = (src: string, start: string, end: string) => {
  const i = src.indexOf(start);
  const j = src.indexOf(end, i + start.length);
  if (i < 0 || j < 0) throw new Error(`구간 없음: ${start} … ${end}`);
  return src.slice(i, j);
};
const count = (s: string, sub: string) => s.split(sub).length - 1;

describe('1 단축키 탭 붙박이 그룹 머리', () => {
  test('PC 환경설정 창 = bodyPadding none + 안쪽 p-5 감싸기 안에 탭 패널', () => {
    const src = read('ConfigScreen.tsx');
    const pc = between(src, 'title="환경설정"', '</ModalOverlay>');
    expect(pc).toContain('bodyPadding="none"');
    expect(pc).toMatch(/<div className="p-5" data-cfg-body-pad="">\s*\{tabPanels\}\s*<\/div>/);
  });
  test('그룹 머리는 sticky top-0(음수 top·음수 여백 없음)', () => {
    const src = read('ConfigKeyBindingsTab.tsx');
    expect(src).toContain('sticky top-0 bg-[var(--c-surface-2)]');
    expect(src).not.toMatch(/-top-\d/);
    expect(src).not.toMatch(/-m[xt]-\d/);
  });
});

describe('2 캐릭터 프리셋 관리 모드 버튼 라벨', () => {
  const block = between(read('CharacterPresetEditor.tsx'), 'const modeButtons = (', 'const fileButtons = (');
  test('켜짐·꺼짐 같은 라벨, 「끄기」 없음', () => {
    expect(block).not.toContain('끄기');
    expect(block).toMatch(/\n\s*순차 생성 모드\r?\n/);
    expect(block).toMatch(/\n\s*선택 모드\r?\n/);
    expect(block).not.toMatch(/cyclingMode \? '/);
    expect(block).not.toMatch(/selectMode \? '/);
  });
  test('aria-pressed 두 버튼', () => {
    expect(block).toContain('aria-pressed={cyclingMode}');
    expect(block).toContain('aria-pressed={selectMode}');
  });
});

describe('3·4 카드 위 보조 버튼 = 공용 .card-overlay-btn', () => {
  test('App.css 에 한 번 정의(+ 위험·켜짐 변형)', () => {
    const css = read('App.css');
    expect(css.match(/^\.card-overlay-btn \{/gm)).toHaveLength(1);
    expect(css).toContain('.card-overlay-btn.card-overlay-btn-danger:hover');
    expect(css).toContain('.card-overlay-btn.card-overlay-btn-on {');
  });

  test('글로벌 프리셋 카드 PC 하단 액션 바: 다섯 버튼 모두 공용 클래스, 삭제만 위험 변형, 기본 지정은 켜짐일 때만 on', () => {
    const src = read('GlobalPresetTab.tsx');
    const bar = between(src, '{/* PC: 하단 액션 바', '{/* 모바일 전용 액션 바');
    expect(bar).not.toContain('btn-solid-');
    expect(count(bar, 'card-overlay-btn p-3 rounded-lg shadow-lg')).toBe(4);
    expect(count(bar, 'card-overlay-btn card-overlay-btn-danger p-3 rounded-lg shadow-lg')).toBe(1);
    expect(bar).toContain("(entry.isDefault ? ' card-overlay-btn-on' : '')");
    expect(bar).toContain('aria-pressed={entry.isDefault}');
    expect(bar).not.toContain('opacity-50');
    expect(bar).not.toContain('!rounded');
    // 가운데 주 동작 「프로젝트로 복사」는 솔리드 하늘 그대로
    const center = between(src, '{/* PC: 중앙 큰 불러오기 버튼', '{/* PC: 하단 액션 바');
    expect(center).toContain('btn-solid-sky');
  });

  test('글로벌 프리셋 카드 모바일 액션 바: 중립 back-gray·삭제 back-red·기본 지정 켜짐만 back-orange', () => {
    const src = read('GlobalPresetTab.tsx');
    const bar = between(src, '{/* 모바일 전용 액션 바', 'interface GenRowProps');
    expect(bar).not.toContain('btn-solid-');
    expect(bar).toContain("(entry.isDefault ? 'back-orange' : 'back-gray')");
    expect(count(bar, 'className="icon-button back-gray py-2.5 flex items-center justify-center"')).toBe(3);
    expect(count(bar, 'className="icon-button back-red py-2.5 flex items-center justify-center"')).toBe(1);
    expect(bar).toContain('round-button back-sky text-sm py-2.5 font-medium'); // 「프로젝트로 복사」 그대로
    expect(bar).not.toContain('opacity-50');
  });

  test('캐릭터 프리셋 카드(로컬·글로벌): 원형 버튼 11개 모두 공용 클래스, 삭제 2개만 위험 변형, 솔리드 색 없음', () => {
    const src = read('CharacterPresetCards.tsx');
    expect(src).not.toContain('btn-solid-');
    const buttons = src.match(/className="w-8 h-8 rounded-full [^"]*"/g) ?? [];
    expect(buttons).toHaveLength(11);
    expect(buttons.every((b) => b.includes('card-overlay-btn'))).toBe(true);
    expect(buttons.filter((b) => b.includes('card-overlay-btn-danger'))).toHaveLength(2);
  });
});

describe('3(c) 글로벌 프리셋 탭 PC 도구줄 규격', () => {
  const bar = between(read('GlobalPresetTab.tsx'), 'data-global-preset-toolbar=""', '{/* 본문 */}');
  test('버튼에 text-base·px-4 py-2 가 남지 않음, 한 단계 작은 규격', () => {
    expect(bar).not.toContain('text-base');
    expect(bar).not.toContain('px-4 py-2');
    expect(bar).not.toContain('h-[2.625rem]');
    expect(count(bar, 'px-3 py-1.5 text-sm')).toBe(8);
    expect(bar).not.toMatch(/size=\{1[68]\}/);
  });
  test('검색 칸·정렬 h-8 text-sm, 개수 text-xs', () => {
    expect(bar).toContain('className="h-8 px-2.5 text-sm rounded border');
    expect(bar).toContain('className="app-select app-select-tight h-8 text-sm"');
    expect(bar).toContain('className="text-xs text-muted whitespace-nowrap tabular-nums"');
  });
});
