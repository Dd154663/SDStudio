/**
 * 부스트 모드 B3(2026-11-01) — 설정 화면·경고 창·순회 잠금·실행 중 계정 전환 차단의 판정과 서비스 가드.
 * - boostMode 순수 판정: 설정 저장 왕복(boostSettingsToConfig ↔ resolveBoostSettings)·미저장 비교·방식 기본값,
 *   D12 상호 배타 잠금(boostSettingsLock — 켜려는 쪽만 막음), D11 경고 창 필요 여부(needsBoostWarning),
 *   전환 차단 조건(isBoostAccountSwitchLocked), 경고 문구(Anlas 줄), 참여 후보 미리보기 문구
 * - LoginService: 주입한 가드로 수동 전환·토큰 로그인·토큰 삭제·자동 순회 거부(쓰기 없음), 미리보기는 이름만
 * - TaskQueueService.isBoostAccountLocked: 참여 계정을 고르는 중·다중 워커 실행 중 true, 끝나면 false, 꺼짐은 늘 false
 */
import type { LoginValidity } from '../../backends/imageGen';

let profileData: string | undefined;
let currentToken: string | undefined;
const getConfig = jest.fn(async (): Promise<any> => ({}));

const backend = {
  getConfig,
  readLoginToken: jest.fn(async () => currentToken),
  readTokenProfileData: jest.fn(async () => profileData),
  writeTokenProfileData: jest.fn(async (data: string) => {
    profileData = data;
  }),
  writeFile: jest.fn(async () => {}),
  loginWithToken: jest.fn(async (token: string) => {
    currentToken = token;
  }),
  validateToken: jest.fn<Promise<LoginValidity>, [string]>(async () => 'valid'),
  getOpusUsageStatusForToken: jest.fn(async () => ({
    percent: 90,
    isNegative: false,
    timeUntilNextPercent: 60,
    opusSubscribed: true,
  })),
  validateLogin: jest.fn<Promise<LoginValidity>, []>(async () => 'valid'),
  deleteFile: jest.fn(async () => {}),
  delegateComplete: jest.fn(async () => {}),
  delegateQueueSnapshot: jest.fn(async () => {}),
};

jest.mock('..', () => ({
  backend,
  imageService: { onAddImage: jest.fn(), onAddInPaint: jest.fn(), removeImageReference: jest.fn() },
  isMobile: false,
  localAIService: {},
  promptService: {},
  sessionService: { get: jest.fn(), getFast: jest.fn() },
  taskQueueService: {},
  workFlowService: { presetFromJSON: (j: any) => j },
}));
jest.mock('../AppService', () => ({
  appState: { pushMessage: jest.fn(), pushDialog: jest.fn() },
}));
jest.mock('../PersistenceService', () => ({
  persistService: {
    write: jest.fn(async () => {}),
    writeWith: jest.fn(async (_key: string, data: string, writer: (d: string) => Promise<void>) =>
      writer(data),
    ),
  },
}));
jest.mock('../PromptService', () => ({
  expandPieces: jest.fn(),
  lowerPromptNode: jest.fn(),
  toPARR: jest.fn(),
}));
jest.mock('../ImageService', () => ({
  dataUriToBase64: jest.fn((data: string) => data.split(',')[1]),
}));
jest.mock('../workflows/SDWorkFlow', () => ({
  prepareMirrorCanvas: jest.fn(),
}));
jest.mock('../../componenets/BrushTool', () => ({
  getImageDimensions: jest.fn(),
}));

import {
  BOOST_MIN_TOKEN_PROFILES,
  BOOST_TEXT,
  boostActiveModeOf,
  boostParticipantPreviewText,
  boostSettingsLock,
  boostSettingsToConfig,
  DEFAULT_BOOST_ACTIVE_MODE,
  isBoostAccountSwitchLocked,
  needsBoostWarning,
  resolveBoostSettings,
  sameBoostSettings,
  BoostSettings,
} from '../boostMode';
import { LoginService } from '../LoginService';
import {
  TaskAttemptContext,
  TaskHandler,
  TaskQueueRun,
  TaskQueueService,
  TaskTimeEstimator,
} from '../TaskQueueService';
import type { BoostPlannerLike } from '../boostPlanner';

describe('설정 저장 왕복·기본값', () => {
  test('설정 → config 3키 → 다시 읽기가 같은 값(모든 조합)', () => {
    for (const mode of ['off', 'replicate', 'split'] as const) {
      for (const scope of ['free', 'purchased', 'anlas'] as const) {
        for (const variantTasks of [false, true]) {
          const s: BoostSettings = { mode, scope, variantTasks };
          const cfg = boostSettingsToConfig(s);
          expect(Object.keys(cfg).sort()).toEqual(['boostAccountScope', 'boostMode', 'boostVariantTasks']);
          expect(resolveBoostSettings({ ...cfg, other: 1 })).toEqual(s);
          expect(sameBoostSettings(s, resolveBoostSettings(cfg))).toBe(true);
        }
      }
    }
  });

  test('구 config(키 없음)는 꺼짐·무료·변형 꺼짐으로 읽혀 미저장 표시가 뜨지 않는다', () => {
    const loaded = resolveBoostSettings({});
    expect(loaded).toEqual({ mode: 'off', scope: 'free', variantTasks: false });
    expect(sameBoostSettings(loaded, resolveBoostSettings({ boostMode: 'off' }))).toBe(true);
    expect(sameBoostSettings(loaded, { ...loaded, scope: 'anlas' })).toBe(false);
    expect(sameBoostSettings(loaded, { ...loaded, variantTasks: true })).toBe(false);
    expect(sameBoostSettings(loaded, { ...loaded, mode: 'split' })).toBe(false);
  });

  test('손상 값은 저장할 때도 정규화(꺼짐·무료)', () => {
    expect(boostSettingsToConfig({ mode: 'x' as any, scope: 'y' as any, variantTasks: 'yes' as any })).toEqual({
      boostMode: 'off',
      boostAccountScope: 'free',
      boostVariantTasks: false,
    });
  });

  test('방식 선택 처음 값: 꺼짐이면 기본(B), 켜짐이면 그 방식', () => {
    expect(DEFAULT_BOOST_ACTIVE_MODE).toBe('split');
    expect(boostActiveModeOf('off')).toBe('split');
    expect(boostActiveModeOf('replicate')).toBe('replicate');
    expect(boostActiveModeOf('split')).toBe('split');
  });
});

describe('D12 순회 잠금·토큰 수 조건(boostSettingsLock)', () => {
  test('부스트 꺼짐·순회 꺼짐·토큰 2개 이상 = 둘 다 켤 수 있음', () => {
    expect(boostSettingsLock({ boostOn: false, rotationOn: false, profileCount: 2 })).toEqual({
      rotationBlocked: false,
    });
  });
  test('토큰이 2개 미만이면 부스트를 켤 수 없다(이미 켜져 있으면 끄기는 허용)', () => {
    expect(BOOST_MIN_TOKEN_PROFILES).toBe(2);
    expect(boostSettingsLock({ boostOn: false, rotationOn: false, profileCount: 1 }).boostBlocked).toBe('profiles');
    expect(boostSettingsLock({ boostOn: false, rotationOn: false, profileCount: 0 }).boostBlocked).toBe('profiles');
    expect(boostSettingsLock({ boostOn: true, rotationOn: false, profileCount: 1 }).boostBlocked).toBeUndefined();
  });
  test('순회가 켜져 있으면 부스트를 켤 수 없고(순회 이유가 우선), 부스트가 켜져 있으면 순회를 켤 수 없다', () => {
    expect(boostSettingsLock({ boostOn: false, rotationOn: true, profileCount: 1 }).boostBlocked).toBe('rotation');
    expect(boostSettingsLock({ boostOn: false, rotationOn: true, profileCount: 3 })).toEqual({
      boostBlocked: 'rotation',
      rotationBlocked: false,
    });
    expect(boostSettingsLock({ boostOn: true, rotationOn: false, profileCount: 3 })).toEqual({
      rotationBlocked: true,
    });
  });
  test('구 config 에서 둘 다 켜져 있으면 어느 쪽도 막지 않는다(사용자가 하나를 끌 수 있게 — 자동 전환 없음)', () => {
    expect(boostSettingsLock({ boostOn: true, rotationOn: true, profileCount: 3 })).toEqual({
      rotationBlocked: false,
    });
  });
});

describe('D11 경고 창(needsBoostWarning)·문구', () => {
  const base = { wasOn: false, nextOn: true, dismissed: false, acceptedThisSession: false };
  test('끄기 → 켜기 전환일 때만, 다시 보지 않음·이번 세션 확인이 없을 때만', () => {
    expect(needsBoostWarning(base)).toBe(true);
    expect(needsBoostWarning({ ...base, dismissed: true })).toBe(false);
    expect(needsBoostWarning({ ...base, acceptedThisSession: true })).toBe(false);
    // 켜진 상태에서 A ↔ B 만 바꾸는 것·끄기는 전환이 아니다
    expect(needsBoostWarning({ ...base, wasOn: true })).toBe(false);
    expect(needsBoostWarning({ ...base, nextOn: false })).toBe(false);
  });
  test('경고 문구: 책임 문구 고정, 범위가 Anlas 일 때만 차감 한 줄', () => {
    for (const scope of ['free', 'purchased'] as const) {
      const t = BOOST_TEXT.warningText(scope);
      expect(t).toContain('제재·계정 정지');
      expect(t).toContain('모든 책임은 사용자에게');
      expect(t).not.toContain('Anlas');
    }
    expect(BOOST_TEXT.warningText('anlas')).toContain('Anlas 가 각 계정에서 차감됩니다');
    expect(BOOST_TEXT.scopeHint.anlas).toContain('Anlas 가 차감됩니다');
    expect(BOOST_TEXT.modeHint.replicate).toContain('씬 예약 수가 참여 계정 수만큼 늘어납니다');
  });
  test('참여 후보 미리보기: 이름만, 실행 시 판정 명시', () => {
    expect(boostParticipantPreviewText({ activeName: '메인', names: ['서브', '서브2'] })).toBe(
      '참여 후보: 현재 계정(메인) + 서브, 서브2 — 실제 참여는 생성을 시작할 때 참여 범위와 할당량으로 판정합니다.',
    );
    expect(boostParticipantPreviewText({ names: ['서브'] })).toContain('현재 로그인 계정 + 서브');
    expect(boostParticipantPreviewText({ activeName: '메인', names: [] })).toContain('다른 저장 토큰이 없습니다');
  });
});

describe('실행 중 계정 전환 차단 조건(isBoostAccountSwitchLocked)', () => {
  test('실행 중 + (워커 2개 이상 또는 참여 계정 고르는 중)', () => {
    expect(isBoostAccountSwitchLocked({ running: true, workers: 2 })).toBe(true);
    expect(isBoostAccountSwitchLocked({ running: true, workers: 1 })).toBe(false);
    expect(isBoostAccountSwitchLocked({ running: true, workers: 1, starting: true })).toBe(true);
    expect(isBoostAccountSwitchLocked({ running: false, workers: 3 })).toBe(false);
    expect(isBoostAccountSwitchLocked({ running: false, workers: 1, starting: true })).toBe(false);
  });
});

describe('LoginService 계정 전환 가드', () => {
  const PROFILES = {
    version: 1,
    activeId: 'a',
    profiles: [
      { id: 'a', name: '메인', token: 'tok-main' },
      { id: 'b', name: '서브', token: 'tok-sub' },
    ],
  };
  beforeEach(() => {
    profileData = JSON.stringify(PROFILES);
    currentToken = 'tok-main';
    jest.clearAllMocks();
    backend.validateToken.mockResolvedValue('valid');
  });

  test('가드가 막으면 수동 전환·토큰 로그인·토큰 삭제를 안내 문구로 거부하고 아무것도 쓰지 않는다', async () => {
    const service = new LoginService();
    await service.loadTokenProfiles();
    service.setAccountSwitchGuard(() => BOOST_TEXT.accountSwitchLocked);
    expect(service.accountSwitchBlockedReason()).toBe(BOOST_TEXT.accountSwitchLocked);
    await expect(service.activateTokenProfile('b')).rejects.toThrow(BOOST_TEXT.accountSwitchLocked);
    await expect(service.loginWithToken('tok-other')).rejects.toThrow(BOOST_TEXT.accountSwitchLocked);
    await expect(service.deleteTokenProfile('b')).rejects.toThrow(BOOST_TEXT.accountSwitchLocked);
    await expect(service.login('a@b.c', 'pw')).rejects.toThrow(BOOST_TEXT.accountSwitchLocked);
    expect(backend.loginWithToken).not.toHaveBeenCalled();
    expect(backend.validateToken).not.toHaveBeenCalled();
    expect(backend.writeTokenProfileData).not.toHaveBeenCalled();
    expect(currentToken).toBe('tok-main');
    expect(service.listTokenProfiles()).toHaveLength(2);
  });

  test('검증하는 사이 부스트 실행이 시작되면 쓰지 않는다', async () => {
    const service = new LoginService();
    await service.loadTokenProfiles();
    let locked = false;
    service.setAccountSwitchGuard(() => (locked ? BOOST_TEXT.accountSwitchLocked : undefined));
    backend.validateToken.mockImplementationOnce(async () => {
      locked = true;
      return 'valid';
    });
    await expect(service.activateTokenProfile('b')).rejects.toThrow(BOOST_TEXT.accountSwitchLocked);
    expect(backend.loginWithToken).not.toHaveBeenCalled();
  });

  test('가드가 막으면 자동 순회도 전환하지 않는다(not-ready)', async () => {
    const service = new LoginService();
    await service.loadTokenProfiles();
    service.setAccountSwitchGuard(() => BOOST_TEXT.accountSwitchLocked);
    await expect(service.tryAutoRotateToken(25)).resolves.toEqual({ switched: false, reason: 'not-ready' });
    expect(backend.getOpusUsageStatusForToken).not.toHaveBeenCalled();
    expect(backend.loginWithToken).not.toHaveBeenCalled();
  });

  test('가드가 풀려 있으면(또는 없으면) 종전대로 전환·삭제한다', async () => {
    const service = new LoginService();
    await service.loadTokenProfiles();
    expect(service.accountSwitchBlockedReason()).toBeUndefined();
    service.setAccountSwitchGuard(() => undefined);
    await expect(service.activateTokenProfile('b')).resolves.toBe('valid');
    expect(currentToken).toBe('tok-sub');
    await service.deleteTokenProfile('a');
    expect(service.listTokenProfiles()).toEqual([{ id: 'b', name: '서브' }]);
  });

  test('가드가 예외를 던지면 막지 않는다(판정 실패로 로그인 자체가 막히지 않게)', async () => {
    const service = new LoginService();
    service.setAccountSwitchGuard(() => {
      throw new Error('boom');
    });
    expect(service.accountSwitchBlockedReason()).toBeUndefined();
  });

  test('참여 후보 미리보기는 현재 로그인 계정을 빼고 이름만 돌려준다(토큰 없음)', async () => {
    const service = new LoginService();
    const preview = await service.getBoostParticipantPreview();
    expect(preview).toEqual({ activeName: '메인', names: ['서브'] });
    expect(JSON.stringify(preview)).not.toContain('tok-');
  });

  test('경고 창 세션 표식은 새 서비스(앱 재실행)마다 꺼짐에서 시작한다', () => {
    const a = new LoginService();
    a.boostWarningAccepted = true;
    expect(new LoginService().boostWarningAccepted).toBe(false);
  });
});

describe('TaskQueueService.isBoostAccountLocked', () => {
  const tick = () => new Promise<void>((r) => setTimeout(r, 1));

  function handlerRecording(seen: boolean[], service: () => TaskQueueService): TaskHandler {
    return {
      createTimeEstimator: () => new TaskTimeEstimator(16, 1000),
      checkTask: () => true,
      supportsWorkerAccount: () => true,
      getNumTries: () => 1,
      handleDelay: jest.fn(async () => {}),
      getInfo: () => ({ name: 'test', emoji: 'T' }),
      calculateCost: () => [],
      handleTask: jest.fn(async (_task: any, _run: TaskQueueRun, _ctx?: TaskAttemptContext) => {
        await tick();
        seen.push(service().isBoostAccountLocked());
        return true;
      }),
    };
  }

  function makeParam() {
    return {
      session: { name: 'p' },
      scene: { name: 's', type: 'scene' },
      job: { type: 'sd' },
      outputPath: 'outs/p/s',
    } as any;
  }

  function planner(participants: any[], gate?: Promise<void>) {
    return {
      getSettings: jest.fn(async () => ({ mode: 'split', scope: 'free', variantTasks: false })),
      getParticipants: jest.fn(async () => {
        if (gate) await gate;
        return { activeName: '메인', participants };
      }),
    } as unknown as BoostPlannerLike;
  }

  async function waitStopped(service: TaskQueueService) {
    for (let i = 0; i < 500 && service.isRunning(); i++) await tick();
  }

  function cleanup(service: TaskQueueService) {
    const s = service as any;
    if (s.logsSaveTimer) clearTimeout(s.logsSaveTimer);
    s.logsSaveTimer = null;
  }

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  test('부스트 꺼짐: 실행 중에도 잠그지 않는다(종전)', async () => {
    getConfig.mockImplementation(async () => ({}));
    const seen: boolean[] = [];
    let svc!: TaskQueueService;
    svc = new TaskQueueService([handlerRecording(seen, () => svc)]);
    svc.boostPlanner = planner([{ id: 'b', name: '서브', token: 'tok-sub' }]);
    svc.retryWait = jest.fn(async () => true);
    svc.addTaskLocal(makeParam(), 2);
    svc.runLocal();
    await waitStopped(svc);
    expect(seen).toEqual([false, false]);
    expect(svc.isBoostAccountLocked()).toBe(false);
    cleanup(svc);
  });

  test('부스트 켜짐: 참여 계정을 고르는 동안·다중 워커 실행 중 잠그고, 끝나면 푼다', async () => {
    getConfig.mockImplementation(async () => ({ boostMode: 'split' }));
    const seen: boolean[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let svc!: TaskQueueService;
    svc = new TaskQueueService([handlerRecording(seen, () => svc)]);
    svc.boostPlanner = planner([{ id: 'b', name: '서브', token: 'tok-sub' }], gate);
    svc.retryWait = jest.fn(async () => true);
    svc.longBreakWait = jest.fn(async () => true);
    svc.addTaskLocal(makeParam(), 4);
    expect(svc.isBoostAccountLocked()).toBe(false);
    svc.runLocal();
    await tick();
    expect(svc.isBoostAccountLocked()).toBe(true); // 참여 계정 고르는 중(워커 1개로 보이는 순간)
    release();
    await waitStopped(svc);
    expect(seen.length).toBe(4);
    expect(seen.some((v) => v)).toBe(true);
    expect(svc.isBoostAccountLocked()).toBe(false);
    cleanup(svc);
  });

  test('부스트 켜짐이라도 참여 계정이 없으면 고르기가 끝난 뒤 잠금이 풀린다', async () => {
    getConfig.mockImplementation(async () => ({ boostMode: 'split' }));
    const seen: boolean[] = [];
    let svc!: TaskQueueService;
    svc = new TaskQueueService([handlerRecording(seen, () => svc)]);
    svc.boostPlanner = planner([]);
    svc.retryWait = jest.fn(async () => true);
    const progress = jest.fn();
    svc.addEventListener('progress', progress);
    svc.addTaskLocal(makeParam(), 2);
    svc.runLocal();
    await waitStopped(svc);
    expect(seen).toEqual([false, false]);
    expect(progress).toHaveBeenCalled();
    cleanup(svc);
  });
});
