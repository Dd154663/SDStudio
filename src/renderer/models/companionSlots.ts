// companionSlots — 프리셋 에디터 "호스트 행" 옆 전역 툴바 버튼 슬롯 해석 (L3-1 → E2 확대)
//
// 목적: 프리셋 에디터의 지정 "호스트 행"(예: '캐릭터 프롬프트 열기' 버튼) 옆에
//   portable(전역) 툴바 버튼(예: '캐릭터 프리셋 관리')을 붙이는 동반 슬롯의 계약과
//   해석을 담는다. 호스트는 flex-1 로 축소해 아이콘 버튼 자리를 내주는 배치다.
//   렌더 배선은 PreSetEdtior/VibeEditor/CharacterReferenceEditor, 편집 UI 는 ConfigScreen.
//
// 두 종류의 키 계약(둘 다 배포 후 불변):
//   · hostKey  = L1 요소 키 계약(wfiElementKey, WorkFlow.ts)과 동일한 안정 키.
//               인라인 요소는 데이터 필드명, 그룹은 명시 id.
//               예: 'characterPrompts'·'vibes'·'characterReferences'(인라인 필드 키),
//               'sampling-group'(WFIGroup 의 명시 id).
//   · 버튼 id  = uiLayout.ts 의 portable 버튼 id(예: 'character-presets').
//               portable=true 인 문맥 독립 버튼만 슬롯에 실을 수 있다(공유 JSX 존재).
//
// stale/비허용 무시 방침: 사용자 설정(config.uiCompanionSlots)이 개명·제거로 어긋나도,
//   해석은 호스트 목록에 없는 hostKey·풀(=portable 전체) 밖 버튼 id 를 조용히 버린다
//   → 저장 설정이 낡아도 결과는 항상 "허용된 것들의 부분집합"이라 롤백/전방호환이
//   안전하다(uiToolbar·uiPresetLayout 과 동일한 계약).
//
// 유일성(이동 의미론): 한 버튼은 최대 한 호스트에만 붙는다. 여러 호스트가 같은 id 를
//   요청하면 COMPANION_HOSTS 순서상 "먼저 오는 호스트"가 소유한다(first-host-wins).
//   슬롯에 배정된 버튼은 파생적으로 툴바 표면에서 사라진다(소비자가 companionAssignedIds
//   를 resolveToolbarView 제외 집합으로 전달 — uiToolbar 데이터 자체는 불변).

import { portableButtonIds } from './uiLayout';

/**
 * COMPANION_HOSTS — 동반 슬롯을 붙일 수 있는 "호스트 행"의 hostKey 목록(단일 출처).
 *   자유 배치가 아니라 합의된 호스트만 허용한다(확대는 이 배열에 hostKey 추가로 끝).
 *   순서는 유일성(first-host-wins) 해석의 기준이므로 의미가 있다.
 *
 * 허용 버튼 풀 = portable 전체(uiLayout portableButtonIds). 호스트별 화이트리스트가
 *   아니라 "어느 호스트든 portable 아무거나" 실을 수 있고, 유일성으로 한 버튼=한 곳을 보장.
 */
export const COMPANION_HOSTS: string[] = [
  'characterPrompts',
  'vibes',
  'characterReferences',
  'sampling-group',
];

/**
 * COMPANION_HOST_LABELS — 호스트 hostKey → 한국어 표시명(단일 출처). 편집 UI(ConfigScreen
 *   E3·향후 E4)가 "위치 선택" 라벨에 참조한다. COMPANION_HOSTS 와 같은 키 집합을 덮는다.
 */
export const COMPANION_HOST_LABELS: Record<string, string> = {
  characterPrompts: '캐릭터 프롬프트 행',
  vibes: '바이브 설정 행',
  characterReferences: '캐릭터 레퍼런스 행',
  'sampling-group': '샘플링/모델 설정 행',
};

/**
 * resolveAssignment — 사용자 설정 → id별 소유 호스트(first-host-wins) 맵(내부 헬퍼).
 *
 * COMPANION_HOSTS 순서대로 훑으며 각 버튼 id 를 처음 요청한 호스트에 귀속시킨다.
 * 풀(portable) 밖·stale id 는 귀속하지 않고(=조용히 버림), 이미 앞선 호스트가 소유한
 * id 는 무시(유일성). 이 맵이 resolveCompanionButtons·companionAssignedIds 의 단일 근거.
 */
function resolveAssignment(slots?: Record<string, string[]>): Map<string, string> {
  const pool = new Set(portableButtonIds());
  const owner = new Map<string, string>();
  for (const host of COMPANION_HOSTS) {
    const requested = slots?.[host];
    if (!requested) continue;
    for (const id of requested) {
      if (!pool.has(id)) continue; // 비portable·stale → 귀속 안 함
      if (owner.has(id)) continue; // 앞선 호스트가 이미 소유(유일성)
      owner.set(id, host);
    }
  }
  return owner;
}

/**
 * resolveCompanionButtons — hostKey + 사용자 설정 → 이 호스트에 붙일 버튼 id 목록(순수).
 *
 * 규칙:
 *   ① 호스트 목록(COMPANION_HOSTS)에 없는 hostKey → 빈 배열(슬롯 대상 아님).
 *   ② slots 미설정·항목 없음·빈 배열 → 빈 배열(= 슬롯 없음 = 현행 렌더).
 *   ③ 이 호스트가 실제로 "소유"한 id 만 채택 — 풀(portable) 밖·stale·유일성으로
 *      앞선 호스트에 뺏긴 id 는 제외. 순서는 slots 배열 순서, 중복은 제거.
 */
export function resolveCompanionButtons(
  hostKey: string,
  slots?: Record<string, string[]>,
): string[] {
  if (!COMPANION_HOSTS.includes(hostKey)) return []; // ①
  const requested = slots?.[hostKey];
  if (!requested || requested.length === 0) return []; // ②
  const owner = resolveAssignment(slots);
  const result: string[] = [];
  const placed = new Set<string>();
  for (const id of requested) {
    if (owner.get(id) !== hostKey) continue; // ③ 이 호스트 소유분만(풀·유일성·stale 반영)
    if (placed.has(id)) continue; // 중복 제거
    result.push(id);
    placed.add(id);
  }
  return result;
}

/**
 * companionAssignedIds — 모든 호스트에 배정된(=슬롯에 사는) 버튼 id 집합(유일성 반영).
 *   툴바 파생 숨김(이동 의미론)의 제외 집합으로 소비자가 resolveToolbarView 에 넘긴다.
 *   풀 밖·stale·중복은 이미 걸러진 상태.
 */
export function companionAssignedIds(
  slots?: Record<string, string[]>,
): Set<string> {
  return new Set(resolveAssignment(slots).keys());
}

/**
 * companionOwnerOf — buttonId 를 현재 소유한 호스트 hostKey(배정 없으면 undefined).
 *   편집 UI 가 각 버튼의 "현재 위치"를 판독하는 조회 헬퍼 — resolveAssignment 를 재사용하므로
 *   유일성(first-host-wins)·풀(portable)·stale 필터가 그대로 반영된다.
 */
export function companionOwnerOf(
  buttonId: string,
  slots?: Record<string, string[]>,
): string | undefined {
  return resolveAssignment(slots).get(buttonId);
}

// 빈 배열 호스트를 정리(빈 객체 = 슬롯 없음 의미 유지). assign/remove 공용.
function pruneEmpty(obj: Record<string, string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v.length > 0) out[k] = v;
  }
  return out;
}

/**
 * assignCompanionAt — buttonId 를 hostKey 호스트의 "지정 위치"에 배정(순수, 원본 불변).
 *   이동 의미론(먼저 모든 호스트에서 제거)은 assignCompanion 과 동일하되, anchor 로 대상
 *   호스트 배열 내 삽입 위치를 지정한다:
 *     · anchor 없음        = 끝에 추가(= assignCompanion 과 동일 결과).
 *     · anchor={id, side}  = 대상 호스트 배열에서 그 버튼 앞(before)/뒤(after)에 삽입.
 *   슬롯 내 순서 조정(같은 호스트 재배열)과 다른 호스트로의 "위치 지정 재배정"을 한 함수로
 *   처리한다(E4 드래그). anchor 버튼이 대상 호스트에 없으면(또는 자기 자신이면) 끝에 붙인다.
 *   제거를 먼저 하므로 같은 호스트 내 이동도 오프셋 문제 없이 정확하다. 영속은 호출부.
 */
export function assignCompanionAt(
  slots: Record<string, string[]> | undefined,
  hostKey: string,
  buttonId: string,
  anchor?: { id: string; side: 'before' | 'after' },
): Record<string, string[]> {
  const next: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(slots ?? {})) {
    next[k] = v.filter((id) => id !== buttonId); // 전 호스트에서 제거
  }
  const cur = next[hostKey] ? [...next[hostKey]] : [];
  let idx = cur.length; // 기본 = 끝
  if (anchor && anchor.id !== buttonId) {
    const at = cur.indexOf(anchor.id);
    if (at !== -1) idx = anchor.side === 'before' ? at : at + 1;
  }
  cur.splice(idx, 0, buttonId);
  next[hostKey] = cur;
  return pruneEmpty(next);
}

/**
 * assignCompanion — buttonId 를 hostKey 호스트 끝에 배정(순수, 원본 불변). 이동 의미론:
 *   먼저 모든 호스트에서 그 id 를 제거한 뒤 대상 호스트 끝에 추가한다(라스트 윈 —
 *   같은 버튼을 다른 호스트로 옮기면 이전 자리에서 사라짐). anchor 없는 assignCompanionAt
 *   위임(끝 삽입). 영속은 호출부(ConfigScreen/E4).
 */
export function assignCompanion(
  slots: Record<string, string[]> | undefined,
  hostKey: string,
  buttonId: string,
): Record<string, string[]> {
  return assignCompanionAt(slots, hostKey, buttonId);
}

/**
 * removeCompanion — buttonId 를 전 호스트에서 제거(순수, 원본 불변). 슬롯에서 빼면
 *   그 버튼은 다시 툴바 원래 자리로 복귀한다(파생 숨김 해제). 영속은 호출부.
 */
export function removeCompanion(
  slots: Record<string, string[]> | undefined,
  buttonId: string,
): Record<string, string[]> {
  const next: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(slots ?? {})) {
    next[k] = v.filter((id) => id !== buttonId);
  }
  return pruneEmpty(next);
}
