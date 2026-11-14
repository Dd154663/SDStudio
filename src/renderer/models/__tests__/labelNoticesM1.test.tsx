// 2026-11-12 오버레이 정비 M1 「라벨·안내 즉시 정비」 — 즐겨찾기 빈 칸 안내, 그림체(글로벌) 프리셋 편집 중복 이름 문구.
// (되돌리기 라벨 U1~U5 는 undoPreset.test.ts, 내보내기 안내·중복 거부는 exportSettingsUi.test.tsx)
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';

const state: any = { pushMessage: jest.fn() };
jest.mock('../AppService', () => ({ appState: state }));
jest.mock('../BackStackService', () => ({ useBackLayer: () => {} }));
jest.mock('../../componenets/backdropClose', () => ({
  useBackdropClose: () => ({}),
  useGuardedClose: (_dirty: () => boolean, onClose: () => void) => onClose,
}));
jest.mock('../../componenets/ActionIcon', () => ({ ActionIcon: () => null }));
jest.mock('../../componenets/PromptEditTextArea', () => () => null);
jest.mock('../../componenets/UtilComponents', () => ({ FileUploadBase64: () => null }));
jest.mock('../../backends/imageGen', () => ({
  Sampling: { KEulerAncestral: 'k_euler_ancestral' },
  NoiseSchedule: { Karras: 'karras' },
}));

import { BookmarkDialog } from '../../componenets/EmbeddedBrowser';
import { PresetEditModal } from '../../componenets/PresetEditModal';
import { NAME_INPUT_TEXT } from '../nameInput';

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (global as any).IS_REACT_ACT_ENVIRONMENT = true;
  state.pushMessage = jest.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const button = (text: string) =>
  Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === text) as HTMLButtonElement;

describe('즐겨찾기 추가/편집 — 빈 칸 안내', () => {
  test('이름·URL 이 비면 칸 이름 토스트, 확정 안 함·창 유지', async () => {
    const onConfirm = jest.fn();
    const onClose = jest.fn();
    await act(async () =>
      root.render(<BookmarkDialog mode="add" initialLabel="" initialUrl="" onConfirm={onConfirm} onClose={onClose} />),
    );
    act(() => button('추가').click());
    expect(state.pushMessage).toHaveBeenLastCalledWith('다음 칸을 확인해 주세요: 이름, URL', 'error');
    const [labelInput, urlInput] = Array.from(container.querySelectorAll('input'));
    act(() => Simulate.change(labelInput, { target: { value: '사이트' } } as any));
    act(() => button('추가').click());
    expect(state.pushMessage).toHaveBeenLastCalledWith('다음 칸을 확인해 주세요: URL', 'error');
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    act(() => Simulate.change(urlInput, { target: { value: ' https://a.b ' } } as any));
    act(() => button('추가').click());
    expect(onConfirm).toHaveBeenCalledWith('사이트', 'https://a.b');
  });

  test('편집에서 이름만 지우면 「이름」 안내', async () => {
    const onConfirm = jest.fn();
    await act(async () =>
      root.render(<BookmarkDialog mode="edit" initialLabel="A" initialUrl="https://a" onConfirm={onConfirm} onClose={() => {}} />),
    );
    act(() => Simulate.change(container.querySelector('input')!, { target: { value: '  ' } } as any));
    act(() => button('저장').click());
    expect(state.pushMessage).toHaveBeenLastCalledWith('다음 칸을 확인해 주세요: 이름', 'error');
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('글로벌 프리셋 편집 — 중복 이름 문구', () => {
  const render = async (save: jest.Mock, onClose = jest.fn()) => {
    await act(async () =>
      root.render(
        <PresetEditModal
          title="글로벌 프리셋 편집"
          initialName="A"
          preset={{}}
          adapter={{ fetchProfile: async () => null, save }}
          onClose={onClose}
        />,
      ),
    );
    return onClose;
  };

  test('서비스의 「이미 존재하는 이름입니다」 → 공용 중복 문구, 창 유지', async () => {
    const save = jest.fn(async () => {
      throw new Error('이미 존재하는 이름입니다');
    });
    const onClose = await render(save);
    const nameInput = container.querySelector('input')!;
    act(() => Simulate.change(nameInput, { target: { value: ' B ' } } as any));
    await act(async () => button('저장').click());
    expect(save).toHaveBeenCalledWith('B', expect.any(Object), null);
    expect(state.pushMessage).toHaveBeenLastCalledWith(NAME_INPUT_TEXT.duplicate('globalPreset', 'B'), 'error');
    expect(state.pushMessage).toHaveBeenLastCalledWith('같은 이름의 글로벌 프리셋이 이미 있습니다: B', 'error');
    expect(onClose).not.toHaveBeenCalled();
  });

  test('다른 실패 문구는 그대로', async () => {
    const save = jest.fn(async () => {
      throw new Error('프리셋을 찾을 수 없습니다');
    });
    await render(save);
    await act(async () => button('저장').click());
    expect(state.pushMessage).toHaveBeenLastCalledWith('프리셋을 찾을 수 없습니다', 'error');
  });
});
