import { Buffer } from 'buffer';
import extractChunks from 'png-chunks-extract';
import encodeChunks from 'png-chunks-encode';
import * as PngChunk from 'png-chunk-text';

const PNG_KEYWORD = 'SDStudio';
const PNG_PREFIX = 'v1:';
const WEBP_CHUNK = 'SDST';
const MAX_METADATA_BYTES = 1024 * 1024;
const MODEL_VERSIONS = new Set([
  '5-full',
  '5-curated',
  '4-5-full',
  '4-5-curated',
  '4-full',
  '4-curated',
]);
const UC_PRESETS = new Set([
  'heavy',
  'light',
  'humanFocus',
  'furryFocus',
  'none',
]);

export interface SDStudioPromptSourceV1 {
  schemaVersion: 1;
  workflowType: string;
  frontPrompt: string;
  extraPrompt: string;
  middlePrompt: string;
  backPrompt: string;
  characterPrompt?: string;
  backgroundPrompt?: string;
}

export interface SDStudioGenerationSettingsV1 {
  schemaVersion: 1;
  modelVersion: string;
  furryMode: boolean;
  disableQuality: boolean;
  qualityPreset?: 'standard' | 'light' | 'none';
  ucPreset: string;
  transparentBackground?: boolean;
}

export interface SDStudioImageMetadataV1 {
  schemaVersion: 1;
  promptSource: SDStudioPromptSourceV1;
  generationSettings?: SDStudioGenerationSettingsV1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeSDStudioImageMetadata(
  value: unknown,
): SDStudioImageMetadataV1 | undefined {
  if (!isRecord(value) || value.schemaVersion !== 1) return undefined;
  const source = value.promptSource;
  if (!isRecord(source) || source.schemaVersion !== 1) return undefined;
  const required = [
    'workflowType',
    'frontPrompt',
    'extraPrompt',
    'middlePrompt',
    'backPrompt',
  ];
  if (required.some((key) => typeof source[key] !== 'string')) return undefined;

  const result: SDStudioImageMetadataV1 = {
    schemaVersion: 1,
    promptSource: {
      schemaVersion: 1,
      workflowType: source.workflowType as string,
      frontPrompt: source.frontPrompt as string,
      extraPrompt: source.extraPrompt as string,
      middlePrompt: source.middlePrompt as string,
      backPrompt: source.backPrompt as string,
      ...(typeof source.characterPrompt === 'string'
        ? { characterPrompt: source.characterPrompt }
        : {}),
      ...(typeof source.backgroundPrompt === 'string'
        ? { backgroundPrompt: source.backgroundPrompt }
        : {}),
    },
  };

  const settings = value.generationSettings;
  if (
    isRecord(settings) &&
    settings.schemaVersion === 1 &&
    typeof settings.modelVersion === 'string' &&
    MODEL_VERSIONS.has(settings.modelVersion) &&
    typeof settings.furryMode === 'boolean' &&
    typeof settings.disableQuality === 'boolean' &&
    typeof settings.ucPreset === 'string' &&
    UC_PRESETS.has(settings.ucPreset)
  ) {
    result.generationSettings = {
      schemaVersion: 1,
      modelVersion: settings.modelVersion,
      furryMode: settings.furryMode,
      disableQuality: settings.disableQuality,
      ucPreset: settings.ucPreset,
      ...(settings.qualityPreset === 'standard' ||
      settings.qualityPreset === 'light' ||
      settings.qualityPreset === 'none'
        ? { qualityPreset: settings.qualityPreset }
        : {}),
      ...(typeof settings.transparentBackground === 'boolean'
        ? { transparentBackground: settings.transparentBackground }
        : {}),
    };
  }
  return result;
}

function encodeMetadata(metadata: SDStudioImageMetadataV1): Buffer {
  const normalized = normalizeSDStudioImageMetadata(metadata);
  if (!normalized) throw new Error('SDStudio 이미지 메타데이터 형식이 올바르지 않습니다.');
  const data = Buffer.from(JSON.stringify(normalized), 'utf8');
  if (data.length > MAX_METADATA_BYTES) {
    throw new Error('SDStudio 이미지 메타데이터가 너무 큽니다.');
  }
  return data;
}

function decodeMetadata(data: Uint8Array): SDStudioImageMetadataV1 | undefined {
  if (data.length === 0 || data.length > MAX_METADATA_BYTES) return undefined;
  try {
    return normalizeSDStudioImageMetadata(
      JSON.parse(Buffer.from(data).toString('utf8')),
    );
  } catch (_) {
    return undefined;
  }
}

export function embedSDStudioMetadataInPngBase64(
  pngBase64: string,
  metadata: SDStudioImageMetadataV1,
): string {
  const input = Buffer.from(pngBase64, 'base64');
  const chunks = extractChunks(input as unknown as Uint8Array).filter((chunk) => {
    if (chunk.name !== 'tEXt') return true;
    try {
      return PngChunk.decode(chunk.data).keyword !== PNG_KEYWORD;
    } catch (_) {
      return true;
    }
  });
  const payload = encodeMetadata(metadata).toString('base64');
  const textChunk = PngChunk.encode(PNG_KEYWORD, PNG_PREFIX + payload);
  const iend = chunks.findIndex((chunk) => chunk.name === 'IEND');
  chunks.splice(iend >= 0 ? iend : chunks.length, 0, textChunk);
  return Buffer.from(encodeChunks(chunks)).toString('base64');
}

export function extractSDStudioMetadataFromPngBase64(
  pngBase64: string,
): SDStudioImageMetadataV1 | undefined {
  try {
    const chunks = extractChunks(
      Buffer.from(pngBase64, 'base64') as unknown as Uint8Array,
    );
    for (const chunk of chunks) {
      if (chunk.name !== 'tEXt') continue;
      const decoded = PngChunk.decode(chunk.data);
      if (
        decoded.keyword !== PNG_KEYWORD ||
        !decoded.text.startsWith(PNG_PREFIX)
      ) {
        continue;
      }
      const payload = Buffer.from(
        decoded.text.slice(PNG_PREFIX.length),
        'base64',
      );
      return decodeMetadata(payload as unknown as Uint8Array);
    }
  } catch (_) {}
  return undefined;
}

function isWebp(bytes: Uint8Array): boolean {
  const b = Buffer.from(bytes);
  return (
    b.length >= 12 &&
    b.toString('ascii', 0, 4) === 'RIFF' &&
    b.toString('ascii', 8, 12) === 'WEBP'
  );
}

export function embedSDStudioMetadataInWebpBytes(
  webpBytes: Uint8Array,
  metadata: SDStudioImageMetadataV1,
): Uint8Array {
  if (!isWebp(webpBytes)) throw new Error('WebP 컨테이너가 아닙니다.');
  const input = Buffer.from(webpBytes);
  const chunks: Uint8Array[] = [];
  let offset = 12;
  while (offset + 8 <= input.length) {
    const size = input.readUInt32LE(offset + 4);
    const end = offset + 8 + size + (size & 1);
    if (end > input.length) throw new Error('손상된 WebP 청크입니다.');
    if (input.toString('ascii', offset, offset + 4) !== WEBP_CHUNK) {
      chunks.push(Uint8Array.from(input.subarray(offset, end)));
    }
    offset = end;
  }
  if (offset !== input.length) throw new Error('손상된 WebP 컨테이너입니다.');

  const payload = encodeMetadata(metadata);
  const custom = Buffer.alloc(8 + payload.length + (payload.length & 1));
  custom.write(WEBP_CHUNK, 0, 4, 'ascii');
  custom.writeUInt32LE(payload.length, 4);
  custom.set(payload as unknown as Uint8Array, 8);
  const parts: Uint8Array[] = [
    Uint8Array.from(input.subarray(0, 12)),
    ...chunks,
    Uint8Array.from(custom),
  ];
  const output = Buffer.alloc(parts.reduce((sum, part) => sum + part.length, 0));
  let writeOffset = 0;
  for (const part of parts) {
    output.set(part, writeOffset);
    writeOffset += part.length;
  }
  output.writeUInt32LE(output.length - 8, 4);
  return Uint8Array.from(output);
}

export function extractSDStudioMetadataFromWebpBytes(
  webpBytes: Uint8Array,
): SDStudioImageMetadataV1 | undefined {
  if (!isWebp(webpBytes)) return undefined;
  const input = Buffer.from(webpBytes);
  let offset = 12;
  while (offset + 8 <= input.length) {
    const name = input.toString('ascii', offset, offset + 4);
    const size = input.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const end = dataStart + size;
    const paddedEnd = end + (size & 1);
    if (paddedEnd > input.length) return undefined;
    if (name === WEBP_CHUNK) {
      return decodeMetadata(
        input.subarray(dataStart, end) as unknown as Uint8Array,
      );
    }
    offset = paddedEnd;
  }
  return undefined;
}

export function extractSDStudioMetadataFromBase64(
  base64: string,
): SDStudioImageMetadataV1 | undefined {
  if (base64.startsWith('iVBOR')) {
    return extractSDStudioMetadataFromPngBase64(base64);
  }
  if (base64.startsWith('UklGR')) {
    return extractSDStudioMetadataFromWebpBytes(
      Buffer.from(base64, 'base64') as unknown as Uint8Array,
    );
  }
  return undefined;
}
