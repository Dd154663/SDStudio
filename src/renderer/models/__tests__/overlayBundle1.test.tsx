// 오버레이 묶음 1(2026-11-11) — 우선 창을 크기 등급·슬롯으로 옮긴 결과의 렌더 검사.
// 씬 템플릿 관리(m·도구줄·행 「프로젝트로 복사」) · 내보내기 프리셋 관리(PC l·aside·바닥줄·빠진 칸 안내 / 모바일 s 한 열)
// · 프롬프트조각(PC l·aside 그룹 목록·도구줄 / 모바일 드롭다운 한 열) · 프로젝트 탐색(xl·인라인 70vh 는 모바일만, 소스 검사).
// 환경설정(PC l·세로 탭·바닥줄)은 configScreenSplit.test.tsx 에서 함께 본다.
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import * as fs from 'fs';
import * as path from 'path';

const mockEnv = { mobile: false };
const mockTemplates: { list: string[] } = { list: [] };
const mockSession: any = { name: 'P', library: new Map() };
const mockGlobalLibrary = new Map<string, any>();

jest.mock('@capacitor/app', () => ({
  App: { addListener: jest.fn(), minimizeApp: jest.fn() },
}));
jest.mock('../index', () => ({
  get isMobile() {
    return mockEnv.mobile;
  },
  backend: { selectDir: jest.fn(), writeFile: jest.fn(), publishExport: jest.fn() },
  promptService: {},
  sessionService: {
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    get: jest.fn(),
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
  DropdownSelect: ({ options }: any) => (
    <select data-testid="dropdown">
      {options.map((o: any) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));
jest.mock('../projectDeleteUndo', () => ({ deleteProjectRecorded: jest.fn() }));
jest.mock('../sceneImportUndo', () => ({ recordSceneTemplateImport: jest.fn() }));
jest.mock('../TrashService', () => ({ PROJECT_RETENTION_DAYS: 30 }));
jest.mock('../exportUtil', () => ({ saveJsonFile: jest.fn() }));
jest.mock('../driveImport', () => ({ interceptFileImportClick: jest.fn() }));
jest.mock('../globalLibraryUndo', () => ({ saveExportPresetsRecorded: jest.fn() }));
jest.mock('../types', () => ({
  isValidPieceLibrary: jest.fn(),
  Piece: { fromJSON: (x: any) => x },
  PieceLibrary: { fromJSON: (x: any) => x },
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
jest.mock('react-dnd', () => ({
  useDrag: () => [{ isDragging: false }, jest.fn(), jest.fn()],
  useDrop: () => [{}, jest.fn()],
}));
jest.mock('react-dnd-html5-backend', () => ({ getEmptyImage: jest.fn() }));

import SceneTemplateManager from '../../componenets/SceneTemplateManager';
import ExportPresetManager from '../../componenets/ExportPresetManager';
import PieceEditor from '../../componenets/PieceEditor';
import { templateService } from '../index';

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
  mockGlobalLibrary.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const frame = () => container.querySelector<HTMLElement>('[data-modal-size]');
const slot = (name: string) => container.querySelector<HTMLElement>(`[data-modal-slot="${name}"]`);
const buttonsIn = (el: Element | null) =>
  Array.from(el?.querySelectorAll('button') ?? []).map((b) => (b.textContent ?? '').trim());

describe('씬 템플릿 관리 — size m·도구줄·행 「프로젝트로 복사」', () => {
  test('등급 m, 도구줄 슬롯에 4동작, 빈 목록 안내는 본문', async () => {
    await act(async () => root.render(<SceneTemplateManager onClose={jest.fn()} />));
    expect(frame()?.getAttribute('data-modal-size')).toBe('m');
    // PC m = 최소 높이(빈 목록에서도 쪼그라들지 않음)
    expect(frame()?.style.minHeight).not.toBe('');
    const toolbar = slot('toolbar');
    expect(toolbar?.textContent).toContain('현재 씬 전체로 만들기');
    expect(toolbar?.textContent).toContain('빈 템플릿');
    expect(toolbar?.textContent).toContain('현재 프로젝트로 복사');
    expect(toolbar?.textContent).toContain('파일 불러오기');
    expect(slot('body')?.textContent).toContain('씬 템플릿이 없습니다');
  });

  test('행 「프로젝트로 복사」는 선택 창 없이 그 템플릿 이름을 넘기고, 열려 있는 템플릿 자신은 막는다', async () => {
    mockTemplates.list = ['T1', 'P'];
    await act(async () => root.render(<SceneTemplateManager onClose={jest.fn()} />));
    const rowButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button[aria-label="프로젝트로 복사"]'),
    );
    expect(rowButtons).toHaveLength(2);
    await act(async () => rowButtons[0].click());
    expect(templateService.importSceneTemplate).toHaveBeenCalledWith(mockSession, 'T1');
    // 현재 프로젝트(P) 자신 — aria-disabled, 눌러도 호출 없음(행 열기로도 새지 않음)
    expect(rowButtons[1].getAttribute('aria-disabled')).toBe('true');
    await act(async () => rowButtons[1].click());
    expect(templateService.importSceneTemplate).toHaveBeenCalledTimes(1);
  });
});

describe('내보내기 프리셋 관리 — PC l 두 열·바닥줄 / 모바일 s 한 열', () => {
  test('PC: 등급 l, aside 에 [새 프리셋 추가], 바닥줄에 [프리셋 추가][취소], 폼은 2열 격자', async () => {
    await act(async () => root.render(<ExportPresetManager />));
    expect(frame()?.getAttribute('data-modal-size')).toBe('l');
    expect(slot('aside')?.textContent).toContain('새 프리셋 추가');
    expect(buttonsIn(slot('footer'))).toEqual(['프리셋 추가', '취소']);
    expect(container.querySelector('[data-export-fields-columns="2"]')).not.toBeNull();
    // 저장 버튼 색 = .btn-solid-sky(인라인 hover:bg-sky-600 아님)
    const save = Array.from(slot('footer')!.querySelectorAll('button'))[0];
    expect(save.className).toContain('btn-solid-sky');
    expect(save.className).not.toContain('hover:bg-sky-600');
  });

  test('PC: 이름이 비면 바닥줄 왼쪽에 빠진 칸을 안내하고, 저장을 누르면 칸 이름으로 알린다(저장 안 함)', async () => {
    await act(async () => root.render(<ExportPresetManager />));
    const hint = container.querySelector('[data-export-preset-problems]');
    expect(hint?.textContent).toContain('이름');
    expect(slot('footer')?.contains(hint!)).toBe(true);
    const save = Array.from(slot('footer')!.querySelectorAll('button'))[0];
    await act(async () => save.click());
    expect(mockAppState.pushMessage).toHaveBeenCalledWith(expect.stringContaining('이름'), 'error');
    expect(mockAppState.saveExportPresets).not.toHaveBeenCalled();
  });

  test('모바일: 등급 s, aside·바닥줄 없이 한 열(폼 안 버튼)', async () => {
    mockEnv.mobile = true;
    await act(async () => root.render(<ExportPresetManager />));
    expect(frame()?.getAttribute('data-modal-size')).toBe('s');
    expect(slot('aside')).toBeNull();
    expect(slot('footer')).toBeNull();
    expect(container.querySelector('[data-export-fields-columns]')).toBeNull();
    expect(slot('body')?.textContent).toContain('새 프리셋 추가');
    expect(buttonsIn(slot('body'))).toEqual(expect.arrayContaining(['프리셋 추가', '취소']));
  });
});

describe('프롬프트조각 — PC l·aside 그룹 목록·도구줄 / 모바일 드롭다운', () => {
  const group = (name: string, n: number) => ({ name, pieces: Array.from({ length: n }, (_, i) => ({ name: 'p' + i })) });

  test('PC: 등급 l, aside 에 로컬/전역 전환과 그룹 목록(조각 수), 도구줄에 그룹 동작, 드롭다운 없음', async () => {
    mockSession.library = new Map([
      ['g1', group('g1', 2)],
      ['g2', group('g2', 0)],
    ]);
    mockGlobalLibrary.set('G', group('G', 5));
    await act(async () => root.render(<PieceEditor onClose={jest.fn()} />));
    expect(frame()?.getAttribute('data-modal-size')).toBe('l');
    const aside = slot('aside')!;
    expect(buttonsIn(aside)).toEqual(['로컬 조각', '전역 조각', 'g12', 'g20']);
    expect(buttonsIn(slot('toolbar'))).toEqual(
      expect.arrayContaining(['그룹 추가', '불러오기 (.txt/.json)', '내보내기', '그룹 삭제']),
    );
    expect(container.querySelector('[data-testid="dropdown"]')).toBeNull();
    expect(slot('body')?.textContent).toContain('왼쪽 목록에서 조각그룹을 선택하세요');
    // 전역으로 전환 — 목록이 전역 그룹으로 바뀌고 안내 문구도 전역
    const globalBtn = Array.from(aside.querySelectorAll('button')).find((b) => b.textContent === '전역 조각')!;
    await act(async () => globalBtn.click());
    expect(buttonsIn(slot('aside'))).toEqual(['로컬 조각', '전역 조각', 'G5']);
    expect(slot('body')?.textContent).toContain('전역 조각은 모든 프로젝트에서 공유됩니다');
  });

  test('모바일: aside·도구줄 없이 종전 한 열(범위 탭 → 드롭다운+버튼)', async () => {
    mockEnv.mobile = true;
    mockSession.library = new Map([['g1', group('g1', 1)]]);
    await act(async () => root.render(<PieceEditor onClose={jest.fn()} />));
    expect(slot('aside')).toBeNull();
    expect(slot('toolbar')).toBeNull();
    expect(container.querySelector('[data-testid="dropdown"]')).not.toBeNull();
    expect(slot('body')?.textContent).toContain('위 드롭다운에서 조각그룹을 선택하세요');
  });

  test('되돌리기 계측 호출부가 종전 그대로 남아 있다(소스 검사 — 화면 자리만 옮김)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'componenets', 'PieceEditor.tsx'), 'utf8');
    const count = (re: RegExp) => (src.match(re) ?? []).length;
    // 2026-11-10(HEAD b4cc7ce) 기준 호출 수와 같다(그룹 편집 5·조각 편집 3·복사 대상 기록 5·되돌리기 라벨 9)
    expect(count(/editPieceGroups\(/g)).toBe(5);
    expect(count(/editPieceLibrary\(/g)).toBe(3);
    expect(count(/recordTarget\(/g)).toBe(5);
    expect(count(/UNDO_TEXT\./g)).toBe(9);
  });
});

describe('프로젝트 탐색 — size xl, 인라인 70vh 는 모바일만', () => {
  test('소스 검사', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'componenets', 'ProjectBrowser.tsx'), 'utf8');
    expect(src).toMatch(/title="프로젝트 탐색" size="xl"/);
    expect(src).toMatch(/style=\{isMobile \? \{ height: '70vh' \} : undefined\}/);
    expect(src).not.toMatch(/style=\{\{ height: '70vh' \}\}/);
  });
});

describe('실기 피드백 1(2026-11-11) — 내보내기 2열 라벨 위 쌓기 · 프롬프트조각 범위 전환 스크롤', () => {
  test('내보내기 PC 2열: 라벨+입력 칸은 라벨 한 줄 위 + 입력 전폭, 라벨 열(w-24) 없음, 체크박스는 라벨 옆', async () => {
    await act(async () => root.render(<ExportPresetManager />));
    const grid = container.querySelector<HTMLElement>('[data-export-fields-columns="2"]')!;
    const cells = Array.from(grid.querySelectorAll<HTMLElement>('[data-export-field="stacked"]'));
    expect(cells.length).toBeGreaterThanOrEqual(5);
    for (const cell of cells) {
      expect(cell.parentElement).toBe(grid);
      expect(cell.className).toContain('flex-col');
      const [label, control] = Array.from(cell.children) as HTMLElement[];
      expect(label.tagName).toBe('LABEL');
      expect(label.className).not.toContain('w-24');
      expect(control.className).toContain('min-w-0');
    }
    expect(grid.querySelector('label.w-24')).toBeNull();
    const checks = Array.from(grid.querySelectorAll('input[type="checkbox"]'));
    expect(checks.length).toBeGreaterThan(0);
    for (const c of checks) expect(c.closest('label')?.className).toContain('items-center');
  });

  test('내보내기 모바일 1열: 종전 라벨(w-24)|입력 가로 한 줄 그대로', async () => {
    mockEnv.mobile = true;
    await act(async () => root.render(<ExportPresetManager />));
    expect(container.querySelector('[data-export-field="stacked"]')).toBeNull();
    expect(container.querySelectorAll('label.w-24').length).toBeGreaterThanOrEqual(5);
  });

  test('프롬프트조각 PC: 로컬/전역 전환 시 본문·그룹 목록 스크롤이 맨 위로', async () => {
    mockSession.library = new Map([['g1', { name: 'g1', pieces: [] }]]);
    await act(async () => root.render(<PieceEditor onClose={jest.fn()} />));
    const body = slot('body')!;
    const list = slot('aside')!.querySelector<HTMLElement>('[data-piece-group-list] > .overflow-auto')!;
    body.scrollTop = 300;
    list.scrollTop = 120;
    const globalBtn = Array.from(slot('aside')!.querySelectorAll('button')).find((b) => b.textContent === '전역 조각')!;
    await act(async () => globalBtn.click());
    expect(body.scrollTop).toBe(0);
    expect(list.scrollTop).toBe(0);
  });

  test('프롬프트조각 모바일: 범위 탭 전환 시 본문 스크롤이 맨 위로', async () => {
    mockEnv.mobile = true;
    await act(async () => root.render(<PieceEditor onClose={jest.fn()} />));
    const body = slot('body')!;
    body.scrollTop = 200;
    const globalBtn = Array.from(body.querySelectorAll('button')).find((b) => b.textContent === '전역 조각')!;
    await act(async () => globalBtn.click());
    expect(body.scrollTop).toBe(0);
  });
});
