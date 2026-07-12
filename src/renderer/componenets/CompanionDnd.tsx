import React, { ReactNode, useEffect, useRef } from 'react';
import { useDrag, useDragLayer, useDrop } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';
import { observer } from 'mobx-react-lite';
import { backend, isMobile } from '../models';
import { appState } from '../models/AppService';
import { ToolbarDragItem, toolbarDndType, disarmToolbarDrag } from './ToolbarDnd';
import {
  COMPANION_HOSTS,
  assignCompanion,
  assignCompanionAt,
} from '../models/companionSlots';

// 동반 슬롯 편집모드 드래그&드랍 공용 부품(E4). PC 편집모드에서만 조작이 붙고, 렌더는 공용
// (편집모드 밖·모바일은 원본 그대로 = fragment, 레이아웃/동작 100% 무변화 = 회귀 기준).
//
// DnD 타입은 툴바와 공유한다(toolbarDndType = 'toolbar-btn/main'). 그래서:
//   · 툴바의 포터블 버튼(DraggableToolbarButton) 드래그를 호스트 행 드롭 타깃이 그대로 수락(배정).
//   · 동반 버튼 드래그(fromCompanion=hostKey 표식)를 툴바 드롭 타깃이 수락(removeCompanion+복귀).
// 순서 조정/재배정은 전부 순수 헬퍼(assignCompanion/assignCompanionAt) 경유 — 여기선 배열
// 직접 조작을 하지 않는다. L1-4 행 드래그(preset-row 타입)와는 타입 분리로 간섭하지 않는다.

const COMPANION_DND_TYPE = toolbarDndType('project'); // View 공유 상수 == 'toolbar-btn/main'

// 동반 슬롯 미러 갱신 + config 영속(즉시 반영 + 재시작 유지). ConfigScreen(E3 드롭다운)과
// E4 드래그가 공유하는 단일 출처 — applyToolbarMove/applyPresetOrder 선례처럼 새 객체 할당으로
// MobX 반응을 태워 열려 있는 프리셋 에디터/드롭다운에 즉시 반영한다.
export async function applyCompanionSlots(
  next: Record<string, string[]>,
): Promise<void> {
  appState.uiCompanionSlots = next;
  try {
    const config = await backend.getConfig();
    await backend.setConfig({ ...config, uiCompanionSlots: next });
  } catch (e) {
    console.error('동반 슬롯 저장 실패:', e);
  }
}

// "동반 슬롯이 수락 가능한 드래그"(포터블 툴바 버튼 또는 동반 버튼)가 실제로 진행 중인지 —
// 편집모드 시각 어포던스(호스트 행 외곽 강조)에 쓴다. 포터블 아이템만 슬롯에 실을 수 있으므로
// item.portable 로 판정(동반 버튼도 항상 portable=true 로 낸다).
function useCompanionDragActive(): boolean {
  return useDragLayer((monitor) => {
    const item = monitor.getItem() as ToolbarDragItem | null;
    return (
      monitor.isDragging() &&
      monitor.getItemType() === COMPANION_DND_TYPE &&
      !!item &&
      item.portable === true
    );
  });
}

// 가로 배치 동반 버튼의 삽입 중점 판정 — 커서가 대상 버튼 가로 중점보다 왼쪽이면 앞(before).
function isBeforeMidpoint(
  rect: DOMRect | undefined,
  client: { x: number; y: number } | null,
): boolean {
  if (!rect || !client) return true;
  return client.x < rect.left + rect.width / 2;
}

// 호스트 행 드롭 타깃(편집모드 전용, 항상 hook 을 태우려 내부 컴포넌트로 분리).
// 포터블 버튼(툴바에서 배정)·동반 버튼(다른 호스트에서 재배정)을 이 호스트 끝에 배정한다.
// 안쪽 동반 버튼 타깃이 순서 삽입을 이미 처리(didDrop)했으면 행 전체 드롭은 건너뛴다.
const CompanionHostRowInner = observer(
  ({ hostKey, children }: { hostKey: string; children: ReactNode }) => {
    const [{ isOver }, drop] = useDrop(
      () => ({
        accept: COMPANION_DND_TYPE,
        canDrop: (item: ToolbarDragItem) => item.portable === true,
        drop: (item: ToolbarDragItem, monitor) => {
          if (monitor.didDrop()) return;
          // 다른 호스트/툴바 → 이 호스트 끝에 배정. 같은 호스트 행 배경 재드롭도 끝으로(무해).
          const next = assignCompanion(appState.uiCompanionSlots, hostKey, item.id);
          applyCompanionSlots(next);
        },
        collect: (m) => ({
          isOver: m.isOver({ shallow: true }) && m.canDrop(),
        }),
      }),
      [hostKey],
    );
    const active = useCompanionDragActive();
    // 어포던스(기존 편집모드 sky 언어 재사용): 수락 가능한 드래그 중이면 dashed sky 외곽,
    // 커서가 이 행 배경 위(shallow)면 solid ring 로 강조. 드래그 없으면 표시 없음(투명 래퍼).
    // outline/ring 은 box-shadow 계열이라 레이아웃을 밀지 않는다(강조 시 흔들림 없음).
    const cls = active
      ? isOver
        ? 'rounded-lg ring-2 ring-sky-400'
        : 'rounded-lg outline-dashed outline-2 outline-sky-400/60'
      : '';
    return (
      <div ref={drop as any} className={cls || undefined}>
        {children}
      </div>
    );
  },
);

// 호스트 행 렌더 래퍼(공용). 편집모드(PC) && 합의된 호스트일 때만 드롭 타깃으로 감싸고,
// 그 외(평상시·모바일)는 원본 그대로(fragment) — 렌더/레이아웃 무변화.
export const CompanionHostRow = observer(
  ({ hostKey, children }: { hostKey: string; children: ReactNode }) => {
    const editing =
      appState.editMode && !isMobile && COMPANION_HOSTS.includes(hostKey);
    if (!editing) return <>{children}</>;
    return (
      <CompanionHostRowInner hostKey={hostKey}>{children}</CompanionHostRowInner>
    );
  },
);

// 동반 버튼 드래그 소스 + 순서 조정/재배정 드롭 타깃(편집모드 전용, 항상 hook 을 태우려 분리).
const CompanionButtonSlotInner = observer(
  ({
    hostKey,
    id,
    children,
  }: {
    hostKey: string;
    id: string;
    children: ReactNode;
  }) => {
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const [{ isDragging }, drag, preview] = useDrag(
      () => ({
        type: COMPANION_DND_TYPE,
        item: (): ToolbarDragItem => ({
          id,
          name: id,
          from: 'inline',
          portable: true, // 동반 슬롯 아이템은 항상 포터블(슬롯 자격 = 포터블)
          fromCompanion: hostKey, // 툴바 타깃이 removeCompanion 하도록 출처 표식
          node: children,
          width: wrapRef.current?.offsetWidth,
        }),
        collect: (m) => ({ isDragging: m.isDragging() }),
        end: () => disarmToolbarDrag(),
      }),
      [hostKey, id, children],
    );
    // 대상 버튼 앞/뒤(가로 중점)에 삽입 — 같은 호스트면 순서 조정, 다른 호스트/툴바면
    // 이 위치로 재배정. 자기 자신 드롭은 무시. 순수 assignCompanionAt 이 이동 의미론 처리.
    const [{ isOverInsert, insertBefore }, dropInsert] = useDrop(
      () => ({
        accept: COMPANION_DND_TYPE,
        canDrop: (item: ToolbarDragItem) =>
          item.portable === true && item.id !== id,
        drop: (item: ToolbarDragItem, monitor) => {
          if (monitor.didDrop()) return;
          if (item.id === id) return;
          const rect = wrapRef.current?.getBoundingClientRect();
          const before = isBeforeMidpoint(rect, monitor.getClientOffset());
          const next = assignCompanionAt(
            appState.uiCompanionSlots,
            hostKey,
            item.id,
            { id, side: before ? 'before' : 'after' },
          );
          applyCompanionSlots(next);
        },
        collect: (m) => {
          const item = m.getItem() as ToolbarDragItem | null;
          const over = m.isOver({ shallow: true }) && m.canDrop() && !!item;
          const rect = wrapRef.current?.getBoundingClientRect();
          const before = isBeforeMidpoint(rect, m.getClientOffset());
          return { isOverInsert: over, insertBefore: before };
        },
      }),
      [hostKey, id],
    );
    useEffect(() => {
      preview(getEmptyImage(), { captureDraggingState: true });
    }, [preview]);
    drag(dropInsert(wrapRef));

    // 삽입 위치 표시 — 커서 쪽(좌/우) 보더 강조(툴바/프리셋 행과 같은 sky 시각 언어).
    const insertClass = isOverInsert
      ? insertBefore
        ? ' border-l-2 border-sky-400 rounded-l'
        : ' border-r-2 border-sky-400 rounded-r'
      : '';
    return (
      <div
        ref={wrapRef}
        className={'cursor-grab' + (isDragging ? ' opacity-30' : '') + insertClass}
        title="드래그해 위치 이동"
        // 편집모드 중 동반 버튼 기능 오발 방지 — 클릭을 캡처 단계에서 흡수(드래그는 무영향).
        onClickCapture={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        {children}
      </div>
    );
  },
);

// 동반 버튼 렌더 래퍼(공용). 편집모드(PC)일 때만 드래그/드롭을 붙이고, 그 외는 원본 그대로.
export const CompanionButtonSlot = observer(
  ({
    hostKey,
    id,
    children,
  }: {
    hostKey: string;
    id: string;
    children: ReactNode;
  }) => {
    const editing = appState.editMode && !isMobile;
    if (!editing) return <>{children}</>;
    return (
      <CompanionButtonSlotInner hostKey={hostKey} id={id}>
        {children}
      </CompanionButtonSlotInner>
    );
  },
);
