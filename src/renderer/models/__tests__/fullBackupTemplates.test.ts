// 전체 백업에 씬 템플릿 지정 목록·프로젝트 템플릿 포함(2026-11-18 T1, 플랜 guides/plans/2026-11-18-scene-template-safety.md):
//  A. 순수 병합 계획(fullBackupTemplatePlan) — 최종 이름·건너뜀 불변·덮어쓰기(지정 정보 있음/없음)·퀵 생성·폴더 기본 템플릿·
//     적용 기록(채움·id 실존)·settings 모드 「비어 있을 때만」·구형 「지정만」
//  B. 서비스 — 빈 받는 쪽 복원(숨김 템플릿·프로젝트 템플릿·폴더 연결), 예전 백업 무오류, 받는 쪽 프로젝트 템플릿 보존,
//     지정 목록 막힘 = 건너뜀·디스크 무변경, 내보내기 엔트리 3종·매니페스트 version 1
// 메모리 backend 목 — 실제 사용자 데이터 폴더는 건드리지 않는다.

const files = new Map<string, string>();
const readFails = new Map<string, number>();
const writes: string[] = [];
const enoent = (p: string) =>
  new Error(`Error invoking remote method 'read-file': Error: ENOENT: no such file or directory, open '${p}'`);

const mockBackend = {
  readFile: jest.fn(async (p: string) => {
    const left = readFails.get(p) ?? 0;
    if (left > 0) {
      readFails.set(p, left - 1);
      throw new Error(`Error invoking remote method 'read-file': Error: EBUSY: resource busy or locked, open '${p}'`);
    }
    if (!files.has(p)) throw enoent(p);
    return files.get(p)!;
  }),
  existFile: jest.fn(async (p: string) => files.has(p)),
  renameFile: jest.fn(async (a: string, b: string) => {
    if (!files.has(a)) throw enoent(a);
    writes.push(b);
    files.set(b, files.get(a)!);
    files.delete(a);
  }),
  copyFile: jest.fn(async (a: string, b: string) => {
    if (!files.has(a)) throw enoent(a);
    writes.push(b);
    files.set(b, files.get(a)!);
  }),
  writeFile: jest.fn(async (p: string, d: string) => {
    files.set(p, d);
  }),
  deleteFile: jest.fn(async (p: string) => {
    files.delete(p);
  }),
  deleteDir: jest.fn(async (dir: string) => {
    for (const k of Array.from(files.keys())) if (k.startsWith(dir + '/')) files.delete(k);
  }),
  listFilesWithStats: jest.fn(async (dir: string) =>
    Array.from(files.keys())
      .filter((k) => k.startsWith(dir + '/') && !k.slice(dir.length + 1).includes('/'))
      .map((k) => ({ name: k.slice(dir.length + 1) })),
  ),
  readDataFile: jest.fn(async () => null),
  writeDataFile: jest.fn(async () => {}),
  notifyGlobalStoreChanged: jest.fn(async () => {}),
  publishExport: jest.fn(async () => {}),
};
const mockWrite = jest.fn(async (p: string, d: string) => {
  writes.push(p);
  files.set(p, d);
});

const mockProjects: string[] = [];
const mockFolders: string[] = [];
const mockSession = {
  list: () => [...mockProjects],
  listFolders: () => [...mockFolders],
  createFolder: jest.fn(async (f: string) => {
    if (!mockFolders.includes(f)) mockFolders.push(f);
  }),
  setFolderColor: jest.fn(async () => {}),
  setFolderOrder: jest.fn(async () => {}),
  getFolderColor: () => null,
  getOrderedFolders: () => [...mockFolders],
  getFolderOf: () => null,
  moveToFolder: jest.fn(async () => {}),
  importSessionDeepFromDir: jest.fn(async (_dir: string, name: string) => {
    if (mockProjects.includes(name)) throw new Error('이미 있음');
    mockProjects.push(name);
  }),
  get: jest.fn(async () => undefined),
  favorites: new Set<string>(),
};
const mockZipFiles = jest.fn(async (_e: any[], _out: string) => {});
const mockFlushGlobalStoresNow = jest.fn(async () => {});
const mockRefs: { ts?: any; pts?: any } = {};

jest.mock('..', () => ({
  backend: mockBackend,
  sessionService: mockSession,
  imageService: {},
  workFlowService: {},
  trashService: {
    permanentlyDeleteProject: jest.fn(async (name: string) => {
      await mockRefs.ts.removeProject(name);
    }),
  },
  globalPresetService: { loadFailed: true, list: () => [] },
  globalCharacterPresetService: { loadFailed: true, presets: [] },
  globalPieceService: { loadFailed: true, library: new Map() },
  zipService: { zipFiles: mockZipFiles, isZipping: false },
  get templateService() {
    return mockRefs.ts;
  },
  get projectTemplateService() {
    return mockRefs.pts;
  },
  flushGlobalStoresNow: () => mockFlushGlobalStoresNow(),
}));
jest.mock('../PersistenceService', () => ({ persistService: { write: mockWrite } }));
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
jest.mock('../projectDeleteFlow', () => ({
  deleteProjectForReplaceFlow: async (name: string) => {
    const i = mockProjects.indexOf(name);
    if (i >= 0) mockProjects.splice(i, 1);
  },
  deleteProjectForFolderFlow: async () => {},
}));
jest.mock('../projectDeleteUndo', () => ({}));
jest.mock('../presetUndo', () => ({}));
jest.mock('../projectFolderUndo', () => ({}));
jest.mock('../undoService', () => ({}));
jest.mock('../imageFormats', () => ({ imageExtFromBase64: () => 'png' }));

import {
  planFullBackupTemplates,
  fullBackupTemplateNote,
  FULL_BACKUP_TEMPLATE_TEXT,
  type FullBackupTemplatePlanInput,
} from '../fullBackupTemplatePlan';
import type { TemplatesSidecarData } from '../TemplateService';
import { TemplateService } from '../TemplateService';
import { ProjectTemplateService } from '../ProjectTemplateService';
import { BackupService } from '../BackupService';

const empty = (): TemplatesSidecarData => ({
  sceneNames: [],
  hiddenNames: [],
  quickGenName: null,
  folderTemplates: {},
  templateApplications: {},
});
const rec = (inherited = true) => ({
  inherited,
  presets: [],
  characterPresetNames: [],
  vibePaths: [],
  referencePaths: [],
});
const plan = (p: Partial<FullBackupTemplatePlanInput>) =>
  planFullBackupTemplates({
    mode: 'full',
    backup: null,
    current: empty(),
    incoming: [],
    preOverwrite: {},
    existingProjects: [],
    existingFolders: [],
    templateIds: [],
    ...p,
  });

// ---------------- A. 순수 계획 ----------------
describe('A. 병합 계획(full·noimg)', () => {
  test('최종 이름 기준 — 「T (2)」로 들어오면 「T (2)」가 숨김 씬 템플릿, 받는 쪽 T 는 그대로', () => {
    const current = { ...empty(), sceneNames: ['T'], hiddenNames: ['T'] };
    const r = plan({
      backup: { ...empty(), sceneNames: ['T'], hiddenNames: ['T'] },
      current,
      incoming: [{ origName: 'T', finalName: 'T (2)', kind: 'renamed' }],
    });
    expect(r.next.sceneNames).toEqual(['T', 'T (2)']);
    expect(r.next.hiddenNames).toEqual(['T', 'T (2)']);
    expect(r.counts.sceneTemplates).toBe(1);
  });

  test('건너뛴 프로젝트(들어오지 않음)는 받는 쪽 상태를 건드리지 않는다', () => {
    const current = { ...empty(), sceneNames: ['X'] }; // 받는 쪽 X = 지정만(일반 목록에 보임)
    const r = plan({
      backup: { ...empty(), sceneNames: ['A'], hiddenNames: ['A', 'X'] },
      current,
      incoming: [], // A·X 모두 건너뜀
    });
    expect(r.changed).toBe(false);
    expect(r.next).toEqual(current);
  });

  test('백업이 일반 프로젝트라고 하면 들어온 이름에 남은 지정·숨김을 비운다(보이게)', () => {
    const r = plan({
      backup: { ...empty(), sceneNames: ['Z'], hiddenNames: ['Z'] },
      current: { ...empty(), sceneNames: ['N'], hiddenNames: ['N'] }, // 휴지통 템플릿 이름 잔류 등
      incoming: [{ origName: 'N', finalName: 'N', kind: 'added' }],
    });
    expect(r.next.sceneNames).toEqual([]);
    expect(r.next.hiddenNames).toEqual([]);
  });

  test('덮어쓰기 + 지정 정보 있음 = 백업 상태를 따른다(씬 템플릿이면 다시 지정, 아니면 일반)', () => {
    const backup = { ...empty(), sceneNames: ['A'], hiddenNames: ['A'] };
    const r = plan({
      backup,
      incoming: [
        { origName: 'A', finalName: 'A', kind: 'overwritten' },
        { origName: 'B', finalName: 'B', kind: 'overwritten' },
      ],
      preOverwrite: {
        A: { sceneTemplate: false, hidden: false, quickGen: false },
        B: { sceneTemplate: true, hidden: true, quickGen: false },
      },
    });
    expect(r.next.sceneNames).toEqual(['A']);
    expect(r.next.hiddenNames).toEqual(['A']);
  });

  test('덮어쓰기 + 지정 정보 없음(예전 백업) = 덮어쓰기 전 받는 쪽 지정·숨김 유지, 이름 변경·추가분은 그대로', () => {
    const r = plan({
      backup: null,
      incoming: [
        { origName: 'B', finalName: 'B', kind: 'overwritten' },
        { origName: 'C', finalName: 'C (2)', kind: 'renamed' },
        { origName: 'Q', finalName: 'Q', kind: 'overwritten' },
        { origName: 'O', finalName: 'O', kind: 'overwritten' },
      ],
      preOverwrite: {
        B: { sceneTemplate: true, hidden: true, quickGen: false },
        Q: { sceneTemplate: false, hidden: true, quickGen: true },
        O: { sceneTemplate: false, hidden: true, quickGen: false }, // 숨김만(고아) — 숨기지 않는다
      },
    });
    expect(r.next.sceneNames).toEqual(['B']);
    expect(r.next.hiddenNames).toEqual(['B', 'Q']);
    expect(r.next.quickGenName).toBe('Q');
  });

  test('구형 「지정만」(숨김 없음) 상태도 그대로 옮긴다', () => {
    const r = plan({
      backup: { ...empty(), sceneNames: ['Old'] },
      incoming: [{ origName: 'Old', finalName: 'Old', kind: 'added' }],
    });
    expect(r.next.sceneNames).toEqual(['Old']);
    expect(r.next.hiddenNames).toEqual([]);
  });

  test('백업에서 숨김만 있는(지정도 퀵 생성도 아닌) 항목은 숨기지 않는다', () => {
    const r = plan({
      backup: { ...empty(), hiddenNames: ['H'] },
      incoming: [{ origName: 'H', finalName: 'H', kind: 'added' }],
    });
    expect(r.next.hiddenNames).toEqual([]);
    expect(r.changed).toBe(false);
  });

  test('퀵 생성 — 받는 쪽이 비어 있으면 최종 이름으로 지정+숨김, 이미 있으면 들어온 것은 일반 프로젝트', () => {
    const backup = { ...empty(), hiddenNames: ['퀵 생성'], quickGenName: '퀵 생성' };
    const a = plan({ backup, incoming: [{ origName: '퀵 생성', finalName: '퀵 생성 (2)', kind: 'renamed' }] });
    expect(a.next.quickGenName).toBe('퀵 생성 (2)');
    expect(a.next.hiddenNames).toEqual(['퀵 생성 (2)']);
    expect(a.counts.quickGen).toBe(true);

    const current = { ...empty(), hiddenNames: ['퀵 생성'], quickGenName: '퀵 생성' };
    const b = plan({
      backup,
      current,
      incoming: [{ origName: '퀵 생성', finalName: '퀵 생성 (2)', kind: 'renamed' }],
    });
    expect(b.next.quickGenName).toBe('퀵 생성');
    expect(b.next.hiddenNames).toEqual(['퀵 생성']); // 「퀵 생성 (2)」는 숨기지 않음(고아 금지)
    expect(b.changed).toBe(false);
  });

  test('폴더 기본 템플릿 — 받는 쪽에 있는 폴더 중 값이 없는 곳만, 템플릿 id 가 있을 때만', () => {
    const backup = {
      ...empty(),
      folderTemplates: {
        F1: { templateId: 'ok' },
        F2: { templateId: 'ok' }, // 받는 쪽에 값 있음
        F3: { templateId: 'gone' }, // id 없음
        F4: { templateId: 'ok' }, // 폴더 없음
      },
    };
    const r = plan({
      backup,
      current: { ...empty(), folderTemplates: { F2: { templateId: 'mine' } } },
      existingFolders: ['F1', 'F2', 'F3'],
      templateIds: ['ok', 'mine'],
    });
    expect(r.next.folderTemplates).toEqual({ F1: { templateId: 'ok' }, F2: { templateId: 'mine' } });
    expect(r.counts.folderTemplates).toBe(1);
  });

  test('적용 기록 — 들어온 프로젝트(최종 이름)만, 기록 없을 때만, 있는 템플릿 id 만', () => {
    const backup = {
      ...empty(),
      templateApplications: {
        P: { ok: rec(), gone: rec() },
        S: { ok: rec() }, // 건너뛴 프로젝트
        E: { ok: rec() }, // 들어왔지만 받는 쪽 기록 있음
        G: { gone: rec() }, // id 전부 없음
      },
    };
    const r = plan({
      backup,
      current: { ...empty(), templateApplications: { E: { mine: rec(false) } } },
      incoming: [
        { origName: 'P', finalName: 'P (2)', kind: 'renamed' },
        { origName: 'E', finalName: 'E', kind: 'overwritten' },
        { origName: 'G', finalName: 'G', kind: 'added' },
      ],
      templateIds: ['ok', 'mine'],
    });
    expect(Object.keys(r.next.templateApplications).sort()).toEqual(['E', 'P (2)']);
    expect(Object.keys(r.next.templateApplications['P (2)'])).toEqual(['ok']);
    expect(r.next.templateApplications.E).toEqual({ mine: rec(false) });
    expect(r.counts.applications).toBe(1);
  });
});

describe('A. 병합 계획(settings)', () => {
  const backup: TemplatesSidecarData = {
    sceneNames: ['T', 'Missing'],
    hiddenNames: ['T', 'Missing', 'Q'],
    quickGenName: 'Q',
    folderTemplates: { F: { templateId: 'ok' } },
    templateApplications: { P: { ok: rec() }, Missing: { ok: rec() } },
  };

  test('받는 쪽이 모두 비어 있으면 실제로 있는 프로젝트 이름만 지정·숨김·퀵 생성', () => {
    const r = plan({
      mode: 'settings',
      backup,
      existingProjects: ['T', 'Q', 'P'],
      existingFolders: ['F'],
      templateIds: ['ok'],
    });
    expect(r.next.sceneNames).toEqual(['T']);
    expect(r.next.hiddenNames).toEqual(['T', 'Q']);
    expect(r.next.quickGenName).toBe('Q');
    expect(r.next.folderTemplates).toEqual({ F: { templateId: 'ok' } });
    expect(Object.keys(r.next.templateApplications)).toEqual(['P']);
  });

  test('받는 쪽에 지정·숨김·퀵 생성 중 하나라도 있으면 지정은 채택하지 않는다(폴더·적용 기록 채움은 그대로)', () => {
    for (const current of [
      { ...empty(), sceneNames: ['Mine'] },
      { ...empty(), hiddenNames: ['Mine'] },
      { ...empty(), quickGenName: 'Mine' },
    ]) {
      const r = plan({
        mode: 'settings',
        backup,
        current,
        existingProjects: ['T', 'Q', 'P', 'Mine'],
        existingFolders: ['F'],
        templateIds: ['ok'],
      });
      expect(r.next.sceneNames).toEqual(current.sceneNames);
      expect(r.next.hiddenNames).toEqual(current.hiddenNames);
      expect(r.next.quickGenName).toBe(current.quickGenName);
      expect(r.next.folderTemplates).toEqual({ F: { templateId: 'ok' } });
      expect(Object.keys(r.next.templateApplications)).toEqual(['P']);
    }
  });

  test('settings 모드는 incoming 을 보지 않는다', () => {
    const r = plan({
      mode: 'settings',
      backup: { ...empty(), sceneNames: ['A'], hiddenNames: ['A'] },
      current: { ...empty(), sceneNames: ['X'] },
      incoming: [{ origName: 'A', finalName: 'A', kind: 'added' }],
      existingProjects: ['A', 'X'],
    });
    expect(r.changed).toBe(false);
  });
});

describe('A. 완료 안내 문구', () => {
  test('되살린 것이 있을 때만, 건너뜀은 따로', () => {
    expect(
      fullBackupTemplateNote({ sceneTemplates: 0, projectTemplates: 0, designationSkipped: false, projectTemplatesSkipped: false }),
    ).toEqual([]);
    expect(
      fullBackupTemplateNote({ sceneTemplates: 2, projectTemplates: 3, designationSkipped: false, projectTemplatesSkipped: false }),
    ).toEqual(['씬 템플릿 2개·프로젝트 템플릿 3개도 되살렸습니다.']);
    expect(
      fullBackupTemplateNote({ sceneTemplates: 0, projectTemplates: 1, designationSkipped: true, projectTemplatesSkipped: false }),
    ).toEqual(['프로젝트 템플릿 1개도 되살렸습니다.', FULL_BACKUP_TEMPLATE_TEXT.designationSkipped]);
  });
});

// ---------------- B. 서비스 ----------------
const R = 'tmp/r';
const S = R + '/__settings__';
const backupSidecar = JSON.stringify({
  version: 1,
  sceneTemplates: ['T'],
  hiddenSceneTemplates: ['T', '퀵 생성'],
  folderTemplates: { F: { templateId: 'idL' } },
  templateApplications: { P: { idL: rec() } },
  quickGenProject: '퀵 생성',
});
const backupTemplates = JSON.stringify({
  version: 1,
  templates: [
    {
      id: 'idL',
      name: '폴더 템플릿',
      createdAt: 1,
      updatedAt: 2,
      folderLocal: true,
      badgeColor: '#ff0000',
      preset: { name: 'p', profile: 'img1.png' },
      characterPresets: [],
      vibes: [],
      characterReferences: [],
      scenes: [],
    },
  ],
});
const manifest = {
  type: 'sdstudio-full-backup',
  version: 1,
  mode: 'full',
  projects: [
    { name: 'T', folder: null },
    { name: 'P', folder: 'F' },
    { name: '퀵 생성', folder: null },
  ],
  folders: [{ name: 'F', color: null }],
};

let ts: TemplateService;
let pts: ProjectTemplateService;
let backup: BackupService;

function seedNewBackup() {
  files.set(S + '/templates.json', backupSidecar);
  files.set(S + '/project_templates.json', backupTemplates);
  files.set(S + '/project_template_images/img1.png', 'IMG1');
}
const diskSidecar = () => JSON.parse(files.get('templates.json')!);
const lastDialogText = () => mockState.pushDialog.mock.calls.at(-1)[0].text as string;

beforeEach(() => {
  files.clear();
  readFails.clear();
  writes.length = 0;
  mockProjects.length = 0;
  mockFolders.length = 0;
  jest.clearAllMocks();
  ts = new TemplateService();
  pts = new ProjectTemplateService();
  mockRefs.ts = ts;
  mockRefs.pts = pts;
  backup = new BackupService();
  Object.assign(mockState, {
    setProgressDialog: jest.fn(),
    pushDialog: jest.fn(),
    pushMessage: jest.fn(),
    loadExportPresets: jest.fn(() => []),
    curSession: undefined,
  });
});

const restore = (m: any, mode: 'full' | 'noimg' | 'settings', policy: 'rename' | 'skip' | 'overwrite') =>
  (backup as any).restoreFullBackupFromDir(R, m, mode, policy);

describe('B. 전체 백업 복원 — 서비스', () => {
  test('새 백업 → 빈 받는 쪽: 씬 템플릿이 숨김 템플릿으로, 프로젝트 템플릿(같은 id·이미지)·폴더 기본 템플릿·적용 기록 연결', async () => {
    seedNewBackup();
    await restore(manifest, 'full', 'rename');
    expect(mockProjects).toEqual(['T', 'P', '퀵 생성']);
    const d = diskSidecar();
    expect(d.sceneTemplates).toEqual(['T']);
    expect(d.hiddenSceneTemplates).toEqual(['T', '퀵 생성']);
    expect(d.quickGenProject).toBe('퀵 생성');
    expect(d.folderTemplates).toEqual({ F: { templateId: 'idL' } });
    expect(Object.keys(d.templateApplications.P)).toEqual(['idL']);
    const pt = JSON.parse(files.get('project_templates.json')!);
    expect(pt.templates.map((t: any) => [t.id, t.folderLocal, t.badgeColor])).toEqual([['idL', true, '#ff0000']]);
    expect(files.get('project_template_images/img1.png')).toBe('IMG1');
    expect(ts.isHiddenProject('T')).toBe(true);
    expect(lastDialogText()).toContain('씬 템플릿 1개·프로젝트 템플릿 1개도 되살렸습니다.');
    // 지정 목록은 한 번만 썼다(.tmp → rename 1회)
    expect(writes.filter((w) => w === 'templates.json').length).toBe(1);
  });

  test('이름 충돌(rename) — 「T (2)」가 씬 템플릿, 받는 쪽 일반 프로젝트 T 는 보이는 그대로', async () => {
    seedNewBackup();
    mockProjects.push('T');
    await restore(manifest, 'full', 'rename');
    expect(ts.isHiddenProject('T')).toBe(false);
    expect(ts.isHiddenProject('T (2)')).toBe(true);
    expect(ts.isSceneTemplate('T (2)')).toBe(true);
  });

  test('건너뛰기 — 들어오지 않은 프로젝트의 받는 쪽 지정은 그대로', async () => {
    seedNewBackup();
    mockProjects.push('T');
    files.set('templates.json', JSON.stringify({ version: 1, sceneTemplates: [], hiddenSceneTemplates: [] }));
    await restore(manifest, 'full', 'skip');
    expect(ts.isSceneTemplate('T')).toBe(false);
    expect(ts.isHiddenProject('T')).toBe(false);
    expect(ts.isHiddenProject('퀵 생성')).toBe(true); // 이것은 들어왔다
  });

  test('새 파일이 없는 예전 백업 — 오류 없이 복원, 지정 목록·프로젝트 템플릿 파일을 만들지 않음', async () => {
    await restore(manifest, 'full', 'rename');
    expect(mockProjects).toEqual(['T', 'P', '퀵 생성']);
    expect(files.has('templates.json')).toBe(false);
    expect(files.has('project_templates.json')).toBe(false);
    expect(lastDialogText()).toBe('3/3개 프로젝트와 설정을 불러왔습니다.');
  });

  test('예전 백업 덮어쓰기 — 덮어쓰기 전 받는 쪽 씬 템플릿 지정·숨김을 유지(종전: 조용히 일반 프로젝트)', async () => {
    mockProjects.push('T');
    files.set(
      'templates.json',
      JSON.stringify({ version: 1, sceneTemplates: ['T'], hiddenSceneTemplates: ['T'] }),
    );
    await restore({ ...manifest, projects: [{ name: 'T', folder: null }] }, 'full', 'overwrite');
    expect(mockProjects).toEqual(['T']);
    expect(ts.isSceneTemplate('T')).toBe(true);
    expect(ts.isHiddenProject('T')).toBe(true);
    expect(diskSidecar().hiddenSceneTemplates).toEqual(['T']);
  });

  test('받는 쪽에 프로젝트 템플릿이 있으면 보존 — 백업 id 를 가리키는 폴더 기본 템플릿·적용 기록은 버림', async () => {
    seedNewBackup();
    const mine = JSON.parse(backupTemplates);
    mine.templates[0].id = 'mineId';
    mine.templates[0].name = '내 템플릿';
    files.set('project_templates.json', JSON.stringify(mine));
    await restore(manifest, 'full', 'rename');
    const pt = JSON.parse(files.get('project_templates.json')!);
    expect(pt.templates.map((t: any) => t.id)).toEqual(['mineId']);
    expect(files.has('project_template_images/img1.png')).toBe(false);
    const d = diskSidecar();
    expect(d.folderTemplates).toEqual({});
    expect(d.templateApplications).toEqual({});
    expect(d.sceneTemplates).toEqual(['T']); // 지정은 그대로 되살림
    expect(lastDialogText()).toContain('씬 템플릿 1개도 되살렸습니다.');
  });

  test('받는 쪽 지정 목록을 읽지 못하면(막힘) 이 부분만 건너뛰고 디스크 무변경, 프로젝트 복원은 진행', async () => {
    seedNewBackup();
    files.set('templates.json', '{"version":1,"sceneTemplates":["Keep"],"hiddenSceneTemplates":["Keep"]}');
    readFails.set('templates.json', Infinity);
    const before = files.get('templates.json');
    await restore(manifest, 'full', 'rename');
    expect(mockProjects).toEqual(['T', 'P', '퀵 생성']);
    expect(files.get('templates.json')).toBe(before);
    expect(writes.filter((w) => w.startsWith('templates.json')).length).toBe(0);
    expect(lastDialogText()).toContain(FULL_BACKUP_TEMPLATE_TEXT.designationSkipped);
  });

  test('받는 쪽 프로젝트 템플릿을 읽지 못하면 채택하지 않고 덮지 않음', async () => {
    seedNewBackup();
    files.set('project_templates.json', 'ORIGINAL');
    readFails.set('project_templates.json', Infinity);
    await restore(manifest, 'full', 'rename');
    expect(files.get('project_templates.json')).toBe('ORIGINAL');
    expect(diskSidecar().folderTemplates).toEqual({}); // id 를 확인할 수 없어 연결하지 않음
    expect(lastDialogText()).toContain(FULL_BACKUP_TEMPLATE_TEXT.projectTemplatesSkipped);
  });

  test('설정만 — 받는 쪽이 비어 있고 같은 이름 프로젝트가 있을 때만 지정', async () => {
    seedNewBackup();
    mockProjects.push('T', 'P');
    mockFolders.push('F');
    await restore({ ...manifest, mode: 'settings' }, 'settings', 'rename');
    expect(mockProjects).toEqual(['T', 'P']);
    const d = diskSidecar();
    expect(d.sceneTemplates).toEqual(['T']);
    expect(d.hiddenSceneTemplates).toEqual(['T']); // 퀵 생성 프로젝트는 받는 쪽에 없어 걸지 않음
    expect(d.quickGenProject).toBeUndefined();
    expect(d.folderTemplates).toEqual({ F: { templateId: 'idL' } });
    expect(Object.keys(d.templateApplications)).toEqual(['P']);
    expect(lastDialogText()).toContain('설정을 병합했습니다.');
  });
});

describe('B. 전체 백업 내보내기', () => {
  test('새 파일 세 종류가 __settings__/ 에 들어가고 매니페스트 version 은 1, 담기 전에 flush', async () => {
    files.set('templates.json', backupSidecar);
    files.set('project_templates.json', backupTemplates);
    files.set('project_template_images/img1.png', 'IMG1');
    files.set('global_presets.json', '{}');
    let flushedBeforeZip = false;
    mockZipFiles.mockImplementationOnce(async () => {
      flushedBeforeZip = mockFlushGlobalStoresNow.mock.calls.length > 0;
    });
    await backup.fullBackupExport('settings');
    const entries = mockZipFiles.mock.calls[0][0] as { path: string; name: string }[];
    const names = entries.map((e) => e.name);
    expect(names).toEqual(
      expect.arrayContaining([
        '__settings__/templates.json',
        '__settings__/project_templates.json',
        '__settings__/project_template_images/img1.png',
        '__settings__/global_presets.json',
      ]),
    );
    expect(entries.find((e) => e.name === '__settings__/templates.json')!.path).toBe('templates.json');
    const man = entries.find((e) => e.name === '_backup.json')!;
    const m = JSON.parse(files.get(man.path)!);
    expect(m.version).toBe(1);
    expect(m.type).toBe('sdstudio-full-backup');
    expect(flushedBeforeZip).toBe(true);
  });
});
