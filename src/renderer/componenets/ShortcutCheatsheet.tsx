import React, { useRef } from 'react';
import { FaTimes } from 'react-icons/fa';

interface ShortcutEntry {
  keys: string[];
  desc: string;
}

const SCENE_SHORTCUTS: ShortcutEntry[] = [
  { keys: ['←', '→', '↑', '↓'], desc: '씬 포커스 이동' },
  { keys: ['A', ','], desc: '포커스/호버 씬 이전 이미지' },
  { keys: ['D', '.'], desc: '포커스/호버 씬 다음 이미지' },
  { keys: ['F'], desc: '포커스/호버 씬 현재 이미지 즐겨찾기 토글' },
  { keys: ['Enter'], desc: '씬 이미지 보기' },
  { keys: ['Tab'], desc: '씬 편집' },
  { keys: ['Ctrl+S'], desc: '선택 모드 진입 + 포커스 씬 선택 토글' },
  { keys: ['S'], desc: '선택 모드에서 포커스 씬 선택 토글' },
  { keys: ['Ctrl+X'], desc: '선택 모드 취소' },
  { keys: ['Ctrl+A'], desc: '포커스/선택 씬 예약 추가' },
  { keys: ['Space'], desc: '예약 실행' },
  { keys: ['Ctrl+D'], desc: '모든 예약 제거' },
  { keys: ['Ctrl+B'], desc: '씬 북마크 토글' },
  { keys: ['Shift+드래그'], desc: '선택 영역 해제' },
  { keys: ['Alt+드래그'], desc: '영역 내 씬 예약 제거' },
  { keys: ['Alt+→'], desc: '이미지 검수에서 즉시 삭제' },
  { keys: ['H'], desc: '단축키 도움말' },
];

const IMAGE_GRID_SHORTCUTS: ShortcutEntry[] = [
  { keys: ['←', '→', '↑', '↓'], desc: '이미지 포커스 이동' },
  { keys: ['Enter'], desc: '상세 보기' },
  { keys: ['Ctrl+F'], desc: '즐겨찾기 토글' },
  { keys: ['Ctrl+B'], desc: '북마크 토글' },
  { keys: ['Ctrl+S'], desc: '선택 모드 진입 + 포커스 이미지 선택 토글' },
  { keys: ['S'], desc: '선택 모드에서 포커스 이미지 선택 토글' },
  { keys: ['Ctrl+X'], desc: '선택 모드 취소' },
  { keys: ['Del'], desc: '이미지 삭제' },
  { keys: ['Ctrl+1', 'Ctrl+2', 'Ctrl+3', 'Ctrl+4'], desc: '탭 전환' },
  { keys: ['Ctrl+←', 'Ctrl+→'], desc: '이전/다음 씬 그리드로 이동' },
  { keys: ['H'], desc: '단축키 도움말' },
];

// 전역 단축키(KeyboardShortcutService global 범주) — 씬 목록·이미지 그리드·상세에서도 통한다(되돌리기 계약).
// 월드컵(토너먼트) 창은 되돌리기 허용 창이 아니라 넣지 않는다. 키는 기본값(설정 화면에서 바꿀 수 있음).
export const GLOBAL_SHORTCUTS: ShortcutEntry[] = [
  { keys: ['Ctrl+Z'], desc: '되돌리기' },
  { keys: ['Ctrl+Y'], desc: '다시 실행' },
];

const TOURNAMENT_SHORTCUTS: ShortcutEntry[] = [
  { keys: ['A', ','], desc: '왼쪽 우승' },
  { keys: ['D', '.'], desc: '오른쪽 우승' },
  { keys: ['W', 'K'], desc: '둘다 승리' },
  { keys: ['S', 'L'], desc: '둘다 패배' },
  { keys: ['R', '/'], desc: '순위 초기화' },
  { keys: ['H'], desc: '단축키 도움말' },
];

interface ShortcutCheatsheetProps {
  scope: 'scene' | 'tournament' | 'image-grid';
  onClose: () => void;
}

function ShortcutRow({ entry }: { entry: ShortcutEntry }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted whitespace-nowrap">{entry.desc}</span>
      <span className="flex gap-1">
        {entry.keys.map((k) => (
          <kbd
            key={k}
            className="px-1.5 py-0.5 rounded bg-[var(--c-input-bg)] text-[var(--c-input-text)] font-mono text-[11px] border line-color leading-none"
          >
            {k}
          </kbd>
        ))}
      </span>
    </div>
  );
}

function ShortcutCheatsheet({ scope, onClose }: ShortcutCheatsheetProps) {
  const shortcuts =
    scope === 'scene'
      ? SCENE_SHORTCUTS
      : scope === 'image-grid'
        ? IMAGE_GRID_SHORTCUTS
        : TOURNAMENT_SHORTCUTS;
  const globals = scope === 'tournament' ? [] : GLOBAL_SHORTCUTS;
  const panelRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={panelRef}
      className="fixed right-3 top-12 z-[var(--z-tooltip)] shadow-2xl rounded-lg r-modal border line-color bg-[var(--c-zone)] text-body text-xs min-w-[210px] select-none"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b line-color">
        <span className="font-bold text-sm text-default">단축키 도움말</span>
        <button
          type="button"
          className="text-muted hover:text-default transition-colors cursor-pointer"
          aria-label="닫기"
          onClick={onClose}
        >
          <FaTimes size={12} />
        </button>
      </div>
      <div className="px-3 py-2 space-y-1.5 max-h-[380px] overflow-y-auto">
        {shortcuts.map((entry) => (
          <ShortcutRow key={entry.desc} entry={entry} />
        ))}
        {globals.length > 0 && (
          <>
            <div
              data-shortcut-section="global"
              className="pt-1.5 mt-1.5 border-t line-color text-[11px] font-bold text-sub"
            >
              전체
            </div>
            {globals.map((entry) => (
              <ShortcutRow key={entry.desc} entry={entry} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

export default ShortcutCheatsheet;
