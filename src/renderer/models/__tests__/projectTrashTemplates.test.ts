/**
 * 씬 템플릿 지정을 휴지통 기록으로 옮기기(2026-11-18 T2, 플랜 guides/plans/2026-11-18-scene-template-safety.md 「T2 설계」).
 * 실제 SessionService.delete / restoreProjectFromTrash + 실제 TrashService + 실제 TemplateService 를 메모리 파일시스템으로 묶는다.
 *  · 삭제: templates.json 의 그 이름 몫(지정·숨김·퀵 생성·적용 기록)이 빠지고 trash.json 사이드카 `template` 에 실림
 *  · 복원: 최종 이름(새 이름 포함)으로 되살림, 퀵 생성은 비어 있을 때만, 적용 기록은 템플릿 id 실존·빈 이름일 때만
 *  · 막힘(지정 목록 읽기 실패): 삭제는 되고 지정은 종전대로 남음 / 복원은 되고 실패 안내
 *  · 예전 기록(템플릿 몫 없음) = 종전 동작, 양쪽에 남은 경우 두 번 걸지 않음, 정규화, 삭제↔복원 왕복, 폴더 스냅숏과 겹침
 * (모킹 방식은 projectTrashSidecar.test.ts 와 같다.)
 */

// ---- 메모리 파일시스템 ----
const files = new Map<string, string>();
const failWrite = new Set<string>(); // persistService.write 실패
const failRead = new Set<string>(); // backend.readFile 실패(EBUSY — 읽기 실패로 판정)

function exists(p: string): boolean {
  if (files.has(p)) return true;
  for (const k of files.keys()) if (k.startsWith(p + '/')) return true;
  return false;
}
function children(dir: string): string[] {
  const set = new Set<string>();
  for (const k of files.keys()) {
    if (k.startsWith(dir + '/')) set.add(k.slice(dir.length + 1).split('/')[0]);
  }
  return Array.from(set);
}

const mockRefs: { trash: any; ts: any; svc: any } = { trash: undefined, ts: undefined, svc: undefined };
const mockTemplateIds = new Set<string>();
const mockPts = {
  loadFailed: false,
  ensureLoaded: jest.fn(async () => {}),
  get: (id: string) => (mockTemplateIds.has(id) ? { id } : undefined),
  restoreEntry: jest.fn(async () => {}),
};

jest.mock('..', () => ({
  backend: {
    existFile: jest.fn(async (p: string) => exists(p)),
    readFile: jest.fn(async (p: string) => {
      if (failRead.has(p)) {
        throw new Error(`Error invoking remote method 'read-file': Error: EBUSY: resource busy or locked, open '${p}'`);
      }
      if (!files.has(p)) {
        throw new Error(`Error invoking remote method 'read-file': Error: ENOENT: no such file or directory, open '${p}'`);
      }
      return files.get(p)!;
    }),
    writeFile: jest.fn(async (p: string, c: string) => {
      files.set(p, c);
    }),
    copyFile: jest.fn(async (a: string, b: string) => {
      if (!files.has(a)) throw new Error('ENOENT ' + a);
      files.set(b, files.get(a)!);
    }),
    listFiles: jest.fn(async (dir: string) => children(dir)),
    listFilesWithStats: jest.fn(async (dir: string) =>
      children(dir)
        .filter((n) => files.has(dir + '/' + n))
        .map((name) => ({ name })),
    ),
    renameFile: jest.fn(async (a: string, b: string) => {
      if (!files.has(a)) throw new Error('ENOENT ' + a);
      files.set(b, files.get(a)!);
      files.delete(a);
    }),
    deleteFile: jest.fn(async (p: string) => {
      if (!files.has(p)) throw new Error('ENOENT ' + p);
      files.delete(p);
    }),
    deleteDir: jest.fn(async (p: string) => {
      for (const k of Array.from(files.keys())) {
        if (k === p || k.startsWith(p + '/')) files.delete(k);
      }
    }),
    notifyGlobalStoreChanged: jest.fn(async () => {}),
  },
  imageService: { invalidateCacheBatch: jest.fn(async () => {}) },
  workFlowService: {},
  zipService: {},
  get templateService() {
    return mockRefs.ts;
  },
  get projectTemplateService() {
    return mockPts;
  },
  taskQueueService: { addLog: jest.fn() },
  get trashService() {
    return mockRefs.trash;
  },
  get sessionService() {
    return mockRefs.svc;
  },
}));
jest.mock('../PersistenceService', () => ({
  persistService: {
    write: jest.fn(async (p: string, c: string) => {
      if (failWrite.has(p)) throw new Error('EIO ' + p);
      files.set(p, c);
    }),
    flushPath: jest.fn(async () => {}),
  },
}));
jest.mock('../AppService', () => ({
  appState: { storageWriteGuard: true, pushMessage: jest.fn() },
}));
jest.mock('../appStateRef', () => ({
  getAppState: () => require('../AppService').appState,
}));

import { SessionService } from '../SessionService';
import { ResourceSyncService } from '../ResourceSyncService';
import { TrashService, normalizeProjectSidecar } from '../TrashService';
import { TemplateService } from '../TemplateService';
import { normalizeProjectTemplatePart, sanitizeProjectApplications } from '../templateTrashPart';
import { backend } from '..';
import {
  physicalDirOf,
  registerProjectDir,
  unregisterProjectDir,
  setWorkspaceLayoutActive,
} from '../storageLayout';
import { DELETE_RESULT_TEXT, projectRestoreResultText } from '../deleteFlowRules';

const A = 'T__aaaaaaaa';
const B = 'T__bbbbbbbb';
const TF = 'templates.json';
const meta = (name: string, id: string) => JSON.stringify({ version: 1, id, name, folder: '' });
const trashJson = () => JSON.parse(files.get('trash.json') || '{"scenes":{},"projects":{}}');
const tplJson = () => JSON.parse(files.get(TF)!);
const rec = (inherited = true) => ({
  inherited,
  presets: [{ type: 'diffusion', name: 'p' }],
  characterPresetNames: [],
  vibePaths: [],
  referencePaths: [],
});
function seedTemplates(d: {
  scene?: string[];
  hidden?: string[];
  quick?: string;
  apps?: Record<string, Record<string, any>>;
}) {
  files.set(
    TF,
    JSON.stringify({
      version: 1,
      sceneTemplates: d.scene ?? [],
      hiddenSceneTemplates: d.hidden ?? [],
      folderTemplates: {},
      templateApplications: d.apps ?? {},
      quickGenProject: d.quick,
    }),
  );
}

let deleteSpy: jest.SpyInstance;
let services: any[] = [];

async function setup(): Promise<{ svc: any; trash: TrashService; ts: TemplateService }> {
  const trash = new TrashService();
  await trash.loadTrash();
  mockRefs.trash = trash;
  const ts = new TemplateService();
  mockRefs.ts = ts;
  const svc = new SessionService() as any;
  mockRefs.svc = svc;
  services.push(svc);
  svc.guardCrossWindowLock = jest.fn(async () => true);
  svc.isLoaded = jest.fn(() => true);
  svc.update = jest.fn(async () => {});
  svc.favorites = new Set<string>();
  svc.bookmarkData = { scenes: {}, images: {} };
  svc.thumbnailData = {};
  return { svc, trash, ts };
}

let warnSpy: jest.SpyInstance;
let errSpy: jest.SpyInstance;
beforeEach(() => {
  files.clear();
  failWrite.clear();
  failRead.clear();
  mockTemplateIds.clear();
  mockPts.loadFailed = false;
  setWorkspaceLayoutActive(false);
  for (const n of ['T', 'T (2)', 'Q', 'R']) unregisterProjectDir(n);
  deleteSpy = jest
    .spyOn(ResourceSyncService.prototype, 'delete')
    .mockImplementation(async function (this: any, name: string) {
      const dir = physicalDirOf(name);
      const src = dir ? `workspace/${dir}/project.json` : `projects/${name}.json`;
      const dst = dir ? `workspace/${dir}/project.json.deleted` : `projects/${name}.deleted`;
      await (backend as any).renameFile(src, dst);
    });
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  deleteSpy.mockRestore();
  warnSpy.mockRestore();
  errSpy.mockRestore();
  for (const s of services) if (s.thumbnailSaveTimer) clearTimeout(s.thumbnailSaveTimer);
  services = [];
});
afterAll(() => setWorkspaceLayoutActive(false));

describe('삭제 — templates.json 에서 휴지통 기록으로', () => {
  test('씬 템플릿: 지정·숨김·적용 기록이 빠지고 휴지통 기록에 실림(다른 이름은 그대로)', async () => {
    files.set('projects/T.json', '{}');
    seedTemplates({
      scene: ['T', 'R'],
      hidden: ['T', 'R'],
      apps: { T: { tplA: rec() }, R: { tplA: rec(false) } },
    });
    const { svc, ts } = await setup();
    await svc.delete('T');

    const t = tplJson();
    expect(t.sceneTemplates).toEqual(['R']);
    expect(t.hiddenSceneTemplates).toEqual(['R']);
    expect(t.templateApplications).toEqual({ R: { tplA: rec(false) } });
    expect(trashJson().projects.T.sidecar).toEqual({
      favorite: false,
      template: { sceneTemplate: true, hidden: true, applications: { tplA: rec() } },
    });
    // 같은 이름으로 새 프로젝트를 만들어도 숨겨지지 않고 옛 기록을 물려받지 않는다
    expect(ts.isHiddenProject('T')).toBe(false);
    expect(ts.isSceneTemplate('T')).toBe(false);
    expect(ts.getApplication('T', 'tplA')).toBeUndefined();
  });

  test('일반 프로젝트는 템플릿 몫을 만들지 않는다(예전 형식 그대로)', async () => {
    files.set('projects/P.json', '{}');
    seedTemplates({ scene: ['R'], hidden: ['R'] });
    const { svc } = await setup();
    const before = files.get(TF);
    await svc.delete('P');
    expect(Object.keys(trashJson().projects.P)).toEqual(['deletedAt']);
    expect(files.get(TF)).toBe(before);
  });

  test('지정 목록이 막혀 있으면: 삭제는 되고 지정은 종전대로 남고 스냅숏에 템플릿 몫 없음', async () => {
    files.set('projects/T.json', '{}');
    seedTemplates({ scene: ['T'], hidden: ['T'], apps: { T: { tplA: rec() } } });
    failRead.add(TF);
    const { svc } = await setup();
    const before = files.get(TF);
    await svc.delete('T');
    expect(files.has('projects/T.deleted')).toBe(true);
    expect(files.get(TF)).toBe(before);
    expect(trashJson().projects.T.sidecar).toBeUndefined();
  });

  test('휴지통 기록 저장(trash.json)이 실패하면 지정을 빼지 않는다', async () => {
    files.set('projects/T.json', '{}');
    seedTemplates({ scene: ['T'], hidden: ['T'] });
    const { svc, ts } = await setup();
    failWrite.add('trash.json');
    await expect(svc.delete('T')).rejects.toThrow('EIO');
    expect(ts.isHiddenProject('T')).toBe(true);
    expect(tplJson().sceneTemplates).toEqual(['T']);
  });

  test('퀵 생성 프로젝트: 지정이 풀리고 숨김도 빠짐', async () => {
    files.set('projects/Q.json', '{}');
    seedTemplates({ hidden: ['Q'], quick: 'Q' });
    const { svc, ts } = await setup();
    await svc.delete('Q');
    expect(ts.quickGenName).toBeNull();
    expect(tplJson().quickGenProject).toBeUndefined();
    expect(tplJson().hiddenSceneTemplates).toEqual([]);
    expect(trashJson().projects.Q.sidecar.template).toEqual({ quickGen: true, hidden: true });
  });
});

describe('복원 — 최종 이름으로 되살림', () => {
  test('같은 이름 복원 → 다시 숨김 템플릿 + 적용 기록(템플릿 id 실존)', async () => {
    files.set('projects/T.json', '{}');
    seedTemplates({ scene: ['T'], hidden: ['T'], apps: { T: { tplA: rec(), gone: rec() } } });
    mockTemplateIds.add('tplA');
    const { svc, ts } = await setup();
    await svc.delete('T');
    const r = await svc.restoreProjectFromTrash('T');
    expect(r.sidecarRestored).toBe(true);
    expect(r.sidecarFailed).toEqual([]);
    expect(ts.isSceneTemplate('T')).toBe(true);
    expect(ts.isHiddenProject('T')).toBe(true);
    const t = tplJson();
    expect(t.sceneTemplates).toEqual(['T']);
    expect(t.hiddenSceneTemplates).toEqual(['T']);
    expect(t.templateApplications).toEqual({ T: { tplA: rec() } }); // 없는 id(gone)는 넣지 않음
    expect(trashJson().projects.T).toBeUndefined();
  });

  test('신 배치 새 이름 복원 → 새 이름이 숨김 템플릿, 같은 이름의 새 프로젝트는 일반 프로젝트', async () => {
    setWorkspaceLayoutActive(true);
    files.set(`workspace/${A}/meta.json`, meta('T', 'a'));
    files.set(`workspace/${A}/project.json`, '{}');
    registerProjectDir('T', A);
    seedTemplates({ scene: ['T'], hidden: ['T'], apps: { T: { tplA: rec() } } });
    mockTemplateIds.add('tplA');
    const { svc, ts } = await setup();
    await svc.delete('T');
    // 같은 이름 T 를 새로 만든 상태
    files.set(`workspace/${B}/meta.json`, meta('T', 'b'));
    files.set(`workspace/${B}/project.json`, '{}');
    registerProjectDir('T', B);
    expect(ts.isHiddenProject('T')).toBe(false);

    const r = await svc.restoreProjectFromTrash('T', { dir: A, newName: 'T (2)' });
    expect(r.name).toBe('T (2)');
    expect(r.sidecarFailed).toEqual([]);
    expect(ts.isSceneTemplate('T (2)')).toBe(true);
    expect(ts.isHiddenProject('T (2)')).toBe(true);
    expect(ts.getApplication('T (2)', 'tplA')).toEqual(rec());
    expect(ts.isHiddenProject('T')).toBe(false);
    expect(ts.getApplication('T', 'tplA')).toBeUndefined();
    expect(tplJson().sceneTemplates).toEqual(['T (2)']);
  });

  test('지정만 있고 숨김이 없던 구형 씬 템플릿은 지정만 되살린다', async () => {
    files.set('projects/T.json', '{}');
    seedTemplates({ scene: ['T'] });
    const { svc, ts } = await setup();
    await svc.delete('T');
    expect(trashJson().projects.T.sidecar.template).toEqual({ sceneTemplate: true });
    await svc.restoreProjectFromTrash('T');
    expect(ts.isSceneTemplate('T')).toBe(true);
    expect(ts.isHiddenProject('T')).toBe(false);
  });

  test('퀵 생성: 지정이 비어 있으면 다시 지정·숨김, 이미 있으면 일반 프로젝트', async () => {
    files.set('projects/Q.json', '{}');
    seedTemplates({ hidden: ['Q'], quick: 'Q' });
    const { svc, ts } = await setup();
    await svc.delete('Q');
    await svc.restoreProjectFromTrash('Q');
    expect(ts.quickGenName).toBe('Q');
    expect(ts.isHiddenProject('Q')).toBe(true);
    expect(tplJson().quickGenProject).toBe('Q');

    // 다시 지우고, 그 사이 새 퀵 생성 프로젝트가 지정된 상태에서 복원
    await svc.delete('Q');
    (ts as any).quickGenName = '퀵 생성';
    (ts as any).hiddenNames = ['퀵 생성'];
    const r = await svc.restoreProjectFromTrash('Q');
    expect(r.sidecarFailed).toEqual([]);
    expect(ts.quickGenName).toBe('퀵 생성');
    expect(ts.isHiddenProject('Q')).toBe(false); // 숨김 고아를 만들지 않음
  });

  test('지정 목록이 막힌 상태의 복원 → 프로젝트는 복원되고 실패 안내', async () => {
    files.set('projects/T.json', '{}');
    seedTemplates({ scene: ['T'], hidden: ['T'] });
    const first = await setup();
    await first.svc.delete('T');
    // 다른 실행(새 인스턴스)에서 지정 목록을 읽지 못하는 상태
    const ts2 = new TemplateService();
    mockRefs.ts = ts2;
    failRead.add(TF);
    const r = await first.svc.restoreProjectFromTrash('T');
    expect(files.has('projects/T.json')).toBe(true);
    expect(r.sidecarRestored).toBe(true);
    expect(r.sidecarFailed).toEqual(['template']);
    expect(ts2.isHiddenProject('T')).toBe(false);
    expect(projectRestoreResultText('T', undefined, r.sidecarFailed)).toBe(
      `${DELETE_RESULT_TEXT.projectRestored('T')} ${DELETE_RESULT_TEXT.projectTemplateRestoreFailed}`,
    );
  }, 15000);

  test('예전 휴지통 기록(템플릿 몫 없음) 복원 = 종전 동작(templates.json 의 지정 그대로)', async () => {
    files.set('projects/T.deleted', '{}');
    files.set('trash.json', JSON.stringify({ scenes: {}, projects: { T: { deletedAt: 5 } } }));
    seedTemplates({ scene: ['T'], hidden: ['T'] });
    const { svc, ts } = await setup();
    const before = files.get(TF);
    const r = await svc.restoreProjectFromTrash('T');
    expect(r.sidecarRestored).toBe(false);
    await ts.ensureLoaded(); // 복원은 지정 목록을 건드리지 않았다(지연 로드)
    expect(ts.isHiddenProject('T')).toBe(true);
    expect(files.get(TF)).toBe(before);
  });

  test('빼기 저장 실패 뒤 앱이 끝나 양쪽에 남아도 복원은 지정을 두 번 걸지 않는다', async () => {
    files.set('projects/T.json', '{}');
    seedTemplates({ scene: ['T'], hidden: ['T'], apps: { T: { tplA: rec() } } });
    mockTemplateIds.add('tplA');
    const { svc } = await setup();
    failWrite.add(TF);
    failWrite.add(TF + '.tmp');
    await svc.delete('T'); // 삭제는 성공(빼기 저장 실패는 기록만)
    expect(trashJson().projects.T.sidecar.template.sceneTemplate).toBe(true);
    expect(tplJson().sceneTemplates).toEqual(['T']); // 디스크에는 남음
    // 다시 실행: 새 인스턴스가 디스크(지정 있음)를 읽는다
    failWrite.clear();
    const ts2 = new TemplateService();
    mockRefs.ts = ts2;
    const r = await svc.restoreProjectFromTrash('T');
    expect(r.sidecarFailed).toEqual([]);
    expect(ts2.sceneNames).toEqual(['T']);
    expect(ts2.hiddenNames).toEqual(['T']);
    expect(Object.keys(ts2.templateApplications)).toEqual(['T']);
    expect(tplJson().sceneTemplates).toEqual(['T']);
  });

  test('삭제 ↔ 복원 왕복(되돌리기·다시 실행이 쓰는 관문)에서 매번 숨김 템플릿', async () => {
    files.set('projects/T.json', '{}');
    seedTemplates({ scene: ['T'], hidden: ['T'] });
    const { svc, ts } = await setup();
    for (let i = 0; i < 2; i++) {
      await svc.delete('T');
      expect(ts.isHiddenProject('T')).toBe(false);
      expect(tplJson().sceneTemplates).toEqual([]);
      await svc.restoreProjectFromTrash('T');
      expect(ts.isHiddenProject('T')).toBe(true);
      expect(tplJson().sceneTemplates).toEqual(['T']);
    }
  });

  test('폴더 삭제 되돌리기의 템플릿 스냅숏과 적용 기록이 겹쳐도 한 번만(먼저 넣은 기록 유지)', async () => {
    files.set('projects/T.json', '{}');
    seedTemplates({ apps: { T: { loc: rec() } } });
    mockTemplateIds.add('loc');
    const { svc, ts } = await setup();
    await svc.delete('T');
    await svc.restoreProjectFromTrash('T');
    expect(ts.getApplication('T', 'loc')).toEqual(rec());
    svc.listFolders = () => [];
    await ts.restoreFolderTemplates({
      assignments: [{ folder: 'F', templateId: 'loc' }],
      locals: [],
      applications: [{ project: 'T', templateId: 'loc', record: rec(false) }],
    });
    expect(tplJson().templateApplications).toEqual({ T: { loc: rec() } });
  });
});

describe('정규화', () => {
  test('템플릿 몫만 있는 스냅숏도 버리지 않는다 / 손상·알 수 없는 값은 버린다', () => {
    expect(normalizeProjectSidecar({ favorite: false, template: { sceneTemplate: true } })).toEqual({
      favorite: false,
      template: { sceneTemplate: true },
    });
    expect(normalizeProjectSidecar({ favorite: false, template: { sceneTemplate: 'yes', hidden: true } })).toBeUndefined();
    expect(normalizeProjectSidecar({ template: 'x' })).toBeUndefined();
    expect(normalizeProjectTemplatePart({ hidden: true })).toBeUndefined(); // 지정 없는 숨김 금지
    expect(normalizeProjectTemplatePart([true])).toBeUndefined();
    expect(
      normalizeProjectTemplatePart({
        sceneTemplate: true,
        hidden: true,
        quickGen: 1,
        extra: 'z',
        applications: { a: { inherited: 1, presets: [{ type: 'd', name: 'n' }, 3], protectAreas: ['scenes', 'x'] }, b: 7 },
      }),
    ).toEqual({
      sceneTemplate: true,
      hidden: true,
      applications: {
        a: {
          protectAreas: ['scenes'],
          inherited: true,
          presets: [{ type: 'd', name: 'n' }],
          characterPresetNames: [],
          vibePaths: [],
          referencePaths: [],
        },
      },
    });
    expect(normalizeProjectTemplatePart({ applications: [rec()] })).toBeUndefined();
    expect(sanitizeProjectApplications(null)).toEqual({});
  });

  test('복원 결과 문구: 항목 배열(즐겨찾기·북마크 / 템플릿)과 종전 boolean', () => {
    const base = DELETE_RESULT_TEXT.projectRestored('P');
    expect(projectRestoreResultText('P', undefined, [])).toBe(base);
    expect(projectRestoreResultText('P', undefined, ['bookmark', 'template'])).toBe(
      `${base} ${DELETE_RESULT_TEXT.projectSidecarRestoreFailed} ${DELETE_RESULT_TEXT.projectTemplateRestoreFailed}`,
    );
    expect(projectRestoreResultText('P', undefined, true)).toBe(
      `${base} ${DELETE_RESULT_TEXT.projectSidecarRestoreFailed}`,
    );
  });
});
