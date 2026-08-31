jest.mock('../../../models', () => ({ backend: { getConfig: jest.fn() } }));
jest.mock('../../../componenets/BrushTool', () => ({ getImageDimensions: jest.fn() }));

import JSZip from 'jszip';
import { getImageDimensions } from '../../../componenets/BrushTool';
import { NovelAiImageGenService } from '../nai';
import { estimateNaiUpscaleCost } from '../naiUpscale';

const dimensions = getImageDimensions as jest.Mock;
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

beforeEach(() => {
  dimensions.mockResolvedValue({ width: 832, height: 1216 });
});

test.each([
  [832, 1216, 1], [1024, 1024, 1], [1048577, 1, 2],
  [1747627, 1, 2], [1747628, 1, 3], [2446678, 1, 3],
  [2446679, 1, 4], [2048, 1536, 4],
])('입력 %i × %i 예상 비용 %i Anlas', (width, height, expected) => {
  expect(estimateNaiUpscaleCost(width, height)).toBe(expected);
});

test.each([[0, 1], [-1, 5], [NaN, 512], [Infinity, 512], [1.5, 2], [2048, 2048]])(
  '지원하지 않는 입력 크기 %s × %s는 차단', (w, h) => {
    expect(() => estimateNaiUpscaleCost(w, h)).toThrow();
  },
);

test('공식 현재 요청 형식 사용·PNG만 선택·원본 바이트 유지', async () => {
  const zip = new JSZip();
  zip.file('image_0.png', png);
  zip.file('metadata.json', '{"test":true}');
  const fetchArrayBuffer = jest.fn().mockResolvedValue(await zip.generateAsync({ type: 'arraybuffer' }));
  const service = new NovelAiImageGenService({ fetchArrayBuffer });
  const source = 'source-base64';
  const output = await service.upscaleImage('test-token', { image: source, outputFilePath: 'unused.png' });
  expect(fetchArrayBuffer).toHaveBeenCalledTimes(1);
  expect(fetchArrayBuffer).toHaveBeenCalledWith('https://image.novelai.net/ai/upscale', {
    image: source, model: 'nai-diffusion-5-curated', declared_blur_sigma: 0,
  }, expect.objectContaining({ Authorization: 'Bearer test-token', Accept: 'application/zip' }));
  expect(new Uint8Array(Buffer.from(output, 'base64'))).toEqual(png);
});

test('제한 초과는 유료 요청 전에 차단', async () => {
  dimensions.mockResolvedValue({ width: 2048, height: 2048 });
  const fetchArrayBuffer = jest.fn();
  const service = new NovelAiImageGenService({ fetchArrayBuffer });
  await expect(service.upscaleImage('test-token', { image: 'source', outputFilePath: 'unused.png' })).rejects.toThrow();
  expect(fetchArrayBuffer).not.toHaveBeenCalled();
});

test.each(['empty', 'multiple', 'invalid'])('잘못된 결과(%s)를 저장용으로 반환하지 않는다', async (kind) => {
  const zip = new JSZip();
  if (kind !== 'empty') zip.file('image_0.png', kind === 'invalid' ? 'not png' : png);
  if (kind === 'multiple') zip.file('image_1.png', png);
  const fetchArrayBuffer = jest.fn().mockResolvedValue(await zip.generateAsync({ type: 'arraybuffer' }));
  const service = new NovelAiImageGenService({ fetchArrayBuffer });
  await expect(service.upscaleImage('test-token', { image: 'source', outputFilePath: 'unused.png' })).rejects.toThrow();
  expect(fetchArrayBuffer).toHaveBeenCalledTimes(1);
});

test('요청 실패는 내부 재시도 없이 전파', async () => {
  const fetchArrayBuffer = jest.fn().mockRejectedValue(new Error('network timeout'));
  const service = new NovelAiImageGenService({ fetchArrayBuffer });
  await expect(service.upscaleImage('test-token', { image: 'source', outputFilePath: 'unused.png' })).rejects.toThrow('network timeout');
  expect(fetchArrayBuffer).toHaveBeenCalledTimes(1);
});
