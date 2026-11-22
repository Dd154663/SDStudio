import { action, observable } from 'mobx';

// 히스토리 큰 미리 보기(2026-11-22) — 열린 항목 하나만 기억하는 화면 상태(저장하지 않음).
// 히스토리 칸을 누르면 open, 미리 보기 창(componenets/HistoryImagePreview.tsx)이 App 에 한 번만 마운트돼 이 값을 본다.
// PC 옆 패널·모바일 드로어 어느 쪽에서 열어도 같은 창 하나가 뜬다(드로어 DOM 밖 — 드로어의 스와이프 닫기에 걸리지 않게).

/** 미리 보기·히스토리 칸이 쓰는 항목 모양(ImageHistoryService.GenerationHistoryEntry 의 부분 집합) */
export interface HistoryPreviewEntryLike {
  id: string;
  sessionName: string;
  sceneName: string;
}

export const historyPreviewState = observable({
  /** 열린 항목의 id(= 경로). null 이면 닫힘 */
  entryId: null as string | null,
});

export const openHistoryPreview = action((entryId: string) => {
  historyPreviewState.entryId = entryId;
});

export const closeHistoryPreview = action(() => {
  historyPreviewState.entryId = null;
});

/** 히스토리 목록 순서(최신순)대로 앞·뒤 항목 id. 끝이면 null(버튼 비활성). 목록에 없으면 둘 다 null. */
export function historyPreviewNeighbors(
  entries: readonly HistoryPreviewEntryLike[],
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
