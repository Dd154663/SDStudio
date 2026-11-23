// PC 메인 화면 마감 9건(2026-11-19, 조사 문서 후보 1~8·10) 회귀 검사 — 자리는 그대로, 간격·높이·글자만.
// 소스 검사(큰 파일·전역 CSS 라 렌더 대신). 모바일은 md: 접두·PC 전용 요소라 값이 그대로인지도 함께 본다.
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const COMP = path.join(ROOT, 'componenets');
const read = (f: string) => fs.readFileSync(path.join(COMP, f), 'utf8');
const css = read('App.css');

const block = (selector: string, src = css) => {
  const re = new RegExp(`(^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`);
  const m = re.exec(src);
  if (!m) throw new Error(`블록 없음: ${selector}`);
  return m[2];
};

describe('1 보기 설정 묶음 — 이름 보임 단계에서 버튼 줄 높이', () => {
  const src = read('SceneQueueControl.tsx');
  test('바깥 줄은 이름 보임 단계에서만 scene-toolbar-named', () => {
    expect(src).toMatch(/buttonNameMode === 'show' \? ' scene-toolbar-named' : ''\s*\}`\}\s*>/);
  });
  test('보기 설정 묶음은 tb-name-offset(이름 몫 15px 보정을 같은 규칙에서 받음)', () => {
    // relative = 합계 표시(SceneTotalsBadge, 2026-11-23)의 absolute 기준
    expect(src).toContain('className="relative ml-auto mr-2 hidden md:flex items-center gap-2 tb-name-offset"');
    expect(block('.scene-toolbar-named .tb-name-offset')).toMatch(/margin-bottom: 15px;/);
    // 이름 몫 = 간격 3 + 이름 12
    expect(block('.tb-name')).toMatch(/margin-top: 3px;[\s\S]*height: 12px;/);
  });
});

// 2 제목 줄(모델 전환·계정 배지 32px·14px)은 실기에서 「납작해 보인다」(사용자 2026-11-19)로 되돌림 — 종전 값 유지를 고정한다.
describe('2 제목 줄은 종전 크기 유지(되돌림)', () => {
  test('계정 표시 배지 36px·16px', () => {
    const b = block('.account-status-control');
    expect(b).toMatch(/height: 36px;/);
    expect(b).toMatch(/min-height: 36px;/);
    expect(b).toMatch(/font-size: 16px;/);
  });
  // UI 정돈 그룹 2-c: 모델 전환도 공용 택일 묶음 .seg-group — 크기는 크기 수식 클래스가 종전 값을 그대로 담는다
  // (전체형 .seg-lg = 칸 36px·최소 48px = 종전 h-9·min-w-[48px], compact .seg-sm = 28px·최소 34px = 종전 h-7·min-w-[34px]).
  test('모델 전환(전체형) 36px·text-base · 모바일 compact 그대로', () => {
    const src = read('ModelFamilySwitch.tsx');
    expect(src).toContain("const btn = compact ? 'seg-item touch-hit relative text-sm' : 'seg-item text-base';");
    expect(src).toContain("'seg-group flex ' + (compact ? 'seg-sm' : 'seg-lg')");
    expect(block('.seg-group.seg-lg > .seg-item')).toMatch(/min-height: 2\.25rem;[\s\S]*min-width: 48px;/);
    expect(block('.seg-group.seg-sm > .seg-item')).toMatch(/min-height: 1\.75rem;[\s\S]*min-width: 34px;/);
  });
});

test('3 주 탭 줄 위 여백 0(카드 안쪽 8px 만)', () => {
  const src = read('UtilComponents.tsx');
  expect(src).toContain("'flex p-1 md:p-0 md:pb-2 flex-none gap-2 items-center w-full mb-1 md:mb-0'");
  // 그룹 2-c: PC 탭 줄 = 밑줄 탭(.tab-line) — 줄 높이 36px(종전 홈 3px + 탭 36px 보다 낮음) + 아래 8px
  expect(src).toContain('className="tab-line md:flex w-full max-w-full min-w-0 overflow-x-auto no-scrollbar hidden"');
  expect(block('.tab-line > .tab-line-item')).toMatch(/height: 2\.25rem;/);
});

describe('4 하단 바 32px·라벨 14px', () => {
  test('개수 라벨·칸', () => {
    const src = read('TaskQueueControl.tsx');
    expect(src).toContain('className="sr-only md:not-sr-only whitespace-nowrap text-default md:text-sm">개수:');
    expect(src).toContain("'ml-1 md:ml-2 p-1 w-10 md:w-16 md:h-8 text-center gray-input'");
  });
  test('프로젝트 라벨·선택 버튼', () => {
    const src = read('SessionSelect.tsx');
    expect(src).toMatch(/hidden lg:inline whitespace-nowrap text-sub md:text-sm">\s*프로젝트:/);
    expect(src).toContain('flex-1 min-w-0 flex items-center gap-2 px-3 py-1.5 md:h-8 rounded-lg');
  });
});

// 2026-11-23 사용자 결정: 「미디엄뷰」 순환 버튼 → 씬 카드 크기 슬라이더(같은 자리). 한 줄 컨트롤 32px 기준은 슬라이더 높이(h-8)로 잇는다.
test('5 씬 카드 크기 슬라이더 32px(종전 「미디엄뷰」 버튼 자리)', () => {
  expect(read('SceneQueueControl.tsx')).toContain('<SceneCardSizeControl />');
  expect(read('SizeSlider.tsx')).toContain("className={'flex-none w-28 h-8 cursor-pointer '");
});

describe('6·7·10 사전 세팅 패널', () => {
  const src = read('PreSetEdtior.tsx');
  test('6 패널 위 안쪽 여백 0 + 맨 위에 올 수 있는 행은 모두 md:mt-3', () => {
    expect(src).toContain('<VerticalStack className="p-2 md:p-3 md:pt-0">');
    expect(src).toContain('className="field-row flex gap-2 mt-2 md:mt-3 items-center relative"'); // 사전세팅선택
    expect(src).toMatch(/<StackFixed className="md:mt-3">\s*<CompanionHostRow hostKey="preset-top">/); // 위 동반 행
    expect(src).toContain('<StackFixed className="field-row flex gap-2 items-center md:mt-3">'); // 레거시 작업모드
  });
  test('7 새 씬 해상도 행 위 12px·컨트롤 32px', () => {
    expect(src).toContain('<div className="flex-none mt-2 md:mt-3 flex items-center gap-2">');
    expect(src).toContain('triggerClassName="w-full justify-between py-1.5 md:h-8"');
    expect(src).toContain('className="round-button back-gray text-sm flex-none px-2.5 py-1 min-w-0 md:h-8"');
  });
  test('10 선택 행 ＋·복사·삭제 아이콘 버튼 32px', () => {
    const start = src.indexOf('<Tooltip content="새 사전 세팅">');
    const end = src.indexOf('{companions}', start);
    const seg = src.slice(start, end);
    expect(seg.match(/className=\{`icon-button flex-none md:h-8`\}/g)).toHaveLength(3);
  });
});

describe('8 스크롤바', () => {
  test('PC 자리 14px·막대 8px(테두리 3), 호버 10px(PC 만)', () => {
    const b = block('::-webkit-scrollbar');
    expect(b).toMatch(/width: 14px;/);
    expect(b).toMatch(/height: 14px;/);
    const t = block('::-webkit-scrollbar-thumb');
    expect(t).toMatch(/border: 3px solid transparent;/);
    expect(css).toMatch(/@media \(min-width: 768px\) \{\s*::-webkit-scrollbar-thumb:hover \{\s*border-width: 2px;/);
    expect(css).not.toMatch(/::-webkit-scrollbar \{\s*width: 24px;/);
  });
  test('모바일(767px 이하) 8px 그대로', () => {
    expect(css).toMatch(
      /@media \(max-width: 767px\) \{\s*::-webkit-scrollbar \{\s*width: 8px;\s*height: 8px;\s*\}\s*::-webkit-scrollbar-thumb \{\s*border: 1px solid transparent;/,
    );
  });
});
