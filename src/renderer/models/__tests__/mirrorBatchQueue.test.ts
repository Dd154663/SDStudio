// 미러 일괄 예약의 화면 반영 지연(2026-10-02 P1) 회귀 테스트.
// - 묶음 안에서 미러 합성 캔버스는 한 번만 만든다(씬마다 고유 파일 저장은 유지)
// - 미러 핸들러는 예약 시점 스냅샷을 안쪽 핸들러로 넘긴다(태스크마다 설정 재읽기 금지)
// - 일괄 예약 묶음은 길어지면 간격마다 중간 진행 반영(이벤트 수는 N 과 무관한 상한)
// - 모바일 알림은 스로틀로 버린 마지막 변경을 꼬리 갱신으로 반영
const fetchVibeImage = jest.fn();
const storeVibeImage = jest.fn();
const getOutputDir = jest.fn(() => 'outs/project/scene');
const getDef = jest.fn();
const addTask = jest.fn(async () => {});
const updateBackgroundNotification = jest.fn();
const fakeQueue = Object.assign(new EventTarget(), {
  statsAllTasks: jest.fn(() => ({ done: 0, total: 0 })),
  isRunning: jest.fn(() => false),
  estimateTime: jest.fn(() => 0),
  addTask,
});

jest.mock('..', () => ({
  backend: { getConfig: jest.fn(), updateBackgroundNotification },
  imageService: { fetchVibeImage, storeVibeImage, getOutputDir },
  isMobile: true,
  localAIService: {},
  promptService: { parseWord: jest.fn() },
  sessionService: {},
  taskQueueService: fakeQueue,
  workFlowService: { getDef, buildPreset: jest.fn() },
}));

jest.mock('../AppService', () => ({ appState: { pushMessage: jest.fn() } }));
jest.mock('../PersistenceService', () => ({
  persistService: { write: jest.fn(async () => {}) },
}));
jest.mock('../ImageService', () => ({
  dataUriToBase64: jest.fn((data: string) => data.split(',')[1]),
}));
jest.mock('../workflows/SDWorkFlow', () => ({
  ...jest.requireActual('../workflows/SDWorkFlow'),
  prepareMirrorCanvas: jest.fn(),
}));
jest.mock('../../componenets/BrushTool', () => ({
  getImageDimensions: jest.fn(),
}));

import {
  createMirrorCanvasMemo,
  PROGRESS_BATCH_INTERVAL_MS,
  queueI2IWorkflow,
  queueMirrorWorkflow,
  TaskHandler,
  TaskQueueService,
} from '../TaskQueueService';
import { COMBO_EXPANDED_KEY } from '../variantCombo';
import { PromptPiece } from '../types';
import { prepareMirrorCanvas, SDMirrorDef } from '../workflows/SDWorkFlow';
import { BackgroundNotificationService } from '../BackgroundNotificationService';

const prepare = prepareMirrorCanvas as jest.Mock;
const CANVAS = {
  canvas: 'CANVAS',
  mask: 'MASK',
  width: 1728,
  height: 1216,
  cropX: 896,
};

function makeScene(i: number) {
  return {
    type: 'inpaint',
    name: 'mirror' + i,
    workflowType: 'SDMirror',
    slots: [],
    resolution: 'portrait',
  } as any;
}

let fileSeq = 0;
beforeEach(() => {
  jest.clearAllMocks();
  fileSeq = 0;
  fetchVibeImage.mockImplementation(async () => 'data:image/png;base64,SRC');
  storeVibeImage.mockImplementation(async () => `file${fileSeq++}.png`);
  prepare.mockImplementation(async () => CANVAS);
});

let dateSpy: jest.SpyInstance | undefined;
afterEach(() => {
  dateSpy?.mockRestore();
  dateSpy = undefined;
  jest.useRealTimers();
});

describe('미러 일괄 예약 — 합성 캔버스 기억', () => {
  const session = { name: 'project', mirrorImage: 'src.png', mirrorMode: 'blank' } as any;

  test('씬 200개 묶음: 원본 읽기·캔버스 생성 1회, 씬마다 고유 파일 2개(캐시 선적재)', async () => {
    const handler = jest.fn(async () => {});
    getDef.mockReturnValue({ handler });
    const memo = createMirrorCanvasMemo();
    const snapshot = { modelVersion: 'v' } as any;
    const scenes = Array.from({ length: 200 }, (_, i) => makeScene(i));
    for (const scene of scenes) {
      scene.preset = { image: '', mask: '' };
      await queueMirrorWorkflow(session, 'SDMirror', scene.preset, scene, 1, undefined, snapshot, memo);
    }
    expect(fetchVibeImage).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(storeVibeImage).toHaveBeenCalledTimes(400);
    for (const call of storeVibeImage.mock.calls as any[][]) {
      expect(call[2]).toBe(true);
    }
    // 저장 내용·씬 필드는 종전과 동일, 파일은 씬마다 따로
    const paths = new Set<string>();
    for (const scene of scenes) {
      expect(scene).toMatchObject({
        resolution: 'custom',
        resolutionWidth: 1728,
        resolutionHeight: 1216,
        mirrorCropX: 896,
      });
      paths.add(scene.preset.image);
      paths.add(scene.preset.mask);
    }
    expect(paths.size).toBe(400);
    expect(storeVibeImage.mock.calls.filter((c: any[]) => c[1] === 'CANVAS')).toHaveLength(200);
    expect(storeVibeImage.mock.calls.filter((c: any[]) => c[1] === 'MASK')).toHaveLength(200);
    expect(handler).toHaveBeenCalledTimes(200);
    for (const call of handler.mock.calls as any[][]) {
      expect(call[10]).toBe(snapshot);
    }
  });

  test('기억 없이(단일 예약) 부르면 종전처럼 씬마다 만든다', async () => {
    getDef.mockReturnValue({ handler: jest.fn(async () => {}) });
    for (let i = 0; i < 3; i++) {
      const scene = makeScene(i);
      scene.preset = { image: '' };
      await queueMirrorWorkflow(session, 'SDMirror', scene.preset, scene, 1);
    }
    expect(prepare).toHaveBeenCalledTimes(3);
  });

  test('원본·모드·프로젝트가 다르면 따로 만들고, 실패는 기억하지 않는다', async () => {
    const memo = createMirrorCanvasMemo();
    await memo.get(session, 'src.png', 'blank');
    await memo.get(session, 'src.png', 'duplicate');
    await memo.get(session, 'other.png', 'blank');
    await memo.get({ name: 'project2' } as any, 'src.png', 'blank');
    await memo.get(session, 'src.png', 'blank');
    expect(prepare).toHaveBeenCalledTimes(4);

    fetchVibeImage.mockImplementationOnce(async () => null);
    const memo2 = createMirrorCanvasMemo();
    await expect(memo2.get(session, 'src.png', 'blank')).rejects.toThrow(
      '미러 이미지를 불러올 수 없습니다.',
    );
    await expect(memo2.get(session, 'src.png', 'blank')).resolves.toBe(CANVAS);
  });

  test('이미 캔버스가 있는 씬은 다시 만들지 않는다', async () => {
    const handler = jest.fn(async () => {});
    getDef.mockReturnValue({ handler });
    const scene = makeScene(0);
    scene.preset = { image: 'kept.png', mask: 'kept-mask.png' };
    await queueMirrorWorkflow(session, 'SDMirror', scene.preset, scene, 1, undefined, undefined, createMirrorCanvasMemo());
    expect(prepare).not.toHaveBeenCalled();
    expect(storeVibeImage).not.toHaveBeenCalled();
    expect(scene.preset.image).toBe('kept.png');
  });
});

describe('미러 핸들러 스냅샷 전달', () => {
  test('예약 시점 스냅샷을 addTask 까지 넘긴다', async () => {
    const snapshot = { modelVersion: 'v' } as any;
    const scene = makeScene(0);
    await SDMirrorDef.handler(
      { name: 'project' } as any,
      scene,
      { type: 'text', text: '' },
      [],
      { image: 'canvas.png', mask: 'mask.png', prompt: '', uc: '' },
      undefined,
      1,
      undefined,
      undefined,
      undefined,
      snapshot,
    );
    expect(addTask).toHaveBeenCalledTimes(1);
    const param = (addTask.mock.calls as any[][])[0][0];
    expect(param.generationSnapshot).toBe(snapshot);
    expect(param.job.image).toBe('SRC');
  });
});

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

function makeParam(scene: any = { name: 'scene', type: 'scene' }) {
  return {
    session: { name: 'project' },
    scene,
    job: { type: 'sd' },
    outputPath: 'outs/project/scene',
  } as any;
}

describe('일괄 예약 진행 이벤트 — 중간 반영', () => {
  test('긴 묶음(200건 × 20ms)은 간격마다 중간 반영, 이벤트 수는 경과 시간 상한', async () => {
    let now = 10_000;
    dateSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    const service = new TaskQueueService([makeHandler()]);
    const onProgress = jest.fn();
    service.addEventListener('progress', onProgress);
    const seen: number[] = [];
    await service.withProgressBatch(async () => {
      for (let i = 0; i < 200; i++) {
        now += 20;
        service.addTaskLocal(makeParam(), 1);
        seen.push(onProgress.mock.calls.length);
        await Promise.resolve();
      }
    });
    const elapsed = 200 * 20;
    const count = onProgress.mock.calls.length;
    expect(count).toBeGreaterThanOrEqual(2);
    expect(count).toBeLessThanOrEqual(Math.ceil(elapsed / PROGRESS_BATCH_INTERVAL_MS) + 1);
    // 묶음 도중에 이미 반영이 나갔다
    expect(seen[Math.floor(PROGRESS_BATCH_INTERVAL_MS / 20)]).toBeGreaterThanOrEqual(1);
    expect(service.statsAllTasks()).toEqual({ done: 0, total: 200 });
  });

  test('짧은 묶음은 종전처럼 마지막 1회', async () => {
    const service = new TaskQueueService([makeHandler()]);
    const onProgress = jest.fn();
    service.addEventListener('progress', onProgress);
    await service.withProgressBatch(async () => {
      for (let i = 0; i < 200; i++) service.addTaskLocal(makeParam(), 1);
    });
    expect(onProgress).toHaveBeenCalledTimes(1);
  });

  test('묶음 도중 씬 예약 제거(동기 재구성)는 중간 반영을 내지 않는다', async () => {
    let now = 10_000;
    dateSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    const service = new TaskQueueService([makeHandler()]);
    const sceneA = { name: 'a', type: 'scene' };
    const sceneB = { name: 'b', type: 'scene' };
    const onProgress = jest.fn();
    service.addEventListener('progress', onProgress);
    let during = -1;
    await service.withProgressBatch(async () => {
      service.addTaskLocal(makeParam(sceneA), 2);
      service.addTaskLocal(makeParam(sceneB), 3);
      now += PROGRESS_BATCH_INTERVAL_MS * 4;
      const before = onProgress.mock.calls.length;
      service.removeTasksFromScenes(new Set([sceneA as any]));
      during = onProgress.mock.calls.length - before;
    });
    expect(during).toBe(0);
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(service.statsAllTasks()).toEqual({ done: 0, total: 3 });
  });
});

describe('모바일 알림 꼬리 갱신', () => {
  test('스로틀 창 안의 마지막 변경도 창이 끝나면 반영한다', () => {
    jest.useFakeTimers();
    jest.setSystemTime(100_000);
    const svc = new BackgroundNotificationService();
    svc.start();
    fakeQueue.statsAllTasks.mockReturnValue({ done: 0, total: 3 });
    fakeQueue.dispatchEvent(new CustomEvent('progress'));
    expect(updateBackgroundNotification).toHaveBeenLastCalledWith('SDStudio', '대기 중 · 3개 예약됨');
    jest.advanceTimersByTime(500);
    fakeQueue.statsAllTasks.mockReturnValue({ done: 0, total: 200 });
    fakeQueue.dispatchEvent(new CustomEvent('progress'));
    expect(updateBackgroundNotification).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(2500);
    expect(updateBackgroundNotification).toHaveBeenCalledTimes(2);
    expect(updateBackgroundNotification).toHaveBeenLastCalledWith('SDStudio', '대기 중 · 200개 예약됨');
  });

  test('연속 실패 정지(failure-stop)는 다음 시작 전까지 안내 문구를 한 줄로 보이고, 시작하면 지운다(T4)', () => {
    jest.useFakeTimers();
    jest.setSystemTime(500_000);
    const svc = new BackgroundNotificationService();
    svc.start();
    fakeQueue.isRunning.mockReturnValue(false);
    fakeQueue.statsAllTasks.mockReturnValue({ done: 0, total: 3 });
    fakeQueue.dispatchEvent(
      new CustomEvent('failure-stop', { detail: { text: '첫 줄\n마지막 오류: x\n끝' } }),
    );
    expect(updateBackgroundNotification).toHaveBeenLastCalledWith('SDStudio', '첫 줄 마지막 오류: x 끝');
    // 스로틀 꼬리 갱신·진행 이벤트도 안내를 유지한다
    jest.advanceTimersByTime(3000);
    fakeQueue.dispatchEvent(new CustomEvent('progress'));
    expect(updateBackgroundNotification).toHaveBeenLastCalledWith('SDStudio', '첫 줄 마지막 오류: x 끝');
    fakeQueue.dispatchEvent(new CustomEvent('start'));
    expect(updateBackgroundNotification).toHaveBeenLastCalledWith('SDStudio', '대기 중 · 3개 예약됨');
    jest.useRealTimers();
  });
});

// 조합 전개 예약(2026-10-04 B4 — SPEC §7-4): 미러·I2I 조합 모드가 같은 공용 경로로 조합 수만큼 핸들러를 부른다.
describe('조합 전개 예약 — 미러·I2I 조합 모드', () => {
  const session = { name: 'project', mirrorImage: 'src.png', mirrorMode: 'blank', library: new Map() } as any;
  const piece = (prompt: string, enabled?: boolean) =>
    PromptPiece.fromJSON({ prompt, characterPrompts: [], id: prompt, enabled } as any);

  test('미러: 2×2 조합 = 4번, 활성 조각이 없는 열이 있으면 0번(예전 DFS 는 빈 문자열로 예약)', async () => {
    const handler = jest.fn(async () => {});
    getDef.mockReturnValue({ handler });
    const scene = makeScene(0);
    scene.slots = [[piece('a'), piece('b')], [piece('x'), piece('y')]];
    scene.preset = { image: 'kept.png', mask: 'm.png', uc: '' };
    expect(await queueMirrorWorkflow(session, 'SDMirror', scene.preset, scene, 1)).toBe(4);
    expect(handler).toHaveBeenCalledTimes(4);
    for (const call of handler.mock.calls as any[][]) {
      expect(call[4][COMBO_EXPANDED_KEY]).toBeDefined();
    }
    handler.mockClear();
    scene.slots = [[piece('a')], [piece('z', false)]];
    expect(await queueMirrorWorkflow(session, 'SDMirror', scene.preset, scene, 1)).toBe(0);
    expect(handler).not.toHaveBeenCalled();
  });

  test('I2I 조합 모드는 조합 수만큼, 단일 I2I·이미지 변형 메뉴(임시 씬)는 1번', async () => {
    const handler = jest.fn(async () => {});
    getDef.mockReturnValue({ handler });
    const combo = {
      type: 'inpaint',
      name: 'i2i',
      workflowType: 'SDI2I',
      comboMode: 'snapshot',
      slots: [[piece('a'), piece('b'), piece('c')]],
      preset: { image: 'img.png', uc: 'scene', frontPrompt: 'F', backPrompt: 'B', globalUc: 'G' },
    } as any;
    expect(await queueI2IWorkflow(session, 'SDI2I', combo.preset, combo, 1)).toBe(3);
    expect(handler).toHaveBeenCalledTimes(3);
    expect((handler.mock.calls[0] as any[])[4].uc).toBe('G, scene');

    handler.mockClear();
    const single = { ...combo, comboMode: undefined };
    expect(await queueI2IWorkflow(session, 'SDI2I', single.preset, single, 1)).toBe(1);
    expect((handler.mock.calls[0] as any[])[4]).toBe(single.preset);

    handler.mockClear();
    const general = { type: 'scene', name: 's', slots: combo.slots } as any;
    expect(await queueI2IWorkflow(session, 'SDI2I', { image: 'x' }, general, 1)).toBe(1);
  });
});
