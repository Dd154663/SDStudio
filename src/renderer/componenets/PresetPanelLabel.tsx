// 사전 세팅 패널 버튼의 짧은 글자 노드(2026-11-10 아이콘 직관화 묶음 2, SPEC_GUIDE §6 「사전 세팅 패널 라벨」).
// 글자는 models/presetPanelLabels.ts 단일 출처, 단계 판정·측정은 useProjectBarStage(묶음 1 재사용).
// mode 'show' = 보이는 글자, 'measure' = 아이콘만 단계 — 버튼 크기·배치를 바꾸지 않는 보이지 않는 측정용 글자
// (absolute·invisible·aria-hidden, 이름은 Tooltip 이 붙이는 aria-label 그대로). 둘 다 [data-pb-label] 로 잰다.
import React from 'react';
import type { ProjectBarStage } from '../models/projectBarStage';

export type LabelMode = 'show' | 'measure';

export const labelModeOf = (stage: ProjectBarStage): LabelMode =>
  stage === 'label' ? 'show' : 'measure';

// 아이콘 옆 글자 버튼에 붙는 클래스 — 묶음 1 프로젝트 바와 같은 간격(글자 ml-1.5 + 오른쪽 pr-2,
// PROJECT_BAR_LABEL_SPACING_PX 10 과 짝). icon-button(p-1) 과 함께 쓴다.
export const INLINE_LABELED_CLASS = ' inline-flex items-center pr-2';

// 하단 아이콘 행(uiPresetIconRow) 단계 — PresetRootRender 가 행을 재서 공급, 버튼(그룹·캐릭터·바이브·레퍼런스)이 읽는다.
export const PresetIconRowLabelContext = React.createContext<LabelMode>('measure');

export function InlineLabel({ text, mode }: { text: string; mode: LabelMode }) {
  if (mode === 'show') {
    return (
      <span data-pb-label="" className="ml-1.5 text-sm leading-none">
        {text}
      </span>
    );
  }
  return (
    <span
      data-pb-label=""
      aria-hidden="true"
      className="absolute right-0 top-0 invisible pointer-events-none whitespace-nowrap text-sm leading-none"
    >
      {text}
    </span>
  );
}

// 세로형(아이콘 위·이름 아래) 글자 — 모바일 V2 메인 줄 칸과 같은 모양(글자 11px).
export function StackedLabel({ text, mode }: { text: string; mode: LabelMode }) {
  if (mode === 'show') {
    return (
      <span
        data-pb-label=""
        className="whitespace-nowrap text-[11px] leading-none mt-0.5"
      >
        {text}
      </span>
    );
  }
  return (
    <span
      data-pb-label=""
      aria-hidden="true"
      className="absolute left-0 top-0 invisible pointer-events-none whitespace-nowrap text-[11px] leading-none"
    >
      {text}
    </span>
  );
}

// 세로형 버튼 클래스: 글자 단계에서만 세로 쌓기·높이 자동(아이콘만 단계는 종전 h-8 그대로).
// overflow-hidden: 측정용 글자(absolute)가 좁은 칸 밖으로 나가 패널에 가로 스크롤을 만들지 않게(잘려도 잰 폭은 그대로).
export const stackedButtonClass = (mode: LabelMode): string =>
  mode === 'show'
    ? ' relative overflow-hidden flex-col h-auto min-h-8 py-1 gap-0'
    : ' relative overflow-hidden h-8';
