/**
 * 캐릭터 레퍼런스 편집기 규칙(2026-11-25) — 편집기 세 곳(CharacterReferenceEditor·CharacterPresetInnerEditor·
 * TemplateManagerModal)과 상세 정보가 같은 규칙·라벨을 쓰게 하는 순수 모델. 모델 능력은 naiModelCapabilities 단일 출처.
 */
import {
  naiCapabilitiesOf,
  naiReferenceBlockReason,
} from '../backends/genVendors/naiModelCapabilities';
import { ReferenceType } from '../backends/genVendors/naiReference';

/** 레퍼런스 종류 라벨(단일 출처 — 편집기·상세 정보 공용). */
export const REFERENCE_TYPE_LABELS: Readonly<Record<ReferenceType, string>> = Object.freeze({
  character: '캐릭터',
  style: '스타일',
  'character&style': '캐릭터+스타일',
  costume: '의상',
});

export const REFERENCE_EDITOR_TEXT = {
  sameOutfit: '같은 의상 선호',
  costumeUnsupported: '이 모델에서는 의상 레퍼런스를 보내지 않습니다',
  v5MediumHint: '정밀 레퍼런스는 V5 Full(High)·Curated 에서만 지원됩니다',
} as const;

export function referenceTypeLabel(type: string): string {
  return (REFERENCE_TYPE_LABELS as Record<string, string>)[type] ?? type;
}

export interface ReferenceEditorSpec {
  /** 이 모델이 캐릭터 레퍼런스를 받는가. */
  supported: boolean;
  blockReason: 'v4' | 'v5-medium' | undefined;
  /** Fidelity 줄을 보이는가(저장값은 숨겨도 그대로). */
  showFidelity: boolean;
  /** Strength 슬라이더·숫자 입력 상한. */
  strengthMax: number;
  /** 「의상」 종류·「같은 의상 선호」 지원. */
  outfit: boolean;
}

export function referenceEditorSpec(version: unknown): ReferenceEditorSpec {
  const caps = naiCapabilitiesOf(version);
  return {
    supported: caps.supportsCharacterReference,
    blockReason: naiReferenceBlockReason(version),
    showFidelity: caps.referenceFidelity,
    strengthMax: caps.referenceStrengthMax,
    outfit: caps.supportsOutfitReference,
  };
}

const BASE_TYPES: readonly ReferenceType[] = ['character', 'style', 'character&style'];

/** 종류 선택지 — 기본 세 종류 + (의상 지원 모델이거나 그 항목이 이미 의상이면) 「의상」. */
export function referenceTypeOptions(
  spec: Pick<ReferenceEditorSpec, 'outfit'>,
  currentType?: string,
): ReferenceType[] {
  return spec.outfit || currentType === 'costume' ? [...BASE_TYPES, 'costume'] : [...BASE_TYPES];
}

/** 이 항목에 「의상 레퍼런스를 보내지 않습니다」 안내를 붙이는가(의상 미지원 모델의 의상 항목). */
export function showCostumeUnsupported(
  spec: Pick<ReferenceEditorSpec, 'outfit'>,
  type: string | undefined,
): boolean {
  return !spec.outfit && type === 'costume';
}

/** 「같은 의상 선호」 체크 상자를 보이는가(의상 지원 모델의 캐릭터·캐릭터+스타일). */
export function showSameOutfitToggle(
  spec: Pick<ReferenceEditorSpec, 'outfit'>,
  type: string | undefined,
): boolean {
  return spec.outfit && (type === 'character' || type === 'character&style');
}

/** 새 레퍼런스의 종류 — 저장된 기본 종류가 의상인데 모델이 의상을 지원하지 않으면 캐릭터. */
export function newReferenceType(
  spec: Pick<ReferenceEditorSpec, 'outfit'>,
  defaultType: string | undefined,
): ReferenceType {
  const t = (defaultType || 'character') as ReferenceType;
  if (!(REFERENCE_TYPE_LABELS as Record<string, string>)[t]) return 'character';
  if (t === 'costume' && !spec.outfit) return 'character';
  return t;
}


/** 잠긴 레퍼런스 버튼 문구(사유별). */
export function referenceLockText(reason: 'v4' | 'v5-medium' | undefined): {
  label: string;
  thumbnail: string;
  inline: string;
  tooltip: string;
} {
  if (reason === 'v5-medium') {
    const label = '캐릭터 레퍼런스 (V5M 미지원)';
    return {
      label,
      thumbnail: 'V5M 미지원',
      inline: '(V5M 미지원)',
      tooltip: `${label} — ${REFERENCE_EDITOR_TEXT.v5MediumHint}`,
    };
  }
  const label = '캐릭터 레퍼런스 (V4 모델 미지원)';
  return { label, thumbnail: 'V4 모델 미지원', inline: '(v4 미지원)', tooltip: label };
}

// ── Strength 슬라이더 눈금(2026-11-25 사용자 지시 — 공식 웹과 같은 손맛) ─────────────
// 상한이 큰 모델(V5 = 5)은 슬라이더 앞 절반이 0~1, 뒤 절반이 1~상한(가파른 구간, 화면에서 주황)이다.
// 상한이 작은 모델(V4.5 = 2)은 종전처럼 고른 눈금. 저장값·요청값은 그대로 Strength 숫자다(눈금만 다름).

/** 가파른 구간이 시작되는 Strength. */
export const REFERENCE_STRENGTH_KNEE = 1;
/** 슬라이더 위치 범위(0 ~ 이 값, 정수 단계). */
export const REFERENCE_SLIDER_STEPS = 200;

/** 이 상한에서 꺾인 눈금을 쓰는가. */
export function isCurvedStrengthSlider(max: number): boolean {
  return max > 2 * REFERENCE_STRENGTH_KNEE;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Strength → 슬라이더 위치(0 ~ REFERENCE_SLIDER_STEPS). 범위를 벗어난 값은 양 끝에 붙는다. */
export function strengthToSliderPos(value: number, max: number): number {
  const steps = REFERENCE_SLIDER_STEPS;
  if (!Number.isFinite(value) || !(max > 0)) return 0;
  const v = Math.min(Math.max(value, 0), max);
  if (!isCurvedStrengthSlider(max)) return Math.round((v / max) * steps);
  const half = steps / 2;
  const knee = REFERENCE_STRENGTH_KNEE;
  return v <= knee
    ? Math.round((v / knee) * half)
    : Math.round(half + ((v - knee) / (max - knee)) * half);
}

/** 슬라이더 위치 → Strength(소수 둘째 자리). */
export function sliderPosToStrength(pos: number, max: number): number {
  const steps = REFERENCE_SLIDER_STEPS;
  if (!Number.isFinite(pos) || !(max > 0)) return 0;
  const p = Math.min(Math.max(pos, 0), steps);
  if (!isCurvedStrengthSlider(max)) return round2((p / steps) * max);
  const half = steps / 2;
  const knee = REFERENCE_STRENGTH_KNEE;
  return p <= half
    ? round2((p / half) * knee)
    : round2(knee + ((p - half) / half) * (max - knee));
}

/** 값이 가파른 구간에 있는가(슬라이더를 주황으로). */
export function isSteepStrength(value: number, max: number): boolean {
  return isCurvedStrengthSlider(max) && value > REFERENCE_STRENGTH_KNEE;
}
