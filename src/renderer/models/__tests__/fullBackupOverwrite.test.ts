import {
  clearForFullBackupOverwrite,
  FULL_BACKUP_OVERWRITE_TEXT,
  type FullBackupOverwriteDeps,
} from '../fullBackupOverwrite';

// 전체 백업 복원 「덮어쓰기」(2026-10-02 S4): 기존 프로젝트가 목록에서 사라진 것이 확인된 뒤에만
// 영구 삭제·가져오기로 넘어간다. 가짜 저장소 — SessionService.delete 의 관찰 가능한 동작을 흉내 낸다.
interface FakeOptions {
  names: string[];
  /** 다른 창에서 열려 있음: delete 가 throw 없이 반환(목록에 남음) */
  locked?: string[];
  /** 불러오기 실패 등: delete 가 파일 이동 전에 예외 */
  removeThrows?: string[];
  /** 파일 이동은 끝났는데 뒤따르는 정리에서 예외(목록에서는 사라짐) */
  removeThrowsAfterMove?: string[];
  purgeThrows?: string[];
}

const makeFake = (opt: FakeOptions) => {
  const names = new Set(opt.names);
  const calls = { remove: [] as string[], purge: [] as string[], before: [] as string[] };
  const deps: FullBackupOverwriteDeps = {
    listNames: () => [...names],
    beforeRemove: (n) => {
      calls.before.push(n);
    },
    remove: async (n) => {
      calls.remove.push(n);
      if (opt.removeThrows?.includes(n)) throw new Error('불러오지 못함');
      if (opt.locked?.includes(n)) return;
      names.delete(n);
      if (opt.removeThrowsAfterMove?.includes(n)) throw new Error('즐겨찾기 저장 실패');
    },
    purge: async (n) => {
      calls.purge.push(n);
      if (opt.purgeThrows?.includes(n)) throw new Error('영구 삭제 실패');
    },
    logError: () => {},
  };
  return { deps, calls, names };
};

describe('clearForFullBackupOverwrite', () => {
  test('삭제 성공 → 영구 삭제 후 가져오기 허용', async () => {
    const f = makeFake({ names: ['A', 'B'] });
    const r = await clearForFullBackupOverwrite('A', f.deps);
    expect(r).toEqual({ kind: 'cleared', purged: true });
    expect(f.calls.before).toEqual(['A']);
    expect(f.calls.remove).toEqual(['A']);
    expect(f.calls.purge).toEqual(['A']);
    expect([...f.names]).toEqual(['B']);
  });

  test('다른 창 잠금(삭제 뒤에도 목록에 남음) → 건너뜀, 영구 삭제도 부르지 않음', async () => {
    const f = makeFake({ names: ['A'], locked: ['A'] });
    const r = await clearForFullBackupOverwrite('A', f.deps);
    expect(r).toEqual({ kind: 'blocked', cause: 'still-listed' });
    expect(f.calls.purge).toEqual([]);
    expect([...f.names]).toEqual(['A']);
  });

  test('delete 예외(불러오기 실패) → 건너뜀, 영구 삭제 없음', async () => {
    const f = makeFake({ names: ['A'], removeThrows: ['A'] });
    const r = await clearForFullBackupOverwrite('A', f.deps);
    expect(r).toEqual({ kind: 'blocked', cause: 'remove-threw' });
    expect(f.calls.purge).toEqual([]);
  });

  test('delete 가 파일 이동 뒤 예외 → 그래도 건너뜀(기존은 휴지통에 있음, 영구 삭제 없음)', async () => {
    const f = makeFake({ names: ['A'], removeThrowsAfterMove: ['A'] });
    const r = await clearForFullBackupOverwrite('A', f.deps);
    expect(r).toEqual({ kind: 'blocked', cause: 'remove-threw' });
    expect(f.calls.purge).toEqual([]);
  });

  test('영구 삭제 실패는 예전처럼 가져오기를 막지 않는다(목록에서는 이미 사라짐)', async () => {
    const f = makeFake({ names: ['A'], purgeThrows: ['A'] });
    const r = await clearForFullBackupOverwrite('A', f.deps);
    expect(r).toEqual({ kind: 'cleared', purged: false });
  });

  test('beforeRemove 예외도 건너뜀으로 처리', async () => {
    const f = makeFake({ names: ['A'] });
    f.deps.beforeRemove = () => {
      throw new Error('x');
    };
    const r = await clearForFullBackupOverwrite('A', f.deps);
    expect(r.kind).toBe('blocked');
    expect(f.calls.remove).toEqual([]);
  });

  test('안내 문구에 이름과 사유가 들어간다', () => {
    expect(FULL_BACKUP_OVERWRITE_TEXT.blockedCount(2)).toBe('2개 덮어쓰지 못함');
    const d = FULL_BACKUP_OVERWRITE_TEXT.blockedDetail(['가', '나']);
    expect(d).toContain('「가」, 「나」');
    expect(d).toContain('다른 창에서 열려 있거나 불러오지 못해 덮어쓰지 않았습니다');
  });
});
