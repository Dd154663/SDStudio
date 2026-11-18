// 캐릭터 프리셋 순차 생성 「현재 프로젝트」 모드 — 끝나면 적용 캐릭터를 시작 전으로(2026-11-18 프리셋 유실 조사 경로 12).
//  · 완료·취소·오류 각각에서 공용 설정의 fromPreset 항목·_appliedPresetName 이 시작 전과 같다(같은 객체)
//  · 진행 중 사용자가 바꾼 다른 값(사용자 바이브·프롬프트)은 유지
//  · 예약된 작업은 예약 시점 입력(각 프리셋의 캐릭터)으로 굳어 있어 되돌리기가 남은 생성에 영향 없음
//  · 진행 중 사용자가 다른 프리셋을 직접 적용했으면 덮지 않음
//  · 프로젝트 파일 모드는 원래 프로젝트를 건드리지 않음(종전 그대로)

const mockQueue: {
  listeners: (() => void)[];
  empty: boolean;
  [k: string]: any;
} = {
  listeners: [],
  empty: true,
  addEventListener: jest.fn((_e: string, h: () => void): void => {
    mockQueue.listeners.push(h);
  }),
  removeEventListener: jest.fn((_e: string, h: () => void): void => {
    mockQueue.listeners = mockQueue.listeners.filter((x: () => void) => x !== h);
  }),
  isEmpty: jest.fn(() => mockQueue.empty),
  run: jest.fn(() => {}),
};
const mockQueued: { scene: string; character: any }[] = [];
const mockLoaded = new Map<string, any>();
const mockGlobal = { instantiateIntoSession: jest.fn() };

jest.mock('..', () => ({
  taskQueueService: mockQueue,
  workFlowService: { buildShared: () => ({ vibes: [], characterReferences: [], characterPrompts: [], _appliedPresetName: '' }) },
  sessionService: {
    isLoaded: (n: string) => mockLoaded.has(n),
    getFast: (n: string) => mockLoaded.get(n),
    getFolderOf: () => '',
    resourceList: [],
  },
  imageService: {},
  globalCharacterPresetService: mockGlobal,
  backend: {},
}));
jest.mock('../types', () => {
  const item = (j: any) => ({ ...j, toJSON: () => ({ ...j }) });
  return {
    VibeItem: { fromJSON: item },
    ReferenceItem: { fromJSON: item },
    CharacterPreset: class {},
    Session: class {},
  };
});
jest.mock('../ImageService', () => ({ dataUriToBase64: (s: string) => s }));
jest.mock('../TaskQueueService', () => ({
  // 예약 시점 입력이 굳는 실제 동작(buildSDImageGenJob 의 깊은 복사)을 흉내 — 예약 때 공용 설정을 복사해 둔다
  queueWorkflow: jest.fn(async (session: any, wf: any, scene: any) => {
    const s = session.presetShareds.get(wf.workflowType);
    mockQueued.push({ scene: scene.name, character: JSON.parse(JSON.stringify(s)) });
  }),
}));
jest.mock('../AppService', () => ({
  appState: { pushMessage: jest.fn(), curSession: undefined },
}));

import { CyclingSessionService } from '../CyclingSessionService';
import { captureAppliedCharacter, restoreAppliedCharacter } from '../cyclingRestore';

const charPreset = (name: string) => ({
  name,
  characterPrompt: `${name} prompt`,
  characterUC: '',
  vibes: [{ path: `${name}.png`, toJSON: () => ({ path: `${name}.png` }) }],
  characterReferences: [{ path: `${name}-ref.png`, toJSON: () => ({ path: `${name}-ref.png` }) }],
});

const makeSession = () => {
  const userVibe = { path: 'user.png' };
  const origVibe = { path: 'orig.png', fromPreset: 'Orig' };
  const origRef = { path: 'orig-ref.png', fromPreset: 'Orig' };
  const userPrompt = { id: 'u', prompt: 'user cp' };
  const origPrompt = { id: 'o', prompt: 'Orig prompt', fromPreset: 'Orig', order: 1 };
  const shared: any = {
    vibes: [origVibe, userVibe],
    characterReferences: [origRef],
    characterPrompts: [userPrompt, origPrompt],
    _appliedPresetName: 'Orig',
    seed: 5,
  };
  const session: any = {
    name: 'P',
    selectedWorkflow: { workflowType: 'SDImageGen' },
    presetShareds: new Map([['SDImageGen', shared]]),
  };
  mockLoaded.set('P', session);
  return { session, shared, userVibe, origVibe, origRef, userPrompt, origPrompt };
};

const items = (...names: string[]) => names.map((n) => ({ kind: 'local' as const, name: n, preset: charPreset(n) as any }));
const scenes = [{ name: 'S1' }, { name: 'S2' }] as any[];
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
const queueStops = async () => {
  for (const h of [...mockQueue.listeners]) h();
  await flush();
};

beforeEach(() => {
  jest.useFakeTimers();
  mockQueue.listeners = [];
  mockQueue.empty = true;
  mockQueued.length = 0;
  mockLoaded.clear();
  jest.clearAllMocks();
});
afterEach(() => {
  jest.useRealTimers();
});

const expectOriginal = (ctx: ReturnType<typeof makeSession>) => {
  expect(ctx.shared.vibes).toEqual([ctx.origVibe, ctx.userVibe]);
  expect(ctx.shared.vibes[0]).toBe(ctx.origVibe);
  expect(ctx.shared.characterReferences).toEqual([ctx.origRef]);
  expect(ctx.shared.characterPrompts).toEqual([ctx.userPrompt, ctx.origPrompt]);
  expect(ctx.shared.characterPrompts[1]).toBe(ctx.origPrompt);
  expect(ctx.shared._appliedPresetName).toBe('Orig');
};

describe('순차 생성 「현재 프로젝트」 모드 — 끝나면 시작 전 적용 캐릭터로', () => {
  test('정상 완료: 각 프리셋으로 예약되고, 끝나면 시작 전 상태', async () => {
    const ctx = makeSession();
    const svc = new CyclingSessionService();
    svc.start(ctx.session, items('A', 'B'), scenes, 1);
    await flush();
    expect(ctx.shared._appliedPresetName).toBe('A'); // 진행 중에는 바꿔 끼운 상태
    await queueStops(); // A 끝 → 5초 대기
    await jest.advanceTimersByTimeAsync(5000);
    await flush();
    expect(ctx.shared._appliedPresetName).toBe('B');
    await queueStops(); // B 끝 → 완료
    expect(svc.state).toBe('idle');
    expectOriginal(ctx);
    // 예약은 각 프리셋의 캐릭터로 굳어 있다
    expect(mockQueued.map((q) => [q.scene, q.character._appliedPresetName])).toEqual([
      ['S1', 'A'],
      ['S2', 'A'],
      ['S1', 'B'],
      ['S2', 'B'],
    ]);
    expect(mockQueued[2].character.vibes.map((v: any) => v.path)).toEqual(['user.png', 'B.png']);
  });

  test('사용자 취소(큐에 작업이 남은 채): 되돌리고, 이미 예약된 작업의 입력은 그대로', async () => {
    const ctx = makeSession();
    const svc = new CyclingSessionService();
    svc.start(ctx.session, items('A', 'B'), scenes, 1);
    await flush();
    mockQueue.empty = false;
    svc.cancel();
    expectOriginal(ctx);
    expect(mockQueued.every((q) => q.character._appliedPresetName === 'A')).toBe(true);
  });

  test('오류(글로벌 실체화 실패)로 끝나도 시작 전 상태', async () => {
    const ctx = makeSession();
    mockGlobal.instantiateIntoSession.mockRejectedValueOnce(new Error('boom'));
    const svc = new CyclingSessionService();
    svc.start(ctx.session, [{ kind: 'local', name: 'A', preset: charPreset('A') as any }, { kind: 'global', name: 'G', globalId: 'g', preset: charPreset('G') as any }], scenes, 1);
    await flush();
    await queueStops(); // A 끝
    await jest.advanceTimersByTimeAsync(5000);
    await flush(); // G 실패 → 다음 → 완료
    expect(svc.state).toBe('idle');
    expectOriginal(ctx);
  });

  test('진행 중 사용자가 바꾼 다른 값(사용자 바이브 추가·사용자 프롬프트 수정)은 유지', async () => {
    const ctx = makeSession();
    const svc = new CyclingSessionService();
    svc.start(ctx.session, items('A'), scenes, 1);
    await flush();
    const added = { path: 'new-user.png' };
    ctx.shared.vibes = [...ctx.shared.vibes, added];
    ctx.userPrompt.prompt = 'edited';
    ctx.shared.seed = 77;
    await queueStops();
    expect(ctx.shared.vibes).toEqual([ctx.origVibe, ctx.userVibe, added]);
    expect(ctx.shared.characterPrompts[0].prompt).toBe('edited');
    expect(ctx.shared.seed).toBe(77);
    expect(ctx.shared._appliedPresetName).toBe('Orig');
  });

  test('적용 중(실체화 대기) 취소: 끝난 뒤에도 바꿔 놓지 않는다', async () => {
    const ctx = makeSession();
    let release: (v: any) => void = () => {};
    mockGlobal.instantiateIntoSession.mockImplementationOnce(() => new Promise((r) => (release = r)));
    const svc = new CyclingSessionService();
    svc.start(ctx.session, [{ kind: 'global', name: 'G', globalId: 'g', preset: charPreset('G') as any }], scenes, 1);
    await flush();
    svc.cancel();
    release(charPreset('G'));
    await flush();
    expectOriginal(ctx);
    expect(mockQueued).toHaveLength(0);
  });

  test('프로젝트 파일 모드는 원래 프로젝트에 되돌릴 것이 없다(되돌리기 지점 없음)', () => {
    const ctx = makeSession();
    const svc = new CyclingSessionService() as any;
    svc.start(ctx.session, items('A'), scenes, 1, { projectFileMode: true });
    expect(svc.restoreTarget).toBeNull();
    svc.cancel();
    expectOriginal(ctx);
  });
});

describe('cyclingRestore — 순수 규칙', () => {
  test('사용자가 다른 프리셋을 직접 적용했으면 덮지 않는다', () => {
    const ctx = makeSession();
    const point = captureAppliedCharacter(ctx.session, 'SDImageGen');
    point.lastApplied = 'A';
    ctx.shared._appliedPresetName = 'Manual';
    ctx.shared.vibes = [ctx.userVibe, { path: 'm.png', fromPreset: 'Manual' }];
    expect(restoreAppliedCharacter(point)).toBe('user-changed');
    expect(ctx.shared._appliedPresetName).toBe('Manual');
  });

  test('아무것도 바꾸지 않았으면 무동작', () => {
    const ctx = makeSession();
    const point = captureAppliedCharacter(ctx.session, 'SDImageGen');
    expect(restoreAppliedCharacter(point)).toBe('nothing');
    expectOriginal(ctx);
  });

  test('적용 프리셋이 없던 상태(시작 전 fromPreset 없음)로도 돌아간다', () => {
    const shared: any = { vibes: [{ path: 'u.png' }], characterReferences: [], characterPrompts: [], _appliedPresetName: '' };
    const session = { presetShareds: new Map([['T', shared]]) };
    const point = captureAppliedCharacter(session, 'T');
    shared.vibes = [shared.vibes[0], { path: 'a.png', fromPreset: 'A' }];
    shared.characterPrompts = [{ id: 'x', fromPreset: 'A' }];
    shared._appliedPresetName = 'A';
    point.lastApplied = 'A';
    expect(restoreAppliedCharacter(point)).toBe('restored');
    expect(shared.vibes).toEqual([{ path: 'u.png' }]);
    expect(shared.characterPrompts).toEqual([]);
    expect(shared._appliedPresetName).toBe('');
  });
});
