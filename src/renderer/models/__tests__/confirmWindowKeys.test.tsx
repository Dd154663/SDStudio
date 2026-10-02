// 확인 창 키 규칙 + 닫기 관문 통합 — 2026-10-03 U1·X1·X2·X14
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { configure, observable, runInAction } from 'mobx';

// 앱은 컴포넌트에서 appState 를 직접 바꾼다(데코레이터 액션 밖) — 테스트의 평범한 observable 도 같은 조건으로
configure({ enforceActions: 'never' });

const state = observable({
  dialogs: [] as any[],
  skipImageDeleteConfirm: false,
});
jest.mock('@capacitor/app', () => ({
  App: { addListener: jest.fn(), minimizeApp: jest.fn() },
}));
jest.mock('../index', () => ({ isMobile: false }));
jest.mock('../AppService', () => ({ appState: state }));
jest.mock('../../componenets/UtilComponents', () => ({
  DropdownSelect: ({ options, onSelect }: any) => (
    <select
      data-dropdown
      onChange={(e) =>
        onSelect(options.find((o: any) => o.value === e.target.value))
      }
    >
      {options.map((o: any) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

import ConfirmWindow from '../../componenets/ConfirmWindow';
import { backStackService } from '../BackStackService';
import { confirmViaDialog, confirmEnterAction } from '../confirmKeys';

let root: Root;
let container: HTMLDivElement;
const push = (d: any) => runInAction(() => state.dialogs.push(d));
const key = (target: EventTarget, k: string, init: KeyboardEventInit = {}) =>
  act(async () => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }),
    );
  });

beforeAll(() => {
  (global as any).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(async () => {
  runInAction(() => state.dialogs.splice(0));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<ConfirmWindow />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  expect(backStackService.size).toBe(0);
});

describe('confirmEnterAction (순수 규칙)', () => {
  test.each([
    ['confirm', 'confirm'],
    ['yes-only', 'confirm'],
    ['input-confirm', 'confirm'],
    ['checkbox', 'confirm'],
    ['select', 'ignore'],
    ['textarea-confirm', 'ignore'],
  ] as const)('%s → %s', (type, expected) => {
    expect(confirmEnterAction(type)).toBe(expected);
  });
  test('IME·창 안 버튼·textarea·펼친 드롭다운은 양보', () => {
    expect(confirmEnterAction('confirm', { composing: true })).toBe('pass');
    expect(confirmEnterAction('confirm', { onDialogButton: true })).toBe('pass');
    expect(confirmEnterAction('textarea-confirm', { inTextarea: true })).toBe('pass');
    expect(confirmEnterAction('dropdown', { dropdownMenuOpen: true })).toBe('pass');
    expect(confirmEnterAction('dropdown', { dropdownChosen: false })).toBe('ignore');
    expect(confirmEnterAction('dropdown', { dropdownChosen: true })).toBe('confirm');
  });
});

describe('ConfirmWindow 키 처리', () => {
  test('confirm: Enter = 확인, 아래 화면으로 Enter 가 새지 않음', async () => {
    const callback = jest.fn();
    await act(async () => push({ type: 'confirm', text: '삭제할까요?', callback }));
    const leak = jest.fn();
    window.addEventListener('keydown', leak);
    await key(document.body, 'Enter');
    window.removeEventListener('keydown', leak);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(leak).not.toHaveBeenCalled();
    expect(state.dialogs.length).toBe(0);
  });

  test('select: Enter 는 무시(선택 없음 콜백 금지), 창 유지', async () => {
    const callback = jest.fn();
    const onCancel = jest.fn();
    await act(async () =>
      push({
        type: 'select',
        text: '고르세요',
        items: [{ text: 'A', value: 'a' }],
        callback,
        onCancel,
      }),
    );
    await key(document.body, 'Enter');
    expect(callback).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(state.dialogs.length).toBe(1);
    // Esc = 취소
    await key(document.body, 'Escape');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(state.dialogs.length).toBe(0);
  });

  test('IME 조합 중 Enter 는 확인하지 않는다', async () => {
    const callback = jest.fn();
    await act(async () => push({ type: 'confirm', text: 'x', callback }));
    await key(document.body, 'Enter', { isComposing: true });
    expect(callback).not.toHaveBeenCalled();
    expect(state.dialogs.length).toBe(1);
  });

  test('input-confirm: 열리면 입력칸 포커스·미리 채운 값 전체 선택, Enter 로 값 전달', async () => {
    jest.useFakeTimers();
    try {
      const callback = jest.fn();
      await act(async () =>
        push({ type: 'input-confirm', text: '새 이름', inputValue: '기존', callback }),
      );
      await act(async () => {
        jest.runOnlyPendingTimers();
      });
      const input = container.ownerDocument.querySelector(
        '.confirm-window input[type="text"]',
      ) as HTMLInputElement;
      expect(document.activeElement).toBe(input);
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe('기존'.length);
      await key(input, 'Enter');
      expect(callback).toHaveBeenCalledWith('기존', '새 이름');
    } finally {
      jest.useRealTimers();
    }
  });

  test('dropdown: 고르기 전 [확인] 비활성·Enter 무시, 고른 뒤 Enter = 확인', async () => {
    const callback = jest.fn();
    await act(async () =>
      push({
        type: 'dropdown',
        text: '대상',
        items: [
          { text: 'A', value: 'a' },
          { text: 'B', value: 'b' },
        ],
        callback,
      }),
    );
    const okButton = Array.from(
      document.querySelectorAll('.confirm-window button'),
    ).find((b) => b.textContent === '확인') as HTMLButtonElement;
    expect(okButton.disabled).toBe(true);
    await key(document.body, 'Enter');
    expect(callback).not.toHaveBeenCalled();
    const select = document.querySelector('[data-dropdown]') as HTMLSelectElement;
    await act(async () => {
      select.value = 'b';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await key(document.body, 'Enter');
    expect(callback).toHaveBeenCalledWith('b', '대상');
  });
});

describe('닫기 관문 — 맨 위 한 겹만', () => {
  test('확인 창이 떠 있으면 Esc 는 확인 창만 취소하고 아래 창은 그대로', async () => {
    const under = jest.fn();
    const handle = backStackService.push(under); // 아래 창(모달 등)
    const otherEsc = jest.fn();
    window.addEventListener('keydown', otherEsc, true); // 예전 방식의 다른 Esc 리스너
    try {
      const onCancel = jest.fn();
      const callback = jest.fn();
      await act(async () => push({ type: 'confirm', text: 'x', onCancel, callback }));
      await key(document.body, 'Escape');
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(callback).not.toHaveBeenCalled();
      expect(under).not.toHaveBeenCalled();
      expect(otherEsc).not.toHaveBeenCalled();
      // 두 번째 Esc 는 아래 창
      await key(document.body, 'Escape');
      expect(under).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('keydown', otherEsc, true);
      handle.remove();
    }
  });

  test('나중에 열린 일반 창보다도 확인 창이 먼저(preempt)', async () => {
    const onCancel = jest.fn();
    await act(async () => push({ type: 'confirm', text: 'x', onCancel }));
    const later = jest.fn();
    const handle = backStackService.push(later);
    try {
      await key(document.body, 'Escape');
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(later).not.toHaveBeenCalled();
    } finally {
      handle.remove();
    }
  });

  test('data-esc-cancel 입력칸의 Esc 는 창을 닫지 않고 입력칸에 맡긴다', async () => {
    const close = jest.fn();
    const handle = backStackService.push(close);
    const input = document.createElement('input');
    input.setAttribute('data-esc-cancel', '');
    document.body.appendChild(input);
    const plain = document.createElement('input');
    document.body.appendChild(plain);
    try {
      await key(input, 'Escape');
      expect(close).not.toHaveBeenCalled();
      // 표시 없는 입력칸은 버블 단계에서 창을 닫는다
      await key(plain, 'Escape');
      expect(close).toHaveBeenCalledTimes(1);
      // 입력칸이 전파를 멈추면(자동완성 닫기 등) 창은 닫히지 않는다
      plain.addEventListener('keydown', (e) => e.stopPropagation(), { once: true });
      await key(plain, 'Escape');
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      input.remove();
      plain.remove();
      handle.remove();
    }
  });

  test('스택이 비면 Esc 는 건드리지 않는다', async () => {
    const other = jest.fn();
    window.addEventListener('keydown', other);
    await key(document.body, 'Escape');
    window.removeEventListener('keydown', other);
    expect(other).toHaveBeenCalledTimes(1);
  });
});

describe('confirmViaDialog (appState.confirmAsync 본체)', () => {
  test('확인 = true, Esc = false', async () => {
    let p!: Promise<boolean>;
    await act(async () => {
      p = confirmViaDialog((d: any) => push(d), { text: '진행?' } as any);
    });
    await key(document.body, 'Enter');
    await expect(p).resolves.toBe(true);
    await act(async () => {
      p = confirmViaDialog((d: any) => push(d), { text: '진행?' } as any);
    });
    await key(document.body, 'Escape');
    await expect(p).resolves.toBe(false);
    expect(state.dialogs.length).toBe(0);
  });

  test('취소 버튼 = false, 확인 버튼 = true', async () => {
    let p!: Promise<boolean>;
    await act(async () => {
      p = confirmViaDialog((d: any) => push(d), { text: 'a' } as any);
    });
    const btn = (label: string) =>
      Array.from(document.querySelectorAll('.confirm-window button')).find(
        (b) => b.textContent === label,
      ) as HTMLButtonElement;
    await act(async () => btn('취소').click());
    await expect(p).resolves.toBe(false);
    await act(async () => {
      p = confirmViaDialog((d: any) => push(d), { text: 'b', confirmText: '삭제' } as any);
    });
    await act(async () => btn('삭제').click());
    await expect(p).resolves.toBe(true);
  });
});
