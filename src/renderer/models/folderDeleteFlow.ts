// 「폴더와 프로젝트 모두 삭제」 절차(2026-10-02 B2, 의존성 주입 — jest 로 판단만 검증).
//
// 원인(코드 확정): 예전 절차는 안의 프로젝트마다 [미분류로 이동 → delete] 를 하고 결과를 확인하지 않은 채
// 폴더를 지웠다. 불러오지 않은(미로드) 프로젝트는 ResourceSyncService.delete 가 조용히 반환해 파일이
// 그대로 남았고, 이미 미분류로 옮겨진 상태라 「미분류로 이동」한 것처럼 보였다. 다른 창 잠금·예외도 같은 결과.
//
// 규칙:
//  · 프로젝트마다 먼저 불러온다(실패 → 그 프로젝트는 손대지 않고 실패로 남김).
//  · 미분류로 옮긴 뒤(구 배치는 .deleted 가 루트에 생겨야 폴더 디렉터리 제거 뒤에도 휴지통에 남는다) 삭제한다.
//  · 삭제 성공 판정 = 메모리에서 내려갔는가(삭제 관문이 파일 이동에 성공해야만 내린다).
//  · 실패한 프로젝트는 원래 폴더로 되돌린다(조용한 미분류 이동 금지).
//  · 하나라도 실패하면 폴더를 지우지 않는다. 폴더는 전부 휴지통으로 보낸 것을 확인한 뒤에만 지운다.
//  · 영구 삭제는 하지 않는다 — 삭제는 주입된 deleteProject(휴지통 관문)만 쓴다.

// ── 폴더 삭제 확인 창(2026-10-02 S5) ──
// 드로어(ProjectDrawer)와 프로젝트 브라우저(ProjectBrowser)가 같은 판단·문구를 쓴다.
// 개수는 실제 삭제 대상과 같은 기준(하위 폴더 포함 — SessionService.getProjectsInFolder)으로 센다.
// 예전 드로어는 직속만 세어, 하위 폴더에만 프로젝트가 있으면 단순 확인 뒤 deleteFolder 가
// 그 프로젝트들을 조용히 미분류로 옮겼다.

/** 프로젝트 폴더(projectFolder)가 folder 이거나 그 하위 폴더인가 — getProjectsInFolder 와 같은 규칙 */
export function isInFolderTree(
  projectFolder: string | null | undefined,
  folder: string,
): boolean {
  if (projectFolder == null) return false;
  return projectFolder === folder || projectFolder.startsWith(folder + '/');
}

export const FOLDER_DELETE_TEXT = {
  confirmEmpty: (leaf: string) => `폴더 "${leaf}"를 삭제할까요?`,
  chooseTitle: (leaf: string, n: number) =>
    `폴더 "${leaf}" 삭제 (그 안의 프로젝트 ${n}개, 하위 폴더 포함)`,
  folderOnly: '폴더만 삭제 (프로젝트는 미분류로 이동)',
  withProjects: '⚠️ 폴더와 프로젝트 모두 삭제',
  confirmWithProjects: (leaf: string, n: number) =>
    `정말 폴더 "${leaf}"와 그 안의 프로젝트 ${n}개(하위 폴더 포함)를 모두 삭제할까요?\n프로젝트는 휴지통으로 이동되어 복구할 수 있습니다.`,
} as const;

export type FolderDeletePrompt =
  /** 하위 폴더까지 프로젝트가 하나도 없음 → 단순 확인 */
  | { kind: 'empty'; text: string }
  /** 프로젝트가 있음(직속·하위 어디든) → [폴더만 / 모두 / 취소] 선택 */
  | {
      kind: 'choose';
      count: number;
      text: string;
      folderOnlyText: string;
      withProjectsText: string;
      confirmWithProjectsText: string;
    };

/** projectsInTree = 폴더와 하위 폴더의 프로젝트(sessionService.getProjectsInFolder(folder)) */
export function planFolderDeletePrompt(
  leafName: string,
  projectsInTree: readonly string[],
): FolderDeletePrompt {
  const count = projectsInTree.length;
  if (count === 0) {
    return { kind: 'empty', text: FOLDER_DELETE_TEXT.confirmEmpty(leafName) };
  }
  return {
    kind: 'choose',
    count,
    text: FOLDER_DELETE_TEXT.chooseTitle(leafName, count),
    folderOnlyText: FOLDER_DELETE_TEXT.folderOnly,
    withProjectsText: FOLDER_DELETE_TEXT.withProjects,
    confirmWithProjectsText: FOLDER_DELETE_TEXT.confirmWithProjects(
      leafName,
      count,
    ),
  };
}

export interface FolderDeleteDeps {
  /** 폴더와 하위 폴더에 속한 프로젝트 이름 */
  projectsInFolder: (folder: string) => string[];
  /** 프로젝트의 현재 폴더(null = 미분류) */
  folderOf: (name: string) => string | null;
  /** 프로젝트를 메모리에 불러온다. 불러왔으면 true */
  ensureLoaded: (name: string) => Promise<boolean>;
  isLoaded: (name: string) => boolean;
  moveToFolder: (name: string, folder: string | null) => Promise<void>;
  /** 휴지통 관문 삭제(SessionService.delete) */
  deleteProject: (name: string) => Promise<void>;
  /** 빈 폴더 항목 제거(SessionService.deleteFolder) */
  deleteFolder: (folder: string) => Promise<void>;
  onProgress?: (done: number, total: number) => void;
}

export interface FolderDeleteFailure {
  name: string;
  reason: string;
}

export interface FolderDeleteResult {
  total: number;
  deleted: string[];
  failed: FolderDeleteFailure[];
  folderDeleted: boolean;
  /** 프로젝트는 전부 지웠으나 폴더 항목 제거가 실패한 경우의 사유 */
  folderError?: string;
}

const errText = (e: unknown): string =>
  (e as any)?.message ? String((e as any).message) : String(e);

export async function runFolderDeleteWithProjects(
  folder: string,
  deps: FolderDeleteDeps,
): Promise<FolderDeleteResult> {
  const names = deps.projectsInFolder(folder);
  const deleted: string[] = [];
  const failed: FolderDeleteFailure[] = [];
  let done = 0;
  deps.onProgress?.(0, names.length);

  for (const name of names) {
    const origFolder = deps.folderOf(name);
    try {
      let loaded = false;
      try {
        loaded = await deps.ensureLoaded(name);
      } catch (e) {
        loaded = false;
      }
      if (!loaded) {
        failed.push({ name, reason: '프로젝트를 불러오지 못했습니다' });
        continue;
      }

      try {
        await deps.moveToFolder(name, null);
      } catch (e) {
        failed.push({ name, reason: `미분류로 옮기지 못했습니다(${errText(e)})` });
        continue;
      }
      if (deps.folderOf(name) !== null) {
        // moveToFolder 는 다른 창 잠금이면 조용히 반환한다
        failed.push({ name, reason: '다른 창에서 열려 있습니다' });
        continue;
      }

      let deleteError: unknown;
      try {
        await deps.deleteProject(name);
      } catch (e) {
        deleteError = e ?? new Error('알 수 없는 오류');
      }
      if (!deps.isLoaded(name)) {
        // 파일 이동(휴지통)에 성공해야만 메모리에서 내려간다 — 뒤따르는 부가 정리의 오류는 삭제 성공으로 본다
        deleted.push(name);
        continue;
      }

      let reason =
        deleteError !== undefined
          ? `삭제하지 못했습니다(${errText(deleteError)})`
          : '다른 창에서 열려 있어 삭제하지 못했습니다';
      if (origFolder !== null) {
        try {
          await deps.moveToFolder(name, origFolder);
        } catch (e) {
          // 아래 확인에서 처리
        }
        if (deps.folderOf(name) !== origFolder) {
          reason += ' — 원래 폴더로 되돌리지 못해 미분류에 있습니다';
        }
      }
      failed.push({ name, reason });
    } finally {
      deps.onProgress?.(++done, names.length);
    }
  }

  let folderDeleted = false;
  let folderError: string | undefined;
  if (failed.length === 0) {
    try {
      await deps.deleteFolder(folder);
      folderDeleted = true;
    } catch (e) {
      folderError = errText(e);
    }
  }
  return { total: names.length, deleted, failed, folderDeleted, folderError };
}
