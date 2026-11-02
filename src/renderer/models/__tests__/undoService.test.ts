// 되돌리기/다시 실행 서비스·헬퍼·씬 순서 시범 — 2026-11-01 U1 (SPEC_GUIDE 「되돌리기 계약」)
jest.mock('..', () => ({ workFlowService: {} }));

import { InpaintScene, Scene, Session } from '../types';
import {
  rebind,
  UNDO_MAX_DEPTH,
  UNDO_TEXT,
  undoDeepClone,
  undoDeepEqual,
  undoRef,
  UndoService,
} from '../undoService';
import { recordSceneOrder, sceneOrderAdapter } from '../sceneOrderUndo';

interface Harness {
  service: UndoService;
  toast: jest.Mock;
  clock: { t: number };
  mirrors: Set<Session>;
  cur: { session: Session | undefined };
}

function harness(): Harness {
  const toast = jest.fn();
  const clock = { t: 1000 };
  const mirrors = new Set<Session>();
  const cur: { session: Session | undefined } = { session: undefined };
  const service = new UndoService({
    curSession: () => cur.session,
    isMirror: (s) => mirrors.has(s),
    toast,
    now: () => clock.t,
  });
  return { service, toast, clock, mirrors, cur };
}

function makeSession(...names: string[]): { session: Session; scenes: Scene[] } {
  const session = new Session();
  session.name = 'p';
  const scenes = names.map((name) => {
    const scene = new Scene();
    scene.name = name;
    session.addScene(scene);
    return scene;
  });
  return { session, scenes };
}

const order = (s: Session, type: 'scene' | 'inpaint' = 'scene') =>
  s.getScenes(type).map((x) => x.name);

describe('기록·되돌림·다시 실행', () => {
  test('기록 → 되돌림 → 다시 실행, 새 기록은 future 를 비운다', async () => {
    const { service, toast } = harness();
    const { session } = makeSession();
    const box = { v: 1 };
    service.set(session, box, 'v', 2, '값');
    expect(service.canUndoFor(session)).toBe(true);
    expect(await service.undo(session)).toBe(true);
    expect(box.v).toBe(1);
    expect(toast).toHaveBeenLastCalledWith(UNDO_TEXT.undone('값'), 'info');
    expect(service.canRedoFor(session)).toBe(true);
    expect(await service.redo(session)).toBe(true);
    expect(box.v).toBe(2);
    expect(toast).toHaveBeenLastCalledWith(UNDO_TEXT.redone('값'), 'info');
    await service.undo(session);
    service.set(session, box, 'v', 5, '다른 값', { mergeMs: 0 });
    expect(service.canRedoFor(session)).toBe(false);
    expect(service.entries(session).past.map((e) => e.label)).toEqual(['다른 값']);
  });

  test('빈 스택에서 되돌리기·다시 실행은 아무 일도 하지 않는다', async () => {
    const { service, toast } = harness();
    const { session } = makeSession();
    expect(await service.undo(session)).toBe(false);
    expect(await service.redo(session)).toBe(false);
    expect(await service.undo(undefined)).toBe(false);
    expect(toast).not.toHaveBeenCalled();
  });

  test(`깊이 ${UNDO_MAX_DEPTH} 를 넘으면 가장 오래된 것부터 버린다`, () => {
    const { service } = harness();
    const { session } = makeSession();
    for (let i = 0; i < UNDO_MAX_DEPTH + 5; i++) {
      service.record(session, { label: `#${i}`, undo: () => {}, redo: () => {} });
    }
    const past = service.entries(session).past;
    expect(past).toHaveLength(UNDO_MAX_DEPTH);
    expect(past[0].label).toBe('#5');
    expect(past[past.length - 1].label).toBe(`#${UNDO_MAX_DEPTH + 4}`);
  });

  test('프로젝트(Session 인스턴스)마다 스택이 따로다', async () => {
    const { service } = harness();
    const a = makeSession().session;
    const b = makeSession().session;
    const box = { v: 0 };
    service.set(a, box, 'v', 1, 'A');
    expect(service.canUndoFor(a)).toBe(true);
    expect(service.canUndoFor(b)).toBe(false);
    expect(await service.undo(b)).toBe(false);
    expect(box.v).toBe(1);
  });

  test('curSession 기준 조회(canUndo·undoLabel·redoLabel)', async () => {
    const { service, cur } = harness();
    const { session } = makeSession();
    service.record(session, { label: '첫 작업', undo: () => {}, redo: () => {} });
    expect(service.canUndo).toBe(false);
    cur.session = session;
    expect(service.canUndo).toBe(true);
    expect(service.undoLabel).toBe('첫 작업');
    await service.undo();
    expect(service.canUndo).toBe(false);
    expect(service.redoLabel).toBe('첫 작업');
  });
});

describe('미러·실행 중 기록 억제', () => {
  test('미러 프로젝트는 기록도 실행도 하지 않는다', async () => {
    const { service, mirrors } = harness();
    const { session } = makeSession();
    const box = { v: 0 };
    service.set(session, box, 'v', 1, '전');
    mirrors.add(session);
    service.set(session, box, 'v', 2, '미러 중');
    expect(box.v).toBe(2); // 대입 자체는 일어난다(기록만 안 함)
    expect(service.canUndoFor(session)).toBe(false);
    expect(await service.undo(session)).toBe(false);
    mirrors.delete(session);
    expect(service.entries(session).past.map((e) => e.label)).toEqual(['전']);
  });

  test('되돌리는 동안 생긴 기록은 무시한다(재귀 방지)', async () => {
    const { service } = harness();
    const { session } = makeSession();
    const box = { v: 0 };
    service.record(session, {
      label: '중첩',
      undo: () => service.set(session, box, 'v', 9, '안쪽'),
      redo: () => {},
    });
    await service.undo(session);
    expect(box.v).toBe(9);
    const { past, future } = service.entries(session);
    expect(past).toHaveLength(0);
    expect(future.map((e) => e.label)).toEqual(['중첩']);
  });
});

describe('실패 처리(D15)', () => {
  test('예외 → 오류 토스트 + 그 항목만 버리고 아래 항목은 유지', async () => {
    const { service, toast } = harness();
    const { session } = makeSession();
    const box = { v: 0 };
    service.set(session, box, 'v', 1, '아래');
    service.record(session, {
      label: '위',
      undo: () => {
        throw new Error('파일이 없습니다');
      },
      redo: () => {},
    });
    expect(await service.undo(session)).toBe(false);
    expect(toast).toHaveBeenLastCalledWith(UNDO_TEXT.undoFailed('파일이 없습니다'), 'error');
    expect(service.entries(session).past.map((e) => e.label)).toEqual(['아래']);
    expect(service.entries(session).future).toHaveLength(0);
    expect(await service.undo(session)).toBe(true);
    expect(box.v).toBe(0);
  });

  test('verify 가 이유를 돌려주면 실행하지 않고 버린다', async () => {
    const { service, toast } = harness();
    const { session } = makeSession();
    const undo = jest.fn();
    service.record(session, { label: 'x', undo, redo: () => {}, verify: () => '대상이 사라졌습니다' });
    expect(await service.undo(session)).toBe(false);
    expect(undo).not.toHaveBeenCalled();
    expect(toast).toHaveBeenLastCalledWith(UNDO_TEXT.undoFailed('대상이 사라졌습니다'), 'error');
    expect(service.canUndoFor(session)).toBe(false);
  });

  test('다시 실행 실패 문구', async () => {
    const { service, toast } = harness();
    const { session } = makeSession();
    service.record(session, {
      label: 'x',
      undo: () => {},
      redo: () => {
        throw new Error('막힘');
      },
    });
    await service.undo(session);
    expect(await service.redo(session)).toBe(false);
    expect(toast).toHaveBeenLastCalledWith(UNDO_TEXT.redoFailed('막힘'), 'error');
    expect(service.canRedoFor(session)).toBe(false);
  });
});

describe('비동기 직렬화', () => {
  test('처리 중 연타는 무시하고 「진행 중」 안내, 끝나면 다음 것을 받는다', async () => {
    const { service, toast } = harness();
    const { session } = makeSession();
    const calls: string[] = [];
    service.record(session, { label: '1', undo: () => void calls.push('1'), redo: () => {} });
    let release!: () => void;
    service.record(session, {
      label: '2',
      undo: () =>
        new Promise<void>((r) => {
          release = () => {
            calls.push('2');
            r();
          };
        }),
      redo: () => {},
    });
    const first = service.undo(session);
    expect(service.isBusy).toBe(true);
    expect(await service.undo(session)).toBe(false);
    expect(toast).toHaveBeenLastCalledWith(UNDO_TEXT.busy, 'info');
    release();
    expect(await first).toBe(true);
    expect(await service.undo(session)).toBe(true);
    expect(calls).toEqual(['2', '1']);
  });
});

describe('비동기 실행 중 기록(U4 대기열)', () => {
  test('비동기 항목을 기다리는 동안의 기록은 버리지 않고 끝난 뒤 순서대로 쌓는다(병합도 대기열 안에서)', async () => {
    const { service, clock } = harness();
    const { session } = makeSession();
    const box = { v: 0, w: 0 };
    let release!: () => void;
    service.record(session, {
      label: '파일',
      kind: 'file',
      undo: () => new Promise<void>((r) => (release = r)),
      redo: () => {},
    });
    const running = service.undo(session);
    expect(service.isBusy).toBe(true);
    expect(service.isApplying).toBe(false);
    service.set(session, box, 'v', 1, '값 v');
    clock.t += 300;
    service.set(session, box, 'v', 2, '값 v'); // 같은 칸 1초 안 → 대기열의 항목에 합침
    service.set(session, box, 'w', 5, '값 w');
    expect(service.entries(session).past.map((e) => e.label)).toEqual(['파일']); // 아직 쌓지 않음
    release();
    expect(await running).toBe(true);
    const { past, future } = service.entries(session);
    expect(past.map((e) => e.label)).toEqual(['값 v', '값 w']);
    expect(future).toHaveLength(0);
    await service.undo(session);
    await service.undo(session);
    expect(box).toEqual({ v: 0, w: 0 });
  });

  test('항목이 결과 안내(notice)를 주면 토스트 끝에 붙이고, 묶음은 하위 안내를 모은다', async () => {
    const { service, toast } = harness();
    const { session } = makeSession();
    service.record(session, {
      label: '삭제',
      undo: async () => ({ total: 3, failed: 1, notice: '1장은 사라짐' }),
      redo: () => {},
    });
    await service.undo(session);
    expect(toast).toHaveBeenLastCalledWith(UNDO_TEXT.undone('삭제') + ' (1장은 사라짐)', 'error');
    const g = service.beginGroup(session, '묶음');
    g.add({ label: 'a', undo: async () => ({ total: 1, failed: 0, notice: '이름 유지' }), redo: () => {} });
    g.add({ label: 'b', undo: () => { throw new Error('x'); }, redo: () => {} });
    g.commit();
    await service.undo(session);
    expect(toast).toHaveBeenLastCalledWith(
      UNDO_TEXT.undone('묶음') + ` (이름 유지 · ${UNDO_TEXT.partial(1, 2).trim()})`,
      'error',
    );
  });
});

describe('set 병합(D12)', () => {
  test('같은 칸 1초 안 연속 변경은 1항목, 넘으면 새 항목', async () => {
    const { service, clock } = harness();
    const { session } = makeSession();
    const box = { seed: 1 };
    service.set(session, box, 'seed', 2, '시드');
    clock.t += 500;
    service.set(session, box, 'seed', 3, '시드');
    clock.t += 900; // 직전 변경으로부터 0.9초 — 병합
    service.set(session, box, 'seed', 4, '시드');
    expect(service.entries(session).past).toHaveLength(1);
    clock.t += 1500;
    service.set(session, box, 'seed', 5, '시드');
    expect(service.entries(session).past).toHaveLength(2);
    await service.undo(session);
    expect(box.seed).toBe(4);
    await service.undo(session);
    expect(box.seed).toBe(1);
  });

  test('병합 결과가 처음 값으로 돌아오면 항목을 지운다', () => {
    const { service, clock } = harness();
    const { session } = makeSession();
    const box = { w: 832 };
    service.set(session, box, 'w', 900, '너비');
    clock.t += 100;
    service.set(session, box, 'w', 832, '너비');
    expect(service.entries(session).past).toHaveLength(0);
  });

  test('다른 칸·다른 객체는 병합하지 않는다, 같은 값 대입은 기록 없음', () => {
    const { service } = harness();
    const { session } = makeSession();
    const a = { v: 0, u: 0 };
    const b = { v: 0 };
    service.set(session, a, 'v', 1, 'a.v');
    service.set(session, a, 'u', 1, 'a.u');
    service.set(session, b, 'v', 1, 'b.v');
    service.set(session, b, 'v', 1, 'b.v');
    expect(service.entries(session).past.map((e) => e.label)).toEqual(['a.v', 'a.u', 'b.v']);
  });
});

describe('group·beginGroup(D14)', () => {
  test('묶음 1항목 — 되돌림은 역순, 다시 실행은 정순', async () => {
    const { service } = harness();
    const { session } = makeSession();
    const log: string[] = [];
    service.group(session, '대량', () => {
      for (const n of ['a', 'b', 'c']) {
        service.record(session, {
          label: n,
          undo: () => void log.push(`u${n}`),
          redo: () => void log.push(`r${n}`),
        });
      }
    });
    expect(service.entries(session).past.map((e) => e.label)).toEqual(['대량']);
    await service.undo(session);
    await service.redo(session);
    expect(log).toEqual(['uc', 'ub', 'ua', 'ra', 'rb', 'rc']);
  });

  test('일부 실패 — 나머지는 계속, 실패 수 안내, 실패한 하위 항목만 버림', async () => {
    const { service, toast } = harness();
    const { session } = makeSession();
    const log: string[] = [];
    const g = service.beginGroup(session, '묶음');
    service.record(session, { label: 'a', undo: () => void log.push('ua'), redo: () => void log.push('ra') });
    g.add({
      label: 'b',
      undo: () => {
        throw new Error('b 실패');
      },
      redo: () => void log.push('rb'),
    });
    service.record(session, { label: 'c', undo: async () => void log.push('uc'), redo: () => void log.push('rc') });
    expect(g.commit()).toBe(true);
    expect(await service.undo(session)).toBe(true);
    expect(log).toEqual(['uc', 'ua']);
    expect(toast).toHaveBeenLastCalledWith(UNDO_TEXT.undone('묶음') + UNDO_TEXT.partial(1, 3), 'error');
    await service.redo(session);
    expect(log).toEqual(['uc', 'ua', 'ra', 'rc']); // 실패한 b 는 빠졌다
  });

  test('하위 항목이 전부 실패하면 묶음 자체를 버린다', async () => {
    const { service, toast } = harness();
    const { session } = makeSession();
    service.group(session, '전부 실패', () => {
      service.record(session, { label: 'a', undo: () => { throw new Error('x'); }, redo: () => {} });
    });
    expect(await service.undo(session)).toBe(false);
    expect(toast).toHaveBeenLastCalledWith(UNDO_TEXT.undoFailed('x'), 'error');
    expect(service.entries(session)).toEqual({ past: [], future: [] });
  });

  test('빈 묶음·취소는 기록하지 않는다, fn 이 던져도 생긴 기록은 남긴다', () => {
    const { service } = harness();
    const { session } = makeSession();
    expect(service.beginGroup(session, '빈').commit()).toBe(false);
    const g = service.beginGroup(session, '취소');
    service.record(session, { label: 'a', undo: () => {}, redo: () => {} });
    g.cancel();
    expect(service.entries(session).past).toHaveLength(0);
    const box = { v: 0 };
    expect(() =>
      service.group(session, '던짐', () => {
        service.set(session, box, 'v', 1, 'v');
        throw new Error('중간 실패');
      }),
    ).toThrow('중간 실패');
    expect(service.entries(session).past.map((e) => e.label)).toEqual(['던짐']);
  });
});

describe('run', () => {
  test('성공했을 때만 기록, 비동기는 끝난 뒤 기록', async () => {
    const { service } = harness();
    const { session } = makeSession();
    expect(() =>
      service.run(session, '실패', {
        apply: () => {
          throw new Error('no');
        },
        revert: () => {},
      }),
    ).toThrow('no');
    expect(service.entries(session).past).toHaveLength(0);
    const box = { on: false };
    const p = service.run(session, '켜기', {
      apply: async () => {
        box.on = true;
        return 7;
      },
      revert: () => {
        box.on = false;
      },
    });
    expect(service.entries(session).past).toHaveLength(0);
    expect(await p).toBe(7);
    expect(service.entries(session).past.map((e) => e.label)).toEqual(['켜기']);
    await service.undo(session);
    expect(box.on).toBe(false);
    await service.redo(session);
    expect(box.on).toBe(true);
  });
});

describe('capture·drag·focusEdit 헬퍼', () => {
  test('capture 는 깊은 복사 — toJSON 이 내부 배열을 그대로 넘겨도 스냅숏이 오염되지 않는다', async () => {
    const { service } = harness();
    const { session } = makeSession();
    // AbstractScene.toJSON 처럼 내부 배열을 복사하지 않고 넘기는 객체
    class Holder {
      constructor(public list: string[]) {}
      toJSON() {
        return { list: this.list };
      }
    }
    const target = { item: new Holder(['a']) as unknown, tags: ['x'] };
    const pending = service.capture(session, '목록', target, ['item', 'tags']);
    (target.item as Holder).list.push('b'); // 제자리 수정 — 스냅숏에 섞이면 안 됨
    target.tags.push('y');
    expect(pending.commit()).toBe(true);
    await service.undo(session);
    expect(target.item).toEqual({ list: ['a'] });
    expect(target.tags).toEqual(['x']);
    // 되살린 값을 고쳐도 보관본은 그대로 — 다시 실행 후 되돌리면 같은 값
    target.tags.push('z');
    await service.redo(session);
    expect(target.tags).toEqual(['x', 'y']);
    target.tags.push('w');
    await service.undo(session);
    expect(target.tags).toEqual(['x']);
  });

  test('capture restore 옵션으로 클래스 객체 복원', async () => {
    const { service } = harness();
    const { session } = makeSession();
    const target = { when: new Map([['a', 1]]) as Map<string, number> };
    const pending = service.capture(session, '맵', target, ['when']);
    target.when.set('b', 2);
    pending.commit();
    await service.undo(session);
    expect([...target.when.entries()]).toEqual([['a', 1]]);
  });

  test('drag — 변화가 없으면 버리고, 바뀌었으면 1항목', async () => {
    const { service } = harness();
    const { session } = makeSession();
    const pos = { x: 0.5, y: 0.5 };
    const noop = service.drag(session, '위치', pos, ['x', 'y']);
    pos.x = 0.7;
    pos.x = 0.5; // 제자리로 놓음
    expect(noop.commit()).toBe(false);
    expect(service.entries(session).past).toHaveLength(0);
    const moved = service.drag(session, '위치', pos, ['x', 'y']);
    pos.x = 0.1;
    pos.y = 0.9;
    expect(moved.commit()).toBe(true);
    await service.undo(session);
    expect(pos).toEqual({ x: 0.5, y: 0.5 });
  });

  test('끝나지 않은 drag 는 다음 drag 시작·되돌리기 직전에 확정된다', async () => {
    const { service } = harness();
    const { session } = makeSession();
    const pos = { x: 0 };
    service.drag(session, '첫 드래그', pos, ['x']);
    pos.x = 1;
    const second = service.drag(session, '둘째 드래그', pos, ['x']); // 첫 드래그 pointerup 을 놓친 경우
    expect(service.entries(session).past.map((e) => e.label)).toEqual(['첫 드래그']);
    pos.x = 2;
    expect(await service.undo(session)).toBe(true); // 둘째가 먼저 확정되고 그것이 되돌려진다
    expect(pos.x).toBe(1);
    expect(second.commit()).toBe(false); // 이미 확정됨
  });

  test('focusEdit — 바뀐 경우만 blur 때 1항목', async () => {
    const { service } = harness();
    const { session } = makeSession();
    const scene = { prompt: 'a, b' };
    const same = service.focusEdit(session, scene, 'prompt', '중간 프롬프트');
    expect(same.commit()).toBe(false);
    const edit = service.focusEdit(session, scene, 'prompt', '중간 프롬프트');
    scene.prompt = 'a, b, c';
    scene.prompt = 'a, b, c, d';
    expect(edit.commit()).toBe(true);
    expect(service.entries(session).past).toHaveLength(1);
    await service.undo(session);
    expect(scene.prompt).toBe('a, b');
  });
});

describe('손잡이·깊은 복사 유틸', () => {
  test('undoRef 는 객체당 하나, rebind 로 새 객체를 가리킨다', () => {
    const oldObj = { name: 'old' };
    const newObj = { name: 'new' };
    const r = undoRef(oldObj);
    expect(undoRef(oldObj)).toBe(r);
    rebind(oldObj, newObj);
    expect(r.current).toBe(newObj);
    expect(undoRef(newObj)).toBe(r);
    rebind({ name: 'none' }, newObj); // 손잡이 없는 객체는 무시
    expect(r.current).toBe(newObj);
  });

  test('undoDeepClone·undoDeepEqual', () => {
    const src = { a: [1, { b: 2 }], m: new Map([['k', [1]]]), s: new Set([1]) };
    const c = undoDeepClone(src);
    expect(c).not.toBe(src);
    expect(c.a).not.toBe(src.a);
    expect(c.m.get('k')).not.toBe(src.m.get('k'));
    expect(undoDeepEqual(src, c)).toBe(true);
    expect(undoDeepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(undoDeepEqual([1, 2], [2, 1])).toBe(false);
    expect(undoDeepEqual(undefined, null)).toBe(false);
  });
});

describe('Session.reorderScenes·moveScene 통일', () => {
  test('moveScene — 기존 의미(그 씬을 index 자리로) 그대로', () => {
    const { session, scenes } = makeSession('a', 'b', 'c', 'd');
    session.moveScene(scenes[3], 0);
    expect(order(session)).toEqual(['d', 'a', 'b', 'c']);
    session.moveScene(scenes[3], 3);
    expect(order(session)).toEqual(['a', 'b', 'c', 'd']);
    session.moveScene(scenes[0], 2);
    expect(order(session)).toEqual(['b', 'c', 'a', 'd']);
  });

  test('reorderScenes — 없는 씬은 건너뛰고, 목록에 없는 씬은 뒤에 남긴다', () => {
    const { session, scenes } = makeSession('a', 'b', 'c');
    const ghost = new Scene();
    ghost.name = 'ghost';
    session.reorderScenes('scene', [scenes[2], ghost, scenes[0]]);
    expect(order(session)).toEqual(['c', 'a', 'b']);
    expect(session.scenes.has('ghost')).toBe(false);
    expect(session.scenes.get('a')).toBe(scenes[0]); // 객체 그대로
  });

  test('변형 씬 「맨 뒤로」 = 변형 씬 목록 끝(A3)', () => {
    const { session } = makeSession('s1', 's2', 's3', 's4');
    const v = ['v1', 'v2'].map((name) => {
      const x = new InpaintScene();
      x.name = name;
      session.addScene(x);
      return x;
    });
    session.moveScene(v[0], session.getScenes('inpaint').length - 1);
    expect(order(session, 'inpaint')).toEqual(['v2', 'v1']);
    expect(order(session)).toEqual(['s1', 's2', 's3', 's4']);
  });
});

describe('씬 순서 시범(U1)', () => {
  test('맨 앞으로 → 되돌림·다시 실행', async () => {
    const { service } = harness();
    const { session, scenes } = makeSession('a', 'b', 'c');
    recordSceneOrder(session, 'scene', UNDO_TEXT.sceneMoveFront, () => session.moveScene(scenes[2], 0), service);
    expect(order(session)).toEqual(['c', 'a', 'b']);
    expect(service.peekLabel(session, 'undo')).toBe(UNDO_TEXT.sceneMoveFront);
    await service.undo(session);
    expect(order(session)).toEqual(['a', 'b', 'c']);
    await service.redo(session);
    expect(order(session)).toEqual(['c', 'a', 'b']);
  });

  test('순서가 그대로면 기록하지 않는다(맨 앞 씬을 맨 앞으로·놓지 않고 끝낸 드래그 — A13)', () => {
    const { service } = harness();
    const { session, scenes } = makeSession('a', 'b');
    recordSceneOrder(session, 'scene', UNDO_TEXT.sceneMoveFront, () => session.moveScene(scenes[0], 0), service);
    // 드롭 없이 끝난 드래그 → SceneQueueControl.moveScene 이 원래 자리로 되돌림(변화 없음)
    recordSceneOrder(session, 'scene', UNDO_TEXT.sceneOrderDrag, () => session.moveScene(scenes[1], 1), service);
    expect(service.entries(session).past).toHaveLength(0);
  });

  test('다중 드래그(한 번의 드롭) = 1항목, 이름순 정렬(moveScene 반복) = 1항목', async () => {
    const { service } = harness();
    const { session, scenes } = makeSession('c', 'a', 'd', 'b');
    // 다중 선택 드롭(SceneQueueControl.moveScenes → reorderScenes 한 번)
    recordSceneOrder(
      session,
      'scene',
      UNDO_TEXT.sceneOrderDrag,
      () => session.reorderScenes('scene', [scenes[1], scenes[3], scenes[0], scenes[2]]),
      service,
    );
    expect(order(session)).toEqual(['a', 'b', 'c', 'd']);
    recordSceneOrder(
      session,
      'scene',
      UNDO_TEXT.sceneSortByName,
      () => {
        session.moveScene(scenes[2], 0);
        session.moveScene(scenes[0], 1);
      },
      service,
    );
    expect(order(session)).toEqual(['d', 'c', 'a', 'b']);
    expect(service.entries(session).past.map((e) => e.label)).toEqual([
      UNDO_TEXT.sceneOrderDrag,
      UNDO_TEXT.sceneSortByName,
    ]);
    await service.undo(session);
    expect(order(session)).toEqual(['a', 'b', 'c', 'd']);
    await service.undo(session);
    expect(order(session)).toEqual(['c', 'a', 'd', 'b']);
  });

  test('★ 기록 뒤 생성 결과로 새 씬·새 이미지가 생긴 상태에서 되돌림 → 새 항목 유지, 순서만 복원', async () => {
    const { service } = harness();
    const { session, scenes } = makeSession('a', 'b', 'c');
    scenes[0].imageMap = ['a1.png'];
    scenes[0].mains = ['a1.png'];
    recordSceneOrder(session, 'scene', UNDO_TEXT.sceneMoveBack, () => session.moveScene(scenes[0], 2), service);
    expect(order(session)).toEqual(['b', 'c', 'a']);
    // ── 생성 중(기록 밖) 변화: 기존 씬에 새 이미지, 새 씬 추가(재생성·다른 작업 등) ──
    scenes[0].imageMap = [...scenes[0].imageMap, 'a2.png'];
    scenes[1].imageMap = ['b1.png'];
    const fresh = new Scene();
    fresh.name = 'new';
    fresh.imageMap = ['n1.png'];
    session.addScene(fresh);
    expect(await service.undo(session)).toBe(true);
    expect(order(session)).toEqual(['a', 'b', 'c', 'new']); // 순서만 복원, 새 씬은 뒤에 유지
    expect(session.scenes.get('a')).toBe(scenes[0]);
    expect(scenes[0].imageMap).toEqual(['a1.png', 'a2.png']); // 새 이미지 유지
    expect(scenes[0].mains).toEqual(['a1.png']);
    expect(scenes[1].imageMap).toEqual(['b1.png']);
    expect(session.scenes.get('new')!.imageMap).toEqual(['n1.png']);
    // 다시 실행도 새 씬·이미지를 지우지 않는다
    expect(await service.redo(session)).toBe(true);
    expect(order(session)).toEqual(['b', 'c', 'a', 'new']);
    expect(scenes[0].imageMap).toEqual(['a1.png', 'a2.png']);
  });

  test('기록 뒤 지워진 씬은 건너뛰고 남은 씬 순서만 복원', async () => {
    const { service } = harness();
    const { session, scenes } = makeSession('a', 'b', 'c');
    recordSceneOrder(session, 'scene', UNDO_TEXT.sceneMoveFront, () => session.moveScene(scenes[2], 0), service);
    session.removeScene('scene', 'b');
    expect(await service.undo(session)).toBe(true);
    expect(order(session)).toEqual(['a', 'c']);
  });

  test('drag 헬퍼 + 씬 순서 짝(누르는 동안 여러 번 바뀌어도 놓을 때 1항목)', async () => {
    const { service } = harness();
    const { session, scenes } = makeSession('a', 'b', 'c');
    const pending = service.drag(
      session,
      UNDO_TEXT.sceneOrderDrag,
      sceneOrderAdapter(session, 'scene') as never,
    );
    session.moveScene(scenes[0], 1);
    session.moveScene(scenes[0], 2);
    expect(pending.commit()).toBe(true);
    expect(service.entries(session).past).toHaveLength(1);
    await service.undo(session);
    expect(order(session)).toEqual(['a', 'b', 'c']);
  });

  test('이름 변경(인스턴스 유지)·삭제 복원(rebind) 뒤에도 손잡이로 따라간다', async () => {
    const { service } = harness();
    const { session, scenes } = makeSession('a', 'b');
    recordSceneOrder(session, 'scene', UNDO_TEXT.sceneMoveFront, () => session.moveScene(scenes[1], 0), service);
    // b 를 지웠다가 새 객체로 되살린 경우(U4 의 휴지통 복원) — rebind 로 손잡이 이전
    session.removeScene('scene', 'b');
    const restored = new Scene();
    restored.name = 'b';
    session.addScene(restored);
    rebind(scenes[1], restored);
    await service.undo(session);
    expect(order(session)).toEqual(['a', 'b']);
    await service.redo(session);
    expect(order(session)).toEqual(['b', 'a']);
    expect(session.scenes.get('b')).toBe(restored);
  });
});
