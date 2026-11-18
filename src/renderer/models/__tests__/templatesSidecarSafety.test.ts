// 씬 템플릿 지정 목록(templates.json) 안전 보강(2026-11-18 T3·T5, 플랜 guides/plans/2026-11-18-scene-template-safety.md):
//  T3 — StoreFile 로 로드·저장(형식 불변·즉시 저장·사본 회전·「없음」 뒤 쓰기 충돌 차단·저장 실패 뒤 flush 재시도·reloadIfFailed)
//  T5 — 만들기 전 확인·구조 어긋남 = 손상 경로·고아 숨김 자동 해제
// 메모리 backend 목 — 실제 사용자 데이터 폴더는 건드리지 않는다.

const files = new Map<string, string>();
const readFails = new Map<string, number>();
const ops: string[] = [];
let writeFailPaths = new Set<string>();

const enoent = (p: string) =>
  new Error(`Error invoking remote method 'read-file': Error: ENOENT: no such file or directory, open '${p}'`);

const backend = {
  readFile: jest.fn(async (p: string) => {
    const left = readFails.get(p) ?? 0;
    if (left > 0) {
      readFails.set(p, left - 1);
      throw new Error(`Error invoking remote method 'read-file': Error: EBUSY: resource busy or locked, open '${p}'`);
    }
    if (!files.has(p)) throw enoent(p);
    return files.get(p)!;
  }),
  renameFile: jest.fn(async (a: string, b: string) => {
    ops.push(`rename ${a} -> ${b}`);
    if (!files.has(a)) throw enoent(a);
    files.set(b, files.get(a)!);
    files.delete(a);
  }),
  copyFile: jest.fn(async (a: string, b: string) => {
    ops.push(`copy ${a} -> ${b}`);
    if (!files.has(a)) throw enoent(a);
    files.set(b, files.get(a)!);
  }),
  existFile: jest.fn(async (p: string) => files.has(p)),
};
const write = jest.fn(async (p: string, d: string) => {
  if (writeFailPaths.has(p)) {
    ops.push(`write-fail ${p}`);
    throw new Error(`EACCES: permission denied, open '${p}'`);
  }
  ops.push(`write ${p}`);
  files.set(p, d);
});

const mockProjects: string[] = [];
const sessionService = {
  list: () => [...mockProjects],
  listFolders: () => [] as string[],
  add: jest.fn(async (name: string) => {
    mockProjects.push(name);
  }),
  get: jest.fn(async (name: string) => (mockProjects.includes(name) ? { name } : null)),
  exportSessionShallow: jest.fn(async () => ({})),
  importSessionShallow: jest.fn(async (_json: any, name: string) => {
    mockProjects.push(name);
  }),
};

jest.mock('..', () => ({
  backend,
  sessionService,
  trashService: {},
  projectTemplateService: {
    ensureLoaded: async () => {},
    get: () => undefined,
    delete: async () => {},
  },
}));
jest.mock('../PersistenceService', () => ({ persistService: { write } }));

const pushMessage = jest.fn();
jest.mock('../appStateRef', () => ({
  getAppState: () => ({ pushMessage, curSession: null }),
}));
const promptName = jest.fn(async () => '새 템플릿');
jest.mock('../nameInput', () => ({
  promptName: (...a: any[]) => (promptName as any)(...a),
  projectNameRules: () => ({}),
  nameErrorMessage: (_e: any, _k: any, _n: any, fallback: string) => fallback,
}));

import {
  TemplateService,
  TEMPLATE_STORE_TEXT,
  parseTemplatesSidecar,
} from '../TemplateService';
import { subscribeGlobalStoreNotices, GlobalStoreNotice } from '../storeFile';

const F = 'templates.json';
const notices: GlobalStoreNotice[] = [];
subscribeGlobalStoreNotices((n) => notices.push(n));

// 종전 TemplateService.save 와 같은 직렬화(필드 순서 포함)
const legacySerialize = (d: {
  sceneTemplates: string[];
  hiddenSceneTemplates: string[];
  folderTemplates: any;
  templateApplications: any;
  quickGenProject?: string | null;
}) =>
  JSON.stringify({
    version: 1,
    sceneTemplates: d.sceneTemplates,
    hiddenSceneTemplates: d.hiddenSceneTemplates,
    folderTemplates: d.folderTemplates,
    templateApplications: d.templateApplications,
    quickGenProject: d.quickGenProject ?? undefined,
  });

const sample = legacySerialize({
  sceneTemplates: ['T1'],
  hiddenSceneTemplates: ['T1'],
  folderTemplates: { 폴더: { templateId: 'tplA' } },
  templateApplications: {},
});
const mainWrites = () => ops.filter((o) => o === `rename ${F}.tmp -> ${F}` || o === `write ${F}`).length;

beforeEach(() => {
  files.clear();
  readFails.clear();
  ops.length = 0;
  notices.length = 0;
  writeFailPaths = new Set();
  mockProjects.length = 0;
  jest.clearAllMocks();
});

describe('T3 로드 판정 — 메모리 상태와 디스크', () => {
  test('없음 → 빈 목록, 아무것도 쓰지 않음, 첫 저장은 사본 없이 본 파일 생성', async () => {
    const svc = new TemplateService();
    await svc.ensureLoaded();
    expect(svc.sceneNames).toEqual([]);
    expect(svc.loadFailed).toBe(false);
    expect(ops).toEqual([]);
    await svc.setFolderTemplate('A', 'tplA');
    expect(JSON.parse(files.get(F)!).folderTemplates).toEqual({ A: { templateId: 'tplA' } });
    expect(files.has(F + '.bak1')).toBe(false);
  });

  test('정상 → 메모리 반영, 첫 저장 직전 .bak1 = 읽은 원문, 직렬화 형식이 종전과 같음', async () => {
    files.set(F, sample);
    const svc = new TemplateService();
    await svc.ensureLoaded();
    expect(svc.sceneNames).toEqual(['T1']);
    expect(svc.isHiddenProject('T1')).toBe(true);
    expect(ops).toEqual([]); // 읽기만으로는 쓰지 않음
    await svc.setFolderTemplate('B', 'tplB');
    expect(files.get(F + '.bak1')).toBe(sample);
    expect(files.get(F)).toBe(
      legacySerialize({
        sceneTemplates: ['T1'],
        hiddenSceneTemplates: ['T1'],
        folderTemplates: { 폴더: { templateId: 'tplA' }, B: { templateId: 'tplB' } },
        templateApplications: {},
      }),
    );
    // 두 번째 저장은 회전하지 않는다
    await svc.clearFolderTemplate('B');
    expect(ops.filter((o) => o.startsWith(`write ${F}.bak1`)).length).toBe(1);
    expect(JSON.parse(files.get(F)!)).not.toHaveProperty('quickGenProject');
  });

  test('읽기 실패 지속 → 차단(안내 창 1회)·디스크 무변경, 변경·연쇄 메서드는 던지지 않고 쓰지도 않음, reloadIfFailed 로 해제', async () => {
    files.set(F, sample);
    readFails.set(F, Infinity);
    const svc = new TemplateService();
    await svc.ensureLoaded();
    expect(svc.loadFailed).toBe(true);
    expect(svc.listUnavailable).toBe(true);
    expect(notices.filter((n) => n.type === 'load-failed')).toHaveLength(1);
    // 막힌 동안 ensureLoaded 는 다시 읽지 않는다(재시도 지연 방지)
    const reads = backend.readFile.mock.calls.length;
    await svc.ensureLoaded();
    expect(backend.readFile.mock.calls.length).toBe(reads);
    // 변경 메서드: 던지지 않음 + 쓰지 않음 + 차단 토스트(3초 간격이라 1회)
    await expect(svc.setFolderTemplate('A', 'x')).resolves.toBeUndefined();
    await expect(svc.renameProject('T1', 'T2')).resolves.toBeUndefined();
    await expect(svc.removeProject('T1')).resolves.toBeUndefined();
    await expect(svc.renameFolder('a', 'b')).resolves.toBeUndefined();
    await expect(svc.removeFolder('a')).resolves.toBeUndefined();
    await expect(svc.recordApplication('P', 't', {
      inherited: false, presets: [], characterPresetNames: [], vibePaths: [], referencePaths: [],
    })).resolves.toBeUndefined();
    expect(notices.filter((n) => n.type === 'write-blocked').length).toBeGreaterThanOrEqual(1);
    await svc.flushSave();
    expect(write).not.toHaveBeenCalled();
    expect(files.get(F)).toBe(sample);
    // 다시 읽기 성공 → 차단 해제·목록 복원
    readFails.clear();
    await svc.reloadIfFailed();
    expect(svc.loadFailed).toBe(false);
    expect(svc.listUnavailable).toBe(false);
    expect(svc.sceneNames).toEqual(['T1']);
  }, 15000);

  test('손상(JSON 아님)·사본 없음 → 손상본 보존, 빈 목록, 안내, 본 파일은 쓰지 않음', async () => {
    files.set(F, '{"sceneTemplates":');
    const svc = new TemplateService();
    await svc.ensureLoaded();
    expect(svc.sceneNames).toEqual([]);
    expect(svc.loadFailed).toBe(false);
    expect(notices.map((n) => n.type)).toEqual(['corrupt-empty']);
    expect(files.has(F)).toBe(false);
    expect([...files.keys()].some((k) => k.startsWith(F + '.corrupt-'))).toBe(true);
    expect(write).not.toHaveBeenCalled();
  });

  test('구조 어긋남(있는 필드의 형식이 다름) → 손상 경로: 보존 → .bak1 복구 → 본 파일에 되돌려 씀', async () => {
    const bad = JSON.stringify({ version: 1, sceneTemplates: 'T1', hiddenSceneTemplates: ['T1'] });
    files.set(F, bad);
    files.set(F + '.bak1', sample);
    const svc = new TemplateService();
    await svc.ensureLoaded();
    expect(svc.sceneNames).toEqual(['T1']);
    expect(notices.map((n) => n.type)).toEqual(['recovered']);
    expect(files.get(F)).toBe(sample);
    const corrupt = [...files.keys()].find((k) => k.startsWith(F + '.corrupt-'));
    expect(corrupt && files.get(corrupt)).toBe(bad);
    // 되살린 직후 다시 쓰는 일은 StoreFile 의 한 번뿐(종전 서비스의 중복 save 제거)
    expect(mainWrites()).toBe(1);
  });

  test('parseTemplatesSidecar: 필드 없음/null = 정상, 형식이 다른 필드 = null, 항목 단위 거르기는 종전대로', () => {
    expect(parseTemplatesSidecar('{"version":1}')).toEqual({
      sceneNames: [], hiddenNames: [], quickGenName: null, folderTemplates: {}, templateApplications: {},
    });
    expect(parseTemplatesSidecar('{"sceneTemplates":null,"quickGenProject":null}')).not.toBeNull();
    expect(parseTemplatesSidecar('[]')).toBeNull();
    expect(parseTemplatesSidecar('{"hiddenSceneTemplates":{}}')).toBeNull();
    expect(parseTemplatesSidecar('{"quickGenProject":3}')).toBeNull();
    expect(parseTemplatesSidecar('{"folderTemplates":[]}')).toBeNull();
    expect(parseTemplatesSidecar('{"templateApplications":"x"}')).toBeNull();
    const d = parseTemplatesSidecar(
      JSON.stringify({ sceneTemplates: ['a', 1, null], folderTemplates: { ok: { templateId: 't' }, bad: 'x' }, quickGenProject: '' }),
    )!;
    expect(d.sceneNames).toEqual(['a']);
    expect(Object.keys(d.folderTemplates)).toEqual(['ok']);
    expect(d.quickGenName).toBeNull();
  });
});

describe('T3 저장', () => {
  test('「없음」으로 시작했는데 첫 저장 때 파일이 생겨 있으면 덮지 않고 차단(쓰기 충돌 안내)', async () => {
    const svc = new TemplateService();
    await svc.ensureLoaded();
    files.set(F, sample); // 다른 창이 만들었거나 「없음」 오판
    await expect(svc.setFolderTemplate('A', 'x')).resolves.toBeUndefined(); // 던지지 않음
    expect(files.get(F)).toBe(sample);
    expect(notices.map((n) => n.type)).toContain('write-conflict');
    expect(svc.loadFailed).toBe(true);
    expect(svc.listUnavailable).toBe(true);
  });

  test('저장 실패 → 호출부로 던짐(종전 계약)·dirty 유지 → flushSave 가 다시 써서 맞춤, 무변경 flush 는 쓰지 않음', async () => {
    files.set(F, sample);
    const svc = new TemplateService();
    await svc.ensureLoaded();
    writeFailPaths = new Set([F, F + '.tmp']);
    await expect(svc.setFolderTemplate('A', 'x')).rejects.toThrow('EACCES');
    expect(files.get(F)).toBe(sample);
    writeFailPaths = new Set();
    await svc.flushSave();
    expect(JSON.parse(files.get(F)!).folderTemplates.A).toEqual({ templateId: 'x' });
    const before = ops.length;
    await svc.flushSave();
    expect(ops.length).toBe(before);
  });

  test('동시에 여러 곳이 ensureLoaded 를 불러도 한 번만 읽는다', async () => {
    files.set(F, sample);
    const svc = new TemplateService();
    await Promise.all([svc.ensureLoaded(), svc.ensureLoaded(), svc.ensureLoaded()]);
    expect(backend.readFile.mock.calls.filter((c) => c[0] === F)).toHaveLength(1);
  });
});

describe('T5 만들기 전에 확인', () => {
  test('읽기 실패 상태에서 createSceneTemplate·createEmptySceneTemplate·importSceneTemplateFile 은 프로젝트를 만들지 않는다', async () => {
    files.set(F, sample);
    readFails.set(F, Infinity);
    const svc = new TemplateService();
    await svc.ensureLoaded();
    await svc.createSceneTemplate({ name: '원본' } as any);
    expect(await svc.createEmptySceneTemplate()).toBeNull();
    const file = JSON.stringify({ type: 'sdstudio-scene-template', name: 'X', session: {} });
    expect(await svc.importSceneTemplateFile(file)).toBeNull();
    expect(promptName).not.toHaveBeenCalled();
    expect(sessionService.importSessionShallow).not.toHaveBeenCalled();
    expect(sessionService.add).not.toHaveBeenCalled();
    expect(pushMessage.mock.calls.some((c) => String(c[0]).includes('만들어졌습니다'))).toBe(false);
    expect(notices.some((n) => n.type === 'write-blocked')).toBe(true);
    expect(write).not.toHaveBeenCalled();
  }, 15000);

  const other = legacySerialize({
    sceneTemplates: ['T1'], hiddenSceneTemplates: ['T1'], folderTemplates: {}, templateApplications: {},
  });

  test('「없음」 뒤 파일이 생긴 상태: createSceneTemplate 이 만들기 전에 쓰기 충돌로 막는다', async () => {
    const svc = new TemplateService();
    await svc.ensureLoaded();
    files.set(F, other);
    await svc.createSceneTemplate({ name: '원본' } as any);
    expect(promptName).not.toHaveBeenCalled();
    expect(sessionService.importSessionShallow).not.toHaveBeenCalled();
    expect(notices.map((n) => n.type)).toContain('write-conflict');
    expect(files.get(F)).toBe(other);
  });

  test('「없음」 오판 뒤 퀵 생성 진입(조사 경로 6): 「퀵 생성」을 만들고 지정 전체를 덮지 않는다 → 다음 진입에서 다시 읽어 디스크 지정 보존', async () => {
    const svc = new TemplateService();
    await svc.ensureLoaded();
    files.set(F, other);
    expect(await svc.ensureQuickGenProject()).toBeNull();
    expect(sessionService.add).not.toHaveBeenCalled();
    expect(files.get(F)).toBe(other);
    expect(notices.map((n) => n.type)).toContain('write-conflict');
    // 다시 진입 = reloadIfFailed → 디스크 지정을 읽고 차단 해제 → 퀵 생성 프로젝트를 만들되 T1 지정은 남는다
    expect(await svc.ensureQuickGenProject()).toEqual({ name: '퀵 생성' });
    const saved = JSON.parse(files.get(F)!);
    expect(saved.sceneTemplates).toEqual(['T1']);
    expect(saved.hiddenSceneTemplates).toEqual(['T1', '퀵 생성']);
    expect(saved.quickGenProject).toBe('퀵 생성');
  });

  test('정상 상태의 createSceneTemplate 은 종전대로 만들고 지정한다', async () => {
    const svc = new TemplateService();
    await svc.ensureLoaded();
    await svc.createSceneTemplate({ name: '원본' } as any);
    expect(mockProjects).toEqual(['새 템플릿']);
    expect(svc.isSceneTemplate('새 템플릿')).toBe(true);
    expect(svc.isHiddenProject('새 템플릿')).toBe(true);
    expect(JSON.parse(files.get(F)!).hiddenSceneTemplates).toEqual(['새 템플릿']);
    expect(pushMessage.mock.calls.some((c) => String(c[0]).includes('만들어졌습니다'))).toBe(true);
  });
});

describe('T5 고아 숨김 자동 해제', () => {
  test('숨김에만 있는 이름은 풀리고, 지정·퀵 생성 이름은 유지, 저장 1회 + 안내 1회', async () => {
    files.set(
      F,
      legacySerialize({
        sceneTemplates: ['T1', '구형지정'],
        hiddenSceneTemplates: ['고아1', 'T1', 'Q', '고아2'],
        folderTemplates: {},
        templateApplications: {},
        quickGenProject: 'Q',
      }),
    );
    const svc = new TemplateService();
    await svc.ensureLoaded();
    expect(svc.hiddenNames).toEqual(['T1', 'Q']);
    expect(svc.isHiddenProject('고아1')).toBe(false);
    expect(svc.isSceneTemplate('구형지정')).toBe(true); // 반대 방향(지정만 있음)은 건드리지 않음
    expect(svc.isHiddenProject('구형지정')).toBe(false);
    expect(mainWrites()).toBe(1);
    expect(JSON.parse(files.get(F)!).hiddenSceneTemplates).toEqual(['T1', 'Q']);
    expect(pushMessage).toHaveBeenCalledTimes(1);
    expect(pushMessage.mock.calls[0][0]).toBe(TEMPLATE_STORE_TEXT.hiddenReleased(['고아1', '고아2']));
    expect(pushMessage.mock.calls[0][0]).toContain('2개');
  });

  test('고아가 없으면 쓰지도 알리지도 않는다', async () => {
    files.set(F, sample);
    const svc = new TemplateService();
    await svc.ensureLoaded();
    expect(write).not.toHaveBeenCalled();
    expect(pushMessage).not.toHaveBeenCalled();
  });

  test('사본에서 되살린 로드(정상 아님)에서는 해제하지 않는다', async () => {
    files.set(F, '{');
    files.set(
      F + '.bak1',
      legacySerialize({ sceneTemplates: [], hiddenSceneTemplates: ['고아'], folderTemplates: {}, templateApplications: {} }),
    );
    const svc = new TemplateService();
    await svc.ensureLoaded();
    expect(svc.hiddenNames).toEqual(['고아']);
    expect(pushMessage).not.toHaveBeenCalled();
  });

  test('안내 문구는 이름 3개까지 + 나머지 수', () => {
    expect(TEMPLATE_STORE_TEXT.hiddenReleased(['a', 'b', 'c', 'd', 'e'])).toBe(
      '숨겨져 있던 프로젝트 5개를 다시 표시했습니다 — "a", "b", "c" 외 2개',
    );
  });
});
