// 닫기 규칙 — 미저장 가드(dirty)·바깥 클릭 기원 검사(2026-10-03 E2-2·E2-3)
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';

const state = {
  confirmAsync: jest.fn(),
  incrementModalOverlay: jest.fn(),
  decrementModalOverlay: jest.fn(),
};
jest.mock('@capacitor/app', () => ({
  App: { addListener: jest.fn(), minimizeApp: jest.fn() },
}));
jest.mock('../index', () => ({ isMobile: false }));
jest.mock('../AppService', () => ({ appState: state }));

import ModalOverlay from '../../componenets/ModalOverlay';
import { useBackdropClose } from '../../componenets/backdropClose';
import { backStackService } from '../BackStackService';
import {
  DISCARD_CHANGES_CONFIRM,
  DISCARD_CHANGES_TEXT,
  runGuardedClose,
} from '../escapeGate';

let root: Root;
let container: HTMLDivElement;

beforeAll(() => {
  (global as any).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  state.confirmAsync.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  expect(backStackService.size).toBe(0);
});

const deferred = () => {
  let resolve!: (v: boolean) => void;
  const promise = new Promise<boolean>((r) => (resolve = r));
  return { promise, resolve };
};
const escape = () =>
  act(async () => {
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
  });
const mouse = (el: Element, type: 'mousedown' | 'click') =>
  act(async () => {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
  });

describe('runGuardedClose (순수 규칙)', () => {
  test('dirty 가 없거나 거짓이면 곧바로(동기) 닫는다', () => {
    const onClose = jest.fn();
    const confirm = jest.fn();
    void runGuardedClose({ pending: false }, undefined, onClose, confirm);
    expect(onClose).toHaveBeenCalledTimes(1);
    void runGuardedClose({ pending: false }, () => false, onClose, confirm);
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(confirm).not.toHaveBeenCalled();
  });
  test('dirty 면 확인했을 때만 닫고, 확인 창이 떠 있는 동안 다시 온 요청은 무시', async () => {
    const onClose = jest.fn();
    const d = deferred();
    const confirm = jest.fn(() => d.promise);
    const st = { pending: false };
    const first = runGuardedClose(st, () => true, onClose, confirm);
    const second = runGuardedClose(st, () => true, onClose, confirm);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(await second).toBe(false);
    d.resolve(true);
    expect(await first).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(st.pending).toBe(false);
  });
  test('취소하면 닫지 않고 다시 요청할 수 있다', async () => {
    const onClose = jest.fn();
    const st = { pending: false };
    expect(await runGuardedClose(st, () => true, onClose, async () => false)).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    expect(await runGuardedClose(st, () => true, onClose, async () => true)).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('ModalOverlay dirty', () => {
  const render = (onClose: () => void, dirty?: () => boolean) =>
    act(async () =>
      root.render(
        <ModalOverlay isOpen onClose={onClose} title="t" dirty={dirty}>
          <input data-testid="field" />
        </ModalOverlay>,
      ),
    );
  const closeButton = () =>
    container.querySelector('button[aria-label="닫기"]') as HTMLButtonElement;
  const backdrop = () => container.firstElementChild as HTMLDivElement;

  test('dirty 를 넘기지 않으면 ✕·Esc 가 예전처럼 바로 닫는다', async () => {
    const onClose = jest.fn();
    await render(onClose);
    await act(async () => closeButton().click());
    expect(onClose).toHaveBeenCalledTimes(1);
    await escape();
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(state.confirmAsync).not.toHaveBeenCalled();
  });

  test('dirty 거짓이면 확인 없이 닫는다', async () => {
    const onClose = jest.fn();
    await render(onClose, () => false);
    await act(async () => closeButton().click());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(state.confirmAsync).not.toHaveBeenCalled();
  });

  test('dirty 참 — ✕ 는 「버리고 닫을까요?」 확인 뒤에만 닫는다(취소면 유지)', async () => {
    const onClose = jest.fn();
    state.confirmAsync.mockResolvedValueOnce(false);
    await render(onClose, () => true);
    await act(async () => closeButton().click());
    expect(state.confirmAsync).toHaveBeenCalledWith(
      DISCARD_CHANGES_TEXT,
      DISCARD_CHANGES_CONFIRM,
      { danger: true },
    );
    expect(onClose).not.toHaveBeenCalled();
    state.confirmAsync.mockResolvedValueOnce(true);
    await act(async () => closeButton().click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('dirty 참 — Esc·바깥 클릭도 같은 가드, 확인 창이 떠 있는 동안 중복 요청 차단', async () => {
    const onClose = jest.fn();
    const d = deferred();
    state.confirmAsync.mockReturnValueOnce(d.promise);
    await render(onClose, () => true);
    await escape();
    // 확인 대기 중 ✕·바깥 클릭 — 두 번째 확인 창을 띄우지 않는다
    await act(async () => closeButton().click());
    await mouse(backdrop(), 'mousedown');
    await mouse(backdrop(), 'click');
    expect(state.confirmAsync).toHaveBeenCalledTimes(1);
    await act(async () => d.resolve(true));
    expect(onClose).toHaveBeenCalledTimes(1);
    // 바깥 클릭(누름·뗌 모두 배경) → 확인 → 닫기
    state.confirmAsync.mockResolvedValueOnce(true);
    await mouse(backdrop(), 'mousedown');
    await mouse(backdrop(), 'click');
    expect(state.confirmAsync).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  test('창 안에서 누르고 배경에서 뗀 클릭은 닫지 않는다', async () => {
    const onClose = jest.fn();
    await render(onClose);
    const field = container.querySelector('[data-testid="field"]')!;
    await mouse(field, 'mousedown');
    await mouse(backdrop(), 'click');
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('useBackdropClose — 바깥 클릭 기원 검사(ProjectDrawer 래퍼 공용, E2-2)', () => {
  function Drawer({ onClose }: { onClose: () => void }) {
    const backdrop = useBackdropClose(onClose);
    return (
      <div data-testid="wrap" {...backdrop}>
        {/* 어두운 배경 층은 pointer-events 없음 — 배경 클릭의 대상은 래퍼 자신 */}
        <div data-testid="panel">
          <span data-testid="text">글자</span>
        </div>
      </div>
    );
  }
  test('누름·뗌 모두 래퍼일 때만 닫는다', async () => {
    const onClose = jest.fn();
    await act(async () => root.render(<Drawer onClose={onClose} />));
    const wrap = container.querySelector('[data-testid="wrap"]')!;
    const text = container.querySelector('[data-testid="text"]')!;
    // 패널 글자를 끌어 선택하다 배경에서 뗌 — click 은 공통 조상(래퍼)에서 난다
    await mouse(text, 'mousedown');
    await mouse(wrap, 'click');
    expect(onClose).not.toHaveBeenCalled();
    // 패널 안 클릭
    await mouse(text, 'mousedown');
    await mouse(text, 'click');
    expect(onClose).not.toHaveBeenCalled();
    // 배경 클릭
    await mouse(wrap, 'mousedown');
    await mouse(wrap, 'click');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
