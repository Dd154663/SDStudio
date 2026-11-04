// ConfigScreen 분리 리팩토링(guides 플랜 2026-11-01 S0) 전 특성 테스트 — 현재 동작을 그대로 고정한다.
// 탭 라벨·탭별 대표 문구·미저장 배지·「저장」 인자·즉시 저장 필드 유지를 확인한다. 탭 본문을 다른 파일로
// 옮겨도(C1~C7) 이 테스트는 그대로 통과해야 한다 — DOM 깊이·클래스 문자열에 기대지 않고 라벨·id·저장 인자만 본다.
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';

let mockMobile = false;

// 가짜 config 저장소 — getConfig/setConfig 는 깊은 복사로 주고받아 실제 파일처럼 동작한다.
const store: { config: Record<string, any> } = { config: {} };
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const backend = {
  getConfig: jest.fn(async () => clone(store.config)),
  setConfig: jest.fn(async (c: Record<string, any>) => {
    store.config = clone(c);
  }),
  getDataRoot: jest.fn(async () => '/data-root'),
  selectDir: jest.fn(async (): Promise<string | undefined> => undefined),
  checkWritable: jest.fn(async (_folder: string) => ({ ok: true as boolean, code: undefined as string | undefined })),
  listFilesWithStats: jest.fn(async () => []),
  getRuntimeDiag: jest.fn(async () => ({ cpus: 8, uvThreadpool: 8 })),
  openWebPage: jest.fn(),
  deleteDir: jest.fn(async () => {}),
};

const PROFILES = [
  { id: 'p1', name: '주 계정' },
  { id: 'p2', name: '보조 계정' },
];
const login = Object.assign(new EventTarget(), {
  loggedIn: true,
  activeProfileId: 'p1',
  boostWarningAccepted: false,
  listTokenProfiles: jest.fn(() => PROFILES.map((p) => ({ ...p }))),
  loadTokenProfiles: jest.fn(async () => {}),
  getBoostParticipantPreview: jest.fn(async () => ({ activeName: '주 계정', names: ['보조 계정'] })),
  accountSwitchBlockedReason: jest.fn((): string | undefined => undefined),
  loginWithToken: jest.fn(async () => {}),
  saveToken: jest.fn(async () => {}),
  activateTokenProfile: jest.fn(async () => 'valid'),
  renameTokenProfile: jest.fn(async () => {}),
  deleteTokenProfile: jest.fn(async () => {}),
  checkTokenProfileUsages: jest.fn(async () => []),
});
const queue = Object.assign(new EventTarget(), {
  taskLogs: [] as any[],
  isRunning: jest.fn(() => false),
  clearLogs: jest.fn(),
});
const localAI = Object.assign(new EventTarget(), {
  ready: false,
  downloading: false,
  download: jest.fn(),
  modelChanged: jest.fn(),
});
const session = { configChanged: jest.fn() };
// 「할당량 경고 하지 않음」은 실제 OpusUsageService(setQuiet = 최신 config 를 읽어 합쳐 즉시 저장)를 가짜 backend 로 쓴다.
const { OpusUsageService } = jest.requireActual('../OpusUsageService');
const usage = new OpusUsageService({ getOpusUsageStatus: async () => undefined, getConfig: backend.getConfig, setConfig: backend.setConfig });

jest.mock('..', () => ({
  get isMobile() {
    return mockMobile;
  },
  backend,
  loginService: login,
  taskQueueService: queue,
  localAIService: localAI,
  sessionService: session,
  opusUsageService: usage,
  imageService: { cache: { cache: new Map() }, refreshBatch: jest.fn(async () => {}), getImageDir: () => '/img' },
  appUpdateNoticeService: { checkForUpdate: jest.fn(), dismissVersion: jest.fn(), current: '0.0.0' },
}));

const dialogs: any[] = [];
const appState: Record<string, any> = {};
const resetAppState = () => {
  for (const k of Object.keys(appState)) delete appState[k];
  Object.assign(appState, {
    curSession: undefined,
    fullWordAutoComplete: false,
    saveLocationFallback: false,
    uiLayoutTemplate: 'classic',
    uiCompanionSlots: {},
    dialogs: [],
    pushMessage: jest.fn(),
    pushDialog: jest.fn((d: any) => {
      dialogs.push(d);
    }),
    pushDialogAsync: jest.fn(async () => undefined),
    // 부스트 켜기 경고 창: 「다시 보지 않음」을 체크하고 확인한 것으로 처리
    confirmAsync: jest.fn(async (opts: any) => {
      opts?.confirmCheck?.onChange(true);
      return true;
    }),
    recoverProjectImages: jest.fn(),
    incrementModalOverlay: jest.fn(),
    decrementModalOverlay: jest.fn(),
  });
};
resetAppState();
jest.mock('../AppService', () => ({ appState }));
jest.mock('@capacitor/app', () => ({ App: { addListener: jest.fn(), minimizeApp: jest.fn() } }));
// platform 은 window.electron 유무로 모듈 평가 때 고정된다 — 테스트별 PC/모바일 전환에 맞춰 필요한 값만 덮는다.
jest.mock('../platform', () => {
  const actual = jest.requireActual('../platform');
  const platform = new Proxy(actual.platform, {
    get(target: any, key: string) {
      if (key === 'isMobile') return mockMobile;
      if (key === 'isLinux') return false;
      if (key === 'supportsRemoveBg') return !mockMobile;
      if (key === 'maxImageConcurrency') return mockMobile ? 2 : 8;
      return target[key];
    },
  });
  return { ...actual, platform };
});
jest.mock('../MigrationService', () => ({ migrationService: { readDiagStatus: jest.fn(async () => null) } }));
jest.mock('../PersistenceService', () => ({ persistService: {} }));
jest.mock('../legacyCleanup', () => ({ scanLegacyRemnants: jest.fn(), deleteLegacyRemnants: jest.fn() }));
// 실제 단축키 서비스(localStorage 저장)를 쓰되, 모듈 평가 때 설치되는 전역 keydown 처리기는 뗀다.
jest.mock('../KeyboardShortcutService', () => {
  const actual = jest.requireActual('../KeyboardShortcutService');
  actual.keyboardShortcutService?.uninstall();
  return actual;
});
const driveProps: { current: any } = { current: undefined };
jest.mock('../../componenets/DriveSettingsTab', () => (props: any) => {
  driveProps.current = props;
  return (
    <div>
      <span>드라이브 탭(모킹)</span>
      <button onClick={() => props.setSyncFolder('/sync-folder')}>동기화 폴더 지정(모킹)</button>
    </div>
  );
});
// CompanionDnd 는 react-dnd(ESM)를 끌어와 jest 가 읽지 못한다 — ConfigScreen 이 쓰는 applyCompanionSlots 만
// 실제와 같은 본문(appState 반영 + 최신 config 병합 즉시 저장)으로 대신한다.
jest.mock('../../componenets/CompanionDnd', () => ({
  applyCompanionSlots: async (next: Record<string, string[]>) => {
    appState.uiCompanionSlots = next;
    const config = await backend.getConfig();
    await backend.setConfig({ ...config, uiCompanionSlots: next });
  },
}));
jest.mock('../../componenets/StorageDiagnostics', () => ({
  StorageDiagnosticsSection: () => <div>저장소 진단(모킹)</div>,
}));

import ConfigScreen from '../../componenets/ConfigScreen';
import { keyboardShortcutService } from '../KeyboardShortcutService';
import { normalizeV2Parts } from '../mobileV2';
import { withRequestDelaySettings } from '../requestTiming';

const INITIAL_CONFIG = {
  saveLocation: '/data',
  imageEditor: 'gimp',
  useCUDA: false,
  removeBgQuality: 'normal',
  refreshImage: false,
  autoConvertWebp: false,
  autoConvertWebpQuality: 80,
  whiteMode: false,
  useLocalBgRemoval: false,
  requestDelayMs: 2000,
  requestDelayJitterMs: 500,
  classicSceneCard: false,
  legacyProjectMode: false,
  legacySceneEditor: false,
  legacyWorkflowMode: false,
  sceneToolbarLegacyText: false,
  storageWriteGuard: true,
  exportConcurrency: 3,
  trueDark: false,
  uiTheme: {},
  uiToolbar: {},
  quickMenuButton: false,
  uiLayoutTemplate: 'classic',
  uiPresetIconRow: false,
  uiFloatViewMode: 'cover',
  uiFont: 'system',
  uiClassicFinish: false,
  uiPillButtons: false,
  allowDuplicateProjectOpen: false,
  multiTokenAutoRotate: false,
  multiTokenRotateWarningPercent: 10,
  multiTokenRotateTargetPercent: 25,
  multiTokenBalanceRotate: false,
  multiTokenRotateBalancePercent: 80,
  boostMode: 'off',
  boostAccountScope: 'free',
  boostVariantTasks: false,
  opusUsageQuiet: false,
  // 화면이 다루지 않는 키 — 저장 때 ...old 로 그대로 이어져야 한다
  uiLayoutSlots: { history: 'left' },
  genWidget: { x: 10 },
  uiCompanionSlots: { 'preset-row': ['vibe'] },
  modelVersion: 'v5',
  unrelatedKey: 'keep-me',
};

// 아무것도 바꾸지 않고 「저장」했을 때 setConfig 인자(현재 HEAD 동작 그대로).
const BASE_SAVE = {
  ...INITIAL_CONFIG,
  modelType: 'quality',
  ...withRequestDelaySettings({}, 2000, 500),
  requestDelayWarningDismissed: undefined,
  defaultExportFolder: undefined,
  syncFolder: undefined,
  uiThemePresets: undefined,
  quickMenu: undefined,
  uiMobileV2Parts: normalizeV2Parts(undefined),
};

// ConfigScreen 은 8개 탭을 늘 함께 렌더해 한 번 그리는 데 수백 ms 가 든다 — 전체 병렬 실행 중 기본 5초 제한에
// 걸리지 않도록 여유를 둔다(실제 소요는 케이스당 0.2~1.2초).
jest.setTimeout(20000);

const PC_TABS = ['로그인', '테마', '레이아웃', '저장경로', '드라이브', '시스템', '커스텀', '단축키'];
const MOBILE_TABS = ['로그인', '테마', '툴바', '레이아웃', '드라이브', '시스템', '커스텀', '복구'];
const DIRTY_BADGE = '저장 안 된 변경';

let root: Root;
let container: HTMLDivElement;
let onSave: jest.Mock;
let onClose: jest.Mock;

beforeAll(() => {
  (global as any).IS_REACT_ACT_ENVIRONMENT = true;
  (global as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
beforeEach(() => {
  jest.clearAllMocks();
  mockMobile = false;
  store.config = clone(INITIAL_CONFIG);
  dialogs.length = 0;
  driveProps.current = undefined;
  resetAppState();
  login.boostWarningAccepted = false;
  usage.quiet = false;
  usage.quietLoaded = false;
  localStorage.clear();
  keyboardShortcutService.resetToDefaults();
  onSave = jest.fn();
  onClose = jest.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
async function open(mobile = false) {
  mockMobile = mobile;
  await act(async () => root.render(<ConfigScreen onSave={onSave} onClose={onClose} />));
  await flush();
  await flush();
}
// 탭 본문 칸 — 모든 탭이 같은 grid 칸에 늘 마운트되고 visibility 로만 전환된다(부모 골격, 분리 후에도 불변).
const panels = () =>
  Array.from(container.querySelectorAll<HTMLElement>('div')).filter(
    (d) => d.style.gridRow === '1' && d.style.gridColumn === '1',
  );
const outsidePanels = (el: Element) => !panels().some((p) => p.contains(el));
const tabButtons = () =>
  Array.from(container.querySelectorAll('button')).filter(
    (b) => outsidePanels(b) && b.getAttribute('aria-label') !== '닫기' && b.textContent !== '저장',
  );
const tabLabels = () => tabButtons().map((b) => b.textContent);
const saveButton = () =>
  Array.from(container.querySelectorAll('button')).find((b) => outsidePanels(b) && b.textContent === '저장')!;
const dirty = () => (container.textContent ?? '').includes(DIRTY_BADGE);
async function selectTab(label: string) {
  const button = tabButtons().find((b) => b.textContent === label);
  if (!button) throw new Error(`탭 없음: ${label}`);
  await act(async () => button.click());
  const idx = tabLabels().indexOf(label);
  return panels()[idx];
}
const input = (id: string) => {
  const el = container.querySelector<HTMLInputElement>(`#${id}`);
  if (!el) throw new Error(`입력 없음: #${id}`);
  return el;
};
async function click(el: HTMLElement) {
  await act(async () => el.click());
  await flush();
}
const buttonByText = (scope: HTMLElement, text: string) => {
  const b = Array.from(scope.querySelectorAll('button')).find((x) => (x.textContent ?? '').trim() === text);
  if (!b) throw new Error(`버튼 없음: ${text}`);
  return b as HTMLButtonElement;
};
const radioByLabel = (scope: HTMLElement, text: string) => {
  const span = Array.from(scope.querySelectorAll('label span')).find((s) => s.textContent === text);
  const radio = span?.closest('label')?.querySelector<HTMLInputElement>('input[type="radio"]');
  if (!radio) throw new Error(`라디오 없음: ${text}`);
  return radio;
};
async function save() {
  const before = backend.setConfig.mock.calls.length;
  await click(saveButton());
  expect(backend.setConfig.mock.calls.length).toBe(before + 1);
  return backend.setConfig.mock.calls[backend.setConfig.mock.calls.length - 1][0];
}

// ─── 1. 탭 라벨 ───

test('1-PC: 탭 라벨 순서가 PC 8탭(저장경로·단축키 포함, 툴바·복구 없음)이다', async () => {
  await open(false);
  expect(tabLabels()).toEqual(PC_TABS);
  expect(panels()).toHaveLength(PC_TABS.length);
  expect(container.querySelector('h1')?.textContent).toBe('환경설정');
});

test('1-모바일: 탭 라벨 순서가 모바일 8탭(툴바·복구 포함, 저장경로·단축키 없음)이다', async () => {
  await open(true);
  expect(tabLabels()).toEqual(MOBILE_TABS);
  expect(panels()).toHaveLength(MOBILE_TABS.length);
});

// ─── 2. 탭별 대표 문구 · 마운트 방식 ───

const PC_TEXTS: Record<string, string[]> = {
  로그인: ['API 토큰으로 로그인', 'V5 할당량 기반 자동 순회', '부스트 모드 켜기'],
  테마: ['테마 템플릿', '내 프리셋'],
  레이아웃: ['화면 배치', '클래식 툴바 사용 (이전 배치로 되돌리기)', '퀵 메뉴 구성'],
  저장경로: ['현재 저장경로', '선호 이미지 편집기', '로컬 배경 제거 모델 설치'],
  드라이브: ['드라이브 탭(모킹)'],
  시스템: ['저장소 불안정 시 자동 저장 보호 (권장)', '작업 로그 보기', 'exports 폴더 정리'],
  커스텀: ['글꼴', '레거시 프로젝트 모드'],
  단축키: ['전역 (메인 화면)', '이미지 상세 창'],
};
const MOBILE_TEXTS: Record<string, string[]> = {
  로그인: ['API 토큰으로 로그인', '부스트 모드 켜기'],
  테마: ['테마 템플릿'],
  툴바: ['씬 툴바', '프로젝트 바', '퀵 메뉴 구성'],
  레이아웃: ['화면 배치', '동반 버튼', '모바일에서는 클래식과 모바일 V2 중에서 고를 수 있습니다'],
  // (툴바 탭의 ToolbarLayoutEditor 에도 「클래식 툴바 사용」 문구가 있어 PC 레이아웃 전용 문구로는 쓰지 않는다)
  드라이브: ['드라이브 탭(모킹)'],
  시스템: ['저장소 불안정 시 자동 저장 보호 (권장)', '새로 생성되는 이미지를 WebP로 자동 변환'],
  커스텀: ['글꼴', '레거시 프로젝트 모드'],
  복구: ['저장소 진단(모킹)', '현재 프로젝트 이미지 복구'],
};

test.each([
  ['PC', false, PC_TABS, PC_TEXTS],
  ['모바일', true, MOBILE_TABS, MOBILE_TEXTS],
] as const)('2-%s: 모든 탭이 늘 마운트되고, 탭을 누르면 그 칸만 보이며 대표 문구가 그 탭 칸에 있다', async (_name, mobile, labels, texts) => {
  await open(mobile);
  // 첫 화면: 모든 탭 본문이 이미 렌더돼 있다(visibility 전환 방식)
  panels().forEach((p, i) => expect(p.style.visibility).toBe(i === 0 ? 'visible' : 'hidden'));
  for (const label of labels) {
    const panel = await selectTab(label);
    const idx = labels.indexOf(label);
    panels().forEach((p, i) => expect(p.style.visibility).toBe(i === idx ? 'visible' : 'hidden'));
    for (const text of texts[label]) expect(panel.textContent).toContain(text);
  }
  // 플랫폼 전용 문구는 다른 플랫폼에 없다
  if (mobile) {
    expect(container.textContent).not.toContain('현재 저장경로');
    expect(container.textContent).not.toContain('전역 (메인 화면)');
    expect(container.textContent).not.toContain('이미지 상세 창');
  } else {
    expect(container.textContent).not.toContain('저장소 진단(모킹)');
    expect(container.textContent).not.toContain('프로젝트 바');
    expect(container.textContent).not.toContain('동반 버튼');
  }
});

// ─── 3. 불러온 직후 미저장 배지 없음 · 변경 없이 저장 ───

test.each([['PC', false], ['모바일', true]] as const)('3-%s: 불러온 직후 미저장 배지가 없고, 그대로 저장하면 기준 인자로 저장된다', async (_n, mobile) => {
  await open(mobile);
  expect(backend.getConfig).toHaveBeenCalled();
  expect(dirty()).toBe(false);
  expect(driveProps.current.dirty).toBe(false);
  const arg = await save();
  expect(arg).toEqual(BASE_SAVE);
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(session.configChanged).toHaveBeenCalledTimes(1);
  expect(localAI.modelChanged).not.toHaveBeenCalled();
  expect(dirty()).toBe(false);
});

// ─── 4. 탭별 필드 1개 변경 → 배지 → 저장 인자 ───

type Case = {
  tab: string;
  change: (panel: HTMLElement) => Promise<void>;
  expected: Record<string, unknown>;
  after?: () => void;
};
const PC_CASES: [string, Case][] = [
  ['로그인 — 자동 순회', { tab: '로그인', change: () => click(input('cfgMultiTokenAutoRotate')), expected: { multiTokenAutoRotate: true } }],
  [
    '로그인 — 부스트(경고 창 생략: 다시 보지 않음 저장됨)',
    {
      tab: '로그인',
      change: async () => {
        store.config.boostWarningDismissed = true;
        await click(input('cfgBoostMode'));
        expect(appState.confirmAsync).not.toHaveBeenCalled();
      },
      expected: { boostMode: 'split', boostWarningDismissed: true },
    },
  ],
  [
    '테마 — 화이트 모드',
    { tab: '테마', change: (p) => click(radioByLabel(p, '화이트 모드')), expected: { whiteMode: true, trueDark: false } },
  ],
  [
    '레이아웃 — 하단 아이콘 행',
    {
      tab: '레이아웃',
      change: () => click(input('cfgPresetIconRow')),
      expected: { uiPresetIconRow: true },
      after: () => expect(appState.uiPresetIconRow).toBe(true),
    },
  ],
  [
    '레이아웃 — 클래식 툴바',
    { tab: '레이아웃', change: () => click(input('cfgClassicToolbar')), expected: { uiToolbar: { classic: true } } },
  ],
  ['저장경로 — 폴더 직접 편집 감지', { tab: '저장경로', change: () => click(input('cfgRefresh')), expected: { refreshImage: true } }],
  [
    '저장경로 — 이미지 편집기',
    {
      tab: '저장경로',
      change: async (p) => {
        const select = Array.from(p.querySelectorAll('select')).find((s) => s.querySelector('option[value="mspaint"]'))!;
        await act(async () => {
          select.value = 'mspaint';
          select.dispatchEvent(new Event('change', { bubbles: true }));
        });
      },
      expected: { imageEditor: 'mspaint' },
    },
  ],
  [
    '드라이브 — 동기화 폴더(부모 상태)',
    {
      tab: '드라이브',
      change: (p) => click(buttonByText(p, '동기화 폴더 지정(모킹)')),
      expected: { syncFolder: '/sync-folder' },
      after: () => expect(driveProps.current.dirty).toBe(false),
    },
  ],
  [
    '시스템 — 저장 보호 끄기',
    {
      tab: '시스템',
      change: () => click(input('cfgStorageGuard')),
      expected: { storageWriteGuard: false },
      after: () => expect(appState.storageWriteGuard).toBe(false),
    },
  ],
  [
    '커스텀 — 레거시 프로젝트 모드',
    {
      tab: '커스텀',
      change: () => click(input('cfgLegacyProject')),
      expected: { legacyProjectMode: true },
      after: () => expect(appState.legacyProjectMode).toBe(true),
    },
  ],
  [
    '커스텀 — 단어 자동완성(config 밖, appState+localStorage)',
    {
      tab: '커스텀',
      change: () => click(input('cfgFullWordAc')),
      expected: {},
      after: () => {
        expect(appState.fullWordAutoComplete).toBe(true);
        expect(localStorage.getItem('sdstudio-full-word-autocomplete')).toBe('true');
      },
    },
  ],
];

test.each(PC_CASES)('4-PC %s: 바꾸면 배지가 뜨고 저장 인자에 바뀐 값과 나머지 값이 그대로 담긴다', async (_n, c) => {
  await open(false);
  const panel = await selectTab(c.tab);
  await c.change(panel);
  expect(dirty()).toBe(true);
  if (c.tab === '드라이브') expect(driveProps.current.dirty).toBe(true);
  const arg = await save();
  expect(arg).toEqual({ ...BASE_SAVE, ...c.expected });
  expect(store.config).toEqual(JSON.parse(JSON.stringify({ ...BASE_SAVE, ...c.expected })));
  expect(onSave).toHaveBeenCalledTimes(1);
  // 저장 뒤 savedCfg 가 갱신돼 배지가 사라진다
  expect(dirty()).toBe(false);
  c.after?.();
});

test('4-PC 단축키: 바인딩 변경은 즉시 localStorage 저장 — 미저장 배지·config 저장 인자와 무관', async () => {
  await open(false);
  const panel = await selectTab('단축키');
  const first = keyboardShortcutService.getAllActions()[0];
  const row = Array.from(panel.querySelectorAll('div')).find(
    (d) => d.querySelector('span')?.textContent === first.label && d.querySelector('button'),
  )!;
  await click(buttonByText(row, '변경'));
  expect(panel.textContent).toContain('입력 대기...');
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F7', bubbles: true }));
  });
  expect(keyboardShortcutService.getAllActions()[0].currentKey).toBe('F7');
  expect(JSON.parse(localStorage.getItem('sdstudio-key-bindings') ?? '{}')[first.id]).toBe('F7');
  expect(dirty()).toBe(false);
  expect(backend.setConfig).not.toHaveBeenCalled();
  expect(await save()).toEqual(BASE_SAVE);
});

const MOBILE_CASES: [string, Case][] = [
  [
    '시스템 — WebP 자동 변환(모바일만 시스템 탭)',
    { tab: '시스템', change: () => click(input('cfgAutoWebpM')), expected: { autoConvertWebp: true } },
  ],
  [
    '툴바 — 퀵 메뉴 플로팅 버튼',
    {
      tab: '툴바',
      change: () => click(input('cfgQuickMenuButton')),
      expected: { quickMenuButton: true },
      after: () => expect(appState.quickMenuButton).toBe(true),
    },
  ],
  ['레이아웃 — 하단 아이콘 행', { tab: '레이아웃', change: () => click(input('cfgPresetIconRow')), expected: { uiPresetIconRow: true } }],
  ['로그인 — 자동 순회', { tab: '로그인', change: () => click(input('cfgMultiTokenAutoRotate')), expected: { multiTokenAutoRotate: true } }],
];

test.each(MOBILE_CASES)('4-모바일 %s: 배지 → 저장 인자', async (_n, c) => {
  await open(true);
  const panel = await selectTab(c.tab);
  await c.change(panel);
  expect(dirty()).toBe(true);
  expect(await save()).toEqual({ ...BASE_SAVE, ...c.expected });
  expect(dirty()).toBe(false);
  c.after?.();
});

// ─── 5. 즉시 저장 필드는 「저장」이 덮어쓰지 않는다 ───

test('5: 할당량 경고 하지 않음·부스트 다시 보지 않음·레이아웃 배치 초기화·저장 위치는 즉시 저장되고, 이어서 다른 값을 저장해도 유지된다', async () => {
  backend.selectDir.mockResolvedValueOnce('/new-data');
  await open(false);

  // ① Opus 「할당량 경고 하지 않음」(로그인 탭) — 즉시 저장, 미저장 배지 없음
  await selectTab('로그인');
  const quiet = input('cfgOpusUsageQuiet');
  expect(quiet.disabled).toBe(false);
  await click(quiet);
  expect(store.config.opusUsageQuiet).toBe(true);
  expect(dirty()).toBe(false);

  // ② 부스트 켜기 → 경고 창(확인 클릭 필수, 「다시 보지 않음」 체크) → boostWarningDismissed 즉시 저장
  await click(input('cfgBoostMode'));
  expect(appState.confirmAsync).toHaveBeenCalledTimes(1);
  expect(appState.confirmAsync.mock.calls[0][0]).toMatchObject({ danger: true, requireClick: true });
  expect(login.boostWarningAccepted).toBe(true);
  expect(store.config.boostWarningDismissed).toBe(true);
  expect(store.config.boostMode).toBe('off'); // 부스트 모드 자체는 「저장」 때
  expect(dirty()).toBe(true);

  // ③ 레이아웃 배치 초기화(확인 창 → 즉시 저장)
  const layout = await selectTab('레이아웃');
  await click(buttonByText(layout, '레이아웃 배치 초기화'));
  expect(dialogs).toHaveLength(1);
  await act(async () => {
    await dialogs[0].callback();
  });
  expect(store.config.uiLayoutSlots).toEqual({});
  expect(store.config.genWidget).toEqual({});
  expect(store.config.uiCompanionSlots).toEqual({}); // 클래식 템플릿 = 배정 없음
  expect(appState.uiLayoutSlots).toEqual({});

  // ④ 저장 위치 변경(저장경로 탭) — 즉시 저장, 미저장 비교 대상 아님
  //    (2026-11-04: 하위 폴더 포함 쓰기 검사 → 선택 창 「나중에 재시작」 → 저장+보류 상태)
  const storage = await selectTab('저장경로');
  appState.pushDialogAsync.mockImplementationOnce(async () => 'restart-later');
  await click(buttonByText(storage, '이미지 및 데이터 저장 위치 변경'));
  expect(backend.checkWritable).toHaveBeenCalledWith('/new-data', { dataSubdirs: true });
  expect(store.config.saveLocation).toBe('/new-data');
  expect(appState.saveLocationPending).toEqual({ previousRoot: '/data-root', nextRoot: '/new-data' });
  // 표시 루트는 실제 루트 그대로(새 경로로 바꾸지 않는다)
  expect(storage.textContent).toContain('/data-root');

  // ⑤ 다른 탭 값을 바꿔 「저장」 — 즉시 저장 값이 모두 유지된다
  await selectTab('시스템');
  await click(input('cfgStorageGuard'));
  const instantWrites = backend.setConfig.mock.calls.length;
  expect(instantWrites).toBe(4);
  const arg = await save();
  expect(arg).toEqual({
    ...BASE_SAVE,
    opusUsageQuiet: true,
    boostWarningDismissed: true,
    boostMode: 'split',
    uiLayoutSlots: {},
    genWidget: {},
    uiCompanionSlots: {},
    saveLocation: '/new-data',
    storageWriteGuard: false,
  });
  expect(dirty()).toBe(false);
});

test('5-부스트: 경고 창에서 취소하면 켜지지 않고 아무것도 저장하지 않는다', async () => {
  appState.confirmAsync.mockImplementationOnce(async () => false);
  await open(false);
  await selectTab('로그인');
  await click(input('cfgBoostMode'));
  expect(input('cfgBoostMode').checked).toBe(false);
  expect(backend.setConfig).not.toHaveBeenCalled();
  expect(dirty()).toBe(false);
  expect(login.boostWarningAccepted).toBe(false);
});
