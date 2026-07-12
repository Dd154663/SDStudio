// companionSlots — 프리셋 에디터 "호스트 행" 옆 전역 툴바 버튼 슬롯 해석 (L3-1)
//
// 목적: 프리셋 에디터의 지정 "호스트 행"(예: '캐릭터 프롬프트 열기' 버튼) 옆에
//   portable(전역) 툴바 버튼(예: '캐릭터 프리셋 관리')을 붙이는 동반 슬롯의 계약과
//   해석을 담는다. 호스트는 flex-1 로 축소해 아이콘 버튼 자리를 내주는 배치인데,
//   실제 렌더 배선(PreSetEdtior.tsx)은 다음 단계(L3-2), ConfigScreen 편집 UI 는
//   L3-3 — 이 모듈은 계약(화이트리스트)·순수 해석만 한다. 렌더러는 이번엔 무변경.
//
// 두 종류의 키 계약(둘 다 배포 후 불변):
//   · hostKey  = L1 요소 키 계약(wfiElementKey, WorkFlow.ts)과 동일한 안정 키.
//               예: 'characterPrompts' 는 캐릭터 프롬프트 인라인 필드의 필드 키.
//   · 버튼 id  = uiLayout.ts 의 portable 버튼 id(예: 'character-presets').
//               portable=true 인 문맥 독립 버튼만 슬롯에 실을 수 있다(공유 JSX 존재).
//
// stale/비허용 무시 방침: 사용자 설정(config.uiCompanionSlots)이나 화이트리스트가
//   개명·제거로 어긋나도, 해석은 화이트리스트에 없는 hostKey·허용 목록 밖 버튼 id 를
//   조용히 버린다 → 저장 설정이 낡아도 결과는 항상 "허용된 것들의 부분집합"이라
//   롤백/전방호환이 안전하다(uiToolbar·uiPresetLayout 과 동일한 계약).

/**
 * COMPANION_HOST_WHITELIST — 어떤 호스트 행에 어떤 portable 버튼을 붙일 수 있는지의
 *   단일 출처(화이트리스트). 자유 배치가 아니라 합의된 조합만 허용한다(확대는 사용자
 *   판단 후 이 상수에 항목을 추가). 1차 = 캐릭터 프롬프트 행 옆 '캐릭터 프리셋 관리' 1건.
 *
 * 키 = hostKey(wfiElementKey 안정 키), 값 = 허용 버튼 id 목록(uiLayout portable id).
 * 둘 다 배포 후 불변 계약.
 */
export const COMPANION_HOST_WHITELIST: Record<string, string[]> = {
  characterPrompts: ['character-presets'],
};

/**
 * resolveCompanionButtons — hostKey + 사용자 설정 → 실제로 붙일 버튼 id 목록(순수 함수).
 *
 * 규칙:
 *   ① slots 미설정 또는 해당 hostKey 항목 없음 → 빈 배열(= 슬롯 없음 = 현행 렌더).
 *   ② 화이트리스트에 없는 hostKey → 빈 배열(허용되지 않은 호스트).
 *   ③ 결과는 화이트리스트 허용 목록에 있는 id 만 채택하되, 순서는 slots 배열 순서를
 *      따르고, 중복은 제거하며, stale·비허용 id 는 조용히 무시한다.
 */
export function resolveCompanionButtons(
  hostKey: string,
  slots?: Record<string, string[]>,
): string[] {
  // ② 화이트리스트에 없는 hostKey 는 애초에 슬롯 대상이 아니다.
  const allowed = COMPANION_HOST_WHITELIST[hostKey];
  if (!allowed) return [];

  // ① 사용자 설정이 없거나 이 hostKey 에 대한 배열이 없으면 슬롯 없음.
  const requested = slots?.[hostKey];
  if (!requested || requested.length === 0) return [];

  // ③ slots 순서를 유지하며 허용 목록에 있는 id 만, 중복 제거해 채택.
  const allowSet = new Set(allowed);
  const result: string[] = [];
  const placed = new Set<string>();
  for (const id of requested) {
    if (!allowSet.has(id)) continue; // 비허용·stale 조용히 무시
    if (placed.has(id)) continue; // 중복 제거
    result.push(id);
    placed.add(id);
  }
  return result;
}
