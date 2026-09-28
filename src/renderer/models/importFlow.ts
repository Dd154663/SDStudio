// 불러오기·덮어쓰기 일관화 공용층 (드라이브 동기화 C안 ②, 2026-09-28)
//
// 한 곳에서 불러오기/덮어쓰기를 익히면 다른 대상에서도 같은 순서·같은 선택지·같은
// 문구 형식을 만나도록, 사용자에게 보이는 부분만 여기 한 곳에 모은다.
//
//   순서: 파일 고르기 → (이름이 같은 항목이 있으면) 정책 선택 → (덮어쓰기면) 확인 1회
//         → 적용 → 완료 안내 「추가 N · 갱신 N · 건너뜀 N」
//
// - 정책 선택지는 「새 이름으로 추가 (권장)」/「건너뛰기」/「덮어쓰기」를 이 이름·이 순서로.
//   대상이 지원하지 않는 선택지는 숨기되 이름은 바꾸지 않는다.
// - 덮어쓰기 확인은 1회(2회 확인은 프로젝트에만 유지 — 이 헬퍼 밖).
// - 내부 병합 규칙(새 id·이름 접미 등)은 대상별 기존 것을 그대로 쓴다. 여기서는 값의
//   이름('rename'|'skip'|'overwrite')과 사용자 문구만 공통으로 정한다.
//
// 순수 함수(문구 조립·선택지 계산·충돌 개수)는 jest 로 검증한다(__tests__/importFlow.test.ts).
// AppService 를 정적 import 하지 않는다(서비스 모듈 순환 방지 — appStateRef 게이트 사용).

import { getAppState } from './appStateRef';

// 기존 라이브러리 복원(askLibraryBackupPolicy)과 같은 값 — 직렬화되지 않는 호출 인자.
export type ImportPolicy = 'rename' | 'skip' | 'overwrite';

// 표시 순서 = 배열 순서(모든 대상 공통).
export const IMPORT_POLICY_ORDER: readonly ImportPolicy[] = [
  'rename',
  'skip',
  'overwrite',
];

export interface ImportPolicyAllow {
  // 덮어쓰기를 지원하지 않는 대상(예: 씬 템플릿)은 false — 선택지를 숨긴다.
  overwrite?: boolean;
}

export interface ImportSummary {
  added: number;
  updated: number;
  skipped: number;
  // 한 줄 덧붙임(예: 임시 백업 파일 위치). 없으면 생략.
  extra?: string;
}

// 사용자에게 보이는 문구는 전부 여기 한 곳에 둔다(대상별로 달라지지 않게).
export const IMPORT_FLOW_TEXT = {
  policy: {
    rename: '새 이름으로 추가 (권장)',
    skip: '건너뛰기',
    overwrite: '덮어쓰기',
  } as Record<ImportPolicy, string>,
  policyTitle: (label: string) => `${label} 불러오기`,
  policyConflicts: (count?: number) =>
    typeof count === 'number' && count > 0
      ? `이름이 같은 항목이 ${count}개 있습니다. 어떻게 처리할까요?`
      : '이름이 같은 항목이 있을 때 어떻게 처리할까요?',
  // 드라이브에서 받는 상황(같은 파일을 여러 번 받기)을 위한 공통 안내.
  driveHint:
    '드라이브에서 받은 파일을 다시 불러올 때는 「건너뛰기」를 고르면 중복이 쌓이지 않습니다.',
  overwriteConfirm: (label: string, count: number | undefined, protection: string) =>
    (typeof count === 'number' && count > 0
      ? `기존 ${label} ${count}개를 덮어씁니다.`
      : `이름이 같은 기존 ${label}을(를) 덮어씁니다.`) +
    ` 기존 항목은 ${protection}됩니다. 계속할까요?`,
  overwriteConfirmButton: '덮어쓰기',
  // 보호 방식 — 「기존 항목은 <보호 방식>됩니다」 자리에 들어가는 사실 서술.
  protection: {
    // 삭제 후 새 항목으로 추가(새 id) — 글로벌 프리셋·작가 라이브러리 기존 규칙.
    replaceDeleted: '영구 삭제된 뒤 불러온 내용으로 교체',
    // id 를 유지한 채 내용만 교체 — 프로젝트의 연결(fromGlobalId)이 끊기지 않는다.
    keepLink: '프로젝트와의 연결을 유지한 채 내용만 교체',
  },
  summary: (s: ImportSummary) =>
    `추가 ${s.added} · 갱신 ${s.updated} · 건너뜀 ${s.skipped}`,
  done: (label: string) => `${label} 불러오기를 마쳤습니다.`,
};

// 선택지 목록(표시 순서 고정). 지원하지 않는 선택지는 빠질 뿐 이름은 그대로.
export function importPolicyChoices(
  allow: ImportPolicyAllow = {},
): { text: string; value: ImportPolicy }[] {
  return IMPORT_POLICY_ORDER.filter(
    (p) => p !== 'overwrite' || allow.overwrite !== false,
  ).map((p) => ({ text: IMPORT_FLOW_TEXT.policy[p], value: p }));
}

// 들어오는 이름 중 기존 이름과 같은 것의 개수(항목 단위 — 파일 안의 같은 이름 두 개는 2).
export function countNameConflicts(
  incoming: Iterable<string>,
  existing: Iterable<string>,
): number {
  const set = new Set(existing);
  let n = 0;
  for (const name of incoming) if (set.has(name)) n++;
  return n;
}

// 라이브러리 백업 JSON(store[key] = [{ name, ... }])에서 문자열 이름만 뽑는다.
export function readNamesFromStore(store: any, key: string): string[] {
  const list = Array.isArray(store?.[key]) ? store[key] : [];
  const out: string[] = [];
  for (const item of list) {
    if (item && typeof item.name === 'string' && item.name) out.push(item.name);
  }
  return out;
}

// 라이브러리 복원 결과({ added, skipped, overwritten }) → 공통 요약.
// 기존 복원은 덮어쓰기 항목도 삭제 후 추가라 added 에 포함돼 있다 → 갱신으로 옮긴다.
export function librarySummary(res: {
  added: number;
  skipped: number;
  overwritten: number;
}): ImportSummary {
  return {
    added: Math.max(0, res.added - res.overwritten),
    updated: res.overwritten,
    skipped: res.skipped,
  };
}

export function importPolicyDialogText(
  label: string,
  conflictCount?: number,
): string {
  return (
    IMPORT_FLOW_TEXT.policyTitle(label) +
    '\n' +
    IMPORT_FLOW_TEXT.policyConflicts(conflictCount) +
    '\n\n' +
    IMPORT_FLOW_TEXT.driveHint
  );
}

export function formatImportSummary(s: ImportSummary): string {
  return IMPORT_FLOW_TEXT.summary(s) + (s.extra ? '\n' + s.extra : '');
}

export function importDoneText(label: string, s: ImportSummary): string {
  return IMPORT_FLOW_TEXT.done(label) + '\n' + formatImportSummary(s);
}

// 정책 선택. conflictCount === 0(충돌 없음 확정)이면 묻지 않고 'rename'(=그대로 추가).
// conflictCount 미지정(개수를 모름)이면 기존처럼 묻는다. 취소 = undefined.
export async function askImportPolicy(opts: {
  label: string;
  conflictCount?: number;
  allow?: ImportPolicyAllow;
}): Promise<ImportPolicy | undefined> {
  if (opts.conflictCount === 0) return 'rename';
  const choices = importPolicyChoices(opts.allow);
  const choice = await getAppState().pushDialogAsync({
    type: 'select',
    text: importPolicyDialogText(opts.label, opts.conflictCount),
    items: choices,
  });
  return choices.some((c) => c.value === choice)
    ? (choice as ImportPolicy)
    : undefined;
}

// 덮어쓰기 확인 1회. label = 항목 이름(예: '글로벌 프리셋', '작가').
export async function confirmOverwrite(opts: {
  label: string;
  count?: number;
  protection: string;
}): Promise<boolean> {
  // confirm 형은 콜백이 값 없이 불려 pushDialogAsync 로는 구분이 안 된다 → 콜백/취소로 받는다.
  return await new Promise<boolean>((resolve) => {
    getAppState().pushDialog({
      type: 'confirm',
      text: IMPORT_FLOW_TEXT.overwriteConfirm(
        opts.label,
        opts.count,
        opts.protection,
      ),
      confirmText: IMPORT_FLOW_TEXT.overwriteConfirmButton,
      callback: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}

// 정책 선택 + (덮어쓰기면) 확인까지 한 번에. 취소·확인 거절 = undefined.
export async function askImportPolicyWithConfirm(opts: {
  label: string;
  itemLabel?: string;
  conflictCount?: number;
  allow?: ImportPolicyAllow;
  protection: string;
}): Promise<ImportPolicy | undefined> {
  const policy = await askImportPolicy(opts);
  if (policy !== 'overwrite') return policy;
  const ok = await confirmOverwrite({
    label: opts.itemLabel ?? opts.label,
    count: opts.conflictCount,
    protection: opts.protection,
  });
  return ok ? policy : undefined;
}

// 완료 안내(공통 형식). label = 대상 이름(예: '글로벌 프리셋').
export function notifyImportDone(label: string, s: ImportSummary): void {
  getAppState().pushDialog({ type: 'yes-only', text: importDoneText(label, s) });
}
