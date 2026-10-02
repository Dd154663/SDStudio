// SessionService.importSessionDeepFromDir 동명 거부(2026-10-02 S4):
// 목록에 이미 있는 이름(미로드 포함)으로 호출되면 어떤 파일도 건드리기 전에 throw 한다.
// (그대로 진행하면 신 배치는 살아 있는 프로젝트 폴더에 병합되고, 복사 실패 롤백이 그 폴더를 지울 수 있었다.)

const backend = {
  listFiles: jest.fn(async (_p: string) => [] as string[]),
  listFilesWithStats: jest.fn(async (_p: string) => [] as any[]),
  existFile: jest.fn(async (_p: string) => false),
  readFile: jest.fn(async (_p: string) => '{}'),
  copyFile: jest.fn(async () => {}),
  writeFile: jest.fn(async () => {}),
  writeDataFile: jest.fn(async () => {}),
  deleteDir: jest.fn(async () => {}),
  deleteFile: jest.fn(async () => {}),
  renameFile: jest.fn(async () => {}),
  renameDir: jest.fn(async () => {}),
};

jest.mock('..', () => ({
  backend,
  imageService: {},
  workFlowService: {},
  zipService: {},
  sessionService: {},
  taskQueueService: { addLog: jest.fn() },
}));

jest.mock('../AppService', () => ({
  appState: { storageWriteGuard: true, pushMessage: jest.fn() },
}));

jest.mock('../appStateRef', () => ({
  getAppState: () => require('../AppService').appState,
}));

// 생성자의 기본 프리셋 fetch 차단(sessionGuard.test.ts 와 같은 관례)
jest.mock('../../defaultassets', () => ({ __esModule: true, default: [] }));

import { SessionService } from '../SessionService';

const touched = () =>
  Object.entries(backend)
    .filter(([, fn]) => fn.mock.calls.length > 0)
    .map(([k]) => k);

beforeEach(() => {
  for (const fn of Object.values(backend)) fn.mockClear();
});

// 생성자가 띄운 비동기 작업(기본 템플릿 준비 등)이 끝난 뒤에 호출 기록을 비운다
const settle = async () => {
  await new Promise((r) => setTimeout(r, 0));
  for (const fn of Object.values(backend)) fn.mockClear();
};

describe('importSessionDeepFromDir 동명 거부', () => {
  test('미로드지만 목록에 있는 이름 → 파일을 하나도 건드리지 않고 throw', async () => {
    const svc = new SessionService() as any;
    svc.resourceList = ['기존', '다른'];
    expect(svc.isLoaded('기존')).toBe(false);
    await settle();
    await expect(
      svc.importSessionDeepFromDir('tmp/x', '기존'),
    ).rejects.toThrow('이미 같은 이름의 프로젝트가 있습니다');
    expect(touched()).toEqual([]);
  });

  test('로드된 이름 → 기존과 같이 거부', async () => {
    const svc = new SessionService() as any;
    svc.entries.set('열림', {
      state: 'ready',
      dirty: false,
      instance: { toJSON: () => ({}) },
    });
    await settle();
    await expect(svc.importSessionDeepFromDir('tmp/x', '열림')).rejects.toThrow(
      'Resource already exists',
    );
    expect(touched()).toEqual([]);
  });

  test('목록에 없는 이름은 막지 않는다(백업 project.json 읽기로 진행)', async () => {
    const svc = new SessionService() as any;
    svc.resourceList = ['기존'];
    await settle();
    backend.readFile.mockRejectedValueOnce(new Error('읽기 중단(테스트)'));
    await expect(svc.importSessionDeepFromDir('tmp/x', '새것')).rejects.toThrow(
      '읽기 중단(테스트)',
    );
    expect(backend.readFile).toHaveBeenCalledWith('tmp/x/project.json');
  });
});
