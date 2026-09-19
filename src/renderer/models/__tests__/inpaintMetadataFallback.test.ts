jest.mock('..', () => ({ workFlowService: { buildPreset: jest.fn() } }));
jest.mock('../ImageService', () => ({ dataUriToBase64: jest.fn() }));

import { workFlowService } from '..';
import { WFWorkFlow } from '../workflows/WorkFlow';
import {
  SDInpaintDef,
  SDI2IDef,
  SDMirrorDef,
  createInpaintPreset,
  createI2IPreset,
  createMirrorPreset,
} from '../workflows/SDWorkFlow';

const DEFS: Record<string, any> = {
  SDInpaint: SDInpaintDef,
  SDI2I: SDI2IDef,
  SDMirror: SDMirrorDef,
};
const build = (type: string) => new WFWorkFlow(DEFS[type]).buildPreset();

// NAI Director Tools(컬러라이즈 등) 출력 Comment 실측: {req_type, prompt, defry} → parseCommentToJob 결과
const DIRECTOR_TOOL_JOB = { prompt: 'annoyed', uc: undefined, sampling: undefined, promptGuidance: undefined } as any;
const PRESERVED_KEYS = ['uc', 'sampling', 'noiseSchedule', 'cfgRescale', 'promptGuidance', 'characterPrompts', 'useCoords'];

beforeEach(() => {
  (workFlowService.buildPreset as jest.Mock).mockImplementation((type: string) => build(type));
});

test('메타데이터 없는 이미지는 수동 생성과 동일한 기본값으로 시작한다', () => {
  const defaults = build('SDInpaint');
  expect(createInpaintPreset(undefined, 'image.png').toJSON()).toEqual({ ...defaults.toJSON(), image: 'image.png' });
});

test('부분 메타데이터의 누락 항목은 기본 인페인트 설정을 유지한다', () => {
  const defaults = build('SDInpaint');
  const preset = createInpaintPreset({ prompt: 'colorize test', uc: undefined } as any);
  expect(preset.prompt).toBe('colorize test');
  for (const key of PRESERVED_KEYS) {
    expect(preset[key]).toEqual(defaults[key]);
  }
});

test('정상 메타데이터의 명시적 빈 문자열/0/false는 보존한다', () => {
  const preset = createInpaintPreset({ prompt: '', uc: '', cfgRescale: 0, promptGuidance: 0, useCoords: false } as any, 'image.png', 'mask.png');
  expect(preset).toMatchObject({ prompt: '', uc: '', cfgRescale: 0, promptGuidance: 0, useCoords: false, image: 'image.png', mask: 'mask.png' });
});

test.each([
  ['SDI2I', createI2IPreset],
  ['SDMirror', createMirrorPreset],
])('%s 프리셋 생성도 Director Tools 부분 메타데이터에서 기본값을 유지한다', (type, create) => {
  const defaults = build(type as string);
  const preset = (create as any)(DIRECTOR_TOOL_JOB, 'image.png');
  expect(preset.prompt).toBe('annoyed');
  expect(preset.image).toBe('image.png');
  expect(typeof preset.uc).toBe('string');
  for (const key of PRESERVED_KEYS) {
    expect(preset[key]).toEqual(defaults[key]);
  }
});

test('i2i/미러 프리셋 생성은 메타데이터가 없어도 기본값으로 시작한다', () => {
  expect(createI2IPreset(undefined).toJSON()).toEqual(build('SDI2I').toJSON());
  expect(createMirrorPreset(undefined).toJSON()).toEqual(build('SDMirror').toJSON());
});

test('저장 JSON에 없는 키는 역직렬화 시 기본값으로 자가치유된다', () => {
  // 수정 전 빌드가 저장한 씬: 부분 메타데이터로 uc/sampling 등이 undefined → JSON에서 키 자체가 탈락
  const wf = new WFWorkFlow(SDInpaintDef);
  const defaults = wf.buildPreset();
  const healed = wf.presetFromJSON({ type: 'SDInpaint', prompt: 'annoyed', image: 'image.png' });
  expect(healed.prompt).toBe('annoyed');
  expect(healed.image).toBe('image.png');
  expect(typeof healed.uc).toBe('string');
  for (const key of PRESERVED_KEYS) {
    expect(healed[key]).toEqual(defaults[key]);
  }
});

test('역직렬화는 명시적 값(빈 문자열/0/false/null)을 기본값으로 바꾸지 않는다', () => {
  const wf = new WFWorkFlow(SDInpaintDef);
  const preset = wf.presetFromJSON({ type: 'SDInpaint', prompt: '', uc: '', cfgRescale: 0, useCoords: false, seed: null, steps: 12 });
  expect(preset).toMatchObject({ prompt: '', uc: '', cfgRescale: 0, useCoords: false, seed: null, steps: 12 });
});
