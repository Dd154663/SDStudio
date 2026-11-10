// PC 프로젝트 바 반응형 3단계(2026-11-10 아이콘 직관화 묶음 1) — 순수 판정 규칙. SPEC_GUIDE §6 「프로젝트 바 라벨 병행」.
// ① label    = 아이콘 + 짧은 글자(uiLayout label) — 바 한 줄에 전부 들어갈 때
// ② icon     = 아이콘만(라벨 도입 전 모습 그대로)
// ③ overflow = 아이콘만으로도 한 줄에 안 들어감 — 화면은 ② 와 같고, 넘치는 버튼은 기존 규칙(줄바꿈 +
//              사용자가 ⋯ 더보기로 보낸 버튼은 메뉴)대로. 폭에 따라 버튼을 ⋯ 로 자동으로 옮기는 동작은 없다.
// 전환은 버튼 전체가 한 번에(일부만 글자인 상태는 없다). 측정은 componenets/useProjectBarStage.ts.

export type ProjectBarStage = 'label' | 'icon' | 'overflow';

// 단계를 올릴 때(②→①, ③→②)만 요구하는 여유 폭 — 경계 폭에서 글자가 켜졌다 꺼졌다 깜빡이는 것을 막는다.
export const PROJECT_BAR_HYSTERESIS_PX = 12;

// 글자 단계에서 버튼 하나가 늘어나는 폭 중 글자 자체를 뺀 몫: 글자 왼쪽 여백 ml-1.5(6px) +
// 오른쪽 패딩 pr-2(8px)가 icon-button 기본 p-1(4px)을 대신하는 차이 4px. PortableToolbarButtons 의 클래스와 짝.
export const PROJECT_BAR_LABEL_SPACING_PX = 10;

export interface ProjectBarNeeds {
  // 바 컨테이너의 안쪽 폭(px). 0 이하 = 숨겨져 있음(md 미만 등) → 판정하지 않는다.
  available: number;
  // 한 줄에 전부 놓는 데 필요한 폭 — 글자 단계 / 아이콘 단계.
  labelNeed: number;
  iconNeed: number;
}

export function pickProjectBarStage(
  needs: ProjectBarNeeds,
  prev: ProjectBarStage,
  hysteresis: number = PROJECT_BAR_HYSTERESIS_PX,
): ProjectBarStage {
  const { available, labelNeed, iconNeed } = needs;
  if (!(available > 0)) return prev;
  // 이미 글자 단계면 딱 맞을 때까지 유지, 아니면 여유(hysteresis)가 있어야 올라간다.
  const labelLimit = prev === 'label' ? available : available - hysteresis;
  if (labelNeed <= labelLimit) return 'label';
  const iconLimit = prev === 'overflow' ? available - hysteresis : available;
  if (iconNeed <= iconLimit) return 'icon';
  return 'overflow';
}

// 측정값 → 두 단계의 필요 폭. base = 지금 화면(현재 단계)에서 잰 한 줄 폭,
// labelWidths = 각 버튼 글자의 폭(아이콘 단계에서도 보이지 않는 측정용 글자로 잰다).
export function projectBarNeeds(
  available: number,
  base: number,
  labelWidths: readonly number[],
  labelsShown: boolean,
): ProjectBarNeeds {
  const extra = labelWidths.reduce(
    (sum, w) => sum + w + PROJECT_BAR_LABEL_SPACING_PX,
    0,
  );
  return labelsShown
    ? { available, labelNeed: base, iconNeed: base - extra }
    : { available, labelNeed: base + extra, iconNeed: base };
}
