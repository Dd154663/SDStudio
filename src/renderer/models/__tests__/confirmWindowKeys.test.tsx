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
import {
  confirmViaDialog,
  confirmEnterAction,
  isCancelLikeItem,
  withoutCancelLikeItems,
} from '../confirmKeys';

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
  test('위험도: 없음·true 는 Enter=확인, permanent 만 Enter 무시(D1)', () => {
    expect(confirmEnterAction('confirm', { danger: false })).toBe('confirm');
    expect(confirmEnterAction('confirm', { danger: true })).toBe('confirm');
    expect(confirmEnterAction('confirm', { danger: 'permanent' })).toBe('ignore');
    // permanent 여도 IME·창 안 버튼은 종전대로 양보
    expect(confirmEnterAction('confirm', { danger: 'permanent', onDialogButton: true })).toBe('pass');
  });
});

describe('내장 취소 단일화(D3)', () => {
  test('「취소」류 항목 판정', () => {
    expect(isCancelLikeItem({ text: '취소', value: 'x' })).toBe(true);
    expect(isCancelLikeItem({ text: ' 나중에 ', value: 'x' })).toBe(true);
    expect(isCancelLikeItem({ text: '닫기', value: 'x' })).toBe(true);
    expect(isCancelLikeItem({ text: '아니요', value: 'x' })).toBe(true);
    expect(isCancelLikeItem({ text: '무엇이든', value: 'cancel' })).toBe(true);
    expect(isCancelLikeItem({ text: '취소된 항목 보기', value: 'x' })).toBe(false);
    expect(isCancelLikeItem({ text: '거절', value: 'decline' })).toBe(false);
    const items = [{ text: 'A', value: 'a' }];
    expect(withoutCancelLikeItems(items)).toBe(items);
    expect(withoutCancelLikeItems(undefined)).toEqual([]);
  });

  test('select: 「취소」 항목은 그리지 않고 경고, 내장 취소 하나만(cancelText 적용)', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const onCancel = jest.fn();
      await act(async () =>
        push({
          type: 'select',
          text: '고르세요',
          items: [
            { text: 'A', value: 'a' },
            { text: '취소', value: 'cancel' },
          ],
          cancelText: '나중에',
          onCancel,
        }),
      );
      const labels = Array.from(document.querySelectorAll('.confirm-window button')).map(
        (b) => b.textContent,
      );
      expect(labels).toEqual(['A', '나중에']);
      expect(warn).toHaveBeenCalledTimes(1);
      const later = Array.from(document.querySelectorAll('.confirm-window button')).find(
        (b) => b.textContent === '나중에',
      ) as HTMLButtonElement;
      await act(async () => later.click());
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(state.dialogs.length).toBe(0);
    } finally {
      warn.mockRestore();
    }
  });

  test('select: danger 항목만 빨강', async () => {
    await act(async () =>
      push({
        type: 'select',
        text: '처리 방식',
        items: [
          { text: '건너뛰기', value: 'skip' },
          { text: '덮어쓰기', value: 'overwrite', danger: true },
        ],
      }),
    );
    const btn = (label: string) =>
      Array.from(document.querySelectorAll('.confirm-window button')).find(
        (b) => b.textContent === label,
      ) as HTMLButtonElement;
    expect(btn('건너뛰기').className).toContain('back-sky');
    expect(btn('덮어쓰기').className).toContain('back-red');
  });
});

describe('ConfirmWindow 위험도 표시·Enter(D1)', () => {
  const confirmButton = () =>
    document.querySelector('.confirm-window button') as HTMLButtonElement;

  test('기본 confirm 은 중립 파랑, danger 면 빨강 — [확인][취소] 순서', async () => {
    await act(async () => push({ type: 'confirm', text: '진행?' }));
    expect(confirmButton().className).toContain('back-sky');
    expect(
      Array.from(document.querySelectorAll('.confirm-window button')).map((b) => b.textContent),
    ).toEqual(['확인', '취소']);
    await key(document.body, 'Escape');
    await act(async () => push({ type: 'confirm', text: '삭제?', danger: true }));
    expect(confirmButton().className).toContain('back-red');
  });

  test("danger: 'permanent' 는 Enter 로 확정하지 않는다(창 유지, 아래로 새지 않음) — 버튼은 동작", async () => {
    const callback = jest.fn();
    await act(async () =>
      push({
        type: 'confirm',
        text: '영구 삭제?',
        danger: 'permanent',
        confirmText: '영구 삭제',
        callback,
      }),
    );
    expect(confirmButton().className).toContain('back-red');
    const leak = jest.fn();
    window.addEventListener('keydown', leak);
    await key(document.body, 'Enter');
    window.removeEventListener('keydown', leak);
    expect(callback).not.toHaveBeenCalled();
    expect(leak).not.toHaveBeenCalled();
    expect(state.dialogs.length).toBe(1);
    await act(async () => confirmButton().click());
    expect(callback).toHaveBeenCalledTimes(1);
    expect(state.dialogs.length).toBe(0);
  });

  test('requireClick: 중립(파랑)이어도 Enter 무시, 버튼 클릭으로만 확정', async () => {
    expect(confirmEnterAction('confirm', { requireClick: true })).toBe('ignore');
    const callback = jest.fn();
    await act(async () =>
      push({ type: 'confirm', text: 'Anlas 소비?', requireClick: true, callback }),
    );
    expect(confirmButton().className).toContain('back-sky');
    await key(document.body, 'Enter');
    expect(callback).not.toHaveBeenCalled();
    expect(state.dialogs.length).toBe(1);
    await act(async () => confirmButton().click());
    expect(callback).toHaveBeenCalledTimes(1);
    expect(state.dialogs.length).toBe(0);
  });

  test('danger: true 는 Enter = 확인 유지', async () => {
    const callback = jest.fn();
    await act(async () => push({ type: 'confirm', text: '휴지통으로?', danger: true, callback }));
    await key(document.body, 'Enter');
    expect(callback).toHaveBeenCalledTimes(1);
  });

  test('확인 콜백이 새 창을 쌓으면 그 창이 맨 위에 남는다(pop → callback 순서)', async () => {
    await act(async () =>
      push({
        type: 'confirm',
        text: '1차',
        callback: () => push({ type: 'confirm', text: '2차' }),
      }),
    );
    await key(document.body, 'Enter');
    expect(state.dialogs.length).toBe(1);
    expect(state.dialogs[0].text).toBe('2차');
    await key(document.body, 'Escape');
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

describe('입력 검증 validate(D2 이름 입력 규칙)', () => {
  const textInput = () =>
    document.querySelector('.confirm-window input[type="text"]') as HTMLInputElement;
  const okButton = () =>
    Array.from(document.querySelectorAll('.confirm-window button')).find(
      (b) => b.textContent === '확인',
    ) as HTMLButtonElement;
  const setInput = (el: HTMLInputElement | HTMLTextAreaElement, value: string) =>
    act(async () => {
      const proto = Object.getPrototypeOf(el);
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });

  test('오류면 창을 닫지 않고 입력칸 아래에 표시·입력 보존, 고치면 오류가 지워지고 확인 = 콜백', async () => {
    const callback = jest.fn();
    const validate = jest.fn((v: string) => (v === 'bad' ? '쓸 수 없는 이름' : null));
    await act(async () =>
      push({ type: 'input-confirm', text: '이름', inputValue: 'bad', validate, callback }),
    );
    await key(textInput(), 'Enter');
    expect(validate).toHaveBeenCalledWith('bad');
    expect(callback).not.toHaveBeenCalled();
    expect(state.dialogs.length).toBe(1);
    expect(textInput().value).toBe('bad');
    expect(document.querySelector('[data-input-error]')?.textContent).toBe('쓸 수 없는 이름');
    expect(document.activeElement).toBe(textInput());
    await setInput(textInput(), 'good');
    expect(document.querySelector('[data-input-error]')).toBeNull();
    await act(async () => okButton().click());
    expect(callback).toHaveBeenCalledWith('good', '이름');
    expect(state.dialogs.length).toBe(0);
  });

  test('비동기 검증 중에는 [확인]·Enter 중복을 막는다', async () => {
    const callback = jest.fn();
    let release!: (v: string | null) => void;
    const validate = jest.fn(
      () => new Promise<string | null>((resolve) => (release = resolve)),
    );
    await act(async () =>
      push({ type: 'input-confirm', text: '이름', inputValue: 'a', validate, callback }),
    );
    await key(textInput(), 'Enter');
    expect(okButton().disabled).toBe(true);
    await key(textInput(), 'Enter');
    await act(async () => okButton().click());
    expect(validate).toHaveBeenCalledTimes(1);
    await act(async () => release(null));
    expect(callback).toHaveBeenCalledTimes(1);
    expect(state.dialogs.length).toBe(0);
  });

  test('검증 중 Esc 로 취소하면 결과가 와도 콜백을 부르지 않는다', async () => {
    const callback = jest.fn();
    const onCancel = jest.fn();
    let release!: (v: string | null) => void;
    const validate = () => new Promise<string | null>((resolve) => (release = resolve));
    await act(async () =>
      push({ type: 'input-confirm', text: '이름', inputValue: 'a', validate, callback, onCancel }),
    );
    await key(textInput(), 'Enter');
    await key(document.body, 'Escape');
    expect(onCancel).toHaveBeenCalledTimes(1);
    await act(async () => release(null));
    expect(callback).not.toHaveBeenCalled();
    expect(state.dialogs.length).toBe(0);
  });

  test('textarea-confirm 도 버튼 확인 때 검증(창 유지·오류 표시)', async () => {
    const callback = jest.fn();
    await act(async () =>
      push({
        type: 'textarea-confirm',
        text: '여러 이름',
        validate: (v: string) => (v.includes('x') ? '2번째 줄 — 안 됨' : null),
        callback,
      }),
    );
    const ta = document.querySelector('.confirm-window textarea') as HTMLTextAreaElement;
    await setInput(ta, 'a\nx');
    await act(async () => okButton().click());
    expect(callback).not.toHaveBeenCalled();
    expect(document.querySelector('[data-input-error]')?.textContent).toBe('2번째 줄 — 안 됨');
    expect(ta.value).toBe('a\nx');
    await setInput(ta, 'a\nb');
    await act(async () => okButton().click());
    expect(callback).toHaveBeenCalledWith('a\nb', '여러 이름');
  });
});
