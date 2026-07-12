import React, { ReactNode, useEffect, useRef } from 'react';
import { useDrag, useDragLayer, useDrop } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';
import { observable, runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { backend, isMobile } from '../models';
import { appState } from '../models/AppService';
import { ToolbarButtonPlacement, UiToolbarConfig } from '../../main/config';
import {
  TOOLBAR_VIEW_MAIN,
  ToolbarButtonMeta,
  ToolbarMove,
  moveToolbarButton,
} from '../models/uiLayout';
import { removeCompanion } from '../models/companionSlots';

// 툴바 버튼 드래그 커스터마이징 공용 부품.
// 드래그는 기존 uiToolbar.buttons 오버라이드('pinned'|'menu'|'hidden')를 조작하는
// "새 입력 수단"일 뿐 — 데이터 모델·해석(resolveToolbar)·환경설정 에디터는 그대로다.
// 씬 툴바/프로젝트 바는 아이템 타입으로 격리: 상대 영역 타깃이 accept 하지 않으므로
// 교차 드롭·영역 밖 드롭은 react-dnd 기본 동작(didDrop=false)으로 자동 취소된다.
// 모바일은 전역 DndProvider 의 TouchBackend(delayTouchStart 400ms) = 롱프레스로 잡기.

export type ToolbarGroup = 'scene' | 'project';

// DnD 아이템 타입을 View(메인 화면) 단위로 공유한다 — 씬·프로젝트 영역이 같은
// 타입을 쓰므로 서로의 드롭 타깃이 accept 대상이 된다. 실제 "이 드롭을 받을지"는
// 각 타깃의 canDrop(item.area===자기 area 또는 item.portable)이 판정한다.
// group 인자는 호출부 호환을 위해 유지하되 반환값은 고정 상수다.
const TOOLBAR_VIEW_MAIN_DND_TYPE = 'toolbar-btn/main';
export const toolbarDndType = (_group: ToolbarGroup) => TOOLBAR_VIEW_MAIN_DND_TYPE;

// 롱프레스 "잡힘" 상태 — TouchBackend 는 딜레이(400ms) 뒤 첫 이동에서야 드래그를
// 시작하므로, 그것만으로는 잡힌 순간의 피드백이 없다. 같은 400ms 타이머로 잡힘을
// 따로 추적해 즉시 흔들림+햅틱을 낸다 (PC 마우스 드래그는 즉시라 불필요).
export const toolbarDragUi = observable({
  armed: null as ToolbarGroup | null,
  armedId: null as string | null,
  armedFrom: null as 'inline' | 'menu' | null,
});

export const LONG_PRESS_MS = 400; // App.tsx DndProvider 의 delayTouchStart 와 동일 값

// 잡힘 햅틱 — navigator.vibrate 는 Android WebView 미구현이라 Capacitor Haptics
// 네이티브 경로를 쓴다 (VIBRATE 권한은 AndroidManifest 에 있음). 실패 시 무시.
export async function hapticTick() {
  if (!isMobile) return;
  try {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    await Haptics.impact({ style: ImpactStyle.Medium });
  } catch {
    try {
      navigator.vibrate?.(30);
    } catch {}
  }
}

export function armToolbarDrag(
  group: ToolbarGroup,
  id: string,
  from: 'inline' | 'menu',
) {
  runInAction(() => {
    toolbarDragUi.armed = group;
    toolbarDragUi.armedId = id;
    toolbarDragUi.armedFrom = from;
  });
  hapticTick();
}

export function disarmToolbarDrag() {
  if (toolbarDragUi.armed === null && toolbarDragUi.armedId === null) return;
  runInAction(() => {
    toolbarDragUi.armed = null;
    toolbarDragUi.armedId = null;
    toolbarDragUi.armedFrom = null;
  });
}

// ⋯ 메뉴가 "시각 숨김"돼야 하는 잡힘 상태인지 (dndType 문자열 기준) —
// 메뉴 행을 잡는 순간(드래그 이동 전) 모달을 치워 드롭 타깃(툴바)을 노출한다.
export function isMenuDragArmed(dndType?: string): boolean {
  return (
    !!dndType &&
    toolbarDragUi.armed !== null &&
    toolbarDndType(toolbarDragUi.armed) === dndType &&
    toolbarDragUi.armedFrom === 'menu'
  );
}

export interface ToolbarDragItem {
  id: string;
  name: string;
  // 어디서 잡았는지 — 행 하이라이트("여기 놓으면 빼내짐")는 메뉴발 드래그에만 표시
  from: 'inline' | 'menu';
  // 이 버튼의 홈 영역(TOOLBAR_VIEW_MAIN 의 area). 순서 재배열(인덱스 드롭)은
  // 같은 area 안에서만 허용 — 드롭 타깃의 canDrop 이 item.area 로 판정한다.
  area?: string;
  // portable 버튼(문맥 독립)만 타 영역 드롭을 허용한다. 드롭 타깃의 canDrop 이
  // item.area===자기 area(재배열) 또는 item.portable(크로스 삽입)을 수락한다.
  portable?: boolean;
  // 드래그 프리뷰용: 실제 버튼 JSX 그대로 + 원래 너비 (이름 알약로 바뀌면 혼동)
  node?: ReactNode;
  width?: number;
  // E4: 이 드래그가 "동반 슬롯"에서 시작됐으면 그 호스트 hostKey. 있으면 툴바 드롭
  // 타깃들이 배치 이동과 함께 removeCompanion(파생 숨김 해제)까지 원자로 적용해
  // 툴바로 자연스럽게 복귀시킨다(없으면=일반 툴바 아이템, 기존 동작 무변화).
  fromCompanion?: string;
}

// TOOLBAR_VIEW_MAIN 에서 이 버튼 id 의 홈 영역(area)을 찾는다. 없으면 undefined.
function homeAreaOf(id: string): string | undefined {
  for (const { area, registry } of TOOLBAR_VIEW_MAIN) {
    if (registry.some((b) => b.id === id)) return area;
  }
  return undefined;
}

// TOOLBAR_VIEW_MAIN 전체에서 이 버튼 id 의 meta 를 찾는다. 없으면 undefined.
// (⋯메뉴 행 드래그도 portable 판정에 사용 — ToolbarOverflowMenu 가 import)
export function metaOf(id: string): ToolbarButtonMeta | undefined {
  for (const { registry } of TOOLBAR_VIEW_MAIN) {
    const found = registry.find((b) => b.id === id);
    if (found) return found;
  }
  return undefined;
}

// 배치/순서 변경의 단일 관문 — moveToolbarButton(순수함수)이 계산한 다음
// uiToolbar 를 즉시 반영 + config 저장. (환경설정을 열면 최신 config 를 읽으므로
// 에디터에도 자동 반영된다). v2 areas 와 v1 buttons 는 moveToolbarButton 이 함께
// 갱신(dual-write)하므로 두 스키마가 어긋나지 않는다.
export async function applyToolbarMove(move: ToolbarMove): Promise<void> {
  const next = moveToolbarButton(TOOLBAR_VIEW_MAIN, appState.uiToolbar, move);
  appState.uiToolbar = next;
  try {
    const config = await backend.getConfig();
    await backend.setConfig({ ...config, uiToolbar: next });
  } catch (e) {
    console.error('툴바 배치 저장 실패:', e);
  }
}

// E4: 동반 슬롯에서 온 버튼을 툴바로 되돌린다 — removeCompanion(파생 숨김 해제)과
// moveToolbarButton(놓은 위치로 배치)을 한 번의 getConfig/setConfig 로 원자 반영한다.
// 두 미러(uiCompanionSlots·uiToolbar)를 따로 저장하면 각자의 getConfig 가 서로의 갱신을
// 못 봐 한쪽이 유실될 수 있으므로 반드시 함께 저장한다. slot/anchor 는 놓은 위치를 담아
// "원자리든 지정 위치든 자연스럽게 복귀"시킨다.
export async function applyToolbarMoveFromCompanion(
  move: ToolbarMove,
): Promise<void> {
  const nextToolbar = moveToolbarButton(TOOLBAR_VIEW_MAIN, appState.uiToolbar, move);
  const nextSlots = removeCompanion(appState.uiCompanionSlots, move.id);
  appState.uiToolbar = nextToolbar;
  appState.uiCompanionSlots = nextSlots;
  try {
    const config = await backend.getConfig();
    await backend.setConfig({
      ...config,
      uiToolbar: nextToolbar,
      uiCompanionSlots: nextSlots,
    });
  } catch (e) {
    console.error('동반→툴바 복귀 저장 실패:', e);
  }
}

// 기존 배치 API(핀 고정·메뉴로·숨김·기본) — 내부는 applyToolbarMove 위임으로
// 재구현해 모든 배치 변경이 moveToolbarButton 을 경유하게 한다. 홈 영역은
// TOOLBAR_VIEW_MAIN 에서 id 로 판정(없으면 조용히 무시 = 과거 잔재 id 안전).
export async function applyToolbarPlacement(
  id: string,
  placement: ToolbarButtonPlacement,
): Promise<void> {
  const toArea = homeAreaOf(id);
  if (!toArea) return;
  const slot: ToolbarMove['slot'] =
    placement === 'pinned' ? 'inline' : placement;
  await applyToolbarMove({ id, toArea, slot });
}

// 이 그룹의 드래그 상태 — active(흔들림·유령 ⋯·숨김 존), from(행 하이라이트 분기).
// 실제 드래그(react-dnd) 이전이라도 롱프레스 "잡힘"이면 active 로 취급해
// 잡히는 순간부터 모든 피드백(빨간 행 테두리·숨김 존 포함)이 시작되게 한다.
// (mobx observable 을 읽으므로 호출 컴포넌트는 observer 여야 함 — 현재 전부 observer)
export function useToolbarDragState(group: ToolbarGroup): {
  active: boolean;
  from?: 'inline' | 'menu';
} {
  const layer = useDragLayer((monitor) => {
    const item = monitor.getItem() as ToolbarDragItem | null;
    // 타입은 View 공유라 아이템 타입만으로는 부족 — 이 그룹이 "수락 가능한"
    // 드래그일 때만 active(흔들림·유령 ⋯·숨김 존). 즉 같은 area(재배열) 또는
    // portable(크로스 삽입). 타 영역의 비-portable 드래그엔 반응하지 않는다.
    const acceptable = !!item && (item.area === group || item.portable === true);
    const active =
      monitor.isDragging() &&
      monitor.getItemType() === toolbarDndType(group) &&
      acceptable;
    return {
      active,
      from: active ? item?.from : undefined,
    };
  });
  if (layer.active) return layer;
  if (toolbarDragUi.armed === group) {
    return { active: true, from: toolbarDragUi.armedFrom ?? 'inline' };
  }
  // 편집 모드 동안은 드래그가 없어도 상시 active — 흔들림·유령 ⋯·숨김 존이
  // 항상 보여 "드래그로 편집할 수 있음"을 안내한다. from 은 undefined 유지
  // (빨간 "빼내짐" 행 하이라이트는 메뉴발 드래그 전용 — 기존 조건 그대로).
  if (appState.editMode) {
    return { active: true, from: undefined };
  }
  return layer;
}

export function useToolbarDragActive(group: ToolbarGroup): boolean {
  return useToolbarDragState(group).active;
}

// 인라인 버튼 래퍼 — 기존 버튼 JSX 를 감싸 드래그 소스 + (순서 재배열용) 드롭 타깃.
// disabled=클래식 툴바 등. 롱프레스 잡힘 즉시 자신은 확대, 같은 그룹은 흔들림.
// area = 이 버튼의 홈 영역(TOOLBAR_VIEW_MAIN 의 area). index = 현재 inline 배열상 위치.
// 같은 area 의 다른 버튼을 이 버튼 위로 끌어오면 중점 기준 앞/뒤에 삽입한다
// (canDrop 이 item.area === 자기 area 만 수락 — 교차 영역은 Phase B 예정).
// orientation: 'h'(기본)=가로 툴바(가로 중점 판정) / 'v'=세로 스택(프로젝트
// 사이드 바 — 세로 중점 판정 + 위/아래 보더 강조).
export const DraggableToolbarButton = observer(
  ({
    group,
    id,
    name,
    area,
    index,
    disabled,
    orientation = 'h',
    children,
  }: {
    group: ToolbarGroup;
    id: string;
    name: string;
    // 홈 영역 — 순서 재배열 삽입 대상 영역이자 같은 영역 수락 판정 기준
    area: string;
    // 현재 inline 배열에서의 위치 — 삽입은 앵커(id 기준)로 처리하므로 로직에는
    // 안 쓰이지만, 렌더 순서가 바뀔 때 드롭 타깃 재생성을 보장하는 키로 유지
    index: number;
    disabled?: boolean;
    orientation?: 'h' | 'v';
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
          area,
          portable: metaOf(id)?.portable === true,
          node: children,
          width: wrapRef.current?.offsetWidth,
        }),
        canDrag: !disabled,
        collect: (m) => ({ isDragging: m.isDragging() }),
        end: () => disarmToolbarDrag(),
      }),
      [group, id, name, area, disabled, children],
    );

    // 순서 재배열 드롭 타깃 — 같은 area 의 버튼만 수락. hover 시 커서가 이 버튼의
    // 중점(가로/세로는 orientation)보다 앞이면 앞, 뒤면 뒤(index+1)에 삽입.
    // 자기 자신 위로의 드롭은 무시(변화 없음). before 는 보더 강조에 쓴다.
    const isBeforeMidpoint = (
      rect: DOMRect | undefined,
      client: { x: number; y: number } | null,
    ): boolean => {
      if (!rect || !client) return true;
      return orientation === 'v'
        ? client.y < rect.top + rect.height / 2
        : client.x < rect.left + rect.width / 2;
    };
    const [{ isOverInsert, insertBefore }, dropInsert] = useDrop(
      () => ({
        accept: toolbarDndType(group),
        // 같은 area(재배열) 또는 portable(타 영역에서 크로스 삽입) 수락.
        // 어느 쪽이든 toArea 는 이 버튼의 area 이므로 아래 앵커 삽입 로직은 동일.
        canDrop: (item: ToolbarDragItem) =>
          (item.area === area || item.portable === true) && item.id !== id,
        drop: (item: ToolbarDragItem, monitor) => {
          if (monitor.didDrop()) return;
          if ((item.area !== area && item.portable !== true) || item.id === id)
            return;
          const rect = wrapRef.current?.getBoundingClientRect();
          const client = monitor.getClientOffset();
          const before = isBeforeMidpoint(rect, client);
          // 앵커 기반 삽입("이 버튼의 앞/뒤") — 숫자 인덱스는 같은 배열 내 이동 시
          // 제거 오프셋, 모바일 pcOnly 필터로 렌더/정규 배열이 어긋나는 문제가 있어
          // moveToolbarButton 이 제거 후 배열에서 앵커를 찾아 삽입한다.
          const move: ToolbarMove = {
            id: item.id,
            toArea: area,
            slot: 'inline',
            anchor: { id, side: before ? 'before' : 'after' },
          };
          // 동반 슬롯 출처면 배치 이동 + removeCompanion 을 원자로(툴바 복귀).
          if (item.fromCompanion !== undefined) {
            applyToolbarMoveFromCompanion(move);
          } else {
            applyToolbarMove(move);
          }
        },
        collect: (m) => {
          const item = m.getItem() as ToolbarDragItem | null;
          const over =
            m.isOver({ shallow: true }) && m.canDrop() && !!item;
          const client = m.getClientOffset();
          const rect = wrapRef.current?.getBoundingClientRect();
          const before = isBeforeMidpoint(rect, client);
          return { isOverInsert: over, insertBefore: before };
        },
      }),
      [group, id, area, index, orientation],
    );

    useEffect(() => {
      preview(getEmptyImage(), { captureDraggingState: true });
    }, [preview]);
    // 드래그 소스 + 드롭 타깃을 같은 래퍼에 부착
    drag(dropInsert(wrapRef));

    // 모바일 롱프레스 잡힘 감지 — 400ms 전에 움직이면(스크롤 의도) 취소
    const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const clearArmTimer = () => {
      if (armTimer.current) {
        clearTimeout(armTimer.current);
        armTimer.current = null;
      }
    };
    const onTouchStart = () => {
      if (disabled || !isMobile) return;
      clearArmTimer();
      armTimer.current = setTimeout(() => {
        armTimer.current = null;
        armToolbarDrag(group, id, 'inline');
      }, LONG_PRESS_MS);
    };
    const onTouchEndOrCancel = () => {
      clearArmTimer();
      if (!isDragging) disarmToolbarDrag();
    };

    const active = useToolbarDragActive(group);
    const armed = toolbarDragUi.armed === group;
    const armedSelf = armed && toolbarDragUi.armedId === id;
    // 삽입 위치 표시 — 커서 쪽 보더 강조(기존 하이라이트 색조 sky 계열과 일관).
    // 세로 스택은 위/아래 보더로.
    const insertClass = isOverInsert
      ? orientation === 'v'
        ? insertBefore
          ? ' border-t-2 border-sky-400 rounded-t'
          : ' border-b-2 border-sky-400 rounded-b'
        : insertBefore
          ? ' border-l-2 border-sky-400 rounded-l'
          : ' border-r-2 border-sky-400 rounded-r'
      : '';
    return (
      <div
        ref={wrapRef}
        onTouchStart={onTouchStart}
        onTouchMove={clearArmTimer}
        onTouchEnd={onTouchEndOrCancel}
        onTouchCancel={onTouchEndOrCancel}
        // 편집 모드 중 버튼 기능 오발 방지 — 클릭을 캡처 단계에서 흡수.
        // 드래그는 click 이벤트가 아니라 영향 없음(재배열은 그대로 동작).
        onClickCapture={
          appState.editMode
            ? (e) => {
                e.preventDefault();
                e.stopPropagation();
              }
            : undefined
        }
        className={
          (isDragging
            ? 'opacity-30'
            : armedSelf
              ? 'scale-110 drop-shadow-md transition-transform'
              : (active || armed) && !disabled
                ? 'toolbar-wiggle'
                : '') + insertClass
        }
      >
        {children}
      </div>
    );
  },
);

// ⋯ 버튼(또는 유령 ⋯) 드롭 래퍼 — 놓으면 메뉴로.
// area = 이 ⋯ 가 속한 영역(소비처에서 전달). 크로스 드롭은 이 area 의 메뉴로 이동.
export const ToolbarMenuDropTarget = ({
  group,
  area,
  children,
}: {
  group: ToolbarGroup;
  area: string;
  children: ReactNode;
}) => {
  const [{ isOver, canDrop }, drop] = useDrop(
    () => ({
      accept: toolbarDndType(group),
      // 같은 area(자기 영역 메뉴로) 또는 portable(타 영역·동반 슬롯 메뉴로) 수락.
      canDrop: (item: ToolbarDragItem) =>
        item.area === area || item.portable === true,
      drop: (item: ToolbarDragItem) => {
        if (item.fromCompanion !== undefined) {
          // 동반 슬롯 → 이 영역 메뉴로 이동 + removeCompanion(원자).
          applyToolbarMoveFromCompanion({ id: item.id, toArea: area, slot: 'menu' });
        } else if (item.area === area) {
          // 자기 영역 → 홈 기준 배치 API 유지(기존 동작 그대로).
          applyToolbarPlacement(item.id, 'menu');
        } else if (item.portable === true) {
          // 크로스 → 이 영역의 메뉴로 직접 이동.
          applyToolbarMove({ id: item.id, toArea: area, slot: 'menu' });
        }
      },
      collect: (m) => ({ isOver: m.isOver(), canDrop: m.canDrop() }),
    }),
    [group, area],
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
// area = 이 행이 속한 영역(소비처에서 전달). 크로스 드롭은 이 area 로 인라인 편입.
export function useToolbarRowDrop(
  group: ToolbarGroup,
  area: string,
): {
  drop: ReturnType<typeof useDrop>[1];
  isOver: boolean;
} {
  const [{ isOver }, drop] = useDrop(
    () => ({
      accept: toolbarDndType(group),
      // 같은 area(인라인 고정) 또는 portable(타 영역에서 이 행으로) 수락.
      canDrop: (item: ToolbarDragItem) =>
        item.area === area || item.portable === true,
      drop: (item: ToolbarDragItem, monitor) => {
        if (monitor.didDrop()) return;
        if (item.fromCompanion !== undefined) {
          // 동반 슬롯 → 이 영역 인라인 맨 뒤로 편입 + removeCompanion(원자, 툴바 복귀).
          applyToolbarMoveFromCompanion({ id: item.id, toArea: area, slot: 'inline' });
        } else if (item.area === area) {
          // 자기 영역 → 홈 기준 배치 API 유지(기존 동작 그대로).
          applyToolbarPlacement(item.id, 'pinned');
        } else if (item.portable === true) {
          // 크로스 → 이 영역의 인라인 맨 뒤로 편입.
          applyToolbarMove({ id: item.id, toArea: area, slot: 'inline' });
        }
      },
      collect: (m) => ({ isOver: m.isOver({ shallow: true }) }),
    }),
    [group, area],
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
// --z-dnd-hint: 시각 숨김된 메뉴 모달(--z-modal)보다 위, 드래그 프리뷰(--z-dnd-preview)보다 아래.
// 타입이 View 공유라 존이 씬·프로젝트 양쪽에 중복 표시될 수 있으므로, 드래그
// 아이템의 홈 영역(item.area)이 이 그룹일 때만 렌더/수락한다(숨김=홈 배치 초기화).
export const ToolbarHideZone = observer(({ group }: { group: ToolbarGroup }) => {
  const active = useToolbarDragActive(group);
  const isHome = useDragLayer((monitor) => {
    const item = monitor.getItem() as ToolbarDragItem | null;
    return (
      monitor.isDragging() &&
      monitor.getItemType() === toolbarDndType(group) &&
      !!item &&
      item.area === group
    );
  });
  const [{ isOver }, drop] = useDrop(
    () => ({
      accept: toolbarDndType(group),
      canDrop: (item: ToolbarDragItem) => item.area === group,
      drop: (item: ToolbarDragItem) => {
        applyToolbarPlacement(item.id, 'hidden');
      },
      collect: (m) => ({ isOver: m.isOver() }),
    }),
    [group],
  );
  // 실제 드래그 전(롱프레스 armed) 단계엔 useDragLayer 아이템이 없어 isHome=false 가
  // 되므로, armed 그룹이 이 그룹이면(=홈) 표시하도록 함께 판정. 편집 모드 상시 표시도
  // 드래그 아이템이 없어 isHome 을 못 읽으므로 자기 그룹 존을 항상 노출한다.
  const armedHome = toolbarDragUi.armed === group;
  if (!active || (!isHome && !armedHome && !appState.editMode)) return null;
  return (
    <div
      ref={drop as any}
      className={
        'fixed bottom-6 left-1/2 -translate-x-1/2 z-[var(--z-dnd-hint)] px-5 py-2.5 rounded-full ' +
        'border-2 border-dashed text-sm select-none transition-colors ' +
        (isOver
          ? 'border-red-400 bg-red-500/20 text-red-500 dark:text-red-300'
          : 'border-gray-400 bg-[var(--c-zone)] text-muted')
      }
    >
      여기로 끌어서 숨기기
    </div>
  );
});
