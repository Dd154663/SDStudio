/**
 * 부스트 모드 B0(2026-10-29) — 생성 핸들러의 시드 커서·결과 파일명.
 * - 고정 시드: 요청 시드 = seedForImageIndex(job.seed, task.seedCursor), 성공 때만 커서 +1, job.seed 불변
 * - 생성 실패·폐기(바깥 타임아웃)는 커서 미전진 → 다음 시도가 같은 시드(예전 계약 그대로)
 * - 랜덤(undefined)·0 시드는 연쇄하지 않음
 * - 같은 ms 에 연달아 생성해도 결과 경로가 겹치지 않음
 */
const getConfig = jest.fn(async () => ({}));
const generateImage = jest.fn(async (_arg: any) => {});
const deleteFile = jest.fn(async (_p: string) => {});
const onAddImage = jest.fn();

jest.mock('..', () => ({
  backend: {
    getConfig,
    generateImage,
    deleteFile,
    delegateComplete: jest.fn(async () => {}),
  },
  imageService: { onAddImage, onAddInPaint: jest.fn(), removeImageReference: jest.fn() },
  isMobile: false,
  localAIService: {},
  loginService: {},
  opusUsageService: {
    refresh: jest.fn(async () => undefined),
    takeLowWarning: jest.fn(() => false),
    takePurchasedNotice: jest.fn(() => false),
    needsPaidConfirm: jest.fn(() => false),
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
import { taskHandlers } from '../TaskHandlers';
import { stepSeed } from '../seedSchedule';

function genTask(seed: number | undefined) {
  return {
    params: {
      session: { name: 'project' },
      scene: {
        name: 'scene',
        type: 'scene',
        resolution: Resolution.Custom,
        resolutionWidth: 832,
        resolutionHeight: 1216,
      },
      outputPath: 'outs/project/scene',
      nodelay: false,
      generationSnapshot: {
        schemaVersion: 1,
        modelVersion: ModelVersion.V4_5,
        furryMode: false,
        disableQuality: true,
        ucPreset: 'none',
        autoConvertWebp: false,
        autoConvertWebpQuality: 80,
      },
      job: {
        type: 'sd',
        cfgRescale: 0,
        steps: 28,
        promptGuidance: 5,
        prompt: { type: 'text', text: 'girl' },
        sampling: 'k_euler_ancestral',
        uc: '',
        characterPrompts: [],
        useCoords: false,
        legacyPromptConditioning: false,
        normalizeStrength: true,
        varietyPlus: false,
        noiseSchedule: 'karras',
        characterReferences: [],
        backend: { type: 'NAI' },
        vibes: [],
        seed,
      },
    },
    done: 0,
    total: 10,
  } as any;
}

const handler = () => taskHandlers.find((h) => h.checkTask(genTask(1)))!;
const sentSeeds = () => generateImage.mock.calls.map((c) => c[0].seed);

beforeEach(() => {
  jest.clearAllMocks();
});

test('고정 시드: 성공마다 다음 연쇄 시드, job.seed 는 그대로', async () => {
  const task = genTask(1000);
  for (let i = 0; i < 3; i++) await handler().handleTask(task, { stopped: false });
  expect(sentSeeds()).toEqual([1000, stepSeed(1000), stepSeed(stepSeed(1000))]);
  expect(task.params.job.seed).toBe(1000);
  expect(task.seedCursor).toBe(3);
  expect(onAddImage).toHaveBeenCalledTimes(3);
});

test('생성 실패면 커서 미전진 — 재시도가 같은 시드', async () => {
  const task = genTask(1000);
  generateImage.mockRejectedValueOnce(new Error('500'));
  await expect(handler().handleTask(task, { stopped: false })).rejects.toThrow('500');
  await handler().handleTask(task, { stopped: false });
  await handler().handleTask(task, { stopped: false });
  expect(sentSeeds()).toEqual([1000, 1000, stepSeed(1000)]);
  expect(task.seedCursor).toBe(2);
});

test('폐기된 시도(바깥 타임아웃)는 파일을 지우고 커서 미전진', async () => {
  const task = genTask(1000);
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
  await expect(handler().handleTask(task, { stopped: false }, ctx)).rejects.toBeTruthy();
  expect(deleteFile).toHaveBeenCalled();
  expect(onAddImage).not.toHaveBeenCalled();
  expect(task.seedCursor ?? 0).toBe(0);
  await handler().handleTask(task, { stopped: false });
  expect(sentSeeds()).toEqual([1000, 1000]);
});

test('랜덤(undefined)·0 시드는 연쇄하지 않는다', async () => {
  const random = genTask(undefined);
  await handler().handleTask(random, { stopped: false });
  await handler().handleTask(random, { stopped: false });
  const zero = genTask(0);
  await handler().handleTask(zero, { stopped: false });
  await handler().handleTask(zero, { stopped: false });
  expect(sentSeeds()).toEqual([undefined, undefined, 0, 0]);
  expect(random.seedCursor ?? 0).toBe(0);
  expect(zero.seedCursor ?? 0).toBe(0);
});

test('같은 ms 에 연달아 생성해도 결과 경로가 겹치지 않는다(숫자.png)', async () => {
  const spy = jest.spyOn(Date, 'now').mockReturnValue(9_000_000_000_000);
  try {
    const task = genTask(undefined);
    for (let i = 0; i < 3; i++) await handler().handleTask(task, { stopped: false });
  } finally {
    spy.mockRestore();
  }
  const paths = generateImage.mock.calls.map((c) => c[0].outputFilePath as string);
  expect(new Set(paths).size).toBe(3);
  for (const p of paths) expect(p).toMatch(/^outs\/project\/scene\/\d+\.png$/);
});
