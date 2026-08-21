import type { Config } from '../../main/config';
import {
  GenerationSettingsSnapshot,
  GenerationQualityPreset,
  GenerationUcPreset,
  ModelVersion,
} from './imageGen';

const UC_PRESETS: readonly GenerationUcPreset[] = [
  'heavy',
  'light',
  'humanFocus',
  'furryFocus',
  'none',
];

function resolveUcPreset(value: Config['ucPreset']): GenerationUcPreset {
  return value && UC_PRESETS.includes(value) ? value : 'none';
}

const QUALITY_PRESETS: readonly GenerationQualityPreset[] = [
  'standard',
  'light',
  'none',
];

export function resolveQualityPreset(config: Pick<Config, 'qualityPreset' | 'disableQuality'>): GenerationQualityPreset {
  if (
    config.qualityPreset &&
    QUALITY_PRESETS.includes(config.qualityPreset)
  ) {
    return config.qualityPreset;
  }
  return config.disableQuality === true ? 'none' : 'standard';
}

export function captureGenerationSettings(
  config: Config,
): GenerationSettingsSnapshot {
  return {
    schemaVersion: 1,
    modelVersion: config.modelVersion ?? ModelVersion.V4_5,
    furryMode: config.furryMode ?? false,
    disableQuality: config.disableQuality ?? false,
    qualityPreset: resolveQualityPreset(config),
    ucPreset: resolveUcPreset(config.ucPreset),
    transparentBackground: config.transparentBackground ?? false,
    autoConvertWebp: config.autoConvertWebp ?? false,
    autoConvertWebpQuality: config.autoConvertWebpQuality ?? 80,
  };
}
