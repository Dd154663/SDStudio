import {
  GenerationQualityPreset,
  ModelVersion,
} from '../imageGen';

// NAI 웹 UI 패리티: Add Quality Tags / Undesired Content Preset (2026-07-31).
//
// NAI API 의 qualityToggle/ucPreset 필드는 "메타데이터 전용"(결과 무영향 —
// novelai-api 라이브러리 주석·실캡처 교차 확인)이고, 실제 태그 텍스트는 웹 UI 가
// 클라이언트에서 프롬프트/네거티브에 병합해 보낸다. SDStudio 도 생성 직전
// (nai.ts generateImage)에 동일하게 병합한다.
//
// 문자열 출처(단일 출처 — NAI 쪽이 바뀌면 이 모듈만 수정):
//  - V4.5 Full 퀄리티 태그 = NAIS3 실캡처 확정(공식 문서는 ', location, ...' 로
//    표기하지만 실제 웹 요청에는 location 이 없음 — 캡처를 따름)
//  - 그 외 퀄리티 태그 = NAI 공식 문서(docs.novelai.net/en/image/qualitytags)
//  - UC 프리셋 = novelai-api(Aedial) 데이터. V4.5 Full 은 NAIS3 실캡처와
//    전 항목 일치 확인(Heavy/Light/Human Focus)

export type UcPresetKey =
  | 'heavy'
  | 'light'
  | 'humanFocus'
  | 'furryFocus'
  | 'none';

// 퀄리티 태그 — 프롬프트 "끝"에 그대로 이어 붙는다(v4/v4.5 공통, 선행 ', ' 포함).
export const QUALITY_TAGS: Record<ModelVersion, string> = {
  [ModelVersion.V5]: ', very aesthetic, masterpiece, no text',
  [ModelVersion.V5Curated]: ', very aesthetic, masterpiece, no text',
  [ModelVersion.V4_5]: ', very aesthetic, masterpiece, no text',
  [ModelVersion.V4_5Curated]:
    ', location, masterpiece, no text, -0.8::feet::, rating:general',
  [ModelVersion.V4]: ', no text, best quality, very aesthetic, absurdres',
  [ModelVersion.V4Curated]:
    ', rating:general, amazing quality, very aesthetic, absurdres',
};

const V5_QUALITY_TAGS: Record<GenerationQualityPreset, string> = {
  standard: 'very aesthetic, masterpiece, no text',
  light: 'very aesthetic, amazing quality, no text',
  none: '',
};

export const QUALITY_PRESET_LABELS: Record<GenerationQualityPreset, string> = {
  standard: '표준 (Standard)',
  light: '가벼움 (Light)',
  none: '없음 (None)',
};

export const QUALITY_PRESET_OPTIONS: GenerationQualityPreset[] = [
  'standard',
  'light',
  'none',
];

const V45_FULL_HEAVY =
  'nsfw, lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page';

const V5_HEAVY =
  'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page';

const V5_FURRY_FOCUS =
  '{worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, {{grandfathered content}}, blurred foreground, chromatic aberration, sketch, everyone, [sketch background], simple, [flat colors], ych (character), outline, multiple scenes, [[horror (theme)]], comic';

const v5UcPresets = (): Partial<Record<UcPresetKey, string>> => ({
  heavy: V5_HEAVY,
  light:
    'lowres, bad hands, bad anatomy, artistic error, sepia, white haze, worst quality, very displeasing, jpeg artifacts, 0::ai-generated::',
  humanFocus:
    V5_HEAVY + ', @_@, mismatched pupils, glowing eyes, bad anatomy',
  furryFocus: V5_FURRY_FOCUS,
});

// 네거티브(UC) 프리셋 — 유저 네거티브 "앞"에 ', ' 로 이어 붙는다.
// 모델별 제공 항목이 다르다(NAI 웹과 동일): V4 계열은 Heavy/Light 만,
// V4.5 Curated 는 +Human Focus, V4.5 Full 은 +Human Focus/Furry Focus.
const UC_PRESETS: Record<ModelVersion, Partial<Record<UcPresetKey, string>>> = {
  [ModelVersion.V5]: v5UcPresets(),
  [ModelVersion.V5Curated]: v5UcPresets(),
  [ModelVersion.V4_5]: {
    heavy: V45_FULL_HEAVY,
    light:
      'nsfw, lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page',
    humanFocus:
      V45_FULL_HEAVY +
      ', @_@, mismatched pupils, glowing eyes, bad anatomy',
    furryFocus:
      'nsfw, {worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, {{grandfathered content}}, blurred foreground, chromatic aberration, sketch, everyone, [sketch background], simple, [flat colors], ych (character), outline, multiple scenes, [[horror (theme)]], comic',
  },
  [ModelVersion.V4_5Curated]: {
    heavy:
      'blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, negative space, blank page',
    light:
      'blurry, lowres, upscaled, artistic error, scan artifacts, jpeg artifacts, logo, too many watermarks, negative space, blank page',
    humanFocus:
      'blurry, lowres, upscaled, artistic error, film grain, scan artifacts, bad anatomy, bad hands, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, @_@, mismatched pupils, glowing eyes, negative space, blank page',
  },
  [ModelVersion.V4]: {
    heavy:
      'nsfw, blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, multiple views, logo, too many watermarks, white blank page, blank page',
    light:
      'nsfw, blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, white blank page, blank page',
  },
  [ModelVersion.V4Curated]: {
    heavy:
      'blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, logo, dated, signature, multiple views, gigantic breasts, white blank page, blank page',
    light:
      'blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, logo, dated, signature',
  },
};

const UC_LABELS: Record<UcPresetKey, string> = {
  heavy: '강함 (Heavy)',
  light: '약함 (Light)',
  humanFocus: '인물 중심 (Human Focus)',
  furryFocus: '퍼리 중심 (Furry Focus)',
  none: '없음 (None)',
};

// NAI 웹 표시 순서와 동일
const UC_ORDER: UcPresetKey[] = [
  'heavy',
  'light',
  'humanFocus',
  'furryFocus',
  'none',
];

// 현재 모델에서 고를 수 있는 UC 프리셋 목록 (UI 드롭다운용)
export function ucPresetOptionsFor(
  version: ModelVersion,
): { label: string; value: UcPresetKey }[] {
  const table = UC_PRESETS[version] ?? {};
  return UC_ORDER.filter((k) => k === 'none' || table[k] !== undefined).map(
    (k) => ({ label: UC_LABELS[k], value: k }),
  );
}

// 저장된 키가 현재 모델에 없으면(모델 전환 등) 'none' 으로 정규화 —
// 병합·메타데이터·UI 표시가 모두 이 함수를 거쳐 일관된다.
export function effectiveUcPreset(
  version: ModelVersion,
  key: UcPresetKey | undefined,
): UcPresetKey {
  if (!key || key === 'none') return 'none';
  return UC_PRESETS[version]?.[key] !== undefined ? key : 'none';
}

export function ucPresetTextFor(
  version: ModelVersion,
  key: UcPresetKey | undefined,
): string {
  const k = effectiveUcPreset(version, key);
  return k === 'none' ? '' : (UC_PRESETS[version]?.[k] ?? '');
}

// 프롬프트 끝에 퀄리티 태그 병합 (NAI 웹과 동일 — 그대로 이어 붙임)
export function mergeQualityTags(
  prompt: string,
  version: ModelVersion,
  preset: GenerationQualityPreset,
  transparentBackground = false,
): string {
  let result = prompt;
  if (transparentBackground) {
    result = result ? `transparent background, ${result}` : 'transparent background';
  }
  if (preset === 'none') return result;
  if (version === ModelVersion.V5 || version === ModelVersion.V5Curated) {
    const suffix = V5_QUALITY_TAGS[preset];
    return suffix ? (result ? `${result}, ${suffix}` : suffix) : result;
  }
  return result + (QUALITY_TAGS[version] ?? '');
}

// 공식 웹 공통 힌트 ID: none=0, standard=1, heavy=2, light=3,
// humanFocus=4, furryFocus=5. 레거시 ucPreset 숫자와 다른 계약이다.
export function qualityPresetHintId(preset: GenerationQualityPreset): number {
  return preset === 'standard' ? 1 : preset === 'light' ? 3 : 0;
}

export function ucPresetHintId(
  version: ModelVersion,
  key: UcPresetKey | undefined,
): number {
  const effective = effectiveUcPreset(version, key);
  const map: Record<UcPresetKey, number> = {
    none: 0,
    heavy: 2,
    light: 3,
    humanFocus: 4,
    furryFocus: 5,
  };
  return map[effective];
}

export function qualityPresetTextFor(
  version: ModelVersion,
  preset: GenerationQualityPreset,
): string {
  if (preset === 'none') return '';
  if (version === ModelVersion.V5 || version === ModelVersion.V5Curated) {
    return V5_QUALITY_TAGS[preset];
  }
  return (QUALITY_TAGS[version] ?? '').replace(/^, /, '');
}

// 유저 네거티브 앞에 UC 프리셋 병합 (실캡처: 프리셋 + ', ' + 유저 네거티브)
export function mergeUcPreset(
  uc: string,
  version: ModelVersion,
  key: UcPresetKey | undefined,
): string {
  const preset = ucPresetTextFor(version, key);
  if (!preset) return uc;
  return uc ? preset + ', ' + uc : preset;
}

// API 메타데이터 인덱스 (결과 무영향 — PNG 메타 기록용).
// 실캡처 확정: 0=Heavy, 1=Light, 3=Human Focus, 4=None. Furry Focus 는 캡처가
// 없어 미사용 슬롯 2 로 기록한다(메타데이터 전용이라 무해).
export function ucPresetApiIndex(
  version: ModelVersion,
  key: UcPresetKey | undefined,
): number {
  const k = effectiveUcPreset(version, key);
  const map: Record<UcPresetKey, number> = {
    heavy: 0,
    light: 1,
    furryFocus: 2,
    humanFocus: 3,
    none: 4,
  };
  return map[k];
}
