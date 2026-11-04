// 저장 경로 변경 흐름(환경설정 「저장경로」, PC 전용) — 2026-11-04 안전장치.
//
// 저장 경로는 main 이 부팅 때만 데이터 루트로 반영한다. 예전 흐름은 「껐다 켜주세요」 안내만 하고
// 재시작을 강제하지 않아, 재시작 전 생성분은 이전 위치에 저장되고 재시작 뒤 새 위치는 빈 저장소라
// 「전부 사라짐」으로 보였다. 이 흐름은:
//   1) 폴더 선택 → 쓰기 검사(check-writable, 하위 데이터 폴더 포함 — 실패하면 그 폴더·코드를 보여 주고 거부)
//   2) 저장 전 선택 창(select): 데이터가 자동으로 옮겨지지 않음·옮기는 방법·재시작 전엔 이전 위치에 저장
//      [지금 재시작] = 저장 뒤 restartApp(종료 시 각 창 flush 보장) · [나중에 재시작] = 저장만 + 보류 표시
//      · 내장 취소/Esc = 아무것도 바꾸지 않음
//   3) 보류 상태는 appState.saveLocationPending(세션 메모리 — 이 창 한정)에 둔다. 실제 데이터 루트
//      표시는 getDataRoot 그대로, 새 경로는 「다음 부팅부터」로 따로 보인다.
// 문구·선택지 값은 src/shared/saveLocationChange.ts 단일 출처. 데이터 이동·복사는 하지 않는다.

import type { Config } from '../../main/config';
import type { Dialog } from '../componenets/ConfirmWindow';
import { INSIDE_INSTALL_DIR_CODE, INSTALL_DIR_TEXT } from '../../shared/installDir';
import {
  CheckWritableOptions,
  CheckWritableResult,
  SAVE_LOCATION_CHANGE_TEXT,
  SAVE_LOCATION_CHOICE,
} from '../../shared/saveLocationChange';

export interface SaveLocationPending {
  // 지금 실제로 저장되는 위치(get-data-root).
  previousRoot: string;
  // 다음 부팅부터 쓸 위치(config.saveLocation).
  nextRoot: string;
}

export interface SaveLocationFlowDeps {
  backend: {
    selectDir(): Promise<string | undefined>;
    checkWritable(p: string, o?: CheckWritableOptions): Promise<CheckWritableResult>;
    getDataRoot(): Promise<string>;
    getConfig(): Promise<Config>;
    setConfig(c: Config): Promise<void>;
    restartApp(): Promise<void>;
  };
  appState: {
    pushDialog(d: Dialog): void;
    pushDialogAsync(d: Dialog): Promise<string | undefined>;
    saveLocationPending: SaveLocationPending | null;
  };
}

export type SaveLocationFlowResult =
  | { kind: 'cancelled' }
  | { kind: 'rejected' }
  | { kind: 'same'; folder: string }
  | { kind: 'restarting'; folder: string }
  | { kind: 'pending'; folder: string };

// 표시·비교용 경로 정규화: 구분자 통일, 끝 구분자 제거, Windows 식 경로(드라이브 문자·역슬래시)는
// 대소문자 무시. main 의 DEFAULT_APP_DIR 이 '/' 결합이라 같은 폴더가 다른 모양으로 올 수 있다.
export function normalizeRootForCompare(p: string): string {
  if (!p) return '';
  const winLike = /^[a-zA-Z]:/.test(p) || p.includes('\\');
  let s = p.replace(/\\/g, '/');
  while (s.length > 1 && s.endsWith('/') && !/^[a-zA-Z]:\/$/.test(s)) s = s.slice(0, -1);
  return winLike ? s.toLowerCase() : s;
}

export function sameRoot(a: string, b: string): boolean {
  return !!a && !!b && normalizeRootForCompare(a) === normalizeRootForCompare(b);
}

// 쓰기 검사 결과 → 거부 문구(통과면 null).
export function checkRejectText(check: CheckWritableResult): string | null {
  if (check.ok) return null;
  if (check.code === INSIDE_INSTALL_DIR_CODE) return INSTALL_DIR_TEXT.selectRejected;
  if (check.failedPath) return SAVE_LOCATION_CHANGE_TEXT.subdirNotWritable(check.failedPath, check.code);
  return SAVE_LOCATION_CHANGE_TEXT.notWritable(check.code);
}

export async function runSaveLocationChange(
  deps: SaveLocationFlowDeps,
): Promise<SaveLocationFlowResult> {
  const { backend, appState } = deps;
  const folder = await backend.selectDir();
  if (!folder) return { kind: 'cancelled' };
  // 저장 전에 실제 쓰기 가능 여부를 검증한다(권한 없는 드라이브 → 다음 부팅 벽돌화 예방). 이미 데이터가
  // 있는 폴더면 그 데이터 폴더·프로젝트 폴더까지 본다(루트만 쓰기 가능하고 안이 읽기 전용인 경우).
  const check = await backend.checkWritable(folder, { dataSubdirs: true });
  const reject = checkRejectText(check);
  if (reject) {
    appState.pushDialog({ type: 'yes-only', text: reject });
    return { kind: 'rejected' };
  }
  const currentRoot = await backend.getDataRoot().catch(() => '');
  // 지금 쓰고 있는 위치를 다시 고른 경우(보류를 되돌리는 경우 포함) — 저장만 하고 재시작은 묻지 않는다.
  if (sameRoot(folder, currentRoot)) {
    const config = await backend.getConfig();
    config.saveLocation = folder;
    await backend.setConfig(config);
    appState.saveLocationPending = null;
    appState.pushDialog({ type: 'yes-only', text: SAVE_LOCATION_CHANGE_TEXT.sameAsCurrent });
    return { kind: 'same', folder };
  }
  const choice = await appState.pushDialogAsync({
    type: 'select',
    text: SAVE_LOCATION_CHANGE_TEXT.changeDialog(currentRoot, folder),
    items: [
      { text: SAVE_LOCATION_CHANGE_TEXT.restartNow, value: SAVE_LOCATION_CHOICE.restartNow },
      { text: SAVE_LOCATION_CHANGE_TEXT.restartLater, value: SAVE_LOCATION_CHOICE.restartLater },
    ],
  });
  if (choice !== SAVE_LOCATION_CHOICE.restartNow && choice !== SAVE_LOCATION_CHOICE.restartLater) {
    return { kind: 'cancelled' };
  }
  const config = await backend.getConfig();
  config.saveLocation = folder;
  await backend.setConfig(config);
  // 재시작 전까지는 이전 위치에 저장되므로 「지금 재시작」도 재시작이 실패할 때를 대비해 먼저 보류로 둔다.
  appState.saveLocationPending = { previousRoot: currentRoot, nextRoot: folder };
  if (choice === SAVE_LOCATION_CHOICE.restartNow) {
    const restarted = await restartForSaveLocation(deps);
    if (restarted) return { kind: 'restarting', folder };
  }
  return { kind: 'pending', folder };
}

// 보류 표시의 「지금 재시작」 버튼·선택 창 공용. 실패하면 안내하고 false.
export async function restartForSaveLocation(deps: SaveLocationFlowDeps): Promise<boolean> {
  try {
    await deps.backend.restartApp();
    return true;
  } catch (e: any) {
    deps.appState.pushDialog({
      type: 'yes-only',
      text: SAVE_LOCATION_CHANGE_TEXT.restartFailed(String(e?.message ?? e)),
    });
    return false;
  }
}

// 부팅 하위 폴더 쓰기 경고(get-boot-warnings 의 saveLocationSubdirWarning)를 메인 UI 가 뜬 뒤 한 번만
// 안내한다(App.tsx 효과가 부른다 — 설치 폴더 경고와 같은 방식). 안내하면 상태를 비워 다시 뜨지 않는다.
export function showSubdirBootWarningOnce(state: {
  bootReady: boolean;
  saveLocationSubdirWarning: { path: string; code: string } | null;
  pushDialog(d: Dialog): void;
}): boolean {
  const sub = state.saveLocationSubdirWarning;
  if (!state.bootReady || !sub) return false;
  state.saveLocationSubdirWarning = null;
  state.pushDialog({
    type: 'yes-only',
    text: SAVE_LOCATION_CHANGE_TEXT.bootSubdirWarning(sub.path, sub.code),
  });
  return true;
}
