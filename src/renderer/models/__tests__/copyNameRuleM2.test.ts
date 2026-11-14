// 복제 이름 단일 규칙(2026-11-14 정비 M2, SPEC_GUIDE §5 「복제 이름 단일 규칙」):
//  - 사용자 「복제」 = suggestFolderCopyName — 「X 복사본」, 겹치면 「X 복사본 (2)」·(3)…
//  - 가져오기·충돌 = numberedName — 「X」, 겹치면 「X (2)」·(3)…
// 서비스 지점(C5·C8·K8)은 실제 클래스로, 화면 지점(C3·C4·C7·C9·I4)과 C10(BackupService 메서드)은
// presetCloneTarget.test.ts 와 같이 소스 AST 에서 실제 처리 함수를 꺼내 의존만 주입해 돌린다.
// 공통 확인: 서비스·종전 번호 규칙(「복사본1」·「_1」·「copy」·「Copy」·「(복사)」·「(1)」)이 끼지 않는다.

import fs from 'fs';
import path from 'path';
import ts from 'typescript';

let uuidSeq = 0;
const backend = {
  readFile: jest.fn(async () => {
    throw new Error('no file');
  }),
  existFile: jest.fn(async () => false),
  renameFile: jest.fn(async () => {}),
  readDataFile: jest.fn(async () => null),
  writeDataFile: jest.fn(async () => {}),
  deleteFile: jest.fn(async () => {}),
  notifyGlobalStoreChanged: jest.fn(async () => {}),
};
jest.mock('..', () => ({
  backend,
  imageService: {},
  workFlowService: {},
  sessionService: {},
  templateService: {},
  globalPresetService: {},
  globalCharacterPresetService: {},
}));
jest.mock('../PersistenceService', () => ({
  persistService: { write: jest.fn(async () => {}) },
}));
jest.mock('../appStateRef', () => ({ getAppState: () => ({ pushMessage: jest.fn() }) }));
jest.mock('uuid', () => ({ v4: () => `u${++uuidSeq}` }));
jest.mock('../types', () => ({
  VibeItem: { fromJSON: (j: any) => j },
  ReferenceItem: { fromJSON: (j: any) => j },
  CharacterPreset: { fromJSON: (j: any) => j },
  Session: class {},
}));
jest.mock('../ImageService', () => ({ dataUriToBase64: (s: string) => s }));
jest.mock('../imageFormats', () => ({ imageExtFromBase64: () => 'png' }));
jest.mock('../SessionService', () => ({
  readJSONFromPNG: jest.fn(),
  embedJSONInPNG: jest.fn(),
  normalizePresetJson: (j: any) => j,
  createImageWithText: jest.fn(),
}));
jest.mock('../util', () => ({ extractPromptDataFromBase64: jest.fn() }));
jest.mock('../presetExportDecoration', () => ({ decoratePresetExportImage: jest.fn() }));
jest.mock('../sdstudioPromptImport', () => ({ planPromptImport: jest.fn() }));

import { numberedName, suggestFolderCopyName } from '../nameInput';
import { GlobalCharacterPresetService } from '../GlobalCharacterPresetService';
import { ProjectTemplateService } from '../ProjectTemplateService';
import { GlobalPresetService } from '../GlobalPresetService';

const OLD_MARKERS = [/복사본\d/, /_1$/, /copy/, /Copy/, /\(복사\)/, /\(1\)$/, /_copy/];
const expectNoOldMarker = (names: string[]) => {
  for (const n of names) for (const re of OLD_MARKERS) expect(n).not.toMatch(re);
};

// ── 소스에서 실제 처리 함수 꺼내기 ──
const ROOT = path.join(__dirname, '../..');
function load(rel: string) {
  return ts.createSourceFile(rel, fs.readFileSync(path.join(ROOT, rel), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
function findNode<T extends ts.Node>(src: ts.SourceFile, pred: (n: ts.Node) => n is T): T {
  let found: T | undefined;
  const visit = (n: ts.Node) => {
    if (!found && pred(n)) found = n;
    if (!found) ts.forEachChild(n, visit);
  };
  visit(src);
  if (!found) throw new Error('node not found');
  return found;
}
function compile(exprText: string, deps: Record<string, unknown>): any {
  const code = ts.transpileModule(`return (${exprText});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  return new Function(...Object.keys(deps), code)(...Object.values(deps));
}
/** `const name = (…) => …` 의 초기값 */
function constFn(rel: string, name: string, deps: Record<string, unknown>) {
  const src = load(rel);
  const decl = findNode(src, (n): n is ts.VariableDeclaration =>
    ts.isVariableDeclaration(n) && n.name.getText(src) === name && !!n.initializer,
  );
  return compile(decl.initializer!.getText(src), deps);
}
/** 클래스 메서드 본문을 async function 으로 */
function methodFn(rel: string, name: string, deps: Record<string, unknown>) {
  const src = load(rel);
  const m = findNode(src, (n): n is ts.MethodDeclaration =>
    ts.isMethodDeclaration(n) && n.name.getText(src) === name && !!n.body,
  );
  return compile(`async function () ${m.body!.getText(src)}`, deps);
}

const UNDO_TEXT = {
  exportPresetDuplicate: (n: string) => `exp ${n}`,
  characterPresetDuplicate: (n: string) => `char ${n}`,
  sceneDuplicate: (n: string) => `scene ${n}`,
};

describe('공용 helper', () => {
  test('suggestFolderCopyName·numberedName', () => {
    const taken = new Set(['A 복사본', 'A 복사본 (2)', 'B']);
    expect(suggestFolderCopyName('Z', (n) => taken.has(n))).toBe('Z 복사본');
    expect(suggestFolderCopyName('A', (n) => taken.has(n))).toBe('A 복사본 (3)');
    expect(numberedName('Z', (n) => taken.has(n))).toBe('Z');
    expect(numberedName('B', (n) => taken.has(n))).toBe('B (2)');
  });
});

describe('C3 내보내기 프리셋 복제(ExportPresetManager.duplicatePreset)', () => {
  test('원본 바로 아래·기본 해제·라벨 = 실제 이름', () => {
    let presets: any[] = [{ name: 'P', isDefault: true }, { name: 'Q' }];
    const commitPresets = jest.fn((next: any[]) => {
      presets = next;
    });
    const make = () =>
      constFn('componenets/ExportPresetManager.tsx', 'duplicatePreset', {
        presets,
        commitPresets,
        editingIndex: null,
        setEditingIndex: jest.fn(),
        appState: { pushMessage: jest.fn() },
        UNDO_TEXT,
        suggestFolderCopyName,
      });
    make()(0);
    expect(presets.map((p) => p.name)).toEqual(['P', 'P 복사본', 'Q']);
    expect(presets[1].isDefault).toBe(false);
    make()(0);
    expect(presets.map((p) => p.name)).toEqual(['P', 'P 복사본 (2)', 'P 복사본', 'Q']);
    expect(commitPresets).toHaveBeenLastCalledWith(expect.any(Array), 'exp P 복사본 (2)');
    expectNoOldMarker(presets.map((p) => p.name).slice(1));
  });
});

// 로컬 캐릭터 프리셋 세션 대역 — addCharacterPresetRecorded 는 실물처럼 uniqueCharacterPresetName
// (공백 없는 숫자 「X1」)을 거친 뒤 넣는다. 호출부가 빈 이름을 넘기면 숫자는 붙지 않아야 한다.
function charSession(names: string[]) {
  const map = new Map<string, any>(names.map((n) => [n, { name: n }]));
  const unique = (n: string) => {
    if (!map.has(n)) return n;
    let i = 1;
    while (map.has(n + i)) i++;
    return n + i;
  };
  return {
    map,
    hasCharacterPreset: (n: string) => map.has(n),
    addCharacterPreset: (p: any) => {
      p.name = unique(p.name);
      map.set(p.name, p);
    },
    addRecorded: jest.fn((s: any, p: any, label: (n: string) => string) => {
      p.name = unique(p.name);
      map.set(p.name, p);
      return label(p.name);
    }),
  };
}

describe('C4 로컬 캐릭터 프리셋 복제(CharacterPresetEditor.handleDuplicate)', () => {
  test('「X 복사본」→「X 복사본 (2)」, Session 숫자 접미 미발동·글로벌 링크 끊음', () => {
    const s = charSession(['K']);
    const fn = constFn('componenets/CharacterPresetEditor.tsx', 'handleDuplicate', {
      CharacterPreset: { fromJSON: (j: any) => ({ ...j }) },
      curSession: s,
      addCharacterPresetRecorded: s.addRecorded,
      UNDO_TEXT,
      suggestFolderCopyName,
    });
    const src = { toJSON: () => ({ name: 'K', fromGlobalId: 'g1', fromGlobalRev: 3 }) };
    fn({ name: 'K', ...src });
    fn({ name: 'K', ...src });
    fn({ name: 'K', ...src });
    expect([...s.map.keys()]).toEqual(['K', 'K 복사본', 'K 복사본 (2)', 'K 복사본 (3)']);
    expect(s.map.get('K 복사본 (2)').fromGlobalId).toBe('');
    expect(s.addRecorded.mock.results.map((r) => r.value)).toEqual([
      'char K 복사본',
      'char K 복사본 (2)',
      'char K 복사본 (3)',
    ]);
    expectNoOldMarker([...s.map.keys()].slice(1));
  });
});

describe('I4 로컬 캐릭터 프리셋 파일 불러오기 중복 이름', () => {
  test('「X」→「X (2)」(종전 「X_1_1」)', () => {
    const src = load('componenets/CharacterPresetEditor.tsx');
    const stmt = findNode(src, (n): n is ts.ExpressionStatement =>
      ts.isExpressionStatement(n) && /preset\.name = numberedName\(/.test(n.getText(src)),
    );
    const s = charSession(['K', 'K (2)']);
    const run = (name: string) => {
      const preset = { name };
      compile(`() => { ${stmt.getText(src)} }`, { preset, session: s, numberedName })();
      s.addCharacterPreset(preset);
      return preset.name;
    };
    expect(run('Z')).toBe('Z');
    expect(run('K')).toBe('K (3)');
    expect(run('K')).toBe('K (4)');
    expectNoOldMarker(['K (3)', 'K (4)']);
  });
});

describe('C5 글로벌 캐릭터 프리셋 복제(duplicateEntry)', () => {
  test('원본 바로 뒤·「X 복사본」→「(2)」, `_n` 미발동', async () => {
    const svc = new GlobalCharacterPresetService();
    const entry = (id: string, name: string) => ({
      id,
      name,
      createdAt: 1,
      updatedAt: 1,
      preset: { name, prompt: '', vibes: [], characterReferences: [] } as any,
    });
    svc.presets = [entry('a', 'K'), entry('b', 'L')];
    await svc.duplicateEntry('a');
    await svc.duplicateEntry('a');
    expect(svc.presets.map((p) => p.name)).toEqual(['K', 'K 복사본 (2)', 'K 복사본', 'L']);
    expect(svc.presets[1].preset.name).toBe('K 복사본 (2)');
    expectNoOldMarker(['K 복사본', 'K 복사본 (2)']);
  });
});

describe('C6 그림체 복제', () => {
  test('presetCloneTarget.test.ts 가 실제 버튼 처리로 「B 복사본 (2)」·「(3)」을 확인', () => {
    const text = fs.readFileSync(path.join(ROOT, 'componenets/PreSetEdtior.tsx'), 'utf8');
    expect(text).not.toMatch(/' copy '/);
  });
});

describe('C7 씬 복제(AppContextMenu.duplicateScene — 생성·변형 공용)', () => {
  test('같은 종류 씬끼리만 겹침 판정, 「X 복사본」→「(2)」', async () => {
    const scenes: { type: string; name: string }[] = [
      { type: 'scene', name: 'S' },
      { type: 'inpaint', name: 'S 복사본' }, // 다른 종류 — 겹침으로 보지 않음(종전과 같은 범위)
    ];
    const session = {
      hasScene: (type: string, n: string) => scenes.some((s) => s.type === type && s.name === n),
      addScene: (s: any) => scenes.push(s),
    };
    const recordScenesCreated = jest.fn();
    const fn = constFn('componenets/AppContextMenu.tsx', 'duplicateScene', {
      genericSceneFromJSON: (j: any) => ({ ...j }),
      appState: { curSession: session },
      recordScenesCreated,
      UNDO_TEXT,
      suggestFolderCopyName,
    });
    const ctx = { scene: { toJSON: () => ({ type: 'scene', name: 'S' }) } };
    await fn(ctx);
    await fn(ctx);
    expect(scenes.filter((s) => s.type === 'scene').map((s) => s.name)).toEqual(['S', 'S 복사본', 'S 복사본 (2)']);
    expect(recordScenesCreated).toHaveBeenLastCalledWith(session, [expect.anything()], 'scene S 복사본 (2)');
    // 변형 씬도 같은 함수
    await fn({ scene: { toJSON: () => ({ type: 'inpaint', name: 'S' }) } });
    expect(scenes[scenes.length - 1]).toEqual({ type: 'inpaint', name: 'S 복사본 (2)' });
    expectNoOldMarker(['S 복사본', 'S 복사본 (2)']);
  });
});

describe('C8 프로젝트 템플릿 복제(ProjectTemplateService.duplicate)', () => {
  test('「X 복사본」→「(2)」(종전 「X (2)」)', async () => {
    const svc = new ProjectTemplateService();
    const tpl = (id: string, name: string) => ({
      id,
      name,
      createdAt: 1,
      updatedAt: 1,
      preset: null,
      characterPresets: [],
      vibes: [],
      characterReferences: [],
      scenes: [],
    });
    svc.templates = [tpl('t1', 'T')] as any;
    const a = await svc.duplicate('t1');
    const b = await svc.duplicate('t1');
    expect([a.name, b.name]).toEqual(['T 복사본', 'T 복사본 (2)']);
    expectNoOldMarker([a.name, b.name]);
  });
});

describe('C9 씬 템플릿 복제(SceneTemplateManager.handleDuplicate)', () => {
  test('이름 칸 처음 값 = 「X 복사본」(겹치면 「(2)」), 다른 경로는 처음 값 없음', async () => {
    const tpl = { name: 'ST' };
    const createSceneTemplate = jest.fn(async () => {});
    const fn = constFn('componenets/SceneTemplateManager.tsx', 'handleDuplicate', {
      sessionService: { get: async () => tpl, list: () => ['ST', 'ST 복사본', 'other'] },
      templateService: { createSceneTemplate },
      appState: { pushMessage: jest.fn() },
      suggestFolderCopyName,
    });
    await fn('ST');
    expect(createSceneTemplate).toHaveBeenLastCalledWith(tpl, { initialName: 'ST 복사본 (2)' });
    const fromCurrent = constFn('componenets/SceneTemplateManager.tsx', 'createFromCurrent', {
      curSession: { name: 'cur' },
      templateService: { createSceneTemplate },
    });
    await fromCurrent();
    expect(createSceneTemplate).toHaveBeenLastCalledWith({ name: 'cur' });
  });
});

describe('C10 프로젝트 복제(BackupService.duplicateProject)', () => {
  test('「X 복사본」→「(2)」, 같은 폴더, 묻지 않음', async () => {
    const list = ['P', 'P 복사본'];
    const sessionService = {
      list: () => list,
      getFolderOf: () => 'F',
      exportSessionShallow: jest.fn(async () => ({})),
      importSessionShallow: jest.fn(async (_j: any, n: string) => {
        list.push(n);
      }),
      duplicateSessionDeep: jest.fn(),
      moveToFolder: jest.fn(async () => {}),
      get: jest.fn(async () => undefined),
    };
    const appState: any = {
      curSession: { name: 'P' },
      pushDialogAsync: jest.fn(async () => 'shallow'),
      setProgressDialog: jest.fn(),
      pushMessage: jest.fn(),
    };
    const fn = methodFn('models/BackupService.ts', 'duplicateProject', {
      appState,
      sessionService,
      suggestFolderCopyName,
    });
    await fn();
    expect(sessionService.importSessionShallow).toHaveBeenLastCalledWith({}, 'P 복사본 (2)');
    expect(sessionService.moveToFolder).toHaveBeenLastCalledWith('P 복사본 (2)', 'F');
    expect(appState.pushDialogAsync).toHaveBeenCalledTimes(1); // 방식 선택만, 이름은 묻지 않음
    expectNoOldMarker(['P 복사본 (2)']);
  });
});

describe('K8 그림체 → 글로벌(GlobalPresetService.resolveNameCollision 경유)', () => {
  test('「X」→「X (2)」(종전 「X (1)」부터)', async () => {
    const svc = new GlobalPresetService();
    const session: any = {};
    const preset = (name: string) => ({ type: 'SDImageGen', name, toJSON: () => ({ name, type: 'SDImageGen' }) });
    const a = await svc.addFromSessionPreset(session, preset('G'));
    const b = await svc.addFromSessionPreset(session, preset('G'));
    const c = await svc.addFromSessionPreset(session, preset('G'));
    expect([a.name, b.name, c.name]).toEqual(['G', 'G (2)', 'G (3)']);
    expectNoOldMarker([b.name, c.name]);
  });
});
