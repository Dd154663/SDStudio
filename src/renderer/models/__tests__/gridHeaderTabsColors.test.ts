// 이미지 그리드 머리 영역(2026-11-22 사용자 결정) — 소스 계약.
// ① 탭(이미지·즐겨찾기·휴지통·인페인트 씬)은 버튼 줄과 다른 자기 줄, 모양 = 밑줄 탭 .tab-line (모바일 V2 는 종전 알약 그대로)
// ② 색을 차분하게: 즐겨찾기 계열 노랑·다운로드 초록·삭제 빨강 + 글자 버튼 예약 추가 초록·예약 제거 회색·씬 편집 주황만 색,
//    나머지는 회색. 상태 표시(선택 모드·붙여넣기·북마크·보기 순서)는 켜졌을 때만 .toggle-on 색.
import * as fs from 'fs';
import * as path from 'path';

const src = fs
  .readFileSync(path.join(__dirname, '../../componenets/ResultViewer.tsx'), 'utf-8')
  .replace(/\r\n/g, '\n');

const between = (a: string, b: string) => {
  const i = src.indexOf(a);
  const j = src.indexOf(b, i + 1);
  expect(i).toBeGreaterThan(-1);
  expect(j).toBeGreaterThan(i);
  return src.slice(i, j);
};

// 버튼 줄 블록 = data-grid-header-buttons 부터 탭 분기(V2 알약 / 밑줄 탭 줄) 앞까지
const buttonsBlock = () => between('data-grid-header-buttons=""', '{v2 ? (');
// hn('key', ( … 다음 hn( 또는 블록 끝까지
const slot = (key: string) => {
  const block = buttonsBlock();
  const i = block.indexOf(`hn('${key}', (`);
  expect(i).toBeGreaterThan(-1);
  const j = block.indexOf("hn('", i + 1);
  return block.slice(i, j < 0 ? undefined : j);
};

describe('탭 줄 = 버튼 줄 아래 자기 줄', () => {
  test('버튼 줄 안에는 탭이 없고, 탭 줄은 버튼 줄 뒤', () => {
    const block = buttonsBlock();
    expect(block).not.toContain('tabNames.map');
    expect(block).not.toContain('renderPillTabs');
    expect(block).not.toContain('renderLineTabs');
    const tabsAt = src.indexOf('data-grid-tabs=""');
    expect(tabsAt).toBeGreaterThan(src.indexOf('data-grid-header-buttons=""'));
    expect(src.slice(tabsAt, tabsAt + 200)).toContain('{renderLineTabs()}');
  });

  test('PC·클래식 바깥 줄은 flex 가 아님(이름 표시 판정의 가용 폭에서 탭을 빼지 않음), V2 는 종전 그대로', () => {
    expect(src).toContain(
      "className={v2 ? 'md:flex justify-between items-center mt-2 md:mt-4' : 'mt-2 md:mt-4'}",
    );
    expect(src).toMatch(/\{v2 \? \(\s*renderPillTabs\(\)\s*\) : \(/);
  });

  test('밑줄 탭 마크업(TabComponent 와 같은 클래스), 머리 영역 아래 테두리 위에 앉음', () => {
    const line = between('const renderLineTabs = () => (', 'return (');
    expect(line).toContain(
      'className="tab-line tab-line-bare flex max-w-full min-w-0 overflow-x-auto no-scrollbar -mb-2 md:-mb-4"',
    );
    expect(line).toContain("'tab-line-item text-sm' + (selectedTab === index ? ' tab-line-on' : '')");
    expect(line).toContain('onClick={() => setSelectedTab(index)}');
    expect(line).not.toContain('round-button');
  });

  test('V2 용 알약 탭은 종전 클래스 그대로', () => {
    const pill = between('const renderPillTabs = () => (', 'const renderLineTabs');
    expect(pill).toContain('<span className="flex ml-auto gap-1 md:gap-2 mt-2 md:mt-0">');
    expect(pill).toContain("(selectedTab === index ? 'back-sky' : 'back-llgray')");
  });
});

describe('머리 줄 색 = 회색 기본 + 지정 색만', () => {
  test.each([
    ['folder', 'back-gray'],
    ['copy', 'back-gray'],
    ['duplicate', 'back-gray'],
    ['copyToScene', 'back-gray'],
    ['sample', 'back-gray'],
    ['favSelect', 'back-yellow'],
    ['favToggle', 'back-yellow'],
    ['download', 'back-green'],
    ['delete', 'back-red'],
  ])('%s = %s', (key, cls) => {
    const s = slot(key);
    expect(s).toContain(`icon-only ${cls}`);
    expect(s).not.toMatch(/back-sky(?! toggle-on)/);
  });

  test.each([
    ['selectMode', "(selectMode ? 'back-sky toggle-on' : 'back-gray')"],
    ['paste', "appState.imageClipboard.length > 0 ? 'back-sky toggle-on' : 'back-gray'"],
    ['bookmark', "bookmarkedImageFilename ? 'back-orange toggle-on' : 'back-gray'"],
    ['viewOrder', "viewOrderOn ? 'back-sky toggle-on' : 'back-gray'"],
  ])('상태 표시 %s 는 켜졌을 때만 색', (key, expr) => {
    expect(slot(key)).toContain(expr);
  });

  test('글자 버튼: 이상형 월드컵 회색, 예약 추가 초록·예약 제거 회색·씬 편집 주황 종전 그대로', () => {
    const block = buttonsBlock();
    expect(block).toMatch(/className=\{`round-button back-gray`\}\s*onClick=\{\(\) => setTournament\(true\)\}/);
    expect(block).toContain("className={`round-button${isMobile ? ' icon-only' : ''} back-green`}");
    expect(block).toContain("className={`round-button${isMobile ? ' icon-only' : ''} back-gray`}");
    expect(block).toContain("className={`round-button${isMobile ? ' icon-only' : ''} back-orange`}");
  });

  test('버튼 줄의 하늘색은 .toggle-on 상태 표시에만', () => {
    const block = buttonsBlock();
    expect(block).not.toMatch(/back-sky(?! toggle-on)/);
    const colors = new Set(Array.from(block.matchAll(/back-([a-z]+)/g), (m) => m[1]));
    expect(Array.from(colors).sort()).toEqual(['gray', 'green', 'orange', 'red', 'sky', 'yellow']);
  });
});
