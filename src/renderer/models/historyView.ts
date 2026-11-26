import { action, observable } from 'mobx';
import {
  IMAGE_GRID_SIZE_STEPS,
  imageGridCellPx,
  imageGridThumbPx,
  normalizeSizePercent,
  readSizePercent,
  writeSizePercent,
} from './sizeSlider';

// 히스토리 「크게 보기」(2026-11-26 사용자 결정 「1~2단계 — 200장 확장, 히스토리 크게 보기」).
// 히스토리 PC 패널·모바일 서랍 머리줄의 버튼이 여는 전체 화면 창(componenets/HistoryView.tsx, FloatView).
// 열림 상태는 앱 전체에 하나(App 에 한 번 마운트 — 미리 보기와 같은 방식). 거르기는 기억하지 않는다(열 때마다 꺼짐).
// 칸 크기: PC = 크기 슬라이더(이미지 그리드와 별개의 값, localStorage), 모바일 = 이미지 그리드와 같은 S/M/L 단추(기억하지 않음).
// 이 파일은 DOM·서비스 의존이 없다(KeyboardShortcutService 가 열림 여부를 읽는다) — jest historyViewer.test.ts.

export const HISTORY_VIEW_SIZE_STORAGE_KEY = 'sdstudio-history-view-size';

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export const historyViewState = observable({
  open: false,
  /** PC 칸 크기 슬라이더 값(0~100) */
  sizePercent: readSizePercent(safeStorage(), HISTORY_VIEW_SIZE_STORAGE_KEY),
});

export const openHistoryView = action(() => {
  historyViewState.open = true;
});

export const closeHistoryView = action(() => {
  historyViewState.open = false;
});

export const setHistoryViewSizePercent = action((percent: number) => {
  historyViewState.sizePercent = normalizeSizePercent(percent);
  writeSizePercent(safeStorage(), HISTORY_VIEW_SIZE_STORAGE_KEY, historyViewState.sizePercent);
});

// ===== 거르기 =====

export interface HistoryViewFilter {
  /** 즐겨찾기만 */
  favoritesOnly: boolean;
  /** 이 프로젝트만(지금 연 프로젝트) */
  currentProjectOnly: boolean;
}

export const NO_HISTORY_FILTER: HistoryViewFilter = { favoritesOnly: false, currentProjectOnly: false };

/**
 * 거른 목록(순서 = 히스토리 순서 그대로). isFavorite 가 undefined 를 돌려주면 아직 판정 전(그 항목의 프로젝트를
 * 읽는 중) — 목록에 넣지 않고 pending 으로 센다(판정된 것부터 채운다). 둘 다 켜면 둘 다 만족하는 것만.
 * 지금 연 프로젝트가 없으면 「이 프로젝트만」은 아무것도 남기지 않는다.
 */
export function filterHistoryEntries<E extends { sessionName: string }>(
  entries: readonly E[],
  filter: HistoryViewFilter,
  curSessionName: string | undefined,
  isFavorite: (entry: E) => boolean | undefined,
): { items: E[]; pending: number } {
  const items: E[] = [];
  let pending = 0;
  for (const e of entries) {
    if (filter.currentProjectOnly && (curSessionName == null || e.sessionName !== curSessionName)) continue;
    if (filter.favoritesOnly) {
      const fav = isFavorite(e);
      if (fav === undefined) {
        pending++;
        continue;
      }
      if (!fav) continue;
    }
    items.push(e);
  }
  return { items, pending };
}

/** 머리줄 장수 = 거른 뒤의 수 / 전체 */
export function historyViewCountText(shown: number, total: number): string {
  return `${shown} / ${total}장`;
}

/** 빈 상태 문구 — 히스토리가 비었음 / 판정 중 / 거른 결과 없음. 보여 줄 것이 있으면 null */
export function historyViewEmptyText(total: number, shown: number, pending: number): string | null {
  if (total === 0) return HISTORY_VIEW_TEXT.emptyAll;
  if (shown > 0) return null;
  if (pending > 0) return HISTORY_VIEW_TEXT.checking;
  return HISTORY_VIEW_TEXT.emptyFiltered;
}

// ===== 칸 크기 =====

/** 모바일 S/M/L = 이미지 그리드 모바일 단추와 같은 단계(칸 = 단계/2.5, L = 화면 폭 한 열) */
export const HISTORY_VIEW_MOBILE_STEPS = [
  { name: 'S', size: IMAGE_GRID_SIZE_STEPS[0] },
  { name: 'M', size: IMAGE_GRID_SIZE_STEPS[1] },
  { name: 'L', size: IMAGE_GRID_SIZE_STEPS[2] },
] as const;
export const HISTORY_VIEW_MOBILE_DEFAULT_STEP = 1;
/** 모바일 썸네일 상한 — 500 은 모바일에서 원본을 통째로 읽는다(ImageService.fetchImageSmall) */
export const HISTORY_VIEW_MOBILE_THUMB_MAX = 400;

/** 모바일 칸 크기와 받아 올 썸네일 크기 */
export function historyViewMobileCell(stepIndex: number, containerWidth: number): { cell: number; thumb: number } {
  const idx = Math.min(HISTORY_VIEW_MOBILE_STEPS.length - 1, Math.max(0, Math.floor(stepIndex) || 0));
  const size = HISTORY_VIEW_MOBILE_STEPS[idx].size;
  const cell = size === 500 ? Math.max(80, Math.floor(containerWidth - 10)) : size / 2.5;
  return { cell, thumb: Math.min(size, HISTORY_VIEW_MOBILE_THUMB_MAX) };
}

/** PC 칸 크기(슬라이더 %)와 받아 올 썸네일 크기(단계 값 200·400·500 으로 올림) */
export function historyViewPcCell(percent: number): { cell: number; thumb: number } {
  const cell = imageGridCellPx(percent);
  return { cell, thumb: imageGridThumbPx(cell) };
}

/** 칸 아래 씬 이름 줄 높이 */
export const HISTORY_VIEW_CAPTION = 20;

export const HISTORY_VIEW_TEXT = {
  open: '크게 보기',
  title: '히스토리',
  favoritesOnly: '즐겨찾기만',
  currentProjectOnly: '이 프로젝트만',
  sizeLabel: '히스토리 이미지 크기',
  emptyAll: '아직 생성된 이미지가 없습니다',
  emptyFiltered: '조건에 맞는 이미지가 없습니다',
  checking: '즐겨찾기를 확인하는 중…',
  checkingCount: (n: number) => `확인 중 ${n}장`,
} as const;
