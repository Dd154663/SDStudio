// 프로젝트·폴더 상태 작업의 되돌리기(2026-11-03 2차 묶음 2 P1-a — 전역 스택, SPEC_GUIDE 「되돌리기 계약」 「2차 P1-a」).
// 6종(즐겨찾기·폴더 색·순서·프로젝트 폴더 이동·폴더 이름/이동·폴더 만들기) 각각 되돌리기·다시 실행·verify 실패(다른 창 변경
// 시뮬레이션), 폴더 이동 묶음 역순, 폴더 만들기 되돌림의 「비어 있을 때만」·조상 포함, 색 병합, 드래그 이동 묶음(이름+순서).
jest.mock('..', () => ({ workFlowService: {} }));

import { GLOBAL_UNDO_SCOPE, UNDO_TEXT, UndoService } from '../undoService';
import {
  createFolderRecorded,
  groupProjectFolderOps,
  moveProjectsToFolderRecorded,
  moveToFolderRecorded,
  ProjectFolderOps,
  renameFolderRecorded,
  setFolderColorRecorded,
  setFolderOrderRecorded,
  toggleFavoriteRecorded,
} from '../projectFolderUndo';

// SessionService 의 폴더·사이드카 규칙을 흉내 내는 가짜(신 배치 — folderOrder 가 빈 폴더의 진실, meta.folder 가 소속)
class FakeStore {
  projects: string[] = [];
  favorites = new Set<string>();
  folders: string[] = [];
  folderColors: Record<string, string> = {};
  folderOrder: string[] = [];
  folderMap: Record<string, string | null> = {};
  templates = new Set<string>();
  /** 다른 창에서 열린 프로젝트 — moveToFolder 가 조용히 반환 */
  locked = new Set<string>();
  calls: string[] = [];

  ops(): ProjectFolderOps {
    return {
      listProjects: () => this.projects.slice(),
      listFolders: () => this.folders.slice(),
      isFavorite: (n) => this.favorites.has(n),
      setFavorite: async (n, on) => {
        this.calls.push(`fav:${n}:${on}`);
        if (on) this.favorites.add(n);
        else this.favorites.delete(n);
      },
      getFolderColor: (f) => this.folderColors[f],
      setFolderColor: async (f, c) => {
        this.calls.push(`color:${f}:${c}`);
        if (c) this.folderColors[f] = c;
        else delete this.folderColors[f];
      },
      getOrderedFolders: () => {
        const known = this.folderOrder.filter((f) => this.folders.includes(f));
        const rest = this.folders.filter((f) => !known.includes(f)).sort();
        return [...known, ...rest];
      },
      setFolderOrder: async (order) => {
        this.calls.push(`order:${order.join(',')}`);
        const seen = new Set<string>();
        const cleaned: string[] = [];
        for (const f of order) if (this.folders.includes(f) && !seen.has(f)) seen.add(f), cleaned.push(f);
        for (const f of this.folders) if (!seen.has(f)) cleaned.push(f);
        this.folderOrder = cleaned;
      },
      getFolderOf: (n) => this.folderMap[n] ?? null,
      moveToFolder: async (n, f) => {
        if (this.locked.has(n)) return;
        if ((this.folderMap[n] ?? null) === f) return;
        if (f !== null && !this.folders.includes(f)) throw new Error('대상 폴더가 없습니다.');
        this.calls.push(`move:${n}:${f}`);
        this.folderMap[n] = f;
      },
      renameFolder: async (from, to) => {
        to = to.trim();
        if (!this.folders.includes(from)) throw new Error('폴더를 찾을 수 없습니다.');
        if (this.folders.includes(to)) throw new Error('이미 존재하는 폴더입니다.');
        this.calls.push(`rename:${from}:${to}`);
        const mapPath = (f: string) => (f === from ? to : f.startsWith(from + '/') ? to + f.slice(from.length) : f);
        this.folders = this.folders.map(mapPath);
        this.folderOrder = this.folderOrder.map(mapPath);
        const colors: Record<string, string> = {};
        for (const [k, v] of Object.entries(this.folderColors)) colors[mapPath(k)] = v;
        this.folderColors = colors;
        for (const [n, f] of Object.entries(this.folderMap)) if (f !== null) this.folderMap[n] = mapPath(f);
      },
      createFolder: async (folder) => {
        if (this.folders.includes(folder)) throw new Error('이미 존재하는 폴더입니다.');
        this.calls.push(`create:${folder}`);
        const toAdd: string[] = [];
        let cur: string | null = folder;
        while (cur) {
          if (!this.folders.includes(cur)) toAdd.unshift(cur);
          const i: number = cur.lastIndexOf('/');
          cur = i >= 0 ? cur.slice(0, i) : null;
        }
        for (const f of toAdd) {
          this.folders.push(f);
          this.folderOrder.push(f);
        }
      },
      deleteFolder: async (folder) => {
        this.calls.push(`delete:${folder}`);
        this.folders = this.folders.filter((f) => f !== folder && !f.startsWith(folder + '/'));
        this.folderOrder = this.folderOrder.filter((f) => this.folders.includes(f));
        delete this.folderColors[folder];
      },
      getProjectsInFolder: (folder) =>
        Object.keys(this.folderMap).filter((n) => {
          const f = this.folderMap[n];
          return f === folder || (f !== null && f.startsWith(folder + '/'));
        }),
      hasFolderTemplate: async (f) => this.templates.has(f),
    };
  }
}

function harness() {
  const toast = jest.fn();
  const clock = { t: 1000 };
  const service = new UndoService({
    curSession: () => undefined,
    isMirror: () => false,
    toast,
    now: () => clock.t,
    confirm: async () => true,
  });
  const store = new FakeStore();
  const opts = { service, ops: store.ops() };
  const past = () => service.entries(GLOBAL_UNDO_SCOPE).past.map((e) => e.label);
  return { service, toast, clock, store, opts, past };
}

describe('프로젝트 즐겨찾기', () => {
  test('켬 → 되돌림(끔) → 다시 실행(켬), 라벨', async () => {
    const { service, store, opts, past } = harness();
    store.projects = ['a'];
    await toggleFavoriteRecorded('a', opts);
    expect(store.favorites.has('a')).toBe(true);
    expect(past()).toEqual([UNDO_TEXT.projectFavoriteOn('a')]);
    expect(await service.undo()).toBe(true);
    expect(store.favorites.has('a')).toBe(false);
    expect(await service.redo()).toBe(true);
    expect(store.favorites.has('a')).toBe(true);
    await toggleFavoriteRecorded('a', opts);
    expect(past()).toEqual([UNDO_TEXT.projectFavoriteOn('a'), UNDO_TEXT.projectFavoriteOff('a')]);
  });

  test('다른 창에서 즐겨찾기가 바뀌었으면 실패·폐기', async () => {
    const { service, store, opts, toast } = harness();
    store.projects = ['a'];
    await toggleFavoriteRecorded('a', opts);
    store.favorites.delete('a'); // 다른 창이 해제('session-meta' 재로드)
    expect(await service.undo()).toBe(false);
    expect(toast).toHaveBeenLastCalledWith(UNDO_TEXT.undoFailed(UNDO_TEXT.projectFavoriteChanged('a')), 'error');
    expect(service.hasGlobalEntries).toBe(false);
  });

  test('프로젝트가 사라졌으면 실패·폐기', async () => {
    const { service, store, opts, toast } = harness();
    store.projects = ['a'];
    await toggleFavoriteRecorded('a', opts);
    store.projects = [];
    expect(await service.undo()).toBe(false);
    expect(toast).toHaveBeenLastCalledWith(UNDO_TEXT.undoFailed(UNDO_TEXT.projectGone('a')), 'error');
  });
});

describe('폴더 색', () => {
  test('바꿈 → 되돌림 → 다시 실행, 없던 색은 지움(null)', async () => {
    const { service, store, opts } = harness();
    store.folders = ['f'];
    await setFolderColorRecorded('f', '#ff0000', opts);
    expect(store.folderColors.f).toBe('#ff0000');
    await service.undo();
    expect(store.folderColors.f).toBeUndefined();
    await service.redo();
    expect(store.folderColors.f).toBe('#ff0000');
  });

  test('1초 안 연속 입력(200ms 디바운스) = 한 항목, 처음 색으로 돌아오면 항목 삭제', async () => {
    const { service, store, opts, clock, past } = harness();
    store.folders = ['f'];
    store.folderColors.f = '#000000';
    await setFolderColorRecorded('f', '#111111', opts);
    clock.t += 200;
    await setFolderColorRecorded('f', '#222222', opts);
    clock.t += 200;
    await setFolderColorRecorded('f', '#333333', opts);
    expect(past()).toEqual([UNDO_TEXT.folderColor('f')]);
    await service.undo();
    expect(store.folderColors.f).toBe('#000000');
    await service.redo();
    expect(store.folderColors.f).toBe('#333333');
    // 다른 폴더는 따로, 1초 넘으면 따로
    clock.t += 2000;
    await setFolderColorRecorded('f', '#444444', opts);
    expect(past()).toHaveLength(2);
    clock.t += 100;
    await setFolderColorRecorded('f', '#333333', opts);
    expect(past()).toHaveLength(1);
    // 같은 색 다시 고르기는 기록 없음
    await setFolderColorRecorded('f', '#333333', opts);
    expect(past()).toHaveLength(1);
    void service;
  });

  test('다른 창이 색을 바꿨거나 폴더가 없어졌으면 실패·폐기', async () => {
    const { service, store, opts, toast } = harness();
    store.folders = ['f'];
    await setFolderColorRecorded('f', '#ff0000', opts);
    store.folderColors.f = '#00ff00';
    expect(await service.undo()).toBe(false);
    expect(toast).toHaveBeenLastCalledWith(UNDO_TEXT.undoFailed(UNDO_TEXT.folderColorChanged('f')), 'error');
    expect(store.folderColors.f).toBe('#00ff00');
    await setFolderColorRecorded('f', '#0000ff', opts);
    store.folders = [];
    expect(await service.undo()).toBe(false);
    expect(toast).toHaveBeenLastCalledWith(UNDO_TEXT.undoFailed(UNDO_TEXT.folderGone('f')), 'error');
  });
});

describe('폴더 순서', () => {
  test('보이는 순서(서비스 보정 결과)로 기록 → 되돌림 → 다시 실행, 1초 병합', async () => {
    const { service, store, opts, clock, past } = harness();
    store.folders = ['a', 'b', 'c'];
    await setFolderOrderRecorded(['c', 'a'], opts); // 빠진 b 는 서비스가 뒤에 보정
    expect(store.folderOrder).toEqual(['c', 'a', 'b']);
    clock.t += 300;
    await setFolderOrderRecorded(['b', 'c', 'a'], opts);
    expect(past()).toEqual([UNDO_TEXT.folderOrder]);
    await service.undo();
    expect(opts.ops.getOrderedFolders()).toEqual(['a', 'b', 'c']);
    await service.redo();
    expect(opts.ops.getOrderedFolders()).toEqual(['b', 'c', 'a']);
  });

  test('그사이 폴더 목록·순서가 바뀌었으면 실패·폐기', async () => {
    const { service, store, opts, toast } = harness();
    store.folders = ['a', 'b'];
    await setFolderOrderRecorded(['b', 'a'], opts);
    store.folderOrder = ['a', 'b']; // 다른 창
    expect(await service.undo()).toBe(false);
    expect(toast).toHaveBeenLastCalledWith(UNDO_TEXT.undoFailed(UNDO_TEXT.folderOrderChanged), 'error');
  });
});

describe('프로젝트 폴더 이동', () => {
  test('하나 — 이동 → 되돌림(원래 폴더) → 다시 실행, 같은 폴더·다른 창 잠금은 기록 없음', async () => {
    const { service, store, opts, past } = harness();
    store.projects = ['p', 'q'];
    store.folders = ['f'];
    store.folderMap = { p: null, q: null };
    await moveToFolderRecorded('p', 'f', opts);
    expect(past()).toEqual([UNDO_TEXT.projectMove(['p'], 'f')]);
    await moveToFolderRecorded('p', 'f', opts); // 같은 폴더
    store.locked.add('q');
    await moveToFolderRecorded('q', 'f', opts); // 조용히 반환
    expect(past()).toHaveLength(1);
    await service.undo();
    expect(store.folderMap.p).toBeNull();
    await service.redo();
    expect(store.folderMap.p).toBe('f');
  });

  test('일괄 — 실제로 옮겨진 것만 한 항목, 되돌림 역순·다시 실행 정순', async () => {
    const { service, store, opts, past } = harness();
    store.projects = ['a', 'b', 'c', 'd'];
    store.folders = ['x', 'y'];
    store.folderMap = { a: null, b: 'x', c: 'y', d: 'y' };
    store.locked.add('d');
    const n = await moveProjectsToFolderRecorded(['a', 'b', 'c', 'd'], 'y', opts);
    expect(n).toBe(2); // c 는 이미 y, d 는 잠금
    expect(past()).toEqual([UNDO_TEXT.projectMove(['a', 'b'], 'y')]);
    store.calls = [];
    await service.undo();
    expect(store.calls).toEqual(['move:b:x', 'move:a:null']);
    store.calls = [];
    await service.redo();
    expect(store.calls).toEqual(['move:a:y', 'move:b:y']);
  });

  test('일부 프로젝트가 그사이 다른 폴더로 갔으면 그것만 빠지고 나머지는 되돌린다(부분 실패 안내)', async () => {
    const { service, store, opts, toast } = harness();
    store.projects = ['a', 'b'];
    store.folders = ['x', 'y'];
    store.folderMap = { a: null, b: null };
    await moveProjectsToFolderRecorded(['a', 'b'], 'x', opts);
    store.folderMap.a = 'y'; // 다른 창이 옮김
    expect(await service.undo()).toBe(true);
    expect(store.folderMap).toEqual({ a: 'y', b: null });
    expect(toast).toHaveBeenLastCalledWith(
      UNDO_TEXT.undone(UNDO_TEXT.projectMove(['a', 'b'], 'x')) + UNDO_TEXT.partial(1, 2),
      'error',
    );
    // 빠진 a 는 다시 실행 대상에서도 빠진다
    store.calls = [];
    await service.redo();
    expect(store.calls).toEqual(['move:b:x']);
  });

  test('되돌릴 때 다른 창에서 열려 있으면(조용히 반환) 실패·폐기', async () => {
    const { service, store, opts, toast } = harness();
    store.projects = ['a'];
    store.folders = ['x'];
    store.folderMap = { a: null };
    await moveToFolderRecorded('a', 'x', opts);
    store.locked.add('a');
    expect(await service.undo()).toBe(false);
    expect(toast).toHaveBeenLastCalledWith(UNDO_TEXT.undoFailed(UNDO_TEXT.projectMoveBlocked('a')), 'error');
    expect(service.hasGlobalEntries).toBe(false);
  });
});

describe('폴더 이름 변경·이동', () => {
  test('이름 변경 → 되돌림(새→옛, 하위·소속·색이 함께 돌아옴) → 다시 실행, 되돌림 라벨은 반대 방향', async () => {
    const { service, store, opts } = harness();
    store.projects = ['p'];
    store.folders = ['a', 'a/s'];
    store.folderMap = { p: 'a/s' };
    store.folderColors = { 'a/s': '#123456' };
    await renameFolderRecorded('a', 'b', opts);
    expect(service.undoLabel).toBe(UNDO_TEXT.folderRename('b', 'a'));
    expect(store.folderMap.p).toBe('b/s');
    await service.undo();
    expect(store.folders).toEqual(['a', 'a/s']);
    expect(store.folderMap.p).toBe('a/s');
    expect(store.folderColors).toEqual({ 'a/s': '#123456' });
    expect(service.redoLabel).toBe(UNDO_TEXT.folderRename('a', 'b'));
    await service.redo();
    expect(store.folders).toEqual(['b', 'b/s']);
  });

  test('되돌릴 이름을 그사이 다른 폴더·프로젝트가 쓰면 실패·폐기', async () => {
    const { service, store, opts, toast } = harness();
    store.folders = ['a'];
    await renameFolderRecorded('a', 'b', opts);
    store.folders.push('a'); // 다른 창이 같은 이름 폴더를 만듦
    expect(await service.undo()).toBe(false);
    expect(toast).toHaveBeenLastCalledWith(UNDO_TEXT.undoFailed(UNDO_TEXT.folderNameTaken('a')), 'error');
    expect(store.folders).toEqual(['b', 'a']);
  });

  test('서비스 오류(throw)는 기록 없이 그대로 던진다', async () => {
    const { store, opts, past } = harness();
    store.folders = ['a', 'b'];
    await expect(renameFolderRecorded('a', 'b', opts)).rejects.toThrow('이미 존재하는 폴더입니다.');
    expect(past()).toEqual([]);
  });

  test('폴더 드래그 이동 = 이름(부모) 변경 + 순서 한 항목, 되돌림 역순(순서 → 이름)', async () => {
    const { service, store, opts, past } = harness();
    store.folders = ['p', 'p/x', 'q'];
    store.folderOrder = ['p', 'p/x', 'q'];
    await groupProjectFolderOps(
      UNDO_TEXT.folderMove('p/x', 'x'),
      async () => {
        await renameFolderRecorded('p/x', 'x', { ...opts, move: true });
        await setFolderOrderRecorded(['x', 'p', 'q'], opts);
      },
      opts,
    );
    expect(past()).toEqual([UNDO_TEXT.folderMove('p/x', 'x')]);
    expect(opts.ops.getOrderedFolders()).toEqual(['x', 'p', 'q']);
    store.calls = [];
    await service.undo();
    expect(store.calls).toEqual(['order:p,x,q', 'rename:x:p/x']);
    expect(opts.ops.getOrderedFolders()).toEqual(['p', 'p/x', 'q']);
    store.calls = [];
    await service.redo();
    expect(store.calls).toEqual(['rename:p/x:x', 'order:x,p,q']);
    expect(opts.ops.getOrderedFolders()).toEqual(['x', 'p', 'q']);
  });
});

describe('폴더 만들기', () => {
  test('조상과 함께 생긴 폴더를 한 항목 — 되돌림 = 깊은 것부터 삭제, 다시 실행 = 다시 만들기', async () => {
    const { service, store, opts, past } = harness();
    store.folders = ['a'];
    await createFolderRecorded('a/b/c', opts);
    expect(store.folders).toEqual(['a', 'a/b', 'a/b/c']);
    expect(past()).toEqual([UNDO_TEXT.folderCreate('a/b/c')]);
    store.calls = [];
    await service.undo();
    expect(store.calls).toEqual(['delete:a/b/c', 'delete:a/b']); // 원래 있던 a 는 그대로
    expect(store.folders).toEqual(['a']);
    store.calls = [];
    await service.redo();
    expect(store.calls).toEqual(['create:a/b/c']);
    expect(store.folders).toEqual(['a', 'a/b', 'a/b/c']);
    await service.undo();
    expect(store.folders).toEqual(['a']);
  });

  test('그사이 프로젝트가 들어갔으면 지우지 않고 실패·폐기', async () => {
    const { service, store, opts, toast } = harness();
    store.projects = ['p'];
    store.folderMap = { p: null };
    await createFolderRecorded('n', opts);
    store.folderMap.p = 'n';
    expect(await service.undo()).toBe(false);
    expect(toast).toHaveBeenLastCalledWith(UNDO_TEXT.undoFailed(UNDO_TEXT.folderNotEmpty('n')), 'error');
    expect(store.folders).toEqual(['n']);
    expect(store.calls.filter((c) => c.startsWith('delete'))).toEqual([]);
  });

  test('이 항목 밖 하위 폴더가 생겼으면 실패(조상 포함 판정)', async () => {
    const { service, store, opts, toast } = harness();
    await createFolderRecorded('a/b', opts);
    store.folders.push('a/z'); // 기록 밖에서 a 아래에 폴더
    expect(await service.undo()).toBe(false);
    expect(toast).toHaveBeenLastCalledWith(UNDO_TEXT.undoFailed(UNDO_TEXT.folderNotEmpty('a')), 'error');
    expect(store.folders).toEqual(['a', 'a/b', 'a/z']);
  });

  test('폴더 기본 템플릿이 지정됐으면 아무것도 지우지 않고 실패', async () => {
    const { service, store, opts, toast } = harness();
    await createFolderRecorded('a/b', opts);
    store.templates.add('a');
    expect(await service.undo()).toBe(false);
    expect(toast).toHaveBeenLastCalledWith(UNDO_TEXT.undoFailed(UNDO_TEXT.folderHasTemplate('a')), 'error');
    expect(store.folders).toEqual(['a', 'a/b']);
  });

  test('다시 실행 때 같은 이름 폴더가 이미 있으면 실패·폐기', async () => {
    const { service, store, opts, toast } = harness();
    await createFolderRecorded('n', opts);
    await service.undo();
    store.folders.push('n');
    expect(await service.redo()).toBe(false);
    expect(toast).toHaveBeenLastCalledWith(UNDO_TEXT.redoFailed(UNDO_TEXT.folderNameTaken('n')), 'error');
  });
});
