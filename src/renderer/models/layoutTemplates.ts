// 레이아웃 템플릿(배치 구조가 다른 고정 프리셋)의 서술자 + 해석 단일 출처.
// 사용자가 환경설정에서 고른 템플릿 id는 Config(uiLayoutTemplate)의 저장 키가 되므로
// 한 번 배포된 뒤에는 바꾸지 않는다(uiLayout.ts 의 불변 id 계약과 동일).
// 실제 배치(JSX)는 App.tsx 가 resolveLayout 의 결과를 소비해 결정한다 — 인라인에서
// 직접 배치 분기를 만들지 않는다(배치 해석은 이 모듈이 단일 출처).

// 하단바(세션 선택 + 실행/중지 컨트롤)의 배치:
//   'bottom'=화면 하단 가로 바(클래식) / 'none'=하단바 미렌더(컴팩트).
export type BottomBarPlacement = 'bottom' | 'none';

export interface LayoutTemplateMeta {
  id: string; // 불변 계약(config 저장 키): 'classic' | 'compact'
  // 환경설정 화면에서 사용자에게 보여줄 이름
  name: string;
  description: string;
  bottomBar: BottomBarPlacement;
  // false → 모바일에서는 resolveLayout 이 classic 으로 강제 폴백(모바일 일관성 보장)
  mobileAllowed: boolean;
}

export const layoutTemplates: LayoutTemplateMeta[] = [
  {
    id: 'classic',
    name: '클래식',
    description: '하단 가로 바 — 계층화 이전과 동일한 기본 배치.',
    bottomBar: 'bottom',
    mobileAllowed: true,
  },
  {
    id: 'compact',
    name: '컴팩트',
    description:
      '하단 바를 없애 세로 공간을 넓힙니다. 프로젝트 선택은 상단 바로, 생성 컨트롤은 떠 있는 위젯으로 이동합니다.',
    bottomBar: 'none',
    mobileAllowed: false,
  },
];

// resolveLayout 이 App.tsx 로 넘기는 해석 결과. 지금은 하단바 위치뿐이고,
// panelSide/historySide 등 추가 슬롯은 2차(미러 템플릿·자유 편집)에서 병렬 추가한다.
export interface ResolvedLayout {
  id: string;
  bottomBar: BottomBarPlacement;
  // 세션(프로젝트) 선택을 상단 바로 올릴지 — 컴팩트는 하단바가 없어 상단으로 이동.
  // bottomBar==='none' 에서 파생되지만, 소비처 가독성을 위해 명시 필드로 노출한다.
  sessionSelectTop: boolean;
}

// 레지스트리 + 사용자 설정 → 실제 배치를 해석하는 단일 출처(순수 함수, resolveToolbar 선례 미러).
// - 미지정/미존재 id → classic 폴백(stale id 조용히 무시).
// - mobileAllowed=false && isMobile → classic 강제(모바일 일관성 보장).
// - 그 외 → 해당 템플릿 그대로.
export function resolveLayout(
  templateId: string | undefined,
  isMobile: boolean,
): ResolvedLayout {
  const classic = layoutTemplates[0];
  const meta = layoutTemplates.find((t) => t.id === templateId);
  if (!meta) {
    return {
      id: classic.id,
      bottomBar: classic.bottomBar,
      sessionSelectTop: classic.bottomBar === 'none',
    };
  }
  if (isMobile && !meta.mobileAllowed) {
    return {
      id: classic.id,
      bottomBar: classic.bottomBar,
      sessionSelectTop: classic.bottomBar === 'none',
    };
  }
  return {
    id: meta.id,
    bottomBar: meta.bottomBar,
    sessionSelectTop: meta.bottomBar === 'none',
  };
}
