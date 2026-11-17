// 글로벌 저장소가 스스로 비워지지 않게(2026-11-17 묶음 1, 플랜 guides/plans/2026-11-17-global-store-safety.md):
//  A. 공용 모듈 storeFile — 판정(ok·missing·recovered·corrupt-empty·io-failed)·재시도·손상본 보존·.tmp 복구·사본 회전·dirty flush
//  B. 세 저장소(글로벌 프리셋·글로벌 캐릭터 프리셋·프로젝트 템플릿) — 읽기 실패 지속이면 save·flushSave·migrateUnify 가
//     디스크를 건드리지 않음(조사 scratch 테스트가 보인 「빈 v2 저장」 재발 방지), 변경 조작 거부, 재로드 실패 시 메모리 유지
// 모두 메모리 backend 목 — 실제 사용자 데이터 폴더는 건드리지 않는다.

// ---------- 메모리 backend ----------
const files = new Map<string, string>();
// 경로 → 남은 읽기 실패 횟수(Infinity = 계속 실패). 실패 오류는 Electron IPC 형태(EBUSY 코드 포함)
const readFails = new Map<string, number>();
let existThrows = false;
const ops: string[] = [];

const enoent = (p: string) =>
  new Error(`Error invoking remote method 'read-file': Error: ENOENT: no such file or directory, open '${p}'`);

const readImpl = async (p: string) => {
  const left = readFails.get(p) ?? 0;
  if (left > 0) {
    readFails.set(p, left - 1);
    throw new Error(`Error invoking remote method 'read-file': Error: EBUSY: resource busy or locked, open '${p}'`);
  }
  if (!files.has(p)) throw enoent(p);
  return files.get(p)!;
};
const existImpl = async (p: string) => {
  if (existThrows) throw new Error('stat failed');
  return files.has(p);
};
const backend = {
  readFile: jest.fn(readImpl),
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
  existFile: jest.fn(existImpl),
  readDataFile: jest.fn(async () => null),
  writeDataFile: jest.fn(async (p: string) => {
    ops.push(`writeData ${p}`);
  }),
  deleteFile: jest.fn(async (p: string) => {
    ops.push(`delete ${p}`);
  }),
  notifyGlobalStoreChanged: jest.fn(async () => {}),
};
const write = jest.fn(async (p: string, d: string) => {
  ops.push(`write ${p}`);
  files.set(p, d);
});
const restoreBackendImpl = () => {
  backend.readFile.mockImplementation(readImpl);
  backend.existFile.mockImplementation(existImpl);
};

jest.mock('..', () => ({
  backend,
  imageService: {},
  workFlowService: {},
  sessionService: {},
  templateService: {
    clearFolderTemplatesByTemplateId: jest.fn(async () => {}),
    clearApplicationsByTemplateId: jest.fn(async () => {}),
  },
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
jest.mock('../types', () => ({
  VibeItem: { fromJSON: (j: any) => j },
  ReferenceItem: { fromJSON: (j: any) => j },
  CharacterPreset: {
    fromJSON: (j: any) => ({ ...j, toJSON: () => JSON.parse(JSON.stringify(j)) }),
  },
  PieceLibrary: { fromJSON: (j: any) => ({ ...j, toJSON: () => j }) },
  Session: class {},
}));
jest.mock('../ImageService', () => ({ dataUriToBase64: (s: string) => s }));
jest.mock('../imageFormats', () => ({ imageExtFromBase64: () => 'png' }));

import {
  StoreFile,
  StoreFileDeps,
  judgeStoreFile,
  subscribeGlobalStoreNotices,
  GlobalStoreNotice,
  GlobalStoreBlockedError,
  globalStoreNoticeView,
  STORE_MISSING_RECHECK_DELAY_MS,
} from '../storeFile';
import {
  flushGlobalStores,
  installGlobalStoreHiddenFlush,
  __resetGlobalStoreHiddenFlushForTest,
} from '../globalStoreFlush';
import { mergeById, mergeStringSet, canonicalJson } from '../storeMerge';
import { GlobalPresetService } from '../GlobalPresetService';
import { GlobalCharacterPresetService } from '../GlobalCharacterPresetService';
import { ProjectTemplateService } from '../ProjectTemplateService';
import { ArtistLibraryService } from '../ArtistLibraryService';
import { GlobalPieceService } from '../GlobalPieceService';

const notices: GlobalStoreNotice[] = [];
subscribeGlobalStoreNotices((n) => notices.push(n));

const noSleep = async () => {};
const deps: StoreFileDeps = { backend: () => backend, write, sleep: noSleep, now: () => 1000 };

// 단순 저장소: { items: string[] }
let memItems: string[] = [];
const FILE = 'store.json';
const makeStore = () =>
  new StoreFile<{ items: string[] }>(
    {
      file: FILE,
      label: '테스트 저장소',
      parse: (raw) => {
        const j = JSON.parse(raw);
        return j && Array.isArray(j.items) ? j : null;
      },
      countItems: (s) => s.items.length,
      serialize: () => JSON.stringify({ items: memItems }),
      saveDelayMs: 50,
    },
    deps,
  );
const body = (items: string[]) => JSON.stringify({ items });

beforeEach(() => {
  files.clear();
  readFails.clear();
  existThrows = false;
  ops.length = 0;
  notices.length = 0;
  memItems = [];
  jest.clearAllMocks();
  restoreBackendImpl();
});

// =====================================================================
describe('A. storeFile 판정', () => {
  test('정상 → ok', async () => {
    files.set(FILE, body(['a']));
    const r = await judgeStoreFile({ file: FILE, parse: (t) => JSON.parse(t) }, deps);
    expect(r.kind).toBe('ok');
  });

  test('본 파일·사본 모두 없음 → missing(아무것도 쓰지 않음)', async () => {
    const r = await judgeStoreFile({ file: FILE, parse: (t) => JSON.parse(t) }, deps);
    expect(r.kind).toBe('missing');
    expect(ops).toEqual([]);
  });

  test('Android 형태 오류(코드 없음) + existFile=false → missing', async () => {
    backend.readFile.mockImplementationOnce(async () => {
      throw new Error('File does not exist.');
    });
    const r = await judgeStoreFile({ file: FILE, parse: (t) => JSON.parse(t) }, deps);
    expect(r.kind).toBe('missing');
  });

  test('경로 속 대문자 폴더 이름(EDWARD 등)을 오류 코드로 오인하지 않는다 — ENOENT 면 missing', async () => {
    backend.readFile.mockImplementationOnce(async () => {
      throw new Error(
        "Error invoking remote method 'read-file': Error: ENOENT: no such file or directory, open 'C:\\Users\\EDWARD\\EXPORTS\\store.json'",
      );
    });
    const r = await judgeStoreFile({ file: FILE, parse: (t) => JSON.parse(t) }, deps);
    expect(r.kind).toBe('missing');
  });

  test('읽기 실패 1회 뒤 재시도 성공 → ok', async () => {
    files.set(FILE, body(['a']));
    readFails.set(FILE, 1);
    const r = await judgeStoreFile({ file: FILE, parse: (t) => JSON.parse(t) }, deps);
    expect(r.kind).toBe('ok');
    expect(backend.readFile).toHaveBeenCalledTimes(2);
  });

  test('읽기 실패 지속 → io-failed, .bak 으로 대체하지 않음', async () => {
    files.set(FILE, body(['a']));
    files.set(FILE + '.bak1', body(['old']));
    readFails.set(FILE, Infinity);
    const r = await judgeStoreFile({ file: FILE, parse: (t) => JSON.parse(t) }, deps);
    expect(r.kind).toBe('io-failed');
    expect(backend.readFile).toHaveBeenCalledTimes(3); // 1 + 재시도 2
    expect(ops).toEqual([]); // 손상 보존·복구 없음
  });

  test('EBUSY 인데 existFile 이 false 를 줘도 「없음」으로 보지 않는다(잠김·권한)', async () => {
    readFails.set(FILE, Infinity); // 파일은 없지만 오류는 EBUSY
    const r = await judgeStoreFile({ file: FILE, parse: (t) => JSON.parse(t) }, deps);
    expect(r.kind).toBe('io-failed');
  });

  test('existFile 자체가 실패하면 판단 불가 → io-failed', async () => {
    existThrows = true;
    const r = await judgeStoreFile({ file: FILE, parse: (t) => JSON.parse(t) }, deps);
    expect(r.kind).toBe('io-failed');
  });

  test('손상 → .corrupt 보존 + .bak1 복구', async () => {
    files.set(FILE, '{"items":["a"'); // 잘린 JSON
    files.set(FILE + '.bak1', body(['b1']));
    const r = await judgeStoreFile(
      { file: FILE, parse: (t) => { const j = JSON.parse(t); return Array.isArray(j.items) ? j : null; } },
      deps,
    );
    expect(r).toMatchObject({ kind: 'recovered', from: 'bak1', corruptName: `${FILE}.corrupt-1000` });
    expect(files.get(`${FILE}.corrupt-1000`)).toBe('{"items":["a"');
    expect(files.has(FILE)).toBe(false); // 판정은 본 파일에 쓰지 않는다(StoreFile.load 가 되돌림)
  });

  test('구조 불일치(배열 아님)도 손상으로 보존', async () => {
    files.set(FILE, '{"items":"x"}');
    const r = await judgeStoreFile(
      { file: FILE, parse: (t) => { const j = JSON.parse(t); return Array.isArray(j.items) ? j : null; } },
      deps,
    );
    expect(r).toMatchObject({ kind: 'corrupt-empty', corruptName: `${FILE}.corrupt-1000` });
  });

  test('손상 보존 이름 변경 실패 → 복사로 보존', async () => {
    files.set(FILE, 'garbage');
    backend.renameFile.mockImplementationOnce(async () => {
      throw new Error('EPERM');
    });
    const r = await judgeStoreFile({ file: FILE, parse: (t) => JSON.parse(t) }, deps);
    expect(r.kind).toBe('corrupt-empty');
    expect(files.get(`${FILE}.corrupt-1000`)).toBe('garbage');
    expect(files.get(FILE)).toBe('garbage');
  });

  test('손상 보존이 이름 변경·복사 모두 실패 → io-failed(덮어쓰기 금지)', async () => {
    files.set(FILE, 'garbage');
    backend.renameFile.mockImplementationOnce(async () => {
      throw new Error('EPERM');
    });
    backend.copyFile.mockImplementationOnce(async () => {
      throw new Error('EPERM');
    });
    const r = await judgeStoreFile({ file: FILE, parse: (t) => JSON.parse(t) }, deps);
    expect(r.kind).toBe('io-failed');
  });

  test('본 파일 없음 + 유효한 .tmp(Android 저장 중 종료) → .tmp 복구', async () => {
    files.set(FILE + '.tmp', body(['t']));
    files.set(FILE + '.bak1', body(['b']));
    const r = await judgeStoreFile({ file: FILE, parse: (t) => JSON.parse(t) }, deps);
    expect(r).toMatchObject({ kind: 'recovered', from: 'tmp', fromFile: FILE + '.tmp' });
    expect((r as any).corruptName).toBeUndefined();
  });

  test('손상된 .tmp 는 건너뛰고 다음 사본', async () => {
    files.set(FILE, 'bad');
    files.set(FILE + '.tmp', 'bad-too');
    files.set(FILE + '.bak2', body(['b2']));
    const r = await judgeStoreFile({ file: FILE, parse: (t) => JSON.parse(t) }, deps);
    expect(r).toMatchObject({ kind: 'recovered', from: 'bak2' });
  });
});

// =====================================================================
describe('A. StoreFile 세션 동작', () => {
  test('recovered → 본 파일에 되돌리고 안내 1회', async () => {
    files.set(FILE + '.tmp', body(['t']));
    const s = makeStore();
    const r = await s.load();
    expect(r.kind).toBe('recovered');
    expect(files.get(FILE)).toBe(body(['t']));
    expect(notices.map((n) => n.type)).toEqual(['recovered']);
  });

  test('io-failed → save·flush·schedule 가 디스크를 건드리지 않고, 조작 거부', async () => {
    files.set(FILE, body(['keep']));
    readFails.set(FILE, Infinity);
    const s = makeStore();
    const r = await s.load();
    expect(r).toMatchObject({ kind: 'io-failed', keepMemory: false });
    expect(s.loadFailed).toBe(true);
    ops.length = 0;
    memItems = [];
    expect(await s.saveNow()).toBe(false);
    s.schedule();
    await new Promise((r2) => setTimeout(r2, 80));
    expect(await s.flush()).toBe(false);
    await expect(s.saveNowOrThrow()).rejects.toBeInstanceOf(GlobalStoreBlockedError);
    expect(() => s.assertWritable()).toThrow(GlobalStoreBlockedError);
    expect(s.canWrite()).toBe(false);
    expect(ops).toEqual([]);
    expect(files.get(FILE)).toBe(body(['keep']));
    expect(notices.filter((n) => n.type === 'load-failed')).toHaveLength(1);
    // 차단 토스트는 짧은 간격 안에서는 한 번만
    expect(notices.filter((n) => n.type === 'write-blocked')).toHaveLength(1);
  });

  test('io-failed 뒤 다시 읽기 성공 → 차단 해제', async () => {
    files.set(FILE, body(['a']));
    readFails.set(FILE, 3);
    const s = makeStore();
    await s.load();
    expect(s.loadFailed).toBe(true);
    const r = await s.load();
    expect(r.kind).toBe('ok');
    expect(s.loadFailed).toBe(false);
  });

  test('재로드 실패 → keepMemory(기존 목록 유지)·저장은 정상 진행', async () => {
    files.set(FILE, body(['a']));
    const s = makeStore();
    await s.load();
    readFails.set(FILE, Infinity);
    const r = await s.load();
    expect(r).toMatchObject({ kind: 'io-failed', keepMemory: true });
    expect(s.loadFailed).toBe(false);
    readFails.clear();
    memItems = ['a', 'b'];
    expect(await s.saveNow()).toBe(true);
    expect(files.get(FILE)).toBe(body(['a', 'b']));
  });

  test('사본 회전: 첫 저장 1회만, 최대 3개, 부팅 때 읽은 내용이 .bak1', async () => {
    files.set(FILE, body(['boot']));
    files.set(FILE + '.bak1', body(['p1']));
    files.set(FILE + '.bak2', body(['p2']));
    files.set(FILE + '.bak3', body(['p3']));
    const s = makeStore();
    await s.load();
    memItems = ['n1'];
    await s.saveNow();
    expect(files.get(FILE + '.bak1')).toBe(body(['boot']));
    expect(files.get(FILE + '.bak2')).toBe(body(['p1']));
    expect(files.get(FILE + '.bak3')).toBe(body(['p2'])); // 가장 오래된 p3 는 밀려남
    expect(files.has(FILE + '.bak4')).toBe(false);
    expect(files.get(FILE)).toBe(body(['n1']));
    memItems = ['n2'];
    await s.saveNow();
    expect(files.get(FILE + '.bak1')).toBe(body(['boot'])); // 두 번째 저장은 회전하지 않음
    expect(ops.some((o) => o.startsWith('delete'))).toBe(false); // 삭제 없이 이름 변경·덮어쓰기만
  });

  test('부팅 때 읽은 내용이 0개면 회전하지 않는다', async () => {
    files.set(FILE, body([]));
    files.set(FILE + '.bak1', body(['good']));
    const s = makeStore();
    await s.load();
    memItems = ['x'];
    await s.saveNow();
    expect(files.get(FILE + '.bak1')).toBe(body(['good']));
    expect(files.has(FILE + '.bak2')).toBe(false);
  });

  test('dirty 가 아니면 flush 무동작, dirty 면 저장', async () => {
    files.set(FILE, body(['a']));
    const s = makeStore();
    await s.load();
    ops.length = 0;
    expect(await s.flush()).toBe(true);
    expect(ops).toEqual([]);
    memItems = ['a', 'b'];
    s.markDirty();
    expect(s.dirty).toBe(true);
    await s.flush();
    expect(files.get(FILE)).toBe(body(['a', 'b']));
    expect(s.dirty).toBe(false);
  });

  test('schedule 뒤 flush 는 대기 중 저장을 즉시 쓴다', async () => {
    files.set(FILE, body(['a']));
    const s = makeStore();
    await s.load();
    memItems = ['z'];
    s.schedule();
    await s.flush();
    expect(files.get(FILE)).toBe(body(['z']));
  });

  test('missing 이었는데 첫 저장 때 파일이 생겼으면 덮어쓰지 않는다', async () => {
    const s = makeStore();
    await s.load();
    files.set(FILE, body(['other-window']));
    memItems = ['mine'];
    expect(await s.saveNow()).toBe(false);
    expect(files.get(FILE)).toBe(body(['other-window']));
    expect(s.loadFailed).toBe(true);
    expect(notices.map((n) => n.type)).toContain('write-conflict');
  });

  test('missing 이고 파일이 여전히 없으면 첫 저장 정상', async () => {
    const s = makeStore();
    await s.load();
    memItems = ['new'];
    expect(await s.saveNow()).toBe(true);
    expect(files.get(FILE)).toBe(body(['new']));
    memItems = ['new', 'more'];
    expect(await s.saveNow()).toBe(true); // 이후엔 검사 없이 저장
  });

  test('안내 문구는 한 곳(globalStoreNoticeView)', () => {
    expect(globalStoreNoticeView({ type: 'write-blocked', label: 'X', file: 'f' }).as).toBe('toast');
    expect(
      globalStoreNoticeView({ type: 'corrupt-empty', label: 'X', file: 'f', corruptName: 'f.corrupt-1' }).text,
    ).toContain('f.corrupt-1');
  });
});

// =====================================================================
describe('Android 보강 A — 「없음」 오판으로 오래된 사본이 최신 본 파일을 덮지 않게', () => {
  const parseItems = (t: string) => {
    const j = JSON.parse(t);
    return Array.isArray(j.items) ? j : null;
  };

  test('사본 있음 + 재확인에서 본 파일이 읽힘 → ok(사본을 쓰지 않음)', async () => {
    files.set(FILE + '.bak1', body(['old']));
    const sleeps: number[] = [];
    // 첫 판정 때는 본 파일이 안 보이고(Android stat 실패 흉내), 잠시 뒤에는 보인다
    let hidden = true;
    backend.readFile.mockImplementation(async (p: string) => {
      if (p === FILE && hidden) throw new Error('File does not exist.');
      if (!files.has(p)) throw enoent(p);
      return files.get(p)!;
    });
    backend.existFile.mockImplementation(async (p: string) => (p === FILE && hidden ? false : files.has(p)));
    files.set(FILE, body(['newest']));
    const d: StoreFileDeps = {
      ...deps,
      sleep: async (ms) => {
        sleeps.push(ms);
        if (ms === STORE_MISSING_RECHECK_DELAY_MS) hidden = false;
      },
    };
    const r = await judgeStoreFile({ file: FILE, parse: parseItems }, d);
    expect(r).toMatchObject({ kind: 'ok', data: { items: ['newest'] } });
    expect(sleeps).toContain(STORE_MISSING_RECHECK_DELAY_MS);
    expect(ops).toEqual([]);
    backend.readFile.mockReset();
    backend.existFile.mockReset();
    restoreBackendImpl();
  });

  test('재확인에서 본 파일이 손상으로 읽힘 → 손상 경로(보존 후 사본)', async () => {
    files.set(FILE + '.bak1', body(['old']));
    let hidden = true;
    backend.readFile.mockImplementation(async (p: string) => {
      if (p === FILE && hidden) throw new Error('File does not exist.');
      if (!files.has(p)) throw enoent(p);
      return files.get(p)!;
    });
    backend.existFile.mockImplementation(async (p: string) => (p === FILE && hidden ? false : files.has(p)));
    files.set(FILE, '{"items":[');
    const d: StoreFileDeps = { ...deps, sleep: async () => { hidden = false; } };
    const r = await judgeStoreFile({ file: FILE, parse: parseItems }, d);
    expect(r).toMatchObject({ kind: 'recovered', from: 'bak1', corruptName: `${FILE}.corrupt-1000` });
    backend.readFile.mockReset();
    backend.existFile.mockReset();
    restoreBackendImpl();
  });

  test('재확인에서도 없음 → recovered(사본)', async () => {
    files.set(FILE + '.tmp', body(['t']));
    const sleeps: number[] = [];
    const r = await judgeStoreFile(
      { file: FILE, parse: parseItems },
      { ...deps, sleep: async (ms) => void sleeps.push(ms) },
    );
    expect(r).toMatchObject({ kind: 'recovered', from: 'tmp' });
    expect(sleeps).toEqual([STORE_MISSING_RECHECK_DELAY_MS]);
  });

  test('사본 없는 신규는 재확인 지연이 없다', async () => {
    const sleeps: number[] = [];
    const r = await judgeStoreFile(
      { file: FILE, parse: parseItems },
      { ...deps, sleep: async (ms) => void sleeps.push(ms) },
    );
    expect(r.kind).toBe('missing');
    expect(sleeps).toEqual([]);
  });

  test('되돌려 쓰기 직전 존재 확인에서 본 파일이 보이면 쓰지 않고 차단(첫 로드)', async () => {
    files.set(FILE + '.tmp', body(['old']));
    const s = makeStore();
    // 판정 동안에는 「없음」, 되돌려 쓰기 직전 확인에서는 「있음」
    let calls = 0;
    backend.existFile.mockImplementation(async (p: string) => {
      if (p !== FILE) return files.has(p);
      calls++;
      return calls > 2; // readMain 두 번(첫 판정·재확인) 뒤의 확인 = 쓰기 직전
    });
    const r = await s.load();
    expect(r).toMatchObject({ kind: 'io-failed', keepMemory: false });
    expect(s.loadFailed).toBe(true);
    expect(files.has(FILE)).toBe(false);
    expect(ops.filter((o) => o.startsWith('write') || o.startsWith('rename'))).toEqual([]);
    expect(notices.map((n) => n.type)).toEqual(['load-failed']);
    backend.existFile.mockReset();
    restoreBackendImpl();
  });

  test('되돌려 쓰기 직전 존재 확인 자체가 실패해도 쓰지 않는다', async () => {
    files.set(FILE + '.tmp', body(['old']));
    const s = makeStore();
    let calls = 0;
    backend.existFile.mockImplementation(async (p: string) => {
      if (p !== FILE) return files.has(p);
      calls++;
      if (calls > 2) throw new Error('stat failed');
      return false;
    });
    const r = await s.load();
    expect(r.kind).toBe('io-failed');
    expect(files.has(FILE)).toBe(false);
    backend.existFile.mockReset();
    restoreBackendImpl();
  });

  test('재로드(정상 로드 뒤) 때 같은 상황 → 메모리 유지, 차단하지 않음', async () => {
    files.set(FILE, body(['a']));
    const s = makeStore();
    await s.load();
    files.delete(FILE);
    files.set(FILE + '.tmp', body(['old']));
    let calls = 0;
    backend.existFile.mockImplementation(async (p: string) => {
      if (p !== FILE) return files.has(p);
      calls++;
      return calls > 2;
    });
    const r = await s.load();
    expect(r).toMatchObject({ kind: 'io-failed', keepMemory: true });
    expect(s.loadFailed).toBe(false);
    expect(files.has(FILE)).toBe(false);
    backend.existFile.mockReset();
    restoreBackendImpl();
  });

  test('손상본 보존 뒤 복구(corruptName 있음)는 종전대로 되돌려 쓴다', async () => {
    files.set(FILE, '{"items":[');
    files.set(FILE + '.bak1', body(['b1']));
    const s = makeStore();
    const r = await s.load();
    expect(r.kind).toBe('recovered');
    expect(files.get(FILE)).toBe(body(['b1']));
  });
});

// =====================================================================
describe('Android 보강 B — 백그라운드 전환 때 글로벌 저장소 저장', () => {
  beforeEach(() => __resetGlobalStoreHiddenFlushForTest());

  const makeDoc = () => {
    const listeners: (() => void)[] = [];
    return {
      hidden: false,
      addEventListener: (_t: 'visibilitychange', fn: () => void) => void listeners.push(fn),
      fire() {
        for (const fn of listeners) fn();
      },
      listeners,
    };
  };

  test('숨김 전환 때 dirty 인 저장소만 쓰고, 무변경이면 쓰기 0', async () => {
    const GP = 'global_presets.json';
    const AL = 'artist_library.json';
    files.set(GP, JSON.stringify({ version: 2, presets: [{ id: 'a', name: 'A', workflowType: 'SDImageGen', isDefault: false, createdAt: 1, updatedAt: 1, preset: {} }] }));
    files.set(AL, JSON.stringify({ version: 1, artists: [], tagPresets: [] }));
    const gp = new GlobalPresetService();
    const al = new ArtistLibraryService();
    const pt = new ProjectTemplateService(); // 읽지 않은 저장소
    await gp.load();
    await al.load();
    ops.length = 0;
    const doc = makeDoc();
    let done: Promise<void> = Promise.resolve();
    const flush = () => (done = flushGlobalStores([gp, al, pt]));
    expect(installGlobalStoreHiddenFlush(flush, doc)).toBe(true);
    expect(installGlobalStoreHiddenFlush(flush, doc)).toBe(false); // 중복 설치 막음
    expect(doc.listeners).toHaveLength(1);

    // 무변경 숨김 → 쓰기 0
    doc.hidden = true;
    doc.fire();
    await done;
    expect(ops).toEqual([]);

    // 보이는 쪽 전환은 무동작
    doc.hidden = false;
    await gp.rename('a', 'B'); // 2초 대기 중
    doc.fire();
    await done;
    expect(ops).toEqual([]);

    doc.hidden = true;
    doc.fire();
    await done;
    expect(JSON.parse(files.get(GP)!).presets[0].name).toBe('B');
    expect(ops.some((o) => o.includes(AL))).toBe(false);
    expect(ops.some((o) => o.includes('project_templates'))).toBe(false);
  });

  test('한 저장소가 실패해도 다음 저장소는 비운다', async () => {
    const calls: string[] = [];
    await flushGlobalStores([
      { flushSave: async () => { calls.push('a'); throw new Error('x'); } },
      { flushSave: async () => void calls.push('b') },
    ]);
    expect(calls).toEqual(['a', 'b']);
  });
});

// =====================================================================
describe('여러 창 동기화 — 병합 순수 함수(storeMerge)', () => {
  type It = { id: string; v: number; k?: string };
  const it = (id: string, v: number): It => ({ id, v });

  test('다른 창 추가 → 받아들여 뒤에 붙임 / 이 창 추가 → 유지', () => {
    const base = [it('a', 1)];
    const local = [it('a', 1), it('mine', 1)];
    const remote = [it('a', 1), it('theirs', 1)];
    expect(mergeById(base, local, remote).map((x) => x.id)).toEqual(['a', 'mine', 'theirs']);
  });

  test('다른 창이 지움 — local 이 base 와 같으면 지움, 고쳤으면 유지', () => {
    const base = [it('a', 1), it('b', 1)];
    const local = [it('a', 1), it('b', 2)];
    const remote: It[] = [];
    expect(mergeById(base, local, remote)).toEqual([it('b', 2)]);
  });

  test('이 창이 지움 → remote 가 고쳤어도 지운 채 유지', () => {
    const base = [it('a', 1), it('b', 1)];
    const local = [it('a', 1)];
    const remote = [it('a', 1), it('b', 9)];
    expect(mergeById(base, local, remote)).toEqual([it('a', 1)]);
  });

  test('양쪽에 있음 — local 이 base 와 같으면 remote, 다르면 local', () => {
    const base = [it('a', 1), it('b', 1)];
    const local = [it('a', 1), it('b', 5)];
    const remote = [it('a', 7), it('b', 8)];
    expect(mergeById(base, local, remote)).toEqual([it('a', 7), it('b', 5)]);
  });

  test('순서 = local 순서 유지, 다른 창 추가분은 remote 순서로 뒤에', () => {
    const base = [it('a', 1), it('b', 1)];
    const local = [it('b', 1), it('a', 1)];
    const remote = [it('x', 1), it('a', 1), it('y', 1), it('b', 1)];
    expect(mergeById(base, local, remote).map((x) => x.id)).toEqual(['b', 'a', 'x', 'y']);
  });

  test('키 순서만 다른 항목은 같은 값(고치지 않은 것으로 본다)', () => {
    const base = [{ id: 'a', v: 1, k: 'p' }];
    const local = [{ k: 'p', v: 1, id: 'a' } as It];
    const remote = [{ id: 'a', v: 2, k: 'p' }];
    expect(mergeById(base, local, remote)).toEqual([{ id: 'a', v: 2, k: 'p' }]);
    expect(canonicalJson({ b: 1, a: { d: 1, c: undefined } })).toBe('{"a":{"d":1},"b":1}');
  });

  test('base 가 비어 있으면(신규 창) 이 창·다른 창 항목 모두 유지(지우지 않음)', () => {
    expect(mergeById([], [it('m', 1)], [it('t', 1)]).map((x) => x.id)).toEqual(['m', 't']);
  });

  test('문자열 집합 — 추가는 받아들이고, 다른 창 삭제는 반영, 이 창 삭제는 유지', () => {
    const base = ['A', 'B', 'C'];
    const local = ['A', 'C', 'L']; // B 를 이 창이 지움, L 추가
    const remote = ['A', 'B', 'R']; // C 를 다른 창이 지움, R 추가
    expect(mergeStringSet(base, local, remote)).toEqual(['A', 'L', 'R']);
    expect(mergeStringSet([], ['x', 'x'], ['x', 'y'])).toEqual(['x', 'y']);
  });
});

// =====================================================================
describe('여러 창 동기화 — StoreFile.reloadExternal', () => {
  type It = { id: string; v: number };
  let mem: It[] = [];
  const IF = 'idstore.json';
  const idBody = (items: It[]) => JSON.stringify({ items });
  const makeIdStore = (afterWrite?: () => void) =>
    new StoreFile<{ items: It[] }>(
      {
        file: IF,
        label: '테스트 id 저장소',
        parse: (raw) => {
          const j = JSON.parse(raw);
          return j && Array.isArray(j.items) ? j : null;
        },
        countItems: (s) => s.items.length,
        serialize: () => JSON.stringify({ items: mem }),
        saveDelayMs: 30,
        afterWrite,
      },
      deps,
    );
  const handlers = () => {
    const calls: { kind: string; remote: any; base: any }[] = [];
    return {
      calls,
      h: {
        replace: (remote: { items: It[] }) => {
          calls.push({ kind: 'replace', remote, base: undefined });
          mem = remote.items;
        },
        merge: (remote: { items: It[] }, base: { items: It[] } | null) => {
          calls.push({ kind: 'merge', remote, base });
          mem = mergeById(base?.items ?? [], mem, remote.items);
        },
      },
    };
  };
  beforeEach(() => {
    mem = [];
  });

  test('저장 안 된 변경 없음 → 디스크 내용으로 교체, 쓰지 않음', async () => {
    files.set(IF, idBody([{ id: 'a', v: 1 }]));
    const s = makeIdStore();
    mem = (await s.load() as any).data.items;
    files.set(IF, idBody([{ id: 'a', v: 2 }])); // 다른 창 저장
    ops.length = 0;
    const { calls, h } = handlers();
    expect(await s.reloadExternal(h)).toBe('replaced');
    expect(calls.map((c) => c.kind)).toEqual(['replace']);
    expect(mem).toEqual([{ id: 'a', v: 2 }]);
    expect(s.dirty).toBe(false);
    expect(ops).toEqual([]);
    // 같은 내용으로 다시 알림이 와도 무동작
    expect(await s.reloadExternal(h)).toBe('unchanged');
  });

  test('dirty → base·remote 를 넘겨 병합, base 는 remote 로 갱신, 병합 결과를 저장', async () => {
    files.set(IF, idBody([{ id: 'a', v: 1 }, { id: 'b', v: 1 }]));
    const s = makeIdStore();
    mem = (await s.load() as any).data.items;
    mem = [{ id: 'a', v: 1 }, { id: 'b', v: 5 }]; // 이 창 편집(2초 대기 중)
    s.schedule();
    files.set(IF, idBody([{ id: 'a', v: 9 }, { id: 'b', v: 1 }, { id: 'c', v: 1 }])); // 다른 창 저장
    const { calls, h } = handlers();
    expect(await s.reloadExternal(h)).toBe('merged');
    expect(calls[0].base).toEqual({ items: [{ id: 'a', v: 1 }, { id: 'b', v: 1 }] });
    expect(mem).toEqual([{ id: 'a', v: 9 }, { id: 'b', v: 5 }, { id: 'c', v: 1 }]);
    expect(s.dirty).toBe(true);
    await s.flush();
    expect(JSON.parse(files.get(IF)!).items).toEqual(mem);
    // base 가 remote 로 갱신됐다 — 같은 원문 알림은 무동작
    files.set(IF, idBody([{ id: 'a', v: 9 }, { id: 'b', v: 1 }, { id: 'c', v: 1 }]));
    mem = [...mem, { id: 'd', v: 1 }];
    s.schedule();
    const second = handlers();
    expect(await s.reloadExternal(second.h)).toBe('merged');
    // 두 번째 병합의 기준은 방금 이 창이 쓴 내용
    expect(second.calls[0].base.items.map((x: It) => x.v)).toEqual([9, 5, 1]);
    s.cancelScheduled();
  });

  test('missing(신규) 창이 알림으로 파일을 읽으면 정상 상태 — 다음 저장이 쓰기 충돌로 막히지 않음', async () => {
    const s = makeIdStore();
    await s.load(); // 없음
    mem = [{ id: 'mine', v: 1 }];
    s.schedule(); // dirty
    files.set(IF, idBody([{ id: 'theirs', v: 1 }])); // 다른 창이 먼저 만듦
    const { calls, h } = handlers();
    expect(await s.reloadExternal(h)).toBe('merged');
    expect(calls[0].base).toBeNull(); // 기준 = 빈 목록
    expect(mem.map((x) => x.id)).toEqual(['mine', 'theirs']);
    expect(await s.saveNow()).toBe(true);
    expect(s.loadFailed).toBe(false);
    expect(notices.map((n) => n.type)).not.toContain('write-conflict');
    expect(JSON.parse(files.get(IF)!).items.map((x: It) => x.id)).toEqual(['mine', 'theirs']);
  });

  test('missing 이고 변경 없음 → 교체 후 정상 상태', async () => {
    const s = makeIdStore();
    await s.load();
    files.set(IF, idBody([{ id: 't', v: 1 }]));
    const { h } = handlers();
    expect(await s.reloadExternal(h)).toBe('replaced');
    mem = [...mem, { id: 'n', v: 1 }];
    expect(await s.saveNow()).toBe(true);
    expect(notices.map((n) => n.type)).not.toContain('write-conflict');
  });

  test('아직 읽지 않음·읽기 실패 차단 → skipped(파일을 읽지도 않음)', async () => {
    const s = makeIdStore();
    const { h, calls } = handlers();
    expect(await s.reloadExternal(h)).toBe('skipped');
    files.set(IF, idBody([{ id: 'a', v: 1 }]));
    readFails.set(IF, Infinity);
    await s.load();
    expect(s.loadFailed).toBe(true);
    backend.readFile.mockClear();
    expect(await s.reloadExternal(h)).toBe('skipped');
    expect(backend.readFile).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  }, 10000);

  test('다시 읽기 실패 → 메모리 유지(kept), 쓰지 않음', async () => {
    files.set(IF, idBody([{ id: 'a', v: 1 }]));
    const s = makeIdStore();
    mem = (await s.load() as any).data.items;
    readFails.set(IF, Infinity);
    ops.length = 0;
    const { h, calls } = handlers();
    expect(await s.reloadExternal(h)).toBe('kept');
    expect(calls).toEqual([]);
    expect(ops).toEqual([]);
  }, 10000);

  test('교체만 한 창은 다른 창에 다시 알리지 않는다(알림 왕복 없음)', async () => {
    const after = jest.fn();
    files.set(IF, idBody([{ id: 'a', v: 1 }]));
    const s = makeIdStore(after);
    mem = (await s.load() as any).data.items;
    files.set(IF, idBody([{ id: 'a', v: 2 }]));
    await s.reloadExternal(handlers().h);
    await s.flush();
    expect(after).not.toHaveBeenCalled();
  });
});

// =====================================================================
describe('여러 창 동기화 — 서비스', () => {
  const GC = 'global_character_presets.json';
  const entry = (id: string, name: string) => ({
    id,
    name,
    createdAt: 1,
    updatedAt: 1,
    preset: { name, vibes: [], characterReferences: [] },
  });

  test('글로벌 캐릭터: 편집 대기 중 다른 창 알림 → 이 창 편집 유지 + 다른 창 추가분 반영', async () => {
    files.set(GC, JSON.stringify({ version: 1, presets: [entry('x', 'X'), entry('y', 'Y')], folders: ['F'] }));
    const svc = new GlobalCharacterPresetService();
    await svc.load();
    await svc.rename('x', 'X2'); // 2초 저장 대기 중
    await svc.createFolder('내 폴더');
    // 다른 창: Y 를 지우고(이 창은 Y 를 안 건드림) Z 와 폴더 G 를 추가해 저장
    files.set(
      GC,
      JSON.stringify({ version: 1, presets: [entry('x', 'X'), entry('z', 'Z')], folders: ['F', 'G'] }),
    );
    ops.length = 0;
    await svc.reloadExternal();
    expect(svc.presets.map((p) => p.name)).toEqual(['X2', 'Z']);
    expect(svc.folders).toEqual(['F', '내 폴더', 'G']);
    expect(ops).toEqual([]); // 병합 자체는 쓰지 않고 저장을 예약
    await svc.flushSave();
    const saved = JSON.parse(files.get(GC)!);
    expect(saved.presets.map((p: any) => p.name)).toEqual(['X2', 'Z']);
    expect(saved.folders).toEqual(['F', '내 폴더', 'G']);
  });

  test('글로벌 캐릭터: 변경 없는 창은 교체만(쓰기 0)', async () => {
    files.set(GC, JSON.stringify({ version: 1, presets: [entry('x', 'X')], folders: [] }));
    const svc = new GlobalCharacterPresetService();
    await svc.load();
    files.set(GC, JSON.stringify({ version: 1, presets: [entry('x', 'X'), entry('n', 'N')], folders: [] }));
    ops.length = 0;
    await svc.reloadExternal();
    expect(svc.presets.map((p) => p.name)).toEqual(['X', 'N']);
    await svc.flushSave();
    expect(ops).toEqual([]);
    expect(backend.notifyGlobalStoreChanged).not.toHaveBeenCalled();
  });

  test('글로벌 프리셋: 외부 재로드는 v2 면 통합 이관·저장을 하지 않고, 저장 성공 뒤 알림 키를 보낸다', async () => {
    const GP = 'global_presets.json';
    const p = (id: string, name: string) => ({ id, name, workflowType: 'SDImageGen', isDefault: false, createdAt: 1, updatedAt: 1, preset: {} });
    files.set(GP, JSON.stringify({ version: 2, presets: [p('a', 'A')] }));
    const svc = new GlobalPresetService();
    await svc.load();
    files.set(GP, JSON.stringify({ version: 2, presets: [p('a', 'A'), p('b', 'B')] }));
    ops.length = 0;
    await svc.reloadExternal();
    expect(svc.presets.map((x) => x.name)).toEqual(['A', 'B']);
    expect(ops).toEqual([]);
    await svc.rename('a', 'A2');
    await svc.flushSave();
    expect(backend.notifyGlobalStoreChanged).toHaveBeenCalledWith('global-presets');
  });

  test('글로벌 프리셋: 아직 읽지 않았으면 무동작', async () => {
    const svc = new GlobalPresetService();
    await svc.reloadExternal();
    expect(backend.readFile).not.toHaveBeenCalled();
    expect(svc.loaded).toBe(false);
  });

  test('프로젝트 템플릿: 아직 읽지 않았으면(템플릿 화면을 연 적 없음) 무동작, 읽은 뒤엔 병합', async () => {
    const PT = 'project_templates.json';
    const t = (id: string, name: string) => ({ id, name, createdAt: 1, updatedAt: 1, preset: null, characterPresets: [], vibes: [], characterReferences: [], scenes: [] });
    files.set(PT, JSON.stringify({ version: 1, templates: [t('t1', 'T1')] }));
    const svc = new ProjectTemplateService();
    await svc.reloadExternal();
    expect(backend.readFile).not.toHaveBeenCalled();
    await svc.ensureLoaded();
    await svc.patchPreset('t1', { frontPrompt: 'mine' }); // 대기 중
    files.set(PT, JSON.stringify({ version: 1, templates: [t('t1', 'T1'), t('t2', 'T2')] }));
    await svc.reloadExternal();
    expect(svc.list().map((x) => x.name)).toEqual(['T1', 'T2']);
    expect(svc.get('t1')?.preset?.frontPrompt).toBe('mine');
    await svc.flushSave();
    expect(backend.notifyGlobalStoreChanged).toHaveBeenCalledWith('project-templates');
  });

  test('프로젝트 템플릿: await 도중 목록이 교체돼도 편집이 사라지지 않음(touch 방어)', async () => {
    const PT = 'project_templates.json';
    const t = (id: string, name: string) => ({ id, name, createdAt: 1, updatedAt: 1, preset: null, characterPresets: [], vibes: [], characterReferences: [], scenes: [] });
    files.set(PT, JSON.stringify({ version: 1, templates: [t('t1', 'T1')] }));
    const svc = new ProjectTemplateService();
    await svc.ensureLoaded();
    // 이미지 저장 await 도중 다른 창 저장 알림으로 교체되는 상황
    let release: () => void = () => {};
    backend.writeDataFile.mockImplementationOnce(
      () => new Promise<void>((r) => (release = () => r())),
    );
    const adding = svc.addVibe('t1', 'AAAA');
    await new Promise((r) => setTimeout(r, 0));
    files.set(PT, JSON.stringify({ version: 1, templates: [t('t1', 'T1-renamed'), t('t2', 'T2')] }));
    await svc.reloadExternal(); // 이 창은 아직 변경 없음 → 교체
    release();
    await adding;
    expect(svc.list().map((x) => x.id)).toEqual(['t1', 't2']);
    expect(svc.get('t1')?.vibes).toHaveLength(1);
    await svc.flushSave();
  });
});

// =====================================================================
describe('B. 글로벌 프리셋', () => {
  const GP = 'global_presets.json';
  const v2 = JSON.stringify({
    version: 2,
    presets: [{ id: 'a', name: 'A', workflowType: 'SDImageGen', isDefault: false, createdAt: 1, updatedAt: 1, preset: {} }],
  });

  test('정상 로드', async () => {
    files.set(GP, v2);
    const svc = new GlobalPresetService();
    await svc.load();
    expect(svc.presets.map((p) => p.name)).toEqual(['A']);
    expect(svc.loaded).toBe(true);
  });

  test('신규(없음) — migrateUnify 빈 v2 저장을 하지 않는다', async () => {
    const svc = new GlobalPresetService();
    await svc.load();
    expect(svc.presets).toEqual([]);
    expect(ops).toEqual([]);
  });

  test('읽기 실패 1회 → 재시도 성공(빈 목록으로 덮지 않음)', async () => {
    files.set(GP, v2);
    readFails.set(GP, 1);
    const svc = new GlobalPresetService();
    await svc.load();
    expect(svc.presets).toHaveLength(1);
    expect(JSON.parse(files.get(GP)!).presets).toHaveLength(1);
  }, 10000);

  test('읽기 실패 지속 → load·save·flushSave·migrateUnify 가 디스크를 건드리지 않음 + 변경 거부', async () => {
    files.set(GP, v2);
    readFails.set(GP, Infinity);
    const svc = new GlobalPresetService();
    await svc.load();
    expect(svc.loadFailed).toBe(true);
    expect(svc.loaded).toBe(false);
    expect(svc.presets).toEqual([]);
    await svc.save();
    await svc.flushSave();
    svc.scheduleSave();
    await expect(svc.rename('a', 'B')).rejects.toBeInstanceOf(GlobalStoreBlockedError);
    await expect(
      svc.addFromPresetAndImage({ type: 'SDImageGen', name: 'n' }, null, 'n'),
    ).rejects.toBeInstanceOf(GlobalStoreBlockedError);
    await expect(svc.restoreFromBackupDir('x', 'rename')).rejects.toBeInstanceOf(GlobalStoreBlockedError);
    expect(write).not.toHaveBeenCalled();
    expect(backend.renameFile).not.toHaveBeenCalled();
    expect(backend.writeDataFile).not.toHaveBeenCalled();
    expect(files.get(GP)).toBe(v2);
    // 다시 읽기 성공 → 해제
    readFails.clear();
    await svc.reloadIfFailed();
    expect(svc.loadFailed).toBe(false);
    expect(svc.presets).toHaveLength(1);
  }, 10000);

  test('v1 데이터 → 통합 이관은 읽은 원본을 .bak-unify 로 남기고 v2 저장', async () => {
    const v1 = JSON.stringify({
      version: 1,
      presets: [
        { id: 'a', name: 'A', workflowType: 'SDImageGen', isDefault: false, createdAt: 1, updatedAt: 1, preset: {} },
        { id: 'b', name: 'A', workflowType: 'SDImageGenEasy', isDefault: false, createdAt: 2, updatedAt: 2, preset: {} },
      ],
    });
    files.set(GP, v1);
    const svc = new GlobalPresetService();
    await svc.load();
    const unify = [...files.keys()].find((k) => k.startsWith(GP + '.bak-unify-'));
    expect(unify && files.get(unify)).toBe(v1);
    const saved = JSON.parse(files.get(GP)!);
    expect(saved.version).toBe(2);
    expect(saved.presets.map((p: any) => p.name)).toEqual(['A', 'A (2)']);
    expect(files.get(GP + '.bak1')).toBe(v1); // 첫 저장 전 사본 회전
  });

  test('손상 → .corrupt 보존 + .bak1 복구 + 안내', async () => {
    files.set(GP, '{"version":2,"presets":[');
    files.set(GP + '.bak1', v2);
    const svc = new GlobalPresetService();
    await svc.load();
    expect(svc.presets.map((p) => p.name)).toEqual(['A']);
    expect([...files.keys()].some((k) => k.startsWith(GP + '.corrupt-'))).toBe(true);
    expect(files.get(GP)).toBe(v2);
    expect(notices.map((n) => n.type)).toEqual(['recovered']);
  });

  test('손상·사본 없음 → 빈 목록, 손상본 보존, 빈 저장 안 함', async () => {
    files.set(GP, 'garbage');
    const svc = new GlobalPresetService();
    await svc.load();
    expect(svc.presets).toEqual([]);
    expect(svc.loadFailed).toBe(false);
    expect(files.has(GP)).toBe(false); // 빈 v2 를 쓰지 않음
    expect([...files.keys()].some((k) => k.startsWith(GP + '.corrupt-'))).toBe(true);
    expect(notices.map((n) => n.type)).toEqual(['corrupt-empty']);
  });

  test('바뀐 것이 없으면 종료 flushSave 가 쓰지 않는다', async () => {
    files.set(GP, v2);
    const svc = new GlobalPresetService();
    await svc.load();
    ops.length = 0;
    await svc.flushSave();
    expect(ops).toEqual([]);
    await svc.rename('a', 'B');
    await svc.flushSave();
    expect(JSON.parse(files.get(GP)!).presets[0].name).toBe('B');
  });
});

// =====================================================================
describe('B. 글로벌 캐릭터 프리셋', () => {
  const GC = 'global_character_presets.json';
  const store = JSON.stringify({
    version: 1,
    presets: [{ id: 'x', name: 'X', createdAt: 1, updatedAt: 1, preset: { name: 'X', vibes: [], characterReferences: [] } }],
    folders: ['F'],
  });

  test('파싱 실패 → .corrupt 보존, flushSave 가 빈 목록을 쓰지 않음', async () => {
    files.set(GC, store.slice(0, 20));
    const svc = new GlobalCharacterPresetService();
    await svc.load();
    expect(svc.presets).toEqual([]);
    await svc.flushSave();
    expect(files.has(GC)).toBe(false);
    expect([...files.keys()].some((k) => k.startsWith(GC + '.corrupt-'))).toBe(true);
  });

  test('읽기 실패 지속 → 저장 없음 + 폴더·순서 조작 거부', async () => {
    files.set(GC, store);
    readFails.set(GC, Infinity);
    const svc = new GlobalCharacterPresetService();
    await svc.load();
    expect(svc.loadFailed).toBe(true);
    await expect(svc.createFolder('새 폴더')).rejects.toBeInstanceOf(GlobalStoreBlockedError);
    svc.reorder(0, 1);
    await svc.flushSave();
    expect(write).not.toHaveBeenCalled();
    expect(backend.notifyGlobalStoreChanged).not.toHaveBeenCalled();
    expect(files.get(GC)).toBe(store);
  }, 10000);

  test('재로드(다른 창 알림) 실패 → 기존 메모리 유지', async () => {
    files.set(GC, store);
    const svc = new GlobalCharacterPresetService();
    await svc.load();
    expect(svc.presets).toHaveLength(1);
    readFails.set(GC, Infinity);
    await svc.load();
    expect(svc.presets).toHaveLength(1);
    expect(svc.folders).toEqual(['F']);
    expect(svc.loadFailed).toBe(false);
  }, 10000);

  test('저장 성공 뒤에만 다른 창 알림', async () => {
    files.set(GC, store);
    const svc = new GlobalCharacterPresetService();
    await svc.load();
    await svc.rename('x', 'Y');
    await svc.flushSave();
    expect(backend.notifyGlobalStoreChanged).toHaveBeenCalledTimes(1);
    expect(JSON.parse(files.get(GC)!).presets[0].name).toBe('Y');
    expect(files.get(GC + '.bak1')).toBe(store);
  });
});

// =====================================================================
describe('B. 프로젝트 템플릿', () => {
  const PT = 'project_templates.json';
  const store = JSON.stringify({
    version: 1,
    templates: [{ id: 't', name: 'T', createdAt: 1, updatedAt: 1, preset: null, characterPresets: [], vibes: [], characterReferences: [], scenes: [] }],
  });

  test('읽기 실패 지속 → 빈 목록·저장 없음·생성 거부, ensureLoaded 가 다시 읽어 해제', async () => {
    files.set(PT, store);
    readFails.set(PT, Infinity);
    const svc = new ProjectTemplateService();
    await svc.ensureLoaded();
    expect(svc.loadFailed).toBe(true);
    expect(svc.list()).toEqual([]);
    await expect(svc.create('새 템플릿')).rejects.toBeInstanceOf(GlobalStoreBlockedError);
    await svc.flushSave();
    expect(write).not.toHaveBeenCalled();
    readFails.clear();
    await svc.ensureLoaded();
    expect(svc.loadFailed).toBe(false);
    expect(svc.list().map((t) => t.name)).toEqual(['T']);
  }, 10000);

  test('손상 → .bak1 복구', async () => {
    files.set(PT, '{');
    files.set(PT + '.bak1', store);
    const svc = new ProjectTemplateService();
    await svc.ensureLoaded();
    expect(svc.list().map((t) => t.name)).toEqual(['T']);
    expect(files.get(PT)).toBe(store);
  });
});

// =====================================================================
describe('같은 패턴 점검 대상(작가 라이브러리·전역 조각)', () => {
  test('작가 라이브러리 읽기 실패 → 종료 flush 가 빈 목록을 쓰지 않음·추가 거부', async () => {
    const AL = 'artist_library.json';
    const s = JSON.stringify({ version: 1, artists: [{ id: 'a', name: 'A', images: [], tags: [] }], tagPresets: [] });
    files.set(AL, s);
    readFails.set(AL, Infinity);
    const svc = new ArtistLibraryService();
    await svc.load();
    expect(svc.createArtist('B')).toBeUndefined();
    await svc.flushSave();
    expect(write).not.toHaveBeenCalled();
    expect(files.get(AL)).toBe(s);
  }, 10000);

  test('전역 조각 읽기 실패 → 종료 flush 가 빈 목록을 쓰지 않음', async () => {
    const PF = 'global_pieces.json';
    const s = JSON.stringify({ lib: { pieces: [] } });
    files.set(PF, s);
    readFails.set(PF, Infinity);
    const svc = new GlobalPieceService();
    await svc.load();
    expect(svc.loadFailed).toBe(true);
    svc.scheduleSave();
    await svc.flushSave();
    expect(write).not.toHaveBeenCalled();
    expect(files.get(PF)).toBe(s);
  }, 10000);
});
