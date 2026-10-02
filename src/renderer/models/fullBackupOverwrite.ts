// 전체 백업 복원 「덮어쓰기」의 기존 프로젝트 정리 판단(2026-10-02 S4, 의존성 주입 — jest 로 판단만 검증).
//
// 사용자 결정(2026-10-02 결정 3): 최악만 막는 최소 보강. 휴지통 이관·사전 백업은 하지 않는다.
//
// 결함(코드 확정): 예전 절차는 [sessionService.delete → trashService.permanentlyDeleteProject] 를
// 한 try 로 묶고 실패를 삼킨 뒤 같은 이름으로 가져오기를 진행했다. delete 가 실제로 지우지 못하는
// 두 경우(다른 창에서 열림 = throw 없이 반환, 불러오기 실패 = throw)에도 가져오기가 돌아
//  · 신 배치: 살아 있는 프로젝트 물리 폴더에 이미지가 병합되고 본문이 교체되며,
//  · 복사가 실패하면 롤백이 그 기존 프로젝트 폴더를 통째로 지울 수 있었다.
//
// 규칙:
//  · delete 가 예외를 던지면 → 건너뜀(가져오기·영구 삭제 모두 하지 않음).
//  · delete 뒤에도 목록에 그 이름이 남아 있으면 → 건너뜀. 이때 영구 삭제도 부르지 않는다
//    (지워지지 않은 상태에서 부르면 같은 이름의 더 오래된 휴지통 항목만 지울 수 있다).
//  · 목록에서 사라진 것이 확인된 뒤에만 기존 영구 삭제를 부르고 가져오기로 넘어간다.
//    영구 삭제의 실패는 예전과 같이 기록만 하고 가져오기를 막지 않는다(기존 프로젝트는 이미 휴지통).

export const FULL_BACKUP_OVERWRITE_TEXT = {
  blockedReason: '다른 창에서 열려 있거나 불러오지 못해 덮어쓰지 않았습니다',
  blockedCount: (n: number) => `${n}개 덮어쓰지 못함`,
  blockedDetail: (names: readonly string[]) =>
    `덮어쓰지 못한 프로젝트: ${names.map((n) => `「${n}」`).join(', ')}\n— ${FULL_BACKUP_OVERWRITE_TEXT.blockedReason}. 기존 프로젝트는 그대로이거나 휴지통에 있습니다.`,
} as const;

export interface FullBackupOverwriteDeps {
  /** 현재 프로젝트 목록(미로드 포함 — sessionService.list()) */
  listNames(): readonly string[];
  /** 지우기 직전 처리(현재 열린 프로젝트면 닫기 등) */
  beforeRemove?(name: string): void;
  /** 휴지통 관문 삭제(sessionService.delete) */
  remove(name: string): Promise<void>;
  /** 기존 영구 삭제(trashService.permanentlyDeleteProject) */
  purge(name: string): Promise<void>;
  /** 오류 기록(기본 console.error) */
  logError?(message: string, name: string, e: unknown): void;
}

export type FullBackupOverwriteOutcome =
  /** 기존 프로젝트가 목록에서 사라짐 — 같은 이름으로 가져와도 된다 */
  | { kind: 'cleared'; purged: boolean }
  /** 기존 프로젝트를 지우지 못함 — 가져오기 금지 */
  | { kind: 'blocked'; cause: 'remove-threw' | 'still-listed' };

export async function clearForFullBackupOverwrite(
  name: string,
  deps: FullBackupOverwriteDeps,
): Promise<FullBackupOverwriteOutcome> {
  const log =
    deps.logError ??
    ((m: string, n: string, e: unknown) => console.error(m, n, e));
  try {
    deps.beforeRemove?.(name);
    await deps.remove(name);
  } catch (e) {
    log('덮어쓰기용 기존 프로젝트 제거 실패 — 덮어쓰지 않음:', name, e);
    return { kind: 'blocked', cause: 'remove-threw' };
  }
  if (deps.listNames().includes(name)) {
    log(
      '덮어쓰기용 기존 프로젝트가 삭제되지 않음(다른 창 잠금 등) — 덮어쓰지 않음:',
      name,
      undefined,
    );
    return { kind: 'blocked', cause: 'still-listed' };
  }
  try {
    await deps.purge(name);
  } catch (e) {
    log('덮어쓰기용 기존 프로젝트 영구 삭제 실패(가져오기는 진행):', name, e);
    return { kind: 'cleared', purged: false };
  }
  return { kind: 'cleared', purged: true };
}
