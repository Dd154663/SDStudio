// NovelAI 공개 웹 클라이언트(2026-08-31)와 Image API의 독립 업스케일 계약.
// 생성 모델 선택과 무관하게 공식 웹과 동일한 업스케일 모델을 사용한다.
export const NAI_UPSCALE_MODEL = 'nai-diffusion-5-curated';
export const NAI_UPSCALE_FACTOR = 2;
export const NAI_UPSCALE_MAX_PIXELS = 3_145_728;

/** 공식 웹의 입력 픽셀 수별 예상 가격. 최종 과금은 서버가 결정한다. */
export function estimateNaiUpscaleCost(width: number, height: number): number {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width <= 0 || height <= 0 || width * height > NAI_UPSCALE_MAX_PIXELS) {
    throw new Error('NAI 업스케일은 입력 이미지가 3,145,728픽셀 이하일 때 사용할 수 있습니다.');
  }
  const pixels = width * height;
  if (pixels <= 1_048_576) return 1;
  if (pixels <= 1_747_627) return 2;
  if (pixels <= 2_446_678) return 3;
  return 4;
}
