// 오버레이 묶음 C-2(2026-11-15, SPEC 「오버레이 창 크기 체계」 높이 규칙 우선순위·슬롯 규약 ⑥ 보강) —
// 템플릿 관리·폴더 기본 템플릿 = size l(고정), 공용 편집기를 useTemplateWorkflowPanel 로 슬롯 분리
// (탭 = 도구줄, [저장]/[N개 생성] = 바닥줄, 일괄 생성 진행·[취소] = 바닥줄 왼쪽), 본문 key 재마운트·언마운트 커밋 유지,
// PC aside 템플릿 목록(모바일은 종전 <select>), 안쪽 목록 max-h 제거.
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import * as fs from 'fs';
import * as path from 'path';

const mockEnv = { mobile: false };

// ----- 템플릿 저장소 가짜 -----
const mockTemplates: any[] = [];
const mockTpl = {
  ensureLoaded: jest.fn(async () => {}),
  listGlobal: jest.fn(() => mockTemplates.filter((t) => !t.folderLocal)),
  get: jest.fn((id: string) => mockTemplates.find((t) => t.id === id)),
  getByName: jest.fn(() => undefined),
  create: jest.fn(async (name: string, opts?: any) => {
    const t = mkTpl('new-' + mockTemplates.length, name, opts?.folderLocal);
    mockTemplates.push(t);
    return t;
  }),
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
    preset: { frontPrompt: 'front-' + id, backPrompt: '', uc: '' },
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
    listSceneTemplates: jest.fn(() => []),
    getFolderTemplate: jest.fn(() => ({ templateId: 'fl' })),
    setFolderTemplate: jest.fn(async () => {}),
    hasApplications: jest.fn(() => false),
    listInheritedChildren: jest.fn(() => []),
  },
  globalPresetService: { loaded: true, presets: [], load: jest.fn() },
  globalCharacterPresetService: { loaded: true, list: () => [], load: jest.fn() },
  sessionService: {
    applyProjectTemplateToSession: jest.fn(),
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
  <textarea data-prompt-area="" value={props.value} onChange={(e) => props.onChange(e.target.value)} />
));
jest.mock('../../componenets/CharacterPresetInnerEditor', () => ({ CharacterPresetInnerEditor: () => null }));
jest.mock('../../componenets/CharacterPresetCards', () => ({ VibeImage: () => null }));
jest.mock('../../componenets/GlobalPresetPicker', () => ({ GlobalPresetPicker: () => null }));
jest.mock('../../componenets/VibeEditor', () => ({ EditableSliderValue: () => null }));
jest.mock('../../componenets/UtilComponents', () => ({ FileUploadBase64: () => null }));

// 일괄 생성 패널 가짜 — 컨트롤러를 바닥줄로 알리고, 테스트가 실행 중 상태를 바꿀 수 있다
const mockBatch = {
  state: { count: 3, canRun: true, running: false, progress: null as any, result: null as any },
  execute: jest.fn(),
  cancel: jest.fn(),
  setRunning: null as null | ((r: boolean) => void),
};
jest.mock('../../componenets/BatchCreateModal', () => {
  const R = require('react');
  return {
    BatchCreatePanel: (props: any) => {
      const [running, setRunning] = R.useState(mockBatch.state.running);
      mockBatch.setRunning = (r: boolean) => {
        setRunning(r);
        props.onRunningChange?.(r);
      };
      R.useEffect(() => {
        props.onControllerChange?.({
          ...mockBatch.state,
          running,
          canRun: mockBatch.state.canRun && !running,
          progress: running ? { done: 1, total: 3, current: 'x' } : null,
          execute: mockBatch.execute,
          cancel: mockBatch.cancel,
        });
      }, [running]);
      R.useEffect(() => () => props.onControllerChange?.(null), []);
      return R.createElement('div', { 'data-batch-panel': '' });
    },
  };
});

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
  mockTemplates.push(mkTpl('t1', '첫 템플릿'), mkTpl('t2', '둘째 템플릿'));
  mockBatch.state = { count: 3, canRun: true, running: false, progress: null, result: null };
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
const click = async (el: Element | null) => {
  expect(el).not.toBeNull();
  await act(async () => {
    (el as HTMLElement).click();
  });
};
const tabButton = (label: string) =>
  Array.from(container.querySelectorAll('[data-template-tabs] button')).find(
    (b) => b.textContent === label,
  ) as HTMLElement | undefined;

const renderManager = async (onClose = jest.fn()) => {
  await act(async () => root.render(<TemplateManagerModal isOpen onClose={onClose} />));
  return onClose;
};

describe('템플릿 관리 — size xl + 슬롯', () => {
  test('size xl(2026-11-15 실기 피드백 — 작업 밀도), PC aside 목록(선택 강조·[새 템플릿]), <select> 없음', async () => {
    await renderManager();
    expect(q('[data-modal-size]')?.getAttribute('data-modal-size')).toBe('xl');
    const aside = slot('aside')!;
    expect(aside.querySelector('[data-template-new]')).not.toBeNull();
    const rows = aside.querySelectorAll('[data-template-row]');
    expect(rows.length).toBe(2);
    expect(aside.querySelector('[data-template-row="t1"]')!.getAttribute('aria-selected')).toBe('true');
    expect(slot('toolbar')!.querySelector('select')).toBeNull();
    expect(q('[data-template-select-row]')).toBeNull();
    // 선택 행에만 행 동작
    expect(aside.querySelector('[data-template-row="t1"] [aria-label="삭제"]')).not.toBeNull();
    expect(aside.querySelector('[data-template-row="t2"] [aria-label="삭제"]')).toBeNull();
    await click(aside.querySelector('[data-template-row="t2"]'));
    expect(aside.querySelector('[data-template-row="t2"]')!.getAttribute('aria-selected')).toBe('true');
  });

  test('모바일: aside 대신 도구줄 첫 줄에 종전 <select>+CRUD', async () => {
    mockEnv.mobile = true;
    await renderManager();
    expect(slot('aside')).toBeNull();
    expect(slot('toolbar')!.querySelector('[data-template-select-row] select')).not.toBeNull();
    expect(slot('toolbar')!.querySelector('[data-template-tabs]')).not.toBeNull();
  });

  test('도구줄 = 탭 + [백업][백업 불러오기], 바닥줄 [저장] = 명시 저장(커밋 + flushSave)', async () => {
    await renderManager();
    const toolbar = slot('toolbar')!;
    expect(toolbar.querySelector('[data-template-tabs]')).not.toBeNull();
    expect(toolbar.querySelector('[data-template-backup]')!.textContent).toContain('백업 불러오기');
    // 본문에 탭·저장 버튼이 없다(슬롯으로 이동)
    expect(slot('body')!.querySelector('[data-template-tabs]')).toBeNull();
    const save = slot('footer')!.querySelector('[data-template-save]') as HTMLElement;
    expect(save.className).toContain('btn-solid-sky');
    // 프롬프트를 고친 뒤 [저장] → patchPreset + flushSave + 토스트
    const area = slot('body')!.querySelector('[data-prompt-area]') as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(area, 'edited');
      area.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(save);
    expect(mockTpl.patchPreset).toHaveBeenCalledWith('t1', expect.objectContaining({ frontPrompt: 'edited' }));
    expect(mockTpl.flushSave).toHaveBeenCalled();
    expect(mockAppState.pushMessage).toHaveBeenCalledWith(expect.stringContaining('저장되었습니다'));
  });

  test('일괄 생성 탭: 바닥줄 [N개 생성] → execute, 실행 중 footerStart [취소]·닫기 차단·목록 잠금', async () => {
    const onClose = await renderManager();
    await click(tabButton('일괄 생성')!);
    expect(slot('body')!.querySelector('[data-batch-panel]')).not.toBeNull();
    const run = slot('footer')!.querySelector('[data-batch-run]') as HTMLButtonElement;
    expect(run.textContent).toContain('3개 생성');
    expect(run.className).toContain('btn-solid-purple');
    expect(slot('footer')!.querySelector('[data-template-save]')).toBeNull();
    await click(run);
    expect(mockBatch.execute).toHaveBeenCalledTimes(1);

    await act(async () => mockBatch.setRunning!(true));
    expect(q('[data-batch-status="running"]')!.textContent).toContain('1/3');
    await click(q('[data-batch-cancel]'));
    expect(mockBatch.cancel).toHaveBeenCalledTimes(1);
    expect((slot('footer')!.querySelector('[data-batch-run]') as HTMLButtonElement).disabled).toBe(true);
    // 닫기 차단(✕)
    await click(container.querySelector('[aria-label="닫기"]'));
    expect(onClose).not.toHaveBeenCalled();
    expect(mockAppState.pushMessage).toHaveBeenCalledWith(expect.stringContaining('일괄 생성이 진행 중'));
    // 목록 잠금 — 다른 템플릿을 눌러도 바뀌지 않는다
    const aside = slot('aside')!.querySelector('[data-template-aside]')!;
    expect(aside.getAttribute('aria-disabled')).toBe('true');
    await click(slot('aside')!.querySelector('[data-template-row="t2"]'));
    expect(slot('aside')!.querySelector('[data-template-row="t1"]')!.getAttribute('aria-selected')).toBe('true');
    // 탭 전환도 막힌다
    await click(tabButton('템플릿')!);
    expect(slot('body')!.querySelector('[data-batch-panel]')).not.toBeNull();

    await act(async () => mockBatch.setRunning!(false));
    await click(container.querySelector('[aria-label="닫기"]'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('템플릿 전환 = 본문 재마운트 → 이전 템플릿 프롬프트 언마운트 커밋 + flushSave, 탭은 「템플릿」으로', async () => {
    await renderManager();
    const area = slot('body')!.querySelector('[data-prompt-area]') as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(area, 'typed-not-saved');
      area.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(mockTpl.patchPreset).not.toHaveBeenCalled();
    await click(tabButton('일괄 생성')!);
    await click(slot('aside')!.querySelector('[data-template-row="t2"]'));
    expect(mockTpl.patchPreset).toHaveBeenCalledWith('t1', expect.objectContaining({ frontPrompt: 'typed-not-saved' }));
    expect(mockTpl.flushSave).toHaveBeenCalled();
    // 새 템플릿은 템플릿 탭부터(일괄 생성 패널이 마운트되지 않음)
    expect(slot('body')!.querySelector('[data-batch-panel]')).toBeNull();
    expect((slot('body')!.querySelector('[data-prompt-area]') as HTMLTextAreaElement).value).toBe('front-t2');
    expect(slot('footer')!.querySelector('[data-template-save]')).not.toBeNull();
  });

  test('창 닫기(언마운트)도 프롬프트를 커밋한다', async () => {
    const onClose = jest.fn();
    await act(async () => root.render(<TemplateManagerModal isOpen onClose={onClose} />));
    const area = slot('body')!.querySelector('[data-prompt-area]') as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(area, 'close-commit');
      area.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => root.render(<TemplateManagerModal isOpen={false} onClose={onClose} />));
    expect(mockTpl.patchPreset).toHaveBeenCalledWith('t1', expect.objectContaining({ frontPrompt: 'close-commit' }));
  });

  test('템플릿 0개: 본문 안내만, 탭·바닥줄 없음, 창은 xl 그대로', async () => {
    mockTemplates.length = 0;
    await renderManager();
    expect(q('[data-modal-size]')?.getAttribute('data-modal-size')).toBe('xl');
    expect(slot('body')!.textContent).toContain('템플릿이 없습니다');
    expect(q('[data-template-tabs]')).toBeNull();
    expect(slot('footer')).toBeNull();
    expect(slot('aside')!.querySelector('[data-template-new]')).not.toBeNull();
  });
});

describe('폴더 기본 템플릿 — size l + 슬롯', () => {
  beforeEach(() => {
    mockTemplates.push(mkTpl('fl', '폴더 기본 (A)', true));
  });
  const renderFolder = async (onClose = jest.fn()) => {
    await act(async () => root.render(<FolderTemplateModal folder="A" isOpen onClose={onClose} />));
    return onClose;
  };

  test('size l, aside 없음, 도구줄 = 탭+[전역 템플릿에서 복사]+배지 색, 바닥줄 = [지정 해제] | [저장]', async () => {
    await renderFolder();
    expect(q('[data-modal-size]')?.getAttribute('data-modal-size')).toBe('l');
    expect(slot('aside')).toBeNull();
    const toolbar = slot('toolbar')!;
    expect(toolbar.querySelector('[data-template-tabs]')).not.toBeNull();
    expect(toolbar.querySelector('[data-folder-template-import]')).not.toBeNull();
    expect(toolbar.querySelector('[data-folder-template-badge]')).not.toBeNull();
    const footer = slot('footer')!;
    const clear = footer.querySelector('[data-folder-template-clear]') as HTMLElement;
    expect(clear.className).toContain('btn-solid-red');
    expect(footer.querySelector('[data-template-save]')).not.toBeNull();
    await click(clear);
    expect(mockAppState.pushDialog).toHaveBeenCalledTimes(1);
  });

  test('일괄 생성 실행 중: [지정 해제]·상단 조작 숨김, [취소] 표시, 닫기 차단', async () => {
    const onClose = await renderFolder();
    await click(tabButton('일괄 생성')!);
    await act(async () => mockBatch.setRunning!(true));
    expect(q('[data-folder-template-clear]')).toBeNull();
    expect(q('[data-folder-template-import]')).toBeNull();
    expect(q('[data-batch-cancel]')).not.toBeNull();
    await click(container.querySelector('[aria-label="닫기"]'));
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => mockBatch.setRunning!(false));
    await click(container.querySelector('[aria-label="닫기"]'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('소스 검사 — 안쪽 목록 높이 상한 제거', () => {
  const read = (name: string) =>
    fs.readFileSync(path.join(__dirname, '..', '..', 'componenets', name), 'utf8');
  test('TemplateManagerModal 씬 목록 max-h-60 없음, 두 창 width 없음', () => {
    const tm = read('TemplateManagerModal.tsx');
    expect(tm).not.toContain('max-h-60');
    expect(tm).not.toMatch(/width="max-w-/);
    expect(read('TemplateInheritModals.tsx')).not.toMatch(/width="max-w-/);
  });
  test('BatchCreateModal 목록 max-h-48·36·32·24 없음, 자체 실행 버튼 없음', () => {
    const src = read('BatchCreateModal.tsx');
    expect(src).not.toMatch(/max-h-(48|36|32|24)\b/);
    expect(src).not.toContain('btn-solid-purple');
  });
});
