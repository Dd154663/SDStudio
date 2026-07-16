// 폴더 색상 팔레트 — 단일 출처.
// 프로젝트 드로어(ProjectDrawer)·그리드 탐색(ProjectBrowser)의 폴더 색과
// 템플릿 배지 매직 컬러(FolderTemplateModal ♚/♟)가 공유한다.
// 과거 두 컴포넌트에 동일 목록이 병렬 하드코딩돼 있던 것을 배지 컬러 도입
// 시점(2026-07-16)에 중앙화 — 새 hex 목록을 만들지 말고 여기에 추가할 것.
export const FOLDER_COLORS = [
  '#64748b', // slate
  '#ef4444', // red
  '#f97316', // orange
  '#f59e0b', // amber
  '#22c55e', // green
  '#14b8a6', // teal
  '#0ea5e9', // sky (기본)
  '#6366f1', // indigo
  '#a855f7', // purple
  '#ec4899', // pink
];
export const DEFAULT_FOLDER_COLOR = '#0ea5e9';

// hex 색상에 알파를 붙여 옅은 배경을 만든다. (아이콘 배지/드롭 피드백 등 소형 색 강조용)
export const withAlpha = (hex: string, alpha: string) => hex + alpha;
