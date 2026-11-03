/**
 * 조합 계열 변형 씬(조합 모드 I2I·인페인트·미러) 편집 창 「프롬프트 에디터」 탭 정렬(2026-11-03, SPEC §7-4).
 * - 순서 = 단일 계열과 같음: 이미지 → 강도·노이즈(인페인트·미러: 강도·비마스크 보호) → 중간 프롬프트 → [상위·하위 — 레거시만]
 *   → 전역 네거티브(기본 접힘 + 「사용」 토글) → 씬 전용 네거티브 → 캐릭터 → 샘플링 안내 → 시드 → 바이브(→ 캐릭터 레퍼런스).
 * - 모드 표시·「조합 모드 끄기」는 중간 프롬프트 머리 줄(미러는 없음).
 * - 전역 네거티브 「사용」 = 씬 프리셋 useGlobalUc(되돌리기 경로 setWorkflowField), 접힘은 저장하지 않는 UI 상태.
 * 실제 ComboPromptEditor·InnerPreSetEditor(inner=true)와 편집 칸 정의를 렌더한다. 무거운 하위 컴포넌트·서비스만 모킹한다.
 */
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { configure, observable } from 'mobx';

const mockState: any = {
  uiPresetLayout: {},
  uiCompanionSlots: {},
  uiPresetIconRow: false,
  editMode: false,
  legacySceneEditor: false,
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
import { COMBO_EDITOR_TEXT } from '../comboMode';
import { ComboPromptEditor, resetComboGlobalUcFold } from '../../componenets/ComboPromptEditor';
import { InnerPreSetEditor } from '../../componenets/PreSetEdtior';
import { Session } from '../types';
import { undoService } from '../undoService';

let container: HTMLDivElement;
let root: Root;
let mainPreset: any;
const mainSession = () => ({
  name: 'project',
  presets: new Map(),
  presetShareds: new Map(),
  inpaints: new Map(),
  selectedWorkflow: { workflowType: 'SDImageGen', presetName: 'main' },
  getCommonSetup: () => ['SDImageGen', mainPreset, { normalizeStrength: false }, undefined],
});
beforeEach(() => {
  configure({ enforceActions: 'never' });
  (global as any).IS_REACT_ACT_ENVIRONMENT = true;
  mockState.uiPresetLayout = {};
  mockState.legacySceneEditor = false;
  mainPreset = observable({
    steps: 23, promptGuidance: 4.5, cfgRescale: 0.2, sampling: 'k_dpmpp_2m',
    frontPrompt: 'MAIN-F', backPrompt: 'MAIN-B', uc: 'MAIN-UC',
  });
  mockState.curSession = mainSession();
  resetComboGlobalUcFold();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  mockState.curSession = undefined;
});

/** 화면의 글자 조각(빈 칸·쌍점 제외) — 문서 순서 */
const texts = () => {
  const out: string[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = (n.textContent ?? '').replace(/:\s*$/, '').trim();
    if (t) out.push(t);
  }
  return out;
};
const indexOfText = (label: string) => texts().indexOf(label);
const expectOrder = (labels: string[]) => {
  const at = labels.map(indexOfText);
  labels.forEach((l, i) => {
    if (at[i] < 0) throw new Error(`없음: ${l}\n${texts().join(' | ')}`);
  });
  for (let i = 1; i < at.length; i++) {
    if (!(at[i - 1] < at[i])) {
      throw new Error(`순서 어긋남: ${labels[i - 1]} → ${labels[i]}\n${texts().join(' | ')}`);
    }
  }
};
const textareaValues = () => [...container.querySelectorAll('textarea')].map((t) => t.value);
const toggle = () => container.querySelector('[data-combo-global-uc-toggle]') as HTMLInputElement | null;
const button = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === label);
const clickText = (label: string) => {
  const span = [...container.querySelectorAll('span')].find(
    (s) => s.textContent === label && s.className.includes('cursor-pointer'),
  );
  if (!span) throw new Error(`머리 없음: ${label}`);
  act(() => span.dispatchEvent(new MouseEvent('click', { bubbles: true })));
};

const variantScene = (workflowType: string, preset: any, comboMode?: 'shared' | 'snapshot') =>
  observable({ type: 'inpaint', name: 'v1', workflowType, comboMode, preset, slots: [] as any[] }) as any;

const renderCombo = async (opts: {
  def: any;
  element: any;
  mode: 'shared' | 'snapshot';
  canTurnOff: boolean;
  preset?: any;
  onTurnOff?: () => void;
  setPromptRow?: (target: any, field: string, label: string, v: string) => void;
  /** 씬을 등록할 세션(되돌리기 기록 확인용) */
  session?: any;
}) => {
  const preset = opts.preset ?? new WFWorkFlow(opts.def).buildPreset();
  const scene = variantScene(opts.def.type, preset, opts.def.type === 'SDMirror' ? undefined : opts.mode);
  if (opts.session) opts.session.inpaints.set(scene.name, scene);
  let middle = preset.prompt || '';
  await act(async () => {
    root.render(
      <ComboPromptEditor
        scene={scene}
        mode={opts.mode}
        globalPreset={opts.mode === 'shared' ? mainPreset : null}
        element={opts.element}
        canTurnOff={opts.canTurnOff}
        pc
        getMiddlePrompt={() => middle}
        setMiddlePrompt={(v) => {
          middle = v;
        }}
        setPromptRow={opts.setPromptRow ?? ((target, field, _l, v) => { target[field] = v; })}
        onTurnOff={opts.onTurnOff ?? (() => {})}
      />,
    );
  });
  return { preset, scene };
};

const NOTICE = VARIANT_SAMPLING_TEXT.notice;

describe('조합 모드 I2I — 단일 계열 순서', () => {
  test('snapshot: 이미지 → 강도 → 노이즈 → 중간 → 전역 네거티브 → 씬 전용 네거티브 → 캐릭터 → 안내 → 시드 → 바이브 → 레퍼런스', async () => {
    const preset = new WFWorkFlow(SDI2IDef).buildPreset();
    Object.assign(preset, { frontPrompt: 'SNAP-F', backPrompt: 'SNAP-B', globalUc: 'SNAP-UC', uc: 'SCENE-UC', prompt: 'MID' });
    await renderCombo({ def: SDI2IDef, element: SDI2IComboUI, mode: 'snapshot', canTurnOff: true, preset });
    expectOrder([
      '이미지',
      '강도',
      '노이즈',
      COMBO_EDITOR_TEXT.middle,
      COMBO_EDITOR_TEXT.modeSnapshot,
      COMBO_EDITOR_TEXT.turnOff,
      COMBO_EDITOR_TEXT.snapshotUc,
      COMBO_EDITOR_TEXT.useGlobalUc,
      COMBO_EDITOR_TEXT.sceneUc,
      '캐릭터 프롬프트 열기',
      NOTICE,
      '시드',
      '바이브 설정',
      '캐릭터 레퍼런스',
    ]);
    // 레거시 꺼짐 = 상위·하위 없음
    expect(indexOfText(COMBO_EDITOR_TEXT.snapshotFront)).toBe(-1);
    expect(indexOfText(COMBO_EDITOR_TEXT.snapshotBack)).toBe(-1);
    // 전역 네거티브는 기본 접힘(값은 칸에 없음 — 「작성됨」 배지) + 「사용」 켜짐
    expect(textareaValues()).toEqual(['MID', 'SCENE-UC']);
    expect(indexOfText('작성됨')).toBeGreaterThan(indexOfText(COMBO_EDITOR_TEXT.snapshotUc));
    expect(toggle()?.checked).toBe(true);
    expect(indexOfText(COMBO_EDITOR_TEXT.globalUcExcluded)).toBe(-1);
    // 단일 「프롬프트」 칸 없음
    expect(indexOfText('프롬프트')).toBe(-1);
  });

  test('레거시 씬 편집기 모드면 중간 프롬프트와 전역 네거티브 사이에 상위·하위', async () => {
    mockState.legacySceneEditor = true;
    const preset = new WFWorkFlow(SDI2IDef).buildPreset();
    Object.assign(preset, { frontPrompt: 'SNAP-F', backPrompt: 'SNAP-B', globalUc: 'SNAP-UC' });
    await renderCombo({ def: SDI2IDef, element: SDI2IComboUI, mode: 'snapshot', canTurnOff: true, preset });
    expectOrder([
      COMBO_EDITOR_TEXT.middle,
      COMBO_EDITOR_TEXT.snapshotFront,
      COMBO_EDITOR_TEXT.snapshotBack,
      COMBO_EDITOR_TEXT.snapshotUc,
      COMBO_EDITOR_TEXT.sceneUc,
    ]);
    expect(textareaValues()).toEqual(['', 'SNAP-F', 'SNAP-B', '']);
  });

  test('「사용」 토글 = 씬 프리셋 useGlobalUc, 끄면 「생성에서 제외」 표시 · 머리를 누르면 펼쳐 값 편집(접힘은 저장 안 함)', async () => {
    const preset = new WFWorkFlow(SDI2IDef).buildPreset();
    Object.assign(preset, { globalUc: 'SNAP-UC' });
    const turnOff = jest.fn();
    // 등록된 변형 씬 프리셋 = 되돌리기 기록 범위(presetUndo.setWorkflowField)
    const session = new Session();
    session.name = 'p';
    mockState.curSession = session;
    await renderCombo({
      def: SDI2IDef, element: SDI2IComboUI, mode: 'snapshot', canTurnOff: true, preset, onTurnOff: turnOff, session,
    });
    expect(preset.useGlobalUc).toBe(true);
    expect(undoService.entries(session).past).toHaveLength(0);
    act(() => toggle()!.click());
    expect(preset.useGlobalUc).toBe(false);
    expect(undoService.entries(session).past).toHaveLength(1);
    expect(undoService.entries(session).past[0].label).toContain(COMBO_EDITOR_TEXT.useGlobalUcField);
    expect(toggle()!.checked).toBe(false);
    expect(indexOfText(COMBO_EDITOR_TEXT.globalUcExcluded)).toBeGreaterThan(-1);
    // 토글을 눌러도 접힘은 그대로
    expect(textareaValues()).not.toContain('SNAP-UC');
    clickText(COMBO_EDITOR_TEXT.snapshotUc);
    expect(textareaValues()).toContain('SNAP-UC');
    // 「조합 모드 끄기」 버튼은 중간 프롬프트 머리 줄에서 그대로 동작
    act(() => button(COMBO_EDITOR_TEXT.turnOff)!.click());
    expect(turnOff).toHaveBeenCalledTimes(1);
    // 되돌리기 = 다시 켜짐
    await act(async () => {
      await undoService.undo(session);
    });
    expect(preset.useGlobalUc).toBe(true);
    expect(toggle()!.checked).toBe(true);
    // 접힘 상태 데이터는 프리셋에 없다
    expect(Object.keys(preset.toJSON())).not.toContain('globalUcFolded');
  });

  test('shared: 전역 네거티브 칸 = 현재 사전 세팅 uc(쓰기도 사전 세팅), 토글은 씬 프리셋', async () => {
    mockState.legacySceneEditor = true;
    const preset = new WFWorkFlow(SDI2IDef).buildPreset();
    const calls: [any, string, string][] = [];
    await renderCombo({
      def: SDI2IDef,
      element: SDI2IComboUI,
      mode: 'shared',
      canTurnOff: true,
      preset,
      setPromptRow: (target, field, _l, v) => {
        calls.push([target, field, v]);
        target[field] = v;
      },
    });
    expectOrder([
      COMBO_EDITOR_TEXT.middle,
      COMBO_EDITOR_TEXT.modeShared,
      COMBO_EDITOR_TEXT.sharedFront,
      COMBO_EDITOR_TEXT.sharedBack,
      COMBO_EDITOR_TEXT.sharedUc,
      COMBO_EDITOR_TEXT.sceneUc,
    ]);
    clickText(COMBO_EDITOR_TEXT.sharedUc);
    expect(textareaValues()).toEqual(['', 'MAIN-F', 'MAIN-B', 'MAIN-UC', '']);
    const ucArea = [...container.querySelectorAll('textarea')][3];
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(ucArea, 'NEW-UC');
      ucArea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(calls).toContainEqual([mainPreset, 'uc', 'NEW-UC']);
    expect(mainPreset.uc).toBe('NEW-UC');
    act(() => toggle()!.click());
    expect(preset.useGlobalUc).toBe(false);
    expect(mainPreset.useGlobalUc).toBeUndefined();
  });
});

test('조합 모드 인페인트 — 이미지 → 강도 → 비마스크 보호 → 중간 → 전역 네거티브 → 씬 전용 네거티브 → 캐릭터 → 안내 → 시드 → 바이브', async () => {
  await renderCombo({ def: SDInpaintDef, element: SDInpaintComboUI, mode: 'snapshot', canTurnOff: true });
  expectOrder([
    '이미지',
    '인페인트 강도',
    '비마스크 영역 편집 방지',
    COMBO_EDITOR_TEXT.middle,
    COMBO_EDITOR_TEXT.turnOff,
    COMBO_EDITOR_TEXT.snapshotUc,
    COMBO_EDITOR_TEXT.sceneUc,
    '캐릭터 프롬프트 열기',
    NOTICE,
    '시드',
    '바이브 설정',
  ]);
  expect(indexOfText(COMBO_EDITOR_TEXT.snapshotFront)).toBe(-1);
  expect(toggle()?.checked).toBe(true);
});

describe('미러 — 같은 순서, 모드 표시·끄기 없음', () => {
  test('강도 → 비마스크 보호 → 중간 → 전역 네거티브(사전 세팅) → 씬 전용 네거티브 → 캐릭터 → 안내 → 시드 → 바이브', async () => {
    await renderCombo({ def: SDMirrorDef, element: SDMirrorDef.editor, mode: 'shared', canTurnOff: false });
    expectOrder([
      '인페인트 강도',
      '비마스크 영역 편집 방지',
      COMBO_EDITOR_TEXT.middle,
      COMBO_EDITOR_TEXT.sharedUc,
      COMBO_EDITOR_TEXT.useGlobalUc,
      COMBO_EDITOR_TEXT.sceneUc,
      '캐릭터 프롬프트 열기',
      NOTICE,
      '시드',
      '바이브 설정',
    ]);
    expect(indexOfText('이미지')).toBe(-1);
    expect(button(COMBO_EDITOR_TEXT.turnOff)).toBeUndefined();
    expect(indexOfText(COMBO_EDITOR_TEXT.modeShared)).toBe(-1);
    expect(indexOfText(COMBO_EDITOR_TEXT.sharedFront)).toBe(-1);
    expect(toggle()?.checked).toBe(true);
  });

  test('레거시 모드면 상위·하위(사전 세팅) 표시', async () => {
    mockState.legacySceneEditor = true;
    await renderCombo({ def: SDMirrorDef, element: SDMirrorDef.editor, mode: 'shared', canTurnOff: false });
    expectOrder([
      COMBO_EDITOR_TEXT.middle,
      COMBO_EDITOR_TEXT.sharedFront,
      COMBO_EDITOR_TEXT.sharedBack,
      COMBO_EDITOR_TEXT.sharedUc,
      COMBO_EDITOR_TEXT.sceneUc,
    ]);
  });
});

describe('단일 I2I·인페인트 — 「조합 모드 켜기」 자리(2026-11-03)', () => {
  const renderSingle = async (def: any, headerEnds?: any) => {
    const preset = new WFWorkFlow(def).buildPreset();
    await act(async () => {
      root.render(
        <InnerPreSetEditor
          nopad
          type={def.type}
          preset={preset}
          shared={undefined}
          element={def.editor}
          middlePromptMode={false}
          fieldHeaderEnds={headerEnds}
        />,
      );
    });
  };
  const turnOn = () => <button>{COMBO_EDITOR_TEXT.turnOn}</button>;

  test.each([
    ['I2I', SDI2IDef, '노이즈'],
    ['인페인트', SDInpaintDef, '비마스크 영역 편집 방지'],
  ])('%s: 「프롬프트」 칸 머리 줄 끝에 버튼(네거티브 칸보다 앞), 넘기지 않으면 없음', async (_n, def, before) => {
    await renderSingle(def, { prompt: turnOn });
    expectOrder([before as string, '프롬프트', COMBO_EDITOR_TEXT.turnOn, '네거티브 프롬프트']);
    const b = button(COMBO_EDITOR_TEXT.turnOn)!;
    // 머리 줄(EditorField headerEnd) 안 — 끄기 버튼과 같은 자리 감각
    expect(b.closest('[data-editor-field-header-end]')).not.toBeNull();
    expect(container.querySelectorAll('[data-editor-field-header-end]')).toHaveLength(1);
    await renderSingle(def, undefined);
    expect(button(COMBO_EDITOR_TEXT.turnOn)).toBeUndefined();
    expect(container.querySelectorAll('[data-editor-field-header-end]')).toHaveLength(0);
  });
});
