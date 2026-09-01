import type { OpusUsageStatus } from '../backends/imageGen';

// Official image UI, checked 2026-08-31: 91% ≈ 1,574 images
// (also 88% ≈ 1,522). Approximate standard-resolution, <=28-step V5
// allowance equivalent, NOT a per-request price or spending authorization.
export const OPUS_IMAGES_PER_PERCENT = 17.3;
export const OPUS_ESTIMATE_HELP =
  '일반 해상도·28스텝 이하 V5 무료 생성 기준 환산값입니다 (1% ≈ 17.3장). ' +
  '현재 설정이나 예약 큐의 보장 장수가 아닙니다. 무료 대상 밖의 설정이나 할당량 소진 후에는 Anlas가 사용될 수 있습니다.';

export type OpusUsageTone = 'gray' | 'red' | 'orange' | 'green' | 'yellow';

export function presentOpusUsage(
  status?: OpusUsageStatus,
  warningPercent = 10,
) {
  if (!status || !Number.isFinite(status.percent)) {
    return {
      text: '—',
      percent: undefined,
      fill: 0,
      images: undefined,
      tone: 'gray' as OpusUsageTone,
    };
  }
  const percent = status.isNegative ? 0 : Math.max(0, status.percent);
  return {
    text: `${percent}%`,
    percent,
    fill: Math.min(100, percent),
    images: Math.floor(percent * OPUS_IMAGES_PER_PERCENT),
    tone: (percent <= 0
      ? 'red'
      : percent <= warningPercent
        ? 'orange'
        : percent > 100
          ? 'yellow'
          : 'green') as OpusUsageTone,
  };
}

export function opusCheckedLabel(checkedAt: number, now = Date.now()): string {
  if (!checkedAt) return '아직 확인하지 않음';
  const minutes = Math.max(0, Math.floor((now - checkedAt) / 60_000));
  if (minutes === 0) return '방금 확인';
  if (minutes < 60) return `${minutes}분 전 확인`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}시간 전 확인`;
  return `${Math.floor(minutes / 1440)}일 전 확인`;
}
