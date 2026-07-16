// 일괄 생성 트랙 R1 선행 가드 (2026-07-16 합의):
//  A. 전역 캐릭터 프리셋 폴더 (1단계 평면) — setFolder 정규화 / listFolders
//     파생(중복 제거·정렬) / renameFolder 일괄 이관 / 로드 방어
//  B. 템플릿 배지 매직 컬러 — setBadgeColor 지정/해제(updatedAt 불변 =
//     전파 확인 미유발) / duplicate 유지 / overwriteFromTemplate 대상 색 보존

const files: Record<string, string> = {};
const backend = {
  readFile: jest.fn(async (p: string) => {
    if (!(p in files)) throw new Error('no file');
    return files[p];
  }),
  existFile: jest.fn(async () => false),
  renameFile: jest.fn(async (a: string, b: string) => {
    files[b] = files[a];
    delete files[a];
  }),
  readDataFile: jest.fn(async () => null),
  writeDataFile: jest.fn(async () => {}),
  deleteFile: jest.fn(async () => {}),
};

jest.mock('..', () => ({
  backend,
  imageService: {},
  sessionService: {},
  workFlowService: {},
  templateService: {
    clearFolderTemplatesByTemplateId: jest.fn(async () => {}),
    clearApplicationsByTemplateId: jest.fn(async () => {}),
  },
  globalPresetService: {},
  globalCharacterPresetService: {},
}));
jest.mock('../PersistenceService', () => ({
  persistService: {
    write: jest.fn(async (p: string, d: string) => {
      files[p] = d;
    }),
  },
}));
jest.mock('../appStateRef', () => ({
  getAppState: () => ({ pushMessage: jest.fn() }),
}));
// types 는 mobx-state-tree 등 무거운 모듈을 끌어오므로 스텁으로 대체
jest.mock('../types', () => ({
  VibeItem: { fromJSON: (j: any) => j },
  ReferenceItem: { fromJSON: (j: any) => j },
  CharacterPreset: { fromJSON: (j: any) => j },
  Session: class {},
}));
jest.mock('../ImageService', () => ({ dataUriToBase64: (s: string) => s }));
jest.mock('../imageFormats', () => ({ imageExtFromBase64: () => 'png' }));

import { GlobalCharacterPresetService } from '../GlobalCharacterPresetService';
import { ProjectTemplateService } from '../ProjectTemplateService';

const seedGlobalStore = (
  entries: Array<{ id: string; name: string; folder?: any }>,
) => {
  files['global_character_presets.json'] = JSON.stringify({
    version: 1,
    presets: entries.map((e) => ({
      id: e.id,
      name: e.name,
      createdAt: 1,
      updatedAt: 1,
      preset: { name: e.name, vibes: [], characterReferences: [] },
      ...(e.folder !== undefined ? { folder: e.folder } : {}),
    })),
  });
};

beforeEach(() => {
  for (const k of Object.keys(files)) delete files[k];
  jest.clearAllMocks();
});

describe('A. 전역 캐릭터 프리셋 폴더 (1단계 평면)', () => {
  it('setFolder: trim 정규화 + 빈 값/null 은 루트(undefined)', async () => {
    seedGlobalStore([{ id: 'a', name: 'A' }]);
    const svc = new GlobalCharacterPresetService();
    await svc.load();
    await svc.setFolder('a', '  캐릭터들  ');
    expect(svc.get('a')!.folder).toBe('캐릭터들');
    await svc.setFolder('a', '   ');
    expect(svc.get('a')!.folder).toBeUndefined();
    await svc.setFolder('a', '캐릭터들');
    await svc.setFolder('a', null);
    expect(svc.get('a')!.folder).toBeUndefined();
  });

  it('listFolders: 엔트리 파생 — 중복 제거·정렬, 빈 폴더는 자연 소멸', async () => {
    seedGlobalStore([
      { id: 'a', name: 'A', folder: '나폴더' },
      { id: 'b', name: 'B', folder: '가폴더' },
      { id: 'c', name: 'C', folder: '가폴더' },
      { id: 'd', name: 'D' },
    ]);
    const svc = new GlobalCharacterPresetService();
    await svc.load();
    expect(svc.listFolders()).toEqual(['가폴더', '나폴더']);
    // 항목이 전부 빠지면 폴더 소멸 (별도 레지스트리 없음)
    await svc.setFolder('a', null);
    expect(svc.listFolders()).toEqual(['가폴더']);
  });

  it('renameFolder: 해당 폴더 엔트리 일괄 이관, 무관 엔트리 보존', async () => {
    seedGlobalStore([
      { id: 'a', name: 'A', folder: '구폴더' },
      { id: 'b', name: 'B', folder: '구폴더' },
      { id: 'c', name: 'C', folder: '다른폴더' },
    ]);
    const svc = new GlobalCharacterPresetService();
    await svc.load();
    await svc.renameFolder('구폴더', '새폴더');
    expect(svc.get('a')!.folder).toBe('새폴더');
    expect(svc.get('b')!.folder).toBe('새폴더');
    expect(svc.get('c')!.folder).toBe('다른폴더');
    expect(svc.listFolders()).toEqual(['다른폴더', '새폴더']);
  });

  it('로드 방어: 비문자열/빈 folder 는 루트로 정규화', async () => {
    seedGlobalStore([
      { id: 'a', name: 'A', folder: 123 },
      { id: 'b', name: 'B', folder: '' },
      { id: 'c', name: 'C', folder: '정상' },
    ]);
    const svc = new GlobalCharacterPresetService();
    await svc.load();
    expect(svc.get('a')!.folder).toBeUndefined();
    expect(svc.get('b')!.folder).toBeUndefined();
    expect(svc.get('c')!.folder).toBe('정상');
  });

  it('라운드트립: 저장 후 새 인스턴스 로드에서 folder 유지', async () => {
    seedGlobalStore([{ id: 'a', name: 'A' }]);
    const svc = new GlobalCharacterPresetService();
    await svc.load();
    await svc.setFolder('a', '폴더1');
    await svc.flushSave();
    const svc2 = new GlobalCharacterPresetService();
    await svc2.load();
    expect(svc2.get('a')!.folder).toBe('폴더1');
  });
});

describe('B. 템플릿 배지 매직 컬러', () => {
  it('setBadgeColor: 지정/해제 + updatedAt 불변(전파 확인 미유발)', async () => {
    const svc = new ProjectTemplateService();
    (svc as any).loaded = true;
    const entry = await svc.create('T');
    const before = entry.updatedAt;
    await svc.setBadgeColor(entry.id, '#22c55e');
    expect(svc.get(entry.id)!.badgeColor).toBe('#22c55e');
    expect(svc.get(entry.id)!.updatedAt).toBe(before);
    await svc.setBadgeColor(entry.id, null);
    expect(svc.get(entry.id)!.badgeColor).toBeUndefined();
    expect(svc.get(entry.id)!.updatedAt).toBe(before);
  });

  it('duplicate: badgeColor 사본 유지', async () => {
    const svc = new ProjectTemplateService();
    (svc as any).loaded = true;
    const entry = await svc.create('T');
    await svc.setBadgeColor(entry.id, '#ec4899');
    const clone = await svc.duplicate(entry.id);
    expect(clone.badgeColor).toBe('#ec4899');
  });

  it('overwriteFromTemplate: 대상의 badgeColor 보존(소스 색으로 덮지 않음)', async () => {
    const svc = new ProjectTemplateService();
    (svc as any).loaded = true;
    const target = await svc.create('폴더로컬');
    const source = await svc.create('전역소스');
    await svc.setBadgeColor(target.id, '#0ea5e9');
    await svc.setBadgeColor(source.id, '#ef4444');
    await svc.patchPreset(source.id, { frontPrompt: '소스 프롬프트' });
    await svc.overwriteFromTemplate(target.id, source.id);
    const after = svc.get(target.id)!;
    // 구성은 덮였지만 배지 색(폴더 지정의 정체성)은 대상 것 유지
    expect(after.preset?.frontPrompt).toBe('소스 프롬프트');
    expect(after.badgeColor).toBe('#0ea5e9');
  });

  it('로드 방어: badgeColor 비문자열은 무시', async () => {
    files['project_templates.json'] = JSON.stringify({
      version: 1,
      templates: [
        {
          id: 't1',
          name: 'T1',
          createdAt: 1,
          updatedAt: 1,
          preset: null,
          characterPresets: [],
          scenes: [],
          badgeColor: 123,
        },
        {
          id: 't2',
          name: 'T2',
          createdAt: 1,
          updatedAt: 1,
          preset: null,
          characterPresets: [],
          scenes: [],
          badgeColor: '#f59e0b',
        },
      ],
    });
    const svc = new ProjectTemplateService();
    await svc.load();
    expect(svc.get('t1')!.badgeColor).toBeUndefined();
    expect(svc.get('t2')!.badgeColor).toBe('#f59e0b');
  });
});
