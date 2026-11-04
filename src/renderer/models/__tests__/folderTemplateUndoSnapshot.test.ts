// 폴더 삭제 되돌리기의 템플릿 스냅숏(2026-11-04 되돌리기 2차 묶음 3 P1-b, 사용자 결정 D7 ①):
//  - TemplateService.snapshotFolderTemplates: 폴더·하위 지정 + 폴더 전용 로컬 템플릿(이미지 내용) + 그 적용 기록
//  - removeFolder(실제 삭제 — 엔티티·이미지 영구 삭제) 뒤 restoreFolderTemplates: 같은 id·folderLocal·배지 색·수정 시각 유지,
//    이미지는 새 파일명으로 다시 쓰고 참조 교체, 지정·적용 기록 복원, 여러 번 불러도 같다
//  - 전역 템플릿 지정은 엔티티를 스냅숏하지 않는다(지우지 않으므로), 그사이 사라졌으면 실패 수로 알린다

const files: Record<string, string> = {};
let seq = 0;
const backend = {
  readFile: jest.fn(async (p: string) => {
    if (!(p in files)) throw new Error('no file');
    return files[p];
  }),
  existFile: jest.fn(async (p: string) => p in files),
  readDataFile: jest.fn(async (p: string) => {
    if (!(p in files)) throw new Error('no file');
    return 'data:image/png;base64,' + files[p];
  }),
  writeDataFile: jest.fn(async (p: string, base64: string) => {
    files[p] = base64;
  }),
  deleteFile: jest.fn(async (p: string) => {
    delete files[p];
  }),
  renameFile: jest.fn(async () => {}),
};

let mockFolders: string[] = [];
const mockRefs: { pts?: any; ts?: any } = {};
jest.mock('..', () => ({
  backend,
  imageService: {},
  workFlowService: {},
  sessionService: { listFolders: () => mockFolders.slice(), list: () => [] },
  trashService: {},
  globalPresetService: {},
  globalCharacterPresetService: {},
  get projectTemplateService() {
    return mockRefs.pts;
  },
  get templateService() {
    return mockRefs.ts;
  },
}));
jest.mock('../PersistenceService', () => ({
  persistService: { write: jest.fn(async () => {}) },
}));
jest.mock('../appStateRef', () => ({ getAppState: () => ({ pushMessage: jest.fn() }) }));
jest.mock('../ImageService', () => ({ dataUriToBase64: (s: string) => s }));
jest.mock('../imageFormats', () => ({ imageExtFromBase64: () => 'png' }));
jest.mock('../types', () => ({
  VibeItem: { fromJSON: (j: any) => j },
  ReferenceItem: { fromJSON: (j: any) => j },
  CharacterPreset: { fromJSON: (j: any) => j },
  Session: class {},
  genericSceneFromJSON: (j: any) => j,
}));
jest.mock('uuid', () => ({ v4: () => `n${++seq}` }));

import { ProjectTemplateService } from '../ProjectTemplateService';
import { TemplateService } from '../TemplateService';

const IMG_DIR_FILE = (svc: ProjectTemplateService, f: string) => svc.getImagePath(f);

const localTpl = (): any => ({
  id: 'L1',
  name: '폴더 템플릿',
  createdAt: 5,
  updatedAt: 7,
  folderLocal: true,
  badgeColor: '#ff00ff',
  preset: { name: 'p', profile: 'prof.png' },
  characterPresets: [{ name: 'c', vibes: [{ path: 'cv.png' }], representativeImage: 'rep.png' }],
  vibes: [{ path: 'v.png', strength: 0.6 }],
  characterReferences: [],
  scenes: [{ name: 's1' }],
});

let pts: ProjectTemplateService;
let ts: TemplateService;

beforeEach(() => {
  jest.useFakeTimers();
  for (const k of Object.keys(files)) delete files[k];
  seq = 0;
  pts = new ProjectTemplateService();
  ts = new TemplateService();
  mockRefs.pts = pts;
  mockRefs.ts = ts;
  pts.loaded = true;
  pts.templates = [localTpl(), { ...localTpl(), id: 'G1', name: '전역', folderLocal: undefined, badgeColor: undefined }];
  for (const f of ['prof.png', 'cv.png', 'rep.png', 'v.png']) files[IMG_DIR_FILE(pts, f)] = 'B64_' + f;
  mockFolders = ['A', 'A/B', 'C'];
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

async function seedAssignments() {
  await ts.setFolderTemplate('A', 'L1');
  await ts.setFolderTemplate('A/B', 'G1');
  await ts.setFolderTemplate('C', 'G1');
  await ts.recordApplication('proj', 'L1', {
    inherited: true,
    presets: [],
    characterPresetNames: [],
    vibePaths: [],
    referencePaths: [],
  });
}

describe('폴더 템플릿 스냅숏 → removeFolder → 복원', () => {
  test('로컬 템플릿(이미지 포함)·지정·적용 기록이 같은 id 로 돌아온다', async () => {
    await seedAssignments();
    const snap = await ts.snapshotFolderTemplates('A');
    expect(snap.assignments).toEqual([
      { folder: 'A', templateId: 'L1' },
      { folder: 'A/B', templateId: 'G1' },
    ]);
    expect(snap.locals.map((l) => l.entry.id)).toEqual(['L1']); // 전역 G1 은 엔티티를 스냅숏하지 않는다
    expect(Object.keys(snap.locals[0].images).sort()).toEqual(['cv.png', 'prof.png', 'rep.png', 'v.png']);
    expect(snap.applications).toHaveLength(1);

    await ts.removeFolder('A');
    expect(pts.get('L1')).toBeUndefined();
    expect(files[IMG_DIR_FILE(pts, 'prof.png')]).toBeUndefined(); // delete 가 이미지 파일도 지운다
    expect(ts.getFolderTemplate('A')).toBeUndefined();
    expect(ts.getApplication('proj', 'L1')).toBeUndefined();
    expect(ts.getFolderTemplate('C')).toEqual({ templateId: 'G1' });

    const r = await ts.restoreFolderTemplates(snap);
    expect(r.failed).toBe(0);
    const back = pts.get('L1')!;
    expect(back).toBeDefined();
    expect(back.folderLocal).toBe(true);
    expect(back.badgeColor).toBe('#ff00ff');
    expect(back.updatedAt).toBe(7);
    expect(back.name).toBe('폴더 템플릿');
    // 이미지는 새 파일명 — 내용은 같다
    expect(back.preset.profile).not.toBe('prof.png');
    expect(files[IMG_DIR_FILE(pts, back.preset.profile)]).toBe('B64_prof.png');
    expect(files[IMG_DIR_FILE(pts, back.vibes[0].path!)]).toBe('B64_v.png');
    expect(files[IMG_DIR_FILE(pts, back.characterPresets[0].vibes[0].path!)]).toBe('B64_cv.png');
    expect(files[IMG_DIR_FILE(pts, back.characterPresets[0].representativeImage!)]).toBe('B64_rep.png');
    expect(ts.getFolderTemplate('A')).toEqual({ templateId: 'L1' });
    expect(ts.getFolderTemplate('A/B')).toEqual({ templateId: 'G1' });
    expect(ts.getApplication('proj', 'L1')?.inherited).toBe(true);

    // 다시 불러도 중복이 생기지 않는다
    await ts.restoreFolderTemplates(snap);
    expect(pts.list().filter((t) => t.id === 'L1')).toHaveLength(1);
  });

  test('폴더가 없거나 전역 템플릿이 그사이 사라졌으면 실패 수로 알린다', async () => {
    await seedAssignments();
    const snap = await ts.snapshotFolderTemplates('A');
    await ts.removeFolder('A');
    await pts.delete('G1');
    mockFolders = ['A']; // 하위 폴더 A/B 는 다시 만들지 못한 상황
    const r = await ts.restoreFolderTemplates(snap);
    expect(r.failed).toBe(1);
    expect(ts.getFolderTemplate('A')).toEqual({ templateId: 'L1' });
    expect(ts.getFolderTemplate('A/B')).toBeUndefined();
  });

  test('지정이 없으면 빈 스냅숏', async () => {
    const snap = await ts.snapshotFolderTemplates('A');
    expect(snap).toEqual({ assignments: [], locals: [], applications: [] });
    expect(await ts.restoreFolderTemplates(snap)).toEqual({ failed: 0 });
  });
});
