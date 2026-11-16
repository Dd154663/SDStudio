// 다른 프로젝트로 씬 복사 공용 흐름(2026-11-16 M5 묶음 a, P4 + 피드백 1): 우클릭 메뉴·대량 작업 메뉴가 같은 흐름·같은 문구를 쓰고,
// 원본 프로젝트는 흐름 시작 때 고정, 변형 씬이 가리키는 첨부 파일(vibes·references)은 두 방식 모두 대상 프로젝트로 함께 복사한다.

import fs from 'fs';
import path from 'path';

jest.mock('..', () => ({
  backend: {},
  imageService: {},
  sessionService: {},
  templateService: {},
}));
jest.mock('../appStateRef', () => ({ getAppState: () => ({}) }));
jest.mock('../types', () => ({ genericSceneFromJSON: jest.fn() }));

import {
  copyScenesToProjectFlow,
  nextSceneCopyName,
  SCENE_COPY_TEXT,
  sceneAttachmentFiles,
  sceneCopyTargets,
  type SceneCopyDeps,
} from '../sceneCopyFlow';

interface FakeScene {
  type: 'scene' | 'inpaint';
  name: string;
  imageMap: string[];
  mains: string[];
  preset?: any;
}
interface FakeSession {
  name: string;
  scenes: FakeScene[];
  hasScene(type: string, name: string): boolean;
  addScene(s: FakeScene): void;
}

const makeSession = (name: string, scenes: FakeScene[] = []): FakeSession => ({
  name,
  scenes,
  hasScene(type, n) {
    return this.scenes.some((s) => s.type === type && s.name === n);
  },
  addScene(s) {
    this.scenes.push(s);
  },
});

const scene = (
  name: string,
  type: 'scene' | 'inpaint' = 'scene',
  imageMap: string[] = [],
  mains: string[] = [],
  preset?: any,
): FakeScene => ({ type, name, imageMap, mains, ...(preset ? { preset } : {}) });

const makeDeps = (opt: {
  projects?: string[];
  answers?: (string | undefined)[];
  sessions?: Record<string, FakeSession>;
  failCopy?: string[];
  /** 디스크에 있는 파일(첨부 파일 존재 확인용) */
  files?: string[];
}) => {
  const answers = [...(opt.answers ?? [])];
  const files = new Set(opt.files ?? []);
  const calls = {
    messages: [] as string[],
    dialogs: [] as any[],
    copies: [] as [string, string][],
    outputDirSessions: [] as string[],
    errors: [] as unknown[][],
    order: [] as string[],
  };
  const deps: SceneCopyDeps = {
    listProjects: () => opt.projects ?? [],
    pushMessage: (m) => calls.messages.push(m),
    ask: async (d) => {
      calls.dialogs.push(d);
      return answers.shift();
    },
    loadSession: async (n) => {
      const s = opt.sessions?.[n] as any;
      if (!s) return undefined;
      const add = s.addScene.bind(s);
      s.addScene = (x: FakeScene) => {
        calls.order.push('add:' + x.name);
        add(x);
      };
      return s;
    },
    cloneScene: (s: any) => ({
      ...s,
      imageMap: [...s.imageMap],
      mains: [...s.mains],
      ...(s.preset ? { preset: JSON.parse(JSON.stringify(s.preset)) } : {}),
    }),
    outputDir: (sess: any, sc: any) => {
      calls.outputDirSessions.push(sess.name);
      return `${sc.type === 'scene' ? 'outs' : 'inpaints'}/${sess.name}/${sc.name}`;
    },
    vibePath: (sess: any, n) => `vibes/${sess.name}/${n.split('/').pop()}`,
    encodedVibePath: (sess: any, n, info) => `vibes/${sess.name}/encoded/${n.split('/').pop()}&info=${info}`,
    referencePath: (sess: any, n) => `references/${sess.name}/${n.split('/').pop()}`,
    existFile: async (p) => files.has(p),
    copyFile: async (src, dst) => {
      if (opt.failCopy?.some((f) => src.endsWith('/' + f))) throw new Error('복사 실패');
      calls.copies.push([src, dst]);
      calls.order.push('copy:' + dst);
      files.add(dst);
    },
    logError: (...a) => calls.errors.push(a),
  };
  return { deps, calls, files };
};

describe('sceneCopyTargets', () => {
  test('현재 프로젝트를 빼고, 없으면 안내 토스트 + null', () => {
    const a = makeDeps({ projects: ['cur', 'A', 'B'] });
    expect(sceneCopyTargets(a.deps, 'cur')).toEqual(['A', 'B']);
    expect(a.calls.messages).toEqual([]);
    const b = makeDeps({ projects: ['cur'] });
    expect(sceneCopyTargets(b.deps, 'cur')).toBeNull();
    expect(b.calls.messages).toEqual([SCENE_COPY_TEXT.noTargets]);
  });
});

describe('nextSceneCopyName — 씬 `_n` 규칙(사용자 2026-11-14)', () => {
  test('비어 있으면 그대로, 겹치면 _1·_2…', () => {
    const taken = new Set(['A', 'A_1']);
    expect(nextSceneCopyName((n) => taken.has(n), 'B')).toBe('B');
    expect(nextSceneCopyName((n) => taken.has(n), 'A')).toBe('A_2');
  });
});

describe('문구 — 두 호출부 공통(피드백 1)', () => {
  test('대상 고르기 창 = 1개여도 숫자', () => {
    expect(SCENE_COPY_TEXT.targetPrompt(1)).toBe('씬 1개를 복사할 프로젝트를 선택하세요');
    expect(SCENE_COPY_TEXT.targetPrompt(3)).toBe('씬 3개를 복사할 프로젝트를 선택하세요');
  });

  test('결과 토스트 — 0개면 없음, 이미지 포함이면 이미지 장수(0장 포함), 첨부 파일은 0개면 생략', () => {
    const r = (mode: 'config' | 'with-images', sceneCount: number, imageCount = 5, attachmentCount = 0) => ({
      mode,
      targetName: 'T',
      sceneCount,
      imageCount,
      attachmentCount,
    });
    expect(SCENE_COPY_TEXT.result(r('config', 1))).toBe('씬 1개를 "T" 프로젝트에 복사했습니다');
    expect(SCENE_COPY_TEXT.result(r('config', 2, 0, 3))).toBe('씬 2개를 "T" 프로젝트에 복사했습니다 (첨부 파일 3개)');
    expect(SCENE_COPY_TEXT.result(r('with-images', 1))).toBe('씬 1개를 "T" 프로젝트에 복사했습니다 (이미지 5장)');
    expect(SCENE_COPY_TEXT.result(r('with-images', 2, 0))).toBe('씬 2개를 "T" 프로젝트에 복사했습니다 (이미지 0장)');
    expect(SCENE_COPY_TEXT.result(r('with-images', 4, 7, 2))).toBe(
      '씬 4개를 "T" 프로젝트에 복사했습니다 (이미지 7장, 첨부 파일 2개)',
    );
    expect(SCENE_COPY_TEXT.result(r('config', 0))).toBeUndefined();
    expect(SCENE_COPY_TEXT.result(r('with-images', 0, 0, 2))).toBeUndefined();
  });
});

describe('sceneAttachmentFiles — 씬 JSON 이 가리키는 프로젝트별 첨부 파일', () => {
  test('생성 씬·프리셋 없는 변형 씬·빈 값 = 없음', () => {
    const empty = { vibes: [], encodedVibes: [], references: [] };
    expect(sceneAttachmentFiles(scene('S', 'scene', [], [], { image: 'x.png' }))).toEqual(empty);
    expect(sceneAttachmentFiles(scene('V', 'inpaint'))).toEqual(empty);
    expect(sceneAttachmentFiles(null)).toEqual(empty);
    expect(
      sceneAttachmentFiles(scene('V', 'inpaint', [], [], { image: '', mask: '', vibes: [], characterReferences: [] })),
    ).toEqual(empty);
  });

  test('원본·마스크(.png 파일 이름만)·바이브(+인코딩 캐시)·레퍼런스(꺼진 것 포함), 중복 제거·마지막 `/` 뒤', () => {
    const files = sceneAttachmentFiles(
      scene('V', 'inpaint', [], [], {
        image: 'img.png',
        mask: 'mask.png',
        vibes: [
          { path: 'vibes/old/v1.png', info: 1, strength: 0.6 },
          { path: 'v1.png', info: 0.5, strength: 0.6 },
          { path: 'img.png', info: 1, strength: 0.6 },
          { path: '' },
        ],
        characterReferences: [
          { path: 'r1.png', enabled: false },
          { path: 'r1.png' },
          { path: 'r2.png' },
        ],
      }),
    );
    expect(files.vibes).toEqual(['img.png', 'mask.png', 'v1.png']);
    expect(files.encodedVibes).toEqual([
      { name: 'v1.png', info: 1 },
      { name: 'v1.png', info: 0.5 },
      { name: 'img.png', info: 1 },
    ]);
    expect(files.references).toEqual(['r1.png', 'r2.png']);
  });

  test('인라인 데이터(파일 이름이 아닌 값)는 대상 아님', () => {
    const files = sceneAttachmentFiles(scene('V', 'inpaint', [], [], { image: 'iVBORw0KGgoAAAANSUhEUg==', mask: 42 }));
    expect(files.vibes).toEqual([]);
  });
});

describe('copyScenesToProjectFlow', () => {
  const src = makeSession('cur');

  test('대상 고르기 취소 → 아무것도 하지 않음', async () => {
    const target = makeSession('T');
    const { deps, calls } = makeDeps({ answers: [undefined], sessions: { T: target } });
    const r = await copyScenesToProjectFlow(deps, {
      scenes: [scene('A') as any],
      targets: ['T'],
      sourceSession: src as any,
    });
    expect(r).toBeUndefined();
    expect(calls.dialogs).toHaveLength(1);
    expect(target.scenes).toEqual([]);
    expect(calls.messages).toEqual([]);
  });

  test('복사 방식 취소 → 아무것도 하지 않음', async () => {
    const target = makeSession('T');
    const { deps, calls } = makeDeps({ answers: ['T', undefined], sessions: { T: target } });
    await copyScenesToProjectFlow(deps, {
      scenes: [scene('A') as any],
      targets: ['T'],
      sourceSession: src as any,
    });
    expect(calls.dialogs.map((d) => d.text)).toEqual([
      SCENE_COPY_TEXT.targetPrompt(1),
      SCENE_COPY_TEXT.modePrompt,
    ]);
    expect(target.scenes).toEqual([]);
    expect(calls.messages).toEqual([]);
  });

  test('대상 불러오기 실패 → 안내', async () => {
    const { deps, calls } = makeDeps({ answers: ['T', 'config'] });
    const r = await copyScenesToProjectFlow(deps, {
      scenes: [scene('A') as any],
      targets: ['T'],
      sourceSession: src as any,
    });
    expect(r).toBeUndefined();
    expect(calls.messages).toEqual([SCENE_COPY_TEXT.loadFailed]);
  });

  test('설정만: imageMap·mains 를 비우고, 이름은 종류별 `_n`, 이미지 복사 없음', async () => {
    const target = makeSession('T', [scene('A'), scene('A_1'), scene('B', 'inpaint')]);
    const { deps, calls } = makeDeps({ answers: ['T', 'config'], sessions: { T: target } });
    const r = await copyScenesToProjectFlow(deps, {
      scenes: [scene('A', 'scene', ['1.png'], ['1.png']), scene('B', 'scene', ['2.png'])] as any,
      targets: ['T'],
      sourceSession: src as any,
    });
    expect(target.scenes.slice(3).map((s) => [s.type, s.name, s.imageMap, s.mains])).toEqual([
      ['scene', 'A_2', [], []],
      ['scene', 'B', [], []], // 변형 씬 B 와는 종류가 달라 겹치지 않는다
    ]);
    expect(calls.copies).toEqual([]);
    expect(r).toMatchObject({ targetName: 'T', mode: 'config', sceneCount: 2, imageCount: 0, attachmentCount: 0 });
    expect(calls.messages).toEqual(['씬 2개를 "T" 프로젝트에 복사했습니다']);
  });

  test('이미지 포함: 생성 씬 = outs, 변형 씬 = inpaints 폴더의 imageMap 파일을 새 이름 폴더로, 실패는 로그만', async () => {
    const target = makeSession('T', [scene('V', 'inpaint')]);
    const { deps, calls } = makeDeps({
      answers: ['T', 'with-images'],
      sessions: { T: target },
      failCopy: ['bad.png'],
    });
    const r = await copyScenesToProjectFlow(deps, {
      scenes: [
        scene('S', 'scene', ['a.png', 'bad.png'], ['a.png']),
        scene('V', 'inpaint', ['m.png']),
        scene('E', 'scene', []),
      ] as any,
      targets: ['T'],
      sourceSession: src as any,
    });
    expect(calls.copies).toEqual([
      ['outs/cur/S/a.png', 'outs/T/S/a.png'],
      ['inpaints/cur/V/m.png', 'inpaints/T/V_1/m.png'],
    ]);
    expect(calls.errors).toHaveLength(1);
    expect(calls.errors[0][0]).toBe('이미지 복사 실패:');
    // 이미지 포함이면 imageMap·mains 를 그대로 둔다
    expect(target.scenes.find((s) => s.name === 'S')!.mains).toEqual(['a.png']);
    expect(r).toMatchObject({ targetName: 'T', mode: 'with-images', sceneCount: 3, imageCount: 2 });
    expect(calls.messages).toEqual(['씬 3개를 "T" 프로젝트에 복사했습니다 (이미지 2장)']);
  });

  test('원본 프로젝트 = 흐름 시작 때 넘긴 값(도중에 바뀌지 않음)', async () => {
    const target = makeSession('T');
    const { deps, calls } = makeDeps({ answers: ['T', 'with-images'], sessions: { T: target } });
    await copyScenesToProjectFlow(deps, {
      scenes: [scene('A', 'scene', ['1.png']), scene('B', 'scene', ['2.png'])] as any,
      targets: ['T'],
      sourceSession: makeSession('first') as any,
    });
    expect(calls.outputDirSessions).toEqual(['first', 'T', 'first', 'T']);
  });

  test('복제 실패(null) 씬은 건너뛴다(토스트 없음)', async () => {
    const target = makeSession('T');
    const { deps, calls } = makeDeps({ answers: ['T', 'config'], sessions: { T: target } });
    deps.cloneScene = () => null;
    const r = await copyScenesToProjectFlow(deps, {
      scenes: [scene('A') as any],
      targets: ['T'],
      sourceSession: src as any,
    });
    expect(r!.sceneCount).toBe(0);
    expect(target.scenes).toEqual([]);
    expect(calls.messages).toEqual([]);
  });
});

describe('copyScenesToProjectFlow — 첨부 파일(피드백 1)', () => {
  const src = makeSession('cur');
  const variantPreset = {
    image: 'img.png',
    mask: 'mask.png',
    vibes: [{ path: 'v1.png', info: 1, strength: 0.6 }],
    characterReferences: [{ path: 'r1.png' }],
  };
  const srcFiles = [
    'vibes/cur/img.png',
    'vibes/cur/mask.png',
    'vibes/cur/v1.png',
    'vibes/cur/encoded/v1.png&info=1',
    'references/cur/r1.png',
  ];

  test.each(['config', 'with-images'])('%s: 변형 씬 원본·마스크·바이브(+캐시)·레퍼런스를 같은 이름으로 복사, 씬을 넣기 전에', async (mode) => {
    const target = makeSession('T');
    const { deps, calls } = makeDeps({ answers: ['T', mode], sessions: { T: target }, files: srcFiles });
    const r = await copyScenesToProjectFlow(deps, {
      scenes: [scene('V', 'inpaint', [], [], variantPreset)] as any,
      targets: ['T'],
      sourceSession: src as any,
    });
    expect(calls.copies).toEqual([
      ['vibes/cur/img.png', 'vibes/T/img.png'],
      ['vibes/cur/mask.png', 'vibes/T/mask.png'],
      ['vibes/cur/v1.png', 'vibes/T/v1.png'],
      ['references/cur/r1.png', 'references/T/r1.png'],
      ['vibes/cur/encoded/v1.png&info=1', 'vibes/T/encoded/v1.png&info=1'],
    ]);
    expect(calls.order[calls.order.length - 1]).toBe('add:V');
    // 씬 JSON 의 파일 이름은 그대로
    expect(target.scenes[0].preset.image).toBe('img.png');
    expect(r).toMatchObject({ attachmentCount: 4, attachmentSkipped: 0, attachmentMissing: 0 });
    expect(calls.messages).toEqual([
      mode === 'config'
        ? '씬 1개를 "T" 프로젝트에 복사했습니다 (첨부 파일 4개)'
        : '씬 1개를 "T" 프로젝트에 복사했습니다 (이미지 0장, 첨부 파일 4개)',
    ]);
  });

  test('대상에 같은 이름이 이미 있으면 덮어쓰지 않고 건너뜀', async () => {
    const target = makeSession('T');
    const { deps, calls } = makeDeps({
      answers: ['T', 'config'],
      sessions: { T: target },
      files: [...srcFiles, 'vibes/T/img.png', 'references/T/r1.png'],
    });
    const r = await copyScenesToProjectFlow(deps, {
      scenes: [scene('V', 'inpaint', [], [], variantPreset)] as any,
      targets: ['T'],
      sourceSession: src as any,
    });
    expect(calls.copies.map((c) => c[1])).toEqual([
      'vibes/T/mask.png',
      'vibes/T/v1.png',
      'vibes/T/encoded/v1.png&info=1',
    ]);
    expect(r).toMatchObject({ attachmentCount: 2, attachmentSkipped: 2, attachmentMissing: 0 });
  });

  test('원본 파일이 없으면 로그만 남기고 씬 복사는 계속(인코딩 캐시 없음은 조용히)', async () => {
    const target = makeSession('T');
    const { deps, calls } = makeDeps({
      answers: ['T', 'config'],
      sessions: { T: target },
      files: ['vibes/cur/img.png'],
    });
    const r = await copyScenesToProjectFlow(deps, {
      scenes: [scene('V', 'inpaint', [], [], variantPreset)] as any,
      targets: ['T'],
      sourceSession: src as any,
    });
    expect(calls.copies).toEqual([['vibes/cur/img.png', 'vibes/T/img.png']]);
    expect(calls.errors.map((e) => e[0])).toEqual([
      '첨부 파일 없음(건너뜀):',
      '첨부 파일 없음(건너뜀):',
      '첨부 파일 없음(건너뜀):',
    ]);
    expect(target.scenes.map((s) => s.name)).toEqual(['V']);
    expect(r).toMatchObject({ sceneCount: 1, attachmentCount: 1, attachmentMissing: 3 });
  });

  test('복사 실패도 로그만, 여러 씬이 같은 파일을 가리키면 한 번만', async () => {
    const target = makeSession('T');
    const { deps, calls } = makeDeps({
      answers: ['T', 'config'],
      sessions: { T: target },
      files: srcFiles,
      failCopy: ['mask.png'],
    });
    const r = await copyScenesToProjectFlow(deps, {
      scenes: [
        scene('V', 'inpaint', [], [], variantPreset),
        scene('V', 'inpaint', [], [], variantPreset),
      ] as any,
      targets: ['T'],
      sourceSession: src as any,
    });
    expect(target.scenes.map((s) => s.name)).toEqual(['V', 'V_1']);
    expect(calls.copies.filter((c) => c[1] === 'vibes/T/img.png')).toHaveLength(1);
    expect(calls.errors.map((e) => e[0])).toEqual(['첨부 파일 복사 실패:']);
    expect(r).toMatchObject({ sceneCount: 2, attachmentCount: 3, attachmentMissing: 1 });
  });

  test('참조 없는 씬(생성 씬·빈 변형 씬)은 첨부 복사 0', async () => {
    const target = makeSession('T');
    const { deps, calls } = makeDeps({ answers: ['T', 'config'], sessions: { T: target }, files: srcFiles });
    const r = await copyScenesToProjectFlow(deps, {
      scenes: [scene('S'), scene('V', 'inpaint', [], [], { image: '', mask: '', vibes: [] })] as any,
      targets: ['T'],
      sourceSession: src as any,
    });
    expect(calls.copies).toEqual([]);
    expect(r).toMatchObject({ sceneCount: 2, attachmentCount: 0 });
    expect(calls.messages).toEqual(['씬 2개를 "T" 프로젝트에 복사했습니다']);
  });
});

describe('두 호출부가 공용 흐름을 부른다', () => {
  const read = (rel: string) =>
    fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

  test.each(['componenets/AppContextMenu.tsx', 'models/BatchProcessService.ts'])('%s', (rel) => {
    const src = read(rel);
    expect(src).toMatch(/copyScenesToProjectFlow\(/);
    expect(src).not.toContain('복사 방식을 선택하세요');
    expect(src).not.toContain('caller:');
    // 원본 프로젝트는 값으로(함수로 늦게 해석하지 않는다)
    expect(src).not.toMatch(/sourceSession: \(\) =>/);
  });
});
