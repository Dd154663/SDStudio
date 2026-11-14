// 공용 씬 선택 열(2026-11-14 A-3 — 찾기 및 변환·일괄 삽입 두 창이 공유, 선택 상태는 창마다 따로).
// 종전 FindReplaceDialog 안 SceneSelectAside + useSceneSelection 을 떼어 냈다(SPEC_GUIDE 「오버레이 창 크기 체계」 창별 배정표).
//
// · 목록 = 이미지생성 씬 이름 + 변형 씬 키(`inpaint:` 접두 — 이미지생성 씬 이름과 겹치지 않게, 이름에 ':' 는 경로 안전 규칙상 없음).
// · 열 머리 아래 「생성 n」「변형 n」 체크 칩(기본 둘 다 켬) — 끈 종류는 목록에서 빠지고 선택에도 들지 않는다(실제 대상 =
//   선택 ∩ 켠 종류). 둘 다 끄면 목록이 비고 안내. 씬 이름 검색은 종전처럼 보이기만 거른다(선택은 그대로).
// · [전체 선택/해제] = 보이는(종류 칩·이름 검색 통과) 씬만.
// · initial: 'all' = 처음·씬 수가 바뀔 때 전체 선택(찾기 — 종전 규칙) / 'none' = 빈 선택에서 시작(일괄 삽입).
import React, { useEffect, useMemo, useState } from 'react';
import { appState } from '../models/AppService';
import { isMobile } from '../models';
import type { InpaintScene } from '../models/types';

export const VARIANT_KEY_PREFIX = 'inpaint:';
export const variantKey = (name: string) => VARIANT_KEY_PREFIX + name;
export const isVariantKey = (key: string) => key.startsWith(VARIANT_KEY_PREFIX);
export const sceneKeyLabel = (key: string) =>
  isVariantKey(key) ? `[변형] ${key.slice(VARIANT_KEY_PREFIX.length)}` : key;

export type SceneKind = 'scene' | 'variant';

export interface SceneSelectionOptions {
  initial: 'all' | 'none';
  /** 목록에 넣을 변형 씬(없으면 전부) — 일괄 삽입은 프롬프트 칸이 있는 변형만 */
  includeVariant?: (scene: InpaintScene) => boolean;
}

export function useSceneSelection(opts: SceneSelectionOptions) {
  const session = appState.curSession;
  const { initial, includeVariant } = opts;
  const sceneList = useMemo(() => {
    if (!session) return [];
    return [
      ...Array.from(session.scenes.values()).map((s) => s.name),
      ...Array.from(session.inpaints.values())
        .filter((s) => !includeVariant || includeVariant(s))
        .map((s) => variantKey(s.name)),
    ];
  }, [session, session?.scenes.size, session?.inpaints.size]);

  const [picked, setPicked] = useState<Set<string>>(() => (initial === 'all' ? new Set(sceneList) : new Set()));
  const [sceneFilter, setSceneFilter] = useState('');
  const [kinds, setKinds] = useState<Record<SceneKind, boolean>>({ scene: true, variant: true });

  // 씬 리스트가 변경되면 전체 선택으로 초기화(찾기 — 종전 규칙). 빈 선택 창은 고른 것을 그대로 둔다.
  useEffect(() => {
    if (initial === 'all') setPicked(new Set(sceneList));
  }, [sceneList.length]);

  const kindOf = (key: string): SceneKind => (isVariantKey(key) ? 'variant' : 'scene');
  const kindCounts = useMemo(() => {
    let variant = 0;
    for (const k of sceneList) if (isVariantKey(k)) variant++;
    return { scene: sceneList.length - variant, variant };
  }, [sceneList]);

  // 실제 대상 = 고른 것 ∩ 목록 ∩ 켠 종류(같은 내용이면 같은 객체 — 소비 쪽 useEffect 가 헛돌지 않게)
  const selectedScenes = useMemo(
    () => new Set(sceneList.filter((k) => picked.has(k) && kinds[kindOf(k)])),
    [sceneList, picked, kinds],
  );

  const visibleList = useMemo(() => {
    const byKind = sceneList.filter((k) => kinds[kindOf(k)]);
    if (!sceneFilter.trim()) return byKind;
    const q = sceneFilter.toLowerCase();
    return byKind.filter((name) => sceneKeyLabel(name).toLowerCase().includes(q));
  }, [sceneList, sceneFilter, kinds]);

  const toggleScene = (name: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  // 보이는 씬만 대상
  const allVisibleSelected = visibleList.length > 0 && visibleList.every((name) => selectedScenes.has(name));
  const toggleAll = () => {
    const target = visibleList;
    setPicked((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) target.forEach((name) => next.delete(name));
      else target.forEach((name) => next.add(name));
      return next;
    });
  };

  const toggleKind = (kind: SceneKind) => setKinds((prev) => ({ ...prev, [kind]: !prev[kind] }));

  return {
    sceneList,
    visibleList,
    selectedScenes,
    sceneFilter,
    setSceneFilter,
    toggleScene,
    toggleAll,
    allVisibleSelected,
    kinds,
    kindCounts,
    toggleKind,
  };
}

export type SceneSelection = ReturnType<typeof useSceneSelection>;

const KIND_CHIPS: [SceneKind, string][] = [
  ['scene', '생성'],
  ['variant', '변형'],
];

export const SceneSelectAside = ({ sel }: { sel: SceneSelection }) => {
  const {
    sceneList,
    visibleList,
    selectedScenes,
    sceneFilter,
    setSceneFilter,
    toggleScene,
    toggleAll,
    allVisibleSelected,
    kinds,
    kindCounts,
    toggleKind,
  } = sel;
  const noKinds = !kinds.scene && !kinds.variant;
  const filtering = !!sceneFilter.trim() || !kinds.scene || !kinds.variant;
  return (
    // PC = 왼쪽 열 전체 높이(목록이 남은 높이를 채움), 모바일 = 본문 위에 쌓이므로 목록은 종전 max-h-36
    <div className={isMobile ? 'flex flex-col gap-1' : 'h-full min-h-0 flex flex-col gap-1 p-3'} data-find-scene-select="">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          씬 선택 · <span data-find-scene-count="">선택 {selectedScenes.size} / 전체 {sceneList.length}</span>
        </span>
        <button onClick={toggleAll} disabled={visibleList.length === 0} className="text-xs btn-link flex-none disabled:opacity-50">
          {allVisibleSelected ? '전체 해제' : '전체 선택'}
          {filtering && ` (${visibleList.length}개)`}
        </button>
      </div>
      {/* 씬 종류 칩 — 끈 종류는 목록·선택에서 빠진다 */}
      <div className="flex flex-wrap items-center gap-1.5" data-scene-kind-chips="">
        {KIND_CHIPS.map(([kind, label]) => (
          <label
            key={kind}
            data-scene-kind-chip={kind}
            className={
              'inline-flex items-center gap-1 px-2 py-0.5 rounded-full border line-color text-xs cursor-pointer select-none ' +
              (kinds[kind] ? 'back-sky' : 'text-muted')
            }
          >
            <input type="checkbox" checked={kinds[kind]} onChange={() => toggleKind(kind)} className="rounded line-color" />
            <span>
              {label} {kindCounts[kind]}
            </span>
          </label>
        ))}
      </div>
      <input type="text" placeholder="씬 이름 검색..." value={sceneFilter}
        onChange={(e) => setSceneFilter(e.target.value)}
        className="w-full mb-1 px-3 py-1.5 rounded border line-color bg-[var(--c-input-bg)] text-default text-sm focus:outline-none focus:ring-2 focus:ring-sky-400" />
      <div
        className={
          (isMobile ? 'max-h-36' : 'flex-1 min-h-0') + ' overflow-y-auto border line-color rounded-lg p-2 space-y-1'
        }
        data-find-scene-list=""
      >
        {visibleList.map((name) => (
          <label key={name}
            className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700/50 rounded px-1 py-0.5">
            <input type="checkbox" checked={selectedScenes.has(name)} onChange={() => toggleScene(name)}
              className="rounded line-color" />
            <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{sceneKeyLabel(name)}</span>
          </label>
        ))}
        {sceneList.length === 0 && <div className="text-xs text-faint py-1">씬이 없습니다</div>}
        {sceneList.length > 0 && noKinds && (
          <div className="text-xs text-faint py-1" data-scene-kind-empty="">씬 종류(생성·변형)를 하나 이상 켜세요</div>
        )}
        {sceneList.length > 0 && !noKinds && visibleList.length === 0 && (
          <div className="text-xs text-faint py-1">일치하는 씬이 없습니다</div>
        )}
      </div>
    </div>
  );
};

export default SceneSelectAside;
