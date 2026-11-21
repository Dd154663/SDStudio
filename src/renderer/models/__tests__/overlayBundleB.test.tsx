// 오버레이 묶음 B(2026-11-14) — 5창을 size m·슬롯으로 옮긴 결과의 검사.
// 렌더 검사: 씬 휴지통(도구줄 「N개 · 최근 삭제 순」·[휴지통 비우기] 0개면 비활성·보존 안내, 본문 = 목록만) ·
// 프로젝트 저장 공간 관리(도구줄 [전체 계산]·합계, 안내 = 본문 첫 줄, 행 계산 단추 aria-label) ·
// 직접 내보내기 설정(바닥줄 [내보내기][취소]·빠진 칸 안내 footerStart·PC 2열/모바일 1열).
// 소스 검사(큰 파일이라 렌더 대신): 프로젝트 휴지통(SessionSelect — 무거운 파일)·사전 세팅 일괄 삭제(PreSetEdtior —
// 바닥줄 [선택 삭제][닫기]·안쪽 max-h 스크롤 없음)·App.tsx 에 size 없는 여는 태그가 남지 않음·음수 여백 없음.
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import * as fs from 'fs';
import * as path from 'path';

const mockEnv = { mobile: false };
const mockTrash: { scenes: any[] } = { scenes: [] };
const mockSize: any = {
  entries: {},
  bulkProgress: undefined,
  calculating: [],
  ensureLoaded: jest.fn(),
  calculate: jest.fn(),
  calculateAll: jest.fn(),
  cancelBulk: jest.fn(),
};

jest.mock('@capacitor/app', () => ({
  App: { addListener: jest.fn(), minimizeApp: jest.fn() },
}));
jest.mock('../index', () => ({
  get isMobile() {
    return mockEnv.mobile;
  },
  backend: { selectDir: jest.fn(async () => '/chosen') },
  trashService: {
    getDeletedScenes: jest.fn(async () => mockTrash.scenes),
    permanentlyDeleteScene: jest.fn(async () => undefined),
  },
  projectSizeService: mockSize,
  sessionService: { list: jest.fn(() => ['프로젝트A', '프로젝트B']) },
  templateService: { filterVisibleProjects: (names: string[]) => names },
}));
const mockAppState: any = {
  curSession: { name: 'p' },
  pushMessage: jest.fn(),
  pushDialog: jest.fn(),
  setProgressDialog: jest.fn(),
  openProjectWebpOptimize: jest.fn(),
  incrementModalOverlay: jest.fn(),
  decrementModalOverlay: jest.fn(),
  directExportRequest: undefined,
};
jest.mock('../AppService', () => ({ appState: mockAppState }));
jest.mock('../platform', () => ({
  platform: { supportsWebpConvert: false },
  buildImageOptimizeOptions: () => [
    { text: '원본', value: 'original' },
    { text: 'WebP', value: 'lossy' },
    { text: 'AVIF', value: 'avif' },
  ],
}));
jest.mock('../TrashService', () => ({
  IMAGE_RETENTION_DAYS: 7,
  SCENE_RETENTION_DAYS: 14,
  PROJECT_RETENTION_DAYS: 30,
}));
jest.mock('../deleteUndo', () => ({ restoreSceneFromTrashRecorded: jest.fn() }));
jest.mock('../../componenets/ActionIcon', () => ({ ActionIcon: () => null }));
jest.mock('../../componenets/UtilComponents', () => ({
  DropdownSelect: ({ selectedOption, options, onSelect }: any) => (
    <select value={selectedOption} onChange={(e) => onSelect({ value: e.target.value })}>
      {options.map((o: any) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

import { SceneTrashView, useTrashListPanel } from '../../componenets/TrashViews';
import StorageManageModal from '../../componenets/StorageManageModal';
import DirectExportDialog from '../../componenets/DirectExportDialog';

let root: Root;
let container: HTMLDivElement;
beforeAll(() => {
  (global as any).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  jest.clearAllMocks();
  mockEnv.mobile = false;
  mockTrash.scenes = [];
  mockSize.entries = {};
  mockSize.bulkProgress = undefined;
  mockSize.calculating = [];
  mockAppState.directExportRequest = undefined;
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
const buttonsIn = (el: Element | null | undefined) =>
  Array.from(el?.querySelectorAll('button') ?? []).map((b) => (b.textContent ?? '').trim());
const buttonByText = (el: Element | null | undefined, text: string) =>
  Array.from(el?.querySelectorAll('button') ?? []).find(
    (b) => (b.textContent ?? '').trim() === text,
  ) as HTMLButtonElement | undefined;

// ── 소스 검사 도우미(overlayBundleA 와 같은 방식) ──
const readComponent = (name: string) =>
  fs.readFileSync(path.join(__dirname, '..', '..', 'componenets', name), 'utf8');
function modalOpenTags(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/<ModalOverlay\b/g)) {
    const start = m.index ?? 0;
    let depth = 0;
    let quote: string | null = null;
    for (let i = start + m[0].length; i < src.length; i++) {
      const ch = src[i];
      if (quote) {
        if (ch === quote && src[i - 1] !== '\\') quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') quote = ch;
      else if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (ch === '>' && depth === 0 && src[i - 1] !== '=') {
        out.push(src.slice(start, i + 1));
        break;
      }
    }
  }
  return out;
}
const tagWithTitle = (file: string, marker: string) => {
  const hits = modalOpenTags(readComponent(file)).filter((t) => t.includes(marker));
  expect(hits).toHaveLength(1);
  return hits[0];
};

describe('소스 검사 — 5창의 등급 m(width 없음)', () => {
  test.each([
    ['프로젝트 휴지통', 'SessionSelect.tsx', 'title="🗑️ 프로젝트 휴지통"'],
    ['씬 휴지통', 'TrashViews.tsx', 'title="🗑️ 씬 휴지통"'],
    ['프로젝트 저장 공간 관리', 'StorageManageModal.tsx', 'title="프로젝트 저장 공간 관리"'],
    ['직접 내보내기 설정', 'DirectExportDialog.tsx', 'title="직접 내보내기 설정"'],
    ['사전 세팅 일괄 삭제', 'PreSetEdtior.tsx', 'title="사전 세팅 일괄 삭제"'],
  ])('%s — %s 여는 태그가 size="m"', (_name, file, marker) => {
    const tag = tagWithTitle(file, marker);
    expect(tag).toContain('size="m"');
    expect(tag).not.toMatch(/\swidth=/);
  });

  test('휴지통 두 창은 도구줄(toolbar) 슬롯을 쓰고, App.tsx 에는 ModalOverlay 여는 태그가 남지 않는다', () => {
    expect(tagWithTitle('SessionSelect.tsx', '프로젝트 휴지통')).toContain('toolbar={toolbar}');
    expect(tagWithTitle('TrashViews.tsx', '씬 휴지통')).toContain('toolbar={toolbar}');
    expect(modalOpenTags(readComponent('App.tsx'))).toHaveLength(0);
  });

  test('음수 여백·붙박이 머리 잔류 없음(TrashViews·StorageManageModal)', () => {
    for (const file of ['TrashViews.tsx', 'StorageManageModal.tsx']) {
      const src = readComponent(file);
      expect(src).not.toMatch(/-top-5|-mx-5|-mt-5/);
      expect(src).not.toMatch(/className="[^"]*\bsticky\b/);
    }
  });

  test('사전 세팅 일괄 삭제: 바닥줄 [선택 삭제][닫기]·왼쪽 「N개 선택됨」·안쪽 max-h 스크롤 없음', () => {
    const src = readComponent('PreSetEdtior.tsx');
    const tag = tagWithTitle('PreSetEdtior.tsx', 'title="사전 세팅 일괄 삭제"');
    expect(tag).toContain('footer={footer}');
    expect(tag).toContain('footerStart={footerStart}');
    const start = src.indexOf('const PreSetBulkManageModal');
    const end = src.indexOf('title="사전 세팅 일괄 삭제"', start);
    const block = src.slice(start, src.indexOf('</ModalOverlay>', end));
    const footer = block.slice(block.indexOf('const footer = ('), block.indexOf('return (', block.indexOf('const footer = (')));
    expect(footer.indexOf('선택 삭제')).toBeGreaterThan(-1);
    expect(footer.indexOf('선택 삭제')).toBeLessThan(footer.indexOf('닫기'));
    expect(footer).toContain('DIALOG_DANGER_BTN'); // 그룹 2-b: 위험 확정 = 공용 상수(btn-solid-red 알약)
    expect(footer).toContain('disabled={selected.size === 0}');
    expect(footer).toContain('onClick={onClose}');
    expect(block.slice(block.indexOf('const footerStart'), block.indexOf('const footer = ('))).toContain('선택됨');
    expect(block).not.toContain('max-h-72');
  });
});

describe('씬 휴지통 — size m·도구줄 머리·본문 목록만', () => {
  const renderTrash = async () => {
    await act(async () => root.render(<SceneTrashView projectName="p" onClose={jest.fn()} />));
  };

  test('비었을 때: 도구줄 「0개 · 최근 삭제 순」 + 비활성 [휴지통 비우기] + 보존 안내, 본문은 안내 문구', async () => {
    await renderTrash();
    expect(frame()?.getAttribute('data-modal-size')).toBe('m');
    const toolbar = slot('toolbar');
    expect(toolbar?.textContent).toContain('0개 · 최근 삭제 순');
    expect(buttonByText(toolbar, '휴지통 비우기')?.disabled).toBe(true);
    expect(toolbar?.textContent).toContain('14');
    expect(slot('body')?.textContent).toContain('휴지통이 비어 있습니다');
    expect(container.querySelector('[data-trash-list]')).toBeNull();
  });

  test('항목이 있을 때: 도구줄 개수·활성 [휴지통 비우기], 본문 data-trash-list 에 행·복원·영구 삭제', async () => {
    mockTrash.scenes = [
      { name: 'A', type: 'scene', deletedAt: 1 },
      { name: 'B', type: 'inpaint', deletedAt: 2 },
    ];
    await renderTrash();
    const toolbar = slot('toolbar');
    expect(toolbar?.textContent).toContain('2개 · 최근 삭제 순');
    const empty = buttonByText(toolbar, '휴지통 비우기')!;
    expect(empty.disabled).toBe(false);
    const list = slot('body')?.querySelector('[data-trash-list]');
    expect(list).not.toBeNull();
    expect(buttonsIn(list)).toEqual(['복원', '영구 삭제', '복원', '영구 삭제']);
    expect(buttonsIn(list)).not.toContain('휴지통 비우기');
    act(() => empty.click());
    expect(mockAppState.pushDialog).toHaveBeenCalledTimes(1);
  });

  test('useTrashListPanel: 불러오는 중이면 본문 「불러오는 중…」, 도구줄은 0개', async () => {
    const Probe = () => {
      const { toolbar, body } = useTrashListPanel({
        rows: [],
        loading: true,
        onRestore: jest.fn(),
        onPermanentDelete: jest.fn(),
        onEmptyAll: jest.fn(),
      });
      return (
        <div>
          <div data-probe="toolbar">{toolbar}</div>
          <div data-probe="body">{body}</div>
        </div>
      );
    };
    await act(async () => root.render(<Probe />));
    expect(container.querySelector('[data-probe="toolbar"]')?.textContent).toContain('0개');
    expect(container.querySelector('[data-probe="body"]')?.textContent).toContain('불러오는 중…');
  });
});

describe('프로젝트 저장 공간 관리 — size m·도구줄·안내는 본문 첫 줄', () => {
  const renderStorage = async () => {
    await act(async () =>
      root.render(<StorageManageModal isOpen onClose={jest.fn()} onJump={jest.fn()} />),
    );
  };

  test('도구줄 = [전체 계산] + 「계산됨 n/m개 · 총 X」, 안내 문단은 본문에', async () => {
    mockSize.entries = { 프로젝트A: { bytes: 2048, at: Date.now() } };
    await renderStorage();
    expect(frame()?.getAttribute('data-modal-size')).toBe('m');
    const toolbar = slot('toolbar');
    expect(buttonsIn(toolbar)).toEqual(['전체 계산']);
    expect(toolbar?.textContent).toContain('계산됨 1/2개 · 총 2.0 KB');
    expect(toolbar?.textContent).not.toContain('자동으로 계산하지 않으며');
    expect(slot('body')?.textContent).toContain('자동으로 계산하지 않으며');
  });

  test('계산 중이면 도구줄에 「계산 중... n/m」 + [중단]', async () => {
    mockSize.bulkProgress = { done: 1, total: 2 };
    await renderStorage();
    const toolbar = slot('toolbar');
    expect(toolbar?.textContent).toContain('계산 중... 1/2');
    act(() => buttonByText(toolbar, '중단')!.click());
    expect(mockSize.cancelBulk).toHaveBeenCalled();
  });

  test('행 계산 단추에 aria-label·Tooltip(계산 안 됨 = 「계산」, 계산됨 = 「다시 계산」)', async () => {
    mockSize.entries = { 프로젝트A: { bytes: 10, at: Date.now() } };
    await renderStorage();
    const again = container.querySelector<HTMLButtonElement>('button[aria-label="다시 계산"]')!;
    // 2026-11-20 UI 정돈 그룹 1-c: 기호 글자 ↻ → 사전 refresh 아이콘(ActionIcon — 이 파일에서는 목으로 null) — 글자 기호는 없다
    expect(again.textContent).toBe('');
    expect(fs.readFileSync(path.join(__dirname, '../../componenets/StorageManageModal.tsx'), 'utf8')).toContain(
      '<ActionIcon id="refresh"',
    );
    // 설명은 Tooltip 이 띄운다 — title 을 겹쳐 두면 설명이 두 번 뜬다(2026-11-18 아이콘 설명 메우기)
    expect(again.hasAttribute('title')).toBe(false);
    const calc = container.querySelector<HTMLButtonElement>('button[aria-label="계산"]')!;
    expect(calc.textContent).toBe('계산');
    act(() => calc.click());
    expect(mockSize.calculate).toHaveBeenCalledWith('프로젝트B');
  });
});

describe('직접 내보내기 설정 — size m·바닥줄 [내보내기][취소]·빠진 칸 안내 footerStart', () => {
  let resolve: jest.Mock;
  beforeEach(() => {
    resolve = jest.fn();
    mockAppState.directExportRequest = { projectName: 'proj', sceneNames: ['a'], resolve };
  });

  test.each([false, true])('모바일=%s: 바닥줄 순서·규격, 본문에는 버튼 없음, 첫 줄 = 프로젝트 · 대상 씬', async (mobile) => {
    mockEnv.mobile = mobile;
    await act(async () => root.render(<DirectExportDialog />));
    expect(frame()?.getAttribute('data-modal-size')).toBe('m');
    const footer = slot('footer');
    expect(buttonsIn(footer)).toEqual(['내보내기', '취소']);
    expect(buttonByText(footer, '내보내기')!.className).toContain('btn-solid-sky');
    expect(buttonByText(footer, '취소')!.className).toContain('btn-neutral');
    const body = slot('body')!;
    expect(buttonsIn(body)).not.toContain('내보내기');
    expect(body.firstElementChild?.firstElementChild?.textContent).toBe('proj · 대상 씬 1개');
    // PC 는 2열 격자, 모바일은 종전 세로 쌓기
    expect(!!body.querySelector('[data-export-fields-columns="2"]')).toBe(!mobile);
  });

  test('빠진 칸이 있으면 바닥줄 왼쪽에 안내, [내보내기]는 aria-disabled 이고 누르면 토스트만', async () => {
    await act(async () => root.render(<DirectExportDialog />));
    const optSelect = Array.from(container.querySelectorAll('select')).find((s) =>
      s.querySelector('option[value="avif"]'),
    )!;
    act(() => Simulate.change(optSelect, { target: { value: 'avif' } } as any));
    const quality = container.querySelector('input[placeholder="50"]') as HTMLInputElement;
    act(() => Simulate.change(quality, { target: { value: '101' } } as any));
    const problems = slot('footer')!.querySelector('[data-direct-export-problems]');
    expect(problems).not.toBeNull();
    expect(slot('body')!.querySelector('[data-direct-export-problems]')).toBeNull();
    const exportButton = buttonByText(slot('footer'), '내보내기')!;
    expect(exportButton.disabled).toBe(false);
    expect(exportButton.getAttribute('aria-disabled')).toBe('true');
    act(() => exportButton.click());
    expect(resolve).not.toHaveBeenCalled();
    expect(mockAppState.pushMessage).toHaveBeenCalledWith(expect.stringContaining('다음 칸을 확인해 주세요'), 'error');
  });

  test('[취소] = resolve(undefined)', async () => {
    await act(async () => root.render(<DirectExportDialog />));
    act(() => buttonByText(slot('footer'), '취소')!.click());
    expect(resolve).toHaveBeenCalledWith();
  });
});
