jest.mock('..', () => ({ workFlowService: { buildPreset: jest.fn() } }));
jest.mock('../ImageService', () => ({ dataUriToBase64: jest.fn() }));

import { workFlowService } from '..';
import { WFWorkFlow } from '../workflows/WorkFlow';
import { SDInpaintDef, createInpaintPreset } from '../workflows/SDWorkFlow';

beforeEach(() => {
  (workFlowService.buildPreset as jest.Mock).mockImplementation(() => new WFWorkFlow(SDInpaintDef).buildPreset());
});

test('메타데이터 없는 이미지는 수동 생성과 동일한 기본값으로 시작한다', () => {
  const defaults = workFlowService.buildPreset('SDInpaint');
  expect(createInpaintPreset(undefined, 'image.png').toJSON()).toEqual({ ...defaults.toJSON(), image: 'image.png' });
});

test('부분 메타데이터의 누락 항목은 기본 인페인트 설정을 유지한다', () => {
  const defaults = workFlowService.buildPreset('SDInpaint');
  const preset = createInpaintPreset({ prompt: 'colorize test', uc: undefined } as any);
  expect(preset.prompt).toBe('colorize test');
  for (const key of ['uc','sampling','noiseSchedule','cfgRescale','promptGuidance','characterPrompts','useCoords']) {
    expect(preset[key]).toEqual(defaults[key]);
  }
});

test('정상 메타데이터의 명시적 빈 문자열/0/false는 보존한다', () => {
  const preset = createInpaintPreset({ prompt: '', uc: '', cfgRescale: 0, promptGuidance: 0, useCoords: false } as any, 'image.png', 'mask.png');
  expect(preset).toMatchObject({ prompt: '', uc: '', cfgRescale: 0, promptGuidance: 0, useCoords: false, image: 'image.png', mask: 'mask.png' });
});
