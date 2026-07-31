import {
  Model,
  Resolution,
  Sampling,
  ImageGenInput,
  ImageGenService,
  ImageAugmentInput,
  ModelVersion,
  EncodeVibeImageInput,
  LoginValidity,
} from '../imageGen';

import JSZip from 'jszip';
import { Buffer } from 'buffer';

import libsodium_wrappers_sumo_1 from 'libsodium-wrappers-sumo';
import { getImageDimensions } from '../../componenets/BrushTool';
import { backend } from '../../models';
import {
  mergeQualityTags,
  mergeUcPreset,
  ucPresetApiIndex,
} from './naiQualityPresets';

export interface NovelAiFetcher {
  fetchArrayBuffer(url: string, body: any, headers: any): Promise<ArrayBuffer>;
}

export class NovelAiImageGenService implements ImageGenService {
  private configCache: { config: any; timestamp: number } | null = null;
  private readonly CONFIG_CACHE_TTL = 30000; // 30초 캐시

  constructor(fetcher: NovelAiFetcher) {
    this.apiEndpoint = 'https://api.novelai.net';
    this.apiEndpoint2 = 'https://image.novelai.net';
    this.headers = {
      'Content-Type': 'application/json',
    };
    this.fetcher = fetcher;
  }

  private async getCachedConfig() {
    const now = Date.now();
    if (this.configCache && (now - this.configCache.timestamp) < this.CONFIG_CACHE_TTL) {
      return this.configCache.config;
    }
    const config = await backend.getConfig();
    this.configCache = { config, timestamp: now };
    return config;
  }

  public invalidateConfigCache() {
    this.configCache = null;
  }

  private translateModel(model: Model, version: ModelVersion): string {
    const modelMap = {
      anime: `nai-diffusion-${version}`,
      inpaint: `nai-diffusion-${version}-inpainting`,
      i2i: `nai-diffusion-${version}`,
    } as const;
    const resultModel = modelMap[model];

    if (version === ModelVersion.V4Curated && model.match(/anime|i2i/))
      return resultModel + '-preview';
    return resultModel;
  }

  private translateSampling(sampling: Sampling): string {
    const samplingMap = {
      k_euler_ancestral: 'k_euler_ancestral',
      k_euler: 'k_euler',
      k_dpmpp_2s_ancestral: 'k_dpmpp_2s_ancestral',
      k_dpmpp_2m: 'k_dpmpp_2m',
      k_dpmpp_sde: 'k_dpmpp_sde',
      k_dpmpp_2m_sde: 'k_dpmpp_2m_sde',
      ddim_v3: 'ddim_v3',
    } as const;
    return samplingMap[sampling];
  }

  private apiEndpoint: string;
  private apiEndpoint2: string;
  private headers: any;
  private fetcher: NovelAiFetcher;

  private getRandomInt(min: number, max: number): number {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min)) + min;
  }

  public async login(
    email: string,
    password: string,
  ): Promise<{ accessToken: string }> {
    try {
      await libsodium_wrappers_sumo_1.ready;
      const token = (0, libsodium_wrappers_sumo_1.crypto_pwhash)(
        64,
        new Uint8Array(Buffer.from(password)),
        (0, libsodium_wrappers_sumo_1.crypto_generichash)(
          libsodium_wrappers_sumo_1.crypto_pwhash_SALTBYTES,
          password.slice(0, 6) + email + 'novelai_data_access_key',
        ),
        2,
        2e6,
        libsodium_wrappers_sumo_1.crypto_pwhash_ALG_ARGON2ID13,
        'base64',
      ).slice(0, 64);
      const url = this.apiEndpoint;
      const reponse = await fetch(url + '/user/login', {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          key: token,
        }),
      });
      if (!reponse.ok) {
        // 서버가 준 실제 사유를 함께 노출한다. NAI 측 오류/점검 등을 사용자가 바로 알 수 있다.
        // 응답 본문이 JSON이면 message 필드만 뽑아 읽기 쉽게 보여준다.
        let detail = '';
        try {
          const text = await reponse.text();
          try {
            detail = JSON.parse(text)?.message || text;
          } catch (_) {
            detail = text;
          }
        } catch (_) {}
        if (detail) console.error('NAI 로그인 실패:', reponse.status, detail);
        throw new Error(
          'HTTP error:' + reponse.status + (detail ? ' / ' + detail : ''),
        );
      }
      return await reponse.json();
    } catch (error: any) {
      throw new Error(`${error.message}`);
    }
  }

  public async generateImage(authorization: string, params: ImageGenInput) {
    const resolutionValue = params.resolution;
    const samplingValue = this.translateSampling(params.sampling);

    const config = await this.getCachedConfig();

    const modelVersionValue: ModelVersion =
      config.modelVersion ?? ModelVersion.V4_5;
    const modelValue = this.translateModel(params.model, modelVersionValue);

    // NAI 웹 패리티(2026-07-31): 퀄리티 태그/UC 프리셋은 API 필드가 아니라
    // 클라이언트가 텍스트를 병합해야 실제 반영된다(qualityToggle/ucPreset 은
    // 메타데이터 전용). 프롬프트 끝에 퀄리티 태그, 네거티브 앞에 UC 프리셋.
    const finalPrompt = mergeQualityTags(
      params.prompt,
      modelVersionValue,
      config.disableQuality ? false : true,
    );
    const finalUc = mergeUcPreset(params.uc, modelVersionValue, config.ucPreset);

    // 시드 미지정 시 랜덤 — NAI 시드 공간은 32비트 전체(최대 4,294,967,295).
    // 과거 상한 2,100,000,000 은 임의 제한이라 제거(2026-07-25).
    // getRandomInt 는 max 미포함이라 2^32 을 넘겨 4,294,967,295 까지 나온다.
    const seed = params.seed ?? this.getRandomInt(1, 0x100000000);
    let action = undefined;
    switch (params.model) {
      case Model.Anime:
        action = 'generate';
        break;
      case Model.Inpaint:
        action = 'infill';
        break;
      case Model.I2I:
        action = 'img2img';
        break;
    }
    const url = this.apiEndpoint;
    const body: any = {
      input: finalPrompt,
      model: modelValue,
      action: action,
      parameters: {
        params_version: 3,
        width: resolutionValue.width,
        height: resolutionValue.height,
        noise_schedule: params.noiseSchedule,
        controlnet_strength: 1,
        dynamic_thresholding: false,
        scale: params.promptGuidance,
        sampler: samplingValue,
        steps: params.steps,
        noise: params.noise,
        seed: seed,
        n_samples: 1,
        ucPreset: ucPresetApiIndex(modelVersionValue, config.ucPreset),
        negative_prompt: finalUc,
        strength: params.imageStrength,
        qualityToggle: config.disableQuality ? false : true,
        characterPrompts: [],
        use_coords: params.useCoords,
        legacy: false,
        legacy_v3_extend: false,
        prefer_brownian: true,
        autoSmea: false,
        legacy_uc: params.legacyPromptConditioning,
        inpaintImg2ImgStrength: params.imageStrength,
        cfg_rescale: params.cfgRescale,
        add_original_image: params.originalImage ? true : false,
        normalize_reference_strength_multiple:
          params.normalizeStrength ?? false,
        skip_cfg_above_sigma: null,
        v4_prompt: {
          caption: {
            base_caption: finalPrompt,
            char_captions: [],
          },
          use_coords: params.useCoords,
          use_order: true,
        },
        v4_negative_prompt: {
          caption: {
            base_caption: finalUc,
            char_captions: [],
          },
          legacy_uc: params.legacyPromptConditioning,
        },
      },
    };
    if (params.vibes.length) {
      body.parameters.reference_image_multiple = params.vibes.map(
        (v) => v.image,
      );
      body.parameters.reference_strength_multiple = params.vibes.map(
        (v) => v.strength,
      );
      if (params.normalizeStrength && params.vibes.length > 1) {
        const sum = body.parameters.reference_strength_multiple.reduce(
          (acc: number, val: number) => acc + val,
          0,
        );
        body.parameters.reference_strength_multiple =
          body.parameters.reference_strength_multiple.map(
            (val: number) => val / sum,
          );
      }
    }
    // Filter out references with empty or invalid image data to prevent 500 errors
    const validCharacterReferences = params.characterReferences?.filter(
      (ref) => ref.image && ref.image.length > 0,
    );
    if (validCharacterReferences?.length) {
      body.parameters.director_reference_images = [];
      body.parameters.director_reference_descriptions = [];
      body.parameters.director_reference_strength_values = [];
      body.parameters.director_reference_secondary_strength_values = [];
      body.parameters.director_reference_information_extracted = [];
      for (const ref of validCharacterReferences) {
        body.parameters.director_reference_images.push(ref.image);
        body.parameters.director_reference_descriptions.push({
          caption: {
            base_caption: ref.referenceType || 'character',
            char_captions: [],
          },
          legacy_uc: params.legacyPromptConditioning,
        });
        body.parameters.director_reference_strength_values.push(ref.strength ?? 0.6);
        body.parameters.director_reference_secondary_strength_values.push(1 - (ref.fidelity ?? 1));
        body.parameters.director_reference_information_extracted.push(ref.info);
      }
    }
    if (params.image) {
      body.parameters.image = params.image;
    }
    if (params.mask) {
      body.parameters.mask = params.mask;
    }
    if (params.model === Model.Inpaint) {
      body.parameters.img2img = {
        strength: params.imageStrength,
        begin_from_sigma: null,
        noise: 0,
        extra_noise_seed: seed,
        color_correct: true,
      };
      if (params.sampling === Sampling.DDIM) {
        body.parameters.sampler = this.translateSampling(
          Sampling.KEulerAncestral,
        );
      }
    }
    if (params.model === Model.I2I) {
      body.parameters.img2img = {
        strength: params.imageStrength,
        begin_from_sigma: null,
        noise: params.noise,
        extra_noise_seed: seed,
        color_correct: true,
      };
    }
    if (params.sampling == Sampling.KEulerAncestral) {
      body.parameters.deliberate_euler_ancestral_bug =
        params.deliberateEulerAncestralBug ?? false;
    }
    // Variety+ (skip_cfg_above_sigma) must be disabled when Precise/Character
    // Reference is used. NAI 공식 사이트는 Char Ref 켜면 Variety+를 UI에서
    // 자동 해제하므로 두 파라미터가 동시 전송되지 않음. SDStudio에서 두
    // 파라미터를 동시에 보내면 서버가 깨진 결과물을 생성함.
    // 참고: DNT-LAB/NAIA_novel_ai_entrypoint 의 _apply_character_reference
    // (params.pop("skip_cfg_above_sigma", None))
    const hasValidCharRef = (validCharacterReferences?.length ?? 0) > 0;
    if (params.varietyPlus && !hasValidCharRef) {
      let sigmaCoef: number;
      switch (config.modelVersion) {
        case ModelVersion.V4_5:
        case ModelVersion.V4_5Curated:
          sigmaCoef = 58;
          break;
        case ModelVersion.V4:
        case ModelVersion.V4Curated:
          sigmaCoef = 19;
          break;
        case undefined:
        default:
          sigmaCoef = 0;
          break;
      }
      const defaultPixels = 832 * 1216;
      const resPixels = resolutionValue.width * resolutionValue.height;
      const pixelRatio = resPixels / defaultPixels;
      body.parameters.skip_cfg_above_sigma = sigmaCoef * pixelRatio ** 0.5;
    } else if (hasValidCharRef) {
      // Belt-and-suspenders: 디폴트가 null이긴 하지만, 혹시 다른 경로에서
      // 값이 주입되어도 여기서 확실히 제거.
      body.parameters.skip_cfg_above_sigma = null;
    }
    if (params.characterPrompts?.length) {
      const center = { x: 0.5, y: 0.5 };
      const charaPos = (index: number) =>
        params.useCoords
          ? (params.characterPositions?.[index] ?? center)
          : center;
      body.parameters.characterPrompts = params.characterPrompts.map(
        (charPrompt, index) => ({
          prompt: charPrompt,
          uc: params.characterUCs?.[index] ?? '',
          center: charaPos(index),
        }),
      );
      body.parameters.v4_prompt.caption.char_captions =
        params.characterPrompts.map((charPrompt, index) => ({
          char_caption: charPrompt,
          centers: [charaPos(index)],
        }));
      body.parameters.v4_negative_prompt.caption.char_captions =
        params.characterUCs?.map((charUC, index) => ({
          char_caption: charUC,
          centers: [charaPos(index)],
        })) ?? [];
    }

    // 디버그 로깅은 개발 환경에서만 활성화 (성능 최적화)
    if (process.env.NODE_ENV === 'development') {
      console.log('NAI Request:', { model: body.model, action: body.action });
    }

    const headers = {
      Authorization: `Bearer ${authorization}`,
      'Content-Type': 'application/json',
    };
    const arrayBuffer = await this.fetcher.fetchArrayBuffer(
      this.apiEndpoint2 + '/ai/generate-image',
      body,
      headers,
    );
    const zip = await JSZip.loadAsync(arrayBuffer);
    const zipEntries = Object.keys(zip.files);
    if (zipEntries.length === 0) {
      throw new Error('No entries found in the ZIP file');
    }

    const imageEntry = zip.file(zipEntries[0])!;
    return await imageEntry.async('base64');
  }

  async getRemainCredits(token: string) {
    // 2026-07 NovelAI 정책 변경: 서드파티 도구의 api.novelai.net 호출을 400 으로
    // 거부("update to the image URL") → 사용자 정보도 image.novelai.net 으로 호출.
    const url = this.apiEndpoint2;
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
    const reponse = await fetch(url + '/user/data', {
      method: 'GET',
      headers: headers,
    });
    if (!reponse.ok) {
      throw new Error('HTTP error:' + reponse.status);
    }
    const res = await reponse.json();
    const steps = res['subscription']['trainingStepsLeft'];
    return steps['fixedTrainingStepsLeft'] + steps['purchasedTrainingSteps'];
  }

  // 토큰이 NovelAI에서 실제로 유효한지 검증한다.
  // 401/403(인증 거부) → 'invalid', 200 → 'valid', 그 외(네트워크/서버 오류) → 'error'.
  async validateToken(token: string): Promise<LoginValidity> {
    if (!token || !token.trim()) return 'invalid';
    try {
      // getRemainCredits 와 동일 사유로 image.novelai.net 사용 (api.novelai.net 은
      // 서드파티에 400 을 반환해 'error' 판정 → 로그인 상태가 영영 갱신되지 않았음)
      const response = await fetch(this.apiEndpoint2 + '/user/data', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (response.ok) return 'valid';
      if (response.status === 401 || response.status === 403) return 'invalid';
      return 'error'; // 5xx 등 일시 오류 → 상태 유지
    } catch (e) {
      return 'error'; // 네트워크 오류 → 상태 유지
    }
  }

  async augmentImage(authorization: string, params: ImageAugmentInput) {
    const url = this.apiEndpoint;
    const { width, height } = await getImageDimensions(params.image);
    const body: any = {
      image: params.image,
      prompt: params.prompt,
      defry: params.weaken,
      req_type: params.method,
      width: width,
      height: height,
    };
    if (params.method !== 'emotion' && params.method !== 'colorize') {
      body.defry = undefined;
      body.prompt = undefined;
    }
    if (params.method === 'emotion') {
      body.prompt = params.emotion! + ';;' + body.prompt;
    }
    // 디버그 로깅은 개발 환경에서만 활성화 (성능 최적화)
    if (process.env.NODE_ENV === 'development') {
      console.log('NAI Augment Request:', { method: params.method });
    }
    const headers = {
      Authorization: `Bearer ${authorization}`,
      'Content-Type': 'application/json',
    };

    const arrayBuffer = await this.fetcher.fetchArrayBuffer(
      this.apiEndpoint2 + '/ai/augment-image',
      body,
      headers,
    );
    const zip = await JSZip.loadAsync(arrayBuffer);
    const zipEntries = Object.keys(zip.files);
    if (zipEntries.length === 0) {
      throw new Error('No entries found in the ZIP file');
    }

    const imageEntry = zip.file(zipEntries[zipEntries.length - 1])!;
    return await imageEntry.async('base64');
  }

  async encodeVibeImage(authorization: string, params: EncodeVibeImageInput) {
    const url = this.apiEndpoint2;
    const config = await this.getCachedConfig();
    const modelValue = this.translateModel(
      Model.Anime,
      config.modelVersion ?? ModelVersion.V4_5,
    );
    const body = {
      image: params.image,
      model: modelValue,
      information_extracted: params.info,
    };
    const headers = {
      Authorization: `Bearer ${authorization}`,
      'Content-Type': 'application/json',
    };

    const arrayBuffer = await this.fetcher.fetchArrayBuffer(
      url + '/ai/encode-vibe',
      body,
      headers,
    );
    return Buffer.from(arrayBuffer).toString('base64');
  }
}
