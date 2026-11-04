// U0-b I3(2026-11-01): 구 배치 SessionService.deleteFolder 는 폴더 디렉터리를 지우기 전에
// 폴더 안 휴지통 프로젝트(<이름>.deleted)를 루트로 옮긴다(trashService.evacuateFolderTrash).
// 옮기지 못하면 deleteDir 를 부르지 않는다 — 휴지통 프로젝트가 확인 없이 영구 삭제되지 않게.
// (옮기는 동작 자체는 trashCoexist.test.ts 「U0-b I3」.)

const calls: string[] = [];
const backend = {
  listFiles: jest.fn(async (_p: string) => [] as string[]),
  existFile: jest.fn(async (_p: string) => false),
  readFile: jest.fn(async (_p: string) => '{}'),
  copyFile: jest.fn(async () => {}),
  writeFile: jest.fn(async () => {}),
  deleteDir: jest.fn(async (p: string) => {
    calls.push('deleteDir:' + p);
  }),
};
const trashService = {
  evacuateFolderTrash: jest.fn(async (f: string) => {
    calls.push('evacuate:' + f);
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

const makeSvc = () => {
  const svc = new SessionService() as any;
  svc.folderList = ['F'];
  svc.folderMap = {};
  svc.folderColors = {};
  svc.folderOrder = [];
  svc.update = jest.fn(async () => {});
  return svc;
};

beforeEach(() => {
  calls.length = 0;
  jest.clearAllMocks();
  setWorkspaceLayoutActive(false);
});

describe('U0-b I3 — 구 배치 deleteFolder 의 휴지통 프로젝트 보존', () => {
  test('휴지통 항목을 먼저 옮긴 뒤에만 폴더 디렉터리를 지운다', async () => {
    const svc = makeSvc();
    await svc.deleteFolder('F');
    expect(calls).toEqual(['evacuate:F', 'deleteDir:projects/F']);
  });

  test('옮기기에 실패하면 폴더 디렉터리를 지우지 않고 오류를 그대로 알린다', async () => {
    trashService.evacuateFolderTrash.mockImplementationOnce(async () => {
      throw new Error('휴지통에 같은 이름의 프로젝트 "A"이(가) 이미 있어 폴더를 삭제하지 않았습니다.');
    });
    const svc = makeSvc();
    await expect(svc.deleteFolder('F')).rejects.toThrow('이미 있어');
    expect(backend.deleteDir).not.toHaveBeenCalled();
    expect(templateService.removeFolder).not.toHaveBeenCalled();
  });
});
