// 프로젝트 템플릿 백업(드라이브 동기화 C안 ④, 2026-09-28):
//  - 내보내기 엔트리 수집: 전역 템플릿만(폴더 로컬 제외)·배지 색 제거·참조 이미지만
//  - 이미지 토큰 재지정: 새 파일명으로 교체, 백업에 없는 참조는 버림, 입력 불변
//  - 이름 충돌 계산: 전역 템플릿 이름 기준, 새 이름 (2)…, 건너뛰기, 덮어쓰기(id 유지·1회)
//  - 서비스 복원: 덮어쓰기는 id·배지 색 유지 + 옛 이미지 정리, 추가는 새 id·새 파일명

const files: Record<string, string> = {};
let seq = 0;
const backend = {
  readFile: jest.fn(async (p: string) => {
    if (!(p in files)) throw new Error('no file');
    return files[p];
  }),
  existFile: jest.fn(async (p: string) => p in files),
  copyFile: jest.fn(async (src: string, dest: string) => {
    files[dest] = files[src];
  }),
  deleteFile: jest.fn(async (p: string) => {
    delete files[p];
  }),
  renameFile: jest.fn(async () => {}),
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
jest.mock('../appStateRef', () => ({ getAppState: () => ({}) }));
jest.mock('../ImageService', () => ({ dataUriToBase64: (s: string) => s }));
jest.mock('../imageFormats', () => ({ imageExtFromBase64: () => 'png' }));
jest.mock('../types', () => ({
  VibeItem: { fromJSON: (j: any) => j },
  ReferenceItem: { fromJSON: (j: any) => j },
  CharacterPreset: { fromJSON: (j: any) => j },
  Session: class {},
}));
jest.mock('uuid', () => ({ v4: () => `n${++seq}` }));

import {
  buildTemplateBackupStore,
  collectTemplateImageTokens,
  globalTemplateNames,
  imageFileExt,
  isSafeImageToken,
  planTemplateImport,
  readBackupTemplates,
  remapTemplateImages,
} from '../projectTemplateBackup';
import { ProjectTemplateService } from '../ProjectTemplateService';

const tpl = (over: Record<string, any>): any => ({
  id: 'x',
  name: 'x',
  createdAt: 1,
  updatedAt: 1,
  preset: null,
  characterPresets: [],
  vibes: [],
  characterReferences: [],
  scenes: [],
  ...over,
});

const full = tpl({
  id: 'g1',
  name: '기본',
  preset: { name: 'p', profile: 'prof.png' },
  characterPresets: [
    {
      name: 'c',
      vibes: [{ path: 'cv.webp' }],
      characterReferences: [{ path: 'cr.png' }],
      representativeImage: 'rep.png',
    },
  ],
  vibes: [{ path: 'v.png', strength: 0.6 }],
  characterReferences: [{ path: 'r.png' }],
  scenes: [{ name: 's1' }],
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  for (const k of Object.keys(files)) delete files[k];
  seq = 0;
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('엔트리 수집', () => {
  it('이미지 토큰 6자리 전부', () => {
    expect(collectTemplateImageTokens(full).sort()).toEqual(
      ['prof.png', 'cv.webp', 'cr.png', 'rep.png', 'v.png', 'r.png'].sort(),
    );
  });

  it('전역 템플릿만 담고 폴더 로컬·배지 색은 뺀다, 이미지는 참조한 것만·중복 없이', () => {
    const local = tpl({
      id: 'f1',
      name: '폴더 기본 (A)',
      folderLocal: true,
      badgeColor: '#f00',
      vibes: [{ path: 'local.png' }],
    });
    const other = tpl({
      id: 'g2',
      name: '둘째',
      badgeColor: '#0f0',
      vibes: [{ path: 'v.png' }, { path: 'sub/../x.png' }, { path: '..' }],
    });
    const { store, imageFiles } = buildTemplateBackupStore([full, local, other]);
    expect(store.version).toBe(1);
    expect(store.templates.map((t) => t.id)).toEqual(['g1', 'g2']);
    expect('badgeColor' in store.templates[1]).toBe(false);
    expect('folderLocal' in store.templates[1]).toBe(false);
    // 경로 조각은 파일명만(앱의 getImagePath 와 같은 해석), '..' 같은 이상한 이름은 뺀다
    expect(imageFiles.sort()).toEqual(
      ['prof.png', 'cv.webp', 'cr.png', 'rep.png', 'v.png', 'r.png', 'x.png'].sort(),
    );
    // 입력은 바꾸지 않는다
    expect(other.badgeColor).toBe('#0f0');
  });

  it('이미지 파일명 안전 검사·확장자', () => {
    expect(isSafeImageToken('a1-b.png')).toBe(true);
    expect(isSafeImageToken('..')).toBe(false);
    expect(isSafeImageToken('a..png')).toBe(false);
    expect(isSafeImageToken('.hidden')).toBe(false);
    expect(isSafeImageToken('a\\b.png')).toBe(false);
    expect(isSafeImageToken('')).toBe(false);
    expect(imageFileExt('a.WEBP')).toBe('webp');
    expect(imageFileExt('noext')).toBe('png');
  });

  it('백업 읽기: 폴더 로컬·이름 없음 제외, 구형 presets 승격, 배열 기본값', () => {
    const list = readBackupTemplates({
      templates: [
        { name: ' 가 ', presets: [{ name: 'old' }] },
        { name: '', vibes: [] },
        { name: '로컬', folderLocal: true },
        { name: '나', vibes: 'bad' },
      ],
    });
    expect(list.map((t) => t.name)).toEqual(['가', '나']);
    expect(list[0].preset).toEqual({ name: 'old' });
    expect(list[1].vibes).toEqual([]);
    expect(readBackupTemplates(null)).toEqual([]);
  });
});

describe('이미지 토큰 재지정', () => {
  it('새 파일명으로 바꾸고 없는 참조는 버린다(입력 불변)', () => {
    const map = new Map([
      ['prof.png', 'n-prof.png'],
      ['cv.webp', 'n-cv.webp'],
      ['v.png', 'n-v.png'],
    ]);
    const out = remapTemplateImages(full, map);
    expect(out.preset.profile).toBe('n-prof.png');
    expect(out.characterPresets[0].vibes).toEqual([{ path: 'n-cv.webp' }]);
    expect(out.characterPresets[0].characterReferences).toEqual([]);
    expect('representativeImage' in out.characterPresets[0]).toBe(false);
    expect(out.vibes).toEqual([{ path: 'n-v.png', strength: 0.6 }]);
    expect(out.characterReferences).toEqual([]);
    expect(out.scenes).toEqual([{ name: 's1' }]);
    expect(full.preset.profile).toBe('prof.png');
    expect(full.vibes[0].path).toBe('v.png');
  });
});

describe('이름 충돌 계획', () => {
  const existing = [
    { id: 'g1', name: '기본' },
    { id: 'g2', name: '기본 (2)' },
    { id: 'f1', name: '폴더 기본 (A)', folderLocal: true },
  ];

  it('충돌 개수 기준 = 전역 템플릿 이름', () => {
    expect(globalTemplateNames(existing)).toEqual(['기본', '기본 (2)']);
  });

  it('새 이름으로 추가: 전 템플릿 이름·파일 안 중복까지 피한다', () => {
    expect(
      planTemplateImport(['기본', '기본', '폴더 기본 (A)', '새'], existing, 'rename'),
    ).toEqual([
      { kind: 'add', name: '기본 (3)' },
      { kind: 'add', name: '기본 (4)' },
      { kind: 'add', name: '폴더 기본 (A) (2)' },
      { kind: 'add', name: '새' },
    ]);
  });

  it('건너뛰기: 전역 충돌만 건너뛰고 폴더 로컬과만 같은 이름은 새 이름으로', () => {
    expect(
      planTemplateImport(['기본', '폴더 기본 (A)'], existing, 'skip'),
    ).toEqual([{ kind: 'skip' }, { kind: 'add', name: '폴더 기본 (A) (2)' }]);
  });

  it('덮어쓰기: 기존 id 대상, 한 기존 항목은 한 번만', () => {
    expect(
      planTemplateImport(['기본', '기본', '새'], existing, 'overwrite'),
    ).toEqual([
      { kind: 'overwrite', targetId: 'g1' },
      { kind: 'add', name: '기본 (3)' },
      { kind: 'add', name: '새' },
    ]);
  });
});

describe('ProjectTemplateService.restoreFromBackupDir', () => {
  const root = 'tmp/r';
  const seedBackup = (templates: any[]) => {
    files[root + '/project_templates.json'] = JSON.stringify({
      version: 1,
      templates,
    });
  };

  it('덮어쓰기는 id·배지 색 유지 + 새 이미지 복사 + 옛 이미지 정리', async () => {
    const svc = new ProjectTemplateService();
    svc.loaded = true;
    svc.templates = [
      tpl({
        id: 'keep',
        name: '기본',
        badgeColor: '#abc',
        vibes: [{ path: 'old.png' }],
      }),
    ];
    files['project_template_images/old.png'] = 'OLD';
    files[root + '/project_template_images/v.png'] = 'NEW';
    seedBackup([
      tpl({ id: 'src', name: '기본', vibes: [{ path: 'v.png' }], scenes: [{ name: 's' }] }),
    ]);
    const res = await svc.restoreFromBackupDir(root, 'overwrite');
    expect(res).toEqual({ added: 0, skipped: 0, overwritten: 1 });
    expect(svc.templates).toHaveLength(1);
    const t = svc.templates[0];
    expect(t.id).toBe('keep');
    expect(t.badgeColor).toBe('#abc');
    expect(t.scenes).toEqual([{ name: 's' }]);
    expect(t.vibes).toEqual([{ path: 'n1.png' }]);
    expect(files['project_template_images/n1.png']).toBe('NEW');
    expect('project_template_images/old.png' in files).toBe(false);
  });

  it('추가는 새 id·새 파일명, 건너뛰기 집계', async () => {
    const svc = new ProjectTemplateService();
    svc.loaded = true;
    svc.templates = [tpl({ id: 'g1', name: '기본' })];
    files[root + '/project_template_images/p.png'] = 'P';
    seedBackup([
      tpl({ id: 'src1', name: '기본' }),
      tpl({ id: 'src2', name: '새', preset: { name: 'p', profile: 'p.png' } }),
    ]);
    const res = await svc.restoreFromBackupDir(root, 'skip');
    expect(res).toEqual({ added: 1, skipped: 1, overwritten: 0 });
    const added = svc.templates[1];
    expect(added.name).toBe('새');
    expect(added.id).not.toBe('src2');
    expect(added.preset.profile).toMatch(/^n\d+\.png$/);
    expect(files['project_template_images/' + added.preset.profile]).toBe('P');
    expect(added.folderLocal).toBeUndefined();
  });

  it('백업 JSON 이 없으면 오류', async () => {
    const svc = new ProjectTemplateService();
    svc.loaded = true;
    await expect(svc.restoreFromBackupDir(root, 'rename')).rejects.toThrow(
      '백업에 프로젝트 템플릿 데이터가 없습니다',
    );
  });
});
