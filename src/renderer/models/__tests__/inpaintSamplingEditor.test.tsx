/**
 * 변형 씬(인페인트·I2I·미러, 조합 모드 포함) 편집 칸의 샘플링 표시(2026-10-11 A6 조사 → 같은 날 설계 변경, SPEC §7-5).
 * 변형 씬 생성은 샘플링·모델 설정을 메인 사전 세팅에서 가져오므로(variantSampling) 편집 칸에는 「샘플링/모델 설정」 그룹이
 * 없고, 그 자리에 안내 한 줄 + 현재 메인 값 요약(읽기 전용, 메인 변경 즉시 반영)이 있다. 메인을 못 읽으면 요약은 생략.
 * 실제 정의(InnerPreSetEditor, inner=true)를 렌더한다. 무거운 하위 컴포넌트·서비스만 모킹한다.
 */
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { configure, observable } from 'mobx';

const mockState: any = {
  uiPresetLayout: {},
  uiCompanionSlots: {},
  uiPresetIconRow: false,
  editMode: false,
  curSession: undefined,
  incrementModalOverlay: () => {},
  decrementModalOverlay: () => {},
  pushMessage: () => {},
};

jest.mock('..', () => {
  const { WFWorkFlow } = jest.requireActual('../workflows/WorkFlow');
  const defs = () => {
    const sd = jest.requireActual('../workflows/SDWorkFlow');
    return [sd.SDInpaintDef, sd.SDI2IDef, sd.SDMirrorDef];
  };
  return {
    isMobile: false,
    backend: { getConfig: async () => ({ modelVersion: '4-5-full' }) },
    sessionService: { addEventListener: () => {}, removeEventListener: () => {} },
    imageService: { getVibeImagePath: () => '', fetchVibeImage: async () => '' },
    promptService: {},
    taskQueueService: {},
    workFlowService: {
      getVarDef: (type: string, fieldType: string, field: string) => {
        const def = defs().find((d: any) => d.type === type);
        const vars = fieldType === 'preset' ? def.presetVars : def.sharedVars;
        return vars.find((v: any) => v.name === field);
      },
      buildPreset: (type: string) =>
        new WFWorkFlow(defs().find((d: any) => d.type === type)).buildPreset(),
    },
  };
});
jest.mock('../AppService', () => ({ appState: mockState }));
jest.mock('../BackStackService', () => ({ backStackService: { push: () => ({ remove: () => {} }) } }));
jest.mock('../../componenets/ModalOverlay', () => ({ isOpen, title, children }: any) =>
  isOpen ? <div data-testid="overlay"><h2>{title}</h2>{children}</div> : null);
jest.mock('../../componenets/SceneEditor', () => ({ BigPromptEditor: () => null, SlotPiece: () => null }));
jest.mock('../../componenets/FloatView', () => ({ FloatView: ({ children }: any) => children }));
jest.mock('../../componenets/CharacterPositionOverlay', () => ({ CharacterPositionOverlay: () => null, PositionMarker: () => null }));
jest.mock('../../componenets/VibeEditor', () => ({
  EditableSliderValue: () => null, VibeEditor: () => null, VibeButton: () => <button>바이브 설정</button>, VibeImage: () => null,
}));
jest.mock('../../componenets/CharacterReferenceEditor', () => ({
  CharacterReferenceEditor: () => null, CharacterReferenceButton: () => <button>캐릭터 레퍼런스</button>,
}));
jest.mock('../../componenets/PortableToolbarButtons', () => ({ renderCompanionButtons: () => [] }));
jest.mock('../../componenets/CompanionDnd', () => ({ CompanionHostRow: ({ children }: any) => <>{children}</> }));
jest.mock('../../componenets/PresetLayoutDnd', () => ({
  DraggablePresetRow: ({ children }: any) => <>{children}</>, resetPresetOrder: () => {}, isPresetAnchorKey: () => false,
}));
jest.mock('../../componenets/PromptEditTextArea', () => {
  const R = jest.requireActual('react');
  const C = (props: any) => <textarea value={props.value} onChange={(e) => props.onChange(e.target.value)} />;
  return { __esModule: true, default: C, PromptAccessorySlotContext: R.createContext(null) };
});
jest.mock('../../componenets/MobilePromptSheet', () => {
  const R = jest.requireActual('react');
  return { PresetCompactContext: R.createContext(false), PresetFocusContext: R.createContext(null), WFI_KEY_ATTR: 'data-wfi-key' };
});
jest.mock('../../componenets/Tooltip', () => ({ children }: any) => <>{children}</>);
jest.mock('../../componenets/ActionIcon', () => ({ ActionIcon: () => null }));
jest.mock('../../componenets/HelpIcon', () => () => null);
jest.mock('../../componenets/ResolutionPicker', () => ({ ResolutionPicker: () => null, resolutionValueToSize: () => ({ width: 0, height: 0 }) }));
jest.mock('react-dnd', () => ({ useDrag: () => [{}, () => {}, () => {}], useDrop: () => [{}, () => {}] }));
jest.mock('react-contexify', () => ({ useContextMenu: () => ({ show: () => {} }) }));

import { WFWorkFlow } from '../workflows/WorkFlow';
import {
  SDInpaintDef,
  SDI2IDef,
  SDMirrorDef,
  SDInpaintComboUI,
  SDI2IComboUI,
} from '../workflows/SDWorkFlow';
import { VARIANT_SAMPLING_TEXT } from '../variantSampling';
import { InnerPreSetEditor } from '../../componenets/PreSetEdtior';

let container: HTMLDivElement;
let root: Root;
// 메인 사전 세팅(observable — 바꾸면 요약이 바로 갱신돼야 한다)
let mainPreset: any;
const mainSession = () => ({
  selectedWorkflow: { workflowType: 'SDImageGen', presetName: 'main' },
  getCommonSetup: () => ['SDImageGen', mainPreset, { normalizeStrength: false }, undefined],
});
beforeEach(() => {
  configure({ enforceActions: 'never' });
  (global as any).IS_REACT_ACT_ENVIRONMENT = true;
  mockState.uiPresetLayout = {};
  mainPreset = observable({ steps: 23, promptGuidance: 4.5, cfgRescale: 0.2, sampling: 'k_dpmpp_2m' });
  mockState.curSession = mainSession();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  mockState.curSession = undefined;
});

const button = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === label);
// IntSliderInput: 「라벨:」 줄 다음의 range 입력
const slider = (label: string) => {
  const row = [...container.querySelectorAll('div')].find(
    (d) => d.textContent === `${label}:` && d.className.includes('gray-label'),
  );
  return row?.parentElement?.querySelector('input[type=range]') as HTMLInputElement | undefined;
};
const notice = () => container.querySelector('[data-main-sampling-notice]');
const summary = () => container.querySelector('[data-main-sampling-summary]')?.textContent;

const cases: [string, any, () => any][] = [
  ['인페인트 편집 칸', SDInpaintDef, () => SDInpaintDef.editor],
  ['인페인트 조합 모드 편집 칸', SDInpaintDef, () => SDInpaintComboUI],
  ['I2I 편집 칸', SDI2IDef, () => SDI2IDef.editor],
  ['I2I 조합 모드 편집 칸', SDI2IDef, () => SDI2IComboUI],
  ['미러 편집 칸', SDMirrorDef, () => SDMirrorDef.editor],
];

const renderEditor = async (def: any, element: any, preset: any) => {
  await act(async () => {
    root.render(
      <InnerPreSetEditor type={def.type} preset={preset} shared={undefined} element={element} middlePromptMode={false} />,
    );
  });
};

test.each(cases)('%s: 「샘플링/모델 설정」 그룹 없음 — 안내 줄 + 메인 값 요약(읽기 전용)', async (_n, def, element) => {
  const preset = new WFWorkFlow(def).buildPreset();
  Object.assign(preset, { steps: 28, promptGuidance: 6, cfgRescale: 0.6 });
  await renderEditor(def, element(), preset);
  // 그룹 버튼·오버레이·샘플링 입력 없음
  expect(button('샘플링/모델 설정')).toBeUndefined();
  expect(container.querySelector('[data-testid=overlay]')).toBeNull();
  expect(slider('스탭 수')).toBeUndefined();
  expect(slider('프롬프트 가이던스')).toBeUndefined();
  expect(slider('CFG 리스케일')).toBeUndefined();
  // 안내 줄 + 메인 값(씬 프리셋 28/6/0.6 이 아니라 메인 23/4.5/0.2)
  expect(notice()?.textContent).toContain(VARIANT_SAMPLING_TEXT.notice);
  expect(summary()).toBe('스텝 23 · 가이던스 4.5 · CFG 0.2 · 샘플러 k_dpmpp_2m');
  // 메인 사전 세팅을 바꾸면 바로 반영(observer)
  act(() => {
    mainPreset.steps = 40;
    mainPreset.cfgRescale = 0;
  });
  expect(summary()).toBe('스텝 40 · 가이던스 4.5 · CFG 0 · 샘플러 k_dpmpp_2m');
  // 씬 프리셋은 그대로(데이터 모델 불변)
  expect(preset).toMatchObject({ steps: 28, promptGuidance: 6, cfgRescale: 0.6 });
});

test('메인 사전 세팅을 읽을 수 없으면 안내 줄만(요약 생략)', async () => {
  const preset = new WFWorkFlow(SDInpaintDef).buildPreset();
  mockState.curSession = { selectedWorkflow: undefined, getCommonSetup: () => { throw new Error('x'); } };
  await renderEditor(SDInpaintDef, SDInpaintDef.editor, preset);
  expect(notice()?.textContent).toContain(VARIANT_SAMPLING_TEXT.notice);
  expect(summary()).toBeUndefined();
  act(() => root.render(<></>));
  mockState.curSession = undefined;
  await renderEditor(SDInpaintDef, SDInpaintDef.editor, preset);
  expect(notice()).not.toBeNull();
  expect(summary()).toBeUndefined();
});

test('inner 레이아웃 순서 오버라이드(옛 sampling-group 키 포함)가 있어도 안내 줄은 남는다(L1-3 순열 계약)', async () => {
  const preset = new WFWorkFlow(SDInpaintDef).buildPreset();
  // 옛 키(sampling-group)는 정의에 없으니 무시, 누락 키(main-sampling-notice)는 정의 위치에 삽입된다
  mockState.uiPresetLayout = { 'SDInpaint@inner': ['strength', 'sampling-group', 'image'] };
  await renderEditor(SDInpaintDef, SDInpaintDef.editor, preset);
  expect(button('샘플링/모델 설정')).toBeUndefined();
  expect(notice()).not.toBeNull();
  expect(summary()).toBe('스텝 23 · 가이던스 4.5 · CFG 0.2 · 샘플러 k_dpmpp_2m');
});
