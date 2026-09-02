jest.mock('..', () => ({ workFlowService: {} }));

import { ModelVersion, Sampling } from '../../backends/imageGen';
import {
  activatePresetSamplingFamily,
  modelVersionForSamplingFamily,
  samplingFamilyForModel,
  setPresetSamplingField,
  switchSessionSamplingFamily,
} from '../modelSamplingProfiles';
import { WFVarBuilder, WFWorkFlow } from '../workflows/WorkFlow';

function preset() {
  return {
    steps: 28,
    promptGuidance: 5,
    sampling: Sampling.KEulerAncestral,
    noiseSchedule: 'karras',
    cfgRescale: 0,
    legacyPromptConditioning: false,
    varietyPlus: false,
    deliberateEulerAncestralBug: false,
  };
}

describe('모델별 프리셋 샘플링 설정', () => {
  it('기존 프리셋의 현재 값을 최초에 양쪽 계열로 복사한다', () => {
    const p: any = preset();
    activatePresetSamplingFamily(p, 'v4_5');

    expect(p.samplingProfiles.v4_5).toMatchObject({ steps: 28, promptGuidance: 5 });
    expect(p.samplingProfiles.v5).toEqual(p.samplingProfiles.v4_5);
    expect(p.samplingProfileFamily).toBe('v4_5');
    expect(p.steps).toBe(28);
  });

  it('각 계열의 편집값을 독립적으로 보존하고 구 필드를 활성값으로 미러한다', () => {
    const p: any = preset();
    activatePresetSamplingFamily(p, 'v4_5');
    setPresetSamplingField(p, 'v4_5', 'steps', 24);

    activatePresetSamplingFamily(p, 'v5');
    expect(p.steps).toBe(28);
    setPresetSamplingField(p, 'v5', 'steps', 32);

    activatePresetSamplingFamily(p, 'v4_5');
    expect(p.steps).toBe(24);
    activatePresetSamplingFamily(p, 'v5');
    expect(p.steps).toBe(32);
  });

  it('현재 Full·Curated 성격을 유지하며 4.5와 5를 전환한다', () => {
    expect(samplingFamilyForModel(ModelVersion.V4_5Curated)).toBe('v4_5');
    expect(samplingFamilyForModel(ModelVersion.V5)).toBe('v5');
    expect(modelVersionForSamplingFamily('v5', ModelVersion.V4_5Curated))
      .toBe(ModelVersion.V5Curated);
    expect(modelVersionForSamplingFamily('v4_5', ModelVersion.V5))
      .toBe(ModelVersion.V4_5);
  });

  it('프로젝트의 로컬·인페인트 프리셋을 함께 전환한다', () => {
    const local: any = preset();
    const inpaint: any = preset();
    const session = {
      presets: new Map([['SDImageGen', [local]]]),
      inpaints: new Map([['i', { preset: inpaint }]]),
    };

    switchSessionSamplingFamily(session, 'v4_5');
    setPresetSamplingField(local, 'v4_5', 'steps', 20);
    setPresetSamplingField(inpaint, 'v4_5', 'steps', 21);
    switchSessionSamplingFamily(session, 'v5');
    expect(local.steps).toBe(28);
    expect(inpaint.steps).toBe(28);
  });

  it('샘플링 필드가 없는 프리셋은 프로필로 오염시키지 않는다', () => {
    const augment: any = { type: 'AugmentGen', name: 'default' };
    activatePresetSamplingFamily(augment, 'v5');
    expect(augment).not.toHaveProperty('samplingProfiles');
  });

  it('선택적 프로필을 프리셋 JSON에서 왕복하고 기존 필드는 유지한다', () => {
    const workflow = new WFWorkFlow({
      type: 'test',
      title: 'test',
      presetVars: new WFVarBuilder()
        .addIntVar('steps', 1, 50, 1, 28)
        .addSamplingVar('sampling', Sampling.KEulerAncestral)
        .build(),
      sharedVars: [],
      metaVars: [],
      backendType: 'image',
      editor: null as any,
      i2i: false,
      handler: () => {},
    });
    const p: any = workflow.presetFromJSON({
      type: 'test',
      name: 'default',
      profile: '',
      backend: { type: 'NAI' },
      steps: 30,
      sampling: Sampling.KEulerAncestral,
    });

    activatePresetSamplingFamily(p, 'v5');
    setPresetSamplingField(p, 'v5', 'steps', 35);
    const json = p.toJSON();
    const restored: any = workflow.presetFromJSON(json);

    expect(json.steps).toBe(35);
    expect(restored.samplingProfiles.v4_5.steps).toBe(30);
    expect(restored.samplingProfiles.v5.steps).toBe(35);
    expect(restored.samplingProfileFamily).toBe('v5');
  });
});
