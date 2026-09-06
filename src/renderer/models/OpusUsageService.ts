import type { Backend } from '../backend';
import type { OpusUsageStatus } from '../backends/imageGen';

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

  constructor(private readonly backend: Pick<Backend, 'getOpusUsageStatus'>) {
    super();
  }

  async refresh(force = false): Promise<OpusUsageStatus | undefined> {
    const fresh = Date.now() - this.fetchedAt < 30_000;
    if (!force && fresh && this.status) return this.status;
    if (this.inFlight) return this.inFlight;

    const revision = this.revision;
    this.refreshing = true;
    this.state = this.status ? 'stale' : 'loading';
    this.emitChange();
    this.inFlight = this.backend
      .getOpusUsageStatus()
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

  isPaidRisk(status: OpusUsageStatus | undefined): boolean {
    return !status || status.isNegative || status.percent <= 0;
  }

  hasSessionPaidApproval(): boolean {
    return this.paidRiskApprovedForSession;
  }

  approvePaidRisk(): void {
    // 사용자 승인 이후에는 시간 경과·회복·계정 전환으로 재확인하지 않는다.
    // 메모리에만 보관하므로 앱 세션이 새로 시작되면 다시 승인이 필요하다.
    this.paidRiskApprovedForSession = true;
  }

  takeLowWarning(
    status: OpusUsageStatus | undefined,
    warningPercent = 10,
  ): boolean {
    warningPercent = Math.max(1, Math.min(100, Math.round(warningPercent)));
    if (
      !status ||
      status.isNegative ||
      status.percent <= 0 ||
      status.percent > warningPercent
    ) {
      return false;
    }
    if (this.lowWarningShown) return false;
    this.lowWarningShown = true;
    return true;
  }

  private emitChange(): void {
    this.dispatchEvent(new Event('change'));
  }
}
