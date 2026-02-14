import ExifReader from 'exifreader';
import { CharacterPrompt, SDAbstractJob, SDJob } from './types';

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

export async function extractPromptDataFromBase64(
  base64: string,
): Promise<SDAbstractJob<string> | undefined> {
  const exif = await extractExifFromBase64(base64);
  const comment = exif['Comment'];
  if (comment && comment.value) {
    const data = JSON.parse(comment.value as string);

    if (data['prompt']) {
      const charPrompts = data['v4_prompt']['caption']['char_captions'].map(
        (c: any) => c.char_caption,
      );
      const charPos = data['v4_prompt']['caption']['char_captions'].map(
        (c: any) => c.centers[0],
      );
      const charUCs = data['v4_negative_prompt']['caption'][
        'char_captions'
      ].map((c: any) => c.char_caption);

      const characterPrompts: CharacterPrompt[] = [];
      for (let i = 0; i < charPrompts.length; i++) {
        characterPrompts.push({
          id: `${i}`,
          prompt: charPrompts[i],
          position: charPos[i],
          uc: charUCs[i],
        });
      }
      return {
        prompt: data['prompt'],
        seed: data['seed'],
        promptGuidance: data['scale'],
        cfgRescale: data['cfg_rescale'],
        sampling: data['sampler'],
        noiseSchedule: data['noise_schedule'],
        steps: data['steps'],
        uc: data['uc'],
        vibes: [],
        normalizeStrength: data['normalize_reference_strength_multiple'],
        varietyPlus: data['skip_cfg_above_sigma'] ? true : false,
        characterReferences: [],
        backend: { type: 'NAI' },
        useCoords: data['v4_prompt']['use_coords'],
        legacyPromptConditioning: data['v4_negative_prompt']['legacy_uc'],
        characterPrompts: characterPrompts,
      };
    }
  }
  return undefined;
}

export function assert(condition: any, message?: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
