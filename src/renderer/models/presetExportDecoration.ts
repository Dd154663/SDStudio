export type PresetExportDecorationKind = 'local' | 'global';

export interface PresetExportDecorationLayout {
  accent: string;
  kindLabel: 'LOCAL' | 'GLOBAL';
  borderWidth: number;
  topBadgeHeight: number;
  bottomBandHeight: number;
  padding: number;
  brandFontSize: number;
  nameFontSize: number;
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function getPresetExportDecorationLayout(
  width: number,
  height: number,
  kind: PresetExportDecorationKind,
): PresetExportDecorationLayout {
  const shortSide = Math.max(1, Math.min(width, height));
  return {
    accent: kind === 'global' ? '#14b8a6' : '#38bdf8',
    kindLabel: kind === 'global' ? 'GLOBAL' : 'LOCAL',
    borderWidth: clamp(Math.round(shortSide * 0.009), 5, 14),
    topBadgeHeight: clamp(Math.round(shortSide * 0.075), 42, 82),
    bottomBandHeight: clamp(Math.round(shortSide * 0.13), 72, 144),
    padding: clamp(Math.round(shortSide * 0.025), 14, 34),
    brandFontSize: clamp(Math.round(shortSide * 0.027), 17, 30),
    nameFontSize: clamp(Math.round(shortSide * 0.042), 24, 46),
  };
}

function loadPng(base64: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('프리셋 대표 이미지를 불러올 수 없습니다.'));
    image.src = `data:image/png;base64,${base64}`;
  });
}

function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (ctx.measureText(text.slice(0, mid) + '…').width <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return text.slice(0, low) + '…';
}

/**
 * 프리셋 교환용 PNG의 픽셀에만 식별 장식을 더한다.
 * 데이터 JSON은 이 함수 이후 기존 embedJSONInPNG가 그대로 삽입하므로 스키마와
 * 구버전 불러오기 계약에는 영향을 주지 않는다. 합성 실패 시 시각 기능 때문에
 * 내보내기 자체가 막히지 않도록 원본 PNG를 반환한다.
 */
export async function decoratePresetExportImage(
  pngBase64: string,
  kind: PresetExportDecorationKind,
  presetName: string,
): Promise<string> {
  try {
    const image = await loadPng(pngBase64);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (width <= 0 || height <= 0) return pngBase64;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return pngBase64;

    const layout = getPresetExportDecorationLayout(width, height, kind);
    ctx.drawImage(image, 0, 0, width, height);

    // 썸네일에서도 프리셋임을 알아볼 수 있는 유형별 외곽선.
    ctx.save();
    ctx.strokeStyle = layout.accent;
    ctx.lineWidth = layout.borderWidth;
    ctx.strokeRect(
      layout.borderWidth / 2,
      layout.borderWidth / 2,
      width - layout.borderWidth,
      height - layout.borderWidth,
    );

    // 상단 식별 배지.
    const topWidth = Math.min(
      width - layout.borderWidth * 2,
      Math.max(width * 0.42, 260),
    );
    ctx.fillStyle = 'rgba(8, 15, 29, 0.82)';
    ctx.fillRect(
      layout.borderWidth,
      layout.borderWidth,
      topWidth,
      layout.topBadgeHeight,
    );
    ctx.fillStyle = layout.accent;
    ctx.fillRect(
      layout.borderWidth,
      layout.borderWidth,
      layout.borderWidth,
      layout.topBadgeHeight,
    );
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${layout.brandFontSize}px Arial, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      `SDSTUDIO PRESET · ${layout.kindLabel}`,
      layout.borderWidth + layout.padding,
      layout.borderWidth + layout.topBadgeHeight / 2,
    );

    // 하단 이름 띠. 이미지 크기는 바꾸지 않고 기존 픽셀 위에만 합성한다.
    const bandY = height - layout.borderWidth - layout.bottomBandHeight;
    const gradient = ctx.createLinearGradient(0, bandY, 0, height);
    gradient.addColorStop(0, 'rgba(8, 15, 29, 0.42)');
    gradient.addColorStop(0.25, 'rgba(8, 15, 29, 0.78)');
    gradient.addColorStop(1, 'rgba(8, 15, 29, 0.9)');
    ctx.fillStyle = gradient;
    ctx.fillRect(
      layout.borderWidth,
      bandY,
      width - layout.borderWidth * 2,
      layout.bottomBandHeight,
    );
    ctx.fillStyle = layout.accent;
    ctx.fillRect(
      layout.borderWidth,
      height - layout.borderWidth * 2,
      width - layout.borderWidth * 2,
      layout.borderWidth,
    );
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${layout.nameFontSize}px Arial, sans-serif`;
    const name = fitText(
      ctx,
      presetName || 'Untitled preset',
      width - (layout.borderWidth + layout.padding) * 2,
    );
    ctx.fillText(
      name,
      layout.borderWidth + layout.padding,
      bandY + layout.bottomBandHeight / 2,
    );
    ctx.restore();

    return canvas
      .toDataURL('image/png')
      .replace(/^data:image\/png;base64,/, '');
  } catch (e) {
    console.warn('프리셋 내보내기 이미지 장식 실패 — 원본으로 계속:', e);
    return pngBase64;
  }
}
