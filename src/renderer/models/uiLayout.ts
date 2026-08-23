// UI 구성 커스터마이징(순서 변경·숨기기·퀵 메뉴)의 기반 레지스트리.
// 화면의 버튼을 "id + 이름" 데이터로 선언한다. id는 사용자 설정(Config)의 저장 키가
// 되므로 한 번 배포된 뒤에는 바꾸지 않는다. 실제 동작(JSX)은 각 컴포넌트가
// id → 노드 맵으로 바인딩하고, 렌더 순서는 이 레지스트리(+사용자 설정)가 결정한다.

import {
  UiToolbarConfig,
  UiToolbarAreaLayout,
  ToolbarButtonPlacement,
} from '../../main/config';

// 기본 노출 등급: primary=모바일·PC 모두 툴바 인라인 / secondary=PC 는 인라인,
// 모바일은 ⋯ 메뉴 / mobile-primary=모바일은 인라인, PC 는 ⋯ 메뉴(secondary 의 미러) /
// overflow=양쪽 모두 ⋯ 메뉴.
// 증식 차단 규칙: 앞으로 새 기능 버튼은 기본 overflow 로 추가한다(툴바는 더 자라지 않는다).
export type ToolbarTier = 'primary' | 'secondary' | 'mobile-primary' | 'overflow';

export interface ToolbarButtonMeta {
  id: string;
  // 커스터마이징 화면에서 사용자에게 보여줄 이름 (버튼 라벨과 달리 상태에 따라 변하지 않음)
  name: string;
  // PC(데스크톱)에서만 존재하는 버튼 — 모바일 커스터마이징 목록에서 제외용
  pcOnly?: boolean;
  tier: ToolbarTier;
  // 문맥 독립(appState만 의존) 버튼만 — 크로스 영역 이동 허용 표식. 공유 JSX는 PortableToolbarButtons.tsx
  portable?: boolean;
}

// 씬 툴바 (이미지생성/이미지변형 탭 상단) — SceneQueueControl.tsx 가 사용
export const sceneToolbarRegistry: ToolbarButtonMeta[] = [
  { id: 'add-scene', name: '씬 추가', tier: 'primary' },
  { id: 'queue-add', name: '예약 추가', tier: 'primary' },
  { id: 'export-images', name: '이미지 내보내기', tier: 'secondary' },
  { id: 'quick-export', name: '빠른 export', tier: 'primary' },
  { id: 'batch-process', name: '대량 작업', tier: 'primary' },
  { id: 'multi-select', name: '다중 선택', tier: 'primary' },
  { id: 'change-resolution', name: '해상도 변경', tier: 'secondary' },
  // pcOnly 해제(2026-07-18): 모바일도 wasm libwebp 로 일괄 변환 지원(경고+취소 포함)
  { id: 'webp-convert', name: 'WebP 변환', tier: 'overflow' },
  // 모바일 실사용 빈도가 높아 모바일만 인라인 (PC 는 기존대로 ⋯ 메뉴)
  { id: 'import-image', name: '이미지 프롬프트 추출', tier: 'mobile-primary' },
  // B군 승격(퀵 메뉴 P2, 2026-07-18): 로컬 모달 → appState 전역 오버레이 — portable 전환
  { id: 'artist-tag', name: '아티스트 태깅', pcOnly: true, tier: 'overflow', portable: true },
  { id: 'scene-search', name: '씬 검색', tier: 'primary' },
  { id: 'scene-find', name: '씬 찾기', tier: 'overflow' },
  { id: 'image-review', name: '이미지 검수', tier: 'overflow' },
  { id: 'bookmark-jump', name: '북마크된 씬으로 이동', tier: 'secondary' },
  // B군 승격(퀵 메뉴 P2, 2026-07-18): 로컬 모달 → appState 전역 오버레이 — portable 전환
  { id: 'scene-trash', name: '씬 휴지통', tier: 'overflow', portable: true },
  // 'scene-template' 은 씬 템플릿 개편(2026-07-18)으로 프로젝트 바 레지스트리로 이동 —
  // 매크로성 기능 승격(사용자 확정). id 는 그대로라 과거 씬 영역 배치 설정은 조용히 무시됨.
  { id: 'empty-image-trash', name: '삭제 이미지 일괄 비우기', tier: 'overflow', portable: true },
  { id: 'find-replace', name: '찾기 및 변환', tier: 'secondary', portable: true },
  { id: 'shortcut-help', name: '단축키 도움말', pcOnly: true, tier: 'overflow' },
];

// 프로젝트 바 (프로젝트 선택기 옆 버튼들) — SessionSelect.tsx 가 사용.
// 프로젝트 선택기(드로어 버튼·드롭다운)와 그 옆의 '프로젝트 탐색' 버튼은
// 선택기 컨테이너에 고정(정체성 컨트롤 + 모바일 1행 유지)이라 레지스트리 비대상.
// 여기 버튼은 전부 상시 사용 빈도가 높아 기본값 = PC·모바일 모두 전부 인라인
// (⋯ 없음). 메뉴로 보내기는 사용자 커스터마이징 재량 (2026-07-04 실사용 피드백).
export const projectToolbarRegistry: ToolbarButtonMeta[] = [
  // 기존 고정 버튼의 레지스트리 편입(④ 자유 위치, 2026-07-18) — 신규 기능 아님.
  // 선두 배치 = 기존 위치(프로젝트 선택기 옆) 근사 유지.
  { id: 'project-browser', name: '프로젝트 탐색', tier: 'primary', portable: true },
  { id: 'add-session', name: '신규 프로젝트', tier: 'primary', portable: true },
  { id: 'character-presets', name: '캐릭터 프리셋 관리', tier: 'primary', portable: true },
  // 씬 툴바 overflow 에서 이동(씬 템플릿 개편 2026-07-18) — 숨김 템플릿 관리 모달의
  // 주 진입점으로 승격. 프로젝트 바 관례(전부 primary 인라인)를 따른다(§6 overflow
  // 기본 규칙은 "신규 버튼 증식" 차단용 — 이 건은 기존 버튼의 영역 이동+승격 확정).
  { id: 'scene-template', name: '씬 템플릿', tier: 'primary', portable: true },
  { id: 'backup-export', name: '프로젝트 백업/내보내기', tier: 'primary', portable: true },
  { id: 'delete-session', name: '프로젝트 삭제', tier: 'primary', portable: true },
  { id: 'project-trash', name: '프로젝트 휴지통', tier: 'primary', portable: true },
  { id: 'piece-editor', name: '프롬프트조각', tier: 'primary', portable: true },
  // 새 창(멀티 윈도우 W6) — 데스크톱 전용(모바일 미노출). portable 로 크로스 영역 이동 허용.
  { id: 'new-window', name: '새 창', pcOnly: true, tier: 'primary', portable: true },
];

// 모바일 프로젝트 바 상단 행(프로젝트 선택기 옆) 고정 노출 id — 단일 출처(§6 배치
// 하드코딩 금지). 2026-07-18 실기 피드백: 상단 행 남는 폭에 딱 2개가 들어가, 기본
// 배치에서 전 버튼이 가로 스크롤 없이 2줄에 노출된다. SessionSelect(bar variant)가
// 인라인 배치된 id 에 한해 상단 행으로 분리 렌더(메뉴/숨김 커스터마이징 존중,
// classic 은 이전 배치 100% 계약이라 제외).
export const MOBILE_PROJECT_TOPROW_IDS = ['project-browser', 'project-trash'];

// 레지스트리 + 사용자 설정 → 실제 배치를 해석하는 단일 출처(순수 함수).
// - classic=true: 계층화 이전과 100% 동일 렌더 — 전 버튼을 레지스트리 순서로 인라인,
//   buttons 오버라이드 무시. pcOnly 도 필터하지 않는다(기존 렌더는 pcOnly id 도 map 하고
//   버튼 JSX 쪽 !isMobile && 가드가 처리하므로, 여기서 거르면 동일성이 깨진다).
// - 그 외: 모바일에서 pcOnly 제외 → 사용자 오버라이드(hidden/pinned/menu) →
//   미설정('default')은 tier 규칙. 순서는 항상 레지스트리 순서.
// - 레지스트리에 없는 id 의 오버라이드(과거 버전 잔재)는 조용히 무시 — 레지스트리가
//   소스오브트루스.
export function resolveToolbar(
  registry: ToolbarButtonMeta[],
  overrides: UiToolbarConfig | undefined,
  isMobile: boolean,
): { inline: string[]; menu: string[] } {
  if (overrides?.classic) {
    return { inline: registry.map((b) => b.id), menu: [] };
  }
  const inline: string[] = [];
  const menu: string[] = [];
  for (const b of registry) {
    if (isMobile && b.pcOnly) continue;
    const placement = overrides?.buttons?.[b.id] ?? 'default';
    if (placement === 'hidden') continue;
    if (placement === 'pinned') {
      inline.push(b.id);
      continue;
    }
    if (placement === 'menu') {
      menu.push(b.id);
      continue;
    }
    // 'default' → tier 규칙
    if (
      b.tier === 'primary' ||
      (b.tier === 'secondary' && !isMobile) ||
      (b.tier === 'mobile-primary' && isMobile)
    ) {
      inline.push(b.id);
    } else {
      menu.push(b.id);
    }
  }
  return { inline, menu };
}

// ── 편집 모드(config schema v2): 영역 내 순서 재배열 ─────────────────────────
// resolveToolbar 는 tier 규칙으로 순서가 레지스트리 고정이지만, v2 는 영역별
// inline/menu/hidden 배열로 "순서까지" 사용자 의도를 담는다. 아래 함수들은 이
// 순서 정보를 해석(resolveToolbarView)·변경(moveToolbarButton)하는 순수 함수다.

// 한 영역 = (영역 이름 + 그 영역의 버튼 레지스트리). 소비처·DnD 가 공유하는 계약.
export interface ToolbarRegistryEntry {
  area: string;
  registry: ToolbarButtonMeta[];
}

// 메인 화면 View 의 영역 목록 — 단일 출처. 영역 순서·집합은 여기서만 정의한다.
export const TOOLBAR_VIEW_MAIN: ToolbarRegistryEntry[] = [
  { area: 'scene', registry: sceneToolbarRegistry },
  { area: 'project', registry: projectToolbarRegistry },
];

// portable=true 인 버튼 id 목록(메인 View 레지스트리 도출). 동반 슬롯 허용 풀의 단일
// 출처 — companionSlots 가 하드코딩 대신 이걸 참조하므로 새 portable 추가 시 자동 반영.
export function portableButtonIds(): string[] {
  const ids: string[] = [];
  for (const { registry } of TOOLBAR_VIEW_MAIN) {
    for (const b of registry) {
      if (b.portable === true) ids.push(b.id);
    }
  }
  return ids;
}

// portable 버튼 메타(id + name) 목록 — portableButtonIds 와 같은 집합·순서를 표시명까지
// 담아 반환한다. 동반 슬롯 편집 UI(ConfigScreen E3)가 버튼명을 레지스트리에서 조회하는
// 단일 출처(라벨 중복 정의 금지). 새 portable 추가 시 여기에도 자동 반영된다.
export function portableButtonMetas(): { id: string; name: string }[] {
  const out: { id: string; name: string }[] = [];
  for (const { registry } of TOOLBAR_VIEW_MAIN) {
    for (const b of registry) {
      if (b.portable === true) out.push({ id: b.id, name: b.name });
    }
  }
  return out;
}

export interface ToolbarAreaResolved {
  area: string;
  inline: string[];
  menu: string[];
}

// 한 버튼의 tier 기본 배치를 inline/menu 로 판정(resolveToolbar 의 tier 분기와 동일).
function tierPlacement(
  meta: ToolbarButtonMeta,
  isMobile: boolean,
): 'inline' | 'menu' {
  if (
    meta.tier === 'primary' ||
    (meta.tier === 'secondary' && !isMobile) ||
    (meta.tier === 'mobile-primary' && isMobile)
  ) {
    return 'inline';
  }
  return 'menu';
}

// 여러 영역을 한 번에 해석. registries 와 같은 순서·같은 길이의 배열을 반환한다.
// - classic: 각 영역 레지스트리 순서 전부 inline(모바일이면 pcOnly 제외), menu=[].
// - areas 없는 영역: 기존 resolveToolbar 결과에서 "전역상 타 영역에 배정된 id"만 제거
//   (부분 areas 상태에서 홈 폴백이 크로스 배정 id 를 중복 렌더하는 걸 막는 핵심).
// - areas 있는 영역: 배열 순서 그대로 사용하되 이 영역에 "배정된" id 만 채용(stale·
//   비portable 타영역 무시), hidden·(모바일)pcOnly 필터, 이어서 전역 미배정 홈 버튼만
//   tier 폴백으로 뒤에 편입.
//
// 크로스 영역 해석은 "전역(View 단위) 배정"으로 처리한다. portable 버튼이 타 영역
// areas 에 실려 있으면 그 영역에만 렌더되고 홈 영역엔 나타나지 않아야 한다(중복 렌더가
// 최악의 버그). 1차 스캔으로 id→배정영역 을 확정한 뒤 2차에서 렌더를 생성한다.
// 파생 숨김(이동 의미론): excludeIds 에 든 버튼은 인라인·⋯메뉴 어디서도 렌더에서 빠진다
// (동반 슬롯에 배정된 버튼을 툴바 표면에서 감추는 용도). uiToolbar 데이터는 불변 — 순수
// 파생 필터라 제외 집합에서 빼면 원래 자리로 복귀한다. 미지정/빈 집합이면 기존과 100% 동일
// (기존 호출부는 무영향). classic 포함 전 경로에 동일 적용(어디 배정됐든 표면에서 사라짐).
export function resolveToolbarView(
  registries: ToolbarRegistryEntry[],
  overrides: UiToolbarConfig | undefined,
  isMobile: boolean,
  excludeIds?: ReadonlySet<string>,
): ToolbarAreaResolved[] {
  const base = resolveToolbarViewBase(registries, overrides, isMobile);
  if (!excludeIds || excludeIds.size === 0) return base;
  return base.map((a) => ({
    area: a.area,
    inline: a.inline.filter((id) => !excludeIds.has(id)),
    menu: a.menu.filter((id) => !excludeIds.has(id)),
  }));
}

function resolveToolbarViewBase(
  registries: ToolbarRegistryEntry[],
  overrides: UiToolbarConfig | undefined,
  isMobile: boolean,
): ToolbarAreaResolved[] {
  // classic 은 크로스 무시하고 각자 홈에 전부 inline(v1 위임과 동일).
  if (overrides?.classic) {
    return registries.map(({ area, registry }) => {
      const r = resolveToolbar(registry, overrides, isMobile);
      return { area, inline: r.inline, menu: r.menu };
    });
  }

  // 이 View 내에서 id → 홈 영역. 유효성·portable 판정용(어느 레지스트리에든 있으면 meta).
  const homeByeId = new Map<string, string>();
  const metaByeId = new Map<string, ToolbarButtonMeta>();
  for (const { area, registry } of registries) {
    for (const b of registry) {
      if (!metaByeId.has(b.id)) {
        metaByeId.set(b.id, b);
        homeByeId.set(b.id, area);
      }
    }
  }

  // ── 1차 스캔: id → 배정영역 확정(먼저 배정된 영역이 승리, 이후 중복 무시) ──
  // 유효 조건: View 에 meta 존재 && (홈영역 === 이 영역 || meta.portable === true).
  // stale·비portable 타영역 id 는 배정 기록 없이 무시.
  // 유효성은 metaByeId(View 전역)로 판정하므로 이 영역 레지스트리엔 국한하지 않는다.
  const assignedArea = new Map<string, string>();
  for (const { area } of registries) {
    const areaLayout = overrides?.areas?.[area];
    if (!areaLayout) continue; // areas 없는 영역은 배정 스캔 대상 아님(홈 폴백은 2차에서)
    const scan = (ids: string[] | undefined) => {
      for (const id of ids ?? []) {
        const meta = metaByeId.get(id);
        if (!meta) continue; // stale id 무시
        if (assignedArea.has(id)) continue; // 이미 배정됨(먼저 배정된 영역 승리)
        const home = homeByeId.get(id);
        if (home === area || meta.portable === true) {
          assignedArea.set(id, area);
        }
        // 홈≠이 영역 && 비portable → 배정 기록 없이 무시
      }
    };
    scan(areaLayout.inline);
    scan(areaLayout.menu);
    scan(areaLayout.hidden);
  }

  // ── 2차 렌더 생성 ──
  return registries.map(({ area, registry }) => {
    const areaLayout = overrides?.areas?.[area];

    // areas 없는 영역 → v1 resolveToolbar 결과에서 전역상 타 영역에 배정된 id 제거.
    if (!areaLayout) {
      const r = resolveToolbar(registry, overrides, isMobile);
      const takenElsewhere = (id: string) => {
        const a = assignedArea.get(id);
        return a !== undefined && a !== area;
      };
      return {
        area,
        inline: r.inline.filter((id) => !takenElsewhere(id)),
        menu: r.menu.filter((id) => !takenElsewhere(id)),
      };
    }

    // areas 있는 영역 → 배열 순서대로, 이 영역에 배정된 id 만 채용.
    const inline: string[] = [];
    const menu: string[] = [];
    const placed = new Set<string>();
    const hidden = new Set(areaLayout.hidden ?? []);

    const takeList = (ids: string[] | undefined, into: string[]) => {
      for (const id of ids ?? []) {
        if (assignedArea.get(id) !== area) continue; // 이 영역에 배정된 id 만
        if (placed.has(id)) continue; // 중복 방지(inline·menu 양쪽에 있을 때)
        if (hidden.has(id)) continue; // hidden 배열에 있으면 제외
        const meta = metaByeId.get(id)!; // 배정됐으면 meta 존재 보장
        if (isMobile && meta.pcOnly) continue; // 모바일에서 pcOnly 제외
        into.push(id);
        placed.add(id);
      }
    };
    takeList(areaLayout.inline, inline);
    takeList(areaLayout.menu, menu);

    // 홈 레지스트리 버튼 중 전역 어디에도 배정 안 된 것만 → v1 buttons 오버라이드 우선,
    // 없으면 tier 폴백. 레지스트리 순서대로 뒤에 append.
    for (const b of registry) {
      if (placed.has(b.id)) continue;
      if (assignedArea.has(b.id)) continue; // 전역상 이미 어딘가에 배정됨
      if (hidden.has(b.id)) continue;
      if (isMobile && b.pcOnly) continue;
      const ov = overrides?.buttons?.[b.id];
      if (ov === 'hidden') continue;
      if (ov === 'pinned') {
        inline.push(b.id);
      } else if (ov === 'menu') {
        menu.push(b.id);
      } else if (tierPlacement(b, isMobile) === 'inline') {
        inline.push(b.id);
      } else {
        menu.push(b.id);
      }
      placed.add(b.id);
    }
    return { area, inline, menu };
  });
}

export interface ToolbarMove {
  id: string;
  toArea: string;
  slot: 'inline' | 'menu' | 'hidden' | 'default'; // default = 배치 초기화(tier 폴백 복귀)
  index?: number; // slot 배열 내 삽입 위치 (미지정/범위 밖 = 맨 뒤, anchor 가 있으면 무시)
  // 앵커 기반 삽입 — "이 버튼의 앞/뒤"로 지정하면 제거 후 배열에서 앵커를 찾아
  // 삽입하므로, 시각 인덱스 방식의 오프셋 문제(같은 배열 내 이동 시 1칸 밀림,
  // 모바일 pcOnly 필터로 렌더/정규 인덱스 어긋남)가 없다. DnD 드롭은 이걸 쓴다.
  anchor?: { id: string; side: 'before' | 'after' };
}

// View 전체(모든 영역)를 한 번에 정규 배치(PC 기준 전체 집합)로 전개.
// resolveToolbarView 의 전역 배정 규칙과 동일하게 View 단위로 처리해야 크로스 배정이
// 보존된다: 영역별 독립 정규화라면 무관한 버튼 이동 시 홈 영역 폴백이 크로스 배정된
// portable id 를 홈에 다시 추가해 양쪽 중복이 생긴다.
// - 배열 채용: 각 영역 areas 배열에서 "그 영역에 배정된 id"만(assignedArea 규칙).
// - 폴백: 전역 어디에도 배정 안 된 홈 버튼만 → 홈 영역에 v1 buttons 우선/tier 폴백.
// pcOnly 도 포함(저장 데이터는 항상 PC 기준 전체 — 모바일 필터는 렌더 시점에만).
function canonicalizeView(
  registries: ToolbarRegistryEntry[],
  overrides: UiToolbarConfig | undefined,
): Map<string, { inline: string[]; menu: string[]; hidden: string[] }> {
  // id → 홈 영역·meta(View 전역, 먼저 등장한 레지스트리가 홈).
  const homeByeId = new Map<string, string>();
  const metaByeId = new Map<string, ToolbarButtonMeta>();
  for (const { area, registry } of registries) {
    for (const b of registry) {
      if (!metaByeId.has(b.id)) {
        metaByeId.set(b.id, b);
        homeByeId.set(b.id, area);
      }
    }
  }

  // 1차 스캔: id → 배정영역(먼저 배정된 영역 승리). resolveToolbarView 와 동일 규칙.
  const assignedArea = new Map<string, string>();
  for (const { area } of registries) {
    const areaLayout = overrides?.areas?.[area];
    if (!areaLayout) continue;
    const scan = (ids: string[] | undefined) => {
      for (const id of ids ?? []) {
        const meta = metaByeId.get(id);
        if (!meta) continue; // stale id 무시
        if (assignedArea.has(id)) continue; // 이미 배정됨
        const home = homeByeId.get(id);
        if (home === area || meta.portable === true) {
          assignedArea.set(id, area);
        }
      }
    };
    scan(areaLayout.inline);
    scan(areaLayout.menu);
    scan(areaLayout.hidden);
  }

  // 2차: 영역별 배치 전개.
  const result = new Map<
    string,
    { inline: string[]; menu: string[]; hidden: string[] }
  >();
  const placed = new Set<string>();
  for (const { area } of registries) {
    const areaLayout = overrides?.areas?.[area];
    const inline: string[] = [];
    const menu: string[] = [];
    const hidden: string[] = [];
    const takeList = (ids: string[] | undefined, into: string[]) => {
      for (const id of ids ?? []) {
        if (assignedArea.get(id) !== area) continue; // 이 영역에 배정된 id 만
        if (placed.has(id)) continue;
        into.push(id);
        placed.add(id);
      }
    };
    if (areaLayout) {
      takeList(areaLayout.inline, inline);
      takeList(areaLayout.menu, menu);
      takeList(areaLayout.hidden, hidden);
    }
    result.set(area, { inline, menu, hidden });
  }

  // 폴백: 전역 미배정 홈 버튼만 홈 영역에 v1 buttons 우선/tier 폴백(PC 기준).
  for (const { area, registry } of registries) {
    const lists = result.get(area)!;
    for (const b of registry) {
      if (placed.has(b.id)) continue;
      if (assignedArea.has(b.id)) continue; // 전역상 이미 어딘가에 배정됨
      if (homeByeId.get(b.id) !== area) continue; // 홈 영역에서만 폴백 편입
      const ov = overrides?.buttons?.[b.id];
      if (ov === 'hidden') {
        lists.hidden.push(b.id);
      } else if (ov === 'pinned') {
        lists.inline.push(b.id);
      } else if (ov === 'menu') {
        lists.menu.push(b.id);
      } else if (tierPlacement(b, false) === 'inline') {
        lists.inline.push(b.id);
      } else {
        lists.menu.push(b.id);
      }
      placed.add(b.id);
    }
  }
  return result;
}

// 버튼 하나를 이동시킨 다음 uiToolbar 전체를 반환하는 순수 함수(원본 불변, 새 객체).
// 1. 전 영역을 PC 기준으로 정규화 → 2. 홈 영역≠toArea 이면 portable 아닌 한 거부 →
// 3. 모든 영역에서 id 제거 후 slot 위치에 삽입(default 면 미삽입) →
// 4. dual-write(buttons[id] 갱신) → 5. schema:2, 나머지 필드 보존.
export function moveToolbarButton(
  registries: ToolbarRegistryEntry[],
  overrides: UiToolbarConfig | undefined,
  move: ToolbarMove,
): UiToolbarConfig {
  // 홈 영역(레지스트리 기준) 판정 + 대상 버튼 meta 확보.
  let homeArea: string | undefined;
  let meta: ToolbarButtonMeta | undefined;
  for (const { area, registry } of registries) {
    const found = registry.find((b) => b.id === move.id);
    if (found) {
      homeArea = area;
      meta = found;
      break;
    }
  }
  // 레지스트리에 없는 id → 그대로 반환(변경 거부).
  if (!meta || homeArea === undefined) {
    return overrides ?? {};
  }
  // 타 영역 이동 가드: portable 아니면 거부(비portable 은 같은 영역 내 이동만 허용).
  if (move.toArea !== homeArea && meta.portable !== true) {
    return overrides ?? {};
  }

  // View 전체를 한 번에 정규화한다(PC 기준 전체 집합, 크로스 배정 보존).
  const canon = canonicalizeView(registries, overrides);

  // 모든 영역의 모든 배열에서 id 제거.
  for (const lists of canon.values()) {
    lists.inline = lists.inline.filter((x) => x !== move.id);
    lists.menu = lists.menu.filter((x) => x !== move.id);
    lists.hidden = lists.hidden.filter((x) => x !== move.id);
  }

  // slot 위치에 삽입(default 면 삽입 없이 tier 폴백 복귀).
  if (move.slot !== 'default') {
    const target = canon.get(move.toArea);
    if (target) {
      const arr = target[move.slot];
      let idx: number;
      if (move.anchor) {
        // 앵커 우선 — 제거 후 배열에서 앵커 위치를 찾아 앞/뒤에 삽입.
        // 앵커가 이 배열에 없으면(다른 slot 에 있거나 stale) 맨 뒤 폴백.
        const at = arr.indexOf(move.anchor.id);
        idx = at === -1 ? arr.length : at + (move.anchor.side === 'after' ? 1 : 0);
      } else {
        idx =
          move.index === undefined || move.index < 0 || move.index > arr.length
            ? arr.length
            : move.index;
      }
      arr.splice(idx, 0, move.id);
    }
  }

  // 정규화 결과 → areas 로 직렬화.
  const areas: Record<string, UiToolbarAreaLayout> = {};
  for (const [area, lists] of canon.entries()) {
    areas[area] = {
      inline: lists.inline,
      menu: lists.menu,
      hidden: lists.hidden,
    };
  }

  // dual-write: buttons 는 기존 것을 복사하되 이동한 id 만 갱신
  // (구버전 롤백 시 순서만 잃고 배치 의도는 보존).
  const buttons: Record<string, ToolbarButtonPlacement> = {
    ...(overrides?.buttons ?? {}),
  };
  if (move.slot === 'default') {
    delete buttons[move.id];
  } else if (move.slot === 'inline') {
    buttons[move.id] = 'pinned';
  } else if (move.slot === 'menu') {
    buttons[move.id] = 'menu';
  } else if (move.slot === 'hidden') {
    buttons[move.id] = 'hidden';
  }

  // 입력 overrides 는 변형하지 않고 새 객체로 반환. classic 등 다른 필드 보존.
  return {
    ...(overrides ?? {}),
    buttons,
    areas,
    schema: 2,
  };
}
