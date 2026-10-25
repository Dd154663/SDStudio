import type { Backend } from '../backend';
import type { OpusUsageStatus } from '../backends/imageGen';
import {
  isLowOpusUsage,
  isOpusPaidRisk,
  isUsingPurchasedUsage,
  needsPaidRiskConfirm,
} from './opusUsageRules';

type OpusUsageBackend = Pick<Backend, 'getOpusUsageStatus'> &
  Partial<Pick<Backend, 'getConfig' | 'setConfig'>>;

export type OpusUsageState =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'stale'
  | 'error';

export class OpusUsageService extends EventTarget {
  state: OpusUsageState = 'idle';
  status: OpusUsageStatus | undefined;
  fetchedAt = 0;
  refreshing = false;

  private inFlight: Promise<OpusUsageStatus | undefined> | undefined;
  private revision = 0;
  private paidRiskApprovedForSession = false;
  private lowWarningShown = false;
  // 무료→추가 충전 전환 안내(세션당 최초 1회). 무료분이 1% 차올랐다가 다시 0 이 돼도 재무장하지 않고,
  // 로그아웃(clear)·계정 전환으로도 초기화하지 않는다 — 앱을 다시 실행해야 다시 안내한다(2026-10-25 사용자 결정).
  private purchasedNoticeShown = false;

  /** config `opusUsageQuiet` 의 화면 표시용 사본(환경설정 로그인 탭·할당량 상세 창 토글이 함께 본다).
   *  생성 경로는 실행 때마다 config 를 직접 읽는다. */
  quiet = false;
  quietLoaded = false;

  constructor(private readonly backend: OpusUsageBackend) {
    super();
  }

  /** 저장된 「할당량 경고 하지 않음」 값을 읽어 토글 표시에 반영한다. */
  async loadQuiet(): Promise<boolean> {
    if (!this.backend.getConfig) return this.quiet;
    const config = await this.backend.getConfig();
    this.quiet = config.opusUsageQuiet === true;
    this.quietLoaded = true;
    this.emitChange();
    return this.quiet;
  }

  /** 「할당량 경고 하지 않음」을 바꾸고 곧바로 config 에 저장한다(두 토글이 같은 값을 보게 change 이벤트).
   *  저장에 실패하면 이전 값으로 되돌리고 오류를 던진다. */
  async setQuiet(value: boolean): Promise<void> {
    const previous = this.quiet;
    this.quiet = value;
    this.quietLoaded = true;
    this.emitChange();
    if (!this.backend.getConfig || !this.backend.setConfig) return;
    try {
      const config = await this.backend.getConfig();
      await this.backend.setConfig({ ...config, opusUsageQuiet: value });
    } catch (e) {
      this.quiet = previous;
      this.emitChange();
      throw e;
    }
  }

  // force = 이 서비스의 30초 캐시를 건너뛴다. 그래도 backend 의 `/user/data` 10초 캐시·동시 호출
  // 합치기는 탄다(생성 직전 확인 등 — 연속 조회 방지, 2026-10-03 갈래 T2).
  // options.fresh = backend 캐시까지 건너뛰고 서버에서 새로 읽는다(생성 직후 잔량 갱신·
  // 할당량 오류 뒤·사용자가 누른 새로고침).
  async refresh(
    force = false,
    options?: { fresh?: boolean },
  ): Promise<OpusUsageStatus | undefined> {
    const fresh = Date.now() - this.fetchedAt < 30_000;
    if (!force && fresh && this.status) return this.status;
    if (this.inFlight) return this.inFlight;

    const revision = this.revision;
    this.refreshing = true;
    this.state = this.status ? 'stale' : 'loading';
    this.emitChange();
    this.inFlight = (
      options?.fresh
        ? this.backend.getOpusUsageStatus({ force: true })
        : this.backend.getOpusUsageStatus()
    )
      .then((status) => {
        if (revision !== this.revision) return undefined;
        this.status = status;
        this.fetchedAt = Date.now();
        this.state = 'ready';
        this.emitChange();
        return status;
      })
      .catch(() => {
        if (revision !== this.revision) return undefined;
        this.state = this.status ? 'stale' : 'error';
        this.emitChange();
        return undefined;
      })
      .finally(() => {
        if (revision !== this.revision) return;
        this.inFlight = undefined;
        this.refreshing = false;
        this.emitChange();
      });
    return this.inFlight;
  }

  clear(): void {
    this.invalidateAccount();
    this.lowWarningShown = false;
  }

  // A manual login/account switch must not display the previous account's
  // cached quota or let its late response overwrite the new account.
  invalidateAccount(): void {
    this.revision++;
    this.inFlight = undefined;
    this.refreshing = false;
    this.state = 'idle';
    this.status = undefined;
    this.fetchedAt = 0;
    this.emitChange();
  }

  adoptKnownStatus(status: OpusUsageStatus): void {
    // 자동 순회 후보 조회에서 이미 확인한 새 계정의 상태를 즉시 채택한다.
    // 같은 user/data를 전환 직후 다시 요청하지 않고 상단 배지와 유료 가드를 맞춘다.
    this.revision++;
    this.inFlight = undefined;
    this.refreshing = false;
    this.status = status;
    this.fetchedAt = Date.now();
    this.state = 'ready';
    this.emitChange();
  }

  // 과금 위험 = 미확인·미구독·isNegative(무료+추가 충전 모두 소진). 판정은 opusUsageRules 단일 출처.
  isPaidRisk(status: OpusUsageStatus | undefined): boolean {
    return isOpusPaidRisk(status);
  }

  // 생성 직전 Anlas 확인이 필요한가 — 과금 위험이고, 세션 승인 전이고, 「할당량 경고 하지 않음」이 꺼져 있을 때.
  needsPaidConfirm(status: OpusUsageStatus | undefined, quiet = false): boolean {
    return needsPaidRiskConfirm(status, {
      quiet,
      approvedForSession: this.paidRiskApprovedForSession,
    });
  }

  hasSessionPaidApproval(): boolean {
    return this.paidRiskApprovedForSession;
  }

  approvePaidRisk(): void {
    // 사용자 승인 이후에는 시간 경과·회복·계정 전환으로 재확인하지 않는다.
    // 메모리에만 보관하므로 앱 세션이 새로 시작되면 다시 승인이 필요하다.
    this.paidRiskApprovedForSession = true;
  }

  // 저잔량 경고(세션 1회, 로그아웃 시 재무장) — 무료+추가 충전 합산 기준. quiet 면 띄우지 않고 표식도 소모하지 않는다.
  takeLowWarning(
    status: OpusUsageStatus | undefined,
    warningPercent = 10,
    quiet = false,
  ): boolean {
    if (quiet || this.lowWarningShown) return false;
    if (!isLowOpusUsage(status, warningPercent)) return false;
    this.lowWarningShown = true;
    return true;
  }

  // 무료→추가 충전 전환 안내(세션당 최초 1회). quiet 면 띄우지 않는다.
  takePurchasedNotice(status: OpusUsageStatus | undefined, quiet = false): boolean {
    if (quiet || this.purchasedNoticeShown) return false;
    if (!isUsingPurchasedUsage(status)) return false;
    this.purchasedNoticeShown = true;
    return true;
  }

  private emitChange(): void {
    this.dispatchEvent(new Event('change'));
  }
}
