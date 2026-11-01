import { v4 } from 'uuid';
import { persistService } from './PersistenceService';
import {
  convertResolution,
  GenerationSettingsSnapshot,
  ImageAugmentInput,
  ImageGenInput,
  ImageSize,
  Model,
  ModelVersion,
  NoiseSchedule,
  Resolution,
  Sampling,
} from '../backends/imageGen';
import { captureGenerationSettings } from '../backends/generationSettings';
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
import { expandPieces, lowerPromptNode, toPARR } from './PromptService';
import { dataUriToBase64 } from './ImageService';
import { prepareMirrorCanvas } from './workflows/SDWorkFlow';
import { variantComboMode } from './comboMode';
import {
  comboHandlerPreset,
  expandVariantCombos,
  variantComboSource,
} from './variantCombo';
import { getImageDimensions } from '../componenets/BrushTool';
import {
  isNaiAuthError,
  isNaiConcurrentError,
  isNaiRateLimitError,
  naiErrorKindLabel,
} from '../backends/genVendors/naiErrors';
import {
  computeLongBreakMs,
  computeRequestDelayMs,
  CONSECUTIVE_FAILURE_STOP,
  isRequestTimeoutError,
  nextLongBreakCount,
  nextRequestTimeoutMs,
  queueAttemptTimeoutMs,
  RequestDelaySettings,
  RequestTimeoutError,
  resolveRequestDelaySettings,
  retryWaitMs,
  shouldResetLongBreakCounter,
  sleepUnlessStopped,
  TASK_ESTIMATE_DEFAULT_MS,
  TASK_FAILURE_TEXT,
} from './requestTiming';
import {
  DEFAULT_WORKER_ID,
  isTaskSettled,
  isWorkerDeclinedError,
  normalizeWorkerAccounts,
  QueueWorkerAccount,
  RATE_LIMIT_IP_WINDOW_MS,
  RateLimitHit,
  remainingImageCount,
  returnImageIndex,
  shouldPauseAllForRateLimit,
  staggeredLongBreakCount,
  takeImageIndex,
  unclaimedImageCount,
  WORKER_POOL_TEXT,
} from './queueWorkerPool';

export const FAST_TASK_TIME_ESTIMATOR_SAMPLE_COUNT = 16;
export const TASK_TIME_ESTIMATOR_SAMPLE_COUNT = 128;
// 요청 사이 지연은 배수 구조를 폐지하고 「기본 ± 무작위」 하나로 통일했다(2026-10-03 T3,
// requestTiming). 빠른 생성과 일반 큐의 평균 지연이 거의 같아(급등은 2%·×1.5~2) 기본 예상도 같다.
export const TASK_DEFAULT_ESTIMATE = TASK_ESTIMATE_DEFAULT_MS;
export const FAST_TASK_DEFAULT_ESTIMATE = TASK_ESTIMATE_DEFAULT_MS;

export interface TaskParam {
  session: Session;
  job: Job;
  outputPath: string;
  scene: GenericScene;
  onComplete?: (path: string) => void;
  nodelay?: boolean;
  // 예약 순간의 전역 생성 설정. 구 작업·구 위임 payload에는 없을 수 있으며,
  // 그 경우 실행 시 기존 config 해석 경로로 폴백한다.
  generationSnapshot?: GenerationSettingsSnapshot;
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
  generationSnapshot?: GenerationSettingsSnapshot;
  originWindowId?: number; // main 이 주입
}

// 호스트 → 원 창 완료/실패 브리지 페이로드.
export interface DelegateCompletePayload extends DelegationInfo {
  status: 'ok' | 'fail' | 'done';
  path?: string;
  replacedPath?: string;
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
  // 긴 휴식 표시(T3b): 휴식 시작·끝 시각(epoch ms, 휴식 아님 = 0). 구 호스트 미러에는 없을 수 있다.
  longBreakStartedAt?: number;
  longBreakUntil?: number;
  // 동시에 생성 중인 워커(계정) 수(부스트 B1). 구 호스트 미러에는 없다 — 없으면 1. etaMean·topTaskTimeMean 은
  // 호스트가 이미 이 수로 나눈 값이다(보조 창이 다시 나누지 않는다).
  boostWorkers?: number;
}

export interface Task {
  id: string | undefined;
  cls: number;
  params: TaskParam;
  done: number;
  total: number;
  // 씬 통계 키 — 예약 시점에 1회 계산해 고정한다. 실행 중 씬/프로젝트 이름이
  // 바뀌어도 추가(+)와 제거(-)가 같은 키를 쓰도록 하기 위함(음수 배지 방지).
  sceneKey?: string;
  // 프로젝트 통계 키도 예약 시점에 고정한다. 프로젝트 이름 변경 시 명시적으로
  // 이관해 추가·완료·제거가 항상 같은 버킷을 사용하도록 한다.
  projectKey?: string;
  // 고정 시드 연쇄 위치(메모리 전용, 부스트 B0) — 이 작업에서 시드를 소비한 장 수. 다음 장의 시드 =
  // seedSchedule.seedForImageIndex(job.seed, seedCursor). job 은 변이하지 않는다. 없으면 0.
  // B1 부터 큐 실행은 장 번호(ctx.imageIndex)를 쓰고, 이 커서는 큐 밖에서 핸들러를 직접 부를 때만 쓴다.
  seedCursor?: number;
  // ─── 장 단위 할당(부스트 B1, 메모리 전용 — 규칙은 queueWorkerPool) ───
  // 워커가 꺼냈지만 아직 끝나지 않은 장 수. 꺼낼 수 있는 조건 = done + skipped + inFlight < total.
  inFlight?: number;
  // 다중 워커에서 재시도를 다 써 그 장만 건너뛴 수(D6). 단일 워커는 종전대로 예약 전체를 건너뛰므로 늘지 않는다.
  // 통계(group/scene/project)의 total 에는 total − skipped 로 들어간다.
  skipped?: number;
  // 다음에 줄 새 장 번호(0부터)와 돌려받은 번호(오름차순) — 장 번호 = 시드 연쇄 위치.
  nextImageIndex?: number;
  returnedImageIndices?: number[];
  // 이 작업을 「기본 계정 필요」로 넘긴 워커 id(그 워커는 다시 꺼내지 않는다).
  declinedWorkerIds?: string[];
}

// 고정 시드 연쇄(xorshift32)는 순수 모듈 seedSchedule 이 단일 출처(부스트 B0) — 구 import 호환 재수출.
export { stepSeed } from './seedSchedule';

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

// 실행(run) 하나. 워커 풀(B1)에서는 기본 워커가 이 객체를 그대로 쓰고, 추가 워커는 stopped 를 이 객체와
// 공유하는(접근자) 별도 객체를 받는다 — 캐시(cachedVibes 등)는 워커마다 따로, 정지는 그룹 전체가 함께.
export interface TaskQueueRun {
  stopped: boolean;
  // (T3b) 긴 휴식 카운터는 run 이 아니라 서비스 수준(TaskQueueService.longBreakRemaining)이다.
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

// 큐가 한 번의 시도마다 핸들러에 넘기는 문맥(2026-10-03 갈래 T2, requestTiming). 구 호출부·
// 테스트처럼 생략하면 backend 기본 타임아웃(120초)·취소 없음으로 동작한다.
export interface TaskAttemptContext {
  /** 이 시도의 세대 번호(서비스 전체에서 증가). */
  attempt: number;
  /** 이 시도가 폐기(바깥 타임아웃)되면 abort — fetcher 까지 넘겨 진행 중 요청을 끊고,
   *  늦게 도착한 결과를 저장하지 않는 판정에도 쓴다. */
  signal: AbortSignal;
  /** 안쪽 요청 타임아웃(ms). 같은 작업이 타임아웃으로 실패할 때마다 늘어난다. */
  requestTimeoutMs: number;
  /** 사용자 입력(Anlas 확인 창 등)을 기다리는 동안 바깥 타임아웃을 멈추고, 끝나면 처음부터 다시 잰다. */
  pauseTimeoutWhile<T>(fn: () => Promise<T>): Promise<T>;
  /** 주 요청 직전에 바깥 타임아웃을 처음부터 다시 잰다(앞선 보조 요청·조회 시간 제외). */
  restartTimeout(): void;
  /** 이 시도가 맡은 장 번호(0부터, 큐가 꺼낼 때 확정 — 재시도는 같은 번호). 생성 핸들러는 이 번호로
   *  시드를 정한다(seedForImageIndex). 없으면(큐 밖 직접 호출) Task.seedCursor 폴백(B0). */
  imageIndex?: number;
  /** 이 시도를 맡은 워커(부스트 B1). 없거나 기본 워커면 종전대로 활성 계정(TOKEN.txt). */
  worker?: TaskAttemptWorker;
}

// 시도를 맡은 워커 정보. token 은 메모리로만 흐른다 — 로그·미러·IPC·이미지 메타에 싣지 않는다.
export interface TaskAttemptWorker {
  id: string;
  name: string;
  isDefault: boolean;
  /** 기본 워커가 아니면 이 계정의 토큰(backend.generateImage(arg, { token })). */
  token?: string;
}

export interface TaskHandler {
  createTimeEstimator(): TaskTimeEstimator;
  checkTask(task: Task): boolean;
  handleTask(
    task: Task,
    run: TaskQueueRun,
    ctx?: TaskAttemptContext,
  ): Promise<boolean>;
  getNumTries(task: Task): number;
  /** 시도 앞 대기. pendingCount = 대기 시점의 큐 잔량(장, 소량 예약 완화 판정용).
   *  shouldStop 이 참이 되면 남은 대기를 버리고 바로 끝난다(큐는 `() => cur.stopped`, T4). */
  handleDelay(
    task: Task,
    numTry: number,
    delay: RequestDelaySettings,
    pendingCount: number,
    shouldStop: () => boolean,
  ): Promise<void>;
  /** 실패를 사용자에게 알릴 별도 문구(없으면 오류 메시지 그대로). 문구가 있으면 큐가 로그·진행 바·
   *  오류 토스트에 그 문구를 쓴다 — 예: 업스케일 타임아웃(재시도하지 않는 이유 안내, T4). */
  failureNotice?(task: Task, error: unknown): string | undefined;
  /** 기본 워커가 아닌 워커(다른 계정 토큰)가 이 작업을 처리할 수 있는가(부스트 B1). 없으면 기본 워커만. */
  supportsWorkerAccount?(task: Task): boolean;
  getInfo(task: Task): TaskInfo;
  calculateCost(task: Task): CostItem[];
}

export const getSceneKey = (session: Session, scene: GenericScene) => {
  return session.name + '/' + scene.type + '/' + scene.name;
};

// NAI 요청 시도 앞 대기(2026-10-03 T3, 식은 requestTiming.computeRequestDelayMs).
// 첫 시도(numTry 0)에만 기다린다 — 재시도는 큐의 오류 재시도 대기(retryWaitMs 사다리)만 쓴다
// (예전엔 둘 다 기다리는 이중 대기). 빠른 생성(fast)은 급등 없음, 큐 잔량 20장 이하는 소량 완화.
// 대기는 정지 가능(sleepUnlessStopped — shouldStop 이 참이면 즉시 끝남, T4). 정지 뒤 요청을 보내지
// 않는 판정은 큐(워커 루프 processClaim)가 한다. 계산한 대기 시간(ms)을 돌려준다(재시도·0 이면 0).
export async function handleNAIDelay(
  numTry: number,
  fast: boolean,
  settings: RequestDelaySettings,
  pendingCount: number,
  shouldStop: () => boolean,
  rand: () => number = Math.random,
): Promise<number> {
  if (numTry >= 1) return 0;
  const ms = computeRequestDelayMs(settings, { fast, pendingCount }, rand);
  if (ms > 0) await sleepUnlessStopped(ms, shouldStop);
  return ms;
}

export type ImageTaskType = 'gen' | 'inpaint' | 'i2i';

export const lowerResolution = (
  res: Resolution | ImageSize,
  width?: number,
  height?: number,
) => {
  if (typeof res === 'object') {
    return { width: res.width, height: res.height };
  }
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
// 일괄 예약 묶음 안의 중간 진행 반영 간격(ms). 묶음이 이보다 짧으면 마지막 1회만 보낸다.
export const PROGRESS_BATCH_INTERVAL_MS = 500;
const TASK_LOGS_FILE = 'task_logs.json';

// ─── 워커 풀(부스트 B1, 메모리 전용) ───
// 워커 하나 = 계정 하나 = 동시에 진행 중인 요청 최대 1개(409 「concurrent generation is locked」 회피).

// 워커가 꺼낸 장 하나.
interface QueueClaim {
  task: Task;
  /** 장 번호(시드 연쇄 위치). */
  index: number;
  /** 지금 이 장의 요청(시도)이 진행 중인가 — 정지 때 번호를 바로 돌려줄지 가른다. */
  attempting: boolean;
  /** inFlight 를 이미 내렸는가(정지·완료·반납 — 두 번 내리지 않는다). */
  released: boolean;
  /** 번호를 이미 처리했는가(소비 = 그 시드를 썼다 / 반납 = 다른 워커가 이어받음). */
  indexSettled: boolean;
}

interface QueueWorker {
  id: string;
  name: string;
  isDefault: boolean;
  /** 메모리 전용. 기본 워커는 undefined(= TOKEN.txt). */
  token?: string;
  /** 0 = 기본 워커. */
  order: number;
  /** 핸들러에 넘기는 run — 기본 워커는 그룹 run 그 자체, 나머지는 stopped 를 공유하는 별도 객체. */
  run: TaskQueueRun;
  /** 연속 실패·인증 오류로 이 실행에서 빠졌는가. */
  dropped: boolean;
  /** 할 일이 없어 루프를 끝냈는가(활성 워커 수에서 뺀다). */
  exited: boolean;
  /** 꺼낼 장이 없어 다른 워커를 기다리는 중인가(모두 쉬면 모두 끝난다). */
  idle: boolean;
  /** 기본 워커가 아닌 워커의 연속 실패 수(기본 워커는 서비스의 consecutiveTaskFailures). */
  consecutiveFailures: number;
  claim?: QueueClaim;
}

interface QueuePool {
  run: TaskQueueRun;
  workers: QueueWorker[];
  /** 시작할 때 워커가 2개 이상이었는가 — 장 단위 건너뜀·워커 탈락 규칙(다중)과 종전 규칙(단일)을 가른다. */
  multi: boolean;
  delay: RequestDelaySettings;
  rateLimitHits: RateLimitHit[];
  /** 전 워커 일시 대기 끝 시각(epoch ms, 0 = 없음) — 여러 계정의 429(IP 제한 추정). */
  pauseUntil: number;
}

export class TaskQueueService extends EventTarget {
  queue: CircularQueue<Task>;
  handlers: TaskHandler[];
  timeEstimators: TaskTimeEstimator[];
  groupStats: TaskStats[];
  sceneStats: { [sceneKey: string]: TaskStats };
  projectStats: { [projectKey: string]: TaskStats };
  currentRun: TaskQueueRun | undefined;
  taskSet: { [key: string]: boolean };
  taskLogs: TaskLog[] = [];
  // 진행 바 사이클 시작 시각(epoch ms) — 'start'/'complete' 발화 시점에 갱신.
  // 진행 바(TaskProgressBar)가 도크↔플로팅 이동 등으로 재마운트돼도 경과분을
  // 이어 그릴 수 있게 하는 단일 출처(컴포넌트 로컬 상태는 재마운트에 유실됨).
  progressCycleStartedAt = 0;
  // ─── 주기적 긴 휴식(2026-10-03 T3b, 식·상수는 requestTiming) ───
  // 다음 휴식까지 남은 성공 장수. run 마다 초기화하지 않는다 — 프로젝트·씬·보조 창 위임 작업
  // 구분 없이 큐 하나의 성공 수로 세고, 여러 번 나눠 실행해도 이어서 센다. 휴식을 끝까지 쉬었거나
  // 새 실행이 직전 실행 종료 뒤 2분 이상 유휴 뒤에 시작될 때만 새로 센다(300~399).
  longBreakRemaining = nextLongBreakCount();
  // 직전 실행 루프(runInternal)가 끝난 시각(epoch ms, 0 = 아직 없음) — 유휴 판정용.
  lastRunEndedAt = 0;
  // 지금 돌고 있는 실행 루프 수(정지 뒤 진행 중 요청을 마무리하는 옛 루프 포함).
  private activeRunLoops = 0;
  // 재시도를 소진해 건너뛴 작업의 연속 수(T4). 작업 성공·새 실행 시작·연속 실패 정지 때 0.
  // CONSECUTIVE_FAILURE_STOP 에 닿으면 그 작업을 남긴 채 큐를 정지하고 확인 창으로 알린다.
  consecutiveTaskFailures = 0;
  // 긴 휴식 중이면 시작·끝 시각(epoch ms), 아니면 0. 진행 바가 「휴식 중」을 그린다.
  longBreakStartedAt = 0;
  longBreakUntil = 0;
  // ─── 워커 풀(부스트 B1) ───
  // 숨은 개발 플래그로만 넣는 추가 워커 계정(메모리 전용 — 저장·동기화·config 키 없음). 비어 있으면 워커 1개 =
  // 종전 단일 루프. 다음 실행 시작 때 읽는다. 참여 판정·설정 UI 는 B2/B3.
  private devWorkerAccounts: QueueWorkerAccount[] = [];
  // 돌고 있는 실행(run)별 워커 풀 — 정지 때 꺼낸 장을 돌려주고, 진행 표시가 활성 워커 수를 읽는다.
  private pools = new Map<TaskQueueRun, QueuePool>();
  // 추가 워커의 긴 휴식 카운터(워커 id → 남은 성공 장수). 기본 워커는 longBreakRemaining. 유휴 재설정도 함께.
  private workerLongBreak = new Map<string, number>();
  // 할 일이 없어 기다리는 워커들 — 장 반납·작업 추가·정지 때 깨운다.
  private poolWakers: Array<() => void> = [];
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
  private progressBatchDepth = 0;
  private progressBatchPending = false;
  // 묶음 안 중간 반영의 마지막 발행 시각(묶음 시작 시각으로 초기화)
  private progressBatchLastEmitAt = 0;
  // 큐를 통째로 다시 쌓는 동기 구간(씬 예약 제거) 수 — 그동안은 중간 반영 금지
  // (반쯤 다시 쌓인 통계를 리스너가 읽지 않게)
  private progressInterimBlocked = 0;

  constructor(handlers: TaskHandler[]) {
    super();
    this.handlers = handlers;
    this.sceneStats = {};
    this.projectStats = {};
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
        .catch((e) => console.error('예약 제거 위임 실패:', e));
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

  // session: 씬이 속한 세션 — 생략 시 curSession (퀵 생성처럼 열려 있지 않은
  // 전용 프로젝트의 씬을 취소할 때만 명시가 필요하다. 호스트 로컬 경로는
  // 씬 객체 동일성으로 걸러서 세션이 불필요 — 위임 페이로드에만 쓰인다.)
  removeTasksFromScene(scene: GenericScene, session?: Session) {
    this.removeTasksFromScenes(new Set([scene]), session);
  }

  removeTasksFromScenes(scenes: ReadonlySet<GenericScene>, session?: Session) {
    if (scenes.size === 0) return;
    // 보조 창: 씬 단위 취소를 호스트에 위임(그 씬의 예약 전부 — 출처 무관).
    if (!this.isGenerationHost) {
      for (const scene of scenes) {
        backend
          .delegateCancel({
            all: false,
            sessionName: (session ?? appState.curSession)?.name,
            sceneName: scene.name,
            sceneType: scene.type,
          })
          .catch((e) => console.error('씬 예약 제거 위임 실패:', e));
      }
      return;
    }
    const oldQueue = this.queue;
    this.queue = new CircularQueue<Task>();
    this.beginProgressBatch();
    try {
      while (!oldQueue.isEmpty()) {
        const task = oldQueue.peek();
        oldQueue.dequeue();
        this.removeTaskInternal(task);
        if (!scenes.has(task.params.scene)) {
          this.addTaskInternal(task);
        } else {
          this.notifyDelegationDone(task);
        }
      }
      this.dispatchProgress();
    } finally {
      this.endProgressBatch();
    }
  }

  // 위임 태스크가 실행 없이 제거될 때 원 창에 'done'을 브리지해 onComplete 대행
  // 콜백 맵이 새지 않게 한다. 로컬 태스크(delegation 없음)는 no-op.
  private notifyDelegationDone(task: Task) {
    if (!task.params.delegation) return;
    backend
      .delegateComplete({ ...task.params.delegation, status: 'done' })
      .catch(() => {});
  }

  async addTask(params: TaskParam, numExec: number): Promise<void> {
    const n = Math.floor(Number(numExec));
    if (!Number.isFinite(n) || n <= 0) {
      appState.pushMessage('예약 개수가 올바르지 않습니다.');
      return;
    }
    let capturedParams = params;
    const isImageGeneration =
      params.job.type === 'sd' ||
      params.job.type === 'sd_inpaint' ||
      params.job.type === 'sd_i2i';
    if (isImageGeneration && !params.generationSnapshot) {
      try {
        capturedParams = {
          ...params,
          generationSnapshot: await this.captureGenerationSnapshot(),
        };
      } catch (e) {
        console.error('예약 생성 설정을 읽지 못했습니다:', e);
        appState.pushMessage('생성 설정을 읽지 못해 예약하지 못했습니다.');
        return;
      }
    }
    // 생성 위임(W6 P3): 내가 호스트가 아니면(보조 창) 로컬 큐에 넣지 않고 호스트에
    // 위임한다. 호스트/단일 창/모바일은 그대로 로컬 경로(addTaskLocal) — 종전과 동일.
    if (!this.isGenerationHost) {
      this.delegateSubmit(capturedParams, n);
      return;
    }
    this.addTaskLocal(capturedParams, n);
  }

  // 한 번의 사용자 예약 동작에서 공유할 생성 설정 스냅샷을 만든다.
  // 일괄 예약 호출부가 이 값을 재사용하면 태스크마다 config IPC를 반복하지 않는다.
  async captureGenerationSnapshot(): Promise<GenerationSettingsSnapshot> {
    return captureGenerationSettings(await backend.getConfig());
  }

  // 로컬 큐에 실제로 태스크를 넣는다(기존 addTask 본체). 호스트의 위임 수신 경로도
  // 이 메서드를 직접 호출한다(재위임 방지).
  addTaskLocal(params: TaskParam, numExec: number) {
    // 마지막 방어선: NaN/음수/비유한 값이 큐에 들어오면 통계가 NaN 으로 영구
    // 오염되고(NaN-x=NaN) 실행 루프가 완료 판정(done >= total)을 영원히 통과하지
    // 못한다. 입력 UI 검증과 별개로 여기서 반드시 정규화한다.
    const n = Math.floor(Number(numExec));
    if (!Number.isFinite(n) || n <= 0) {
      appState.pushMessage('예약 개수가 올바르지 않습니다.');
      return;
    }
    const task: Task = {
      id: v4(),
      cls: -1,
      params: params,
      done: 0,
      total: n,
    };
    task.cls = this.getTaskCls(task);
    this.addTaskInternal(task);
  }

  addTaskInternal(task: Task) {
    this.queue.enqueue(task);
    this.taskSet[task.id!] = true;
    // 통계 total 은 장 단위로 건너뛴 장(다중 워커, B1)을 뺀 값 — 제거(removeTaskInternal)와 대칭.
    const statTotal = this.statTotalOf(task);
    this.groupStats[task.cls].total += statTotal;
    this.groupStats[task.cls].done += task.done;
    // 키는 최초 1회만 계산·고정(재등록 시 기존 키 유지 — 제거와 대칭 보장).
    task.sceneKey ??= task.params.scene
      ? getSceneKey(task.params.session, task.params.scene)
      : '';
    const sceneKey = task.sceneKey;
    if (!(sceneKey in this.sceneStats)) {
      this.sceneStats[sceneKey] = { done: 0, total: 0 };
    }
    this.sceneStats[sceneKey].done += task.done;
    this.sceneStats[sceneKey].total += statTotal;
    task.projectKey ??= task.params.session.name;
    const projectKey = task.projectKey;
    if (!(projectKey in this.projectStats)) {
      this.projectStats[projectKey] = { done: 0, total: 0 };
    }
    this.projectStats[projectKey].done += task.done;
    this.projectStats[projectKey].total += statTotal;
    this.dispatchProgress();
    // 할 일이 없어 기다리던 워커가 새 작업을 집어 가게 깨운다(단일 워커는 기다리지 않으므로 무영향).
    this.notifyPoolChange();
  }

  // 통계에 넣는 작업의 장 수 = total − 장 단위로 건너뛴 수(B1, 단일 워커는 항상 total).
  private statTotalOf(task: Task): number {
    return task.total - (task.skipped ?? 0);
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
      const stoppedRun = this.currentRun;
      stoppedRun.stopped = true;
      this.currentRun = undefined;
      // 정지된 실행의 워커가 꺼낸 장을 돌려준다(B1) — 바로 다시 시작한 새 실행이 종전처럼 같은 장부터
      // 이어서 처리한다(진행 중인 요청은 옛 워커가 마무리).
      this.releasePoolClaimsOnStop(stoppedRun);
      // 휴식 중 정지 — 휴식 표시를 바로 끈다(대기 자체도 sleepUnlessStopped 라 곧 끝난다).
      this.endLongBreakDisplay();
      this.dispatchEvent(new CustomEvent('stop', {}));
      this.scheduleSnapshotBroadcast();
    }
  }

  // 긴 휴식 중인가. 보조 창은 호스트 미러 기준.
  isLongBreak(): boolean {
    if (!this.isGenerationHost) return (this.mirror?.longBreakUntil ?? 0) > 0;
    return this.longBreakUntil > 0;
  }

  // 진행 바용 휴식 시작·끝 시각(epoch ms, 휴식 아님 = 0). 보조 창은 호스트 미러 기준.
  longBreakWindow(): { startedAt: number; until: number } {
    if (!this.isGenerationHost)
      return {
        startedAt: this.mirror?.longBreakStartedAt ?? 0,
        until: this.mirror?.longBreakUntil ?? 0,
      };
    return { startedAt: this.longBreakStartedAt, until: this.longBreakUntil };
  }

  // 휴식 표시를 끈다(이미 꺼져 있으면 아무것도 하지 않음). 다음 작업의 진행 바 경과에 휴식
  // 시간이 섞이지 않도록 사이클 시작 시각을 다시 찍는다.
  private endLongBreakDisplay() {
    if (this.longBreakUntil === 0 && this.longBreakStartedAt === 0) return;
    this.longBreakStartedAt = 0;
    this.longBreakUntil = 0;
    this.progressCycleStartedAt = Date.now();
    this.dispatchProgress();
  }

  // 큐 잔량(장) = 큐 안 모든 작업의 (total − done − skipped) 합(진행 중인 장 포함). 소량 예약 완화 판정용
  // (requestTiming.isSmallQueueRelief). total 이 오염(NaN 등)된 작업은 세지 않는다. skipped 는 다중 워커에서만 생긴다.
  pendingImageCount(): number {
    let n = 0;
    for (const task of this.queue) {
      if (!task) continue;
      n += remainingImageCount(task);
    }
    return n;
  }

  // 아직 어느 워커도 꺼내지 않은 장 수(긴 휴식 「남은 예약이 있는가」 판정 — 다른 워커가 진행 중인 장은 뺀다).
  // 단일 워커에서는 휴식 판정 시점에 진행 중인 장이 없어 pendingImageCount 와 같다.
  unclaimedImageCount(): number {
    let n = 0;
    for (const task of this.queue) {
      if (!task) continue;
      n += unclaimedImageCount(task);
    }
    return n;
  }

  runLocal() {
    if (!this.currentRun) {
      const cur: TaskQueueRun = {
        stopped: false,
      };
      this.currentRun = cur;
      // 사용자가 실행을 새로 시작하면 연속 실패 수를 새로 센다(T4).
      this.consecutiveTaskFailures = 0;
      // 실행 루프가 어떤 예외로 죽어도 currentRun 이 반드시 해제되도록 보장.
      // 해제되지 않으면 isRunning() 이 영구 true 가 되어 시작 버튼이 다시
      // 나타나지 않고 생성이 완전히 멈춘다.
      this.runInternal(cur)
        .catch((e) => {
          console.error('큐 실행 루프 비정상 종료:', e);
        })
        .finally(() => {
          if (cur === this.currentRun) {
            this.currentRun = undefined;
            this.dispatchEvent(new CustomEvent('stop', {}));
            this.dispatchProgress();
          }
        });
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
    // 「다음 완료까지」 예상 = 한 장 평균 ÷ 동시에 생성 중인 워커 수(B1, 단일 워커 = 1 — 종전 값).
    const workers = this.activeWorkerCount();
    if (type === 'mean') {
      return this.timeEstimators[task.cls].estimateMean() / workers;
    }
    return this.timeEstimators[task.cls].estimateMedian() / workers;
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
    // 남은 시간 = 장 수 × 한 장 평균 ÷ 동시에 생성 중인 워커 수(B1, D7 — 단일 워커 = 1 이라 종전 값).
    return res / this.activeWorkerCount();
  }

  // 지금 동시에 생성 중인 워커 수(빠지거나 할 일이 없어 끝난 워커 제외, 최소 1). 보조 창은 호스트 미러 기준
  // (구 미러 = 1). 진행 바 표식(「부스트 ×W」)은 B2.
  boostWorkerCount(): number {
    if (!this.isGenerationHost) return Math.max(1, this.mirror?.boostWorkers ?? 1);
    return this.activeWorkerCount();
  }

  private activeWorkerCount(): number {
    // 현재 실행의 풀, 없으면(실행 루프를 직접 부른 경우) 정지되지 않은 가장 최근 풀.
    let pool = this.currentRun ? this.pools.get(this.currentRun) : undefined;
    if (!pool) {
      for (const p of this.pools.values()) if (!p.run.stopped) pool = p;
    }
    if (!pool) return 1;
    const live = pool.workers.filter((w) => !w.dropped && !w.exited).length;
    return Math.max(1, live);
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
    for (const [projectKey, stats] of Object.entries(this.projectStats)) {
      const remain = stats.total - stats.done;
      if (remain <= 0) continue;
      remains[projectKey] = remain;
    }
    const running =
      this.isRunning() && !this.queue.isEmpty()
        ? this.queue.peek().projectKey ?? this.queue.peek().params.session.name
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

  // 씬 통계 키 이관 — 쓰기(추가/제거/진행)는 예약 시점에 고정한 task.sceneKey 를
  // 쓰지만 읽기(statsTasksFromScene)는 현재 이름으로 키를 재계산한다. 씬/프로젝트
  // 이름 변경 시 키를 함께 옮기지 않으면 실행 중 예약의 씬 카드 배지가 0으로
  // 사라진다(통계는 옛 키 버킷에 잔류). remap 이 null 이면 해당 키 유지.
  private rekeySceneStats(
    remap: (key: string) => string | null,
    emitProgress = true,
  ): boolean {
    let changed = false;
    for (const key of Object.keys(this.sceneStats)) {
      const nk = remap(key);
      if (!nk || nk === key) continue;
      const src = this.sceneStats[key];
      const dst = this.sceneStats[nk];
      if (dst) {
        dst.done += src.done;
        dst.total += src.total;
      } else {
        this.sceneStats[nk] = src;
      }
      delete this.sceneStats[key];
      changed = true;
    }
    // 큐 내 태스크의 고정 키도 함께 갱신 — 이후 제거/진행 감산이 새 버킷에 적용
    for (const task of this.queue) {
      if (!task?.sceneKey) continue;
      const nk = remap(task.sceneKey);
      if (nk && nk !== task.sceneKey) {
        task.sceneKey = nk;
        changed = true;
      }
    }
    if (changed && emitProgress) this.dispatchProgress();
    return changed;
  }

  // 씬 이름 변경 반영 (renameScene 에서 호출)
  onRenameScene(
    sessionName: string,
    sceneType: 'scene' | 'inpaint',
    oldName: string,
    newName: string,
  ) {
    const oldKey = sessionName + '/' + sceneType + '/' + oldName;
    const newKey = sessionName + '/' + sceneType + '/' + newName;
    this.rekeySceneStats((k) => (k === oldKey ? newKey : null));
  }

  // 프로젝트 이름 변경 반영 (SessionService 프로젝트 rename 에서 호출)
  onRenameProject(oldName: string, newName: string) {
    let projectChanged = false;
    const src = this.projectStats[oldName];
    if (src) {
      const dst = this.projectStats[newName];
      if (dst) {
        dst.done += src.done;
        dst.total += src.total;
      } else {
        this.projectStats[newName] = src;
      }
      delete this.projectStats[oldName];
      projectChanged = true;
    }
    for (const task of this.queue) {
      if (task?.projectKey === oldName) {
        task.projectKey = newName;
        projectChanged = true;
      }
    }
    const prefix = oldName + '/';
    const sceneChanged = this.rekeySceneStats(
      (k) =>
        k.startsWith(prefix) ? newName + '/' + k.slice(prefix.length) : null,
      false,
    );
    if (projectChanged || sceneChanged) this.dispatchProgress();
  }

  dispatchProgress() {
    if (this.progressBatchDepth > 0) {
      this.progressBatchPending = true;
      // 묶음이 길어지면(미러 일괄 예약처럼 씬마다 파일 쓰기가 끼는 경우) 끝날 때까지
      // 예약 배지·진행 막대가 전혀 움직이지 않았다. 일정 간격마다 중간 반영을 1회
      // 내보낸다 — 이벤트 수는 경과 시간에 비례해 상한이 있고(N 과 무관), 빠른 묶음은
      // 종전처럼 마지막 1회뿐이다(2026-10-02 P1).
      const now = Date.now();
      if (
        this.progressInterimBlocked === 0 &&
        now - this.progressBatchLastEmitAt >= PROGRESS_BATCH_INTERVAL_MS
      ) {
        this.progressBatchPending = false;
        this.progressBatchLastEmitAt = now;
        this.emitProgress();
      }
      return;
    }
    this.emitProgress();
  }

  private emitProgress() {
    this.dispatchEvent(new CustomEvent('progress', {}));
    // 호스트: 큐 변경을 보조 창들에 미러(스로틀). 보조 창 0개면 완전 생략.
    this.scheduleSnapshotBroadcast();
  }

  // allowInterim=false(기본): 동기 재구성 구간 — 끝날 때 1회만 반영.
  // allowInterim=true: withProgressBatch 의 비동기 일괄 예약 — 간격마다 중간 반영 허용.
  private beginProgressBatch(allowInterim = false) {
    if (this.progressBatchDepth === 0) this.progressBatchLastEmitAt = Date.now();
    this.progressBatchDepth++;
    if (!allowInterim) this.progressInterimBlocked++;
  }

  private endProgressBatch(allowInterim = false) {
    this.progressBatchDepth--;
    if (!allowInterim) this.progressInterimBlocked--;
    if (this.progressBatchDepth === 0 && this.progressBatchPending) {
      this.progressBatchPending = false;
      this.emitProgress();
    }
  }

  // 한 번의 일괄 예약에서 수백 개의 progress 이벤트와 그에 따른 UI 전체
  // 재계산이 발생하지 않도록, 중첩 가능한 범위 안의 변경을 합친다 — 마지막 1회 +
  // 묶음이 PROGRESS_BATCH_INTERVAL_MS 를 넘게 걸리면 그 간격마다 중간 반영 1회.
  async withProgressBatch<T>(callback: () => Promise<T>): Promise<T> {
    this.beginProgressBatch(true);
    try {
      return await callback();
    } finally {
      this.endProgressBatch(true);
    }
  }

  removeTaskInternal(task: Task) {
    // 멱등 가드: 같은 태스크로 두 번 불리면(예: 사용자가 예약을 전부 취소한 뒤
    // 실행 루프의 실패-스킵 경로가 같은 태스크를 또 제거) 통계가 이중 감산되어
    // "-1개 남음" 같은 음수가 된다. 이미 제거된 태스크는 무시한다.
    if (!(task.id! in this.taskSet)) return;
    const statTotal = this.statTotalOf(task);
    this.groupStats[task.cls].done -= task.done;
    this.groupStats[task.cls].total -= statTotal;
    // 추가 시점에 고정한 키를 그대로 사용(이름변경으로 재계산 키가 어긋나는 것 방지).
    const sceneKey =
      task.sceneKey ??
      (task.params.scene
        ? getSceneKey(task.params.session, task.params.scene)
        : '');
    if (sceneKey in this.sceneStats) {
      this.sceneStats[sceneKey].done -= task.done;
      this.sceneStats[sceneKey].total -= statTotal;
    }
    const projectKey = task.projectKey ?? task.params.session.name;
    if (projectKey in this.projectStats) {
      this.projectStats[projectKey].done -= task.done;
      this.projectStats[projectKey].total -= statTotal;
      if (this.projectStats[projectKey].total <= 0) {
        delete this.projectStats[projectKey];
      }
    }
    delete this.taskSet[task.id!];
  }

  // 시도 세대 번호 — 폐기된 시도의 늦은 결과를 가려내는 키(ctx.attempt).
  private attemptSeq = 0;

  // 재시도 전 대기(정지하면 즉시 끝남). 테스트가 실제 시간을 쓰지 않도록 바꿔 끼울 수 있다.
  retryWait: (ms: number, shouldStop: () => boolean) => Promise<boolean> =
    sleepUnlessStopped;

  // 주기적 긴 휴식(2~4분) 대기 — 정지하면 즉시 끝난다. 테스트가 바꿔 끼울 수 있다.
  longBreakWait: (ms: number, shouldStop: () => boolean) => Promise<boolean> =
    sleepUnlessStopped;

  // 한 번의 시도를 큐 바깥 타임아웃(안쪽 + 10초)으로 감싼다. 바깥 타이머가 먼저 끝나면
  // 시도의 AbortController 를 abort 해 진행 중 요청을 끊고(PC fetch abort, Android
  // call.cancel) RequestTimeoutError 로 실패시킨다 — 재시도와 이전 요청이 겹치지 않고,
  // 늦게 끝난 이전 시도의 결과는 핸들러가 signal 을 보고 저장하지 않는다.
  // 사용자 입력 대기(ctx.pauseTimeoutWhile)는 측정에서 빼고, 끝난 뒤 처음부터 다시 잰다.
  runAttemptWithTimeout(
    handler: TaskHandler,
    task: Task,
    cur: TaskQueueRun,
    requestTimeoutMs: number,
    // 워커 풀(B1)이 넘기는 장 번호·워커. 생략(구 호출부·테스트)하면 문맥에 넣지 않는다.
    assignment?: { imageIndex?: number; worker?: TaskAttemptWorker },
  ): Promise<boolean> {
    const controller = new AbortController();
    const outerMs = queueAttemptTimeoutMs(requestTimeoutMs);
    const attempt = ++this.attemptSeq;
    const sceneName = task?.params?.scene?.name ?? '(unknown)';
    return new Promise<boolean>((resolve, reject) => {
      let settled = false;
      let paused = 0;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const clear = () => {
        if (timer != null) clearTimeout(timer);
        timer = null;
      };
      const arm = () => {
        clear();
        if (settled || paused > 0) return;
        timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          timer = null;
          // 진행 중 요청을 끊는다는 사실을 남긴다(Android 는 abort → FetchService.cancel).
          this.addLog('warn', sceneName, TASK_FAILURE_TEXT.outerTimeoutAbort(attempt));
          controller.abort();
          reject(new RequestTimeoutError(outerMs, 'queue'));
        }, outerMs);
      };
      const ctx: TaskAttemptContext = {
        attempt,
        signal: controller.signal,
        requestTimeoutMs,
        restartTimeout: arm,
        ...(assignment?.imageIndex !== undefined ? { imageIndex: assignment.imageIndex } : {}),
        ...(assignment?.worker ? { worker: assignment.worker } : {}),
        pauseTimeoutWhile: async <T,>(fn: () => Promise<T>): Promise<T> => {
          paused++;
          clear();
          try {
            return await fn();
          } finally {
            paused--;
            if (paused === 0) arm();
          }
        },
      };
      arm();
      let p: Promise<boolean>;
      try {
        p = handler.handleTask(task, cur, ctx);
      } catch (e) {
        p = Promise.reject(e);
      }
      p.then(
        (v) => {
          if (settled) return;
          settled = true;
          clear();
          resolve(v);
        },
        (e) => {
          if (settled) return;
          settled = true;
          clear();
          reject(e);
        },
      );
    });
  }

  // 실행 하나. 긴 휴식 카운터의 유휴 재설정과 종료 시각 기록을 감싼다(T3b) — 종료 경로
  // (큐 소진·정지·IP 중단·예외)가 무엇이든 finally 에서 종료 시각을 남긴다.
  async runInternal(cur: TaskQueueRun) {
    // 다른 실행 루프가 아직 돌고 있으면(정지 뒤 진행 중 요청 마무리) 유휴가 아니다 — 이어서 센다.
    if (
      this.activeRunLoops === 0 &&
      shouldResetLongBreakCounter(this.lastRunEndedAt, Date.now())
    ) {
      this.longBreakRemaining = nextLongBreakCount();
      // 추가 워커(B1)의 카운터도 같은 유휴로 새로 센다 — 다음 실행에서 다시 어긋나게 채운다.
      this.workerLongBreak.clear();
    }
    this.activeRunLoops++;
    try {
      await this.runPool(cur);
    } finally {
      this.activeRunLoops--;
      this.lastRunEndedAt = Date.now();
    }
  }

  // ─── 워커 풀(부스트 B1) ───

  /**
   * 숨은 개발 플래그 — 다음 실행부터 기본 워커 옆에 추가 워커(다른 계정)를 띄운다. 빈 배열·null 이면 끈다
   * (워커 1개 = 종전 단일 루프). 메모리 전용(저장·config 키 없음). 토큰은 로그·미러·IPC 에 싣지 않는다.
   * 활성 계정과 같은 계정을 넣으면 계정당 동시 1요청이 깨지므로 넣지 않는다(참여 판정은 B2).
   * 반환 = 받아들인 추가 워커 수.
   */
  setDevWorkerAccounts(accounts: QueueWorkerAccount[] | null | undefined): number {
    this.devWorkerAccounts = normalizeWorkerAccounts(accounts ?? []);
    return this.devWorkerAccounts.length;
  }

  private createPool(cur: TaskQueueRun, delay: RequestDelaySettings): QueuePool {
    const accounts: QueueWorkerAccount[] = [
      { id: DEFAULT_WORKER_ID, name: WORKER_POOL_TEXT.defaultWorkerName },
      ...this.devWorkerAccounts,
    ];
    const count = accounts.length;
    const workers = accounts.map((a, order): QueueWorker => {
      const isDefault = order === 0;
      // 기본 워커는 그룹 run 을 그대로 쓴다(단일 워커 = 종전과 같은 캐시·정지 객체). 추가 워커는 캐시만 따로.
      const run: TaskQueueRun = isDefault
        ? cur
        : {
            get stopped() {
              return cur.stopped;
            },
            set stopped(v: boolean) {
              cur.stopped = v;
            },
          };
      if (!isDefault && !this.workerLongBreak.has(a.id)) {
        // 휴식이 서로 겹치지 않게 순번만큼 늦게 시작(D5).
        this.workerLongBreak.set(a.id, staggeredLongBreakCount(order, count));
      }
      return {
        id: a.id,
        name: a.name,
        isDefault,
        ...(isDefault ? {} : { token: a.token }),
        order,
        run,
        dropped: false,
        exited: false,
        idle: false,
        consecutiveFailures: 0,
      };
    });
    return {
      run: cur,
      workers,
      multi: workers.length > 1,
      delay,
      rateLimitHits: [],
      pauseUntil: 0,
    };
  }

  // 워커 풀 실행: 워커마다 루프 하나(runWorker)를 돌리고 모두 끝나면 종전 루프의 끝 처리를 한다.
  // 워커가 1개면(부스트 꺼짐) 예전 단일 루프(runLoop)와 같은 순서·같은 이벤트다.
  private async runPool(cur: TaskQueueRun) {
    this.dispatchProgress();
    const config = await backend.getConfig();
    // 지연 설정은 실행 시작 때 1회 읽는다(실행 중 변경은 다음 실행부터 — 종전 동작 유지).
    // 옛 키 delayTime 은 새 키가 없을 때 환산해 읽는다(requestTiming).
    const delay = resolveRequestDelaySettings(config);
    const pool = this.createPool(cur, delay);
    this.pools.set(cur, pool);
    if (pool.multi) {
      // 로그에는 계정 이름만(토큰 없음).
      this.addLog('info', '', WORKER_POOL_TEXT.poolStart(pool.workers.map((w) => w.name)));
      this.dispatchProgress();
    }
    let results: PromiseSettledResult<void>[];
    try {
      results = await Promise.allSettled(pool.workers.map((w) => this.runWorker(pool, w)));
    } finally {
      // 어떤 경로로 끝나도 꺼낸 장이 남지 않게 한다(예외 대비 — 정상 경로는 워커가 이미 돌려줬다).
      for (const w of pool.workers) if (w.claim) this.finishClaim(w, w.claim, false);
      this.pools.delete(cur);
    }
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed) throw failed.reason;
    // 정지로 끝났으면 워커가 이미 progress 를 보냈다(종전 루프의 정지 반환과 같음).
    if (cur.stopped) return;
    if (pool.multi && !this.queue.isEmpty()) {
      // 기본 계정이 빠져 기본 계정 전용 작업이 남은 경우 등.
      this.addLog('warn', '', WORKER_POOL_TEXT.leftover);
    }
    if (cur == this.currentRun) {
      this.dispatchEvent(new CustomEvent('stop', {}));
      this.currentRun = undefined;
    }
    this.dispatchProgress();
  }

  // 워커 하나의 루프: 다음 미할당 장을 꺼내(claimNext) 처리(processClaim)하기를 반복한다. 꺼낼 장이 없고
  // 다른 워커가 아직 일하는 중이면 기다린다(그 워커가 장을 돌려주면 이어받는다). 단일 워커는 기다리지 않는다.
  private async runWorker(pool: QueuePool, w: QueueWorker): Promise<void> {
    const cur = pool.run;
    try {
      while (true) {
        // 정지된 런은 즉시 종료 — stop() 후 새 런이 시작돼도 옛 루프가 큐를
        // 건드리지 않도록(같은 태스크 이중 처리 방지).
        if (cur.stopped) {
          this.dispatchProgress();
          return;
        }
        if (w.dropped) return;
        const claim = this.claimNext(w);
        if (!claim) {
          if (this.poolHasOtherBusyWorker(pool, w)) {
            // 쉬는 동안엔 다른 워커를 깨우지 않는다 — 쉬는 워커끼리 서로 깨우면 마이크로태스크 무한 반복이 된다.
            // 마지막으로 일하던 워커가 할 일이 없으면 「쉬는 워커만 남음」을 보고 끝내고, 끝날 때(finally) 깨운다.
            w.idle = true;
            await this.waitPoolChange();
            w.idle = false;
            continue;
          }
          return;
        }
        const next = await this.processClaim(pool, w, claim);
        if (next === 'exit') return;
      }
    } catch (e) {
      // 예상 밖 예외 — 다른 워커도 멈추게 하고(같은 그룹) 종전처럼 실행을 끝낸다.
      cur.stopped = true;
      throw e;
    } finally {
      if (w.claim) this.finishClaim(w, w.claim, false);
      w.exited = true;
      w.idle = false;
      this.notifyPoolChange();
    }
  }

  // 큐 순서대로 보며 끝난 작업은 그 자리에서 치우고(종전: 머리에서 치움 — 단일 워커는 끝난 작업이 늘 머리),
  // 이 워커가 꺼낼 수 있는 첫 작업의 다음 장을 꺼낸다. 장 번호는 이때 확정한다(시드 연쇄 위치).
  private claimNext(w: QueueWorker): QueueClaim | undefined {
    const tasks: Task[] = [];
    for (const t of this.queue) if (t) tasks.push(t);
    for (const task of tasks) {
      // total 이 오염(NaN 등)된 태스크는 done >= total 이 영원히 거짓이라
      // 큐 머리를 무한 점유한다 — 완료로 간주하고 폐기한다.
      if (isTaskSettled(task)) {
        // 위임 태스크가 전량 완료됨 — 원 창의 onComplete 대행 콜백 정리를 알린다.
        if (task.params.delegation) {
          backend
            .delegateComplete({ ...task.params.delegation, status: 'done' })
            .catch(() => {});
        }
        this.removeTaskInternal(task);
        this.removeFromQueue(task);
        continue;
      }
      if (!this.canWorkerTake(w, task)) continue;
      const claim: QueueClaim = {
        task,
        index: takeImageIndex(task),
        attempting: false,
        released: false,
        indexSettled: false,
      };
      task.inFlight = (task.inFlight ?? 0) + 1;
      w.claim = claim;
      return claim;
    }
    return undefined;
  }

  private canWorkerTake(w: QueueWorker, task: Task): boolean {
    if (unclaimedImageCount(task) <= 0) return false;
    if (w.isDefault) return true;
    // 기본 워커가 아닌 워커는 다른 계정 토큰을 받을 수 있는 작업만(증강·업스케일·배경 제거·빠른 생성은 기본 계정).
    if (task.declinedWorkerIds?.includes(w.id)) return false;
    return this.handlers[task.cls]?.supportsWorkerAccount?.(task) === true;
  }

  // 큐에서 작업 하나를 뺀다 — 머리면 종전처럼 dequeue, 아니면(다중 워커) 순서를 지켜 다시 쌓는다.
  private removeFromQueue(task: Task) {
    if (this.queue.isEmpty()) return;
    if (this.queue.peek() === task) {
      this.queue.dequeue();
      return;
    }
    let found = false;
    const next = new CircularQueue<Task>();
    for (const t of this.queue) {
      if (!t) continue;
      if (!found && t === task) {
        found = true;
        continue;
      }
      next.enqueue(t);
    }
    if (found) this.queue = next;
  }

  // 같은 풀에서 아직 일하는(쉬지도·빠지지도·끝나지도 않은) 다른 워커가 있는가.
  private poolHasOtherBusyWorker(pool: QueuePool, w: QueueWorker): boolean {
    return pool.workers.some((x) => x !== w && !x.dropped && !x.exited && !x.idle);
  }

  private hasLiveWorker(pool: QueuePool): boolean {
    return pool.workers.some((x) => !x.dropped);
  }

  private waitPoolChange(): Promise<void> {
    return new Promise<void>((resolve) => this.poolWakers.push(resolve));
  }

  private notifyPoolChange() {
    if (this.poolWakers.length === 0) return;
    const wakers = this.poolWakers;
    this.poolWakers = [];
    for (const wake of wakers) wake();
  }

  // 꺼낸 장의 진행 중 수를 내린다(한 번만).
  private releaseClaimCount(claim: QueueClaim) {
    if (claim.released) return;
    claim.released = true;
    claim.task.inFlight = Math.max(0, (claim.task.inFlight ?? 0) - 1);
  }

  // 장 번호를 처리한다(한 번만): consumed = 그 시드를 썼다(성공·장 단위 건너뜀), 아니면 돌려준다(다른 워커가 이어받음).
  private settleClaimIndex(claim: QueueClaim, consumed: boolean) {
    if (claim.indexSettled) return;
    claim.indexSettled = true;
    if (!consumed) returnImageIndex(claim.task, claim.index);
  }

  private finishClaim(w: QueueWorker, claim: QueueClaim, consumed: boolean) {
    this.releaseClaimCount(claim);
    this.settleClaimIndex(claim, consumed);
    if (w.claim === claim) w.claim = undefined;
    this.notifyPoolChange();
  }

  // 정지된 실행의 꺼낸 장을 돌려준다. 요청 중이 아닌 장(지연·재시도 대기 중)은 번호도 돌려주고, 요청 중인 장은
  // 진행 수만 내린 뒤 결과를 기다린다(성공 = 그 시드는 쓴 것, 실패 = 번호 반납). 새 실행이 바로 같은 장을 이어간다.
  private releasePoolClaimsOnStop(run: TaskQueueRun) {
    const pool = this.pools.get(run);
    if (pool) {
      for (const w of pool.workers) {
        const claim = w.claim;
        if (!claim) continue;
        this.releaseClaimCount(claim);
        if (!claim.attempting) this.settleClaimIndex(claim, false);
      }
    }
    this.notifyPoolChange();
  }

  // 워커별 카운터 — 기본 워커는 서비스 수준 필드(종전 계약·테스트가 읽는 값), 추가 워커는 따로.
  private getConsecutiveFailures(w: QueueWorker): number {
    return w.isDefault ? this.consecutiveTaskFailures : w.consecutiveFailures;
  }

  private setConsecutiveFailures(w: QueueWorker, v: number) {
    if (w.isDefault) this.consecutiveTaskFailures = v;
    else w.consecutiveFailures = v;
  }

  private getLongBreakRemaining(w: QueueWorker): number {
    if (w.isDefault) return this.longBreakRemaining;
    return this.workerLongBreak.get(w.id) ?? nextLongBreakCount();
  }

  private setLongBreakRemaining(w: QueueWorker, v: number) {
    if (w.isDefault) this.longBreakRemaining = v;
    else this.workerLongBreak.set(w.id, v);
  }

  // 429 기록 — 서로 다른 워커 2개 이상에서 1분 안에 나면 전 워커가 기존 429 대기만큼 멈춘다(IP 제한 추정).
  private noteRateLimit(pool: QueuePool, w: QueueWorker, pauseMs: number, sceneName: string) {
    if (!pool.multi) return;
    const now = Date.now();
    pool.rateLimitHits = pool.rateLimitHits.filter((h) => now - h.at < RATE_LIMIT_IP_WINDOW_MS);
    pool.rateLimitHits.push({ workerId: w.id, at: now });
    if (!shouldPauseAllForRateLimit(pool.rateLimitHits, now)) return;
    const until = now + pauseMs;
    if (until <= pool.pauseUntil) return;
    pool.pauseUntil = until;
    this.addLog('warn', sceneName, WORKER_POOL_TEXT.ipPause(pauseMs));
  }

  // 다중 워커에서 끝내 실패한 장 하나만 건너뛴다(D6) — 그 시드는 쓰지 않고, 통계 total 에서 1장을 뺀다.
  private skipClaimedImage(claim: QueueClaim) {
    const task = claim.task;
    this.settleClaimIndex(claim, true);
    task.skipped = (task.skipped ?? 0) + 1;
    if (!(task.id! in this.taskSet)) return;
    this.groupStats[task.cls].total--;
    const sceneKey =
      task.sceneKey ??
      (task.params.scene ? getSceneKey(task.params.session, task.params.scene) : '');
    if (sceneKey in this.sceneStats) this.sceneStats[sceneKey].total--;
    const projectKey = task.projectKey ?? task.params.session.name;
    if (projectKey in this.projectStats) this.projectStats[projectKey].total--;
  }

  // 워커 하나를 이 실행에서 뺀다(연속 실패·인증 오류). 쥐고 있던 장은 같은 번호·시드로 다른 워커가 이어받는다.
  // 남은 워커가 있으면 그 사실만 알리고, 없으면 호출부가 종전 stopForFailure 로 전체를 멈춘다.
  private dropWorker(
    pool: QueuePool,
    w: QueueWorker,
    claim: QueueClaim,
    sceneName: string,
    text: string,
    notify: 'toast' | 'dialog',
  ) {
    w.dropped = true;
    this.finishClaim(w, claim, false);
    this.addLog('error', sceneName, text.replace(/\n/g, ' '));
    if (this.hasLiveWorker(pool)) {
      if (notify === 'dialog') appState.pushDialog({ type: 'yes-only', text });
      else appState.pushMessage(text, 'error');
    }
    this.dispatchProgress();
  }

  // 꺼낸 장 하나를 처리한다 — 예전 runLoop 의 작업 하나 처리(지연 → 시도 → 재시도 사다리 → 성공 집계·긴 휴식
  // / 건너뜀·연속 실패·인증 정지)와 같은 순서. 'exit' = 이 워커 루프를 끝낸다.
  private async processClaim(
    pool: QueuePool,
    w: QueueWorker,
    claim: QueueClaim,
  ): Promise<'next' | 'exit'> {
    const cur = pool.run;
    const task = claim.task;
    const delay = pool.delay;
    // 다중 워커 로그 꼬리표(계정 이름만) — 단일 워커는 종전 문구 그대로.
    const tag = pool.multi ? WORKER_POOL_TEXT.tag(w.name) : '';
    const attemptWorker: TaskAttemptWorker = {
      id: w.id,
      name: w.name,
      isDefault: w.isDefault,
      ...(w.token !== undefined ? { token: w.token } : {}),
    };
    const exitStopped = (): 'exit' => {
      this.finishClaim(w, claim, false);
      this.dispatchProgress();
      return 'exit';
    };
    let done = false;
    const before = Date.now();
    const handler = this.handlers[task.cls];
    const numTries = handler.getNumTries(task);
    // 이 장이 「타임아웃으로」 실패한 횟수 — 다음 시도의 요청 타임아웃을 60초씩 늘린다
    // (120→180→240→300 상한). 5xx·네트워크 등 다른 실패는 세지 않는다.
    let timeoutFailures = 0;
    // 이 장의 재시도 가능한 실패 횟수 — 다음 시도 전 대기 사다리(5→10→20→40→60초).
    let failures = 0;
    // 이 장의 마지막 실패 문구 — 연속 실패 정지 창의 「마지막 오류」.
    let lastErrorText = '';
    // 핸들러가 준 별도 실패 문구(업스케일 타임아웃 등) — 건너뜀 때 진행 바에도 그 문구를 남긴다.
    let lastNotice: string | undefined;
    // 인증 오류(401·403)로 실패했는가 — 재시도·연속 실패 누적 없이 바로 정지한다.
    let authFailed = false;
    for (let i = 0; i < numTries; i++) {
      if (cur.stopped) return exitStopped();
      try {
        // 첫 시도 앞에만 요청 사이 지연(재시도는 아래 오류 재시도 대기만). 잔량은 소량 예약 완화 판정용(큐 전체).
        // 대기 중 정지하면 남은 대기를 버린다(T4 — 예전엔 끝까지 기다린 뒤 정지 판정). 대기는 워커마다 따로.
        await handler.handleDelay(task, i, delay, this.pendingImageCount(), () => cur.stopped);
        // 지연 대기 중에 정지됐으면 요청을 보내지 않는다.
        if (cur.stopped) return exitStopped();
        // 여러 계정의 429 로 전 워커 일시 대기 중이면(다중 워커만) 그 끝까지 기다린다.
        if (pool.pauseUntil > Date.now()) {
          await this.retryWait(pool.pauseUntil - Date.now(), () => cur.stopped);
          if (cur.stopped) return exitStopped();
        }
        const requestTimeoutMs = nextRequestTimeoutMs(timeoutFailures);
        claim.attempting = true;
        try {
          await this.runAttemptWithTimeout(handler, task, cur, requestTimeoutMs, {
            imageIndex: claim.index,
            worker: attemptWorker,
          });
        } finally {
          claim.attempting = false;
        }
        const after = Date.now();
        this.timeEstimators[task.cls].addSample(after - before);
        done = true;
        // 성공했으니 연속 실패를 새로 센다(T4, 워커별).
        this.setConsecutiveFailures(w, 0);
        // 실제로 보낸 성공 요청이므로 정지된 루프의 마지막 성공도 센다(서비스·워커 수준 카운터).
        this.setLongBreakRemaining(w, this.getLongBreakRemaining(w) - 1);
        // 이 장의 시드는 썼다 — 정지 뒤 끝난 요청이면 종전처럼 집계하지 않고, 새 실행은 다른 번호로 그 장을 만든다.
        this.settleClaimIndex(claim, true);
        if (!cur.stopped) {
          task.done++;
          if (task.id! in this.taskSet) {
            this.groupStats[task.cls].done++;
            // 추가 시점에 고정한 키 사용 — 실행 중 씬/프로젝트 이름이 바뀌어도
            // 미등록 키 접근(TypeError → 유령 생성 오류)이 나지 않도록 가드.
            const sceneKey =
              task.sceneKey ??
              (task.params.scene
                ? getSceneKey(task.params.session, task.params.scene)
                : '');
            if (sceneKey in this.sceneStats) {
              this.sceneStats[sceneKey].done++;
            }
            const projectKey = task.projectKey ?? task.params.session.name;
            if (projectKey in this.projectStats) {
              this.projectStats[projectKey].done++;
            }
          }
        }
        this.finishClaim(w, claim, true);
        this.progressCycleStartedAt = Date.now();
        this.dispatchEvent(new CustomEvent('complete', {}));
        this.dispatchProgress();
        // 주기적 긴 휴식: 성공 300~399장마다 2~4분(지연 설정과 무관, requestTiming). 이번 장의 완료
        // 집계 뒤에 쉬므로 휴식 중 정지해도 방금 만든 장이 미완료로 남지 않는다. 정지하면 즉시 끝나고,
        // 남은(아직 아무 워커도 꺼내지 않은) 예약이 없으면 쉬지 않는다. 휴식에 들어갔으면 카운터를 새로 센다 —
        // 휴식 중 사용자가 정지해도 끝까지 쉰 것과 같이 본다(「정지하면 바로 끝납니다」). 큐 소진·정지로 휴식에
        // 들어가지 못했으면 0 이하로 남겨, 다음 실행이 2분 안에 시작되면 첫 성공 뒤 바로 쉰다(T3b).
        // 다중 워커(B1)는 워커마다 따로 쉬고(D5), 한 워커의 휴식을 큐 전체 「휴식 중」으로 그리지 않는다(로그만).
        if (
          this.getLongBreakRemaining(w) <= 0 &&
          !cur.stopped &&
          this.unclaimedImageCount() > 0
        ) {
          const breakMs = computeLongBreakMs();
          const startedAt = Date.now();
          const until = startedAt + breakMs;
          const display = !pool.multi;
          if (display) {
            this.longBreakStartedAt = startedAt;
            this.longBreakUntil = until;
            this.dispatchProgress();
          } else {
            this.addLog('info', '', WORKER_POOL_TEXT.longBreak(w.name, breakMs));
          }
          this.setLongBreakRemaining(w, nextLongBreakCount());
          try {
            await this.longBreakWait(breakMs, () => cur.stopped);
          } finally {
            // 이 휴식의 표시만 끈다(정지가 이미 껐거나 새 실행이 새 휴식을 시작했으면 건드리지 않음).
            if (display && this.longBreakUntil === until) this.endLongBreakDisplay();
          }
        }
      } catch (e: any) {
        const sceneName = task.params.scene?.name ?? '(unknown)';
        // 기본 계정 전용 처리(바이브 인코딩 등)가 필요하다는 핸들러 신호 — 이 장을 같은 번호로 돌려주고 이 워커는
        // 이 작업을 다시 꺼내지 않는다(실패로 세지 않음). 기본 워커에는 이 신호가 오지 않는다.
        if (!w.isDefault && isWorkerDeclinedError(e)) {
          (task.declinedWorkerIds ??= []).push(w.id);
          this.finishClaim(w, claim, false);
          this.addLog('info', sceneName, WORKER_POOL_TEXT.declined + tag);
          return 'next';
        }
        if (e.message === 'IP') {
          this.addLog('error', sceneName, 'IP 변경 감지로 중단');
          this.dispatchEvent(new CustomEvent('ip-check-fail', {}));
          this.finishClaim(w, claim, false);
          this.stop();
          return 'exit';
        }
        if (isRequestTimeoutError(e)) timeoutFailures++;
        failures++;
        // 429 판정은 NaiApiError status/kind 우선, 문자열은 폴백(요청 ID 의 「429」 오판정 방지).
        const rateLimited = isNaiRateLimitError(e);
        // 409(이전 요청 처리 중)는 429 가 아닐 때만 — 사다리 대신 고정 30초(T4).
        const concurrent = !rateLimited && isNaiConcurrentError(e);
        // 핸들러 별도 문구(업스케일 타임아웃 안내 등) — 있으면 로그·진행 바·오류 토스트에 쓴다.
        const notice = handler.failureNotice?.(task, e);
        if (notice) lastNotice = notice;
        lastErrorText = notice ?? String(e?.message ?? e);
        // 다음 시도가 남아 있고 재시도 가능한 실패면 대기 — 실패 횟수 사다리 5→10→20→40→60초
        // ±20%, 429 는 최소 60초, 409 는 고정 30초. 재시도에는 요청 사이 지연(handleDelay)을 더하지 않는다(T3).
        const willRetry = e?.retryable !== false && i + 1 < numTries;
        const waitMs = willRetry
          ? retryWaitMs(failures, rateLimited ? 'rate-limit' : concurrent ? 'concurrent' : 'other')
          : 0;
        const waitLabel = willRetry ? TASK_FAILURE_TEXT.waitSuffix(waitMs) : '';
        const attemptLabel = TASK_FAILURE_TEXT.attempt(i + 1, numTries);
        if (rateLimited) {
          this.addLog('warn', sceneName, `요청 제한 (429)${waitLabel}${attemptLabel}${tag}`);
          console.log(`Rate limited (429), waiting ${waitMs}ms before retry...`);
          this.dispatchEvent(
            new CustomEvent('error', {
              detail: { error: `요청 제한 (429)${waitLabel}`, task: task },
            }),
          );
          // 다중 워커: 여러 계정에서 이어지면 전 워커 일시 대기(대기 길이 = 이 429 의 대기).
          this.noteRateLimit(
            pool,
            w,
            waitMs > 0 ? waitMs : retryWaitMs(failures, 'rate-limit'),
            sceneName,
          );
        } else if (concurrent) {
          const label = `${naiErrorKindLabel('concurrent')} (409)`;
          this.addLog('warn', sceneName, `${label}${waitLabel}${attemptLabel}${tag}`);
          this.dispatchEvent(
            new CustomEvent('error', {
              detail: { error: `${label}${waitLabel}`, task: task },
            }),
          );
          // 다시 시도할 때만 안내(마지막 시도면 아래 건너뜀·연속 실패 처리로 알린다).
          if (willRetry) appState.pushMessage(TASK_FAILURE_TEXT.concurrentRetry, 'info');
        } else {
          const text = notice ?? e.message;
          this.addLog('error', sceneName, `${text}${waitLabel}${attemptLabel}${tag}`);
          this.dispatchEvent(
            new CustomEvent('error', {
              detail: { error: text, task: task },
            }),
          );
          if (notice) appState.pushMessage(notice, 'error');
        }
        console.error(e);
        // 인증 오류는 토큰을 고치기 전까지 모든 작업이 같은 이유로 실패하므로 아래에서 바로 정지한다.
        if (isNaiAuthError(e)) {
          authFailed = true;
          break;
        }
        // 프롬프트 한도·미지원 필드·Anlas/할당량 오류는 같은 요청을
        // 반복해도 회복되지 않는다. 서버/네트워크/429/409만 재시도한다.
        if (e?.retryable === false) break;
        // 대기 중 정지하면 남은 대기를 버린다(다음 반복 머리에서 정지 처리).
        if (waitMs > 0) await this.retryWait(waitMs, () => cur.stopped);
      }
      if (done) {
        break;
      }
    }
    if (done) return 'next';
    // 재시도 도중 런이 정지됐으면 스킵 처리 없이 종료 — 정지 후 남은 큐를
    // 옛 루프가 건드리면 새 런과 이중 제거가 발생한다.
    if (cur.stopped) return exitStopped();
    const sceneName = task.params.scene?.name ?? '(unknown)';
    // 인증 오류 즉시 정지: 재시도 소진·연속 실패 누적을 기다리지 않고 이 작업을 큐에 남긴 채 정지한다.
    // 다중 워커의 기본 계정이 아닌 워커는 그 워커만 빠지고(장은 반납), 남은 워커가 없을 때만 전체 정지.
    if (authFailed) {
      this.setConsecutiveFailures(w, 0);
      if (!pool.multi || w.isDefault) {
        this.finishClaim(w, claim, false);
        this.stopForFailure(cur, task, sceneName, TASK_FAILURE_TEXT.authStop(lastErrorText));
        return 'exit';
      }
      this.dropWorker(pool, w, claim, sceneName, WORKER_POOL_TEXT.authDropped(w.name, lastErrorText), 'dialog');
      if (!this.hasLiveWorker(pool)) {
        this.stopForFailure(cur, task, sceneName, TASK_FAILURE_TEXT.authStop(lastErrorText));
      }
      return 'exit';
    }
    // 연속 실패 정지(T4): 재시도를 소진한 작업(다중 워커는 장)이 CONSECUTIVE_FAILURE_STOP 개 연속이면 이 작업은
    // 건너뛰지 않고(큐에 남김) 큐를 완전히 정지한 뒤, 사용자가 확인을 누를 때까지 남는 창으로 알린다.
    // 다중 워커는 그 워커만 빠지고(장은 반납) 남은 워커가 없을 때만 같은 정지.
    const fails = this.getConsecutiveFailures(w) + 1;
    this.setConsecutiveFailures(w, fails);
    if (fails >= CONSECUTIVE_FAILURE_STOP) {
      this.setConsecutiveFailures(w, 0);
      if (!pool.multi) {
        this.finishClaim(w, claim, false);
        this.stopForFailure(cur, task, sceneName, TASK_FAILURE_TEXT.consecutiveStop(lastErrorText));
        return 'exit';
      }
      this.dropWorker(
        pool,
        w,
        claim,
        sceneName,
        WORKER_POOL_TEXT.consecutiveDropped(w.name, lastErrorText),
        'toast',
      );
      if (!this.hasLiveWorker(pool)) {
        this.stopForFailure(cur, task, sceneName, TASK_FAILURE_TEXT.consecutiveStop(lastErrorText));
      }
      return 'exit';
    }
    if (pool.multi) {
      // 다중 워커(D6): 끝내 실패한 그 장만 건너뛰고(그 시드는 쓰지 않음) 다음 장으로. 예약의 다른 장은 계속.
      this.addLog('error', sceneName, WORKER_POOL_TEXT.imageSkipped(numTries) + tag);
      this.dispatchEvent(
        new CustomEvent('error', {
          detail: { error: lastNotice ?? WORKER_POOL_TEXT.imageSkippedShort, task: task },
        }),
      );
      this.skipClaimedImage(claim);
      this.finishClaim(w, claim, true);
      this.dispatchProgress();
      return 'next';
    }
    // 실패한 태스크를 건너뛰고 다음 태스크로 진행(단일 워커 = 종전: 예약의 남은 장 전체)
    this.addLog('error', sceneName, TASK_FAILURE_TEXT.retriesExhausted(numTries));
    console.log('SKIPPING FAILED TASK:', task.params.scene?.name);
    this.dispatchEvent(
      new CustomEvent('error', {
        detail: { error: lastNotice ?? TASK_FAILURE_TEXT.retriesExhaustedShort, task: task },
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
    this.finishClaim(w, claim, false);
    this.removeTaskInternal(task);
    // 긴 재시도 구간 동안 사용자가 예약을 취소해 큐가 비었거나 머리가
    // 바뀌었을 수 있다 — 빈 큐 dequeue 는 throw 라 반드시 머리 동일성 확인.
    if (!this.queue.isEmpty() && this.queue.peek() === task) {
      this.queue.dequeue();
    }
    this.dispatchProgress();
    return 'next';
  }

  /**
   * 실패로 큐를 완전히 정지(연속 실패·인증 오류 공통). 작업은 큐에 남기고, 사용자가 확인을 누를
   * 때까지 남는 창과 'failure-stop' 이벤트(모바일 상주 알림 문구)로 알린다.
   */
  private stopForFailure(cur: TaskQueueRun, task: Task, sceneName: string, text: string) {
    cur.stopped = true;
    // 이 실행의 다른 워커가 꺼낸 장도 돌려준다(B1 — 단일 워커는 이미 돌려줬다).
    this.releasePoolClaimsOnStop(cur);
    this.stop();
    this.addLog('error', sceneName, text.replace(/\n/g, ' '));
    this.dispatchEvent(
      new CustomEvent('error', {
        detail: { error: text.split('\n')[0], task: task },
      }),
    );
    appState.pushDialog({ type: 'yes-only', text });
    // 모바일 백그라운드 알림(BackgroundNotificationService)이 같은 문구를 표시한다.
    this.dispatchEvent(new CustomEvent('failure-stop', { detail: { text } }));
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
      generationSnapshot: params.generationSnapshot,
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
        generationSnapshot: payload.generationSnapshot,
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
    this.beginProgressBatch();
    try {
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
    } finally {
      this.endProgressBatch();
    }
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
      const scene =
        payload.sceneType === 'inpaint'
          ? session.inpaints.get(payload.sceneName)
          : session.scenes.get(payload.sceneName);
      if (scene && payload.replacedPath) {
        imageService.removeImageReference(session, scene, payload.replacedPath);
      }
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
    // 긴 휴식이 끝났을 때도 리셋 — 다음 작업의 경과에 휴식 시간이 섞이지 않게(T3b).
    const breakEnded = (prev?.longBreakUntil ?? 0) > 0 && (snap.longBreakUntil ?? 0) === 0;
    if (snap.doneTotal > prevDone || (snap.running && !prevRunning) || breakEnded) {
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
      const remain = remainingImageCount(task!);
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
      longBreakStartedAt: this.longBreakStartedAt,
      longBreakUntil: this.longBreakUntil,
      boostWorkers: this.activeWorkerCount(),
    };
  }
}


export const queueWorkflow = async (
  session: Session,
  workflow: SelectedWorkflow,
  scene: GenericScene,
  samples: number,
  generationSnapshot?: GenerationSettingsSnapshot,
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
      undefined,
      undefined,
      generationSnapshot,
    );
  }
};

/**
 * 조합 전개 예약(미러·I2I 조합 모드 공용, 2026-10-04 B4 — SPEC §7-4). 생성 경로(createSDPrompts)와 같은 규칙으로
 * 조합마다 핸들러를 한 번 부른다. 반환 = 예약한 조합 수(활성 조각이 없는 열이 있으면 0 — 이미지생성 씬과 같음).
 */
const queueComboVariant = async (
  session: Session,
  type: string,
  preset: any,
  scene: InpaintScene,
  samples: number,
  onComplete?: (path: string) => void,
  generationSnapshot?: GenerationSettingsSnapshot,
): Promise<number> => {
  const def = workFlowService.getDef(type)!;
  const source = variantComboSource(session, scene, preset)!;
  const combos = await expandVariantCombos(session, scene, source, preset);
  for (const combo of combos) {
    await def.handler(
      session,
      scene,
      combo.prompt,
      combo.characterPrompts.map((cp) => cp.prompt),
      comboHandlerPreset(preset, combo, source.globalUc),
      undefined,
      samples,
      undefined,
      onComplete,
      undefined,
      generationSnapshot,
    );
  }
  return combos.length;
};

/**
 * 변형 씬 예약. 반환 = 예약한 조합 수(단일 프롬프트는 1). I2I·인페인트 조합 모드 씬은 조합 전개(queueComboVariant —
 * 인페인트는 조합마다 같은 마스크·Focused 영역, 2026-10-04 P1).
 */
export const queueI2IWorkflow = async (
  session: Session,
  type: string,
  preset: any,
  scene: GenericScene,
  samples: number,
  onComplete?: (path: string) => void,
  generationSnapshot?: GenerationSettingsSnapshot,
): Promise<number> => {
  // 저장된 변형 씬 자신의 프리셋일 때만 조합 전개(이미지 변형 메뉴의 임시 프리셋은 단일 프롬프트)
  if (
    scene.type === 'inpaint' &&
    (scene as InpaintScene).workflowType === type &&
    variantComboMode(scene as InpaintScene)
  ) {
    return queueComboVariant(
      session,
      type,
      preset,
      scene as InpaintScene,
      samples,
      onComplete,
      generationSnapshot,
    );
  }
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
    undefined,
    generationSnapshot,
  );
  return 1;
};

export type MirrorCanvasResult = Awaited<ReturnType<typeof prepareMirrorCanvas>>;

// 세션 미러 원본으로 합성 캔버스·마스크를 만든다(파일 읽기 + 캔버스 디코드·PNG 인코딩 2회).
const buildMirrorCanvas = async (
  session: Session,
  sourcePath: string,
  mode: 'blank' | 'duplicate',
): Promise<MirrorCanvasResult> => {
  const srcData = await imageService.fetchVibeImage(session, sourcePath);
  if (!srcData) {
    throw new Error('미러 이미지를 불러올 수 없습니다.');
  }
  return prepareMirrorCanvas(dataUriToBase64(srcData), mode);
};

// 일괄 예약 한 번 동안 쓰는 합성 캔버스 기억(2026-10-02 P1). 미러 이미지를 올리면
// 다른 미러 씬의 캔버스가 비워지므로(InPaintEditor) 일괄 예약은 씬마다 같은 원본·모드로
// 같은 캔버스를 다시 만들었다 — 모바일에서 씬 N개면 원본 읽기·디코드·PNG 인코딩 2회가
// N번. 결과는 (프로젝트, 원본 경로, 모드)로 결정되므로 묶음 안에서는 한 번만 만든다.
// 씬마다 고유 파일로 저장하는 것은 그대로다(편집기가 씬 파일을 제자리에서 덮어쓰므로
// 파일 공유 금지). 실패한 시도는 기억하지 않아 다음 씬이 종전처럼 다시 시도한다.
// 묶음이 끝나면 호출부가 버린다(전역 보관 없음 — 캔버스 문자열이 수 MB).
export interface MirrorCanvasMemo {
  get(
    session: Session,
    sourcePath: string,
    mode: 'blank' | 'duplicate',
  ): Promise<MirrorCanvasResult>;
}

export const createMirrorCanvasMemo = (
  build: typeof buildMirrorCanvas = buildMirrorCanvas,
): MirrorCanvasMemo => {
  const entries = new Map<string, Promise<MirrorCanvasResult>>();
  return {
    get(session, sourcePath, mode) {
      const key = `${session.name}\n${sourcePath}\n${mode}`;
      let entry = entries.get(key);
      if (!entry) {
        entry = build(session, sourcePath, mode);
        entries.set(key, entry);
        entry.catch(() => {
          if (entries.get(key) === entry) entries.delete(key);
        });
      }
      return entry;
    },
  };
};

export const queueMirrorWorkflow = async (
  session: Session,
  type: string,
  preset: any,
  scene: InpaintScene,
  samples: number,
  onComplete?: (path: string) => void,
  generationSnapshot?: GenerationSettingsSnapshot,
  canvasMemo?: MirrorCanvasMemo,
): Promise<number> => {
  // 미러 이미지가 씬에 아직 설정되지 않았으면 세션 미러 이미지로 자동 생성
  if (!preset.image) {
    if (!session.mirrorImage) {
      throw new Error('미러 이미지를 먼저 업로드해주세요.');
    }
    const mode = session.mirrorMode || 'blank';
    const result = canvasMemo
      ? await canvasMemo.get(session, session.mirrorImage, mode)
      : await buildMirrorCanvas(session, session.mirrorImage, mode);
    // primeCache: 바로 아래 핸들러(이미지·마스크)와 씬 카드가 같은 파일을 곧장 다시
    // 읽으므로 쓴 내용을 캐시에 넣어 디스크 왕복을 생략한다.
    preset.image = await imageService.storeVibeImage(session, result.canvas, true);
    preset.mask = await imageService.storeVibeImage(session, result.mask, true);
    scene.resolution = 'custom';
    scene.resolutionWidth = result.width;
    scene.resolutionHeight = result.height;
    scene.mirrorCropX = result.cropX;
  }

  // 조합 전개는 I2I 조합 모드와 같은 공용 경로(variantCombo — 생성 경로 createSDPrompts 규칙, SPEC §7-4).
  // 슬롯이 없으면 preset.prompt 한 조각으로 본다. 예전 미러 전용 DFS(빈 열 '' 대입·`|` 교차 없음·조각 캐릭터 무시)는 없앴다.
  return queueComboVariant(
    session,
    type,
    preset,
    scene,
    samples,
    onComplete,
    generationSnapshot,
  );
};
