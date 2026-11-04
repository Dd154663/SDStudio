/**
 * 되돌리기 2차 묶음 5 — 2026-11-04 (SPEC_GUIDE 「되돌리기 계약」 「2차 묶음 5 계측 지점」).
 *  ⑩-1 씬 템플릿에서 씬 불러오기: 실제 TemplateService.importSceneTemplate(번호·덮어쓰기·건너뛰기) 결과 → recordSceneTemplateImport
 *       1항목. 되돌림 = 들어간 씬 휴지통(outs 함께) → 덮어쓴 기존 씬 원래 이름·자리·이미지로 복원, 다시 실행 = 역순
 *  ⑩-2 현재 프로젝트에 씬만 불러오기: slots·resolution 덮어쓰기 + 새 씬 = 1항목(importProjectScenesRecorded), 확인 문구 갱신
 *  ⑩-3 전역 조각: 전역 스택(프로젝트 없이도) — 그룹 추가·삭제(원래 자리)·조각 추가·이름·내용(편집 세션)·랜덤 줄·순서·
 *       불러오기·로컬 → 전역 복사, 라벨 「전역」, 기록 밖 변경 = 실패+폐기(D16 확인 없음), 저장 예약 배선, 로컬과 최근 순 선택
 *  ⑩-4 원본 씬으로 이미지 복사: 복사(원본 형식 — E9) + 원본 휴지통 = 1항목(copyImageToOriginalRecorded), 되돌림·다시 실행 역순
 * 메모리 파일시스템·실제 TrashService 는 undoDelete.test.ts 와 같다.
 */

// ---- 메모리 파일시스템 ----
const files = new Map<string, string>();

function exists(p: string): boolean {
  if (files.has(p)) return true;
  for (const k of files.keys()) if (k.startsWith(p + '/')) return true;
  return false;
}
function children(dir: string): string[] {
  const set = new Set<string>();
  for (const k of files.keys()) {
    if (k.startsWith(dir + '/')) set.add(k.slice(dir.length + 1).split('/')[0]);
  }
  return Array.from(set);
}
function movePrefix(from: string, to: string) {
  for (const k of Array.from(files.keys())) {
    if (k === from || k.startsWith(from + '/')) {
      const v = files.get(k)!;
      files.delete(k);
      files.set(to + k.slice(from.length), v);
    }
  }
}

const dirOf = (scene: { type: string; name: string }) =>
  (scene.type === 'scene' ? 'outs/P/' : 'inpaints/P/') + scene.name;

/** ImageService.refresh 의 목록 화해(목록 = 디스크, 새 파일은 뒤에) */
async function fakeRefresh(_s: any, scene: any) {
  const dir = dirOf(scene);
  const names = children(dir)
    .filter((n) => files.has(dir + '/' + n) && /\.(png|webp)$/.test(n))
    .sort();
  const set = new Set(names);
  const seen = new Set<string>();
  const next: string[] = [];
  for (const x of scene.imageMap as string[]) {
    if (set.has(x) && !seen.has(x)) {
      seen.add(x);
      next.push(x);
    }
  }
  for (const n of names) if (!seen.has(n)) next.push(n);
  scene.imageMap = next;
  if (scene.type === 'scene') scene.mains = scene.mains.filter((x: string) => set.has(x));
  return 'files';
}

const mockRefs: { trash?: any; tpl?: any; dialogs: any[]; messages: string[] } = { dialogs: [], messages: [] };

jest.mock('../index', () => ({
  backend: {
    existFile: jest.fn(async (p: string) => exists(p)),
    readFile: jest.fn(async (p: string) => {
      if (!files.has(p)) throw new Error('ENOENT ' + p);
      return files.get(p)!;
    }),
    writeFile: jest.fn(async (p: string, c: string) => {
      files.set(p, c);
    }),
    listFiles: jest.fn(async (dir: string) => children(dir)),
    listFilesWithStats: jest.fn(async (dir: string) =>
      children(dir)
        .filter((n) => files.has(dir + '/' + n))
        .map((name) => ({ name })),
    ),
    renameFile: jest.fn(async (a: string, b: string) => {
      if (!files.has(a)) throw new Error('ENOENT ' + a);
      files.set(b, files.get(a)!);
      files.delete(a);
    }),
    renameDir: jest.fn(async (a: string, b: string) => {
      if (!exists(a)) return;
      if (exists(b)) throw new Error('ENOTEMPTY ' + b);
      movePrefix(a, b);
    }),
    copyFile: jest.fn(async (a: string, b: string) => {
      if (!files.has(a)) throw new Error('ENOENT ' + a);
      files.set(b, files.get(a)!);
    }),
    deleteFile: jest.fn(async (p: string) => {
      files.delete(p);
    }),
    deleteDir: jest.fn(async (p: string) => {
      for (const k of Array.from(files.keys())) if (k === p || k.startsWith(p + '/')) files.delete(k);
    }),
    notifyGlobalStoreChanged: jest.fn(async () => {}),
  },
  isMobile: false,
  gameService: {},
  taskQueueService: { addLog: jest.fn() },
  imageService: {
    invalidateCacheBatch: jest.fn(async () => {}),
    getOutputDir: (_s: any, scene: any) => dirOf(scene),
    refresh: (s: any, scene: any) => fakeRefresh(s, scene),
  },
  templateService: { removeProject: jest.fn(async () => {}) },
  sessionService: {
    guardCrossWindowLock: jest.fn(async () => true),
    list: () => ['T', 'P'],
    get: async (name: string) => (name === 'T' ? mockRefs.tpl : undefined),
  },
  get trashService() {
    return mockRefs.trash;
  },
  projectTemplateService: {},
  workFlowService: {},
}));
jest.mock('../PersistenceService', () => ({
  persistService: {
    write: jest.fn(async (p: string, c: string) => {
      files.set(p, c);
    }),
  },
}));
jest.mock('../appStateRef', () => ({
  getAppState: () => ({
    pushMessage: (m: string) => mockRefs.messages.push(m),
    pushDialogAsync: async () => mockRefs.dialogs.shift(),
  }),
}));

import * as fs from 'fs';
import * as path from 'path';
import { TrashService } from '../TrashService';
import { TemplateService } from '../TemplateService';
import { setWorkspaceLayoutActive } from '../storageLayout';
import { GenericScene, InpaintScene, Piece, PieceLibrary, PromptPiece, Scene, Session } from '../types';
import { GLOBAL_UNDO_SCOPE, UNDO_TEXT, UndoService } from '../undoService';
import type { SceneStructureOps } from '../sceneStructureUndo';
import { copyImageFilesInto } from '../ImageService';
import { copyImageToOriginalRecorded, ImageFileOps } from '../deleteUndo';
import { importProjectScenesRecorded, recordSceneTemplateImport } from '../sceneImportUndo';
import { sceneImportOverwriteText } from '../deleteFlowRules';
import { hasOpenSceneFieldEdit } from '../sceneFieldUndo';
import type { FocusLeaveWatcher } from '../sceneFieldUndo';
import {
  beginPieceDrag,
  configurePieceUndo,
  editPieceGroups,
  editPieceLibrary,
  globalGroupNameOf,
  movePieceInLibrary,
  renamePieceRecorded,
  touchPieceEdit,
} from '../pieceUndo';
import { FIND_REPLACE_UNRECORDED_LABEL } from '../findReplaceUndo';

// ---- 하네스 ----
function makeService(cur?: () => Session | undefined) {
  const toast = jest.fn();
  const confirm = jest.fn(async () => true);
  const mirrors = new Set<Session>();
  const clock = { t: 1000 };
  const service = new UndoService({
    curSession: cur ?? (() => undefined),
    isMirror: (s) => mirrors.has(s),
    toast,
    confirm,
    now: () => clock.t,
  });
  return { service, toast, confirm, mirrors, clock };
}

function scene(name: string, imgs: string[] = [], extra: Record<string, unknown> = {}): Scene {
  const s = Scene.fromJSON({
    type: 'scene',
    name,
    resolution: 'portrait',
    slots: [],
    mains: [],
    imageMap: [],
    meta: {},
    round: undefined,
    game: undefined,
    ...extra,
  } as any);
  for (const f of imgs) files.set(`outs/P/${name}/${f}`, `${name}:${f}`);
  return s;
}

function makeSession(name: string, ...scenes: Scene[]): Session {
  const session = new Session();
  session.name = name;
  for (const s of scenes) session.addScene(s);
  return session;
}

const order = (s: Session) => s.getScenes('scene').map((x) => x.name);

async function makeOps(): Promise<{ trash: TrashService; sceneOps: SceneStructureOps; imageOps: ImageFileOps }> {
  const trash = new TrashService();
  await trash.loadTrash();
  mockRefs.trash = trash;
  const sceneOps: SceneStructureOps = {
    moveSceneToTrash: (s, sc) => trash.moveSceneToTrash(s, sc),
    restoreScene: (s, slot) => trash.restoreScene(s, slot),
    // 휴지통 슬롯 이름(「A (삭제 2)」 등)을 원래 이름으로 — renameScene 과 같은 결과(키·이름·outs 폴더)
    renameScene: jest.fn(async (s: Session, from: string, to: string) => {
      const sc = s.scenes.get(from);
      if (!sc || s.scenes.has(to)) return;
      movePrefix(`outs/${s.name}/${from}`, `outs/${s.name}/${to}`);
      sc.name = to;
      s.scenes = new Map(Array.from(s.scenes.entries()).map(([k, v]) => [k === from ? to : k, v] as [string, Scene]));
    }),
    renameInpaintScene: jest.fn(async () => true),
    getSceneBookmark: () => undefined,
    setSceneBookmark: jest.fn(async () => {}),
    hasTrashedScene: (s, slot) => trash.getDeletedScenes(s.name).some((d) => d.name === slot),
    sceneRetentionDays: 14,
  };
  const imageOps: ImageFileOps = {
    outputDir: (_s, sc) => dirOf(sc),
    deleteImageFiles: jest.fn(async (s, sc, paths) => {
      const r = await trash.moveImagesToTrashDetailed(s, sc, paths);
      await fakeRefresh(s, sc);
      return r;
    }),
    restoreImages: (s, sc, names) => trash.restoreImages(s, sc, names),
    refreshScene: (s, sc) => fakeRefresh(s, sc),
    setImageMain: jest.fn(),
    applyImageOrder: () => true,
    applyRanking: jest.fn(),
    copyImageFiles: (s, sc, src) => copyImageFilesInto(s, sc, src),
    imageRetentionDays: 3,
  };
  return { trash, sceneOps, imageOps };
}

function templateService(): TemplateService {
  const t = new TemplateService();
  (t as any).loaded = true;
  t.sceneNames = ['T'];
  return t;
}

beforeEach(() => {
  files.clear();
  setWorkspaceLayoutActive(false);
  mockRefs.dialogs = [];
  mockRefs.messages = [];
  mockRefs.tpl = makeSession('T', scene('A', [], { resolution: 'landscape' }), scene('B'));
});

// ─────────────────────────────────────────────────────────────────────────────
describe('⑩-1 씬 템플릿에서 씬 불러오기', () => {
  test('겹침 없음 → 들어간 씬 2개 = 1항목. 되돌림 = 휴지통(outs 함께), 다시 실행 = 같은 자리로', async () => {
    const { service } = makeService();
    const { sceneOps } = await makeOps();
    const session = makeSession('P', scene('X'));
    mockRefs.dialogs = ['T'];
    const result = await templateService().importSceneTemplate(session);
    expect(result!.names).toEqual(['A', 'B']);
    expect(result!.trashed).toEqual([]);
    expect(recordSceneTemplateImport(session, result, { service, ops: sceneOps })).toBe(true);
    expect(service.entries(session).past).toHaveLength(1);
    expect(service.peekLabel(session, 'undo')).toBe('씬 템플릿에서 씬 2개 불러오기: T');
    // 그사이 생긴 이미지도 휴지통행으로 보존
    files.set('outs/P/B/new.png', 'gen');

    expect(await service.undo(session)).toBe(true);
    expect(order(session)).toEqual(['X']);
    expect(files.has('outs/P/B/new.png')).toBe(false);
    expect(Array.from(files.keys()).some((k) => k.endsWith('/new.png'))).toBe(true);

    expect(await service.redo(session)).toBe(true);
    expect(order(session)).toEqual(['X', 'A', 'B']);
    expect(files.get('outs/P/B/new.png')).toBe('gen');
    expect(session.getScene('scene', 'A')!.resolution).toBe('landscape');
  });

  test('덮어쓰기 → 되돌림 = 새 씬 휴지통 → 기존 씬을 원래 이름·자리·이미지로, 다시 실행 = 역순', async () => {
    const { service } = makeService();
    const { sceneOps } = await makeOps();
    const oldA = scene('A', ['a.png']);
    await fakeRefresh(null, oldA);
    const session = makeSession('P', oldA, scene('X'));
    mockRefs.dialogs = ['T', 'overwrite'];
    const result = await templateService().importSceneTemplate(session);
    expect(result!.trashed.map((t) => t.info)).toEqual([expect.objectContaining({ name: 'A', index: 0 })]);
    expect(order(session)).toEqual(['X', 'A', 'B']);
    expect(session.getScene('scene', 'A')!.imageMap).toEqual([]);
    expect(recordSceneTemplateImport(session, result, { service, ops: sceneOps })).toBe(true);
    expect(service.entries(session).past).toHaveLength(1);

    expect(await service.undo(session)).toBe(true);
    expect(order(session)).toEqual(['A', 'X']);
    const back = session.getScene('scene', 'A')!;
    expect(back.resolution).toBe('portrait');
    expect(back.imageMap).toEqual(['a.png']);
    expect(files.get('outs/P/A/a.png')).toBe('A:a.png');

    expect(await service.redo(session)).toBe(true);
    expect(order(session)).toEqual(['X', 'A', 'B']);
    expect(session.getScene('scene', 'A')!.resolution).toBe('landscape');
    expect(files.has('outs/P/A/a.png')).toBe(false); // 기존 A 의 이미지는 다시 휴지통

    // 한 번 더 왕복해도 같다
    expect(await service.undo(session)).toBe(true);
    expect(order(session)).toEqual(['A', 'X']);
    expect(files.get('outs/P/A/a.png')).toBe('A:a.png');
  });

  test('번호 정책은 새 이름으로 추가만, 건너뛰기만 남으면 기록 없음, 취소·미러도 기록 없음', async () => {
    const { service, mirrors } = makeService();
    const { sceneOps } = await makeOps();
    const session = makeSession('P', scene('A'), scene('B'));
    mockRefs.dialogs = ['T', 'number'];
    const numbered = await templateService().importSceneTemplate(session);
    expect(numbered!.names).toEqual(['A_1', 'B_1']);
    expect(recordSceneTemplateImport(session, numbered, { service, ops: sceneOps })).toBe(true);
    expect(await service.undo(session)).toBe(true);
    expect(order(session)).toEqual(['A', 'B']);

    mockRefs.dialogs = ['T', 'skip'];
    const skipped = await templateService().importSceneTemplate(session);
    expect(skipped!.names).toEqual([]);
    expect(recordSceneTemplateImport(session, skipped, { service, ops: sceneOps })).toBe(false);
    expect(recordSceneTemplateImport(session, null, { service, ops: sceneOps })).toBe(false);

    mirrors.add(session);
    mockRefs.dialogs = ['T', 'number'];
    const r = await templateService().importSceneTemplate(session);
    expect(recordSceneTemplateImport(session, r, { service, ops: sceneOps })).toBe(false);
  });

  test('호출부 2곳이 결과로 기록하고, 서비스는 기록 헬퍼를 부르지 않는다(소스 검사)', () => {
    const root = path.join(__dirname, '..', '..');
    const tpl = fs.readFileSync(path.join(root, 'models/TemplateService.ts'), 'utf-8');
    expect(tpl).not.toMatch(/recordSceneTemplateImport\(|undoService\./);
    for (const f of ['componenets/SceneTemplateManager.tsx', 'componenets/CharacterPresetEditor.tsx']) {
      const src = fs.readFileSync(path.join(root, f), 'utf-8');
      expect(src).toMatch(/recordSceneTemplateImport\(curSession, result\)/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('⑩-2 현재 프로젝트에 씬만 불러오기', () => {
  const piece = (prompt: string, id: string) =>
    PromptPiece.fromJSON({ prompt, characterPrompts: [], enabled: true, id } as any);

  test('slots·resolution 덮어쓰기 + 새 씬 = 1항목(되돌림 역순), 열린 조각 객체 재사용', async () => {
    const { service } = makeService();
    const { sceneOps } = await makeOps();
    const a = scene('A');
    a.slots = [[piece('old', 'p1')]];
    const session = makeSession('P', a);
    const livePiece = a.slots[0][0];
    const incoming: Record<string, any> = {
      A: { slots: [[{ prompt: 'new', characterPrompts: [], enabled: true, id: 'p1' }]], resolution: 'landscape' },
      B: { type: 'scene', name: 'B', resolution: 'square', slots: [], mains: ['x'], imageMap: [], meta: {} },
    };
    const created = importProjectScenesRecorded(
      session,
      [a],
      () => {
        const out: GenericScene[] = [];
        for (const key of Object.keys(incoming)) {
          if (session.scenes.has(key)) {
            session.scenes.get(key)!.slots = incoming[key].slots.map((sl: any) => sl.map((p: any) => PromptPiece.fromJSON(p)));
            session.scenes.get(key)!.resolution = incoming[key].resolution;
          } else {
            const sc = Scene.fromJSON(incoming[key]);
            sc.mains = [];
            session.scenes.set(key, sc);
            out.push(sc);
          }
        }
        return out;
      },
      { service, ops: sceneOps },
    );
    expect(created.map((s) => s.name)).toEqual(['B']);
    const openPiece = a.slots[0][0]; // 불러온 뒤 편집기가 보고 있는 조각 객체
    expect(service.entries(session).past).toHaveLength(1);
    expect(service.peekLabel(session, 'undo')).toBe('현재 프로젝트에 씬 2개 불러오기');

    expect(await service.undo(session)).toBe(true);
    expect(order(session)).toEqual(['A']);
    expect(a.resolution).toBe('portrait');
    expect(livePiece.prompt).toBe('old'); // 덮어쓰기는 새 조각 객체 — 옛 객체는 건드리지 않았다
    expect(a.slots[0][0]).toBe(openPiece); // 같은 id 의 지금 조각 객체를 다시 쓴다(restoreSlotsPreservingPieces)
    expect(openPiece.prompt).toBe('old');

    expect(await service.redo(session)).toBe(true);
    expect(order(session)).toEqual(['A', 'B']);
    expect(a.resolution).toBe('landscape');
    expect(a.slots[0][0].prompt).toBe('new');
  });

  test('미러면 실행만, 확인 문구는 되돌리기 가능으로', () => {
    const { service, mirrors } = makeService();
    const session = makeSession('P', scene('A'));
    mirrors.add(session);
    importProjectScenesRecorded(session, [], () => [], { service });
    expect(service.entries(session).past).toHaveLength(0);
    expect(sceneImportOverwriteText(['A'])).toContain('되돌리기로 복구할 수 있습니다');
    expect(sceneImportOverwriteText(['A'])).not.toContain('되돌릴 수 없습니다');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('⑩-3 전역 조각 — 전역 스택', () => {
  const lib = (name: string, ...pieces: [string, string][]) =>
    PieceLibrary.fromJSON({ version: 1, name, pieces: pieces.map(([n, p]) => ({ name: n, prompt: p, multi: false })) });
  const names = (l: PieceLibrary | undefined) => (l?.pieces ?? []).map((p) => p.name);
  let globalMap: Map<string, PieceLibrary>;
  const onGlobalRestored = jest.fn();

  function manualWatch(): { watch: FocusLeaveWatcher; leave: () => void } {
    let fn: (() => void) | undefined;
    return {
      watch: (onLeave) => {
        fn = onLeave;
        return () => {
          fn = undefined;
        };
      },
      leave: () => fn?.(),
    };
  }

  beforeEach(() => {
    globalMap = new Map([
      ['g1', lib('g1', ['a', 'A'], ['b', 'B'])],
      ['g2', lib('g2', ['x', 'X'])],
      ['g3', lib('g3')],
    ]);
    onGlobalRestored.mockClear();
    configurePieceUndo({ globalLibrary: () => globalMap, onGlobalRestored });
  });

  test('프로젝트 없이 그룹 추가 → 전역 스택 1항목·라벨 「전역」, 되돌림/다시 실행 + 저장 예약 배선', async () => {
    const { service } = makeService();
    editPieceGroups(undefined, globalMap, ['new'], UNDO_TEXT.pieceGroupAdd('new'), () => globalMap.set('new', lib('new')), {
      service,
    });
    expect(service.entries(GLOBAL_UNDO_SCOPE).past).toHaveLength(1);
    expect(service.peekLabel(undefined, 'undo')).toBe('전역 조각그룹 추가: new');
    expect(await service.undo(undefined)).toBe(true);
    expect(globalMap.has('new')).toBe(false);
    expect(onGlobalRestored).toHaveBeenCalledTimes(1);
    expect(await service.redo(undefined)).toBe(true);
    expect(Array.from(globalMap.keys())).toEqual(['g1', 'g2', 'g3', 'new']);
  });

  test('그룹 삭제 되돌림 = 같은 내용·원래 자리(같은 Map 객체에서 제자리 순서)', async () => {
    const { service } = makeService();
    const same = globalMap;
    editPieceGroups(undefined, globalMap, ['g2'], UNDO_TEXT.pieceGroupRemove('g2'), () => globalMap.delete('g2'), { service });
    expect(await service.undo(undefined)).toBe(true);
    expect(globalMap).toBe(same);
    expect(Array.from(globalMap.keys())).toEqual(['g1', 'g2', 'g3']);
    expect(names(globalMap.get('g2'))).toEqual(['x']);
    expect(await service.redo(undefined)).toBe(true);
    expect(globalMap.has('g2')).toBe(false);
  });

  test('조각 추가·삭제·랜덤 줄·이름·내용(편집 세션)·순서 드래그 — 조각 객체 유지', async () => {
    const { service } = makeService();
    const g1 = globalMap.get('g1')!;
    expect(globalGroupNameOf(g1)).toBe('g1');
    const a = g1.pieces[0];
    editPieceLibrary(undefined, g1, (g) => UNDO_TEXT.pieceAdd(g, 'c'), () => {
      g1.pieces.push(Piece.fromJSON({ name: 'c', prompt: '', multi: false }));
    }, { service });
    editPieceLibrary(undefined, g1, (g) => UNDO_TEXT.pieceMulti(g, 'a'), () => {
      a.multi = true;
    }, { service });
    renamePieceRecorded(undefined, g1, a, 'aa', { service });
    expect(service.peekLabel(undefined, 'undo')).toBe('전역 조각 이름 변경: g1.aa → a'); // 되돌림 라벨 B → A
    expect(service.entries(GLOBAL_UNDO_SCOPE).past.at(-1)!.label).toBe('전역 조각 이름 변경: g1.a → aa');
    const { watch, leave } = manualWatch();
    touchPieceEdit(undefined, g1, a, { service, watch });
    a.prompt = 'A1';
    touchPieceEdit(undefined, g1, a, { service, watch });
    a.prompt = 'A12';
    expect(hasOpenSceneFieldEdit()).toBe(true);
    leave();
    expect(service.peekLabel(undefined, 'undo')).toBe('전역 조각 내용 편집: g1.aa');
    const drag = beginPieceDrag(undefined, g1, { service });
    movePieceInLibrary(g1, 'c', 'aa');
    drag.commit();
    expect(names(g1)).toEqual(['c', 'aa', 'b']);
    expect(service.entries(GLOBAL_UNDO_SCOPE).past).toHaveLength(5);

    expect(await service.undo(undefined)).toBe(true); // 순서
    expect(names(g1)).toEqual(['aa', 'b', 'c']);
    expect(await service.undo(undefined)).toBe(true); // 내용
    expect(a.prompt).toBe('A');
    expect(await service.undo(undefined)).toBe(true); // 이름 — 되돌림 라벨 B → A
    expect(a.name).toBe('a');
    expect(g1.pieces[0]).toBe(a);
    expect(await service.undo(undefined)).toBe(true); // 랜덤 줄
    expect(a.multi).toBe(false);
    expect(await service.undo(undefined)).toBe(true); // 추가
    expect(names(g1)).toEqual(['a', 'b']);
    for (let i = 0; i < 5; i++) expect(await service.redo(undefined)).toBe(true);
    expect(names(g1)).toEqual(['c', 'aa', 'b']);
    expect(a.prompt).toBe('A12');
    expect(a.multi).toBe(true);
  });

  test('기록 밖 변경 = 확인 창 없이 실패 토스트 + 그 항목만 폐기', async () => {
    const { service, toast, confirm } = makeService();
    const g2 = globalMap.get('g2')!;
    editPieceLibrary(undefined, g2, (g) => UNDO_TEXT.pieceAdd(g, 'y'), () => {
      g2.pieces.push(Piece.fromJSON({ name: 'y', prompt: '', multi: false }));
    }, { service });
    g2.pieces[0].prompt = '다른 창이 바꿈';
    expect(await service.undo(undefined)).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    expect(toast).toHaveBeenLastCalledWith(expect.stringContaining('그사이 바뀌었습니다'), 'error');
    expect(service.entries(GLOBAL_UNDO_SCOPE).past).toHaveLength(0);
    expect(names(g2)).toEqual(['x', 'y']);
    // 이름 변경 항목도 같은 규칙(verify)
    renamePieceRecorded(undefined, g2, g2.pieces[1], 'yy', { service });
    g2.pieces.push(Piece.fromJSON({ name: 'z', prompt: '', multi: false }));
    expect(await service.undo(undefined)).toBe(false);
    expect(g2.pieces[1].name).toBe('yy');
  });

  test('불러오기·로컬 → 전역 복사 라벨, 프로젝트가 열려 있으면 로컬·전역 중 최근 것부터', async () => {
    const session = new Session();
    session.name = 'p';
    session.library.set('loc', lib('loc', ['l', 'L']));
    const { service } = makeService(() => session);
    editPieceGroups(session, globalMap, ['imp'], UNDO_TEXT.pieceGroupImport('imp'), () => globalMap.set('imp', lib('imp')), {
      service,
    });
    expect(service.peekLabel(session, 'undo')).toBe('전역 조각그룹 불러오기: imp');
    editPieceGroups(session, session.library, ['l2'], UNDO_TEXT.pieceGroupAdd('l2'), () => session.library.set('l2', lib('l2')), {
      service,
    });
    editPieceGroups(
      session,
      globalMap,
      ['loc'],
      UNDO_TEXT.pieceGroupToGlobal('loc', '새로'),
      () => globalMap.set('loc', PieceLibrary.fromJSON(session.library.get('loc')!.toJSON())),
      { service },
    );
    expect(service.peekLabel(session, 'undo')).toBe('로컬 조각그룹을 전역으로 복사(새로): loc'); // 「전역」 중복 없음
    expect(service.entries(session).past).toHaveLength(1);
    expect(service.entries(GLOBAL_UNDO_SCOPE).past).toHaveLength(2);
    expect(await service.undo(session)).toBe(true); // 전역 복사
    expect(globalMap.has('loc')).toBe(false);
    expect(await service.undo(session)).toBe(true); // 로컬 그룹 추가
    expect(session.library.has('l2')).toBe(false);
    expect(await service.undo(session)).toBe(true); // 전역 불러오기
    expect(globalMap.has('imp')).toBe(false);
  });

  test('배선이 없거나 다른 Map 이면 실행만(기록 없음)', () => {
    const { service } = makeService();
    const other = new Map<string, PieceLibrary>();
    editPieceGroups(undefined, other, ['z'], 'x', () => other.set('z', lib('z')), { service });
    expect(other.has('z')).toBe(true);
    expect(service.entries(GLOBAL_UNDO_SCOPE).past).toHaveLength(0);
  });

  test('호출부: PieceEditor 전역 그룹 삭제·복사도 헬퍼 경유(직접 deleteLibrary 단독 호출 없음)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'componenets/PieceEditor.tsx'), 'utf-8');
    expect(src).toMatch(/UNDO_TEXT\.pieceGroupToGlobal/);
    expect(src).not.toMatch(/\} else \{\s*globalPieceService\.deleteLibrary\(selectedPieceLibrary!\);/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('⑩-4 원본 씬으로 이미지 복사', () => {
  function variantOf(name: string, result: string): InpaintScene {
    const s = new InpaintScene();
    s.name = name;
    files.set(`inpaints/P/${name}/${result}`, `${name}:${result}`);
    return s;
  }

  test('복사(webp 유지) + 원본 휴지통 = 1항목, 되돌림 = 원본 복원·복사본 휴지통, 다시 실행 = 역순', async () => {
    const { service } = makeService();
    const { imageOps } = await makeOps();
    const org = scene('O', ['src.png', 'keep.png']);
    await fakeRefresh(null, org);
    const v = variantOf('V', 'r.webp');
    const session = makeSession('P', org);
    session.addScene(v);
    const seen: string[][] = [];
    const out = await copyImageToOriginalRecorded(
      session,
      org,
      'inpaints/P/V/r.webp',
      async (created) => {
        seen.push([...created]);
        return 'outs/P/O/src.png';
      },
      { service, imageOps },
    );
    expect(out).toEqual({ copied: true, sourceDeleted: true });
    expect(seen[0]).toHaveLength(1);
    const copy = seen[0][0];
    expect(copy.endsWith('.webp')).toBe(true); // E9 — 원본 형식 유지
    expect(org.imageMap).toEqual(['keep.png', copy]);
    expect(service.entries(session).past).toHaveLength(1);
    expect(service.peekLabel(session, 'undo')).toBe('원본 씬으로 이미지 복사: O');

    expect(await service.undo(session)).toBe(true);
    expect(org.imageMap.sort()).toEqual(['keep.png', 'src.png']);
    expect(files.has(`outs/P/O/${copy}`)).toBe(false);
    expect(files.get('outs/P/O/src.png')).toBe('O:src.png');

    expect(await service.redo(session)).toBe(true);
    expect(org.imageMap).toEqual(expect.arrayContaining(['keep.png', copy]));
    expect(org.imageMap).not.toContain('src.png');
    expect(files.has('inpaints/P/V/r.webp')).toBe(true); // 결과 이미지는 그대로
  });

  test('원본을 못 찾으면 복사만 기록, 복사 실패면 기록 없음', async () => {
    const { service } = makeService();
    const { imageOps } = await makeOps();
    const org = scene('O', ['src.png']);
    await fakeRefresh(null, org);
    const v = variantOf('V', 'r.png');
    const session = makeSession('P', org);
    session.addScene(v);
    const r1 = await copyImageToOriginalRecorded(session, org, 'inpaints/P/V/r.png', async () => undefined, {
      service,
      imageOps,
    });
    expect(r1).toEqual({ copied: true, sourceDeleted: false });
    expect(service.peekLabel(session, 'undo')).toBe('원본 씬으로 이미지 복사: O');
    expect(await service.undo(session)).toBe(true);
    expect(org.imageMap).toEqual(['src.png']);

    const r2 = await copyImageToOriginalRecorded(session, org, 'inpaints/P/V/none.png', async () => 'outs/P/O/src.png', {
      service,
      imageOps,
    });
    expect(r2).toEqual({ copied: false, sourceDeleted: false });
    expect(service.entries(session).past).toHaveLength(0);
    expect(files.has('outs/P/O/src.png')).toBe(true);
  });

  test('SceneQueueControl 은 raw deleteImageFiles·.png 고정 이름을 쓰지 않는다(소스 검사)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'componenets/SceneQueueControl.tsx'), 'utf-8');
    expect(src).toMatch(/copyImageToOriginalRecorded\(session, orgScene, path/);
    expect(src).not.toMatch(/await deleteImageFiles\(/);
    expect(src).not.toMatch(/Date\.now\(\)\.toString\(\)\}\.png/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('문구 — 찾기/바꾸기 기록 밖 범위', () => {
  test('global 범위 안내에 글로벌 캐릭터 프리셋 포함', () => {
    expect(FIND_REPLACE_UNRECORDED_LABEL.global).toBe('글로벌 프리셋·글로벌 캐릭터 프리셋');
  });
});
