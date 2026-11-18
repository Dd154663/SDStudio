// 새 프로젝트 만들기 공용 흐름(2026-11-18 M5 묶음 c): 상단 버튼·프로젝트 서랍·탐색 창이 같은 흐름을 쓴다.

jest.mock('..', () => ({ sessionService: {}, projectTemplateService: {}, templateService: {} }));
jest.mock('../appStateRef', () => ({ getAppState: () => ({}) }));

import {
  createProjectFlow,
  PROJECT_CREATE_TEXT,
  type ProjectCreateFlowDeps,
} from '../projectCreateFlow';
import type { PromptNameOptions } from '../nameInput';

const makeDeps = (opt: {
  name?: string | undefined;
  folderTpl?: { templateId: string };
  picked?: string | null | undefined;
  createThrows?: Error;
  moveThrows?: Error;
}) => {
  const log: string[] = [];
  const calls = {
    prompts: [] as PromptNameOptions[],
    resolved: [] as string[],
    picks: 0,
    messages: [] as [string, string | undefined][],
    fromTemplate: [] as [string, string, boolean][],
    recent: [] as string[],
  };
  const deps: ProjectCreateFlowDeps = {
    promptName: async (o) => {
      calls.prompts.push(o);
      return opt.name;
    },
    nameRules: () => ({ kind: 'project', pathSafe: true }),
    resolveFolderTemplate: async (f) => {
      calls.resolved.push(f);
      return opt.folderTpl;
    },
    pickTemplate: async () => {
      calls.picks++;
      return 'picked' in opt ? opt.picked : null;
    },
    templateName: (id) => (id === 'tpl1' ? '기본틀' : undefined),
    createFromTemplate: async (id, name, inherited) => {
      if (opt.createThrows) throw opt.createThrows;
      calls.fromTemplate.push([id, name, inherited]);
      log.push('create-tpl');
    },
    createEmpty: async () => {
      if (opt.createThrows) throw opt.createThrows;
      log.push('create-empty');
    },
    moveToFolder: async (_n, f) => {
      log.push('move:' + f);
      if (opt.moveThrows) throw opt.moveThrows;
    },
    openProject: async (n) => {
      log.push('open:' + n);
      return true;
    },
    pushRecentProject: (n) => {
      calls.recent.push(n);
      log.push('recent');
    },
    pushMessage: (m, k) => {
      calls.messages.push([m, k]);
    },
  };
  return { deps, calls, log };
};

describe('createProjectFlow', () => {
  test('미분류: 폴더 기본 템플릿 조회 안 함 → 고르기 → 만들기 → 열기·최근 등록', async () => {
    const { deps, calls, log } = makeDeps({ name: 'A', picked: 'g1' });
    expect(await createProjectFlow(deps)).toBe('A');
    expect(calls.prompts[0].title).toBe('신규 프로젝트 이름');
    expect(calls.prompts[0].kind).toBe('project');
    expect(calls.resolved).toEqual([]);
    expect(calls.picks).toBe(1);
    expect(calls.fromTemplate).toEqual([['g1', 'A', false]]);
    expect(log).toEqual(['create-tpl', 'open:A', 'recent']);
    expect(calls.messages).toEqual([]);
  });

  test('미분류 + 전역 템플릿 없음(null) = 빈 프로젝트', async () => {
    const { deps, log } = makeDeps({ name: 'A', picked: null });
    expect(await createProjectFlow(deps, { folder: null })).toBe('A');
    expect(log).toEqual(['create-empty', 'open:A', 'recent']);
  });

  test('폴더 + 폴더 기본 템플릿: 자동 적용·상속·안내 토스트, 고르기 창 없음', async () => {
    const { deps, calls, log } = makeDeps({ name: 'B', folderTpl: { templateId: 'tpl1' } });
    expect(await createProjectFlow(deps, { folder: '상위/하위' })).toBe('B');
    expect(calls.prompts[0].title).toBe('"상위/하위" 폴더에 새 프로젝트 이름');
    expect(calls.resolved).toEqual(['상위/하위']);
    expect(calls.picks).toBe(0);
    expect(calls.fromTemplate).toEqual([['tpl1', 'B', true]]);
    expect(log).toEqual(['create-tpl', 'move:상위/하위', 'open:B', 'recent']);
    expect(calls.messages).toEqual([[PROJECT_CREATE_TEXT.folderTemplateApplied('기본틀'), undefined]]);
  });

  test('폴더 + 기본 템플릿 없음: 고르기 창', async () => {
    const { deps, calls, log } = makeDeps({ name: 'C', picked: 'g2' });
    expect(await createProjectFlow(deps, { folder: 'F' })).toBe('C');
    expect(calls.resolved).toEqual(['F']);
    expect(calls.picks).toBe(1);
    expect(calls.fromTemplate).toEqual([['g2', 'C', false]]);
    expect(log).toEqual(['create-tpl', 'move:F', 'open:C', 'recent']);
    expect(calls.messages).toEqual([]);
  });

  test('고르기 취소 = 만들지 않음', async () => {
    const { deps, log } = makeDeps({ name: 'D', picked: undefined });
    expect(await createProjectFlow(deps, { folder: 'F' })).toBeUndefined();
    expect(log).toEqual([]);
  });

  test('이름 취소 = 아무것도 하지 않음', async () => {
    const { deps, calls, log } = makeDeps({ name: undefined });
    expect(await createProjectFlow(deps, { folder: 'F' })).toBeUndefined();
    expect(calls.resolved).toEqual([]);
    expect(calls.picks).toBe(0);
    expect(log).toEqual([]);
  });

  test('만들기 실패 = error 토스트, 열지 않음', async () => {
    const { deps, calls, log } = makeDeps({
      name: 'E',
      picked: null,
      createThrows: new Error('boom'),
    });
    expect(await createProjectFlow(deps)).toBeUndefined();
    expect(log).toEqual([]);
    expect(calls.messages).toHaveLength(1);
    expect(calls.messages[0][1]).toBe('error');
  });

  test('폴더 이동 실패는 조용히 넘기고 열림', async () => {
    const { deps, calls, log } = makeDeps({
      name: 'G',
      picked: null,
      moveThrows: new Error('move'),
    });
    expect(await createProjectFlow(deps, { folder: 'F' })).toBe('G');
    expect(log).toEqual(['create-empty', 'move:F', 'open:G', 'recent']);
    expect(calls.messages).toEqual([]);
  });
});
