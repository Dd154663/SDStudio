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
  UpscaleJob,
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
import { pngPathToWebp, PNG_IMAGE_EXT } from './imageFormats';
import { expandPieces, lowerPromptNode, toPARR } from './PromptService';
import { dataUriToBase64 } from './ImageService';
import { prepareMirrorCanvas } from './workflows/SDWorkFlow';
import { getImageDimensions } from '../componenets/BrushTool';
import {
  FocusedInpaintSpec,
  focusedRequestSize,
  isFocusRectInput,
  remapCharacterCenter,
} from './focusedInpaint';
import {
  composeFocusedResult,
  FocusedRequest,
  prepareFocusedRequest,
} from './focusedInpaintCanvas';
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
  TaskAttemptContext,
  CostItem,
  ImageTaskType,
  Task,
  TaskParam,
  TaskInfo,
} from './TaskQueueService';
import {
  isRequestTimeoutError,
  NAI_MAX_TRIES,
  NaiRequestOptions,
  RequestDelaySettings,
  TASK_FAILURE_TEXT,
  throwIfAborted,
} from './requestTiming';

// 큐 시도 문맥 → backend 요청 옵션(호출별 타임아웃·취소 신호). 문맥이 없으면(구 호출부·테스트)
// 옵션을 넘기지 않아 backend 기본값(120초)을 쓴다.
function requestOptions(ctx?: TaskAttemptContext): NaiRequestOptions | undefined {
  return ctx ? { timeoutMs: ctx.requestTimeoutMs, signal: ctx.signal } : undefined;
}

// 사용자 입력 대기는 큐 바깥 타임아웃 측정에서 뺀다(확인이 끝난 뒤부터 다시 잰다).
function waitForUser<T>(ctx: TaskAttemptContext | undefined, fn: () => Promise<T>): Promise<T> {
  return ctx ? ctx.pauseTimeoutWhile(fn) : fn();
}

// 폐기된 시도(바깥 타임아웃)가 backend 저장 직후에 끝난 경우: 방금 쓴 파일을 지우고 결과를
// 버린다(재시도와 겹친 늦은 결과가 씬에 중복 추가되지 않게).
async function discardIfStale(ctx: TaskAttemptContext | undefined, writtenPath: string) {
  if (!ctx?.signal.aborted) return;
  await backend.deleteFile(writtenPath).catch(() => {});
  throwIfAborted(ctx.signal);
}

// Focused inpainting(SPEC §7) 을 이 작업에 적용할지 — 인페인트 잡에 사각형이 있고 미러 씬이 아닐 때만.
// 미러(SDMirror)는 좌우 합성 캔버스 전체가 요청 단위라 영역 개념이 없다(프리셋 키도 없지만 이중으로 막는다).
export function activeFocusSpec(task: Task): FocusedInpaintSpec | undefined {
  const job = task.params.job as SDInpaintJob;
  if (job?.type !== 'sd_inpaint' || !job.focus) return undefined;
  if ((task.params.scene as InpaintScene | undefined)?.workflowType === 'SDMirror') return undefined;
  return isFocusRectInput(job.focus) ? job.focus : undefined;
}

export const FOCUSED_COMPOSE_FAILED_TEXT =
  'Focused 합성 실패 — 서버 결과 원본을 저장했습니다';

// 생성 완료 처리 (W6 P3). 위임 태스크(호스트에서 실행 중)면 완료를 원 창에 브리지하고
// 호스트 자기 세션은 건드리지 않는다(imageMap 미갱신 → dirty/저장 없음). 로컬 태스크
// (단일 창 포함)는 종전과 동일하게 onComplete + imageMap 갱신을 수행한다.
function finishOrBridgeImage(
  task: Task,
  outputFilePath: string,
  replacedPath?: string,
) {
  if (task.params.delegation) {
    backend
      .delegateComplete({
        ...task.params.delegation,
        status: 'ok',
        path: outputFilePath,
        replacedPath,
      })
      .catch(() => {});
    return;
  }
  if (replacedPath && task.params.scene) {
    imageService.removeImageReference(
      task.params.session,
      task.params.scene,
      replacedPath,
    );
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

// Focused 결과 합성: backend 가 저장한 서버 결과를 읽어 원본에 섞고 같은 경로에 덮어쓴다(원자적 쓰기).
// 실패하면 서버 결과 원본을 그대로 두고 알린다. 폐기된 시도면 쓰지 않고 파일을 지운다(discardIfStale).
async function composeFocusedOutput(
  focused: FocusedRequest,
  originalBase64: string,
  outputFilePath: string,
  ctx?: TaskAttemptContext,
) {
  let composed: string | undefined;
  try {
    const raw = dataUriToBase64(await backend.readDataFile(outputFilePath));
    composed = await composeFocusedResult({
      originalBase64,
      resultPngBase64: raw,
      rect: focused.rect,
      rectMask: focused.rectMask,
    });
  } catch (e: any) {
    if (!ctx?.signal.aborted) {
      console.error('Focused 합성 실패(서버 결과 유지):', e?.message || e);
      appState.pushMessage(FOCUSED_COMPOSE_FAILED_TEXT);
    }
  }
  await discardIfStale(ctx, outputFilePath);
  if (!composed) return;
  try {
    await backend.writeDataFile(outputFilePath, composed);
  } catch (e: any) {
    console.error('Focused 합성 저장 실패(서버 결과 유지):', e?.message || e);
    appState.pushMessage(FOCUSED_COMPOSE_FAILED_TEXT);
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
    delay: RequestDelaySettings,
    pendingCount: number,
    shouldStop: () => boolean,
  ): Promise<void> {
    // 편집기 즉시 생성(fast)도 같은 식, 급등만 없음(2026-10-03 T3). 정지하면 대기를 바로 끝낸다(T4).
    await handleNAIDelay(numTry, this.fast, delay, pendingCount, shouldStop);
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

  async handleTask(task: Task, run: TaskQueueRun, ctx?: TaskAttemptContext) {
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
              requestOptions(ctx),
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
          // 폐기된 시도면 안내 없이 그대로 끝낸다(새 시도가 다시 인코딩한다).
          throwIfAborted(ctx?.signal);
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
      ...(job.sdstudioPromptSource
        ? {
            sdstudioMetadata: {
              schemaVersion: 1 as const,
              promptSource: job.sdstudioPromptSource,
              ...(task.params.generationSnapshot
                ? {
                    generationSettings: {
                      schemaVersion: 1 as const,
                      modelVersion: task.params.generationSnapshot.modelVersion,
                      furryMode: task.params.generationSnapshot.furryMode,
                      disableQuality:
                        task.params.generationSnapshot.disableQuality,
                      qualityPreset:
                        task.params.generationSnapshot.qualityPreset,
                      ucPreset: task.params.generationSnapshot.ucPreset,
                      transparentBackground:
                        task.params.generationSnapshot.transparentBackground,
                    },
                  }
                : {}),
            },
          }
        : {}),
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
    let focused: FocusedRequest | undefined;
    if (this.type === 'inpaint') {
      const inpaintJob = job as SDInpaintJob;
      arg.model = Model.Inpaint;
      arg.image = inpaintJob.image;
      arg.mask = inpaintJob.mask;
      arg.originalImage = inpaintJob.originalImage;
      arg.imageStrength = inpaintJob.strength;
      arg.noise = inpaintJob.noise;
      const focus = activeFocusSpec(task);
      if (focus) {
        // Focused: 사각형을 잘라 ≈1MP 로 키운 이미지·마스크와 그 해상도로 요청한다. 서버는 크롭 맥락까지
        // 다시 그리므로 add_original_image 는 끄고 합성은 아래에서 클라이언트가 한다.
        try {
          focused = await prepareFocusedRequest({
            imageBase64: inpaintJob.image,
            maskBase64: inpaintJob.mask,
            rect: focus,
            context: focus.context,
          });
        } catch (e: any) {
          throwIfAborted(ctx?.signal);
          const err: any = new Error(`Focused 영역 준비 실패: ${e?.message || e}`);
          err.retryable = false; // 같은 입력이면 다시 해도 같은 결과
          throw err;
        }
        const prepared = focused;
        arg.image = prepared.imageBase64;
        arg.mask = prepared.maskBase64;
        arg.resolution = { width: prepared.width, height: prepared.height };
        arg.addOriginalImage = false;
        arg.characterPositions = arg.characterPositions?.map((p) =>
          p
            ? remapCharacterCenter(p, prepared.rect, prepared.imageWidth, prepared.imageHeight)
            : p,
        );
      }
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
        const urgent = usage.opusSubscribed === false || usage.isNegative || usage.percent <= rotateWarning;
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
        !opusUsageService.hasSessionPaidApproval()
      ) {
        const detail = usage?.opusSubscribed === false
          ? '현재 계정은 Opus 무료 할당량 대상이 아닙니다.'
          : usage
          ? `현재 무료 할당량은 ${usage.percent}%입니다.`
          : '현재 무료 할당량을 확인하지 못했습니다.';
        // 폐기된 시도가 확인 창을 띄우지 않게 먼저 확인한다.
        throwIfAborted(ctx?.signal);
        // 확인 창 대기는 타임아웃 측정에서 뺀다(확인이 끝난 뒤부터 다시 잰다).
        const ok = await waitForUser(ctx, () =>
          appState.confirmAsync(
            `${detail}\n이후 생성은 Anlas를 소비할 수 있습니다. ` +
              '서버 상태는 조회 직후에도 달라질 수 있습니다.\n' +
              '계속하면 계정 전환을 포함해 앱을 다시 실행할 때까지 이 확인을 생략합니다.',
            'Anlas 소비 가능성을 이해하고 계속',
            // 생성 도중 비동기로 뜨는 과금 확인 — 다른 칸에서 치던 Enter 로 승인되지 않게 버튼 클릭 필수
            { requireClick: true },
          ),
        );
        if (!ok) {
          taskQueueService.stop();
          throw new Error('Opus 할당량 확인에서 생성을 중단했습니다.');
        }
        opusUsageService.approvePaidRisk();
      }
    }

    // 주 요청 직전: 폐기된 시도면 보내지 않고, 바깥 타임아웃은 여기서부터 다시 잰다
    // (바이브 인코딩·할당량 조회 시간을 빼고 안쪽 요청 타임아웃과 같은 기준에 맞춘다).
    throwIfAborted(ctx?.signal);
    ctx?.restartTimeout();
    const request = requestOptions(ctx);
    if (request) arg.request = request;

    // IP 확인 최적화 - 세션당 한 번만 확인
    try {
      await backend.generateImage(arg);
    } catch (e: any) {
      if (e?.kind === 'quota') {
        // 할당량 오류 뒤에는 `/user/data` 캐시를 건너뛰고 새로 읽는다.
        opusUsageService.refresh(true, { fresh: true }).catch(() => {});
      }
      throw e;
    }
    // 폐기된 시도의 늦은 결과 — 저장된 파일을 지우고 씬에 추가하지 않는다.
    await discardIfStale(ctx, outputFilePath);
    if (focused) {
      await composeFocusedOutput(focused, (job as SDInpaintJob).image, outputFilePath, ctx);
    }
    // 생성 직후 잔량은 캐시를 건너뛰고 새로 읽는다(다음 생성 직전 확인은 이 결과를 재사용).
    if (isV5) opusUsageService.refresh(true, { fresh: true }).catch(() => {});

    if (job.seed) {
      job.seed = stepSeed(job.seed);
    }

    // 자동 WebP 변환(옵트인, 데스크톱+모바일): 저장된 PNG 를 곧바로 WebP 로 재인코딩.
    // 리사이즈 없는 변환이라 NAI stealth 워터마크(알파)도 보존된다. 변환 성공 시에만
    // 원본 PNG 를 삭제하고, 실패하면 PNG 를 그대로 결과로 쓴다(생성물 유실 없음).
    let finalPath = outputFilePath;
    let replacedPath: string | undefined;
    if (config.autoConvertWebp && platform.supportsAutoWebpConvert) {
      const webpPath = pngPathToWebp(outputFilePath);
      // 완성 전 WebP가 listFiles에 노출되지 않도록 이미지 확장자가 아닌 임시명에
      // 인코딩·메타데이터 후처리를 모두 마친 뒤 최종명으로 공개한다.
      const tempWebpPath = webpPath + '.' + v4() + '.tmp';
      let webpPublished = false;
      try {
        await backend.convertToWebp(
          outputFilePath,
          tempWebpPath,
          config.autoConvertWebpQuality ?? 80,
        );
        await backend.renameFile(tempWebpPath, webpPath);
        webpPublished = true;
        try {
          await backend.deleteFile(outputFilePath);
          finalPath = webpPath;
          replacedPath = outputFilePath;
        } catch (e) {
          // PNG 삭제 실패 → 같은 이미지가 2장 보이지 않게 WebP 쪽을 정리하고 PNG 유지
          await backend.deleteFile(webpPath).catch(() => {});
        }
      } catch (e: any) {
        await backend.deleteFile(tempWebpPath).catch(() => {});
        if (webpPublished) await backend.deleteFile(webpPath).catch(() => {});
        console.error('자동 WebP 변환 실패(PNG 유지):', e?.message || e);
      }
    }

    await discardIfStale(ctx, finalPath);
    finishOrBridgeImage(task, finalPath, replacedPath);

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

  // 최대 시도 횟수는 requestTiming 단일 출처(T4 — 40 → 10).
  getNumTries(task: Task) {
    return NAI_MAX_TRIES;
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
    const focus = activeFocusSpec(task);
    if (focus) {
      // Focused 는 실제 요청 해상도(≈1MP 이하)로 판단한다 — 씬 해상도 = 첨부 이미지 크기
      // (R-res 로 보장: 씬 생성·이미지 교체 때 맞춤, 기존 불일치 씬은 편집 창 안내 — SPEC §7-3).
      const image = lowerResolution(
        resolution as Resolution,
        task.params.scene.resolutionWidth,
        task.params.scene.resolutionHeight,
      );
      // 크기를 모르는 씬(Custom 값 없음)은 이미지 경계 없이 사각형만으로 계산한다.
      const size = focusedRequestSize(
        focus,
        image.width || Infinity,
        image.height || Infinity,
      );
      if (size && size.width * size.height > 1024 * 1024) {
        res.push({ scene: name, text: '씬 해상도가 큼' });
      }
      return res;
    }
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
    delay: RequestDelaySettings,
    pendingCount: number,
    shouldStop: () => boolean,
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
    delay: RequestDelaySettings,
    pendingCount: number,
    shouldStop: () => boolean,
  ): Promise<void> {
    await handleNAIDelay(numTry, false, delay, pendingCount, shouldStop);
  }

  async handleTask(task: Task, run: TaskQueueRun, ctx?: TaskAttemptContext) {
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
    throwIfAborted(ctx?.signal);
    ctx?.restartTimeout();
    const request = requestOptions(ctx);
    if (request) params.request = request;
    await backend.augmentImage(params);
    await discardIfStale(ctx, outputFilePath);
    finishOrBridgeImage(task, outputFilePath);
    return true;
  }

  checkTask(task: Task): boolean {
    return (
      task.params.job.type === 'augment' &&
      task.params.job.backend.type === 'NAI'
    );
  }

  // 최대 시도 횟수는 requestTiming 단일 출처(T4 — 40 → 10).
  getNumTries(task: Task) {
    return NAI_MAX_TRIES;
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


class UpscaleTaskHandler implements TaskHandler {
  createTimeEstimator() {
    return new TaskTimeEstimator(TASK_TIME_ESTIMATOR_SAMPLE_COUNT, TASK_DEFAULT_ESTIMATE);
  }

  async handleDelay(
    task: Task,
    numTry: number,
    delay: RequestDelaySettings,
    pendingCount: number,
    shouldStop: () => boolean,
  ) {
    await handleNAIDelay(numTry, false, delay, pendingCount, shouldStop);
  }

  async handleTask(task: Task, run: TaskQueueRun, ctx?: TaskAttemptContext) {
    const job = task.params.job as UpscaleJob;
    const outputFilePath = task.params.outputPath + '/' + v4() + '.' + PNG_IMAGE_EXT;
    const image = job.imagePath
      ? dataUriToBase64(await backend.readDataFile(job.imagePath))
      : job.image;
    throwIfAborted(ctx?.signal);
    ctx?.restartTimeout();
    const request = requestOptions(ctx);
    await backend.upscaleImage({ image, outputFilePath, ...(request ? { request } : {}) });
    await discardIfStale(ctx, outputFilePath);
    finishOrBridgeImage(task, outputFilePath);
    return true;
  }

  checkTask(task: Task) {
    return task.params.job.type === 'upscale' && task.params.job.backend.type === 'NAI';
  }

  // 유료 요청의 응답 유실/저장 실패에 재호출하면 이중 과금될 수 있다.
  getNumTries() { return 1; }

  // 타임아웃이면 서버가 이미 처리해 Anlas 가 소비됐을 수 있다 — 다시 보내지 않는 이유와 확인
  // 방법을 알린다(T4). 그 밖의 실패는 오류 메시지 그대로.
  failureNotice(_task: Task, error: unknown): string | undefined {
    return isRequestTimeoutError(error) ? TASK_FAILURE_TEXT.upscaleTimeout : undefined;
  }

  getInfo(task: Task) {
    return { name: task.params.scene?.name ?? '(none)', emoji: '🔎' };
  }

  calculateCost(task: Task): CostItem[] {
    // 업스케일 진입점에서 비용을 표시한다. 큐 실행 시 같은 안내를 다시 띄우지 않는다.
    // 다른 생성 작업의 유료 설정 확인은 각 핸들러의 기존 정책을 유지한다.
    return [];
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
  new UpscaleTaskHandler(),
];
