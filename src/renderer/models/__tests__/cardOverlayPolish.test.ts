// 화면 다듬기 4건(2026-11-21) 소스 검사.
// 1 환경설정 단축키 탭 붙박이 그룹 머리 — 본문 슬롯 여백 없음(bodyPadding='none' + 안쪽 p-5)이라 sticky top-0 가 스크롤 영역 맨 위에 붙는다.
// 2 캐릭터 프리셋 관리 [순차 생성 모드][선택 모드] — 라벨이 상태와 무관하게 같고 「끄기」 없음, aria-pressed.
// 3·4 글로벌 프리셋 카드·캐릭터 프리셋 카드 위 보조 버튼 = 공용 .card-overlay-btn(App.css 한 곳), 솔리드 색 없음
//     (가운데 「프로젝트로 복사」 제외), 글로벌 프리셋 탭 PC 도구줄은 한 단계 작은 규격.
// 5 버튼 색 정돈 2차 — 씬 카드 이미지 위 버튼·캐릭터 프리셋 선택 바·순차 생성 진행 버튼·글로벌 프리셋 줄 목록.
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

  test('바탕은 불투명이다(반투명 검정은 어두운 이름 띠·사진 위에서 묻힘 — 2026-11-21 사용자 실기)', () => {
    const css = read('App.css');
    const start = css.indexOf('.card-overlay-btn {');
    const end = css.indexOf('.card-overlay-btn:focus-visible');
    const block = css.slice(start, end);
    expect(block).toContain('background-color: #6b7280');
    expect(block).not.toMatch(/background-color:\s*rgba\(/);
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

// 버튼 색 정돈 2차(2026-11-21): 한 자리에 솔리드는 주 동작 하나, 보조 = 중립, 삭제·중단 = 위험 표시.
describe('5 버튼 색 정돈 2차', () => {
  test('A 씬 카드 renderButtons: 이미지 위 네 버튼은 종전 색 그대로(정돈 대상에서 제외 — 사용자 판단으로 되돌림)', () => {
    const block = between(read('SceneQueueControl.tsx'), 'const renderButtons = (overlay?: boolean) => {', 'const focusRing =');
    expect(block).toContain("const green = overlay ? 'bg-green-500 text-white' : 'back-green';");
    expect(block).toContain("const gray = overlay ? 'bg-gray-500 text-white' : 'back-gray';");
    expect(block).toContain("const orange = overlay ? 'bg-orange-500 text-white' : 'back-orange';");
    expect(block).toContain("${isBookmarked ? orange + ' scene-btn-on' : gray}");
    // 다른 카드의 공용 중립 모양을 씬 카드 버튼에 쓰지 않는다
    const code = block
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    expect(code).not.toContain('card-overlay-btn');
  });

  test('B 캐릭터 프리셋 선택 바: 노랑 없음, 솔리드는 「선택 적용」 하나(보기 색), 삭제 back-red', () => {
    const bar = between(read('CharacterPresetEditor.tsx'), 'data-character-selection-bar=""', 'const cyclingSelectBar =');
    expect(bar).not.toContain('btn-solid-yellow');
    expect(bar).not.toContain('btn-solid-red');
    expect(bar.match(/className=[^>]*btn-solid-/g)).toHaveLength(1);
    expect(bar).toContain("${globalView ? 'btn-solid-purple' : 'btn-solid-sky'}");
    expect(count(bar, 'btn-neutral text-body')).toBe(2); // 폴더로 이동·선택 해제
    expect(bar).toContain('btn back-red');
  });

  test('C 순차 생성 진행 버튼: 작업 큐와 같은 규칙(재개 back-green·중단 back-red·일시정지 중립), 솔리드 없음', () => {
    const block = between(read('CharacterPresetEditor.tsx'), '{/* 컨트롤 버튼', '// ─── 카드 그리드 모드');
    expect(block).not.toContain('btn-solid-');
    expect(block).toContain('btn-neutral text-body');
    expect(block).toContain('btn back-green');
    expect(block).toContain('btn back-red');
    // 근거: 작업 큐 하단 바 생성 시작 back-green·생성 중지 back-red
    const queue = read('TaskQueueControl.tsx');
    expect(queue).toContain('round-button back-green px-2 h-8 lg:px-6');
    expect(queue).toContain('round-button back-red px-2 h-8 lg:px-6');
  });

  test('D 글로벌 프리셋 줄 목록(GenRow): 솔리드 없음, 보조 back-gray·삭제 back-red', () => {
    const row = between(read('GlobalPresetTab.tsx'), 'const GenRow = observer(', 'export const GlobalPresetTab');
    expect(row).not.toContain('btn-solid-');
    expect(count(row, 'icon-button back-gray p-3')).toBe(2);
    expect(count(row, 'icon-button back-red p-3')).toBe(1);
    expect(row).toContain('round-button back-sky text-base px-4 py-2'); // 「프로젝트로 복사」 그대로
  });
});

describe('3(c) 글로벌 프리셋 탭 PC 도구줄 규격', () => {
  const bar = between(read('GlobalPresetTab.tsx'), 'data-global-preset-toolbar=""', '{/* 본문 */}');
  test('버튼에 text-base·px-4 py-2 가 남지 않음, 한 단계 작은 규격', () => {
    expect(bar).not.toContain('text-base');
    expect(bar).not.toContain('px-4 py-2');
    expect(bar).not.toContain('h-[2.625rem]');
    // 2026-11-22 멀티선택 「PNG로 내보내기」 추가로 8 → 9, 2026-11-24 「휴지통 (N)」 진입 버튼(같은 규격) 추가로 9 → 10
    expect(count(bar, 'px-3 py-1.5 text-sm')).toBe(10);
    expect(bar).not.toMatch(/size=\{1[68]\}/);
  });
  test('검색 칸·정렬 h-8 text-sm, 개수 text-xs', () => {
    expect(bar).toContain('className="h-8 px-2.5 text-sm rounded border');
    expect(bar).toContain('className="app-select app-select-tight h-8 text-sm"');
    expect(bar).toContain('className="text-xs text-muted whitespace-nowrap tabular-nums"');
  });
});
