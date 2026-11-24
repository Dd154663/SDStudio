import * as React from 'react';
import {
  REFERENCE_SLIDER_STEPS,
  isSteepStrength,
  sliderPosToStrength,
  strengthToSliderPos,
} from '../models/referenceEditorSpec';

interface Props {
  value: number;
  /** 모델의 Strength 상한(referenceEditorSpec.strengthMax). */
  max: number;
  onChange: (value: number) => void;
  onPointerDown?: React.PointerEventHandler<HTMLInputElement>;
  disabled?: boolean;
  className?: string;
}

/**
 * 캐릭터 레퍼런스 Strength 슬라이더 — 레퍼런스 편집기 세 곳 공용(2026-11-25).
 * 상한이 큰 모델(V5)은 앞 절반 0~1, 뒤 절반 1~상한의 꺾인 눈금이고, 뒤 절반에 들어가면 주황으로 바뀐다.
 * 눈금 계산은 models/referenceEditorSpec 단일 출처.
 */
export const ReferenceStrengthSlider = ({
  value,
  max,
  onChange,
  onPointerDown,
  disabled,
  className = 'flex-1 min-w-0',
}: Props) => (
  <input
    type="range"
    className={className + (isSteepStrength(value, max) ? ' accent-orange-500' : '')}
    min={0}
    max={REFERENCE_SLIDER_STEPS}
    step={1}
    value={strengthToSliderPos(value, max)}
    aria-valuetext={Number.isFinite(value) ? value.toFixed(2) : undefined}
    onPointerDown={onPointerDown}
    onChange={(e) => onChange(sliderPosToStrength(Number(e.target.value), max))}
    disabled={disabled}
  />
);
