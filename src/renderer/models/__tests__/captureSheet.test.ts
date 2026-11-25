// 「캡처」 순수 규칙(2026-11-25) — models/captureSheet.ts
// 범위별 칸 목록(①②③)·배치 계산·줄 수 경고/불가 경계·화소 상한 축소·옵션 정리·파일 이름·요약 문구.
import {
  buildGridCaptureContent,
  buildSceneCaptureContent,
  canRunCapture,
  captureAspectForCardStyle,
  captureAspectForSize,
  captureCellSizeChoices,
  captureFileStem,
  captureMetrics,
  captureRowCount,
  captureRowsVerdict,
  captureSummary,
  CaptureSceneData,
  captureSceneHasContent,
  clampCaptureRandomCount,
  pickRandomSubset,
  CAPTURE_RANDOM_COUNT_MAX,
  CAPTURE_OPTIONS_STORAGE_KEY,
  CAPTURE_TEXT,
  DEFAULT_CAPTURE_OPTIONS,
  defaultCaptureGridScope,
  defaultCaptureSceneScope,
  effectiveCaptureCellSize,
  fitCaptureToPixelLimit,
  layoutCapture,
  newestOutputsFirst,
  normalizeCaptureOptions,
  planCapture,
  readCaptureOptions,
  rectsOverlap,
  writeCaptureOptions,
} from '../captureSheet';
import { CAPTURE_IMAGE_FORMATS } from '../imageFormats';

const T = (n: number) => `/o/${1700000000000 + n}.png`;
const scene = (name: string, over: Partial<CaptureSceneData> = {}): CaptureSceneData => ({
  name,
  main: { kind: 'output', path: `/o/${name}.png` },
  favorites: [],
  outputs: [],
  ...over,
});
const sources = (cells: { source?: { path: string } }[]) => cells.map((c) => c.source?.path ?? null);

describe('범위별 칸 목록', () => {
  test('① 대표 1장: 씬 순서대로, 이미지 없는 씬은 건너뛰고 수를 센다', () => {
    const c = buildSceneCaptureContent([scene('a'), scene('b', { main: undefined }), scene('c')], {
      perScene: 'main',
      includeEmpty: false,
      columns: 4,
    });
    expect(c.kind).toBe('flow');
    if (c.kind !== 'flow') return;
    expect(sources(c.cells)).toEqual(['/o/a.png', '/o/c.png']);
    expect(c.cells.map((x) => x.label)).toEqual(['a', 'c']);
    expect(c.skipped).toBe(1);
  });

  test('① 빈 씬 포함: 이미지 없는 씬은 이름만 있는 빈 칸', () => {
    const c = buildSceneCaptureContent([scene('a'), scene('b', { main: undefined })], {
      perScene: 'main',
      includeEmpty: true,
      columns: 4,
    });
    if (c.kind !== 'flow') throw new Error();
    expect(c.cells).toEqual([{ source: { kind: 'output', path: '/o/a.png' }, label: 'a' }, { label: 'b' }]);
    expect(c.skipped).toBe(0);
  });

  test('① 이미지변형 씬은 입력 이미지(input)를 그대로', () => {
    const c = buildSceneCaptureContent([scene('v', { main: { kind: 'input', path: 'vibe.png' } })], {
      perScene: 'main',
      includeEmpty: false,
      columns: 4,
    });
    if (c.kind !== 'flow') throw new Error();
    expect(c.cells[0].source).toEqual({ kind: 'input', path: 'vibe.png' });
  });

  test('② 즐겨찾기: 한 줄 = 한 씬, mains 순서, 휴지통(결과 목록에 없는 것) 제외, 씬당 최대 = 한 줄의 장수', () => {
    const outs = [T(1), T(2), T(3), T(4), T(5)];
    const c = buildSceneCaptureContent(
      [
        scene('a', { favorites: [T(4), '/o/trashed.png', T(1), T(2), T(5)], outputs: outs }),
        scene('b', { favorites: [], outputs: outs }),
      ],
      { perScene: 'favorites', includeEmpty: false, columns: 3 },
    );
    expect(c.kind).toBe('rows');
    if (c.kind !== 'rows') return;
    expect(c.rows.map((r) => r.title)).toEqual(['a']);
    expect(sources(c.rows[0].cells)).toEqual([T(4), T(1), T(2)]);
    expect(c.skipped).toBe(1);
  });

  test('② 최근 생성: 생성 시각 최신 먼저(시각 모르는 이름은 뒤), 빈 씬 포함이면 빈 줄', () => {
    const c = buildSceneCaptureContent(
      [
        scene('a', { outputs: ['/o/x.png', T(1), T(9), T(5)] }),
        scene('b', { outputs: [] }),
      ],
      { perScene: 'recent', includeEmpty: true, columns: 7 },
    );
    if (c.kind !== 'rows') throw new Error();
    expect(sources(c.rows[0].cells)).toEqual([T(9), T(5), T(1), '/o/x.png']);
    expect(c.rows[1]).toEqual({ title: 'b', cells: [{}] });
    expect(newestOutputsFirst([T(2), T(3)])).toEqual([T(3), T(2)]);
  });

  test('③ 한 씬의 이미지: 받은 순서 그대로, 씬 이름은 맨 위 한 줄(켰을 때만)', () => {
    const c = buildGridCaptureContent(['/o/1.png', '/o/2.png'], '씬', true);
    if (c.kind !== 'flow') throw new Error();
    expect(sources(c.cells)).toEqual(['/o/1.png', '/o/2.png']);
    expect(c.title).toBe('씬');
    expect(c.cells.every((x) => x.label === undefined)).toBe(true);
    const off = buildGridCaptureContent(['/o/1.png'], '씬', false);
    expect(off.kind === 'flow' && off.title).toBeFalsy();
  });

  test('기본 범위 규칙', () => {
    expect(defaultCaptureSceneScope({ list: 5, selected: 2, visible: 3 })).toBe('selected');
    expect(defaultCaptureSceneScope({ list: 5, selected: 0, visible: 3 })).toBe('list');
    expect(defaultCaptureGridScope({ selected: 1, favorites: 3, all: 9 })).toBe('selected');
    expect(defaultCaptureGridScope({ selected: 0, favorites: 3, all: 9 })).toBe('favorites');
    expect(defaultCaptureGridScope({ selected: 0, favorites: 0, all: 9 })).toBe('all');
  });

  test('보이는 씬: 조금이라도 걸치면 포함, 경계에 닿기만 하면 제외', () => {
    const box = { x: 0, y: 100, w: 500, h: 400 };
    expect(rectsOverlap(box, { x: 0, y: 490, w: 100, h: 100 })).toBe(true);
    expect(rectsOverlap(box, { x: 0, y: 500, w: 100, h: 100 })).toBe(false);
    expect(rectsOverlap(box, { x: 0, y: 0, w: 100, h: 100 })).toBe(false);
    expect(rectsOverlap(box, { x: 0, y: 1, w: 100, h: 100 })).toBe(true);
  });
});

describe('배치 계산', () => {
  const flow = (n: number, labels = false) =>
    ({
      kind: 'flow' as const,
      cells: Array.from({ length: n }, (_, i) => ({ source: { kind: 'output' as const, path: `/o/${i}` }, label: labels ? `s${i}` : undefined })),
      skipped: 0,
    });

  test('간격 없음: 칸을 붙인다, 3:4 칸, 남는 칸은 비운다(줄 폭 동일)', () => {
    const l = layoutCapture({ content: flow(5), columns: 4, cellWidth: 300, aspect: 3 / 4, gap: false, showNames: false });
    expect(l.cellHeight).toBe(400);
    expect(l.columns).toBe(4);
    expect(l.rows).toBe(2);
    expect(l.width).toBe(1200);
    expect(l.height).toBe(800);
    expect(l.cells.map((c) => [c.x, c.y])).toEqual([[0, 0], [300, 0], [600, 0], [900, 0], [0, 400]]);
  });

  test('간격 있음: 바깥 여백 = 칸 사이 = 칸 폭/32(최소 4)', () => {
    const l = layoutCapture({ content: flow(2), columns: 4, cellWidth: 320, aspect: 1, gap: true, showNames: false });
    const g = captureMetrics(320, true).gap;
    expect(g).toBe(10);
    // 장수가 한 줄보다 적으면 그 장수만큼만 폭을 쓴다
    expect(l.columns).toBe(2);
    expect(l.width).toBe(g + 320 + g + 320 + g);
    expect(l.height).toBe(g + 320 + g);
    expect(l.cells[1].x).toBe(g + 320 + g);
    expect(captureMetrics(64, true).gap).toBe(4);
  });

  test('① 이름 띠: 이미지 아래, 다음 줄은 띠 아래에서 시작', () => {
    const l = layoutCapture({ content: flow(3, true), columns: 2, cellWidth: 300, aspect: 1, gap: false, showNames: true });
    const band = captureMetrics(300, false).band;
    expect(l.texts).toHaveLength(3);
    expect(l.texts[0]).toMatchObject({ text: 's0', y: 300, h: band, align: 'center' });
    expect(l.cells[2].y).toBe(300 + band);
    expect(l.height).toBe(2 * (300 + band));
  });

  test('② 줄 위 씬 이름, 줄 폭은 가장 긴 줄 기준으로 같다', () => {
    const l = layoutCapture({
      content: {
        kind: 'rows',
        rows: [
          { title: 'a', cells: [{ source: { kind: 'output', path: '1' } }, { source: { kind: 'output', path: '2' } }] },
          { title: 'b', cells: [{ source: { kind: 'output', path: '3' } }] },
        ],
        skipped: 0,
      },
      columns: 4,
      cellWidth: 200,
      aspect: 1,
      gap: false,
      showNames: true,
    });
    const band = captureMetrics(200, false).band;
    expect(l.columns).toBe(2);
    expect(l.width).toBe(400);
    expect(l.texts.map((t) => [t.text, t.y, t.align])).toEqual([
      ['a', 0, 'left'],
      ['b', band + 200, 'left'],
    ]);
    expect(l.cells.map((c) => [c.x, c.y])).toEqual([[0, band], [200, band], [0, band * 2 + 200]]);
    expect(l.height).toBe(2 * (band + 200));
  });

  test('③ 맨 위 제목 한 줄', () => {
    const l = layoutCapture({
      content: buildGridCaptureContent(['1', '2'], '씬', true),
      columns: 4,
      cellWidth: 200,
      aspect: 1,
      gap: false,
      showNames: true,
    });
    const m = captureMetrics(200, false);
    expect(l.texts).toEqual([expect.objectContaining({ text: '씬', y: 0, h: m.title })]);
    expect(l.cells[0].y).toBe(m.title);
    expect(l.height).toBe(m.title + 200);
  });

  test('칸 비율: 카드 설정·이미지 크기', () => {
    expect(captureAspectForCardStyle('portrait')).toBe(0.75);
    expect(captureAspectForCardStyle('square')).toBe(1);
    expect(captureAspectForCardStyle('landscape')).toBeCloseTo(4 / 3);
    expect(captureAspectForCardStyle('fixedHeight')).toBe(0.75);
    expect(captureAspectForCardStyle(undefined)).toBe(0.75);
    expect(captureAspectForSize(832, 1216)).toBeCloseTo(832 / 1216);
    expect(captureAspectForSize(0, 100)).toBe(0.75);
  });
});

describe('줄 수 판정', () => {
  test('10줄 = 정상, 11줄 = 경고, 20줄 = 경고, 21줄 = 불가', () => {
    expect(captureRowsVerdict(10)).toBe('ok');
    expect(captureRowsVerdict(11)).toBe('warn');
    expect(captureRowsVerdict(20)).toBe('warn');
    expect(captureRowsVerdict(21)).toBe('blocked');
  });

  test('줄 수 = 건너뛴 뒤 장수 ÷ 한 줄의 장수(올림), ②는 씬 수', () => {
    const flow = buildSceneCaptureContent(
      Array.from({ length: 41 }, (_, i) => scene(`s${i}`, { main: i % 10 === 0 ? undefined : { kind: 'output', path: `/o/${i}` } })),
      { perScene: 'main', includeEmpty: false, columns: 4 },
    );
    expect(captureRowCount(flow, 4)).toBe(Math.ceil(36 / 4));
    const rows = buildSceneCaptureContent(
      Array.from({ length: 21 }, (_, i) => scene(`s${i}`, { outputs: [T(i)] })),
      { perScene: 'recent', includeEmpty: false, columns: 4 },
    );
    expect(captureRowCount(rows, 4)).toBe(21);
  });

  test('계획: 21줄이면 실행 불가 + 문구, 11줄이면 경고(실행 가능)', () => {
    const mk = (n: number) =>
      planCapture(buildGridCaptureContent(Array.from({ length: n }, (_, i) => `/o/${i}`), '씬', false), DEFAULT_CAPTURE_OPTIONS, 0.75, 40_000_000);
    const blocked = mk(21 * 4);
    expect(blocked.verdict).toBe('blocked');
    expect(canRunCapture(blocked)).toBe(false);
    const s = captureSummary(blocked);
    expect(s.notes.map((n) => n.text)).toEqual([CAPTURE_TEXT.blocked, CAPTURE_TEXT.blockedHint]);
    const warn = mk(11 * 4);
    expect(warn.verdict).toBe('warn');
    expect(canRunCapture(warn)).toBe(true);
    expect(captureSummary(warn).notes[0]).toEqual({ text: CAPTURE_TEXT.warn, tone: 'warn' });
    expect(canRunCapture(mk(0))).toBe(false);
  });
});

describe('화소 상한', () => {
  test('넘으면 칸 폭을 줄여 맞추고 shrunk, 안 넘으면 그대로', () => {
    const content = buildGridCaptureContent(Array.from({ length: 80 }, (_, i) => `/o/${i}`), '씬', false);
    const input = { content, columns: 4, cellWidth: 768, aspect: 0.75, gap: true, showNames: false };
    const big = layoutCapture(input);
    expect(big.width * big.height).toBeGreaterThan(16_000_000);
    const fitted = fitCaptureToPixelLimit(input, 16_000_000);
    expect(fitted.shrunk).toBe(true);
    expect(fitted.layout.width * fitted.layout.height).toBeLessThanOrEqual(16_000_000);
    expect(fitted.layout.cellWidth).toBeLessThan(768);
    const same = fitCaptureToPixelLimit({ ...input, cellWidth: 256 }, 40_000_000);
    expect(same.shrunk).toBe(false);
    expect(same.layout.cellWidth).toBe(256);
  });

  test('요약 줄: 장수·줄·결과 크기 + 축소 문구 + 건너뜀', () => {
    const content = buildSceneCaptureContent(
      [scene('a'), scene('b', { main: undefined }), ...Array.from({ length: 60 }, (_, i) => scene(`s${i}`))],
      { perScene: 'main', includeEmpty: false, columns: 4 },
    );
    const plan = planCapture(content, { ...DEFAULT_CAPTURE_OPTIONS, cellSize: 768, quality: 'high' }, 0.75, 16_000_000);
    const s = captureSummary(plan);
    expect(s.line).toBe(`이미지 61장 · 16줄 · 결과 ${plan.layout.width} × ${plan.layout.height} px`);
    expect(s.notes.map((n) => n.text)).toEqual([
      CAPTURE_TEXT.warn,
      '이미지가 없는 씬 1개는 건너뜁니다',
      `결과가 커서 칸을 줄였습니다(칸 폭 ${plan.layout.cellWidth} px)`,
    ]);
  });
});

describe('옵션 정리·기억', () => {
  test('모르는 값·범위 밖 숫자는 기본값', () => {
    expect(normalizeCaptureOptions(undefined)).toEqual(DEFAULT_CAPTURE_OPTIONS);
    expect(normalizeCaptureOptions('x')).toEqual(DEFAULT_CAPTURE_OPTIONS);
    const o = normalizeCaptureOptions({
      perScene: 'nope',
      quality: 'high',
      showNames: 'yes',
      gap: true,
      columns: 9,
      cellSize: 300,
      fit: 'contain',
      format: 'webp',
    });
    expect(o).toEqual({ ...DEFAULT_CAPTURE_OPTIONS, quality: 'high', gap: true, fit: 'contain' });
    expect(normalizeCaptureOptions({ columns: 0 }).columns).toBe(4);
    expect(normalizeCaptureOptions({ columns: 2.5 }).columns).toBe(4);
    expect(normalizeCaptureOptions({ columns: 7, format: 'png', cellSize: 768 })).toMatchObject({ columns: 7, format: 'png', cellSize: 768 });
  });

  test('기본값: 대표 1장·빠르게·이름/간격/빈 씬 끔·4장·보통 384·잘라 채움·PNG', () => {
    expect(DEFAULT_CAPTURE_OPTIONS).toEqual({
      perScene: 'main',
      quality: 'fast',
      showNames: false,
      gap: false,
      includeEmpty: false,
      columns: 4,
      cellSize: 384,
      fit: 'cover',
      format: 'png',
      randomCount: 20,
    });
    expect(CAPTURE_IMAGE_FORMATS.jpeg).toMatchObject({ mime: 'image/jpeg', ext: 'jpg', quality: 0.9 });
    expect(CAPTURE_IMAGE_FORMATS.png).toMatchObject({ mime: 'image/png', ext: 'png' });
  });

  test('랜덤 씬 수: 정수 1~140, 그 밖은 기본(또는 넘긴 값)', () => {
    expect(CAPTURE_RANDOM_COUNT_MAX).toBe(140);
    expect(clampCaptureRandomCount(5)).toBe(5);
    expect(clampCaptureRandomCount('12')).toBe(12);
    expect(clampCaptureRandomCount(0)).toBe(1);
    expect(clampCaptureRandomCount(999)).toBe(140);
    expect(clampCaptureRandomCount(3.9)).toBe(3);
    expect(clampCaptureRandomCount('', 7)).toBe(7);
    expect(clampCaptureRandomCount('abc', 7)).toBe(7);
    expect(normalizeCaptureOptions({ randomCount: 33 }).randomCount).toBe(33);
    expect(normalizeCaptureOptions({ randomCount: 'x' }).randomCount).toBe(20);
  });

  test('랜덤 씬 뽑기: 개수만큼, 원래 순서 유지, 후보가 모자라면 전부', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f'];
    // rng 가 늘 0 이면 앞에서부터 고른다
    expect(pickRandomSubset(items, 3, () => 0)).toEqual(['a', 'b', 'c']);
    // rng 가 1 에 가까우면 뒤쪽을 고르되 결과는 원래 순서
    const tail = pickRandomSubset(items, 3, () => 0.999);
    expect(tail).toHaveLength(3);
    expect([...tail].sort()).toEqual(tail);
    expect(new Set(tail).size).toBe(3);
    expect(pickRandomSubset(items, 99)).toEqual(items);
    expect(pickRandomSubset(items, 0)).toEqual([]);
    // 실제 난수로도 중복 없이 개수를 지킨다
    for (let i = 0; i < 20; i++) {
      const got = pickRandomSubset(items, 4);
      expect(got).toHaveLength(4);
      expect(new Set(got).size).toBe(4);
      expect(got.map((x) => items.indexOf(x))).toEqual([...got.map((x) => items.indexOf(x))].sort((a, b) => a - b));
    }
  });

  test('랜덤 씬 후보: 그 종류로 담을 이미지가 있는 씬만', () => {
    const withMain = scene('a', { outputs: [T(1)], favorites: [T(1)] });
    const noMain = scene('b', { main: undefined, outputs: [T(2)] });
    const empty = scene('c', { main: undefined });
    const deadFav = scene('d', { favorites: ['/o/gone.png'], outputs: [T(3)] });
    expect(captureSceneHasContent(withMain, 'main')).toBe(true);
    expect(captureSceneHasContent(noMain, 'main')).toBe(false);
    expect(captureSceneHasContent(noMain, 'recent')).toBe(true);
    expect(captureSceneHasContent(empty, 'recent')).toBe(false);
    expect(captureSceneHasContent(withMain, 'favorites')).toBe(true);
    // 즐겨찾기에 적혀 있어도 결과 목록에 없으면(휴지통 등) 없는 것
    expect(captureSceneHasContent(deadFav, 'favorites')).toBe(false);
  });

  test('「아주 크게 768」은 고화질에서만', () => {
    expect(captureCellSizeChoices('fast').map((s) => s.value)).toEqual([256, 384, 512]);
    expect(captureCellSizeChoices('high').map((s) => s.value)).toEqual([256, 384, 512, 768]);
    expect(effectiveCaptureCellSize({ cellSize: 768, quality: 'fast' })).toBe(512);
    expect(effectiveCaptureCellSize({ cellSize: 768, quality: 'high' })).toBe(768);
  });

  test('localStorage 읽기·쓰기(실패·깨진 값은 기본)', () => {
    const map = new Map<string, string>();
    const st = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
    writeCaptureOptions(st, { ...DEFAULT_CAPTURE_OPTIONS, columns: 6 });
    expect(JSON.parse(map.get(CAPTURE_OPTIONS_STORAGE_KEY)!).columns).toBe(6);
    expect(readCaptureOptions(st).columns).toBe(6);
    map.set(CAPTURE_OPTIONS_STORAGE_KEY, '{broken');
    expect(readCaptureOptions(st)).toEqual(DEFAULT_CAPTURE_OPTIONS);
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readCaptureOptions(throwing)).toEqual(DEFAULT_CAPTURE_OPTIONS);
    expect(() => writeCaptureOptions(throwing, DEFAULT_CAPTURE_OPTIONS)).not.toThrow();
    expect(readCaptureOptions(undefined)).toEqual(DEFAULT_CAPTURE_OPTIONS);
  });
});

describe('파일 이름', () => {
  test('①② 프로젝트_캡처_시각, ③ 프로젝트_씬_캡처_시각', () => {
    const d = new Date(2026, 10, 5, 9, 3, 7);
    expect(captureFileStem('내 프로젝트', d)).toBe('내 프로젝트_캡처_20261105_090307');
    expect(captureFileStem('P', d, '씬 1')).toBe('P_씬 1_캡처_20261105_090307');
  });
});
