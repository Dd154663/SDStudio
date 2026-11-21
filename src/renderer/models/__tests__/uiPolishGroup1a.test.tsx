// UI 정돈 그룹 1-a(2026-11-20) — 환경설정 남은 탭(시스템·테마·저장 경로·로그인·드라이브·모바일 툴바)에 시범 부품 확대.
// ① 스위치 줄(SettingSwitchRow — 즉시 저장 자리 전용): role="switch" 체크 상자·id 유지, 글자 왼쪽·스위치 오른쪽, 엔터·비활성
// ② 스위치 CSS(목업 값·토큰·움직임 줄이기) ③ 시스템 탭 묶음(렌더, PC·모바일) ④ 모바일 툴바 편집기 묶음·체크 줄·선택 칸(렌더)
// ⑤ 할당량 경고 토글 = 스위치(렌더) ⑥ 테마·저장 경로·로그인·드라이브 탭 묶음 구성과 남은 기본 체크·선택 칸(소스 검사).
import React, { act, useState } from 'react';
import { createRoot, Root } from 'react-dom/client';
import * as fs from 'fs';
import * as path from 'path';

let mockMobile = false;
const mockUsage: Record<string, any> = {
  quiet: false,
  quietLoaded: true,
  setQuiet: jest.fn(async () => {}),
  loadQuiet: jest.fn(async () => {}),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
};
jest.mock('../BackStackService', () => ({ useBackLayer: () => {}, backStackService: { push: () => ({ remove: () => {} }) } }));
jest.mock('../index', () => ({
  get isMobile() {
    return mockMobile;
  },
  taskQueueService: { taskLogs: [] },
  appUpdateNoticeService: {},
  backend: { getRuntimeDiag: jest.fn(async () => ({ cpus: 8, uvThreadpool: 8 })) },
  sessionService: {},
  opusUsageService: mockUsage,
}));
const mockAppState: any = { pushMessage: jest.fn(), pushDialog: jest.fn() };
jest.mock('../AppService', () => ({ appState: mockAppState }));
jest.mock('../platform', () => ({ platform: { maxImageConcurrency: 4 } }));
jest.mock('../TaskQueueService', () => ({}));
jest.mock('../MigrationService', () => ({
  migrationService: { readDiagStatus: jest.fn(async () => ({ layout: 'workspace', marker: null, ledger: null })) },
}));
jest.mock('../PersistenceService', () => ({ persistService: {} }));
jest.mock('../legacyCleanup', () => ({ scanLegacyRemnants: jest.fn(), deleteLegacyRemnants: jest.fn() }));
jest.mock('../exampleVibeCleanupRuntime', () => ({ scanExampleVibesNow: jest.fn(), deleteExampleVibesNow: jest.fn() }));

import { SettingSwitchRow } from '../../componenets/SettingControls';
import SystemTab from '../../componenets/ConfigSystemTab';
import ToolbarLayoutEditor from '../../componenets/ToolbarLayoutEditor';
import OpusUsageQuietToggle from '../../componenets/OpusUsageQuietToggle';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const COMP = path.resolve(__dirname, '../../componenets');
const read = (f: string) => fs.readFileSync(path.join(COMP, f), 'utf8').replace(/\r\n/g, '\n');

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  mockMobile = false;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const render = (el: React.ReactElement) => act(async () => root.render(el));

const groupsOf = () =>
  Array.from(container.querySelectorAll<HTMLElement>('[data-setting-group]')).map((g) => ({
    title: g.getAttribute('data-setting-group'),
    ids: Array.from(g.querySelectorAll('input[type="checkbox"], select')).map((i) => i.id),
  }));

describe('① 스위치 줄', () => {
  const Harness = ({ disabled, onSpy }: { disabled?: boolean; onSpy?: (v: boolean) => void }) => {
    const [on, setOn] = useState(false);
    return (
      <SettingSwitchRow
        id="cfgTestSwitch"
        checked={on}
        onChange={(v) => {
          onSpy?.(v);
          setOn(v);
        }}
        disabled={disabled}
        label="시험 스위치"
        description="바로 저장됩니다"
      />
    );
  };
  test('input 은 role="switch" 체크 상자(id·checked 유지), 글자가 앞·스위치가 뒤, 글자를 눌러도 바뀐다', async () => {
    await render(<Harness />);
    const sw = container.querySelector<HTMLInputElement>('#cfgTestSwitch')!;
    expect(sw.type).toBe('checkbox');
    expect(sw.getAttribute('role')).toBe('switch');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(sw.className).toContain('setting-switch');
    const row = sw.closest('label')!;
    expect(row.className).toContain('setting-switch-row');
    expect(row.lastElementChild).toBe(sw); // 스위치가 오른쪽 끝
    const title = Array.from(row.querySelectorAll('span')).find((s) => s.textContent === '시험 스위치')!;
    await act(async () => title.click());
    expect(sw.checked).toBe(true);
    expect(sw.getAttribute('aria-checked')).toBe('true');
  });
  test('엔터 키로도 바뀌고, 비활성이면 누름·엔터 모두 무시', async () => {
    const spy = jest.fn();
    await render(<Harness onSpy={spy} />);
    const sw = container.querySelector<HTMLInputElement>('#cfgTestSwitch')!;
    await act(async () => {
      sw.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(spy).toHaveBeenLastCalledWith(true);
    expect(sw.checked).toBe(true);

    await act(async () => root.unmount());
    root = createRoot(container);
    const spy2 = jest.fn();
    await render(<Harness disabled onSpy={spy2} />);
    const off = container.querySelector<HTMLInputElement>('#cfgTestSwitch')!;
    expect(off.disabled).toBe(true);
    expect(off.closest('label')!.hasAttribute('data-disabled')).toBe(true);
    await act(async () => off.closest('label')!.click());
    await act(async () => {
      off.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(spy2).not.toHaveBeenCalled();
    expect(off.checked).toBe(false);
  });
});

describe('② 스위치 CSS', () => {
  const css = read('App.css');
  const block = (sel: string) => {
    const i = css.indexOf(sel + ' {');
    expect(i).toBeGreaterThan(-1);
    return css.slice(i, css.indexOf('}', i));
  };
  test('트랙 36×20 알약(꺼짐 --c-line-strong·켜짐 --c-focus-ring), 손잡이 16px·2px·켜지면 16px 이동(140ms)', () => {
    const track = block('.setting-switch');
    expect(track).toMatch(/width: 36px;/);
    expect(track).toMatch(/height: 20px;/);
    expect(track).toMatch(/background-color: var\(--c-line-strong\);/);
    expect(block('.setting-switch:checked')).toMatch(/background-color: var\(--c-focus-ring\);/);
    const knob = block('.setting-switch::after');
    expect(knob).toMatch(/left: 2px;/);
    expect(knob).toMatch(/width: 16px;/);
    expect(knob).toMatch(/background-color: var\(--c-surface\);/);
    expect(knob).toMatch(/transform 140ms ease-out/);
    expect(css).toMatch(/:is\(\.dark\) \.setting-switch::after \{\s*background-color: var\(--c-text-muted\);/);
    expect(css).toMatch(/\.setting-switch:checked::after,\s*:is\(\.dark\) \.setting-switch:checked::after \{\s*background-color: var\(--c-surface\);\s*transform: translateX\(16px\);/);
    expect(block('.setting-switch:focus-visible')).toMatch(/outline: 2px solid var\(--c-focus-ring\);/);
    expect(block('.setting-switch:disabled')).toMatch(/opacity: 0\.5;/);
  });
  test('움직임 줄이기 블록에서 스위치 전환도 끈다', () => {
    const tail = css.slice(css.indexOf('@keyframes ui-pop-in'));
    const reduced = tail.slice(tail.indexOf('@media (prefers-reduced-motion: reduce)'));
    for (const sel of ['.setting-switch-row', '.setting-switch,', '.setting-switch::after']) {
      expect(reduced.slice(0, reduced.indexOf('transition: none'))).toContain(sel);
    }
  });
});

describe('③ 시스템 탭 묶음', () => {
  const noop = () => {};
  const props = {
    requestDelayMs: 0, setRequestDelayMs: noop, requestDelayJitterMs: 0, setRequestDelayJitterMs: noop,
    storageWriteGuard: true, setStorageWriteGuard: noop,
    exportConcurrency: 2, setExportConcurrency: noop,
    autoConvertWebp: true, setAutoConvertWebp: noop, autoWebpQuality: 80, setAutoWebpQuality: noop,
  };
  const PC = ['저장 보호', '생성 간격', '이미지 최적화', '폴더 정리', '작업 로그', '저장소 구조', '예제 프리셋 잔존 이미지 정리', '업데이트와 정보'];
  test('PC: 붙어 있는 구획만 합친 8묶음, 체크 줄 id 유지, 제목은 한 번씩', async () => {
    await render(<SystemTab {...props} />);
    const groups = groupsOf();
    expect(groups.map((g) => g.title)).toEqual(PC);
    expect(groups[0].ids).toEqual(['cfgStorageGuard']);
    expect(container.querySelector('#cfgStorageGuard')!.closest('label')!.className).toContain('setting-check-row');
    // 폴더 정리 = exports·tmp 소제목 둘, 업데이트와 정보 = 업데이트·정보 소제목 둘
    const folder = container.querySelector('[data-setting-group="폴더 정리"]')!;
    expect(folder.textContent).toContain('exports 폴더 정리');
    expect(folder.textContent).toContain('tmp 폴더 정리');
    const info = container.querySelector('[data-setting-group="업데이트와 정보"]')!;
    expect(info.querySelectorAll('a.btn-link').length).toBe(2);
    // 저장소 구조·예제 정리 제목은 묶음 제목 한 번만
    expect(container.textContent!.match(/저장소 구조/g)).toHaveLength(1);
    expect(container.textContent!.match(/예제 프리셋 잔존 이미지 정리/g)).toHaveLength(1);
    // 구분선 없음, 탭 뿌리의 직계 자식은 모두 묶음(또는 묶음 하나를 감싼 감싸개) — PC 2단 흐름 단위
    expect(container.querySelector('hr')).toBeNull();
    const rootEl = container.firstElementChild!;
    for (const c of Array.from(rootEl.children)) {
      const isGroup = c.hasAttribute('data-setting-group') || c.querySelectorAll(':scope > [data-setting-group]').length === 1;
      expect(isGroup).toBe(true);
    }
  });
  test('모바일: 이미지 최적화 뒤 「WebP 자동 변환」 묶음(체크 줄 + 품질 칸)', async () => {
    mockMobile = true;
    await render(<SystemTab {...props} />);
    const titles = groupsOf().map((g) => g.title);
    expect(titles).toEqual([...PC.slice(0, 3), 'WebP 자동 변환', ...PC.slice(3)]);
    const webp = container.querySelector('[data-setting-group="WebP 자동 변환"]')!;
    expect(webp.querySelector('#cfgAutoWebpM')!.closest('label')!.className).toContain('setting-check-row');
    expect(webp.querySelector('#cfgAutoWebpQM')).not.toBeNull();
  });
});

describe('④ 모바일 툴바 편집기', () => {
  const registry: any[] = [
    { id: 'a', name: '버튼 A', tier: 'primary' },
    { id: 'b', name: '버튼 B', tier: 'menu' },
  ];
  test('툴바 / 씬 툴바 / 프로젝트 바 — 클래식 체크 줄(id cfgClassicToolbar)·배치 선택 칸 app-select, 초기화 버튼은 묶음 밖', async () => {
    const onChange = jest.fn();
    await render(
      <ToolbarLayoutEditor
        value={{}}
        onChange={onChange}
        groups={[
          { title: '씬 툴바', area: 'scene', registry },
          { title: '프로젝트 바', area: 'project', registry: [{ id: 'c', name: '버튼 C', tier: 'primary' }] as any },
        ]}
        mobileMode
      />,
    );
    expect(groupsOf().map((g) => g.title)).toEqual(['툴바', '씬 툴바', '프로젝트 바']);
    const classic = container.querySelector<HTMLInputElement>('#cfgClassicToolbar')!;
    expect(classic.className).toContain('setting-check');
    expect(classic.closest('label')!.className).toContain('setting-check-row');
    const selects = container.querySelectorAll<HTMLSelectElement>('select');
    expect(selects.length).toBe(3);
    selects.forEach((s) => {
      expect(s.className).toContain('app-select');
      expect(s.className).not.toContain('gray-input');
    });
    const reset = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === '버튼 배치 초기화')!;
    expect(reset.closest('[data-setting-group]')).toBeNull();
    await act(async () => classic.click());
    expect(onChange).toHaveBeenLastCalledWith({ classic: true });
  });
});

describe('⑤ 할당량 경고 토글 = 스위치(즉시 저장)', () => {
  test('id 그대로 role="switch", 누르면 setQuiet', async () => {
    mockUsage.setQuiet.mockClear();
    await render(<OpusUsageQuietToggle id="cfgOpusUsageQuiet" />);
    const sw = container.querySelector<HTMLInputElement>('#cfgOpusUsageQuiet')!;
    expect(sw.getAttribute('role')).toBe('switch');
    expect(sw.closest('label')!.className).toContain('setting-switch-row');
    await act(async () => sw.click());
    expect(mockUsage.setQuiet).toHaveBeenCalledWith(true);
  });
});

describe('⑥ 탭별 묶음 구성(소스 검사)', () => {
  const titles = (src: string) =>
    Array.from(src.matchAll(/<SettingGroup(?:\s+key=\{[^}]*\})?\s+title=(?:"([^"]+)"|\{([^}]+)\})/g)).map((m) => m[1] ?? m[2]);
  // JSX 의 기본 체크 상자(시범 부품 밖) — 주석 속 글자는 빼고 센다
  const rawCheckboxes = (src: string) => (src.match(/<input[^>]*type="checkbox"/g) ?? []).length;

  test('테마 탭: 기본 테마 / 테마 템플릿 / 내 프리셋 / 테마 / 버튼 색 — 버튼 색 통합은 체크 줄, ✕ 글자 대신 아이콘, 격자 규칙 유지', () => {
    const src = read('ConfigThemeTab.tsx');
    expect(titles(src)).toEqual(['기본 테마', '테마 템플릿', '내 프리셋', '테마', '버튼 색']);
    expect(src).toMatch(/<SettingCheckRow\s+id="cfgUnifyButtons"/);
    expect(rawCheckboxes(src)).toBe(0);
    expect(src).not.toMatch(/>\s*✕\s*</);
    expect(src).toContain('<FaTimes size={12}');
    expect(src).toContain('data-theme-template-grid=""');
    expect(src).not.toMatch(/<hr /);
  });

  test('저장 경로 탭: 9묶음, 체크 줄 4·스위치 3, 선택 칸 app-select, 보류 안내는 한 번만', () => {
    const storage = read('ConfigStorageTab.tsx');
    const dl = read('DownloadSettingsSection.tsx');
    const storageTab = storage.slice(storage.indexOf('const StorageTab'), storage.indexOf('const StorageImageTab'));
    const imageTab = storage.slice(storage.indexOf('const ImageEditTab'), storage.indexOf('const SaveLocationPendingNotice'));
    expect([...titles(storageTab.slice(0, storageTab.indexOf('<DownloadSettingsSection'))), ...titles(dl), ...titles(storageTab.slice(storageTab.indexOf('<DownloadSettingsSection'))), ...titles(imageTab)]).toEqual([
      '현재 저장경로', '기본 내보내기 폴더', '이미지 다운로드', '이미지 캐시', '외부 편집 반영', 'WebP 자동 변환',
      '이미지 복구 (실험적 기능)', '선호 이미지 편집기', '배경 제거',
    ]);
    for (const id of ['cfgLocalBg', 'cfgGpu', 'cfgRefresh', 'cfgAutoWebp']) {
      expect(storage).toMatch(new RegExp(`<SettingCheckRow\\s+id="${id}"`));
    }
    for (const id of ['cfgDlTimestamp', 'cfgDlAutoNumber', 'cfgDlOverwrite']) {
      expect(dl).toMatch(new RegExp(`<SettingSwitchRow\\s+id="${id}"`));
    }
    expect(dl).toMatch(/id="cfgDlOverwrite"[\s\S]*?disabled=\{!!settings\.autoNumbering\}/);
    expect(rawCheckboxes(storage) + rawCheckboxes(dl)).toBe(0);
    const selects = imageTab.match(/<select[^>]*>/g) ?? [];
    expect(selects).toHaveLength(2);
    selects.forEach((s) => expect(s).toContain('app-select'));
    expect(storage.match(/<SaveLocationPendingNotice \/>/g)).toHaveLength(1);
    expect(storage.slice(0, storage.indexOf('const RecoveryTab'))).not.toMatch(/<hr /);
  });

  test('로그인 탭: API 토큰으로 로그인 / Opus 할당량 안내 / 여러 토큰 / 부스트 모드 — 체크 4곳 체크 줄, 발급 안내 상자는 밖', () => {
    const src = read('ConfigScreen.tsx');
    const login = src.slice(src.indexOf('// 묶음 상자(2026-11-20 UI 정돈 그룹 1-a): API 토큰으로 로그인'), src.indexOf('const ConfigScreen = observer'));
    expect(titles(login)).toEqual(['API 토큰으로 로그인', 'Opus 할당량 안내', '여러 토큰', 'BOOST_TEXT.settingsTitle']);
    for (const id of ['cfgMultiTokenAutoRotate', 'cfgMultiTokenBalanceRotate', 'cfgBoostMode', 'cfgBoostVariantTasks']) {
      expect(login).toMatch(new RegExp(`<SettingCheckRow\\s+id="${id}"`));
    }
    expect(rawCheckboxes(login)).toBe(0);
    expect(login).not.toMatch(/<hr /);
    expect(login).toContain('onChange={(checked) => void toggleBoost(checked)}');
    // 토큰 발급 안내 상자는 묶음 밖(첫 묶음이 닫힌 뒤, 둘째 묶음 전)
    const guide = login.indexOf('토큰 발급 방법</p>');
    expect(guide).toBeGreaterThan(login.indexOf('</SettingGroup>'));
    expect(guide).toBeLessThan(login.indexOf('<SettingGroup title="Opus 할당량 안내">'));
    // 할당량 상세 창에서도 같은 스위치 — 왼쪽 맞춤 감싸개
    expect(read('OpusUsageBadge.tsx')).toContain('<div className="border-t line-color pt-1.5 -mx-2.5">');
  });

  test('드라이브 탭: Google 드라이브 연동 / Google 드라이브 백업 / 환경설정 내보내기·불러오기 — 토큰 포함은 체크 줄, 미리보기 카드는 체크 모양만', () => {
    const tab = read('DriveSettingsTab.tsx');
    const connect = read('DriveConnectSection.tsx');
    const sync = read('ConfigSyncSection.tsx');
    expect(titles(connect)).toEqual(['GOOGLE_DRIVE_TEXT.sectionTitle']);
    expect(titles(tab)).toEqual(['T.sectionTitle', 'T.managerTitle']);
    expect(titles(sync)).toEqual(['CONFIG_SYNC_TEXT.sectionTitle']);
    expect(connect).not.toContain('{GOOGLE_DRIVE_TEXT.sectionTitle}\n');
    expect(sync).toMatch(/<SettingCheckRow\s+id="cfgSyncIncludeToken"/);
    // 미리보기 창의 그룹 선택은 카드 그대로, 체크 모양만
    expect(sync).toMatch(/type="checkbox"\s+id=\{id\}\s+className="setting-check"/);
    expect(rawCheckboxes(sync)).toBe(1);
    expect(tab).toContain('<details>');
    expect(tab).not.toMatch(/<hr /);
  });

  test('모바일 툴바 탭: 퀵 메뉴 구성 묶음(inGroup), 구분선 없음', () => {
    const src = read('ConfigLayoutTab.tsx');
    const tab = src.slice(src.indexOf('const ToolbarTab'), src.indexOf('/* ── 탭: 레이아웃 ── */'));
    expect(tab).toContain('<SettingGroup title="퀵 메뉴 구성">');
    expect(tab).toContain('<QuickMenuEditor inGroup');
    expect(tab).not.toMatch(/<hr /);
    expect(rawCheckboxes(read('ToolbarLayoutEditor.tsx'))).toBe(0);
  });
});
