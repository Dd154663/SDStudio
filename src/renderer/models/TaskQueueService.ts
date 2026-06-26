import { v4 } from 'uuid';
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
  private logsLoaded = false;
  private logsSaveTimer: any = null;
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
      await backend.writeFile(TASK_LOGS_FILE, JSON.stringify(this.taskLogs));
    } catch (e) {
      console.error('작업 로그 저장 실패:', e);
    }
  }

  removeAllTasks() {
    while (!this.queue.isEmpty()) {
      const task = this.queue.peek();
      this.removeTaskInternal(task);
      this.queue.dequeue();
    }
    this.dispatchProgress();
  }

  removeTasksFromScene(scene: GenericScene) {
    const oldQueue = this.queue;
    this.queue = new CircularQueue<Task>();
    while (!oldQueue.isEmpty()) {
      const task = oldQueue.peek();
      oldQueue.dequeue();
      this.removeTaskInternal(task);
      if (task.params.scene !== scene) {
        this.addTaskInternal(task);
      }
    }
    this.dispatchProgress();
  }

  addTask(params: TaskParam, numExec: number) {
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
    return this.queue.isEmpty();
  }

  isRunning() {
    return this.currentRun != undefined;
  }

  stop() {
    if (this.currentRun) {
      this.currentRun.stopped = true;
      this.currentRun = undefined;
      this.dispatchEvent(new CustomEvent('stop', {}));
    }
  }

  getDelayCnt() {
    return Math.floor(
      LARGE_WAIT_INTERVAL_BIAS + Math.random() * LARGE_WAIT_INTERVAL_STD,
    );
  }

  run() {
    if (!this.currentRun) {
      this.currentRun = {
        stopped: false,
        delayCnt: this.getDelayCnt(),
      };
      this.runInternal(this.currentRun);
      this.dispatchEvent(new CustomEvent('start', {}));
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
    let done = 0;
    let total = 0;
    for (let i = 0; i < this.handlers.length; i++) {
      done += this.groupStats[i].done;
      total += this.groupStats[i].total;
    }
    return { done, total };
  }

  estimateTopTaskTime(type: 'median' | 'mean'): number {
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

  statsTasksFromScene(session: Session, scene: GenericScene): TaskStats {
    let done = 0;
    let total = 0;
    const sceneKey = getSceneKey(session, scene);
    if (sceneKey in this.sceneStats) {
      done += this.sceneStats[sceneKey].done;
      total += this.sceneStats[sceneKey].total;
    }
    return { done, total };
  }

  dispatchProgress() {
    this.dispatchEvent(new CustomEvent('progress', {}));
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
  const def = workFlowService.getDef(type);
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
