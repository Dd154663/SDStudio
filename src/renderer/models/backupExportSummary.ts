// 전체·폴더 백업 「만들기」 완료 창 문구(2026-11-22 백업 견고성 P3·호환 3-1/3-7).
// 들어간 개수는 그대로 두고, 빠진 것·받지 않는 것을 줄로 덧붙인다. 순수 함수(jest).
//
// - 읽지 못해 빠진 프로젝트: 프로젝트 파일을 불러오지 못해 통째로 빠짐.
// - 이미지 폴더를 읽지 못한 프로젝트: 프로젝트는 들어갔지만 일부 이미지가 빠졌을 수 있음.
// - 전체 백업에 들어가지 않는 것: 작가 라이브러리·환경설정(사용자 결정 2026-11-22 — 이번에 넣지 않음).

export const BACKUP_EXPORT_TEXT = {
  settingsDone: '설정 백업이 완료되었습니다.',
  fullDone: (count: number, noimg: boolean) =>
    `전체 백업이 완료되었습니다. (${count}개 프로젝트${noimg ? ', 이미지 제외' : ''})`,
  folderDone: (folder: string, count: number) =>
    `폴더 "${folder}" 백업이 완료되었습니다. (${count}개 프로젝트)`,
  skipped: (n: number, names: string) =>
    `${n}개 프로젝트는 읽지 못해 빠졌습니다: ${names}`,
  imagesUnread: (n: number, names: string) =>
    `${n}개 프로젝트는 이미지 폴더를 읽지 못해 일부 이미지가 빠졌을 수 있습니다: ${names}`,
  notIncluded:
    '작가 라이브러리와 환경설정은 전체 백업에 들어가지 않습니다. 작가 라이브러리는 작가 라이브러리 탭의 「백업」 버튼을 이용하세요.',
  // 백업 파일은 만들었지만 다운로드 폴더 등으로 옮기지 못함(옮기기 쪽이 아직 알리지 않은 오류일 때).
  moveFailed: (detail: string) =>
    `백업 파일은 만들었지만 다운로드 폴더로 옮기지 못했습니다${detail ? `: ${detail}` : '.'}`,
  // 이름 목록이 길 때 꼬리
  more: (n: number) => ` 외 ${n}개`,
};

// 이름 목록: 앞의 max 개 + 「외 N개」.
export const BACKUP_NAME_LIST_MAX = 5;
export function formatNameList(names: string[], max = BACKUP_NAME_LIST_MAX): string {
  const shown = names.slice(0, max).join(', ');
  const rest = names.length - Math.min(names.length, max);
  return rest > 0 ? shown + BACKUP_EXPORT_TEXT.more(rest) : shown;
}

export interface BackupExportSummaryInput {
  kind: 'full' | 'folder';
  mode?: 'full' | 'noimg' | 'settings'; // kind=full 일 때
  folder?: string; // kind=folder 일 때
  includedCount: number;
  skipped: string[]; // 읽지 못해 빠진 프로젝트
  imagesUnread: string[]; // 이미지 폴더 목록을 읽지 못한 프로젝트(들어감)
}

export function buildBackupDoneText(input: BackupExportSummaryInput): string {
  const T = BACKUP_EXPORT_TEXT;
  const lines: string[] = [];
  if (input.kind === 'folder') {
    lines.push(T.folderDone(input.folder ?? '', input.includedCount));
  } else if (input.mode === 'settings') {
    lines.push(T.settingsDone);
  } else {
    lines.push(T.fullDone(input.includedCount, input.mode === 'noimg'));
  }
  const skipped = uniq(input.skipped);
  if (skipped.length > 0) lines.push(T.skipped(skipped.length, formatNameList(skipped)));
  const skippedSet = new Set(skipped);
  const unread = uniq(input.imagesUnread).filter((n) => !skippedSet.has(n));
  if (unread.length > 0) lines.push(T.imagesUnread(unread.length, formatNameList(unread)));
  if (input.kind === 'full') lines.push(T.notIncluded);
  return lines.join('\n');
}

function uniq(names: string[]): string[] {
  return Array.from(new Set(names));
}
