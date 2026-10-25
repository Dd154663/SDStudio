export const TOKEN_ROTATE_WARNING_MIN = 1;
export const TOKEN_ROTATE_WARNING_MAX = 24;
export const TOKEN_ROTATE_WARNING_DEFAULT = 10;

export const TOKEN_ROTATE_TARGET_MIN = 1;
export const TOKEN_ROTATE_TARGET_MAX = 50;
export const TOKEN_ROTATE_TARGET_DEFAULT = 25;

export const TOKEN_ROTATE_MIN_GAP = 5;

export const TOKEN_ROTATE_BALANCE_MIN = 60;
export const TOKEN_ROTATE_BALANCE_MAX = 100;
export const TOKEN_ROTATE_BALANCE_DEFAULT = 80;

function clampInteger(value: unknown, min: number, max: number, fallback: number) {
  const numeric = Math.round(Number(value));
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

export function normalizeTokenRotateWarning(value: unknown): number {
  return clampInteger(
    value,
    TOKEN_ROTATE_WARNING_MIN,
    TOKEN_ROTATE_WARNING_MAX,
    TOKEN_ROTATE_WARNING_DEFAULT,
  );
}

export function minimumTokenRotateTarget(warning: unknown): number {
  return Math.max(
    TOKEN_ROTATE_TARGET_MIN,
    normalizeTokenRotateWarning(warning) + TOKEN_ROTATE_MIN_GAP,
  );
}

export function normalizeTokenRotateTarget(
  value: unknown,
  warning: unknown,
): number {
  return clampInteger(
    value,
    minimumTokenRotateTarget(warning),
    TOKEN_ROTATE_TARGET_MAX,
    Math.max(
      TOKEN_ROTATE_TARGET_DEFAULT,
      minimumTokenRotateTarget(warning),
    ),
  );
}

export function normalizeTokenRotateBalance(value: unknown): number {
  return clampInteger(
    value,
    TOKEN_ROTATE_BALANCE_MIN,
    TOKEN_ROTATE_BALANCE_MAX,
    TOKEN_ROTATE_BALANCE_DEFAULT,
  );
}

// currentPercent = 현재 계정의 **무료분**(opusUsageRules.freePercentOf). 여유 순회는 추가 충전분을 보지 않는다
// (2026-10-25 사용자 결정 — 회복되지 않는 추가 충전분 계정으로 자동 이동하지 않음).
export function minimumBalancedTokenPercent(
  currentPercent: unknown,
  balancePercent: unknown,
): number {
  const current = clampInteger(currentPercent, 0, 100, 0);
  return Math.max(
    normalizeTokenRotateBalance(balancePercent),
    current + TOKEN_ROTATE_MIN_GAP,
  );
}
