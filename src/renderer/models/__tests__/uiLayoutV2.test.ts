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
    // 명시한 앞 3개는 지정 순서, 나머지 미배치(backup-export, project-trash, new-window)는 tier 폴백 append.
    expect(project.inline).toEqual([
      'piece-editor',
      'add-session',
      'delete-session',
      'backup-export',
      'project-trash',
      'new-window',
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

  it('4. stale id 는 무시된다', () => {
    // (비portable 타영역 id 무시는 B2 가 add-scene→project 로 커버. project 버튼은
    //  전부 portable 로 승격돼 타영역 배정이 유효 렌더가 되므로 여기선 stale 만 검증)
    const ov: UiToolbarConfig = {
      schema: 2,
      areas: {
        [SCENE]: {
          // ghost=stale(레지스트리에 없는 id)
          inline: ['ghost-button', 'add-scene'],
          menu: [],
          hidden: [],
        },
      },
    };
    const view = resolveToolbarView(registries, ov, false);
    const scene = view.find((v) => v.area === SCENE)!;
    expect(scene.inline).not.toContain('ghost-button');
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

describe('resolveToolbarView — 파생 숨김(excludeIds, 이동 의미론)', () => {
  it('제외 집합의 id 는 인라인·⋯메뉴 어디서도 빠진다', () => {
    // project 홈 버튼 character-presets 를 동반 슬롯 배정으로 가정 → 툴바에서 숨김.
    const exclude = new Set(['character-presets', 'export-images']);
    const view = resolveToolbarView(registries, undefined, false, exclude);
    const scene = view.find((v) => v.area === SCENE)!;
    const project = view.find((v) => v.area === PROJECT)!;
    // character-presets 는 project 인라인 기본값이지만 제외됨.
    expect(project.inline).not.toContain('character-presets');
    expect(project.menu).not.toContain('character-presets');
    // export-images 는 scene secondary(PC 인라인)이지만 제외됨.
    expect(scene.inline).not.toContain('export-images');
    expect(scene.menu).not.toContain('export-images');
    // 제외되지 않은 버튼은 그대로.
    expect(project.inline).toContain('add-session');
    expect(scene.inline).toContain('add-scene');
  });

  it('빈 집합/미지정이면 기존 결과와 100% 동일', () => {
    const withEmpty = resolveToolbarView(registries, undefined, false, new Set());
    const withUndef = resolveToolbarView(registries, undefined, false);
    expect(withEmpty).toEqual(withUndef);
  });

  it('classic 에서도 제외 집합이 적용된다(표면에서 사라짐)', () => {
    const ov: UiToolbarConfig = { classic: true };
    const exclude = new Set(['find-replace']);
    const view = resolveToolbarView(registries, ov, false, exclude);
    const scene = view.find((v) => v.area === SCENE)!;
    // classic 은 전부 inline 이지만 제외된 find-replace 는 빠진다.
    expect(scene.inline).not.toContain('find-replace');
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

// ── Phase B: portable 버튼의 크로스 영역 이동/해석 ──────────────────────────
// find-replace(scene 홈, portable), backup-export/piece-editor(project 홈, portable),
// add-scene(scene 홈, 비portable) 을 케이스로 사용.
describe('resolveToolbarView — 크로스 영역(portable)', () => {
  it('B1a. portable id 를 타 영역 areas 에 배정하면 그 영역에 렌더, 홈엔 없음 (양쪽 areas 존재)', () => {
    // find-replace(scene 홈)를 project.inline 에 배정. scene 에도 areas 항목 존재.
    const ov: UiToolbarConfig = {
      schema: 2,
      areas: {
        [SCENE]: { inline: ['add-scene'], menu: [], hidden: [] },
        [PROJECT]: { inline: ['find-replace', 'add-session'], menu: [], hidden: [] },
      },
    };
    const view = resolveToolbarView(registries, ov, false);
    const scene = view.find((v) => v.area === SCENE)!;
    const project = view.find((v) => v.area === PROJECT)!;
    expect(project.inline).toContain('find-replace');
    expect(scene.inline).not.toContain('find-replace');
    expect(scene.menu).not.toContain('find-replace');
    // 중복 없음(전역 단 하나).
    const all = [...scene.inline, ...scene.menu, ...project.inline, ...project.menu];
    expect(all.filter((x) => x === 'find-replace')).toHaveLength(1);
  });

  it('B1b. 부분 areas — scene 에 areas 항목이 없어도 project 로 배정된 find-replace 는 scene 홈 폴백에서 제외', () => {
    // scene areas 미설정(v1 폴백) + project 에만 find-replace 배정.
    const ov: UiToolbarConfig = {
      schema: 2,
      areas: {
        [PROJECT]: { inline: ['find-replace'], menu: [], hidden: [] },
      },
    };
    const view = resolveToolbarView(registries, ov, false);
    const scene = view.find((v) => v.area === SCENE)!;
    const project = view.find((v) => v.area === PROJECT)!;
    expect(project.inline).toContain('find-replace');
    // scene 은 v1 폴백이지만 크로스 배정된 id 는 제거돼야 함(중복 방지 핵심).
    expect(scene.inline).not.toContain('find-replace');
    expect(scene.menu).not.toContain('find-replace');
  });

  it('B2. 비portable id 를 타 영역 배열에 넣어도 무시되고 홈(scene) 폴백으로 렌더', () => {
    // add-scene(scene 홈, 비portable)을 project.inline 에 배정 시도.
    const ov: UiToolbarConfig = {
      schema: 2,
      areas: {
        [PROJECT]: { inline: ['add-scene', 'add-session'], menu: [], hidden: [] },
      },
    };
    const view = resolveToolbarView(registries, ov, false);
    const scene = view.find((v) => v.area === SCENE)!;
    const project = view.find((v) => v.area === PROJECT)!;
    // project 에는 안 나타남(비portable → 배정 안 됨).
    expect(project.inline).not.toContain('add-scene');
    // scene 홈 폴백으로 렌더(primary → inline).
    expect(scene.inline).toContain('add-scene');
  });

  it('B6. classic=true 면 크로스 무시하고 각자 홈에 전부 inline', () => {
    const ov: UiToolbarConfig = {
      classic: true,
      schema: 2,
      areas: {
        [PROJECT]: { inline: ['find-replace'], menu: [], hidden: [] },
      },
    };
    const view = resolveToolbarView(registries, ov, false);
    const scene = view.find((v) => v.area === SCENE)!;
    const project = view.find((v) => v.area === PROJECT)!;
    // classic → 각 영역 레지스트리 전부 inline, 크로스 배정 무시.
    expect(scene.inline).toEqual(sceneToolbarRegistry.map((b) => b.id));
    expect(project.inline).toEqual(projectToolbarRegistry.map((b) => b.id));
    // find-replace 는 scene 홈에 그대로.
    expect(scene.inline).toContain('find-replace');
  });
});

describe('moveToolbarButton — 크로스 영역(portable)', () => {
  it('B3. portable 버튼의 크로스 이동 성공 — areas 갱신·홈에서 사라짐·dual-write·중복 없음', () => {
    // find-replace(scene 홈, portable)를 project.inline 으로 이동.
    const next = moveToolbarButton(registries, undefined, {
      id: 'find-replace',
      toArea: PROJECT,
      slot: 'inline',
      index: 0,
    });
    // project.inline 에 삽입.
    expect(next.areas?.[PROJECT]?.inline?.[0]).toBe('find-replace');
    // scene 의 어느 배열에도 없음.
    const s = next.areas?.[SCENE];
    expect(s?.inline).not.toContain('find-replace');
    expect(s?.menu).not.toContain('find-replace');
    expect(s?.hidden).not.toContain('find-replace');
    // dual-write: inline → 'pinned'.
    expect(next.buttons?.['find-replace']).toBe('pinned');
    // 해석 결과 중복 없음.
    const view = resolveToolbarView(registries, next, false);
    const scene = view.find((v) => v.area === SCENE)!;
    const project = view.find((v) => v.area === PROJECT)!;
    expect(scene.inline).not.toContain('find-replace');
    expect(scene.menu).not.toContain('find-replace');
    expect(project.inline).toContain('find-replace');
    const all = [...scene.inline, ...scene.menu, ...project.inline, ...project.menu];
    expect(all.filter((x) => x === 'find-replace')).toHaveLength(1);
  });

  it('B4. 크로스 배정 상태에서 무관한 버튼 이동 후에도 크로스 배정 보존 + 중복 없음 (회귀)', () => {
    // 1) find-replace 를 project 로 크로스 이동.
    const crossed = moveToolbarButton(registries, undefined, {
      id: 'find-replace',
      toArea: PROJECT,
      slot: 'inline',
      index: 0,
    });
    // 2) 무관한 버튼(scene 내 add-scene)을 scene 내에서 이동.
    const after = moveToolbarButton(registries, crossed, {
      id: 'add-scene',
      toArea: SCENE,
      slot: 'menu',
      index: 0,
    });
    // find-replace 는 여전히 project 에만, scene 엔 없음(중복 재유입 없음).
    expect(after.areas?.[PROJECT]?.inline).toContain('find-replace');
    const s = after.areas?.[SCENE];
    expect(s?.inline).not.toContain('find-replace');
    expect(s?.menu).not.toContain('find-replace');
    expect(s?.hidden).not.toContain('find-replace');
    // 해석 결과에서도 중복 없음.
    const view = resolveToolbarView(registries, after, false);
    const scene = view.find((v) => v.area === SCENE)!;
    const project = view.find((v) => v.area === PROJECT)!;
    const all = [...scene.inline, ...scene.menu, ...project.inline, ...project.menu];
    expect(all.filter((x) => x === 'find-replace')).toHaveLength(1);
    expect(project.inline).toContain('find-replace');
  });

  it('B5. 크로스 배정 후 slot=default 로 초기화하면 홈 영역 tier 폴백으로 복귀', () => {
    const crossed = moveToolbarButton(registries, undefined, {
      id: 'find-replace',
      toArea: PROJECT,
      slot: 'inline',
      index: 0,
    });
    const reset = moveToolbarButton(registries, crossed, {
      id: 'find-replace',
      toArea: SCENE, // 홈으로 초기화
      slot: 'default',
    });
    // buttons 키 삭제.
    expect(reset.buttons?.['find-replace']).toBeUndefined();
    // project·scene 배열 어디에도 명시 배치 없음.
    expect(reset.areas?.[PROJECT]?.inline).not.toContain('find-replace');
    const s = reset.areas?.[SCENE];
    expect(s?.inline).not.toContain('find-replace');
    expect(s?.menu).not.toContain('find-replace');
    // 해석 시 scene 홈 tier 폴백(find-replace 는 secondary → PC inline)으로 복귀.
    const view = resolveToolbarView(registries, reset, false);
    const scene = view.find((v) => v.area === SCENE)!;
    const project = view.find((v) => v.area === PROJECT)!;
    expect(scene.inline).toContain('find-replace');
    expect(project.inline).not.toContain('find-replace');
  });
});
