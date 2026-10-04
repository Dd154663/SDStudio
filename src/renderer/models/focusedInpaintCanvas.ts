/**
 * Focused inpainting 캔버스 처리(2026-10-04 S1) — 렌더러 공통(Electron·Android WebView).
 *
 * - `prepareFocusedRequest`: 원본·마스크를 선택 사각형으로 잘라 요청 해상도(≈1MP, 64 배수)로 키운다.
 *   이미지는 고품질 보간(`imageSmoothingQuality='high'`), 마스크는 최근접 보간 + 이진화 + Focused 마스크 규칙
 *   + 요청 해상도 8px 격자 스냅.
 * - `composeFocusedResult`: 서버 결과를 사각형 크기로 줄이고(고품질) 팽창 32px·흐림 20 페더로 원본에 섞어
 *   원본 크기 PNG 를 만든다(RGB 만 섞고 알파는 원본 유지). 서버 결과 PNG 의 텍스트 메타 청크를 합성 PNG 로 옮긴다.
 *
 * 흐림은 `ctx.filter` 를 쓰지 않는다(일부 Android WebView 미지원) — `focusedInpaint.featherAlpha` 수동 구현.
 * 좌표·크기·마스크 판정은 `focusedInpaint.ts` 단일 출처. 계약: SPEC_GUIDE §7 「Focused inpainting」.
 */
import { Buffer } from 'buffer';
import {
  blendRgba,
  clampFocusRect,
  featherAlpha,
  focusedMaskRule,
  focusTargetSize,
  FocusRect,
  innerContextRect,
  requestMaskFromRectMask,
} from './focusedInpaint';
import { imageExtFromBase64 } from './imageFormats';
import { transferTextChunks } from './pngTextChunks';

export interface FocusedRequest {
  /** 요청용 크롭·확대 이미지(raw base64 PNG). */
  imageBase64: string;
  /** 요청용 마스크(raw base64 PNG, 흰=다시 그림). */
  maskBase64: string;
  /** 요청 해상도(64 배수, ≤1MP). */
  width: number;
  height: number;
  /** 정렬·클램프된 선택 사각형(원본 픽셀). */
  rect: FocusRect;
  imageWidth: number;
  imageHeight: number;
  /** 규칙을 적용한 사각형 크기 이진 마스크(합성 페더 입력). */
  rectMask: Uint8Array;
  /** 안쪽에 칠한 곳이 없어 안쪽 전체를 마스크로 썼는지. */
  fullSizeMask: boolean;
}

function mimeOf(base64: string): string {
  const ext = imageExtFromBase64(base64);
  return ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
}

export function loadImageFromBase64(base64: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'));
    img.src = `data:${mimeOf(base64)};base64,${base64}`;
  });
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true } as any) as CanvasRenderingContext2D | null;
  if (!ctx) throw new Error('캔버스를 만들지 못했습니다.');
  return [canvas, ctx];
}

function canvasPngBase64(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
}

/** RGBA → 이진(검정이 아니고 투명하지 않으면 1 — BrushTool.maskToBase64 와 같은 판정). */
function binarize(data: Uint8ClampedArray): Uint8Array {
  const out = new Uint8Array(data.length / 4);
  for (let p = 0, i = 0; p < out.length; p++, i += 4) {
    out[p] = data[i + 3] > 0 && (data[i] | data[i + 1] | data[i + 2]) !== 0 ? 1 : 0;
  }
  return out;
}

function binaryToImageData(mask: Uint8Array, w: number, h: number): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
    const v = mask[p] ? 255 : 0;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 255;
  }
  return new ImageData(data, w, h);
}

/**
 * Focused 요청 준비. `rect` 는 프리셋 값(이미지 픽셀) — 여기서 8px 정렬·상한·이미지 안 클램프를 한다.
 * 마스크가 없거나 비어 있으면 안쪽 사각형 전체를 마스크로 쓴다.
 */
export async function prepareFocusedRequest({
  imageBase64,
  maskBase64,
  rect: inputRect,
  context,
}: {
  imageBase64: string;
  maskBase64?: string;
  rect: FocusRect;
  context: number;
}): Promise<FocusedRequest> {
  const img = await loadImageFromBase64(imageBase64);
  const imageWidth = img.naturalWidth;
  const imageHeight = img.naturalHeight;
  const rect = clampFocusRect(inputRect, imageWidth, imageHeight);
  if (!rect) throw new Error('Focused 영역이 이미지보다 큽니다.');
  const { width, height } = focusTargetSize(rect.w, rect.h);

  // 이미지: 사각형 → 요청 해상도(고품질 보간).
  const [imgCanvas, imgCtx] = makeCanvas(width, height);
  imgCtx.imageSmoothingEnabled = true;
  imgCtx.imageSmoothingQuality = 'high';
  imgCtx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, width, height);

  // 마스크: 원본 크기로 맞춘 뒤(크기가 다르면 최근접) 사각형만 이진화.
  let rawMask: Uint8Array = new Uint8Array(rect.w * rect.h);
  if (maskBase64) {
    const maskImg = await loadImageFromBase64(maskBase64);
    const [, maskCtx] = makeCanvas(rect.w, rect.h);
    maskCtx.imageSmoothingEnabled = false;
    const sx = maskImg.naturalWidth / imageWidth;
    const sy = maskImg.naturalHeight / imageHeight;
    maskCtx.drawImage(
      maskImg,
      rect.x * sx,
      rect.y * sy,
      rect.w * sx,
      rect.h * sy,
      0,
      0,
      rect.w,
      rect.h,
    );
    rawMask = binarize(maskCtx.getImageData(0, 0, rect.w, rect.h).data);
  }
  const inner = innerContextRect(rect, context);
  const { mask: rectMask, fullSizeMask } = focusedMaskRule(rawMask, rect.w, rect.h, inner);

  // 요청 마스크: 사각형 크기 이진 → 요청 해상도(최근접) → 8px 격자 스냅(일부만 칠해진 칸 없음 —
  // 경계가 8 배수가 아니면 서버 결과에 마스크 윤곽선 잡음이 생긴다).
  const scaled = requestMaskFromRectMask(rectMask, rect.w, rect.h, width, height);
  const [maskCanvas, maskOutCtx] = makeCanvas(width, height);
  maskOutCtx.putImageData(binaryToImageData(scaled, width, height), 0, 0);

  return {
    imageBase64: canvasPngBase64(imgCanvas),
    maskBase64: canvasPngBase64(maskCanvas),
    width,
    height,
    rect,
    imageWidth,
    imageHeight,
    rectMask,
    fullSizeMask,
  };
}

/**
 * 서버 결과를 원본에 합성해 원본 크기 PNG(raw base64)를 돌려준다.
 * 결과 PNG 의 텍스트 메타 청크(NAI Comment 등·SDStudio 전용 키)는 합성 PNG 로 옮긴다 —
 * NAI stealth(알파) 메타는 보존되지 않는다.
 */
export async function composeFocusedResult({
  originalBase64,
  resultPngBase64,
  rect,
  rectMask,
}: {
  originalBase64: string;
  resultPngBase64: string;
  rect: FocusRect;
  rectMask: Uint8Array;
}): Promise<string> {
  const [original, result] = await Promise.all([
    loadImageFromBase64(originalBase64),
    loadImageFromBase64(resultPngBase64),
  ]);
  const W = original.naturalWidth;
  const H = original.naturalHeight;
  if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > W || rect.y + rect.h > H) {
    throw new Error('Focused 영역이 원본 이미지 밖입니다.');
  }
  if (rectMask.length !== rect.w * rect.h) throw new Error('Focused 마스크 크기가 맞지 않습니다.');

  const [canvas, ctx] = makeCanvas(W, H);
  ctx.drawImage(original, 0, 0);
  const origCrop = ctx.getImageData(rect.x, rect.y, rect.w, rect.h);

  // 결과 → 사각형 크기(고품질 축소).
  const [, resCtx] = makeCanvas(rect.w, rect.h);
  resCtx.imageSmoothingEnabled = true;
  resCtx.imageSmoothingQuality = 'high';
  resCtx.drawImage(result, 0, 0, rect.w, rect.h);
  const resCrop = resCtx.getImageData(0, 0, rect.w, rect.h);

  const alpha = featherAlpha(rectMask, rect.w, rect.h);
  const blended = blendRgba(origCrop.data, resCrop.data, alpha);
  ctx.putImageData(new ImageData(blended, rect.w, rect.h), rect.x, rect.y);

  const composed = Buffer.from(canvasPngBase64(canvas), 'base64');
  const resultBytes = Buffer.from(resultPngBase64, 'base64');
  const withMeta = transferTextChunks(
    new Uint8Array(resultBytes.buffer, resultBytes.byteOffset, resultBytes.length),
    new Uint8Array(composed.buffer, composed.byteOffset, composed.length),
  );
  return Buffer.from(withMeta).toString('base64');
}
