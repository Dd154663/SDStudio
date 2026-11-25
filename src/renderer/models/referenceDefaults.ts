/**
 * 「새 레퍼런스 기본값」(2026-11-25) — 새로 넣는 캐릭터 레퍼런스 항목의 Strength·Fidelity·종류 기본값을
 * 모델 계열별로 따로 둔다. 읽기·쓰기·정리의 단일 출처(편집기 세 곳 공용).
 *
 * - 'legacy'(V4·V4.5 계열) = 종전 키 세 개 그대로(이름·뜻 불변 — 구버전 앱이 그대로 읽는다).
 * - 'v5'(의상 레퍼런스를 받는 계열) = 새 키 두 개. Fidelity 는 V5 가 받지 않으므로 키 없음(새 항목은 1.0).
 * - 계열 판정은 능력표(`supportsOutfitReference`) — 모델 이름 비교가 아니다.
 * - 하위 호환 이동: v5.8.0 은 모든 모델이 종전 키를 같이 써서 V5 용 값(Strength 2 초과·종류 「의상」)이
 *   종전 키에 들어 있을 수 있다. 구버전으로 내려가면 V4.5 요청이 깨지므로, 읽을 때마다 그런 값만 v5 키로
 *   옮기고(v5 키가 비어 있을 때만) 종전 키는 V4.5 가 받는 값으로 되돌린다. 조건이 맞을 때만 쓰므로 멱등.
 * - localStorage 접근 실패(예외)는 삼키고 기본값.
 */
import { ModelVersion } from '../backends/imageGen';
import { naiCapabilitiesOf } from '../backends/genVendors/naiModelCapabilities';
import { ReferenceType } from '../backends/genVendors/naiReference';

export type ReferenceDefaultsFamily = 'legacy' | 'v5';

export interface ReferenceDefaults {
  strength: number;
  fidelity: number;
  referenceType: ReferenceType;
}

/** 저장 키(종전 세 키 = 'legacy'). 바꾸지 않는다. */
export const REFERENCE_DEFAULT_KEYS = Object.freeze({
  legacy: Object.freeze({
    strength: 'sdstudio-ref-default-strength',
    fidelity: 'sdstudio-ref-default-fidelity',
    type: 'sdstudio-ref-default-type',
  }),
  v5: Object.freeze({
    strength: 'sdstudio-ref-default-v5-strength',
    type: 'sdstudio-ref-default-v5-type',
  }),
});

/** 접이 머리글에 붙이는 계열 이름. */
export const REFERENCE_DEFAULTS_FAMILY_LABEL: Readonly<Record<ReferenceDefaultsFamily, string>> =
  Object.freeze({ legacy: 'V4.5', v5: 'V5' });

const DEFAULT_STRENGTH = 0.6;
const DEFAULT_FIDELITY = 1.0;
const FIDELITY_MAX = 2;

const FAMILY_TYPES: Readonly<Record<ReferenceDefaultsFamily, readonly ReferenceType[]>> = Object.freeze({
  legacy: ['character', 'style', 'character&style'],
  v5: ['character', 'style', 'character&style', 'costume'],
});

/** 이 모델의 기본값 계열 — 의상 레퍼런스를 받으면 'v5'. */
export function referenceDefaultsFamily(version: unknown): ReferenceDefaultsFamily {
  return naiCapabilitiesOf(version).supportsOutfitReference ? 'v5' : 'legacy';
}

/** 계열의 Strength 상한 — 능력표의 대표 모델 값(legacy = V4.5, v5 = V5). */
export function referenceDefaultsStrengthMax(family: ReferenceDefaultsFamily): number {
  return naiCapabilitiesOf(family === 'v5' ? ModelVersion.V5 : ModelVersion.V4_5).referenceStrengthMax;
}

function getItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function setItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 저장 실패는 삼킨다(다음 읽기는 기본값)
  }
}

function parseClamped(raw: string | null, fallback: number, max: number): number {
  if (raw === null || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, 0), max);
}

/**
 * 하위 호환 이동(멱등). 종전 키에 V5 전용 값이 있으면 v5 키가 비어 있을 때 옮기고, 종전 키는 V4.5 값으로.
 * v5 키에 이미 값이 있으면 덮지 않는다(종전 키만 V4.5 값으로 되돌린다).
 */
export function migrateReferenceDefaults(): void {
  const L = REFERENCE_DEFAULT_KEYS.legacy;
  const V = REFERENCE_DEFAULT_KEYS.v5;
  const legacyType = getItem(L.type);
  if (legacyType === 'costume') {
    if (getItem(V.type) === null) setItem(V.type, 'costume');
    setItem(L.type, 'character');
  }
  const legacyMax = referenceDefaultsStrengthMax('legacy');
  const legacyStrength = getItem(L.strength);
  if (legacyStrength !== null) {
    const n = Number(legacyStrength);
    if (Number.isFinite(n) && n > legacyMax) {
      if (getItem(V.strength) === null) setItem(V.strength, legacyStrength);
      setItem(L.strength, String(legacyMax));
    }
  }
}

/** 계열의 기본값(정리된 값). 읽기 전에 하위 호환 이동을 한다. */
export function readReferenceDefaults(family: ReferenceDefaultsFamily): ReferenceDefaults {
  migrateReferenceDefaults();
  const keys = REFERENCE_DEFAULT_KEYS[family];
  const strength = parseClamped(getItem(keys.strength), DEFAULT_STRENGTH, referenceDefaultsStrengthMax(family));
  const fidelity =
    family === 'legacy'
      ? parseClamped(getItem(REFERENCE_DEFAULT_KEYS.legacy.fidelity), DEFAULT_FIDELITY, FIDELITY_MAX)
      : DEFAULT_FIDELITY;
  const rawType = getItem(keys.type);
  const referenceType = (FAMILY_TYPES[family] as readonly string[]).includes(rawType ?? '')
    ? (rawType as ReferenceType)
    : 'character';
  return { strength, fidelity, referenceType };
}

/** 모델 버전으로 바로 읽기(새 항목을 만드는 경로용). */
export function referenceDefaultsFor(version: unknown): ReferenceDefaults {
  return readReferenceDefaults(referenceDefaultsFamily(version));
}

/** 계열의 기본값 한 칸을 쓴다. v5 의 fidelity 는 키가 없으므로 아무것도 하지 않는다. */
export function writeReferenceDefault(
  family: ReferenceDefaultsFamily,
  field: 'strength' | 'fidelity' | 'referenceType',
  value: number | string,
): void {
  if (field === 'fidelity') {
    if (family === 'legacy') setItem(REFERENCE_DEFAULT_KEYS.legacy.fidelity, String(value));
    return;
  }
  const keys = REFERENCE_DEFAULT_KEYS[family];
  setItem(field === 'strength' ? keys.strength : keys.type, String(value));
}
