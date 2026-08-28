import {
  decoratePresetExportImage,
  getPresetExportDecorationLayout,
} from '../presetExportDecoration';

describe('preset export decoration layout', () => {
  it('로컬과 글로벌 내보내기를 서로 다른 배지와 색으로 구분한다', () => {
    const local = getPresetExportDecorationLayout(832, 1216, 'local');
    const global = getPresetExportDecorationLayout(832, 1216, 'global');

    expect(local.kindLabel).toBe('LOCAL');
    expect(global.kindLabel).toBe('GLOBAL');
    expect(local.accent).not.toBe(global.accent);
  });

  it('대표 이미지 크기에 비례하되 작은 이미지에서도 읽을 수 있는 하한을 유지한다', () => {
    const small = getPresetExportDecorationLayout(128, 128, 'local');
    const normal = getPresetExportDecorationLayout(832, 1216, 'local');
    const large = getPresetExportDecorationLayout(4096, 4096, 'local');

    expect(small.borderWidth).toBe(5);
    expect(small.brandFontSize).toBe(17);
    expect(normal.borderWidth).toBeGreaterThan(small.borderWidth);
    expect(large.borderWidth).toBe(14);
    expect(large.nameFontSize).toBe(46);
  });

  it('가로·세로 이미지 모두 짧은 변을 기준으로 같은 비율을 사용한다', () => {
    const portrait = getPresetExportDecorationLayout(832, 1216, 'global');
    const landscape = getPresetExportDecorationLayout(1216, 832, 'global');

    expect(landscape).toEqual(portrait);
  });

  it('합성에 실패하면 내보내기를 막지 않고 원본 PNG를 반환한다', async () => {
    const originalImage = globalThis.Image;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    class BrokenImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        this.onerror?.();
      }
    }
    (globalThis as any).Image = BrokenImage;

    try {
      await expect(
        decoratePresetExportImage('original-png', 'global', '테스트'),
      ).resolves.toBe('original-png');
      expect(warn).toHaveBeenCalled();
    } finally {
      globalThis.Image = originalImage;
      warn.mockRestore();
    }
  });
});
