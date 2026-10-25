import type { OpusUsageStatus } from '../backends/imageGen';
import {
  freePercentOf,
  isOpusPaidRisk,
  isUsingPurchasedUsage,
  purchasedPercentOf,
} from './opusUsageRules';

// Official image UI, checked 2026-08-31: 91% ≈ 1,574 images
// (also 88% ≈ 1,522). Approximate standard-resolution, <=28-step V5
// allowance equivalent, NOT a per-request price or spending authorization.
export const OPUS_IMAGES_PER_PERCENT = 17.3;
export const OPUS_ESTIMATE_HELP =
  '일반 해상도·28스텝 이하 V5 무료 생성 기준 환산값입니다 (1% ≈ 17.3장). ' +
  '추가 충전(Usage Boost)분이 있으면 무료분과 합쳐 계산합니다. ' +
  '현재 설정이나 예약 큐의 보장 장수가 아닙니다. 무료 대상 밖의 설정이나 할당량 소진 후에는 Anlas가 사용될 수 있습니다.';

export type OpusUsageTone = 'gray' | 'red' | 'orange' | 'green' | 'yellow';

export interface OpusUsageView {
  /** 배지 글자 — 무료+추가 충전 합산(100% 초과 가능). 미구독 'X', 미확인 '—'. */
  text: string;
  /** 상세 글자 — 추가 충전분이 있으면 「X% + Y%」, 없으면 text 와 같음. */
  detailText: string;
  /** 이용 가능량(무료+추가 충전, %). 미구독·미확인 undefined. */
  percent: number | undefined;
  /** 무료 회복분(%) / 추가 충전분(%). 미구독·미확인 0. */
  free: number;
  purchased: number;
  /** 합산 막대 폭(%). 추가 충전분이 없으면 기준 100(초과분은 100 에서 자름 — 종전 그대로),
   *  있으면 공식 웹처럼 기준 = max(100, 합). */
  fill: number;
  /** 무료분(위에 겹치는 막대) 폭(%) — 같은 기준. */
  freeFill: number;
  images: number | undefined;
  tone: OpusUsageTone;
  /** 무료분 소진·추가 충전분 사용 중(Anlas 아님). */
  usingPurchased: boolean;
}

function roundWidth(value: number): number {
  return Math.round(Math.max(0, Math.min(100, value)) * 100) / 100;
}

export function presentOpusUsage(
  status?: OpusUsageStatus,
  warningPercent = 10,
): OpusUsageView {
  const empty = {
    percent: undefined,
    free: 0,
    purchased: 0,
    fill: 0,
    freeFill: 0,
    images: undefined,
    tone: 'gray' as OpusUsageTone,
    usingPurchased: false,
  };
  if (status?.opusSubscribed === false) {
    return { ...empty, text: 'X', detailText: 'X' };
  }
  if (!status || !Number.isFinite(status.percent)) {
    return { ...empty, text: '—', detailText: '—' };
  }
  const free = freePercentOf(status);
  const purchased = purchasedPercentOf(status);
  const total = free + purchased;
  const scale = purchased > 0 ? Math.max(100, total) : 100;
  const text = `${total}%`;
  return {
    text,
    detailText: purchased > 0 ? `${free}% + ${purchased}%` : text,
    percent: total,
    free,
    purchased,
    fill: roundWidth((total / scale) * 100),
    freeFill: roundWidth((free / scale) * 100),
    images: Math.floor(total * OPUS_IMAGES_PER_PERCENT),
    // 빨강 = 과금 위험(무료+추가 충전 모두 0), 주황 = 합산 저잔량, 노랑 = 무료분만 기본 한도(100) 초과.
    tone: (isOpusPaidRisk(status)
      ? 'red'
      : total <= warningPercent
        ? 'orange'
        : free > 100
          ? 'yellow'
          : 'green') as OpusUsageTone,
    usingPurchased: isUsingPurchasedUsage(status),
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
