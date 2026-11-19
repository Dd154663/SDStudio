// 세로 목록 우클릭 메뉴 공용 부품(2026-11-18 우클릭 메뉴 정비).
// · MenuItemLabel = 왼쪽 아이콘 칸 + 글자. react-contexify 메뉴(AppContextMenu)와 프로젝트 서랍 우클릭 목록이 같이 쓴다.
//   아이콘이 없는 줄도 같은 폭의 빈 칸을 둬 글자 시작 위치를 맞춘다. 아이콘 색은 글자색(currentColor)을 살짝 흐리게.
// · ContextMenuList = 프로젝트 서랍(ProjectDrawer) 우클릭 창 — 줄 전체가 누르는 영역, 누르면 동작 뒤 닫힌다.
//   열기·닫기(바깥 클릭·Esc·다른 줄 우클릭)는 호출부가 정한다. 여기서는 그리기와 화면 안 위치만.
// · 순서 표(projectDrawerMenu·folderDrawerMenu)와 구분선 정리·위치 계산은 순수 함수(jest contextMenuList.test.tsx).
// react·Tooltip 외 의존 없음(서비스 import 금지 — 테스트가 가볍게 불러온다).
import { ReactNode, useLayoutEffect, useRef, useState } from 'react';
import Tooltip from './Tooltip';

export const MENU_SEPARATOR = '—' as const;
export type MenuEntry<T> = T | typeof MENU_SEPARATOR;

// 구분선 정리 — 맨 위·맨 아래·연달아 나오는 구분선을 없앤다(조건부 항목이 빠져 양옆이 비는 경우).
export function compactMenuSeparators<T>(entries: MenuEntry<T>[]): MenuEntry<T>[] {
  const out: MenuEntry<T>[] = [];
  for (const e of entries) {
    if (e === MENU_SEPARATOR) {
      if (out.length > 0 && out[out.length - 1] !== MENU_SEPARATOR) out.push(e);
    } else {
      out.push(e);
    }
  }
  while (out.length > 0 && out[out.length - 1] === MENU_SEPARATOR) out.pop();
  return out;
}

export type ProjectDrawerMenuId =
  | 'new-window'
  | 'open-explorer'
  | 'import'
  | 'export'
  | 'clone'
  | 'rename'
  | 'make-scene-template'
  | 'apply-template'
  | 'break-inheritance'
  | 'queue-all'
  | 'delete';

// 프로젝트 우클릭 순서(종전 가로 줄 순서 그대로). explorer = PC 만, inherited = 상속 적용이 있을 때만.
// 2026-11-19 백업 메뉴 분할: 종전 「내보내기/불러오기」 한 줄 → 「불러오기」·「내보내기」 두 줄(같은 자리).
export function projectDrawerMenu(opts: {
  explorer: boolean;
  inherited: boolean;
}): MenuEntry<ProjectDrawerMenuId>[] {
  const S = MENU_SEPARATOR;
  return compactMenuSeparators<ProjectDrawerMenuId>([
    'new-window',
    ...(opts.explorer ? (['open-explorer'] as const) : []),
    S,
    'import',
    'export',
    'clone',
    'rename',
    S,
    'make-scene-template',
    'apply-template',
    ...(opts.inherited ? (['break-inheritance'] as const) : []),
    S,
    'queue-all',
    S,
    'delete',
  ]);
}

export type FolderDrawerMenuId =
  | 'new-project'
  | 'new-subfolder'
  | 'export-import'
  | 'clone'
  | 'rename'
  | 'color'
  | 'folder-template'
  | 'queue-all'
  | 'delete';

// 폴더 우클릭 순서(사용자 승인 시안 2026-11-18).
export function folderDrawerMenu(): MenuEntry<FolderDrawerMenuId>[] {
  const S = MENU_SEPARATOR;
  return compactMenuSeparators<FolderDrawerMenuId>([
    'new-project',
    'new-subfolder',
    S,
    'export-import',
    'clone',
    'rename',
    'color',
    S,
    'folder-template',
    S,
    'queue-all',
    S,
    'delete',
  ]);
}

// 화면 안 위치 — 누른 점에서 오른쪽·아래로 펼치고, 오른쪽이 넘치면 왼쪽으로 당기고,
// 아래가 넘치면 누른 점 위로 올린다(위도 모자라면 화면 아래 끝에 맞춤). 여백 margin.
export function placeContextMenu(
  point: { x: number; y: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 4,
): { left: number; top: number } {
  let left = point.x;
  if (left + size.width > viewport.width - margin) {
    left = Math.max(margin, viewport.width - size.width - margin);
  }
  let top = point.y;
  if (top + size.height > viewport.height - margin) {
    top =
      point.y - size.height >= margin
        ? point.y - size.height
        : Math.max(margin, viewport.height - size.height - margin);
  }
  return { left, top };
}

// 아이콘 칸(16px, 아이콘 14px 권장) + 글자. 아이콘 없으면 빈 칸.
export function MenuItemLabel({
  icon,
  children,
}: {
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <span
        aria-hidden="true"
        data-menu-icon=""
        className="inline-flex flex-none items-center justify-center w-4 mr-2.5 opacity-75"
      >
        {icon}
      </span>
      <span>{children}</span>
    </>
  );
}

export interface ContextMenuRow {
  icon?: ReactNode;
  label: string;
  // 이름보다 긴 설명이 필요한 줄만(줄 전체를 Tooltip 으로 감싼다)
  tooltip?: string;
  danger?: boolean;
  onSelect: () => void;
}

export function ContextMenuList({
  id,
  ariaLabel,
  x,
  y,
  entries,
  onClose,
}: {
  id: string;
  ariaLabel: string;
  x: number;
  y: number;
  entries: MenuEntry<ContextMenuRow>[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const rows = compactMenuSeparators(entries);
  // 그린 뒤 크기를 재서 페인트 전에 화면 안으로 옮긴다(세로 목록이라 높이가 항목 수에 따라 바뀐다).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos(
      placeContextMenu(
        { x, y },
        { width: r.width, height: r.height },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, [x, y, rows.length]);
  return (
    <div
      ref={ref}
      id={id}
      role="menu"
      aria-label={ariaLabel}
      // ui-pop-in = 열릴 때 짧은 페이드 + 4px 이동(2026-11-19 UI 정돈 시범 ④, App.css — 움직임 줄이기에서 끔)
      className="ui-pop-in fixed z-[var(--z-context-menu)] flex flex-col min-w-[200px] max-w-[calc(100vw-8px)] max-h-[calc(100vh-8px)] overflow-y-auto p-1.5 bg-[var(--c-surface-2)] text-default rounded-lg shadow-xl border line-color select-none"
      style={{ left: pos.left, top: pos.top }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {rows.map((row, i) => {
        if (row === MENU_SEPARATOR) {
          return (
            <div
              key={`sep-${i}`}
              role="separator"
              className="my-1 mx-1 h-px bg-[var(--c-line)]"
            />
          );
        }
        const button = (
          <button
            type="button"
            role="menuitem"
            className={`btn-ghost w-full flex items-center text-left px-2 py-1.5 rounded text-[13px] leading-5 whitespace-nowrap ${
              row.danger ? 'text-red-500 dark:text-red-400' : 'text-body'
            }`}
            onClick={() => {
              row.onSelect();
              onClose();
            }}
          >
            <MenuItemLabel icon={row.icon}>{row.label}</MenuItemLabel>
          </button>
        );
        return row.tooltip ? (
          <Tooltip key={row.label} content={row.tooltip}>
            {button}
          </Tooltip>
        ) : (
          <span key={row.label} className="contents">
            {button}
          </span>
        );
      })}
    </div>
  );
}
