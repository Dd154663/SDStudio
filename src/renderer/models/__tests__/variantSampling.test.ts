// 변형 씬 생성의 샘플링·모델 설정 = 메인 사전 세팅(2026-10-11 사용자 결정, SPEC_GUIDE §7-5).
// - 순수 함수 applyMainSampling: 메인 값 적용·씬 고유 필드 보존·입력 불변·폴백
// - readMainSampling/resolveVariantSampling: 읽기 실패 사유별 폴백 + console.warn 한 줄
// - 핸들러(I2I·인페인트·미러)와 예약 경로(queueI2IWorkflow 단일·조합 shared/snapshot·queueMirrorWorkflow·이미지 변형 메뉴의
//   임시 씬)가 모두 메인 값으로 잡을 만든다.
const addTask = jest.fn(async (_param: any, _samples: number) => {});
const fetchVibeImage = jest.fn(async () => 'data:image/png;base64,FETCHED');
let realPromptService: any;

jest.mock('..', () => {
  const defs = () => {
    const sd = jest.requireActual('../workflows/SDWorkFlow');
    return [sd.SDInpaintDef, sd.SDI2IDef, sd.SDMirrorDef];
  };
  return {
    backend: { getConfig: jest.fn(), lookupTag: jest.fn(async () => null) },
    imageService: {
      fetchVibeImage: (...a: any[]) => (fetchVibeImage as any)(...a),
      storeVibeImage: jest.fn(async () => 'stored.png'),
      getOutputDir: jest.fn(() => 'inpaints/project/scene'),
    },
    isMobile: false,
    localAIService: {},
    globalPieceService: { library: new Map() },
    sessionService: {},
    taskQueueService: { addTask: (...a: any[]) => (addTask as any)(...a) },
    workFlowService: {
      getDef: (type: string) => defs().find((d: any) => d.type === type),
      buildPreset: (type: string) => {
        const { WFWorkFlow } = jest.requireActual('../workflows/WorkFlow');
        return new WFWorkFlow(defs().find((d: any) => d.type === type)).buildPreset();
      },
    },
    get promptService() {
      if (!realPromptService) {
        const { PromptService } = jest.requireActual('../PromptService');
        realPromptService = new PromptService();
      }
      return realPromptService;
    },
  };
});
jest.mock('../AppService', () => ({ appState: { pushMessage: jest.fn() } }));
jest.mock('../PersistenceService', () => ({
  persistService: { write: jest.fn(async () => {}) },
}));
jest.mock('../ImageService', () => ({
  dataUriToBase64: jest.fn((d: string) => d.split(',')[1]),
}));
jest.mock('../../componenets/BrushTool', () => ({ getImageDimensions: jest.fn() }));

import { MODEL_SAMPLING_FIELDS } from '../modelSamplingProfiles';
import {
  applyMainSampling,
  mainSamplingSummary,
  readMainSampling,
  resolveVariantSampling,
  VARIANT_SAMPLING_KEYS,
  VARIANT_SAMPLING_TEXT,
} from '../variantSampling';
import { WFIGroup, WFIInlineInput, WFIStack, WFWorkFlow } from '../workflows/WorkFlow';
import {
  createI2IPreset,
  SDI2IDef,
  SDImageGenDef,
  SDInpaintDef,
  SDMirrorDef,
} from '../workflows/SDWorkFlow';
import { queueI2IWorkflow, queueMirrorWorkflow } from '../TaskQueueService';
import { InpaintScene, PromptPiece } from '../types';

// 메인 사전 세팅 — 기본값(28/5/0/k_euler_ancestral/karras)과 모두 다른 값
const MAIN_PRESET = {
  steps: 23,
  promptGuidance: 4.5,
  cfgRescale: 0.2,
  sampling: 'k_dpmpp_2m',
  noiseSchedule: 'exponential',
  legacyPromptConditioning: true,
  varietyPlus: true,
  deliberateEulerAncestralBug: true,
  frontPrompt: 'MAINFRONT',
  backPrompt: 'MAINBACK',
  uc: 'MAINUC',
};
const MAIN_SHARED = { normalizeStrength: false };
const MAIN_EXPECT = {
  steps: 23,
  promptGuidance: 4.5,
  cfgRescale: 0.2,
  sampling: 'k_dpmpp_2m',
  noiseSchedule: 'exponential',
  legacyPromptConditioning: true,
  varietyPlus: true,
  deliberateEulerAncestralBug: true,
  normalizeStrength: false,
};
// 씬 프리셋에 넣는 값(생성 시점 스냅샷 — 이제 생성에 쓰이지 않는다)
const SCENE_SAMPLING = {
  steps: 28,
  promptGuidance: 6,
  cfgRescale: 0.6,
  sampling: 'k_euler',
  noiseSchedule: 'karras',
  legacyPromptConditioning: false,
  varietyPlus: false,
  deliberateEulerAncestralBug: false,
  normalizeStrength: true,
};

const mainSession = (workflowType = 'SDImageGen', extra: any = {}) =>
  ({
    name: 'project',
    extraPrompt: '',
    library: new Map(),
    mirrorImage: 'src.png',
    mirrorMode: 'blank',
    selectedWorkflow: { workflowType, presetName: 'main' },
    getCommonSetup: (flow: any) => [flow.workflowType, { ...MAIN_PRESET }, { ...MAIN_SHARED }, undefined],
    ...extra,
  }) as any;

const samplingOf = (job: any) =>
  Object.fromEntries(VARIANT_SAMPLING_KEYS.map((k) => [k, job[k]]));
const jobs = () => addTask.mock.calls.map((c: any[]) => c[0].job);

let warnSpy: jest.SpyInstance;
beforeEach(() => {
  addTask.mockClear();
  fetchVibeImage.mockClear();
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('필드 목록 단일 출처', () => {
  test('VARIANT_SAMPLING_KEYS = 계열별 프로필 필드 + normalizeStrength', () => {
    expect([...VARIANT_SAMPLING_KEYS]).toEqual([...MODEL_SAMPLING_FIELDS, 'normalizeStrength']);
  });

  test('메인 편집기 「샘플링/모델 설정」 그룹의 필드와 같은 집합', () => {
    const group = (SDImageGenDef.editor as WFIStack).inputs.find(
      (x) => x.type === 'group',
    ) as WFIGroup;
    const fields = group.inputs
      .filter((x) => x.type === 'inline')
      .map((x) => (x as WFIInlineInput).field);
    expect([...fields].sort()).toEqual([...VARIANT_SAMPLING_KEYS].sort());
  });

  test('변형 편집 칸 5종에는 샘플링 그룹이 없고 안내 요소가 있다', () => {
    const { SDInpaintComboUI, SDI2IComboUI } = jest.requireActual('../workflows/SDWorkFlow');
    for (const stack of [SDInpaintDef.editor, SDI2IDef.editor, SDMirrorDef.editor, SDInpaintComboUI, SDI2IComboUI]) {
      const inputs = (stack as WFIStack).inputs;
      expect(inputs.some((x) => x.type === 'group')).toBe(false);
      const notice = inputs.find((x) => x.type === 'mainSamplingNotice') as any;
      expect(notice).toMatchObject({ id: 'main-sampling-notice', label: VARIANT_SAMPLING_TEXT.notice });
      // 그룹 안에 있던 필드가 편집 칸 최상위에도 없다
      const topFields = inputs.filter((x) => x.type === 'inline').map((x) => (x as WFIInlineInput).field);
      for (const k of VARIANT_SAMPLING_KEYS) expect(topFields).not.toContain(k);
    }
  });
});

describe('applyMainSampling (순수)', () => {
  const scenePreset = () => ({
    ...SCENE_SAMPLING,
    image: 'img.png',
    mask: 'mask.png',
    strength: 0.7,
    noise: 0.1,
    prompt: 'scene prompt',
    uc: 'scene uc',
    characterPrompts: [{ prompt: 'girl', uc: '', enabled: true, position: { x: 0.1, y: 0.2 } }],
    focusEnabled: true,
    focusX: 8,
    focusY: 16,
    focusW: 64,
    focusH: 64,
    focusContext: 48,
    vibes: [{ path: 'v.png' }],
    characterReferences: [{ path: 'r.png' }],
    useCoords: true,
    seed: 1234,
  });

  test('메인 값 적용 + 씬 고유 필드 보존 + 입력 불변', () => {
    const scene = scenePreset();
    const before = JSON.parse(JSON.stringify(scene));
    const out = applyMainSampling(scene, { preset: MAIN_PRESET, shared: MAIN_SHARED });
    expect(samplingOf(out)).toEqual(MAIN_EXPECT);
    const { ...rest } = before;
    for (const k of VARIANT_SAMPLING_KEYS) delete (rest as any)[k];
    expect(out).toMatchObject(rest);
    // 메인의 프롬프트·네거티브는 옮기지 않는다
    expect(out.prompt).toBe('scene prompt');
    expect(out.uc).toBe('scene uc');
    expect(scene).toEqual(before);
    expect(out).not.toBe(scene);
  });

  test('main 이 없으면 씬 프리셋 그대로(같은 참조)', () => {
    const scene = scenePreset();
    expect(applyMainSampling(scene, undefined)).toBe(scene);
    expect(applyMainSampling(scene, { preset: undefined })).toBe(scene);
  });

  test('메인 쪽에 없는 필드(undefined·null)만 씬 값 유지, false·0 은 메인 값', () => {
    const out = applyMainSampling(scenePreset(), {
      preset: { steps: undefined, promptGuidance: null, cfgRescale: 0, varietyPlus: false },
      shared: undefined,
    });
    expect(out.steps).toBe(28);
    expect(out.promptGuidance).toBe(6);
    expect(out.cfgRescale).toBe(0);
    expect(out.varietyPlus).toBe(false);
    expect(out.normalizeStrength).toBe(true);
  });
});

describe('readMainSampling·resolveVariantSampling 폴백', () => {
  const scene = () => ({ ...SCENE_SAMPLING, image: 'x' });
  const cases: [string, any][] = [
    ['세션 없음', undefined],
    ['선택 워크플로우 없음', { selectedWorkflow: undefined, getCommonSetup: () => [] }],
    ['이미지 생성 계열 아님', mainSession('SDI2I')],
    [
      'getCommonSetup 예외',
      mainSession('SDImageGen', { getCommonSetup: () => { throw new Error('boom'); } }),
    ],
    ['사전 세팅 없음', mainSession('SDImageGen', { getCommonSetup: () => ['SDImageGen', undefined, {}, undefined] })],
  ];
  test.each(cases)('%s → 씬 값 + console.warn 한 줄', (_n, session) => {
    expect(readMainSampling(session).ok).toBe(false);
    const preset = scene();
    expect(resolveVariantSampling(session, preset)).toBe(preset);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('메인 사전 세팅을 읽지 못해');
  });

  test('SDImageGen·SDImageGenEasy 는 메인 값, 경고 없음', () => {
    for (const wf of ['SDImageGen', 'SDImageGenEasy']) {
      expect(samplingOf(resolveVariantSampling(mainSession(wf), scene()))).toEqual(MAIN_EXPECT);
    }
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('요약 문구 — 스텝·가이던스·CFG·샘플러', () => {
    expect(mainSamplingSummary(MAIN_PRESET)).toBe('스텝 23 · 가이던스 4.5 · CFG 0.2 · 샘플러 k_dpmpp_2m');
    expect(mainSamplingSummary({ steps: 28, promptGuidance: 5.000000001, cfgRescale: 0.30000000000000004 })).toBe(
      '스텝 28 · 가이던스 5 · CFG 0.3 · 샘플러 -',
    );
  });
});

describe('핸들러 — 잡의 샘플링 = 메인 사전 세팅', () => {
  const inpaintScene = { name: 'scene', type: 'inpaint' } as any;

  test('I2I: 메인 값, 씬 고유(이미지·강도·노이즈·프롬프트·네거티브·캐릭터·좌표) 보존, 씬 프리셋 불변', async () => {
    const preset = new WFWorkFlow(SDI2IDef).buildPreset();
    Object.assign(preset, SCENE_SAMPLING, {
      image: 'img.png',
      strength: 0.55,
      noise: 0.15,
      prompt: 'p1',
      uc: 'u1',
      characterPrompts: [{ prompt: 'c1', uc: '', enabled: true, position: { x: 0.3, y: 0.5 } }],
      useCoords: true,
    });
    await SDI2IDef.handler(mainSession(), inpaintScene, { type: 'text', text: '' }, [], preset, undefined, 1);
    const job = jobs()[0];
    expect(samplingOf(job)).toEqual(MAIN_EXPECT);
    expect(job).toMatchObject({
      type: 'sd_i2i',
      image: 'FETCHED',
      strength: 0.55,
      noise: 0.15,
      prompt: { type: 'text', text: 'p1' },
      uc: 'u1',
      useCoords: true,
    });
    expect(job.characterPrompts[0]).toMatchObject({ prompt: { type: 'text', text: 'c1' }, position: { x: 0.3, y: 0.5 } });
    // 저장 데이터(씬 프리셋) 무변경
    expect(preset).toMatchObject(SCENE_SAMPLING);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('인페인트: 마스크·Focused·강도 보존, 바이브 강도 정규화는 메인 shared', async () => {
    const preset = new WFWorkFlow(SDInpaintDef).buildPreset();
    Object.assign(preset, SCENE_SAMPLING, {
      image: 'RAW',
      mask: 'mask.png',
      strength: 0.8,
      focusEnabled: true,
      focusX: 112,
      focusY: 304,
      focusW: 600,
      focusH: 600,
    });
    await SDInpaintDef.handler(mainSession(), inpaintScene, { type: 'text', text: '' }, [], preset, undefined, 1);
    const job = jobs()[0];
    expect(samplingOf(job)).toEqual(MAIN_EXPECT);
    expect(job).toMatchObject({ type: 'sd_inpaint', image: 'RAW', mask: 'FETCHED', strength: 0.8 });
    expect(job.focus).toEqual({ x: 112, y: 304, w: 600, h: 600, context: 48 });
  });

  test('미러(직접 호출 경로): 메인 값', async () => {
    const preset = new WFWorkFlow(SDMirrorDef).buildPreset();
    Object.assign(preset, SCENE_SAMPLING, { image: 'RAW', mask: '', prompt: 'mid' });
    await SDMirrorDef.handler(
      mainSession(), { ...inpaintScene, workflowType: 'SDMirror' }, { type: 'text', text: '' }, [], preset, undefined, 1,
    );
    expect(samplingOf(jobs()[0])).toEqual(MAIN_EXPECT);
  });

  test('메인을 못 읽으면 씬 프리셋 값 + 경고', async () => {
    const preset = new WFWorkFlow(SDI2IDef).buildPreset();
    Object.assign(preset, SCENE_SAMPLING, { image: 'RAW' });
    await SDI2IDef.handler(
      { name: 'project', selectedWorkflow: undefined } as any, inpaintScene, { type: 'text', text: '' }, [], preset, undefined, 1,
    );
    expect(samplingOf(jobs()[0])).toEqual(SCENE_SAMPLING);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

describe('예약 경로 — 단일·조합 모드(shared/snapshot)·미러·이미지 변형 메뉴', () => {
  const piece = (prompt: string) =>
    PromptPiece.fromJSON({ prompt, characterPrompts: [], id: prompt, enabled: true } as any);
  const variant = (workflowType: string, json: any = {}) => {
    const scene = InpaintScene.fromJSON({ type: 'inpaint', name: 'v', workflowType, ...json })!;
    scene.preset = new WFWorkFlow(
      [SDI2IDef, SDInpaintDef, SDMirrorDef].find((d) => d.type === workflowType)!,
    ).buildPreset();
    Object.assign(scene.preset, SCENE_SAMPLING, { image: 'RAW', mask: '' });
    return scene;
  };

  test('I2I 단일 프롬프트', async () => {
    const scene = variant('SDI2I');
    expect(await queueI2IWorkflow(mainSession(), 'SDI2I', scene.preset, scene, 1)).toBe(1);
    expect(samplingOf(jobs()[0])).toEqual(MAIN_EXPECT);
    expect(scene.preset).toMatchObject(SCENE_SAMPLING);
  });

  test.each([
    ['SDI2I', 'shared'],
    ['SDI2I', 'snapshot'],
    ['SDInpaint', 'shared'],
    ['SDInpaint', 'snapshot'],
  ])('%s 조합 모드 %s: 조합마다 메인 값', async (wf, mode) => {
    const scene = variant(wf, { comboMode: mode });
    scene.slots = [[piece('a'), piece('b')], [piece('x'), piece('y')]];
    if (mode === 'snapshot') Object.assign(scene.preset, { frontPrompt: 'F', backPrompt: 'B', globalUc: 'G' });
    expect(await queueI2IWorkflow(mainSession(), wf, scene.preset, scene, 1)).toBe(4);
    expect(jobs()).toHaveLength(4);
    for (const job of jobs()) expect(samplingOf(job)).toEqual(MAIN_EXPECT);
    // 프롬프트 출처는 조합 모드 규칙 그대로(shared = 메인 상위, snapshot = 고정값)
    const first = JSON.stringify(jobs()[0].prompt);
    expect(first).toContain(mode === 'shared' ? 'MAINFRONT' : 'F');
    expect(scene.preset).toMatchObject(SCENE_SAMPLING);
  });

  test('미러 예약(queueMirrorWorkflow)', async () => {
    const scene = variant('SDMirror');
    scene.slots = [[piece('a'), piece('b')]];
    expect(await queueMirrorWorkflow(mainSession(), 'SDMirror', scene.preset, scene, 1)).toBe(2);
    for (const job of jobs()) expect(samplingOf(job)).toEqual(MAIN_EXPECT);
  });

  test('이미지 변형 메뉴(OneTimeFlows queueI2I 와 같은 경로) — 메타데이터에서 옮긴 가이던스·CFG 대신 메인 값', async () => {
    // 임시 프리셋 = createI2IPreset(이미지 메타 잡) + 이미지생성 씬 → queueI2IWorkflow 단일 경로
    const preset = createI2IPreset(
      { promptGuidance: 6, cfgRescale: 0.6, sampling: 'k_euler', prompt: 'meta prompt' } as any,
      'RAW',
    );
    Object.assign(preset, { strength: 0.4, noise: 0 });
    const imageGenScene = { type: 'scene', name: 's', slots: [] } as any;
    expect(await queueI2IWorkflow(mainSession(), 'SDI2I', preset, imageGenScene, 1)).toBe(1);
    const job = jobs()[0];
    expect(samplingOf(job)).toEqual(MAIN_EXPECT);
    expect(job).toMatchObject({ prompt: { type: 'text', text: 'meta prompt' }, strength: 0.4 });
  });
});
