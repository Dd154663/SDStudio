/**
 * 찾기/바꾸기 「모두 변환」의 되돌리기 — 2026-11-03 2차 P3 (SPEC_GUIDE 「되돌리기 계약」, 사용자 결정 D4).
 *  - 프로젝트 범위(씬 조합 slots·씬 캐릭터·변형 씬 slots/프리셋·로컬 캐릭터 프리셋·씬 이름)를 한 번의 변환 = 1항목으로
 *    되돌림·다시 실행(씬 이름은 recordSceneRename 짝 — 되돌림 역순)
 *  - 글로벌 프리셋·프로젝트 이름은 기록하지 않음 + 실제로 바뀐 경우에만 안내 범위로 돌려줌
 *  - 바뀐 것이 없으면 항목 없음, 건너뜀(false)·예외는 세지 않고 기록도 없음
 * 결과 항목은 FindReplaceDialog.collectResults 와 같은 모양(setText 가 대상에 직접 대입)으로 만든다.
 */
jest.mock('..', () => ({ workFlowService: {} }));

import { CharacterPreset, InpaintScene, PromptPiece, Scene, Session } from '../types';
import { UNDO_TEXT, UndoService } from '../undoService';
import { flushSceneFieldEdit } from '../sceneFieldUndo';
import type { SceneStructureOps } from '../sceneStructureUndo';
import {
  FIND_REPLACE_UNRECORDED_LABEL,
  replaceAllRecorded,
  unrecordedScopesOf,
} from '../findReplaceUndo';
import type { FindReplaceItem } from '../findReplaceUndo';

function harness() {
  const toast = jest.fn();
  const confirm = jest.fn<Promise<boolean>, [string, string]>(async () => true);
  const mirror = { on: false };
  const service = new UndoService({
    curSession: () => undefined,
    isMirror: () => mirror.on,
    toast,
    now: () => 1000,
    confirm,
  });
  return { service, toast, confirm, mirror };
}

const piece = (prompt: string, id: string, characterPrompts: string[] = []) =>
  PromptPiece.fromJSON({ prompt, characterPrompts, enabled: true, id });

function fakeOps(): SceneStructureOps {
  return {
    moveSceneToTrash: jest.fn(async () => undefined),
    restoreScene: jest.fn(async () => undefined),
    renameScene: jest.fn(async (session: Session, from: string, to: string) => {
      const s = session.scenes.get(from)!;
      s.name = to;
      const rebuilt = new Map();
      for (const [k, v] of session.scenes) rebuilt.set(k === from ? to : k, v);
      session.scenes = rebuilt as any;
    }),
    renameInpaintScene: jest.fn(async () => true),
    getSceneBookmark: () => undefined,
    setSceneBookmark: jest.fn(async () => {}),
  };
}

interface World {
  session: Session;
  a: Scene;
  b: Scene;
  v: InpaintScene;
  k: CharacterPreset;
  globalPreset: { frontPrompt: string };
}

function makeWorld(): World {
  const session = new Session();
  session.name = 'proj cat';
  const a = new Scene();
  a.name = 'A cat';
  a.slots = [[piece('cat, 1girl', 'a1', ['cat ears'])]];
  a.sceneCharacterPrompts = [{ prompt: 'cat girl', uc: 'cat tail', position: undefined } as any];
  a.sceneCharacterUC = 'no cat';
  a.imageMap = ['old.png'];
  a.mains = ['old.png'];
  session.addScene(a);
  const b = new Scene();
  b.name = 'B';
  b.slots = [[piece('dog', 'b1')]];
  session.addScene(b);
  const v = new InpaintScene();
  v.name = 'V';
  v.workflowType = 'SDI2I';
  v.preset = { prompt: 'cat mid', frontPrompt: 'cat front', backPrompt: 'back' } as any;
  v.slots = [];
  v.imageMap = ['vold.png'];
  session.addScene(v);
  const k = new CharacterPreset();
  k.name = 'K';
  k.characterPrompt = 'cat preset';
  k.backgroundPrompt = 'room';
  session.addCharacterPreset(k);
  return { session, a, b, v, k, globalPreset: { frontPrompt: 'global cat' } };
}

/** collectResults 와 같은 모양의 결과(검색어 q 를 포함하는 것만) */
function collect(w: World, q: string, opts: { project?: { name: string } } = {}): FindReplaceItem[] {
  const out: FindReplaceItem[] = [];
  for (const scene of w.session.scenes.values()) {
    scene.slots.forEach((slot) =>
      slot.forEach((p) => {
        if (p.prompt.includes(q))
          out.push({ location: 's', getText: () => p.prompt, setText: (x) => { p.prompt = x; }, target: { kind: 'sceneSlots', scene } });
        p.characterPrompts.forEach((cp, ci) => {
          if (cp.includes(q))
            out.push({
              location: 'sc',
              getText: () => p.characterPrompts[ci],
              setText: (x) => { p.characterPrompts[ci] = x; },
              target: { kind: 'sceneSlots', scene },
            });
        });
      }),
    );
  }
  const vp = w.v.preset as any;
  for (const key of ['prompt', 'frontPrompt']) {
    if (vp[key].includes(q))
      out.push({ location: 'v', getText: () => vp[key], setText: (x) => { vp[key] = x; }, target: { kind: 'variant', scene: w.v } });
  }
  for (const scene of w.session.scenes.values()) {
    (scene.sceneCharacterPrompts ?? []).forEach((cp: any) => {
      if (cp.prompt.includes(q))
        out.push({ location: 'c', getText: () => cp.prompt, setText: (x) => { cp.prompt = x; }, target: { kind: 'sceneCharacter', scene } });
      if (cp.uc && cp.uc.includes(q))
        out.push({ location: 'cu', getText: () => cp.uc, setText: (x) => { cp.uc = x; }, target: { kind: 'sceneCharacter', scene } });
    });
    if (scene.sceneCharacterUC && scene.sceneCharacterUC.includes(q))
      out.push({
        location: 'cuc',
        getText: () => scene.sceneCharacterUC,
        setText: (x) => { scene.sceneCharacterUC = x; },
        target: { kind: 'sceneCharacter', scene },
      });
  }
  if (w.k.characterPrompt.includes(q))
    out.push({ location: 'k', getText: () => w.k.characterPrompt, setText: (x) => { w.k.characterPrompt = x; }, target: { kind: 'characterPreset' } });
  if (w.globalPreset.frontPrompt.includes(q))
    out.push({
      location: 'g',
      getText: () => w.globalPreset.frontPrompt,
      setText: (x) => { w.globalPreset.frontPrompt = x; },
      target: { kind: 'global' },
    });
  for (const scene of [...w.session.scenes.values()]) {
    const name = scene.name;
    if (!name.includes(q)) continue;
    out.push({
      location: 'n',
      getText: () => name,
      setText: async () => false, // 테스트마다 덮어씀
      target: { kind: 'sceneName', scene },
    });
  }
  if (opts.project && opts.project.name.includes(q)) {
    const proj = opts.project;
    out.push({
      location: 'p',
      getText: () => proj.name,
      setText: async (x) => {
        // 실제 renameProject 처럼 세션 인스턴스를 그대로 두고 이름만 바꾼다
        w.session.name = x;
        proj.name = x;
        return true;
      },
      target: { kind: 'projectName' },
    });
  }
  return out;
}

/** 씬 이름 결과의 setText 를 실제 이름 변경(ops.renameScene)으로 */
function wireSceneNames(items: FindReplaceItem[], session: Session, ops: SceneStructureOps) {
  for (const it of items) {
    if (it.target.kind !== 'sceneName') continue;
    const from = it.getText();
    it.setText = async (x) => {
      const nm = x.trim();
      if (!nm || nm === from || session.scenes.has(nm)) return false;
      await ops.renameScene(session, from, nm);
      return session.scenes.has(nm);
    };
  }
}

const state = (w: World) => ({
  a: w.a.slots.map((c) => c.map((p) => [p.prompt, ...p.characterPrompts])),
  ac: w.a.sceneCharacterPrompts.map((c: any) => [c.prompt, c.uc]),
  auc: w.a.sceneCharacterUC,
  b: w.b.slots.map((c) => c.map((p) => p.prompt)),
  v: [(w.v.preset as any).prompt, (w.v.preset as any).frontPrompt, (w.v.preset as any).backPrompt],
  k: w.session.characterPresets.get('K')?.characterPrompt,
  names: [...w.session.scenes.keys()],
});

afterEach(() => {
  flushSceneFieldEdit();
});

describe('「모두 변환」 = 되돌리기 1항목(프로젝트 범위)', () => {
  test('씬 slots·씬 캐릭터·변형 preset·캐릭터 프리셋·씬 이름 → 1항목, 되돌림·다시 실행', async () => {
    const { service, toast } = harness();
    const w = makeWorld();
    const ops = fakeOps();
    const before = state(w);
    const items = collect(w, 'cat');
    wireSceneNames(items, w.session, ops);
    const out = await replaceAllRecorded(w.session, items, 'cat', 'dog', { service, structureOps: ops });
    const after = state(w);
    expect(after).toEqual({
      a: [[['dog, 1girl', 'dog ears']]],
      ac: [['dog girl', 'dog tail']],
      auc: 'no dog',
      b: [['dog']],
      v: ['dog mid', 'dog front', 'back'],
      k: 'dog preset',
      names: ['A dog', 'B'],
    });
    expect(out.notUndone).toEqual([FIND_REPLACE_UNRECORDED_LABEL.global]); // 글로벌만 기록 밖으로 바뀜
    expect(out.recorded).toBe(true);
    expect(out.skipped).toBe(0);
    // 글로벌 1건을 뺀 프로젝트 범위 변환 수가 라벨에 들어간다
    const n = out.replaced - 1;
    expect(service.entries(w.session).past.map((e) => e.label)).toEqual([UNDO_TEXT.findReplaceAll('cat', 'dog', n)]);

    expect(await service.undo(w.session)).toBe(true);
    expect(state(w)).toEqual(before);
    expect(w.globalPreset.frontPrompt).toBe('global dog'); // 글로벌은 그대로(기록 밖)
    // 씬 이름이 먼저 되돌아간다(역순) — 내용 항목은 같은 씬 객체를 손잡이로 따라간다
    expect(ops.renameScene).toHaveBeenLastCalledWith(w.session, 'A dog', 'A cat');
    expect(w.session.scenes.get('A cat')).toBe(w.a);
    expect(w.a.imageMap).toEqual(['old.png']); // 이미지 필드 불변

    expect(await service.redo(w.session)).toBe(true);
    expect(state(w)).toEqual(after);
    expect(toast).toHaveBeenLastCalledWith(UNDO_TEXT.redone(UNDO_TEXT.findReplaceAll('cat', 'dog', n)), 'info');
  });

  test('되돌림 뒤 다른 프로젝트 범위 값이 그대로 — 바뀐 대상만 하위 항목(안 바뀐 씬 B 는 기록 없음)', async () => {
    const { service, confirm } = harness();
    const w = makeWorld();
    const items = collect(w, 'cat').filter((i) => i.target.kind === 'sceneSlots');
    await replaceAllRecorded(w.session, items, 'cat', 'fox', { service });
    const past = service.entries(w.session).past;
    expect(past).toHaveLength(1);
    // B 는 결과에 없고 바뀌지도 않았다 — 기록 밖에서 B 를 바꿔도 되돌림이 확인 창 없이 지나간다
    w.b.slots[0][0].prompt = 'edited';
    expect(await service.undo(w.session)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(w.a.slots[0][0].prompt).toBe('cat, 1girl');
    expect(w.b.slots[0][0].prompt).toBe('edited');
  });

  test('글로벌 프리셋·프로젝트 이름만 바뀌면 항목 없음 + 둘 다 안내, 세션 인스턴스·스택 유지', async () => {
    const { service } = harness();
    const w = makeWorld();
    // 이전 기록 하나(프로젝트 이름 변경 뒤에도 남아야 한다)
    await replaceAllRecorded(w.session, collect(w, '1girl'), '1girl', '2girls', { service });
    expect(service.entries(w.session).past).toHaveLength(1);
    const project = { name: w.session.name };
    const items = collect(w, 'cat', { project }).filter((i) => i.target.kind === 'global' || i.target.kind === 'projectName');
    const out = await replaceAllRecorded(w.session, items, 'cat', 'dog', { service });
    expect(out.recorded).toBe(false);
    expect(out.replaced).toBe(2);
    expect(out.notUndone).toEqual([FIND_REPLACE_UNRECORDED_LABEL.global, FIND_REPLACE_UNRECORDED_LABEL.projectName]);
    expect(UNDO_TEXT.findReplaceNotUndone(out.notUndone)).toBe('글로벌 프리셋·글로벌 캐릭터 프리셋·프로젝트 이름 변경은 되돌리기 대상이 아닙니다');
    expect(w.session.name).toBe('proj dog');
    expect(service.entries(w.session).past).toHaveLength(1); // 이전 기록 유지·새 항목 없음
  });

  test('프로젝트 이름은 묶음 밖(묶음이 먼저 닫힘) — 내용과 함께여도 1항목, 프로젝트 이름은 되돌리지 않음', async () => {
    const { service } = harness();
    const w = makeWorld();
    const project = { name: w.session.name };
    const items = collect(w, 'cat', { project }).filter((i) => i.target.kind !== 'sceneName');
    const out = await replaceAllRecorded(w.session, items, 'cat', 'dog', { service });
    expect(out.notUndone).toEqual([FIND_REPLACE_UNRECORDED_LABEL.global, FIND_REPLACE_UNRECORDED_LABEL.projectName]);
    expect(service.entries(w.session).past).toHaveLength(1);
    await service.undo(w.session);
    expect(w.a.slots[0][0].prompt).toBe('cat, 1girl');
    expect(w.session.name).toBe('proj dog');
  });

  test('바뀐 것이 없으면 항목 없음 — 같은 글자·건너뜀(false)·예외', async () => {
    const { service } = harness();
    const w = makeWorld();
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const items: FindReplaceItem[] = [
      { location: 'same', getText: () => 'cat', setText: jest.fn(), target: { kind: 'sceneSlots', scene: w.a } },
      { location: 'skip', getText: () => 'A cat', setText: async () => false, target: { kind: 'sceneName', scene: w.a } },
      {
        location: 'throw',
        getText: () => 'cat',
        setText: () => {
          throw new Error('x');
        },
        target: { kind: 'sceneSlots', scene: w.a },
      },
    ];
    const out = await replaceAllRecorded(w.session, items, 'cat', 'cat', { service });
    expect(out).toEqual({ replaced: 0, skipped: 0, notUndone: [], recorded: false });
    const out2 = await replaceAllRecorded(w.session, items.slice(1), 'cat', 'dog', { service });
    expect(out2.skipped).toBe(2);
    expect(out2.recorded).toBe(false);
    expect(service.entries(w.session).past).toHaveLength(0);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  test('미러(읽기 전용)면 변환은 하고 기록은 없음', async () => {
    const { service, mirror } = harness();
    mirror.on = true;
    const w = makeWorld();
    const out = await replaceAllRecorded(w.session, collect(w, 'cat'), 'cat', 'dog', { service });
    expect(out.recorded).toBe(false);
    expect(w.a.slots[0][0].prompt).toBe('dog, 1girl');
    expect(service.entries(w.session).past).toHaveLength(0);
  });

  test('되돌림 전에 씬이 빠졌으면 그 하위 항목만 실패(D15) — 나머지는 되돌아감', async () => {
    const { service, toast } = harness();
    const w = makeWorld();
    const items = collect(w, 'cat').filter((i) => i.target.kind === 'sceneSlots' || i.target.kind === 'characterPreset');
    await replaceAllRecorded(w.session, items, 'cat', 'dog', { service });
    w.session.scenes.delete('A cat');
    expect(await service.undo(w.session)).toBe(true);
    expect(w.session.characterPresets.get('K')!.characterPrompt).toBe('cat preset');
    expect(toast.mock.calls[toast.mock.calls.length - 1][1]).toBe('error'); // 부분 실패 안내
  });
});

describe('확인 창 문구(A11 — Enter·버튼 공용)', () => {
  test('기록 밖 범위가 결과에 있을 때만 「되돌릴 수 없습니다」', () => {
    const w = makeWorld();
    const project = { name: w.session.name };
    const all = collect(w, 'cat', { project });
    expect(unrecordedScopesOf(all)).toEqual(['글로벌 프리셋·글로벌 캐릭터 프리셋', '프로젝트 이름']);
    expect(UNDO_TEXT.findReplaceConfirm(3, 'cat', '', unrecordedScopesOf(all))).toBe(
      '3개 항목을 변환합니다.\n「cat」 → 「」 (삭제)\n글로벌 프리셋·글로벌 캐릭터 프리셋·프로젝트 이름 변경은 되돌릴 수 없습니다.',
    );
    const projectOnly = all.filter((i) => i.target.kind === 'sceneSlots');
    expect(UNDO_TEXT.findReplaceConfirm(1, 'cat', 'dog', unrecordedScopesOf(projectOnly))).toBe(
      '1개 항목을 변환합니다.\n「cat」 → 「dog」',
    );
  });
});
