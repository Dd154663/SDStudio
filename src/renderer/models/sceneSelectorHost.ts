// 씬 선택 창(SceneSelector) 호스트 등록(2026-10-04 P2~P4) — 씬 선택 창은 각 탭의 SceneQueueControl 안에 있어
// 전역 컨텍스트 메뉴(AppContextMenu 「선택 작업」)는 직접 띄울 수 없다. SceneQueueControl 이 마운트될 때 자기 setter 를
// 종류별로 등록하고, 컨텍스트 메뉴의 변형 씬 일괄 작업(이미지 첨부의 「기존 이미지에서 선택」·마스크 원본 고르기)이 빌려 쓴다.
import type { SceneSelectorItem } from './AppService';
import type { GenericScene } from './types';

export type SceneSelectorSetter = (item: SceneSelectorItem | undefined) => void;

const hosts = new Map<'scene' | 'inpaint', SceneSelectorSetter>();

/** 등록 — 반환 함수로 해제(그사이 다른 호스트가 등록했으면 그대로 둔다). */
export function registerSceneSelectorHost(
  type: 'scene' | 'inpaint',
  setter: SceneSelectorSetter,
): () => void {
  hosts.set(type, setter);
  return () => {
    if (hosts.get(type) === setter) hosts.delete(type);
  };
}

/** 등록된 씬 선택 창 setter(없으면 undefined — 그 탭 화면이 아직 없음). */
export function sceneSelectorHost(type: 'scene' | 'inpaint'): SceneSelectorSetter | undefined {
  return hosts.get(type);
}

/**
 * 씬 고르기 — 이미 고른 씬(선택 모드의 「선택 작업」)이 있으면 그대로, 없으면 씬 선택 창.
 * 창을 닫으면(아무것도 고르지 않음) 빈 배열. 대량 작업 I2I·변형 씬 일괄 흐름(i2iBatchFlow·variantBatchFlow) 공용.
 */
export function chooseScenes(
  setSceneSelector: SceneSelectorSetter,
  item: Omit<SceneSelectorItem, 'callback'>,
  preselected?: readonly GenericScene[],
): Promise<GenericScene[]> {
  if (preselected) return Promise.resolve([...preselected]);
  return new Promise((resolve) => {
    setSceneSelector({
      ...item,
      callback: (selected) => {
        setSceneSelector(undefined);
        resolve(selected);
      },
    });
  });
}
