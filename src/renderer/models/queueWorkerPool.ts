// 큐 워커 풀의 순수 규칙(부스트 모드 B1, 2026-11-01) — 서비스·backend 를 import 하지 않는다.
//
// 실행 루프는 「워커 N개가 공용 큐에서 다음 미할당 장을 집어 가는」 구조다(TaskQueueService.runPool).
// 부스트를 켜지 않으면 워커는 기본 워커 하나뿐이고, 그때의 동작은 예전 단일 루프와 같다(SPEC §11).
//
// ── 장 단위 할당(claim) ──
//  · 예약 1건(Task)의 장 상태: done(성공) · skipped(다중 워커에서 끝내 실패해 건너뛴 장) ·
//    inFlight(워커가 꺼냈지만 아직 끝나지 않은 장). 꺼낼 수 있는 조건 = done + skipped + inFlight < total.
//  · 장 번호(0부터)는 꺼낼 때 확정한다 — 그 장의 시드 = seedSchedule.seedForImageIndex(job.seed, 번호).
//    재시도는 같은 번호(같은 시드). 번호는 「돌려받은 번호 중 가장 작은 것 → 없으면 다음 새 번호」 순서로 준다.
//    워커 탈락·정지로 끝나지 않은 장은 번호를 돌려줘 다른 워커가 같은 번호·같은 시드로 이어받는다.
//  · 작업 제거 = done + skipped ≥ total 이고 inFlight == 0(또는 total 오염).
//
// 토큰은 이 모듈의 계정 정보에만 메모리로 머문다. 로그·미러·IPC·메타에는 이름만 쓴다.

import {
  LONG_BREAK_INTERVAL_MIN,
  nextLongBreakCount,
} from './requestTiming';

/** 워커가 쓰는 계정. 기본 워커(활성 계정)는 token 이 없다(= 저장된 로그인 토큰 TOKEN.txt). */
export interface QueueWorkerAccount {
  id: string;
  profileId?: string;
  /** 로그·안내용 이름(프로필 이름). 토큰을 넣지 않는다. */
  name: string;
  /** 이 워커의 요청에만 쓰는 토큰(메모리 전용). 기본 워커는 undefined. */
  token?: string;
}

export const DEFAULT_WORKER_ID = 'default';

/** 서로 다른 워커 2개 이상에서 429 가 이 시간 안에 나면 전 워커를 잠시 멈춘다(IP 제한 추정 대응). */
export const RATE_LIMIT_IP_WINDOW_MS = 60_000;
export const RATE_LIMIT_IP_MIN_WORKERS = 2;

/** 장 할당 상태 — Task 의 메모리 전용 필드와 같은 모양. */
export interface ImageClaimState {
  total: number;
  done: number;
  skipped?: number;
  inFlight?: number;
  nextImageIndex?: number;
  returnedImageIndices?: number[];
}

/** 아직 끝나지 않은 장 수(진행 중 포함) = total − done − skipped. total 오염(NaN 등)이면 0. */
export function remainingImageCount(t: ImageClaimState): number {
  const left = t.total - t.done - (t.skipped ?? 0);
  return Number.isFinite(left) && left > 0 ? left : 0;
}

/** 아직 아무 워커도 꺼내지 않은 장 수 = total − done − skipped − inFlight. */
export function unclaimedImageCount(t: ImageClaimState): number {
  const left = remainingImageCount(t) - (t.inFlight ?? 0);
  return left > 0 ? left : 0;
}

/** 이 작업을 큐에서 뺄 때인가 — 모든 장이 끝났고(성공·건너뜀) 진행 중인 장이 없을 때, 또는 total 오염. */
export function isTaskSettled(t: ImageClaimState): boolean {
  if (!Number.isFinite(t.total)) return true;
  return t.done + (t.skipped ?? 0) >= t.total && (t.inFlight ?? 0) <= 0;
}

/** 다음 장 번호를 꺼낸다 — 돌려받은 번호 중 가장 작은 것, 없으면 새 번호. */
export function takeImageIndex(t: ImageClaimState): number {
  const returned = t.returnedImageIndices;
  if (returned && returned.length > 0) {
    return returned.shift()!;
  }
  const k = t.nextImageIndex ?? 0;
  t.nextImageIndex = k + 1;
  return k;
}

/** 끝내지 못한 장의 번호를 돌려준다(오름차순 유지, 중복 무시). */
export function returnImageIndex(t: ImageClaimState, k: number): void {
  const list = (t.returnedImageIndices ??= []);
  if (list.includes(k)) return;
  let i = 0;
  while (i < list.length && list[i] < k) i++;
  list.splice(i, 0, k);
}

/**
 * 추가 워커의 첫 긴 휴식 카운터 — 워커마다 휴식이 겹치지 않게 순번만큼 늦춘다(D5 「서로 어긋나게」).
 * 순번 0(기본 워커)은 서비스 수준 카운터를 그대로 쓰므로 이 함수를 쓰지 않는다.
 */
export function staggeredLongBreakCount(
  order: number,
  workerCount: number,
  rand: () => number = Math.random,
): number {
  const n = Math.max(1, Math.floor(workerCount));
  const k = Math.max(0, Math.floor(order));
  return nextLongBreakCount(rand) + Math.floor((k * LONG_BREAK_INTERVAL_MIN) / n);
}

export interface RateLimitHit {
  workerId: string;
  at: number;
}

/** 최근 창(windowMs) 안의 429 가 서로 다른 워커 2개 이상에서 났는가. */
export function shouldPauseAllForRateLimit(
  hits: readonly RateLimitHit[],
  now: number,
  windowMs: number = RATE_LIMIT_IP_WINDOW_MS,
): boolean {
  const ids = new Set<string>();
  for (const h of hits) {
    if (now - h.at < windowMs) ids.add(h.workerId);
  }
  return ids.size >= RATE_LIMIT_IP_MIN_WORKERS;
}

/**
 * 개발 플래그로 받은 추가 워커 계정을 정리한다 — 토큰이 빈 항목·기본 워커 id·같은 id/토큰 중복은 버린다.
 * 돌려주는 값은 복사본이다(호출부 객체를 붙잡지 않음).
 */
export function normalizeWorkerAccounts(list: unknown): QueueWorkerAccount[] {
  if (!Array.isArray(list)) return [];
  const out: QueueWorkerAccount[] = [];
  const ids = new Set<string>([DEFAULT_WORKER_ID]);
  const tokens = new Set<string>();
  list.forEach((raw: any, i) => {
    if (!raw || typeof raw !== 'object') return;
    const token = typeof raw.token === 'string' ? raw.token.trim() : '';
    if (!token || tokens.has(token)) return;
    const id =
      typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `worker-${i + 1}`;
    if (ids.has(id)) return;
    const name =
      typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : id;
    ids.add(id);
    tokens.add(token);
    out.push({
      id,
      name,
      token,
      ...(typeof raw.profileId === 'string' ? { profileId: raw.profileId } : {}),
    });
  });
  return out;
}

/** 워커 풀 안내·로그 문구(다중 워커일 때만 쓰인다 — 단일 워커는 종전 문구 그대로). */
export const WORKER_POOL_TEXT = {
  defaultWorkerName: '기본 계정',
  /** 다중 워커 로그 꼬리표 「 · 계정 이름」. */
  tag: (name: string) => ` · ${name}`,
  poolStart: (names: string[]) => `동시 생성 시작: 계정 ${names.length}개(${names.join(', ')})`,
  /** 연속 실패로 그 계정만 뺄 때(토스트·로그). */
  consecutiveDropped: (name: string, lastError: string) =>
    `${name}: 연속으로 실패해 이 계정의 동시 생성을 멈췄습니다. 다른 계정으로 계속합니다.\n마지막 오류: ${lastError}`,
  /** 인증 오류로 그 계정만 뺄 때(확인 창). */
  authDropped: (name: string, message: string) =>
    `${name}: 로그인 인증 오류로 이 계정의 동시 생성을 멈췄습니다. 다른 계정으로 계속합니다.\n${message}`,
  /** 여러 계정에서 429 가 이어져 전 계정이 잠시 멈출 때(로그). */
  ipPause: (ms: number) =>
    `여러 계정에서 요청 제한(429)이 이어져 모든 계정이 ${Math.round(ms / 1000)}초 쉽니다`,
  /** 다중 워커에서 한 워커가 긴 휴식에 들어갈 때(로그 — 큐 전체 「휴식 중」 표시는 하지 않는다). */
  longBreak: (name: string, ms: number) =>
    `${name}: 긴 휴식 ${Math.round(ms / 1000)}초(다른 계정은 계속)`,
  /** 다중 워커에서 한 장만 건너뛸 때(로그). */
  imageSkipped: (numTries: number) => `${numTries}회 재시도 실패 - 이 장만 건너뜀`,
  /** 기본 계정만 처리할 수 있는 작업(증강·업스케일·바이브 인코딩 등)을 다른 계정이 넘길 때(로그). */
  declined: '기본 계정 전용 처리가 필요해 기본 계정에 넘김',
  /** 처리할 수 있는 워커가 없어 남은 작업이 있을 때(로그). */
  leftover: '처리할 수 있는 계정이 없어 남은 작업을 큐에 두고 멈췄습니다',
  /** 장 단위 건너뜀 진행 바 문구. */
  imageSkippedShort: '재시도 초과로 이 장만 건너뜀',
};

/** 핸들러가 「이 워커는 이 작업을 처리할 수 없음(기본 계정 필요)」을 알리는 오류 표식. */
export const WORKER_DECLINED_MARK = 'workerDeclined';

export function createWorkerDeclinedError(reason: string): Error {
  const err: any = new Error(reason);
  err[WORKER_DECLINED_MARK] = true;
  err.retryable = false;
  return err;
}

export function isWorkerDeclinedError(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as any)[WORKER_DECLINED_MARK] === true;
}

/**
 * 핸들러가 「이 워커(계정)는 이 실행에서 빠져야 함」을 알리는 오류 표식(부스트 B2 — 생성 직전 재확인에서 참여 조건을
 * 잃음). 큐는 실패로 세지 않고 그 워커만 탈락시킨다(B: 쥔 장 반납 / A: 그 계정 몫 취소). 기본 워커에는 오지 않는다.
 */
export const WORKER_DROP_MARK = 'workerDrop';

export function createWorkerDropError(reason: string): Error {
  const err: any = new Error(reason);
  err[WORKER_DROP_MARK] = true;
  err.retryable = false;
  return err;
}

export function isWorkerDropError(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as any)[WORKER_DROP_MARK] === true;
}
