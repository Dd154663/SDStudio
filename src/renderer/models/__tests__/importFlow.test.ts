/**
 * 불러오기·덮어쓰기 일관화 공용층(드라이브 동기화 C안 ②, 2026-09-28) — 선택지 순서·숨김,
 * 충돌 개수, 문구 형식, 정책 선택·덮어쓰기 확인 흐름.
 */
const appState = {
  pushDialog: jest.fn(),
  pushDialogAsync: jest.fn(),
  confirmAsync: jest.fn(),
};
jest.mock('../appStateRef', () => ({ getAppState: () => appState }));

import {
  askImportPolicy,
  askImportPolicyWithConfirm,
  countNameConflicts,
  formatImportSummary,
  importDoneText,
  importPolicyChoices,
  importPolicyDialogText,
  IMPORT_FLOW_TEXT,
  librarySummary,
  readNamesFromStore,
} from '../importFlow';

beforeEach(() => {
  jest.resetAllMocks();
});

describe('importPolicyChoices', () => {
  it('세 선택지를 같은 이름·같은 순서로', () => {
    expect(importPolicyChoices()).toEqual([
      { text: '새 이름으로 추가 (권장)', value: 'rename' },
      { text: '건너뛰기', value: 'skip' },
      { text: '덮어쓰기', value: 'overwrite' },
    ]);
  });
  it('덮어쓰기를 지원하지 않으면 숨기되 나머지 이름은 그대로', () => {
    expect(importPolicyChoices({ overwrite: false })).toEqual([
      { text: '새 이름으로 추가 (권장)', value: 'rename' },
      { text: '건너뛰기', value: 'skip' },
    ]);
  });
});

describe('충돌 개수·이름 목록', () => {
  it('항목 단위로 센다(파일 안 같은 이름 두 개는 2)', () => {
    expect(countNameConflicts(['A', 'B', 'A', 'C'], ['A', 'C', 'Z'])).toBe(3);
    expect(countNameConflicts([], ['A'])).toBe(0);
  });
  it('readNamesFromStore 는 문자열 이름만', () => {
    expect(
      readNamesFromStore(
        { presets: [{ name: 'A' }, null, { name: 3 }, { name: '' }, { name: 'B' }] },
        'presets',
      ),
    ).toEqual(['A', 'B']);
    expect(readNamesFromStore(null, 'artists')).toEqual([]);
  });
});

describe('문구 형식', () => {
  it('정책 선택 본문 = 제목·충돌 개수·드라이브 안내', () => {
    const t = importPolicyDialogText('글로벌 프리셋', 3);
    expect(t).toContain('글로벌 프리셋 불러오기');
    expect(t).toContain('이름이 같은 항목이 3개 있습니다');
    expect(t).toContain(IMPORT_FLOW_TEXT.driveHint);
    expect(importPolicyDialogText('작가 라이브러리')).toContain(
      '이름이 같은 항목이 있을 때',
    );
  });
  it('덮어쓰기 확인 = 「기존 <대상> N개를 덮어씁니다. 기존 항목은 <보호 방식>됩니다. 계속할까요?」', () => {
    expect(
      IMPORT_FLOW_TEXT.overwriteConfirm(
        '캐릭터 프리셋',
        2,
        IMPORT_FLOW_TEXT.protection.keepLink,
      ),
    ).toBe(
      '기존 캐릭터 프리셋 2개를 덮어씁니다. 기존 항목은 프로젝트와의 연결을 유지한 채 내용만 교체됩니다. 계속할까요?',
    );
  });
  it('완료 = 「추가 N · 갱신 N · 건너뜀 N」 (+ 덧붙임 줄)', () => {
    expect(formatImportSummary({ added: 3, updated: 1, skipped: 0 })).toBe(
      '추가 3 · 갱신 1 · 건너뜀 0',
    );
    expect(
      importDoneText('씬 템플릿', { added: 1, updated: 0, skipped: 0, extra: 'x' }),
    ).toBe('씬 템플릿 불러오기를 마쳤습니다.\n추가 1 · 갱신 0 · 건너뜀 0\nx');
  });
  it('librarySummary: 삭제 후 추가된 덮어쓰기는 추가가 아니라 갱신으로', () => {
    expect(librarySummary({ added: 5, skipped: 1, overwritten: 2 })).toEqual({
      added: 3,
      updated: 2,
      skipped: 1,
    });
  });
});

describe('askImportPolicy / askImportPolicyWithConfirm', () => {
  it('충돌 0 이면 묻지 않고 rename', async () => {
    expect(await askImportPolicy({ label: 'x', conflictCount: 0 })).toBe('rename');
    expect(appState.pushDialogAsync).not.toHaveBeenCalled();
  });
  it('선택지 밖 값·취소는 undefined, 숨긴 덮어쓰기 값도 받지 않는다', async () => {
    appState.pushDialogAsync.mockResolvedValueOnce(undefined);
    expect(await askImportPolicy({ label: 'x', conflictCount: 1 })).toBeUndefined();
    appState.pushDialogAsync.mockResolvedValueOnce('overwrite');
    expect(
      await askImportPolicy({
        label: 'x',
        conflictCount: 1,
        allow: { overwrite: false },
      }),
    ).toBeUndefined();
    appState.pushDialogAsync.mockResolvedValueOnce('skip');
    expect(await askImportPolicy({ label: 'x' })).toBe('skip');
  });
  it('덮어쓰기는 확인 1회 — 확인하면 overwrite, 취소하면 undefined', async () => {
    appState.pushDialogAsync.mockResolvedValue('overwrite');
    appState.confirmAsync.mockResolvedValueOnce(true);
    expect(
      await askImportPolicyWithConfirm({
        label: '작가 라이브러리',
        itemLabel: '작가',
        conflictCount: 2,
        protection: IMPORT_FLOW_TEXT.protection.replaceDeleted,
      }),
    ).toBe('overwrite');
    expect(appState.confirmAsync).toHaveBeenCalledTimes(1);
    expect(appState.pushDialog).not.toHaveBeenCalled();
    const dialog = appState.confirmAsync.mock.calls[0][0];
    // 기존 항목이 영구 삭제되는 덮어쓰기 = 빨강 + Enter 무시(2026-10-03 D1)
    expect(dialog.danger).toBe('permanent');
    expect(dialog.confirmText).toBe(IMPORT_FLOW_TEXT.overwriteConfirmButton);
    expect(dialog.text).toMatch(/^기존 작가 2개를 덮어씁니다\. 기존 항목은 영구 삭제된 뒤/);

    appState.confirmAsync.mockResolvedValueOnce(false);
    expect(
      await askImportPolicyWithConfirm({
        label: 'x',
        conflictCount: 1,
        protection: 'p',
      }),
    ).toBeUndefined();
    // 영구 삭제가 아닌 보호 방식의 덮어쓰기 = 빨강, Enter 는 확인
    expect(appState.confirmAsync.mock.calls[1][0].danger).toBe(true);
  });
});
