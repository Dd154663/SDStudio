// 얕은 복제에서 변형 씬 누락 수정(2026-11-16, 플랜 2026-11-16-shallow-clone-variant-scenes).
//  · exportSessionShallow 기본값 = 종전 그대로 변형 씬 버림(파일 내보내기·씬 템플릿·순차 생성)
//  · includeVariants = 변형 씬을 생성 씬과 같은 규칙(imageMap·mains·game·round 비움, imageAccounts 제거)으로 남김
//  · cloneSessionShallow = 위 + 변형 씬 첨부 파일(원본·마스크·바이브·인코딩 캐시·레퍼런스·미러 원본)을 createFrom 앞에 복사
//  · 옛 형식(inpaints 비어 있음)·옵션 없는 importSessionShallow 는 첨부 복사 없음
//  · 호출부: 폴더 복제·프로젝트 복제(이미지 미포함)만 cloneSessionShallow, 나머지는 기본값 유지

import * as fs from 'fs';
import * as path from 'path';

const calls: string[] = [];
const existing = new Set<string>();
const backend = {
  listFiles: jest.fn(async (_p: string) => [] as string[]),
  existFile: jest.fn(async (p: string) => existing.has(p)),
  readFile: jest.fn(async (_p: string) => '{}'),
  copyFile: jest.fn(async (src: string, dst: string) => {
    calls.push(`copy ${src} -> ${dst}`);
    existing.add(dst);
  }),
  writeFile: jest.fn(async () => {}),
  writeDataFile: jest.fn(async (p: string) => {
    calls.push(`write ${p}`);
  }),
};

jest.mock('..', () => {
  const { projectPath } = jest.requireActual('../projectPaths');
  const imageService = {
    fetchVibeImage: jest.fn(async () => 'data:image/png;base64,QUJD'),
    getVibesDir: (s: any) => projectPath('vibes', s.name),
    getVibeImagePath: (s: any, n: string) => projectPath('vibes', s.name) + '/' + n.split('/').pop(),
    getEncodedVibeImagePath: (s: any, n: string, info: number) =>
      projectPath('vibes', s.name, 'encoded') + '/' + n.split('/').pop() + '&info=' + info,
    getReferenceImagePath: (s: any, n: string) => projectPath('references', s.name) + '/' + n.split('/').pop(),
    getOutputDir: () => '',
  };
  return {
    backend,
    imageService,
    workFlowService: {},
    zipService: {},
    sessionService: {},
    templateService: { filterVisibleProjects: (x: string[]) => x },
    taskQueueService: { addLog: jest.fn() },
  };
});

jest.mock('../AppService', () => ({
  appState: { storageWriteGuard: true, pushMessage: jest.fn() },
}));
jest.mock('../appStateRef', () => ({
  getAppState: () => require('../AppService').appState,
}));

import { SessionService } from '../SessionService';
import { sessionVariantAttachmentFiles } from '../sceneCopyFlow';

const variantJson = () => ({
  name: 'V1',
  type: 'inpaint',
  workflowType: 'SDInpaint',
  resolution: 'portrait',
  imageMap: ['a.png', 'b.png'],
  mains: ['a.png'],
  game: [{ rank: 1, path: 'a.png' }],
  round: { players: ['a.png'], winMask: [true], curPlayer: 0 },
  imageAccounts: { 'a.png': 'acc' },
  sceneRef: 'S1',
  sourceImage: 'src.png',
  preset: {
    image: 'org.png',
    mask: 'mask.png',
    vibes: [{ path: 'vibe1.png', info: 0.7, strength: 0.6 }],
    characterReferences: [{ path: 'ref1.png' }],
  },
});

const makeSource = () => {
  const json: any = {
    version: 1,
    name: 'P',
    presets: {},
    presetShareds: { SDImageGen: { vibes: [{ path: 'shared.png' }] } },
    scenes: {
      S1: {
        name: 'S1',
        type: 'scene',
        resolution: 'portrait',
        slots: [],
        meta: {},
        imageMap: ['x.png'],
        mains: ['x.png'],
        imageAccounts: { 'x.png': 'acc' },
      },
    },
    inpaints: { V1: variantJson() },
    library: {},
    mirrorImage: 'mirror.png',
  };
  return { name: 'P', toJSON: () => JSON.parse(JSON.stringify(json)) } as any;
};

const makeSvc = () => {
  const svc = new SessionService() as any;
  svc.createFrom = jest.fn(async (name: string, json: any) => {
    calls.push(`createFrom ${name}`);
    svc.__created = json;
  });
  return svc;
};

beforeEach(() => {
  calls.length = 0;
  existing.clear();
  backend.copyFile.mockClear();
  backend.writeDataFile.mockClear();
});

describe('exportSessionShallow', () => {
  test('기본값은 종전 그대로 변형 씬을 버린다', async () => {
    const out = await makeSvc().exportSessionShallow(makeSource());
    expect(out.inpaints).toEqual({});
    expect(out.scenes.S1.imageMap).toEqual([]);
    expect(out.scenes.S1.mains).toEqual([]);
    expect(out.scenes.S1.imageAccounts).toBeUndefined();
    expect(out.presetShareds.SDImageGen.vibes).toEqual([]);
  });

  test('includeVariants = 변형 씬을 생성 씬과 같은 규칙으로 남긴다', async () => {
    const out = await makeSvc().exportSessionShallow(makeSource(), { includeVariants: true });
    const v = out.inpaints.V1;
    expect(v).toBeDefined();
    expect(v.imageMap).toEqual([]);
    expect(v.mains).toEqual([]);
    expect(v.game).toBeUndefined();
    expect(v.round).toBeUndefined();
    expect(v.imageAccounts).toBeUndefined();
    // 설정·연결 정보는 그대로
    expect(v.sceneRef).toBe('S1');
    expect(v.sourceImage).toBe('src.png');
    expect(v.preset).toEqual(variantJson().preset);
    // 생성 씬 쪽은 기본값과 같다
    expect(out.scenes.S1.imageMap).toEqual([]);
    expect(out.presetShareds.SDImageGen.vibes).toEqual([]);
  });
});

describe('cloneSessionShallow — 변형 씬 + 첨부 파일', () => {
  test('첨부 파일을 createFrom 앞에 같은 이름으로 복사하고 변형 씬을 넘긴다', async () => {
    const svc = makeSvc();
    // 원본에 있는 첨부 파일
    for (const f of ['org.png', 'mask.png', 'vibe1.png', 'mirror.png', 'encoded/vibe1.png&info=0.7'])
      existing.add('vibes/P/' + f);
    existing.add('references/P/ref1.png');

    await svc.cloneSessionShallow(makeSource(), 'Q');

    const copies = calls.filter((c) => c.startsWith('copy'));
    expect(copies).toEqual(
      expect.arrayContaining([
        'copy vibes/P/org.png -> vibes/Q/org.png',
        'copy vibes/P/mask.png -> vibes/Q/mask.png',
        'copy vibes/P/vibe1.png -> vibes/Q/vibe1.png',
        'copy vibes/P/mirror.png -> vibes/Q/mirror.png',
        'copy references/P/ref1.png -> references/Q/ref1.png',
        'copy vibes/P/encoded/vibe1.png&info=0.7 -> vibes/Q/encoded/vibe1.png&info=0.7',
      ]),
    );
    expect(copies).toHaveLength(6);
    // 순서: 첨부 복사가 전부 끝난 뒤 createFrom
    expect(calls[calls.length - 1]).toBe('createFrom Q');
    const created = svc.__created;
    expect(Object.keys(created.inpaints)).toEqual(['V1']);
    expect(created.inpaints.V1.preset.image).toBe('org.png');
    expect(created.inpaints.V1.imageMap).toEqual([]);
    expect(created.name).toBe('Q');
    // 원본에서 읽기·복사만(쓰기 대상에 원본 경로 없음)
    expect(copies.every((c) => c.split(' -> ')[1].includes('/Q/'))).toBe(true);
  });

  test('원본에 없는 첨부 파일은 건너뛰고 씬 복제는 계속한다', async () => {
    const svc = makeSvc();
    await svc.cloneSessionShallow(makeSource(), 'Q');
    expect(calls.filter((c) => c.startsWith('copy'))).toHaveLength(0);
    expect(calls[calls.length - 1]).toBe('createFrom Q');
    expect(Object.keys(svc.__created.inpaints)).toEqual(['V1']);
  });
});

describe('importSessionShallow — 옛 형식·옵션 없음', () => {
  test('inpaints 가 비어 있는 옛 파일은 종전대로 불러오고 첨부 복사를 하지 않는다', async () => {
    const svc = makeSvc();
    const old: any = {
      version: 1,
      name: 'old',
      presets: {},
      presetShareds: {},
      scenes: {},
      inpaints: {},
      library: {},
    };
    await svc.importSessionShallow(old, 'R');
    expect(calls).toEqual(['createFrom R']);
    expect(svc.__created.inpaints).toEqual({});
  });

  test('옵션 없이 변형 씬이 든 JSON 을 받아도 파일을 복사하지 않는다(파일 불러오기 경로 불변)', async () => {
    const svc = makeSvc();
    const json: any = makeSource().toJSON();
    await svc.importSessionShallow(json, 'R');
    expect(calls.filter((c) => c.startsWith('copy'))).toHaveLength(0);
  });
});

describe('sessionVariantAttachmentFiles', () => {
  test('변형 씬 전체 합 + 미러 원본, 중복 제거, 생성 씬·손상 값 무시', () => {
    const files = sessionVariantAttachmentFiles({
      inpaints: {
        A: variantJson(),
        B: { ...variantJson(), preset: { image: 'org.png', vibes: [{ path: 'vibe2.png' }] } },
        C: { type: 'scene', preset: { image: 'no.png' } },
        D: 'broken',
      },
      mirrorImage: 'mirror.png',
    });
    expect(files.vibes).toEqual(['org.png', 'mask.png', 'vibe1.png', 'vibe2.png', 'mirror.png']);
    expect(files.references).toEqual(['ref1.png']);
    expect(files.encodedVibes).toEqual([{ name: 'vibe1.png', info: 0.7 }]);
  });

  test('비어 있음·손상', () => {
    const empty = { vibes: [], encodedVibes: [], references: [] };
    expect(sessionVariantAttachmentFiles(null)).toEqual(empty);
    expect(sessionVariantAttachmentFiles({ inpaints: {} })).toEqual(empty);
    expect(sessionVariantAttachmentFiles({ inpaints: [] as any, mirrorImage: 42 })).toEqual(empty);
  });
});

describe('호출부 — 복제만 변형 씬 포함, 나머지는 종전 기본값', () => {
  const src = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  test('폴더 복제·프로젝트 복제(이미지 미포함)는 cloneSessionShallow', () => {
    const ss = src('SessionService.ts');
    const body = ss.slice(ss.indexOf('async cloneFolder('), ss.indexOf('// ===== 폴더 색상'));
    expect(body).toContain('this.cloneSessionShallow(session, newName)');
    expect(body).not.toContain('this.exportSessionShallow(');
    const bs = src('BackupService.ts');
    const dup = bs.slice(bs.indexOf('async duplicateProject('));
    expect(dup.slice(0, dup.indexOf('duplicateSessionDeep'))).toContain('sessionService.cloneSessionShallow(cur, newName)');
  });
  test('파일 내보내기·씬 템플릿·순차 생성은 includeVariants 를 쓰지 않는다', () => {
    for (const f of ['BackupService.ts', 'TemplateService.ts', 'CyclingSessionService.ts', 'AppService.ts']) {
      expect(src(f)).not.toMatch(/includeVariants/);
      expect(src(f)).not.toMatch(/attachmentsFrom/);
    }
  });
});
