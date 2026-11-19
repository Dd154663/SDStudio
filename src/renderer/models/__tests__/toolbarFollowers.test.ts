// 프로젝트 백업 메뉴 분할(2026-11-19 사용자 결정) — 「불러오기」(backup-import)·「내보내기」(backup-export) 두 버튼.
// ① 레지스트리: 새 id 가 backup-export 바로 앞·같은 속성 ② 따라가는 버튼(TOOLBAR_FOLLOWERS): 저장된 배치에 새 id 가 없으면
// backup-export 가 있는 곳(같은 영역·inline/menu/hidden·v1 buttons) 바로 앞에 — 저장 파일은 그대로 ③ 동반 슬롯·퀵 메뉴도 같은 규칙.
const mockAppState: any = {
  projectImportMenu: jest.fn(),
  projectExportMenu: jest.fn(),
};
jest.mock('../AppService', () => ({ appState: mockAppState }));
jest.mock('../undoService', () => ({
  undoService: { canUndo: false, canRedo: false },
  UNDO_TEXT: { undoName: '되돌리기', redoName: '다시 실행' },
}));

import type { UiToolbarConfig } from '../../../main/config';
import {
  applyToolbarFollowers,
  moveToolbarButton,
  projectToolbarRegistry,
  resolveToolbar,
  resolveToolbarView,
  TOOLBAR_FOLLOWERS,
  TOOLBAR_VIEW_MAIN,
} from '../uiLayout';
import {
  assignCompanion,
  companionAssignedIds,
  companionOwnerOf,
  COMPANION_KEPT_IN_TOOLBAR_KEY,
  MODERN_COMPANION_DEFAULTS,
  removeCompanion,
  resolveCompanionButtons,
} from '../companionSlots';
import {
  addToQuickMenu,
  DEFAULT_QUICK_MENU,
  expandQuickMenu,
  globalActionById,
  quickMenuRemovedMarker,
  removeFromQuickMenu,
  resolveQuickMenu,
} from '../globalActions';

const project = (ov: UiToolbarConfig | undefined, mobile = false) =>
  resolveToolbarView(TOOLBAR_VIEW_MAIN, ov, mobile).find((a) => a.area === 'project')!;
const scene = (ov: UiToolbarConfig | undefined) =>
  resolveToolbarView(TOOLBAR_VIEW_MAIN, ov, false).find((a) => a.area === 'scene')!;

describe('레지스트리', () => {
  test('backup-import 는 backup-export 바로 앞, 같은 tier·portable, 이름·라벨', () => {
    const ids = projectToolbarRegistry.map((b) => b.id);
    expect(ids.indexOf('backup-import')).toBe(ids.indexOf('backup-export') - 1);
    const imp = projectToolbarRegistry.find((b) => b.id === 'backup-import')!;
    const exp = projectToolbarRegistry.find((b) => b.id === 'backup-export')!;
    expect(imp).toMatchObject({ name: '프로젝트 불러오기', label: '불러오기' });
    expect(exp).toMatchObject({ name: '프로젝트 내보내기', label: '내보내기' });
    expect({ tier: imp.tier, portable: imp.portable, pcOnly: imp.pcOnly }).toEqual({
      tier: exp.tier,
      portable: exp.portable,
      pcOnly: exp.pcOnly,
    });
    expect(TOOLBAR_FOLLOWERS).toEqual([{ id: 'backup-import', leader: 'backup-export' }]);
  });

  test('기본 배치(설정 없음): 둘 다 프로젝트 바 인라인, 불러오기 → 내보내기 순', () => {
    const inline = project(undefined).inline;
    expect(inline.indexOf('backup-import')).toBe(inline.indexOf('backup-export') - 1);
    expect(project(undefined, true).inline).toEqual(expect.arrayContaining(['backup-import', 'backup-export']));
  });
});

describe('저장된 배치에서 따라가기', () => {
  test('v1 buttons: 내보내기를 ⋯ 메뉴·숨김으로 보냈으면 불러오기도 같은 상태(바로 앞)', () => {
    const menu = project({ buttons: { 'backup-export': 'menu' } });
    expect(menu.inline).not.toContain('backup-import');
    expect(menu.menu.slice(menu.menu.indexOf('backup-import'), menu.menu.indexOf('backup-import') + 2)).toEqual([
      'backup-import',
      'backup-export',
    ]);
    const hidden = project({ buttons: { 'backup-export': 'hidden' } });
    expect([...hidden.inline, ...hidden.menu]).not.toContain('backup-import');
    // resolveToolbar(v1 단일 영역)도 같은 규칙
    const v1 = resolveToolbar(projectToolbarRegistry, { buttons: { 'backup-export': 'menu' } }, false);
    expect(v1.menu).toEqual(['backup-import', 'backup-export']);
  });

  test('v2 areas: 사용자 순서 안에서 내보내기 바로 앞에 끼운다(영역 끝으로 밀리지 않음)', () => {
    const ov: UiToolbarConfig = {
      schema: 2,
      areas: {
        project: {
          inline: ['piece-editor', 'backup-export', 'add-session'],
          menu: ['character-presets'],
          hidden: [],
        },
      },
    };
    expect(project(ov).inline.slice(0, 4)).toEqual([
      'piece-editor',
      'backup-import',
      'backup-export',
      'add-session',
    ]);
    // 저장 객체는 그대로
    expect(ov.areas!.project.inline).toEqual(['piece-editor', 'backup-export', 'add-session']);
  });

  test('v2 areas: 내보내기가 ⋯ 메뉴·숨김·다른 영역이면 불러오기도 따라간다', () => {
    const inMenu = project({ schema: 2, areas: { project: { inline: [], menu: ['backup-export'], hidden: [] } } });
    expect(inMenu.menu.slice(0, 2)).toEqual(['backup-import', 'backup-export']);
    expect(inMenu.inline).not.toContain('backup-import');

    const hidden = project({ schema: 2, areas: { project: { inline: [], menu: [], hidden: ['backup-export'] } } });
    expect([...hidden.inline, ...hidden.menu]).not.toContain('backup-import');
    expect([...hidden.inline, ...hidden.menu]).not.toContain('backup-export');

    const cross: UiToolbarConfig = {
      schema: 2,
      areas: { scene: { inline: ['add-scene', 'backup-export'], menu: [], hidden: [] } },
    };
    expect(scene(cross).inline).toEqual(expect.arrayContaining(['backup-import', 'backup-export']));
    const s = scene(cross).inline;
    expect(s.indexOf('backup-import')).toBe(s.indexOf('backup-export') - 1);
    expect(project(cross).inline).not.toContain('backup-import');
    expect(project(cross).inline).not.toContain('backup-export');
  });

  test('불러오기가 저장에 이미 있으면(배열이든 buttons 든) 저장된 자리가 우선', () => {
    const ov: UiToolbarConfig = {
      schema: 2,
      areas: { project: { inline: ['backup-export'], menu: [], hidden: ['backup-import'] } },
    };
    expect(project(ov).inline).toContain('backup-export');
    expect([...project(ov).inline, ...project(ov).menu]).not.toContain('backup-import');
    const v1 = project({ buttons: { 'backup-export': 'menu', 'backup-import': 'pinned' } });
    expect(v1.inline).toContain('backup-import');
    expect(v1.menu).toContain('backup-export');
  });

  test('classic 은 대상 아님(전부 인라인), 설정 없음·적용할 것 없음이면 입력 그대로', () => {
    const classic = { classic: true, buttons: { 'backup-export': 'menu' as const } };
    expect(applyToolbarFollowers(classic)).toBe(classic);
    expect(applyToolbarFollowers(undefined)).toBeUndefined();
    const explicit: UiToolbarConfig = { buttons: { 'backup-import': 'menu' } };
    expect(applyToolbarFollowers(explicit)).toBe(explicit);
  });

  test('다른 버튼을 옮기면 불러오기가 보이던 자리 그대로 저장에 적히고, 그 뒤로는 따로 움직인다', () => {
    const ov: UiToolbarConfig = {
      schema: 2,
      areas: { project: { inline: ['backup-export', 'add-session'], menu: [], hidden: [] } },
    };
    const moved = moveToolbarButton(TOOLBAR_VIEW_MAIN, ov, { id: 'add-session', toArea: 'project', slot: 'menu' });
    expect(moved.areas!.project.inline!.slice(0, 2)).toEqual(['backup-import', 'backup-export']);
    // 불러오기만 숨기면 내보내기는 그대로
    const hid = moveToolbarButton(TOOLBAR_VIEW_MAIN, moved, { id: 'backup-import', toArea: 'project', slot: 'hidden' });
    expect(project(hid).inline).toContain('backup-export');
    expect([...project(hid).inline, ...project(hid).menu]).not.toContain('backup-import');
    // 「기본」으로 되돌리면 다시 내보내기를 따라간다
    const back = moveToolbarButton(TOOLBAR_VIEW_MAIN, hid, { id: 'backup-import', toArea: 'project', slot: 'default' });
    const inline = project(back).inline;
    expect(inline.indexOf('backup-import')).toBe(inline.indexOf('backup-export') - 1);
  });
});

describe('동반 슬롯 따라가기', () => {
  test('저장된 슬롯에 내보내기만 있으면 불러오기도 같은 호스트 바로 앞(툴바 표면에서 함께 빠짐)', () => {
    const slots = { 'preset-top': ['project-trash', 'backup-export'] };
    expect(resolveCompanionButtons('preset-top', slots)).toEqual(['project-trash', 'backup-import', 'backup-export']);
    expect(companionAssignedIds(slots).has('backup-import')).toBe(true);
    expect(companionOwnerOf('backup-import', slots)).toBe('preset-top');
    expect(slots).toEqual({ 'preset-top': ['project-trash', 'backup-export'] }); // 저장 불변
  });

  test('불러오기만 빼면 표식을 남겨 다시 따라가지 않고, 다시 배정하면 표식이 지워진다', () => {
    const slots = { 'preset-top': ['backup-export'] };
    const removed = removeCompanion(slots, 'backup-import');
    expect(removed).toEqual({ 'preset-top': ['backup-export'], [COMPANION_KEPT_IN_TOOLBAR_KEY]: ['backup-import'] });
    expect(resolveCompanionButtons('preset-top', removed)).toEqual(['backup-export']);
    expect(companionAssignedIds(removed).has('backup-import')).toBe(false);
    const again = assignCompanion(removed, 'vibes', 'backup-import');
    expect(again).toEqual({ 'preset-top': ['backup-export'], vibes: ['backup-import'] });
  });

  test('내보내기를 슬롯에서 빼면 불러오기는 보이던 자리에 남는다(편집 뒤 저장에 명시)', () => {
    const after = removeCompanion({ 'preset-top': ['backup-export'] }, 'backup-export');
    expect(after).toEqual({ 'preset-top': ['backup-import'] });
    // 내보내기가 슬롯에 없을 때 불러오기를 빼면 표식이 필요 없다
    expect(removeCompanion({ 'preset-top': ['backup-import'] }, 'backup-import')).toEqual({});
  });

  test('모던 기본 배치는 둘 다 사전세팅선택 위 행', () => {
    expect(MODERN_COMPANION_DEFAULTS['preset-top'].slice(0, 2)).toEqual(['backup-import', 'backup-export']);
  });
});

describe('퀵 메뉴', () => {
  test('두 액션이 각 메뉴를 연다', () => {
    globalActionById('backup-import')!.run();
    expect(mockAppState.projectImportMenu).toHaveBeenCalledTimes(1);
    globalActionById('backup-export')!.run();
    expect(mockAppState.projectExportMenu).toHaveBeenCalledTimes(1);
  });

  test('추천 기본에 불러오기·내보내기가 나란히', () => {
    const i = DEFAULT_QUICK_MENU.indexOf('backup-import');
    expect(DEFAULT_QUICK_MENU[i + 1]).toBe('backup-export');
  });

  test('저장된 구성에 내보내기만 있으면 바로 앞에 불러오기가 따라온다(저장 불변)', () => {
    const saved = ['piece-editor', 'backup-export'];
    expect(resolveQuickMenu(saved, false).map((a) => a.id)).toEqual(['piece-editor', 'backup-import', 'backup-export']);
    expect(saved).toEqual(['piece-editor', 'backup-export']);
    expect(resolveQuickMenu(['piece-editor'], false).map((a) => a.id)).toEqual(['piece-editor']);
  });

  test('편집기에서 불러오기만 빼면 표식이 남아 다시 따라오지 않고, 더하면 표식이 지워진다', () => {
    const list = expandQuickMenu(['backup-export']);
    expect(list).toEqual(['backup-import', 'backup-export']);
    const removed = removeFromQuickMenu(list, 'backup-import');
    expect(removed).toEqual(['backup-export', quickMenuRemovedMarker('backup-import')]);
    expect(resolveQuickMenu(removed, false).map((a) => a.id)).toEqual(['backup-export']);
    const added = addToQuickMenu(expandQuickMenu(removed), 'backup-import');
    expect(added).toEqual(['backup-export', 'backup-import']);
    // 짝이 없을 때 빼면 표식 없음
    expect(removeFromQuickMenu(['backup-import'], 'backup-import')).toEqual([]);
  });
});
