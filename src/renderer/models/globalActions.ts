// globalActions — 퀵 메뉴 전역 액션 레지스트리 (트랙2 ① P1, 2026-07-18)
//
// appState/전역 서비스만 의존해 "어느 화면에서든" 실행 가능한 액션의 단일 출처.
// id 는 uiLayout 툴바 버튼 id 와 동일 값 재사용(커스터마이징 화면·config 저장 키 일관,
// 배포 후 불변 계약 동일 적용) — 표시명·pcOnly 도 uiLayout 레지스트리에서 도출해
// 라벨 중복 정의를 두지 않는다. 아이콘은 UI(QuickMenu.tsx)의 id→아이콘 맵이 담당
// (uiLayout 관례: models 는 데이터, JSX 는 컴포넌트).
//
// available?(): 실행 불가 상태 판정(퀵 메뉴에서 비활성 표시). run() 자체도 각 전역
// 메서드의 세션 가드를 신뢰한다(이중 방어).
import { appState } from './AppService';
import {
  sceneToolbarRegistry,
  projectToolbarRegistry,
  ToolbarButtonMeta,
} from './uiLayout';
import { IMPORT_IMAGE_ACCEPT } from './imageFormats';

export interface GlobalAction {
  id: string;
  run: () => void;
  available?: () => boolean;
}

const hasSession = () => !!appState.curSession;

// 퀵 메뉴의 export 계열이 따라갈 탭 문맥(D3): 활성 탭이 일반/인페인트면 그대로,
// 그 외 화면(글로벌 프리셋·퀵 생성 등)에서는 scene 기본.
export const quickExportType = (): 'scene' | 'inpaint' =>
  appState.curMainTab === 'inpaint' ? 'inpaint' : 'scene';

// 배열 순서 = ConfigScreen 편집 UI 의 나열 순서.
export const GLOBAL_ACTIONS: GlobalAction[] = [
  // ── portable 4종 (이미 전역) ──
  { id: 'piece-editor', run: () => appState.openPieceEditor(), available: hasSession },
  { id: 'find-replace', run: () => appState.openFindReplace(), available: hasSession },
  { id: 'backup-export', run: () => appState.projectBackupMenu(), available: hasSession },
  {
    id: 'empty-image-trash',
    run: () => appState.emptyProjectImageTrashWithConfirm(),
    available: hasSession,
  },
  // ── A군 (사실상 이미 전역) ──
  {
    id: 'quick-export',
    run: () => appState.quickExportPackage(quickExportType()),
    available: hasSession,
  },
  {
    id: 'export-images',
    run: () => appState.exportPackage(quickExportType()),
    available: hasSession,
  },
  {
    id: 'scene-template',
    // 씬 템플릿 개편: select 연쇄 메뉴 → 관리 모달. 세션 없이도 관리는 가능하지만
    // 기존 노출 조건(hasSession)은 유지 — 가져오기/만들기가 주 동선이라 무해.
    run: () => {
      appState.sceneTemplateManagerOpen = true;
    },
    available: hasSession,
  },
  {
    id: 'import-image',
    run: () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = IMPORT_IMAGE_ACCEPT;
      input.onchange = (e: any) => {
        const file = e.target.files?.[0];
        if (file) appState.handleFile(file);
      };
      input.click();
    },
    available: hasSession,
  },
  {
    id: 'shortcut-help',
    run: () => {
      appState.showSceneCheatsheet = !appState.showSceneCheatsheet;
    },
  },
  {
    id: 'project-browser',
    run: () => {
      appState.projectBrowserOpen = true;
    },
  },
  // ── B군 (로컬 모달 승격 완료분) ──
  { id: 'character-presets', run: () => appState.openCharacterPresets(), available: hasSession },
  { id: 'project-trash', run: () => appState.openProjectTrash() },
  { id: 'add-session', run: () => appState.addSession() },
  { id: 'delete-session', run: () => appState.deleteSession(), available: hasSession },
  // ── B군 (이번 승격 2건, P2) ──
  { id: 'artist-tag', run: () => appState.openArtistTag() },
  { id: 'scene-trash', run: () => appState.openSceneTrash(), available: hasSession },
  // ── 기타 전역 ──
  { id: 'new-window', run: () => appState.openNewWindow() },
];

// id → 툴바 레지스트리 메타(표시명·pcOnly 단일 출처). 퀵 메뉴 대상 id 는 전부
// 씬/프로젝트 레지스트리에 존재한다(없으면 undefined — 호출부가 조용히 건너뜀).
export function globalActionMeta(id: string): ToolbarButtonMeta | undefined {
  return (
    sceneToolbarRegistry.find((b) => b.id === id) ??
    projectToolbarRegistry.find((b) => b.id === id)
  );
}

export function globalActionById(id: string): GlobalAction | undefined {
  return GLOBAL_ACTIONS.find((a) => a.id === id);
}

// 최초 기본 구성(D5 추천 프리셋) — config.quickMenu 미설정 시 사용.
// stale/미등록 id 는 해석 시 조용히 무시(uiToolbar 선례).
export const DEFAULT_QUICK_MENU: string[] = [
  'piece-editor',
  'find-replace',
  'character-presets',
  'scene-template',
  'quick-export',
  'backup-export',
];

// 사용자 설정 → 표시할 액션 목록 해석(순수): 미등록 id 제거, (모바일) pcOnly 제거.
export function resolveQuickMenu(
  ids: string[] | undefined,
  isMobilePlatform: boolean,
): GlobalAction[] {
  const list = ids ?? DEFAULT_QUICK_MENU;
  const out: GlobalAction[] = [];
  for (const id of list) {
    const action = globalActionById(id);
    if (!action) continue;
    const meta = globalActionMeta(id);
    if (!meta) continue;
    if (isMobilePlatform && meta.pcOnly) continue;
    if (out.some((a) => a.id === id)) continue;
    out.push(action);
  }
  return out;
}
