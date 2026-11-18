// 캐릭터 프리셋 순차 생성 「현재 프로젝트」 모드의 적용 상태 되돌리기(2026-11-18 프리셋 유실 조사 경로 12).
//
// 순차 생성은 프로젝트 공용 설정(presetShareds[현재 워크플로])의 캐릭터 프리셋 유래 항목(fromPreset 이 붙은 vibes·
// characterReferences·characterPrompts)과 _appliedPresetName 을 프리셋마다 바꿔 끼운다(CyclingSessionService.applyPreset).
// 예약된 작업은 예약 시점에 입력이 굳는다(buildSDImageGenJob 이 vibes·characterReferences 를 깊은 복사, 프롬프트·캐릭터 프롬프트는
// 예약 때 계산) — 그래서 큐에 작업이 남아 있어도 되돌리기가 남은 생성의 캐릭터를 바꾸지 않는다.
//
// 규칙:
//  · 되돌리는 범위 = 순차 생성이 바꾸는 것만: 세 목록의 fromPreset 항목 + _appliedPresetName. 지금 목록의 사용자 항목
//    (fromPreset 없음 — 진행 중 사용자가 더하거나 고친 것 포함)은 지금 상태 그대로 두고, 시작 전 fromPreset 항목을 원래 자리
//    (min(원래 index, 길이))로 되돌려 넣는다. 사용자 항목이 그대로면 시작 전 배열과 똑같아진다(같은 객체).
//  · 순차 생성이 마지막으로 적용한 프리셋과 지금 _appliedPresetName 이 다르면(진행 중 사용자가 다른 프리셋을 직접 적용) 덮지 않는다.
//  · 프롬프트·씬·사전 세팅(preset) 등 그 밖의 값은 건드리지 않는다. 글로벌 프리셋을 실체화한 로컬 사본(characterPresets)도 남긴다.
//  · 되돌리기(Ctrl+Z) 기록을 남기지 않는다 — 순차 생성의 바꿔 끼우기도 기록하지 않으므로, 시작 전 상태로 돌아가는 것이 기록 스택과 맞다.

export const CYCLING_CHARACTER_LIST_KEYS = ['vibes', 'characterReferences', 'characterPrompts'] as const;
type ListKey = (typeof CYCLING_CHARACTER_LIST_KEYS)[number];

interface PlacedItem {
  index: number;
  item: unknown;
}

export interface AppliedCharacterRestorePoint {
  /** 되돌릴 프로젝트(시작 때 잡은 객체) */
  session: { presetShareds: Map<string, any> };
  workflowType: string;
  /** 시작 전 fromPreset 항목과 원래 자리 */
  lists: Record<ListKey, PlacedItem[]>;
  appliedPresetName: unknown;
  /** 순차 생성이 마지막으로 적용한 프리셋 이름(없으면 아직 아무것도 바꾸지 않음) */
  lastApplied?: string;
}

const isPresetItem = (x: any) => !!x?.fromPreset;

export function captureAppliedCharacter(
  session: { presetShareds: Map<string, any> },
  workflowType: string,
): AppliedCharacterRestorePoint {
  const shared = session.presetShareds.get(workflowType);
  const lists = {} as Record<ListKey, PlacedItem[]>;
  for (const key of CYCLING_CHARACTER_LIST_KEYS) {
    const arr = shared && Array.isArray(shared[key]) ? (shared[key] as unknown[]) : [];
    lists[key] = [];
    arr.forEach((item, index) => {
      if (isPresetItem(item)) lists[key].push({ index, item });
    });
  }
  return {
    session,
    workflowType,
    lists,
    appliedPresetName: shared ? shared._appliedPresetName : undefined,
  };
}

export type RestoreOutcome = 'restored' | 'nothing' | 'user-changed' | 'no-shared';

/** 시작 전 적용 상태로 되돌린다(규칙은 파일 머리). 호출부가 MobX action 안에서 부른다. */
export function restoreAppliedCharacter(point: AppliedCharacterRestorePoint): RestoreOutcome {
  if (point.lastApplied === undefined) return 'nothing';
  const shared = point.session.presetShareds.get(point.workflowType);
  if (!shared) return 'no-shared';
  if (shared._appliedPresetName !== point.lastApplied) return 'user-changed';
  for (const key of CYCLING_CHARACTER_LIST_KEYS) {
    const current: unknown[] = Array.isArray(shared[key]) ? shared[key] : [];
    const next = current.filter((x) => !isPresetItem(x));
    for (const { index, item } of point.lists[key]) {
      next.splice(Math.max(0, Math.min(index, next.length)), 0, item);
    }
    shared[key] = next;
  }
  shared._appliedPresetName =
    typeof point.appliedPresetName === 'string' ? point.appliedPresetName : '';
  return 'restored';
}
