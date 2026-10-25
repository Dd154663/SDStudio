import type { OpusUsageStatus } from '../backends/imageGen';

/**
 * Opus V5 할당량 판정 단일 출처(2026-10-25, 추가 충전 Usage Boost 대응).
 *
 * NovelAI `/user/data` 의 `subscription.usage` 는 두 갈래다.
 *  - `percent` — 무료 회복형(0~100+, 시간이 지나면 다시 찬다)
 *  - `purchasedPercent` — 추가 충전(Usage Boost) 사용분(0~400, 회복되지 않는다)
 * 서버는 무료분을 먼저 쓰고 그다음 추가 충전분을 쓰며, 둘 다 바닥나면 `isNegative=true` 가 된다
 * (공식 웹 번들 분석에 따른 추정 — 플랜 guides/plans/2026-10-25-opus-extra-usage.md §1).
 * 공식 웹의 Anlas(유료) 판정은 `isNegative` 하나만 본다.
 *
 * 과금 보호·저잔량 경고·전환 안내·다중 토큰 순회 후보 판정은 모두 이 파일의 함수를 쓴다
 * (예전에는 `usage.percent` 판정이 OpusUsageService·TaskHandlers·LoginService 에 흩어져 있었다).
 * 순수 함수만 둔다(jest opusUsageRules.test.ts).
 */

/** 공식 스키마의 추가 충전 누적 상한(`MaxPurchasedPercent`). 표시·검증 참고용 — 서버 값은 자르지 않는다. */
export const OPUS_PURCHASED_PERCENT_MAX = 400;

/**
 * 서버 응답의 `purchasedPercent` 를 읽는다. 없거나(구버전 응답) 숫자가 아니면 0 — 오류로 보지 않는다
 * (공식 웹 `usagePurchasedPercent` 와 같은 처리). 음수는 0, 소수는 반올림.
 */
export function parsePurchasedPercent(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0;
  return Math.max(0, Math.round(raw));
}

function subscribed(status: OpusUsageStatus | undefined): status is OpusUsageStatus {
  return !!status && status.opusSubscribed !== false;
}

/** 추가 충전분(%). 미구독·미확인·`isNegative` 이면 0. */
export function purchasedPercentOf(status: OpusUsageStatus | undefined): number {
  if (!subscribed(status) || status.isNegative) return 0;
  return parsePurchasedPercent(status.purchasedPercent);
}

/** 무료 회복분(%). 미구독·미확인·`isNegative` 이면 0. 100 초과(서버가 준 여유분)는 그대로 둔다. */
export function freePercentOf(status: OpusUsageStatus | undefined): number {
  if (!subscribed(status) || status.isNegative) return 0;
  const percent = Number(status.percent);
  return Number.isFinite(percent) ? Math.max(0, percent) : 0;
}

/** 이용 가능량 = 무료분 + 추가 충전분(%). 100 을 넘을 수 있다. */
export function availablePercentOf(status: OpusUsageStatus | undefined): number {
  return freePercentOf(status) + purchasedPercentOf(status);
}

/**
 * 과금(Anlas) 위험 — 공식 웹과 같이 `isNegative` 가 기준이다. 무료분이 0 이어도 추가 충전분이 남아 있으면
 * 위험이 아니다(예전 `percent<=0` 단독 판정 제거). 다만 미확인·미구독, 그리고 서버가 `isNegative=false`
 * 이면서 무료+추가 충전이 모두 0 인 경계 상태는 보수적으로 위험으로 본다(사용자 결정 「isNegative(무료+유료 모두 0)」).
 */
export function isOpusPaidRisk(status: OpusUsageStatus | undefined): boolean {
  if (!subscribed(status)) return true;
  if (status.isNegative) return true;
  return availablePercentOf(status) <= 0;
}

/** 「추가 충전분 사용 중」 — 무료분이 바닥났고 추가 충전분으로 생성되는 상태(Anlas 아님). */
export function isUsingPurchasedUsage(status: OpusUsageStatus | undefined): boolean {
  if (!subscribed(status) || status.isNegative) return false;
  return freePercentOf(status) <= 0 && purchasedPercentOf(status) > 0;
}

/** 저잔량 경고 임계값 정규화(1~100). */
export function normalizeLowWarningPercent(warningPercent: unknown = 10): number {
  const n = Math.round(Number(warningPercent));
  if (!Number.isFinite(n)) return 10;
  return Math.max(1, Math.min(100, n));
}

/** 저잔량 — 이용 가능량(무료+추가 충전) 기준 0 초과 ~ 임계값 이하. 소진(0)은 과금 위험 쪽이 다룬다. */
export function isLowOpusUsage(
  status: OpusUsageStatus | undefined,
  warningPercent: unknown = 10,
): boolean {
  if (!subscribed(status) || status.isNegative) return false;
  const available = availablePercentOf(status);
  return available > 0 && available <= normalizeLowWarningPercent(warningPercent);
}

/** config `opusUsageQuiet`(「할당량 경고 하지 않음」) 해석 — true 만 켬, 누락·그 밖 값은 끔. */
export function isOpusUsageQuiet(config: { opusUsageQuiet?: unknown } | undefined): boolean {
  return config?.opusUsageQuiet === true;
}

/**
 * 생성 직전 Anlas 확인 창이 필요한가. 「할당량 경고 하지 않음」이 켜져 있으면 저잔량 경고·전환 안내와 함께
 * 이 확인도 생략한다(조용히 Anlas 사용). 이미 이 앱 세션에서 승인했으면 다시 묻지 않는다(SPEC §14).
 */
export function needsPaidRiskConfirm(
  status: OpusUsageStatus | undefined,
  options: { quiet: boolean; approvedForSession: boolean },
): boolean {
  if (options.quiet || options.approvedForSession) return false;
  return isOpusPaidRisk(status);
}

/* ── 다중 토큰 자동 순회(사용자 결정 2026-10-25 §7) ──
 * - 임계값(경고 %·사용 토큰 여유 %·균형 기준 %)의 의미는 종전대로 **무료분** 기준이다.
 *   추가 충전분은 회복되지 않으므로, 다른 계정의 회복형 무료분을 먼저 쓰는 것이 이득이다.
 * - 임계(urgent) 순회: 현재 계정의 무료분이 경고값 이하(또는 미구독·isNegative)일 때.
 *   후보는 ① 무료분이 여유값 이상인 계정을 먼저, 없으면 ② 추가 충전분이 있어 이용 가능량이 여유값 이상인 계정.
 *   ②는 현재 계정 자신의 이용 가능량도 경고값 이하일 때만 쓴다 — 현재 계정에 추가 충전분이 넉넉히 남아 있으면
 *   다른 계정의 추가 충전분으로 옮겨도 얻는 것이 없어 머문다.
 * - 여유(balance) 순회: 무료분만 비교한다(추가 충전분 있는 계정으로 자동 이동하지 않는다).
 */

/** 임계 순회가 필요한가 — 무료분 기준. */
export function needsUrgentRotation(
  status: OpusUsageStatus | undefined,
  warningPercent: number,
): boolean {
  if (!subscribed(status) || status.isNegative) return true;
  return freePercentOf(status) <= warningPercent;
}

/** 여유 순회를 검사해도 되는가(미구독·isNegative 제외). */
export function canBalanceRotate(status: OpusUsageStatus | undefined): boolean {
  return subscribed(status) && !status.isNegative;
}

/** 임계 순회에서 추가 충전분 계정(②)으로 옮겨도 되는가 — 현재 계정 이용 가능량이 경고값 이하일 때만. */
export function allowPurchasedRotationFallback(
  status: OpusUsageStatus | undefined,
  warningPercent: number,
): boolean {
  if (!subscribed(status) || status.isNegative) return true;
  return availablePercentOf(status) <= warningPercent;
}

export type RotationCandidateTier = 'free' | 'purchased';

/**
 * 후보 계정 등급. 'free' = 무료분이 기준 이상(우선), 'purchased' = 무료분은 모자라지만 추가 충전분이 있어
 * 이용 가능량이 기준 이상(임계 순회의 차선, allowPurchased 일 때만). 둘 다 아니면 undefined(후보 아님).
 */
export function rotationCandidateTier(
  status: OpusUsageStatus | undefined,
  minimumPercent: number,
  allowPurchased: boolean,
): RotationCandidateTier | undefined {
  if (!subscribed(status) || status.isNegative) return undefined;
  if (freePercentOf(status) >= minimumPercent) return 'free';
  if (
    allowPurchased &&
    purchasedPercentOf(status) > 0 &&
    availablePercentOf(status) >= minimumPercent
  ) {
    return 'purchased';
  }
  return undefined;
}

/* ── 문구 ── */

/** 상세 표시용 「X% + Y%」(추가 충전분이 없으면 「X%」). */
export function formatOpusUsageSplit(status: OpusUsageStatus | undefined): string {
  const free = freePercentOf(status);
  const purchased = purchasedPercentOf(status);
  return purchased > 0 ? `${free}% + ${purchased}%` : `${free}%`;
}

/** 토스트·확인 창용 설명(「무료 X% + 추가 충전 Y%」). */
export function describeOpusUsage(status: OpusUsageStatus | undefined): string {
  const free = freePercentOf(status);
  const purchased = purchasedPercentOf(status);
  return purchased > 0
    ? `무료 ${free}% + 추가 충전 ${purchased}%`
    : `${free}%`;
}

export const OPUS_USAGE_TEXT = {
  lowWarning: (status: OpusUsageStatus | undefined) =>
    `Opus V5 할당량이 ${availablePercentOf(status)}% 남았습니다` +
    (purchasedPercentOf(status) > 0 ? '(추가 충전 포함)' : '') +
    '. 모두 소진되면 Anlas가 소비될 수 있습니다.',
  purchasedNotice: (status: OpusUsageStatus | undefined) =>
    `무료 할당량을 모두 썼습니다. 지금부터 추가 충전분(${purchasedPercentOf(status)}%)으로 생성합니다. ` +
    'Anlas는 소비되지 않으며, 이 안내는 앱을 다시 실행할 때까지 다시 표시하지 않습니다.',
  quietLabel: '할당량 경고 하지 않음',
  quietDescription:
    '켜면 저잔량 경고·추가 충전 전환 안내·모두 소진 시 Anlas 확인 창을 띄우지 않고, 할당량이 바닥나면 Anlas가 조용히 차감됩니다.',
  rotationRule:
    '자동 순회 기준값은 무료 할당량 기준입니다. 여유 할당량 균형 순회는 무료분만 비교하며, ' +
    '추가 충전분이 있는 계정으로는 자동 이동하지 않습니다. 경고 임계값 이하일 때는 무료분이 있는 계정으로 먼저 옮기고, ' +
    '그런 계정이 없고 현재 계정도 추가 충전분까지 부족하면 추가 충전분이 있는 계정으로 옮깁니다.',
} as const;
