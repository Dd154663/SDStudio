const getConfig = jest.fn();
const delegateTask = jest.fn(async () => {});
const delegateComplete = jest.fn(async () => {});
const getSession = jest.fn();
const pushMessage = jest.fn();

jest.mock('..', () => ({
  backend: {
    getConfig,
    delegateTask,
    delegateComplete,
  },
  imageService: {},
  isMobile: false,
  localAIService: {},
  promptService: {},
  sessionService: {
    get: getSession,
  },
  taskQueueService: {},
  workFlowService: {},
}));

jest.mock('../AppService', () => ({
  appState: {
    pushMessage,
  },
}));

jest.mock('../PersistenceService', () => ({
  persistService: {
    write: jest.fn(async () => {}),
  },
}));

jest.mock('../PromptService', () => ({
  expandPieces: jest.fn(),
  lowerPromptNode: jest.fn(),
  toPARR: jest.fn(),
}));

jest.mock('../ImageService', () => ({
  dataUriToBase64: jest.fn(),
}));

jest.mock('../workflows/SDWorkFlow', () => ({
  prepareMirrorCanvas: jest.fn(),
}));

jest.mock('../../componenets/BrushTool', () => ({
  getImageDimensions: jest.fn(),
}));

import { ModelVersion } from '../../backends/imageGen';
import {
  DelegatedTaskPayload,
  TaskHandler,
  TaskQueueService,
} from '../TaskQueueService';

function makeHandler(): TaskHandler {
  return {
    createTimeEstimator: jest.fn() as any,
    checkTask: () => true,
    handleTask: jest.fn(async () => true),
    getNumTries: () => 1,
    handleDelay: jest.fn(async () => {}),
    getInfo: () => ({ name: 'test', emoji: 'T' }),
    calculateCost: () => [],
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

beforeEach(() => {
  getConfig.mockReset();
  delegateTask.mockClear();
  delegateComplete.mockClear();
  getSession.mockReset();
  pushMessage.mockClear();
});

describe('TaskQueueService 예약 생성 설정 스냅샷', () => {
  test('로컬 예약 시 config를 한 번 읽어 작업에 고정한다', async () => {
    getConfig.mockResolvedValue({
      modelVersion: ModelVersion.V4_5Curated,
      furryMode: true,
      disableQuality: true,
      qualityPreset: 'none',
      ucPreset: 'light',
      transparentBackground: false,
      autoConvertWebp: true,
      autoConvertWebpQuality: 72,
    });
    const service = new TaskQueueService([makeHandler()]);

    await service.addTask(makeParam(), 2);

    expect(getConfig).toHaveBeenCalledTimes(1);
    expect(service.queue.peek().params.generationSnapshot).toEqual({
      schemaVersion: 1,
      modelVersion: ModelVersion.V4_5Curated,
      furryMode: true,
      disableQuality: true,
      qualityPreset: 'none',
      ucPreset: 'light',
      transparentBackground: false,
      autoConvertWebp: true,
      autoConvertWebpQuality: 72,
    });
  });

  test('보조 창 위임 payload에 같은 스냅샷을 포함한다', async () => {
    getConfig.mockResolvedValue({ modelVersion: ModelVersion.V4 });
    const service = new TaskQueueService([makeHandler()]);
    service.isGenerationHost = false;

    await service.addTask(makeParam(), 3);

    expect(delegateTask).toHaveBeenCalledTimes(1);
    expect((delegateTask.mock.calls as any[][])[0][0]).toMatchObject({
      sessionName: 'project',
      sceneName: 'scene',
      samples: 3,
      generationSnapshot: {
        schemaVersion: 1,
        modelVersion: ModelVersion.V4,
      },
    });
  });

  test('스냅샷이 없는 구 위임 payload도 기존 방식으로 수신한다', async () => {
    const scene = { name: 'scene', type: 'scene' };
    const session = {
      name: 'project',
      getScene: jest.fn(() => scene),
    };
    getSession.mockResolvedValue(session);
    const service = new TaskQueueService([makeHandler()]);
    const payload: DelegatedTaskPayload = {
      taskId: 'legacy-task',
      sessionName: 'project',
      sceneName: 'scene',
      sceneType: 'scene',
      job: { type: 'sd' },
      outputPath: 'outs/project/scene',
      samples: 1,
      nodelay: false,
      hasOnComplete: false,
      originWindowId: 7,
    };

    await (service as any).receiveDelegatedTask(payload);

    expect(service.queue.peek().params.generationSnapshot).toBeUndefined();
    expect(getConfig).not.toHaveBeenCalled();
  });
});
