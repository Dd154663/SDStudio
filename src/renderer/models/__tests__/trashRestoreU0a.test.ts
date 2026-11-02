/**
 * 휴지통 복원 경로 보강(2026-11-01 U0-a T1~T4) — 메모리 파일시스템으로 TrashService 검증.
 *  T1 restoreScene: 이동 실패·같은 이름 폴더/파일 → 중단(씬 미추가·기록 보존), 다른 창 잠금 → undefined,
 *     성공 → 복원된 씬 객체 반환
 *  T2 restoreImages: { restored, failed }, 같은 이름 파일은 덮어쓰지 않음
 *  T3 이미지 휴지통 meta 읽고-쓰기 직렬화(삭제·복원·자동 정리 동시 실행에서 항목 유실 없음)
 *  T4 moveSceneToTrash: 슬롯 이름 반환 / 이미지 이동 상세 결과
 * 모킹 방식은 trashCoexist.test.ts 와 같다.
 */

// ---- 메모리 파일시스템 ----
const files = new Map<string, string>();
const failRenameDir = new Set<string>(); // 이 원본 경로의 renameDir 을 실패(이동 없음)
const failRenameFile = new Set<string>(); // 이 원본 경로의 renameFile 을 실패(이동 없음)
const throwAfterMove = new Set<string>(); // 옮긴 뒤 오류를 던짐(실제로는 이동됨)
let slow = false; // true 면 모든 IO 사이에 매크로태스크 양보 → 동시 실행이 끼어든다

const pause = () =>
  slow ? new Promise<void>((r) => setTimeout(r, 0)) : Promise.resolve();

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
function movePrefix(from: string, to: string) {
  for (const k of Array.from(files.keys())) {
    if (k === from || k.startsWith(from + '/')) {
      const v = files.get(k)!;
      files.delete(k);
      files.set(to + k.slice(from.length), v);
    }
  }
}

jest.mock('../index', () => ({
  backend: {
    existFile: jest.fn(async (p: string) => {
      await pause();
      return exists(p);
    }),
    readFile: jest.fn(async (p: string) => {
      await pause();
      if (!files.has(p)) throw new Error('ENOENT ' + p);
      return files.get(p)!;
    }),
    writeFile: jest.fn(async (p: string, c: string) => {
      await pause();
      files.set(p, c);
    }),
    listFiles: jest.fn(async (dir: string) => {
      await pause();
      return children(dir);
    }),
    listFilesWithStats: jest.fn(async (dir: string) =>
      children(dir)
        .filter((n) => files.has(dir + '/' + n))
        .map((name) => ({ name })),
    ),
    // 실제 rename 처럼 대상 파일을 덮어쓴다(PC fs.rename·Android Capacitor rename 공통).
    renameFile: jest.fn(async (a: string, b: string) => {
      await pause();
      if (failRenameFile.has(a)) throw new Error('EBUSY ' + a);
      if (!files.has(a)) throw new Error('ENOENT ' + a);
      files.set(b, files.get(a)!);
      files.delete(a);
      if (throwAfterMove.has(a)) throw new Error('EIO after move ' + a);
    }),
    renameDir: jest.fn(async (a: string, b: string) => {
      await pause();
      if (!exists(a)) return;
      if (failRenameDir.has(a)) throw new Error('EPERM ' + a);
      if (exists(b)) throw new Error('ENOTEMPTY ' + b);
      movePrefix(a, b);
      if (throwAfterMove.has(a)) throw new Error('EIO after move ' + a);
    }),
    deleteFile: jest.fn(async (p: string) => {
      await pause();
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
  templateService: { removeProject: jest.fn(async () => {}) },
  sessionService: { guardCrossWindowLock: jest.fn(async () => true) },
}));
jest.mock('../PersistenceService', () => ({
  persistService: {
    write: jest.fn(async (p: string, c: string) => {
      await pause();
      files.set(p, c);
    }),
  },
}));
jest.mock('../types', () => ({
  genericSceneFromJSON: (j: any) => (j.broken ? null : { ...j }),
}));

import { KeyedSerialQueue, TrashService } from '../TrashService';
import { sessionService } from '../index';
import { setWorkspaceLayoutActive } from '../storageLayout';

const lockMock = sessionService.guardCrossWindowLock as jest.Mock;

// ---- 가짜 세션·씬 ----
function makeScene(name: string, type: 'scene' | 'inpaint' = 'scene') {
  return { name, type, toJSON: () => ({ name, type, slots: [], mains: [] }) } as any;
}
function makeSession(name: string, scenes: any[]) {
  const s = {
    name,
    scenes: new Map<string, any>(),
    inpaints: new Map<string, any>(),
    getScenes(type: 'scene' | 'inpaint') {
      return Array.from((type === 'scene' ? s.scenes : s.inpaints).values());
    },
    hasScene(type: 'scene' | 'inpaint', n: string) {
      return (type === 'scene' ? s.scenes : s.inpaints).has(n);
    },
    removeScene(type: 'scene' | 'inpaint', n: string) {
      (type === 'scene' ? s.scenes : s.inpaints).delete(n);
    },
    addScene(scene: any) {
      (scene.type === 'scene' ? s.scenes : s.inpaints).set(scene.name, scene);
    },
  };
  for (const sc of scenes) s.addScene(sc);
  return s as any;
}
const trashJson = () => JSON.parse(files.get('trash.json') || '{"scenes":{},"projects":{}}');
const sceneEntry = (name: string, type: 'scene' | 'inpaint' = 'scene', extra: any = {}) => ({
  sceneData: { name, type, ...extra },
  deletedAt: 5,
});
function seedTrash(scenes: Record<string, any>) {
  files.set('trash.json', JSON.stringify({ scenes, projects: {} }));
}

async function loaded() {
  const svc = new TrashService();
  await svc.loadTrash();
  return svc;
}

beforeEach(() => {
  files.clear();
  failRenameDir.clear();
  failRenameFile.clear();
  throwAfterMove.clear();
  slow = false;
  setWorkspaceLayoutActive(false);
  lockMock.mockReset();
  lockMock.mockResolvedValue(true);
});
afterAll(() => setWorkspaceLayoutActive(false));

describe('T1 restoreScene — 이동 확인 뒤에만 씬 추가·기록 삭제', () => {
  test('성공: 복원된 씬 객체를 반환하고 그 객체가 세션에 들어간다', async () => {
    seedTrash({ 'P:S': sceneEntry('S') });
    files.set('outs/P/.trash/S/a.png', '1');
    const svc = await loaded();
    const sess = makeSession('P', []);
    const restored = await svc.restoreScene(sess, 'S');
    expect(restored).toBeDefined();
    expect(restored!.name).toBe('S');
    expect(sess.scenes.get('S')).toBe(restored);
    expect(files.get('outs/P/S/a.png')).toBe('1');
    expect(trashJson().scenes['P:S']).toBeUndefined();
    expect(lockMock).toHaveBeenCalledWith('P', '씬 복원');
  });

  test('이미지 없는 씬(휴지통 폴더 없음)도 복원', async () => {
    seedTrash({ 'P:E': sceneEntry('E') });
    const svc = await loaded();
    const sess = makeSession('P', []);
    expect(await svc.restoreScene(sess, 'E')).toBeDefined();
    expect(sess.hasScene('scene', 'E')).toBe(true);
  });

  test('폴더 이동 실패 → throw, 씬 미추가·휴지통 기록·파일 그대로', async () => {
    seedTrash({ 'P:S': sceneEntry('S') });
    files.set('outs/P/.trash/S/a.png', '1');
    failRenameDir.add('outs/P/.trash/S');
    const svc = await loaded();
    const sess = makeSession('P', []);
    await expect(svc.restoreScene(sess, 'S')).rejects.toThrow('복원하지 못했습니다');
    expect(sess.hasScene('scene', 'S')).toBe(false);
    expect(trashJson().scenes['P:S']).toBeDefined();
    expect(svc.getDeletedScenes('P').map((x) => x.name)).toEqual(['S']);
    expect(files.get('outs/P/.trash/S/a.png')).toBe('1');
    expect(exists('outs/P/S')).toBe(false);
  });

  test('오류가 났어도 실제로 옮겨졌으면(원본 없음·대상 있음) 성공으로 본다', async () => {
    seedTrash({ 'P:S': sceneEntry('S') });
    files.set('outs/P/.trash/S/a.png', '1');
    throwAfterMove.add('outs/P/.trash/S');
    const svc = await loaded();
    const sess = makeSession('P', []);
    expect(await svc.restoreScene(sess, 'S')).toBeDefined();
    expect(files.get('outs/P/S/a.png')).toBe('1');
    expect(trashJson().scenes['P:S']).toBeUndefined();
  });

  test('원래 위치에 같은 이름 폴더가 있으면 합치지 않고 중단', async () => {
    seedTrash({ 'P:S': sceneEntry('S') });
    files.set('outs/P/.trash/S/a.png', 'trash');
    files.set('outs/P/S/a.png', 'orphan'); // 씬 없는 같은 이름 폴더
    const svc = await loaded();
    const sess = makeSession('P', []);
    await expect(svc.restoreScene(sess, 'S')).rejects.toThrow('합치지 않았습니다');
    expect(files.get('outs/P/S/a.png')).toBe('orphan');
    expect(files.get('outs/P/.trash/S/a.png')).toBe('trash');
    expect(sess.hasScene('scene', 'S')).toBe(false);
    expect(trashJson().scenes['P:S']).toBeDefined();
  });

  test('변형 씬: 폴더 이동 실패 시 먼저 옮긴 마스크·원본을 휴지통으로 되돌린다', async () => {
    seedTrash({ 'P:M': sceneEntry('M', 'inpaint') });
    files.set('inpaints/P/.trash/M/a.png', '1');
    files.set('inpaint_masks/P/.trash/M.png', 'mask');
    files.set('inpaint_orgs/P/.trash/M.png', 'org');
    failRenameDir.add('inpaints/P/.trash/M');
    const svc = await loaded();
    const sess = makeSession('P', []);
    await expect(svc.restoreScene(sess, 'M')).rejects.toThrow('복원하지 못했습니다');
    expect(files.get('inpaint_masks/P/.trash/M.png')).toBe('mask');
    expect(files.get('inpaint_orgs/P/.trash/M.png')).toBe('org');
    expect(files.has('inpaint_masks/P/M.png')).toBe(false);
    expect(files.has('inpaint_orgs/P/M.png')).toBe(false);
    expect(sess.hasScene('inpaint', 'M')).toBe(false);
    expect(trashJson().scenes['P:M']).toBeDefined();
  });

  test('변형 씬: 마스크 이동 실패 → 앞서 옮긴 마스크 되돌림, 폴더는 건드리지 않음', async () => {
    seedTrash({ 'P:M': sceneEntry('M', 'inpaint') });
    files.set('inpaints/P/.trash/M/a.png', '1');
    files.set('inpaint_masks/P/.trash/M.png', 'mask');
    files.set('inpaint_orgs/P/.trash/M.png', 'org');
    failRenameFile.add('inpaint_orgs/P/.trash/M.png');
    const svc = await loaded();
    const sess = makeSession('P', []);
    await expect(svc.restoreScene(sess, 'M')).rejects.toThrow('마스크/원본');
    expect(files.get('inpaint_masks/P/.trash/M.png')).toBe('mask');
    expect(files.has('inpaints/P/.trash/M/a.png')).toBe(true);
    expect(sess.hasScene('inpaint', 'M')).toBe(false);
  });

  test('변형 씬: 원래 위치에 같은 이름 마스크가 있으면 덮어쓰지 않고 중단', async () => {
    seedTrash({ 'P:M': sceneEntry('M', 'inpaint') });
    files.set('inpaint_masks/P/.trash/M.png', 'mask');
    files.set('inpaint_masks/P/M.png', 'other');
    const svc = await loaded();
    const sess = makeSession('P', []);
    await expect(svc.restoreScene(sess, 'M')).rejects.toThrow('이미 있습니다');
    expect(files.get('inpaint_masks/P/M.png')).toBe('other');
    expect(files.get('inpaint_masks/P/.trash/M.png')).toBe('mask');
  });

  test('다른 창 잠금 → undefined, 파일·씬·기록 무변경', async () => {
    seedTrash({ 'P:S': sceneEntry('S') });
    files.set('outs/P/.trash/S/a.png', '1');
    lockMock.mockResolvedValueOnce(false);
    const svc = await loaded();
    const sess = makeSession('P', []);
    expect(await svc.restoreScene(sess, 'S')).toBeUndefined();
    expect(sess.hasScene('scene', 'S')).toBe(false);
    expect(files.has('outs/P/.trash/S/a.png')).toBe(true);
    expect(trashJson().scenes['P:S']).toBeDefined();
  });

  test('씬 데이터 역직렬화 실패 → 파일을 옮기기 전에 중단', async () => {
    seedTrash({ 'P:S': sceneEntry('S', 'scene', { broken: true }) });
    files.set('outs/P/.trash/S/a.png', '1');
    const svc = await loaded();
    const sess = makeSession('P', []);
    await expect(svc.restoreScene(sess, 'S')).rejects.toThrow('씬 데이터를 복원할 수 없습니다');
    expect(files.has('outs/P/.trash/S/a.png')).toBe(true);
    expect(exists('outs/P/S')).toBe(false);
    expect(trashJson().scenes['P:S']).toBeDefined();
  });
});

describe('T4 moveSceneToTrash — 슬롯 이름 반환', () => {
  test('첫 삭제는 원래 이름, 같은 이름 재삭제는 「(삭제 2)」 를 돌려준다 → 그 이름으로 복원', async () => {
    files.set('outs/P/S/a.png', '1');
    const svc = await loaded();
    const s1 = makeScene('S');
    const sess = makeSession('P', [s1]);
    expect(await svc.moveSceneToTrash(sess, s1)).toBe('S');
    const s2 = makeScene('S');
    sess.addScene(s2);
    const slot = await svc.moveSceneToTrash(sess, s2);
    expect(slot).toBe('S (삭제 2)');
    const restored = await svc.restoreScene(sess, slot!);
    expect(restored!.name).toBe('S (삭제 2)');
  });

  test('다른 창 잠금 → undefined, 씬 남음', async () => {
    const svc = await loaded();
    const s = makeScene('S');
    const sess = makeSession('P', [s]);
    lockMock.mockResolvedValueOnce(false);
    expect(await svc.moveSceneToTrash(sess, s)).toBeUndefined();
    expect(sess.hasScene('scene', 'S')).toBe(true);
    expect(trashJson().scenes['P:S']).toBeUndefined();
  });
});

describe('T2 restoreImages — { restored, failed }, 같은 이름은 덮어쓰지 않음', () => {
  const sess = { name: 'P' } as any;
  const scene = { name: 'S', type: 'scene' } as any;
  const META = 'outs/P/S/.trash/.trash_meta.json';
  const meta = () => JSON.parse(files.get(META) || '{}');

  test('같은 이름 파일이 원래 위치에 있으면 failed, 두 파일 모두 원래 내용 그대로', async () => {
    files.set('outs/P/S/a.png', 'current');
    files.set('outs/P/S/.trash/a.png', 'deleted');
    files.set(META, JSON.stringify({ 'a.png': 10 }));
    const svc = await loaded();
    const r = await svc.restoreImages(sess, scene, ['a.png']);
    // missing(U4 사유 구분) = 휴지통에도 원래 위치에도 없던 것 — 같은 이름 충돌은 아님
    expect(r).toEqual({ restored: [], failed: ['a.png'], missing: [] });
    expect(files.get('outs/P/S/a.png')).toBe('current');
    expect(files.get('outs/P/S/.trash/a.png')).toBe('deleted');
    expect(meta()).toEqual({ 'a.png': 10 });
  });

  test('혼합: 충돌·성공·휴지통에 없음·이동 실패·오류 뒤 실제 이동', async () => {
    files.set('outs/P/S/a.png', 'current');
    files.set('outs/P/S/.trash/a.png', 'A');
    files.set('outs/P/S/.trash/b.png', 'B');
    files.set('outs/P/S/.trash/d.png', 'D');
    files.set('outs/P/S/.trash/e.png', 'E');
    files.set(
      META,
      JSON.stringify({ 'a.png': 1, 'b.png': 2, 'c.png': 3, 'd.png': 4, 'e.png': 5 }),
    );
    failRenameFile.add('outs/P/S/.trash/d.png');
    throwAfterMove.add('outs/P/S/.trash/e.png');
    const svc = await loaded();
    const r = await svc.restoreImages(sess, scene, ['a.png', 'b.png', 'c.png', 'd.png', 'e.png']);
    expect(r.restored).toEqual(['b.png', 'e.png']);
    expect(r.failed).toEqual(['a.png', 'c.png', 'd.png']);
    // 사유 구분(U4): 휴지통에 없던 c 만 missing — a(같은 이름 있음)·d(이동 실패)는 아님
    expect(r.missing).toEqual(['c.png']);
    expect(files.get('outs/P/S/b.png')).toBe('B');
    expect(files.get('outs/P/S/e.png')).toBe('E');
    expect(files.get('outs/P/S/.trash/d.png')).toBe('D');
    expect(meta()).toEqual({ 'a.png': 1, 'c.png': 3, 'd.png': 4 });
  });

  test('moveImagesToTrashDetailed: 옮겨진 경로·실패 경로(입력 그대로), 숫자 반환판은 실패 수', async () => {
    files.set('outs/P/S/x.png', 'X');
    files.set('outs/P/S/y.png', 'Y');
    failRenameFile.add('outs/P/S/y.png');
    const svc = await loaded();
    const r = await svc.moveImagesToTrashDetailed(sess, scene, [
      'outs/P/S/x.png',
      'outs/P/S/y.png',
    ]);
    expect(r).toEqual({ moved: ['outs/P/S/x.png'], failed: ['outs/P/S/y.png'] });
    expect(Object.keys(meta())).toEqual(['x.png']);
    expect(await svc.moveImagesToTrash(sess, scene, ['outs/P/S/y.png'])).toBe(1);
  });
});

describe('T3 이미지 휴지통 meta 직렬화', () => {
  const sess = { name: 'P' } as any;
  const scene = { name: 'S', type: 'scene' } as any;
  const META = 'outs/P/S/.trash/.trash_meta.json';
  const meta = () => JSON.parse(files.get(META) || '{}');

  function seedOneDeleted() {
    files.set('outs/P/S/b.png', 'B'); // 지금 지울 파일
    files.set('outs/P/S/.trash/a.png', 'A'); // 휴지통에 있는 파일
    files.set(META, JSON.stringify({ 'a.png': 10 }));
  }

  test('삭제·복원 동시 호출에서 meta 항목이 사라지지 않는다', async () => {
    seedOneDeleted();
    const svc = await loaded();
    slow = true;
    const [moved, restored] = await Promise.all([
      svc.moveImagesToTrashDetailed(sess, scene, ['outs/P/S/b.png']),
      svc.restoreImages(sess, scene, ['a.png']),
    ]);
    expect(moved.moved).toEqual(['outs/P/S/b.png']);
    expect(restored.restored).toEqual(['a.png']);
    expect(Object.keys(meta())).toEqual(['b.png']); // b 기록 보존, a 기록 제거
    expect(files.has('outs/P/S/.trash/b.png')).toBe(true);
    expect(files.has('outs/P/S/a.png')).toBe(true);
  });

  test('대조군: 직렬화 없이 같은 동시 호출을 하면 이 모킹에서 항목이 유실된다', async () => {
    seedOneDeleted();
    const svc = await loaded();
    (svc as any).imageMetaQueue = { run: (_k: string, fn: () => Promise<unknown>) => fn() };
    slow = true;
    await Promise.all([
      svc.moveImagesToTrashDetailed(sess, scene, ['outs/P/S/b.png']),
      svc.restoreImages(sess, scene, ['a.png']),
    ]);
    // 나중에 쓴 쪽이 앞의 변경을 덮어씀 — 둘 중 하나가 틀린다
    const m = meta();
    expect('b.png' in m && !('a.png' in m)).toBe(false);
  });

  test('자동 정리와 휴지통 이동 동시 실행에서도 새 항목의 시각이 보존된다', async () => {
    files.set('projects/P.json', '{}');
    files.set('outs/P/S/b.png', 'B');
    files.set('outs/P/S/.trash/old.png', 'O');
    files.set(META, JSON.stringify({ 'old.png': 1 })); // 아주 오래됨 → 자동 정리 대상
    const svc = await loaded();
    slow = true;
    const before = Date.now();
    await Promise.all([
      svc.autoCleanup(),
      svc.moveImagesToTrashDetailed(sess, scene, ['outs/P/S/b.png']),
    ]);
    const m = meta();
    expect(m['old.png']).toBeUndefined();
    expect(files.has('outs/P/S/.trash/old.png')).toBe(false);
    expect(m['b.png']).toBeGreaterThanOrEqual(before);
    expect(files.has('outs/P/S/.trash/b.png')).toBe(true);
  });

  test('복원 두 건 동시 호출 — 서로의 meta 삭제를 되살리지 않는다', async () => {
    files.set('outs/P/S/.trash/a.png', 'A');
    files.set('outs/P/S/.trash/c.png', 'C');
    files.set(META, JSON.stringify({ 'a.png': 1, 'c.png': 2 }));
    const svc = await loaded();
    slow = true;
    await Promise.all([
      svc.restoreImages(sess, scene, ['a.png']),
      svc.restoreImages(sess, scene, ['c.png']),
    ]);
    expect(meta()).toEqual({});
  });
});

describe('KeyedSerialQueue', () => {
  const tick = () => new Promise<void>((r) => setTimeout(r, 0));

  test('같은 키는 도착 순서대로 하나씩, 다른 키는 동시에', async () => {
    const q = new KeyedSerialQueue();
    const log: string[] = [];
    const job = (key: string, id: string) =>
      q.run(key, async () => {
        log.push(id + ':start');
        await tick();
        await tick();
        log.push(id + ':end');
        return id;
      });
    const results = await Promise.all([job('k', 'a'), job('k', 'b'), job('other', 'c')]);
    expect(results).toEqual(['a', 'b', 'c']);
    expect(log.indexOf('a:end')).toBeLessThan(log.indexOf('b:start'));
    expect(log.indexOf('c:start')).toBeLessThan(log.indexOf('a:end'));
    expect(q.pendingKeys).toBe(0);
  });

  test('앞 작업이 throw 해도 다음 작업이 실행되고 오류는 그 호출자에게만', async () => {
    const q = new KeyedSerialQueue();
    const first = q.run('k', async () => {
      throw new Error('boom');
    });
    const second = q.run('k', async () => 'ok');
    await expect(first).rejects.toThrow('boom');
    await expect(second).resolves.toBe('ok');
    expect(q.pendingKeys).toBe(0);
  });
});
