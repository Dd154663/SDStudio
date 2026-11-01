import { appState } from './AppService';
import { isMobile } from '.';
import { isTextEntryFocused } from './keyTargetGuard';

export interface ShortcutAction {
  id: string;
  label: string;
  category: 'global' | 'viewer' | 'scene' | 'image-grid';
  defaultKey: string;
  // 전역(global) 액션이 FloatView 안에서도 통과할 수 있음(2026-11-01 되돌리기 U1). 열린 FloatView 가
  // **모두** 허용 창(FloatView allowUndo — 씬 편집 창·이미지 그리드/상세)일 때만 통과한다.
  allowInFloatView?: true;
}

const ACTIONS: ShortcutAction[] = [
  // 이미지 그리드 액션 (씬 내 이미지 리스트가 보일 때, 상세 창은 닫힘)
  { id: 'image-left', label: '왼쪽 이미지', category: 'image-grid', defaultKey: 'ArrowLeft' },
  { id: 'image-right', label: '오른쪽 이미지', category: 'image-grid', defaultKey: 'ArrowRight' },
  { id: 'image-up', label: '위 이미지', category: 'image-grid', defaultKey: 'ArrowUp' },
  { id: 'image-down', label: '아래 이미지', category: 'image-grid', defaultKey: 'ArrowDown' },
  { id: 'image-open-detail', label: '상세 보기', category: 'image-grid', defaultKey: 'Enter' },
  { id: 'image-toggle-favorite', label: '즐겨찾기 토글', category: 'image-grid', defaultKey: 'Ctrl+F' },
  { id: 'image-toggle-bookmark', label: '북마크 토글', category: 'image-grid', defaultKey: 'Ctrl+B' },
  { id: 'image-toggle-select', label: '선택 모드 진입/포커스 이미지 선택 토글', category: 'image-grid', defaultKey: 'Ctrl+S' },
  { id: 'image-clear-select', label: '선택 모드 취소', category: 'image-grid', defaultKey: 'Ctrl+X' },
  { id: 'image-delete', label: '이미지 삭제', category: 'image-grid', defaultKey: 'Delete' },
  { id: 'image-tab-1', label: '이미지 탭', category: 'image-grid', defaultKey: 'Ctrl+1' },
  { id: 'image-tab-2', label: '즐겨찾기 탭', category: 'image-grid', defaultKey: 'Ctrl+2' },
  { id: 'image-tab-3', label: '휴지통 탭', category: 'image-grid', defaultKey: 'Ctrl+3' },
  { id: 'image-tab-4', label: '인페인트 씬 탭', category: 'image-grid', defaultKey: 'Ctrl+4' },
  { id: 'image-prev-scene', label: '이전 씬 그리드로 이동', category: 'image-grid', defaultKey: 'Ctrl+ArrowLeft' },
  { id: 'image-next-scene', label: '다음 씬 그리드로 이동', category: 'image-grid', defaultKey: 'Ctrl+ArrowRight' },

  // 뷰어 액션 (ResultViewer가 열려 있을 때만 작동)
  { id: 'toggle-favorite', label: '즐겨찾기 토글', category: 'viewer', defaultKey: 'Ctrl+F' },
  { id: 'toggle-bookmark', label: '북마크 토글', category: 'viewer', defaultKey: 'Ctrl+B' },
  { id: 'save-image', label: '이미지 저장', category: 'viewer', defaultKey: 'Ctrl+S' },
  { id: 'prev-image', label: '이전 이미지', category: 'viewer', defaultKey: 'ArrowLeft' },
  { id: 'next-image', label: '다음 이미지', category: 'viewer', defaultKey: 'ArrowRight' },
  { id: 'delete-image', label: '이미지 삭제', category: 'viewer', defaultKey: 'Delete' },

  // 씬 네비게이션 액션 (씬 그리드가 보일 때, FloatView 닫혀 있을 때)
  { id: 'scene-left', label: '이전 씬', category: 'scene', defaultKey: 'ArrowLeft' },
  { id: 'scene-right', label: '다음 씬', category: 'scene', defaultKey: 'ArrowRight' },
  { id: 'scene-up', label: '위 씬', category: 'scene', defaultKey: 'ArrowUp' },
  { id: 'scene-down', label: '아래 씬', category: 'scene', defaultKey: 'ArrowDown' },
  { id: 'scene-open-images', label: '씬 이미지 보기', category: 'scene', defaultKey: 'Enter' },
  { id: 'scene-open-editor', label: '씬 편집', category: 'scene', defaultKey: 'Tab' },
  { id: 'scene-queue-add', label: '포커스/선택 씬 예약 추가', category: 'scene', defaultKey: 'Ctrl+A' },
  { id: 'scene-toggle-select', label: '선택 모드 진입/포커스 씬 선택 토글', category: 'scene', defaultKey: 'Ctrl+S' },
  { id: 'scene-clear-select', label: '선택 모드 취소', category: 'scene', defaultKey: 'Ctrl+X' },
  { id: 'scene-toggle-bookmark', label: '씬 북마크 토글', category: 'scene', defaultKey: 'Ctrl+B' },
  { id: 'queue-run', label: '예약 실행', category: 'scene', defaultKey: 'Space' },
  { id: 'queue-clear', label: '모든 예약 제거', category: 'scene', defaultKey: 'Ctrl+D' },

  // 전역 액션
  { id: 'tab-1', label: '이미지생성 탭', category: 'global', defaultKey: 'Ctrl+1' },
  { id: 'tab-2', label: '이미지변형 탭', category: 'global', defaultKey: 'Ctrl+2' },
  // 메인 탭 순서(App.tsx tabs): 1 이미지생성 · 2 이미지변형 · 3 글로벌 프리셋 · 4 작가 라이브러리 · 5 퀵 생성 · 6 웹 검색(PC)
  { id: 'tab-3', label: '글로벌 프리셋 탭', category: 'global', defaultKey: 'Ctrl+3' },
  { id: 'toggle-left-panel', label: '좌측 패널 토글', category: 'global', defaultKey: 'Ctrl+Q' },
  { id: 'queue-all-scenes', label: '모든 씬 예약', category: 'global', defaultKey: 'Ctrl+G' },
  { id: 'toggle-project-favorite', label: '프로젝트 즐겨찾기 토글', category: 'global', defaultKey: 'Ctrl+F' },
  { id: 'open-sampling-settings', label: '샘플링/모델 설정 열기', category: 'global', defaultKey: 'Ctrl+M' },
  { id: 'open-piece-editor', label: '프롬프트조각 열기', category: 'global', defaultKey: 'Ctrl+P' },
  { id: 'open-config', label: '환경설정 열기', category: 'global', defaultKey: 'Ctrl+,' },
  { id: 'find-replace', label: '찾기 및 변환', category: 'global', defaultKey: 'Ctrl+H' },
  { id: 'open-project-drawer', label: '프로젝트 드로어 열기/닫기', category: 'global', defaultKey: 'F1' },
  { id: 'open-project-grid', label: '프로젝트 그리드 열기/닫기', category: 'global', defaultKey: 'Ctrl+E' },
  { id: 'quick-menu', label: '퀵 메뉴 열기/닫기', category: 'global', defaultKey: 'Ctrl+K' },
  // 되돌리기/다시 실행(2026-11-01 U1) — 다시 실행은 Ctrl+Y 하나(Ctrl+Shift+Z 미등록, 사용자 결정 D11=C).
  // 입력 칸·편집기 포커스 중에는 공통 억제(아래 isInputFocused)라 편집기 자체 이력이 받는다.
  { id: 'undo', label: '되돌리기', category: 'global', defaultKey: 'Ctrl+Z', allowInFloatView: true },
  { id: 'redo', label: '다시 실행', category: 'global', defaultKey: 'Ctrl+Y', allowInFloatView: true },
];

/** 범주별 활성 조건 판정에 쓰는 앱 상태(순수 판정용 — 테스트가 직접 넘긴다) */
export interface ShortcutGateState {
  imageGridFocusable: boolean;
  resultViewerOpen: boolean;
  dialogCount: number;
  floatViewCount: number;
  /** 열린 FloatView 중 allowUndo(전역 되돌리기 허용) 창 수 */
  undoFloatViewCount: number;
  configScreenOpen: boolean;
  pieceEditorOpen: boolean;
  findReplaceOpen: boolean;
}

/** 이 액션이 지금 통과할 수 있는가(입력 칸 포커스 억제는 호출 전에 따로 본다) */
export function isShortcutActionActive(
  action: ShortcutAction,
  st: ShortcutGateState,
): boolean {
  if (action.category === 'image-grid') {
    return st.imageGridFocusable && st.dialogCount === 0;
  }
  if (action.category === 'viewer') {
    return st.resultViewerOpen && st.dialogCount === 0;
  }
  if (st.floatViewCount > 0) {
    // 전역 허용 액션은 열린 창이 전부 허용 창일 때만(인페인트 편집 창 등 하나라도 섞이면 억제)
    const floatOk =
      action.category === 'global' &&
      action.allowInFloatView === true &&
      st.floatViewCount === st.undoFloatViewCount;
    if (!floatOk) return false;
  }
  if (st.dialogCount > 0) return false;
  if (st.configScreenOpen) return false;
  if (st.pieceEditorOpen) return false;
  if (st.findReplaceOpen) return false;
  return true;
}

const STORAGE_KEY = 'sdstudio-key-bindings';

export class KeyboardShortcutService {
  private userBindings: Record<string, string> = {};
  private keyToAction: Map<string, string[]> = new Map();

  constructor() {
    this.loadBindings();
    this.rebuildKeyMap();
  }

  private loadBindings() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        this.userBindings = JSON.parse(saved);
      }
    } catch {
      this.userBindings = {};
    }
  }

  private saveBindings() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.userBindings));
  }

  private rebuildKeyMap() {
    this.keyToAction.clear();
    for (const action of ACTIONS) {
      const key = this.userBindings[action.id] ?? action.defaultKey;
      if (key) {
        const existing = this.keyToAction.get(key) || [];
        existing.push(action.id);
        this.keyToAction.set(key, existing);
      }
    }
  }

  getBinding(actionId: string): string {
    return this.userBindings[actionId] ?? this.getDefaultKey(actionId) ?? '';
  }

  private getDefaultKey(actionId: string): string | undefined {
    return ACTIONS.find((a) => a.id === actionId)?.defaultKey;
  }

  setBinding(actionId: string, key: string) {
    this.userBindings[actionId] = key;
    this.saveBindings();
    this.rebuildKeyMap();
  }

  resetBinding(actionId: string) {
    delete this.userBindings[actionId];
    this.saveBindings();
    this.rebuildKeyMap();
  }

  resetToDefaults() {
    this.userBindings = {};
    this.saveBindings();
    this.rebuildKeyMap();
  }

  getAllActions(): (ShortcutAction & { currentKey: string })[] {
    return ACTIONS.map((a) => ({
      ...a,
      currentKey: this.getBinding(a.id),
    }));
  }

  /**
   * 카테고리별 충돌 범위(scope) 계산.
   * 활성화 조건이 동일한 카테고리들은 같은 scope로 묶여 충돌 검사됨.
   * - 'main': 메인 씬 리스트 화면 (global + scene)
   * - 'image-grid': 씬 내 이미지 그리드 (image-grid)
   * - 'viewer': 이미지 상세 창 (viewer)
   */
  static getConflictScope(category: string): string {
    if (category === 'viewer') return 'viewer';
    if (category === 'image-grid') return 'image-grid';
    return 'main'; // global + scene
  }

  findConflict(key: string, excludeActionId?: string): string | undefined {
    const excludeAction = ACTIONS.find((a) => a.id === excludeActionId);
    const excludeScope = excludeAction
      ? KeyboardShortcutService.getConflictScope(excludeAction.category)
      : null;
    for (const action of ACTIONS) {
      if (action.id === excludeActionId) continue;
      // 다른 scope 간 같은 키는 충돌이 아님 (활성화 조건이 상호배타적이라 공존 가능)
      if (
        excludeScope !== null &&
        KeyboardShortcutService.getConflictScope(action.category) !== excludeScope
      ) {
        continue;
      }
      const bound = this.getBinding(action.id);
      if (bound === key) return action.label;
    }
    return undefined;
  }

  static normalizeKey(e: KeyboardEvent): string {
    const parts: string[] = [];
    if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
    if (e.shiftKey) parts.push('Shift');
    if (e.altKey) parts.push('Alt');

    let key = e.key;
    // 수정자 키 자체는 무시
    if (['Control', 'Meta', 'Shift', 'Alt'].includes(key)) return '';

    // 키 이름 정규화
    if (key === ' ') key = 'Space';
    else if (key.length === 1) key = key.toUpperCase();
    else if (key === 'ArrowLeft') key = 'ArrowLeft';
    else if (key === 'ArrowRight') key = 'ArrowRight';
    else if (key === 'ArrowUp') key = 'ArrowUp';
    else if (key === 'ArrowDown') key = 'ArrowDown';

    parts.push(key);
    return parts.join('+');
  }

  static keyDisplayName(key: string): string {
    const isMac = navigator.platform.toUpperCase().includes('MAC');
    let result = key;
    if (isMac) {
      result = result
        .replace('Ctrl', '⌘')
        .replace('Shift', '⇧')
        .replace('Alt', '⌥');
    }
    return result
      .replace('ArrowLeft', '←')
      .replace('ArrowRight', '→')
      .replace('ArrowUp', '↑')
      .replace('ArrowDown', '↓')
      .replace('Delete', 'Del')
      .replace('Backspace', '⌫')
      .replace('Space', '␣');
  }

  // 판정 기준은 keyTargetGuard 단일 출처(raw keydown 리스너와 공유 — 2026-11-01 U0-b E7)
  private isInputFocused(): boolean {
    return isTextEntryFocused();
  }

  private getActionDef(actionId: string): ShortcutAction | undefined {
    return ACTIONS.find((a) => a.id === actionId);
  }

  handleKeyDown = (e: KeyboardEvent) => {
    const normalized = KeyboardShortcutService.normalizeKey(e);
    if (!normalized) return;

    const actionIds = this.keyToAction.get(normalized);
    if (!actionIds || actionIds.length === 0) return;

    // 공통 억제: input/textarea 포커스
    if (this.isInputFocused()) return;

    // 같은 키에 여러 카테고리 액션이 매핑될 수 있음 (예: ArrowLeft = viewer:prev-image + scene:scene-left)
    // ACTIONS 배열 정의 순서(viewer → scene → global)가 우선순위를 결정:
    // 뷰어가 열려 있으면 viewer 액션이 먼저 통과, 아니면 scene/global로 폴스루
    const gate: ShortcutGateState = {
      imageGridFocusable: appState.imageGridFocusable,
      resultViewerOpen: appState.resultViewerOpen,
      dialogCount: appState.dialogs.length,
      floatViewCount: appState.floatViewCount,
      undoFloatViewCount: appState.undoFloatViewCount,
      configScreenOpen: appState.configScreenOpen,
      pieceEditorOpen: appState.pieceEditorOpen,
      findReplaceOpen: appState.findReplaceOpen,
    };
    for (const actionId of actionIds) {
      const action = this.getActionDef(actionId);
      if (!action) continue;
      if (!isShortcutActionActive(action, gate)) continue;

      // 첫 번째로 조건을 통과한 액션 실행
      e.preventDefault();
      e.stopPropagation();
      window.dispatchEvent(
        new CustomEvent('shortcut-action', { detail: { action: actionId } }),
      );
      return;
    }
  };

  install() {
    window.addEventListener('keydown', this.handleKeyDown, true);
  }

  uninstall() {
    window.removeEventListener('keydown', this.handleKeyDown, true);
  }
}

export const keyboardShortcutService = isMobile
  ? (null as unknown as KeyboardShortcutService)
  : new KeyboardShortcutService();

// PC에서만 설치
if (!isMobile && keyboardShortcutService) {
  keyboardShortcutService.install();
}
