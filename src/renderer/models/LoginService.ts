import { backend } from '.';
import type { LoginValidity, OpusUsageStatus } from '../backends/imageGen';
import { persistService } from './PersistenceService';

const TOKEN_PROFILE_STORE_KEY = 'auth:TOKEN_PROFILES.json';

interface StoredTokenProfile {
  id: string;
  name: string;
  token: string;
}

interface StoredTokenProfileData {
  version: 1;
  activeId?: string;
  profiles: StoredTokenProfile[];
}

export interface LoginTokenProfile {
  id: string;
  name: string;
}

export interface LoginTokenUsageCheck extends LoginTokenProfile {
  validity: LoginValidity;
  usage?: OpusUsageStatus;
}

export class LoginService extends EventTarget {
  loggedIn: boolean;
  private tokenProfiles: StoredTokenProfile[] = [];
  private tokenProfilesLoaded = false;
  private tokenProfilesLoading?: Promise<void>;
  private activeTokenProfileId?: string;

  constructor() {
    super();
    this.loggedIn = false;
    // 시작 시 1회 토큰 검증은 bootstrap 이 refresh() 를 호출해 수행한다
    // (생성자에서 네트워크 IO 를 시작하지 않는다 — 부팅 순서 보장).
    // 세션 도중 만료는 TobBar의 크레딧 조회 실패 시 재검증으로 잡힌다.
  }

  async login(email: string, password: string) {
    await backend.login(email, password);
    await this.refresh(true);
  }

  async loginWithToken(token: string) {
    await backend.loginWithToken(token);
    await this.refresh(true);
    // 직접 붙여넣은 토큰이 저장 프리셋과 같으면 해당 항목을 활성 표시한다.
    // 일치하지 않으면 수동 로그인 상태로 표시하며, 로그인 성공 자체는 프로필
    // 메타데이터 저장 실패의 영향을 받지 않는다.
    try {
      await this.ensureTokenProfilesLoaded();
      const matched = this.tokenProfiles.find((p) => p.token === token);
      try {
        await this.persistTokenProfiles(this.tokenProfiles, matched?.id);
      } catch (e) {
        this.activeTokenProfileId = matched?.id;
        this.emitTokenProfilesChange();
      }
    } catch (e) {}
  }

  async loadTokenProfiles(): Promise<void> {
    await this.ensureTokenProfilesLoaded();
  }

  listTokenProfiles(): LoginTokenProfile[] {
    return this.tokenProfiles.map(({ id, name }) => ({ id, name }));
  }

  get activeProfileId(): string | undefined {
    return this.activeTokenProfileId;
  }

  async saveToken(token: string): Promise<void> {
    await this.ensureTokenProfilesLoaded();
    const usedNames = new Set(
      this.tokenProfiles.map((p) => p.name.trim().toLowerCase()),
    );
    let index = 1;
    while (usedNames.has(`토큰 ${index}`.toLowerCase())) index++;
    await this.saveTokenProfile(`토큰 ${index}`, token);
  }

  async saveTokenProfile(name: string, token: string): Promise<void> {
    await this.ensureTokenProfilesLoaded();
    name = name.trim();
    token = token.trim();
    if (!name) throw new Error('프리셋 이름을 입력해주세요');
    if (name.length > 40) throw new Error('프리셋 이름은 40자 이하로 입력해주세요');
    if (!token) throw new Error('API 토큰을 입력해주세요');
    if (this.tokenProfiles.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      throw new Error('같은 이름의 토큰 프리셋이 있습니다');
    }
    if (this.tokenProfiles.some((p) => p.token === token)) {
      throw new Error('이미 저장된 토큰입니다');
    }
    const id = `${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    await this.persistTokenProfiles(
      [...this.tokenProfiles, { id, name, token }],
      this.activeTokenProfileId,
    );
  }

  async activateTokenProfile(id: string): Promise<LoginValidity> {
    await this.ensureTokenProfilesLoaded();
    const profile = this.tokenProfiles.find((p) => p.id === id);
    if (!profile) throw new Error('토큰 프리셋을 찾을 수 없습니다');

    // 후보를 먼저 검증해 잘못된 저장값으로 현재 정상 토큰을 덮어쓰지 않는다.
    const validity = await backend.validateToken(profile.token);
    if (validity === 'invalid') throw new Error('저장된 토큰이 유효하지 않습니다');
    if (validity === 'error') {
      throw new Error('네트워크 오류로 토큰을 확인할 수 없습니다');
    }

    await backend.loginWithToken(profile.token);
    try {
      await this.persistTokenProfiles(this.tokenProfiles, profile.id);
    } catch (e) {
      // 실제 토큰 전환은 끝났으므로 현재 세션의 표시만큼은 진실을 유지한다.
      this.activeTokenProfileId = profile.id;
      this.emitTokenProfilesChange();
      await this.refresh(true);
      throw new Error('로그인은 전환됐지만 활성 프리셋 상태를 저장하지 못했습니다');
    }
    await this.refresh(true);
    return validity;
  }

  async renameTokenProfile(id: string, name: string): Promise<void> {
    await this.ensureTokenProfilesLoaded();
    name = name.trim();
    if (!name) throw new Error('토큰 이름을 입력해주세요');
    if (name.length > 40) throw new Error('토큰 이름은 40자 이하로 입력해주세요');
    const profile = this.tokenProfiles.find((p) => p.id === id);
    if (!profile) throw new Error('토큰 프리셋을 찾을 수 없습니다');
    if (
      this.tokenProfiles.some(
        (p) => p.id !== id && p.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      throw new Error('같은 이름의 토큰 프리셋이 있습니다');
    }
    if (profile.name === name) return;
    await this.persistTokenProfiles(
      this.tokenProfiles.map((p) => (p.id === id ? { ...p, name } : p)),
      this.activeTokenProfileId,
    );
  }

  async checkTokenProfileUsages(): Promise<LoginTokenUsageCheck[]> {
    await this.ensureTokenProfilesLoaded();
    const results: LoginTokenUsageCheck[] = [];
    // 여러 계정에 동시에 요청을 몰아 보내지 않도록 저장 순서대로 한 번씩 조회한다.
    for (const profile of this.tokenProfiles) {
      try {
        const usage = await backend.getOpusUsageStatusForToken(profile.token);
        results.push({
          id: profile.id,
          name: profile.name,
          validity: 'valid',
          usage,
        });
      } catch (e) {
        // 정상 Opus 토큰은 user/data 한 번으로 확인된다. 실패한 경우에만 토큰
        // 검증을 추가해 만료와 일시적인 사용량 조회 오류를 구분한다.
        let validity: LoginValidity = 'error';
        try {
          validity = await backend.validateToken(profile.token);
        } catch (e2) {}
        results.push({ id: profile.id, name: profile.name, validity });
      }
    }
    return results;
  }

  async deleteTokenProfile(id: string): Promise<void> {
    await this.ensureTokenProfilesLoaded();
    if (!this.tokenProfiles.some((p) => p.id === id)) return;
    await this.persistTokenProfiles(
      this.tokenProfiles.filter((p) => p.id !== id),
      this.activeTokenProfileId === id ? undefined : this.activeTokenProfileId,
    );
  }

  // 저장된 토큰을 NovelAI API로 실제 검증한다(단순 파일 존재 확인이 아님).
  // valid → 로그인 ON, invalid(인증 거부) → OFF, error(네트워크 등 불확실) → 현재 상태 유지.
  // 상태가 실제로 바뀔 때만 'change'를 발생시켜(또는 force 시) 재검증 루프를 방지한다.
  async refresh(force = false): Promise<LoginValidity> {
    let next = this.loggedIn;
    let result: LoginValidity = 'error';
    try {
      result = await backend.validateLogin();
      if (result === 'valid') next = true;
      else if (result === 'invalid') next = false;
      // 'error' → 일시 오류로 보고 현재 상태 유지(오탐 방지)
    } catch (e) {
      // 예기치 못한 오류 → 상태 유지
    }
    const changed = next !== this.loggedIn;
    this.loggedIn = next;
    if (changed || force) {
      this.dispatchEvent(new CustomEvent('change', {}));
    }
    return result;
  }

  private async ensureTokenProfilesLoaded(): Promise<void> {
    if (this.tokenProfilesLoaded) return;
    if (this.tokenProfilesLoading) return this.tokenProfilesLoading;
    this.tokenProfilesLoading = (async () => {
      const raw = await backend.readTokenProfileData();
      if (!raw) {
        await this.initializeEmptyTokenProfiles();
        return;
      }

      let parsed: StoredTokenProfileData;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        throw new Error('토큰 프리셋 파일을 읽을 수 없습니다');
      }
      if (
        parsed?.version !== 1 ||
        !Array.isArray(parsed.profiles) ||
        parsed.profiles.some(
          (p) =>
            !p ||
            typeof p.id !== 'string' ||
            typeof p.name !== 'string' ||
            typeof p.token !== 'string' ||
            !p.id ||
            !p.name.trim() ||
            !p.token.trim(),
        )
      ) {
        throw new Error('토큰 프리셋 파일 형식이 올바르지 않습니다');
      }
      const ids = new Set(parsed.profiles.map((p) => p.id));
      if (ids.size !== parsed.profiles.length) {
        throw new Error('토큰 프리셋 파일에 중복 항목이 있습니다');
      }
      this.tokenProfiles = parsed.profiles.map((p) => ({ ...p }));
      this.activeTokenProfileId = ids.has(parsed.activeId || '')
        ? parsed.activeId
        : undefined;
      this.tokenProfilesLoaded = true;
      this.emitTokenProfilesChange();
    })().finally(() => {
      this.tokenProfilesLoading = undefined;
    });
    return this.tokenProfilesLoading;
  }

  private async initializeEmptyTokenProfiles(): Promise<void> {
    const token = (await backend.readLoginToken())?.trim();
    if (!token) {
      this.tokenProfiles = [];
      this.activeTokenProfileId = undefined;
      this.tokenProfilesLoaded = true;
      this.emitTokenProfilesChange();
      return;
    }
    const id = `${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    await this.persistTokenProfiles([{ id, name: '토큰 1', token }], id);
  }

  private async persistTokenProfiles(
    profiles: StoredTokenProfile[],
    activeId?: string,
  ): Promise<void> {
    const data: StoredTokenProfileData = {
      version: 1,
      activeId,
      profiles,
    };
    await persistService.writeWith(
      TOKEN_PROFILE_STORE_KEY,
      JSON.stringify(data),
      (next) => backend.writeTokenProfileData(next),
    );
    this.tokenProfiles = profiles.map((p) => ({ ...p }));
    this.activeTokenProfileId = activeId;
    this.tokenProfilesLoaded = true;
    this.emitTokenProfilesChange();
  }

  private emitTokenProfilesChange(): void {
    this.dispatchEvent(new Event('token-profiles-change'));
  }
}
