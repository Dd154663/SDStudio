import { backend } from '.';
import type { LoginValidity, OpusUsageStatus } from '../backends/imageGen';
import { persistService } from './PersistenceService';
import { minimumBalancedTokenPercent } from './tokenAutoRotation';

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
  checkedAt?: number;
}

export type LoginTokenRotationResult =
  | {
      switched: true;
      from: LoginTokenProfile;
      to: LoginTokenProfile;
      usage: OpusUsageStatus;
      stateSaved: boolean;
    }
  | {
      switched: false;
      reason: 'not-ready' | 'cooldown' | 'no-candidate' | 'switch-failed';
    };

const AUTO_ROTATION_RETRY_MS = 60_000;
const AUTO_BALANCE_RETRY_MS = 30 * 60_000;

export class LoginService extends EventTarget {
  loggedIn: boolean;
  private tokenProfiles: StoredTokenProfile[] = [];
  private tokenProfilesLoaded = false;
  private tokenProfilesLoading?: Promise<void>;
  private activeTokenProfileId?: string;
  private autoRotationInFlight?: Promise<LoginTokenRotationResult>;
  private nextAutoRotationAttemptAt = 0;
  private nextAutoBalanceAttemptAt = 0;

  private validationRevision = 0;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private retryDelay = 30_000;
  private reconcileOnRefresh = false;
  private tokenWriteQueue: Promise<void> = Promise.resolve();

  private invalidateValidation(): void {
    this.validationRevision++;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
  }

  private async writeLoginToken(token: string): Promise<void> {
    this.invalidateValidation();
    const write = this.tokenWriteQueue.then(() => backend.loginWithToken(token));
    this.tokenWriteQueue = write.catch(() => {});
    try {
      await write;
    } finally {
      this.invalidateValidation();
    }
  }

  async initializeLogin(restoreProfiles: boolean): Promise<LoginValidity> {
    this.reconcileOnRefresh = restoreProfiles;
    return this.refresh();
  }

  // 실제 토큰이 우선이다. 파일 부재만 검증된 마지막 활성 토큰으로 복구한다.
  private async reconcileToken(revision: number): Promise<void> {
    const token = await backend.readLoginToken();
    try {
      await this.ensureTokenProfilesLoaded();
    } catch (e) {
      // 프리셋 손상/저장 실패가 별도로 존재하는 정상 인증을 막지 않는다.
      if (token) return;
      throw e;
    }
    if (revision !== this.validationRevision) return;
    if (token) {
      const id = this.tokenProfiles.find((p) => p.token === token)?.id;
      if (id !== this.activeTokenProfileId) {
        try {
          await this.persistTokenProfiles(this.tokenProfiles, id);
        } catch (e) {
          this.activeTokenProfileId = id;
          this.emitTokenProfilesChange();
        }
      }
      return;
    }
    const active = this.tokenProfiles.find((p) => p.id === this.activeTokenProfileId);
    if (!active) return;
    const validity = await backend.validateToken(active.token);
    if (revision !== this.validationRevision) return;
    if (validity === 'error') throw new Error('토큰 복구 검증을 재시도해야 합니다');
    if (validity !== 'valid') return;
    // 검증 도중 다른 창에서 로그인했으면 기존 토큰을 보존한다.
    if (await backend.readLoginToken()) return;
    if (revision !== this.validationRevision) return;
    const restore = this.tokenWriteQueue.then(async () => {
      if (revision !== this.validationRevision) return;
      if (await backend.readLoginToken()) return;
      if (revision === this.validationRevision) await backend.loginWithToken(active.token);
    });
    this.tokenWriteQueue = restore.catch(() => {});
    await restore;
  }

  constructor() {
    super();
    this.loggedIn = false;
    // 시작 시 토큰 검증은 bootstrap 이 initializeLogin() 을 호출해 수행한다
    // (생성자에서 네트워크 IO 를 시작하지 않는다 — 부팅 순서 보장).
    // 세션 도중 만료는 TobBar의 크레딧 조회 실패 시 재검증으로 잡힌다.
  }

  async login(email: string, password: string) {
    await backend.login(email, password);
    await this.refresh(true);
  }

  async loginWithToken(token: string) {
    token = token.trim();
    const validity = await backend.validateToken(token);
    if (validity === 'invalid') throw new Error('토큰이 유효하지 않습니다');
    if (validity !== 'valid') throw new Error('네트워크 오류로 토큰을 확인할 수 없습니다. 다시 시도해주세요');
    await this.writeLoginToken(token);
    // 방금 검증한 토큰을 저장했으므로 중복 조회 실패로 성공을 취소하지 않는다.
    this.loggedIn = true;
    this.dispatchEvent(new CustomEvent('change', {}));
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

    await this.writeLoginToken(profile.token);
    this.loggedIn = true;
    try {
      await this.persistTokenProfiles(this.tokenProfiles, profile.id);
    } catch (e) {
      // 실제 토큰 전환은 끝났으므로 현재 세션의 표시만큼은 진실을 유지한다.
      this.activeTokenProfileId = profile.id;
      this.emitTokenProfilesChange();
      this.dispatchEvent(new CustomEvent('change', {}));
      throw new Error('로그인은 전환됐지만 활성 프리셋 상태를 저장하지 못했습니다');
    }
    this.dispatchEvent(new CustomEvent('change', {}));
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
          checkedAt: Date.now(),
        });
      } catch (e) {
        // 정상 Opus 토큰은 user/data 한 번으로 확인된다. 실패한 경우에만 토큰
        // 검증을 추가해 만료와 일시적인 사용량 조회 오류를 구분한다.
        let validity: LoginValidity = 'error';
        try {
          validity = await backend.validateToken(profile.token);
        } catch (e2) {}
        results.push({ id: profile.id, name: profile.name, validity, checkedAt: Date.now() });
      }
    }
    return results;
  }

  async tryAutoRotateToken(
    minimumPercent: number,
  ): Promise<LoginTokenRotationResult> {
    if (this.autoRotationInFlight) return this.autoRotationInFlight;
    this.autoRotationInFlight = this.tryAutoRotateTokenInternal(
      minimumPercent,
    ).finally(() => {
      this.autoRotationInFlight = undefined;
    });
    return this.autoRotationInFlight;
  }

  async tryAutoBalanceToken(
    balancePercent: number,
    currentPercent: number,
  ): Promise<LoginTokenRotationResult> {
    if (this.autoRotationInFlight) return this.autoRotationInFlight;
    const minimumPercent = minimumBalancedTokenPercent(
      currentPercent,
      balancePercent,
    );
    // 현재 잔량이 96% 이상이면 5%p 더 많은 후보는 존재할 수 없다.
    if (minimumPercent > 100) {
      return { switched: false, reason: 'no-candidate' };
    }
    this.autoRotationInFlight = this.tryAutoRotateTokenInternal(
      minimumPercent,
      'balance',
    ).finally(() => {
      this.autoRotationInFlight = undefined;
    });
    return this.autoRotationInFlight;
  }

  private async tryAutoRotateTokenInternal(
    minimumPercent: number,
    mode: 'urgent' | 'balance' = 'urgent',
  ): Promise<LoginTokenRotationResult> {
    const revision = this.validationRevision;
    await this.ensureTokenProfilesLoaded();
    let currentToken: string | undefined;
    try {
      currentToken = (await backend.readLoginToken())?.trim();
    } catch (e) {
      return { switched: false, reason: 'not-ready' };
    }
    const activeIndex = this.tokenProfiles.findIndex(
      (profile) =>
        profile.id === this.activeTokenProfileId &&
        profile.token === currentToken,
    );
    if (this.tokenProfiles.length < 2 || activeIndex < 0) {
      return { switched: false, reason: 'not-ready' };
    }
    const now = Date.now();
    const nextAttemptAt =
      mode === 'balance'
        ? this.nextAutoBalanceAttemptAt
        : this.nextAutoRotationAttemptAt;
    if (now < nextAttemptAt) {
      return { switched: false, reason: 'cooldown' };
    }

    // 긴급 전환과 느린 회복 균형 탐색의 쿨다운은 분리한다. 여유 탐색 직후
    // 현재 계정이 급격히 소진돼도 긴급 전환까지 막히지 않아야 한다.
    if (mode === 'balance') {
      this.nextAutoBalanceAttemptAt = now + AUTO_BALANCE_RETRY_MS;
    } else {
      this.nextAutoRotationAttemptAt = now + AUTO_ROTATION_RETRY_MS;
    }
    minimumPercent = Math.max(1, Math.min(100, Math.round(minimumPercent)));
    const from = this.tokenProfiles[activeIndex];

    for (let offset = 1; offset < this.tokenProfiles.length; offset++) {
      const candidate =
        this.tokenProfiles[(activeIndex + offset) % this.tokenProfiles.length];
      let usage: OpusUsageStatus;
      try {
        // user/data에서 Opus usage를 정상 수신한 토큰만 후보로 인정한다.
        usage = await backend.getOpusUsageStatusForToken(candidate.token);
      } catch (e) {
        continue;
      }
      if (usage.isNegative || usage.percent < minimumPercent) continue;

      if (revision !== this.validationRevision) return { switched: false, reason: 'not-ready' };
      try {
        await this.writeLoginToken(candidate.token);
      } catch (e) {
        return { switched: false, reason: 'switch-failed' };
      }

      let stateSaved = true;
      try {
        await this.persistTokenProfiles(this.tokenProfiles, candidate.id);
      } catch (e) {
        // TOKEN.txt 전환은 이미 끝났으므로 현재 세션 표시는 실제 상태를 따른다.
        // 생성은 새 토큰으로 계속하되 호출부가 저장 실패를 사용자에게 알린다.
        stateSaved = false;
        this.activeTokenProfileId = candidate.id;
        this.emitTokenProfilesChange();
      }
      if (!this.loggedIn) {
        this.loggedIn = true;
        this.dispatchEvent(new CustomEvent('change', {}));
      }
      // 어떤 경로로 전환했든 새 계정의 상태가 안정될 때까지 여유 순회를
      // 다시 검사하지 않는다. 긴급 저잔량 전환은 계속 별도로 허용한다.
      this.nextAutoBalanceAttemptAt = Math.max(
        this.nextAutoBalanceAttemptAt,
        Date.now() + AUTO_BALANCE_RETRY_MS,
      );
      return {
        switched: true,
        from: { id: from.id, name: from.name },
        to: { id: candidate.id, name: candidate.name },
        usage,
        stateSaved,
      };
    }
    return { switched: false, reason: 'no-candidate' };
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
    this.invalidateValidation();
    const revision = this.validationRevision;
    let result: LoginValidity = 'error';
    try {
      await this.tokenWriteQueue;
      if (revision !== this.validationRevision) return 'error';
      if (this.reconcileOnRefresh) await this.reconcileToken(revision);
      if (revision !== this.validationRevision) return 'error';
      result = await backend.validateLogin();
    } catch (e) {
      // 저장소/네트워크 오류는 인증 거부와 구분한다.
    }
    if (revision !== this.validationRevision) return 'error';
    const next = result === 'error' ? this.loggedIn : result === 'valid';
    const changed = next !== this.loggedIn;
    this.loggedIn = next;
    if (result === 'error') {
      this.retryTimer = setTimeout(() => {
        this.retryTimer = undefined;
        void this.refresh();
      }, this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 2, 300_000);
    } else {
      this.retryDelay = 30_000;
    }
    if (changed || force) this.dispatchEvent(new CustomEvent('change', {}));
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
      this.tokenProfiles = parsed.profiles.map((p) => ({ ...p, token: p.token.trim() }));
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
