// 생성 개수 입력 판정 — 일반 생성 개수(TaskQueueControl → appState.samples)와 퀵 생성 장수가 같은 규칙을 쓴다(2026-11-22).
//
//  · 범위 1~99, 정수(parseInt — 「3.7」 은 3).
//  · 빈 값·숫자 아님(NaN)은 1 — NaN 이 개수에 들어가면 큐 통계가 영구 오염된다(TaskQueueControl 종전 주석).
//
// 퀵 생성 장수는 퀵 생성 전용 프로젝트의 default 씬 meta 에 둔다(해상도와 같은 곳 — 프로젝트 파일로 저장).
// 키가 없거나 값이 이상하면 1(예전 파일·롤백 호환 — 구버전은 모르는 meta 키를 그대로 둔다). appState.samples 와 공유하지 않는다.

import type { Scene } from './types';

export const SAMPLE_COUNT_MIN = 1;
export const SAMPLE_COUNT_MAX = 99;

/** 입력칸 값 → 생성 개수(1~99, 잘못된 값은 1). */
export function parseSampleCount(raw: unknown): number {
  const num = parseInt(String(raw ?? ''), 10);
  return Number.isFinite(num)
    ? Math.max(SAMPLE_COUNT_MIN, Math.min(SAMPLE_COUNT_MAX, num))
    : SAMPLE_COUNT_MIN;
}

/** 퀵 생성 장수를 담는 씬 meta 키(워크플로우 이름과 겹치지 않는 접두 — sceneSeedGroups 의 키와 같은 관례). */
export const QUICK_GEN_COUNT_META_KEY = '__sdstudioQuickGenCountV1';

/** 퀵 생성 장수 — 씬이 없거나 값이 없으면 1. */
export function getQuickGenCount(scene: Pick<Scene, 'meta'> | undefined | null): number {
  const v = scene?.meta?.get(QUICK_GEN_COUNT_META_KEY);
  if (v === undefined || v === null) return SAMPLE_COUNT_MIN;
  return parseSampleCount(v);
}

/** 퀵 생성 장수 저장(같은 판정으로 정리한 값). 저장 표시(markDirty)는 호출부 몫. */
export function setQuickGenCount(scene: Pick<Scene, 'meta'>, raw: unknown): number {
  const n = parseSampleCount(raw);
  scene.meta.set(QUICK_GEN_COUNT_META_KEY, n);
  return n;
}
