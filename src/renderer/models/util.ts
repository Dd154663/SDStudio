import ExifReader from 'exifreader';
import { CharacterPrompt, ImportableMetadata, SDAbstractJob, SDJob } from './types';

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getPlatform() {
  const platform = window.navigator.platform;
  if (platform.startsWith('Win')) return 'windows';
  const arch = await (navigator as any).userAgentData.getHighEntropyValues([
    'architecture',
  ]);
  if (arch.architecture === 'arm64') return 'mac-arm64';
  return 'mac-x64';
}

export async function getFirstFile() {
  return new Promise((resolve, reject) => {
    // Create a hidden file input element
    const input = document.createElement('input');
    input.type = 'file';
    input.style.display = 'none';

    // Listen for file selection
    input.addEventListener('change', (event: any) => {
      const file = event.target.files[0];
      if (file) {
        resolve(file);
      } else {
        reject(new Error('No file selected'));
      }
    });

    // Trigger the file input click
    document.body.appendChild(input);
    input.click();

    // Clean up the DOM
    document.body.removeChild(input);
  });
}

function base64ToArrayBuffer(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;

  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return bytes.buffer;
}

export async function extractExifFromBase64(base64: string) {
  const arrayBuffer = base64ToArrayBuffer(base64);
  const exif = ExifReader.load(arrayBuffer);
  return exif;
}

const STEALTH_MAGIC = 'stealth_pngcomp';

async function decompressGzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new DecompressionStream('gzip');
  const writer = stream.writable.getWriter();
  writer.write(data);
  writer.close();
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function loadImageFromBase64(base64: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = `data:image/png;base64,${base64}`;
  });
}

export async function extractMetadataFromAlpha(
  base64: string,
): Promise<any | undefined> {
  try {
    const img = await loadImageFromBase64(base64);
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, img.width, img.height);
    const pixels = imageData.data;
    const width = img.width;
    const height = img.height;

    // Extract LSBs from alpha channel in column-major order
    const totalPixels = width * height;
    const bits = new Uint8Array(totalPixels);
    let bitIdx = 0;
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        const idx = (y * width + x) * 4 + 3; // alpha channel
        bits[bitIdx++] = pixels[idx] & 1;
      }
    }

    // Pack bits into bytes (MSB first, same as np.packbits)
    const byteLen = Math.ceil(totalPixels / 8);
    const bytes = new Uint8Array(byteLen);
    for (let i = 0; i < totalPixels; i++) {
      if (bits[i]) {
        bytes[Math.floor(i / 8)] |= 1 << (7 - (i % 8));
      }
    }

    // Check magic string
    const magicBytes = new TextEncoder().encode(STEALTH_MAGIC);
    for (let i = 0; i < magicBytes.length; i++) {
      if (bytes[i] !== magicBytes[i]) return undefined;
    }

    // Read 32-bit big-endian length (in bits)
    let offset = STEALTH_MAGIC.length;
    const lengthBits =
      (bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3];
    offset += 4;
    const lengthBytes = Math.ceil(lengthBits / 8);

    // Extract and decompress gzip data
    const compressed = bytes.slice(offset, offset + lengthBytes);
    const decompressed = await decompressGzip(compressed);
    const jsonString = new TextDecoder().decode(decompressed);
    const metadata = JSON.parse(jsonString);

    // The Comment field may be a nested JSON string
    if (metadata['Comment'] && typeof metadata['Comment'] === 'string') {
      metadata['Comment'] = JSON.parse(metadata['Comment']);
    }

    return metadata;
  } catch (e) {
    return undefined;
  }
}

function parseCommentToJob(
  data: any,
): ImportableMetadata | undefined {
  if (!data || !data['prompt']) return undefined;
  try {
    // v4 캐릭터 프롬프트 추출 (실패 시 빈 배열로 폴백)
    let characterPrompts: CharacterPrompt[] = [];
    let useCoords = false;
    let legacyPromptConditioning = false;
    try {
      const charCaptions = data['v4_prompt']?.['caption']?.['char_captions'] || [];
      const charUCCaptions = data['v4_negative_prompt']?.['caption']?.['char_captions'] || [];
      for (let i = 0; i < charCaptions.length; i++) {
        characterPrompts.push({
          id: `${i}`,
          prompt: charCaptions[i]?.char_caption ?? '',
          position: charCaptions[i]?.centers?.[0],
          uc: charUCCaptions[i]?.char_caption ?? '',
        });
      }
      useCoords = data['v4_prompt']?.['use_coords'] ?? false;
      legacyPromptConditioning = data['v4_negative_prompt']?.['legacy_uc'] ?? false;
    } catch (e) {
      // v4 포맷 없음 — 폴백
    }

    // 바이브 트랜스퍼 데이터 추출
    const vibeImages: string[] = data['reference_image_multiple'] || [];
    const vibeStrengths: number[] = data['reference_strength_multiple'] || [];
    const vibeInfos: number[] = data['reference_information_extracted_multiple'] || [];
    const vibes = vibeStrengths.map((strength, i) => ({
      path: '',
      strength,
      info: vibeInfos[i] ?? 1,
    }));

    // 캐릭터 레퍼런스 데이터 추출
    const refImages: string[] = data['director_reference_images'] || [];
    const refStrengths: number[] = data['director_reference_strength_values'] || [];
    const refFidelities: number[] = (data['director_reference_secondary_strength_values'] || []).map(
      (v: number) => 1 - v,
    );
    const refInfos: number[] = data['director_reference_information_extracted'] || [];
    const refDescs: any[] = data['director_reference_descriptions'] || [];
    const characterReferences = refStrengths.map((strength, i) => ({
      path: '',
      strength,
      fidelity: refFidelities[i] ?? 1,
      info: refInfos[i] ?? 1,
      referenceType: (refDescs[i]?.caption?.base_caption || 'character') as 'character' | 'style' | 'character&style',
      enabled: true,
    }));

    // 해상도 추출
    const resolution = data['width'] && data['height']
      ? { width: data['width'], height: data['height'] }
      : undefined;

    return {
      prompt: data['prompt'],
      seed: data['seed'],
      promptGuidance: data['scale'],
      cfgRescale: data['cfg_rescale'],
      sampling: data['sampler'],
      noiseSchedule: data['noise_schedule'],
      steps: data['steps'],
      uc: data['uc'],
      vibes,
      normalizeStrength: data['normalize_reference_strength_multiple'] ?? true,
      varietyPlus: data['skip_cfg_above_sigma'] ? true : false,
      characterReferences,
      backend: { type: 'NAI' },
      useCoords,
      legacyPromptConditioning,
      characterPrompts,
      vibeImageData: vibeImages.length > 0 ? vibeImages : undefined,
      referenceImageData: refImages.length > 0 ? refImages : undefined,
      resolution,
    };
  } catch (e) {
    return undefined;
  }
}

export async function extractPromptDataFromBase64(
  base64: string,
): Promise<ImportableMetadata | undefined> {
  // 1차: EXIF Comment에서 추출 시도
  try {
    const exif = await extractExifFromBase64(base64);
    const comment = exif['Comment'];
    if (comment && comment.value) {
      const data = JSON.parse(comment.value as string);
      const result = parseCommentToJob(data);
      if (result) return result;
    }
  } catch (e) {
    // EXIF 추출 실패 — 스테가노그래피로 폴백
  }

  // 2차: 알파 채널 스테가노그래피에서 추출 시도
  try {
    const metadata = await extractMetadataFromAlpha(base64);
    if (metadata) {
      const commentData = metadata['Comment'] || metadata;
      const result = parseCommentToJob(commentData);
      if (result) return result;
    }
  } catch (e) {
    // 스테가노그래피 추출도 실패
  }

  return undefined;
}

export function assert(condition: any, message?: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
