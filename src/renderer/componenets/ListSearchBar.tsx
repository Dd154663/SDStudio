import React from 'react';
import { hasQuery } from '../models/listSearch';

// ===== 공용 목록 검색 줄(2026-11-14 M4) =====
//
// 한 줄 = [이름 검색 입력] [정렬 select(선택)] [개수]. 모양은 M3 글로벌 프리셋 고르기 창 도구줄과 같다
// (같은 토큰·같은 높이 h-8 — compact 면 h-7·text-xs, aside 머리처럼 좁은 자리용).
// - onQueryChange 가 없으면 검색 입력을 그리지 않는다(정렬·개수만 — 씬 템플릿 관리처럼 작은 목록).
// - 개수 = 검색어가 있거나 보이는 수가 전체와 다르면 「n / 전체 m」, 아니면 「전체 m개」.
// 거르는 규칙은 models/listSearch.ts matchesQuery 단일 출처 — 이 컴포넌트는 보기만 그린다(저장·되돌리기 기록 없음).

export interface ListSearchBarSort {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  ariaLabel?: string;
}

export interface ListSearchBarProps {
  query?: string;
  onQueryChange?: (q: string) => void;
  // 기본 '이름 검색' — aria-label 도 같은 문구
  placeholder?: string;
  shown: number;
  total: number;
  sort?: ListSearchBarSort;
  // 호출부가 !isMobile 로 넘긴다(모바일에서 키보드가 바로 뜨지 않게)
  autoFocus?: boolean;
  className?: string;
  compact?: boolean;
}

/** 개수 문구 — 검색 중이거나 걸러졌으면 「n / 전체 m」, 아니면 「전체 m개」 */
export function listCountText(shown: number, total: number, query = ''): string {
  if (hasQuery(query) || shown !== total) return `${shown} / 전체 ${total}`;
  return `전체 ${total}개`;
}

export function ListSearchBar({
  query = '',
  onQueryChange,
  placeholder = '이름 검색',
  shown,
  total,
  sort,
  autoFocus,
  className,
  compact,
}: ListSearchBarProps) {
  const h = compact ? 'h-7 text-xs' : 'h-8 text-sm';
  return (
    <div
      className={'flex items-center gap-2 min-w-0 ' + (className ?? '')}
      data-list-search-bar=""
    >
      {onQueryChange && (
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          autoFocus={autoFocus}
          data-list-search=""
          className={`flex-1 min-w-0 ${h} px-2.5 rounded border line-color bg-[var(--c-input-bg)] text-default focus:outline-none focus:ring-2 focus:ring-[color:var(--c-focus-ring)]`}
        />
      )}
      {sort && (
        <select
          value={sort.value}
          onChange={(e) => sort.onChange(e.target.value)}
          aria-label={sort.ariaLabel ?? '정렬'}
          data-list-sort=""
          className={`app-select app-select-tight ${h} flex-none`}
        >
          {sort.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
      <div
        className={
          'text-xs text-muted whitespace-nowrap flex-none tabular-nums' +
          (onQueryChange ? '' : ' ml-auto')
        }
        data-list-count=""
      >
        {listCountText(shown, total, query)}
      </div>
    </div>
  );
}

/** 검색 중 순서 바꾸기 잠금 안내(드래그 정렬이 있는 목록 — 캐릭터 프리셋 관리·프롬프트조각) */
export function ListDragLockedHint({ className }: { className?: string }) {
  return (
    <div className={'text-xs text-faint ' + (className ?? '')} data-list-drag-locked="">
      검색 중에는 순서를 바꿀 수 없습니다
    </div>
  );
}
