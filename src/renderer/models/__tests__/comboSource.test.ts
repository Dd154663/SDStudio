/**
 * 변형 씬 조합 모드 만들기·켜기(2026-11-03, SPEC_GUIDE §7-4 「조합 모드 만들기·켜기」) — comboSource 단일 출처.
 *  - buildComboFromScene = 복사 흐름(B1/P1) 옛 조립과 같은 결과(같은 입력으로 비교)
 *  - 빈 조합(변형 탭 +)·현재 프롬프트 → 중간(끄기 → 켜기 왕복 시 prompt·slots 보존)
 *  - 생성 직전 3택(chooseNewVariantCombo): 단일 불변·공유·고정·취소·설정 없음·원본 변형 씬 승계·단일 변형 씬 → 중간
 *  - 편집 창 「조합 모드 켜기」(turnOnComboMode): sceneRef 있음/없음, 되돌리기 1항목 복원
 *  - 호출부 배선(소스 검사): 변형 탭 + 3택 1회·생성 직전 위치·켜기 버튼 자리
 */
const pushed: any[] = [];
const answers: (string | undefined)[] = [];
const messages: { text: string; kind?: string }[] = [];

jest.mock('..', () => {
  const { WFWorkFlow } = jest.requireActual('../workflows/WorkFlow');
  const defs = () => {
    const sd = jest.requireActual('../workflows/SDWorkFlow');
    return [sd.SDInpaintDef, sd.SDI2IDef, sd.SDMirrorDef, sd.SDImageGenDef];
  };
  return {
    isMobile: false,
    backend: {},
    imageService: {},
    promptService: {},
    taskQueueService: {},
    workFlowService: {
      buildPreset: (type: string) =>
        new WFWorkFlow(defs().find((d: any) => d.type === type)).buildPreset(),
      presetFromJSON: (json: any) => json,
    },
  };
});
jest.mock('../ImageService', () => ({ dataUriToBase64: (d: string) => d.split(',')[1] }));
jest.mock('../appStateRef', () => ({
  getAppState: () => ({
    pushDialogAsync: (dialog: any) => {
      pushed.push(dialog);
      return Promise.resolve(answers.shift());
    },
    pushMessage: (text: string, kind?: string) => messages.push({ text, kind }),
  }),
}));

import * as fs from 'fs';
import * as path from 'path';
import { InpaintScene, PromptNode, PromptPiece, Scene, Session } from '../types';
import { WFWorkFlow } from '../workflows/WorkFlow';
import { buildSDImageGenJob, SDI2IDef, SDImageGenDef, SDInpaintDef, SDMirrorDef } from '../workflows/SDWorkFlow';
import { COMBO_EDITOR_TEXT, variantComboMode } from '../comboMode';
import { I2I_BATCH_TEXT, i2iComboPresetFromJob } from '../i2iBatch';
import { combinationMiddlePrompt, enumerateCombinations } from '../PromptService';
import { resolveSceneCharacterPrompts, usesSceneCharacterPromptData } from '../sceneCharacterPrompts';
import { joinPromptParts, snapshotComboFields } from '../variantCombo';
import { UndoService, UNDO_TEXT } from '../undoService';
import { flushSceneFieldEdit } from '../sceneFieldUndo';
import { resetVariantUndoState } from '../variantSceneUndo';
import {
  applyComboPatch,
  askVariantPromptLayout,
  buildComboFromScene,
  chooseNewVariantCombo,
  COMBO_PRESET_KEYS,
  COMBO_SOURCE_TEXT,
  comboFromSinglePreset,
  emptyCombo,
  prepareComboContext,
  turnOnComboMode,
} from '../comboSource';

const wf = (def: any) => new WFWorkFlow(def);
const buildPreset = (type: string) =>
  wf([SDI2IDef, SDInpaintDef, SDMirrorDef].find((d) => d.type === type)).buildPreset();

let genPreset: any;
let genShared: any;

let idc = 0;
const pieceJson = (prompt: string, opts: { enabled?: boolean; chars?: string[] } = {}) => ({
  prompt,
  characterPrompts: opts.chars ?? [],
  id: 'p' + idc++,
  enabled: opts.enabled,
});

/** 원본 일반 씬 — 조합 2열(첫 열 첫 조각 꺼짐), 씬 네거티브·씬 캐릭터 UC(역할 없음 = 붙지 않음) */
function sourceScene(name = 'S'): Scene {
  const s = new Scene();
  s.name = name;
  s.slots = [
    [PromptPiece.fromJSON(pieceJson('off', { enabled: false })), PromptPiece.fromJSON(pieceJson('a, <lib.p>', { chars: ['c-a'] }))],
    [PromptPiece.fromJSON(pieceJson('x')), PromptPiece.fromJSON(pieceJson('y'))],
  ];
  s.sceneUC = 'scene-uc';
  s.sceneCharacterUC = 'role-uc';
  return s;
}

function makeSession(): Session {
  const session = new Session();
  session.name = 'p';
  session.extraPrompt = 'ex';
  session.selectedWorkflow = { workflowType: 'SDImageGen', presetName: 'main' } as any;
  (session as any).getCommonSetup = () => ['SDImageGen', genPreset, genShared, SDImageGenDef];
  return session;
}

/** 메타데이터로 만든 것 같은 새 변형 씬(이미지·강도·마스크가 이미 정해짐) */
function metaVariant(workflowType: string, name = 'S0'): InpaintScene {
  const scene = new InpaintScene();
  scene.name = name;
  scene.workflowType = workflowType;
  scene.preset = buildPreset(workflowType);
  Object.assign(scene.preset, {
    image: 'img.png',
    strength: 0.42,
    prompt: 'META-FULL, a, x',
    uc: 'META-UC',
    characterPrompts: [{ id: 'm', prompt: 'meta-char', uc: '', enabled: true, position: { x: 0.5, y: 0.5 } }],
  });
  if (workflowType === 'SDInpaint') scene.preset.mask = 'mask.png';
  return scene;
}

beforeEach(() => {
  pushed.splice(0);
  answers.splice(0);
  messages.splice(0);
  genPreset = wf(SDImageGenDef).buildPreset();
  Object.assign(genPreset, {
    frontPrompt: 'MAIN-F',
    backPrompt: 'MAIN-B',
    uc: 'MAIN-UC',
    cfgRescale: 0.3,
    useCoords: true,
    characterPrompts: [
      { id: 'c0', prompt: 'girl', uc: 'u', position: { x: 0.2, y: 0.3 }, enabled: true },
      { id: 'c1', prompt: 'boy', uc: '', position: { x: 0.7, y: 0.3 }, enabled: false },
    ],
  });
  genShared = { type: 'SDImageGen', normalizeStrength: false };
});
afterEach(() => {
  flushSceneFieldEdit();
  resetVariantUndoState();
});

describe('buildComboFromScene — 복사 흐름(B1/P1) 옛 조립과 같은 결과', () => {
  /** 2026-11-03 이전 i2iBatchFlow.createVariantCopyScenes 의 조립(그대로 옮김) */
  const legacy = (src: Scene, workflow: string, mode: 'shared' | 'snapshot', snapshot?: any) => {
    const EMPTY: PromptNode = { type: 'text', text: '' };
    const job = buildSDImageGenJob(src, EMPTY, [], genPreset, genShared);
    const first = enumerateCombinations(src, 1)[0];
    return i2iComboPresetFromJob(buildPreset(workflow), job, {
      middlePrompt: first ? combinationMiddlePrompt(first) : '',
      sceneUc: joinPromptParts(usesSceneCharacterPromptData(src) ? src.sceneCharacterUC : '', src.sceneUC),
      characterPrompts: resolveSceneCharacterPrompts(genPreset, genShared, src),
      mode,
      snapshot,
    });
  };

  test.each([
    ['SDI2I', 'shared'],
    ['SDI2I', 'snapshot'],
    ['SDInpaint', 'shared'],
    ['SDInpaint', 'snapshot'],
  ] as const)('%s · %s', async (workflow, mode) => {
    const session = makeSession();
    const src = sourceScene();
    const ctx = (await prepareComboContext(session, mode))!;
    expect(ctx).toBeDefined();
    const combo = buildComboFromScene(src, workflow, mode, ctx, buildPreset);
    const old = legacy(src, workflow, mode, ctx.snapshot);
    expect(combo.preset.toJSON()).toEqual(old.toJSON());
    expect(combo.slots).toEqual(src.toJSON().slots);
    expect(combo.slots[0][0]).not.toBe(src.slots[0][0]); // 조각 객체 공유 금지
    expect(combo.comboMode).toBe(mode);
    expect(combo.sceneRef).toBe('S');
    // 값 확인 — 중간 = 첫 조합(꺼진 조각 제외), uc = 씬 네거티브만, 캐릭터 순서 그대로(꺼진 것 포함)
    expect(combo.preset.prompt).toBe('a, <lib.p>, x');
    expect(combo.preset.uc).toBe('scene-uc');
    expect(combo.preset.characterPrompts.map((c: any) => c.id)).toEqual(['c0', 'c1']);
    if (mode === 'snapshot') {
      expect(combo.preset).toMatchObject({ frontPrompt: 'MAIN-F, ex', backPrompt: 'MAIN-B', globalUc: 'MAIN-UC' });
    } else {
      expect(combo.preset).toMatchObject({ frontPrompt: '', backPrompt: '', globalUc: '' });
    }
    // 덮을 키(presetPatch)는 프롬프트 계열만 — useGlobalUc·이미지·강도는 없음
    expect(Object.keys(combo.presetPatch).sort()).toEqual(
      ['backPrompt', 'characterPrompts', 'frontPrompt', 'globalUc', 'prompt', 'uc'],
    );
  });

  test('prepareComboContext — 사전 세팅이 없거나 생성 워크플로우가 아니면 undefined, snapshot 고정값 = snapshotComboFields', async () => {
    const session = makeSession();
    const ctx = (await prepareComboContext(session, 'snapshot'))!;
    expect(ctx.snapshot).toEqual(await snapshotComboFields('SDImageGen', genPreset, genShared, 'ex'));
    expect((await prepareComboContext(session, 'shared'))!.snapshot).toBeUndefined();
    session.selectedWorkflow = undefined;
    expect(await prepareComboContext(session, 'shared')).toBeUndefined();
    const other = makeSession();
    (other as any).getCommonSetup = () => ['SDI2I', genPreset, genShared, SDI2IDef];
    expect(await prepareComboContext(other, 'shared')).toBeUndefined();
  });
});

describe('빈 조합·현재 프롬프트 → 중간', () => {
  test('emptyCombo — 중간 프롬프트 빈 값·1×1 빈 칸(일반 씬 새 씬 모양, 호출마다 새 id), 고정이면 메인 고정값', async () => {
    const session = makeSession();
    const shared = emptyCombo('SDI2I', 'shared', (await prepareComboContext(session, 'shared'))!, buildPreset);
    expect(shared.preset.prompt).toBe('');
    expect(shared.preset).toMatchObject({ frontPrompt: '', backPrompt: '', globalUc: '', useGlobalUc: true });
    expect(shared.slots).toEqual([[{ id: expect.any(String), prompt: '', characterPrompts: [], enabled: true }]]);
    expect(shared.comboMode).toBe('shared');
    const ctx = (await prepareComboContext(session, 'snapshot'))!;
    const a = emptyCombo('SDInpaint', 'snapshot', ctx, buildPreset);
    const b = emptyCombo('SDInpaint', 'snapshot', ctx, buildPreset);
    expect(a.preset).toMatchObject({ frontPrompt: 'MAIN-F, ex', backPrompt: 'MAIN-B', globalUc: 'MAIN-UC' });
    expect(a.slots[0][0].id).not.toBe(b.slots[0][0].id);
    const scene = InpaintScene.fromJSON({
      type: 'inpaint', name: 'n', workflowType: 'SDInpaint', preset: a.preset, slots: a.slots, comboMode: a.comboMode,
      mains: [], imageMap: [], round: undefined, game: undefined,
    } as any)!;
    expect(variantComboMode(scene)).toBe('snapshot');
    expect(scene.slots[0][0]).toBeInstanceOf(PromptPiece);
  });

  test('comboFromSinglePreset — 지금 프롬프트를 중간(1×1), uc·캐릭터·이미지·강도는 그대로, shared 는 고정값 칸 불변', async () => {
    const session = makeSession();
    const v = metaVariant('SDI2I');
    v.preset.frontPrompt = 'OLD-F';
    applyComboPatch(v, comboFromSinglePreset(v, 'shared', (await prepareComboContext(session, 'shared'))!));
    expect(v.comboMode).toBe('shared');
    expect(v.preset.prompt).toBe('META-FULL, a, x');
    expect(v.slots.map((c) => c.map((p) => p.prompt))).toEqual([['META-FULL, a, x']]);
    expect(v.preset).toMatchObject({ uc: 'META-UC', image: 'img.png', strength: 0.42, frontPrompt: 'OLD-F' });
    expect(v.preset.characterPrompts[0].id).toBe('m');
    const w = metaVariant('SDInpaint');
    applyComboPatch(w, comboFromSinglePreset(w, 'snapshot', (await prepareComboContext(session, 'snapshot'))!));
    expect(w.preset).toMatchObject({ frontPrompt: 'MAIN-F, ex', backPrompt: 'MAIN-B', globalUc: 'MAIN-UC', mask: 'mask.png' });
  });

  test('끄기 → 켜기 왕복 — prompt·slots 그대로(조각 객체도 유지), 끈 뒤 프롬프트를 고쳤으면 새 1×1', async () => {
    const session = makeSession();
    const ctx = (await prepareComboContext(session, 'snapshot'))!;
    const v = metaVariant('SDI2I');
    v.comboMode = 'snapshot';
    v.slots = [[PromptPiece.fromJSON(pieceJson('m1')), PromptPiece.fromJSON(pieceJson('m2'))], [PromptPiece.fromJSON(pieceJson('z'))]];
    const pieces = v.slots.flat();
    // 끄기(InPaintEditor.turnOffComboMode 와 같은 규칙) — prompt = 첫 조합 중간, comboMode 삭제, slots 유지
    v.preset.prompt = combinationMiddlePrompt(enumerateCombinations(v as any, 1)[0]);
    v.comboMode = undefined;
    const patch = comboFromSinglePreset(v, 'snapshot', ctx);
    expect(patch.slots).toBeUndefined();
    applyComboPatch(v, patch);
    expect(v.preset.prompt).toBe('m1, z');
    expect(v.slots.flat()).toEqual(pieces);
    expect(v.slots.flat()[0]).toBe(pieces[0]);
    expect(v.comboMode).toBe('snapshot');
    // 끈 뒤 단일 프롬프트를 고침 → 지금 프롬프트 한 조각
    v.comboMode = undefined;
    v.preset.prompt = 'edited';
    applyComboPatch(v, comboFromSinglePreset(v, 'shared', ctx));
    expect(v.slots.map((c) => c.map((p) => p.prompt))).toEqual([['edited']]);
  });
});

describe('생성 직전 3택 — chooseNewVariantCombo', () => {
  test('묻기 문구·선택지 = 단일·공유·고정(편집 창 모드 표시와 같은 표현), 「취소」류 항목 없음, 취소 = undefined', async () => {
    answers.push('single');
    expect(await askVariantPromptLayout()).toBe('single');
    expect(pushed[0].type).toBe('select');
    expect(pushed[0].text).toBe(COMBO_SOURCE_TEXT.layoutQuestion);
    expect(pushed[0].items).toEqual([
      { text: COMBO_SOURCE_TEXT.layoutSingle, value: 'single' },
      { text: COMBO_EDITOR_TEXT.modeShared, value: 'shared' },
      { text: COMBO_EDITOR_TEXT.modeSnapshot, value: 'snapshot' },
    ]);
    answers.push(undefined);
    expect(await askVariantPromptLayout()).toBeUndefined();
  });

  test('미러·이미지 수정 등은 묻지 않고 단일(기존 동작)', async () => {
    const session = makeSession();
    expect(await chooseNewVariantCombo(session, sourceScene(), 'SDMirror')).toEqual({ kind: 'single' });
    expect(await chooseNewVariantCombo(session, sourceScene(), 'Augment')).toEqual({ kind: 'single' });
    expect(pushed).toHaveLength(0);
  });

  test('단일 = 현재 동작 불변 · 취소 = 생성 없음', async () => {
    const session = makeSession();
    answers.push('single');
    expect(await chooseNewVariantCombo(session, sourceScene(), 'SDInpaint')).toEqual({ kind: 'single' });
    answers.push(undefined);
    expect(await chooseNewVariantCombo(session, sourceScene(), 'SDInpaint')).toBeUndefined();
    expect(pushed).toHaveLength(2);
  });

  test.each(['shared', 'snapshot'] as const)('원본 일반 씬 + %s — 조합 데이터만 바꾸고 이미지·강도·마스크는 기존 생성 규칙 그대로', async (mode) => {
    const session = makeSession();
    const src = sourceScene();
    answers.push(mode);
    const choice = (await chooseNewVariantCombo(session, src, 'SDInpaint'))!;
    expect(choice.kind).toBe('combo');
    const scene = metaVariant('SDInpaint');
    if (choice.kind === 'combo') {
      expect(choice.fromCurrent).toBe(false);
      expect(choice.apply(scene)).toBe(mode);
    }
    const ref = buildComboFromScene(src, 'SDInpaint', mode, (await prepareComboContext(session, mode))!, buildPreset);
    expect(scene.comboMode).toBe(mode);
    expect(scene.slots.map((c) => c.map((p) => p.prompt))).toEqual(src.slots.map((c) => c.map((p) => p.prompt)));
    expect(scene.slots[0][1]).not.toBe(src.slots[0][1]);
    for (const k of ['prompt', 'uc', 'characterPrompts', 'frontPrompt', 'backPrompt', 'globalUc']) {
      expect(scene.preset[k]).toEqual(ref.preset[k]);
    }
    expect(scene.preset).toMatchObject({ image: 'img.png', strength: 0.42, mask: 'mask.png', useGlobalUc: true });
  });

  test('조합 선택인데 사전 세팅이 없으면 안내 후 중단(undefined)', async () => {
    const session = makeSession();
    session.selectedWorkflow = undefined;
    answers.push('shared');
    expect(await chooseNewVariantCombo(session, sourceScene(), 'SDI2I')).toBeUndefined();
    expect(messages).toEqual([{ text: COMBO_SOURCE_TEXT.noSetup, kind: 'error' }]);
  });

  test('원본이 조합 모드 변형 씬 — 묻지 않고 조합(slots·comboMode·고정값·useGlobalUc) 승계', async () => {
    const session = makeSession();
    const src = metaVariant('SDI2I', 'V');
    src.comboMode = 'snapshot';
    Object.assign(src.preset, { prompt: 'mid', uc: 'scene-only', frontPrompt: 'F', backPrompt: 'B', globalUc: 'G', useGlobalUc: false });
    src.slots = [[PromptPiece.fromJSON(pieceJson('mid'))]];
    const choice = (await chooseNewVariantCombo(session, src, 'SDInpaint'))!;
    expect(pushed).toHaveLength(0);
    const scene = metaVariant('SDInpaint', 'V0');
    if (choice.kind === 'combo') choice.apply(scene);
    expect(scene.comboMode).toBe('snapshot');
    expect(scene.preset).toMatchObject({ prompt: 'mid', uc: 'scene-only', frontPrompt: 'F', backPrompt: 'B', globalUc: 'G', useGlobalUc: false, image: 'img.png', mask: 'mask.png' });
    expect(scene.slots[0][0].prompt).toBe('mid');
    expect(scene.slots[0][0]).not.toBe(src.slots[0][0]);
  });

  test('원본이 단일 변형 씬 — 3택, 조합이면 현재(메타) 프롬프트 → 중간', async () => {
    const session = makeSession();
    const src = metaVariant('SDI2I', 'V');
    answers.push('shared');
    const choice = (await chooseNewVariantCombo(session, src, 'SDI2I'))!;
    expect(pushed).toHaveLength(1);
    const scene = metaVariant('SDI2I', 'V0');
    if (choice.kind === 'combo') {
      expect(choice.fromCurrent).toBe(true);
      choice.apply(scene);
    }
    expect(scene.comboMode).toBe('shared');
    expect(scene.preset.prompt).toBe('META-FULL, a, x');
    expect(scene.slots[0][0].prompt).toBe('META-FULL, a, x');
  });
});

describe('편집 창 「조합 모드 켜기」 — turnOnComboMode', () => {
  const harness = () =>
    new UndoService({
      curSession: () => undefined,
      isMirror: () => false,
      toast: () => {},
      now: () => 1000,
      confirm: async () => true,
    });

  test('원본 씬이 있으면 출처 2택 — 가져오기 = 원본 조합(이미지·강도·마스크 유지), 되돌리기 1항목으로 전부 복원', async () => {
    const service = harness();
    const session = makeSession();
    const src = sourceScene('S');
    session.addScene(src);
    const v = metaVariant('SDInpaint', 'V');
    v.sceneRef = 'S';
    session.addScene(v);
    const before = { prompt: v.preset.prompt, uc: v.preset.uc, chars: JSON.stringify(v.preset.characterPrompts) };
    answers.push('snapshot', 'scene');
    expect(await turnOnComboMode(session, v, { service })).toBe(true);
    expect(pushed.map((d) => d.text)).toEqual([I2I_BATCH_TEXT.comboModeQuestion, COMBO_SOURCE_TEXT.sourceQuestion('S')]);
    expect(pushed[1].items.map((i: any) => i.value)).toEqual(['scene', 'current']);
    expect(v.comboMode).toBe('snapshot');
    expect(v.preset).toMatchObject({
      prompt: 'a, <lib.p>, x', uc: 'scene-uc', frontPrompt: 'MAIN-F, ex', backPrompt: 'MAIN-B', globalUc: 'MAIN-UC',
      image: 'img.png', strength: 0.42, mask: 'mask.png',
    });
    expect(v.slots).toHaveLength(2);
    expect(messages).toHaveLength(0);
    const past = service.entries(session).past;
    expect(past).toHaveLength(1);
    expect(past[0].label).toBe(UNDO_TEXT.variantComboOn('V'));
    await service.undo(session);
    expect(v.comboMode).toBeUndefined();
    expect(v.slots).toEqual([]);
    expect(v.preset.prompt).toBe(before.prompt);
    expect(v.preset.uc).toBe(before.uc);
    expect(JSON.stringify(v.preset.characterPrompts)).toBe(before.chars);
    expect(v.preset).toMatchObject({ frontPrompt: '', backPrompt: '', globalUc: '' });
    await service.redo(session);
    expect(v.comboMode).toBe('snapshot');
    expect(v.preset.prompt).toBe('a, <lib.p>, x');
  });

  test('원본 씬이 없으면 묻지 않고 현재 프롬프트 → 중간 + 안내 한 줄', async () => {
    const service = harness();
    const session = makeSession();
    const v = metaVariant('SDI2I', 'V');
    v.sceneRef = 'gone';
    session.addScene(v);
    answers.push('shared');
    expect(await turnOnComboMode(session, v, { service })).toBe(true);
    expect(pushed).toHaveLength(1);
    expect(v.comboMode).toBe('shared');
    expect(v.preset.prompt).toBe('META-FULL, a, x');
    expect(v.slots[0][0].prompt).toBe('META-FULL, a, x');
    expect(messages).toEqual([{ text: COMBO_SOURCE_TEXT.currentNotice, kind: 'info' }]);
    await service.undo(session);
    expect(v.comboMode).toBeUndefined();
    expect(v.slots).toEqual([]);
  });

  test('대상 아님(미러·이미 조합 모드)·취소면 아무것도 바꾸지 않는다', async () => {
    const service = harness();
    const session = makeSession();
    const mirror = metaVariant('SDMirror', 'M');
    const combo = metaVariant('SDI2I', 'C');
    combo.comboMode = 'shared';
    expect(await turnOnComboMode(session, mirror, { service })).toBe(false);
    expect(await turnOnComboMode(session, combo, { service })).toBe(false);
    expect(pushed).toHaveLength(0);
    const v = metaVariant('SDI2I', 'V');
    v.sceneRef = 'S';
    session.addScene(sourceScene('S'));
    session.addScene(v);
    answers.push('shared', undefined); // 출처 창에서 취소
    expect(await turnOnComboMode(session, v, { service })).toBe(false);
    expect(v.comboMode).toBeUndefined();
    expect(service.entries(session).past).toHaveLength(0);
  });

  test('되돌리기 키 = scene comboMode·slots + preset 프롬프트 계열 7키', () => {
    expect([...COMBO_PRESET_KEYS]).toEqual(['prompt', 'uc', 'characterPrompts', 'frontPrompt', 'backPrompt', 'globalUc', 'useGlobalUc']);
  });
});

describe('호출부 배선(소스 검사)', () => {
  const read = (rel: string) => fs.readFileSync(path.join(__dirname, rel), 'utf-8');

  test('변형 탭 + — 워크플로우 선택 뒤 3택 한 번(이름 줄 반복 밖), 조합이면 emptyCombo', () => {
    const src = read('../../componenets/SceneQueueControl.tsx');
    const body = src.slice(src.indexOf('const addScene = () =>'), src.indexOf('const getImage = async'));
    const ask = body.indexOf('askVariantPromptLayout()');
    const loop = body.indexOf('for (const name of names)', body.indexOf("text: '이미지 변형 방법을 선택해주세요'"));
    expect(ask).toBeGreaterThan(0);
    expect(ask).toBeLessThan(loop);
    expect(body.split('askVariantPromptLayout(').length - 1).toBe(1);
    expect(body).toContain('emptyCombo(menu, comboLayout, comboCtx)');
  });

  test('createInpaintScene — 이미지를 읽고 저장하기 전에 정하고, 등록 전에 적용', () => {
    const src = read('../../componenets/SceneQueueControl.tsx');
    const body = src.slice(src.indexOf('const createInpaintScene = async'), src.indexOf('const replaceInpaintSceneImage'));
    const choose = body.indexOf('chooseNewVariantCombo(');
    expect(choose).toBeGreaterThan(0);
    expect(choose).toBeLessThan(body.indexOf('imageService.fetchImage('));
    expect(body.indexOf('comboChoice.apply(newScene)')).toBeLessThan(body.lastIndexOf('curSession!.addScene(newScene)'));
  });

  test('InPaintEditor — 단일 계열 「프롬프트」 칸 머리(fieldHeaderEnds.prompt)에 켜기 버튼, 두 InnerPreSetEditor(모바일·PC) 모두', () => {
    const src = read('../../componenets/InPaintEditor.tsx');
    expect(src).toContain('turnOnComboMode(appState.curSession, editingScene)');
    expect(src.split('fieldHeaderEnds={singleHeaderEnds}').length - 1).toBe(2);
  });
});
