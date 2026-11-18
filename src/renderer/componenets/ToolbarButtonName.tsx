// PC 툴바 버튼 이름(아이콘 아래 작은 이름, 2026-11-18) — 표시 래퍼 + 측정 + 단계 훅.
// 판정 규칙은 models/buttonNameStage.ts(buttonNameNeeds) + models/projectBarStage.ts(pickProjectBarStage),
// 측정 훅은 하단 바와 같은 useProjectBarStage(렌더마다 그리기 전 판정 — 이름이 한 프레임 보였다 사라지지 않는다).
//
// 구조: [data-bn-slot] 세로 묶음 = [data-bn-body](버튼 그대로) + [data-bn-name](이름).
//   'show'    = 이름이 버튼 아래(간격 3px, 11px, 흐린 글자색 text-muted). 누르면 그 버튼을 누른 것과 같다.
//   'measure' = 모습은 지금 그대로, 폭 측정용 보이지 않는 이름만(absolute·invisible·aria-hidden).
//   mode 없음/이름 없음 = 래퍼 없이 버튼 그대로(설정 끔·모바일·글자 모드·글자형 버튼).
// 이름은 aria-hidden(버튼에 Tooltip 이 붙인 접근성 이름이 이미 있다).
import { ReactNode, MouseEvent } from 'react';
import { buttonNameNeeds, NamedGroup, NamedSlot } from '../models/buttonNameStage';
import type { ProjectBarNeeds } from '../models/projectBarStage';
import { collectFlexItems, px, useProjectBarStage } from './useProjectBarStage';

export type ButtonNameMode = 'show' | 'measure' | undefined;

const clickBody = (e: MouseEvent<HTMLElement>) => {
  const slot = e.currentTarget.closest('[data-bn-slot]');
  const btn = slot?.querySelector<HTMLButtonElement>('[data-bn-body] button');
  if (btn && !btn.disabled) btn.click();
};

export function ButtonNameSlot({
  name,
  mode,
  children,
}: {
  name?: string;
  mode: ButtonNameMode;
  children: ReactNode;
}) {
  if (!mode || !name) return <>{children}</>;
  return (
    <div className="tb-named" data-bn-slot="">
      <div className="tb-named-body" data-bn-body="">
        {children}
      </div>
      {mode === 'show' ? (
        <span data-bn-name="" aria-hidden="true" className="tb-name text-muted" onClick={clickBody}>
          {name}
        </span>
      ) : (
        <span data-bn-name="" aria-hidden="true" className="tb-name tb-name-measure">
          {name}
        </span>
      )}
    </div>
  );
}

const width = (el: Element | null | undefined) => el?.getBoundingClientRect().width ?? 0;

function slotOf(item: Element): NamedSlot {
  const body = item.querySelector('[data-bn-body]');
  const name = item.querySelector('[data-bn-name]');
  return { body: body ? width(body) : width(item), name: name ? width(name) : 0 };
}

// outer = 버튼 줄([data-bn-row])과 그 옆 고정 요소(셀 크기 선택·결과 탭 등)를 담은 바깥 줄.
// 가용 폭 = 바깥 안쪽 폭 − 옆 요소 폭(바깥이 flex 일 때만). 필요 폭 = 버튼 줄 flex 항목 폭(+여백) 합 + 줄 간격.
// 이름 몫 = 버튼 묶음([data-bn-items] — 씬 툴바 그룹 칸·머리줄)마다 이름 보임/숨김의 칸 폭 차이(간격 변화·캡션 포함),
// 묶음 밖 이름 달린 버튼(⋯ 더보기)은 홀로 한 묶음. 묶음의 간격은 data-bn-gap-icon/label(없으면 지금 간격).
export function measureButtonNames(outer: HTMLElement, labelsShown: boolean): ProjectBarNeeds {
  const row = outer.querySelector<HTMLElement>('[data-bn-row]');
  if (!row) return { available: 0, labelNeed: 0, iconNeed: 0 };
  const ocs = getComputedStyle(outer);
  let others = 0;
  if (ocs.display === 'flex' || ocs.display === 'inline-flex') {
    const outerItems: Element[] = [];
    collectFlexItems(outer, outerItems);
    for (const it of outerItems) {
      if (it === row || it.contains(row)) continue;
      const w = width(it);
      if (w <= 0) continue;
      others += w + px(getComputedStyle(it).marginRight);
    }
  }
  const available =
    outer.clientWidth - px(ocs.paddingLeft) - px(ocs.paddingRight) - others;

  const items: Element[] = [];
  collectFlexItems(row, items);
  let base = 0;
  let count = 0;
  for (const it of items) {
    const w = width(it);
    if (w <= 0) continue;
    const cs = getComputedStyle(it);
    base += w + px(cs.marginLeft) + px(cs.marginRight);
    count += 1;
  }
  base += px(getComputedStyle(row).columnGap) * Math.max(0, count - 1);

  const groups: NamedGroup[] = [];
  const seen = new Set<Element>();
  for (const name of Array.from(row.querySelectorAll('[data-bn-name]'))) {
    const slot = name.closest('[data-bn-slot]');
    if (!slot) continue;
    const box = slot.closest('[data-bn-items]');
    if (!box || !row.contains(box)) {
      groups.push({ caption: 0, slots: [slotOf(slot)], gapIcon: 0, gapLabel: 0 });
      continue;
    }
    if (seen.has(box)) continue;
    seen.add(box);
    const children: Element[] = [];
    collectFlexItems(box, children);
    const slots = children.filter((c) => width(c) > 0).map(slotOf);
    const gapNow = px(getComputedStyle(box).columnGap);
    const gi = box.getAttribute('data-bn-gap-icon');
    const gl = box.getAttribute('data-bn-gap-label');
    const caption = Array.from(box.parentElement?.children ?? []).find((c) =>
      c.hasAttribute('data-bn-caption'),
    );
    groups.push({
      caption: width(caption),
      slots,
      gapIcon: gi != null ? Number(gi) : gapNow,
      gapLabel: gl != null ? Number(gl) : gapNow,
    });
  }
  return buttonNameNeeds(available, base, groups, labelsShown);
}

// enabled=false(설정 끔·모바일·글자 모드·클래식 툴바)면 측정하지 않고 mode 없음(래퍼 없는 지금 모습).
export function useButtonNameStage(enabled: boolean) {
  const { rowRef, stage } = useProjectBarStage(enabled, { measure: measureButtonNames });
  const mode: ButtonNameMode = !enabled ? undefined : stage === 'label' ? 'show' : 'measure';
  return { rowRef, mode };
}
