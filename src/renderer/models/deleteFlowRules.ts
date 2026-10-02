// 삭제 흐름·입력 검증의 순수 판단(2026-10-03 정비 묶음 U2 — X3·X4·X12·X13·X15).
//
// UI·서비스·backend 의존 없음 — __tests__/deleteFlowRules.test.ts 로 판단만 검증한다.
//  · 「다시 묻지 않음」(appState.skipImageDeleteConfirm)은 **단일 이미지 삭제에만** 적용한다.
//    여러 장·일괄(모든 이미지·즐겨찾기 제외·여러 씬·선택분)은 항상 확인한다.
//  · 이미지 그리드 선택 모드의 「삭제」는 선택한 이미지만 지운다(씬 전체 삭제 메뉴를 열지 않는다).
//  · 삭제 결과는 실제로 사라졌는지 확인한 뒤에 안내한다(다른 창 잠금으로 조용히 돌아오면 실패로 셈 — SPEC §8).

// ── 이미지 삭제 확인 규칙 ──

/** 확인 창을 건너뛰어도 되는가 — 「다시 묻지 않음」이 켜져 있고 **정확히 1장**일 때만. */
export function shouldSkipImageDeleteConfirm(
  skipSetting: boolean,
  count: number,
): boolean {
  return !!skipSetting && count === 1;
}

/** 확인 창에 「다시 묻지 않음」 체크박스를 보일지 — 단일 이미지 삭제에서만. */
export function showImageDeleteSkipOption(count: number): boolean {
  return count === 1;
}

/** 선택한 이미지 삭제 확인 문구. */
export function selectedImagesDeleteText(
  count: number,
  retentionDays: number,
): string {
  return `선택한 ${count}장을 삭제할까요? (이미지 휴지통으로 이동, ${retentionDays}일 보관)`;
}

export const NO_SELECTED_IMAGES_MESSAGE = '선택된 이미지가 없습니다.';

// ── 이미지 그리드 「삭제」 버튼의 대상 결정(X3) ──

export type GridImageDeletePlan =
  /** 선택 모드 — 선택한 이미지(현재 목록에 남아 있는 것)만 삭제 */
  | { kind: 'selected'; paths: string[] }
  /** 선택 모드인데 남은 선택이 없음 — 안내만 */
  | { kind: 'empty-selection' }
  /** 선택 모드가 아님 — 기존 씬 전체 삭제 메뉴(모든 이미지/n등 이하/즐겨찾기 제외) */
  | { kind: 'scene-menu' };

/**
 * @param selectMode 이미지 선택 모드인가
 * @param selected 선택 집합(이미 지워진 경로가 남아 있을 수 있다)
 * @param current 현재 씬의 이미지 경로 목록 — 주면 여기 없는 선택은 버린다(표시 순서 유지)
 */
export function planGridImageDelete(
  selectMode: boolean,
  selected: Iterable<string>,
  current?: readonly string[],
): GridImageDeletePlan {
  if (!selectMode) return { kind: 'scene-menu' };
  const picked = new Set(selected);
  const paths = current
    ? current.filter((p) => picked.has(p))
    : Array.from(picked);
  if (paths.length === 0) return { kind: 'empty-selection' };
  return { kind: 'selected', paths };
}

// ── 일괄 결과 문구(X13) ──

/** 「삭제 N · 실패 N」 한 줄. 실패가 없으면 실패 부분을 뺀다. */
export function batchResultLine(
  done: number,
  failed: number,
  verb: string = '삭제',
): string {
  return failed > 0 ? `${verb} ${done} · 실패 ${failed}` : `${verb} ${done}`;
}

/** 실패한 이름 목록(최대 limit 개 + 「외 N」). */
export function failedNamesLine(
  names: readonly string[],
  limit = 5,
): string {
  if (names.length === 0) return '';
  const shown = names.slice(0, limit).map((n) => `「${n}」`).join(', ');
  const rest = names.length - limit;
  return rest > 0 ? `${shown} 외 ${rest}개` : shown;
}

/** 붙여넣기 결과 한 줄(X13) — 실패가 없으면 기존 문구와 같은 뜻. */
export function pasteResultText(copied: number, failed: number): string {
  if (failed === 0) return `${copied}장의 이미지가 붙여넣어졌습니다.`;
  return `이미지 붙여넣기: 성공 ${copied} · 실패 ${failed}`;
}

// ── 프로젝트·씬 삭제 결과 판정(X4) ──

export type TrashDeleteOutcome =
  /** 실제로 목록에서 사라짐 */
  | { kind: 'deleted' }
  /** 예외 없이 돌아왔지만 그대로 남아 있음(다른 창 잠금 등) */
  | { kind: 'still-present' }
  /** 예외 — 메시지 */
  | { kind: 'error'; message: string };

export interface TrashDeleteDeps {
  /** 휴지통 관문 삭제(sessionService.delete / trashService.moveSceneToTrash 등) */
  remove(): Promise<void>;
  /** 삭제 뒤에도 남아 있는가(sessionService.list() 에 이름이 있음 / session.hasScene) */
  stillExists(): boolean;
}

/** 휴지통 삭제를 실행하고 실제로 사라졌는지 판정한다. */
export async function runTrashDelete(
  deps: TrashDeleteDeps,
): Promise<TrashDeleteOutcome> {
  try {
    await deps.remove();
  } catch (e: any) {
    return { kind: 'error', message: (e && e.message) || String(e ?? '') };
  }
  return deps.stillExists() ? { kind: 'still-present' } : { kind: 'deleted' };
}

export const DELETE_RESULT_TEXT = {
  projectDeleted: (retentionDays: number) =>
    `프로젝트가 휴지통으로 이동되었습니다(${retentionDays}일 보관)`,
  sceneTemplateDeleted: (retentionDays: number) =>
    `씬 템플릿이 휴지통으로 이동되었습니다(${retentionDays}일 보관)`,
  projectStillPresent:
    '삭제하지 못했습니다(다른 창에서 열려 있을 수 있습니다).',
  sceneStillPresent:
    '씬을 삭제하지 못했습니다(다른 창에서 열려 있을 수 있습니다).',
} as const;

/** 프로젝트 삭제 결과 안내 문구 — 실패면 failMessage 우선, 없으면 기본. */
export function projectDeleteResultText(
  outcome: TrashDeleteOutcome,
  retentionDays: number,
  kind: 'project' | 'scene-template' = 'project',
): { ok: boolean; text: string } {
  if (outcome.kind === 'deleted') {
    return {
      ok: true,
      text:
        kind === 'project'
          ? DELETE_RESULT_TEXT.projectDeleted(retentionDays)
          : DELETE_RESULT_TEXT.sceneTemplateDeleted(retentionDays),
    };
  }
  if (outcome.kind === 'still-present') {
    return { ok: false, text: DELETE_RESULT_TEXT.projectStillPresent };
  }
  return {
    ok: false,
    text: outcome.message || '삭제에 실패했습니다.',
  };
}

// ── 커스텀 해상도 입력 검증(X15c) ──

export type CustomResolutionResult =
  | { ok: true; width: number; height: number; adjusted: boolean }
  | { ok: false; message: string };

export const CUSTOM_RESOLUTION_INVALID_MESSAGE = '올바른 숫자를 입력해주세요';

/**
 * 너비·높이 입력을 검증하고 64px 배수로 올림 보정한다(ResolutionPicker 규칙과 같음).
 * 빈칸·숫자 아님·0 이하는 거부한다(예전 대화상자는 빈칸이 0x0 으로 저장됐다).
 */
export function parseCustomResolution(
  widthText: string | number | null | undefined,
  heightText: string | number | null | undefined,
): CustomResolutionResult {
  const w = parsePositiveInt(widthText);
  const h = parsePositiveInt(heightText);
  if (w == null || h == null) {
    return { ok: false, message: CUSTOM_RESOLUTION_INVALID_MESSAGE };
  }
  const w64 = roundUpTo64(w);
  const h64 = roundUpTo64(h);
  return { ok: true, width: w64, height: h64, adjusted: w64 !== w || h64 !== h };
}

export function customResolutionAdjustedText(width: number, height: number): string {
  return `64px 배수로 보정되었습니다 — ${width}x${height}`;
}

function parsePositiveInt(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function roundUpTo64(n: number): number {
  return Math.max(64, Math.ceil(n / 64) * 64);
}

// ── 외부 파일에서 온 이미지 파일명 정제(X15b) ──

/**
 * 가져온 파일 안의 이미지 파일명이 저장 폴더 밖을 가리키지 못하게 한다.
 * 안전한 파일명(영숫자 시작, 영숫자·점·밑줄·하이픈, '..' 없음)이면 그대로, 아니면 새 이름.
 * @param isSafe projectTemplateBackup.isSafeImageToken
 * @param makeNew 새 파일명 생성(확장자 포함)
 */
export function safeImportedImageName(
  filename: unknown,
  isSafe: (base: string) => boolean,
  makeNew: () => string,
): { name: string; renamed: boolean } {
  if (typeof filename === 'string' && isSafe(filename)) {
    return { name: filename, renamed: false };
  }
  return { name: makeNew(), renamed: true };
}

// ── 변형 씬 이름 확정(X15a) ──

export type SceneRenameCheck =
  | { kind: 'unchanged' }
  | { kind: 'invalid'; message: string }
  | { kind: 'duplicate'; message: string }
  | { kind: 'ok'; name: string };

/**
 * 변형(인페인트) 씬의 새 이름을 확정해도 되는지 — 끝 공백 제거 후 판단.
 * 빈 이름·경로 구분자·점(.) 시작('.trash' 등 예약 폴더와 충돌)은 거부, 같은 종류 동명은 거부.
 */
export function checkInpaintSceneRename(
  oldName: string,
  typed: string,
  exists: (name: string) => boolean,
): SceneRenameCheck {
  const name = (typed ?? '').trimEnd();
  if (name === oldName) return { kind: 'unchanged' };
  if (!name.trim()) return { kind: 'invalid', message: '씬 이름을 입력해주세요.' };
  if (name.includes('/') || name.includes('\\') || name.startsWith('.')) {
    return {
      kind: 'invalid',
      message: '씬 이름에 / \\ 를 쓰거나 점(.)으로 시작할 수 없습니다.',
    };
  }
  if (exists(name)) {
    return {
      kind: 'duplicate',
      message: `같은 이름의 변형 씬 "${name}"이(가) 이미 있어 이름을 바꾸지 않았습니다.`,
    };
  }
  return { kind: 'ok', name };
}

// ── 프로젝트 JSON 「현재 프로젝트에 씬만 임포트」 덮어쓰기 확인(X10) ──

/** 가져올 씬 이름 중 현재 프로젝트에 이미 있는 것(가져올 파일 순서 유지). */
export function overlappingSceneNames(
  incoming: readonly string[],
  exists: (name: string) => boolean,
): string[] {
  return incoming.filter((n) => exists(n));
}

export function sceneImportOverwriteText(
  overlapping: readonly string[],
  limit = 5,
): string {
  return (
    `같은 이름의 씬 ${overlapping.length}개(${failedNamesLine(overlapping, limit)})의 프롬프트 구성과 해상도를 가져온 내용으로 바꿉니다.\n` +
    '기존 씬의 프롬프트 구성이 바뀝니다. 되돌릴 수 없습니다.\n계속할까요?'
  );
}
