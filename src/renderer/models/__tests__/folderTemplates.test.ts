// 폴더 기본 템플릿 사이드카 가드 (프로젝트 상속 v2, 2026-07-16 합의):
//  - 지정/해제 + 저장 페이로드 (templateId 참조 — 엔티티 id 불변)
//  - resolveFolderTemplate: 조상 폴더 탐색(가까운 순) + stale(엔티티 삭제) 스킵
//  - 캐스케이드: 폴더 rename(프리픽스)/remove, 템플릿 삭제 시 지정 해제
//  - (구) templates 필드(폐기된 '프로젝트를 템플릿으로 지정')는 로드 시 무시

const files: Record<string, string> = {};
const backend = {
  existFile: jest.fn(async (p: string) => p in files),
  readFile: jest.fn(async (p: string) => {
    if (!(p in files)) throw new Error('no file');
    return files[p];
  }),
};
// 프로젝트 템플릿 엔티티 존재 여부 (resolve 검증용 mock)
let templateEntities: Record<
  string,
  { id: string; name: string; folderLocal?: boolean }
> = {};
const mockDeleteTemplate = jest.fn(async (id: string) => {
  delete templateEntities[id];
});

// 프로젝트 목록 mock (퀵 생성 전용 프로젝트 생성 검증용)
const mockProjects: string[] = [];
jest.mock('..', () => ({
  backend,
  sessionService: {
    list: () => [...mockProjects],
    add: jest.fn(async (name: string) => {
      mockProjects.push(name);
    }),
    get: jest.fn(async (name: string) =>
      mockProjects.includes(name) ? { name } : null,
    ),
  },
  trashService: {},
  projectTemplateService: {
    ensureLoaded: async () => {},
    get: (id: string) => templateEntities[id],
    delete: mockDeleteTemplate,
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

import { TemplateService } from '../TemplateService';

const lastSaved = () => JSON.parse(writes[writes.length - 1].data);

beforeEach(() => {
  for (const k of Object.keys(files)) delete files[k];
  writes.length = 0;
  mockProjects.length = 0;
  templateEntities = {
    tplA: { id: 'tplA', name: '템플릿A' },
    tplB: { id: 'tplB', name: '템플릿B' },
  };
  pushMessage.mockClear();
  mockDeleteTemplate.mockClear();
});

describe('folderTemplates — 지정/해제/저장', () => {
  it('setFolderTemplate 저장 페이로드에 sceneTemplates·folderTemplates 포함', async () => {
    const svc = new TemplateService();
    await svc.setFolderTemplate('캐릭터들', 'tplA');
    expect(svc.getFolderTemplate('캐릭터들')).toEqual({ templateId: 'tplA' });
    const saved = lastSaved();
    expect(saved.sceneTemplates).toEqual([]);
    expect(saved.folderTemplates).toEqual({
      캐릭터들: { templateId: 'tplA' },
    });
  });

  it('clearFolderTemplate 로 해제', async () => {
    const svc = new TemplateService();
    await svc.setFolderTemplate('캐릭터들', 'tplA');
    await svc.clearFolderTemplate('캐릭터들');
    expect(svc.getFolderTemplate('캐릭터들')).toBeUndefined();
    expect(lastSaved().folderTemplates).toEqual({});
  });

  it('로드: 형식이 깨진 엔트리(templateId 없음)는 걸러냄 + (구) templates 필드 무시', async () => {
    files['templates.json'] = JSON.stringify({
      version: 1,
      templates: ['구버전프로젝트템플릿'], // 폐기된 기능의 잔존 데이터 — 무시
      sceneTemplates: ['씬템플릿1'],
      folderTemplates: {
        정상: { templateId: 'tplA' },
        깨짐1: { name: '구v1형식' },
        깨짐2: 'tplB',
      },
    });
    const svc = new TemplateService();
    await svc.ensureLoaded();
    expect(Object.keys(svc.folderTemplates)).toEqual(['정상']);
    expect(svc.isSceneTemplate('씬템플릿1')).toBe(true);
  });

  it('라운드트립: 저장 후 새 인스턴스 로드', async () => {
    const svc = new TemplateService();
    await svc.setFolderTemplate('상위/하위', 'tplB');
    const svc2 = new TemplateService();
    await svc2.ensureLoaded();
    expect(svc2.getFolderTemplate('상위/하위')).toEqual({
      templateId: 'tplB',
    });
  });
});

describe('resolveFolderTemplate — 조상 탐색 + stale 스킵', () => {
  it('직속 폴더 지정이 최우선', async () => {
    const svc = new TemplateService();
    await svc.setFolderTemplate('상위', 'tplA');
    await svc.setFolderTemplate('상위/하위', 'tplB');
    expect(await svc.resolveFolderTemplate('상위/하위')).toEqual({
      folder: '상위/하위',
      templateId: 'tplB',
    });
  });

  it('직속에 없으면 가까운 조상부터 탐색', async () => {
    const svc = new TemplateService();
    await svc.setFolderTemplate('상위', 'tplA');
    expect(await svc.resolveFolderTemplate('상위/하위/손자')).toEqual({
      folder: '상위',
      templateId: 'tplA',
    });
  });

  it('stale 지정(템플릿 엔티티 삭제됨)은 스킵하고 조상 계속 탐색', async () => {
    const svc = new TemplateService();
    await svc.setFolderTemplate('상위', 'tplA');
    await svc.setFolderTemplate('상위/하위', 'tplB');
    delete templateEntities['tplB'];
    expect(await svc.resolveFolderTemplate('상위/하위')).toEqual({
      folder: '상위',
      templateId: 'tplA',
    });
  });

  it('지정이 전혀 없으면(루트 생성 포함) undefined', async () => {
    const svc = new TemplateService();
    expect(await svc.resolveFolderTemplate('아무폴더')).toBeUndefined();
    expect(await svc.resolveFolderTemplate(null)).toBeUndefined();
  });
});

describe('캐스케이드 — 폴더 rename·remove + 템플릿 삭제', () => {
  it('renameFolder: 정확 일치 + 하위 경로 프리픽스 키 이관', async () => {
    const svc = new TemplateService();
    await svc.setFolderTemplate('상위', 'tplA');
    await svc.setFolderTemplate('상위/하위', 'tplB');
    await svc.setFolderTemplate('상위비슷', 'tplA'); // 프리픽스 오탐 가드
    await svc.renameFolder('상위', '새상위');
    expect(svc.getFolderTemplate('새상위')).toEqual({ templateId: 'tplA' });
    expect(svc.getFolderTemplate('새상위/하위')).toEqual({
      templateId: 'tplB',
    });
    expect(svc.getFolderTemplate('상위비슷')).toEqual({ templateId: 'tplA' });
    expect(svc.getFolderTemplate('상위')).toBeUndefined();
  });

  it('removeFolder: 정확 일치 + 하위 경로 정리, 무관 키 보존', async () => {
    const svc = new TemplateService();
    await svc.setFolderTemplate('상위', 'tplA');
    await svc.setFolderTemplate('상위/하위', 'tplB');
    await svc.setFolderTemplate('상위비슷', 'tplA');
    await svc.removeFolder('상위');
    expect(svc.getFolderTemplate('상위')).toBeUndefined();
    expect(svc.getFolderTemplate('상위/하위')).toBeUndefined();
    expect(svc.getFolderTemplate('상위비슷')).toEqual({ templateId: 'tplA' });
  });

  it('removeFolder: 폴더 전용 로컬 템플릿 엔티티도 함께 삭제 (전역 참조는 보존)', async () => {
    templateEntities['localT'] = {
      id: 'localT',
      name: '폴더 기본 (상위)',
      folderLocal: true,
    };
    const svc = new TemplateService();
    await svc.setFolderTemplate('상위', 'localT');
    await svc.setFolderTemplate('상위/하위', 'tplA'); // (구형) 전역 참조 지정
    await svc.setFolderTemplate('무관', 'tplB');
    await svc.removeFolder('상위');
    expect(mockDeleteTemplate).toHaveBeenCalledWith('localT');
    expect(mockDeleteTemplate).not.toHaveBeenCalledWith('tplA');
    expect(mockDeleteTemplate).not.toHaveBeenCalledWith('tplB');
    expect(svc.getFolderTemplate('무관')).toEqual({ templateId: 'tplB' });
  });

  it('clearFolderTemplatesByTemplateId: 해당 템플릿 지정 일괄 해제', async () => {
    const svc = new TemplateService();
    await svc.setFolderTemplate('폴더1', 'tplA');
    await svc.setFolderTemplate('폴더2', 'tplA');
    await svc.setFolderTemplate('폴더3', 'tplB');
    await svc.clearFolderTemplatesByTemplateId('tplA');
    expect(svc.getFolderTemplate('폴더1')).toBeUndefined();
    expect(svc.getFolderTemplate('폴더2')).toBeUndefined();
    expect(svc.getFolderTemplate('폴더3')).toEqual({ templateId: 'tplB' });
  });
});

describe('renameProject/removeProject — 씬 템플릿만 이관(폴더 템플릿은 id 참조)', () => {
  it('씬 템플릿 이름 이관', async () => {
    files['templates.json'] = JSON.stringify({
      version: 1,
      sceneTemplates: ['프로젝트1'],
      folderTemplates: {},
    });
    const svc = new TemplateService();
    await svc.ensureLoaded();
    await svc.renameProject('프로젝트1', '프로젝트2');
    expect(svc.isSceneTemplate('프로젝트2')).toBe(true);
    expect(svc.isSceneTemplate('프로젝트1')).toBe(false);
    await svc.removeProject('프로젝트2');
    expect(svc.isSceneTemplate('프로젝트2')).toBe(false);
  });
});

// 숨김 씬 템플릿 (씬 템플릿 개편, 2026-07-18 합의):
//  - hiddenSceneTemplates 필드 저장/로드 (필드 추가 = 호환 안전)
//  - filterVisibleProjects: 목록 UI 의 숨김 제외 필터
//  - rename/remove 캐스케이드가 hiddenNames 도 함께 이관/정리
//    (이관 누락 시 이름변경만으로 숨김이 풀리는 회귀 방지)
describe('숨김 씬 템플릿 — hiddenSceneTemplates', () => {
  it('저장/로드 라운드트립 + filterVisibleProjects', async () => {
    files['templates.json'] = JSON.stringify({
      version: 1,
      sceneTemplates: ['보임템플릿', '숨김템플릿'],
      hiddenSceneTemplates: ['숨김템플릿'],
      folderTemplates: {},
    });
    const svc = new TemplateService();
    await svc.ensureLoaded();
    expect(svc.isHiddenProject('숨김템플릿')).toBe(true);
    expect(svc.isHiddenProject('보임템플릿')).toBe(false);
    expect(
      svc.filterVisibleProjects(['일반', '숨김템플릿', '보임템플릿']),
    ).toEqual(['일반', '보임템플릿']);
    // 저장 페이로드에 hiddenSceneTemplates 유지
    await svc.setFolderTemplate('폴더', 'tplA');
    expect(lastSaved().hiddenSceneTemplates).toEqual(['숨김템플릿']);
  });

  it('renameProject: hiddenNames 도 함께 이관', async () => {
    files['templates.json'] = JSON.stringify({
      version: 1,
      sceneTemplates: ['숨김템플릿'],
      hiddenSceneTemplates: ['숨김템플릿'],
      folderTemplates: {},
    });
    const svc = new TemplateService();
    await svc.ensureLoaded();
    await svc.renameProject('숨김템플릿', '새이름');
    expect(svc.isSceneTemplate('새이름')).toBe(true);
    expect(svc.isHiddenProject('새이름')).toBe(true);
    expect(svc.isHiddenProject('숨김템플릿')).toBe(false);
  });

  it('removeProject: hiddenNames 정리', async () => {
    files['templates.json'] = JSON.stringify({
      version: 1,
      sceneTemplates: ['숨김템플릿'],
      hiddenSceneTemplates: ['숨김템플릿'],
      folderTemplates: {},
    });
    const svc = new TemplateService();
    await svc.ensureLoaded();
    await svc.removeProject('숨김템플릿');
    expect(svc.isSceneTemplate('숨김템플릿')).toBe(false);
    expect(svc.isHiddenProject('숨김템플릿')).toBe(false);
    expect(lastSaved().hiddenSceneTemplates).toEqual([]);
  });
});

// 퀵 생성 전용 프로젝트 (퀵 생성 개편, 2026-07-18 합의):
//  - quickGenProject 필드 저장/로드 (필드 추가 = 호환 안전)
//  - ensureQuickGenProject: 지정 재사용 / 없으면 생성(+이름 충돌 번호) / 숨김 지정
//  - 지정 프로젝트 소실 시 재생성 + 옛 이름 숨김 해제(복원 고아 방지)
//  - rename/remove 캐스케이드 (sceneNames 밖이라 별도 판정 경로)
describe('퀵 생성 전용 프로젝트 — quickGenProject', () => {
  it('ensureQuickGenProject: 없으면 생성 + 숨김 + 저장', async () => {
    const svc = new TemplateService();
    const s = await svc.ensureQuickGenProject();
    expect(s).toEqual({ name: '퀵 생성' });
    expect(svc.quickGenName).toBe('퀵 생성');
    expect(svc.isHiddenProject('퀵 생성')).toBe(true);
    expect(lastSaved().quickGenProject).toBe('퀵 생성');
    // 씬 템플릿 목록에는 나타나지 않는다
    expect(svc.isSceneTemplate('퀵 생성')).toBe(false);
  });

  it('이름 충돌 시 번호 부여', async () => {
    mockProjects.push('퀵 생성');
    const svc = new TemplateService();
    const s = await svc.ensureQuickGenProject();
    expect(s).toEqual({ name: '퀵 생성 (2)' });
    expect(svc.quickGenName).toBe('퀵 생성 (2)');
  });

  it('지정된 프로젝트가 실존하면 재사용(새로 만들지 않음) + 숨김 자가 치유', async () => {
    mockProjects.push('내퀵');
    files['templates.json'] = JSON.stringify({
      version: 1,
      sceneTemplates: [],
      hiddenSceneTemplates: [],
      folderTemplates: {},
      quickGenProject: '내퀵',
    });
    const svc = new TemplateService();
    const s = await svc.ensureQuickGenProject();
    expect(s).toEqual({ name: '내퀵' });
    expect(mockProjects).toEqual(['내퀵']);
    expect(svc.isHiddenProject('내퀵')).toBe(true);
  });

  it('지정 프로젝트 소실 → 재생성 + 옛 이름 숨김 해제', async () => {
    files['templates.json'] = JSON.stringify({
      version: 1,
      sceneTemplates: [],
      hiddenSceneTemplates: ['옛퀵'],
      folderTemplates: {},
      quickGenProject: '옛퀵',
    });
    const svc = new TemplateService();
    const s = await svc.ensureQuickGenProject();
    expect(s).toEqual({ name: '퀵 생성' });
    expect(svc.quickGenName).toBe('퀵 생성');
    expect(svc.isHiddenProject('옛퀵')).toBe(false);
    expect(svc.isHiddenProject('퀵 생성')).toBe(true);
  });

  it('renameProject: quickGenName + 숨김 이관 (씬 템플릿 아님)', async () => {
    files['templates.json'] = JSON.stringify({
      version: 1,
      sceneTemplates: [],
      hiddenSceneTemplates: ['퀵 생성'],
      folderTemplates: {},
      quickGenProject: '퀵 생성',
    });
    const svc = new TemplateService();
    await svc.ensureLoaded();
    await svc.renameProject('퀵 생성', '새퀵');
    expect(svc.quickGenName).toBe('새퀵');
    expect(svc.isHiddenProject('새퀵')).toBe(true);
    expect(svc.isHiddenProject('퀵 생성')).toBe(false);
    expect(lastSaved().quickGenProject).toBe('새퀵');
  });

  it('removeProject: 지정 해제 + 숨김 정리', async () => {
    files['templates.json'] = JSON.stringify({
      version: 1,
      sceneTemplates: [],
      hiddenSceneTemplates: ['퀵 생성'],
      folderTemplates: {},
      quickGenProject: '퀵 생성',
    });
    const svc = new TemplateService();
    await svc.ensureLoaded();
    await svc.removeProject('퀵 생성');
    expect(svc.quickGenName).toBeNull();
    expect(svc.isHiddenProject('퀵 생성')).toBe(false);
    expect(lastSaved().quickGenProject).toBeUndefined();
  });
});
