/**
 * 부스트 모드 B1(2026-11-01) — 큐 워커 풀 엔진.
 * - 순수 규칙(queueWorkerPool): 장 번호 할당·반납, 작업 정리 조건, 429 전 워커 대기 판정, 계정 정리, 휴식 어긋남
 * - 가짜 핸들러 2~3워커: 중복 할당 없음·총 장수·장 번호 0..N-1 한 번씩·계정당 동시 1요청·워커 탈락 반납/재분배·
 *   전원 탈락 정지·정지 시 모든 워커 종료·작업 제거 중 진행 장·장 단위(다중)/예약 단위(단일) 건너뜀·기본 계정 넘김·
 *   429 전 워커 대기·워커별 긴 휴식·미러 필드·예상 시간 ÷ W·토큰 비노출
 * - 단일 워커 회귀(장 번호 순서·문맥)
 */
const getConfig = jest.fn(async () => ({}));
const deleteFile = jest.fn(async (_path: string) => {});

jest.mock('..', () => ({
  backend: {
    getConfig,
    deleteFile,
    delegateComplete: jest.fn(async () => {}),
    delegateQueueSnapshot: jest.fn(async () => {}),
  },
  imageService: { onAddImage: jest.fn() },
  isMobile: false,
  localAIService: {},
  promptService: {},
  sessionService: {},
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
import {
  createWorkerDeclinedError,
  DEFAULT_WORKER_ID,
  isTaskSettled,
  normalizeWorkerAccounts,
  returnImageIndex,
  shouldPauseAllForRateLimit,
  staggeredLongBreakCount,
  takeImageIndex,
  unclaimedImageCount,
  remainingImageCount,
  WORKER_POOL_TEXT,
} from '../queueWorkerPool';
import { CONSECUTIVE_FAILURE_STOP, TASK_FAILURE_TEXT } from '../requestTiming';
import { createNaiApiError } from '../../backends/genVendors/naiErrors';
import { appState } from '../AppService';

const pushMessage = appState.pushMessage as jest.Mock;
const pushDialog = appState.pushDialog as jest.Mock;

const ACCOUNTS = [
  { id: 'b', name: '계정B', token: 'tok-secret-b' },
  { id: 'c', name: '계정C', token: 'tok-secret-c' },
];

interface Call {
  worker: string;
  token?: string;
  index: number | undefined;
  project: string;
  ok: boolean;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 1));

/**
 * 가짜 생성 핸들러 — 시도마다 워커·장 번호를 기록하고, 계정당 동시 요청이 2개 이상이면 기록한다.
 * outcome(task, ctx) 가 Error 를 돌려주면 그 시도는 실패.
 */
function poolHandler(
  outcome: (task: any, ctx: TaskAttemptContext) => Error | null = () => null,
  overrides: Partial<TaskHandler> = {},
) {
  const calls: Call[] = [];
  const active = new Map<string, number>();
  let maxPerWorker = 0;
  const handler: TaskHandler = {
    createTimeEstimator: () => new TaskTimeEstimator(16, 1000),
    checkTask: () => true,
    supportsWorkerAccount: () => true,
    getNumTries: () => 1,
    handleDelay: jest.fn(async () => {}),
    getInfo: () => ({ name: 'test', emoji: 'T' }),
    calculateCost: () => [],
    handleTask: jest.fn(async (task: any, _run: TaskQueueRun, ctx?: TaskAttemptContext) => {
      const id = ctx!.worker!.id;
      active.set(id, (active.get(id) ?? 0) + 1);
      maxPerWorker = Math.max(maxPerWorker, active.get(id)!);
      try {
        await tick();
        const err = outcome(task, ctx!);
        calls.push({
          worker: id,
          token: ctx!.worker!.token,
          index: ctx!.imageIndex,
          project: task.params.session.name,
          ok: !err,
        });
        if (err) throw err;
        return true;
      } finally {
        active.set(id, active.get(id)! - 1);
      }
    }),
    ...overrides,
  };
  return { handler, calls, maxPerWorker: () => maxPerWorker };
}

function makeParam(project = 'project') {
  return {
    session: { name: project },
    scene: { name: 'scene', type: 'scene' },
    job: { type: 'sd' },
    outputPath: `outs/${project}/scene`,
  } as any;
}

function makeService(handler: TaskHandler, accounts: any[] = ACCOUNTS) {
  const service = new TaskQueueService([handler]);
  service.setDevWorkerAccounts(accounts);
  const waits: number[] = [];
  service.retryWait = jest.fn(async (ms: number) => {
    waits.push(ms);
    return true;
  });
  service.longBreakWait = jest.fn(async () => true);
  return { service, waits };
}

function cleanup(service: TaskQueueService) {
  const s = service as any;
  if (s.logsSaveTimer) clearTimeout(s.logsSaveTimer);
  s.logsSaveTimer = null;
}

const okIndices = (calls: Call[], project = 'project') =>
  calls.filter((c) => c.ok && c.project === project).map((c) => c.index!).sort((a, b) => a - b);

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

beforeEach(() => {
  getConfig.mockReset();
  getConfig.mockImplementation(async () => ({}));
  pushMessage.mockClear();
  pushDialog.mockClear();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('queueWorkerPool — 순수 규칙', () => {
  test('장 번호: 새 번호는 0부터 차례로, 돌려받은 번호가 있으면 가장 작은 것부터 다시 준다', () => {
    const t: any = { total: 5, done: 0 };
    expect([takeImageIndex(t), takeImageIndex(t), takeImageIndex(t)]).toEqual([0, 1, 2]);
    returnImageIndex(t, 2);
    returnImageIndex(t, 0);
    returnImageIndex(t, 0); // 중복 무시
    expect(t.returnedImageIndices).toEqual([0, 2]);
    expect([takeImageIndex(t), takeImageIndex(t), takeImageIndex(t)]).toEqual([0, 2, 3]);
  });

  test('남은 장·미할당 장·정리 조건(done + skipped ≥ total 이고 진행 중 0, 또는 total 오염)', () => {
    expect(remainingImageCount({ total: 5, done: 1, skipped: 1 })).toBe(3);
    expect(unclaimedImageCount({ total: 5, done: 1, skipped: 1, inFlight: 2 })).toBe(1);
    expect(unclaimedImageCount({ total: 5, done: 1, skipped: 1, inFlight: 9 })).toBe(0);
    expect(remainingImageCount({ total: NaN, done: 0 })).toBe(0);
    expect(isTaskSettled({ total: 3, done: 2, skipped: 1, inFlight: 0 })).toBe(true);
    expect(isTaskSettled({ total: 3, done: 2, skipped: 1, inFlight: 1 })).toBe(false);
    expect(isTaskSettled({ total: 3, done: 2 })).toBe(false);
    expect(isTaskSettled({ total: NaN, done: 0 })).toBe(true);
  });

  test('429 전 워커 대기: 1분 안에 서로 다른 워커 2개 이상일 때만', () => {
    const now = 1_000_000;
    expect(shouldPauseAllForRateLimit([{ workerId: 'a', at: now }, { workerId: 'a', at: now }], now)).toBe(false);
    expect(shouldPauseAllForRateLimit([{ workerId: 'a', at: now - 59_000 }, { workerId: 'b', at: now }], now)).toBe(true);
    expect(shouldPauseAllForRateLimit([{ workerId: 'a', at: now - 60_000 }, { workerId: 'b', at: now }], now)).toBe(false);
  });

  test('계정 정리: 빈 토큰·기본 워커 id·같은 id/토큰 중복을 버리고 복사본을 돌려준다', () => {
    const raw = [
      { id: 'x', name: 'X', token: ' t1 ' },
      { id: 'y', name: 'Y', token: '' },
      { id: 'x', name: 'X2', token: 't2' },
      { id: 'z', name: '', token: 't1' },
      { id: DEFAULT_WORKER_ID, name: 'D', token: 't3' },
      { name: '이름만', token: 't4' },
      null,
    ];
    const out = normalizeWorkerAccounts(raw);
    expect(out).toEqual([
      { id: 'x', name: 'X', token: 't1' },
      { id: 'worker-6', name: '이름만', token: 't4' },
    ]);
    expect(out[0]).not.toBe(raw[0]);
    expect(normalizeWorkerAccounts(undefined)).toEqual([]);
  });

  test('추가 워커의 첫 긴 휴식 카운터는 순번만큼 늦춘다(서로 어긋나게)', () => {
    const r = () => 0;
    expect(staggeredLongBreakCount(1, 2, r)).toBe(300 + 150);
    expect(staggeredLongBreakCount(2, 3, r)).toBe(300 + 200);
    expect(staggeredLongBreakCount(0, 3, r)).toBe(300);
  });
});

describe('워커 풀 — 다중 워커(개발 플래그)', () => {
  test('3워커: 중복 할당 없이 총 N장, 장 번호 0..N-1 이 정확히 한 번씩, 계정당 동시 1요청', async () => {
    const { handler, calls, maxPerWorker } = poolHandler();
    const { service } = makeService(handler);
    let completes = 0;
    service.addEventListener('complete', () => completes++);
    service.addTaskLocal(makeParam('a'), 10);
    service.addTaskLocal(makeParam('b'), 5);
    await service.runInternal({ stopped: false });
    expect(calls).toHaveLength(15);
    expect(okIndices(calls, 'a')).toEqual(range(10));
    expect(okIndices(calls, 'b')).toEqual(range(5));
    expect(completes).toBe(15);
    expect(maxPerWorker()).toBe(1);
    // 세 계정이 모두 일했다
    expect(new Set(calls.map((c) => c.worker))).toEqual(new Set([DEFAULT_WORKER_ID, 'b', 'c']));
    expect(service.queue.isEmpty()).toBe(true);
    expect(service.statsAllTasks()).toEqual({ done: 0, total: 0 });
    cleanup(service);
  });

  test('토큰: 추가 워커만 문맥에 토큰, 기본 워커는 없음 — 로그·미러에는 토큰이 실리지 않는다', async () => {
    let mirrorDuring: any;
    const { handler, calls } = poolHandler((task, ctx) => {
      if (!mirrorDuring && ctx.worker!.id === 'c') mirrorDuring = (service as any).buildMirror();
      return null;
    });
    const { service } = makeService(handler);
    service.addTaskLocal(makeParam(), 6);
    await service.runInternal({ stopped: false });
    for (const c of calls) {
      if (c.worker === DEFAULT_WORKER_ID) expect(c.token).toBeUndefined();
      else expect(c.token).toBe(ACCOUNTS.find((a) => a.id === c.worker)!.token);
    }
    const logs = JSON.stringify(service.taskLogs);
    expect(logs).not.toContain('tok-secret');
    expect(logs).toContain(WORKER_POOL_TEXT.poolStart([WORKER_POOL_TEXT.defaultWorkerName, '계정B', '계정C']));
    expect(mirrorDuring.boostWorkers).toBe(3);
    expect(JSON.stringify(mirrorDuring)).not.toContain('tok-secret');
    cleanup(service);
  });

  test('인증 오류로 추가 워커가 빠지면 쥔 장을 반납 — 다른 워커가 같은 장 번호로 이어받고 전체는 계속', async () => {
    let failedIndex: number | undefined;
    const { handler, calls } = poolHandler((task, ctx) => {
      if (ctx.worker!.id === 'b') {
        failedIndex = ctx.imageIndex;
        return createNaiApiError(401, 'Invalid token');
      }
      return null;
    });
    const { service } = makeService(handler);
    service.addTaskLocal(makeParam(), 8);
    await service.runInternal({ stopped: false });
    expect(calls.filter((c) => c.worker === 'b')).toHaveLength(1);
    expect(okIndices(calls)).toEqual(range(8));
    const retaken = calls.find((c) => c.ok && c.index === failedIndex)!;
    expect(retaken.worker).not.toBe('b');
    expect(pushDialog).toHaveBeenCalledTimes(1);
    expect(pushDialog.mock.calls[0][0].text).toBe(
      WORKER_POOL_TEXT.authDropped('계정B', createNaiApiError(401, 'Invalid token').message),
    );
    expect(service.queue.isEmpty()).toBe(true);
    cleanup(service);
  });

  test('연속 실패: 그 워커는 장 2개를 건너뛴 뒤 세 번째에 빠지고(장 반납), 나머지 워커가 끝까지', async () => {
    const { handler, calls } = poolHandler((task, ctx) =>
      ctx.worker!.id === 'b' ? createNaiApiError(500, 'b down') : null,
    );
    const { service } = makeService(handler);
    service.addTaskLocal(makeParam(), 12);
    await service.runInternal({ stopped: false });
    const bCalls = calls.filter((c) => c.worker === 'b');
    expect(bCalls).toHaveLength(CONSECUTIVE_FAILURE_STOP);
    const skippedIndices = bCalls.slice(0, 2).map((c) => c.index!);
    const returnedIndex = bCalls[2].index!;
    // 건너뛴 장의 번호는 다시 쓰지 않고, 반납된 장의 번호는 다른 워커가 성공시킨다.
    expect(okIndices(calls)).toEqual(range(12).filter((k) => !skippedIndices.includes(k)));
    expect(okIndices(calls)).toContain(returnedIndex);
    expect(
      service.taskLogs.filter((l) => l.message === WORKER_POOL_TEXT.imageSkipped(1) + WORKER_POOL_TEXT.tag('계정B')),
    ).toHaveLength(2);
    expect(pushMessage).toHaveBeenCalledWith(
      WORKER_POOL_TEXT.consecutiveDropped('계정B', createNaiApiError(500, 'b down').message),
      'error',
    );
    expect(pushDialog).not.toHaveBeenCalled();
    expect(service.queue.isEmpty()).toBe(true);
    expect(service.statsAllTasks()).toEqual({ done: 0, total: 0 });
    cleanup(service);
  });

  test('모든 워커가 빠지면 종전 연속 실패 정지(작업은 큐에 남고 확인 창 1번)', async () => {
    const { handler, calls } = poolHandler(() => createNaiApiError(503, 'down'));
    const { service } = makeService(handler, [ACCOUNTS[0]]);
    const cur: TaskQueueRun = { stopped: false };
    service.currentRun = cur;
    const events: string[] = [];
    service.addEventListener('failure-stop', () => events.push('failure-stop'));
    service.addTaskLocal(makeParam(), 10);
    await service.runInternal(cur);
    // 워커마다 2장 건너뜀 + 3장째 반납 후 탈락 → 시도 6, 건너뜀 4
    expect(calls).toHaveLength(2 * CONSECUTIVE_FAILURE_STOP);
    expect(cur.stopped).toBe(true);
    expect(service.currentRun).toBeUndefined();
    expect(events).toEqual(['failure-stop']);
    expect(pushDialog).toHaveBeenCalledTimes(1);
    expect(pushDialog.mock.calls[0][0].text).toBe(
      TASK_FAILURE_TEXT.consecutiveStop(createNaiApiError(503, 'down').message),
    );
    const task = service.queue.peek();
    expect(task.skipped).toBe(4);
    expect(task.inFlight).toBe(0);
    expect(service.statsAllTasks()).toEqual({ done: 0, total: 6 });
    // 반납된 2개 번호는 다음 실행이 먼저 쓴다
    expect(task.returnedImageIndices).toHaveLength(2);
    cleanup(service);
  });

  test('기본 워커의 인증 오류는 종전처럼 전체 즉시 정지', async () => {
    const { handler } = poolHandler((task, ctx) =>
      ctx.worker!.id === DEFAULT_WORKER_ID ? createNaiApiError(401, 'Invalid token') : null,
    );
    const { service } = makeService(handler);
    const cur: TaskQueueRun = { stopped: false };
    service.currentRun = cur;
    service.addTaskLocal(makeParam(), 20);
    await service.runInternal(cur);
    expect(cur.stopped).toBe(true);
    expect(pushDialog).toHaveBeenCalledTimes(1);
    expect(pushDialog.mock.calls[0][0].text).toBe(
      TASK_FAILURE_TEXT.authStop(createNaiApiError(401, 'Invalid token').message),
    );
    const task = service.queue.peek();
    expect(task.inFlight).toBe(0);
    expect(task.done).toBeLessThan(20);
    cleanup(service);
  });

  test('정지하면 모든 워커가 곧바로 끝나고 새 요청을 보내지 않는다 — 다시 시작하면 시드 중복 없이 이어서', async () => {
    let stopAt = -1;
    const { handler, calls } = poolHandler(() => {
      if (calls.length === 4 && stopAt < 0) {
        stopAt = (handler.handleTask as jest.Mock).mock.calls.length;
        service.stop();
      }
      return null;
    });
    const { service } = makeService(handler);
    const cur: TaskQueueRun = { stopped: false };
    service.currentRun = cur;
    service.addTaskLocal(makeParam(), 12);
    await service.runInternal(cur);
    // 정지 순간 이미 시작된 요청만 끝나고, 그 뒤 새 요청은 없다
    expect((handler.handleTask as jest.Mock).mock.calls.length).toBe(stopAt);
    const task = service.queue.peek();
    expect(task.inFlight).toBe(0);
    // 다시 실행 — 끝까지
    const cur2: TaskQueueRun = { stopped: false };
    service.currentRun = cur2;
    await service.runInternal(cur2);
    expect(service.queue.isEmpty()).toBe(true);
    const used = calls.filter((c) => c.ok).map((c) => c.index!);
    expect(new Set(used).size).toBe(used.length); // 같은 장 번호(시드)를 두 번 쓰지 않음
    cleanup(service);
  });

  test('진행 중에 예약을 모두 제거하면 진행 중 장만 마무리하고 끝난다(통계 음수 없음)', async () => {
    let removed = false;
    const { handler, calls } = poolHandler(() => {
      if (!removed && calls.length === 2) {
        removed = true;
        service.removeAllTasks();
      }
      return null;
    });
    const { service } = makeService(handler);
    const cur: TaskQueueRun = { stopped: false };
    service.currentRun = cur;
    const events: string[] = [];
    service.addEventListener('stop', () => events.push('stop'));
    service.addTaskLocal(makeParam(), 30);
    await service.runInternal(cur);
    expect(calls.length).toBeLessThanOrEqual(2 + 3);
    expect(service.queue.isEmpty()).toBe(true);
    expect(service.statsAllTasks()).toEqual({ done: 0, total: 0 });
    expect(service.statsTasksFromScene({ name: 'project' } as any, { name: 'scene', type: 'scene' } as any)).toEqual({ done: 0, total: 0 });
    expect(events).toEqual(['stop']);
    expect(service.currentRun).toBeUndefined();
    cleanup(service);
  });

  test('장 단위 건너뜀(다중) — 끝내 실패한 그 장만 건너뛰고 같은 예약의 다른 장은 계속', async () => {
    const { handler, calls } = poolHandler((task, ctx) =>
      ctx.imageIndex === 1 ? Object.assign(new Error('bad prompt'), { retryable: false }) : null,
    );
    const { service } = makeService(handler);
    service.addTaskLocal(makeParam(), 5);
    await service.runInternal({ stopped: false });
    expect(okIndices(calls)).toEqual([0, 2, 3, 4]);
    expect(calls.filter((c) => !c.ok)).toHaveLength(1);
    expect(service.taskLogs.some((l) => l.message.startsWith(WORKER_POOL_TEXT.imageSkipped(1)))).toBe(true);
    expect(service.queue.isEmpty()).toBe(true);
    cleanup(service);
  });

  test('장 단위 건너뜀 중 통계: 건너뛴 장은 total 에서 빠져 남은 수에 남지 않는다', async () => {
    let statsAfterSkip: any;
    const { handler } = poolHandler((task, ctx) => {
      if (ctx.imageIndex === 0) return Object.assign(new Error('x'), { retryable: false });
      if (task.skipped && !statsAfterSkip) statsAfterSkip = service.statsAllTasks();
      return null;
    });
    const { service } = makeService(handler, [ACCOUNTS[0]]);
    service.addTaskLocal(makeParam(), 6);
    await service.runInternal({ stopped: false });
    expect(statsAfterSkip.total).toBe(5);
    cleanup(service);
  });

  test('기본 계정 전용 처리 신호 — 추가 워커는 그 작업을 넘기고 기본 워커가 같은 장 번호로 처리(실패로 세지 않음)', async () => {
    const { handler, calls } = poolHandler((task, ctx) =>
      task.params.session.name === 'vibe' && !ctx.worker!.isDefault
        ? createWorkerDeclinedError(WORKER_POOL_TEXT.declined)
        : null,
    );
    const { service } = makeService(handler);
    service.addTaskLocal(makeParam('vibe'), 4);
    await service.runInternal({ stopped: false });
    const ok = calls.filter((c) => c.ok);
    expect(ok.every((c) => c.worker === DEFAULT_WORKER_ID)).toBe(true);
    expect(okIndices(calls, 'vibe')).toEqual(range(4));
    expect(service.consecutiveTaskFailures).toBe(0);
    expect(service.taskLogs.some((l) => l.message.startsWith(WORKER_POOL_TEXT.declined))).toBe(true);
    expect(service.queue.isEmpty()).toBe(true);
    cleanup(service);
  });

  test('다른 계정을 받을 수 없는 작업(증강·업스케일 등)은 기본 워커만 처리하고 실행은 정상 종료', async () => {
    const { handler, calls } = poolHandler(() => null, { supportsWorkerAccount: undefined });
    const { service } = makeService(handler);
    service.addTaskLocal(makeParam(), 3);
    await service.runInternal({ stopped: false });
    expect(calls.map((c) => c.worker)).toEqual([DEFAULT_WORKER_ID, DEFAULT_WORKER_ID, DEFAULT_WORKER_ID]);
    expect(calls.map((c) => c.index)).toEqual([0, 1, 2]);
    expect(service.queue.isEmpty()).toBe(true);
    cleanup(service);
  });

  test('429 가 서로 다른 워커 2개에서 1분 안에 나면 전 워커가 429 대기만큼 쉰다', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    const hit = new Set<string>();
    const { handler } = poolHandler(
      (task, ctx) => {
        const id = ctx.worker!.id;
        if (!hit.has(id)) {
          hit.add(id);
          return createNaiApiError(429, 'Too many');
        }
        return null;
      },
      { getNumTries: () => 3 },
    );
    const { service, waits } = makeService(handler, [ACCOUNTS[0]]);
    service.addTaskLocal(makeParam(), 4);
    await service.runInternal({ stopped: false });
    expect(service.taskLogs.some((l) => l.message === WORKER_POOL_TEXT.ipPause(60000))).toBe(true);
    // 각 워커의 429 재시도 대기 60초 × 2 + 전 워커 일시 대기(남은 시간 ≤ 60초) 1회 이상
    expect(waits.filter((ms) => ms === 60000).length).toBeGreaterThanOrEqual(2);
    expect(waits.length).toBeGreaterThanOrEqual(3);
    expect(waits.every((ms) => ms > 0 && ms <= 60000)).toBe(true);
    cleanup(service);
  });

  test('긴 휴식은 워커별 — 기본 워커는 서비스 카운터, 추가 워커는 자기 카운터로 따로 쉬고 큐 전체 「휴식 중」은 그리지 않는다', async () => {
    const { handler } = poolHandler();
    const { service } = makeService(handler, [ACCOUNTS[0]]);
    const restDuring: boolean[] = [];
    service.longBreakWait = jest.fn(async () => {
      restDuring.push(service.isLongBreak());
      return true;
    });
    service.longBreakRemaining = 2;
    (service as any).workerLongBreak.set('b', 1);
    service.addTaskLocal(makeParam(), 10);
    await service.runInternal({ stopped: false });
    expect(service.longBreakWait).toHaveBeenCalledTimes(2);
    expect(restDuring).toEqual([false, false]);
    const breakLogs = service.taskLogs.filter((l) => l.message.includes('긴 휴식'));
    expect(breakLogs.map((l) => l.message.split(':')[0]).sort()).toEqual([WORKER_POOL_TEXT.defaultWorkerName, '계정B'].sort());
    expect(service.longBreakRemaining).toBeGreaterThanOrEqual(290);
    expect((service as any).workerLongBreak.get('b')).toBeGreaterThanOrEqual(290);
    cleanup(service);
  });

  test('예상 시간·한 장 예상 = 평균 ÷ 활성 워커 수, 실행이 끝나면 다시 ÷ 1', async () => {
    let during: { eta: number; top: number; remain: number } | undefined;
    const { handler } = poolHandler(() => {
      if (!during) {
        const s = service.statsAllTasks();
        during = { eta: service.estimateTime('mean'), top: service.estimateTopTaskTime('mean'), remain: s.total - s.done };
      }
      return null;
    });
    const { service } = makeService(handler);
    service.addTaskLocal(makeParam(), 9);
    await service.runInternal({ stopped: false });
    // 기본 추정 1000ms(샘플 없음 기준과 별개로 이 핸들러 추정기의 기본값)
    expect(during!.top).toBeCloseTo(1000 / 3);
    expect(during!.eta).toBeCloseTo((1000 * during!.remain) / 3);
    service.addTaskLocal(makeParam(), 2);
    expect(service.boostWorkerCount()).toBe(1);
    cleanup(service);
  });
});

describe('워커 풀 — 미러 필드(보조 창)', () => {
  test('보조 창은 미러의 boostWorkers 를 읽고(없으면 1), 예상 시간은 다시 나누지 않는다', () => {
    const service = new TaskQueueService([poolHandler().handler]);
    service.isGenerationHost = false;
    const base = {
      running: true, doneTotal: 1, total: 10, etaMean: 9000, topTaskTimeMean: 500,
      projectRemains: {}, projectRunning: null, byOrigin: {}, sceneStats: {},
    };
    (service as any).receiveQueueMirror({ ...base, boostWorkers: 3 });
    expect(service.boostWorkerCount()).toBe(3);
    expect(service.estimateTime('mean')).toBe(9000);
    expect(service.estimateTopTaskTime('mean')).toBe(500);
    (service as any).receiveQueueMirror({ ...base });
    expect(service.boostWorkerCount()).toBe(1);
    cleanup(service);
  });

  test('호스트 미러: 실행 중이 아니면 boostWorkers = 1', () => {
    const service = new TaskQueueService([poolHandler().handler]);
    expect((service as any).buildMirror().boostWorkers).toBe(1);
    cleanup(service);
  });
});

describe('워커 풀 — 단일 워커(부스트 꺼짐) 회귀', () => {
  test('개발 플래그가 없으면 워커 1개 — 장 번호는 머리 작업부터 0,1,2… 재시도는 같은 번호, 문맥은 기본 워커', async () => {
    let failedOnce = false;
    const { handler, calls } = poolHandler(
      (task, ctx) => {
        if (task.params.session.name === 'a' && ctx.imageIndex === 1 && !failedOnce) {
          failedOnce = true;
          return createNaiApiError(500, 'x');
        }
        return null;
      },
      { getNumTries: () => 3 },
    );
    const { service } = makeService(handler, []);
    service.addTaskLocal(makeParam('a'), 3);
    service.addTaskLocal(makeParam('b'), 2);
    await service.runInternal({ stopped: false });
    expect(calls.map((c) => `${c.project}${c.index}${c.ok ? '' : '!'}`)).toEqual([
      'a0', 'a1!', 'a1', 'a2', 'b0', 'b1',
    ]);
    expect(new Set(calls.map((c) => c.worker))).toEqual(new Set([DEFAULT_WORKER_ID]));
    expect(calls.every((c) => c.token === undefined)).toBe(true);
    expect(service.taskLogs.some((l) => l.message.includes('동시 생성'))).toBe(false);
    cleanup(service);
  });

  test('예약 단위 건너뜀(단일) — 재시도를 다 쓰면 그 예약의 남은 장 전체를 건너뛴다(종전)', async () => {
    const { handler, calls } = poolHandler((task, ctx) =>
      task.params.session.name === 'a' && ctx.imageIndex === 1
        ? Object.assign(new Error('bad'), { retryable: false })
        : null,
    );
    const { service } = makeService(handler, []);
    service.addTaskLocal(makeParam('a'), 4);
    service.addTaskLocal(makeParam('b'), 1);
    await service.runInternal({ stopped: false });
    expect(calls.map((c) => `${c.project}${c.index}`)).toEqual(['a0', 'a1', 'b0']);
    expect(service.taskLogs.some((l) => l.message === TASK_FAILURE_TEXT.retriesExhausted(1))).toBe(true);
    expect(service.consecutiveTaskFailures).toBe(0);
    cleanup(service);
  });

  test('연속 실패 정지 뒤 다시 시작하면 정지한 장의 번호부터(같은 시드) 이어서', async () => {
    let fail = true;
    const { handler, calls } = poolHandler(() =>
      fail ? Object.assign(new Error('bad'), { retryable: false }) : null,
    );
    const { service } = makeService(handler, []);
    for (const p of ['a', 'b', 'c']) service.addTaskLocal(makeParam(p), 2);
    await service.runInternal({ stopped: false });
    // a·b 는 예약 단위로 건너뛰고 c 에서 정지 — c 의 0번은 반납돼 있다
    expect(calls.map((c) => `${c.project}${c.index}`)).toEqual(['a0', 'b0', 'c0']);
    expect(service.queue.peek().params.session.name).toBe('c');
    fail = false;
    await service.runInternal({ stopped: false });
    expect(calls.slice(3).map((c) => `${c.project}${c.index}`)).toEqual(['c0', 'c1']);
    cleanup(service);
  });

  test('정지 직후 다시 시작: 옛 루프의 진행 중 요청은 마무리만(미집계), 새 루프는 바로 다음 장 번호부터 — 시드 중복 없음', async () => {
    let releaseFirst!: () => void;
    const seen: { run: number; index: number }[] = [];
    let runNo = 1;
    const handler: any = {
      createTimeEstimator: () => new TaskTimeEstimator(16, 1000),
      checkTask: () => true,
      getNumTries: () => 1,
      handleDelay: jest.fn(async () => {}),
      getInfo: () => ({ name: 't', emoji: 'T' }),
      calculateCost: () => [],
      handleTask: jest.fn(async (_t: any, _r: any, ctx?: TaskAttemptContext) => {
        seen.push({ run: runNo, index: ctx!.imageIndex! });
        if (seen.length === 1) await new Promise<void>((r) => { releaseFirst = r; });
        else await tick();
        return true;
      }),
    };
    const { service } = makeService(handler, []);
    service.addTaskLocal(makeParam(), 3);
    const cur1: TaskQueueRun = { stopped: false };
    service.currentRun = cur1;
    const p1 = service.runInternal(cur1);
    while (seen.length === 0) await tick();
    service.stop();
    runNo = 2;
    const cur2: TaskQueueRun = { stopped: false };
    service.currentRun = cur2;
    await service.runInternal(cur2);
    releaseFirst();
    await p1;
    expect(seen).toEqual([
      { run: 1, index: 0 },
      { run: 2, index: 1 },
      { run: 2, index: 2 },
      { run: 2, index: 3 },
    ]);
    expect(service.queue.isEmpty()).toBe(true);
    expect(service.statsAllTasks()).toEqual({ done: 0, total: 0 });
    cleanup(service);
  });

  test('setDevWorkerAccounts 는 받아들인 수를 돌려주고 null 이면 끈다', () => {
    const service = new TaskQueueService([poolHandler().handler]);
    expect(service.setDevWorkerAccounts(ACCOUNTS)).toBe(2);
    expect(service.setDevWorkerAccounts(null)).toBe(0);
    cleanup(service);
  });
});
