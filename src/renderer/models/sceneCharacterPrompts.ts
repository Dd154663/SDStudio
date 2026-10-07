import { CharacterPrompt, Scene } from './types';

export type SceneCharacterPromptMode = 'base' | 'mix' | 'scene';

const MODES: SceneCharacterPromptMode[] = ['base', 'mix', 'scene'];

export function getSceneCharacterPromptMode(
  scene: Scene,
): SceneCharacterPromptMode {
  if (
    scene.sceneCharacterPromptMode &&
    MODES.includes(scene.sceneCharacterPromptMode)
  ) {
    return scene.sceneCharacterPromptMode;
  }
  return scene.useSceneCharacterPrompts ? 'scene' : 'base';
}

export function setSceneCharacterPromptMode(
  scene: Scene,
  mode: SceneCharacterPromptMode,
) {
  scene.sceneCharacterPromptMode = mode;
  // 구버전은 mix를 이해하지 못하므로 기본 캐릭터를 보존하는 쪽으로 폴백한다.
  scene.useSceneCharacterPrompts = mode === 'scene';
}

function ordered(items: CharacterPrompt[]): CharacterPrompt[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const ao = Number.isFinite(a.item.order) ? a.item.order! : Infinity;
      const bo = Number.isFinite(b.item.order) ? b.item.order! : Infinity;
      return ao - bo || a.index - b.index;
    })
    .map(({ item }) => item);
}

export function getOrderedBaseCharacterPrompts(
  preset: any,
  shared: any,
): CharacterPrompt[] {
  // order가 없는 구 프로젝트의 실제 생성 순서(preset → shared)를 유지한다.
  return ordered([
    ...(preset?.characterPrompts || []),
    ...(shared?.characterPrompts || []),
  ]);
}

export function reorderBaseCharacterPrompts(
  preset: any,
  shared: any,
  fromIndex: number,
  toIndex: number,
): boolean {
  const current = getOrderedBaseCharacterPrompts(preset, shared);
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= current.length ||
    toIndex >= current.length ||
    fromIndex === toIndex
  ) {
    return false;
  }
  const next = [...current];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  const orderById = new Map(next.map((item, index) => [item.id, index]));
  if (preset?.characterPrompts) {
    preset.characterPrompts = preset.characterPrompts.map(
      (item: CharacterPrompt) => ({
        ...item,
        order: orderById.get(item.id),
      }),
    );
  }
  if (shared?.characterPrompts) {
    shared.characterPrompts = shared.characterPrompts.map(
      (item: CharacterPrompt) => ({
        ...item,
        order: orderById.get(item.id),
      }),
    );
  }
  return true;
}

export function reorderSceneCharacterPrompts(
  scene: Scene,
  fromIndex: number,
  toIndex: number,
): boolean {
  const current = [...(scene.sceneCharacterPrompts || [])];
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= current.length ||
    toIndex >= current.length ||
    fromIndex === toIndex
  ) {
    return false;
  }
  const [moved] = current.splice(fromIndex, 1);
  current.splice(toIndex, 0, moved);
  scene.sceneCharacterPrompts = current;
  return true;
}

function joinPrompt(base: string, addition: string): string {
  return [base, addition]
    .map((value) => (value || '').trim())
    .filter(Boolean)
    .join(', ');
}

/**
 * 해석된 캐릭터 한 명 + 출처(표시용, 2026-10-07). resolveSceneCharacterPrompts 와 같은 분기에서 함께 만든다
 * — 출처 표시가 실제 해석과 어긋나지 않게 하나의 함수(resolveSceneCharacterEntries)가 둘 다 낸다.
 * - kind 'base' = 기본 캐릭터(직접 입력·적용된 캐릭터 프리셋 — 프리셋이면 character.fromPreset)
 * - kind 'mix' = 기본 캐릭터 + 같은 번호 씬 역할(역할 혼합)
 * - kind 'role' = 씬 전용 역할(씬 전용 모드)
 * - kind 'variant' = 변형 씬(I2I·인페인트·미러 조합) 자신의 캐릭터 프롬프트(expandVariantCombos 기준)
 */
export type CharacterTargetKind = 'base' | 'mix' | 'role' | 'variant';

export interface CharacterTarget {
  /** 해석 후 번호(0부터) — 조각 캐릭터란 j 번째 칸이 붙는 자리 */
  index: number;
  /** 해석된 캐릭터(생성에 쓰이는 값 그대로 — enabled·prompt·fromPreset) */
  character: CharacterPrompt;
  kind: CharacterTargetKind;
  /** 기본 캐릭터 목록(getOrderedBaseCharacterPrompts)에서의 번호(0부터) */
  baseIndex?: number;
  /** 씬 캐릭터 역할 번호(0부터) */
  roleIndex?: number;
}

function resolveSceneCharacterEntries(
  preset: any,
  shared: any,
  scene: Scene,
): CharacterTarget[] {
  const base = getOrderedBaseCharacterPrompts(preset, shared);
  const roles = scene.sceneCharacterPrompts || [];
  const mode = getSceneCharacterPromptMode(scene);

  if (mode === 'base' || roles.length === 0) {
    return base.map((character, index) => ({
      index,
      character,
      kind: 'base' as const,
      baseIndex: index,
    }));
  }

  if (mode === 'mix') {
    // 역할은 같은 번호의 기본 캐릭터에만 적용한다. 남는 역할은 대기 상태이며
    // 외형 없는 캐릭터를 임의로 만들지 않는다.
    return base.map((character, index) => {
      const role = roles[index];
      if (!role) {
        return {
          index,
          character: { ...character },
          kind: 'base' as const,
          baseIndex: index,
        };
      }
      return {
        index,
        character: {
          ...character,
          prompt: joinPrompt(character.prompt, role.prompt),
          uc: joinPrompt(character.uc, role.uc),
          position: role.position || character.position,
          enabled: character.enabled !== false && role.enabled !== false,
        },
        kind: 'mix' as const,
        baseIndex: index,
        roleIndex: index,
      };
    });
  }

  // 기존 씬 전용 동작: 직접입력 캐릭터는 대체하지만 적용된 캐릭터 프리셋은 유지한다.
  const kept = ordered([...(shared?.characterPrompts || [])]);
  return [
    ...roles.map((character, roleIndex) => ({
      index: roleIndex,
      character,
      kind: 'role' as const,
      roleIndex,
    })),
    ...kept.map((character, k) => {
      const baseIndex = base.indexOf(character);
      return {
        index: roles.length + k,
        character,
        kind: 'base' as const,
        baseIndex: baseIndex >= 0 ? baseIndex : undefined,
      };
    }),
  ];
}

export function resolveSceneCharacterPrompts(
  preset: any,
  shared: any,
  scene: Scene,
): CharacterPrompt[] {
  return resolveSceneCharacterEntries(preset, shared, scene).map(
    (entry) => entry.character,
  );
}

export function usesSceneCharacterPromptData(scene: Scene): boolean {
  return (
    getSceneCharacterPromptMode(scene) !== 'base' &&
    (scene.sceneCharacterPrompts?.length || 0) > 0
  );
}

// ─── 조각 캐릭터 프롬프트 ↔ 기준 캐릭터 대응(2026-10-07, 단일 판정 출처) ───────────────────────────
// 조합 에디터 조각(PromptPiece)의 characterPrompts[j] 는 생성 때(createSDCharacterPrompts) 해석된 기준 캐릭터 j 의
// 프롬프트 뒤에 덧붙는다. 기준 캐릭터가 0명이면 통째로 버려지고(createSDCharacterPrompts 가 [] 반환), 기준 수를
// 넘는 칸은 버려지며, 꺼진 캐릭터 번호의 칸은 잡 조립(buildSDImageGenJob·expandVariantCombos)에서 함께 빠진다.
// 조각 편집기 번호·경고, FaUser 배지(숫자/「!」), 최종 프롬프트 미리보기의 캐릭터 구획·미반영 경고가 모두 이 판정을 쓴다.

/** 조각 캐릭터란이 붙는 기준 캐릭터 목록 + 기준 설명(편집기 머리 문구). */
export interface PieceCharacterContext {
  targets: CharacterTarget[];
  /** 기준 설명 — 예: 「씬 캐릭터 역할: 역할 혼합」 */
  basis: string;
}

/** 이미지생성 씬 — 생성과 같은 해석(resolveSceneCharacterPrompts)의 캐릭터 목록. */
export function sceneCharacterContext(
  preset: any,
  shared: any,
  scene: Scene,
): PieceCharacterContext {
  const targets = resolveSceneCharacterEntries(preset, shared, scene);
  const mode = getSceneCharacterPromptMode(scene);
  const hasRoles = (scene.sceneCharacterPrompts?.length || 0) > 0;
  const basis =
    mode === 'base' || !hasRoles
      ? '기본 캐릭터 프롬프트'
      : mode === 'mix'
        ? '씬 캐릭터 역할: 역할 혼합'
        : '씬 캐릭터 역할: 씬 전용';
  return { targets, basis };
}

/**
 * 변형 씬(미러·I2I·인페인트 조합 모드) — expandVariantCombos 와 같은 기준: 씬 프리셋 characterPrompts(order 정렬),
 * 씬 캐릭터 역할 모드는 적용되지 않는다.
 */
export function variantCharacterContext(preset: any): PieceCharacterContext {
  const base = getOrderedBaseCharacterPrompts(
    { characterPrompts: preset?.characterPrompts ?? [] },
    { characterPrompts: [] },
  );
  return {
    targets: base.map((character, index) => ({
      index,
      character,
      kind: 'variant' as const,
      baseIndex: index,
    })),
    basis: '이 씬의 캐릭터 프롬프트',
  };
}

/** 기준 캐릭터 출처 문구(표시용). 적용된 캐릭터 프리셋 이름은 character.fromPreset 으로 따로 표시한다. */
export function characterTargetSourceText(target: CharacterTarget): string {
  switch (target.kind) {
    case 'mix':
      return `혼합 · 기본 캐릭터 ${(target.baseIndex ?? target.index) + 1} + 씬 역할 ${(target.roleIndex ?? target.index) + 1}`;
    case 'role':
      return `씬 전용 · 씬 캐릭터 역할 ${(target.roleIndex ?? target.index) + 1}`;
    case 'variant':
      return `이 씬의 캐릭터 프롬프트 ${target.index + 1}`;
    default:
      return target.baseIndex !== undefined
        ? `기본 캐릭터 ${target.baseIndex + 1}`
        : '기본 캐릭터';
  }
}

/** 미반영 사유 — noBase: 기준 캐릭터 0명, overflow: 기준 수를 넘는 칸, disabled: 그 번호의 캐릭터가 꺼짐. */
export type PieceCharacterProblem = 'noBase' | 'overflow' | 'disabled';

export const PIECE_CHARACTER_TEXT = {
  problem: {
    noBase: '기준 캐릭터가 없어(0명) 생성에 반영되지 않습니다',
    overflow: '대응하는 캐릭터가 없어 생성에 반영되지 않습니다',
    disabled: '이 번호의 캐릭터가 꺼져 있어 생성에 반영되지 않습니다',
  } as Record<PieceCharacterProblem, string>,
  editTooltip: '캐릭터 프롬프트 편집',
} as const;

export interface PieceCharacterSlotInfo {
  /** 칸 번호(0부터) = 붙는 기준 캐릭터 번호 */
  index: number;
  /** 내용이 있는 칸(공백만 있으면 빈 칸 — 생성에 아무것도 더하지 않는다) */
  filled: boolean;
  /** 대응 기준 캐릭터(없으면 넘침·0명) */
  target?: CharacterTarget;
  /** 미반영 사유(내용과 무관하게 칸 자리 기준) */
  problem?: PieceCharacterProblem;
  /** 내용이 있고 사유가 없을 때만 true */
  reflected: boolean;
}

export interface PieceCharacterBadge {
  /** 배지 글자 — 내용 있는 칸 수, 미반영 칸이 하나라도 있으면 「!」 */
  text: string;
  warn: boolean;
  /** 툴팁·aria 용 설명 */
  label: string;
}

export interface PieceCharacterAnalysis {
  slots: PieceCharacterSlotInfo[];
  filledCount: number;
  /** 내용이 있는데 미반영인 칸 수 */
  unreflectedCount: number;
  /** 내용 있는 칸이 없으면 null(배지 없음) */
  badge: PieceCharacterBadge | null;
}

/**
 * 조각 캐릭터란 판정(단일 출처). targets 를 모르면(undefined — 드래그 미리보기 등) 대응 판정 없이 개수만 낸다.
 * 빈 칸(공백만)은 배지 개수·미반영 수에 넣지 않는다 — 생성 결과에 아무것도 더하지 않기 때문.
 */
export function analyzePieceCharacterPrompts(
  prompts: readonly string[] | undefined,
  targets: readonly CharacterTarget[] | undefined,
): PieceCharacterAnalysis {
  const list = prompts || [];
  const slots: PieceCharacterSlotInfo[] = list.map((value, index) => {
    const filled = (value || '').trim() !== '';
    if (!targets) return { index, filled, reflected: filled };
    const target = targets[index];
    const problem: PieceCharacterProblem | undefined =
      targets.length === 0
        ? 'noBase'
        : !target
          ? 'overflow'
          : target.character.enabled === false
            ? 'disabled'
            : undefined;
    return { index, filled, target, problem, reflected: filled && !problem };
  });
  const filledCount = slots.filter((s) => s.filled).length;
  const unreflected = slots.filter((s) => s.filled && s.problem);
  const unreflectedCount = unreflected.length;
  let badge: PieceCharacterBadge | null = null;
  if (filledCount > 0) {
    if (unreflectedCount > 0) {
      const reasons = Array.from(new Set(unreflected.map((s) => s.problem!)))
        .map((p) => PIECE_CHARACTER_TEXT.problem[p])
        .join(' / ');
      badge = {
        text: '!',
        warn: true,
        label: `캐릭터 프롬프트 ${filledCount}칸 중 ${unreflectedCount}칸은 ${reasons}`,
      };
    } else {
      badge = {
        text: String(filledCount),
        warn: false,
        label: `캐릭터 프롬프트 ${filledCount}칸`,
      };
    }
  }
  return { slots, filledCount, unreflectedCount, badge };
}

/** 최종 프롬프트 미리보기 — 한 조합의 캐릭터 구획(긍정 프롬프트만). */
export interface ComboCharacterPreview {
  /** 실제로 생기는 캐릭터(켜짐 + 최종 프롬프트가 비지 않음 — nai.ts 가 빈 캐릭터를 뺀다), 해석 순서 */
  characters: { target: CharacterTarget; text: string }[];
  /** 이 조합에 뽑힌 조각 중 내용 있는 미반영 칸 */
  unreflected: {
    columnIndex: number;
    piece: { characterPrompts?: string[] };
    slot: PieceCharacterSlotInfo;
  }[];
}

/**
 * 조합별 캐릭터 구획을 만든다(전개는 하지 않음 — 호출부가 생성과 같은 createSDCharacterPrompts 결과를
 * lowerPromptNode 로 푼 문자열을 넘긴다). characterTexts[i][j] = 조합 i 의 해석 캐릭터 j 최종 문자열,
 * combos[i] = 같은 조합 i 에 뽑힌 조각(enumerateCombinations — 생성 DFS 와 같은 순서).
 * 켜진 캐릭터만 원래 번호로 짝짓는 규칙은 buildSDImageGenJob·expandVariantCombos 와 같다.
 */
export function buildComboCharacterPreviews(
  targets: readonly CharacterTarget[],
  characterTexts: readonly (readonly string[] | undefined)[],
  combos: readonly (
    | readonly { columnIndex: number; piece: { characterPrompts?: string[] } }[]
    | undefined
  )[],
): ComboCharacterPreview[] {
  return characterTexts.map((texts, i) => {
    const characters = targets
      .filter((t) => t.character.enabled !== false)
      .map((t) => ({ target: t, text: (texts?.[t.index] ?? '').trim() }))
      .filter((c) => c.text !== '');
    const unreflected: ComboCharacterPreview['unreflected'] = [];
    for (const seg of combos[i] || []) {
      const analysis = analyzePieceCharacterPrompts(
        seg.piece.characterPrompts,
        targets,
      );
      for (const slot of analysis.slots) {
        if (slot.filled && slot.problem) {
          unreflected.push({ columnIndex: seg.columnIndex, piece: seg.piece, slot });
        }
      }
    }
    return { characters, unreflected };
  });
}
