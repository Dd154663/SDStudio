// deleteImageFiles / deleteImageFilesDetailed 반환값(2026-11-01 U0-a T5).
// 기존 숫자 반환(실패 수, scene 없으면 0)은 그대로, 상세판은 옮겨진 경로·실패 경로를 돌려준다.

const moveImagesToTrashDetailed = jest.fn(async (..._a: any[]): Promise<any> => undefined);
const invalidateCache = jest.fn(async (_p: string) => {});
const refresh = jest.fn(async (..._a: any[]) => {});
const refreshBatch = jest.fn(async (..._a: any[]) => {});
const trashFile = jest.fn(async (_p: string) => {});
const pushMessage = jest.fn();

jest.mock('..', () => ({
  backend: { trashFile: (p: string) => trashFile(p) },
  isMobile: false,
  gameService: {},
  imageService: {
    invalidateCache: (p: string) => invalidateCache(p),
    refresh: (...a: any[]) => refresh(...a),
    refreshBatch: (...a: any[]) => refreshBatch(...a),
  },
  taskQueueService: { addLog: jest.fn() },
  trashService: {
    moveImagesToTrashDetailed: (...a: any[]) => moveImagesToTrashDetailed(...a),
  },
}));
jest.mock('../appStateRef', () => ({
  getAppState: () => ({ pushMessage }),
}));

import { deleteImageFiles, deleteImageFilesDetailed } from '../ImageService';

const session: any = { name: 'P' };
const scene: any = { name: 'S', type: 'scene' };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('deleteImageFilesDetailed (T5)', () => {
  test('씬 휴지통: 옮겨진·실패 경로를 그대로 돌려주고 실패는 한 번 알린다', async () => {
    moveImagesToTrashDetailed.mockResolvedValue({
      moved: ['outs/P/S/a.png'],
      failed: ['outs/P/S/b.png'],
    });
    const r = await deleteImageFilesDetailed(session, ['outs/P/S/a.png', 'outs/P/S/b.png'], scene);
    expect(r).toEqual({ moved: ['outs/P/S/a.png'], failed: ['outs/P/S/b.png'] });
    expect(refresh).toHaveBeenCalledWith(session, scene);
    expect(invalidateCache).toHaveBeenCalledTimes(2);
    expect(pushMessage).toHaveBeenCalledTimes(1);
  });

  test('notify:false 면 알리지 않는다', async () => {
    moveImagesToTrashDetailed.mockResolvedValue({ moved: [], failed: ['x'] });
    await deleteImageFilesDetailed(session, ['x'], scene, { notify: false });
    expect(pushMessage).not.toHaveBeenCalled();
  });

  test('scene 없음(OS 휴지통): 성공·실패를 나눠 돌려준다', async () => {
    trashFile.mockImplementation(async (p: string) => {
      if (p === 'b') throw new Error('locked');
    });
    const r = await deleteImageFilesDetailed(session, ['a', 'b']);
    expect(r).toEqual({ moved: ['a'], failed: ['b'] });
    expect(refreshBatch).toHaveBeenCalledWith(session);
  });

  test('이동 중 예외여도 목록 재로딩은 하고 예외를 전파(기존 동작)', async () => {
    moveImagesToTrashDetailed.mockRejectedValue(new Error('boom'));
    await expect(deleteImageFilesDetailed(session, ['a'], scene)).rejects.toThrow('boom');
    expect(refresh).toHaveBeenCalled();
  });
});

describe('deleteImageFiles 기존 숫자 반환 호환', () => {
  test('씬 휴지통: 실패 수', async () => {
    moveImagesToTrashDetailed.mockResolvedValue({ moved: ['a'], failed: ['b', 'c'] });
    expect(await deleteImageFiles(session, ['a', 'b', 'c'], scene, { notify: false })).toBe(2);
  });

  test('scene 없음: 실패가 있어도 0(예전과 같음)', async () => {
    trashFile.mockRejectedValue(new Error('locked'));
    expect(await deleteImageFiles(session, ['a'])).toBe(0);
  });
});
