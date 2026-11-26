// 씬 목록 이미지 뷰 1차(2026-11-26) — 순수 규칙: 최근 순 정렬, 씬 별로 칸 배열(상한·더보기·빈 씬·변형 첫 칸), 씬 → 칸 인덱스,
// 보이는 범위 → 씬 집합, 기억값 정리, 탭 종류별 분리, 메모, 칸 크기, 「씬으로 이동」 등록소.
import {
  buildBySceneCells,
  buildRecentCells,
  buildSceneRows,
  buildSceneImageLayout,
  buildSceneViewModeMenu,
  createSceneImageLayoutMemo,
  getSceneRevealer,
  newestFirstBy,
  normalizeSceneViewCap,
  normalizeSceneViewMode,
  normalizeSceneViewModes,
  readSceneViewCap,
  normalizeSceneViewRowCap,
  readSceneViewModes,
  readSceneViewRowCap,
  registerSceneRevealer,
  sceneCellIndex,
  sceneImageGridMetrics,
  sceneImageRowMetrics,
  sceneRowIndex,
  scenesInCellRange,
  scenesInRowRange,
  sceneViewModeOf,
  sceneViewState,
  SCENE_VIEW_CAP_DEFAULT,
  SCENE_VIEW_CAP_STORAGE_KEY,
  SCENE_VIEW_MODE_STORAGE_KEY,
  SCENE_VIEW_ROW_CAP_DEFAULT,
  SCENE_VIEW_ROW_CAP_STORAGE_KEY,
  setSceneViewCap,
  setSceneViewMode,
  setSceneViewRowCap,
  sortedNewestOf,
  visibleCellRange,
  writeSceneViewModes,
  writeSceneViewRowCap,
} from '../sceneImageView';

const T = (n: number) => `${1700000000000 + n}.png`; // 13자리 ms 이름
const memStorage = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    m,
  };
};

describe('최근 순 정렬', () => {
  test('시각 최신 먼저, 시각 모름(UUID 이름)은 맨 뒤 원래 순서', () => {
    const names = ['uuid-b.png', T(1), T(3), 'uuid-a.png', T(2)];
    expect(newestFirstBy(names, (x) => x)).toEqual([T(3), T(2), T(1), 'uuid-b.png', 'uuid-a.png']);
  });
  test('같은 시각은 원래 순서(안정 정렬)', () => {
    const items = [
      { n: T(5), k: 'a' },
      { n: T(5), k: 'b' },
      { n: T(9), k: 'c' },
    ];
    expect(newestFirstBy(items, (x) => x.n).map((x) => x.k)).toEqual(['c', 'a', 'b']);
  });
  test('여러 씬을 섞어 최신 먼저, 이미지 없는 씬은 칸이 없다, 시각 모름은 씬 순서대로 맨 뒤', () => {
    const layout = buildRecentCells([
      { name: 'A', outputs: [T(1), 'x.png', T(4)] },
      { name: 'Empty', outputs: [] },
      { name: 'B', outputs: ['y.png', T(3)] },
    ]);
    expect(layout.cells.map((c) => `${c.scene}:${(c as any).filename}`)).toEqual([
      `A:${T(4)}`,
      `B:${T(3)}`,
      `A:${T(1)}`,
      'A:x.png',
      'B:y.png',
    ]);
    expect(layout.cells.every((c) => c.kind === 'img')).toBe(true);
    // 씬 → 그 씬의 가장 최근 이미지 칸
    expect(sceneCellIndex(layout, 'A')).toBe(0);
    expect(sceneCellIndex(layout, 'B')).toBe(1);
    expect(sceneCellIndex(layout, 'Empty')).toBe(-1);
  });
  test('씬별 정렬은 결과 배열 정체성으로 기억된다', () => {
    const outs = [T(1), T(2)];
    expect(sortedNewestOf(outs)).toBe(sortedNewestOf(outs));
    expect(sortedNewestOf([...outs])).not.toBe(sortedNewestOf(outs));
  });
});

describe('씬 별로 칸 배열', () => {
  const outs = (n: number) => Array.from({ length: n }, (_, i) => T(i)); // 오래된 것부터
  test('생성 탭: 첫 칸 = 가장 최근, 이어서 최신순, 딱 상한이면 더보기 없음', () => {
    const { cells } = buildBySceneCells([{ name: 'A', outputs: outs(3) }], 3, 'scene');
    expect(cells).toEqual([
      { kind: 'head', scene: 'A', filename: T(2), total: 3 },
      { kind: 'img', scene: 'A', filename: T(1) },
      { kind: 'img', scene: 'A', filename: T(0) },
    ]);
  });
  test('생성 탭: 상한 +1 장이면 상한 장 + 더보기(+1)', () => {
    const { cells } = buildBySceneCells([{ name: 'A', outputs: outs(4) }], 3, 'scene');
    expect(cells.map((c) => c.kind)).toEqual(['head', 'img', 'img', 'more']);
    expect(cells[3]).toEqual({ kind: 'more', scene: 'A', remaining: 1 });
  });
  test('기본 상한 8 — 42장이면 8칸 + 더보기 +34', () => {
    const { cells } = buildBySceneCells([{ name: 'A', outputs: outs(42) }], SCENE_VIEW_CAP_DEFAULT, 'scene');
    expect(cells.length).toBe(9);
    expect(cells[8]).toEqual({ kind: 'more', scene: 'A', remaining: 34 });
  });
  test('이미지가 없는 씬 = 빈 첫 칸 하나, 다음 씬이 줄을 바꾸지 않고 바로 이어진다', () => {
    const layout = buildBySceneCells(
      [
        { name: 'Empty', outputs: [] },
        { name: 'B', outputs: outs(2) },
      ],
      8,
      'scene',
    );
    expect(layout.cells).toEqual([
      { kind: 'head', scene: 'Empty', filename: undefined, total: 0 },
      { kind: 'head', scene: 'B', filename: T(1), total: 2 },
      { kind: 'img', scene: 'B', filename: T(0) },
    ]);
    expect(sceneCellIndex(layout, 'Empty')).toBe(0);
    expect(sceneCellIndex(layout, 'B')).toBe(1);
  });
  test('변형 탭: 첫 칸 = 입력 원본, 결과는 상한−1 장, 넘치면 더보기', () => {
    const exact = buildBySceneCells([{ name: 'V', outputs: outs(2), input: 'src.png' }], 3, 'inpaint');
    expect(exact.cells).toEqual([
      { kind: 'head', scene: 'V', input: 'src.png', total: 2 },
      { kind: 'img', scene: 'V', filename: T(1) },
      { kind: 'img', scene: 'V', filename: T(0) },
    ]);
    const over = buildBySceneCells([{ name: 'V', outputs: outs(3), input: 'src.png' }], 3, 'inpaint');
    expect(over.cells.map((c) => c.kind)).toEqual(['head', 'img', 'img', 'more']);
    expect(over.cells[3]).toEqual({ kind: 'more', scene: 'V', remaining: 1 });
    // 입력도 결과도 없으면 빈 첫 칸
    const none = buildBySceneCells([{ name: 'W', outputs: [] }], 3, 'inpaint');
    expect(none.cells).toEqual([{ kind: 'head', scene: 'W', input: undefined, total: 0 }]);
  });
  test('상한은 2~30 으로 정리된다', () => {
    expect(buildBySceneCells([{ name: 'A', outputs: outs(5) }], 0, 'scene').cells.map((c) => c.kind)).toEqual([
      'head',
      'img',
      'more',
    ]);
  });
});

describe('가로 줄', () => {
  const outs = (n: number) => Array.from({ length: n }, (_, i) => T(i));
  test('씬마다 한 줄(빈 씬 포함), 줄의 칸 = 씬 별로의 그 씬 칸과 같음(상한만 다름)', () => {
    const sources = [
      { name: 'A', outputs: outs(5) },
      { name: 'Empty', outputs: [] },
      { name: 'B', outputs: outs(2) },
    ];
    const layout = buildSceneRows(sources, 3, 'scene');
    expect(layout.rows!.map((r) => r.scene)).toEqual(['A', 'Empty', 'B']);
    expect(layout.rows![0].cells).toEqual([
      { kind: 'head', scene: 'A', filename: T(4), total: 5 },
      { kind: 'img', scene: 'A', filename: T(3) },
      { kind: 'img', scene: 'A', filename: T(2) },
      { kind: 'more', scene: 'A', remaining: 2 },
    ]);
    expect(layout.rows![1].cells).toEqual([{ kind: 'head', scene: 'Empty', filename: undefined, total: 0 }]);
    expect(layout.rows![2].cells.map((c) => c.kind)).toEqual(['head', 'img']);
    // 같은 상한이면 칸을 이어 붙인 것이 씬 별로와 같다(규칙 재사용)
    expect(layout.cells).toEqual(buildBySceneCells(sources, 3, 'scene').cells);
    expect(layout.cells).toEqual(layout.rows!.flatMap((r) => r.cells));
  });
  test('가로 줄 상한은 2~50 — 씬 별로 상한(최대 30)보다 많이 담을 수 있다, 기본 20', () => {
    const big = [{ name: 'A', outputs: outs(60) }];
    const r40 = buildSceneRows(big, 40, 'scene').rows![0].cells;
    expect(r40.length).toBe(41);
    expect(r40[40]).toEqual({ kind: 'more', scene: 'A', remaining: 20 });
    const r99 = buildSceneRows(big, 99, 'scene').rows![0].cells;
    expect(r99.length).toBe(51);
    expect(buildSceneRows(big, SCENE_VIEW_ROW_CAP_DEFAULT, 'scene').rows![0].cells.length).toBe(21);
    // buildSceneImageLayout 의 rows 길도 같은 규칙
    expect(buildSceneImageLayout('rows', big, 40, 'scene').rows![0].cells.length).toBe(41);
  });
  test('변형 탭: 첫 칸 = 입력 원본, 결과는 상한−1 장', () => {
    const layout = buildSceneRows([{ name: 'V', outputs: outs(5), input: 'src.png' }], 3, 'inpaint');
    expect(layout.rows![0].cells).toEqual([
      { kind: 'head', scene: 'V', input: 'src.png', total: 5 },
      { kind: 'img', scene: 'V', filename: T(4) },
      { kind: 'img', scene: 'V', filename: T(3) },
      { kind: 'more', scene: 'V', remaining: 3 },
    ]);
  });
  test('씬 → 줄 인덱스(이미지 없는 씬도 줄이 있음, 목록에 없으면 −1), 다른 방식에서는 −1', () => {
    const layout = buildSceneRows(
      [
        { name: 'A', outputs: [T(1)] },
        { name: 'Empty', outputs: [] },
        { name: 'B', outputs: [T(2)] },
      ],
      20,
      'scene',
    );
    expect(sceneRowIndex(layout, 'A')).toBe(0);
    expect(sceneRowIndex(layout, 'Empty')).toBe(1);
    expect(sceneRowIndex(layout, 'B')).toBe(2);
    expect(sceneRowIndex(layout, 'Nope')).toBe(-1);
    expect(sceneRowIndex(buildBySceneCells([{ name: 'A', outputs: [] }], 8, 'scene'), 'A')).toBe(-1);
  });
  test('보이는 줄 범위 → 씬(줄 순서), 범위는 배열 안으로 잘림', () => {
    const { rows } = buildSceneRows(
      ['A', 'B', 'C', 'D'].map((name) => ({ name, outputs: [] })),
      20,
      'scene',
    );
    expect(scenesInRowRange(rows!, 1, 2)).toEqual(['B', 'C']);
    expect(scenesInRowRange(rows!, -3, 99)).toEqual(['A', 'B', 'C', 'D']);
    expect(scenesInRowRange(rows!, 5, 9)).toEqual([]);
  });
  test('메모: 가로 줄 상한이 바뀌면 다시, 같으면 직전 결과', () => {
    const memo = createSceneImageLayoutMemo();
    const a = outs(30);
    const first = memo('rows', [{ name: 'A', outputs: a }], 20, 'scene');
    expect(memo('rows', [{ name: 'A', outputs: a }], 20, 'scene')).toBe(first);
    expect(memo('rows', [{ name: 'A', outputs: a }], 25, 'scene')).not.toBe(first);
    // 같은 상한이라도 방식이 다르면 다시
    expect(memo('byScene', [{ name: 'A', outputs: a }], 25, 'scene').rows).toBeUndefined();
  });
  test('줄 크기: PC = 씬 별로 격자와 같은 열 폭·그림 높이 + 가로 막대 14px, 모바일 = 폭/3.3 정사각·막대 몫 없음', () => {
    const grid = sceneImageGridMetrics({ width: 1000, mobile: false, percent: 50, cardStyle: 'portrait', caption: 0 });
    const pc = sceneImageRowMetrics({ width: 1000, mobile: false, percent: 50, cardStyle: 'portrait' });
    expect(pc.cellWidth).toBe(grid.columnWidth);
    expect(pc.imageHeight).toBe(grid.imageHeight);
    expect(pc.cellHeight).toBe(grid.imageHeight + 6);
    expect(pc.rowHeight).toBe(grid.imageHeight + 6 + 14);
    expect(pc.thumb).toBe(grid.thumb);
    const sq = sceneImageRowMetrics({ width: 1000, mobile: false, percent: 50, cardStyle: 'square' });
    expect(sq.imageHeight).toBe(244);
    const mob = sceneImageRowMetrics({ width: 360, mobile: true, percent: 50, cardStyle: 'portrait' });
    expect(mob.cellWidth).toBe(Math.floor(360 / 3.3));
    expect(mob.imageHeight).toBe(mob.cellWidth - 6);
    expect(mob.cellHeight).toBe(mob.cellWidth);
    expect(mob.rowHeight).toBe(mob.cellHeight);
    expect(mob.thumb).toBe(400);
  });
});

describe('보이는 범위 → 씬', () => {
  test('줄 범위 → 칸 범위', () => {
    expect(visibleCellRange(2, 3, 4)).toEqual([8, 15]);
    expect(visibleCellRange(0, 0, 1)).toEqual([0, 0]);
  });
  test('칸 범위 안 씬 이름(처음 나온 순서·중복 없음), 범위는 배열 안으로 잘림', () => {
    const { cells } = buildBySceneCells(
      [
        { name: 'A', outputs: [T(1), T(2)] },
        { name: 'B', outputs: [T(3)] },
        { name: 'C', outputs: [] },
      ],
      8,
      'scene',
    );
    expect(scenesInCellRange(cells, 1, 2)).toEqual(['A', 'B']);
    expect(scenesInCellRange(cells, 0, 99)).toEqual(['A', 'B', 'C']);
    expect(scenesInCellRange(cells, 5, 9)).toEqual([]);
  });
});

describe('기억값', () => {
  test('보기 방식: 모르는 값·깨진 JSON 은 cards, 탭 종류별로 따로', () => {
    expect(normalizeSceneViewMode('rows')).toBe('rows');
    expect(normalizeSceneViewMode('columns')).toBe('cards');
    expect(normalizeSceneViewModes('{"scene":"rows","inpaint":"byScene"}')).toEqual({ scene: 'rows', inpaint: 'byScene' });
    expect(normalizeSceneViewMode(3)).toBe('cards');
    expect(normalizeSceneViewModes('{"scene":"recent","inpaint":"nope"}')).toEqual({ scene: 'recent', inpaint: 'cards' });
    expect(normalizeSceneViewModes('{broken')).toEqual({ scene: 'cards', inpaint: 'cards' });
    expect(normalizeSceneViewModes(null)).toEqual({ scene: 'cards', inpaint: 'cards' });
  });
  test('씬당 장수: 숫자가 아니면 8, 범위 밖은 2~30, 소수는 반올림', () => {
    expect(normalizeSceneViewCap('abc')).toBe(8);
    expect(normalizeSceneViewCap(undefined)).toBe(8);
    expect(normalizeSceneViewCap(1)).toBe(2);
    expect(normalizeSceneViewCap(99)).toBe(30);
    expect(normalizeSceneViewCap('12')).toBe(12);
    expect(normalizeSceneViewCap(4.6)).toBe(5);
  });
  test('저장소 읽기·쓰기 — 키 이름, 읽기 실패는 기본값', () => {
    const st = memStorage();
    expect(readSceneViewModes(st)).toEqual({ scene: 'cards', inpaint: 'cards' });
    writeSceneViewModes(st, { scene: 'byScene', inpaint: 'recent' });
    expect(JSON.parse(st.m.get(SCENE_VIEW_MODE_STORAGE_KEY)!)).toEqual({ scene: 'byScene', inpaint: 'recent' });
    expect(readSceneViewModes(st)).toEqual({ scene: 'byScene', inpaint: 'recent' });
    st.setItem(SCENE_VIEW_CAP_STORAGE_KEY, '40');
    expect(readSceneViewCap(st)).toBe(30);
    const broken = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect(readSceneViewCap(broken)).toBe(8);
    expect(readSceneViewModes(broken)).toEqual({ scene: 'cards', inpaint: 'cards' });
    expect(() => writeSceneViewModes(broken, { scene: 'recent', inpaint: 'cards' })).not.toThrow();
  });
  test('관찰 상태: 기본 cards, 한 탭만 바꾸면 다른 탭은 그대로, localStorage 에 기억', () => {
    expect(sceneViewModeOf('scene')).toBe('cards');
    expect(sceneViewModeOf('inpaint')).toBe('cards');
    setSceneViewMode('inpaint', 'recent');
    expect(sceneViewModeOf('inpaint')).toBe('recent');
    expect(sceneViewModeOf('scene')).toBe('cards');
    expect(JSON.parse(localStorage.getItem(SCENE_VIEW_MODE_STORAGE_KEY)!)).toEqual({ scene: 'cards', inpaint: 'recent' });
    setSceneViewCap(100);
    expect(sceneViewState.cap).toBe(30);
    expect(localStorage.getItem(SCENE_VIEW_CAP_STORAGE_KEY)).toBe('30');
    setSceneViewMode('inpaint', 'cards');
    setSceneViewCap(8);
  });
  test('선택 창 내용 — 지금 고른 쪽 앞에 ✓, 순서 = 씬 카드·씬 별로·가로 줄·최근 순', () => {
    const menu = buildSceneViewModeMenu('byScene');
    expect(menu.items.map((i) => i.text)).toEqual(['씬 카드', '✓ 씬 별로', '가로 줄', '최근 순']);
    expect(menu.items.map((i) => i.value)).toEqual(['cards', 'byScene', 'rows', 'recent']);
    expect(buildSceneViewModeMenu('rows').items.map((i) => i.text)).toEqual(['씬 카드', '씬 별로', '✓ 가로 줄', '최근 순']);
  });
  test('가로 줄 상한: 기본 20, 범위 2~50, 소수 반올림, 새 키에 기억 — 씬 별로 상한과 독립', () => {
    expect(SCENE_VIEW_ROW_CAP_DEFAULT).toBe(20);
    expect(SCENE_VIEW_ROW_CAP_STORAGE_KEY).toBe('sdstudio-scene-view-row-cap');
    expect(SCENE_VIEW_ROW_CAP_STORAGE_KEY).not.toBe(SCENE_VIEW_CAP_STORAGE_KEY);
    expect(normalizeSceneViewRowCap('abc')).toBe(20);
    expect(normalizeSceneViewRowCap(undefined)).toBe(20);
    expect(normalizeSceneViewRowCap(1)).toBe(2);
    expect(normalizeSceneViewRowCap(99)).toBe(50);
    expect(normalizeSceneViewRowCap(40)).toBe(40);
    expect(normalizeSceneViewRowCap(7.5)).toBe(8);
    const st = memStorage();
    expect(readSceneViewRowCap(st)).toBe(20);
    st.setItem(SCENE_VIEW_CAP_STORAGE_KEY, '5');
    // 씬 별로 상한 키는 가로 줄 상한에 영향 없음
    expect(readSceneViewRowCap(st)).toBe(20);
    writeSceneViewRowCap(st, 77);
    expect(st.m.get(SCENE_VIEW_ROW_CAP_STORAGE_KEY)).toBe('50');
    expect(st.m.get(SCENE_VIEW_CAP_STORAGE_KEY)).toBe('5');
    expect(readSceneViewRowCap(st)).toBe(50);
    const broken = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect(readSceneViewRowCap(broken)).toBe(20);
    expect(() => writeSceneViewRowCap(broken, 3)).not.toThrow();
    // 관찰 상태 — 서로 독립
    const capBefore = sceneViewState.cap;
    setSceneViewRowCap(45);
    expect(sceneViewState.rowCap).toBe(45);
    expect(sceneViewState.cap).toBe(capBefore);
    expect(localStorage.getItem(SCENE_VIEW_ROW_CAP_STORAGE_KEY)).toBe('45');
    setSceneViewCap(12);
    expect(sceneViewState.rowCap).toBe(45);
    setSceneViewCap(8);
    setSceneViewRowCap(20);
  });
});

describe('메모', () => {
  test('씬마다 이름·결과 배열·입력이 같으면 직전 결과, 하나라도 바뀌면 다시', () => {
    const memo = createSceneImageLayoutMemo();
    const a = [T(1)];
    const b = [T(2)];
    const first = memo('byScene', [{ name: 'A', outputs: a }, { name: 'B', outputs: b }], 8, 'scene');
    // 렌더마다 새로 만든 재료 객체라도 내용이 같으면 그대로
    expect(memo('byScene', [{ name: 'A', outputs: a }, { name: 'B', outputs: b }], 8, 'scene')).toBe(first);
    expect(memo('byScene', [{ name: 'A', outputs: a }, { name: 'B', outputs: [T(2), T(3)] }], 8, 'scene')).not.toBe(first);
    const second = memo('byScene', [{ name: 'A', outputs: a }], 8, 'scene');
    expect(memo('byScene', [{ name: 'A', outputs: a }], 3, 'scene')).not.toBe(second);
    const third = memo('recent', [{ name: 'A', outputs: a }], 3, 'scene');
    // 최근 순은 상한과 무관
    expect(memo('recent', [{ name: 'A', outputs: a }], 9, 'scene')).toBe(third);
    expect(memo('recent', [{ name: 'A2', outputs: a }], 9, 'scene')).not.toBe(third);
    const inp = memo('byScene', [{ name: 'V', outputs: a, input: 'x' }], 8, 'inpaint');
    expect(memo('byScene', [{ name: 'V', outputs: a, input: 'y' }], 8, 'inpaint')).not.toBe(inp);
  });
});

describe('칸 크기', () => {
  test('PC: 열 최소 폭 = 씬 카드 크기 규칙, 남는 폭은 열이 나눠 채움, 비율 = 카드 비율 설정', () => {
    const m = sceneImageGridMetrics({ width: 1000, mobile: false, percent: 50, cardStyle: 'portrait', caption: 0 });
    expect(m.columnCount).toBe(4); // 240px 최소
    expect(m.columnWidth).toBe(250);
    expect(m.imageHeight).toBe(Math.round((244 * 4) / 3));
    const sq = sceneImageGridMetrics({ width: 1000, mobile: false, percent: 50, cardStyle: 'square', caption: 20 });
    expect(sq.imageHeight).toBe(244);
    expect(sq.rowHeight).toBe(244 + 6 + 20);
    const fixed = sceneImageGridMetrics({ width: 1000, mobile: false, percent: 50, cardStyle: 'fixedHeight', caption: 0 });
    expect(fixed.imageHeight).toBe(256);
  });
  test('썸네일 크기 = 단계 값만(PC 칸 크기로 올림), 모바일은 400, 모바일은 정사각·최소 2열', () => {
    expect(sceneImageGridMetrics({ width: 1000, mobile: false, percent: 50, cardStyle: 'portrait', caption: 0 }).thumb).toBe(400);
    expect(sceneImageGridMetrics({ width: 1000, mobile: false, percent: 100, cardStyle: 'portrait', caption: 0 }).thumb).toBe(500);
    const mob = sceneImageGridMetrics({ width: 360, mobile: true, percent: 50, cardStyle: 'portrait', caption: 0 });
    expect(mob.columnCount).toBe(2);
    expect(mob.imageHeight).toBe(mob.columnWidth - 6);
    // 모바일 = 씬 카드와 같은 400(칸이 작아도)
    expect(mob.thumb).toBe(400);
    expect(sceneImageGridMetrics({ width: 1200, mobile: true, percent: 50, caption: 0 }).thumb).toBe(400);
    // PC 작은 칸은 200
    expect(sceneImageGridMetrics({ width: 1000, mobile: false, percent: 0, cardStyle: 'landscape', caption: 0 }).thumb).toBe(200);
  });
});

describe('「씬으로 이동」 등록소', () => {
  test('탭 종류별로 등록·해제, 다른 등록이 덮었으면 앞의 해제가 지우지 않는다', () => {
    const r1 = { isImageView: () => true, isReady: () => true, reveal: () => true };
    const r2 = { isImageView: () => false, isReady: () => false, reveal: () => false };
    const off1 = registerSceneRevealer('scene', r1);
    expect(getSceneRevealer('scene')).toBe(r1);
    expect(getSceneRevealer('inpaint')).toBeUndefined();
    const off2 = registerSceneRevealer('scene', r2);
    off1();
    expect(getSceneRevealer('scene')).toBe(r2);
    off2();
    expect(getSceneRevealer('scene')).toBeUndefined();
  });
});
