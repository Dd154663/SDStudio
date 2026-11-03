/**
 * 씬 필드·조합·씬 캐릭터·시드 그룹의 되돌리기 — 2026-11-01 U2b (SPEC_GUIDE 「되돌리기 계약」).
 *  - set 병합(1초)·원래 값 복귀 시 삭제, slots 통째 capture 깊은 복사·복원(조각 객체 공유 회귀·같은 id 객체 재사용)
 *  - 씬 캐릭터 배열·위치 drag(무변화 버림), 시드 그룹 다중 씬 1항목(역순), 씬 내용 복제 되돌림이 이미지 필드를 건드리지 않음
 *  - 편집 세션(D13) — 입력 칸을 떠날 때 1항목, 변화 없으면 없음
 *  - D16 — 기록 밖 변경과 겹치면 확인 창, 취소 = 항목 유지·재시도 시 재확인, 확인 = 복원
 */
jest.mock('..', () => ({ workFlowService: {} }));

import { InpaintScene, PromptPiece, Scene, Session } from '../types';
import { UNDO_TEXT, UndoService } from '../undoService';
import {
  captureSceneFields,
  dragSceneFields,
  editBaseCharacterOrder,
  editSceneFields,
  editScenesFields,
  editSeedGroups,
  flushSceneFieldEdit,
  hasOpenSceneFieldEdit,
  SCENE_CONTENT_COPY_KEYS,
  setSceneField,
  touchSceneFieldEdit,
} from '../sceneFieldUndo';
import type { FocusLeaveWatcher } from '../sceneFieldUndo';
import {
  createSceneSeedGroup,
  dissolveSceneSeedGroup,
  listSceneSeedGroups,
  readSceneSeedGroup,
  setSceneSeedGroupSeed,
} from '../sceneSeedGroups';

interface Harness {
  service: UndoService;
  toast: jest.Mock;
  confirm: jest.Mock<Promise<boolean>, [string, string]>;
  clock: { t: number };
}

function harness(): Harness {
  const toast = jest.fn();
  const clock = { t: 1000 };
  const confirm = jest.fn<Promise<boolean>, [string, string]>(async () => true);
  const service = new UndoService({
    curSession: () => undefined,
    isMirror: () => false,
    toast,
    now: () => clock.t,
    confirm,
  });
  return { service, toast, confirm, clock };
}

const piece = (prompt: string, id: string, extra: Partial<PromptPiece> = {}) =>
  PromptPiece.fromJSON({ prompt, characterPrompts: [], enabled: true, id, ...extra });

function makeSession(...names: string[]): { session: Session; scenes: Scene[] } {
  const session = new Session();
  session.name = 'p';
  const scenes = names.map((name) => {
    const scene = new Scene();
    scene.name = name;
    scene.slots = [[piece('a', `${name}-1`)]];
    scene.imageMap = ['old.png'];
    scene.mains = ['old.png'];
    session.addScene(scene);
    return scene;
  });
  return { session, scenes };
}

const prompts = (s: { slots: PromptPiece[][] }) => s.slots.map((col) => col.map((p) => p.prompt));

afterEach(() => {
  flushSceneFieldEdit();
});

describe('set 병합(D12) — 씬 전용 시드', () => {
  test('같은 씬·필드 1초 안 연속 = 1항목, 넘으면 새 항목, 되돌림·다시 실행', async () => {
    const { service, clock } = harness();
    const { session, scenes } = makeSession('A');
    const [a] = scenes;
    setSceneField(session, a, 'sceneSeed', 1, UNDO_TEXT.sceneSeed('A'), { service });
    clock.t += 500;
    setSceneField(session, a, 'sceneSeed', 2, UNDO_TEXT.sceneSeed('A'), { service });
    expect(service.entries(session).past).toHaveLength(1);
    clock.t += 1500;
    setSceneField(session, a, 'sceneSeed', 3, UNDO_TEXT.sceneSeed('A'), { service });
    expect(service.entries(session).past).toHaveLength(2);
    await service.undo(session);
    expect(a.sceneSeed).toBe(2);
    await service.undo(session);
    expect(a.sceneSeed).toBeUndefined();
    await service.redo(session);
    expect(a.sceneSeed).toBe(2);
  });

  test('병합 결과가 원래 값으로 돌아오면 항목을 지운다', () => {
    const { service, clock } = harness();
    const { session, scenes } = makeSession('A');
    const [a] = scenes;
    setSceneField(session, a, 'sceneSeed', 5, 'x', { service });
    clock.t += 300;
    setSceneField(session, a, 'sceneSeed', undefined, 'x', { service });
    expect(service.entries(session).past).toHaveLength(0);
    expect(a.sceneSeed).toBeUndefined();
  });

  test('세션에 등록되지 않은 씬은 대입만 하고 기록하지 않는다', () => {
    const { service } = harness();
    const { session } = makeSession('A');
    const draft = new Scene();
    draft.name = 'draft';
    setSceneField(session, draft, 'sceneSeed', 7, 'x', { service });
    expect(draft.sceneSeed).toBe(7);
    expect(service.entries(session).past).toHaveLength(0);
    expect(captureSceneFields(session, draft, ['slots'], 'x', { service }).commit()).toBe(false);
  });
});

describe('조합 slots 통째 capture', () => {
  test('깊은 복사 — 기록 뒤 조각 제자리 수정이 보관본에 섞이지 않는다(조각 객체 공유 회귀)', async () => {
    const { service } = harness();
    const { session, scenes } = makeSession('A');
    const [a] = scenes;
    editSceneFields(session, a, ['slots'], UNDO_TEXT.comboAddRow('A'), () => {
      a.slots[0].push(piece('b', 'A-2'));
    }, { service });
    expect(service.entries(session).past).toHaveLength(1);
    await service.undo(session);
    expect(prompts(a)).toEqual([['a']]);
    await service.redo(session);
    expect(prompts(a)).toEqual([['a', 'b']]);
    // 되살린 조각을 고쳐도(기록 밖 — 아래 D16 확인은 true) 보관본은 그대로
    a.slots[0][1].prompt = 'changed';
    await service.undo(session);
    expect(prompts(a)).toEqual([['a']]);
    await service.redo(session);
    expect(prompts(a)).toEqual([['a', 'b']]);
    expect(a.slots[0][1]).toBeInstanceOf(PromptPiece);
  });

  test('되살릴 때 같은 id 조각 객체를 다시 쓴다(열린 조각 편집기가 떨어진 객체에 입력하지 않게)', async () => {
    const { service } = harness();
    const { session, scenes } = makeSession('A');
    const [a] = scenes;
    const first = a.slots[0][0];
    editSceneFields(session, a, ['slots'], 'x', () => {
      first.enabled = false;
      first.name = '이름';
      a.slots.push([piece('c', 'A-c')]);
    }, { service });
    await service.undo(session);
    expect(a.slots).toHaveLength(1);
    expect(a.slots[0][0]).toBe(first);
    expect(first.enabled).toBe(true);
    expect(first.name).toBeUndefined();
    await service.redo(session);
    expect(a.slots[0][0]).toBe(first);
    expect(first.enabled).toBe(false);
    expect(first.name).toBe('이름');
    expect(prompts(a)).toEqual([['a'], ['c']]);
  });

  test('바뀌지 않았으면 기록 없음, skipIf 면 기록 없음', () => {
    const { service } = harness();
    const { session, scenes } = makeSession('A');
    const [a] = scenes;
    editSceneFields(session, a, ['slots'], 'x', () => {}, { service });
    editSceneFields(session, a, ['slots'], 'x', () => {
      a.slots[0][0].enabled = undefined; // 정규화만
    }, { service, skipIf: () => true });
    expect(service.entries(session).past).toHaveLength(0);
  });

  test('이미지 필드는 담을 수 없다', () => {
    const { service } = harness();
    const { session, scenes } = makeSession('A');
    expect(() =>
      captureSceneFields(session, scenes[0], ['imageMap' as never], 'x', { service }),
    ).toThrow();
  });

  test('일괄 삽입처럼 여러 씬 = 1항목, 바뀐 씬만, 되돌림은 역순', async () => {
    const { service } = harness();
    const { session, scenes } = makeSession('A', 'B', 'C');
    const [a, b, c] = scenes;
    editScenesFields(session, [a, b, c], ['slots'], UNDO_TEXT.comboBatchInsert(3), () => {
      a.slots[0][0].prompt = 'a, x';
      c.slots.push([piece('x', 'C-x')]);
    }, { service });
    const past = service.entries(session).past;
    expect(past).toHaveLength(1);
    expect(past[0].label).toBe(UNDO_TEXT.comboBatchInsert(3));
    await service.undo(session);
    expect(prompts(a)).toEqual([['a']]);
    expect(prompts(b)).toEqual([['a']]);
    expect(prompts(c)).toEqual([['a']]);
    await service.redo(session);
    expect(prompts(a)).toEqual([['a, x']]);
    expect(prompts(c)).toEqual([['a'], ['x']]);
  });
});

describe('씬 캐릭터 역할', () => {
  const role = (id: string, x = 0.5) => ({ id, prompt: id, uc: '', position: { x, y: 0.5 }, enabled: true });

  test('배열 capture — 추가·삭제를 되돌린다', async () => {
    const { service } = harness();
    const { session, scenes } = makeSession('A');
    const [a] = scenes;
    editSceneFields(session, a, ['sceneCharacterPrompts'], 'x', () => {
      a.sceneCharacterPrompts = [...a.sceneCharacterPrompts, role('r1')];
    }, { service });
    editSceneFields(session, a, ['sceneCharacterPrompts'], 'x', () => {
      a.sceneCharacterPrompts = [...a.sceneCharacterPrompts, role('r2')];
    }, { service });
    await service.undo(session);
    expect(a.sceneCharacterPrompts.map((c) => c.id)).toEqual(['r1']);
    await service.undo(session);
    expect(a.sceneCharacterPrompts).toEqual([]);
  });

  test('위치 drag — 누름~뗌 1항목, 제자리면 버림', async () => {
    const { service } = harness();
    const { session, scenes } = makeSession('A');
    const [a] = scenes;
    a.sceneCharacterPrompts = [role('r1')];
    const move = (x: number) => {
      a.sceneCharacterPrompts = a.sceneCharacterPrompts.map((c) => ({ ...c, position: { x, y: 0.5 } }));
    };
    const noop = dragSceneFields(session, a, ['sceneCharacterPrompts'], 'pos', { service });
    move(0.7);
    move(0.5);
    expect(noop.commit()).toBe(false);
    expect(service.entries(session).past).toHaveLength(0);
    const drag = dragSceneFields(session, a, ['sceneCharacterPrompts'], 'pos', { service });
    move(0.2);
    move(0.1);
    expect(drag.commit()).toBe(true);
    expect(service.entries(session).past).toHaveLength(1);
    await service.undo(session);
    expect(a.sceneCharacterPrompts[0].position).toEqual({ x: 0.5, y: 0.5 });
  });

  test('캐릭터 모드 두 필드 = 1항목', async () => {
    const { service } = harness();
    const { session, scenes } = makeSession('A');
    const [a] = scenes;
    editSceneFields(session, a, ['sceneCharacterPromptMode', 'useSceneCharacterPrompts'], 'm', () => {
      a.sceneCharacterPromptMode = 'scene';
      a.useSceneCharacterPrompts = true;
    }, { service });
    await service.undo(session);
    expect(a.sceneCharacterPromptMode).toBeUndefined();
    expect(a.useSceneCharacterPrompts).toBe(false);
  });

  test('기본 캐릭터 순서 — order 값만 복원(내용은 그대로)', async () => {
    const { service } = harness();
    const { session } = makeSession('A');
    const preset = {
      characterPrompts: [
        { id: 'p1', prompt: 'one', uc: '', position: { x: 0, y: 0 } },
        { id: 'p2', prompt: 'two', uc: '', position: { x: 0, y: 0 } },
      ],
    };
    const shared = { characterPrompts: [{ id: 's1', prompt: 'three', uc: '', position: { x: 0, y: 0 } }] };
    editBaseCharacterOrder(session, preset as never, shared as never, 'o', () => {
      preset.characterPrompts = preset.characterPrompts.map((c, i) => ({ ...c, order: 2 - i }));
      shared.characterPrompts = shared.characterPrompts.map((c) => ({ ...c, order: 0 }));
    }, { service });
    expect(service.entries(session).past).toHaveLength(1);
    preset.characterPrompts[0].prompt = 'one-edited'; // 내용 변경(순서 아님) — 겹침 아님
    await service.undo(session);
    expect(preset.characterPrompts.map((c) => (c as { order?: number }).order)).toEqual([undefined, undefined]);
    expect(preset.characterPrompts[0].prompt).toBe('one-edited');
  });
});

describe('시드 그룹(씬 meta 의 그룹 키만)', () => {
  test('만들기 = 다중 씬 1항목, 되돌림은 역순, 다른 meta 키는 그대로', async () => {
    const { service } = harness();
    const { session, scenes } = makeSession('A', 'B', 'C');
    const [a, b, c] = scenes;
    a.meta.set('SDImageGen', { keep: 1 });
    const group = editSeedGroups(session, UNDO_TEXT.seedGroupSet(3), () =>
      createSceneSeedGroup(session, [a, b, c]),
    { service });
    expect(group).toBeDefined();
    expect(service.entries(session).past).toHaveLength(1);
    const order: string[] = [];
    for (const s of scenes) {
      const orig = s.meta.delete.bind(s.meta);
      jest.spyOn(s.meta, 'delete').mockImplementation((k: string) => {
        order.push(s.name);
        return orig(k);
      });
    }
    await service.undo(session);
    expect(order).toEqual(['C', 'B', 'A']);
    expect(scenes.every((s) => readSceneSeedGroup(s) === undefined)).toBe(true);
    expect(a.meta.get('SDImageGen')).toEqual({ keep: 1 });
    await service.redo(session);
    expect(listSceneSeedGroups(session)).toHaveLength(1);
    expect(listSceneSeedGroups(session)[0].scenes).toHaveLength(3);
  });

  test('그룹 시드 값·해제 되돌림', async () => {
    const { service } = harness();
    const { session, scenes } = makeSession('A', 'B');
    const group = createSceneSeedGroup(session, scenes)!;
    editSeedGroups(session, 's', () => setSceneSeedGroupSeed(session, group.id, 42), { service });
    editSeedGroups(session, 'd', () => dissolveSceneSeedGroup(session, group.id), { service });
    expect(service.entries(session).past).toHaveLength(2);
    await service.undo(session);
    expect(listSceneSeedGroups(session)[0].seed).toBe(42);
    await service.undo(session);
    expect(listSceneSeedGroups(session)[0].seed).toBeUndefined();
    // 같은 값 설정 = 기록 없음
    editSeedGroups(session, 's', () => setSceneSeedGroupSeed(session, group.id, undefined), { service });
    expect(service.entries(session).past).toHaveLength(0);
  });
});

describe('시드 그룹 — 변형 씬(2026-11-03)', () => {
  const variant = (session: Session, name: string) => {
    const scene = InpaintScene.fromJSON({ type: 'inpaint', name, workflowType: 'SDI2I', imageMap: [], mains: [] } as any)!;
    session.addScene(scene);
    return scene;
  };

  test('type inpaint: 바뀐 변형 씬만 기록, 일반 씬·다른 meta 키는 그대로, 되돌림·다시 실행', async () => {
    const { service } = harness();
    const { session, scenes } = makeSession('A', 'B');
    const ng = createSceneSeedGroup(session, scenes)!;
    const [v1, v2, v3] = ['V1', 'V2', 'V3'].map((n) => variant(session, n));
    v1.meta.set('other', { keep: 1 });
    const trackSpy = jest.spyOn(service, 'track');
    const group = editSeedGroups(
      session,
      UNDO_TEXT.seedGroupSet(2),
      () => createSceneSeedGroup(session, [v1, v2]),
      { service, type: 'inpaint' },
    );
    expect(group?.label).toBe('A');
    // 변형 씬 3개만 보관(일반 씬은 추적하지 않음)
    expect(trackSpy).toHaveBeenCalledTimes(3);
    expect(service.entries(session).past).toHaveLength(1);
    await service.undo(session);
    expect([v1, v2, v3].every((s) => readSceneSeedGroup(s) === undefined)).toBe(true);
    expect(v1.meta.get('other')).toEqual({ keep: 1 });
    expect(listSceneSeedGroups(session)[0].id).toBe(ng.id);
    await service.redo(session);
    expect(listSceneSeedGroups(session, 'inpaint')[0].scenes).toEqual([v1, v2]);
    // 그룹 시드 값 — 같은 값이면 기록 없음
    const vg = listSceneSeedGroups(session, 'inpaint')[0];
    editSeedGroups(session, 's', () => setSceneSeedGroupSeed(session, vg.id, 7, 'inpaint'), { service, type: 'inpaint' });
    expect(service.entries(session).past).toHaveLength(2);
    editSeedGroups(session, 's', () => setSceneSeedGroupSeed(session, vg.id, 7, 'inpaint'), { service, type: 'inpaint' });
    expect(service.entries(session).past).toHaveLength(2);
    await service.undo(session);
    expect(listSceneSeedGroups(session, 'inpaint')[0].seed).toBeUndefined();
  });
});

describe('씬 내용 복제(덮어쓰기) — 이미지 필드 제외', () => {
  test('★ 복제 뒤 생성 결과로 새 이미지가 생긴 상태에서 되돌림 → 내용만 복원, 새 이미지 유지', async () => {
    const { service } = harness();
    const { session, scenes } = makeSession('SRC', 'T');
    const [src, t] = scenes;
    src.slots = [[piece('src prompt', 'S-1')]];
    src.sceneCharacterUC = 'src uc';
    t.sceneCharacterUC = 't uc';
    t.round = { players: ['old.png'], winMask: [false], curPlayer: 0 };
    t.game = [{ rank: 1, path: 'old.png' }];
    const srcJSON = src.toJSON();
    editScenesFields(session, [t], SCENE_CONTENT_COPY_KEYS.scene, UNDO_TEXT.sceneContentCopy('SRC', 1), () => {
      t.slots = srcJSON.slots.map((slot) => slot.map((p) => PromptPiece.fromJSON(p)));
      t.meta = new Map(Object.entries(srcJSON.meta ?? {}));
      t.sceneCharacterUC = srcJSON.sceneCharacterUC || '';
    }, { service });
    // 생성이 이미지를 추가(기록 밖 — 이미지 필드는 담지 않았으므로 겹침도 아님)
    t.imageMap = [...t.imageMap, 'new.png'];
    t.mains = [...t.mains, 'new.png'];
    await service.undo(session);
    expect(prompts(t)).toEqual([['a']]);
    expect(t.sceneCharacterUC).toBe('t uc');
    expect(t.imageMap).toEqual(['old.png', 'new.png']);
    expect(t.mains).toEqual(['old.png', 'new.png']);
    expect(t.round).toEqual({ players: ['old.png'], winMask: [false], curPlayer: 0 });
    expect(t.game).toEqual([{ rank: 1, path: 'old.png' }]);
    await service.redo(session);
    expect(prompts(t)).toEqual([['src prompt']]);
    expect(t.imageMap).toEqual(['old.png', 'new.png']);
  });

  test('변형 씬 키에도 이미지 필드가 없다', () => {
    for (const keys of Object.values(SCENE_CONTENT_COPY_KEYS)) {
      for (const k of ['imageMap', 'mains', 'game', 'round', 'imageAccounts']) {
        expect(keys).not.toContain(k);
      }
    }
    const inpaint = new InpaintScene();
    expect(inpaint.type).toBe('inpaint');
  });

  test('변형 씬 복제는 meta(시드 그룹 소속)도 담고 되돌린다(2026-11-03)', async () => {
    const { service } = harness();
    const session = new Session();
    session.name = 'p';
    const mk = (name: string) => {
      const scene = InpaintScene.fromJSON({ type: 'inpaint', name, workflowType: 'SDI2I', imageMap: [], mains: [] } as any)!;
      session.addScene(scene);
      return scene;
    };
    const [src, other, t] = [mk('SRC'), mk('O'), mk('T')];
    expect(SCENE_CONTENT_COPY_KEYS.inpaint).toContain('meta');
    createSceneSeedGroup(session, [src, other]);
    const srcJSON = src.toJSON();
    editScenesFields(session, [t], SCENE_CONTENT_COPY_KEYS.inpaint, UNDO_TEXT.sceneContentCopy('SRC', 1), () => {
      t.meta = new Map(Object.entries(srcJSON.meta ?? {}));
    }, { service });
    expect(readSceneSeedGroup(t)?.id).toBe(readSceneSeedGroup(src)?.id);
    await service.undo(session);
    expect(readSceneSeedGroup(t)).toBeUndefined();
    expect(typeof t.meta.get).toBe('function');
    await service.redo(session);
    expect(listSceneSeedGroups(session, 'inpaint')[0].scenes).toHaveLength(3);
  });
});

describe('편집 세션(D13) — 입력 칸을 떠날 때 1항목', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));

  test('실제 입력 칸: 포커스 동안 여러 번 바뀌어도 blur 때 1항목, 같은 칸 다시 입력은 새 세션', async () => {
    const { service } = harness();
    const { session, scenes } = makeSession('A');
    const [a] = scenes;
    const ta = document.createElement('textarea');
    const other = document.createElement('input');
    document.body.append(ta, other);
    ta.focus();
    const type = (text: string) => {
      if (a.slots[0][0].prompt === text) return;
      touchSceneFieldEdit(session, a, ['slots'], UNDO_TEXT.sceneMiddlePrompt('A'), { service });
      a.slots[0][0].prompt = text;
    };
    type('a,');
    type('a, b');
    type('a, b, c');
    expect(service.entries(session).past).toHaveLength(0);
    other.focus();
    await tick();
    expect(service.entries(session).past).toHaveLength(1);
    expect(hasOpenSceneFieldEdit()).toBe(false);
    await service.undo(session);
    expect(a.slots[0][0].prompt).toBe('a');
    ta.remove();
    other.remove();
  });

  test('바뀌지 않았으면 기록 없음(입력 뒤 원래대로 지움)', async () => {
    const { service } = harness();
    const { session, scenes } = makeSession('A');
    const [a] = scenes;
    let leave: () => void = () => {};
    const watch: FocusLeaveWatcher = (onLeave) => {
      leave = onLeave;
      return () => {};
    };
    touchSceneFieldEdit(session, a, ['sceneUC'], 'uc', { service, watch });
    a.sceneUC = 'x';
    a.sceneUC = '';
    leave();
    expect(service.entries(session).past).toHaveLength(0);
  });

  test('편집 중 되돌리기 실행·다른 기록·창 닫힘(flush)은 열린 세션을 먼저 확정한다', async () => {
    const { service } = harness();
    const { session, scenes } = makeSession('A');
    const [a] = scenes;
    const watch: FocusLeaveWatcher = () => () => {};
    touchSceneFieldEdit(session, a, ['sceneUC'], 'uc', { service, watch });
    a.sceneUC = 'typed';
    // 다른 기록 직전에 확정 → 순서 = [uc, seed]
    setSceneField(session, a, 'sceneSeed', 9, 'seed', { service });
    expect(service.entries(session).past.map((e) => e.label)).toEqual(['uc', 'seed']);
    // 새 세션 → 되돌리기 실행 직전에 확정되어 그것이 되돌려진다
    touchSceneFieldEdit(session, a, ['sceneUC'], 'uc', { service, watch });
    a.sceneUC = 'typed more';
    expect(await service.undo(session)).toBe(true);
    expect(a.sceneUC).toBe('typed');
    // 같은 칸 다시 입력 = 새 세션(앞 세션은 이미 확정됨)
    touchSceneFieldEdit(session, a, ['sceneUC'], 'uc', { service, watch });
    a.sceneUC = 'again';
    expect(flushSceneFieldEdit()).toBe(true);
    expect(service.entries(session).past.map((e) => e.label)).toEqual(['uc', 'seed', 'uc']);
  });
});

describe('D16 — 기록 밖 변경과 겹칠 때 확인 창', () => {
  test('취소 = 항목 유지(상태 그대로), 다시 누르면 다시 묻고, 확인 = 복원', async () => {
    const { service, confirm } = harness();
    const { session, scenes } = makeSession('A');
    const [a] = scenes;
    editSceneFields(session, a, ['slots'], UNDO_TEXT.comboAddColumn('A'), () => {
      a.slots.push([piece('b', 'A-b')]);
    }, { service });
    // 기록 밖 경로(찾기/바꾸기 등)로 같은 필드가 또 바뀜
    a.slots[1][0].prompt = 'replaced';
    confirm.mockResolvedValueOnce(false);
    expect(await service.undo(session)).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toBe(UNDO_TEXT.conflictUndo(UNDO_TEXT.comboAddColumn('A')));
    expect(prompts(a)).toEqual([['a'], ['replaced']]);
    expect(service.entries(session).past).toHaveLength(1);
    confirm.mockResolvedValueOnce(true);
    expect(await service.undo(session)).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(prompts(a)).toEqual([['a']]);
  });

  test('겹치지 않으면 묻지 않는다, 다시 실행도 같은 규칙(지금이 이전 값과 다르면 묻는다)', async () => {
    const { service, confirm } = harness();
    const { session, scenes } = makeSession('A');
    const [a] = scenes;
    editSceneFields(session, a, ['sceneCharacterUC'], 'uc', () => {
      a.sceneCharacterUC = 'x';
    }, { service });
    await service.undo(session);
    expect(confirm).not.toHaveBeenCalled();
    a.sceneCharacterUC = 'outside';
    confirm.mockResolvedValueOnce(false);
    expect(await service.redo(session)).toBe(false);
    expect(confirm.mock.calls[0][0]).toBe(UNDO_TEXT.conflictRedo('uc'));
    expect(a.sceneCharacterUC).toBe('outside');
    expect(service.entries(session).future).toHaveLength(1);
  });

  test('묶음은 하위 항목이 하나라도 겹치면 한 번만 묻는다', async () => {
    const { service, confirm } = harness();
    const { session, scenes } = makeSession('A', 'B');
    const [a, b] = scenes;
    editScenesFields(session, [a, b], ['resolution'], UNDO_TEXT.scenesResolution(2), () => {
      a.resolution = 'landscape';
      b.resolution = 'landscape';
    }, { service });
    a.resolution = 'square';
    b.resolution = 'square';
    expect(await service.undo(session)).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(a.resolution).toBe('');
    expect(b.resolution).toBe('');
  });

  test('씬이 그사이 프로젝트에서 빠졌으면 실행하지 않고 그 항목만 버린다', async () => {
    const { service, toast } = harness();
    const { session, scenes } = makeSession('A');
    const [a] = scenes;
    editSceneFields(session, a, ['sceneUC'], 'uc', () => {
      a.sceneUC = 'x';
    }, { service });
    session.scenes.delete('A');
    expect(await service.undo(session)).toBe(false);
    expect(toast).toHaveBeenCalledWith(UNDO_TEXT.undoFailed(UNDO_TEXT.sceneGone('A')), 'error');
    expect(service.entries(session).past).toHaveLength(0);
  });
});
