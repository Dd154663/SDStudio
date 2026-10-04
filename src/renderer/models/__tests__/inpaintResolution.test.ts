// 인페인트 씬 해상도 = 첨부 이미지 크기(R-res, 2026-10-04) 회귀 테스트 — SPEC §7-3.
jest.mock('../../componenets/BrushTool', () => ({
  getImageDimensions: jest.fn(),
}));

import { getImageDimensions } from '../../componenets/BrushTool';
import {
  applyImageResolution,
  copySceneResolution,
  imageResolutionMismatch,
  imageResolutionSize,
  inpaintSceneResolutionFields,
  paidResolutionNotice,
  resolutionForImageSize,
  resolutionFromImage,
  workflowUsesImageResolution,
} from '../inpaintResolution';

const decodeMock = getImageDimensions as jest.Mock;

describe('resolutionForImageSize', () => {
  it('프리셋과 정확히 같으면 그 enum', () => {
    expect(resolutionForImageSize(832, 1216)).toEqual({ resolution: 'portrait' });
    expect(resolutionForImageSize(1024, 1024)).toEqual({ resolution: 'square' });
    expect(resolutionForImageSize(1216, 832)).toEqual({ resolution: 'landscape' });
    expect(resolutionForImageSize(1024, 1536)).toEqual({ resolution: 'large_portrait' });
  });

  it('프리셋이 아니면 custom + 64 배수 올림', () => {
    expect(resolutionForImageSize(1000, 1500)).toEqual({
      resolution: 'custom',
      width: 1024,
      height: 1536,
    });
    expect(resolutionForImageSize(1664, 2432)).toEqual({
      resolution: 'custom',
      width: 1664,
      height: 2432,
    });
  });

  it('small 프리셋 크기는 같은 크기의 custom(편집 창 목록에 없음)', () => {
    expect(resolutionForImageSize(512, 768)).toEqual({
      resolution: 'custom',
      width: 512,
      height: 768,
    });
  });

  it('0·음수·NaN·소수는 undefined', () => {
    expect(resolutionForImageSize(0, 1024)).toBeUndefined();
    expect(resolutionForImageSize(1024, 0)).toBeUndefined();
    expect(resolutionForImageSize(-64, 64)).toBeUndefined();
    expect(resolutionForImageSize(NaN, 1024)).toBeUndefined();
    expect(resolutionForImageSize(Infinity, 1024)).toBeUndefined();
    expect(resolutionForImageSize(100.5, 64)).toBeUndefined();
  });
});

describe('resolutionFromImage', () => {
  beforeEach(() => decodeMock.mockReset());

  it('base64 · data URL 모두 크기로 판정', async () => {
    decodeMock.mockResolvedValue({ width: 832, height: 1216 });
    expect(await resolutionFromImage('AAAA')).toEqual({ resolution: 'portrait' });
    expect(decodeMock).toHaveBeenLastCalledWith('AAAA');
    expect(await resolutionFromImage('data:image/webp;base64,BBBB')).toEqual({
      resolution: 'portrait',
    });
    expect(decodeMock).toHaveBeenLastCalledWith('BBBB');
  });

  it('디코드 실패·빈 이미지는 undefined', async () => {
    decodeMock.mockRejectedValue(new Error('decode'));
    expect(await resolutionFromImage('AAAA')).toBeUndefined();
    expect(await resolutionFromImage('')).toBeUndefined();
    expect(await resolutionFromImage(undefined)).toBeUndefined();
  });

  it('크기 0 이미지는 undefined', async () => {
    decodeMock.mockResolvedValue({ width: 0, height: 0 });
    expect(await resolutionFromImage('AAAA')).toBeUndefined();
  });
});

describe('새 변형 씬 해상도(createInpaintScene)', () => {
  const customSource = { resolution: 'custom', resolutionWidth: 1280, resolutionHeight: 768 };

  it('인페인트·i2i 는 이미지 크기', () => {
    expect(
      inpaintSceneResolutionFields('SDInpaint', customSource, {
        resolution: 'custom' as any,
        width: 1024,
        height: 1536,
      }),
    ).toEqual({ resolution: 'custom', resolutionWidth: 1024, resolutionHeight: 1536 });
    expect(
      inpaintSceneResolutionFields('SDI2I', customSource, { resolution: 'square' as any }),
    ).toEqual({ resolution: 'square' });
  });

  it('크기를 모르면 원본 씬 해상도 — custom 너비·높이 보존', () => {
    expect(inpaintSceneResolutionFields('SDInpaint', customSource, undefined)).toEqual(customSource);
  });

  it('대상 아닌 워크플로우(이미지 수정)는 원본 씬 해상도', () => {
    expect(workflowUsesImageResolution('Augment')).toBe(false);
    expect(workflowUsesImageResolution('SDMirror')).toBe(false);
    expect(
      inpaintSceneResolutionFields('Augment', customSource, { resolution: 'square' as any }),
    ).toEqual(customSource);
  });
});

describe('씬 적용·복사', () => {
  it('applyImageResolution: custom 은 너비·높이까지, 프리셋은 enum 만', () => {
    const scene: any = { resolution: 'portrait', resolutionWidth: 10, resolutionHeight: 20 };
    applyImageResolution(scene, { resolution: 'custom' as any, width: 1024, height: 1536 });
    expect(scene).toEqual({ resolution: 'custom', resolutionWidth: 1024, resolutionHeight: 1536 });
    applyImageResolution(scene, { resolution: 'square' as any });
    expect(scene.resolution).toBe('square');
    expect(scene.resolutionWidth).toBe(1024);
  });

  it('대량 작업 내용 복사: 해상도 필드 3개 복사', () => {
    const target: any = { resolution: 'portrait' };
    copySceneResolution(
      { resolution: 'custom', resolutionWidth: 1280, resolutionHeight: 768 },
      target,
    );
    expect(target).toEqual({ resolution: 'custom', resolutionWidth: 1280, resolutionHeight: 768 });
  });
});

describe('불일치 안내·1MP 초과 안내', () => {
  it('맞춘 결과와 씬 요청 크기가 같으면 안내 없음', () => {
    expect(imageResolutionMismatch({ width: 832, height: 1216 }, 832, 1216)).toBeUndefined();
    expect(imageResolutionMismatch({ width: 1024, height: 1536 }, 1000, 1500)).toBeUndefined();
  });

  it('다르면 맞출 해상도', () => {
    expect(imageResolutionMismatch({ width: 832, height: 1216 }, 1024, 1024)).toEqual({
      resolution: 'square',
    });
    // custom 인데 너비·높이가 빠진 옛 씬
    expect(imageResolutionMismatch({ width: undefined, height: undefined }, 832, 1216)).toEqual({
      resolution: 'portrait',
    });
  });

  it('1MP 초과만 Anlas 안내', () => {
    expect(paidResolutionNotice({ resolution: 'square' as any })).toBeUndefined();
    expect(paidResolutionNotice({ resolution: 'portrait' as any })).toBeUndefined();
    expect(paidResolutionNotice({ resolution: 'large_portrait' as any })).toContain('Anlas');
    expect(
      paidResolutionNotice({ resolution: 'custom' as any, width: 1664, height: 2432 }),
    ).toContain('1664x2432');
    expect(imageResolutionSize({ resolution: 'wallpaper_portrait' as any })).toEqual({
      width: 1920,
      height: 1088,
    });
  });
});
