// 일괄 삽입 독립 창(2026-11-14 A-3 사용자 결정 4건) — BatchInsertDialog(l·aside 공용 씬 선택·기본 빈 선택·씬 종류 칩)와
// models/batchInsert(이미지생성 씬 slots · 조합 변형 slots · 단일 프롬프트 변형 preset.prompt · [적용] 1회 = 되돌리기 1항목),
// 툴바 버튼 batch-insert(찾기·변환 옆, 생성/변형 두 탭이 같은 씬 툴바 영역 — TOOLBAR_VIEW_MAIN 'scene').
// 세션·씬은 실제 types 객체, 되돌리기는 실제 undoService(테스트용 deps 로 configure).
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';

const mockEnv = { mobile: false };

jest.mock('@capacitor/app', () => ({
  App: { addListener: jest.fn(), minimizeApp: jest.fn() },
}));
jest.mock('../index', () => ({
  get isMobile() {
    return mockEnv.mobile;
  },
  backend: { searchTags: jest.fn(async () => []) },
  workFlowService: {},
}));
const mockAppState: any = {
  curSession: null,
  batchInsertOpen: true,
  closeBatchInsert: jest.fn(),
  openBatchInsert: jest.fn(),
  openFindReplace: jest.fn(),
  appliedCharacterPresetNames: [] as string[],
  pushMessage: jest.fn(),
  pushDialog: jest.fn(),
  incrementModalOverlay: jest.fn(),
  decrementModalOverlay: jest.fn(),
};
jest.mock('../AppService', () => ({ appState: mockAppState }));
jest.mock('../../componenets/ActionIcon', () => ({ ActionIcon: () => null }));
jest.mock('../../componenets/CompanionDnd', () => ({
  CompanionButtonSlot: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { InpaintScene, PromptPiece, Scene, Session } from '../types';
import { undoService, UNDO_TEXT } from '../undoService';
import {
  applyBatchInsertRecorded,
  batchInsertSummary,
  countBatchInsert,
  insertTargetKind,
} from '../batchInsert';
import { TOOLBAR_VIEW_MAIN, resolveToolbarView, sceneToolbarRegistry } from '../uiLayout';
import { globalActionById, globalActionMeta } from '../globalActions';
import { iconOf } from '../iconDictionary';
import BatchInsertDialog from '../../componenets/BatchInsertDialog';
import { portableToolbarButtons } from '../../componenets/PortableToolbarButtons';

const piece = (prompt: string, id: string) => PromptPiece.fromJSON({ prompt, characterPrompts: [], enabled: true, id });

interface World {
  session: Session;
  a: Scene;
  b: Scene;
  combo: InpaintScene;
  single: InpaintScene;
  edit: InpaintScene;
}

/** 이미지생성 씬 2(가: 열 2개, 나: 열 1개) + 조합 모드 I2I 변형 + 단일 인페인트 변형 + 프롬프트 칸 없는 변형(대상 아님) */
function makeWorld(): World {
  const session = new Session();
  session.name = 'P';
  const a = new Scene();
  a.name = '가';
  a.slots = [[piece('cat', 'a1'), piece('dog', 'a2')], [piece('red', 'a3')]];
  a.imageMap = ['old.png'];
  session.addScene(a);
  const b = new Scene();
  b.name = '나';
  b.slots = [[piece('', 'b1')]];
  session.addScene(b);
  const combo = new InpaintScene();
  combo.name = '조합';
  combo.workflowType = 'SDI2I';
  combo.comboMode = 'shared';
  combo.preset = { prompt: 'mid' } as any;
  combo.slots = [[piece('mid', 'c1')], [piece('blue', 'c2')]];
  session.addScene(combo);
  const single = new InpaintScene();
  single.name = '단일';
  single.workflowType = 'SDInpaint';
  single.preset = { prompt: 'hand' } as any;
  single.slots = [];
  session.addScene(single);
  const edit = new InpaintScene();
  edit.name = '수정';
  edit.workflowType = 'SDImageEdit';
  edit.preset = {} as any;
  edit.slots = [];
  session.addScene(edit);
  return { session, a, b, combo, single, edit };
}

const prompts = (s: Scene | InpaintScene) => s.slots.map((slot) => slot.map((p) => p.prompt));

beforeAll(() => {
  (global as any).IS_REACT_ACT_ENVIRONMENT = true;
  undoService.configure({
    curSession: () => undefined,
    isMirror: () => false,
    toast: jest.fn(),
    now: () => 1000,
    confirm: async () => true,
  });
});

// ═══════════════════════════════════════════════════════════════════
// 모델 — 대상 종류·삽입 규칙·되돌리기
// ═══════════════════════════════════════════════════════════════════
describe('batchInsert — 대상 종류와 삽입 규칙', () => {
  test('대상 종류: 이미지생성 = scene, 조합 모드 변형 = comboVariant, 단일 I2I·인페인트 = singleVariant, 그 밖 = 대상 아님', () => {
    const w = makeWorld();
    expect(insertTargetKind(w.a)).toBe('scene');
    expect(insertTargetKind(w.combo)).toBe('comboVariant');
    expect(insertTargetKind(w.single)).toBe('singleVariant');
    expect(insertTargetKind(w.edit)).toBeUndefined();
  });

  test('이미지생성 씬 — 모든 슬롯 뒤/앞(빈 조각은 구분자 없이), 열 n만, 새 열(종전 동작)', () => {
    let w = makeWorld();
    applyBatchInsertRecorded(undefined, [w.a, w.b], { text: ' x ', position: 'append', slotTarget: 'all' });
    expect(prompts(w.a)).toEqual([['cat, x', 'dog, x'], ['red, x']]);
    expect(prompts(w.b)).toEqual([['x']]);
    w = makeWorld();
    applyBatchInsertRecorded(undefined, [w.a], { text: 'x', position: 'prepend', slotTarget: 1 });
    expect(prompts(w.a)).toEqual([['cat', 'dog'], ['x, red']]);
    w = makeWorld();
    const out = applyBatchInsertRecorded(undefined, [w.a, w.b], { text: 'x', position: 'append', slotTarget: 'new-column' });
    expect(prompts(w.a)).toEqual([['cat', 'dog'], ['red'], ['x']]);
    expect(prompts(w.b)).toEqual([[''], ['x']]);
    expect(out.newColumns).toBe(2);
  });

  test('조합 모드 변형 — 이미지생성 씬과 같은 slots 처리, 첫 조각과 같은 preset.prompt(중간 프롬프트)는 함께 맞춘다', () => {
    let w = makeWorld();
    applyBatchInsertRecorded(undefined, [w.combo], { text: 'x', position: 'append', slotTarget: 'all' });
    expect(prompts(w.combo)).toEqual([['mid, x'], ['blue, x']]);
    expect(w.combo.preset.prompt).toBe('mid, x');
    w = makeWorld();
    applyBatchInsertRecorded(undefined, [w.combo], { text: 'x', position: 'append', slotTarget: 1 });
    expect(prompts(w.combo)).toEqual([['mid'], ['blue, x']]);
    expect(w.combo.preset.prompt).toBe('mid');
    w = makeWorld();
    applyBatchInsertRecorded(undefined, [w.combo], { text: 'x', position: 'append', slotTarget: 'new-column' });
    expect(prompts(w.combo)).toEqual([['mid'], ['blue'], ['x']]);
  });

  test('조합 모드 변형의 빈 slots = preset.prompt 열 하나(모든 슬롯·열 1 → preset.prompt, 새 열 → 그 열을 조각으로 만든 뒤 추가)', () => {
    let w = makeWorld();
    w.combo.slots = [];
    applyBatchInsertRecorded(undefined, [w.combo], { text: 'x', position: 'prepend', slotTarget: 0 });
    expect(w.combo.preset.prompt).toBe('x, mid');
    expect(w.combo.slots).toEqual([]);
    w = makeWorld();
    w.combo.slots = [];
    applyBatchInsertRecorded(undefined, [w.combo], { text: 'x', position: 'append', slotTarget: 'new-column' });
    expect(prompts(w.combo)).toEqual([['mid'], ['x']]);
  });

  test('단일 프롬프트 변형 — preset.prompt 앞/뒤, 열 지정·새 열이어도 프롬프트에 삽입(섞인 선택)', () => {
    let w = makeWorld();
    applyBatchInsertRecorded(undefined, [w.single], { text: 'x', position: 'append', slotTarget: 'all' });
    expect(w.single.preset.prompt).toBe('hand, x');
    expect(w.single.slots).toEqual([]);
    w = makeWorld();
    const out = applyBatchInsertRecorded(undefined, [w.a, w.single], { text: 'x', position: 'prepend', slotTarget: 'new-column' });
    expect(prompts(w.a)).toEqual([['cat', 'dog'], ['red'], ['x']]);
    expect(w.single.preset.prompt).toBe('x, hand');
    expect(out).toMatchObject({ newColumns: 1, singlePrompt: 1 });
    expect(batchInsertSummary(out, 'new-column', 'prepend', 'done')).toBe(
      '1개 씬에 새 열이 추가되었습니다 · 단일 프롬프트 변형 1개는 프롬프트 앞에 삽입했습니다',
    );
  });

  test('단일 프롬프트 변형만 고르면 열 지정은 「모든 슬롯」으로 본다 · 대상 아닌 변형은 건드리지 않는다', () => {
    const w = makeWorld();
    const c = countBatchInsert([w.single, w.edit], { text: 'x', position: 'append', slotTarget: 'new-column' });
    expect(c).toEqual({ slots: 0, newColumns: 0, singlePrompt: 1 });
    expect(batchInsertSummary(c, 'all', 'append', 'preview')).toBe('단일 프롬프트 변형 1개는 프롬프트 뒤에 삽입');
    applyBatchInsertRecorded(undefined, [w.single, w.edit], { text: 'x', position: 'append', slotTarget: 'new-column' });
    expect(w.single.preset.prompt).toBe('hand, x');
    expect(w.edit.preset).toEqual({});
  });

  test('되돌리기: 한 번의 적용(생성 + 조합 변형 + 단일 변형) = 1항목, 되돌림·다시 실행이 모두를 함께, 이미지 필드 불변', async () => {
    const w = makeWorld();
    const out = applyBatchInsertRecorded(w.session, [w.a, w.combo, w.single], {
      text: 'x',
      position: 'append',
      slotTarget: 'all',
    });
    expect(out.recorded).toBe(true);
    const past = undoService.entries(w.session).past;
    expect(past).toHaveLength(1);
    expect(past[0].label).toBe(UNDO_TEXT.comboBatchInsert(3));
    expect(await undoService.undo(w.session)).toBe(true);
    expect(prompts(w.a)).toEqual([['cat', 'dog'], ['red']]);
    expect(prompts(w.combo)).toEqual([['mid'], ['blue']]);
    expect(w.combo.preset.prompt).toBe('mid');
    expect(w.single.preset.prompt).toBe('hand');
    expect(w.a.imageMap).toEqual(['old.png']);
    expect(await undoService.redo(w.session)).toBe(true);
    expect(prompts(w.a)).toEqual([['cat, x', 'dog, x'], ['red, x']]);
    expect(w.single.preset.prompt).toBe('hand, x');
  });

  test('되돌리기: 바뀐 씬만 하위 항목 — 열 2만이면 열 2가 없는 씬(나)·단일 변형만 센다', () => {
    const w = makeWorld();
    applyBatchInsertRecorded(w.session, [w.a, w.b, w.single], { text: 'x', position: 'append', slotTarget: 1 });
    expect(undoService.entries(w.session).past.map((e) => e.label)).toEqual([UNDO_TEXT.comboBatchInsert(2)]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 창 — BatchInsertDialog
// ═══════════════════════════════════════════════════════════════════
let root: Root;
let container: HTMLDivElement;
let world: World;
beforeEach(() => {
  jest.clearAllMocks();
  mockEnv.mobile = false;
  world = makeWorld();
  mockAppState.curSession = world.session;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  mockAppState.curSession = null;
});

const frame = () => container.querySelector<HTMLElement>('[data-modal-size]');
const slot = (name: string) => container.querySelector<HTMLElement>(`[data-modal-slot="${name}"]`);
const buttonsIn = (el: Element | null) =>
  Array.from(el?.querySelectorAll('button') ?? []).map((b) => (b.textContent ?? '').trim());
const rowLabels = () =>
  Array.from(container.querySelectorAll('[data-find-scene-list] label')).map((l) => l.textContent?.trim());
const sceneCheckbox = (label: string) => {
  const row = Array.from(container.querySelectorAll('[data-find-scene-list] label')).find(
    (l) => l.textContent?.trim() === label,
  );
  return row?.querySelector('input') as HTMLInputElement;
};
const chip = (k: string) => container.querySelector<HTMLElement>(`[data-scene-kind-chip="${k}"]`)!;
const applyButton = () => Array.from(slot('footer')!.querySelectorAll('button'))[0] as HTMLButtonElement;
const status = () => container.querySelector('[data-batch-insert-status]')?.textContent ?? '';
const typeInto = async (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const textInput = () => slot('body')!.querySelector<HTMLInputElement>('input[placeholder^="태그 입력"]')!;
const targetSelect = () => container.querySelector<HTMLSelectElement>('[data-batch-insert-target]')!;
const chooseTarget = async (value: string) => {
  const sel = targetSelect();
  await act(async () => {
    sel.value = value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

describe('일괄 삽입 창 — l·aside·기본 빈 선택·[적용]', () => {
  test('등급 l, 제목 「일괄 삽입」, aside = 공용 씬 선택(대상 아닌 변형은 목록에 없음), 바닥줄 [적용][닫기]', async () => {
    await act(async () => root.render(<BatchInsertDialog />));
    expect(frame()?.getAttribute('data-modal-size')).toBe('l');
    expect(container.textContent).toContain('일괄 삽입');
    const aside = slot('aside')!;
    expect(slot('columns')!.contains(aside)).toBe(true);
    expect(aside.querySelector('[data-find-scene-select]')).not.toBeNull();
    expect(rowLabels()).toEqual(['가', '나', '[변형] 조합', '[변형] 단일']);
    expect(buttonsIn(slot('footer'))).toEqual(['적용', '닫기']);
    expect(applyButton().className).toContain('btn-solid-sky');
  });

  test('기본 빈 선택 — 선택 0 / 전체 4, [적용] 비활성, 바닥 왼쪽 「씬을 선택하세요」 → 선택 + 텍스트 후 활성', async () => {
    await act(async () => root.render(<BatchInsertDialog />));
    expect(container.querySelector('[data-find-scene-count]')!.textContent).toBe('선택 0 / 전체 4');
    expect(applyButton().disabled).toBe(true);
    expect(status()).toBe('씬을 선택하세요');
    await typeInto(textInput(), 'x');
    expect(applyButton().disabled).toBe(true);
    await act(async () => sceneCheckbox('가').click());
    expect(applyButton().disabled).toBe(false);
    // 기본 대상 = 열 1만(종전 기본값)
    expect(status()).toBe('2개 슬롯에 적용 예정');
  });

  test('씬 종류 칩 — 「생성 2」「변형 2」, 변형을 끄면 목록에서 빠지고 전체 선택은 보이는 씬만, 둘 다 끄면 안내', async () => {
    await act(async () => root.render(<BatchInsertDialog />));
    expect(chip('scene').textContent).toBe('생성 2');
    expect(chip('variant').textContent).toBe('변형 2');
    await act(async () => chip('variant').querySelector('input')!.click());
    expect(rowLabels()).toEqual(['가', '나']);
    const toggleAll = Array.from(slot('aside')!.querySelectorAll('button')).find((b) =>
      b.textContent?.startsWith('전체 선택'),
    )!;
    await act(async () => toggleAll.click());
    expect(container.querySelector('[data-find-scene-count]')!.textContent).toBe('선택 2 / 전체 4');
    await act(async () => chip('variant').querySelector('input')!.click());
    expect(sceneCheckbox('[변형] 조합').checked).toBe(false);
    await act(async () => chip('variant').querySelector('input')!.click());
    await act(async () => chip('scene').querySelector('input')!.click());
    expect(rowLabels()).toEqual([]);
    expect(container.querySelector('[data-scene-kind-empty]')).not.toBeNull();
    expect(container.querySelector('[data-find-scene-count]')!.textContent).toBe('선택 0 / 전체 4');
  });

  test('단일 프롬프트 변형만 선택 → 「열 n만」「새 열」 비활성 + 안내, 대상 표시는 「모든 슬롯」', async () => {
    await act(async () => root.render(<BatchInsertDialog />));
    await act(async () => sceneCheckbox('[변형] 단일').click());
    const options = Array.from(targetSelect().options);
    expect(options.filter((o) => o.disabled).map((o) => o.textContent)).toEqual(['열 1만', '열 2만', '새 열로 추가']);
    expect(targetSelect().value).toBe('all');
    expect(container.querySelector('[data-batch-insert-single-note]')).not.toBeNull();
    await act(async () => sceneCheckbox('가').click());
    expect(Array.from(targetSelect().options).some((o) => o.disabled)).toBe(false);
    expect(targetSelect().value).toBe('0');
  });

  test('[적용] — 생성 + 조합 변형 + 단일 변형을 한 번에, 완료 문구 구분, 되돌리기 1항목으로 모두 되돌림', async () => {
    await act(async () => root.render(<BatchInsertDialog />));
    for (const n of ['가', '[변형] 조합', '[변형] 단일']) await act(async () => sceneCheckbox(n).click());
    await typeInto(textInput(), 'x');
    await chooseTarget('all');
    expect(status()).toBe('5개 슬롯에 적용 예정 · 단일 프롬프트 변형 1개는 프롬프트 뒤에 삽입');
    const before = undoService.entries(world.session).past.length;
    await act(async () => applyButton().click());
    expect(prompts(world.a)).toEqual([['cat, x', 'dog, x'], ['red, x']]);
    expect(prompts(world.combo)).toEqual([['mid, x'], ['blue, x']]);
    expect(world.single.preset.prompt).toBe('hand, x');
    expect(prompts(world.b)).toEqual([['']]);
    expect(status()).toBe('✓ 5개 슬롯에 텍스트가 삽입되었습니다 · 단일 프롬프트 변형 1개는 프롬프트 뒤에 삽입했습니다');
    const past = undoService.entries(world.session).past;
    expect(past).toHaveLength(before + 1);
    expect(past[past.length - 1].label).toBe(UNDO_TEXT.comboBatchInsert(3));
    expect(await undoService.undo(world.session)).toBe(true);
    expect(prompts(world.a)).toEqual([['cat', 'dog'], ['red']]);
    expect(prompts(world.combo)).toEqual([['mid'], ['blue']]);
    expect(world.single.preset.prompt).toBe('hand');
  });

  test('[닫기]·✕ = closeBatchInsert', async () => {
    await act(async () => root.render(<BatchInsertDialog />));
    await act(async () => (Array.from(slot('footer')!.querySelectorAll('button'))[1] as HTMLButtonElement).click());
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="닫기"]')!.click());
    expect(mockAppState.closeBatchInsert).toHaveBeenCalledTimes(2);
  });

  test('모바일: aside 는 본문 위에 쌓이고 씬 목록 max-h-36', async () => {
    mockEnv.mobile = true;
    await act(async () => root.render(<BatchInsertDialog />));
    expect(slot('columns')).toBeNull();
    const aside = slot('aside')!;
    expect(slot('body')!.contains(aside)).toBe(true);
    expect(aside.querySelector<HTMLElement>('[data-find-scene-list]')!.className).toContain('max-h-36');
  });

  test('닫혀 있으면 아무것도 그리지 않는다', async () => {
    mockAppState.batchInsertOpen = false;
    try {
      await act(async () => root.render(<BatchInsertDialog />));
      expect(container.innerHTML).toBe('');
    } finally {
      mockAppState.batchInsertOpen = true;
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 툴바 버튼 — 찾기·변환 옆, 생성/변형 탭 공용 씬 툴바, 퀵 메뉴 액션
// ═══════════════════════════════════════════════════════════════════
describe('툴바 버튼 batch-insert', () => {
  test('레지스트리: find-replace 바로 뒤, 같은 등급·그룹·portable·V2 라벨, 아이콘 사전 등록', () => {
    const ids = sceneToolbarRegistry.map((b) => b.id);
    expect(ids.indexOf('batch-insert')).toBe(ids.indexOf('find-replace') + 1);
    const fr = sceneToolbarRegistry.find((b) => b.id === 'find-replace')!;
    const bi = sceneToolbarRegistry.find((b) => b.id === 'batch-insert')!;
    expect(bi).toMatchObject({ name: '일괄 삽입', label: '일괄 삽입', v2Label: '일괄 삽입' });
    expect([bi.tier, bi.group, bi.portable, bi.pcOnly]).toEqual([fr.tier, fr.group, fr.portable, fr.pcOnly]);
    expect(iconOf('batch-insert')).toBeDefined();
    expect(iconOf('batch-insert')).not.toBe(iconOf('add-scene'));
  });

  test('씬 툴바(생성·변형 탭이 같은 TOOLBAR_VIEW_MAIN scene 영역): PC 인라인·모바일 ⋯ — find-replace 와 같은 자리', () => {
    for (const mobile of [false, true]) {
      const scene = resolveToolbarView(TOOLBAR_VIEW_MAIN, undefined, mobile).find((a) => a.area === 'scene')!;
      const where = (id: string) => (scene.inline.includes(id) ? 'inline' : scene.menu.includes(id) ? 'menu' : 'none');
      expect(where('batch-insert')).toBe(where('find-replace'));
      expect(where('batch-insert')).toBe(mobile ? 'menu' : 'inline');
    }
  });

  test('버튼 클릭 = openBatchInsert, 퀵 메뉴 액션도 같은 동작(세션 있을 때만 가능)', async () => {
    const node = portableToolbarButtons({ mobileIcon: false, variant: 'scene' })['batch-insert'];
    await act(async () => root.render(<>{node}</>));
    const btn = container.querySelector('button')!;
    await act(async () => btn.click());
    expect(mockAppState.openBatchInsert).toHaveBeenCalledTimes(1);
    const action = globalActionById('batch-insert')!;
    expect(globalActionMeta('batch-insert')?.name).toBe('일괄 삽입');
    expect(action.available?.()).toBe(true);
    action.run();
    expect(mockAppState.openBatchInsert).toHaveBeenCalledTimes(2);
    mockAppState.curSession = null;
    expect(action.available?.()).toBe(false);
  });
});
