// PC 툴바 버튼 이름(아이콘 아래 작은 이름, 2026-11-18) — 순수 판정 규칙.
// 대상: PC 씬 툴바(SceneQueueControl 그룹 툴바)·PC 이미지 그리드 머리줄(ResultViewer).
// 단계는 프로젝트 바와 같은 pickProjectBarStage(models/projectBarStage.ts)를 그대로 쓴다:
//   'label' = 이름 보임(한 줄에 전부 들어갈 때) → 'icon'/'overflow' = 이름 숨김(지금 모습). 넘친 뒤는 기존 규칙
//   (줄바꿈 + 사용자가 ⋯ 로 보낸 버튼은 메뉴) 그대로 — 폭에 따라 버튼을 ⋯ 로 자동으로 옮기지 않는다.
// 전환은 버튼 전체가 한 번에. 측정은 componenets/ToolbarButtonName.tsx(measureButtonNames).
import type { ProjectBarNeeds } from './projectBarStage';

// 씬 툴바 그룹 칸 안 버튼 사이 간격 — 이름 없음 8px(종전) / 이름 보임 10px(이름끼리 붙지 않게).
// App.css .toolbar-group-buttons(gap 0.5rem)·.scene-toolbar-named .toolbar-group-buttons(gap 10px)와 짝.
export const BUTTON_NAME_GAP_ICON_PX = 8;
export const BUTTON_NAME_GAP_LABEL_PX = 10;

// 버튼 하나: body = 버튼(분할 버튼은 ▾ 포함 한 덩어리) 폭, name = 이름 글자 폭(이름이 없는 버튼은 0).
export interface NamedSlot {
  body: number;
  name: number;
}

// 버튼 줄 하나(씬 툴바 그룹 칸 또는 머리줄 전체). caption = 줄 위 캡션 폭(없으면 0) —
// 칸 폭 = max(캡션, 버튼 줄)이라 캡션이 더 넓으면 이름이 늘린 폭 일부는 칸 폭을 늘리지 않는다.
export interface NamedGroup {
  caption: number;
  slots: readonly NamedSlot[];
  gapIcon: number;
  gapLabel: number;
}

// 이름 표시 여부에 따른 칸 폭. 이름 보임 = 버튼마다 max(버튼, 이름) — 이름은 버튼 아래 가운데에 놓인다.
export function namedGroupWidth(g: NamedGroup, shown: boolean): number {
  const n = g.slots.length;
  if (n === 0) return g.caption;
  let sum = 0;
  for (const s of g.slots) sum += shown ? Math.max(s.body, s.name) : s.body;
  sum += (shown ? g.gapLabel : g.gapIcon) * (n - 1);
  return Math.max(g.caption, sum);
}

// 측정값 → 두 단계의 필요 폭. base = 지금 화면(현재 단계)에서 잰 한 줄 폭.
export function buttonNameNeeds(
  available: number,
  base: number,
  groups: readonly NamedGroup[],
  labelsShown: boolean,
): ProjectBarNeeds {
  let extra = 0;
  for (const g of groups) extra += namedGroupWidth(g, true) - namedGroupWidth(g, false);
  return labelsShown
    ? { available, labelNeed: base, iconNeed: base - extra }
    : { available, labelNeed: base + extra, iconNeed: base };
}
