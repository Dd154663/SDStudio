// 퀵 생성 「최근 결과 넘겨 보기」(2026-11-22) — models/quickResultBrowse.ts
// 창 범위·경로로 기억·새 이미지 도착·삭제·이전/다음 계산, 그리고 컴포넌트가 이 모듈만 쓰는지(소스 검사).
import fs from 'fs';
import path from 'path';
import {
  currentQuickView,
  QUICK_RESULT_WINDOW,
  QUICK_STACK_MAX,
  QUICK_VIEW_FOLLOW_LATEST,
  QuickViewState,
  reconcileQuickView,
  stepQuickNewer,
  stepQuickOlder,
} from '../quickResultBrowse';

const ROOT = path.join(__dirname, '..', '..');
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

// 앞이 최신: p0 이 가장 최근
const list = (n: number, from = 0) => Array.from({ length: n }, (_, i) => `d/p${i + from}.png`);
const walkOlder = (paths: string[], times: number, s: QuickViewState = QUICK_VIEW_FOLLOW_LATEST) => {
  for (let i = 0; i < times; i++) s = stepQuickOlder(paths, s);
  return s;
};

describe('상수', () => {
  test('최근 10장, 더미 3장', () => {
    expect(QUICK_RESULT_WINDOW).toBe(10);
    expect(QUICK_STACK_MAX).toBe(3);
  });
});

describe('기본 = 최신 따라가기', () => {
  test('빈 목록 = 빈 상태', () => {
    const v = currentQuickView([], QUICK_VIEW_FOLLOW_LATEST);
    expect(v).toEqual({ path: undefined, index: -1, older: [], newer: [], label: null });
    expect(stepQuickOlder([], QUICK_VIEW_FOLLOW_LATEST)).toEqual(QUICK_VIEW_FOLLOW_LATEST);
    expect(stepQuickNewer([], QUICK_VIEW_FOLLOW_LATEST)).toEqual(QUICK_VIEW_FOLLOW_LATEST);
  });
  test('최신을 보고, 왼쪽은 비고 오른쪽 더미는 가까운 것부터 3장, 표시 없음', () => {
    const p = list(12);
    const v = currentQuickView(p, QUICK_VIEW_FOLLOW_LATEST);
    expect(v.path).toBe('d/p0.png');
    expect(v.newer).toEqual([]);
    expect(v.older).toEqual(['d/p1.png', 'd/p2.png', 'd/p3.png']);
    expect(v.label).toBeNull();
  });
  test('한 장뿐이면 양쪽 모두 없음', () => {
    const v = currentQuickView(['a'], QUICK_VIEW_FOLLOW_LATEST);
    expect([v.path, v.older, v.newer]).toEqual(['a', [], []]);
  });
  test('새 이미지가 오면 그것으로 따라감', () => {
    const s = reconcileQuickView(['new', ...list(3)], QUICK_VIEW_FOLLOW_LATEST);
    expect(currentQuickView(['new', ...list(3)], s).path).toBe('new');
  });
});

describe('넘기기', () => {
  test('오른쪽 = 한 장 더 이전, 왼쪽 = 한 장 더 최신, 1번째로 돌아오면 따라가기', () => {
    const p = list(12);
    let s = stepQuickOlder(p, QUICK_VIEW_FOLLOW_LATEST);
    expect(s).toEqual({ pinned: 'd/p1.png', lastIndex: 1 });
    let v = currentQuickView(p, s);
    expect(v.newer).toEqual(['d/p0.png']);
    expect(v.older).toEqual(['d/p2.png', 'd/p3.png', 'd/p4.png']);
    expect(v.label).toBe('2 / 10');
    s = walkOlder(p, 2, s);
    v = currentQuickView(p, s);
    expect(v.path).toBe('d/p3.png');
    expect(v.newer).toEqual(['d/p2.png', 'd/p1.png', 'd/p0.png']);
    expect(v.label).toBe('4 / 10');
    s = stepQuickNewer(p, s);
    expect(currentQuickView(p, s).path).toBe('d/p2.png');
    s = stepQuickNewer(p, stepQuickNewer(p, s));
    expect(s).toEqual(QUICK_VIEW_FOLLOW_LATEST);
    expect(stepQuickNewer(p, s)).toEqual(QUICK_VIEW_FOLLOW_LATEST);
  });
  test('범위 끝(10번째)에서 더 이전으로 가지 않고 오른쪽 더미 없음', () => {
    const p = list(15);
    const s = walkOlder(p, 30);
    const v = currentQuickView(p, s);
    expect(v.index).toBe(QUICK_RESULT_WINDOW - 1);
    expect(v.older).toEqual([]);
    expect(v.label).toBe('10 / 10');
    expect(stepQuickOlder(p, s)).toEqual(s);
  });
  test('목록이 범위보다 짧으면 목록 끝까지', () => {
    const p = list(4);
    const s = walkOlder(p, 9);
    const v = currentQuickView(p, s);
    expect(v.index).toBe(3);
    expect(v.label).toBe('4 / 4');
    expect(v.older).toEqual([]);
  });
  test('더미 카드는 범위 안 이미지만', () => {
    const p = list(15);
    const v = currentQuickView(p, walkOlder(p, 8)); // 9번째
    expect(v.older).toEqual(['d/p9.png']);
  });
});

describe('넘기는 도중 새 이미지 도착 — 경로로 기억', () => {
  test('보던 이미지 유지, 왼쪽 더미가 한 장 늘어남', () => {
    const p = list(12);
    let s = walkOlder(p, 2); // p2
    const p2 = ['new', ...p];
    s = reconcileQuickView(p2, s);
    const v = currentQuickView(p2, s);
    expect(v.path).toBe('d/p2.png');
    expect(s.lastIndex).toBe(3);
    expect(v.newer).toEqual(['d/p1.png', 'd/p0.png', 'new']);
    expect(v.label).toBe('4 / 10');
  });
  test('새 이미지에 밀려 범위 밖으로 나가도 계속 보이고, 넘기면 범위 안으로 돌아옴', () => {
    let p = list(12);
    let s = walkOlder(p, 9); // 10번째 p9
    p = ['n2', 'n1', ...p];
    s = reconcileQuickView(p, s);
    let v = currentQuickView(p, s);
    expect(v.path).toBe('d/p9.png');
    expect(v.index).toBe(11);
    expect(v.label).toBe('12번째');
    expect(v.older).toEqual([]); // 범위 밖에서는 더 이전 없음
    expect(v.newer).toEqual([p[9], p[8], p[7]]); // 범위 마지막 장부터
    expect(stepQuickOlder(p, s)).toEqual(s);
    s = stepQuickNewer(p, s);
    v = currentQuickView(p, s);
    expect(v.index).toBe(QUICK_RESULT_WINDOW - 1);
    expect(v.path).toBe(p[9]);
  });
  test('바뀐 게 없으면 같은 객체(불필요한 다시 그리기 방지)', () => {
    const p = list(5);
    const s = walkOlder(p, 2);
    expect(reconcileQuickView(p, s)).toBe(s);
    expect(reconcileQuickView(p, QUICK_VIEW_FOLLOW_LATEST)).toBe(QUICK_VIEW_FOLLOW_LATEST);
  });
});

describe('보던 이미지 삭제', () => {
  test('같은 자리(한 장 더 이전)로', () => {
    const p = list(6);
    const s = walkOlder(p, 2); // p2
    const after = p.filter((x) => x !== 'd/p2.png');
    const r = reconcileQuickView(after, s);
    expect(currentQuickView(after, r).path).toBe('d/p3.png');
    expect(r).toEqual({ pinned: 'd/p3.png', lastIndex: 2 });
  });
  test('마지막 장이면 더 최신 쪽 이웃으로', () => {
    const p = list(3);
    const s = walkOlder(p, 2); // p2(끝)
    const after = ['d/p0.png', 'd/p1.png'];
    expect(currentQuickView(after, reconcileQuickView(after, s)).path).toBe('d/p1.png');
  });
  test('이웃이 1번째면 최신 따라가기', () => {
    const s = walkOlder(list(2), 1); // p1
    expect(reconcileQuickView(['d/p0.png'], s)).toEqual(QUICK_VIEW_FOLLOW_LATEST);
  });
  test('모두 지워지면 빈 상태', () => {
    const s = walkOlder(list(3), 1);
    const r = reconcileQuickView([], s);
    expect(r).toEqual(QUICK_VIEW_FOLLOW_LATEST);
    expect(currentQuickView([], r).path).toBeUndefined();
  });
  test('따라가기 중 최신이 지워지면 다음 최신', () => {
    expect(currentQuickView(['d/p1.png'], QUICK_VIEW_FOLLOW_LATEST).path).toBe('d/p1.png');
  });
  test('보던 이미지가 다시 1번째가 되면 따라가기', () => {
    const s = walkOlder(list(3), 1); // p1
    expect(reconcileQuickView(['d/p1.png', 'd/p2.png'], s)).toEqual(QUICK_VIEW_FOLLOW_LATEST);
  });
});

describe('QuickModeTab 연결(소스 검사)', () => {
  const tab = read('componenets/QuickModeTab.tsx');
  test('규칙은 모듈 함수로만', () => {
    expect(tab).toContain("from '../models/quickResultBrowse'");
    for (const fn of ['reconcileQuickView(', 'currentQuickView(', 'stepQuickOlder(', 'stepQuickNewer(']) {
      expect(tab).toContain(fn);
    }
  });
  test('메뉴는 지금 보이는 이미지 기준, 큰 이미지 누름은 무동작', () => {
    expect(tab).toContain('const shownPath = view.path;');
    expect(tab).not.toContain('latestPath');
    // 큰 이미지에는 onClick 을 달지 않는다
    const img = tab.slice(tab.indexOf('data-quick-main-image'), tab.indexOf('/>', tab.indexOf('data-quick-main-image')));
    expect(img).not.toContain('onClick');
  });
  test('키보드·스와이프·등장 움직임 없음, 보조 버튼 모양', () => {
    expect(tab).not.toMatch(/keydown|ArrowLeft|ArrowRight|onTouchStart|onTouchMove/);
    expect(tab).not.toMatch(/animate-|transition-(opacity|transform|all)|fade/);
    expect(tab).toContain('card-overlay-btn');
    expect(tab).not.toMatch(/bg-black\/\d/);
  });
});
