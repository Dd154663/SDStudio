import React, { useCallback, useRef } from 'react';
import { appState } from '../models/AppService';
import {
  DISCARD_CHANGES_CONFIRM,
  DISCARD_CHANGES_TEXT,
  GuardedCloseState,
  runGuardedClose,
} from '../models/escapeGate';

/**
 * 직접 만든 창의 바깥(백드롭) 클릭 닫기 — ModalOverlay 와 같은 규칙(2026-10-03 U1·X6):
 * 마우스를 **누른 곳과 뗀 곳이 모두 백드롭 자신**일 때만 닫는다. 창 안에서 글자를 드래그 선택하다
 * 바깥에서 떼는 경우(click 은 공통 조상인 백드롭에서 발생)에 창이 닫히던 문제를 막는다.
 * 백드롭 요소에 반환값을 그대로 펼쳐 쓴다: `<div {...backdrop}>`. 안쪽 창의 stopPropagation 은 없어도 된다.
 */
export function useBackdropClose(onClose: () => void) {
  const downOnBackdrop = useRef(false);
  return {
    onMouseDown: (e: React.MouseEvent) => {
      downOnBackdrop.current = e.target === e.currentTarget;
    },
    onClick: (e: React.MouseEvent) => {
      const ok = downOnBackdrop.current && e.target === e.currentTarget;
      downOnBackdrop.current = false;
      if (ok) onClose();
    },
  };
}

/** 「저장하지 않은 변경이 있습니다. 버리고 닫을까요?」 확인 — 미저장 가드 공용(2026-10-03 E2-3). */
export function confirmDiscardChanges(): Promise<boolean> {
  return appState.confirmAsync(DISCARD_CHANGES_TEXT, DISCARD_CHANGES_CONFIRM, {
    danger: true,
  });
}

/**
 * 미저장 가드를 거친 닫기 요청(2026-10-03 E2-3) — 직접 만든 창(PresetEditModal 등)과 ModalOverlay 가 쓴다.
 * ✕·바깥 클릭·Esc/뒤로 가기(useBackLayer)·바닥 [취소] 를 모두 이 함수 하나로 보낸다. dirty() 가 참이면
 * 확인 창 뒤 확인했을 때만 onClose, 확인 창이 떠 있는 동안 들어온 요청은 무시한다. dirty 가 없으면 바로 onClose.
 * dirty·onClose 는 늦게 읽는다(매 렌더 새 함수여도 된다). [저장] 성공 뒤 닫기는 onClose 를 직접 부른다.
 */
export function useGuardedClose(
  dirty: (() => boolean) | undefined,
  onClose: () => void,
): () => void {
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const state = useRef<GuardedCloseState>({ pending: false });
  return useCallback(() => {
    void runGuardedClose(
      state.current,
      dirtyRef.current,
      () => onCloseRef.current(),
      confirmDiscardChanges,
    );
  }, []);
}
