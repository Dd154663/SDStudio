// 새 프로젝트 만들기 공용 흐름(2026-11-18 M5 묶음 c).
//
// 예전에는 상단 「새 프로젝트」 버튼(AppService.addSession)·프로젝트 서랍(ProjectDrawer)·프로젝트 탐색 창
// (ProjectBrowser)에 서로 조금씩 다른 코드가 세 벌 있었다. 이 파일이 단일 출처다(같은 계열: folderFlow.ts).
//
// 규칙(2026-11-18 사용자 결정):
//  · 이름 입력 = promptName + projectNameRules. 창 제목은 미분류 「신규 프로젝트 이름」, 폴더 「"폴더" 폴더에 새 프로젝트 이름」.
//  · 폴더 안에 만들면 폴더 기본 템플릿(조상 폴더 포함 resolveFolderTemplate)이 있을 때 묻지 않고 자동 적용(inherited: true)
//    + 적용 안내 토스트. 미분류(상단 버튼 포함)는 폴더 기본 템플릿을 조회하지 않는다.
//  · 그 밖에는 pickForCreate 로 템플릿을 고른다(전역 템플릿이 없으면 묻지 않고 빈 프로젝트, 취소하면 만들지 않음).
//  · 만든 뒤 폴더로 이동(실패는 조용히 넘김) → 연다 + 최근 프로젝트 목록 등록.
//  · 실패는 nameErrorMessage 로 만든 'error' 토스트. 되돌리기 기록 없음(프로젝트 만들기는 기록 대상이 아니다).
//  · 화면 후처리(서랍 닫기·탐색 창 닫기)는 호출부가 반환값(만든 이름)을 보고 한다.

import { projectTemplateService, sessionService, templateService } from '.';
import { getAppState } from './appStateRef';
import { nameErrorMessage, projectNameRules, promptName } from './nameInput';
import type { PromptNameOptions } from './nameInput';
import { pushRecentProject } from './recentProjects';
import type { ToastKind } from './toastKind';

export const PROJECT_CREATE_TEXT = {
  title: (folder: string | null) =>
    folder ? `"${folder}" 폴더에 새 프로젝트 이름` : '신규 프로젝트 이름',
  failed: '프로젝트 생성에 실패했습니다.',
  folderTemplateApplied: (tplName: string) =>
    `폴더 기본 템플릿 "${tplName}"이(가) 적용되었습니다.`,
} as const;

export interface ProjectCreateFlowDeps {
  /** 이름 입력 창(nameInput.promptName) */
  promptName(opts: PromptNameOptions): Promise<string | undefined>;
  /** 프로젝트 이름 규칙(nameInput.projectNameRules(sessionService)) */
  nameRules(): Omit<PromptNameOptions, 'title'>;
  /** 폴더 기본 템플릿(templateService.resolveFolderTemplate) — 없으면 undefined */
  resolveFolderTemplate(folder: string): Promise<{ templateId: string } | null | undefined>;
  /** 템플릿 고르기(projectTemplateService.pickForCreate) — null = 빈 프로젝트, undefined = 취소 */
  pickTemplate(): Promise<string | null | undefined>;
  templateName(templateId: string): string | undefined;
  createFromTemplate(templateId: string, name: string, inherited: boolean): Promise<void>;
  createEmpty(name: string): Promise<void>;
  moveToFolder(name: string, folder: string): Promise<void>;
  /** 연다(curSession 설정) — 프로젝트를 찾았으면 true */
  openProject(name: string): Promise<boolean>;
  pushRecentProject(name: string): void;
  pushMessage(msg: string, kind?: ToastKind): void;
}

/** 실제 앱 의존성 — 호출 시점에 해석한다(AppService 순환 import 회피, appStateRef 게이트). */
export function defaultProjectCreateFlowDeps(): ProjectCreateFlowDeps {
  return {
    promptName: (opts) => promptName(opts),
    nameRules: () => projectNameRules(sessionService),
    resolveFolderTemplate: (folder) => templateService.resolveFolderTemplate(folder),
    pickTemplate: () => projectTemplateService.pickForCreate(),
    templateName: (id) => projectTemplateService.get(id)?.name,
    createFromTemplate: async (id, name, inherited) => {
      await sessionService.createSessionFromProjectTemplate(id, name, { inherited });
    },
    createEmpty: async (name) => {
      await sessionService.add(name);
    },
    moveToFolder: (name, folder) => sessionService.moveToFolder(name, folder),
    openProject: async (name) => {
      const session = await sessionService.get(name);
      if (!session) return false;
      getAppState().curSession = session;
      return true;
    },
    pushRecentProject: (name) => pushRecentProject(name),
    pushMessage: (msg, kind) => getAppState().pushMessage(msg, kind),
  };
}

export interface CreateProjectFlowOptions {
  /** 만드는 폴더(논리 경로). 없으면 미분류 — 폴더 기본 템플릿을 조회하지 않는다. */
  folder?: string | null;
}

/** 새 프로젝트 만들기. 만든 프로젝트 이름(취소·실패면 undefined). */
export async function createProjectFlow(
  deps: ProjectCreateFlowDeps,
  opts: CreateProjectFlowOptions = {},
): Promise<string | undefined> {
  const folder = opts.folder || null;
  // 이름 규칙·중복(어느 폴더에 있는지 포함)은 입력 창 안에서 검사(D2)
  const name = await deps.promptName({
    title: PROJECT_CREATE_TEXT.title(folder),
    ...deps.nameRules(),
  });
  if (!name) return undefined;

  // 폴더 기본 템플릿(조상 폴더 포함)이 있으면 고르기 창 없이 자동 적용
  const folderTpl = folder ? await deps.resolveFolderTemplate(folder) : undefined;
  let tplId: string | null;
  if (folderTpl) {
    tplId = folderTpl.templateId;
  } else {
    const picked = await deps.pickTemplate();
    if (picked === undefined) return undefined; // 템플릿 고르기 취소
    tplId = picked;
  }

  try {
    if (tplId) {
      // 폴더 자동 적용이면 상속 링크(♟)를 남긴다. 수동 선택은 inherited=false.
      await deps.createFromTemplate(tplId, name, !!folderTpl);
    } else {
      await deps.createEmpty(name);
    }
    if (folder) {
      try {
        await deps.moveToFolder(name, folder);
      } catch (e) {}
    }
    if (await deps.openProject(name)) deps.pushRecentProject(name);
    if (folderTpl) {
      deps.pushMessage(
        PROJECT_CREATE_TEXT.folderTemplateApplied(deps.templateName(folderTpl.templateId) ?? ''),
      );
    }
    return name;
  } catch (e: any) {
    deps.pushMessage(nameErrorMessage(e, 'project', name, PROJECT_CREATE_TEXT.failed), 'error');
    return undefined;
  }
}
