import { runFolderDeleteWithProjects, type FolderDeleteDeps } from '../folderDeleteFlow';

// 폴더째 삭제(2026-10-02 B2): 안의 프로젝트를 전부 휴지통으로 보낸 것을 확인한 뒤에만 폴더를 지운다.
// 가짜 저장소 — SessionService 의 관찰 가능한 동작을 흉내 낸다.
interface FakeOptions {
  folderMap: Record<string, string | null>;
  loaded?: string[];
  /** 불러오기가 실패하는 프로젝트(손상 등) */
  unloadable?: string[];
  /** 다른 창에서 열려 있음: moveToFolder·delete 가 조용히 반환 */
  locked?: string[];
  /** delete 가 파일 이동 전에 예외 */
  deleteThrows?: string[];
  /** 예전 결함 재현: 미로드면 delete 가 조용히 반환 */
  legacySilentDelete?: boolean;
  /** 원래 폴더로 되돌리기가 실패 */
  moveBackThrows?: string[];
}

const makeFake = (opt: FakeOptions) => {
  const folderMap = { ...opt.folderMap };
  const loaded = new Set(opt.loaded ?? []);
  const trash: string[] = [];
  const folders = new Set(
    Object.values(folderMap).filter((f): f is string => f !== null),
  );
  const calls = { deleteFolder: [] as string[] };
  const deps: FolderDeleteDeps = {
    projectsInFolder: (folder) =>
      Object.keys(folderMap).filter((n) => {
        const f = folderMap[n];
        return f === folder || (f !== null && f.startsWith(folder + '/'));
      }),
    folderOf: (n) => folderMap[n] ?? null,
    ensureLoaded: async (n) => {
      if (opt.legacySilentDelete) return true; // 예전 절차는 불러오지 않았다
      if (opt.unloadable?.includes(n)) return false;
      loaded.add(n);
      return true;
    },
    isLoaded: (n) =>
      opt.legacySilentDelete ? n in folderMap : loaded.has(n),
    moveToFolder: async (n, f) => {
      if (opt.locked?.includes(n)) return;
      if (f !== null && opt.moveBackThrows?.includes(n)) throw new Error('이동 실패');
      folderMap[n] = f;
    },
    deleteProject: async (n) => {
      if (opt.locked?.includes(n)) return;
      if (opt.deleteThrows?.includes(n)) throw new Error('rename 실패');
      if (!loaded.has(n)) return; // ResourceSyncService.delete: 미로드면 조용히 반환
      loaded.delete(n);
      delete folderMap[n];
      trash.push(n);
    },
    deleteFolder: async (f) => {
      calls.deleteFolder.push(f);
      folders.delete(f);
    },
  };
  return { deps, folderMap, trash, folders, calls };
};

describe('폴더째 삭제 절차', () => {
  it('예전 결함 상황(delete 가 미로드라 조용히 반환)도 실패로 잡고 미분류에 남기지 않는다', async () => {
    // 불러오기가 효과 없고 delete 가 아무것도 안 하는 상황: 예전 절차는 여기서 폴더를 지워 A 가 미분류에 남았다
    const f = makeFake({ folderMap: { A: '폴더' }, legacySilentDelete: true });
    const r = await runFolderDeleteWithProjects('폴더', f.deps);
    expect(f.trash).toEqual([]);
    // 새 절차는 실패로 보고하고 원래 폴더로 되돌리며 폴더를 지우지 않는다
    expect(r.failed.map((x) => x.name)).toEqual(['A']);
    expect(f.folderMap.A).toBe('폴더');
    expect(r.folderDeleted).toBe(false);
    expect(f.calls.deleteFolder).toEqual([]);
  });

  it('미로드 프로젝트를 포함해 전부 휴지통으로 보낸 뒤 폴더를 지운다', async () => {
    const f = makeFake({
      folderMap: { A: '폴더', B: '폴더/하위', C: '다른폴더', D: null },
      loaded: ['A'],
    });
    const progress: Array<[number, number]> = [];
    const r = await runFolderDeleteWithProjects('폴더', {
      ...f.deps,
      onProgress: (d, t) => progress.push([d, t]),
    });
    expect(r.deleted.sort()).toEqual(['A', 'B']);
    expect(r.failed).toEqual([]);
    expect(f.trash.sort()).toEqual(['A', 'B']);
    expect(r.folderDeleted).toBe(true);
    expect(f.calls.deleteFolder).toEqual(['폴더']);
    // 무관한 프로젝트는 그대로
    expect(f.folderMap.C).toBe('다른폴더');
    expect(f.folderMap.D).toBeNull();
    expect(progress[progress.length - 1]).toEqual([2, 2]);
  });

  it('일부 실패하면 폴더와 실패한 프로젝트를 원래 자리에 두고 사유를 남긴다', async () => {
    const f = makeFake({
      folderMap: { A: '폴더', B: '폴더/하위', C: '폴더', E: '폴더' },
      unloadable: ['B'],
      deleteThrows: ['C'],
      locked: ['E'],
    });
    const r = await runFolderDeleteWithProjects('폴더', f.deps);
    expect(r.deleted).toEqual(['A']);
    expect(r.failed.map((x) => x.name).sort()).toEqual(['B', 'C', 'E']);
    expect(r.failed.find((x) => x.name === 'B')!.reason).toContain('불러오지');
    expect(r.failed.find((x) => x.name === 'C')!.reason).toContain('rename 실패');
    expect(r.failed.find((x) => x.name === 'E')!.reason).toContain('다른 창');
    // 실패한 프로젝트는 미분류로 남지 않는다
    expect(f.folderMap.B).toBe('폴더/하위');
    expect(f.folderMap.C).toBe('폴더');
    expect(f.folderMap.E).toBe('폴더');
    expect(r.folderDeleted).toBe(false);
    expect(f.calls.deleteFolder).toEqual([]);
  });

  it('원래 폴더로 되돌리지 못하면 그 사실을 사유에 적는다', async () => {
    const f = makeFake({
      folderMap: { C: '폴더' },
      deleteThrows: ['C'],
      moveBackThrows: ['C'],
    });
    const r = await runFolderDeleteWithProjects('폴더', f.deps);
    expect(r.failed[0].reason).toContain('미분류에 있습니다');
    expect(r.folderDeleted).toBe(false);
  });

  it('삭제 뒤 부가 정리에서 예외가 나도 메모리에서 내려갔으면 삭제 성공으로 본다', async () => {
    const f = makeFake({ folderMap: { A: '폴더' } });
    const base = f.deps.deleteProject;
    const r = await runFolderDeleteWithProjects('폴더', {
      ...f.deps,
      deleteProject: async (n) => {
        await base(n);
        throw new Error('즐겨찾기 저장 실패');
      },
    });
    expect(r.deleted).toEqual(['A']);
    expect(r.folderDeleted).toBe(true);
  });

  it('프로젝트는 전부 지웠지만 폴더 제거가 실패하면 folderError 로 알린다', async () => {
    const f = makeFake({ folderMap: { A: '폴더' } });
    const r = await runFolderDeleteWithProjects('폴더', {
      ...f.deps,
      deleteFolder: async () => {
        throw new Error('폴더 잠김');
      },
    });
    expect(r.deleted).toEqual(['A']);
    expect(r.folderDeleted).toBe(false);
    expect(r.folderError).toBe('폴더 잠김');
  });
});
