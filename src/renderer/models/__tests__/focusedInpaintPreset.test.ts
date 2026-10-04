/**
 * Focused inpainting 프리셋 키(2026-10-04 S1) — 기본값·기존 씬 JSON 역직렬화 안전·I2I/미러에는 키 없음·
 * 잡에 focus 싣기(켜짐+사각형일 때만)·미러 핸들러는 끔.
 */
const addTask = jest.fn(async (_param: any, _samples: number) => {});

jest.mock('..', () => ({
  workFlowService: { buildPreset: jest.fn() },
  imageService: {
    fetchVibeImage: jest.fn(async () => 'data:image/png;base64,FETCHED'),
    getOutputDir: jest.fn(() => 'inpaints/project/scene'),
  },
  promptService: { parseWord: jest.fn() },
  taskQueueService: { addTask },
}));
jest.mock('../ImageService', () => ({
  dataUriToBase64: jest.fn((d: string) => d.split(',')[1]),
}));

import { WFWorkFlow } from '../workflows/WorkFlow';
import { SDInpaintDef, SDI2IDef, SDMirrorDef } from '../workflows/SDWorkFlow';

const FOCUS_KEYS = ['focusEnabled', 'focusX', 'focusY', 'focusW', 'focusH', 'focusContext'];

test('인페인트 프리셋 기본값: 꺼짐·사각형 없음·context 48', () => {
  const preset = new WFWorkFlow(SDInpaintDef).buildPreset();
  expect(preset).toMatchObject({
    focusEnabled: false,
    focusX: null,
    focusY: null,
    focusW: null,
    focusH: null,
    focusContext: 48,
  });
});

test('Focused 키가 없는 기존 씬 JSON 은 기본값으로 읽힌다', () => {
  const wf = new WFWorkFlow(SDInpaintDef);
  const old = { type: 'SDInpaint', prompt: 'p', image: 'a.png', mask: 'm.png', originalImage: true };
  const preset = wf.presetFromJSON(old);
  expect(preset.focusEnabled).toBe(false);
  expect(preset.focusX).toBeNull();
  expect(preset.focusContext).toBe(48);
  expect(preset.prompt).toBe('p');
});

test('저장한 Focused 값은 왕복 보존된다', () => {
  const wf = new WFWorkFlow(SDInpaintDef);
  const preset = wf.buildPreset();
  Object.assign(preset, { focusEnabled: true, focusX: 112, focusY: 304, focusW: 600, focusH: 600, focusContext: 64 });
  const json = preset.toJSON();
  const back = wf.presetFromJSON(JSON.parse(JSON.stringify(json)));
  for (const key of FOCUS_KEYS) expect(back[key]).toEqual(preset[key]);
});

test('I2I·미러 프리셋에는 Focused 키가 없다', () => {
  for (const def of [SDI2IDef, SDMirrorDef]) {
    const json = new WFWorkFlow(def).buildPreset().toJSON();
    for (const key of FOCUS_KEYS) expect(json).not.toHaveProperty(key);
  }
});

describe('잡 생성', () => {
  const session = { name: 'project', selectedWorkflow: undefined } as any;
  const scene = { name: 'scene', type: 'inpaint' } as any;
  const base = () => {
    const preset = new WFWorkFlow(SDInpaintDef).buildPreset();
    Object.assign(preset, { image: 'RAWIMAGE', mask: '' });
    return preset;
  };

  beforeEach(() => addTask.mockClear());

  test('켜짐 + 사각형이면 잡에 focus 를 싣는다', async () => {
    const preset = base();
    Object.assign(preset, { focusEnabled: true, focusX: 112, focusY: 304, focusW: 600, focusH: 600 });
    await SDInpaintDef.handler(session, scene, {} as any, [], preset, {}, 1);
    expect(addTask.mock.calls[0][0].job.focus).toEqual({ x: 112, y: 304, w: 600, h: 600, context: 48 });
  });

  test('꺼짐이거나 사각형이 비면 focus 없음', async () => {
    const preset = base();
    Object.assign(preset, { focusEnabled: false, focusX: 112, focusY: 304, focusW: 600, focusH: 600 });
    await SDInpaintDef.handler(session, scene, {} as any, [], preset, {}, 1);
    const preset2 = base();
    Object.assign(preset2, { focusEnabled: true });
    await SDInpaintDef.handler(session, scene, {} as any, [], preset2, {}, 1);
    expect(addTask.mock.calls[0][0].job).not.toHaveProperty('focus');
    expect(addTask.mock.calls[1][0].job).not.toHaveProperty('focus');
  });

  test('미러 핸들러는 값이 있어도 Focused 를 끈다', async () => {
    const preset = new WFWorkFlow(SDMirrorDef).buildPreset();
    Object.assign(preset, {
      image: 'RAWIMAGE',
      focusEnabled: true,
      focusX: 0,
      focusY: 0,
      focusW: 64,
      focusH: 64,
    });
    await SDMirrorDef.handler(session, { ...scene, workflowType: 'SDMirror' }, {} as any, [], preset, {}, 1);
    expect(addTask.mock.calls[0][0].job).not.toHaveProperty('focus');
  });
});
