import React, { ReactNode, useEffect, useRef } from 'react';
import { useDrag, useDragLayer, useDrop } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';
import { backend } from '../models';
import { appState } from '../models/AppService';
import { ToolbarButtonPlacement, UiToolbarConfig } from '../../main/config';

// 툴바 버튼 드래그 커스터마이징 공용 부품.
// 드래그는 기존 uiToolbar.buttons 오버라이드('pinned'|'menu'|'hidden')를 조작하는
// "새 입력 수단"일 뿐 — 데이터 모델·해석(resolveToolbar)·환경설정 에디터는 그대로다.
// 씬 툴바/프로젝트 바는 아이템 타입으로 격리: 상대 영역 타깃이 accept 하지 않으므로
// 교차 드롭·영역 밖 드롭은 react-dnd 기본 동작(didDrop=false)으로 자동 취소된다.
// 모바일은 전역 DndProvider 의 TouchBackend(delayTouchStart 400ms) = 롱프레스로 잡기.

export type ToolbarGroup = 'scene' | 'project';

export const toolbarDndType = (group: ToolbarGroup) => `toolbar-btn/${group}`;

export interface ToolbarDragItem {
  id: string;
  name: string;
  // 어디서 잡았는지 — 행 하이라이트("여기 놓으면 빼내짐")는 메뉴발 드래그에만 표시
  from: 'inline' | 'menu';
  // 드래그 프리뷰용: 실제 버튼 JSX 그대로 + 원래 너비 (이름 알약로 바뀌면 혼동)
  node?: ReactNode;
  width?: number;
}

// 배치 변경을 즉시 반영 + config 저장.
// (환경설정을 열면 최신 config 를 읽으므로 에디터에도 자동 반영된다)
export async function applyToolbarPlacement(
  id: string,
  placement: ToolbarButtonPlacement,
): Promise<void> {
  const buttons = { ...(appState.uiToolbar.buttons ?? {}) };
  if (placement === 'default') delete buttons[id];
  else buttons[id] = placement;
  const next: UiToolbarConfig = {
    ...appState.uiToolbar,
    buttons: Object.keys(buttons).length > 0 ? buttons : undefined,
  };
  appState.uiToolbar = next;
  try {
    const config = await backend.getConfig();
    await backend.setConfig({ ...config, uiToolbar: next });
  } catch (e) {
    console.error('툴바 배치 저장 실패:', e);
  }
}

// 이 그룹의 드래그 상태 — active(흔들림·유령 ⋯·숨김 존), from(행 하이라이트 분기)
export function useToolbarDragState(group: ToolbarGroup): {
  active: boolean;
  from?: 'inline' | 'menu';
} {
  return useDragLayer((monitor) => {
    const active =
      monitor.isDragging() && monitor.getItemType() === toolbarDndType(group);
    return {
      active,
      from: active
        ? (monitor.getItem() as ToolbarDragItem | null)?.from
        : undefined,
    };
  });
}

export function useToolbarDragActive(group: ToolbarGroup): boolean {
  return useToolbarDragState(group).active;
}

// 인라인 버튼 래퍼 — 기존 버튼 JSX 를 감싸 드래그 소스만 부여(핸들러 재배선 없음).
// disabled=클래식 툴바 등. 드래그 중엔 자신은 반투명, 같은 그룹의 나머지는 흔들림.
export const DraggableToolbarButton = ({
  group,
  id,
  name,
  disabled,
  children,
}: {
  group: ToolbarGroup;
  id: string;
  name: string;
  disabled?: boolean;
  children: ReactNode;
}) => {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [{ isDragging }, drag, preview] = useDrag(
    () => ({
      type: toolbarDndType(group),
      item: (): ToolbarDragItem => ({
        id,
        name,
        from: 'inline',
        node: children,
        width: wrapRef.current?.offsetWidth,
      }),
      canDrag: !disabled,
      collect: (m) => ({ isDragging: m.isDragging() }),
    }),
    [group, id, name, disabled, children],
  );
  useEffect(() => {
    preview(getEmptyImage(), { captureDraggingState: true });
  }, [preview]);
  drag(wrapRef);
  const active = useToolbarDragActive(group);
  return (
    <div
      ref={wrapRef}
      className={
        (isDragging ? 'opacity-30 ' : '') +
        (active && !isDragging && !disabled ? 'toolbar-wiggle' : '')
      }
    >
      {children}
    </div>
  );
};

// ⋯ 버튼(또는 유령 ⋯) 드롭 래퍼 — 놓으면 메뉴로
export const ToolbarMenuDropTarget = ({
  group,
  children,
}: {
  group: ToolbarGroup;
  children: ReactNode;
}) => {
  const [{ isOver, canDrop }, drop] = useDrop(
    () => ({
      accept: toolbarDndType(group),
      drop: (item: ToolbarDragItem) => {
        applyToolbarPlacement(item.id, 'menu');
      },
      collect: (m) => ({ isOver: m.isOver(), canDrop: m.canDrop() }),
    }),
    [group],
  );
  return (
    <div
      ref={drop as any}
      className={
        isOver && canDrop ? 'rounded-full ring-2 ring-sky-400' : undefined
      }
    >
      {children}
    </div>
  );
};

// 툴바 행 전체 드롭 — 놓으면 인라인 고정(pinned). 안쪽 타깃(⋯)이 이미 처리한
// 드롭은 didDrop 으로 건너뛴다. 반환된 drop ref 를 행 컨테이너에 부착해 사용.
// isOver 는 행 하이라이트("이 영역에 놓으면 빼내짐") 피드백용.
export function useToolbarRowDrop(group: ToolbarGroup): {
  drop: ReturnType<typeof useDrop>[1];
  isOver: boolean;
} {
  const [{ isOver }, drop] = useDrop(
    () => ({
      accept: toolbarDndType(group),
      drop: (item: ToolbarDragItem, monitor) => {
        if (monitor.didDrop()) return;
        applyToolbarPlacement(item.id, 'pinned');
      },
      collect: (m) => ({ isOver: m.isOver({ shallow: true }) }),
    }),
    [group],
  );
  return { drop, isOver };
}

// 행 하이라이트 클래스 — 메뉴에서 빼내는 드래그 중일 때만 (빨간 점선 테두리,
// 올리면 진해짐). 인라인끼리의 드래그에는 표시하지 않는다(놓아도 변화 없음).
export function toolbarRowHighlightClass(
  drag: { active: boolean; from?: 'inline' | 'menu' },
  isOver: boolean,
): string {
  if (!drag.active || drag.from !== 'menu') return '';
  return isOver
    ? ' outline outline-2 outline-red-500 bg-red-500/10 rounded-lg'
    : ' outline-dashed outline-2 outline-red-400/70 rounded-lg';
}

// 드래그 중에만 화면 하단에 나타나는 "여기로 끌어서 숨기기" 존.
// z-2500: 시각 숨김된 메뉴 모달(2000)보다 위, 드래그 프리뷰 레이어(3000)보다 아래.
export const ToolbarHideZone = ({ group }: { group: ToolbarGroup }) => {
  const active = useToolbarDragActive(group);
  const [{ isOver }, drop] = useDrop(
    () => ({
      accept: toolbarDndType(group),
      drop: (item: ToolbarDragItem) => {
        applyToolbarPlacement(item.id, 'hidden');
      },
      collect: (m) => ({ isOver: m.isOver() }),
    }),
    [group],
  );
  if (!active) return null;
  return (
    <div
      ref={drop as any}
      className={
        'fixed bottom-6 left-1/2 -translate-x-1/2 z-[2500] px-5 py-2.5 rounded-full ' +
        'border-2 border-dashed text-sm select-none transition-colors ' +
        (isOver
          ? 'border-red-400 bg-red-500/20 text-red-500 dark:text-red-300'
          : 'border-gray-400 bg-[var(--c-zone)] text-muted')
      }
    >
      여기로 끌어서 숨기기
    </div>
  );
};
