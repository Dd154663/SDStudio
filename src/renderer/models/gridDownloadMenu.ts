// 이미지 그리드 「다운로드」 선택 창의 항목·문구(2026-11-19 다운로드 창 개편 — 종전 독자 창 DownloadDialog 대체).
// 순수 함수라 jest 로 조건별 항목·장수·순서를 확인한다(gridDownloadMenu.test.ts). 실제 저장은 ImageDownloadService.

export type GridDownloadChoice =
  | 'selected'
  | 'all'
  | 'favorites'
  | 'export'
  | 'change-folder';

export interface GridDownloadMenuInput {
  sceneName: string;
  /** 선택 모드에서 고른 장수(선택 모드가 아니면 0) */
  selectedCount: number;
  /** 그리드의 전체 이미지 장수 */
  allCount: number;
  /** 즐겨찾기 이미지 장수 */
  favoriteCount: number;
  /** 「이 씬 내보내기…」 항목을 넣을지 */
  canExport: boolean;
  /** PC 만 「저장 폴더 바꾸기」 */
  isMobile: boolean;
  /** PC 저장 폴더(없으면 「미지정」) */
  savePath?: string;
}

export const GRID_DOWNLOAD_TEXT = {
  title: (sceneName: string) => `"${sceneName}" 이미지 다운로드`,
  selected: (n: number) => `선택한 이미지 (${n}장)`,
  all: (n: number) => `전체 이미지 (${n}장)`,
  favorites: (n: number) => `즐겨찾기만 (${n}장)`,
  exportScene: '이 씬 내보내기…',
  changeFolder: (path?: string) => `저장 폴더 바꾸기 (현재: ${path || '미지정'})`,
  empty: '다운로드할 이미지가 없습니다.',
};

export interface GridDownloadMenu {
  text: string;
  items: { text: string; value: GridDownloadChoice }[];
  /** 다운로드할 이미지가 하나라도 있는지 — 없으면 창 대신 GRID_DOWNLOAD_TEXT.empty 안내 */
  hasImages: boolean;
}

/** 조건에 맞는 항목만, 선택 → 전체 → 즐겨찾기 → 내보내기 → (PC) 저장 폴더 순서 */
export function buildGridDownloadMenu(input: GridDownloadMenuInput): GridDownloadMenu {
  const items: GridDownloadMenu['items'] = [];
  if (input.selectedCount > 0) {
    items.push({ text: GRID_DOWNLOAD_TEXT.selected(input.selectedCount), value: 'selected' });
  }
  if (input.allCount > 0) {
    items.push({ text: GRID_DOWNLOAD_TEXT.all(input.allCount), value: 'all' });
  }
  if (input.favoriteCount > 0) {
    items.push({ text: GRID_DOWNLOAD_TEXT.favorites(input.favoriteCount), value: 'favorites' });
  }
  const hasImages = items.length > 0;
  if (input.canExport) {
    items.push({ text: GRID_DOWNLOAD_TEXT.exportScene, value: 'export' });
  }
  if (!input.isMobile) {
    items.push({ text: GRID_DOWNLOAD_TEXT.changeFolder(input.savePath), value: 'change-folder' });
  }
  return { text: GRID_DOWNLOAD_TEXT.title(input.sceneName), items, hasImages };
}

/** 고른 항목의 다운로드 대상 경로(내보내기·저장 폴더 바꾸기는 undefined) */
export function gridDownloadTargets(
  choice: string | undefined,
  paths: { selected: string[]; all: string[]; favorites: string[] },
): string[] | undefined {
  if (choice === 'selected') return paths.selected;
  if (choice === 'all') return paths.all;
  if (choice === 'favorites') return paths.favorites;
  return undefined;
}
