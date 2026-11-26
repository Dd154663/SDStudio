import { action, observable } from 'mobx';

// 히스토리 큰 미리 보기(2026-11-22) — 열린 항목과 넘겨 볼 목록만 기억하는 화면 상태(보기 방식 말고는 저장하지 않음).
// 히스토리 칸을 누르면 open, 미리 보기 창(componenets/HistoryImagePreview.tsx)이 App 에 한 번만 마운트돼 이 값을 본다.
// PC 옆 패널·모바일 드로어 어느 쪽에서 열어도 같은 창 하나가 뜬다(드로어 DOM 밖 — 드로어의 스와이프 닫기에 걸리지 않게).
//
// 2026-11-26 히스토리 확대: 뷰어를 목록과 분리 — 「항목 목록과 시작 위치」를 받는다.
//  · 패널·서랍에서 열면 scopeIds = null → 히스토리 전체(살아 있는 목록 — 새 이미지가 들어와도 보던 장은 id 로 유지).
//  · 크게 보기 창에서 열면 scopeIds = 연 때의 거른 목록(id 고정 — 즐겨찾기를 풀어도 그 자리에서 사라지지 않음).
//    히스토리에서 빠진 항목(삭제·파일 없음)은 목록에서도 빠진다.
//  · 보기 방식 「한 장씩」/「세로로 이어 보기」는 localStorage 에 기억(sdstudio-history-viewer-mode).

/** 미리 보기·히스토리 칸이 쓰는 항목 모양(ImageHistoryService.GenerationHistoryEntry 의 부분 집합) */
export interface HistoryPreviewEntryLike {
  id: string;
  sessionName: string;
  sceneName: string;
}

export type HistoryViewerMode = 'single' | 'scroll';
export const HISTORY_VIEWER_MODES: readonly HistoryViewerMode[] = ['single', 'scroll'];
export const HISTORY_VIEWER_MODE_STORAGE_KEY = 'sdstudio-history-viewer-mode';
export const HISTORY_VIEWER_MODE_DEFAULT: HistoryViewerMode = 'single';

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** 기억한 보기 방식 — 없음·읽기 실패·모르는 값이면 「한 장씩」 */
export function readHistoryViewerMode(storage: KeyValueStorage | undefined): HistoryViewerMode {
  try {
    const raw = storage?.getItem(HISTORY_VIEWER_MODE_STORAGE_KEY);
    return raw === 'scroll' || raw === 'single' ? raw : HISTORY_VIEWER_MODE_DEFAULT;
  } catch {
    return HISTORY_VIEWER_MODE_DEFAULT;
  }
}

export function writeHistoryViewerMode(storage: KeyValueStorage | undefined, mode: HistoryViewerMode): void {
  try {
    storage?.setItem(HISTORY_VIEWER_MODE_STORAGE_KEY, mode);
  } catch {
    // 보기 설정이라 실패는 알리지 않는다(이번 실행 동안만 유지)
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export const historyPreviewState = observable(
  {
    /** 열린 항목의 id(= 경로). null 이면 닫힘 */
    entryId: null as string | null,
    /** 넘겨 볼 목록의 id(연 때 고정). null = 히스토리 전체 */
    scopeIds: null as readonly string[] | null,
    mode: readHistoryViewerMode(safeStorage()),
  },
  { scopeIds: observable.ref },
);

/** 미리 보기 열기 — scopeIds 를 주면 그 목록 안에서만 넘긴다(없으면 히스토리 전체) */
export const openHistoryPreview = action((entryId: string, scopeIds: readonly string[] | null = null) => {
  historyPreviewState.entryId = entryId;
  historyPreviewState.scopeIds = scopeIds ? scopeIds.slice() : null;
});

/** 열린 채로 다른 장으로(목록은 그대로) */
export const showHistoryPreviewEntry = action((entryId: string) => {
  historyPreviewState.entryId = entryId;
});

export const closeHistoryPreview = action(() => {
  historyPreviewState.entryId = null;
  historyPreviewState.scopeIds = null;
});

export const setHistoryViewerMode = action((mode: HistoryViewerMode) => {
  historyPreviewState.mode = mode;
  writeHistoryViewerMode(safeStorage(), mode);
});

/** 뷰어가 넘겨 볼 목록 — scopeIds 순서대로, 히스토리에서 빠진 항목은 뺀다. null 이면 히스토리 전체 */
export function historyPreviewList<E extends { id: string }>(
  entries: readonly E[],
  scopeIds: readonly string[] | null,
): readonly E[] {
  if (!scopeIds) return entries;
  const byId = new Map<string, E>();
  for (const e of entries) byId.set(e.id, e);
  const out: E[] = [];
  for (const id of scopeIds) {
    const e = byId.get(id);
    if (e) out.push(e);
  }
  return out;
}

/**
 * 보던 장이 목록에서 빠졌을 때 이어서 보여 줄 장 — 같은 자리(없으면 마지막 장). 목록이 비면 null.
 * 세로로 이어 보기에서 쓴다(한 장씩 보기는 종전대로 닫는다).
 */
export function historyPreviewFallbackId(
  list: readonly { id: string }[],
  lastIndex: number,
): string | null {
  if (list.length === 0) return null;
  const i = Math.min(Math.max(0, lastIndex), list.length - 1);
  return list[i].id;
}

/** 히스토리 목록 순서(최신순)대로 앞·뒤 항목 id. 끝이면 null(버튼 비활성). 목록에 없으면 둘 다 null. */
export function historyPreviewNeighbors(
  entries: readonly { id: string }[],
  entryId: string | null,
): { prev: string | null; next: string | null } {
  const idx = entryId == null ? -1 : entries.findIndex((e) => e.id === entryId);
  if (idx < 0) return { prev: null, next: null };
  return {
    prev: idx > 0 ? entries[idx - 1].id : null,
    next: idx < entries.length - 1 ? entries[idx + 1].id : null,
  };
}

/** 칸 아래·미리 보기 캡션 공용 규칙: 다른 프로젝트면 「프로젝트/씬」, 같은 프로젝트면 씬 이름 */
export function historyEntryCaption(
  entry: HistoryPreviewEntryLike,
  curSessionName: string | undefined,
): string {
  return entry.sessionName !== curSessionName
    ? `${entry.sessionName}/${entry.sceneName}`
    : entry.sceneName;
}

export const HISTORY_VIEWER_TEXT = {
  group: '보기 방식',
  single: '한 장씩',
  scroll: '세로로 이어 보기',
  position: (i: number, n: number) => `${i} / ${n}`,
} as const;
