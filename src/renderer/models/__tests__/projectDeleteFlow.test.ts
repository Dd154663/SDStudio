// 프로젝트 삭제 관문(projectDeleteFlow, 2026-11-03): 지운 것이 현재 열린 프로젝트면 닫는다.
// 결함: 복제본(현재 프로젝트로 열림)을 드로어로 지우면 열린 채 남아 「미등록 프로젝트의 경로」 오류.
// 판정·문구는 deleteFlowRules(X4) 그대로, 닫기 = 이름이 같고 더는 로드돼 있지 않음.

const appState: { curSession: { name: string } | undefined } = { curSession: undefined };

// 가짜 sessionService — 로드 여부·목록을 직접 흉내 낸다(SessionService.delete 의 결과 세 갈래)
type DeleteMode = 'ok' | 'locked' | 'throw-before' | 'throw-after';
const loaded = new Set<string>();
const listed = new Set<string>();
let deleteMode: DeleteMode = 'ok';
const sessionService = {
  get: jest.fn(async (n: string) => {
    if (listed.has(n)) loaded.add(n);
    return listed.has(n) ? { name: n } : undefined;
  }),
  delete: jest.fn(async (n: string) => {
    if (deleteMode === 'locked') return; // 다른 창 잠금 — 조용히 반환
    if (deleteMode === 'throw-before') throw new Error('이동 실패');
    // 파일 이동 성공 → 메모리·목록에서 내려감
    loaded.delete(n);
    listed.delete(n);
    if (deleteMode === 'throw-after') throw new Error('즐겨찾기 저장 실패');
  }),
  list: jest.fn(() => [...listed]),
  isLoaded: jest.fn((n: string) => loaded.has(n)),
};

jest.mock('..', () => ({ sessionService }));
jest.mock('../appStateRef', () => ({ getAppState: () => appState }));

import {
  deleteProjectForFolderFlow,
  runProjectTrashDelete,
  shouldCloseCurrentAfterDelete,
} from '../projectDeleteFlow';
import { DELETE_RESULT_TEXT, projectDeleteResultText } from '../deleteFlowRules';
import { runFolderDeleteWithProjects } from '../folderDeleteFlow';

const setup = (names: string[], opts: { loaded?: string[]; current?: string } = {}) => {
  loaded.clear();
  listed.clear();
  names.forEach((n) => listed.add(n));
  (opts.loaded ?? names).forEach((n) => loaded.add(n));
  appState.curSession = opts.current ? { name: opts.current } : undefined;
};

beforeEach(() => {
  jest.clearAllMocks();
  deleteMode = 'ok';
});

describe('shouldCloseCurrentAfterDelete', () => {
  test('이름이 같고 더는 로드돼 있지 않을 때만 닫는다', () => {
    expect(shouldCloseCurrentAfterDelete('A', 'A', false)).toBe(true);
    expect(shouldCloseCurrentAfterDelete('A', 'A', true)).toBe(false);
    expect(shouldCloseCurrentAfterDelete('A', 'B', false)).toBe(false);
    expect(shouldCloseCurrentAfterDelete('A', undefined, false)).toBe(false);
  });
});

describe('runProjectTrashDelete — 현재 프로젝트 닫기', () => {
  test('현재 프로젝트(복제본)를 드로어 경로로 지우면 닫고 성공 안내', async () => {
    setup(['원본', '원본 Copy'], { current: '원본 Copy' });
    const r = await runProjectTrashDelete('원본 Copy');
    expect(r.kind).toBe('deleted');
    expect(r.closedCurrent).toBe(true);
    expect(appState.curSession).toBeUndefined();
    expect(projectDeleteResultText(r, 30)).toEqual({
      ok: true,
      text: DELETE_RESULT_TEXT.projectDeleted(30),
    });
    // 관문 그대로: 먼저 불러온 뒤 sessionService.delete
    expect(sessionService.get).toHaveBeenCalledWith('원본 Copy');
    expect(sessionService.delete).toHaveBeenCalledWith('원본 Copy');
  });

  test('미로드 프로젝트도 먼저 불러와 지운다(현재 아님 → 유지)', async () => {
    setup(['A', 'B'], { loaded: ['A'], current: 'A' });
    const r = await runProjectTrashDelete('B');
    expect(sessionService.get).toHaveBeenCalledWith('B');
    expect(r.kind).toBe('deleted');
    expect(r.closedCurrent).toBe(false);
    expect(appState.curSession).toEqual({ name: 'A' });
  });

  test('다른 프로젝트를 지우면 현재 프로젝트는 유지', async () => {
    setup(['A', 'B'], { current: 'A' });
    const r = await runProjectTrashDelete('B');
    expect(r.kind).toBe('deleted');
    expect(r.closedCurrent).toBe(false);
    expect(appState.curSession).toEqual({ name: 'A' });
  });

  test('다른 창 잠금으로 조용히 돌아오면(목록에 남음) 유지하고 실패 안내', async () => {
    setup(['A'], { current: 'A' });
    deleteMode = 'locked';
    const r = await runProjectTrashDelete('A');
    expect(r.kind).toBe('still-present');
    expect(r.closedCurrent).toBe(false);
    expect(appState.curSession).toEqual({ name: 'A' });
    expect(projectDeleteResultText(r, 30)).toEqual({
      ok: false,
      text: DELETE_RESULT_TEXT.projectStillPresent,
    });
    // 씬 템플릿 문구도 같은 실패 안내
    expect(projectDeleteResultText(r, 30, 'scene-template').ok).toBe(false);
  });

  test('이동 전 예외면 유지하고 예외 메시지로 안내', async () => {
    setup(['A'], { current: 'A' });
    deleteMode = 'throw-before';
    const r = await runProjectTrashDelete('A');
    expect(r).toEqual({ kind: 'error', message: '이동 실패', closedCurrent: false });
    expect(appState.curSession).toEqual({ name: 'A' });
    expect(projectDeleteResultText(r, 30)).toEqual({ ok: false, text: '이동 실패' });
  });

  test('이동 뒤 부가 정리 예외(이미 메모리에서 내려감)면 닫는다 — 경로 해제 뒤 열린 채 남지 않게', async () => {
    setup(['A'], { current: 'A' });
    deleteMode = 'throw-after';
    const r = await runProjectTrashDelete('A');
    expect(r.kind).toBe('error');
    expect(r.closedCurrent).toBe(true);
    expect(appState.curSession).toBeUndefined();
  });

  test('씬 템플릿(행 클릭으로 연 현재 프로젝트) 삭제도 닫고 템플릿 문구로 안내', async () => {
    setup(['__tpl'], { current: '__tpl' });
    const r = await runProjectTrashDelete('__tpl');
    expect(appState.curSession).toBeUndefined();
    expect(projectDeleteResultText(r, 30, 'scene-template').text).toBe(
      DELETE_RESULT_TEXT.sceneTemplateDeleted(30),
    );
  });

  test('열린 프로젝트가 없으면 아무것도 닫지 않는다', async () => {
    setup(['A']);
    const r = await runProjectTrashDelete('A');
    expect(r.kind).toBe('deleted');
    expect(r.closedCurrent).toBe(false);
    expect(appState.curSession).toBeUndefined();
  });
});

// ── 폴더 일괄 삭제(folderDeleteFlow) — 헬퍼로 바꿔도 결과·닫기가 그대로인가 ──

/** 교체 전 BackupService.deleteFolderWithProjects 의 deleteProject 콜백(비교 기준) */
const legacyDeleteProject = async (n: string) => {
  try {
    await sessionService.delete(n);
  } finally {
    if (appState.curSession?.name === n && !sessionService.isLoaded(n)) {
      appState.curSession = undefined;
    }
  }
};

type Scenario = {
  label: string;
  names: string[];
  current?: string;
  modeOf: (n: string) => DeleteMode;
};

const runFolder = async (s: Scenario, deleteProject: (n: string) => Promise<void>) => {
  setup(s.names, { current: s.current });
  const folders: Record<string, string | null> = {};
  s.names.forEach((n) => (folders[n] = 'F'));
  sessionService.delete.mockImplementation(async (n: string) => {
    const mode = s.modeOf(n);
    if (mode === 'locked') return;
    if (mode === 'throw-before') throw new Error('이동 실패');
    loaded.delete(n);
    listed.delete(n);
    if (mode === 'throw-after') throw new Error('즐겨찾기 저장 실패');
  });
  const result = await runFolderDeleteWithProjects('F', {
    projectsInFolder: () => [...s.names],
    folderOf: (n) => folders[n] ?? null,
    ensureLoaded: async (n) => {
      await sessionService.get(n);
      return sessionService.isLoaded(n);
    },
    isLoaded: (n) => sessionService.isLoaded(n),
    moveToFolder: async (n, f) => {
      folders[n] = f;
    },
    deleteProject,
    deleteFolder: async () => {},
  });
  return { result, cur: appState.curSession?.name };
};

const scenarios: Scenario[] = [
  { label: '전부 성공·현재 프로젝트 포함', names: ['A', 'B'], current: 'B', modeOf: () => 'ok' },
  { label: '다른 창 잠금 1개(현재)', names: ['A', 'B'], current: 'A', modeOf: (n) => (n === 'A' ? 'locked' : 'ok') },
  { label: '이동 전 예외(현재)', names: ['A', 'B'], current: 'B', modeOf: (n) => (n === 'B' ? 'throw-before' : 'ok') },
  { label: '이동 뒤 부가 정리 예외(현재)', names: ['A'], current: 'A', modeOf: () => 'throw-after' },
  { label: '현재 프로젝트가 폴더 밖', names: ['A', 'B'], current: 'Z', modeOf: () => 'ok' },
];

describe('폴더 일괄 삭제 — deleteProjectForFolderFlow 로 바꿔도 결과 불변', () => {
  test.each(scenarios)('$label', async (s) => {
    const before = await runFolder(s, legacyDeleteProject);
    const after = await runFolder(s, async (n) => {
      await deleteProjectForFolderFlow(n);
    });
    expect(after.result).toEqual(before.result);
    expect(after.cur).toEqual(before.cur);
  });

  test('예외 사유 메시지가 실패 집계에 그대로 남는다', async () => {
    const s = scenarios[2];
    const { result } = await runFolder(s, async (n) => {
      await deleteProjectForFolderFlow(n);
    });
    expect(result.failed).toEqual([{ name: 'B', reason: '삭제하지 못했습니다(이동 실패)' }]);
    expect(result.folderDeleted).toBe(false);
  });
});
