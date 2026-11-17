// M5 묶음 b-2(2026-11-16, 플랜 guides/plans/2026-11-16-m5-flow-dedup.md):
// 폴더 일괄 이미지 내보내기(BackupService.folderExportImages)가 프로젝트 이미지 내보내기(ExportPresetService.exportPackage)와
// 같은 단계 함수(buildExportImageList → optimizeExportImages → deliverExportImages)를 같은 옵션으로 부르는지.
//  ① 출력 형태·목표 폴더(프로젝트별 하위 폴더 유지) ② 화질·스테가노 보존 인자 ③ 파일명 패턴(프로젝트별 치환)
//  ④ 저장 프리셋의 특수문자 자동 변환 ⑤ 캐릭터 접두/접미사 = 각 프로젝트의 적용 캐릭터 프리셋(토글 존중) ⑥ 재최적화 정책
const mockState: any = {};
const mockZipFiles = jest.fn(async (_paths: any[], _dest: string) => {});
const mockBackend = {
  getConfig: jest.fn(async () => ({} as any)),
  resizeImage: jest.fn(async (_a: any) => {}),
  publishExport: jest.fn(async (_p: string) => {}),
  openPath: jest.fn(async (_p: string) => {}),
  copyFile: jest.fn(async (_s: string, _d: string) => {}),
  copyFileToAbsolute: jest.fn(async (_s: string, _d: string) => 'copied'),
  deleteFile: jest.fn(async (_p: string) => {}),
  writeDataFile: jest.fn(async () => {}),
};
const mockPlatform = { supportsTargetFolder: true, maxImageConcurrency: 2, exportConcurrency: 2 };
const mockSessions = new Map<string, any>();
const mockFolderMap: Record<string, string> = {};
let mockOutputs: string[] = ['1.png'];
let mockEps: any;

jest.mock('..', () => ({
  get exportPresetService() {
    return mockEps;
  },
  backend: mockBackend,
  imageService: {
    refreshBatch: jest.fn(async () => {}),
    getOutputDir: (session: any, scene: any) => `${session.name}/outs/${scene.name}`,
  },
  gameService: { refreshList: jest.fn(async () => {}), getOutputs: () => mockOutputs },
  sessionService: {
    getProjectsInFolder: (folder: string) =>
      Object.keys(mockFolderMap).filter((n) => mockFolderMap[n] === folder || mockFolderMap[n].startsWith(folder + '/')),
    getFolderOf: (name: string) => mockFolderMap[name] ?? null,
    folderLeafName: (p: string) => p.split('/').pop(),
    get: async (name: string) => mockSessions.get(name),
  },
  zipService: { zipFiles: mockZipFiles, isZipping: false },
}));
jest.mock('../AppService', () => ({ appState: mockState }));
jest.mock('../platform', () => ({ platform: mockPlatform }));
jest.mock('../../backend', () => ({ ImageOptimizeMethod: { LOSSY: 'lossy', LOSSLESS: 'lossless', AVIF: 'avif' } }));
jest.mock('../PersistenceService', () => ({ persistService: { write: jest.fn() } }));
jest.mock('../ImageService', () => ({}));
jest.mock('../SessionService', () => ({}));
jest.mock('../types', () => ({}));
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
jest.mock('../fullBackupOverwrite', () => ({}));
jest.mock('../projectTemplateBackup', () => ({}));
jest.mock('../presetUndo', () => ({}));
jest.mock('../projectFolderUndo', () => ({}));
jest.mock('../undoService', () => ({}));

import { ExportPresetService } from '../ExportPresetService';
import { BackupService } from '../BackupService';
import { emptyExportForm, exportFormToPreset, exportRunOptionsFromPreset } from '../exportSettings';
import { appliedCharacterPresetOf, characterFilenameAffixOf } from '../appliedCharacterPreset';
import type { ExportPreset } from '../AppService';

// 적용 캐릭터 프리셋(선택 워크플로우 shared 의 _appliedPresetName)이 있는 세션
function session(name: string, sceneNames: string[], affix?: { prefix?: string; suffix?: string }) {
  const presets = new Map<string, any>();
  const shared: any = {};
  if (affix) {
    presets.set('char', { name: 'char', filenamePrefix: affix.prefix, filenameSuffix: affix.suffix });
    shared._appliedPresetName = 'char';
  }
  return {
    name,
    selectedWorkflow: { workflowType: 'SDImageGen' },
    presetShareds: new Map([['SDImageGen', shared]]),
    getCharacterPreset: (n: string) => presets.get(n),
    getScenes: (type: string) =>
      type === 'scene' ? sceneNames.map((s) => ({ name: s, mains: [], type: 'scene' })) : [],
  };
}

const form = (patch: Partial<ExportPreset> = {}): ExportPreset => ({ ...exportFormToPreset(emptyExportForm()), ...patch });
let backup: BackupService;

beforeEach(() => {
  jest.clearAllMocks();
  mockSessions.clear();
  for (const k of Object.keys(mockFolderMap)) delete mockFolderMap[k];
  mockOutputs = ['1.png'];
  mockPlatform.supportsTargetFolder = true;
  mockBackend.getConfig.mockResolvedValue({});
  // 폴더 F: A(적용 프리셋 alice/end), B(하위 폴더 F/sub, 적용 프리셋 bob), C(적용 프리셋 없음)
  mockFolderMap.A = 'F';
  mockFolderMap.B = 'F/sub';
  mockFolderMap.C = 'F';
  mockFolderMap.Other = 'G';
  mockSessions.set('A', session('A', ['s 1'], { prefix: 'alice', suffix: 'end' }));
  mockSessions.set('B', session('B', ['s2'], { prefix: 'bob' }));
  mockSessions.set('C', session('C', ['s3']));
  mockEps = new ExportPresetService();
  backup = new BackupService();
  Object.assign(mockState, {
    exportProgress: undefined,
    directExportRequest: undefined,
    // 지금 열린 프로젝트 = A. 종전 결함: 모든 프로젝트에 A 의 접두/접미사가 붙었다
    curSession: mockSessions.get('A'),
    pushDialogAsync: jest.fn(),
    pushDialog: jest.fn(),
    pushMessage: jest.fn(),
    showExportComplete: jest.fn(),
    openExportPresetManager: jest.fn(),
    loadExportPresets: jest.fn(() => [] as ExportPreset[]),
    detectSpecialCharsFromNames: (names: string[], sep: string, auto = false) =>
      mockEps.detectSpecialCharsFromNames(names, sep, auto),
    requestDirectExport: (info: any) => mockEps.requestDirectExport(info),
  });
});

// 직접 설정 폼 경로로 실행(폼 결과 = preset, 변환 문자 = chars)
async function runDirect(preset: ExportPreset, chars: string[] = []) {
  mockState.pushDialogAsync.mockResolvedValueOnce('_manual');
  const pending = backup.folderExportImages('F');
  for (let i = 0; i < 20 && !mockState.directExportRequest; i++) await Promise.resolve();
  expect(mockState.directExportRequest).toMatchObject({ scope: 'folder', projectName: 'F', projectCount: 3 });
  mockState.directExportRequest.resolve({ preset, charsToReplace: chars });
  await pending;
}
// 저장 프리셋 경로로 실행
async function runPreset(preset: ExportPreset, ...answers: any[]) {
  mockState.loadExportPresets.mockReturnValue([preset]);
  mockState.pushDialogAsync.mockResolvedValueOnce('preset_0');
  for (const a of answers) mockState.pushDialogAsync.mockResolvedValueOnce(a);
  await backup.folderExportImages('F');
}
const entryNames = () => (mockZipFiles.mock.calls[0][0] as any[]).map((e) => e.name);

describe('세션별 적용 캐릭터 프리셋(단일 출처)', () => {
  test('선택 워크플로우 shared 의 _appliedPresetName → 그 세션의 프리셋', () => {
    expect(appliedCharacterPresetOf(mockSessions.get('A') as any)?.filenamePrefix).toBe('alice');
    expect(characterFilenameAffixOf(mockSessions.get('B') as any)).toEqual({ filenamePrefix: 'bob', filenameSuffix: undefined });
    expect(characterFilenameAffixOf(mockSessions.get('C') as any)).toEqual({ filenamePrefix: undefined, filenameSuffix: undefined });
    expect(appliedCharacterPresetOf(undefined)).toBeUndefined();
    expect(appliedCharacterPresetOf({ name: 'x', getScenes: () => [] } as any)).toBeUndefined();
  });
});

describe('폴더 일괄 이미지 내보내기 = 프로젝트 내보내기와 같은 규칙', () => {
  test('종전 기본 설정 = 종전 결과: tar 하나·기본 위치·프로젝트별 하위 폴더·완료 안내(장 수)', async () => {
    await runDirect(form());
    expect(mockZipFiles).toHaveBeenCalledTimes(1);
    const [entries, dest] = mockZipFiles.mock.calls[0];
    expect(dest).toMatch(/^exports\/F_images_\d+\.tar$/);
    // 각 프로젝트의 적용 캐릭터 프리셋 기준(⑤ — A 만 alice/end, B 는 bob, C 는 없음)
    expect(entries).toEqual([
      { path: 'A/outs/s 1/1.png', name: 'A/alice.s 1.end.png' },
      { path: 'B/outs/s2/1.png', name: 'B/bob.s2.png' },
      { path: 'C/outs/s3/1.png', name: 'C/s3.png' },
    ]);
    expect(mockState.pushDialog).toHaveBeenCalledWith({ type: 'yes-only', text: '폴더 "F" 이미지 내보내기가 완료되었습니다. (3장)' });
    expect(mockBackend.publishExport).toHaveBeenCalledWith(dest);
    expect(mockBackend.openPath).not.toHaveBeenCalled();
    expect(mockBackend.resizeImage).not.toHaveBeenCalled();
  });

  test('접두/접미사 토글 off = 어느 프로젝트에도 붙이지 않음', async () => {
    await runDirect(form({ applyCharacterAffix: false }));
    expect(entryNames()).toEqual(['A/s 1.png', 'B/s2.png', 'C/s3.png']);
  });

  test('파일명 패턴은 프로젝트마다 그 프로젝트의 폴더·프로젝트 이름으로', async () => {
    await runDirect(form({ filenamePattern: 'folder.project.scene', applyCharacterAffix: false, separator: '_' }));
    expect(entryNames()).toEqual(['A/F_A_s 1.png', 'B/sub_B_s2.png', 'C/F_C_s3.png']);
  });

  test('이름 접두(캐릭터 이름)·구분자·특수문자 변환(직접 설정 = 폼에서 고른 문자)', async () => {
    await runDirect(form({ format: 'prefix', prefix: '앨리스', separator: '-', applyCharacterAffix: false }), [' ']);
    expect(entryNames()[0]).toBe('A/앨리스-s-1.png');
  });

  test('화질·스테가노그래피 보존을 프로젝트와 같은 인자로 변환, 확장자 = 출력 형식', async () => {
    await runDirect(form({ opt: 'lossy', imageSize: 512, quality: 70, preserveStealth: true, applyCharacterAffix: false }));
    expect(mockBackend.resizeImage).toHaveBeenCalledTimes(3);
    expect(mockBackend.resizeImage).toHaveBeenCalledWith(expect.objectContaining({
      inputPath: 'A/outs/s 1/1.png', maxWidth: 512, maxHeight: 512, optimize: 'lossy', quality: 70, preserveStealth: true,
    }));
    expect(entryNames()).toEqual(['A/s 1.webp', 'B/s2.webp', 'C/s3.webp']);
  });

  test('zip = 압축파일 하나(.zip) 안에 프로젝트별 폴더', async () => {
    await runDirect(form({ outputMode: 'zip' }));
    expect(mockZipFiles.mock.calls[0][1]).toMatch(/^exports\/F_images_\d+\.zip$/);
    expect(entryNames()[1]).toBe('B/bob.s2.png');
  });

  test('개별 파일(목표 폴더 없음) = exports/<폴더>_images_<시각>/<프로젝트>/… → publishExport', async () => {
    await runDirect(form({ outputMode: 'files' }));
    expect(mockZipFiles).not.toHaveBeenCalled();
    const dests = mockBackend.copyFile.mock.calls.map((c) => c[1]);
    expect(dests).toHaveLength(3);
    expect(dests[0]).toMatch(/^exports\/F_images_\d+\/A\/alice\.s 1\.end\.png$/);
    expect(dests[1]).toMatch(/^exports\/F_images_\d+\/B\/bob\.s2\.png$/);
    expect(mockBackend.publishExport).toHaveBeenCalledWith(expect.stringMatching(/^exports\/F_images_\d+$/));
    expect(mockState.showExportComplete).toHaveBeenCalled();
    expect(mockState.pushDialog).not.toHaveBeenCalled();
  });

  test('개별 파일 + 목표 폴더(+이 폴더 경로로 하위 폴더) = <목표>/F/F_images_<시각>/<프로젝트>/… → 그 폴더 열기', async () => {
    await runDirect(form({ outputMode: 'files', targetFolder: '/t', useProjectRelativePath: true }));
    const dests = mockBackend.copyFileToAbsolute.mock.calls.map((c) => c[1]);
    expect(dests[2]).toMatch(/^\/t\/F\/F_images_\d+\/C\/s3\.png$/);
    expect(mockBackend.openPath).toHaveBeenCalledWith(expect.stringMatching(/^\/t\/F\/F_images_\d+$/));
    expect(mockBackend.publishExport).not.toHaveBeenCalled();
  });

  test('tar + 목표 폴더(환경설정 기본 폴더) = 그 폴더로 옮기고 폴더 열기', async () => {
    mockBackend.getConfig.mockResolvedValue({ defaultExportFolder: '/d' });
    await runDirect(form());
    expect(mockBackend.copyFileToAbsolute).toHaveBeenCalledWith(
      expect.stringMatching(/^exports\/F_images_\d+\.tar$/),
      expect.stringMatching(/^\/d\/F_images_\d+\.tar$/),
    );
    expect(mockBackend.deleteFile).toHaveBeenCalled();
    expect(mockBackend.openPath).toHaveBeenCalledWith('/d');
    expect(mockState.showExportComplete).toHaveBeenCalled();
    expect(mockState.pushDialog).not.toHaveBeenCalled();
  });

  test('모바일(목표 폴더 미지원) = 목표 폴더를 무시하고 기본 위치', async () => {
    mockPlatform.supportsTargetFolder = false;
    await runDirect(form({ targetFolder: '/t' }));
    expect(mockBackend.copyFileToAbsolute).not.toHaveBeenCalled();
    expect(mockBackend.publishExport).toHaveBeenCalledWith(expect.stringMatching(/^exports\/F_images_\d+\.tar$/));
  });

  test('저장 프리셋의 「특수문자 자동 변환」 = 묻지 않고 변환', async () => {
    await runPreset(form({ autoConvertSeparator: true, separator: '_', applyCharacterAffix: false }));
    expect(mockState.pushDialogAsync).toHaveBeenCalledTimes(1); // 방법 선택만
    expect(entryNames()[0]).toBe('A/s_1.png');
  });

  test('저장 프리셋(자동 변환 꺼짐) = 종전처럼 한 번 묻는다', async () => {
    await runPreset(form({ applyCharacterAffix: false }), JSON.stringify([]));
    expect(mockState.pushDialogAsync).toHaveBeenCalledTimes(2);
    expect(mockState.pushDialogAsync.mock.calls[1][0].type).toBe('checkbox');
    expect(entryNames()[0]).toBe('A/s 1.png');
  });

  test('저장 프리셋 「이름 직접 입력」 = 폴더당 한 번 묻고 모든 프로젝트에 같은 이름', async () => {
    await runPreset(form({ format: 'prefix_ask', applyCharacterAffix: false, autoConvertSeparator: true }), '밥');
    expect(mockState.pushDialogAsync.mock.calls[1][0]).toMatchObject({ type: 'input-confirm', text: '캐릭터 이름을 입력해주세요' });
    expect(entryNames()).toEqual(['A/밥.s.1.png', 'B/밥.s2.png', 'C/밥.s3.png']);
  });

  test('「이름 직접 입력」 취소 = 아무것도 내보내지 않음', async () => {
    await runPreset(form({ format: 'prefix_ask' }), undefined);
    expect(mockZipFiles).not.toHaveBeenCalled();
  });

  test('재최적화 정책: 폼 값(skip) = 묻지 않고 이미 최적화된 이미지는 원본 유지', async () => {
    mockOutputs = ['1.webp'];
    await runDirect(form({ opt: 'lossy', reoptimize: 'skip', applyCharacterAffix: false }));
    expect(mockState.pushDialogAsync).toHaveBeenCalledTimes(1);
    expect(mockBackend.resizeImage).not.toHaveBeenCalled();
    expect(entryNames()).toEqual(['A/s 1.webp', 'B/s2.webp', 'C/s3.webp']);
  });

  test('재최적화 정책: 구 프리셋(ask) = 처음 한 번만 묻고 다음 프로젝트는 그 답', async () => {
    mockOutputs = ['1.webp'];
    await runPreset(form({ opt: 'avif', reoptimize: undefined, autoConvertSeparator: true, applyCharacterAffix: false }), 'all');
    const selects = mockState.pushDialogAsync.mock.calls.filter((c: any[]) => String(c[0].text).includes('이미 최적화'));
    expect(selects).toHaveLength(1);
    expect(mockBackend.resizeImage).toHaveBeenCalledTimes(3);
    expect(entryNames()).toEqual(['A/s.1.avif', 'B/s2.avif', 'C/s3.avif']);
  });

  test('폴더에 프로젝트가 없으면 안내만', async () => {
    await backup.folderExportImages('없음');
    expect(mockState.pushMessage).toHaveBeenCalledWith('폴더에 프로젝트가 없습니다.');
    expect(mockState.pushDialogAsync).not.toHaveBeenCalled();
  });

  test('불러오지 못한 프로젝트는 건너뛰고 계속', async () => {
    mockSessions.delete('B');
    await runDirect(form({ applyCharacterAffix: false }));
    expect(entryNames()).toEqual(['A/s 1.png', 'C/s3.png']);
  });
});

describe('프로젝트 이미지 내보내기 회귀(같은 단계 함수)', () => {
  test('지금 열린 프로젝트의 적용 캐릭터 프리셋·파일명 패턴·tar 기본 위치', async () => {
    mockState.curSession = mockSessions.get('B');
    await mockEps.exportPackage('scene', undefined, form({ filenamePattern: 'project.scene' }));
    const [entries, dest] = mockZipFiles.mock.calls[0];
    expect(entries).toEqual([{ path: 'B/outs/s2/1.png', name: 'B.bob.s2.png' }]);
    expect(dest).toMatch(/^exports\/B_main_images_\d+\.tar$/);
    expect(mockState.showExportComplete).toHaveBeenCalled();
    expect(mockBackend.publishExport).toHaveBeenCalledWith(dest);
  });

  test('개별 파일 = exports/<프로젝트>_<시각>/파일 (하위 폴더 없음)', async () => {
    mockState.pushDialogAsync.mockResolvedValueOnce(JSON.stringify([])); // 특수문자 질의 = 변환 없음
    await mockEps.exportPackage('scene', undefined, form({ outputMode: 'files', applyCharacterAffix: false }));
    expect(mockBackend.copyFile.mock.calls[0][1]).toMatch(/^exports\/A_\d+\/s 1\.png$/);
  });

  test('프리셋 → 실행 옵션 해석(구 프리셋 누락값)', () => {
    const legacy = { ...form(), outputMode: undefined, reoptimize: undefined, applyCharacterAffix: undefined } as ExportPreset;
    expect(exportRunOptionsFromPreset(legacy)).toMatchObject({ outputMode: 'tar', reoptimize: 'ask', applyCharacterAffix: true, prefix: '' });
    expect(exportRunOptionsFromPreset(form({ format: 'prefix_ask', separator: '_' }), '밥').prefix).toBe('밥_');
    expect(exportRunOptionsFromPreset(form({ outputMode: 'nope' as any })).outputMode).toBe('tar');
  });
});
