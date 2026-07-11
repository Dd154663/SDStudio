// 사용자 보고 증상("씬에 이미지 개수는 N으로 뜨는데 썸네일/내부가 텅 빔") 경로 테스트.
// refresh(guardEmpty=true) 가 outs 폴더 0개를 "접근 불가"로 보고 기존 imageMap(N)을
// 유지하며, 진단용 경고 로그를 남기는지 검증.

const backend = {
  listFiles: jest.fn(async (_p: string) => [] as string[]),
};
const addLog = jest.fn();
const cleanGame = jest.fn();

jest.mock('..', () => ({
  backend,
  isMobile: false,
  gameService: { cleanGame },
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
  cleanGame.mockReset();
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

// 트랙1 B4 이슈②: 부분 소실 화해 시 랭킹(game/round) 죽은 참조 정리
describe('ImageService.refresh 랭킹 죽은 참조 정리', () => {
  test('부분 소실 → game 은 생존자만 남기고 랭크 정규화, round 는 해제', async () => {
    const svc = new ImageService();
    backend.listFiles.mockResolvedValue(['a.png']);
    const sc: any = {
      ...scene(['a.png', 'gone.png']),
      game: [
        { path: 'a.png', rank: 0 },
        { path: 'gone.png', rank: 1 },
      ],
      round: { players: ['a.png', 'gone.png'], winMask: [false, false], curPlayer: 0 },
    };

    await svc.refresh(session, sc, false, false);

    expect(sc.game).toEqual([{ path: 'a.png', rank: 0 }]);
    expect(cleanGame).toHaveBeenCalled(); // 결번 랭크 정규화 경유
    expect(sc.round).toBeUndefined();
  });

  test('전원 생존이면 game/round 를 건드리지 않는다', async () => {
    const svc = new ImageService();
    backend.listFiles.mockResolvedValue(['a.png', 'b.png']);
    const game = [
      { path: 'a.png', rank: 0 },
      { path: 'b.png', rank: 1 },
    ];
    const round = { players: ['a.png', 'b.png'], winMask: [false, false], curPlayer: 0 };
    const sc: any = { ...scene(['a.png', 'b.png']), game, round };

    await svc.refresh(session, sc, false, false);

    expect(sc.game).toBe(game); // 재할당 없음
    expect(sc.round).toBe(round);
    expect(cleanGame).not.toHaveBeenCalled();
  });

  test('전원 소실이면 game 을 해제한다', async () => {
    const svc = new ImageService();
    backend.listFiles.mockResolvedValue([]);
    const sc: any = {
      ...scene(['gone.png']),
      game: [{ path: 'gone.png', rank: 0 }],
    };

    await svc.refresh(session, sc, false, false);

    expect(sc.game).toBeUndefined();
  });
});

// 트랙1 B4 이슈①: 형제 씬 증거 기반 유령 참조 자동 화해
describe('ImageService.refreshBatch 유령 참조 자동 화해', () => {
  const makeSession = (scenes: any[]) => ({
    name: 'p1',
    scenes: new Map(scenes.map((s) => [s.name, s])),
    inpaints: new Map(),
  });

  test('형제 씬이 정상이면(증거 있음) 유령 씬 목록을 실제(0장)로 화해한다', async () => {
    const svc = new ImageService();
    const ghost = { ...scene(['x.png', 'y.png']), name: 'ghost' };
    const alive = { ...scene(['a.png']), name: 'alive' };
    backend.listFiles.mockImplementation(async (p: string) =>
      p.endsWith('/alive') ? ['a.png'] : [],
    );

    await svc.refreshBatch(makeSession([ghost, alive]) as any);

    expect(ghost.imageMap).toEqual([]); // 화해됨
    expect(svc.getImages(session, ghost as any)).toEqual([]);
    expect(
      addLog.mock.calls.some(
        (c) => c[0] === 'warn' && String(c[2]).includes('영구 소실'),
      ),
    ).toBe(true);
  });

  test('전 씬이 0장이면(증거 없음) 화해하지 않고 방어 유지한다', async () => {
    const svc = new ImageService();
    const ghost = { ...scene(['x.png', 'y.png']), name: 'ghost' };
    const ghost2 = { ...scene(['z.png']), name: 'ghost2' };
    backend.listFiles.mockResolvedValue([]);

    await svc.refreshBatch(makeSession([ghost, ghost2]) as any);

    expect(ghost.imageMap).toEqual(['x.png', 'y.png']); // 종전 유지
    expect(ghost2.imageMap).toEqual(['z.png']);
    expect(
      addLog.mock.calls.some((c) => String(c[2]).includes('영구 소실')),
    ).toBe(false);
  });
});
