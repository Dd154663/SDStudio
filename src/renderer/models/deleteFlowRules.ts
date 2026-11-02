// 삭제 흐름·입력 검증의 순수 판단(2026-10-03 정비 묶음 U2 — X3·X4·X12·X13·X15).
//
// UI·서비스·backend 의존 없음 — __tests__/deleteFlowRules.test.ts 로 판단만 검증한다.
//  · 「다시 묻지 않음」(appState.skipImageDeleteConfirm)은 **씬 이미지 삭제 전부**에 장수와 무관하게 적용한다
//    (단일·선택분·모든 이미지·즐겨찾기 제외·n등 이하·여러 씬 일괄·기록 — v5.4.0 범위, 2026-10-08 X12 제한 되돌림).
//    씬·프로젝트·템플릿·폴더 삭제와 휴지통 영구 삭제에는 적용하지 않는다. n등 이하는 입력 창을 늘 띄우고 그 뒤 확인만 생략한다.
//    예외: 대량 작업 「⚠️ 즐겨찾기한 이미지만 삭제」는 설정과 무관하게 늘 확인 2회(planFavOnlyImageDelete, 2026-11-01 A8).
//    검수(ImageReview)는 v5.4.0 과 같이 설정과 무관(일반 삭제는 항상 확인, Alt+→ 는 즉시 삭제).
//  · 이미지 그리드 선택 모드의 「삭제」는 선택한 이미지만 지운다(씬 전체 삭제 메뉴를 열지 않는다).
//  · 삭제 결과는 실제로 사라졌는지 확인한 뒤에 안내한다(다른 창 잠금으로 조용히 돌아오면 실패로 셈 — SPEC §8).

import type { ConfirmDanger } from './confirmKeys';
import { josaEulReul, NAME_KIND_LABEL, type NameKind } from './nameInput';

// ── 삭제 확인 문구 — 단일 출처(2026-10-03 E1, SPEC_GUIDE §8 「삭제 확인 문구」) ──
//
// 삭제 확인 창의 본문·[확인] 라벨·위험도는 이 함수 하나로 만든다(호출부에서 「정말로 삭제…」 직접 작성 금지 — specGuard).
//  · 휴지통으로 가는 삭제: 「{대상}을(를) 삭제할까요? / 휴지통으로 이동되어 N일 동안 복원할 수 있습니다.」
//    [삭제] · danger true(Enter = 확인). N 은 호출부가 TrashService 의 보존 일수 상수로 넘긴다(리터럴 금지).
//  · 되돌릴 수 없는 삭제: 「{대상}을(를) 영구 삭제할까요? / 이 작업은 되돌릴 수 없습니다.」
//    [영구 삭제] · danger 'permanent'(Enter 무시 — 버튼을 직접 눌러야 한다).
//  · 대상: 단건 「{종류} "{이름}"」(이름 없으면 「이 {종류}」), 복수 「{종류} {count}개」(이미지 장·작가 명).
//  · extra: 본문 끝에 덧붙일 줄(첨부 이미지도 함께 삭제됨·모든 프로젝트에 영향 등).

export type DeleteTargetKind = NameKind;

export type DeleteOutcome = { trashDays: number } | 'permanent';

export interface DeleteConfirmInput {
  kind: DeleteTargetKind;
  /** 단건 대상의 이름(없으면 「이 {종류}」) */
  name?: string;
  /** 여러 개 — 주면 이름 대신 개수로 적는다 */
  count?: number;
  outcome: DeleteOutcome;
  /** 본문 끝에 덧붙일 안내(줄 단위) */
  extra?: string;
}

export interface DeleteConfirmText {
  text: string;
  confirmText: string;
  danger: ConfirmDanger;
}

/** 개수 단위 — 기본 「개」. */
const DELETE_COUNT_UNIT: Partial<Record<DeleteTargetKind, string>> = {
  image: '장',
  sampleImage: '장',
  artist: '명',
};

/** 문구의 대상 부분(「씬 "이름"」·「이미지 3장」·「이 조각그룹」)과 그 뒤에 붙일 을/를. */
export function deleteTargetPhrase(
  kind: DeleteTargetKind,
  name?: string,
  count?: number,
): { phrase: string; josa: string } {
  const label = NAME_KIND_LABEL[kind];
  if (count !== undefined) {
    const unit = DELETE_COUNT_UNIT[kind] ?? '개';
    const phrase = `${label} ${count}${unit}`;
    return { phrase, josa: josaEulReul(unit) };
  }
  if (name !== undefined && name !== '') {
    return { phrase: `${label} "${name}"`, josa: josaEulReul(name) };
  }
  return { phrase: `이 ${label}`, josa: josaEulReul(label) };
}

export const DELETE_CONFIRM_LABEL = {
  trash: '삭제',
  permanent: '영구 삭제',
} as const;

export function deleteConfirmText(input: DeleteConfirmInput): DeleteConfirmText {
  const { phrase, josa } = deleteTargetPhrase(input.kind, input.name, input.count);
  const tail = input.extra ? `\n${input.extra}` : '';
  if (input.outcome === 'permanent') {
    return {
      text: `${phrase}${josa} 영구 삭제할까요?\n이 작업은 되돌릴 수 없습니다.${tail}`,
      confirmText: DELETE_CONFIRM_LABEL.permanent,
      danger: 'permanent',
    };
  }
  return {
    text: `${phrase}${josa} 삭제할까요?\n휴지통으로 이동되어 ${input.outcome.trashDays}일 동안 복원할 수 있습니다.${tail}`,
    confirmText: DELETE_CONFIRM_LABEL.trash,
    danger: true,
  };
}

/**
 * 템플릿 첨부(캐릭터 프리셋·바이브·레퍼런스) 제거 확인(2026-10-03 E1-4) — 제거하면 딸린 이미지 파일이 바로
 * 영구 삭제된다(ProjectTemplateService.deleteImageData). 첨부를 빼는 흐름이라 [제거]·danger true(Enter 허용).
 */
export function attachmentRemoveConfirmText(input: {
  what: '이미지' | '캐릭터 프리셋';
  name: string;
}): DeleteConfirmText {
  const tail =
    input.what === '이미지'
      ? '파일이 영구 삭제됩니다.'
      : '딸린 이미지 파일이 영구 삭제됩니다.';
  return {
    text: `첨부 ${input.what} "${input.name}"${josaEulReul(input.name)} 제거할까요?\n${tail}`,
    confirmText: '제거',
    danger: true,
  };
}

/**
 * 여러 장 이미지 삭제 확인 창의 범위 줄(deleteConfirmText 의 extra) — 「대상: 씬 3개 · 5등 이하 · 즐겨찾기 제외」.
 * n등 이하 삭제는 즐겨찾기를 늘 빼므로 「즐겨찾기 제외」를 함께 적는다. 덧붙일 것이 없으면 undefined.
 * favOnly(즐겨찾기한 이미지만 삭제, 2026-11-01 A8)는 「즐겨찾기한 이미지만」 — 제외 범위와 함께 쓰지 않는다.
 */
export function imageDeleteScopeLine(scope: {
  sceneCount?: number;
  excludeFav?: boolean;
  rankBelow?: number;
  favOnly?: boolean;
}): string | undefined {
  const parts: string[] = [];
  if (scope.sceneCount !== undefined) parts.push(`씬 ${scope.sceneCount}개`);
  if (scope.favOnly) {
    parts.push('즐겨찾기한 이미지만');
  } else {
    if (scope.rankBelow !== undefined) parts.push(`${scope.rankBelow}등 이하`);
    if (scope.excludeFav || scope.rankBelow !== undefined) parts.push('즐겨찾기 제외');
  }
  return parts.length > 0 ? `대상: ${parts.join(' · ')}` : undefined;
}

// ── 대량 작업 「⚠️ 즐겨찾기한 이미지만 삭제」(2026-11-01 A8) ──
//
// 즐겨찾기 = 사용자가 마음에 들어 표시한 이미지라 위험도가 높다 → 확인 2회, 「이번 세션에서 다시 묻지 않음」과 무관.
//  ① deleteConfirmText 형식(범위 줄 「대상: 씬 N개 · 즐겨찾기한 이미지만」) · [삭제] · danger true(Enter = 확인) · 체크박스 없음
//  ② 다시 확인 · [삭제] · danger true + requireClick(Enter 무시 — 버튼을 직접 눌러야 한다) · 체크박스 없음
// 삭제는 두 번 모두 확인한 뒤 기존 휴지통 경로(BatchProcessService.deleteAndReport)로만 한다.

export const FAV_ONLY_IMAGE_DELETE = {
  value: 'favOnly',
  /** select 항목 라벨 — 기존 위험 선택지(폴더와 프로젝트 모두 삭제 등)와 같은 ⚠️ 표기 */
  label: '⚠️ 즐겨찾기한 이미지만 삭제',
} as const;

/**
 * 즐겨찾기 전용 삭제 대상 — paths(「출력 폴더/파일명」) 중 파일명이 씬 mains(즐겨찾기)에 있는 것만, 순서 유지.
 * 대량 작업 메뉴 「즐겨찾기 제외」('fav' — BatchProcessService.isMain 의 반대)의 정확한 반대 집합.
 */
export function pickFavoriteImagePaths(
  mains: readonly string[] | undefined,
  paths: readonly string[],
): string[] {
  if (!mains || mains.length === 0) return [];
  const fav = new Set(mains);
  return paths.filter((p) => fav.has(p.split('/').pop()!));
}

/** 즐겨찾기 전용 삭제는 「다시 묻지 않음」으로 건너뛸 수 없다(체크박스도 내지 않는다). */
export const FAV_ONLY_IMAGE_DELETE_SKIPPABLE = false;

export interface FavOnlyDeleteConfirmStep extends DeleteConfirmText {
  /** Enter 무시(버튼 클릭·탭 필수) */
  requireClick?: boolean;
  /** 「이번 세션에서 다시 묻지 않음」 체크박스 — 즐겨찾기 전용 삭제는 늘 false */
  showSkipConfirm: false;
}

export type FavOnlyDeletePlan =
  /** 대상 0장 — NO_IMAGES_TO_DELETE_MESSAGE 안내만 */
  | { kind: 'empty' }
  /** 두 확인을 차례로 모두 통과해야 삭제 */
  | { kind: 'confirm'; steps: [FavOnlyDeleteConfirmStep, FavOnlyDeleteConfirmStep] };

/**
 * 즐겨찾기 전용 삭제의 확인 계획. skipSetting(appState.skipImageDeleteConfirm)은 받아도 **쓰지 않는다** —
 * 켜져 있어도 두 확인을 모두 띄운다(FAV_ONLY_IMAGE_DELETE_SKIPPABLE).
 */
export function planFavOnlyImageDelete(input: {
  count: number;
  trashDays: number;
  sceneCount?: number;
  skipSetting?: boolean;
}): FavOnlyDeletePlan {
  if (input.count <= 0) return { kind: 'empty' };
  const first: FavOnlyDeleteConfirmStep = {
    ...deleteConfirmText({
      kind: 'image',
      count: input.count,
      outcome: { trashDays: input.trashDays },
      extra: imageDeleteScopeLine({ sceneCount: input.sceneCount, favOnly: true }),
    }),
    showSkipConfirm: false,
  };
  const second: FavOnlyDeleteConfirmStep = {
    text:
      `즐겨찾기한 이미지 ${input.count}장을 휴지통으로 보냅니다.\n` +
      '마음에 들어 표시해 두신 이미지가 모두 포함됩니다.\n' +
      '정말 삭제하시겠습니까?',
    confirmText: DELETE_CONFIRM_LABEL.trash,
    danger: true,
    requireClick: true,
    showSkipConfirm: false,
  };
  return { kind: 'confirm', steps: [first, second] };
}

export const NO_IMAGES_TO_DELETE_MESSAGE = '삭제할 이미지가 없습니다.';

// ── 이미지 삭제 확인 규칙 ──

/**
 * 이미지 삭제 확인 창을 건너뛰어도 되는가 — 「다시 묻지 않음」이 켜져 있고 지울 이미지가 1장 이상이면(장수 무관).
 * 0장은 건너뛸 것이 없다(호출부가 「삭제할 이미지가 없습니다」 안내).
 */
export function shouldSkipImageDeleteConfirm(
  skipSetting: boolean,
  count: number,
): boolean {
  return !!skipSetting && count >= 1;
}

/** 이미지 삭제 확인 창에 「다시 묻지 않음」 체크박스를 보일지 — 이미지 삭제라면 장수와 무관하게(1장 이상). */
export function showImageDeleteSkipOption(count: number): boolean {
  return count >= 1;
}

/** 선택한 이미지 삭제 확인 문구 — deleteConfirmText 로 위임(2026-10-03 E1). */
export function selectedImagesDeleteText(
  count: number,
  retentionDays: number,
): string {
  return deleteConfirmText({
    kind: 'image',
    count,
    outcome: { trashDays: retentionDays },
  }).text;
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

/**
 * 이미지 복제·다른 씬으로 복사 결과 한 줄(2026-11-02 U4 — copyImageFilesInto 결과). 전부 성공은 기존 문구
 * 「이미지를 복제했습니다」·「이미지를 복사했습니다」 그대로.
 */
export function imageCopyResultText(verb: '복제' | '복사', done: number, failed: number): string {
  if (failed === 0) return `이미지를 ${verb}했습니다`;
  if (done === 0) return `이미지를 ${verb}하지 못했습니다(${failed}장).`;
  return `이미지 ${verb}: 성공 ${done} · 실패 ${failed}`;
}

/** 이미지 휴지통 복원 실패 사유(같은 이름 파일 있음 / 파일 이동 실패) — 결과 문구 공용. */
export const IMAGE_RESTORE_FAIL_REASON =
  '원래 위치에 같은 이름 파일이 있거나 파일을 옮기지 못했습니다';

/**
 * 이미지 휴지통 복원 결과 한 줄(2026-11-01 U0-a T2) — `TrashService.restoreImages` 의
 * `{ restored, failed }` 개수로 만든다. 전부 성공은 기존 문구와 같다.
 */
export function imageRestoreResultText(restored: number, failed: number): string {
  if (failed === 0) return `${restored}장의 이미지가 복원되었습니다.`;
  if (restored === 0)
    return `이미지를 복원하지 못했습니다(${failed}장). ${IMAGE_RESTORE_FAIL_REASON}.`;
  return `이미지 복원: 성공 ${restored} · 실패 ${failed} (${IMAGE_RESTORE_FAIL_REASON})`;
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
  /** 휴지통 관문 삭제(sessionService.delete / trashService.moveSceneToTrash 등) — 반환값은 쓰지 않는다 */
  remove(): Promise<unknown>;
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
  /** restoreScene 이 다른 창 잠금으로 조용히 돌아옴(U0-a T1) */
  sceneRestoreBlocked:
    '씬을 복원하지 못했습니다(다른 창에서 열려 있을 수 있습니다).',
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
    `같은 이름의 씬 ${overlapping.length}개(${failedNamesLine(overlapping, limit)})의 프롬프트 구성과 해상도를 불러온 내용으로 바꿉니다.\n` +
    '기존 씬의 프롬프트 구성이 바뀝니다. 되돌릴 수 없습니다.\n계속할까요?'
  );
}
