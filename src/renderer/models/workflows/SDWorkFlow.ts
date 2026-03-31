import { NoiseSchedule, Sampling } from '../../backends/imageGen';
import {
  WFDefBuilder,
  wfiGroup,
  wfiInlineInput,
  wfiMiddlePlaceholderInput,
  wfiPresetSelect,
  wfiProfilePresetSelect,
  wfiPush,
  wfiStack,
  WFVarBuilder,
} from './WorkFlow';
import {
  Session,
  GenericScene,
  SDJob,
  Scene,
  SDAbstractJob,
  PromptNode,
  SDInpaintJob,
  SDI2IJob,
  CharacterPrompt,
} from '../types';
import {
  createSDCharacterPrompts,
  createSDPrompts,
  defaultBPrompt,
  defaultFPrompt,
  defaultUC,
  lowerPromptNode,
} from '../PromptService';
import { imageService, promptService, taskQueueService, workFlowService } from '..';
import { TaskParam } from '../TaskQueueService';
import { dataUriToBase64 } from '../ImageService';

const SDImageGenPreset = new WFVarBuilder()
  .addIntVar('cfgRescale', 0, 1, 0.01, 0)
  .addIntVar('steps', 1, 50, 1, 28)
  .addIntVar('promptGuidance', 0, 10, 0.1, 5)
  .addSamplingVar('sampling', Sampling.KEulerAncestral)
  .addPromptVar('frontPrompt', defaultFPrompt)
  .addPromptVar('backPrompt', defaultBPrompt)
  .addPromptVar('uc', defaultUC)
  .addNoiseScheduleVar('noiseSchedule', NoiseSchedule.Karras)
  .addCharacterPromptsVar('characterPrompts', [])
  .addBoolVar('useCoords', false)
  .addBoolVar('legacyPromptConditioning', false)
  .addBoolVar('varietyPlus', false);

const SDImageGenShared = new WFVarBuilder()
  .addVibeSetVar('vibes')
  .addBoolVar('normalizeStrength', true)
  .addNullIntVar('seed')
  .addCharacterReferenceVar('characterReferences');

const SDImageGenUI = wfiStack([
  wfiPresetSelect(),
  wfiInlineInput('상위 프롬프트', 'frontPrompt', 'preset', 'flex-1'),
  wfiMiddlePlaceholderInput('중간 프롬프트 (이 씬에만 적용됨)'),
  wfiInlineInput('하위 프롬프트', 'backPrompt', 'preset', 'flex-1'),
  wfiInlineInput('네거티브 프롬프트', 'uc', 'preset', 'flex-1'),
  wfiInlineInput('시드', 'seed', 'shared', 'flex-none'),
  wfiInlineInput('캐릭터 프롬프트', 'characterPrompts', 'preset', 'flex-none'),
  wfiGroup('샘플링 설정', [
    wfiPush('top'),
    wfiInlineInput('스탭 수', 'steps', 'preset', 'flex-none'),
    wfiInlineInput(
      '프롬프트 가이던스',
      'promptGuidance',
      'preset',
      'flex-none',
    ),
    wfiInlineInput('샘플링', 'sampling', 'preset', 'flex-none'),
    wfiInlineInput('노이즈 스케줄', 'noiseSchedule', 'preset', 'flex-none'),
    wfiInlineInput('CFG 리스케일', 'cfgRescale', 'preset', 'flex-none'),
    wfiInlineInput('캐릭터 위치 지정', 'useCoords', 'preset', 'flex-none'),
    wfiInlineInput(
      'Legacy Prompt Conditioning 모드',
      'legacyPromptConditioning',
      'preset',
      'flex-none',
    ),
    wfiInlineInput(
      '바이브 강도 정규화',
      'normalizeStrength',
      'shared',
      'flex-none',
    ),
    wfiInlineInput('Variety+', 'varietyPlus', 'preset', 'flex-none'),
  ]),
  wfiInlineInput('바이브 설정', 'vibes', 'shared', 'flex-none'),
  wfiInlineInput('캐릭터 레퍼런스', 'characterReferences', 'shared', 'flex-none'),
]);

const SDImageGenEasyPreset = new WFVarBuilder()
  .addIntVar('cfgRescale', 0, 1, 0.01, 0)
  .addIntVar('steps', 1, 50, 1, 28)
  .addIntVar('promptGuidance', 0, 10, 0.1, 5)
  .addSamplingVar('sampling', Sampling.KEulerAncestral)
  .addPromptVar('frontPrompt', defaultFPrompt)
  .addPromptVar('backPrompt', defaultBPrompt)
  .addPromptVar('uc', defaultUC)
  .addNoiseScheduleVar('noiseSchedule', NoiseSchedule.Karras)
  .addBoolVar('useCoords', false)
  .addBoolVar('legacyPromptConditioning', false)
  .addBoolVar('varietyPlus', false);

const SDImageGenEasyShared = SDImageGenShared.clone()
  .addPromptVar('characterPrompt', '')
  .addPromptVar('backgroundPrompt', '')
  .addPromptVar('uc', '')
  .addCharacterPromptsVar('characterPrompts', []);

const SDImageGenEasyUI = wfiStack([
  wfiProfilePresetSelect(),
  wfiInlineInput('캐릭터 관련 태그', 'characterPrompt', 'shared', 'flex-1'),
  wfiMiddlePlaceholderInput('중간 프롬프트 (이 씬에만 적용됨)'),
  wfiInlineInput('배경 관련 태그', 'backgroundPrompt', 'shared', 'flex-1'),
  wfiInlineInput('태그 밴 리스트', 'uc', 'shared', 'flex-1'),
  wfiInlineInput('시드', 'seed', 'shared', 'flex-none'),
  wfiInlineInput('캐릭터 프롬프트', 'characterPrompts', 'shared', 'flex-none'),
  wfiInlineInput('바이브 설정', 'vibes', 'shared', 'flex-none'),
  wfiInlineInput('캐릭터 레퍼런스', 'characterReferences', 'shared', 'flex-none'),
]);

const SDImageGenEasyInnerUI = wfiStack([
  wfiInlineInput('상위 프롬프트', 'frontPrompt', 'preset', 'flex-1'),
  wfiMiddlePlaceholderInput('중간 프롬프트 (이 창에만 적용됨)'),
  wfiInlineInput('하위 프롬프트', 'backPrompt', 'preset', 'flex-1'),
  wfiInlineInput('네거티브 프롬프트', 'uc', 'preset', 'flex-1'),
  wfiGroup('샘플링 설정', [
    wfiPush('top'),
    wfiInlineInput('스탭 수', 'steps', 'preset', 'flex-none'),
    wfiInlineInput(
      '프롬프트 가이던스',
      'promptGuidance',
      'preset',
      'flex-none',
    ),
    wfiInlineInput('샘플링', 'sampling', 'preset', 'flex-none'),
    wfiInlineInput('노이즈 스케줄', 'noiseSchedule', 'preset', 'flex-none'),
    wfiInlineInput('CFG 리스케일', 'cfgRescale', 'preset', 'flex-none'),
    wfiInlineInput('캐릭터 위치 지정', 'useCoords', 'preset', 'flex-none'),
    wfiInlineInput(
      'Legacy Prompt Conditioning 모드',
      'legacyPromptConditioning',
      'preset',
      'flex-none',
    ),
    wfiInlineInput(
      '바이브 강도 정규화',
      'normalizeStrength',
      'shared',
      'flex-none',
    ),
    wfiInlineInput('Variety+', 'varietyPlus', 'preset', 'flex-none'),
  ]),
]);

const SDImageGenHandler = async (
  session: Session,
  scene: GenericScene,
  prompt: PromptNode,
  characterPrompts: PromptNode[],
  preset: any,
  shared: any,
  samples: number,
  meta?: any,
  onComplete?: (img: string) => void,
  nodelay?: boolean,
) => {
  // 씬 전용 캐릭터 프롬프트 사용 여부 확인
  const sceneObj = scene as Scene;
  const useSceneCharacterPrompts = sceneObj.useSceneCharacterPrompts &&
    sceneObj.sceneCharacterPrompts &&
    sceneObj.sceneCharacterPrompts.length > 0;

  // 활성화된 캐릭터 프롬프트만 필터링
  let allCharacterPrompts: CharacterPrompt[];
  let finalCharacterPrompts: PromptNode[];
  
  if (useSceneCharacterPrompts) {
    // 씬 전용 캐릭터 프롬프트 사용
    allCharacterPrompts = sceneObj.sceneCharacterPrompts || [];
    // 씬 전용 캐릭터 프롬프트는 이미 prompt 필드에 텍스트가 있으므로 PromptNode로 변환
    finalCharacterPrompts = allCharacterPrompts.map(cp => ({ type: 'text', text: cp.prompt } as PromptNode));
  } else {
    // 기존 공유/프리셋 캐릭터 프롬프트 사용
    allCharacterPrompts = shared.type === 'SDImageGenEasy'
      ? shared.characterPrompts
      : preset.characterPrompts;
    finalCharacterPrompts = characterPrompts;
  }
  
  const enabledCharacterPrompts = (allCharacterPrompts || [])
    .map((p: CharacterPrompt, i: number) => ({ original: p, index: i }))
    .filter(({ original }: { original: CharacterPrompt }) => original.enabled !== false);

  const job: SDJob = {
    type: 'sd',
    cfgRescale: preset.cfgRescale,
    steps: preset.steps,
    promptGuidance: preset.promptGuidance,
    prompt: prompt,
    sampling: preset.sampling,
    uc: preset.uc,
    characterPrompts: enabledCharacterPrompts.map(({ original, index }: { original: CharacterPrompt, index: number }) => ({
      ...original,
      prompt: finalCharacterPrompts[index],
    })),
    useCoords: preset.useCoords,
    legacyPromptConditioning: preset.legacyPromptConditioning,
    normalizeStrength: shared.normalizeStrength,
    varietyPlus: preset.varietyPlus,
    characterReferences: (shared.characterReferences || []).filter((ref: any) => ref.enabled !== false),
    noiseSchedule: preset.noiseSchedule,
    backend: preset.backend,
    vibes: shared.vibes,
    seed: shared.seed,
  };
  
  // 씬 전용 캐릭터 UC 추가
  if (useSceneCharacterPrompts && sceneObj.sceneCharacterUC) {
    job.uc = job.uc + ', ' + sceneObj.sceneCharacterUC;
  }
  
  if (shared.type === 'SDImageGenEasy') {
    job.uc = shared.uc + ', ' + preset.uc;
  }
  const param: TaskParam = {
    session: session,
    job: job,
    scene: scene,
    nodelay: nodelay,
    outputPath: imageService.getOutputDir(session, scene),
    onComplete: onComplete,
  };
  taskQueueService.addTask(param, samples);
};

const SDCreatePrompt = async (
  session: Session,
  scene: GenericScene,
  preset: any,
  shared: any,
) => {
  return await createSDPrompts(session, preset, shared, scene as Scene);
};

const SDCreateCharacterPrompts = async (
  session: Session,
  scene: GenericScene,
  preset: any,
  shared: any,
) => {
  return await createSDCharacterPrompts(
    session,
    preset,
    shared,
    scene as Scene,
  );
};

export const SDImageGenDef = new WFDefBuilder('SDImageGen')
  .setTitle('이미지 생성')
  .setBackendType('image')
  .setI2I(false)
  .setPresetVars(SDImageGenPreset.build())
  .setSharedVars(SDImageGenShared.build())
  .setEditor(SDImageGenUI)
  .setHandler(SDImageGenHandler)
  .setCreatePrompt(SDCreatePrompt)
  .setCreateCharacterPrompts(SDCreateCharacterPrompts)
  .build();

export const SDImageGenEasyDef = new WFDefBuilder('SDImageGenEasy')
  .setTitle('이미지 생성 (이지모드)')
  .setBackendType('image')
  .setI2I(false)
  .setPresetVars(SDImageGenEasyPreset.build())
  .setSharedVars(SDImageGenEasyShared.build())
  .setEditor(SDImageGenEasyUI)
  .setInnerEditor(SDImageGenEasyInnerUI)
  .setHandler(SDImageGenHandler)
  .setCreatePrompt(SDCreatePrompt)
  .setCreateCharacterPrompts(SDCreateCharacterPrompts)
  .build();

const SDInpaintPreset = new WFVarBuilder()
  .addImageVar('image')
  .addImageVar('mask')
  .addIntVar('strength', 0, 1, 0.01, 1)
  .addIntVar('cfgRescale', 0, 1, 0.01, 0)
  .addIntVar('steps', 1, 50, 1, 28)
  .addIntVar('promptGuidance', 0, 10, 0.1, 5)
  .addBoolVar('originalImage', true)
  .addSamplingVar('sampling', Sampling.KEulerAncestral)
  .addPromptVar('prompt', '')
  .addPromptVar('uc', '')
  .addNoiseScheduleVar('noiseSchedule', NoiseSchedule.Karras)
  .addCharacterPromptsVar('characterPrompts', [])
  .addBoolVar('useCoords', false)
  .addBoolVar('legacyPromptConditioning', false)
  .addBoolVar('normalizeStrength', true)
  .addBoolVar('varietyPlus', false)
  .addVibeSetVar('vibes')
  .addNullIntVar('seed');

const SDInpaintUI = wfiStack([
  wfiInlineInput('이미지', 'image', 'preset', 'flex-none'),
  wfiInlineInput('인페인트 강도', 'strength', 'preset', 'flex-none'),
  wfiInlineInput(
    '비마스크 영역 편집 방지',
    'originalImage',
    'preset',
    'flex-none',
  ),
  wfiInlineInput('프롬프트', 'prompt', 'preset', 'flex-1'),
  wfiInlineInput('네거티브 프롬프트', 'uc', 'preset', 'flex-1'),
  wfiInlineInput('캐릭터 프롬프트', 'characterPrompts', 'preset', 'flex-none'),
  wfiGroup('샘플링 설정', [
    wfiPush('top'),
    wfiInlineInput('스탭 수', 'steps', 'preset', 'flex-none'),
    wfiInlineInput(
      '프롬프트 가이던스',
      'promptGuidance',
      'preset',
      'flex-none',
    ),
    wfiInlineInput('샘플링', 'sampling', 'preset', 'flex-none'),
    wfiInlineInput('노이즈 스케줄', 'noiseSchedule', 'preset', 'flex-none'),
    wfiInlineInput('CFG 리스케일', 'cfgRescale', 'preset', 'flex-none'),
    wfiInlineInput('캐릭터 위치 지정', 'useCoords', 'preset', 'flex-none'),
    wfiInlineInput(
      'Legacy Prompt Conditioning 모드',
      'legacyPromptConditioning',
      'preset',
      'flex-none',
    ),
    wfiInlineInput(
      '바이브 강도 정규화',
      'normalizeStrength',
      'preset',
      'flex-none',
    ),
    wfiInlineInput('Variety+', 'varietyPlus', 'preset', 'flex-none'),
  ]),
  wfiInlineInput('바이브 설정', 'vibes', 'preset', 'flex-none'),
  // wfiInlineInput('시드', 'seed', true, 'flex-none'),
]);

const createSDI2IHandler = (type: string) => {
  const handler = async (
    session: Session,
    scene: GenericScene,
    prompt: PromptNode,
    characterPrompts: PromptNode[],
    preset: any,
    shared: any,
    samples: number,
    meta?: any,
    onComplete?: (img: string) => void,
  ) => {
    const image = preset.image.endsWith('.png')
      ? dataUriToBase64(
          (await imageService.fetchVibeImage(session, preset.image))!,
        )
      : preset.image;
    const isInpaint = type === 'SDInpaint';
    const getMask = async () =>
      dataUriToBase64(
        (await imageService.fetchVibeImage(session, preset.mask))!,
      );
    const job: SDInpaintJob | SDI2IJob = {
      type: isInpaint ? 'sd_inpaint' : 'sd_i2i',
      cfgRescale: preset.cfgRescale,
      steps: preset.steps,
      promptGuidance: preset.promptGuidance,
      prompt: { type: 'text', text: preset.prompt },
      sampling: preset.sampling,
      uc: preset.uc,
      characterPrompts: (preset.characterPrompts || []).map((p: CharacterPrompt) => ({
        ...p,
        prompt: { type: 'text', text: p.prompt || '' },
      })),
      useCoords: preset.useCoords,
      legacyPromptConditioning: preset.legacyPromptConditioning,
      normalizeStrength: preset.normalizeStrength,
      varietyPlus: preset.varietyPlus,
      noiseSchedule: preset.noiseSchedule,
      characterReferences: preset.characterReferences || [],
      backend: preset.backend,
      vibes: preset.vibes || [],
      strength: preset.strength,
      noise: preset.noise,
      overrideResolution: preset.overrideResolution,
      originalImage: isInpaint ? preset.originalImage : true,
      image: image,
      mask: isInpaint && preset.mask ? await getMask() : '',
    };
    const param: TaskParam = {
      session: session,
      job: job,
      scene: scene,
      outputPath: imageService.getOutputDir(session, scene),
      onComplete: onComplete,
    };
    taskQueueService.addTask(param, samples);
  };
  return handler;
};

export function createInpaintPreset(
  job: SDAbstractJob<string>,
  image?: string,
  mask?: string,
): any {
  const preset = workFlowService.buildPreset('SDInpaint');
  if (image !== undefined) preset.image = image;
  if (mask !== undefined) preset.mask = mask;
  preset.cfgRescale = job.cfgRescale;
  preset.promptGuidance = job.promptGuidance;
  preset.sampling = job.sampling;
  preset.noiseSchedule = job.noiseSchedule;
  preset.prompt = job.prompt;
  preset.uc = job.uc;
  preset.characterPrompts = job.characterPrompts;
  preset.useCoords = job.useCoords;
  preset.legacyPromptConditioning = job.legacyPromptConditioning;
  preset.normalizeStrength = job.normalizeStrength;
  preset.varietyPlus = job.varietyPlus;
  return preset;
}

export const SDInpaintDef = new WFDefBuilder('SDInpaint')
  .setTitle('인페인트')
  .setBackendType('image')
  .setEmoji('🖌️')
  .setI2I(true)
  .setHasMask(true)
  .setPresetVars(SDInpaintPreset.build())
  .setSharedVars(new WFVarBuilder().build())
  .setEditor(SDInpaintUI)
  .setHandler(createSDI2IHandler('SDInpaint'))
  .setCreatePreset(createInpaintPreset)
  .build();

const SDI2IPreset = SDInpaintPreset.clone()
  .addIntVar('noise', 0, 1, 0.01, 0)
  .addStringVar('overrideResolution', '',)
  .addCharacterReferenceVar('characterReferences');

const SDI2IUI = wfiStack([
  wfiInlineInput('이미지', 'image', 'preset', 'flex-none'),
  wfiInlineInput('강도', 'strength', 'preset', 'flex-none'),
  wfiInlineInput('노이즈', 'noise', 'preset', 'flex-none'),
  wfiInlineInput('프롬프트', 'prompt', 'preset', 'flex-1'),
  wfiInlineInput('네거티브 프롬프트', 'uc', 'preset', 'flex-1'),
  wfiInlineInput('캐릭터 프롬프트', 'characterPrompts', 'preset', 'flex-none'),
  wfiGroup('샘플링 설정', [
    wfiPush('top'),
    wfiInlineInput('스탭 수', 'steps', 'preset', 'flex-none'),
    wfiInlineInput(
      '프롬프트 가이던스',
      'promptGuidance',
      'preset',
      'flex-none',
    ),
    wfiInlineInput('샘플링', 'sampling', 'preset', 'flex-none'),
    wfiInlineInput('노이즈 스케줄', 'noiseSchedule', 'preset', 'flex-none'),
    wfiInlineInput('CFG 리스케일', 'cfgRescale', 'preset', 'flex-none'),
    wfiInlineInput('캐릭터 위치 지정', 'useCoords', 'preset', 'flex-none'),
    wfiInlineInput(
      'Legacy Prompt Conditioning 모드',
      'legacyPromptConditioning',
      'preset',
      'flex-none',
    ),
    wfiInlineInput(
      '바이브 강도 정규화',
      'normalizeStrength',
      'preset',
      'flex-none',
    ),
    wfiInlineInput('Variety+', 'varietyPlus', 'preset', 'flex-none'),
  ]),
  wfiInlineInput('바이브 설정', 'vibes', 'preset', 'flex-none'),
  wfiInlineInput('캐릭터 레퍼런스', 'characterReferences', 'preset', 'flex-none'),
  // wfiInlineInput('시드', 'seed', true, 'flex-none'),
]);

export function createI2IPreset(
  job: SDAbstractJob<string>,
  image?: string,
  mask?: string,
): any {
  const preset = workFlowService.buildPreset('SDI2I');
  preset.image = image;
  preset.mask = mask;
  preset.cfgRescale = job.cfgRescale;
  preset.promptGuidance = job.promptGuidance;
  preset.sampling = job.sampling;
  preset.noiseSchedule = job.noiseSchedule;
  preset.prompt = job.prompt;
  preset.uc = job.uc;
  preset.characterPrompts = job.characterPrompts;
  preset.useCoords = job.useCoords;
  preset.legacyPromptConditioning = job.legacyPromptConditioning;
  preset.normalizeStrength = job.normalizeStrength;
  preset.varietyPlus = job.varietyPlus;
  preset.characterPrompts = job.characterPrompts;
  return preset;
}

export const SDI2IDef = new WFDefBuilder('SDI2I')
  .setTitle('이미지 투 이미지')
  .setBackendType('image')
  .setEmoji('🔄')
  .setI2I(true)
  .setPresetVars(SDI2IPreset.build())
  .setSharedVars(new WFVarBuilder().build())
  .setEditor(SDI2IUI)
  .setHandler(createSDI2IHandler('SDI2I'))
  .setCreatePreset(createI2IPreset)
  .build();

// ── SDMirror (캐릭터 미러) ──

const NAI_FREE_PIXEL_LIMIT = 1024 * 1024; // 1,048,576
const MIRROR_MIN_GAP = 32; // 최소 구분선 두께 (px)

// 미러 캔버스 크기 계산 — 갭이 64 정렬 패딩을 흡수하여 좌우 대칭 보장
function computeMirrorDimensions(srcW: number, srcH: number) {
  const canvasWidth = ((srcW * 2 + MIRROR_MIN_GAP + 63) & ~63);
  const canvasHeight = ((srcH + 63) & ~63);
  const actualGap = canvasWidth - srcW * 2; // MIRROR_MIN_GAP ~ MIRROR_MIN_GAP+63
  return { width: canvasWidth, height: canvasHeight, gap: actualGap };
}

function findMaxMirrorScale(
  srcW: number,
  srcH: number,
  maxPixels: number,
): number {
  let lo = 0,
    hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    const sw = Math.floor(srcW * mid);
    const sh = Math.floor(srcH * mid);
    const { width, height } = computeMirrorDimensions(sw, sh);
    if (width * height <= maxPixels) lo = mid;
    else hi = mid;
  }
  return lo;
}

export async function prepareMirrorCanvas(
  sourceBase64: string,
  mode: 'blank' | 'duplicate' = 'blank',
): Promise<{
  canvas: string;
  mask: string;
  width: number;
  height: number;
  downscaled?: boolean;
}> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = 'data:image/png;base64,' + sourceBase64;
  });
  const srcW = img.naturalWidth;
  const srcH = img.naturalHeight;

  // 미러 캔버스 크기 계산 및 무료 한계 초과 시 다운스케일
  const { width: rawMirrorW, height: rawMirrorH } = computeMirrorDimensions(
    srcW,
    srcH,
  );
  let effectiveImg: HTMLImageElement | HTMLCanvasElement = img;
  let effectiveW = srcW;
  let effectiveH = srcH;
  let downscaled = false;

  if (rawMirrorW * rawMirrorH > NAI_FREE_PIXEL_LIMIT) {
    const scale = findMaxMirrorScale(srcW, srcH, NAI_FREE_PIXEL_LIMIT);
    effectiveW = Math.floor(srcW * scale);
    effectiveH = Math.floor(srcH * scale);
    // 최소 크기 보장
    if (effectiveW < 64) effectiveW = 64;
    if (effectiveH < 64) effectiveH = 64;
    // Canvas drawImage (imageSmoothingQuality: 'high' = bicubic)
    const tmpCvs = document.createElement('canvas');
    tmpCvs.width = effectiveW;
    tmpCvs.height = effectiveH;
    const tmpCtx = tmpCvs.getContext('2d')!;
    tmpCtx.imageSmoothingEnabled = true;
    tmpCtx.imageSmoothingQuality = 'high';
    tmpCtx.drawImage(img, 0, 0, effectiveW, effectiveH);
    effectiveImg = tmpCvs;
    downscaled = true;
  }

  const {
    width: canvasWidth,
    height: canvasHeight,
    gap: actualGap,
  } = computeMirrorDimensions(effectiveW, effectiveH);

  // 레이아웃: [원본 effectiveW] [갭 actualGap] [인페인트 effectiveW]
  // 좌우가 정확히 동일 크기 — 갭이 항상 정중앙
  const gapStart = effectiveW;
  const inpaintStart = effectiveW + actualGap;

  // 합성 캔버스: 왼쪽=원본(다운스케일), 가운데=검정줄, 오른쪽=흰색
  const cvs = document.createElement('canvas');
  cvs.width = canvasWidth;
  cvs.height = canvasHeight;
  const ctx = cvs.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  ctx.drawImage(effectiveImg, 0, 0, effectiveW, effectiveH);
  if (mode === 'duplicate') {
    ctx.drawImage(effectiveImg, inpaintStart, 0, effectiveW, effectiveH);
  }
  ctx.fillStyle = '#000000';
  ctx.fillRect(gapStart, 0, actualGap, canvasHeight);

  // 마스크 캔버스: 왼쪽+가운데=검정(보존), 오른쪽=흰색(인페인트)
  const maskCvs = document.createElement('canvas');
  maskCvs.width = canvasWidth;
  maskCvs.height = canvasHeight;
  const maskCtx = maskCvs.getContext('2d')!;
  maskCtx.fillStyle = '#000000';
  maskCtx.fillRect(0, 0, canvasWidth, canvasHeight);
  maskCtx.fillStyle = '#ffffff';
  maskCtx.fillRect(inpaintStart, 0, effectiveW, canvasHeight);

  const canvasDataUrl = cvs.toDataURL('image/png');
  const maskDataUrl = maskCvs.toDataURL('image/png');
  const canvasBase64 = canvasDataUrl.replace(/^data:image\/png;base64,/, '');
  const maskBase64 = maskDataUrl.replace(/^data:image\/png;base64,/, '');

  return {
    canvas: canvasBase64,
    mask: maskBase64,
    width: canvasWidth,
    height: canvasHeight,
    downscaled,
  };
}

const SDMirrorPreset = SDInpaintPreset.clone();

const SDMirrorUI = wfiStack([
  wfiInlineInput('인페인트 강도', 'strength', 'preset', 'flex-none'),
  wfiInlineInput(
    '비마스크 영역 편집 방지',
    'originalImage',
    'preset',
    'flex-none',
  ),
  wfiInlineInput('캐릭터 프롬프트', 'characterPrompts', 'preset', 'flex-none'),
  wfiGroup('샘플링 설정', [
    wfiPush('top'),
    wfiInlineInput('스탭 수', 'steps', 'preset', 'flex-none'),
    wfiInlineInput(
      '프롬프트 가이던스',
      'promptGuidance',
      'preset',
      'flex-none',
    ),
    wfiInlineInput('샘플링', 'sampling', 'preset', 'flex-none'),
    wfiInlineInput('노이즈 스케줄', 'noiseSchedule', 'preset', 'flex-none'),
    wfiInlineInput('CFG 리스케일', 'cfgRescale', 'preset', 'flex-none'),
    wfiInlineInput('캐릭터 위치 지정', 'useCoords', 'preset', 'flex-none'),
    wfiInlineInput(
      'Legacy Prompt Conditioning 모드',
      'legacyPromptConditioning',
      'preset',
      'flex-none',
    ),
    wfiInlineInput(
      '바이브 강도 정규화',
      'normalizeStrength',
      'preset',
      'flex-none',
    ),
    wfiInlineInput('Variety+', 'varietyPlus', 'preset', 'flex-none'),
  ]),
  wfiInlineInput('바이브 설정', 'vibes', 'preset', 'flex-none'),
]);

const createMirrorHandler = () => {
  const innerHandler = createSDI2IHandler('SDInpaint');
  const handler = async (
    session: Session,
    scene: GenericScene,
    prompt: PromptNode,
    characterPrompts: PromptNode[],
    preset: any,
    shared: any,
    samples: number,
    meta?: any,
    onComplete?: (img: string) => void,
  ) => {
    let front = '', back = '', globalUc = '';
    if (session.selectedWorkflow) {
      const [, genPreset] = session.getCommonSetup(session.selectedWorkflow);
      if (genPreset) {
        front = genPreset.frontPrompt || '';
        back = genPreset.backPrompt || '';
        globalUc = genPreset.uc || '';
      }
    }
    const combined = [front, preset.prompt, back]
      .filter(Boolean)
      .join(', ');
    // 프롬프트조각 (<그룹.이름>) 치환
    const resolvedPrompt = combined
      .split(',')
      .map((w) => w.trim())
      .filter(Boolean)
      .map((w) => lowerPromptNode(promptService.parseWord(w, session, scene)))
      .join(', ');
    const mergedPreset = { ...preset, prompt: resolvedPrompt, uc: globalUc || preset.uc };
    return innerHandler(
      session, scene, prompt, characterPrompts,
      mergedPreset, shared, samples, meta, onComplete,
    );
  };
  return handler;
};

export function createMirrorPreset(
  job: SDAbstractJob<string>,
  image?: string,
  mask?: string,
): any {
  const preset = workFlowService.buildPreset('SDMirror');
  if (image !== undefined) preset.image = image;
  if (mask !== undefined) preset.mask = mask;
  preset.cfgRescale = job.cfgRescale;
  preset.promptGuidance = job.promptGuidance;
  preset.sampling = job.sampling;
  preset.noiseSchedule = job.noiseSchedule;
  preset.prompt = job.prompt;
  preset.uc = job.uc;
  preset.characterPrompts = job.characterPrompts;
  preset.useCoords = job.useCoords;
  preset.legacyPromptConditioning = job.legacyPromptConditioning;
  preset.normalizeStrength = job.normalizeStrength;
  preset.varietyPlus = job.varietyPlus;
  return preset;
}

export const SDMirrorDef = new WFDefBuilder('SDMirror')
  .setTitle('이미지 미러')
  .setBackendType('image')
  .setEmoji('🪞')
  .setI2I(true)
  .setHasMask(false)
  .setPresetVars(SDMirrorPreset.build())
  .setSharedVars(new WFVarBuilder().build())
  .setEditor(SDMirrorUI)
  .setHandler(createMirrorHandler())
  .setCreatePreset(createMirrorPreset)
  .build();
