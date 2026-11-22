// 씬 편집 창 「씬 캐릭터 역할」 탭의 PC 배치 판정(2026-11-22 공간 개편 「안 가」).
// 화면 폭이 아니라 **탭 영역(역할 탭 뿌리) 폭** 기준 — 씬 편집 창은 앵커·가운데 블록 등 자리마다 폭이 달라
// 창 폭(md: 등)으로는 알 수 없다. 모바일은 이 판정을 쓰지 않는다(배치 불변).

/** 왼쪽 열(방식·공통 네거티브·기본 캐릭터·위치 지정) 고정 폭(px). 캐릭터 프리셋 관리 aside(280)·순차 생성 설정 열(300)과 같은 급. */
export const SCENE_ROLES_LEFT_COL_PX = 300;
/** 두 열 사이 간격(px) — 뿌리의 gap-4 와 같은 값. */
export const SCENE_ROLES_COL_GAP_PX = 16;
/** 뿌리 안쪽 여백 좌우 합(px) — 뿌리의 p-4 와 같은 값. */
export const SCENE_ROLES_ROOT_PAD_PX = 32;
/** 이 폭 미만이면 두 열 대신 왼쪽 열 내용을 위에 쌓는 한 열. */
export const SCENE_ROLES_TWO_COL_MIN_PX = 760;
/** 역할 목록(오른쪽) 열 폭이 이 값 이상이면 카드 안 프롬프트·네거티브를 나란히(3:2), 미만이면 위아래. */
export const SCENE_ROLES_SIDE_BY_SIDE_MIN_PX = 540;

export interface SceneRolesPcLayout {
  /** 두 열(왼쪽 고정 폭 + 오른쪽 역할 목록) */
  twoCol: boolean;
  /** 역할 카드 안 프롬프트·네거티브를 나란히 */
  sideBySide: boolean;
}

/**
 * 탭 뿌리 폭(px)으로 배치를 정한다. 폭을 아직 모르면(null·0 — 첫 측정 전·숨은 탭·테스트 환경) 넓은 배치.
 */
export function sceneRolesPcLayout(rootWidth: number | null | undefined): SceneRolesPcLayout {
  if (rootWidth == null || !(rootWidth > 0)) return { twoCol: true, sideBySide: true };
  const twoCol = rootWidth >= SCENE_ROLES_TWO_COL_MIN_PX;
  const listWidth = twoCol
    ? rootWidth - SCENE_ROLES_ROOT_PAD_PX - SCENE_ROLES_LEFT_COL_PX - SCENE_ROLES_COL_GAP_PX
    : rootWidth - SCENE_ROLES_ROOT_PAD_PX;
  return { twoCol, sideBySide: listWidth >= SCENE_ROLES_SIDE_BY_SIDE_MIN_PX };
}
