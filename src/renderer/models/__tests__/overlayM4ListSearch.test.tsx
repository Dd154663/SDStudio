// 오버레이 M4(2026-11-14) — 목록 검색·정렬·개수. 공용 ListSearchBar·models/listSearch 와 4창 적용 검사.
// (a) matchesQuery·compareNames·listCountText 단위
// (b) ListSearchBar 렌더 — 입력·개수 두 형태·정렬 select·입력 생략(onQueryChange 없음)
// (c) 씬 템플릿 관리 — 정렬(지정 순/이름순)·「전체 n개」, 검색 입력 없음
// (d) 내보내기 프리셋 관리 — 거르기·개수·검색 0건 문구·편집 선택 유지·행 동작은 원래 인덱스
// (e) 프롬프트조각 — 선택 그룹 조각 거르기·개수·0건·검색 중 드래그 잠금 + 안내·그룹 바꾸면 검색 비움
// (f) 캐릭터 프리셋 관리 — 글로벌(폴더 범위)·로컬 거르기·개수·0건·드래그 잠금·「전체 선택」 = 보이는 항목만·보기 전환 시 비움
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';

const mockEnv = { mobile: false };
const mockTemplates: { list: string[] } = { list: [] };
const mockSession: any = { name: 'P', library: new Map() };
const mockGlobalLibrary = new Map<string, any>();
const mockGlobalChars: { entries: any[]; folders: string[] } = { entries: [], folders: [] };
const mockDrag: { specs: any[] } = { specs: [] };

jest.mock('@capacitor/app', () => ({
  App: { addListener: jest.fn(), minimizeApp: jest.fn() },
}));
jest.mock('../index', () => ({
  get isMobile() {
    return mockEnv.mobile;
  },
  backend: { selectDir: jest.fn(), writeFile: jest.fn(), publishExport: jest.fn() },
  promptService: {},
  imageService: {},
  cyclingSessionService: { state: 'idle' },
  taskQueueService: { isGenerationHost: true },
  sessionService: {
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    get: jest.fn(),
    list: () => [],
    reloadPieceLibraryDB: jest.fn(),
  },
  templateService: {
    listSceneTemplates: () => mockTemplates.list,
    importSceneTemplate: jest.fn(async () => null),
    createSceneTemplate: jest.fn(),
    createEmptySceneTemplate: jest.fn(),
  },
  globalPieceService: {
    get library() {
      return mockGlobalLibrary;
    },
    scheduleSave: jest.fn(),
  },
  globalCharacterPresetService: {
    list: () => mockGlobalChars.entries,
    listFolders: () => mockGlobalChars.folders,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  },
}));
const mockAppState: any = {
  curSession: mockSession,
  exportPresetManagerOpen: true,
  loadExportPresets: () => [],
  saveExportPresets: jest.fn(),
  subscribeExportPresets: () => () => {},
  pushMessage: jest.fn(),
  pushDialog: jest.fn(),
  confirmAsync: jest.fn(),
  incrementModalOverlay: jest.fn(),
  decrementModalOverlay: jest.fn(),
  closeExportPresetManager: jest.fn(),
};
jest.mock('../AppService', () => ({ appState: mockAppState }));
jest.mock('../platform', () => ({
  buildImageOptimizeOptions: () => [{ text: '원본', value: 'original' }],
}));
jest.mock('../../componenets/UtilComponents', () => ({
  DropdownSelect: () => null,
  FileUploadBase64: () => null,
}));
jest.mock('../projectDeleteUndo', () => ({ deleteProjectRecorded: jest.fn() }));
jest.mock('../sceneImportUndo', () => ({ recordSceneTemplateImport: jest.fn() }));
jest.mock('../TrashService', () => ({ PROJECT_RETENTION_DAYS: 30 }));
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
  saveExportPresetsRecorded: jest.fn(),
  createGlobalCharacterFolderRecorded: jest.fn(),
  deleteGlobalCharacterFolderRecorded: jest.fn(),
  renameGlobalCharacterFolderRecorded: jest.fn(),
  renameGlobalCharacterRecorded: jest.fn(),
  reorderGlobalCharactersRecorded: jest.fn(),
  setGlobalCharacterFolderRecorded: jest.fn(async () => {}),
  setGlobalCharactersFolderRecorded: jest.fn(),
}));
jest.mock('../types', () => ({
  isValidPieceLibrary: jest.fn(),
  Piece: { fromJSON: (x: any) => x },
  PieceLibrary: { fromJSON: (x: any) => x },
  CharacterPreset: { fromJSON: (x: any) => x },
}));
jest.mock('../legacy', () => ({ migratePieceLibrary: (x: any) => x }));
jest.mock('../pieceUndo', () => ({
  beginPieceDrag: jest.fn(),
  editPieceGroups: jest.fn(),
  editPieceLibrary: jest.fn(),
  movePieceInLibrary: jest.fn(),
  pieceDragItem: jest.fn(),
  renamePieceRecorded: jest.fn(),
  touchPieceEdit: jest.fn(),
}));
jest.mock('../../componenets/PromptEditTextArea', () => () => null);
jest.mock('../../componenets/ActionIcon', () => ({ ActionIcon: () => null }));
jest.mock('../../componenets/CharacterPresetInnerEditor', () => ({ CharacterPresetInnerEditor: () => null }));
// 카드는 받은 prop 만 표식으로 — 이름·원래 인덱스·순서 잠금
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
    makeSessionImageBackend: () => ({}),
    globalImageBackend: {},
    CharacterPresetCard: card('local'),
    GlobalCharacterPresetCard: card('global'),
  };
});
jest.mock('react-dnd', () => ({
  useDrag: (spec: any) => {
    mockDrag.specs.push(typeof spec === 'function' ? spec() : spec);
    return [{ isDragging: false }, jest.fn(), jest.fn()];
  },
  useDrop: () => [{}, jest.fn()],
}));
jest.mock('react-dnd-html5-backend', () => ({ getEmptyImage: jest.fn() }));

import { compareNames, hasQuery, matchesQuery } from '../listSearch';
import { ListSearchBar, listCountText } from '../../componenets/ListSearchBar';
import SceneTemplateManager from '../../componenets/SceneTemplateManager';
import ExportPresetManager from '../../componenets/ExportPresetManager';
import PieceEditor from '../../componenets/PieceEditor';
import { CharacterPresetEditor } from '../../componenets/CharacterPresetEditor';
import { saveExportPresetsRecorded } from '../globalLibraryUndo';

let root: Root;
let container: HTMLDivElement;
beforeAll(() => {
  (global as any).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  jest.clearAllMocks();
  mockEnv.mobile = false;
  mockTemplates.list = [];
  mockSession.name = 'P';
  mockSession.library = new Map();
  mockSession.getCharacterPresets = () => [];
  mockSession.selectedWorkflow = { workflowType: 'SDImageGen' };
  mockSession.scenes = new Map();
  mockGlobalLibrary.clear();
  mockGlobalChars.entries = [];
  mockGlobalChars.folders = [];
  mockDrag.specs = [];
  mockAppState.loadExportPresets = () => [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const q = (sel: string) => container.querySelector<HTMLElement>(sel);
const qa = (sel: string) => Array.from(container.querySelectorAll<HTMLElement>(sel));
const slot = (name: string) => q(`[data-modal-slot="${name}"]`);
const typeIn = async (input: HTMLInputElement, text: string) => {
  await act(async () => {
    input.value = text;
    Simulate.change(input);
  });
};
const search = (scope: ParentNode = container) =>
  scope.querySelector('[data-list-search]') as HTMLInputElement;
const count = (scope: ParentNode = container) =>
  scope.querySelector('[data-list-count]')?.textContent;
const buttonByText = (text: string, scope: ParentNode = container) =>
  Array.from(scope.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === text)!;

describe('listSearch — 이름 일치·이름순 단일 출처', () => {
  test('matchesQuery = 앞뒤 공백 제거·대소문자 무시 부분 일치, 빈 검색어는 통과', () => {
    expect(matchesQuery('Alice Blue', '')).toBe(true);
    expect(matchesQuery('Alice Blue', '   ')).toBe(true);
    expect(matchesQuery('Alice Blue', ' blue ')).toBe(true);
    expect(matchesQuery('Alice Blue', 'ALI')).toBe(true);
    expect(matchesQuery('Alice Blue', 'red')).toBe(false);
    expect(matchesQuery('빨간 모자', '모자')).toBe(true);
  });
  test('hasQuery = 공백만이면 거짓', () => {
    expect(hasQuery('')).toBe(false);
    expect(hasQuery('  ')).toBe(false);
    expect(hasQuery(' a')).toBe(true);
  });
  test('compareNames = 숫자 자연 정렬·대소문자 무시', () => {
    expect(['b10', 'B2', 'a'].sort(compareNames)).toEqual(['a', 'B2', 'b10']);
  });
  test('listCountText = 검색 중·걸러짐이면 「n / 전체 m」, 아니면 「전체 m개」', () => {
    expect(listCountText(3, 3)).toBe('전체 3개');
    expect(listCountText(3, 3, 'a')).toBe('3 / 전체 3');
    expect(listCountText(1, 3)).toBe('1 / 전체 3');
    expect(listCountText(0, 0)).toBe('전체 0개');
  });
});

describe('ListSearchBar — 공용 검색 줄', () => {
  test('입력(기본 문구·aria-label)·개수·정렬 select', async () => {
    const onQuery = jest.fn();
    const onSort = jest.fn();
    await act(async () =>
      root.render(
        <ListSearchBar
          query=""
          onQueryChange={onQuery}
          shown={4}
          total={4}
          sort={{ value: 'a', onChange: onSort, options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] }}
        />,
      ),
    );
    const input = search();
    expect(input.placeholder).toBe('이름 검색');
    expect(input.getAttribute('aria-label')).toBe('이름 검색');
    expect(input.className).toContain('h-8');
    expect(count()).toBe('전체 4개');
    await typeIn(input, 'x');
    expect(onQuery).toHaveBeenCalledWith('x');
    const select = q('[data-list-sort]') as HTMLSelectElement;
    expect(select.getAttribute('aria-label')).toBe('정렬');
    await act(async () => {
      select.value = 'b';
      Simulate.change(select);
    });
    expect(onSort).toHaveBeenCalledWith('b');
  });
  test('검색어가 있으면 「n / 전체 m」, compact 면 h-7', async () => {
    await act(async () =>
      root.render(<ListSearchBar compact query="ab" onQueryChange={jest.fn()} shown={2} total={5} placeholder="찾기" />),
    );
    expect(count()).toBe('2 / 전체 5');
    expect(search().placeholder).toBe('찾기');
    expect(search().className).toContain('h-7');
    expect(q('[data-list-sort]')).toBeNull();
  });
  test('onQueryChange 가 없으면 입력 없이 정렬·개수만', async () => {
    await act(async () =>
      root.render(
        <ListSearchBar shown={2} total={2} sort={{ value: 'a', onChange: jest.fn(), options: [{ value: 'a', label: 'A' }] }} />,
      ),
    );
    expect(search()).toBeNull();
    expect(q('[data-list-sort]')).not.toBeNull();
    expect(count()).toBe('전체 2개');
  });
});

describe('③ 씬 템플릿 관리 — 정렬·개수(검색 없음)', () => {
  const rowNames = () => qa('[data-modal-slot="body"] span.truncate').map((s) => s.textContent);
  test('지정 순이 기본, 이름순이면 자연 정렬, 개수 「전체 n개」, 검색 입력 없음', async () => {
    mockTemplates.list = ['b10', 'B2', 'a'];
    await act(async () => root.render(<SceneTemplateManager onClose={jest.fn()} />));
    expect(search()).toBeNull();
    expect(count()).toBe('전체 3개');
    const select = q('[data-list-sort]') as HTMLSelectElement;
    expect(select.value).toBe('order');
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['지정 순', '이름순']);
    expect(rowNames()).toEqual(['b10', 'B2', 'a']);
    await act(async () => {
      select.value = 'name';
      Simulate.change(select);
    });
    expect(rowNames()).toEqual(['a', 'B2', 'b10']);
    // 원본 목록(저장 순서)은 그대로
    expect(mockTemplates.list).toEqual(['b10', 'B2', 'a']);
  });
  test('빈 목록이면 정렬 줄을 그리지 않는다', async () => {
    await act(async () => root.render(<SceneTemplateManager onClose={jest.fn()} />));
    expect(q('[data-list-search-bar]')).toBeNull();
  });
});

describe('④ 내보내기 프리셋 관리 — 이름 검색', () => {
  const preset = (name: string) => ({ name, format: 'png', isDefault: false });
  const rowNames = (scope: ParentNode) =>
    Array.from(scope.querySelectorAll('span.truncate')).map((s) => s.textContent);
  beforeEach(() => {
    const list = [preset('alpha'), preset('beta'), preset('gamma')];
    mockAppState.loadExportPresets = () => list;
  });

  test('PC: aside 에 검색 줄([새 프리셋 추가] 아래), 거르기·개수·0건 문구', async () => {
    await act(async () => root.render(<ExportPresetManager />));
    const aside = slot('aside')!;
    expect(search(aside)).not.toBeNull();
    expect(count(aside)).toBe('전체 3개');
    await typeIn(search(aside), 'ET');
    expect(rowNames(slot('aside')!)).toEqual(['beta']);
    expect(count(slot('aside')!)).toBe('1 / 전체 3');
    await typeIn(search(slot('aside')!), 'zzz');
    expect(q('[data-list-no-hits]')?.textContent).toBe('검색 결과가 없습니다');
    expect(slot('aside')!.textContent).not.toContain('저장된 프리셋이 없습니다');
  });

  test('걸러져도 편집 중 선택은 유지, 행 삭제는 원래 인덱스로', async () => {
    await act(async () => root.render(<ExportPresetManager />));
    // gamma 선택(편집) → 검색으로 숨겨도 편집 제목은 그대로
    const gammaRow = qa('[data-modal-slot="aside"] span.truncate').find((s) => s.textContent === 'gamma')!;
    await act(async () => Simulate.click(gammaRow));
    expect(slot('body')!.textContent).toContain('"gamma" 편집');
    await typeIn(search(slot('aside')!), 'beta');
    expect(slot('body')!.textContent).toContain('"gamma" 편집');
    // 보이는 유일한 행(beta = 원래 1번)을 삭제
    const del = slot('aside')!.querySelector('button[aria-label="삭제"]') as HTMLButtonElement;
    await act(async () => Simulate.click(del));
    const dialog = mockAppState.pushDialog.mock.calls[0][0];
    await act(async () => dialog.callback());
    const saved = (saveExportPresetsRecorded as jest.Mock).mock.calls[0][0];
    expect(saved.map((p: any) => p.name)).toEqual(['alpha', 'gamma']);
    // 편집 인덱스 보정 뒤에도 gamma 편집 그대로
    expect(slot('body')!.textContent).toContain('"gamma" 편집');
  });

  test('행 복제도 원래 인덱스 바로 아래에 넣는다', async () => {
    await act(async () => root.render(<ExportPresetManager />));
    await typeIn(search(slot('aside')!), 'alp');
    const dup = slot('aside')!.querySelector('button[aria-label="복제"]') as HTMLButtonElement;
    await act(async () => Simulate.click(dup));
    const saved = (saveExportPresetsRecorded as jest.Mock).mock.calls[0][0];
    expect(saved.map((p: any) => p.name)).toEqual(['alpha', 'alpha 복사본', 'beta', 'gamma']);
  });

  test('모바일: 본문 한 열에도 검색 줄', async () => {
    mockEnv.mobile = true;
    await act(async () => root.render(<ExportPresetManager />));
    expect(slot('aside')).toBeNull();
    await typeIn(search(slot('body')!), 'gam');
    expect(count(slot('body')!)).toBe('1 / 전체 3');
  });
});

describe('② 프롬프트조각 — 선택 그룹 조각 검색', () => {
  const group = (name: string, names: string[]) => ({
    name,
    pieces: names.map((n) => ({ name: n, prompt: '', multi: false })),
  });
  const pieceNames = () => qa('[data-modal-slot="body"] .font-bold').map((d) => d.textContent);
  const selectGroup = async (label: string) => {
    const btn = Array.from(slot('aside')!.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').startsWith(label),
    )!;
    await act(async () => Simulate.click(btn));
  };

  test('거르기·개수·0건·검색 중 드래그 잠금 + 안내, 그룹을 바꾸면 비움', async () => {
    mockSession.library = new Map([
      ['g1', group('g1', ['red', 'blue', 'green'])],
      ['g2', group('g2', ['x'])],
    ]);
    await act(async () => root.render(<PieceEditor onClose={jest.fn()} />));
    expect(search()).toBeNull(); // 그룹 미선택
    await selectGroup('g1');
    expect(search().placeholder).toBe('조각 이름 검색');
    expect(count()).toBe('전체 3개');
    expect(q('[data-list-drag-locked]')).toBeNull();
    expect(mockDrag.specs[mockDrag.specs.length - 1].canDrag()).toBe(true);

    await typeIn(search(), 'BL');
    expect(pieceNames()).toEqual(['blue']);
    expect(count()).toBe('1 / 전체 3');
    expect(q('[data-list-drag-locked]')?.textContent).toBe('검색 중에는 순서를 바꿀 수 없습니다');
    expect(mockDrag.specs[mockDrag.specs.length - 1].canDrag()).toBe(false);

    await typeIn(search(), 'zzz');
    expect(pieceNames()).toEqual([]);
    expect(q('[data-list-no-hits]')?.textContent).toBe('검색 결과가 없습니다');

    await selectGroup('g2');
    expect(search().value).toBe('');
    expect(pieceNames()).toEqual(['x']);
    expect(q('[data-list-drag-locked]')).toBeNull();
  });
});

describe('① 캐릭터 프리셋 관리 — 이름 검색', () => {
  const cards = () => qa('[data-test-card]');
  const cardNames = () => cards().map((c) => c.getAttribute('data-name'));
  beforeEach(() => {
    mockGlobalChars.entries = [
      { id: 'g1', name: 'Alice', folder: 'F', preset: {} },
      { id: 'g2', name: 'Bob', folder: null, preset: {} },
      { id: 'g3', name: 'alicia', folder: 'F', preset: {} },
    ];
    mockGlobalChars.folders = ['F'];
    const locals = [{ name: 'Red' }, { name: 'Blue' }, { name: 'Navy blue' }];
    mockSession.getCharacterPresets = () => locals;
  });

  test('글로벌: 거르기·개수·0건·드래그 잠금 안내', async () => {
    await act(async () => root.render(<CharacterPresetEditor />));
    expect(search().placeholder).toBe('프리셋 이름 검색');
    expect(count()).toBe('전체 3개');
    expect(cards().every((c) => c.getAttribute('data-locked') === 'false')).toBe(true);
    await typeIn(search(), 'ali');
    expect(cardNames()).toEqual(['Alice', 'alicia']);
    expect(count()).toBe('2 / 전체 3');
    expect(q('[data-list-drag-locked]')).not.toBeNull();
    expect(cards().every((c) => c.getAttribute('data-locked') === 'true')).toBe(true);
    // 걸러도 index 는 전체 목록 기준
    expect(cards().map((c) => c.getAttribute('data-index'))).toEqual(['0', '2']);
    await typeIn(search(), 'zzz');
    expect(cards()).toHaveLength(0);
    expect(q('[data-list-no-hits]')?.textContent).toBe('검색 결과가 없습니다');
  });

  test('글로벌: 개수는 지금 폴더 범위 기준', async () => {
    await act(async () => root.render(<CharacterPresetEditor />));
    const folderBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').startsWith('F'),
    )!;
    await act(async () => Simulate.click(folderBtn));
    expect(count()).toBe('전체 2개');
    await typeIn(search(), 'cia');
    expect(cardNames()).toEqual(['alicia']);
    expect(count()).toBe('1 / 전체 2');
  });

  test('「전체 선택」은 보이는 항목만 — 숨은 선택은 유지', async () => {
    await act(async () => root.render(<CharacterPresetEditor />));
    await act(async () => Simulate.click(buttonByText('선택 모드')));
    await typeIn(search(), 'bob');
    await act(async () => Simulate.click(buttonByText('전체 선택')));
    expect(container.textContent).toContain('1개 선택');
    expect(buttonByText('전체 해제')).toBeTruthy();
    await typeIn(search(), '');
    // 검색을 지우면 3개 중 1개만 선택 — 버튼은 다시 「전체 선택」
    await act(async () => Simulate.click(buttonByText('전체 선택')));
    expect(container.textContent).toContain('3개 선택');
  });

  test('로컬: 보기 전환 시 검색 비움, 거르기·원래 인덱스·드래그 잠금', async () => {
    await act(async () => root.render(<CharacterPresetEditor />));
    await typeIn(search(), 'ali');
    // C-3(2026-11-15): 보기 전환은 PC aside 의 [로컬 | 글로벌] 분할 버튼 — 검색은 도구줄 안
    await act(async () => Simulate.click(buttonByText('로컬')));
    expect(search().value).toBe('');
    expect(cards().every((c) => c.getAttribute('data-test-card') === 'local')).toBe(true);
    expect(count()).toBe('전체 3개');
    await typeIn(search(), 'blue');
    expect(cardNames()).toEqual(['Blue', 'Navy blue']);
    expect(cards().map((c) => c.getAttribute('data-index'))).toEqual(['1', '2']);
    expect(cards().every((c) => c.getAttribute('data-locked') === 'true')).toBe(true);
    expect(count()).toBe('2 / 전체 3');
    expect(q('[data-list-drag-locked]')).not.toBeNull();
  });
});
