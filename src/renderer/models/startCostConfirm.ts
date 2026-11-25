import type { CostItem } from './TaskQueueService';

/**
 * 생성 시작 전 「유료 세팅」 확인 판정(2026-11-25 사용자 결정).
 * - 예상 소모를 계산하지 못하는 항목(스텝 28 초과·큰 해상도)은 종전처럼 있으면 항상 묻는다.
 * - 예상 소모를 계산할 수 있는 항목(캐릭터 레퍼런스 — CostItem.anlas)은 줄마다 묻지 않고, 지금 예약을 모두
 *   실행했을 때의 합계가 기준(1000 Anlas)을 넘을 때만 묻는다. 평소의 장당 소모는 상단 Anlas 배지 옆 「-n」으로 보인다.
 */
export const START_COST_ANLAS_CONFIRM_THRESHOLD = 1000;

/** 확인 창에 늘어놓는 항목 줄 수 상한(종전과 같음). */
const MAX_LINES = 10;

export interface StartCostConfirm {
  confirm: boolean;
  /** 확인 창 본문(confirm 이 거짓이면 빈 문자열). */
  text: string;
  /** 계산된 예상 소모 합계(Anlas). */
  knownAnlas: number;
}

export function planStartCostConfirm(costs: readonly CostItem[]): StartCostConfirm {
  const unknown = costs.filter((c) => c.anlas === undefined);
  const knownAnlas = costs.reduce((sum, c) => sum + (c.anlas ?? 0), 0);
  const overThreshold = knownAnlas > START_COST_ANLAS_CONFIRM_THRESHOLD;
  if (unknown.length === 0 && !overThreshold) return { confirm: false, text: '', knownAnlas };
  const lines: string[] = [];
  if (overThreshold) {
    lines.push(`지금 예약을 모두 실행하면 캐릭터 레퍼런스로 약 ${knownAnlas} Anlas 를 씁니다.`);
  }
  lines.push(...unknown.map((x) => `${x.text} (씬: ${x.scene})`).slice(0, MAX_LINES));
  return {
    confirm: true,
    text: ['Anlas를 소모하는 유료 세팅입니다. 계속합니까?', ...lines].join('\n'),
    knownAnlas,
  };
}
