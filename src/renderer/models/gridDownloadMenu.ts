// 이미지 그리드 「다운로드」 선택 창의 항목·문구(2026-11-19 다운로드 창 개편 — 종전 독자 창 DownloadDialog 대체).
// 순수 함수라 jest 로 조건별 항목·장수·순서를 확인한다(gridDownloadMenu.test.ts). 실제 저장은 ImageDownloadService.

export type GridDownloadChoice =
  | 'selected'
  | 'all'
  | 'favorites'
  | 'pick'
  | 'export'
  | 'export-selected'
  | 'change-folder';

export interface GridDownloadMenuInput {
  sceneName: string;
  /** 선택 모드에서 고른 장수(선택 모드가 아니면 0) */
  selectedCount: number;
  /** 그리드의 전체 이미지 장수 */
  allCount: number;
  /** 즐겨찾기 이미지 장수 */
  favoriteCount: number;
  /** 「프리셋으로 내보내기…」 항목을 넣을지(번호 고르기 창의 같은 버튼도 이 값을 따른다) */
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
  // 2026-11-23 사용자: 「이 씬 내보내기」는 헷갈려 → 「프리셋으로 내보내기」(흐름은 프리셋 선택 창 — 그 안에 직접 설정도 있음)
  exportScene: '프리셋으로 내보내기…',
  // 고른 이미지만 기존 내보내기 흐름(프리셋·직접 설정)으로(2026-11-22) — 선택 다운로드와 같은 조건에서만 보인다
  exportSelected: (n: number) => `선택한 이미지만 프리셋으로 내보내기… (${n}장)`,
  // 번호 버튼으로 골라서 다운로드(2026-11-23 — 옛 DownloadDialog 의 번호 고르기 되살림, 창 = GridDownloadPicker)
  pick: '번호로 골라서 다운로드…',
  changeFolder: (path?: string) => `저장 폴더 바꾸기 (현재: ${path || '미지정'})`,
  empty: '다운로드할 이미지가 없습니다.',
};

export interface GridDownloadMenu {
  text: string;
  items: { text: string; value: GridDownloadChoice }[];
  /** 다운로드할 이미지가 하나라도 있는지 — 없으면 창 대신 GRID_DOWNLOAD_TEXT.empty 안내 */
  hasImages: boolean;
}

/**
 * 조건에 맞는 항목만, 선택 → 전체 → 즐겨찾기 → 번호로 고르기(2장 이상) → 선택 내보내기 → 씬 내보내기 → (PC) 저장 폴더 순서
 */
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
  // 한 장뿐이면 고를 것이 없다 — 2장 이상일 때만
  if (input.allCount >= 2) {
    items.push({ text: GRID_DOWNLOAD_TEXT.pick, value: 'pick' });
  }
  if (input.canExport && input.selectedCount > 0) {
    items.push({ text: GRID_DOWNLOAD_TEXT.exportSelected(input.selectedCount), value: 'export-selected' });
  }
  if (input.canExport) {
    items.push({ text: GRID_DOWNLOAD_TEXT.exportScene, value: 'export' });
  }
  if (!input.isMobile) {
    items.push({ text: GRID_DOWNLOAD_TEXT.changeFolder(input.savePath), value: 'change-folder' });
  }
  return { text: GRID_DOWNLOAD_TEXT.title(input.sceneName), items, hasImages };
}

/** 고른 항목의 다운로드 대상 경로(번호 고르기·내보내기·저장 폴더 바꾸기는 undefined) */
export function gridDownloadTargets(
  choice: string | undefined,
  paths: { selected: string[]; all: string[]; favorites: string[] },
): string[] | undefined {
  if (choice === 'selected') return paths.selected;
  if (choice === 'all') return paths.all;
  if (choice === 'favorites') return paths.favorites;
  return undefined;
}
