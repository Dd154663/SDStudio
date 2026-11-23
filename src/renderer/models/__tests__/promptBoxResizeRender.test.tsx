/**
 * PC 메인 패널 프롬프트 칸 사이 높이 비율 손잡이 — 렌더(2026-11-23, componenets/PromptBoxResize.tsx).
 *  - 메인 패널(PreSetEditor promptResize, PC): 펼친 칸 사이마다 손잡이, 마지막 칸 아래 없음, 접힌 칸 건너뜀,
 *    펼친 칸 하나면 없음, 요소 순서 편집모드에서 숨김(래퍼는 가중치), 끌기 뒤 저장, 두 번 누름 균등.
 *  - promptResize 없는 PreSetEditor(씬 편집 창 general)·inner 편집기·모바일: 손잡이도 가중치 style 도 없음(종전 마크업).
 * undoPresetEditorRender.test.tsx 와 같은 모킹 틀.
 */
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { configure } from 'mobx';

const mockConfig: any = { modelVersion: '5-full' };
const mockEnv = { isMobile: false };
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
    get isMobile() {
      return mockEnv.isMobile;
    },
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
// 편집모드 래퍼 — 받은 가중치를 표식으로 드러낸다
jest.mock('../../componenets/PresetLayoutDnd', () => ({
  DraggablePresetRow: ({ children, elementKey, growWeight }: any) => (
    <div data-row={elementKey} data-grow-weight={growWeight === undefined ? '' : String(growWeight)}>{children}</div>
  ),
  resetPresetOrder: () => {},
  isPresetAnchorKey: (k: string) => k === 'preset-select',
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
import { resetPresetUndoState } from '../presetUndo';
import { flushSceneFieldEdit } from '../sceneFieldUndo';
import PreSetEditor, { InnerPreSetEditor } from '../../componenets/PreSetEdtior';
import { PROMPT_BOX_WEIGHTS_LS_KEY } from '../promptBoxWeights';

const { SDImageGenDef } = jest.requireActual('../workflows/SDWorkFlow');

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  configure({ enforceActions: 'never' });
  (global as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  mockState.curSession = undefined;
  mockState.editMode = false;
  mockEnv.isMobile = false;
  flushSceneFieldEdit();
  resetPresetUndoState();
});

const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

const setFold = (m: Record<string, boolean>) => localStorage.setItem('sdstudio-prompt-fold', JSON.stringify(m));

async function renderMain(props: { promptResize?: boolean } = { promptResize: true }) {
  const session = new Session();
  session.name = 'p';
  mockState.curSession = session;
  await act(async () => {
    root.render(<PreSetEditor middlePromptMode={false} {...props} />);
  });
  await flush();
  return session;
}

const handles = () =>
  [...container.querySelectorAll('[data-prompt-box-handle]')].map((h) => h.getAttribute('data-prompt-box-handle'));
const handle = (k: string) => container.querySelector(`[data-prompt-box-handle="${k}"]`) as HTMLElement;
const body = (k: string) => container.querySelector(`[data-prompt-box="${k}"]`) as HTMLElement;
const headerOf = (label: string) =>
  [...container.querySelectorAll('span.cursor-pointer')].find((s) => s.textContent === label) as HTMLElement;

test('메인 패널(PC): 펼친 칸 사이마다 손잡이, 마지막 칸 아래 없음 — 기본은 추가 프롬프트 접힘이라 상위·하위 아래 둘', async () => {
  await renderMain();
  expect(handles()).toEqual(['frontPrompt', 'backPrompt']);
  const h = handle('frontPrompt');
  expect(h.getAttribute('role')).toBe('separator');
  expect(h.getAttribute('aria-orientation')).toBe('horizontal');
  expect(h.getAttribute('aria-label')).toBe('프롬프트 칸 높이 조절');
  expect(h.getAttribute('title')).toBe('끌어서 칸 높이 조절 (두 번 누르면 균등하게)');
  expect(h.getAttribute('tabindex')).toBeNull(); // 탭 순서에 넣지 않음
  // 손잡이 줄은 레이아웃 높이 0(간격 불변)
  expect(h.parentElement!.className).toBe('relative flex-none h-0');
  // 칸 본문은 종전 클래스 + 가중치
  expect(body('frontPrompt').className).toBe('flex-1 min-h-0');
  expect(body('frontPrompt').style.flexGrow).toBe('1');
  expect(body('uc').style.flexGrow).toBe('1');
});

test('접힌 칸은 건너뛰고, 추가 프롬프트를 펴면 그 사이에도 손잡이', async () => {
  await renderMain();
  await act(async () => headerOf('하위 프롬프트').click());
  expect(handles()).toEqual(['frontPrompt']); // 상위 ↔ 네거티브
  await act(async () => headerOf('추가 프롬프트').click());
  expect(handles()).toEqual(['frontPrompt', 'extraPrompt']);
  await act(async () => headerOf('하위 프롬프트').click());
  expect(handles()).toEqual(['frontPrompt', 'extraPrompt', 'backPrompt']);
});

test('펼친 칸이 하나뿐이면 손잡이 없음', async () => {
  setFold({ backPrompt: true, uc: true });
  await renderMain();
  expect(handles()).toEqual([]);
  expect(body('frontPrompt')).toBeTruthy();
});

test('요소 순서 편집모드: 손잡이 숨김, 래퍼는 펼친 칸 가중치를 따른다', async () => {
  localStorage.setItem(PROMPT_BOX_WEIGHTS_LS_KEY, JSON.stringify({ frontPrompt: 1.5, backPrompt: 0.5 }));
  mockState.editMode = true;
  await renderMain();
  expect(handles()).toEqual([]);
  const row = (k: string) => container.querySelector(`[data-row="${k}"]`)!.getAttribute('data-grow-weight');
  expect(row('frontPrompt')).toBe('1.5');
  expect(row('backPrompt')).toBe('0.5');
  expect(row('uc')).toBe('1');
  expect(row('extra-prompt')).toBe(''); // 접힘 = 종전
  expect(row('seed')).toBe('');
});

describe('끌기', () => {
  let rafs: FrameRequestCallback[] = [];
  beforeEach(() => {
    rafs = [];
    (global as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
      rafs.push(cb);
      return rafs.length;
    };
    (global as any).cancelAnimationFrame = (id: number) => {
      rafs[id - 1] = () => {};
    };
  });
  const runFrames = () => {
    const list = rafs;
    rafs = [];
    list.forEach((f) => f(0));
  };
  const stubHeights = (h: Record<string, number>) => {
    for (const [k, v] of Object.entries(h)) {
      body(k).getBoundingClientRect = () => ({ height: v, width: 100, top: 0, left: 0, right: 100, bottom: v, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    }
  };

  test('두 칸이 높이를 주고받고(프레임당 한 번), 뗄 때 저장 / 편집기 포커스를 빼앗지 않음', async () => {
    await renderMain();
    stubHeights({ frontPrompt: 200, backPrompt: 200, uc: 200 });
    const ta = body('frontPrompt').querySelector('textarea')!;
    ta.focus();
    let down!: MouseEvent;
    await act(async () => {
      down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientY: 100, button: 0 });
      handle('frontPrompt').dispatchEvent(down);
    });
    expect(down.defaultPrevented).toBe(true);
    expect(document.body.style.userSelect).toBe('none');
    await act(async () => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientY: 120 }));
      document.dispatchEvent(new MouseEvent('mousemove', { clientY: 150 }));
    });
    expect(rafs).toHaveLength(1); // 한 프레임으로 묶임
    await act(async () => runFrames());
    expect(Number(body('frontPrompt').style.flexGrow)).toBeCloseTo(1.25);
    expect(Number(body('backPrompt').style.flexGrow)).toBeCloseTo(0.75);
    expect(body('uc').style.flexGrow).toBe('1'); // 다른 칸은 그대로
    expect(localStorage.getItem(PROMPT_BOX_WEIGHTS_LS_KEY)).toBeNull(); // 끄는 중엔 저장 안 함
    await act(async () => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientY: 10000 }));
      document.dispatchEvent(new MouseEvent('mouseup', {}));
    });
    // 하한(jsdom 은 줄 높이를 못 읽음 → 48px): 아래 칸 48 / 400
    expect(Number(body('backPrompt').style.flexGrow)).toBeCloseTo((2 * 48) / 400);
    const saved = JSON.parse(localStorage.getItem(PROMPT_BOX_WEIGHTS_LS_KEY)!);
    expect(saved.frontPrompt + saved.backPrompt).toBeCloseTo(2);
    expect(saved.uc).toBeUndefined();
    expect(document.body.style.userSelect).toBe('');
    expect(document.activeElement).toBe(ta);
  });

  test('두 번 누르면 모든 칸 균등(저장값 지움)', async () => {
    localStorage.setItem(PROMPT_BOX_WEIGHTS_LS_KEY, JSON.stringify({ frontPrompt: 1.5, backPrompt: 0.7, uc: 0.8 }));
    await renderMain();
    expect(body('frontPrompt').style.flexGrow).toBe('1.5'); // 다시 켜도 기억
    await act(async () => {
      handle('backPrompt').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    });
    expect(['frontPrompt', 'backPrompt', 'uc'].map((k) => body(k).style.flexGrow)).toEqual(['1', '1', '1']);
    expect(localStorage.getItem(PROMPT_BOX_WEIGHTS_LS_KEY)).toBeNull();
  });

  test('접었다 펴도 그 칸의 비율은 기억된 값', async () => {
    localStorage.setItem(PROMPT_BOX_WEIGHTS_LS_KEY, JSON.stringify({ backPrompt: 0.6 }));
    await renderMain();
    await act(async () => headerOf('하위 프롬프트').click());
    expect(body('backPrompt')).toBeNull();
    await act(async () => headerOf('하위 프롬프트').click());
    expect(body('backPrompt').style.flexGrow).toBe('0.6');
  });
});

describe('번지지 않음(종전 마크업 그대로)', () => {
  const plainBodies = () =>
    [...container.querySelectorAll('textarea')].map((t) => t.parentElement as HTMLElement);
  const expectPlain = () => {
    expect(container.querySelector('[data-prompt-box-handle]')).toBeNull();
    expect(container.querySelector('[data-prompt-box]')).toBeNull();
    const bodies = plainBodies();
    expect(bodies.length).toBeGreaterThan(0);
    for (const b of bodies) {
      expect(b.className).toBe('flex-1 min-h-0');
      expect(b.getAttribute('style')).toBeNull();
    }
  };
  beforeEach(() => {
    localStorage.setItem(PROMPT_BOX_WEIGHTS_LS_KEY, JSON.stringify({ frontPrompt: 1.5, backPrompt: 0.5 }));
  });
  test('promptResize 없는 PreSetEditor(씬 편집 창 general·모바일 편집 창 경로)', async () => {
    await renderMain({});
    expectPlain();
  });
  test('모바일에서는 promptResize 를 넘겨도 꺼짐', async () => {
    mockEnv.isMobile = true;
    await renderMain();
    expectPlain();
  });
  test('inner 편집기(InnerPreSetEditor)', async () => {
    const session = new Session();
    session.name = 'p';
    mockState.curSession = session;
    const { WFWorkFlow } = jest.requireActual('../workflows/WorkFlow');
    const wf = new WFWorkFlow(SDImageGenDef);
    const preset = wf.buildPreset();
    const shared = wf.buildShared();
    await act(async () => {
      root.render(
        <InnerPreSetEditor type="SDImageGen" preset={preset} shared={shared} element={SDImageGenDef.editor} middlePromptMode={false} />,
      );
    });
    await flush();
    expectPlain();
  });
});
