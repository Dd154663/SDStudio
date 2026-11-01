/**
 * 부스트 모드 B2(2026-11-01) — 실제 생성 핸들러의 부스트 처리.
 * - 대상 판정(supportsWorkerAccount + 정책): 변형 작업 토글, Anlas 작업은 'anlas' 범위만, 정책 없으면 B1 그대로
 * - 다른 계정 워커 + 정책: V5 할당량 요청은 그 토큰으로 생성 직전 재확인(탈락 = 생성하지 않음), 성공 뒤 force 갱신,
 *   'anlas' 범위·V4.5 는 조회 없음, 실제 요청이 대상이 아니면 기본 계정에 넘김, 조회 실패는 재시도 대상 오류
 * - 기본 워커: 부스트가 켜져 있으면 자동 순회를 건너뛴다(D12), 꺼져 있으면 종전
 * - 내부 표식(D8): markName 이 있으면 세션의 그 씬에만 파일명 → 이름, 위임이면 브리지에 이름, 메타(arg)에는 없음
 */
const getConfig = jest.fn(async (): Promise<any> => ({}));
const generateImage = jest.fn(async (_arg: any, _opt?: any) => {});
const getOpusUsageStatusForToken = jest.fn(async (_t: string, _o?: any): Promise<any> => ({}));
const delegateComplete = jest.fn(async (_p: any) => {});
const onAddImage = jest.fn();
const refresh = jest.fn(async (): Promise<any> => undefined);
const tryAutoRotateToken = jest.fn(async () => ({ switched: false, reason: 'no-candidate' }));

jest.mock('..', () => ({
  backend: {
    getConfig,
    generateImage,
    getOpusUsageStatusForToken,
    deleteFile: jest.fn(async () => {}),
    delegateComplete,
    delegateQueueSnapshot: jest.fn(async () => {}),
  },
  imageService: {
    onAddImage,
    onAddInPaint: jest.fn(),
    removeImageReference: jest.fn(),
    checkEncodedVibeImage: jest.fn(async () => true),
    encodeVibeImage: jest.fn(async () => {}),
    fetchEncodedVibeImage: jest.fn(async () => 'data:x;base64,ENC'),
  },
  isMobile: false,
  localAIService: {},
  loginService: { tryAutoRotateToken, tryAutoBalanceToken: jest.fn() },
  opusUsageService: {
    refresh,
    takeLowWarning: jest.fn(() => false),
    takePurchasedNotice: jest.fn(() => false),
    needsPaidConfirm: jest.fn(() => false),
    adoptKnownStatus: jest.fn(),
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
import type { TaskAttemptContext, TaskHandler } from '../TaskQueueService';
import { isWorkerDeclinedError, isWorkerDropError } from '../queueWorkerPool';
import { BOOST_TEXT, BoostWorkerPolicy } from '../boostMode';

function genTask(opts: {
  modelVersion?: ModelVersion;
  type?: 'sd' | 'sd_i2i' | 'sd_inpaint';
  steps?: number;
  width?: number;
  height?: number;
  sceneType?: 'scene' | 'inpaint';
} = {}) {
  const scene: any = {
    name: 'scene',
    type: opts.sceneType ?? 'scene',
    resolution: Resolution.Custom,
    resolutionWidth: opts.width ?? 832,
    resolutionHeight: opts.height ?? 1216,
    imageAccounts: undefined,
  };
  const session: any = {
    name: 'project',
    scenes: new Map([['scene', scene]]),
    inpaints: new Map([['scene', scene]]),
  };
  return {
    id: 'g',
    params: {
      session,
      scene: { ...scene }, // 세션 Map 의 객체와 다른 사본 — 표식은 세션의 것에 남아야 한다
      outputPath: 'outs/project/scene',
      nodelay: false,
      generationSnapshot: {
        schemaVersion: 1,
        modelVersion: opts.modelVersion ?? ModelVersion.V5,
        furryMode: false,
        disableQuality: true,
        ucPreset: 'none',
        autoConvertWebp: false,
        autoConvertWebpQuality: 80,
      },
      job: {
        type: opts.type ?? 'sd',
        cfgRescale: 0,
        steps: opts.steps ?? 28,
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
        seed: 1,
        image: 'IMG',
        mask: 'MASK',
      },
    },
    done: 0,
    total: 10,
  } as any;
}

const OTHER = { id: 'b', name: '계정B', isDefault: false, token: 'tok-secret-b', markName: '계정B' };
const DEFAULT = { id: 'default', name: '메인', isDefault: true, markName: '메인' };

function ctxFor(worker: any, boost?: BoostWorkerPolicy): TaskAttemptContext {
  return {
    attempt: 1,
    signal: new AbortController().signal,
    requestTimeoutMs: 120000,
    pauseTimeoutWhile: (fn) => fn(),
    restartTimeout: jest.fn(),
    imageIndex: 0,
    worker,
    ...(boost ? { boost } : {}),
  };
}

const FREE: BoostWorkerPolicy = { scope: 'free', variantTasks: false };
const handlerFor = (task: any): TaskHandler => taskHandlers.find((h) => h.checkTask(task))!;

const usage = (over: any = {}) => ({
  opusSubscribed: true,
  percent: 40,
  purchasedPercent: 0,
  isNegative: false,
  timeUntilNextPercent: 60,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  getConfig.mockImplementation(async () => ({}));
  getOpusUsageStatusForToken.mockImplementation(async () => usage());
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('대상 판정(supportsWorkerAccount + 정책)', () => {
  test('일반 생성 = 대상, 변형 작업은 토글, 정책 없으면 B1 그대로(비빠른 생성 전부)', () => {
    const gen = genTask();
    const i2i = genTask({ type: 'sd_i2i', sceneType: 'inpaint' });
    const inpaint = genTask({ type: 'sd_inpaint', sceneType: 'inpaint' });
    expect(handlerFor(gen).supportsWorkerAccount!(gen, FREE)).toBe(true);
    expect(handlerFor(i2i).supportsWorkerAccount!(i2i, FREE)).toBe(false);
    expect(handlerFor(inpaint).supportsWorkerAccount!(inpaint, FREE)).toBe(false);
    expect(handlerFor(i2i).supportsWorkerAccount!(i2i, { ...FREE, variantTasks: true })).toBe(true);
    expect(handlerFor(inpaint).supportsWorkerAccount!(inpaint, { ...FREE, variantTasks: true })).toBe(true);
    expect(handlerFor(i2i).supportsWorkerAccount!(i2i)).toBe(true);
  });

  test('Anlas 를 쓰는 작업(큰 해상도·스텝 초과)은 anlas 범위만, V4.5 소형은 무료 범위도 대상', () => {
    const big = genTask({ width: 1536, height: 1536 });
    const steps = genTask({ steps: 40 });
    const v45 = genTask({ modelVersion: ModelVersion.V4_5 });
    const h = handlerFor(big);
    expect(h.supportsWorkerAccount!(big, FREE)).toBe(false);
    expect(h.supportsWorkerAccount!(steps, { scope: 'purchased', variantTasks: false })).toBe(false);
    expect(h.supportsWorkerAccount!(big, { scope: 'anlas', variantTasks: false })).toBe(true);
    expect(h.supportsWorkerAccount!(v45, FREE)).toBe(true);
  });

  test('예약 스냅샷이 없으면 정책의 실행 시 모델로 판정', () => {
    const t = genTask({ steps: 28 });
    delete t.params.generationSnapshot;
    t.params.job.steps = 28;
    const h = handlerFor(t);
    expect(h.supportsWorkerAccount!(t, { ...FREE, fallbackModelVersion: ModelVersion.V5 })).toBe(true);
  });
});

describe('다른 계정 워커 + 정책 — 생성 직전 재확인', () => {
  test('V5 할당량 요청: 그 토큰으로 조회 후 생성, 성공 뒤 force 갱신, 활성 계정 서비스는 건드리지 않음', async () => {
    const task = genTask();
    await handlerFor(task).handleTask(task, { stopped: false }, ctxFor(OTHER, FREE));
    expect(getOpusUsageStatusForToken).toHaveBeenNthCalledWith(1, 'tok-secret-b');
    expect(generateImage).toHaveBeenCalledTimes(1);
    expect(generateImage.mock.calls[0][1]).toEqual({ token: 'tok-secret-b' });
    expect(getOpusUsageStatusForToken).toHaveBeenNthCalledWith(2, 'tok-secret-b', { force: true });
    expect(refresh).not.toHaveBeenCalled();
    expect(tryAutoRotateToken).not.toHaveBeenCalled();
  });

  test('무료 범위에서 무료분 0(추가 충전만) = 탈락 신호, 생성하지 않음 / 추가 충전 범위면 생성', async () => {
    getOpusUsageStatusForToken.mockImplementation(async () => usage({ percent: 0, purchasedPercent: 30 }));
    const task = genTask();
    const err = await handlerFor(task)
      .handleTask(task, { stopped: false }, ctxFor(OTHER, FREE))
      .catch((e) => e);
    expect(isWorkerDropError(err)).toBe(true);
    expect(err.message).toBe(BOOST_TEXT.quotaDropped('계정B', 'free', '이용 가능 30%'));
    expect(generateImage).not.toHaveBeenCalled();
    await handlerFor(task).handleTask(task, { stopped: false }, ctxFor(OTHER, { scope: 'purchased', variantTasks: false }));
    expect(generateImage).toHaveBeenCalledTimes(1);
  });

  test("'anlas' 범위·V4.5 요청은 조회하지 않는다(확인 창도 없음)", async () => {
    const task = genTask();
    await handlerFor(task).handleTask(task, { stopped: false }, ctxFor(OTHER, { scope: 'anlas', variantTasks: false }));
    const v45 = genTask({ modelVersion: ModelVersion.V4_5 });
    await handlerFor(v45).handleTask(v45, { stopped: false }, ctxFor(OTHER, FREE));
    expect(getOpusUsageStatusForToken).not.toHaveBeenCalled();
    expect(generateImage).toHaveBeenCalledTimes(2);
  });

  test('실제 요청이 대상이 아니면(무료 범위·스텝 초과) 기본 계정에 넘긴다', async () => {
    const task = genTask({ steps: 40 });
    const err = await handlerFor(task)
      .handleTask(task, { stopped: false }, ctxFor(OTHER, FREE))
      .catch((e) => e);
    expect(isWorkerDeclinedError(err)).toBe(true);
    expect(generateImage).not.toHaveBeenCalled();
  });

  test('할당량 조회 실패는 재시도 대상 오류(탈락·넘김 아님), 생성하지 않음', async () => {
    getOpusUsageStatusForToken.mockImplementation(async () => {
      throw new Error('network');
    });
    const task = genTask();
    const err = await handlerFor(task)
      .handleTask(task, { stopped: false }, ctxFor(OTHER, FREE))
      .catch((e) => e);
    expect(isWorkerDropError(err)).toBe(false);
    expect(isWorkerDeclinedError(err)).toBe(false);
    expect(err.retryable).toBeUndefined();
    expect(err.message).toContain(BOOST_TEXT.quotaCheckFailed('계정B'));
    expect(generateImage).not.toHaveBeenCalled();
  });
});

describe('기본 워커 — 자동 순회 상호 배타(D12)', () => {
  const low = usage({ percent: 3 });
  test('부스트가 켜져 있으면 저잔량이어도 순회하지 않는다 / 꺼져 있으면 종전대로 순회', async () => {
    refresh.mockImplementation(async () => low);
    getConfig.mockImplementation(async () => ({ multiTokenAutoRotate: true, boostMode: 'split' }));
    const task = genTask();
    await handlerFor(task).handleTask(task, { stopped: false }, ctxFor(DEFAULT));
    expect(tryAutoRotateToken).not.toHaveBeenCalled();
    getConfig.mockImplementation(async () => ({ multiTokenAutoRotate: true }));
    await handlerFor(task).handleTask(task, { stopped: false }, ctxFor(DEFAULT));
    expect(tryAutoRotateToken).toHaveBeenCalledTimes(1);
  });
});

describe('내부 표식(D8)', () => {
  test('markName 이 있으면 세션의 그 씬 객체에 파일명 → 이름, 요청 arg·메타에는 이름·토큰 없음', async () => {
    const task = genTask();
    await handlerFor(task).handleTask(task, { stopped: false }, ctxFor(OTHER, FREE));
    const sessionScene = task.params.session.scenes.get('scene');
    const path = onAddImage.mock.calls[0][2] as string;
    const file = path.split('/').pop()!;
    expect(sessionScene.imageAccounts).toEqual({ [file]: '계정B' });
    const arg = JSON.stringify(generateImage.mock.calls[0][0]);
    expect(arg).not.toContain('계정B');
    expect(arg).not.toContain('tok-secret');
  });

  test('표식 이름이 없으면(부스트 아님) 씬에 아무것도 남기지 않는다', async () => {
    const task = genTask();
    await handlerFor(task).handleTask(task, { stopped: false }, ctxFor({ ...DEFAULT, markName: undefined }));
    expect(task.params.session.scenes.get('scene').imageAccounts).toBeUndefined();
  });

  test('위임 작업은 원 창 브리지에 이름만 싣고 호스트 씬은 건드리지 않는다', async () => {
    const task = genTask();
    task.params.delegation = { originWindowId: 2, taskId: 't', sessionName: 'project', sceneName: 'scene', sceneType: 'scene' };
    await handlerFor(task).handleTask(task, { stopped: false }, ctxFor(OTHER, FREE));
    const payload = delegateComplete.mock.calls[0][0];
    expect(payload.status).toBe('ok');
    expect(payload.accountName).toBe('계정B');
    expect(JSON.stringify(payload)).not.toContain('tok-secret');
    expect(task.params.session.scenes.get('scene').imageAccounts).toBeUndefined();
  });

  test('변형 씬(인페인트)은 세션 inpaints 의 씬에 남긴다', async () => {
    const task = genTask({ type: 'sd_inpaint', sceneType: 'inpaint' });
    await handlerFor(task).handleTask(task, { stopped: false }, ctxFor(OTHER, { ...FREE, variantTasks: true }));
    expect(Object.values(task.params.session.inpaints.get('scene').imageAccounts)).toEqual(['계정B']);
  });
});
