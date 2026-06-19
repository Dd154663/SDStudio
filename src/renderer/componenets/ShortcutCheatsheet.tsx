import React, { useRef } from 'react';
import { FaTimes } from 'react-icons/fa';

interface ShortcutEntry {
  keys: string[];
  desc: string;
}

const SCENE_SHORTCUTS: ShortcutEntry[] = [
  { keys: ['A', ','], desc: '이전 씬 / 호버 시 이전 이미지' },
  { keys: ['D', '.'], desc: '다음 씬 / 호버 시 다음 이미지' },
  { keys: ['F'], desc: '호버 중 현재 이미지 즐겨찾기 토글' },
  { keys: ['←', '→', '↑', '↓'], desc: '씬 이동' },
  { keys: ['Enter'], desc: '씬 이미지 보기' },
  { keys: ['Tab'], desc: '씬 편집' },
  { keys: ['Space'], desc: '예약 실행' },
  { keys: ['Ctrl+A'], desc: '포커스 씬 예약 추가' },
  { keys: ['Ctrl+D'], desc: '모든 예약 취소' },
  { keys: ['Ctrl+B'], desc: '씬 북마크 토글' },
  { keys: ['H'], desc: '단축키 도움말' },
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
  scope: 'scene' | 'tournament';
  onClose: () => void;
}

function ShortcutCheatsheet({ scope, onClose }: ShortcutCheatsheetProps) {
  const shortcuts = scope === 'scene' ? SCENE_SHORTCUTS : TOURNAMENT_SHORTCUTS;
  const panelRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={panelRef}
      className="fixed right-3 top-12 z-[9999] shadow-2xl rounded-lg border border-gray-500 bg-gray-900/95 text-gray-200 text-xs min-w-[210px] select-none"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-600">
        <span className="font-bold text-sm text-white">단축키 도움말</span>
        <button
          type="button"
          className="text-gray-400 hover:text-white transition-colors cursor-pointer"
          onClick={onClose}
        >
          <FaTimes size={12} />
        </button>
      </div>
      <div className="px-3 py-2 space-y-1.5 max-h-[380px] overflow-y-auto">
        {shortcuts.map((entry) => (
          <div
            key={entry.desc}
            className="flex items-center justify-between gap-3"
          >
            <span className="text-gray-400 whitespace-nowrap">
              {entry.desc}
            </span>
            <span className="flex gap-1">
              {entry.keys.map((k) => (
                <kbd
                  key={k}
                  className="px-1.5 py-0.5 rounded bg-gray-700 text-gray-100 font-mono text-[11px] border border-gray-500 leading-none"
                >
                  {k}
                </kbd>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default ShortcutCheatsheet;
