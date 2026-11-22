// 전체 백업 복원 결과 창 문구(2026-11-22 백업 불러오기 견고화 — 조사 P2·P4·P8·3-2, 순수 — jest).
//
// 「받지 않은 것·가져오지 못한 것」을 해당할 때만 줄로 덧붙인다:
//  · 가져오지 못한 프로젝트 이름(많으면 앞의 몇 개 + 「외 N개」)
//  · 덮어쓰기에서 기존 프로젝트를 지운 뒤 가져오기에 실패한 프로젝트 — 「덮어씀」으로 세지 않고 따로 알린다
//    (지우고 가져오는 순서 자체는 그대로 — 이번 범위 밖)
//  · 글로벌 라이브러리(글로벌 프리셋·전역 조각·글로벌 캐릭터 프리셋·프로젝트 템플릿)의 받음 / 이미 있어서 받지 않음 /
//    받는 쪽을 읽지 못해 받지 않음 — 규칙(받는 쪽이 비어 있을 때만 통째로)은 그대로
//  · 새 이름 「이름 (2)」로 들어온 프로젝트의 즐겨찾기·북마크·썸네일이 옮겨지지 않았음(동작은 그대로 — 조사 P8)
// 첫 줄(「n/m개 프로젝트와 설정을 불러왔습니다.」·「설정을 병합했습니다.」)과 괄호 요약·덮어쓰지 못함 안내는 종전 그대로.

import { FULL_BACKUP_OVERWRITE_TEXT } from './fullBackupOverwrite';

export type FullBackupLibraryKind =
  | 'globalPresets'
  | 'globalPieces'
  | 'globalCharacterPresets'
  | 'projectTemplates';

export interface FullBackupLibraryOutcome {
  kind: FullBackupLibraryKind;
  /** adopted = 받음, kept = 받는 쪽에 이미 있어 받지 않음, blocked = 받는 쪽 파일을 읽지 못해 받지 않음, error = 받다가 오류 */
  result: 'adopted' | 'kept' | 'blocked' | 'error';
  /** 백업 쪽 항목 수(세지 못하면 undefined) */
  count?: number;
}

export const FULL_BACKUP_LIBRARY_LABEL: Record<FullBackupLibraryKind, string> = {
  globalPresets: '글로벌 프리셋',
  globalPieces: '전역 조각 그룹',
  globalCharacterPresets: '글로벌 캐릭터 프리셋',
  projectTemplates: '프로젝트 템플릿',
};

/** 이름 목록 줄에 그대로 보이는 개수(넘으면 「외 N개」) */
export const FULL_BACKUP_RESULT_NAME_LIMIT = 5;

// 조사 — 마지막 조각이 「N개」면 받침 없음, 그 밖(라이브러리 이름 — 모두 받침으로 끝남)은 받침 있음
function josa(parts: readonly string[], withFinal: string, withoutFinal: string): string {
  const last = parts[parts.length - 1] ?? '';
  return last.endsWith('개') ? withoutFinal : withFinal;
}

export const FULL_BACKUP_RESULT_TEXT = {
  head: (restored: number, total: number) => `${restored}/${total}개 프로젝트와 설정을 불러왔습니다.`,
  settingsHead: '설정을 병합했습니다.',
  skipped: (n: number) => `${n}개 건너뜀`,
  overwritten: (n: number) => `${n}개 덮어씀`,
  names: (names: readonly string[]) => {
    const shown = names.slice(0, FULL_BACKUP_RESULT_NAME_LIMIT).map((n) => `「${n}」`).join(', ');
    const rest = names.length - FULL_BACKUP_RESULT_NAME_LIMIT;
    return rest > 0 ? `${shown} 외 ${rest}개` : shown;
  },
  failed: (names: readonly string[]) =>
    `가져오지 못한 프로젝트: ${FULL_BACKUP_RESULT_TEXT.names(names)}`,
  overwriteFailed: (names: readonly string[]) =>
    `덮어쓰려다 가져오지 못한 프로젝트: ${FULL_BACKUP_RESULT_TEXT.names(names)} — 기존 프로젝트는 이미 지워졌습니다.`,
  item: (kind: FullBackupLibraryKind, count?: number) =>
    typeof count === 'number'
      ? `${FULL_BACKUP_LIBRARY_LABEL[kind]} ${count}개`
      : FULL_BACKUP_LIBRARY_LABEL[kind],
  adopted: (parts: string[]) => `백업의 ${parts.join('·')}${josa(parts, '을', '를')} 받았습니다.`,
  kept: (parts: string[]) =>
    `백업의 ${parts.join('·')}${josa(parts, '은', '는')} 이 기기에 이미 있어서 받지 않았습니다(이미 하나라도 있는 종류는 통째로 받지 않습니다).`,
  blocked: (parts: string[]) =>
    `이 기기의 파일을 읽지 못해 백업의 ${parts.join('·')}${josa(parts, '은', '는')} 받지 않았습니다.`,
  error: (parts: string[]) =>
    `백업의 ${parts.join('·')}${josa(parts, '을', '를')} 받다가 오류가 나 받지 못했습니다.`,
  renamedMarks: (n: number) =>
    `새 이름으로 들어온 프로젝트 ${n}개의 즐겨찾기·북마크·썸네일 표시는 옮겨지지 않았습니다.`,
} as const;

export interface FullBackupResultInput {
  /** settings = 설정만 백업(프로젝트 줄 없음) */
  settingsOnly: boolean;
  total: number;
  restored: number;
  skipped: number;
  /** 지우고 가져오기까지 성공한 덮어쓰기 수 */
  overwritten: number;
  /** 지우지 못해 건너뛴 덮어쓰기(종전 S4) */
  overwriteBlocked: readonly string[];
  /** 가져오기 실패(덮어쓰기 아님 — 받는 쪽 기존 프로젝트는 그대로) */
  failed: readonly string[];
  /** 기존 프로젝트를 지운 뒤 가져오기에 실패 */
  overwriteFailed: readonly string[];
  /** 새 이름으로 들어왔고 백업에 그 원래 이름의 즐겨찾기·북마크·썸네일이 있던 프로젝트 수 */
  renamedWithMarks: number;
  libraries: readonly FullBackupLibraryOutcome[];
  /** fullBackupTemplateNote 의 줄(씬·프로젝트 템플릿 되살림·막힘) */
  templateNote: readonly string[];
}

function libraryLines(libs: readonly FullBackupLibraryOutcome[]): string[] {
  const by = (r: FullBackupLibraryOutcome['result']) =>
    libs
      .filter((l) => l.result === r)
      // 0개를 받거나 받지 않은 것은 알릴 것이 없다(세지 못한 것은 알린다)
      .filter((l) => l.count === undefined || l.count > 0)
      .map((l) => FULL_BACKUP_RESULT_TEXT.item(l.kind, l.count));
  const lines: string[] = [];
  const adopted = by('adopted');
  if (adopted.length) lines.push(FULL_BACKUP_RESULT_TEXT.adopted(adopted));
  const kept = by('kept');
  if (kept.length) lines.push(FULL_BACKUP_RESULT_TEXT.kept(kept));
  const blocked = by('blocked');
  if (blocked.length) lines.push(FULL_BACKUP_RESULT_TEXT.blocked(blocked));
  const error = by('error');
  if (error.length) lines.push(FULL_BACKUP_RESULT_TEXT.error(error));
  return lines;
}

/** 결과 창 본문 */
export function fullBackupResultText(r: FullBackupResultInput): string {
  const lines: string[] = [];
  if (r.settingsOnly) {
    lines.push(FULL_BACKUP_RESULT_TEXT.settingsHead);
  } else {
    const extra: string[] = [];
    if (r.skipped > 0) extra.push(FULL_BACKUP_RESULT_TEXT.skipped(r.skipped));
    if (r.overwritten > 0) extra.push(FULL_BACKUP_RESULT_TEXT.overwritten(r.overwritten));
    if (r.overwriteBlocked.length > 0) {
      extra.push(FULL_BACKUP_OVERWRITE_TEXT.blockedCount(r.overwriteBlocked.length));
    }
    lines.push(
      FULL_BACKUP_RESULT_TEXT.head(r.restored, r.total) +
        (extra.length ? `\n(${extra.join(', ')})` : ''),
    );
    if (r.overwriteBlocked.length > 0) {
      lines.push(FULL_BACKUP_OVERWRITE_TEXT.blockedDetail(r.overwriteBlocked));
    }
    if (r.overwriteFailed.length > 0) lines.push(FULL_BACKUP_RESULT_TEXT.overwriteFailed(r.overwriteFailed));
    if (r.failed.length > 0) lines.push(FULL_BACKUP_RESULT_TEXT.failed(r.failed));
  }
  lines.push(...libraryLines(r.libraries));
  if (r.renamedWithMarks > 0) lines.push(FULL_BACKUP_RESULT_TEXT.renamedMarks(r.renamedWithMarks));
  lines.push(...r.templateNote);
  return lines.join('\n');
}

/** 백업 쪽 라이브러리 파일의 항목 수(세지 못하면 undefined) — 형식은 각 서비스 저장소 parse 와 같은 기준 */
export function countBackupLibraryItems(
  kind: Exclude<FullBackupLibraryKind, 'projectTemplates'>,
  raw: string,
): number | undefined {
  let json: any;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return undefined;
  }
  if (!json || typeof json !== 'object') return undefined;
  if (kind === 'globalPieces') {
    return Array.isArray(json) ? undefined : Object.keys(json).length;
  }
  return Array.isArray(json.presets) ? json.presets.length : undefined;
}
