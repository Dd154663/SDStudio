// 인페인트·이미지 변형 씬 해상도 = 첨부 이미지 크기(R-res, 2026-10-04) — 단일 출처(SPEC §7-3).
//
// 예전에는 인페인트 씬이 원본 씬의 해상도 enum 만 물려받아, 첨부 이미지와 요청 해상도가 달라지거나
// (예: 업스케일·외부 이미지) 원본이 커스텀이면 너비·높이가 비어 요청이 깨질 수 있었다.
// 규칙: 이미지 크기가 해상도 표(`resolutionMap`)의 프리셋과 정확히 같으면 그 enum, 아니면 'custom' +
// 64px 배수 올림(`parseCustomResolution` — 커스텀 입력과 같은 규칙). 순수 계산과 이미지 디코드를 나눈다
// (jest inpaintResolution.test.ts).
import { runInAction } from 'mobx';
import { Resolution, resolutionMap } from '../backends/imageGen';
import { NAI_FREE_PIXEL_LIMIT } from '../backends/genVendors/naiModelCapabilities';
import { getImageDimensions } from '../componenets/BrushTool';
import { parseCustomResolution } from './deleteFlowRules';

export interface ImageResolution {
  resolution: Resolution;
  /** custom 일 때만(64 배수 올림 값). */
  width?: number;
  height?: number;
}

export interface SceneResolutionFields {
  resolution: string;
  resolutionWidth?: number;
  resolutionHeight?: number;
}

/**
 * 씬 해상도가 요청 해상도로 쓰이는 변형 워크플로우(인페인트·이미지 투 이미지).
 * 미러는 합성 캔버스 크기로 따로 정하고(예외), 이미지 수정(Augment)은 이미지 크기를 직접 보낸다.
 */
const IMAGE_RESOLUTION_WORKFLOWS: ReadonlySet<string> = new Set(['SDInpaint', 'SDI2I']);

export function workflowUsesImageResolution(workflowType: string | undefined): boolean {
  return !!workflowType && IMAGE_RESOLUTION_WORKFLOWS.has(workflowType);
}

/**
 * 이미지 크기 → 씬 해상도. 0·음수·NaN·정수 아님이면 undefined.
 * small_* 프리셋은 인페인트 편집 창 목록에 없어 맞추지 않는다(같은 크기의 custom — 요청은 동일).
 */
export function resolutionForImageSize(
  width: number,
  height: number,
): ImageResolution | undefined {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return undefined;
  if (width <= 0 || height <= 0) return undefined;
  for (const [key, size] of Object.entries(resolutionMap)) {
    if (key === Resolution.Custom || key.startsWith('small')) continue;
    if (size.width === width && size.height === height) {
      return { resolution: key as Resolution };
    }
  }
  const parsed = parseCustomResolution(width, height);
  if (!parsed.ok) return undefined;
  return { resolution: Resolution.Custom, width: parsed.width, height: parsed.height };
}

/** 결과가 뜻하는 실제 요청 크기. */
export function imageResolutionSize(r: ImageResolution): { width: number; height: number } {
  if (r.resolution === Resolution.Custom) {
    return { width: r.width ?? 0, height: r.height ?? 0 };
  }
  const size = resolutionMap[r.resolution];
  return { width: size.width, height: size.height };
}

/** base64 또는 data URL 이미지의 크기로 해상도를 정한다. 디코드 실패·크기 이상이면 undefined. */
export async function resolutionFromImage(
  image: string | undefined | null,
  decode: (base64: string) => Promise<{ width: number; height: number }> = getImageDimensions,
): Promise<ImageResolution | undefined> {
  if (!image) return undefined;
  const base64 = image.startsWith('data:') ? image.slice(image.indexOf(',') + 1) : image;
  if (!base64) return undefined;
  try {
    const { width, height } = await decode(base64);
    return resolutionForImageSize(width, height);
  } catch (e) {
    return undefined;
  }
}

/** 새 씬 JSON(fromJSON)에 넣을 해상도 필드. */
export function imageResolutionSceneFields(r: ImageResolution): SceneResolutionFields {
  if (r.resolution === Resolution.Custom) {
    return { resolution: r.resolution, resolutionWidth: r.width, resolutionHeight: r.height };
  }
  return { resolution: r.resolution };
}

/** 원본 씬 해상도를 그대로 물려줄 때의 필드 — custom 이면 너비·높이도 함께(예전 결함: enum 만 복사). */
export function copiedSceneResolutionFields(src: SceneResolutionFields): SceneResolutionFields {
  return {
    resolution: src.resolution,
    resolutionWidth: src.resolutionWidth,
    resolutionHeight: src.resolutionHeight,
  };
}

/**
 * 「인페인팅 씬 생성」·「이미지 변형 씬 생성」의 새 씬 해상도.
 * 이미지 해상도 대상 워크플로우이고 이미지 크기를 알면 그 크기, 아니면 원본 씬 해상도(커스텀 너비·높이 포함).
 */
export function inpaintSceneResolutionFields(
  workflowType: string,
  source: SceneResolutionFields,
  fromImage: ImageResolution | undefined,
): SceneResolutionFields {
  if (workflowUsesImageResolution(workflowType) && fromImage) {
    return imageResolutionSceneFields(fromImage);
  }
  return copiedSceneResolutionFields(source);
}

/**
 * 기존 씬에 해상도를 적용한다. 씬 필드 대입(편집 창 해상도 목록과 같은 경로 — 씬 toJSON reaction → 저장 큐)을
 * 한 번에 묶는다. 프리셋이면 커스텀 너비·높이는 그대로 둔다(목록에서 프리셋을 고를 때와 같음).
 */
export function applyImageResolution(
  scene: { resolution: string; resolutionWidth?: number; resolutionHeight?: number },
  r: ImageResolution,
): void {
  runInAction(() => {
    scene.resolution = r.resolution;
    if (r.resolution === Resolution.Custom) {
      scene.resolutionWidth = r.width;
      scene.resolutionHeight = r.height;
    }
  });
}

/** 대량 작업 「내용 복사」 — 원본 씬 해상도 필드 3개를 대상 씬에 복사한다. */
export function copySceneResolution(
  src: SceneResolutionFields,
  target: { resolution: string; resolutionWidth?: number; resolutionHeight?: number },
): void {
  target.resolution = src.resolution;
  target.resolutionWidth = src.resolutionWidth;
  target.resolutionHeight = src.resolutionHeight;
}

/**
 * 씬 요청 크기(`lowerResolution` 결과)가 이미지 크기 기준 해상도와 다르면 맞출 해상도, 같으면 undefined.
 * 64 배수 올림은 피할 수 없으므로 원본 크기가 아니라 맞춘 결과와 비교한다(1000×1500 이미지 ↔ 1024×1536 씬 = 일치).
 */
export function imageResolutionMismatch(
  sceneSize: { width?: number; height?: number },
  imageWidth: number,
  imageHeight: number,
): ImageResolution | undefined {
  const target = resolutionForImageSize(imageWidth, imageHeight);
  if (!target) return undefined;
  const size = imageResolutionSize(target);
  if (sceneSize.width === size.width && sceneSize.height === size.height) return undefined;
  return target;
}

export const IMAGE_RESOLUTION_TEXT = {
  fitButton: '이미지 크기로 맞추기',
  mismatch: (image: { width: number; height: number }, scene: { width?: number; height?: number }) =>
    `이미지 크기(${image.width}x${image.height})와 씬 해상도(${scene.width ?? '?'}x${scene.height ?? '?'})가 다릅니다.`,
  paid: (width: number, height: number) =>
    `씬 해상도를 이미지 크기 ${width}x${height}로 맞췄습니다 — 1MP(1024x1024)를 넘어 생성 시 Anlas를 소모합니다 (유료).`,
} as const;

/** 1MP 초과면 Anlas 안내 문구, 아니면 undefined(토스트는 호출부가 띄운다 — 생성 흐름을 막지 않음). */
export function paidResolutionNotice(r: ImageResolution): string | undefined {
  const { width, height } = imageResolutionSize(r);
  if (width * height <= NAI_FREE_PIXEL_LIMIT) return undefined;
  return IMAGE_RESOLUTION_TEXT.paid(width, height);
}
