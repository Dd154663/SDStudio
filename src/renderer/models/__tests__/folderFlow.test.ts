// 폴더 만들기·복제 공용 흐름(2026-11-16 M5 묶음 a, P7): 프로젝트 서랍·탐색 창이 같은 흐름을 쓰고,
// 화면 후처리는 콜백, 실패 토스트 종류는 호출부별로 보존한다.

import fs from 'fs';
import path from 'path';

jest.mock('..', () => ({ sessionService: {} }));
jest.mock('../appStateRef', () => ({ getAppState: () => ({}) }));
jest.mock('../projectFolderUndo', () => ({ createFolderRecorded: jest.fn() }));

import {
  createFolderFlow,
  duplicateFolderFlow,
  FOLDER_FLOW_TEXT,
  type FolderFlowDeps,
} from '../folderFlow';
import type { PromptNameOptions } from '../nameInput';

const exists = (p: PromptNameOptions) => p.existing as (name: string) => boolean;

const makeDeps = (opt: {
  folders?: string[];
  name?: string | undefined;
  mode?: string | undefined;
  createThrows?: Error;
  cloneThrows?: Error;
}) => {
  const folders = [...(opt.folders ?? [])];
  const log: string[] = [];
  const calls = {
    prompts: [] as PromptNameOptions[],
    dialogs: [] as any[],
    messages: [] as [string, string | undefined][],
    progress: [] as any[],
    clones: [] as [string, string, boolean][],
  };
  const deps: FolderFlowDeps = {
    folderLeafName: (p) => p.split('/').pop()!,
    folderParentPath: (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : null),
    listFolders: () => folders,
    promptName: async (o) => {
      calls.prompts.push(o);
      return opt.name;
    },
    createFolder: async (p) => {
      if (opt.createThrows) throw opt.createThrows;
      folders.push(p);
      log.push('create');
    },
    cloneFolder: async (s, t, w) => {
      log.push('clone');
      if (opt.cloneThrows) throw opt.cloneThrows;
      calls.clones.push([s, t, w]);
      folders.push(t);
    },
    ask: async (d) => {
      calls.dialogs.push(d);
      return opt.mode;
    },
    setProgressDialog: (d) => {
      calls.progress.push(d);
      log.push(d ? 'progress-open' : 'progress-close');
    },
    pushMessage: (m, k) => {
      calls.messages.push([m, k]);
      log.push('message');
    },
  };
  return { deps, calls, folders, log };
};

describe('createFolderFlow', () => {
  test('루트: 문구·경로 허용 규칙, 만든 뒤 onCreated(경로)', async () => {
    const { deps, calls, folders, log } = makeDeps({ folders: ['A'], name: 'B/C' });
    const created: string[] = [];
    const r = await createFolderFlow(deps, {
      onCreated: (p) => {
        created.push(p);
        log.push('onCreated');
      },
    });
    expect(r).toBe('B/C');
    expect(folders).toContain('B/C');
    expect(created).toEqual(['B/C']);
    expect(log).toEqual(['create', 'onCreated']);
    const p = calls.prompts[0];
    expect(p.title).toBe('새 폴더 이름을 입력하세요 (예: 폴더 또는 상위/하위)');
    expect(p).toMatchObject({ kind: 'folder', pathSafe: true, allowSlash: true });
    expect(exists(p)('A')).toBe(true);
    expect(exists(p)('Z')).toBe(false);
  });

  test('하위 폴더: 부모 이름 문구, 중복 판정·결과 경로가 부모 기준', async () => {
    const { deps, calls } = makeDeps({ folders: ['P/Q', 'P/X'], name: 'N' });
    const r = await createFolderFlow(deps, { parentPath: 'P/Q' });
    expect(r).toBe('P/Q/N');
    expect(calls.prompts[0].title).toBe('"Q" 안에 새 폴더 (예: 서브폴더 또는 상위/하위)');
    expect(exists(calls.prompts[0])('X')).toBe(false); // P/Q/X 아님
  });

  test('취소 → 만들지 않음', async () => {
    const { deps, folders } = makeDeps({ name: undefined });
    const onCreated = jest.fn();
    expect(await createFolderFlow(deps, { onCreated })).toBeUndefined();
    expect(folders).toEqual([]);
    expect(onCreated).not.toHaveBeenCalled();
  });

  test('실패 → error 토스트(두 호출부 공통, 피드백 1), onCreated 없음', async () => {
    const a = makeDeps({ name: 'N', createThrows: new Error('') });
    const onCreated = jest.fn();
    await createFolderFlow(a.deps, { onCreated });
    expect(a.calls.messages).toEqual([[FOLDER_FLOW_TEXT.createFailed, 'error']]);
    expect(onCreated).not.toHaveBeenCalled();
    const b = makeDeps({ name: 'N', createThrows: new Error('이미 있음') });
    await createFolderFlow(b.deps);
    expect(b.calls.messages).toEqual([['이미 있음', 'error']]);
  });

  test('onCreated 예외도 종전처럼 실패 토스트로 이어진다', async () => {
    const { deps, calls } = makeDeps({ name: 'N' });
    await createFolderFlow(deps, {
      onCreated: () => {
        throw new Error('화면 갱신 실패');
      },
    });
    expect(calls.messages).toEqual([['화면 갱신 실패', 'error']]);
  });
});

describe('duplicateFolderFlow', () => {
  test('제안값 = M2 규칙(「X 복사본」, 겹치면 (2)), 같은 부모 아래로, 진행 창 → 복제 → 닫기 → 후처리 → 토스트', async () => {
    const { deps, calls, log } = makeDeps({
      folders: ['P/A', 'P/A 복사본'],
      name: 'A2',
      mode: 'with-images',
    });
    const onDuplicated = jest.fn(() => log.push('onDuplicated'));
    const r = await duplicateFolderFlow(deps, 'P/A', { onDuplicated });
    expect(r).toBe('P/A2');
    const p = calls.prompts[0];
    expect(p.title).toBe('"A" 폴더를 복제합니다. 새 폴더 이름을 입력하세요.');
    expect(p.initial).toBe('A 복사본 (2)');
    expect(p).toMatchObject({ kind: 'folder', pathSafe: true });
    expect(p.allowSlash).toBeUndefined();
    expect(exists(p)('A 복사본')).toBe(true);
    expect(calls.dialogs[0].text).toBe(FOLDER_FLOW_TEXT.duplicateModePrompt);
    expect(calls.dialogs[0].items.map((i: any) => i.text)).toEqual([
      '설정만 복사 (프롬프트, 프리셋 등)',
      '이미지 포함 복사 (휴지통 제외)',
    ]);
    expect(calls.clones).toEqual([['P/A', 'P/A2', true]]);
    expect(calls.progress[0]).toEqual({ text: '폴더 복제 중...', done: 0, total: 1 });
    expect(log).toEqual(['progress-open', 'clone', 'progress-close', 'onDuplicated', 'message']);
    expect(onDuplicated).toHaveBeenCalledWith('P/A2');
    expect(calls.messages).toEqual([['"A2" 폴더로 복제되었습니다.', undefined]]);
  });

  test('루트 폴더 복제 · 설정만', async () => {
    const { deps, calls } = makeDeps({ folders: ['A'], name: 'B', mode: 'config' });
    await duplicateFolderFlow(deps, 'A');
    expect(calls.prompts[0].initial).toBe('A 복사본');
    expect(calls.clones).toEqual([['A', 'B', false]]);
  });

  test('이름 취소 · 방식 취소 → 복제하지 않음', async () => {
    const a = makeDeps({ folders: ['A'], name: undefined, mode: 'config' });
    await duplicateFolderFlow(a.deps, 'A');
    expect(a.calls.dialogs).toEqual([]);
    expect(a.calls.clones).toEqual([]);
    const b = makeDeps({ folders: ['A'], name: 'B', mode: undefined });
    await duplicateFolderFlow(b.deps, 'A');
    expect(b.calls.clones).toEqual([]);
    expect(b.calls.progress).toEqual([]);
  });

  test('실패 → 진행 창 닫고 error 토스트, 후처리 없음', async () => {
    const { deps, calls, log } = makeDeps({
      folders: ['A'],
      name: 'B',
      mode: 'config',
      cloneThrows: new Error(''),
    });
    const onDuplicated = jest.fn();
    await duplicateFolderFlow(deps, 'A', { onDuplicated });
    expect(log).toEqual(['progress-open', 'clone', 'progress-close', 'message']);
    expect(calls.messages).toEqual([[FOLDER_FLOW_TEXT.duplicateFailed, 'error']]);
    expect(onDuplicated).not.toHaveBeenCalled();
  });
});

describe('두 호출부가 공용 흐름을 부른다', () => {
  const read = (rel: string) =>
    fs.readFileSync(path.join(__dirname, '..', '..', 'componenets', rel), 'utf8');

  test.each(['ProjectDrawer.tsx', 'ProjectBrowser.tsx'])('%s', (file) => {
    const src = read(file);
    expect(src).toMatch(/createFolderFlow\(defaultFolderFlowDeps\(\)/);
    expect(src).toMatch(/duplicateFolderFlow\(defaultFolderFlowDeps\(\), sourceFolder/);
    expect(src).not.toContain('폴더를 복제합니다. 새 폴더 이름을 입력하세요.');
    expect(src).not.toContain('안에 새 폴더 (예: 서브폴더 또는 상위/하위)');
  });
});
