// 저장 경로 변경 안전장치(2026-11-04) — 선택 창 3분기·거부 문구·보류 표시·부팅 하위 폴더 경고 1회.
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { observable, runInAction } from 'mobx';
import {
  checkRejectText,
  normalizeRootForCompare,
  runSaveLocationChange,
  sameRoot,
  SaveLocationFlowDeps,
  showSubdirBootWarningOnce,
} from '../saveLocationChangeFlow';
import {
  SAVE_LOCATION_CHANGE_TEXT,
  SAVE_LOCATION_CHOICE,
} from '../../../shared/saveLocationChange';
import { INSIDE_INSTALL_DIR_CODE, INSTALL_DIR_TEXT } from '../../../shared/installDir';

// 보류 막대 렌더 테스트용 — 막대가 import 하는 appState·backend 를 가짜로.
const mockAppState = observable({
  saveLocationPending: null as null | { previousRoot: string; nextRoot: string },
  pushDialog: jest.fn(),
});
const mockBackend = { restartApp: jest.fn(async () => {}) };
jest.mock('../AppService', () => ({ appState: mockAppState }));
jest.mock('..', () => ({ backend: mockBackend }));

function makeDeps(over: {
  folder?: string | undefined;
  check?: { ok: boolean; code?: string; failedPath?: string };
  dataRoot?: string;
  choice?: string | undefined;
  restartFails?: boolean;
} = {}) {
  const store: { config: Record<string, any> } = { config: { other: 1 } };
  const dialogs: any[] = [];
  const asyncDialogs: any[] = [];
  const deps: SaveLocationFlowDeps = {
    backend: {
      selectDir: jest.fn(async () => ('folder' in over ? over.folder : 'D:\\New')),
      checkWritable: jest.fn(async () => over.check ?? { ok: true }),
      getDataRoot: jest.fn(async () => over.dataRoot ?? 'C:/Users/me/AppData/Roaming/SDStudio'),
      getConfig: jest.fn(async () => JSON.parse(JSON.stringify(store.config))),
      setConfig: jest.fn(async (c: any) => {
        store.config = JSON.parse(JSON.stringify(c));
      }),
      restartApp: jest.fn(async () => {
        if (over.restartFails) throw new Error('boom');
      }),
    },
    appState: {
      saveLocationPending: null,
      pushDialog: jest.fn((d: any) => dialogs.push(d)),
      pushDialogAsync: jest.fn(async (d: any) => {
        asyncDialogs.push(d);
        return over.choice;
      }),
    },
  };
  return { deps, store, dialogs, asyncDialogs };
}

describe('runSaveLocationChange', () => {
  test('폴더 선택을 취소하면 아무것도 하지 않는다', async () => {
    const { deps } = makeDeps({ folder: undefined });
    expect(await runSaveLocationChange(deps)).toEqual({ kind: 'cancelled' });
    expect(deps.backend.checkWritable).not.toHaveBeenCalled();
    expect(deps.backend.setConfig).not.toHaveBeenCalled();
  });

  test('선택 창: 안내 문구·[지금 재시작][나중에 재시작] 두 선택지(취소는 내장)', async () => {
    const { deps, asyncDialogs } = makeDeps({ choice: undefined });
    await runSaveLocationChange(deps);
    expect(deps.backend.checkWritable).toHaveBeenCalledWith('D:\\New', { dataSubdirs: true });
    expect(asyncDialogs).toHaveLength(1);
    const d = asyncDialogs[0];
    expect(d.type).toBe('select');
    expect(d.text).toContain('기존 데이터는 자동으로 옮겨지지 않습니다');
    expect(d.text).toContain('전체 백업');
    expect(d.text).toContain('재시작하기 전까지는 이전 위치에 계속 저장됩니다');
    expect(d.text).toContain('D:\\New');
    expect(d.text).toContain('C:/Users/me/AppData/Roaming/SDStudio');
    expect(d.items.map((i: any) => i.text)).toEqual(['지금 재시작', '나중에 재시작']);
    expect(d.danger).toBeUndefined();
  });

  test('취소(Esc·내장 취소) = 저장·보류·재시작 모두 없음', async () => {
    const { deps } = makeDeps({ choice: undefined });
    expect(await runSaveLocationChange(deps)).toEqual({ kind: 'cancelled' });
    expect(deps.backend.setConfig).not.toHaveBeenCalled();
    expect(deps.backend.restartApp).not.toHaveBeenCalled();
    expect(deps.appState.saveLocationPending).toBeNull();
  });

  test('나중에 재시작 = 저장(다른 설정 유지) + 보류 상태, 재시작 없음', async () => {
    const { deps, store } = makeDeps({ choice: SAVE_LOCATION_CHOICE.restartLater });
    expect(await runSaveLocationChange(deps)).toEqual({ kind: 'pending', folder: 'D:\\New' });
    expect(store.config).toEqual({ other: 1, saveLocation: 'D:\\New' });
    expect(deps.backend.restartApp).not.toHaveBeenCalled();
    expect(deps.appState.saveLocationPending).toEqual({
      previousRoot: 'C:/Users/me/AppData/Roaming/SDStudio',
      nextRoot: 'D:\\New',
    });
  });

  test('지금 재시작 = 저장 뒤 restartApp', async () => {
    const { deps, store } = makeDeps({ choice: SAVE_LOCATION_CHOICE.restartNow });
    const order: string[] = [];
    (deps.backend.setConfig as jest.Mock).mockImplementation(async (c: any) => {
      order.push('save');
      store.config = c;
    });
    (deps.backend.restartApp as jest.Mock).mockImplementation(async () => {
      order.push('restart');
    });
    expect(await runSaveLocationChange(deps)).toEqual({ kind: 'restarting', folder: 'D:\\New' });
    expect(order).toEqual(['save', 'restart']);
    expect(store.config.saveLocation).toBe('D:\\New');
  });

  test('지금 재시작이 실패하면 안내하고 보류 상태로 남는다', async () => {
    const { deps, dialogs } = makeDeps({ choice: SAVE_LOCATION_CHOICE.restartNow, restartFails: true });
    expect(await runSaveLocationChange(deps)).toEqual({ kind: 'pending', folder: 'D:\\New' });
    expect(dialogs[0].text).toContain('다시 시작하지 못했습니다');
    expect(deps.appState.saveLocationPending?.nextRoot).toBe('D:\\New');
  });

  test('하위 폴더 쓰기 실패 → 폴더·코드를 보여 주고 거부(선택 창·저장 없음)', async () => {
    const { deps, dialogs, asyncDialogs } = makeDeps({
      check: { ok: false, code: 'EACCES', failedPath: 'D:\\New\\outs\\A' },
    });
    expect(await runSaveLocationChange(deps)).toEqual({ kind: 'rejected' });
    expect(dialogs[0].type).toBe('yes-only');
    expect(dialogs[0].text).toContain('D:\\New\\outs\\A');
    expect(dialogs[0].text).toContain('EACCES');
    expect(asyncDialogs).toHaveLength(0);
    expect(deps.backend.setConfig).not.toHaveBeenCalled();
  });

  test('지금 쓰는 위치를 다시 고르면 저장만 하고 보류를 푼다(재시작 묻지 않음)', async () => {
    const { deps, asyncDialogs, dialogs } = makeDeps({ folder: 'c:\\users\\me\\appdata\\roaming\\SDStudio\\' });
    deps.appState.saveLocationPending = { previousRoot: 'x', nextRoot: 'y' };
    const r = await runSaveLocationChange(deps);
    expect(r.kind).toBe('same');
    expect(asyncDialogs).toHaveLength(0);
    expect(deps.appState.saveLocationPending).toBeNull();
    expect(dialogs[0].text).toBe(SAVE_LOCATION_CHANGE_TEXT.sameAsCurrent);
  });
});

test('checkRejectText: 설치 폴더·하위 폴더·루트 실패 문구', () => {
  expect(checkRejectText({ ok: true })).toBeNull();
  expect(checkRejectText({ ok: false, code: INSIDE_INSTALL_DIR_CODE })).toBe(INSTALL_DIR_TEXT.selectRejected);
  expect(checkRejectText({ ok: false, code: 'EPERM', failedPath: '/x/outs' })).toBe(
    SAVE_LOCATION_CHANGE_TEXT.subdirNotWritable('/x/outs', 'EPERM'),
  );
  expect(checkRejectText({ ok: false, code: 'EPERM' })).toBe(SAVE_LOCATION_CHANGE_TEXT.notWritable('EPERM'));
});

test('경로 비교: Windows 식은 대소문자·구분자·끝 구분자 무시, posix 는 대소문자 구분', () => {
  expect(sameRoot('C:\\A\\B\\', 'c:/a/b')).toBe(true);
  expect(sameRoot('/home/A', '/home/a')).toBe(false);
  expect(sameRoot('/home/a/', '/home/a')).toBe(true);
  expect(sameRoot('', '')).toBe(false);
  expect(normalizeRootForCompare('D:\\')).toBe('d:/');
});

test('부팅 하위 폴더 경고는 부팅 완료 뒤 한 번만', () => {
  const state = {
    bootReady: false,
    saveLocationSubdirWarning: { path: 'D:\\Data\\outs\\A', code: 'EACCES' } as any,
    pushDialog: jest.fn(),
  };
  expect(showSubdirBootWarningOnce(state)).toBe(false);
  state.bootReady = true;
  expect(showSubdirBootWarningOnce(state)).toBe(true);
  expect(showSubdirBootWarningOnce(state)).toBe(false);
  expect(state.pushDialog).toHaveBeenCalledTimes(1);
  expect(state.pushDialog.mock.calls[0][0]).toEqual({
    type: 'yes-only',
    text: SAVE_LOCATION_CHANGE_TEXT.bootSubdirWarning('D:\\Data\\outs\\A', 'EACCES'),
  });
  expect(state.saveLocationSubdirWarning).toBeNull();
});

describe('SaveLocationPendingBar', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    runInAction(() => {
      mockAppState.saveLocationPending = null;
    });
  });

  test('보류 중에만 보이고, 「지금 재시작」이 restartApp 을 부른다', async () => {
    const { default: Bar } = await import('../../componenets/SaveLocationPendingBar');
    await act(async () => {
      root.render(<Bar />);
    });
    expect(container.querySelector('[data-save-location-pending-bar]')).toBeNull();
    await act(async () => {
      runInAction(() => {
        mockAppState.saveLocationPending = { previousRoot: 'C:\\Old', nextRoot: 'D:\\New' };
      });
    });
    const bar = container.querySelector('[data-save-location-pending-bar]');
    expect(bar?.textContent).toContain(SAVE_LOCATION_CHANGE_TEXT.pendingNotice('C:\\Old'));
    const btn = container.querySelector('[data-save-location-restart]') as HTMLButtonElement;
    await act(async () => {
      btn.click();
    });
    expect(mockBackend.restartApp).toHaveBeenCalledTimes(1);
  });
});
