import React, { useRef } from 'react';

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
