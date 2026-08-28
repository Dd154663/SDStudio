import { v4 } from 'uuid';
import {
  CharacterReference,
  convertResolution,
  ImageAugmentInput,
  ImageGenInput,
  Model,
  ModelVersion,
  NoiseSchedule,
  Resolution,
  Sampling,
} from '../backends/imageGen';
import { CircularQueue } from '../circularQueue';
import {
  backend,
  imageService,
  isMobile,
  localAIService,
  loginService,
  opusUsageService,
  promptService,
  sessionService,
  taskQueueService,
  workFlowService,
} from '.';
import {
  isOpusFreeEligible,
  isV5ModelVersion,
} from '../backends/genVendors/naiModelCapabilities';
import { appState } from './AppService';
import {
  AbstractJob,
  AugmentJob,
  GenericScene,
  InpaintScene,
  Job,
  PromptNode,
  Scene,
  SDAbstractJob,
  SDI2IJob,
  SDInpaintJob,
  SelectedWorkflow,
  Session,
} from './types';
import { sleep } from './util';
import { platform } from './platform';
import { pngPathToWebp } from './imageFormats';
import { expandPieces, lowerPromptNode, toPARR } from './PromptService';
import { dataUriToBase64 } from './ImageService';
import { prepareMirrorCanvas } from './workflows/SDWorkFlow';
import { getImageDimensions } from '../componenets/BrushTool';
import {
  normalizeTokenRotateBalance,
  normalizeTokenRotateTarget,
  normalizeTokenRotateWarning,
} from './tokenAutoRotation';
import {
  TaskTimeEstimator,
  TASK_DEFAULT_ESTIMATE,
  FAST_TASK_DEFAULT_ESTIMATE,
  FAST_TASK_TIME_ESTIMATOR_SAMPLE_COUNT,
  TASK_TIME_ESTIMATOR_SAMPLE_COUNT,
  lowerResolution,
  stepSeed,
  handleNAIDelay,
} from './TaskQueueService';
import type {
  TaskHandler,
  TaskQueueRun,
  CostItem,
  ImageTaskType,
  Task,
  TaskParam,
  TaskInfo,
} from './TaskQueueService';

// 생성 완료 처리 (W6 P3). 위임 태스크(호스트에서 실행 중)면 완료를 원 창에 브리지하고
// 호스트 자기 세션은 건드리지 않는다(imageMap 미갱신 → dirty/저장 없음). 로컬 태스크
// (단일 창 포함)는 종전과 동일하게 onComplete + imageMap 갱신을 수행한다.
function finishOrBridgeImage(task: Task, outputFilePath: string) {
  if (task.params.delegation) {
    backend
      .delegateComplete({
        ...task.params.delegation,
        status: 'ok',
        path: outputFilePath,
      })
      .catch(() => {});
    return;
  }
  if (task.params.onComplete) task.params.onComplete(outputFilePath);
  if (task.params.scene != null) {
    if (task.params.scene.type === 'inpaint') {
      imageService.onAddInPaint(
        task.params.session,
        task.params.scene.name,
        outputFilePath,
      );
    } else {
      imageService.onAddImage(
        task.params.session,
        task.params.scene.name,
        outputFilePath,
      );
    }
  }
}

class GenerateImageTaskHandler implements TaskHandler {
  type: ImageTaskType;
  fast: boolean;
  constructor(fast: boolean, type: ImageTaskType) {
    this.fast = fast;
    this.type = type;
  }

  createTimeEstimator() {
    if (this.fast)
      return new TaskTimeEstimator(
        FAST_TASK_TIME_ESTIMATOR_SAMPLE_COUNT,
        FAST_TASK_DEFAULT_ESTIMATE,
      );
    else
      return new TaskTimeEstimator(
        TASK_TIME_ESTIMATOR_SAMPLE_COUNT,
        TASK_DEFAULT_ESTIMATE,
      );
  }

  async handleDelay(
    task: Task,
    numTry: number,
    delayTime: number,
  ): Promise<void> {
    await handleNAIDelay(numTry, this.fast, delayTime);
  }

  checkTask(task: Task): boolean {
    if (task.params.job.type === 'sd' && this.type === 'gen') {
      return !!task.params.nodelay == !!this.fast;
    }
    if (task.params.job.type === 'sd_inpaint' && this.type === 'inpaint') {
      return !!task.params.nodelay == !!this.fast;
    }
    if (task.params.job.type === 'sd_i2i' && this.type === 'i2i') {
      return !!task.params.nodelay == !!this.fast;
    }
    return false;
  }

  async handleTask(task: Task, run: TaskQueueRun) {
    const job: SDAbstractJob<PromptNode> = task.params
      .job as SDAbstractJob<PromptNode>;
    const config =
      task.params.generationSnapshot ?? (await backend.getConfig());
    let prompt = lowerPromptNode(job.prompt!);
    console.log('lowered prompt: ' + prompt);
    const outputFilePath =
      task.params.outputPath + '/' + Date.now().toString() + '.png';
    if (prompt === '') {
      prompt = '1girl';
    }
    if (config.furryMode) {
      prompt = 'fur dataset, ' + prompt;
    }

    // 세션이 변경되면 캐시 초기화
    const currentSessionName = task.params.session.name;
    if (run.lastSessionName !== currentSessionName) {
      run.cachedVibes = new Map();
      run.cachedReferences = new Map();
      run.lastSessionName = currentSessionName;
    }

    // 캐시 초기화 (없는 경우)
    if (!run.cachedVibes) run.cachedVibes = new Map();
    if (!run.cachedReferences) run.cachedReferences = new Map();

    // 바이브 이미지 처리 - 캐싱 적용
    const allVibes = await Promise.all(
      job.vibes.map(async (vibe) => {
        const cacheKey = `${vibe.path}:${vibe.info}`;

        // 캐시에서 먼저 확인
        if (run.cachedVibes!.has(cacheKey)) {
          const cached = run.cachedVibes!.get(cacheKey)!;
          return {
            image: cached.image,
            info: vibe.info,
            strength: vibe.strength,
          };
        }

        try {
          // 캐시에 없으면 로딩
          const isEncoded = await imageService.checkEncodedVibeImage(
            task.params.session,
            vibe.path,
            vibe.info,
          );
          if (!isEncoded) {
            await imageService.encodeVibeImage(
              task.params.session,
              vibe.path,
              vibe.info,
            );
          }
          let encoded =
            (await imageService.fetchEncodedVibeImage(
              task.params.session,
              vibe.path,
              vibe.info,
            )) || '';
          encoded = dataUriToBase64(encoded);

          if (!encoded) {
            console.warn(`바이브 이미지 인코딩 실패 (파일 손상 가능): ${vibe.path}`);
            appState.pushMessage(`바이브 이미지를 불러올 수 없습니다 (${vibe.path}). 이미지를 다시 첨부해주세요.`);
            return null;
          }

          // 캐시에 저장
          run.cachedVibes!.set(cacheKey, {
            image: encoded,
            info: vibe.info,
            strength: vibe.strength,
          });

          return {
            image: encoded,
            info: vibe.info,
            strength: vibe.strength,
          };
        } catch (e) {
          console.warn(`바이브 이미지 처리 오류 (${vibe.path}):`, e);
          appState.pushMessage(`바이브 이미지 처리 실패 (${vibe.path}). 이미지를 다시 첨부해주세요.`);
          return null;
        }
      }),
    );
    // 손상된 바이브 제외하고 정상 바이브만 사용
    const vibes = allVibes.filter(
      (v): v is { image: string; info: number; strength: number } =>
        v !== null && !!v.image && v.image.length > 0,
    );

    // 캐릭터 레퍼런스 이미지 처리 - 캐싱 적용
    let references: CharacterReference[] = [];
    if (job.characterReferences?.length) {
      // Filter only enabled references before fetching images
      const enabledReferences = job.characterReferences.filter(
        (ref) => ref.enabled !== false && ref.path,
      );
      const allReferences = await Promise.all(
        enabledReferences.map(async (ref): Promise<CharacterReference | null> => {
          const cacheKey = ref.path;

          // 캐시에서 먼저 확인
          if (run.cachedReferences!.has(cacheKey)) {
            const cached = run.cachedReferences!.get(cacheKey)!;
            return {
              image: cached.image,
              info: ref.info,
              strength: ref.strength ?? 0.6,
              fidelity: ref.fidelity ?? 1.0,
              referenceType: ref.referenceType || 'character',
              description: ref.referenceType || 'character',
            };
          }

          try {
            const imageData = await imageService.fetchReferenceImage(
              task.params.session,
              ref.path,
            );
            if (!imageData) {
              console.warn(`Failed to fetch reference image: ${ref.path}`);
              return null;
            }
            // fetchReferenceImage returns base64 data, but it may have data URI prefix
            const rawBase64 = imageData.includes(',')
              ? dataUriToBase64(imageData)
              : imageData;

            // NAI Precise Reference 스펙: 3채널 RGB(JPEG) 필요.
            // 이미 저장 시점에 JPEG로 저장된 경우 재인코딩해도 사실상 무손실에 가깝고,
            // 기존에 RGBA PNG로 저장된 레거시 레퍼런스도 이 단계에서 변환되어 호환됨.
            // 참고: sunanakgo/NAIS2 processCharacterImage, DNT-LAB/NAIA _letterbox
            const base64Image = await imageService.reencodeReferenceForApi(
              rawBase64,
            );

            // 캐시에 저장
            run.cachedReferences!.set(cacheKey, {
              image: base64Image,
              info: ref.info,
              strength: ref.strength ?? 0.6,
              fidelity: ref.fidelity ?? 1.0,
              referenceType: ref.referenceType || 'character',
              description: ref.referenceType || 'character',
            });

            return {
              image: base64Image,
              info: ref.info,
              strength: ref.strength ?? 0.6,
              fidelity: ref.fidelity ?? 1.0,
              referenceType: ref.referenceType || 'character',
              description: ref.referenceType || 'character',
            };
          } catch (e) {
            console.warn(`Error fetching reference image ${ref.path}:`, e);
            return null;
          }
        }),
      );
      // Filter out references with empty or invalid image data to prevent 500 errors
      references = allReferences.filter(
        (ref): ref is CharacterReference =>
          ref !== null && !!ref.image && ref.image.length > 0,
      );
    }
    const resol = job.overrideResolution
      ? job.overrideResolution
      : (task.params.scene!.resolution as Resolution);

    // 모델 버전에 따른 바이브/캐릭터 레퍼런스 필터링
    const curModelVersion = config.modelVersion ?? ModelVersion.V4_5;
    const isV4 = curModelVersion === ModelVersion.V4 || curModelVersion === ModelVersion.V4Curated;
    const isV4_5 = curModelVersion === ModelVersion.V4_5 || curModelVersion === ModelVersion.V4_5Curated;
    const isV5 = isV5ModelVersion(curModelVersion);

    // V4와 V5는 Precise/Character Reference 미지원 → 저장값은 보존하고 요청에서만 제거
    const finalReferences = isV4 || isV5 ? [] : references;
    // v4.5: 캐릭터 레퍼런스가 있으면 바이브 비활성화
    // V5는 Vibe Transfer 미지원 → 요청에서만 제거
    const finalVibes = isV5 || (isV4_5 && finalReferences.length > 0) ? [] : vibes;

    const arg: ImageGenInput = {
      prompt: prompt,
      uc: expandPieces(job.uc, task.params.session, task.params.scene),
      model: Model.Anime,
      originalImage: true,
      resolution: lowerResolution(
        resol,
        task.params.scene!.resolutionWidth,
        task.params.scene!.resolutionHeight,
      ),
      sampling: job.sampling as Sampling,
      vibes: finalVibes,
      steps: job.steps,
      cfgRescale: job.cfgRescale,
      noiseSchedule: job.noiseSchedule as NoiseSchedule,
      promptGuidance: job.promptGuidance,
      characterPrompts: [],
      characterUCs: [],
      characterPositions: [],
      useCoords: job.useCoords,
      legacyPromptConditioning: job.legacyPromptConditioning,
      normalizeStrength: job.normalizeStrength,
      varietyPlus: job.varietyPlus,
      deliberateEulerAncestralBug: job.deliberateEulerAncestralBug,
      characterReferences: finalReferences,
      outputFilePath: outputFilePath,
      seed: job.seed,
      generationSettings: task.params.generationSnapshot,
    };
    if (job.characterPrompts?.length) {
      for (const character of job.characterPrompts) {
        arg.characterPrompts?.push(lowerPromptNode(character.prompt));
        arg.characterUCs?.push(
          expandPieces(
            character.uc,
            task.params.session,
            task.params.scene,
          ),
        );
        arg.characterPositions?.push(character.position);
      }
    }
    if (this.type === 'inpaint') {
      const inpaintJob = job as SDInpaintJob;
      arg.model = Model.Inpaint;
      arg.image = inpaintJob.image;
      arg.mask = inpaintJob.mask;
      arg.originalImage = inpaintJob.originalImage;
      arg.imageStrength = inpaintJob.strength;
      arg.noise = inpaintJob.noise;
    }
    if (this.type === 'i2i') {
      const i2iJob = job as SDI2IJob;
      arg.model = Model.I2I;
      arg.image = i2iJob.image;
      arg.noise = i2iJob.noise;
      arg.originalImage = true;
      arg.imageStrength = i2iJob.strength;
    }
    if (
      isOpusFreeEligible({
        version: curModelVersion,
        width: arg.resolution.width,
        height: arg.resolution.height,
        steps: Math.min(arg.steps, 50),
        hasCharacterReference: finalReferences.length > 0,
      })
    ) {
      let usage = await opusUsageService.refresh(true);
      const runtimeConfig = await backend.getConfig();
      const rotateWarning = normalizeTokenRotateWarning(
        runtimeConfig.multiTokenRotateWarningPercent,
      );
      const rotateTarget = normalizeTokenRotateTarget(
        runtimeConfig.multiTokenRotateTargetPercent,
        rotateWarning,
      );
      const rotateBalance = normalizeTokenRotateBalance(
        runtimeConfig.multiTokenRotateBalancePercent,
      );
      if (runtimeConfig.multiTokenAutoRotate === true && usage) {
        const urgent = usage.isNegative || usage.percent <= rotateWarning;
        const balance =
          !urgent &&
          runtimeConfig.multiTokenBalanceRotate === true &&
          !usage.isNegative;
        const rotation = urgent
          ? await loginService.tryAutoRotateToken(rotateTarget)
          : balance
            ? await loginService.tryAutoBalanceToken(
                rotateBalance,
                usage.percent,
              )
            : undefined;
        if (rotation?.switched) {
          const reason = urgent ? '저할당량 자동 순회' : '여유 할당량 균형 순회';
          usage = rotation.usage;
          opusUsageService.adoptKnownStatus(rotation.usage);
          appState.pushMessage(
            `${reason}: ${rotation.from.name}에서 ${rotation.to.name}(으)로 전환했습니다. ` +
              `새 토큰의 V5 할당량은 ${rotation.usage.percent}%입니다.`,
          );
          if (!rotation.stateSaved) {
            appState.pushMessage(
              '토큰 전환은 완료됐지만 활성 토큰 상태를 저장하지 못했습니다.',
            );
          }
        } else if (rotation?.reason === 'switch-failed') {
          appState.pushMessage(
            '자동 토큰 전환에 실패해 현재 토큰으로 계속합니다.',
          );
        }
      }
      if (opusUsageService.takeLowWarning(usage, rotateWarning)) {
        appState.pushMessage(
          `Opus V5 무료 할당량이 ${usage!.percent}% 남았습니다. 소진 후에는 Anlas가 소비될 수 있습니다.`,
        );
      }
      if (
        opusUsageService.isPaidRisk(usage) &&
        !opusUsageService.hasRecentPaidApproval()
      ) {
        const detail = usage
          ? `현재 무료 할당량은 ${usage.percent}%입니다.`
          : '현재 무료 할당량을 확인하지 못했습니다.';
        const choice = await appState.pushDialogAsync({
          type: 'select',
          text:
            `${detail}\n이후 생성은 Anlas를 소비할 수 있습니다. ` +
            '서버 상태는 조회 직후에도 달라질 수 있습니다.',
          items: [
            {
              text: 'Anlas 소비 가능성을 이해하고 계속',
              value: 'continue',
            },
          ],
        });
        if (choice !== 'continue') {
          taskQueueService.stop();
          throw new Error('Opus 할당량 확인에서 생성을 중단했습니다.');
        }
        opusUsageService.approvePaidRisk();
      }
    }

    // IP 확인 최적화 - 세션당 한 번만 확인
    try {
      await backend.generateImage(arg);
    } catch (e: any) {
      if (e?.kind === 'quota') {
        opusUsageService.refresh(true).catch(() => {});
      }
      throw e;
    }
    if (isV5) opusUsageService.refresh(true).catch(() => {});

    if (job.seed) {
      job.seed = stepSeed(job.seed);
    }

    // 자동 WebP 변환(옵트인, 데스크톱 전용): 저장된 PNG 를 곧바로 WebP 로 재인코딩.
    // 리사이즈 없는 변환이라 NAI stealth 워터마크(알파)도 보존된다. 변환 성공 시에만
    // 원본 PNG 를 삭제하고, 실패하면 PNG 를 그대로 결과로 쓴다(생성물 유실 없음).
    let finalPath = outputFilePath;
    if (config.autoConvertWebp && platform.supportsAutoWebpConvert) {
      const webpPath = pngPathToWebp(outputFilePath);
      try {
        await backend.convertToWebp(
          outputFilePath,
          webpPath,
          config.autoConvertWebpQuality ?? 80,
        );
        try {
          await backend.deleteFile(outputFilePath);
          finalPath = webpPath;
        } catch (e) {
          // PNG 삭제 실패 → 같은 이미지가 2장 보이지 않게 WebP 쪽을 정리하고 PNG 유지
          await backend.deleteFile(webpPath).catch(() => {});
        }
      } catch (e: any) {
        console.error('자동 WebP 변환 실패(PNG 유지):', e?.message || e);
      }
    }

    finishOrBridgeImage(task, finalPath);

    return true;
  }

  getInfo(task: Task) {
    const title = task.params.scene ? task.params.scene.name : '(none)';
    const emojis = {
      gen: '🎨',
      inpaint: '🖌️',
      i2i: '🔄',
    };
    return {
      name: title,
      emoji: emojis[this.type],
    };
  }

  getNumTries(task: Task) {
    return 40;
  }

  calculateCost(task: Task): CostItem[] {
    const res: CostItem[] = [];
    const job: SDAbstractJob<PromptNode> = task.params
      .job as SDAbstractJob<PromptNode>;
    const name = task.params.scene.name;
    if (job.steps > 28) {
      res.push({
        scene: name,
        text: '스탭 수 28개 초과',
      });
    }
    const resolution = job.overrideResolution
      ? job.overrideResolution
      : task.params.scene.resolution;
    if (
      resolution === Resolution.WallpaperLandscape ||
      resolution === Resolution.LargeLandscape ||
      resolution === Resolution.LargePortrait ||
      resolution === Resolution.LargeSquare ||
      resolution === Resolution.WallpaperPortrait
    ) {
      res.push({
        scene: name,
        text: '씬 해상도가 큼',
      });
    } else if (
      resolution === Resolution.Custom ||
      typeof resolution === 'object'
    ) {
      const totalPixels =
        typeof resolution === 'object'
          ? resolution.width * resolution.height
          : (task.params.scene.resolutionWidth ?? 0) *
            (task.params.scene.resolutionHeight ?? 0);
      if (totalPixels > 1024 * 1024) {
        res.push({
          scene: name,
          text: '씬 해상도가 큼',
        });
      }
    }
    return res;
  }
}

class RemoveBgTaskHandler implements TaskHandler {
  createTimeEstimator() {
    return new TaskTimeEstimator(
      TASK_TIME_ESTIMATOR_SAMPLE_COUNT,
      TASK_DEFAULT_ESTIMATE,
    );
  }

  async handleDelay(
    task: Task,
    numTry: number,
    delayTime: number,
  ): Promise<void> {
    return;
  }

  async handleTask(task: Task, run: TaskQueueRun) {
    const outputFilePath =
      task.params.outputPath + '/' + Date.now().toString() + '.png';
    const job = task.params.job as AugmentJob;
    await localAIService.removeBg(job.image!, outputFilePath);
    finishOrBridgeImage(task, outputFilePath);
    return true;
  }

  checkTask(task: Task): boolean {
    return (
      task.params.job.type === 'augment' &&
      task.params.job.backend.type === 'SD' &&
      task.params.job.method === 'bg-removal'
    );
  }

  getNumTries(task: Task) {
    return 1;
  }

  getInfo(task: Task) {
    const title = task.params.scene ? task.params.scene.name : '(none)';
    return {
      name: title,
      emoji: '🔪',
    };
  }

  calculateCost(task: Task): CostItem[] {
    return [];
  }
}

class AugmentTaskHandler implements TaskHandler {
  createTimeEstimator() {
    return new TaskTimeEstimator(
      TASK_TIME_ESTIMATOR_SAMPLE_COUNT,
      TASK_DEFAULT_ESTIMATE,
    );
  }

  async handleDelay(
    task: Task,
    numTry: number,
    delayTime: number,
  ): Promise<void> {
    await handleNAIDelay(numTry, false, delayTime);
  }

  async handleTask(task: Task, run: TaskQueueRun) {
    const outputFilePath =
      task.params.outputPath + '/' + Date.now().toString() + '.png';
    const job = task.params.job as AugmentJob;
    let prompt = lowerPromptNode(job.prompt!);
    const params: ImageAugmentInput = {
      method: job.method,
      outputFilePath: outputFilePath,
      prompt: prompt,
      emotion: job.emotion,
      weaken: job.weaken,
      image: job.image,
    };
    await backend.augmentImage(params);
    finishOrBridgeImage(task, outputFilePath);
    return true;
  }

  checkTask(task: Task): boolean {
    return (
      task.params.job.type === 'augment' &&
      task.params.job.backend.type === 'NAI'
    );
  }

  getNumTries(task: Task) {
    return 40;
  }

  getInfo(task: Task) {
    const title = task.params.scene ? task.params.scene.name : '(none)';
    return {
      name: title,
      emoji: '🪛',
    };
  }

  calculateCost(task: Task): CostItem[] {
    const res: CostItem[] = [];
    const name = task.params.scene.name;
    const job = task.params.job as AugmentJob;
    if (job.width > 1216 || job.height > 1216) {
      res.push({
        scene: name,
        text: '해상도가 큼',
      });
    }
    if (job.method === 'bg-removal') {
      res.push({
        scene: name,
        text: 'NAI 배경 제거 기능 사용',
      });
    }
    return res;
  }
}


export const taskHandlers = [
  new GenerateImageTaskHandler(false, 'gen'),
  new GenerateImageTaskHandler(true, 'gen'),
  new GenerateImageTaskHandler(false, 'i2i'),
  new GenerateImageTaskHandler(true, 'i2i'),
  new GenerateImageTaskHandler(false, 'inpaint'),
  new GenerateImageTaskHandler(true, 'inpaint'),
  new AugmentTaskHandler(),
  new RemoveBgTaskHandler(),
];
