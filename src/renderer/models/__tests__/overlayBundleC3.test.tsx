// 오버레이 묶음 C-3(2026-11-15, SPEC 「오버레이 창 크기 체계」 높이 규칙 우선순위·슬롯 규약 ⑥ 보강) —
// 캐릭터 프리셋 관리 = size xl(고정), useCharacterPresetPanel 슬롯 분리:
// PC aside(로컬/글로벌 분할 버튼 + 폴더 행 / 「이 프로젝트 · n개」), toolbar(모드·검색·파일 버튼, 선택 모드 둘째 줄),
// body = 카드 그리드만(순차 생성 = 「카드 | 설정」 두 칸 + 바닥줄 [순차 생성 시작]·요약),
// 안쪽 편집 = CharacterPresetInnerEditor layout="frame"(두 열 + 표시 전용 바닥줄, Esc = 목록으로, ✕ 미저장 확인 1회).
// 모바일은 종전 한 열(슬롯 없음). 안쪽 편집기 inline 배치(템플릿 관리·일괄 생성)는 종전 순서 그대로.
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import * as fs from 'fs';
import * as path from 'path';

const mockEnv = { mobile: false };
const mockSession: any = { name: 'P' };
const mockGlobalChars: { entries: any[]; folders: string[] } = { entries: [], folders: [] };
const mockDrops: { el: Element; spec: any }[] = [];

jest.mock('@capacitor/app', () => ({
  App: { addListener: jest.fn(), minimizeApp: jest.fn() },
}));
jest.mock('../index', () => ({
  get isMobile() {
    return mockEnv.mobile;
  },
  backend: {},
  imageService: {},
  cyclingSessionService: { state: 'idle', start: jest.fn() },
  taskQueueService: { isGenerationHost: true },
  templateService: { importSceneTemplate: jest.fn(async () => null) },
  globalCharacterPresetService: {
    list: () => mockGlobalChars.entries,
    listFolders: () => mockGlobalChars.folders,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  },
}));
const mockAppState: any = {
  curSession: mockSession,
  appliedCharacterPresetNames: [],
  pushMessage: jest.fn(),
  pushDialog: jest.fn(),
  confirmAsync: jest.fn(async () => true),
  incrementModalOverlay: jest.fn(),
  decrementModalOverlay: jest.fn(),
};
jest.mock('../AppService', () => ({ appState: mockAppState }));
jest.mock('../../componenets/UtilComponents', () => ({ FileUploadBase64: () => null }));
jest.mock('../sceneImportUndo', () => ({ recordSceneTemplateImport: jest.fn() }));
jest.mock('../exportUtil', () => ({ saveJsonFile: jest.fn() }));
jest.mock('../driveImport', () => ({ interceptFileImportClick: jest.fn() }));
jest.mock('../driveSync', () => ({ syncFileName: jest.fn() }));
jest.mock('../characterPresetImport', () => ({ importGlobalCharacterPresetsText: jest.fn() }));
jest.mock('../projectTemplateBackup', () => ({
  imageFileExt: jest.fn(),
  imageTokenBase: jest.fn(),
  isSafeImageToken: jest.fn(),
}));
jest.mock('../presetUndo', () => ({
  addCharacterPresetRecorded: jest.fn(),
  editCharacterPresets: jest.fn(),
  instantiateGlobalCharacterPresetsRecorded: jest.fn(),
}));
jest.mock('../globalLibraryUndo', () => ({
  createGlobalCharacterFolderRecorded: jest.fn(),
  deleteGlobalCharacterFolderRecorded: jest.fn(),
  renameGlobalCharacterFolderRecorded: jest.fn(),
  renameGlobalCharacterRecorded: jest.fn(),
  reorderGlobalCharactersRecorded: jest.fn(),
  setGlobalCharacterFolderRecorded: jest.fn(async () => {}),
  setGlobalCharactersFolderRecorded: jest.fn(),
}));
jest.mock('../types', () => {
  class CharacterPreset {
    name = '';
    characterPrompt = '';
    characterUC = '';
    backgroundPrompt = '';
    vibes: any[] = [];
    characterReferences: any[] = [];
    representativeImage = '';
    filenamePrefix = '';
    filenameSuffix = '';
    static fromJSON(x: any) {
      return Object.assign(new CharacterPreset(), x);
    }
  }
  return {
    CharacterPreset,
    VibeItem: { fromJSON: (x: any) => x },
    ReferenceItem: { fromJSON: (x: any) => x },
  };
});
jest.mock('../../componenets/PromptEditTextArea', () => (props: any) => (
  <textarea data-prompt-area="" value={props.value} onChange={(e) => props.onChange(e.target.value)} />
));
jest.mock('../../componenets/ActionIcon', () => ({ ActionIcon: () => null }));
jest.mock('../../componenets/CharacterReferenceEditor', () => ({
  getRefDefaults: () => ({ strength: 1, fidelity: 1, referenceType: 'character' }),
}));
jest.mock('../../componenets/VibeEditor', () => ({ EditableSliderValue: () => null }));
jest.mock('../../componenets/CharacterPresetCards', () => {
  const card = (kind: string) => (props: any) => (
    <div
      data-test-card={kind}
      data-name={props.preset?.name ?? props.entry?.name}
      data-index={props.index}
      data-locked={String(!!props.reorderLocked)}
    />
  );
  return {
    makeSessionImageBackend: () => ({ vibePath: () => '', referencePath: () => '' }),
    globalImageBackend: { vibePath: () => '', referencePath: () => '' },
    CharacterPresetCard: card('local'),
    GlobalCharacterPresetCard: card('global'),
    VibeImage: () => null,
  };
});
// 폴더 행의 끌어 놓기 대상 — 연결된 DOM 과 spec 을 기록해 「카드 → 폴더 행」 이동이 aside 안에서도 붙는지 본다
jest.mock('react-dnd', () => ({
  useDrag: () => [{ isDragging: false }, jest.fn(), jest.fn()],
  useDrop: (spec: any) => {
    const s = typeof spec === 'function' ? spec() : spec;
    return [
      { isOver: false },
      (el: Element | null) => {
        if (el) mockDrops.push({ el, spec: s });
      },
    ];
  },
}));
jest.mock('react-dnd-html5-backend', () => ({ getEmptyImage: jest.fn() }));

import {
  CharacterPresetEditor,
  CharacterPresetModalEditor,
} from '../../componenets/CharacterPresetEditor';
import { CharacterPresetInnerEditor } from '../../componenets/CharacterPresetInnerEditor';
import { setGlobalCharacterFolderRecorded } from '../globalLibraryUndo';

let root: Root;
let container: HTMLDivElement;
const onClose = jest.fn();
beforeAll(() => {
  (global as any).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  jest.clearAllMocks();
  mockEnv.mobile = false;
  mockAppState.confirmAsync = jest.fn(async () => true);
  mockGlobalChars.entries = [
    { id: 'g1', name: 'Alice', folder: 'F', preset: {} },
    { id: 'g2', name: 'Bob', folder: null, preset: {} },
    { id: 'g3', name: 'alicia', folder: 'F', preset: {} },
  ];
  mockGlobalChars.folders = ['F'];
  const locals = [{ name: 'Red' }, { name: 'Blue' }, { name: 'Navy blue' }];
  mockSession.getCharacterPresets = () => locals;
  mockSession.selectedWorkflow = { workflowType: 'SDImageGen' };
  mockSession.scenes = new Map([
    ['s1', { name: 's1' }],
    ['s2', { name: 's2' }],
  ]);
  mockDrops.length = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const q = (sel: string, scope: ParentNode = container) => scope.querySelector<HTMLElement>(sel);
const qa = (sel: string, scope: ParentNode = container) =>
  Array.from(scope.querySelectorAll<HTMLElement>(sel));
const slot = (name: string) => q(`[data-modal-slot="${name}"]`);
const buttonByText = (text: string, scope: ParentNode = container) =>
  Array.from(scope.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === text)!;
const typeIn = async (input: HTMLInputElement | HTMLTextAreaElement, text: string) => {
  await act(async () => {
    input.value = text;
    Simulate.change(input);
  });
};
const click = async (el: Element) => {
  await act(async () => Simulate.click(el));
};
const openWindow = async () => {
  await act(async () => root.render(<CharacterPresetModalEditor onClose={onClose} />));
};
const enterNewGlobal = async () => {
  const addCard = Array.from(container.querySelectorAll('div')).find(
    (d) => (d.textContent ?? '').trim() === '새 글로벌 프리셋' && d.className.includes('border-dashed'),
  )!;
  await click(addCard);
};
const pressEscape = async () => {
  await act(async () => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
};

describe('C-3 캐릭터 프리셋 관리 — 등급·슬롯(PC)', () => {
  test('size xl 고정, aside·toolbar·본문 슬롯이 있고 바닥줄은 없음(목록)', async () => {
    await openWindow();
    expect(q('[data-modal-size]')?.getAttribute('data-modal-size')).toBe('xl');
    expect(slot('columns')).not.toBeNull();
    expect(slot('aside')).not.toBeNull();
    expect(slot('toolbar')).not.toBeNull();
    expect(slot('footer')).toBeNull();
  });

  test('aside = [로컬 | 글로벌] + 폴더 행(글로벌) / 「이 프로젝트 · n개」(로컬), 전환 때 검색 비움', async () => {
    await openWindow();
    const aside = slot('aside')!;
    const toggle = q('[data-character-view-toggle]', aside)!;
    expect(buttonByText('로컬', toggle).getAttribute('aria-pressed')).toBe('false');
    expect(buttonByText('글로벌', toggle).getAttribute('aria-pressed')).toBe('true');
    expect(q('[data-character-aside-list]', aside)!.getAttribute('data-character-aside-list')).toBe('global');
    const asideText = aside.textContent ?? '';
    expect(asideText).toContain('전체3');
    expect(asideText).toContain('미분류1');
    expect(asideText).toContain('F2');
    expect(asideText).toContain('새 폴더');
    // 검색은 도구줄 안
    const search = q('[data-list-search]', slot('toolbar')!) as HTMLInputElement;
    expect(search).not.toBeNull();
    await typeIn(search, 'ali');
    expect(qa('[data-test-card]').map((c) => c.getAttribute('data-name'))).toEqual(['Alice', 'alicia']);
    // 같은 보기 버튼은 무동작(검색 유지)
    await click(buttonByText('글로벌', toggle));
    expect((q('[data-list-search]') as HTMLInputElement).value).toBe('ali');
    await click(buttonByText('로컬', q('[data-character-view-toggle]')!));
    expect((q('[data-list-search]') as HTMLInputElement).value).toBe('');
    expect(q('[data-character-aside-list]')!.getAttribute('data-character-aside-list')).toBe('local');
    expect(q('[data-character-local-row]')!.textContent).toContain('이 프로젝트 · 3개');
    expect(qa('[data-test-card]').every((c) => c.getAttribute('data-test-card') === 'local')).toBe(true);
    // 폴더 선택은 aside 행에서
    await click(buttonByText('글로벌', q('[data-character-view-toggle]')!));
    const folderBtn = qa('button', slot('aside')!).find((b) => (b.textContent ?? '').startsWith('F'))!;
    await click(folderBtn);
    expect(qa('[data-test-card]').map((c) => c.getAttribute('data-name'))).toEqual(['Alice', 'alicia']);
  });

  test('폴더 행은 aside 안에서 카드 끌어 놓기 대상 — 놓으면 그 폴더로 이동(되돌리기 기록 경로)', async () => {
    await openWindow();
    const aside = slot('aside')!;
    const inAside = mockDrops.filter((d) => aside.contains(d.el));
    // 미분류 + 폴더 F = 2곳(전체 행은 대상 아님)
    expect(inAside.length).toBeGreaterThanOrEqual(2);
    expect(inAside.every((d) => d.spec.accept === 'global-character-preset-card')).toBe(true);
    const fDrop = inAside.find((d) => (d.el.textContent ?? '').startsWith('F'))!;
    fDrop.spec.drop({ index: 1 });
    expect(setGlobalCharacterFolderRecorded).toHaveBeenCalledWith('g2', 'F');
    // 본문에는 폴더 열이 없다
    expect(mockDrops.some((d) => slot('body')!.contains(d.el))).toBe(false);
  });

  test('도구줄 = 모드 버튼·검색·파일 버튼, 선택 모드면 둘째 줄 선택 바', async () => {
    await openWindow();
    const tb = slot('toolbar')!;
    expect(buttonByText('순차 생성 모드', tb)).toBeTruthy();
    expect(buttonByText('선택', tb)).toBeTruthy();
    expect(tb.textContent).toContain('내보내기');
    expect(tb.textContent).toContain('불러오기');
    expect(q('[data-list-search]', tb)).not.toBeNull();
    expect(q('[data-character-selection-bar]')).toBeNull();
    await click(buttonByText('선택', tb));
    const bar = q('[data-character-selection-bar]', slot('toolbar')!)!;
    expect(bar).not.toBeNull();
    expect(bar.textContent).toContain('0개');
    expect(buttonByText('선택 적용', bar)).toBeTruthy();
    expect(buttonByText('폴더로 이동', bar)).toBeTruthy();
    expect(buttonByText('선택 삭제', bar)).toBeTruthy();
    await click(buttonByText('전체 선택', bar));
    expect(q('[data-character-selection-bar]')!.textContent).toContain('3개');
    // 로컬 보기에는 [모두 글로벌로 복사]
    await click(buttonByText('로컬', q('[data-character-view-toggle]')!));
    expect(slot('toolbar')!.textContent).toContain('모두 글로벌로 복사');
  });

  test('본문 = 카드 그리드만(검색·버튼·폴더 열 없음), JS 최소 높이 없음', async () => {
    await openWindow();
    const body = slot('body')!;
    expect(q('[data-character-grid="global"]', body)).not.toBeNull();
    expect(q('[data-list-search]', body)).toBeNull();
    expect(q('[data-character-view-toggle]', body)).toBeNull();
    expect(buttonByText('선택', body)).toBeUndefined();
    const root0 = q('[data-character-preset-body]', body)!;
    expect(root0.style.minHeight).toBe('');
  });

  test('순차 생성 모드 = 「카드 | 설정」 두 칸 + 바닥줄 [순차 생성 시작]·요약', async () => {
    await openWindow();
    await click(buttonByText('순차 생성 모드', slot('toolbar')!));
    const body = slot('body')!;
    const cols = q('[data-cycling-columns]', body)!;
    expect(cols).not.toBeNull();
    expect(cols.className).toContain('h-full');
    const cards = q('[data-cycling-cards]', cols)!;
    const settings = q('[data-cycling-settings]', cols)!;
    expect(q('[data-character-grid]', cards)).not.toBeNull();
    // 씬 목록 = 설정 열 남은 높이(높이 상한 없음)
    const list = q('[data-cycling-scene-list]', settings)!;
    expect(list.className).toContain('flex-1 min-h-0');
    expect(list.className).not.toContain('max-h-');
    expect(list.textContent).toContain('s1');
    // 시작 버튼은 본문이 아니라 바닥줄
    expect(q('[data-cycling-start]', body)).toBeNull();
    const footer = slot('footer')!;
    const start = q('[data-cycling-start]', footer) as HTMLButtonElement;
    expect(start.textContent).toContain('순차 생성 시작');
    expect(start.disabled).toBe(true);
    expect(q('[data-cycling-summary]', footer)!.textContent).toBe('프리셋 0개 × 씬 0개 · 샘플 10장');
    await click(buttonByText('전체 선택', cards));
    expect(q('[data-cycling-summary]')!.textContent).toBe('프리셋 3개 × 씬 0개 · 샘플 10장');
    // 끄면 바닥줄이 사라진다
    await click(buttonByText('순차 생성 모드 끄기', slot('toolbar')!));
    expect(slot('footer')).toBeNull();
    expect(q('[data-cycling-columns]')).toBeNull();
  });
});

describe('C-3 안쪽 편집 — layout="frame"(PC)', () => {
  test('편집 중 = 도구줄·aside·래퍼 바닥줄 없음, 본문 여백 없음, 두 열 + 자체 바닥줄', async () => {
    await openWindow();
    await enterNewGlobal();
    expect(slot('toolbar')).toBeNull();
    expect(slot('aside')).toBeNull();
    expect(slot('footer')).toBeNull();
    expect(slot('body')!.className).not.toContain('p-5');
    const frame = q('[data-preset-editor-layout="frame"]', slot('body')!)!;
    expect(frame.className).toContain('h-full');
    const left = q('[data-preset-editor-col="left"]', frame)!;
    const right = q('[data-preset-editor-col="right"]', frame)!;
    for (const col of [left, right]) {
      expect(col.className).toContain('flex-1 min-w-0 min-h-0 overflow-y-auto');
    }
    expect(left.textContent).toContain('프리셋 이름');
    expect(left.textContent).toContain('대표 이미지');
    expect(left.textContent).toContain('캐릭터 프롬프트');
    expect(left.textContent).toContain('캐릭터 네거티브 프롬프트');
    expect(right.textContent).toContain('바이브 트랜스퍼');
    expect(right.textContent).toContain('캐릭터 레퍼런스');
    expect(left.textContent).not.toContain('바이브 트랜스퍼');
    const bar = q('[data-overlay-footer-bar]', frame)!;
    expect(bar.className).toBe('flex-none flex items-center gap-2 px-5 py-3 border-t line-color');
    const save = buttonByText('프리셋 추가', bar);
    expect(save.className).toBe('px-4 py-2 rounded-lg btn-solid-sky text-sm font-medium transition-colors');
    expect(buttonByText('취소', bar).className).toContain('btn-neutral text-body text-sm');
    expect(q('[data-modal-size]')!.getAttribute('data-modal-size')).toBe('xl');
  });

  test('[취소] = 목록으로(변경 없으면 묻지 않음)', async () => {
    await openWindow();
    await enterNewGlobal();
    await click(buttonByText('취소', q('[data-overlay-footer-bar]')!));
    expect(q('[data-preset-editor-layout]')).toBeNull();
    expect(slot('aside')).not.toBeNull();
    expect(mockAppState.confirmAsync).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  test('Esc = 목록으로(창은 닫지 않음)', async () => {
    await openWindow();
    await enterNewGlobal();
    await pressEscape();
    expect(q('[data-preset-editor-layout]')).toBeNull();
    expect(slot('toolbar')).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  test('변경 뒤 ✕ = 미저장 확인 1회 → 확인하면 창 닫기', async () => {
    await openWindow();
    await enterNewGlobal();
    const nameInput = q('[data-preset-editor-col="left"] input[type="text"]') as HTMLInputElement;
    await typeIn(nameInput, '바뀐 이름');
    mockAppState.confirmAsync = jest.fn(async () => false);
    await click(q('button[aria-label="닫기"]')!);
    expect(mockAppState.confirmAsync).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(q('[data-preset-editor-layout="frame"]')).not.toBeNull();
    mockAppState.confirmAsync = jest.fn(async () => true);
    await click(q('button[aria-label="닫기"]')!);
    expect(mockAppState.confirmAsync).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('C-3 모바일 — 종전 한 열', () => {
  test('슬롯 없음, 본문 안 토글·검색·가로 폴더 줄, 편집은 inline', async () => {
    mockEnv.mobile = true;
    await openWindow();
    expect(slot('aside')).toBeNull();
    expect(slot('toolbar')).toBeNull();
    expect(slot('footer')).toBeNull();
    const body = slot('body')!;
    expect(buttonByText('글로벌', body)).toBeTruthy();
    expect(q('[data-list-search]', body)).not.toBeNull();
    expect(q('[data-character-view-toggle]')).toBeNull();
    await enterNewGlobal();
    expect(q('[data-preset-editor-layout]')).toBeNull();
    expect(buttonByText('프리셋 추가')).toBeTruthy();
  });

  test('순차 생성은 설정 패널 안 [순차 생성 시작](바닥줄 없음)', async () => {
    mockEnv.mobile = true;
    await openWindow();
    await click(buttonByText('순차 생성 모드'));
    expect(slot('footer')).toBeNull();
    expect(q('[data-cycling-start]', slot('body')!)).not.toBeNull();
    expect(q('[data-cycling-scene-list]')!.className).toContain('max-h-36');
  });
});

describe('C-3 인라인 사용·안쪽 편집기 inline 배치', () => {
  test('CharacterPresetEditor 직접 렌더 = 도구줄·aside·본문 차례', async () => {
    await act(async () => root.render(<CharacterPresetEditor />));
    const tb = q('[data-character-preset-toolbar]')!;
    const aside = q('[data-character-preset-aside]')!;
    const body = q('[data-character-preset-body]')!;
    expect(tb.compareDocumentPosition(aside) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(aside.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('inline(기본) = 종전 한 열 순서, frame 표식·표시 전용 바닥줄 없음', async () => {
    const preset: any = {
      name: 'K',
      characterPrompt: '',
      characterUC: '',
      backgroundPrompt: '',
      vibes: [],
      characterReferences: [],
      representativeImage: '',
      filenamePrefix: '',
      filenameSuffix: '',
    };
    await act(async () =>
      root.render(
        <CharacterPresetInnerEditor
          preset={preset}
          onSave={jest.fn()}
          onCancel={jest.fn()}
          isNew={false}
          imageBackend={{ vibePath: () => '', referencePath: () => '' } as any}
        />,
      ),
    );
    const rootEl = container.firstElementChild as HTMLElement;
    expect(rootEl.className).toBe('flex flex-col text-default');
    expect(q('[data-preset-editor-layout]')).toBeNull();
    expect(q('[data-overlay-footer-bar]')).toBeNull();
    const text = rootEl.textContent ?? '';
    const order = [
      '돌아가기',
      '프리셋 이름 *',
      '대표 이미지',
      '캐릭터 프롬프트',
      '캐릭터 네거티브 프롬프트',
      '바이브 트랜스퍼',
      '캐릭터 레퍼런스',
      '파일명 옵션 (선택사항)',
      '프리셋 저장',
      '취소',
    ];
    const pos = order.map((t) => text.indexOf(t));
    expect(pos.every((p) => p >= 0)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
    // 직계 자식 수(돌아가기·이름·대표·프롬프트·네거티브·바이브·레퍼런스·파일명·저장 줄 = 9, 레거시 배경 없음)
    expect(rootEl.children).toHaveLength(9);
    const save = buttonByText('프리셋 저장');
    expect(save.className).toContain('flex-1');
    expect(save.parentElement!.className).toBe('flex gap-2 pt-2 border-t line-color');
  });
});

describe('C-3 소스 검사', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'componenets', 'CharacterPresetEditor.tsx'),
    'utf-8',
  );
  test('JS 최소 높이는 모바일 전용, 65vh·순차 생성 씬 목록 높이 상한은 PC 경로에 없음', () => {
    expect(src).toMatch(/useLayoutEffect\(\(\) => \{\r?\n\s+if \(!isMobile\) return;/);
    expect(src).not.toMatch(/65vh/);
    // max-h-36 은 모바일 분기 삼항 한 곳뿐
    expect(src.match(/max-h-36/g)).toHaveLength(1);
    expect(src).toMatch(/\(wide \? 'flex-1 min-h-0' : 'max-h-36'\)/);
  });
  test('래퍼는 size="xl" 하나, width 폭 클래스 없음', () => {
    expect(src).toMatch(/size="xl"/);
    expect(src).not.toMatch(/width="max-w-5xl"/);
  });
});
