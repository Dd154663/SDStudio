// 부스트 모드(다계정 동시 생성) 순수 판정 — 2026-11-01 B2. 서비스·backend 를 import 하지 않는다(jest boostB2Mode.test.ts).
//
// 사용자 결정(플랜 guides/plans/2026-10-25-boost-mode.md §5) 중 엔진·판정 부분의 단일 출처다.
//  · D1 참여 계정 범위 3택1(`boostAccountScope`): 'free' 무료 할당만 / 'purchased' 추가 충전 할당까지 / 'anlas' Anlas 까지.
//  · D2 대상 = 일반 큐 생성 전부(V4.5 포함, 무료 대상 여부 무관 — Anlas 는 D1 로 통제). 인페인트·I2I·미러 등 변형
//    작업은 `boostVariantTasks` 가 켜졌을 때만. 빠른 생성·증강·업스케일·배경 제거는 기본 계정만.
//  · D3 A(replicate) 배수 = 예약 시점 참여 가능 계정 수. 예약 뒤 부스트를 꺼도 배수된 예약은 그대로.
//  · D4 A: 끝내 실패한 장은 그 계정 몫으로 취소(재분배 없음), 탈락한 계정의 남은 몫도 취소, 1계정만 남으면 부스트
//    중지(남은 계정은 자기 몫만). B(split): 남은 계정이 몫을 이어받음(워커 풀 B1 그대로).
//  · D8 내부 표식 = 씬의 선택 필드 `imageAccounts`(파일명 → 프로필 이름). 이미지 메타·내보내기에는 넣지 않는다.
//  · D12 자동 순회와 상호 배타 — 부스트가 켜져 있으면 순회를 실행 경로에서 건너뛴다.
//
// 토큰은 이 모듈에 오지 않는다(이름·할당량 상태만 본다).

import type { OpusUsageStatus } from '../backends/imageGen';
import {
  availablePercentOf,
  freePercentOf,
  isOpusPaidRisk,
} from './opusUsageRules';
import { unclaimedImageCount, type ImageClaimState } from './queueWorkerPool';

export type BoostMode = 'off' | 'replicate' | 'split';
export type BoostAccountScope = 'free' | 'purchased' | 'anlas';

export const BOOST_MODES: readonly BoostMode[] = ['off', 'replicate', 'split'];
export const BOOST_ACCOUNT_SCOPES: readonly BoostAccountScope[] = ['free', 'purchased', 'anlas'];
export const DEFAULT_BOOST_ACCOUNT_SCOPE: BoostAccountScope = 'free';

export interface BoostSettings {
  mode: BoostMode;
  scope: BoostAccountScope;
  /** 인페인트·I2I·미러 등 변형 작업까지 부스트(D2 별도 토글). */
  variantTasks: boolean;
}

/** 없음·알 수 없는 값 = 'off'(구버전·손상 값은 부스트 꺼짐). */
export function normalizeBoostMode(raw: unknown): BoostMode {
  return raw === 'replicate' || raw === 'split' ? raw : 'off';
}

/** 없음·알 수 없는 값 = 'free'(가장 보수적인 범위). */
export function normalizeBoostAccountScope(raw: unknown): BoostAccountScope {
  return raw === 'purchased' || raw === 'anlas' ? raw : DEFAULT_BOOST_ACCOUNT_SCOPE;
}

/** config 에서 부스트 설정을 읽는다(모든 키 optional — 구버전 config 는 꺼짐). */
export function resolveBoostSettings(config: unknown): BoostSettings {
  const c = (config ?? {}) as Record<string, unknown>;
  return {
    mode: normalizeBoostMode(c.boostMode),
    scope: normalizeBoostAccountScope(c.boostAccountScope),
    variantTasks: c.boostVariantTasks === true,
  };
}

export function isBoostEnabled(settings: BoostSettings): boolean {
  return settings.mode !== 'off';
}

/** D12 — 부스트가 켜져 있으면 다중 토큰 자동 순회(TOKEN.txt 교체)를 실행 경로에서 건너뛴다. */
export function shouldSkipAutoRotation(config: unknown): boolean {
  return isBoostEnabled(resolveBoostSettings(config));
}

// ─── 대상 작업(D2)·비용 갈래 ───

export type BoostJobKind = 'gen' | 'i2i' | 'inpaint';

/** 생성 핸들러가 예약 값으로 계산해 넘기는 작업 사실(토큰 없음). */
export interface BoostJobFacts {
  kind: BoostJobKind;
  /** 빠른 생성(nodelay) — 언제나 기본 계정. */
  fast: boolean;
  /** V5 계열인가(예약 스냅샷 모델, 없으면 실행 시 config). */
  isV5: boolean;
  /** 실제 요청 해상도(Focused 인페인트는 영역 요청 크기). 모르면 Infinity. */
  width: number;
  height: number;
  steps: number;
  /** 요청에 실릴 캐릭터 레퍼런스가 있는가(V4·V5 는 요청에서 빠지므로 false). */
  hasCharacterReference: boolean;
}

/** 무료·포함 판정 픽셀 상한(1MP) — naiModelCapabilities.NAI_FREE_PIXEL_LIMIT 과 같은 값(순수 모듈이라 다시 적지 않고 받는다). */
export interface BoostCostLimits {
  freePixelLimit: number;
  freeMaxSteps: number;
}

export const BOOST_COST_LIMITS: BoostCostLimits = { freePixelLimit: 1_048_576, freeMaxSteps: 28 };

/**
 * 요청 한 장의 비용 갈래.
 *  - 'quota' = V5 Opus 무료 대상(할당량 소비 — 무료분 → 추가 충전분 → Anlas, naiModelCapabilities.isOpusFreeEligible 과 같은 조건)
 *  - 'opus'  = V4.x 일반 크기(1MP·28스텝 이하, 캐릭터 레퍼런스 없음) — Opus 구독이면 Anlas 없이 생성(추정, 앱은 V4.5 에 할당량 개념 없음)
 *  - 'anlas' = 그 밖(큰 해상도·스텝 초과·캐릭터 레퍼런스) — 계정마다 Anlas 소비
 */
export type BoostCostClass = 'quota' | 'opus' | 'anlas';

export function boostCostClass(
  facts: Pick<BoostJobFacts, 'isV5' | 'width' | 'height' | 'steps' | 'hasCharacterReference'>,
  limits: BoostCostLimits = BOOST_COST_LIMITS,
): BoostCostClass {
  const pixels = facts.width * facts.height;
  const small =
    Number.isFinite(pixels) &&
    pixels <= limits.freePixelLimit &&
    facts.steps <= limits.freeMaxSteps &&
    !facts.hasCharacterReference;
  if (!small) return 'anlas';
  return facts.isV5 ? 'quota' : 'opus';
}

export interface BoostTargetPolicy {
  scope: BoostAccountScope;
  variantTasks: boolean;
}

/** 큐가 다른 계정 워커·핸들러에 넘기는 정책 — fallbackModelVersion = 예약 스냅샷이 없을 때 쓸 실행 시 config 모델. */
export interface BoostWorkerPolicy extends BoostTargetPolicy {
  fallbackModelVersion?: unknown;
}

/**
 * 다른 계정 워커(부스트)가 이 작업을 맡아도 되는가 — A 배수 대상 판정과 같은 함수.
 * Anlas 를 쓰는 작업은 범위 'anlas' 일 때만(그 밖에는 기본 계정이 종전 Anlas 확인 창 경로로 처리).
 */
export function isBoostTargetJob(
  facts: BoostJobFacts | undefined,
  policy: BoostTargetPolicy,
): boolean {
  if (!facts || facts.fast) return false;
  if (facts.kind !== 'gen' && !policy.variantTasks) return false;
  if (policy.scope === 'anlas') return true;
  return boostCostClass(facts) !== 'anlas';
}

// ─── 참여 판정(D1) ───

/**
 * 실행 시작 때의 참여 자격(계정 단위). usage = 그 계정 토큰으로 `/user/data` 를 1회 조회한 결과(실패 = undefined).
 *  - 'free'      = Opus 구독 + 무료분 > 0
 *  - 'purchased' = 무료분 또는 추가 충전분 > 0(과금 위험 아님)
 *  - 'anlas'     = 조회에 성공한(로그인 유효한) 계정 전부(미구독 포함 — 설정 자체가 Anlas 소비 동의)
 */
export function isBoostAccountEligible(
  scope: BoostAccountScope,
  usage: OpusUsageStatus | undefined,
): boolean {
  if (!usage) return false;
  if (scope === 'anlas') return true;
  if (scope === 'purchased') return !isOpusPaidRisk(usage);
  return usage.opusSubscribed !== false && !usage.isNegative && freePercentOf(usage) > 0;
}

/** 생성 직전 재확인이 필요한가 — 할당량을 쓰는 V5 요청이고 범위가 Anlas 가 아닐 때만(그 밖은 조회하지 않는다). */
export function needsBoostQuotaCheck(scope: BoostAccountScope, cost: BoostCostClass): boolean {
  return scope !== 'anlas' && cost === 'quota';
}

/**
 * 생성 직전 재확인 — 이 계정이 이 요청을 계속 보내도 되는가(false = 그 워커 탈락).
 * 'opus' 요청은 구독만 본다(참여 때 이미 확인 — 조회 결과가 있으면 다시 본다). 'anlas' 요청은 범위 'anlas' 만.
 */
export function canBoostAccountGenerate(
  scope: BoostAccountScope,
  usage: OpusUsageStatus | undefined,
  cost: BoostCostClass,
): boolean {
  if (scope === 'anlas') return true;
  if (cost === 'anlas') return false;
  if (cost === 'opus') return !usage || usage.opusSubscribed !== false;
  if (!usage) return false;
  if (scope === 'purchased') return !isOpusPaidRisk(usage);
  return usage.opusSubscribed !== false && !usage.isNegative && freePercentOf(usage) > 0;
}

/** 할당량 요약(로그·안내용) — 「무료 X% + 추가 충전 Y%」 대신 짧게 합산만. */
export function boostUsageSummary(usage: OpusUsageStatus | undefined): string {
  if (!usage) return '할당량 확인 실패';
  if (usage.opusSubscribed === false) return 'Opus 미구독';
  return `이용 가능 ${Math.round(availablePercentOf(usage))}%`;
}

// ─── A(replicate) 배수(D3) ───

/** 예약 1건의 배수 — A 이고 대상 작업이며 참여 계정(기본 포함)이 2개 이상일 때만 그 수, 아니면 1. */
export function replicateFactor(
  settings: Pick<BoostSettings, 'mode'>,
  participantCount: number,
  isTarget: boolean,
): number {
  if (settings.mode !== 'replicate' || !isTarget) return 1;
  const n = Math.floor(participantCount);
  return Number.isFinite(n) && n >= 2 ? n : 1;
}

// ─── A 몫(share) 계정(D4) ───
//
// A 로 배수된 예약(boostShares = M ≥ 2, 몫 크기 N = total ÷ M)은 다중 워커 실행에서 「몫」 단위로 나눠 맡는다.
//  · 워커는 자기가 맡은 몫에서만 장을 꺼낸다. 맡은 몫이 없거나(처음) 다 썼으면 아직 아무도 맡지 않은 몫을 하나 더 맡는다
//    (예약 때보다 참여 계정이 적으면 한 계정이 몫 여러 개를 이어 맡아 예약 장 수를 채운다 — D3 「그대로」).
//  · 몫 소유자는 실행(풀)마다 새로 정한다(호출부가 owners 배열을 풀에 둔다). 사용량·취소는 작업(Task)에 남는다.
//  · 취소된 몫 = 남은 장을 건너뜀(skipped)으로 돌리고 다시 맡지 않는다(재분배 없음).
//  · 단일 워커 실행은 몫을 보지 않는다(예약 장 수 그대로 끝까지 — 종전 단일 경로).

export interface BoostShareState extends ImageClaimState {
  /** A 배수(M). 2 이상일 때만 몫 계정을 쓴다. */
  boostShares?: number;
  /** 몫마다 쓴 장 수(성공·건너뜀·진행 중). */
  boostShareUsed?: number[];
  /** 몫마다 취소 여부. */
  boostShareCancelled?: boolean[];
}

export function isShareTask(t: BoostShareState): boolean {
  const m = t.boostShares;
  return typeof m === 'number' && Number.isFinite(m) && m >= 2;
}

export function shareSize(t: BoostShareState): number {
  if (!isShareTask(t)) return 0;
  return Math.max(0, Math.floor(t.total / t.boostShares!));
}

function shareArrays(t: BoostShareState): { used: number[]; cancelled: boolean[] } {
  const m = Math.floor(t.boostShares ?? 0);
  if (!t.boostShareUsed || t.boostShareUsed.length !== m) t.boostShareUsed = new Array(m).fill(0);
  if (!t.boostShareCancelled || t.boostShareCancelled.length !== m)
    t.boostShareCancelled = new Array(m).fill(false);
  return { used: t.boostShareUsed, cancelled: t.boostShareCancelled };
}

/** 몫 s 에서 아직 꺼낼 수 있는 장 수(취소된 몫 = 0). */
export function shareCapacity(t: BoostShareState, s: number): number {
  if (!isShareTask(t)) return 0;
  const { used, cancelled } = shareArrays(t);
  if (cancelled[s]) return 0;
  return Math.max(0, shareSize(t) - (used[s] ?? 0));
}

/** 이 워커의 다음 장을 꺼낼 몫 번호(-1 = 이 작업에서 꺼낼 수 없음). 새로 맡으면 owners 에 기록한다. */
export function pickShare(
  t: BoostShareState,
  owners: (string | undefined)[],
  workerId: string,
): number {
  if (!isShareTask(t)) return -1;
  const m = Math.floor(t.boostShares!);
  for (let s = 0; s < m; s++) {
    if (owners[s] === workerId && shareCapacity(t, s) > 0) return s;
  }
  for (let s = 0; s < m; s++) {
    if (owners[s] === undefined && shareCapacity(t, s) > 0) {
      owners[s] = workerId;
      return s;
    }
  }
  return -1;
}

export function useShare(t: BoostShareState, s: number): void {
  if (!isShareTask(t)) return;
  const { used } = shareArrays(t);
  used[s] = (used[s] ?? 0) + 1;
}

/**
 * 끝내지 못한 장을 몫에 돌려준다. 그 몫이 이미 취소됐으면 돌려주지 않고 그 장도 건너뜀으로 돌린다
 * (반환 'skipped' — 호출부가 통계 total 을 1 줄이고 장 번호는 소비 처리).
 */
export function unuseShare(t: BoostShareState, s: number): 'returned' | 'skipped' {
  if (!isShareTask(t)) return 'returned';
  const { used, cancelled } = shareArrays(t);
  if (cancelled[s]) {
    t.skipped = (t.skipped ?? 0) + 1;
    return 'skipped';
  }
  used[s] = Math.max(0, (used[s] ?? 0) - 1);
  return 'returned';
}

/** 몫 하나를 취소한다 — 남은 장(아직 아무도 꺼내지 않은 장 범위 안)을 건너뜀으로 돌린다. 반환 = 건너뛴 장 수. */
export function cancelShare(t: BoostShareState, s: number): number {
  if (!isShareTask(t)) return 0;
  const { used, cancelled } = shareArrays(t);
  if (cancelled[s]) return 0;
  const n = Math.min(shareCapacity(t, s), unclaimedImageCount(t));
  cancelled[s] = true;
  used[s] = shareSize(t);
  if (n > 0) t.skipped = (t.skipped ?? 0) + n;
  return n;
}

/** 탈락한 워커가 맡은 몫을 모두 취소한다(D4 A — 재분배 없음). 반환 = 건너뛴 장 수. */
export function cancelWorkerShares(
  t: BoostShareState,
  owners: (string | undefined)[],
  workerId: string,
): number {
  if (!isShareTask(t)) return 0;
  let n = 0;
  for (let s = 0; s < owners.length; s++) {
    if (owners[s] === workerId) n += cancelShare(t, s);
  }
  return n;
}

/**
 * 1계정만 남았을 때(D4 A 「부스트 중지」): 남은 워커의 몫만 남기고 나머지 몫(다른 계정 몫·아직 아무도 맡지 않은 몫)을
 * 취소한다. 남은 워커가 이 작업에서 맡은 몫이 없으면 먼저 하나를 맡는다(자기 몫 = N 장). 반환 = 건너뛴 장 수.
 */
export function settleSharesForSurvivor(
  t: BoostShareState,
  owners: (string | undefined)[],
  survivorId: string,
): number {
  if (!isShareTask(t)) return 0;
  const m = Math.floor(t.boostShares!);
  if (!owners.includes(survivorId)) {
    for (let s = 0; s < m; s++) {
      if (owners[s] === undefined && shareCapacity(t, s) > 0) {
        owners[s] = survivorId;
        break;
      }
    }
  }
  let n = 0;
  for (let s = 0; s < m; s++) {
    if (owners[s] !== survivorId) n += cancelShare(t, s);
  }
  return n;
}

// ─── 내부 표식(D8) ───

/** 씬 하나에 남기는 표식 수 상한 — 넘으면 오래된 것부터 버린다(지운 이미지의 표식이 끝없이 쌓이지 않게). */
export const IMAGE_ACCOUNT_MAX = 3000;
const IMAGE_ACCOUNT_NAME_MAX = 60;

/** 파일명 → 계정 이름 맵을 정리한다(손상 값·빈 값 버림). 비면 undefined(직렬화에서 키 생략). */
export function normalizeImageAccounts(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, string> = {};
  let count = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!k || typeof v !== 'string' || !v.trim()) continue;
    out[k] = v.trim().slice(0, IMAGE_ACCOUNT_NAME_MAX);
    count++;
  }
  if (count === 0) return undefined;
  return count > IMAGE_ACCOUNT_MAX ? trimOldest(out, IMAGE_ACCOUNT_MAX) : out;
}

function trimOldest(map: Record<string, string>, max: number): Record<string, string> {
  const keys = Object.keys(map);
  const out: Record<string, string> = {};
  for (const k of keys.slice(keys.length - max)) out[k] = map[k];
  return out;
}

/** 표식 하나를 더한 새 맵(원본 불변 — MobX 관찰 필드에 통째로 대입). */
export function recordImageAccount(
  prev: Record<string, string> | undefined,
  filename: string,
  name: string,
  max: number = IMAGE_ACCOUNT_MAX,
): Record<string, string> | undefined {
  const label = name.trim().slice(0, IMAGE_ACCOUNT_NAME_MAX);
  if (!filename || !label) return prev;
  const next: Record<string, string> = { ...(prev ?? {}) };
  delete next[filename];
  next[filename] = label;
  return Object.keys(next).length > max ? trimOldest(next, max) : next;
}

/** 경로의 파일명(표식 키). */
export function imageAccountKey(path: string): string {
  return path.split('/').pop() ?? path;
}

// ─── 설정 화면(B3, 2026-11-01) ───

/** 부스트를 켤 수 있는 최소 저장 토큰 프로필 수(기본 계정 + 다른 계정 1개 이상). */
export const BOOST_MIN_TOKEN_PROFILES = 2;

/** 설정 화면에서 「켜기」 상태일 때의 방식(A/B). 끄기는 config `boostMode: 'off'`. */
export type BoostActiveMode = Exclude<BoostMode, 'off'>;
/**
 * 방식을 아직 고른 적이 없을 때의 기본값 — B(나눠 생성). A 는 예약 장 수를 계정 수만큼 늘리므로 사용자가 직접 고르게 한다
 * (2026-11-01 B3 가정 — 플랜 §10).
 */
export const DEFAULT_BOOST_ACTIVE_MODE: BoostActiveMode = 'split';

/** 저장된 모드에서 설정 화면의 방식 선택 처음 값(꺼짐이면 기본 방식). */
export function boostActiveModeOf(mode: BoostMode): BoostActiveMode {
  return mode === 'off' ? DEFAULT_BOOST_ACTIVE_MODE : mode;
}

/** 설정 → config 키 3개(저장 왕복 — 읽기는 resolveBoostSettings). `boostWarningDismissed` 는 경고 창이 따로 쓴다. */
export function boostSettingsToConfig(settings: BoostSettings): {
  boostMode: BoostMode;
  boostAccountScope: BoostAccountScope;
  boostVariantTasks: boolean;
} {
  return {
    boostMode: normalizeBoostMode(settings.mode),
    boostAccountScope: normalizeBoostAccountScope(settings.scope),
    boostVariantTasks: settings.variantTasks === true,
  };
}

/** 두 설정이 같은가(미저장 표시 — 정규화한 값으로 비교). */
export function sameBoostSettings(a: BoostSettings, b: BoostSettings): boolean {
  const x = boostSettingsToConfig(a);
  const y = boostSettingsToConfig(b);
  return (
    x.boostMode === y.boostMode &&
    x.boostAccountScope === y.boostAccountScope &&
    x.boostVariantTasks === y.boostVariantTasks
  );
}

export interface BoostSettingsLockInput {
  /** 화면의 부스트 켜짐(저장 전 로컬 값). */
  boostOn: boolean;
  /** 화면의 다중 토큰 자동 순회 켜짐(저장 전 로컬 값). 균형 순회는 자동 순회 아래 옵션이라 이것만 본다. */
  rotationOn: boolean;
  /** 저장 토큰 프로필 수(불러오기 전이면 0). */
  profileCount: number;
}

export interface BoostSettingsLock {
  /** 부스트 토글을 켤 수 없는 이유(이미 켜져 있으면 끄기는 늘 허용 — undefined). */
  boostBlocked?: 'profiles' | 'rotation';
  /** 자동 순회·균형 순회를 켤 수 없는가(D12 — 부스트가 켜져 있음, 이미 켜진 순회를 끄는 것은 허용). */
  rotationBlocked: boolean;
}

/**
 * D12 상호 배타 + 토큰 수 조건 — 켜려는 쪽만 막고 상대를 자동으로 끄지 않는다(사용자가 직접 끈다).
 * 이미 켜진 쪽은 끌 수 있어야 하므로(구 config 에서 둘 다 켜진 경우 포함) 「켜기」만 막는다.
 */
export function boostSettingsLock(input: BoostSettingsLockInput): BoostSettingsLock {
  let boostBlocked: BoostSettingsLock['boostBlocked'];
  if (!input.boostOn) {
    if (input.rotationOn) boostBlocked = 'rotation';
    else if (input.profileCount < BOOST_MIN_TOKEN_PROFILES) boostBlocked = 'profiles';
  }
  return {
    ...(boostBlocked ? { boostBlocked } : {}),
    rotationBlocked: input.boostOn && !input.rotationOn,
  };
}

/**
 * D11 경고 창을 띄워야 하는가 — 끄기 → 켜기 전환일 때만, 「다시 보지 않음」(기기별 config) 이 없고 이번 앱 세션에서
 * 아직 확인하지 않았을 때. A ↔ B 방식만 바꾸는 것은 전환이 아니다.
 */
export function needsBoostWarning(input: {
  wasOn: boolean;
  nextOn: boolean;
  dismissed: boolean;
  acceptedThisSession: boolean;
}): boolean {
  return !input.wasOn && input.nextOn && !input.dismissed && !input.acceptedThisSession;
}

/**
 * 계정 수동 전환·토큰 로그인·토큰 삭제를 막아야 하는가 — 부스트 다중 계정 실행 중(워커 2개 이상)이거나 부스트 실행이
 * 참여 계정을 고르는 중(starting — 호스트 창만 안다). 실행 중 TOKEN.txt 가 바뀌면 기본 워커 계정이 참여 계정과 겹칠 수
 * 있다(같은 계정 동시 2요청 = 409).
 */
export function isBoostAccountSwitchLocked(input: {
  running: boolean;
  workers: number;
  starting?: boolean;
}): boolean {
  return input.running && (input.workers > 1 || input.starting === true);
}

/** 참여 후보 미리보기 한 줄(이름만 — 할당량은 조회하지 않는다). */
export function boostParticipantPreviewText(preview: {
  activeName?: string;
  names: string[];
}): string {
  const head = preview.activeName ? `현재 계정(${preview.activeName})` : '현재 로그인 계정';
  if (preview.names.length === 0) {
    return `참여 후보: ${head}만 — 함께 생성할 다른 저장 토큰이 없습니다.`;
  }
  return `참여 후보: ${head} + ${preview.names.join(', ')} — 실제 참여는 생성을 시작할 때 참여 범위와 할당량으로 판정합니다.`;
}

// ─── 문구 ───

export const BOOST_SCOPE_LABEL: Record<BoostAccountScope, string> = {
  free: '무료 할당만',
  purchased: '추가 충전 할당까지',
  anlas: 'Anlas 까지',
};

export const BOOST_TEXT = {
  /** 결과 보기의 표식 이름표. */
  accountLabel: '생성 계정',
  /** 진행 막대 표식 — 동시에 생성 중인 계정 수. */
  progressTag: (workers: number, short?: boolean) => (short ? `×${workers}` : `부스트 ×${workers}`),
  /** 다중 계정 긴 휴식 표시(쉬는 계정 수 / 전체). */
  restTag: (resting: number, workers: number, short?: boolean) =>
    short ? `휴식 ${resting}/${workers}` : `휴식 중 ${resting}/${workers}`,
  /** 실행 시작 때 참여할 다른 계정이 없을 때(안내 토스트·로그). */
  noParticipants: '부스트 모드: 함께 생성할 수 있는 다른 계정이 없어 현재 계정으로만 생성합니다.',
  /** 생성 직전 재확인에서 참여 조건을 잃었을 때(안내 토스트·로그). */
  quotaDropped: (name: string, scope: BoostAccountScope, summary: string) =>
    `${name}: 부스트 참여 조건(${BOOST_SCOPE_LABEL[scope]})을 더 이상 만족하지 않아 이 계정의 동시 생성을 멈췄습니다(${summary}). 다른 계정으로 계속합니다.`,
  /** 생성 직전 할당량 조회 실패(재시도 대상 오류 문구). */
  quotaCheckFailed: (name: string) => `${name}: 할당량을 확인하지 못했습니다`,
  /** A 에서 1계정만 남았을 때(안내 토스트·로그). */
  replicateEnded: (name: string) =>
    `동시 생성 계정이 하나만 남아 부스트(배수 예약)를 멈췄습니다. 다른 계정 몫은 취소하고 ${name} 몫만 이어서 생성합니다.`,
  /** A 에서 몫을 취소했을 때(로그). */
  sharesCancelled: (name: string, count: number) => `${name}: 이 계정 몫 ${count}장 취소`,
  /** 다중 계정에서 장 하나만 건너뛰었을 때 원 창(보조 창) 안내. */
  delegatedImageSkipped: (sceneName: string) =>
    `생성 실패(재시도 초과) — 이 장만 건너뛰고 계속합니다: ${sceneName}`,

  // ── 설정 화면·경고 창(B3) ──
  settingsTitle: '부스트 모드',
  settingsToggle: '부스트 모드 켜기',
  settingsDescription:
    '저장된 여러 토큰(계정)으로 동시에 생성해 예약을 더 빨리 처리합니다. 설정은 「저장」을 눌러야 반영됩니다.',
  modeHeading: '방식',
  modeLabel: {
    replicate: 'A · 모든 계정이 같은 예약을 받아 계정 수만큼 생성',
    split: 'B · 예약을 계정 수로 나눠 생성',
  } as Record<BoostActiveMode, string>,
  modeHint: {
    replicate: '예: 3계정 · 30장 예약 → 90장. 씬 예약 수가 참여 계정 수만큼 늘어납니다.',
    split: '예: 3계정 · 30장 예약 → 계정마다 약 10장씩, 총 30장.',
  } as Record<BoostActiveMode, string>,
  scopeHeading: '참여 범위',
  scopeHint: {
    free: 'Opus 구독의 무료 할당량이 남은 계정만 참여합니다.',
    purchased: '무료 할당량 또는 추가 충전 할당량이 남은 계정이 참여합니다.',
    anlas: 'Anlas 가 차감됩니다. 로그인할 수 있는 모든 저장 계정이 참여합니다.',
  } as Record<BoostAccountScope, string>,
  variantToggle: '인페인트·I2I·미러 등 변형 작업에도 적용',
  variantHint: '끄면 일반 이미지 생성 예약만 여러 계정으로 나눕니다.',
  profilesRequired: '토큰이 2개 이상 저장돼 있어야 합니다.',
  /** 부스트가 켜져 있어 자동 순회를 켤 수 없을 때. */
  rotationLocked: '부스트 모드와 함께 쓸 수 없습니다. 부스트 모드를 끈 뒤 켜 주세요.',
  /** 자동 순회가 켜져 있어 부스트를 켤 수 없을 때. */
  boostLockedByRotation: '자동 순회와 함께 쓸 수 없습니다. 자동 순회를 끈 뒤 켜 주세요.',
  /** 부스트 다중 계정 실행 중 수동 전환·로그인·삭제 차단(UI 안내·서비스 거부 오류 공용). */
  accountSwitchLocked: '부스트 실행 중에는 계정을 바꿀 수 없습니다. 생성을 멈춘 뒤 바꿔 주세요.',
  /** D11 경고 창 본문(범위가 Anlas 이면 한 줄 추가). */
  warningText: (scope: BoostAccountScope) =>
    '부스트 모드는 저장된 여러 NovelAI 계정으로 한 기기에서 동시에 생성합니다.\n' +
    'NovelAI 정책상 다계정 동시 사용은 제재·계정 정지 대상이 될 수 있으며, 이에 따른 모든 책임은 사용자에게 있습니다.' +
    (scope === 'anlas' ? '\nAnlas 가 각 계정에서 차감됩니다.' : ''),
  warningConfirm: '위험을 이해하고 켜기',
  warningDismiss: '다시 보지 않음',
};
