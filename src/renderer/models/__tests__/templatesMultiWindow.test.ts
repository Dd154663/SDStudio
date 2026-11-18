// 씬 템플릿 지정 목록(templates.json) 여러 창 동기화(2026-11-18 T4, 플랜 guides/plans/2026-11-18-scene-template-safety.md):
//  - 키 단위 3방향 병합 순수 함수(storeMerge.mergeByKey)·필드별 병합(mergeTemplatesSidecar)
//  - 두 TemplateService 인스턴스(같은 메모리 디스크, 알림은 수동 전달)로 교체·병합·신규 상태·왕복 없음·막힌 창
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
  notifyGlobalStoreChanged: jest.fn(async (_key: string) => {}),
};
const write = jest.fn(async (p: string, d: string) => {
  if (writeFailPaths.has(p)) {
    ops.push(`write-fail ${p}`);
    throw new Error(`EACCES: permission denied, open '${p}'`);
  }
  ops.push(`write ${p}`);
  files.set(p, d);
});

// 디스크의 프로젝트(diskProjects)와 창이 아는 목록(listed) — 프로젝트 목록은 창 사이에 자동 갱신되지 않으므로 둘을 나눈다.
// 두 TemplateService 인스턴스가 같은 sessionService 목을 쓴다(목록이 낡은 창은 listed 에서 빼서 흉내).
const diskProjects: string[] = [];
let listed: string[] = [];
const sessionService = {
  list: () => [...listed],
  listFolders: () => [] as string[],
  add: jest.fn(async (name: string) => {
    diskProjects.push(name);
    listed.push(name);
  }),
  update: jest.fn(async () => {
    listed = [...diskProjects];
  }),
  get: jest.fn(async (name: string) => (listed.includes(name) ? { name } : null)),
  exportSessionShallow: jest.fn(async () => ({})),
  importSessionShallow: jest.fn(async (_json: any, name: string) => {
    diskProjects.push(name);
    listed.push(name);
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
jest.mock('../nameInput', () => ({
  promptName: async () => '새 템플릿',
  projectNameRules: () => ({}),
  nameErrorMessage: (_e: any, _k: any, _n: any, fallback: string) => fallback,
}));

import { TemplateService, mergeTemplatesSidecar, TemplatesSidecarData } from '../TemplateService';
import { mergeByKey } from '../storeMerge';
import { subscribeGlobalStoreNotices, GlobalStoreNotice, GLOBAL_STORE_SYNC_KEYS } from '../storeFile';

const F = 'templates.json';
const notices: GlobalStoreNotice[] = [];
subscribeGlobalStoreNotices((n) => notices.push(n));
const mainWrites = () => ops.filter((o) => o === `rename ${F}.tmp -> ${F}` || o === `write ${F}`).length;
const disk = () => JSON.parse(files.get(F)!);
const sidecar = (d: Partial<{ st: string[]; hs: string[]; ft: any; ta: any; qg: string }>) =>
  JSON.stringify({
    version: 1,
    sceneTemplates: d.st ?? [],
    hiddenSceneTemplates: d.hs ?? [],
    folderTemplates: d.ft ?? {},
    templateApplications: d.ta ?? {},
    quickGenProject: d.qg,
  });

beforeEach(() => {
  files.clear();
  readFails.clear();
  ops.length = 0;
  notices.length = 0;
  writeFailPaths = new Set();
  diskProjects.length = 0;
  listed = [];
  jest.clearAllMocks();
});

// =====================================================================
describe('mergeByKey — 키 단위 3방향 병합', () => {
  const v = (id: string) => ({ templateId: id });

  test('다른 창 추가 = 받음(뒤에), 이 창 추가 = 유지', () => {
    const out = mergeByKey({ a: v('1') }, { a: v('1'), mine: v('m') }, { a: v('1'), theirs: v('t') });
    expect(out).toEqual({ a: v('1'), mine: v('m'), theirs: v('t') });
    expect(Object.keys(out)).toEqual(['a', 'mine', 'theirs']);
  });

  test('다른 창 삭제 = 이 창이 그 키를 안 바꿨으면 삭제, 바꿨으면 유지', () => {
    expect(mergeByKey({ a: v('1') }, { a: v('1') }, {})).toEqual({});
    expect(mergeByKey({ a: v('1') }, { a: v('2') }, {})).toEqual({ a: v('2') });
  });

  test('이 창 삭제 = 지운 채 유지(다른 창이 고쳤어도)', () => {
    expect(mergeByKey({ a: v('1') }, {}, { a: v('1') })).toEqual({});
    expect(mergeByKey({ a: v('1') }, {}, { a: v('9') })).toEqual({});
  });

  test('양쪽 수정 = 이 창 우선, 이 창 그대로면 다른 창 값', () => {
    expect(mergeByKey({ a: v('1') }, { a: v('2') }, { a: v('3') })).toEqual({ a: v('2') });
    expect(mergeByKey({ a: v('1') }, { a: v('1') }, { a: v('3') })).toEqual({ a: v('3') });
  });

  test('값 비교는 키 순서 무관(canonicalJson), 입력은 바꾸지 않음', () => {
    const base = { p: { x: 1, y: 2 } };
    const local = { p: { y: 2, x: 1 } }; // 같은 값, 키 순서만 다름
    const remote = { p: { x: 1, y: 3 } };
    expect(mergeByKey(base, local, remote)).toEqual({ p: { x: 1, y: 3 } });
    expect(base).toEqual({ p: { x: 1, y: 2 } });
    expect(local).toEqual({ p: { y: 2, x: 1 } });
  });
});

describe('mergeTemplatesSidecar — 필드별 병합', () => {
  const d = (p: Partial<TemplatesSidecarData>): TemplatesSidecarData => ({
    sceneNames: [],
    hiddenNames: [],
    quickGenName: null,
    folderTemplates: {},
    templateApplications: {},
    ...p,
  });
  const rec = (inherited: boolean) => ({
    inherited,
    presets: [],
    characterPresetNames: [],
    vibePaths: [],
    referencePaths: [],
  });

  test('지정·숨김·폴더·적용 기록이 양쪽 변경을 모두 남긴다', () => {
    const base = d({ sceneNames: ['T1'], hiddenNames: ['T1'] });
    const local = d({
      sceneNames: ['T1'],
      hiddenNames: ['T1'],
      folderTemplates: { F: { templateId: 'a' } },
      templateApplications: { P: { a: rec(true) } },
    });
    const remote = d({
      sceneNames: ['T1', 'T2'],
      hiddenNames: ['T1', 'T2'],
      folderTemplates: { G: { templateId: 'b' } },
      templateApplications: { Q: { b: rec(false) } },
    });
    const out = mergeTemplatesSidecar(base, local, remote);
    expect(out.sceneNames).toEqual(['T1', 'T2']);
    expect(out.hiddenNames).toEqual(['T1', 'T2']);
    expect(out.folderTemplates).toEqual({ F: { templateId: 'a' }, G: { templateId: 'b' } });
    expect(Object.keys(out.templateApplications)).toEqual(['P', 'Q']);
  });

  test('퀵 생성 이름: 이 창이 바꿨으면 이 창 값, 아니면 다른 창 값', () => {
    const base = d({ quickGenName: 'Q' });
    expect(mergeTemplatesSidecar(base, d({ quickGenName: 'Q' }), d({ quickGenName: 'R' })).quickGenName).toBe('R');
    expect(mergeTemplatesSidecar(base, d({ quickGenName: 'L' }), d({ quickGenName: 'R' })).quickGenName).toBe('L');
    // base 없음(신규) — 이 창이 만든 것이 우선
    expect(mergeTemplatesSidecar(null, d({ quickGenName: 'L' }), d({ quickGenName: 'R' })).quickGenName).toBe('L');
    expect(mergeTemplatesSidecar(null, d({}), d({ quickGenName: 'R' })).quickGenName).toBe('R');
  });

  test('병합이 고아 숨김을 만들면 숨김에서 뺀다(덜 숨기는 쪽)', () => {
    // 이 창: 퀵 생성을 L 로 새로 지정(Q 숨김 해제) / 다른 창: 옛 Q 를 그대로 숨김에 둔 채 다른 변경
    const base = d({ quickGenName: 'Q', hiddenNames: ['Q'] });
    const local = d({ quickGenName: 'L', hiddenNames: ['L'] });
    const remote = d({ quickGenName: 'Q', hiddenNames: ['Q', 'X'], sceneNames: ['X'] });
    const out = mergeTemplatesSidecar(base, local, remote);
    expect(out.quickGenName).toBe('L');
    expect(out.hiddenNames).toEqual(['L', 'X']);
    // 다른 창이 지정 해제(숨김은 남음 — 구형)한 이름도 숨김에 남지 않는다
    const out2 = mergeTemplatesSidecar(
      d({ sceneNames: ['T'], hiddenNames: ['T'] }),
      d({ sceneNames: ['T'], hiddenNames: ['T'], folderTemplates: { F: { templateId: 'a' } } }),
      d({ sceneNames: [], hiddenNames: ['T'] }),
    );
    expect(out2.sceneNames).toEqual([]);
    expect(out2.hiddenNames).toEqual([]);
  });

  test('지정에만 있고 숨김에 없는 구형 씬 템플릿은 그대로 둔다', () => {
    const out = mergeTemplatesSidecar(d({ sceneNames: ['Old'] }), d({ sceneNames: ['Old'] }), d({ sceneNames: ['Old'] }));
    expect(out.sceneNames).toEqual(['Old']);
    expect(out.hiddenNames).toEqual([]);
  });
});

// =====================================================================
describe('두 창 — TemplateService.reloadExternal', () => {
  test('A 씬 템플릿 지정 → B 재로드 → B 폴더 기본 템플릿 지정 → 디스크에 둘 다 남음(알림 키 확인)', async () => {
    files.set(F, sidecar({}));
    listed = ['T1'];
    const A = new TemplateService();
    const B = new TemplateService();
    await A.ensureLoaded();
    await B.ensureLoaded();
    await A.toggleSceneTemplate('T1');
    expect(backend.notifyGlobalStoreChanged).toHaveBeenCalledWith(GLOBAL_STORE_SYNC_KEYS.sceneTemplates);
    expect(GLOBAL_STORE_SYNC_KEYS.sceneTemplates).toBe('scene-templates');
    await B.reloadExternal();
    expect(B.sceneNames).toEqual(['T1']);
    await B.setFolderTemplate('폴더', 'tplA');
    expect(disk().sceneTemplates).toEqual(['T1']);
    expect(disk().folderTemplates).toEqual({ 폴더: { templateId: 'tplA' } });
  });

  test('A 의 지정 해제가 B 에 반영되고 B 의 다음 저장이 되살리지 않음', async () => {
    files.set(F, sidecar({ st: ['T1'], hs: ['T1'] }));
    const A = new TemplateService();
    const B = new TemplateService();
    await A.ensureLoaded();
    await B.ensureLoaded();
    await A.removeProject('T1'); // 지정·숨김 해제
    expect(disk().sceneTemplates).toEqual([]);
    await B.reloadExternal();
    expect(B.sceneNames).toEqual([]);
    expect(B.isHiddenProject('T1')).toBe(false);
    await B.setFolderTemplate('폴더', 'tplA');
    expect(disk().sceneTemplates).toEqual([]);
    expect(disk().hiddenSceneTemplates).toEqual([]);
    expect(disk().folderTemplates).toEqual({ 폴더: { templateId: 'tplA' } });
  });

  test('B 가 저장 실패로 dirty 인 상태에서 A 의 변경 알림 → 병합으로 양쪽 변경이 남음', async () => {
    files.set(F, sidecar({ st: ['T1'], hs: ['T1'] }));
    const A = new TemplateService();
    const B = new TemplateService();
    await A.ensureLoaded();
    await B.ensureLoaded();
    writeFailPaths = new Set([F, F + '.tmp']);
    await expect(B.setFolderTemplate('폴더', 'tplB')).rejects.toThrow('EACCES');
    writeFailPaths = new Set();
    await A.setFolderTemplate('다른 폴더', 'tplA');
    await A.toggleSceneTemplate('T2');
    ops.length = 0;
    await B.reloadExternal();
    expect(ops).toEqual([]); // 병합 자체는 쓰지 않고 저장을 예약
    expect(B.sceneNames).toEqual(['T1', 'T2']);
    expect(B.folderTemplates).toEqual({
      폴더: { templateId: 'tplB' },
      '다른 폴더': { templateId: 'tplA' },
    });
    await B.flushSave();
    expect(disk().sceneTemplates).toEqual(['T1', 'T2']);
    expect(disk().folderTemplates).toEqual({
      폴더: { templateId: 'tplB' },
      '다른 폴더': { templateId: 'tplA' },
    });
  });

  test('신규(없음) 두 창: A 가 퀵 생성 프로젝트를 만든 뒤(알림 수신) B 가 요청 → 쓰기 충돌 없이 재사용, 「퀵 생성 (2)」 없음', async () => {
    const A = new TemplateService();
    const B = new TemplateService();
    await A.ensureLoaded();
    await B.ensureLoaded();
    expect(await A.ensureQuickGenProject()).toEqual({ name: '퀵 생성' });
    await B.reloadExternal(); // A 저장 알림
    expect(B.quickGenName).toBe('퀵 생성');
    expect(await B.ensureQuickGenProject()).toEqual({ name: '퀵 생성' });
    expect(sessionService.add).toHaveBeenCalledTimes(1);
    expect(diskProjects).toEqual(['퀵 생성']);
    expect(notices.map((n) => n.type)).not.toContain('write-conflict');
    expect(B.loadFailed).toBe(false);
    // B 의 이후 저장도 차단되지 않고 A 의 지정을 지우지 않는다
    await B.setFolderTemplate('폴더', 'tplB');
    expect(disk().quickGenProject).toBe('퀵 생성');
    expect(disk().hiddenSceneTemplates).toEqual(['퀵 생성']);
    expect(disk().folderTemplates).toEqual({ 폴더: { templateId: 'tplB' } });
  });

  test('신규(없음) 두 창, 알림이 늦음 + B 의 프로젝트 목록이 낡음: B 가 디스크를 엿봐 흡수·목록 재스캔 → 재사용', async () => {
    const A = new TemplateService();
    const B = new TemplateService();
    await A.ensureLoaded();
    await B.ensureLoaded();
    await A.ensureQuickGenProject();
    listed = []; // B 창은 A 가 만든 프로젝트를 아직 모른다
    expect(await B.ensureQuickGenProject()).toEqual({ name: '퀵 생성' });
    expect(sessionService.update).toHaveBeenCalled();
    expect(sessionService.add).toHaveBeenCalledTimes(1);
    expect(notices.map((n) => n.type)).not.toContain('write-conflict');
    expect(B.loadFailed).toBe(false);
  });

  test('재로드만으로는 디스크 쓰기 0·알림 0(왕복 없음), 고아 숨김도 자동 해제하지 않음', async () => {
    files.set(F, sidecar({ st: ['T1'], hs: ['T1'] }));
    const B = new TemplateService();
    await B.ensureLoaded();
    // 다른 창이 쓴 내용(고아 숨김 'Orphan' 포함 — 정상 로드라면 해제 대상)
    files.set(F, sidecar({ st: ['T1', 'T2'], hs: ['T1', 'T2', 'Orphan'] }));
    ops.length = 0;
    await B.reloadExternal();
    expect(B.sceneNames).toEqual(['T1', 'T2']);
    expect(B.hiddenNames).toEqual(['T1', 'T2', 'Orphan']);
    await B.flushSave();
    expect(ops).toEqual([]);
    expect(mainWrites()).toBe(0);
    expect(backend.notifyGlobalStoreChanged).not.toHaveBeenCalled();
    expect(pushMessage).not.toHaveBeenCalled();
    // 같은 내용으로 또 알림이 와도 무동작
    await B.reloadExternal();
    expect(ops).toEqual([]);
  });

  test('아직 읽지 않은 창은 무동작(읽지도 않음)', async () => {
    files.set(F, sidecar({ st: ['T1'] }));
    const B = new TemplateService();
    await B.reloadExternal();
    expect(backend.readFile).not.toHaveBeenCalled();
    expect(B.sceneNames).toEqual([]);
  });

  test('읽기 실패로 막힌 창은 알림을 받아도 무동작(목록·차단 유지, 쓰지 않음)', async () => {
    files.set(F, sidecar({ st: ['T1'], hs: ['T1'] }));
    readFails.set(F, Infinity);
    const B = new TemplateService();
    await B.ensureLoaded();
    expect(B.loadFailed).toBe(true);
    const reads = backend.readFile.mock.calls.length;
    readFails.clear();
    files.set(F, sidecar({ st: ['T1', 'T2'], hs: ['T1', 'T2'] }));
    await B.reloadExternal();
    expect(backend.readFile.mock.calls.length).toBe(reads);
    expect(B.sceneNames).toEqual([]);
    expect(B.loadFailed).toBe(true);
    expect(B.listUnavailable).toBe(true);
    expect(write).not.toHaveBeenCalled();
  }, 15000);

  test('되돌리기 재부착(restoreFolderTemplates)은 판단을 반영 직전 메모리로 — 그 사이 다른 창이 넣은 지정을 덮지 않음', async () => {
    files.set(F, sidecar({}));
    const B = new TemplateService();
    await B.ensureLoaded();
    // 다른 창이 그 폴더에 지정을 저장했고 B 가 그 알림을 처리한 직후 setFolderTemplate(onlyIfEmpty) 가 불린 상황
    files.set(F, sidecar({ ft: { 폴더: { templateId: 'theirs' } } }));
    await B.reloadExternal();
    await B.setFolderTemplate('폴더', 'mine', { onlyIfEmpty: true });
    expect(B.folderTemplates).toEqual({ 폴더: { templateId: 'theirs' } });
    // 옵션 없이 부르면 종전대로 덮어쓴다(사용자가 직접 지정)
    await B.setFolderTemplate('폴더', 'mine');
    expect(disk().folderTemplates).toEqual({ 폴더: { templateId: 'mine' } });
  });
});
