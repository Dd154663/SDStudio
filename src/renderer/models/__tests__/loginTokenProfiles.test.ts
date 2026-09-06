import type { LoginValidity } from '../../backends/imageGen';

let profileData: string | undefined;
let currentToken: string | undefined;

const backend = {
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
  getOpusUsageStatusForToken: jest.fn(async (token: string) => ({
    percent: token === 'secret-token-1' ? 88 : 42,
    isNegative: false,
    timeUntilNextPercent: 60,
  })),
  validateLogin: jest.fn<Promise<LoginValidity>, []>(async () => 'valid'),
};

jest.mock('..', () => ({ backend }));

import { LoginService } from '../LoginService';

beforeEach(() => {
  profileData = undefined;
  currentToken = undefined;
  jest.clearAllMocks();
  backend.validateToken.mockResolvedValue('valid');
  backend.getOpusUsageStatusForToken.mockImplementation(async (token: string) => ({
    percent: token === 'secret-token-1' ? 88 : 42,
    isNegative: false,
    timeUntilNextPercent: 60,
  }));
  backend.validateLogin.mockResolvedValue('valid');
});

describe('LoginService 토큰 프리셋', () => {
  test('저장 목록이 비어 있으면 기존 로그인 토큰을 활성 토큰 1로 복사한다', async () => {
    currentToken = 'existing-login-token';
    const service = new LoginService();

    await service.loadTokenProfiles();

    const profiles = service.listTokenProfiles();
    expect(profiles).toEqual([expect.objectContaining({ name: '토큰 1' })]);
    expect(service.activeProfileId).toBe(profiles[0].id);
    expect(JSON.parse(profileData!)).toEqual(
      expect.objectContaining({
        activeId: profiles[0].id,
        profiles: [
          expect.objectContaining({
            id: profiles[0].id,
            name: '토큰 1',
            token: 'existing-login-token',
          }),
        ],
      }),
    );
    expect(backend.loginWithToken).not.toHaveBeenCalled();
  });

  test('이미 생성된 빈 저장 목록에는 삭제한 토큰을 다시 가져오지 않는다', async () => {
    currentToken = 'existing-login-token';
    profileData = JSON.stringify({ version: 1, profiles: [] });
    const service = new LoginService();

    await service.loadTokenProfiles();

    expect(service.listTokenProfiles()).toEqual([]);
    expect(service.activeProfileId).toBeUndefined();
    expect(backend.writeTokenProfileData).not.toHaveBeenCalled();
  });

  test('이름 입력 없이 토큰을 저장하면 구분용 이름을 자동 생성한다', async () => {
    const service = new LoginService();
    await service.saveToken('secret-token-1');
    await service.saveToken('secret-token-2');

    expect(service.listTokenProfiles()).toEqual([
      expect.objectContaining({ name: '토큰 1' }),
      expect.objectContaining({ name: '토큰 2' }),
    ]);
    expect(profileData).toContain('secret-token-1');
    expect(profileData).toContain('secret-token-2');
  });

  test('최초 상태에서 이름과 토큰을 저장하되 목록에는 토큰을 노출하지 않는다', async () => {
    const service = new LoginService();
    await service.saveTokenProfile('계정 1', 'secret-token-1');

    expect(service.listTokenProfiles()).toEqual([
      expect.objectContaining({ name: '계정 1' }),
    ]);
    expect(service.listTokenProfiles()[0]).not.toHaveProperty('token');
    expect(profileData).toContain('secret-token-1');
  });

  test('저장된 토큰의 표시 이름을 변경한다', async () => {
    const service = new LoginService();
    await service.saveToken('secret-token-1');
    const id = service.listTokenProfiles()[0].id;

    await service.renameTokenProfile(id, '  작업 계정  ');

    expect(service.listTokenProfiles()).toEqual([
      expect.objectContaining({ id, name: '작업 계정' }),
    ]);
    expect(JSON.parse(profileData!).profiles[0].name).toBe('작업 계정');
  });

  test('토큰 표시 이름은 중복될 수 없다', async () => {
    const service = new LoginService();
    await service.saveTokenProfile('작업 계정', 'secret-token-1');
    await service.saveTokenProfile('보조 계정', 'secret-token-2');
    const secondId = service.listTokenProfiles()[1].id;

    await expect(
      service.renameTokenProfile(secondId, '작업 계정'),
    ).rejects.toThrow('같은 이름의 토큰 프리셋이 있습니다');
  });

  test('저장 토큰의 V5 할당량을 현재 로그인 변경 없이 순차 조회한다', async () => {
    const service = new LoginService();
    await service.saveTokenProfile('주 계정', 'secret-token-1');
    await service.saveTokenProfile('보조 계정', 'secret-token-2');

    const results = await service.checkTokenProfileUsages();

    expect(results).toEqual([
      expect.objectContaining({ name: '주 계정', validity: 'valid', usage: expect.objectContaining({ percent: 88 }) }),
      expect.objectContaining({ name: '보조 계정', validity: 'valid', usage: expect.objectContaining({ percent: 42 }) }),
    ]);
    expect(backend.getOpusUsageStatusForToken.mock.calls.map(([token]) => token)).toEqual([
      'secret-token-1',
      'secret-token-2',
    ]);
    expect(backend.loginWithToken).not.toHaveBeenCalled();
  });

  test('할당량 조회 실패 시 토큰 검증으로 로그인 실패를 구분한다', async () => {
    const service = new LoginService();
    await service.saveTokenProfile('만료 계정', 'expired-token');
    backend.getOpusUsageStatusForToken.mockRejectedValueOnce(new Error('HTTP error:401'));
    backend.validateToken.mockResolvedValueOnce('invalid');

    await expect(service.checkTokenProfileUsages()).resolves.toEqual([
      expect.objectContaining({ name: '만료 계정', validity: 'invalid' }),
    ]);
  });

  test('후보 토큰 검증 후 기존 로그인 파일을 교체하고 활성 상태를 저장한다', async () => {
    const service = new LoginService();
    await service.saveTokenProfile('계정 2', 'secret-token-2');
    const id = service.listTokenProfiles()[0].id;

    await service.activateTokenProfile(id);

    expect(backend.validateToken).toHaveBeenCalledWith('secret-token-2');
    expect(backend.loginWithToken).toHaveBeenCalledWith('secret-token-2');
    expect(currentToken).toBe('secret-token-2');
    expect(service.activeProfileId).toBe(id);
    expect(JSON.parse(profileData!).activeId).toBe(id);
  });

  test('유효하지 않은 저장 토큰은 현재 로그인 파일을 덮어쓰지 않는다', async () => {
    const service = new LoginService();
    await service.saveTokenProfile('잘못된 계정', 'invalid-token');
    const id = service.listTokenProfiles()[0].id;
    currentToken = 'original-token';
    backend.validateToken.mockResolvedValueOnce('invalid');

    await expect(service.activateTokenProfile(id)).rejects.toThrow(
      '저장된 토큰이 유효하지 않습니다',
    );

    expect(backend.loginWithToken).not.toHaveBeenCalled();
    expect(currentToken).toBe('original-token');
    expect(service.activeProfileId).toBeUndefined();
  });

  test('활성 프리셋 삭제는 현재 로그인 토큰을 지우지 않는다', async () => {
    const service = new LoginService();
    await service.saveTokenProfile('계정 3', 'secret-token-3');
    const id = service.listTokenProfiles()[0].id;
    await service.activateTokenProfile(id);
    backend.loginWithToken.mockClear();

    await service.deleteTokenProfile(id);

    expect(service.listTokenProfiles()).toEqual([]);
    expect(service.activeProfileId).toBeUndefined();
    expect(backend.loginWithToken).not.toHaveBeenCalled();
    expect(currentToken).toBe('secret-token-3');
  });

  test('직접 로그인한 토큰과 일치하는 저장 프리셋을 활성 표시한다', async () => {
    const service = new LoginService();
    await service.saveTokenProfile('계정 4', 'secret-token-4');
    const id = service.listTokenProfiles()[0].id;

    await service.loginWithToken('secret-token-4');

    expect(service.activeProfileId).toBe(id);
  });

  test('활성 토큰 다음 순서에서 기준 이상인 Opus 토큰으로 자동 전환한다', async () => {
    const service = new LoginService();
    await service.saveTokenProfile('주 계정', 'secret-token-1');
    await service.saveTokenProfile('부족 계정', 'secret-token-2');
    await service.saveTokenProfile('여유 계정', 'secret-token-3');
    const [first, , third] = service.listTokenProfiles();
    await service.activateTokenProfile(first.id);
    backend.loginWithToken.mockClear();
    backend.getOpusUsageStatusForToken.mockImplementation(async (token: string) => ({
      percent: token === 'secret-token-2' ? 20 : 40,
      isNegative: false,
      timeUntilNextPercent: 60,
    }));

    const result = await service.tryAutoRotateToken(25);

    expect(result).toEqual(
      expect.objectContaining({
        switched: true,
        from: expect.objectContaining({ name: '주 계정' }),
        to: expect.objectContaining({ name: '여유 계정' }),
        usage: expect.objectContaining({ percent: 40 }),
      }),
    );
    expect(backend.getOpusUsageStatusForToken.mock.calls.map(([token]) => token)).toEqual([
      'secret-token-2',
      'secret-token-3',
    ]);
    expect(backend.loginWithToken).toHaveBeenCalledWith('secret-token-3');
    expect(service.activeProfileId).toBe(third.id);
    expect(JSON.parse(profileData!).activeId).toBe(third.id);
  });

  test('후보가 없을 때 반복 이미지에서 후보 조회를 1분간 재시도하지 않는다', async () => {
    const service = new LoginService();
    await service.saveTokenProfile('주 계정', 'secret-token-1');
    await service.saveTokenProfile('부족 계정', 'secret-token-2');
    const first = service.listTokenProfiles()[0];
    await service.activateTokenProfile(first.id);
    backend.getOpusUsageStatusForToken.mockResolvedValue({
      percent: 5,
      isNegative: false,
      timeUntilNextPercent: 60,
    });

    await expect(service.tryAutoRotateToken(25)).resolves.toEqual({
      switched: false,
      reason: 'no-candidate',
    });
    await expect(service.tryAutoRotateToken(25)).resolves.toEqual({
      switched: false,
      reason: 'cooldown',
    });

    expect(backend.getOpusUsageStatusForToken).toHaveBeenCalledTimes(1);
  });

  test('균형 순회는 여유 기준과 현재보다 5퍼센트포인트 높은 후보로만 전환한다', async () => {
    const service = new LoginService();
    await service.saveTokenProfile('현재 계정', 'secret-token-1');
    await service.saveTokenProfile('비슷한 계정', 'secret-token-2');
    await service.saveTokenProfile('회복 계정', 'secret-token-3');
    const [first, , third] = service.listTokenProfiles();
    await service.activateTokenProfile(first.id);
    backend.loginWithToken.mockClear();
    backend.getOpusUsageStatusForToken.mockImplementation(async (token: string) => ({
      percent: token === 'secret-token-2' ? 82 : 90,
      isNegative: false,
      timeUntilNextPercent: 60,
    }));

    const result = await service.tryAutoBalanceToken(80, 84);

    expect(result).toEqual(
      expect.objectContaining({
        switched: true,
        to: expect.objectContaining({ name: '회복 계정' }),
        usage: expect.objectContaining({ percent: 90 }),
      }),
    );
    expect(backend.loginWithToken).toHaveBeenCalledWith('secret-token-3');
    expect(service.activeProfileId).toBe(third.id);
    backend.getOpusUsageStatusForToken.mockClear();
    await expect(service.tryAutoBalanceToken(80, 90)).resolves.toEqual({
      switched: false,
      reason: 'cooldown',
    });
    expect(backend.getOpusUsageStatusForToken).not.toHaveBeenCalled();
  });

  test('균형 탐색 쿨다운은 긴급 저잔량 전환을 막지 않는다', async () => {
    const service = new LoginService();
    await service.saveTokenProfile('현재 계정', 'secret-token-1');
    await service.saveTokenProfile('보조 계정', 'secret-token-2');
    const first = service.listTokenProfiles()[0];
    await service.activateTokenProfile(first.id);
    backend.loginWithToken.mockClear();

    backend.getOpusUsageStatusForToken.mockResolvedValueOnce({
      percent: 70,
      isNegative: false,
      timeUntilNextPercent: 60,
    });
    await expect(service.tryAutoBalanceToken(80, 75)).resolves.toEqual({
      switched: false,
      reason: 'no-candidate',
    });

    backend.getOpusUsageStatusForToken.mockResolvedValueOnce({
      percent: 40,
      isNegative: false,
      timeUntilNextPercent: 60,
    });
    await expect(service.tryAutoRotateToken(25)).resolves.toEqual(
      expect.objectContaining({ switched: true }),
    );
    expect(backend.loginWithToken).toHaveBeenCalledWith('secret-token-2');
  });

  test('현재 잔량이 96퍼센트 이상이면 5퍼센트포인트 우위 후보를 조회하지 않는다', async () => {
    const service = new LoginService();

    await expect(service.tryAutoBalanceToken(80, 96)).resolves.toEqual({
      switched: false,
      reason: 'no-candidate',
    });
    expect(backend.getOpusUsageStatusForToken).not.toHaveBeenCalled();
  });

  test('활성 저장 토큰이 없으면 자동 순회를 수행하지 않는다', async () => {
    const service = new LoginService();
    await service.saveTokenProfile('계정 1', 'secret-token-1');
    await service.saveTokenProfile('계정 2', 'secret-token-2');

    await expect(service.tryAutoRotateToken(25)).resolves.toEqual({
      switched: false,
      reason: 'not-ready',
    });
    expect(backend.getOpusUsageStatusForToken).not.toHaveBeenCalled();
    expect(backend.loginWithToken).not.toHaveBeenCalled();
  });
});

describe('로그인 복구 회귀', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

  test('늦은 이전 오류가 최신 성공을 취소하지 않는다', async () => {
    let finish!: (value: LoginValidity) => void;
    backend.validateLogin.mockImplementationOnce(() => new Promise(r => { finish = r; }));
    const service = new LoginService();
    const old = service.refresh();
    await Promise.resolve();
    await service.refresh();
    finish('error');
    await old;
    expect(service.loggedIn).toBe(true);
  });

  test('첫 통신 실패 후 타이머 재검증으로 복구한다', async () => {
    backend.validateLogin.mockResolvedValueOnce('error');
    const service = new LoginService();
    await service.refresh();
    expect(service.loggedIn).toBe(false);
    await jest.advanceTimersByTimeAsync(30_000);
    expect(service.loggedIn).toBe(true);
  });

  test('잘못된 직접 입력은 기존 인증 파일을 덮어쓰지 않는다', async () => {
    currentToken = 'existing';
    backend.validateToken.mockResolvedValueOnce('invalid');
    const service = new LoginService();
    await expect(service.loginWithToken('bad')).rejects.toThrow('유효');
    expect(currentToken).toBe('existing');
    expect(backend.loginWithToken).not.toHaveBeenCalled();
  });

  test('직접 입력 통신 실패를 로그인 성공으로 반환하지 않는다', async () => {
    backend.validateToken.mockResolvedValueOnce('error');
    await expect(new LoginService().loginWithToken('candidate')).rejects.toThrow('네트워크');
    expect(backend.loginWithToken).not.toHaveBeenCalled();
  });

  const saved = () => {
    profileData = JSON.stringify({ version: 1, activeId: 'a', profiles: [
      { id: 'a', name: 'A', token: 'first' }, { id: 'b', name: 'B', token: 'second' },
    ] });
  };

  test('인증 파일이 없으면 검증된 마지막 활성 토큰만 복구한다', async () => {
    saved();
    const service = new LoginService();
    await service.initializeLogin(true);
    expect(currentToken).toBe('first');
    expect(service.loggedIn).toBe(true);
  });

  test('실제 인증 파일과 다르면 실제 토큰으로 활성 표시를 정정한다', async () => {
    saved(); currentToken = 'second';
    const service = new LoginService();
    await service.initializeLogin(true);
    expect(service.activeProfileId).toBe('b');
    expect(backend.loginWithToken).not.toHaveBeenCalled();
  });

  test('프리셋 밖 직접 토큰도 보존하며 활성 표시만 해제한다', async () => {
    saved(); currentToken = 'manual';
    const service = new LoginService();
    await service.initializeLogin(true);
    expect(service.activeProfileId).toBeUndefined();
    expect(currentToken).toBe('manual');
  });

  test('읽기 오류를 파일 부재로 간주하여 복구하지 않는다', async () => {
    saved();
    backend.readLoginToken.mockRejectedValueOnce(new Error('EACCES'));
    expect(await new LoginService().initializeLogin(true)).toBe('error');
    expect(backend.loginWithToken).not.toHaveBeenCalled();
  });

  test('보조 창에서는 프리셋 복구 쓰기를 하지 않는다', async () => {
    saved();
    await new LoginService().initializeLogin(false);
    expect(backend.loginWithToken).not.toHaveBeenCalled();
    expect(backend.writeTokenProfileData).not.toHaveBeenCalled();
  });
});

describe('프리셋 복구 실패의 격리', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });
  test('손상된 프리셋이 기존 토큰의 인증을 막지 않는다', async () => {
    profileData = '{broken'; currentToken = 'existing';
    const service = new LoginService();
    expect(await service.initializeLogin(true)).toBe('valid');
    expect(service.loggedIn).toBe(true);
    expect(backend.loginWithToken).not.toHaveBeenCalled();
  });
  test('복구 후보 검증 통신 실패는 재시도하고 무검증 저장하지 않는다', async () => {
    profileData = JSON.stringify({version: 1, activeId: 'a', profiles: [{id:'a',name:'A',token:'candidate'}]});
    backend.validateToken.mockResolvedValueOnce('error');
    const service = new LoginService();
    expect(await service.initializeLogin(true)).toBe('error');
    expect(backend.loginWithToken).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(30_000);
    expect(currentToken).toBe('candidate');
    expect(service.loggedIn).toBe(true);
  });
  test('무효한 마지막 활성 토큰은 복구하지 않는다', async () => {
    profileData = JSON.stringify({version: 1, activeId: 'a', profiles: [{id:'a',name:'A',token:'candidate'}]});
    backend.validateToken.mockResolvedValueOnce('invalid');
    backend.validateLogin.mockResolvedValueOnce('invalid');
    const service = new LoginService();
    expect(await service.initializeLogin(true)).toBe('invalid');
    expect(backend.loginWithToken).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });
});

test('검증된 프리셋 전환은 중복 인증 조회 없이 로그인 상태를 확정한다', async () => {
  profileData = JSON.stringify({version: 1, activeId: 'a', profiles: [{id:'a',name:'A',token:'candidate'}]});
  const service = new LoginService();
  await service.activateTokenProfile('a');
  expect(service.loggedIn).toBe(true);
  expect(backend.validateLogin).not.toHaveBeenCalled();
});
