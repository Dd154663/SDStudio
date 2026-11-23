// 이미지 그리드 「다운로드」 선택 창 항목 빌더(2026-11-19 다운로드 창 개편)
import { buildGridDownloadMenu, GRID_DOWNLOAD_TEXT, gridDownloadTargets } from '../gridDownloadMenu';

const base = {
  sceneName: '씬 A',
  selectedCount: 0,
  allCount: 0,
  favoriteCount: 0,
  canExport: true,
  isMobile: false,
  savePath: undefined as string | undefined,
};

test('PC 전부 있을 때: 선택 → 전체 → 즐겨찾기 → 번호로 고르기 → 선택 내보내기 → 내보내기 → 저장 폴더 순서와 문구', () => {
  const menu = buildGridDownloadMenu({ ...base, selectedCount: 2, allCount: 10, favoriteCount: 3, savePath: 'D:\\Out' });
  expect(menu.text).toBe('"씬 A" 이미지 다운로드');
  expect(menu.hasImages).toBe(true);
  expect(menu.items).toEqual([
    { text: '선택한 이미지 (2장)', value: 'selected' },
    { text: '전체 이미지 (10장)', value: 'all' },
    { text: '즐겨찾기만 (3장)', value: 'favorites' },
    { text: '번호로 골라서 다운로드…', value: 'pick' },
    { text: '선택한 이미지만 프리셋으로 내보내기… (2장)', value: 'export-selected' },
    { text: '프리셋으로 내보내기…', value: 'export' },
    { text: '저장 폴더 바꾸기 (현재: D:\\Out)', value: 'change-folder' },
  ]);
});

test('0장 항목은 숨기고, 저장 폴더가 없으면 「미지정」', () => {
  const menu = buildGridDownloadMenu({ ...base, allCount: 4 });
  expect(menu.items.map((i) => i.value)).toEqual(['all', 'pick', 'export', 'change-folder']);
  expect(menu.items[3].text).toBe('저장 폴더 바꾸기 (현재: 미지정)');
});

test('모바일은 저장 폴더 항목이 없다', () => {
  const menu = buildGridDownloadMenu({ ...base, isMobile: true, selectedCount: 1, allCount: 4, favoriteCount: 1 });
  expect(menu.items.map((i) => i.value)).toEqual(['selected', 'all', 'favorites', 'pick', 'export-selected', 'export']);
});

test('번호로 골라서 다운로드는 이미지가 2장 이상일 때만(내보내기 여부와 무관), 대상 경로는 없다(창이 고름)', () => {
  expect(buildGridDownloadMenu({ ...base, allCount: 1 }).items.map((i) => i.value)).not.toContain('pick');
  expect(buildGridDownloadMenu({ ...base, allCount: 2 }).items.map((i) => i.value)).toContain('pick');
  expect(buildGridDownloadMenu({ ...base, allCount: 2, canExport: false, isMobile: true }).items.map((i) => i.value))
    .toEqual(['all', 'pick']);
  expect(gridDownloadTargets('pick', { selected: ['s'], all: ['a', 'b'], favorites: [] })).toBeUndefined();
});

test('내보내기를 넣지 않으면 그 항목만 빠진다', () => {
  const menu = buildGridDownloadMenu({ ...base, canExport: false, allCount: 1, isMobile: true });
  expect(menu.items.map((i) => i.value)).toEqual(['all']);
});

test('다운로드할 이미지가 하나도 없으면 hasImages=false(창 대신 안내)', () => {
  const menu = buildGridDownloadMenu({ ...base });
  expect(menu.hasImages).toBe(false);
  expect(GRID_DOWNLOAD_TEXT.empty).toBe('다운로드할 이미지가 없습니다.');
});

test('고른 항목 → 대상 경로', () => {
  const paths = { selected: ['s'], all: ['a', 'b'], favorites: ['f'] };
  expect(gridDownloadTargets('selected', paths)).toEqual(['s']);
  expect(gridDownloadTargets('all', paths)).toEqual(['a', 'b']);
  expect(gridDownloadTargets('favorites', paths)).toEqual(['f']);
  expect(gridDownloadTargets('export', paths)).toBeUndefined();
  expect(gridDownloadTargets('change-folder', paths)).toBeUndefined();
  expect(gridDownloadTargets(undefined, paths)).toBeUndefined();
});

test('선택 내보내기는 고른 것이 있을 때만(선택 다운로드와 같은 조건), 내보내기를 빼면 함께 빠진다', () => {
  expect(buildGridDownloadMenu({ ...base, allCount: 3 }).items.map((i) => i.value)).not.toContain('export-selected');
  expect(buildGridDownloadMenu({ ...base, allCount: 3, selectedCount: 1, canExport: false, isMobile: true }).items.map((i) => i.value))
    .toEqual(['selected', 'all', 'pick']);
  expect(gridDownloadTargets('export-selected', { selected: ['s'], all: [], favorites: [] })).toBeUndefined();
});
