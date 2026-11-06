/**
 * 사전 세팅 패널(PreSetEditor) 렌더 — 되돌리기 U3b(2026-11-02, SPEC_GUIDE 「되돌리기 계약」).
 *  - ★ 렌더 중 자동 보정(작업모드 보충·사전 세팅 목록 'default' 생성·공용 설정 생성·선택 이름 보충, PSE 렌더 본문)과
 *    마운트 중 샘플링 계열 활성화(activatePresetSamplingFamily)는 기록되지 않는다.
 *  - 같은 화면에서 사용자 입력(상위 프롬프트 글자·「스탭 수」 슬라이더 누름~뗌)은 setField 집약 지점으로 기록된다.
 * 실제 PreSetEditor(general)와 SDImageGen 정의를 렌더하고, 무거운 하위 컴포넌트·서비스만 모킹한다.
 */
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { configure } from 'mobx';

const mockConfig: any = { modelVersion: '5-full' };
const mockState: any = {
  uiPresetLayout: {},
  uiCompanionSlots: {},
  uiPresetIconRow: false,
  editMode: false,
  legacyWorkflowMode: false,
  curSession: undefined,
  incrementModalOverlay: () => {},
  decrementModalOverlay: () => {},
  pushMessage: () => {},
};

jest.mock('..', () => {
  const { WFWorkFlow } = jest.requireActual('../workflows/WorkFlow');
  const sd = () => jest.requireActual('../workflows/SDWorkFlow');
  const flows = () => [new WFWorkFlow(sd().SDImageGenDef)];
  const flow = (type: string) => flows().find((f: any) => f.getType() === type);
  return {
    isMobile: false,
    backend: { getConfig: async () => ({ ...mockConfig }) },
    sessionService: { addEventListener: () => {}, removeEventListener: () => {} },
    imageService: { getVibeImagePath: () => '', getVibesDir: () => '', fetchVibeImage: async () => '' },
    promptService: {},
    taskQueueService: {},
    workFlowService: {
      get generalFlows() {
        return flows();
      },
      getVarDef: (type: string, fieldType: string, field: string) => {
        const def = flow(type).def;
        const vars = fieldType === 'preset' ? def.presetVars : fieldType === 'shared' ? def.sharedVars : def.metaVars;
        return vars.find((v: any) => v.name === field);
      },
      buildPreset: (type: string) => flow(type).buildPreset(),
      buildShared: (type: string) => flow(type).buildShared(),
      getGeneralEditor: (type: string) => flow(type).def.editor,
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

import { Session } from '../types';
import { undoService } from '../undoService';
import { flushSceneFieldEdit } from '../sceneFieldUndo';
import { resetPresetUndoState } from '../presetUndo';
import PreSetEditor from '../../componenets/PreSetEdtior';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  configure({ enforceActions: 'never' });
  (global as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  mockConfig.modelVersion = '5-full';
  act(() => root.unmount());
  container.remove();
  mockState.curSession = undefined;
  flushSceneFieldEdit();
  resetPresetUndoState();
});

const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

function setNativeValue(el: HTMLTextAreaElement | HTMLInputElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

const button = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === label);
const slider = (label: string) => {
  const row = [...container.querySelectorAll('div')].find(
    (d) => d.textContent === `${label}:` && d.className.includes('gray-label'),
  );
  return row?.parentElement?.querySelector('input[type=range]') as HTMLInputElement | undefined;
};

test('★ 렌더 중 자동 보정·마운트 중 샘플링 활성화는 기록되지 않고, 사용자 입력은 기록된다', async () => {
  // 비어 있는 프로젝트 — 렌더가 작업모드·사전 세팅 목록·공용 설정·선택 이름을 차례로 보충한다
  const session = new Session();
  session.name = 'p';
  mockState.curSession = session;
  await act(async () => {
    root.render(<PreSetEditor middlePromptMode={false} />);
  });
  await flush();
  expect(session.selectedWorkflow).toEqual({ workflowType: 'SDImageGen', presetName: 'default' });
  const preset = session.presets.get('SDImageGen')![0];
  expect(preset.name).toBe('default');
  expect(session.presetShareds.get('SDImageGen')).toBeTruthy();
  // 마운트 중 계열 활성화(config 5-full → v5)도 일어났다
  expect(preset.samplingProfileFamily).toBe('v5');
  expect(undoService.entries(session).past).toHaveLength(0);

  // 사용자 입력 ① 상위 프롬프트 글자(편집 세션 — 입력 칸 밖 변경이면 다음 틱에 확정)
  const front = container.querySelector('textarea') as HTMLTextAreaElement;
  expect(front).toBeTruthy();
  const front0 = preset.frontPrompt;
  await act(async () => {
    setNativeValue(front, 'hello');
  });
  await flush();
  expect(preset.frontPrompt).toBe('hello');
  expect(undoService.entries(session).past).toHaveLength(1);

  // 사용자 입력 ② 「스탭 수」 슬라이더 누름~뗌 = 1항목(샘플링 프로필 동기화 포함)
  await act(async () => {
    button('샘플링/모델 설정')!.click();
  });
  const steps = slider('스탭 수')!;
  expect(steps).toBeTruthy();
  const stepsBefore = preset.steps;
  await act(async () => {
    steps.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    setNativeValue(steps, String(stepsBefore + 1));
    setNativeValue(steps, String(stepsBefore + 2));
    window.dispatchEvent(new Event('pointerup'));
  });
  expect(preset.steps).toBe(stepsBefore + 2);
  expect(preset.samplingProfiles.v5.steps).toBe(stepsBefore + 2);
  expect(undoService.entries(session).past).toHaveLength(2);

  // 되돌림 — 슬라이더 1항목, 글자 1항목. 렌더 보정 결과(default 그림체·공용 설정)는 그대로
  await act(async () => {
    await undoService.undo(session);
  });
  expect(preset.steps).toBe(stepsBefore);
  expect(preset.samplingProfiles.v5.steps).toBe(stepsBefore);
  await act(async () => {
    await undoService.undo(session);
  });
  expect(preset.frontPrompt).toBe(front0);
  expect(session.presets.get('SDImageGen')).toEqual([preset]);
  expect(undoService.entries(session).past).toHaveLength(0);
});

test('V5M(Medium): 스텝·샘플러·CFG 리스케일은 고정값 표시+비활성, 네거티브 칸 위 안내, 저장값은 그대로(2026-11-06)', async () => {
  mockConfig.modelVersion = '5-full-medium';
  const session = new Session();
  session.name = 'p';
  mockState.curSession = session;
  await act(async () => {
    root.render(<PreSetEditor middlePromptMode={false} />);
  });
  await flush();
  const preset = session.presets.get('SDImageGen')![0];
  expect(preset.samplingProfileFamily).toBe('v5m');
  const stepsSaved = preset.steps;
  expect(container.querySelector('[data-v5m-negative-notice]')?.textContent).toContain('-3::태그::');
  await act(async () => {
    button('샘플링/모델 설정')!.click();
  });
  const steps = slider('스탭 수')!;
  expect(steps.disabled).toBe(true);
  expect(steps.value).toBe('14');
  expect(container.querySelector('[data-v5m-fixed="steps"]')).toBeTruthy();
  expect(container.querySelector('[data-v5m-fixed="cfgRescale"]')).toBeTruthy();
  expect(slider('CFG 리스케일')!.disabled).toBe(true);
  // 저장값은 지우지 않는다(다른 계열로 돌아가면 그 계열 프로필)
  expect(preset.steps).toBe(stepsSaved);
  expect(undoService.entries(session).past).toHaveLength(0);
});
