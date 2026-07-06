import { ReactNode, useEffect, useRef } from 'react';
import { useDrag, useDragLayer } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';
import { observer } from 'mobx-react-lite';
import ModalOverlay from './ModalOverlay';
import { isMobile } from '../models';
import {
  LONG_PRESS_MS,
  ToolbarDragItem,
  ToolbarGroup,
  armToolbarDrag,
  disarmToolbarDrag,
  isMenuDragArmed,
  metaOf,
} from './ToolbarDnd';

// 툴바 ⋯(더보기) 메뉴. 행은 "기존 버튼 노드 그대로 + 레지스트리 이름 라벨" —
// 버튼의 onClick 을 한 줄도 재배선하지 않고, 아이콘 전용 버튼도 메뉴에선
// 이름이 보여 발견성이 좋아진다.
// 모바일=ModalOverlay(시트형) / 데스크톱=앵커 팝오버. 팝오버는 부모가
// position:relative 인 래퍼(⋯ 버튼과 같은 컨테이너) 안에서 렌더해야 한다.
// dndType 을 주면 행을 롱프레스/드래그로 잡아 밖(툴바)으로 빼낼 수 있다 —
// 잡는 동안 메뉴는 "시각적으로만" 숨긴다(언마운트하면 드래그가 끊김).

export interface OverflowMenuItem {
  id: string;
  name: string;
  node: ReactNode;
}

interface ToolbarOverflowMenuProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  items: OverflowMenuItem[];
  // 데스크톱 팝오버를 앵커 위로 펼침 — 화면 하단 툴바(프로젝트 바 등)에서
  // 아래로 열면 뷰포트 밖으로 잘리므로 그 경우 true 로.
  dropUp?: boolean;
  // 행 드래그 아웃용 react-dnd 아이템 타입 (미지정 = 드래그 비활성, 클래식 등)
  dndType?: string;
  // 이 메뉴가 속한 툴바 영역 — 타입이 View 공유('toolbar-btn/main')가 되면서
  // dndType 에서 그룹을 역산할 수 없어 명시로 받는다. 드래그 item.area(표시 영역)와
  // 모바일 롱프레스 잡힘(armToolbarDrag)에 사용. dndType 지정 시 함께 지정할 것.
  group?: ToolbarGroup;
}

const MenuRow = ({
  item,
  onClose,
  dndType,
  group,
}: {
  item: OverflowMenuItem;
  onClose: () => void;
  dndType?: string;
  group?: ToolbarGroup;
}) => {
  const rowRef = useRef<HTMLDivElement>(null);
  const [{ isDragging }, drag, preview] = useDrag(
    () => ({
      type: dndType ?? '__toolbar-menu-row-disabled__',
      item: {
        id: item.id,
        name: item.name,
        from: 'menu',
        // 표시 영역(이 메뉴의 영역) — DraggableToolbarButton 의 item.area 와 동일
        // 의미. 드롭 타깃의 canDrop(재배열=같은 area / 크로스=portable)이 판정한다.
        area: group,
        portable: metaOf(item.id)?.portable === true,
        node: item.node,
      } as ToolbarDragItem,
      canDrag: !!dndType,
      collect: (m) => ({ isDragging: m.isDragging() }),
      end: (_item, monitor) => {
        disarmToolbarDrag();
        // 밖으로 빼기/숨기기 성공 → 메뉴 닫기. 취소(빈 곳에 놓음)면 메뉴 복귀.
        if (monitor.didDrop()) onClose();
      },
    }),
    [dndType, group, item.id, item.name, onClose],
  );
  useEffect(() => {
    preview(getEmptyImage(), { captureDraggingState: true });
  }, [preview]);
  drag(rowRef);

  // 모바일 롱프레스 잡힘 — 전역 잡힘 상태를 세워 그 순간 모달 숨김·툴바 하이라이트·
  // 흔들림·숨김 존·햅틱이 전부 즉시 시작된다 (드래그 첫 이동을 기다리지 않음).
  // 그룹은 명시 prop(group) — 타입은 View 공유라 역산 불가.
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearArmTimer = () => {
    if (armTimer.current) {
      clearTimeout(armTimer.current);
      armTimer.current = null;
    }
  };
  const onTouchStart = () => {
    if (!dndType || !group || !isMobile) return;
    clearArmTimer();
    armTimer.current = setTimeout(() => {
      armTimer.current = null;
      armToolbarDrag(group, item.id, 'menu');
    }, LONG_PRESS_MS);
  };
  const onTouchEndOrCancel = () => {
    clearArmTimer();
    if (!isDragging) disarmToolbarDrag();
  };

  return (
    <div
      ref={rowRef}
      onTouchStart={onTouchStart}
      onTouchMove={clearArmTimer}
      onTouchEnd={onTouchEndOrCancel}
      onTouchCancel={onTouchEndOrCancel}
      className={
        'flex items-center gap-3 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-black/5 dark:hover:bg-white/10' +
        (isDragging ? ' opacity-30' : '')
      }
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (!target.closest('button')) {
          // 라벨/여백 클릭 → 행 안의 실제 버튼으로 위임.
          // click() 이 버블로 이 핸들러에 다시 들어와 아래 분기에서 닫힌다.
          rowRef.current?.querySelector('button')?.click();
          return;
        }
        // 버튼 클릭: 버블 단계라 버튼 자신의 onClick 이 먼저 실행된 뒤 닫힘 확정
        onClose();
      }}
    >
      <div className="flex-none pointer-events-auto">{item.node}</div>
      <span className="text-sm text-body select-none">{item.name}</span>
    </div>
  );
};

const ToolbarOverflowMenu = observer(({
  isOpen,
  onClose,
  title,
  items,
  dropUp,
  dndType,
  group,
}: ToolbarOverflowMenuProps) => {
  const popRef = useRef<HTMLDivElement>(null);

  // 이 메뉴의 행이 드래그 중이거나 롱프레스로 "잡힌" 순간 — 메뉴를 시각 숨김해
  // 드롭 타깃(툴바)을 노출. 잡힘만으로도 숨겨야 피드백이 즉시 시작된다.
  const dragging = useDragLayer(
    (monitor) =>
      !!dndType &&
      monitor.isDragging() &&
      monitor.getItemType() === dndType,
  );
  const dragActive = dragging || isMenuDragArmed(dndType);

  // 데스크톱 팝오버: 외부 클릭/Escape 로 닫기.
  // 경계는 팝오버의 부모(⋯ 버튼을 포함한 relative 래퍼) — ⋯ 재클릭 시
  // "외부클릭 닫힘 → onClick 재열림" 충돌을 피하기 위함.
  useEffect(() => {
    if (!isOpen || isMobile) return;
    const onDown = (e: MouseEvent) => {
      if (dragActive) return; // 드래그 중 외부클릭 판정으로 닫히지 않게
      const root = popRef.current?.parentElement;
      if (root && !root.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [isOpen, onClose, dragActive]);

  const rows = (
    <div className="flex flex-col gap-1">
      {items.map((item) => (
        <MenuRow
          key={item.id}
          item={item}
          onClose={onClose}
          dndType={dndType}
          group={group}
        />
      ))}
    </div>
  );

  if (isMobile) {
    return (
      <ModalOverlay
        isOpen={isOpen}
        onClose={onClose}
        title={title}
        width="max-w-sm"
        hidden={dragActive}
      >
        {rows}
      </ModalOverlay>
    );
  }

  if (!isOpen) return null;
  return (
    <div
      ref={popRef}
      className={`absolute ${dropUp ? 'bottom-full mb-1' : 'top-full mt-1'} left-0 z-50 min-w-[240px] max-w-[80vw] max-h-[60vh] overflow-auto rounded-xl border line-color bg-[var(--c-zone)] shadow-2xl p-2${dragActive ? ' opacity-0 pointer-events-none' : ''}`}
    >
      {rows}
    </div>
  );
});

export default ToolbarOverflowMenu;
