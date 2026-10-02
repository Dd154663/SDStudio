import { useEffect, useRef } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { isMobile } from './index';
import {
  decide,
  hasOwnEscCancel,
  isEditableTarget,
  isImeComposing,
  LayerEntry,
  LayerOptions,
} from './escapeGate';

export type { LayerAction, LayerOptions } from './escapeGate';

export interface BackStackHandle {
  remove: () => void;
}

/**
 * 안드로이드 하드웨어 뒤로가기 버튼 + PC Esc 를 위한 중앙 닫기 스택(닫기 관문).
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
 *
 * Esc 관문(2026-10-03 U1·X2): 같은 스택을 PC Esc 에도 쓴다. window keydown 에 관문 리스너를 이 모듈이
 * 한 번만 붙이고(모듈 로드 시 — 컴포넌트 리스너보다 먼저), Esc 는 맨 위 항목 하나만 처리한 뒤
 * stopImmediatePropagation 으로 다른 Esc 리스너에 넘기지 않는다. 글자 입력칸에서 온 Esc 는 버블 단계로
 * 미뤄, 입력칸 자신의 처리(자동완성 닫기 등 — 전파를 멈춤)나 data-esc-cancel 표시(인라인 이름 편집 취소)가
 * 먼저 쓰이게 한다. 항목별 동작·선점 규칙은 models/escapeGate.ts.
 */
class BackStackService {
  private stack: LayerEntry[] = [];
  private nextId = 1;
  private listenerRequested = false;

  /**
   * 오버레이를 백스택에 올린다. 반환된 handle.remove() 를 닫힐 때 호출한다.
   * onClose 는 뒤로가기·Esc 시 호출될 콜백(보통 열림 상태를 false 로 만드는 함수).
   * opts 로 Esc·뒤로 가기 동작을 바꿀 수 있다(escapeGate.ts LayerOptions).
   */
  push(onClose: () => void, opts: LayerOptions = {}): BackStackHandle {
    const id = this.nextId++;
    this.stack.push({ id, onClose, opts });
    this.ensureListener();
    return {
      remove: () => {
        const idx = this.stack.findIndex((e) => e.id === id);
        if (idx !== -1) this.stack.splice(idx, 1);
      },
    };
  }

  /** 현재 쌓인 항목 수(테스트·진단용). */
  get size() {
    return this.stack.length;
  }

  /**
   * 부팅 직후 한 번 호출해 backButton 리스너를 미리 등록한다. 아무 오버레이도
   * 열려 있지 않을 때 뒤로가기를 눌러도 앱이 종료되지 않고 최소화되도록
   * (백그라운드 생성 유지를 위해) 스택이 비어 있어도 리스너가 필요하다.
   */
  init() {
    this.ensureListener();
  }

  handleBack = () => {
    // 맨 위 항목만 닫는다. 스택에서의 실제 제거는 컴포넌트 cleanup(handle.remove)
    // 이 담당한다 — onClose 로 인해 top 항목이 닫히지 않으면(가드된 경우) 다음
    // 뒤로가기에서 같은 항목을 다시 시도하게 되어 기존 FloatView 동작과 일치한다.
    const d = decide(this.stack, 'back');
    if (d.kind === 'none') {
      CapacitorApp.minimizeApp();
    } else if (d.kind === 'run') {
      d.run();
    }
  };

  /**
   * PC Esc 관문. capture 단계: 글자 입력칸이 아닌 곳의 Esc 를 바로 처리한다.
   * bubble 단계: 입력칸에서 온 Esc 중 아무도 전파를 멈추지 않았고 입력칸이 data-esc-cancel 로
   * 「내가 취소로 처리」를 표시하지 않았으면 처리한다. IME 조합 중 Esc 는 건드리지 않는다.
   */
  handleEscapeKey = (e: KeyboardEvent, phase: 'capture' | 'bubble') => {
    if (e.key !== 'Escape' && e.key !== 'Esc') return;
    if (isImeComposing(e)) return;
    const editable = isEditableTarget(e.target);
    if (phase === 'capture' ? editable : !editable) return;
    if (editable && hasOwnEscCancel(e.target)) return;
    const d = decide(this.stack, 'escape');
    if (d.kind === 'none' || d.kind === 'self') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (d.kind === 'run') d.run();
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

// Esc 관문 리스너 — 모듈 로드 시 한 번(컴포넌트 effect 의 리스너보다 먼저 붙어야 맨 위 한 겹 규칙이 선다).
if (typeof window !== 'undefined') {
  window.addEventListener(
    'keydown',
    (e) => backStackService.handleEscapeKey(e, 'capture'),
    true,
  );
  window.addEventListener('keydown', (e) =>
    backStackService.handleEscapeKey(e, 'bubble'),
  );
}

/**
 * SPEC §5 표준 연결 패턴의 훅 버전: active 인 동안 닫기 스택에 올린다(뒤로 가기·Esc 공용).
 * onClose·opts 는 최신 값을 늦게 읽으므로 렌더마다 새 함수여도 스택 순서가 흔들리지 않는다.
 */
export function useBackLayer(
  active: boolean,
  onClose: () => void,
  opts?: LayerOptions,
) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const optsRef = useRef(opts);
  optsRef.current = opts;
  useEffect(() => {
    if (!active) return undefined;
    const live: LayerOptions = {
      get escape() {
        return optsRef.current?.escape;
      },
      get back() {
        return optsRef.current?.back;
      },
      get preempt() {
        return optsRef.current?.preempt;
      },
    };
    const handle = backStackService.push(() => onCloseRef.current(), live);
    return () => handle.remove();
  }, [active]);
}
