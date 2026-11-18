/** @jest-environment jsdom */
// PC 툴바 버튼 이름(아이콘 아래 작은 이름, 2026-11-18) — 씬 툴바·이미지 그리드 머리줄.
// ① 이름 문구 단일 출처(uiLayout sceneLabel ?? label, 머리줄 GRID_HEADER_NAMES) ② 단계 판정 순수 함수(buttonNameNeeds)
// ③ 측정(measureButtonNames) ④ 렌더(보임·측정·없음, 이름 누르면 버튼) ⑤ 켜짐 조건(설정 끔·모바일·글자 모드면 이름 없음).
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import * as fs from 'fs';
import * as path from 'path';
import {
  SCENE_TOOLBAR_MORE_LABEL,
  sceneToolbarRegistry,
  sceneToolbarLabelOf,
} from '../uiLayout';
import {
  BUTTON_NAME_GAP_ICON_PX,
  BUTTON_NAME_GAP_LABEL_PX,
  buttonNameNeeds,
  namedGroupWidth,
} from '../buttonNameStage';
import { pickProjectBarStage } from '../projectBarStage';
import { ButtonNameSlot, measureButtonNames } from '../../componenets/ToolbarButtonName';

const read = (rel: string) =>
  fs.readFileSync(path.join(__dirname, '../../componenets', rel), 'utf-8').replace(/\r\n/g, '\n');

describe('이름 문구 단일 출처', () => {
  test('씬 툴바 버튼 이름(사용자 시안 문구)', () => {
    const want: Record<string, string> = {
      'add-scene': '씬 추가',
      'queue-add': '예약',
      'batch-process': '대량 작업',
      'export-images': '내보내기',
      'quick-export': '빠른 내보내기',
      'multi-select': '선택',
      'scene-search': '검색',
      'bookmark-jump': '북마크',
      'find-replace': '찾기·변환',
      'batch-insert': '일괄 삽입',
      'change-resolution': '해상도',
      'import-image': '추출',
      'piece-editor': '조각',
      'scene-find': '위치 이동',
      'image-review': '검수',
      'artist-breakdown': '작가 분해',
      'artist-prefix-toggle': '접두 전환',
      'artist-tag': '작가 태깅',
      'scene-trash': '씬 휴지통',
      'empty-image-trash': '삭제 비우기',
      'shortcut-help': '단축키',
      // 프로젝트 바에서 옮겨 온 버튼은 기존 label
      'add-session': '새 프로젝트',
      'project-trash': '휴지통',
    };
    for (const [id, name] of Object.entries(want)) expect(sceneToolbarLabelOf(id)).toBe(name);
    expect(SCENE_TOOLBAR_MORE_LABEL).toBe('더보기');
    // 글자형 버튼(WebP 변환)·없는 id 는 이름 없음
    expect(sceneToolbarLabelOf('webp-convert')).toBeUndefined();
    expect(sceneToolbarLabelOf('없는-id')).toBeUndefined();
  });

  test('글자형 WebP 변환 말고는 씬 레지스트리 버튼 모두 2~7자 이름이 있다', () => {
    const bad = sceneToolbarRegistry
      .filter((b) => b.id !== 'webp-convert')
      .filter((b) => {
        const n = (sceneToolbarLabelOf(b.id) ?? '').replace(/\s/g, '').length;
        return n < 2 || n > 7;
      })
      .map((b) => b.id);
    expect(bad).toEqual([]);
  });

  test('이미지 그리드 머리줄 이름 표(ResultViewer GRID_HEADER_NAMES)와 쓰임', () => {
    const src = read('ResultViewer.tsx');
    for (const [key, name] of [
      ['folder', '폴더'],
      ['selectMode', '선택'],
      ['favSelect', '즐겨찾기 선택'],
      ['download', '다운로드'],
      ['copy', '복사'],
      ['paste', '붙여넣기'],
      ['favToggle', '즐겨찾기'],
      ['duplicate', '복제'],
      ['copyToScene', '씬 복사'],
      ['delete', '삭제'],
      ['sample', '샘플 뽑기'],
      ['bookmark', '북마크'],
    ]) {
      expect(src).toContain(`  ${key}: '${name}',`);
      expect(src).toContain(`hn('${key}', (`);
    }
  });
});

describe('단계 판정 buttonNameNeeds', () => {
  const g = (caption: number, slots: [number, number][], gi = 8, gl = 10) => ({
    caption,
    slots: slots.map(([body, name]) => ({ body, name })),
    gapIcon: gi,
    gapLabel: gl,
  });

  test('칸 폭 = max(캡션, 버튼마다 max(버튼, 이름) + 간격)', () => {
    const grp = g(30, [[36, 40], [36, 20], [64, 50]]);
    expect(namedGroupWidth(grp, false)).toBe(36 + 36 + 64 + 2 * 8);
    expect(namedGroupWidth(grp, true)).toBe(40 + 36 + 64 + 2 * 10);
    // 캡션이 더 넓으면 칸 폭은 캡션
    expect(namedGroupWidth(g(200, [[36, 40]]), true)).toBe(200);
    expect(namedGroupWidth(g(46, [[36, 0]]), false)).toBe(46);
    expect(namedGroupWidth(g(20, []), true)).toBe(20);
  });

  test('현재 단계 폭 + 이름 몫(칸 폭 차이 합)', () => {
    const groups = [g(30, [[36, 40], [36, 20]]), g(50, [[36, 44]])];
    // 칸1: 숨김 80 → 보임 86(+6), 칸2: 숨김 50(캡션) → 보임 50(+0)
    expect(buttonNameNeeds(1000, 400, groups, false)).toEqual({
      available: 1000,
      labelNeed: 406,
      iconNeed: 400,
    });
    expect(buttonNameNeeds(1000, 406, groups, true)).toEqual({
      available: 1000,
      labelNeed: 406,
      iconNeed: 400,
    });
  });

  test('pickProjectBarStage 와 이어 붙이면 넓으면 이름, 좁으면 숨김, 경계에서 왕복하지 않는다', () => {
    const groups = [g(0, [[36, 60], [36, 60]])]; // 이름 몫 = 130 - 80 = 50
    const at = (available: number, prev: 'label' | 'icon') =>
      pickProjectBarStage(buttonNameNeeds(available, prev === 'label' ? 450 : 400, groups, prev === 'label'), prev);
    expect(at(1000, 'icon')).toBe('label');
    expect(at(430, 'label')).toBe('icon');
    for (const w of [440, 450, 455, 462, 470]) {
      for (const from of ['icon', 'label'] as const) {
        const next = at(w, from) as 'label' | 'icon';
        expect(at(w, next)).toBe(next);
      }
    }
  });

  test('간격 상수는 CSS 와 짝', () => {
    const css = read('App.css');
    expect(BUTTON_NAME_GAP_ICON_PX).toBe(8);
    expect(css).toMatch(/\.toolbar-group-buttons \{[^}]*gap: 0\.5rem;/);
    expect(BUTTON_NAME_GAP_LABEL_PX).toBe(10);
    expect(css).toMatch(/\.scene-toolbar-named \.toolbar-group-buttons \{[^}]*gap: 10px;/);
    expect(css).toMatch(/\.tb-name \{[^}]*font-size: 11px;/);
  });
});

describe('측정 measureButtonNames', () => {
  const box = (el: Element, width: number) => {
    (el as HTMLElement).getBoundingClientRect = () => ({ width } as DOMRect);
  };
  test('옆 요소를 뺀 가용 폭, 버튼 줄 항목(+여백) 합, 칸마다 이름 몫(캡션·간격)', () => {
    const outer = document.createElement('div');
    outer.style.display = 'flex';
    Object.defineProperty(outer, 'clientWidth', { value: 1000 });
    const row = document.createElement('div');
    row.setAttribute('data-bn-row', '');
    // 칸 하나: 캡션 30 + 버튼 2개(36·36, 이름 40·20)
    const grp = document.createElement('div');
    grp.style.marginLeft = '6px';
    box(grp, 80);
    const cap = document.createElement('div');
    cap.setAttribute('data-bn-caption', '');
    box(cap, 30);
    const items = document.createElement('div');
    items.setAttribute('data-bn-items', '');
    items.setAttribute('data-bn-gap-icon', '8');
    items.setAttribute('data-bn-gap-label', '10');
    items.style.columnGap = '8px';
    const mk = (body: number, name: number) => {
      const wrap = document.createElement('div');
      box(wrap, body);
      const slot = document.createElement('div');
      slot.setAttribute('data-bn-slot', '');
      const b = document.createElement('div');
      b.setAttribute('data-bn-body', '');
      box(b, body);
      const n = document.createElement('span');
      n.setAttribute('data-bn-name', '');
      n.style.position = 'absolute';
      box(n, name);
      slot.append(b, n);
      wrap.append(slot);
      return wrap;
    };
    items.append(mk(36, 40), mk(36, 20));
    grp.append(cap, items);
    // 칸 밖 이름 달린 버튼(⋯ 더보기)
    const more = mk(36, 33);
    row.append(grp, more);
    // 옆 요소(셀 크기 선택) 120 + 오른쪽 여백 8
    const side = document.createElement('div');
    side.style.marginRight = '8px';
    box(side, 120);
    outer.append(row, side);
    const got = measureButtonNames(outer, false);
    expect(got.available).toBe(1000 - 128);
    expect(got.iconNeed).toBe(80 + 6 + 36);
    // 칸: 80 → 40+36+10 = 86(+6), 더보기: 36 → 36(+0)
    expect(got.labelNeed).toBe(80 + 6 + 36 + 6);
  });

  test('버튼 줄이 없으면 판정 보류(폭 0)', () => {
    expect(measureButtonNames(document.createElement('div'), false).available).toBe(0);
  });
});

describe('렌더 ButtonNameSlot', () => {
  test("'show': 버튼 아래 이름(aria-hidden), 이름을 누르면 버튼이 눌린다", () => {
    const onClick = jest.fn();
    render(
      <ButtonNameSlot name="검색" mode="show">
        <button aria-label="씬 검색" onClick={onClick} />
      </ButtonNameSlot>,
    );
    const name = screen.getByText('검색');
    expect(name.getAttribute('aria-hidden')).toBe('true');
    expect(name.className).toMatch(/tb-name/);
    expect(name.className).toMatch(/text-muted/);
    expect(name.className).not.toMatch(/tb-name-measure/);
    // 접근성 이름은 버튼의 것 그대로
    expect(screen.getByRole('button', { name: '씬 검색' })).toBeTruthy();
    fireEvent.click(name);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test("'measure': 보이지 않는 측정용 이름만, 눌러도 아무 일 없음", () => {
    const onClick = jest.fn();
    render(
      <ButtonNameSlot name="검색" mode="measure">
        <button onClick={onClick} />
      </ButtonNameSlot>,
    );
    const name = screen.getByText('검색');
    expect(name.className).toMatch(/tb-name-measure/);
    fireEvent.click(name);
    expect(onClick).not.toHaveBeenCalled();
  });

  test('mode 없음(설정 끔·모바일·글자 모드)·이름 없음(글자형 버튼): 래퍼 없이 버튼 그대로', () => {
    const a = render(
      <ButtonNameSlot name="검색" mode={undefined}>
        <button>x</button>
      </ButtonNameSlot>,
    );
    expect(a.container.querySelector('[data-bn-slot]')).toBeNull();
    expect(a.container.innerHTML).toBe('<button>x</button>');
    a.unmount();
    const b = render(
      <ButtonNameSlot name={undefined} mode="show">
        <button>WebP</button>
      </ButtonNameSlot>,
    );
    expect(b.container.querySelector('[data-bn-slot]')).toBeNull();
  });
});

describe('켜짐 조건(소스 대조)', () => {
  test('씬 툴바: PC·그룹 툴바·아이콘 모드·설정 켬일 때만', () => {
    const src = read('SceneQueueControl.tsx');
    const m = src.match(/const buttonNamesEnabled =([\s\S]*?);/);
    expect(m).toBeTruthy();
    const cond = m![1];
    expect(cond).toContain('!isMobile');
    expect(cond).toContain('!appState.uiToolbar.classic');
    expect(cond).toContain('!appState.sceneToolbarLegacyText');
    expect(cond).toContain('appState.uiToolbarButtonNames');
    expect(cond).toContain('!v2Layout');
    expect(src).toContain('<ButtonNameSlot name={sceneToolbarLabelOf(id)} mode={buttonNameMode}>');
  });

  test('이미지 그리드 머리줄: PC·클래식 머리줄·설정 켬일 때만', () => {
    expect(read('ResultViewer.tsx')).toContain(
      'useButtonNameStage(\n      !isMobile && !v2 && appState.uiToolbarButtonNames,\n    )',
    );
  });

  test('설정 기본은 켬(저장값 없으면 켬)', () => {
    expect(read('App.tsx')).toContain('appState.uiToolbarButtonNames = conf.uiToolbarButtonNames ?? true;');
    const cfg = read('ConfigScreen.tsx');
    expect(cfg).toContain('setUiToolbarButtonNames(config.uiToolbarButtonNames ?? true);');
    expect(cfg).toContain('uiToolbarButtonNames !== (savedCfg.uiToolbarButtonNames ?? true)');
  });
});
