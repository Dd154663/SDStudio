jest.mock('../index', () => ({
  backend: {
    deleteDir: jest.fn(async () => {}),
  },
  isMobile: false,
  gameService: {},
  imageService: {},
  taskQueueService: {},
  trashService: {},
}));

import { ImageService } from '../ImageService';
import { backend } from '../index';

describe('ImageService 배치 캐시 정리', () => {
  beforeEach(() => {
    (backend.deleteDir as jest.Mock).mockClear();
  });

  it('같은 이미지 디렉터리는 이미지 수와 무관하게 한 번만 삭제한다', async () => {
    const service = new ImageService();

    await service.invalidateCacheBatch([
      'outs/project/scene/.trash/a.webp',
      'outs/project/scene/.trash/b.webp',
      'outs/project/scene/.trash/a.webp',
    ]);

    expect(backend.deleteDir).toHaveBeenCalledTimes(1);
    expect(backend.deleteDir).toHaveBeenCalledWith(
      'outs/project/scene/.trash/fastcache',
    );
  });

  it('서로 다른 씬의 캐시 디렉터리는 각각 한 번만 삭제한다', async () => {
    const service = new ImageService();

    await service.invalidateCacheBatch([
      'outs/project/scene-a/.trash/a.webp',
      'outs/project/scene-b/.trash/b.webp',
    ]);

    expect(backend.deleteDir).toHaveBeenCalledTimes(2);
    expect((backend.deleteDir as jest.Mock).mock.calls.map((c) => c[0])).toEqual([
      'outs/project/scene-a/.trash/fastcache',
      'outs/project/scene-b/.trash/fastcache',
    ]);
  });
});
