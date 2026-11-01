// 부스트 모드 참여 계정 결정(B2, 2026-11-01). 서비스는 주입받는다(index.ts — jest 는 가짜를 넣는다).
//
// · 후보 = LoginService.getBoostAccountSnapshot() 의 candidates(현재 로그인 토큰과 같은 프로필은 이미 빠짐).
// · 후보마다 **저장 순서대로 한 번씩** `/user/data` 조회(getOpusUsageStatusForToken) — 여러 계정에 조회를 동시에
//   몰아 보내지 않는다(LoginService.checkTokenProfileUsages 와 같은 원칙). 진행 중 조회는 합친다.
// · 자격은 boostMode.isBoostAccountEligible(D1 3택1).
// · 결과는 캐시한다 — 실행 시작은 새로 조회(maxAgeMs 0, backend 10초 캐시는 탐), 예약 시점 A 배수(D3)는
//   RESERVATION_PARTICIPANT_MAX_AGE_MS 안의 마지막 결과를 재사용하고 없거나 오래됐으면 그때 1회 조회한다.
// 토큰은 반환값(메모리)으로만 흐른다 — 로그·미러·IPC·메타에 싣지 않는다.

import type { OpusUsageStatus } from '../backends/imageGen';
import {
  BoostAccountScope,
  BoostSettings,
  isBoostAccountEligible,
  resolveBoostSettings,
} from './boostMode';

export interface BoostCandidate {
  id: string;
  name: string;
  token: string;
}

export interface BoostParticipant extends BoostCandidate {
  usage?: OpusUsageStatus;
}

export interface BoostAccountSnapshot {
  active?: { id: string; name: string };
  candidates: BoostCandidate[];
}

export interface BoostPlannerDeps {
  getConfig(): Promise<unknown>;
  getAccountSnapshot(): Promise<BoostAccountSnapshot>;
  getUsageForToken(token: string): Promise<OpusUsageStatus>;
  now?: () => number;
}

export interface BoostRunPlan {
  /** 현재 로그인 계정 프로필 이름(없으면 수동 로그인 — 호출부가 기본 이름). */
  activeName?: string;
  participants: BoostParticipant[];
}

/** 큐가 쓰는 최소 인터페이스(테스트가 가짜로 바꿔 낀다). */
export interface BoostPlannerLike {
  /** 예약 시점용 설정 — 짧게 캐시한 config 에서 읽는다(일괄 예약이 작업마다 config IPC 를 반복하지 않게). */
  getSettings(): Promise<BoostSettings & { modelVersion?: unknown }>;
  /** 참여 계정(기본 계정 제외). maxAgeMs 안의 같은 범위 결과가 있으면 재사용. */
  getParticipants(scope: BoostAccountScope, maxAgeMs: number): Promise<BoostRunPlan>;
}

/** 예약 시점 배수에 재사용하는 참여 결과의 최대 나이 — 실행 시작 때는 항상 새로 조회한다. */
export const RESERVATION_PARTICIPANT_MAX_AGE_MS = 5 * 60_000;
/** 예약 시점 설정 캐시(일괄 예약 묶음 동안 config IPC 1회 수준). */
export const BOOST_SETTINGS_CACHE_MS = 2_000;

export class BoostPlanner implements BoostPlannerLike {
  private settingsCache?: { at: number; value: BoostSettings & { modelVersion?: unknown } };
  private settingsInFlight?: Promise<BoostSettings & { modelVersion?: unknown }>;
  private planCache?: { at: number; scope: BoostAccountScope; plan: BoostRunPlan };
  private planInFlight?: { scope: BoostAccountScope; promise: Promise<BoostRunPlan> };

  constructor(private deps: BoostPlannerDeps) {}

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  async getSettings(): Promise<BoostSettings & { modelVersion?: unknown }> {
    const c = this.settingsCache;
    if (c && this.now() - c.at < BOOST_SETTINGS_CACHE_MS) return c.value;
    if (this.settingsInFlight) return this.settingsInFlight;
    this.settingsInFlight = (async () => {
      const config = (await this.deps.getConfig()) as Record<string, unknown> | undefined;
      const value = { ...resolveBoostSettings(config), modelVersion: config?.modelVersion };
      this.settingsCache = { at: this.now(), value };
      return value;
    })().finally(() => {
      this.settingsInFlight = undefined;
    });
    return this.settingsInFlight;
  }

  async getParticipants(scope: BoostAccountScope, maxAgeMs: number): Promise<BoostRunPlan> {
    const c = this.planCache;
    if (c && c.scope === scope && maxAgeMs > 0 && this.now() - c.at < maxAgeMs) return c.plan;
    if (this.planInFlight && this.planInFlight.scope === scope) return this.planInFlight.promise;
    const promise = this.lookup(scope).finally(() => {
      if (this.planInFlight?.promise === promise) this.planInFlight = undefined;
    });
    this.planInFlight = { scope, promise };
    return promise;
  }

  /** 설정·토큰 목록이 바뀌었을 때 캐시를 버린다(다음 조회가 새로 읽는다). */
  invalidate(): void {
    this.settingsCache = undefined;
    this.planCache = undefined;
  }

  private async lookup(scope: BoostAccountScope): Promise<BoostRunPlan> {
    const snapshot = await this.deps.getAccountSnapshot();
    const participants: BoostParticipant[] = [];
    // 저장 순서대로 한 번씩(동시 조회 금지).
    for (const candidate of snapshot.candidates) {
      let usage: OpusUsageStatus | undefined;
      try {
        usage = await this.deps.getUsageForToken(candidate.token);
      } catch (e) {
        usage = undefined;
      }
      if (isBoostAccountEligible(scope, usage)) {
        participants.push({ ...candidate, ...(usage ? { usage } : {}) });
      }
    }
    const plan: BoostRunPlan = {
      ...(snapshot.active ? { activeName: snapshot.active.name } : {}),
      participants,
    };
    this.planCache = { at: this.now(), scope, plan };
    return plan;
  }
}
