/** @jest-environment jsdom */
// PC 씬 도구줄 「씬 N · 이미지 N · ★ N」 합계 표시(2026-11-23).
// ① 합계 순수 함수(탭 전체·카드와 같은 출처) ② 문구 ③ 자리 판정(좁으면 숨김·줄바꿈되면 숨김)
// ④ 표시가 버튼 이름 판정(measureButtonNames) 폭에 들어가지 않음 ⑤ 렌더(씬 0개 숨김·탭별 범위·이벤트 갱신·mains 관찰)
// ⑥ 호출부(모바일 제외·검색과 무관 — 세션·탭만 넘김).
import React from 'react';
import { act, render } from '@testing-library/react';
import * as fs from 'fs';
import * as path from 'path';
import { observable, runInAction } from 'mobx';
import {
  formatTotalCount,
  sceneTotalsFits,
  sceneTotalsTooltip,
  shouldShowSceneTotals,
  sumSceneImageTotals,
  SCENE_TOTALS_GAP_PX,
} from '../sceneImageTotals';
import { measureButtonNames } from '../../componenets/ToolbarButtonName';

jest.mock('..', () => {
  const gameService = new EventTarget() as EventTarget & { getOutputs: jest.Mock };
  gameService.getOutputs = jest.fn();
  return { gameService };
});
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { gameService: mockGame } = require('..') as {
  gameService: EventTarget & { getOutputs: jest.Mock };
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const SceneTotalsBadge = require('../../componenets/SceneTotalsBadge').default;

const read = (rel: string) =>
  fs.readFileSync(path.join(__dirname, '../../componenets', rel), 'utf-8').replace(/\r\n/g, '\n');

describe('합계 순수 함수', () => {
  test('씬 수·이미지 수 합·즐겨찾기(mains) 수 합', () => {
    const scenes = [
      { name: 'a', mains: ['1.png', '2.png'] },
      { name: 'b', mains: [] },
      { name: 'c', mains: ['x.webp'] },
    ];
    const counts: Record<string, number> = { a: 10, b: 0, c: 5 };
    expect(sumSceneImageTotals(scenes, (s) => counts[s.name])).toEqual({
      scenes: 3,
      images: 15,
      favorites: 3,
    });
  });
  test('즐겨찾기 수는 카드와 같은 mains.length — 목록에 없는 파일이 mains 에 남아도 그대로 센다(카드와 어긋나지 않게)', () => {
    const t = sumSceneImageTotals([{ mains: ['gone.png', 'a.png'] }], () => 1);
    expect(t.favorites).toBe(2);
  });
  test('씬이 0개면 표시하지 않음(이미지 0장 씬만 있으면 표시)', () => {
    expect(shouldShowSceneTotals(sumSceneImageTotals([], () => 0))).toBe(false);
    expect(shouldShowSceneTotals(sumSceneImageTotals([{ mains: [] }], () => 0))).toBe(true);
  });
  test('숫자 자리 구분·툴팁 문구', () => {
    expect(formatTotalCount(0)).toBe('0');
    expect(formatTotalCount(999)).toBe('999');
    expect(formatTotalCount(1250)).toBe('1,250');
    expect(formatTotalCount(1234567)).toBe('1,234,567');
    expect(sceneTotalsTooltip({ scenes: 42, images: 250, favorites: 37 })).toBe(
      '이 탭의 씬 42개 · 이미지 250장 · 즐겨찾기 37장 (휴지통 제외)',
    );
  });
});

describe('자리 판정 sceneTotalsFits', () => {
  const anchor = { left: 800, right: 1000, top: 10, bottom: 42 };
  const rowAt = (right: number) => ({ left: 0, right, top: 0, bottom: 50 });
  test('빈자리 ≥ 표시 폭 + 간격이면 보임, 모자라면 숨김', () => {
    const need = 200;
    expect(sceneTotalsFits({ need, anchor, row: rowAt(800 - need - SCENE_TOTALS_GAP_PX), others: [] })).toBe(true);
    expect(sceneTotalsFits({ need, anchor, row: rowAt(800 - need - SCENE_TOTALS_GAP_PX + 1), others: [] })).toBe(false);
  });
  test('보기 설정 묶음이 버튼 줄 아래로 줄바꿈되면 숨김(아래 줄에 빈자리가 있어도)', () => {
    const below = { left: 800, right: 1000, top: 60, bottom: 92 };
    expect(sceneTotalsFits({ need: 10, anchor: below, row: rowAt(900), others: [] })).toBe(false);
  });
  test('같은 줄의 다른 항목(숨김 영역 등)도 왼쪽 한계로 친다', () => {
    const zone = { left: 600, right: 700, top: 10, bottom: 42 };
    expect(sceneTotalsFits({ need: 100, anchor, row: rowAt(300), others: [zone] })).toBe(false);
    expect(sceneTotalsFits({ need: 80, anchor, row: rowAt(300), others: [zone] })).toBe(true);
  });
  test('표시 폭이 0(아직 그려지지 않음·숨은 묶음)이면 숨김', () => {
    expect(sceneTotalsFits({ need: 0, anchor, row: rowAt(0), others: [] })).toBe(false);
  });
});

describe('표시는 버튼 이름 판정 폭에 들어가지 않음', () => {
  test('보기 설정 묶음 안의 absolute 표시가 있든 없든 measureButtonNames 결과가 같다', () => {
    const build = (withBadge: boolean) => {
      const outer = document.createElement('div');
      outer.style.display = 'flex';
      Object.defineProperty(outer, 'clientWidth', { value: 1000 });
      const row = document.createElement('div');
      row.setAttribute('data-bn-row', '');
      const btn = document.createElement('div');
      btn.getBoundingClientRect = () => ({ width: 300 } as DOMRect);
      row.append(btn);
      const anchor = document.createElement('div');
      anchor.setAttribute('data-scene-totals-anchor', '');
      anchor.style.position = 'relative';
      // 묶음 폭은 flex 항목(선택 칸·크기 버튼)으로만 정해진다 — absolute 표시는 폭에 기여하지 않는다
      anchor.getBoundingClientRect = () => ({ width: 160 } as DOMRect);
      if (withBadge) {
        const badge = document.createElement('div');
        badge.style.position = 'absolute';
        badge.getBoundingClientRect = () => ({ width: 220 } as DOMRect);
        anchor.append(badge);
      }
      outer.append(row, anchor);
      return outer;
    };
    expect(measureButtonNames(build(true), false)).toEqual(measureButtonNames(build(false), false));
  });
});

describe('렌더 SceneTotalsBadge', () => {
  const mkSession = () =>
    observable({
      name: 'p',
      scenes: [
        { name: 's1', type: 'scene', mains: ['a'] },
        { name: 's2', type: 'scene', mains: [] as string[] },
      ],
      inpaints: [{ name: 'i1', type: 'inpaint', mains: ['x', 'y', 'z'] }],
      getScenes(type: 'scene' | 'inpaint') {
        return type === 'scene' ? this.scenes : this.inpaints;
      },
    });
  let outputs: Record<string, string[]>;
  beforeEach(() => {
    outputs = { 's1': ['1', '2', '3'], 's2': ['4'], 'i1': ['5', '6'] };
    mockGame.getOutputs.mockImplementation((_s: unknown, scene: { name: string }) => outputs[scene.name] ?? []);
  });
  const text = (c: HTMLElement) => c.querySelector('[data-scene-totals]')?.textContent;

  test('탭별 범위: 생성 탭은 생성 씬만, 변형 탭은 변형 씬만', () => {
    const session = mkSession();
    const a = render(<SceneTotalsBadge session={session} type="scene" />);
    expect(text(a.container)).toBe('씬2·이미지4·1');
    const b = render(<SceneTotalsBadge session={session} type="inpaint" />);
    expect(text(b.container)).toBe('씬1·이미지2·3');
  });

  test('씬 0개면 그리지 않음', () => {
    const session = mkSession();
    runInAction(() => {
      session.inpaints = [];
    });
    const { container } = render(<SceneTotalsBadge session={session} type="inpaint" />);
    expect(container.querySelector('[data-scene-totals]')).toBeNull();
  });

  test('gameService updated 이벤트로 이미지 수, MobX 로 씬 추가·즐겨찾기 변화가 반영', () => {
    const session = mkSession();
    const { container } = render(<SceneTotalsBadge session={session} type="scene" />);
    outputs.s2 = ['4', '7', '8'];
    act(() => {
      mockGame.dispatchEvent(new CustomEvent('updated'));
    });
    expect(text(container)).toBe('씬2·이미지6·1');
    act(() => {
      runInAction(() => {
        session.scenes[1].mains.push('7');
        session.scenes.push({ name: 's3', type: 'scene', mains: [] });
      });
    });
    expect(text(container)).toBe('씬3·이미지6·2');
  });

  test('자리 판정: 바깥 줄 안에서 빈자리가 모자라면 invisible, 넉넉하면 보임', () => {
    const session = mkSession();
    const setup = (rowRight: number) => {
      const outer = document.createElement('div');
      outer.style.display = 'flex';
      const row = document.createElement('div');
      row.setAttribute('data-bn-row', '');
      row.getBoundingClientRect = () => ({ left: 0, right: rowRight, top: 0, bottom: 50, width: rowRight } as DOMRect);
      const anchor = document.createElement('div');
      anchor.setAttribute('data-scene-totals-anchor', '');
      anchor.getBoundingClientRect = () => ({ left: 800, right: 1000, top: 18, bottom: 50, width: 200 } as DOMRect);
      outer.append(row, anchor);
      document.body.append(outer);
      // 표시 폭 = 180(+ mr-3 은 jsdom 에서 계산되지 않아 0)
      const proto = HTMLDivElement.prototype as any;
      const orig = proto.getBoundingClientRect;
      proto.getBoundingClientRect = function (this: HTMLElement) {
        if (this.hasAttribute('data-scene-totals')) return { left: 0, right: 0, top: 0, bottom: 0, width: 180 } as DOMRect;
        return orig.call(this);
      };
      const r = render(<SceneTotalsBadge session={session} type="scene" />, { container: anchor });
      proto.getBoundingClientRect = orig;
      const badge = anchor.querySelector('[data-scene-totals]') as HTMLElement;
      const out = { fits: badge.getAttribute('data-fits'), invisible: badge.classList.contains('invisible') };
      r.unmount();
      outer.remove();
      return out;
    };
    expect(setup(800 - 180 - SCENE_TOTALS_GAP_PX)).toEqual({ fits: 'true', invisible: false });
    expect(setup(800 - 180 - SCENE_TOTALS_GAP_PX + 1)).toEqual({ fits: 'false', invisible: true });
  });
});

describe('호출부', () => {
  const src = read('SceneQueueControl.tsx');
  test('보기 설정 묶음 안, 카드 모양 선택 칸 앞(왼쪽)에 PC 전용으로 둔다', () => {
    const i = src.indexOf('data-scene-totals-anchor=""');
    expect(i).toBeGreaterThan(0);
    const badge = src.indexOf('{!isMobile && <SceneTotalsBadge session={curSession} type={type} />}', i);
    const select = src.indexOf('{!appState.classicSceneCard && (', i);
    expect(badge).toBeGreaterThan(i);
    expect(badge).toBeLessThan(select);
  });
  test('세션·탭만 넘긴다(씬 검색 결과와 무관하게 탭 전체)', () => {
    const badge = read('SceneTotalsBadge.tsx');
    expect(badge).toContain('session.getScenes(type)');
    expect(badge).not.toMatch(/getFilteredScenes|sceneSearchQuery/);
  });
});
