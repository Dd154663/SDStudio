// 백업 불러오기 견고화(2026-11-22 — 조사 guides/plans/2026-11-22-backup-robustness-survey.md P4·P5·P6·P8, 3-2·3-6):
//  A. 종류 판정(backupKind.detectBackupKind) — 전체·폴더·프로젝트·한 겹 감싼 것·두 겹은 안 벗김·알 수 없음, 경로별 계획·확장자
//  B. 경로별로 같은 기존 흐름으로 넘어가는지(한 번만 풀기·안내 한 줄·version 초과·임시 폴더 정리)
//  C. 전체 백업 복원 결과 — 가져오지 못한 이름·덮어쓰려다 실패·글로벌 라이브러리 받음/받지 않음·새 이름 표시 안내
//  D. 결과 문구(fullBackupResultText) 순수
// 메모리 backend 목 — 실제 사용자 데이터 폴더는 건드리지 않는다.

const files = new Map<string, string>();
// unzipFiles 가 「풀어 놓을」 내용: tar 경로 → (상대 경로 → 내용). 없으면 풀기 실패.
const archives = new Map<string, Record<string, string>>();

const under = (dir: string) => Array.from(files.keys()).filter((k) => k.startsWith(dir + '/'));

const mockBackend = {
  unzipFiles: jest.fn(async (tarPath: string, out: string) => {
    const a = archives.get(tarPath);
    if (!a) {
      files.set(out + '/half-extracted', 'x'); // 풀다 만 잔재
      throw new Error('Invalid tar header: unknown format.');
    }
    for (const [rel, data] of Object.entries(a)) files.set(out + '/' + rel, data);
  }),
  readFile: jest.fn(async (p: string) => {
    if (!files.has(p)) throw new Error('ENOENT ' + p);
    return files.get(p)!;
  }),
  existFile: jest.fn(async (p: string) => files.has(p)),
  listFiles: jest.fn(async (dir: string) =>
    Array.from(new Set(under(dir).map((k) => k.slice(dir.length + 1).split('/')[0]))),
  ),
  listFilesWithStats: jest.fn(async (dir: string) =>
    under(dir)
      .filter((k) => !k.slice(dir.length + 1).includes('/'))
      .map((k) => ({ name: k.slice(dir.length + 1), size: 1, mtime: 0 })),
  ),
  copyFile: jest.fn(async (a: string, b: string) => {
    if (!files.has(a)) throw new Error('ENOENT ' + a);
    files.set(b, files.get(a)!);
  }),
  writeFile: jest.fn(async (p: string, d: string) => {
    files.set(p, d);
  }),
  deleteDir: jest.fn(async (dir: string) => {
    for (const k of under(dir)) files.delete(k);
  }),
  selectFile: jest.fn(async (): Promise<string | undefined> => undefined),
};

const mockProjects: string[] = [];
const mockFolders: string[] = [];
const importFails = new Set<string>(); // 이 「최종 이름」 가져오기는 실패
const mockSession = {
  list: () => [...mockProjects],
  listFolders: () => [...mockFolders],
  createFolder: jest.fn(async (f: string) => {
    if (!mockFolders.includes(f)) mockFolders.push(f);
  }),
  setFolderColor: jest.fn(async () => {}),
  setFolderOrder: jest.fn(async () => {}),
  getFolderColor: () => null,
  moveToFolder: jest.fn(async () => {}),
  importSessionDeepFromDir: jest.fn(async (_dir: string, name: string) => {
    if (mockProjects.includes(name)) throw new Error('이미 있음');
    if (importFails.has(name)) throw new Error('project.json 깨짐');
    mockProjects.push(name);
  }),
  favorites: new Set<string>(),
  saveFavorites: jest.fn(async () => {}),
  getThumbnailRef: () => undefined,
  setThumbnailRef: jest.fn(),
  getSceneBookmark: () => undefined,
  toggleSceneBookmark: jest.fn(async () => {}),
  getImageBookmark: () => undefined,
  toggleImageBookmark: jest.fn(async () => {}),
};
const mockGlobals = {
  presets: [] as any[],
  pieces: new Map<string, any>(),
  chars: [] as any[],
  presetsLoadFailed: false,
};
const mockPresetLoad = jest.fn(async () => {});

jest.mock('..', () => ({
  backend: mockBackend,
  sessionService: mockSession,
  imageService: {},
  workFlowService: {},
  trashService: { permanentlyDeleteProject: jest.fn(async () => {}) },
  globalPresetService: {
    get loadFailed() {
      return mockGlobals.presetsLoadFailed;
    },
    list: () => mockGlobals.presets,
    load: () => mockPresetLoad(),
  },
  globalCharacterPresetService: {
    loadFailed: false,
    get presets() {
      return mockGlobals.chars;
    },
    load: jest.fn(async () => {}),
  },
  globalPieceService: {
    loadFailed: false,
    get library() {
      return mockGlobals.pieces;
    },
    load: jest.fn(async () => {}),
  },
  zipService: { isZipping: false },
  templateService: {
    designationOf: jest.fn(async () => null),
    restoreFromFullBackup: jest.fn(async () => ({ kind: 'none' })),
  },
  projectTemplateService: {
    adoptFromFullBackupIfEmpty: jest.fn(async () => ({ kind: 'none' })),
  },
  flushGlobalStoresNow: async () => {},
}));
const mockState: any = {};
jest.mock('../AppService', () => ({ appState: mockState }));
jest.mock('../appStateRef', () => ({ getAppState: () => mockState }));
jest.mock('../platform', () => ({ platform: {} }));
jest.mock('../../backend', () => ({ ImageOptimizeMethod: {} }));
jest.mock('../ImageService', () => ({ dataUriToBase64: (s: string) => s, deleteImageFiles: async () => {} }));
jest.mock('../SessionService', () => ({}));
jest.mock('../types', () => ({}));
jest.mock('../util', () => ({}));
jest.mock('../legacy', () => ({}));
jest.mock('../workflows/OneTimeFlows', () => ({}));
jest.mock('../GlobalPresetService', () => ({}));
jest.mock('../TemplateService', () => ({ TEMPLATES_SIDECAR_FILE: 'templates.json' }));
jest.mock('../ProjectTemplateService', () => ({
  PROJECT_TEMPLATES_FILE: 'project_templates.json',
  PROJECT_TEMPLATE_IMAGES_DIR: 'project_template_images',
}));
jest.mock('../../componenets/ConfirmWindow', () => ({}));
jest.mock('../../componenets/ProgressWindow', () => ({}));
jest.mock('../../backends/imageGen', () => ({}));
jest.mock('../driveSync', () => ({}));
jest.mock('../driveImport', () => ({}));
jest.mock('../importFlow', () => ({ IMPORT_FLOW_TEXT: { protection: {} } }));
jest.mock('../nameInput', () => ({
  promptName: jest.fn(async () => '받은 이름'),
  projectNameRules: () => ({}),
  nameErrorMessage: (e: any) => String(e?.message ?? e),
}));
jest.mock('../projectOverwrite', () => ({ fileStemOf: () => 'stem' }));
jest.mock('../projectPaths', () => ({ PROJECT_IMAGE_ROOTS: [] }));
jest.mock('../folderDeleteFlow', () => ({}));
jest.mock('../projectDeleteFlow', () => ({
  deleteProjectForReplaceFlow: async (name: string) => {
    const i = mockProjects.indexOf(name);
    if (i >= 0) mockProjects.splice(i, 1);
  },
  deleteProjectForFolderFlow: async () => {},
}));
jest.mock('../projectDeleteUndo', () => ({}));
jest.mock('../presetUndo', () => ({}));
jest.mock('../undoService', () => ({}));
jest.mock('../projectTemplateBackup', () => ({}));
jest.mock('../imageFormats', () => ({ imageExtFromBase64: () => 'png' }));

import {
  BACKUP_IMPORT_TEXT,
  detectBackupKind,
  isTarFileName,
  planBackupRoute,
} from '../backupKind';
import {
  FULL_BACKUP_RESULT_TEXT,
  countBackupLibraryItems,
  fullBackupResultText,
  type FullBackupResultInput,
} from '../fullBackupResult';
import { BackupService } from '../BackupService';

const FULL = JSON.stringify({
  type: 'sdstudio-full-backup',
  version: 1,
  mode: 'full',
  projects: [{ name: 'P', folder: null }],
  folders: [],
});
const FOLDER = JSON.stringify({ type: 'sdstudio-folder-backup', version: 1, folder: 'F', projects: ['P'] });

const seed = (dir: string, rel: Record<string, string>) => {
  for (const [k, v] of Object.entries(rel)) files.set(dir + '/' + k, v);
};

let backup: BackupService;
const tmpRootOf = () => mockBackend.unzipFiles.mock.calls[0][1] as string;

beforeEach(() => {
  files.clear();
  archives.clear();
  mockProjects.length = 0;
  mockFolders.length = 0;
  importFails.clear();
  mockGlobals.presets = [];
  mockGlobals.pieces = new Map();
  mockGlobals.chars = [];
  mockGlobals.presetsLoadFailed = false;
  mockSession.favorites = new Set();
  jest.clearAllMocks();
  backup = new BackupService();
  Object.assign(mockState, {
    setProgressDialog: jest.fn(),
    pushDialog: jest.fn(),
    pushDialogAsync: jest.fn(async () => undefined),
    confirmAsync: jest.fn(async () => false),
    pushMessage: jest.fn(),
    loadExportPresets: jest.fn(() => []),
    saveExportPresets: jest.fn(),
    curSession: undefined,
  });
});

// ---------------- A. 종류 판정 ----------------
describe('A. 종류 판정', () => {
  test('전체·폴더·프로젝트를 맨 위에서 가린다(매니페스트를 그대로 돌려줌)', async () => {
    seed('t1', { '_backup.json': FULL, 'P/project.json': '{}' });
    seed('t2', { '_folder.json': FOLDER, 'P/project.json': '{}' });
    seed('t3', { 'project.json': '{}', 'outs/s/1.png': 'i' });
    const a = await detectBackupKind('t1', mockBackend);
    expect(a).toMatchObject({ kind: 'full', root: 't1', unwrapped: false });
    expect((a as any).manifest.type).toBe('sdstudio-full-backup');
    expect(await detectBackupKind('t2', mockBackend)).toMatchObject({ kind: 'folder', root: 't2' });
    expect(await detectBackupKind('t3', mockBackend)).toMatchObject({ kind: 'project', root: 't3' });
  });

  test('맨 위에 폴더 하나만 있으면 그 안을 뿌리로(한 겹만)', async () => {
    seed('w1', { 'sdstudio-backup-full/_backup.json': FULL, 'sdstudio-backup-full/P/project.json': '{}' });
    seed('w2', { '내 프로젝트/project.json': '{}' });
    seed('w3', { 'x/y/_backup.json': FULL }); // 두 겹은 벗기지 않음
    expect(await detectBackupKind('w1', mockBackend)).toMatchObject({
      kind: 'full',
      root: 'w1/sdstudio-backup-full',
      unwrapped: true,
    });
    expect(await detectBackupKind('w2', mockBackend)).toMatchObject({ kind: 'project', root: 'w2/내 프로젝트' });
    expect(await detectBackupKind('w3', mockBackend)).toMatchObject({ kind: 'unknown', root: 'w3' });
  });

  test('맨 위에 파일이 함께 있거나 폴더가 둘이면 벗기지 않음', async () => {
    seed('m1', { 'readme.txt': 'x', 'inner/_backup.json': FULL });
    seed('m2', { 'a/_backup.json': FULL, 'b/project.json': '{}' });
    expect((await detectBackupKind('m1', mockBackend)).kind).toBe('unknown');
    expect((await detectBackupKind('m2', mockBackend)).kind).toBe('unknown');
  });

  test('type 이 다르거나 깨진 매니페스트·빈 폴더는 알 수 없음, 폴더 백업은 projects 배열 필요', async () => {
    seed('u1', { '_backup.json': '{"type":"something-else"}' });
    seed('u2', { '_backup.json': '{not json' });
    seed('u3', { '_folder.json': '{"type":"sdstudio-folder-backup"}' });
    for (const d of ['u1', 'u2', 'u3', 'empty']) {
      expect((await detectBackupKind(d, mockBackend)).kind).toBe('unknown');
    }
  });

  test('판정 순서 = 전체 → 폴더 → 프로젝트', async () => {
    seed('o', { '_backup.json': FULL, '_folder.json': FOLDER, 'project.json': '{}' });
    expect((await detectBackupKind('o', mockBackend)).kind).toBe('full');
  });

  test('경로별 계획 — 원래 받는 종류는 안내 없음, 다른 종류는 안내 한 줄, 알 수 없음', () => {
    expect(planBackupRoute('full', 'full')).toEqual({ action: 'full', notice: null });
    expect(planBackupRoute('full', 'project')).toEqual({
      action: 'project',
      notice: '이 파일은 프로젝트 백업입니다. 프로젝트로 불러옵니다.',
    });
    expect(planBackupRoute('tar', 'folder')).toEqual({ action: 'folder', notice: null });
    expect(planBackupRoute('tar', 'project')).toEqual({ action: 'project', notice: null });
    expect(planBackupRoute('tar', 'full')).toEqual({ action: 'full', notice: BACKUP_IMPORT_TEXT.kindNotice('full') });
    expect(planBackupRoute('folder', 'full').action).toBe('full');
    expect(planBackupRoute('folderDeep', 'project')).toEqual({ action: 'project', notice: null });
    expect(planBackupRoute('library', 'folder')).toEqual({ action: 'folder', notice: BACKUP_IMPORT_TEXT.kindNotice('folder') });
    expect(planBackupRoute('tar', 'unknown')).toEqual({ action: 'unknown' });
  });

  test('끌어 놓기 확장자 — .tar 만, 대소문자 무관', () => {
    expect(isTarFileName('a.tar')).toBe(true);
    expect(isTarFileName('A.TAR')).toBe(true);
    expect(isTarFileName('b.Tar')).toBe(true);
    expect(isTarFileName('b.tar.gz')).toBe(false);
    expect(isTarFileName('backup')).toBe(false);
    expect(isTarFileName('x.zip')).toBe(false);
  });
});

// ---------------- B. 경로별 넘기기 ----------------
describe('B. 경로별로 같은 흐름', () => {
  const spyFlows = () => ({
    full: jest.spyOn(backup as any, 'continueFullBackupImport').mockResolvedValue(undefined),
    folder: jest.spyOn(backup as any, 'restoreFolderBackupFromDir').mockResolvedValue(undefined),
    project: jest.spyOn(backup as any, 'importProjectBackupFromDir').mockResolvedValue(undefined),
  });

  test('전체 백업을 끌어 놓기(handleTarImport)로 — 안내 한 줄 뒤 전체 백업 흐름, 한 번만 풂', async () => {
    archives.set('/d/full.tar', { '_backup.json': FULL, 'P/project.json': '{}' });
    const f = spyFlows();
    await backup.handleTarImport('/d/full.tar');
    const tmp = tmpRootOf();
    expect(mockBackend.unzipFiles).toHaveBeenCalledTimes(1);
    expect(f.full).toHaveBeenCalledWith(tmp, expect.objectContaining({ type: 'sdstudio-full-backup' }), tmp);
    expect(f.folder).not.toHaveBeenCalled();
    expect(f.project).not.toHaveBeenCalled();
    expect(mockState.pushMessage).toHaveBeenCalledWith(BACKUP_IMPORT_TEXT.kindNotice('full'));
  });

  test('프로젝트·폴더 백업을 「전체 백업 불러오기」로 — 안내 뒤 그 종류의 흐름', async () => {
    archives.set('/d/p.tar', { 'project.json': '{}' });
    archives.set('/d/f.tar', { '_folder.json': FOLDER, 'P/project.json': '{}' });
    const f = spyFlows();
    mockBackend.selectFile.mockResolvedValueOnce('/d/p.tar');
    await backup.fullBackupImport();
    const tmp1 = tmpRootOf();
    expect(f.project).toHaveBeenCalledWith(tmp1, 'stem', tmp1);
    expect(mockState.pushMessage).toHaveBeenCalledWith('이 파일은 프로젝트 백업입니다. 프로젝트로 불러옵니다.');
    mockBackend.selectFile.mockResolvedValueOnce('/d/f.tar');
    await backup.fullBackupImport();
    const tmp2 = mockBackend.unzipFiles.mock.calls[1][1];
    expect(f.folder).toHaveBeenCalledWith(tmp2, expect.objectContaining({ folder: 'F' }), tmp2);
    expect(mockState.pushMessage).toHaveBeenCalledWith('이 파일은 폴더 백업입니다. 폴더로 불러옵니다.');
    expect(f.full).not.toHaveBeenCalled();
  });

  test('「전체 백업 불러오기」에 전체 백업 — 안내 없이 전체 흐름', async () => {
    archives.set('/d/full.tar', { '_backup.json': FULL });
    const f = spyFlows();
    mockBackend.selectFile.mockResolvedValueOnce('/d/full.tar');
    await backup.fullBackupImport();
    expect(f.full).toHaveBeenCalledTimes(1);
    expect(mockState.pushMessage).not.toHaveBeenCalled();
  });

  test('폴더 백업 불러오기·폴더 메뉴의 프로젝트 백업 불러오기·라이브러리 불러오기에 전체 백업 — 전체 흐름', async () => {
    archives.set('/d/full.tar', { '_backup.json': FULL });
    const f = spyFlows();
    mockBackend.selectFile.mockResolvedValue('/d/full.tar');
    await backup.folderBackupImport();
    await backup.folderImportDeep('폴더');
    await (backup as any).libraryBackupImport({
      label: '글로벌 프리셋',
      manifestType: 'sdstudio-global-presets',
      pickedPath: '/d/full.tar',
      incomingNames: async () => [],
      existingNames: () => [],
      restore: async () => ({ added: 0, skipped: 0, overwritten: 0 }),
    });
    expect(f.full).toHaveBeenCalledTimes(3);
    expect(mockBackend.unzipFiles).toHaveBeenCalledTimes(3);
    mockBackend.selectFile.mockReset();
  });

  test('한 겹 감싼 전체 백업 — 안쪽을 뿌리로, 지울 곳은 바깥 임시 폴더', async () => {
    archives.set('/d/wrapped.tar', { 'backup/_backup.json': FULL, 'backup/P/project.json': '{}' });
    const f = spyFlows();
    await backup.handleTarImport('/d/wrapped.tar');
    const tmp = tmpRootOf();
    expect(f.full).toHaveBeenCalledWith(tmp + '/backup', expect.anything(), tmp);
  });

  test('끌어 놓은 전체 백업도 메뉴와 같은 확인 창 — 취소하면 바깥 임시 폴더까지 지움', async () => {
    archives.set('/d/full.tar', { 'w/_backup.json': FULL, 'w/P/project.json': '{}' });
    await backup.handleTarImport('/d/full.tar');
    const viaDrop = mockState.pushDialogAsync.mock.calls[0][0];
    const tmp = tmpRootOf();
    expect(under(tmp)).toEqual([]);
    expect(mockSession.importSessionDeepFromDir).not.toHaveBeenCalled();
    mockBackend.selectFile.mockResolvedValueOnce('/d/full.tar');
    await backup.fullBackupImport();
    const viaMenu = mockState.pushDialogAsync.mock.calls[1][0];
    expect(viaDrop).toEqual(viaMenu);
    expect(viaDrop.text).toContain('전체 백업을 불러옵니다. (1개 프로젝트)');
    expect(viaDrop.items.map((i: any) => i.value)).toEqual(['rename', 'skip', 'overwrite']);
  });

  test('알 수 없는 파일 — 임시 폴더를 지우고 다음 행동 안내', async () => {
    archives.set('/d/x.tar', { 'readme.txt': 'hello' });
    const f = spyFlows();
    await backup.handleTarImport('/d/x.tar');
    expect(under(tmpRootOf())).toEqual([]);
    expect(mockState.pushMessage).toHaveBeenCalledWith(BACKUP_IMPORT_TEXT.unknownKind);
    expect(f.full).not.toHaveBeenCalled();
    expect(f.project).not.toHaveBeenCalled();
  });

  test('풀기 실패 — 풀다 만 임시 폴더를 지우고 이유를 짐작할 수 있는 안내', async () => {
    mockBackend.selectFile.mockResolvedValueOnce('/d/broken.zip');
    await backup.fullBackupImport();
    expect(under(tmpRootOf())).toEqual([]);
    expect(mockState.pushMessage).toHaveBeenCalledWith(BACKUP_IMPORT_TEXT.unzipFailed);
    await backup.handleTarImport('/d/broken2.tar');
    expect(under(mockBackend.unzipFiles.mock.calls[1][1])).toEqual([]);
    expect(mockState.pushMessage).toHaveBeenLastCalledWith(BACKUP_IMPORT_TEXT.unzipFailed);
  });

  test('매니페스트 version 초과 — 모든 경로에서 거부·임시 폴더 정리(전체·폴더)', async () => {
    archives.set('/d/new.tar', { '_backup.json': JSON.stringify({ type: 'sdstudio-full-backup', version: 2 }) });
    archives.set('/d/newf.tar', { '_folder.json': JSON.stringify({ type: 'sdstudio-folder-backup', version: 9, projects: [] }) });
    const f = spyFlows();
    await backup.handleTarImport('/d/new.tar');
    mockBackend.selectFile.mockResolvedValueOnce('/d/newf.tar');
    await backup.fullBackupImport();
    expect(f.full).not.toHaveBeenCalled();
    expect(f.folder).not.toHaveBeenCalled();
    for (const c of mockBackend.unzipFiles.mock.calls) expect(under(c[1])).toEqual([]);
    expect(mockState.pushMessage).toHaveBeenCalledWith(
      expect.stringContaining('더 새로운 버전의 SDStudio에서 만들어졌습니다'),
    );
  });

  test('폴더 메뉴의 프로젝트 백업 불러오기 — 받은 이름으로 가져와 폴더로, 한 번만 풀고 정리', async () => {
    archives.set('/d/p.tar', { 'project.json': '{}' });
    mockBackend.selectFile.mockResolvedValueOnce('/d/p.tar');
    await backup.folderImportDeep('폴더A');
    const tmp = tmpRootOf();
    expect(mockSession.importSessionDeepFromDir).toHaveBeenCalledWith(tmp, '받은 이름');
    expect(mockSession.moveToFolder).toHaveBeenCalledWith('받은 이름', '폴더A');
    expect(under(tmp)).toEqual([]);
    expect(mockBackend.unzipFiles).toHaveBeenCalledTimes(1);
  });

  test('폴더 메뉴 — 알 수 없는 파일이면 원시 오류 대신 안내', async () => {
    archives.set('/d/x.tar', { 'a.txt': '1' });
    mockBackend.selectFile.mockResolvedValueOnce('/d/x.tar');
    await backup.folderImportDeep('폴더A');
    expect(mockSession.importSessionDeepFromDir).not.toHaveBeenCalled();
    expect(mockState.pushMessage).toHaveBeenCalledWith(BACKUP_IMPORT_TEXT.unknownKind);
  });

  test('라이브러리 불러오기 — 풀기 실패 정리·제 매니페스트도 다른 백업도 아니면 종전 문구', async () => {
    archives.set('/d/other.tar', { '_manifest.json': '{"type":"sdstudio-artist-library"}' });
    const opts = {
      label: '글로벌 프리셋',
      manifestType: 'sdstudio-global-presets',
      incomingNames: async () => [],
      existingNames: () => [],
      restore: async () => ({ added: 0, skipped: 0, overwritten: 0 }),
    };
    await (backup as any).libraryBackupImport({ ...opts, pickedPath: '/d/none.tar' });
    expect(under(tmpRootOf())).toEqual([]);
    expect(mockState.pushMessage).toHaveBeenLastCalledWith(BACKUP_IMPORT_TEXT.unzipFailed);
    await (backup as any).libraryBackupImport({ ...opts, pickedPath: '/d/other.tar' });
    expect(mockState.pushMessage).toHaveBeenLastCalledWith('글로벌 프리셋 백업 파일이 아닙니다.');
    expect(under(mockBackend.unzipFiles.mock.calls[1][1])).toEqual([]);
  });
});

// ---------------- C. 복원 결과 ----------------
describe('C. 전체 백업 복원 결과', () => {
  const R = 'tmp/r';
  const restore = (m: any, mode: 'full' | 'noimg' | 'settings', policy: 'rename' | 'skip' | 'overwrite') =>
    (backup as any).restoreFullBackupFromDir(R, m, mode, policy);
  const lastText = () => mockState.pushDialog.mock.calls.at(-1)[0].text as string;
  const man = (names: string[]) => ({
    type: 'sdstudio-full-backup',
    version: 1,
    mode: 'full',
    projects: names.map((name) => ({ name, folder: null })),
  });

  test('가져오기 실패 이름을 보이고, 덮어쓰기에서 지운 뒤 실패한 것은 「덮어씀」으로 세지 않음', async () => {
    mockProjects.push('A', 'B');
    importFails.add('A'); // 덮어쓰기 대상 — 지운 뒤 실패
    importFails.add('C'); // 새 프로젝트 — 실패
    await restore(man(['A', 'B', 'C']), 'full', 'overwrite');
    const t = lastText();
    expect(t.split('\n')[0]).toBe('1/3개 프로젝트와 설정을 불러왔습니다.');
    expect(t).toContain('(1개 덮어씀)'); // B 만
    expect(t).toContain('덮어쓰려다 가져오지 못한 프로젝트: 「A」 — 기존 프로젝트는 이미 지워졌습니다.');
    expect(t).toContain('가져오지 못한 프로젝트: 「C」');
    // 순서는 그대로(지운 뒤 가져오기) — A 는 목록에서 사라짐
    expect(mockProjects).toEqual(['B']);
  });

  test('글로벌 라이브러리 — 비어 있으면 받고, 이미 있으면 받지 않았다고(백업 쪽 개수)', async () => {
    seed(R + '/__settings__', {
      'global_presets.json': JSON.stringify({ version: 2, presets: [{}, {}, {}] }),
      'global_pieces.json': JSON.stringify({ g1: {}, g2: {} }),
      'global_character_presets.json': JSON.stringify({ version: 1, presets: [{}] }),
    });
    mockGlobals.presets = [{ id: 'mine' }]; // 프리셋은 이미 있음
    mockGlobals.chars = [{ id: 'c' }]; // 캐릭터도 이미 있음
    await restore(man([]), 'full', 'rename');
    const t = lastText();
    expect(t).toContain('백업의 전역 조각 그룹 2개를 받았습니다.');
    expect(t).toContain(
      '백업의 글로벌 프리셋 3개·글로벌 캐릭터 프리셋 1개는 이 기기에 이미 있어서 받지 않았습니다',
    );
    expect(files.get('global_pieces.json')).toBe(JSON.stringify({ g1: {}, g2: {} }));
    expect(files.has('global_presets.json')).toBe(false); // 규칙 그대로 — 덮지 않음
    expect(mockPresetLoad).not.toHaveBeenCalled();
  });

  test('받는 쪽 글로벌 프리셋을 읽지 못한 상태면 받지 않고 그렇게 알림', async () => {
    seed(R + '/__settings__', { 'global_presets.json': JSON.stringify({ presets: [{}] }) });
    mockGlobals.presetsLoadFailed = true;
    await restore(man([]), 'settings', 'rename');
    const t = lastText();
    expect(t.split('\n')[0]).toBe('설정을 병합했습니다.');
    expect(t).toContain('이 기기의 파일을 읽지 못해 백업의 글로벌 프리셋 1개는 받지 않았습니다.');
    expect(files.has('global_presets.json')).toBe(false);
  });

  test('프로젝트 템플릿이 이미 있어 받지 않음(kept)도 알림', async () => {
    const pts = jest.requireMock('..').projectTemplateService;
    pts.adoptFromFullBackupIfEmpty.mockResolvedValueOnce({ kind: 'kept', count: 4 });
    await restore(man([]), 'full', 'rename');
    expect(lastText()).toContain('백업의 프로젝트 템플릿 4개는 이 기기에 이미 있어서 받지 않았습니다');
  });

  test('새 이름으로 들어온 프로젝트 — 백업에 그 이름의 즐겨찾기·북마크가 있을 때만 한 줄', async () => {
    mockProjects.push('A', 'B');
    seed(R + '/__settings__', {
      'favorites.json': JSON.stringify(['A']),
      'bookmarks.json': JSON.stringify({ scenes: {}, images: { 'Z:s': '1.png' } }),
    });
    await restore(man(['A', 'B']), 'full', 'rename');
    expect(mockProjects).toEqual(['A', 'B', 'A (2)', 'B (2)']);
    expect(lastText()).toContain(FULL_BACKUP_RESULT_TEXT.renamedMarks(1)); // A 만(B 는 표시 없음)
    // 동작은 그대로 — 즐겨찾기는 원래 이름 A 에 붙는다(조사 P8)
    expect(Array.from(mockSession.favorites)).toEqual(['A']);
  });

  test('아무 일 없으면 종전과 같은 한 줄', async () => {
    await restore(man(['P']), 'full', 'rename');
    expect(lastText()).toBe('1/1개 프로젝트와 설정을 불러왔습니다.');
  });
});

// ---------------- D. 결과 문구 ----------------
describe('D. 결과 문구', () => {
  const base: FullBackupResultInput = {
    settingsOnly: false,
    total: 10,
    restored: 2,
    skipped: 1,
    overwritten: 0,
    overwriteBlocked: [],
    failed: [],
    overwriteFailed: [],
    renamedWithMarks: 0,
    libraries: [],
    templateNote: [],
  };

  test('이름이 많으면 앞 5개 + 외 N개', () => {
    const t = fullBackupResultText({ ...base, failed: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] });
    expect(t).toBe(
      '2/10개 프로젝트와 설정을 불러왔습니다.\n(1개 건너뜀)\n가져오지 못한 프로젝트: 「a」, 「b」, 「c」, 「d」, 「e」 외 2개',
    );
  });

  test('줄 순서 — 덮어쓰지 못함 → 덮어쓰려다 실패 → 실패 → 라이브러리 → 새 이름 → 템플릿', () => {
    const t = fullBackupResultText({
      ...base,
      skipped: 0,
      overwritten: 1,
      overwriteBlocked: ['X'],
      overwriteFailed: ['Y'],
      failed: ['Z'],
      renamedWithMarks: 2,
      libraries: [
        { kind: 'globalPresets', result: 'adopted', count: 3 },
        { kind: 'globalPieces', result: 'kept', count: 0 }, // 0개는 알릴 것 없음
        { kind: 'globalCharacterPresets', result: 'error' },
      ],
      templateNote: ['씬 템플릿 1개도 되살렸습니다.'],
    }).split('\n');
    expect(t[0]).toBe('2/10개 프로젝트와 설정을 불러왔습니다.');
    expect(t[1]).toBe('(1개 덮어씀, 1개 덮어쓰지 못함)');
    expect(t[2]).toContain('덮어쓰지 못한 프로젝트: 「X」');
    expect(t[4]).toContain('덮어쓰려다 가져오지 못한 프로젝트: 「Y」');
    expect(t[5]).toBe('가져오지 못한 프로젝트: 「Z」');
    expect(t[6]).toBe('백업의 글로벌 프리셋 3개를 받았습니다.');
    expect(t[7]).toBe('백업의 글로벌 캐릭터 프리셋을 받다가 오류가 나 받지 못했습니다.');
    expect(t[8]).toBe(FULL_BACKUP_RESULT_TEXT.renamedMarks(2));
    expect(t[9]).toBe('씬 템플릿 1개도 되살렸습니다.');
    expect(t).toHaveLength(10);
  });

  test('설정만 — 프로젝트 줄 없이', () => {
    expect(fullBackupResultText({ ...base, settingsOnly: true, failed: ['무시'] })).toBe('설정을 병합했습니다.');
  });

  test('백업 쪽 개수 세기', () => {
    expect(countBackupLibraryItems('globalPresets', '{"presets":[1,2]}')).toBe(2);
    expect(countBackupLibraryItems('globalCharacterPresets', '{"presets":[]}')).toBe(0);
    expect(countBackupLibraryItems('globalPieces', '{"a":{},"b":{}}')).toBe(2);
    expect(countBackupLibraryItems('globalPieces', '[1]')).toBeUndefined();
    expect(countBackupLibraryItems('globalPresets', 'broken')).toBeUndefined();
  });
});
