import { Buffer } from 'buffer';
import ExifReader from 'exifreader';
import extractChunks from 'png-chunks-extract';
import encodeChunks from 'png-chunks-encode';
import * as PngChunk from 'png-chunk-text';
import {
  SDStudioImageMetadataV1,
  embedSDStudioMetadataInPngBase64,
  embedSDStudioMetadataInWebpBytes,
  extractSDStudioMetadataFromBase64,
  extractSDStudioMetadataFromPngBase64,
  extractSDStudioMetadataFromWebpBytes,
} from '../../../shared/sdstudioImageMetadata';

const metadata: SDStudioImageMetadataV1 = {
  schemaVersion: 1,
  promptSource: {
    schemaVersion: 1,
    workflowType: 'SDImageGen',
    frontPrompt: '상위, artist:test',
    extraPrompt: '추가',
    middlePrompt: '중간',
    backPrompt: '하위',
  },
  generationSettings: {
    schemaVersion: 1,
    modelVersion: '5-full',
    furryMode: false,
    disableQuality: false,
    qualityPreset: 'standard',
    ucPreset: 'heavy',
    transparentBackground: true,
  },
};

// 1x1 RGBA PNG. 생성 메타데이터 청크 왕복만 검증하므로 픽셀 내용은 무관하다.
const pngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function makeMinimalWebpContainer(): Uint8Array {
  const out = Buffer.alloc(20);
  out.write('RIFF', 0, 4, 'ascii');
  out.write('WEBP', 8, 4, 'ascii');
  out.write('VP8 ', 12, 4, 'ascii');
  out.writeUInt32LE(0, 16);
  out.writeUInt32LE(out.length - 8, 4);
  return Uint8Array.from(out);
}

function addNaiComment(base64: string, comment: string): string {
  const chunks = extractChunks(
    Buffer.from(base64, 'base64') as unknown as Uint8Array,
  );
  const iend = chunks.findIndex((chunk) => chunk.name === 'IEND');
  chunks.splice(iend, 0, PngChunk.encode('Comment', comment));
  return Buffer.from(encodeChunks(chunks)).toString('base64');
}

describe('SDStudio 생성 이미지 메타데이터', () => {
  test('PNG 별도 청크에 유니코드 프롬프트를 왕복한다', () => {
    const embedded = embedSDStudioMetadataInPngBase64(pngBase64, metadata);
    expect(embedded).not.toBe(pngBase64);
    expect(extractSDStudioMetadataFromPngBase64(embedded)).toEqual(metadata);
    expect(extractSDStudioMetadataFromBase64(embedded)).toEqual(metadata);
  });

  test('같은 PNG에 다시 삽입하면 최신 값 하나로 교체한다', () => {
    const first = embedSDStudioMetadataInPngBase64(pngBase64, metadata);
    const next: SDStudioImageMetadataV1 = {
      ...metadata,
      promptSource: { ...metadata.promptSource, middlePrompt: '교체됨' },
    };
    const second = embedSDStudioMetadataInPngBase64(first, next);
    expect(extractSDStudioMetadataFromPngBase64(second)).toEqual(next);
  });

  test('기존 NAI Comment 청크를 변경하지 않는다', () => {
    const comment = JSON.stringify({ prompt: 'nai prompt', seed: 123 });
    const source = addNaiComment(pngBase64, comment);
    const embedded = embedSDStudioMetadataInPngBase64(source, metadata);
    const tags = ExifReader.load(Buffer.from(embedded, 'base64'));
    const raw = tags.Comment?.value;
    expect(Array.isArray(raw) ? raw.join('') : raw).toBe(comment);
  });

  test('WebP 전용 청크를 추가하고 기존 청크를 보존한다', () => {
    const source = makeMinimalWebpContainer();
    const embedded = embedSDStudioMetadataInWebpBytes(source, metadata);
    expect(Buffer.from(embedded).toString('ascii', 12, 16)).toBe('VP8 ');
    expect(extractSDStudioMetadataFromWebpBytes(embedded)).toEqual(metadata);
    expect(
      extractSDStudioMetadataFromBase64(Buffer.from(embedded).toString('base64')),
    ).toEqual(metadata);
  });

  test('잘못된 스키마는 읽지 않는다', () => {
    const invalid = {
      ...metadata,
      schemaVersion: 2,
    } as unknown as SDStudioImageMetadataV1;
    expect(() => embedSDStudioMetadataInWebpBytes(makeMinimalWebpContainer(), invalid))
      .toThrow('형식이 올바르지 않습니다');
  });
});
