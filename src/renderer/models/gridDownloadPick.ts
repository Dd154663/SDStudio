// 이미지 그리드 「번호로 골라서 다운로드」 창의 고르기 규칙·문구(2026-11-23 — 2026-11-19 에 없어진 옛 DownloadDialog 의
// 번호 버튼 고르기만 정돈해서 되살림). 순수 함수라 jest 로 확인한다(gridDownloadPick.test.ts). 창은 componenets/GridDownloadPicker.tsx,
// 실제 저장은 선택 창 「선택한 이미지」와 같은 ImageDownloadService.downloadImages 경로(ResultViewer).
// 번호 = 그리드 보기 순서(viewPaths — 보기 순서 설정이 적용된 순서, 첫 칸이 1). 고른 상태는 경로 집합으로 들고 있는다.

export const GRID_PICK_TEXT = {
  title: (sceneName: string) => `"${sceneName}" 이미지 골라서 다운로드`,
  count: (picked: number, total: number) => `${picked}장 선택 / 전체 ${total}장`,
  selectAll: '전체 선택',
  clearAll: '전체 해제',
  download: (n: number) => `${n}장 다운로드`,
  exportPicked: '프리셋으로 내보내기…',
  cancel: '취소',
  /** 번호 버튼 이름(낭독기·테스트) — 즐겨찾기면 뒤에 표시 */
  numberLabel: (no: number, favorite: boolean) => `${no}번 이미지${favorite ? ' (즐겨찾기)' : ''}`,
  // 아래 구역(2026-11-23 사용자 — 저장 폴더는 설정의 복사본, 창에서 바꾸면 이번 다운로드에만)
  /** 「프리셋으로 내보내기…」와 헷갈리지 않게 「다운로드」를 붙인 이름 */
  folderLabel: '다운로드 저장 폴더',
  folderUnset: '미지정 (다운로드할 때 폴더를 고릅니다)',
  folderChange: '바꾸기',
  folderReset: '기본값으로',
  folderTemporary: '이번 다운로드에만 적용 — 환경설정의 저장 폴더는 그대로입니다',
  mobileFolder: '기기의 다운로드 폴더에 저장됩니다',
  previewLabel: '파일명 미리보기',
  previewEmpty: '고른 이미지가 없습니다',
  previewRest: (n: number) => `… 외 ${n}개`,
  /** 타임스탬프 자리 표시 안내(자리 표시 글자는 ImageDownloadService DOWNLOAD_PREVIEW_TIMESTAMP) */
  previewTimestampNote: (mark: string) => `${mark} 자리에는 저장하는 순간의 시각 숫자가 들어갑니다`,
};

/**
 * 창의 저장 폴더 값 → 다운로드에 넘길 「이번에만 쓰는 폴더」. 창에서 고른 값이 설정 값(창을 연 때의 복사본)과 같거나
 * 비어 있으면 undefined = 평소 경로 그대로(설정이 미지정이면 종전처럼 폴더 선택 창 → 설정에 저장).
 */
export function gridPickSavePathOverride(
  chosen: string | undefined,
  defaultPath: string | undefined,
): string | undefined {
  if (!chosen || chosen === defaultPath) return undefined;
  return chosen;
}

/**
 * 처음 상태 — 그리드 선택 모드에서 이미 고른 이미지가(지금 목록 안에) 있으면 그것만, 없으면 전부 켜짐(옛 창과 같음).
 */
export function initialGridPick(paths: readonly string[], preselected: readonly string[]): Set<string> {
  const inList = new Set(paths);
  const pre = preselected.filter((p) => inList.has(p));
  return new Set(pre.length > 0 ? pre : paths);
}

/** 한 장 켜고 끄기(새 집합) */
export function toggleGridPick(picked: ReadonlySet<string>, path: string): Set<string> {
  const next = new Set(picked);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  return next;
}

/** 전체 선택(목록 전부) */
export function pickAllGrid(paths: readonly string[]): Set<string> {
  return new Set(paths);
}

/** 전체 해제 */
export function pickNoneGrid(): Set<string> {
  return new Set();
}

/** 고른 경로를 그리드 순서대로(목록에 없는 경로는 버림) */
export function pickedInGridOrder(paths: readonly string[], picked: ReadonlySet<string>): string[] {
  return paths.filter((p) => picked.has(p));
}
