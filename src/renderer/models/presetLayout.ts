// presetLayout — 프리셋 에디터 요소 순서 사용자 오버라이드 해석 (L1-2)
//
// 목적: 워크플로우 UI 최상위 스택의 "정의 순서" 위에 사용자별 순서 오버라이드
//   (config.uiPresetLayout[workflowType])를 얹어 최종 렌더 순서를 결정한다.
//   렌더 배선(PreSetEdtior.tsx)은 다음 단계(L1-3) — 이 모듈은 순수 해석만 한다.
//
// 키 불변 계약: 오버라이드 배열의 원소는 wfiElementKey(workflows/WorkFlow.ts)가
//   반환하는 안정 키다. 요소의 id/field 는 배포 후 변경 금지 — 바뀌면 저장된 순서
//   설정이 stale 가 되어 조용히 무시된다(uiToolbar 버튼 id 와 동일한 계약).
//
// stale 무시 방침: 오버라이드에 있으나 현재 정의에 없는 키(요소 제거·개명)는 조용히
//   버린다. 정의에 있으나 오버라이드에 없는 키(새 요소·오버라이드 저장 이후 추가)는
//   "정의 위치"에 삽입한다 → 어떤 오버라이드가 저장돼 있어도 결과는 항상 정의 키의
//   순열(누락·중복 없음)이라 롤백/전방호환이 안전하다.
//
// 슬롯 키 계약(uiPresetLayout 맵의 키, L1-3): 워크플로우 editor 루트 스택 =
//   workflowType 그대로(예: 'SDImageGen'), innerEditor 루트 스택 =
//   `${workflowType}@inner`(예: 'SDImageGenEasy@inner'). 한 워크플로우의 editor 와
//   innerEditor 안에서 최상위 요소 키가 서로 겹칠 수 있어(middle-prompt 등) 맵 키로
//   구분한다. 이 슬롯 키 생성은 presetLayoutSlotKey 가 단일 출처다.

import {
  WFIElement,
  WFIStack,
  WFIInlineInput,
  WFIGroup,
  WFIMiddlePlaceholderInput,
  WFIExtraPromptInput,
  WFIIfIn,
  WFISceneOnly,
  wfiElementKey,
} from './workflows/WorkFlow';

/**
 * presetLayoutSlotKey — uiPresetLayout 맵의 슬롯 키(단일 출처).
 *
 * 위 "슬롯 키 계약" 참조: inner=false → workflowType, inner=true → `${workflowType}@inner`.
 * editor/innerEditor 는 요소 키가 겹칠 수 있으므로 반드시 이 함수로 맵 키를 구분한다.
 */
export function presetLayoutSlotKey(
  workflowType: string,
  inner: boolean,
): string {
  return inner ? `${workflowType}@inner` : workflowType;
}

/**
 * resolvePresetOrder — 정의 순서 + 사용자 오버라이드 → 최종 렌더 순서(순수 함수)
 *
 * 규칙:
 *   ① override 없음/빈 배열 → definitionKeys 그대로(현행 100% 동일 = 회귀 기준).
 *   ② override 는 definitionKeys 에 존재하는 키만 유효 — stale 키는 조용히 무시.
 *   ③ definitionKeys 에 있는데 override 에 없는 "신규" 키는 정의 위치에 삽입:
 *      정의 순서상 그 키보다 앞선 요소들 중 결과에 이미 들어간 가장 가까운 키 뒤에
 *      넣고, 앞선 키가 하나도 없으면 맨 앞에 둔다.
 *   ④ 반환 배열은 definitionKeys 의 순열(누락·중복 없음)이다.
 *
 * 예시:
 *   def=[a,b,c], override=[c,a]        → [c,a,b]
 *   def=[x,a,b], override=[b,a]        → [x,b,a]
 *   def=[a,b],   override=[b,zombie,a] → [b,a]
 */
export function resolvePresetOrder(
  definitionKeys: string[],
  override?: string[],
): string[] {
  // ① 오버라이드가 없거나 비어 있으면 정의 순서 그대로(회귀 기준).
  if (!override || override.length === 0) return definitionKeys.slice();

  const defSet = new Set(definitionKeys);
  // ② 유효(정의에 존재)한 오버라이드 키만, 중복 제거하며 순서대로 채택.
  const result: string[] = [];
  const placed = new Set<string>();
  for (const key of override) {
    if (defSet.has(key) && !placed.has(key)) {
      result.push(key);
      placed.add(key);
    }
  }

  // ③ 오버라이드에 빠진 신규 키를 정의 순서로 훑으며 "정의 위치"에 삽입한다.
  //    lastPlacedIdx = 지금까지 훑은 정의 키 중 결과에 이미 들어간 가장 최근 위치.
  //    신규 키는 그 뒤(없으면 맨 앞)에 넣고, 이어지는 신규 키는 방금 넣은 것 뒤에.
  let insertPos = 0; // "맨 앞" 기준 삽입 위치
  for (const key of definitionKeys) {
    if (placed.has(key)) {
      // 이미 배치된 키 — 다음 신규 키의 삽입 기준을 이 키 바로 뒤로 옮긴다.
      insertPos = result.indexOf(key) + 1;
    } else {
      // 신규 키 — 현재 기준 위치에 삽입하고, 기준을 방금 넣은 것 뒤로 전진.
      result.splice(insertPos, 0, key);
      placed.add(key);
      insertPos += 1;
    }
  }

  return result;
}

/**
 * presetStackKeys — 최상위 요소들의 wfiElementKey 목록.
 *
 * L1-1 가드(workflowElementKey.test.ts)가 "최상위 요소는 모두 non-empty 키를
 * 가진다"를 보장하므로 정상 스택에서 undefined 는 나오지 않지만, 방어적으로 걸러낸다.
 */
export function presetStackKeys(stack: WFIStack): string[] {
  return stack.inputs
    .map((el: WFIElement) => wfiElementKey(el))
    .filter((k): k is string => typeof k === 'string' && k.length > 0);
}

/**
 * resolveStackInputs — 워크플로우 UI "루트 스택"의 최상위 요소를 사용자 오버라이드
 *   순서로 재배열한 요소 배열을 반환한다(렌더 배선 L1-3의 단일 출처).
 *
 * 재배열 대상은 넘겨받은 루트 스택의 최상위 요소뿐이다 — 중첩 스택/그룹 내부는 절대
 *   건드리지 않는다(호출부가 루트 스택만 넘긴다). 순서 결정 로직을 렌더 컴포넌트 밖
 *   순수 함수로 둬 단위 테스트로 회귀를 봉인한다.
 *
 * 규칙:
 *   ① override 없음/빈 배열 → stack.inputs 를 "동일 참조 그대로" 반환한다.
 *      → 오버라이드 없는 모든 사용자에게 현행 렌더 결과 100% 동일(절대 회귀 기준).
 *   ② 키 없는 요소 방어(계약 3): 최상위 요소 중 wfiElementKey 가 undefined 인 요소가
 *      하나라도 있으면(L1-1 가드가 막지만 방어적으로) 순서 적용을 통째로 포기하고
 *      정의 순서(stack.inputs 동일 참조)로 반환한다. 부분 재배열로 키 없는 요소를
 *      누락·오배치할 위험을 원천 차단하는 편이 안전하다는 방침.
 *   ③ 그 외에는 resolvePresetOrder 로 키 순서를 해석하고 키→요소 매핑으로 재배열한다.
 *      resolvePresetOrder 결과가 키의 순열이므로 반환도 stack.inputs 의 순열(누락·중복 없음)이다.
 */
/**
 * PRESET_LAYOUT_ANCHOR_KEYS — 최상단 고정(드래그·상단 드롭 불가) 요소 키 목록(단일 출처, L1-4).
 *
 * 프리셋/프로필 선택기는 에디터의 정체성 컨트롤이라 항상 맨 위에 있어야 한다. 편집모드
 * 세로 드래그는 이 키들을 드래그 대상에서 제외하고, 이동 삽입 인덱스가 이 앵커들 앞이
 * 되지 않도록 클램프한다(movePresetOrder). 키는 wfiElementKey 계약(배포 후 불변)을 따른다.
 */
export const PRESET_LAYOUT_ANCHOR_KEYS: readonly string[] = [
  'preset-select', // SDImageGenUI 프리셋 선택
  'profile-preset-select', // SDImageGenEasyUI 프로필 프리셋 선택
];

/**
 * movePresetOrder — 전체 키 순서 배열에서 fromKey 를 빼 toIndex 에 끼운 새 배열(순수 함수, L1-4).
 *
 * 편집모드 세로 드래그의 이동 계산 단일 출처. 입력 order 는 "루트 스택 전체 키"(앵커 포함,
 * presetStackKeys/현재 렌더 순서)이고, toIndex 는 "fromKey 제거 후 배열" 기준 삽입 위치다.
 * 저장 값은 반환 배열 그대로(resolveStackInputs 가 소비하는 형식) — 안 보이는 키도 상대
 * 위치가 유지된다(전체 배열 내 이동이므로).
 *
 * 규칙:
 *   ① fromKey 가 앵커면 이동 무시(원본의 새 복사본 반환) — 앵커는 고정.
 *   ② fromKey 가 order 에 없으면 무시(방어, 새 복사본 반환).
 *   ③ 삽입 하한 = 선두 고정 앵커 개수. toIndex 가 그보다 작으면 앵커 바로 뒤로 클램프
 *      (앵커 앞 삽입 금지). 상한 = 배열 길이.
 */
export function movePresetOrder(
  order: string[],
  fromKey: string,
  toIndex: number,
  anchorKeys: readonly string[] = PRESET_LAYOUT_ANCHOR_KEYS,
): string[] {
  // ① 앵커는 이동 불가.
  if (anchorKeys.includes(fromKey)) return order.slice();
  // ② 없는 키 방어.
  const from = order.indexOf(fromKey);
  if (from === -1) return order.slice();

  const without = order.slice();
  without.splice(from, 1);

  // ③ 선두 고정 앵커 개수만큼 삽입 하한을 올려 앵커 앞으로는 못 들어가게 클램프.
  let floor = 0;
  while (floor < without.length && anchorKeys.includes(without[floor])) floor += 1;
  const clamped = Math.max(floor, Math.min(toIndex, without.length));
  without.splice(clamped, 0, fromKey);
  return without;
}

/**
 * presetRowLabel — 편집모드 세로 드래그 행의 표시 라벨(순수 함수, L1-4 버그수정).
 *
 * 편집모드에서 콘텐츠가 비어 "자리표시 칩"으로 렌더되는 행에 붙일, 사람이 읽을 이름을
 * 고른다. ifIn/sceneOnly 래퍼는 내부 요소로 폴백(presetRowGrows·wfiElementKey 와 동일
 * 계약). label 을 가진 타입(inline/group/middlePlaceholder)은 그 label 을, 없으면 안정
 * 키 문자열(wfiElementKey)로, 그마저 없으면 타입명으로 폴백한다.
 */
export function presetRowLabel(el: WFIElement): string {
  // ifIn/sceneOnly 는 껍데기 — 내부 요소의 라벨을 쓴다.
  let cur: WFIElement = el;
  while (cur.type === 'ifIn' || cur.type === 'sceneOnly') {
    cur = (cur as WFIIfIn | WFISceneOnly).element;
  }
  if (
    cur.type === 'inline' ||
    cur.type === 'group' ||
    cur.type === 'middlePlaceholder' ||
    cur.type === 'extraPrompt'
  ) {
    const label = (
      cur as
        | WFIInlineInput
        | WFIGroup
        | WFIMiddlePlaceholderInput
        | WFIExtraPromptInput
    ).label;
    if (label && label.length > 0) return label;
  }
  // 라벨 없는 타입은 안정 키 문자열 폴백(그래도 없으면 타입명).
  return wfiElementKey(cur) ?? cur.type;
}

export function resolveStackInputs(
  stack: WFIStack,
  override?: string[],
): WFIElement[] {
  // ① 오버라이드 없음 → 원본 배열 동일 참조 그대로(회귀 기준).
  if (!override || override.length === 0) return stack.inputs;

  // ② 키 없는 최상위 요소가 하나라도 있으면 순서 적용 포기(정의 순서 폴백).
  const keys = stack.inputs.map((el) => wfiElementKey(el));
  const allKeyed = keys.every(
    (k): k is string => typeof k === 'string' && k.length > 0,
  );
  if (!allKeyed) return stack.inputs;

  // ③ 키→요소 매핑으로 재배열(가드가 키 유일성을 보장 — 겹치면 매핑이 마지막 값을 취함).
  const byKey = new Map<string, WFIElement>();
  stack.inputs.forEach((el, i) => byKey.set(keys[i] as string, el));
  const ordered = resolvePresetOrder(keys as string[], override);
  return ordered.map((k) => byKey.get(k) as WFIElement);
}
