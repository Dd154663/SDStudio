// 레이아웃 템플릿(배치 구조가 다른 고정 프리셋)의 서술자 + 해석 단일 출처.
// 사용자가 환경설정에서 고른 템플릿 id는 Config(uiLayoutTemplate)의 저장 키가 되므로
// 한 번 배포된 뒤에는 바꾸지 않는다(uiLayout.ts 의 불변 id 계약과 동일).
// 실제 배치(JSX)는 App.tsx 가 resolveLayout 의 결과를 소비해 결정한다 — 인라인에서
// 직접 배치 분기를 만들지 않는다(배치 해석은 이 모듈이 단일 출처).

import type { UiLayoutSlots } from '../../main/config';

// 하단바(세션 선택 + 실행/중지 컨트롤)의 배치:
//   'bottom'=화면 하단 가로 바(클래식) / 'none'=하단바 미렌더(컴팩트).
export type BottomBarPlacement = 'bottom' | 'none';

// 히스토리/프리셋 패널의 좌우 배치, 생성 컨트롤의 부착/플로팅.
export type PanelSide = 'left' | 'right';
export type GenControlPlacement = 'docked' | 'floating';

// 히스토리/프리셋 패널은 두 템플릿 모두 기본이 같으므로(오른쪽/왼쪽)
// 템플릿 필드로 두지 않고 상수 기본값으로 관리한다(슬롯 오버라이드로만 변경).
const DEFAULT_HISTORY_SIDE: PanelSide = 'right';
const DEFAULT_PRESET_SIDE: PanelSide = 'left';
const DEFAULT_PROJECT_SIDE: PanelSide = 'left';

export interface LayoutTemplateMeta {
  id: string; // 불변 계약(config 저장 키): 'classic' | 'compact'
  // 환경설정 화면에서 사용자에게 보여줄 이름
  name: string;
  description: string;
  bottomBar: BottomBarPlacement;
  // 생성 컨트롤 기본 배치. classic='docked' / compact='floating'
  // (컴팩트는 하단바가 없어 이미 플로팅 강제였음).
  genControl: GenControlPlacement;
  // false → 모바일에서는 resolveLayout 이 classic 으로 강제 폴백(모바일 일관성 보장)
  mobileAllowed: boolean;
  // true → 프로젝트 진입을 좌측 두꺼운 사이드 바로, 하단/상단 바의 프로젝트 툴바(SessionSelect)는
  // 렌더하지 않는다. false(기본) → 기존처럼 SessionSelect 를 바에 렌더하고 사이드 바는 없다.
  projectSidebar: boolean;
}

export const layoutTemplates: LayoutTemplateMeta[] = [
  {
    id: 'classic',
    name: '클래식',
    description: '하단 가로 바 — 계층화 이전과 동일한 기본 배치.',
    bottomBar: 'bottom',
    genControl: 'docked',
    mobileAllowed: true,
    projectSidebar: false,
  },
  {
    id: 'compact',
    name: '컴팩트',
    description:
      '하단 바를 없애 세로 공간을 넓힙니다. 프로젝트 선택은 상단 바로, 생성 컨트롤은 떠 있는 위젯으로 이동합니다.',
    bottomBar: 'none',
    genControl: 'floating',
    mobileAllowed: false,
    projectSidebar: false,
  },
  {
    id: 'sidebar',
    name: '프로젝트 사이드바',
    description:
      '프로젝트를 좌측 두꺼운 세로 바로 진입합니다. 하단 바 없이 세로 공간을 넓히고, 생성 컨트롤은 떠 있는 위젯으로 둡니다.',
    // 프로젝트 툴바를 좌측 사이드 바로 옮겨 하단 바에 남는 요소가 없으므로 하단 바 자체를
    // 없앤다(컴팩트와 동일). 생성 컨트롤은 플로팅으로. 빈 더미 하단 바·부착 안내 제거.
    bottomBar: 'none',
    genControl: 'floating',
    mobileAllowed: false,
    projectSidebar: true,
  },
];

// resolveLayout 이 App.tsx 로 넘기는 해석 결과. 하단바 위치 + 개인화 슬롯.
export interface ResolvedLayout {
  id: string;
  bottomBar: BottomBarPlacement;
  // 세션(프로젝트) 선택을 상단 바로 올릴지 — 컴팩트는 하단바가 없어 상단으로 이동.
  // bottomBar==='none' 에서 파생되지만, 소비처 가독성을 위해 명시 필드로 노출한다.
  sessionSelectTop: boolean;
  // 이미지 히스토리 패널 좌/우 (기본 right).
  historySide: PanelSide;
  // 프리셋 에디터 패널 좌/우 (기본 left).
  presetSide: PanelSide;
  // 프로젝트 사이드 바(드로어 진입) 좌/우 (기본 left).
  projectSide: PanelSide;
  // 생성 컨트롤 부착/플로팅 (템플릿 기본 위에 슬롯 오버라이드).
  genControl: GenControlPlacement;
  // 프로젝트 사이드 바 사용 여부(템플릿 고정 — 슬롯 오버라이드 없음).
  projectSidebar: boolean;
}

// 타입 밖 문자열이 stale 하게 저장돼 있던 경우를 걸러내는 검증기(잘못된 값=무시하고 기본값).
function coercePanelSide(v: unknown, fallback: PanelSide): PanelSide {
  return v === 'left' || v === 'right' ? v : fallback;
}
function coerceGenControl(
  v: unknown,
  fallback: GenControlPlacement,
): GenControlPlacement {
  return v === 'docked' || v === 'floating' ? v : fallback;
}

// 레지스트리 + 사용자 설정 → 실제 배치를 해석하는 단일 출처(순수 함수, resolveToolbar 선례 미러).
// - 미지정/미존재 id → classic 폴백(stale id 조용히 무시).
// - mobileAllowed=false && isMobile → classic 강제(모바일 일관성 보장).
// - 그 외 → 해당 템플릿 그대로.
// slots(3번째 인자, 옵셔널)는 템플릿 기본값 위에 얹는 개인화 오버라이드.
// - 모바일이면 slots 전부 무시(템플릿도 classic 강제 — 기존 규칙 유지).
// - 잘못된 값(타입 밖 문자열)은 무시하고 기본값(stale 안전).
export function resolveLayout(
  templateId: string | undefined,
  isMobile: boolean,
  slots?: UiLayoutSlots,
): ResolvedLayout {
  const classic = layoutTemplates[0];
  const meta = layoutTemplates.find((t) => t.id === templateId);

  // 실제로 적용할 템플릿(미존재 id·모바일 비허용 → classic 폴백).
  const effective = !meta || (isMobile && !meta.mobileAllowed) ? classic : meta;

  // 기본값: 상수(history/preset/project) + 템플릿(genControl).
  let historySide: PanelSide = DEFAULT_HISTORY_SIDE;
  let presetSide: PanelSide = DEFAULT_PRESET_SIDE;
  let projectSide: PanelSide = DEFAULT_PROJECT_SIDE;
  let genControl: GenControlPlacement = effective.genControl;

  // slots 오버라이드는 PC 에서만(모바일은 일관성 위해 전부 무시).
  if (slots && !isMobile) {
    historySide = coercePanelSide(slots.historySide, historySide);
    presetSide = coercePanelSide(slots.presetSide, presetSide);
    projectSide = coercePanelSide(slots.projectSide, projectSide);
    genControl = coerceGenControl(slots.genControl, genControl);
  }

  return {
    id: effective.id,
    bottomBar: effective.bottomBar,
    sessionSelectTop: effective.bottomBar === 'none',
    historySide,
    presetSide,
    projectSide,
    genControl,
    projectSidebar: effective.projectSidebar,
  };
}

// 도킹 요소(프로젝트/프리셋/히스토리)의 CSS order 계산 단일 출처.
// rank = 가장자리 우선순위: 프로젝트=1, 프리셋=2, 히스토리=3 (낮을수록 화면 끝면에 가깝게).
// 중앙 콘텐츠는 order 0 으로 두고, 좌측 도킹은 음수(작을수록 왼쪽), 우측은 양수(클수록 오른쪽).
//  좌: 프로젝트(-3) 프리셋(-2) 히스토리(-1) 콘텐츠(0)
//  우: 콘텐츠(0) 히스토리(1) 프리셋(2) 프로젝트(3)
// 같은 쪽에 여럿 도킹돼도 항상 프로젝트<프리셋<히스토리 순으로 겹치도록 강제된다.
export const DOCK_RANK = { project: 1, preset: 2, history: 3 } as const;
export function dockOrder(side: PanelSide, rank: number): number {
  const magnitude = 4 - rank; // rank 1→3, 2→2, 3→1
  return side === 'left' ? -magnitude : magnitude;
}
