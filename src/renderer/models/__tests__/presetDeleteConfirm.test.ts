// 그림체(사전 세팅) 삭제 확인의 「이번 세션에서 다시 묻지 않음」(2026-11-22) — models/presetDeleteConfirm.ts
// 체크 후 확인 → 다음 삭제는 확인 없이 / 체크 없이 확인 → 다음에도 확인 / 취소 → 플래그 불변 /
// 이미지 삭제 플래그와 분리 / 범위(개수 무관 — 이미지 삭제와 같음) / 호출부 세 곳.
import fs from 'fs';
import path from 'path';

const dialogs: any[] = [];
const appState: any = {
  skipPresetDeleteConfirm: false,
  skipImageDeleteConfirm: false,
  pushDialog: jest.fn((d: any) => dialogs.push(d)),
};
jest.mock('../AppService', () => ({ appState }));

import { confirmPresetDelete } from '../presetDeleteConfirm';
import {
  deleteConfirmText,
  shouldSkipImageDeleteConfirm,
  shouldSkipPresetDeleteConfirm,
  SKIP_DELETE_CONFIRM_LABEL,
} from '../deleteFlowRules';

const ROOT = path.join(__dirname, '..', '..');
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

beforeEach(() => {
  dialogs.length = 0;
  appState.skipPresetDeleteConfirm = false;
  appState.skipImageDeleteConfirm = false;
  jest.clearAllMocks();
});

/** 맨 위 확인 창을 [삭제]로 닫는다(ConfirmWindow 와 같이 pop 뒤 콜백). */
const confirmTop = async () => {
  const d = dialogs.pop();
  await d.callback();
};
/** 맨 위 확인 창을 취소·Esc 로 닫는다(콜백 없음). */
const cancelTop = () => {
  const d = dialogs.pop();
  d.onCancel?.();
};

describe('확인 창', () => {
  test('문구·위험도 = deleteConfirmText(undoable), 체크 라벨 = 공용 상수', () => {
    const run = jest.fn();
    confirmPresetDelete({ kind: 'style', name: '수채화' }, run);
    expect(dialogs).toHaveLength(1);
    const d = dialogs[0];
    expect(d.type).toBe('confirm');
    const t = deleteConfirmText({ kind: 'style', name: '수채화', outcome: 'undoable' });
    expect(d.text).toBe(t.text);
    expect(d.confirmText).toBe(t.confirmText);
    expect(d.danger).toBe('permanent');
    expect(d.confirmCheck.label).toBe(SKIP_DELETE_CONFIRM_LABEL);
    expect(SKIP_DELETE_CONFIRM_LABEL).toBe('이번 세션에서 다시 묻지 않음');
    // 이미지 삭제 체크(showSkipConfirm)와 한 창에 같이 쓰지 않는다
    expect(d.showSkipConfirm).toBeUndefined();
    expect(run).not.toHaveBeenCalled();
  });

  test('체크 후 확인 → 삭제하고, 다음 삭제는 확인 없이 진행', async () => {
    const run1 = jest.fn();
    confirmPresetDelete({ kind: 'style', name: 'A' }, run1);
    dialogs[0].confirmCheck.onChange(true);
    await confirmTop();
    expect(run1).toHaveBeenCalledTimes(1);
    expect(appState.skipPresetDeleteConfirm).toBe(true);

    const run2 = jest.fn();
    confirmPresetDelete({ kind: 'style', name: 'B' }, run2);
    expect(dialogs).toHaveLength(0);
    expect(run2).toHaveBeenCalledTimes(1);
  });

  test('체크 없이 확인 → 삭제하고, 다음에도 확인', async () => {
    const run1 = jest.fn();
    confirmPresetDelete({ kind: 'style', name: 'A' }, run1);
    await confirmTop();
    expect(run1).toHaveBeenCalledTimes(1);
    expect(appState.skipPresetDeleteConfirm).toBe(false);

    const run2 = jest.fn();
    confirmPresetDelete({ kind: 'style', name: 'B' }, run2);
    expect(dialogs).toHaveLength(1);
    expect(run2).not.toHaveBeenCalled();
  });

  test('체크했다가 끄고 확인 → 플래그 꺼짐 그대로', async () => {
    confirmPresetDelete({ kind: 'style', name: 'A' }, jest.fn());
    dialogs[0].confirmCheck.onChange(true);
    dialogs[0].confirmCheck.onChange(false);
    await confirmTop();
    expect(appState.skipPresetDeleteConfirm).toBe(false);
  });

  test('체크하고 취소 → 삭제 안 함, 플래그 불변', () => {
    const run = jest.fn();
    confirmPresetDelete({ kind: 'style', name: 'A' }, run);
    dialogs[0].confirmCheck.onChange(true);
    cancelTop();
    expect(run).not.toHaveBeenCalled();
    expect(appState.skipPresetDeleteConfirm).toBe(false);
  });
});

describe('이미지 삭제 플래그와 분리', () => {
  test('이미지 「다시 묻지 않음」이 켜져 있어도 그림체 삭제는 묻는다', () => {
    appState.skipImageDeleteConfirm = true;
    const run = jest.fn();
    confirmPresetDelete({ kind: 'style', name: 'A' }, run);
    expect(dialogs).toHaveLength(1);
    expect(run).not.toHaveBeenCalled();
  });
  test('그림체 플래그를 켜도 이미지 플래그는 그대로', async () => {
    confirmPresetDelete({ kind: 'style', name: 'A' }, jest.fn());
    dialogs[0].confirmCheck.onChange(true);
    await confirmTop();
    expect(appState.skipPresetDeleteConfirm).toBe(true);
    expect(appState.skipImageDeleteConfirm).toBe(false);
    expect(shouldSkipImageDeleteConfirm(appState.skipImageDeleteConfirm, 1)).toBe(false);
  });
  test('ConfirmWindow 의 이미지 체크는 이미지 플래그만 켠다', () => {
    const cw = read('componenets/ConfirmWindow.tsx');
    expect(cw).toContain('appState.skipImageDeleteConfirm = true;');
    expect(cw).not.toContain('skipPresetDeleteConfirm');
    expect(cw).toContain('{SKIP_DELETE_CONFIRM_LABEL}');
  });
});

describe('적용 범위 — 이미지 삭제처럼 개수와 무관', () => {
  test('판정', () => {
    expect(shouldSkipPresetDeleteConfirm(false, 1)).toBe(false);
    expect(shouldSkipPresetDeleteConfirm(true, 1)).toBe(true);
    expect(shouldSkipPresetDeleteConfirm(true, 5)).toBe(true);
    expect(shouldSkipPresetDeleteConfirm(true, 0)).toBe(false);
  });
  test('일괄 삭제(사전 세팅 N개)도 체크를 내고, 켜져 있으면 확인 없이', async () => {
    const run = jest.fn();
    confirmPresetDelete({ kind: 'preset', count: 3 }, run);
    expect(dialogs[0].text).toBe(deleteConfirmText({ kind: 'preset', count: 3, outcome: 'undoable' }).text);
    expect(dialogs[0].confirmCheck).toBeDefined();
    dialogs[0].confirmCheck.onChange(true);
    await confirmTop();
    const run2 = jest.fn();
    confirmPresetDelete({ kind: 'preset', count: 2 }, run2);
    expect(dialogs).toHaveLength(0);
    expect(run2).toHaveBeenCalledTimes(1);
  });
  test('범위 밖(글로벌 프리셋 삭제)은 이 플래그를 보지 않는다 — 늘 확인', () => {
    expect(read('componenets/GlobalPresetTab.tsx')).not.toContain('skipPresetDeleteConfirm');
    expect(read('componenets/GlobalPresetTab.tsx')).not.toContain('confirmPresetDelete');
  });
});

describe('호출부 세 곳(줄 버튼·우클릭·일괄 삭제 창)', () => {
  test('모두 confirmPresetDelete 를 거치고, 차단 검사는 확인 전에 그대로', () => {
    const pse = read('componenets/PreSetEdtior.tsx');
    expect(pse.split('confirmPresetDelete(').length - 1).toBe(2);
    expect(pse).toContain("confirmPresetDelete({ kind: 'style', name: option.name }, () => {");
    expect(pse).toContain("confirmPresetDelete({ kind: 'preset', count: selected.size }, () => {");
    // 기존 차단: 마지막 하나·최소 1개 남김
    expect(pse.indexOf("'마지막 사전 세팅은 삭제할 수 없습니다'")).toBeLessThan(
      pse.indexOf("confirmPresetDelete({ kind: 'style'"),
    );
    expect(pse.indexOf("'최소 1개의 사전 세팅은 남겨야 합니다'")).toBeLessThan(
      pse.indexOf("confirmPresetDelete({ kind: 'preset'"),
    );
    // 되돌리기 기록 그대로
    expect(pse).toContain('editPresetList(curSession, UNDO_TEXT.presetRemove([option.name])');
    expect(pse).toContain('editPresetList(curSession, UNDO_TEXT.presetRemove(names)');

    const menu = read('componenets/AppContextMenu.tsx');
    const del = menu.slice(menu.indexOf('const deleteStyle = async'), menu.indexOf('const editStyle = async'));
    expect(del).toContain("confirmPresetDelete({ kind: 'style', name: ctx.preset.name }, () => {");
    expect(del.indexOf('before.length <= 1')).toBeLessThan(del.indexOf('confirmPresetDelete('));
    // 확인 창 사이 다시 보기도 그대로
    expect(del).toContain('if (presets.length <= 1)');
    expect(del).toContain('editPresetList(curSession, UNDO_TEXT.presetRemove([ctx.preset.name])');
    expect(del).not.toContain('pushDialog(');
  });
});
