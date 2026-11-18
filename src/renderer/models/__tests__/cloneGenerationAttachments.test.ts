// 앱 안 얕은 복제가 생성 쪽 첨부 파일도 옮긴다(2026-11-18 프리셋 유실 조사 경로 20).
//  · 로컬 캐릭터 프리셋의 대표 이미지·바이브(+인코딩 캐시)·캐릭터 레퍼런스, 공용 설정의 바이브·캐릭터 레퍼런스 → 새 프로젝트로 같은 이름 복사
//  · 공용 설정 바이브 목록을 비우지 않는다(복제 전용 keepSharedVibes) — 기본 얕은 내보내기는 종전대로 비운다
//  · 대상에 이미 있는 파일은 덮지 않음, 원본에 없는 파일은 경고만(복제는 계속)

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
import { sessionGenerationAttachmentFiles, mergeAttachmentFiles } from '../sceneCopyFlow';

const makeSource = () => {
  const json: any = {
    version: 1,
    name: 'P',
    presets: {},
    presetShareds: {
      SDImageGen: {
        type: 'SDImageGen',
        vibes: [{ path: 'shared-vibe.png', info: 1, strength: 0.6 }, { path: 'cp-vibe.png', fromPreset: 'Hero' }],
        characterReferences: [{ path: 'shared-ref.png' }],
      },
    },
    characterPresets: {
      Hero: {
        name: 'Hero',
        characterPrompt: 'hero',
        backgroundPrompt: '',
        vibes: [{ path: 'cp-vibe.png', info: 0.5, strength: 0.6 }],
        characterReferences: [{ path: 'cp-ref.png' }],
        representativeImage: 'cp-rep.png',
      },
    },
    scenes: {},
    inpaints: {},
    library: {},
  };
  return { name: 'P', toJSON: () => JSON.parse(JSON.stringify(json)) } as any;
};
const makeSvc = () => {
  const svc = new SessionService() as any;
  svc.createFrom = jest.fn(async (name: string, json: any) => {
    calls.push(`createFrom ${name}`);
    svc.__created = json;
  });
  svc.addSystemLog = jest.fn();
  return svc;
};

beforeEach(() => {
  calls.length = 0;
  existing.clear();
  jest.clearAllMocks();
});

describe('cloneSessionShallow — 생성 쪽 첨부 파일', () => {
  test('캐릭터 프리셋·공용 설정 파일을 createFrom 앞에 같은 이름으로 복사하고 바이브 목록을 남긴다', async () => {
    for (const f of ['shared-vibe.png', 'cp-vibe.png', 'cp-rep.png', 'encoded/cp-vibe.png&info=0.5'])
      existing.add('vibes/P/' + f);
    existing.add('references/P/shared-ref.png');
    existing.add('references/P/cp-ref.png');
    const svc = makeSvc();
    await svc.cloneSessionShallow(makeSource(), 'Q');
    const copies = calls.filter((c) => c.startsWith('copy'));
    expect(copies).toEqual(
      expect.arrayContaining([
        'copy vibes/P/cp-vibe.png -> vibes/Q/cp-vibe.png',
        'copy vibes/P/cp-rep.png -> vibes/Q/cp-rep.png',
        'copy vibes/P/shared-vibe.png -> vibes/Q/shared-vibe.png',
        'copy references/P/cp-ref.png -> references/Q/cp-ref.png',
        'copy references/P/shared-ref.png -> references/Q/shared-ref.png',
        'copy vibes/P/encoded/cp-vibe.png&info=0.5 -> vibes/Q/encoded/cp-vibe.png&info=0.5',
      ]),
    );
    expect(copies).toHaveLength(6);
    expect(calls[calls.length - 1]).toBe('createFrom Q');
    expect(svc.__created.presetShareds.SDImageGen.vibes.map((v: any) => v.path)).toEqual([
      'shared-vibe.png',
      'cp-vibe.png',
    ]);
    expect(svc.addSystemLog).not.toHaveBeenCalled();
  });

  test('대상에 이미 있는 파일은 덮지 않는다', async () => {
    existing.add('vibes/P/cp-vibe.png');
    existing.add('vibes/Q/cp-vibe.png'); // 대상에 이미 있음
    existing.add('references/P/cp-ref.png');
    const svc = makeSvc();
    await svc.cloneSessionShallow(makeSource(), 'Q');
    const copies = calls.filter((c) => c.startsWith('copy'));
    expect(copies).not.toContain('copy vibes/P/cp-vibe.png -> vibes/Q/cp-vibe.png');
    expect(copies).toContain('copy references/P/cp-ref.png -> references/Q/cp-ref.png');
  });

  test('원본에 없는 파일은 경고만 남기고 복제는 계속', async () => {
    const svc = makeSvc();
    await svc.cloneSessionShallow(makeSource(), 'Q');
    expect(calls.filter((c) => c.startsWith('copy'))).toHaveLength(0);
    expect(calls[calls.length - 1]).toBe('createFrom Q');
    expect(svc.addSystemLog).toHaveBeenCalledWith('warn', expect.stringContaining('5개'));
  });

  test('기본 얕은 내보내기(파일 내보내기·씬 템플릿·순차 생성)는 종전대로 공용 바이브를 비운다', async () => {
    const out = await makeSvc().exportSessionShallow(makeSource());
    expect(out.presetShareds.SDImageGen.vibes).toEqual([]);
    const withVariants = await makeSvc().exportSessionShallow(makeSource(), { includeVariants: true });
    expect(withVariants.presetShareds.SDImageGen.vibes).toEqual([]);
  });

  test('옵션 없는 importSessionShallow 는 파일을 복사하지 않는다', async () => {
    existing.add('vibes/P/cp-vibe.png');
    const svc = makeSvc();
    await svc.importSessionShallow(makeSource().toJSON(), 'R');
    expect(calls.filter((c) => c.startsWith('copy'))).toHaveLength(0);
  });
});

describe('sessionGenerationAttachmentFiles', () => {
  test('캐릭터 프리셋 + 공용 설정, 중복 제거, 대표 이미지가 레퍼런스면 vibes 에서 찾지 않음', () => {
    const files = sessionGenerationAttachmentFiles({
      characterPresets: {
        A: { vibes: [{ path: 'dir/v.png', info: 1 }], characterReferences: [{ path: 'r.png' }], representativeImage: 'r.png' },
        B: { vibes: [{ path: 'v.png' }], representativeImage: 'rep.png' },
        C: 'broken',
      },
      presetShareds: { X: { vibes: [{ path: 'v.png', info: 1 }], characterReferences: [{ path: 'r2.png' }, { path: 42 }] }, Y: null },
    });
    expect(files.vibes).toEqual(['v.png', 'rep.png']);
    expect(files.references).toEqual(['r.png', 'r2.png']);
    expect(files.encodedVibes).toEqual([{ name: 'v.png', info: 1 }]);
  });

  test('비어 있음·손상', () => {
    const empty = { vibes: [], encodedVibes: [], references: [] };
    expect(sessionGenerationAttachmentFiles(null)).toEqual(empty);
    expect(sessionGenerationAttachmentFiles({ characterPresets: [] as any, presetShareds: 'x' as any })).toEqual(empty);
  });

  test('mergeAttachmentFiles — 순서 유지·중복 제거', () => {
    const a = { vibes: ['1', '2'], encodedVibes: [{ name: '1', info: 1 }], references: ['r'] };
    const b = { vibes: ['2', '3'], encodedVibes: [{ name: '1', info: 1 }, { name: '3', info: 2 }], references: ['r', 's'] };
    expect(mergeAttachmentFiles(a, b)).toEqual({
      vibes: ['1', '2', '3'],
      encodedVibes: [{ name: '1', info: 1 }, { name: '3', info: 2 }],
      references: ['r', 's'],
    });
  });
});
