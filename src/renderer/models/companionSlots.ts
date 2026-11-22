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

import type { UiToolbarConfig } from '../../main/config';
import {
  insertToolbarFollowers,
  portableButtonIds,
  TOOLBAR_FOLLOWERS,
} from './uiLayout';

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
  // ④ 호스트 확대(2026-07-18): 사전세팅선택 행(PreSetSelect). 작업모드 행은 레거시
  // 토글에서만 렌더되는 조건부 행이라 제외 — 배정 버튼이 파생 숨김으로 툴바에서도
  // 빠지는데 호스트 행마저 없으면 버튼이 양쪽에서 사라지므로 호스트 부적합.
  'preset-select',
  // ② A 모던 사이드바(2026-07-18): 사전세팅선택 행 "위"의 독립 동반 행(프리셋 패널
  // 최상단). 실제 행이 없어도 배정이 있으면 렌더되는 전용 행(PresetTopCompanionRow,
  // PreSetEdtior.tsx)이라 조건부 행 함정이 없다. 모던 기본 배치의 수용처.
  'preset-top',
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
  'preset-select': '사전세팅선택 행',
  'preset-top': '사전세팅선택 위 행',
};

/**
 * MODERN_COMPANION_DEFAULTS — 모던 사이드바('modern' 템플릿) 적용 시 강제되는 동반 슬롯
 *   기본 배치(② A 스펙, 2026-07-18 사용자 확정). 템플릿 저장 전환 시 ConfigScreen 이
 *   uiToolbar 초기화와 함께 이 값을 uiCompanionSlots 로 깐다(이후 재커스텀 자유).
 *   - backup-import·backup-export·project-trash·delete-session·piece-editor → 사전세팅선택 위 행
 *     (구 "작업모드 행 옆" 대체. delete-session 도 "프로젝트 전체" 액션이라 사전세팅선택
 *     행이 아닌 상단부로 — 2026-07-18 실기 피드백 2로 2026-07-13 결정 대체)
 *   - character-presets → 캐릭터 프롬프트 행 (하단 아이콘 행과 결합 시 5종 정렬)
 *   - scene-template → 사전세팅선택 위 행 (씬 템플릿 개편 2026-07-18 — 프로젝트 바
 *     승격 버튼인데 모던은 툴바 미렌더라 여기 없으면 퀵 메뉴 외 진입점이 사라진다)
 *   - add-session·project-browser 는 미배정 — 모던에선 툴바 미렌더로 미노출, 드로어가 흡수.
 */
export const MODERN_COMPANION_DEFAULTS: Record<string, string[]> = {
  'preset-top': [
    'backup-import', // 2026-11-19 백업 메뉴 분할 — 내보내기(backup-export) 바로 앞
    'backup-export',
    'project-trash',
    'delete-session',
    'scene-template',
    'piece-editor',
  ],
  characterPrompts: ['character-presets'],
};

/**
 * 따라가는 버튼(2026-11-19 백업 메뉴 분할, uiLayout TOOLBAR_FOLLOWERS) — 저장된 슬롯이 새 버튼(backup-import)을
 *   한 번도 적지 않았으면 짝(backup-export)이 있는 호스트마다 그 바로 앞에 함께 놓인 것으로 읽는다(가상 적용, 저장 불변 —
 *   구버전은 풀 밖 id 라 무시). 짝과 함께 툴바에서 빠지므로 모던 사이드바처럼 툴바가 없는 배치에서도 불러오기가 남는다.
 *   사용자가 슬롯에서 그 버튼만 빼면(removeCompanion) 이 키 아래에 적어 두어 다시 따라가지 않게 한다.
 *   이 키는 호스트가 아니라 해석(COMPANION_HOSTS 만 훑음)·구버전 모두 무시한다.
 */
export const COMPANION_KEPT_IN_TOOLBAR_KEY = '_toolbar';

function followerMentioned(slots: Record<string, string[]>, id: string): boolean {
  return Object.values(slots).some((ids) => Array.isArray(ids) && ids.includes(id));
}

/** 저장된 슬롯 → 따라가기를 적용한 슬롯(순수, 원본 불변). 적용할 것이 없으면 입력 그대로. */
export function withCompanionFollowers(
  slots?: Record<string, string[]>,
): Record<string, string[]> | undefined {
  if (!slots) return slots;
  const pending = TOOLBAR_FOLLOWERS.filter(({ id }) => !followerMentioned(slots, id));
  if (pending.length === 0) return slots;
  const skip = (id: string) => !pending.some((f) => f.id === id);
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(slots)) {
    out[k] =
      COMPANION_HOSTS.includes(k) && Array.isArray(v)
        ? insertToolbarFollowers(v, skip)
        : v;
  }
  return out;
}

/**
 * PC 기본 동반 배치(2026-11-22 사용자 결정) — 저장된 배치가 이 버튼을 한 번도 적지 않았으면 이 호스트 끝에 놓인 것으로
 *   읽는다(가상 적용, 저장 불변 — 따라가는 버튼과 같은 방식). 프롬프트조각은 맨 아래 툴바 대신 사전세팅선택 행이 기본 자리.
 *   「적은 적 있음」 = 동반 슬롯 어느 키(툴바 유지 표 COMPANION_KEPT_IN_TOOLBAR_KEY 포함)에 있거나, 툴바에서 그 버튼을
 *   직접 옮겨 uiToolbar.buttons 에 자리가 적혀 있음(moveToolbarButton 은 옮긴 버튼만 buttons 에 적는다).
 *   적용하지 않는 경우(종전 그대로): 모바일(클래식·V2 — 슬롯을 쓰지 않음) · 모던 사이드바(템플릿 기본 배치
 *   MODERN_COMPANION_DEFAULTS 가 따로 있음) · 클래식 툴바(「이전 배치로 되돌리기」) · 레거시 작업모드(이지 모드 등
 *   사전세팅선택 행이 없는 작업모드가 있어 툴바에서 빠지면 버튼이 양쪽에서 사라진다 — 작업모드 행을 호스트에서 뺀 이유와 같음) ·
 *   프리셋 패널을 접어 둔 동안(presetPanelHidden — 호스트 행이 화면에 없다. 펴면 다시 행으로).
 *   저장: 해석 단계의 가상 적용일 뿐 편집 함수(assign/removeCompanion)의 입력은 저장값이다 — 다른 버튼을 옮겨도 기본 배치는
 *   저장에 옮겨 적히지 않고, 그 버튼 자체를 옮길 때만 적힌다(removeCompanion 은 툴바 유지 표에). 구버전은 저장이 그대로라 무영향.
 */
export const COMPANION_DEFAULT_PLACEMENTS: readonly { id: string; host: string }[] = [
  { id: 'piece-editor', host: 'preset-select' },
];

export interface CompanionDefaultContext {
  isMobile: boolean;
  template?: string;
  toolbar?: UiToolbarConfig;
  legacyWorkflowMode?: boolean;
  presetPanelHidden?: boolean;
}

/** 기본 동반 배치가 적용되는 환경인지(버튼별 「적은 적 있음」 판정 전 단계). */
export function companionDefaultsActive(ctx: CompanionDefaultContext): boolean {
  return (
    !ctx.isMobile &&
    ctx.template !== 'modern' &&
    !ctx.toolbar?.classic &&
    !ctx.legacyWorkflowMode &&
    !ctx.presetPanelHidden
  );
}

/** 저장된 슬롯 → 기본 동반 배치를 적용한 슬롯(순수, 원본 불변). 적용할 것이 없으면 입력 그대로. */
export function withCompanionDefaults(
  slots: Record<string, string[]> | undefined,
  ctx: CompanionDefaultContext,
): Record<string, string[]> | undefined {
  if (!companionDefaultsActive(ctx)) return slots;
  const pending = COMPANION_DEFAULT_PLACEMENTS.filter(
    ({ id }) =>
      !followerMentioned(slots ?? {}, id) && ctx.toolbar?.buttons?.[id] === undefined,
  );
  if (pending.length === 0) return slots;
  const out: Record<string, string[]> = { ...(slots ?? {}) };
  for (const { id, host } of pending) {
    out[host] = [...(out[host] ?? []), id];
  }
  return out;
}

/**
 * resolveAssignment — 사용자 설정 → id별 소유 호스트(first-host-wins) 맵(내부 헬퍼).
 *
 * COMPANION_HOSTS 순서대로 훑으며 각 버튼 id 를 처음 요청한 호스트에 귀속시킨다.
 * 풀(portable) 밖·stale id 는 귀속하지 않고(=조용히 버림), 이미 앞선 호스트가 소유한
 * id 는 무시(유일성). 이 맵이 resolveCompanionButtons·companionAssignedIds 의 단일 근거.
 */
function resolveAssignment(savedSlots?: Record<string, string[]>): Map<string, string> {
  const slots = withCompanionFollowers(savedSlots);
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
  const requested = withCompanionFollowers(slots)?.[hostKey]; // 따라가는 버튼 포함
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
  // 따라가는 버튼은 보이던 자리 그대로 저장에 옮겨 적은 뒤 편집한다(편집 뒤에도 화면이 같게).
  // 툴바 유지 표(COMPANION_KEPT_IN_TOOLBAR_KEY)에서도 함께 빠진다(전 키에서 제거).
  for (const [k, v] of Object.entries(withCompanionFollowers(slots) ?? {})) {
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
  for (const [k, v] of Object.entries(withCompanionFollowers(slots) ?? {})) {
    next[k] = v.filter((id) => id !== buttonId);
  }
  // 따라가는 버튼만 빼면 짝을 다시 따라가지 않도록 툴바 유지 표에 적어 둔다(짝이 슬롯에 남아 있을 때만 — 아니면 따라갈 곳이 없다).
  const follower = TOOLBAR_FOLLOWERS.find((f) => f.id === buttonId);
  const leaderInSlot =
    !!follower &&
    COMPANION_HOSTS.some((h) => (next[h] ?? []).includes(follower.leader));
  // 기본 동반 배치 버튼(프롬프트조각)도 빼면 툴바 유지 표에 적는다 — 적지 않으면 「한 번도 적지 않음」으로 읽혀 기본 자리로 되돌아간다.
  const hasDefaultPlacement = COMPANION_DEFAULT_PLACEMENTS.some((d) => d.id === buttonId);
  if (
    (leaderInSlot || hasDefaultPlacement) &&
    !(next[COMPANION_KEPT_IN_TOOLBAR_KEY] ?? []).includes(buttonId)
  ) {
    next[COMPANION_KEPT_IN_TOOLBAR_KEY] = [
      ...(next[COMPANION_KEPT_IN_TOOLBAR_KEY] ?? []),
      buttonId,
    ];
  }
  return pruneEmpty(next);
}
