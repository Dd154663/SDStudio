// 교체 의미론 + 빈 영역 스킵 (프로젝트 상속 마감):
//  ProjectTemplateService.removeRecordedInstances 가 "기록된 인스턴스만" 제거하고
//  사용자 추가분은 보존하는지, opts 플래그(빈 영역 스킵)가 제거를 건너뛰는지.
//
// 세션은 최소 fake 로 대체(removePreset/removeCharacterPreset/presetShareds/
// selectedWorkflow 만 사용). 무거운 의존은 jest.mock 으로 우회.

jest.mock('..', () => ({
  backend: {},
  imageService: {},
  workFlowService: {},
  sessionService: {},
  templateService: {},
  globalPresetService: {},
  globalCharacterPresetService: {},
}));
jest.mock('../PersistenceService', () => ({ persistService: { write: jest.fn() } }));
jest.mock('../appStateRef', () => ({ getAppState: () => ({}) }));
jest.mock('../ImageService', () => ({ dataUriToBase64: (s: string) => s }));
jest.mock('../imageFormats', () => ({ imageExtFromBase64: () => 'png' }));
// types 는 mobx-state-tree 등 무거운 모듈을 끌어오므로 스텁으로 대체
jest.mock('../types', () => ({
  VibeItem: { fromJSON: (j: any) => j },
  ReferenceItem: { fromJSON: (j: any) => j },
  CharacterPreset: { fromJSON: (j: any) => j },
  Session: class {},
}));

import { ProjectTemplateService } from '../ProjectTemplateService';

// 최소 fake 세션 — 기록된 인스턴스(T*)와 사용자 추가분(user*)이 공존.
function makeFakeSession() {
  return {
    selectedWorkflow: {
      workflowType: 'SDImageGenEasy',
      presetName: 'T프리셋',
    } as any,
    removedPresets: [] as string[],
    removedChars: [] as string[],
    removePreset(type: string, name: string) {
      this.removedPresets.push(`${type}:${name}`);
    },
    removeCharacterPreset(name: string) {
      this.removedChars.push(name);
    },
    presetShareds: new Map<string, any>([
      [
        'SDImageGenEasy',
        {
          vibes: [{ path: 'Tv1' }, { path: 'userV' }],
          characterReferences: [{ path: 'Tr1' }, { path: 'userR' }],
        },
      ],
    ]),
  };
}

const record = {
  presets: [{ type: 'SDImageGenEasy', name: 'T프리셋' }],
  characterPresetNames: ['T캐릭'],
  vibePaths: ['Tv1'],
  referencePaths: ['Tr1'],
};

describe('removeRecordedInstances — 교체 의미론', () => {
  it('모든 영역 제거: 기록분만 제거되고 사용자 추가분은 보존', () => {
    const svc = new ProjectTemplateService();
    const session = makeFakeSession();
    const { selectedRemoved } = svc.removeRecordedInstances(
      session as any,
      record,
      {
        removePresets: true,
        removeChars: true,
        removeVibes: true,
        removeRefs: true,
      },
    );
    expect(session.removedPresets).toEqual(['SDImageGenEasy:T프리셋']);
    expect(session.removedChars).toEqual(['T캐릭']);
    const shared = session.presetShareds.get('SDImageGenEasy');
    // 기록된 path(Tv1/Tr1)만 빠지고 사용자 것(userV/userR)은 유지
    expect(shared.vibes).toEqual([{ path: 'userV' }]);
    expect(shared.characterReferences).toEqual([{ path: 'userR' }]);
    // selectedWorkflow 가 제거 대상 프리셋을 가리켰음
    expect(selectedRemoved).toBe(true);
  });

  it('빈 영역 스킵: preset 영역(removePresets=false) 이면 기록 프리셋을 제거하지 않음', () => {
    const svc = new ProjectTemplateService();
    const session = makeFakeSession();
    const { selectedRemoved } = svc.removeRecordedInstances(
      session as any,
      record,
      {
        removePresets: false, // 템플릿 preset 이 null → 프리셋 영역 스킵
        removeChars: true,
        removeVibes: true,
        removeRefs: true,
      },
    );
    // 프리셋은 건드리지 않음 → selectedWorkflow 도 제거로 간주되지 않음
    expect(session.removedPresets).toEqual([]);
    expect(selectedRemoved).toBe(false);
    // 다른 영역은 여전히 교체됨
    expect(session.removedChars).toEqual(['T캐릭']);
    const shared = session.presetShareds.get('SDImageGenEasy');
    expect(shared.vibes).toEqual([{ path: 'userV' }]);
  });

  it('보호 영역(배치 R2): skipCharacterPresets 로 캐릭터 인스턴스화 통째 스킵', async () => {
    const svc = new ProjectTemplateService();
    (svc as any).loaded = true;
    (svc as any).templates = [
      {
        id: 'tpl',
        name: 'T',
        createdAt: 1,
        updatedAt: 1,
        preset: null,
        characterPresets: [
          { name: 'T캐릭', vibes: [], characterReferences: [] },
        ],
        vibes: [],
        characterReferences: [],
        scenes: [],
      },
    ];
    const added: string[] = [];
    const session: any = {
      hasCharacterPreset: () => false,
      addCharacterPreset: (p: any) => added.push(p.name),
      presetShareds: new Map(),
    };
    // 보호(스킵): 추가 없음 + 기록용 결과도 비어 있음
    const r1 = await svc.instantiateIntoSession(session, 'tpl', {
      skipCharacterPresets: true,
    });
    expect(added).toEqual([]);
    expect(r1.characterPresetNames).toEqual([]);
    // 스킵 없이(기본): 정상 인스턴스화
    const r2 = await svc.instantiateIntoSession(session, 'tpl');
    expect(added).toEqual(['T캐릭']);
    expect(r2.characterPresetNames).toEqual(['T캐릭']);
  });

  it('빈 영역 스킵: vibes/refs 영역 스킵 시 shared 배열 불변', () => {
    const svc = new ProjectTemplateService();
    const session = makeFakeSession();
    svc.removeRecordedInstances(session as any, record, {
      removePresets: true,
      removeChars: true,
      removeVibes: false,
      removeRefs: false,
    });
    const shared = session.presetShareds.get('SDImageGenEasy');
    // 바이브/레퍼런스 영역 스킵 → 기록분(Tv1/Tr1)도 그대로 유지
    expect(shared.vibes).toEqual([{ path: 'Tv1' }, { path: 'userV' }]);
    expect(shared.characterReferences).toEqual([
      { path: 'Tr1' },
      { path: 'userR' },
    ]);
  });
});
