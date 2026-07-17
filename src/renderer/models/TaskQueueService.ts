import { v4 } from 'uuid';
import { persistService } from './PersistenceService';
import {
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
  promptService,
  sessionService,
  taskQueueService,
  workFlowService,
} from '.';
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
import { expandPieces, lowerPromptNode, toPARR } from './PromptService';
import { dataUriToBase64 } from './ImageService';
import { prepareMirrorCanvas } from './workflows/SDWorkFlow';
import { getImageDimensions } from '../componenets/BrushTool';

export const FAST_TASK_TIME_ESTIMATOR_SAMPLE_COUNT = 16;
export const TASK_TIME_ESTIMATOR_SAMPLE_COUNT = 128;
export const TASK_DEFAULT_ESTIMATE = 22 * 1000;
const RANDOM_DELAY_BIAS = 6.0;
const RANDOM_DELAY_STD = 3.0;
const LARGE_RANDOM_DELAY_BIAS = RANDOM_DELAY_BIAS * 2;
const LARGE_RANDOM_DELAY_STD = RANDOM_DELAY_STD * 2;
const LARGE_WAIT_DELAY_BIAS = 5 * 60;
const LARGE_WAIT_DELAY_STD = 2.5 * 60;
const LARGE_WAIT_INTERVAL_BIAS = 500;
const LARGE_WAIT_INTERVAL_STD = 100;
export const FAST_TASK_DEFAULT_ESTIMATE =
  TASK_DEFAULT_ESTIMATE -
  RANDOM_DELAY_BIAS * 1000 -
  (RANDOM_DELAY_STD * 1000) / 2 +
  1000;

export interface TaskParam {
  session: Session;
  job: Job;
  outputPath: string;
  scene: GenericScene;
  onComplete?: (path: string) => void;
  nodelay?: boolean;
  // 생성 위임(W6 P3): 이 태스크가 보조 창에서 위임되어 호스트 창에서 실행 중이면
  // 채워진다. 존재하면 호스트는 로컬 onComplete/onAddImage 를 하지 않고(=자기 세션을
  // 건드리지 않음) 완료를 원 창에 브리지한다. 로컬 예약(단일 창 포함)은 항상 undefined.
  delegation?: DelegationInfo;
}

// 위임 태스크의 원 창 귀속 정보 — 완료 브리지·취소 매칭의 키.
export interface DelegationInfo {
  originWindowId: number; // 원 창 wcId (main 이 주입)
  taskId: string; // 원 창이 발급한 uuid — onComplete 대행 맵의 키
  sessionName: string;
  sceneName?: string;
  sceneType?: string;
}

// 보조 창 → 호스트로 넘기는 직렬화된 태스크 페이로드(순수 JSON).
export interface DelegatedTaskPayload {
  taskId: string;
  sessionName: string;
  sceneName?: string;
  sceneType?: string;
  job: any; // JSON 안전(PromptNode 트리 + toJSON 스냅샷된 vibes/references) — §검증 참조
  outputPath: string;
  samples: number;
  nodelay: boolean;
  hasOnComplete: boolean;
  originWindowId?: number; // main 이 주입
}

// 호스트 → 원 창 완료/실패 브리지 페이로드.
export interface DelegateCompletePayload extends DelegationInfo {
  status: 'ok' | 'fail' | 'done';
  path?: string;
  message?: string;
}

// 호스트 → 보조 창 큐 상태 미러(단일 출처라 합산 불필요).
export interface QueueMirror {
  running: boolean;
  doneTotal: number;
  total: number;
  etaMean: number;
  topTaskTimeMean: number;
  projectRemains: { [sessionName: string]: number };
  projectRunning: string | null;
  byOrigin: { [originWindowId: number]: number };
  // 씬 단위 통계(getSceneKey 키) — 보조 창의 씬 카드 예약 배지용(2026-07-17 실기 피드백).
  sceneStats: { [sceneKey: string]: TaskStats };
}

export interface Task {
  id: string | undefined;
  cls: number;
  params: TaskParam;
  done: number;
  total: number;
}

function getRandomInt(min: number, max: number): number {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min)) + min;
}

const MOD = 2100000000;
function randomBaseSeed() {
  return getRandomInt(1, MOD);
}

export function stepSeed(seed: number) {
  seed ^= seed << 13;
  seed ^= seed >> 17;
  seed ^= seed << 5;
  seed = (seed >>> 0) % MOD;
  return Math.max(1, seed);
}

// IP check function removed for performance optimization

interface TaskStats {
  done: number;
  total: number;
}

export class TaskTimeEstimator {
  samples: (number | undefined)[];
  cursor: number;
  maxSamples: number;
  defaultEstimate: number;
  constructor(maxSamples: number, defaultEstimate: number) {
    this.samples = new Array(maxSamples);
    this.maxSamples = maxSamples;
    this.cursor = 0;
    this.defaultEstimate = defaultEstimate;
  }

  addSample(time: number) {
    this.samples[this.cursor] = time;
    this.cursor = (this.cursor + 1) % this.maxSamples;
  }

  estimateMedian() {
    const smp = this.samples.filter((x) => x != undefined);
    smp.sort();
    if (smp.length) return smp[smp.length >> 1]!;
    return this.defaultEstimate;
  }

  estimateMean() {
    const smp = this.samples.filter((x) => x != undefined);
    smp.sort();
    if (smp.length) return (smp.reduce((x, y) => x! + y!, 0) ?? 0) / smp.length;
    return this.defaultEstimate;
  }
}

export interface TaskQueueRun {
  stopped: boolean;
  delayCnt: number;
  // 캐싱된 데이터 - 동일 세션/씬에서 재사용
  cachedVibes?: Map<string, { image: string; info: number; strength: number }>;
  cachedReferences?: Map<string, { image: string; info: number; strength: number; fidelity: number; referenceType: string; description: string }>;
  lastSessionName?: string;
}

export interface TaskInfo {
  name: string;
  emoji: string;
}

export interface CostItem {
  scene: string;
  text: string;
}

export interface TaskHandler {
  createTimeEstimator(): TaskTimeEstimator;
  checkTask(task: Task): boolean;
  handleTask(task: Task, run: TaskQueueRun): Promise<boolean>;
  getNumTries(task: Task): number;
  handleDelay(task: Task, numTry: number, delayTime: number): Promise<void>;
  getInfo(task: Task): TaskInfo;
  calculateCost(task: Task): CostItem[];
}

export const getSceneKey = (session: Session, scene: GenericScene) => {
  return session.name + '/' + scene.type + '/' + scene.name;
};

export async function handleNAIDelay(
  numTry: number,
  fast: boolean,
  delayTime: number,
) {
  if (numTry === 0 && fast) {
    await sleep(delayTime);
  } else if (numTry <= 2 && fast) {
    await sleep((1 + Math.random() * RANDOM_DELAY_STD) * delayTime);
  } else {
    console.log('slow delay');
    if (numTry === 0 && Math.random() > 0.98) {
      await sleep(
        (Math.random() * LARGE_RANDOM_DELAY_STD + LARGE_RANDOM_DELAY_BIAS) *
          delayTime,
      );
    } else {
      await sleep(
        (Math.random() * RANDOM_DELAY_STD + RANDOM_DELAY_BIAS) * delayTime,
      );
    }
  }
  return;
}

export type ImageTaskType = 'gen' | 'inpaint' | 'i2i';

export const lowerResolution = (res: Resolution, width?: number, height?: number) => {
  if (res === Resolution.Custom) {
    return {
      width: width!,
      height: height!,
    };
  } else {
    return convertResolution(res);
  }
};

export interface TaskLog {
  timestamp: number;
  level: 'info' | 'warn' | 'error';
  scene: string;
  message: string;
}

const MAX_TASK_LOGS = 500;
const TASK_LOGS_FILE = 'task_logs.json';

export class TaskQueueService extends EventTarget {
  queue: CircularQueue<Task>;
  handlers: TaskHandler[];
  timeEstimators: TaskTimeEstimator[];
  groupStats: TaskStats[];
  sceneStats: { [sceneKey: string]: TaskStats };
  currentRun: TaskQueueRun | undefined;
  taskSet: { [key: string]: boolean };
  taskLogs: TaskLog[] = [];
  // 진행 바 사이클 시작 시각(epoch ms) — 'start'/'complete' 발화 시점에 갱신.
  // 진행 바(TaskProgressBar)가 도크↔플로팅 이동 등으로 재마운트돼도 경과분을
  // 이어 그릴 수 있게 하는 단일 출처(컴포넌트 로컬 상태는 재마운트에 유실됨).
  progressCycleStartedAt = 0;
  private logsLoaded = false;
  private logsSaveTimer: any = null;

  // ─── 생성 위임: 단일 생성 호스트 (W6 P3) ───
  // 기본 true = "내가 생성 호스트" — 단일 창·모바일·주 창의 종전 경로. 데스크톱 멀티
  // 윈도우에서 보조 창만 부팅 시 false 로 갱신되어 제출/실행/취소를 호스트에 위임한다.
  isGenerationHost = true;
  // 호스트가 아는 보조 창 수 — 0이면 상태 스냅샷 브로드캐스트를 생략(단일 창 무부하).
  private peerWindowCount = 0;
  // 보조 창이 호스트로부터 받은 최신 큐 미러(표시 전용). 호스트는 항상 null(로컬 사용).
  private mirror: QueueMirror | null = null;
  // 위임한 태스크의 onComplete 대행 맵(원 창 보유) — taskId → 콜백.
  private delegatedCallbacks = new Map<string, (path: string) => void>();
  private snapshotThrottle: any = null;

  constructor(handlers: TaskHandler[]) {
    super();
    this.handlers = handlers;
    this.sceneStats = {};
    this.timeEstimators = [];
    this.groupStats = [];
    for (const handler of this.handlers) {
      this.timeEstimators.push(handler.createTimeEstimator());
      this.groupStats.push({ done: 0, total: 0 });
    }
    this.queue = new CircularQueue();
    this.taskSet = {};
  }

  addLog(level: TaskLog['level'], scene: string, message: string) {
    this.taskLogs.push({ timestamp: Date.now(), level, scene, message });
    if (this.taskLogs.length > MAX_TASK_LOGS) {
      this.taskLogs.splice(0, this.taskLogs.length - MAX_TASK_LOGS);
    }
    this.scheduleSaveLogs();
  }

  clearLogs() {
    this.taskLogs = [];
    // 파일도 즉시 비운다.
    this.flushSaveLogs();
  }

  // 시작 시 1회 호출(index.ts). 이전 실행에서 저장된 로그를 복원한다.
  async loadLogs(): Promise<void> {
    if (this.logsLoaded) return;
    let restored: TaskLog[] = [];
    try {
      const raw = await backend.readFile(TASK_LOGS_FILE);
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) restored = arr;
    } catch {
      // 파일 없음 — 무시
    }
    if (!this.logsLoaded) {
      // 로드 도중 새로 쌓인 로그(this.taskLogs)는 복원분 뒤에 이어 붙인다.
      this.taskLogs = [...restored, ...this.taskLogs].slice(-MAX_TASK_LOGS);
      this.logsLoaded = true;
    }
  }

  private scheduleSaveLogs() {
    if (this.logsSaveTimer) return; // 이미 예약됨 — 1.5초 윈도우로 묶어 쓴다.
    this.logsSaveTimer = setTimeout(() => {
      this.logsSaveTimer = null;
      this.flushSaveLogs();
    }, 1500);
  }

  async flushSaveLogs(): Promise<void> {
    if (this.logsSaveTimer) {
      clearTimeout(this.logsSaveTimer);
      this.logsSaveTimer = null;
    }
    try {
      await persistService.write(TASK_LOGS_FILE, JSON.stringify(this.taskLogs));
    } catch (e) {
      console.error('작업 로그 저장 실패:', e);
    }
  }

  // 취소는 전역 의미론(2026-07-17 실기 피드백): 어느 창에서 취소하든 호스트 큐의
  // 해당 예약 전부(모든 출처)가 취소된다 — 시작/정지의 전역 위임과 일관.
  removeAllTasks() {
    // 보조 창: 전체 취소를 호스트에 위임(호스트가 전 출처 큐를 비운다).
    if (!this.isGenerationHost) {
      backend
        .delegateCancel({ all: true })
        .catch((e) => console.error('예약 취소 위임 실패:', e));
      return;
    }
    while (!this.queue.isEmpty()) {
      const task = this.queue.peek();
      // 위임 태스크는 원 창의 onComplete 대행 콜백 정리를 알린다.
      this.notifyDelegationDone(task);
      this.removeTaskInternal(task);
      this.queue.dequeue();
    }
    this.dispatchProgress();
  }

  removeTasksFromScene(scene: GenericScene) {
    // 보조 창: 씬 단위 취소를 호스트에 위임(그 씬의 예약 전부 — 출처 무관).
    if (!this.isGenerationHost) {
      backend
        .delegateCancel({
          all: false,
          sessionName: appState.curSession?.name,
          sceneName: scene.name,
          sceneType: scene.type,
        })
        .catch((e) => console.error('씬 예약 취소 위임 실패:', e));
      return;
    }
    const oldQueue = this.queue;
    this.queue = new CircularQueue<Task>();
    while (!oldQueue.isEmpty()) {
      const task = oldQueue.peek();
      oldQueue.dequeue();
      this.removeTaskInternal(task);
      if (task.params.scene !== scene) {
        this.addTaskInternal(task);
      } else {
        this.notifyDelegationDone(task);
      }
    }
    this.dispatchProgress();
  }

  // 위임 태스크가 실행 없이 제거될 때 원 창에 'done'을 브리지해 onComplete 대행
  // 콜백 맵이 새지 않게 한다. 로컬 태스크(delegation 없음)는 no-op.
  private notifyDelegationDone(task: Task) {
    if (!task.params.delegation) return;
    backend
      .delegateComplete({ ...task.params.delegation, status: 'done' })
      .catch(() => {});
  }

  addTask(params: TaskParam, numExec: number) {
    // 생성 위임(W6 P3): 내가 호스트가 아니면(보조 창) 로컬 큐에 넣지 않고 호스트에
    // 위임한다. 호스트/단일 창/모바일은 그대로 로컬 경로(addTaskLocal) — 종전과 동일.
    if (!this.isGenerationHost) {
      this.delegateSubmit(params, numExec);
      return;
    }
    this.addTaskLocal(params, numExec);
  }

  // 로컬 큐에 실제로 태스크를 넣는다(기존 addTask 본체). 호스트의 위임 수신 경로도
  // 이 메서드를 직접 호출한다(재위임 방지).
  addTaskLocal(params: TaskParam, numExec: number) {
    const task: Task = {
      id: v4(),
      cls: -1,
      params: params,
      done: 0,
      total: numExec,
    };
    task.cls = this.getTaskCls(task);
    this.addTaskInternal(task);
  }

  addTaskInternal(task: Task) {
    this.queue.enqueue(task);
    this.taskSet[task.id!] = true;
    this.groupStats[task.cls].total += task.total;
    this.groupStats[task.cls].done += task.done;
    const sceneKey = task.params.scene
      ? getSceneKey(task.params.session, task.params.scene)
      : '';
    if (!(sceneKey in this.sceneStats)) {
      this.sceneStats[sceneKey] = { done: 0, total: 0 };
    }
    this.sceneStats[sceneKey].done += task.done;
    this.sceneStats[sceneKey].total += task.total;
    this.dispatchProgress();
  }

  getTaskCls(task: Task) {
    for (let i = 0; i < this.handlers.length; i++) {
      if (this.handlers[i].checkTask(task)) {
        return i;
      }
    }
    throw new Error('No task handler found');
  }

  isEmpty() {
    // 보조 창은 호스트 미러 기준(로컬 큐는 항상 비어 있음).
    if (!this.isGenerationHost)
      return (this.mirror?.total ?? 0) - (this.mirror?.doneTotal ?? 0) <= 0;
    return this.queue.isEmpty();
  }

  isRunning() {
    if (!this.isGenerationHost) return !!this.mirror?.running;
    return this.currentRun != undefined;
  }

  run() {
    // 보조 창의 시작 = 전역 실행을 호스트에 위임(사용자 합의).
    if (!this.isGenerationHost) {
      backend.delegateRun().catch((e) => console.error('실행 위임 실패:', e));
      return;
    }
    this.runLocal();
  }

  stop() {
    // 보조 창의 정지 = 전역 정지를 호스트에 위임.
    if (!this.isGenerationHost) {
      backend.delegateStop().catch((e) => console.error('정지 위임 실패:', e));
      return;
    }
    if (this.currentRun) {
      this.currentRun.stopped = true;
      this.currentRun = undefined;
      this.dispatchEvent(new CustomEvent('stop', {}));
      this.scheduleSnapshotBroadcast();
    }
  }

  getDelayCnt() {
    return Math.floor(
      LARGE_WAIT_INTERVAL_BIAS + Math.random() * LARGE_WAIT_INTERVAL_STD,
    );
  }

  runLocal() {
    if (!this.currentRun) {
      this.currentRun = {
        stopped: false,
        delayCnt: this.getDelayCnt(),
      };
      this.runInternal(this.currentRun);
      this.progressCycleStartedAt = Date.now();
      this.dispatchEvent(new CustomEvent('start', {}));
      this.scheduleSnapshotBroadcast();
    }
  }

  calculateCost(): CostItem[] {
    const res: CostItem[] = [];
    for (const task of this.queue) {
      const handler = this.handlers[task!.cls];
      const costs = handler.calculateCost(task!);
      res.push(...costs);
    }
    return res;
  }

  statsAllTasks(): TaskStats {
    if (!this.isGenerationHost && this.mirror)
      return { done: this.mirror.doneTotal, total: this.mirror.total };
    let done = 0;
    let total = 0;
    for (let i = 0; i < this.handlers.length; i++) {
      done += this.groupStats[i].done;
      total += this.groupStats[i].total;
    }
    return { done, total };
  }

  estimateTopTaskTime(type: 'median' | 'mean'): number {
    if (!this.isGenerationHost)
      return this.mirror?.topTaskTimeMean ?? 0;
    if (this.queue.isEmpty()) {
      return 0;
    }
    const task = this.queue.peek();
    if (type === 'mean') {
      return this.timeEstimators[task.cls].estimateMean();
    }
    return this.timeEstimators[task.cls].estimateMedian();
  }

  estimateTime(type: 'median' | 'mean'): number {
    if (!this.isGenerationHost) return this.mirror?.etaMean ?? 0;
    let res = 0;
    for (let i = 0; i < this.handlers.length; i++) {
      if (type === 'mean') {
        res +=
          this.timeEstimators[i].estimateMean() *
          (this.groupStats[i].total - this.groupStats[i].done);
      } else {
        res +=
          this.timeEstimators[i].estimateMedian() *
          (this.groupStats[i].total - this.groupStats[i].done);
      }
    }
    return res;
  }

  // 프로젝트(세션 이름)별 잔여 예약 수 + 현재 실행 중 프로젝트 스냅샷 —
  // 프로젝트 드로어 배지용 (일괄 생성 예약 확인, 2026-07-17).
  // 'progress'/'start'/'stop' 이벤트를 구독해 갱신한다.
  projectQueueSnapshot(): {
    remains: { [sessionName: string]: number };
    running: string | null;
  } {
    // 보조 창은 호스트 미러의 프로젝트별 잔여/실행 값을 그대로 표시(전 창 동일 값).
    if (!this.isGenerationHost && this.mirror)
      return {
        remains: this.mirror.projectRemains,
        running: this.mirror.projectRunning,
      };
    const remains: { [sessionName: string]: number } = {};
    for (const task of this.queue) {
      const remain = task!.total - task!.done;
      if (remain <= 0) continue;
      const n = task!.params.session.name;
      remains[n] = (remains[n] ?? 0) + remain;
    }
    const running =
      this.isRunning() && !this.queue.isEmpty()
        ? this.queue.peek().params.session.name
        : null;
    return { remains, running };
  }

  statsTasksFromScene(session: Session, scene: GenericScene): TaskStats {
    const sceneKey = getSceneKey(session, scene);
    // 보조 창은 호스트 미러의 씬 단위 통계로 응답(로컬 큐는 항상 비어 있음) —
    // 씬 카드 예약 배지가 호스트 큐 기준으로 표시된다.
    if (!this.isGenerationHost) {
      const m = this.mirror?.sceneStats?.[sceneKey];
      return m ? { done: m.done, total: m.total } : { done: 0, total: 0 };
    }
    let done = 0;
    let total = 0;
    if (sceneKey in this.sceneStats) {
      done += this.sceneStats[sceneKey].done;
      total += this.sceneStats[sceneKey].total;
    }
    return { done, total };
  }

  dispatchProgress() {
    this.dispatchEvent(new CustomEvent('progress', {}));
    // 호스트: 큐 변경을 보조 창들에 미러(스로틀). 보조 창 0개면 완전 생략.
    this.scheduleSnapshotBroadcast();
  }

  removeTaskInternal(task: Task) {
    this.groupStats[task.cls].done -= task.done;
    this.groupStats[task.cls].total -= task.total;
    const sceneKey = task.params.scene
      ? getSceneKey(task.params.session, task.params.scene)
      : '';
    if (sceneKey in this.sceneStats) {
      this.sceneStats[sceneKey].done -= task.done;
      this.sceneStats[sceneKey].total -= task.total;
    }
    delete this.taskSet[task.id!];
  }

  private getRetryTimeoutMs(retryIndex: number): number {
    if (retryIndex < 10) return 120 * 1000;
    return 180 * 1000;
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout')), timeoutMs);
      promise.then(
        (v) => { clearTimeout(timer); resolve(v); },
        (e) => { clearTimeout(timer); reject(e); },
      );
    });
  }

  async runInternal(cur: TaskQueueRun) {
    this.dispatchProgress();
    const config = await backend.getConfig();
    const delayTime = config.delayTime ?? 0;
    while (!this.queue.isEmpty()) {
      const task = this.queue.peek();
      if (task.done >= task.total) {
        // 위임 태스크가 전량 완료됨 — 원 창의 onComplete 대행 콜백 정리를 알린다.
        if (task.params.delegation) {
          backend
            .delegateComplete({ ...task.params.delegation, status: 'done' })
            .catch(() => {});
        }
        this.removeTaskInternal(task);
        this.queue.dequeue();
        continue;
      }
      let done = false;
      const before = Date.now();
      const handler = this.handlers[task.cls];
      const numTries = handler.getNumTries(task);
      for (let i = 0; i < numTries; i++) {
        if (cur.stopped) {
          this.dispatchProgress();
          return;
        }
        try {
          await handler.handleDelay(task, i, delayTime);
          const timeoutMs = this.getRetryTimeoutMs(i);
          await this.withTimeout(handler.handleTask(task, cur), timeoutMs);
          const after = Date.now();
          this.timeEstimators[task.cls].addSample(after - before);
          done = true;
          cur.delayCnt--;
          if (cur.delayCnt === 0) {
            await sleep(
              (Math.random() * LARGE_WAIT_DELAY_STD + LARGE_WAIT_DELAY_BIAS) *
                delayTime,
            );
            cur.delayCnt = this.getDelayCnt();
          }
          if (!cur.stopped) {
            task.done++;
            if (task.id! in this.taskSet) {
              this.groupStats[task.cls].done++;
              const sceneKey = task.params.scene
                ? getSceneKey(task.params.session, task.params.scene)
                : '';
              this.sceneStats[sceneKey].done++;
            }
          }
          this.progressCycleStartedAt = Date.now();
          this.dispatchEvent(new CustomEvent('complete', {}));
          this.dispatchProgress();
        } catch (e: any) {
          const sceneName = task.params.scene?.name ?? '(unknown)';
          if (e.message === 'IP') {
            this.addLog('error', sceneName, 'IP 변경 감지로 중단');
            this.dispatchEvent(new CustomEvent('ip-check-fail', {}));
            this.stop();
            return;
          }
          // 429 rate limit: 60초 대기 후 재시도
          if (e.message && e.message.includes('429')) {
            this.addLog('warn', sceneName, `요청 제한 (429) - 60초 대기 후 재시도 [${i + 1}/${numTries}]`);
            console.log('Rate limited (429), waiting 60s before retry...');
            this.dispatchEvent(
              new CustomEvent('error', {
                detail: { error: '요청 제한 (429) - 60초 대기 후 재시도', task: task },
              }),
            );
            await sleep(60 * 1000);
          } else {
            this.addLog('error', sceneName, `${e.message} [${i + 1}/${numTries}]`);
            this.dispatchEvent(
              new CustomEvent('error', {
                detail: { error: e.message, task: task },
              }),
            );
          }
          console.error(e);
        }
        if (done) {
          break;
        }
      }
      if (!done) {
        // 실패한 태스크를 건너뛰고 다음 태스크로 진행
        const sceneName = task.params.scene?.name ?? '(unknown)';
        this.addLog('error', sceneName, `${numTries}회 재시도 실패 - 건너뜀`);
        console.log('SKIPPING FAILED TASK:', task.params.scene?.name);
        this.dispatchEvent(
          new CustomEvent('error', {
            detail: { error: '재시도 초과로 건너뜀', task: task },
          }),
        );
        // 위임 태스크 실패 — 원 창에 토스트로 통지(브리지).
        if (task.params.delegation) {
          backend
            .delegateComplete({
              ...task.params.delegation,
              status: 'fail',
              message: `생성 실패(재시도 초과): ${sceneName}`,
            })
            .catch(() => {});
        }
        this.removeTaskInternal(task);
        this.queue.dequeue();
        this.dispatchProgress();
        continue;
      }
    }
    if (cur == this.currentRun) {
      this.dispatchEvent(new CustomEvent('stop', {}));
      this.currentRun = undefined;
    }
    this.dispatchProgress();
  }

  getTaskInfo(task: Task) {
    return this.handlers[task.cls].getInfo(task);
  }

  // ─── 생성 위임: 브리지 배선/메서드 (W6 P3) ───

  // 부팅 시 1회 호출(bootstrap). 데스크톱에서만 실제 IPC 가 연결되고, 모바일/단일 창은
  // backend 기본 구현이 no-op·항상 호스트라 아무 배선도 하지 않는다(무영향).
  async initGenerationHostBridge(): Promise<void> {
    try {
      this.isGenerationHost = await backend.isGenerationHost();
    } catch (e) {
      console.error('생성 호스트 조회 실패(호스트로 간주):', e);
      this.isGenerationHost = true;
    }
    backend.onGenerationHostChanged((isHost) => {
      const was = this.isGenerationHost;
      this.isGenerationHost = isHost;
      // 승격으로 호스트가 되면 미러를 버리고 로컬 상태로 전환, UI 재평가를 알린다.
      if (isHost && !was) this.mirror = null;
      this.dispatchEvent(new CustomEvent('progress', {}));
    });
    backend.onGenerationPeerCount((count) => {
      this.peerWindowCount = count;
      // 보조 창이 막 붙었을 때 다음 큐 변경까지 기다리지 않고 즉시 현재 상태를 미러링.
      if (count > 0) this.scheduleSnapshotBroadcast();
    });
    // 호스트 수신부
    backend.onDelegateTask((payload) => this.receiveDelegatedTask(payload));
    backend.onDelegateCancel((payload) => this.receiveDelegatedCancel(payload));
    backend.onDelegateRun(() => this.runLocal());
    backend.onDelegateStop(() => this.stop());
    // 원 창/보조 창 수신부
    backend.onDelegateComplete((payload) =>
      this.receiveDelegatedComplete(payload),
    );
    backend.onDelegateQueueSnapshot((snap) => this.receiveQueueMirror(snap));
  }

  // 보조 창 → 호스트: TaskParam 을 직렬화해 제출을 위임한다. originWindowId 는 main 이
  // 주입하므로 여기서 보내지 않는다. onComplete 는 원 창에 남겨 두고 taskId 로 대행한다.
  private delegateSubmit(params: TaskParam, numExec: number) {
    const taskId = v4();
    if (params.onComplete) this.delegatedCallbacks.set(taskId, params.onComplete);
    const payload: DelegatedTaskPayload = {
      taskId,
      sessionName: params.session.name,
      sceneName: params.scene?.name,
      sceneType: params.scene?.type,
      // JSON 왕복 = 위임 직렬화 계층. job 은 이미 순수 JSON(PromptNode 트리 +
      // 예약 시점 toJSON 스냅샷된 vibes/references)이라 함수/클래스/순환이 없다.
      job: JSON.parse(JSON.stringify(params.job)),
      outputPath: params.outputPath,
      samples: numExec,
      nodelay: !!params.nodelay,
      hasOnComplete: !!params.onComplete,
    };
    backend.delegateTask(payload).catch((e) => {
      console.error('생성 위임 실패:', e);
      this.delegatedCallbacks.delete(taskId);
      appState.pushMessage('생성을 주 창에 위임하지 못했습니다.');
    });
  }

  // 호스트: 위임된 태스크를 세션/씬 이름으로 재바인딩해 로컬 큐에 넣는다.
  // 안전: 로드는 읽기 전용이며, delegation 표식이 있어 호스트는 완료 시 자기 세션의
  // imageMap 을 건드리지 않는다(원 창이 갱신). 세션은 dirty 로 마킹되지 않는다.
  private async receiveDelegatedTask(payload: DelegatedTaskPayload) {
    const fail = (message: string) => {
      if (payload.originWindowId == null) return;
      backend
        .delegateComplete({
          originWindowId: payload.originWindowId,
          taskId: payload.taskId,
          sessionName: payload.sessionName,
          sceneName: payload.sceneName,
          sceneType: payload.sceneType,
          status: 'fail',
          message,
        })
        .catch(() => {});
    };
    try {
      const session = await sessionService.get(payload.sessionName);
      if (!session) {
        fail(`위임 실패: 프로젝트 "${payload.sessionName}"를 찾을 수 없습니다.`);
        return;
      }
      let scene: GenericScene | undefined;
      if (payload.sceneName) {
        scene = session.getScene(
          (payload.sceneType as 'scene' | 'inpaint') ?? 'scene',
          payload.sceneName,
        );
        if (!scene) {
          fail(`위임 실패: 씬 "${payload.sceneName}"를 찾을 수 없습니다.`);
          return;
        }
      }
      const param: TaskParam = {
        session,
        job: payload.job as Job,
        scene: scene as GenericScene,
        outputPath: payload.outputPath,
        nodelay: payload.nodelay,
        delegation: {
          originWindowId: payload.originWindowId!,
          taskId: payload.taskId,
          sessionName: payload.sessionName,
          sceneName: payload.sceneName,
          sceneType: payload.sceneType,
        },
      };
      this.addTaskLocal(param, payload.samples);
    } catch (e: any) {
      console.error('위임 태스크 수신 실패:', e);
      fail(`위임 처리 오류: ${e?.message ?? e}`);
    }
  }

  // 호스트: 보조 창의 취소 요청 — 전역 의미론(2026-07-17 실기 피드백).
  // all=true 면 큐 전체(모든 출처), 아니면 세션+씬 일치분 전부(출처 무관)를 제거한다.
  // 제거되는 위임 태스크는 원 창에 'done' 브리지(대행 콜백 정리).
  private receiveDelegatedCancel(payload: {
    originWindowId?: number;
    all?: boolean;
    sessionName?: string;
    sceneName?: string;
    sceneType?: string;
  }) {
    if (payload.all) {
      this.removeAllTasks(); // 호스트 로컬 경로 — 전 출처 제거+done 브리지 포함
      return;
    }
    const oldQueue = this.queue;
    this.queue = new CircularQueue<Task>();
    while (!oldQueue.isEmpty()) {
      const task = oldQueue.peek();
      oldQueue.dequeue();
      this.removeTaskInternal(task);
      // 이름 기준 매칭 — 호스트 로컬 태스크·타 창 위임 태스크 모두 포함
      const match =
        task.params.session.name === payload.sessionName &&
        task.params.scene?.name === payload.sceneName &&
        task.params.scene?.type === payload.sceneType;
      if (match) {
        this.notifyDelegationDone(task);
      } else {
        this.addTaskInternal(task);
      }
    }
    this.dispatchProgress();
  }

  // 원 창: 위임한 태스크의 이미지 1장 완료/실패/전량완료 수신.
  private receiveDelegatedComplete(payload: DelegateCompletePayload) {
    if (payload.status === 'fail') {
      this.delegatedCallbacks.delete(payload.taskId);
      if (payload.message) appState.pushMessage(payload.message);
      return;
    }
    if (payload.status === 'done') {
      // 전량 완료 — 대행 콜백 정리(더 이상 발화 없음).
      this.delegatedCallbacks.delete(payload.taskId);
      return;
    }
    // status === 'ok' — 자기 세션 인스턴스의 그리드/imageMap 을 갱신한다.
    // (chokidar 감시는 config.refreshImage OFF 면 안 돌므로 이 브리지가 정식 경로)
    const session = sessionService.getFast(payload.sessionName);
    if (session && payload.sceneName && payload.path) {
      if (payload.sceneType === 'inpaint') {
        imageService.onAddInPaint(session, payload.sceneName, payload.path);
      } else {
        imageService.onAddImage(session, payload.sceneName, payload.path);
      }
    }
    const cb = this.delegatedCallbacks.get(payload.taskId);
    if (cb && payload.path) cb(payload.path);
  }

  // 보조 창: 호스트가 보낸 큐 미러를 저장하고, UI 갱신용 이벤트로 변환한다.
  private receiveQueueMirror(snap: QueueMirror) {
    const prev = this.mirror;
    const prevRunning = prev?.running ?? false;
    const prevDone = prev?.doneTotal ?? 0;
    this.mirror = snap;
    // 진행 바 사이클 갱신 — 이미지 1장 완료(done 증가)나 실행 시작 시 리셋.
    if (snap.doneTotal > prevDone || (snap.running && !prevRunning)) {
      this.progressCycleStartedAt = Date.now();
    }
    this.dispatchEvent(new CustomEvent('progress', {}));
    if (snap.running && !prevRunning)
      this.dispatchEvent(new CustomEvent('start', {}));
    if (!snap.running && prevRunning)
      this.dispatchEvent(new CustomEvent('stop', {}));
    if (snap.doneTotal > prevDone)
      this.dispatchEvent(new CustomEvent('complete', {}));
  }

  // 호스트: 보조 창들에 큐 미러를 브로드캐스트(스로틀 300ms). 보조 창 0개면 생략해
  // 단일 창에서는 아무 부하도 없다. 미러 값은 전부 로컬 계산(호스트=isGenerationHost).
  private scheduleSnapshotBroadcast() {
    if (!this.isGenerationHost || this.peerWindowCount <= 0) return;
    if (this.snapshotThrottle) return;
    this.snapshotThrottle = setTimeout(() => {
      this.snapshotThrottle = null;
      backend.delegateQueueSnapshot(this.buildMirror()).catch(() => {});
    }, 300);
  }

  private buildMirror(): QueueMirror {
    const stats = this.statsAllTasks();
    const snap = this.projectQueueSnapshot();
    const byOrigin: { [originWindowId: number]: number } = {};
    for (const task of this.queue) {
      const remain = task!.total - task!.done;
      if (remain <= 0) continue;
      const oid = task!.params.delegation?.originWindowId ?? 0; // 0 = 호스트 자신
      byOrigin[oid] = (byOrigin[oid] ?? 0) + remain;
    }
    // 씬 단위 통계 — 잔여가 있는 항목만 실어 페이로드를 작게 유지
    // (sceneStats 는 제거 시 감산되므로 0 잔여 항목이 남아 있을 수 있다).
    const sceneStats: { [sceneKey: string]: TaskStats } = {};
    for (const [key, s] of Object.entries(this.sceneStats)) {
      if (s.total - s.done > 0) sceneStats[key] = { done: s.done, total: s.total };
    }
    return {
      running: this.isRunning(),
      doneTotal: stats.done,
      total: stats.total,
      etaMean: this.estimateTime('mean'),
      topTaskTimeMean: this.estimateTopTaskTime('mean'),
      projectRemains: snap.remains,
      projectRunning: snap.running,
      byOrigin,
      sceneStats,
    };
  }
}


export const queueWorkflow = async (
  session: Session,
  workflow: SelectedWorkflow,
  scene: GenericScene,
  samples: number,
) => {
  const [type, preset, shared, def] = session.getCommonSetup(workflow);
  const prompts = await def.createPrompt!(session, scene, preset, shared);
  const characterPrompts = await def.createCharacterPrompts!(
    session,
    scene,
    preset,
    shared,
  );
  const scene_ = scene as Scene;
  for (let i = 0; i < prompts.length; i++) {
    await def.handler(
      session,
      scene,
      prompts[i],
      characterPrompts[i],
      preset,
      shared,
      samples,
      scene_.meta.get(type),
    );
  }
};

export const queueI2IWorkflow = async (
  session: Session,
  type: string,
  preset: any,
  scene: GenericScene,
  samples: number,
  onComplete?: (path: string) => void,
) => {
  const def = workFlowService.getDef(type)!;
  console.log('queueI2IWorkflow', type, preset, scene, samples, onComplete);
  await def.handler(
    session,
    scene,
    { type: 'text', text: '' },
    [],
    preset,
    undefined,
    samples,
    undefined,
    onComplete,
  );
};

export const queueMirrorWorkflow = async (
  session: Session,
  type: string,
  preset: any,
  scene: InpaintScene,
  samples: number,
  onComplete?: (path: string) => void,
) => {
  const def = workFlowService.getDef(type);

  // 미러 이미지가 씬에 아직 설정되지 않았으면 세션 미러 이미지로 자동 생성
  if (!preset.image) {
    if (!session.mirrorImage) {
      throw new Error('미러 이미지를 먼저 업로드해주세요.');
    }
    const srcData = await imageService.fetchVibeImage(
      session,
      session.mirrorImage,
    );
    if (!srcData) {
      throw new Error('미러 이미지를 불러올 수 없습니다.');
    }
    const srcBase64 = dataUriToBase64(srcData);
    const result = await prepareMirrorCanvas(srcBase64, session.mirrorMode || 'blank');
    preset.image = await imageService.storeVibeImage(session, result.canvas);
    preset.mask = await imageService.storeVibeImage(session, result.mask);
    scene.resolution = 'custom';
    scene.resolutionWidth = result.width;
    scene.resolutionHeight = result.height;
    scene.mirrorCropX = result.cropX;
  }

  if (scene.slots.length === 0) {
    await def!.handler(
      session,
      scene,
      { type: 'text', text: '' },
      [],
      preset,
      undefined,
      samples,
      undefined,
      onComplete,
    );
    return;
  }

  const combinations: string[][] = [];
  const current: string[] = [];
  const traverse = () => {
    if (current.length === scene.slots.length) {
      combinations.push([...current]);
      return;
    }
    const level = current.length;
    let hasEnabled = false;
    for (const piece of scene.slots[level]) {
      if (piece.enabled === undefined || piece.enabled) {
        hasEnabled = true;
        current.push(piece.prompt);
        traverse();
        current.pop();
      }
    }
    if (!hasEnabled) {
      current.push('');
      traverse();
      current.pop();
    }
  };
  traverse();

  for (const combo of combinations) {
    const middlePrompt = combo.filter(Boolean).join(', ');
    const mergedPreset = { ...preset, prompt: middlePrompt };
    await def!.handler(
      session,
      scene,
      { type: 'text', text: '' },
      [],
      mergedPreset,
      undefined,
      samples,
      undefined,
      onComplete,
    );
  }
};
