/**
 * 부스트 모드 B2(2026-11-01) — 설정으로 켠 부스트의 큐 엔진 시나리오(가짜 핸들러·가짜 참여 판정기).
 * - 꺼짐: 참여 조회 없음·배수 없음·워커 1개(종전)
 * - 참여: 실행 시작 때 판정기(범위, maxAge 0)로 추가 워커, 정책이 문맥·대상 판정에 실림, 참여 계정 없음 안내 1회
 * - A(replicate): 예약 시점 배수(D3, 보조 창 위임 포함)·계정마다 자기 몫(N장)·끝내 실패한 장은 그 몫으로 취소·
 *   할당량 탈락 시 그 계정 몫 취소(재분배 없음)·1계정만 남으면 부스트 중지(다른 몫 취소)·예약 때보다 계정이 적으면
 *   빈 몫 이어 맡기·정지/재시작 이어서
 * - B(split): 할당량 탈락 = 장 반납·이어받기, 1개 남아도 계속
 * - 진행 표시: 휴식 중 계정 수·미러(boostResting), 장 건너뜀의 원 창 'skip' 브리지·수신, 표식 이름 문맥
 */
const getConfig = jest.fn(async (): Promise<any> => ({}));
const delegateComplete = jest.fn(async (_p: any) => {});
const sessionGet = jest.fn();
const onAddImage = jest.fn();

jest.mock('..', () => ({
  backend: {
    getConfig,
    deleteFile: jest.fn(async () => {}),
    delegateComplete,
    delegateQueueSnapshot: jest.fn(async () => {}),
  },
  imageService: { onAddImage, onAddInPaint: jest.fn(), removeImageReference: jest.fn() },
  isMobile: false,
  localAIService: {},
  promptService: {},
  sessionService: { get: sessionGet, getFast: (...a: any[]) => sessionGet(...a) },
  taskQueueService: {},
  workFlowService: {},
}));

jest.mock('../AppService', () => ({
  appState: { pushMessage: jest.fn(), pushDialog: jest.fn() },
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
  TaskTimeEstimator,
} from '../TaskQueueService';
import { createWorkerDropError, DEFAULT_WORKER_ID, WORKER_POOL_TEXT } from '../queueWorkerPool';
import { BOOST_TEXT, BoostWorkerPolicy } from '../boostMode';
import type { BoostPlannerLike } from '../boostPlanner';
import { appState } from '../AppService';

const pushMessage = appState.pushMessage as jest.Mock;

const PARTICIPANTS = [
  { id: 'b', name: '계정B', token: 'tok-secret-b' },
  { id: 'c', name: '계정C', token: 'tok-secret-c' },
];

interface Call {
  worker: string;
  index: number | undefined;
  project: string;
  ok: boolean;
  boost?: BoostWorkerPolicy;
  markName?: string;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 1));

function poolHandler(
  outcome: (task: any, ctx: TaskAttemptContext) => Error | null = () => null,
  overrides: Partial<TaskHandler> = {},
) {
  const calls: Call[] = [];
  const handler: TaskHandler = {
    createTimeEstimator: () => new TaskTimeEstimator(16, 1000),
    checkTask: () => true,
    supportsWorkerAccount: (task: any, policy?: BoostWorkerPolicy) =>
      !policy || task.params.job.boostTarget !== false,
    getNumTries: () => 1,
    handleDelay: jest.fn(async () => {}),
    getInfo: () => ({ name: 'test', emoji: 'T' }),
    calculateCost: () => [],
    handleTask: jest.fn(async (task: any, _run: TaskQueueRun, ctx?: TaskAttemptContext) => {
      await tick();
      const err = outcome(task, ctx!);
      calls.push({
        worker: ctx!.worker!.id,
        index: ctx!.imageIndex,
        project: task.params.session.name,
        ok: !err,
        boost: ctx!.boost,
        markName: ctx!.worker!.markName,
      });
      if (err) throw err;
      return true;
    }),
    ...overrides,
  };
  return { handler, calls };
}

function makePlanner(
  settings: { mode: 'off' | 'replicate' | 'split'; scope?: 'free' | 'purchased' | 'anlas'; variantTasks?: boolean },
  participants = PARTICIPANTS,
) {
  const planner = {
    getSettings: jest.fn(async () => ({
      mode: settings.mode,
      scope: settings.scope ?? 'free',
      variantTasks: settings.variantTasks ?? false,
      modelVersion: 'v5',
    })),
    getParticipants: jest.fn(async () => ({ activeName: '메인', participants })),
  };
  return planner as jest.Mocked<BoostPlannerLike> & typeof planner;
}

function makeParam(project = 'project', job: any = { type: 'sd' }) {
  return {
    session: { name: project },
    scene: { name: 'scene', type: 'scene' },
    job,
    outputPath: `outs/${project}/scene`,
  } as any;
}

function makeService(
  handler: TaskHandler,
  config: any,
  planner?: ReturnType<typeof makePlanner>,
) {
  getConfig.mockImplementation(async () => config);
  const service = new TaskQueueService([handler]);
  if (planner) service.boostPlanner = planner;
  service.retryWait = jest.fn(async () => true);
  service.longBreakWait = jest.fn(async () => true);
  return service;
}

function cleanup(service: TaskQueueService) {
  const s = service as any;
  if (s.logsSaveTimer) clearTimeout(s.logsSaveTimer);
  s.logsSaveTimer = null;
}

const okBy = (calls: Call[], worker: string, project?: string) =>
  calls.filter((c) => c.ok && c.worker === worker && (!project || c.project === project)).length;

beforeEach(() => {
  getConfig.mockReset();
  getConfig.mockImplementation(async () => ({}));
  pushMessage.mockClear();
  delegateComplete.mockClear();
  sessionGet.mockReset();
  onAddImage.mockClear();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('부스트 꺼짐·참여', () => {
  test('꺼짐: 참여 조회 없이 워커 1개, 예약 배수 없음(판정기가 있어도 종전)', async () => {
    const { handler, calls } = poolHandler();
    const planner = makePlanner({ mode: 'off' });
    const service = makeService(handler, {}, planner);
    await service.addTask(makeParam(), 3);
    expect(service.queue.peek().total).toBe(3);
    expect(service.queue.peek().boostShares).toBeUndefined();
    await service.runInternal({ stopped: false });
    expect(planner.getParticipants).not.toHaveBeenCalled();
    expect(new Set(calls.map((c) => c.worker))).toEqual(new Set([DEFAULT_WORKER_ID]));
    expect(calls.every((c) => c.boost === undefined && c.markName === undefined)).toBe(true);
    cleanup(service);
  });

  test('B 켜짐: 실행 시작 때 범위로 새로 조회(maxAge 0), 참여 계정이 워커가 되고 정책·표식 이름이 문맥에 실린다', async () => {
    const { handler, calls } = poolHandler();
    const planner = makePlanner({ mode: 'split', scope: 'purchased' });
    const service = makeService(handler, { boostMode: 'split', boostAccountScope: 'purchased', modelVersion: 'v5' }, planner);
    service.addTaskLocal(makeParam(), 9);
    await service.runInternal({ stopped: false });
    expect(planner.getParticipants).toHaveBeenCalledWith('purchased', 0);
    expect(calls.filter((c) => c.ok)).toHaveLength(9);
    expect(new Set(calls.map((c) => c.worker))).toEqual(new Set([DEFAULT_WORKER_ID, 'b', 'c']));
    expect(calls[0].boost).toEqual({ scope: 'purchased', variantTasks: false, fallbackModelVersion: 'v5' });
    const marks = new Set(calls.map((c) => c.markName));
    expect(marks).toEqual(new Set(['메인', '계정B', '계정C']));
    expect(service.taskLogs.some((l) => l.message === WORKER_POOL_TEXT.poolStart(['메인', '계정B', '계정C']))).toBe(true);
    expect(JSON.stringify(service.taskLogs)).not.toContain('tok-secret');
    cleanup(service);
  });

  test('대상이 아닌 작업(정책 판정 false)은 다른 계정이 꺼내지 않는다', async () => {
    const { handler, calls } = poolHandler();
    const planner = makePlanner({ mode: 'split' });
    const service = makeService(handler, { boostMode: 'split' }, planner);
    service.addTaskLocal(makeParam('x', { type: 'sd', boostTarget: false }), 4);
    await service.runInternal({ stopped: false });
    expect(calls.every((c) => c.worker === DEFAULT_WORKER_ID)).toBe(true);
    expect(calls).toHaveLength(4);
    cleanup(service);
  });

  test('참여 계정이 없으면 워커 1개로 종전 실행 + 안내는 앱 세션당 1번', async () => {
    const { handler, calls } = poolHandler();
    const planner = makePlanner({ mode: 'split' }, []);
    const service = makeService(handler, { boostMode: 'split' }, planner);
    service.addTaskLocal(makeParam(), 2);
    await service.runInternal({ stopped: false });
    service.addTaskLocal(makeParam(), 1);
    await service.runInternal({ stopped: false });
    expect(calls.every((c) => c.worker === DEFAULT_WORKER_ID && c.markName === undefined)).toBe(true);
    expect(pushMessage.mock.calls.filter((c) => c[0] === BOOST_TEXT.noParticipants)).toHaveLength(1);
    cleanup(service);
  });
});

describe('A(replicate) — 예약 배수(D3)', () => {
  test('예약 시점 참여 수(기본 포함)로 total 을 곱하고 결과는 마지막 조회 재사용(5분), 대상 아님·B·참여 없음은 배수 없음', async () => {
    const { handler } = poolHandler();
    const planner = makePlanner({ mode: 'replicate' });
    const service = makeService(handler, {}, planner);
    await service.addTask(makeParam('a'), 4);
    expect(service.queue.peek().total).toBe(12);
    expect(service.queue.peek().boostShares).toBe(3);
    expect(planner.getParticipants).toHaveBeenCalledWith('free', 5 * 60_000);
    expect(service.statsAllTasks()).toEqual({ done: 0, total: 12 });
    await service.addTask(makeParam('b', { type: 'sd', boostTarget: false }), 4);
    const tasks = [...service.queue];
    expect(tasks[1]!.total).toBe(4);
    planner.getSettings.mockResolvedValueOnce({ mode: 'split', scope: 'free', variantTasks: false, modelVersion: 'v5' });
    await service.addTask(makeParam('c'), 4);
    expect([...service.queue][2]!.total).toBe(4);
    planner.getParticipants.mockResolvedValueOnce({ participants: [] } as any);
    await service.addTask(makeParam('d'), 4);
    expect([...service.queue][3]!.total).toBe(4);
    cleanup(service);
  });

  test('보조 창 위임 예약도 호스트가 같은 배수를 적용한다', async () => {
    const { handler } = poolHandler();
    const planner = makePlanner({ mode: 'replicate' });
    const service = makeService(handler, {}, planner);
    const session = { name: 'p', getScene: () => ({ name: 'scene', type: 'scene' }) };
    sessionGet.mockResolvedValue(session);
    await (service as any).receiveDelegatedTask({
      taskId: 't1',
      sessionName: 'p',
      sceneName: 'scene',
      sceneType: 'scene',
      job: { type: 'sd' },
      outputPath: 'outs/p/scene',
      samples: 2,
      nodelay: false,
      hasOnComplete: false,
      originWindowId: 7,
    });
    expect(service.queue.peek().total).toBe(6);
    expect(service.queue.peek().params.delegation!.originWindowId).toBe(7);
    cleanup(service);
  });

  test('판정기가 없으면(구 경로) addTask 는 배수 없이 종전대로', async () => {
    const { handler } = poolHandler();
    const service = makeService(handler, {});
    await service.addTask(makeParam(), 3);
    expect(service.queue.peek().total).toBe(3);
    cleanup(service);
  });
});

describe('A(replicate) — 실행(D4)', () => {
  async function replicateService(outcome?: (task: any, ctx: TaskAttemptContext) => Error | null, participants = PARTICIPANTS) {
    const ph = poolHandler(outcome);
    const planner = makePlanner({ mode: 'replicate' }, participants);
    const service = makeService(ph.handler, { boostMode: 'replicate' }, planner);
    return { ...ph, planner, service };
  }

  test('계정마다 자기 몫 N장 — 3계정 × 4장 = 12장, 장 번호 중복 없음', async () => {
    const { service, calls } = await replicateService();
    await service.addTask(makeParam(), 4);
    await service.runInternal({ stopped: false });
    expect(okBy(calls, DEFAULT_WORKER_ID)).toBe(4);
    expect(okBy(calls, 'b')).toBe(4);
    expect(okBy(calls, 'c')).toBe(4);
    const used = calls.filter((c) => c.ok).map((c) => c.index);
    expect(new Set(used).size).toBe(12);
    expect(service.queue.isEmpty()).toBe(true);
    expect(service.statsAllTasks()).toEqual({ done: 0, total: 0 });
    cleanup(service);
  });

  test('끝내 실패한 장은 그 계정 몫으로 취소 — 다른 계정이 대신 만들지 않는다(총 11장)', async () => {
    let failed = false;
    const { service, calls } = await replicateService((task, ctx) => {
      if (ctx.worker!.id === 'b' && !failed) {
        failed = true;
        return Object.assign(new Error('bad'), { retryable: false });
      }
      return null;
    });
    await service.addTask(makeParam(), 4);
    await service.runInternal({ stopped: false });
    expect(okBy(calls, 'b')).toBe(3);
    expect(okBy(calls, DEFAULT_WORKER_ID)).toBe(4);
    expect(okBy(calls, 'c')).toBe(4);
    expect(service.queue.isEmpty()).toBe(true);
    cleanup(service);
  });

  test('할당량 탈락: 그 계정 남은 몫은 취소(재분배 없음), 안내 토스트, 나머지 계정은 자기 몫만', async () => {
    let bCount = 0;
    const { service, calls } = await replicateService((task, ctx) => {
      if (ctx.worker!.id === 'b' && ++bCount === 2) return createWorkerDropError('계정B 소진');
      return null;
    });
    let statsAfterDrop: any;
    service.addEventListener('progress', () => {
      if (bCount >= 2 && !statsAfterDrop) statsAfterDrop = service.statsAllTasks();
    });
    await service.addTask(makeParam(), 4);
    await service.runInternal({ stopped: false });
    expect(okBy(calls, 'b')).toBe(1);
    expect(okBy(calls, DEFAULT_WORKER_ID)).toBe(4);
    expect(okBy(calls, 'c')).toBe(4);
    expect(pushMessage).toHaveBeenCalledWith('계정B 소진', 'info');
    // B 몫 남은 3장이 통계에서 빠진다(12 → 9)
    expect(statsAfterDrop.total).toBe(9);
    expect(service.taskLogs.some((l) => l.message === BOOST_TEXT.sharesCancelled('계정B', 2))).toBe(true);
    expect(service.queue.isEmpty()).toBe(true);
    // 2계정이 남았으므로 부스트 중지 안내는 없다
    expect(pushMessage.mock.calls.some((c) => String(c[0]).includes('부스트(배수 예약)를 멈췄습니다'))).toBe(false);
    cleanup(service);
  });

  test('1계정만 남으면 부스트 중지 — 다른 몫은 취소하고 남은 계정은 작업마다 자기 몫만(다음 예약 포함)', async () => {
    const { service, calls } = await replicateService((task, ctx) =>
      ctx.worker!.id !== DEFAULT_WORKER_ID ? createWorkerDropError(`${ctx.worker!.name} 소진`) : null,
    );
    await service.addTask(makeParam('a'), 3);
    await service.addTask(makeParam('b'), 2);
    await service.runInternal({ stopped: false });
    expect(okBy(calls, DEFAULT_WORKER_ID, 'a')).toBe(3);
    expect(okBy(calls, DEFAULT_WORKER_ID, 'b')).toBe(2);
    expect(calls.filter((c) => c.ok && c.worker !== DEFAULT_WORKER_ID)).toHaveLength(0);
    expect(pushMessage).toHaveBeenCalledWith(BOOST_TEXT.replicateEnded('메인'), 'info');
    expect(service.queue.isEmpty()).toBe(true);
    expect(service.statsAllTasks()).toEqual({ done: 0, total: 0 });
    cleanup(service);
  });

  test('예약 때보다 참여 계정이 적으면 빈 몫을 이어 맡아 예약 장 수를 채운다(D3 그대로)', async () => {
    const { service, calls, planner } = await replicateService();
    await service.addTask(makeParam(), 2); // 3계정 × 2 = 6
    planner.getParticipants.mockResolvedValue({ activeName: '메인', participants: [PARTICIPANTS[0]] });
    await service.runInternal({ stopped: false });
    expect(calls.filter((c) => c.ok)).toHaveLength(6);
    expect(service.queue.isEmpty()).toBe(true);
    cleanup(service);
  });

  test('부스트를 끈 뒤(단일 워커) 실행하면 배수된 예약을 끝까지 그대로 만든다', async () => {
    const { service, calls, planner } = await replicateService();
    await service.addTask(makeParam(), 2);
    getConfig.mockImplementation(async () => ({}));
    await service.runInternal({ stopped: false });
    expect(planner.getParticipants).toHaveBeenCalledTimes(1); // 예약 때 1번뿐
    expect(calls.filter((c) => c.ok && c.worker === DEFAULT_WORKER_ID)).toHaveLength(6);
    cleanup(service);
  });

  test('정지 뒤 다시 시작하면 몫을 이어서 — 장 번호 중복 없이 총 장 수 그대로', async () => {
    let stopped = false;
    const { service, calls } = await replicateService(() => {
      if (!stopped && calls.length === 3) {
        stopped = true;
        service.stop();
      }
      return null;
    });
    await service.addTask(makeParam(), 4);
    const cur: TaskQueueRun = { stopped: false };
    service.currentRun = cur;
    await service.runInternal(cur);
    expect(service.queue.isEmpty()).toBe(false);
    const cur2: TaskQueueRun = { stopped: false };
    service.currentRun = cur2;
    await service.runInternal(cur2);
    expect(service.queue.isEmpty()).toBe(true);
    const used = calls.filter((c) => c.ok).map((c) => c.index!);
    expect(new Set(used).size).toBe(used.length);
    cleanup(service);
  });
});

describe('B(split) — 탈락은 이어받기', () => {
  test('할당량 탈락한 계정이 쥔 장은 반납돼 다른 계정이 같은 번호로 만들고, 1계정만 남아도 끝까지(총 N장)', async () => {
    const dropped = new Set<string>();
    const { handler, calls } = poolHandler((task, ctx) => {
      const id = ctx.worker!.id;
      if (id !== DEFAULT_WORKER_ID && !dropped.has(id)) {
        dropped.add(id);
        return createWorkerDropError(`${ctx.worker!.name} 소진`);
      }
      return null;
    });
    const planner = makePlanner({ mode: 'split' });
    const service = makeService(handler, { boostMode: 'split' }, planner);
    service.addTaskLocal(makeParam(), 6);
    await service.runInternal({ stopped: false });
    const ok = calls.filter((c) => c.ok).map((c) => c.index!).sort((a, b) => a - b);
    expect(ok).toEqual([0, 1, 2, 3, 4, 5]);
    expect(pushMessage.mock.calls.some((c) => String(c[0]).includes('부스트(배수 예약)를 멈췄습니다'))).toBe(false);
    expect(service.queue.isEmpty()).toBe(true);
    cleanup(service);
  });
});

describe('진행 표시·위임 안내·표식 브리지', () => {
  test('다중 계정 긴 휴식: 쉬는 계정 수가 boostRestingCount·미러에 보이고 큐 전체 「휴식 중」은 아니다', async () => {
    const { handler } = poolHandler();
    const planner = makePlanner({ mode: 'split' }, [PARTICIPANTS[0]]);
    const service = makeService(handler, { boostMode: 'split' }, planner);
    const during: any[] = [];
    service.longBreakWait = jest.fn(async () => {
      during.push({
        resting: service.boostRestingCount(),
        mirror: (service as any).buildMirror().boostResting,
        whole: service.isLongBreak(),
      });
      return true;
    });
    service.longBreakRemaining = 1;
    service.addTaskLocal(makeParam(), 6);
    const cur: TaskQueueRun = { stopped: false };
    service.currentRun = cur;
    await service.runInternal(cur);
    expect(during[0]).toEqual({ resting: 1, mirror: 1, whole: false });
    expect(service.boostRestingCount()).toBe(0);
    cleanup(service);
  });

  test('다중 계정에서 위임 작업의 장 하나만 건너뛰면 원 창에 skip 안내(fail 아님)', async () => {
    const { handler } = poolHandler((task, ctx) =>
      ctx.imageIndex === 0 ? Object.assign(new Error('bad'), { retryable: false }) : null,
    );
    const planner = makePlanner({ mode: 'split' });
    const service = makeService(handler, { boostMode: 'split' }, planner);
    const param = makeParam();
    param.delegation = { originWindowId: 3, taskId: 'd1', sessionName: 'project', sceneName: 'scene', sceneType: 'scene' };
    service.addTaskLocal(param, 3);
    await service.runInternal({ stopped: false });
    const statuses = delegateComplete.mock.calls.map((c) => c[0].status);
    expect(statuses).toContain('skip');
    expect(statuses).not.toContain('fail');
    const skip = delegateComplete.mock.calls.find((c) => c[0].status === 'skip')![0];
    expect(skip.message).toBe(BOOST_TEXT.delegatedImageSkipped('scene'));
    cleanup(service);
  });

  test('원 창 수신: skip 은 토스트만(대행 콜백 유지), ok 의 accountName 은 그 씬 표식으로', () => {
    const service = new TaskQueueService([poolHandler().handler]);
    const cb = jest.fn();
    (service as any).delegatedCallbacks.set('d1', cb);
    (service as any).receiveDelegatedComplete({ taskId: 'd1', status: 'skip', message: '안내' });
    expect(pushMessage).toHaveBeenCalledWith('안내');
    expect((service as any).delegatedCallbacks.has('d1')).toBe(true);
    const scene: any = { name: 'scene', imageAccounts: undefined };
    const session = { scenes: new Map([['scene', scene]]), inpaints: new Map() };
    sessionGet.mockReturnValue(session);
    (service as any).receiveDelegatedComplete({
      taskId: 'd1',
      status: 'ok',
      sessionName: 'project',
      sceneName: 'scene',
      sceneType: 'scene',
      path: 'outs/project/scene/123.png',
      accountName: '계정B',
    });
    expect(scene.imageAccounts).toEqual({ '123.png': '계정B' });
    expect(onAddImage).toHaveBeenCalledWith(session, 'scene', 'outs/project/scene/123.png');
    expect(cb).toHaveBeenCalledWith('outs/project/scene/123.png');
    cleanup(service);
  });
});
