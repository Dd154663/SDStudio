// 프로젝트 백업 메뉴 분할(2026-11-19 사용자 결정) — BackupService.projectImportMenu / projectExportMenu.
// 종전 projectBackupMenu 한 창(8개)을 불러오기 3개·내보내기 2개 창으로 나눴고, 복제·이름 수정·즐겨찾기는 뺐다
// (프로젝트 서랍이 같은 일을 한다). 항목 문구·값·동작은 종전 그대로 옮겼다.
const mockState: any = {
  pushDialog: jest.fn(),
  pushMessage: jest.fn(),
  handleFile: jest.fn(),
  setProgressDialog: jest.fn(),
  curSession: undefined,
};
const mockBackend = {
  writeFile: jest.fn(async (_p: string, _d: string) => {}),
  publishExport: jest.fn(async (_p: string) => {}),
  selectFile: jest.fn(async (_o?: any) => undefined as string | undefined),
};
const mockSessionService = {
  exportSessionShallow: jest.fn(async (_s: any) => ({ name: 'p' })),
  exportSessionDeep: jest.fn(async (_s: any, _p: string) => {}),
};
const mockFile = { name: 'x.json' };

jest.mock('..', () => ({
  backend: mockBackend,
  sessionService: mockSessionService,
  zipService: { isZipping: false },
}));
jest.mock('../AppService', () => ({ appState: mockState }));
jest.mock('../platform', () => ({ platform: {} }));
jest.mock('../../backend', () => ({}));
jest.mock('../PersistenceService', () => ({ persistService: { write: jest.fn() } }));
jest.mock('../ImageService', () => ({}));
jest.mock('../SessionService', () => ({}));
jest.mock('../types', () => ({}));
jest.mock('../util', () => ({ getFirstFile: jest.fn(async () => mockFile) }));
jest.mock('../legacy', () => ({}));
jest.mock('../workflows/OneTimeFlows', () => ({}));
jest.mock('../GlobalPresetService', () => ({}));
jest.mock('../../componenets/ConfirmWindow', () => ({}));
jest.mock('../../componenets/ProgressWindow', () => ({}));
jest.mock('../../backends/imageGen', () => ({}));
jest.mock('../driveSync', () => ({
  chooseImportSource: jest.fn(async () => 'file'),
  deliverExport: jest.fn(async () => {}),
  getSyncFolder: jest.fn(async () => undefined),
}));
jest.mock('../driveImport', () => ({ importFromDrive: jest.fn(async () => {}) }));
jest.mock('../importFlow', () => ({}));
jest.mock('../nameInput', () => ({}));
jest.mock('../projectOverwrite', () => ({
  projectBackupFileName: (name: string) => `sdstudio-project-${name}.tar`,
}));
jest.mock('../projectPaths', () => ({}));
jest.mock('../folderDeleteFlow', () => ({}));
jest.mock('../projectDeleteFlow', () => ({}));
jest.mock('../projectDeleteUndo', () => ({}));
jest.mock('../fullBackupOverwrite', () => ({}));
jest.mock('../projectTemplateBackup', () => ({}));
jest.mock('../presetUndo', () => ({}));
jest.mock('../projectFolderUndo', () => ({}));
jest.mock('../undoService', () => ({}));

import { BackupService } from '../BackupService';

const lastDialog = () => mockState.pushDialog.mock.calls.at(-1)[0];

beforeEach(() => {
  jest.clearAllMocks();
  mockState.curSession = undefined;
});

describe('불러오기 메뉴', () => {
  test('제목과 항목 3개(파일·프로젝트 백업·폴더 백업)', () => {
    new BackupService().projectImportMenu();
    const d = lastDialog();
    expect(d.type).toBe('select');
    expect(d.text).toBe('불러올 것을 선택해주세요');
    expect(d.items).toEqual([
      { text: '파일 불러오기', value: 'load' },
      { text: '프로젝트 백업 불러오기', value: 'loadDeep' },
      { text: '📦 폴더 백업 불러오기', value: 'loadFolder' },
    ]);
  });

  test('각 항목은 종전 동작으로 이어진다', async () => {
    const svc = new BackupService();
    const folder = jest.spyOn(svc, 'folderBackupImport').mockResolvedValue(undefined);
    const tar = jest.spyOn(svc, 'handleTarImport').mockResolvedValue(undefined);
    svc.projectImportMenu();
    const cb = lastDialog().callback;
    await cb('load');
    expect(mockState.handleFile).toHaveBeenCalledWith(mockFile);
    await cb('loadFolder');
    expect(folder).toHaveBeenCalledTimes(1);
    mockBackend.selectFile.mockResolvedValueOnce('/a/b.tar');
    await cb('loadDeep');
    expect(mockBackend.selectFile).toHaveBeenCalledWith({
      filters: [{ name: '프로젝트 백업', extensions: ['tar'] }],
    });
    expect(tar).toHaveBeenCalledWith('/a/b.tar');
  });
});

describe('내보내기 메뉴', () => {
  test('제목과 항목 2개(이미지 미포함·포함)', () => {
    new BackupService().projectExportMenu();
    const d = lastDialog();
    expect(d.type).toBe('select');
    expect(d.text).toBe('내보낼 것을 선택해주세요');
    expect(d.items).toEqual([
      { text: '프로젝트 파일 내보내기 (이미지 미포함)', value: 'save' },
      { text: '프로젝트 백업 내보내기 (이미지 포함)', value: 'saveDeep' },
    ]);
  });

  test('이미지 미포함은 종전 경로(exports/<이름>.json)로 쓰고, 빠진 항목 값은 아무것도 하지 않는다', async () => {
    mockState.curSession = { name: 'p' };
    new BackupService().projectExportMenu();
    const cb = lastDialog().callback;
    await cb('save');
    expect(mockBackend.writeFile).toHaveBeenCalledWith('exports/p.json', expect.any(String));
    expect(mockBackend.publishExport).toHaveBeenCalledWith('exports/p.json');
    jest.clearAllMocks();
    for (const gone of ['duplicate', 'rename', 'toggleFavorite', 'load', 'loadDeep']) await cb(gone);
    expect(mockState.pushDialog).not.toHaveBeenCalled();
    expect(mockBackend.selectFile).not.toHaveBeenCalled();
    expect(mockBackend.writeFile).not.toHaveBeenCalled();
  });

  test('옛 통합 메뉴 이름은 남아 있지 않다', () => {
    expect((new BackupService() as any).projectBackupMenu).toBeUndefined();
  });
});
