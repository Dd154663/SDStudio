// 템플릿 편집기 샘플링 칸의 모델 계열 알약(2026-11-15 B안) —
// 초기 계열 = 템플릿 미러 계열 → 앱 모델 계열 → 4.5, 알약 전환 = 그 계열 값 표시(저장 안 함),
// 변경 = samplingProfiles[계열]·samplingProfileFamily·겉 필드를 한 번에 patchPreset(다른 계열 보존),
// 5M = 스텝 14·k_euler_ancestral·CFG 리스케일 미사용 고정 표시·비활성 + 네거티브 흐림·안내(저장값 보존),
// 글로벌 프리셋 복사 뒤 알약 = 복사해 온 미러 계열, 모바일은 알약 둘째 줄.
// 새 프로젝트 생성 경로(presetFromJSON → 계열 활성화)는 그대로 — 3벌 템플릿이 각 계열로 의도한 값을 올리는지 확인.
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';

const mockEnv = { mobile: false };
const mockConfig: { modelVersion?: string } = {};
const mockConfigListeners: Array<() => void> = [];

const mockTemplates: any[] = [];
const mockTpl = {
  ensureLoaded: jest.fn(async () => {}),
  listGlobal: jest.fn(() => mockTemplates.filter((t) => !t.folderLocal)),
  get: jest.fn((id: string) => mockTemplates.find((t) => t.id === id)),
  getByName: jest.fn(() => undefined),
  create: jest.fn(),
  duplicate: jest.fn(),
  delete: jest.fn(async () => {}),
  flushSave: jest.fn(async () => {}),
  // 실물과 같은 얕은 병합 — 다음 렌더가 새 값을 읽는다
  patchPreset: jest.fn(async (id: string, patch: any) => {
    const t = mockTemplates.find((x) => x.id === id);
    t.preset = { ...(t.preset ?? { type: 'SDImageGenEasy', name: t.name, frontPrompt: '', backPrompt: '', uc: '' }), ...patch };
  }),
  importGlobalPreset: jest.fn(async (id: string, _gid: string) => {
    const t = mockTemplates.find((x) => x.id === id);
    t.preset = { ...mockGlobalPresetJson, name: t.name };
  }),
  isEmptyTemplate: jest.fn(() => false),
  overwriteFromTemplate: jest.fn(async () => {}),
  storeImageForEditor: jest.fn(),
  getImagePath: jest.fn(),
};
let mockGlobalPresetJson: any = {};
let mockPickerProps: any = null;

function mkTpl(id: string, preset: any): any {
  return {
    id,
    name: '템플릿 ' + id,
    folderLocal: false,
    preset,
    characterPresets: [],
    scenes: [],
    vibes: [],
    characterReferences: [],
    updatedAt: 1,
    badgeColor: null,
  };
}

jest.mock('@capacitor/app', () => ({
  App: { addListener: jest.fn(), minimizeApp: jest.fn() },
}));
jest.mock('../index', () => ({
  get isMobile() {
    return mockEnv.mobile;
  },
  projectTemplateService: mockTpl,
  templateService: {
    ensureLoaded: jest.fn(async () => {}),
    listSceneTemplates: jest.fn(() => []),
    getFolderTemplate: jest.fn(() => ({ templateId: 'fl' })),
    setFolderTemplate: jest.fn(async () => {}),
    hasApplications: jest.fn(() => false),
    listInheritedChildren: jest.fn(() => []),
  },
  globalPresetService: { loaded: true, presets: [{ id: 'g1' }], load: jest.fn() },
  globalCharacterPresetService: { loaded: true, list: () => [], load: jest.fn() },
  sessionService: {
    applyProjectTemplateToSession: jest.fn(),
    addEventListener: jest.fn((_e: string, fn: () => void) => mockConfigListeners.push(fn)),
    removeEventListener: jest.fn(),
  },
  backend: { getConfig: jest.fn(async () => ({ ...mockConfig })) },
}));
const mockAppState: any = {
  curSession: null,
  pushMessage: jest.fn(),
  pushDialog: jest.fn(),
  pushDialogAsync: jest.fn(),
  incrementModalOverlay: jest.fn(),
  decrementModalOverlay: jest.fn(),
  projectTemplateBackupExport: jest.fn(async () => {}),
  projectTemplateBackupImport: jest.fn(async () => {}),
};
jest.mock('../AppService', () => ({ appState: mockAppState }));
jest.mock('../types', () => ({
  CharacterPreset: class {
    name = '';
    static fromJSON(x: any) {
      return x;
    }
  },
}));
jest.mock('../nameInput', () => ({ promptName: jest.fn(), nameErrorMessage: jest.fn() }));
jest.mock('../deleteFlowRules', () => ({
  attachmentRemoveConfirmText: jest.fn(() => ({ text: '' })),
  deleteConfirmText: jest.fn(() => ({ text: '' })),
}));
jest.mock('../globalLibraryUndo', () => ({
  renameTemplateRecorded: jest.fn(),
  setTemplateBadgeColorRecorded: jest.fn(async () => {}),
}));
jest.mock('../../componenets/ActionIcon', () => ({ ActionIcon: () => null }));
jest.mock('../../componenets/Tooltip', () => ({ children }: any) => children);
jest.mock('../../componenets/HelpIcon', () => ({ content }: any) => (
  <span data-help-icon="">{content}</span>
));
jest.mock('../../componenets/PromptEditTextArea', () => (props: any) => (
  <textarea data-prompt-area="" className={props.className} value={props.value} onChange={(e) => props.onChange(e.target.value)} />
));
jest.mock('../../componenets/PreSetEdtior', () => ({
  V5MediumNegativeNotice: () => <div data-v5m-negative-notice="" />,
}));
jest.mock('../../componenets/CharacterPresetInnerEditor', () => ({ CharacterPresetInnerEditor: () => null }));
jest.mock('../../componenets/CharacterPresetCards', () => ({ VibeImage: () => null }));
jest.mock('../../componenets/GlobalPresetPicker', () => ({
  GlobalPresetPicker: (props: any) => {
    mockPickerProps = props;
    return null;
  },
}));
jest.mock('../../componenets/VibeEditor', () => ({ EditableSliderValue: () => null }));
jest.mock('../../componenets/UtilComponents', () => ({ FileUploadBase64: () => null }));
jest.mock('../../componenets/BatchCreateModal', () => ({ BatchCreatePanel: () => null }));

import { TemplateManagerModal } from '../../componenets/TemplateManagerModal';
import {
  buildTemplateSamplingPatch,
  initialTemplateSamplingFamily,
  readTemplateSamplingValue,
  templateSamplingLocks,
} from '../templateSamplingFamily';
import { activatePresetSamplingFamily, V5_MEDIUM_TEXT } from '../modelSamplingProfiles';
import { ModelVersion } from '../../backends/imageGen';
import { blankTemplatePreset } from '../ProjectTemplateService';
import { WFWorkFlow } from '../workflows/WorkFlow';
import { SDImageGenEasyDef } from '../workflows/SDWorkFlow';

const SAMPLING = { promptGuidance: 5, sampling: 'k_euler_ancestral', noiseSchedule: 'karras', cfgRescale: 0 };
/** 3벌이 다른 템플릿 프리셋(미러 = v4_5). */
const threeProfiles = () => ({
  type: 'SDImageGenEasy',
  name: 'p',
  frontPrompt: 'f',
  backPrompt: '',
  uc: 'neg',
  ...SAMPLING,
  steps: 28,
  promptGuidance: 6,
  samplingProfileFamily: 'v4_5',
  samplingProfiles: {
    v4_5: { ...SAMPLING, steps: 28, promptGuidance: 6 },
    v5: { ...SAMPLING, steps: 23, promptGuidance: 4.5, sampling: 'k_dpmpp_2m' },
    v5m: { ...SAMPLING, steps: 14, promptGuidance: 3 },
  },
});

describe('순수 규칙(models/templateSamplingFamily)', () => {
  test('초기 계열: 미러 계열 우선 → 앱 모델 계열 → 4.5', () => {
    expect(initialTemplateSamplingFamily({ samplingProfileFamily: 'v5m' }, ModelVersion.V4_5)).toBe('v5m');
    expect(initialTemplateSamplingFamily({ samplingProfileFamily: 'zzz' }, ModelVersion.V5)).toBe('v5');
    expect(initialTemplateSamplingFamily(undefined, ModelVersion.V5Medium)).toBe('v5m');
    expect(initialTemplateSamplingFamily({}, ModelVersion.V4_5Curated)).toBe('v4_5');
    expect(initialTemplateSamplingFamily({}, undefined)).toBe('v4_5');
  });

  test('표시 값: 미러 계열은 겉 필드, 다른 계열은 그 프로필, 없으면 겉 필드·기본값', () => {
    const p = threeProfiles();
    p.steps = 30; // 미러 겉 필드가 프로필보다 최신(종전 편집기)
    expect(readTemplateSamplingValue(p, 'v4_5', 'steps')).toBe(30);
    expect(readTemplateSamplingValue(p, 'v5', 'steps')).toBe(23);
    expect(readTemplateSamplingValue(p, 'v5', 'sampling')).toBe('k_dpmpp_2m');
    expect(readTemplateSamplingValue(p, 'v5m', 'promptGuidance')).toBe(3);
    expect(readTemplateSamplingValue({ steps: 20 }, 'v5', 'steps')).toBe(20);
    expect(readTemplateSamplingValue(blankTemplatePreset('x'), 'v5', 'steps')).toBe(28);
    expect(readTemplateSamplingValue(undefined, 'v4_5', 'noiseSchedule')).toBe('karras');
  });

  test('변경 patch: 계열 프로필·미러 계열·겉 필드를 함께, 다른 두 계열은 보존', () => {
    const p = threeProfiles();
    const patch = buildTemplateSamplingPatch(p, 'v5', 'steps', 40);
    expect(patch.samplingProfileFamily).toBe('v5');
    expect(patch.samplingProfiles.v5.steps).toBe(40);
    expect(patch.samplingProfiles.v5.sampling).toBe('k_dpmpp_2m');
    expect(patch.steps).toBe(40);
    expect(patch.sampling).toBe('k_dpmpp_2m'); // 겉 필드 = 새 미러(v5) 값
    expect(patch.samplingProfiles.v4_5).toMatchObject({ steps: 28, promptGuidance: 6 });
    expect(patch.samplingProfiles.v5m).toMatchObject({ steps: 14, promptGuidance: 3 });
    // 원본은 건드리지 않는다(깊은 복제)
    expect(p.samplingProfiles.v5.steps).toBe(23);
    expect(p.samplingProfileFamily).toBe('v4_5');
    // 이어서 4.5 를 고쳐도 v5 값은 남는다
    const merged = { ...p, ...patch };
    const patch2 = buildTemplateSamplingPatch(merged, 'v4_5', 'promptGuidance', 7);
    expect(patch2.samplingProfiles.v5.steps).toBe(40);
    expect(patch2.samplingProfiles.v4_5).toMatchObject({ steps: 28, promptGuidance: 7 });
    expect(patch2.steps).toBe(28);
    expect(patch2.samplingProfileFamily).toBe('v4_5');
  });

  test('빈 프리셋(겉 필드 없음) 첫 변경: 기본값을 채운 뒤 그 계열에만 기록', () => {
    const patch = buildTemplateSamplingPatch(blankTemplatePreset('x'), 'v5', 'steps', 20);
    expect(patch).toMatchObject({
      steps: 20,
      promptGuidance: 5,
      cfgRescale: 0,
      sampling: 'k_euler_ancestral',
      noiseSchedule: 'karras',
      samplingProfileFamily: 'v5',
    });
    expect(patch.samplingProfiles.v5.steps).toBe(20);
    expect(patch.samplingProfiles.v4_5.steps).toBe(28);
    expect(patch.samplingProfiles.v5m.steps).toBe(28);
    // 프리셋 자체가 없을 때도 같은 결과
    expect(buildTemplateSamplingPatch(undefined, 'v5', 'steps', 20).samplingProfiles.v5.steps).toBe(20);
  });

  test('고정 칸: 5M = 스텝 14·k_euler_ancestral·CFG 미사용·네거티브 미사용, 5 = karras 만, 4.5 = 없음', () => {
    expect(templateSamplingLocks('v5m')).toEqual({
      fixedSteps: 14,
      fixedSampler: 'k_euler_ancestral',
      cfgRescaleUnsupported: true,
      forcedNoiseSchedule: 'karras',
      negativeUnused: true,
    });
    expect(templateSamplingLocks('v5')).toEqual({
      fixedSteps: undefined,
      fixedSampler: undefined,
      cfgRescaleUnsupported: false,
      forcedNoiseSchedule: 'karras',
      negativeUnused: false,
    });
    expect(templateSamplingLocks('v4_5')).toMatchObject({
      fixedSteps: undefined,
      cfgRescaleUnsupported: false,
      forcedNoiseSchedule: undefined,
      negativeUnused: false,
    });
  });

  test('새 프로젝트 경로 불변: 3벌 템플릿 → presetFromJSON → 각 계열 활성화 = 그 계열 값', () => {
    const wf = new WFWorkFlow(SDImageGenEasyDef);
    const expected: Record<string, any> = {
      v4_5: { steps: 28, promptGuidance: 6, sampling: 'k_euler_ancestral' },
      v5: { steps: 23, promptGuidance: 4.5, sampling: 'k_dpmpp_2m' },
      v5m: { steps: 14, promptGuidance: 3, sampling: 'k_euler_ancestral' },
    };
    for (const family of ['v4_5', 'v5', 'v5m'] as const) {
      const preset: any = wf.presetFromJSON(JSON.parse(JSON.stringify(threeProfiles())));
      activatePresetSamplingFamily(preset, family);
      expect({ steps: preset.steps, promptGuidance: preset.promptGuidance, sampling: preset.sampling }).toEqual(
        expected[family],
      );
    }
    // 편집기로 v5 를 고친 템플릿도 같은 경로로 올라온다
    const edited = { ...threeProfiles(), ...buildTemplateSamplingPatch(threeProfiles(), 'v5', 'steps', 40) };
    for (const [family, steps] of [['v4_5', 28], ['v5', 40], ['v5m', 14]] as const) {
      const preset: any = wf.presetFromJSON(JSON.parse(JSON.stringify(edited)));
      activatePresetSamplingFamily(preset, family);
      expect(preset.steps).toBe(steps);
    }
  });
});

// ----- 화면 -----
let root: Root;
let container: HTMLDivElement;
beforeAll(() => {
  (global as any).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  jest.clearAllMocks();
  mockEnv.mobile = false;
  delete mockConfig.modelVersion;
  mockConfigListeners.length = 0;
  mockTemplates.length = 0;
  mockPickerProps = null;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const q = (sel: string) => container.querySelector<HTMLElement>(sel);
const renderManager = async () => {
  await act(async () => root.render(<TemplateManagerModal isOpen onClose={jest.fn()} />));
};
const pill = (f: string) => q(`[data-template-sampling-family] [data-family="${f}"]`) as HTMLButtonElement;
const selectedFamily = () => q('[data-template-sampling-family]')!.getAttribute('data-template-sampling-family');
const fieldOf = (label: string) => {
  const l = Array.from(container.querySelectorAll('label')).find((x) => (x.textContent || '').startsWith(label))!;
  return l.querySelector('input, select') as HTMLInputElement | HTMLSelectElement;
};
const setValue = async (el: HTMLInputElement | HTMLSelectElement, value: string) => {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
};
const click = async (el: Element | null) => {
  expect(el).toBeTruthy();
  await act(async () => (el as HTMLElement).click());
};

describe('템플릿 편집기 샘플링 알약', () => {
  // UI 정돈 그룹 2-c: 알약 칩 → 택일 묶음 .seg-group(작은 칸 .seg-sm). 선택 = .seg-on
  test('택일 묶음 모양: 4.5·5·5M, 선택 = seg-on·aria-pressed, 안내 문구', async () => {
    mockTemplates.push(mkTpl('t1', threeProfiles()));
    await renderManager();
    const group = q('[data-template-sampling-family]')!;
    expect(Array.from(group.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['4.5', '5', '5M']);
    expect(group.className.split(' ')).toEqual(expect.arrayContaining(['seg-group', 'seg-sm']));
    expect(pill('v4_5').className.split(' ')).toEqual(['seg-item', 'text-xs', 'seg-on']);
    expect(pill('v4_5').getAttribute('aria-pressed')).toBe('true');
    expect(pill('v5').className).toBe('seg-item text-xs');
    expect(pill('v5').getAttribute('aria-pressed')).toBe('false');
    expect(q('[data-template-sampling-head]')!.getAttribute('data-template-sampling-head')).toBe('row');
    expect(q('[data-template-sampling-head]')!.textContent).toContain('알약은 이 템플릿에서 어느 계열 값을 고칠지만');
  });

  test('초기 계열: 미러 계열 우선(앱 모델이 5여도)', async () => {
    mockConfig.modelVersion = ModelVersion.V5;
    mockTemplates.push(mkTpl('t1', { ...threeProfiles(), samplingProfileFamily: 'v5m' }));
    await renderManager();
    expect(selectedFamily()).toBe('v5m');
  });

  test('초기 계열: 미러 없으면 앱 모델 계열, config-changed 를 따른다', async () => {
    mockConfig.modelVersion = ModelVersion.V5;
    mockTemplates.push(mkTpl('t1', blankTemplatePreset('x')));
    await renderManager();
    expect(selectedFamily()).toBe('v5');
    mockConfig.modelVersion = ModelVersion.V5Medium;
    await act(async () => {
      for (const fn of mockConfigListeners) await fn();
    });
    expect(selectedFamily()).toBe('v5m');
  });

  test('알약 전환 = 그 계열 값 표시, 전환 자체는 저장하지 않음', async () => {
    mockTemplates.push(mkTpl('t1', threeProfiles()));
    await renderManager();
    expect((fieldOf('스탭 수') as HTMLInputElement).value).toBe('28');
    expect((fieldOf('프롬프트 가이던스') as HTMLInputElement).value).toBe('6');
    await click(pill('v5'));
    expect(selectedFamily()).toBe('v5');
    expect((fieldOf('스탭 수') as HTMLInputElement).value).toBe('23');
    expect((fieldOf('프롬프트 가이던스') as HTMLInputElement).value).toBe('4.5');
    expect((fieldOf('샘플링') as HTMLSelectElement).value).toBe('k_dpmpp_2m');
    expect(mockTpl.patchPreset).not.toHaveBeenCalled();
  });

  test('스탭 수 변경 → 선택 계열 프로필·미러 계열·겉 steps 를 한 번에, 다른 계열 보존', async () => {
    mockTemplates.push(mkTpl('t1', threeProfiles()));
    await renderManager();
    await click(pill('v5'));
    await setValue(fieldOf('스탭 수'), '40');
    expect(mockTpl.patchPreset).toHaveBeenCalledTimes(1);
    const [id, patch] = mockTpl.patchPreset.mock.calls[0] as any[];
    expect(id).toBe('t1');
    expect(patch.samplingProfiles.v5.steps).toBe(40);
    expect(patch.samplingProfileFamily).toBe('v5');
    expect(patch.steps).toBe(40);
    expect(patch.samplingProfiles.v4_5.steps).toBe(28);
    expect(patch.samplingProfiles.v5m.steps).toBe(14);
    // 4.5 로 돌아오면 4.5 값 그대로
    await click(pill('v4_5'));
    expect((fieldOf('스탭 수') as HTMLInputElement).value).toBe('28');
    await click(pill('v5'));
    expect((fieldOf('스탭 수') as HTMLInputElement).value).toBe('40');
  });

  test('빈 프리셋에서 첫 변경', async () => {
    mockTemplates.push(mkTpl('t1', undefined));
    await renderManager();
    expect(selectedFamily()).toBe('v4_5');
    await setValue(fieldOf('프롬프트 가이던스'), '7');
    const patch = (mockTpl.patchPreset.mock.calls[0] as any[])[1];
    expect(patch).toMatchObject({ promptGuidance: 7, steps: 28, samplingProfileFamily: 'v4_5' });
    expect(patch.samplingProfiles.v4_5.promptGuidance).toBe(7);
    expect(patch.samplingProfiles.v5.promptGuidance).toBe(5);
  });

  test('5M: 고정 표시·비활성 + 안내, 네거티브 흐림+안내(입력 가능), 저장값 보존', async () => {
    const preset = threeProfiles();
    preset.samplingProfiles.v5m.steps = 30; // 저장값은 30 이어도 표시는 고정 14
    preset.samplingProfiles.v5m.cfgRescale = 0.4;
    mockTemplates.push(mkTpl('t1', preset));
    await renderManager();
    expect(q('[data-template-v5m-notice]')).toBeNull();
    expect(q('[data-v5m-negative-notice]')).toBeNull();
    await click(pill('v5m'));
    const steps = fieldOf('스탭 수') as HTMLInputElement;
    expect(steps.value).toBe('14');
    expect(steps.disabled).toBe(true);
    expect(q('[data-template-v5m-fixed="steps"]')!.textContent).toBe(V5_MEDIUM_TEXT.fixedField('14'));
    const sampler = fieldOf('샘플링') as HTMLSelectElement;
    expect(sampler.value).toBe('k_euler_ancestral');
    expect(sampler.disabled).toBe(true);
    expect((fieldOf('CFG 리스케일') as HTMLInputElement).disabled).toBe(true);
    expect(q('[data-template-v5m-fixed="cfgRescale"]')!.textContent).toBe(V5_MEDIUM_TEXT.cfgRescaleUnsupported);
    expect((fieldOf('프롬프트 가이던스') as HTMLInputElement).disabled).toBe(false);
    expect(q('[data-template-v5m-notice]')!.textContent).toBe(V5_MEDIUM_TEXT.modelNotice);
    const ucBox = q('[data-template-prompt-box="uc"]')!;
    expect(ucBox.className).toContain('opacity-60');
    expect(ucBox.parentElement!.querySelector('[data-v5m-negative-notice]')).not.toBeNull();
    expect((ucBox.querySelector('textarea') as HTMLTextAreaElement).value).toBe('neg');
    expect(mockTpl.patchPreset).not.toHaveBeenCalled();
    expect(mockTemplates[0].preset.samplingProfiles.v5m.steps).toBe(30);
    // 4.5 로 돌아오면 흐림·안내 사라짐
    await click(pill('v4_5'));
    expect(q('[data-template-prompt-box="uc"]')!.className).not.toContain('opacity-60');
    expect((fieldOf('스탭 수') as HTMLInputElement).disabled).toBe(false);
  });

  test('5 계열: 노이즈 스케줄 karras 고정 표시·비활성, 나머지 편집 가능', async () => {
    mockTemplates.push(mkTpl('t1', threeProfiles()));
    await renderManager();
    expect((fieldOf('노이즈 스케줄') as HTMLSelectElement).disabled).toBe(false);
    await click(pill('v5'));
    const noise = fieldOf('노이즈 스케줄') as HTMLSelectElement;
    expect(noise.disabled).toBe(true);
    expect(noise.value).toBe('karras');
    expect((fieldOf('스탭 수') as HTMLInputElement).disabled).toBe(false);
    expect((fieldOf('CFG 리스케일') as HTMLInputElement).disabled).toBe(false);
  });

  test('글로벌 프리셋 복사 뒤 알약 = 복사해 온 미러 계열', async () => {
    mockTemplates.push(mkTpl('t1', threeProfiles()));
    mockGlobalPresetJson = { ...threeProfiles(), samplingProfileFamily: 'v5' };
    await renderManager();
    await click(pill('v5m'));
    expect(selectedFamily()).toBe('v5m');
    // [복사해 오기] → 「글로벌 프리셋에서」 → 카드 선택 창
    mockAppState.pushDialogAsync.mockResolvedValueOnce('global');
    await click(
      Array.from(container.querySelectorAll('button')).find((b) =>
        (b.textContent || '').includes('복사해 오기'),
      )!,
    );
    expect(mockPickerProps).toBeTruthy();
    await act(async () => {
      await mockPickerProps.onPick('g1');
    });
    expect(mockTpl.importGlobalPreset).toHaveBeenCalledWith('t1', 'g1');
    expect(selectedFamily()).toBe('v5');
    expect((fieldOf('스탭 수') as HTMLInputElement).value).toBe('28'); // 미러(v5) 겉 필드
  });

  test('모바일: 알약은 샘플링 머리 둘째 줄(줄바꿈 허용)', async () => {
    mockEnv.mobile = true;
    mockTemplates.push(mkTpl('t1', threeProfiles()));
    await renderManager();
    const head = q('[data-template-sampling-head]')!;
    expect(head.getAttribute('data-template-sampling-head')).toBe('stacked');
    expect(head.className).toContain('flex-col');
    const rows = Array.from(head.children);
    // 2026-11-20 UI 정돈 그룹 1-c: 구획 제목 「샘플링」은 묶음 상자 제목 한 번만 — 머리 첫 줄은 도움말만 남는다
    expect(head.closest('[data-setting-group="샘플링"]')).not.toBeNull();
    expect(rows[0].querySelector('[data-help-icon]')).not.toBeNull();
    expect(rows[1].hasAttribute('data-template-sampling-family')).toBe(true);
    expect((rows[1] as HTMLElement).className).toContain('flex-wrap');
    expect((rows[1] as HTMLElement).className).not.toContain('overflow');
  });
});
