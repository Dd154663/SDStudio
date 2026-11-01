/** @jest-environment jsdom */
// 되돌리기 단축키 판정·FloatView 허용 창 장부 — 2026-11-01 U1 (D9·D10·D11)
const mockAppState = {
  imageGridFocusable: false,
  resultViewerOpen: false,
  dialogs: [] as unknown[],
  floatViewCount: 0,
  undoFloatViewCount: 0,
  genControlOverlayCount: 0,
  configScreenOpen: false,
  pieceEditorOpen: false,
  findReplaceOpen: false,
  uiFloatViewMode: 'center',
  incrementFloatView() {
    this.floatViewCount++;
  },
  decrementFloatView() {
    this.floatViewCount = Math.max(0, this.floatViewCount - 1);
  },
  incrementUndoFloatView() {
    this.undoFloatViewCount++;
  },
  decrementUndoFloatView() {
    this.undoFloatViewCount = Math.max(0, this.undoFloatViewCount - 1);
  },
  incrementGenControlOverlay() {
    this.genControlOverlayCount++;
  },
  decrementGenControlOverlay() {
    this.genControlOverlayCount = Math.max(0, this.genControlOverlayCount - 1);
  },
};
jest.mock('../AppService', () => ({ appState: mockAppState }));
jest.mock('..', () => ({ isMobile: true })); // 모듈 평가 때 전역 설치를 막는다(테스트가 인스턴스를 직접 만든다)
jest.mock('../BackStackService', () => ({
  backStackService: { init: () => {}, push: () => ({ remove: () => {} }) },
}));
jest.mock('../../componenets/backdropClose', () => ({ confirmDiscardChanges: async () => true }));

import React from 'react';
import { render } from '@testing-library/react';
import {
  isShortcutActionActive,
  KeyboardShortcutService,
  ShortcutAction,
  ShortcutGateState,
} from '../KeyboardShortcutService';
import { FloatView, FloatViewProvider } from '../../componenets/FloatView';

const base: ShortcutGateState = {
  imageGridFocusable: false,
  resultViewerOpen: false,
  dialogCount: 0,
  floatViewCount: 0,
  undoFloatViewCount: 0,
  configScreenOpen: false,
  pieceEditorOpen: false,
  findReplaceOpen: false,
};

const svc = new KeyboardShortcutService();
const actionOf = (id: string) => svc.getAllActions().find((a) => a.id === id) as ShortcutAction;

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  mockAppState.dialogs = [];
  mockAppState.floatViewCount = 0;
  mockAppState.undoFloatViewCount = 0;
});

describe('undo·redo 액션 등록(D11=C)', () => {
  test('전역 범주에 Ctrl+Z·Ctrl+Y 두 개만, Ctrl+Shift+Z 미등록', () => {
    const undo = actionOf('undo');
    const redo = actionOf('redo');
    expect([undo.category, undo.defaultKey, undo.allowInFloatView]).toEqual(['global', 'Ctrl+Z', true]);
    expect([redo.category, redo.defaultKey, redo.allowInFloatView]).toEqual(['global', 'Ctrl+Y', true]);
    expect(svc.getAllActions().filter((a) => a.currentKey === 'Ctrl+Shift+Z')).toEqual([]);
    // 같은 범위(main)에서 다른 액션과 겹치지 않는다
    expect(svc.findConflict('Ctrl+Z', 'undo')).toBeUndefined();
    expect(svc.findConflict('Ctrl+Y', 'redo')).toBeUndefined();
  });
});

describe('isShortcutActionActive — FloatView 예외', () => {
  const undo = () => actionOf('undo');
  test('창 없음 = 통과, 허용 창만 열림 = 통과', () => {
    expect(isShortcutActionActive(undo(), base)).toBe(true);
    expect(isShortcutActionActive(undo(), { ...base, floatViewCount: 1, undoFloatViewCount: 1 })).toBe(true);
    expect(isShortcutActionActive(undo(), { ...base, floatViewCount: 2, undoFloatViewCount: 2 })).toBe(true);
  });
  test('비허용 창(인페인트 편집 창 등)이 하나라도 섞이면 억제', () => {
    expect(isShortcutActionActive(undo(), { ...base, floatViewCount: 1, undoFloatViewCount: 0 })).toBe(false);
    expect(isShortcutActionActive(undo(), { ...base, floatViewCount: 3, undoFloatViewCount: 2 })).toBe(false);
  });
  test('대화상자·설정 화면·조각 편집기·찾기/바꾸기 열림이면 억제', () => {
    for (const patch of [
      { dialogCount: 1 },
      { configScreenOpen: true },
      { pieceEditorOpen: true },
      { findReplaceOpen: true },
    ]) {
      expect(isShortcutActionActive(undo(), { ...base, floatViewCount: 1, undoFloatViewCount: 1, ...patch })).toBe(
        false,
      );
      expect(isShortcutActionActive(undo(), { ...base, ...patch })).toBe(false);
    }
  });
  test('다른 전역·씬 액션은 허용 창이 열려 있어도 예전처럼 억제', () => {
    const allowed = { ...base, floatViewCount: 1, undoFloatViewCount: 1 };
    expect(isShortcutActionActive(actionOf('tab-1'), allowed)).toBe(false);
    expect(isShortcutActionActive(actionOf('scene-left'), allowed)).toBe(false);
    expect(isShortcutActionActive(actionOf('tab-1'), base)).toBe(true);
  });
});

describe('handleKeyDown — 입력 포커스 억제(D2)', () => {
  const fire = () => {
    const got: string[] = [];
    const h = (e: Event) => got.push((e as CustomEvent).detail.action);
    window.addEventListener('shortcut-action', h);
    const ev = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    svc.handleKeyDown(ev);
    window.removeEventListener('shortcut-action', h);
    return { got, prevented: ev.defaultPrevented };
  };
  test('입력 칸 밖 = undo 발송, 입력 칸 포커스 = 발송 없음(편집기 자체 이력)', () => {
    expect(fire()).toEqual({ got: ['undo'], prevented: true });
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    expect(fire()).toEqual({ got: [], prevented: false });
  });
  test('허용 창만 열림 = 발송, 비허용 창 = 발송 없음', () => {
    mockAppState.floatViewCount = 1;
    mockAppState.undoFloatViewCount = 1;
    expect(fire().got).toEqual(['undo']);
    mockAppState.undoFloatViewCount = 0;
    expect(fire().got).toEqual([]);
  });
});

describe('FloatView allowUndo 장부', () => {
  test('허용 창만 undoFloatViewCount 에 세고, 닫으면 되돌린다', () => {
    const view = render(
      <FloatViewProvider>
        <FloatView priority={2} allowUndo>
          <div>씬 편집</div>
        </FloatView>
        <FloatView priority={3}>
          <div>인페인트</div>
        </FloatView>
      </FloatViewProvider>,
    );
    expect(mockAppState.floatViewCount).toBe(2);
    expect(mockAppState.undoFloatViewCount).toBe(1);
    view.rerender(
      <FloatViewProvider>
        <FloatView priority={2} allowUndo>
          <div>씬 편집</div>
        </FloatView>
      </FloatViewProvider>,
    );
    expect(mockAppState.floatViewCount).toBe(1);
    expect(mockAppState.undoFloatViewCount).toBe(1);
    view.unmount();
    expect(mockAppState.floatViewCount).toBe(0);
    expect(mockAppState.undoFloatViewCount).toBe(0);
  });
});
