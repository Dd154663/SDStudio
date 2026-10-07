// 조각 캐릭터 프롬프트 ↔ 기준 캐릭터 대응(2026-10-07) — 단일 판정 함수(analyzePieceCharacterPrompts)·출처(sceneCharacterContext·
// variantCharacterContext)·배지(숫자/「!」)·최종 프롬프트 미리보기 캐릭터 구획(buildComboCharacterPreviews).
// 생성 경로(createSDCharacterPrompts)와 조합 순서(enumerateCombinations)가 같은 번호로 짝지어지는지도 실제 함수로 고정한다.
// 계약: SPEC_GUIDE §11-4 인접 「조각 캐릭터 프롬프트 대응」.
let realPromptService: any;

jest.mock('..', () => ({
  backend: { lookupTag: async () => null },
  isMobile: false,
  globalPieceService: { library: new Map() },
  // 실제 PromptService(parseWord) — 순환 import 를 피해 처음 쓸 때 만든다
  get promptService() {
    if (!realPromptService) {
      const { PromptService } = jest.requireActual('../PromptService');
      realPromptService = new PromptService();
    }
    return realPromptService;
  },
}));

import { PromptPiece, Scene } from '../types';
import {
  analyzePieceCharacterPrompts,
  buildComboCharacterPreviews,
  characterTargetSourceText,
  resolveSceneCharacterPrompts,
  sceneCharacterContext,
  setSceneCharacterPromptMode,
  variantCharacterContext,
} from '../sceneCharacterPrompts';
import {
  createSDCharacterPrompts,
  enumerateCombinations,
  lowerPromptNode,
} from '../PromptService';

const cp = (id: string, prompt: string, extra: any = {}) => ({
  id,
  prompt,
  uc: '',
  position: { x: 0.5, y: 0.5 },
  enabled: true,
  ...extra,
});

let idc = 0;
function piece(prompt: string, chars: string[] = [], enabled?: boolean) {
  return PromptPiece.fromJSON({
    prompt,
    characterPrompts: chars,
    id: 'p' + idc++,
    enabled,
  } as any);
}

const session: any = { name: 'project', library: new Map() };

describe('기준 캐릭터 출처 — resolveSceneCharacterPrompts 와 같은 해석', () => {
  test('기본 모드: 직접 입력 + 캐릭터 프리셋 적용분, 같은 객체·같은 순서', () => {
    const scene = new Scene();
    const preset = { characterPrompts: [cp('a', 'alice')] };
    const shared = { characterPrompts: [cp('l', 'linked', { fromPreset: 'P' })] };
    const ctx = sceneCharacterContext(preset, shared, scene);
    const resolved = resolveSceneCharacterPrompts(preset, shared, scene);
    expect(ctx.targets.map((t) => t.character)).toEqual(resolved);
    expect(ctx.targets[0].character).toBe(preset.characterPrompts[0]);
    expect(ctx.targets.map((t) => t.kind)).toEqual(['base', 'base']);
    expect(ctx.targets.map(characterTargetSourceText)).toEqual(['기본 캐릭터 1', '기본 캐릭터 2']);
    expect(ctx.targets[1].character.fromPreset).toBe('P');
    expect(ctx.basis).toBe('기본 캐릭터 프롬프트');
  });

  test('역할 혼합: 역할이 있는 번호만 혼합, 남는 기본 캐릭터는 기본', () => {
    const scene = new Scene();
    scene.sceneCharacterPrompts = [cp('r1', 'left', { enabled: false })];
    setSceneCharacterPromptMode(scene, 'mix');
    const preset = { characterPrompts: [cp('a', 'A'), cp('b', 'B')] };
    const ctx = sceneCharacterContext(preset, {}, scene);
    expect(ctx.targets.map((t) => t.character)).toEqual(
      resolveSceneCharacterPrompts(preset, {}, scene),
    );
    expect(ctx.targets.map((t) => t.kind)).toEqual(['mix', 'base']);
    expect(characterTargetSourceText(ctx.targets[0])).toBe('혼합 · 기본 캐릭터 1 + 씬 역할 1');
    // 역할을 끄면 대응 기본 캐릭터가 꺼진다(해석 결과 그대로)
    expect(ctx.targets[0].character.enabled).toBe(false);
    expect(ctx.basis).toBe('씬 캐릭터 역할: 역할 혼합');
  });

  test('씬 전용: 역할 뒤에 적용된 캐릭터 프리셋(기본 번호 유지)', () => {
    const scene = new Scene();
    scene.sceneCharacterPrompts = [cp('r1', 'R1'), cp('r2', 'R2')];
    setSceneCharacterPromptMode(scene, 'scene');
    const preset = { characterPrompts: [cp('d', 'Direct')] };
    const shared = { characterPrompts: [cp('l', 'Linked', { fromPreset: 'P' })] };
    const ctx = sceneCharacterContext(preset, shared, scene);
    expect(ctx.targets.map((t) => t.character)).toEqual(
      resolveSceneCharacterPrompts(preset, shared, scene),
    );
    expect(ctx.targets.map((t) => t.index)).toEqual([0, 1, 2]);
    expect(ctx.targets.map(characterTargetSourceText)).toEqual([
      '씬 전용 · 씬 캐릭터 역할 1',
      '씬 전용 · 씬 캐릭터 역할 2',
      '기본 캐릭터 2',
    ]);
    expect(ctx.basis).toBe('씬 캐릭터 역할: 씬 전용');
  });

  test('씬 전용 모드라도 역할이 0개면 기본 해석(기준 설명도 기본)', () => {
    const scene = new Scene();
    setSceneCharacterPromptMode(scene, 'scene');
    const ctx = sceneCharacterContext({ characterPrompts: [cp('a', 'A')] }, {}, scene);
    expect(ctx.targets.map((t) => t.kind)).toEqual(['base']);
    expect(ctx.basis).toBe('기본 캐릭터 프롬프트');
  });

  test('변형 씬: 씬 프리셋 캐릭터만 order 정렬(씬 역할 모드 없음)', () => {
    const ctx = variantCharacterContext({
      characterPrompts: [cp('b', 'B', { order: 1 }), cp('a', 'A', { order: 0 })],
    });
    expect(ctx.targets.map((t) => t.character.prompt)).toEqual(['A', 'B']);
    expect(ctx.targets.map((t) => t.kind)).toEqual(['variant', 'variant']);
    expect(characterTargetSourceText(ctx.targets[1])).toBe('이 씬의 캐릭터 프롬프트 2');
    expect(variantCharacterContext(undefined).targets).toEqual([]);
  });
});

describe('analyzePieceCharacterPrompts — 칸 판정·배지', () => {
  const two = sceneCharacterContext(
    { characterPrompts: [cp('a', 'A'), cp('b', 'B', { enabled: false })] },
    {},
    new Scene(),
  ).targets;

  test('대응 있음 → 숫자 배지(내용 있는 칸 수)', () => {
    const r = analyzePieceCharacterPrompts(['x'], two);
    expect(r.slots[0]).toMatchObject({ index: 0, filled: true, reflected: true });
    expect(r.slots[0].target?.character.prompt).toBe('A');
    expect(r.badge).toMatchObject({ text: '1', warn: false });
  });

  test('꺼진 캐릭터 번호의 칸 → 미반영, 배지 「!」', () => {
    const r = analyzePieceCharacterPrompts(['x', 'y'], two);
    expect(r.slots[1].problem).toBe('disabled');
    expect(r.unreflectedCount).toBe(1);
    expect(r.badge).toMatchObject({ text: '!', warn: true });
    expect(r.badge!.label).toContain('꺼져');
  });

  test('기준 수를 넘는 칸 → overflow', () => {
    const r = analyzePieceCharacterPrompts(['x', '', 'z'], two);
    expect(r.slots[2]).toMatchObject({ problem: 'overflow', target: undefined, reflected: false });
    expect(r.badge!.text).toBe('!');
    expect(r.badge!.label).toContain('대응하는 캐릭터가 없어');
  });

  test('기준 0명 → 모든 칸 noBase', () => {
    const r = analyzePieceCharacterPrompts(['x', 'y'], []);
    expect(r.slots.map((s) => s.problem)).toEqual(['noBase', 'noBase']);
    expect(r.badge!.text).toBe('!');
  });

  test('빈 칸(공백만)은 개수·미반영에서 빠진다 — 칸 자리 경고는 남는다', () => {
    const r = analyzePieceCharacterPrompts(['x', '  ', ''], two);
    expect(r.filledCount).toBe(1);
    expect(r.unreflectedCount).toBe(0);
    expect(r.badge).toMatchObject({ text: '1', warn: false });
    // 2번 칸(꺼진 캐릭터)·3번 칸(넘침)은 비어 있어도 편집기에 경고 사유가 붙는다
    expect(r.slots.map((s) => s.problem)).toEqual([undefined, 'disabled', 'overflow']);
    expect(analyzePieceCharacterPrompts(['', ' '], two).badge).toBeNull();
    expect(analyzePieceCharacterPrompts([], two).badge).toBeNull();
    expect(analyzePieceCharacterPrompts(undefined, two).badge).toBeNull();
  });

  test('기준을 모르면(드래그 미리보기) 대응 판정 없이 개수만', () => {
    const r = analyzePieceCharacterPrompts(['x', 'y', ''], undefined);
    expect(r.slots.every((s) => s.problem === undefined)).toBe(true);
    expect(r.badge).toMatchObject({ text: '2', warn: false });
  });
});

describe('최종 프롬프트 미리보기 캐릭터 구획 — 생성과 같은 함수·같은 번호 짝', () => {
  test('씬 전용 모드: 조각 칸이 역할 번호에 붙고, 넘친 칸은 그 조합에만 미반영 경고', async () => {
    const scene = new Scene();
    scene.sceneCharacterPrompts = [cp('r1', 'role1'), cp('r2', 'role2', { enabled: false })];
    setSceneCharacterPromptMode(scene, 'scene');
    const a = piece('a', ['ca', '', 'over']);
    const b = piece('b', ['', 'cb']);
    scene.slots = [[a, b], [piece('z')]];
    const preset = { characterPrompts: [cp('d', 'direct')] };
    const shared = {};

    const nodes = await createSDCharacterPrompts(session, preset, shared, scene);
    const combos = enumerateCombinations(scene);
    expect(nodes).toHaveLength(combos.length);
    const ctx = sceneCharacterContext(preset, shared, scene);
    const previews = buildComboCharacterPreviews(
      ctx.targets,
      nodes.map((list) => list.map((n) => lowerPromptNode(n))),
      combos,
    );
    // 조합 1(a+z): 역할1 + ca, 꺼진 역할2 는 구획에서 빠짐, a 의 3번 칸은 넘침
    expect(previews[0].characters.map((c) => [c.target.index, c.text])).toEqual([[0, 'role1, ca']]);
    expect(previews[0].unreflected.map((u) => [u.columnIndex, u.slot.index, u.slot.problem])).toEqual([
      [0, 2, 'overflow'],
    ]);
    // 조합 2(b+z): b 의 2번 칸은 꺼진 역할2 → 미반영
    expect(previews[1].characters.map((c) => c.text)).toEqual(['role1']);
    expect(previews[1].unreflected.map((u) => u.slot.problem)).toEqual(['disabled']);
  });

  test('기준 0명이면 캐릭터 구획 없음, 내용 있는 조각 칸은 noBase 경고', async () => {
    const scene = new Scene();
    scene.slots = [[piece('a', ['ca'])]];
    const nodes = await createSDCharacterPrompts(session, {}, {}, scene);
    expect(nodes).toEqual([]);
    const ctx = sceneCharacterContext({}, {}, scene);
    const previews = buildComboCharacterPreviews(
      ctx.targets,
      [undefined],
      enumerateCombinations(scene),
    );
    expect(previews[0].characters).toEqual([]);
    expect(previews[0].unreflected.map((u) => u.slot.problem)).toEqual(['noBase']);
  });

  test('최종 문자열이 빈 캐릭터는 구획에 넣지 않는다(요청에서 빠짐)', () => {
    const targets = sceneCharacterContext(
      { characterPrompts: [cp('a', ''), cp('b', 'B')] },
      {},
      new Scene(),
    ).targets;
    const previews = buildComboCharacterPreviews(targets, [['', 'B']], [[]]);
    expect(previews[0].characters.map((c) => c.target.index)).toEqual([1]);
    expect(previews[0].unreflected).toEqual([]);
  });
});
