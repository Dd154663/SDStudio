// 프로젝트 폴더 만들기·복제 공용 흐름(2026-11-16 M5 묶음 a, P7 — 동작 불변 리팩터).
//
// 예전에는 프로젝트 서랍(ProjectDrawer)과 프로젝트 탐색 창(ProjectBrowser)에 문구까지 같은 코드가 두 벌 있었다.
// 이 파일이 단일 출처다(같은 계열: folderDeleteFlow.ts = 폴더 삭제).
//
// 규칙:
//  · 폴더 경로는 논리 경로(「상위/하위」)다 — 실제 디렉터리 경로는 SessionService 가 projectPaths 관문으로 만든다.
//  · 만들기 = 이름 입력(「상위/하위」 허용, 단계마다 경로 안전 검사, 같은 경로 폴더는 창 안에서 거부)
//    → createFolderRecorded(되돌리기 기록 포함, 종전 그대로).
//  · 복제 = 이름 입력(제안값 suggestFolderCopyName — M2 규칙 「X 복사본」·「X 복사본 (2)」, 같은 자리 폴더와 겹치면 거부)
//    → 이미지 포함 여부 → 진행 창 → sessionService.cloneFolder. 되돌리기 기록 없음(원장상 제외 그대로).
//  · 화면 후처리(서랍 = 펼침 상태, 탐색 창 = 보기 이동·새로고침)는 호출부 콜백. 콜백은 종전처럼 try 안에서 부른다
//    (콜백 예외도 실패 토스트로 이어진다).
//  · 실패 토스트는 두 호출부 모두 'error' 명시(2026-11-16 피드백 1 — 종전 서랍은 문구로 추론, 탐색 창은 error).

import { sessionService } from '.';
import { getAppState } from './appStateRef';
import { promptName, suggestFolderCopyName } from './nameInput';
import type { PromptNameOptions } from './nameInput';
import { createFolderRecorded } from './projectFolderUndo';
import type { Dialog } from '../componenets/ConfirmWindow';
import type { ProgressDialog } from '../componenets/ProgressWindow';
import type { ToastKind } from './toastKind';

export const FOLDER_FLOW_TEXT = {
  /** parentLeaf = 부모 폴더 표시 이름(없으면 루트에 만들기) */
  createTitle: (parentLeaf: string | null) =>
    parentLeaf !== null
      ? `"${parentLeaf}" 안에 새 폴더 (예: 서브폴더 또는 상위/하위)`
      : '새 폴더 이름을 입력하세요 (예: 폴더 또는 상위/하위)',
  createFailed: '폴더 생성에 실패했습니다.',
  duplicateTitle: (leaf: string) => `"${leaf}" 폴더를 복제합니다. 새 폴더 이름을 입력하세요.`,
  duplicateModePrompt: '이미지 파일을 함께 복사할까요?',
  duplicateModeConfig: '설정만 복사 (프롬프트, 프리셋 등)',
  duplicateModeWithImages: '이미지 포함 복사 (휴지통 제외)',
  duplicateProgress: '폴더 복제 중...',
  duplicateDone: (name: string) => `"${name}" 폴더로 복제되었습니다.`,
  duplicateFailed: '폴더 복제에 실패했습니다.',
} as const;

export interface FolderFlowDeps {
  folderLeafName(path: string): string;
  folderParentPath(path: string): string | null;
  listFolders(): string[];
  /** 이름 입력 창(nameInput.promptName) */
  promptName(opts: PromptNameOptions): Promise<string | undefined>;
  /** 폴더 만들기(projectFolderUndo.createFolderRecorded — 되돌리기 기록 포함) */
  createFolder(fullPath: string): Promise<void>;
  /** 폴더 복제(sessionService.cloneFolder) */
  cloneFolder(source: string, target: string, withImages: boolean): Promise<void>;
  /** 선택 창(appState.pushDialogAsync) — 취소면 undefined */
  ask(dialog: Dialog): Promise<string | undefined>;
  setProgressDialog(dialog: ProgressDialog | undefined): void;
  pushMessage(msg: string, kind?: ToastKind): void;
}

/** 실제 앱 의존성 — 호출 시점에 해석한다(AppService 순환 import 회피, appStateRef 게이트). */
export function defaultFolderFlowDeps(): FolderFlowDeps {
  return {
    folderLeafName: (path) => sessionService.folderLeafName(path),
    folderParentPath: (path) => sessionService.folderParentPath(path),
    listFolders: () => sessionService.listFolders(),
    promptName: (opts) => promptName(opts),
    createFolder: (fullPath) => createFolderRecorded(fullPath),
    cloneFolder: (source, target, withImages) =>
      sessionService.cloneFolder(source, target, withImages),
    ask: (dialog) => getAppState().pushDialogAsync(dialog),
    setProgressDialog: (dialog) => getAppState().setProgressDialog(dialog),
    pushMessage: (msg, kind) => getAppState().pushMessage(msg, kind),
  };
}

export interface CreateFolderFlowOptions {
  /** 부모 폴더(없으면 루트) */
  parentPath?: string;
  /** 만든 뒤 화면 후처리(서랍 = 펼침, 탐색 창 = 그 폴더로 이동·새로고침) */
  onCreated?: (fullPath: string) => void;
}

/** 새 폴더 만들기. 만든 폴더 경로(취소·실패면 undefined). */
export async function createFolderFlow(
  deps: FolderFlowDeps,
  opts: CreateFolderFlowOptions = {},
): Promise<string | undefined> {
  const { parentPath } = opts;
  const hint = FOLDER_FLOW_TEXT.createTitle(parentPath ? deps.folderLeafName(parentPath) : null);
  // 「상위/하위」 경로 입력 허용 — 단계마다 경로 안전 검사, 같은 경로의 폴더는 창 안에서 거부(D2)
  const toFull = (v: string) => (parentPath ? parentPath + '/' + v : v);
  const value = await deps.promptName({
    title: hint,
    kind: 'folder',
    pathSafe: true,
    allowSlash: true,
    existing: (v) => deps.listFolders().includes(toFull(v)),
  });
  if (!value) return undefined;
  const fullPath = toFull(value);
  try {
    await deps.createFolder(fullPath);
    opts.onCreated?.(fullPath);
    return fullPath;
  } catch (e: any) {
    deps.pushMessage(e.message || FOLDER_FLOW_TEXT.createFailed, 'error');
    return undefined;
  }
}

export interface DuplicateFolderFlowOptions {
  /** 복제가 끝난 뒤(진행 창을 닫은 다음, 완료 토스트 전) 화면 후처리 — 탐색 창 = 새로고침 */
  onDuplicated?: (targetPath: string) => void;
}

/** 폴더 복제(같은 부모 아래). 만든 폴더 경로(취소·실패면 undefined). */
export async function duplicateFolderFlow(
  deps: FolderFlowDeps,
  sourceFolder: string,
  opts: DuplicateFolderFlowOptions = {},
): Promise<string | undefined> {
  const leafName = deps.folderLeafName(sourceFolder);
  const parent = deps.folderParentPath(sourceFolder);
  const toTarget = (v: string) => (parent ? parent + '/' + v : v);
  // 원본 이름 기반 제안값을 채워 연다(D2) — 같은 자리의 폴더와 겹치면 창 안에서 거부
  const value = await deps.promptName({
    title: FOLDER_FLOW_TEXT.duplicateTitle(leafName),
    initial: suggestFolderCopyName(leafName, (v) => deps.listFolders().includes(toTarget(v))),
    kind: 'folder',
    pathSafe: true,
    existing: (v) => deps.listFolders().includes(toTarget(v)),
  });
  if (!value) return undefined;

  const mode = await deps.ask({
    text: FOLDER_FLOW_TEXT.duplicateModePrompt,
    type: 'select',
    items: [
      { text: FOLDER_FLOW_TEXT.duplicateModeConfig, value: 'config' },
      { text: FOLDER_FLOW_TEXT.duplicateModeWithImages, value: 'with-images' },
    ],
  });
  if (!mode) return undefined;

  const withImages = mode === 'with-images';
  const targetPath = toTarget(value);
  try {
    deps.setProgressDialog({ text: FOLDER_FLOW_TEXT.duplicateProgress, done: 0, total: 1 });
    await deps.cloneFolder(sourceFolder, targetPath, withImages);
    deps.setProgressDialog(undefined);
    opts.onDuplicated?.(targetPath);
    deps.pushMessage(FOLDER_FLOW_TEXT.duplicateDone(value));
    return targetPath;
  } catch (e: any) {
    deps.setProgressDialog(undefined);
    deps.pushMessage(e.message || FOLDER_FLOW_TEXT.duplicateFailed, 'error');
    return undefined;
  }
}
