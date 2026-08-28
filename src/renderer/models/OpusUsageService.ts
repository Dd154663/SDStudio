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

  private inFlight: Promise<OpusUsageStatus | undefined> | undefined;
  private paidApprovalUntil = 0;
  private lowWarningShown = false;

  constructor(private readonly backend: Pick<Backend, 'getOpusUsageStatus'>) {
    super();
  }

  async refresh(force = false): Promise<OpusUsageStatus | undefined> {
    const fresh = Date.now() - this.fetchedAt < 30_000;
    if (!force && fresh && this.status) return this.status;
    if (this.inFlight) return this.inFlight;

    this.state = this.status ? 'stale' : 'loading';
    this.emitChange();
    this.inFlight = this.backend
      .getOpusUsageStatus()
      .then((status) => {
        this.status = status;
        this.fetchedAt = Date.now();
        this.state = 'ready';
        this.emitChange();
        return status;
      })
      .catch(() => {
        this.state = this.status ? 'stale' : 'error';
        this.emitChange();
        return undefined;
      })
      .finally(() => {
        this.inFlight = undefined;
      });
    return this.inFlight;
  }

  clear(): void {
    this.state = 'idle';
    this.status = undefined;
    this.fetchedAt = 0;
    this.paidApprovalUntil = 0;
    this.lowWarningShown = false;
    this.emitChange();
  }

  adoptKnownStatus(status: OpusUsageStatus): void {
    // 자동 순회 후보 조회에서 이미 확인한 새 계정의 상태를 즉시 채택한다.
    // 같은 user/data를 전환 직후 다시 요청하지 않고 상단 배지와 유료 가드를 맞춘다.
    this.status = status;
    this.fetchedAt = Date.now();
    this.state = 'ready';
    this.paidApprovalUntil = 0;
    this.emitChange();
  }

  isPaidRisk(status: OpusUsageStatus | undefined): boolean {
    return !status || status.isNegative || status.percent <= 0;
  }

  hasRecentPaidApproval(): boolean {
    return Date.now() < this.paidApprovalUntil;
  }

  approvePaidRisk(): void {
    // 긴 큐에서 매 장마다 확인창이 반복되지 않게 하되, 외부 기기 소비를 고려해
    // 60초 뒤에는 다시 서버 상태와 사용자 의사를 확인한다.
    this.paidApprovalUntil = Date.now() + 60_000;
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
