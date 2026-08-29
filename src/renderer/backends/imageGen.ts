import { CharacterPosition } from '../models/types';
import type { SDStudioImageMetadataV1 } from '../../shared/sdstudioImageMetadata';

export enum Model {
  Anime = 'anime',
  Inpaint = 'inpaint',
  I2I = 'i2i',
}

export enum ModelVersion {
  V5 = '5-full',
  V5Curated = '5-curated',
  V4_5 = '4-5-full',
  V4_5Curated = '4-5-curated',
  V4 = '4-full',
  V4Curated = '4-curated',
}

export enum Resolution {
  SmallLandscape = 'small_landscape',
  SmallPortrait = 'small_portrait',
  SmallSquare = 'small_square',
  Landscape = 'landscape',
  Portrait = 'portrait',
  Square = 'square',
  LargeLandscape = 'large_landscape',
  LargePortrait = 'large_portrait',
  LargeSquare = 'large_square',
  WallpaperPortrait = 'wallpaper_portrait',
  WallpaperLandscape = 'wallpaper_landscape',
  Custom = 'custom',
}

export const upscaleReoslution = (resolution: Resolution) => {
  switch (resolution) {
    case Resolution.SmallLandscape:
      return Resolution.Landscape;
    case Resolution.SmallPortrait:
      return Resolution.Portrait;
    case Resolution.SmallSquare:
      return Resolution.Square;
    case Resolution.Landscape:
      return Resolution.LargeLandscape;
    case Resolution.Portrait:
      return Resolution.LargePortrait;
    case Resolution.Square:
      return Resolution.LargeSquare;
    case Resolution.WallpaperPortrait:
      return Resolution.WallpaperPortrait;
    case Resolution.WallpaperLandscape:
      return Resolution.WallpaperLandscape;
    case Resolution.Custom:
      return Resolution.Custom;
    default:
      return resolution;
  }
};

export const resolutionMap = {
  small_landscape: { height: 512, width: 768 },
  small_portrait: { height: 768, width: 512 },
  small_square: { height: 640, width: 640 },
  landscape: { height: 832, width: 1216 },
  portrait: { height: 1216, width: 832 },
  square: { height: 1024, width: 1024 },
  large_landscape: { height: 1024, width: 1536 },
  large_portrait: { height: 1536, width: 1024 },
  large_square: { height: 1472, width: 1472 },
  wallpaper_portrait: { height: 1088, width: 1920 },
  wallpaper_landscape: { height: 1920, width: 1088 },
  custom: { height: 0, width: 0 },
} as const;

export const convertResolution = (resolution: Resolution): ImageSize => {
  return {
    width: resolutionMap[resolution].width,
    height: resolutionMap[resolution].height,
  };
};

export enum Sampling {
  KEulerAncestral = 'k_euler_ancestral',
  KEuler = 'k_euler',
  KDPMPP2SAncestral = 'k_dpmpp_2s_ancestral',
  KDPMPP2M = 'k_dpmpp_2m',
  KDPMPPSDE = 'k_dpmpp_sde',
  KDPMPP2MSDE = 'k_dpmpp_2m_sde',
  DDIM = 'ddim_v3',
}

export enum NoiseSchedule {
  Native = 'native',
  Karras = 'karras',
  Exponential = 'exponential',
  Polyexponential = 'polyexponential',
}

export interface Vibe {
  image: string;
  info: number;
  strength: number;
}

export interface CharacterReference {
  image: string;
  info: number;
  strength: number;
  fidelity: number;
  description: string;
  referenceType: 'character' | 'style' | 'character&style';
}

export interface ImageSize {
  width: number;
  height: number;
}

export type GenerationUcPreset =
  | 'heavy'
  | 'light'
  | 'humanFocus'
  | 'furryFocus'
  | 'none';

export type GenerationQualityPreset = 'standard' | 'light' | 'none';

// 예약 시점의 전역 생성 설정. 선택적 필드로 TaskParam·다중 창 payload에 실리며,
// 스냅샷이 없는 구 작업은 실행 시 기존 config 해석 경로를 사용한다.
export interface GenerationSettingsSnapshot {
  schemaVersion: 1;
  modelVersion: ModelVersion;
  furryMode: boolean;
  disableQuality: boolean;
  /** V5 3단계 품질. 누락 시 disableQuality를 해석해 하위 호환한다. */
  qualityPreset?: GenerationQualityPreset;
  ucPreset: GenerationUcPreset;
  /** V5 전용. 누락/구 작업은 false로 해석한다. */
  transparentBackground?: boolean;
  autoConvertWebp: boolean;
  autoConvertWebpQuality: number;
}

export interface ImageGenInput {
  model: Model;
  prompt: string;
  uc: string;
  resolution: ImageSize;
  sampling: Sampling;
  outputFilePath: string;
  steps: number;
  promptGuidance: number;
  cfgRescale: number;
  noiseSchedule: NoiseSchedule;
  vibes: Vibe[];
  image?: string;
  mask?: string;
  noise?: number;
  imageStrength?: number;
  seed?: number;
  originalImage?: boolean;
  useCoords?: boolean;
  legacyPromptConditioning?: boolean;
  normalizeStrength?: boolean;
  varietyPlus?: boolean;
  deliberateEulerAncestralBug?: boolean;
  characterPrompts?: string[];
  characterUCs?: string[];
  characterPositions?: CharacterPosition[];
  characterReferences?: CharacterReference[];
  generationSettings?: GenerationSettingsSnapshot;
  /** SDStudio에서 앞으로 생성한 이미지에만 삽입하는 선택적 복원 메타데이터. */
  sdstudioMetadata?: SDStudioImageMetadataV1;
}

export type AugmentMethod =
  | 'lineart'
  | 'colorize'
  | 'bg-removal'
  | 'declutter'
  | 'emotion'
  | 'sketch';

export interface ImageAugmentInput {
  method: AugmentMethod;
  outputFilePath: string;
  emotion?: string;
  prompt?: string;
  weaken?: number;
  image: string;
}

export interface EncodeVibeImageInput {
  image: string;
  info: number;
}

// 로그인(토큰) 검증 결과.
// - valid: 토큰 유효 / invalid: 만료·무효(인증 거부) / error: 네트워크 등 불확실(상태 유지)
export type LoginValidity = 'valid' | 'invalid' | 'error';

export interface ImageGenService {
  invalidateConfigCache?(): void;
  login(email: string, password: string): Promise<{ accessToken: string }>;
  generateImage(token: string, params: ImageGenInput): Promise<string>;
  augmentImage(token: string, params: ImageAugmentInput): Promise<string>;
  getRemainCredits(token: string): Promise<number>;
  getOpusUsageStatus(token: string): Promise<OpusUsageStatus>;
  encodeVibeImage(token: string, params: EncodeVibeImageInput): Promise<string>;
  validateToken(token: string): Promise<LoginValidity>;
}

export interface OpusUsageStatus {
  percent: number;
  isNegative: boolean;
  timeUntilNextPercent: number;
}
