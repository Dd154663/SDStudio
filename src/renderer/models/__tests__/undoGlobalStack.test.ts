// 되돌리기 전역 스택(2026-11-03 2차 묶음 2 — 사용자 결정 D2 ①, SPEC_GUIDE 「되돌리기 계약」 「전역 스택」).
// 전역 스택 기록·되돌림·다시 실행, 프로젝트 스택과 섞였을 때 「가장 최근」(seq) 선택, 프로젝트 없음·미러일 때 전역만,
// 깊이 100, verify 실패 폐기(D15), staleReason(기록 밖 변경 = 실패), 비동기 복원, 새 기록이 짝 스택 future 를 끊음.
jest.mock('..', () => ({ workFlowService: {} }));

import { Session } from '../types';
import {
  GLOBAL_UNDO_SCOPE,
  UNDO_MAX_DEPTH,
  UNDO_TEXT,
  UndoService,
  UndoSnapshotAdapter,
} from '../undoService';

function harness() {
  const toast = jest.fn();
  const confirm = jest.fn(async () => true);
  const clock = { t: 1000 };
  const mirrors = new Set<Session>();
  const cur: { session: Session | undefined } = { session: undefined };
  const service = new UndoService({
    curSession: () => cur.session,
    isMirror: (s) => mirrors.has(s),
    toast,
    now: () => clock.t,
    confirm,
  });
  return { service, toast, confirm, clock, mirrors, cur };
}

function makeSession(name = 'p'): Session {
  const s = new Session();
  s.name = name;
  return s;
}

describe('전역 스택 기본', () => {
  test('프로젝트 없이 기록 → 되돌림 → 다시 실행(curSession undefined 에서도 동작)', async () => {
    const { service, toast } = harness();
    const box = { v: 1 };
    service.set(GLOBAL_UNDO_SCOPE, box, 'v', 2, '전역 값');
    expect(service.hasGlobalEntries).toBe(true);
    expect(service.canUndo).toBe(true);
    expect(service.undoLabel).toBe('전역 값');
    expect(await service.undo()).toBe(true);
    expect(box.v).toBe(1);
    expect(toast).toHaveBeenLastCalledWith(UNDO_TEXT.undone('전역 값'), 'info');
    expect(service.canRedo).toBe(true);
    expect(service.redoLabel).toBe('전역 값');
    expect(await service.redo()).toBe(true);
    expect(box.v).toBe(2);
    expect(toast).toHaveBeenLastCalledWith(UNDO_TEXT.redone('전역 값'), 'info');
  });

  test('전역 스택은 미러와 무관하게 기록되고, 미러 프로젝트에서는 전역 항목만 되돌린다', async () => {
    const { service, mirrors, cur } = harness();
    const session = makeSession();
    mirrors.add(session);
    cur.session = session;
    expect(service.canRecord(GLOBAL_UNDO_SCOPE)).toBe(true);
    expect(service.canRecord(session)).toBe(false);
    const box = { v: 1 };
    service.set(session, box, 'v', 5, '미러 값'); // 대입만, 기록 없음
    service.set(GLOBAL_UNDO_SCOPE, box, 'v', 6, '전역 값');
    expect(service.entries(session).past).toHaveLength(0);
    expect(service.undoLabel).toBe('전역 값');
    expect(await service.undo(session)).toBe(true);
    expect(box.v).toBe(5);
    expect(service.canUndoFor(session)).toBe(false);
  });

  test('프로젝트를 바꿔도 전역 스택은 유지, 프로젝트 스택은 인스턴스별', async () => {
    const { service, cur } = harness();
    const a = makeSession('a');
    const b = makeSession('b');
    const ba = { v: 0 };
    const bg = { v: 0 };
    cur.session = a;
    service.set(a, ba, 'v', 1, 'A 값');
    service.set(GLOBAL_UNDO_SCOPE, bg, 'v', 1, '전역 값');
    cur.session = b;
    expect(service.undoLabel).toBe('전역 값');
    expect(await service.undo()).toBe(true);
    expect(bg.v).toBe(0);
    expect(service.canUndo).toBe(false); // b 에는 아무것도 없다
    cur.session = a;
    expect(service.undoLabel).toBe('A 값');
  });

  test('전역 스택 깊이 100(넘치면 오래된 것부터 버림)', () => {
    const { service } = harness();
    for (let i = 0; i < UNDO_MAX_DEPTH + 5; i++) {
      service.record(GLOBAL_UNDO_SCOPE, { label: `#${i}`, undo: () => {}, redo: () => {} });
    }
    const past = service.entries(GLOBAL_UNDO_SCOPE).past;
    expect(past).toHaveLength(UNDO_MAX_DEPTH);
    expect(past[0].label).toBe('#5');
  });

  test('되돌리는 중(applying)에는 전역 기록도 무시', async () => {
    const { service } = harness();
    service.record(GLOBAL_UNDO_SCOPE, {
      label: '바깥',
      undo: () => {
        service.record(GLOBAL_UNDO_SCOPE, { label: '재귀', undo: () => {}, redo: () => {} });
      },
      redo: () => {},
    });
    await service.undo();
    expect(service.entries(GLOBAL_UNDO_SCOPE).past).toHaveLength(0);
    expect(service.entries(GLOBAL_UNDO_SCOPE).future.map((e) => e.label)).toEqual(['바깥']);
  });
});

describe('프로젝트 스택과 섞였을 때 — 가장 최근(seq) 선택', () => {
  test('프로젝트 → 전역 → 프로젝트 순 기록 뒤 Ctrl+Z 3번 = 역순, Ctrl+Y 3번 = 정순', async () => {
    const { service, cur } = harness();
    const session = makeSession();
    cur.session = session;
    const log: string[] = [];
    const rec = (scope: Session | typeof GLOBAL_UNDO_SCOPE, label: string) =>
      service.record(scope, {
        label,
        undo: () => {
          log.push(`undo:${label}`);
        },
        redo: () => {
          log.push(`redo:${label}`);
        },
      });
    rec(session, 'P1');
    rec(GLOBAL_UNDO_SCOPE, 'G1');
    rec(session, 'P2');
    expect(service.undoLabel).toBe('P2');
    await service.undo();
    expect(service.undoLabel).toBe('G1');
    await service.undo();
    expect(service.undoLabel).toBe('P1');
    await service.undo();
    expect(service.canUndo).toBe(false);
    expect(log).toEqual(['undo:P2', 'undo:G1', 'undo:P1']);
    // 다시 실행 = 최근 되돌린 것부터
    expect(service.redoLabel).toBe('P1');
    await service.redo();
    expect(service.redoLabel).toBe('G1');
    await service.redo();
    expect(service.redoLabel).toBe('P2');
    await service.redo();
    expect(service.canRedo).toBe(false);
    expect(log.slice(3)).toEqual(['redo:P1', 'redo:G1', 'redo:P2']);
    expect(service.entries(session).past.map((e) => e.label)).toEqual(['P1', 'P2']);
    expect(service.entries(GLOBAL_UNDO_SCOPE).past.map((e) => e.label)).toEqual(['G1']);
  });

  test('병합(set 1초)으로 갱신된 항목은 그 시점이 최근', async () => {
    const { service, cur, clock } = harness();
    const session = makeSession();
    cur.session = session;
    const box = { v: 0 };
    const g = { v: 0 };
    service.set(session, box, 'v', 1, '프로젝트 값');
    service.set(GLOBAL_UNDO_SCOPE, g, 'v', 1, '전역 값');
    clock.t += 300;
    service.set(session, box, 'v', 2, '프로젝트 값'); // 병합 → 프로젝트 항목이 최근
    expect(service.undoLabel).toBe('프로젝트 값');
    await service.undo();
    expect(box.v).toBe(0);
    expect(service.undoLabel).toBe('전역 값');
  });

  test('새 기록은 짝 스택(프로젝트 ↔ 전역)의 다시 실행도 끊는다(한 이력)', async () => {
    const { service, cur } = harness();
    const session = makeSession();
    cur.session = session;
    const noop = { undo: () => {}, redo: () => {} };
    service.record(GLOBAL_UNDO_SCOPE, { label: 'G', ...noop });
    await service.undo();
    expect(service.redoLabel).toBe('G');
    service.record(session, { label: 'P', ...noop });
    expect(service.canRedo).toBe(false);
    expect(service.entries(GLOBAL_UNDO_SCOPE).future).toHaveLength(0);
    // 반대 방향: 프로젝트 future 를 전역 기록이 끊는다
    await service.undo(); // P 되돌림
    expect(service.redoLabel).toBe('P');
    service.record(GLOBAL_UNDO_SCOPE, { label: 'G2', ...noop });
    expect(service.entries(session).future).toHaveLength(0);
  });
});

describe('전역 항목 실패 처리(D15)', () => {
  test('verify 실패 → 오류 토스트 + 그 항목만 폐기(아래 항목 유지)', async () => {
    const { service, toast } = harness();
    service.record(GLOBAL_UNDO_SCOPE, { label: '아래', undo: () => {}, redo: () => {} });
    service.record(GLOBAL_UNDO_SCOPE, {
      label: '위',
      verify: () => '다른 창이 바꿨습니다',
      undo: () => {},
      redo: () => {},
    });
    expect(await service.undo()).toBe(false);
    expect(toast).toHaveBeenLastCalledWith(UNDO_TEXT.undoFailed('다른 창이 바꿨습니다'), 'error');
    expect(service.entries(GLOBAL_UNDO_SCOPE).past.map((e) => e.label)).toEqual(['아래']);
  });

  test('staleReason 어댑터: 기록 밖 변경이면 확인 창 없이 실패·폐기, 비동기 복원은 기다린다', async () => {
    const { service, toast, confirm } = harness();
    const store = { color: 'red' as string | null };
    const restored: (string | null)[] = [];
    const adapter: UndoSnapshotAdapter<string | null> = {
      snapshot: () => store.color,
      restore: async (c) => {
        await Promise.resolve();
        store.color = c;
        restored.push(c);
      },
      staleReason: '색이 바뀌었습니다',
    };
    const p = service.track(GLOBAL_UNDO_SCOPE, '색', adapter);
    store.color = 'blue';
    expect(p.commit()).toBe(true);
    // 정상: 되돌림 → 다시 실행(비동기 복원 완료 뒤 토스트)
    expect(await service.undo()).toBe(true);
    expect(store.color).toBe('red');
    expect(await service.redo()).toBe(true);
    expect(store.color).toBe('blue');
    expect(restored).toEqual(['red', 'blue']);
    // 다른 창이 바꿈 → 실패·폐기(D16 확인 창 없음)
    store.color = 'green';
    expect(await service.undo()).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    expect(toast).toHaveBeenLastCalledWith(UNDO_TEXT.undoFailed('색이 바뀌었습니다'), 'error');
    expect(store.color).toBe('green');
    expect(service.hasGlobalEntries).toBe(false);
  });

  test('track 병합(1초) — 같은 key 연속 입력 = 한 항목, 처음 값으로 돌아오면 삭제', () => {
    const { service, clock } = harness();
    const store = { v: 'a' };
    const adapter: UndoSnapshotAdapter<string> = {
      snapshot: () => store.v,
      restore: (v) => {
        store.v = v;
      },
      staleReason: 'x',
    };
    const step = (v: string) => {
      const p = service.track(GLOBAL_UNDO_SCOPE, '값', adapter, { key: 'k' });
      store.v = v;
      p.commit();
    };
    step('b');
    clock.t += 200;
    step('c');
    expect(service.entries(GLOBAL_UNDO_SCOPE).past).toHaveLength(1);
    clock.t += 200;
    step('a');
    expect(service.entries(GLOBAL_UNDO_SCOPE).past).toHaveLength(0);
  });
});
