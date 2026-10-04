/**
 * Focused inpainting 핸들러 연결(2026-10-04 S1) — 요청 해상도·이미지·마스크 교체, add_original_image=false,
 * 캐릭터 좌표 재매핑, 저장 직후 합성·같은 경로 덮어쓰기, 합성 실패 시 원본 유지, 미러 무시,
 * Opus 무료 판정·비용 표시는 실제 요청 해상도, 늦은 결과 폐기 순서.
 */
const getConfig = jest.fn(async () => ({}));
const generateImage = jest.fn(async (_arg: any) => {});
const readDataFile = jest.fn(async (_p: string) => 'data:image/png;base64,SERVER');
const writeDataFile = jest.fn(async (_p: string, _d: string) => {});
const deleteFile = jest.fn(async (_p: string) => {});
const onAddInPaint = jest.fn();
const opusRefresh = jest.fn(async () => ({
  opusSubscribed: true,
  percent: 100,
  isNegative: false,
  timeUntilNextPercent: 0,
}));

jest.mock('..', () => ({
  backend: {
    getConfig,
    generateImage,
    readDataFile,
    writeDataFile,
    deleteFile,
    delegateComplete: jest.fn(async () => {}),
  },
  imageService: { onAddInPaint, onAddImage: jest.fn(), removeImageReference: jest.fn() },
  isMobile: false,
  localAIService: {},
  loginService: {},
  opusUsageService: {
    refresh: opusRefresh,
    takeLowWarning: jest.fn(() => false),
    isPaidRisk: jest.fn(() => false),
    hasSessionPaidApproval: jest.fn(() => true),
  },
  promptService: {},
  sessionService: {},
  taskQueueService: {},
  workFlowService: {},
}));

jest.mock('../AppService', () => ({
  appState: { pushMessage: jest.fn(), pushDialog: jest.fn(), confirmAsync: jest.fn() },
}));

jest.mock('../PersistenceService', () => ({
  persistService: { write: jest.fn(async () => {}) },
}));

jest.mock('../PromptService', () => ({
  expandPieces: jest.fn((uc: string) => uc),
  lowerPromptNode: jest.fn((node: any) => node?.text ?? ''),
  toPARR: jest.fn(),
}));

jest.mock('../ImageService', () => ({
  dataUriToBase64: jest.fn((data: string) => data.split(',')[1]),
}));

jest.mock('../workflows/SDWorkFlow', () => ({
  prepareMirrorCanvas: jest.fn(),
}));

jest.mock('../../componenets/BrushTool', () => ({
  getImageDimensions: jest.fn(),
}));

jest.mock('../focusedInpaintCanvas', () => ({
  prepareFocusedRequest: jest.fn(),
  composeFocusedResult: jest.fn(),
}));

import { ModelVersion, Resolution } from '../../backends/imageGen';
import { activeFocusSpec, FOCUSED_COMPOSE_FAILED_TEXT, taskHandlers } from '../TaskHandlers';
import { composeFocusedResult, prepareFocusedRequest } from '../focusedInpaintCanvas';
import { appState } from '../AppService';

const prepare = prepareFocusedRequest as jest.Mock;
const compose = composeFocusedResult as jest.Mock;
const pushMessage = appState.pushMessage as jest.Mock;

const RECT = { x: 112, y: 304, w: 600, h: 600 };
const RECT_MASK = new Uint8Array(600 * 600);

function inpaintTask({
  focus = { ...RECT, context: 48 } as any,
  workflowType = 'SDInpaint',
  modelVersion = ModelVersion.V4_5,
  width = 832,
  height = 1216,
} = {}) {
  return {
    params: {
      session: { name: 'project' },
      scene: {
        name: 'scene',
        type: 'inpaint',
        workflowType,
        resolution: Resolution.Custom,
        resolutionWidth: width,
        resolutionHeight: height,
      },
      outputPath: 'inpaints/project/scene',
      nodelay: false,
      generationSnapshot: {
        schemaVersion: 1,
        modelVersion,
        furryMode: false,
        disableQuality: true,
        ucPreset: 'none',
        autoConvertWebp: false,
        autoConvertWebpQuality: 80,
      },
      job: {
        type: 'sd_inpaint',
        cfgRescale: 0,
        steps: 28,
        promptGuidance: 5,
        prompt: { type: 'text', text: 'girl' },
        sampling: 'k_euler_ancestral',
        uc: '',
        characterPrompts: [
          { prompt: { type: 'text', text: 'char' }, uc: '', position: { x: 412 / 832, y: 604 / 1216 } },
        ],
        useCoords: true,
        legacyPromptConditioning: false,
        normalizeStrength: true,
        varietyPlus: false,
        noiseSchedule: 'karras',
        characterReferences: [],
        backend: { type: 'NAI' },
        vibes: [],
        strength: 1,
        noise: 0,
        originalImage: true,
        image: 'ORIGINAL',
        mask: 'MASK',
        ...(focus ? { focus } : {}),
      },
    },
  } as any;
}

const handler = () => taskHandlers.find((h) => h.checkTask(inpaintTask()))!;

beforeEach(() => {
  jest.clearAllMocks();
  prepare.mockResolvedValue({
    imageBase64: 'CROP',
    maskBase64: 'CROPMASK',
    width: 1024,
    height: 1024,
    rect: RECT,
    imageWidth: 832,
    imageHeight: 1216,
    rectMask: RECT_MASK,
    fullSizeMask: false,
  });
  compose.mockResolvedValue('COMPOSED');
});

test('Focused: 크롭 이미지·마스크·요청 해상도·add_original_image=false·좌표 재매핑으로 요청한다', async () => {
  const task = inpaintTask();
  await handler().handleTask(task, { stopped: false });
  expect(prepare).toHaveBeenCalledWith({
    imageBase64: 'ORIGINAL',
    maskBase64: 'MASK',
    rect: { ...RECT, context: 48 },
    context: 48,
  });
  const arg = generateImage.mock.calls[0][0];
  expect(arg.image).toBe('CROP');
  expect(arg.mask).toBe('CROPMASK');
  expect(arg.resolution).toEqual({ width: 1024, height: 1024 });
  expect(arg.addOriginalImage).toBe(false);
  expect(arg.characterPositions[0].x).toBeCloseTo(0.5, 6);
  expect(arg.characterPositions[0].y).toBeCloseTo(0.5, 6);
});

test('Focused: 저장 직후 결과를 읽어 합성하고 같은 경로에 덮어쓴 뒤 씬에 추가한다', async () => {
  const task = inpaintTask();
  await handler().handleTask(task, { stopped: false });
  const out = generateImage.mock.calls[0][0].outputFilePath;
  expect(readDataFile).toHaveBeenCalledWith(out);
  expect(compose).toHaveBeenCalledWith({
    originalBase64: 'ORIGINAL',
    resultPngBase64: 'SERVER',
    rect: RECT,
    rectMask: RECT_MASK,
  });
  expect(writeDataFile).toHaveBeenCalledWith(out, 'COMPOSED');
  expect(onAddInPaint).toHaveBeenCalledWith(task.params.session, 'scene', out);
  expect(writeDataFile.mock.invocationCallOrder[0]).toBeLessThan(onAddInPaint.mock.invocationCallOrder[0]);
});

test('합성 실패면 서버 결과 원본을 그대로 두고 알린 뒤 씬에 추가한다', async () => {
  compose.mockRejectedValueOnce(new Error('decode'));
  const task = inpaintTask();
  await handler().handleTask(task, { stopped: false });
  expect(writeDataFile).not.toHaveBeenCalled();
  expect(deleteFile).not.toHaveBeenCalled();
  expect(pushMessage).toHaveBeenCalledWith(FOCUSED_COMPOSE_FAILED_TEXT);
  expect(onAddInPaint).toHaveBeenCalled();
});

test('영역 준비 실패는 재시도하지 않는 오류로 끝나고 요청을 보내지 않는다', async () => {
  prepare.mockRejectedValueOnce(new Error('bad image'));
  await expect(handler().handleTask(inpaintTask(), { stopped: false })).rejects.toMatchObject({
    retryable: false,
  });
  expect(generateImage).not.toHaveBeenCalled();
});

test('폐기된 시도(바깥 타임아웃)는 합성·덮어쓰기 없이 파일을 지운다', async () => {
  const controller = new AbortController();
  generateImage.mockImplementationOnce(async () => {
    controller.abort();
  });
  const ctx: any = {
    signal: controller.signal,
    requestTimeoutMs: 1000,
    restartTimeout: jest.fn(),
    pauseTimeoutWhile: (fn: any) => fn(),
  };
  await expect(handler().handleTask(inpaintTask(), { stopped: false }, ctx)).rejects.toBeTruthy();
  expect(compose).not.toHaveBeenCalled();
  expect(writeDataFile).not.toHaveBeenCalled();
  expect(deleteFile).toHaveBeenCalled();
  expect(onAddInPaint).not.toHaveBeenCalled();
});

test('Focused 꺼짐(잡에 focus 없음)은 기존 인페인트 그대로', async () => {
  await handler().handleTask(inpaintTask({ focus: null as any }), { stopped: false });
  const arg = generateImage.mock.calls[0][0];
  expect(prepare).not.toHaveBeenCalled();
  expect(compose).not.toHaveBeenCalled();
  expect(arg.image).toBe('ORIGINAL');
  expect(arg.resolution).toEqual({ width: 832, height: 1216 });
  expect(arg.addOriginalImage).toBeUndefined();
  expect(arg.originalImage).toBe(true);
});

test('미러 씬은 잡에 focus 가 있어도 무시한다', async () => {
  const task = inpaintTask({ workflowType: 'SDMirror' });
  expect(activeFocusSpec(task)).toBeUndefined();
  await handler().handleTask(task, { stopped: false });
  expect(prepare).not.toHaveBeenCalled();
  expect(generateImage.mock.calls[0][0].image).toBe('ORIGINAL');
});

test('V5 Opus 무료 판정은 Focused 요청 해상도로 한다(원본 2048² 라도 1024² 요청이면 무료 경로)', async () => {
  await handler().handleTask(
    inpaintTask({ modelVersion: ModelVersion.V5, width: 2048, height: 2048 }),
    { stopped: false },
  );
  // 요청 전 판정 호출은 refresh(true) 한 인자(생성 직후 잔량 갱신은 fresh 옵션이 붙는다).
  const precheck = () => opusRefresh.mock.calls.filter((c: any[]) => c.length === 1);
  expect(precheck()).toHaveLength(1);

  opusRefresh.mockClear();
  await handler().handleTask(
    inpaintTask({ modelVersion: ModelVersion.V5, width: 2048, height: 2048, focus: null as any }),
    { stopped: false },
  );
  expect(precheck()).toHaveLength(0);
});

test('비용 표시도 Focused 요청 해상도 기준', () => {
  const big = inpaintTask({ width: 2048, height: 2048 });
  expect(handler().calculateCost(big)).toEqual([]);
  const plain = inpaintTask({ width: 2048, height: 2048, focus: null as any });
  expect(handler().calculateCost(plain)).toEqual([{ scene: 'scene', text: '씬 해상도가 큼' }]);
});
