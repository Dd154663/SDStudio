// 전체·폴더 백업 「만들기」 흐름(2026-11-22 P1·P3·3-7) — 메모리 목, 실제 데이터 폴더 무접촉.
//  - 완료 창은 publishExport 가 끝난 뒤에(옮기기 실패를 완료 뒤에 묻지 않음)
//  - 옮기기 실패: backend 가 이미 알린 오류는 다시 알리지 않고, 그 밖의 오류는 알림
//  - 읽지 못한 프로젝트·이미지 폴더 목록 오류를 완료 창에 적음
//  - 담기 전 flush = 저장 대기(dirty) + 열린 프로젝트만, 담기(zip)보다 먼저

const order: string[] = [];
const mockBackend = {
  writeFile: jest.fn(async () => {}),
  existFile: jest.fn(async () => false),
  listFilesWithStats: jest.fn(async () => []),
  publishExport: jest.fn(async () => {
    order.push('publish');
  }),
};
const mockSessions: Record<string, any> = {};
const mockSession = {
  list: jest.fn(() => Object.keys(mockSessions).concat(['깨짐'])),
  listFolders: () => [],
  getFolderColor: () => null,
  getOrderedFolders: () => [],
  getFolderOf: () => null,
  getProjectsInFolder: jest.fn(() => ['A', 'B', '깨짐']),
  get: jest.fn(async (name: string) => {
    if (name === '깨짐') throw new Error('JSON 손상');
    return mockSessions[name];
  }),
  buildSessionDeepEntries: jest.fn(
    async (s: any, prefix: string, opts?: { onListError?: (k: string, e: unknown) => void }) => {
      if (s.failKind) opts?.onListError?.(s.failKind, new Error('EACCES'));
      return [{ path: 'p/' + s.name, name: prefix + 'project.json' }];
    },
  ),
  dirtyNames: jest.fn(() => ['B', '없는것']),
  isLoaded: jest.fn(() => true),
  flushProjectNow: jest.fn(async (n: string) => {
    order.push('flush:' + n);
  }),
};
const mockZipFiles = jest.fn(async () => {
  order.push('zip');
});

jest.mock('..', () => ({
  backend: mockBackend,
  sessionService: mockSession,
  imageService: {},
  workFlowService: {},
  trashService: {},
  globalPresetService: { loadFailed: true, list: () => [] },
  globalCharacterPresetService: { loadFailed: true, presets: [] },
  globalPieceService: { loadFailed: true, library: new Map() },
  zipService: { zipFiles: (...a: any[]) => (mockZipFiles as any)(...a), isZipping: false },
  templateService: {},
  projectTemplateService: {},
  projectSizeService: { estimateFullBackupBytes: async () => 0 },
  flushGlobalStoresNow: async () => {},
}));
jest.mock('../PersistenceService', () => ({ persistService: { write: jest.fn() } }));
const mockState: any = {};
jest.mock('../AppService', () => ({ appState: mockState }));
jest.mock('../appStateRef', () => ({ getAppState: () => mockState }));
jest.mock('../platform', () => ({ platform: {} }));
jest.mock('../../backend', () => ({ ImageOptimizeMethod: {} }));
jest.mock('../ImageService', () => ({ dataUriToBase64: (s: string) => s, deleteImageFiles: async () => {} }));
jest.mock('../SessionService', () => ({}));
jest.mock('../types', () => ({
  VibeItem: { fromJSON: (j: any) => j },
  ReferenceItem: { fromJSON: (j: any) => j },
  CharacterPreset: { fromJSON: (j: any) => j },
  Session: class {},
  genericSceneFromJSON: (j: any) => j,
}));
jest.mock('../util', () => ({}));
jest.mock('../legacy', () => ({}));
jest.mock('../workflows/OneTimeFlows', () => ({}));
jest.mock('../GlobalPresetService', () => ({}));
jest.mock('../../componenets/ConfirmWindow', () => ({}));
jest.mock('../../componenets/ProgressWindow', () => ({}));
jest.mock('../../backends/imageGen', () => ({}));
jest.mock('../driveSync', () => ({}));
jest.mock('../driveImport', () => ({}));
jest.mock('../importFlow', () => ({}));
jest.mock('../nameInput', () => ({}));
jest.mock('../projectOverwrite', () => ({}));
jest.mock('../projectPaths', () => ({}));
jest.mock('../folderDeleteFlow', () => ({}));
jest.mock('../projectDeleteFlow', () => ({}));
jest.mock('../projectDeleteUndo', () => ({}));
jest.mock('../presetUndo', () => ({}));
jest.mock('../projectFolderUndo', () => ({}));
jest.mock('../undoService', () => ({}));
jest.mock('../imageFormats', () => ({ imageExtFromBase64: () => 'png' }));

import { BackupService } from '../BackupService';
import { BACKUP_EXPORT_TEXT } from '../backupExportSummary';
import { ExportTransferError } from '../../backends/verifiedExportCopy';

let backup: BackupService;
const dialogTexts = () => mockState.pushDialog.mock.calls.map((c: any[]) => c[0].text as string);

beforeEach(() => {
  jest.clearAllMocks();
  order.length = 0;
  for (const k of Object.keys(mockSessions)) delete mockSessions[k];
  mockSessions.A = { name: 'A' };
  mockSessions.B = { name: 'B', failKind: 'vibes' };
  Object.assign(mockState, {
    setProgressDialog: jest.fn(),
    pushDialog: jest.fn((d: any) => order.push('dialog')),
    pushMessage: jest.fn(),
    confirmAsync: jest.fn(async () => true),
    curSession: { name: 'A' },
  });
  backup = new BackupService();
});

describe('전체 백업 만들기', () => {
  test('flush(dirty+열린 것) → zip → publish → 완료 창, 빠진 것·받지 않는 것 줄', async () => {
    await backup.fullBackupExport('noimg');
    expect(order).toEqual(['flush:B', 'flush:A', 'zip', 'publish', 'dialog']);
    expect(mockSession.flushProjectNow).not.toHaveBeenCalledWith('없는것');
    const t = dialogTexts().at(-1)!;
    expect(t.split('\n')).toEqual([
      '전체 백업이 완료되었습니다. (2개 프로젝트, 이미지 제외)',
      '1개 프로젝트는 읽지 못해 빠졌습니다: 깨짐',
      '1개 프로젝트는 이미지 폴더를 읽지 못해 일부 이미지가 빠졌을 수 있습니다: B',
      BACKUP_EXPORT_TEXT.notIncluded,
    ]);
    // 매니페스트 projects 는 들어간 것만(형식 불변)
    const entries = (mockZipFiles.mock.calls[0] as any[])[0] as { name: string }[];
    expect(entries.map((e) => e.name)).toContain('_backup.json');
  });

  test('이미지 제외 모드는 outs/inpaints 목록 오류를 세지 않음', async () => {
    mockSessions.B.failKind = 'outs';
    await backup.fullBackupExport('noimg');
    expect(dialogTexts().at(-1)).not.toContain('이미지 폴더를 읽지 못해');
  });

  test('flush 실패는 담기를 막지 않음', async () => {
    mockSession.flushProjectNow.mockRejectedValueOnce(new Error('불안정'));
    await backup.fullBackupExport('noimg');
    expect(mockZipFiles).toHaveBeenCalled();
    expect(order).toContain('publish');
  });

  test('backend 가 이미 알린 옮기기 실패 = 완료 창·추가 안내 없음', async () => {
    const err = new ExportTransferError('size-mismatch', '못 옮김');
    err.notified = true;
    mockBackend.publishExport.mockRejectedValueOnce(err);
    await backup.fullBackupExport('noimg');
    expect(mockBackend.publishExport).toHaveBeenCalledTimes(1);
    expect(mockState.pushDialog).not.toHaveBeenCalled();
  });

  test('알리지 않은 옮기기 오류 = 사유를 알림(삼키지 않음), 완료 창 없음', async () => {
    mockBackend.publishExport.mockRejectedValueOnce(new Error('EXDEV 복사 실패'));
    await backup.fullBackupExport('noimg');
    expect(mockBackend.publishExport).toHaveBeenCalledTimes(1);
    expect(dialogTexts()).toEqual([BACKUP_EXPORT_TEXT.moveFailed('EXDEV 복사 실패')]);
  });
});

describe('폴더 백업 만들기', () => {
  test('읽지 못한 프로젝트를 알리고, 완료 창은 publish 뒤', async () => {
    await backup.folderBackupExport('F');
    expect(order.slice(-3)).toEqual(['zip', 'publish', 'dialog']);
    expect(dialogTexts().at(-1)!.split('\n')).toEqual([
      '폴더 "F" 백업이 완료되었습니다. (2개 프로젝트)',
      '1개 프로젝트는 읽지 못해 빠졌습니다: 깨짐',
      '1개 프로젝트는 이미지 폴더를 읽지 못해 일부 이미지가 빠졌을 수 있습니다: B',
    ]);
  });
});
