// 이미지 그리드 「보기 순서」(2026-11-22) — 순수 규칙(imageOrderSort)·저장·「데이터를 쓰지 않음」 소스 계약
import * as fs from 'fs';
import * as path from 'path';
import {
  applyImageViewOrder,
  buildImageViewOrderMenu,
  canReorderInViewOrder,
  favoritesFirstNewestDisplay,
  IMAGE_VIEW_ORDER_STORAGE_KEY,
  IMAGE_VIEW_ORDERS,
  normalizeImageViewOrder,
  outputTimestampOf,
  readImageViewOrder,
  writeImageViewOrder,
} from '../imageOrderSort';

const T = (n: number) => `${1700000000000 + n}.png`;

test('파일 이름의 생성 시각 — ms 숫자 이름(확장자·경로 무관), 그 밖은 모름', () => {
  expect(outputTimestampOf('1700000000123.png')).toBe(1700000000123);
  expect(outputTimestampOf('p/s/1700000000123.webp')).toBe(1700000000123);
  expect(outputTimestampOf('1700000000123 (2).png')).toBe(1700000000123);
  expect(outputTimestampOf('1.png')).toBeUndefined();
  expect(outputTimestampOf('abc.png')).toBeUndefined();
});

test('표시 순서: 즐겨찾기(최신순) → 나머지(최신순), 시각 모름은 각 묶음 뒤에서 원래 순서', () => {
  const shown = ['x.png', T(1), T(5), 'y.png', T(3), T(4), T(2)];
  const favs = [T(1), T(4), 'y.png'];
  expect(favoritesFirstNewestDisplay(shown, favs)).toEqual([T(4), T(1), 'y.png', T(5), T(3), T(2), 'x.png']);
});

test('같은 시각은 원래 순서 유지(안정 정렬)', () => {
  expect(favoritesFirstNewestDisplay(['1700000000001 (b).png', '1700000000001 (a).png'], [])).toEqual([
    '1700000000001 (b).png',
    '1700000000001 (a).png',
  ]);
});

test('보기 순서 적용: 기본 = 그대로(순위·저장 순서 결과 유지), 즐겨찾기 먼저 = 즐겨찾기 묶음 → 나머지 최신순', () => {
  // 경로 꼴(p/s/파일)도 끝 이름으로 즐겨찾기를 비교한다
  const shown = [`p/s/${T(2)}`, `p/s/${T(1)}`, `p/s/${T(3)}`];
  expect(applyImageViewOrder(shown, [T(1)], 'default')).toEqual(shown);
  expect(applyImageViewOrder(shown, [T(1)], 'favorites-first')).toEqual([`p/s/${T(1)}`, `p/s/${T(3)}`, `p/s/${T(2)}`]);
  // 1장·0장도 그대로 동작(보기 설정이라 장수 조건 없음)
  expect(applyImageViewOrder([T(1)], [], 'favorites-first')).toEqual([T(1)]);
  expect(applyImageViewOrder([], [], 'favorites-first')).toEqual([]);
});

test('보기 순서 적용은 입력(표시 목록·즐겨찾기)을 바꾸지 않고 새 배열을 준다', () => {
  const shown = [T(1), T(2), T(3)];
  const favs = [T(1)];
  const before = JSON.stringify({ shown, favs });
  for (const mode of IMAGE_VIEW_ORDERS) {
    const out = applyImageViewOrder(shown, favs, mode);
    expect(out).not.toBe(shown);
  }
  expect(JSON.stringify({ shown, favs })).toBe(before);
});

test('끌어서 순서 바꾸기는 기본 순서 보기에서만', () => {
  expect(canReorderInViewOrder('default')).toBe(true);
  expect(canReorderInViewOrder('favorites-first')).toBe(false);
});

test('저장값 정규화 — 모르는 값·없음은 기본 순서', () => {
  expect(normalizeImageViewOrder('favorites-first')).toBe('favorites-first');
  expect(normalizeImageViewOrder('default')).toBe('default');
  expect(normalizeImageViewOrder(null)).toBe('default');
  expect(normalizeImageViewOrder('newest')).toBe('default');
});

test('저장: 앱 전체 하나의 localStorage 키에 읽고 쓴다(실패해도 던지지 않음)', () => {
  const mem = new Map<string, string>();
  const storage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
  };
  expect(readImageViewOrder(storage)).toBe('default');
  writeImageViewOrder(storage, 'favorites-first');
  expect(mem.get(IMAGE_VIEW_ORDER_STORAGE_KEY)).toBe('favorites-first');
  expect(readImageViewOrder(storage)).toBe('favorites-first');
  const broken = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  };
  expect(readImageViewOrder(broken)).toBe('default');
  expect(() => writeImageViewOrder(broken, 'default')).not.toThrow();
  expect(readImageViewOrder(undefined)).toBe('default');
});

test('선택 창: 두 항목, 지금 고른 쪽 앞에 ✓, 끌기 제한 안내 한 줄', () => {
  const a = buildImageViewOrderMenu('default');
  expect(a.items).toEqual([
    { text: '✓ 기본 순서', value: 'default' },
    { text: '즐겨찾기 먼저 (최신순)', value: 'favorites-first' },
  ]);
  const b = buildImageViewOrderMenu('favorites-first');
  expect(b.items.map((x) => x.text)).toEqual(['기본 순서', '✓ 즐겨찾기 먼저 (최신순)']);
  expect(a.text).toContain('즐겨찾기 먼저 보기에서는 끌어서 순서를 바꿀 수 없습니다');
  // 「취소」류 항목은 넣지 않는다(창의 내장 취소)
  expect(a.items.some((x) => /취소/.test(x.text))).toBe(false);
});

describe('소스 계약 — 보기 순서는 데이터를 쓰지 않는다', () => {
  const read = (rel: string) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
  const rv = read('../../componenets/ResultViewer.tsx');
  /** `const name = ` 부터 다음 `\n    const ` 또는 `\n    // ` 직전까지(같은 들여쓰기의 다음 선언) */
  const block = (name: string) => {
    const start = rv.indexOf(`const ${name} = `);
    expect(start).toBeGreaterThanOrEqual(0);
    const rest = rv.slice(start + 1);
    const ends = [rest.indexOf('\n    const '), rest.indexOf('\n    // ')].filter((i) => i >= 0);
    return rest.slice(0, Math.min(...ends));
  };

  test('보기 순서 고르기·표시 목록 계산에 저장 순서 변경·되돌리기 기록이 없다', () => {
    for (const name of ['actChooseViewOrder', 'viewPaths']) {
      const body = block(name);
      expect(body).not.toMatch(/recordImageOrder|imageMap\s*\.\s*splice|imageMap\s*=|\.game\s*=|mains\s*\.\s*(push|splice)|setImageFavorites/);
    }
    expect(block('actChooseViewOrder')).toContain('appState.setImageViewOrder(');
    expect(block('viewPaths')).toContain('applyImageViewOrder(');
  });

  test('종전 한 번 정렬(저장 순서 다시 쓰기)은 없다', () => {
    expect(rv).not.toMatch(/actSortFavoritesNewest|planFavoritesFirstNewest|favoritesFirstNewestImageMap|IMAGE_SORT_TEXT/);
    // recordImageOrder 는 끌어서 순서 바꾸기 한 곳에서만
    expect(rv.match(/await recordImageOrder\(/g)).toHaveLength(1);
  });

  test('표시 순서 한 곳: 그리드 paths·상세 getPaths 모두 viewPaths', () => {
    expect(rv).toContain('const paths = viewPaths();');
    expect(block('getPaths')).toContain('viewPaths()');
  });

  test('끌어서 순서 바꾸기는 reorderable 일 때만, 보조 키 끌어내기는 그대로', () => {
    expect(rv).toMatch(/canDrag: \(\) => !selectMode && reorderable !== false && index < filePaths\.length/);
    expect(rv).toMatch(/canDrop: \(\) => reorderable !== false && index < filePaths\.length/);
    expect(rv).toContain('{...imageDragOutProps(path, { modifier: true })}');
    expect(rv.match(/reorderable=\{reorderable\}/g)).toHaveLength(2);
  });

  test('켜짐 표시 = 「상태 있음」 규칙(.toggle-on, aria-pressed 없음), 비활성 조건 없음', () => {
    const i = rv.indexOf('data-viewer-toggle="view-order"');
    expect(i).toBeGreaterThan(0);
    const btn = rv.slice(rv.lastIndexOf('<button', i), rv.indexOf('</button>', i));
    expect(btn).toContain("viewOrderOn ? 'back-sky toggle-on' : 'back-gray'");
    expect(btn).not.toContain('aria-pressed');
    expect(btn).not.toContain('disabled');
    expect(rv).toContain("viewOrder: '보기 순서',");
    expect(rv).toContain("hn('viewOrder', (");
  });

  test('앱 설정 저장은 AppService(localStorage) — 프로젝트 데이터·config 아님', () => {
    const app = read('../AppService.ts');
    expect(app).toMatch(/accessor imageViewOrder: ImageViewOrder = readImageViewOrder\(/);
    expect(app).toMatch(/setImageViewOrder\(mode: ImageViewOrder\)[\s\S]{0,200}writeImageViewOrder\(/);
    const sync = read('../configSync.ts');
    expect(sync).not.toContain('imageViewOrder');
  });
});
