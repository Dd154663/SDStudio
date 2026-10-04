// PC 씬 툴바 그룹(2026-10-04 T5, 2-D 그룹 캡션) — groupToolbarIds 순수 함수와 레지스트리 group 계약.
// 렌더 규칙: 그룹 순서 고정(TOOLBAR_GROUPS) · 그룹 안은 사용자 순서 · 그룹 없는 버튼은 맨 끝 「기타」 칸(비면 없음) · hidden 제외.

import { UiToolbarConfig } from '../../../main/config';
import {
  TOOLBAR_GROUPS,
  TOOLBAR_GROUP_OTHER_HINT,
  TOOLBAR_GROUP_OTHER_LABEL,
  TOOLBAR_VIEW_MAIN,
  groupToolbarIds,
  moveToolbarButton,
  projectToolbarRegistry,
  resolveToolbarView,
  sceneToolbarRegistry,
} from '../uiLayout';

// PC 씬 영역 인라인(해석 결과) → 그룹 칸. SceneQueueControl 과 같은 경로.
const pcSegments = (ov: UiToolbarConfig | undefined) => {
  const scene = resolveToolbarView(TOOLBAR_VIEW_MAIN, ov, false).find(
    (a) => a.area === 'scene',
  )!;
  return groupToolbarIds(scene.inline);
};
const asMap = (segs: ReturnType<typeof groupToolbarIds>) =>
  segs.map((s) => [s.group, s.caption, s.ids] as const);

describe('groupToolbarIds — 기본 배치(PC)', () => {
  it('생성 / 내보내기 / 탐색 / 편집 도구 순서, 기타 칸 없음', () => {
    expect(asMap(pcSegments(undefined))).toEqual([
      ['create', '생성', ['add-scene', 'queue-add', 'batch-process']],
      ['export', '내보내기', ['export-images', 'quick-export']],
      ['navigate', '탐색', ['multi-select', 'scene-search', 'bookmark-jump', 'find-replace']],
      ['edit', '편집 도구', ['change-resolution']],
    ]);
  });

  it('그룹 렌더는 표시만 바꾼다 — 기본 인라인 집합은 그룹 도입 전과 같다(증식 차단)', () => {
    const scene = resolveToolbarView(TOOLBAR_VIEW_MAIN, undefined, false).find(
      (a) => a.area === 'scene',
    )!;
    expect(scene.inline).toEqual([
      'add-scene',
      'queue-add',
      'export-images',
      'quick-export',
      'batch-process',
      'multi-select',
      'change-resolution',
      'scene-search',
      'bookmark-jump',
      'find-replace',
    ]);
  });
});

describe('groupToolbarIds — 사용자 배치', () => {
  it('⋯ 메뉴 버튼을 툴바로 꺼내면(pinned) 제 그룹 칸에 들어간다', () => {
    const ov = moveToolbarButton(TOOLBAR_VIEW_MAIN, undefined, {
      id: 'scene-find',
      toArea: 'scene',
      slot: 'inline',
    });
    const nav = pcSegments(ov).find((s) => s.group === 'navigate')!;
    expect(nav.ids).toEqual(['multi-select', 'scene-search', 'bookmark-jump', 'find-replace', 'scene-find']);
    const edit = pcSegments({ buttons: { 'artist-tag': 'pinned', 'import-image': 'pinned' } }).find(
      (s) => s.group === 'edit',
    )!;
    expect(edit.ids).toEqual(['change-resolution', 'import-image', 'artist-tag']);
  });

  it('그룹 없는 버튼을 꺼내면 맨 끝 「기타」 칸', () => {
    const segs = pcSegments({ buttons: { 'scene-trash': 'pinned', 'webp-convert': 'pinned' } });
    const tail = segs[segs.length - 1];
    expect(tail.group).toBe('other');
    expect(tail.caption).toBe('기타');
    expect(tail.ids).toEqual(['webp-convert', 'scene-trash']);
    expect(segs.filter((s) => s.group === 'other')).toHaveLength(1);
  });

  it('기타 칸 — 그룹 없는 버튼 4개 모두 꺼내면 사용자 순서 그대로, 다른 그룹 칸은 불변', () => {
    let ov = moveToolbarButton(TOOLBAR_VIEW_MAIN, undefined, {
      id: 'shortcut-help',
      toArea: 'scene',
      slot: 'inline',
    });
    for (const id of ['empty-image-trash', 'scene-trash', 'webp-convert']) {
      ov = moveToolbarButton(TOOLBAR_VIEW_MAIN, ov, { id, toArea: 'scene', slot: 'inline' });
    }
    const segs = pcSegments(ov);
    expect(segs.map((s) => s.group)).toEqual(['create', 'export', 'navigate', 'edit', 'other']);
    expect(segs[4].ids).toEqual(['shortcut-help', 'empty-image-trash', 'scene-trash', 'webp-convert']);
    expect(segs.slice(0, 4)).toEqual(pcSegments(undefined));
  });

  it('기타 칸 — 그룹 버튼과 섞어 저장돼도 기타 버튼만 기타 칸, 기타 버튼을 다시 메뉴로 보내면 칸이 사라진다', () => {
    const ov = moveToolbarButton(TOOLBAR_VIEW_MAIN, undefined, {
      id: 'scene-trash',
      toArea: 'scene',
      slot: 'inline',
      anchor: { id: 'add-scene', side: 'before' },
    });
    expect(ov.areas!.scene!.inline![0]).toBe('scene-trash');
    const segs = pcSegments(ov);
    expect(segs[0].group).toBe('create');
    expect(segs[segs.length - 1]).toEqual({ group: 'other', caption: '기타', ids: ['scene-trash'] });
    const back = moveToolbarButton(TOOLBAR_VIEW_MAIN, ov, { id: 'scene-trash', toArea: 'scene', slot: 'menu' });
    expect(pcSegments(back).some((s) => s.group === 'other')).toBe(false);
  });

  it('다른 영역에서 온 portable 버튼(그룹 없음)도 기타 칸', () => {
    const ov = moveToolbarButton(TOOLBAR_VIEW_MAIN, undefined, {
      id: 'project-browser',
      toArea: 'scene',
      slot: 'inline',
      anchor: { id: 'add-scene', side: 'before' },
    });
    const segs = pcSegments(ov);
    expect(segs[0].group).toBe('create');
    expect(segs[segs.length - 1]).toEqual({ group: 'other', caption: '기타', ids: ['project-browser'] });
  });

  it('hidden 은 제외, 그룹이 비면 칸 자체가 없다', () => {
    const segs = pcSegments({ buttons: { 'change-resolution': 'hidden', 'bookmark-jump': 'hidden' } });
    expect(segs.map((s) => s.group)).toEqual(['create', 'export', 'navigate']);
    expect(segs.find((s) => s.group === 'navigate')!.ids).not.toContain('bookmark-jump');
  });

  it('그룹 안은 사용자 순서, 그룹 경계를 넘긴 저장 순서는 표시에서만 제 그룹으로', () => {
    let ov = moveToolbarButton(TOOLBAR_VIEW_MAIN, undefined, {
      id: 'find-replace',
      toArea: 'scene',
      slot: 'inline',
      anchor: { id: 'multi-select', side: 'before' },
    });
    // 탐색 칸 버튼을 생성 칸 맨 앞에 끌어 놓아도 저장은 그 순서, 표시는 탐색 칸
    ov = moveToolbarButton(TOOLBAR_VIEW_MAIN, ov, {
      id: 'scene-search',
      toArea: 'scene',
      slot: 'inline',
      anchor: { id: 'add-scene', side: 'before' },
    });
    expect(ov.areas!.scene!.inline![0]).toBe('scene-search');
    const segs = pcSegments(ov);
    expect(segs[0].ids[0]).toBe('add-scene');
    expect(segs.find((s) => s.group === 'navigate')!.ids).toEqual([
      'scene-search',
      'find-replace',
      'multi-select',
      'bookmark-jump',
    ]);
  });

  it('빈 목록·레지스트리에 없는 id', () => {
    expect(groupToolbarIds([])).toEqual([]);
    expect(groupToolbarIds(['no-such-id'])).toEqual([{ group: 'other', caption: '기타', ids: ['no-such-id'] }]);
  });
});

describe('레지스트리 group 계약', () => {
  it('그룹 순서·캡션(단일 출처)', () => {
    expect(TOOLBAR_GROUPS.map((g) => [g.id, g.caption])).toEqual([
      ['create', '생성'],
      ['export', '내보내기'],
      ['navigate', '탐색'],
      ['edit', '편집 도구'],
      ['other', '기타'],
    ]);
    expect(TOOLBAR_GROUP_OTHER_LABEL).toBe('기타');
    expect(TOOLBAR_GROUP_OTHER_HINT).toBe(
      '더보기에서 꺼낸 버튼 중 그룹이 없는 것은 툴바 끝 「기타」 칸에 모입니다.',
    );
  });

  it('씬 툴바 그룹 배정 — 그룹 없는 버튼(꺼내면 기타 칸)은 ⋯ 메뉴 유지 대상 4개뿐', () => {
    const byGroup: Record<string, string[]> = {};
    for (const b of sceneToolbarRegistry) {
      const k = b.group ?? 'none';
      if (!byGroup[k]) byGroup[k] = [];
      byGroup[k].push(b.id);
    }
    expect(byGroup).toEqual({
      create: ['add-scene', 'queue-add', 'batch-process'],
      export: ['export-images', 'quick-export'],
      navigate: ['multi-select', 'scene-search', 'scene-find', 'image-review', 'bookmark-jump', 'find-replace'],
      edit: ['change-resolution', 'import-image', 'artist-tag', 'artist-breakdown', 'artist-prefix-toggle'],
      none: ['webp-convert', 'scene-trash', 'empty-image-trash', 'shortcut-help'],
    });
    for (const b of sceneToolbarRegistry.filter((x) => x.group === undefined)) {
      expect(b.tier).toBe('overflow');
    }
  });

  it('프로젝트 바는 그룹을 쓰지 않는다', () => {
    expect(projectToolbarRegistry.filter((b) => b.group)).toEqual([]);
  });
});
