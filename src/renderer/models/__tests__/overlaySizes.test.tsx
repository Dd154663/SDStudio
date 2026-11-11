// 오버레이 창 크기 체계(2026-11-11 묶음 0) — 등급 계산(순수)·옛 width 호환 렌더·슬롯 위치·모바일 분기
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';

const mockEnv = { mobile: false };
jest.mock('@capacitor/app', () => ({
  App: { addListener: jest.fn(), minimizeApp: jest.fn() },
}));
jest.mock('../index', () => ({
  get isMobile() {
    return mockEnv.mobile;
  },
}));
jest.mock('../AppService', () => ({
  appState: {
    confirmAsync: jest.fn(),
    incrementModalOverlay: jest.fn(),
    decrementModalOverlay: jest.fn(),
  },
}));

import ModalOverlay from '../../componenets/ModalOverlay';
import {
  FULLSCREEN_FRAME_CLASS_MOBILE,
  FULLSCREEN_FRAME_CLASS_PC,
  LEGACY_WIDTH_TO_SIZE,
  OVERLAY_SIZES,
  legacyFrameClass,
  legacyWidthToSize,
  overlayUsesColumns,
  resolveOverlayFrame,
} from '../overlaySizes';

// 2026-11-10(HEAD b4cc7ce) ModalOverlay 의 창 상자 클래스 — 옛 경로는 이것과 글자 하나까지 같아야 한다.
const OLD_SHELL =
  'w-[90vw] max-h-[85vh] bg-[var(--c-zone)] rounded-xl shadow-2xl flex flex-col overflow-hidden border line-color';
const OLD_FULL_PC =
  'w-[94vw] h-[92vh] bg-[var(--c-zone)] rounded-xl shadow-2xl flex flex-col overflow-hidden border line-color';
const OLD_FULL_MOBILE = 'w-full h-full bg-[var(--c-zone)] flex flex-col overflow-hidden';

describe('resolveOverlayFrame (순수)', () => {
  test('등급 값 표', () => {
    expect(OVERLAY_SIZES.s).toEqual({ width: 480, height: 'content', minHeight: 200 });
    expect(OVERLAY_SIZES.m).toEqual({ width: 720, height: 'content', minHeight: 360 });
    expect(OVERLAY_SIZES.l).toEqual({ width: 1000, height: 'fixed', fixedHeight: 760 });
    expect(OVERLAY_SIZES.xl).toEqual({ width: 1280, height: 'fixed', fixedHeight: 860 });
  });
  test('PC S·M = 내용 높이(최소·최대), 폭 min(등급, 94vw)', () => {
    const s = resolveOverlayFrame({ size: 's', mobile: false });
    expect(s.mode).toBe('size');
    expect(s.style).toEqual({
      width: 'min(480px, 94vw)',
      minHeight: 'min(200px, 85vh)',
      maxHeight: '85vh',
    });
    const m = resolveOverlayFrame({ size: 'm', mobile: false });
    expect(m.style).toEqual({
      width: 'min(720px, 94vw)',
      minHeight: 'min(360px, 85vh)',
      maxHeight: '85vh',
    });
    expect(s.className).not.toMatch(/max-w-|w-\[90vw\]|max-h-/);
  });
  test('PC L·XL = 고정 높이 min(85vh, 760/860)', () => {
    expect(resolveOverlayFrame({ size: 'l', mobile: false }).style).toEqual({
      width: 'min(1000px, 94vw)',
      height: 'min(85vh, 760px)',
    });
    expect(resolveOverlayFrame({ size: 'xl', mobile: false }).style).toEqual({
      width: 'min(1280px, 94vw)',
      height: 'min(85vh, 860px)',
    });
  });
  test('모바일: 90vw·max-h 85vh 유지, 최소·고정 높이 미적용', () => {
    for (const size of ['s', 'm', 'l', 'xl'] as const) {
      const f = resolveOverlayFrame({ size, mobile: true });
      expect(f.className).toBe(OLD_SHELL);
      expect(f.style).toEqual({ maxWidth: `${OVERLAY_SIZES[size].width}px` });
    }
  });
  test('full = 옛 fullscreen 과 같은 클래스, fullscreen prop 은 full 로 매핑', () => {
    expect(FULLSCREEN_FRAME_CLASS_PC).toBe(OLD_FULL_PC);
    expect(FULLSCREEN_FRAME_CLASS_MOBILE).toBe(OLD_FULL_MOBILE);
    expect(resolveOverlayFrame({ fullscreen: true, mobile: false })).toEqual({
      mode: 'full',
      size: 'full',
      className: OLD_FULL_PC,
    });
    expect(resolveOverlayFrame({ size: 'full', mobile: true }).className).toBe(OLD_FULL_MOBILE);
  });
  test('size 없으면 옛 width 클래스 그대로(생략 = max-w-xl), size 가 width 보다 우선', () => {
    expect(resolveOverlayFrame({ mobile: false })).toEqual({
      mode: 'legacy',
      className: 'max-w-xl ' + OLD_SHELL,
    });
    expect(resolveOverlayFrame({ width: 'max-w-3xl md:max-w-7xl', mobile: true }).className).toBe(
      'max-w-3xl md:max-w-7xl ' + OLD_SHELL,
    );
    expect(legacyFrameClass('max-w-md')).toBe('max-w-md ' + OLD_SHELL);
    expect(resolveOverlayFrame({ size: 'm', width: 'max-w-md', mobile: false }).mode).toBe('size');
  });
  test('두 열은 PC·L 이상만', () => {
    expect(overlayUsesColumns(resolveOverlayFrame({ size: 'l', mobile: false }), false)).toBe(true);
    expect(overlayUsesColumns(resolveOverlayFrame({ size: 'm', mobile: false }), false)).toBe(false);
    expect(overlayUsesColumns(resolveOverlayFrame({ size: 'xl', mobile: true }), true)).toBe(false);
    expect(overlayUsesColumns(resolveOverlayFrame({ width: 'max-w-7xl', mobile: false }), false)).toBe(
      false,
    );
  });
  test('폭 클래스 → 등급 매핑', () => {
    expect(legacyWidthToSize(undefined)).toBe('m');
    expect(legacyWidthToSize('max-w-md')).toBe('s');
    expect(legacyWidthToSize('max-w-lg')).toBe('s');
    expect(legacyWidthToSize('max-w-xl')).toBe('m');
    expect(legacyWidthToSize('max-w-2xl')).toBe('m');
    expect(legacyWidthToSize('max-w-3xl')).toBe('l');
    expect(legacyWidthToSize('max-w-3xl md:max-w-7xl')).toBe('xl');
    expect(legacyWidthToSize('max-w-none')).toBe('xl');
    expect(legacyWidthToSize('w-[33rem]')).toBeUndefined();
    expect(Object.keys(LEGACY_WIDTH_TO_SIZE)).toContain('max-w-[90vw]');
  });
});

describe('ModalOverlay 렌더', () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeAll(() => {
    (global as any).IS_REACT_ACT_ENVIRONMENT = true;
  });
  beforeEach(() => {
    mockEnv.mobile = false;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });
  const render = (el: React.ReactElement) => act(async () => root.render(el));
  const box = () => container.firstElementChild!.firstElementChild as HTMLDivElement;

  test('옛 width 호출은 종전 DOM 그대로(상자·머리·본문 3단, 본문 p-5, 크기 속성 없음)', async () => {
    await render(
      <ModalOverlay isOpen onClose={() => {}} title="t" width="max-w-2xl">
        <p>본문</p>
      </ModalOverlay>,
    );
    const b = box();
    expect(b.className).toBe('max-w-2xl ' + OLD_SHELL);
    expect(b.getAttribute('style')).toBeNull();
    expect(b.hasAttribute('data-modal-size')).toBe(false);
    expect(b.hasAttribute('data-modal-fullscreen')).toBe(false);
    expect(b.children).toHaveLength(2);
    const body = b.children[1] as HTMLDivElement;
    expect(body.className).toBe('flex-1 overflow-auto p-5');
    expect(body.attributes).toHaveLength(1);
    expect(body.innerHTML).toBe('<p>본문</p>');
  });
  test('width 생략 = max-w-xl, fullscreen = 옛 클래스·본문 여백 없음', async () => {
    await render(
      <ModalOverlay isOpen onClose={() => {}} title="t">
        x
      </ModalOverlay>,
    );
    expect(box().className).toBe('max-w-xl ' + OLD_SHELL);
    await render(
      <ModalOverlay isOpen onClose={() => {}} title="t" fullscreen>
        x
      </ModalOverlay>,
    );
    expect(box().className).toBe(OLD_FULL_PC);
    expect(box().hasAttribute('data-modal-fullscreen')).toBe(true);
    expect((box().children[1] as HTMLElement).className).toBe('flex-1 min-h-0 overflow-hidden');
    expect(box().children[1].attributes).toHaveLength(1);
  });
  test('size 경로: 인라인 크기·data-modal-size·도구줄/바닥줄은 본문 스크롤 밖', async () => {
    await render(
      <ModalOverlay
        isOpen
        onClose={() => {}}
        title="t"
        size="m"
        toolbar={<button>추가</button>}
        footer={<button>확인</button>}
        footerStart={<button>삭제</button>}
      >
        <p>본문</p>
      </ModalOverlay>,
    );
    const b = box();
    expect(b.dataset.modalSize).toBe('m');
    expect(b.style.maxHeight).toBe('85vh');
    const slots = Array.from(b.children).map((c) => (c as HTMLElement).dataset.modalSlot ?? 'header');
    expect(slots).toEqual(['header', 'toolbar', 'body', 'footer']);
    const body = b.querySelector('[data-modal-slot="body"]') as HTMLElement;
    expect(body.className).toContain('overflow-auto');
    expect(body.className).toContain('min-h-0');
    expect(body.querySelector('button')).toBeNull();
    const footer = b.querySelector('[data-modal-slot="footer"]') as HTMLElement;
    // 왼쪽 위험 버튼 묶음 → 오른쪽(ml-auto) 확정 묶음
    expect(footer.children[0].textContent).toBe('삭제');
    expect((footer.children[1] as HTMLElement).className).toContain('ml-auto');
    expect(footer.children[1].textContent).toBe('확인');
  });
  test('L 이상 PC: 세로 탭·왼쪽 목록·본문이 옆 열로, 각자 스크롤', async () => {
    await render(
      <ModalOverlay
        isOpen
        onClose={() => {}}
        title="t"
        size="l"
        sideTabs={<button>탭1</button>}
        aside={<ul><li>목록</li></ul>}
      >
        <p>편집</p>
      </ModalOverlay>,
    );
    const cols = box().querySelector('[data-modal-slot="columns"]') as HTMLElement;
    expect(cols).not.toBeNull();
    const names = Array.from(cols.children).map((c) => (c as HTMLElement).dataset.modalSlot);
    expect(names).toEqual(['side-tabs', 'aside', 'body']);
    expect((cols.children[0] as HTMLElement).style.width).toBe('180px');
    expect((cols.children[1] as HTMLElement).style.width).toBe('280px');
    // jsdom 의 CSS 파서는 min() 을 버리므로 인라인 값은 순수 함수 테스트로 확인하고 여기서는 등급 표시만 본다.
    expect(box().dataset.modalSize).toBe('l');
  });
  test('M 이하·모바일: 세로 탭은 그리지 않고 목록은 본문 위에 쌓음', async () => {
    await render(
      <ModalOverlay isOpen onClose={() => {}} title="t" size="m" sideTabs={<b>탭</b>} aside={<i>목록</i>}>
        <p>편집</p>
      </ModalOverlay>,
    );
    expect(box().querySelector('[data-modal-slot="columns"]')).toBeNull();
    expect(box().querySelector('[data-modal-slot="side-tabs"]')).toBeNull();
    expect(container.textContent).not.toContain('탭');
    const body = box().querySelector('[data-modal-slot="body"]') as HTMLElement;
    expect(body.firstElementChild!.getAttribute('data-modal-slot')).toBe('aside');

    act(() => root.unmount());
    mockEnv.mobile = true;
    root = createRoot(container);
    await render(
      <ModalOverlay isOpen onClose={() => {}} title="t" size="xl" sideTabs={<b>탭</b>}>
        <p>편집</p>
      </ModalOverlay>,
    );
    expect(box().className).toBe(OLD_SHELL);
    expect(box().style.maxWidth).toBe('1280px');
    expect(box().style.height).toBe('');
    expect(box().style.minHeight).toBe('');
    expect(box().querySelector('[data-modal-slot="side-tabs"]')).toBeNull();
  });
});
