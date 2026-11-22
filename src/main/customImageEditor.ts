/**
 * 「사용자 지정」 외부 이미지 편집기 실행(Windows 전용, 2026-11-22).
 *
 * 환경설정 `imageEditor: 'custom'` + `customImageEditorPath`(사용자가 고른 .exe)로 이미지를 연다.
 * - 경로 검사: 문자열 · 드라이브 문자로 시작하는 절대 경로(`C:\…`) · 확장자 `.exe`(대소문자 무관) ·
 *   실제 파일로 존재. 하나라도 아니면 실행하지 않고 오류를 던진다(.cmd·.bat 등 셸 해석 대상은 거부).
 * - 실행: `spawn(실행 파일, [이미지 절대 경로], { detached, shell:false, stdio:'ignore' })` — 셸을 거치지 않아
 *   공백·`&`·한글이 든 경로도 인자 하나로 전달된다. `'spawn'` 이벤트에서 `unref()` 후 완료, `'error'` 는 거부.
 *
 * electron 에 의존하지 않는다 — spawn·stat 은 주입 가능(테스트는 모킹으로만 확인, 실제 실행 없음).
 */
import { spawn as nodeSpawn } from 'child_process';
import { promises as fsPromises } from 'fs';
import path from 'path';

export const CUSTOM_IMAGE_EDITOR_ERROR = {
  notSet: '사용자 지정 이미지 편집기의 실행 파일이 지정되지 않았습니다. 환경설정 → 저장·이미지에서 선택해 주세요.',
  notAbsolute: '사용자 지정 이미지 편집기 경로가 올바른 절대 경로(예: C:\\…\\편집기.exe)가 아닙니다.',
  notExe: '사용자 지정 이미지 편집기는 실행 파일(.exe)만 지정할 수 있습니다.',
  notFound: '사용자 지정 이미지 편집기의 실행 파일을 찾을 수 없습니다. 환경설정 → 저장·이미지에서 다시 선택해 주세요.',
  launchFailed: (reason: string) => `이미지 편집기를 실행하지 못했습니다: ${reason}`,
};

type SpawnLike = (
  command: string,
  args: string[],
  options: { detached: boolean; shell: boolean; stdio: 'ignore' },
) => {
  once(event: 'spawn', cb: () => void): unknown;
  once(event: 'error', cb: (err: Error) => void): unknown;
  unref(): void;
};

export interface CustomImageEditorDeps {
  spawn?: SpawnLike;
  stat?: (p: string) => Promise<{ isFile(): boolean }>;
}

/** 경로 검사(파일 존재 확인 전 단계). 통과하면 undefined, 아니면 오류 문구. */
export function customImageEditorPathProblem(exePath: unknown): string | undefined {
  if (typeof exePath !== 'string' || exePath.trim() === '') return CUSTOM_IMAGE_EDITOR_ERROR.notSet;
  // 드라이브 문자 + 구분자로 시작해야 한다(`C:foo` 같은 드라이브 상대 경로·UNC·상대 경로 거부).
  if (!/^[A-Za-z]:[\\/]/.test(exePath) || !path.win32.isAbsolute(exePath)) {
    return CUSTOM_IMAGE_EDITOR_ERROR.notAbsolute;
  }
  if (path.win32.extname(exePath).toLowerCase() !== '.exe') return CUSTOM_IMAGE_EDITOR_ERROR.notExe;
  return undefined;
}

/**
 * 사용자 지정 편집기로 이미지를 연다. 검사 실패·실행 실패는 Error 로 거부한다(spawn 하지 않음).
 * imagePath 는 호출부가 절대 경로로 넘긴다.
 */
export async function launchCustomImageEditor(
  exePath: unknown,
  imagePath: string,
  deps: CustomImageEditorDeps = {},
): Promise<void> {
  const problem = customImageEditorPathProblem(exePath);
  if (problem) throw new Error(problem);
  const exe = exePath as string;
  const stat = deps.stat ?? ((p: string) => fsPromises.stat(p));
  let isFile = false;
  try {
    isFile = (await stat(exe)).isFile();
  } catch {
    isFile = false;
  }
  if (!isFile) throw new Error(CUSTOM_IMAGE_EDITOR_ERROR.notFound);

  const spawn = deps.spawn ?? (nodeSpawn as unknown as SpawnLike);
  await new Promise<void>((resolve, reject) => {
    let child: ReturnType<SpawnLike>;
    try {
      child = spawn(exe, [imagePath], { detached: true, shell: false, stdio: 'ignore' });
    } catch (e: any) {
      reject(new Error(CUSTOM_IMAGE_EDITOR_ERROR.launchFailed(e?.message ?? String(e))));
      return;
    }
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
    child.once('error', (err: Error) => {
      reject(new Error(CUSTOM_IMAGE_EDITOR_ERROR.launchFailed(err?.message ?? String(err))));
    });
  });
}
