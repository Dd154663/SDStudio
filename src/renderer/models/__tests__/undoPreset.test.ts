/**
 * 사전 세팅(그림체)·공용 설정·바이브·레퍼런스·로컬 캐릭터 프리셋의 되돌리기 — 2026-11-02 U3b (SPEC_GUIDE 「되돌리기 계약」).
 *  - setField 집약(setWorkflowField): 샘플링 필드 + 프로필 동시 보관·복원, 1초 병합·원래 값 복귀 시 삭제, 슬라이더 누름~뗌 1항목,
 *    글자 입력 편집 세션 1항목, 범위 밖(변형 씬 프리셋·씬 메타·다른 프로젝트 공용 설정)은 대입만
 *  - 그림체 목록 차분: 추가(+선택)·삭제(같은 객체 원래 자리·선택 복원)·순서·복제·불러오기(비동기)·이름 충돌 실패·기록 밖 그림체 유지
 *  - 이름 변경(선택 이름 함께)·선택(1초 병합)
 *  - 바이브·레퍼런스 배열 깊은 복사·복원(같은 경로 객체 재사용), 항목 값 병합·슬라이더
 *  - 로컬 캐릭터 프리셋: 추가·삭제(적용 해제 포함 1항목)·순서·적용, 비동기 기록, D16
 *  - F2: 캐릭터 프리셋 이름 변경 시 적용 항목의 fromPreset·_appliedPresetName 갱신
 *  - track(merge) 일반 동작(라벨 갱신·원래 값 복귀 시 삭제)
 * (렌더 중 자동 보정이 기록되지 않음은 undoPresetEditorRender.test.tsx)
 */
jest.mock('..', () => ({ workFlowService: {} }));

import { WFWorkFlow } from '../workflows/WorkFlow';
import { SDImageGenDef, SDImageGenEasyDef, SDInpaintDef } from '../workflows/SDWorkFlow';
import { CharacterPreset, ReferenceItem, Session, VibeItem } from '../types';
import { UNDO_TEXT, UndoService } from '../undoService';
import { flushSceneFieldEdit } from '../sceneFieldUndo';
import type { FocusLeaveWatcher } from '../sceneFieldUndo';
import {
  beginCharacterPresetRecord,
  beginPresetListRecord,
  beginWorkflowSlide,
  editCharacterPresets,
  editPresetList,
  editWorkflowFields,
  renamePresetRecorded,
  resetPresetUndoState,
  selectWorkflowRecorded,
  setExtraPromptRecorded,
  setNewSceneResolutionRecorded,
  setWorkflowField,
  setWorkflowItemValue,
} from '../presetUndo';

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

const sdWf = new WFWorkFlow(SDImageGenDef);
const easyWf = new WFWorkFlow(SDImageGenEasyDef);

function makePreset(name: string, wf = sdWf) {
  const p = wf.buildPreset();
  p.name = name;
  return p;
}

function makeSession(...names: string[]) {
  const session = new Session();
  session.name = 'p';
  const presets = names.map((n) => makePreset(n));
  session.presets.set('SDImageGen', presets);
  const shared = sdWf.buildShared();
  session.presetShareds.set('SDImageGen', shared);
  session.selectedWorkflow = { workflowType: 'SDImageGen', presetName: names[0] };
  return { session, presets: session.presets.get('SDImageGen')!, shared };
}

const list = (s: Session, type = 'SDImageGen') => (s.presets.get(type) ?? []).map((p: any) => p.name);

/** 편집 세션 확정 시점을 테스트가 정한다 */
function manualWatch(): { watch: FocusLeaveWatcher; leave: () => void } {
  let fn: (() => void) | undefined;
  return {
    watch: (onLeave) => {
      fn = onLeave;
      return () => {
        fn = undefined;
      };
    },
    leave: () => fn?.(),
  };
}

afterEach(() => {
  flushSceneFieldEdit();
  resetPresetUndoState();
});

describe('setField 집약(setWorkflowField)', () => {
  test('샘플링 필드 = 필드 + 샘플링 프로필 동시 보관·복원(다시 실행 포함)', async () => {
    const { service } = harness();
    const { session, presets } = makeSession('A');
    const a = presets[0];
    const stepsBefore = a.steps;
    expect(a.samplingProfiles).toBeUndefined();
    setWorkflowField(session, { preset: a }, 'preset', 'steps', 40, { label: 'x', family: 'v5', service });
    expect(a.steps).toBe(40);
    expect(a.samplingProfiles.v5.steps).toBe(40);
    expect(a.samplingProfileFamily).toBe('v5');
    expect(service.entries(session).past).toHaveLength(1);
    await service.undo(session);
    expect(a.steps).toBe(stepsBefore);
    expect(a.samplingProfiles).toBeUndefined();
    expect(a.samplingProfileFamily).toBeUndefined();
    await service.redo(session);
    expect(a.steps).toBe(40);
    expect(a.samplingProfiles.v5.steps).toBe(40);
  });

  test('같은 칸 1초 안 연속 = 1항목(라벨은 마지막), 넘으면 새 항목, 원래 값으로 돌아오면 항목 삭제', async () => {
    const { service, clock } = harness();
    const { session, presets } = makeSession('A');
    const a = presets[0];
    const s0 = a.sampling;
    setWorkflowField(session, { preset: a }, 'preset', 'sampling', 'k_euler', { label: 'L1', service });
    clock.t += 500;
    setWorkflowField(session, { preset: a }, 'preset', 'sampling', 'k_dpmpp_2m', { label: 'L2', service });
    expect(service.entries(session).past).toHaveLength(1);
    expect(service.entries(session).past[0].label).toBe('L2');
    clock.t += 1500;
    setWorkflowField(session, { preset: a }, 'preset', 'sampling', 'k_euler_ancestral', { label: 'L3', service });
    expect(service.entries(session).past).toHaveLength(2);
    await service.undo(session);
    expect(a.sampling).toBe('k_dpmpp_2m');
    await service.undo(session);
    expect(a.sampling).toBe(s0);
    // 병합 중 원래 값 복귀
    clock.t += 5000;
    setWorkflowField(session, { preset: a }, 'preset', 'sampling', 'k_euler', { label: 'x', service });
    clock.t += 200;
    setWorkflowField(session, { preset: a }, 'preset', 'sampling', s0, { label: 'x', service });
    expect(service.entries(session).past).toHaveLength(0);
  });

  test('슬라이더: 누름~뗌 동안 여러 번 바뀌어도 1항목(놓기 전에는 기록 없음)', async () => {
    const { service } = harness();
    const { session, presets } = makeSession('A');
    const a = presets[0];
    const before = a.cfgRescale;
    const slide = beginWorkflowSlide(session, { preset: a }, [['preset', 'cfgRescale']], 'cfg', { service });
    for (const v of [0.1, 0.2, 0.3]) {
      setWorkflowField(session, { preset: a }, 'preset', 'cfgRescale', v, { label: 'cfg', family: 'v4_5', service });
    }
    expect(service.entries(session).past).toHaveLength(0);
    expect(slide.commit()).toBe(true);
    expect(service.entries(session).past).toHaveLength(1);
    await service.undo(session);
    expect(a.cfgRescale).toBe(before);
    await service.redo(session);
    expect(a.cfgRescale).toBe(0.3);
  });

  test('글자 입력 = 편집 세션(떠날 때 1항목), 공용 설정 시드 포함', async () => {
    const { service } = harness();
    const { session, presets, shared } = makeSession('A');
    const a = presets[0];
    const w = manualWatch();
    const front0 = a.frontPrompt;
    for (const v of ['a', 'ab', 'abc']) {
      setWorkflowField(session, { preset: a }, 'preset', 'frontPrompt', v, { label: 'f', mode: 'edit', service, watch: w.watch });
    }
    expect(service.entries(session).past).toHaveLength(0);
    w.leave();
    expect(service.entries(session).past).toHaveLength(1);
    setWorkflowField(session, { shared }, 'shared', 'seed', 12, { label: 's', mode: 'edit', service, watch: w.watch });
    setWorkflowField(session, { shared }, 'shared', 'seed', 123, { label: 's', mode: 'edit', service, watch: w.watch });
    w.leave();
    expect(service.entries(session).past).toHaveLength(2);
    await service.undo(session);
    expect(shared.seed).not.toBe(123);
    await service.undo(session);
    expect(a.frontPrompt).toBe(front0);
  });

  test('범위 밖 — 변형 씬 프리셋·씬 메타·다른 프로젝트의 공용 설정은 대입만, 값이 같으면 기록 없음', () => {
    const { service } = harness();
    const { session, presets } = makeSession('A');
    const variant = new WFWorkFlow(SDInpaintDef).buildPreset();
    setWorkflowField(session, { preset: variant }, 'preset', 'strength', 0.3, { label: 'x', service });
    expect(variant.strength).toBe(0.3);
    const meta: any = { emotion: 'a' };
    setWorkflowField(session, { meta }, 'meta', 'emotion', 'b', { label: 'x', service });
    expect(meta.emotion).toBe('b');
    const other = sdWf.buildShared();
    setWorkflowField(session, { shared: other }, 'shared', 'seed', 5, { label: 'x', service });
    expect(other.seed).toBe(5);
    setWorkflowField(session, { preset: presets[0] }, 'preset', 'frontPrompt', presets[0].frontPrompt, { label: 'x', service });
    expect(service.entries(session).past).toHaveLength(0);
  });

  test('그림체가 그사이 지워지면 그 항목만 실패·폐기(되돌릴 수 없습니다 토스트)', async () => {
    const { service, toast } = harness();
    const { session, presets } = makeSession('A', 'B');
    const b = presets[1];
    setWorkflowField(session, { preset: b }, 'preset', 'uc', 'bad', { label: 'x', mode: 'discrete', service });
    session.removePreset('SDImageGen', 'B'); // 기록 밖 삭제
    expect(await service.undo(session)).toBe(false);
    expect(toast).toHaveBeenLastCalledWith(UNDO_TEXT.undoFailed(UNDO_TEXT.presetGone('B')), 'error');
    expect(service.entries(session).past).toHaveLength(0);
  });
});

describe('그림체 목록 차분', () => {
  test('추가 + 선택 → 되돌림 = 제거·이전 선택, 다시 실행 = 같은 객체 재추가·선택', async () => {
    const { service } = harness();
    const { session } = makeSession('A', 'B');
    const c = makePreset('C');
    editPresetList(session, UNDO_TEXT.presetAdd('C'), () => {
      session.addPreset(c);
      session.selectedWorkflow = { workflowType: 'SDImageGen', presetName: 'C' };
    }, { service });
    await service.undo(session);
    expect(list(session)).toEqual(['A', 'B']);
    expect(session.selectedWorkflow?.presetName).toBe('A');
    await service.redo(session);
    expect(session.presets.get('SDImageGen')![2]).toBe(c);
    expect(session.selectedWorkflow?.presetName).toBe('C');
  });

  test('삭제 → 되돌림 = 같은 객체를 원래 자리로 + 선택 복원(렌더 보정이 선택을 바꿨어도)', async () => {
    const { service } = harness();
    const { session, presets } = makeSession('A', 'B', 'C');
    const b = presets[1];
    session.selectedWorkflow = { workflowType: 'SDImageGen', presetName: 'B' };
    editPresetList(session, UNDO_TEXT.presetRemove(['B']), () => {
      session.removePreset('SDImageGen', 'B');
      session.selectedWorkflow = { workflowType: 'SDImageGen', presetName: undefined };
    }, { service });
    // PreSetEditor 렌더 보정(기록 밖): 첫 그림체를 고른다
    session.selectedWorkflow!.presetName = 'A';
    await service.undo(session);
    expect(list(session)).toEqual(['A', 'B', 'C']);
    expect(session.presets.get('SDImageGen')![1]).toBe(b);
    expect(session.selectedWorkflow?.presetName).toBe('B');
    await service.redo(session);
    expect(list(session)).toEqual(['A', 'C']);
  });

  test('여러 개 삭제(일괄) = 1항목, 되돌림은 각자 원래 자리', async () => {
    const { service } = harness();
    const { session } = makeSession('A', 'B', 'C', 'D');
    editPresetList(session, UNDO_TEXT.presetRemove(['B', 'D']), () => {
      session.removePreset('SDImageGen', 'B');
      session.removePreset('SDImageGen', 'D');
    }, { service });
    expect(service.entries(session).past).toHaveLength(1);
    await service.undo(session);
    expect(list(session)).toEqual(['A', 'B', 'C', 'D']);
  });

  test('순서 변경 되돌림 — 그사이 기록 밖에서 생긴 그림체는 지우지 않고 뒤에 남긴다', async () => {
    const { service } = harness();
    const { session } = makeSession('A', 'B', 'C');
    editPresetList(session, UNDO_TEXT.presetMove('C'), () => session.movePreset('SDImageGen', 2, 0), { service });
    expect(list(session)).toEqual(['C', 'A', 'B']);
    session.addPreset(makePreset('X')); // 기록 밖(예: 템플릿 불러오기)
    await service.undo(session);
    expect(list(session)).toEqual(['A', 'B', 'C', 'X']);
    await service.redo(session);
    expect(list(session)).toEqual(['C', 'A', 'B', 'X']);
  });

  test('삭제 되돌림 때 같은 이름을 다른 그림체가 쓰면 실패 토스트·항목 폐기(덮어쓰지 않음)', async () => {
    const { service, toast } = harness();
    const { session } = makeSession('A', 'B');
    editPresetList(session, UNDO_TEXT.presetRemove(['B']), () => session.removePreset('SDImageGen', 'B'), { service });
    session.addPreset(makePreset('B')); // 기록 밖에서 같은 이름 생성
    const other = session.presets.get('SDImageGen')![1];
    expect(await service.undo(session)).toBe(false);
    expect(toast).toHaveBeenLastCalledWith(UNDO_TEXT.undoFailed(UNDO_TEXT.presetNameTaken('B')), 'error');
    expect(session.presets.get('SDImageGen')).toEqual([expect.anything(), other]);
  });

  test('복제·불러오기(비동기 기록) — 끝난 뒤 라벨로 1항목, 변화 없으면 기록 없음', async () => {
    const { service } = harness();
    const { session, presets } = makeSession('A');
    const copy = sdWf.presetFromJSON(presets[0].toJSON());
    copy.name = 'A copy 1';
    editPresetList(session, UNDO_TEXT.presetDuplicate('A copy 1'), () => session.addPreset(copy), { service });
    const rec = beginPresetListRecord(session, UNDO_TEXT.presetImport(2), { service });
    await Promise.resolve();
    const e1 = makePreset('I1', easyWf);
    session.addPreset(e1);
    session.selectedWorkflow = { workflowType: 'SDImageGenEasy', presetName: 'I1' };
    expect(rec.commit(UNDO_TEXT.presetImport(1))).toBe(true);
    expect(service.entries(session).past.map((e) => e.label)).toEqual([
      UNDO_TEXT.presetDuplicate('A copy 1'),
      UNDO_TEXT.presetImport(1),
    ]);
    await service.undo(session);
    expect(session.presets.get('SDImageGenEasy')).toEqual([]);
    expect(session.selectedWorkflow).toEqual({ workflowType: 'SDImageGen', presetName: 'A' });
    await service.undo(session);
    expect(list(session)).toEqual(['A']);
    expect(beginPresetListRecord(session, 'none', { service }).commit()).toBe(false);
  });

  test('이름 변경 — 선택 이름 함께, 되돌림·다시 실행, 그사이 이름이 바뀌었으면 실패', async () => {
    const { service, toast } = harness();
    const { session, presets } = makeSession('A', 'B');
    const a = presets[0];
    renamePresetRecorded(session, a, 'A2', { service });
    expect(session.selectedWorkflow?.presetName).toBe('A2');
    expect(service.entries(session).past[0].label).toBe(UNDO_TEXT.presetRename('A', 'A2'));
    expect(service.undoLabel).toBeUndefined(); // curSession 없음 — peekLabel 로 확인
    expect(service.peekLabel(session, 'undo')).toBe(UNDO_TEXT.presetRename('A2', 'A'));
    await service.undo(session);
    expect(a.name).toBe('A');
    expect(session.selectedWorkflow?.presetName).toBe('A');
    await service.redo(session);
    expect(a.name).toBe('A2');
    a.name = 'Z'; // 기록 밖 변경
    expect(await service.undo(session)).toBe(false);
    expect(toast).toHaveBeenLastCalledWith(UNDO_TEXT.undoFailed(UNDO_TEXT.presetNameChanged('Z')), 'error');
  });

  test('선택 — 1초 안 연속 선택은 1항목, 되돌림 = 처음 선택', async () => {
    const { service, clock } = harness();
    const { session } = makeSession('A', 'B', 'C');
    selectWorkflowRecorded(session, { workflowType: 'SDImageGen', presetName: 'B' }, UNDO_TEXT.presetSelect('B'), { service });
    clock.t += 300;
    selectWorkflowRecorded(session, { workflowType: 'SDImageGen', presetName: 'C' }, UNDO_TEXT.presetSelect('C'), { service });
    expect(service.entries(session).past).toHaveLength(1);
    expect(service.entries(session).past[0].label).toBe(UNDO_TEXT.presetSelect('C'));
    await service.undo(session);
    expect(session.selectedWorkflow?.presetName).toBe('A');
    // 같은 값 선택은 기록 없음
    selectWorkflowRecorded(session, { workflowType: 'SDImageGen', presetName: 'A' }, 'x', { service });
    expect(service.entries(session).past).toHaveLength(0);
  });
});

describe('프로젝트 필드', () => {
  test('추가 프롬프트 = 편집 세션, 새 씬 해상도 = 1초 병합', async () => {
    const { service, clock } = harness();
    const { session } = makeSession('A');
    const w = manualWatch();
    setExtraPromptRecorded(session, 'x', { service, watch: w.watch });
    setExtraPromptRecorded(session, 'xy', { service, watch: w.watch });
    w.leave();
    setNewSceneResolutionRecorded(session, { resolution: 'landscape' }, { service });
    clock.t += 100;
    setNewSceneResolutionRecorded(session, { resolution: 'square' }, { service });
    expect(service.entries(session).past.map((e) => e.label)).toEqual([
      UNDO_TEXT.extraPromptEdit,
      UNDO_TEXT.newSceneResolution,
    ]);
    await service.undo(session);
    expect(session.newSceneResolution).toBeUndefined();
    await service.undo(session);
    expect(session.extraPrompt).toBe('');
  });
});

describe('바이브·레퍼런스', () => {
  test('추가·삭제 = 배열 깊은 복사(기록 뒤 항목 값을 바꿔도 보관본 불변)·복원은 같은 경로 객체 재사용', async () => {
    const { service } = harness();
    const { session, shared } = makeSession('A');
    shared.vibes = [VibeItem.fromJSON({ path: 'v1.png', info: 1, strength: 0.6 })];
    const v1 = shared.vibes[0];
    editWorkflowFields(session, { shared }, [['shared', 'vibes']], UNDO_TEXT.vibeAdd, () => {
      shared.vibes.push(VibeItem.fromJSON({ path: 'v2.png', info: 1, strength: 0.6 }));
    }, { service });
    editWorkflowFields(session, { shared }, [['shared', 'vibes']], UNDO_TEXT.vibeRemove, () => {
      shared.vibes = shared.vibes.filter((x: VibeItem) => x !== v1);
    }, { service });
    expect(shared.vibes.map((x: VibeItem) => x.path)).toEqual(['v2.png']);
    await service.undo(session); // 삭제 되돌림
    expect(shared.vibes.map((x: VibeItem) => x.path)).toEqual(['v1.png', 'v2.png']);
    expect(shared.vibes[0]).toBeInstanceOf(VibeItem);
    const restoredV1 = shared.vibes[0];
    await service.undo(session); // 추가 되돌림
    expect(shared.vibes.map((x: VibeItem) => x.path)).toEqual(['v1.png']);
    expect(shared.vibes[0]).toBe(restoredV1); // 같은 경로 객체 재사용(슬라이더·키 유지)
    await service.redo(session);
    expect(shared.vibes.map((x: VibeItem) => x.path)).toEqual(['v1.png', 'v2.png']);
  });

  test('항목 값(IS·Strength) — 같은 항목·키 1초 병합, 슬라이더 열림 중엔 대입만, 레퍼런스 유형·켜기 1항목', async () => {
    const { service, clock } = harness();
    const { session, shared } = makeSession('A');
    shared.vibes = [VibeItem.fromJSON({ path: 'v1.png', info: 1, strength: 0.6 })];
    shared.characterReferences = [ReferenceItem.fromJSON({ path: 'r.png', info: 1, strength: 0.6, fidelity: 1, referenceType: 'character' })];
    const v = shared.vibes[0];
    setWorkflowItemValue(session, { shared }, 'shared', 'vibes', v, 'info', 0.5, UNDO_TEXT.vibeValue, { service });
    clock.t += 200;
    setWorkflowItemValue(session, { shared }, 'shared', 'vibes', v, 'info', 0.4, UNDO_TEXT.vibeValue, { service });
    expect(service.entries(session).past).toHaveLength(1);
    const slide = beginWorkflowSlide(session, { shared }, [['shared', 'vibes']], UNDO_TEXT.vibeValue, { service });
    setWorkflowItemValue(session, { shared }, 'shared', 'vibes', v, 'strength', 0.1, UNDO_TEXT.vibeValue, { service });
    setWorkflowItemValue(session, { shared }, 'shared', 'vibes', v, 'strength', 0.2, UNDO_TEXT.vibeValue, { service });
    expect(service.entries(session).past).toHaveLength(1);
    slide.commit();
    expect(service.entries(session).past).toHaveLength(2);
    const r = shared.characterReferences[0];
    editWorkflowFields(session, { shared }, [['shared', 'characterReferences']], UNDO_TEXT.referenceValue, () => {
      r.referenceType = 'style';
      r.enabled = false;
    }, { service });
    expect(service.entries(session).past).toHaveLength(3);
    await service.undo(session);
    expect(shared.characterReferences[0]).toBe(r); // 같은 경로 객체 재사용
    expect(r.referenceType).toBe('character');
    expect(r.enabled).toBe(true);
    await service.undo(session);
    expect(v.strength).toBe(0.6);
    await service.undo(session);
    expect(v.info).toBe(1);
  });

  test('보관본은 깊은 복사 — 기록 뒤 같은 항목 객체를 바꿔도 되돌림은 기록 시 값으로', async () => {
    const { service } = harness();
    const { session, shared } = makeSession('A');
    shared.vibes = [VibeItem.fromJSON({ path: 'v1.png', info: 1, strength: 0.6 })];
    const v1 = shared.vibes[0];
    editWorkflowFields(session, { shared }, [['shared', 'vibes']], UNDO_TEXT.vibeAdd, () => {
      shared.vibes.push(VibeItem.fromJSON({ path: 'v2.png', info: 1, strength: 0.6 }));
    }, { service });
    v1.info = 0.1; // 기록 밖에서 같은 객체 값 변경(보관본과 공유하면 함께 바뀐다)
    await service.undo(session); // D16 확인(기본 true)
    expect(shared.vibes).toHaveLength(1);
    expect(shared.vibes[0]).toBe(v1);
    expect(v1.info).toBe(1);
  });

  test('D16 — 기록 뒤 같은 칸이 기록 밖에서 바뀌면 확인, 취소 = 항목 유지·다시 물음', async () => {
    const { service, confirm } = harness();
    const { session, shared } = makeSession('A');
    editWorkflowFields(session, { shared }, [['shared', 'vibes']], UNDO_TEXT.vibeAdd, () => {
      shared.vibes = [VibeItem.fromJSON({ path: 'v1.png', info: 1, strength: 0.6 })];
    }, { service });
    shared.vibes = [...shared.vibes, VibeItem.fromJSON({ path: 'out.png', info: 1, strength: 0.6 })]; // 기록 밖
    confirm.mockResolvedValueOnce(false);
    expect(await service.undo(session)).toBe(false);
    expect(confirm).toHaveBeenCalledWith(UNDO_TEXT.conflictUndo(UNDO_TEXT.vibeAdd), UNDO_TEXT.undoName);
    expect(service.entries(session).past).toHaveLength(1);
    expect(await service.undo(session)).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(shared.vibes).toEqual([]);
  });
});

describe('로컬 캐릭터 프리셋', () => {
  const cp = (name: string) => {
    const p = new CharacterPreset();
    p.name = name;
    p.characterPrompt = `${name} prompt`;
    p.vibes = [VibeItem.fromJSON({ path: `${name}.png`, info: 1, strength: 0.6 })];
    return p;
  };
  const apply = (session: Session, shared: any, p: CharacterPreset) => {
    shared.vibes = [...(shared.vibes || []), ...p.vibes.map((v) => {
      const x = VibeItem.fromJSON(v.toJSON());
      x.fromPreset = p.name;
      return x;
    })];
    shared.characterPrompts = [
      ...(shared.characterPrompts || []),
      { id: `cp-${p.name}`, prompt: p.characterPrompt, uc: '', position: { x: 0.5, y: 0.5 }, fromPreset: p.name },
    ];
    shared._appliedPresetName = p.name;
  };

  test('추가·순서·적용 되돌림·다시 실행(Map 순서·공용 설정 항목)', async () => {
    const { service } = harness();
    const { session, shared } = makeSession('A');
    const k1 = cp('K1');
    const k2 = cp('K2');
    editCharacterPresets(session, UNDO_TEXT.characterPresetAdd('K1'), () => session.addCharacterPreset(k1), { service });
    editCharacterPresets(session, UNDO_TEXT.characterPresetAdd('K2'), () => session.addCharacterPreset(k2), { service });
    editCharacterPresets(session, UNDO_TEXT.characterPresetMove, () => session.moveCharacterPreset(1, 0), { service });
    editCharacterPresets(session, UNDO_TEXT.characterPresetApply(['K1']), () => apply(session, shared, k1), { service });
    expect([...session.characterPresets.keys()]).toEqual(['K2', 'K1']);
    await service.undo(session); // 적용
    expect(shared.vibes).toEqual([]);
    expect(shared.characterPrompts).toEqual([]);
    await service.undo(session); // 순서
    expect([...session.characterPresets.keys()]).toEqual(['K1', 'K2']);
    expect(session.characterPresets.get('K1')).toBe(k1); // 내용이 같으면 같은 객체 유지
    await service.undo(session); // K2 추가
    expect([...session.characterPresets.keys()]).toEqual(['K1']);
    await service.redo(session);
    await service.redo(session);
    await service.redo(session);
    expect([...session.characterPresets.keys()]).toEqual(['K2', 'K1']);
    expect(shared.vibes.map((v: VibeItem) => [v.path, v.fromPreset])).toEqual([['K1.png', 'K1']]);
    expect(shared.vibes[0]).toBeInstanceOf(VibeItem);
  });

  test('삭제(적용 해제 포함) = 바깥 기록 1항목 — 안쪽 해제는 따로 기록하지 않는다, 되돌리면 둘 다 돌아온다', async () => {
    const { service } = harness();
    const { session, shared } = makeSession('A');
    const k1 = cp('K1');
    session.addCharacterPreset(k1);
    apply(session, shared, k1);
    editCharacterPresets(session, UNDO_TEXT.characterPresetRemove(['K1']), () => {
      // 안쪽(AppService.removeAppliedCharacterPreset 와 같은 경로)
      editCharacterPresets(session, UNDO_TEXT.appliedPresetRemove(['K1']), () => {
        shared.vibes = shared.vibes.filter((v: VibeItem) => v.fromPreset !== 'K1');
        shared.characterPrompts = shared.characterPrompts.filter((c: any) => c.fromPreset !== 'K1');
        shared._appliedPresetName = '';
      }, { service });
      session.removeCharacterPreset('K1');
    }, { service });
    expect(service.entries(session).past.map((e) => e.label)).toEqual([UNDO_TEXT.characterPresetRemove(['K1'])]);
    await service.undo(session);
    expect(session.characterPresets.has('K1')).toBe(true);
    expect(shared.vibes.map((v: VibeItem) => v.fromPreset)).toEqual(['K1']);
    expect(shared._appliedPresetName).toBe('K1');
  });

  test('비동기 기록(글로벌→프로젝트 불러오기·적용) — commit 까지 안쪽 기록을 흡수해 1항목', async () => {
    const { service } = harness();
    const { session, shared } = makeSession('A');
    const rec = beginCharacterPresetRecord(session, UNDO_TEXT.characterPresetFromGlobal(1, 'G'), { service });
    await Promise.resolve();
    const g = cp('G');
    session.addCharacterPreset(g);
    editCharacterPresets(session, 'inner', () => apply(session, shared, g), { service });
    expect(rec.commit()).toBe(true);
    expect(service.entries(session).past).toHaveLength(1);
    await service.undo(session);
    expect(session.characterPresets.size).toBe(0);
    expect(shared.vibes).toEqual([]);
    // 닫힌 뒤에는 다시 따로 기록된다
    editCharacterPresets(session, 'after', () => session.addCharacterPreset(cp('H')), { service });
    expect(service.entries(session).past.map((e) => e.label)).toEqual(['after']);
  });
});

describe('F2 — 캐릭터 프리셋 이름 변경 시 적용 항목 출처 태그 갱신', () => {
  test('updateCharacterPreset(옛 이름, 새 이름 객체) → vibes·references·characterPrompts·_appliedPresetName', () => {
    const { session, shared } = makeSession('A');
    const easyShared = easyWf.buildShared();
    session.presetShareds.set('SDImageGenEasy', easyShared);
    const k = new CharacterPreset();
    k.name = 'Old';
    session.addCharacterPreset(k);
    shared.vibes = [VibeItem.fromJSON({ path: 'a.png', info: 1, strength: 1, fromPreset: 'Old' })];
    shared.characterReferences = [
      ReferenceItem.fromJSON({ path: 'r.png', info: 1, strength: 1, fidelity: 1, referenceType: 'character', fromPreset: 'Old' }),
      ReferenceItem.fromJSON({ path: 'm.png', info: 1, strength: 1, fidelity: 1, referenceType: 'character' }),
    ];
    shared.characterPrompts = [
      { id: '1', prompt: 'x', uc: '', position: { x: 0, y: 0 }, fromPreset: 'Old' },
      { id: '2', prompt: 'y', uc: '', position: { x: 0, y: 0 }, fromPreset: 'Other' },
    ];
    shared._appliedPresetName = 'Old';
    easyShared.vibes = [VibeItem.fromJSON({ path: 'e.png', info: 1, strength: 1, fromPreset: 'Old' })];
    const renamed = CharacterPreset.fromJSON(k.toJSON());
    renamed.name = 'New';
    session.updateCharacterPreset('Old', renamed);
    expect(session.characterPresets.has('Old')).toBe(false);
    expect(session.characterPresets.get('New')).toBe(renamed);
    expect(shared.vibes[0].fromPreset).toBe('New');
    expect(shared.characterReferences.map((r: ReferenceItem) => r.fromPreset)).toEqual(['New', undefined]);
    expect(shared.characterPrompts.map((c: any) => c.fromPreset)).toEqual(['New', 'Other']);
    expect(shared._appliedPresetName).toBe('New');
    expect(easyShared.vibes[0].fromPreset).toBe('New');
  });

  test('이름이 같으면(내용만 편집) 태그를 건드리지 않는다', () => {
    const { session, shared } = makeSession('A');
    const k = new CharacterPreset();
    k.name = 'K';
    session.addCharacterPreset(k);
    shared.vibes = [VibeItem.fromJSON({ path: 'a.png', info: 1, strength: 1, fromPreset: 'K' })];
    const before = shared.vibes;
    const edited = CharacterPreset.fromJSON(k.toJSON());
    edited.characterPrompt = 'changed';
    session.updateCharacterPreset('K', edited);
    expect(shared.vibes).toBe(before);
    expect(shared.vibes[0].fromPreset).toBe('K');
  });
});

describe('기록 범위·미러', () => {
  test('미러 프로젝트는 기록하지 않는다(대입은 한다)', () => {
    const toast = jest.fn();
    const service = new UndoService({
      curSession: () => undefined,
      isMirror: () => true,
      toast,
      now: () => 0,
      confirm: async () => true,
    });
    const { session, presets } = makeSession('A');
    setWorkflowField(session, { preset: presets[0] }, 'preset', 'uc', 'u', { label: 'x', service });
    editPresetList(session, 'x', () => session.addPreset(makePreset('B')), { service });
    editCharacterPresets(session, 'x', () => session.addCharacterPreset(new CharacterPreset()), { service });
    expect(presets[0].uc).toBe('u');
    expect(list(session)).toEqual(['A', 'B']);
    expect(service.entries(session).past).toHaveLength(0);
  });

  test('글로벌 라이브러리 객체(프로젝트 밖 그림체·공용 설정)는 기록하지 않는다', () => {
    const { service } = harness();
    const { session } = makeSession('A');
    const globalPreset = makePreset('G'); // 글로벌 프리셋 편집 사본 — 세션 목록에 없음
    const globalShared = sdWf.buildShared();
    editWorkflowFields(session, { preset: globalPreset, shared: globalShared }, [
      ['preset', 'frontPrompt'],
      ['shared', 'vibes'],
    ], 'x', () => {
      globalPreset.frontPrompt = 'g';
      globalShared.vibes = [VibeItem.fromJSON({ path: 'g.png', info: 1, strength: 1 })];
    }, { service });
    expect(globalPreset.frontPrompt).toBe('g');
    expect(service.entries(session).past).toHaveLength(0);
  });
});
