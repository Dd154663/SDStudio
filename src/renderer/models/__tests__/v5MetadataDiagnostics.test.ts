import { buildNaiMetadataDiagnostics } from '../util';

describe('V5 메타데이터 진단', () => {
  test('V5 Full과 투명 배경 힌트를 안전하게 읽는다', () => {
    expect(
      buildNaiMetadataDiagnostics(
        {
          params_version: 4,
          tag_hint_qt: 1,
          tag_hint_uc_preset: 2,
          tag_hint_transparent_background: true,
          noise_schedule: 'karras',
        },
        'NovelAI Diffusion V5 657484A5',
      ),
    ).toMatchObject({
      model: 'V5 Full',
      paramsVersion: 4,
      qualityHint: 1,
      ucHint: 2,
      transparentBackground: true,
      noiseSchedule: 'karras',
    });
  });

  test('V5 Curated 인페인트의 V4.5 폴백을 구분한다', () => {
    expect(
      buildNaiMetadataDiagnostics(
        { params_version: 4, tag_hint_qt: 1 },
        'NovelAI Diffusion V4.5 Curated Inpainting',
      ).model,
    ).toBe('V5 Curated 인페인트 (V4.5 Curated 폴백)');
  });

  test('구 메타데이터 누락 필드는 오류 없이 기본값으로 읽는다', () => {
    expect(buildNaiMetadataDiagnostics({}, undefined)).toEqual({
      model: '알 수 없음',
      source: undefined,
      paramsVersion: undefined,
      qualityHint: undefined,
      ucHint: undefined,
      transparentBackground: false,
      straightAlpha: undefined,
      noiseSchedule: undefined,
    });
  });
});
