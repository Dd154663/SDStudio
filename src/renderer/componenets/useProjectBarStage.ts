// PC 프로젝트 바 반응형 3단계 측정 훅(2026-11-10 아이콘 직관화 묶음 1). 판정 규칙은 models/projectBarStage.ts.
// 바(행) 요소의 폭을 ResizeObserver 로 지켜보고, 렌더마다(useLayoutEffect — 그리기 전) 다시 잰다.
// 그리기 전에 단계를 정하므로 글자가 한 프레임 보였다 사라지는 점프가 없다.
//
// 재는 법: 행의 flex 항목(display:contents 는 안으로 내려가고, absolute/fixed·숨김은 뺀다)의 폭 합 + 행 간격.
// data-pb-flex 표식 항목(프로젝트 선택기 — flex-1 로 남는 폭을 채운다)은 실제 폭 대신 min-width 로 센다.
// 글자 폭은 버튼 안 [data-pb-label] 글자에서 잰다 — 아이콘 단계에서도 보이지 않는 측정용 글자(absolute·invisible)가
// 있어 「글자를 켜면 얼마나 늘어나는지」를 켜 보지 않고 안다.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ProjectBarNeeds,
  ProjectBarStage,
  PROJECT_BAR_HYSTERESIS_PX,
  ShareSlot,
  pickProjectBarStage,
  projectBarNeeds,
  shareButtonsNeeds,
} from '../models/projectBarStage';

function px(v: string | null | undefined): number {
  const n = parseFloat(v ?? '');
  return Number.isFinite(n) ? n : 0;
}

function collectFlexItems(el: Element, out: Element[]) {
  for (const child of Array.from(el.children)) {
    const cs = getComputedStyle(child);
    if (cs.display === 'none') continue;
    if (cs.position === 'absolute' || cs.position === 'fixed') continue;
    if (cs.display === 'contents') {
      collectFlexItems(child, out);
      continue;
    }
    out.push(child);
  }
}

export function measureProjectBar(row: HTMLElement, labelsShown: boolean) {
  const items: Element[] = [];
  collectFlexItems(row, items);
  let sum = 0;
  let count = 0;
  for (const it of items) {
    const w = it.getBoundingClientRect().width;
    const flexMin = it.hasAttribute('data-pb-flex')
      ? px(getComputedStyle(it).minWidth)
      : 0;
    const width = flexMin > 0 ? flexMin : w;
    if (width <= 0) continue;
    sum += width;
    count += 1;
  }
  const gap = px(getComputedStyle(row).columnGap);
  const base = sum + gap * Math.max(0, count - 1);
  const labelWidths = Array.from(row.querySelectorAll('[data-pb-label]')).map(
    (l) => l.getBoundingClientRect().width,
  );
  return projectBarNeeds(row.clientWidth, base, labelWidths, labelsShown);
}

// 칸 나눔 버튼 줄(2026-11-10 묶음 2): 행 안 [data-pb-share] 버튼마다 칸 안쪽 크기(패딩 뺀 폭/높이)와
// 글자를 놓는 데 필요한 크기를 잰다. 'width' = 글자 폭과 윗줄(아이콘+개수, [data-pb-top]) 폭 중 큰 값,
// 'height' = 윗줄 높이 + 글자 높이 + 사이 간격(gapPx). 글자는 보이든(show) 측정용이든(measure) 같은 [data-pb-label].
export function measureShareButtons(
  row: HTMLElement,
  axis: 'width' | 'height',
  gapPx = 2,
): ProjectBarNeeds {
  const slots: ShareSlot[] = [];
  for (const btn of Array.from(row.querySelectorAll<HTMLElement>('[data-pb-share]'))) {
    const label = btn.querySelector('[data-pb-label]');
    if (!label) continue;
    const cs = getComputedStyle(btn);
    const r = btn.getBoundingClientRect();
    const lr = label.getBoundingClientRect();
    const top = btn.querySelector('[data-pb-top]')?.getBoundingClientRect();
    if (axis === 'width') {
      const room = r.width - px(cs.paddingLeft) - px(cs.paddingRight);
      slots.push({ room, need: Math.max(lr.width, top?.width ?? 0) });
    } else {
      const room = r.height - px(cs.paddingTop) - px(cs.paddingBottom);
      slots.push({ room, need: (top?.height ?? 0) + gapPx + lr.height });
    }
  }
  return shareButtonsNeeds(slots);
}

export interface LabelStageOptions {
  // 기본 = measureProjectBar(한 줄 flex 항목 폭 합). 칸 나눔 줄은 measureShareButtons 를 넘긴다.
  measure?: (row: HTMLElement, labelsShown: boolean) => ProjectBarNeeds;
  hysteresis?: number;
}

// enabled=false(모바일·사이드 바)면 측정하지 않고 항상 'icon'(라벨 도입 전 모습).
// 2026-11-10 묶음 2: 사전 세팅 패널 줄도 같은 훅을 쓴다(options 로 측정 방식·히스테리시스만 바꿈).
export function useProjectBarStage(enabled: boolean, options?: LabelStageOptions) {
  const rowRef = useRef<HTMLElement | null>(null);
  const [stage, setStage] = useState<ProjectBarStage>('icon');
  const stageRef = useRef(stage);
  stageRef.current = stage;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const measure = useCallback(() => {
    const row = rowRef.current;
    if (!enabled || !row) return;
    const opts = optionsRef.current;
    const shown = stageRef.current === 'label';
    const next = pickProjectBarStage(
      opts?.measure ? opts.measure(row, shown) : measureProjectBar(row, shown),
      stageRef.current,
      opts?.hysteresis ?? PROJECT_BAR_HYSTERESIS_PX,
    );
    if (next !== stageRef.current) {
      stageRef.current = next;
      setStage(next);
    }
  }, [enabled]);

  // 렌더마다(버튼 구성·프리셋 칩·미러 배지가 바뀌면 필요 폭도 바뀐다) 그리기 전에 다시 잰다.
  useLayoutEffect(() => {
    measure();
  });

  // 창·바 폭 변화. 글꼴 로딩 등으로 버튼 폭만 바뀌어도 줄바꿈이 생기면 행 높이가 바뀌어 여기로 들어온다.
  useEffect(() => {
    if (!enabled || typeof ResizeObserver === 'undefined') return undefined;
    const row = rowRef.current;
    if (!row) return undefined;
    const ro = new ResizeObserver(() => measure());
    ro.observe(row);
    return () => ro.disconnect();
  }, [enabled, measure]);

  return { rowRef, stage: enabled ? stage : ('icon' as ProjectBarStage) };
}
