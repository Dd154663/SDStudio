// SessionService 손실 방지 가드 테스트:
//  - 서킷 브레이커(저장소 불안정 시 skip, 토글 OFF 시 통과)
//  - 백업(.bak) 클로버 방지(현재 main 이 .bak 보다 빈약하면 덮어쓰지 않음)
//  - 유실 감지(outs 에 이미지 있는데 세션에 없는 씬 → skip)
//  - countResourceScenes / checkStorageUnstable 판정

const backend = {
  listFiles: jest.fn(async (_p: string) => [] as string[]),
  existFile: jest.fn(async (_p: string) => false),
  readFile: jest.fn(async (_p: string) => '{}'),
  copyFile: jest.fn(async () => {}),
  writeFile: jest.fn(async () => {}),
};
const addLog = jest.fn();

jest.mock('..', () => ({
  backend,
  imageService: {},
  workFlowService: {},
  zipService: {},
  sessionService: {},
  taskQueueService: { addLog },
}));

jest.mock('../AppService', () => ({
  appState: { storageWriteGuard: true, pushMessage: jest.fn() },
}));

// 생성자가 비동기로 createDefault → importDefaultPresets(fetch) 를 호출하는데
// jsdom 엔 fetch 가 없어 크래시한다. 기본 에셋을 빈 배열로 만들어 fetch 경로 차단.
jest.mock('../../defaultassets', () => ({ __esModule: true, default: [] }));

import { SessionService } from '../SessionService';
import { appState } from '../AppService';

const makeSvc = () => {
  const svc = new SessionService() as any;
  // 메모리에 프로젝트가 1개 로드돼 있다고 가정(checkStorageUnstable 비교 기준)
  svc.resources['p1'] = { toJSON: () => ({}) };
  return svc;
};

const sessionJson = (scenes: string[]) =>
  JSON.stringify({
    scenes: Object.fromEntries(scenes.map((s) => [s, {}])),
    inpaints: {},
  });

beforeEach(() => {
  backend.listFiles.mockReset();
  backend.existFile.mockReset();
  backend.readFile.mockReset();
  backend.copyFile.mockReset();
  backend.writeFile.mockReset();
  addLog.mockReset();
  (appState as any).storageWriteGuard = true;
});

describe('countResourceScenes', () => {
  test('씬+인페인트 개수를 합산, 손상 JSON 은 -1', () => {
    const svc = makeSvc();
    expect(svc.countResourceScenes(sessionJson(['a', 'b']))).toBe(2);
    expect(
      svc.countResourceScenes(
        JSON.stringify({ scenes: { a: {} }, inpaints: { x: {} } }),
      ),
    ).toBe(2);
    expect(svc.countResourceScenes('not json')).toBe(-1);
  });
});

describe('checkStorageUnstable', () => {
  test('메모리에 리소스 없으면 항상 안정으로 본다', async () => {
    const svc = new SessionService() as any; // resources 비어 있음
    expect(await svc.checkStorageUnstable()).toBe(false);
  });

  test('projects 목록을 못 읽으면(throw) 불안정', async () => {
    const svc = makeSvc();
    backend.listFiles.mockRejectedValueOnce(new Error('EACCES'));
    expect(await svc.checkStorageUnstable()).toBe(true);
  });

  test('메모리엔 프로젝트가 있는데 projects 목록이 0개면 불안정', async () => {
    const svc = makeSvc();
    backend.listFiles.mockResolvedValueOnce([]);
    expect(await svc.checkStorageUnstable()).toBe(true);
  });

  test('projects 목록이 정상(비어있지 않음)이면 안정', async () => {
    const svc = makeSvc();
    backend.listFiles.mockResolvedValueOnce(['p1.json']);
    expect(await svc.checkStorageUnstable()).toBe(false);
  });
});

describe('서킷 브레이커', () => {
  test('토글 ON + 저장소 불안정 → skip (파싱 전에 차단)', async () => {
    const svc = makeSvc();
    (appState as any).storageWriteGuard = true;
    backend.listFiles.mockResolvedValue([]); // projects 0개 = 불안정
    const decision = await svc.guardResourceWrite('p1', sessionJson(['a']));
    expect(decision).toBe('skip');
  });

  test('토글 OFF → 불안정해도 서킷 브레이커는 통과한다', async () => {
    const svc = makeSvc();
    (appState as any).storageWriteGuard = false;
    // outs/inpaints 비교에서 누락 없음 → 'ok'
    backend.listFiles.mockResolvedValue([]); // 모든 listFiles 0개(누락 없음)
    const decision = await svc.guardResourceWrite('p1', sessionJson(['a']));
    expect(decision).toBe('ok');
  });
});

describe('유실 감지 + 백업 클로버 방지', () => {
  // listFiles 를 경로별로 분기
  const wireFs = (opts: {
    projects: string[];
    outsScenes: string[];
    pngScenes: string[]; // .png 가 있는 씬 폴더 이름
  }) => {
    backend.listFiles.mockImplementation(async (p: string) => {
      if (p === 'projects') return opts.projects;
      if (p === 'outs/p1') return opts.outsScenes;
      if (p.startsWith('outs/p1/')) {
        const scene = p.substring('outs/p1/'.length);
        return opts.pngScenes.includes(scene) ? ['001.png'] : [];
      }
      if (p === 'inpaints/p1') return [];
      return [];
    });
  };

  test('outs 에 이미지 있는 씬이 세션에 없으면 skip(유실 차단) + 에러 로그', async () => {
    const svc = makeSvc();
    wireFs({ projects: ['p1.json'], outsScenes: ['sceneA'], pngScenes: ['sceneA'] });
    backend.existFile.mockResolvedValue(false); // .bak/main 없음(백업 단계 단순화)

    // 세션엔 sceneA 가 없음 → 유실 의심
    const decision = await svc.guardResourceWrite('p1', sessionJson(['other']));

    expect(decision).toBe('skip');
    expect(
      addLog.mock.calls.some(
        (c) => c[0] === 'error' && String(c[2]).includes('유실'),
      ),
    ).toBe(true);
  });

  test('현재 main 이 기존 .bak 보다 빈약하면 .bak 을 덮어쓰지 않는다', async () => {
    const svc = makeSvc();
    wireFs({ projects: ['p1.json'], outsScenes: ['sceneA'], pngScenes: ['sceneA'] });
    backend.existFile.mockResolvedValue(true); // main, .bak 모두 존재
    backend.readFile.mockImplementation(async (p: string) => {
      if (p === 'projects/p1.json') return sessionJson(['a']); // main: 1개(빈약)
      if (p === 'projects/p1.json.bak') return sessionJson(['a', 'b', 'c']); // .bak: 3개(풍부)
      return '{}';
    });

    await svc.guardResourceWrite('p1', sessionJson(['other']));

    expect(backend.copyFile).not.toHaveBeenCalled(); // .bak 보존
    expect(
      addLog.mock.calls.some((c) => String(c[2]).includes('백업')),
    ).toBe(true);
  });

  test('현재 main 이 기존 .bak 보다 풍부하면 .bak 을 갱신한다', async () => {
    const svc = makeSvc();
    wireFs({ projects: ['p1.json'], outsScenes: ['sceneA'], pngScenes: ['sceneA'] });
    backend.existFile.mockResolvedValue(true);
    backend.readFile.mockImplementation(async (p: string) => {
      if (p === 'projects/p1.json') return sessionJson(['a', 'b', 'c']); // main: 3개
      if (p === 'projects/p1.json.bak') return sessionJson(['a']); // .bak: 1개
      return '{}';
    });

    await svc.guardResourceWrite('p1', sessionJson(['other']));

    expect(backend.copyFile).toHaveBeenCalledWith(
      'projects/p1.json',
      'projects/p1.json.bak',
    );
  });
});
