jest.mock('..', () => ({
  backend: { readDataFile: jest.fn() },
  imageService: { getOutputDir: jest.fn(() => 'project-scene-output') },
  taskQueueService: { addTask: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../AppService', () => ({ appState: { pushDialog: jest.fn(), pushMessage: jest.fn(), setProgressDialog: jest.fn() } }));
jest.mock('../../componenets/BrushTool', () => ({ getImageDimensions: jest.fn() }));
jest.mock('../ImageService', () => ({ dataUriToBase64: (data: string) => data.split(',')[1] }));

import { collectFavoriteUpscaleTargets, queueNaiUpscale, queueNaiUpscaleImages } from '../workflows/NaiUpscaleFlow';
import { appState } from '../AppService';
import { backend, taskQueueService } from '..';
import { getImageDimensions } from '../../componenets/BrushTool';

beforeEach(() => {
  jest.clearAllMocks();
  (getImageDimensions as jest.Mock).mockReset().mockImplementation(async (source: string) => {
    if (source.startsWith('data:')) throw new Error('중복 data URI 접두사');
    return { width: 832, height: 1216 };
  });
  (backend.readDataFile as jest.Mock).mockReset().mockResolvedValue('data:image/png;base64,image');
  (appState.pushDialog as jest.Mock).mockReset().mockImplementation((d) => d.callback());
});

const targets = () => ['a', 'b'].map((path) => ({ scene: {} as any, path }));

test('일괄 확인을 취소하면 예약도 하지 않는다', async () => {
  (appState.pushDialog as jest.Mock).mockImplementation((d) => d.onCancel());
  await queueNaiUpscaleImages({} as any, targets());
  expect(taskQueueService.addTask).not.toHaveBeenCalled();
});

test('단일 이미지는 확인창 없이 공용 큐에 같은 씬의 1장만 예약한다', async () => {
  const session = {} as any;
  const scene = {} as any;
  await queueNaiUpscale(session, scene, 'image');
  expect(appState.pushDialog).not.toHaveBeenCalled();
  expect(taskQueueService.addTask).toHaveBeenCalledTimes(1);
  expect(appState.pushMessage).not.toHaveBeenCalled();
  expect(taskQueueService.addTask).toHaveBeenCalledWith({
    session, scene, outputPath: 'project-scene-output',
    job: { type: 'upscale', image: 'image', width: 832, height: 1216,
      resolution: '832x1216', backend: { type: 'NAI' } },
  }, 1);
});

test('여러 이미지는 총 비용 한 번 확인하고 경로만 큐에 넣는다', async () => {
  const selected = targets();
  await queueNaiUpscaleImages({} as any, [...selected, selected[0]]);
  expect(appState.pushDialog).toHaveBeenCalledTimes(1);
  expect(appState.pushDialog).toHaveBeenCalledWith(expect.objectContaining({ text: '업스케일 ×2 · 2장 · 예상 2 Anlas' }));
  expect(taskQueueService.addTask).toHaveBeenCalledTimes(2);
  expect(appState.pushMessage).not.toHaveBeenCalled();
  expect(taskQueueService.addTask).toHaveBeenNthCalledWith(1, expect.objectContaining({ job: expect.objectContaining({ image: '', imagePath: 'a' }) }), 1);
});

test.each(['png', 'webp'])('단일 우클릭 %s data URI를 정규화하고 성공 알림 없이 예약', async (ext) => {
  (backend.readDataFile as jest.Mock).mockResolvedValue(`data:image/${ext};base64,image`);
  await queueNaiUpscaleImages({} as any, targets().slice(0, 1));
  expect(appState.pushDialog).not.toHaveBeenCalled();
  expect(taskQueueService.addTask).toHaveBeenCalledTimes(1);
  expect(getImageDimensions).toHaveBeenCalledWith('image');
  expect(appState.pushMessage).not.toHaveBeenCalled();
});

test('일부 읽기 실패를 제외하고 나머지 작업을 예약', async () => {
  (backend.readDataFile as jest.Mock).mockRejectedValueOnce(new Error('missing'));
  await queueNaiUpscaleImages({} as any, targets());
  expect(appState.pushDialog).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('1장 · 예상 1 Anlas') }));
  expect(taskQueueService.addTask).toHaveBeenCalledTimes(1);
  expect(appState.pushMessage).toHaveBeenCalledWith('업스케일 1장 제외 (미지원·읽기 또는 예약 실패)');
});

test('대상 확인 도중 취소하면 부분 예약 없이 종료', async () => {
  (appState.setProgressDialog as jest.Mock).mockImplementation((d) => d?.onCancel?.());
  await queueNaiUpscaleImages({} as any, targets());
  expect(taskQueueService.addTask).not.toHaveBeenCalled();
  expect(appState.setProgressDialog).toHaveBeenLastCalledWith(undefined);
  (appState.setProgressDialog as jest.Mock).mockReset();
});

test('즐겨찾기 없는 씬은 제외하고 중복 없이 대상 스냅샷 생성', () => {
  const a = { mains: ['favorite', 'favorite'] } as any;
  const b = { mains: [], imageMap: ['not-favorite'] } as any;
  const selected = collectFavoriteUpscaleTargets({} as any, [a, b]);
  a.mains.push('later');
  expect(selected).toEqual([{ scene: a, path: 'project-scene-output/favorite' }]);
});

test('큰 이미지는 확인창을 띄우거나 예약하지 않는다', async () => {
  (getImageDimensions as jest.Mock).mockResolvedValue({ width: 2048, height: 2048 });
  await expect(queueNaiUpscale({} as any, {} as any, 'image')).rejects.toThrow();
  expect(appState.pushDialog).not.toHaveBeenCalled();
  expect(taskQueueService.addTask).not.toHaveBeenCalled();
});
