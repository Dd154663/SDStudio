// A12(2026-11-04): 「폴더만 삭제」(SessionService.deleteFolder)는 안의 프로젝트(하위 폴더 포함)를
// 삭제 대상 폴더의 **상위 폴더**로 모은다. 루트 폴더(상위 없음)는 종전처럼 미분류(null).
// 프로젝트는 하위 폴더를 지우기 전에 한 번에 옮기고, 다른 창 잠금으로 못 옮긴 프로젝트가 있으면
// 아무 폴더도 지우지 않고 throw. 구 배치 휴지통 피신(evacuateFolderTrash)도 같은 상위 폴더로.

const calls: string[] = [];
const locked = new Set<string>();
const backend = {
  listFiles: jest.fn(async (_p: string) => [] as string[]),
  existFile: jest.fn(async (_p: string) => false),
  readFile: jest.fn(async (_p: string) => '{}'),
  copyFile: jest.fn(async () => {}),
  writeFile: jest.fn(async () => {}),
  deleteDir: jest.fn(async (p: string) => {
    calls.push('deleteDir:' + p);
  }),
  queryProjectLock: jest.fn(async (name: string) => ({
    locked: locked.has(name),
    mine: false,
  })),
  focusProjectLockOwner: jest.fn(async () => {}),
};
const trashService = {
  evacuateFolderTrash: jest.fn(async (f: string, t: string | null) => {
    calls.push(`evacuate:${f}->${t}`);
    return 0;
  }),
};
const templateService = { removeFolder: jest.fn(async () => {}) };

jest.mock('..', () => ({
  backend,
  imageService: {},
  workFlowService: {},
  zipService: {},
  sessionService: {},
  trashService,
  templateService,
  taskQueueService: { addLog: jest.fn() },
}));
jest.mock('../AppService', () => ({
  appState: { storageWriteGuard: true, pushMessage: jest.fn() },
}));
jest.mock('../appStateRef', () => ({
  getAppState: () => require('../AppService').appState,
}));
jest.mock('../../defaultassets', () => ({ __esModule: true, default: [] }));

import { SessionService } from '../SessionService';
import { setWorkspaceLayoutActive } from '../storageLayout';

const makeSvc = (
  folderList: string[],
  folderMap: Record<string, string | null>,
) => {
  const svc = new SessionService() as any;
  svc.folderList = [...folderList];
  svc.folderMap = { ...folderMap };
  svc.folderColors = {};
  svc.folderOrder = [];
  svc.update = jest.fn(async () => {});
  // 신 배치 moveToFolder 의 meta 기록만 흉내(실제 moveToFolder 의 잠금 가드·대상 폴더 검사는 그대로 지난다)
  svc.updateWorkspaceMeta = jest.fn(async () => {});
  return svc;
};

const TREE = ['A', 'A/B', 'A/B/C', 'A/B/C/D', 'X'];
const MAP: Record<string, string | null> = {
  pA: 'A',
  pB: 'A/B',
  pC: 'A/B/C',
  pD: 'A/B/C/D',
  pX: 'X',
  pRoot: null,
};

beforeEach(() => {
  calls.length = 0;
  locked.clear();
  jest.clearAllMocks();
  setWorkspaceLayoutActive(true);
});
afterAll(() => setWorkspaceLayoutActive(false));

describe('A12 — 폴더만 삭제 시 프로젝트는 상위 폴더로', () => {
  test('서브폴더 삭제 → 직속 프로젝트가 상위 폴더로', async () => {
    const svc = makeSvc(['A', 'A/B'], { p1: 'A/B', p2: 'A', p3: null });
    await svc.deleteFolder('A/B');
    expect(svc.folderMap).toEqual({ p1: 'A', p2: 'A', p3: null });
    expect(templateService.removeFolder).toHaveBeenCalledWith('A/B');
  });

  test('루트 폴더 삭제 → 미분류(종전과 같음)', async () => {
    const svc = makeSvc(['A', 'X'], { p1: 'A', pX: 'X' });
    await svc.deleteFolder('A');
    expect(svc.folderMap).toEqual({ p1: null, pX: 'X' });
  });

  test('2단 하위: A/B/C 삭제 → C 와 그 하위의 프로젝트가 A/B 로, 바깥은 그대로', async () => {
    const svc = makeSvc(TREE, MAP);
    await svc.deleteFolder('A/B/C');
    expect(svc.folderMap).toEqual({ ...MAP, pC: 'A/B', pD: 'A/B' });
    // 하위 폴더(깊은 것)부터 정리
    expect(
      templateService.removeFolder.mock.calls.map((c: any[]) => c[0]),
    ).toEqual(['A/B/C/D', 'A/B/C']);
    // 각 프로젝트는 한 번만 옮긴다(중간 폴더를 거치지 않음)
    expect(svc.updateWorkspaceMeta).toHaveBeenCalledTimes(2);
    expect(svc.updateWorkspaceMeta).toHaveBeenCalledWith('pC', { folder: 'A/B' });
    expect(svc.updateWorkspaceMeta).toHaveBeenCalledWith('pD', { folder: 'A/B' });
  });

  test('A 삭제 → 하위 전부의 프로젝트가 미분류로', async () => {
    const svc = makeSvc(TREE, MAP);
    await svc.deleteFolder('A');
    expect(svc.folderMap).toEqual({
      pA: null,
      pB: null,
      pC: null,
      pD: null,
      pX: 'X',
      pRoot: null,
    });
  });

  test('다른 창 잠금으로 못 옮긴 프로젝트가 있으면 throw·어떤 폴더도 지우지 않음', async () => {
    const svc = makeSvc(TREE, MAP);
    locked.add('pD');
    await expect(svc.deleteFolder('A/B/C')).rejects.toThrow(
      '상위 폴더 "B"로 옮기지 못한 프로젝트가 있어 폴더를 삭제하지 않았습니다',
    );
    expect(svc.folderMap.pD).toBe('A/B/C/D');
    expect(templateService.removeFolder).not.toHaveBeenCalled();
  });

  test('루트 폴더에서 못 옮기면 「미분류로 옮기지 못한」 문구', async () => {
    const svc = makeSvc(['A'], { p1: 'A' });
    locked.add('p1');
    await expect(svc.deleteFolder('A')).rejects.toThrow(
      '미분류로 옮기지 못한 프로젝트',
    );
    expect(templateService.removeFolder).not.toHaveBeenCalled();
  });

  test('상위 폴더가 목록에 없으면 미분류로 폴백', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const svc = makeSvc(['A/B'], { p1: 'A/B' });
    expect(svc.folderDeleteTarget('A/B')).toBeNull();
    await svc.deleteFolder('A/B');
    expect(svc.folderMap.p1).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test('folderDeleteTarget: 서브폴더=상위, 루트 폴더=null', () => {
    const svc = makeSvc(TREE, {});
    expect(svc.folderDeleteTarget('A/B/C')).toBe('A/B');
    expect(svc.folderDeleteTarget('A/B')).toBe('A');
    expect(svc.folderDeleteTarget('A')).toBeNull();
  });
});

describe('A12 — 구 배치 휴지통 피신 대상도 상위 폴더', () => {
  beforeEach(() => setWorkspaceLayoutActive(false));

  const stubMove = (svc: any) => {
    svc.moveToFolder = jest.fn(async (name: string, t: string | null) => {
      svc.folderMap[name] = t;
    });
  };

  test('A/B/C 삭제 → 하위 폴더까지 모두 A/B 로 피신 후 디렉터리 제거', async () => {
    const svc = makeSvc(TREE, MAP);
    stubMove(svc);
    await svc.deleteFolder('A/B/C');
    expect(svc.moveToFolder).toHaveBeenCalledTimes(2);
    expect(calls).toEqual([
      'evacuate:A/B/C/D->A/B',
      'deleteDir:projects/A/B/C/D',
      'evacuate:A/B/C->A/B',
      'deleteDir:projects/A/B/C',
    ]);
  });

  test('루트 폴더 삭제 → 루트(null)로 피신', async () => {
    const svc = makeSvc(['A', 'A/B'], {});
    stubMove(svc);
    await svc.deleteFolder('A');
    expect(calls).toEqual([
      'evacuate:A/B->null',
      'deleteDir:projects/A/B',
      'evacuate:A->null',
      'deleteDir:projects/A',
    ]);
  });
});
