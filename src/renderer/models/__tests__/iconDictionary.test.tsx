/** @jest-environment jsdom */
// 아이콘 의미 사전(I1, SPEC_GUIDE §6) — 툴바 id 전부에 아이콘이 있고, 전용 아이콘이 다른 뜻에 쓰이지 않는지.
// Tooltip 이 아이콘 버튼에 툴팁 문구를 이름(aria-label)으로 붙이는지도 함께 확인한다.
import React from 'react';
import { render, screen } from '@testing-library/react';
import {
  FaCloud,
  FaCloudDownloadAlt,
  FaCloudUploadAlt,
  FaCog,
  FaHeart,
  FaPaintBrush,
  FaPlus,
  FaShare,
  FaStar,
} from 'react-icons/fa';
import {
  BackupExportIcon,
  EXCLUSIVE_ICONS,
  ICON_DICTIONARY,
  IconId,
  iconOf,
} from '../iconDictionary';
import { TOOLBAR_VIEW_MAIN } from '../uiLayout';
import Tooltip, { withTooltipAriaLabel } from '../../componenets/Tooltip';

const entries = Object.entries(ICON_DICTIONARY) as [IconId, unknown][];
const keysUsing = (icon: unknown) =>
  entries.filter(([, v]) => v === icon).map(([k]) => k);

describe('아이콘 의미 사전', () => {
  test('툴바 레지스트리(씬·프로젝트)의 모든 id 에 아이콘이 있다', () => {
    const missing = TOOLBAR_VIEW_MAIN.flatMap((a) => a.registry)
      .map((b) => b.id)
      .filter((id) => !iconOf(id));
    expect(missing).toEqual([]);
  });

  test('같은 툴바(영역) 안에서 두 버튼이 같은 아이콘을 쓰지 않는다', () => {
    for (const { area, registry } of TOOLBAR_VIEW_MAIN) {
      const seen = new Map<unknown, string>();
      const dup: string[] = [];
      for (const { id } of registry) {
        const icon = iconOf(id);
        if (seen.has(icon)) dup.push(`${area}: ${seen.get(icon)} = ${id}`);
        else seen.set(icon, id);
      }
      expect(dup).toEqual([]);
    }
  });

  test('전용 아이콘은 지정된 키에서만 쓴다(즐겨찾기·인페인트·환경설정·작가 즐겨찾기·공유)', () => {
    for (const rule of EXCLUSIVE_ICONS) {
      expect({ meaning: rule.meaning, keys: keysUsing(rule.icon) }).toEqual({
        meaning: rule.meaning,
        keys: rule.keys,
      });
    }
    // 규칙 표가 실제 아이콘을 가리키는지(오타 방지)
    expect(keysUsing(FaStar)).toEqual(['favorite']);
    expect(keysUsing(FaPaintBrush)).toEqual(['inpaint']);
    expect(keysUsing(FaCog)).toEqual(['preferences']);
    expect(keysUsing(FaHeart)).toEqual(['artist-favorite']);
    expect(keysUsing(FaShare)).toEqual(['share']);
  });

  test('구름 아이콘은 드라이브 전용 — 드라이브 외 키에 구름 계열이 없다', () => {
    const clouds = [FaCloud, FaCloudDownloadAlt, FaCloudUploadAlt];
    const used = entries
      .filter(([, v]) => clouds.includes(v as typeof FaCloud))
      .map(([k]) => k)
      .filter((k) => !k.startsWith('drive'));
    expect(used).toEqual([]);
  });

  test('backup-export 는 합성 아이콘(백업 본체+55% 화살표) — 단독 백업·공유 키와 별개', () => {
    expect(iconOf('backup-export')).toBe(BackupExportIcon);
    expect(iconOf('backup')).not.toBe(BackupExportIcon);
    const { container } = render(<BackupExportIcon size={18} className="mr-1" />);
    const wrap = container.firstElementChild as HTMLElement;
    expect(wrap.tagName).toBe('SPAN');
    expect(wrap.className).toContain('mr-1');
    const svgs = wrap.querySelectorAll('svg');
    expect(svgs).toHaveLength(2);
    expect(svgs[0].getAttribute('width')).toBe('18');
    expect(svgs[1].getAttribute('width')).toBe('10');
    expect(svgs[1].getAttribute('aria-hidden')).toBe('true');
    // 크기 미지정이면 em 기준
    const { container: c2 } = render(<BackupExportIcon />);
    expect(c2.querySelectorAll('svg')[1].getAttribute('width')).toBe('0.55em');
  });

  test('사전에 없는 id 는 undefined(퀵 메뉴는 번개로 대신)', () => {
    expect(iconOf('no-such-action')).toBeUndefined();
    expect(iconOf('toString')).toBeUndefined();
    expect(iconOf('add-scene')).toBe(FaPlus);
  });
});

describe('Tooltip 이 아이콘 버튼에 이름을 붙인다', () => {
  test('aria-label 이 없는 버튼에는 툴팁 문구를 aria-label 로', () => {
    render(
      <Tooltip content="씬 검색">
        <button type="button">
          <FaPlus />
        </button>
      </Tooltip>,
    );
    expect(screen.getByRole('button', { name: '씬 검색' })).toBeTruthy();
  });

  test('자식이 정한 aria-label 이 우선', () => {
    render(
      <Tooltip content="툴팁 문구">
        <button type="button" aria-label="직접 붙인 이름">
          <FaPlus />
        </button>
      </Tooltip>,
    );
    expect(screen.getByRole('button', { name: '직접 붙인 이름' })).toBeTruthy();
  });

  test('클릭 요소가 아니거나 컴포넌트 자식이면 손대지 않는다', () => {
    const plain = withTooltipAriaLabel(<span>설명</span>, '툴팁') as React.ReactElement;
    expect(plain.props['aria-label']).toBeUndefined();
    const Custom = (props: { children?: React.ReactNode }) => <>{props.children}</>;
    const comp = withTooltipAriaLabel(<Custom />, '툴팁') as React.ReactElement;
    expect((comp.props as Record<string, unknown>)['aria-label']).toBeUndefined();
    const clickableDiv = withTooltipAriaLabel(
      <div onClick={() => {}} />,
      '클릭 칸',
    ) as React.ReactElement;
    expect(clickableDiv.props['aria-label']).toBe('클릭 칸');
  });
});
