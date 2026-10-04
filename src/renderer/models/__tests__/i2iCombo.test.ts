// I2I 조합 모드(2026-10-04 B4) — comboMode 직렬화·판정, 조합 전개 공용 함수(생성 경로 createSDPrompts 와 같은 결과),
// I2I·미러 핸들러(전개 결과 사용·단일 프롬프트 조각 해석), B1 프리셋 규칙·슬롯 깊은 복사, 내용 복제, 누락 조각 검사.
// 계약: SPEC_GUIDE §7-4 「I2I 조합 모드」·§11-4 「조합 전개 공용 함수」·§6 「대량 작업 I2I」.
const addTask = jest.fn(async (_param: any, _samples: number) => {});
const lookupTag = jest.fn(async (_word: string): Promise<any> => null);
const pushed: any[] = [];
const answers: (string | undefined)[] = [];
let realPromptService: any;

jest.mock('..', () => ({
  backend: { lookupTag: (w: string) => lookupTag(w) },
  isMobile: false,
  globalPieceService: { library: new Map() },
  workFlowService: { buildPreset: jest.fn() },
  imageService: {
    fetchVibeImage: jest.fn(async () => 'data:image/png;base64,FETCHED'),
    getOutputDir: jest.fn(() => 'inpaints/project/scene'),
  },
  taskQueueService: { addTask },
  // 실제 PromptService(조각 풀기·누락 검사) — 순환 import 를 피해 처음 쓸 때 만든다
  get promptService() {
    if (!realPromptService) {
      const { PromptService } = jest.requireActual('../PromptService');
      realPromptService = new PromptService();
    }
    return realPromptService;
  },
}));
jest.mock('../ImageService', () => ({
  dataUriToBase64: jest.fn((d: string) => d.split(',')[1]),
}));
jest.mock('../appStateRef', () => ({
  getAppState: () => ({
    pushDialogAsync: (dialog: any) => {
      pushed.push(dialog);
      return Promise.resolve(answers.shift());
    },
  }),
}));

import * as fs from 'fs';
import * as path from 'path';
import { promptService } from '..';
import { InpaintScene, PromptPiece, Scene } from '../types';
import { isComboVariant, normalizeComboMode, variantComboMode } from '../comboMode';
import {
  cloneSlots,
  comboExpandedOf,
  comboHandlerPreset,
  comboSourceFromGenSetup,
  comboSourceFromSnapshot,
  copyComboContent,
  expandVariantCombos,
  resolvePresetPromptNode,
  snapshotComboFields,
} from '../variantCombo';
import { createSDPrompts, lowerPromptNode } from '../PromptService';
import { WFWorkFlow } from '../workflows/WorkFlow';
import { SDI2IDef, SDMirrorDef } from '../workflows/SDWorkFlow';
import { askComboMode, I2I_BATCH_TEXT, i2iComboPresetFromJob } from '../i2iBatch';

beforeEach(() => {
  addTask.mockClear();
  lookupTag.mockClear();
  pushed.splice(0);
  answers.splice(0);
});

let idc = 0;
function piece(prompt: string, opts: { enabled?: boolean; chars?: string[] } = {}) {
  return PromptPiece.fromJSON({
    prompt,
    characterPrompts: opts.chars ?? [],
    id: 'p' + idc++,
    enabled: opts.enabled,
  } as any);
}

// 조각 모음: <lib.p> = 'pp1, pp2'
const session: any = {
  name: 'project',
  extraPrompt: 'ex',
  library: new Map([['lib', { pieces: [{ name: 'p', prompt: 'pp1, pp2', multi: false }] }]]),
};

function inpaintScene(json: any): InpaintScene {
  const scene = InpaintScene.fromJSON({ type: 'inpaint', name: 'v', workflowType: 'SDI2I', ...json })!;
  return scene;
}

const words = (s: string) =>
  s
    .split(',')
    .map((w) => w.trim())
    .filter(Boolean);
const lowered = (nodes: any[]) => nodes.map((n) => words(lowerPromptNode(n)).join(', '));

describe('comboMode 직렬화·판정', () => {
  test('없으면 조합 모드 아님 — toJSON 에 키 없음, slots 는 그대로 직렬화', () => {
    const s = inpaintScene({ slots: [[{ prompt: 'a', characterPrompts: [], id: 'x' }]] });
    expect(s.comboMode).toBeUndefined();
    const json = s.toJSON();
    expect(json).not.toHaveProperty('comboMode');
    expect(json.slots).toHaveLength(1);
    expect(variantComboMode(s)).toBeUndefined();
  });

  test('있으면 왕복 보존, 알 수 없는 값은 버림', () => {
    const s = inpaintScene({ comboMode: 'snapshot' });
    expect(s.toJSON().comboMode).toBe('snapshot');
    const back = InpaintScene.fromJSON(JSON.parse(JSON.stringify(s.toJSON())))!;
    expect(back.comboMode).toBe('snapshot');
    expect(inpaintScene({ comboMode: 'weird' }).comboMode).toBeUndefined();
    expect(normalizeComboMode('shared')).toBe('shared');
    expect(normalizeComboMode(undefined)).toBeUndefined();
  });

  test('롤백 보존 — 옛 버전이 comboMode 를 모르고 읽어도 slots·중간 프롬프트는 남는다', () => {
    const s = inpaintScene({
      comboMode: 'shared',
      slots: [[{ prompt: 'mid', characterPrompts: [], id: 'x' }]],
    });
    const json: any = JSON.parse(JSON.stringify(s.toJSON()));
    delete json.comboMode; // 5.4.0 은 모르는 키를 저장하지 않는다
    const old = InpaintScene.fromJSON(json)!;
    expect(old.slots[0][0].prompt).toBe('mid');
    expect(variantComboMode(old)).toBeUndefined(); // 단일 프롬프트로 동작
  });

  test('판정 — 미러 = shared, I2I = 저장값, 인페인트는 값이 있어도 아님', () => {
    expect(variantComboMode({ workflowType: 'SDMirror' })).toBe('shared');
    expect(variantComboMode({ workflowType: 'SDI2I', comboMode: 'snapshot' })).toBe('snapshot');
    expect(variantComboMode({ workflowType: 'SDI2I' })).toBeUndefined();
    expect(variantComboMode({ workflowType: 'SDInpaint', comboMode: 'shared' })).toBeUndefined();
    expect(isComboVariant({ workflowType: 'SDMirror' })).toBe(true);
  });

  test('I2I 프리셋의 고정값 키 — 기본 빈 값, 옛 JSON 은 기본값 유지, 왕복 보존', () => {
    const wf = new WFWorkFlow(SDI2IDef);
    const preset = wf.buildPreset();
    expect(preset).toMatchObject({ frontPrompt: '', backPrompt: '', globalUc: '' });
    const old = wf.presetFromJSON({ type: 'SDI2I', prompt: 'p', image: 'a.png' });
    expect(old.frontPrompt).toBe('');
    Object.assign(preset, { frontPrompt: 'f', backPrompt: 'b', globalUc: 'u' });
    const back = wf.presetFromJSON(JSON.parse(JSON.stringify(preset.toJSON())));
    expect(back).toMatchObject({ frontPrompt: 'f', backPrompt: 'b', globalUc: 'u' });
  });
});

describe('조합 전개 공용 함수 — 생성 경로(createSDPrompts)와 같은 결과', () => {
  const genPreset = { frontPrompt: 'f1, |, f2', backPrompt: 'bk', uc: 'guc', characterPrompts: [] };
  const genShared = { type: 'SDImageGen', characterPrompts: [] };
  const source = comboSourceFromGenSetup('SDImageGen', genPreset, genShared);

  test('조합 수·문자열(`|` 교차·추가 프롬프트·조각 풀기)이 이미지생성 씬과 같다', async () => {
    const scene = inpaintScene({ comboMode: 'shared' });
    scene.slots = [
      [piece('a'), piece('b')],
      [piece('x'), piece('<lib.p>')],
    ];
    scene.preset = { characterPrompts: [] };
    const combos = await expandVariantCombos(session, scene, source);
    const general = await createSDPrompts(session, genPreset, genShared, {
      name: 'g',
      type: 'scene',
      slots: scene.slots,
    } as any);
    expect(combos).toHaveLength(4);
    expect(lowered(combos.map((c) => c.prompt))).toEqual(lowered(general));
    // f1 → (|) 중간 a, x → 나머지 상위 f2·추가 ex → 하위
    expect(lowered([combos[0].prompt])[0]).toBe('f1, a, x, f2, ex, bk');
    expect(lowered([combos[1].prompt])[0]).toBe('f1, a, pp1, pp2, f2, ex, bk');
    expect(source.globalUc).toBe('guc');
  });

  test('활성 조각이 없는 열이 있으면 0종(예전 미러는 빈 문자열로 1종)', async () => {
    const scene = inpaintScene({ workflowType: 'SDMirror' });
    scene.slots = [[piece('a')], [piece('z', { enabled: false })]];
    scene.preset = {};
    expect(await expandVariantCombos(session, scene, source)).toHaveLength(0);
  });

  test('조각 캐릭터 프롬프트가 같은 번호 캐릭터에 합쳐지고, 꺼진 캐릭터는 빠진다', async () => {
    const scene = inpaintScene({ comboMode: 'shared' });
    scene.slots = [[piece('a', { chars: ['cx', 'cy'] }), piece('b')]];
    scene.preset = {
      characterPrompts: [
        { id: 'c0', prompt: 'base0', uc: 'u0', position: { x: 0.5, y: 0.5 }, enabled: true },
        { id: 'c1', prompt: 'base1', uc: '', position: { x: 0.1, y: 0.1 }, enabled: false },
      ],
    };
    const combos = await expandVariantCombos(session, scene, source);
    expect(combos).toHaveLength(2);
    expect(combos[0].characterPrompts.map((c) => c.id)).toEqual(['c0']);
    expect(lowered(combos[0].characterPrompts.map((c) => c.prompt))).toEqual(['base0, cx']);
    expect(lowered(combos[1].characterPrompts.map((c) => c.prompt))).toEqual(['base0']);
    expect(combos[0].characterPrompts[0].uc).toBe('u0');
  });

  test('슬롯이 없으면 preset.prompt 한 조각(옛 미러 — 조합 에디터를 연 적 없음)', async () => {
    const scene = inpaintScene({ workflowType: 'SDMirror' });
    scene.preset = { prompt: 'mid' };
    const combos = await expandVariantCombos(session, scene, source);
    expect(lowered(combos.map((c) => c.prompt))).toEqual(['f1, mid, f2, ex, bk']);
  });

  test('「복사 시점 1회 복제」 고정값으로 전개해도 실시간(이지 모드 포함)과 같은 결과', async () => {
    lookupTag.mockImplementation(async (w: string) => (w === 'miku' ? { category: 4 } : null));
    const easyPreset = { frontPrompt: 'masterpiece, |, detail', backPrompt: 'bk', uc: 'puc' };
    const easyShared = {
      type: 'SDImageGenEasy',
      characterPrompt: 'smile, 1girl, miku',
      backgroundPrompt: 'bg',
      uc: 'suc',
    };
    const live = comboSourceFromGenSetup('SDImageGenEasy', easyPreset, easyShared);
    const fields = await snapshotComboFields('SDImageGenEasy', easyPreset, easyShared, 'ex');
    expect(fields.globalUc).toBe('suc, puc');
    const snap = comboSourceFromSnapshot(fields);
    const scene = inpaintScene({ comboMode: 'snapshot' });
    scene.slots = [[piece('a, |, b'), piece('c')]];
    scene.preset = { characterPrompts: [] };
    const a = await expandVariantCombos(session, scene, live);
    const b = await expandVariantCombos(session, scene, snap);
    expect(lowered(b.map((c) => c.prompt))).toEqual(lowered(a.map((c) => c.prompt)));
    expect(snap.globalUc).toBe(live.globalUc);
    // 이지 모드 재배열: 인원·캐릭터 태그가 앞으로
    expect(fields.frontPrompt.startsWith('1girl, miku, masterpiece')).toBe(true);
  });
});

describe('핸들러 — 전개 결과 사용·단일 프롬프트 조각 해석', () => {
  const basePreset = () => {
    const preset = new WFWorkFlow(SDI2IDef).buildPreset();
    preset.image = 'RAWBASE64';
    preset.uc = 'scene-uc';
    return preset;
  };

  test('조합 전개 결과가 실리면 그 프롬프트·캐릭터·(전역+씬) 네거티브로 잡을 만든다', async () => {
    const scene = inpaintScene({ comboMode: 'shared' });
    const combo = {
      prompt: { type: 'text' as const, text: 'combo-prompt' },
      characterPrompts: [
        { id: 'c0', prompt: { type: 'text' as const, text: 'cp' }, uc: '', position: { x: 0.5, y: 0.5 } },
      ],
    };
    const preset = comboHandlerPreset(basePreset(), combo, 'global-uc');
    expect(comboExpandedOf(preset)).toBe(combo);
    await SDI2IDef.handler(session, scene, combo.prompt, [], preset, undefined, 1);
    const job = (addTask.mock.calls[0] as any[])[0].job;
    expect(job.prompt).toBe(combo.prompt);
    expect(job.uc).toBe('global-uc, scene-uc');
    expect(job.characterPrompts).toHaveLength(1);
    expect(job.characterPrompts[0].prompt).toBe(combo.characterPrompts[0].prompt);
  });

  test('단일 프롬프트 I2I 도 <조각> 을 푼다(예전엔 글자 그대로), 조각이 없으면 예전과 같은 글자 노드', async () => {
    const scene = inpaintScene({});
    const preset = basePreset();
    preset.prompt = 'a, <lib.p>';
    await SDI2IDef.handler(session, scene, { type: 'text', text: '' }, [], preset, undefined, 1);
    expect(lowerPromptNode((addTask.mock.calls[0] as any[])[0].job.prompt)).toBe(
      lowerPromptNode({ type: 'group', children: ['a', 'pp1', 'pp2'].map((t) => ({ type: 'text', text: t })) } as any),
    );
    preset.prompt = 'a, b';
    await SDI2IDef.handler(session, scene, { type: 'text', text: '' }, [], preset, undefined, 1);
    expect((addTask.mock.calls[1] as any[])[0].job.prompt).toEqual({ type: 'text', text: 'a, b' });
  });

  test('이미지 변형 메뉴(임시 이미지생성 씬)의 메타데이터 프롬프트는 글자 그대로', async () => {
    const preset = basePreset();
    preset.prompt = 'a, <lib.p>';
    await SDI2IDef.handler(session, { type: 'scene', name: 's' } as any, { type: 'text', text: '' }, [], preset, undefined, 1);
    expect((addTask.mock.calls[0] as any[])[0].job.prompt).toEqual({ type: 'text', text: 'a, <lib.p>' });
  });

  test('resolvePresetPromptNode — 조각 없으면 글자 노드, 있으면 parseWord 그룹', () => {
    expect(resolvePresetPromptNode('x, y', session, undefined)).toEqual({ type: 'text', text: 'x, y' });
    const node = resolvePresetPromptNode('x, <lib.p>', session, undefined);
    expect(node.type).toBe('group');
    expect(words(lowerPromptNode(node))).toEqual(['x', 'pp1', 'pp2']);
  });

  test('미러 핸들러는 전개 결과가 있으면 상위·하위·전역 네거티브를 다시 붙이지 않는다', async () => {
    const mirrorSession: any = {
      ...session,
      selectedWorkflow: { workflowType: 'SDImageGen' },
      getCommonSetup: () => ['SDImageGen', { frontPrompt: 'F', backPrompt: 'B', uc: 'U' }, {}],
    };
    const preset = new WFWorkFlow(SDMirrorDef).buildPreset();
    preset.image = 'RAWBASE64';
    preset.uc = 'scene-uc';
    const combo = { prompt: { type: 'text' as const, text: 'F, mid, B' }, characterPrompts: [] };
    const scene = inpaintScene({ workflowType: 'SDMirror' });
    await SDMirrorDef.handler(
      mirrorSession, scene, combo.prompt, [], comboHandlerPreset(preset, combo, 'U'), undefined, 1,
    );
    const job = (addTask.mock.calls[0] as any[])[0].job;
    expect(job.prompt).toBe(combo.prompt);
    expect(job.uc).toBe('U, scene-uc');
    expect(job.focus).toBeUndefined();
  });
});

describe('B1 「I2I로 이미지생성 씬 복사」 조합 모드 규칙', () => {
  const job: any = {
    cfgRescale: 0.3,
    promptGuidance: 6,
    sampling: 'k_dpmpp_2m',
    noiseSchedule: 'exponential',
    prompt: { type: 'text', text: 'ignored' },
    uc: 'gen-uc, scene-uc',
    characterPrompts: [],
    useCoords: true,
  };
  const chars: any[] = [
    { id: 'c0', prompt: 'girl, <lib.p>', uc: 'u', position: { x: 0.2, y: 0.3 }, enabled: true, order: 1 },
    { id: 'c1', prompt: 'boy', uc: '', position: { x: 0.7, y: 0.3 }, enabled: false, order: 0 },
  ];

  test('shared — prompt = 첫 조합 중간, uc = 씬 네거티브만, 캐릭터는 순서 그대로(꺼진 것 포함·order 제거), 고정값 비움', () => {
    const preset = i2iComboPresetFromJob(new WFWorkFlow(SDI2IDef).buildPreset(), job, {
      middlePrompt: 'a, x',
      sceneUc: 'scene-uc',
      characterPrompts: chars,
      mode: 'shared',
      snapshot: { frontPrompt: 'F', backPrompt: 'B', globalUc: 'G' },
    });
    expect(preset.prompt).toBe('a, x');
    expect(preset.uc).toBe('scene-uc');
    expect(preset.cfgRescale).toBe(0.3);
    expect(preset.useCoords).toBe(true);
    expect(preset.characterPrompts.map((c: any) => c.id)).toEqual(['c0', 'c1']);
    expect(preset.characterPrompts[0]).not.toHaveProperty('order');
    expect(preset.characterPrompts[0].prompt).toBe('girl, <lib.p>'); // 조각은 예약 때 푼다
    expect(preset.characterPrompts[0].position).not.toBe(chars[0].position); // 위치 객체 공유 금지
    expect(preset).toMatchObject({ frontPrompt: '', backPrompt: '', globalUc: '' });
  });

  test('snapshot — 상위·하위·전역 네거티브 고정값 저장', () => {
    const preset = i2iComboPresetFromJob(new WFWorkFlow(SDI2IDef).buildPreset(), job, {
      middlePrompt: '',
      sceneUc: '',
      characterPrompts: [],
      mode: 'snapshot',
      snapshot: { frontPrompt: 'F', backPrompt: 'B', globalUc: 'G' },
    });
    expect(preset).toMatchObject({ frontPrompt: 'F', backPrompt: 'B', globalUc: 'G', uc: '' });
  });

  test('slots 깊은 복사 — 원본 씬과 조각·캐릭터란을 공유하지 않는다', () => {
    const src = new Scene();
    src.slots = [[piece('a', { chars: ['c'] })], [piece('x')]];
    const copy = inpaintScene({ comboMode: 'shared', slots: src.toJSON().slots });
    expect(copy.slots[0][0]).not.toBe(src.slots[0][0]);
    copy.slots[0][0].prompt = 'changed';
    copy.slots[0][0].characterPrompts[0] = 'changed';
    expect(src.slots[0][0].prompt).toBe('a');
    expect(src.slots[0][0].characterPrompts[0]).toBe('c');
    const cloned = cloneSlots(src.slots);
    cloned[1][0].prompt = 'y';
    expect(src.slots[1][0].prompt).toBe('x');
  });

  test('묻기 — [실시간 공유][1회 복제], 취소면 undefined', async () => {
    answers.push('snapshot');
    expect(await askComboMode()).toBe('snapshot');
    expect(pushed[0].text).toBe(I2I_BATCH_TEXT.comboModeQuestion);
    expect(pushed[0].items.map((i: any) => i.value)).toEqual(['shared', 'snapshot']);
    answers.push(undefined);
    expect(await askComboMode()).toBeUndefined();
  });
});

describe('「씬 내용 복제」 변형 씬의 조합', () => {
  const srcJSON = {
    comboMode: 'snapshot',
    slots: [[{ prompt: 'a', characterPrompts: ['c'], id: 'p1' }]],
  };

  test('조합 모드 I2I → I2I: comboMode·slots 복사(씬마다 독립)', () => {
    const t1 = inpaintScene({});
    const t2 = inpaintScene({});
    copyComboContent(srcJSON, t1);
    copyComboContent(srcJSON, t2);
    expect(t1.comboMode).toBe('snapshot');
    expect(t1.slots[0][0].prompt).toBe('a');
    t1.slots[0][0].prompt = 'b';
    expect(t2.slots[0][0].prompt).toBe('a');
  });

  test('미러 → 미러: slots 복사, 조합을 쓰지 않는 결과(인페인트)는 slots 를 비운다', () => {
    const mirror = inpaintScene({ workflowType: 'SDMirror' });
    copyComboContent({ slots: srcJSON.slots }, mirror);
    expect(mirror.slots).toHaveLength(1);
    expect(mirror.comboMode).toBeUndefined();
    const inpaint = inpaintScene({ workflowType: 'SDInpaint', slots: srcJSON.slots });
    copyComboContent({ comboMode: 'shared', slots: srcJSON.slots }, inpaint);
    expect(inpaint.slots).toHaveLength(0);
  });
});

describe('누락 조각 검사 — 변형 씬', () => {
  test('미러·조합 모드 I2I 는 slots(와 고정 상위·하위)를, 단일 I2I 는 preset.prompt 만 본다', () => {
    const mirror = inpaintScene({ workflowType: 'SDMirror' });
    mirror.slots = [[piece('<lib.m1>')]];
    mirror.preset = { prompt: '' };
    expect(promptService.findMissingPieces(session, mirror)).toEqual([{ library: 'lib', piece: 'm1' }]);

    const snap = inpaintScene({ comboMode: 'snapshot' });
    snap.slots = [[piece('<lib.p>')]];
    snap.preset = { prompt: '', frontPrompt: '<lib.front>', backPrompt: '' };
    expect(promptService.findMissingPieces(session, snap)).toEqual([{ library: 'lib', piece: 'front' }]);

    const single = inpaintScene({});
    single.slots = [[piece('<lib.unused>')]]; // 내용 복제 등으로 남은 슬롯은 쓰이지 않는다
    single.preset = { prompt: '<nolib.x>' };
    expect(promptService.findMissingPieces(session, single)).toEqual([{ library: 'nolib', piece: 'x' }]);
  });
});

describe('결과 보기 「예약 추가」', () => {
  test('변형 씬은 queueScene(미러 합성·조합 전개 관문)을 거친다', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../componenets/ResultViewer.tsx'),
      'utf8',
    );
    expect(src).not.toMatch(/queueI2IWorkflow\(/);
    expect(src).toMatch(/await queueScene\(curSession!, scene, appState\.samples\)/);
  });
});
