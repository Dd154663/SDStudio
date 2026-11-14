// 오버레이 묶음 A(2026-11-12) 「등급만 붙이면 끝」 10창 — size 등급·슬롯으로 옮긴 결과의 검사.
// 렌더 검사: 찾기 및 변환(l·aside 공용 씬 선택·씬 종류 칩·바닥줄 — 2026-11-12 재배치안 (가), 2026-11-14 A-3 일괄 삽입 분리로 탭 없음) · 환경설정 불러오기 미리보기(s·바닥줄 [불러오기 (N)][취소]·
// --z-modal-top 유지) · 템플릿 적용(s·바닥줄 [적용][취소], [취소] = 닫기) · size="full" = 옛 fullscreen.
// 소스 검사(큰 파일이라 렌더 대신): 캐릭터 위치 지정 ×2(full)·샘플링 그룹(m)·축하 영상(m)·태그 프리셋 관리(s)·
// 작가 상세(m·도구줄 동작 줄)·아티스트 태깅(l·PC 만 h-full)·Google 드라이브 백업(m·--z-modal-top 유지).
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import * as fs from 'fs';
import * as path from 'path';

const mockEnv = { mobile: false };
const mockTemplates: { globals: any[]; byId: Record<string, any> } = { globals: [], byId: {} };
const mockPreview: { req: any } = { req: null };

jest.mock('@capacitor/app', () => ({
  App: { addListener: jest.fn(), minimizeApp: jest.fn() },
}));
jest.mock('../index', () => ({
  get isMobile() {
    return mockEnv.mobile;
  },
  backend: { searchTags: jest.fn(async () => []) },
  loginService: {},
  sessionService: {
    getFolderOf: jest.fn(() => ''),
    applyProjectTemplateToSession: jest.fn(async () => undefined),
  },
  globalPresetService: { presets: [] },
  globalCharacterPresetService: { presets: [] },
  projectTemplateService: {
    ensureLoaded: jest.fn(async () => undefined),
    listGlobal: () => mockTemplates.globals,
    get: (id: string) => mockTemplates.byId[id],
  },
  templateService: {
    ensureLoaded: jest.fn(async () => undefined),
    resolveFolderTemplate: jest.fn(async () => null),
  },
}));
const mockAppState: any = {
  curSession: null,
  findReplaceOpen: true,
  closeFindReplace: jest.fn(),
  pushMessage: jest.fn(),
  pushDialog: jest.fn(),
  confirmAsync: jest.fn(),
  incrementModalOverlay: jest.fn(),
  decrementModalOverlay: jest.fn(),
};
jest.mock('../AppService', () => ({ appState: mockAppState }));
jest.mock('../SessionService', () => ({ renameScene: jest.fn() }));
jest.mock('../types', () => ({}));
jest.mock('../comboMode', () => ({ variantComboMode: jest.fn(() => false) }));
jest.mock('../sceneFieldUndo', () => ({ editScenesFields: jest.fn() }));
jest.mock('../undoService', () => ({
  UNDO_TEXT: {
    findReplaceConfirm: jest.fn(() => '확인 문구'),
    findReplaceConfirmButton: '모두 변환',
    findReplaceNotUndone: jest.fn(() => ''),
    comboBatchInsert: jest.fn(() => ''),
  },
}));
jest.mock('../findReplaceUndo', () => ({
  replaceAllRecorded: jest.fn(),
  unrecordedScopesOf: jest.fn(() => []),
}));
jest.mock('../../componenets/TemplateManagerModal', () => ({ TemplateWorkflowEditor: () => null }));
jest.mock('../../componenets/ActionIcon', () => ({ ActionIcon: () => null }));
jest.mock('../../componenets/HelpIcon', () => () => null);
jest.mock('../globalLibraryUndo', () => ({ setTemplateBadgeColorRecorded: jest.fn() }));
jest.mock('../exportUtil', () => ({ saveJsonFile: jest.fn() }));
jest.mock('../driveSync', () => ({
  chooseImportSource: jest.fn(),
  getSyncFolder: jest.fn(),
  isGoogleDriveConnectedHint: jest.fn(() => false),
  syncFileName: jest.fn(),
}));
jest.mock('../driveImport', () => ({ importFromDrive: jest.fn(), importTextWithSource: jest.fn() }));
jest.mock('../jsonExport', () => ({ stringifyExportJson: jest.fn() }));
jest.mock('../configSyncFlow', () => ({
  currentConfigPreviewRequest: () => mockPreview.req,
  importConfigText: jest.fn(),
  importTokenText: jest.fn(),
}));

import FindReplaceDialog from '../../componenets/FindReplaceDialog';
import { ConfigImportPreviewHost } from '../../componenets/ConfigSyncSection';
import { ReapplyTemplateModal } from '../../componenets/TemplateInheritModals';
import ModalOverlay from '../../componenets/ModalOverlay';

let root: Root;
let container: HTMLDivElement;
beforeAll(() => {
  (global as any).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  jest.clearAllMocks();
  mockEnv.mobile = false;
  mockTemplates.globals = [];
  mockTemplates.byId = {};
  mockPreview.req = null;
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
const backdrop = () => container.firstElementChild as HTMLElement;

// ── 소스 검사 도우미: <ModalOverlay …> 여는 태그를 모두 뽑는다(중괄호·따옴표 안의 > 는 건너뜀) ──
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
/** 제목 표식(title 속성 일부)으로 여는 태그 하나를 찾는다 */
const tagWithTitle = (file: string, titleMarker: string) => {
  const hits = modalOpenTags(readComponent(file)).filter((t) => t.includes(titleMarker));
  expect(hits.length).toBeGreaterThan(0); // 못 찾으면 실패
  return hits;
};

describe('소스 검사 — 10창의 등급(width·fullscreen 없음)', () => {
  const cases: [string, string, string, string, number][] = [
    // [창, 파일, 제목 표식, 등급, 같은 표식 태그 수]
    ['캐릭터 위치 지정(사전 세팅)', 'PreSetEdtior.tsx', 'title="캐릭터 위치 지정"', 'full', 1],
    ['캐릭터 위치 지정(씬 편집)', 'SceneEditor.tsx', 'title="캐릭터 위치 지정"', 'full', 1],
    ['샘플링·모델 설정 그룹', 'PreSetEdtior.tsx', 'title={showGroupOverlay', 'm', 1],
    ['축하 영상', 'ConfigSystemTab.tsx', 'title="🎉 축하합니다!"', 'm', 1],
    ['태그 프리셋 관리', 'ArtistLibraryTab.tsx', 'title="태그 프리셋 관리"', 's', 1],
    ['작가 상세', 'ArtistLibraryTab.tsx', 'title={artist.name}', 'm', 1],
    ['아티스트 태깅', 'ArtistTagModal.tsx', 'title="아티스트 태깅"', 'l', 1],
    ['환경설정 불러오기 미리보기', 'ConfigSyncSection.tsx', 'title={CONFIG_SYNC_TEXT.previewTitle}', 's', 1],
    ['템플릿 적용', 'TemplateInheritModals.tsx', 'title={`템플릿 적용', 's', 1],
    ['찾기 및 변환', 'FindReplaceDialog.tsx', 'title="찾기 및 변환"', 'l', 1],
    ['Google 드라이브 백업', 'DriveBackupManager.tsx', 'title={title}', 'm', 1],
  ];
  test.each(cases)('%s — %s 의 %s 여는 태그가 size="%s"', (_name, file, marker, size, n) => {
    const hits = tagWithTitle(file, marker);
    expect(hits).toHaveLength(n);
    for (const tag of hits) {
      expect(tag).toContain(`size="${size}"`);
      expect(tag).not.toMatch(/\swidth=/);
      expect(tag).not.toMatch(/\sfullscreen\b/);
    }
  });

  test('파일 전체가 옮겨진 곳은 size 없는 여는 태그가 남지 않는다(묶음 B·C 창이 남는 두 파일 제외)', () => {
    for (const file of [
      'SceneEditor.tsx',
      'ConfigSystemTab.tsx',
      'ArtistLibraryTab.tsx',
      'ArtistTagModal.tsx',
      'ConfigSyncSection.tsx',
      'FindReplaceDialog.tsx',
      'DriveBackupManager.tsx',
    ]) {
      for (const tag of modalOpenTags(readComponent(file))) expect(tag).toMatch(/\ssize=/);
    }
  });

  test('층(--z-modal-top)은 미리보기·드라이브 백업 두 창에서 그대로', () => {
    expect(tagWithTitle('ConfigSyncSection.tsx', 'previewTitle')[0]).toContain('zIndex="var(--z-modal-top)"');
    expect(tagWithTitle('DriveBackupManager.tsx', 'title={title}')[0]).toContain('zIndex="var(--z-modal-top)"');
  });

  test('작가 상세: 동작 줄(복사·이름 변경·즐겨찾기·삭제)이 도구줄(toolbar) 슬롯 안에 있고 본문에는 없다', () => {
    const tag = tagWithTitle('ArtistLibraryTab.tsx', 'title={artist.name}')[0];
    const toolbar = tag.slice(tag.indexOf('toolbar={'));
    expect(toolbar).toContain('data-artist-detail-actions');
    expect(toolbar).toContain("copyText('artist:' + artist.name");
    expect(toolbar).toContain('작가 이름 변경');
    expect(toolbar).toContain('즐겨찾기');
    expect(toolbar).toContain('작가 삭제');
    // 삭제 버튼 원색은 결함 묶음 4 범위라 그대로
    expect(toolbar).toContain('bg-red-500 text-white');
    const src = readComponent('ArtistLibraryTab.tsx');
    const afterTag = src.slice(src.indexOf(tag) + tag.length);
    const bodyEnd = afterTag.indexOf('</ModalOverlay>');
    expect(afterTag.slice(0, bodyEnd)).not.toContain('작가 삭제');
  });

  test('아티스트 태깅: 2열 그대로, PC 만 h-full min-h-0(모바일은 종전 한 열)', () => {
    const src = readComponent('ArtistTagModal.tsx');
    expect(src).toContain(
      "className={'flex flex-col-reverse md:flex-row gap-4' + (isMobile ? '' : ' h-full min-h-0')}",
    );
  });
});

describe('size="full" = 옛 fullscreen(캐릭터 위치 지정 ×2 이름만 바꿈)', () => {
  test.each([false, true])('모바일=%s: 클래스·data-modal-fullscreen 이 같다', async (mobile) => {
    mockEnv.mobile = mobile;
    await act(async () =>
      root.render(
        <ModalOverlay isOpen onClose={() => {}} title="t" fullscreen>
          <div />
        </ModalOverlay>,
      ),
    );
    const oldBox = backdrop().firstElementChild as HTMLElement;
    const oldClass = oldBox.className;
    expect(oldBox.hasAttribute('data-modal-fullscreen')).toBe(true);
    await act(async () =>
      root.render(
        <ModalOverlay isOpen onClose={() => {}} title="t" size="full">
          <div />
        </ModalOverlay>,
      ),
    );
    const newBox = backdrop().firstElementChild as HTMLElement;
    expect(newBox.className).toBe(oldClass);
    expect(newBox.hasAttribute('data-modal-fullscreen')).toBe(true);
  });
});

// 찾기 및 변환용 가짜 세션 — 이미지생성 씬 2개 + 변형 씬 1개
const makeFindSession = () => {
  const scene = (name: string, prompt: string) => ({
    name,
    slots: [[{ prompt, characterPrompts: [] as string[] }]],
    sceneCharacterPrompts: [] as any[],
  });
  return {
    name: 'P',
    scenes: new Map([
      ['가', scene('가', 'cat, dog')],
      ['나', scene('나', 'cat')],
    ]),
    inpaints: new Map([['변', { name: '변', slots: [], preset: {}, workflowType: 'SDInpaint' }]]),
    characterPresets: new Map(),
  };
};
const sceneCheckbox = (label: string) => {
  const row = Array.from(container.querySelectorAll('[data-find-scene-list] label')).find(
    (l) => l.textContent?.trim() === label,
  );
  return row?.querySelector('input') as HTMLInputElement;
};
const typeInto = async (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

describe('찾기 및 변환 — size l·aside 공용 씬 선택·바닥줄(재배치안 (가), 2026-11-14 A-3 일괄 삽입 분리 뒤 탭 없음)', () => {
  beforeEach(() => {
    mockAppState.curSession = makeFindSession();
  });
  afterEach(() => {
    mockAppState.curSession = null;
  });

  test('등급 l, 탭 없음(찾기만) — 일괄 삽입 폼·탭 알약이 남지 않는다', async () => {
    await act(async () => root.render(<FindReplaceDialog />));
    expect(frame()?.getAttribute('data-modal-size')).toBe('l');
    expect(container.querySelector('[data-find-replace-tabs]')).toBeNull();
    expect(container.querySelector('[role="tab"]')).toBeNull();
    expect(slot('body')!.querySelector('[data-find-panel="find"]')).not.toBeNull();
    expect(container.textContent).not.toContain('삽입할 텍스트');
  });

  test('PC: 씬 선택은 왼쪽 열(aside), 머리에 선택 n / 전체 m, 목록은 열 전체 높이(max-h 없음)', async () => {
    await act(async () => root.render(<FindReplaceDialog />));
    const aside = slot('aside')!;
    expect(slot('columns')!.contains(aside)).toBe(true);
    expect(aside.querySelector('[data-find-scene-select]')).not.toBeNull();
    expect(aside.querySelector('[data-find-scene-count]')!.textContent).toBe('선택 3 / 전체 3');
    const list = aside.querySelector<HTMLElement>('[data-find-scene-list]')!;
    expect(list.className).toContain('flex-1');
    expect(list.className).not.toMatch(/max-h-/);
    // 변형 씬 키 접두 규칙 유지 — 「[변형] 이름」 표시
    expect(sceneCheckbox('[변형] 변')).toBeTruthy();
    // 본문에는 씬 선택이 없다
    expect(slot('body')!.querySelector('[data-find-scene-select]')).toBeNull();
  });

  test('씬 종류 칩 「생성 2」「변형 1」 — 변형을 끄면 목록·선택에서 빠지고, 다시 켜면 돌아온다(찾기 = 처음 전체 선택)', async () => {
    await act(async () => root.render(<FindReplaceDialog />));
    const chip = (k: string) => container.querySelector<HTMLElement>(`[data-scene-kind-chip="${k}"]`)!;
    expect(chip('scene').textContent).toBe('생성 2');
    expect(chip('variant').textContent).toBe('변형 1');
    await act(async () => chip('variant').querySelector('input')!.click());
    expect(sceneCheckbox('[변형] 변')).toBeUndefined();
    expect(container.querySelector('[data-find-scene-count]')!.textContent).toBe('선택 2 / 전체 3');
    await act(async () => chip('variant').querySelector('input')!.click());
    expect(sceneCheckbox('[변형] 변').checked).toBe(true);
  });

  test('바닥줄: [모두 변환][닫기](결과 전 비활성), [닫기] = closeFindReplace', async () => {
    await act(async () => root.render(<FindReplaceDialog />));
    expect(buttonsIn(slot('footer'))).toEqual(['모두 변환', '닫기']);
    const [replaceAll, close] = Array.from(slot('footer')!.querySelectorAll('button'));
    expect(replaceAll.disabled).toBe(true);
    expect(replaceAll.className).toContain('btn-solid-orange');
    expect(close.className).toContain('btn-neutral');
    // 본문에는 확정 버튼이 남지 않는다
    expect(buttonsIn(slot('body'))).not.toContain('모두 변환');
    await act(async () => close.click());
    expect(mockAppState.closeFindReplace).toHaveBeenCalledTimes(1);
  });

  test('검색 → 결과 머리 「검색 결과 · n건」·결과 목록 max-h 없음·바닥 왼쪽 「n건 발견」·[모두 변환] = 확인 1회', async () => {
    mockAppState.confirmAsync.mockResolvedValue(false);
    await act(async () => root.render(<FindReplaceDialog />));
    const results = container.querySelector<HTMLElement>('[data-find-results]')!;
    expect(results.className).toContain('flex-1');
    expect(results.className).not.toMatch(/max-h-/);
    const search = slot('body')!.querySelector<HTMLInputElement>('input[placeholder="검색어 입력..."]')!;
    await typeInto(search, 'cat');
    const searchBtn = Array.from(slot('body')!.querySelectorAll('button')).find(
      (b) => b.textContent === '검색',
    ) as HTMLButtonElement;
    await act(async () => searchBtn.click());
    expect(container.querySelector('[data-find-results-head]')!.textContent).toBe('검색 결과 · 2건');
    expect(slot('footer')!.textContent).toContain('2건 발견');
    const [replaceAll] = Array.from(slot('footer')!.querySelectorAll('button'));
    expect(replaceAll.disabled).toBe(false);
    await act(async () => replaceAll.click());
    expect(mockAppState.confirmAsync).toHaveBeenCalledTimes(1);
  });

  test('모바일: 씬 선택은 본문 위에 쌓이고 목록 max-h-36·결과 max-h-48 유지', async () => {
    mockEnv.mobile = true;
    await act(async () => root.render(<FindReplaceDialog />));
    expect(slot('columns')).toBeNull();
    const aside = slot('aside')!;
    expect(slot('body')!.contains(aside)).toBe(true);
    expect(aside.querySelector<HTMLElement>('[data-find-scene-list]')!.className).toContain('max-h-36');
    expect(container.querySelector<HTMLElement>('[data-find-results]')!.className).toContain('max-h-48');
  });

  test('✕ 는 종전처럼 closeFindReplace', async () => {
    await act(async () => root.render(<FindReplaceDialog />));
    const x = container.querySelector<HTMLButtonElement>('button[aria-label="닫기"]')!;
    await act(async () => x.click());
    expect(mockAppState.closeFindReplace).toHaveBeenCalledTimes(1);
  });
});

describe('환경설정 불러오기 미리보기 — size s·바닥줄 [불러오기 (N)][취소]·--z-modal-top', () => {
  const makeReq = (changed: string[]) => ({
    id: 1,
    preview: {
      enabled: { generation: true },
      diff: [{ group: 'generation', changed }],
      parsed: { platform: 'win32', appVersion: '5.6.0', createdAt: '' },
    },
    resolve: jest.fn(),
    confirm: jest.fn(async () => true),
  });

  test('등급 s, 층 유지, 바닥줄 순서 [불러오기 (N)][취소], 본문에는 버튼 없음', async () => {
    mockPreview.req = makeReq(['steps', 'sampler']);
    await act(async () => root.render(<ConfigImportPreviewHost />));
    expect(frame()?.getAttribute('data-modal-size')).toBe('s');
    expect(backdrop().style.zIndex).toBe('var(--z-modal-top)');
    expect(buttonsIn(slot('footer'))).toEqual(['불러오기 (2)', '취소']);
    expect(buttonsIn(slot('body'))).toEqual([]);
  });

  test('[취소] = resolve(null), [불러오기] = confirm 뒤 resolve(선택)', async () => {
    const req = makeReq(['steps']);
    mockPreview.req = req;
    await act(async () => root.render(<ConfigImportPreviewHost />));
    const [apply, cancel] = Array.from(slot('footer')!.querySelectorAll('button'));
    await act(async () => cancel.click());
    expect(req.resolve).toHaveBeenCalledWith(null);
    req.resolve.mockClear();
    await act(async () => apply.click());
    expect(req.confirm).toHaveBeenCalledTimes(1);
    expect(req.resolve).toHaveBeenCalledWith({ generation: true });
  });

  test('바뀌는 항목이 없으면 [불러오기] 비활성', async () => {
    mockPreview.req = makeReq([]);
    await act(async () => root.render(<ConfigImportPreviewHost />));
    const [apply] = Array.from(slot('footer')!.querySelectorAll('button'));
    expect(apply.disabled).toBe(true);
  });
});

describe('템플릿 적용 — size s·바닥줄 [적용][취소]', () => {
  test('템플릿이 있으면 [적용][취소] 순서, [취소] = onClose, 고르기 전 [적용] 비활성', async () => {
    mockTemplates.globals = [{ id: 't1', name: '기본' }];
    mockTemplates.byId = { t1: { id: 't1', name: '기본', characterPresets: [] } };
    const onClose = jest.fn();
    await act(async () => root.render(<ReapplyTemplateModal target="P" isOpen onClose={onClose} />));
    expect(frame()?.getAttribute('data-modal-size')).toBe('s');
    expect(buttonsIn(slot('footer'))).toEqual(['적용', '취소']);
    const [apply, cancel] = Array.from(slot('footer')!.querySelectorAll('button'));
    expect(apply.disabled).toBe(true);
    await act(async () => cancel.click());
    expect(onClose).toHaveBeenCalledTimes(1);
    // 본문에는 확정 버튼이 남지 않는다
    expect(buttonsIn(slot('body'))).not.toContain('적용');
  });

  test('템플릿이 하나도 없으면 바닥줄은 [닫기] 하나', async () => {
    const onClose = jest.fn();
    await act(async () => root.render(<ReapplyTemplateModal target="P" isOpen onClose={onClose} />));
    expect(buttonsIn(slot('footer'))).toEqual(['닫기']);
    await act(async () => (slot('footer')!.querySelector('button') as HTMLButtonElement).click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
