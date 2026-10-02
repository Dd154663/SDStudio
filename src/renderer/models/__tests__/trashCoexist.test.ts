/**
 * 휴지통 데이터 안전 수정(2026-10-02 S1·S2) — 메모리 파일시스템으로 TrashService 흐름 검증.
 *  S1: 씬 휴지통 슬롯 고유화(같은 이름 재삭제·일반/변형 동명·고아 폴더) + 이동 실패 시 중단
 *  S2: 신 배치에서 같은 이름 휴지통 프로젝트 공존(폴더 단위 목록·복원·영구 삭제), 구 배치 분기 불변
 */

// ---- 메모리 파일시스템 ----
const files = new Map<string, string>();
const failRenameDir = new Set<string>(); // 이 경로(원본)의 renameDir 을 실패시킨다

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
    existFile: jest.fn(async (p: string) => exists(p)),
    readFile: jest.fn(async (p: string) => {
      if (!files.has(p)) throw new Error('ENOENT ' + p);
      return files.get(p)!;
    }),
    writeFile: jest.fn(async (p: string, c: string) => {
      files.set(p, c);
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
    renameDir: jest.fn(async (a: string, b: string) => {
      if (!exists(a)) return;
      if (failRenameDir.has(a)) throw new Error('EPERM ' + a);
      if (exists(b)) throw new Error('ENOTEMPTY ' + b);
      movePrefix(a, b);
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
  templateService: { removeProject: jest.fn(async () => {}) },
  sessionService: { guardCrossWindowLock: jest.fn(async () => true) },
}));
jest.mock('../PersistenceService', () => ({
  persistService: {
    write: jest.fn(async (p: string, c: string) => {
      files.set(p, c);
    }),
  },
}));
jest.mock('../types', () => ({
  genericSceneFromJSON: (j: any) => ({ ...j }),
}));

import { TrashService } from '../TrashService';
import { templateService } from '../index';
import {
  physicalDirOf,
  registerProjectDir,
  setWorkspaceLayoutActive,
} from '../storageLayout';

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

async function loaded() {
  const svc = new TrashService();
  await svc.loadTrash();
  return svc;
}

beforeEach(() => {
  files.clear();
  failRenameDir.clear();
  setWorkspaceLayoutActive(false);
  (templateService.removeProject as jest.Mock).mockClear();
});
afterAll(() => setWorkspaceLayoutActive(false));

describe('S1 씬 휴지통 — 구 배치', () => {
  test('같은 이름 재삭제는 「S (삭제 2)」 슬롯으로 따로 보관(옛 기록·이미지 유지)', async () => {
    files.set('outs/P/S/a.png', '1');
    const svc = await loaded();
    const s1 = makeScene('S');
    const sess = makeSession('P', [s1]);
    await svc.moveSceneToTrash(sess, s1);
    expect(files.has('outs/P/.trash/S/a.png')).toBe(true);

    // 같은 이름 S 를 새로 만들어 이미지 생성 후 다시 삭제
    files.set('outs/P/S/b.png', '2');
    const s2 = makeScene('S');
    sess.addScene(s2);
    await svc.moveSceneToTrash(sess, s2);

    expect(files.has('outs/P/.trash/S/a.png')).toBe(true); // 옛 이미지 그대로
    expect(files.has('outs/P/.trash/S (삭제 2)/b.png')).toBe(true);
    expect(files.has('outs/P/.trash/S/b.png')).toBe(false); // 병합 없음
    const t = trashJson();
    expect(Object.keys(t.scenes).sort()).toEqual(['P:S', 'P:S (삭제 2)']);
    // 키·폴더·sceneData.name 통일(구버전 restoreScene 호환), 원래 이름은 선택 필드
    expect(t.scenes['P:S (삭제 2)'].sceneData.name).toBe('S (삭제 2)');
    expect(t.scenes['P:S (삭제 2)'].originalName).toBe('S');
    expect(t.scenes['P:S'].originalName).toBeUndefined();
    expect(t.scenes['P:S'].projectDir).toBeUndefined(); // 구 배치는 기록 안 함

    const listed = svc.getDeletedScenes('P');
    expect(listed.map((x) => x.name).sort()).toEqual(['S', 'S (삭제 2)']);
    expect(listed.find((x) => x.name === 'S (삭제 2)')!.originalName).toBe('S');
  });

  test('일반 씬 S + 변형 씬 S 를 둘 다 지워도 두 기록이 모두 남는다(키 충돌 없음)', async () => {
    files.set('outs/P/S/a.png', '1');
    files.set('inpaints/P/S/m.png', '2');
    files.set('inpaint_masks/P/S.png', 'mask');
    files.set('inpaint_orgs/P/S.png', 'org');
    const svc = await loaded();
    const gen = makeScene('S', 'scene');
    const mir = makeScene('S', 'inpaint');
    const sess = makeSession('P', [gen, mir]);
    await svc.moveSceneToTrash(sess, gen);
    await svc.moveSceneToTrash(sess, mir);
    const t = trashJson();
    expect(t.scenes['P:S'].sceneData.type).toBe('scene');
    expect(t.scenes['P:S (삭제 2)'].sceneData.type).toBe('inpaint');
    expect(files.has('inpaints/P/.trash/S (삭제 2)/m.png')).toBe(true);
    expect(files.get('inpaint_masks/P/.trash/S (삭제 2).png')).toBe('mask');
    expect(files.get('inpaint_orgs/P/.trash/S (삭제 2).png')).toBe('org');

    // 복원: 슬롯 이름으로 돌아오고 마스크도 같은 이름으로
    await svc.restoreScene(sess, 'S (삭제 2)');
    expect(sess.hasScene('inpaint', 'S (삭제 2)')).toBe(true);
    expect(files.has('inpaints/P/S (삭제 2)/m.png')).toBe(true);
    expect(files.get('inpaint_masks/P/S (삭제 2).png')).toBe('mask');
  });

  test('.trash 에 기록 없는 고아 폴더 S 만 있어도 그 폴더에 병합하지 않는다', async () => {
    files.set('outs/P/.trash/S/orphan.png', 'x');
    files.set('outs/P/S/new.png', 'y');
    const svc = await loaded();
    const s = makeScene('S');
    const sess = makeSession('P', [s]);
    await svc.moveSceneToTrash(sess, s);
    expect(files.get('outs/P/.trash/S/orphan.png')).toBe('x');
    expect(files.has('outs/P/.trash/S/new.png')).toBe(false);
    expect(files.has('outs/P/.trash/S (삭제 2)/new.png')).toBe(true);
  });

  test('이미지 폴더 이동 실패 → throw, 씬·기록 무변경', async () => {
    files.set('outs/P/S/a.png', '1');
    failRenameDir.add('outs/P/S');
    const svc = await loaded();
    const s = makeScene('S');
    const sess = makeSession('P', [s]);
    await expect(svc.moveSceneToTrash(sess, s)).rejects.toThrow('삭제하지 않았습니다');
    expect(sess.hasScene('scene', 'S')).toBe(true);
    expect(files.has('outs/P/S/a.png')).toBe(true);
    expect(trashJson().scenes['P:S']).toBeUndefined();
  });

  test('변형 씬: 폴더 이동 실패 시 먼저 옮긴 마스크·원본을 되돌린다', async () => {
    files.set('inpaints/P/M/a.png', '1');
    files.set('inpaint_masks/P/M.png', 'mask');
    files.set('inpaint_orgs/P/M.png', 'org');
    failRenameDir.add('inpaints/P/M');
    const svc = await loaded();
    const s = makeScene('M', 'inpaint');
    const sess = makeSession('P', [s]);
    await expect(svc.moveSceneToTrash(sess, s)).rejects.toThrow();
    expect(files.get('inpaint_masks/P/M.png')).toBe('mask');
    expect(files.get('inpaint_orgs/P/M.png')).toBe('org');
    expect(files.has('inpaint_masks/P/.trash/M.png')).toBe(false);
    expect(sess.hasScene('inpaint', 'M')).toBe(true);
  });

  test('이미지 없는 씬(폴더 없음)은 정상 삭제', async () => {
    const svc = await loaded();
    const s = makeScene('Empty');
    const sess = makeSession('P', [s]);
    await svc.moveSceneToTrash(sess, s);
    expect(sess.hasScene('scene', 'Empty')).toBe(false);
    expect(trashJson().scenes['P:Empty']).toBeDefined();
  });

  test('구버전 기록(필드 없음)도 그대로 읽고 복원한다', async () => {
    files.set(
      'trash.json',
      JSON.stringify({
        scenes: { 'P:Old': { sceneData: { name: 'Old', type: 'scene' }, deletedAt: 5 } },
        projects: {},
      }),
    );
    files.set('outs/P/.trash/Old/a.png', '1');
    const svc = await loaded();
    const sess = makeSession('P', []);
    expect(svc.getDeletedScenes('P')).toEqual([{ name: 'Old', type: 'scene', deletedAt: 5 }]);
    await svc.restoreScene(sess, 'Old');
    expect(sess.hasScene('scene', 'Old')).toBe(true);
    expect(files.has('outs/P/Old/a.png')).toBe(true);
  });
});

describe('S2 프로젝트 휴지통 — 신 배치 동명 공존', () => {
  const A = 'P__aaaaaaaa';
  const B = 'P__bbbbbbbb';
  const C = 'P__cccccccc';
  const meta = (name: string, id: string) =>
    JSON.stringify({ version: 1, id, name, folder: '' });

  // 같은 이름 P: A(휴지통, 먼저 삭제) · B(휴지통, 나중 삭제) · C(활성)
  function setupWorkspace() {
    setWorkspaceLayoutActive(true);
    files.set(`workspace/${A}/meta.json`, meta('P', 'a'));
    files.set(`workspace/${A}/project.json.deleted`, '{"name":"P"}');
    files.set(`workspace/${A}/project.json.bak`, '{"name":"P"}');
    files.set(`workspace/${A}/outs/S/a.png`, '1');
    files.set(`workspace/${B}/meta.json`, meta('P', 'b'));
    files.set(`workspace/${B}/project.json.deleted`, '{"name":"P"}');
    files.set(`workspace/${C}/meta.json`, meta('P', 'c'));
    files.set(`workspace/${C}/project.json`, '{"name":"P"}');
    files.set(`workspace/${C}/outs/S/c.png`, '3');
    registerProjectDir('P', C);
    files.set(
      'trash.json',
      JSON.stringify({
        scenes: {
          'P:S': { sceneData: { name: 'S', type: 'scene' }, deletedAt: 10, projectDir: A },
          'P:T': { sceneData: { name: 'T', type: 'scene' }, deletedAt: 11, projectDir: C },
          'P:L': { sceneData: { name: 'L', type: 'scene' }, deletedAt: 12 }, // 구버전 기록
        },
        projects: { P: { deletedAt: 200, dirs: { [A]: 100, [B]: 200 } } },
      }),
    );
  }

  test('목록: 활성 동명이 있어도 휴지통 폴더를 전부 보여 준다(폴더 단위)', async () => {
    setupWorkspace();
    const svc = await loaded();
    const list = await svc.getDeletedProjects();
    expect(list.map((p) => [p.name, p.dir, p.deletedAt]).sort()).toEqual([
      ['P', A, 100],
      ['P', B, 200],
    ]);
  });

  test('씬 휴지통은 projectDir 로 소속 판정(다른 폴더 기록은 숨김, 구버전 기록은 이름으로)', async () => {
    setupWorkspace();
    const svc = await loaded();
    expect(svc.getDeletedScenes('P').map((s) => s.name).sort()).toEqual(['L', 'T']);
    const sess = makeSession('P', []);
    await expect(svc.restoreScene(sess, 'S')).rejects.toThrow('다른 프로젝트');
  });

  test('활성 동명 P 의 씬 삭제는 휴지통 P 의 기록 키와 겹치지 않게 슬롯을 고른다', async () => {
    setupWorkspace();
    const svc = await loaded();
    const s = makeScene('S');
    const sess = makeSession('P', [s]);
    await svc.moveSceneToTrash(sess, s);
    const t = trashJson();
    expect(t.scenes['P:S'].projectDir).toBe(A); // 옛 기록 보존
    expect(t.scenes['P:S (삭제 2)'].projectDir).toBe(C);
    expect(files.has(`workspace/${C}/outs/.trash/S (삭제 2)/c.png`)).toBe(true);
  });

  test('복원: 활성 동명이 있으면 새 이름 없이는 거부하고 휴지통 항목을 지우지 않는다', async () => {
    setupWorkspace();
    const svc = await loaded();
    await expect(svc.restoreProject('P', { dir: B })).rejects.toThrow('새 이름');
    expect(files.has(`workspace/${B}/project.json.deleted`)).toBe(true);
  });

  test('복원: 새 이름이면 meta 이름 갱신·활성화·등록, 그 폴더 소속 씬 기록도 새 이름으로', async () => {
    setupWorkspace();
    const svc = await loaded();
    await svc.restoreProject('P', { dir: A, newName: 'P (2)' });
    expect(files.has(`workspace/${A}/project.json`)).toBe(true);
    expect(files.has(`workspace/${A}/project.json.deleted`)).toBe(false);
    expect(JSON.parse(files.get(`workspace/${A}/meta.json`)!).name).toBe('P (2)');
    expect(physicalDirOf('P (2)')).toBe(A);
    expect(physicalDirOf('P')).toBe(C); // 활성 P 등록은 그대로
    const t = trashJson();
    expect(t.scenes['P (2):S'].projectDir).toBe(A);
    expect(t.scenes['P:S']).toBeUndefined();
    expect(t.scenes['P:T']).toBeDefined();
    expect(t.scenes['P:L']).toBeDefined();
    expect(t.projects.P.dirs).toEqual({ [B]: 200 }); // B 는 휴지통에 남음
  });

  test('영구 삭제(폴더 지정): 그 폴더만 지우고 활성 동명·다른 휴지통 폴더는 그대로', async () => {
    setupWorkspace();
    const svc = await loaded();
    await svc.permanentlyDeleteProject('P', A);
    expect(exists(`workspace/${A}`)).toBe(false);
    expect(files.has(`workspace/${B}/project.json.deleted`)).toBe(true);
    expect(files.has(`workspace/${C}/project.json`)).toBe(true);
    expect(physicalDirOf('P')).toBe(C);
    const t = trashJson();
    expect(t.scenes['P:S']).toBeUndefined(); // A 소속
    expect(t.scenes['P:T']).toBeDefined(); // 활성 C 소속
    expect(t.scenes['P:L']).toBeDefined(); // 소속 모름 — 보존
    expect(t.projects.P.dirs).toEqual({ [B]: 200 });
    expect(templateService.removeProject).not.toHaveBeenCalled(); // 활성 P 의 템플릿 지정 유지
  });

  test('영구 삭제(이름만): 가장 최근 삭제 폴더가 대상(전체 백업 덮어쓰기 호출부 호환)', async () => {
    setupWorkspace();
    const svc = await loaded();
    await svc.permanentlyDeleteProject('P');
    expect(exists(`workspace/${B}`)).toBe(false);
    expect(files.has(`workspace/${A}/project.json.deleted`)).toBe(true);
    expect(files.has(`workspace/${C}/project.json`)).toBe(true);
  });

  test('영구 삭제: 대상 폴더가 활성(등록됨)이면 아무것도 지우지 않는다', async () => {
    setupWorkspace();
    const svc = await loaded();
    await svc.permanentlyDeleteProject('P', C); // C 는 휴지통 항목이 아님 → 대상 없음
    expect(files.has(`workspace/${C}/project.json`)).toBe(true);
    expect(exists(`workspace/${C}/outs/S/c.png`)).toBe(true);
  });

  test('자동 정리 0단계는 신 배치에서 동명 휴지통 항목을 지우지 않는다', async () => {
    setupWorkspace();
    const svc = await loaded();
    await svc.autoCleanup();
    expect(files.has(`workspace/${A}/project.json.deleted`)).toBe(true);
    expect(files.has(`workspace/${A}/project.json.bak`)).toBe(true);
    expect(files.has(`workspace/${B}/project.json.deleted`)).toBe(true);
  });

  test('purgeDeletedProject 는 신 배치에서 아무것도 하지 않는다', async () => {
    setupWorkspace();
    const svc = await loaded();
    await svc.purgeDeletedProject('P');
    expect(files.has(`workspace/${A}/project.json.deleted`)).toBe(true);
    expect(trashJson().projects.P).toBeDefined();
  });

  test('moveProjectToTrash: 폴더별 시각 기록, 폴더 구분 없던 옛 기록은 기존 휴지통 폴더에 붙인다', async () => {
    setWorkspaceLayoutActive(true);
    files.set(`workspace/${A}/meta.json`, meta('P', 'a'));
    files.set(`workspace/${A}/project.json.deleted`, '{}');
    files.set('trash.json', JSON.stringify({ scenes: {}, projects: { P: { deletedAt: 50 } } }));
    const svc = await loaded();
    await svc.moveProjectToTrash('P', B);
    const rec = trashJson().projects.P;
    expect(rec.dirs[A]).toBe(50);
    expect(rec.dirs[B]).toBe(rec.deletedAt);
    expect(rec.deletedAt).toBeGreaterThan(50);
  });

  test('deferProjects: 지정 폴더만 시각 갱신', async () => {
    setupWorkspace();
    const svc = await loaded();
    await svc.deferProjects([{ name: 'P', dir: A }]);
    const rec = trashJson().projects.P;
    expect(rec.dirs[A]).toBeGreaterThan(1000);
    expect(rec.dirs[B]).toBe(200);
  });

  test('renameProjectKeys(신 배치): 활성 프로젝트 소속 씬 기록만 옮기고 휴지통 프로젝트 기록은 그대로', async () => {
    setupWorkspace();
    const svc = await loaded();
    registerProjectDir('Q', C); // 활성 P(C) → Q 로 이름변경된 상태
    await svc.renameProjectKeys('P', 'Q');
    const t = trashJson();
    expect(t.scenes['Q:T']).toBeDefined();
    expect(t.scenes['Q:L']).toBeDefined(); // 구버전 기록은 예전처럼 이름 따라감
    expect(t.scenes['P:S']).toBeDefined(); // 휴지통 P(A) 소속은 남음
    expect(t.projects.P).toBeDefined();
    expect(t.projects.Q).toBeUndefined();
  });
});

describe('S2 — 구 배치 분기 불변', () => {
  test('구 배치: 동명 활성 있으면 목록에서 숨김, purge 는 .deleted 정리', async () => {
    files.set('projects/P.json', '{}');
    files.set('projects/P.deleted', '{}');
    files.set('projects/Q.deleted', '{}');
    const svc = await loaded();
    const list = await svc.getDeletedProjects();
    expect(list.map((p) => p.name)).toEqual(['Q']);
    expect(list[0].dir).toBeUndefined();
    await svc.purgeDeletedProject('Q');
    expect(files.has('projects/Q.deleted')).toBe(false);
  });

  test('구 배치 moveProjectToTrash 는 예전 형식({deletedAt}) 그대로', async () => {
    const svc = await loaded();
    await svc.moveProjectToTrash('P', 'ignored');
    expect(Object.keys(trashJson().projects.P)).toEqual(['deletedAt']);
  });
});
