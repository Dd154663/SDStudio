// resolveToolbarView / moveToolbarButton (config schema v2) 순수 함수 단위 테스트.
// uiLayout.ts 는 config 의 타입만 import(런타임 무거운 의존 없음)라 별도 mock 불필요.

import { UiToolbarConfig } from '../../../main/config';
import {
  sceneToolbarRegistry,
  projectToolbarRegistry,
  resolveToolbar,
  resolveToolbarView,
  moveToolbarButton,
  TOOLBAR_VIEW_MAIN,
  ToolbarRegistryEntry,
} from '../uiLayout';

const SCENE = 'scene';
const PROJECT = 'project';

// TOOLBAR_VIEW_MAIN 을 그대로 쓰되, 영역 이름 계약도 함께 검증.
const registries: ToolbarRegistryEntry[] = TOOLBAR_VIEW_MAIN;

describe('resolveToolbarView — v1 회귀 가드', () => {
  const cases: (UiToolbarConfig | undefined)[] = [
    undefined,
    {},
    { buttons: { 'scene-trash': 'pinned', 'export-images': 'menu' } },
  ];
  for (const ov of cases) {
    for (const isMobile of [false, true]) {
      it(`areas 없음 → resolveToolbar 와 100% 동일 (ov=${JSON.stringify(
        ov,
      )}, mobile=${isMobile})`, () => {
        const view = resolveToolbarView(registries, ov, isMobile);
        expect(view.map((v) => v.area)).toEqual([SCENE, PROJECT]);
        const scene = resolveToolbar(sceneToolbarRegistry, ov, isMobile);
        const project = resolveToolbar(projectToolbarRegistry, ov, isMobile);
        expect(view[0]).toEqual({
          area: SCENE,
          inline: scene.inline,
          menu: scene.menu,
        });
        expect(view[1]).toEqual({
          area: PROJECT,
          inline: project.inline,
          menu: project.menu,
        });
      });
    }
  }
});

describe('resolveToolbarView — areas 순서/폴백/필터', () => {
  it('2. areas.inline 순서가 레지스트리 순서와 달라도 그대로 반영', () => {
    const ov: UiToolbarConfig = {
      schema: 2,
      areas: {
        [PROJECT]: {
          // 레지스트리 순서(add-session, character-presets, ...)와 다르게
          inline: ['piece-editor', 'add-session', 'delete-session'],
          menu: ['character-presets'],
          hidden: [],
        },
      },
    };
    const view = resolveToolbarView(registries, ov, false);
    const project = view.find((v) => v.area === PROJECT)!;
    // 명시한 앞 3개는 지정 순서, 나머지 미배치(backup-export, project-trash)는 tier 폴백 append.
    expect(project.inline).toEqual([
      'piece-editor',
      'add-session',
      'delete-session',
      'backup-export',
      'project-trash',
    ]);
    expect(project.menu).toEqual(['character-presets']);
  });

  it('3. 미배치 신규 id 는 tier 폴백으로 뒤에 편입 + v1 buttons 오버라이드 우선', () => {
    const ov: UiToolbarConfig = {
      schema: 2,
      // add-scene 만 명시. 나머지는 미배치.
      buttons: {
        // secondary 라 PC 기본 inline 이지만 오버라이드로 menu 강제
        'export-images': 'menu',
        // primary 라 기본 inline 이지만 hidden 강제
        'queue-add': 'hidden',
      },
      areas: {
        [SCENE]: { inline: ['scene-search'], menu: [], hidden: [] },
      },
    };
    const view = resolveToolbarView(registries, ov, false);
    const scene = view.find((v) => v.area === SCENE)!;
    // 명시된 scene-search 가 맨 앞.
    expect(scene.inline[0]).toBe('scene-search');
    // export-images 는 buttons=menu 오버라이드로 menu 에.
    expect(scene.menu).toContain('export-images');
    expect(scene.inline).not.toContain('export-images');
    // queue-add 는 buttons=hidden → 양쪽 어디에도 없음.
    expect(scene.inline).not.toContain('queue-add');
    expect(scene.menu).not.toContain('queue-add');
    // add-scene(primary, 미배치)은 tier 폴백으로 inline.
    expect(scene.inline).toContain('add-scene');
  });

  it('4. stale id 와 타 영역 id 는 무시된다', () => {
    const ov: UiToolbarConfig = {
      schema: 2,
      areas: {
        [SCENE]: {
          // ghost=stale, add-session=타영역(project) id
          inline: ['ghost-button', 'add-session', 'add-scene'],
          menu: [],
          hidden: [],
        },
      },
    };
    const view = resolveToolbarView(registries, ov, false);
    const scene = view.find((v) => v.area === SCENE)!;
    expect(scene.inline).not.toContain('ghost-button');
    expect(scene.inline).not.toContain('add-session');
    expect(scene.inline[0]).toBe('add-scene');
  });

  it('5. classic=true 면 areas 무시하고 전부 inline', () => {
    const ov: UiToolbarConfig = {
      classic: true,
      schema: 2,
      areas: {
        [SCENE]: { inline: [], menu: ['add-scene'], hidden: ['queue-add'] },
      },
    };
    const view = resolveToolbarView(registries, ov, false);
    const scene = view.find((v) => v.area === SCENE)!;
    expect(scene.inline).toEqual(sceneToolbarRegistry.map((b) => b.id));
    expect(scene.menu).toEqual([]);
  });

  it('6. 모바일에서 pcOnly 제외 · hidden 제외', () => {
    const ov: UiToolbarConfig = {
      schema: 2,
      areas: {
        [SCENE]: {
          // webp-convert 는 pcOnly. scene-search 는 hidden.
          inline: ['webp-convert', 'add-scene'],
          menu: [],
          hidden: ['scene-search'],
        },
      },
    };
    const view = resolveToolbarView(registries, ov, true);
    const scene = view.find((v) => v.area === SCENE)!;
    expect(scene.inline).not.toContain('webp-convert'); // pcOnly
    expect(scene.inline).not.toContain('scene-search'); // hidden
    expect(scene.menu).not.toContain('scene-search');
    expect(scene.inline).toContain('add-scene');
  });
});

describe('moveToolbarButton', () => {
  it('7. 같은 영역 내 index 이동 반영 + dual-write buttons 갱신 + 원본 불변', () => {
    const ov: UiToolbarConfig = { classic: false };
    const frozen = JSON.stringify(ov);
    const next = moveToolbarButton(registries, ov, {
      id: 'scene-search',
      toArea: SCENE,
      slot: 'inline',
      index: 0,
    });
    // 원본 불변(mutate 없음).
    expect(JSON.stringify(ov)).toBe(frozen);
    expect(next).not.toBe(ov);
    // schema 승격 + classic 보존.
    expect(next.schema).toBe(2);
    expect(next.classic).toBe(false);
    // dual-write: inline → 'pinned'.
    expect(next.buttons?.['scene-search']).toBe('pinned');
    // areas.scene.inline 맨 앞에 위치.
    expect(next.areas?.[SCENE]?.inline?.[0]).toBe('scene-search');
    // 해석 결과에서도 맨 앞.
    const view = resolveToolbarView(registries, next, false);
    expect(view.find((v) => v.area === SCENE)!.inline[0]).toBe('scene-search');
  });

  it('index 미지정/범위 밖은 맨 뒤 삽입', () => {
    const next = moveToolbarButton(registries, undefined, {
      id: 'add-scene',
      toArea: SCENE,
      slot: 'menu',
      // index 미지정
    });
    const menu = next.areas?.[SCENE]?.menu ?? [];
    expect(menu[menu.length - 1]).toBe('add-scene');
  });

  it('8. 타 영역 이동은 거부 — 원본 그대로 반환 (portable 없음)', () => {
    const ov: UiToolbarConfig = { schema: 2, areas: {} };
    const next = moveToolbarButton(registries, ov, {
      id: 'add-scene', // scene 홈
      toArea: PROJECT, // 다른 영역
      slot: 'inline',
    });
    expect(next).toBe(ov); // 동일 참조 반환(변경 거부)
  });

  it('레지스트리에 없는 id 이동도 거부 — 원본 그대로 반환', () => {
    const ov: UiToolbarConfig = { schema: 2 };
    const next = moveToolbarButton(registries, ov, {
      id: 'ghost-button',
      toArea: SCENE,
      slot: 'inline',
    });
    expect(next).toBe(ov);
  });

  it('anchor 삽입: 같은 배열 내 우측 이동도 앵커 앞/뒤 정확히 (오프바이원 없음)', () => {
    // 기본 상태에서 add-scene(맨 앞)을 batch-process 앞으로 — 우측 이동.
    // 숫자 인덱스라면 제거 오프셋으로 한 칸 밀리는 케이스.
    const before = moveToolbarButton(registries, undefined, {
      id: 'add-scene',
      toArea: SCENE,
      slot: 'inline',
      anchor: { id: 'batch-process', side: 'before' },
    });
    const inline1 = before.areas?.[SCENE]?.inline ?? [];
    expect(inline1.indexOf('add-scene')).toBe(
      inline1.indexOf('batch-process') - 1,
    );

    // side='after' 는 앵커 바로 뒤.
    const after = moveToolbarButton(registries, undefined, {
      id: 'add-scene',
      toArea: SCENE,
      slot: 'inline',
      anchor: { id: 'batch-process', side: 'after' },
    });
    const inline2 = after.areas?.[SCENE]?.inline ?? [];
    expect(inline2.indexOf('add-scene')).toBe(
      inline2.indexOf('batch-process') + 1,
    );
  });

  it('anchor 가 대상 배열에 없으면 맨 뒤 폴백', () => {
    // scene-search 는 inline 에 있는데 anchor 를 menu 의 버튼으로 지정 → inline 맨 뒤.
    const next = moveToolbarButton(registries, undefined, {
      id: 'add-scene',
      toArea: SCENE,
      slot: 'inline',
      anchor: { id: 'webp-convert', side: 'before' }, // overflow → menu 에 있음
    });
    const inline = next.areas?.[SCENE]?.inline ?? [];
    expect(inline[inline.length - 1]).toBe('add-scene');
  });

  it('9. slot=default 는 areas 에서 제거 + buttons 키 삭제 → tier 폴백 복귀', () => {
    // 먼저 pinned 상태를 만든 뒤 default 로 되돌린다.
    const pinned = moveToolbarButton(registries, undefined, {
      id: 'scene-search',
      toArea: SCENE,
      slot: 'menu',
      index: 0,
    });
    expect(pinned.buttons?.['scene-search']).toBe('menu');

    const reset = moveToolbarButton(registries, pinned, {
      id: 'scene-search',
      toArea: SCENE,
      slot: 'default',
    });
    // buttons 키 삭제.
    expect(reset.buttons?.['scene-search']).toBeUndefined();
    // areas 의 어느 배열에도 없음.
    const a = reset.areas?.[SCENE];
    expect(a?.inline).not.toContain('scene-search');
    expect(a?.menu).not.toContain('scene-search');
    expect(a?.hidden).not.toContain('scene-search');
    // 해석 시 tier 폴백(scene-search 는 primary → inline)으로 복귀.
    const view = resolveToolbarView(registries, reset, false);
    expect(view.find((v) => v.area === SCENE)!.inline).toContain('scene-search');
  });
});
