import { appState } from './AppService';
import { isMobile } from '.';

export interface ShortcutAction {
  id: string;
  label: string;
  category: 'global' | 'viewer' | 'scene';
  defaultKey: string;
}

const ACTIONS: ShortcutAction[] = [
  // 뷰어 액션 (ResultViewer가 열려 있을 때만 작동)
  { id: 'toggle-favorite', label: '즐겨찾기 토글', category: 'viewer', defaultKey: 'Ctrl+D' },
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
  { id: 'scene-queue-add', label: '포커스 씬 예약 추가', category: 'scene', defaultKey: 'Ctrl+A' },
  { id: 'queue-run', label: '예약 실행', category: 'scene', defaultKey: 'Space' },
  { id: 'queue-clear', label: '모든 씬 예약 취소', category: 'scene', defaultKey: 'Ctrl+D' },

  // 전역 액션
  { id: 'tab-1', label: '이미지생성 탭', category: 'global', defaultKey: 'Ctrl+1' },
  { id: 'tab-2', label: '이미지변형 탭', category: 'global', defaultKey: 'Ctrl+2' },
  { id: 'tab-3', label: '웹 검색 탭', category: 'global', defaultKey: 'Ctrl+3' },
  { id: 'toggle-left-panel', label: '좌측 패널 토글', category: 'global', defaultKey: 'Ctrl+B' },
  { id: 'queue-all-scenes', label: '모든 씬 예약', category: 'global', defaultKey: 'Ctrl+G' },
  { id: 'toggle-project-favorite', label: '프로젝트 즐겨찾기 토글', category: 'global', defaultKey: 'Ctrl+F' },
  { id: 'open-sampling-settings', label: '샘플링/모델 설정 열기', category: 'global', defaultKey: 'Ctrl+M' },
  { id: 'open-piece-editor', label: '프롬프트조각 열기', category: 'global', defaultKey: 'Ctrl+P' },
  { id: 'open-config', label: '환경설정 열기', category: 'global', defaultKey: 'Ctrl+,' },
];

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

  findConflict(key: string, excludeActionId?: string): string | undefined {
    const excludeAction = ACTIONS.find((a) => a.id === excludeActionId);
    for (const action of ACTIONS) {
      if (action.id === excludeActionId) continue;
      // 다른 카테고리 간 같은 키는 충돌이 아님 (우선순위로 분기)
      if (excludeAction && action.category !== excludeAction.category) continue;
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

  private isInputFocused(): boolean {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea') return true;
    if ((el as HTMLElement).isContentEditable) return true;
    // webview 내부 포커스도 체크
    if (tag === 'webview') return true;
    return false;
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
    for (const actionId of actionIds) {
      const action = this.getActionDef(actionId);
      if (!action) continue;

      if (action.category === 'viewer') {
        if (!appState.resultViewerOpen) continue;
        if (appState.dialogs.length > 0) continue;
      } else if (action.category === 'scene') {
        if (appState.floatViewCount > 0) continue;
        if (appState.dialogs.length > 0) continue;
        if (appState.configScreenOpen) continue;
        if (appState.pieceEditorOpen) continue;
      } else {
        // global
        if (appState.floatViewCount > 0) continue;
        if (appState.dialogs.length > 0) continue;
        if (appState.configScreenOpen) continue;
        if (appState.pieceEditorOpen) continue;
      }

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
