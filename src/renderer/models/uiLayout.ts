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
  { id: 'webp-convert', name: 'WebP 변환', pcOnly: true, tier: 'overflow' },
  // 모바일 실사용 빈도가 높아 모바일만 인라인 (PC 는 기존대로 ⋯ 메뉴)
  { id: 'import-image', name: '이미지 프롬프트 추출', tier: 'mobile-primary' },
  { id: 'artist-tag', name: '아티스트 태깅', pcOnly: true, tier: 'overflow' },
  { id: 'scene-search', name: '씬 검색', tier: 'primary' },
  { id: 'bookmark-jump', name: '북마크된 씬으로 이동', tier: 'secondary' },
  { id: 'scene-trash', name: '씬 휴지통', tier: 'overflow' },
  { id: 'empty-image-trash', name: '삭제 이미지 일괄 비우기', tier: 'overflow' },
  { id: 'find-replace', name: '찾기 및 변환', tier: 'secondary' },
  { id: 'shortcut-help', name: '단축키 도움말', pcOnly: true, tier: 'overflow' },
];

// 프로젝트 바 (프로젝트 선택기 옆 버튼들) — SessionSelect.tsx 가 사용.
// 프로젝트 선택기(드로어 버튼·드롭다운)와 그 옆의 '프로젝트 탐색' 버튼은
// 선택기 컨테이너에 고정(정체성 컨트롤 + 모바일 1행 유지)이라 레지스트리 비대상.
// 여기 버튼은 전부 상시 사용 빈도가 높아 기본값 = PC·모바일 모두 전부 인라인
// (⋯ 없음). 메뉴로 보내기는 사용자 커스터마이징 재량 (2026-07-04 실사용 피드백).
export const projectToolbarRegistry: ToolbarButtonMeta[] = [
  { id: 'add-session', name: '신규 프로젝트', tier: 'primary' },
  { id: 'character-presets', name: '캐릭터 프리셋 관리', tier: 'primary' },
  { id: 'backup-export', name: '프로젝트 백업/내보내기', tier: 'primary' },
  { id: 'delete-session', name: '프로젝트 삭제', tier: 'primary' },
  { id: 'project-trash', name: '프로젝트 휴지통', tier: 'primary' },
  { id: 'piece-editor', name: '프롬프트조각', tier: 'primary' },
];

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
// - areas 없는 영역: 기존 resolveToolbar 결과 그대로(v1 폴백, 100% 동일).
// - areas 있는 영역: inline/menu 배열 순서 그대로 사용하되 stale·타영역·hidden·
//   (모바일)pcOnly 를 걸러내고, 배열에 없는 신규 버튼은 tier 폴백으로 뒤에 편입.
export function resolveToolbarView(
  registries: ToolbarRegistryEntry[],
  overrides: UiToolbarConfig | undefined,
  isMobile: boolean,
): ToolbarAreaResolved[] {
  return registries.map(({ area, registry }) => {
    const areaLayout = overrides?.areas?.[area];
    // classic 또는 areas 미설정 → 기존 resolveToolbar 로 위임(v1 동작 100% 동일).
    if (overrides?.classic || !areaLayout) {
      const r = resolveToolbar(registry, overrides, isMobile);
      return { area, inline: r.inline, menu: r.menu };
    }

    const inline: string[] = [];
    const menu: string[] = [];
    const placed = new Set<string>();
    // 이 영역 레지스트리에 실제로 있는 id 만 유효(stale·타영역 id 무시).
    const metaById = new Map(registry.map((b) => [b.id, b]));
    const hidden = new Set(areaLayout.hidden ?? []);

    const takeList = (ids: string[] | undefined, into: string[]) => {
      for (const id of ids ?? []) {
        const meta = metaById.get(id);
        if (!meta) continue; // stale·타영역 id 무시
        if (placed.has(id)) continue; // 중복 방지(같은 id 가 inline·menu 양쪽에 있을 때)
        if (hidden.has(id)) continue; // hidden 배열에 있으면 제외
        if (isMobile && meta.pcOnly) continue; // 모바일에서 pcOnly 제외
        into.push(id);
        placed.add(id);
      }
    };
    takeList(areaLayout.inline, inline);
    takeList(areaLayout.menu, menu);

    // 배열 어디에도 없는(신규) 버튼 → v1 buttons 오버라이드 우선, 없으면 tier 폴백.
    // 레지스트리 순서대로 뒤에 append.
    for (const b of registry) {
      if (placed.has(b.id)) continue;
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

// 한 영역의 정규 배치(PC 기준 전체 집합)를 inline/menu/hidden 배열로 전개.
// areas 있으면 그대로+미배치 tier 폴백 편입, 없으면 v1 buttons+tier 파생.
// pcOnly 도 포함(저장 데이터는 항상 PC 기준 전체 — 모바일 필터는 렌더 시점에만).
function canonicalizeArea(
  registry: ToolbarButtonMeta[],
  overrides: UiToolbarConfig | undefined,
  areaLayout: UiToolbarAreaLayout | undefined,
): { inline: string[]; menu: string[]; hidden: string[] } {
  const inline: string[] = [];
  const menu: string[] = [];
  const hidden: string[] = [];
  const placed = new Set<string>();
  const metaById = new Map(registry.map((b) => [b.id, b]));
  const hiddenSet = new Set(areaLayout?.hidden ?? []);

  const takeList = (ids: string[] | undefined, into: string[]) => {
    for (const id of ids ?? []) {
      if (!metaById.has(id)) continue; // stale·타영역 id 무시
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
  // 미배치(신규) 버튼 → v1 buttons 오버라이드 우선, 없으면 tier 폴백(PC 기준).
  for (const b of registry) {
    if (placed.has(b.id)) continue;
    const ov = overrides?.buttons?.[b.id];
    if (ov === 'hidden') {
      hidden.push(b.id);
    } else if (ov === 'pinned') {
      inline.push(b.id);
    } else if (ov === 'menu') {
      menu.push(b.id);
    } else if (tierPlacement(b, false) === 'inline') {
      inline.push(b.id);
    } else {
      menu.push(b.id);
    }
    placed.add(b.id);
  }
  return { inline, menu, hidden };
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
  // 타 영역 이동 가드: portable 아니면 거부(Phase A 엔 portable 필드 없음 → 사실상
  // 같은 영역 내 이동만 허용). meta 에 portable 이 붙는 Phase B 대비 미리 작성.
  const portable = (meta as ToolbarButtonMeta & { portable?: boolean }).portable;
  if (move.toArea !== homeArea && portable !== true) {
    return overrides ?? {};
  }

  // 각 영역을 정규화한다(PC 기준 전체 집합).
  const canon = new Map<
    string,
    { inline: string[]; menu: string[]; hidden: string[] }
  >();
  for (const { area, registry } of registries) {
    canon.set(
      area,
      canonicalizeArea(registry, overrides, overrides?.areas?.[area]),
    );
  }

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
