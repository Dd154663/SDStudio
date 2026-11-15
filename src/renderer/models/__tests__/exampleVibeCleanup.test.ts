// 잔존 예제 프리셋 이미지 정리(2026-11-15) — 순수 판정·검사(무쓰기)·정리(미참조만) 검사.
import { webcrypto } from 'crypto';
import {
  BUNDLED_EXAMPLE_PNGS,
  collectReferencedVibeFiles,
  collectVibeRefs,
  dataFileToBytes,
  deleteExampleVibes,
  isExampleCandidateSize,
  judgeVibeFile,
  matchExampleHash,
  normalizeVibeFileName,
  scanExampleVibes,
  sha256HexWebCrypto,
  summarizeExampleVibeScan,
} from '../exampleVibeCleanup';
import type { ExampleVibeItem, ExampleVibeScanDeps } from '../exampleVibeCleanup';

const [ANIME, ROUND, SHARP] = BUNDLED_EXAMPLE_PNGS;

describe('상수', () => {
  test('예제 3종의 크기·SHA-256', () => {
    expect(BUNDLED_EXAMPLE_PNGS.map((p) => [p.label, p.fileName, p.size, p.sha256])).toEqual([
      ['애니스타일', 'anime.png', 1172170, '6455e8b8f981af592e1c41af3d767c20ebfb5dbd6df87040d20e32942c2bde0c'],
      ['동글', 'round.png', 1421908, 'b12e9418ea33cae919c62949d71256179824b50b968cea9fc7b712bb29e955a1'],
      ['선명동글', 'sharpRound.png', 1374084, '2082aa701c539cd73945c9d344a7702a58a1eb8c79c20617d1d1337428e0c242'],
    ]);
  });
  test('크기 선별·해시 일치', () => {
    expect(isExampleCandidateSize(1172170)).toBe(true);
    expect(isExampleCandidateSize(1172171)).toBe(false);
    expect(matchExampleHash(ROUND.sha256.toUpperCase())).toBe(ROUND);
    expect(matchExampleHash('00'.repeat(32))).toBeUndefined();
  });
});

describe('참조 수집', () => {
  test('프리셋·캐릭터 프리셋·presetShareds·변형 씬·미러, 경로 접두 정규화', () => {
    const json = {
      presets: {
        SDImageGenEasy: [{ name: 'a', profile: 'p1.png' }],
        SDImageGen: [{ name: 'b', vibes: [{ path: 'vibes/proj/v1.png' }], characterReferences: [{ path: 'r1.png' }] }],
      },
      characterPresets: {
        c: { representativeImage: 'c-rep.png', vibes: [{ path: 'c-v.png' }], characterReferences: [{ path: 'c-r.png' }] },
      },
      presetShareds: {
        SDImageGen: { vibes: [{ path: 'workspace/proj__x/vibes/s-v.png' }], characterReferences: [{ path: 's-r.png' }] },
      },
      inpaints: { i1: { preset: { vibes: [{ path: 'i-v.png' }], profile: 'i-p.png' } } },
      mirrorImage: 'vibes\\proj\\m.png',
    };
    const refs = collectReferencedVibeFiles(json);
    for (const n of ['p1.png', 'v1.png', 'r1.png', 'c-rep.png', 'c-v.png', 'c-r.png', 's-v.png', 's-r.png', 'i-v.png', 'i-p.png', 'm.png']) {
      expect(refs.has(n)).toBe(true);
    }
    expect(refs.has('other.png')).toBe(false);
  });
  test('Map(메모리 세션 모양)도 훑는다', () => {
    const refs = collectReferencedVibeFiles({ presets: new Map([['x', [{ profile: 'mm.png' }]]]) });
    expect(refs.has('mm.png')).toBe(true);
    expect(normalizeVibeFileName('a/b/c.png')).toBe('c.png');
  });
});

describe('바이트·해시', () => {
  test('data URI·순수 base64 모두 바이트로, WebCrypto SHA-256', async () => {
    const g: any = globalThis;
    const had = g.crypto;
    if (!g.crypto?.subtle) Object.defineProperty(g, 'crypto', { value: webcrypto, configurable: true });
    try {
      const abc = dataFileToBytes('data:image/png;base64,YWJj');
      expect(Array.from(abc)).toEqual([97, 98, 99]);
      expect(Array.from(dataFileToBytes('YWJj'))).toEqual([97, 98, 99]);
      expect(await sha256HexWebCrypto(abc)).toBe(
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      );
    } finally {
      if (had !== g.crypto) Object.defineProperty(g, 'crypto', { value: had, configurable: true });
    }
  });
});

// 가짜 파일 시스템: 내용 문자열 → 바이트, 해시는 내용 문자열로 정한다
function makeDeps(opts: {
  projects: string[];
  files: Record<string, { name: string; size: number; content: string }[]>;
  jsons: Record<string, any>;
  loaded?: Record<string, any>;
  failJson?: string[];
}) {
  const hashOf: Record<string, string> = {
    ANIME: ANIME.sha256,
    ROUND: ROUND.sha256,
    SHARP: SHARP.sha256,
  };
  const reads: string[] = [];
  const deps: ExampleVibeScanDeps = {
    listProjects: () => opts.projects,
    loadedProject: (n) => opts.loaded?.[n],
    readProjectJson: async (n) => {
      if (opts.failJson?.includes(n)) throw new Error('read fail');
      return JSON.stringify(opts.jsons[n] ?? {});
    },
    listFilesWithStats: async (dir) => {
      const p = dir.split('/')[1];
      return (opts.files[p] ?? []).map((f) => ({ name: f.name, size: f.size, mtime: 0 }));
    },
    readDataFile: async (path) => {
      reads.push(path);
      const [, p, name] = path.split('/');
      const f = (opts.files[p] ?? []).find((x) => x.name === name)!;
      return 'data:image/png;base64,' + btoa(f.content);
    },
    sha256Hex: async (bytes) => hashOf[String.fromCharCode(...bytes)] ?? 'ff'.repeat(32),
  };
  return { deps, reads };
}

describe('검사(무쓰기)', () => {
  test('크기 선별 → 해시 일치만, 참조 중은 referenced', async () => {
    const { deps, reads } = makeDeps({
      projects: ['p1', 'p2'],
      files: {
        p1: [
          { name: 'a.png', size: ANIME.size, content: 'ANIME' },
          { name: 'b.png', size: ROUND.size, content: 'ROUND' },
          { name: 'user.png', size: ROUND.size, content: 'USERFILE' }, // 크기만 같고 내용 다름
          { name: 'small.png', size: 100, content: 'ANIME' }, // 크기 불일치 → 읽지도 않음
        ],
        p2: [{ name: 's.png', size: SHARP.size, content: 'SHARP' }],
      },
      jsons: { p1: { presets: { SDImageGenEasy: [{ profile: 'b.png' }] } }, p2: {} },
    });
    const res = await scanExampleVibes(deps);
    expect(reads).toEqual(['vibes/p1/a.png', 'vibes/p1/b.png', 'vibes/p1/user.png', 'vibes/p2/s.png']);
    expect(res.items).toEqual([
      { project: 'p1', fileName: 'a.png', label: '애니스타일', size: ANIME.size, referenced: false },
      { project: 'p1', fileName: 'b.png', label: '동글', size: ROUND.size, referenced: true },
      { project: 'p2', fileName: 's.png', label: '선명동글', size: SHARP.size, referenced: false },
    ]);
    expect(res.projectsScanned).toBe(2);
    expect(res.projectsFailed).toEqual([]);
    expect(res.removableBytes).toBe(ANIME.size + SHARP.size);
    const s = summarizeExampleVibeScan(res);
    expect(s.summary).toBe('프로젝트 2개 · 파일 2개 · 총 2.4 MB');
    expect(s.referencedNote).toContain('1개');
  });

  test('로드된(현재 열린) 프로젝트는 메모리 참조 기준 — 디스크엔 없어도 사용 중', async () => {
    const { deps } = makeDeps({
      projects: ['cur'],
      files: { cur: [{ name: 'a.png', size: ANIME.size, content: 'ANIME' }] },
      jsons: { cur: {} },
      loaded: { cur: { toJSON: () => ({ characterPresets: { x: { representativeImage: 'a.png' } } }) } },
    });
    const res = await scanExampleVibes(deps);
    expect(res.items[0].referenced).toBe(true);
  });

  test('읽기 실패 프로젝트는 projectsFailed 에 넣고 계속', async () => {
    const { deps } = makeDeps({
      projects: ['bad', 'ok'],
      files: {
        bad: [{ name: 'a.png', size: ANIME.size, content: 'ANIME' }],
        ok: [{ name: 'a.png', size: ANIME.size, content: 'ANIME' }],
      },
      jsons: { ok: {} },
      failJson: ['bad'],
    });
    const res = await scanExampleVibes(deps);
    expect(res.projectsFailed).toEqual(['bad']);
    expect(res.items.map((i) => i.project)).toEqual(['ok']);
  });
});

describe('정리', () => {
  const items: ExampleVibeItem[] = [
    { project: 'p1', fileName: 'a.png', label: '애니스타일', size: 1, referenced: false },
    { project: 'p1', fileName: 'b.png', label: '동글', size: 1, referenced: true },
    { project: 'p2', fileName: 'c.png', label: '선명동글', size: 1, referenced: false },
  ];

  test('PC: 미참조만 trashFile, 실패 시 deleteFile 폴백', async () => {
    const trashFile = jest.fn(async (p: string) => {
      if (p.endsWith('c.png')) throw new Error('no trash');
    });
    const deleteFile = jest.fn(async () => {});
    const prog: number[] = [];
    const res = await deleteExampleVibes(items, { isMobile: false, trashFile, deleteFile }, (d) => prog.push(d));
    expect(trashFile.mock.calls.map((c) => c[0])).toEqual(['vibes/p1/a.png', 'vibes/p2/c.png']);
    expect(deleteFile.mock.calls.map((c: any[]) => c[0])).toEqual(['vibes/p2/c.png']);
    expect(res).toEqual({ deleted: 2, failed: [], presetsRemoved: 0 });
    expect(prog).toEqual([1, 2]);
  });

  test('모바일: trashFile(영구) 사용, 실패 집계', async () => {
    const trashFile = jest.fn(async (p: string) => {
      if (p.endsWith('a.png')) throw new Error('fail');
    });
    const deleteFile = jest.fn(async () => {});
    const res = await deleteExampleVibes(items, { isMobile: true, trashFile, deleteFile });
    expect(deleteFile).not.toHaveBeenCalled();
    expect(res).toEqual({ deleted: 1, failed: ['p1/a.png'], presetsRemoved: 0 });
  });

  test('직전 참조 재확인 — 그사이 사용 중이 됐거나 확인 실패면 지우지 않는다', async () => {
    const trashFile = jest.fn(async () => {});
    const res = await deleteExampleVibes(items, {
      isMobile: false,
      trashFile,
      deleteFile: jest.fn(async () => {}),
      collectRefs: async (p) => {
        if (p === 'p2') throw new Error('x');
        return collectVibeRefs({ x: 'a.png' });
      },
    });
    expect(trashFile).not.toHaveBeenCalled();
    expect(res).toEqual({ deleted: 0, failed: ['p1/a.png', 'p2/c.png'], presetsRemoved: 0 });
  });
});

describe('퀵 생성 전용 프로젝트의 이지 모드 예제 프리셋', () => {
  const easyJson = (extra: any = {}) => ({
    presets: { SDImageGenEasy: [{ name: '동글', profile: 'a.png' }], SDImageGen: [] },
    ...extra,
  });
  const scanWith = async (project: string, json: any, quick: string | undefined) => {
    const { deps } = makeDeps({
      projects: [project],
      files: { [project]: [{ name: 'a.png', size: ROUND.size, content: 'ROUND' }] },
      jsons: { [project]: json },
    });
    deps.quickGenProjectName = () => quick;
    return scanExampleVibes(deps);
  };

  test('퀵 프로젝트 + SDImageGenEasy profile 만 참조 → 정리 대상 + easyPresets', async () => {
    const res = await scanWith('퀵 생성', easyJson(), '퀵 생성');
    expect(res.items[0]).toMatchObject({ referenced: false, easyPresets: ['동글'] });
    expect(res.removableBytes).toBe(ROUND.size);
    expect(summarizeExampleVibeScan(res).summary).toBe(
      '프로젝트 1개 · 파일 1개 · 총 1.4 MB · 이지 모드 프리셋 1개도 함께 제거',
    );
  });

  test('같은 파일을 다른 필드도 참조 → 사용 중', async () => {
    const res = await scanWith(
      '퀵 생성',
      easyJson({ characterPresets: { c: { representativeImage: 'a.png' } } }),
      '퀵 생성',
    );
    expect(res.items[0].referenced).toBe(true);
    expect(res.items[0].easyPresets).toBeUndefined();
  });

  test('일반 프로젝트의 SDImageGenEasy 참조 → 사용 중', async () => {
    const res = await scanWith('일반', easyJson(), '퀵 생성');
    expect(res.items[0].referenced).toBe(true);
    const res2 = await scanWith('일반', easyJson(), undefined);
    expect(res2.items[0].referenced).toBe(true);
  });

  test('판정 함수 — general 참조가 있으면 사용 중, profile 만이면 예외', () => {
    const refs = collectVibeRefs(easyJson());
    expect(refs.general.has('a.png')).toBe(false);
    expect(refs.easyProfiles.get('a.png')).toEqual(['동글']);
    expect(judgeVibeFile(refs, 'a.png', true)).toEqual({ referenced: false, easyPresets: ['동글'] });
    expect(judgeVibeFile(refs, 'a.png', false)).toEqual({ referenced: true });
  });

  const easyItem: ExampleVibeItem = {
    project: 'Q',
    fileName: 'a.png',
    label: '동글',
    size: 1,
    referenced: false,
    easyPresets: ['동글'],
  };

  test('정리: 프리셋 제거가 파일 삭제보다 먼저', async () => {
    const order: string[] = [];
    const res = await deleteExampleVibes([easyItem], {
      isMobile: false,
      quickGenProjectName: () => 'Q',
      collectRefs: async () => collectVibeRefs(easyJson()),
      removeEasyPreset: async (p, n, f) => {
        order.push(`preset:${p}:${n}:${f}`);
      },
      trashFile: async (path) => {
        order.push(`trash:${path}`);
      },
      deleteFile: async () => {},
    });
    expect(order).toEqual(['preset:Q:동글:a.png', 'trash:vibes/Q/a.png']);
    expect(res).toEqual({ deleted: 1, failed: [], presetsRemoved: 1 });
  });

  test('정리: 재확인이 어긋나거나(다른 참조 생김·퀵 아님·재확인 없음) 프리셋 제거 실패면 건너뜀', async () => {
    const removeEasyPreset = jest.fn(async () => {});
    const trashFile = jest.fn(async () => {});
    const base = { isMobile: false, trashFile, deleteFile: jest.fn(async () => {}), removeEasyPreset };
    const r1 = await deleteExampleVibes([easyItem], {
      ...base,
      quickGenProjectName: () => 'Q',
      collectRefs: async () => collectVibeRefs(easyJson({ mirrorImage: 'a.png' })),
    });
    const r2 = await deleteExampleVibes([easyItem], {
      ...base,
      quickGenProjectName: () => 'OTHER',
      collectRefs: async () => collectVibeRefs(easyJson()),
    });
    const r3 = await deleteExampleVibes([easyItem], base);
    expect(removeEasyPreset).not.toHaveBeenCalled();
    expect(trashFile).not.toHaveBeenCalled();
    for (const r of [r1, r2, r3]) expect(r).toEqual({ deleted: 0, failed: ['Q/a.png'], presetsRemoved: 0 });

    const r4 = await deleteExampleVibes([easyItem], {
      ...base,
      quickGenProjectName: () => 'Q',
      collectRefs: async () => collectVibeRefs(easyJson()),
      removeEasyPreset: async () => {
        throw new Error('세션 못 올림');
      },
    });
    expect(trashFile).not.toHaveBeenCalled();
    expect(r4).toEqual({ deleted: 0, failed: ['Q/a.png'], presetsRemoved: 0 });
  });
});
