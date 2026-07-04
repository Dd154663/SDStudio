import { ReactNode, useEffect, useRef } from 'react';
import ModalOverlay from './ModalOverlay';
import { isMobile } from '../models';

// 툴바 ⋯(더보기) 메뉴. 행은 "기존 버튼 노드 그대로 + 레지스트리 이름 라벨" —
// 버튼의 onClick 을 한 줄도 재배선하지 않고, 아이콘 전용 버튼도 메뉴에선
// 이름이 보여 발견성이 좋아진다.
// 모바일=ModalOverlay(시트형) / 데스크톱=앵커 팝오버. 팝오버는 부모가
// position:relative 인 래퍼(⋯ 버튼과 같은 컨테이너) 안에서 렌더해야 한다.

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
}

const MenuRow = ({
  item,
  onClose,
}: {
  item: OverflowMenuItem;
  onClose: () => void;
}) => {
  const rowRef = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={rowRef}
      className="flex items-center gap-3 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-black/5 dark:hover:bg-white/10"
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

const ToolbarOverflowMenu = ({
  isOpen,
  onClose,
  title,
  items,
  dropUp,
}: ToolbarOverflowMenuProps) => {
  const popRef = useRef<HTMLDivElement>(null);

  // 데스크톱 팝오버: 외부 클릭/Escape 로 닫기.
  // 경계는 팝오버의 부모(⋯ 버튼을 포함한 relative 래퍼) — ⋯ 재클릭 시
  // "외부클릭 닫힘 → onClick 재열림" 충돌을 피하기 위함.
  useEffect(() => {
    if (!isOpen || isMobile) return;
    const onDown = (e: MouseEvent) => {
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
  }, [isOpen, onClose]);

  const rows = (
    <div className="flex flex-col gap-1">
      {items.map((item) => (
        <MenuRow key={item.id} item={item} onClose={onClose} />
      ))}
    </div>
  );

  if (isMobile) {
    return (
      <ModalOverlay isOpen={isOpen} onClose={onClose} title={title} width="max-w-sm">
        {rows}
      </ModalOverlay>
    );
  }

  if (!isOpen) return null;
  return (
    <div
      ref={popRef}
      className={`absolute ${dropUp ? 'bottom-full mb-1' : 'top-full mt-1'} left-0 z-50 min-w-[240px] max-w-[80vw] max-h-[60vh] overflow-auto rounded-xl border line-color bg-[var(--c-zone)] shadow-2xl p-2`}
    >
      {rows}
    </div>
  );
};

export default ToolbarOverflowMenu;
