// 사용자 보고 증상("씬에 이미지 개수는 N으로 뜨는데 썸네일/내부가 텅 빔") 경로 테스트.
// refresh(guardEmpty=true) 가 outs 폴더 0개를 "접근 불가"로 보고 기존 imageMap(N)을
// 유지하며, 진단용 경고 로그를 남기는지 검증.

const backend = {
  listFiles: jest.fn(async (_p: string) => [] as string[]),
};
const addLog = jest.fn();

jest.mock('..', () => ({
  backend,
  isMobile: false,
  gameService: {},
  imageService: {},
  taskQueueService: { addLog },
}));

import { ImageService } from '../ImageService';

const session: any = { name: 'p1' };
const scene = (imageMap: string[]) => ({
  type: 'scene',
  name: 'sceneA',
  imageMap,
  mains: [],
});

beforeEach(() => {
  backend.listFiles.mockReset();
  addLog.mockReset();
});

describe('ImageService.refresh guardEmpty (유령 상태 방지 + 진단 로그)', () => {
  test('파일 0개 + 기존 imageMap N개 → 목록 유지하고 경고 로그를 남긴다', async () => {
    const svc = new ImageService();
    backend.listFiles.mockResolvedValue([]); // outs 폴더 읽기 0개(접근 불가 의심)
    const sc = scene(['a.png', 'b.png']);

    await svc.refresh(session, sc as any, false, true);

    // imageMap(개수)은 보존됨
    expect(svc.getImages(session, sc as any)).toEqual(['a.png', 'b.png']);
    // 진단 로그가 남았는지
    expect(
      addLog.mock.calls.some(
        (c) => c[0] === 'warn' && String(c[2]).includes('읽지 못해'),
      ),
    ).toBe(true);
  });

  test('guardEmpty=false 면 0개 반환을 그대로 반영(목록 비움, 로그 없음)', async () => {
    const svc = new ImageService();
    backend.listFiles.mockResolvedValue([]);
    const sc = scene(['a.png', 'b.png']);

    await svc.refresh(session, sc as any, false, false);

    expect(svc.getImages(session, sc as any)).toEqual([]);
    expect(addLog).not.toHaveBeenCalled();
  });
});
