import { App as CapacitorApp } from '@capacitor/app';
import { isMobile } from './index';

export interface BackStackHandle {
  remove: () => void;
}

interface BackStackEntry {
  id: number;
  onClose: () => void;
}

/**
 * 안드로이드 하드웨어 뒤로가기 버튼을 위한 중앙 백스택.
 *
 * 기존에는 FloatView 만 backButton 리스너를 등록하고, effect(deps=[views])
 * cleanup 에서 CapacitorApp.removeAllListeners() 를 호출했다. 이 때문에
 * ① FloatView 가 아닌 오버레이(ModalOverlay 계열·드로어·확인창)는 뒤로가기로
 * 닫히지 않고 앱이 최소화되며 ② 다른 곳에서 등록한 Capacitor 리스너
 * (androidBackend 의 appStateChange 등)까지 조용히 삭제되는 문제가 있었다.
 *
 * 이 서비스는 backButton 리스너를 앱 전체에서 '한 번만' 등록한다. 각 오버레이는
 * 열릴 때 push(onClose) 로 스택에 자기 자신을 올리고, 반환된 handle.remove() 로
 * 닫힐 때 스스로 내려온다. 뒤로가기 시에는 스택 맨 위 항목의 onClose 만
 * 호출하고(스택에서의 제거는 각 컴포넌트 cleanup 이 담당 — onClose 가 열림
 * 상태를 false 로 만들면 effect cleanup 이 handle.remove 로 이어진다), 스택이
 * 비어 있으면 앱을 최소화한다. removeAllListeners 는 절대 호출하지 않는다.
 */
class BackStackService {
  private stack: BackStackEntry[] = [];
  private nextId = 1;
  private listenerRequested = false;

  /**
   * 오버레이를 백스택에 올린다. 반환된 handle.remove() 를 닫힐 때 호출한다.
   * onClose 는 뒤로가기 시 호출될 콜백(보통 열림 상태를 false 로 만드는 함수).
   */
  push(onClose: () => void): BackStackHandle {
    const id = this.nextId++;
    this.stack.push({ id, onClose });
    this.ensureListener();
    return {
      remove: () => {
        const idx = this.stack.findIndex((e) => e.id === id);
        if (idx !== -1) this.stack.splice(idx, 1);
      },
    };
  }

  /**
   * 부팅 직후 한 번 호출해 backButton 리스너를 미리 등록한다. 아무 오버레이도
   * 열려 있지 않을 때 뒤로가기를 눌러도 앱이 종료되지 않고 최소화되도록
   * (백그라운드 생성 유지를 위해) 스택이 비어 있어도 리스너가 필요하다.
   */
  init() {
    this.ensureListener();
  }

  private handleBack = () => {
    // 맨 위 항목만 닫는다. 스택에서의 실제 제거는 컴포넌트 cleanup(handle.remove)
    // 이 담당한다 — onClose 로 인해 top 항목이 닫히지 않으면(가드된 경우) 다음
    // 뒤로가기에서 같은 항목을 다시 시도하게 되어 기존 FloatView 동작과 일치한다.
    const top = this.stack[this.stack.length - 1];
    if (top) {
      top.onClose();
    } else {
      CapacitorApp.minimizeApp();
    }
  };

  private ensureListener() {
    if (!isMobile || this.listenerRequested) return;
    this.listenerRequested = true;
    // 앱 수명 동안 한 번만 등록하고 절대 제거하지 않는다.
    try {
      CapacitorApp.addListener('backButton', this.handleBack);
    } catch (e) {}
  }
}

export const backStackService = new BackStackService();
