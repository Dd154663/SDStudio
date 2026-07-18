// 이미지 히스토리 영속화 가드 (2026-07-18 개편):
//  - 보관 상한 = 전체 최근 HISTORY_LIMIT장 (세션당 상한안은 부하 우려로 기각)
//  - history.json 저장/로드 라운드트립 (디바운스 저장 포함)
//  - 로드: 하드 삭제된 프로젝트 항목 필터 + 런타임 수집분과 id 병합
//  - 파손 파일 → 빈 히스토리로 재시작(저장은 허용)

const files: Record<string, string> = {};
const backend = {
  existFile: jest.fn(async (p: string) => p in files),
  readFile: jest.fn(async (p: string) => {
    if (!(p in files)) throw new Error('no file');
    return files[p];
  }),
};
const mockProjects: string[] = [];

jest.mock('..', () => ({
  backend,
  imageService: {
    addEventListener: () => {},
    images: {},
    inpaints: {},
  },
  sessionService: {
    list: () => [...mockProjects],
  },
}));
jest.mock('../ImageService', () => ({
  toggleImageMain: jest.fn(),
}));

const writes: Array<{ path: string; data: string }> = [];
jest.mock('../PersistenceService', () => ({
  persistService: {
    write: jest.fn(async (path: string, data: string) => {
      writes.push({ path, data });
      files[path] = data;
    }),
  },
}));
jest.mock('../appStateRef', () => ({
  getAppState: () => ({ pushMessage: jest.fn() }),
}));

import { HISTORY_LIMIT, ImageHistoryService } from '../ImageHistoryService';

const entry = (session: string, n: number) => ({
  sessionName: session,
  sceneType: 'scene' as const,
  sceneName: 'scene1',
  filename: `${n}.png`,
  path: `outs/${session}/scene1/${n}.png`,
});

// 디바운스 저장(800ms) 플러시 — 타이머 진행 + async save 완료 대기
const flushSave = async () => {
  jest.advanceTimersByTime(1000);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  for (const k of Object.keys(files)) delete files[k];
  writes.length = 0;
  mockProjects.length = 0;
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('이미지 히스토리 — 세션당 상한 + 영속화', () => {
  it('전체 최근 HISTORY_LIMIT 적용 — 오래된 것부터 밀림 (세션 무관)', async () => {
    const svc = new ImageHistoryService();
    await svc.ensureLoaded();
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) svc.push(entry('A', i));
    for (let i = 0; i < 5; i++) svc.push(entry('B', i));
    expect(svc.entries.length).toBe(HISTORY_LIMIT);
    // 최신(B 5개 + A 후반부)이 보존되고 A 의 오래된 항목부터 밀린다
    expect(svc.entries[0].filename).toBe('4.png');
    expect(svc.entries[0].sessionName).toBe('B');
    expect(
      svc.entries.some((e) => e.sessionName === 'A' && e.filename === '0.png'),
    ).toBe(false);
    expect(svc.entries.filter((e) => e.sessionName === 'B').length).toBe(5);
  });

  it('저장/로드 라운드트립 (디바운스 저장)', async () => {
    const svc = new ImageHistoryService();
    await svc.ensureLoaded();
    svc.push(entry('A', 1));
    svc.push(entry('A', 2));
    await flushSave();
    expect(files['history.json']).toBeDefined();

    mockProjects.push('A');
    const svc2 = new ImageHistoryService();
    await svc2.ensureLoaded();
    expect(svc2.entries.length).toBe(2);
    expect(svc2.entries[0].filename).toBe('2.png');
    expect(svc2.entries[0].id).toBe('outs/A/scene1/2.png');
  });

  it('로드: 하드 삭제된 프로젝트 항목 필터 + 런타임 수집분 병합', async () => {
    mockProjects.push('살아있음');
    files['history.json'] = JSON.stringify({
      version: 1,
      entries: [
        { ...entry('살아있음', 1), createdAt: 100 },
        { ...entry('삭제됨', 2), createdAt: 200 },
      ],
    });
    const svc = new ImageHistoryService();
    // 로드 전에 런타임 수집이 먼저 도착한 상황
    svc.push(entry('살아있음', 3));
    await svc.ensureLoaded();
    const names = svc.entries.map((e) => e.filename);
    expect(names).toContain('3.png');
    expect(names).toContain('1.png');
    expect(svc.entries.some((e) => e.sessionName === '삭제됨')).toBe(false);
    // 런타임(신규)이 로드분보다 앞(최신순)
    expect(names.indexOf('3.png')).toBeLessThan(names.indexOf('1.png'));
  });

  it('로드 시 경로 재계산 — 다른 배치에서 저장된 stale path 를 현재 배치 기준으로 복구', async () => {
    mockProjects.push('A');
    files['history.json'] = JSON.stringify({
      version: 1,
      entries: [
        {
          // 신 배치(workspace)에서 저장된 경로 — 구 배치 로드 시 무효인 상황
          sessionName: 'A',
          sceneType: 'scene',
          sceneName: 'scene1',
          filename: '9.png',
          path: 'workspace/a__x1y2/outs/scene1/9.png',
          createdAt: 100,
        },
      ],
    });
    const svc = new ImageHistoryService();
    await svc.ensureLoaded();
    expect(svc.entries.length).toBe(1);
    // 현재 배치(테스트=구 배치 항등) 기준으로 재계산됨
    expect(svc.entries[0].path).toBe('outs/A/scene1/9.png');
    expect(svc.entries[0].id).toBe('outs/A/scene1/9.png');
  });

  it('파손 파일 → 빈 히스토리로 재시작, 이후 저장은 동작', async () => {
    files['history.json'] = '{{{corrupt';
    const svc = new ImageHistoryService();
    await svc.ensureLoaded();
    expect(svc.entries.length).toBe(0);
    svc.push(entry('A', 1));
    await flushSave();
    expect(JSON.parse(files['history.json']).entries.length).toBe(1);
  });
});
