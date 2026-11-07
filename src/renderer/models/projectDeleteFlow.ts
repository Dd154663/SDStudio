// 프로젝트 삭제(휴지통 이동) 관문 — 현재 열린 프로젝트 닫기 규칙의 단일 출처(2026-11-03).
//
// 결함(사용자 실기 보고 2026-11-03): 복제본(복제 직후 현재 프로젝트로 열림)을 프로젝트 드로어
// 삭제 메뉴로 지우면 삭제는 되지만 열린 채로 남아, 씬을 누르면 「미등록 프로젝트의 경로를 요청함」
// 토스트가 났다. SessionService.delete 가 신 배치에서 unregisterProjectDir 를 부른 뒤라 그 프로젝트의
// 경로 해석이 거부된다. 원인은 삭제 호출부마다 「현재 프로젝트면 닫기」 처리가 제각각이던 것
// (툴바·폴더 흐름은 닫고, 드로어·씬 템플릿 관리자는 닫지 않음).
//
// 규칙:
//  · 삭제는 sessionService.delete 관문 그대로(새 직접 파일 쓰기·withLock 없음). 미로드 대비로
//    먼저 불러온다(드로어 경로와 같음 — 불러오기 실패도 delete 가 예외로 알린다).
//  · 결과 판정은 deleteFlowRules.runTrashDelete(X4) 그대로: 예외 / 목록에 남음(다른 창 잠금) / 사라짐.
//  · 닫기 = 현재 프로젝트 이름이 같고 **더는 메모리에 로드돼 있지 않을 때만**.
//    - 메모리에서 내려갔다 = 파일 이동(휴지통)이 성공했다(ResourceSyncService.delete 는 rename 성공 뒤에만
//      엔트리를 지운다). 이 뒤에는 신 배치에서 경로 등록도 풀려 있으므로 열린 채 두면 위 결함이 난다.
//    - 다른 창 잠금으로 조용히 돌아옴·이동 전 예외 = 여전히 로드돼 있음 → 유지(실패 안내만).
//    - 이동 뒤 부가 정리(즐겨찾기·북마크 저장 등)의 예외 = 이미 내려갔음 → 닫는다. 폴더 일괄 삭제
//      (folderDeleteFlow)의 기존 판정(finally 에서 !isLoaded 면 닫음)과 같다.
//  · 화면 갱신(빈 상태)은 App 이 curSession 없음을 그대로 그린다(툴바 삭제와 같은 결과).
//  · 관문 강제(2026-11-07 규약 「프로젝트 삭제는 반드시 공용 흐름을 거친다」): sessionService.delete( 의
//    직접 호출은 이 파일 안에서만 허용한다(specGuard). 백업 덮어쓰기처럼 호출부가 현재 프로젝트
//    닫기·다시 열기 순서를 스스로 관리하는 흐름은 closeCurrent:false 로 경유한다
//    (deleteProjectForReplaceFlow).

import { sessionService } from '.';
import { getAppState } from './appStateRef';
import { runTrashDelete, type TrashDeleteOutcome } from './deleteFlowRules';

/** runTrashDelete 결과 + 현재 프로젝트를 닫았는가. projectDeleteResultText 에 그대로 넘길 수 있다. */
export type ProjectDeleteOutcome = TrashDeleteOutcome & { closedCurrent: boolean };

export interface ProjectDeleteDeps {
  /** 미로드 대비 불러오기(sessionService.get) */
  load(name: string): Promise<unknown>;
  /** 휴지통 관문 삭제(sessionService.delete) */
  remove(name: string): Promise<unknown>;
  /** 목록에 남아 있는가(sessionService.list().includes) */
  exists(name: string): boolean;
  /** 메모리에 로드돼 있는가(sessionService.isLoaded) */
  isLoaded(name: string): boolean;
  /** 현재 열린 프로젝트 이름(appState.curSession?.name) */
  currentName(): string | undefined;
  /** 현재 프로젝트 닫기(appState.curSession = undefined) */
  closeCurrent(): void;
}

/** 실제 앱 의존성 — 호출 시점에 해석한다(AppService 순환 import 회피, appStateRef 게이트). */
export function defaultProjectDeleteDeps(): ProjectDeleteDeps {
  return {
    load: (name) => sessionService.get(name),
    remove: (name) => sessionService.delete(name),
    exists: (name) => sessionService.list().includes(name),
    isLoaded: (name) => sessionService.isLoaded(name),
    currentName: () => getAppState().curSession?.name,
    closeCurrent: () => {
      getAppState().curSession = undefined;
    },
  };
}

/** 삭제 뒤 현재 프로젝트를 닫아야 하는가 — 이름이 같고 더는 로드돼 있지 않음. */
export function shouldCloseCurrentAfterDelete(
  name: string,
  currentName: string | undefined,
  stillLoaded: boolean,
): boolean {
  return currentName === name && !stillLoaded;
}

export interface ProjectDeleteOptions {
  /**
   * 지워진 것이 현재 프로젝트면 닫는가(기본 true). false = 호출부가 삭제 전에 이미 닫고 끝난 뒤 다시
   * 여는 흐름(백업 덮어쓰기 — 같은 이름으로 다시 만든다)이라 관문은 닫기를 건너뛴다.
   */
  closeCurrent?: boolean;
}

/**
 * 프로젝트(씬 템플릿 숨김 프로젝트 포함) 한 개를 휴지통으로 옮기고, 지워진 것이 현재 프로젝트면 닫는다.
 * 안내 문구는 호출부가 projectDeleteResultText(결과, …) 로 만든다(문구 종류는 호출부마다 다름).
 */
export async function runProjectTrashDelete(
  name: string,
  deps: ProjectDeleteDeps = defaultProjectDeleteDeps(),
  options: ProjectDeleteOptions = {},
): Promise<ProjectDeleteOutcome> {
  const allowClose = options.closeCurrent !== false;
  let closedCurrent = false;
  const closeIfGone = () => {
    if (
      allowClose &&
      shouldCloseCurrentAfterDelete(name, deps.currentName(), deps.isLoaded(name))
    ) {
      deps.closeCurrent();
      closedCurrent = true;
    }
  };
  let outcome: TrashDeleteOutcome;
  try {
    outcome = await runTrashDelete({
      remove: async () => {
        await deps.load(name);
        await deps.remove(name);
      },
      stillExists: () => deps.exists(name),
    });
  } catch (e) {
    // runTrashDelete 는 remove 예외를 결과로 바꾸므로 여기는 exists() 자체의 예외 같은 비정상 경로뿐 —
    // 그래도 이미 메모리에서 내려갔으면 닫고 예외는 그대로 올린다.
    closeIfGone();
    throw e;
  }
  // 예외 결과여도 이미 메모리에서 내려갔으면 닫는다(위 규칙)
  closeIfGone();
  return { ...outcome, closedCurrent };
}

/**
 * 폴더 일괄 삭제(folderDeleteFlow.runFolderDeleteWithProjects)의 deleteProject 콜백 어댑터.
 * 그 흐름은 예외 메시지를 실패 사유에 쓰고 성공 판정은 isLoaded 로 따로 하므로, 예외 결과는
 * 같은 메시지로 다시 던진다(닫기는 위 규칙 — 기존 finally 닫기와 같은 조건).
 */
export async function deleteProjectForFolderFlow(
  name: string,
  deps: ProjectDeleteDeps = defaultProjectDeleteDeps(),
): Promise<ProjectDeleteOutcome> {
  const r = await runProjectTrashDelete(name, deps);
  if (r.kind === 'error') {
    throw new Error(r.message || '알 수 없는 오류');
  }
  return r;
}

/**
 * 백업 덮어쓰기(BackupService — 전체 백업 복원 덮어쓰기·프로젝트 백업 덮어쓰기)의 remove 콜백 어댑터.
 * 그 흐름들은 삭제 전에 현재 프로젝트를 스스로 닫고(beforeRemove/beforeSwap), 실패는 예외로,
 * 남아 있음은 목록 재확인으로 판정하며, 끝나면 같은 이름 프로젝트를 다시 연다 — 그래서 관문의
 * 닫기는 끄고(closeCurrent:false) 예외 결과만 같은 메시지로 다시 던진다. 되돌리기 기록 없음
 * (백업 복원·덮어쓰기는 되돌리기 제외 ③).
 */
export async function deleteProjectForReplaceFlow(
  name: string,
  deps: ProjectDeleteDeps = defaultProjectDeleteDeps(),
): Promise<ProjectDeleteOutcome> {
  const r = await runProjectTrashDelete(name, deps, { closeCurrent: false });
  if (r.kind === 'error') {
    throw new Error(r.message || '알 수 없는 오류');
  }
  return r;
}
