// 되돌리기/다시 실행 — 명령 계측형 스택(2026-11-01 U1, SPEC_GUIDE 「되돌리기 계약」, jest undoService.test.ts).
//
// · 기록은 UI·흐름 계층에서 사용자 동작이 성공한 뒤에만 헬퍼(set·capture·run·group·beginGroup·drag·focusEdit)로 한다.
//   서비스 내부(잠금 안)에서 기록하지 않는다 — 되돌림이 같은 잠금 안에서 서비스를 다시 부르는 교착을 막기 위함.
// · 스택은 프로젝트(Session) 인스턴스별 WeakMap, 메모리 전용(재시작·인스턴스 교체 시 자연 소멸), 깊이 100.
// · 실행은 하나씩(실행 중 연타는 무시하고 「진행 중」 안내). 항목 함수를 **동기로 부르는 동안**만 기록을 무시한다(재귀 방지).
//   비동기 항목(파일 이동)을 기다리는 동안 생긴 다른 사용자 동작의 기록은 버리지 않고 대기열에 두었다가 실행이 끝난 뒤
//   도착 순서대로 쌓는다(2026-11-02 U4 — 「실행 중 동작은 되돌릴 수 없음」 공백 해소). 항목 함수는 기록 헬퍼를 부르지 않는다.
// · 이 모듈은 잠금을 쓰지 않는다 — 항목은 MobX 대입이나 공개 서비스 메서드만 부르고, 그 메서드가 각자 잠근다.
// · 미러(읽기 전용) 프로젝트는 기록·실행 모두 하지 않는다(저장되지 않는 편집이므로).
// · 항목은 이미지 목록 필드(imageMap·mains·game·round)를 통째로 되살리지 않는다 — 생성 중 새로 생긴 이미지를 지운다.
//   필드 단위·병합 복원만 쓴다(씬 순서는 Session.reorderScenes: 그사이 생긴 씬은 뒤에 남김).
// · 전역 스택(2026-11-03 2차 묶음 2, 사용자 결정 D2 ①): 프로젝트 밖 작업(프로젝트 즐겨찾기·폴더)은 키 GLOBAL_UNDO_SCOPE 의
//   스택 하나에 쌓는다(프로젝트 전환과 무관, 미러 판정 없음). undo/redo·canUndo·라벨은 「현재 프로젝트 스택(없거나 미러면 제외)과
//   전역 스택의 맨 위 중 더 최근 것」을 고른다 — 최근 = 서비스 전역 단조 증가 순번 seq(쌓일 때·병합될 때·past↔future 로 옮길 때
//   새로 부여). 새 기록은 자기 스택과 「짝 스택」(프로젝트 기록 → 전역, 전역 기록 → 현재 프로젝트)의 future 를 함께 비운다(한 이력).
import { isObservableMap, isObservableSet, makeObservable, observable, runInAction } from 'mobx';
import type { Session } from './types';
import type { ToastKind } from './toastKind';
import { getAppState } from './appStateRef';

export type UndoDirection = 'undo' | 'redo';
export type UndoKind = 'state' | 'file';

/** 묶음 항목 실행 결과 — 하위 항목 일부가 실패했을 때 안내용 */
export interface UndoOutcome {
  total: number;
  failed: number;
  firstError?: string;
  /**
   * 결과 안내(있으면 토스트 끝에 「(…)」로 붙이고 일반 부분 실패 문구를 대신한다) — 삭제 되돌림의
   * 「N장은 휴지통에서 이미 사라졌습니다」처럼 사유를 나눠 알릴 때(U4). 전부 실패면 firstError 가 실패 이유.
   */
  notice?: string;
}

type UndoRunResult = void | UndoOutcome;

export interface UndoEntryInit {
  label: string;
  /** 되돌림 방향 전용 문구(없으면 label). 이름 변경처럼 방향이 있는 작업은 「B → A」로 준다(2026-11-01 실기 지적) */
  undoLabel?: string;
  kind?: UndoKind;
  mergeKey?: string;
  undo(): UndoRunResult | Promise<UndoRunResult>;
  redo(): UndoRunResult | Promise<UndoRunResult>;
  /** 실행 직전 검사 — 문자열(이유)이면 실행하지 않고 그 항목만 버린다 */
  verify?(dir: UndoDirection): true | string;
  /**
   * 기록 밖 변경과 겹쳤는가(D16) — true 면 실행 전에 확인 창(`deps.confirm`)을 띄운다. 확인 = 실행, 취소 = 항목 유지
   * (폐기 아님 — 다시 누르면 다시 묻는다). 통째 복원 항목(capture·drag·focusEdit)이 「현재 값 ≠ 기록 시 결과」로 판정한다.
   */
  conflict?(dir: UndoDirection): boolean;
}

export interface UndoEntry extends UndoEntryInit {
  readonly id: number;
  kind: UndoKind;
  readonly createdAt: number;
  updatedAt: number;
  /**
   * 「가장 최근」 판정용 서비스 전역 단조 증가 순번(2차 묶음 2 — 전역 스택과 프로젝트 스택 중 고르기).
   * 스택에 쌓일 때·병합으로 갱신될 때·되돌림/다시 실행으로 past↔future 를 옮길 때 새로 받는다.
   */
  seq: number;
}

/** 프로젝트와 무관한 전역 스택의 키(2차 묶음 2) — 프로젝트 즐겨찾기·폴더 작업 */
export interface GlobalUndoScope {
  readonly kind: 'global';
}

export const GLOBAL_UNDO_SCOPE: GlobalUndoScope = Object.freeze({ kind: 'global' as const });

/** 스택 키 — 프로젝트(Session 인스턴스) 또는 전역 */
export type UndoScope = Session | GlobalUndoScope;

export function isGlobalUndoScope(scope: UndoScope | undefined): scope is GlobalUndoScope {
  return scope === GLOBAL_UNDO_SCOPE;
}

/** 시작~끝을 감싸는 기록(capture·drag·focusEdit) — commit 은 기록했으면 true, 변화가 없어 버렸으면 false */
export interface UndoPending {
  commit(): boolean;
  cancel(): void;
}

export interface UndoGroupHandle extends UndoPending {
  /** 묶음 안에 항목을 직접 넣는다(헬퍼를 거치지 않는 경우) */
  add(init: UndoEntryInit): void;
  /** commit 전에 묶음 라벨을 바꾼다(실제로 바뀐 씬 수처럼 끝나야 아는 문구 — U5 일괄 작업) */
  setLabel(label: string): void;
}

/** drag·capture 용 상태 읽기/되살리기 짝 — 객체 필드가 아닌 상태(씬 순서 등)에 쓴다 */
export interface UndoSnapshotAdapter<S> {
  snapshot(): S;
  /** 되살리기 — 서비스 메서드를 부르는 비동기 복원(전역 항목: 폴더 색·순서)도 허용(실행부가 기다린다) */
  restore(snapshot: S): void | Promise<void>;
  /** 같음 판정(없으면 깊은 비교) — 같으면 기록하지 않는다 */
  equals?(a: S, b: S): boolean;
  /**
   * 통째 덮어쓰는 복원인가(D16) — true 면 실행 직전 현재 상태가 기록 시 결과(되돌림 = 이후 값, 다시 실행 = 이전 값)와
   * 다를 때 확인 창을 띄운다. 병합 복원(씬 순서 — 그사이 생긴 씬은 뒤에 남김)은 덮어쓰지 않으므로 끈다.
   */
  detectConflict?: boolean;
  /** 실행 직전 검사(대상이 아직 있는가 등) — 문자열(이유)이면 실행하지 않고 그 항목만 버린다 */
  verify?(): true | string;
  /**
   * 기록 밖 변경을 실패로 다룬다(전역 항목 — 2차 묶음 2): 실행 직전 현재 상태가 기록 시 결과(되돌림 = 이후 값, 다시 실행 =
   * 이전 값)와 다르면 이 이유로 실행하지 않고 항목을 버린다(D15 — 다른 창이 사이드카를 바꾼 경우). D16 확인 창 대신.
   */
  staleReason?: string;
}

export interface UndoDeps {
  curSession(): Session | undefined;
  isMirror(session: Session): boolean;
  toast(message: string, kind: ToastKind): void;
  now(): number;
  /** 기록 밖 변경과 겹친 항목의 실행 확인(D16) — true = 계속. 기본은 appState.confirmAsync(danger 아님) */
  confirm(message: string, confirmText: string): Promise<boolean>;
}

export const UNDO_MAX_DEPTH = 100;
export const UNDO_MERGE_MS = 1000;

/** 라벨에 넣는 사용자 입력(검색어 등)이 길면 줄인다 — 토스트·툴팁 한 줄 유지 */
function clipUndoText(text: string, max = 20): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** 사용자에게 보이는 문구 — 한 곳에서만 정한다 */
export const UNDO_TEXT = {
  undoName: '되돌리기',
  redoName: '다시 실행',
  undone: (label: string) => `되돌림: ${label}`,
  redone: (label: string) => `다시 실행: ${label}`,
  busy: '되돌리기·다시 실행을 처리하는 중입니다. 잠시 뒤 다시 눌러 주세요.',
  undoFailed: (reason: string) => `되돌릴 수 없습니다: ${reason}`,
  redoFailed: (reason: string) => `다시 실행할 수 없습니다: ${reason}`,
  partial: (failed: number, total: number) => ` (${total}개 중 ${failed}개는 처리하지 못했습니다)`,
  groupAllFailed: '묶인 작업을 하나도 처리하지 못했습니다',
  unknownError: '알 수 없는 오류',
  // keyHint = 현재 단축키 표시(PC 만 — 모바일은 단축키 없음)
  undoTooltip: (label?: string, keyHint?: string) =>
    (label ? `되돌리기: ${label}` : '되돌릴 작업 없음') + (keyHint ? ` (${keyHint})` : ''),
  redoTooltip: (label?: string, keyHint?: string) =>
    (label ? `다시 실행: ${label}` : '다시 실행할 작업 없음') + (keyHint ? ` (${keyHint})` : ''),
  // 계측 지점 라벨
  sceneOrderDrag: '씬 순서 변경',
  sceneMoveFront: '씬 맨 앞으로',
  sceneMoveBack: '씬 맨 뒤로',
  sceneSortByName: '씬 이름순 정렬',
  // U2a 씬 구조(생성·이름·북마크) — sceneStructureUndo.ts
  sceneAdd: (names: readonly string[]) =>
    names.length === 1 ? `씬 추가: ${names[0]}` : `씬 추가 ${names.length}개`,
  sceneDuplicate: (name: string) => `씬 복제: ${name}`,
  sceneRegenerate: (name: string) => `이미지에서 씬 재생성: ${name}`,
  variantSceneCreate: (name: string) => `변형 씬 생성: ${name}`,
  mirrorDuplicate: (names: readonly string[]) =>
    names.length === 1 ? `미러로 복제: ${names[0]}` : `미러로 복제 ${names.length}개`,
  // workflowLabel = i2iBatch.variantCopyLabel(…)(「I2I」·「인페인트」)
  variantCopy: (workflowLabel: string, count: number) => `${workflowLabel}로 씬 복사 ${count}개`,
  sceneRename: (from: string, to: string) => `씬 이름 변경: ${from} → ${to}`,
  sceneBookmarkOn: (name: string) => `씬 북마크: ${name}`,
  sceneBookmarkOff: (name: string) => `씬 북마크 해제: ${name}`,
  // 실패 이유(되돌릴 수 없습니다: …)
  sceneGone: (name: string) => `씬 "${name}"이(가) 이미 없습니다`,
  sceneStructureBlocked: '다른 창에서 열려 있는 프로젝트라 처리하지 못했습니다',
  sceneNotInTrash: '휴지통에 기록이 없습니다',
  sceneNameChanged: (name: string) => `씬 이름이 그사이 바뀌었습니다(현재 "${name}")`,
  sceneNameTaken: (name: string) => `같은 이름의 씬 "${name}"이(가) 이미 있습니다`,
  // D16 — 기록 밖 변경과 겹친 통째 복원 항목의 확인 창(danger 아님, 취소 = 항목 유지)
  conflictUndo: (label: string) =>
    `「${label}」 뒤에 같은 내용이 되돌리기 기록 밖에서 또 바뀌었습니다.\n` +
    '되돌리면 이후 바뀐 내용도 함께 되돌아갑니다. 계속할까요?',
  conflictRedo: (label: string) =>
    `「${label}」을(를) 되돌린 뒤 같은 내용이 되돌리기 기록 밖에서 또 바뀌었습니다.\n` +
    '다시 실행하면 이후 바뀐 내용도 함께 바뀝니다. 계속할까요?',
  // U2b 씬 필드·조합·씬 캐릭터·시드 그룹 — sceneFieldUndo.ts
  sceneSeed: (name: string) => `씬 전용 시드: ${name}`,
  sceneResolution: (name: string) => `해상도 변경: ${name}`,
  scenesResolution: (count: number) => `해상도 일괄 변경 ${count}개`,
  sceneMiddlePrompt: (name: string) => `중간 프롬프트 편집: ${name}`,
  sceneCharacterMiddlePrompt: (name: string) => `캐릭터 중간 프롬프트 편집: ${name}`,
  sceneNegative: (name: string) => `씬 전용 네거티브 편집: ${name}`,
  comboAddColumn: (name: string) => `조합 열 추가: ${name}`,
  comboAddRow: (name: string) => `조합 행 추가: ${name}`,
  comboRemovePiece: (name: string) => `조합 셀 삭제: ${name}`,
  comboMovePiece: (name: string) => `조합 셀 이동: ${name}`,
  comboTogglePiece: (name: string) => `조합 셀 활성화 변경: ${name}`,
  comboRenamePiece: (name: string) => `조합 셀 이름 변경: ${name}`,
  comboPiecePrompt: (name: string) => `조합 셀 프롬프트 편집: ${name}`,
  comboPieceCharacter: (name: string) => `조각 캐릭터 프롬프트 변경: ${name}`,
  comboQuickToggle: (name: string) => `조합 퀵 토글: ${name}`,
  comboBatchInsert: (count: number) => `일괄 삽입 ${count}개 씬`,
  sceneCharacterRoles: (name: string) => `씬 캐릭터 역할 변경: ${name}`,
  sceneCharacterRoleText: (name: string) => `씬 캐릭터 역할 편집: ${name}`,
  sceneCharacterRoleOrder: (name: string) => `씬 캐릭터 역할 순서: ${name}`,
  sceneCharacterPosition: (name: string) => `캐릭터 위치 이동: ${name}`,
  sceneCharacterMode: (name: string) => `캐릭터 모드 변경: ${name}`,
  sceneCharacterNegative: (name: string) => `씬 캐릭터 공통 네거티브 편집: ${name}`,
  baseCharacterOrder: '기본 캐릭터 순서 변경',
  seedGroupSet: (count: number) => `시드 그룹 설정 ${count}개 씬`,
  seedGroupRemove: '시드 그룹 해제',
  seedGroupSeed: (label: string) => `그룹 ${label} 시드 변경`,
  sceneContentCopy: (source: string, count: number) => `씬 내용 복제: ${source} → ${count}개`,
  // U3a 이미지 상태(즐겨찾기·북마크·순서·순위·생성 설정 적용) — imageStateUndo.ts
  imageFavoriteOn: (name: string, count: number) =>
    count === 1 ? `이미지 즐겨찾기: ${name}` : `이미지 즐겨찾기 ${count}장: ${name}`,
  imageFavoriteOff: (name: string, count: number) =>
    count === 1 ? `이미지 즐겨찾기 해제: ${name}` : `이미지 즐겨찾기 해제 ${count}장: ${name}`,
  imageFavoriteToggle: (name: string, count: number) => `이미지 즐겨찾기 전환 ${count}장: ${name}`,
  favoritesClearAll: (sceneCount: number) => `즐겨찾기 전부 해제 ${sceneCount}개 씬`,
  favoritesTopN: (n: number, sceneCount: number) => `상위 ${n}등 즐겨찾기 ${sceneCount}개 씬`,
  imageBookmarkOn: (name: string) => `이미지 북마크: ${name}`,
  imageBookmarkOff: (name: string) => `이미지 북마크 해제: ${name}`,
  imageOrderDrag: (name: string) => `이미지 순서 변경: ${name}`,
  rankingReset: (name: string) => `순위 초기화: ${name}`,
  rankingReroll: (name: string) => `대진 리롤: ${name}`,
  metaApply: '생성 설정 적용',
  metaApplyConfigNotUndone:
    '생성 설정 적용의 모델 설정(환경설정) 부분은 되돌리기에 포함되지 않습니다. 프로젝트 쪽 변경만 되돌릴 수 있습니다.',
  // U3b 사전 세팅(그림체)·공용 설정·바이브·레퍼런스·캐릭터 프리셋 — presetUndo.ts
  presetAdd: (name: string) => `그림체 추가: ${name}`,
  presetDuplicate: (name: string) => `그림체 복제: ${name}`,
  presetRemove: (names: readonly string[]) =>
    names.length === 1 ? `그림체 삭제: ${names[0]}` : `그림체 삭제 ${names.length}개`,
  presetMove: (name: string) => `그림체 순서 변경: ${name}`,
  presetRename: (from: string, to: string) => `그림체 이름 변경: ${from} → ${to}`,
  presetSelect: (name: string) => `그림체 선택: ${name}`,
  presetImport: (count: number) => `그림체 불러오기 ${count}개`,
  presetFromGlobal: (count: number, name?: string) =>
    count === 1 && name ? `글로벌 프리셋을 프로젝트로 복사: ${name}` : `글로벌 프리셋을 프로젝트로 복사 ${count}개`,
  presetMainImage: (name: string) => `그림체 대표 이미지 지정: ${name}`,
  workflowMode: '작업모드 변경',
  // fieldLabel = 워크플로우 입력 칸 이름(「상위 프롬프트」·「샘플링」 등). 공용 설정은 그림체 이름 대신 「공용 설정」
  presetField: (fieldLabel: string, presetName: string) => `${fieldLabel} 변경: ${presetName}`,
  sharedField: (fieldLabel: string) => `${fieldLabel} 변경: 공용 설정`,
  extraPromptEdit: '추가 프롬프트 편집',
  newSceneResolution: '새 씬 해상도 변경',
  newSceneResolutionApplyAll: (count: number) => `새 씬 해상도 일괄 적용 ${count}개 씬`,
  characterPromptAdd: (owner: string) => `캐릭터 프롬프트 추가: ${owner}`,
  characterPromptRemove: (owner: string) => `캐릭터 프롬프트 삭제: ${owner}`,
  characterPromptToggle: (owner: string) => `캐릭터 프롬프트 켜기/끄기: ${owner}`,
  characterPromptText: (owner: string) => `캐릭터 프롬프트 편집: ${owner}`,
  characterPromptOrder: (owner: string) => `캐릭터 프롬프트 순서: ${owner}`,
  characterPromptPosition: (owner: string) => `캐릭터 위치 이동: ${owner}`,
  characterCoordsMode: (owner: string) => `캐릭터 위치 지정 모드: ${owner}`,
  vibeAdd: '바이브 이미지 추가',
  vibeValue: '바이브 값 변경',
  vibeRemove: '바이브 이미지 삭제',
  referenceAdd: '캐릭터 레퍼런스 추가',
  referenceValue: '캐릭터 레퍼런스 값 변경',
  referenceRemove: '캐릭터 레퍼런스 삭제',
  appliedPresetRemove: (names: readonly string[]) =>
    names.length === 1 ? `캐릭터 프리셋 해제: ${names[0]}` : `캐릭터 프리셋 해제 ${names.length}개`,
  appliedPresetClear: '캐릭터 프리셋 전부 해제',
  characterPresetApply: (names: readonly string[]) =>
    names.length === 1 ? `캐릭터 프리셋 적용: ${names[0]}` : `캐릭터 프리셋 적용 ${names.length}개`,
  characterPresetAdd: (name: string) => `캐릭터 프리셋 추가: ${name}`,
  characterPresetSave: (name: string) => `캐릭터 프리셋 편집: ${name}`,
  characterPresetRemove: (names: readonly string[]) =>
    names.length === 1 ? `캐릭터 프리셋 삭제: ${names[0]}` : `캐릭터 프리셋 삭제 ${names.length}개`,
  characterPresetDuplicate: (name: string) => `캐릭터 프리셋 복제: ${name}`,
  characterPresetMove: '캐릭터 프리셋 순서 변경',
  characterPresetFromGlobal: (count: number, name?: string) =>
    count === 1 && name
      ? `글로벌 캐릭터 프리셋을 프로젝트로 복사: ${name}`
      : `글로벌 캐릭터 프리셋을 프로젝트로 복사 ${count}개`,
  artistPrefix: '작가 artist: 접두 전환',
  // 실패 이유
  presetGone: (name: string) => `그림체 "${name}"이(가) 이미 없습니다`,
  presetNameChanged: (name: string) => `그림체 이름이 그사이 바뀌었습니다(현재 "${name}")`,
  presetNameTaken: (name: string) => `같은 이름의 그림체 "${name}"이(가) 이미 있습니다`,
  sharedGone: '공용 설정이 그사이 바뀌어 되돌릴 대상이 없습니다',
  // U4 삭제·휴지통 복원·복제·복사·붙여넣기(휴지통 경유) — deleteUndo.ts
  sceneDelete: (names: readonly string[]) =>
    names.length === 1 ? `씬 삭제: ${names[0]}` : `씬 ${names.length}개 삭제`,
  sceneTrashRestore: (name: string) => `휴지통 복원: 씬 ${name}`,
  imageDelete: (count: number, sceneNames: readonly string[]) =>
    sceneNames.length === 1
      ? `이미지 ${count}장 삭제: ${sceneNames[0]}`
      : `이미지 ${count}장 삭제(${sceneNames.length}개 씬)`,
  imageTrashRestore: (count: number, sceneName: string) => `휴지통 복원: 이미지 ${count}장(${sceneName})`,
  imageDuplicate: (count: number, sceneName: string) => `이미지 복제 ${count}장: ${sceneName}`,
  imageCopyTo: (count: number, sceneName: string) => `이미지 ${count}장 다른 씬으로 복사: ${sceneName}`,
  imagePaste: (count: number, sceneName: string) => `이미지 붙여넣기 ${count}장: ${sceneName}`,
  // 실패·안내 이유
  sceneTrashGone: (days: number) =>
    `휴지통에서 이미 사라졌습니다(보존 기간 ${days}일 경과·휴지통 비우기·영구 삭제)`,
  sceneSlotTaken: (name: string) =>
    `같은 이름의 씬 "${name}"이(가) 있어 복원하지 않았습니다(그 씬 이름을 바꾼 뒤 휴지통 탭에서 복원할 수 있습니다)`,
  sceneKeptSlotName: (slot: string, original: string) =>
    `원래 이름 "${original}"을(를) 다른 씬이 쓰고 있어 "${slot}"(으)로 복원했습니다`,
  imagesTrashGone: (count: number, days: number) =>
    `${count}장은 휴지통에서 이미 사라졌습니다(보존 기간 ${days}일 경과·휴지통 비우기)`,
  imagesRestoreBlocked: (count: number) =>
    `${count}장은 원래 위치에 같은 이름 파일이 있거나 옮기지 못했습니다`,
  imagesSceneGone: (count: number, name: string) => `씬 "${name}"이(가) 없어 ${count}장은 처리하지 못했습니다`,
  imagesMoveFailed: (count: number) => `${count}장은 휴지통으로 옮기지 못했습니다(파일 잠금 등)`,
  imagesAlreadyGone: (count: number) => `${count}장은 그사이 이미 없어졌습니다`,
  rankingNotRestored: '순위는 그사이 바뀌어 되돌리지 않았습니다',
  // U5 변형 씬(I2I·인페인트) 필드·일괄 작업 — variantSceneUndo.ts
  // fieldLabel = 편집 칸 이름(「강도」·「상위 프롬프트(고정)」 등)
  variantField: (fieldLabel: string, sceneName: string) => `${fieldLabel} 변경: 변형 씬 ${sceneName}`,
  variantFocusOn: (name: string) => `Focused 켜기: ${name}`,
  variantFocusOff: (name: string) => `Focused 끄기: ${name}`,
  variantFocusRect: (name: string) => `Focused 영역 변경: ${name}`,
  variantFocusContext: (name: string) => `Focused 맥락 여백 변경: ${name}`,
  variantComboOff: (name: string) => `조합 모드 끄기: ${name}`,
  variantComboOn: (name: string) => `조합 모드 켜기: ${name}`,
  variantImageUpload: (name: string) => `변형 씬 이미지 교체: ${name}`,
  variantFitResolution: (name: string) => `이미지 크기로 해상도 맞추기: ${name}`,
  imageAttachBatch: (count: number) => `일괄 이미지 첨부 ${count}개 씬`,
  maskApplyBatch: (count: number) => `인페인트 마스크 일괄 적용 ${count}개 씬`,
  strengthNoiseBatch: (count: number) => `강도·노이즈 일괄 변경 ${count}개 씬`,
  // U5 로컬 조각(프로젝트 조각그룹) — pieceUndo.ts. 전역 조각은 기록하지 않는다
  pieceGroupAdd: (name: string) => `조각그룹 추가: ${name}`,
  pieceGroupRemove: (name: string) => `조각그룹 삭제: ${name}`,
  pieceGroupImport: (name: string) => `조각그룹 불러오기: ${name}`,
  pieceGroupFromGlobal: (name: string, how: string) => `전역 조각그룹을 로컬로 복사(${how}): ${name}`,
  pieceAdd: (group: string, name: string) => `조각 추가: ${group}.${name}`,
  pieceWildcardImport: (group: string, name: string) => `와일드카드 불러오기: ${group}.${name}`,
  pieceRename: (group: string, from: string, to: string) => `조각 이름 변경: ${group}.${from} → ${to}`,
  pieceRemove: (group: string, name: string) => `조각 삭제: ${group}.${name}`,
  piecePrompt: (group: string, name: string) => `조각 내용 편집: ${group}.${name}`,
  pieceMulti: (group: string, name: string) => `조각 랜덤 줄 모드 변경: ${group}.${name}`,
  pieceMove: (group: string) => `조각 순서 변경: ${group}`,
  // 2차 P3 찾기/바꾸기 「모두 변환」 — findReplaceUndo.ts. 글로벌 프리셋·프로젝트 이름은 기록하지 않는다(사용자 결정 D4)
  findReplaceAll: (search: string, replace: string, count: number) =>
    `모두 변환 ${count}개: 「${clipUndoText(search)}」 → ${replace ? `「${clipUndoText(replace)}」` : '(삭제)'}`,
  // scopes = 실제로 바뀐 기록 밖 범위 이름(findReplaceUndo.FIND_REPLACE_UNRECORDED_LABEL)
  findReplaceNotUndone: (scopes: readonly string[]) => `${scopes.join('·')} 변경은 되돌리기 대상이 아닙니다`,
  // 「모두 변환」 확인 창(Enter·버튼 공용, 발견 A11). unrecorded = 결과에 들어 있는 기록 밖 범위 이름
  findReplaceConfirm: (count: number, search: string, replace: string, unrecorded: readonly string[]) =>
    `${count}개 항목을 변환합니다.\n「${search}」 → 「${replace}」${replace ? '' : ' (삭제)'}` +
    (unrecorded.length > 0 ? `\n${unrecorded.join('·')} 변경은 되돌릴 수 없습니다.` : ''),
  findReplaceConfirmButton: '모두 변환',
  // 2차 P4 월드컵 라운드 완료(라운드 단위 1항목 — 매치별 진행은 기록하지 않는다, 사용자 결정 D5). stage = 「8강」·「결승전」 등
  rankingRound: (name: string, stage: string) => `월드컵 ${stage} 완료: ${name}`,
  // 2차 묶음 2 P1-a 프로젝트·폴더(전역 스택) — projectFolderUndo.ts. folder = 폴더 경로(「상위/하위」), null = 미분류
  projectFavoriteOn: (name: string) => `프로젝트 즐겨찾기: ${name}`,
  projectFavoriteOff: (name: string) => `프로젝트 즐겨찾기 해제: ${name}`,
  folderColor: (folder: string) => `폴더 색 변경: ${folder}`,
  folderOrder: '폴더 순서 변경',
  unfiled: '미분류',
  projectMove: (names: readonly string[], folder: string) =>
    names.length === 1 ? `프로젝트 폴더 이동: ${names[0]} → ${folder}` : `프로젝트 ${names.length}개 폴더 이동 → ${folder}`,
  folderRename: (from: string, to: string) => `폴더 이름 변경: ${from} → ${to}`,
  folderMove: (from: string, to: string) => `폴더 이동: ${from} → ${to}`,
  folderCreate: (folder: string) => `폴더 만들기: ${folder}`,
  // 실패 이유(되돌릴 수 없습니다: …) — 대개 다른 창이 같은 사이드카를 바꾼 경우(D15)
  projectGone: (name: string) => `프로젝트 "${name}"이(가) 이미 없습니다`,
  projectFavoriteChanged: (name: string) => `프로젝트 "${name}"의 즐겨찾기가 그사이 바뀌었습니다`,
  projectFolderChanged: (name: string) => `프로젝트 "${name}"의 폴더가 그사이 바뀌었습니다`,
  projectMoveBlocked: (name: string) => `프로젝트 "${name}"이(가) 다른 창에서 열려 있어 옮기지 못했습니다`,
  folderGone: (folder: string) => `폴더 "${folder}"이(가) 이미 없습니다`,
  folderNameTaken: (folder: string) => `같은 이름의 폴더·프로젝트 "${folder}"이(가) 이미 있습니다`,
  folderColorChanged: (folder: string) => `폴더 "${folder}"의 색이 그사이 바뀌었습니다`,
  folderOrderChanged: '폴더 목록·순서가 그사이 바뀌었습니다',
  folderNotEmpty: (folder: string) => `폴더 "${folder}"에 프로젝트나 하위 폴더가 생겨 지우지 않았습니다`,
  folderHasTemplate: (folder: string) => `폴더 "${folder}"에 기본 템플릿이 지정돼 있어 지우지 않았습니다`,
  // 2차 묶음 3 P1-b 프로젝트·폴더 삭제류(전역 스택) — projectDeleteUndo.ts. 되돌려도 프로젝트를 열지 않는다(D8)
  projectDelete: (name: string) => `프로젝트 삭제: ${name}`,
  sceneTemplateDelete: (name: string) => `씬 템플릿 삭제: ${name}`,
  projectTrashRestore: (name: string) => `휴지통 복원: 프로젝트 ${name}`,
  folderDelete: (folder: string) => `폴더 삭제: ${folder}`,
  folderDeleteWithProjects: (folder: string, count: number) =>
    count > 0 ? `폴더와 프로젝트 ${count}개 삭제: ${folder}` : `폴더 삭제: ${folder}`,
  // 실패·안내 이유
  projectNameActive: (name: string) => `같은 이름의 프로젝트 "${name}"이(가) 있어 되돌리지 않았습니다`,
  projectNotInTrash: (name: string) => `프로젝트 "${name}"이(가) 휴지통에 없습니다(영구 삭제·보존 기간 경과·휴지통 비우기)`,
  projectDeleteBlocked: (name: string) => `프로젝트 "${name}"이(가) 다른 창에서 열려 있어 휴지통으로 옮기지 못했습니다`,
  projectRestoredElsewhere: (name: string, folder: string) =>
    `원래 폴더가 없어 프로젝트 "${name}"은(는) ${folder}에 복원했습니다`,
  projectSidecarNotRestored: (name: string) => `프로젝트 "${name}"의 즐겨찾기·북마크 일부를 되살리지 못했습니다`,
  folderTemplatesNotRestored: (count: number) => `폴더 기본 템플릿 지정 ${count}개를 되살리지 못했습니다`,
} as const;

// ── 참조 손잡이 ───────────────────────────────────────────────────────────
// 항목은 씬·프리셋을 이름이 아닌 손잡이로 잡는다. 삭제 되돌림으로 새 객체가 생기면 rebind 로 옮긴다.
export interface UndoRef<T extends object> {
  current: T;
}

const refs = new WeakMap<object, UndoRef<object>>();

/** 객체당 손잡이 하나(같은 객체면 같은 손잡이) */
export function undoRef<T extends object>(obj: T): UndoRef<T> {
  let r = refs.get(obj);
  if (!r) {
    r = { current: obj };
    refs.set(obj, r);
  }
  return r as UndoRef<T>;
}

/** old 를 잡던 손잡이가 이제 next 를 가리키게 한다(삭제 복원 등으로 객체가 바뀐 경우) */
export function rebind<T extends object>(oldObj: T, nextObj: T): void {
  const r = refs.get(oldObj);
  if (!r) return;
  r.current = nextObj;
  refs.set(nextObj, r);
}

// ── 깊은 복사·비교(순수) ────────────────────────────────────────────────────
// toJSON 이 배열(game·imageMap·mains 등)을 복사하지 않고 넘기므로(types.ts AbstractScene.toJSON),
// toJSON 결과를 그대로 보관하면 이후 변경이 스냅숏에 섞인다 → 항상 끝까지 복사한다.
export function undoDeepClone<T>(value: T): T {
  return cloneValue(value, new Map()) as T;
}

function cloneValue(v: unknown, seen: Map<unknown, unknown>): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (seen.has(v)) return seen.get(v);
  if (v instanceof Date) return new Date(v.getTime());
  if (v instanceof Map || isObservableMap(v)) {
    const out = new Map();
    seen.set(v, out);
    for (const [k, x] of (v as Map<unknown, unknown>).entries()) out.set(k, cloneValue(x, seen));
    return out;
  }
  if (v instanceof Set || isObservableSet(v)) {
    const out = new Set();
    seen.set(v, out);
    for (const x of (v as Set<unknown>).values()) out.add(cloneValue(x, seen));
    return out;
  }
  if (Array.isArray(v)) {
    const out: unknown[] = [];
    seen.set(v, out);
    for (const x of v) out.push(cloneValue(x, seen));
    return out;
  }
  const withToJSON = v as { toJSON?: () => unknown };
  if (typeof withToJSON.toJSON === 'function') {
    return cloneValue(withToJSON.toJSON(), seen);
  }
  const out: Record<string, unknown> = {};
  seen.set(v, out);
  for (const k of Object.keys(v as object)) out[k] = cloneValue((v as Record<string, unknown>)[k], seen);
  return out;
}

function canonical(v: unknown): unknown {
  if (v === undefined) return { __undef: true };
  if (v === null || typeof v !== 'object') return v;
  if (v instanceof Date) return { __date: v.getTime() };
  if (v instanceof Map) return { __map: [...v.entries()].map(([k, x]) => [canonical(k), canonical(x)]) };
  if (v instanceof Set) return { __set: [...v.values()].map(canonical) };
  if (Array.isArray(v)) return v.map(canonical);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v as object).sort()) out[k] = canonical((v as Record<string, unknown>)[k]);
  return out;
}

export function undoDeepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  return JSON.stringify(canonical(undoDeepClone(a))) === JSON.stringify(canonical(undoDeepClone(b)));
}

function isThenable(v: unknown): v is PromiseLike<unknown> {
  return !!v && typeof (v as { then?: unknown }).then === 'function';
}

function errorText(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === 'string' && e) return e;
  return UNDO_TEXT.unknownError;
}

// ── 서비스 ────────────────────────────────────────────────────────────────
interface Stack {
  past: UndoEntry[];
  future: UndoEntry[];
}

interface GroupFrame {
  label: string;
  children: UndoEntry[];
}

/** set 병합용 내부 상태 */
interface SetMergeState {
  before: unknown;
  after: unknown;
  assign(v: unknown): void;
}

const mergeStates = new WeakMap<UndoEntry, SetMergeState>();

/** track(merge) 병합용 — 이전·이후 스냅숏 상자 */
interface SnapshotMergeState {
  before: unknown;
  after: unknown;
}

const snapshotMerges = new WeakMap<UndoEntry, SnapshotMergeState>();

const targetIds = new WeakMap<object, number>();
let nextTargetId = 1;
function targetId(obj: object): number {
  let id = targetIds.get(obj);
  if (id === undefined) {
    id = nextTargetId++;
    targetIds.set(obj, id);
  }
  return id;
}

const defaultDeps: UndoDeps = {
  curSession: () => {
    try {
      return getAppState().curSession;
    } catch {
      return undefined;
    }
  },
  // models/index.ts 가 sessionService.isMirror 로 바꿔 끼운다(순환 import 회피)
  isMirror: () => false,
  toast: (message, kind) => {
    try {
      getAppState().pushMessage(message, kind);
    } catch {
      /* 부팅 전 — 안내 생략 */
    }
  },
  now: () => Date.now(),
  confirm: (message, confirmText) => {
    try {
      return getAppState().confirmAsync(message, confirmText);
    } catch {
      // 부팅 전(확인 창을 띄울 수 없음) — 묻지 않고 진행(그때는 되돌릴 기록도 없다)
      return Promise.resolve(true);
    }
  },
};

export class UndoService {
  /** 스택이 바뀔 때마다 증가 — 버튼·퀵 메뉴의 활성 상태가 이것을 읽어 다시 그린다 */
  @observable accessor version: number = 0;

  #deps: UndoDeps;
  #stacks = new WeakMap<UndoScope, Stack>();
  #groups = new WeakMap<UndoScope, GroupFrame[]>();
  #pendingDrags = new WeakMap<UndoScope, UndoPending>();
  #busy = false;
  #applying = false;
  /** 비동기 항목 실행 중 생긴 기록 — 실행이 끝나면 도착 순서대로 쌓는다(U4) */
  #deferred: { session: UndoScope; entry: UndoEntry }[] = [];
  #nextId = 1;
  /** 「가장 최근」 순번(UndoEntry.seq) — 프로젝트·전역 스택 공용 */
  #nextSeq = 1;
  maxDepth = UNDO_MAX_DEPTH;

  constructor(deps: Partial<UndoDeps> = {}) {
    this.#deps = { ...defaultDeps, ...deps };
    makeObservable(this);
  }

  configure(deps: Partial<UndoDeps>): void {
    this.#deps = { ...this.#deps, ...deps };
    this.#bump();
  }

  #bump() {
    runInAction(() => {
      this.version++;
    });
  }

  #stack(session: UndoScope): Stack {
    let st = this.#stacks.get(session);
    if (!st) {
      st = { past: [], future: [] };
      this.#stacks.set(session, st);
    }
    return st;
  }

  /** 항목 함수를 동기로 부르는 중 — 이 동안 기록은 무시된다(재귀 방지). 비동기 대기 중에는 false(기록은 대기열로) */
  get isApplying(): boolean {
    return this.#applying;
  }

  get isBusy(): boolean {
    return this.#busy;
  }

  /** 이 스택에 기록할 수 있는가(실행 중·미러 프로젝트면 아니오. 전역 스택은 미러와 무관) */
  canRecord(session: UndoScope | undefined): session is UndoScope {
    if (!session) return false;
    if (this.#applying) return false;
    if (isGlobalUndoScope(session)) return true;
    return !this.#deps.isMirror(session);
  }

  /** 되돌리기 대상이 되는 프로젝트 스택인가(있고 미러가 아님) */
  #usableProject(session: Session | undefined): session is Session {
    return !!session && !isGlobalUndoScope(session) && !this.#deps.isMirror(session);
  }

  /** 이 프로젝트에서 고를 수 있는 스택 키 — 프로젝트(쓸 수 있으면)와 전역 */
  #scopesFor(session: Session | undefined): UndoScope[] {
    return this.#usableProject(session) ? [session, GLOBAL_UNDO_SCOPE] : [GLOBAL_UNDO_SCOPE];
  }

  /** 고를 수 있는 스택 중 그 방향 맨 위가 가장 최근(seq 최대)인 것 */
  #pick(
    session: Session | undefined,
    dir: UndoDirection,
  ): { scope: UndoScope; st: Stack; src: UndoEntry[]; entry: UndoEntry } | undefined {
    let best: { scope: UndoScope; st: Stack; src: UndoEntry[]; entry: UndoEntry } | undefined;
    for (const scope of this.#scopesFor(session)) {
      const st = this.#stacks.get(scope);
      const src = dir === 'undo' ? st?.past : st?.future;
      if (!st || !src || src.length === 0) continue;
      const entry = src[src.length - 1];
      if (!best || entry.seq > best.entry.seq) best = { scope, st, src, entry };
    }
    return best;
  }

  /** 전역 스택에 되돌리기·다시 실행할 항목이 있는가 — 프로젝트가 없어도 버튼 바를 보일지(UndoRedoBar) */
  get hasGlobalEntries(): boolean {
    void this.version; // 관찰 구독
    const st = this.#stacks.get(GLOBAL_UNDO_SCOPE);
    return !!st && st.past.length + st.future.length > 0;
  }

  // ── 조회(UI) — curSession 기준(프로젝트 스택 + 전역 스택 중 최근) ──
  get canUndo(): boolean {
    return this.canUndoFor(this.#deps.curSession());
  }

  get canRedo(): boolean {
    return this.canRedoFor(this.#deps.curSession());
  }

  get undoLabel(): string | undefined {
    return this.peekLabel(this.#deps.curSession(), 'undo');
  }

  get redoLabel(): string | undefined {
    return this.peekLabel(this.#deps.curSession(), 'redo');
  }

  canUndoFor(session: Session | undefined): boolean {
    return !!this.peekLabel(session, 'undo');
  }

  canRedoFor(session: Session | undefined): boolean {
    return !!this.peekLabel(session, 'redo');
  }

  peekLabel(session: Session | undefined, dir: UndoDirection): string | undefined {
    void this.version; // 관찰 구독
    const top = this.#pick(session, dir)?.entry;
    if (!top) return undefined;
    return dir === 'undo' ? (top.undoLabel ?? top.label) : top.label;
  }

  /** 실행이 끝난 뒤 — 대기열의 기록을 도착 순서대로 쌓는다(새 기록이므로 future 를 비운다) */
  #flushDeferred() {
    const list = this.#deferred;
    this.#deferred = [];
    for (const d of list) this.#pushNow(d.session, d.entry);
  }

  /** 병합(set·track merge) 대상 맨 위 항목 — 실행 중이면 스택이 아니라 대기열의 마지막 것만 */
  #mergeTop(session: UndoScope): { top: UndoEntry; drop: () => void } | undefined {
    const frame = this.#openFrame(session);
    if (frame) {
      const top = frame.children[frame.children.length - 1];
      return top ? { top, drop: () => this.#remove(frame.children, top) } : undefined;
    }
    if (this.#busy) {
      for (let i = this.#deferred.length - 1; i >= 0; i--) {
        const d = this.#deferred[i];
        if (d.session !== session) continue;
        return {
          top: d.entry,
          drop: () => {
            const j = this.#deferred.indexOf(d);
            if (j >= 0) this.#deferred.splice(j, 1);
          },
        };
      }
      return undefined;
    }
    const st = this.#stack(session);
    if (st.future.length !== 0) return undefined;
    const top = st.past[st.past.length - 1];
    return top ? { top, drop: () => this.#remove(st.past, top) } : undefined;
  }

  /** 항목 함수 호출 — 동기 부분 동안만 기록을 막는다(재귀 방지) */
  #invoke(entry: UndoEntry, dir: UndoDirection): UndoRunResult | Promise<UndoRunResult> {
    const prev = this.#applying;
    this.#applying = true;
    try {
      return entry[dir]();
    } finally {
      this.#applying = prev;
    }
  }

  /** 테스트·진단용 스택 사본 */
  entries(session: UndoScope): { past: readonly UndoEntry[]; future: readonly UndoEntry[] } {
    const st = this.#stacks.get(session);
    return { past: [...(st?.past ?? [])], future: [...(st?.future ?? [])] };
  }

  clear(session: UndoScope): void {
    this.#stacks.delete(session);
    this.#bump();
  }

  // ── 기록 ──
  #makeEntry(init: UndoEntryInit): UndoEntry {
    const now = this.#deps.now();
    return {
      ...init,
      kind: init.kind ?? 'state',
      id: this.#nextId++,
      createdAt: now,
      updatedAt: now,
      seq: this.#nextSeq++,
    };
  }

  /** 병합·이동으로 「가장 최근」이 된 항목에 새 순번 */
  #touchSeq(entry: UndoEntry) {
    entry.seq = this.#nextSeq++;
  }

  #openFrame(session: UndoScope): GroupFrame | undefined {
    const frames = this.#groups.get(session);
    return frames && frames.length > 0 ? frames[frames.length - 1] : undefined;
  }

  #push(session: UndoScope, entry: UndoEntry) {
    const frame = this.#openFrame(session);
    if (frame) {
      frame.children.push(entry);
      return;
    }
    // 비동기 항목 실행 중 — 지금 쌓으면 실행 중 항목의 자리 이동(past↔future)과 섞이므로 끝난 뒤에 쌓는다
    if (this.#busy) {
      this.#deferred.push({ session, entry });
      return;
    }
    this.#pushNow(session, entry);
  }

  #pushNow(session: UndoScope, entry: UndoEntry) {
    const st = this.#stack(session);
    this.#touchSeq(entry);
    st.past.push(entry);
    while (st.past.length > this.maxDepth) st.past.shift();
    st.future = [];
    // 한 이력처럼 — 새 동작 뒤에는 짝 스택(프로젝트 ↔ 전역)의 다시 실행도 끊는다
    const partner: UndoScope | undefined = isGlobalUndoScope(session)
      ? this.#deps.curSession()
      : GLOBAL_UNDO_SCOPE;
    const pst = partner ? this.#stacks.get(partner) : undefined;
    if (pst && pst !== st) pst.future = [];
    this.#bump();
  }

  /** 항목 하나를 기록한다. 실행 중·미러면 무시(undefined) */
  record(session: UndoScope | undefined, init: UndoEntryInit): UndoEntry | undefined {
    if (!this.canRecord(session)) return undefined;
    const entry = this.#makeEntry(init);
    this.#push(session, entry);
    return entry;
  }

  // ── 실행 — 프로젝트 스택(없거나 미러면 제외)과 전역 스택 중 맨 위가 더 최근인 쪽 ──
  undo(session: Session | undefined = this.#deps.curSession()): Promise<boolean> {
    return this.#execute(session, 'undo');
  }

  redo(session: Session | undefined = this.#deps.curSession()): Promise<boolean> {
    return this.#execute(session, 'redo');
  }

  #remove(list: UndoEntry[], entry: UndoEntry) {
    const i = list.lastIndexOf(entry);
    if (i >= 0) list.splice(i, 1);
  }

  async #execute(session: Session | undefined, dir: UndoDirection): Promise<boolean> {
    // 프로젝트가 없거나 미러여도 전역 항목이 있으면 진행
    if (!this.#usableProject(session) && !this.hasGlobalEntries) return false;
    if (this.#busy) {
      this.#deps.toast(UNDO_TEXT.busy, 'info');
      return false;
    }
    // 끝나지 않은 드래그가 있으면 먼저 확정(놓친 pointerup — 기록 순서 보존)
    for (const scope of this.#scopesFor(session)) this.#pendingDrags.get(scope)?.commit();
    const picked = this.#pick(session, dir);
    if (!picked) return false;
    const { st, src, entry } = picked;
    const fail = (reason: string) => {
      this.#remove(src, entry);
      this.#deps.toast(
        dir === 'undo' ? UNDO_TEXT.undoFailed(reason) : UNDO_TEXT.redoFailed(reason),
        'error',
      );
      return false;
    };
    this.#busy = true;
    this.#bump();
    try {
      const v = entry.verify?.(dir);
      if (v !== undefined && v !== true) return fail(v);
      // D16 — 기록 밖 변경과 겹쳤으면 묻는다. 취소면 항목을 그대로 둔다(다시 누르면 다시 묻는다).
      if (entry.conflict?.(dir)) {
        const label = dir === 'undo' ? (entry.undoLabel ?? entry.label) : entry.label;
        const ok = await this.#deps.confirm(
          dir === 'undo' ? UNDO_TEXT.conflictUndo(label) : UNDO_TEXT.conflictRedo(label),
          dir === 'undo' ? UNDO_TEXT.undoName : UNDO_TEXT.redoName,
        );
        if (!ok) return false;
      }
      const r = this.#invoke(entry, dir);
      const outcome: UndoRunResult = isThenable(r) ? await r : r;
      if (outcome && outcome.total > 0 && outcome.failed >= outcome.total) {
        return fail(outcome.firstError ?? UNDO_TEXT.groupAllFailed);
      }
      this.#remove(src, entry);
      const dst = dir === 'undo' ? st.future : st.past;
      // 옮긴 항목이 그 방향의 「가장 최근」 — 다시 실행은 최근 되돌린 것부터, 되돌리기는 최근 다시 실행한 것부터
      this.#touchSeq(entry);
      dst.push(entry);
      while (dst.length > this.maxDepth) dst.shift();
      const base =
        dir === 'undo' ? UNDO_TEXT.undone(entry.undoLabel ?? entry.label) : UNDO_TEXT.redone(entry.label);
      const partial =
        outcome && outcome.failed > 0 ? UNDO_TEXT.partial(outcome.failed, outcome.total) : '';
      const tail = outcome && outcome.notice ? ` (${outcome.notice})` : partial;
      this.#deps.toast(base + tail, outcome && outcome.failed > 0 ? 'error' : 'info');
      return true;
    } catch (e) {
      return fail(errorText(e));
    } finally {
      this.#busy = false;
      this.#flushDeferred();
      this.#bump();
    }
  }

  // ── 헬퍼 ──

  /**
   * 값 하나를 바꾸고 기록. 같은 target·key 를 mergeMs(기본 1초) 안에 또 바꾸면 맨 위 항목에 합친다.
   * 합친 결과가 처음 값과 같아지면 항목을 지운다. 값은 원시값·불변 값 전용(객체는 capture 를 쓴다).
   */
  set<T extends object, K extends keyof T>(
    session: UndoScope | undefined,
    target: T,
    key: K,
    next: T[K],
    label: string,
    opts: {
      mergeMs?: number;
      /** 되돌림·다시 실행 때 대입할 객체를 손잡이로(삭제 복원으로 객체가 바뀌어도 따라간다) */
      ref?: UndoRef<T>;
      /** 실행 직전 검사(대상이 아직 있는가 등) */
      verify?: () => true | string;
    } = {},
  ): void {
    const prev = target[key];
    if (Object.is(prev, next)) return;
    runInAction(() => {
      target[key] = next;
    });
    if (!this.canRecord(session)) return;
    const ref = opts.ref;
    const mergeKey = `set:${targetId(ref ?? target)}:${String(key)}`;
    const mergeMs = opts.mergeMs ?? UNDO_MERGE_MS;
    const now = this.#deps.now();
    const mt = this.#mergeTop(session);
    const top = mt?.top;
    const merge = top && top.mergeKey === mergeKey ? mergeStates.get(top) : undefined;
    if (mt && top && merge && now - top.updatedAt <= mergeMs) {
      merge.after = next;
      top.updatedAt = now;
      this.#touchSeq(top);
      if (Object.is(merge.before, next)) mt.drop();
      this.#bump();
      return;
    }
    const assign = (v: unknown) =>
      runInAction(() => {
        (ref ? ref.current : target)[key] = v as T[K];
      });
    const state: SetMergeState = { before: prev, after: next, assign };
    const verify = opts.verify;
    const entry = this.record(session, {
      label,
      mergeKey,
      ...(verify ? { verify: () => verify() } : {}),
      undo: () => state.assign(state.before),
      redo: () => state.assign(state.after),
    });
    if (entry) mergeStates.set(entry, state);
  }

  /**
   * 지정 필드를 깊은 복사로 보관해 두었다가 commit 때 바뀌었으면 1항목. 되살릴 때마다 새 사본을 대입한다.
   * restore 를 주면 사본(평범한 JSON 형)을 클래스 객체로 되돌린다(fromJSON 등).
   */
  capture<T extends object>(
    session: UndoScope | undefined,
    label: string,
    target: T,
    keys: (keyof T)[],
    opts: { restore?: (key: keyof T, plain: unknown) => unknown } = {},
  ): UndoPending {
    return this.#snapshotPending(session, label, this.#fieldsAdapter(target, keys, opts));
  }

  /**
   * 객체 필드가 아닌 상태(씬 순서 등)를 상태 짝으로 감싼다 — 시작에 보관, commit 때 바뀌었으면 1항목.
   * merge.key 를 주면 같은 key 의 맨 위 항목이 merge.ms(기본 1초) 안이면 그 항목의 「이후 값」만 바꾼다(set 과 같은 병합 —
   * future 가 비었을 때만, 합친 결과가 처음 값과 같아지면 항목 삭제). 여러 필드를 한 번에 보관해야 하는 값 변경(U3b 사전 세팅
   * 필드 + 샘플링 프로필)에 쓴다.
   */
  track<S>(
    session: UndoScope | undefined,
    label: string,
    adapter: UndoSnapshotAdapter<S>,
    merge?: { key: string; ms?: number },
  ): UndoPending {
    return this.#snapshotPending(session, label, adapter, undefined, merge);
  }

  #fieldsAdapter<T extends object>(
    target: T,
    keys: (keyof T)[],
    opts: { restore?: (key: keyof T, plain: unknown) => unknown },
  ): UndoSnapshotAdapter<unknown[]> {
    return {
      // 통째 덮어쓰는 복원 — 기록 밖 변경과 겹치면 확인(D16)
      detectConflict: true,
      snapshot: () => keys.map((k) => undoDeepClone(target[k])),
      restore: (snap) =>
        runInAction(() => {
          keys.forEach((k, i) => {
            const plain = undoDeepClone(snap[i]);
            target[k] = (opts.restore ? opts.restore(k, plain) : plain) as T[keyof T];
          });
        }),
    };
  }

  #snapshotPending<S>(
    session: UndoScope | undefined,
    label: string,
    adapter: UndoSnapshotAdapter<S>,
    onSettle?: () => void,
    merge?: { key: string; ms?: number },
  ): UndoPending {
    if (!this.canRecord(session)) {
      return { commit: () => false, cancel: () => {} };
    }
    const before = adapter.snapshot();
    let done = false;
    const settle = () => {
      done = true;
      onSettle?.();
    };
    return {
      commit: () => {
        if (done) return false;
        settle();
        if (!this.canRecord(session)) return false;
        const after = adapter.snapshot();
        const eq = (a: S, b: S) => (adapter.equals ? adapter.equals(a, b) : undoDeepEqual(a, b));
        if (eq(before, after)) return false;
        if (merge && this.#mergeSnapshot(session, merge, after, eq, label)) return true;
        // 병합 가능한 항목은 이전·이후 값을 바꿀 수 있는 상자에 둔다(다음 병합이 after 만 갈아 끼움)
        const state: SnapshotMergeState = { before, after };
        const verify = adapter.verify;
        const stale = adapter.staleReason;
        const entry = this.record(session, {
          label,
          ...(merge ? { mergeKey: `track:${merge.key}` } : {}),
          ...(verify || stale !== undefined
            ? {
                verify: (dir: UndoDirection) => {
                  const v = verify ? verify() : true;
                  if (v !== true) return v;
                  // 기록 밖 변경 = 실패(전역 항목 — 다른 창이 바꿨으면 덮어쓰지 않고 버린다)
                  if (
                    stale !== undefined &&
                    !eq(adapter.snapshot(), (dir === 'undo' ? state.after : state.before) as S)
                  ) {
                    return stale;
                  }
                  return true;
                },
              }
            : {}),
          // D16 — 되돌림은 지금이 「이후 값」, 다시 실행은 지금이 「이전 값」이어야 겹침 없음
          ...(adapter.detectConflict
            ? {
                conflict: (dir: UndoDirection) =>
                  !eq(adapter.snapshot(), (dir === 'undo' ? state.after : state.before) as S),
              }
            : {}),
          undo: () => adapter.restore(state.before as S),
          redo: () => adapter.restore(state.after as S),
        });
        if (entry && merge) snapshotMerges.set(entry, state);
        return true;
      },
      cancel: () => {
        if (!done) settle();
      },
    };
  }

  /** track(merge) — 맨 위 항목이 같은 key 이고 시간 창 안이면 after 만 갈아 끼운다. 합쳤으면 true */
  #mergeSnapshot<S>(
    session: UndoScope,
    merge: { key: string; ms?: number },
    after: S,
    eq: (a: S, b: S) => boolean,
    label: string,
  ): boolean {
    const now = this.#deps.now();
    const mt = this.#mergeTop(session);
    const top = mt?.top;
    if (!mt || !top || top.mergeKey !== `track:${merge.key}`) return false;
    const state = snapshotMerges.get(top);
    if (!state || now - top.updatedAt > (merge.ms ?? UNDO_MERGE_MS)) return false;
    state.after = after;
    top.updatedAt = now;
    this.#touchSeq(top);
    // 라벨은 마지막 동작 기준(그림체 선택처럼 값이 라벨에 들어가는 경우 — 같은 칸이면 대개 같은 문구)
    top.label = label;
    if (eq(state.before as S, after)) mt.drop();
    this.#bump();
    return true;
  }

  /**
   * apply 를 실행하고 성공했을 때만 기록. 다시 실행 = apply, 되돌림 = revert. 비동기 허용(완료 뒤 기록).
   * 실패(예외)면 기록하지 않고 예외를 그대로 던진다.
   */
  run<R>(
    session: UndoScope | undefined,
    label: string,
    op: {
      apply: () => R;
      revert: () => unknown;
      verify?: (dir: UndoDirection) => true | string;
      kind?: UndoKind;
    },
  ): R {
    const init = (): UndoEntryInit => ({
      label,
      kind: op.kind,
      verify: op.verify,
      redo: async () => {
        await op.apply();
      },
      undo: async () => {
        await op.revert();
      },
    });
    const r = op.apply();
    if (isThenable(r)) {
      return (r as unknown as Promise<unknown>).then((v) => {
        this.record(session, init());
        return v;
      }) as unknown as R;
    }
    this.record(session, init());
    return r;
  }

  /** fn 안에서 생긴 기록을 1항목으로 묶는다(되돌림 역순·다시 실행 정순). fn 이 실패해도 생긴 기록은 남긴다. */
  group<R>(session: UndoScope | undefined, label: string, fn: () => R): R {
    const g = this.beginGroup(session, label);
    let r: R;
    try {
      r = fn();
    } catch (e) {
      g.commit();
      throw e;
    }
    if (isThenable(r)) {
      return (r as unknown as Promise<unknown>).then(
        (v) => {
          g.commit();
          return v;
        },
        (e) => {
          g.commit();
          throw e;
        },
      ) as unknown as R;
    }
    g.commit();
    return r;
  }

  /** 비동기 흐름용 묶음 — commit 까지 이 프로젝트의 기록이 묶음에 들어간다 */
  beginGroup(session: UndoScope | undefined, label: string): UndoGroupHandle {
    if (!this.canRecord(session)) {
      return { add: () => {}, setLabel: () => {}, commit: () => false, cancel: () => {} };
    }
    const frame: GroupFrame = { label, children: [] };
    let frames = this.#groups.get(session);
    if (!frames) {
      frames = [];
      this.#groups.set(session, frames);
    }
    frames.push(frame);
    let done = false;
    const close = () => {
      done = true;
      const list = this.#groups.get(session);
      if (list) {
        const i = list.lastIndexOf(frame);
        if (i >= 0) list.splice(i, 1);
      }
    };
    return {
      add: (init) => {
        if (done || !this.canRecord(session)) return;
        frame.children.push(this.#makeEntry(init));
      },
      setLabel: (next) => {
        if (!done) frame.label = next;
      },
      commit: () => {
        if (done) return false;
        close();
        if (frame.children.length === 0) return false;
        const children = frame.children;
        const kind: UndoKind = children.some((c) => c.kind === 'file') ? 'file' : 'state';
        const runAll = async (dir: UndoDirection): Promise<UndoOutcome> => {
          const order = dir === 'undo' ? [...children].reverse() : [...children];
          const total = order.length;
          let failed = 0;
          let firstError: string | undefined;
          const notices: string[] = [];
          for (const c of order) {
            const v = c.verify?.(dir);
            if (v !== undefined && v !== true) {
              failed++;
              firstError ??= v;
              this.#remove(children, c);
              continue;
            }
            try {
              const r = this.#invoke(c, dir);
              const out = isThenable(r) ? await r : r;
              // 하위 항목이 결과를 돌려주면(U4 삭제 항목 등) 전부 실패 = 실패, 안내는 모은다
              if (out && out.total > 0 && out.failed >= out.total) {
                throw new Error(out.firstError ?? UNDO_TEXT.groupAllFailed);
              }
              if (out && out.notice) notices.push(out.notice);
            } catch (e) {
              failed++;
              firstError ??= errorText(e);
              // 실패한 하위 항목만 버린다(D15) — 나머지는 다음 실행에도 유지
              this.#remove(children, c);
            }
          }
          // 하위 안내가 있으면 그것을 앞세우고 부분 실패 문구를 뒤에 붙인다(없으면 기존 부분 실패 문구 그대로)
          const notice =
            notices.length > 0
              ? [...notices, ...(failed > 0 ? [UNDO_TEXT.partial(failed, total).trim()] : [])].join(' · ')
              : undefined;
          return { total, failed, firstError, ...(notice ? { notice } : {}) };
        };
        const entry = this.#makeEntry({
          label: frame.label,
          kind,
          // D16 — 하위 항목 하나라도 겹치면 묶음 전체를 한 번 묻는다(하위마다 묻지 않음)
          conflict: (dir) => children.some((c) => !!c.conflict?.(dir)),
          undo: () => runAll('undo'),
          redo: () => runAll('redo'),
        });
        this.#push(session, entry);
        return true;
      },
      cancel: () => {
        if (!done) close();
      },
    };
  }

  /**
   * 드래그·슬라이더처럼 누르는 동안 여러 번 바뀌는 상태 — 시작에 보관, 놓을 때 commit(변화 없으면 버림).
   * 객체 필드(target, keys) 또는 상태 짝(adapter)을 받는다. 같은 프로젝트에 끝나지 않은 드래그가 있으면 먼저 확정한다.
   */
  drag<T extends object>(
    session: UndoScope | undefined,
    label: string,
    target: T | UndoSnapshotAdapter<unknown>,
    keys?: (keyof T)[],
  ): UndoPending {
    if (!this.canRecord(session)) return { commit: () => false, cancel: () => {} };
    this.#pendingDrags.get(session)?.commit();
    const adapter: UndoSnapshotAdapter<unknown> =
      keys !== undefined
        ? (this.#fieldsAdapter(target as T, keys, {}) as UndoSnapshotAdapter<unknown>)
        : (target as UndoSnapshotAdapter<unknown>);
    const pending: UndoPending = this.#snapshotPending(session, label, adapter, () => {
      if (this.#pendingDrags.get(session) === pending) this.#pendingDrags.delete(session);
    });
    this.#pendingDrags.set(session, pending);
    return pending;
  }

  /** 이 프로젝트의 끝나지 않은 drag(·편집 세션)가 아직 pending 인가 — 되돌리기 실행·다음 drag 로 확정됐으면 false */
  isPendingOpen(session: UndoScope | undefined, pending: UndoPending): boolean {
    return !!session && this.#pendingDrags.get(session) === pending;
  }

  /** 입력 칸 포커스 진입 값을 보관하고, 떠날 때(commit) 바뀌었으면 1항목 */
  focusEdit<T extends object, K extends keyof T>(
    session: UndoScope | undefined,
    target: T,
    key: K,
    label: string,
  ): UndoPending {
    return this.capture(session, label, target, [key]);
  }
}

export const undoService = new UndoService();
