// UI 구성 커스터마이징(순서 변경·숨기기·퀵 메뉴)의 기반 레지스트리.
// 화면의 버튼을 "id + 이름" 데이터로 선언한다. id는 사용자 설정(Config)의 저장 키가
// 되므로 한 번 배포된 뒤에는 바꾸지 않는다. 실제 동작(JSX)은 각 컴포넌트가
// id → 노드 맵으로 바인딩하고, 렌더 순서는 이 레지스트리(향후 사용자 설정)가 결정한다.

export interface ToolbarButtonMeta {
  id: string;
  // 커스터마이징 화면에서 사용자에게 보여줄 이름 (버튼 라벨과 달리 상태에 따라 변하지 않음)
  name: string;
  // PC(데스크톱)에서만 존재하는 버튼 — 모바일 커스터마이징 목록에서 제외용
  pcOnly?: boolean;
}

// 씬 툴바 (이미지생성/이미지변형 탭 상단) — SceneQueueControl.tsx 가 사용
export const sceneToolbarRegistry: ToolbarButtonMeta[] = [
  { id: 'add-scene', name: '씬 추가' },
  { id: 'queue-add', name: '예약 추가' },
  { id: 'export-images', name: '이미지 내보내기' },
  { id: 'quick-export', name: '빠른 export' },
  { id: 'batch-process', name: '대량 작업' },
  { id: 'multi-select', name: '다중 선택' },
  { id: 'change-resolution', name: '해상도 변경' },
  { id: 'webp-convert', name: 'WebP 변환', pcOnly: true },
  { id: 'import-image', name: '이미지 프롬프트 추출' },
  { id: 'artist-tag', name: '아티스트 태깅', pcOnly: true },
  { id: 'scene-search', name: '씬 검색' },
  { id: 'bookmark-jump', name: '북마크된 씬으로 이동' },
  { id: 'scene-trash', name: '씬 휴지통' },
  { id: 'empty-image-trash', name: '삭제 이미지 일괄 비우기' },
  { id: 'find-replace', name: '찾기 및 변환' },
  { id: 'shortcut-help', name: '단축키 도움말', pcOnly: true },
];
