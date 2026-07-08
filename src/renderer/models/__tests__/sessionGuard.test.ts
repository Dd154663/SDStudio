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

// SessionService 는 appState 를 순환 게이트(appStateRef.getAppState)로 접근한다
// → 위 AppService mock 의 appState 로 연결
jest.mock('../appStateRef', () => ({
  getAppState: () => require('../AppService').appState,
}));

// 생성자가 비동기로 createDefault → importDefaultPresets(fetch) 를 호출하는데
// jsdom 엔 fetch 가 없어 크래시한다. 기본 에셋을 빈 배열로 만들어 fetch 경로 차단.
jest.mock('../../defaultassets', () => ({ __esModule: true, default: [] }));

import { SessionService } from '../SessionService';
import { appState } from '../AppService';

const makeSvc = () => {
  const svc = new SessionService() as any;
  // 메모리에 프로젝트가 1개 로드돼 있다고 가정(checkStorageUnstable 비교 기준)
  svc.entries.set('p1', {
    state: 'ready',
    dirty: false,
    instance: { toJSON: () => ({}) },
  });
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

describe('세션 uuid 지연 발급 (트랙1 (b) B1)', () => {
  test('id 없으면 migrate 가 uuid 를 발급한다 (로드/생성 seam)', async () => {
    const svc = makeSvc();
    const out = await svc.migrate({ version: 1, presetShareds: {} });
    expect(typeof out.id).toBe('string');
    expect(out.id.length).toBeGreaterThan(0);
  });

  test('기존 id 는 보존한다 (순수 로드 경로)', async () => {
    const svc = makeSvc();
    const out = await svc.migrate({
      version: 1,
      presetShareds: {},
      id: 'keep-me',
    });
    expect(out.id).toBe('keep-me');
  });

  test('id 삭제 후 재 migrate 하면 새 uuid 가 발급된다 (복제·유래 재발급 계약)', async () => {
    const svc = makeSvc();
    const rc: any = { version: 1, presetShareds: {}, id: 'orig' };
    delete rc.id; // 복제/템플릿/임포트 경로가 하는 동작
    const out = await svc.migrate(rc);
    expect(typeof out.id).toBe('string');
    expect(out.id).not.toBe('orig');
  });
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
  test('토글 ON + 저장소 불안정 → skip-keep (보류, dirty 유지)', async () => {
    const svc = makeSvc();
    (appState as any).storageWriteGuard = true;
    backend.listFiles.mockResolvedValue([]); // projects 0개 = 불안정
    const decision = await svc.guardResourceWrite('p1', sessionJson(['a']));
    expect(decision).toBe('skip-keep');
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

describe('유실 감지: 붕괴만 차단, 찌꺼기는 허용', () => {
  // listFiles 를 경로별로 분기. outsScenes 각각에 .png 가 있다고 가정.
  const wireFs = (opts: { projects: string[]; outsScenes: string[] }) => {
    backend.listFiles.mockImplementation(async (p: string) => {
      if (p === 'projects') return opts.projects;
      if (p === 'outs/p1') return opts.outsScenes;
      if (p.startsWith('outs/p1/')) return ['001.png']; // 모든 씬 폴더에 이미지 있음
      if (p === 'inpaints/p1') return [];
      return [];
    });
  };

  test('찌꺼기(세션 정상 + 고아 1개) → 차단하지 않고 ok + 안내 토스트', async () => {
    const svc = makeSvc();
    // 세션 2개(a,b) / outs 3개(a,b,orphan) → 누락 1 ≤ present 2 = 찌꺼기
    wireFs({ projects: ['p1.json'], outsScenes: ['a', 'b', 'orphan'] });
    backend.existFile.mockResolvedValue(false);

    const decision = await svc.guardResourceWrite('p1', sessionJson(['a', 'b']));

    expect(decision).toBe('ok'); // 저장 허용(앱 사용 안 막음)
    expect(backend.copyFile).not.toHaveBeenCalled(); // 백업도 안 함
    expect(
      (appState as any).pushMessage.mock.calls.some((c: any[]) =>
        String(c[0]).includes('복구'),
      ),
    ).toBe(true); // 안내 토스트는 뜸
  });

  test('붕괴(세션 1개 + outs 다수) → skip(차단) + 백업', async () => {
    const svc = makeSvc();
    // 세션 1개(default) / outs 3개 → 누락 3 > present 1 = 붕괴
    wireFs({ projects: ['p1.json'], outsScenes: ['a', 'b', 'c'] });
    backend.existFile.mockResolvedValue(false);

    const decision = await svc.guardResourceWrite('p1', sessionJson(['default']));

    expect(decision).toBe('skip');
    // addSystemLog 는 fire-and-forget(동적 import 체인) → 대기 후 검사
    await new Promise((r) => setTimeout(r, 0));
    expect(
      addLog.mock.calls.some(
        (c) => c[0] === 'error' && String(c[2]).includes('붕괴'),
      ),
    ).toBe(true);
  });

  test('붕괴 + 현재 main 이 기존 .bak 보다 빈약하면 .bak 을 덮어쓰지 않는다', async () => {
    const svc = makeSvc();
    wireFs({ projects: ['p1.json'], outsScenes: ['a', 'b', 'c'] }); // 붕괴 유도
    backend.existFile.mockResolvedValue(true);
    backend.readFile.mockImplementation(async (p: string) => {
      if (p === 'projects/p1.json') return sessionJson(['a']); // main: 1개(빈약)
      if (p === 'projects/p1.json.bak') return sessionJson(['a', 'b', 'c']); // .bak: 3개
      return '{}';
    });

    await svc.guardResourceWrite('p1', sessionJson(['default']));

    expect(backend.copyFile).not.toHaveBeenCalled(); // .bak 보존
  });

  test('붕괴 + 현재 main 이 기존 .bak 보다 풍부하면 .bak 을 갱신한다', async () => {
    const svc = makeSvc();
    wireFs({ projects: ['p1.json'], outsScenes: ['a', 'b', 'c'] }); // 붕괴 유도
    backend.existFile.mockResolvedValue(true);
    backend.readFile.mockImplementation(async (p: string) => {
      if (p === 'projects/p1.json') return sessionJson(['a', 'b', 'c']); // main: 3개
      if (p === 'projects/p1.json.bak') return sessionJson(['a']); // .bak: 1개
      return '{}';
    });

    await svc.guardResourceWrite('p1', sessionJson(['default']));

    expect(backend.copyFile).toHaveBeenCalledWith(
      'projects/p1.json',
      'projects/p1.json.bak',
    );
  });
});
