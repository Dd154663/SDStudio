/**
 * 프로젝트 휴지통 사이드카 보존(2026-11-03) — 실제 SessionService.delete / restoreProjectFromTrash 와
 * 실제 TrashService 를 메모리 파일시스템으로 묶어 검증한다.
 *  · 삭제: 메타 정리 직전 즐겨찾기·씬 북마크·이미지 북마크(접두 뗀 키)·썸네일을 trash.json 에 스냅숏
 *    (신 배치 sidecars[dir] — 동명 공존, 구 배치 sidecar — 이름 단위)
 *  · 복원: 최종 이름으로 재적용(새 이름이면 키 교체), 옛 항목(키 없음)은 현행처럼 아무것도 되살리지 않음
 *  · 영구 삭제·미루기에서 스냅숏 수명, 재적용 실패해도 복원 유지, 저장 차단 시 메모리만 반영
 * (모킹 방식은 trashCoexist.test.ts·folderDeleteTrashKeep.test.ts 와 같다.)
 */

// ---- 메모리 파일시스템 ----
const files = new Map<string, string>();
const failWrite = new Set<string>(); // 이 경로의 persistService.write 를 실패시킨다

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

// 실제 TrashService 인스턴스 — '..' 모킹의 getter 로 SessionService 에 연결한다.
const mockRefs: { trash: any } = { trash: undefined };

jest.mock('..', () => ({
  backend: {
    existFile: jest.fn(async (p: string) => exists(p)),
    readFile: jest.fn(async (p: string) => {
      if (!files.has(p)) throw new Error('ENOENT ' + p);
      return files.get(p)!;
    }),
    writeFile: jest.fn(async (p: string, c: string) => {
      files.set(p, c);
    }),
    copyFile: jest.fn(async () => {}),
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
  templateService: { removeProject: jest.fn(async () => {}) },
  taskQueueService: { addLog: jest.fn() },
  get trashService() {
    return mockRefs.trash;
  },
  sessionService: { guardCrossWindowLock: jest.fn(async () => true) },
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
jest.mock('../../defaultassets', () => ({ __esModule: true, default: [] }));

import { SessionService } from '../SessionService';
import { ResourceSyncService } from '../ResourceSyncService';
import { TrashService } from '../TrashService';
import { backend } from '..';
import {
  physicalDirOf,
  registerProjectDir,
  unregisterProjectDir,
  setWorkspaceLayoutActive,
} from '../storageLayout';
import { DELETE_RESULT_TEXT, projectRestoreResultText } from '../deleteFlowRules';

const A = 'P__aaaaaaaa';
const B = 'P__bbbbbbbb';
const meta = (name: string, id: string) => JSON.stringify({ version: 1, id, name, folder: '' });
const trashJson = () => JSON.parse(files.get('trash.json') || '{"scenes":{},"projects":{}}');
const readJson = (p: string) => JSON.parse(files.get(p)!);

// 기본 delete(ResourceSyncService) 대역 — 실제와 같이 활성 json 을 .deleted 로 옮기고 메모리에서 내린다.
let deleteSpy: jest.SpyInstance;

let services: any[] = [];
async function setup(): Promise<{ svc: any; trash: TrashService }> {
  const trash = new TrashService();
  await trash.loadTrash();
  mockRefs.trash = trash;
  const svc = new SessionService() as any;
  services.push(svc);
  svc.guardCrossWindowLock = jest.fn(async () => true);
  svc.isLoaded = jest.fn(() => true);
  svc.update = jest.fn(async () => {});
  svc.favorites = new Set<string>();
  svc.bookmarkData = { scenes: {}, images: {} };
  svc.thumbnailData = {};
  return { svc, trash };
}

// 삭제 전 사이드카 상태(프로젝트 P + 다른 프로젝트 Q 몫 — Q 는 건드리지 않아야 한다)
function seedSidecars(svc: any) {
  svc.favorites = new Set(['P', 'Q']);
  svc.bookmarkData = {
    scenes: { P: { name: 'S1', type: 'scene' }, Q: { name: 'X', type: 'scene' } },
    images: { 'P:S1': 'a.png', 'P:S:2': 'b.png', 'Q:X': 'q.png', 'PP:S1': 'pp.png' },
  };
  svc.thumbnailData = { P: { scene: 'S1', image: 'a.png' }, Q: { scene: 'X', image: 'q.png' } };
}

beforeEach(() => {
  files.clear();
  failWrite.clear();
  setWorkspaceLayoutActive(false);
  unregisterProjectDir('P');
  unregisterProjectDir('P (2)');
  deleteSpy = jest
    .spyOn(ResourceSyncService.prototype, 'delete')
    .mockImplementation(async function (this: any, name: string) {
      const dir = physicalDirOf(name);
      const src = dir ? `workspace/${dir}/project.json` : `projects/${name}.json`;
      const dst = dir ? `workspace/${dir}/project.json.deleted` : `projects/${name}.deleted`;
      await (backend as any).renameFile(src, dst);
    });
});
afterEach(() => {
  deleteSpy.mockRestore();
  for (const s of services) if (s.thumbnailSaveTimer) clearTimeout(s.thumbnailSaveTimer);
  services = [];
});
afterAll(() => setWorkspaceLayoutActive(false));

describe('삭제 — 스냅숏 저장', () => {
  test('구 배치: 이름 단위 sidecar 에 즐겨찾기·씬 북마크·이미지 북마크(접두 뗀 키)·썸네일', async () => {
    files.set('projects/P.json', '{"name":"P"}');
    const { svc } = await setup();
    seedSidecars(svc);
    await svc.delete('P');

    const rec = trashJson().projects.P;
    expect(rec.sidecars).toBeUndefined();
    expect(rec.sidecar).toEqual({
      favorite: true,
      sceneBookmark: { name: 'S1', type: 'scene' },
      imageBookmarks: { S1: 'a.png', 'S:2': 'b.png' }, // 씬 이름의 콜론은 그대로, 다른 프로젝트(PP) 키 제외
      thumbnail: { scene: 'S1', image: 'a.png' },
    });
    // 기존 정리는 그대로 — P 몫만 지워지고 Q·PP 는 유지
    expect(readJson('favorites.json')).toEqual(['Q']);
    expect(readJson('bookmarks.json')).toEqual({
      scenes: { Q: { name: 'X', type: 'scene' } },
      images: { 'Q:X': 'q.png', 'PP:S1': 'pp.png' },
    });
    expect(svc.getThumbnailRef('P')).toBeUndefined();
    expect(svc.getThumbnailRef('Q')).toEqual({ scene: 'X', image: 'q.png' });
  });

  test('신 배치: sidecars[dir] — 같은 이름의 다른 휴지통 폴더 스냅숏은 그대로', async () => {
    setWorkspaceLayoutActive(true);
    files.set(`workspace/${A}/meta.json`, meta('P', 'a'));
    files.set(`workspace/${A}/project.json.deleted`, '{}');
    files.set(`workspace/${B}/meta.json`, meta('P', 'b'));
    files.set(`workspace/${B}/project.json`, '{}');
    files.set(
      'trash.json',
      JSON.stringify({
        scenes: {},
        projects: { P: { deletedAt: 100, dirs: { [A]: 100 }, sidecars: { [A]: { favorite: true } } } },
      }),
    );
    registerProjectDir('P', B);
    const { svc } = await setup();
    svc.bookmarkData = { scenes: {}, images: { 'P:T': 't.png' } };
    await svc.delete('P');

    const rec = trashJson().projects.P;
    expect(Object.keys(rec.dirs).sort()).toEqual([A, B].sort());
    expect(rec.sidecars[A]).toEqual({ favorite: true });
    expect(rec.sidecars[B]).toEqual({ favorite: false, imageBookmarks: { T: 't.png' } });
    expect(rec.sidecar).toBeUndefined();
    expect(physicalDirOf('P')).toBeUndefined(); // 레지스트리 해제(기존 동작)
  });

  test('되살릴 것이 없으면 스냅숏 키를 만들지 않는다(예전 형식 그대로)', async () => {
    files.set('projects/P.json', '{}');
    const { svc } = await setup();
    await svc.delete('P');
    expect(Object.keys(trashJson().projects.P)).toEqual(['deletedAt']);
  });

  test('삭제(파일 이동)가 실패하면 메타도 휴지통 기록도 건드리지 않는다', async () => {
    files.set('projects/P.json', '{}');
    const { svc } = await setup();
    seedSidecars(svc);
    deleteSpy.mockImplementationOnce(async () => {
      throw new Error('EPERM');
    });
    await expect(svc.delete('P')).rejects.toThrow('EPERM');
    expect(svc.isFavorite('P')).toBe(true);
    expect(svc.getSceneBookmark('P')).toEqual({ name: 'S1', type: 'scene' });
    expect(files.has('favorites.json')).toBe(false);
    expect(trashJson().projects.P).toBeUndefined();
  });
});

describe('복원 — 재적용', () => {
  test('구 배치: 삭제 → 복원하면 즐겨찾기·씬 북마크·이미지 북마크·썸네일이 돌아온다', async () => {
    files.set('projects/P.json', '{}');
    const { svc } = await setup();
    seedSidecars(svc);
    await svc.delete('P');
    const r = await svc.restoreProjectFromTrash('P');

    expect(r).toEqual({ name: 'P', dir: undefined, sidecarRestored: true, sidecarFailed: [] });
    expect(files.has('projects/P.json')).toBe(true);
    expect(svc.isFavorite('P')).toBe(true);
    expect(readJson('favorites.json').sort()).toEqual(['P', 'Q']);
    const bm = readJson('bookmarks.json');
    expect(bm.scenes.P).toEqual({ name: 'S1', type: 'scene' });
    expect(bm.images['P:S1']).toBe('a.png');
    expect(bm.images['P:S:2']).toBe('b.png');
    expect(bm.images['PP:S1']).toBe('pp.png');
    expect(svc.getThumbnailRef('P')).toEqual({ scene: 'S1', image: 'a.png' });
    expect(trashJson().projects.P).toBeUndefined(); // 스냅숏도 항목과 함께 사라짐
    expect(svc.update).toHaveBeenCalled();
  });

  test('신 배치 새 이름 복원: 즐겨찾기·북마크·썸네일 키가 새 이름으로', async () => {
    setWorkspaceLayoutActive(true);
    files.set(`workspace/${A}/meta.json`, meta('P', 'a'));
    files.set(`workspace/${A}/project.json`, '{}');
    registerProjectDir('P', A);
    const { svc } = await setup();
    seedSidecars(svc);
    await svc.delete('P');
    // 같은 이름 P 를 새로 만든 상태(활성 동명) → 새 이름으로 복원
    files.set(`workspace/${B}/meta.json`, meta('P', 'b'));
    files.set(`workspace/${B}/project.json`, '{}');
    registerProjectDir('P', B);

    const r = await svc.restoreProjectFromTrash('P', { dir: A, newName: 'P (2)' });
    expect(r.name).toBe('P (2)');
    expect(r.dir).toBe(A);
    expect(r.sidecarRestored).toBe(true);
    expect(svc.isFavorite('P (2)')).toBe(true);
    expect(svc.isFavorite('P')).toBe(false); // 새로 만든 활성 P 의 즐겨찾기는 건드리지 않음
    expect(svc.getSceneBookmark('P (2)')).toEqual({ name: 'S1', type: 'scene' });
    expect(svc.getSceneBookmark('P')).toBeUndefined();
    expect(svc.getImageBookmark('P (2)', 'S1')).toBe('a.png');
    expect(svc.getImageBookmark('P (2)', 'S:2')).toBe('b.png');
    expect(svc.getImageBookmark('P', 'S1')).toBeUndefined();
    expect(svc.getThumbnailRef('P (2)')).toEqual({ scene: 'S1', image: 'a.png' });
    expect(physicalDirOf('P (2)')).toBe(A);
    expect(trashJson().projects.P).toBeUndefined();
  });

  test('스냅숏 없는 옛 휴지통 항목 복원 = 현행(아무것도 되살리지 않음)', async () => {
    files.set('projects/P.deleted', '{}');
    files.set('trash.json', JSON.stringify({ scenes: {}, projects: { P: { deletedAt: 5 } } }));
    const { svc } = await setup();
    const r = await svc.restoreProjectFromTrash('P');
    expect(r.sidecarRestored).toBe(false);
    expect(r.sidecarFailed).toEqual([]);
    expect(files.has('projects/P.json')).toBe(true);
    expect(svc.isFavorite('P')).toBe(false);
    expect(files.has('favorites.json')).toBe(false);
    expect(files.has('bookmarks.json')).toBe(false);
    expect(svc.getThumbnailRef('P')).toBeUndefined();
  });

  test('신 배치 동명 공존: 폴더마다 다른 스냅숏 — 복원한 폴더 것만 쓰고 나머지는 남는다', async () => {
    setWorkspaceLayoutActive(true);
    files.set(`workspace/${A}/meta.json`, meta('P', 'a'));
    files.set(`workspace/${A}/project.json.deleted`, '{}');
    files.set(`workspace/${B}/meta.json`, meta('P', 'b'));
    files.set(`workspace/${B}/project.json.deleted`, '{}');
    files.set(
      'trash.json',
      JSON.stringify({
        scenes: {},
        projects: {
          P: {
            deletedAt: 200,
            dirs: { [A]: 100, [B]: 200 },
            sidecars: {
              [A]: { favorite: true, sceneBookmark: { name: 'SA', type: 'scene' } },
              [B]: { favorite: false, imageBookmarks: { SB: 'b.png' } },
            },
          },
        },
      }),
    );
    const { svc } = await setup();
    await svc.restoreProjectFromTrash('P', { dir: B });
    expect(svc.isFavorite('P')).toBe(false);
    expect(svc.getSceneBookmark('P')).toBeUndefined();
    expect(svc.getImageBookmark('P', 'SB')).toBe('b.png');
    const rec = trashJson().projects.P;
    expect(rec.dirs).toEqual({ [A]: 100 });
    expect(rec.sidecars).toEqual({
      [A]: { favorite: true, sceneBookmark: { name: 'SA', type: 'scene' } },
    });
  });

  test('재적용 저장 실패: 복원은 유지하고 실패 항목만 알린다', async () => {
    files.set('projects/P.json', '{}');
    const { svc } = await setup();
    seedSidecars(svc);
    await svc.delete('P');
    failWrite.add('bookmarks.json');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await svc.restoreProjectFromTrash('P');
    warn.mockRestore();
    expect(files.has('projects/P.json')).toBe(true); // 복원 유지
    expect(r.sidecarRestored).toBe(true);
    expect(r.sidecarFailed).toEqual(['bookmark']);
    expect(readJson('favorites.json')).toContain('P'); // 다른 항목은 저장됨
    expect(trashJson().projects.P).toBeUndefined();
    expect(projectRestoreResultText('P', undefined, r.sidecarFailed.length > 0)).toBe(
      `${DELETE_RESULT_TEXT.projectRestored('P')} ${DELETE_RESULT_TEXT.projectSidecarRestoreFailed}`,
    );
  });

  test('저장 차단(부팅 로드 실패) 상태면 메모리만 반영하고 파일은 쓰지 않는다', async () => {
    files.set('projects/P.deleted', '{}');
    files.set(
      'trash.json',
      JSON.stringify({ scenes: {}, projects: { P: { deletedAt: 5, sidecar: { favorite: true } } } }),
    );
    const { svc } = await setup();
    svc.metaLoadFailed.add('favorites.json');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await svc.restoreProjectFromTrash('P');
    warn.mockRestore();
    expect(svc.isFavorite('P')).toBe(true);
    expect(files.has('favorites.json')).toBe(false);
    expect(r.sidecarFailed).toEqual([]);
  });

  test('복원 실패(휴지통에 없음)면 아무것도 재적용하지 않고 오류를 그대로 던진다', async () => {
    files.set(
      'trash.json',
      JSON.stringify({ scenes: {}, projects: { P: { deletedAt: 5, sidecar: { favorite: true } } } }),
    );
    const { svc } = await setup();
    await expect(svc.restoreProjectFromTrash('P')).rejects.toThrow('찾을 수 없습니다');
    expect(svc.isFavorite('P')).toBe(false);
    expect(trashJson().projects.P.sidecar).toEqual({ favorite: true }); // 스냅숏 보존
  });

  test('구 배치에서 지운 뒤 저장소 v2 로 바뀐 항목(이름 단위 sidecar)도 그 폴더 복원 때 쓴다', async () => {
    setWorkspaceLayoutActive(true);
    files.set(`workspace/${A}/meta.json`, meta('P', 'a'));
    files.set(`workspace/${A}/project.json.deleted`, '{}');
    files.set(
      'trash.json',
      JSON.stringify({ scenes: {}, projects: { P: { deletedAt: 5, sidecar: { favorite: true } } } }),
    );
    const { svc } = await setup();
    await svc.restoreProjectFromTrash('P', { dir: A });
    expect(svc.isFavorite('P')).toBe(true);
  });
});

describe('TrashService — 스냅숏 수명', () => {
  function seedTwo() {
    setWorkspaceLayoutActive(true);
    files.set(`workspace/${A}/meta.json`, meta('P', 'a'));
    files.set(`workspace/${A}/project.json.deleted`, '{}');
    files.set(`workspace/${B}/meta.json`, meta('P', 'b'));
    files.set(`workspace/${B}/project.json.deleted`, '{}');
    files.set(
      'trash.json',
      JSON.stringify({
        scenes: {},
        projects: {
          P: {
            deletedAt: 200,
            dirs: { [A]: 100, [B]: 200 },
            sidecars: { [A]: { favorite: true }, [B]: { favorite: true } },
          },
        },
      }),
    );
  }

  test('영구 삭제(폴더 지정)는 그 폴더 스냅숏만, 마지막 폴더면 항목째 사라진다', async () => {
    seedTwo();
    const { trash } = await setup();
    await trash.permanentlyDeleteProject('P', A);
    expect(trashJson().projects.P.sidecars).toEqual({ [B]: { favorite: true } });
    await trash.permanentlyDeleteProject('P', B);
    expect(trashJson().projects.P).toBeUndefined();
  });

  test('구 배치 영구 삭제는 항목(스냅숏 포함)을 지운다', async () => {
    files.set('projects/P.deleted', '{}');
    files.set(
      'trash.json',
      JSON.stringify({ scenes: {}, projects: { P: { deletedAt: 5, sidecar: { favorite: true } } } }),
    );
    const { trash } = await setup();
    await trash.permanentlyDeleteProject('P');
    expect(trashJson().projects.P).toBeUndefined();
  });

  test('만료 미루기는 시각만 바꾸고 스냅숏은 유지', async () => {
    seedTwo();
    const { trash } = await setup();
    await trash.deferProjects([{ name: 'P', dir: A }]);
    const rec = trashJson().projects.P;
    expect(rec.dirs[A]).toBeGreaterThan(1000);
    expect(rec.sidecars).toEqual({ [A]: { favorite: true }, [B]: { favorite: true } });
  });

  test('신 배치 새 삭제 때 폴더 구분 없던 옛 기록의 이름 단위 스냅숏은 그 휴지통 폴더 몫으로 옮긴다', async () => {
    setWorkspaceLayoutActive(true);
    files.set(`workspace/${A}/meta.json`, meta('P', 'a'));
    files.set(`workspace/${A}/project.json.deleted`, '{}');
    files.set(
      'trash.json',
      JSON.stringify({ scenes: {}, projects: { P: { deletedAt: 50, sidecar: { favorite: true } } } }),
    );
    const { trash } = await setup();
    await trash.moveProjectToTrash('P', B, { favorite: false, thumbnail: { scene: 's', image: 'i' } });
    const rec = trashJson().projects.P;
    expect(rec.dirs[A]).toBe(50);
    expect(rec.sidecar).toBeUndefined();
    expect(rec.sidecars).toEqual({
      [A]: { favorite: true },
      [B]: { favorite: false, thumbnail: { scene: 's', image: 'i' } },
    });
  });

  test('손상된 스냅숏 값은 무시한다(정상 모양만 재적용)', async () => {
    files.set('projects/P.deleted', '{}');
    files.set(
      'trash.json',
      JSON.stringify({
        scenes: {},
        projects: {
          P: {
            deletedAt: 5,
            sidecar: { favorite: 'yes', sceneBookmark: { name: 3 }, imageBookmarks: { S: 1, T: 't.png' }, thumbnail: 'x' },
          },
        },
      }),
    );
    const { svc } = await setup();
    const r = await svc.restoreProjectFromTrash('P');
    expect(r.sidecarRestored).toBe(true);
    expect(svc.isFavorite('P')).toBe(false);
    expect(svc.getSceneBookmark('P')).toBeUndefined();
    expect(svc.getImageBookmark('P', 'S')).toBeUndefined();
    expect(svc.getImageBookmark('P', 'T')).toBe('t.png');
    expect(svc.getThumbnailRef('P')).toBeUndefined();
  });
});

describe('복원 결과 문구(deleteFlowRules)', () => {
  test('원래 이름·새 이름·재적용 실패', () => {
    expect(projectRestoreResultText('P', undefined, false)).toBe('프로젝트 "P"이(가) 복원되었습니다.');
    expect(projectRestoreResultText('P (2)', 'Q', false)).toBe(
      '프로젝트 "P (2)"을(를) "Q"(으)로 복원했습니다.',
    );
    expect(projectRestoreResultText('P', undefined, true)).toContain(
      DELETE_RESULT_TEXT.projectSidecarRestoreFailed,
    );
  });
});
