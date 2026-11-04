// 프로젝트·폴더 삭제류의 되돌리기(2026-11-04 2차 묶음 3 P1-b — 전역 스택, SPEC_GUIDE 「되돌리기 계약」 「2차 P1-b」).
// P1-b-1 프로젝트 삭제 ↔ 휴지통 복원(열지 않음 D8·같은 이름 활성·휴지통에 없음·다른 창 잠금), 휴지통 수동 복원 짝(새 이름 포함),
// P1-b-2 폴더만 삭제(하위 포함 트리·소속·색·순서·템플릿 지정·로컬 템플릿 이미지 재생성 D7, 잠금 부분 실패),
// P1-b-3 폴더+프로젝트 삭제(실제 흐름 runFolderDeleteWithProjects 한 항목·역순 원래 폴더·일부 실패 제외·다시 실행).
jest.mock('..', () => ({ workFlowService: {} }));

import { GLOBAL_UNDO_SCOPE, UNDO_TEXT, UndoService } from '../undoService';
import {
  deleteFolderRecorded,
  deleteFolderWithProjectsRecorded,
  deleteProjectRecorded,
  ProjectDeleteUndoOps,
  restoreProjectRecorded,
} from '../projectDeleteUndo';
import { runFolderDeleteWithProjects } from '../folderDeleteFlow';
import type { FolderTemplateSnapshot } from '../TemplateService';

interface TrashItem {
  name: string;
  dir: string;
  folder: string | null;
  favorite: boolean;
}

const parentOf = (f: string) => (f.lastIndexOf('/') >= 0 ? f.slice(0, f.lastIndexOf('/')) : null);
const inTree = (f: string, root: string) => f === root || f.startsWith(root + '/');

// SessionService·TrashService·TemplateService 규칙을 흉내 내는 가짜(신 배치 — meta.folder 소속, 물리 폴더 dir 불변)
class FakeStore {
  projects: string[] = [];
  dirs: Record<string, string> = {};
  folderMap: Record<string, string | null> = {};
  folders: string[] = [];
  folderColors: Record<string, string> = {};
  folderOrder: string[] = [];
  favorites = new Set<string>();
  trash: TrashItem[] = [];
  current: string | undefined;
  /** 다른 창에서 열린 프로젝트 — 삭제·이동이 조용히 반환 */
  locked = new Set<string>();
  /** 폴더 기본 템플릿 지정(폴더 → id), 폴더 전용 로컬 템플릿(id → 이미지 파일명), 이미지 파일(파일명 → 내용) */
  assignments: Record<string, string> = {};
  locals: Record<string, { folderLocal: true; images: string[] }> = {};
  globals = new Set<string>();
  imageFiles: Record<string, string> = {};
  fileSeq = 0;
  calls: string[] = [];
  nextDir = 0;

  addProject(name: string, folder: string | null = null) {
    this.projects.push(name);
    this.dirs[name] = `${name}__${++this.nextDir}`;
    this.folderMap[name] = folder;
  }

  ops(): ProjectDeleteUndoOps {
    const orderedFolders = () => {
      const known = this.folderOrder.filter((f) => this.folders.includes(f));
      const rest = this.folders.filter((f) => !known.includes(f)).sort();
      return [...known, ...rest];
    };
    const moveToFolder = async (n: string, f: string | null) => {
      if (this.locked.has(n)) return;
      if ((this.folderMap[n] ?? null) === f) return;
      if (f !== null && !this.folders.includes(f)) throw new Error('대상 폴더가 없습니다.');
      this.calls.push(`move:${n}:${f}`);
      this.folderMap[n] = f;
    };
    const getProjectsInFolder = (folder: string) =>
      this.projects.filter((n) => {
        const f = this.folderMap[n];
        return f != null && inTree(f, folder);
      });
    return {
      listProjects: () => this.projects.slice(),
      listFolders: () => this.folders.slice(),
      getFolderOf: (n) => this.folderMap[n] ?? null,
      physicalDirOf: (n) => (this.projects.includes(n) ? this.dirs[n] : undefined),
      getDeletedProjects: async () => this.trash.map((t) => ({ name: t.name, dir: t.dir })),
      deleteProject: async (n) => {
        this.calls.push(`delete:${n}`);
        if (this.locked.has(n)) return { kind: 'still-present', closedCurrent: false };
        this.projects = this.projects.filter((p) => p !== n);
        this.trash.push({ name: n, dir: this.dirs[n], folder: this.folderMap[n] ?? null, favorite: this.favorites.has(n) });
        this.favorites.delete(n);
        delete this.folderMap[n];
        let closedCurrent = false;
        if (this.current === n) {
          this.current = undefined;
          closedCurrent = true;
        }
        return { kind: 'deleted', closedCurrent };
      },
      restoreFromTrash: async (n, opts) => {
        this.calls.push(`restore:${n}${opts.newName ? '→' + opts.newName : ''}`);
        const item = [...this.trash].reverse().find((t) => t.name === n && (!opts.dir || t.dir === opts.dir));
        if (!item) throw new Error('프로젝트를 휴지통에서 찾을 수 없습니다');
        const finalName = opts.newName ?? n;
        if (this.projects.includes(finalName)) throw new Error(`같은 이름의 프로젝트 "${n}"이(가) 이미 있습니다.`);
        this.trash = this.trash.filter((t) => t !== item);
        this.projects.push(finalName);
        this.dirs[finalName] = item.dir;
        this.folderMap[finalName] = item.folder;
        // 신 배치 스캔: meta.folder 의 조상 경로가 폴더 목록에 살아난다
        for (let f: string | null = item.folder; f; f = parentOf(f)) if (!this.folders.includes(f)) this.folders.push(f);
        if (item.favorite) this.favorites.add(finalName);
        return { name: finalName, dir: item.dir, sidecarRestored: true, sidecarFailed: [] };
      },
      moveToFolder,
      createFolder: async (folder) => {
        if (this.folders.includes(folder)) throw new Error('이미 존재하는 폴더입니다.');
        this.calls.push(`create:${folder}`);
        const toAdd: string[] = [];
        for (let cur: string | null = folder; cur; cur = parentOf(cur)) if (!this.folders.includes(cur)) toAdd.unshift(cur);
        for (const f of toAdd) {
          this.folders.push(f);
          if (!this.folderOrder.includes(f)) this.folderOrder.push(f);
        }
      },
      // SessionService.deleteFolder(349669f): 트리의 프로젝트를 상위 폴더로 한 번에 → 남으면 throw → 하위·자신 삭제·색·순서·템플릿 정리
      deleteFolder: async (folder) => {
        if (!this.folders.includes(folder)) throw new Error('폴더를 찾을 수 없습니다.');
        this.calls.push(`deleteFolder:${folder}`);
        const p = parentOf(folder);
        const target = p !== null && this.folders.includes(p) ? p : null;
        for (const n of getProjectsInFolder(folder)) await moveToFolder(n, target);
        const remaining = getProjectsInFolder(folder);
        if (remaining.length > 0) throw new Error(`옮기지 못한 프로젝트가 있어 폴더를 삭제하지 않았습니다: ${remaining.join(', ')}`);
        for (const f of this.folders.filter((x) => inTree(x, folder))) {
          delete this.folderColors[f];
          const id = this.assignments[f];
          if (id) {
            delete this.assignments[f];
            const local = this.locals[id];
            if (local) {
              for (const img of local.images) delete this.imageFiles[img];
              delete this.locals[id];
            }
          }
        }
        this.folders = this.folders.filter((x) => !inTree(x, folder));
        this.folderOrder = this.folderOrder.filter((x) => this.folders.includes(x));
      },
      folderDeleteTarget: (folder) => {
        const p = parentOf(folder);
        return p !== null && this.folders.includes(p) ? p : null;
      },
      getFolderColor: (f) => this.folderColors[f],
      setFolderColor: async (f, c) => {
        if (c) this.folderColors[f] = c;
        else delete this.folderColors[f];
      },
      getOrderedFolders: orderedFolders,
      setFolderOrder: async (order) => {
        const seen = new Set<string>();
        const cleaned: string[] = [];
        for (const f of order) if (this.folders.includes(f) && !seen.has(f)) seen.add(f), cleaned.push(f);
        for (const f of this.folders) if (!seen.has(f)) cleaned.push(f);
        this.folderOrder = cleaned;
      },
      getProjectsInFolder,
      snapshotFolderTemplates: async (folder) => {
        const snap: FolderTemplateSnapshot = { assignments: [], locals: [], applications: [] };
        for (const [f, id] of Object.entries(this.assignments)) {
          if (!inTree(f, folder)) continue;
          snap.assignments.push({ folder: f, templateId: id });
          const local = this.locals[id];
          if (local) {
            const images: Record<string, string> = {};
            for (const img of local.images) images[img] = this.imageFiles[img];
            snap.locals.push({ entry: { id, images: local.images.slice() } as any, images });
          }
        }
        return snap;
      },
      restoreFolderTemplates: async (snap) => {
        let failed = 0;
        for (const s of snap.locals) {
          const id = (s.entry as any).id as string;
          if (this.locals[id]) continue;
          // ProjectTemplateService.restoreEntry 처럼 이미지는 새 파일명으로 다시 쓴다
          const images = ((s.entry as any).images as string[]).map((old) => {
            const name = `new${++this.fileSeq}.png`;
            this.imageFiles[name] = s.images[old];
            return name;
          });
          this.locals[id] = { folderLocal: true, images };
        }
        for (const a of snap.assignments) {
          if (this.assignments[a.folder]) continue;
          if (!this.folders.includes(a.folder) || !(this.locals[a.templateId] || this.globals.has(a.templateId))) {
            failed++;
            continue;
          }
          this.assignments[a.folder] = a.templateId;
        }
        return { failed };
      },
    };
  }
}

function harness() {
  const toast = jest.fn();
  const service = new UndoService({
    curSession: () => undefined,
    isMirror: () => false,
    toast,
    now: () => 1000,
    confirm: async () => true,
  });
  const store = new FakeStore();
  const ops = store.ops();
  const opts = { service, ops };
  const past = () => service.entries(GLOBAL_UNDO_SCOPE).past.map((e) => e.label);
  const future = () => service.entries(GLOBAL_UNDO_SCOPE).future.map((e) => e.label);
  // BackupService.deleteFolderWithProjects 의 흐름과 같은 deps(실제 runFolderDeleteWithProjects)
  const runFlow = (folder: string) => () =>
    runFolderDeleteWithProjects(folder, {
      projectsInFolder: (f) => ops.getProjectsInFolder(f),
      folderOf: (n) => ops.getFolderOf(n),
      ensureLoaded: async (n) => store.projects.includes(n),
      isLoaded: (n) => store.projects.includes(n),
      moveToFolder: (n, f) => ops.moveToFolder(n, f),
      deleteProject: async (n) => {
        await ops.deleteProject(n);
      },
      deleteFolder: (f) => ops.deleteFolder(f),
    });
  return { service, toast, store, ops, opts, past, future, runFlow };
}

describe('P1-b-1 프로젝트 삭제 ↔ 휴지통 복원', () => {
  test('삭제 → 되돌림(활성 목록·사이드카·원래 폴더, 열지 않음) → 다시 실행(휴지통·현재 프로젝트 닫힘)', async () => {
    const { service, store, opts, past, toast } = harness();
    store.folders = ['F'];
    store.addProject('a', 'F');
    store.favorites.add('a');
    store.current = 'a';
    const outcome = await deleteProjectRecorded('a', opts);
    expect(outcome.kind).toBe('deleted');
    expect(store.current).toBeUndefined();
    expect(past()).toEqual([UNDO_TEXT.projectDelete('a')]);

    expect(await service.undo()).toBe(true);
    expect(store.projects).toEqual(['a']);
    expect(store.favorites.has('a')).toBe(true);
    expect(store.folderMap.a).toBe('F');
    expect(store.trash).toHaveLength(0);
    expect(store.current).toBeUndefined(); // D8 — 자동으로 열지 않음
    expect(toast).toHaveBeenLastCalledWith(UNDO_TEXT.undone(UNDO_TEXT.projectDelete('a')), 'info');

    store.current = 'a'; // 사용자가 연 뒤 다시 실행 → 닫힘(삭제 관문 규칙)
    expect(await service.redo()).toBe(true);
    expect(store.projects).toEqual([]);
    expect(store.trash.map((t) => t.name)).toEqual(['a']);
    expect(store.current).toBeUndefined();
  });

  test('씬 템플릿 라벨', async () => {
    const { store, opts, past } = harness();
    store.addProject('tpl');
    await deleteProjectRecorded('tpl', { ...opts, sceneTemplate: true });
    expect(past()).toEqual([UNDO_TEXT.sceneTemplateDelete('tpl')]);
  });

  test('다른 창 잠금(목록에 남음)이면 기록하지 않는다', async () => {
    const { service, store, opts } = harness();
    store.addProject('a');
    store.locked.add('a');
    const outcome = await deleteProjectRecorded('a', opts);
    expect(outcome.kind).toBe('still-present');
    expect(service.hasGlobalEntries).toBe(false);
  });

  test('같은 이름 활성 프로젝트가 생겼으면 실패·폐기·안내', async () => {
    const { service, store, opts, toast } = harness();
    store.addProject('a');
    await deleteProjectRecorded('a', opts);
    store.addProject('a'); // 같은 이름의 새 프로젝트(다른 물리 폴더)
    expect(await service.undo()).toBe(false);
    expect(toast).toHaveBeenLastCalledWith(UNDO_TEXT.undoFailed(UNDO_TEXT.projectNameActive('a')), 'error');
    expect(service.hasGlobalEntries).toBe(false);
    expect(store.trash).toHaveLength(1);
  });

  test('휴지통에 없으면(영구 삭제·만료) 실패·폐기', async () => {
    const { service, store, opts, toast } = harness();
    store.addProject('a');
    await deleteProjectRecorded('a', opts);
    store.trash = [];
    expect(await service.undo()).toBe(false);
    expect(toast).toHaveBeenLastCalledWith(UNDO_TEXT.undoFailed(UNDO_TEXT.projectNotInTrash('a')), 'error');
    expect(service.hasGlobalEntries).toBe(false);
  });

  test('동명 휴지통 항목이 둘이면 이 삭제의 물리 폴더를 복원', async () => {
    const { service, store, ops, opts } = harness();
    store.addProject('a');
    const firstDir = store.dirs.a;
    await ops.deleteProject('a'); // 기록 밖(예전) 삭제
    store.addProject('a');
    const secondDir = store.dirs.a;
    await deleteProjectRecorded('a', opts);
    expect(await service.undo()).toBe(true);
    expect(store.dirs.a).toBe(secondDir);
    expect(store.trash.map((t) => t.dir)).toEqual([firstDir]);
  });

  test('다시 실행 때 다른 창 잠금이면 실패·폐기', async () => {
    const { service, store, opts, toast } = harness();
    store.addProject('a');
    await deleteProjectRecorded('a', opts);
    await service.undo();
    store.locked.add('a');
    expect(await service.redo()).toBe(false);
    expect(toast).toHaveBeenLastCalledWith(UNDO_TEXT.redoFailed(UNDO_TEXT.projectDeleteBlocked('a')), 'error');
    expect(store.projects).toEqual(['a']);
  });

  test('원래 폴더가 사라져 다른 곳에 복원되면 안내', async () => {
    const { service, store, opts, toast } = harness();
    store.addProject('a', 'F');
    store.folders = ['F'];
    await deleteProjectRecorded('a', opts);
    // 구 배치처럼 휴지통 항목이 상위(루트)로 피신된 경우를 흉내
    store.trash[0].folder = null;
    store.folders = [];
    expect(await service.undo()).toBe(true);
    expect(toast).toHaveBeenLastCalledWith(
      UNDO_TEXT.undone(UNDO_TEXT.projectDelete('a')) + ` (${UNDO_TEXT.projectRestoredElsewhere('a', UNDO_TEXT.unfiled)})`,
      'info',
    );
  });
});

describe('P1-b-1 휴지통 수동 복원 짝', () => {
  test('복원 → 되돌림(다시 휴지통) → 다시 실행(복원, 열지 않음)', async () => {
    const { service, store, ops, opts, past } = harness();
    store.addProject('a');
    await ops.deleteProject('a');
    const dir = store.trash[0].dir;
    const r = await restoreProjectRecorded('a', { dir }, opts);
    expect(r.name).toBe('a');
    expect(past()).toEqual([UNDO_TEXT.projectTrashRestore('a')]);
    store.current = 'a';
    expect(await service.undo()).toBe(true);
    expect(store.projects).toEqual([]);
    expect(store.current).toBeUndefined();
    expect(await service.redo()).toBe(true);
    expect(store.projects).toEqual(['a']);
    expect(store.dirs.a).toBe(dir);
    expect(store.current).toBeUndefined();
  });

  test('새 이름 복원이면 새 이름으로 짝', async () => {
    const { service, store, ops, opts, past } = harness();
    store.addProject('a');
    await ops.deleteProject('a');
    store.addProject('a'); // 같은 이름 활성
    const r = await restoreProjectRecorded('a', { dir: store.trash[0].dir, newName: 'a2' }, opts);
    expect(r.name).toBe('a2');
    expect(past()).toEqual([UNDO_TEXT.projectTrashRestore('a2')]);
    await service.undo();
    expect(store.projects).toEqual(['a']);
    expect(store.trash.map((t) => t.name)).toEqual(['a2']);
    await service.redo();
    expect(store.projects.sort()).toEqual(['a', 'a2']);
  });

  test('복원 실패(throw)는 기록 없이 그대로 던진다', async () => {
    const { service, store, opts } = harness();
    await expect(restoreProjectRecorded('none', {}, opts)).rejects.toThrow('휴지통에서 찾을 수 없습니다');
    expect(service.hasGlobalEntries).toBe(false);
    expect(store.projects).toEqual([]);
  });
});

describe('P1-b-2 폴더만 삭제', () => {
  function tree(h: ReturnType<typeof harness>) {
    const { store } = h;
    store.folders = ['P', 'P/S', 'P/S/T', 'Q'];
    store.folderOrder = ['Q', 'P/S/T', 'P', 'P/S'];
    store.folderColors = { 'P/S': '#ff0000', 'P/S/T': '#00ff00' };
    store.addProject('x', 'P/S');
    store.addProject('y', 'P/S/T');
    store.addProject('z', 'P');
    // 폴더 전용 로컬 템플릿(이미지 2개) + 전역 템플릿 지정
    store.locals.L1 = { folderLocal: true, images: ['img1.png', 'img2.png'] };
    store.imageFiles = { 'img1.png': 'data:1', 'img2.png': 'data:2' };
    store.assignments['P/S'] = 'L1';
    store.globals.add('G1');
    store.assignments['P/S/T'] = 'G1';
  }

  test('서브폴더(하위 포함) 삭제 → 되돌림: 트리·소속·색·순서·템플릿 지정·로컬 템플릿(이미지 포함) → 다시 실행', async () => {
    const h = harness();
    const { service, store, opts, past } = h;
    tree(h);
    await deleteFolderRecorded('P/S', opts);
    expect(store.folders.sort()).toEqual(['P', 'Q']);
    expect(store.folderMap).toEqual({ x: 'P', y: 'P', z: 'P' });
    expect(store.locals.L1).toBeUndefined();
    expect(store.imageFiles).toEqual({});
    expect(past()).toEqual([UNDO_TEXT.folderDelete('P/S')]);

    expect(await service.undo()).toBe(true);
    expect(store.folders.sort()).toEqual(['P', 'P/S', 'P/S/T', 'Q']);
    expect(store.folderMap).toEqual({ x: 'P/S', y: 'P/S/T', z: 'P' });
    expect(store.folderColors).toEqual({ 'P/S': '#ff0000', 'P/S/T': '#00ff00' });
    expect(store.ops().getOrderedFolders()).toEqual(['Q', 'P/S/T', 'P', 'P/S']);
    expect(store.assignments).toEqual({ 'P/S': 'L1', 'P/S/T': 'G1' });
    expect(store.locals.L1.images).toHaveLength(2);
    expect(store.locals.L1.images.map((f) => store.imageFiles[f])).toEqual(['data:1', 'data:2']);

    expect(await service.redo()).toBe(true);
    expect(store.folders.sort()).toEqual(['P', 'Q']);
    expect(store.folderMap).toEqual({ x: 'P', y: 'P', z: 'P' });
    // 다시 실행 뒤 되돌림도 동작(재생성된 템플릿을 다시 스냅숏)
    expect(await service.undo()).toBe(true);
    expect(store.assignments).toEqual({ 'P/S': 'L1', 'P/S/T': 'G1' });
    expect(store.locals.L1.images.map((f) => store.imageFiles[f])).toEqual(['data:1', 'data:2']);
  });

  test('빈 폴더 삭제 → 되돌림(폴더·순서)', async () => {
    const { service, store, opts } = harness();
    store.folders = ['A', 'B'];
    store.folderOrder = ['B', 'A'];
    await deleteFolderRecorded('B', opts);
    expect(store.folders).toEqual(['A']);
    await service.undo();
    expect(store.ops().getOrderedFolders()).toEqual(['B', 'A']);
  });

  test('되돌릴 때 프로젝트 하나가 다른 창 잠금이면 부분 실패 안내(나머지는 복귀)', async () => {
    const h = harness();
    const { service, store, opts, toast } = h;
    tree(h);
    await deleteFolderRecorded('P/S', opts);
    store.locked.add('x');
    expect(await service.undo()).toBe(true);
    expect(store.folderMap).toEqual({ x: 'P', y: 'P/S/T', z: 'P' });
    const msg = toast.mock.calls[toast.mock.calls.length - 1];
    expect(msg[1]).toBe('error');
    expect(msg[0]).toContain(UNDO_TEXT.projectMoveBlocked('x'));
  });

  test('삭제 중 다른 창 잠금으로 멈추면(예외) 옮겨진 프로젝트만큼 기록하고 예외를 던진다', async () => {
    const h = harness();
    const { service, store, opts } = h;
    tree(h);
    store.locked.add('y');
    await expect(deleteFolderRecorded('P/S', opts)).rejects.toThrow('옮기지 못한 프로젝트');
    expect(store.folders).toContain('P/S');
    expect(store.folderMap.x).toBe('P');
    expect(await service.undo()).toBe(true);
    expect(store.folderMap).toEqual({ x: 'P/S', y: 'P/S/T', z: 'P' });
    expect(store.assignments).toEqual({ 'P/S': 'L1', 'P/S/T': 'G1' });
  });

  test('폴더 자리에 같은 이름 프로젝트가 생겼으면 실패·폐기', async () => {
    const { service, store, opts, toast } = harness();
    store.folders = ['A'];
    await deleteFolderRecorded('A', opts);
    store.addProject('A');
    expect(await service.undo()).toBe(false);
    expect(toast).toHaveBeenLastCalledWith(UNDO_TEXT.undoFailed(UNDO_TEXT.folderNameTaken('A')), 'error');
  });

  test('다시 실행 전 폴더가 없으면 실패', async () => {
    const { service, store, opts, toast } = harness();
    store.folders = ['A'];
    await deleteFolderRecorded('A', opts);
    await service.undo();
    store.folders = [];
    expect(await service.redo()).toBe(false);
    expect(toast).toHaveBeenLastCalledWith(UNDO_TEXT.redoFailed(UNDO_TEXT.folderGone('A')), 'error');
  });
});

describe('P1-b-3 폴더+프로젝트 삭제', () => {
  function tree(h: ReturnType<typeof harness>) {
    const { store } = h;
    store.folders = ['P', 'P/S'];
    store.folderOrder = ['P/S', 'P'];
    store.folderColors = { P: '#123456' };
    store.addProject('a', 'P');
    store.addProject('b', 'P/S');
    store.favorites.add('b');
    store.locals.L = { folderLocal: true, images: ['i.png'] };
    store.imageFiles = { 'i.png': 'data:i' };
    store.assignments.P = 'L';
  }

  test('흐름 전체가 한 항목 → 되돌림 역순(폴더 → 복원 → 원래 폴더 → 색·순서·템플릿) → 다시 실행', async () => {
    const h = harness();
    const { service, store, opts, past, runFlow } = h;
    tree(h);
    const r = await deleteFolderWithProjectsRecorded('P', runFlow('P'), opts);
    expect(r.deleted).toEqual(['a', 'b']);
    expect(r.folderDeleted).toBe(true);
    expect(store.folders).toEqual([]);
    expect(past()).toEqual([UNDO_TEXT.folderDeleteWithProjects('P', 2)]); // 개별 삭제 기록 없음

    store.calls = [];
    expect(await service.undo()).toBe(true);
    expect(store.calls.filter((c) => c.startsWith('restore:'))).toEqual(['restore:b', 'restore:a']); // 역순
    expect(store.calls.indexOf('create:P')).toBeLessThan(store.calls.indexOf('restore:b'));
    expect(store.folderMap).toEqual({ a: 'P', b: 'P/S' });
    expect(store.favorites.has('b')).toBe(true);
    expect(store.folders.sort()).toEqual(['P', 'P/S']);
    expect(store.folderColors).toEqual({ P: '#123456' });
    expect(store.ops().getOrderedFolders()).toEqual(['P/S', 'P']);
    expect(store.assignments).toEqual({ P: 'L' });
    expect(store.imageFiles[store.locals.L.images[0]]).toBe('data:i');
    expect(store.trash).toHaveLength(0);

    expect(await service.redo()).toBe(true);
    expect(store.projects).toEqual([]);
    expect(store.folders).toEqual([]);
    expect(store.trash.map((t) => t.name).sort()).toEqual(['a', 'b']);
  });

  test('일부 프로젝트가 지워지지 않으면(다른 창) 그 프로젝트·폴더 부분은 항목에서 빠진다', async () => {
    const h = harness();
    const { service, store, opts, past, runFlow } = h;
    tree(h);
    store.locked.add('b');
    const r = await deleteFolderWithProjectsRecorded('P', runFlow('P'), opts);
    expect(r.deleted).toEqual(['a']);
    expect(r.folderDeleted).toBe(false);
    expect(past()).toEqual([UNDO_TEXT.folderDeleteWithProjects('P', 1)]);
    store.calls = [];
    expect(await service.undo()).toBe(true);
    expect(store.calls.filter((c) => c.startsWith('restore:') || c.startsWith('create:'))).toEqual(['restore:a']);
    expect(store.folderMap).toEqual({ a: 'P', b: 'P/S' });
  });

  test('아무것도 지우지 못했으면 기록하지 않는다', async () => {
    const h = harness();
    const { service, store, opts, runFlow } = h;
    tree(h);
    store.locked.add('a');
    store.locked.add('b');
    await deleteFolderWithProjectsRecorded('P', runFlow('P'), opts);
    expect(service.hasGlobalEntries).toBe(false);
  });

  test('되돌릴 때 같은 이름 활성 프로젝트가 있으면 그 프로젝트만 실패(부분 실패 안내)', async () => {
    const h = harness();
    const { service, store, opts, toast, runFlow } = h;
    tree(h);
    await deleteFolderWithProjectsRecorded('P', runFlow('P'), opts);
    store.addProject('a');
    expect(await service.undo()).toBe(true);
    expect(store.folderMap.b).toBe('P/S');
    expect(store.trash.map((t) => t.name)).toEqual(['a']);
    const msg = toast.mock.calls[toast.mock.calls.length - 1];
    expect(msg[1]).toBe('error');
    expect(msg[0]).toContain(UNDO_TEXT.projectNameActive('a'));
  });
});
