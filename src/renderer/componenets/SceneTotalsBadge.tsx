// PC 씬 도구줄 오른쪽 끝(보기 설정 묶음 = 카드 모양·크기 바로 왼쪽)의 「씬 N · 이미지 N · ★ N」 합계 표시
// (2026-11-23 사용자 결정 — 뽑은 장수가 기대한 총 장수와 맞는지 확인). 누를 수 없는 읽기 전용 표시, 툴팁으로 뜻을 푼다.
// 계산·자리 판정 규칙은 models/sceneImageTotals.ts(순수 함수).
//
// 자리: 보기 설정 묶음([data-scene-totals-anchor], relative) 안에서 absolute 로 그 왼쪽 바깥(right-full)에 뜬다.
//   flex 항목이 아니라 묶음 폭·줄바꿈·버튼 이름 판정(measureButtonNames 의 「옆 요소 폭」)에 전혀 들어가지 않는다
//   = 도구줄은 표시가 없는 것과 똑같이 배치되고, 남은 빈자리에 다 들어갈 때만 보인다(가장 먼저 양보).
//   들어가지 않으면 invisible(폭은 계속 잰다 — 다시 넓어지면 곧바로 보임).
// 갱신: 이미지 수는 씬 카드와 같은 gameService 'updated' 이벤트(생성·삭제·휴지통·WebP 변환·refreshBatch 가 모두 거침),
//   씬 추가·삭제·이름 변경과 즐겨찾기는 MobX 관찰(session.scenes/inpaints Map·scene.mains). 디스크 읽기 없음(메모리 목록 합산).
// 모바일(클래식·V2)에는 그리지 않는다 — 호출부가 !isMobile 일 때만 둔다.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { gameService } from '../models';
import type { Session } from '../models/types';
import { ActionIcon } from './ActionIcon';
import Tooltip from './Tooltip';
import { collectFlexItems, px } from './useProjectBarStage';
import {
  formatTotalCount,
  sceneTotalsFits,
  sceneTotalsTooltip,
  shouldShowSceneTotals,
  sumSceneImageTotals,
  TotalsBox,
} from '../models/sceneImageTotals';

export const SCENE_TOTALS_ANCHOR_ATTR = 'data-scene-totals-anchor';

const boxOf = (el: Element): TotalsBox => {
  const r = el.getBoundingClientRect();
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
};

const SceneTotalsBadge = observer(
  ({ session, type }: { session: Session; type: 'scene' | 'inpaint' }) => {
    const [, setRev] = useState(0);
    useEffect(() => {
      const onUpdated = () => setRev((r) => r + 1);
      gameService.addEventListener('updated', onUpdated);
      return () => gameService.removeEventListener('updated', onUpdated);
    }, []);

    // 탭 전체(검색과 무관). scene.mains 읽기는 observer 가 추적한다.
    const totals = sumSceneImageTotals(
      session.getScenes(type),
      (scene) => gameService.getOutputs(session, scene).length,
    );
    const visible = shouldShowSceneTotals(totals);

    const ref = useRef<HTMLDivElement | null>(null);
    const [fits, setFits] = useState(false);
    const fitsRef = useRef(fits);
    fitsRef.current = fits;

    const check = useCallback(() => {
      const el = ref.current;
      const anchor = el?.closest(`[${SCENE_TOTALS_ANCHOR_ATTR}]`);
      const outer = anchor?.parentElement;
      if (!el || !anchor || !outer) return;
      const row = outer.querySelector('[data-bn-row]');
      const items: Element[] = [];
      collectFlexItems(outer, items);
      const others = items
        .filter((it) => it !== anchor && it !== row && !it.contains(anchor))
        .filter((it) => it.getBoundingClientRect().width > 0)
        .map(boxOf);
      const need = el.getBoundingClientRect().width + px(getComputedStyle(el).marginRight);
      const next = sceneTotalsFits({
        need,
        anchor: boxOf(anchor),
        row: row ? boxOf(row) : null,
        others,
      });
      if (next !== fitsRef.current) {
        fitsRef.current = next;
        setFits(next);
      }
    }, []);

    // 렌더마다(숫자 자릿수가 바뀌면 필요 폭도 바뀐다) 그리기 전에 잰다. 표시는 레이아웃에 영향이 없어 왕복이 없다.
    useLayoutEffect(() => {
      check();
    });

    // 창 폭·버튼 줄(이름 보임/숨김·버튼 구성)·보기 설정 묶음 폭이 바뀌면 다시 잰다.
    useEffect(() => {
      if (!visible || typeof ResizeObserver === 'undefined') return undefined;
      const anchor = ref.current?.closest(`[${SCENE_TOTALS_ANCHOR_ATTR}]`);
      const outer = anchor?.parentElement;
      if (!anchor || !outer) return undefined;
      const ro = new ResizeObserver(() => check());
      ro.observe(outer);
      ro.observe(anchor);
      const row = outer.querySelector('[data-bn-row]');
      if (row) ro.observe(row);
      return () => ro.disconnect();
    }, [visible, check]);

    if (!visible) return null;
    const tooltip = sceneTotalsTooltip(totals);
    return (
      // 숨김(invisible) 상태에서는 마우스가 닿지 않아 툴팁도 뜨지 않는다.
      <Tooltip content={tooltip}>
        <div
          ref={ref}
          data-scene-totals=""
          data-fits={fits ? 'true' : 'false'}
          aria-label={fits ? tooltip : undefined}
          aria-hidden={fits ? undefined : true}
          className={`absolute right-full inset-y-0 mr-3 flex items-center gap-1 whitespace-nowrap text-sm tabular-nums select-none${
            fits ? '' : ' invisible'
          }`}
        >
          <span className="text-faint">씬</span>
          <span className="text-default">{formatTotalCount(totals.scenes)}</span>
          <span className="text-faint" aria-hidden="true">·</span>
          <span className="text-faint">이미지</span>
          <span className="text-default">{formatTotalCount(totals.images)}</span>
          <span className="text-faint" aria-hidden="true">·</span>
          <ActionIcon id="favorite" size={14} className="text-muted flex-none" aria-hidden="true" />
          <span className="text-default">{formatTotalCount(totals.favorites)}</span>
        </div>
      </Tooltip>
    );
  },
);

export default SceneTotalsBadge;
