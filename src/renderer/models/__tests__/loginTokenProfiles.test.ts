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
});
