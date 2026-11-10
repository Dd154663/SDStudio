/** @jest-environment jsdom */
// PC 프로젝트 바 라벨 병행·반응형 3단계(2026-11-10 아이콘 직관화 묶음 1, SPEC_GUIDE §6 「프로젝트 바 라벨 병행」).
// ① 라벨 단일 출처(uiLayout label) ② 단계 판정(폭 → 단계, 히스테리시스) ③ 측정(flex 항목 합·최소 폭·글자 폭)
// ④ 렌더(글자 단계에서 글자 표시·아이콘 단계에서 숨김·툴팁 이름 유지·⋯ 메뉴/사이드 바 노드는 종전 그대로).
import React from 'react';
import { render, screen } from '@testing-library/react';
import * as fs from 'fs';
import * as path from 'path';
import {
  PROJECT_LABEL_MAX_CHARS,
  TOOLBAR_VIEW_MAIN,
  projectToolbarRegistry,
  toolbarLabelOf,
} from '../uiLayout';
import {
  PROJECT_BAR_HYSTERESIS_PX,
  PROJECT_BAR_LABEL_SPACING_PX,
  pickProjectBarStage,
  projectBarNeeds,
} from '../projectBarStage';

jest.mock('../AppService', () => ({
  appState: {
    appliedCharacterPresetNames: [] as string[],
    addSession: jest.fn(),
    deleteSession: jest.fn(),
    openProjectTrash: jest.fn(),
    openCharacterPresets: jest.fn(),
    openPieceEditor: jest.fn(),
    projectBackupMenu: jest.fn(),
    openNewWindow: jest.fn(),
  },
}));
// CompanionDnd 는 react-dnd(ESM)를 끌어와 jest 가 읽지 못한다 — 이 테스트는 동반 슬롯 감싸기를 쓰지 않는다.
jest.mock('../../componenets/CompanionDnd', () => ({
  CompanionButtonSlot: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// eslint-disable-next-line import/first
import { portableToolbarButtons } from '../../componenets/PortableToolbarButtons';
// eslint-disable-next-line import/first
import { measureProjectBar } from '../../componenets/useProjectBarStage';

const PROJECT_LABELS: Record<string, string> = {
  'project-browser': '탐색',
  'add-session': '새 프로젝트',
  'character-presets': '캐릭터 프리셋',
  'scene-template': '씬 템플릿',
  'backup-export': '백업',
  'delete-session': '삭제',
  'project-trash': '휴지통',
  'piece-editor': '프롬프트조각',
  'new-window': '새 창',
};

describe('라벨 단일 출처(uiLayout label)', () => {
  test('프로젝트 바 버튼 라벨 목록', () => {
    const got = Object.fromEntries(
      projectToolbarRegistry.map((b) => [b.id, b.label]),
    );
    expect(got).toEqual(PROJECT_LABELS);
  });

  test('프로젝트 바에 놓일 수 있는 버튼(프로젝트 레지스트리 전부 + portable)은 모두 라벨이 있고 공백 뺀 2~6자', () => {
    const candidates = TOOLBAR_VIEW_MAIN.flatMap((a) =>
      a.registry.filter((b) => a.area === 'project' || b.portable),
    );
    const bad = candidates
      .filter((b) => {
        const n = (b.label ?? '').replace(/\s/g, '').length;
        return n < 2 || n > PROJECT_LABEL_MAX_CHARS;
      })
      .map((b) => b.id);
    expect(bad).toEqual([]);
    // 툴팁 전체 이름(name)과 별개로 남는다 — 라벨이 name 을 대신하지 않는다
    expect(toolbarLabelOf('add-session')).toBe('새 프로젝트');
    expect(projectToolbarRegistry.find((b) => b.id === 'add-session')?.name).toBe('신규 프로젝트');
    expect(toolbarLabelOf('find-replace')).toBe('찾기·변환');
    expect(toolbarLabelOf('없는-id')).toBeUndefined();
  });
});

describe('단계 판정 pickProjectBarStage', () => {
  const H = PROJECT_BAR_HYSTERESIS_PX;
  const needs = (available: number) => ({ available, labelNeed: 900, iconNeed: 600 });

  test('넓으면 글자, 중간이면 아이콘만, 좁으면 넘침', () => {
    expect(pickProjectBarStage(needs(1200), 'icon')).toBe('label');
    expect(pickProjectBarStage(needs(800), 'label')).toBe('icon');
    expect(pickProjectBarStage(needs(500), 'icon')).toBe('overflow');
    expect(pickProjectBarStage(needs(500), 'label')).toBe('overflow');
  });

  test('히스테리시스: 올라갈 때만 여유 폭이 필요하고, 이미 그 단계면 딱 맞아도 유지', () => {
    // 아이콘 → 글자: labelNeed + H 이상이어야
    expect(pickProjectBarStage(needs(900), 'icon')).toBe('icon');
    expect(pickProjectBarStage(needs(900 + H - 1), 'icon')).toBe('icon');
    expect(pickProjectBarStage(needs(900 + H), 'icon')).toBe('label');
    // 글자 유지: 딱 맞으면 그대로, 1px 모자라면 내려감
    expect(pickProjectBarStage(needs(900), 'label')).toBe('label');
    expect(pickProjectBarStage(needs(899), 'label')).toBe('icon');
    // 넘침 → 아이콘: iconNeed + H 이상이어야
    expect(pickProjectBarStage(needs(600), 'overflow')).toBe('overflow');
    expect(pickProjectBarStage(needs(600 + H), 'overflow')).toBe('icon');
    expect(pickProjectBarStage(needs(600), 'icon')).toBe('icon');
    // 넘침에서 한 번에 글자로(충분히 넓어지면)
    expect(pickProjectBarStage(needs(2000), 'overflow')).toBe('label');
  });

  test('경계 폭에서 왕복해도 깜빡이지 않는다(같은 폭이면 단계 고정)', () => {
    for (const w of [895, 900, 905, 910]) {
      const first = pickProjectBarStage(needs(w), 'label');
      expect(pickProjectBarStage(needs(w), first)).toBe(first);
      const fromIcon = pickProjectBarStage(needs(w), 'icon');
      expect(pickProjectBarStage(needs(w), fromIcon)).toBe(fromIcon);
    }
  });

  test('숨겨진 바(폭 0)는 판정하지 않고 이전 단계 유지', () => {
    expect(pickProjectBarStage({ available: 0, labelNeed: 1, iconNeed: 1 }, 'label')).toBe('label');
    expect(pickProjectBarStage({ available: 0, labelNeed: 1, iconNeed: 1 }, 'icon')).toBe('icon');
  });

  test('projectBarNeeds: 현재 단계 폭 + 글자 몫(글자 폭 + 간격)', () => {
    const S = PROJECT_BAR_LABEL_SPACING_PX;
    expect(projectBarNeeds(1000, 500, [30, 40], false)).toEqual({
      available: 1000,
      labelNeed: 500 + 70 + 2 * S,
      iconNeed: 500,
    });
    expect(projectBarNeeds(1000, 600, [30, 40], true)).toEqual({
      available: 1000,
      labelNeed: 600,
      iconNeed: 600 - 70 - 2 * S,
    });
  });
});

describe('측정 measureProjectBar', () => {
  const box = (el: HTMLElement, width: number) => {
    el.getBoundingClientRect = () => ({ width } as DOMRect);
  };
  test('flex 항목 폭 합 + 간격, contents 안으로 내려가고 absolute·숨김은 빼며 선택기는 최소 폭으로', () => {
    const row = document.createElement('div');
    row.style.columnGap = '8px';
    Object.defineProperty(row, 'clientWidth', { value: 1000 });
    const chip = document.createElement('div');
    box(chip, 100);
    const sel = document.createElement('div');
    sel.setAttribute('data-pb-flex', '');
    sel.style.minWidth = '208px';
    box(sel, 320);
    const contents = document.createElement('div');
    contents.style.display = 'contents';
    const b1 = document.createElement('button');
    box(b1, 30);
    const b2 = document.createElement('button');
    box(b2, 40);
    const label = document.createElement('span');
    label.setAttribute('data-pb-label', '');
    label.style.position = 'absolute';
    box(label, 25);
    b2.appendChild(label);
    contents.append(b1, b2);
    const fixedZone = document.createElement('div');
    fixedZone.style.position = 'fixed';
    box(fixedZone, 300);
    const hidden = document.createElement('div');
    hidden.style.display = 'none';
    box(hidden, 300);
    row.append(chip, sel, contents, fixedZone, hidden);
    // 항목 4개(칩 100 + 선택기 최소 208 + 버튼 30 + 40) + 간격 3 × 8
    const base = 100 + 208 + 30 + 40 + 24;
    expect(measureProjectBar(row, false)).toEqual({
      available: 1000,
      labelNeed: base + 25 + PROJECT_BAR_LABEL_SPACING_PX,
      iconNeed: base,
    });
  });
});

describe('렌더: 프로젝트 바 버튼 라벨', () => {
  const renderIds = (
    ids: string[],
    ctx: Parameters<typeof portableToolbarButtons>[0],
  ) => {
    const nodes = portableToolbarButtons(ctx);
    return render(
      <div>
        {ids.map((id) => (
          <React.Fragment key={id}>{nodes[id]}</React.Fragment>
        ))}
      </div>,
    );
  };
  const ids = [
    'project-browser',
    'add-session',
    'character-presets',
    'scene-template',
    'backup-export',
    'delete-session',
    'project-trash',
  ];

  test('글자 단계(show): 라벨이 보이고 버튼 이름(aria-label)은 툴팁 전체 이름 그대로', () => {
    const { container } = renderIds(ids, { mobileIcon: false, variant: 'project', labels: 'show' });
    for (const id of ids) {
      const span = screen.getByText(PROJECT_LABELS[id]);
      expect(span.getAttribute('data-pb-label')).toBe('');
      expect(span.className).not.toMatch(/invisible/);
      expect(span.closest('button')?.className).toMatch(/inline-flex/);
    }
    expect(screen.getByRole('button', { name: '신규 프로젝트' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '프로젝트 휴지통' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '캐릭터 프리셋 관리' })).toBeTruthy();
    // 아이콘만이 아니므로 icon-only 클래스 없음
    expect(container.querySelector('.icon-only')).toBeNull();
  });

  test('아이콘 단계(measure): 글자는 보이지 않는 측정용(absolute·invisible·aria-hidden)이고 버튼 모양은 종전과 같다', () => {
    renderIds(ids, { mobileIcon: false, variant: 'project', labels: 'measure' });
    for (const id of ids) {
      const span = screen.getByText(PROJECT_LABELS[id]);
      expect(span.className).toMatch(/invisible/);
      expect(span.className).toMatch(/absolute/);
      expect(span.getAttribute('aria-hidden')).toBe('true');
      expect(span.closest('button')?.className).not.toMatch(/inline-flex/);
    }
    expect(screen.getByRole('button', { name: '프로젝트 탐색' })).toBeTruthy();
  });

  test('labels 없음(⋯ 메뉴 행·모바일)·사이드 바(iconOnly)·씬 툴바: 라벨 노드가 아예 없다', () => {
    const plain = renderIds(ids, { mobileIcon: false, variant: 'project' });
    expect(plain.container.querySelector('[data-pb-label]')).toBeNull();
    plain.unmount();
    const side = renderIds(ids, { mobileIcon: false, variant: 'project', iconOnly: true, labels: 'show' });
    expect(side.container.querySelector('[data-pb-label]')).toBeNull();
    side.unmount();
    const scene = renderIds(ids, { mobileIcon: false, variant: 'scene', labels: 'show' });
    expect(scene.container.querySelector('[data-pb-label]')).toBeNull();
  });

  test('프롬프트조각은 단계와 무관하게 종전 글자 버튼(글자 = 레지스트리 label)', () => {
    renderIds(['piece-editor'], { mobileIcon: false, variant: 'project', labels: 'measure' });
    const span = screen.getByText('프롬프트조각');
    expect(span.hasAttribute('data-pb-label')).toBe(false);
    expect(span.className).toBe('hidden md:inline');
  });
});

describe('PC 프로젝트 바 버튼 바닥 선(App.css .pb-lines)', () => {
  test('같은 색 개별 선 규칙이 있고 영역 토큰은 없다', () => {
    const css = fs.readFileSync(path.join(__dirname, '../../componenets/App.css'), 'utf-8');
    expect(css).toContain('.pb-lines > *::after {');
    expect(css).toMatch(/\.pb-lines > \*::after \{[^}]*background-color: var\(--c-line-strong\);/);
    expect(css).toContain('.pb-lines > *:has(> .round-button)::after {');
    expect(css).not.toContain('barzone');
    expect(css).not.toContain('pb-zone');
  });
});
