// 캐릭터 프롬프트 카드(PreSetEdtior 캐릭터 편집 창)의 프리셋 해제 버튼 — 별도 파일은 테스트에서 단독 렌더하기 위함.
import React from 'react';
import { FaTimes } from 'react-icons/fa';
import { appState } from '../models/AppService';
import Tooltip from './Tooltip';
import { INLINE_LABELED_CLASS, InlineLabel, labelModeOf } from './PresetPanelLabel';
import { PRESET_ACTION_LABELS } from '../models/presetPanelLabels';
import { useProjectBarStage } from './useProjectBarStage';

// 캐릭터 프롬프트 카드의 프리셋 해제 ✕ + 「해제」 글자(2026-11-10 아이콘 직관화 묶음 2). 머리줄([data-release-row])
// 폭을 묶음 1 방식(measureProjectBar — 왼쪽 프리셋 이름 칸은 최소 폭으로)으로 재서 모자라면 아이콘만. 툴팁 전체 설명 유지.
export const PresetReleaseButton = ({ presetName }: { presetName: string }) => {
  const { rowRef, stage } = useProjectBarStage(true);
  const mode = labelModeOf(stage);
  return (
    <Tooltip content={`${presetName} 프리셋 해제 — 연결된 바이브/레퍼런스 함께 제거`}>
      <button
        ref={(el) => {
          rowRef.current = (el?.closest('[data-release-row]') as HTMLElement | null) ?? null;
        }}
        className={`relative flex-none text-muted hover:text-red-500 dark:hover:text-red-400 p-1${mode === 'show' ? INLINE_LABELED_CLASS : ''}`}
        onClick={() => appState.removeAppliedCharacterPreset(presetName)}
      >
        <FaTimes size={13} />
        <InlineLabel text={PRESET_ACTION_LABELS.releasePreset} mode={mode} />
      </button>
    </Tooltip>
  );
};
