// 「캡처」 옵션 창(2026-11-25) — componenets/CaptureDialog.tsx + 두 진입점 연결(소스 확인).
// 선택지 기본값 규칙·0개 선택지 비활성·20줄 초과 시 실행 버튼 비활성과 문구·그리드에서 열면 씬 묶음이 없는 것.
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import fs from 'fs';
import path from 'path';

jest.mock('@capacitor/app', () => ({
  App: { addListener: jest.fn(), minimizeApp: jest.fn() },
}));
jest.mock('../index', () => ({ isMobile: false }));
jest.mock('../platform', () => ({ platform: { isMobile: false } }));
const mockAppState: any = {
  incrementModalOverlay: jest.fn(),
  decrementModalOverlay: jest.fn(),
  confirmAsync: jest.fn(async () => true),
};
jest.mock('../AppService', () => ({ appState: mockAppState }));

import CaptureDialog from '../../componenets/CaptureDialog';
import {
  buildGridCaptureContent,
  CaptureOptions,
  CAPTURE_OPTIONS_STORAGE_KEY,
  CAPTURE_TEXT,
  defaultCaptureGridScope,
  defaultCaptureSceneScope,
  planCapture,
} from '../captureSheet';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('캡처 창', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    window.localStorage.clear();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  // 범위별 장수(그리드 칸 목록으로 계획)
  const gridPlan = (counts: Record<string, number>) => (scope: string, opts: CaptureOptions) =>
    planCapture(
      buildGridCaptureContent(Array.from({ length: counts[scope] ?? 0 }, (_, i) => `/o/${i}`), '씬', opts.showNames),
      opts,
      0.75,
      40_000_000,
    );

  const render = (props: Partial<React.ComponentProps<typeof CaptureDialog>> = {}) => {
    const counts = { list: 8, selected: 0, visible: 3 };
    const all = {
      title: CAPTURE_TEXT.sceneTitle,
      variant: 'scenes' as const,
      scopes: (['list', 'selected', 'visible'] as const).map((k) => ({
        key: k,
        label: CAPTURE_TEXT.sceneScope[k],
        count: counts[k],
      })),
      initialScope: defaultCaptureSceneScope(counts),
      plan: gridPlan(counts),
      onRun: jest.fn(),
      onClose: jest.fn(),
      ...props,
    };
    act(() => root.render(<CaptureDialog {...all} />));
    return all;
  };
  const opt = (key: string) => host.querySelector<HTMLButtonElement>(`[data-capture-option="${key}"]`)!;
  const click = (el: Element) => act(() => (el as HTMLElement).click());
  const run = () => host.querySelector<HTMLButtonElement>('[data-capture-run]')!;

  test('씬 목록: m 등급, 범위 칸에 수, 0개는 비활성, 기본 = 선택이 없으면 지금 목록', () => {
    render();
    expect(host.querySelector('[data-modal-size="m"]')).not.toBeNull();
    expect(opt('scope:list').textContent).toBe('지금 목록 (8)');
    expect(opt('scope:selected').disabled).toBe(true);
    expect(opt('scope:list').getAttribute('aria-pressed')).toBe('true');
    expect(opt('perScene:main').getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('#capture-include-empty')).not.toBeNull();
    // 요약 줄 — 8장, 4장씩 2줄, 보통 384 · 3:4
    expect(host.querySelector('[data-capture-summary-line]')!.textContent).toBe('이미지 8장 · 2줄 · 결과 1536 × 1024 px');
    expect(run().disabled).toBe(false);
  });

  test('선택한 씬이 있으면 기본 = 선택한 씬', () => {
    expect(defaultCaptureSceneScope({ list: 8, selected: 2, visible: 0 })).toBe('selected');
    const counts = { list: 8, selected: 2, visible: 0 };
    render({
      scopes: (['list', 'selected', 'visible'] as const).map((k) => ({ key: k, label: CAPTURE_TEXT.sceneScope[k], count: counts[k] })),
      initialScope: defaultCaptureSceneScope(counts),
      plan: gridPlan(counts),
    });
    expect(opt('scope:selected').getAttribute('aria-pressed')).toBe('true');
    expect(opt('scope:visible').disabled).toBe(true);
  });

  test('20줄 초과면 실행 버튼 비활성 + 문구, 한 줄의 장수를 늘리면 다시 실행 가능', () => {
    const counts = { list: 84, selected: 0, visible: 0 };
    render({
      scopes: [{ key: 'list', label: CAPTURE_TEXT.sceneScope.list, count: 84 }],
      initialScope: 'list',
      plan: gridPlan(counts),
    });
    expect(run().disabled).toBe(true);
    expect(host.textContent).toContain(CAPTURE_TEXT.blocked);
    expect(host.textContent).toContain(CAPTURE_TEXT.blockedHint);
    click(host.querySelector('[data-capture-columns-inc]')!);
    expect(host.querySelector('[data-capture-columns]')!.textContent).toBe('5');
    // 84 ÷ 5 = 17줄 → 경고(실행 가능)
    expect(run().disabled).toBe(false);
    expect(host.textContent).toContain(CAPTURE_TEXT.warn);
    // 기억(localStorage)
    expect(JSON.parse(window.localStorage.getItem(CAPTURE_OPTIONS_STORAGE_KEY)!).columns).toBe(5);
  });

  test('「아주 크게」는 고화질에서만, 실행하면 범위·옵션·계획을 넘긴다', () => {
    const props = render();
    expect(opt('cellSize:768')).toBeNull();
    click(opt('quality:high'));
    click(opt('cellSize:768'));
    click(opt('format:png'));
    click(run());
    expect(props.onRun).toHaveBeenCalledTimes(1);
    const [scope, options, plan] = (props.onRun as jest.Mock).mock.calls[0];
    expect(scope).toBe('list');
    expect(options).toMatchObject({ quality: 'high', cellSize: 768, format: 'png' });
    expect(plan.layout.cellWidth).toBe(768);
    // 빠르게로 되돌리면 768 대신 512 로 계산
    click(opt('quality:fast'));
    expect(opt('cellSize:512').getAttribute('aria-pressed')).toBe('true');
  });

  test('그리드에서 열면 씬 묶음(씬당 이미지·빈 씬 포함)이 없다, 기본 범위 = 선택 → 즐겨찾기 → 전체', () => {
    const counts = { selected: 0, favorites: 3, all: 10 };
    render({
      title: CAPTURE_TEXT.gridTitle('씬 A'),
      variant: 'grid',
      scopes: (['selected', 'favorites', 'all'] as const).map((k) => ({ key: k, label: CAPTURE_TEXT.gridScope[k], count: counts[k] })),
      initialScope: defaultCaptureGridScope(counts),
      plan: gridPlan(counts),
    });
    expect(host.textContent).toContain('"씬 A" 이미지 캡처');
    expect(host.querySelector('[data-capture-section="perScene"]')).toBeNull();
    expect(host.querySelector('#capture-include-empty')).toBeNull();
    expect(host.querySelector('#capture-show-names')).not.toBeNull();
    expect(opt('scope:selected').disabled).toBe(true);
    expect(opt('scope:favorites').getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('[data-capture-summary-line]')!.textContent).toContain('이미지 3장 · 1줄');
  });

  test('주 동작만 색(하늘 솔리드), 취소는 회색 · 취소로 닫힘', () => {
    const props = render();
    expect(run().className).toContain('btn-solid-sky');
    const cancel = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === CAPTURE_TEXT.cancel)!;
    expect(cancel.className).toContain('btn-neutral');
    click(cancel);
    expect(props.onClose).toHaveBeenCalled();
  });
});

describe('진입점 연결(소스 확인)', () => {
  const read = (rel: string) => fs.readFileSync(path.join(__dirname, '../../componenets', rel), 'utf8');
  test('씬 목록: openCapture 는 toolbarButtons 맵보다 먼저 선언(렌더 중 값으로 읽음)', () => {
    const src = read('SceneQueueControl.tsx');
    const decl = src.indexOf('const openCapture = ');
    const map = src.indexOf('const toolbarButtons: Record<string, ReactNode> = {');
    expect(decl).toBeGreaterThan(0);
    expect(decl).toBeLessThan(map);
    expect(src.indexOf("'scene-capture': (")).toBeGreaterThan(map);
    expect(src).toContain('<CaptureDialog');
    // 랜덤 씬은 실행하는 순간 다시 뽑은 계획(finalPlan), 그 밖은 요약과 같은 계획을 그대로 쓴다
    expect(src).toContain("const finalPlan = scope === 'random' ? capturePlanFor(scope, opts) : plan;");
    expect(src).toMatch(/runCaptureSheet\(curSession, finalPlan, opts, captureFileStem\(curSession\.name, new Date\(\)\)\)/);
    expect(src).toContain("(['list', 'selected', 'visible', 'random'] as const)");
  });
  test('그리드: 다운로드 바로 옆 회색 버튼, 핸들러는 머리줄·V2 줄보다 먼저 선언, 인페인트 씬·휴지통 탭에서 끔', () => {
    const src = read('ResultViewer.tsx');
    expect(src).toMatch(/hn\('download',[\s\S]{0,400}<\/Tooltip>\s*\)\)\}\s*\{hn\('capture', \(\s*<Tooltip content=\{CAPTURE_TEXT\.tooltip\}>\s*<button\s*className=\{`round-button icon-only back-gray`\}/);
    const decl = src.indexOf('const actCapture = ');
    expect(decl).toBeGreaterThan(0);
    expect(decl).toBeLessThan(src.indexOf('const galleryTier: V2TierItem[]'));
    expect(src).toContain('const captureDisabled = selectedTab === 2 || selectedTab === 3;');
    expect(src).toMatch(/tierItem\('capture', CAPTURE_TEXT\.button, 'back-gray', <ActionIcon id="scene-capture" \/>, actCapture, captureDisabled\)/);
  });
});
