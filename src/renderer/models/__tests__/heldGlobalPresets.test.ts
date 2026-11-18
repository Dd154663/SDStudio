// 글로벌 프리셋의 지원하지 않는 종류 항목 보존(2026-11-18 프리셋 유실 조사 경로 14).
//  · 형식은 정상(id·name 문자열)인데 workflowType 을 모르는 항목 = 화면 목록(presets)에는 없고, 저장 때 원래 자리로 그대로 쓴다
//  · id·이름 형식이 어긋난 손상 항목은 종전대로 버린다
//  · 다른 창 알림 교체·병합 뒤에도 보존분이 남는다(파일 쪽 보존분이 정답)
//  · 아는 항목만 있는 파일은 읽기 → 저장 결과가 종전과 같다
// 메모리 backend 목 — 실제 사용자 데이터 폴더는 건드리지 않는다.

const files = new Map<string, string>();
const enoent = (p: string) =>
  new Error(`Error invoking remote method 'read-file': Error: ENOENT: no such file or directory, open '${p}'`);
const backend = {
  readFile: jest.fn(async (p: string) => {
    if (!files.has(p)) throw enoent(p);
    return files.get(p)!;
  }),
  renameFile: jest.fn(async (a: string, b: string) => {
    if (!files.has(a)) throw enoent(a);
    files.set(b, files.get(a)!);
    files.delete(a);
  }),
  copyFile: jest.fn(async (a: string, b: string) => {
    if (!files.has(a)) throw enoent(a);
    files.set(b, files.get(a)!);
  }),
  existFile: jest.fn(async (p: string) => files.has(p)),
  readDataFile: jest.fn(async () => null),
  writeDataFile: jest.fn(async () => {}),
  deleteFile: jest.fn(async () => {}),
  notifyGlobalStoreChanged: jest.fn(async () => {}),
};
const write = jest.fn(async (p: string, d: string) => {
  files.set(p, d);
});

jest.mock('..', () => ({
  backend,
  imageService: {},
  workFlowService: {},
  sessionService: {},
  globalPresetService: {},
  globalCharacterPresetService: {},
}));
jest.mock('../PersistenceService', () => ({ persistService: { write } }));
jest.mock('../appStateRef', () => ({ getAppState: () => ({ pushMessage: jest.fn() }) }));
jest.mock('../SessionService', () => ({
  readJSONFromPNG: () => undefined,
  embedJSONInPNG: () => '',
  normalizePresetJson: (j: any) => j,
  createImageWithText: () => '',
}));
jest.mock('../util', () => ({ extractPromptDataFromBase64: async () => undefined }));
jest.mock('../presetExportDecoration', () => ({ decoratePresetExportImage: async (x: any) => x }));
jest.mock('../sdstudioPromptImport', () => ({
  planPromptImport: () => ({ frontPrompt: '', backPrompt: '' }),
}));
jest.mock('../types', () => ({ Session: class {} }));
jest.mock('../ImageService', () => ({ dataUriToBase64: (s: string) => s }));

import { GlobalPresetService } from '../GlobalPresetService';
import { weaveHeld, holdEntry } from '../heldEntries';

const GP = 'global_presets.json';
const p = (id: string, name: string, workflowType = 'SDImageGen') => ({
  id,
  name,
  workflowType,
  isDefault: false,
  createdAt: 1,
  updatedAt: 1,
  preset: { frontPrompt: name, nested: { deep: [1, 2] } },
});
const savedPresets = () => JSON.parse(files.get(GP)!).presets;

beforeEach(() => {
  files.clear();
  jest.clearAllMocks();
});

describe('heldEntries — 원래 자리 되돌려 넣기', () => {
  test('아는 항목이 그대로면 원본 순서와 같다', () => {
    const held = [holdEntry(0, { k: 'u0' }), holdEntry(2, { k: 'u2' })];
    expect(weaveHeld(['a', 'b'] as any[], held)).toEqual([{ k: 'u0' }, 'a', { k: 'u2' }, 'b']);
  });
  test('아는 항목이 줄어도 보존분은 빠지지 않는다(끝으로 붙음)', () => {
    const held = [holdEntry(3, { k: 'u3' })];
    expect(weaveHeld(['a'] as any[], held)).toEqual(['a', { k: 'u3' }]);
  });
  test('끼울 때마다 깊은 사본(호출부가 고쳐 써도 보존분은 그대로)', () => {
    const held = [holdEntry(0, { k: { v: 1 } })];
    const out: any[] = weaveHeld([], held);
    out[0].k.v = 99;
    expect(weaveHeld([], held)).toEqual([{ k: { v: 1 } }]);
  });
});

describe('글로벌 프리셋 — 지원하지 않는 종류 보존', () => {
  test('화면 목록에는 없고, 저장하면 원래 자리에 원본 그대로 남는다', async () => {
    const future = p('f', 'Future', 'SDImageGenV9');
    files.set(GP, JSON.stringify({ version: 2, presets: [p('a', 'A'), future, p('b', 'B')] }));
    const svc = new GlobalPresetService();
    await svc.load();
    expect(svc.presets.map((x) => x.id)).toEqual(['a', 'b']);
    expect(svc.list().map((x) => x.id)).toEqual(['a', 'b']);
    await svc.rename('a', 'A2');
    await svc.flushSave();
    const saved = savedPresets();
    expect(saved.map((x: any) => x.id)).toEqual(['a', 'f', 'b']);
    expect(saved[1]).toEqual(future);
    expect(saved[0].name).toBe('A2');
  });

  test('손상 항목(id·이름 형식 어긋남)은 종전대로 버린다', async () => {
    const future = p('f', 'Future', 'Unknown');
    files.set(
      GP,
      JSON.stringify({
        version: 2,
        presets: [{ id: 1, name: 'bad', workflowType: 'Unknown' }, null, future, p('a', 'A')],
      }),
    );
    const svc = new GlobalPresetService();
    await svc.load();
    expect(svc.presets.map((x) => x.id)).toEqual(['a']);
    await svc.save();
    expect(savedPresets()).toEqual([future, p('a', 'A')]);
  });

  test('아는 항목만 있는 파일은 읽기 → 저장이 종전과 같은 결과', async () => {
    const original = { version: 2, presets: [p('a', 'A'), p('b', 'B', 'SDImageGenEasy')] };
    files.set(GP, JSON.stringify(original));
    const svc = new GlobalPresetService();
    await svc.load();
    await svc.save();
    expect(JSON.parse(files.get(GP)!)).toEqual(original);
  });

  test('다른 창 교체(이 창 변경 없음) 뒤에도 파일 쪽 보존분이 남는다', async () => {
    files.set(GP, JSON.stringify({ version: 2, presets: [p('a', 'A')] }));
    const svc = new GlobalPresetService();
    await svc.load();
    const future = p('f', 'Future', 'SDImageGenV9');
    files.set(GP, JSON.stringify({ version: 2, presets: [future, p('a', 'A'), p('b', 'B')] }));
    await svc.reloadExternal();
    expect(svc.presets.map((x) => x.id)).toEqual(['a', 'b']);
    await svc.rename('b', 'B2');
    await svc.flushSave();
    expect(savedPresets().map((x: any) => x.id)).toEqual(['f', 'a', 'b']);
    expect(savedPresets()[0]).toEqual(future);
  });

  test('저장 안 된 변경이 있을 때 병합해도 보존분이 남는다', async () => {
    const future = p('f', 'Future', 'SDImageGenV9');
    files.set(GP, JSON.stringify({ version: 2, presets: [p('a', 'A'), future] }));
    const svc = new GlobalPresetService();
    await svc.load();
    await svc.rename('a', 'A2'); // 저장 대기 중(dirty)
    // 다른 창: B 추가해 저장(보존분은 그대로 파일에 있음)
    files.set(GP, JSON.stringify({ version: 2, presets: [p('a', 'A'), future, p('b', 'B')] }));
    await svc.reloadExternal();
    expect(svc.presets.map((x) => x.name)).toEqual(['A2', 'B']);
    await svc.flushSave();
    const saved = savedPresets();
    expect(saved.map((x: any) => x.id)).toEqual(['a', 'f', 'b']);
    expect(saved[1]).toEqual(future);
    expect(saved[0].name).toBe('A2');
  });
});
