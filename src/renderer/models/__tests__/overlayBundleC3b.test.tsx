// 오버레이 묶음 C-3b(2026-11-15, SPEC 「오버레이 창 크기 체계」 높이 규칙 우선순위 (2)) —
// 템플릿 편집기 본문 PC 두 열: 템플릿 탭 = 왼쪽(프롬프트·캐릭터 프롬프트) | 오른쪽(캐릭터 프리셋·바이브·레퍼런스·씬 구성),
// 일괄 생성 탭 = 왼쪽(안내·공유 프롬프트) | 오른쪽(대상 폴더·축·미리보기·진행), 열마다 스크롤 하나·본문 자신은 h-full.
// 캐릭터 편집(템플릿 탭 편집·일괄 생성 즉석 생성) = 안쪽 편집기 layout="frame" + 호스트 bodyPadding none.
// 프롬프트 칸은 flex 열 min-h-20·max-h-40 감싸기(빈 상태 3줄, 약 6줄 뒤 칸 안 스크롤). 모바일은 종전 한 열·inline.
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';

const mockEnv = { mobile: false };

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
  patchPreset: jest.fn(async () => {}),
  isEmptyTemplate: jest.fn(() => false),
  overwriteFromTemplate: jest.fn(async () => {}),
  storeImageForEditor: jest.fn(),
  getImagePath: jest.fn(),
};
function mkTpl(id: string, name: string, folderLocal = false): any {
  return {
    id,
    name,
    folderLocal,
    preset: {
      frontPrompt: 'front-' + id,
      backPrompt: '',
      uc: '',
      characterPrompts: [{ id: 'c1', prompt: '', uc: '', position: { x: 0.5, y: 0.5 }, enabled: true }],
    },
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
    listSceneTemplates: jest.fn(() => ['씬A']),
    getFolderTemplate: jest.fn(() => ({ templateId: 'fl' })),
    setFolderTemplate: jest.fn(async () => {}),
    hasApplications: jest.fn(() => false),
    listInheritedChildren: jest.fn(() => []),
  },
  globalPresetService: { loaded: true, presets: [], load: jest.fn() },
  globalCharacterPresetService: {
    loaded: true,
    list: () => [{ id: 'g1', name: '캐릭A', folder: '', preset: {} }],
    listFolders: () => [],
    load: jest.fn(),
    fetchImageData: jest.fn(async () => null),
    addPresetObject: jest.fn(),
  },
  sessionService: {
    list: () => [],
    applyProjectTemplateToSession: jest.fn(),
    createFolder: jest.fn(),
    batchCreateFromTemplate: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  },
  backend: { getConfig: jest.fn(async () => ({})) },
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
// 실물 열거형(모델 계열 알약이 naiModelCapabilities 의 모델 표를 읽는다, 2026-11-15 B안)
jest.mock('../../backends/imageGen', () => jest.requireActual('../../backends/imageGen'));
// 사전 세팅 편집기(무거운 모듈)는 V5M 네거티브 안내만 쓴다
jest.mock('../../componenets/PreSetEdtior', () => ({
  V5MediumNegativeNotice: () => <div data-v5m-negative-notice="" />,
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
jest.mock('../../componenets/HelpIcon', () => () => null);
jest.mock('../../componenets/PromptEditTextArea', () => (props: any) => (
  <textarea data-prompt-area="" className={props.className} value={props.value} onChange={(e) => props.onChange(e.target.value)} />
));
// 안쪽 편집기 가짜 — 받은 layout 만 드러낸다(실물 frame 배치는 overlayBundleC3 가 검사)
jest.mock('../../componenets/CharacterPresetInnerEditor', () => ({
  CharacterPresetInnerEditor: (props: any) => (
    <div data-test-inner-editor="" data-preset-editor-layout={props.layout ?? 'inline'} />
  ),
}));
jest.mock('../../componenets/CharacterPresetCards', () => ({
  VibeImage: () => null,
  GlobalFolderFilterChips: () => null,
  globalImageBackend: { vibePath: () => '', referencePath: () => '' },
}));
jest.mock('../../componenets/GlobalPresetPicker', () => ({ GlobalPresetPicker: () => null }));
jest.mock('../../componenets/VibeEditor', () => ({ EditableSliderValue: () => null }));
jest.mock('../../componenets/UtilComponents', () => ({ FileUploadBase64: () => null }));

import { TemplateManagerModal } from '../../componenets/TemplateManagerModal';
import { FolderTemplateModal } from '../../componenets/TemplateInheritModals';

let root: Root;
let container: HTMLDivElement;
beforeAll(() => {
  (global as any).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  jest.clearAllMocks();
  mockEnv.mobile = false;
  mockTemplates.length = 0;
  mockTemplates.push(mkTpl('t1', '첫 템플릿'), mkTpl('fl', '폴더 기본 (A)', true));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const q = (sel: string) => container.querySelector<HTMLElement>(sel);
const slot = (name: string) => q(`[data-modal-slot="${name}"]`);
const click = async (el: Element | null | undefined) => {
  expect(el).toBeTruthy();
  await act(async () => {
    (el as HTMLElement).click();
  });
};
const tabButton = (label: string) =>
  Array.from(container.querySelectorAll('[data-template-tabs] button')).find(
    (b) => b.textContent === label,
  ) as HTMLElement | undefined;
const buttonByText = (scope: Element, text: string) =>
  Array.from(scope.querySelectorAll('button')).find((b) =>
    (b.textContent || '').includes(text),
  ) as HTMLElement | undefined;
const COL = 'flex-1 min-w-0 min-h-0 overflow-y-auto';

const renderManager = async () => {
  await act(async () => root.render(<TemplateManagerModal isOpen onClose={jest.fn()} />));
};
const renderFolder = async () => {
  await act(async () => root.render(<FolderTemplateModal folder="A" isOpen onClose={jest.fn()} />));
};

const expectTemplateTwoCol = () => {
  const body = slot('body')!;
  const two = body.querySelector('[data-template-body="two-col"]') as HTMLElement;
  expect(two).not.toBeNull();
  // 본문 자신은 높이만 채우고 스크롤하지 않는다
  expect(two.className).toContain('h-full min-h-0');
  expect(two.className).not.toContain('overflow');
  const left = two.querySelector('[data-template-col="left"]') as HTMLElement;
  const right = two.querySelector('[data-template-col="right"]') as HTMLElement;
  expect(left.className).toContain(COL);
  expect(right.className).toContain(COL);
  // 왼쪽 = 글 입력, 오른쪽 = 카드·이미지·목록
  expect(left.textContent).toContain('프롬프트');
  expect(left.textContent).toContain('캐릭터 프롬프트 (');
  expect(left.querySelector('[data-template-prompt-box="front"]')).not.toBeNull();
  expect(left.textContent).not.toContain('씬 구성');
  expect(left.textContent).not.toContain('바이브 이미지');
  for (const h of ['캐릭터 프리셋 (', '바이브 이미지', '캐릭터 레퍼런스', '씬 구성']) {
    expect(right.textContent).toContain(h);
  }
  expect(right.querySelector('[data-template-prompt-box]')).toBeNull();
  // 열 안에 또 다른 세로 스크롤 영역이 없다
  for (const col of [left, right]) {
    // 프롬프트 칸(data-template-prompt-box)의 max-h-40 은 SPEC 높이 규칙 (3) 입력칸 고정 높이 예외 — 그 밖의 max-h 는 금지
    expect(col.querySelector('[class*="overflow-y-auto"]')).toBeNull();
    expect(col.querySelector('[class*="max-h-"]:not([data-template-prompt-box])')).toBeNull();
  }
};

describe('템플릿 관리(xl) — PC 두 열', () => {
  test('템플릿 탭: 왼쪽 프롬프트·캐릭터 프롬프트 | 오른쪽 캐릭터 프리셋·바이브·레퍼런스·씬', async () => {
    await renderManager();
    expectTemplateTwoCol();
    expect(slot('body')!.className).toContain('p-5');
  });

  test('프롬프트 칸 5개(상위·하위·네거티브·캐릭터 프롬프트·캐릭터 네거티브)가 min-h-20·max-h-40 flex 열로 감싸지고 편집기가 flex-1 min-h-0 를 받는다', async () => {
    await renderManager();
    for (const k of ['front', 'back', 'uc', 'char-prompt', 'char-uc']) {
      const box = q(`[data-template-prompt-box="${k}"]`)!;
      expect(box).not.toBeNull();
      expect(box.className).toBe('flex flex-col min-h-20 max-h-40');
      const area = box.querySelector<HTMLElement>('[data-prompt-area]')!;
      expect(area).not.toBeNull();
      expect(area.className).toBe('flex-1 min-h-0');
    }
  });

  test('씬 구성: 6개 이하는 펼침·토글 없음과 다르게, 7개면 기본 접힘이고 [펼치기]로 목록이 나온다', async () => {
    mockTemplates[0].scenes = Array.from({ length: 7 }, (_, i) => ({ name: '씬' + i }));
    await renderManager();
    const toggle = q('[data-template-scenes-toggle]')!;
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toContain('펼치기');
    expect(q('[data-template-scenes-list]')).toBeNull();
    await click(toggle);
    expect(q('[data-template-scenes-toggle]')!.getAttribute('aria-expanded')).toBe('true');
    expect(q('[data-template-scenes-list]')!.children.length).toBe(7);
    await click(q('[data-template-scenes-toggle]'));
    expect(q('[data-template-scenes-list]')).toBeNull();
  });

  test('씬 구성: 6개 이하는 기본 펼침', async () => {
    mockTemplates[0].scenes = Array.from({ length: 6 }, (_, i) => ({ name: '씬' + i }));
    await renderManager();
    expect(q('[data-template-scenes-toggle]')!.getAttribute('aria-expanded')).toBe('true');
    expect(q('[data-template-scenes-list]')!.children.length).toBe(6);
  });

  test('일괄 생성 탭: 왼쪽 안내·공유 프롬프트 | 오른쪽 대상 폴더·축·미리보기', async () => {
    await renderManager();
    await click(tabButton('일괄 생성'));
    const two = slot('body')!.querySelector('[data-batch-body="two-col"]') as HTMLElement;
    expect(two).not.toBeNull();
    expect(two.className).toContain('h-full min-h-0');
    expect(two.className).not.toContain('overflow');
    const left = two.querySelector('[data-batch-col="left"]') as HTMLElement;
    const right = two.querySelector('[data-batch-col="right"]') as HTMLElement;
    expect(left.className).toContain(COL);
    expect(right.className).toContain(COL);
    expect(left.querySelector('[data-template-prompt-box="front"]')).not.toBeNull();
    expect(left.textContent).toContain('조합마다 자식 프로젝트');
    for (const h of ['대상 폴더 — 새로 생성', '캐릭터 축', '씬 축', '미리보기']) {
      expect(right.textContent).toContain(h);
    }
    expect(right.querySelector('[data-template-prompt-box]')).toBeNull();
    for (const col of [left, right]) {
      expect(col.querySelector('[class*="overflow-y-auto"]')).toBeNull();
      expect(col.querySelector('[class*="max-h-"]:not([data-template-prompt-box])')).toBeNull();
    }
    // 바닥줄 [N개 생성]은 그대로 호스트에
    expect(slot('footer')!.querySelector('[data-batch-run]')).not.toBeNull();
  });

  test('캐릭터 프리셋 편집 = 안쪽 편집기 frame + 본문 여백 없음, 호스트 탭·바닥줄 없음 → 돌아오면 원복', async () => {
    await renderManager();
    await click(buttonByText(q('[data-template-col="right"]')!, '새로 만들기'));
    const ed = q('[data-test-inner-editor]')!;
    expect(ed.getAttribute('data-preset-editor-layout')).toBe('frame');
    expect(slot('body')!.className).not.toContain('p-5');
    expect(q('[data-template-tabs]')).toBeNull();
    expect(slot('footer')).toBeNull();
  });

  test('일괄 생성 즉석 생성([새 프리셋]) = frame + 본문 여백 없음', async () => {
    await renderManager();
    await click(tabButton('일괄 생성'));
    await click(buttonByText(q('[data-batch-col="right"]')!, '새 프리셋'));
    expect(q('[data-test-inner-editor]')!.getAttribute('data-preset-editor-layout')).toBe('frame');
    expect(slot('body')!.className).not.toContain('p-5');
    expect(slot('footer')).toBeNull();
  });
});

// [N개 생성] 비활성 이유 안내(2026-11-15) — 전역 호스트에서 대상 폴더 이름이 비면 입력칸 아래 한 줄
describe('일괄 생성 — 대상 폴더 이름 안내', () => {
  test('비어 있으면 안내 한 줄, 이름을 넣으면 사라진다', async () => {
    await renderManager();
    await click(tabButton('일괄 생성'));
    const hint = q('[data-batch-folder-hint]')!;
    expect(hint).not.toBeNull();
    expect(hint.textContent).toBe('대상 폴더 이름을 입력해 주세요');
    expect(hint.className).toContain('text-xs text-faint');
    const input = q('input[placeholder^="새 폴더 이름"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(input, '캐릭터CG');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(q('[data-batch-folder-hint]')).toBeNull();
  });
  test('폴더 호스트(대상 폴더 입력 없음)에는 안내가 없다', async () => {
    await renderFolder();
    await click(tabButton('일괄 생성'));
    expect(q('[data-batch-folder-hint]')).toBeNull();
  });
});

describe('폴더 기본 템플릿(l) — 같은 두 열', () => {
  test('템플릿 탭 두 열 + 캐릭터 편집 frame·여백 없음', async () => {
    await renderFolder();
    expect(q('[data-modal-size]')?.getAttribute('data-modal-size')).toBe('l');
    expectTemplateTwoCol();
    await click(buttonByText(q('[data-template-col="right"]')!, '새로 만들기'));
    expect(q('[data-test-inner-editor]')!.getAttribute('data-preset-editor-layout')).toBe('frame');
    expect(slot('body')!.className).not.toContain('p-5');
    // [지정 해제]도 숨는다(호스트 바닥줄 없음 — 편집기 자체 바닥줄만)
    expect(q('[data-folder-template-clear]')).toBeNull();
  });

  test('일괄 생성 탭 두 열(대상 폴더 입력 없음)', async () => {
    await renderFolder();
    await click(tabButton('일괄 생성'));
    const right = q('[data-batch-col="right"]')!;
    expect(right.textContent).toContain('캐릭터 축');
    expect(right.textContent).not.toContain('대상 폴더 — 새로 생성');
    expect(q('[data-batch-col="left"] [data-template-prompt-box="front"]')).not.toBeNull();
  });
});

describe('모바일 — 종전 한 열·inline', () => {
  test('템플릿 탭 한 열(순서 = 프롬프트 → 캐릭터 프리셋 → 캐릭터 프롬프트 → 바이브 → 레퍼런스 → 씬)', async () => {
    mockEnv.mobile = true;
    await renderManager();
    expect(q('[data-template-body]')).toBeNull();
    expect(q('[data-template-col]')).toBeNull();
    const text = slot('body')!.textContent || '';
    const order = ['상위 프롬프트', '캐릭터 프리셋 (', '캐릭터 프롬프트 (', '바이브 이미지', '캐릭터 레퍼런스', '씬 구성'].map(
      (h) => text.indexOf(h),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // 프롬프트 칸 감싸기는 모바일에도
    expect(q('[data-template-prompt-box="front"]')).not.toBeNull();
  });

  test('일괄 생성 한 열, 캐릭터 편집 inline·본문 여백 유지', async () => {
    mockEnv.mobile = true;
    await renderManager();
    await click(tabButton('일괄 생성'));
    expect(q('[data-batch-body]')).toBeNull();
    expect(q('[data-batch-col]')).toBeNull();
    await click(buttonByText(slot('body')!, '새 프리셋'));
    expect(q('[data-test-inner-editor]')!.getAttribute('data-preset-editor-layout')).toBe('inline');
    expect(slot('body')!.className).toContain('p-5');
  });

  test('템플릿 탭 캐릭터 편집 inline', async () => {
    mockEnv.mobile = true;
    await renderManager();
    await click(buttonByText(slot('body')!, '새로 만들기'));
    expect(q('[data-test-inner-editor]')!.getAttribute('data-preset-editor-layout')).toBe('inline');
    expect(slot('body')!.className).toContain('p-5');
  });
});
