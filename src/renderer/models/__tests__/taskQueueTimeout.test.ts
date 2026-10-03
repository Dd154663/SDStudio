/**
 * 큐 시도 타임아웃·재시도 대기(2026-10-03 갈래 T2) — 바깥 타임아웃의 abort, 사용자 입력 대기 제외,
 * 타임아웃 실패만 다음 시도 타임아웃을 늘림, 폐기된 시도의 늦은 결과 무시, 실패 횟수 사다리 대기,
 * 429 최소 60초, 요청 사이 지연은 5.4.0 과 같은 값(config.delayTime) 전달.
 */
const getConfig = jest.fn(async () => ({}));
const upscaleImage = jest.fn(async (_arg: any) => {});
const deleteFile = jest.fn(async (_path: string) => {});
const readDataFile = jest.fn(async () => 'data:image/png;base64,file-image');
const onAddImage = jest.fn();

jest.mock('..', () => ({
  backend: {
    getConfig,
    upscaleImage,
    deleteFile,
    readDataFile,
    delegateComplete: jest.fn(async () => {}),
    delegateQueueSnapshot: jest.fn(async () => {}),
  },
  imageService: { onAddImage },
  isMobile: false,
  localAIService: {},
  promptService: {},
  sessionService: {},
  taskQueueService: {},
  workFlowService: {},
}));

jest.mock('../AppService', () => ({
  appState: { pushMessage: jest.fn() },
}));

jest.mock('../PersistenceService', () => ({
  persistService: { write: jest.fn(async () => {}) },
}));

jest.mock('../PromptService', () => ({
  expandPieces: jest.fn(),
  lowerPromptNode: jest.fn(),
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

import {
  TaskAttemptContext,
  TaskHandler,
  TaskQueueRun,
  TaskQueueService,
} from '../TaskQueueService';
import { taskHandlers } from '../TaskHandlers';
import { RequestTimeoutError } from '../requestTiming';
import { createNaiApiError } from '../../backends/genVendors/naiErrors';

function makeHandler(overrides: Partial<TaskHandler> = {}): TaskHandler {
  return {
    createTimeEstimator: jest.fn(() => ({ addSample: jest.fn() })) as any,
    checkTask: () => true,
    handleTask: jest.fn(async () => true),
    getNumTries: () => 1,
    handleDelay: jest.fn(async () => {}),
    getInfo: () => ({ name: 'test', emoji: 'T' }),
    calculateCost: () => [],
    ...overrides,
  };
}

function makeParam() {
  return {
    session: { name: 'project' },
    scene: { name: 'scene', type: 'scene' },
    job: { type: 'sd' },
    outputPath: 'outs/project/scene',
  } as any;
}

const run = (): TaskQueueRun => ({ stopped: false, delayCnt: 1000 });

// 재시도 대기를 실제로 기다리지 않고 기록만 한다.
function recordWaits(service: TaskQueueService): number[] {
  const waits: number[] = [];
  service.retryWait = jest.fn(async (ms: number) => {
    waits.push(ms);
    return true;
  });
  return waits;
}

function cleanup(service: TaskQueueService) {
  const s = service as any;
  if (s.logsSaveTimer) clearTimeout(s.logsSaveTimer);
  s.logsSaveTimer = null;
}

beforeEach(() => {
  getConfig.mockReset();
  getConfig.mockImplementation(async () => ({}));
  upscaleImage.mockReset();
  upscaleImage.mockImplementation(async () => {});
  deleteFile.mockReset();
  deleteFile.mockImplementation(async () => {});
  readDataFile.mockClear();
  onAddImage.mockClear();
  // 재시도 루프의 console.error/log 출력은 의도된 것 — 테스트 출력만 조용히.
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('runAttemptWithTimeout — 큐 바깥 타임아웃', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('바깥(안쪽+10초)이 끝나면 시도 signal 을 abort 하고 RequestTimeoutError', async () => {
    let ctx: TaskAttemptContext | undefined;
    const handler = makeHandler({
      handleTask: jest.fn((_t: any, _r: any, c?: TaskAttemptContext) => {
        ctx = c;
        return new Promise<boolean>(() => {});
      }),
    });
    const service = new TaskQueueService([handler]);
    const p = service.runAttemptWithTimeout(handler, {} as any, run(), 120000);
    const assertion = expect(p).rejects.toBeInstanceOf(RequestTimeoutError);
    expect(ctx!.requestTimeoutMs).toBe(120000);
    jest.advanceTimersByTime(129999);
    expect(ctx!.signal.aborted).toBe(false);
    jest.advanceTimersByTime(1);
    await assertion;
    expect(ctx!.signal.aborted).toBe(true);
  });

  test('시도마다 세대 번호가 다르다', async () => {
    const seen: number[] = [];
    const handler = makeHandler({
      handleTask: jest.fn(async (_t: any, _r: any, c?: TaskAttemptContext) => {
        seen.push(c!.attempt);
        return true;
      }),
    });
    const service = new TaskQueueService([handler]);
    await service.runAttemptWithTimeout(handler, {} as any, run(), 120000);
    await service.runAttemptWithTimeout(handler, {} as any, run(), 120000);
    expect(seen[1]).toBeGreaterThan(seen[0]);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('사용자 입력(확인 창) 대기는 측정에서 빼고, 끝난 뒤부터 다시 잰다', async () => {
    let answer!: (v: string) => void;
    let ctx: TaskAttemptContext | undefined;
    const handler = makeHandler({
      handleTask: jest.fn(async (_t: any, _r: any, c?: TaskAttemptContext) => {
        ctx = c;
        jest.advanceTimersByTime(100000); // 할당량 조회 등 100초 경과
        await c!.pauseTimeoutWhile(
          () => new Promise<string>((resolve) => { answer = resolve; }),
        );
        return await new Promise<boolean>(() => {}); // 주 요청이 응답 없음
      }),
    });
    const service = new TaskQueueService([handler]);
    let rejected: unknown;
    service.runAttemptWithTimeout(handler, {} as any, run(), 120000).catch((e) => { rejected = e; });
    await Promise.resolve();
    // 확인 창이 10분 떠 있어도 타임아웃이 아니다.
    jest.advanceTimersByTime(600000);
    await Promise.resolve();
    expect(rejected).toBeUndefined();
    expect(ctx!.signal.aborted).toBe(false);
    answer('continue');
    for (let i = 0; i < 5; i++) await Promise.resolve();
    // 확인 뒤 129.999초까지는 그대로, 130초에 타임아웃.
    jest.advanceTimersByTime(129999);
    await Promise.resolve();
    expect(rejected).toBeUndefined();
    jest.advanceTimersByTime(1);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(rejected).toBeInstanceOf(RequestTimeoutError);
    expect(ctx!.signal.aborted).toBe(true);
  });

  test('restartTimeout 은 주 요청 직전부터 다시 잰다', async () => {
    let ctx: TaskAttemptContext | undefined;
    const handler = makeHandler({
      handleTask: jest.fn((_t: any, _r: any, c?: TaskAttemptContext) => {
        ctx = c;
        return new Promise<boolean>(() => {});
      }),
    });
    const service = new TaskQueueService([handler]);
    let rejected: unknown;
    service.runAttemptWithTimeout(handler, {} as any, run(), 120000).catch((e) => { rejected = e; });
    jest.advanceTimersByTime(100000);
    ctx!.restartTimeout();
    jest.advanceTimersByTime(129999);
    await Promise.resolve();
    expect(rejected).toBeUndefined();
    jest.advanceTimersByTime(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(rejected).toBeInstanceOf(RequestTimeoutError);
  });
});

describe('runInternal — 재시도별 타임아웃·대기', () => {
  test('타임아웃 실패만 다음 시도 타임아웃을 60초씩 늘린다(상한 300초)', async () => {
    const outcomes: (Error | null)[] = [
      new RequestTimeoutError(120000),
      new RequestTimeoutError(180000),
      createNaiApiError(500, 'server down'), // 5xx 는 늘리지 않음
      new RequestTimeoutError(240000),
      new RequestTimeoutError(300000),
      null,
    ];
    const timeouts: number[] = [];
    const handler = makeHandler({
      getNumTries: () => 10,
      handleTask: jest.fn(async (_t: any, _r: any, c?: TaskAttemptContext) => {
        timeouts.push(c!.requestTimeoutMs);
        const next = outcomes.shift();
        if (next) throw next;
        return true;
      }),
    });
    const service = new TaskQueueService([handler]);
    recordWaits(service);
    service.addTaskLocal(makeParam(), 1);
    await service.runInternal(run());
    expect(timeouts).toEqual([120000, 180000, 240000, 240000, 300000, 300000]);
    expect(service.queue.isEmpty()).toBe(true);
    cleanup(service);
  });

  test('새 작업은 120초부터 다시 시작한다', async () => {
    const timeouts: number[] = [];
    let first = true;
    const handler = makeHandler({
      getNumTries: () => 3,
      handleTask: jest.fn(async (_t: any, _r: any, c?: TaskAttemptContext) => {
        timeouts.push(c!.requestTimeoutMs);
        if (first) {
          first = false;
          throw new RequestTimeoutError(120000);
        }
        return true;
      }),
    });
    const service = new TaskQueueService([handler]);
    recordWaits(service);
    service.addTaskLocal(makeParam(), 1);
    service.addTaskLocal(makeParam(), 1);
    await service.runInternal(run());
    expect(timeouts).toEqual([120000, 180000, 120000]);
    cleanup(service);
  });

  test('요청 사이 지연은 5.4.0 과 같다: config.delayTime(없으면 0)을 handleDelay 에 그대로', async () => {
    const handler = makeHandler();
    const service = new TaskQueueService([handler]);
    getConfig.mockImplementation(async () => ({}) as any);
    service.addTaskLocal(makeParam(), 1);
    await service.runInternal(run());
    expect(handler.handleDelay).toHaveBeenLastCalledWith(expect.anything(), 0, 0);
    getConfig.mockImplementation(async () => ({ delayTime: 700 }) as any);
    service.addTaskLocal(makeParam(), 1);
    await service.runInternal(run());
    expect(handler.handleDelay).toHaveBeenLastCalledWith(expect.anything(), 0, 700);
    cleanup(service);
  });

  test('재시도 가능한 실패 뒤 대기는 실패 횟수 사다리(±20%), 성공 뒤·마지막 시도 뒤에는 없음', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5); // 무작위 0
    const failures = [
      createNaiApiError(500, 'a'),
      new Error('Network request failed'),
      new RequestTimeoutError(120000),
      createNaiApiError(502, 'b'),
      createNaiApiError(503, 'c'),
      createNaiApiError(504, 'd'),
    ];
    const handler = makeHandler({
      getNumTries: () => 7,
      handleTask: jest.fn(async () => {
        const next = failures.shift();
        if (next) throw next;
        return true;
      }),
    });
    const service = new TaskQueueService([handler]);
    const waits = recordWaits(service);
    service.addTaskLocal(makeParam(), 1);
    await service.runInternal(run());
    expect(waits).toEqual([5000, 10000, 20000, 40000, 60000, 60000]);
    // 기존 지연(handleDelay)은 매 시도 앞에서 종전대로 불린다(두 대기는 합산).
    expect(handler.handleDelay).toHaveBeenCalledTimes(7);
    cleanup(service);
  });

  test('429 는 최소 60초, 그 뒤 사다리가 60초를 넘으면 사다리', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.999999); // +20%
    const failures = [
      createNaiApiError(429, 'Too many'),
      createNaiApiError(429, 'Too many'),
      createNaiApiError(429, 'Too many'),
      createNaiApiError(429, 'Too many'),
      createNaiApiError(429, 'Too many'),
    ];
    const handler = makeHandler({
      getNumTries: () => 6,
      handleTask: jest.fn(async () => {
        const next = failures.shift();
        if (next) throw next;
        return true;
      }),
    });
    const service = new TaskQueueService([handler]);
    const waits = recordWaits(service);
    service.addTaskLocal(makeParam(), 1);
    await service.runInternal(run());
    expect(waits).toEqual([60000, 60000, 60000, 60000, 72000]);
    expect((service as any).taskLogs.some((l: any) => /요청 제한 \(429\) - 60초 대기 후 재시도/.test(l.message))).toBe(true);
    cleanup(service);
  });

  test('요청 ID 에 429 가 섞인 5xx 는 429 대기를 쓰지 않는다', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    let first = true;
    const handler = makeHandler({
      getNumTries: () => 2,
      handleTask: jest.fn(async () => {
        if (first) {
          first = false;
          throw createNaiApiError(500, 'oops', 'ray-429-abc');
        }
        return true;
      }),
    });
    const service = new TaskQueueService([handler]);
    const waits = recordWaits(service);
    service.addTaskLocal(makeParam(), 1);
    await service.runInternal(run());
    expect(waits).toEqual([5000]);
    cleanup(service);
  });

  test('재시도 불가 오류는 기다리지 않고 건너뛴다, 재시도 횟수는 핸들러 값 그대로', async () => {
    const nonRetryable = Object.assign(new Error('auth'), { retryable: false });
    const handler = makeHandler({
      getNumTries: () => 40,
      handleTask: jest.fn(async () => { throw nonRetryable; }),
    });
    const service = new TaskQueueService([handler]);
    const waits = recordWaits(service);
    service.addTaskLocal(makeParam(), 1);
    await service.runInternal(run());
    expect(waits).toEqual([]);
    expect(handler.handleTask).toHaveBeenCalledTimes(1);
    expect(service.queue.isEmpty()).toBe(true);
    cleanup(service);

    // 계속 실패하면 정확히 getNumTries 회 시도하고, 대기는 시도 사이에만(횟수 − 1).
    const always = makeHandler({
      getNumTries: () => 40,
      handleTask: jest.fn(async () => { throw createNaiApiError(500, 'x'); }),
    });
    const service2 = new TaskQueueService([always]);
    const waits2 = recordWaits(service2);
    service2.addTaskLocal(makeParam(), 1);
    await service2.runInternal(run());
    expect(always.handleTask).toHaveBeenCalledTimes(40);
    expect(waits2).toHaveLength(39);
    cleanup(service2);
  });

  test('재시도 대기 중 정지하면 다음 요청을 보내지 않는다', async () => {
    const cur = run();
    const handler = makeHandler({
      getNumTries: () => 5,
      handleTask: jest.fn(async () => { throw createNaiApiError(500, 'x'); }),
    });
    const service = new TaskQueueService([handler]);
    service.retryWait = jest.fn(async (_ms: number, shouldStop: () => boolean) => {
      cur.stopped = true;
      return !shouldStop();
    });
    service.addTaskLocal(makeParam(), 1);
    await service.runInternal(cur);
    expect(handler.handleTask).toHaveBeenCalledTimes(1);
    expect(service.retryWait).toHaveBeenCalledTimes(1);
    cleanup(service);
  });

  test('지연 대기 중 정지하면 요청을 보내지 않는다', async () => {
    const cur = run();
    const handler = makeHandler({
      handleDelay: jest.fn(async () => { cur.stopped = true; }),
    });
    const service = new TaskQueueService([handler]);
    service.addTaskLocal(makeParam(), 1);
    await service.runInternal(cur);
    expect(handler.handleTask).not.toHaveBeenCalled();
    cleanup(service);
  });
});

describe('핸들러 — 요청 옵션 전달과 늦은 결과 무시(업스케일 핸들러)', () => {
  function upscaleTask() {
    return { params: { ...makeParam(), job: {
      type: 'upscale', backend: { type: 'NAI' }, image: 'source',
      width: 832, height: 1216, resolution: '832x1216',
    } } } as any;
  }
  function ctxWith(controller: AbortController): TaskAttemptContext {
    return {
      attempt: 1,
      signal: controller.signal,
      requestTimeoutMs: 180000,
      pauseTimeoutWhile: (fn) => fn(),
      restartTimeout: jest.fn(),
    };
  }

  test('시도의 타임아웃·signal 을 backend 요청에 넘긴다', async () => {
    const task = upscaleTask();
    const handler = taskHandlers.find((h) => h.checkTask(task))!;
    const controller = new AbortController();
    const ctx = ctxWith(controller);
    await handler.handleTask(task, {} as any, ctx);
    const arg = (upscaleImage.mock.calls as any[][])[0][0];
    expect(arg.request).toEqual({ timeoutMs: 180000, signal: controller.signal });
    expect(ctx.restartTimeout).toHaveBeenCalled();
    expect(onAddImage).toHaveBeenCalledTimes(1);
  });

  test('backend 저장 중 시도가 폐기되면 파일을 지우고 씬에 추가하지 않는다', async () => {
    const task = upscaleTask();
    const handler = taskHandlers.find((h) => h.checkTask(task))!;
    const controller = new AbortController();
    upscaleImage.mockImplementationOnce(async () => { controller.abort(); });
    await expect(handler.handleTask(task, {} as any, ctxWith(controller))).rejects.toThrow();
    const arg = (upscaleImage.mock.calls as any[][])[0][0];
    expect(deleteFile).toHaveBeenCalledWith(arg.outputFilePath);
    expect(onAddImage).not.toHaveBeenCalled();
  });

  test('이미 폐기된 시도는 요청을 보내지 않는다', async () => {
    const task = upscaleTask();
    const handler = taskHandlers.find((h) => h.checkTask(task))!;
    const controller = new AbortController();
    controller.abort();
    await expect(handler.handleTask(task, {} as any, ctxWith(controller))).rejects.toThrow();
    expect(upscaleImage).not.toHaveBeenCalled();
  });

  test('문맥이 없으면(구 호출부) 요청 옵션 없이 종전대로', async () => {
    const task = upscaleTask();
    const handler = taskHandlers.find((h) => h.checkTask(task))!;
    await handler.handleTask(task, {} as any);
    const arg = (upscaleImage.mock.calls as any[][])[0][0];
    expect(arg.request).toBeUndefined();
  });
});
