// UI 구성 커스터마이징(순서 변경·숨기기·퀵 메뉴)의 기반 레지스트리.
// 화면의 버튼을 "id + 이름" 데이터로 선언한다. id는 사용자 설정(Config)의 저장 키가
// 되므로 한 번 배포된 뒤에는 바꾸지 않는다. 실제 동작(JSX)은 각 컴포넌트가
// id → 노드 맵으로 바인딩하고, 렌더 순서는 이 레지스트리(+사용자 설정)가 결정한다.

import { UiToolbarConfig } from '../../main/config';

// 기본 노출 등급: primary=모바일·PC 모두 툴바 인라인 / secondary=PC 는 인라인,
// 모바일은 ⋯ 메뉴 / overflow=양쪽 모두 ⋯ 메뉴.
// 증식 차단 규칙: 앞으로 새 기능 버튼은 기본 overflow 로 추가한다(툴바는 더 자라지 않는다).
export type ToolbarTier = 'primary' | 'secondary' | 'overflow';

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
  { id: 'quick-export', name: '빠른 export', tier: 'secondary' },
  { id: 'batch-process', name: '대량 작업', tier: 'secondary' },
  { id: 'multi-select', name: '다중 선택', tier: 'primary' },
  { id: 'change-resolution', name: '해상도 변경', tier: 'secondary' },
  { id: 'webp-convert', name: 'WebP 변환', pcOnly: true, tier: 'overflow' },
  { id: 'import-image', name: '이미지 프롬프트 추출', tier: 'overflow' },
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
// PC 하단 바는 공간이 넉넉해 기본값 = 전부 인라인(⋯ 없음, 메뉴 보내기는 사용자 선택).
// 모바일만 다이어트: primary 외 전부 ⋯ 메뉴 (secondary = PC 인라인·모바일 메뉴).
export const projectToolbarRegistry: ToolbarButtonMeta[] = [
  { id: 'add-session', name: '신규 프로젝트', tier: 'primary' },
  { id: 'character-presets', name: '캐릭터 프리셋 관리', tier: 'secondary' },
  { id: 'backup-export', name: '프로젝트 백업/내보내기', tier: 'secondary' },
  { id: 'delete-session', name: '프로젝트 삭제', tier: 'secondary' },
  { id: 'project-trash', name: '프로젝트 휴지통', tier: 'secondary' },
  { id: 'piece-editor', name: '프롬프트조각', tier: 'secondary' },
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
    if (b.tier === 'primary' || (b.tier === 'secondary' && !isMobile)) {
      inline.push(b.id);
    } else {
      menu.push(b.id);
    }
  }
  return { inline, menu };
}
