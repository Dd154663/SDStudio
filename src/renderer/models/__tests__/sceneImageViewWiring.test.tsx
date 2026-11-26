// 이미지 뷰 1차(2026-11-26) — QueueControl 연결: 보기 방식에 따라 카드 격자 / 이미지 뷰, 「씬으로 이동」(씬 위치로 이동·북마크·등록소),
// 선택 버튼 비활성·선택 모드 끄기, 씬 포커스 단축키 무동작, 캡처 「보이는 씬」, 칸 동작(그리드 열기·씬 메뉴).
// 씬 카드 보기(cards, 기본)에서는 종전 길인지도 같이 본다.
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { observable, runInAction } from 'mobx';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const mockQueue = Object.assign(new EventTarget(), {
  statsTasksFromScene: jest.fn(() => ({ total: 0, done: 0 })),
  run: jest.fn(),
  removeAllTasks: jest.fn(),
  removeTasksFromScene: jest.fn(),
});
const mockGame = Object.assign(new EventTarget(), { getOutputs: jest.fn(() => [] as string[]) });
const mockImages = Object.assign(new EventTarget(), {
  fetchImageSmall: jest.fn(async () => 'img'),
  fetchVibeImage: jest.fn(async () => 'img'),
  getOutputDir: () => 'outs/p/s',
});
const mockBookmark: { value: any } = { value: undefined };
const mockSessions = Object.assign(new EventTarget(), {
  getSceneBookmark: () => mockBookmark.value,
  isSceneBookmarked: () => false,
  markDirty: jest.fn(),
});
const mockState: any = observable(
  {
    selectedScenes: new Set<string>(),
    selectedScenesType: 'scene',
    sceneSelectionMode: false,
    dialogs: [] as any[],
    samples: 1,
    floatViewCount: 0,
    uiToolbar: { classic: false },
    classicSceneCard: false,
    sceneToolbarLegacyText: false,
    uiToolbarButtonNames: false,
    companionSlotsView: {},
    showSceneCheatsheet: false,
    contextSceneType: undefined as any,
    curSession: undefined as any,
    pushMessage: jest.fn(),
    pushDialogAsync: jest.fn(async () => undefined as any),
    clearSceneSelection: jest.fn(),
    toggleSceneSelection: jest.fn(),
    addScenesToSelection: jest.fn(),
  },
  { curSession: observable.ref, pushMessage: false, pushDialogAsync: false, clearSceneSelection: false, toggleSceneSelection: false, addScenesToSelection: false },
);
jest.mock('react-dnd', () => ({
  useDrag: () => [{ isDragging: false }, (n: any) => n, () => {}],
  useDrop: () => [{ isOver: false }, (n: any) => n],
}));
jest.mock('react-dnd-html5-backend', () => ({ getEmptyImage: () => null }));
const mockShowMenu = jest.fn();
jest.mock('react-contexify', () => ({ useContextMenu: () => ({ show: mockShowMenu, hideAll: () => {} }) }));
jest.mock('..', () => ({
  isMobile: false,
  taskQueueService: mockQueue,
  imageService: mockImages,
  gameService: mockGame,
  sessionService: mockSessions,
  workFlowService: { getDef: () => ({ emoji: '' }), i2iFlows: [] },
  backend: {},
  localAIService: {},
  zipService: {},
  trashService: {},
  promptService: {},
}));
jest.mock('../AppService', () => ({ appState: mockState }));
jest.mock('../types', () => ({ ContextMenuType: { Scene: 'scene', Image: 'image', GallaryImage: 'gallary_image' } }));
jest.mock('../ImageService', () => ({ toggleImageMain: jest.fn(), getMainImage: jest.fn(async () => 'img') }));
jest.mock('../TaskQueueService', () => ({}));
const mockAddSceneToQueue = jest.fn(async () => {});
jest.mock('../sceneQueueActions', () => ({
  queueScene: jest.fn(async () => {}),
  addScenesToQueue: jest.fn(),
  addSceneToQueue: (...a: any[]) => (mockAddSceneToQueue as any)(...a),
}));
jest.mock('../util', () => ({}));
jest.mock('../workflows/SDWorkFlow', () => ({}));
jest.mock('../workflows/OneTimeFlows', () => ({ oneTimeFlows: [], oneTimeFlowMap: new Map() }));
jest.mock('../sceneSeedGroups', () => ({ getSceneSeedGroupInfo: () => undefined }));
jest.mock('../companionSlots', () => ({ companionAssignedIds: () => new Set() }));
jest.mock('../mobileV2', () => ({ isV2: () => false, V2_TOP_PIECE_SLOT_ID: 'a', V2_TOP_SLOT_ID: 'b' }));
const MOCK_INLINE = ['multi-select', 'scene-find', 'bookmark-jump', 'scene-capture', 'scene-view-mode'];
jest.mock('../uiLayout', () => ({
  TOOLBAR_VIEW_MAIN: [],
  SCENE_TOOLBAR_MORE_LABEL: '더보기',
  TOOLBAR_GROUP_OTHER: 'other',
  TOOLBAR_GROUP_OTHER_HINT: '',
  resolveToolbarView: () => [{ area: 'scene', inline: MOCK_INLINE, menu: [] }],
  groupToolbarIds: (ids: string[]) => [{ group: 'g', caption: 'c', ids }],
  sceneToolbarLabelOf: () => undefined,
}));
jest.mock('../BackStackService', () => ({ backStackService: { push: () => ({ remove() {} }) } }));
jest.mock('../../componenets/FloatView', () => ({ FloatView: ({ children }: any) => children }));
jest.mock('../../componenets/ModalOverlay', () => ({ children }: any) => children);
jest.mock('../../componenets/SceneEditor', () => () => null);
jest.mock('../../componenets/Tournament', () => () => null);
const mockViewer: { props?: any } = {};
jest.mock('../../componenets/ResultViewer', () => {
  const R = jest.requireActual('react');
  return R.forwardRef((props: any, _ref: any) => {
    mockViewer.props = props;
    return R.createElement('div', { 'data-viewer': props.scene?.name });
  });
});
jest.mock('../../componenets/InPaintEditor', () => () => null);
jest.mock('../../componenets/ImageReview', () => () => null);
jest.mock('../../componenets/ShortcutCheatsheet', () => () => null);
jest.mock('../../componenets/SceneQuickPromptModal', () => () => null);
jest.mock('../../componenets/BrushTool', () => ({}));
jest.mock('../../componenets/SceneSelector', () => () => null);
jest.mock('../../componenets/Tooltip', () => ({ children }: any) => children);
jest.mock('../../componenets/CombinationList', () => ({}));
jest.mock('../../componenets/ToolbarOverflowMenu', () => () => null);
jest.mock('../../componenets/SceneTotalsBadge', () => () => null);
jest.mock('../../componenets/SizeSlider', () => () => null);
jest.mock('../../componenets/ActionIcon', () => {
  const R = jest.requireActual('react');
  return { ActionIcon: ({ id }: any) => R.createElement('i', { 'data-icon': id }) };
});
jest.mock('../../componenets/ToolbarButtonName', () => ({
  ButtonNameSlot: ({ children }: any) => children,
  useButtonNameStage: () => ({ rowRef: { current: null }, mode: undefined }),
}));
const mockCapture: { props?: any } = {};
jest.mock('../../componenets/CaptureDialog', () => (props: any) => {
  mockCapture.props = props;
  return null;
});
jest.mock('../../componenets/PortableToolbarButtons', () => ({ portableToolbarButtons: () => ({}) }));
jest.mock('../../componenets/ToolbarDnd', () => ({
  useToolbarDragState: () => ({ active: false }),
  useToolbarRowDrop: () => ({ drop: () => {}, isOver: false }),
  toolbarRowHighlightClass: () => '',
  toolbarDndType: () => 'x',
  DraggableToolbarButton: ({ children }: any) => children,
  ToolbarHideZone: () => null,
  ToolbarMenuDropTarget: ({ children }: any) => children,
}));
// 이미지 뷰 자체는 별도 렌더 검사(sceneImageViewRender) — 여기서는 연결만 보도록 손잡이를 흉내 낸다
const mockHandle = {
  isReady: jest.fn(() => true),
  scrollToScene: jest.fn((_n: string) => true),
  visibleSceneNames: jest.fn(() => ['s1']),
};
const mockView: { props?: any } = {};
jest.mock('../../componenets/SceneImageView', () => {
  const R = jest.requireActual('react');
  return {
    SceneImageView: R.forwardRef((props: any, ref: any) => {
      R.useImperativeHandle(ref, () => mockHandle);
      mockView.props = props;
      return R.createElement('div', { ref: props.containerRef, 'data-mock-image-view': props.mode });
    }),
    SceneViewModeControl: () => null,
  };
});

import QueueControl from '../../componenets/SceneQueueControl';
import { getSceneRevealer, setSceneViewMode } from '../sceneImageView';

let root: Root;
let host: HTMLDivElement;
let scenes: any[];
const offsetDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');

beforeAll(() => {
  // jsdom 은 offsetParent 가 늘 null — 「보이는 탭」 판정을 통과시킨다
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', { configurable: true, get: () => document.body });
  // jsdom 에 없음 — 카드 포커스 자동 스크롤이 부른다
  if (!(Element.prototype as any).scrollIntoView) (Element.prototype as any).scrollIntoView = () => {};
});
afterAll(() => {
  if (offsetDesc) Object.defineProperty(HTMLElement.prototype, 'offsetParent', offsetDesc);
});

beforeEach(() => {
  jest.clearAllMocks();
  mockBookmark.value = undefined;
  mockViewer.props = undefined;
  mockCapture.props = undefined;
  mockHandle.scrollToScene.mockImplementation(() => true);
  scenes = ['s1', 's2'].map((name) =>
    observable({ name, type: 'scene', mains: [], slots: [], imageMap: [], preset: {}, resolution: 'portrait' }),
  );
  const session: any = {
    name: 'p',
    getScenes: () => scenes,
    sceneCardStyle: {},
    scenes: new Map(scenes.map((s) => [s.name, s])),
    inpaints: new Map(),
    hasScene: () => false,
  };
  session.getScene = (type: string, name: string) => (type === 'scene' ? session.scenes : session.inpaints).get(name);
  runInAction(() => {
    mockState.curSession = session;
    mockState.sceneSelectionMode = false;
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  setSceneViewMode('scene', 'cards');
});

const renderList = async () => {
  await act(async () => root.render(<QueueControl type="scene" isActive showPannel />));
};
const buttonOf = (icon: string) => host.querySelector(`[data-icon="${icon}"]`)!.closest('button') as HTMLButtonElement;
const shortcut = async (action: string) => {
  await act(async () => {
    window.dispatchEvent(new CustomEvent('shortcut-action', { detail: { action } }));
  });
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('씬 카드 보기(기본) = 종전 그대로', () => {
  test('카드 격자, 선택 버튼 사용 가능, 등록소는 「카드 보기」라고 답함', async () => {
    await renderList();
    expect(host.querySelector('#scene-cell-scene-s1')).not.toBeNull();
    expect(host.querySelector('[data-mock-image-view]')).toBeNull();
    expect(buttonOf('multi-select').disabled).toBe(false);
    expect(getSceneRevealer('scene')!.isImageView()).toBe(false);
  });
  test('방향키 포커스 → Enter = 그리드 열기(종전 단축키 동작)', async () => {
    await renderList();
    await shortcut('scene-right');
    await shortcut('scene-open-images');
    expect(host.querySelector('[data-viewer="s1"]')).not.toBeNull();
  });
  test('씬 위치로 이동 = 카드 DOM 스크롤(이미지 뷰 길을 타지 않음)', async () => {
    mockState.pushDialogAsync.mockResolvedValueOnce('s2');
    await renderList();
    const card = host.querySelector('#scene-cell-scene-s2') as any;
    card.scrollIntoView = jest.fn();
    card.animate = jest.fn();
    await act(async () => buttonOf('scene-find').click());
    await act(async () => {
      await sleep(120);
    });
    expect(card.scrollIntoView).toHaveBeenCalled();
    expect(mockHandle.scrollToScene).not.toHaveBeenCalled();
  });
});

describe('이미지 뷰(가로 줄)', () => {
  beforeEach(() => setSceneViewMode('scene', 'rows'));

  test('카드 대신 이미지 뷰(mode = rows), 지금 목록을 넘김, 선택 버튼 비활성, 등록소는 이미지 뷰', async () => {
    runInAction(() => {
      mockState.sceneSelectionMode = true;
    });
    await renderList();
    expect(host.querySelector('[data-mock-image-view="rows"]')).not.toBeNull();
    expect(host.querySelector('[id^="scene-cell-"]')).toBeNull();
    expect(mockView.props.mode).toBe('rows');
    expect(mockView.props.scenes.map((s: any) => s.name)).toEqual(['s1', 's2']);
    expect(buttonOf('multi-select').disabled).toBe(true);
    expect(mockState.sceneSelectionMode).toBe(false);
    const r = getSceneRevealer('scene')!;
    expect(r.isImageView()).toBe(true);
    expect(r.reveal('s2')).toBe(true);
    expect(mockHandle.scrollToScene).toHaveBeenCalledWith('s2');
  });

  test('「보기 방식」 선택 창에 가로 줄이 있고 고르면 바뀐다', async () => {
    setSceneViewMode('scene', 'cards');
    await renderList();
    mockState.pushDialogAsync.mockResolvedValueOnce('rows');
    await act(async () => buttonOf('scene-view-mode').click());
    const arg = (mockState.pushDialogAsync as jest.Mock).mock.calls.at(-1)[0];
    expect(arg.items.map((i: any) => i.text)).toEqual(['✓ 씬 카드', '씬 별로', '가로 줄', '최근 순']);
    expect(host.querySelector('[data-mock-image-view="rows"]')).not.toBeNull();
  });
});

describe('이미지 뷰(씬 별로)', () => {
  beforeEach(() => setSceneViewMode('scene', 'byScene'));

  test('카드 대신 이미지 뷰, 지금 목록·탭 종류를 넘김, 카드 DOM 없음', async () => {
    await renderList();
    expect(host.querySelector('[data-mock-image-view="byScene"]')).not.toBeNull();
    expect(host.querySelector('[id^="scene-cell-"]')).toBeNull();
    expect(mockView.props.scenes.map((s: any) => s.name)).toEqual(['s1', 's2']);
    expect(mockView.props.type).toBe('scene');
  });

  test('등록소: 이미지 뷰라고 답하고, reveal 은 격자 손잡이의 씬 스크롤을 부른다(히스토리 navigateTo 의 길)', async () => {
    await renderList();
    const r = getSceneRevealer('scene')!;
    expect(r.isImageView()).toBe(true);
    expect(r.isReady()).toBe(true);
    expect(r.reveal('s2')).toBe(true);
    expect(mockHandle.scrollToScene).toHaveBeenCalledWith('s2');
  });

  test('씬 위치로 이동 = 칸 인덱스 스크롤, 칸이 없으면 알림', async () => {
    await renderList();
    mockState.pushDialogAsync.mockResolvedValueOnce('s2');
    await act(async () => buttonOf('scene-find').click());
    await act(async () => {
      await sleep(120);
    });
    expect(mockHandle.scrollToScene).toHaveBeenCalledWith('s2');
    expect(mockState.pushMessage).not.toHaveBeenCalled();
    mockHandle.scrollToScene.mockImplementation(() => false);
    mockState.pushDialogAsync.mockResolvedValueOnce('s1');
    await act(async () => buttonOf('scene-find').click());
    await act(async () => {
      await sleep(120);
    });
    expect(mockState.pushMessage).toHaveBeenCalledWith('s1 씬에는 보여 줄 이미지가 없습니다');
  });

  test('북마크로 이동 = 칸 인덱스 스크롤', async () => {
    mockBookmark.value = { type: 'scene', name: 's2' };
    await renderList();
    await act(async () => buttonOf('bookmark-jump').click());
    expect(mockHandle.scrollToScene).toHaveBeenCalledWith('s2');
    expect(mockState.pushMessage).not.toHaveBeenCalled();
  });

  test('선택 버튼 비활성, 켜져 있던 선택 모드는 꺼지고 선택이 비워진다', async () => {
    runInAction(() => {
      mockState.sceneSelectionMode = true;
    });
    await renderList();
    expect(buttonOf('multi-select').disabled).toBe(true);
    expect(mockState.sceneSelectionMode).toBe(false);
    expect(mockState.clearSceneSelection).toHaveBeenCalled();
  });

  test('씬 포커스 단축키·A/D/F 는 아무 일도 하지 않는다', async () => {
    await renderList();
    const nav = jest.fn();
    window.addEventListener('scene-image-nav', nav);
    await shortcut('scene-right');
    await shortcut('scene-open-images');
    await shortcut('scene-open-editor');
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' }));
    });
    window.removeEventListener('scene-image-nav', nav);
    expect(host.querySelector('[data-viewer]')).toBeNull();
    expect(nav).not.toHaveBeenCalled();
    expect(mockState.sceneSelectionMode).toBe(false);
    // 예약 실행은 씬 포커스와 무관 — 그대로
    await shortcut('queue-run');
    expect(mockQueue.run).toHaveBeenCalled();
  });

  test('캡처 「보이는 씬」 = 이미지 뷰가 보이는 씬', async () => {
    await renderList();
    await act(async () => buttonOf('scene-capture').click());
    expect(mockHandle.visibleSceneNames).toHaveBeenCalled();
    const visible = mockCapture.props.scopes.find((s: any) => s.key === 'visible');
    expect(visible.count).toBe(1);
  });

  test('칸 동작: 이미지 = 그 씬 그리드를 그 이미지로, 씬 메뉴 = 씬 카드 우클릭과 같은 메뉴', async () => {
    await renderList();
    await act(async () => mockView.props.onOpenImage(scenes[1], '1700000000001.png'));
    expect(host.querySelector('[data-viewer="s2"]')).not.toBeNull();
    expect(mockViewer.props.focusFilename).toBe('1700000000001.png');
    const ev = { clientX: 1, clientY: 2 } as any;
    await act(async () => mockView.props.onSceneMenu(scenes[0], ev));
    expect(mockState.contextSceneType).toBe('scene');
    expect(mockShowMenu).toHaveBeenCalledWith({ event: ev, props: { ctx: { type: 'scene', scene: scenes[0] } } });
  });

  test('첫 칸의 호버 버튼 넷: 예약 추가·제거는 씬 카드와 같은 길, 북마크된 씬 이름을 넘김', async () => {
    mockBookmark.value = { type: 'scene', name: 's2' };
    await renderList();
    expect(mockView.props.bookmarkedScene).toBe('s2');
    await act(async () => mockView.props.onQueueAdd(scenes[0]));
    expect(mockAddSceneToQueue).toHaveBeenCalledWith(mockState.curSession, scenes[0]);
    await act(async () => mockView.props.onQueueRemove(scenes[1]));
    expect(mockQueue.removeTasksFromScene).toHaveBeenCalledWith(scenes[1]);
    expect(typeof mockView.props.onEditScene).toBe('function');
    expect(typeof mockView.props.onToggleBookmark).toBe('function');
  });

  test('「보기 방식」 버튼 = 선택 창 → 고른 방식으로 바뀜(카드로 돌아가기)', async () => {
    await renderList();
    mockState.pushDialogAsync.mockResolvedValueOnce('cards');
    await act(async () => buttonOf('scene-view-mode').click());
    expect(mockState.pushDialogAsync).toHaveBeenCalledWith(expect.objectContaining({ type: 'select' }));
    expect(host.querySelector('#scene-cell-scene-s1')).not.toBeNull();
    expect(host.querySelector('[data-mock-image-view]')).toBeNull();
  });
});
