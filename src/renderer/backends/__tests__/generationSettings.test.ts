import { captureGenerationSettings } from '../generationSettings';
import { ModelVersion } from '../imageGen';

describe('예약 생성 설정 스냅샷', () => {
  test('구 config의 누락 필드를 v5.0.5 기본값으로 해석한다', () => {
    expect(captureGenerationSettings({})).toEqual({
      schemaVersion: 1,
      modelVersion: ModelVersion.V4_5,
      furryMode: false,
      disableQuality: false,
      qualityPreset: 'standard',
      ucPreset: 'none',
      transparentBackground: false,
      autoConvertWebp: false,
      autoConvertWebpQuality: 80,
    });
  });

  test('예약 의미에 필요한 기존 설정을 값으로 복사한다', () => {
    const config = {
      modelVersion: ModelVersion.V4Curated,
      furryMode: true,
      disableQuality: true,
      ucPreset: 'humanFocus' as const,
      autoConvertWebp: true,
      autoConvertWebpQuality: 67,
    };
    const snapshot = captureGenerationSettings(config);

    config.autoConvertWebpQuality = 20;
    expect(snapshot).toEqual({
      schemaVersion: 1,
      modelVersion: ModelVersion.V4Curated,
      furryMode: true,
      disableQuality: true,
      qualityPreset: 'none',
      ucPreset: 'humanFocus',
      transparentBackground: false,
      autoConvertWebp: true,
      autoConvertWebpQuality: 67,
    });
  });

  test('V5 신규 설정은 기존 disableQuality보다 우선해 스냅샷에 고정한다', () => {
    expect(
      captureGenerationSettings({
        modelVersion: ModelVersion.V5,
        disableQuality: true,
        qualityPreset: 'light',
        transparentBackground: true,
      }),
    ).toMatchObject({
      qualityPreset: 'light',
      transparentBackground: true,
    });
  });
});
