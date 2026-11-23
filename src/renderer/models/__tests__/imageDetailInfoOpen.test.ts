// 이미지 상세 보기 「이미지 정보」 접기/펼치기(2026-11-23 사용자 결정) — 앱 전체 하나로 기억, 기본 접힘.
import fs from 'fs';
import path from 'path';
import {
  DETAIL_IMAGE_AREA_MIN_PX,
  DETAIL_PROMPT_COLUMN,
  DETAIL_SIDE_COLUMN,
  detailPromptChips,
  detailWideColumns,
  IMAGE_DETAIL_INFO_OPEN_STORAGE_KEY,
  IMAGE_DETAIL_INFO_TEXT,
  normalizeImageDetailInfoOpen,
  readImageDetailInfoOpen,
  writeImageDetailInfoOpen,
} from '../imageDetailInfoOpen';

test('저장값 해석: true 만 펼침, 그 밖·없음은 접힘', () => {
  expect(normalizeImageDetailInfoOpen('true')).toBe(true);
  expect(normalizeImageDetailInfoOpen('false')).toBe(false);
  expect(normalizeImageDetailInfoOpen(null)).toBe(false);
  expect(normalizeImageDetailInfoOpen(undefined)).toBe(false);
  expect(normalizeImageDetailInfoOpen('1')).toBe(false);
});

test('저장: 앱 전체 하나의 localStorage 키, 기본 접힘, 읽기·쓰기 실패해도 던지지 않음', () => {
  const mem = new Map<string, string>();
  const storage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
  };
  expect(readImageDetailInfoOpen(storage)).toBe(false);
  writeImageDetailInfoOpen(storage, true);
  expect(mem.get(IMAGE_DETAIL_INFO_OPEN_STORAGE_KEY)).toBe('true');
  expect(readImageDetailInfoOpen(storage)).toBe(true);
  writeImageDetailInfoOpen(storage, false);
  expect(readImageDetailInfoOpen(storage)).toBe(false);
  const broken = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  };
  expect(readImageDetailInfoOpen(broken)).toBe(false);
  expect(() => writeImageDetailInfoOpen(broken, true)).not.toThrow();
  expect(readImageDetailInfoOpen(undefined)).toBe(false);
});

describe('넓은 폭 열 배치(2026-11-23 — 접힘은 상세 열만 숨김)', () => {
  test('범위 상수', () => {
    expect(DETAIL_PROMPT_COLUMN).toEqual({ ratio: 0.27, min: 320, max: 440 });
    expect(DETAIL_SIDE_COLUMN).toEqual({ ratio: 0.19, min: 260, max: 340 });
    expect(DETAIL_IMAGE_AREA_MIN_PX).toBe(360);
  });

  test('본문 1640·1280·1000px — 프롬프트 열은 두 상태에서 같고, 이미지 영역은 남는 폭', () => {
    expect(detailWideColumns(1640, false)).toEqual({ prompt: 440, side: 0, merged: false, image: 1200 });
    expect(detailWideColumns(1640, true)).toEqual({ prompt: 440, side: 312, merged: false, image: 888 });
    expect(detailWideColumns(1280, false)).toEqual({ prompt: 346, side: 0, merged: false, image: 934 });
    expect(detailWideColumns(1280, true)).toEqual({ prompt: 346, side: 260, merged: false, image: 674 });
    expect(detailWideColumns(1000, false)).toEqual({ prompt: 320, side: 0, merged: false, image: 680 });
    expect(detailWideColumns(1000, true)).toEqual({ prompt: 320, side: 260, merged: false, image: 420 });
    for (const w of [740, 1000, 1280, 1640, 2560]) {
      expect(detailWideColumns(w, true).prompt).toBe(detailWideColumns(w, false).prompt);
    }
    expect(detailWideColumns(2560, true)).toEqual({ prompt: 440, side: 340, merged: false, image: 1780 });
  });

  test('펼침에서 이미지 영역이 360px 아래로 줄면 상세 열을 프롬프트 열에 합친다', () => {
    // 320 + 260 + 360 = 940 이 경계
    expect(detailWideColumns(940, true).merged).toBe(false);
    expect(detailWideColumns(939, true)).toEqual({ prompt: 320, side: 0, merged: true, image: 619 });
    expect(detailWideColumns(939, false)).toEqual({ prompt: 320, side: 0, merged: false, image: 619 });
    // 재기 전(0)·음수도 던지지 않고 이미지 영역 0
    expect(detailWideColumns(0, true).image).toBe(0);
    expect(detailWideColumns(-5, false).image).toBe(0);
  });

  test('프롬프트 열 요약 칩: 메타가 없으면 파일 묶음의 해상도를 칩으로', () => {
    const chips = [{ key: 'model', label: '모델', value: 'V4.5' }];
    const pixel = { key: 'pixel', label: '해상도', value: '832 × 1216' };
    const name = { key: 'filename', label: '파일 이름', value: 'a.png' };
    expect(detailPromptChips({ chips, file: [name, pixel] })).toBe(chips);
    expect(detailPromptChips({ chips: [], file: [name, pixel] })).toEqual([pixel]);
    expect(detailPromptChips({ chips: [], file: [name] })).toEqual([]);
  });
});

describe('소스 계약 — 세 화면이 같은 기억값을 쓴다', () => {
  const read = (rel: string) =>
    fs.readFileSync(path.join(__dirname, rel), 'utf8').replace(/\r\n/g, '\n');
  const rv = read('../../componenets/ResultViewer.tsx');
  const start = rv.indexOf('const ResultDetailView = observer(');
  const end = rv.indexOf('\ninterface ResultVieweRef', start);
  const view = rv.slice(start, end);

  test('여닫힘 상태는 appState 기억값 하나(useState 초기값 아님)', () => {
    expect(rv).toMatch(
      /function useImageDetailInfoOpen\(\): \[boolean, \(open: boolean\) => void\] \{\s*return \[appState\.imageDetailInfoOpen, \(open: boolean\) => appState\.setImageDetailInfoOpen\(open\)\];/,
    );
    expect(view).toContain('const [showPrompt, setShowPrompt] = useImageDetailInfoOpen();');
    expect(view).not.toMatch(/useState<boolean>\(false\)/);
    // 좁은 폭 클래식 버튼·V2 손잡이·PC 머리 줄 버튼 모두 같은 setShowPrompt 로 여닫는다
    expect(view.match(/onClick=\{\(\) => setShowPrompt\(!showPrompt\)\}/g)).toHaveLength(3);
    expect(view).toContain("{!showPrompt ? '자세한 정보 보기' : '자세한 정보 숨기기'}");
    // V2 손잡이: 펼친 동안만 되돌리기 바 자리
    expect(view).toContain('{...(showPrompt ? { [UNDO_ANCHOR_ATTR]: \'\' } : null)}');
    expect(view).toContain('{showPrompt && <UndoBarSlot tone="sheet" />}');
  });

  test('PC 「상세 정보」 버튼: 프롬프트 열 머리(왼쪽, 스크롤 밖), 켜짐 = back-sky toggle-on + aria-pressed, 이름은 고정', () => {
    const i = view.indexOf('data-detail-info-toggle=""');
    expect(i).toBeGreaterThan(0);
    const btn = view.slice(view.lastIndexOf('<button', i), view.indexOf('</button>', i));
    expect(btn).toContain("showPrompt ? 'back-sky toggle-on' : 'back-gray'");
    expect(btn).toContain('aria-pressed={showPrompt}');
    expect(btn).toContain('aria-label={IMAGE_DETAIL_INFO_TEXT.wideToggle}');
    expect(btn).toContain('title={IMAGE_DETAIL_INFO_TEXT.wideToggle}');
    expect(btn).toContain('<FaInfoCircle className="mr-1" />');
    // 이름을 글자로도 보이고, 화살표 방향으로 여닫힘을 알린다
    expect(btn).toContain('{IMAGE_DETAIL_INFO_TEXT.wideToggle}');
    expect(btn).toContain('showPrompt ? <FaChevronLeft');
    expect(IMAGE_DETAIL_INFO_TEXT.wideToggle).toBe('상세 정보');
    // 자리 = 머리 줄(오른쪽 끝)이 아니라 정보를 읽는 왼쪽 프롬프트 열의 머리(2026-11-23 사용자 — 시인성)
    const header = view.slice(view.indexOf('data-detail-header=""'), view.indexOf('data-detail-buttons=""'));
    expect(header).not.toContain('data-detail-info-toggle');
    const paneStart = view.indexOf('data-detail-info-pane=""');
    expect(i).toBeGreaterThan(paneStart);
    expect(i).toBeGreaterThan(view.indexOf('data-detail-info-head=""', paneStart));
    // 버튼 줄은 스크롤 영역 밖(열 안의 스크롤 div 보다 앞)
    expect(i).toBeLessThan(view.indexOf('overflow-y-auto', i));
    expect(i).toBeLessThan(view.indexOf("renderInfo(wideCols.merged ? 'all' : 'prompt')"));
  });

  test('넓은 폭 본문: 프롬프트 열은 항상(같은 폭), 상세 열은 펼침에서만, 이미지 영역은 남는 폭', () => {
    const body = view.slice(view.indexOf('<div ref={setBodyEl}'), view.indexOf('{imageContent}', view.indexOf('<div ref={setBodyEl}')));
    expect(view).toContain('const wideCols = detailWideColumns(bodySize.width, showPrompt);');
    expect(view).toContain('fitFrame(wideCols.image, bodySize.height, displayRatio ?? DETAIL_FALLBACK_RATIO)');
    // 프롬프트 열 — 조건 없이 그린다, 합쳤으면 한 열 전부
    // 프롬프트 열은 조건 없이 그린다(본문의 첫 자식) — 열 = [머리 줄(스크롤 밖)][스크롤 영역 안의 정보]
    expect(body).toMatch(/\{setBodyEl\}[^>]*>\s*<div\s+className="flex-none min-w-0 flex flex-col border-r line-color"\s+style=\{\{ width: wideCols\.prompt \}\}\s+data-detail-info-pane=""\s*>/);
    expect(body).toMatch(/<div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 pt-2">\s*\{renderInfo\(wideCols\.merged \? 'all' : 'prompt'\)\}/);
    // 상세 열 — side > 0(펼침이고 합치지 않음)일 때만
    expect(body).toMatch(/\{wideCols\.side > 0 && \(\s*<div[^>]*style=\{\{ width: wideCols\.side \}\}\s+data-detail-side-pane=""\s*>\s*\{renderInfo\('detail'\)\}/);
    // 이미지 영역 — 남는 폭 전부, 가운데(종전 「이미지 비율 폭」·60% 상한 없음)
    expect(body).toContain('className="flex-1 min-w-0 h-full flex items-center justify-center overflow-hidden"');
    expect(body).not.toContain('imageFit?.width');
    expect(rv).not.toContain('DETAIL_IMAGE_MAX_RATIO');
  });

  test('정보 칸 컴포넌트: part 로 프롬프트 쪽/상세 쪽을 나눠 그린다(기본 all = 한 열 전부, 묶음 순서 불변)', () => {
    const info = read('../../componenets/ImageDetailInfo.tsx');
    expect(info).toContain("export type ImageDetailInfoPart = 'all' | 'prompt' | 'detail';");
    expect(info).toContain("part = 'all'");
    expect(info).toContain("const showPromptSide = part !== 'detail';");
    expect(info).toContain("const showDetailSide = part !== 'prompt';");
    expect(info).toContain("const chips = part === 'prompt' ? detailPromptChips(info) : info.chips;");
    expect(info).toMatch(/\{showPromptSide && !info\.hasMeta && !loadFailed && \(/);
    expect(info).toMatch(/\{showPromptSide && left\}\s*\{showDetailSide && right\}/);
    // 2단(칸 폭 640px) 분기는 열 배치로 대체
    expect(info).not.toContain('TWO_COLUMN_MIN_PX');
  });

  test('앱 설정 저장은 AppService(localStorage) — 프로젝트 데이터·config 아님', () => {
    const app = read('../AppService.ts');
    expect(app).toMatch(/accessor imageDetailInfoOpen: boolean = readImageDetailInfoOpen\(/);
    expect(app).toMatch(/setImageDetailInfoOpen\(open: boolean\)[\s\S]{0,200}writeImageDetailInfoOpen\(/);
    expect(read('../configSync.ts')).not.toContain('imageDetailInfoOpen');
  });
});
