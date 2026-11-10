/** @jest-environment jsdom */
// 사전 세팅 패널 라벨(2026-11-10 아이콘 직관화 묶음 2, SPEC_GUIDE §6 「사전 세팅 패널 라벨」).
// ① 라벨 단일 출처(길이 상한) ② 칸 나눔 줄 판정·측정 ③ 렌더(글자 단계 / 아이콘만 단계) ④ 프리셋 해제 버튼 라벨.
import React from 'react';
import { act, render, screen } from '@testing-library/react';
import * as fs from 'fs';
import * as path from 'path';
import {
  PRESET_ACTION_LABELS,
  PRESET_ACTION_LABEL_MAX_CHARS,
  PRESET_ICON_ROW_LABELS,
  PRESET_ICON_ROW_LABEL_MAX_CHARS,
  presetIconRowLabelOf,
} from '../presetPanelLabels';
import {
  SHARE_BUTTONS_HYSTERESIS_PX,
  pickProjectBarStage,
  shareButtonsNeeds,
} from '../projectBarStage';

jest.mock('../AppService', () => ({
  appState: { removeAppliedCharacterPreset: jest.fn() },
}));

// eslint-disable-next-line import/first
import { InlineLabel, StackedLabel, stackedButtonClass } from '../../componenets/PresetPanelLabel';
// eslint-disable-next-line import/first
import { measureShareButtons } from '../../componenets/useProjectBarStage';
// eslint-disable-next-line import/first
import { PresetReleaseButton } from '../../componenets/PresetReleaseButton';
// eslint-disable-next-line import/first
import { appState } from '../AppService';

const chars = (s: string) => Array.from(s.replace(/\s/g, '')).length;

describe('라벨 단일 출처(presetPanelLabels)', () => {
  test('동작 버튼 라벨 목록과 길이 상한(공백 뺀 1~6자)', () => {
    expect(PRESET_ACTION_LABELS).toEqual({
      newPreset: '새 세팅',
      copyFromGlobal: '글로벌에서',
      bulkDelete: '일괄 삭제',
      newStyle: '새 그림체',
      importFiles: '파일',
      releasePreset: '해제',
    });
    for (const v of Object.values(PRESET_ACTION_LABELS)) {
      expect(chars(v)).toBeGreaterThanOrEqual(1);
      expect(chars(v)).toBeLessThanOrEqual(PRESET_ACTION_LABEL_MAX_CHARS);
    }
  });

  test('하단 아이콘 행 라벨: 대상 키 4종 전부, 공백 뺀 4자 이하', () => {
    expect(PRESET_ICON_ROW_LABELS).toEqual({
      characterPrompts: '캐릭터',
      'sampling-group': '샘플링',
      vibes: '바이브',
      characterReferences: '레퍼런스',
    });
    for (const v of Object.values(PRESET_ICON_ROW_LABELS)) {
      expect(chars(v)).toBeLessThanOrEqual(PRESET_ICON_ROW_LABEL_MAX_CHARS);
    }
    // PreSetEdtior 의 PRESET_ICON_ROW_KEYS 와 같은 집합(키를 늘리면 라벨도 함께)
    const src = fs.readFileSync(
      path.join(__dirname, '../../componenets/PreSetEdtior.tsx'),
      'utf8',
    );
    const m = src.match(/PRESET_ICON_ROW_KEYS: readonly string\[\] = \[([^\]]*)\]/);
    expect(m).toBeTruthy();
    const keys = Array.from(m![1].matchAll(/'([^']+)'/g)).map((x) => x[1]).sort();
    expect(keys).toEqual(Object.keys(PRESET_ICON_ROW_LABELS).sort());
  });

  test('표에 없는 키는 그룹 제목 첫 토막을 상한까지 자른다', () => {
    expect(presetIconRowLabelOf('sampling-group', '샘플링/모델 설정')).toBe('샘플링');
    expect(presetIconRowLabelOf('new-group', '추가 프롬프트')).toBe('추가');
    expect(presetIconRowLabelOf(undefined, '샘플링모델설정/기타')).toBe('샘플링모');
    expect(presetIconRowLabelOf(undefined)).toBe('');
  });
});

describe('칸 나눔 줄 판정·측정', () => {
  test('가장 빠듯한 칸 하나로 판정, 아이콘만 단계는 넘침 없음', () => {
    const needs = shareButtonsNeeds([
      { room: 80, need: 30 },
      { room: 50, need: 44 },
      { room: 60, need: 20 },
    ]);
    expect(needs).toEqual({ available: 50, labelNeed: 44, iconNeed: 0 });
    expect(pickProjectBarStage(needs, 'label', SHARE_BUTTONS_HYSTERESIS_PX)).toBe('label');
    // 아이콘만에서 올라가려면 여유 4px 필요: 50-4=46 ≥ 44 → 글자
    expect(pickProjectBarStage(needs, 'icon', SHARE_BUTTONS_HYSTERESIS_PX)).toBe('label');
    const tight = shareButtonsNeeds([{ room: 46, need: 44 }]);
    expect(pickProjectBarStage(tight, 'icon', SHARE_BUTTONS_HYSTERESIS_PX)).toBe('icon');
    expect(pickProjectBarStage(tight, 'label', SHARE_BUTTONS_HYSTERESIS_PX)).toBe('label');
    expect(pickProjectBarStage(shareButtonsNeeds([{ room: 40, need: 44 }]), 'label', 4)).toBe('icon');
    // 칸 없음(숨김) = 판정 보류
    expect(pickProjectBarStage(shareButtonsNeeds([]), 'label', 4)).toBe('label');
  });

  const rect = (el: Element, width: number, height = 0) => {
    (el as HTMLElement).getBoundingClientRect = () => ({ width, height } as DOMRect);
  };
  const shareBtn = (w: number, h: number, labelW: number, labelH: number, topW: number, topH: number) => {
    const b = document.createElement('button');
    b.setAttribute('data-pb-share', '');
    b.style.padding = '4px 6px';
    rect(b, w, h);
    const top = document.createElement('span');
    top.setAttribute('data-pb-top', '');
    rect(top, topW, topH);
    const label = document.createElement('span');
    label.setAttribute('data-pb-label', '');
    rect(label, labelW, labelH);
    b.append(top, label);
    return b;
  };

  test('measureShareButtons width: 칸 안쪽 폭 vs 글자·윗줄 중 큰 폭', () => {
    const row = document.createElement('div');
    row.append(shareBtn(80, 32, 33, 11, 40, 16), shareBtn(60, 32, 44, 11, 14, 16));
    // 둘째 칸: 60 - 12 = 48 안쪽, 필요 44 → 여유 4 (첫 칸 68 vs 40 → 여유 28)
    expect(measureShareButtons(row, 'width')).toEqual({ available: 48, labelNeed: 44, iconNeed: 0 });
  });

  test('measureShareButtons height: 칸 안쪽 높이 vs 윗줄 + 간격 + 글자 높이', () => {
    const col = document.createElement('div');
    col.append(shareBtn(64, 30, 50, 11, 16, 16));
    // 30 - 8 = 22 안쪽, 필요 16 + 2 + 11 = 29 → 아이콘만
    const needs = measureShareButtons(col, 'height');
    expect(needs).toEqual({ available: 22, labelNeed: 29, iconNeed: 0 });
    expect(pickProjectBarStage(needs, 'label', 4)).toBe('icon');
  });
});

describe('렌더: 글자 단계 / 아이콘만 단계', () => {
  test('InlineLabel: show 는 보이는 글자, measure 는 보이지 않는 측정용', () => {
    const { rerender } = render(<InlineLabel text="일괄 삭제" mode="show" />);
    let span = screen.getByText('일괄 삭제');
    expect(span.getAttribute('data-pb-label')).toBe('');
    expect(span.className).not.toMatch(/invisible/);
    rerender(<InlineLabel text="일괄 삭제" mode="measure" />);
    span = screen.getByText('일괄 삭제');
    expect(span.className).toMatch(/invisible/);
    expect(span.className).toMatch(/absolute/);
    expect(span.getAttribute('aria-hidden')).toBe('true');
  });

  test('StackedLabel·stackedButtonClass: 글자 단계만 세로 쌓기, 아이콘만은 종전 h-8', () => {
    const { rerender } = render(<StackedLabel text="샘플링" mode="show" />);
    expect(screen.getByText('샘플링').className).toMatch(/text-\[11px\]/);
    expect(screen.getByText('샘플링').className).not.toMatch(/invisible/);
    rerender(<StackedLabel text="샘플링" mode="measure" />);
    expect(screen.getByText('샘플링').className).toMatch(/invisible/);
    expect(stackedButtonClass('show')).toMatch(/flex-col/);
    expect(stackedButtonClass('measure')).toMatch(/h-8/);
    expect(stackedButtonClass('measure')).not.toMatch(/flex-col/);
  });
});

describe('프리셋 해제 버튼', () => {
  const setup = (rowWidth: number) => {
    // 머리줄: 왼쪽(최소 80px 로 셈) + 오른쪽 버튼 무리. 폭은 getBoundingClientRect 원형에서 흉내낸다.
    const proto = HTMLElement.prototype as any;
    const orig = proto.getBoundingClientRect;
    proto.getBoundingClientRect = function getRect(this: HTMLElement) {
      if (this.hasAttribute('data-pb-label')) return { width: 26, height: 14 };
      if (this.getAttribute('data-test') === 'left') return { width: 200, height: 20 };
      if (this.getAttribute('data-test') === 'right') return { width: 90, height: 28 };
      return { width: 0, height: 0 };
    };
    // 행 폭 — 바깥 div 의 ref 는 안쪽 버튼의 첫 측정(layout effect)보다 늦게 붙으므로 원형 getter 로 준다.
    const origCW = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this.hasAttribute('data-release-row') ? rowWidth : 0;
      },
    });
    const utils = render(
      <div
        data-release-row=""
        style={{ display: 'flex' }}
      >
        <div data-test="left" data-pb-flex="" style={{ minWidth: '80px' }}>
          프리셋: 긴 이름
        </div>
        <div data-test="right">
          <PresetReleaseButton presetName="소녀" />
        </div>
      </div>,
    );
    return {
      ...utils,
      restore: () => {
        proto.getBoundingClientRect = orig;
        if (origCW) Object.defineProperty(HTMLElement.prototype, 'clientWidth', origCW);
      },
    };
  };

  test('넓으면 「해제」 글자, 좁으면 아이콘만 — 툴팁 전체 설명은 이름으로 유지', () => {
    // 아이콘만 필요 폭 80 + 90 = 170, 글자 몫 26 + 10 = 36 → 글자 206(올라갈 때 +12)
    const wide = setup(400);
    const label = screen.getByText('해제');
    expect(label.className).not.toMatch(/invisible/);
    const btn = screen.getByRole('button', {
      name: /소녀 프리셋 해제 — 연결된 바이브\/레퍼런스 함께 제거/,
    });
    expect(btn.className).toMatch(/inline-flex/);
    act(() => btn.click());
    expect(appState.removeAppliedCharacterPreset).toHaveBeenCalledWith('소녀');
    wide.restore();
    wide.unmount();

    const narrow = setup(190);
    expect(screen.getByText('해제').className).toMatch(/invisible/);
    expect(screen.getByRole('button').className).not.toMatch(/inline-flex/);
    narrow.restore();
    narrow.unmount();
  });
});
