// 템플릿 적용 기록 사이드카 가드 (프로젝트 상속 마감, 2026-07-16 합의):
//  - recordApplication/getApplication 라운드트립 + 저장 페이로드
//  - getInheritedApplication(♟ 판정) / breakInheritance(상속 끊기·기록 유지)
//  - listInheritedChildren(전파 대상) / clearApplicationsByTemplateId(템플릿 삭제)
//  - 캐스케이드: 프로젝트 rename(키 이관)/remove(정리)
//  - 로드 방어: 형식이 깨진 기록은 걸러냄
//
// folderTemplates.test.ts 의 mock 패턴 재사용 (jest.mock('..'), ts-jest).

const files: Record<string, string> = {};
const backend = {
  existFile: jest.fn(async (p: string) => p in files),
  readFile: jest.fn(async (p: string) => {
    if (!(p in files)) throw new Error('no file');
    return files[p];
  }),
};

jest.mock('..', () => ({
  backend,
  sessionService: {
    list: () => [] as string[],
  },
  trashService: {},
  projectTemplateService: {
    ensureLoaded: async () => {},
    get: (_id: string) => undefined,
    delete: async () => {},
  },
}));

const writes: Array<{ path: string; data: string }> = [];
jest.mock('../PersistenceService', () => ({
  persistService: {
    write: jest.fn(async (path: string, data: string) => {
      writes.push({ path, data });
      files[path] = data;
    }),
  },
}));

const pushMessage = jest.fn();
jest.mock('../appStateRef', () => ({
  getAppState: () => ({ pushMessage }),
}));

import { TemplateService, ITemplateApplicationRecord } from '../TemplateService';

const lastSaved = () => JSON.parse(writes[writes.length - 1].data);

const rec = (
  over: Partial<ITemplateApplicationRecord> = {},
): ITemplateApplicationRecord => ({
  inherited: false,
  presets: [],
  characterPresetNames: [],
  vibePaths: [],
  referencePaths: [],
  ...over,
});

beforeEach(() => {
  for (const k of Object.keys(files)) delete files[k];
  writes.length = 0;
  pushMessage.mockClear();
});

describe('templateApplications — 기록 CRUD', () => {
  it('recordApplication + getApplication 라운드트립 + 저장 페이로드', async () => {
    const svc = new TemplateService();
    await svc.recordApplication(
      '프로젝트A',
      'tplA',
      rec({ inherited: true, presets: [{ type: 'SDImageGenEasy', name: 'P' }] }),
    );
    expect(svc.getApplication('프로젝트A', 'tplA')).toEqual(
      rec({ inherited: true, presets: [{ type: 'SDImageGenEasy', name: 'P' }] }),
    );
    const saved = lastSaved();
    expect(saved.templateApplications['프로젝트A']['tplA'].inherited).toBe(true);
    // 사이드카 다른 필드도 함께 저장되는지
    expect(saved.sceneTemplates).toEqual([]);
    expect(saved.folderTemplates).toEqual({});
  });

  it('한 프로젝트에 여러 템플릿 기록 공존', async () => {
    const svc = new TemplateService();
    await svc.recordApplication('P', 'tplA', rec({ inherited: true }));
    await svc.recordApplication('P', 'tplB', rec());
    expect(svc.getApplication('P', 'tplA')!.inherited).toBe(true);
    expect(svc.getApplication('P', 'tplB')!.inherited).toBe(false);
  });

  it('라운드트립: 저장 후 새 인스턴스에서 로드', async () => {
    const svc = new TemplateService();
    await svc.recordApplication('P', 'tplA', rec({ vibePaths: ['v1'] }));
    const svc2 = new TemplateService();
    await svc2.ensureLoaded();
    expect(svc2.getApplication('P', 'tplA')).toEqual(rec({ vibePaths: ['v1'] }));
  });
});

describe('getInheritedApplication / breakInheritance', () => {
  it('inherited=true 기록만 ♟ 판정으로 반환', async () => {
    const svc = new TemplateService();
    await svc.recordApplication('P', 'tplA', rec({ inherited: true }));
    const got = svc.getInheritedApplication('P');
    expect(got?.templateId).toBe('tplA');
    expect(svc.getInheritedApplication('없음')).toBeUndefined();
  });

  it('inherited=false 만 있으면 undefined', async () => {
    const svc = new TemplateService();
    await svc.recordApplication('P', 'tplA', rec({ inherited: false }));
    expect(svc.getInheritedApplication('P')).toBeUndefined();
  });

  it('breakInheritance: inherited=false 전환, 기록은 유지', async () => {
    const svc = new TemplateService();
    await svc.recordApplication(
      'P',
      'tplA',
      rec({ inherited: true, presets: [{ type: 'T', name: 'N' }] }),
    );
    await svc.breakInheritance('P');
    const got = svc.getApplication('P', 'tplA');
    expect(got!.inherited).toBe(false);
    // 기록(적용된 구성)은 유지
    expect(got!.presets).toEqual([{ type: 'T', name: 'N' }]);
    expect(svc.getInheritedApplication('P')).toBeUndefined();
  });
});

describe('listInheritedChildren — 전파 대상', () => {
  it('inherited=true 인 프로젝트만 수집', async () => {
    const svc = new TemplateService();
    await svc.recordApplication('자식1', 'tplA', rec({ inherited: true }));
    await svc.recordApplication('자식2', 'tplA', rec({ inherited: true }));
    await svc.recordApplication('끊김', 'tplA', rec({ inherited: false }));
    await svc.recordApplication('다른템플릿', 'tplB', rec({ inherited: true }));
    const children = svc.listInheritedChildren('tplA').sort();
    expect(children).toEqual(['자식1', '자식2']);
  });
});

describe('캐스케이드 — 프로젝트 rename/remove + 템플릿 삭제', () => {
  it('renameProject: 적용 기록 키 이관', async () => {
    const svc = new TemplateService();
    await svc.recordApplication('구이름', 'tplA', rec({ inherited: true }));
    await svc.renameProject('구이름', '새이름');
    expect(svc.getApplication('구이름', 'tplA')).toBeUndefined();
    expect(svc.getApplication('새이름', 'tplA')!.inherited).toBe(true);
  });

  it('removeProject: 적용 기록 정리', async () => {
    const svc = new TemplateService();
    await svc.recordApplication('P', 'tplA', rec());
    await svc.removeProject('P');
    expect(svc.getApplication('P', 'tplA')).toBeUndefined();
  });

  it('clearApplicationsByTemplateId: 해당 템플릿만 제거, 빈 프로젝트 정리, 무관 보존', async () => {
    const svc = new TemplateService();
    await svc.recordApplication('P1', 'tplA', rec());
    await svc.recordApplication('P1', 'tplB', rec()); // 같은 프로젝트의 다른 템플릿
    await svc.recordApplication('P2', 'tplA', rec()); // tplA 단독 → 프로젝트 통째 정리
    await svc.clearApplicationsByTemplateId('tplA');
    expect(svc.getApplication('P1', 'tplA')).toBeUndefined();
    expect(svc.getApplication('P1', 'tplB')).toBeDefined(); // 무관 템플릿 보존
    expect(svc.getApplication('P2', 'tplA')).toBeUndefined();
    // P2 는 남은 기록이 없어 통째로 정리
    expect(lastSaved().templateApplications['P2']).toBeUndefined();
  });
});

describe('로드 방어 — 형식이 깨진 기록 필터', () => {
  it('presets/이름 형식 검증 + 필드 기본값 채움', async () => {
    files['templates.json'] = JSON.stringify({
      version: 1,
      templateApplications: {
        정상: {
          tplA: {
            inherited: true,
            presets: [
              { type: 'T', name: 'N' },
              { type: 'T' }, // name 없음 → 걸러짐
            ],
            characterPresetNames: ['C', 123], // 숫자 걸러짐
            vibePaths: ['v1'],
            // referencePaths 누락 → 빈 배열
          },
        },
        깨짐: 'not-an-object', // 통째로 무시
      },
    });
    const svc = new TemplateService();
    await svc.ensureLoaded();
    const got = svc.getApplication('정상', 'tplA');
    expect(got).toEqual({
      inherited: true,
      presets: [{ type: 'T', name: 'N' }],
      characterPresetNames: ['C'],
      vibePaths: ['v1'],
      referencePaths: [],
    });
    expect(svc.getApplication('깨짐', 'tplA' as any)).toBeUndefined();
  });
});
