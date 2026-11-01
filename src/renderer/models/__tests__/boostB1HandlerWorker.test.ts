/**
 * 부스트 모드 B1(2026-11-01) — 실제 생성 핸들러의 워커 문맥 처리.
 * - 기본 워커·문맥 없음: backend.generateImage(arg) 한 인자(종전), 할당량 확인 블록 그대로
 * - 다른 계정 워커: generateImage(arg, { token }), 할당량·순회·Anlas 확인·생성 후 갱신 건너뜀, arg 에 토큰 없음
 * - 다른 계정 워커 + V5: 바이브 불러오기·인코딩 생략 / V4.5 미인코딩 바이브: 기본 계정에 넘김(declined)
 * - 장 번호(ctx.imageIndex)로 시드, 시드 커서는 건드리지 않음
 * - 큐 통합(단일 워커): 고정 시드 열이 B0 와 같음(실패 재시도는 같은 시드)
 */
const getConfig = jest.fn(async () => ({}));
const generateImage = jest.fn(async (_arg: any, _opt?: any) => {});
const deleteFile = jest.fn(async (_p: string) => {});
const onAddImage = jest.fn();
const checkEncodedVibeImage = jest.fn(async () => false);
const encodeVibeImage = jest.fn(async () => {});
const fetchEncodedVibeImage = jest.fn(async () => 'data:x;base64,ENC');
const refresh = jest.fn(async () => undefined);

jest.mock('..', () => ({
  backend: {
    getConfig,
    generateImage,
    deleteFile,
    delegateComplete: jest.fn(async () => {}),
    delegateQueueSnapshot: jest.fn(async () => {}),
  },
  imageService: {
    onAddImage,
    onAddInPaint: jest.fn(),
    removeImageReference: jest.fn(),
    checkEncodedVibeImage,
    encodeVibeImage,
    fetchEncodedVibeImage,
  },
  isMobile: false,
  localAIService: {},
  loginService: {},
  opusUsageService: {
    refresh,
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
import { TaskAttemptContext, TaskHandler, TaskQueueService } from '../TaskQueueService';
import { isWorkerDeclinedError } from '../queueWorkerPool';

function genTask(seed: number | undefined, modelVersion = ModelVersion.V4_5, vibes: any[] = []) {
  return {
    id: 'g',
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
        modelVersion,
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
        vibes,
        seed,
      },
    },
    done: 0,
    total: 10,
  } as any;
}

function ctxFor(worker?: TaskAttemptContext['worker'], imageIndex?: number): TaskAttemptContext {
  return {
    attempt: 1,
    signal: new AbortController().signal,
    requestTimeoutMs: 120000,
    pauseTimeoutWhile: (fn) => fn(),
    restartTimeout: jest.fn(),
    ...(imageIndex !== undefined ? { imageIndex } : {}),
    ...(worker ? { worker } : {}),
  };
}

const OTHER = { id: 'b', name: '계정B', isDefault: false, token: 'tok-secret-b' };
const DEFAULT = { id: 'default', name: '기본 계정', isDefault: true };

const handler = (): TaskHandler => taskHandlers.find((h) => h.checkTask(genTask(1)))!;

beforeEach(() => {
  jest.clearAllMocks();
  checkEncodedVibeImage.mockImplementation(async () => false);
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('일반 큐 생성 핸들러만 다른 계정 워커를 받는다(빠른 생성·증강·업스케일·배경 제거는 기본 계정)', () => {
  const find = (job: any, nodelay = false): TaskHandler =>
    taskHandlers.find((h) => h.checkTask({ params: { ...genTask(1).params, job, nodelay } } as any))!;
  const t = genTask(1);
  expect(find({ type: 'sd' }).supportsWorkerAccount?.(t)).toBe(true);
  expect(find({ type: 'sd_i2i' }).supportsWorkerAccount?.(t)).toBe(true);
  expect(find({ type: 'sd_inpaint' }).supportsWorkerAccount?.(t)).toBe(true);
  expect(find({ type: 'sd' }, true).supportsWorkerAccount?.(t)).toBe(false);
  expect(find({ type: 'augment', backend: { type: 'NAI' } }).supportsWorkerAccount).toBeUndefined();
  expect(find({ type: 'upscale', backend: { type: 'NAI' } }).supportsWorkerAccount).toBeUndefined();
  expect(find({ type: 'augment', backend: { type: 'SD' }, method: 'bg-removal' }).supportsWorkerAccount).toBeUndefined();
});

test('기본 워커: generateImage 는 한 인자(종전), V5 무료 대상이면 할당량 확인·생성 후 갱신', async () => {
  const task = genTask(1000, ModelVersion.V5);
  await handler().handleTask(task, { stopped: false }, ctxFor(DEFAULT, 0));
  expect(generateImage).toHaveBeenCalledTimes(1);
  expect(generateImage.mock.calls[0]).toHaveLength(1);
  expect(refresh).toHaveBeenCalled();
});

test('다른 계정 워커: 그 토큰으로 요청하고 활성 계정 할당량 블록·갱신은 건너뜀, arg 에 토큰 없음', async () => {
  const task = genTask(1000, ModelVersion.V5);
  await handler().handleTask(task, { stopped: false }, ctxFor(OTHER, 2));
  expect(generateImage).toHaveBeenCalledTimes(1);
  const [arg, opt] = generateImage.mock.calls[0];
  expect(opt).toEqual({ token: 'tok-secret-b' });
  expect(JSON.stringify(arg)).not.toContain('tok-secret');
  expect(refresh).not.toHaveBeenCalled();
  // 장 번호로 시드, 시드 커서는 건드리지 않는다
  expect(arg.seed).toBe(stepSeed(stepSeed(1000)));
  expect(task.seedCursor).toBeUndefined();
  expect(onAddImage).toHaveBeenCalledTimes(1);
});

test('다른 계정 워커 + V5: 바이브 불러오기·인코딩 자체를 건너뛴다', async () => {
  const task = genTask(1, ModelVersion.V5, [{ path: 'v.png', info: 1, strength: 0.6 }]);
  await handler().handleTask(task, { stopped: false }, ctxFor(OTHER, 0));
  expect(checkEncodedVibeImage).not.toHaveBeenCalled();
  expect(encodeVibeImage).not.toHaveBeenCalled();
  expect(generateImage).toHaveBeenCalledTimes(1);
});

test('다른 계정 워커 + V4.5 미인코딩 바이브: 인코딩하지 않고 기본 계정에 넘기는 신호로 끝낸다', async () => {
  const task = genTask(1, ModelVersion.V4_5, [{ path: 'v.png', info: 1, strength: 0.6 }]);
  const err = await handler()
    .handleTask(task, { stopped: false }, ctxFor(OTHER, 0))
    .catch((e) => e);
  expect(isWorkerDeclinedError(err)).toBe(true);
  expect(encodeVibeImage).not.toHaveBeenCalled();
  expect(generateImage).not.toHaveBeenCalled();
});

test('다른 계정 워커 + 이미 인코딩된 바이브는 파일만 읽어 그대로 생성', async () => {
  checkEncodedVibeImage.mockImplementation(async () => true);
  const task = genTask(1, ModelVersion.V4_5, [{ path: 'v.png', info: 1, strength: 0.6 }]);
  await handler().handleTask(task, { stopped: false }, ctxFor(OTHER, 0));
  expect(encodeVibeImage).not.toHaveBeenCalled();
  expect(generateImage.mock.calls[0][0].vibes).toHaveLength(1);
});

test('기본 워커는 종전대로 미인코딩 바이브를 인코딩한다', async () => {
  const task = genTask(1, ModelVersion.V4_5, [{ path: 'v.png', info: 1, strength: 0.6 }]);
  await handler().handleTask(task, { stopped: false }, ctxFor(DEFAULT, 0));
  expect(encodeVibeImage).toHaveBeenCalledTimes(1);
});

test('큐 통합(단일 워커): 고정 시드 열은 B0 와 같다 — 실패 재시도는 같은 시드, 다음 예약은 자기 시작 시드부터', async () => {
  const service = new TaskQueueService(taskHandlers);
  service.retryWait = jest.fn(async () => true);
  service.longBreakWait = jest.fn(async () => true);
  getConfig.mockImplementation(async () => ({ requestDelayMs: 0, requestDelayJitterMs: 0 }) as any);
  let n = 0;
  generateImage.mockImplementation(async () => {
    n++;
    if (n === 2) throw Object.assign(new Error('server 500'), { status: 500 });
  });
  const a = genTask(1000);
  const b = genTask(7);
  service.addTaskLocal(a.params, 3);
  service.addTaskLocal(b.params, 2);
  await service.runInternal({ stopped: false });
  const seeds = generateImage.mock.calls.map((c) => c[0].seed);
  expect(seeds).toEqual([1000, stepSeed(1000), stepSeed(1000), stepSeed(stepSeed(1000)), 7, stepSeed(7)]);
  // 기본 워커 경로 — 모든 요청이 한 인자
  expect(generateImage.mock.calls.every((c) => c.length === 1)).toBe(true);
  expect(service.queue.isEmpty()).toBe(true);
  const s: any = service;
  if (s.logsSaveTimer) clearTimeout(s.logsSaveTimer);
});
