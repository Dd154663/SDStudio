// 우클릭 메뉴 정비(2026-11-18) — 프로젝트 서랍 우클릭 창 세로 목록(ContextMenuList)과 contexify 메뉴 줄 앞 아이콘.
// 순서 표·구분선 정리·화면 안 위치(순수 함수), 목록 렌더(role·구분선·위험색·누르면 동작 뒤 닫힘),
// 소스 검사(서랍이 순서 표를 쓰는지, contexify <Item> 마다 아이콘 칸이 있는지).
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import * as fs from 'fs';
import * as path from 'path';
import {
  compactMenuSeparators,
  ContextMenuList,
  folderDrawerMenu,
  MENU_SEPARATOR as S,
  MenuItemLabel,
  placeContextMenu,
  projectDrawerMenu,
} from '../../componenets/ContextMenuList';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const COMP = path.resolve(__dirname, '../../componenets');
const read = (f: string) => fs.readFileSync(path.join(COMP, f), 'utf8').replace(/\r\n/g, '\n');

describe('구분선 정리', () => {
  test('맨 위·맨 아래·연달아 나오는 구분선 제거', () => {
    expect(compactMenuSeparators([S, 'a', S, S, 'b', S])).toEqual(['a', S, 'b']);
    expect(compactMenuSeparators([S, S])).toEqual([]);
    expect(compactMenuSeparators(['a', 'b'])).toEqual(['a', 'b']);
  });
});

describe('프로젝트 우클릭 순서', () => {
  test('PC·상속 있음 = 전체 순서', () => {
    expect(projectDrawerMenu({ explorer: true, inherited: true })).toEqual([
      'new-window',
      'open-explorer',
      S,
      'import',
      'export',
      'clone',
      'rename',
      S,
      'make-scene-template',
      'apply-template',
      'break-inheritance',
      S,
      'queue-all',
      S,
      'delete',
    ]);
  });
  test('탐색기(PC 전용)·상속 끊기(상속 있을 때만)는 조건부, 구분선은 겹치지 않음', () => {
    const m = projectDrawerMenu({ explorer: false, inherited: false });
    expect(m).not.toContain('open-explorer');
    expect(m).not.toContain('break-inheritance');
    expect(m[0]).toBe('new-window');
    expect(m[m.length - 1]).toBe('delete');
    expect(m).toEqual(compactMenuSeparators(m));
  });
});

describe('폴더 우클릭 순서(승인 시안)', () => {
  test('새 프로젝트·서브폴더 — 내보내기·복제·이름·색상 — 기본 템플릿 — 일괄 생성 예약 — 삭제', () => {
    expect(folderDrawerMenu()).toEqual([
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
  });
});

describe('화면 안 위치', () => {
  const vp = { width: 1000, height: 800 };
  test('넘치지 않으면 누른 점 그대로', () => {
    expect(placeContextMenu({ x: 100, y: 100 }, { width: 200, height: 300 }, vp)).toEqual({ left: 100, top: 100 });
  });
  test('오른쪽이 넘치면 왼쪽으로 당김', () => {
    expect(placeContextMenu({ x: 900, y: 100 }, { width: 200, height: 300 }, vp).left).toBe(796);
  });
  test('아래가 넘치면 누른 점 위로, 위도 모자라면 화면 아래 끝에 맞춤', () => {
    expect(placeContextMenu({ x: 100, y: 700 }, { width: 200, height: 300 }, vp).top).toBe(400);
    expect(placeContextMenu({ x: 100, y: 200 }, { width: 200, height: 700 }, vp).top).toBe(96);
    expect(placeContextMenu({ x: 100, y: 200 }, { width: 200, height: 900 }, vp).top).toBe(4);
  });
});

describe('ContextMenuList 렌더', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  test('세로 목록 — role, 구분선 정리, 위험 줄 색, 누르면 동작 뒤 닫힘', () => {
    const calls: string[] = [];
    const onClose = jest.fn();
    act(() => {
      root.render(
        <ContextMenuList
          id="floating-project-toolbar"
          ariaLabel="메뉴"
          x={10}
          y={10}
          onClose={onClose}
          entries={[
            S,
            { label: '가', icon: <i />, onSelect: () => calls.push('가') },
            S,
            S,
            { label: '나', tooltip: '나 (긴 설명)', onSelect: () => calls.push('나') },
            S,
            { label: '삭제', danger: true, onSelect: () => calls.push('삭제') },
            S,
          ]}
        />,
      );
    });
    const menu = host.querySelector('#floating-project-toolbar')!;
    expect(menu.getAttribute('role')).toBe('menu');
    expect(menu.className).toContain('z-[var(--z-context-menu)]');
    const items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
    expect(items.map((b) => b.textContent)).toEqual(['가', '나', '삭제']);
    expect(menu.querySelectorAll('[role="separator"]').length).toBe(2);
    // 아이콘 없는 줄도 같은 폭의 아이콘 칸
    expect(menu.querySelectorAll('[data-menu-icon]').length).toBe(3);
    expect(items[2].className).toContain('text-red-500');
    expect(items[0].className).toContain('text-body');
    act(() => (items[2] as HTMLButtonElement).click());
    expect(calls).toEqual(['삭제']);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('MenuItemLabel — 아이콘 칸 + 글자', () => {
    act(() => {
      root.render(<MenuItemLabel icon={<b />}>글자</MenuItemLabel>);
    });
    const slot = host.querySelector('[data-menu-icon]')!;
    expect(slot.getAttribute('aria-hidden')).toBe('true');
    expect(slot.querySelector('b')).not.toBeNull();
    expect(host.textContent).toBe('글자');
  });
});

describe('소스 검사', () => {
  test('서랍 우클릭 창은 순서 표와 세로 목록을 쓴다(가로 아이콘 줄 제거)', () => {
    const src = read('ProjectDrawer.tsx');
    expect(src).toContain('<ContextMenuList\n              id="floating-folder-toolbar"');
    expect(src).toContain('<ContextMenuList\n              id="floating-project-toolbar"');
    expect(src).toContain('folderDrawerMenu().map(');
    expect(src).toContain('projectDrawerMenu({');
    expect(src).not.toContain('flex items-center gap-0.5 p-1.5 bg-[var(--c-surface-2)]');
    // 긴 설명은 툴팁으로 유지
    expect(src).toContain("tooltip: '일괄 예약 추가 (모든 씬, 즉시)'");
    expect(src).toContain("tooltip: '일괄 생성 예약 (서브폴더 포함, 프로젝트마다 모든 씬)'");
    expect(src).toContain("tooltip: '씬 템플릿으로 만들기 (복제)'");
  });
  test('contexify 메뉴의 모든 <Item> 에 아이콘 칸(MenuItemLabel)', () => {
    const src = read('AppContextMenu.tsx');
    const items = src.match(/<Item id="[^"]+" onClick=\{\w+\}>[\s\S]*?<\/Item>/g) ?? [];
    expect(items.length).toBeGreaterThanOrEqual(40);
    for (const it of items) expect(it).toContain('<MenuItemLabel');
  });
});
