// 「캡처」 캔버스 합성(2026-11-25) — 배치(captureSheet.layoutCapture 결과)를 캔버스 하나에 그린다. PC·Android 공용.
//
// · 이미지 읽기는 인자로 주입한다(deps.loadImage) — 한 장씩 읽어 그리고 바로 버린다(deps.releaseImage).
//   전부 메모리에 올리지 않는다. 한 장을 못 읽으면 그 칸은 회색 빈 칸으로 두고 계속한다.
// · 취소(deps.isCancelled)되면 undefined — 호출부는 아무것도 저장하지 않는다.
// · 글자는 그리기 전에 폰트를 기다린다(deps.waitForFont — 실패해도 기본 폰트로 계속).
// · 캔버스 안 색은 테마와 무관한 고정색(CAPTURE_COLORS). 별·장수·북마크 같은 카드 위 표시는 그리지 않는다.
import { CaptureLayout, CaptureRect, CaptureSource, CAPTURE_COLORS } from './captureSheet';
import { CaptureImageFormat, CAPTURE_IMAGE_FORMATS } from './imageFormats';
import { fitText } from './presetExportDecoration';

/** 캔버스에 그릴 수 있는 읽은 이미지(HTMLImageElement 등) — 크기만 알면 된다 */
export interface CaptureDrawable {
  width: number;
  height: number;
}

export interface CaptureCanvas {
  width: number;
  height: number;
  getContext(kind: '2d'): CanvasRenderingContext2D | null;
  toDataURL(type?: string, quality?: number): string;
}

export interface CaptureRenderDeps {
  createCanvas: (width: number, height: number) => CaptureCanvas;
  loadImage: (source: CaptureSource) => Promise<CaptureDrawable | null | undefined>;
  releaseImage?: (image: CaptureDrawable) => void;
  isCancelled?: () => boolean;
  /** done = 지금까지 처리한 이미지 칸 수, total = 이미지가 있는 칸 수 */
  onProgress?: (done: number, total: number) => void;
  /** 글자에 쓸 글꼴 목록(CSS font-family) — 없으면 sans-serif */
  fontFamily?: string;
  waitForFont?: (font: string) => Promise<unknown>;
}

/** 원본 크기·칸 → 그릴 영역. cover = 가운데를 잘라 칸을 채움, contain = 전체가 보이게(남는 곳은 배경) */
export function fitDrawRect(
  srcW: number,
  srcH: number,
  cell: CaptureRect,
  fit: 'cover' | 'contain',
): { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number } {
  const sW = Math.max(1, srcW);
  const sH = Math.max(1, srcH);
  if (fit === 'cover') {
    const scale = Math.max(cell.w / sW, cell.h / sH);
    const sw = cell.w / scale;
    const sh = cell.h / scale;
    return { sx: (sW - sw) / 2, sy: (sH - sh) / 2, sw, sh, dx: cell.x, dy: cell.y, dw: cell.w, dh: cell.h };
  }
  const scale = Math.min(cell.w / sW, cell.h / sH);
  const dw = sW * scale;
  const dh = sH * scale;
  return { sx: 0, sy: 0, sw: sW, sh: sH, dx: cell.x + (cell.w - dw) / 2, dy: cell.y + (cell.h - dh) / 2, dw, dh };
}

const fontOf = (px: number, family: string) => `600 ${px}px ${family}`;

/** 배치를 그린다. 취소되면 undefined */
export async function renderCaptureSheet(
  layout: CaptureLayout,
  fit: 'cover' | 'contain',
  deps: CaptureRenderDeps,
): Promise<CaptureCanvas | undefined> {
  const canvas = deps.createCanvas(layout.width, layout.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('캔버스를 만들 수 없습니다');
  ctx.fillStyle = CAPTURE_COLORS.background;
  ctx.fillRect(0, 0, layout.width, layout.height);
  ctx.imageSmoothingEnabled = true;
  try {
    (ctx as any).imageSmoothingQuality = 'high';
  } catch {
    /* 지원하지 않는 환경은 기본 품질 */
  }

  const total = layout.cells.filter((c) => !!c.source).length;
  let done = 0;
  deps.onProgress?.(0, total);
  for (const cell of layout.cells) {
    if (deps.isCancelled?.()) return undefined;
    if (!cell.source) {
      ctx.fillStyle = CAPTURE_COLORS.empty;
      ctx.fillRect(cell.x, cell.y, cell.w, cell.h);
      continue;
    }
    let image: CaptureDrawable | null | undefined;
    try {
      image = await deps.loadImage(cell.source);
    } catch (e) {
      image = undefined;
    }
    if (deps.isCancelled?.()) {
      if (image) deps.releaseImage?.(image);
      return undefined;
    }
    if (image && image.width > 0 && image.height > 0) {
      const r = fitDrawRect(image.width, image.height, cell, fit);
      ctx.save();
      ctx.beginPath();
      ctx.rect(cell.x, cell.y, cell.w, cell.h);
      ctx.clip();
      ctx.drawImage(image as unknown as CanvasImageSource, r.sx, r.sy, r.sw, r.sh, r.dx, r.dy, r.dw, r.dh);
      ctx.restore();
    } else {
      ctx.fillStyle = CAPTURE_COLORS.empty;
      ctx.fillRect(cell.x, cell.y, cell.w, cell.h);
    }
    if (image) deps.releaseImage?.(image);
    done += 1;
    deps.onProgress?.(done, total);
  }

  if (layout.texts.length > 0) {
    const family = deps.fontFamily || 'sans-serif';
    if (deps.waitForFont) {
      const sizes = Array.from(new Set(layout.texts.map((t) => t.fontPx)));
      for (const px of sizes) {
        try {
          await deps.waitForFont(fontOf(px, family));
        } catch {
          /* 폰트를 못 기다려도 기본 폰트로 계속 */
        }
      }
    }
    if (deps.isCancelled?.()) return undefined;
    ctx.fillStyle = CAPTURE_COLORS.text;
    ctx.textBaseline = 'middle';
    for (const t of layout.texts) {
      ctx.font = fontOf(t.fontPx, family);
      ctx.textAlign = t.align;
      const text = fitText(ctx, t.text, Math.max(1, t.w));
      const x = t.align === 'center' ? t.x + t.w / 2 : t.x;
      ctx.fillText(text, x, t.y + t.h / 2);
    }
  }
  return canvas;
}

/** 캔버스 → 접두사 없는 base64. 캔버스가 너무 크거나 메모리가 모자라 인코딩이 조용히 실패하면 오류 */
export function encodeCaptureCanvas(canvas: CaptureCanvas, format: CaptureImageFormat): string {
  const spec = CAPTURE_IMAGE_FORMATS[format];
  const url = canvas.toDataURL(spec.mime, spec.quality);
  const comma = url.indexOf(',');
  const base64 = comma >= 0 ? url.slice(comma + 1) : '';
  if (!url.startsWith(`data:${spec.mime}`) || !base64) {
    throw new Error('결과 이미지를 만들 수 없습니다(이미지가 너무 큽니다)');
  }
  return base64;
}
